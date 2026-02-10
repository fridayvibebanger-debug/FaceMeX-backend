import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'app.db');

let Database = null;
let db = null;
export let dbReady = false;
export let lastError = null;

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
}

export async function initSqlite() {
  if (dbReady) return true;
  try {
    // dynamic import to avoid crash when module not installed
    const mod = await import('better-sqlite3');
    Database = mod.default || mod;
  } catch (e) {
    lastError = `load-error: ${e?.message || e}`;
    dbReady = false;
    return false;
  }
  await ensureDir();
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    migrate();
    dbReady = true;
    lastError = null;
    return true;
  } catch (e) {
    lastError = `open-error: ${e?.message || e}`;
    dbReady = false;
    return false;
  }
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT,
      avatar TEXT,
      content TEXT,
      image TEXT,
      images TEXT,
      audio TEXT,
      createdAt TEXT,
      mode TEXT
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      postId TEXT,
      userId TEXT,
      PRIMARY KEY (postId, userId)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      postId TEXT,
      userId TEXT,
      userName TEXT,
      text TEXT,
      createdAt TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      coverImage TEXT,
      hostId TEXT,
      hostName TEXT,
      hostAvatar TEXT,
      startTime TEXT,
      endTime TEXT,
      location TEXT,
      type TEXT,
      attendeeCount INTEGER,
      maxAttendees INTEGER,
      isPaid INTEGER,
      price REAL
    );
    CREATE TABLE IF NOT EXISTS event_tags (
      eventId TEXT,
      tag TEXT,
      PRIMARY KEY (eventId, tag)
    );
    CREATE TABLE IF NOT EXISTS attendees (
      eventId TEXT,
      userId TEXT,
      PRIMARY KEY (eventId, userId)
    );
  `);
  // Ensure 'mode' column exists on existing DBs
  try {
    const cols = db.prepare(`PRAGMA table_info(posts)`).all();
    const hasMode = cols.some(c => (c.name || '').toLowerCase() === 'mode');
    const hasAudio = cols.some(c => (c.name || '').toLowerCase() === 'audio');
    const hasImages = cols.some(c => (c.name || '').toLowerCase() === 'images');
    if (!hasMode) {
      db.prepare(`ALTER TABLE posts ADD COLUMN mode TEXT`).run();
      // Backfill existing rows to 'social'
      db.prepare(`UPDATE posts SET mode='social' WHERE mode IS NULL OR mode=''`).run();
    }
    if (!hasAudio) {
      db.prepare(`ALTER TABLE posts ADD COLUMN audio TEXT`).run();
      db.prepare(`UPDATE posts SET audio='' WHERE audio IS NULL`).run();
    }
    if (!hasImages) {
      db.prepare(`ALTER TABLE posts ADD COLUMN images TEXT`).run();
      db.prepare(`UPDATE posts SET images='' WHERE images IS NULL`).run();
    }
  } catch {}
}

// Posts repo
export const postsRepo = {
  get _db() {
    return db;
  },
  list() {
    const rows = db.prepare(`SELECT * FROM posts ORDER BY datetime(createdAt) DESC`).all();
    return rows.map((p) => ({
      ...p,
      mode: p.mode === 'professional' ? 'professional' : 'social',
      images: (() => {
        try {
          const raw = p.images || '';
          if (!raw) return p.image ? [p.image].filter(Boolean) : [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 5) : (p.image ? [p.image].filter(Boolean) : []);
        } catch {
          return p.image ? [p.image].filter(Boolean) : [];
        }
      })(),
      likes: db.prepare(`SELECT COUNT(*) as c FROM post_likes WHERE postId=?`).get(p.id).c,
      likedBy: db.prepare(`SELECT userId FROM post_likes WHERE postId=?`).all(p.id).map(r=>r.userId),
      comments: db.prepare(`SELECT * FROM comments WHERE postId=? ORDER BY datetime(createdAt) ASC`).all(p.id),
    }));
  },
  create({ id, userId, userName, avatar, content, image, images, audio, mode }) {
    const m = mode === 'professional' ? 'professional' : 'social'
    const safeImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 5) : [];
    const firstImage = (safeImages[0] || image || '');
    db.prepare(`INSERT INTO posts (id,userId,userName,avatar,content,image,images,createdAt,mode) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, userId, userName, avatar, content, firstImage || '', JSON.stringify(safeImages), new Date().toISOString(), m
    );
    try {
      db.prepare(`UPDATE posts SET audio=? WHERE id=?`).run(audio || '', id);
    } catch {}
    return this.get(id);
  },
  get(id) {
    const p = db.prepare(`SELECT * FROM posts WHERE id=?`).get(id);
    if (!p) return null;
    return {
      ...p,
      mode: p.mode === 'professional' ? 'professional' : 'social',
      images: (() => {
        try {
          const raw = p.images || '';
          if (!raw) return p.image ? [p.image].filter(Boolean) : [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 5) : (p.image ? [p.image].filter(Boolean) : []);
        } catch {
          return p.image ? [p.image].filter(Boolean) : [];
        }
      })(),
      likes: db.prepare(`SELECT COUNT(*) as c FROM post_likes WHERE postId=?`).get(id).c,
      likedBy: db.prepare(`SELECT userId FROM post_likes WHERE postId=?`).all(id).map(r=>r.userId),
      comments: db.prepare(`SELECT * FROM comments WHERE postId=? ORDER BY datetime(createdAt) ASC`).all(id),
    };
  },
  toggleLike(postId, userId) {
    const exists = db.prepare(`SELECT 1 FROM post_likes WHERE postId=? AND userId=?`).get(postId, userId);
    if (exists) {
      db.prepare(`DELETE FROM post_likes WHERE postId=? AND userId=?`).run(postId, userId);
    } else {
      db.prepare(`INSERT INTO post_likes (postId,userId) VALUES (?,?)`).run(postId, userId);
    }
    return this.get(postId);
  },
  addComment(postId, { id, userId, userName, text }) {
    db.prepare(`INSERT INTO comments (id,postId,userId,userName,text,createdAt) VALUES (?,?,?,?,?,?)`).run(
      id, postId, userId, userName, text, new Date().toISOString()
    );
    return db.prepare(`SELECT * FROM comments WHERE id=?`).get(id);
  },
  editComment(commentId, text) {
    db.prepare(`UPDATE comments SET text=? WHERE id=?`).run(text, commentId);
    return db.prepare(`SELECT * FROM comments WHERE id=?`).get(commentId);
  },
  deleteComment(commentId) {
    const c = db.prepare(`SELECT * FROM comments WHERE id=?`).get(commentId);
    if (c) db.prepare(`DELETE FROM comments WHERE id=?`).run(commentId);
    return c;
  }
};

