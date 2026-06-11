import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/*
  OLD FACE MEX JOBS SYSTEM
  Kept for business users posting jobs and people applying inside FaceMeX.
*/
let jobs = [];
let applications = [];

jobs = (await loadJSON('jobs.json', jobs)) || jobs;
applications = (await loadJSON('jobApplications.json', applications)) || applications;

const toStr = (v) => (v == null ? '' : String(v));

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

/*
  NEW AUTOMATIC JOB ENGINE
*/
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

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

const DEFAULT_KEYWORDS = [
  'jobs',
  'cashier',
  'packer',
  'clerk',
  'general worker',
  'admin',
  'security',
  'driver',
  'teacher',
  'cleaner',
  'retail',
  'farm',
  'packhouse',
  'learnership',
  'internship',
  'waiter',
  'waitress',
  'shop assistant',
  'store assistant',
];

const OFFICIAL_SOURCE_CARDS = [
  {
    external_id: 'shoprite-official-jobs',
    external_source: 'official_source',
    title: 'Shoprite / Checkers / Usave Store Jobs',
    company: 'Shoprite Group',
    area: 'Tzaneen / South Africa',
    province: 'Limpopo',
    category: 'Retail',
    apply_url: 'https://apply.shoprite.jobs/',
    source_url: 'https://apply.shoprite.jobs/',
    source_label: 'Official Company Source',
    source_type: 'official_company_source',
    verification_status: 'verified',
    description:
      'Official Shoprite Group application portal for store jobs such as cashier, clerk, packer, general worker and store assistant.',
    is_active: true,
  },
  {
    external_id: 'shoprite-careers',
    external_source: 'official_source',
    title: 'Shoprite Group Careers',
    company: 'Shoprite Group',
    area: 'South Africa',
    province: 'Limpopo',
    category: 'Retail',
    apply_url: 'https://www.shopriteholdings.co.za/careers.html',
    source_url: 'https://www.shopriteholdings.co.za/careers.html',
    source_label: 'Official Company Source',
    source_type: 'official_company_source',
    verification_status: 'verified',
    description: 'Official Shoprite Group careers page.',
    is_active: true,
  },
  {
    external_id: 'westfalia-careers',
    external_source: 'official_source',
    title: 'Westfalia Fruit Careers',
    company: 'Westfalia Fruit',
    area: 'Tzaneen / Limpopo',
    province: 'Limpopo',
    category: 'Agriculture',
    apply_url: 'https://www.westfaliafruit.com/careers',
    source_url: 'https://www.westfaliafruit.com/careers',
    source_label: 'Official Company Source',
    source_type: 'official_company_source',
    verification_status: 'verified',
    description: 'Official Westfalia Fruit careers page.',
    is_active: true,
  },
  {
    external_id: 'zz2-vacancies',
    external_source: 'official_source',
    title: 'ZZ2 Vacancies',
    company: 'ZZ2',
    area: 'Tzaneen / Mooketsi / Limpopo',
    province: 'Limpopo',
    category: 'Agriculture',
    apply_url: 'https://recruit.zz2.co.za/vacancies',
    source_url: 'https://recruit.zz2.co.za/vacancies',
    source_label: 'Official Company Source',
    source_type: 'official_company_source',
    verification_status: 'verified',
    description: 'Official ZZ2 recruitment page.',
    is_active: true,
  },
  {
    external_id: 'limpopo-health-careers',
    external_source: 'official_source',
    title: 'Limpopo Department of Health Careers',
    company: 'Limpopo Department of Health',
    area: 'Limpopo',
    province: 'Limpopo',
    category: 'Government / Health',
    apply_url: 'https://www.ldoh.gov.za/?q=node/11',
    source_url: 'https://www.ldoh.gov.za/?q=node/11',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description: 'Official Limpopo Department of Health careers page.',
    is_active: true,
  },
  {
    external_id: 'greater-tzaneen-vacancies',
    external_source: 'official_source',
    title: 'Greater Tzaneen Municipality Vacancies',
    company: 'Greater Tzaneen Municipality',
    area: 'Tzaneen',
    province: 'Limpopo',
    category: 'Government',
    apply_url: 'https://www.greatertzaneen.gov.za/?q=current_vacancies',
    source_url: 'https://www.greatertzaneen.gov.za/?q=current_vacancies',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description: 'Official Greater Tzaneen Municipality vacancies page.',
    is_active: true,
  },
  {
    external_id: 'polokwane-employment-portal',
    external_source: 'official_source',
    title: 'Polokwane Municipality Employment Portal',
    company: 'Polokwane Municipality',
    area: 'Polokwane',
    province: 'Limpopo',
    category: 'Government',
    apply_url: 'https://apply.polokwane.gov.za/',
    source_url: 'https://apply.polokwane.gov.za/',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description: 'Official Polokwane Municipality employment portal.',
    is_active: true,
  },
  {
    external_id: 'ba-phalaborwa-vacancies',
    external_source: 'official_source',
    title: 'Ba-Phalaborwa Municipality Vacancies',
    company: 'Ba-Phalaborwa Municipality',
    area: 'Phalaborwa',
    province: 'Limpopo',
    category: 'Government',
    apply_url: 'https://www.phalaborwa.gov.za/vacancies/vacancies.php',
    source_url: 'https://www.phalaborwa.gov.za/vacancies/vacancies.php',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description: 'Official Ba-Phalaborwa Municipality vacancies page.',
    is_active: true,
  },
  {
    external_id: 'maruleng-vacancies',
    external_source: 'official_source',
    title: 'Maruleng Municipality Vacancies',
    company: 'Maruleng Municipality',
    area: 'Hoedspruit',
    province: 'Limpopo',
    category: 'Government',
    apply_url: 'https://www.maruleng.gov.za/pages/vacancies.php',
    source_url: 'https://www.maruleng.gov.za/pages/vacancies.php',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description: 'Official Maruleng Municipality vacancies page.',
    is_active: true,
  },
  {
    external_id: 'makhado-vacancies',
    external_source: 'official_source',
    title: 'Makhado Municipality Advertised Posts',
    company: 'Makhado Municipality',
    area: 'Makhado',
    province: 'Limpopo',
    category: 'Government',
    apply_url: 'https://www.makhado.gov.za/?q=advertisedvacancies',
    source_url: 'https://www.makhado.gov.za/?q=advertisedvacancies',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description: 'Official Makhado Municipality advertised vacancies page.',
    is_active: true,
  },
  {
    external_id: 'musina-vacancies',
    external_source: 'official_source',
    title: 'Musina Municipality Vacancies',
    company: 'Musina Municipality',
    area: 'Musina',
    province: 'Limpopo',
    category: 'Government',
    apply_url: 'https://www.musina.gov.za/vacancies-musina-municipality/',
    source_url: 'https://www.musina.gov.za/vacancies-musina-municipality/',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description: 'Official Musina Municipality vacancies page.',
    is_active: true,
  },
  {
    external_id: 'sayouth-opportunities',
    external_source: 'official_source',
    title: 'SAYouth Opportunities',
    company: 'SAYouth',
    area: 'South Africa / Youth Opportunities',
    province: 'Limpopo',
    category: 'Youth / Learnerships',
    apply_url: 'https://sayouth.mobi/',
    source_url: 'https://sayouth.mobi/',
    source_label: 'Government / Public Institution',
    source_type: 'government_public_institution',
    verification_status: 'verified',
    description:
      'Official youth opportunities platform for learnerships, entry-level jobs and programmes.',
    is_active: true,
  },
];

