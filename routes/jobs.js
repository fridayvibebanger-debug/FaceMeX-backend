import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

let jobs = [];
let applications = [];

jobs = (await loadJSON('jobs.json', jobs)) || jobs;
applications = (await loadJSON('jobApplications.json', applications)) || applications;

const toStr = (v) => (v == null ? '' : String(v));

/*
  ENV VARIABLES NEEDED ON RENDER

  ADZUNA_APP_ID=...
  ADZUNA_APP_KEY=...

  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...

  JOB_REFRESH_SECRET=...

  GOOGLE_SEARCH_API_KEY=...
  GOOGLE_SEARCH_ENGINE_ID=...
*/

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  '';

const SUPABASE_JOBS_TABLE = process.env.SUPABASE_JOBS_TABLE || 'jobs';

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID || '';
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY || '';

const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || '';
const GOOGLE_SEARCH_ENGINE_ID =
  process.env.GOOGLE_SEARCH_ENGINE_ID ||
  process.env.GOOGLE_CSE_ID ||
  process.env.GOOGLE_SEARCH_CX ||
  '';

const JOB_REFRESH_SECRET = process.env.JOB_REFRESH_SECRET || '';

const LIVE_SEARCH_COOLDOWN_MINUTES = Number(process.env.LIVE_SEARCH_COOLDOWN_MINUTES || 10);

const PRIORITY_AREAS = [
  'Tzaneen',
  'Lenyenye',
  'Nkowankowa',
  'Maake',
  'Letsitele',
  'Modjadjiskloof',
  'Haenertsburg',
  'Polokwane',
  'Phalaborwa',
  'Hoedspruit',
  'Makhado',
  'Musina',
  'Messina',
];

const MAIN_JOB_KEYWORDS = [
  'jobs',
  'general worker',
  'cashier',
  'packer',
  'admin',
  'clerk',
  'driver',
  'security',
  'cleaner',
  'retail',
  'store assistant',
  'farm',
  'packhouse',
  'teacher assistant',
  'learnership',
  'internship',
];

