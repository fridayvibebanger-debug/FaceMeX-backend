import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

/* ---------------------------------------------
   BASIC HELPERS
--------------------------------------------- */

const useLocalAi = false;

function clean(value) {
  return String(value || '').trim();
}

function getAiText(out) {
  return clean(out?.choices?.[0]?.message?.content || '');
}

function normalizeUserPromptText(text = '') {
  const raw = clean(text);

  if (!raw.includes('USER QUESTION:')) return raw;

  const parts = raw.split('USER QUESTION:');
  return clean(parts[parts.length - 1]);
}

function toBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;

  const v = String(value || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
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

/* ---------------------------------------------
   DATE HELPERS
--------------------------------------------- */

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

function isDatePrompt(text = '') {
  const t = clean(text).toLowerCase();

  return (
    t === 'date' ||
    t === 'today' ||
    t === 'today date' ||
    t === 'what is today' ||
    t === 'what is today?' ||
    t === "what is today's date" ||
    t === "what is today's date?" ||
    /\b(today'?s date|current date|date today|what date is it|what is the date|what's the date)\b/i.test(t)
  );
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
    temperature: 0.45,
    max_tokens: 1800,
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
        : 900,
    ...rest,
  });
}

/* ---------------------------------------------
   INTENT HELPERS
--------------------------------------------- */

function isUnsafePrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(hack|steal password|bypass login|phishing|malware|spyware|scam people|fake document|forge document|illegal weapon|hide evidence)\b/i.test(t);
}

function isJobRelatedPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(job|jobs|work|hiring|vacancy|vacancies|career|careers|apply|application|learnership|internship|graduate|employment|opportunity|opportunities|interview|cv|resume|cover letter|looking for work|looking for job|find me a job|available jobs)\b/i.test(t);
}

function isCompanyVerificationPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(is .* hiring|are .* hiring|is .* legit|is .* real|is .* fake|verify|scam|legit|can i trust|should i apply|job post|apply link|link in comments|whatsapp job|facebook job|telegram job)\b/i.test(t);
}

function isBusinessStartupPrompt(text = '') {
  const t = clean(text).toLowerCase();

  return /\b(start my own|start a business|my own business|own logistics|logistics business|delivery business|courier business|transport business|business in|business around|make money|customers|pricing|launch|startup|side hustle|hustle)\b/i.test(t);
}

