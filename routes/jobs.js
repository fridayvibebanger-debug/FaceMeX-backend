import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const JOBS_TABLE = process.env.SUPABASE_JOBS_TABLE || 'jobs';
const APPLICATIONS_TABLE =
  process.env.SUPABASE_JOB_APPLICATIONS_TABLE || 'job_applications';

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID || '';
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY || '';
const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY || '';
const JOOBLE_ENABLED =
  String(process.env.JOOBLE_ENABLED || 'true').toLowerCase() !== 'false';

const JOB_REFRESH_SECRET = process.env.JOB_REFRESH_SECRET || '';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

let cachedSystemAuthorId = null;
let checkedSystemAuthorId = false;

const GREATER_TZANEEN_AREAS = [
  'Tzaneen',
  'Lenyenye',
  'Nkowankowa',
  'Maake',
  'Maake Plaza',
  'Burgersdorp',
  'Mokgolobotho',
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
  'Letsitele',
  'Letsitele Valley',
];

const LIMPOPO_AREAS = [
  'Limpopo',
  'Tzaneen',
  'Letsitele',
  'Modjadjiskloof',
  'Haenertsburg',
  'Gravelotte',
  'Giyani',
  'Malamulele',
  'Phalaborwa',
  'Ba-Phalaborwa',
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
  'Messina',
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
  'Johannesburg',
  'Pretoria',
  'Tshwane',
  'Soweto',
  'Sandton',
  'Midrand',
  'Centurion',
  'Ekurhuleni',
  'Mpumalanga',
  'Mbombela',
  'Nelspruit',
  'Witbank',
  'Emalahleni',
  'Secunda',
  'North West',
  'Rustenburg',
  'Mahikeng',
  'Free State',
  'Bloemfontein',
  'KwaZulu-Natal',
  'KZN',
  'Durban',
  'Pietermaritzburg',
  'Eastern Cape',
  'Gqeberha',
  'Port Elizabeth',
  'East London',
  'Western Cape',
  'Cape Town',
  'Northern Cape',
  'Kimberley',
  ...LIMPOPO_AREAS,
  ...GREATER_TZANEEN_AREAS,
];

const FOREIGN_LOCATION_WORDS = [
  'united states',
  'usa',
  'u.s.',
  'america',
  'canada',
  'united kingdom',
  'uk',
  'england',
  'scotland',
  'wales',
  'australia',
  'new zealand',
  'india',
  'pakistan',
  'philippines',
  'germany',
  'france',
  'netherlands',
  'spain',
  'italy',
  'poland',
  'ireland',
  'dubai',
  'qatar',
  'saudi',
  'singapore',
];

const OFFICIAL_SOURCES = [
  {
    title: 'Shoprite Group careers',
    company: 'Shoprite Group',
    area: 'South Africa',
    category: 'Retail Jobs',
    sourceUrl: 'https://shoprite.jobs/',
  },
  {
    title: 'Westfalia Fruit careers',
    company: 'Westfalia Fruit',
    area: 'Tzaneen / Limpopo',
    category: 'Agriculture Jobs',
    sourceUrl: 'https://www.westfaliafruit.com/careers/',
  },
  {
    title: 'ZZ2 careers',
    company: 'ZZ2',
    area: 'Limpopo',
    category: 'Agriculture Jobs',
    sourceUrl: 'https://www.zz2.biz/careers/',
  },
  {
    title: 'RCL FOODS careers',
    company: 'RCL FOODS',
    area: 'South Africa',
    category: 'Food / Manufacturing Jobs',
    sourceUrl: 'https://rclfoods.com/careers/',
  },
  {
    title: 'PPECB careers',
    company: 'PPECB',
    area: 'South Africa',
    category: 'Admin / Agriculture Jobs',
    sourceUrl: 'https://ppecb.com/careers/',
  },
  {
    title: 'SAYouth opportunities',
    company: 'SAYouth',
    area: 'South Africa',
    category: 'Youth Opportunities',
    sourceUrl: 'https://sayouth.mobi/',
  },
];

