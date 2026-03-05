import { Router } from 'express';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { initSqlite, dbReady, postsRepo } from '../utils/sqlite.js';

const router = Router();

// In-memory mock posts
let posts = [
  {
    id: 'p1',
    userId: '1',
    userName: 'Demo User',
    avatar: '',
    content: 'Hello FaceMe! 🚀',
    image: '',
    images: [],
    likedBy: [],
    comments: [],
    createdAt: new Date().toISOString(),
    mode: 'social',
  },
];

// Initialize SQLite if available; otherwise load JSON fallback
await initSqlite();
if (!dbReady) {
  posts = (await loadJSON('posts.json', posts)) || posts;
}

router.get('/', (req, res) => {
  const mode = req.query.mode === 'professional' ? 'professional' : (req.query.mode === 'social' ? 'social' : null);
  const skillRaw = (req.query.skill || '').toString().trim();
  const skill = skillRaw ? skillRaw.toLowerCase() : '';
  const matchesSkill = (content = '') => {
    if (!skill) return true;
    const c = String(content).toLowerCase();
    return c.includes(`#${skill}`) || c.split(/[^a-z0-9+#]/i).includes(skill);
  };
  if (dbReady) {
    const list = postsRepo.list();
    const normalized = list.map((p) => ({ ...p, mode: p.mode === 'professional' ? 'professional' : 'social' }));
    let filtered = mode ? normalized.filter((p) => p.mode === mode) : normalized;
    if (skill) filtered = filtered.filter((p) => p.mode === 'professional' && matchesSkill(p.content));
    return res.json(filtered);
  }
  // JSON fallback
  const shaped = posts.map((p) => ({
    ...p,
    mode: p.mode === 'professional' ? 'professional' : 'social',
    likes: Array.isArray(p.likedBy) ? p.likedBy.length : (p.likes || 0),
  }));
  let filtered = mode ? shaped.filter((p) => p.mode === mode) : shaped;
  if (skill) filtered = filtered.filter((p) => p.mode === 'professional' && matchesSkill(p.content));
  res.json(filtered);
});

router.post('/', (req, res) => {
  const { content, image, images, audio, mode } = req.body;
  const safeImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 5) : [];
  const firstImage = (safeImages[0] || image || '');
  const id = `p${Date.now()}`;
  if (dbReady) {
    const created = postsRepo.create({
      id,
      userId: '1',
      userName: 'Demo User',
      avatar: '',
      content: content || '',
      image: firstImage || '',
      images: safeImages,
      audio: audio || '',
      mode: mode === 'professional' ? 'professional' : 'social'
    });
    return res.status(201).json({ ...created });
  }
  const post = {
    id,
    userId: '1',
    userName: 'Demo User',
    avatar: '',
    content: content || '',
    image: firstImage || '',
    images: safeImages,
    audio: audio || '',
    likedBy: [],
    comments: [],
    createdAt: new Date().toISOString(),
    mode: mode === 'professional' ? 'professional' : 'social'
  };
  posts.unshift(post);
  saveJSON('posts.json', posts).catch(() => {});
  res.status(201).json({ ...post, likes: 0 });
});

router.post('/:id/like', (req, res) => {
  const { id } = req.params;
  const userId = '1'; // demo user
  if (dbReady) {
    const updated = postsRepo.toggleLike(id, userId);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json(updated);
  }
  const p = posts.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!Array.isArray(p.likedBy)) p.likedBy = [];
  const idx = p.likedBy.indexOf(userId);
  if (idx === -1) p.likedBy.push(userId); else p.likedBy.splice(idx, 1);
  saveJSON('posts.json', posts).catch(() => {});
  res.json({ ...p, likes: p.likedBy.length });
});

router.post('/:id/comment', (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  if (dbReady) {
    const c = postsRepo.addComment(id, { id: `c${Date.now()}`, userId: '1', userName: 'Demo User', text: text || '' });
    if (!c) return res.status(404).json({ error: 'Not found' });
    return res.status(201).json(c);
  }
  const p = posts.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const c = { id: `c${Date.now()}`, userId: '1', userName: 'Demo User', text: text || '', createdAt: new Date().toISOString() };
  p.comments.push(c);
  saveJSON('posts.json', posts).catch(() => {});
  res.status(201).json(c);
});

// Edit a post (owner only)
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = '1';
  const nextContent = (content || '').toString();

  if (dbReady) {
    const p = postsRepo.get(id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (String(p.userId || '') !== String(userId)) return res.status(403).json({ error: 'Forbidden' });
    // simple update without adding a new repo function
    postsRepo._db.prepare(`UPDATE posts SET content=? WHERE id=?`).run(nextContent, id);
    const updated = postsRepo.get(id);
    return res.json(updated);
  }

  const p = posts.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (String(p.userId || '') !== String(userId)) return res.status(403).json({ error: 'Forbidden' });
  p.content = nextContent || p.content;
  saveJSON('posts.json', posts).catch(() => {});
  return res.json({ ...p, likes: Array.isArray(p.likedBy) ? p.likedBy.length : (p.likes || 0) });
});

// Delete a post (owner only)
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const userId = '1';

  if (dbReady) {
    const p = postsRepo.get(id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (String(p.userId || '') !== String(userId)) return res.status(403).json({ error: 'Forbidden' });
    postsRepo._db.prepare(`DELETE FROM posts WHERE id=?`).run(id);
    postsRepo._db.prepare(`DELETE FROM post_likes WHERE postId=?`).run(id);
    postsRepo._db.prepare(`DELETE FROM comments WHERE postId=?`).run(id);
    return res.json({ ok: true });
  }

  const idx = posts.findIndex((x) => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (String(posts[idx].userId || '') !== String(userId)) return res.status(403).json({ error: 'Forbidden' });
  posts.splice(idx, 1);
  saveJSON('posts.json', posts).catch(() => {});
  return res.json({ ok: true });
});

// Edit a comment
router.patch('/:id/comment/:commentId', (req, res) => {
  const { id, commentId } = req.params;
  const { text } = req.body;
  if (dbReady) {
    const c = postsRepo.editComment(commentId, text || '');
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    return res.json(c);
  }
  const p = posts.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const c = p.comments.find((c) => c.id === commentId);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (c.userId !== '1') return res.status(403).json({ error: 'Forbidden' });
  c.text = text || c.text;
  saveJSON('posts.json', posts).catch(() => {});
  res.json(c);
});

// Delete a comment
router.delete('/:id/comment/:commentId', (req, res) => {
  const { id, commentId } = req.params;
  if (dbReady) {
    const removed = postsRepo.deleteComment(commentId);
    if (!removed) return res.status(404).json({ error: 'Comment not found' });
    return res.json(removed);
  }
  const p = posts.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const idx = p.comments.findIndex((c) => c.id === commentId);
  if (idx === -1) return res.status(404).json({ error: 'Comment not found' });
  if (p.comments[idx].userId !== '1') return res.status(403).json({ error: 'Forbidden' });
  const removed = p.comments.splice(idx, 1)[0];
  saveJSON('posts.json', posts).catch(() => {});
  res.json(removed);
});

export default router;
