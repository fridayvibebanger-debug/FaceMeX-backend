import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();

/* -------------------------------------------------------------------------- */
/* ENV + CONFIG                                                               */
/* -------------------------------------------------------------------------- */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_JOBS_TABLE = process.env.SUPABASE_JOBS_TABLE || 'jobs';

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID || '';
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY || '';

const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY || '';
const JOOBLE_ENABLED = String(process.env.JOOBLE_ENABLED || 'true').toLowerCase() !== 'false';

const JOB_REFRESH_SECRET = process.env.JOB_REFRESH_SECRET || '';
const SYSTEM_JOB_AUTHOR_ID = process.env.SYSTEM_JOB_AUTHOR_ID || process.env.DEFAULT_JOB_AUTHOR_ID || '';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

const CACHE_TTL_MS = 10 * 60 * 1000;
const memoryCache = new Map();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

/* -------------------------------------------------------------------------- */
/* LOCATION DATA                                                              */
/* -------------------------------------------------------------------------- */

const GREATER_TZANEEN_VILLAGES_TOWNSHIPS = [
  'Lenyenye',
  'Nkowankowa',
  'Maake',
  'Maake Plaza',
  'Burgersdorp',
  'Mokgolobotho',
  'Mokgoloboto',
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
];

const AFRICA_LOCATIONS = [
  'Africa',
  'South Africa',
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

const OFFICIAL_SOURCES = [
  {
    title: 'Shoprite Group Careers',
    company: 'Shoprite Group',
    area: 'South Africa',
    province: 'South Africa',
    category: 'Retail Jobs',
    applyUrl: 'https://shoprite.jobs/',
    sourceUrl: 'https://shoprite.jobs/',
    description: 'Official Shoprite Group careers page for retail, store, warehouse and support roles.',
  },
  {
    title: 'Westfalia Fruit Careers',
    company: 'Westfalia Fruit',
    area: 'Tzaneen / Limpopo',
    province: 'Limpopo',
    category: 'Agriculture Jobs',
    applyUrl: 'https://www.westfaliafruit.com/careers/',
    sourceUrl: 'https://www.westfaliafruit.com/careers/',
    description: 'Official Westfalia Fruit careers page for agriculture, packhouse, admin and technical roles.',
  },
  {
    title: 'RCL FOODS Careers',
    company: 'RCL FOODS',
    area: 'South Africa',
    province: 'South Africa',
    category: 'Food Production Jobs',
    applyUrl: 'https://rclfoods.com/careers/',
    sourceUrl: 'https://rclfoods.com/careers/',
    description: 'Official RCL FOODS careers page for baking, logistics, production, admin and support roles.',
  },
  {
    title: 'PPECB Careers',
    company: 'PPECB',
    area: 'South Africa',
    province: 'South Africa',
    category: 'Agriculture / Inspection Jobs',
    applyUrl: 'https://ppecb.com/careers/',
    sourceUrl: 'https://ppecb.com/careers/',
    description: 'Official PPECB careers page for inspection, admin and agricultural export quality roles.',
  },
  {
    title: 'SAYouth Opportunities',
    company: 'SAYouth',
    area: 'South Africa',
    province: 'South Africa',
    category: 'Youth Opportunities',
    applyUrl: 'https://sayouth.mobi/',
    sourceUrl: 'https://sayouth.mobi/',
    description: 'Official SAYouth platform for learnerships, entry-level work and youth opportunities.',
  },
  {
    title: 'Greater Tzaneen Municipality Vacancies',
    company: 'Greater Tzaneen Municipality',
    area: 'Tzaneen',
    province: 'Limpopo',
    category: 'Government Jobs',
    applyUrl: 'https://www.greatertzaneen.gov.za/',
    sourceUrl: 'https://www.greatertzaneen.gov.za/',
    description: 'Official Greater Tzaneen Municipality website for municipal notices and vacancies.',
  },
  {
    title: 'Polokwane Municipality Vacancies',
    company: 'Polokwane Municipality',
    area: 'Polokwane',
    province: 'Limpopo',
    category: 'Government Jobs',
    applyUrl: 'https://www.polokwane.gov.za/',
    sourceUrl: 'https://www.polokwane.gov.za/',
    description: 'Official Polokwane Municipality website for municipal vacancies and notices.',
  },
  {
    title: 'Limpopo Department of Health Vacancies',
    company: 'Limpopo Department of Health',
    area: 'Limpopo',
    province: 'Limpopo',
    category: 'Healthcare / Government Jobs',
    applyUrl: 'https://www.dhsd.limpopo.gov.za/',
    sourceUrl: 'https://www.dhsd.limpopo.gov.za/',
    description: 'Official Limpopo government health vacancy source.',
  },
];

/* -------------------------------------------------------------------------- */
/* BASIC HELPERS                                                              */
/* -------------------------------------------------------------------------- */

function normalizeText(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'object') return '';

  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€“/g, '-')
    .replace(/â€”/g, '-')
    .replace(/â??/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompanyName(company) {
  if (!company) return 'Company not listed';

  if (typeof company === 'string') {
    return normalizeText(company) || 'Company not listed';
  }

  if (typeof company === 'object') {
    return (
      normalizeText(
        company.display_name ||
          company.name ||
          company.company_name ||
          company.title ||
          company.label ||
          company.value ||
          ''
      ) || 'Company not listed'
    );
  }

  return normalizeText(String(company)) || 'Company not listed';
}

function lowerText(value) {
  return normalizeText(value || '').toLowerCase();
}

function truncateText(value, max = 700) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).toLowerCase().trim();
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
}

function safeLimit(value, fallback = 60, max = 120) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

function uniqueArray(items = []) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const clean = normalizeText(item);
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(clean);
  }

  return output;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function getHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function buildCacheKey(payload) {
  return JSON.stringify(payload).toLowerCase();
}

function getCache(key) {
  const item = memoryCache.get(key);
  if (!item) return null;

  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value) {
  memoryCache.set(key, {
    createdAt: Date.now(),
    value,
  });
}