function normalizeText(value = '') {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function escapeLike(value = '') {
  return normalizeText(value).replace(/[%_]/g, '');
}

function uniq(list = []) {
  const seen = new Set();
  const output = [];

  for (const item of list) {
    const clean = normalizeText(item);
    const key = clean.toLowerCase();

    if (!clean || seen.has(key)) continue;

    seen.add(key);
    output.push(clean);
  }

  return output;
}

function safeDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function getDateTime(value) {
  const date = safeDate(value);

  if (!date) return 0;

  return new Date(date).getTime();
}

function daysBetweenNow(dateValue) {
  const time = getDateTime(dateValue);

  if (!time) return null;

  const diff = Date.now() - time;

  if (diff < 0) return 0;

  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function postedLabel(dateValue) {
  const days = daysBetweenNow(dateValue);

  if (days === null) return 'Posted date not stated';
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';

  return `Posted ${days} days ago`;
}

function closingLabel(deadline) {
  const clean = normalizeText(deadline);

  if (!clean) return 'Closing date not stated by source';

  return `Closing date: ${clean}`;
}

function extractCompanyName(company, fallback = 'Company not stated') {
  if (!company) return fallback;

  if (typeof company === 'string') {
    return normalizeText(company) || fallback;
  }

  if (typeof company === 'object') {
    return (
      normalizeText(
        company.display_name ||
          company.name ||
          company.company_name ||
          company.label ||
          company.title ||
          fallback
      ) || fallback
    );
  }

  return normalizeText(company) || fallback;
}

function salaryText(job = {}) {
  const min = job.salary_min || job.salaryMin || null;
  const max = job.salary_max || job.salaryMax || null;

  if (min && max) return `R${Math.round(min)} - R${Math.round(max)}`;
  if (min) return `From R${Math.round(min)}`;
  if (max) return `Up to R${Math.round(max)}`;

  return null;
}

function inferProvince(locationText = '', fallback = '') {
  const combined = normalizeLower(`${locationText} ${fallback}`);

  if (
    /limpopo|tzaneen|polokwane|phalaborwa|hoedspruit|giyani|mokopane|thohoyandou|musina|bela-bela|lephalale|thabazimbi|burgersfort|modimolle|makhado|louis trichardt|marble hall|groblersdal/.test(
      combined
    )
  ) {
    return 'Limpopo';
  }

  if (
    /gauteng|johannesburg|pretoria|tshwane|soweto|sandton|midrand|centurion|ekurhuleni/.test(
      combined
    )
  ) {
    return 'Gauteng';
  }

  if (
    /mpumalanga|mbombela|nelspruit|witbank|emalahleni|secunda|white river/.test(
      combined
    )
  ) {
    return 'Mpumalanga';
  }

  if (/western cape|cape town|bellville|oudtshoorn/.test(combined)) {
    return 'Western Cape';
  }

  if (/kwazulu|kzn|durban|pietermaritzburg/.test(combined)) {
    return 'KwaZulu-Natal';
  }

  if (/eastern cape|gqeberha|port elizabeth|east london/.test(combined)) {
    return 'Eastern Cape';
  }

  if (/free state|bloemfontein/.test(combined)) return 'Free State';
  if (/north west|rustenburg|mahikeng/.test(combined)) return 'North West';
  if (/northern cape|kimberley|kathu/.test(combined)) return 'Northern Cape';
  if (/south africa/.test(combined)) return 'South Africa';

  return normalizeText(fallback) || 'South Africa';
}

function isSupportedAdzunaLocation(location = '') {
  const loc = normalizeLower(location);

  if (!loc || loc === 'africa') return false;

  const unsupportedAfricaCountries = [
    'zimbabwe',
    'botswana',
    'namibia',
    'mozambique',
    'zambia',
    'malawi',
    'kenya',
    'nigeria',
    'ghana',
    'tanzania',
    'uganda',
    'rwanda',
    'ethiopia',
    'egypt',
    'morocco',
  ];

  if (unsupportedAfricaCountries.includes(loc)) return false;

  return true;
}

function isLikelySouthAfricaJob(job = {}) {
  const combined = normalizeLower(
    [
      job.title,
      job.company,
      job.area,
      job.town,
      job.province,
      job.description,
      job.sourceUrl,
      job.source_url,
      job.applyUrl,
      job.apply_url,
    ].join(' ')
  );

  if (!combined) return true;

  if (FOREIGN_LOCATION_WORDS.some((word) => combined.includes(word))) {
    return false;
  }

  if (combined.includes('.co.za')) return true;
  if (combined.includes('south africa')) return true;

  if (
    SOUTH_AFRICA_LOCATIONS.some((location) =>
      combined.includes(normalizeLower(location))
    )
  ) {
    return true;
  }

  if (/\br\s?\d|zar|matric|grade 12|prdp|code 10|code 14/.test(combined)) {
    return true;
  }

  return false;
}

function detectIntent(rawQuery = '') {
  const q = normalizeLower(rawQuery);

  if (
    /\b(driver|drivers|code 10|code 14|courier|delivery|truck|pdp|prdp|fleet|transport|logistics)\b/.test(
      q
    )
  ) {
    return 'driver';
  }

  if (
    /\b(admin|administrator|administration|clerk|receptionist|data capturer|office assistant|personal assistant|pa|secretary|office)\b/.test(
      q
    )
  ) {
    return 'admin';
  }

  if (/\b(cleaner|cleaning|housekeeper|housekeeping)\b/.test(q)) {
    return 'cleaner';
  }

  if (
    /\b(cashier|retail|shop assistant|sales assistant|merchandiser)\b/.test(q)
  ) {
    return 'retail';
  }

  if (/\b(security|guard|armed response)\b/.test(q)) return 'security';

  if (/\b(general worker|packer|warehouse|picker|loader)\b/.test(q)) {
    return 'general';
  }

  return 'general-search';
}

function buildKeywordPath(rawQuery = '') {
  const q = normalizeLower(rawQuery || 'jobs');
  const intent = detectIntent(q);

  if (intent === 'driver') {
    return uniq([
      'driver',
      'delivery driver',
      'courier driver',
      'code 10 driver',
      'code 14 driver',
      'truck driver',
      'logistics driver',
    ]);
  }

  if (intent === 'admin') {
    return uniq([
      'admin clerk',
      'administrator',
      'receptionist',
      'data capturer',
      'office assistant',
      'administrative assistant',
    ]);
  }

  if (intent === 'cleaner') {
    return uniq(['cleaner', 'cleaning', 'housekeeper', 'housekeeping']);
  }

  if (intent === 'retail') {
    return uniq([
      'cashier',
      'retail assistant',
      'shop assistant',
      'sales assistant',
      'merchandiser',
    ]);
  }

  if (intent === 'security') {
    return uniq(['security guard', 'security officer', 'armed response']);
  }

  if (intent === 'general') {
    return uniq(['general worker', 'packer', 'warehouse assistant', 'loader']);
  }

  return uniq([rawQuery || 'jobs', 'general worker', 'learnership', 'internship']);
}

function buildSearchPath(area = '') {
  const cleanArea = normalizeText(area || 'South Africa');
  const lowerArea = cleanArea.toLowerCase();

  const path = [cleanArea];

  if (
    GREATER_TZANEEN_AREAS.some((place) => normalizeLower(place) === lowerArea)
  ) {
    path.push('Tzaneen');
  }

  if (
    GREATER_TZANEEN_AREAS.some((place) => normalizeLower(place) === lowerArea) ||
    LIMPOPO_AREAS.some((place) => normalizeLower(place) === lowerArea) ||
    lowerArea.includes('tzaneen') ||
    lowerArea.includes('limpopo')
  ) {
    path.push('Limpopo');
  }

  path.push('South Africa');

  return uniq(path);
}

function localScore(job = {}, requestedArea = '') {
  const area = normalizeLower(requestedArea);
  const combined = normalizeLower(
    `${job.area} ${job.town} ${job.province} ${job.description}`
  );

  if (!area) return 0;
  if (combined.includes(area)) return 70;
  if (area.includes('tzaneen') && combined.includes('tzaneen')) return 70;
  if (area.includes('limpopo') && combined.includes('limpopo')) return 50;
  if (combined.includes('limpopo')) return 35;
  if (combined.includes('south africa')) return 10;

  return 0;
}

function freshnessScore(job = {}) {
  const date =
    job.createdAt ||
    job.created_at ||
    job.updatedAt ||
    job.updated_at ||
    job.last_seen_at;

  const days = daysBetweenNow(date);

  if (days === null) return 0;
  if (days <= 1) return 50;
  if (days <= 3) return 40;
  if (days <= 7) return 30;
  if (days <= 14) return 18;
  if (days <= 30) return 8;

  return -20;
}

function relevanceScore(job = {}, rawQuery = '', requestedArea = '') {
  const intent = detectIntent(rawQuery);
  const title = normalizeLower(job.title);
  const category = normalizeLower(job.category);
  const description = normalizeLower(job.description);
  const combinedTitle = `${title} ${category}`;
  const combinedAll = `${title} ${category} ${description}`;

  let score = 0;

  score += localScore(job, requestedArea);
  score += freshnessScore(job);

  if (job.external_source === 'supabase') score += 8;
  if (job.external_source === 'adzuna') score += 6;
  if (job.external_source === 'jooble') score += 4;
  if (job.salary) score += 4;

  if (intent === 'driver') {
    if (
      /\b(driver|drivers|bus driver|truck driver|code 10|code 14|courier|delivery driver|prdp|pdp)\b/.test(
        title
      )
    ) {
      score += 120;
    }

    if (/\b(fleet|transport|logistics|warehouse|vehicle|depot)\b/.test(title)) {
      score += 70;
    }

    if (/\b(logistics|warehouse|transport|travel)\b/.test(category)) {
      score += 35;
    }

    if (
      !/\bdriver|fleet|transport|logistics|truck|vehicle|courier|delivery|road|depot|bus|prdp|pdp|code 10|code 14\b/.test(
        combinedTitle
      )
    ) {
      score -= 70;
    }
  }

  if (intent === 'admin') {
    if (
      /\b(admin|administrator|administration|administrative|clerk|receptionist|data capturer|office assistant|personal assistant|secretary|payroll administrator|hr clerk|finance assistant)\b/.test(
        title
      )
    ) {
      score += 120;
    }

    if (/\b(admin|administrative|office|clerical|hr|finance|reception)\b/.test(category)) {
      score += 35;
    }

    if (
      /\badmin|administrator|administration|administrative|clerk|receptionist|data capture|data capturer|filing|office|payroll|invoices|records|documents\b/.test(
        combinedAll
      )
    ) {
      score += 35;
    }

    if (
      /\bmanager|foreman|technician|electrician|chef|guide|salesperson|financial adviser\b/.test(
        title
      ) &&
      !/\badmin|administrator|administrative|clerk|receptionist|assistant|co-ordinator|coordinator\b/.test(
        title
      )
    ) {
      score -= 65;
    }
  }

  if (intent === 'cleaner' && /\bcleaner|cleaning|housekeeper|housekeeping\b/.test(title)) {
    score += 120;
  }

  if (intent === 'retail' && /\bcashier|retail|shop assistant|sales assistant|merchandiser|salesperson\b/.test(title)) {
    score += 100;
  }

  if (intent === 'security' && /\bsecurity|guard|armed response|protection officer\b/.test(title)) {
    score += 120;
  }

  if (intent === 'general' && /\bgeneral worker|packer|warehouse|picker|loader|assistant\b/.test(title)) {
    score += 100;
  }

  return score;
}

function shouldKeepForIntent(job = {}, rawQuery = '', requestedArea = '') {
  const intent = detectIntent(rawQuery);

  if (!['driver', 'admin', 'cleaner', 'retail', 'security', 'general'].includes(intent)) {
    return true;
  }

  return relevanceScore(job, rawQuery, requestedArea) >= 25;
}

function addDateLabels(job = {}) {
  const date =
    job.createdAt ||
    job.created_at ||
    job.updatedAt ||
    job.updated_at ||
    job.last_seen_at ||
    new Date().toISOString();

  const cleanDate = safeDate(date) || new Date().toISOString();

  return {
    ...job,
    createdAt: safeDate(job.createdAt || job.created_at) || cleanDate,
    updatedAt: safeDate(job.updatedAt || job.updated_at) || cleanDate,
    postedAt: cleanDate,
    postedLabel: postedLabel(cleanDate),
    deadlineLabel: closingLabel(job.deadline),
    ageDays: daysBetweenNow(cleanDate),
  };
}

function isFreshEnough(job = {}, days = 30) {
  if (job.isSourceCard) return true;

  const age = daysBetweenNow(
    job.createdAt ||
      job.created_at ||
      job.updatedAt ||
      job.updated_at ||
      job.last_seen_at
  );

  if (age === null) return true;

  return age <= days;
}

function dedupeJobs(jobs = []) {
  const seen = new Set();
  const output = [];

  for (const job of jobs) {
    const source = normalizeLower(job.external_source || job.sourceType || 'unknown');
    const externalId = normalizeLower(job.external_id || job.id || '');
    const title = normalizeLower(job.title);
    const company = normalizeLower(job.company);
    const area = normalizeLower(job.area || job.town);
    const url = normalizeLower(
      job.applyUrl || job.apply_url || job.sourceUrl || job.source_url
    );

    const key = externalId
      ? `${source}:${externalId}`
      : `${title}:${company}:${area}:${url}`;

    if (!key || seen.has(key)) continue;

    seen.add(key);
    output.push(job);
  }

  return output;
}

function sortJobs(jobs = [], rawQuery = '', requestedArea = '', sortMode = 'date') {
  return [...jobs].sort((a, b) => {
    const bArea = localScore(b, requestedArea);
    const aArea = localScore(a, requestedArea);

    if (bArea !== aArea) return bArea - aArea;

    if (sortMode === 'date') {
      const bTime = getDateTime(
        b.createdAt || b.created_at || b.updatedAt || b.updated_at || b.last_seen_at
      );
      const aTime = getDateTime(
        a.createdAt || a.created_at || a.updatedAt || a.updated_at || a.last_seen_at
      );

      if (bTime !== aTime) return bTime - aTime;
    }

    const bScore = relevanceScore(b, rawQuery, requestedArea);
    const aScore = relevanceScore(a, rawQuery, requestedArea);

    if (bScore !== aScore) return bScore - aScore;

    return normalizeText(a.title).localeCompare(normalizeText(b.title));
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.JOB_FETCH_TIMEOUT_MS || 15000)
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await response.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data?.message || data?.error || `HTTP ${response.status}`,
        data,
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error:
        error?.name === 'AbortError'
          ? 'Request timed out'
          : error?.message || 'Fetch failed',
      data: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAdzunaJob(job = {}, meta = {}) {
  const location = normalizeText(
    job?.location?.display_name || job?.location || meta.location || 'South Africa'
  );

  const applyUrl = normalizeText(job.redirect_url || job.url || job.apply_url || '');
  const createdAt = safeDate(job.created) || new Date().toISOString();

  return addDateLabels({
    id: `adzuna-${job.id}`,
    external_source: 'adzuna',
    external_id: normalizeText(job.id),
    title: normalizeText(job.title || 'Untitled job'),
    company: extractCompanyName(job.company),
    area: location,
    town: location,
    province: inferProvince(location, meta.location),
    category: normalizeText(
      job?.category?.label || job?.category?.tag || job?.category || 'Jobs'
    ),
    salary: salaryText(job),
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
    description: normalizeText(job.description || ''),
    createdAt,
    updatedAt: new Date().toISOString(),
    trustScore: 65,
    foundBy: ['adzuna'],
    searchLocation: meta.location,
    searchKeyword: meta.keyword,
    matchNote: 'Found by Adzuna',
  });
}

function normalizeJoobleJob(job = {}, meta = {}) {
  const location = normalizeText(job.location || meta.location || 'South Africa');
  const applyUrl = normalizeText(job.link || job.url || '');
  const company = extractCompanyName(
    job.company || job.companyName || job.source,
    'Company not stated'
  );

  const createdAt =
    safeDate(job.updated || job.updated_at || job.date || job.created) ||
    new Date().toISOString();

  return addDateLabels({
    id: `jooble-${normalizeText(
      job.id || applyUrl || `${job.title}-${company}-${location}`
    )
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 80)}`,
    external_source: 'jooble',
    external_id: normalizeText(job.id || applyUrl || `${job.title}-${company}-${location}`),
    title: normalizeText(job.title || 'Untitled job'),
    company,
    area: location,
    town: location,
    province: inferProvince(location, meta.location),
    category: normalizeText(job.type || job.category || 'Jobs'),
    salary: normalizeText(job.salary || '') || null,
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
    description: normalizeText(job.snippet || job.description || ''),
    createdAt,
    updatedAt: new Date().toISOString(),
    trustScore: 55,
    foundBy: ['jooble'],
    searchLocation: meta.location,
    searchKeyword: meta.keyword,
    matchNote: 'Found by Jooble',
  });
}

async function fetchAdzunaJobs(keyword, location, options = {}) {
  const page = Number(options.page || 1);
  const resultsPerPage = Number(options.resultsPerPage || 50);
  const sort = options.sort || 'date';
  const days = Number(options.days || 30);

  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return {
      ok: false,
      jobs: [],
      count: 0,
      total: 0,
      skipped: true,
      error: 'Adzuna is not configured',
    };
  }

  if (!isSupportedAdzunaLocation(location)) {
    return {
      ok: true,
      jobs: [],
      count: 0,
      total: 0,
      skipped: true,
      error: 'Skipped because Adzuna ZA only supports South Africa locations',
    };
  }

  const params = new URLSearchParams({
    app_id: ADZUNA_APP_ID,
    app_key: ADZUNA_APP_KEY,
    results_per_page: String(resultsPerPage),
    what: keyword,
    where: location,
    'content-type': 'application/json',
    sort_by: sort === 'date' ? 'date' : 'relevance',
    max_days_old: String(days),
  });

  const url = `https://api.adzuna.com/v1/api/jobs/za/search/${page}?${params.toString()}`;
  const response = await fetchJson(url);

  if (!response.ok) {
    return {
      ok: false,
      jobs: [],
      count: 0,
      total: 0,
      skipped: false,
      error: response.error,
    };
  }

  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  const jobs = results.map((job) => normalizeAdzunaJob(job, { keyword, location }));

  return {
    ok: true,
    jobs,
    count: jobs.length,
    total: Number(response.data?.count || jobs.length || 0),
    skipped: false,
    error: null,
  };
}

async function fetchJoobleJobs(keyword, location, options = {}) {
  const page = Number(options.page || 1);
  const resultsPerPage = Number(options.resultsPerPage || 50);

  if (!JOOBLE_ENABLED) {
    return {
      ok: true,
      jobs: [],
      count: 0,
      rawCount: 0,
      total: 0,
      error: 'Jooble disabled',
    };
  }

  if (!JOOBLE_API_KEY) {
    return {
      ok: false,
      jobs: [],
      count: 0,
      rawCount: 0,
      total: 0,
      error: 'Jooble is not configured',
    };
  }

  const url = `https://jooble.org/api/${JOOBLE_API_KEY}`;

  const response = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      keywords: keyword,
      location,
      page,
      ResultOnPage: resultsPerPage,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      jobs: [],
      count: 0,
      rawCount: 0,
      total: 0,
      error: response.error,
    };
  }

  const rawJobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
  const normalized = rawJobs.map((job) => normalizeJoobleJob(job, { keyword, location }));
  const filtered = normalized.filter(isLikelySouthAfricaJob);

  return {
    ok: true,
    jobs: filtered,
    count: filtered.length,
    rawCount: rawJobs.length,
    total: Number(response.data?.totalCount || response.data?.total || rawJobs.length || 0),
    error: null,
  };
}

async function resolveSystemAuthorId() {
  if (checkedSystemAuthorId) return cachedSystemAuthorId;

  checkedSystemAuthorId = true;

  const envAuthor = normalizeText(
    process.env.JOB_SYSTEM_AUTHOR_ID ||
      process.env.SYSTEM_AUTHOR_ID ||
      process.env.DEFAULT_AUTHOR_ID ||
      process.env.ADMIN_USER_ID ||
      process.env.FACEMEX_ADMIN_USER_ID ||
      ''
  );

  if (envAuthor) {
    cachedSystemAuthorId = envAuthor;
    return cachedSystemAuthorId;
  }

  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!error && data?.id) {
      cachedSystemAuthorId = data.id;
      return cachedSystemAuthorId;
    }
  } catch {
    return null;
  }

  return null;
}

