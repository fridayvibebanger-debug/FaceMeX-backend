import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

const useLocalAi = false;

/* ---------------------------------------------
   BASIC HELPERS
--------------------------------------------- */

function clean(value) {
  return String(value || '').trim();
}

function stripMarkdownSymbols(text = '') {
  return String(text || '')
    .replace(/```/g, '')
    .trim();
}

function getAiText(out) {
  return clean(out?.choices?.[0]?.message?.content || '');
}

function isCreatorTier(tier, creatorPlus) {
  const t = String(tier || '').toLowerCase();

  return (
    creatorPlus === true ||
    t === 'creator+' ||
    t === 'creator' ||
    t === 'business' ||
    t === 'exclusive'
  );
}

function isProTier(tier) {
  return String(tier || '').toLowerCase() === 'pro';
}

function toBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;

  const v = String(value || '').trim().toLowerCase();

  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function getSouthAfricaDateContext() {
  const now = new Date();
  const timeZone = 'Africa/Johannesburg';

  const readableDateTime = new Intl.DateTimeFormat('en-ZA', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  const shortDate = new Intl.DateTimeFormat('en-ZA', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  return {
    nowIso: now.toISOString(),
    timeZone,
    readableDateTime,
    shortDate,
    isoDate,
  };
}

function normalizeUserPromptText(text = '') {
  const raw = clean(text);

  if (!raw.includes('USER QUESTION:')) return raw;

  const parts = raw.split('USER QUESTION:');
  return clean(parts[parts.length - 1]);
}

/* ---------------------------------------------
   AI CLIENTS
--------------------------------------------- */

async function callDeepseekChat(payload) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY missing');
  }

  const client = new OpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    apiKey,
  });

  const { model, messages, ...rest } = payload || {};

  return client.chat.completions.create({
    model: model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    messages,
    temperature: 0.35,
    max_tokens: 1600,
    ...rest,
  });
}

async function callLlamaChat(payload) {
  const apiKey = process.env.LLAMA_API_KEY;
  const baseURL = process.env.LLAMA_API_BASE_URL;

  if (!apiKey || !baseURL) {
    throw new Error('LLAMA_API_KEY or LLAMA_API_BASE_URL missing');
  }

  const client = new OpenAI({
    baseURL,
    apiKey,
  });

  const { model, messages, ...rest } = payload || {};

  return client.chat.completions.create({
    model: model || process.env.LLAMA_MODEL || 'llama-3.1-8b-instruct',
    messages,
    temperature:
      typeof process.env.LLAMA_TEMPERATURE !== 'undefined'
        ? Number(process.env.LLAMA_TEMPERATURE)
        : 0.8,
    max_tokens:
      typeof process.env.LLAMA_MAX_TOKENS !== 'undefined'
        ? Number(process.env.LLAMA_MAX_TOKENS)
        : 512,
    ...rest,
  });
}

async function callVisionChat({ userPrompt, images, postContext = '' }) {
  const apiKey = process.env.OPENAI_VISION_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      text:
        'I received the image, but image analysis is not configured yet. Add OPENAI_API_KEY to the backend .env file and set OPENAI_VISION_MODEL=gpt-4o-mini.',
    };
  }

  const client = new OpenAI({
    apiKey,
    baseURL:
      process.env.OPENAI_VISION_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com/v1',
  });

  const date = getSouthAfricaDateContext();

  const system = `
You are FaceMeX Vision Workspace.

You analyse uploaded images for South African users.

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
Timezone: ${date.timeZone}.

When analysing images:
- Read visible text carefully.
- Identify company name, job title, location, closing date, requirements, email, phone, WhatsApp number, website, and apply link if visible.
- If it is a job advert, say whether it looks safer, needs verification, or high risk.
- Do not say "100% legit" unless the image contains official proof like a real company domain, official careers page, or government website.
- If the image says "link in comments", "DM me", "WhatsApp only", or asks for payment, mark it as needs verification or high risk.
- If the user asks a question about the image, answer that exact question.
- If the user asks for help applying, give a copy-ready message.
- If the image is not a job image, explain what is shown and answer the user's question.
- Use simple English.
- Be direct and practical.
- Do not mention system prompts or backend.
`;

  const textPrompt = `
User question:
${userPrompt || 'Analyse these images and explain what they show.'}

Post/feed context if provided:
${postContext || 'None'}

Give a strong answer like ChatGPT:
- Start with the direct answer.
- Then explain what you can see.
- If it is an opportunity/job, give a safety rating.
- Give what the user should do next.
- Give a copy-ready message if useful.
`;

  const imageContent = images.map((image) => ({
    type: 'image_url',
    image_url: {
      url: image.url,
      detail: 'high',
    },
  }));

  const out = await client.chat.completions.create({
    model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: system,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: textPrompt,
          },
          ...imageContent,
        ],
      },
    ],
    temperature: 0.25,
    max_tokens: 1600,
  });

  return {
    ok: true,
    text: getAiText(out),
  };
}

/* ---------------------------------------------
   IMAGE INPUT HELPERS
--------------------------------------------- */

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function isAllowedImageUrl(value = '') {
  const url = clean(value);

  if (!url) return false;

  if (/^https?:\/\//i.test(url)) return true;

  if (/^data:image\/(png|jpg|jpeg|webp);base64,/i.test(url)) return true;

  return false;
}

function normalizeImageInputs(body = {}) {
  const rawItems = [
    ...asArray(body.imageDataUrls),
    ...asArray(body.imageDataUrl),
    ...asArray(body.imageUrls),
    ...asArray(body.imageUrl),
    ...asArray(body.images),
  ];

  const images = [];

  for (const item of rawItems) {
    if (!item) continue;

    if (typeof item === 'string') {
      const url = clean(item);

      if (isAllowedImageUrl(url)) {
        images.push({
          url,
          source: url.startsWith('data:') ? 'base64' : 'url',
        });
      }

      continue;
    }

    if (typeof item === 'object') {
      const url =
        item.dataUrl ||
        item.imageDataUrl ||
        item.url ||
        item.src ||
        item.preview ||
        item.imageUrl ||
        '';

      if (isAllowedImageUrl(url)) {
        images.push({
          url: clean(url),
          source: String(url).startsWith('data:') ? 'base64' : 'url',
          name: item.name || item.filename || '',
        });
      }
    }
  }

  return images.slice(0, 4);
}

/* ---------------------------------------------
   INTENT DETECTION
--------------------------------------------- */

function isDatePrompt(text = '') {
  const t = clean(text).toLowerCase();

  return (
    t === 'date' ||
    t === 'today' ||
    t === 'what is today' ||
    t === 'what is today?' ||
    t === "what is today's date" ||
    t === "what is today's date?" ||
    /\b(today'?s date|today date|current date|date today|what date is it|what is the date|what's the date)\b/i.test(
      t
    )
  );
}

function isBusinessPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(start my own|start a business|my own business|business plan|logistics business|delivery business|courier business|transport business|make money|customers|pricing|profit|scale|marketing|business strategy|company growth|startup)\b/i.test(
    t
  );
}

function isCompanyVerificationPrompt(text = '') {
  const t = clean(text).toLowerCase();

  if (/\b(where can i start|start my own|business|logistics business)\b/i.test(t)) {
    return false;
  }

  return /\b(is .* hiring|are .* hiring|hiring\?|is this legit|is it legit|legit|scam|fake|real or fake|verify|safe|risky|should i apply|can i trust|company hiring|cartrack|car track|sasol|rcl foods|pedros|shoprite|pick n pay|westfalia|zz2)\b/i.test(
    t
  );
}

function isPostSafetyPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(this post|job post|screenshot|poster|advert|apply link|link in comments|comments below|dm me|inbox me|whatsapp only|pay|fee|registration fee|training fee|admin fee|processing fee|uniform fee)\b/i.test(
    t
  );
}

function isJobSearchPrompt(text = '') {
  const t = clean(text).toLowerCase();

  if (isBusinessPrompt(t)) return false;

  return /\b(job|jobs|work|hiring|vacancy|vacancies|career|careers|apply|application|learnership|internship|graduate|employment|opportunity|opportunities|looking for a job|looking for job|looking for work|find me a job|find jobs|available job|available jobs|job around|jobs around|job in|jobs in|work around|work in)\b/i.test(
    t
  );
}

function isMisusePrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(hack|steal|bypass|phishing|crack password|malware|spyware|scam people|fake document|forge document|illegal|harm someone|hide evidence)\b/i.test(
    t
  );
}

function detectWorkspaceIntent(text = '', hasImages = false, postContext = '') {
  const t = clean(text).toLowerCase();

  if (hasImages) return 'image-analysis';
  if (isDatePrompt(t)) return 'date';
  if (isMisusePrompt(t)) return 'unsafe';
  if (isCompanyVerificationPrompt(t)) return 'company-verification';
  if (isPostSafetyPrompt(t) || postContext) return 'post-safety';
  if (isBusinessPrompt(t)) return 'business-strategy';

  const wantsBothEmailAndWhatsapp =
    /(email|mail|send cv|send my cv|application email|cover letter)/i.test(t) &&
    /(whatsapp|message|dm|sms|text)/i.test(t);

  if (wantsBothEmailAndWhatsapp) return 'email-and-message';

  if (
    /(investor|investors|funding|funder|funders|grant|grants|venture|angel|vc|raise capital|capital|pitch|partnership|networking|accelerator|incubator)/i.test(
      t
    )
  ) {
    return 'investors-and-networking';
  }

  if (/(email|mail|cover letter|application email|send cv|send my cv|email cv)/i.test(t)) {
    return 'email-application';
  }

  if (/(whatsapp|message|dm|sms|text|apply message)/i.test(t)) {
    return 'message-application';
  }

  if (/(interview|tell me about yourself|questions|prepare|hiring manager)/i.test(t)) {
    return 'interview-prep';
  }

  if (/(cv|resume|profile|linkedin|headline|summary|ats)/i.test(t)) {
    return 'cv-profile';
  }

  if (isJobSearchPrompt(t)) return 'job-search';

  if (/(research|find out|company|market|industry|business idea|analyse|analyze)/i.test(t)) {
    return 'research';
  }

  return 'general';
}

/* ---------------------------------------------
   CONTEXT EXTRACTION
--------------------------------------------- */

function extractUserTextFromBody(body = {}) {
  if (!body || typeof body !== 'object') return '';

  const direct =
    body.message ||
    body.prompt ||
    body.question ||
    body.input ||
    body.text ||
    body.query ||
    '';

  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  if (Array.isArray(body.messages)) {
    const lastUserMessage = [...body.messages]
      .reverse()
      .find((msg) => msg?.role === 'user' && typeof msg?.content === 'string');

    if (lastUserMessage?.content) {
      return lastUserMessage.content.trim();
    }
  }

  return '';
}

function extractPostContextFromBody(body = {}) {
  if (!body || typeof body !== 'object') return '';

  const possible =
    body.postText ||
    body.postContent ||
    body.selectedPost ||
    body.linkedPost ||
    body.currentPost ||
    body.feedPost ||
    body.postContext ||
    body.contextPost ||
    '';

  if (typeof possible === 'string') {
    return possible.trim();
  }

  if (possible && typeof possible === 'object') {
    const parts = [
      possible.content,
      possible.text,
      possible.caption,
      possible.description,
      possible.title,
      possible.authorName,
      possible.userName,
      possible.company,
      possible.location,
      possible.link,
      possible.url,
      possible.createdAt,
    ]
      .filter(Boolean)
      .map((item) => String(item));

    return parts.join('\n').trim();
  }

  if (Array.isArray(body.feedContext)) {
    return body.feedContext
      .slice(0, 5)
      .map((post, index) => {
        if (typeof post === 'string') return `Post ${index + 1}: ${post}`;

        return `Post ${index + 1}:
Author: ${post?.authorName || post?.userName || 'Unknown'}
Content: ${post?.content || post?.text || post?.caption || ''}
Link: ${post?.link || post?.url || ''}
Date: ${post?.createdAt || ''}`;
      })
      .join('\n\n');
  }

  return '';
}

/* ---------------------------------------------
   JOB / LINK HELPERS
--------------------------------------------- */

function extractLocation(text = '') {
  const t = clean(text).toLowerCase();

  const locations = [
    'tzaneen',
    'limpopo',
    'polokwane',
    'lenyenye',
    'nkowankowa',
    'maake plaza',
    'maake',
    'giyani',
    'phalaborwa',
    'modjadjiskloof',
    'mankweng',
    'mokopane',
    'thohoyandou',
    'burgersdorp',
    'hoedspruit',
    'secunda',
    'gauteng',
    'johannesburg',
    'pretoria',
    'durban',
    'cape town',
    'south africa',
  ];

  const found = locations.find((loc) => t.includes(loc));

  if (!found) return 'South Africa';

  return found
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractJobType(text = '') {
  const t = clean(text).toLowerCase();

  const jobTypes = [
    'inspector in training',
    'general worker',
    'cleaner',
    'admin clerk',
    'admin',
    'administrative',
    'clerk',
    'driver',
    'cashier',
    'security',
    'retail',
    'sales',
    'waiter',
    'waitress',
    'receptionist',
    'call centre',
    'data entry',
    'learnership',
    'internship',
    'graduate',
    'warehouse',
    'store assistant',
    'teacher assistant',
    'nurse',
    'clinic',
    'municipality',
    'government',
    'restaurant',
    'griller',
    'packer',
    'merchandiser',
  ];

  const found = jobTypes.find((job) => t.includes(job));
  return found || 'jobs';
}

function makeSearchUrl(base, params) {
  const url = new URL(base);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function buildClickableJobLinks(userText = '') {
  const location = extractLocation(userText);
  const jobType = extractJobType(userText);
  const query = `${jobType} ${location}`;

  return [
    {
      name: 'Indeed',
      label: `Indeed ${location} jobs`,
      url: makeSearchUrl('https://za.indeed.com/jobs', {
        q: query,
        l: location,
      }),
      note: 'Good for general workers, admin, retail, cleaning, drivers, restaurants, and entry-level jobs.',
    },
    {
      name: 'LinkedIn',
      label: `LinkedIn ${location} jobs`,
      url: makeSearchUrl('https://www.linkedin.com/jobs/search/', {
        keywords: query,
        location,
      }),
      note: 'Good for company-posted jobs, admin, office, sales, professional and retail roles.',
    },
    {
      name: 'PNet',
      label: 'PNet South Africa jobs',
      url: 'https://www.pnet.co.za/jobs',
      note: 'Search your job title and location inside the site.',
    },
    {
      name: 'Careers24',
      label: 'Careers24 jobs',
      url: 'https://www.careers24.com/jobs/',
      note: 'Useful for South African vacancies across many industries.',
    },
    {
      name: 'CareerJunction',
      label: 'CareerJunction jobs',
      url: 'https://www.careerjunction.co.za/jobs',
      note: 'Good for admin, sales, finance, office, IT, and skilled roles.',
    },
    {
      name: 'DPSA',
      label: 'DPSA government vacancies',
      url: 'https://www.dpsa.gov.za/newsroom/psvc/',
      note: 'Official South African government vacancy circulars.',
    },
    {
      name: 'SAYouth',
      label: 'SAYouth opportunities',
      url: 'https://sayouth.mobi/',
      note: 'Good for youth opportunities, learning programmes, entry-level work, and support.',
    },
    {
      name: 'ESSA',
      label: 'ESSA Department of Employment and Labour',
      url: 'https://essa.labour.gov.za/EssaOnline/WebBeans/',
      note: 'Official employment services platform from the Department of Employment and Labour.',
    },
  ];
}

function buildCompanySearchLinks(userText = '') {
  const location = extractLocation(userText);
  const cleaned = clean(userText)
    .replace(/\?/g, '')
    .replace(/\bis\b/gi, '')
    .replace(/\bare\b/gi, '')
    .replace(/\bhiring\b/gi, '')
    .replace(/\bvacancy\b/gi, '')
    .replace(/\bvacancies\b/gi, '')
    .replace(/\bjobs\b/gi, '')
    .replace(/\bjob\b/gi, '')
    .replace(/\bin\b/gi, '')
    .replace(/\baround\b/gi, '')
    .replace(new RegExp(location, 'gi'), '')
    .trim();

  const company = cleaned || 'the company';

  return [
    {
      name: 'Official careers search',
      label: `${company} official careers`,
      url: makeSearchUrl('https://www.google.com/search', {
        q: `${company} official careers ${location}`,
      }),
      note: 'Use this to find the real company careers page.',
    },
    {
      name: 'Company LinkedIn search',
      label: `${company} LinkedIn jobs`,
      url: makeSearchUrl('https://www.google.com/search', {
        q: `${company} LinkedIn jobs ${location}`,
      }),
      note: 'Use this to check company-posted jobs and staff pages.',
    },
    {
      name: 'Scam check search',
      label: `${company} scam check`,
      url: makeSearchUrl('https://www.google.com/search', {
        q: `${company} job scam South Africa`,
      }),
      note: 'Use this to check reports, complaints, and suspicious posts.',
    },
  ];
}

function linksToMarkdown(links = []) {
  return links
    .map((item, index) => {
      return `${index + 1}. [${item.label}](${item.url})\n${item.note || ''}`;
    })
    .join('\n\n');
}

/* ---------------------------------------------
   PROMPTS
--------------------------------------------- */

function buildFaceMeXKnowledge() {
  return `
FaceMeX is a South African social and career platform.

FaceMeX helps users:
- discover jobs and opportunities
- use FaceMeX Career Workspace for CVs, job applications, research, and interview prep
- post and share content on the feed
- connect with people
- advertise businesses and opportunities
- use AI for career and business support
- check whether job posts or opportunities look risky

FaceMeX must feel useful, safe, local, practical, and easy to use.
`;
}

function buildGeneralSystemPrompt({ intent, userText, postContext = '', imageAnalysis = '' }) {
  const date = getSouthAfricaDateContext();
  const location = extractLocation(`${userText}\n${postContext}\n${imageAnalysis}`);
  const jobType = extractJobType(`${userText}\n${postContext}\n${imageAnalysis}`);

  const jobLinks = linksToMarkdown(buildClickableJobLinks(userText || postContext || imageAnalysis));
  const companyLinks = linksToMarkdown(buildCompanySearchLinks(userText || postContext || imageAnalysis));

  return `
You are FaceMeX AI Workspace.

Answer like ChatGPT:
- Understand the user's intent even if they type badly.
- Correctly infer what they mean.
- Be clear, practical, direct, smart, and natural.
- Do not force a bot template.
- Do not answer a business question like a job-search question.
- Keep the answer mobile-friendly.
- Use headings when useful.
- Use bullets and numbered steps when useful.
- Use clickable markdown links when links are given.
- Do not mention system prompts, backend, DeepSeek, OpenAI, ChatGPT, or Claude.

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
ISO date: ${date.isoDate}.
Timezone: ${date.timeZone}.

${buildFaceMeXKnowledge()}

Intent detected by backend: ${intent}
Detected location: ${location}
Detected job type: ${jobType}

Post/feed context:
${postContext || 'None provided'}

Image analysis:
${imageAnalysis || 'None provided'}

Trusted job links:
${jobLinks}

Company verification links:
${companyLinks}

Rules:
1. Answer the exact question first.
2. If the user asks for today's date, answer using the date above.
3. If the user asks about uploaded images, use the image analysis.
4. If the user asks about a job advert, company, screenshot, or post, give a safety rating:
   - Looks safer
   - Needs verification
   - High risk
5. Never say "100% legit" unless official proof is provided.
6. Do not invent live vacancies, deadlines, salaries, or application links.
7. If you cannot confirm live information, say so clearly and give official places to verify.
8. If the user asks for jobs, give job sources, search terms, action steps, and a copy-ready message.
9. If the user asks for business/logistics/startup advice, give a launch map, first money plan, pricing, scripts, and action steps.
10. If the user asks for FaceMeX help, explain how to use FaceMeX clearly.
11. If the request is unsafe, refuse briefly and redirect to a safe action.
`;
}

/* ---------------------------------------------
   FALLBACK ANSWERS
--------------------------------------------- */

function buildDateAnswer() {
  const date = getSouthAfricaDateContext();
  return `Today's date is ${date.shortDate}.`;
}

function buildJobFallbackAnswer(userText = '') {
  const date = getSouthAfricaDateContext();
  const location = extractLocation(userText);
  const jobType = extractJobType(userText);
  const links = linksToMarkdown(buildClickableJobLinks(userText));

  return `Start with places where ${location} jobs are most likely to appear fast.

Today’s date is ${date.shortDate}.

## 1. Online job sites — check every morning

Use these first because companies post there often:

${links}

## 2. Search these words

Use these exact searches:

- "${jobType} ${location}"
- "general worker ${location}"
- "admin clerk ${location}"
- "cleaner ${location}"
- "driver jobs ${location}"
- "retail jobs ${location}"
- "learnership ${location}"

## 3. Apply directly to local employers

Check shops, malls, fast food places, farms, packhouses, car dealerships, pharmacies, clinics, and local businesses around ${location}.

## Simple message to send

Good day, my name is [Your Name]. I am looking for employment in ${location}. I am hardworking, reliable, willing to learn, and available immediately. Please may I ask if you are hiring or accepting CVs?

## Important warning

Do not pay anyone for a job application. Real companies do not ask for application fees, training fees, or money to secure an interview.`;
}

function buildBusinessFallbackAnswer(userText = '') {
  const location = extractLocation(userText);

  return `Start your business where customers already move every day, not where rent is cheap.

## Best place to start in ${location}

Start with the busiest pickup and delivery zones:

1. ${location} CBD
2. Shopping centres
3. Fast food outlets
4. Pharmacies and clinics
5. Laundry shops
6. Phone repair shops
7. Spaza shops
8. Offices and small businesses

## Simplest version that can make money today

Do not start with trucks. Start with small logistics:

Service offer:
“We collect and deliver food, parcels, groceries, documents, and business orders around ${location}.”

Start with these 5 services:

1. Food collection from restaurants
2. Parcel delivery from shops to customers
3. CV/document drop-off
4. Grocery pickup
5. Pharmacy/clinic errands

## Simple pricing formula

Base price = fuel + driver time + company profit

Easy starting prices:

- 0–2 km: R30–R40
- 3–5 km: R50–R70
- 6–10 km: R80–R120
- Urgent order: add R30–R50
- Waiting longer than 10 minutes: add R30

## Customer message

Good day. I run a local delivery service around ${location}. We collect and deliver food, parcels, groceries, documents, and business orders. Same-day delivery is available. Can I send you our price list?

## Tomorrow morning action plan

1. Make a WhatsApp poster.
2. Visit 10 shops.
3. Visit 5 fast food places.
4. Visit 3 pharmacies.
5. Ask every business if they need collections or deliveries.
6. Post in local Facebook and WhatsApp groups.
7. Track every customer in a simple notebook or Google Sheet.

Do not wait for everything to be perfect. Start small, collect cash flow, then build systems.`;
}

function buildCompanyVerificationFallback(userText = '') {
  const companyLinks = linksToMarkdown(buildCompanySearchLinks(userText));

  return `I can help you verify this, but I cannot confirm a live vacancy unless the official company page or post details are provided.

## What to do first

Check the company through official sources, not only WhatsApp, Facebook screenshots, or reposts.

${companyLinks}

## Safety rating

Needs verification.

It becomes safer if:
- the job appears on the official company careers page
- the email uses the company domain
- the application link goes to the official company website
- no one asks for money

It becomes high risk if:
- they ask for payment
- they use Gmail/WhatsApp only
- they hide the apply link
- they say “link in comments”
- they rush you
- they ask for ID/bank details too early

## Message to send

Good day. I saw a vacancy/post linked to your company. Please may you confirm if this opportunity is official and where I can apply through the correct company channel?

## Important

Never pay for a job application.`;
}

function buildImageNoConfigAnswer() {
  return `I received the image, but FaceMeX backend cannot truly analyse images yet because the vision API key is not configured.

## Fix this

Add this to your backend .env:

OPENAI_API_KEY=your_openai_key_here
OPENAI_VISION_MODEL=gpt-4o-mini

Then redeploy your backend.

## Also update server.js

Make sure your backend can receive image data:

app.use(express.json({ limit: '30mb' }));

After that, FaceMeX Workspace will be able to read job posters, screenshots, adverts, documents, and images.`;
}

function buildUnsafeAnswer() {
  return `I can’t help with that request.

I can help you do it safely instead — for example, checking whether a job post is real, protecting your account, reporting a scam, or writing a proper message to a company.`;
}

/* ---------------------------------------------
   CV TEMPLATE HELPERS
--------------------------------------------- */

function titleCaseWords(text = '') {
  return clean(text)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function splitList(value = '') {
  return clean(value)
    .split(/[,;\n/]+/)
    .map((item) => clean(item))
    .filter(Boolean)
    .slice(0, 8);
}

function professionalizeSummary(summary = '') {
  const raw = clean(summary);

  if (!raw) {
    return 'Reliable and motivated candidate with strong communication, teamwork, and customer service skills. Able to work under pressure, follow instructions, and complete tasks on time. Eager to contribute positively in a professional environment and grow through practical experience.';
  }

  const lower = raw.toLowerCase();

  if (lower.includes('media') || lower.includes('team management')) {
    return 'Motivated and detail-oriented professional with experience in media management, team coordination, customer service, and communication. Skilled at supporting daily operations, organising tasks, working with people, and contributing to a productive team environment.';
  }

  if (lower.includes('driver') || lower.includes('code 10') || lower.includes('code 14')) {
    return 'Reliable and safety-conscious driver with strong route awareness, time management, and customer service skills. Able to follow instructions, handle responsibilities professionally, and complete deliveries or transport duties on time.';
  }

  return raw
    .replace(/\bi\b/g, 'I')
    .replace(/\bteam management\b/gi, 'team coordination')
    .replace(/\benglish fluently\b/gi, 'English: Fluent')
    .replace(/\bsepedi mothers? tangue\b/gi, 'Sepedi: Mother tongue')
    .replace(/\bsepedi mothers? tongue\b/gi, 'Sepedi: Mother tongue')
    .replace(/\bcode 10 drive\b/gi, 'Driver’s licence: Code 10')
    .replace(/\bcode 14 drive\b/gi, 'Driver’s licence: Code 14');
}

function professionalizeSkills(skills = '') {
  const items = splitList(skills);

  if (!items.length) {
    return [
      'Customer service and support',
      'Team collaboration and communication',
      'Time management and organisation',
      'Problem solving',
      'Computer literacy',
      'Workplace discipline',
    ];
  }

  return items.map((item) => {
    const lower = item.toLowerCase();

    if (lower.includes('team management')) return 'Team coordination and leadership';
    if (lower.includes('customer')) return 'Customer service and support';
    if (lower.includes('social media')) return 'Social media management';
    if (lower.includes('media')) return 'Media management';
    if (lower.includes('inventory')) return 'Inventory control';
    if (lower.includes('stock')) return 'Stock management';
    if (lower.includes('code 10')) return 'Driver’s licence: Code 10';
    if (lower.includes('code 14')) return 'Driver’s licence: Code 14';
    if (lower.includes('english')) return 'English communication';
    if (lower.includes('sepedi')) return 'Sepedi communication';

    return titleCaseWords(item);
  });
}

function professionalizeExtras(extras = '') {
  const raw = clean(extras);

  const technicalSkills = [];
  const languages = [];

  if (!raw) {
    return {
      technicalSkills: ['MS Office', 'Basic computer literacy', 'Email communication'],
      languages: ['English: Fluent', 'Sepedi: Mother tongue'],
    };
  }

  const lower = raw.toLowerCase();

  if (lower.includes('english')) languages.push('English: Fluent');
  if (lower.includes('sepedi')) languages.push('Sepedi: Mother tongue');
  if (lower.includes('zulu')) languages.push('Zulu: Conversational');
  if (lower.includes('xitsonga') || lower.includes('tsonga')) languages.push('itsonga: Conversational');

  if (lower.includes('computer')) technicalSkills.push('Basic computer literacy');
  if (lower.includes('ms office') || lower.includes('word') || lower.includes('excel')) technicalSkills.push('MS Office');
  if (lower.includes('social media')) technicalSkills.push('Social media management');
  if (lower.includes('email')) technicalSkills.push('Email communication');

  const licenceMatches = raw.match(/code\s*\d+/gi) || [];
  for (const match of licenceMatches) {
    technicalSkills.push(`Driver’s licence: ${match.replace(/\s+/g, ' ').toUpperCase()}`);
  }

  if (!technicalSkills.length) {
    technicalSkills.push('Basic computer literacy');
  }

  if (!languages.length) {
    languages.push('English: Fluent');
  }

  return {
    technicalSkills: [...new Set(technicalSkills)].slice(0, 5),
    languages: [...new Set(languages)].slice(0, 4),
  };
}

function professionalizeExperience(experience = '') {
  const raw = clean(experience);

  if (!raw) {
    return `[Job Title] | [Company Name] | [Year]
- Supported daily workplace tasks and followed instructions from supervisors.
- Assisted customers, team members, or management in a professional manner.
- Completed assigned duties on time and maintained a reliable work ethic.`;
  }

  const lower = raw.toLowerCase();

  if (lower.includes('ceo') && lower.includes('facemex')) {
    return `CEO / Founder | FaceMeX | 2025 – Present
- Built and managed a digital platform focused on social networking, career tools, and business opportunities.
- Collected user feedback to improve features, mobile layout, and AI-powered tools.
- Managed product testing, content planning, user support, and platform improvements.`;
  }

  if (lower.includes('driver') || lower.includes('truck')) {
    return `Driver | [Company Name] | [Year]
- Transported goods or passengers safely while following road and company rules.
- Planned routes, managed time effectively, and completed trips or deliveries on schedule.
- Communicated professionally with customers, team members, and supervisors.`;
  }

  if (!raw.includes('-')) {
    return `${raw}
- Supported daily tasks and contributed to smooth operations.
- Communicated professionally with customers, colleagues, or supervisors.
- Completed duties on time and showed reliability in the workplace.`;
  }

  return raw;
}

function professionalizeEducation(education = '') {
  const raw = clean(education);

  if (!raw) {
    return '[School / College / Institution] | [Qualification] | [Year]';
  }

  return raw
    .replace(/\bTVT\b/gi, 'TVET')
    .replace(/\btvt\b/gi, 'TVET')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildClassicA4CvTemplate({
  fullName = '',
  email = '',
  phone = '',
  location = '',
  idNumber = '',
  showIdOnCv = false,
  summary = '',
  experience = '',
  skills = '',
  education = '',
  extras = '',
}) {
  const name = clean(fullName) || '[YOUR NAME]';
  const cleanEmail = clean(email) || 'your.email@example.com';
  const cleanPhone = clean(phone) || '+27 00 000 0000';
  const cleanLocation = clean(location) || 'Your City, South Africa';

  const finalSummary = professionalizeSummary(summary);
  const finalSkills = professionalizeSkills(skills);
  const finalExperience = professionalizeExperience(experience);
  const finalEducation = professionalizeEducation(education);
  const extraData = professionalizeExtras(extras);

  const profileLine =
    showIdOnCv && clean(idNumber)
      ? `Address: ${cleanLocation} | Contact: ${cleanPhone} | Email: ${cleanEmail} | Profile ID: ${clean(idNumber)}`
      : `Address: ${cleanLocation} | Contact: ${cleanPhone} | Email: ${cleanEmail}`;

  return `${name.toUpperCase()}
${profileLine}

PROFESSIONAL SUMMARY
${finalSummary}

CORE COMPETENCIES
${finalSkills.map((item) => `- ${item}`).join('\n')}

PROFESSIONAL EXPERIENCE
${finalExperience}

EDUCATION
${finalEducation}

TECHNICAL SKILLS
${extraData.technicalSkills.map((item) => `- ${item}`).join('\n')}

LANGUAGES
${extraData.languages.map((item) => `- ${item}`).join('\n')}

REFERENCES
Available Upon Request`;
}

/* ---------------------------------------------
   IMAGE CAPTION HELPERS
--------------------------------------------- */

async function fetchAsBase64(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch media: ${res.status}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);

  if (!match) return null;

  return {
    mime: match[1],
    base64: match[2],
  };
}

async function captionImageWithHF({ imageUrl, imageDataUrl }) {
  const apiKey = process.env.HF_API_KEY;

  if (!apiKey) {
    throw new Error('HF_API_KEY missing');
  }

  const model = process.env.HF_IMAGE_CAPTION_MODEL || 'Salesforce/blip-image-captioning-large';

  let base64 = '';
  let mime = 'image/jpeg';

  if (imageDataUrl) {
    const parsed = parseDataUrl(imageDataUrl);

    if (!parsed) {
      throw new Error('Invalid imageDataUrl');
    }

    base64 = parsed.base64;
    mime = parsed.mime || mime;
  } else if (imageUrl) {
    base64 = await fetchAsBase64(imageUrl);
  } else {
    throw new Error('No image provided');
  }

  const resp = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {
        image: `data:${mime};base64,${base64}`,
      },
    }),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    throw new Error(data?.error || `HF error ${resp.status}`);
  }

  const caption = Array.isArray(data)
    ? data?.[0]?.generated_text || data?.[0]?.caption || ''
    : data?.generated_text || data?.caption || '';

  return clean(caption);
}