function detectMainIntent(text = '', postContext = '') {
  const t = clean(`${text}\n${postContext}`).toLowerCase();

  if (isDatePrompt(t)) return 'date';
  if (isUnsafePrompt(t)) return 'unsafe';
  if (isCompanyVerificationPrompt(t)) return 'company-verification';
  if (postContext) return 'post-analysis';
  if (isBusinessStartupPrompt(t)) return 'business-startup';
  if (isJobRelatedPrompt(t)) return 'career';
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
    return normalizeUserPromptText(direct);
  }

  if (Array.isArray(body.messages)) {
    const lastUserMessage = [...body.messages]
      .reverse()
      .find((msg) => msg?.role === 'user' && typeof msg?.content === 'string');

    if (lastUserMessage?.content) {
      return normalizeUserPromptText(lastUserMessage.content);
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
    return clean(possible);
  }

  if (possible && typeof possible === 'object') {
    const parts = [
      possible.authorName || possible.userName,
      possible.content || possible.text || possible.caption,
      possible.title,
      possible.description,
      possible.company,
      possible.location,
      possible.link || possible.url,
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

function extractCompanyName(text = '') {
  const raw = clean(text);
  const lower = raw.toLowerCase();

  let match =
    raw.match(/(?:is|are)\s+(.+?)\s+hiring/i) ||
    raw.match(/(.+?)\s+(?:is|are)\s+hiring/i) ||
    raw.match(/is\s+(.+?)\s+legit/i) ||
    raw.match(/verify\s+(.+)/i);

  if (match?.[1]) {
    return clean(match[1])
      .replace(/\?+$/g, '')
      .replace(/\b(in|around|near)\s+(tzaneen|limpopo|gauteng|south africa)\b/gi, '')
      .trim();
  }

  const known = [
    'cartrack',
    'car track',
    'rcl foods',
    'westfalia',
    'pedros',
    'sasol',
    'shoprite',
    'pick n pay',
    'boxer',
    'cashbuild',
    'pep',
    'ackermans',
    'motus',
    'sanral',
    'department of labour',
    'greater tzaneen municipality',
  ];

  const found = known.find((name) => lower.includes(name));
  return found ? found : '';
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
    'logistics',
    'delivery',
    'courier',
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

function buildUsefulLinks(userText = '', postContext = '') {
  const allText = clean(`${userText}\n${postContext}`);
  const location = extractLocation(allText);
  const jobType = extractJobType(allText);
  const company = extractCompanyName(allText);

  const links = [];

  if (company) {
    links.push({
      label: `${company} official careers search`,
      url: makeSearchUrl('https://www.google.com/search', {
        q: `${company} official careers ${location}`,
      }),
    });

    links.push({
      label: `${company} LinkedIn jobs`,
      url: makeSearchUrl('https://www.linkedin.com/jobs/search/', {
        keywords: company,
        location,
      }),
    });
  }

  links.push({
    label: `Indeed ${location} jobs`,
    url: makeSearchUrl('https://za.indeed.com/jobs', {
      q: `${jobType} ${location}`,
      l: location,
    }),
  });

  links.push({
    label: `LinkedIn ${location} jobs`,
    url: makeSearchUrl('https://www.linkedin.com/jobs/search/', {
      keywords: `${jobType} ${location}`,
      location,
    }),
  });

  links.push({
    label: 'PNet South Africa jobs',
    url: 'https://www.pnet.co.za/jobs',
  });

  links.push({
    label: 'Careers24 jobs',
    url: 'https://www.careers24.com/jobs/',
  });

  links.push({
    label: 'DPSA government vacancies',
    url: 'https://www.dpsa.gov.za/newsroom/psvc/',
  });

  links.push({
    label: 'SAYouth opportunities',
    url: 'https://sayouth.mobi/',
  });

  links.push({
    label: 'ESSA Department of Employment and Labour',
    url: 'https://essa.labour.gov.za/EssaOnline/WebBeans/',
  });

  return links;
}

function buildLinksMarkdown(links = []) {
  return links
    .map((link, index) => `${index + 1}. [${link.label}](${link.url})`)
    .join('\n');
}

/* ---------------------------------------------
   FACE MEX KNOWLEDGE + SYSTEM PROMPT
--------------------------------------------- */

function buildFaceMeXKnowledge() {
  return `
FaceMeX is a South African social and career platform.

FaceMeX helps users:
- discover jobs and opportunities
- use Career Workspace for CVs, applications, research, interview prep and business help
- post and share content on the feed
- connect with people
- advertise businesses and opportunities
- use AI for career, business and everyday questions
- check whether job posts or opportunities look risky

FaceMeX must feel local, practical, safe, useful and human.
`.trim();
}

function buildSmartSystemPrompt({ userText = '', postContext = '', intent = 'general' }) {
  const date = getSouthAfricaDateContext();
  const location = extractLocation(`${userText}\n${postContext}`);
  const jobType = extractJobType(`${userText}\n${postContext}`);
  const company = extractCompanyName(`${userText}\n${postContext}`);
  const usefulLinks = buildUsefulLinks(userText, postContext);

  return `
You are FaceMeX AI Workspace.

Your job:
Understand what the user meant, even when they type badly, spell words wrong, use broken English, mix slang, or ask unclear questions.

Current date:
Today is ${date.readableDateTime}.
Short date: ${date.shortDate}.
ISO date: ${date.isoDate}.
Timezone: ${date.timeZone}.

FaceMeX knowledge:
${buildFaceMeXKnowledge()}

Detected context:
Intent: ${intent}
Location: ${location}
Job/business type: ${jobType}
Company mentioned: ${company || 'none'}

Post/feed context:
${postContext || 'No post context was provided.'}

Useful links you may use:
${buildLinksMarkdown(usefulLinks)}

Main behavior:
- Answer like ChatGPT: natural, clear, direct, useful.
- Do not use a fixed template.
- Do not force every answer into "Direct answer / Action plan / Safety check".
- Choose the answer structure based on the user’s real intent.
- If the user asks business/startup/logistics, answer as a business strategist, not as a job search.
- If the user asks job search, answer as a job hunt guide with places to apply and a simple message.
- If the user asks if a company is hiring, answer as a verification assistant.
- If the user asks about a post, judge the post using the post context.
- If the user asks a simple general question, answer simply.
- If the user asks today's date, answer only with the correct date unless they ask for more.
- If the user asks for writing, produce copy-ready text.
- If the user asks for code, produce clean code.

Company verification rules:
- Be specific to the company the user named.
- If you cannot browse live jobs, say you cannot confirm live vacancies inside FaceMeX yet.
- Do not invent current vacancies, salaries, deadlines, emails, phone numbers, or apply links.
- Tell the user to verify through the official company careers page or trusted job boards.
- Provide clickable search links when useful.
- Warn them not to pay for jobs.
- If a job post asks for money, WhatsApp-only application, "link in comments", "DM me", or no official company link, mark it as "needs verification" or "high risk".

Post safety rating:
Use one of these when judging posts:
- Looks safer
- Needs verification
- High risk

For business/startup questions:
- Give the simplest way to make money first.
- Give where to start, who to approach, what to offer, pricing idea, and next action.
- Use local examples when location is known.
- Do not turn business questions into job-search answers.

Safety:
- Refuse hacking, phishing, fraud, fake documents, scams, illegal activity, or harmful requests.
- Redirect to a safe helpful option.

Style:
- Short paragraphs.
- Strong headings only when useful.
- Mobile-friendly.
- Simple English.
- Do not mention system prompts, backend, OpenAI, DeepSeek, ChatGPT, Claude, or hidden instructions.
`.trim();
}

/* ---------------------------------------------
   FALLBACK ANSWERS WHEN AI KEY FAILS
--------------------------------------------- */

function buildSafeFallback(userText = '', postContext = '') {
  const date = getSouthAfricaDateContext();
  const intent = detectMainIntent(userText, postContext);
  const location = extractLocation(`${userText}\n${postContext}`);
  const company = extractCompanyName(`${userText}\n${postContext}`);
  const links = buildUsefulLinks(userText, postContext);

  if (intent === 'date') {
    return `Today's date is ${date.shortDate}.`;
  }

  if (intent === 'unsafe') {
    return `I can’t help with that. I can help you do it safely and legally instead.`;
  }

  if (intent === 'business-startup') {
    return `Start where customers are already moving.

For logistics in ${location}, start small before thinking about trucks or offices.

Best place to start:
1. Shops and fast food places
2. Pharmacies and clinics
3. Tzaneen CBD and malls
4. Spaza shops
5. Laundry shops
6. Small businesses that need parcels delivered

First offer:
“I collect and deliver food, parcels, groceries, documents and small business orders around ${location}.”

Simple pricing:
- Short local delivery: R30–R50
- Medium distance: R60–R90
- Urgent delivery: add R30–R50
- Waiting after 10 minutes: add R30

Message to send:
Good day. I’m starting a local delivery service around ${location}. I can collect and deliver food, parcels, groceries and business orders. Please let me know if your business needs reliable local deliveries.

Today’s action:
Visit 10 businesses, send 30 WhatsApp messages, and try to get your first 3 paid deliveries.`;
  }

  if (intent === 'company-verification' || intent === 'post-analysis') {
    const companyLine = company ? ` for ${company}` : '';

    return `I can help you verify this${companyLine}.

I can’t confirm live vacancies inside FaceMeX unless the official post, link, or company careers page is provided.

What to check first:
1. Is the job on the official company careers page?
2. Does the email use the company domain?
3. Is there a clear job title, location, closing date and job description?
4. Are they asking for money? If yes, treat it as high risk.
5. Are they saying “WhatsApp only”, “DM me”, or “link in comments”? Treat it as needing verification.

Useful links:
${buildLinksMarkdown(links)}

Safe message to send:
Good day. I saw a post about this opportunity. Please may you confirm the official job title, location, application link, closing date and official email address for applications?

Important:
Never pay anyone for a job application, training, uniform, interview slot or background check.`;
  }

  if (intent === 'career') {
    return `Start with trusted places where jobs are most likely to appear.

Best places to check:
${buildLinksMarkdown(links)}

Search these words:
- jobs ${location}
- general worker ${location}
- admin clerk ${location}
- cleaner ${location}
- driver jobs ${location}
- learnership ${location}

Message to send:
Good day, my name is [Your Name]. I am looking for employment around ${location}. I am hardworking, reliable and available immediately. Please let me know if there are any current or upcoming vacancies.

Do not pay anyone for a job application.`;
  }

  return `I understand. Here’s the best way to handle it:

Please give me one more detail so I can answer properly:
1. What you want to achieve
2. Where you are
3. What you already tried

Then I’ll give you the exact next steps.`;
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

    const system = `You are FaceMeX AI, a world-class social media writer.

Write one post for FaceMeX.

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
${clean(text) || '[none]'}

Generate the post now.`;

    const out = await callDeepseekChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.85,
      max_tokens: 220,
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
- Be natural, human and non-cringe.
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
    detectedIntent: detectMainIntent(query),
    detectedLocation: extractLocation(query),
    detectedJobType: extractJobType(query),
    detectedCompany: extractCompanyName(query),
    links: buildUsefulLinks(query),
  });
});

router.get('/job-search-links', (req, res) => {
  const query = clean(req.query.q || 'jobs South Africa');

  return res.json({
    ok: true,
    query,
    detectedLocation: extractLocation(query),
    detectedJobType: extractJobType(query),
    detectedCompany: extractCompanyName(query),
    dateContext: getSouthAfricaDateContext(),
    links: buildUsefulLinks(query),
  });
});

/* ---------------------------------------------
   UNIVERSAL WORKSPACE HANDLER
--------------------------------------------- */

async function handleWorkspace(req, res) {
  try {
    const userPrompt = extractUserTextFromBody(req.body);
    const postContext = extractPostContextFromBody(req.body);
    const intent = detectMainIntent(userPrompt, postContext);
    const date = getSouthAfricaDateContext();
    const links = buildUsefulLinks(userPrompt, postContext);

    if (!userPrompt && !postContext) {
      const answer = 'Please type what you need help with.';

      return res.status(400).json({
        ok: false,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
      });
    }

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
        links,
        source: 'date-direct',
      });
    }

    if (intent === 'unsafe') {
      const answer =
        'I can’t help with that. I can help you do it safely, legally, and professionally instead.';

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        source: 'safety-direct',
      });
    }

    const systemPrompt = buildSmartSystemPrompt({
      userText: userPrompt,
      postContext,
      intent,
    });

    try {
      const out = await callDeepseekChat({
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `User typed:
${userPrompt || '[No direct user text]'}

Post/feed context:
${postContext || '[No post context provided]'}

Answer now by understanding the user's real intent.`,
          },
        ],
        temperature: 0.4,
        max_tokens: 1800,
      });

      const answer = getAiText(out) || buildSafeFallback(userPrompt, postContext);

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        links,
        source: 'deepseek-smart-workspace',
      });
    } catch (e) {
      console.error('workspace deepseek error', e);

      const answer = buildSafeFallback(userPrompt, postContext);

      return res.json({
        ok: true,
        answer,
        reply: answer,
        response: answer,
        text: answer,
        content: answer,
        intent,
        dateContext: date,
        links,
        source: 'smart-fallback',
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

/* ---------------------------------------------
   REPLY + DIRECT AI
--------------------------------------------- */

router.post('/reply', handleWorkspace);
router.post('/deepseek', handleWorkspace);
router.post('/pro/job-assistant', handleWorkspace);
router.post('/job-assistant', handleWorkspace);
router.post('/workspace', handleWorkspace);
router.post('/career-workspace', handleWorkspace);
router.post('/ask', handleWorkspace);
router.post('/chat', handleWorkspace);

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
    console.error('assistant error', err);

    return res.status(500).json({
      ok: false,
      error: 'Assistant failed',
    });
  }
});

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

  const finalSkills = splitList(skills);
  const finalExtras = splitList(extras);

  const profileLine =
    showIdOnCv && clean(idNumber)
      ? `Address: ${cleanLocation} | Contact: ${cleanPhone} | Email: ${cleanEmail} | Profile ID: ${clean(idNumber)}`
      : `Address: ${cleanLocation} | Contact: ${cleanPhone} | Email: ${cleanEmail}`;

  return `${name.toUpperCase()}
${profileLine}

PROFESSIONAL SUMMARY
${clean(summary) || 'Reliable and motivated candidate with strong communication, teamwork and customer service skills. Able to follow instructions, work under pressure and complete tasks on time.'}

CORE COMPETENCIES
${
  finalSkills.length
    ? finalSkills.map((item) => `- ${titleCaseWords(item)}`).join('\n')
    : `- Customer service