const liveSearchCache = new Map();

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const OFFICIAL_JOB_SOURCE_CARDS = [
  {
    id: 'shoprite-official-jobs',
    external_source: 'official_source',
    external_id: 'shoprite-official-jobs',
    title: 'Shoprite / Checkers / Usave Store Jobs',
    company: 'Shoprite Group',
    area: 'South Africa',
    town: 'South Africa',
    province: 'South Africa',
    category: 'Retail',
    salary: null,
    deadline: null,
    applyUrl: 'https://apply.shoprite.jobs/',
    apply_url: 'https://apply.shoprite.jobs/',
    sourceUrl: 'https://apply.shoprite.jobs/',
    source_url: 'https://apply.shoprite.jobs/',
    sourceLabel: 'Official Company Source',
    source_label: 'Official Company Source',
    sourceType: 'official_company_source',
    source_type: 'official_company_source',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'shoprite-careers',
    external_source: 'official_source',
    external_id: 'shoprite-careers',
    title: 'Shoprite Group Careers',
    company: 'Shoprite Group',
    area: 'South Africa',
    town: 'South Africa',
    province: 'South Africa',
    category: 'Retail',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.shopriteholdings.co.za/careers.html',
    apply_url: 'https://www.shopriteholdings.co.za/careers.html',
    sourceUrl: 'https://www.shopriteholdings.co.za/careers.html',
    source_url: 'https://www.shopriteholdings.co.za/careers.html',
    sourceLabel: 'Official Company Source',
    source_label: 'Official Company Source',
    sourceType: 'official_company_source',
    source_type: 'official_company_source',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'westfalia-careers',
    external_source: 'official_source',
    external_id: 'westfalia-careers',
    title: 'Westfalia Fruit Careers',
    company: 'Westfalia Fruit',
    area: 'Tzaneen / Limpopo',
    town: 'Tzaneen',
    province: 'Limpopo',
    category: 'Agriculture',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.westfaliafruit.com/careers',
    apply_url: 'https://www.westfaliafruit.com/careers',
    sourceUrl: 'https://www.westfaliafruit.com/careers',
    source_url: 'https://www.westfaliafruit.com/careers',
    sourceLabel: 'Official Company Source',
    source_label: 'Official Company Source',
    sourceType: 'official_company_source',
    source_type: 'official_company_source',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'zz2-vacancies',
    external_source: 'official_source',
    external_id: 'zz2-vacancies',
    title: 'ZZ2 Vacancies',
    company: 'ZZ2',
    area: 'Tzaneen / Mooketsi / Limpopo',
    town: 'Tzaneen',
    province: 'Limpopo',
    category: 'Agriculture',
    salary: null,
    deadline: null,
    applyUrl: 'https://recruit.zz2.co.za/vacancies',
    apply_url: 'https://recruit.zz2.co.za/vacancies',
    sourceUrl: 'https://recruit.zz2.co.za/vacancies',
    source_url: 'https://recruit.zz2.co.za/vacancies',
    sourceLabel: 'Official Company Source',
    source_label: 'Official Company Source',
    sourceType: 'official_company_source',
    source_type: 'official_company_source',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'rcl-foods-careers',
    external_source: 'official_source',
    external_id: 'rcl-foods-careers',
    title: 'RCL FOODS Careers',
    company: 'RCL FOODS',
    area: 'South Africa / Limpopo',
    town: 'Limpopo',
    province: 'Limpopo',
    category: 'Food / Manufacturing',
    salary: null,
    deadline: null,
    applyUrl: 'https://rclfoods.com/careers/',
    apply_url: 'https://rclfoods.com/careers/',
    sourceUrl: 'https://rclfoods.com/careers/',
    source_url: 'https://rclfoods.com/careers/',
    sourceLabel: 'Official Company Source',
    source_label: 'Official Company Source',
    sourceType: 'official_company_source',
    source_type: 'official_company_source',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'ppebc-careers',
    external_source: 'official_source',
    external_id: 'ppebc-careers',
    title: 'PPECB Careers',
    company: 'PPECB',
    area: 'South Africa / Limpopo',
    town: 'Limpopo',
    province: 'Limpopo',
    category: 'Agriculture / Inspection / Admin',
    salary: null,
    deadline: null,
    applyUrl: 'https://ppecb.simplify.hr/',
    apply_url: 'https://ppecb.simplify.hr/',
    sourceUrl: 'https://ppecb.simplify.hr/',
    source_url: 'https://ppecb.simplify.hr/',
    sourceLabel: 'Official Company Source',
    source_label: 'Official Company Source',
    sourceType: 'official_company_source',
    source_type: 'official_company_source',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'limpopo-health-careers',
    external_source: 'official_source',
    external_id: 'limpopo-health-careers',
    title: 'Limpopo Department of Health Careers',
    company: 'Limpopo Department of Health',
    area: 'Limpopo',
    town: 'Limpopo',
    province: 'Limpopo',
    category: 'Government / Health',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.ldoh.gov.za/?q=node/11',
    apply_url: 'https://www.ldoh.gov.za/?q=node/11',
    sourceUrl: 'https://www.ldoh.gov.za/?q=node/11',
    source_url: 'https://www.ldoh.gov.za/?q=node/11',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'greater-tzaneen-vacancies',
    external_source: 'official_source',
    external_id: 'greater-tzaneen-vacancies',
    title: 'Greater Tzaneen Municipality Vacancies',
    company: 'Greater Tzaneen Municipality',
    area: 'Tzaneen',
    town: 'Tzaneen',
    province: 'Limpopo',
    category: 'Government',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.greatertzaneen.gov.za/?q=current_vacancies',
    apply_url: 'https://www.greatertzaneen.gov.za/?q=current_vacancies',
    sourceUrl: 'https://www.greatertzaneen.gov.za/?q=current_vacancies',
    source_url: 'https://www.greatertzaneen.gov.za/?q=current_vacancies',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'polokwane-apply',
    external_source: 'official_source',
    external_id: 'polokwane-apply',
    title: 'Polokwane Municipality Employment Portal',
    company: 'Polokwane Municipality',
    area: 'Polokwane',
    town: 'Polokwane',
    province: 'Limpopo',
    category: 'Government',
    salary: null,
    deadline: null,
    applyUrl: 'https://apply.polokwane.gov.za/',
    apply_url: 'https://apply.polokwane.gov.za/',
    sourceUrl: 'https://apply.polokwane.gov.za/',
    source_url: 'https://apply.polokwane.gov.za/',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'ba-phalaborwa-vacancies',
    external_source: 'official_source',
    external_id: 'ba-phalaborwa-vacancies',
    title: 'Ba-Phalaborwa Municipality Vacancies',
    company: 'Ba-Phalaborwa Municipality',
    area: 'Phalaborwa',
    town: 'Phalaborwa',
    province: 'Limpopo',
    category: 'Government',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.phalaborwa.gov.za/vacancies/vacancies.php',
    apply_url: 'https://www.phalaborwa.gov.za/vacancies/vacancies.php',
    sourceUrl: 'https://www.phalaborwa.gov.za/vacancies/vacancies.php',
    source_url: 'https://www.phalaborwa.gov.za/vacancies/vacancies.php',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'maruleng-vacancies',
    external_source: 'official_source',
    external_id: 'maruleng-vacancies',
    title: 'Maruleng Municipality Vacancies',
    company: 'Maruleng Municipality',
    area: 'Hoedspruit',
    town: 'Hoedspruit',
    province: 'Limpopo',
    category: 'Government',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.maruleng.gov.za/pages/vacancies.php',
    apply_url: 'https://www.maruleng.gov.za/pages/vacancies.php',
    sourceUrl: 'https://www.maruleng.gov.za/pages/vacancies.php',
    source_url: 'https://www.maruleng.gov.za/pages/vacancies.php',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'makhado-vacancies',
    external_source: 'official_source',
    external_id: 'makhado-vacancies',
    title: 'Makhado Municipality Advertised Posts',
    company: 'Makhado Municipality',
    area: 'Makhado',
    town: 'Makhado',
    province: 'Limpopo',
    category: 'Government',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.makhado.gov.za/?q=advertisedvacancies',
    apply_url: 'https://www.makhado.gov.za/?q=advertisedvacancies',
    sourceUrl: 'https://www.makhado.gov.za/?q=advertisedvacancies',
    source_url: 'https://www.makhado.gov.za/?q=advertisedvacancies',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'musina-vacancies',
    external_source: 'official_source',
    external_id: 'musina-vacancies',
    title: 'Musina Municipality Vacancies',
    company: 'Musina Municipality',
    area: 'Musina',
    town: 'Musina',
    province: 'Limpopo',
    category: 'Government',
    salary: null,
    deadline: null,
    applyUrl: 'https://www.musina.gov.za/vacancies-musina-municipality/',
    apply_url: 'https://www.musina.gov.za/vacancies-musina-municipality/',
    sourceUrl: 'https://www.musina.gov.za/vacancies-musina-municipality/',
    source_url: 'https://www.musina.gov.za/vacancies-musina-municipality/',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
  {
    id: 'sayouth-opportunities',
    external_source: 'official_source',
    external_id: 'sayouth-opportunities',
    title: 'SAYouth Opportunities',
    company: 'SAYouth',
    area: 'South Africa / Youth Opportunities',
    town: 'South Africa',
    province: 'South Africa',
    category: 'Youth / Learnerships',
    salary: null,
    deadline: null,
    applyUrl: 'https://sayouth.mobi/',
    apply_url: 'https://sayouth.mobi/',
    sourceUrl: 'https://sayouth.mobi/',
    source_url: 'https://sayouth.mobi/',
    sourceLabel: 'Government / Public Institution',
    source_label: 'Government / Public Institution',
    sourceType: 'government_public_institution',
    source_type: 'government_public_institution',
    verificationStatus: 'verified',
    verification_status: 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  },
];

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

function adzunaConfigured() {
  return Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY);
}