function dbRowFromJob(job = {}, authorId = null) {
  const now = new Date().toISOString();
  const createdAt = safeDate(job.created_at || job.createdAt || job.postedAt) || now;

  return {
    author_id: authorId,
    external_source: normalizeText(job.external_source || 'manual'),
    external_id: normalizeText(
      job.external_id || job.id || `${job.title}-${job.company}-${job.area}`
    ),
    title: normalizeText(job.title || 'Untitled job'),
    company: extractCompanyName(job.company),
    area: normalizeText(job.area || job.town || 'South Africa'),
    town: normalizeText(job.town || job.area || 'South Africa'),
    province: normalizeText(job.province || inferProvince(job.area || job.town || 'South Africa')),
    category: normalizeText(job.category || 'Jobs'),
    salary: job.salary || null,
    deadline: job.deadline || null,
    apply_url: normalizeText(job.apply_url || job.applyUrl || job.source_url || job.sourceUrl || ''),
    source_url: normalizeText(job.source_url || job.sourceUrl || job.apply_url || job.applyUrl || ''),
    source_label: normalizeText(job.source_label || job.sourceLabel || 'Job source'),
    source_type: normalizeText(job.source_type || job.sourceType || job.external_source || 'job_source'),
    verification_status: normalizeText(
      job.verification_status || job.verificationStatus || 'needs_verification'
    ),
    description: normalizeText(job.description || ''),
    last_seen_at: now,
    updated_at: now,
    created_at: createdAt,
  };
}