// Events repo
export const eventsRepo = {
  list() {
    const rows = db.prepare(`SELECT * FROM events ORDER BY datetime(startTime) ASC`).all();
    return rows.map((e) => ({
      ...e,
      isAttending: !!db.prepare(`SELECT 1 FROM attendees WHERE eventId=? AND userId=?`).get(e.id, '1'),
      tags: db.prepare(`SELECT tag FROM event_tags WHERE eventId=?`).all(e.id).map(r=>r.tag),
    }));
  },
  create(ev) {
    db.prepare(`INSERT INTO events (id,title,description,coverImage,hostId,hostName,hostAvatar,startTime,endTime,location,type,attendeeCount,maxAttendees,isPaid,price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      ev.id, ev.title, ev.description, ev.coverImage||'', ev.hostId||'1', ev.hostName||'User', ev.hostAvatar||'', ev.startTime, ev.endTime, ev.location||'TBD', ev.type||'virtual', 1, ev.maxAttendees||null, ev.isPaid?1:0, ev.price||null
    );
    const insertTag = db.prepare(`INSERT OR IGNORE INTO event_tags (eventId, tag) VALUES (?,?)`);
    (ev.tags||[]).forEach(t=> insertTag.run(ev.id, t));
    db.prepare(`INSERT OR IGNORE INTO attendees (eventId,userId) VALUES (?,?)`).run(ev.id, '1');
    return this.get(ev.id);
  },
  get(id) {
    const e = db.prepare(`SELECT * FROM events WHERE id=?`).get(id);
    if (!e) return null;
    return {
      ...e,
      isAttending: !!db.prepare(`SELECT 1 FROM attendees WHERE eventId=? AND userId=?`).get(id, '1'),
      tags: db.prepare(`SELECT tag FROM event_tags WHERE eventId=?`).all(id).map(r=>r.tag),
    };
  },
  attend(id, userId) {
    db.prepare(`INSERT OR IGNORE INTO attendees (eventId,userId) VALUES (?,?)`).run(id, userId);
    db.prepare(`UPDATE events SET attendeeCount = (SELECT COUNT(*) FROM attendees WHERE eventId=?) WHERE id=?`).run(id, id);
    return this.get(id);
  },
  unattend(id, userId) {
    db.prepare(`DELETE FROM attendees WHERE eventId=? AND userId=?`).run(id, userId);
    db.prepare(`UPDATE events SET attendeeCount = (SELECT COUNT(*) FROM attendees WHERE eventId=?) WHERE id=?`).run(id, id);
    return this.get(id);
  }
};
