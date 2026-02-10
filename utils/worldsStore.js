import { loadJSON, saveJSON } from './jsonStore.js';

const FILE = 'worlds.json';
let worlds = [];

const mockWorlds = [
  {
    id: '1',
    name: 'Sunset Beach Hangout',
    description: 'Relax by the virtual beach with friends',
    thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80',
    creatorId: '2',
    creatorName: 'Sarah Johnson',
    participants: 12,
    maxParticipants: 50,
    isPublic: true,
    theme: 'beach',
    priceCents: 0,
    mods: [],
  },
  {
    id: '2',
    name: 'Neon City Nights',
    description: 'Explore a futuristic cyberpunk city',
    thumbnail: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=800&q=80',
    creatorId: '3',
    creatorName: 'Mike Chen',
    participants: 28,
    maxParticipants: 100,
    isPublic: true,
    theme: 'city',
    priceCents: 0,
    mods: [],
  },
  {
    id: '3',
    name: 'Space Station Alpha',
    description: 'Float in zero gravity and explore the cosmos',
    thumbnail: 'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=800&q=80',
    creatorId: '4',
    creatorName: 'Emma Wilson',
    participants: 8,
    maxParticipants: 30,
    isPublic: true,
    theme: 'space',
    priceCents: 0,
    mods: [],
  },
];

export async function initWorlds() {
  try {
    const loaded = await loadJSON(FILE, mockWorlds);
    if (loaded && Array.isArray(loaded)) worlds = loaded;
  } catch {
    worlds = mockWorlds;
  }
}

export function listWorlds() {
  return worlds;
}

export async function saveWorlds() {
  try { await saveJSON(FILE, worlds); } catch {}
}

export function getWorld(id) {
  return worlds.find(w => w.id === id) || null;
}

export async function addWorld(world) {
  worlds = [world, ...worlds];
  await saveWorlds();
  return world;
}

export async function updateWorld(id, patch) {
  let updated = null;
  worlds = worlds.map(w => {
    if (w.id === id) { updated = { ...w, ...patch }; return updated; }
    return w;
  });
  await saveWorlds();
  return updated;
}

export async function removeWorld(id) {
  const before = worlds.length;
  worlds = worlds.filter(w => w.id !== id);
  await saveWorlds();
  return worlds.length !== before;
}
