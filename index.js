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
import mexaRouter from './routes/mexa.js';
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
import youtubeRouter from './routes/youtube.js';


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
  'https://privatebeta8.netlify.app',
  'http://localhost:5173',
  process.env.CLIENT_ORIGIN,
  process.env.FRONTEND_URL,
  process.env.NETLIFY_URL,
].filter(Boolean);

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
  DATE CONTEXT
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
    readableDateTime,
    shortDate,
    isoDate,
  };
}

/*
  LIGHT JOB LINK HELPERS
  Main AI logic stays inside routes/ai.js.
*/
function extractLocation(text = '') {
  const t = String(text || '').toLowerCase();

  const locations = [
    'tzaneen',
    'limpopo',
    'polokwane',
    'lenyenye',
    'nkowankowa',
    'maake plaza',
    'maake',
    'giyani',
    'phalaborwa',
    'modjadjiskloof',
    'mankweng',
    'mokopane',
    'thohoyandou',
    'burgersdorp',
    'hoedspruit',
    'secunda',
    'gauteng',
    'johannesburg',
    'pretoria',
    'durban',
    'cape town',
    'south africa',
  ];

  const found = locations.find((loc) => t.includes(loc));

  if (!found) return 'South Africa';

  return found
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractJobType(text = '') {
  const t = String(text || '').toLowerCase();

  const jobTypes = [
    'inspector in training',
    'general worker',
    'cleaner',
    'admin clerk',
    'admin',
    'administrative',
    'clerk',
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
    'store assistant',
    'teacher assistant',
    'nurse',
    'clinic',
    'municipality',
    'government',
    'restaurant',
    'griller',
    'packer',
    'merchandiser',
  ];

  const found = jobTypes.find((job) => t.includes(job));
  return found || 'jobs';
}

function makeSearchUrl(base, params) {
  const url = new URL(base);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function buildClickableJobLinks(userText = '') {
  const location = extractLocation(userText);
  const jobType = extractJobType(userText);
  const query = `${jobType} ${location}`;

  return [
    {
      name: 'Indeed',
      label: `Indeed ${location} jobs`,
      url: makeSearchUrl('https://za.indeed.com/jobs', {
        q: query,
        l: location,
      }),
      note: 'Good for general workers, admin, retail, cleaning, drivers, restaurants, and entry-level jobs.',
    },
    {
      name: 'LinkedIn',
      label: `LinkedIn ${location} jobs`,
      url: makeSearchUrl('https://www.linkedin.com/jobs/search/', {
        keywords: query,
        location,
      }),
      note: 'Good for company-posted jobs, admin, office, sales, professional and retail roles.',
    },
    {
      name: 'PNet',
      label: 'PNet South Africa jobs',
      url: 'https://www.pnet.co.za/jobs',
      note: 'Search your job title and location inside the site.',
    },
    {
      name: 'Careers24',
      label: 'Careers24 jobs',
      url: 'https://www.careers24.com/jobs/',
      note: 'Useful for South African vacancies across many industries.',
    },
    {
      name: 'CareerJunction',
      label: 'CareerJunction jobs',
      url: 'https://www.careerjunction.co.za/jobs',
      note: 'Good for admin, sales, finance, office, IT, and skilled roles.',
    },
    {
      name: 'DPSA',
      label: 'DPSA government vacancies',
      url: 'https://www.dpsa.gov.za/newsroom/psvc/',
      note: 'Official South African government vacancy circulars.',
    },
    {
      name: 'SAYouth',
      label: 'SAYouth opportunities',
      url: 'https://sayouth.mobi/',
      note: 'Good for youth opportunities, learning programmes, entry-level work, and support.',
    },
    {
      name: 'ESSA',
      label: 'ESSA Department of Employment and Labour',
      url: 'https://essa.labour.gov.za/EssaOnline/WebBeans/',
      note: 'Official employment services platform from the Department of Employment and Labour.',
    },
  ];
}

/*
  TRANSLATION HELPER
*/
async function translateText({ text, to = 'en', from }) {
  const cleanTextValue = String(text || '').trim();

  if (!cleanTextValue) {
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
    body: JSON.stringify([{ text: cleanTextValue }]),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || data?.message || 'Translation failed';
    throw new Error(message);
  }

  const result = data?.[0];
  const translatedText = result?.translations?.[0]?.text || '';

  return {
    originalText: cleanTextValue,
    translatedText,
    detectedLanguage: result?.detectedLanguage || null,
    to,
  };
}

/*
  GLOBAL MIDDLEWARE
*/
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
  Increased to 35mb so FaceMeX Workspace can receive up to 4 compressed images.
*/
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

/*
  HEALTH + PING ROUTES
*/
app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send('FaceMe API is running. See /health, /api/ping and /api/* endpoints.');
});

app.get('/api/ping', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'FaceMeX backend',
    status: 'online',
    time: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'faceme-api',
    env: process.env.NODE_ENV || 'dev',
    status: 'online',
    time: new Date().toISOString(),
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
    service: 'faceme-api',
    status: 'online',
    time: new Date().toISOString(),
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
    aiWorkspace: {
      controlledBy: 'routes/ai.js',
      dateAware: true,
      generalQuestions: true,
      facemexKnowledge: true,
      postSafetyChecks: true,
      imageAnalysis: true,
      visionConfigured: !!(
        process.env.OPENAI_VISION_API_KEY || process.env.OPENAI_API_KEY
      ),
      visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      clickableJobLinks: true,
      liveBrowsing: false,
      maxJsonPayload: '35mb',
      note:
        'AI answers and image analysis are handled in routes/ai.js. Frontend can send imageDataUrls/images to /api/ai/pro/job-assistant.',
    },
    youtube: {
      configured: !!process.env.YOUTUBE_API_KEY,
      route: '/api/youtube/search?q=grade%2012%20maths',
      purpose:
        'Used for FaceMeX education videos, lessons, investor videos, grant explainers, and learning content.',
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
    aiWorkspace: {
      controlledBy: 'routes/ai.js',
      dateAware: true,
      generalQuestions: true,
      facemexKnowledge: true,
      postSafetyChecks: true,
      imageAnalysis: true,
      visionConfigured: !!(
        process.env.OPENAI_VISION_API_KEY || process.env.OPENAI_API_KEY
      ),
      visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      clickableJobLinks: true,
      liveBrowsing: false,
      maxJsonPayload: '35mb',
    },
    youtube: {
      configured: !!process.env.YOUTUBE_API_KEY,
      searchRoute: '/api/youtube/search',
    },
  });
});

app.get('/api/ai/job-search-links', (req, res) => {
  const query = String(req.query.q || 'jobs South Africa').trim();

  res.json({
    ok: true,
    query,
    detectedLocation: extractLocation(query),
    detectedJobType: extractJobType(query),
    dateContext: getSouthAfricaDateContext(),
    links: buildClickableJobLinks(query),
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
  IMPORTANT:
  AI prompt style, FaceMeX knowledge, job answers, date answers,
  image analysis, and post safety checks are handled inside routes/ai.js.
  Do not inject templates here.
*/
app.use('/api/ai', aiRouter);
app.use('/api/mexa', mexaRouter);

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

app.use('/api/uploads/azure', azureUploadsRouter);
app.use('/api/uploads', uploadsRouter);

app.use('/api/translate', translateRouter);
app.use('/api/youtube', youtubeRouter);

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
          map.delete(uid);
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
