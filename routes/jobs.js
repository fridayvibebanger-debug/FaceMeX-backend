import { Router } from 'express';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

let jobs = [];
let applications = [];

jobs = (await loadJSON('jobs.json', jobs)) || jobs;
applications = (await loadJSON('jobApplications.json', applications)) || applications;

const toStr = (v) => (v == null ? '' : String(v));

router.get('/', (_req, res) => {
  res.json(jobs);
});

const tierOrder = {
  free: 0,
  pro: 1,
  creator: 2,
  business: 3,
  exclusive: 4,
};

function hasTier(user, minTier) {
  const t = user?.tier || 'free';
  return (tierOrder[t] ?? 0) >= (tierOrder[minTier] ?? 0);
}

router.post('/', requireAuth, async (req, res) => {
  if (!hasTier(req.user, 'business')) {
    return res.status(403).json({ error: 'tier_required', required: 'business' });
  }
  const body = req.body || {};
  const title = toStr(body.title).trim();
  const company = toStr(body.company).trim();
  const location = toStr(body.location).trim();
  const type = toStr(body.type).trim();
  const description = toStr(body.description).trim();
  const skills = Array.isArray(body.skills)
    ? body.skills.map((s) => toStr(s).trim()).filter(Boolean)
    : toStr(body.skills)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (!title || !company) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const job = {
    id: `j${Date.now()}`,
    title,
    company,
    location: location || 'Remote',
    type: type || 'Full-time',
    description,
    skills,
    createdAt: new Date().toISOString(),
  };

  jobs.unshift(job);
  await saveJSON('jobs.json', jobs).catch(() => {});
  return res.status(201).json(job);
});

router.get('/:jobId/applications', (req, res) => {
  const { jobId } = req.params;
  const list = applications.filter((a) => a.jobId === jobId);
  return res.json(list);
});

router.post('/:jobId/apply', async (req, res) => {
  const { jobId } = req.params;
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return res.status(404).json({ error: 'job_not_found' });

  const body = req.body || {};
  const fullName = toStr(body.fullName).trim();
  const email = toStr(body.email).trim();
  const phone = toStr(body.phone).trim();
  const coverLetter = toStr(body.coverLetter).trim();
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!fullName || !email) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const cleaned = attachments
    .map((f) => ({
      name: toStr(f?.name).slice(0, 160),
      type: toStr(f?.type).slice(0, 80),
      dataUrl: toStr(f?.dataUrl),
    }))
    .filter((f) => f.name && f.dataUrl);

  const appRecord = {
    id: `a${Date.now()}`,
    jobId,
    jobTitle: job.title,
    company: job.company,
    fullName,
    email,
    phone,
    coverLetter,
    attachments: cleaned,
    createdAt: new Date().toISOString(),
  };

  applications.unshift(appRecord);
  await saveJSON('jobApplications.json', applications).catch(() => {});

  return res.status(201).json({ ok: true, applicationId: appRecord.id });
});

export default router;