function googleConfigured() {
  return Boolean(GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID);
}

function supabaseConfigured() {
  return Boolean(supabase);
}

function normalizeText(value) {
  return toStr(value).trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(query, area) {
  return `${normalizeLower(area)}::${normalizeLower(query)}`;
}

function getFromCache(query, area) {
  const key = cacheKey(query, area);
  const cached = liveSearchCache.get(key);

  if (!cached) return null;

  const ageMs = Date.now() - cached.createdAt;
  const maxAgeMs = LIVE_SEARCH_COOLDOWN_MINUTES * 60 * 1000;

  if (ageMs > maxAgeMs) {
    liveSearchCache.delete(key);
    return null;
  }

  return cached.data;
}

function saveToCache(query, area, data) {
  liveSearchCache.set(cacheKey(query, area), {
    createdAt: Date.now(),
    data,
  });
}

function detectArea(text = '') {
  const lower = normalizeLower(text);
  const found = PRIORITY_AREAS.find((area) => lower.includes(area.toLowerCase()));
  return found || 'Tzaneen';
}

function detectKeyword(text = '') {
  const lower = normalizeLower(text);

  if (/shoprite|checkers|usave|cashier|packer|retail|store|clerk|shop assistant/i.test(lower)) {
    return 'cashier clerk packer retail store assistant general worker';
  }

  if (/westfalia|zz2|farm|agriculture|packhouse|packing|security|admin/i.test(lower)) {
    return 'farm agriculture packhouse packing security admin general worker';
  }

  if (/teacher|creche|crèche|school|educare|daycare/i.test(lower)) {
    return 'teacher assistant creche daycare school';
  }

  if (/driver|code 10|code 14|pdp|delivery|courier/i.test(lower)) {
    return 'driver code 10 code 14 delivery courier';
  }

  const cleaned = normalizeText(text)
    .replace(/i am looking for/gi, '')
    .replace(/i'm looking for/gi, '')
    .replace(/looking for/gi, '')
    .replace(/show me/gi, '')
    .replace(/available/gi, '')
    .replace(/vacancies/gi, '')
    .replace(/vacancy/gi, '')
    .replace(/jobs/gi, '')
    .replace(/job/gi, '')
    .replace(/work/gi, '')
    .replace(/in tzaneen/gi, '')
    .replace(/in polokwane/gi, '')
    .replace(/in phalaborwa/gi, '')
    .replace(/in hoedspruit/gi, '')
    .trim();

  return cleaned || 'jobs';
}

function getHost(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function companyTokens(company = '') {
  return normalizeLower(company)
    .replace(/\(pty\)|ltd|limited|careers|group|south africa|sa|pty/g, '')
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function hasCompanyMatch(company = '', text = '') {
  const tokens = companyTokens(company);
  const lower = normalizeLower(text);
  return tokens.some((token) => lower.includes(token));
}

function knownOfficialDomains(company = '') {
  const lower = normalizeLower(company);

  if (lower.includes('shoprite') || lower.includes('checkers') || lower.includes('usave')) {
    return ['shoprite.jobs', 'shopriteholdings.co.za'];
  }

  if (lower.includes('westfalia')) return ['westfaliafruit.com'];
  if (lower.includes('zz2')) return ['zz2.co.za', 'recruit.zz2.co.za'];
  if (lower.includes('rcl')) return ['rclfoods.com'];
  if (lower.includes('ppecb')) return ['ppecb.com', 'simplify.hr'];
  if (lower.includes('coca-cola') || lower.includes('coca cola')) return ['ccbagroup.com', 'coca-cola.co.za'];
  if (lower.includes('tzaneen municipality') || lower.includes('greater tzaneen')) return ['greatertzaneen.gov.za'];
  if (lower.includes('polokwane')) return ['polokwane.gov.za'];
  if (lower.includes('phalaborwa')) return ['phalaborwa.gov.za'];
  if (lower.includes('makhado')) return ['makhado.gov.za'];
  if (lower.includes('musina')) return ['musina.gov.za'];
  if (lower.includes('maruleng')) return ['maruleng.gov.za'];

  return [];
}

function classifyGoogleResults({ company, results = [] }) {
  const knownDomains = knownOfficialDomains(company);

  const officialResult = results.find((item) => {
    const host = getHost(item.link);
    const allText = `${item.title} ${item.link} ${item.snippet} ${item.displayLink}`;

    if (knownDomains.some((domain) => host.includes(domain))) return true;

    if (
      hasCompanyMatch(company, host) &&
      !host.includes('facebook') &&
      !host.includes('indeed') &&
      !host.includes('adzuna') &&
      !host.includes('job') &&
      !host.includes('pnet') &&
      !host.includes('careers24') &&
      !host.includes('careerjunction')
    ) {
      return true;
    }

    return hasCompanyMatch(company, allText) && /career|careers|vacanc|job|apply/i.test(allText);
  });

  const scamResult = results.find((item) => {
    const text = `${item.title} ${item.snippet} ${item.link}`.toLowerCase();
    return /scam|fraud|fake|warning|complaint/.test(text);
  });

  if (scamResult) {
    return {
      verificationStatus: 'needs_verification',
      sourceType: 'external_job_api',
      sourceLabel: 'Google check found caution signs',
      trustScore: 45,
      officialUrl: officialResult?.link || '',
      warningUrl: scamResult.link,
      reason: 'Google returned possible caution/scam-related result. User should verify before applying.',
    };
  }

  if (officialResult) {
    return {
      verificationStatus: 'verified',
      sourceType: 'official_company_source',
      sourceLabel: 'Official Company Source',
      trustScore: 85,
      officialUrl: officialResult.link,
      warningUrl: '',
      reason: 'Google found an official-looking company/source result.',
    };
  }

  return {
    verificationStatus: 'needs_verification',
    sourceType: 'external_job_api',
    sourceLabel: 'External job source',
    trustScore: 60,
    officialUrl: '',
    warningUrl: '',
    reason: 'No clear official company source found from Google search.',
  };
}

function normalizeVerificationStatus(value) {
  const status = normalizeLower(value);

  if (status === 'verified' || status === 'approved') return 'verified';
  if (status === 'avoid' || status === 'high_risk' || status === 'rejected') return 'avoid';

  return 'needs_verification';
}

function normalizeSourceType(value) {
  const source = normalizeLower(value);

  if (source.includes('facemex')) return 'facemex_verified_local_employer';
  if (source.includes('government') || source.includes('municipality') || source.includes('public')) {
    return 'government_public_institution';
  }
  if (source.includes('community') || source.includes('screenshot')) {
    return 'community_advert_needs_verification';
  }
  if (source.includes('api') || source.includes('adzuna') || source.includes('external')) {
    return 'external_job_api';
  }
  if (source.includes('risk') || source.includes('avoid')) return 'high_risk_avoid';

  return 'official_company_source';
}

function normalizeJob(job = {}) {
  const id =
    normalizeText(job.id) ||
    normalizeText(job.external_id) ||
    normalizeText(job.externalId) ||
    `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const title = normalizeText(job.title || job.job_title || job.role || 'Job opportunity');
  const company = normalizeText(
    job.company ||
      job.employer ||
      job.company_name ||
      job.source_name ||
      job.sourceName ||
      'Company not stated'
  );

  const area = normalizeText(
    job.area ||
      job.location ||
      job.town ||
      job.city ||
      job.location_display ||
      job.locationDisplay ||
      'South Africa'
  );

  const applyUrl = normalizeText(
    job.applyUrl ||
      job.apply_url ||
      job.application_link ||
      job.redirect_url ||
      job.redirectUrl ||
      job.sourceUrl ||
      job.source_url
  );

  const sourceUrl = normalizeText(job.sourceUrl || job.source_url || applyUrl);
  const verificationStatus = normalizeVerificationStatus(
    job.verificationStatus || job.verification_status || job.status
  );

  const sourceType = normalizeSourceType(job.sourceType || job.source_type || job.sourceLabel);

  return {
    id,
    external_source: normalizeText(job.external_source || job.externalSource || 'manual'),
    external_id: normalizeText(job.external_id || job.externalId || id),
    title,
    company,
    area,
    town: normalizeText(job.town || area),
    province: normalizeText(job.province || 'Limpopo'),
    category: normalizeText(job.category || job.type || 'Job opportunity'),
    salary: normalizeText(job.salary || job.salary_text || job.salaryText) || null,
    deadline: normalizeText(job.deadline || job.closing_date || job.closingDate) || null,
    applyUrl,
    apply_url: applyUrl,
    sourceUrl,
    source_url: sourceUrl,
    sourceLabel:
      normalizeText(job.sourceLabel || job.source_label) ||
      (sourceType === 'external_job_api' ? 'External job source' : 'Official Company Source'),
    source_label:
      normalizeText(job.sourceLabel || job.source_label) ||
      (sourceType === 'external_job_api' ? 'External job source' : 'Official Company Source'),
    sourceType,
    source_type: sourceType,
    verificationStatus,
    verification_status: verificationStatus,
    actionLabel: normalizeText(job.actionLabel || job.action_label) || 'Open Official Page',
    isSourceCard: Boolean(job.isSourceCard || job.is_source_card),
    createdAt: normalizeText(job.createdAt || job.created_at) || new Date().toISOString(),
    updatedAt: normalizeText(job.updatedAt || job.updated_at) || new Date().toISOString(),
    trustScore: safeNumber(job.trustScore || job.trust_score, verificationStatus === 'verified' ? 85 : 60),
    googleVerification: job.googleVerification || job.google_verification || null,
  };
}

function normalizeAdzunaJob(job = {}, area = 'South Africa') {
  const company = normalizeText(job?.company?.display_name || job?.company || 'Company not stated');
  const location = normalizeText(job?.location?.display_name || area);
  const category = normalizeText(job?.category?.label || 'Job opportunity');
  const applyUrl = normalizeText(job?.redirect_url || job?.url);

  return normalizeJob({
    id: `adzuna-${job.id}`,
    external_source: 'adzuna',
    external_id: normalizeText(job.id),
    title: job.title,
    company,
    area: location,
    town: area,
    province: 'Limpopo',
    category,
    salary: job.salary_min && job.salary_max ? `R${job.salary_min} - R${job.salary_max}` : null,
    deadline: null,
    applyUrl,
    sourceUrl: applyUrl,
    sourceLabel: 'Adzuna / External job source',
    sourceType: 'external_job_api',
    verificationStatus: 'needs_verification',
    actionLabel: 'Open Official Page',
    isSourceCard: false,
    createdAt: job.created || new Date().toISOString(),
    trustScore: 60,
  });
}

function normalizeManualJob(job = {}) {
  return normalizeJob({
    id: job.id,
    external_source: 'facemex_manual',
    external_id: job.id,
    title: job.title,
    company: job.company,
    area: job.location || job.area || 'Remote',
    town: job.location || job.area || 'Remote',
    province: 'Limpopo',
    category: job.type || job.category || 'Job opportunity',
    salary: job.salary || null,
    deadline: job.deadline || null,
    applyUrl: job.applyUrl || job.apply_url || '',
    sourceUrl: job.sourceUrl || job.source_url || '',
    sourceLabel: 'FaceMeX Local Employer Post',
    sourceType: 'facemex_verified_local_employer',
    verificationStatus: 'verified',
    actionLabel: 'Apply Now',
    isSourceCard: false,
    createdAt: job.createdAt || new Date().toISOString(),
    trustScore: 95,
  });
}

function removeDuplicates(list = []) {
  const seen = new Set();

  return list.filter((job) => {
    const key = [
      normalizeLower(job.title),
      normalizeLower(job.company),
      normalizeLower(job.area),
      normalizeLower(job.applyUrl || job.apply_url),
    ].join('|');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortJobs(list = []) {
  return [...list].sort((a, b) => {
    const aVerified = a.verificationStatus === 'verified' || a.verification_status === 'verified';
    const bVerified = b.verificationStatus === 'verified' || b.verification_status === 'verified';

    if (aVerified && !bVerified) return -1;
    if (!aVerified && bVerified) return 1;

    const aSource = Boolean(a.isSourceCard);
    const bSource = Boolean(b.isSourceCard);

    if (!aSource && bSource) return -1;
    if (aSource && !bSource) return 1;

    return normalizeText(a.title).localeCompare(normalizeText(b.title));
  });
}

function filterJobsByIntent(list = [], query = '', area = '') {
  const q = normalizeLower(query);
  const a = normalizeLower(area);

  const keywordTokens = q
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !['jobs', 'job', 'work', 'looking', 'available', 'show'].includes(token));

  return list.filter((job) => {
    const text = normalizeLower(
      `${job.title} ${job.company} ${job.area} ${job.category} ${job.town} ${job.province}`
    );

    const areaMatch = !a || text.includes(a) || area === 'South Africa';

    const keywordMatch =
      keywordTokens.length === 0 || keywordTokens.some((token) => text.includes(token));

    return areaMatch || keywordMatch;
  });
}

async function googleSearch(query, limit = 5) {
  if (!googleConfigured()) {
    return {
      ok: false,
      error: 'google_not_configured',
      items: [],
    };
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', GOOGLE_SEARCH_API_KEY);
  url.searchParams.set('cx', GOOGLE_SEARCH_ENGINE_ID);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(Math.max(Number(limit) || 5, 1), 10)));

  const response = await fetch(url.toString());
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      error: data?.error?.message || `Google search failed with ${response.status}`,
      items: [],
    };
  }

  return {
    ok: true,
    error: null,
    items: Array.isArray(data?.items)
      ? data.items.map((item) => ({
          title: item.title || '',
          link: item.link || '',
          snippet: item.snippet || '',
          displayLink: item.displayLink || '',
        }))
      : [],
  };
}

async function verifyJobWithGoogle(job) {
  const normalized = normalizeJob(job);

  if (!googleConfigured()) {
    return {
      ...normalized,
      googleVerification: {
        ok: false,
        error: 'google_not_configured',
        results: [],
      },
    };
  }

  const query = `${normalized.company} ${normalized.title} careers vacancies jobs South Africa official`;
  const result = await googleSearch(query, 5);
  const classification = classifyGoogleResults({
    company: normalized.company,
    results: result.items,
  });

  const verifiedJob = {
    ...normalized,
    verificationStatus: classification.verificationStatus,
    verification_status: classification.verificationStatus,
    sourceType: classification.sourceType,
    source_type: classification.sourceType,
    sourceLabel: classification.sourceLabel,
    source_label: classification.sourceLabel,
    trustScore: classification.trustScore,
    googleVerification: {
      ok: result.ok,
      query,
      error: result.error || null,
      reason: classification.reason,
      officialUrl: classification.officialUrl || '',
      warningUrl: classification.warningUrl || '',
      results: result.items,
    },
  };

  if (classification.officialUrl) {
    verifiedJob.sourceUrl = classification.officialUrl;
    verifiedJob.source_url = classification.officialUrl;
  }

  return verifiedJob;
}

async function searchAdzuna({ query = 'jobs', area = 'Tzaneen', page = 1, limit = 20 } = {}) {
  if (!adzunaConfigured()) {
    return {
      ok: false,
      error: 'adzuna_not_configured',
      jobs: [],
    };
  }

  const url = new URL(`https://api.adzuna.com/v1/api/jobs/za/search/${page}`);
  url.searchParams.set('app_id', ADZUNA_APP_ID);
  url.searchParams.set('app_key', ADZUNA_APP_KEY);
  url.searchParams.set('what', query || 'jobs');
  url.searchParams.set('where', area || 'South Africa');
  url.searchParams.set('results_per_page', String(Math.min(Math.max(Number(limit) || 20, 1), 50)));
  url.searchParams.set('sort_by', 'date');
  url.searchParams.set('content-type', 'application/json');

  const response = await fetch(url.toString());
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      error:
        data?.error ||
        data?.message ||
        data?.display ||
        `Adzuna failed ${response.status}: ${toStr(await response.text?.()).slice(0, 200)}`,
      jobs: [],
    };
  }

  const results = Array.isArray(data?.results) ? data.results : [];

  return {
    ok: true,
    error: null,
    count: Number(data?.count || results.length),
    jobs: results.map((item) => normalizeAdzunaJob(item, area)).filter((job) => job.applyUrl),
  };
}

async function getJobsFromSupabase({ query = 'jobs', area = 'Tzaneen', limit = 50 } = {}) {
  if (!supabaseConfigured()) return [];

  try {
    const { data, error } = await supabase
      .from(SUPABASE_JOBS_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 50, 1), 100));

    if (error) return [];

    const normalized = Array.isArray(data) ? data.map(normalizeJob).filter((job) => job.applyUrl) : [];

    return filterJobsByIntent(normalized, query, area);
  } catch {
    return [];
  }
}