- Communication
- Teamwork
- Time management
- Problem solving`
}

PROFESSIONAL EXPERIENCE
${clean(experience) || `[Job Title] | [Company Name] | [Year]
- Supported daily workplace tasks and followed instructions.
- Assisted customers, team members or management professionally.
- Completed duties on time and maintained reliability.`}

EDUCATION
${clean(education) || '[School / College / Institution] | [Qualification] | [Year]'}

TECHNICAL SKILLS
${
  finalExtras.length
    ? finalExtras.map((item) => `- ${titleCaseWords(item)}`).join('\n')
    : `- Basic computer literacy
- Email communication
- MS Office`
}

LANGUAGES
- English: Fluent
- Sepedi: Mother tongue

REFERENCES
Available Upon Request`;
}

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

    const prompt = `Create a clean one-page A4 CV for a South African candidate.

Rules:
- Professional.
- One page.
- Plain text only.
- No markdown.
- No tables.
- Do not invent fake qualifications or jobs.
- Improve weak grammar.
- Remove unnecessary sensitive personal details.
- Use this structure:
FULL NAME
Contact line
PROFESSIONAL SUMMARY
CORE COMPETENCIES
PROFESSIONAL EXPERIENCE
EDUCATION
TECHNICAL SKILLS
LANGUAGES
REFERENCES

Candidate:
Name: ${clean(fullName) || '[Your Name]'}
Email: ${clean(email) || 'your.email@example.com'}
Phone: ${clean(phone) || '+27 00 000 0000'}
Location: ${clean(location) || 'Your City, South Africa'}
Show Profile ID: ${safeShowIdOnCv ? 'Yes' : 'No'}
Profile ID: ${safeShowIdOnCv ? clean(idNumber) : '[do not include]'}
Summary: ${clean(summary) || '[not provided]'}
Experience: ${clean(experience) || '[not provided]'}
Skills: ${clean(skills) || '[not provided]'}
Education: ${clean(education) || '[not provided]'}
Extras: ${clean(extras) || '[not provided]'}`;

    try {
      const out = await callDeepseekChat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens: 900,
      });

      const resumeText = getAiText(out);

      if (resumeText && resumeText.length > 250) {
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
    const { existingCv = '', targetLevel = '', extras = '' } = req.body || {};

    const baseCv = clean(existingCv);

    if (!baseCv) {
      return res.status(400).json({
        ok: false,
        error: 'Provide your current CV text first.',
      });
    }

    const prompt = `Rewrite this CV into a stronger one-page A4 CV.

Rules:
- Professional South African CV.
- Plain text only.
- No markdown.
- No tables.
- Correct grammar.
- Do not invent fake companies, qualifications, licences or job titles.
- Remove unnecessary sensitive personal details.

Target level:
${targetLevel || 'professional'}

Extra notes:
${extras || '[none]'}

Current CV:
${baseCv}`;

    try {
      const out = await callDeepseekChat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens: 900,
      });

      const improvedText = getAiText(out);

      if (improvedText && improvedText.length > 250) {
        return res.json({
          ok: true,
          improvedText,
          pageSize: 'A4',
          layout: 'classic-ats-one-page',
          source: 'deepseek-api',
        });
      }
    } catch (e) {
      console.error('resume-improver deepseek error', e);
    }

    return res.json({
      ok: true,
      improvedText: `IMPROVED CV DRAFT

${baseCv}

NEXT STEPS
- Keep your CV to one A4 page.
- Correct grammar before sending.
- Remove unnecessary sensitive personal details.
- Tailor the CV to each job.`,
      pageSize: 'A4',
      layout: 'classic-ats-one-page',
      source: 'fallback',
    });
  } catch (err) {
    console.error('resume-improver error', err);

    return res.json({
      ok: true,
      improvedText:
        'Paste your current CV again and include your job target, experience, skills, education and languages.',
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

    const canUseAi = isCreatorTier(tier, creatorPlus) || isProTier(tier);

    const baseLetter = `Dear Hiring Manager,

I am interested in applying for the ${jobTitle || 'role'} at ${company || 'your company'}. I believe my skills, attitude and willingness to learn make me a strong candidate for this opportunity.

${resumeSummary || 'I am hardworking, reliable and able to work professionally with a team.'}

${extras || 'I would appreciate the opportunity to be considered for this position.'}

Thank you for considering my application.

Kind regards,
${candidateName || '[Your Name]'}`;

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

    try {
      const out = await callDeepseekChat({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.45,
        max_tokens: 650,
      });

      const letter = getAiText(out);

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