function publicJobFromDb(row = {}) {
  return addDateLabels({
    id: row.external_id ? `${row.external_source || 'supabase'}-${row.external_id}` : row.id,
    database_id: row.id,
    external_source: row.external_source || 'supabase',
    external_id: row.external_id || row.id,
    title: row.title,
    company: extractCompanyName(row.company),
    area: row.area,
    town: row.town || row.area,
    province: row.province,
    category: row.category,
    salary: row.salary,
    deadline: row.deadline,
    applyUrl: row.apply_url || row.source_url,
    apply_url: row.apply_url || row.source_url,
    sourceUrl: row.source_url || row.apply_url,
    source_url: row.source_url || row.apply_url,
    sourceLabel: row.source_label || 'Saved FaceMeX job',
    source_label: row.source_label || 'Saved FaceMeX job',
    sourceType: row.source_type || row.external_source || 'supabase_saved_job',
    source_type: row.source_type || row.external_source || 'supabase_saved_job',
    verificationStatus: row.verification_status || 'needs_verification',
    verification_status: row.verification_status || 'needs_verification',
    actionLabel: 'Open Apply Page',
    isSourceCard: false,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.last_seen_at,
    trustScore: 70,
    foundBy: ['supabase'],
    matchNote: 'Saved in FaceMeX database',
  });
}