async function saveJobsToSupabase(list = []) {
  if (!supabaseConfigured() || !Array.isArray(list) || list.length === 0) {
    return {
      ok: false,
      saved: 0,
      error: supabaseConfigured() ? null : 'supabase_not_configured',
    };
  }

  const rows = list.map((job) => {
    const normalized = normalizeJob(job);

    return {
      external_source: normalized.external_source || 'facemex',
      external_id: normalized.external_id || normalized.id,
      title: normalized.title,
      company: normalized.company,
      area: normalized.area,
      town: normalized.town,
      province: normalized.province,
      category: normalized.category,
      salary: normalized.salary,
      deadline: normalized.deadline,
      apply_url: normalized.applyUrl,
      source_url: normalized.sourceUrl,
      source_label: normalized.sourceLabel,
      source_type: normalized.sourceType,
      verification_status: normalized.verificationStatus,
      description: normalized.googleVerification?.reason || '',
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  try {
    const { error } = await supabase
      .from(SUPABASE_JOBS_TABLE)
      .upsert(rows, {
        onConflict: 'external_source,external_id',
      });

    if (error) {
      return {
        ok: false,
        saved: 0,
        error: error.message,
      };
    }

    return {
      ok: true,
      saved: rows.length,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      saved: 0,
      error: error?.message || 'supabase_save_failed',
    };
  }
}

function officialCardsForArea(area = 'Tzaneen') {
  const lower = normalizeLower(area);

  const local = OFFICIAL_JOB_SOURCE_CARDS.filter((job) => {
    const text = normalizeLower(`${job.area} ${job.town} ${job.company} ${job.title}`);
    return text.includes(lower) || text.includes('south africa') || text.includes('limpopo');
  });

  return local.length ? local : OFFICIAL_JOB_SOURCE_CARDS;
}

function validateRefreshSecret(req) {
  const provided =
    toStr(req.headers['x-job-refresh-secret']) ||
    toStr(req.query.secret) ||
    toStr(req.body?.secret);

  return Boolean(JOB_REFRESH_SECRET && provided && provided === JOB_REFRESH_SECRET);
}

/*
  STATUS
*/
router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'FaceMeX Jobs API',
    supabaseConfigured: supabaseConfigured(),
    adzunaConfigured: adzunaConfigured(),
    googleConfigured: googleConfigured(),
    hasRefreshSecret: Boolean(JOB_REFRESH_SECRET),
    localEmployerPosts: jobs.length,
    priorityAreas: PRIORITY_AREAS,
    liveSearchCooldownMinutes: LIVE_SEARCH_COOLDOWN_MINUTES,
  });
});

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'FaceMeX Jobs API',
    supabaseConfigured: supabaseConfigured(),
    adzunaConfigured: adzunaConfigured(),
    googleConfigured: googleConfigured(),
    hasRefreshSecret: Boolean(JOB_REFRESH_SECRET),
    table: SUPABASE_JOBS_TABLE,
    localEmployerPosts: jobs.length,
    applications: applications.length,
    priorityAreas: PRIORITY_AREAS,
  });
});

