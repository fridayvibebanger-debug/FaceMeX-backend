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

function extractPromptFromBody(body = {}) {
  const raw =
    body.prompt ||
    body.message ||
    body.question ||
    body.input ||
    body.text ||
    body.query ||
    '';

  return normalizeUserPromptText(raw);
}

function extractPostContextFromBody(body = {}) {
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

  if (typeof possible === 'string') return clean(possible);

  if (possible && typeof possible === 'object') {
    return [
      possible.authorName,
      possible.userName,
      possible.company,
      possible.title,
      possible.content,
      possible.text,
      possible.caption,
      possible.description,
      possible.location,
      possible.link,
      possible.url,
      possible.createdAt,
    ]
      .filter(Boolean)
      .map((x) => String(x))
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
      .join('\n\n');
  }

  return '';
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
    temperature: 0.35,
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
        : 0.7,
    max_tokens:
      typeof process.env.LLAMA_MAX_TOKENS !== 'undefined'
        ? Number(process.env.LLAMA_MAX_TOKENS)
        : 700,
    ...rest,
  });
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

function isBroadJobSearchPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(i am looking for job|i'm looking for job|im looking for job|looking for job|looking for work|find me a job|find jobs|where can i start|where should i look|jobs around|jobs in|job around|job in|work around|work in|available jobs|available job)\b/i.test(t);
}

function isJobRelatedPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(job|jobs|work|hiring|vacancy|vacancies|career|careers|apply|application|learnership|internship|graduate|interview|cv|cover letter|employment|opportunity|opportunities)\b/i.test(t);
}

function isSpecificCompanyQuestion(text = '') {
  const t = clean(text).toLowerCase();

  if (isBroadJobSearchPrompt(t)) return false;

  const companyAction =
    /\b(is hiring|are hiring|hiring\?|hiring|vacancy|vacancies|jobs at|job at|work at|apply at|career at|careers at|openings at|opportunities at|does .* hire|do .* hire)\b/i.test(t);

  const hasCompanySignal =
    extractCompanyName(text) !== 'the company' ||
    /\b(cartrack|car track|sasol|rcl|westfalia|zz2|shoprite|pick n pay|boxer|pep|ackermans|mr price|cashbuild|build it|kfc|pedros|hungry lion|galitos|sanral|transnet|eskom|capitec|standard bank|absa|fnb|nedbank|dischem|clicks)\b/i.test(t);

  return companyAction && hasCompanySignal;
}

function isPostSafetyPrompt(text = '', postContext = '') {
  const t = `${text}\n${postContext}`.toLowerCase();

  return /\b(is this legit|is it legit|legit|scam|fake|real or fake|verify|safe|risky|should i apply|can i trust|check this post|this post|job post|apply link|whatsapp job|telegram job|facebook job|comments below|link in comments|dm me|inbox me|pay|fee|registration fee|training fee|admin fee|processing fee|uniform fee)\b/i.test(t);
}

function isUnsafePrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(hack|steal password|phishing|malware|spyware|scam people|fake document|forge certificate|forge id|illegal weapon|harm someone)\b/i.test(t);
}

