const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

/* =========================================================
   ENV / CONFIG
========================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY;
const JOOBLE_ENABLED = String(process.env.JOOBLE_ENABLED || 'false').toLowerCase() === 'true';

const JOB_REFRESH_SECRET = process.env.JOB_REFRESH_SECRET || '';
const JOBS_TABLE = process.env.SUPABASE_JOBS_TABLE || 'jobs';

const SYSTEM_AUTHOR_ID =
  process.env.JOBS_SYSTEM_AUTHOR_ID ||
  process.env.FACEMEX_SYSTEM_USER_ID ||
  process.env.SYSTEM_USER_ID ||
  process.env.DEFAULT_AUTHOR_ID ||
  null;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const CACHE_MINUTES = 10;
const cache = new Map();

let cachedSystemAuthorId = SYSTEM_AUTHOR_ID;

/* =========================================================
   BASIC HELPERS
========================================================= */

function normalizeText(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'object') {
    return normalizeText(
      value.display_name ||
        value.name ||
        value.company_name ||
        value.label ||
        value.title ||
        value.value ||
        ''
    );
  }

  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function isSameText(a, b) {
  return normalizeLower(a) === normalizeLower(b);
}

function uniqueClean(list) {
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const clean = normalizeText(item);
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(clean);
  }

  return out;
}