/*
  LIST MANUAL LOCAL JOBS
*/
router.get('/list', (_req, res) => {
  const normalized = jobs.map(normalizeManualJob);
  res.json({
    ok: true,
    source: 'facemex_manual_jobs',
    count: normalized.length,
    jobs: normalized,
  });
});

/*
  GOOGLE TEST
  Test:
  /api/jobs/google-test?q=Shoprite careers Tzaneen
*/
router.get('/google-test', async (req, res) => {
  const query = normalizeText(req.query.q || 'Shoprite careers South Africa');

  try {
    const result = await googleSearch(query, 5);

    return res.json({
      ok: result.ok,
      source: 'google_custom_search',
      googleConfigured: googleConfigured(),
      query,
      count: result.items.length,
      error: result.error || null,
      results: result.items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      source: 'google_custom_search',
      googleConfigured: googleConfigured(),
      query,
      error: error?.message || 'Google test failed',
      results: [],
    });
  }
});

/*
  VERIFY COMPANY WITH GOOGLE
  Example:
  /api/jobs/verify-company?company=Westfalia Fruit&title=Admin Clerk&area=Tzaneen
*/
router.get('/verify-company', async (req, res) => {
  const company = normalizeText(req.query.company || req.query.q || '');
  const title = normalizeText(req.query.title || 'job vacancies');
  const area = normalizeText(req.query.area || 'South Africa');

  if (!company) {
    return res.status(400).json({
      ok: false,
      error: 'company_required',
    });
  }

  try {
    const job = normalizeJob({
      title,
      company,
      area,
      applyUrl: '',
      sourceType: 'external_job_api',
      verificationStatus: 'needs_verification',
    });

    const query = `${company} ${title} ${area} official careers vacancies scam`;
    const result = await googleSearch(query, 8);
    const classification = classifyGoogleResults({
      company,
      results: result.items,
    });

    return res.json({
      ok: result.ok,
      source: 'google_custom_search',
      googleConfigured: googleConfigured(),
      query,
      company,
      title,
      area,
      verificationStatus: classification.verificationStatus,
      sourceType: classification.sourceType,
      sourceLabel: classification.sourceLabel,
      trustScore: classification.trustScore,
      officialUrl: classification.officialUrl || null,
      warningUrl: classification.warningUrl || null,
      reason: classification.reason,
      results: result.items,
      error: result.error || null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'verification_failed',
    });
  }
});