async function readLocalJobs() {
  try {
    const raw = await fs.readFile(LOCAL_JOBS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalJobs(jobs) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf8');
}

async function fetchJson(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
      const message =
        data?.message ||
        data?.error ||
        data?.error_description ||
        response.statusText ||
        `HTTP ${response.status}`;

      return {
        ok: false,
        status: response.status,
        data,
        error: message,
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'Request failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* LOCATION HELPERS                                                           */
/* -------------------------------------------------------------------------- */

function isSameText(a, b) {
  return lowerText(a) === lowerText(b);
}

function containsFromList(value, list) {
  const text = lowerText(value);
  return list.some((item) => text.includes(lowerText(item)));
}

function isGreaterTzaneenVillage(area = '') {
  return GREATER_TZANEEN_VILLAGES_TOWNSHIPS.some((item) => isSameText(item, area));
}

function isLimpopoTown(area = '') {
  return LIMPOPO_TOWNS_CITIES.some((item) => isSameText(item, area));
}

function isSouthAfricaLocation(area = '') {
  return SOUTH_AFRICA_LOCATIONS.some((item) => isSameText(item, area));
}

function isAfricaLocation(area = '') {
  return AFRICA_LOCATIONS.some((item) => isSameText(item, area));
}

function getProvinceFromArea(area = '') {
  const text = lowerText(area);

  if (
    text.includes('tzaneen') ||
    text.includes('limpopo') ||
    text.includes('polokwane') ||
    text.includes('phalaborwa') ||
    text.includes('hoedspruit') ||
    text.includes('giyani') ||
    text.includes('thohoyandou') ||
    text.includes('mokopane') ||
    text.includes('lephalale') ||
    text.includes('burgersfort') ||
    text.includes('musina') ||
    text.includes('mankweng') ||
    text.includes('seshego')
  ) {
    return 'Limpopo';
  }

  if (
    text.includes('johannesburg') ||
    text.includes('pretoria') ||
    text.includes('tshwane') ||
    text.includes('gauteng') ||
    text.includes('sandton') ||
    text.includes('midrand') ||
    text.includes('centurion')
  ) {
    return 'Gauteng';
  }

  if (text.includes('western cape') || text.includes('cape town') || text.includes('bellville')) {
    return 'Western Cape';
  }

  if (text.includes('mpumalanga') || text.includes('mbombela') || text.includes('nelspruit')) {
    return 'Mpumalanga';
  }

  if (text.includes('free state') || text.includes('bloemfontein')) {
    return 'Free State';
  }

  if (text.includes('kwazulu') || text.includes('durban') || text.includes('kzn')) {
    return 'KwaZulu-Natal';
  }

  if (text.includes('eastern cape') || text.includes('gqeberha') || text.includes('east london')) {
    return 'Eastern Cape';
  }

  if (text.includes('northern cape') || text.includes('kimberley') || text.includes('kathu')) {
    return 'Northern Cape';
  }

  if (text.includes('north west') || text.includes('rustenburg')) {
    return 'North West';
  }

  if (text.includes('south africa')) return 'South Africa';

  return 'South Africa';
}

function expandSearchLocations(area = '') {
  const cleanArea = normalizeText(area || 'South Africa');

  if (!cleanArea) return ['South Africa'];

  if (isGreaterTzaneenVillage(cleanArea)) {
    return uniqueArray([cleanArea, 'Tzaneen', 'Limpopo', 'South Africa', 'Africa']);
  }

  if (isLimpopoTown(cleanArea)) {
    return uniqueArray([cleanArea, 'Limpopo', 'South Africa', 'Africa']);
  }

  if (isSameText(cleanArea, 'Limpopo')) {
    return uniqueArray(['Limpopo', 'South Africa', 'Africa']);
  }

  if (isSameText(cleanArea, 'South Africa')) {
    return uniqueArray(['South Africa', 'Africa']);
  }

  if (isSameText(cleanArea, 'Africa')) {
    return uniqueArray([
      'Africa',
      'South Africa',
      'Zimbabwe',
      'Botswana',
      'Namibia',
      'Mozambique',
      'Zambia',
      'Kenya',
      'Nigeria',
      'Ghana',
    ]);
  }

  if (isSouthAfricaLocation(cleanArea)) {
    return uniqueArray([cleanArea, 'South Africa', 'Africa']);
  }

  if (isAfricaLocation(cleanArea)) {
    return uniqueArray([cleanArea, 'Africa']);
  }

  return uniqueArray([cleanArea, 'South Africa', 'Africa']);
}

/* -------------------------------------------------------------------------- */
/* KEYWORD + INTENT HELPERS                                                   */
/* -------------------------------------------------------------------------- */

function keywordVariants(query = '') {
  const q = lowerText(query || 'jobs');

  if (!q || q === 'jobs' || q === 'job' || q === 'vacancies' || q === 'work') {
    return ['jobs', 'vacancies', 'general worker', 'learnership', 'assistant'];
  }

  if (/\b(driver|drivers|code 10|code 14|truck|courier|delivery|fleet|transport|prdp|pdp)\b/i.test(q)) {
    return uniqueArray([
      'driver code 10 code 14 delivery courier logistics truck driver',
      'driver',
      'delivery driver',
      'courier driver',
      'code 10 driver',
      'code 14 driver',
      'truck driver',
      'logistics driver',
    ]);
  }

  if (/\b(admin|administrator|administrative|clerk|receptionist|data capturer|office assistant|personal assistant|secretary|pa)\b/i.test(q)) {
    return uniqueArray([
      'admin clerk receptionist data capturer office assistant',
      'admin clerk',
      'administrator',
      'receptionist',
      'data capturer',
      'office assistant',
    ]);
  }

  if (/\b(cashier|retail|shop|store|sales assistant|teller)\b/i.test(q)) {
    return uniqueArray(['cashier retail store assistant sales assistant', 'cashier', 'retail assistant', 'store assistant', 'sales assistant']);
  }

  if (/\b(cleaner|cleaning|housekeeper|housekeeping)\b/i.test(q)) {
    return uniqueArray(['cleaner housekeeping general worker', 'cleaner', 'housekeeper', 'cleaning']);
  }

  if (/\b(security|guard|psira)\b/i.test(q)) {
    return uniqueArray(['security guard psira', 'security officer', 'security guard', 'psira']);
  }

  if (/\b(farm|agriculture|packhouse|macadamia|avocado|citrus)\b/i.test(q)) {
    return uniqueArray(['farm worker agriculture packhouse', 'farm worker', 'agriculture', 'packhouse', 'citrus', 'macadamia']);
  }

  if (/\b(learnership|internship|intern|graduate|yes)\b/i.test(q)) {
    return uniqueArray(['learnership internship graduate YES youth', 'learnership', 'internship', 'graduate programme', 'YES programme']);
  }

  if (/\b(warehouse|packer|picker|stock|logistics)\b/i.test(q)) {
    return uniqueArray(['warehouse packer picker stock logistics', 'warehouse', 'packer', 'picker', 'stock controller', 'logistics']);
  }

  return uniqueArray([query, q]);
}

function getSearchIntent(rawQuery = '') {
  const q = lowerText(rawQuery);

  if (/\b(driver|drivers|code 10|code 14|truck|bus driver|courier|delivery|fleet|transport|prdp|pdp)\b/i.test(q)) {
    return 'driver';
  }

  if (/\b(admin|administrator|administrative|clerk|receptionist|data capturer|office assistant|personal assistant|secretary|pa)\b/i.test(q)) {
    return 'admin';
  }

  if (/\b(cashier|retail|shop|store|sales assistant|teller)\b/i.test(q)) {
    return 'retail';
  }

  if (/\b(cleaner|cleaning|housekeeper|housekeeping)\b/i.test(q)) {
    return 'cleaning';
  }

  if (/\b(security|guard|psira)\b/i.test(q)) {
    return 'security';
  }

  if (/\b(farm|agriculture|packhouse|macadamia|avocado|citrus)\b/i.test(q)) {
    return 'farm';
  }

  if (/\b(learnership|internship|intern|graduate|yes)\b/i.test(q)) {
    return 'youth';
  }

  return 'general';
}

/* -------------------------------------------------------------------------- */
/* GEOGRAPHY FILTERS                                                          */
/* -------------------------------------------------------------------------- */

function isLikelyForeignJob(job = {}) {
  const text = lowerText(
    [
      job.title,
      job.company,
      job.area,
      job.town,
      job.province,
      job.category,
      job.description,
      job.applyUrl,
      job.apply_url,
      job.sourceUrl,
      job.source_url,
    ].join(' ')
  );

  const host = getHost(job.applyUrl || job.apply_url || job.sourceUrl || job.source_url || '');

  if (
    /\b(united states|usa|u\.s\.|america|canada|united kingdom|uk|australia|new zealand|ireland)\b/i.test(text)
  ) {
    return true;
  }

  if (/\b(pennsylvania|maryland|texas|florida|california|new york|ohio|illinois|georgia|virginia)\b/i.test(text)) {
    return true;
  }

  if (/\b(pa|md|tx|fl|ca|ny|oh|il|ga|va)\s+\d{5}\b/i.test(text)) {
    return true;
  }

  if (/\b(cdl|per mile|hourly pay|401k|us citizen)\b/i.test(text)) {
    return true;
  }

  if (/\$\s?\d+/i.test(text) && !/\bzar|rand|south africa|limpopo|gauteng|cape town|johannesburg|polokwane|tzaneen\b/i.test(text)) {
    return true;
  }

  if (
    host.endsWith('.us') ||
    host.endsWith('.uk') ||
    host.endsWith('.ca') ||
    host.endsWith('.au') ||
    host.includes('ziprecruiter.com') ||
    host.includes('monster.com') ||
    host.includes('indeed.com') ||
    host.includes('snagajob.com')
  ) {
    return true;
  }

  return false;
}

function hasSouthAfricaSignal(job = {}) {
  const text = lowerText(
    [
      job.title,
      job.company,
      job.area,
      job.town,
      job.province,
      job.description,
      job.applyUrl,
      job.apply_url,
      job.sourceUrl,
      job.source_url,
    ].join(' ')
  );

  return /\b(south africa|limpopo|gauteng|mpumalanga|western cape|eastern cape|kwazulu|kzn|free state|north west|northern cape|tzaneen|polokwane|johannesburg|pretoria|cape town|durban|phalaborwa|hoedspruit|nelspruit|mbombela|thohoyandou|mokopane|lephalale|burgersfort|musina|kathu)\b/i.test(
    text
  );
}

function isAllowedGeography(job = {}, requestedArea = '', provider = '') {
  if (provider === 'adzuna') return true;

  if (isLikelyForeignJob(job)) return false;

  const requested = lowerText(requestedArea);

  if (requested.includes('south africa') || requested.includes('limpopo') || requested.includes('tzaneen')) {
    return hasSouthAfricaSignal(job);
  }

  if (requested.includes('africa')) {
    return hasSouthAfricaSignal(job) || containsFromList(job.area || job.description || '', AFRICA_LOCATIONS);
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* RELEVANCE RANKING                                                          */
/* -------------------------------------------------------------------------- */

function queryRelevanceScore(job, rawQuery = '', requestedArea = '') {
  const intent = getSearchIntent(rawQuery);

  const title = lowerText(job.title);
  const category = lowerText(job.category);
  const description = lowerText(job.description);
  const area = lowerText(job.area || job.town || '');
  const company = lowerText(job.company);
  const requested = lowerText(requestedArea);

  let score = 0;

  if (requested && area.includes(requested)) score += 40;
  if (requested && description.includes(requested)) score += 8;
  if (area.includes('tzaneen')) score += 25;
  if (area.includes('limpopo')) score += 15;
  if (area.includes('south africa')) score += 5;

  const createdTime = new Date(job.createdAt || job.created_at || job.updatedAt || job.updated_at || 0).getTime();
  if (createdTime) {
    const daysOld = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);

    if (daysOld <= 3) score += 20;
    else if (daysOld <= 14) score += 12;
    else if (daysOld <= 45) score += 6;
  }

  if (intent === 'driver') {
    if (/\b(driver|drivers|salesman driver|bus driver|truck driver|ultra-heavy|heavy vehicle|code 10|code 14|courier|delivery driver|prdp|pdp)\b/i.test(title)) score += 130;
    if (/\b(fleet|transport|logistics|road supervisor|vehicle|truck|depot|workshop foreman)\b/i.test(title)) score += 70;
    if (/\b(logistics|warehouse|travel)\b/i.test(category)) score += 35;
    if (/\b(driver|drivers|delivery|courier|truck|vehicle|fleet|transport|prdp|pdp|code 10|code 14)\b/i.test(description)) score += 20;

    if (
      /\bdriver'?s? licence|drivers license|valid driver|driver license/i.test(description) &&
      !/\b(driver|drivers|fleet|transport|truck|courier|delivery|vehicle|road supervisor|depot|bus)\b/i.test(title)
    ) {
      score -= 90;
    }

    if (/\b(hotel general manager|lodge manager|financial advisor|sales representative|branch manager|trainee manager|chef|guide)\b/i.test(title)) {
      score -= 70;
    }
  }

  if (intent === 'admin') {
    if (/\b(admin|administrator|administrative|administration|clerk|receptionist|data capturer|office assistant|personal assistant|secretary|payroll|hr clerk|finance assistant|service administrator|reservations)\b/i.test(title)) score += 130;
    if (/\b(admin|administration|hr|recruitment|finance|accounting|customer service)\b/i.test(category)) score += 45;
    if (/\b(admin|administrative|clerk|reception|filing|data capture|office|payroll|reservations|invoices|documentation|records)\b/i.test(description)) score += 25;

    if (
      /\b(manager|salesperson|technician|electrician|chef|guide|driver|foreman)\b/i.test(title) &&
      !/\b(admin|administrator|administrative|administration|clerk|receptionist|assistant|pa|secretary|payroll|hr|finance)\b/i.test(title)
    ) {
      score -= 80;
    }
  }

  if (intent === 'retail') {
    if (/\b(cashier|retail|sales assistant|store assistant|shop assistant|teller|merchandiser)\b/i.test(title)) score += 120;
    if (/\b(retail|sales|customer service)\b/i.test(category)) score += 40;
    if (/\b(cashier|retail|store|shop|sales|merchandise|customer)\b/i.test(description)) score += 20;
  }

  if (intent === 'cleaning') {
    if (/\b(cleaner|cleaning|housekeeper|housekeeping|general worker)\b/i.test(title)) score += 120;
    if (/\b(cleaner|cleaning|housekeeping|hygiene)\b/i.test(description)) score += 25;
  }

  if (intent === 'security') {
    if (/\b(security|guard|psira|risk controller|loss prevention)\b/i.test(title)) score += 120;
    if (/\b(security|guard|psira|risk|loss prevention)\b/i.test(description)) score += 25;
  }

  if (intent === 'farm') {
    if (/\b(farm|agriculture|packhouse|macadamia|avocado|citrus|production)\b/i.test(title)) score += 120;
    if (/\b(farm|agriculture|packhouse|macadamia|avocado|citrus|irrigation|harvest)\b/i.test(description)) score += 30;
  }

  if (intent === 'youth') {
    if (/\b(learnership|internship|intern|graduate|yes|junior|trainee)\b/i.test(title)) score += 120;
    if (/\b(learnership|internship|graduate|youth|yes programme|no experience)\b/i.test(description)) score += 30;
  }

  if (intent === 'general') {
    if (title) score += 20;
    if (category) score += 10;
    if (description) score += 5;
  }

  if (company.includes('company not listed')) score -= 5;

  return score;
}

function rankAndFilterJobsForQuery(jobs = [], rawQuery = '', requestedArea = '', limit = 60) {
  const intent = getSearchIntent(rawQuery);

  const ranked = jobs
    .map((job) => ({
      ...job,
      relevanceScore: queryRelevanceScore(job, rawQuery, requestedArea),
    }))
    .filter((job) => {
      if (job.isSourceCard) return true;
      if (intent === 'general') return true;

      return (job.relevanceScore || 0) >= 25;
    })
    .sort((a, b) => {
      if (a.isSourceCard && !b.isSourceCard) return 1;
      if (!a.isSourceCard && b.isSourceCard) return -1;

      if ((b.relevanceScore || 0) !== (a.relevanceScore || 0)) {
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      }

      const bDate = new Date(b.createdAt || b.created_at || b.updatedAt || b.updated_at || 0).getTime();
      const aDate = new Date(a.createdAt || a.created_at || a.updatedAt || a.updated_at || 0).getTime();

      return bDate - aDate;
    });

  return ranked.slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* NORMALIZERS                                                                */
/* -------------------------------------------------------------------------- */

function salaryFromAdzuna(job = {}) {
  const min = job.salary_min;
  const max = job.salary_max;

  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) {
    return `R${Math.round(min)} - R${Math.round(max)}`;
  }

  if (Number.isFinite(min) && min > 0) return `From R${Math.round(min)}`;
  if (Number.isFinite(max) && max > 0) return `Up to R${Math.round(max)}`;

  return null;
}

function normalizeAdzunaJob(job = {}, meta = {}) {
  const locationArea = Array.isArray(job?.location?.area) ? job.location.area : [];
  const areaText = normalizeText(locationArea.slice().reverse().join(', ')) || normalizeText(job?.location?.display_name) || meta.location || 'South Africa';

  const company = normalizeCompanyName(job?.company);

  const title = normalizeText(job?.title) || 'Job opportunity';
  const description = truncateText(job?.description || job?.redirect_url || '', 900);

  const applyUrl = normalizeText(job?.redirect_url || job?.adref || '');
  const externalId = normalizeText(job?.id || applyUrl || `${title}-${company}-${areaText}`);

  return {
    id: `adzuna-${externalId}`,
    external_source: 'adzuna',
    external_id: externalId,
    title,
    company,
    area: areaText,
    town: areaText,
    province: getProvinceFromArea(areaText),
    category: normalizeText(job?.category?.label || job?.category?.tag || 'Jobs'),
    salary: salaryFromAdzuna(job),
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
    description,
    createdAt: normalizeText(job?.created) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trustScore: 65,
    foundBy: ['adzuna'],
    searchLocation: meta.location || null,
    searchKeyword: meta.keyword || null,
    matchNote: 'Found by Adzuna',
  };
}

function normalizeJoobleJob(job = {}, meta = {}) {
  const title = normalizeText(job?.title || job?.position || job?.name) || 'Job opportunity';
  const company = normalizeCompanyName(job?.company || job?.company_name || job?.source);

  const areaText =
    normalizeText(job?.location || job?.city || job?.region || meta.location) ||
    normalizeText(job?.country) ||
    'South Africa';

  const applyUrl = normalizeText(job?.link || job?.url || job?.apply_url || '');
  const externalId = normalizeText(job?.id || job?.guid || applyUrl || `${title}-${company}-${areaText}`);

  const salary = normalizeText(job?.salary || job?.salary_min || job?.salary_max || '') || null;

  return {
    id: `jooble-${externalId}`,
    external_source: 'jooble',
    external_id: externalId,
    title,
    company,
    area: areaText,
    town: areaText,
    province: getProvinceFromArea(areaText),
    category: normalizeText(job?.type || job?.category || 'Jobs'),
    salary,
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
    description: truncateText(job?.snippet || job?.description || job?.text || '', 900),
    createdAt: normalizeText(job?.updated || job?.date || job?.created) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trustScore: 55,
    foundBy: ['jooble'],
    searchLocation: meta.location || null,
    searchKeyword: meta.keyword || null,
    matchNote: 'Found by Jooble',
  };
}

function normalizeDbJob(row = {}) {
  const applyUrl = normalizeText(row.apply_url || row.applyUrl || row.source_url || row.sourceUrl || '');

  return {
    id: normalizeText(row.id || `${row.external_source}-${row.external_id}`),
    external_source: normalizeText(row.external_source || row.externalSource || 'supabase'),
    external_id: normalizeText(row.external_id || row.externalId || row.id || ''),
    title: normalizeText(row.title || 'Job opportunity'),
    company: normalizeCompanyName(row.company),
    area: normalizeText(row.area || row.town || 'South Africa'),
    town: normalizeText(row.town || row.area || 'South Africa'),
    province: normalizeText(row.province || getProvinceFromArea(row.area || row.town)),
    category: normalizeText(row.category || 'Jobs'),
    salary: row.salary || null,
    deadline: row.deadline || null,
    applyUrl,
    apply_url: applyUrl,
    sourceUrl: normalizeText(row.source_url || row.sourceUrl || applyUrl),
    source_url: normalizeText(row.source_url || row.sourceUrl || applyUrl),
    sourceLabel: normalizeText(row.source_label || row.sourceLabel || 'Saved job source'),
    source_label: normalizeText(row.source_label || row.sourceLabel || 'Saved job source'),
    sourceType: normalizeText(row.source_type || row.sourceType || row.external_source || 'saved_job'),
    source_type: normalizeText(row.source_type || row.sourceType || row.external_source || 'saved_job'),
    verificationStatus: normalizeText(row.verification_status || row.verificationStatus || 'needs_verification'),
    verification_status: normalizeText(row.verification_status || row.verificationStatus || 'needs_verification'),
    actionLabel: 'Open Apply Page',
    isSourceCard: false,
    description: truncateText(row.description || '', 900),
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
    trustScore: Number(row.trust_score || row.trustScore || 70),
    foundBy: ['supabase'],
    searchLocation: null,
    searchKeyword: null,
    matchNote: 'Saved in FaceMeX database',
  };
}

function officialSourceCards(area = '', query = '') {
  const wantedArea = lowerText(area);
  const wantedQuery = lowerText(query);

  return OFFICIAL_SOURCES.filter((source) => {
    const sourceArea = lowerText(`${source.area} ${source.province}`);
    const text = lowerText(`${source.title} ${source.company} ${source.category} ${source.description}`);

    const areaMatch =
      !wantedArea ||
      wantedArea === 'south africa' ||
      wantedArea === 'africa' ||
      sourceArea.includes(wantedArea) ||
      sourceArea.includes('south africa') ||
      sourceArea.includes('limpopo');

    const queryMatch =
      !wantedQuery ||
      wantedQuery === 'jobs' ||
      wantedQuery === 'vacancies' ||
      text.includes(wantedQuery) ||
      getSearchIntent(wantedQuery) === 'general';

    return areaMatch && queryMatch;
  }).map((source, index) => ({
    id: `official-${index}-${source.company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    external_source: 'official_source',
    external_id: `${source.company}-${source.title}`,
    title: source.title,
    company: source.company,
    area: source.area,
    town: source.area,
    province: source.province,
    category: source.category,
    salary: null,
    deadline: null,
    applyUrl: source.applyUrl,
    apply_url: source.applyUrl,
    sourceUrl: source.sourceUrl,
    source_url: source.sourceUrl,
    sourceLabel: 'Official company/government careers page',
    source_label: 'Official company/government careers page',
    sourceType: 'official_source_card',
    source_type: 'official_source_card',
    verificationStatus: 'official_source',
    verification_status: 'official_source',
    actionLabel: 'Open Official Source',
    isSourceCard: true,
    description: source.description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trustScore: 95,
    foundBy: ['official_source'],
    searchLocation: area || null,
    searchKeyword: query || null,
    matchNote: 'Official source card',
  }));
}

/* -------------------------------------------------------------------------- */
/* SEARCH PROVIDERS                                                           */
/* -------------------------------------------------------------------------- */

async function searchAdzunaOnce(keyword, location, page = 1, perPage = 50) {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return {
      ok: false,
      count: 0,
      total: 0,
      jobs: [],
      error: 'Adzuna is not configured',
    };
  }

  const params = new URLSearchParams({
    app_id: ADZUNA_APP_ID,
    app_key: ADZUNA_APP_KEY,
    results_per_page: String(perPage),
    what: keyword,
    where: location,
    sort_by: 'date',
    'content-type': 'application/json',
  });

  const url = `https://api.adzuna.com/v1/api/jobs/za/search/${page}?${params.toString()}`;
  const result = await fetchJson(url);

  if (!result.ok) {
    return {
      ok: false,
      count: 0,
      total: 0,
      jobs: [],
      error: result.error,
    };
  }

  const rawJobs = Array.isArray(result.data?.results) ? result.data.results : [];
  const jobs = rawJobs
    .map((job) =>
      normalizeAdzunaJob(job, {
        keyword,
        location,
      })
    )
    .filter((job) => !isLikelyForeignJob(job));

  return {
    ok: true,
    count: jobs.length,
    total: Number(result.data?.count || jobs.length || 0),
    jobs,
    error: null,
  };
}

async function searchAdzunaSmart(rawQuery, area, limit = 60) {
  const locations = expandSearchLocations(area);
  const keywords = keywordVariants(rawQuery);

  const attempts = [];
  const jobs = [];

  const maxJobs = Math.min(Math.max(limit * 2, 60), 120);

  for (const location of locations) {
    if (jobs.length >= maxJobs) break;

    // Adzuna ZA is South Africa only, so skip non-SA Africa countries.
    if (
      !isSameText(location, 'Africa') &&
      !isSameText(location, 'South Africa') &&
      !isSameText(location, 'Limpopo') &&
      !isSouthAfricaLocation(location) &&
      !isLimpopoTown(location) &&
      !isGreaterTzaneenVillage(location)
    ) {
      attempts.push({
        provider: 'adzuna',
        keyword: keywords[0],
        location,
        ok: true,
        count: 0,
        total: 0,
        skipped: true,
        error: 'Skipped because Adzuna ZA only supports South Africa locations',
      });
      continue;
    }

    if (isSameText(location, 'Africa')) {
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

      // Save API calls once we already got enough from a close location.
      if (jobs.length >= limit && (isSameText(location, area) || isSameText(location, 'Tzaneen') || isSameText(location, 'Limpopo'))) {
        break;
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

async function searchJoobleOnce(keyword, location, page = 1, perPage = 50) {
  if (!JOOBLE_ENABLED) {
    return {
      ok: true,
      count: 0,
      rawCount: 0,
      total: 0,
      jobs: [],
      error: null,
    };
  }

  if (!JOOBLE_API_KEY) {
    return {
      ok: false,
      count: 0,
      rawCount: 0,
      total: 0,
      jobs: [],
      error: 'Jooble is not configured',
    };
  }

  const url = `https://jooble.org/api/${encodeURIComponent(JOOBLE_API_KEY)}`;

  const result = await fetchJson(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keywords: keyword,
        location,
        radius: 80,
        page,
        ResultOnPage: perPage,
      }),
    },
    20000
  );

  if (!result.ok) {
    return {
      ok: false,
      count: 0,
      rawCount: 0,
      total: 0,
      jobs: [],
      error: result.error,
    };
  }

  const rawJobs = Array.isArray(result.data?.jobs) ? result.data.jobs : [];
  const jobs = rawJobs
    .map((job) =>
      normalizeJoobleJob(job, {
        keyword,
        location,
      })
    )
    .filter((job) => isAllowedGeography(job, location, 'jooble'));

  return {
    ok: true,
    count: jobs.length,
    rawCount: rawJobs.length,
    total: Number(result.data?.totalCount || result.data?.total || rawJobs.length || 0),
    jobs,
    error: null,
  };
}

async function searchJoobleSmart(rawQuery, area, limit = 60) {
  const locations = expandSearchLocations(area);
  const keywords = keywordVariants(rawQuery);

  const attempts = [];
  const jobs = [];

  const maxJobs = Math.min(Math.max(limit * 2, 60), 120);

  for (const location of locations) {
    if (jobs.length >= maxJobs) break;

    for (const keyword of keywords.slice(0, 4)) {
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

      if (jobs.length >= limit && (isSameText(location, area) || isSameText(location, 'Tzaneen') || isSameText(location, 'Limpopo'))) {
        break;
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

/* -------------------------------------------------------------------------- */
/* SUPABASE + LOCAL STORAGE                                                   */
/* -------------------------------------------------------------------------- */

function localMatch(job = {}, query = '', area = '') {
  const q = lowerText(query);
  const a = lowerText(area);

  const searchable = lowerText(
    [job.title, job.company, job.area, job.town, job.province, job.category, job.description].join(' ')
  );

  const queryOk = !q || q === 'jobs' || searchable.includes(q) || keywordVariants(q).some((kw) => searchable.includes(lowerText(kw)));
  const areaOk = !a || a === 'south africa' || a === 'africa' || searchable.includes(a) || searchable.includes('south africa');

  return queryOk && areaOk;
}

async function searchSupabaseJobs(query = '', area = '', limit = 80) {
  if (!supabase) {
    return {
      ok: true,
      count: 0,
      jobs: [],
      error: null,
    };
  }

  try {
    const { data, error } = await supabase
      .from(SUPABASE_JOBS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(300);

    if (error) {
      return {
        ok: false,
        count: 0,
        jobs: [],
        error: error.message,
      };
    }

    const jobs = (Array.isArray(data) ? data : [])
      .map(normalizeDbJob)
      .filter((job) => localMatch(job, query, area))
      .slice(0, limit);

    return {
      ok: true,
      count: jobs.length,
      jobs,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      jobs: [],
      error: error?.message || 'Supabase search failed',
    };
  }
}

async function searchManualJobs(query = '', area = '', limit = 80) {
  const jobs = await readLocalJobs();

  const filtered = jobs
    .map(normalizeDbJob)
    .filter((job) => localMatch(job, query, area))
    .slice(0, limit);

  return {
    ok: true,
    count: filtered.length,
    jobs: filtered,
    error: null,
  };
}

function jobToSupabaseRow(job = {}) {
  const row = {
    external_source: job.external_source || job.externalSource || 'unknown',
    external_id: job.external_id || job.externalId || job.id || `${job.title}-${job.company}-${job.area}`,
    title: normalizeText(job.title || 'Job opportunity'),
    company: normalizeCompanyName(job.company),
    area: normalizeText(job.area || job.town || 'South Africa'),
    town: normalizeText(job.town || job.area || 'South Africa'),
    province: normalizeText(job.province || getProvinceFromArea(job.area || job.town)),
    category: normalizeText(job.category || 'Jobs'),
    salary: job.salary || null,
    deadline: job.deadline || null,
    apply_url: normalizeText(job.apply_url || job.applyUrl || ''),
    source_url: normalizeText(job.source_url || job.sourceUrl || job.apply_url || job.applyUrl || ''),
    source_label: normalizeText(job.source_label || job.sourceLabel || 'Live job source'),
    source_type: normalizeText(job.source_type || job.sourceType || job.external_source || 'external_job'),
    verification_status: normalizeText(job.verification_status || job.verificationStatus || 'needs_verification'),
    description: truncateText(job.description || '', 1500),
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Only include author_id when you add SYSTEM_JOB_AUTHOR_ID in Render.
  // This avoids overriding a Supabase default with null.
  if (SYSTEM_JOB_AUTHOR_ID) {
    row.author_id = SYSTEM_JOB_AUTHOR_ID;
  }

  if (job.createdAt || job.created_at) {
    row.created_at = job.createdAt || job.created_at;
  }

  return row;
}

async function saveExternalJobsToSupabase(jobs = []) {
  if (!supabase) {
    return {
      savedToSupabase: 0,
      saveError: null,
    };
  }

  const rows = jobs
    .filter((job) => !job.isSourceCard)
    .filter((job) => job.external_source && job.external_id)
    .filter((job) => ['adzuna', 'jooble', 'manual', 'external'].includes(job.external_source))
    .map(jobToSupabaseRow);

  if (!rows.length) {
    return {
      savedToSupabase: 0,
      saveError: null,
    };
  }

  try {
    const { error } = await supabase
      .from(SUPABASE_JOBS_TABLE)
      .upsert(rows, {
        onConflict: 'external_source,external_id',
      });

    if (error) {
      return {
        savedToSupabase: 0,
        saveError: error.message,
      };
    }

    return {
      savedToSupabase: rows.length,
      saveError: null,
    };
  } catch (error) {
    return {
      savedToSupabase: 0,
      saveError: error?.message || 'Saving jobs failed',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* MERGE + DEDUPE                                                             */
/* -------------------------------------------------------------------------- */

function dedupeKey(job = {}) {
  const source = lowerText(job.external_source || job.externalSource);
  const externalId = lowerText(job.external_id || job.externalId);

  if (source && externalId) return `${source}:${externalId}`;

  const title = lowerText(job.title);
  const company = lowerText(job.company);
  const area = lowerText(job.area || job.town);

  return `${title}|${company}|${area}`;
}

function softDedupeKey(job = {}) {
  const title = lowerText(job.title).replace(/[^a-z0-9]+/g, ' ').trim();
  const company = lowerText(job.company).replace(/[^a-z0-9]+/g, ' ').trim();
  const area = lowerText(job.area || job.town).replace(/[^a-z0-9]+/g, ' ').trim();

  return `${title}|${company}|${area}`;
}

function mergeJobsSmart({ manualJobs = [], supabaseJobs = [], adzunaJobs = [], joobleJobs = [], officialCards = [] }) {
  const map = new Map();
  const softMap = new Set();

  const sources = {
    manual: manualJobs.length,
    supabase: supabaseJobs.length,
    adzuna: adzunaJobs.length,
    jooble: joobleJobs.length,
    joobleAddedUnique: 0,
    joobleDuplicatesSkipped: 0,
    officialCards: officialCards.length,
  };

  const addJob = (job, sourceName) => {
    if (!job?.title) return;

    const key = dedupeKey(job);
    const softKey = softDedupeKey(job);

    if (map.has(key) || softMap.has(softKey)) {
      if (sourceName === 'jooble') sources.joobleDuplicatesSkipped += 1;

      const existingKey = map.has(key)
        ? key
        : [...map.keys()].find((mapKey) => softDedupeKey(map.get(mapKey)) === softKey);

      if (existingKey) {
        const existing = map.get(existingKey);
        map.set(existingKey, {
          ...existing,
          foundBy: uniqueArray([...(existing.foundBy || []), ...(job.foundBy || []), sourceName]),
          trustScore: Math.max(Number(existing.trustScore || 0), Number(job.trustScore || 0)),
        });
      }

      return;
    }

    if (sourceName === 'jooble') sources.joobleAddedUnique += 1;

    map.set(key, job);
    softMap.add(softKey);
  };

  supabaseJobs.forEach((job) => addJob(job, 'supabase'));
  manualJobs.forEach((job) => addJob(job, 'manual'));
  adzunaJobs.forEach((job) => addJob(job, 'adzuna'));
  joobleJobs.forEach((job) => addJob(job, 'jooble'));
  officialCards.forEach((job) => addJob(job, 'official_source'));

  return {
    jobs: [...map.values()],
    sources,
  };
}

/* -------------------------------------------------------------------------- */
/* AUTH HELPERS FOR REFRESH                                                   */
/* -------------------------------------------------------------------------- */

function hasRefreshPermission(req) {
  if (!JOB_REFRESH_SECRET) return false;

  const given =
    req.query.secret ||
    req.body?.secret ||
    req.headers['x-job-refresh-secret'] ||
    req.headers['x-refresh-secret'];

  return String(given || '') === JOB_REFRESH_SECRET;
}

/* -------------------------------------------------------------------------- */
/* ROUTES                                                                     */
/* -------------------------------------------------------------------------- */

router.get('/health', async (req, res) => {
  res.json({
    ok: true,
    route: 'jobs',
    supabaseConfigured: Boolean(supabase),
    supabaseTable: SUPABASE_JOBS_TABLE,
    adzunaConfigured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
    joobleConfigured: Boolean(JOOBLE_API_KEY),
    joobleEnabled: JOOBLE_ENABLED,
    cacheItems: memoryCache.size,
    hasSystemJobAuthorId: Boolean(SYSTEM_JOB_AUTHOR_ID),
  });
});

router.get('/adzuna-test', async (req, res) => {
  const query = normalizeText(req.query.query || 'driver');
  const area = normalizeText(req.query.area || 'Tzaneen');

  const result = await searchAdzunaOnce(query, area, 1, 10);

  res.json({
    ok: result.ok,
    provider: 'adzuna',
    configured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
    query,
    area,
    count: result.count,
    total: result.total,
    error: result.error,
    jobs: result.jobs.slice(0, 10),
  });
});

router.get('/jooble-test', async (req, res) => {
  const query = normalizeText(req.query.query || 'driver');
  const area = normalizeText(req.query.area || 'Tzaneen');

  const result = await searchJoobleOnce(query, area, 1, 10);

  res.json({
    ok: result.ok,
    provider: 'jooble',
    configured: Boolean(JOOBLE_API_KEY),
    enabled: JOOBLE_ENABLED,
    query,
    area,
    count: result.count,
    rawCount: result.rawCount,
    total: result.total,
    error: result.error,
    jobs: result.jobs.slice(0, 10),
  });
});

router.get('/list', async (req, res) => {
  const query = normalizeText(req.query.query || req.query.q || '');
  const rawQuery = normalizeText(req.query.rawQuery || query || 'jobs');
  const area = normalizeText(req.query.area || req.query.location || 'South Africa');
  const limit = safeLimit(req.query.limit, 60, 120);

  const [supabaseResult, manualResult] = await Promise.all([
    searchSupabaseJobs(query, area, limit),
    searchManualJobs(query, area, limit),
  ]);

  const merged = mergeJobsSmart({
    supabaseJobs: supabaseResult.jobs,
    manualJobs: manualResult.jobs,
  });

  const jobs = rankAndFilterJobsForQuery(merged.jobs, rawQuery, area, limit);

  res.json({
    ok: true,
    source: 'facemex_saved_jobs',
    query,
    rawQuery,
    area,
    count: jobs.length,
    sources: merged.sources,
    providerStatus: {
      supabase: {
        ok: supabaseResult.ok,
        count: supabaseResult.count,
        error: supabaseResult.error,
      },
      manual: {
        ok: manualResult.ok,
        count: manualResult.count,
        error: manualResult.error,
      },
    },
    jobs,
  });
});

router.get('/auto-search', async (req, res) => {
  const rawQuery = normalizeText(req.query.rawQuery || req.query.query || req.query.q || 'jobs');
  const area = normalizeText(req.query.area || req.query.location || 'South Africa');

  const limit = safeLimit(req.query.limit, 60, 120);
  const includeExternal = toBool(req.query.includeExternal, true);
  const includeOfficialSources = toBool(req.query.includeOfficialSources, false);
  const saveToSupabase = toBool(req.query.saveToSupabase, true);
  const fresh = toBool(req.query.fresh, false) || toBool(req.query.cache, true) === false;

  const searchPath = expandSearchLocations(area);
  const keywordPath = keywordVariants(rawQuery);
  const expandedQuery = keywordPath[0] || rawQuery;

  const cacheKey = buildCacheKey({
    route: 'auto-search-v4',
    rawQuery,
    area,
    limit,
    includeExternal,
    includeOfficialSources,
    saveToSupabase,
  });

  if (!fresh) {
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({
        ...cached,
        cached: true,
        cacheMinutes: Math.round(CACHE_TTL_MS / 60000),
      });
    }
  }

  const warnings = [];

  const [supabaseResult, manualResult] = await Promise.all([
    searchSupabaseJobs(rawQuery, area, limit),
    searchManualJobs(rawQuery, area, limit),
  ]);

  let adzunaResult = {
    ok: true,
    count: 0,
    jobs: [],
    attempts: [],
    error: null,
  };

  let joobleResult = {
    ok: true,
    count: 0,
    jobs: [],
    attempts: [],
    error: null,
  };

  if (includeExternal) {
    adzunaResult = await searchAdzunaSmart(rawQuery, area, limit);
    joobleResult = await searchJoobleSmart(rawQuery, area, limit);
  }

  const cards =
    includeOfficialSources && (rawQuery === 'jobs' || rawQuery === 'vacancies')
      ? officialSourceCards(area, rawQuery)
      : [];

  const merged = mergeJobsSmart({
    manualJobs: manualResult.jobs,
    supabaseJobs: supabaseResult.jobs,
    adzunaJobs: adzunaResult.jobs,
    joobleJobs: joobleResult.jobs,
    officialCards: cards,
  });

  const rankedJobs = rankAndFilterJobsForQuery(merged.jobs, rawQuery, area, limit);

  let saveResult = {
    savedToSupabase: 0,
    saveError: null,
  };

  if (saveToSupabase && includeExternal) {
    saveResult = await saveExternalJobsToSupabase(rankedJobs);
  }

  if (!supabaseResult.ok) warnings.push(`Supabase: ${supabaseResult.error}`);
  if (!adzunaResult.ok) warnings.push(`Adzuna: ${adzunaResult.error}`);
  if (!joobleResult.ok) warnings.push(`Jooble: ${joobleResult.error}`);

  const response = {
    ok: true,
    source: 'facemex_combined_jobs',
    query: expandedQuery,
    rawQuery,
    area,
    searchPath,
    keywordPath,
    count: rankedJobs.length,
    sources: merged.sources,
    providerStatus: {
      supabaseConfigured: Boolean(supabase),
      adzunaConfigured: Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY),
      joobleConfigured: Boolean(JOOBLE_API_KEY),
      supabase: {
        ok: supabaseResult.ok,
        count: supabaseResult.count,
        error: supabaseResult.error,
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
    warnings,
    jobs: rankedJobs,
    cached: false,
  };

  setCache(cacheKey, response);

  return res.json(response);
});

router.get('/discover', async (req, res) => {
  const area = normalizeText(req.query.area || 'Tzaneen');
  const limitPerType = safeLimit(req.query.limitPerType, 10, 30);

  const queries = [
    'general worker',
    'admin',
    'driver',
    'cashier',
    'cleaner',
    'security',
    'learnership',
    'farm',
  ];

  const sections = [];

  for (const query of queries) {
    const adzunaResult = await searchAdzunaSmart(query, area, limitPerType);
    const joobleResult = await searchJoobleSmart(query, area, limitPerType);

    const merged = mergeJobsSmart({
      adzunaJobs: adzunaResult.jobs,
      joobleJobs: joobleResult.jobs,
    });

    const jobs = rankAndFilterJobsForQuery(merged.jobs, query, area, limitPerType);

    sections.push({
      query,
      count: jobs.length,
      jobs,
      attempts: {
        adzuna: adzunaResult.attempts,
        jooble: joobleResult.attempts,
      },
    });
  }

  const allJobs = sections.flatMap((section) => section.jobs);
  const saveResult = await saveExternalJobsToSupabase(allJobs);

  res.json({
    ok: true,
    source: 'facemex_discover_jobs',
    area,
    sections,
    savedToSupabase: saveResult.savedToSupabase,
    saveError: saveResult.saveError,
  });
});

router.get('/refresh-test', async (req, res) => {
  if (!hasRefreshPermission(req)) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid refresh secret',
    });
  }

  const query = normalizeText(req.query.query || 'jobs');
  const area = normalizeText(req.query.area || 'Tzaneen');
  const limit = safeLimit(req.query.limit, 80, 120);

  const adzunaResult = await searchAdzunaSmart(query, area, limit);
  const joobleResult = await searchJoobleSmart(query, area, limit);

  const merged = mergeJobsSmart({
    adzunaJobs: adzunaResult.jobs,
    joobleJobs: joobleResult.jobs,
  });

  const rankedJobs = rankAndFilterJobsForQuery(merged.jobs, query, area, limit);
  const saveResult = await saveExternalJobsToSupabase(rankedJobs);

  res.json({
    ok: true,
    query,
    area,
    count: rankedJobs.length,
    sources: merged.sources,
    attempts: {
      adzuna: adzunaResult.attempts,
      jooble: joobleResult.attempts,
    },
    savedToSupabase: saveResult.savedToSupabase,
    saveError: saveResult.saveError,
    jobs: rankedJobs,
  });
});

router.post('/refresh', async (req, res) => {
  if (!hasRefreshPermission(req)) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid refresh secret',
    });
  }

  const query = normalizeText(req.body?.query || req.query.query || 'jobs');
  const area = normalizeText(req.body?.area || req.query.area || 'Tzaneen');
  const limit = safeLimit(req.body?.limit || req.query.limit, 80, 120);

  const adzunaResult = await searchAdzunaSmart(query, area, limit);
  const joobleResult = await searchJoobleSmart(query, area, limit);

  const merged = mergeJobsSmart({
    adzunaJobs: adzunaResult.jobs,
    joobleJobs: joobleResult.jobs,
  });

  const rankedJobs = rankAndFilterJobsForQuery(merged.jobs, query, area, limit);
  const saveResult = await saveExternalJobsToSupabase(rankedJobs);

  res.json({
    ok: true,
    query,
    area,
    count: rankedJobs.length,
    sources: merged.sources,
    savedToSupabase: saveResult.savedToSupabase,
    saveError: saveResult.saveError,
  });
});

router.post('/', async (req, res) => {
  const body = req.body || {};

  const title = normalizeText(body.title);
  const company = normalizeCompanyName(body.company);
  const area = normalizeText(body.area || body.town || 'South Africa');

  if (!title) {
    return res.status(400).json({
      ok: false,
      error: 'Job title is required',
    });
  }

  const job = {
    id: `manual-${Date.now()}`,
    external_source: 'manual',
    external_id: body.external_id || `manual-${Date.now()}`,
    title,
    company,
    area,
    town: normalizeText(body.town || area),
    province: normalizeText(body.province || getProvinceFromArea(area)),
    category: normalizeText(body.category || 'Jobs'),
    salary: body.salary || null,
    deadline: body.deadline || null,
    applyUrl: normalizeText(body.applyUrl || body.apply_url || ''),
    apply_url: normalizeText(body.applyUrl || body.apply_url || ''),
    sourceUrl: normalizeText(body.sourceUrl || body.source_url || body.applyUrl || body.apply_url || ''),
    source_url: normalizeText(body.sourceUrl || body.source_url || body.applyUrl || body.apply_url || ''),
    sourceLabel: normalizeText(body.sourceLabel || body.source_label || 'Manual FaceMeX job post'),
    source_label: normalizeText(body.sourceLabel || body.source_label || 'Manual FaceMeX job post'),
    sourceType: 'manual_job',
    source_type: 'manual_job',
    verificationStatus: normalizeText(body.verificationStatus || body.verification_status || 'needs_verification'),
    verification_status: normalizeText(body.verificationStatus || body.verification_status || 'needs_verification'),
    actionLabel: 'Open Apply Page',
    isSourceCard: false,
    description: truncateText(body.description || '', 1500),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trustScore: 75,
    foundBy: ['manual'],
    matchNote: 'Manually added on FaceMeX',
  };

  if (supabase) {
    const saveResult = await saveExternalJobsToSupabase([job]);

    if (saveResult.saveError) {
      return res.status(500).json({
        ok: false,
        error: saveResult.saveError,
      });
    }

    return res.status(201).json({
      ok: true,
      savedToSupabase: saveResult.savedToSupabase,
      job,
    });
  }

  const jobs = await readLocalJobs();
  jobs.unshift(job);
  await writeLocalJobs(jobs);

  return res.status(201).json({
    ok: true,
    savedLocal: true,
    job,
  });
});

router.get('/:jobId/applications', async (req, res) => {
  const jobId = normalizeText(req.params.jobId);

  if (!supabase) {
    return res.json({
      ok: true,
      jobId,
      applications: [],
      count: 0,
      note: 'Supabase is not configured',
    });
  }

  try {
    const { data, error } = await supabase
      .from('job_applications')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }

    return res.json({
      ok: true,
      jobId,
      count: Array.isArray(data) ? data.length : 0,
      applications: data || [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Could not load applications',
    });
  }
});

router.post('/:jobId/apply', async (req, res) => {
  const jobId = normalizeText(req.params.jobId);
  const body = req.body || {};

  if (!supabase) {
    return res.status(503).json({
      ok: false,
      error: 'Supabase is not configured',
    });
  }

  const applicantName = normalizeText(body.applicantName || body.applicant_name || body.name);
  const applicantEmail = normalizeText(body.applicantEmail || body.applicant_email || body.email);
  const message = normalizeText(body.message || body.coverLetter || body.cover_letter || '');

  if (!applicantName && !applicantEmail) {
    return res.status(400).json({
      ok: false,
      error: 'Applicant name or email is required',
    });
  }

  try {
    const row = {
      job_id: jobId,
      applicant_name: applicantName || null,
      applicant_email: applicantEmail || null,
      message: message || null,
      status: 'submitted',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (body.user_id) row.user_id = body.user_id;

    const { data, error } = await supabase
      .from('job_applications')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }

    return res.status(201).json({
      ok: true,
      application: data,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Could not submit application',
    });
  }
});

export default router;
