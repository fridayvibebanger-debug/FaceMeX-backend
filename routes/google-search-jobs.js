import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const expressModule = (() => {
  try {
    return require('express');
  } catch {
    return null;
  }
})();

const DEFAULT_LIMIT = 8;
const DEFAULT_DAYS = 30;
const DEFAULT_MODEL = 'gemini-3.6-flash';

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return clean(value).replace(/\s+/g, ' ');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  const url = clean(value);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeLocation(value) {
  const location = normalizeText(value);
  if (!location) return 'South Africa';

  return location;
}

function buildSearchPrompt({ query, area, limit, days, includeOfficialSources, includeExternal, sort }) {
  const inputQuery = normalizeText(query) || 'jobs';
  const inputArea = normalizeLocation(area || 'South Africa');
  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  const requestedDays = Number.isInteger(days) && days > 0 ? days : DEFAULT_DAYS;

  return [
    'You are the web-discovery engine for FaceMeX Job Assistant.',
    'Find CURRENT publicly available job opportunities on the web.',
    'Search for real job postings matching the user request.',
    'Prioritize official company career pages, employer application pages, reputable job boards, and other credible public job sources.',
    'Do not invent jobs. Do not invent companies. Do not invent salaries. Do not invent application URLs.',
    'Do not claim a job is current unless there is evidence from the source.',
    '',
    `User request: ${inputQuery}`,
    `Location / area preference: ${inputArea}`,
    `Requested results: ${requestedLimit}`,
    `Freshness window: ${requestedDays} days`,
    `Sort preference: ${sort || 'date'}`,
    `Include external sources: ${includeExternal === false ? 'false' : 'true'}`,
    `Include official sources: ${includeOfficialSources === false ? 'false' : 'true'}`,
    '',
    'Return JSON only with a top-level object named "jobs". Each job must include:',
    '{',
    '  "title": string | null,',
    '  "company": string | null,',
    '  "location": string | null,',
    '  "employmentType": string | null,',
    '  "experienceLevel": string | null,',
    '  "salary": string | null,',
    '  "datePosted": string | null,',
    '  "closingDate": string | null,',
    '  "requirements": string[],',
    '  "description": string | null,',
    '  "applicationUrl": string | null,',
    '  "sourceUrl": string | null,',
    '  "sourceName": string | null,',
    '  "sourceType": "google_search" | "company" | "other",',
    '  "verificationStatus": "verified" | "needs_verification" | "expired",',
    '  "verificationReason": string | null,',
    '  "evidence": string | null',
    '}',
    '',
    'Rules:',
    '1. Prefer direct application URLs when present.',
    '2. If a third-party job board is the only available source, clearly identify it as such.',
    '3. If applicationUrl is not present in the search evidence, return null instead of inventing a URL.',
    '4. Only return jobs that appear to be currently public and relevant to the request.',
    '5. If the search yields no reliable results, return { "jobs": [] }.',
    '6. Do not include extra conversational text outside the JSON object.',
    '7. If a field is unavailable, return null or [] as appropriate.',
  ].join('\n');
}

function extractTextFromGeminiResponse(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = candidates.flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []);

  return parts
    .map((part) => part?.text || '')
    .join('\n')
    .trim();
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const trimmed = text.replace(/\s+/g, ' ');

  if (!Number.isNaN(Date.parse(trimmed))) {
    return new Date(trimmed).toISOString();
  }

  return null;
}

