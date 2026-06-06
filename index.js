import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import Stripe from 'stripe';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';

import { setMe } from './utils/userStore.js';
import { connectDb } from './lib/db.js';
import { dbReady, lastError } from './utils/sqlite.js';

import usersRouter from './routes/users.js';
import postsRouter from './routes/posts.js';
import eventsRouter from './routes/events.js';
import notificationsRouter from './routes/notifications.js';
import reactionsRouter from './routes/reactions.js';
import billingRouter from './routes/billing.js';
import paymentsRouter from './routes/payments.js';
import aiRouter from './routes/ai.js';
import businessRouter from './routes/business.js';
import safetyRouter from './routes/safety.js';
import authRouter from './routes/auth.js';
import journalRouter from './routes/journal.js';
import storiesRouter from './routes/stories.js';
import statusStoriesRouter from './routes/statusStories.js';
import worldsRouter from './routes/worlds.js';
import friendsRouter from './routes/friends.js';
import jobsRouter from './routes/jobs.js';
import proGroupsRouter from './routes/proGroups.js';
import marketplaceRouter from './routes/marketplace.js';
import azureUploadsRouter from './routes/azureUploads.js';
import uploadsRouter from './routes/uploads.js';
import translateRouter from './routes/translate.js';

try {
  const rootEnvLocal = new URL('../.env.local', import.meta.url);
  dotenv.config({ path: rootEnvLocal, override: false });
} catch {}

try {
  const rootEnv = new URL('../.env', import.meta.url);
  dotenv.config({ path: rootEnv, override: false });
} catch {}

dotenv.config({ override: false });

const app = express();

const allowedOrigins = [
  'https://facemexsocial.com',
  'https://www.facemexsocial.com',
  'https://privatebeta4.netlify.app',
  'http://localhost:5173',
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
};

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 25000,
});

app.set('io', io);

/*
  REAL-TIME MEMORY
*/
const worldPresence = new Map();
const userSockets = new Map();
const activeCalls = new Map();