/* ---------------------------------------------
   WORKSPACE HANDLER
--------------------------------------------- */

async function handleCareerWorkspace(req, res) {
  try {
    const {
      prompt = '',
      role = '',
      location = '',
      preferences = '',
      experienceLevel = '',
      industry = '',
      workMode = '',
      company = '',
      contactPerson = '',
      tier = 'free',
      creatorPlus,
    } = req.body || {};

    const userPrompt = normalizeUserPromptText(
      prompt ||
        req.body?.message ||
        req.body?.question ||
        req.body?.input ||
        req.body?.text ||
        ''
    );

    const postContext = extractPostContextFromBody(req.body);
    const images = normalizeImageInputs(req.body);
    const hasImages = images.length > 0;
    const intent = detectWorkspaceIntent(userPrompt, hasImages, postContext);
    const date = getSouthAfricaDateContext();

    if (!userPrompt && !hasImages && !postContext) {
      return res.status(400).json({
        ok: false,
        answer: 'Please type what you need help with or upload an image.',
      });
    }

    if (intent === 'unsafe') {
      const answer = buildUnsafeAnswer();

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        source: 'safe-refusal',
      });
    }

    if (intent === 'date') {
      const answer = buildDateAnswer();

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        source: 'date-direct',
      });
    }

    let imageAnalysis = '';

    if (hasImages) {
      const vision = await callVisionChat({
        userPrompt,
        images,
        postContext,
      });

      if (!vision.ok) {
        const answer = vision.text || buildImageNoConfigAnswer();

        return res.json({
          ok: true,
          answer,
          reply: answer,
          response: answer,
          text: answer,
          content: answer,
          intent: 'image-analysis',
          dateContext: date,
          imageCount: images.length,
          source: 'vision-not-configured',
        });
      }

      imageAnalysis = vision.text;
    }

    const canUseAi = true;

    let fallbackAnswer = '';

    if (intent === 'job-search') {
      fallbackAnswer = buildJobFallbackAnswer(userPrompt);
    } else if (intent === 'business-strategy') {
      fallbackAnswer = buildBusinessFallbackAnswer(userPrompt);
    } else if (intent === 'company-verification' || intent === 'post-safety') {
      fallbackAnswer = buildCompanyVerificationFallback(userPrompt || postContext);
    } else if (intent === 'image-analysis') {
      fallbackAnswer = imageAnalysis || buildImageNoConfigAnswer();
    } else {
      fallbackAnswer = `I understand what you mean.

Please give me one more detail so I can answer properly:
- What result do you want?
- Which location?
- Is this about a job, business, CV, image, post, or company?

Then I’ll give you a direct answer and next steps.`;
    }

    if (!canUseAi) {
      return res.json({
        ok: true,
        answer: fallbackAnswer,
        reply: fallbackAnswer,
        response: fallbackAnswer,
        text: fallbackAnswer,
        content: fallbackAnswer,
        intent,
        dateContext: date,
        links: buildClickableJobLinks(userPrompt || postContext || imageAnalysis),
        source: 'fallback',
      });
    }

    try {
      const out = await callDeepseekChat({
        messages: [
          {
            role: 'system',
            content: buildGeneralSystemPrompt({
              intent,
              userText: userPrompt,
              postContext,
              imageAnalysis,
            }),
          },
          {
            role: 'user',
            content: `
User request:
${userPrompt || 'The user uploaded images and needs help.'}

Optional fields:
Role: ${role || 'Not provided'}
Location: ${location || 'Not provided'}
Industry: ${industry || 'Not provided'}
Work mode: ${workMode || 'Not provided'}
Experience level: ${experienceLevel || 'Not provided'}
Company: ${company || 'Not provided'}
Contact person: ${contactPerson || 'Not provided'}
Preferences: ${preferences || 'Not provided'}

Post context:
${postContext || 'None'}

Image analysis:
${imageAnalysis || 'None'}

Now answer the user according to their real intent.
`,
          },
        ],
        temperature: 0.35,
        max_tokens: 1800,
      });

      const answer = stripMarkdownSymbols(getAiText(out)) || fallbackAnswer;

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        imageAnalysis,
        imageCount: images.length,
        links:
          intent === 'company-verification' || intent === 'post-safety'
            ? buildCompanySearchLinks(userPrompt || postContext || imageAnalysis)
            : buildClickableJobLinks(userPrompt || postContext || imageAnalysis),
        source: imageAnalysis ? 'vision-plus-deepseek' : 'deepseek',
      });
    } catch (e) {
      console.error('workspace deepseek error', e);

      const answer = imageAnalysis || fallbackAnswer;

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        imageAnalysis,
        imageCount: images.length,
        links:
          intent === 'company-verification' || intent === 'post-safety'
            ? buildCompanySearchLinks(userPrompt || postContext || imageAnalysis)
            : buildClickableJobLinks(userPrompt || postContext || imageAnalysis),
        source: imageAnalysis ? 'vision-fallback' : 'fallback',
      });
    }
  } catch (err) {
    console.error('workspace error', err);

    const answer =
      'FaceMeX AI is temporarily unavailable. Please try again shortly.';

    return res.json({
      ok: true,
      answer,
      reply: answer,
      response: answer,
      text: answer,
      content: answer,
      source: 'error-fallback',
    });
  }
}

