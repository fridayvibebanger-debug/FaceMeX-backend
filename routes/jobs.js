import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

let jobs = [];
let applications = [];

jobs = (await loadJSON('jobs.json', jobs)) || jobs;
applications = (await loadJSON('jobApplications.json', applications)) || applications;

const toStr = (value) => (value == null ? '' : String(value));

/*
  RENDER ENV VARIABLES NEEDED

  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...

  ADZUNA_APP_ID=...
  ADZUNA_APP_KEY=...

  JOOBLE_API_KEY=...
  JOOBLE_ENABLED=true

  JOB_REFRESH_SECRET=...
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

const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY || '';
const JOOBLE_ENABLED = process.env.JOOBLE_ENABLED !== 'false';
const JOOBLE_API_BASE = process.env.JOOBLE_API_BASE || 'https://jooble.org/api';

const JOB_REFRESH_SECRET = process.env.JOB_REFRESH_SECRET || '';
const LIVE_SEARCH_COOLDOWN_MINUTES = Number(process.env.LIVE_SEARCH_COOLDOWN_MINUTES || 10);

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

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
  'Limpopo',
  'Gauteng',
  'Johannesburg',
  'Pretoria',
  'Durban',
  'Cape Town',
  'South Africa',
  'Africa',
];

const AFRICA_LOCATIONS = [
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
  'Africa',
];

const NON_SA_AFRICA_LOCATIONS = AFRICA_LOCATIONS.filter(
  (area) => !['South Africa', 'Africa'].includes(area)
);

const JOB_TYPE_KEYWORDS = [
  'jobs',
  'general worker',
  'cashier',
  'packer',
  'picker',
  'cleaner',
  'admin',
  'administrator',
  'clerk',
  'data capturer',
  'receptionist',
  'driver',
  'code 10 driver',
  'code 14 driver',
  'delivery driver',
  'courier',
  'security',
  'guard',
  'retail',
  'sales assistant',
  'store assistant',
  'shop assistant',
  'merchandiser',
  'promoter',
  'call centre',
  'customer service',
  'warehouse',
  'logistics',
  'forklift',
  'farm',
  'agriculture',
  'packhouse',
  'packing',
  'irrigation',
  'tractor driver',
  'hospitality',
  'hotel',
  'restaurant',
  'waiter',
  'waitress',
  'chef',
  'kitchen assistant',
  'housekeeping',
  'tourism',
  'construction',
  'builder',
  'plumber',
  'electrician',
  'mechanic',
  'artisan',
  'welder',
  'mining',
  'plant operator',
  'healthcare',
  'nurse',
  'caregiver',
  'clinic',
  'pharmacy',
  'teaching',
  'teacher assistant',
  'creche',
  'crèche',
  'educare',
  'school assistant',
  'learnership',
  'internship',
  'graduate',
  'apprenticeship',
  'IT',
  'software',
  'computer',
  'technician',
  'finance',
  'bookkeeper',
  'accounting',
  'HR',
  'human resources',
  'marketing',
  'social media',
  'remote',
  'part time',
  'full time',
  'temporary',
  'permanent',
];

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
    id: 'westfalia-careers',
    external_source: 'official_source',
    external_id: 'westfalia-careers',
    title: 'Westfalia Fruit Careers',
    company: 'Westfalia Fruit',
    area: 'Tzaneen / Limpopo',
    town: 'Tzaneen',
    province: 'Limpopo',
    category: 'Agriculture / Packhouse',
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
    category: 'Agriculture / Farm / Packhouse',
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
    category: 'Food / Manufacturing / Sales',
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
    id: 'ppecb-careers',
    external_source: 'official_source',
    external_id: 'ppecb-careers',
    title: 'PPECB Careers',
    company: 'PPECB',
    area: 'South Africa / Limpopo',
    town: 'Limpopo',
    province: 'Limpopo',
    category: 'Agriculture / Inspection / Admin',
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
    category: 'Government / Municipality',
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
    category: 'Government / Municipality',
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
    category: 'Government / Municipality',
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
    category: 'Government / Municipality',
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
    category: 'Government / Municipality',
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
    category: 'Government / Municipality',
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
    area: 'South Africa',
    town: 'South Africa',
    province: 'South Africa',
    category: 'Youth / Learnership / Entry Level',
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

const liveSearchCache = new Map();

function hasTier(user, minTier) {
  const tier = user?.tier || 'free';
  return (tierOrder[tier] ?? 0) >= (tierOrder[minTier] ?? 0);
}

function adzunaConfigured() {
  return Boolean(ADZUNA_APP_ID && ADZUNA_APP_KEY);
}

function joobleConfigured() {
  return Boolean(JOOBLE_ENABLED && JOOBLE_API_KEY);
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
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  const found = [...PRIORITY_AREAS, ...AFRICA_LOCATIONS].find((area) =>
    lower.includes(area.toLowerCase())
  );

  return found || 'Tzaneen';
}

function removeAreaWords(text = '') {
  let output = normalizeText(text);

  [...PRIORITY_AREAS, ...AFRICA_LOCATIONS].forEach((area) => {
    output = output.replace(new RegExp(`\\b${area}\\b`, 'gi'), ' ');
  });

  return output.replace(/\s+/g, ' ').trim();
}

function detectKeyword(text = '') {
  const lower = normalizeLower(text);

  if (/shoprite|checkers|usave|cashier|packer|retail|store|shop assistant|sales assistant/i.test(lower)) {
    return 'cashier packer retail store assistant sales assistant general worker';
  }

  if (/westfalia|zz2|farm|agriculture|packhouse|packing|picker|irrigation|tractor/i.test(lower)) {
    return 'farm agriculture packhouse packing picker irrigation tractor driver general worker';
  }

  if (/teacher|creche|crèche|school|educare|daycare|assistant teacher/i.test(lower)) {
    return 'teacher assistant creche educare daycare school assistant';
  }

  if (/driver|code 10|code 14|pdp|delivery|courier|logistics|truck/i.test(lower)) {
    return 'driver code 10 code 14 delivery courier logistics truck driver';
  }

  if (/security|guard|reaction|armed response/i.test(lower)) {
    return 'security guard reaction officer';
  }

  if (/admin|clerk|reception|data capture|office/i.test(lower)) {
    return 'admin clerk receptionist data capturer office assistant';
  }

  if (/cleaner|cleaning|housekeeping|domestic/i.test(lower)) {
    return 'cleaner cleaning housekeeping domestic worker';
  }

  if (/learnership|internship|graduate|apprentice|youth/i.test(lower)) {
    return 'learnership internship graduate apprenticeship youth opportunity';
  }

  const withoutArea = removeAreaWords(text);

  const cleaned = withoutArea
    .replace(/\bi am\b/gi, ' ')
    .replace(/\bi'm\b/gi, ' ')
    .replace(/\bim\b/gi, ' ')
    .replace(/\blooking for\b/gi, ' ')
    .replace(/\blook for\b/gi, ' ')
    .replace(/\bsearching for\b/gi, ' ')
    .replace(/\bshow me\b/gi, ' ')
    .replace(/\bfind me\b/gi, ' ')
    .replace(/\bfind\b/gi, ' ')
    .replace(/\bavailable\b/gi, ' ')
    .replace(/\bvacancies\b/gi, ' ')
    .replace(/\bvacancy\b/gi, ' ')
    .replace(/\bjob\b/gi, ' ')
    .replace(/\bjobs\b/gi, ' ')
    .replace(/\bwork\b/gi, ' ')
    .replace(/\bin\b/gi, ' ')
    .replace(/\bnear\b/gi, ' ')
    .replace(/\baround\b/gi, ' ')
    .replace(/\bplease\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'jobs';
}

function isNonSouthAfricaArea(area = '') {
  const lower = normalizeLower(area);

  return NON_SA_AFRICA_LOCATIONS.some((location) => lower.includes(location.toLowerCase()));
}

function getHost(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
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
  if (source.includes('jooble')) return 'jooble_job_api';
  if (source.includes('adzuna')) return 'adzuna_job_api';
  if (source.includes('api') || source.includes('external')) return 'external_job_api';
  if (source.includes('community') || source.includes('screenshot')) {
    return 'community_advert_needs_verification';
  }
  if (source.includes('risk') || source.includes('avoid')) return 'high_risk_avoid';

  return 'official_company_source';
}

function guessCategoryFromText(text = '') {
  const lower = normalizeLower(text);

  if (/cashier|retail|shop|store|sales assistant|merchandiser|promoter/.test(lower)) return 'Retail / Sales';
  if (/farm|agriculture|packhouse|packing|picker|irrigation|tractor/.test(lower)) return 'Agriculture / Packhouse';
  if (/driver|delivery|courier|logistics|truck|code 10|code 14/.test(lower)) return 'Driver / Logistics';
  if (/security|guard|reaction|armed response/.test(lower)) return 'Security';
  if (/admin|clerk|reception|data capturer|office/.test(lower)) return 'Admin / Office';
  if (/cleaner|cleaning|housekeeping|domestic/.test(lower)) return 'Cleaning / Housekeeping';
  if (/teacher|creche|school|educare|daycare/.test(lower)) return 'Education / Creche';
  if (/nurse|caregiver|clinic|health|pharmacy|hospital/.test(lower)) return 'Health / Care';
  if (/hotel|restaurant|waiter|chef|kitchen|tourism|hospitality/.test(lower)) return 'Hospitality / Tourism';
  if (/learnership|internship|graduate|apprentice/.test(lower)) return 'Learnership / Internship';
  if (/it|software|computer|technician|developer/.test(lower)) return 'IT / Technology';
  if (/finance|account|bookkeeper|payroll/.test(lower)) return 'Finance / Accounting';
  if (/construction|builder|electrician|plumber|mechanic|welder|artisan/.test(lower)) {
    return 'Construction / Artisan';
  }

  return 'Job opportunity';
}

function cleanDescription(text = '') {
  return normalizeText(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
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
      job.link ||
      job.url ||
      job.sourceUrl ||
      job.source_url
  );

  const sourceUrl = normalizeText(job.sourceUrl || job.source_url || applyUrl);
  const description = cleanDescription(job.description || job.snippet || job.summary || '');

  const fullText = `${title} ${company} ${area} ${description} ${job.category || ''}`;
  const category = normalizeText(job.category || job.type) || guessCategoryFromText(fullText);

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
    province: normalizeText(job.province || 'South Africa'),
    category,
    salary: normalizeText(job.salary || job.salary_text || job.salaryText) || null,
    deadline: normalizeText(job.deadline || job.closing_date || job.closingDate) || null,
    applyUrl,
    apply_url: applyUrl,
    sourceUrl,
    source_url: sourceUrl,
    sourceLabel:
      normalizeText(job.sourceLabel || job.source_label) ||
      (sourceType === 'adzuna_job_api'
        ? 'Adzuna live job source'
        : sourceType === 'jooble_job_api'
          ? 'Jooble live job source'
          : 'External job source'),
    source_label:
      normalizeText(job.sourceLabel || job.source_label) ||
      (sourceType === 'adzuna_job_api'
        ? 'Adzuna live job source'
        : sourceType === 'jooble_job_api'
          ? 'Jooble live job source'
          : 'External job source'),
    sourceType,
    source_type: sourceType,
    verificationStatus,
    verification_status: verificationStatus,
    actionLabel: normalizeText(job.actionLabel || job.action_label) || 'Open Apply Page',
    isSourceCard: Boolean(job.isSourceCard || job.is_source_card),
    description,
    createdAt: normalizeText(job.createdAt || job.created_at || job.updated) || new Date().toISOString(),
    updatedAt: normalizeText(job.updatedAt || job.updated_at) || new Date().toISOString(),
    trustScore: safeNumber(job.trustScore || job.trust_score, verificationStatus === 'verified' ? 85 : 60),
  };
}

function normalizeAdzunaJob(job = {}, area = 'South Africa') {
  const company = normalizeText(job?.company?.display_name || job?.company || 'Company not stated');
  const location = normalizeText(job?.location?.display_name || area);
  const category = normalizeText(job?.category?.label || 'Job opportunity');
  const applyUrl = normalizeText(job?.redirect_url || job?.url);
  const description = cleanDescription(job?.description || '');

  return normalizeJob({
    id: `adzuna-${job.id}`,
    external_source: 'adzuna',
    external_id: normalizeText(job.id),
    title: job.title,
    company,
    area: location,
    town: area,
    province: 'South Africa',
    category: category || guessCategoryFromText(`${job.title} ${description}`),
    salary:
      job.salary_min && job.salary_max
        ? `R${Math.round(job.salary_min)} - R${Math.round(job.salary_max)}`
        : null,
    deadline: null,
    applyUrl,
    sourceUrl: applyUrl,
    sourceLabel: 'Adzuna live job source',
    sourceType: 'adzuna_job_api',
    verificationStatus: 'needs_verification',
    actionLabel: 'Open Apply Page',
    isSourceCard: false,
    description,
    createdAt: job.created || new Date().toISOString(),
    trustScore: 65,
  });
}

function normalizeJoobleJob(job = {}, area = 'South Africa') {
  const applyUrl = normalizeText(job.link || job.url);
  const company = normalizeText(job.company || job.companyName || job.source || 'Company not stated');
  const title = normalizeText(job.title || 'Job opportunity');
  const location = normalizeText(job.location || area);
  const description = cleanDescription(job.snippet || job.description || '');

  return normalizeJob({
    id: `jooble-${job.id || `${title}-${company}-${location}`}`,
    external_source: 'jooble',
    external_id: normalizeText(job.id || applyUrl || `${title}-${company}-${location}`),
    title,
    company,
    area: location,
    town: location,
    province: location.includes('Limpopo') ? 'Limpopo' : 'South Africa',
    category: normalizeText(job.type) || guessCategoryFromText(`${title} ${description}`),
    salary: normalizeText(job.salary) || null,
    deadline: null,
    applyUrl,
    sourceUrl: applyUrl,
    sourceLabel: 'Jooble live job source',
    sourceType: 'jooble_job_api',
    verificationStatus: 'needs_verification',
    actionLabel: 'Open Apply Page',
    isSourceCard: false,
    description,
    createdAt: job.updated || new Date().toISOString(),
    trustScore: 62,
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
    province: 'South Africa',
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
    description: job.description || '',
    createdAt: job.createdAt || new Date().toISOString(),
    trustScore: 95,
  });
}

function jobIdentity(job = {}) {
  const host = getHost(job.applyUrl || job.apply_url || job.sourceUrl || job.source_url);
  const title = normalizeLower(job.title)
    .replace(/\bjob\b/g, '')
    .replace(/\bvacancy\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const company = normalizeLower(job.company)
    .replace(/\(pty\)/g, '')
    .replace(/\bltd\b/g, '')
    .replace(/\blimited\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const area = normalizeLower(job.area || job.town).replace(/\s+/g, ' ').trim();

  return {
    title,
    company,
    area,
    host,
    url: normalizeLower(job.applyUrl || job.apply_url),
    key: `${title}|${company}|${area}|${host}`,
  };
}

function isDuplicateJob(a = {}, b = {}) {
  const x = jobIdentity(a);
  const y = jobIdentity(b);

  if (x.url && y.url && x.url === y.url) return true;
  if (x.key === y.key) return true;

  const sameCompany = x.company && y.company && (x.company.includes(y.company) || y.company.includes(x.company));
  const sameTitle = x.title && y.title && (x.title.includes(y.title) || y.title.includes(x.title));
  const sameHost = x.host && y.host && x.host === y.host;

  return Boolean(sameCompany && sameTitle && (sameHost || x.area === y.area));
}

function mergeJobsSmart({ manualJobs = [], databaseJobs = [], adzunaJobs = [], joobleJobs = [], officialCards = [] }) {
  const merged = [];

  function add(job, reason = '') {
    const normalized = normalizeJob(job);
    const duplicate = merged.find((existing) => isDuplicateJob(existing, normalized));

    if (duplicate) {
      duplicate.foundBy = Array.from(
        new Set([...(duplicate.foundBy || []), ...(normalized.foundBy || []), normalized.external_source])
      ).filter(Boolean);

      duplicate.matchNote = duplicate.matchNote || reason || 'Duplicate found from another source';
      return;
    }

    merged.push({
      ...normalized,
      foundBy: Array.from(new Set([normalized.external_source].filter(Boolean))),
      matchNote: reason || '',
    });
  }

  manualJobs.forEach((job) => add(job, 'FaceMeX local employer job'));
  databaseJobs.forEach((job) => add(job, 'Saved job from FaceMeX database'));
  adzunaJobs.forEach((job) => add(job, 'Found by Adzuna'));
  joobleJobs.forEach((job) => add(job, 'Added by Jooble because it was not already found by Adzuna'));
  officialCards.forEach((job) => add(job, 'Trusted official apply page'));

  return merged;
}

function scoreJob(job = {}, query = '', area = '') {
  const text = normalizeLower(
    `${job.title} ${job.company} ${job.area} ${job.category} ${job.description || ''}`
  );

  const queryTokens = normalizeLower(query)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !['jobs', 'job', 'work', 'available'].includes(token));

  let score = 0;

  if (job.verificationStatus === 'verified' || job.verification_status === 'verified') score += 40;
  if (job.sourceType === 'facemex_verified_local_employer') score += 50;
  if (job.sourceType === 'adzuna_job_api') score += 34;
  if (job.sourceType === 'jooble_job_api') score += 32;
  if (job.sourceType === 'official_company_source' || job.sourceType === 'government_public_institution') score += 30;
  if (job.applyUrl || job.apply_url) score += 20;

  if (area && text.includes(normalizeLower(area))) score += 35;
  if (normalizeLower(area) === 'tzaneen' && /tzaneen|lenyenye|nkowankowa|maake|letsitele|modjadjiskloof/.test(text)) {
    score += 20;
  }

  queryTokens.forEach((token) => {
    if (text.includes(token)) score += 15;
  });

  if (job.isSourceCard || job.is_source_card) score -= 8;

  return score;
}

function sortJobs(list = [], query = '', area = '') {
  return [...list].sort((a, b) => {
    const diff = scoreJob(b, query, area) - scoreJob(a, query, area);
    if (diff !== 0) return diff;

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
      `${job.title} ${job.company} ${job.area} ${job.category} ${job.town} ${job.province} ${job.description || ''}`
    );

    const areaMatch =
      !a ||
      a === 'south africa' ||
      a === 'africa' ||
      text.includes(a) ||
      text.includes('remote') ||
      text.includes('south africa');

    const keywordMatch =
      keywordTokens.length === 0 || keywordTokens.some((token) => text.includes(token));

    return areaMatch || keywordMatch;
  });
}

async function searchAdzuna({ query = 'jobs', area = 'Tzaneen', page = 1, limit = 20 } = {}) {
  if (!adzunaConfigured()) {
    return {
      ok: false,
      source: 'adzuna',
      error: 'adzuna_not_configured',
      jobs: [],
      total: 0,
    };
  }

  if (isNonSouthAfricaArea(area)) {
    return {
      ok: true,
      source: 'adzuna',
      skipped: true,
      error: null,
      jobs: [],
      total: 0,
      message: 'Adzuna ZA skipped because this looks outside South Africa.',
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
      source: 'adzuna',
      status: response.status,
      error: data?.error || data?.message || data?.display || `Adzuna failed with status ${response.status}`,
      jobs: [],
      total: 0,
    };
  }

  const results = Array.isArray(data?.results) ? data.results : [];

  return {
    ok: true,
    source: 'adzuna',
    error: null,
    total: Number(data?.count || results.length),
    jobs: results.map((item) => normalizeAdzunaJob(item, area)).filter((job) => job.applyUrl),
  };
}

async function searchJooble({ query = 'jobs', area = 'Tzaneen', page = 1, limit = 20 } = {}) {
  if (!joobleConfigured()) {
    return {
      ok: false,
      source: 'jooble',
      error: 'jooble_not_configured',
      jobs: [],
      total: 0,
    };
  }

  const endpoint = `${JOOBLE_API_BASE.replace(/\/$/, '')}/${JOOBLE_API_KEY}`;

  const body = {
    keywords: query || 'jobs',
    location: area || 'South Africa',
    radius: '80',
    page: Number(page) || 1,
    ResultOnPage: Math.min(Math.max(Number(limit) || 20, 1), 50),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      source: 'jooble',
      status: response.status,
      error: data?.error || data?.message || `Jooble failed with status ${response.status}`,
      jobs: [],
      total: 0,
    };
  }

  const results = Array.isArray(data?.jobs) ? data.jobs : [];

  return {
    ok: true,
    source: 'jooble',
    error: null,
    total: Number(data?.totalCount || data?.total || results.length),
    jobs: results.map((item) => normalizeJoobleJob(item, area)).filter((job) => job.applyUrl),
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

    const normalized = Array.isArray(data)
      ? data.map(normalizeJob).filter((job) => job.applyUrl || job.apply_url)
      : [];

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

  const rows = list
    .filter((job) => !job.isSourceCard && !job.is_source_card)
    .map((job) => {
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
        description: normalized.description || '',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

  if (!rows.length) {
    return {
      ok: false,
      saved: 0,
      error: null,
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
    const text = normalizeLower(`${job.area} ${job.town} ${job.company} ${job.title} ${job.category}`);
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

async function runCombinedJobSearch({
  rawQuery = 'jobs',
  area = 'Tzaneen',
  limit = 50,
  includeAdzuna = true,
  includeJooble = true,
  includeOfficialSources = true,
} = {}) {
  const query = detectKeyword(rawQuery);
  const searchArea = area || detectArea(rawQuery) || 'Tzaneen';

  const warnings = [];
  let databaseJobs = [];
  let manualJobs = [];
  let adzunaJobs = [];
  let joobleJobs = [];

  manualJobs = filterJobsByIntent(jobs.map(normalizeManualJob), query, searchArea);

  try {
    databaseJobs = await getJobsFromSupabase({
      query,
      area: searchArea,
      limit,
    });
  } catch (error) {
    warnings.push(`Supabase search failed: ${error?.message || 'Unknown error'}`);
  }

  const [adzunaResult, joobleResult] = await Promise.allSettled([
    includeAdzuna
      ? searchAdzuna({
          query,
          area: searchArea,
          page: 1,
          limit: Math.min(limit, 50),
        })
      : Promise.resolve({ ok: true, source: 'adzuna', jobs: [], total: 0 }),

    includeJooble
      ? searchJooble({
          query,
          area: searchArea,
          page: 1,
          limit: Math.min(limit, 50),
        })
      : Promise.resolve({ ok: true, source: 'jooble', jobs: [], total: 0 }),
  ]);

  let adzunaMeta = {
    ok: false,
    total: 0,
    skipped: false,
    error: null,
  };

  let joobleMeta = {
    ok: false,
    total: 0,
    error: null,
  };

  if (adzunaResult.status === 'fulfilled') {
    adzunaMeta = {
      ok: adzunaResult.value.ok,
      total: adzunaResult.value.total || 0,
      skipped: Boolean(adzunaResult.value.skipped),
      error: adzunaResult.value.error || null,
    };
    adzunaJobs = adzunaResult.value.jobs || [];

    if (!adzunaResult.value.ok && adzunaResult.value.error) {
      warnings.push(`Adzuna search failed: ${adzunaResult.value.error}`);
    }
  } else {
    warnings.push(`Adzuna search failed: ${adzunaResult.reason?.message || 'Unknown error'}`);
  }

  if (joobleResult.status === 'fulfilled') {
    joobleMeta = {
      ok: joobleResult.value.ok,
      total: joobleResult.value.total || 0,
      error: joobleResult.value.error || null,
    };
    joobleJobs = joobleResult.value.jobs || [];

    if (!joobleResult.value.ok && joobleResult.value.error) {
      warnings.push(`Jooble search failed: ${joobleResult.value.error}`);
    }
  } else {
    warnings.push(`Jooble search failed: ${joobleResult.reason?.message || 'Unknown error'}`);
  }

  const officialCards = includeOfficialSources ? officialCardsForArea(searchArea) : [];

  const merged = mergeJobsSmart({
    manualJobs,
    databaseJobs,
    adzunaJobs,
    joobleJobs,
    officialCards: manualJobs.length || databaseJobs.length || adzunaJobs.length || joobleJobs.length ? [] : officialCards,
  });

  const sorted = sortJobs(merged, query, searchArea).slice(0, limit);

  const saveResult = await saveJobsToSupabase(sorted);

  return {
    ok: true,
    source: 'facemex_combined_jobs',
    query,
    rawQuery,
    area: searchArea,
    count: sorted.length,
    sources: {
      manual: manualJobs.length,
      supabase: databaseJobs.length,
      adzuna: adzunaJobs.length,
      jooble: joobleJobs.length,
      officialCards: manualJobs.length || databaseJobs.length || adzunaJobs.length || joobleJobs.length ? 0 : officialCards.length,
    },
    providerStatus: {
      supabaseConfigured: supabaseConfigured(),
      adzunaConfigured: adzunaConfigured(),
      joobleConfigured: joobleConfigured(),
      adzuna: adzunaMeta,
      jooble: joobleMeta,
    },
    savedToSupabase: saveResult.saved,
    saveError: saveResult.error || null,
    warnings,
    jobs: sorted,
  };
}

/*
  API STATUS
*/
router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'FaceMeX Jobs API',
    supabaseConfigured: supabaseConfigured(),
    adzunaConfigured: adzunaConfigured(),
    joobleConfigured: joobleConfigured(),
    hasRefreshSecret: Boolean(JOB_REFRESH_SECRET),
    localEmployerPosts: jobs.length,
    priorityAreas: PRIORITY_AREAS,
    africaLocations: AFRICA_LOCATIONS,
    jobTypes: JOB_TYPE_KEYWORDS,
    liveSearchCooldownMinutes: LIVE_SEARCH_COOLDOWN_MINUTES,
  });
});

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'FaceMeX Jobs API',
    supabaseConfigured: supabaseConfigured(),
    adzunaConfigured: adzunaConfigured(),
    joobleConfigured: joobleConfigured(),
    hasRefreshSecret: Boolean(JOB_REFRESH_SECRET),
    table: SUPABASE_JOBS_TABLE,
    localEmployerPosts: jobs.length,
    applications: applications.length,
    priorityAreas: PRIORITY_AREAS,
    africaLocations: AFRICA_LOCATIONS,
    jobTypes: JOB_TYPE_KEYWORDS,
  });
});