function clean(value) {
  return String(value || '').trim();
}

function normalizeArea(value) {
  const area = clean(value);

  if (!area) return 'Tzaneen';

  if (/messina/i.test(area)) return 'Musina';

  return area;
}

function normalizeQuery(value) {
  const query = clean(value);

  if (!query) return 'jobs';

  return (
    query
      .replace(/i am looking for/gi, '')
      .replace(/i'm looking for/gi, '')
      .replace(/looking for/gi, '')
      .replace(/available/gi, '')
      .replace(/near me/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'jobs'
  );
}

function getAdzunaCategoryFallback(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase();

  if (/(cashier|shop|store|retail|packer|merchandiser)/i.test(text)) return 'Retail';
  if (/(driver|code 10|code 14|delivery|transport)/i.test(text)) return 'Driver / Transport';
  if (/(security|guard|armed)/i.test(text)) return 'Security';
  if (/(teacher|educator|school|creche|crèche|daycare)/i.test(text)) return 'Education';
  if (/(farm|packhouse|agriculture|fruit|packing)/i.test(text)) return 'Agriculture';
  if (/(admin|clerk|reception|office)/i.test(text)) return 'Admin / Office';
  if (/(cleaner|cleaning|housekeeping)/i.test(text)) return 'Cleaning';

  return null;
}

function sourceCardToFrontend(job) {
  return {
    id: job.external_id || job.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: job.title,
    company: job.company,
    area: job.area,
    category: job.category || null,
    salary: null,
    deadline: null,
    applyUrl: job.apply_url,
    sourceUrl: job.source_url || job.apply_url,
    sourceLabel: job.source_label || 'Official Source',
    sourceType: job.source_type || 'official_company_source',
    verificationStatus: job.verification_status || 'verified',
    actionLabel: 'Open Official Page',
    isSourceCard: true,
  };
}

function mapJobForFrontend(job) {
  return {
    id: job.id || `${job.external_source}-${job.external_id}`,
    title: job.title,
    company: job.company,
    area: job.area,
    category: job.category || null,
    salary: job.salary || null,
    deadline: job.deadline || null,
    applyUrl: job.apply_url,
    sourceUrl: job.source_url || job.apply_url,
    sourceLabel: job.source_label || 'Source',
    sourceType: job.source_type || 'external_job_api',
    verificationStatus: job.verification_status || 'needs_verification',
    actionLabel:
      job.verification_status === 'verified' ? 'Apply Now' : 'Verify First',
    createdAt: job.created_at || null,
    isSourceCard: false,
  };
}

function jsonJobToFrontend(job) {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    area: job.location || job.area || 'Remote',
    category: job.type || null,
    salary: null,
    deadline: null,
    applyUrl: `/jobs/${job.id}`,
    sourceUrl: `/jobs/${job.id}`,
    sourceLabel: 'FaceMeX Employer Post',
    sourceType: 'facemex_verified_local_employer',
    verificationStatus: 'needs_verification',
    actionLabel: 'Apply in FaceMeX',
    createdAt: job.createdAt || null,
    isSourceCard: false,
  };
}

function buildAdzunaUrl({ query, area, page = 1 }) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: query || 'jobs',
    where: area || 'Tzaneen',
    results_per_page: '50',
    content_type: 'application/json',
    sort_by: 'date',
  });

  return `https://api.adzuna.com/v1/api/jobs/za/search/${page}?${params.toString()}`;
}