function makeId(prefix = 'id') {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function addUserSocket(userId, socketId) {
  const id = String(userId || '').trim();
  if (!id) return;

  if (!userSockets.has(id)) {
    userSockets.set(id, new Set());
  }

  userSockets.get(id).add(socketId);
}

function removeUserSocket(userId, socketId) {
  const id = String(userId || '').trim();
  if (!id || !userSockets.has(id)) return;

  const set = userSockets.get(id);
  set.delete(socketId);

  if (set.size === 0) {
    userSockets.delete(id);
  }
}

function getCallRoom(payload = {}) {
  if (payload.callId && activeCalls.has(payload.callId)) {
    return activeCalls.get(payload.callId).roomId;
  }

  return payload.roomId || null;
}

function sendToUser(userId, event, payload) {
  const id = String(userId || '').trim();
  if (!id) return;

  io.to(`user:${id}`).emit(event, payload);
}

function cleanupCall(callId, reason = 'ended') {
  if (!callId || !activeCalls.has(callId)) return;

  const call = activeCalls.get(callId);

  io.to(call.roomId).emit('call:cleanup', {
    callId,
    roomId: call.roomId,
    reason,
  });

  activeCalls.delete(callId);
}

/*
  FACEMEX AI RUNTIME CONTEXT
  Makes Workspace know:
  - real South African date/time
  - job-search intent
  - location like Tzaneen / Limpopo / Polokwane
  - live search results if Brave/Bing key exists
  - safe verified job-board links if no live search key exists
*/

function getSouthAfricaDateContext() {
  const now = new Date();
  const timeZone = 'Africa/Johannesburg';

  const readableDateTime = new Intl.DateTimeFormat('en-ZA', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  const shortDate = new Intl.DateTimeFormat('en-ZA', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  return {
    nowIso: now.toISOString(),
    timeZone,
    shortDate,
    isoDate,
    readableDateTime,
    instruction: `
CURRENT DATE CONTEXT:
Today is ${readableDateTime}.
Short date: ${shortDate}.
ISO date: ${isoDate}.
The user is in South Africa. Use timezone: Africa/Johannesburg.

DATE RULES:
- If the user asks for today's date, current date, current year, tomorrow, yesterday, deadlines, interviews, or application timing, use the date above.
- Never guess the current date.
- Never use old model-memory dates.
`.trim(),
  };
}

function extractUserTextFromBody(body = {}) {
  if (!body || typeof body !== 'object') return '';

  const direct =
    body.message ||
    body.prompt ||
    body.question ||
    body.input ||
    body.text ||
    body.query ||
    '';

  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  if (Array.isArray(body.messages)) {
    const lastUserMessage = [...body.messages]
      .reverse()
      .find((msg) => msg?.role === 'user' && typeof msg?.content === 'string');

    if (lastUserMessage?.content) return lastUserMessage.content.trim();
  }

  return '';
}

function shouldAttachLiveResearch(text = '') {
  const t = String(text || '').toLowerCase();

  return /\b(job|jobs|hiring|hire|vacancy|vacancies|career|careers|apply|application|learnership|internship|graduate programme|bursary|company|companies|deadline|salary|interview|cv|cover letter|opportunity|opportunities|funding|grant|tender|limpopo|tzaneen|polokwane|giyani|phalaborwa|mokopane|thohoyandou|mankweng|modjadjiskloof|lenyenye|nkowankowa)\b/.test(t);
}

function isJobSearchPrompt(text = '') {
  const t = String(text || '').toLowerCase();

  return /\b(looking for job|looking for work|find me job|find jobs|available jobs|jobs around|jobs in|vacancies around|vacancies in|hiring around|hiring in|apply for jobs|need a job|job near me|work around|work in|internship|learnership)\b/.test(t);
}

function extractJobLocation(text = '') {
  const t = String(text || '').toLowerCase();

  const locations = [
    'tzaneen',
    'limpopo',
    'polokwane',
    'lenyenye',
    'nkowankowa',
    'giyani',
    'phalaborwa',
    'modjadjiskloof',
    'mankweng',
    'mokopane',
    'thohoyandou',
    'burgersdorp',
    'maake',
    'maake plaza',
    'johannesburg',
    'pretoria',
    'durban',
    'cape town',
    'south africa',
  ];

  const found = locations.find((loc) => t.includes(loc));

  if (found) {
    return found
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return 'South Africa';
}

function extractJobType(text = '') {
  const t = String(text || '').toLowerCase();

  const jobTypes = [
    'general worker',
    'cleaner',
    'admin',
    'administrative',
    'driver',
    'cashier',
    'security',
    'retail',
    'sales',
    'waiter',
    'waitress',
    'receptionist',
    'call centre',
    'data entry',
    'learnership',
    'internship',
    'graduate',
    'warehouse',
    'pick n pay',
    'shoprite',
    'boxer',
    'spar',
    'teacher assistant',
    'nurse',
    'clinic',
    'municipality',
    'government',
  ];

  const found = jobTypes.find((job) => t.includes(job));

  if (found) return found;

  return 'jobs';
}

function buildJobSearchQueries(userText = '') {
  const location = extractJobLocation(userText);
  const jobType = extractJobType(userText);

  const cleanUserText = String(userText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

  const baseQuery =
    cleanUserText ||
    `${jobType} ${location}`;

  return [
    `${jobType} ${location} jobs apply official South Africa`,
    `${jobType} vacancies ${location} South Africa apply`,
    `${baseQuery} site:careers24.com OR site:pnet.co.za OR site:linkedin.com/jobs OR site:za.indeed.com`,
    `${location} latest jobs vacancies apply`,
  ];
}

function buildVerifiedJobLinks(userText = '') {
  const location = extractJobLocation(userText);
  const jobType = extractJobType(userText);

  const q = encodeURIComponent(
    `${jobType} ${location}`
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140)
  );

  const locationEncoded = encodeURIComponent(location);

  return [
    {
      title: `LinkedIn Jobs - ${jobType} in ${location}`,
      url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${locationEncoded}`,
      sourceType: 'job-board',
      verification: 'Large job platform. Users must still verify company details before applying.',
    },
    {
      title: `Indeed South Africa - ${jobType} in ${location}`,
      url: `https://za.indeed.com/jobs?q=${q}&l=${locationEncoded}`,
      sourceType: 'job-board',
      verification: 'Large job platform. Check company name, closing date, and official details.',
    },
    {
      title: `PNet South Africa`,
      url: `https://www.pnet.co.za/jobs`,
      sourceType: 'job-board',
      verification: 'South African job platform. Search the job title and location inside the site.',
    },
    {
      title: `Careers24`,
      url: `https://www.careers24.com/jobs/`,
      sourceType: 'job-board',
      verification: 'South African job platform. Search the job title and location inside the site.',
    },
    {
      title: `CareerJunction`,
      url: `https://www.careerjunction.co.za/jobs`,
      sourceType: 'job-board',
      verification: 'South African job platform. Search the job title and location inside the site.',
    },
    {
      title: `DPSA Public Service Vacancy Circular`,
      url: `https://www.dpsa.gov.za/newsroom/psvc/`,
      sourceType: 'official-government',
      verification: 'Official South African government vacancy circulars.',
    },
    {
      title: `SAYouth Opportunities`,
      url: `https://sayouth.mobi/`,
      sourceType: 'youth-opportunities',
      verification: 'Common South African youth opportunity platform. Users must confirm details before applying.',
    },
  ];
}

function classifySource(url = '') {
  const u = String(url || '').toLowerCase();

  if (!u.startsWith('http')) return 'unknown';

  if (
    u.includes('dpsa.gov.za') ||
    u.includes('.gov.za') ||
    u.includes('sayouth.mobi')
  ) {
    return 'official/public-sector';
  }

  if (
    u.includes('linkedin.com/jobs') ||
    u.includes('pnet.co.za') ||
    u.includes('careers24.com') ||
    u.includes('careerjunction.co.za') ||
    u.includes('za.indeed.com') ||
    u.includes('indeed.com') ||
    u.includes('bizcommunity.com') ||
    u.includes('jobmail.co.za')
  ) {
    return 'known-job-board';
  }

  if (
    u.includes('/careers') ||
    u.includes('/career') ||
    u.includes('/jobs') ||
    u.includes('/vacancies') ||
    u.includes('/recruitment')
  ) {
    return 'company-careers-page';
  }

  return 'web-result-check-before-applying';
}

function cleanSearchResults(results = []) {
  const seen = new Set();

  return results
    .filter((item) => item && item.url && item.title)
    .map((item) => {
      const url = String(item.url || '').trim();

      return {
        title: String(item.title || '').trim(),
        url,
        description: String(item.description || '').trim(),
        sourceType: classifySource(url),
      };
    })
    .filter((item) => {
      if (!item.url.startsWith('http')) return false;
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, 10);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithBrave(query) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '8');
  url.searchParams.set('country', 'ZA');
  url.searchParams.set('search_lang', 'en');
  url.searchParams.set('safesearch', 'moderate');

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status}`);
  }

  const data = await response.json();

  return cleanSearchResults(
    (data?.web?.results || []).map((item) => ({
      title: item.title,
      url: item.url,
      description: item.description,
    }))
  );
}

async function searchWithBing(query) {
  const key = process.env.BING_SEARCH_API_KEY;
  if (!key) return [];

  const endpoint =
    process.env.BING_SEARCH_ENDPOINT ||
    'https://api.bing.microsoft.com/v7.0/search';

  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('mkt', 'en-ZA');
  url.searchParams.set('count', '8');
  url.searchParams.set('safeSearch', 'Moderate');

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Bing search failed: ${response.status}`);
  }

  const data = await response.json();

  return cleanSearchResults(
    (data?.webPages?.value || []).map((item) => ({
      title: item.name,
      url: item.url,
      description: item.snippet,
    }))
  );
}

async function searchInternetForAI(userText = '') {
  const cleanText = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return [];

  const queries = buildJobSearchQueries(cleanText);

  const allResults = [];

  for (const query of queries.slice(0, 2)) {
    try {
      let results = [];

      if (process.env.BRAVE_SEARCH_API_KEY) {
        results = await searchWithBrave(query);
      } else if (process.env.BING_SEARCH_API_KEY) {
        results = await searchWithBing(query);
      }

      allResults.push(...results);
    } catch (error) {
      console.error('AI live search failed:', error?.message || error);
    }
  }

  return cleanSearchResults(allResults);
}

function buildJobApplicationSafetyRules() {
  return `
JOB SAFETY RULES:
- Never tell users a job is guaranteed.
- Never call a job "100% verified" unless it is from an official government/company careers page or a known job-board result provided in live context.
- Prefer links from official company websites, government websites, LinkedIn Jobs, PNet, Careers24, CareerJunction, Indeed, SAYouth, or DPSA.
- Warn users not to pay money for a job application, interview, training, medical check, uniform, or placement.
- Warn users to avoid WhatsApp-only recruiters, Gmail/Yahoo-only job emails pretending to be big companies, and links asking for banking PINs/passwords.
- For every job-search response, include:
  1. What to search
  2. Where to apply
  3. Safety checks before applying
  4. A copy-ready WhatsApp/email message if useful
`.trim();
}

function buildResearchContext({ userText, dateContext, liveResults = [] }) {
  const isJobPrompt = isJobSearchPrompt(userText);
  const location = extractJobLocation(userText);
  const jobType = extractJobType(userText);
  const verifiedLinks = buildVerifiedJobLinks(userText);

  const liveBlock = liveResults.length
    ? liveResults
        .map(
          (item, index) =>
            `${index + 1}. ${item.title}
URL: ${item.url}
Source type: ${item.sourceType}
Info: ${item.description || 'No description'}`
        )
        .join('\n\n')
    : 'No live search API results available. Use the safe fallback links below and tell the user to verify before applying.';

  const fallbackBlock = verifiedLinks
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}
URL: ${item.url}
Source type: ${item.sourceType}
Verification note: ${item.verification}`
    )
    .join('\n\n');

  return `
${dateContext.instruction}

USER QUESTION:
"${userText}"

DETECTED CONTEXT:
- Job-search prompt: ${isJobPrompt ? 'yes' : 'no'}
- Detected job type: ${jobType}
- Detected location: ${location}

LIVE WEB/JOB RESULTS:
${liveBlock}

SAFE VERIFIED JOB SEARCH LINKS:
${fallbackBlock}

${buildJobApplicationSafetyRules()}

FACE MEX WORKSPACE RESPONSE STYLE:
- Answer according to the user's exact question.
- If the user says "I'm looking for job around Tzaneen" or "jobs in Limpopo", immediately help them with job-search links, search terms, application steps, and safety checks.
- Do not say "I cannot browse" if live results are provided above.
- If live results are available, use them and include direct links.
- If live results are not available, say: "I can’t confirm live vacancies from here yet, but use these safe search links."
- Do not invent vacancies, salaries, closing dates, or company names.
- For each opportunity, separate what is confirmed from what the user must verify.
- Keep the answer practical and short enough for mobile.
- Use headings:
  Direct answer
  Best places to apply
  How to apply safely
  Copy-ready message
- Do not add a generic "Safety check" for normal questions unless it involves jobs, scams, payment, documents, or personal information.
`.trim();
}

function injectContextIntoAiBody(body, contextText) {
  if (!body || typeof body !== 'object') return body;

  if (body.__facemexRuntimeInjected === true) return body;

  const nextBody = {
    ...body,
    __facemexRuntimeInjected: true,
    facemexRuntimeContext: contextText,
  };

  if (Array.isArray(nextBody.messages)) {
    nextBody.messages = [
      {
        role: 'system',
        content: contextText,
      },
      ...nextBody.messages,
    ];

    return nextBody;
  }

  const userText = extractUserTextFromBody(nextBody);

  if (typeof nextBody.message === 'string') {
    nextBody.originalMessage = nextBody.message;
    nextBody.message = `${contextText}\n\nUSER QUESTION:\n${nextBody.message}`;
    return nextBody;
  }

  if (typeof nextBody.prompt === 'string') {
    nextBody.originalPrompt = nextBody.prompt;
    nextBody.prompt = `${contextText}\n\nUSER QUESTION:\n${nextBody.prompt}`;
    return nextBody;
  }

  if (typeof nextBody.question === 'string') {
    nextBody.originalQuestion = nextBody.question;
    nextBody.question = `${contextText}\n\nUSER QUESTION:\n${nextBody.question}`;
    return nextBody;
  }

  if (typeof nextBody.input === 'string') {
    nextBody.originalInput = nextBody.input;
    nextBody.input = `${contextText}\n\nUSER QUESTION:\n${nextBody.input}`;
    return nextBody;
  }

  if (userText) {
    nextBody.message = `${contextText}\n\nUSER QUESTION:\n${userText}`;
  }

  return nextBody;
}

async function facemexAiRuntimeMiddleware(req, _res, next) {
  try {
    const dateContext = getSouthAfricaDateContext();
    const userText = extractUserTextFromBody(req.body);

    req.facemexDateContext = dateContext;
    req.facemexUserText = userText;

    let liveResults = [];

    if (shouldAttachLiveResearch(userText)) {
      liveResults = await searchInternetForAI(userText);
    }

    const contextText = buildResearchContext({
      userText,
      dateContext,
      liveResults,
    });

    req.facemexAiContext = {
      dateContext,
      userText,
      liveResults,
      contextText,
      detectedLocation: extractJobLocation(userText),
      detectedJobType: extractJobType(userText),
      isJobPrompt: isJobSearchPrompt(userText),
    };

    req.body = injectContextIntoAiBody(req.body, contextText);

    next();
  } catch (error) {
    console.error('AI context middleware failed:', error?.message || error);
    next();
  }
}

async function translateText({ text, to = 'en', from }) {
  const cleanText = String(text || '').trim();

  if (!cleanText) {
    throw new Error('Text is required');
  }

  const key = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION;
  const endpoint = (
    process.env.AZURE_TRANSLATOR_ENDPOINT ||
    'https://api.cognitive.microsofttranslator.com'
  ).replace(/\/+$/, '');

  if (!key || !region) {
    throw new Error('Azure Translator is not configured');
  }

  const params = new URLSearchParams({
    'api-version': '3.0',
    to,
  });

  if (from) {
    params.set('from', from);
  }

  const response = await fetch(`${endpoint}/translate?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ text: cleanText }]),
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      'Translation failed';

    throw new Error(message);
  }

  const result = data?.[0];
  const translatedText = result?.translations?.[0]?.text || '';

  return {
    originalText: cleanText,
    translatedText,
    detectedLanguage: result?.detectedLanguage || null,
    to,
  };
}