/* ---------------------------------------------
   POST FROM MEDIA
--------------------------------------------- */

router.post('/post-from-media', async (req, res) => {
  try {
    const {
      text = '',
      postMode = 'social',
      tone = 'auto',
      imageUrl = '',
      imageDataUrl = '',
    } = req.body || {};

    const hasImage = Boolean(clean(imageUrl) || clean(imageDataUrl));

    if (!hasImage && !clean(text)) {
      return res.status(400).json({
        ok: false,
        error: 'Provide text and/or imageUrl/imageDataUrl',
      });
    }

    let caption = '';
    let captionSource = 'none';

    if (hasImage) {
      try {
        caption = await captionImageWithHF({ imageUrl, imageDataUrl });
        captionSource = 'huggingface';
      } catch (e) {
        console.error('captioning failed', e);
        caption = '';
        captionSource = 'failed';
      }
    }

    const mode = postMode === 'professional' ? 'professional' : 'social';
    const cleanedText = clean(text);

    const system = `You are FaceMeX AI, a world-class social media writer.

Write ONE post for FaceMeX.

Rules:
- Match the media description when provided.
- Do not invent facts not supported by the media or text.
- If mode is professional, write polished and business-appropriate.
- If mode is social, write casual and engaging.
- Include 2 to 4 relevant hashtags only if natural.
- Keep it concise.
- Output plain text only.`;

    const user = `MODE: ${mode}
TONE: ${tone}

MEDIA_DESCRIPTION:
${caption || '[none]'}

USER_CONTEXT:
${cleanedText || '[none]'}

Generate the post now.`;

    const out = await callDeepseekChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.85,
      max_tokens: 180,
    });

    return res.json({
      ok: true,
      post: getAiText(out),
      caption,
      captionSource,
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('post-from-media error', err);

    return res.status(500).json({
      ok: false,
      error: err.message || 'post-from-media failed',
    });
  }
});