function truncateText(text, max = 650) {
  const clean = normalizeText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

function getErrorMessage(error) {
  if (!error) return null;
  return error.message || String(error);
}

function nowIso() {
  return new Date().toISOString();
}

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatSalary(min, max) {
  const nMin = Number(min);
  const nMax = Number(max);

  if (Number.isFinite(nMin) && Number.isFinite(nMax) && (nMin > 0 || nMax > 0)) {
    if (nMin === nMax) return `R${Math.round(nMin)}`;
    return `R${Math.round(nMin)} - R${Math.round(nMax)}`;
  }

  if (Number.isFinite(nMin) && nMin > 0) return `From R${Math.round(nMin)}`;
  if (Number.isFinite(nMax) && nMax > 0) return `Up to R${Math.round(nMax)}`;

  return null;
}

function extractCompanyName(company, fallback = 'Company not stated') {
  const clean = normalizeText(company);
  if (!clean || clean === '[object Object]') return fallback;
  return clean;
}

function extractAreaFromAdzuna(job) {
  const areaArray = Array.isArray(job?.location?.area) ? job.location.area : [];
  const display = normalizeText(job?.location?.display_name);

  if (areaArray.length) {
    const reversed = [...areaArray].reverse();
    return reversed.join(', ');
  }

  return display || 'South Africa';
}

function extractProvince(area) {
  const a = normalizeLower(area);

  if (a.includes('limpopo')) return 'Limpopo';
  if (a.includes('gauteng')) return 'Gauteng';
  if (a.includes('mpumalanga')) return 'Mpumalanga';
  if (a.includes('north west')) return 'North West';
  if (a.includes('free state')) return 'Free State';
  if (a.includes('kwazulu') || a.includes('kzn')) return 'KwaZulu-Natal';
  if (a.includes('eastern cape')) return 'Eastern Cape';
  if (a.includes('western cape')) return 'Western Cape';
  if (a.includes('northern cape')) return 'Northern Cape';

  if (
    a.includes('tzaneen') ||
    a.includes('polokwane') ||
    a.includes('phalaborwa') ||
    a.includes('hoedspruit') ||
    a.includes('giyani') ||
    a.includes('mankweng') ||
    a.includes('mokopane') ||
    a.includes('thohoyandou') ||
    a.includes('burgersfort') ||
    a.includes('lephalale') ||
    a.includes('bela-bela') ||
    a.includes('modimolle') ||
    a.includes('musina')
  ) {
    return 'Limpopo';
  }

  if (
    a.includes('johannesburg') ||
    a.includes('pretoria') ||
    a.includes('tshwane') ||
    a.includes('midrand') ||
    a.includes('sandton') ||
    a.includes('centurion') ||
    a.includes('soweto')
  ) {
    return 'Gauteng';
  }

  if (a.includes('south africa')) return 'South Africa';

  return 'South Africa';
}

/* =========================================================
   LOCATIONS
========================================================= */

const GREATER_TZANEEN_VILLAGES_TOWNSHIPS = [
  'Lenyenye',
  'Nkowankowa',
  'Maake',
  'Maake Plaza',
  'Burgersdorp',
  'Mokgoloboto',
  'Mokgolobhoto',
  'Gavaza',
  'Dan',
  'Julesburg',
  'Lephepane',
  'Mafarana',
  'Kujwana',
  'Khujwana',
  'Moime',
  'Runnymede',
  'Rita',
  'Deerpark',
  'Ramokako',
  'Mohlaba Cross',
  'Mohlaba',
  'Bridgeway',
  'Nwamitwa',
  'Mogoboya',
  'Mogapeng',
  'Petanenge',
  'Relela',
  'Myakayaka',
  'Letsitele Valley',
];

const LIMPOPO_TOWNS_CITIES = [
  'Tzaneen',
  'Letsitele',
  'Modjadjiskloof',
  'Haenertsburg',
  'Gravelotte',
  'Giyani',
  'Malamulele',
  'Phalaborwa',
  'Hoedspruit',
  'Maruleng',
  'Polokwane',
  'Mankweng',
  'Seshego',
  'Mokopane',
  'Lebowakgomo',
  'Makhado',
  'Louis Trichardt',
  'Thohoyandou',
  'Musina',
  'Bela-Bela',
  'Modimolle',
  'Lephalale',
  'Thabazimbi',
  'Burgersfort',
  'Steelpoort',
  'Marble Hall',
  'Groblersdal',
];

const SOUTH_AFRICA_LOCATIONS = [
  'South Africa',
  'Limpopo',
  'Gauteng',
  'Mpumalanga',
  'North West',
  'Free State',
  'KwaZulu-Natal',
  'KZN',
  'Eastern Cape',
  'Western Cape',
  'Northern Cape',
  'Johannesburg',
  'Pretoria',
  'Tshwane',
  'Soweto',
  'Sandton',
  'Midrand',
  'Centurion',
  'Ekurhuleni',
  'Durban',
  'Pietermaritzburg',
  'Cape Town',
  'Bloemfontein',
  'Gqeberha',
  'Port Elizabeth',
  'East London',
  'Kimberley',
  'Mbombela',
  'Nelspruit',
  'Witbank',
  'Emalahleni',
  'Secunda',
  'Rustenburg',
  'Mahikeng',
  ...LIMPOPO_TOWNS_CITIES,
  ...GREATER_TZANEEN_VILLAGES_TOWNSHIPS,
];

const AFRICA_ONLY_LOCATIONS = [
  'Africa',
  'Zimbabwe',
  'Botswana',
  'Namibia',
  'Mozambique',
  'Zambia',
  'Malawi',
  'Lesotho',
  'Eswatini',
  'Swaziland',
  'Kenya',
  'Nigeria',
  'Ghana',
  'Tanzania',
  'Uganda',
  'Rwanda',
  'Ethiopia',
  'Egypt',
  'Morocco',
  'Angola',
  'DRC',
  'Democratic Republic of Congo',
  'Cameroon',
  'Senegal',
  'Ivory Coast',
  'Cote dIvoire',
];

function isKnownSouthAfricaLocation(location) {
  const l = normalizeLower(location);
  if (!l) return true;

  if (l.includes('south africa')) return true;

  return SOUTH_AFRICA_LOCATIONS.some((place) => {
    const p = normalizeLower(place);
    return l === p || l.includes(p);
  });
}

function expandSearchLocations(area) {
  const cleanArea = normalizeText(area || 'South Africa');

  const isTzaneenArea =
    GREATER_TZANEEN_VILLAGES_TOWNSHIPS.some((v) => isSameText(v, cleanArea)) ||
    isSameText(cleanArea, 'Tzaneen') ||
    normalizeLower(cleanArea).includes('tzaneen');

  if (isTzaneenArea) {
    return uniqueClean([cleanArea, 'Tzaneen', 'Limpopo', 'South Africa', 'Africa']);
  }

  const isLimpopoArea =
    LIMPOPO_TOWNS_CITIES.some((v) => isSameText(v, cleanArea)) ||
    normalizeLower(cleanArea).includes('limpopo');

  if (isLimpopoArea) {
    return uniqueClean([cleanArea, 'Limpopo', 'South Africa', 'Africa']);
  }

  if (isKnownSouthAfricaLocation(cleanArea)) {
    return uniqueClean([cleanArea, 'South Africa', 'Africa']);
  }

  return uniqueClean([cleanArea, 'South Africa', 'Africa']);
}

/* =========================================================
   KEYWORD EXPANSION
========================================================= */

function detectIntent(query) {
  const q = normalizeLower(query);

  if (/\b(driver|drivers|code 10|code 14|courier|delivery|truck|pdp|prdp|fleet|transport|logistics)\b/.test(q)) {
    return 'driver';
  }

  if (/\b(admin|administrator|administrative|clerk|receptionist|data capturer|office assistant|pa|personal assistant)\b/.test(q)) {
    return 'admin';
  }

  if (/\b(cleaner|cleaning|housekeeper|housekeeping)\b/.test(q)) return 'cleaner';
  if (/\b(cashier|retail|shop assistant|store assistant|sales assistant)\b/.test(q)) return 'retail';
  if (/\b(general worker|general assistant|warehouse|packer|picker)\b/.test(q)) return 'general_worker';
  if (/\b(security|guard|armed response)\b/.test(q)) return 'security';
  if (/\b(learnership|internship|intern|yes programme|youth)\b/.test(q)) return 'learnership';
  if (/\b(it|developer|software|technician|technical support|desktop support)\b/.test(q)) return 'it';
  if (/\b(nurse|healthcare|caregiver|clinic|hospital)\b/.test(q)) return 'healthcare';
  if (/\b(teacher|teaching|educator|school)\b/.test(q)) return 'education';

  return 'general';
}

function keywordVariants(query) {
  const clean = normalizeText(query || 'jobs');
  const intent = detectIntent(clean);

  const map = {
    driver: [
      'driver code 10 code 14 delivery courier logistics truck driver',
      'driver',
      'delivery driver',
      'courier driver',
      'code 10 driver',
      'code 14 driver',
      'truck driver',
      'logistics driver',
    ],
    admin: [
      'admin clerk receptionist data capturer office assistant',
      'admin clerk',
      'administrator',
      'receptionist',
      'data capturer',
      'office assistant',
      'administrative assistant',
      'personal assistant',
    ],
    cleaner: [
      'cleaner housekeeping cleaning',
      'cleaner',
      'housekeeper',
      'cleaning jobs',
    ],
    retail: [
      'cashier retail shop assistant store assistant',
      'cashier',
      'retail assistant',
      'shop assistant',
      'sales assistant',
    ],
    general_worker: [
      'general worker general assistant packer warehouse',
      'general worker',
      'general assistant',
      'packer',
      'warehouse assistant',
    ],
    security: [
      'security guard armed response',
      'security guard',
      'security officer',
      'armed response',
    ],
    learnership: [
      'learnership internship yes programme youth',
      'learnership',
      'internship',
      'YES programme',
      'graduate programme',
    ],
    it: [
      'IT technician desktop support software developer',
      'IT support',
      'desktop support',
      'technician',
      'software developer',
    ],
    healthcare: [
      'nurse healthcare caregiver clinic hospital',
      'nurse',
      'caregiver',
      'clinic assistant',
      'healthcare assistant',
    ],
    education: [
      'teacher teaching educator school',
      'teacher',
      'educator',
      'teaching assistant',
    ],
    general: [clean, 'jobs', 'vacancies'],
  };

  return uniqueClean(map[intent] || [clean, 'jobs']);
}

/* =========================================================
   RELEVANCE
========================================================= */

function driverRelevanceScore(job) {
  const title = normalizeLower(job?.title);
  const category = normalizeLower(job?.category);
  const description = normalizeLower(job?.description);
  const combinedTitle = `${title} ${category}`;

  let score = 0;

  if (/\b(driver|drivers|salesman driver|bus driver|truck driver|delivery driver|courier driver|code 10|code 14|ultra-heavy|heavy motor vehicle|pdp|prdp)\b/.test(title)) {
    score += 120;
  }

  if (/\b(fleet|transport|logistics|depot|vehicle|truck|bus|courier|delivery)\b/.test(title)) {
    score += 70;
  }

  if (/\b(logistics|warehouse|transport|travel)\b/.test(category)) {
    score += 35;
  }

  if (/\b(driver|drivers|fleet|transport|logistics|truck|vehicle|courier|delivery|road|depot|bus|prdp|pdp|code 10|code 14)\b/.test(description)) {
    score += 15;
  }

  if (/\b(valid driver'?s? licence|valid drivers licence|driver's license|drivers license|own vehicle)\b/.test(description) && score < 60) {
    score -= 80;
  }

  if (!/\b(driver|drivers|fleet|transport|logistics|truck|vehicle|courier|delivery|road|depot|bus|prdp|pdp|code 10|code 14)\b/.test(combinedTitle)) {
    score -= 55;
  }

  return score;
}

function adminRelevanceScore(job) {
  const title = normalizeLower(job?.title);
  const category = normalizeLower(job?.category);
  const description = normalizeLower(job?.description);

  let score = 0;

  if (/\b(admin|administrator|administrative|clerk|receptionist|data capturer|office assistant|personal assistant|pa|secretary|co-ordinator|coordinator)\b/.test(title)) {
    score += 120;
  }

  if (/\b(admin|administrative|office|hr|recruitment|accounting|finance)\b/.test(category)) {
    score += 35;
  }

  if (/\b(admin|administrator|administrative|clerk|reception|filing|captur|office|records|invoices|documents|payroll|hr administration)\b/.test(description)) {
    score += 25;
  }

  if (/\b(manager|foreman|technician|chef|driver|salesperson|financial adviser|guide|general manager)\b/.test(title) && score < 80) {
    score -= 55;
  }

  return score;
}

function generalRelevanceScore(job, rawQuery) {
  const q = normalizeLower(rawQuery);
  const title = normalizeLower(job?.title);
  const category = normalizeLower(job?.category);
  const description = normalizeLower(job?.description);

  let score = 0;

  const parts = q.split(/\s+/).filter((w) => w.length >= 3);

  for (const word of parts) {
    const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${safe}`, 'i');

    if (re.test(title)) score += 35;
    if (re.test(category)) score += 15;
    if (re.test(description)) score += 8;
  }

  return score;
}

function locationScore(job, requestedArea) {
  const area = normalizeLower(job?.area || job?.town || '');
  const province = normalizeLower(job?.province || '');
  const requested = normalizeLower(requestedArea || '');

  if (!requested) return 0;

  if (area.includes(requested)) return 80;

  if (
    requested.includes('tzaneen') &&
    (area.includes('tzaneen') ||
      area.includes('greater tzaneen') ||
      area.includes('lenyenye') ||
      area.includes('nkowankowa'))
  ) {
    return 80;
  }

  if (requested.includes('tzaneen') && province.includes('limpopo')) return 45;
  if (requested.includes('limpopo') && province.includes('limpopo')) return 55;

  if (area.includes('south africa') || province.includes('south africa')) return 10;

  return 0;
}

function relevanceScore(job, rawQuery, requestedArea) {
  const intent = detectIntent(rawQuery);
  let score = 0;

  if (intent === 'driver') score += driverRelevanceScore(job);
  else if (intent === 'admin') score += adminRelevanceScore(job);
  else score += generalRelevanceScore(job, rawQuery);

  score += locationScore(job, requestedArea);

  const created = new Date(job?.createdAt || job?.created_at || 0).getTime();
  if (Number.isFinite(created)) {
    const daysOld = (Date.now() - created) / (1000 * 60 * 60 * 24);
    if (daysOld <= 3) score += 15;
    else if (daysOld <= 14) score += 10;
    else if (daysOld <= 45) score += 5;
  }

  return score;
}

function filterAndRankJobs(jobs, rawQuery, requestedArea, limit) {
  const intent = detectIntent(rawQuery);

  const scored = jobs
    .map((job) => ({
      ...job,
      relevanceScore: relevanceScore(job, rawQuery, requestedArea),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  let filtered = scored;

  if (intent === 'driver') {
    const strict = scored.filter((job) => job.relevanceScore >= 25);
    if (strict.length >= 5) filtered = strict;
  }

  if (intent === 'admin') {
    const strict = scored.filter((job) => job.relevanceScore >= 35);
    if (strict.length >= 5) filtered = strict;
  }

  return filtered.slice(0, limit);
}

/* =========================================================
   NORMALIZE JOBS
========================================================= */

function normalizeAdzunaJob(job, context = {}) {
  const area = extractAreaFromAdzuna(job);
  const province = extractProvince(area);

  const salary =
    job?.salary_is_predicted === '1'
      ? null
      : formatSalary(job?.salary_min, job?.salary_max);

  const applyUrl = normalizeText(job?.redirect_url || job?.adref || job?.url);

  return {
    id: `adzuna-${job?.id}`,
    external_source: 'adzuna',
    external_id: normalizeText(job?.id),
    title: normalizeText(job?.title || 'Untitled job'),
    company: extractCompanyName(job?.company, 'Company not stated'),
    area,
    town: area,
    province,
    category: normalizeText(job?.category?.label || job?.category || 'Jobs'),
    salary,
    deadline: null,
    applyUrl,
    apply_url: applyUrl,
    sourceUrl: applyUrl,
    source_url: applyUrl,
    sourceLabel: 'Adzuna live job source',
    source_label: 'Adzuna live job source',
    sourceType: 'adzuna_job_api',
    source_type: 'adzuna_job_api',
    verificationStatus: 'needs_verification',
    verification_status: 'needs_verification',
    actionLabel: 'Open Apply Page',
    isSourceCard: false,
    description: truncateText(job?.description || ''),
    createdAt: safeDate(job?.created) || nowIso(),
    updatedAt: nowIso(),
    trustScore: 65,
    foundBy: ['adzuna'],
    searchLocation: context.location || null,
    searchKeyword: context.keyword || null,
    matchNote: 'Found by Adzuna',
  };
}

function normalizeJoobleJob(job, context = {}) {
  const area = normalizeText(job?.location || context.location || 'South Africa');
  const province = extractProvince(area);
  const applyUrl = normalizeText(job?.link || job?.url);

  const idRaw =
    normalizeText(job?.id) ||
    normalizeText(job?.guid) ||
    Buffer.from(`${job?.title || ''}-${job?.company || ''}-${applyUrl}`).toString('base64').slice(0, 32);

  return {
    id: `jooble-${idRaw}`,
    external_source: 'jooble',
    external_id: idRaw,
    title: normalizeText(job?.title || 'Untitled job'),
    company: extractCompanyName(job?.company || job?.source, 'Company not stated'),
    area,
    town: area,
    province,
    category: normalizeText(job?.type || 'Jobs'),
    salary: normalizeText(job?.salary) || null,
    deadline: null,
    applyUrl,
    apply_url: applyUrl,
    sourceUrl: applyUrl,
    source_url: applyUrl,
    sourceLabel: 'Jooble live job source',
    source_label: 'Jooble live job source',
    sourceType: 'jooble_job_api',
    source_type: 'jooble_job_api',
    verificationStatus: 'needs_verification',
    verification_status: 'needs_verification',
    actionLabel: 'Open Apply Page',
    isSourceCard: false,
    description: truncateText(job?.snippet || job?.description || ''),
    createdAt: safeDate(job?.updated) || nowIso(),
    updatedAt: nowIso(),
    trustScore: 60,
    foundBy: ['jooble'],
    searchLocation: context.location || null,
    searchKeyword: context.keyword || null,
    matchNote: 'Found by Jooble',
  };
}

/* =========================================================
   SOUTH AFRICA FILTER FOR JOOBLE
========================================================= */

function isProbablySouthAfricanJob(job) {
  const text = normalizeLower(
    `${job?.title || ''} ${job?.company || ''} ${job?.area || ''} ${job?.town || ''} ${job?.province || ''} ${job?.description || ''} ${job?.sourceUrl || ''}`
  );

  const negativeForeign =
    /\b(united states|usa|canada|united kingdom|uk|england|london|australia|india|philippines|germany|france|netherlands|europe)\b/.test(
      text
    );

  if (negativeForeign && !text.includes('south africa')) return false;

  return (
    text.includes('south africa') ||
    text.includes('.co.za') ||
    text.includes('limpopo') ||
    text.includes('gauteng') ||
    text.includes('mpumalanga') ||
    text.includes('western cape') ||
    text.includes('eastern cape') ||
    text.includes('kwazulu') ||
    text.includes('north west') ||
    text.includes('free state') ||
    text.includes('northern cape') ||
    SOUTH_AFRICA_LOCATIONS.some((place) => text.includes(normalizeLower(place)))
  );
}

/* =========================================================
   DEDUPE
========================================================= */

function dedupeJobs(jobs) {
  const seen = new Set();
  const out = [];

  for (const job of jobs) {
    const externalKey = `${normalizeLower(job.external_source)}:${normalizeLower(job.external_id)}`;
    const softKey = `${normalizeLower(job.title)}:${normalizeLower(job.company)}:${normalizeLower(job.area)}`;

    const key = job.external_id ? externalKey : softKey;

    if (seen.has(key)) continue;
    seen.add(key);

    out.push(job);
  }

  return out;
}

/* =========================================================
   PROVIDER CALLS
========================================================= */

async function fetchJson(url, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch is not available. Use Node 18+ on Render.');
  }

  const res = await fetch(url, options);
  const text = await res.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
  }

  return json;
}

async function searchAdzunaOnce(keyword, location, page = 1, resultsPerPage = 50) {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return {
      ok: false,
      count: 0,
      total: 0,
      jobs: [],
      error: 'Adzuna is not configured',
    };
  }

  try {
    const params = new URLSearchParams({
      app_id: ADZUNA_APP_ID,
      app_key: ADZUNA_APP_KEY,
      results_per_page: String(resultsPerPage),
      what: keyword,
      where: location,
      content-type: 'application/json',
      sort_by: 'date',
    });

    const url = `https://api.adzuna.com/v1/api/jobs/za/search/${page}?${params.toString()}`;
    const data = await fetchJson(url);

    const rawJobs = Array.isArray(data?.results) ? data.results : [];
    const jobs = rawJobs.map((job) =>
      normalizeAdzunaJob(job, {
        keyword,
        location,
      })
    );

    return {
      ok: true,
      count: jobs.length,
      total: Number(data?.count || 0),
      jobs,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      total: 0,
      jobs: [],
      error: getErrorMessage(error),
    };
  }
}

async function searchAdzunaSmart(rawQuery, area, limit = 60) {
  const locations = expandSearchLocations(area);
  const keywords = keywordVariants(rawQuery);

  const attempts = [];
  const jobs = [];
  const maxJobs = Math.min(Math.max(limit * 2, 60), 150);

  for (const location of locations) {
    if (jobs.length >= maxJobs) break;

    // Adzuna ZA only supports South African locations.
    // Do not search "Africa" or other African countries on Adzuna.
    if (isSameText(location, 'Africa') || AFRICA_ONLY_LOCATIONS.some((x) => isSameText(x, location))) {
      attempts.push({
        provider: 'adzuna',
        keyword: keywords[0],
        location,
        ok: true,
        count: 0,
        total: 0,
        skipped: true,
        error: 'Skipped Africa search for Adzuna ZA',
      });
      continue;
    }

    for (const keyword of keywords) {
      if (jobs.length >= maxJobs) break;

      const result = await searchAdzunaOnce(keyword, location, 1, 50);

      attempts.push({
        provider: 'adzuna',
        keyword,
        location,
        ok: result.ok,
        count: result.count,
        total: result.total,
        skipped: false,
        error: result.error,
      });

      if (result.ok && result.jobs.length) {
        jobs.push(...result.jobs);
      }

      if (jobs.length >= limit && result.count > 0) break;
    }
  }

  return {
    ok: true,
    count: jobs.length,
    jobs,
    attempts,
    error: null,
  };
}

async function searchJoobleOnce(keyword, location, page = 1, resultsPerPage = 50) {
  if (!JOOBLE_API_KEY || !JOOBLE_ENABLED) {
    return {
      ok: false,
      count: 0,
      rawCount: 0,
      total: 0,
      jobs: [],
      error: 'Jooble is not enabled or not configured',
    };
  }

  try {
    const url = `https://jooble.org/api/${JOOBLE_API_KEY}`;

    const data = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords: keyword,
        location,
        page,
        ResultOnPage: resultsPerPage,
      }),
    });

    const rawJobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const normalized = rawJobs.map((job) =>
      normalizeJoobleJob(job, {
        keyword,
        location,
      })
    );

    const southAfricaOnly = normalized.filter(isProbablySouthAfricanJob);

    return {
      ok: true,
      count: southAfricaOnly.length,
      rawCount: rawJobs.length,
      total: Number(data?.totalCount || data?.total || 0),
      jobs: southAfricaOnly,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      rawCount: 0,
      total: 0,
      jobs: [],
      error: getErrorMessage(error),
    };
  }
}