function detectCareerIntent(text = '', postContext = '') {
  const t = clean(text).toLowerCase();

  if (isDatePrompt(t)) return 'date';

  if (isUnsafePrompt(t)) return 'unsafe';

  if (isPostSafetyPrompt(t, postContext)) return 'post-safety';

  if (isSpecificCompanyQuestion(t)) return 'company-verification';

  if (isBroadJobSearchPrompt(t)) return 'broad-job-search';

  const wantsBothEmailAndWhatsapp =
    /(email|mail|send cv|send my cv|application email|cover letter)/i.test(t) &&
    /(whatsapp|message|dm|sms|text)/i.test(t);

  if (wantsBothEmailAndWhatsapp) return 'email-and-message';

  if (
    /(investor|investors|funding|funder|funders|venture|angel|vc|raise capital|capital|startup|pitch|business opportunity|business opportunities|partnership|network with tech|networking|accelerator|incubator)/i.test(t)
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

  if (isJobRelatedPrompt(t)) return 'career-general';

  if (/(research|find out|company|market|industry|business idea|analyse|analyze)/i.test(t)) {
    return 'research';
  }

  return 'general-help';
}

/* ---------------------------------------------
   LOCATION / COMPANY / JOB HELPERS
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

function extractCompanyName(text = '') {
  const raw = clean(text);

  const knownCompanies = [
    { keys: ['cartrack', 'car track'], value: 'Cartrack' },
    { keys: ['rcl foods', 'rcl'], value: 'RCL FOODS' },
    { keys: ['westfalia fruit', 'westfalia'], value: 'Westfalia Fruit' },
    { keys: ['zz2'], value: 'ZZ2' },
    { keys: ['sasol'], value: 'Sasol' },
    { keys: ['shoprite'], value: 'Shoprite' },
    { keys: ['pick n pay', 'picknpay'], value: 'Pick n Pay' },
    { keys: ['boxer'], value: 'Boxer' },
    { keys: ['pep'], value: 'PEP' },
    { keys: ['ackermans'], value: 'Ackermans' },
    { keys: ['mr price'], value: 'Mr Price' },
    { keys: ['cashbuild'], value: 'Cashbuild' },
    { keys: ['build it'], value: 'Build It' },
    { keys: ['kfc'], value: 'KFC' },
    { keys: ['pedros', 'pedro'], value: 'Pedros' },
    { keys: ['hungry lion'], value: 'Hungry Lion' },
    { keys: ['galitos', "galito's"], value: 'Galitos' },
    { keys: ['sanral'], value: 'SANRAL' },
    { keys: ['transnet'], value: 'Transnet' },
    { keys: ['eskom'], value: 'Eskom' },
    { keys: ['capitec'], value: 'Capitec' },
    { keys: ['standard bank'], value: 'Standard Bank' },
    { keys: ['absa'], value: 'ABSA' },
    { keys: ['fnb'], value: 'FNB' },
    { keys: ['nedbank'], value: 'Nedbank' },
    { keys: ['dischem', 'dis-chem'], value: 'Dis-Chem' },
    { keys: ['clicks'], value: 'Clicks' },
  ];

  const lower = raw.toLowerCase();

  const found = knownCompanies.find((company) =>
    company.keys.some((key) => lower.includes(key))
  );

  if (found) return found.value;

  const cleaned = raw
    .replace(/\b(is|are|hiring|vacancy|vacancies|jobs|job|in|at|around|near|tzaneen|limpopo|south africa|career|careers|apply|work|\?)\b/gi, '')
    .replace(/[^\w\s&.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 2) return 'the company';

  return cleaned
    .split(' ')
    .slice(0, 4)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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

function googleSearchUrl(query) {
  return makeSearchUrl('https://www.google.com/search', { q: query });
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

function findLink(links, name) {
  return links.find((item) => item.name === name);
}

/* ---------------------------------------------
   ANSWER BUILDERS
--------------------------------------------- */

function buildUnsafeAnswer() {
  return `I can’t help with anything that harms people, scams users, steals accounts, creates fake documents, or breaks into systems.

What I can help with instead:

1. Secure your account or app
2. Report a scam safely
3. Verify a job post
4. Write a professional message
5. Build a safer FaceMeX feature`;
}

function buildCompanyVerificationAnswer(userText = '', postContext = '') {
  const date = getSouthAfricaDateContext();
  const company = extractCompanyName(`${userText}\n${postContext}`);
  const location = extractLocation(`${userText}\n${postContext}`);

  const officialCareersSearch = googleSearchUrl(`${company} official careers ${location}`);
  const vacancySearch = googleSearchUrl(`${company} vacancies ${location}`);
  const linkedinSearch = makeSearchUrl('https://www.linkedin.com/jobs/search/', {
    keywords: `${company} ${location}`,
    location,
  });
  const indeedSearch = makeSearchUrl('https://za.indeed.com/jobs', {
    q: `${company} ${location}`,
    l: location,
  });

  return `I’ll verify this like a real job check: separate official company sources from Facebook/WhatsApp posts, then show you the safest way to apply.

## Direct answer

I can’t confirm a live **${company} ${location}** vacancy inside FaceMeX unless it appears on an official company careers page or trusted job board.

So don’t treat random posts as real yet. Verify it first.

Today’s date is **${date.shortDate}**.

## Check these official sources first

1. [Search official ${company} careers](${officialCareersSearch})  
Start here first. The safest job posts come from the company’s own careers page.

2. [Search ${company} ${location} vacancies](${vacancySearch})  
Use this to compare whether the same vacancy appears on trusted sites.

3. [LinkedIn ${company} ${location} jobs](${linkedinSearch})  
Good for company-posted roles and recruiter posts.

4. [Indeed ${company} ${location} jobs](${indeedSearch})  
Good for checking if the vacancy appears on a known job board.

## How to know if it is real

A job post looks safer when it has:

- official company website link
- official company email domain
- clear job title
- clear location
- clear closing date
- proper job description
- no request for money
- no “DM me only” or “link in comments only”

## Red flags

Be careful if the post says:

- pay application fee
- pay training fee
- pay uniform fee
- WhatsApp only
- inbox me
- link only in comments
- salary looks too good
- they rush you to send ID or bank details

## Message to send today

> Good day. I saw information about possible ${company} opportunities around ${location}. Please may you confirm if there are current vacancies and where I can submit my CV officially?

## Call script

> Good day, I want to ask if there are any current openings for ${company} around ${location}. Please can you confirm the official way to apply and where I can send my CV?

## What you should do now

1. Open the official careers search link.
2. Check if the vacancy is still open.
3. Do not apply through random WhatsApp numbers.
4. Send your CV only through the official company website or verified recruitment email.
5. Never pay anyone for a job application.`;
}

function buildPostSafetyAnswer(userText = '', postContext = '') {
  const date = getSouthAfricaDateContext();
  const fullText = `${userText}\n${postContext}`.toLowerCase();

  let rating = 'Needs verification';
  const reasons = [];

  if (
    /\b(pay|fee|registration fee|training fee|admin fee|processing fee|uniform fee|deposit)\b/i.test(fullText)
  ) {
    rating = 'High risk';
    reasons.push('It mentions payment or fees. Real jobs should not require money to apply.');
  }

  if (/\b(whatsapp only|dm me|inbox me|link in comments|comments below)\b/i.test(fullText)) {
    reasons.push('It pushes people to WhatsApp, inbox, or comments instead of a clear official application link.');
  }

  if (!/\b(official|careers|company website|apply online|email|www\.|https?:\/\/)\b/i.test(fullText)) {
    reasons.push('I do not see a clear official company link or official application method.');
  }

  if (/\b(urgent|limited spots|apply now now|closing today|first come first serve)\b/i.test(fullText)) {
    reasons.push('It uses pressure language, which can be a scam signal.');
  }

  if (!reasons.length) {
    reasons.push('I still need the official link, company name, location, and closing date before calling it safe.');
  }

  const company = extractCompanyName(`${userText}\n${postContext}`);
  const location = extractLocation(`${userText}\n${postContext}`);

  return `I’ll check this like a job-safety review, not just guess.

## Safety rating: ${rating}

Today’s date is **${date.shortDate}**.

## Why I say that

${reasons.map((reason) => `- ${reason}`).join('\n')}

## What to verify before applying

Check these details first:

1. Company name
2. Official careers page
3. Official email domain
4. Job title
5. Location
6. Closing date
7. Salary or pay structure
8. Whether they ask for money

## Official source check

Use these searches:

1. [Search official ${company} careers](${googleSearchUrl(`${company} official careers ${location}`)})
2. [Search ${company} ${location} vacancy](${googleSearchUrl(`${company} ${location} vacancy`)})
3. [Search scam reports for this opportunity](${googleSearchUrl(`${company} job scam ${location}`)})

## Message to send before applying

> Good day. Before I apply, please may you confirm the official company name, job title, location, closing date, and official application link or email address?

## Important warning

Never pay for a job application. Real companies do not ask for application fees, training fees, uniform fees, or money to secure an interview.`;
}

function buildBroadJobSearchAnswer(userText = '') {
  const location = extractLocation(userText);
  const jobType = extractJobType(userText);
  const links = buildClickableJobLinks(userText);

  const indeed = findLink(links, 'Indeed');
  const linkedIn = findLink(links, 'LinkedIn');
  const pnet = findLink(links, 'PNet');
  const careers24 = findLink(links, 'Careers24');
  const sayouth = findLink(links, 'SAYouth');
  const essa = findLink(links, 'ESSA');

  return `Start with places where **${location}** jobs are most likely to appear fast.

## 1. Online job sites — check every morning

Use these first because companies post there often:

- [${indeed.label}](${indeed.url}) — best first stop for retail, admin, cleaning, driver, sales, restaurant, and entry-level work.
- [${linkedIn.label}](${linkedIn.url}) — good for company-posted jobs and job alerts.
- [${pnet.label}](${pnet.url}) — useful for agriculture, packhouse, admin, finance, management, and skilled jobs.
- [${careers24.label}](${careers24.url}) — good for South African vacancies across different industries.

Set alerts for these search words:

- "${jobType} ${location}"
- "general worker ${location}"
- "admin clerk ${location}"
- "cleaner ${location}"
- "driver jobs ${location}"
- "retail jobs ${location}"
- "learnership ${location}"

## 2. Apply directly to big local employers

These are the ones I would check first:

- [RCL FOODS careers](${googleSearchUrl(`RCL FOODS careers ${location}`)}) — check for admin, sales, driver, warehouse, and operations roles.
- [Westfalia Fruit careers](${googleSearchUrl(`Westfalia Fruit careers ${location}`)}) — good for packhouse, farm, admin, logistics, and graduate roles.
- [ZZ2 vacancies](${googleSearchUrl(`ZZ2 vacancies ${location}`)}) — check for agriculture, packhouse, admin, and semi-skilled opportunities.
- [Greater Tzaneen Municipality vacancies](${googleSearchUrl(`Greater Tzaneen Municipality vacancies`)}) — check weekly for municipal and government-related roles.

## 3. Walk-in places in ${location}

Print **10 CVs** and go physically to:

**Shops / malls / CBD**  
Clicks, Shoprite, Pick n Pay, Boxer, PEP, Ackermans, Mr Price, Cashbuild, Build It, clothing stores, cellphone shops.

**Fast food places**  
Pedros, KFC, Debonairs, Roman’s Pizza, Hungry Lion, Galito’s, Chicken Licken-type stores.

**Agriculture / packhouse areas**  
Westfalia, ZZ2-related offices, farms, packhouses, nurseries, seedling companies, fruit exporters.

**Car dealerships / spares shops**  
Motus, Mercedes-Benz Tzaneen, spare shops, tyre shops, car wash places. Sales, driver, cleaner, stock assistant, and parts assistant jobs can come from here.

## 4. Register with government platforms

Do this once, then check weekly:

- [SA Youth](${sayouth.url}) — youth opportunities, learnerships, and entry-level work.
- [ESSA / Department of Labour](${essa.url}) — job matching and employment services.

## Simple walk-in script

Say this:

> Good day, my name is [Your Name]. I’m looking for work and I’m available immediately. I can do general work, retail, cleaning, packing, admin support, or delivery assistant work. Can I please leave my CV for any current or upcoming vacancy?

## Your 3-day action plan

**Today:** apply online to 5 jobs and print 10 CVs.  
**Tomorrow:** visit shops, fast food places, and businesses around ${location}.  
**Day 3:** visit farms, packhouses, spares shops, warehouses, and car dealerships.

Don’t wait for only advertised jobs. In ${location}, many jobs move like taxi seats — the person who shows up early with a CV gets remembered first.`;
}

function buildEmailAndMessageAnswer({ role, company, contactPerson }) {
  const finalRole = clean(role) || 'the opportunity';
  const finalCompany = clean(company) || '[Company Name]';
  const person = clean(contactPerson) || '[Hiring Manager]';

  return `Here is a professional email and WhatsApp message you can send.

## Copy-ready email

Subject: Application for ${finalRole}

Good day ${person},

I hope you are well.

I would like to apply for the ${finalRole} opportunity at ${finalCompany}. I am interested in this opportunity and would appreciate the chance to submit my CV for consideration.

Please may you confirm the correct email address or application process?

Kind regards,  
[Your Name]  
[Your Phone Number]

## Copy-ready WhatsApp message

> Good day. I hope you are well. I am interested in the ${finalRole} opportunity at ${finalCompany}. Please may I ask where I can send my CV or how I can apply? Thank you.

## What to do

1. Replace the placeholders.
2. Attach your CV if sending by email.
3. Send during working hours.
4. Follow up after 3 to 5 working days.

Do not pay any application fee.`;
}

function buildEmailAnswer({ role, company, contactPerson }) {
  const finalRole = clean(role) || 'the opportunity';
  const finalCompany = clean(company) || '[Company Name]';
  const person = clean(contactPerson) || '[Hiring Manager]';

  return `Here is a professional email you can send.

Subject: Application for ${finalRole}

Good day ${person},

I hope you are well.

I would like to apply for the ${finalRole} opportunity at ${finalCompany}. I am interested in this opportunity and would appreciate the chance to submit my CV for consideration.

Please may you confirm the correct email address or application process?

Kind regards,  
[Your Name]  
[Your Phone Number]

## Quick checklist

1. Attach your CV.
2. Use a clear subject line.
3. Send during working hours.
4. Follow up after 3 to 5 working days.

Do not send your ID, bank details, or certificates before confirming the opportunity is legitimate.`;
}

function buildMessageAnswer({ role, company }) {
  const finalRole = clean(role) || 'the opportunity';
  const finalCompany = clean(company) || '[Company Name]';

  return `Here is a short WhatsApp message you can send.

> Good day. I hope you are well. I am interested in the ${finalRole} opportunity at ${finalCompany}. Please may I ask where I can send my CV or how I can apply? Thank you.

## What to do next

1. Send the message politely.
2. Wait for the correct application process.
3. Send your CV only when they confirm where to send it.
4. Follow up after 3 to 5 working days.

Do not pay any application fee.`;
}

function buildInvestorAnswer() {
  return `You can network with tech investors in South Africa, but don’t ask for money first. Ask for advice first.

## Best move

Build a short investor-ready message and contact people daily on LinkedIn, startup communities, accelerators, and founder networks.

## Action plan

1. Prepare a one-page startup summary.
2. Fix your LinkedIn profile so people understand what you are building.
3. Search for angel investors, VC partners, startup founders, incubator managers, and innovation hubs.
4. Message 10 people per day.
5. Ask for advice, not funding, in the first message.

## Message to send

> Hi [Name], I’m building [Startup Name], a South African platform focused on [problem you solve]. I’m not asking for funding immediately. I’d appreciate 10 minutes of advice on how to position this properly for investors. Would you be open to a short conversation?

Never pay anyone who promises guaranteed funding. Real investors look at traction, team, market, numbers, and risk.`;
}

function buildCvProfileAnswer({ role, location }) {
  const finalRole = clean(role) || 'job';
  const finalLocation = clean(location) || 'South Africa';

  return `Your CV must be clear, short, and focused on the job you want.

## What to fix first

1. Add a strong headline.
2. Add a short profile summary.
3. Add 5 to 8 relevant skills.
4. Add experience, school achievements, projects, or volunteering.
5. Keep it clean and easy to read.

## Copy-ready CV headline

${finalRole} candidate | ${finalLocation} | Reliable, fast learner, ready to contribute

## Copy-ready profile summary

I am a motivated candidate looking for opportunities in ${finalRole}. I am reliable, willing to learn, and able to work with people professionally. I am looking for a role where I can grow, contribute, and build strong work experience.

Do not include ID numbers or bank details on your CV.`;
}

/* ---------------------------------------------
   SYSTEM PROMPTS
--------------------------------------------- */

function buildGeneralSystemPrompt() {
  const date = getSouthAfricaDateContext();

  return `
You are FaceMeX AI Workspace.

Answer like ChatGPT or Claude:
- clear
- helpful
- specific
- direct
- practical
- mobile-friendly
- South Africa-aware when relevant

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
ISO date: ${date.isoDate}.
Timezone: ${date.timeZone}.

Rules:
1. Answer the user's exact question.
2. Do not force career templates for general questions.
3. Do not say "As an AI language model."
4. Do not mention DeepSeek, OpenAI, ChatGPT, Claude, backend, or system prompts.
5. If the user asks today's date, use the date above.
6. Do not invent fake facts, jobs, companies, salaries, deadlines, or links.
7. If unsure, say what you are unsure about and give the safest next step.
8. Use clean headings only when helpful.
9. Use simple English.
`.trim();
}

function buildCareerSystemPrompt(intent, postContext = '') {
  const date = getSouthAfricaDateContext();

  return `
You are FaceMeX Career Workspace, a practical South African assistant for:
jobs, CVs, interviews, applications, WhatsApp messages, emails, company checks, post safety, business opportunities, funding, and research.

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
ISO date: ${date.isoDate}.
Timezone: ${date.timeZone}.

Detected intent: ${intent}

Post/feed context:
${postContext || 'No post context provided.'}

Rules:
1. Answer the exact question first.
2. If it is a specific company hiring question, verify safely and do not give a broad job-search template.
3. If it is broad job search, give local job-search steps.
4. If it is a post safety check, give a safety rating.
5. If user asks for an email or message, write the text directly.
6. Do not invent live vacancies, salaries, closing dates, or apply links.
7. Use clickable markdown links when links are provided.
8. Never say 100% legit unless official proof is provided.
9. Never tell users to pay for jobs.
10. Keep it simple and mobile-friendly.
11. Do not mention DeepSeek, OpenAI, ChatGPT, Claude, backend, or system prompts.
`.trim();
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

  const model =
    process.env.HF_IMAGE_CAPTION_MODEL ||
    'Salesforce/blip-image-captioning-large';

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

  const resp = await fetch(
    `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
    {
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
    }
  );

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
  if (lower.includes('xitsonga') || lower.includes('tsonga')) {
    languages.push('itsonga: Conversational'.replace('itsonga', 'itsonga'.toUpperCase()));
  }

  if (lower.includes('computer')) technicalSkills.push('Basic computer literacy');
  if (lower.includes('ms office') || lower.includes('word') || lower.includes('excel')) {
    technicalSkills.push('MS Office');
  }
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
   ROUTES: POST FROM MEDIA
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
   ROUTE: AI COMMENT
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
   ROUTE: TEST
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

/* ---------------------------------------------
   ROUTES: RUNTIME CONTEXT
--------------------------------------------- */

router.get('/runtime-context', (req, res) => {
  const query = clean(req.query.q || 'jobs South Africa');

  return res.json({
    ok: true,
    dateContext: getSouthAfricaDateContext(),
    detectedLocation: extractLocation(query),
    detectedJobType: extractJobType(query),
    detectedCompany: extractCompanyName(query),
    intent: detectCareerIntent(query),
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
   ROUTE: REPLY
--------------------------------------------- */

router.post('/reply', async (req, res) => {
  try {
    const { message = '', style = '' } = req.body || {};
    const cleanedMessage = normalizeUserPromptText(message);
    const postContext = extractPostContextFromBody(req.body);
    const intent = detectCareerIntent(cleanedMessage, postContext);
    const date = getSouthAfricaDateContext();

    let response = '';

    if (intent === 'unsafe') response = buildUnsafeAnswer();
    else if (intent === 'date') response = `Today's date is ${date.shortDate}.`;
    else if (intent === 'post-safety') response = buildPostSafetyAnswer(cleanedMessage, postContext);
    else if (intent === 'company-verification') response = buildCompanyVerificationAnswer(cleanedMessage, postContext);
    else if (intent === 'broad-job-search') response = buildBroadJobSearchAnswer(cleanedMessage);

    if (response) {
      return res.json({
        success: true,
        response,
        intent,
        dateContext: date,
        source: `${intent}-direct`,
      });
    }

    const prompt = `You are a helpful FaceMeX assistant.

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
Timezone: ${date.timeZone}.

Style: ${style || 'clear and friendly'}

Reply naturally and specifically to:
${cleanedMessage}`;

    try {
      const out = await callLlamaChat({
        messages: [{ role: 'user', content: prompt }],
      });

      const answer = getAiText(out);

      if (answer) {
        return res.json({
          success: true,
          response: answer,
          intent,
          source: 'llama-api',
        });
      }
    } catch (e) {
      console.error('reply llama error', e);
    }

    const out = await callDeepseekChat({
      messages: [
        { role: 'system', content: buildGeneralSystemPrompt() },
        { role: 'user', content: cleanedMessage },
      ],
    });

    return res.json({
      success: true,
      response: getAiText(out),
      intent,
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
   ROUTE: DIRECT DEEPSEEK
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

    const postContext = extractPostContextFromBody(req.body);
    const intent = detectCareerIntent(cleaned, postContext);
    const date = getSouthAfricaDateContext();

    let text = '';

    if (intent === 'unsafe') text = buildUnsafeAnswer();
    else if (intent === 'date') text = `Today's date is ${date.shortDate}.`;
    else if (intent === 'post-safety') text = buildPostSafetyAnswer(cleaned, postContext);
    else if (intent === 'company-verification') text = buildCompanyVerificationAnswer(cleaned, postContext);
    else if (intent === 'broad-job-search') text = buildBroadJobSearchAnswer(cleaned);

    if (text) {
      return res.json({
        ok: true,
        text,
        answer: text,
        response: text,
        reply: text,
        content: text,
        intent,
        dateContext: date,
        source: `${intent}-direct`,
      });
    }

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content: buildGeneralSystemPrompt(),
        },
        {
          role: 'user',
          content: cleaned,
        },
      ],
    });

    text = getAiText(out);

    return res.json({
      ok: true,
      text,
      answer: text,
      response: text,
      reply: text,
      content: text,
      intent,
      dateContext: date,
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
   DEV POST ENHANCER
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

    try {
      const out = await callDeepseekChat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 250,
      });

      const result = getAiText(out);

      if (result) {
        return res.json({
          ok: true,
          result,
          source: 'deepseek-api',
        });
      }
    } catch (e) {
      console.error('post-enhancer deepseek error', e);
    }

    return res.json({
      ok: true,
      result: `${clean(text) || 'Your post'}\n\n#FaceMeX #Create #Inspire`,
      source: 'fallback',
    });
  } catch (err) {
    console.error('post-enhancer error', err);

    return res.status(500).json({
      ok: false,
      error: 'Post enhancer failed',
    });
  }
});

