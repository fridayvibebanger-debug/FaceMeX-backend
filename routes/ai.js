import { Router } from 'express';
import https from 'https';
import OpenAI from 'openai';

const router = Router();
// Force cloud DeepSeek usage for now to avoid broken local GPT4All constructor
const useLocalAi = false;

async function fetchAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch media: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
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
    if (!parsed) throw new Error('Invalid imageDataUrl');
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
    body: JSON.stringify({ inputs: { image: `data:${mime};base64,${base64}` } }),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(data?.error || `HF error ${resp.status}`);
  }

  // HF can return: [{ generated_text: "..." }] or { generated_text: "..." }
  const caption = Array.isArray(data)
    ? (data?.[0]?.generated_text || data?.[0]?.caption || '')
    : (data?.generated_text || data?.caption || '');
  return String(caption || '').trim();
}

// Generate a post from media (image or video keyframe) + optional user text using DeepSeek
router.post('/post-from-media', async (req, res) => {
  try {
    const {
      text = '',
      postMode = 'social',
      tone = 'auto',
      imageUrl = '',
      imageDataUrl = '',
    } = req.body || {};

    const hasImage = Boolean((imageUrl || '').toString().trim() || (imageDataUrl || '').toString().trim());
    if (!hasImage && !(text || '').toString().trim()) {
      return res.status(400).json({ ok: false, error: 'Provide text and/or imageUrl/imageDataUrl' });
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
    const cleanedText = (text || '').toString().trim();

    const system = `You are FaceMe AI, a world-class social media writer.\n\nWrite ONE post for FaceMe.\nRules:\n- The post MUST match the media description when provided.\n- Do not invent specific facts not supported by the media or text.\n- If mode is professional, write polished and business-appropriate; otherwise write casual and engaging.\n- Include 2–4 relevant hashtags at the end ONLY if it feels natural.\n- Keep it concise (max ~220 characters unless professional mode needs slightly longer).\n- Output plain text only.`;

    const user = `MODE: ${mode}\nTONE: ${tone}\n\nMEDIA_DESCRIPTION: ${caption || '[none]'}\n\nUSER_CONTEXT: ${cleanedText || '[none]'}\n\nGenerate the post now.`;

    if (useLocalAi) {
      const { askChat } = await import('../services/aiService.js');
      const out = await askChat(`${system}\n\n${user}`);
      const post = (out || '').toString().trim();
      return res.json({ ok: true, post, caption, captionSource, source: 'deepseek-local' });
    }

    const out = await callDeepseekChat({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.85,
      max_tokens: 180,
    });
    const post = (out.choices?.[0]?.message?.content || '').trim();
    return res.json({ ok: true, post, caption, captionSource, source: 'deepseek-api' });
  } catch (err) {
    console.error('post-from-media error', err);
    return res.status(500).json({ ok: false, error: err.message || 'post-from-media failed' });
  }
});

// Generate a context-aware comment for a post using DeepSeek
router.post('/comment', async (req, res) => {
  try {
    const {
      postText = '',
      author = '',
      tone = 'friendly',
      length = 'short',
      language = 'auto',
    } = req.body || {};

    const cleanedPost = (postText || '').toString().trim();
    if (!cleanedPost) {
      return res.status(400).json({ ok: false, error: 'postText is required' });
    }

    const maxWords = String(length).toLowerCase() === 'long' ? 45 : 20;
    const authorHint = (author || '').toString().trim();
    const langHint = String(language || 'auto').trim();

    const system = `You are FaceMe AI. Write a high-quality social media comment that directly matches the post content.\n\nRules:\n- Be natural, human, and non-cringe.\n- Do NOT repeat the post verbatim.\n- Do NOT invent facts that are not implied by the post.\n- Keep it ${tone} and supportive (unless the post is negative; then be empathetic).\n- Max ${maxWords} words.\n- No hashtags unless the post explicitly uses hashtags.\n- If the post is a question, answer it briefly and ask one follow-up question.\n- If the post is an achievement, congratulate and ask a relevant question.\n- If the post is emotional, validate feelings and respond gently.\n- Language: ${langHint === 'auto' ? 'match the language of the post' : langHint}.`;

    const user = `POST${authorHint ? ` (by ${authorHint})` : ''}:\n${cleanedPost}\n\nReturn ONLY the comment text.`;

    if (useLocalAi) {
      const { askChat } = await import('../services/aiService.js');
      const out = await askChat(`${system}\n\n${user}`);
      const comment = (out || '').toString().trim();
      return res.json({ ok: true, comment, source: 'deepseek-local' });
    }

    const out = await callDeepseekChat({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.8,
      max_tokens: 120,
    });

    const comment = (out.choices?.[0]?.message?.content || '').trim();
    return res.json({ ok: true, comment, source: 'deepseek-api' });
  } catch (err) {
    console.error('ai comment error', err);
    return res.status(500).json({ ok: false, error: err.message || 'AI comment failed' });
  }
});

router.get('/test', async (req, res) => {
  try {
    let response = '';
    if (useLocalAi) {
      const { askChat } = await import('../services/aiService.js');
      response = await askChat('Say hi, you are connected to DeepSeek.');
    } else {
      const out = await callDeepseekChat({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'user', content: 'Say hi, you are connected to DeepSeek.' },
        ],
      });
      response = out.choices?.[0]?.message?.content || JSON.stringify(out);
    }
    res.json({ success: true, response });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Generate a reply using local DeepSeek via GPT4All
router.post('/reply', async (req, res) => {
  try {
    const { message = '', style = '' } = req.body || {};
    const prompt = `You are a helpful assistant. Follow the user style strictly.\nStyle: ${style}\nReply concisely to: "${message}"`;
    if (useLocalAi) {
      const { askChat } = await import('../services/aiService.js');
      const response = await askChat(prompt);
      return res.json({ success: true, response });
    } else {
      // Cloud path: prefer Llama, fall back to DeepSeek if needed
      try {
        const out = await callLlamaChat({
          messages: [{ role: 'user', content: prompt }],
        });
        const response = out.choices?.[0]?.message?.content || '';
        if (response) {
          return res.json({ success: true, response, source: 'llama-api' });
        }
      } catch (e) {
        console.error('reply llama error', e);
      }

      const out = await callDeepseekChat({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'user', content: prompt },
        ],
      });
      const response = out.choices?.[0]?.message?.content || '';
      return res.json({ success: true, response, source: 'deepseek-api' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

async function callOpenAIChat(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const data = JSON.stringify(payload);

  const options = {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      Authorization: `Bearer ${apiKey}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error?.message || body || 'OpenAI error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function callDeepseekChat(payload) {
  // Prefer explicit DeepSeek key, but allow OPENAI_API_KEY as fallback
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY or OPENAI_API_KEY missing');
  }

  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey,
  });

  const { model, messages, ...rest } = payload || {};

  const completion = await client.chat.completions.create({
    model: model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    messages,
    ...rest,
  });

  return completion;
}

// Generic Llama / OpenAI-compatible chat helper for pro posting tools
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

  const completion = await client.chat.completions.create({
    model: model || process.env.LLAMA_MODEL || 'llama-3.1-8b-instruct',
    messages,
    temperature: typeof process.env.LLAMA_TEMPERATURE !== 'undefined'
      ? Number(process.env.LLAMA_TEMPERATURE)
      : 0.8,
    max_tokens: typeof process.env.LLAMA_MAX_TOKENS !== 'undefined'
      ? Number(process.env.LLAMA_MAX_TOKENS)
      : 512,
    ...rest,
  });

  return completion;
}

// Local DeepSeek GPT4All endpoint
router.post('/deepseek', async (req, res) => {
  try {
    const { prompt = '' } = req.body || {};
    const cleaned = (prompt || '').toString().trim();
    if (!cleaned) {
      return res.status(400).json({ ok: false, error: 'Missing prompt' });
    }

    try {
      if (useLocalAi) {
        const { askChat } = await import('../services/aiService.js');
        const text = await askChat(cleaned);
        return res.json({ ok: true, text, source: 'deepseek-local' });
      } else {
        // Cloud DeepSeek chat
        const out = await callDeepseekChat({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'user', content: cleaned },
          ],
        });
        const text = out.choices?.[0]?.message?.content || '';
        return res.json({ ok: true, text, source: 'deepseek-api' });
      }
    } catch (err) {
      console.error('DeepSeek error', err);
      return res.status(500).json({ ok: false, error: err.message || 'DeepSeek failed' });
    }
  } catch (err) {
    console.error('DeepSeek handler error', err);
    return res.status(500).json({ ok: false, error: 'DeepSeek handler failed' });
  }
});

// Dev endpoints returning mock AI outputs
router.post('/dev/post-enhancer', async (req, res) => {
  try {
    const { text = '' } = req.body || {};
    const prompt = `You are an expert social media copywriter for the FaceMe platform. Rewrite this post to be clearer and more engaging while keeping the same core message and tone.

Requirements:
- Keep it relatively short and scannable.
- Make the first line a strong hook.
- Add 2–4 relevant hashtags on the last line.
- Return plain text only.

Post:
${text || 'Write a short, friendly post for my FaceMe audience.'}`;
    if (useLocalAi) {
      try {
        const { askChat } = await import('../services/aiService.js');
        const out = await askChat(prompt);
        const enhanced = (out || '').trim() || text;
        return res.json({ ok: true, result: enhanced, source: 'deepseek-local' });
      } catch (e) {
        console.error('post-enhancer deepseek error', e);
        // Soft fallback to simple local template
        const enhanced = ` Optimized Post:\n${text.trim() || 'Your post'}\n\nHashtags: #FaceMe #Create #Inspire`;
        return res.json({ ok: true, result: enhanced, source: 'mock-fallback' });
      }
    }
    // Cloud DeepSeek for pro Post Wizard
    try {
      const out = await callDeepseekChat({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      });
      const enhanced = (out.choices?.[0]?.message?.content || '').trim();
      if (enhanced) {
        return res.json({ ok: true, result: enhanced, source: 'deepseek-api' });
      }
    } catch (e) {
      console.error('post-enhancer deepseek api error', e);
    }

    const enhanced = ` Optimized Post:\n${text.trim() || 'Your post'}\n\nHashtags: #FaceMe #Create #Inspire`;
    return res.json({ ok: true, result: enhanced, source: 'mock' });
  } catch (err) {
    console.error('post-enhancer error', err);
    return res.status(500).json({ ok: false, error: 'Post enhancer failed' });
  }
});

router.post('/dev/caption-muse', async (req, res) => {
  try {
    const { topic = '' } = req.body || {};
    const prompt = `You are a playful but professional caption generator for the FaceMe platform.

Generate 3 short, scroll-stopping social captions for:
${topic || 'a moment on FaceMe'}

Requirements:
- Max 1–2 short sentences per caption.
- Make them feel natural, not like ads.
- Add 1–3 relevant hashtags in some captions.
- Return plain text ONLY, one caption per line, no numbering, no JSON.`;
    if (useLocalAi) {
      try {
        const { askChat } = await import('../services/aiService.js');
        const out = await askChat(prompt);
        const lines = (out || '')
          .split(/\r?\n/)
          .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
          .filter(Boolean);
        const captions = lines.slice(0, 3);
        if (captions.length) {
          return res.json({ ok: true, suggestions: captions, source: 'deepseek-local' });
        }
      } catch (e) {
        console.error('caption-muse deepseek error', e);
      }
    }
    // Cloud DeepSeek for Caption Muse
    try {
      const out = await callDeepseekChat({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      });
      const lines = (out.choices?.[0]?.message?.content || '')
        .split(/\r?\n/)
        .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
        .filter(Boolean);
      const captions = lines.slice(0, 3);
      if (captions.length) {
        return res.json({ ok: true, suggestions: captions, source: 'deepseek-api' });
      }
    } catch (e) {
      console.error('caption-muse deepseek api error', e);
    }

    const captions = [
      ` ${topic || 'This moment'}, but make it unforgettable.`,
      `Vibes set. ${topic || 'Let’s go.'} #FaceMe`,
      `Your daily spark: ${topic || 'creativity'} #Create #Inspire`,
    ];
    return res.json({ ok: true, suggestions: captions, source: 'mock' });
  } catch (err) {
    console.error('caption-muse error', err);
    return res.status(500).json({ ok: false, error: 'Caption Muse failed' });
  }
});

router.post('/dev/trend-finder', async (req, res) => {
  try {
    const { niche = 'general' } = req.body || {};
    const prompt = `You are a trend analyst for creators on FaceMe.

For the niche: "${niche}"

Give 5 trending hashtags with an estimated popularity score from 0–100.

Format:
1) #hashtag - score
2) #hashtag - score
...

Return plain text only, no JSON.`;

    // Try local AI first if enabled
    if (useLocalAi) {
      try {
        const { askUtility } = await import('../services/aiService.js');
        const out = await askUtility(prompt);
        const lines = (out || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const trends = lines
          .map((l) => l.replace(/^\d+[).\s]*/, ''))
          .map((l) => {
            const match = l.match(/(#\S+)\s*[-–]\s*(\d+)/);
            if (!match) return null;
            return { tag: match[1], score: Number(match[2]) };
          })
          .filter(Boolean)
          .slice(0, 5);
        if (trends.length) {
          return res.json({ ok: true, niche, trends, source: 'deepseek-local' });
        }
      } catch (e) {
        console.error('trend-finder local error', e);
      }
    }

    // Cloud DeepSeek for Trend Finder
    try {
      const out = await callDeepseekChat({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      });
      const lines = (out.choices?.[0]?.message?.content || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const trends = lines
        .map((l) => l.replace(/^\d+[).\s]*/, ''))
        .map((l) => {
          const match = l.match(/(#\S+)\s*[-–]\s*(\d+)/);
          if (!match) return null;
          return { tag: match[1], score: Number(match[2]) };
        })
        .filter(Boolean)
        .slice(0, 5);
      if (trends.length) {
        return res.json({ ok: true, niche, trends, source: 'deepseek-api' });
      }
    } catch (e) {
      console.error('trend-finder deepseek api error', e);
    }

    const trends = [
      { tag: '#AI', score: 96 },
      { tag: '#Wellness', score: 88 },
      { tag: '#LiveEvents', score: 83 },
    ];
    return res.json({ ok: true, niche, trends, source: 'mock' });
  } catch (err) {
    console.error('trend-finder error', err);
    return res.status(500).json({ ok: false, error: 'Trend Finder failed' });
  }
});

// Creator+ Assistant: returns coaching tips and content ideas (mock)
router.post('/dev/assistant', async (req, res) => {
  try {
    const { goal = 'grow audience', audience = 'general', topic = 'content' } = req.body || {};
    const prompt = `You are a concise creator and professional coach for the FaceMe social platform.\nUser goal: ${goal}. Audience: ${audience}. Topic: ${topic}.\nGive 3 short coaching tips and 3 concrete content ideas.\nRespond as plain text with two sections:\nTips:\n- tip1\n- tip2\n- tip3\nIdeas:\n- idea1\n- idea2\n- idea3`;

    if (useLocalAi) {
      try {
        const { askChat } = await import('../services/aiService.js');
        const out = await askChat(prompt);
        const lines = (out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const tips = [];
        const ideas = [];
        let mode = 'tips';
        for (const l of lines) {
          if (/^ideas\s*:/i.test(l)) { mode = 'ideas'; continue; }
          if (/^tips\s*:/i.test(l)) { mode = 'tips'; continue; }
          const clean = l.replace(/^[-*\d.\s]+/, '').trim();
          if (!clean) continue;
          if (mode === 'tips') tips.push(clean);
          else ideas.push(clean);
        }
        return res.json({ ok: true, goal, audience, topic, tips: tips.slice(0, 3), ideas: ideas.slice(0, 3), source: 'deepseek-local' });
      } catch (e) {
        console.error('assistant deepseek local error', e);
        // fall through to cloud/mocks
      }
    } else {
      // Cloud Creator Assistant: use DeepSeek when available
      try {
        const out = await callDeepseekChat({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
        });
        const lines = (out.choices?.[0]?.message?.content || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const tips = [];
        const ideas = [];
        let mode = 'tips';
        for (const l of lines) {
          if (/^ideas\s*:/i.test(l)) { mode = 'ideas'; continue; }
          if (/^tips\s*:/i.test(l)) { mode = 'tips'; continue; }
          const clean = l.replace(/^[-*\d.\s]+/, '').trim();
          if (!clean) continue;
          if (mode === 'tips') tips.push(clean);
          else ideas.push(clean);
        }
        if (tips.length || ideas.length) {
          return res.json({ ok: true, goal, audience, topic, tips: tips.slice(0, 3), ideas: ideas.slice(0, 3), source: 'deepseek-api' });
        }
      } catch (e) {
        console.error('assistant deepseek cloud error', e);
        // fall through to mock
      }
    }

    // Fallback to simple mock data if local AI is not enabled or fails
    const tips = [
      `Keep ${topic} concise and value-packed for ${audience}.`,
      `Use a clear hook in the first 2 seconds to boost retention.`,
      `End with a question to spark comments and save/follow intent.`,
    ];
    const ideas = [
      `A quick how-to about ${topic} with 3 actionable steps.`,
      `Behind-the-scenes: your process for ${topic}.`,
      `Myth-busting ${topic}: 3 things most people get wrong.`,
    ];
    return res.json({ ok: true, goal, audience, topic, tips, ideas, source: 'mock' });
  } catch (err) {
    console.error('Assistant error', err);
    return res.status(500).json({ ok: false, error: 'Assistant failed' });
  }
});

// Professional profile tools - AI CV Builder
router.post('/pro/resume-builder', async (req, res) => {
  try {
    const {
      fullName = '',
      email = '',
      phone = '',
      location = '',
      idNumber = '',
      summary = '',
      experience = '',
      skills = '',
      education = '',
      extras = '',
      tier = 'free',
      creatorPlus,
    } = req.body || {};

    const personal = `Name: ${fullName || '[Your Name]'}\nEmail: ${email || 'your.email@example.com'}\nPhone: ${phone || '+0 000 000 0000'}\nLocation: ${location || 'Your City, Country'}\nID: ${idNumber || '[ID / Profile ID]'}`;
    const cvNotes = `Summary:\n${summary}\n\nExperience:\n${experience}\n\nSkills:\n${skills}\n\nEducation:\n${education}\n\nExtras:\n${extras}`;

    const prompt = `You are a professional CV writer for the FaceMe platform. Using the structured details below, write a complete, start-to-finish CV in English.\n\nRequirements:\n- Start with a clean header that clearly shows the candidate name and contact details.\n- Include the ID as a reference field in the header or an "ID" line.\n- Include clear sections: PROFESSIONAL SUMMARY, EXPERIENCE, SKILLS, EDUCATION. Optionally add ADDITIONAL INFORMATION for extras.\n- Use bullet points for responsibilities and achievements under each role.\n- Make it ATS-friendly, concise, and easy to copy-paste.\n- If the input is very short or weak, gently expand with realistic but generic wording so the CV still feels complete.\n- Keep the CV length suitable for about 1–2 pages only (do not write more than roughly two pages of content).\n- Return plain text only (no markdown, no JSON).\n\nPERSONAL DETAILS:\n${personal}\n\nCANDIDATE NOTES:\n${cvNotes}`;

    if (useLocalAi) {
      try {
        const { askChat } = await import('../services/aiService.js');
        const out = await askChat(prompt);
        let cvText = (out || '').trim();

        // If DeepSeek returns nothing or a very short answer, fall back to a full template
        if (!cvText || cvText.length < 400) {
          cvText = `NAME\n${fullName || '[Your Name]'}\n\nCONTACT\nEmail: ${email || 'your.email@example.com'}\nPhone: ${phone || '+0 000 000 0000'}\nLocation: ${location || 'Your City, Country'}\nID: ${idNumber || '[ID / Profile ID]'}\n\nPROFESSIONAL SUMMARY\n${
            summary ||
            'Add a short 3–4 line summary about your background, strengths, achievements, and career goals.'
          }\n\nEXPERIENCE\n${
            experience ||
            '- Role Title | Company | Dates\n  • Add 3–5 bullet points describing your impact and achievements.\n- Role Title | Company | Dates\n  • Add more roles and projects that show your value.'
          }\n\nSKILLS\n${
            skills ||
            'List 6–10 core skills that match your ideal roles, separated by commas (e.g. React, UX Design, Team Leadership).'
          }\n\nEDUCATION\n${
            education ||
            '- School or Program Name | Degree or Certificate | Dates\n  • Add your most relevant education, bootcamps, or certifications.'
          }\n\nADDITIONAL INFORMATION\n${
            extras ||
            '- Add languages, volunteer work, awards, side projects, or links that support your profile.'
          }`;
        }

        return res.json({ ok: true, resumeText: cvText, source: 'deepseek-local' });
      } catch (e) {
        console.error('resume-builder deepseek error', e);
      }
    } else {
      try {
        const out = await callDeepseekChat({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'user', content: prompt },
          ],
        });
        let cvText = (out.choices?.[0]?.message?.content || '').trim();

        // If DeepSeek returns nothing or a very short answer, fall back to a full template
        if (!cvText || cvText.length < 400) {
          cvText = `NAME\n${fullName || '[Your Name]'}\n\nCONTACT\nEmail: ${email || 'your.email@example.com'}\nPhone: ${phone || '+0 000 000 0000'}\nLocation: ${location || 'Your City, Country'}\nID: ${idNumber || '[ID / Profile ID]'}\n\nPROFESSIONAL SUMMARY\n${
            summary ||
            'Add a short 3–4 line summary about your background, strengths, achievements, and career goals.'
          }\n\nEXPERIENCE\n${
            experience ||
            '- Role Title | Company | Dates\n  • Add 3–5 bullet points describing your impact and achievements.\n- Role Title | Company | Dates\n  • Add more roles and projects that show your value.'
          }\n\nSKILLS\n${
            skills ||
            'List 6–10 core skills that match your ideal roles, separated by commas (e.g. React, UX Design, Team Leadership).'
          }\n\nEDUCATION\n${
            education ||
            '- School or Program Name | Degree or Certificate | Dates\n  • Add your most relevant education, bootcamps, or certifications.'
          }\n\nADDITIONAL INFORMATION\n${
            extras ||
            '- Add languages, volunteer work, awards, side projects, or links that support your profile.'
          }`;
        }

        return res.json({ ok: true, resumeText: cvText, source: 'deepseek-api' });
      } catch (e) {
        console.error('resume-builder deepseek api error', e);
      }
    }

    const resumeText = `NAME
${fullName || '[Your Name]'}

CONTACT DETAILS
Email: ${email || 'your.email@example.com'}
Phone: ${phone || '+0 000 000 0000'}
Location: ${location || 'Your City, Country'}
ID / PROFILE: ${idNumber || '[ID / Profile ID]'}

PROFILE / SUMMARY
${
    summary ||
    'Motivated candidate looking to grow in a professional environment. Highlight 3–4 lines about your strengths, tools you use, and the kind of roles you want (for example: junior developer, marketing assistant, creator, customer support, etc.).'
  }

KEY SKILLS
${
    skills ||
    'List 6–10 skills that fit the jobs you want, separated by commas. For example: Communication, Customer Service, MS Office, Social Media, Problem Solving, Time Management.'
  }

EXPERIENCE
${
    experience ||
    'Role Title | Company Name | City | 2022 – Present\n' +
    '• Support daily tasks for the team and make sure work is delivered on time.\n' +
    '• Communicate with customers or stakeholders in a friendly and professional way.\n' +
    '• Learn new tools quickly and help improve small processes.\n\n' +
    'Role Title | Company Name | City | 2020 – 2022\n' +
    '• Assisted senior team members with projects and reports.\n' +
    '• Worked with basic tools (e.g. email, spreadsheets, social media) to complete tasks.\n' +
    '• Showed reliability by arriving on time and completing assigned work.'
  }

EDUCATION
${
    education ||
    'School or Program Name | City | Year Completed\n' +
    '• Briefly mention your highest level of education, key subjects, or any short courses or bootcamps you have done.'
  }

ADDITIONAL INFORMATION
${
    extras ||
    'Languages: list any languages you speak.\n' +
    'Projects / Volunteering: mention small projects, side hustles, or community work.\n' +
    'Links: add links to online profiles or portfolios if you have them.'
  }

TIP
This is a strong starter CV. For a more advanced, recruiter-style rewrite with sharper wording, you can upgrade using the AI CV Upgrade (Creator+) tool in FaceMe.`;
    return res.json({ ok: true, resumeText, source: 'mock' });
  } catch (err) {
    console.error('resume-builder error', err);
    // Final safety net: never break the client, always return a usable CV
    const fallback = `NAME\n[Your Name]\n\nCONTACT\nEmail: your.email@example.com\nPhone: +0 000 000 0000\nLocation: Your City, Country\nID: [ID / Profile ID]\n\nPROFESSIONAL SUMMARY\nAdd a short 3–4 line summary about your background, strengths, achievements, and career goals.\n\nEXPERIENCE\n- Role Title | Company | Dates\n  • Add 3–5 bullet points describing your impact and achievements.\n- Role Title | Company | Dates\n  • Add more roles and projects that show your value.\n\nSKILLS\nList 6–10 core skills that match your ideal roles, separated by commas (e.g. React, UX Design, Team Leadership).\n\nEDUCATION\n- School or Program Name | Degree or Certificate | Dates\n  • Add your most relevant education, bootcamps, or certifications.\n\nADDITIONAL INFORMATION\n- Add languages, volunteer work, awards, side projects, or links that support your profile.`;
    return res.json({ ok: true, resumeText: fallback, source: 'error-fallback' });
  }
});

// Professional profile tools - AI CV Improver (for Creator+ tiers)
router.post('/pro/resume-improver', async (req, res) => {
  try {
    const {
      existingCv = '',
      targetLevel = '',
      extras = '',
      tier = 'free',
      creatorPlus,
    } = req.body || {};

    const baseCv = (existingCv || '').toString().trim();

    if (!baseCv) {
      return res.status(400).json({ ok: false, error: 'Provide your current CV text first.' });
    }

    const level = (targetLevel || 'professional').toString();
    const notes = (extras || '').toString();

    const isCreatorPlus = String(tier || '').toLowerCase() === 'creator+' || creatorPlus === true || String(tier || '').toLowerCase() === 'business';

    const prompt = `You are a senior CV and career coach helping creators and professionals on the FaceMe platform.
The user pasted their CURRENT CV below. Your job is to REWRITE it into a stronger, modern CV suitable for a ${level} role.

Requirements:
- Keep all true facts but rewrite language to be confident and outcome-focused.
- Improve structure and clarity but keep it easy to copy-paste into job portals.
- Use clear section headings (for example: PROFESSIONAL SUMMARY, EXPERIENCE, SKILLS, EDUCATION, ADDITIONAL INFORMATION if needed).
- Use bullet points under roles that highlight measurable impact where possible.
- If the CV is very short or weak, gently expand it with realistic, generic but helpful phrasing so it still feels believable.
- Keep the final CV length suitable for about 1–2 pages only (do not write more than roughly two pages of content).
- Return plain text only (no markdown, no JSON).

Extra guidance from user (optional):
${notes || '[none]'}

CURRENT CV:
${baseCv}`;

    // Free tiers: do not call DeepSeek, return guided draft
    if (!isCreatorPlus) {
      const improvedText = `IMPROVED CV DRAFT\n\nThis is an upgraded version of your CV. It keeps your original information but uses clearer structure and stronger wording.\n\n${baseCv}\n\nNEXT STEPS\n- Add more detail to roles where impact is not clear.\n- Make sure dates, job titles, and tools are accurate.\n- Tailor this CV to each job description by adjusting the summary and top skills.`;
      return res.json({ ok: true, improvedText, source: 'free-template' });
    }

    if (useLocalAi) {
      try {
        const { askChat } = await import('../services/aiService.js');
        const out = await askChat(prompt);
        let improved = (out || '').trim();

        if (!improved || improved.length < 400) {
          improved = `IMPROVED CV DRAFT\n\nThis is an upgraded version of your CV. It keeps your original information but uses clearer structure and stronger wording.\n\n${baseCv}\n\nNEXT STEPS\n- Add more detail to roles where impact is not clear.\n- Make sure dates, job titles, and tools are accurate.\n- Tailor this CV to each job description by adjusting the summary and top skills.`;
        }

        return res.json({ ok: true, improvedText: improved, source: 'deepseek-local' });
      } catch (e) {
        console.error('resume-improver deepseek error', e);
      }
    } else {
      try {
        const out = await callDeepseekChat({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'user', content: prompt },
          ],
        });
        let improved = (out.choices?.[0]?.message?.content || '').trim();

        if (!improved || improved.length < 400) {
          improved = `IMPROVED CV DRAFT\n\nThis is an upgraded version of your CV. It keeps your original information but uses clearer structure and stronger wording.\n\n${baseCv}\n\nNEXT STEPS\n- Add more detail to roles where impact is not clear.\n- Make sure dates, job titles, and tools are accurate.\n- Tailor this CV to each job description by adjusting the summary and top skills.`;
        }

        return res.json({ ok: true, improvedText: improved, source: 'deepseek-api' });
      } catch (e) {
        console.error('resume-improver deepseek api error', e);
      }
    }

    const improvedText = `IMPROVED CV DRAFT\n\nThis is an upgraded version of your CV. It keeps your original information but uses clearer structure and stronger wording.\n\n${baseCv}\n\nNEXT STEPS\n- Add more detail to roles where impact is not clear.\n- Make sure dates, job titles, and tools are accurate.\n- Tailor this CV to each job description by adjusting the summary and top skills.`;
    return res.json({ ok: true, improvedText, source: useLocalAi ? 'mock-fallback' : 'mock' });
  } catch (err) {
    console.error('resume-improver error', err);
    const fallback = 'IMPROVED CV DRAFT\n\nPaste your current CV again and add more detail about your roles, achievements, tools, and education. Focus each bullet on what you delivered, not only what you were responsible for.';
    return res.json({ ok: true, improvedText: fallback, source: 'error-fallback' });
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

    console.log('cover-letter body', req.body);

    const isCreatorPlus = String(tier || '').toLowerCase() === 'creator+' || creatorPlus === true;
    const nameLine = candidateName || '[Your Name]';
    const baseLetter = `Dear Hiring Manager,\n\nI am excited to apply for the ${jobTitle || 'role'} at ${
      company || 'your company'
    }. I believe my background and skills make me a strong fit for this opportunity.\n\n${
      resumeSummary ||
      'In this paragraph, briefly describe 2–3 of your strongest experiences or achievements that match the role. Mention tools, industries, or results where possible.'
    }\n\n${
      extras ||
      'You can also mention cultural fit, motivation to join the company, or how this role connects to your long‑term goals.'
    }\n\nThank you for considering my application. I would welcome the chance to discuss how I can contribute to your team.\n\nSincerely,\n${nameLine}`;

    // Free tier: always return template, never call AI
    if (!isCreatorPlus) {
      const finalLetter = baseLetter.replace('[Your Name]', nameLine);
      return res.json({ ok: true, letter: finalLetter, source: 'free-template' });
    }

    // Creator+ with local or cloud AI
    try {
      const prompt = `You are a professional cover letter writer helping creators and professionals on the FaceMe platform.\nWrite a concise, 3–5 paragraph cover letter in English for the role "${
        jobTitle || 'a relevant role'
      }" at "${company || 'the company'}".\n\nUse this candidate summary and notes as the base:\n${
        resumeSummary || '[No summary provided, infer a reasonable but generic summary from context.]'
      }\n\nExtra notes from candidate (optional):\n${extras || '[none]'}\n\nRequirements:\n- Keep it friendly but professional.\n- Focus on specific strengths and outcomes, not just responsibilities.\n- Make it easy to copy-paste into job portals.\n- Keep the length suitable for a single A4 page.\n- Return only the letter text, no markdown, no JSON.`;

      let letter = '';
      if (useLocalAi) {
        const { askChat } = await import('../services/aiService.js');
        const out = await askChat(prompt);
        letter = (out || '').trim();
        if (letter) {
          return res.json({ ok: true, letter, source: 'deepseek-local-creator+' });
        }
      } else {
        // Cloud: prefer Llama, fall back to DeepSeek
        try {
          const out = await callLlamaChat({
            messages: [{ role: 'user', content: prompt }],
          });
          letter = (out.choices?.[0]?.message?.content || '').trim();
          if (letter) {
            return res.json({ ok: true, letter, source: 'llama-api-creator+' });
          }
        } catch (e) {
          console.error('cover-letter llama error', e);
        }

        const out = await callDeepseekChat({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'user', content: prompt },
          ],
        });
        letter = (out.choices?.[0]?.message?.content || '').trim();
        if (letter) {
          return res.json({ ok: true, letter, source: 'deepseek-api-creator+' });
        }
      }
    } catch (e) {
      console.error('cover-letter deepseek/llama error', e);
    }

    // Fallback for Creator+ if AI fails or returns nothing
    return res.json({ ok: true, letter: baseLetter, source: 'creator-template-fallback' });
  } catch (err) {
    console.error('cover-letter error', err);
    // Final safety net: always return a usable letter instead of failing
    const letter = `Dear Hiring Manager,\n\nThank you for reviewing my application. I am very interested in this opportunity and believe my skills and experience could be a strong match.\n\nI look forward to the possibility of discussing how I can contribute to your team.\n\nSincerely,\n${candidateName || '[Your Name]'}`;
    return res.json({ ok: true, letter, source: 'error-fallback' });
  }
});

// Advanced job assistant - structured strategies
router.post('/pro/job-assistant', async (req, res) => {
  try {
    const {
      role = '',
      location = '',
      preferences = '',
      experienceLevel = '',
      industry = '',
      workMode = '',
      hoursPerWeek = '',
      tier = 'free',
      creatorPlus,
    } = req.body || {};

    const isCreatorPlus =
      String(tier || '').toLowerCase() === 'creator+' ||
      creatorPlus === true ||
      ['creator', 'business', 'exclusive'].includes(String(tier || '').toLowerCase());

    const prompt = `You are a practical job search coach helping a user on the FaceMe platform. Give advanced, realistic advice.

User context:
- Target role: ${role || 'open to roles'}
- Experience level: ${experienceLevel || 'not specified'}
- Industry: ${industry || 'any'}
- Preferred location: ${location || 'remote or flexible'}
- Work mode: ${workMode || 'any (remote/hybrid/on-site)'}
- Weekly time available for job search (hours): ${hoursPerWeek || 'not specified'}
- Extra preferences: ${preferences || 'not specified'}

Return 5 numbered strategies. Each item must focus on ONE of these areas (in order):
1) Role focus & target job titles (which roles and where to search).
2) CV / profile improvements (CV, FaceMe, LinkedIn or portfolio).
3) Application strategy (how many applications, how to tailor, which platforms).
4) Networking & outreach (who to contact and how).
5) Weekly routine based on their available hours (a simple schedule with concrete actions).

Format:
- Respond as plain text.
- Use a numbered list from 1. to 5.
- Each item should be 2–4 sentences with concrete, actionable steps.
- Do NOT output any markdown or JSON.`;

    // Free tiers: return template suggestions only, no DeepSeek calls
    if (!isCreatorPlus) {
      const baseRole = role || 'relevant roles';
      const baseLocation = location || 'your preferred regions';
      const level = experienceLevel || 'your current level';
      const sector = industry || 'your chosen industry or nearby areas';
      const mode = workMode || 'remote or on-site roles';
      const hours = hoursPerWeek || '5–8';

      const suggestions = [
        `Clarify your target path by writing down 2–3 job titles that fit ${level} in ${sector} (for example: ${baseRole}). Use those exact titles when searching on major job boards in ${baseLocation}, and save alerts for each so new roles land in your inbox automatically.`,
        'Upgrade your CV and online profiles by matching the top 5–8 skills and responsibilities that keep appearing in job descriptions. Make sure your headline, summary, and first bullets clearly show tools, results, and industries that match those roles.',
        `Decide on a realistic application target (for example 5–10 focused applications per week). Prioritize roles that match at least 70% of your skills, and always tweak the first paragraph of your CV summary or cover letter to mirror the main requirements of each posting.`,
        'Build a short outreach list: previous colleagues, classmates, and people working in teams or companies you like. Send friendly, specific messages asking for quick advice or a 10–15 minute chat instead of directly asking for a job, and share a short summary of the roles you are exploring.',
        `Design a simple weekly routine for about ${hours} hours: 1) review and save promising roles, 2) send tailored applications, 3) do 2–3 outreach messages, and 4) spend at least 30 minutes improving your CV or profile. Repeat this cycle every week and track progress in a simple notes app or spreadsheet.`,
      ];
      return res.json({ ok: true, suggestions, source: 'free-template' });
    }

    if (useLocalAi) {
      try {
        const { askUtility } = await import('../services/aiService.js');
        const out = await askUtility(prompt);
        const lines = (out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const numbered = lines.filter((l) => /^\d+\./.test(l)).slice(0, 5);
        const cleaned = numbered.length
          ? numbered.map((l) => l.replace(/^\d+\.\s*/, '').trim())
          : lines.slice(0, 5);
        if (cleaned.length) {
          return res.json({ ok: true, suggestions: cleaned, source: 'deepseek-local' });
        }
      } catch (e) {
        console.error('job-assistant deepseek error', e);
      }
    } else {
      try {
        const out = await callDeepseekChat({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'user', content: prompt },
          ],
        });
        const lines = (out.choices?.[0]?.message?.content || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const numbered = lines.filter((l) => /^\d+\./.test(l)).slice(0, 5);
        const cleaned = numbered.length
          ? numbered.map((l) => l.replace(/^\d+\.\s*/, '').trim())
          : lines.slice(0, 5);
        if (cleaned.length) {
          return res.json({ ok: true, suggestions: cleaned, source: 'deepseek-api' });
        }
      } catch (e) {
        console.error('job-assistant deepseek api error', e);
      }
    }

    const baseRole = role || 'relevant roles';
    const baseLocation = location || 'your preferred regions';
    const level = experienceLevel || 'your current level';
    const sector = industry || 'your chosen industry or nearby areas';
    const mode = workMode || 'remote or on-site roles';
    const hours = hoursPerWeek || '5–8';

    const suggestions = [
      `Clarify your target path by writing down 2–3 job titles that fit ${level} in ${sector} (for example: ${baseRole}). Use those exact titles when searching on major job boards in ${baseLocation}, and save alerts for each so new roles land in your inbox automatically.`,
      'Upgrade your CV and online profiles by matching the top 5–8 skills and responsibilities that keep appearing in job descriptions. Make sure your headline, summary, and first bullets clearly show tools, results, and industries that match those roles.',
      `Decide on a realistic application target (for example 5–10 focused applications per week). Prioritize roles that match at least 70% of your skills, and always tweak the first paragraph of your CV summary or cover letter to mirror the main requirements of each posting.`,
      'Build a short outreach list: previous colleagues, classmates, and people working in teams or companies you like. Send friendly, specific messages asking for quick advice or a 10–15 minute chat instead of directly asking for a job, and share a short summary of the roles you are exploring.',
      `Design a simple weekly routine for about ${hours} hours: 1) review and save promising roles, 2) send tailored applications, 3) do 2–3 outreach messages, and 4) spend at least 30 minutes improving your CV or profile. Repeat this cycle every week and track progress in a simple notes app or spreadsheet.`,
    ];
    return res.json({ ok: true, suggestions, source: useLocalAi ? 'mock-fallback' : 'mock' });
  } catch (err) {
    console.error('job-assistant error', err);
    const suggestions = [
      'Write down 2–3 job titles that fit the kind of work you want and use those exact titles when searching on job boards.',
      'Review a few job descriptions and update your CV headline and top bullets so they mention the same skills and tools.',
      'Set a weekly target for how many focused applications you will send, and track them in a simple list so you can follow up.',
      'Each week, message a few people in your network or industry to ask for advice, feedback, or pointers to opportunities.',
      'Block specific time slots in your calendar for job search tasks so it becomes a repeatable routine instead of random effort.',
    ];
    return res.json({ ok: true, suggestions, source: 'error-fallback' });
  }
});

router.post('/translate', async (req, res) => {
  try {
    const { text = '', targetLang = 'en', sourceLang } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing text' });
    }
    const prompt = `You are a translation engine. Translate the text into the requested target language. Preserve meaning and tone.\nReturn ONLY the translated text, no extra words.\nSource: ${sourceLang || 'auto'}\nTarget: ${targetLang}\nText:\n${text}`;
    try {
      if (useLocalAi) {
        const { askUtility } = await import('../services/aiService.js');
        console.log('[AI] translate -> local utility');
        const out = await askUtility(prompt);
        const translated = (out || '').trim();
        return res.json({ ok: true, translated: translated || text, source: 'local-utility' });
      }

      // DeepSeek cloud translation when local AI is disabled
      const out = await callDeepseekChat({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'user', content: prompt },
        ],
      });
      const translated = (out.choices?.[0]?.message?.content || '').trim();
      return res.json({ ok: true, translated: translated || text, source: 'deepseek-api' });
    } catch (e) {
      console.error('translate error', e);
      return res.json({ ok: true, translated: text, source: 'fallback' });
    }
  } catch (err) {
    console.error('AI translate error', err);
    // Final fallback to avoid breaking the client
    return res.json({ ok: true, translated: text, source: 'fallback-error' });
  }
});

export default router;