async function fetchSavedJobs(rawQuery = '', area = '', limit = 50) {
  if (!supabase) {
    return {
      ok: false,
      jobs: [],
      count: 0,
      error: 'Supabase is not configured',
    };
  }

  const q = escapeLike(rawQuery);
  const cleanArea = escapeLike(area);

  try {
    let query = supabase
      .from(JOBS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);

    const searchFilters = [];

    if (q) {
      searchFilters.push(`title.ilike.%${q}%`);
      searchFilters.push(`description.ilike.%${q}%`);
      searchFilters.push(`category.ilike.%${q}%`);
      searchFilters.push(`company.ilike.%${q}%`);
    }

    if (searchFilters.length > 0) {
      query = query.or(searchFilters.join(','));
    }

    const { data, error } = await query;

    if (error) {
      return {
        ok: false,
        jobs: [],
        count: 0,
        error: error.message,
      };
    }

    let jobs = (data || []).map(publicJobFromDb);

    if (cleanArea) {
      const areaLower = normalizeLower(cleanArea);

      jobs = jobs.filter((job) => {
        const combined = normalizeLower(
          `${job.area} ${job.town} ${job.province} ${job.description}`
        );

        return (
          combined.includes(areaLower) ||
          combined.includes('limpopo') ||
          combined.includes('south africa')
        );
      });
    }

    return {
      ok: true,
      jobs,
      count: jobs.length,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      jobs: [],
      count: 0,
      error: error?.message || 'Could not fetch saved jobs',
    };
  }
}

async function saveJobsToSupabase(jobs = []) {
  if (!supabase) {
    return {
      savedToSupabase: 0,
      saveError: 'Supabase is not configured',
    };
  }

  if (!Array.isArray(jobs) || jobs.length === 0) {
    return {
      savedToSupabase: 0,
      saveError: null,
    };
  }

  const authorId = await resolveSystemAuthorId();

  if (!authorId) {
    return {
      savedToSupabase: 0,
      saveError:
        'No author_id found. Add JOB_SYSTEM_AUTHOR_ID in Render using your profiles.id value.',
    };
  }

  const rows = dedupeJobs(jobs)
    .filter((job) => !job.isSourceCard)
    .filter((job) =>
      normalizeText(job.apply_url || job.applyUrl || job.source_url || job.sourceUrl)
    )
    .map((job) => dbRowFromJob(job, authorId));

  if (rows.length === 0) {
    return {
      savedToSupabase: 0,
      saveError: null,
    };
  }

  try {
    const { data, error } = await supabase
      .from(JOBS_TABLE)
      .upsert(rows, { onConflict: 'external_source,external_id' })
      .select('id');

    if (error) {
      return {
        savedToSupabase: 0,
        saveError: error.message,
      };
    }

    return {
      savedToSupabase: data?.length || rows.length,
      saveError: null,
    };
  } catch (error) {
    return {
      savedToSupabase: 0,
      saveError: error?.message || 'Could not save jobs',
    };
  }
}

