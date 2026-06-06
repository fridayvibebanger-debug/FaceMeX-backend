import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

// Force cloud DeepSeek usage for now
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

  return /\b(job|jobs|work|hiring|vacancy|vacancies|career|careers|apply|application|learnership|internship|graduate|employment|opportunity|opportunities|looking for a job|looking for job|looking for work|find me a job|find jobs|available job|available jobs|job around|jobs around|job in|jobs in|work around|work in)\b/i.test(t);
}

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
    max_tokens: 1200,
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

/* ---------------------------------------------
   JOB LINK HELPERS
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

function findLink(links, name) {
  return links.find((item) => item.name === name);
}

function buildJobHuntAnswer(userText = '') {
  const date = getSouthAfricaDateContext();
  const location = extractLocation(userText);
  const jobType = extractJobType(userText);
  const links = buildClickableJobLinks(userText);

  const indeed = findLink(links, 'Indeed');
  const linkedIn = findLink(links, 'LinkedIn');
  const pnet = findLink(links, 'PNet');
  const careers24 = findLink(links, 'Careers24');
  const dpsa = findLink(links, 'DPSA');
  const sayouth = findLink(links, 'SAYouth');
  const essa = findLink(links, 'ESSA');

  return `I’ll treat this like a real job hunt: we’ll check trusted job sources, apply safely, and use a simple message/CV script you can send today.

## Direct answer

I can’t confirm live vacancies inside this chat yet, but these are the safest places to check and apply now for **${jobType} around ${location}**.

Today’s date is **${date.shortDate}**.

## Best places to apply first

1. [${indeed.label}](${indeed.url})  
${indeed.note}

2. [${linkedIn.label}](${linkedIn.url})  
${linkedIn.note}

3. [${pnet.label}](${pnet.url})  
${pnet.note}

4. [${careers24.label}](${careers24.url})  
${careers24.note}

5. [${dpsa.label}](${dpsa.url})  
${dpsa.note}

## Also register here today

1. [${sayouth.label}](${sayouth.url})  
${sayouth.note}

2. [${essa.label}](${essa.url})  
${essa.note}

## Search these words

Use these exact searches:

- "${jobType} ${location}"
- "general worker ${location}"
- "admin clerk ${location}"
- "cleaner ${location}"
- "retail jobs ${location}"
- "driver jobs ${location}"
- "learnership ${location}"
- "internship ${location}"

## Message to send when applying on WhatsApp/email

Copy this:

> Good day, my name is [Your Name]. I am looking for employment in ${location}. I would like to apply for any available position that matches my skills. I am hardworking, reliable, willing to learn, and available for interviews. Please let me know how I can apply. Thank you.

## Today’s action plan

1. Open Indeed and LinkedIn first.
2. Search **"${jobType} ${location}"**.
3. Apply to 3 jobs today.
4. Register or update your profile on SAYouth and ESSA.
5. Save every job link you apply for so you can follow up later.

## Important warning

Do **not** pay anyone for a job application. Legit companies do not ask for “application fees,” “training fees,” or money to secure an interview.`;
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
   FACE MEX CAREER WORKSPACE INTENT
--------------------------------------------- */

