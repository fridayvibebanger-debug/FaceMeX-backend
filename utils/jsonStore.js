import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataRoot = path.resolve(__dirname, '..', 'data');

export async function ensureDir() {
  await fs.mkdir(dataRoot, { recursive: true }).catch(() => {});
}

export function dataPath(filename) {
  return path.join(dataRoot, filename);
}

export async function loadJSON(filename, fallback) {
  await ensureDir();
  const p = dataPath(filename);
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (fallback !== undefined) {
      await saveJSON(filename, fallback).catch(() => {});
      return fallback;
    }
    return null;
  }
}

export async function saveJSON(filename, data) {
  await ensureDir();
  const p = dataPath(filename);
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, p);
  await createBackup(p).catch(() => {});
}

async function createBackup(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15); // YYYYMMDD-HHMM
  const backupName = `${base}.${stamp}.json.bak`;
  const backupPath = path.join(dir, backupName);
  // copy current file to backup
  await fs.copyFile(filePath, backupPath);
  await rotateBackups(dir, base);
}

async function rotateBackups(dir, base) {
  const entries = await fs.readdir(dir).catch(() => []);
  const backups = entries
    .filter((f) => f.startsWith(base + '.') && f.endsWith('.json.bak'))
    .map((f) => ({ name: f }))
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first by name stamp
  const keep = 5;
  const toDelete = backups.slice(keep);
  await Promise.all(
    toDelete.map((b) => fs.unlink(path.join(dir, b.name)).catch(() => {}))
  );
}