function buildOfficialCards(rawQuery = '', area = '') {
  const now = new Date().toISOString();
  const query = normalizeLower(rawQuery);
  const requested = normalizeLower(area);

  return OFFICIAL_SOURCES.filter((source) => {
    const combined = normalizeLower(
      `${source.title} ${source.company} ${source.area} ${source.category}`
    );

    if (requested.includes('tzaneen') || requested.includes('limpopo')) return true;
    if (query && combined.includes(query)) return true;

    return source.area.toLowerCase().includes('south africa');
  }).map((source, index) =>
    addDateLabels({
      id: `official-${index}-${source.company
        .replace(/[^a-zA-Z0-9]/g, '-')
        .toLowerCase()}`,
      external_source: 'official_source_card',
      external_id: `official-${source.company}`,
      title: source.title,
      company: source.company,
      area: source.area,
      town: source.area,
      province: inferProvince(source.area),
      category: source.category,
      salary: null,
      deadline: null,
      applyUrl: source.sourceUrl,
      apply_url: source.sourceUrl,
      sourceUrl: source.sourceUrl,
      source_url: source.sourceUrl,
      sourceLabel: 'Official company career page',
      source_label: 'Official company career page',
      sourceType: 'official_source_card',
      source_type: 'official_source_card',
      verificationStatus: 'official_source',
      verification_status: 'official_source',
      actionLabel: 'Open Official Careers Page',
      isSourceCard: true,
      description: `Official careers page for ${source.company}. Open this source to check current vacancies directly from the company.`,
      createdAt: now,
      updatedAt: now,
      trustScore: 80,
      foundBy: ['official_source_card'],
      searchLocation: area,
      searchKeyword: rawQuery,
      matchNote: 'Official source page',
    })
  );
}

async function runCombinedSearch({
  rawQuery = 'jobs',
  area = 'South Africa',
  limit = 60,
  includeExternal = true,
  includeOfficialSources = true,
  sort = 'date',
  fresh = true,
  days = 30,
}) {
  const keywordPath = buildKeywordPath(rawQuery);
  const searchPath = buildSearchPath(area);
  const query = keywordPath[0] || rawQuery || 'jobs';

  const attempts = {
    adzuna: [],
    jooble: [],
  };

  const warnings = [];

  const saved = await fetchSavedJobs(rawQuery, area, Math.min(limit, 100));

  let manualJobs = [];
  let externalJobs = [];
  let officialCards = [];
  let adzunaAdded = 0;
  let joobleAdded = 0;
  let joobleDuplicatesSkipped = 0;

  if (saved.ok) {
    manualJobs = saved.jobs;
  } else if (saved.error) {
    warnings.push(saved.error);
  }

  if (includeExternal) {
    for (const location of searchPath) {
      for (const keyword of keywordPath.slice(0, 4)) {
        if (externalJobs.length >= limit * 2) break;

        const adzunaResult = await fetchAdzunaJobs(keyword, location, {
          page: 1,
          resultsPerPage: 50,
          sort,
          days,
        });

        attempts.adzuna.push({
          provider: 'adzuna',
          keyword,
          location,
          ok: adzunaResult.ok,
          count: adzunaResult.count,
          total: adzunaResult.total,
          skipped: adzunaResult.skipped || false,
          error: adzunaResult.error,
        });

        if (adzunaResult.ok && Array.isArray(adzunaResult.jobs)) {
          const filtered = adzunaResult.jobs
            .filter(isLikelySouthAfricaJob)
            .filter((job) => shouldKeepForIntent(job, rawQuery, area))
            .filter((job) => (fresh ? isFreshEnough(job, days) : true));

          externalJobs.push(...filtered);
          adzunaAdded += filtered.length;
        }
      }
    }

    for (const location of searchPath) {
      for (const keyword of keywordPath.slice(0, 4)) {
        if (externalJobs.length >= limit * 3) break;

        const beforeCount = externalJobs.length;

        const joobleResult = await fetchJoobleJobs(keyword, location, {
          page: 1,
          resultsPerPage: 50,
        });

        attempts.jooble.push({
          provider: 'jooble',
          keyword,
          location,
          ok: joobleResult.ok,
          count: joobleResult.count,
          rawCount: joobleResult.rawCount,
          total: joobleResult.total,
          error: joobleResult.error,
        });

        if (joobleResult.ok && Array.isArray(joobleResult.jobs)) {
          const filtered = joobleResult.jobs
            .filter(isLikelySouthAfricaJob)
            .filter((job) => shouldKeepForIntent(job, rawQuery, area))
            .filter((job) => (fresh ? isFreshEnough(job, days) : true));

          externalJobs.push(...filtered);
          joobleAdded += filtered.length;
          joobleDuplicatesSkipped += Math.max(0, joobleResult.rawCount - filtered.length);
        }

        if (
          externalJobs.length === beforeCount &&
          joobleResult.rawCount > 0 &&
          joobleResult.count === 0
        ) {
          joobleDuplicatesSkipped += joobleResult.rawCount;
        }
      }
    }
  }

  if (includeOfficialSources) {
    officialCards = buildOfficialCards(rawQuery, area);
  }

  let merged = dedupeJobs([...manualJobs, ...externalJobs, ...officialCards]);

  merged = merged
    .filter((job) => job.isSourceCard || shouldKeepForIntent(job, rawQuery, area))
    .filter((job) => (fresh ? isFreshEnough(job, days) : true))
    .map((job) =>
      addDateLabels({
        ...job,
        relevanceScore: relevanceScore(job, rawQuery, area),
      })
    );

  merged = sortJobs(merged, rawQuery, area, sort).slice(0, limit);

  const jobsToSave = merged.filter((job) =>
    ['adzuna', 'jooble'].includes(job.external_source)
  );

  const saveResult = await saveJobsToSupabase(jobsToSave);

  return {
    ok: true,
    source: 'facemex_combined_jobs',
    query,
    rawQuery,
    area,
    searchPath,
    keywordPath,
    sort,
    fresh,
    days,
    count: merged.length,
    generatedAt: new Date().toISOString(),
    sources: {
      manual: 0,
      supabase: manualJobs.length,
      adzuna: adzunaAdded,
      jooble: joobleAdded,
      joobleAddedUnique: joobleAdded,
      joobleDuplicatesSkipped,
      officialCards: officialCards.length,
    },
    providerStatus: {
      supabaseConfigured: Boolean(supabase),
      adzunaConfigured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
      joobleConfigured: Boolean(JOOBLE_API_KEY),
      supabase: {
        ok: saved.ok,
        count: manualJobs.length,
        error: saved.error || null,
      },
      adzuna: {
        ok: attempts.adzuna.some((item) => item.ok),
        count: adzunaAdded,
        error:
          attempts.adzuna.find((item) => item.error && !item.skipped)?.error || null,
      },
      jooble: {
        ok: attempts.jooble.some((item) => item.ok),
        count: joobleAdded,
        error: attempts.jooble.find((item) => item.error)?.error || null,
      },
    },
    attempts,
    savedToSupabase: saveResult.savedToSupabase,
    saveError: saveResult.saveError,
    warnings,
    jobs: merged,
  };
}

