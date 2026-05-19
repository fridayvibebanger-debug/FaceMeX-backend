import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import Stripe from 'stripe';
import bodyParser from 'body-parser';
import { setMe } from './utils/userStore.js';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { connectDb } from './lib/db.js';

import usersRouter from './routes/users.js';
import postsRouter from './routes/posts.js';
import eventsRouter from './routes/events.js';
import notificationsRouter from './routes/notifications.js';
import reactionsRouter from './routes/reactions.js';
import { dbReady, lastError } from './utils/sqlite.js';
import billingRouter from './routes/billing.js';
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
import uploadsRouter from './routes/uploads.js';

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
});

app.set('io', io);

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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.type('text/plain').send('FaceMe API is running. See /health and /api/* endpoints.');
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'faceme-api',
    env: process.env.NODE_ENV || 'dev',
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

  res.json({
    ok: true,
    mongo: {
      configured: !!process.env.MONGODB_URI,
      connected: mongoConnected,
    },
    cloudinary: {
      configured: cloudinaryConfigured,
    },
  });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reactions', reactionsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/ai', aiRouter);
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
app.use('/api/uploads', uploadsRouter);

const worldPresence = new Map();

io.on('connection', (socket) => {
  socket.emit('connected', { ok: true });

  socket.on('user:join', ({ userId }) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
  });

  socket.on('call:join', ({ roomId, userId }) => {
    if (!roomId) return;
    socket.join(roomId);
    socket.to(roomId).emit('call:joined', { userId, socketId: socket.id });
  });

  socket.on('call:offer', ({ roomId, offer, from }) => {
    if (!roomId || !offer) return;
    socket.to(roomId).emit('call:offer', { offer, from: from || socket.id });
  });

  socket.on('call:answer', ({ roomId, answer, from }) => {
    if (!roomId || !answer) return;
    socket.to(roomId).emit('call:answer', { answer, from: from || socket.id });
  });

  socket.on('call:candidate', ({ roomId, candidate, from }) => {
    if (!roomId || !candidate) return;
    socket.to(roomId).emit('call:candidate', { candidate, from: from || socket.id });
  });

  socket.on('call:end', ({ roomId, from }) => {
    if (!roomId) return;
    socket.to(roomId).emit('call:end', { from: from || socket.id });
  });

  socket.on('story:join', ({ code, userId }) => {
    if (!code) return;
    socket.join(code);
    socket.to(code).emit('story:joined', { userId, socketId: socket.id });
  });

  socket.on('story:add-step', ({ code, text, userId }) => {
    if (!code || !text) return;
    socket.to(code).emit('story:step', {
      text,
      userId: userId || null,
      createdAt: new Date().toISOString(),
    });
  });

  socket.on('world:join', ({ worldId, user }) => {
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

  socket.on('world:leave', ({ worldId, user }) => {
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

  socket.on('world:avatar:update', ({ worldId, userId, avatar }) => {
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
