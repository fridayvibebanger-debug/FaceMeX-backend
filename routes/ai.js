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

function stripMarkdown(text = '') {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/###/g, '')
    .replace(/##/g, '')
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

function extractTextFromBody(body = {}) {
  if (!body || typeof body !== 'object') return '';

  const text =
    body.prompt ||
    body.message ||
    body.question ||
    body.input ||
    body.text ||
    body.query ||
    '';

  return normalizeUserPromptText(text);
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
    return clean(possible);
  }

  if (possible && typeof possible === 'object') {
    return [
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
      .map((item) => String(item))
      .join('\n')
      .trim();
  }

  if (Array.isArray(body.feedContext)) {
    return body.feedContext
      .slice(0, 5)
      .map((post, index) => {
        if (typeof post === 'string') return `Post ${index + 1}: ${post}`;

        return `Post ${index + 1}
Author: ${post?.authorName || post?.userName || 'Unknown'}
Content: ${post?.content || post?.text || post?.caption || ''}
Link: ${post?.link || post?.url || ''}
Date: ${post?.createdAt || ''}`;
      })
      .join('\n\n')
      .trim();
  }

  return '';
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
    /\b(today'?s date|today date|current date|date today|what date is it|what is the date|what's the date)\b/i.test(t)
  );
}

function isJobSearchPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(job|jobs|work|hiring|vacancy|vacancies|career|careers|apply|application|learnership|internship|graduate|employment|opportunity|opportunities|looking for a job|looking for job|looking for work|find me a job|find jobs|available job|available jobs|job around|jobs around|job in|jobs in|work around|work in|where can i start looking|where to look for job|where can i look for job)\b/i.test(t);
}

function isPostSafetyPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(is this legit|is it legit|legit|scam|fake|real or fake|verify|safe|risky|should i apply|can i trust|check this post|this post|job post|apply link|whatsapp job|telegram job|facebook job|comments below|inbox|dm me|registration fee|training fee|pay money|pay first|application fee)\b/i.test(t);
}

function isMisusePrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(hack|steal password|bypass|phishing|malware|spyware|scam people|fake document|forge|illegal drugs|weapon|harm someone|hide evidence)\b/i.test(t);
}

function detectWorkspaceIntent(text = '') {
  const t = clean(text).toLowerCase();

  if (isDatePrompt(t)) return 'date';
  if (isMisusePrompt(t)) return 'unsafe';
  if (isPostSafetyPrompt(t)) return 'verify-opportunity';

  const wantsBothEmailAndWhatsapp =
    /(email|mail|send cv|send my cv|application email|cover letter)/i.test(t) &&
    /(whatsapp|message|dm|sms|text)/i.test(t);

  if (wantsBothEmailAndWhatsapp) return 'email-and-message';

  if (
    /(investor|investors|funding|funder|funders|venture|angel|vc|raise capital|capital|startup|pitch|business opportunity|business opportunities|partnership|networking|accelerator|incubator)/i.test(t)
  ) {
    return 'investors-and-networking';
  }

  if (isJobSearchPrompt(t)) return 'job-search';

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

  if (/(research|find out|company|market|industry|business idea|analyse|analyze)/i.test(t)) {
    return 'research';
  }

  return 'general-help';
}