/* ---------------------------------------------
   CAPTION MUSE
--------------------------------------------- */

router.post('/dev/caption-muse', async (req, res) => {
  try {
    const { topic = '' } = req.body || {};

    const prompt = `You are a playful but professional caption generator for FaceMeX.

Generate 3 short, scroll-stopping social captions for:
${clean(topic) || 'a moment on FaceMeX'}

Requirements:
- Max 1 to 2 short sentences per caption.
- Make them natural, not like ads.
- Add 1 to 3 relevant hashtags only if natural.
- Return one caption per line.
- No numbering.
- No JSON.`;

    try {
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

      if (captions.length) {
        return res.json({
          ok: true,
          suggestions: captions,
          source: 'deepseek-api',
        });
      }
    } catch (e) {
      console.error('caption-muse deepseek error', e);
    }

    return res.json({
      ok: true,
      suggestions: [
        `${clean(topic) || 'This moment'}, but make it unforgettable.`,
        `Vibes set. ${clean(topic) || 'Let’s go.'} #FaceMeX`,
        `Your daily spark: ${clean(topic) || 'creativity'} #Create`,
      ],
      source: 'fallback',
    });
  } catch (err) {
    console.error('caption-muse error', err);

    return res.status(500).json({
      ok: false,
      error: 'Caption Muse failed',
    });
  }
});

