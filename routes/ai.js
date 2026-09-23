import express from 'express';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| FACEMEX AI ROUTER
|--------------------------------------------------------------------------
|
| GENERAL CHAT
|   Groq -> Gemini -> Cerebras -> OpenRouter -> DeepSeek
|
| HOMEWORK / EXPLANATIONS
|   Gemini -> Groq -> Cerebras -> OpenRouter -> DeepSeek
|
| IMAGE ANALYSIS
|   Gemini Vision
|
| JOB SEARCH
|   Gemini + Google Search
|
| JOB VERIFICATION
|   Gemini + Google Search
|
| CURRENT INFORMATION
|   Gemini + Google Search
|
|--------------------------------------------------------------------------
*/

// ============================================================================
// PROVIDERS
// ============================================================================

const PROVIDERS = {
  gemini: {
    model:
      process.env.GEMINI_MODEL ||
      'gemini-3.6-flash',

    endpoint:
      'https://generativelanguage.googleapis.com/v1beta/models',
  },

  groq: {
    model:
      process.env.GROQ_MODEL ||
      'llama-3.3-70b-versatile',

    endpoint:
      'https://api.groq.com/openai/v1/chat/completions',
  },

  cerebras: {
    model:
      process.env.CEREBRAS_MODEL ||
      'gpt-oss-120b',

    endpoint:
      'https://api.cerebras.ai/v1/chat/completions',
  },

  openrouter: {
    model:
      process.env.OPENROUTER_MODEL ||
      'meta-llama/llama-3.1-8b-instruct',

    endpoint:
      'https://openrouter.ai/api/v1/chat/completions',
  },

  deepseek: {
    model:
      process.env.DEEPSEEK_MODEL ||
      'deepseek-chat',

    endpoint:
      'https://api.deepseek.com/chat/completions',
  },
};

// ============================================================================
// API KEYS
// ============================================================================

function getApiKey(provider) {
  const keys = {
    gemini: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    cerebras: process.env.CEREBRAS_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
  };

  return keys[provider];
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

function getSystemPrompt(task) {
  const base = `
You are FaceMeX AI.

FaceMeX is an AI education, career, jobs and opportunity platform.

Be useful, direct and practical.

Rules:
- Do not invent facts.
- Do not invent jobs.
- Do not invent employers.
- Do not invent application links.
- If you are uncertain, say so.
- Use simple language when possible.
- Answer the user's actual question.
`;

  const prompts = {
    general_chat: `
You are handling general conversation.
Answer naturally and efficiently.
`,

    homework: `
Help the learner understand the problem.
Explain the reasoning and steps.
`,

    lesson_explanation: `
Explain educational material clearly using simple examples.
`,

    workspace: `
Help the user write, plan, organize, summarize and solve tasks.
`,

    job_assistant: `
Help with CVs, applications, interviews and career preparation.
`,

    job_search: `
You are FaceMeX's live job-search assistant.

Use Google Search to find CURRENT job opportunities.

Only report jobs that you can find from real web sources.

For each job, try to provide:
- Job title
- Employer
- Location
- Closing date if available
- Source
- Application URL
- Posting date if available

Never invent a job or application URL.

Clearly distinguish between:
- Found on an official employer/government source
- Found on a legitimate job board
- Could not verify
`,

    job_verification: `
You are FaceMeX's job-verification assistant.

Use Google Search to investigate the job advertisement or job details.

Look for:
- Official employer website
- Official careers page
- Government source
- Reputable recruitment/job board
- Matching job title
- Matching employer
- Matching location
- Matching closing date
- Application URL
- Signs that the advertisement may be suspicious

Do NOT guarantee that a job is legitimate.

Use these labels:

VERIFIED SOURCE
LIKELY LEGITIMATE
NEEDS CAUTION
COULD NOT VERIFY

Explain the evidence behind the label.
`,

    current_information: `
Use Google Search to find current information.
Prefer reliable and primary sources.
`,

    resume_builder: `
Help create a professional CV using only truthful information supplied by the user.
`,

    cover_letter: `
Create a professional, specific cover letter without inventing experience.
`,
  };

  return (
    base +
    (prompts[task] ||
      prompts.general_chat)
  ).trim();
}

// ============================================================================
// MESSAGE NORMALIZATION
// ============================================================================

function normalizeMessages(body = {}) {
  let messages = [];

  if (Array.isArray(body.messages)) {
    messages = body.messages;
  } else if (
    typeof body.message === 'string' &&
    body.message.trim()
  ) {
    messages = [
      {
        role: 'user',
        content: body.message.trim(),
      },
    ];
  } else if (
    typeof body.prompt === 'string' &&
    body.prompt.trim()
  ) {
    messages = [
      {
        role: 'user',
        content: body.prompt.trim(),
      },
    ];
  }

  return messages
    .filter(Boolean)
    .map((message) => ({
      role:
        ['system', 'user', 'assistant'].includes(
          message.role
        )
          ? message.role
          : 'user',

      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(
              message.content || ''
            ),
    }))
    .filter(
      (message) =>
        message.content.trim()
    );
}

// ============================================================================
// CONVERT GEMINI MESSAGES
// ============================================================================

function convertForGemini(messages) {
  let systemInstruction = '';

  const contents = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemInstruction +=
        (systemInstruction ? '\n\n' : '') +
        message.content;

      continue;
    }

    contents.push({
      role:
        message.role === 'assistant'
          ? 'model'
          : 'user',

      parts: [
        {
          text: message.content,
        },
      ],
    });
  }

  return {
    systemInstruction,
    contents,
  };
}