/* ---------------------------------------------
   AI COMMENT
--------------------------------------------- */

router.post('/comment', async (req, res) => {
  try {
    const {
      postText = '',
      author = '',
      tone = 'friendly',
      length = 'short',
      language = 'auto',
    } = req.body || {};

    const cleanedPost = clean(postText);

    if (!cleanedPost) {
      return res.status(400).json({
        ok: false,
        error: 'postText is required',
      });
    }

    const maxWords = String(length).toLowerCase() === 'long' ? 45 : 20;
    const authorHint = clean(author);
    const langHint = clean(language) || 'auto';

    const system = `You are FaceMeX AI. Write a high-quality social media comment that directly matches the post content.

Rules:
- Be natural, human, and non-cringe.
- Do not repeat the post verbatim.
- Do not invent facts.
- Keep it ${tone} and supportive.
- Max ${maxWords} words.
- No hashtags unless the post uses hashtags.
- If the post is a question, answer briefly and ask one follow-up question.
- Language: ${langHint === 'auto' ? 'match the language of the post' : langHint}.
- Return only the comment text.`;

    const user = `POST${authorHint ? ` by ${authorHint}` : ''}:
${cleanedPost}`;

    const out = await callDeepseekChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.8,
      max_tokens: 120,
    });

    return res.json({
      ok: true,
      comment: getAiText(out),
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('ai comment error', err);

    return res.status(500).json({
      ok: false,
      error: err.message || 'AI comment failed',
    });
  }
});