function normalizeAdzunaJob(job, areaFallback) {
  const title = clean(job.title);
  const company = clean(job.company?.display_name) || 'Company not stated';
  const area = clean(job.location?.display_name) || areaFallback || 'South Africa';
  const applyUrl = clean(job.redirect_url);
  const description = clean(job.description);

  if (!title || !applyUrl || !job.id) return null;

  return {
    external_id: String(job.id),
    external_source: 'adzuna',
    title,
    company,
    area,
    province: area.toLowerCase().includes('limpopo') ? 'Limpopo' : null,
    category:
      clean(job.category?.label) ||
      getAdzunaCategoryFallback(title, description),
    salary:
      job.salary_min && job.salary_max
        ? `R${Math.round(job.salary_min)} - R${Math.round(job.salary_max)}`
        : null,
    description,
    requirements: null,
    apply_url: applyUrl,
    source_url: applyUrl,
    source_label: 'External Job API',
    source_type: 'external_job_api',
    verification_status: 'needs_verification',
    deadline: null,
    contact_email: null,
    contact_phone: null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function fetchAdzunaJobs({ query, area, pages = 2 }) {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) {
    return [];
  }

  const allJobs = [];

  for (let page = 1; page <= pages; page += 1) {
    const url = buildAdzunaUrl({ query, area, page });
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Adzuna failed ${response.status}: ${text.slice(0, 120)}`);
    }

    const data = await response.json();
    const foundJobs = Array.isArray(data.results) ? data.results : [];

    for (const job of foundJobs) {
      const normalized = normalizeAdzunaJob(job, area);
      if (normalized) allJobs.push(normalized);
    }
  }

  return allJobs;
}

async function upsertJobs(jobList) {
  if (!supabase || !jobList.length) return [];

  const cleanJobs = jobList.filter((job) => job.external_source && job.external_id);

  if (!cleanJobs.length) return [];

  const { data, error } = await supabase
    .from('facemex_jobs')
    .upsert(cleanJobs, {
      onConflict: 'external_source,external_id',
    })
    .select();

  if (error) throw error;

  return data || [];
}

function textMatchesQuery(job, query) {
  const q = normalizeQuery(query).toLowerCase();

  if (!q || q === 'jobs' || q === 'job') return true;

  const words = q
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);

  if (!words.length) return true;

  const text = [
    job.title,
    job.company,
    job.area,
    job.location,
    job.category,
    job.description,
    job.requirements,
  ]
    .join(' ')
    .toLowerCase();

  return words.some((word) => text.includes(word));
}

function textMatchesArea(job, area) {
  const areaValue = normalizeArea(area).toLowerCase();

  if (!areaValue || areaValue === 'south africa') return true;

  const text = [job.area, job.location, job.province, job.description, job.company]
    .join(' ')
    .toLowerCase();

  return text.includes(areaValue);
}

async function searchSupabaseJobs({ query, area, limit = 80 }) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('facemex_jobs')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  const dbJobs = data || [];

  return dbJobs
    .filter((job) => textMatchesArea(job, area))
    .filter((job) => textMatchesQuery(job, query))
    .sort((a, b) => {
      if (a.verification_status === 'verified' && b.verification_status !== 'verified') {
        return -1;
      }

      if (a.verification_status !== 'verified' && b.verification_status === 'verified') {
        return 1;
      }

      return String(a.title || '').localeCompare(String(b.title || ''));
    })
    .slice(0, limit);
}

function searchFaceMeXEmployerJobs({ query, area, limit = 40 }) {
  return jobs
    .filter((job) => textMatchesArea(job, area))
    .filter((job) => textMatchesQuery(job, query))
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
    .slice(0, limit);
}

async function saveOfficialSourceCards() {
  try {
    await upsertJobs(
      OFFICIAL_SOURCE_CARDS.map((job) => ({
        ...job,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
    );
  } catch (error) {
    console.error('Could not save official source cards:', error?.message || error);
  }
}

function getFallbackSourceCards({ area }) {
  const areaValue = normalizeArea(area).toLowerCase();

  const localFirst = OFFICIAL_SOURCE_CARDS.filter((job) => {
    const text = `${job.area} ${job.company} ${job.title}`.toLowerCase();

    return (
      text.includes(areaValue) ||
      text.includes('south africa') ||
      text.includes('limpopo')
    );
  });

  return localFirst.length ? localFirst : OFFICIAL_SOURCE_CARDS;
}

/*
  NEW ROUTES FOR JOB AI
*/
router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    service: 'FaceMeX Jobs API',
    supabaseConfigured: !!supabase,
    adzunaConfigured: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
    hasRefreshSecret: !!process.env.JOB_REFRESH_SECRET,
    localEmployerPosts: jobs.length,
    priorityAreas: PRIORITY_AREAS,
  });
});

router.get('/auto-search', async (req, res) => {
  try {
    const query = normalizeQuery(req.query.query);
    const area = normalizeArea(req.query.area);
    const limit = Math.min(Number(req.query.limit || 80), 100);

    await saveOfficialSourceCards();

    const employerJobs = searchFaceMeXEmployerJobs({
      query,
      area,
      limit: 30,
    }).map(jsonJobToFrontend);

    let dbJobs = await searchSupabaseJobs({
      query,
      area,
      limit,
    });

    if (dbJobs.length < 10 && process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
      const liveJobs = await fetchAdzunaJobs({
        query,
        area,
        pages: 2,
      });

      await upsertJobs(liveJobs);

      dbJobs = await searchSupabaseJobs({
        query,
        area,
        limit,
      });
    }

    const frontendDbJobs = dbJobs.map(mapJobForFrontend);

    const combined = [...employerJobs, ...frontendDbJobs];

    const fallbackCards =
      combined.length >= 5
        ? []
        : getFallbackSourceCards({ area }).map(sourceCardToFrontend);

    res.json({
      ok: true,
      source: 'facemex_jobs_auto_search',
      query,
      area,
      count: combined.length + fallbackCards.length,
      employerPosts: employerJobs.length,
      databaseJobs: frontendDbJobs.length,
      jobs: [...combined, ...fallbackCards],
    });
  } catch (error) {
    console.error('auto-search jobs error:', error?.message || error);

    res.status(500).json({
      ok: false,
      error: 'Could not search jobs right now.',
      jobs: getFallbackSourceCards({ area: req.query.area || 'Tzaneen' }).map(
        sourceCardToFrontend
      ),
    });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const secret = req.headers['x-job-refresh-secret'];

    if (!process.env.JOB_REFRESH_SECRET || secret !== process.env.JOB_REFRESH_SECRET) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized job refresh.',
      });
    }

    await saveOfficialSourceCards();

    const allJobs = [];

    for (const area of PRIORITY_AREAS) {
      for (const keyword of DEFAULT_KEYWORDS) {
        try {
          const liveJobs = await fetchAdzunaJobs({
            query: keyword,
            area,
            pages: 1,
          });

          allJobs.push(...liveJobs);
        } catch (error) {
          console.error(
            `Adzuna refresh failed for ${keyword} in ${area}:`,
            error?.message || error
          );
        }
      }
    }

    const unique = new Map();

    for (const job of allJobs) {
      unique.set(`${job.external_source}-${job.external_id}`, job);
    }

    const saved = await upsertJobs([...unique.values()]);

    res.json({
      ok: true,
      searchedAreas: PRIORITY_AREAS.length,
      searchedKeywords: DEFAULT_KEYWORDS.length,
      foundBeforeUnique: allJobs.length,
      saved: saved.length,
      message: 'FaceMeX jobs refreshed successfully.',
    });
  } catch (error) {
    console.error('refresh jobs error:', error?.message || error);

    res.status(500).json({
      ok: false,
      error: 'Job refresh failed.',
    });
  }
});

/*
  OLD ROUTES - KEPT WORKING
*/
router.get('/', (_req, res) => {
  res.json(jobs);
});

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

  return res.status(201).json({
    ok: true,
    applicationId: appRecord.id,
  });
});

export default router;
