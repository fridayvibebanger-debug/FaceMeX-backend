import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmailGenerationPrompt,
  buildRawEmail,
  decryptToken,
  encryptToken,
  normalizeEmailPayload,
  normalizeGeneratedDraft,
  validateIdempotencyKey,
  validateRecipientEmail,
} from './emailAssistant.js';

const env = { GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };

test('email draft generation returns only an explicitly supplied recipient', () => {
  const prompt = buildEmailGenerationPrompt({
    prompt: 'Write a job application email.',
    recipientEmail: '',
    recipientName: '',
  });
  assert.match(prompt, /Do not invent a recipient name or email address/);

  const draft = normalizeGeneratedDraft({
    recipientEmail: 'invented@example.com',
    recipientName: 'Invented Name',
    subject: 'Application',
    body: 'Please consider my application.',
    signature: 'Regards',
  }, { recipientEmail: '', recipientName: '' });

  assert.equal(draft.recipientEmail, null);
  assert.equal(draft.recipientName, null);
  assert.equal(draft.subject, 'Application');
});

test('recipient and email fields reject invalid or header-injected values', () => {
  assert.throws(() => validateRecipientEmail('not-an-email'), { code: 'invalid_recipient' });
  assert.throws(() => validateRecipientEmail('a@example.com\r\nBcc: other@example.com'), {
    code: 'invalid_recipient',
  });
  assert.throws(() => normalizeEmailPayload({
    to: 'a@example.com',
    subject: 'Hello\r\nBcc: other@example.com',
    message: 'Hello',
  }), { code: 'invalid_subject' });
});

test('email MIME includes only validated recipient and UTF-8 encoded content', () => {
  const raw = buildRawEmail({
    to: 'person@example.com',
    recipientName: 'Renée, <Bcc: other@example.com>',
    subject: 'Hello',
    message: 'Thanks for your time.',
  });
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(mime, /To: =\?UTF-8\?B\?/);
  assert.match(mime, /Subject: Hello/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.doesNotMatch(mime, /Bcc:/i);
  assert.equal((mime.match(/To:/g) || []).length, 1);
});

test('Gmail tokens are encrypted at rest and reject tampering', () => {
  const encrypted = encryptToken('refresh-token', env);
  assert.notEqual(encrypted, 'refresh-token');
  assert.equal(decryptToken(encrypted, env), 'refresh-token');
  const tampered = encrypted.split('.');
  tampered[2] = `${tampered[2][0] === 'A' ? 'B' : 'A'}${tampered[2].slice(1)}`;
  assert.throws(() => decryptToken(tampered.join('.'), env), {
    code: 'invalid_stored_token',
  });
});

test('send idempotency keys must be version 4 UUIDs', () => {
  assert.equal(
    validateIdempotencyKey('00000000-0000-4000-8000-000000000001'),
    '00000000-0000-4000-8000-000000000001'
  );
  assert.throws(() => validateIdempotencyKey('123456'), { code: 'invalid_idempotency_key' });
});