/*
  AUTOMATIC JOB SEARCH
  Example:
  /api/jobs/auto-search?query=security&area=Tzaneen&verify=true&limit=50
*/
router.get('/auto-search', async (req, res) => {
  const rawQuery = normalizeText(req.query.query || req.query.q || 'jobs');
  const rawArea = normalizeText(req.query.area || req.query.where || detectArea(rawQuery));
  const query = detectKeyword(rawQuery);
  const area = rawArea || 'Tzaneen';

  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
  const includeExternal = req.query.includeExternal !== 'false';
  const includeOfficialSources = req.query.includeOfficialSources !== 'false';
  const verifyWithGoogle = req.query.verify !== 'false';
  const verifyLimit = Math.min(Math.max(Number(req.query.verifyLimit || 3), 0), 5);

  const cached = getFromCache(query, area);

  if (cached) {
    return res.json({
      ...cached,
      cached: true,
      cacheMinutes: LIVE_SEARCH_COOLDOWN_MINUTES,
    });
  }

  const warnings = [];
  let databaseJobs = [];
  let externalJobs = [];
  let verifiedExternalJobs = [];

  try {
    databaseJobs = await getJobsFromSupabase({ query, area, limit });
  } catch (error) {
    warnings.push(`Supabase search failed: ${error?.message || 'Unknown error'}`);
  }

  const manualJobs = jobs.map(normalizeManualJob);
  const filteredManualJobs = filterJobsByIntent(manualJobs, query, area);

  if (includeExternal) {
    try {
      const adzuna = await searchAdzuna({
        query,
        area,
        page: 1,
        limit: Math.min(limit, 50),
      });

      if (adzuna.ok) {
        externalJobs = adzuna.jobs;
      } else if (adzuna.error) {
        warnings.push(`Adzuna search failed: ${adzuna.error}`);
      }
    } catch (error) {
      warnings.push(`Adzuna search failed: ${error?.message || 'Unknown error'}`);
    }
  }

  verifiedExternalJobs = [...externalJobs];

  if (verifyWithGoogle && googleConfigured() && externalJobs.length > 0 && verifyLimit > 0) {
    const topJobs = externalJobs.slice(0, verifyLimit);
    const restJobs = externalJobs.slice(verifyLimit);

    try {
      const verifiedTopJobs = [];

      for (const job of topJobs) {
        const verifiedJob = await verifyJobWithGoogle(job);
        verifiedTopJobs.push(verifiedJob);
        await sleep(250);
      }

      verifiedExternalJobs = [...verifiedTopJobs, ...restJobs];
    } catch (error) {
      warnings.push(`Google verification failed: ${error?.message || 'Unknown error'}`);
      verifiedExternalJobs = externalJobs;
    }
  }

  const fallbackCards = includeOfficialSources ? officialCardsForArea(area) : [];

  const combined = removeDuplicates([
    ...filteredManualJobs,
    ...databaseJobs,
    ...verifiedExternalJobs,
  ]);

  const finalJobs = sortJobs(combined.length ? combined : fallbackCards).slice(0, limit);

  const saveableJobs = finalJobs.filter((job) => !job.isSourceCard);

  const savedResult = saveableJobs.length
    ? await saveJobsToSupabase(saveableJobs)
    : {
        ok: false,
        saved: 0,
        error: null,
      };

  const response = {
    ok: true,
    source: 'facemex_jobs_auto_search',
    query,
    area,
    count: finalJobs.length,
    employerPosts: filteredManualJobs.length,
    databaseJobs: databaseJobs.length,
    adzunaJobs: externalJobs.length,
    fallbackCards: combined.length ? 0 : fallbackCards.length,
    googleConfigured: googleConfigured(),
    googleVerifiedTopJobs:
      verifyWithGoogle && googleConfigured() ? Math.min(externalJobs.length, verifyLimit) : 0,
    savedToSupabase: savedResult.saved,
    saveError: savedResult.error || null,
    warnings,
    jobs: finalJobs,
  };

  saveToCache(query, area, response);

  return res.json(response);
});