router.get('/health', async (_req, res) => {
  const authorId = await resolveSystemAuthorId();

  res.json({
    ok: true,
    route: 'jobs',
    jobsTable: JOBS_TABLE,
    applicationsTable: APPLICATIONS_TABLE,
    supabaseConfigured: Boolean(supabase),
    adzunaConfigured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
    joobleConfigured: Boolean(JOOBLE_API_KEY),
    joobleEnabled: JOOBLE_ENABLED,
    systemAuthorReady: Boolean(authorId),
    cacheMinutes: CACHE_TTL_MS / 60000,
    freshDateSorting: true,
    supportedParams: {
      sort: 'date | relevance',
      fresh: 'true | false',
      days: 'number',
      cacheBust: 'any value to skip cache',
      noCache: 'true | false',
    },
  });
});

router.get('/adzuna-test', async (req, res) => {
  const keyword = normalizeText(req.query.query || req.query.keyword || 'driver');
  const area = normalizeText(req.query.area || 'Tzaneen');
  const days = Math.min(Number(req.query.days || 30), 90);
  const sort = normalizeText(req.query.sort || 'date');

  const result = await fetchAdzunaJobs(keyword, area, {
    page: 1,
    resultsPerPage: Number(req.query.limit || 10),
    sort,
    days,
  });

  res.json({
    ok: result.ok,
    configured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
    keyword,
    area,
    sort,
    days,
    count: result.count,
    total: result.total,
    skipped: result.skipped || false,
    error: result.error,
    jobs: result.jobs,
  });
});

router.get('/jooble-test', async (req, res) => {
  const keyword = normalizeText(req.query.query || req.query.keyword || 'driver');
  const area = normalizeText(req.query.area || 'Tzaneen');

  const result = await fetchJoobleJobs(keyword, area, {
    page: 1,
    resultsPerPage: Number(req.query.limit || 10),
  });

  res.json({
    ok: result.ok,
    configured: Boolean(JOOBLE_API_KEY),
    enabled: JOOBLE_ENABLED,
    keyword,
    area,
    count: result.count,
    rawCount: result.rawCount,
    total: result.total,
    error: result.error,
    jobs: result.jobs,
  });
});

router.get('/auto-search', async (req, res) => {
  const rawQuery = normalizeText(req.query.query || req.query.q || 'jobs');
  const area = normalizeText(req.query.area || req.query.location || 'South Africa');
  const limit = Math.min(Number(req.query.limit || 60), 100);

  const includeExternal =
    String(req.query.includeExternal ?? 'true').toLowerCase() !== 'false';

  const includeOfficialSources =
    String(req.query.includeOfficialSources ?? 'true').toLowerCase() !== 'false';

  const sort = normalizeText(req.query.sort || 'date') === 'relevance' ? 'relevance' : 'date';

  const fresh = String(req.query.fresh ?? 'true').toLowerCase() !== 'false';

  const days = Math.min(Math.max(Number(req.query.days || 30), 1), 90);

  const noCache =
    String(req.query.nocache || req.query.noCache || 'false').toLowerCase() === 'true';

  const cacheBust = normalizeText(req.query.cacheBust || req.query.cache_bust || '');

  const shouldSkipCache = noCache || Boolean(cacheBust) || fresh;

  const cacheKey = JSON.stringify({
    rawQuery,
    area,
    limit,
    includeExternal,
    includeOfficialSources,
    sort,
    fresh,
    days,
  });

  const cached = cache.get(cacheKey);

  if (!shouldSkipCache && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return res.json({
      ...cached.data,
      cached: true,
      cacheMinutes: CACHE_TTL_MS / 60000,
    });
  }

  const data = await runCombinedSearch({
    rawQuery,
    area,
    limit,
    includeExternal,
    includeOfficialSources,
    sort,
    fresh,
    days,
  });

  cache.set(cacheKey, {
    createdAt: Date.now(),
    data,
  });

  return res.json({
    ...data,
    cached: false,
    cacheBustUsed: Boolean(cacheBust),
  });
});