app.use(helmet());
app.use(morgan('dev'));
app.use(cookieParser());

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

/*
  STRIPE WEBHOOK
  Must stay before express.json()
*/
if (process.env.STRIPE_SECRET_KEY) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
  });

  app.post(
    '/api/billing/webhook',
    bodyParser.raw({ type: 'application/json' }),
    (req, res) => {
      const sig = req.headers['stripe-signature'];

      if (!sig) return res.status(400).send('Missing Stripe signature');
      if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(200).send('ok');

      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          try {
            setMe({ tier: 'creator' });
          } catch {}
          break;
        }

        default:
          break;
      }

      return res.status(200).json({ received: true });
    }
  );
}

/*
  YOCO WEBHOOK
  Must stay before express.json()
*/
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

/*
  NORMAL BODY PARSERS
*/
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send('FaceMe API is running. See /health and /api/* endpoints.');
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'faceme-api',
    env: process.env.NODE_ENV || 'dev',
    dateContext: getSouthAfricaDateContext(),
  });
});

app.get('/persistence', (_req, res) => {
  res.json({
    ok: true,
    dbReady,
    sqliteError: lastError || null,
  });
});

app.get('/api/health', async (_req, res) => {
  let mongoConnected = false;

  try {
    const conn = await connectDb();
    mongoConnected = !!conn;
  } catch {
    mongoConnected = false;
  }

  const cloudinaryConfigured =
    !!process.env.CLOUDINARY_CLOUD_NAME &&
    !!process.env.CLOUDINARY_API_KEY &&
    !!process.env.CLOUDINARY_API_SECRET;

  const azureAccount =
    process.env.AZURE_STORAGE_ACCOUNT_NAME ||
    process.env.AZURE_STORAGE_ACCOUNT ||
    null;

  const azureContainer =
    process.env.AZURE_STORAGE_CONTAINER_NAME ||
    process.env.AZURE_STORAGE_CONTAINER ||
    null;

  const azurePublicUrl =
    process.env.AZURE_PUBLIC_BASE_URL ||
    process.env.AZURE_BLOB_PUBLIC_URL ||
    null;

  res.json({
    ok: true,
    dateContext: getSouthAfricaDateContext(),
    mongo: {
      configured: !!process.env.MONGODB_URI,
      connected: mongoConnected,
    },
    cloudinary: {
      configured: cloudinaryConfigured,
    },
    azureBlob: {
      configured:
        !!process.env.AZURE_STORAGE_CONNECTION_STRING &&
        !!azureAccount &&
        !!azureContainer,
      account: azureAccount,
      container: azureContainer,
      publicUrl: azurePublicUrl,
    },
    aiLiveSearch: {
      braveConfigured: !!process.env.BRAVE_SEARCH_API_KEY,
      bingConfigured: !!process.env.BING_SEARCH_API_KEY,
      enabled:
        !!process.env.BRAVE_SEARCH_API_KEY ||
        !!process.env.BING_SEARCH_API_KEY,
    },
    yoco: {
      secretKeyConfigured: !!process.env.YOCO_SECRET_KEY,
      webhookSecretConfigured: !!process.env.YOCO_WEBHOOK_SECRET,
      clientOrigin: process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || null,
    },
    stripe: {
      configured: !!process.env.STRIPE_SECRET_KEY,
      webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
    },
    translator: {
      configured:
        !!process.env.AZURE_TRANSLATOR_KEY &&
        !!process.env.AZURE_TRANSLATOR_REGION,
      region: process.env.AZURE_TRANSLATOR_REGION || null,
      endpoint:
        process.env.AZURE_TRANSLATOR_ENDPOINT ||
        'https://api.cognitive.microsofttranslator.com',
    },
    socket: {
      configured: true,
      onlineUsers: userSockets.size,
      activeCalls: activeCalls.size,
    },
  });
});