async function searchJoobleSmart(rawQuery, area, limit = 60) {
  const locations = expandSearchLocations(area);
  const keywords = keywordVariants(rawQuery).slice(0, 4);

  const attempts = [];
  const jobs = [];
  const maxJobs = Math.min(Math.max(limit * 2, 60), 150);

  for (const location of locations) {
    if (jobs.length >= maxJobs) break;

    for (const keyword of keywords) {
      if (jobs.length >= maxJobs) break;

      const result = await searchJoobleOnce(keyword, location, 1, 50);

      attempts.push({
        provider: 'jooble',
        keyword,
        location,
        ok: result.ok,
        count: result.count,
        rawCount: result.rawCount,
        total: result.total,
        error: result.error,
      });

      if (result.ok && result.jobs.length) {
        jobs.push(...result.jobs);
      }
    }
  }

  return {
    ok: true,
    count: jobs.length,
    jobs,
    attempts,
    error: null,
  };
}

/* =========================================================
   OFFICIAL SOURCE CARDS
========================================================= */

function officialSourceCards(rawQuery, area) {
  const q = normalizeLower(rawQuery);
  const requestedArea = normalizeText(area || 'South Africa');

  const cards = [
    {
      title: 'Shoprite Group Careers',
      company: 'Shoprite Group',
      category: 'Retail Jobs',
      sourceUrl: 'https://www.shopriteholdings.co.za/careers.html',
    },
    {
      title: 'Westfalia Fruit Careers',
      company: 'Westfalia Fruit',
      category: 'Agriculture Jobs',
      sourceUrl: 'https://www.westfaliafruit.com/careers/',
    },
    {
      title: 'RCL FOODS Careers',
      company: 'RCL FOODS',
      category: 'Food Manufacturing Jobs',
      sourceUrl: 'https://rclfoods.com/careers/',
    },
    {
      title: 'PPECB Careers',
      company: 'PPECB',
      category: 'Agriculture / Export Jobs',
      sourceUrl: 'https://ppecb.com/careers/',
    },
    {
      title: 'SAYouth Opportunities',
      company: 'SAYouth',
      category: 'Youth Opportunities',
      sourceUrl: 'https://sayouth.mobi/',
    },
    {
      title: 'Greater Tzaneen Municipality Vacancies',
      company: 'Greater Tzaneen Municipality',
      category: 'Government Jobs',
      sourceUrl: 'https://www.greatertzaneen.gov.za/',
    },
    {
      title: 'Limpopo Department of Health Vacancies',
      company: 'Limpopo Department of Health',
      category: 'Government / Healthcare Jobs',
      sourceUrl: 'https://www.ldoh.gov.za/',
    },
  ];

  return cards
    .filter((card) => {
      const text = normalizeLower(`${card.title} ${card.company} ${card.category}`);
      if (!q || q === 'jobs') return true;
      return q
        .split(/\s+/)
        .filter(Boolean)
        .some((word) => text.includes(word)) || true;
    })
    .map((card, index) => ({
      id: `official-${index}-${card.company.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      external_source: 'official_source',
      external_id: `${card.company}-${card.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: card.title,
      company: card.company,
      area: requestedArea,
      town: requestedArea,
      province: extractProvince(requestedArea),
      category: card.category,
      salary: null,
      deadline: null,
      applyUrl: card.sourceUrl,
      apply_url: card.sourceUrl,
      sourceUrl: card.sourceUrl,
      source_url: card.sourceUrl,
      sourceLabel: 'Official career page',
      source_label: 'Official career page',
      sourceType: 'official_source_card',
      source_type: 'official_source_card',
      verificationStatus: 'official_source',
      verification_status: 'official_source',
      actionLabel: 'Open Official Career Page',
      isSourceCard: true,
      description: `Open the official ${card.company} careers page and search for ${rawQuery || 'jobs'} near ${requestedArea}.`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      trustScore: 80,
      foundBy: ['official_source'],
      searchLocation: requestedArea,
      searchKeyword: rawQuery || 'jobs',
      matchNote: 'Official source card',
    }));
}

/* =========================================================
   SUPABASE HELPERS
========================================================= */

async function getSystemAuthorId() {
  if (cachedSystemAuthorId) return cachedSystemAuthorId;
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1);

    if (!error && Array.isArray(data) && data[0]?.id) {
      cachedSystemAuthorId = data[0].id;
      return cachedSystemAuthorId;
    }
  } catch {
    return null;
  }

  return null;
}