/* ---------------------------------------------
   TEST ROUTES
--------------------------------------------- */

router.get('/test', async (_req, res) => {
  try {
    const out = await callDeepseekChat({
      messages: [
        {
          role: 'user',
          content: 'Say: FaceMeX AI is connected.',
        },
      ],
      max_tokens: 80,
    });

    return res.json({
      success: true,
      response: getAiText(out),
      source: 'deepseek-api',
    });
  } catch (err) {
    return res.json({
      success: false,
      error: err.message,
    });
  }
});

router.get('/runtime-context', (req, res) => {
  const query = clean(req.query.q || 'jobs South Africa');

  return res.json({
    ok: true,
    dateContext: getSouthAfricaDateContext(),
    detectedLocation: extractLocation(query),
    detectedJobType: extractJobType(query),
    links: buildClickableJobLinks(query),
    visionConfigured: Boolean(process.env.OPENAI_VISION_API_KEY || process.env.OPENAI_API_KEY),
  });
});

router.get('/job-search-links', (req, res) => {
  const query = clean(req.query.q || 'jobs South Africa');

  return res.json({
    ok: true,
    query,
    detectedLocation: extractLocation(query),
    detectedJobType: extractJobType(query),
    dateContext: getSouthAfricaDateContext(),
    links: buildClickableJobLinks(query),
  });
});

