import { loadJSON, saveJSON } from './jsonStore.js';

let me = {
  id: '1',
  name: 'Demo User',
  email: 'demo@example.com',
  avatar: '',
  followers: 12,
  following: 8,
  isVerified: true,
  tier: 'free',
  addons: { verified: false },
  mode: 'social',
};

// Load persisted profile if available (including professional fields)
try {
  const loaded = await loadJSON('me.json', me);
  if (loaded) me = loaded;
} catch {}

export function getMe() {
  return me;
}

export function setMe(patch = {}) {
  me = { ...me, ...patch };
  // persist async, do not block request path
  saveJSON('me.json', me).catch(() => {});
  return me;
}