async function getSavedJobs(rawQuery, area, limit = 20) {
  if (!supabase) {
    return {
      ok: false,
      count: 0,
      jobs: [],
      error: 'Supabase is not configured',
    };
  }

  try {
    const { data, error } = await supabase
      .from(JOBS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));

    if (error) throw error;

    const jobs = (data || []).map((row) => ({
      id: row.id || `${row.external_source}-${row.external_id}`,
      external_source: row.external_source,
      external_id: row.external_id,
      title: row.title,
      company: row.company,
      area: row.area,
      town: row.town || row.area,
      province: row.province || extractProvince(row.area),
      category: row.category,
      salary: row.salary,
      deadline: row.deadline,
      applyUrl: row.apply_url || row.source_url,
      apply_url: row.apply_url || row.source_url,
      sourceUrl: row.source_url || row.apply_url,
      source_url: row.source_url || row.apply_url,
      sourceLabel: row.source_label || 'Saved job',
      source_label: row.source_label || 'Saved job',
      sourceType: row.source_type || row.external_source || 'saved_job',
      source_type: row.source_type || row.external_source || 'saved_job',
      verificationStatus: row.verification_status || 'needs_verification',
      verification_status: row.verification_status || 'needs_verification',
      actionLabel: 'Open Apply Page',
      isSourceCard: false,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      trustScore: 70,
      foundBy: ['supabase'],
      searchLocation: area,
      searchKeyword: rawQuery,
      matchNote: 'Saved in FaceMeX database',
    }));

    const ranked = filterAndRankJobs(jobs, rawQuery, area, limit);

    return {
      ok: true,
      count: ranked.length,
      jobs: ranked,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      jobs: [],
      error: getErrorMessage(error),
    };
  }
}