/*
  TEST ADZUNA ONLY
  /api/jobs/adzuna-test?query=driver&area=Tzaneen
*/
router.get('/adzuna-test', async (req, res) => {
  const query = normalizeText(req.query.query || req.query.q || 'jobs');
  const area = normalizeText(req.query.area || req.query.where || 'Tzaneen');

  try {
    const result = await searchAdzuna({
      query,
      area,
      page: 1,
      limit: 20,
    });

    return res.json({
      ok: result.ok,
      source: 'adzuna',
      adzunaConfigured: adzunaConfigured(),
      query,
      area,
      count: result.jobs.length,
      total: result.total,
      skipped: Boolean(result.skipped),
      error: result.error || null,
      jobs: result.jobs,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      source: 'adzuna',
      adzunaConfigured: adzunaConfigured(),
      error: error?.message || 'Adzuna test failed.',
      jobs: [],
    });
  }
});

/*
  TEST JOOBLE ONLY
  /api/jobs/jooble-test?query=driver&area=Tzaneen
*/
router.get('/jooble-test', async (req, res) => {
  const query = normalizeText(req.query.query || req.query.q || 'jobs');
  const area = normalizeText(req.query.area || req.query.where || 'Tzaneen');

  try {
    const result = await searchJooble({
      query,
      area,
      page: 1,
      limit: 20,
    });

    return res.json({
      ok: result.ok,
      source: 'jooble',
      joobleConfigured: joobleConfigured(),
      query,
      area,
      count: result.jobs.length,
      total: result.total,
      error: result.error || null,
      jobs: result.jobs,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      source: 'jooble',
      joobleConfigured: joobleConfigured(),
      error: error?.message || 'Jooble test failed.',
      jobs: [],
    });
  }
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
  MAIN AUTO SEARCH
  /api/jobs/auto-search?query=driver&area=Tzaneen&includeExternal=true&includeOfficialSources=true&limit=80

  This searches:
  1. FaceMeX manual jobs
  2. Supabase saved jobs
  3. Adzuna live jobs
  4. Jooble live jobs
  5. Official source cards if no live result exists
*/
router.get('/auto-search', async (req, res) => {
  const rawQuery = normalizeText(req.query.query || req.query.q || 'jobs');
  const area = normalizeText(req.query.area || req.query.where || detectArea(rawQuery) || 'Tzaneen');

  const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 100);
  const includeExternal = req.query.includeExternal !== 'false';
  const includeAdzuna = includeExternal && req.query.includeAdzuna !== 'false';
  const includeJooble = includeExternal && req.query.includeJooble !== 'false';
  const includeOfficialSources = req.query.includeOfficialSources !== 'false';

  const query = detectKeyword(rawQuery);
  const cached = getFromCache(query, area);

  if (cached) {
    return res.json({
      ...cached,
      cached: true,
      cacheMinutes: LIVE_SEARCH_COOLDOWN_MINUTES,
    });
  }

  try {
    const result = await runCombinedJobSearch({
      rawQuery,
      area,
      limit,
      includeAdzuna,
      includeJooble,
      includeOfficialSources,
    });

    saveToCache(query, area, result);

    return res.json({
      ...result,
      cached: false,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      source: 'facemex_combined_jobs',
      query,
      area,
      error: error?.message || 'Auto search failed.',
      jobs: [],
    });
  }
});

/*
  SEARCH ALL JOB TYPES IN ONE AREA
  /api/jobs/discover?area=Tzaneen&limitPerType=10

  Use carefully. It calls Adzuna + Jooble many times.
*/
router.get('/discover', async (req, res) => {
  const area = normalizeText(req.query.area || 'Tzaneen');
  const limitPerType = Math.min(Math.max(Number(req.query.limitPerType || 10), 1), 20);
  const maxTypes = Math.min(Math.max(Number(req.query.maxTypes || 12), 1), JOB_TYPE_KEYWORDS.length);

  const selectedTypes = JOB_TYPE_KEYWORDS.slice(0, maxTypes);
  const allJobs = [];
  const warnings = [];

  for (const keyword of selectedTypes) {
    try {
      const result = await runCombinedJobSearch({
        rawQuery: keyword,
        area,
        limit: limitPerType,
        includeAdzuna: true,
        includeJooble: true,
        includeOfficialSources: false,
      });

      allJobs.push(...result.jobs);
      if (result.warnings?.length) warnings.push(...result.warnings);
      await sleep(500);
    } catch (error) {
      warnings.push(`Discover failed for ${keyword}: ${error?.message || 'Unknown error'}`);
    }
  }

  const merged = mergeJobsSmart({
    adzunaJobs: allJobs.filter((job) => job.external_source === 'adzuna'),
    joobleJobs: allJobs.filter((job) => job.external_source === 'jooble'),
    databaseJobs: allJobs.filter((job) => job.external_source !== 'adzuna' && job.external_source !== 'jooble'),
    officialCards: [],
  });

  const sorted = sortJobs(merged, 'jobs', area).slice(0, 100);
  const saveResult = await saveJobsToSupabase(sorted);

  return res.json({
    ok: true,
    source: 'facemex_discover_jobs',
    area,
    searchedTypes: selectedTypes,
    count: sorted.length,
    savedToSupabase: saveResult.saved,
    saveError: saveResult.error || null,
    warnings,
    jobs: sorted,
  });
});

/*
  REFRESH TEST
  Browser:
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
  const rawQuery = normalizeText(req.query.query || req.query.q || 'jobs');

  try {
    const result = await runCombinedJobSearch({
      rawQuery,
      area,
      limit: 80,
      includeAdzuna: true,
      includeJooble: true,
      includeOfficialSources: true,
    });

    return res.json({
      ...result,
      source: 'refresh_test',
      message: 'Refresh test completed with Adzuna + Jooble.',
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
  POST /api/jobs/refresh
  Header: x-job-refresh-secret: YOUR_SECRET

  Body:
  {
    "areas": ["Tzaneen", "Polokwane"],
    "queries": ["jobs", "driver", "cashier", "farm"],
    "limit": 30
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

  const areas = Array.isArray(body.areas) && body.areas.length
    ? body.areas.map(normalizeText).filter(Boolean)
    : ['Tzaneen', 'Polokwane', 'Phalaborwa', 'Hoedspruit', 'Makhado', 'Limpopo'];

  const queries = Array.isArray(body.queries) && body.queries.length
    ? body.queries.map(normalizeText).filter(Boolean)
    : ['jobs', 'general worker', 'cashier', 'driver', 'admin', 'security', 'farm', 'packhouse'];

  const limit = Math.min(Math.max(Number(body.limit || 30), 1), 80);

  const allJobs = [];
  const warnings = [];

  for (const area of areas) {
    for (const query of queries) {
      try {
        const result = await runCombinedJobSearch({
          rawQuery: query,
          area,
          limit,
          includeAdzuna: true,
          includeJooble: true,
          includeOfficialSources: false,
        });

        allJobs.push(...result.jobs);

        if (result.warnings?.length) {
          warnings.push(...result.warnings);
        }

        await sleep(700);
      } catch (error) {
        warnings.push(`Refresh failed for ${query} in ${area}: ${error?.message || 'Unknown error'}`);
      }
    }
  }

  const merged = mergeJobsSmart({
    adzunaJobs: allJobs.filter((job) => job.external_source === 'adzuna'),
    joobleJobs: allJobs.filter((job) => job.external_source === 'jooble'),
    databaseJobs: allJobs.filter((job) => job.external_source !== 'adzuna' && job.external_source !== 'jooble'),
    officialCards: [],
  });

  const sorted = sortJobs(merged, 'jobs', areas[0]).slice(0, 250);
  const saveResult = await saveJobsToSupabase(sorted);

  return res.json({
    ok: true,
    source: 'facemex_jobs_refresh',
    areas,
    queries,
    found: sorted.length,
    saved: saveResult.saved,
    saveError: saveResult.error || null,
    warnings,
    message: 'FaceMeX jobs refreshed successfully with Adzuna + Jooble.',
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
    ? body.skills.map((skill) => toStr(skill).trim()).filter(Boolean)
    : toStr(body.skills)
        .split(',')
        .map((skill) => skill.trim())
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
    type: type || guessCategoryFromText(`${title} ${description}`),
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
  const list = applications.filter((application) => application.jobId === jobId);

  return res.json(list);
});

router.post('/:jobId/apply', async (req, res) => {
  const { jobId } = req.params;

  const job =
    jobs.find((item) => item.id === jobId) ||
    OFFICIAL_JOB_SOURCE_CARDS.find((item) => item.id === jobId);

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

  const cleanedAttachments = attachments
    .map((file) => ({
      name: toStr(file?.name).slice(0, 160),
      type: toStr(file?.type).slice(0, 80),
      dataUrl: toStr(file?.dataUrl),
    }))
    .filter((file) => file.name && file.dataUrl);

  const appRecord = {
    id: `a${Date.now()}`,
    jobId,
    jobTitle: job.title,
    company: job.company,
    fullName,
    email,
    phone,
    coverLetter,
    attachments: cleanedAttachments,
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