function buildFallbackJob(raw, index) {
  const sourceName = normalizeText(raw?.sourceName || raw?.source_name || 'Google Search');
  const company = normalizeText(raw?.company || raw?.employer || raw?.company_name) || 'Company not stated';
  const title = normalizeText(raw?.title || raw?.job_title || raw?.role) || `Job ${index + 1}`;
  const location = normalizeLocation(raw?.location || raw?.area || raw?.city || raw?.province || raw?.country);
  const applicationUrl = normalizeUrl(raw?.applicationUrl || raw?.apply_url || raw?.application_link || raw?.sourceUrl || raw?.source_url);
  const sourceUrl = normalizeUrl(raw?.sourceUrl || raw?.source_url || raw?.sourceLink || raw?.source_link || applicationUrl);

  return {
    id: `gemini-search-${index}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    company,
    location,
    employmentType: normalizeText(raw?.employmentType || raw?.employment_type) || null,
    experienceLevel: normalizeText(raw?.experienceLevel || raw?.experience_level) || null,
    salary: normalizeText(raw?.salary || raw?.salary_text) || null,
    datePosted: normalizeDate(raw?.datePosted || raw?.date_posted || raw?.postedAt || raw?.posted_at) || null,
    closingDate: normalizeDate(raw?.closingDate || raw?.closing_date || raw?.deadline) || null,
    requirements: Array.isArray(raw?.requirements) ? raw.requirements.map((item) => normalizeText(item)).filter(Boolean) : [],
    description: normalizeText(raw?.description) || null,
    applicationUrl,
    sourceUrl: sourceUrl || applicationUrl,
    sourceName,
    sourceType: 'google_search',
    verificationStatus: raw?.verificationStatus || raw?.verification_status || (applicationUrl ? 'needs_verification' : 'expired'),
    verificationReason: normalizeText(raw?.verificationReason || raw?.verification_reason) || null,
    discoveredAt: new Date().toISOString(),
    expiresAt: null,
    evidence: normalizeText(raw?.evidence) || null,
  };
}

function normalizeSearchJobs(rawJobs = []) {
  const jobs = Array.isArray(rawJobs) ? rawJobs : [];

  return jobs
    .map((job, index) => buildFallbackJob(job, index))
    .filter((job) => job.title || job.company || job.sourceUrl)
    .map((job) => {
      const verificationStatus = String(job.verificationStatus || '').toLowerCase();
      const verified = verificationStatus === 'verified' || verificationStatus === 'approved';
      const expired = verificationStatus === 'expired' || verificationStatus === 'closed';

      if (expired) {
        return {
          ...job,
          verificationStatus: 'expired',
          verificationReason: job.verificationReason || 'The job appears to be expired or closed.',
        };
      }

      const needsVerification = !verified && (!job.applicationUrl || !job.sourceUrl || !job.company || !job.location);

      return {
        ...job,
        verificationStatus: needsVerification ? 'needs_verification' : 'verified',
        verificationReason: job.verificationReason || (needsVerification ? 'Google Search evidence was found, but the application route or source URL needs confirmation.' : null),
      };
    });
}

function normalizeGeminiResponsePayload(payload) {
  const text = extractTextFromGeminiResponse(payload);

  if (!text) {
    return [];
  }

  const parsed = safeJsonParse(text);

  if (parsed && Array.isArray(parsed.jobs)) {
    return normalizeSearchJobs(parsed.jobs);
  }

  if (parsed && Array.isArray(parsed.results)) {
    return normalizeSearchJobs(parsed.results);
  }

  if (parsed && Array.isArray(parsed.items)) {
    return normalizeSearchJobs(parsed.items);
  }

  if (Array.isArray(parsed)) {
    return normalizeSearchJobs(parsed);
  }

  return [];
}

function generateProviderFallbackError(provider, error) {
  return {
    success: false,
    provider,
    error: error?.message || 'provider_error',
    details: error,
  };
}

async function callGeminiSearch(request) {
  const apiKey = process.env.GEMINI_SEARCH_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_SEARCH_API_KEY is not configured on the backend.');
  }

  const model = process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: buildSearchPrompt(request) }],
      },
    ],
    tools: [{ type: 'google_search' }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || 'gemini_search_request_failed';
    throw new Error(message);
  }

  return data;
}

function normalizeSearchRequest(input = {}) {
  const query = normalizeText(input.query || input.prompt || input.keyword || 'jobs');
  const area = normalizeLocation(input.area || input.location || 'South Africa');

  return {
    query,
    area,
    limit: Number.isInteger(input.limit) && input.limit > 0 ? input.limit : DEFAULT_LIMIT,
    days: Number.isInteger(input.days) && input.days > 0 ? input.days : DEFAULT_DAYS,
    includeOfficialSources: input.includeOfficialSources !== false,
    includeExternal: input.includeExternal !== false,
    sort: normalizeText(input.sort || 'date'),
    fresh: input.fresh !== false,
  };
}

function dedupeJobs(jobs = []) {
  const seen = new Map();

  for (const job of jobs) {
    const normalizeCandidate = (value) => clean(value).toLowerCase().replace(/\s+/g, '').replace(/[?#].*$/, '');
    const key = [
      normalizeCandidate(job.company),
      normalizeCandidate(job.title),
      normalizeCandidate(job.location),
      normalizeCandidate(job.applicationUrl || job.sourceUrl),
      normalizeCandidate(job.sourceUrl || job.applicationUrl),
    ].join('|');

    if (!seen.has(key)) {
      seen.set(key, job);
    }
  }

  return Array.from(seen.values());
}

function scoreJob(job, request) {
  const query = normalizeText(request.query).toLowerCase();
  const location = normalizeText(request.area).toLowerCase();
  const jobTitle = normalizeText(job.title).toLowerCase();
  const company = normalizeText(job.company).toLowerCase();
  const jobLocation = normalizeText(job.location).toLowerCase();
  const requirements = Array.isArray(job.requirements) ? job.requirements.join(' ').toLowerCase() : '';

  let score = 0;

  if (query && (jobTitle.includes(query) || company.includes(query) || requirements.includes(query))) score += 35;
  if (location && (jobLocation.includes(location) || company.includes(location) || jobTitle.includes(location))) score += 20;
  if (job.applicationUrl) score += 15;
  if (job.sourceType === 'google_search') score += 10;
  if (job.verificationStatus === 'verified') score += 15;
  if (job.salary) score += 5;
  if (job.datePosted) score += 5;

  return score;
}

function rankJobs(jobs = [], request = {}) {
  const normalizedRequest = normalizeSearchRequest(request);

  return [...jobs]
    .sort((a, b) => scoreJob(b, normalizedRequest) - scoreJob(a, normalizedRequest))
    .slice(0, normalizedRequest.limit);
}

export async function discoverJobsWithGoogleSearch(input = {}) {
  const request = normalizeSearchRequest(input);

  try {
    const payload = await callGeminiSearch(request);
    const jobs = normalizeGeminiResponsePayload(payload);
    const deduped = dedupeJobs(jobs);
    const ranked = rankJobs(deduped, request);

    return {
      success: true,
      provider: 'gemini',
      source: 'google_search',
      query: request.query,
      area: request.area,
      total: ranked.length,
      jobs: ranked,
      metadata: {
        model: process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL,
        source: 'google_search',
        requestedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      provider: 'gemini',
      source: 'google_search',
      query: request.query,
      area: request.area,
      total: 0,
      jobs: [],
      error: error?.message || 'google_search_job_discovery_failed',
    };
  }
}

export function createGoogleSearchJobsRouter() {
  if (!expressModule) {
    throw new Error('Google Search jobs router requires Express to be installed in the backend runtime.');
  }

  const router = expressModule.Router();

  router.get('/google-search-test', async (req, res) => {
    try {
      const result = await discoverJobsWithGoogleSearch({
        query: req.query.query || 'accounting jobs',
        area: req.query.area || 'Tzaneen, Limpopo',
        limit: Number(req.query.limit || 5),
      });

      return res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      return res.status(500).json(generateProviderFallbackError('gemini-google-search', error));
    }
  });

  router.get('/auto-search', async (req, res) => {
    const query = normalizeText(req.query.query || 'jobs');
    const area = normalizeText(req.query.area || 'South Africa');
    const includeExternal = req.query.includeExternal !== 'false';
    const includeOfficialSources = req.query.includeOfficialSources !== 'false';

    try {
      const googleSearchResult = await discoverJobsWithGoogleSearch({
        query,
        area,
        limit: Number(req.query.limit || DEFAULT_LIMIT),
        days: Number(req.query.days || DEFAULT_DAYS),
        includeExternal,
        includeOfficialSources,
        sort: normalizeText(req.query.sort || 'date'),
        fresh: req.query.fresh !== 'false',
      });

      const jobs = Array.isArray(googleSearchResult.jobs) ? googleSearchResult.jobs : [];

      return res.status(200).json({
        success: true,
        query,
        area,
        providers: {
          google_search: {
            success: googleSearchResult.success,
            jobs,
            total: jobs.length,
            error: googleSearchResult.error || null,
          },
        },
        jobs,
        googleSearchJobs: jobs,
        sources: {
          google_search: jobs,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'auto_search_failed',
      });
    }
  });

  return router;
}

export function registerGoogleSearchJobsRoutes(app, basePath = '/api/jobs') {
  if (!app || typeof app.use !== 'function') {
    throw new Error('registerGoogleSearchJobsRoutes expects an Express app or router instance.');
  }

  const router = createGoogleSearchJobsRouter();
  app.use(basePath, router);
  return router;
}

export const googleSearchJobsService = {
  normalizeSearchRequest,
  discoverJobsWithGoogleSearch,
  createGoogleSearchJobsRouter,
  registerGoogleSearchJobsRoutes,
};

export default googleSearchJobsService;