async function saveJobsToSupabase(jobs) {
  if (!supabase) {
    return {
      savedToSupabase: 0,
      saveError: 'Supabase is not configured',
    };
  }

  const cleanJobs = dedupeJobs(jobs).filter(
    (job) => job.external_source && job.external_id && job.title
  );

  if (!cleanJobs.length) {
    return {
      savedToSupabase: 0,
      saveError: null,
    };
  }

  const authorId = await getSystemAuthorId();

  const payload = cleanJobs.map((job) => {
    const row = {
      external_source: job.external_source,
      external_id: job.external_id,
      title: normalizeText(job.title),
      company: extractCompanyName(job.company),
      area: normalizeText(job.area || job.town || 'South Africa'),
      town: normalizeText(job.town || job.area || 'South Africa'),
      province: normalizeText(job.province || extractProvince(job.area)),
      category: normalizeText(job.category || 'Jobs'),
      salary: job.salary || null,
      deadline: job.deadline || null,
      apply_url: job.apply_url || job.applyUrl || job.source_url || job.sourceUrl || null,
      source_url: job.source_url || job.sourceUrl || job.apply_url || job.applyUrl || null,
      source_label: job.source_label || job.sourceLabel || 'Job source',
      source_type: job.source_type || job.sourceType || job.external_source,
      verification_status: job.verification_status || job.verificationStatus || 'needs_verification',
      description: truncateText(job.description || '', 1500),
      last_seen_at: nowIso(),
      updated_at: nowIso(),
      created_at: job.createdAt || job.created_at || nowIso(),
    };

    if (authorId) row.author_id = authorId;

    return row;
  });

  try {
    const { data, error } = await supabase
      .from(JOBS_TABLE)
      .upsert(payload, {
        onConflict: 'external_source,external_id',
      })
      .select('external_id');

    if (error) {
      const msg = getErrorMessage(error);

      // Retry without author_id only if the table does not have that column.
      if (msg && msg.toLowerCase().includes('author_id') && msg.toLowerCase().includes('could not find')) {
        const withoutAuthor = payload.map(({ author_id, ...rest }) => rest);

        const retry = await supabase
          .from(JOBS_TABLE)
          .upsert(withoutAuthor, {
            onConflict: 'external_source,external_id',
          })
          .select('external_id');

        if (retry.error) throw retry.error;

        return {
          savedToSupabase: Array.isArray(retry.data) ? retry.data.length : withoutAuthor.length,
          saveError: null,
        };
      }

      throw error;
    }

    return {
      savedToSupabase: Array.isArray(data) ? data.length : payload.length,
      saveError: null,
    };
  } catch (error) {
    return {
      savedToSupabase: 0,
      saveError: getErrorMessage(error),
    };
  }
}

