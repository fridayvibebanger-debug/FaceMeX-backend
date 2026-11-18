import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class EmailAssistantError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'EmailAssistantError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateRecipientEmail(value) {
  const email = clean(value);
  if (
    email.length > 254 ||
    /[\r\n]/.test(email) ||
    !/^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/.test(email)
  ) {
    throw new EmailAssistantError('invalid_recipient', 'Enter a valid recipient email address.');
  }
  return email;
}

export function normalizeEmailPayload(input = {}) {
  const to = validateRecipientEmail(input.to);
  const recipientName = clean(input.recipientName);
  const subject = clean(input.subject);
  const message = typeof input.message === 'string' ? input.message.trim() : '';

  if (recipientName.length > 120 || /[\r\n]/.test(recipientName)) {
    throw new EmailAssistantError('invalid_recipient_name', 'The recipient name is not valid.');
  }
  if (!subject || subject.length > 250 || /[\r\n]/.test(subject)) {
    throw new EmailAssistantError('invalid_subject', 'Enter a subject of 1–250 characters.');
  }
  if (!message || message.length > 30_000) {
    throw new EmailAssistantError('invalid_message', 'Enter a message of 1–30,000 characters.');
  }

  return { to, recipientName, subject, message };
}

export function validateIdempotencyKey(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new EmailAssistantError('invalid_idempotency_key', 'A valid send confirmation key is required.');
  }
  return value;
}

export function buildEmailGenerationPrompt({ prompt, recipientEmail, recipientName }) {
  return [
    'Write a professional email draft based only on the user’s instructions.',
    'Support job applications, business enquiries, professional or academic communication, follow-ups, meeting requests, and customer-support emails.',
    'Return exactly one JSON object with string fields recipientEmail, recipientName, subject, body, and signature.',
    'Use an empty string for unknown fields. Do not invent a recipient name or email address.',
    'Do not send the email or claim that it was sent. The body must not include the suggested signature.',
    '',
    `Recipient email explicitly supplied: ${recipientEmail || '[none]'}`,
    `Recipient name explicitly supplied: ${recipientName || '[none]'}`,
    `User instructions: ${prompt}`,
  ].join('\n');
}

function decodeModelJson(value) {
  const text = clean(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    throw new EmailAssistantError('invalid_ai_response', 'The AI returned an unreadable email draft.', 502);
  }
}

export function normalizeGeneratedDraft(value, { recipientEmail, recipientName }) {
  const parsed = typeof value === 'string' ? decodeModelJson(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EmailAssistantError('invalid_ai_response', 'The AI returned an unreadable email draft.', 502);
  }

  const subject = clean(parsed.subject);
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  const signature = typeof parsed.signature === 'string' ? parsed.signature.trim() : '';
  if (!subject || subject.length > 250 || !body || body.length > 30_000 || signature.length > 1_000) {
    throw new EmailAssistantError('invalid_ai_response', 'The AI returned an incomplete email draft.', 502);
  }

  return {
    recipientEmail: recipientEmail ? validateRecipientEmail(recipientEmail) : null,
    recipientName: recipientName ? clean(recipientName) : null,
    subject,
    body,
    signature,
  };
}

function encryptionKey(env) {
  const key = Buffer.from(env.GMAIL_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) {
    throw new EmailAssistantError(
      'email_encryption_not_configured',
      'Gmail token encryption is not configured on the server.',
      503
    );
  }
  return key;
}

export function encryptToken(value, env = process.env, randomBytesImpl = randomBytes) {
  if (typeof value !== 'string' || !value) {
    throw new EmailAssistantError('invalid_token', 'Google returned an invalid token.', 502);
  }
  const iv = randomBytesImpl(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptToken(value, env = process.env) {
  const [version, ivText, tagText, encryptedText] = String(value || '').split('.');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw new EmailAssistantError('invalid_stored_token', 'The saved Gmail connection is invalid.', 503);
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof EmailAssistantError) throw error;
    throw new EmailAssistantError('invalid_stored_token', 'The saved Gmail connection could not be decrypted.', 503);
  }
}

function encodeHeader(value) {
  return /^[A-Za-z0-9 ._-]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function buildRawEmail(payload) {
  const normalized = normalizeEmailPayload(payload);
  const to = normalized.recipientName
    ? `${encodeHeader(normalized.recipientName)} <${normalized.to}>`
    : normalized.to;
  const encodedBody = Buffer.from(normalized.message, 'utf8')
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n');
  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeader(normalized.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody,
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

export function hashEmailPayload(payload) {
  return createHash('sha256')
    .update(JSON.stringify([payload.to, payload.recipientName, payload.subject, payload.message]))
    .digest('hex');
}

export function hashOAuthState(state) {
  return createHash('sha256').update(state).digest('hex');
}