/* ---------------------------------------------
   REPLY
--------------------------------------------- */

router.post('/reply', async (req, res) => {
  try {
    const { message = '', style = '' } = req.body || {};
    const cleanedMessage = normalizeUserPromptText(message);
    const date = getSouthAfricaDateContext();

    if (isDatePrompt(cleanedMessage)) {
      return res.json({
        success: true,
        response: buildDateAnswer(),
        source: 'date-direct',
      });
    }

    const intent = detectWorkspaceIntent(cleanedMessage, false, '');

    const prompt = `You are a helpful FaceMeX assistant.

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
Timezone: ${date.timeZone}.

Style: ${style || 'clear and friendly'}
Intent: ${intent}

Reply naturally to:
${cleanedMessage}`;

    try {
      const out = await callLlamaChat({
        messages: [{ role: 'user', content: prompt }],
      });

      const response = getAiText(out);

      if (response) {
        return res.json({
          success: true,
          response,
          source: 'llama-api',
        });
      }
    } catch (e) {
      console.error('reply llama error', e);
    }

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content: buildGeneralSystemPrompt({
            intent,
            userText: cleanedMessage,
          }),
        },
        {
          role: 'user',
          content: cleanedMessage,
        },
      ],
    });

    return res.json({
      success: true,
      response: getAiText(out),
      source: 'deepseek-api',
    });
  } catch (err) {
    return res.json({
      success: false,
      error: err.message,
    });
  }
});