/* =========================================================
   MAIN COMBINED SEARCH
========================================================= */

async function combinedJobSearch({
  rawQuery = 'jobs',
  area = 'South Africa',
  includeExternal = true,
  includeOfficialSources = true,
  limit = 60,
}) {
  const cleanQuery = normalizeText(rawQuery || 'jobs');
  const cleanArea = normalizeText(area || 'South Africa');

  const saved = await getSavedJobs(cleanQuery, cleanArea, Math.min(limit, 30));

  let adzunaResult = {
    ok: false,
    count: 0,
    jobs: [],
    attempts: [],
    error: 'Not requested',
  };

  let joobleResult = {
    ok: false,
    count: 0,
    jobs: [],
    attempts: [],
    error: 'Not requested',
  };

  if (includeExternal) {
    adzunaResult = await searchAdzunaSmart(cleanQuery, cleanArea, limit);
    joobleResult = await searchJoobleSmart(cleanQuery, cleanArea, limit);
  }

  const official = includeOfficialSources ? officialSourceCards(cleanQuery, cleanArea) : [];

  const merged = dedupeJobs([
    ...(saved.jobs || []),
    ...(adzunaResult.jobs || []),
    ...(joobleResult.jobs || []),
    ...official,
  ]);

  const ranked = filterAndRankJobs(merged, cleanQuery, cleanArea, limit);

  const liveJobsToSave = ranked.filter(
    (job) => !job.isSourceCard && ['adzuna', 'jooble'].includes(job.external_source)
  );

  const saveResult = await saveJobsToSupabase(liveJobsToSave);

  const sources = {
    manual: 0,
    supabase: saved.count || 0,
    adzuna: ranked.filter((job) => job.foundBy?.includes('adzuna')).length,
    jooble: ranked.filter((job) => job.foundBy?.includes('jooble')).length,
    joobleAddedUnique: ranked.filter((job) => job.external_source === 'jooble').length,
    joobleDuplicatesSkipped: Math.max(0, (joobleResult.count || 0) - ranked.filter((job) => job.external_source === 'jooble').length),
    officialCards: ranked.filter((job) => job.isSourceCard).length,
  };

  return {
    ok: true,
    source: 'facemex_combined_jobs',
    query: keywordVariants(cleanQuery)[0] || cleanQuery,
    rawQuery: cleanQuery,
    area: cleanArea,
    searchPath: expandSearchLocations(cleanArea),
    keywordPath: keywordVariants(cleanQuery),
    count: ranked.length,
    sources,
    providerStatus: {
      supabaseConfigured: Boolean(supabase),
      adzunaConfigured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
      joobleConfigured: Boolean(JOOBLE_API_KEY && JOOBLE_ENABLED),
      supabase: {
        ok: saved.ok,
        count: saved.count,
        error: saved.error,
      },
      adzuna: {
        ok: adzunaResult.ok,
        count: adzunaResult.count,
        error: adzunaResult.error,
      },
      jooble: {
        ok: joobleResult.ok,
        count: joobleResult.count,
        error: joobleResult.error,
      },
    },
    attempts: {
      adzuna: adzunaResult.attempts || [],
      jooble: joobleResult.attempts || [],
    },
    savedToSupabase: saveResult.savedToSupabase,
    saveError: saveResult.saveError,
    warnings: [],
    jobs: ranked,
  };
}