// ============================================================================
// CONVERT OPENAI FORMAT
// ============================================================================

function convertForOpenAI(
  messages,
  systemPrompt
) {
  const output = [];

  if (systemPrompt) {
    output.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  for (const message of messages) {
    if (message.role === 'system') continue;

    output.push({
      role: message.role,
      content: message.content,
    });
  }

  return output;
}

// ============================================================================
// EXTRACT GEMINI TEXT
// ============================================================================

function extractGeminiText(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => part?.text || '')
    .filter(Boolean)
    .join('')
    .trim();
}

// ============================================================================
// EXTRACT OPENAI TEXT
// ============================================================================

function extractOpenAIText(data) {
  const content =
    data?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === 'string'
          ? item
          : item?.text || ''
      )
      .filter(Boolean)
      .join('')
      .trim();
  }

  return '';
}

// ============================================================================
// GEMINI TEXT
// ============================================================================

async function callGemini({
  messages,
  task,
  googleSearch = false,
}) {
  const apiKey =
    getApiKey('gemini');

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured'
    );
  }

  const config =
    PROVIDERS.gemini;

  const converted =
    convertForGemini(messages);

  const systemPrompt =
    getSystemPrompt(task);

  const combinedSystem =
    [
      systemPrompt,
      converted.systemInstruction,
    ]
      .filter(Boolean)
      .join('\n\n');

  const payload = {
    systemInstruction: {
      parts: [
        {
          text: combinedSystem,
        },
      ],
    },

    contents:
      converted.contents.length
        ? converted.contents
        : [
            {
              role: 'user',
              parts: [
                {
                  text: 'Hello',
                },
              ],
            },
          ],

    generationConfig: {
      temperature:
        googleSearch ? 0.2 : 0.7,

      maxOutputTokens:
        googleSearch ? 4000 : 2048,
    },
  };

  /*
   * IMPORTANT:
   * Google Search is ONLY enabled for tasks
   * that actually need live web information.
   */
  if (googleSearch) {
    payload.tools = [
      {
        google_search: {},
      },
    ];
  }

  const url =
    `${config.endpoint}/` +
    `${config.model}:generateContent`;

  console.log(
    `[FaceMeX AI] Gemini ${googleSearch ? '+ Google Search' : ''}`
  );

  const response =
    await fetch(url, {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json',

        'x-goog-api-key':
          apiKey,
      },

      body: JSON.stringify(
        payload
      ),
    });

  const raw =
    await response.text();

  let data;

  try {
    data = raw
      ? JSON.parse(raw)
      : null;
  } catch {
    data = {
      raw,
    };
  }

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${
        data?.error?.message ||
        raw
      }`
    );
  }

  const text =
    extractGeminiText(data);

  if (!text) {
    throw new Error(
      'Gemini returned an empty response'
    );
  }

  return {
    provider: 'gemini',
    model: config.model,
    text,

    groundingMetadata:
      data?.candidates?.[0]
        ?.groundingMetadata || null,
  };
}

// ============================================================================
// GROQ / CEREBRAS / OPENROUTER / DEEPSEEK
// ============================================================================

async function callOpenAIProvider({
  provider,
  messages,
  task,
}) {
  const apiKey =
    getApiKey(provider);

  if (!apiKey) {
    throw new Error(
      `${provider.toUpperCase()}_API_KEY is not configured`
    );
  }

  const config =
    PROVIDERS[provider];

  const payload = {
    model: config.model,

    messages:
      convertForOpenAI(
        messages,
        getSystemPrompt(task)
      ),

    temperature: 0.7,

    max_tokens: 2048,
  };

  const headers = {
    'Content-Type':
      'application/json',

    Authorization:
      `Bearer ${apiKey}`,
  };

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] =
      'https://facemex.online';

    headers['X-Title'] =
      'FaceMeX';
  }

  console.log(
    `[FaceMeX AI] Trying ${provider} / ${config.model}`
  );

  const response =
    await fetch(
      config.endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(
          payload
        ),
      }
    );

  const raw =
    await response.text();

  let data;

  try {
    data = raw
      ? JSON.parse(raw)
      : null;
  } catch {
    data = {
      raw,
    };
  }

  if (!response.ok) {
    throw new Error(
      `${provider} HTTP ${response.status}: ${
        data?.error?.message ||
        raw
      }`
    );
  }

  const text =
    extractOpenAIText(data);

  if (!text) {
    throw new Error(
      `${provider} returned an empty response`
    );
  }

  return {
    provider,
    model: config.model,
    text,
  };
}

// ============================================================================
// GENERAL CHAT
// ============================================================================

async function generalChat({
  messages,
  task = 'general_chat',
}) {
  const providers = [
    'groq',
    'gemini',
    'cerebras',
    'openrouter',
    'deepseek',
  ];

  const errors = [];

  for (const provider of providers) {
    try {
      let result;

      if (provider === 'gemini') {
        result =
          await callGemini({
            messages,
            task,
            googleSearch: false,
          });
      } else {
        result =
          await callOpenAIProvider({
            provider,
            messages,
            task,
          });
      }

      return {
        success: true,

        provider:
          result.provider,

        model:
          result.model,

        content:
          result.text,

        response:
          result.text,

        text:
          result.text,

        attempted: errors,
      };
    } catch (error) {
      console.error(
        `[FaceMeX AI] ${provider} failed:`,
        error.message
      );

      errors.push({
        provider,
        error: error.message,
      });
    }
  }

  throw new Error(
    'All general AI providers failed: ' +
      errors
        .map(
          (e) =>
            `${e.provider}: ${e.error}`
        )
        .join(' | ')
  );
}

// ============================================================================
// LIVE GEMINI SEARCH
// ============================================================================

async function liveGeminiSearch({
  messages,
  task,
}) {
  const result =
    await callGemini({
      messages,
      task,
      googleSearch: true,
    });

  const metadata =
    result.groundingMetadata;

  const sources = [];

  if (
    Array.isArray(
      metadata?.groundingChunks
    )
  ) {
    for (
      const chunk of
      metadata.groundingChunks
    ) {
      if (chunk?.web?.uri) {
        sources.push({
          title:
            chunk.web.title ||
            chunk.web.uri,

          url:
            chunk.web.uri,
        });
      }
    }
  }

  return {
    success: true,

    provider: 'gemini',

    model: result.model,

    content: result.text,

    response: result.text,

    text: result.text,

    sources,

    groundingMetadata:
      metadata || null,
  };
}

// ============================================================================
// TASK DETECTION
// ============================================================================

function detectTask(body) {
  if (
    typeof body.task === 'string' &&
    body.task.trim()
  ) {
    return body.task.trim();
  }

  const text =
    [
      body.message,
      body.prompt,
      ...(Array.isArray(body.messages)
        ? body.messages.map(
            (m) => m?.content || ''
          )
        : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  /*
   * Job searches should go to Gemini + Google Search.
   */

  const jobWords = [
    'job',
    'jobs',
    'vacancy',
    'vacancies',
    'hiring',
    'employment',
    'work opportunity',
    'careers',
    'career opportunity',
    'apply for',
  ];

  const verificationWords = [
    'is this job legit',
    'is this job legitimate',
    'verify this job',
    'verify job',
    'real job',
    'scam job',
    'fake job',
    'legitimate job',
    'is this vacancy real',
  ];

  if (
    verificationWords.some(
      (word) =>
        text.includes(word)
    )
  ) {
    return 'job_verification';
  }

  if (
    jobWords.some(
      (word) =>
        text.includes(word)
    )
  ) {
    return 'job_search';
  }

  return 'general_chat';
}

// ============================================================================
// IMAGE NORMALIZATION
// ============================================================================

function getImageFromBody(body) {
  let image =
    body.image ||
    body.imageData ||
    body.imageBase64 ||
    body.imageUrl ||
    body.url;

  let mimeType =
    body.mimeType ||
    body.mime_type ||
    'image/jpeg';

  if (
    !image &&
    body.attachment
  ) {
    image =
      body.attachment.data ||
      body.attachment.base64 ||
      body.attachment.url;

    mimeType =
      body.attachment.mimeType ||
      body.attachment.mime_type ||
      mimeType;
  }

  if (
    !image &&
    Array.isArray(
      body.attachments
    )
  ) {
    const attachment =
      body.attachments.find(
        (item) =>
          item?.data ||
          item?.base64 ||
          item?.url
      );

    if (attachment) {
      image =
        attachment.data ||
        attachment.base64 ||
        attachment.url;

      mimeType =
        attachment.mimeType ||
        attachment.mime_type ||
        mimeType;
    }
  }

  if (!image) {
    return null;
  }

  return {
    image,
    mimeType,
  };
}

// ============================================================================
// IMAGE PREPARATION
// ============================================================================

async function prepareImage(
  image,
  mimeType
) {
  /*
   * Data URL
   */

  if (
    image.startsWith(
      'data:image/'
    )
  ) {
    const match =
      image.match(
        /^data:(image\/[^;]+);base64,(.+)$/s
      );

    if (!match) {
      throw new Error(
        'Invalid image data URL'
      );
    }

    return {
      base64: match[2],
      mimeType: match[1],
    };
  }

  /*
   * Remote image URL
   */

  if (
    image.startsWith(
      'http://'
    ) ||
    image.startsWith(
      'https://'
    )
  ) {
    const response =
      await fetch(image);

    if (!response.ok) {
      throw new Error(
        `Unable to download image: ${response.status}`
      );
    }

    const contentType =
      response.headers.get(
        'content-type'
      ) || mimeType;

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    return {
      base64:
        buffer.toString(
          'base64'
        ),

      mimeType:
        contentType.split(';')[0],
    };
  }

  /*
   * Raw Base64
   */

  return {
    base64:
      image
        .replace(
          /^data:[^;]+;base64,/i,
          ''
        )
        .replace(/\s/g, ''),

    mimeType:
      mimeType || 'image/jpeg',
  };
}

// ============================================================================
// GEMINI IMAGE ANALYSIS
// ============================================================================

async function imageAnalysis(body) {
  const input =
    getImageFromBody(
      body
    );

  if (!input) {
    throw new Error(
      'No image was provided'
    );
  }

  const apiKey =
    getApiKey('gemini');

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured'
    );
  }

  const prepared =
    await prepareImage(
      input.image,
      input.mimeType
    );

  const prompt =
    body.prompt ||
    body.message ||
    `