/*
  REFRESH TEST
  Browser friendly:
  /api/jobs/refresh-test?secret=YOUR_SECRET&area=Tzaneen&query=jobs
*/
router.get('/refresh-test', async (req, res) => {
  if (!validateRefreshSecret(req)) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized job refresh test.',
    });
  }

  const area = normalizeText(req.query.area || 'Tzaneen');
  const query = normalizeText(req.query.query || req.query.q || 'jobs');
  const verify = req.query.verify === 'true';

  try {
    const adzuna = await searchAdzuna({
      query,
      area,
      page: 1,
      limit: 50,
    });

    let foundJobs = adzuna.jobs || [];

    if (verify && googleConfigured()) {
      const verified = [];

      for (const job of foundJobs.slice(0, 3)) {
        verified.push(await verifyJobWithGoogle(job));
        await sleep(250);
      }

      foundJobs = [...verified, ...foundJobs.slice(3)];
    }

    const saveResult = await saveJobsToSupabase(foundJobs);

    return res.json({
      ok: true,
      source: 'refresh_test',
      area,
      query,
      found: foundJobs.length,
      saved: saveResult.saved,
      saveError: saveResult.error || null,
      googleVerified: verify && googleConfigured() ? Math.min(foundJobs.length, 3) : 0,
      jobs: foundJobs.slice(0, 20),
      message: 'Refresh test completed.',
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Refresh test failed.',
    });
  }
});