app.get('/api/ai/runtime-context', (_req, res) => {
  res.json({
    ok: true,
    dateContext: getSouthAfricaDateContext(),
    liveSearch: {
      braveConfigured: !!process.env.BRAVE_SEARCH_API_KEY,
      bingConfigured: !!process.env.BING_SEARCH_API_KEY,
      enabled:
        !!process.env.BRAVE_SEARCH_API_KEY ||
        !!process.env.BING_SEARCH_API_KEY,
    },
  });
});

app.get('/api/ai/job-search-links', async (req, res) => {
  const query = String(req.query.q || 'jobs South Africa').trim();
  const liveResults = shouldAttachLiveResearch(query)
    ? await searchInternetForAI(query)
    : [];

  res.json({
    ok: true,
    query,
    detectedLocation: extractJobLocation(query),
    detectedJobType: extractJobType(query),
    dateContext: getSouthAfricaDateContext(),
    liveResults,
    safeLinks: buildVerifiedJobLinks(query),
  });
});

/*
  API ROUTES
*/
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reactions', reactionsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/payments', paymentsRouter);

/*
  AI route receives:
  - real South Africa date
  - location/job intent
  - live web/job results if search key exists
  - safe verified job search links if no search key exists
*/
app.use('/api/ai', facemexAiRuntimeMiddleware, aiRouter);