Analyze this image carefully.

If it contains text, read and explain
the important information.

If it is a job advertisement, extract:
- employer
- job title
- location
- closing date
- requirements
- application method

Do not claim the job is legitimate
unless it can actually be verified.
    `.trim();

  const config =
    PROVIDERS.gemini;

  const payload = {
    contents: [
      {
        role: 'user',

        parts: [
          {
            text: prompt,
          },

          {
            inlineData: {
              mimeType:
                prepared.mimeType,

              data:
                prepared.base64,
            },
          },
        ],
      },
    ],

    generationConfig: {
      temperature: 0.2,

      maxOutputTokens: 3000,
    },
  };

  const response =
    await fetch(
      `${config.endpoint}/${config.model}:generateContent`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          'x-goog-api-key':
            apiKey,
        },

        body: JSON.stringify(
          payload
        ),
      }
    );

  const raw =
    await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      `Gemini Vision HTTP ${response.status}: ${
        data?.error?.message ||
        raw
      }`
    );
  }

  const text =
    extractGeminiText(data);

  if (!text) {
    throw new Error(
      'Gemini Vision returned an empty response'
    );
  }

  return {
    success: true,

    provider: 'gemini',

    model:
      config.model,

    content: text,

    response: text,

    text,
  };
}

// ============================================================================
// HEALTH
// ============================================================================

router.get(
  '/health',
  (req, res) => {
    const providers = {};

    for (
      const provider of
      Object.keys(PROVIDERS)
    ) {
      providers[provider] = {
        configured:
          Boolean(
            getApiKey(provider)
          ),

        model:
          PROVIDERS[
            provider
          ].model,
      };
    }

    res.json({
      success: true,

      service:
        'FaceMeX AI',

      status:
        'online',

      providers,
    });
  }
);

// ============================================================================
// TEST
// ============================================================================

router.get(
  '/test',
  async (req, res) => {
    try {
      const result =
        await generalChat({
          messages: [
            {
              role: 'user',

              content:
                'Reply with exactly: FaceMeX AI is working.',
            },
          ],

          task:
            'general_chat',
        });

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ============================================================================
// GENERAL REPLY
// ============================================================================

router.post(
  '/reply',
  async (req, res) => {
    try {
      const messages =
        normalizeMessages(
          req.body
        );

      if (!messages.length) {
        return res.status(400).json({
          success: false,
          error:
            'Please provide a message.',
        });
      }

      const task =
        detectTask(
          req.body
        );

      /*
       * JOBS -> GEMINI + GOOGLE SEARCH
       */

      if (
        task === 'job_search' ||
        task ===
          'job_verification' ||
        task ===
          'current_information'
      ) {
        const result =
          await liveGeminiSearch({
            messages,
            task,
          });

        return res.json(
          result
        );
      }

      /*
       * EVERYTHING ELSE -> GROQ FIRST
       */

      const result =
        await generalChat({
          messages,
          task,
        });

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        '[FaceMeX AI] Reply failed:',
        error.message
      );

      return res.status(500).json({
        success: false,

        error:
          error.message,

        content: '',
        response: '',
        text: '',
      });
    }
  }
);

// ============================================================================
// EXPLICIT JOB SEARCH
// ============================================================================

router.post(
  '/job-search',
  async (req, res) => {
    try {
      const messages =
        normalizeMessages(
          req.body
        );

      if (!messages.length) {
        return res.status(400).json({
          success: false,

          error:
            'Please provide a job search.',
        });
      }

      const result =
        await liveGeminiSearch({
          messages,

          task:
            'job_search',
        });

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        '[FaceMeX Jobs] Search failed:',
        error.message
      );

      return res.status(500).json({
        success: false,

        error:
          error.message,

        content: '',
        response: '',
        text: '',
      });
    }
  }
);

// ============================================================================
// EXPLICIT JOB VERIFICATION
// ============================================================================

router.post(
  '/job-verification',
  async (req, res) => {
    try {
      const messages =
        normalizeMessages(
          req.body
        );

      if (!messages.length) {
        return res.status(400).json({
          success: false,

          error:
            'Please provide the job details to verify.',
        });
      }

      const result =
        await liveGeminiSearch({
          messages,

          task:
            'job_verification',
        });

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        '[FaceMeX Jobs] Verification failed:',
        error.message
      );

      return res.status(500).json({
        success: false,

        error:
          error.message,

        content: '',
        response: '',
        text: '',
      });
    }
  }
);

// ============================================================================
// IMAGE ANALYSIS
// ============================================================================

router.post(
  '/image-analysis',
  async (req, res) => {
    try {
      const result =
        await imageAnalysis(
          req.body || {}
        );

      res.json(result);
    } catch (error) {
      console.error(
        '[FaceMeX AI] Image analysis failed:',
        error.message
      );

      res.status(500).json({
        success: false,

        error:
          error.message,

        content: '',
        response: '',
        text: '',
      });
    }
  }
);

// Alias
router.post(
  '/analyze-image',
  async (req, res) => {
    try {
      const result =
        await imageAnalysis(
          req.body || {}
        );

      res.json(result);
    } catch (error) {
      console.error(
        '[FaceMeX AI] Image analysis failed:',
        error.message
      );

      res.status(500).json({
        success: false,

        error:
          error.message,

        content: '',
        response: '',
        text: '',
      });
    }
  }
);

// ============================================================================
// WORKSPACE
// ============================================================================

router.post(
  '/workspace',
  async (req, res) => {
    try {
      const messages =
        normalizeMessages(
          req.body
        );

      const result =
        await generalChat({
          messages,

          task:
            'workspace',
        });

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ============================================================================
// JOB ASSISTANT
// ============================================================================

router.post(
  '/pro/job-assistant',
  async (req, res) => {
    try {
      const messages =
        normalizeMessages(
          req.body
        );

      const result =
        await generalChat({
          messages,

          task:
            'job_assistant',
        });

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ============================================================================
// RESUME
// ============================================================================

router.post(
  '/pro/resume-builder',
  async (req, res) => {
    try {
      const messages =
        normalizeMessages(
          req.body
        );

      const result =
        await generalChat({
          messages,

          task:
            'resume_builder',
        });

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ============================================================================
// COVER LETTER
// ============================================================================

router.post(
  '/pro/cover-letter',
  async (req, res) => {
    try {
      const messages =
        normalizeMessages(
          req.body
        );

      const result =
        await generalChat({
          messages,

          task:
            'cover_letter',
        });

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ============================================================================
// REGISTER
// ============================================================================

export function registerAIRoutes(
  app,
  basePath = '/api/ai'
) {
  app.use(
    basePath,
    router
  );

  console.log(
    `[FaceMeX AI] Routes registered at ${basePath}`
  );
}

export default router;
