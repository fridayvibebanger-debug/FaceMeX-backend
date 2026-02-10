import { Router } from 'express';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { initSqlite, dbReady, eventsRepo } from '../utils/sqlite.js';

const router = Router();

let events = [
  {
    id: '1',
    title: 'Virtual Concert: Neon Dreams',
    description: 'Experience an immersive virtual concert in our metaverse',
    coverImage: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80',
    hostId: '2',
    hostName: 'Sarah Johnson',
    hostAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
    startTime: new Date(Date.now() + 86400000 * 2).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 2 + 7200000).toISOString(),
    location: 'Virtual World: Neon City',
    type: 'virtual',
    attendeeCount: 342,
    maxAttendees: 500,
    isAttending: true,
    isPaid: true,
    price: 299,
    tags: ['music', 'virtual', 'concert'],
  },
  {
    id: '2',
    title: 'Tech Meetup: AI & Future',
    description: 'Discuss the latest in AI technology',
    coverImage: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&q=80',
    hostId: '3',
    hostName: 'Mike Chen',
    hostAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mike',
    startTime: new Date(Date.now() + 86400000 * 5).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 5 + 10800000).toISOString(),
    location: 'Cape Town Convention Center',
    type: 'in-person',
    attendeeCount: 87,
    maxAttendees: 150,
    isAttending: false,
    isPaid: false,
    tags: ['tech', 'ai', 'networking'],
  },
];

// Initialize SQLite if available; otherwise load JSON fallback
await initSqlite();
if (!dbReady) {
  events = (await loadJSON('events.json', events)) || events;
}

router.get('/', (_req, res) => {
  if (dbReady) {
    return res.json(eventsRepo.list());
  }
  res.json(events);
});

router.post('/', (req, res) => {
  const e = req.body || {};
  const id = `${Date.now()}`;
  if (dbReady) {
    const created = eventsRepo.create({
      id,
      title: e.title || 'Untitled',
      description: e.description || '',
      coverImage: e.coverImage || '',
      hostId: '1',
      hostName: e.hostName || 'Demo User',
      hostAvatar: e.hostAvatar || '',
      startTime: e.startTime || new Date().toISOString(),
      endTime: e.endTime || new Date(Date.now() + 3600000).toISOString(),
      location: e.location || 'TBD',
      type: e.type || 'virtual',
      isPaid: !!e.isPaid,
      price: e.price,
      tags: Array.isArray(e.tags) ? e.tags : [],
      maxAttendees: e.maxAttendees,
    });
    return res.status(201).json(created);
  }
  const newEvent = { id, title: e.title || 'Untitled', description: e.description || '', coverImage: e.coverImage || '', hostId: '1', hostName: e.hostName || 'Demo User', hostAvatar: e.hostAvatar || '', startTime: e.startTime || new Date().toISOString(), endTime: e.endTime || new Date(Date.now() + 3600000).toISOString(), location: e.location || 'TBD', type: e.type || 'virtual', attendeeCount: 1, maxAttendees: e.maxAttendees, isAttending: true, isPaid: !!e.isPaid, price: e.price, tags: Array.isArray(e.tags) ? e.tags : [] };
  events.unshift(newEvent);
  saveJSON('events.json', events).catch(() => {});
  res.status(201).json(newEvent);
});

router.post('/:id/attend', (req, res) => {
  const { id } = req.params;
  if (dbReady) {
    const updated = eventsRepo.attend(id, '1');
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json(updated);
  }
  const ev = events.find((x) => x.id === id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  if (!ev.isAttending) {
    ev.isAttending = true;
    ev.attendeeCount = (ev.attendeeCount || 0) + 1;
  }
  saveJSON('events.json', events).catch(() => {});
  res.json(ev);
});

router.post('/:id/unattend', (req, res) => {
  const { id } = req.params;
  if (dbReady) {
    const updated = eventsRepo.unattend(id, '1');
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json(updated);
  }
  const ev = events.find((x) => x.id === id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  if (ev.isAttending) {
    ev.isAttending = false;
    ev.attendeeCount = Math.max(0, (ev.attendeeCount || 0) - 1);
  }
  saveJSON('events.json', events).catch(() => {});
  res.json(ev);
});

export default router;