router.get('/discover', async (req, res) => {
  const area = normalizeText(req.query.area || 'Tzaneen');
  const limitPerType = Math.min(Number(req.query.limitPerType || 10), 20);
  const sort = normalizeText(req.query.sort || 'date') === 'relevance' ? 'relevance' : 'date';
  const fresh = String(req.query.fresh ?? 'true').toLowerCase() !== 'false';
  const days = Math.min(Math.max(Number(req.query.days || 30), 1), 90);

  const types = ['admin', 'driver', 'general worker', 'cashier', 'cleaner', 'security'];
  const results = {};

  for (const type of types) {
    const data = await runCombinedSearch({
      rawQuery: type,
      area,
      limit: limitPerType,
      includeExternal: true,
      includeOfficialSources: false,
      sort,
      fresh,
      days,
    });

    results[type] = data.jobs;
  }

  res.json({
    ok: true,
    area,
    limitPerType,
    sort,
    fresh,
    days,
    results,
  });
});

router.get('/refresh-test', async (req, res) => {
  const secret = normalizeText(req.query.secret || '');

  if (JOB_REFRESH_SECRET && secret !== JOB_REFRESH_SECRET) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid refresh secret',
    });
  }

  const rawQuery = normalizeText(req.query.query || 'jobs');
  const area = normalizeText(req.query.area || 'Tzaneen');
  const limit = Math.min(Number(req.query.limit || 60), 100);
  const sort = normalizeText(req.query.sort || 'date') === 'relevance' ? 'relevance' : 'date';
  const fresh = String(req.query.fresh ?? 'true').toLowerCase() !== 'false';
  const days = Math.min(Math.max(Number(req.query.days || 30), 1), 90);

  const data = await runCombinedSearch({
    rawQuery,
    area,
    limit,
    includeExternal: true,
    includeOfficialSources: true,
    sort,
    fresh,
    days,
  });

  return res.json(data);
});

router.post('/refresh', async (req, res) => {
  const secret = normalizeText(req.body?.secret || req.query.secret || '');

  if (JOB_REFRESH_SECRET && secret !== JOB_REFRESH_SECRET) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid refresh secret',
    });
  }

  const rawQuery = normalizeText(req.body?.query || req.query.query || 'jobs');
  const area = normalizeText(req.body?.area || req.query.area || 'Tzaneen');
  const limit = Math.min(Number(req.body?.limit || req.query.limit || 60), 100);
  const sort =
    normalizeText(req.body?.sort || req.query.sort || 'date') === 'relevance'
      ? 'relevance'
      : 'date';
  const fresh =
    String(req.body?.fresh ?? req.query.fresh ?? 'true').toLowerCase() !== 'false';
  const days = Math.min(Math.max(Number(req.body?.days || req.query.days || 30), 1), 90);

  const data = await runCombinedSearch({
    rawQuery,
    area,
    limit,
    includeExternal: true,
    includeOfficialSources: true,
    sort,
    fresh,
    days,
  });

  return res.json(data);
});

router.get('/list', async (req, res) => {
  const rawQuery = normalizeText(req.query.query || req.query.q || '');
  const area = normalizeText(req.query.area || '');
  const limit = Math.min(Number(req.query.limit || 50), 100);

  const saved = await fetchSavedJobs(rawQuery, area, limit);

  return res.json({
    ok: saved.ok,
    count: saved.jobs.length,
    error: saved.error,
    jobs: saved.jobs,
  });
});

router.post('/', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({
      ok: false,
      error: 'Supabase is not configured',
    });
  }

  const body = req.body || {};
  const title = normalizeText(body.title);

  if (!title) {
    return res.status(400).json({
      ok: false,
      error: 'Job title is required',
    });
  }

  const authorId =
    normalizeText(body.author_id || body.authorId) || (await resolveSystemAuthorId());

  if (!authorId) {
    return res.status(400).json({
      ok: false,
      error: 'No author_id found. Add JOB_SYSTEM_AUTHOR_ID in Render.',
    });
  }

  const job = {
    external_source: body.external_source || 'manual',
    external_id: body.external_id || `manual-${Date.now()}`,
    title,
    company: body.company || 'Company not stated',
    area: body.area || body.town || 'South Africa',
    town: body.town || body.area || 'South Africa',
    province: body.province || inferProvince(body.area || body.town),
    category: body.category || 'Jobs',
    salary: body.salary || null,
    deadline: body.deadline || null,
    apply_url: body.apply_url || body.applyUrl || body.source_url || body.sourceUrl || '',
    source_url: body.source_url || body.sourceUrl || body.apply_url || body.applyUrl || '',
    source_label: body.source_label || body.sourceLabel || 'FaceMeX manual job',
    source_type: body.source_type || body.sourceType || 'manual_job',
    verification_status:
      body.verification_status || body.verificationStatus || 'needs_verification',
    description: body.description || '',
  };

  const row = dbRowFromJob(job, authorId);

  const { data, error } = await supabase.from(JOBS_TABLE).insert(row).select('*').single();

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
    });
  }

  return res.status(201).json({
    ok: true,
    job: publicJobFromDb(data),
  });
});

router.get('/:jobId/applications', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({
      ok: false,
      error: 'Supabase is not configured',
    });
  }

  const jobId = normalizeText(req.params.jobId);

  const { data, error } = await supabase
    .from(APPLICATIONS_TABLE)
    .select('*')
    .or(`job_id.eq.${jobId},external_job_id.eq.${jobId}`)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
      applications: [],
    });
  }

  return res.json({
    ok: true,
    count: data?.length || 0,
    applications: data || [],
  });
});

router.post('/:jobId/apply', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({
      ok: false,
      error: 'Supabase is not configured',
    });
  }

  const jobId = normalizeText(req.params.jobId);
  const body = req.body || {};

  const userId = normalizeText(
    body.user_id || body.userId || body.applicant_id || body.applicantId || ''
  );

  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id is required',
    });
  }

  const row = {
    job_id: jobId,
    external_job_id: jobId,
    user_id: userId,
    status: normalizeText(body.status || 'started'),
    notes: normalizeText(body.notes || ''),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(APPLICATIONS_TABLE)
    .insert(row)
    .select('*')
    .single();

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
    });
  }

  return res.status(201).json({
    ok: true,
    application: data,
  });
});

export default router;