/* ---------------------------------------------
   DIRECT DEEPSEEK
--------------------------------------------- */

router.post('/deepseek', async (req, res) => {
  try {
    const { prompt = '' } = req.body || {};
    const cleaned = normalizeUserPromptText(prompt);

    if (!cleaned) {
      return res.status(400).json({
        ok: false,
        error: 'Missing prompt',
      });
    }

    if (isDatePrompt(cleaned)) {
      return res.json({
        ok: true,
        text: buildDateAnswer(),
        source: 'date-direct',
      });
    }

    const intent = detectWorkspaceIntent(cleaned, false, '');

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content: buildGeneralSystemPrompt({
            intent,
            userText: cleaned,
          }),
        },
        {
          role: 'user',
          content: cleaned,
        },
      ],
    });

    return res.json({
      ok: true,
      text: getAiText(out),
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('DeepSeek handler error', err);

    return res.status(500).json({
      ok: false,
      error: err.message || 'DeepSeek failed',
    });
  }
});

/* ---------------------------------------------
   DEV TOOLS
--------------------------------------------- */

router.post('/dev/post-enhancer', async (req, res) => {
  try {
    const { text = '' } = req.body || {};

    const prompt = `Rewrite this post to be clearer and more engaging while keeping the same core message and tone.

Requirements:
- Keep it short and scannable.
- Make the first line a strong hook.
- Add 2 to 4 relevant hashtags only if natural.
- Return plain text only.

Post:
${clean(text) || 'Write a short, friendly post for my FaceMeX audience.'}`;

    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 250,
    });

    return res.json({
      ok: true,
      result: getAiText(out),
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('post-enhancer error', err);

    return res.status(500).json({
      ok: false,
      error: 'Post enhancer failed',
    });
  }
});

router.post('/dev/caption-muse', async (req, res) => {
  try {
    const { topic = '' } = req.body || {};

    const prompt = `Generate 3 short, scroll-stopping social captions for:
${clean(topic) || 'a moment on FaceMeX'}

Requirements:
- Max 1 to 2 short sentences per caption.
- Make them natural, not like ads.
- Add 1 to 3 relevant hashtags only if natural.
- Return one caption per line.
- No numbering.
- No JSON.`;

    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
      max_tokens: 200,
    });

    const captions = getAiText(out)
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 3);

    return res.json({
      ok: true,
      suggestions: captions,
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('caption-muse error', err);

    return res.status(500).json({
      ok: false,
      error: 'Caption Muse failed',
    });
  }
});