/*
  REFRESH JOBS
  Use POST from Hoppscotch / cron:
  POST /api/jobs/refresh
  Header: x-job-refresh-secret: YOUR_SECRET

  Optional body:
  {
    "areas": ["Tzaneen", "Polokwane"],
    "query": "jobs",
    "verify": false
  }
*/
router.post('/refresh', async (req, res) => {
  if (!validateRefreshSecret(req)) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized job refresh.',
    });
  }

  const body = req.body || {};
  const query = normalizeText(body.query || req.query.query || 'jobs');

  const areas = Array.isArray(body.areas) && body.areas.length
    ? body.areas.map(normalizeText).filter(Boolean)
    : PRIORITY_AREAS.slice(0, 6);

  const verify = body.verify === true || req.query.verify === 'true';
  const warnings = [];
  const allJobs = [];

  for (const area of areas) {
    try {
      const adzuna = await searchAdzuna({
        query,
        area,
        page: 1,
        limit: 50,
      });

      if (!adzuna.ok) {
        warnings.push(`Adzuna refresh failed for ${query} in ${area}: ${adzuna.error}`);
        await sleep(800);
        continue;
      }

      let areaJobs = adzuna.jobs;

      if (verify && googleConfigured() && areaJobs.length) {
        const verified = [];

        for (const job of areaJobs.slice(0, 2)) {
          verified.push(await verifyJobWithGoogle(job));
          await sleep(250);
        }

        areaJobs = [...verified, ...areaJobs.slice(2)];
      }

      allJobs.push(...areaJobs);
      await sleep(800);
    } catch (error) {
      warnings.push(`Refresh failed for ${query} in ${area}: ${error?.message || 'Unknown error'}`);
    }
  }

  const uniqueJobs = removeDuplicates(allJobs);
  const saveResult = await saveJobsToSupabase(uniqueJobs);

  return res.json({
    ok: true,
    source: 'facemex_jobs_refresh',
    query,
    areas,
    found: uniqueJobs.length,
    saved: saveResult.saved,
    saveError: saveResult.error || null,
    warnings,
    message: 'FaceMeX jobs refreshed successfully.',
  });
});

/*
  CREATE LOCAL EMPLOYER JOB
*/
router.post('/', requireAuth, async (req, res) => {
  if (!hasTier(req.user, 'business')) {
    return res.status(403).json({
      error: 'tier_required',
      required: 'business',
    });
  }

  const body = req.body || {};
  const title = toStr(body.title).trim();
  const company = toStr(body.company).trim();
  const location = toStr(body.location || body.area).trim();
  const type = toStr(body.type || body.category).trim();
  const description = toStr(body.description).trim();
  const applyUrl = toStr(body.applyUrl || body.apply_url).trim();
  const deadline = toStr(body.deadline || body.closing_date).trim();

  const skills = Array.isArray(body.skills)
    ? body.skills.map((s) => toStr(s).trim()).filter(Boolean)
    : toStr(body.skills)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (!title || !company) {
    return res.status(400).json({
      error: 'missing_fields',
    });
  }

  const job = {
    id: `j${Date.now()}`,
    title,
    company,
    location: location || 'Remote',
    type: type || 'Full-time',
    description,
    skills,
    applyUrl,
    deadline: deadline || null,
    verificationStatus: 'verified',
    sourceType: 'facemex_verified_local_employer',
    createdAt: new Date().toISOString(),
  };

  jobs.unshift(job);
  await saveJSON('jobs.json', jobs).catch(() => {});

  const normalized = normalizeManualJob(job);

  await saveJobsToSupabase([normalized]).catch(() => {});

  return res.status(201).json(normalized);
});

/*
  APPLICATIONS
*/
router.get('/:jobId/applications', (req, res) => {
  const { jobId } = req.params;
  const list = applications.filter((a) => a.jobId === jobId);
  return res.json(list);
});

router.post('/:jobId/apply', async (req, res) => {
  const { jobId } = req.params;
  const job =
    jobs.find((j) => j.id === jobId) ||
    OFFICIAL_JOB_SOURCE_CARDS.find((j) => j.id === jobId);

  if (!job) {
    return res.status(404).json({
      error: 'job_not_found',
    });
  }

  const body = req.body || {};
  const fullName = toStr(body.fullName).trim();
  const email = toStr(body.email).trim();
  const phone = toStr(body.phone).trim();
  const coverLetter = toStr(body.coverLetter).trim();
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!fullName || !email) {
    return res.status(400).json({
      error: 'missing_fields',
    });
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

  return res.status(201).json({
    ok: true,
    applicationId: appRecord.id,
  });
});

export default router;