/* ---------------------------------------------
   TREND FINDER
--------------------------------------------- */

router.post('/dev/trend-finder', async (req, res) => {
  try {
    const { niche = 'general' } = req.body || {};

    const prompt = `You are a trend analyst for creators on FaceMeX.

For the niche: "${clean(niche) || 'general'}"

Give 5 trending hashtags with an estimated popularity score from 0 to 100.

Format:
#hashtag - score

Return plain text only.`;

    try {
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

      if (trends.length) {
        return res.json({
          ok: true,
          niche,
          trends,
          source: 'deepseek-api',
        });
      }
    } catch (e) {
      console.error('trend-finder deepseek error', e);
    }

    return res.json({
      ok: true,
      niche,
      trends: [
        { tag: '#AI', score: 96 },
        { tag: '#Careers', score: 88 },
        { tag: '#SouthAfrica', score: 83 },
      ],
      source: 'fallback',
    });
  } catch (err) {
    console.error('trend-finder error', err);

    return res.status(500).json({
      ok: false,
      error: 'Trend Finder failed',
    });
  }
});

/* ---------------------------------------------
   CREATOR ASSISTANT
--------------------------------------------- */

router.post('/dev/assistant', async (req, res) => {
  try {
    const {
      goal = 'grow audience',
      audience = 'general',
      topic = 'content',
    } = req.body || {};

    const prompt = `You are a concise creator and professional coach for FaceMeX.

User goal: ${goal}
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

    try {
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

      if (tips.length || ideas.length) {
        return res.json({
          ok: true,
          goal,
          audience,
          topic,
          tips: tips.slice(0, 3),
          ideas: ideas.slice(0, 3),
          source: 'deepseek-api',
        });
      }
    } catch (e) {
      console.error('assistant deepseek error', e);
    }

    return res.json({
      ok: true,
      goal,
      audience,
      topic,
      tips: [
        `Keep ${topic} concise and useful for ${audience}.`,
        'Use a clear hook in the first 2 seconds.',
        'End with a question to spark comments.',
      ],
      ideas: [
        `A quick how-to about ${topic}.`,
        `Behind the scenes: your process for ${topic}.`,
        `Myth-busting ${topic}: 3 things people get wrong.`,
      ],
      source: 'fallback',
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
   RESUME BUILDER
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

    const prompt = `You are a professional South African CV writer for FaceMeX.

Create a clean one-page A4 CV using this exact classic ATS template style:

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
- Use the exact section headings.
- One A4 page only.
- Plain text only.
- No markdown.
- No tables.
- No emojis.
- Correct grammar.
- Do not invent fake degrees, fake companies, fake licences, or fake job titles.
- Do not include bank details.
- Do not include ID number unless Show Profile ID on CV is Yes.

Candidate details:
Full name: ${clean(fullName) || '[Your Name]'}
Email: ${clean(email) || 'your.email@example.com'}
Phone: ${clean(phone) || '+27 00 000 0000'}
Location: ${clean(location) || 'Your City, South Africa'}
Show Profile ID on CV: ${safeShowIdOnCv ? 'Yes' : 'No'}
Profile ID: ${safeShowIdOnCv ? clean(idNumber) || '[optional]' : '[do not include]'}

Professional Summary:
${clean(summary) || '[not provided]'}

Skills:
${clean(skills) || '[not provided]'}

Experience:
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
              'You are an expert South African CV writer. Return only a clean one-page A4 CV.',
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
   RESUME IMPROVER
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

    const prompt = `Rewrite this CV into a stronger one-page A4 CV.

Target level:
${targetLevel || 'professional'}

Extra notes:
${extras || '[none]'}

Rules:
- One A4 page only.
- Plain text only.
- No markdown.
- Use clean section headings.
- Correct grammar.
- Do not invent fake details.
- Remove unnecessary sensitive personal details.

Current CV:
${baseCv}`;

    if (canUseAi) {
      try {
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

        const improvedText = stripMarkdown(getAiText(out));

        if (improvedText && improvedText.length > 250) {
          return res.json({
            ok: true,
            improvedText,
            pageSize: 'A4',
            layout: 'classic-ats-one-page',
            template: 'six-second-cv',
            source: 'deepseek-api',
          });
        }
      } catch (e) {
        console.error('resume-improver deepseek error', e);
      }
    }

    return res.json({
      ok: true,
      improvedText: `IMPROVED ONE-PAGE CV DRAFT

${baseCv}

NEXT STEPS
- Keep your CV to one A4 page.
- Correct grammar before sending.
- Remove unnecessary sensitive personal details.
- Tailor the CV to each job.`,
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      template: 'six-second-cv',
      source: canUseAi ? 'fallback' : 'free-template',
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
- Easy to copy and paste.
- Do not invent fake experience.`;

    try {
      const out = await callDeepseekChat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.45,
        max_tokens: 650,
      });

      const letter = stripMarkdown(getAiText(out));

      if (letter) {
        return res.json({
          ok: true,
          letter,
          source: 'deepseek-api',
        });
      }
    } catch (e) {
      console.error('cover-letter deepseek error', e);
    }

    return res.json({
      ok: true,
      letter: baseLetter,
      source: 'fallback',
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
   MAIN WORKSPACE HANDLER
--------------------------------------------- */

async function handleCareerWorkspace(req, res) {
  try {
    const {
      role = '',
      location = '',
      preferences = '',
      experienceLevel = '',
      industry = '',
      workMode = '',
      company = '',
      contactPerson = '',
    } = req.body || {};

    const userPrompt = extractPromptFromBody(req.body);
    const postContext = extractPostContextFromBody(req.body);

    if (!userPrompt) {
      return res.status(400).json({
        ok: false,
        answer: 'Please type what you need help with.',
      });
    }

    const intent = detectCareerIntent(userPrompt, postContext);
    const date = getSouthAfricaDateContext();

    let answer = '';

    if (intent === 'unsafe') {
      answer = buildUnsafeAnswer();
    } else if (intent === 'date') {
      answer = `Today's date is ${date.shortDate}.`;
    } else if (intent === 'post-safety') {
      answer = buildPostSafetyAnswer(userPrompt, postContext);
    } else if (intent === 'company-verification') {
      answer = buildCompanyVerificationAnswer(userPrompt, postContext);
    } else if (intent === 'broad-job-search') {
      answer = buildBroadJobSearchAnswer(userPrompt);
    } else if (intent === 'email-and-message') {
      answer = buildEmailAndMessageAnswer({
        role,
        company: company || extractCompanyName(userPrompt),
        contactPerson,
      });
    } else if (intent === 'email-application') {
      answer = buildEmailAnswer({
        role,
        company: company || extractCompanyName(userPrompt),
        contactPerson,
      });
    } else if (intent === 'message-application') {
      answer = buildMessageAnswer({
        role,
        company: company || extractCompanyName(userPrompt),
      });
    } else if (intent === 'investors-and-networking') {
      answer = buildInvestorAnswer();
    } else if (intent === 'cv-profile') {
      answer = buildCvProfileAnswer({
        role: role || extractJobType(userPrompt),
        location: location || extractLocation(userPrompt),
      });
    }

    if (answer) {
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
        source: `${intent}-direct`,
      });
    }

    const system =
      intent === 'career-general' || intent === 'research'
        ? buildCareerSystemPrompt(intent, postContext)
        : buildGeneralSystemPrompt();

    const user = `User request:
${userPrompt}

Optional context:
Role: ${role || 'Not provided'}
Location: ${location || 'Not provided'}
Industry: ${industry || 'Not provided'}
Work mode: ${workMode || 'Not provided'}
Experience level: ${experienceLevel || 'Not provided'}
Company: ${company || 'Not provided'}
Contact person: ${contactPerson || 'Not provided'}
Preferences: ${preferences || 'Not provided'}

Post/feed context:
${postContext || 'Not provided'}

Answer naturally, specifically, and practically.`;

    try {
      const out = await callDeepseekChat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
        max_tokens: 1400,
      });

      answer = getAiText(out);

      if (!answer) {
        answer = `I can help with that.

Please send a bit more detail so I can give you a stronger answer.`;
      }

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        source: 'deepseek-workspace',
      });
    } catch (e) {
      console.error('workspace deepseek error', e);

      answer = `I can help with that, but the AI is temporarily unavailable.

Try again shortly. If this is about a job or post, send the company name, location, and the post text so I can help you check it safely.`;

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        source: 'workspace-fallback',
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

    try {
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
    } catch (e) {
      console.error('translate deepseek error', e);

      return res.json({
        ok: true,
        translated: text,
        source: 'fallback',
      });
    }
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