app.use('/api/business', businessRouter);
app.use('/api/safety', safetyRouter);
app.use('/api/journal', journalRouter);
app.use('/api/stories', storiesRouter);
app.use('/api/status-stories', statusStoriesRouter);
app.use('/api/worlds', worldsRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/pro-groups', proGroupsRouter);
app.use('/api/marketplace', marketplaceRouter);

/*
  Put Azure uploads before the normal uploads router.
*/
app.use('/api/uploads/azure', azureUploadsRouter);
app.use('/api/uploads', uploadsRouter);

app.use('/api/translate', translateRouter);

/*
  REAL-TIME SOCKET SYSTEM
*/
io.on('connection', (socket) => {
  socket.emit('connected', {
    ok: true,
    socketId: socket.id,
  });

  socket.on('user:join', ({ userId } = {}) => {
    const id = String(userId || '').trim();
    if (!id) return;

    socket.data.userId = id;
    socket.join(`user:${id}`);
    addUserSocket(id, socket.id);

    socket.emit('user:joined', {
      ok: true,
      userId: id,
      socketId: socket.id,
    });
  });

  socket.on('call:invite', (payload = {}) => {
    const {
      toUserId,
      fromUserId,
      fromUser,
      callType = 'video',
    } = payload;

    const callerId = String(fromUserId || socket.data.userId || '').trim();
    const receiverId = String(toUserId || '').trim();

    if (!callerId || !receiverId) {
      socket.emit('call:error', {
        message: 'Missing caller or receiver.',
      });
      return;
    }

    if (callerId === receiverId) {
      socket.emit('call:error', {
        message: 'You cannot call yourself.',
      });
      return;
    }

    const receiverOnline = userSockets.has(receiverId);

    if (!receiverOnline) {
      socket.emit('call:unavailable', {
        toUserId: receiverId,
        message: 'User is not online.',
      });
      return;
    }

    const callId = makeId('call');
    const roomId = `call-room:${callId}`;

    const call = {
      callId,
      roomId,
      callerId,
      receiverId,
      callType: callType === 'audio' ? 'audio' : 'video',
      fromUser: fromUser || null,
      status: 'ringing',
      createdAt: new Date().toISOString(),
    };

    activeCalls.set(callId, call);

    socket.join(roomId);

    sendToUser(receiverId, 'call:incoming', {
      callId,
      roomId,
      fromUserId: callerId,
      fromUser: fromUser || null,
      callType: call.callType,
      createdAt: call.createdAt,
    });

    socket.emit('call:ringing', {
      callId,
      roomId,
      toUserId: receiverId,
      callType: call.callType,
    });
  });

  socket.on('call:accept', (payload = {}) => {
    const { callId, userId } = payload;

    if (!callId || !activeCalls.has(callId)) {
      socket.emit('call:error', {
        message: 'Call no longer exists.',
      });
      return;
    }

    const call = activeCalls.get(callId);
    const acceptingUserId = String(userId || socket.data.userId || '').trim();

    if (acceptingUserId) {
      socket.data.userId = acceptingUserId;
      socket.join(`user:${acceptingUserId}`);
      addUserSocket(acceptingUserId, socket.id);
    }

    socket.join(call.roomId);

    call.status = 'accepted';
    call.acceptedAt = new Date().toISOString();

    activeCalls.set(callId, call);

    io.to(call.roomId).emit('call:accepted', {
      callId: call.callId,
      roomId: call.roomId,
      callerId: call.callerId,
      receiverId: call.receiverId,
      callType: call.callType,
      acceptedBy: acceptingUserId || call.receiverId,
    });
  });

  socket.on('call:decline', (payload = {}) => {
    const { callId, userId, reason } = payload;

    if (!callId || !activeCalls.has(callId)) return;

    const call = activeCalls.get(callId);
    const declinedBy = userId || socket.data.userId || call.receiverId;

    sendToUser(call.callerId, 'call:declined', {
      callId,
      roomId: call.roomId,
      declinedBy,
      reason: reason || 'declined',
    });

    sendToUser(call.receiverId, 'call:declined', {
      callId,
      roomId: call.roomId,
      declinedBy,
      reason: reason || 'declined',
    });

    activeCalls.delete(callId);
  });

  socket.on('call:reject', (payload = {}) => {
    const { callId, userId, reason } = payload;

    if (!callId || !activeCalls.has(callId)) return;

    const call = activeCalls.get(callId);
    const rejectedBy = userId || socket.data.userId || call.receiverId;

    sendToUser(call.callerId, 'call:declined', {
      callId,
      roomId: call.roomId,
      declinedBy: rejectedBy,
      reason: reason || 'rejected',
    });

    sendToUser(call.receiverId, 'call:declined', {
      callId,
      roomId: call.roomId,
      declinedBy: rejectedBy,
      reason: reason || 'rejected',
    });

    activeCalls.delete(callId);
  });

  socket.on('call:cancel', (payload = {}) => {
    const { callId, userId } = payload;

    if (!callId || !activeCalls.has(callId)) return;

    const call = activeCalls.get(callId);
    const cancelledBy = userId || socket.data.userId || call.callerId;

    sendToUser(call.receiverId, 'call:cancelled', {
      callId,
      roomId: call.roomId,
      cancelledBy,
    });

    sendToUser(call.callerId, 'call:cancelled', {
      callId,
      roomId: call.roomId,
      cancelledBy,
    });

    activeCalls.delete(callId);
  });

  socket.on('call:join', ({ roomId, callId, userId } = {}) => {
    const finalRoomId = getCallRoom({ roomId, callId });

    if (!finalRoomId) return;

    const id = String(userId || socket.data.userId || '').trim();

    if (id) {
      socket.data.userId = id;
      socket.join(`user:${id}`);
      addUserSocket(id, socket.id);
    }

    socket.join(finalRoomId);

    socket.to(finalRoomId).emit('call:joined', {
      callId: callId || null,
      roomId: finalRoomId,
      userId: id || null,
      socketId: socket.id,
    });
  });

  socket.on('call:offer', (payload = {}) => {
    const roomId = getCallRoom(payload);
    const { offer, fromUserId } = payload;

    if (!roomId || !offer) return;

    socket.to(roomId).emit('call:offer', {
      callId: payload.callId || null,
      roomId,
      offer,
      fromUserId: fromUserId || socket.data.userId || null,
      from: socket.id,
    });
  });

  socket.on('call:answer', (payload = {}) => {
    const roomId = getCallRoom(payload);
    const { answer, fromUserId } = payload;

    if (!roomId || !answer) return;

    socket.to(roomId).emit('call:answer', {
      callId: payload.callId || null,
      roomId,
      answer,
      fromUserId: fromUserId || socket.data.userId || null,
      from: socket.id,
    });
  });

  socket.on('call:candidate', (payload = {}) => {
    const roomId = getCallRoom(payload);
    const { candidate, fromUserId } = payload;

    if (!roomId || !candidate) return;

    socket.to(roomId).emit('call:candidate', {
      callId: payload.callId || null,
      roomId,
      candidate,
      fromUserId: fromUserId || socket.data.userId || null,
      from: socket.id,
    });
  });

  socket.on('call:ice-candidate', (payload = {}) => {
    const roomId = getCallRoom(payload);
    const { candidate, fromUserId } = payload;

    if (!roomId || !candidate) return;

    socket.to(roomId).emit('call:candidate', {
      callId: payload.callId || null,
      roomId,
      candidate,
      fromUserId: fromUserId || socket.data.userId || null,
      from: socket.id,
    });
  });

  socket.on('call:media-toggle', (payload = {}) => {
    const roomId = getCallRoom(payload);

    if (!roomId) return;

    socket.to(roomId).emit('call:media-toggle', {
      callId: payload.callId || null,
      roomId,
      userId: payload.userId || socket.data.userId || null,
      audioEnabled: payload.audioEnabled,
      videoEnabled: payload.videoEnabled,
    });
  });

  socket.on('call:translation-toggle', (payload = {}) => {
    const roomId = getCallRoom(payload);

    if (!roomId) return;

    socket.to(roomId).emit('call:translation-toggle', {
      callId: payload.callId || null,
      roomId,
      userId: payload.userId || socket.data.userId || null,
      enabled: !!payload.enabled,
      language: payload.language || 'en',
    });
  });

  socket.on('call:translate', async (payload = {}) => {
    const roomId = getCallRoom(payload);

    if (!roomId) {
      socket.emit('call:translation-error', {
        message: 'Missing call room.',
      });
      return;
    }

    try {
      const result = await translateText({
        text: payload.text,
        to: payload.to || 'en',
        from: payload.from || undefined,
      });

      const translationPayload = {
        callId: payload.callId || null,
        roomId,
        fromUserId: payload.fromUserId || socket.data.userId || null,
        originalText: result.originalText,
        translatedText: result.translatedText,
        detectedLanguage: result.detectedLanguage,
        to: result.to,
        createdAt: new Date().toISOString(),
      };

      io.to(roomId).emit('call:translation', translationPayload);
    } catch (error) {
      socket.emit('call:translation-error', {
        callId: payload.callId || null,
        roomId,
        message: error.message || 'Translation failed',
      });
    }
  });

  socket.on('call:end', (payload = {}) => {
    const roomId = getCallRoom(payload);
    const { callId, fromUserId } = payload;

    if (!roomId) return;

    io.to(roomId).emit('call:end', {
      callId: callId || null,
      roomId,
      fromUserId: fromUserId || socket.data.userId || null,
      from: socket.id,
    });

    if (callId) {
      activeCalls.delete(callId);
    }

    try {
      socket.leave(roomId);
    } catch {}
  });

  socket.on('story:join', ({ code, userId } = {}) => {
    if (!code) return;

    socket.join(code);

    socket.to(code).emit('story:joined', {
      userId,
      socketId: socket.id,
    });
  });

  socket.on('story:add-step', ({ code, text, userId } = {}) => {
    if (!code || !text) return;

    socket.to(code).emit('story:step', {
      text,
      userId: userId || null,
      createdAt: new Date().toISOString(),
    });
  });

  socket.on('world:join', ({ worldId, user } = {}) => {
    if (!worldId) return;

    socket.join(`world:${worldId}`);

    const u = user || { id: socket.id };

    if (!worldPresence.has(worldId)) {
      worldPresence.set(worldId, new Map());
    }

    const map = worldPresence.get(worldId);

    const existing = map.get(u.id) || {
      user: u,
      avatar: null,
      socketIds: new Set(),
    };

    existing.user = u;
    existing.socketIds.add(socket.id);
    map.set(u.id, existing);

    const snapshot = Array.from(map.entries()).map(([uid, v]) => ({
      userId: uid,
      user: v.user,
      avatar: v.avatar,
    }));

    socket.emit('world:presence:snapshot', {
      worldId,
      peers: snapshot,
    });

    socket.to(`world:${worldId}`).emit('world:presence:join', {
      user: u,
      socketId: socket.id,
      ts: new Date().toISOString(),
    });
  });

  socket.on('world:leave', ({ worldId, user } = {}) => {
    if (!worldId) return;

    try {
      socket.leave(`world:${worldId}`);
    } catch {}

    const u = user || { id: socket.id };
    const map = worldPresence.get(worldId);

    if (map) {
      const entry = map.get(u.id);

      if (entry) {
        entry.socketIds.delete(socket.id);

        if (entry.socketIds.size === 0) {
          map.delete(u.id);
        }
      }

      if (map.size === 0) {
        worldPresence.delete(worldId);
      }
    }

    socket.to(`world:${worldId}`).emit('world:presence:leave', {
      user: u,
      socketId: socket.id,
      ts: new Date().toISOString(),
    });
  });

  socket.on('world:avatar:update', ({ worldId, userId, avatar } = {}) => {
    if (!worldId || !userId) return;

    const map = worldPresence.get(worldId);

    if (map) {
      const entry = map.get(userId) || {
        user: { id: userId },
        avatar: null,
        socketIds: new Set([socket.id]),
      };

      entry.avatar = avatar || null;
      map.set(userId, entry);
    }

    socket.to(`world:${worldId}`).emit('world:avatar:updated', {
      userId,
      avatar,
      ts: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    const userId = socket.data.userId;

    if (userId) {
      removeUserSocket(String(userId), socket.id);
    }

    for (const [callId, call] of activeCalls.entries()) {
      const callerOffline =
        call.callerId && !userSockets.has(String(call.callerId));

      const receiverOffline =
        call.receiverId && !userSockets.has(String(call.receiverId));

      if (callerOffline || receiverOffline) {
        io.to(call.roomId).emit('call:end', {
          callId,
          roomId: call.roomId,
          reason: 'peer-disconnected',
        });

        cleanupCall(callId, 'peer-disconnected');
      }
    }

    for (const [worldId, map] of worldPresence.entries()) {
      for (const [uid, entry] of map.entries()) {
        if (entry.socketIds.has(socket.id)) {
          entry.socketIds.delete(socket.id);

          if (entry.socketIds.size === 0) {
            map.delete(uid);

            socket.to(`world:${worldId}`).emit('world:presence:leave', {
              user: entry.user,
              socketId: socket.id,
              ts: new Date().toISOString(),
            });
          }
        }
      }

      if (map.size === 0) {
        worldPresence.delete(worldId);
      }
    }
  });
});

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    const conn = await connectDb();

    if (conn) {
      console.log('✅ MongoDB connected');
    } else {
      console.log('⚠️ MongoDB not configured; server will run with limited persistence');
    }
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err?.message || err);
    console.log('⚠️ Server will still run, but Mongo persistence may not work');
  }
})();

server.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);

  try {
    const { initAI } = await import('./services/aiService.js');
    await initAI();
    console.log('✅ DeepSeek AI initialized successfully');
  } catch (err) {
    console.error('❌ Failed to initialize AI:', err.message);
    console.log('⚠️ Server is running, but AI features may not work');
  }
});