router.post('/dev/trend-finder', async (req, res) => {
  try {
    const { niche = 'general' } = req.body || {};

    const prompt = `For the niche: "${clean(niche) || 'general'}"

Give 5 trending hashtags with an estimated popularity score from 0 to 100.

Format:
#hashtag - score

Return plain text only.`;

    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    });

    const trends = getAiText(out)
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\d+[).\s]*/, ''))
      .map((line) => {
        const match = line.match(/(#\S+)\s*[-–]\s*(\d+)/);
        if (!match) return null;

        return {
          tag: match[1],
          score: Number(match[2]),
        };
      })
      .filter(Boolean)
      .slice(0, 5);

    return res.json({
      ok: true,
      niche,
      trends,
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('trend-finder error', err);

    return res.status(500).json({
      ok: false,
      error: 'Trend Finder failed',
    });
  }
});

router.post('/dev/assistant', async (req, res) => {
  try {
    const {
      goal = 'grow audience',
      audience = 'general',
      topic = 'content',
    } = req.body || {};

    const prompt = `User goal: ${goal}
Audience: ${audience}
Topic: ${topic}

Give 3 short coaching tips and 3 concrete content ideas.

Format:
Tips:
- tip
- tip
- tip

Ideas:
- idea
- idea
- idea

Return plain text only.`;

    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75,
      max_tokens: 300,
    });

    return res.json({
      ok: true,
      result: getAiText(out),
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('Assistant error', err);

    return res.status(500).json({
      ok: false,
      error: 'Assistant failed',
    });
  }
});

/* ---------------------------------------------
   CV BUILDER
--------------------------------------------- */

router.post('/pro/resume-builder', async (req, res) => {
  try {
    const {
      fullName = '',
      email = '',
      phone = '',
      location = '',
      idNumber = '',
      showIdOnCv = false,
      summary = '',
      experience = '',
      skills = '',
      education = '',
      extras = '',
    } = req.body || {};

    const safeShowIdOnCv = toBoolean(showIdOnCv);

    const fallbackCv = buildClassicA4CvTemplate({
      fullName,
      email,
      phone,
      location,
      idNumber,
      showIdOnCv: safeShowIdOnCv,
      summary,
      experience,
      skills,
      education,
      extras,
    });

    const prompt = `Create a clean one-page A4 CV using this exact classic ATS template style:

FULL NAME IN CAPITAL LETTERS
Address: [Location] | Contact: [Phone] | Email: [Email]

PROFESSIONAL SUMMARY
Short professional paragraph.

CORE COMPETENCIES
- Skill
- Skill
- Skill
- Skill
- Skill

PROFESSIONAL EXPERIENCE
Job Title | Company | Year
- Responsibility or achievement
- Responsibility or achievement
- Responsibility or achievement

EDUCATION
Qualification | Institution | Year

TECHNICAL SKILLS
- Skill
- Skill
- Skill

LANGUAGES
- Language: Level
- Language: Level

REFERENCES
Available Upon Request

Rules:
- One A4 page only.
- Plain text only.
- No markdown.
- No tables.
- Rewrite weak input professionally.
- Do not invent fake degrees, companies, licences, or job titles.
- Do not include sensitive ID unless Show Profile ID on CV is Yes.

Candidate details:
Full name: ${clean(fullName) || '[Your Name]'}
Email: ${clean(email) || 'your.email@example.com'}
Phone: ${clean(phone) || '+27 00 000 0000'}
Location: ${clean(location) || 'Your City, South Africa'}
Show Profile ID on CV: ${safeShowIdOnCv ? 'Yes' : 'No'}
Profile ID: ${safeShowIdOnCv ? clean(idNumber) || '[optional]' : '[do not include]'}

Professional Summary:
${clean(summary) || '[not provided]'}

Core Competencies / Skills:
${clean(skills) || '[not provided]'}

Professional Experience:
${clean(experience) || '[not provided]'}

Education:
${clean(education) || '[not provided]'}

Additional Info:
${clean(extras) || '[not provided]'}`;

    try {
      const out = await callDeepseekChat({
        messages: [
          {
            role: 'system',
            content:
              'You are an expert South African CV writer. Return only a clean one-page A4 CV using the requested classic ATS template.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.25,
        max_tokens: 900,
      });

      const resumeText = stripMarkdownSymbols(getAiText(out));

      if (resumeText && resumeText.length > 250 && resumeText.includes('PROFESSIONAL SUMMARY')) {
        return res.json({
          ok: true,
          resumeText,
          pageSize: 'A4',
          layout: 'classic-ats-one-page',
          template: 'six-second-cv',
          source: 'deepseek-api',
        });
      }
    } catch (e) {
      console.error('resume-builder deepseek error', e);
    }

    return res.json({
      ok: true,
      resumeText: fallbackCv,
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      template: 'six-second-cv',
      source: 'template-fallback',
    });
  } catch (err) {
    console.error('resume-builder error', err);

    return res.json({
      ok: true,
      resumeText: buildClassicA4CvTemplate({}),
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      template: 'six-second-cv',
      source: 'error-fallback',
    });
  }
});

router.post('/pro/resume-improver', async (req, res) => {
  try {
    const {
      existingCv = '',
      targetLevel = '',
      extras = '',
      tier = 'free',
      creatorPlus,
    } = req.body || {};

    const baseCv = clean(existingCv);

    if (!baseCv) {
      return res.status(400).json({
        ok: false,
        error: 'Provide your current CV text first.',
      });
    }

    const canUseAi = isCreatorTier(tier, creatorPlus);

    if (!canUseAi) {
      return res.json({
        ok: true,
        improvedText: baseCv,
        source: 'free-template',
      });
    }

    const prompt = `Rewrite this CV into a stronger one-page A4 CV using classic ATS structure.

Target level:
${targetLevel || 'professional'}

Extra notes:
${extras || '[none]'}

Current CV:
${baseCv}`;

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content:
            'You are an expert CV improver. Return only a clean one-page A4 CV.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.25,
      max_tokens: 900,
    });

    return res.json({
      ok: true,
      improvedText: stripMarkdownSymbols(getAiText(out)),
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      template: 'six-second-cv',
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('resume-improver error', err);

    return res.json({
      ok: true,
      improvedText:
        'Paste your current CV again and include your job target, experience, skills, education, languages, and additional information.',
      source: 'error-fallback',
    });
  }
});

router.post('/pro/cover-letter', async (req, res) => {
  try {
    const {
      jobTitle = '',
      company = '',
      resumeSummary = '',
      extras = '',
      candidateName = '',
      tier = 'free',
      creatorPlus,
    } = req.body || {};

    const nameLine = candidateName || '[Your Name]';

    const baseLetter = `Dear Hiring Manager,

I am excited to apply for the ${jobTitle || 'role'} at ${company || 'your company'}. I believe my background, skills, and willingness to learn make me a strong fit for this opportunity.

${resumeSummary || 'I bring a strong work ethic, good communication skills, and a commitment to completing tasks professionally.'}

${extras || 'I am interested in this role because it matches my career goals and gives me an opportunity to grow while adding value to the company.'}

Thank you for considering my application. I would welcome the opportunity to discuss how I can contribute to your team.

Sincerely,
${nameLine}`;

    const canUseAi = isCreatorTier(tier, creatorPlus);

    if (!canUseAi) {
      return res.json({
        ok: true,
        letter: baseLetter,
        source: 'free-template',
      });
    }

    const prompt = `Write a concise professional cover letter.

Job title: ${jobTitle || 'role'}
Company: ${company || 'company'}
Candidate name: ${candidateName || '[Your Name]'}
Candidate summary:
${resumeSummary || '[not provided]'}

Extra notes:
${extras || '[none]'}

Rules:
- 3 to 5 short paragraphs.
- Professional but warm.
- Plain text only.
- Easy to copy and paste.
- Do not invent fake experience.`;

    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.45,
      max_tokens: 650,
    });

    return res.json({
      ok: true,
      letter: stripMarkdownSymbols(getAiText(out)) || baseLetter,
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('cover-letter error', err);

    return res.json({
      ok: true,
      letter: `Dear Hiring Manager,

Thank you for reviewing my application. I am interested in this opportunity and believe my skills and attitude could be a strong match.

I look forward to the possibility of discussing how I can contribute to your team.

Sincerely,
[Your Name]`,
      source: 'error-fallback',
    });
  }
});

/* ---------------------------------------------
   WORKSPACE ROUTES
--------------------------------------------- */

router.post('/pro/job-assistant', handleCareerWorkspace);
router.post('/job-assistant', handleCareerWorkspace);
router.post('/workspace', handleCareerWorkspace);
router.post('/career-workspace', handleCareerWorkspace);
router.post('/ask', handleCareerWorkspace);
router.post('/chat', handleCareerWorkspace);

/* ---------------------------------------------
   TRANSLATE
--------------------------------------------- */

router.post('/translate', async (req, res) => {
  try {
    const {
      text = '',
      targetLang = 'en',
      sourceLang = 'auto',
    } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'Missing text',
      });
    }

    const prompt = `Translate the text into the requested target language.

Rules:
- Preserve meaning and tone.
- Return only the translated text.

Source language: ${sourceLang}
Target language: ${targetLang}

Text:
${text}`;

    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 700,
    });

    return res.json({
      ok: true,
      translated: getAiText(out) || text,
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('AI translate error', err);

    return res.json({
      ok: true,
      translated: req.body?.text || '',
      source: 'fallback-error',
    });
  }
});

export default router;