/* =========================================================
   ROUTES
========================================================= */

router.get('/health', async (req, res) => {
  let supabaseCount = null;
  let supabaseError = null;

  if (supabase) {
    try {
      const { count, error } = await supabase
        .from(JOBS_TABLE)
        .select('*', { count: 'exact', head: true });

      if (error) supabaseError = getErrorMessage(error);
      else supabaseCount = count;
    } catch (error) {
      supabaseError = getErrorMessage(error);
    }
  }

  res.json({
    ok: true,
    service: 'facemex_jobs',
    jobsTable: JOBS_TABLE,
    supabaseConfigured: Boolean(supabase),
    supabaseCount,
    supabaseError,
    adzunaConfigured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
    joobleConfigured: Boolean(JOOBLE_API_KEY),
    joobleEnabled: JOOBLE_ENABLED,
    hasRefreshSecret: Boolean(JOB_REFRESH_SECRET),
    hasSystemAuthorId: Boolean(cachedSystemAuthorId || SYSTEM_AUTHOR_ID),
    time: nowIso(),
  });
});

router.get('/adzuna-test', async (req, res) => {
  const query = normalizeText(req.query.query || 'driver');
  const area = normalizeText(req.query.area || 'Tzaneen');

  const result = await searchAdzunaSmart(query, area, Number(req.query.limit || 20));

  res.json({
    ok: result.ok,
    configured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
    query,
    area,
    count: result.count,
    attempts: result.attempts,
    error: result.error,
    jobs: result.jobs.slice(0, 20),
  });
});

router.get('/jooble-test', async (req, res) => {
  const query = normalizeText(req.query.query || 'driver');
  const area = normalizeText(req.query.area || 'Tzaneen');

  const result = await searchJoobleSmart(query, area, Number(req.query.limit || 20));

  res.json({
    ok: result.ok,
    configured: Boolean(JOOBLE_API_KEY),
    enabled: JOOBLE_ENABLED,
    query,
    area,
    count: result.count,
    attempts: result.attempts,
    error: result.error,
    jobs: result.jobs.slice(0, 20),
  });
});