/* ---------------------------------------------
   AI CALLS
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
    temperature: 0.42,
    max_tokens: 1400,
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
        : 0.75,
    max_tokens:
      typeof process.env.LLAMA_MAX_TOKENS !== 'undefined'
        ? Number(process.env.LLAMA_MAX_TOKENS)
        : 700,
    ...rest,
  });
}

/* ---------------------------------------------
   JOB HELPERS
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

function makeGoogleSearch(query) {
  return makeSearchUrl('https://www.google.com/search', {
    q: query,
  });
}

function buildClickableJobLinks(userText = '') {
  const location = extractLocation(userText);
  const jobType = extractJobType(userText);
  const query = `${jobType} ${location}`;

  return [
    {
      name: 'Indeed',
      label: `Indeed ${location}`,
      url: makeSearchUrl('https://za.indeed.com/jobs', {
        q: query,
        l: location,
      }),
      note: 'Best first stop for retail, admin, cleaning, driver, sales, restaurant, and entry-level work.',
    },
    {
      name: 'LinkedIn',
      label: `LinkedIn Jobs ${location}`,
      url: makeSearchUrl('https://www.linkedin.com/jobs/search/', {
        keywords: query,
        location,
      }),
      note: 'Good for company-posted jobs and job alerts.',
    },
    {
      name: 'PNet',
      label: `PNet ${location}`,
      url: makeGoogleSearch(`site:pnet.co.za ${jobType} ${location} jobs`),
      note: 'Useful for agriculture, packhouse, admin, finance, management, and skilled jobs.',
    },
    {
      name: 'Careers24',
      label: `Careers24 ${location}`,
      url: makeSearchUrl('https://www.careers24.com/jobs/', {
        keywords: query,
        location,
      }),
      note: 'Good for South African vacancies across different industries.',
    },
    {
      name: 'DPSA',
      label: 'DPSA government vacancies',
      url: 'https://www.dpsa.gov.za/newsroom/psvc/',
      note: 'Official government vacancy circulars.',
    },
    {
      name: 'SAYouth',
      label: 'SA Youth',
      url: 'https://sayouth.mobi/',
      note: 'Good for youth opportunities, learnerships, and entry-level work.',
    },
    {
      name: 'ESSA',
      label: 'ESSA / Department of Labour',
      url: 'https://essa.labour.gov.za/EssaOnline/WebBeans/',
      note: 'Official job matching platform from the Department of Employment and Labour.',
    },
  ];
}

function buildLocalEmployerLinks(location = 'Tzaneen') {
  return [
    {
      label: 'RCL FOODS careers',
      url: makeGoogleSearch(`RCL FOODS careers ${location}`),
      note: 'Check for admin, sales, driver, warehouse, and operations roles.',
    },
    {
      label: 'Westfalia Fruit careers',
      url: makeGoogleSearch(`Westfalia Fruit careers ${location}`),
      note: 'Good for packhouse, farm, admin, logistics, and graduate roles.',
    },
    {
      label: 'ZZ2 careers',
      url: makeGoogleSearch(`ZZ2 vacancies ${location}`),
      note: 'Check for agriculture, packhouse, admin, and semi-skilled opportunities.',
    },
    {
      label: 'Greater Tzaneen Municipality vacancies',
      url: makeGoogleSearch('Greater Tzaneen Municipality vacancies'),
      note: 'Check weekly for municipal and government-related roles.',
    },
  ];
}

function findLink(links, name) {
  return links.find((item) => item.name === name);
}

function buildJobHuntAnswer(userText = '') {
  const location = extractLocation(userText);
  const jobType = extractJobType(userText);
  const links = buildClickableJobLinks(userText);
  const employers = buildLocalEmployerLinks(location);

  const indeed = findLink(links, 'Indeed');
  const linkedIn = findLink(links, 'LinkedIn');
  const pnet = findLink(links, 'PNet');
  const careers24 = findLink(links, 'Careers24');
  const sayouth = findLink(links, 'SAYouth');
  const essa = findLink(links, 'ESSA');

  const isTzaneen = location.toLowerCase().includes('tzaneen');

  return `Start with places where ${location} jobs are most likely to appear fast:

## 1. Online job sites — check every morning

Use these first because companies post there often:

- [${indeed.label}](${indeed.url}) — ${indeed.note}

- [${linkedIn.label}](${linkedIn.url}) — ${linkedIn.note}

- [${pnet.label}](${pnet.url}) — ${pnet.note}

- [${careers24.label}](${careers24.url}) — ${careers24.note}

Set alerts for these search words:

- "${jobType} ${location}"
- "general worker ${location}"
- "admin clerk ${location}"
- "cleaner ${location}"
- "retail jobs ${location}"
- "driver jobs ${location}"
- "learnership ${location}"

## 2. Apply directly to big local employers

These are the ones I would check first:

${employers.map((item) => `- [${item.label}](${item.url}) — ${item.note}`).join('\n\n')}

${
  isTzaneen
    ? `## 3. Walk-in places in Tzaneen

Print 10 CVs and go physically to:

**Tzaneen Crossing / Tzaneen CBD shops**  
Clicks, Shoprite, Pick n Pay, Boxer, Pep, Ackermans, Mr Price, Cashbuild, Build It, clothing stores, cellphone shops.

**Fast food places**  
Pedros, KFC, Debonairs, Roman’s Pizza, Hungry Lion, Galito’s, Chicken Licken-type stores.

**Agriculture / packhouse areas**  
Westfalia, ZZ2-related offices, Letsitele farms, packhouses, nurseries, seedling companies, fruit exporters.

**Car dealerships / spares shops**  
Motus, Mercedes-Benz Tzaneen, spare shops, tyre shops, car wash places. Sales, driver, cleaner, stock assistant, and parts assistant jobs can come from here.`
    : `## 3. Walk-in places around ${location}

Print 10 CVs and visit:

**Shopping centres and CBD shops**  
Retail stores, clothing shops, supermarkets, cellphone shops, hardware stores, and pharmacies.

**Fast food places**  
KFC, Debonairs, Roman’s Pizza, Hungry Lion, local restaurants, and takeaways.

**Local service businesses**  
Car washes, spares shops, tyre shops, courier companies, small factories, and warehouses.`
}

## 4. Register with government platforms

Do this once, then check weekly:

- [${sayouth.label}](${sayouth.url}) for youth opportunities, learnerships, and entry-level work.

- [${essa.label}](${essa.url}) for job matching.

## Simple walk-in script

Say this:

> Good day, my name is [Your Name]. I’m looking for work and I’m available immediately. I can do general work, retail, cleaning, packing, admin support, or delivery assistant work. Can I please leave my CV for any current or upcoming vacancy?

## Your 3-day action plan

**Today:** apply online to 5 jobs and print 10 CVs.  
**Tomorrow:** visit shops, fast food places, and businesses around ${location}.  
**Day 3:** visit farms, packhouses, spares shops, warehouses, and car dealerships.

Don’t wait for only advertised jobs. In many towns, jobs move like taxi seats — the person who shows up early with a CV gets remembered first.

Important: never pay anyone for a job application, training fee, uniform fee, or interview slot.`;
}

/* ---------------------------------------------
   PROMPTS
--------------------------------------------- */