function detectCareerIntent(text) {
  const t = String(text || '').toLowerCase();

  if (isDatePrompt(t)) {
    return 'date';
  }

  const wantsBothEmailAndWhatsapp =
    /(email|mail|send cv|send my cv|application email|cover letter)/i.test(t) &&
    /(whatsapp|message|dm|sms|text)/i.test(t);

  if (wantsBothEmailAndWhatsapp) {
    return 'email-and-message';
  }

  if (
    /(investor|investors|funding|funder|funders|venture|angel|vc|raise capital|capital|startup|pitch|business opportunity|business opportunities|partnership|network with tech|networking|accelerator|incubator)/i.test(t)
  ) {
    return 'investors-and-networking';
  }

  if (
    /(fake|scam|legit|legitimate|verify|safe|pay money|registration fee|upfront|is this real|is it real|risky|check job)/i.test(t)
  ) {
    return 'verify-opportunity';
  }

  if (isJobSearchPrompt(t)) {
    return 'job-search';
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

  if (/(research|find out|company|market|industry|business idea|analyse|analyze)/i.test(t)) {
    return 'research';
  }

  return 'general-help';
}

function buildCareerSystemPrompt(intent) {
  const date = getSouthAfricaDateContext();

  return `
You are FaceMeX Career Workspace, a powerful practical AI assistant for South African users.

Current date context:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
ISO date: ${date.isoDate}.
Timezone: ${date.timeZone}.

Critical date rules:
1. If the user asks for today's date, answer with: Today's date is ${date.shortDate}.
2. Never guess the current date.
3. Never use old dates from memory.
4. For tomorrow, yesterday, deadlines, interviews, closing dates, and applications, calculate from the date above.

You help with:
jobs, CVs, interviews, applications, WhatsApp messages, email writing, research, business opportunities, investors, funding, networking, startup growth, fake job checks, and opportunity safety.

Critical rules:
1. Answer the user's exact request first.
2. Do not change the topic.
3. If the user asks for jobs, do not only write an email. Give job-search links, search terms, action plan, and safe application message.
4. If the user asks for an email, write the email first.
5. If the user asks for a WhatsApp message, write the WhatsApp message first.
6. If the user asks for both an email and WhatsApp message, provide both clearly.
7. If the user asks about investors, funding, startup networking, business opportunities, partnerships, or business growth, do not answer as if they are asking for a job.
8. If the user asks for latest jobs, explain where to search and how to apply. Do not invent fake live vacancies.
9. If the user asks for a truck job, driver job, or local job, give practical local job-search steps.
10. Use simple English.
11. Focus on South Africa when relevant.
12. Do not mention ChatGPT, Claude, or DeepSeek.
13. Do not invent fake jobs, fake investors, fake companies, fake events, or fake contacts.
14. Do not overuse generic advice.
15. Do not talk about CV improvements unless useful to the request.
16. Do not talk about weekly routines unless the user asks for a plan.
17. Use clickable markdown links when links are provided.

Detected intent: ${intent}
`;
}

function buildGeneralSystemPrompt() {
  const date = getSouthAfricaDateContext();

  return `
You are FaceMeX AI Workspace.

You must answer like ChatGPT or Claude:
- Clear
- Helpful
- Direct
- Smart
- Natural
- Practical
- Mobile-friendly

Current date context:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
ISO date: ${date.isoDate}.
Timezone: ${date.timeZone}.

Rules:
1. Answer the user's exact question.
2. For general questions, do not force career templates.
3. Do not force "Direct answer, Action plan, Copy-ready message, Safety check" unless it actually fits.
4. If the user asks a simple fact, answer simply.
5. If the user asks for business advice, give practical steps.
6. If the user asks for code, give clean code.
7. If the user asks for writing, write it clearly.
8. If the user asks for jobs, job search, vacancies, applications, CVs, interviews, or opportunities, use career mode.
9. If the user asks for today's date, use the current date above.
10. Do not say "As an AI language model."
11. Do not mention system prompts, backend, DeepSeek, ChatGPT, or Claude.
12. Do not invent fake facts, fake jobs, fake companies, fake links, or fake deadlines.
13. If you are unsure, say what you are unsure about and give the safest next step.
`;
}

function buildCareerUserPrompt(input) {
  return `
User request:
${input.prompt}

Optional user fields:
Role / opportunity: ${input.role || 'Not provided'}
Location: ${input.location || 'Not provided'}
Industry: ${input.industry || 'Not provided'}
Work mode: ${input.workMode || 'Not provided'}
Experience level: ${input.experienceLevel || 'Not provided'}
Company: ${input.company || 'Not provided'}
Contact person: ${input.contactPerson || 'Not provided'}
Extra preferences: ${input.preferences || 'Not provided'}

Important:
The user request is more important than the optional fields.
If the user asks for jobs, answer as a job hunt, not only an email.
If the user asks for today's date, answer with the real date from the system prompt.
If the user asks for an email or WhatsApp message, write it directly.
If company/contact person is missing, use placeholders like [Company Name], [Hiring Manager], [Your Name], [Your Phone Number].
`;
}

function buildGeneralFallbackAnswer(userPrompt = '') {
  const text = clean(userPrompt);
  const date = getSouthAfricaDateContext();

  if (isDatePrompt(text)) {
    return `Today's date is ${date.shortDate}.`;
  }

  if (isJobSearchPrompt(text)) {
    return buildJobHuntAnswer(text);
  }

  return `I can help with that.

Please send a bit more detail so I can give you a strong answer.

For example, tell me:
1. What exactly you want to do
2. Where you are stuck
3. What result you want

Then I’ll give you a clear step-by-step answer.`;
}

function buildCareerFallbackAnswer(input) {
  const intent = input.intent;
  const role = clean(input.role) || 'the opportunity';
  const location = clean(input.location) || extractLocation(input.prompt || '') || 'South Africa';
  const company = clean(input.company) || '[Company Name]';
  const person = clean(input.contactPerson) || '[Hiring Manager]';
  const date = getSouthAfricaDateContext();

  if (intent === 'date') {
    return `Today's date is ${date.shortDate}.`;
  }

  if (intent === 'job-search') {
    return buildJobHuntAnswer(input.prompt || `${role} ${location}`);
  }

  if (intent === 'email-and-message') {
    return `Direct answer:
Here is a professional email and WhatsApp message you can send.

Copy-ready email:
Subject: Application for ${role}

Good day ${person},

I hope you are well.

I would like to apply for the ${role} opportunity at ${company}. I am interested in this opportunity and would appreciate the chance to submit my CV for consideration.

Please may you confirm the correct email address or application process?

Kind regards,
[Your Name]
[Your Phone Number]

Copy-ready WhatsApp message:
Good day. I hope you are well. I am interested in the ${role} opportunity at ${company}. Please may I ask where I can send my CV or how I can apply? Thank you.

Action plan:
1. Replace the placeholders with your real details.
2. Attach your CV if sending by email.
3. Send during working hours.
4. Follow up after 3 to 5 working days.

Safety check:
Do not pay any application fee. Only send sensitive documents after confirming the opportunity is real.`;
  }

  if (intent === 'email-application') {
    return `Direct answer:
Here is a professional email you can send.

Copy-ready email:
Subject: Application for ${role}

Good day ${person},

I hope you are well.

I would like to apply for the ${role} opportunity at ${company}. I am interested in this opportunity and would appreciate the chance to submit my CV for consideration.

Please may you confirm the correct email address or application process?

Kind regards,
[Your Name]
[Your Phone Number]

Action plan:
1. Replace the placeholders.
2. Attach your CV.
3. Send during working hours.
4. Follow up after 3 to 5 working days.

Safety check:
Do not send your ID, bank details, or certificates before confirming the opportunity is legitimate.`;
  }

  if (intent === 'message-application') {
    return `Direct answer:
Here is a short WhatsApp message you can send.

Copy-ready message:
Good day. I hope you are well. I am interested in the ${role} opportunity at ${company}. Please may I ask where I can send my CV or how I can apply? Thank you.

Action plan:
1. Send the message politely.
2. Wait for the correct application process.
3. Send your CV only when they confirm where to send it.
4. Follow up after 3 to 5 working days.

Safety check:
Do not pay any application fee.`;
  }

  if (intent === 'investors-and-networking') {
    return `Direct answer:
You can network with tech investors in South Africa through LinkedIn outreach, startup events, accelerators, warm introductions, and founder communities.

Action plan:
1. Prepare a one-page startup summary.
2. Fix your LinkedIn profile so it clearly says what you are building.
3. Search for angel investors, VC partners, startup founders, accelerator managers, and innovation hub leaders.
4. Message 10 people per day.
5. Ask for advice first, not money first.

Copy-ready message:
Hi [Name], I’m building [Startup Name], a South African platform focused on [problem you solve]. I’m not asking for funding immediately. I’d appreciate 10 minutes of advice on how to position this properly for investors. Would you be open to a short conversation?

Safety check:
Do not pay anyone who promises guaranteed funding. Real investors review traction, team, market, numbers, and risk.`;
  }

  if (intent === 'verify-opportunity') {
    return `Direct answer:
Before you apply, verify the opportunity properly.

Action plan:
1. Check the official company name.
2. Check if the email address matches the company domain.
3. Ask for the full job description, salary range, location, and interview process.
4. Search the company online and check LinkedIn, website, reviews, and address.
5. Never pay for a job, interview, uniform, training, or placement.

Copy-ready message:
Good day. Thank you for the opportunity. Before I continue, please may you confirm the official company name, job title, location, job description, salary range, and the official email address I should use for my application?

Safety check:
If they rush you, ask for money, or refuse to give clear company details, treat it as risky.`;
  }

  if (intent === 'cv-profile') {
    return `Direct answer:
Your CV must be clear, short, and focused on the job you want.

Action plan:
1. Add a strong headline.
2. Add a short profile summary.
3. Add 5 to 8 relevant skills.
4. Add experience, projects, school achievements, or volunteering.
5. Keep it clean and easy to read.

Copy-ready CV headline:
${role} candidate | ${location} | Reliable, fast learner, ready to contribute

Copy-ready profile summary:
I am a motivated candidate looking for opportunities in ${role}. I am reliable, willing to learn, and able to work with people professionally. I am looking for a role where I can grow, contribute, and build strong work experience.

Safety check:
Do not include ID numbers or bank details on your CV.`;
  }

  return buildGeneralFallbackAnswer(input.prompt || '');
}

function answerLooksWrongForIntent(answer, intent) {
  const a = String(answer || '').toLowerCase();

  if (!a) return true;

  if (intent === 'date') {
    return !a.includes('today');
  }

  if (intent === 'job-search') {
    return (
      a.includes('here is a professional email') ||
      a.includes('copy-ready email') ||
      (!a.includes('indeed') && !a.includes('linkedin') && !a.includes('job'))
    );
  }

  if (intent === 'email-and-message') {
    return !a.includes('subject:') || !a.includes('whatsapp');
  }

  if (intent === 'email-application') {
    return !a.includes('subject:');
  }

  if (intent === 'message-application') {
    return a.includes('weekly routine') || a.includes('role focus');
  }

  if (intent === 'investors-and-networking') {
    return (
      a.includes('role focus') ||
      a.includes('target job titles') ||
      a.includes('cv / profile') ||
      a.includes('fintech roles') ||
      a.includes('apply to')
    );
  }

  return false;
}

function ensureCareerAnswer(answer, fallback, intent) {
  const raw = clean(answer);

  if (answerLooksWrongForIntent(raw, intent)) {
    return fallback;
  }

  if (intent === 'job-search') {
    return raw;
  }

  if (intent === 'date') {
    return raw;
  }

  const cleaned = stripMarkdown(raw);

  const lower = cleaned.toLowerCase();
  const hasDirect = lower.includes('direct answer');
  const hasAction = lower.includes('action plan');
  const hasCopy = lower.includes('copy-ready');
  const hasSafety = lower.includes('safety check');

  if (hasDirect && hasAction && hasCopy && hasSafety) {
    return cleaned;
  }

  return `${cleaned}

Action plan:
1. Take one clear action today.
2. Save the useful information.
3. Contact the right person or company.
4. Track who you contacted.
5. Follow up in 3 to 5 working days.

Copy-ready message:
Good day. I am interested in this opportunity. Please may you advise the correct process or contact person? Thank you.

Safety check:
Always verify opportunities before paying money or sending sensitive documents.`;
}

/* ---------------------------------------------
   CV TEMPLATE HELPERS - CLASSIC 6 SECOND ATS CV
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
  if (lower.includes('xitsonga') || lower.includes('tsonga')) languages.push('Xitsonga: Conversational');

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

    if (useLocalAi) {
      const { askChat } = await import('../services/aiService.js');
      const out = await askChat(`${system}\n\n${user}`);

      return res.json({
        ok: true,
        comment: clean(out),
        source: 'deepseek-local',
      });
    }

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
   TEST
--------------------------------------------- */

router.get('/test', async (req, res) => {
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
   RUNTIME CONTEXT TEST
--------------------------------------------- */

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
   REPLY
--------------------------------------------- */

router.post('/reply', async (req, res) => {
  try {
    const { message = '', style = '' } = req.body || {};
    const cleanedMessage = normalizeUserPromptText(message);

    if (isDatePrompt(cleanedMessage)) {
      const date = getSouthAfricaDateContext();

      return res.json({
        success: true,
        response: `Today's date is ${date.shortDate}.`,
        source: 'date-direct',
      });
    }

    if (isJobSearchPrompt(cleanedMessage)) {
      return res.json({
        success: true,
        response: buildJobHuntAnswer(cleanedMessage),
        source: 'job-direct',
      });
    }

    const date = getSouthAfricaDateContext();

    const prompt = `You are a helpful FaceMeX assistant.

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
Timezone: ${date.timeZone}.

Style: ${style || 'clear and friendly'}

Reply concisely to:
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
      messages: [{ role: 'user', content: prompt }],
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
      const date = getSouthAfricaDateContext();

      return res.json({
        ok: true,
        text: `Today's date is ${date.shortDate}.`,
        source: 'date-direct',
      });
    }

    if (isJobSearchPrompt(cleaned)) {
      return res.json({
        ok: true,
        text: buildJobHuntAnswer(cleaned),
        source: 'job-direct',
      });
    }

    const date = getSouthAfricaDateContext();

    const out = await callDeepseekChat({
      messages: [
        {
          role: 'system',
          content: `You are FaceMeX AI. Today is ${date.readableDateTime}. Use this date for all date-related answers. Answer general questions naturally like ChatGPT or Claude.`,
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
   AI CV BUILDER - CLASSIC A4 TEMPLATE
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
      tier = 'free',
      creatorPlus,
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

Strict rules:
- Use the exact section headings above.
- One A4 page only.
- Keep it concise and professional.
- Plain text only.
- No markdown.
- No tables.
- No emojis.
- Rewrite weak or unpolished user input into professional CV language.
- Correct grammar, spelling, punctuation, and structure.
- Do not copy raw user text exactly if it sounds unprofessional.
- Keep the meaning true.
- Turn short experience lines into professional bullet points where possible.
- Do not invent fake degrees, fake companies, fake licences, or fake job titles.
- Do not include bank details.
- Do not include sensitive ID number unless Show Profile ID on CV is Yes.
- If details are missing, use clean placeholders.
- "English fluently" must become "English: Fluent".
- "Sepedi mothers tangue" must become "Sepedi: Mother tongue".
- "Sepedi mothers tongue" must become "Sepedi: Mother tongue".
- "Code 10 drive" must become "Driver’s licence: Code 10".
- "Media management and Team management" must become a clean professional summary about media management, team coordination, leadership, communication, and customer service.

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
   CV IMPROVER - CLASSIC A4 TEMPLATE
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

    const canUseAi = isCreatorTier(tier, creatorPlus);

    const prompt = `Rewrite this CV into a stronger one-page A4 CV using this exact template:

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

Target level:
${targetLevel || 'professional'}

Extra notes:
${extras || '[none]'}

Rules:
- One A4 page only.
- Plain text only.
- No markdown.
- No tables.
- Use the exact section headings.
- Rewrite weak or unpolished input into professional CV language.
- Correct grammar, spelling, punctuation, and structure.
- Do not copy raw user text exactly if it sounds unprofessional.
- Keep the meaning true.
- Turn short experience lines into professional bullet points.
- Do not invent fake companies, qualifications, licences, or job titles.
- Remove unnecessary sensitive personal details.
- "English fluently" must become "English: Fluent".
- "Sepedi mothers tangue" must become "Sepedi: Mother tongue".
- "Code 10 drive" must become "Driver’s licence: Code 10".

Current CV:
${baseCv}`;

    if (canUseAi) {
      try {
        const out = await callDeepseekChat({
          messages: [
            {
              role: 'system',
              content:
                'You are an expert CV improver. Return only a clean one-page A4 CV using the requested classic ATS template.',
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

        if (improvedText && improvedText.length > 250 && improvedText.includes('PROFESSIONAL SUMMARY')) {
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
- Use the classic ATS template: summary, competencies, experience, education, technical skills, languages, and references.
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
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      template: 'six-second-cv',
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
   FACE MEX CAREER WORKSPACE - FIXED
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

    if (!userPrompt) {
      return res.status(400).json({
        ok: false,
        answer: 'Please type what you need help with.',
      });
    }

    const intent = detectCareerIntent(userPrompt);
    const date = getSouthAfricaDateContext();

    /*
      DIRECT DATE MODE
    */
    if (intent === 'date' || isDatePrompt(userPrompt)) {
      const answer = `Today's date is ${date.shortDate}.`;

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent: 'date',
        dateContext: date,
        source: 'date-direct',
      });
    }

    /*
      DIRECT JOB MODE
    */
    if (intent === 'job-search' || isJobSearchPrompt(userPrompt)) {
      const answer = buildJobHuntAnswer(userPrompt);

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent: 'job-search',
        dateContext: date,
        links: buildClickableJobLinks(userPrompt),
        source: 'job-direct',
      });
    }

    /*
      GENERAL MODE
      This makes normal questions answer like ChatGPT/Claude.
    */
    if (intent === 'general-help' || intent === 'research') {
      try {
        const out = await callDeepseekChat({
          messages: [
            {
              role: 'system',
              content: buildGeneralSystemPrompt(),
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
          temperature: 0.45,
          max_tokens: 1200,
        });

        const answer = getAiText(out) || buildGeneralFallbackAnswer(userPrompt);

        return res.json({
          ok: true,
          answer,
          reply: answer,
          response: answer,
          text: answer,
          content: answer,
          intent,
          dateContext: date,
          source: 'deepseek-general',
        });
      } catch (e) {
        console.error('general workspace deepseek error', e);

        const answer = buildGeneralFallbackAnswer(userPrompt);

        return res.json({
          ok: true,
          answer,
          reply: answer,
          response: answer,
          text: answer,
          content: answer,
          intent,
          dateContext: date,
          source: 'general-fallback',
        });
      }
    }

    /*
      CAREER / CV / EMAIL / INVESTOR MODE
    */
    const fallbackAnswer = buildCareerFallbackAnswer({
      prompt: userPrompt,
      intent,
      role,
      location,
      industry,
      workMode,
      experienceLevel,
      company,
      contactPerson,
      preferences,
    });

    const canUseAi = true;

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
        source: 'free-template',
      });
    }

    try {
      const out = await callDeepseekChat({
        messages: [
          {
            role: 'system',
            content: buildCareerSystemPrompt(intent),
          },
          {
            role: 'user',
            content: buildCareerUserPrompt({
              prompt: userPrompt,
              role,
              location,
              industry,
              workMode,
              experienceLevel,
              company,
              contactPerson,
              preferences,
            }),
          },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      });

      const rawAnswer = getAiText(out);
      const answer = ensureCareerAnswer(rawAnswer, fallbackAnswer, intent);

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        source: 'deepseek-career',
      });
    } catch (e) {
      console.error('career workspace deepseek error', e);

      return res.json({
        ok: true,
        answer: fallbackAnswer,
        reply: fallbackAnswer,
        response: fallbackAnswer,
        text: fallbackAnswer,
        content: fallbackAnswer,
        intent,
        dateContext: date,
        source: 'career-fallback',
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