router.get('/auto-search', async (req, res) => {
  try {
    const rawQuery = normalizeText(req.query.query || req.query.q || 'jobs');
    const area = normalizeText(req.query.area || req.query.location || 'South Africa');

    const includeExternal = String(req.query.includeExternal || 'true').toLowerCase() !== 'false';
    const includeOfficialSources = String(req.query.includeOfficialSources || 'true').toLowerCase() !== 'false';
    const fresh = String(req.query.fresh || 'false').toLowerCase() === 'true';

    const limit = Math.min(Math.max(Number(req.query.limit || 60), 1), 100);

    const cacheKey = JSON.stringify({
      rawQuery,
      area,
      includeExternal,
      includeOfficialSources,
      limit,
    });

    if (!fresh && cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      const ageMs = Date.now() - cached.createdAt;

      if (ageMs < CACHE_MINUTES * 60 * 1000) {
        return res.json({
          ...cached.data,
          cached: true,
          cacheMinutes: CACHE_MINUTES,
        });
      }

      cache.delete(cacheKey);
    }

    const data = await combinedJobSearch({
      rawQuery,
      area,
      includeExternal,
      includeOfficialSources,
      limit,
    });

    cache.set(cacheKey, {
      createdAt: Date.now(),
      data,
    });

    return res.json({
      ...data,
      cached: false,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

router.get('/discover', async (req, res) => {
  try {
    const area = normalizeText(req.query.area || 'Tzaneen');
    const limitPerType = Math.min(Math.max(Number(req.query.limitPerType || 8), 1), 20);

    const queries = [
      'admin',
      'driver',
      'general worker',
      'cashier',
      'cleaner',
      'security',
      'learnership',
      'retail',
    ];

    const groups = {};

    for (const query of queries) {
      const result = await combinedJobSearch({
        rawQuery: query,
        area,
        includeExternal: true,
        includeOfficialSources: false,
        limit: limitPerType,
      });

      groups[query] = result.jobs || [];
    }

    res.json({
      ok: true,
      area,
      limitPerType,
      groups,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

router.get('/list', async (req, res) => {
  try {
    const query = normalizeText(req.query.query || req.query.q || 'jobs');
    const area = normalizeText(req.query.area || 'South Africa');
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);

    const saved = await getSavedJobs(query, area, limit);

    res.json({
      ok: saved.ok,
      source: 'supabase_jobs',
      query,
      area,
      count: saved.count,
      error: saved.error,
      jobs: saved.jobs,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

router.get('/refresh-test', async (req, res) => {
  const secret = normalizeText(req.query.secret || '');

  if (!JOB_REFRESH_SECRET || secret !== JOB_REFRESH_SECRET) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid refresh secret',
    });
  }

  try {
    const query = normalizeText(req.query.query || 'jobs');
    const area = normalizeText(req.query.area || 'Tzaneen');
    const limit = Math.min(Math.max(Number(req.query.limit || 60), 1), 100);

    const result = await combinedJobSearch({
      rawQuery: query,
      area,
      includeExternal: true,
      includeOfficialSources: true,
      limit,
    });

    res.json({
      ...result,
      refreshTest: true,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

router.post('/refresh', async (req, res) => {
  const secret = normalizeText(req.body?.secret || req.query.secret || '');

  if (!JOB_REFRESH_SECRET || secret !== JOB_REFRESH_SECRET) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid refresh secret',
    });
  }

  try {
    const query = normalizeText(req.body?.query || req.query.query || 'jobs');
    const area = normalizeText(req.body?.area || req.query.area || 'Tzaneen');
    const limit = Math.min(Math.max(Number(req.body?.limit || req.query.limit || 60), 1), 100);

    const result = await combinedJobSearch({
      rawQuery: query,
      area,
      includeExternal: true,
      includeOfficialSources: true,
      limit,
    });

    res.json({
      ...result,
      refreshed: true,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

router.post('/', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({
      ok: false,
      error: 'Supabase is not configured',
    });
  }

  try {
    const authorId = req.body?.author_id || (await getSystemAuthorId());

    const payload = {
      external_source: normalizeText(req.body?.external_source || 'manual'),
      external_id: normalizeText(req.body?.external_id || `manual-${Date.now()}`),
      title: normalizeText(req.body?.title),
      company: extractCompanyName(req.body?.company),
      area: normalizeText(req.body?.area || req.body?.town || 'South Africa'),
      town: normalizeText(req.body?.town || req.body?.area || 'South Africa'),
      province: normalizeText(req.body?.province || extractProvince(req.body?.area)),
      category: normalizeText(req.body?.category || 'Jobs'),
      salary: req.body?.salary || null,
      deadline: req.body?.deadline || null,
      apply_url: req.body?.apply_url || req.body?.applyUrl || req.body?.source_url || null,
      source_url: req.body?.source_url || req.body?.sourceUrl || req.body?.apply_url || null,
      source_label: normalizeText(req.body?.source_label || req.body?.sourceLabel || 'Manual job'),
      source_type: normalizeText(req.body?.source_type || req.body?.sourceType || 'manual_job'),
      verification_status: normalizeText(req.body?.verification_status || req.body?.verificationStatus || 'needs_verification'),
      description: truncateText(req.body?.description || '', 1500),
      last_seen_at: nowIso(),
      updated_at: nowIso(),
      created_at: nowIso(),
    };

    if (authorId) payload.author_id = authorId;

    if (!payload.title) {
      return res.status(400).json({
        ok: false,
        error: 'Job title is required',
      });
    }

    const { data, error } = await supabase
      .from(JOBS_TABLE)
      .upsert(payload, {
        onConflict: 'external_source,external_id',
      })
      .select('*')
      .single();

    if (error) throw error;

    res.json({
      ok: true,
      job: data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

router.get('/:jobId/applications', async (req, res) => {
  res.json({
    ok: true,
    jobId: req.params.jobId,
    applications: [],
    message: 'Applications endpoint ready. Connect this to your applications table when needed.',
  });
});

router.post('/:jobId/apply', async (req, res) => {
  res.json({
    ok: true,
    jobId: req.params.jobId,
    message: 'Application received. Connect this to your applications table when needed.',
  });
});

module.exports = router;