function buildFaceMeXKnowledge() {
  return `
FaceMeX is a South African social and career platform.

FaceMeX helps users:
- discover jobs and opportunities
- use FaceMeX Career Workspace for CVs, job applications, research, interviews, and business support
- post and share content on the feed
- connect with people
- advertise businesses and opportunities
- check whether job posts or opportunities look risky

When users ask about FaceMeX:
- explain it simply
- guide them to use the feed, Career Workspace, profile, posts, messages, and job tools
- never promise guaranteed jobs, funding, or success
- never say FaceMeX verified something unless verified proof is provided
`.trim();
}

function buildNaturalSystemPrompt({ intent = 'general-help', postContext = '' } = {}) {
  const date = getSouthAfricaDateContext();

  return `
You are FaceMeX AI Workspace.

Answer like ChatGPT or Claude:
- clear
- smart
- direct
- natural
- practical
- mobile-friendly
- useful for South African users

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
ISO date: ${date.isoDate}.
Timezone: ${date.timeZone}.

${buildFaceMeXKnowledge()}

Main style:
1. Do not use forced template headings like "Direct answer", "Action plan", "Copy-ready message", or "Safety check".
2. Use natural headings only when useful.
3. For job questions, sound like a real person helping someone find work.
4. For general questions, answer normally and simply.
5. For business questions, give practical steps.
6. For FaceMeX questions, explain how the platform works and how the user can use it.
7. For post safety questions, give a quick verdict, what looks risky, what to verify, and a safe message to send.
8. Keep paragraphs short.
9. Use markdown clickable links when links are provided.
10. Never say "As an AI language model."
11. Do not mention system prompts, backend, DeepSeek, ChatGPT, or Claude.
12. Do not invent fake live vacancies, fake salaries, fake deadlines, fake companies, fake investors, or fake contacts.
13. If you do not have live browsing, do not claim you checked live listings.
14. If a request is unsafe, refuse briefly and redirect to a safe alternative.

Post/feed context if provided:
${postContext || 'No post context provided.'}

Detected intent: ${intent}
`.trim();
}

function buildUnsafeAnswer() {
  return `I can’t help with that.

I can help you do it safely instead — for example, protect your account, report a scam, check if a job post is fake, write a professional message, or fix your app/security issue the right way.`;
}

function buildGeneralFallbackAnswer(userPrompt = '') {
  const text = clean(userPrompt);
  const date = getSouthAfricaDateContext();

  if (isDatePrompt(text)) return `Today's date is ${date.shortDate}.`;
  if (isJobSearchPrompt(text)) return buildJobHuntAnswer(text);
  if (isMisusePrompt(text)) return buildUnsafeAnswer();

  return `Here’s the simplest way to think about it:

Tell me the exact result you want, and I’ll help you break it down into clear steps.

For example:
- what you want to build
- what is not working
- what you already tried
- what you want the final result to look like`;
}

function buildCareerFallbackAnswer(input) {
  const intent = input.intent;
  const role = clean(input.role) || 'the opportunity';
  const location = clean(input.location) || extractLocation(input.prompt || '') || 'South Africa';
  const company = clean(input.company) || '[Company Name]';
  const person = clean(input.contactPerson) || '[Hiring Manager]';
  const date = getSouthAfricaDateContext();

  if (intent === 'date') return `Today's date is ${date.shortDate}.`;
  if (intent === 'job-search') return buildJobHuntAnswer(input.prompt || `${role} ${location}`);
  if (intent === 'unsafe') return buildUnsafeAnswer();

  if (intent === 'email-and-message') {
    return `Here’s a clean email and WhatsApp message you can use.

## Email

**Subject:** Application for ${role}

Good day ${person},

I hope you are well.

I would like to apply for the ${role} opportunity at ${company}. I am interested in this opportunity and would appreciate the chance to submit my CV for consideration.

Please may you confirm the correct email address or application process?

Kind regards,  
[Your Name]  
[Your Phone Number]

## WhatsApp message

Good day. I hope you are well. I am interested in the ${role} opportunity at ${company}. Please may I ask where I can send my CV or how I can apply? Thank you.

Send it during working hours and do not pay any application fee.`;
  }

  if (intent === 'email-application') {
    return `Here’s a professional email you can send.

**Subject:** Application for ${role}

Good day ${person},

I hope you are well.

I would like to apply for the ${role} opportunity at ${company}. I am interested in this opportunity and would appreciate the chance to submit my CV for consideration.

Please may you confirm the correct email address or application process?

Kind regards,  
[Your Name]  
[Your Phone Number]

Attach your CV before sending. Do not send bank details or ID copies before confirming the opportunity is real.`;
  }

  if (intent === 'message-application') {
    return `Send this:

> Good day. I hope you are well. I am interested in the ${role} opportunity at ${company}. Please may I ask where I can send my CV or how I can apply? Thank you.

Keep it short first. Wait for them to confirm the official application process before sending sensitive documents.`;
  }

  if (intent === 'investors-and-networking') {
    return `Start by asking for advice, not money.

## What to do first

1. Prepare a one-page startup summary.
2. Make your LinkedIn profile clear.
3. Search for angel investors, VC partners, startup founders, incubators, and innovation hub leaders.
4. Message 10 people per day.
5. Ask for a short advice call first.

## Message to send

Hi [Name], I’m building [Startup Name], a South African platform focused on [problem you solve]. I’m not asking for funding immediately. I’d appreciate 10 minutes of advice on how to position this properly for investors. Would you be open to a short conversation?

Do not pay anyone who promises guaranteed funding.`;
  }

  if (intent === 'verify-opportunity') {
    return `I would treat it as **needs verification** until you confirm it from an official source.

Check these before applying:

1. Official company name
2. Official website or careers page
3. Company email domain
4. Job title, salary range, and location
5. Whether they ask for money
6. Whether the apply link goes to the real company website

Safe message to send:

> Good day. Thank you for the opportunity. Before I continue, please may you confirm the official company name, job title, location, job description, salary range, and the official application link or email address?

If they ask for an application fee, training fee, uniform fee, or money to secure an interview, walk away.`;
  }

  if (intent === 'cv-profile') {
    return `Your CV must be short, clean, and focused on the job you want.

Start with this headline:

**${role} candidate | ${location} | Reliable, fast learner, ready to contribute**

Profile summary:

> I am a motivated candidate looking for opportunities in ${role}. I am reliable, willing to learn, and able to work with people professionally. I am looking for a role where I can grow, contribute, and build strong work experience.

Keep your CV to one or two pages. Do not include bank details or ID numbers on the CV.`;
  }

  return buildGeneralFallbackAnswer(input.prompt || '');
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
   CV HELPERS
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

  if (!technicalSkills.length) technicalSkills.push('Basic computer literacy');
  if (!languages.length) languages.push('English: Fluent');

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

    if (useLocalAi) {
      const { askChat } = await import('../services/aiService.js');
      const out = await askChat(`${system}\n\n${user}`);

      return res.json({
        ok: true,
        post: clean(out),
        caption,
        captionSource,
        source: 'deepseek-local',
      });
    }

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
   COMMENT
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
   TEST + RUNTIME
--------------------------------------------- */

router.get('/test', async (_req, res) => {
  try {
    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: 'Say: FaceMeX AI is connected.' }],
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
   REPLY / DEEPSEEK
--------------------------------------------- */

router.post('/reply', async (req, res) => {
  try {
    const cleanedMessage = normalizeUserPromptText(req.body?.message || '');

    if (isDatePrompt(cleanedMessage)) {
      const date = getSouthAfricaDateContext();

      return res.json({
        success: true,
        response: `Today's date is ${date.shortDate}.`,
        source: 'date-direct',
      });
    }

    if (isMisusePrompt(cleanedMessage)) {
      return res.json({
        success: true,
        response: buildUnsafeAnswer(),
        source: 'safe-block',
      });
    }

    if (isJobSearchPrompt(cleanedMessage)) {
      return res.json({
        success: true,
        response: buildJobHuntAnswer(cleanedMessage),
        source: 'job-direct-natural',
      });
    }

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content: buildNaturalSystemPrompt({ intent: 'general-help' }),
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

router.post('/deepseek', async (req, res) => {
  try {
    const cleaned = normalizeUserPromptText(req.body?.prompt || '');
    const postContext = extractPostContextFromBody(req.body);

    if (!cleaned) {
      return res.status(400).json({
        ok: false,
        error: 'Missing prompt',
      });
    }

    if (isDatePrompt(cleaned)) {
      const date = getSouthAfricaDateContext();

      return res.json({
        ok: true,
        text: `Today's date is ${date.shortDate}.`,
        source: 'date-direct',
      });
    }

    if (isMisusePrompt(cleaned)) {
      return res.json({
        ok: true,
        text: buildUnsafeAnswer(),
        source: 'safe-block',
      });
    }

    if (isJobSearchPrompt(cleaned)) {
      return res.json({
        ok: true,
        text: buildJobHuntAnswer(cleaned),
        source: 'job-direct-natural',
      });
    }

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content: buildNaturalSystemPrompt({
            intent: isPostSafetyPrompt(cleaned) ? 'verify-opportunity' : 'general-help',
            postContext,
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

    const prompt = `You are an expert social media copywriter for FaceMeX.

Rewrite this post to be clearer and more engaging while keeping the same core message and tone.

Requirements:
- Keep it short and scannable.
- Make the first line a strong hook.
- Add 2 to 4 relevant hashtags on the last line only if natural.
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

    const prompt = `Generate 3 short social captions for:
${clean(topic) || 'a moment on FaceMeX'}

Rules:
- Max 1 to 2 short sentences per caption.
- Natural, not like ads.
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

    const prompt = `For the niche "${clean(niche) || 'general'}", give 5 trending hashtags with estimated popularity score from 0 to 100.

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

    const prompt = `Give 3 short coaching tips and 3 concrete content ideas.

User goal: ${goal}
Audience: ${audience}
Topic: ${topic}

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

    const lines = getAiText(out)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const tips = [];
    const ideas = [];
    let mode = 'tips';

    for (const line of lines) {
      if (/^ideas\s*:/i.test(line)) {
        mode = 'ideas';
        continue;
      }

      if (/^tips\s*:/i.test(line)) {
        mode = 'tips';
        continue;
      }

      const cleaned = line.replace(/^[-*\d.\s]+/, '').trim();

      if (!cleaned) continue;

      if (mode === 'tips') tips.push(cleaned);
      else ideas.push(cleaned);
    }

    return res.json({
      ok: true,
      goal,
      audience,
      topic,
      tips: tips.slice(0, 3),
      ideas: ideas.slice(0, 3),
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

    const prompt = `Create a clean one-page A4 CV using this exact ATS structure:

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

REFERENCES
Available Upon Request

Rules:
- One A4 page.
- Plain text only.
- No markdown.
- Do not invent fake qualifications, companies, licences, or job titles.
- Do not include bank details.
- Do not include ID number unless allowed.

Candidate:
Full name: ${clean(fullName) || '[Your Name]'}
Email: ${clean(email) || 'your.email@example.com'}
Phone: ${clean(phone) || '+27 00 000 0000'}
Location: ${clean(location) || 'Your City, South Africa'}
Show Profile ID on CV: ${safeShowIdOnCv ? 'Yes' : 'No'}
Profile ID: ${safeShowIdOnCv ? clean(idNumber) || '[optional]' : '[do not include]'}
Summary: ${clean(summary) || '[not provided]'}
Skills: ${clean(skills) || '[not provided]'}
Experience: ${clean(experience) || '[not provided]'}
Education: ${clean(education) || '[not provided]'}
Extra: ${clean(extras) || '[not provided]'}`;

    try {
      const out = await callDeepseekChat({
        messages: [
          {
            role: 'system',
            content: 'You are an expert South African CV writer. Return only the CV.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.25,
        max_tokens: 900,
      });

      const resumeText = stripMarkdown(getAiText(out));

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

/* ---------------------------------------------
   CV IMPROVER
--------------------------------------------- */

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

    const canUseAi = isCreatorTier(tier, creatorPlus) || isProTier(tier);

    if (!canUseAi) {
      return res.json({
        ok: true,
        improvedText: `IMPROVED ONE-PAGE CV DRAFT

${baseCv}

NEXT STEPS
- Keep your CV to one A4 page.
- Use clear headings.
- Correct grammar before sending.
- Remove bank details and unnecessary sensitive information.
- Tailor the CV to each job.`,
        pageSize: 'A4',
        layout: 'classic-ats-one-page',
        source: 'free-template',
      });
    }

    const prompt = `Rewrite this CV into a stronger one-page A4 CV.

Target level:
${targetLevel || 'professional'}

Extra notes:
${extras || '[none]'}

Rules:
- One A4 page only.
- Plain text only.
- No markdown.
- Use professional CV language.
- Do not invent fake companies, qualifications, licences, or job titles.
- Remove unnecessary sensitive personal details.

Current CV:
${baseCv}`;

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content: 'You are an expert South African CV improver. Return only the improved CV.',
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
      improvedText: stripMarkdown(getAiText(out)),
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      source: 'deepseek-api',
    });
  } catch (err) {
    console.error('resume-improver error', err);

    return res.json({
      ok: true,
      improvedText: 'Paste your current CV again and include your target job, experience, skills, education, and languages.',
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      source: 'error-fallback',
    });
  }
});

/* ---------------------------------------------
   COVER LETTER
--------------------------------------------- */

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

${resumeSummary || 'I bring a strong work ethic, good communication skills, and a commitment to completing tasks professionally. I am confident that I can contribute positively to your team.'}

${extras || 'I am interested in this role because it matches my career goals and gives me an opportunity to grow while adding value to the company.'}

Thank you for considering my application. I would welcome the opportunity to discuss how I can contribute to your team.

Sincerely,
${nameLine}`;

    const canUseAi = isCreatorTier(tier, creatorPlus) || isProTier(tier);

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
- No markdown.
- Do not invent fake experience.`;

    const out = await callDeepseekChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.45,
      max_tokens: 650,
    });

    return res.json({
      ok: true,
      letter: stripMarkdown(getAiText(out)) || baseLetter,
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
   FACEMEX WORKSPACE - NATURAL STYLE
--------------------------------------------- */

async function handleCareerWorkspace(req, res) {
  try {
    const userPrompt = extractTextFromBody(req.body);
    const postContext = extractPostContextFromBody(req.body);

    if (!userPrompt) {
      return res.status(400).json({
        ok: false,
        answer: 'Please type what you need help with.',
      });
    }

    const intent = detectWorkspaceIntent(userPrompt);
    const date = getSouthAfricaDateContext();

    if (intent === 'date') {
      const answer = `Today's date is ${date.shortDate}.`;

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
        source: 'safe-block',
      });
    }

    if (intent === 'job-search') {
      const answer = buildJobHuntAnswer(userPrompt);

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        links: buildClickableJobLinks(userPrompt),
        source: 'job-direct-natural',
      });
    }

    const fallbackAnswer = buildCareerFallbackAnswer({
      prompt: userPrompt,
      intent,
      role: req.body?.role || '',
      location: req.body?.location || '',
      industry: req.body?.industry || '',
      workMode: req.body?.workMode || '',
      experienceLevel: req.body?.experienceLevel || '',
      company: req.body?.company || '',
      contactPerson: req.body?.contactPerson || '',
      preferences: req.body?.preferences || '',
    });

    try {
      const out = await callDeepseekChat({
        messages: [
          {
            role: 'system',
            content: buildNaturalSystemPrompt({
              intent,
              postContext,
            }),
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.42,
        max_tokens: 1400,
      });

      const answer = getAiText(out) || fallbackAnswer;

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        source: 'deepseek-natural',
      });
    } catch (e) {
      console.error('workspace deepseek error', e);

      return res.json({
        ok: true,
        answer: fallbackAnswer,
        reply: fallbackAnswer,
        response: fallbackAnswer,
        text: fallbackAnswer,
        content: fallbackAnswer,
        intent,
        dateContext: date,
        source: 'natural-fallback',
      });
    }
  } catch (err) {
    console.error('workspace error', err);

    const answer = 'FaceMeX AI is temporarily unavailable. Please try again shortly.';

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
