import express from 'express';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| FaceMeX AI Router
|--------------------------------------------------------------------------
| Stable version
|
| Primary:
|   Gemini
|
| Fallbacks:
|   Groq
|   Cerebras
|   OpenRouter
|   DeepSeek
|
| IMPORTANT:
| Keep this version stable before adding multimodal/search features.
|--------------------------------------------------------------------------
*/

// -----------------------------------------------------------------------------
// PROVIDER ORDER
// -----------------------------------------------------------------------------

const PROVIDER_ORDER = [
  'gemini',
  'groq',
  'cerebras',
  'openrouter',
  'deepseek',
];

// -----------------------------------------------------------------------------
// PROVIDER CONFIG
// -----------------------------------------------------------------------------

function getProviderConfig(provider) {
  switch (provider) {
    case 'gemini':
      return {
        name: 'gemini',
        model:
          process.env.GEMINI_MODEL ||
          'gemini-3.6-flash',

        endpoint:
          'https://generativelanguage.googleapis.com/v1beta/models',
      };

    case 'groq':
      return {
        name: 'groq',
        model:
          process.env.GROQ_MODEL ||
          'llama-3.3-70b-versatile',

        endpoint:
          'https://api.groq.com/openai/v1/chat/completions',
      };

    case 'cerebras':
      return {
        name: 'cerebras',
        model:
          process.env.CEREBRAS_MODEL ||
          'gpt-oss-120b',

        endpoint:
          'https://api.cerebras.ai/v1/chat/completions',
      };

    case 'openrouter':
      return {
        name: 'openrouter',
        model:
          process.env.OPENROUTER_MODEL ||
          'meta-llama/llama-3.1-8b-instruct',

        endpoint:
          'https://openrouter.ai/api/v1/chat/completions',
      };

    case 'deepseek':
      return {
        name: 'deepseek',
        model:
          process.env.DEEPSEEK_MODEL ||
          'deepseek-chat',

        endpoint:
          'https://api.deepseek.com/chat/completions',
      };

    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// API KEY
// -----------------------------------------------------------------------------

function getProviderApiKey(provider) {
  switch (provider) {
    case 'gemini':
      return process.env.GEMINI_API_KEY;

    case 'groq':
      return process.env.GROQ_API_KEY;

    case 'cerebras':
      return process.env.CEREBRAS_API_KEY;

    case 'openrouter':
      return process.env.OPENROUTER_API_KEY;

    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY;

    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// MESSAGE NORMALIZATION
// -----------------------------------------------------------------------------

function normalizeMessages(body = {}) {
  let messages = [];

  if (Array.isArray(body.messages)) {
    messages = body.messages;
  } else if (typeof body.message === 'string' && body.message.trim()) {
    messages = [
      {
        role: 'user',
        content: body.message.trim(),
      },
    ];
  } else if (typeof body.prompt === 'string' && body.prompt.trim()) {
    messages = [
      {
        role: 'user',
        content: body.prompt.trim(),
      },
    ];
  }

  return messages
    .filter(Boolean)
    .map((message) => {
      let role = message.role || 'user';

      if (!['system', 'user', 'assistant'].includes(role)) {
        role = 'user';
      }

      let content = message.content;

      if (content === undefined || content === null) {
        content = '';
      }

      if (typeof content !== 'string') {
        content = JSON.stringify(content);
      }

      return {
        role,
        content,
      };
    })
    .filter((message) => message.content.trim().length > 0);
}

// -----------------------------------------------------------------------------
// SYSTEM PROMPT
// -----------------------------------------------------------------------------

function getSystemPrompt(task = 'general_chat') {
  const base = `
You are FaceMeX AI.

FaceMeX is an AI education, career and opportunity platform.

Your job is to give users useful, accurate, practical answers.

Rules:
- Be clear.
- Be concise when the question is simple.
- Explain difficult things in simple language.
- Do not invent facts.
- If you do not know something, say so.
- Do not pretend that you performed an action when you did not.
- Do not fabricate job listings, companies, links or application details.
- Help the user take the next practical step.
`;

  const taskPrompts = {
    general_chat: `
Answer the user's question naturally and directly.
`,

    homework: `
Help the learner understand the problem.
Show the reasoning or steps where useful.
Do not simply give an unexplained answer.
`,

    lesson_explanation: `
Explain the lesson in simple language.
Use examples when helpful.
`,

    workspace: `
Act as the user's productive AI workspace assistant.
Help with writing, planning, summarizing, organizing and problem solving.
`,

    job_assistant: `
Help the user with career and job-search tasks.
Do not invent job vacancies or application information.
`,

    resume_builder: `
Help the user create or improve a professional CV/resume.
Use clear professional language.
`,

    cover_letter: `
Help the user create a professional, specific cover letter.
Avoid generic filler.
`,

    deepseek: `
Provide a direct and useful answer to the user's request.
`,
  };

  return (
    base +
    (taskPrompts[task] || taskPrompts.general_chat)
  ).trim();
}

// -----------------------------------------------------------------------------
// ABORT CONTROLLER
// -----------------------------------------------------------------------------

function createAbortController(timeoutMs = 45000) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

// -----------------------------------------------------------------------------
// GEMINI MESSAGE CONVERSION
// -----------------------------------------------------------------------------

function convertMessagesForGemini(messages) {
  let systemPrompt = '';

  const contents = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemPrompt +=
        (systemPrompt ? '\n\n' : '') +
        message.content;

      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: message.content,
        },
      ],
    });
  }

  return {
    systemPrompt,
    contents,
  };
}

// -----------------------------------------------------------------------------
// OPENAI-COMPATIBLE MESSAGE CONVERSION
// -----------------------------------------------------------------------------

function convertMessagesForOpenAI(messages, systemPrompt) {
  const output = [];

  if (systemPrompt) {
    output.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    output.push({
      role: message.role,
      content: message.content,
    });
  }

  return output;
}

// -----------------------------------------------------------------------------
// RESPONSE EXTRACTION
// -----------------------------------------------------------------------------

function extractAnswer(provider, data) {
  if (!data) {
    return '';
  }

  // ---------------------------------------------------------------------------
  // GEMINI
  // ---------------------------------------------------------------------------

  if (provider === 'gemini') {
    try {
      const candidates = data.candidates;

      if (
        Array.isArray(candidates) &&
        candidates.length > 0
      ) {
        const parts =
          candidates[0]?.content?.parts;

        if (Array.isArray(parts)) {
          const text = parts
            .map((part) => part?.text || '')
            .filter(Boolean)
            .join('');

          if (text.trim()) {
            return text.trim();
          }
        }
      }
    } catch (error) {
      console.error(
        '[FaceMeX AI] Gemini extraction error:',
        error.message
      );
    }

    return '';
  }

  // ---------------------------------------------------------------------------
  // OPENAI-COMPATIBLE PROVIDERS
  // ---------------------------------------------------------------------------

  try {
    const content =
      data?.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }

          return item?.text || '';
        })
        .filter(Boolean)
        .join('')
        .trim();
    }
  } catch (error) {
    console.error(
      `[FaceMeX AI] ${provider} extraction error:`,
      error.message
    );
  }

  return '';
}

// -----------------------------------------------------------------------------
// GEMINI REQUEST
// -----------------------------------------------------------------------------

async function callGemini({
  apiKey,
  model,
  messages,
  systemPrompt,
}) {
  const { controller, clear } =
    createAbortController(45000);

  try {
    const converted =
      convertMessagesForGemini(messages);

    const finalSystemPrompt = [
      systemPrompt,
      converted.systemPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    const contents =
      converted.contents.length > 0
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
          ];

    const payload = {
      systemInstruction: {
        parts: [
          {
            text: finalSystemPrompt,
          },
        ],
      },

      contents,

      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };

    const url =
      `${getProviderConfig('gemini').endpoint}/` +
      `${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
      },

      body: JSON.stringify(payload),

      signal: controller.signal,
    });

    const rawText = await response.text();

    let data = null;

    try {
      data = rawText
        ? JSON.parse(rawText)
        : null;
    } catch {
      data = {
        raw: rawText,
      };
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.error ||
        rawText ||
        `HTTP ${response.status}`;

      throw new Error(
        `Gemini HTTP ${response.status}: ${errorMessage}`
      );
    }

    const answer =
      extractAnswer('gemini', data);

    if (!answer) {
      throw new Error(
        'Gemini returned an empty response.'
      );
    }

    return {
      answer,
      raw: data,
    };
  } finally {
    clear();
  }
}

// -----------------------------------------------------------------------------
// OPENAI-COMPATIBLE REQUEST
// -----------------------------------------------------------------------------

async function callOpenAICompatible({
  provider,
  apiKey,
  model,
  messages,
  systemPrompt,
}) {
  const config =
    getProviderConfig(provider);

  const { controller, clear } =
    createAbortController(45000);

  try {
    const finalMessages =
      convertMessagesForOpenAI(
        messages,
        systemPrompt
      );

    const payload = {
      model,

      messages: finalMessages,

      temperature: 0.7,

      max_tokens: 2048,
    };

    const headers = {
      'Content-Type': 'application/json',

      Authorization: `Bearer ${apiKey}`,
    };

    if (provider === 'openrouter') {
      headers['HTTP-Referer'] =
        process.env.OPENROUTER_SITE_URL ||
        'https://facemex.online';

      headers['X-Title'] =
        process.env.OPENROUTER_APP_NAME ||
        'FaceMeX';
    }

    const response = await fetch(
      config.endpoint,
      {
        method: 'POST',

        headers,

        body: JSON.stringify(payload),

        signal: controller.signal,
      }
    );

    const rawText = await response.text();

    let data = null;

    try {
      data = rawText
        ? JSON.parse(rawText)
        : null;
    } catch {
      data = {
        raw: rawText,
      };
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.error ||
        rawText ||
        `HTTP ${response.status}`;

      throw new Error(
        `${provider} HTTP ${response.status}: ${errorMessage}`
      );
    }

    const answer =
      extractAnswer(provider, data);

    if (!answer) {
      throw new Error(
        `${provider} returned an empty response.`
      );
    }

    return {
      answer,
      raw: data,
    };
  } finally {
    clear();
  }
}

// -----------------------------------------------------------------------------
// CALL PROVIDER
// -----------------------------------------------------------------------------

async function callProvider({
  provider,
  messages,
  systemPrompt,
}) {
  const config =
    getProviderConfig(provider);

  if (!config) {
    throw new Error(
      `Unknown provider: ${provider}`
    );
  }

  const apiKey =
    getProviderApiKey(provider);

  if (!apiKey) {
    throw new Error(
      `${provider.toUpperCase()}_API_KEY is not configured`
    );
  }

  console.log(
    `[FaceMeX AI] Trying ${provider} / ${config.model}`
  );

  if (provider === 'gemini') {
    return callGemini({
      apiKey,
      model: config.model,
      messages,
      systemPrompt,
    });
  }

  return callOpenAICompatible({
    provider,
    apiKey,
    model: config.model,
    messages,
    systemPrompt,
  });
}

// -----------------------------------------------------------------------------
// RETRYABLE FAILURE
// -----------------------------------------------------------------------------

function isRetryableFailure(error) {
  if (!error) {
    return true;
  }

  const message =
    String(error.message || error).toLowerCase();

  // These should normally allow the next provider
  // to be attempted.
  return (
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('rate limit') ||
    message.includes('temporarily') ||
    message.includes('empty response') ||
    message.includes('failed')
  );
}

// -----------------------------------------------------------------------------
// GENERATE AI RESPONSE
// -----------------------------------------------------------------------------

export async function generateAIResponse({
  messages,
  task = 'general_chat',
  preferredProvider = null,
  providerOrder = null,
} = {}) {
  if (
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    throw new Error(
      'No AI message was provided.'
    );
  }

  const systemPrompt =
    getSystemPrompt(task);

  let providers = Array.isArray(providerOrder)
    ? providerOrder
    : [...PROVIDER_ORDER];

  // If caller explicitly asks for a provider,
  // try it first and then continue through normal fallback.
  if (
    preferredProvider &&
    PROVIDER_ORDER.includes(preferredProvider)
  ) {
    providers = [
      preferredProvider,
      ...providers.filter(
        (provider) =>
          provider !== preferredProvider
      ),
    ];
  }

  const attempted = [];

  for (const provider of providers) {
    try {
      const result =
        await callProvider({
          provider,
          messages,
          systemPrompt,
        });

      console.log(
        `[FaceMeX AI] SUCCESS: ${provider}`
      );

      return {
        success: true,

        provider,

        model:
          getProviderConfig(provider).model,

        content: result.answer,

        response: result.answer,

        text: result.answer,

        attempted,
      };
    } catch (error) {
      attempted.push({
        provider,

        error:
          error?.message ||
          String(error),
      });

      console.error(
        `[FaceMeX AI] ${provider} failed:`,
        error?.message ||
          error
      );

      if (!isRetryableFailure(error)) {
        break;
      }
    }
  }

  const summary = attempted
    .map(
      (item) =>
        `${item.provider}: ${item.error}`
    )
    .join(' | ');

  throw new Error(
    `All FaceMeX AI providers failed. ${summary}`
  );
}

// -----------------------------------------------------------------------------
// REQUEST NORMALIZATION
// -----------------------------------------------------------------------------

function normalizeRequestPayload(body = {}) {
  const messages =
    normalizeMessages(body);

  const task =
    typeof body.task === 'string' &&
    body.task.trim()
      ? body.task.trim()
      : 'general_chat';

  const preferredProvider =
    typeof body.provider === 'string' &&
    PROVIDER_ORDER.includes(
      body.provider.toLowerCase()
    )
      ? body.provider.toLowerCase()
      : null;

  return {
    messages,

    task,

    preferredProvider,
  };
}

// -----------------------------------------------------------------------------
// SEND AI RESPONSE
// -----------------------------------------------------------------------------

async function sendAIResponse(
  req,
  res,
  options = {}
) {
  try {
    const payload =
      normalizeRequestPayload(req.body || {});

    if (payload.messages.length === 0) {
      return res.status(400).json({
        success: false,

        error:
          'Please provide a message, prompt, or messages array.',
      });
    }

    const result =
      await generateAIResponse({
        messages: payload.messages,

        task:
          options.task ||
          payload.task,

        preferredProvider:
          options.provider ||
          payload.preferredProvider,
      });

    return res.json(result);
  } catch (error) {
    console.error(
      '[FaceMeX AI] Request failed:',
      error?.message ||
        error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        'FaceMeX AI request failed.',

      content: '',

      response: '',

      text: '',
    });
  }
}

// -----------------------------------------------------------------------------
// HEALTH
// -----------------------------------------------------------------------------

router.get('/health', (req, res) => {
  const providers = {};

  for (const provider of PROVIDER_ORDER) {
    const config =
      getProviderConfig(provider);

    providers[provider] = {
      configured:
        Boolean(
          getProviderApiKey(provider)
        ),

      model: config?.model || null,
    };
  }

  return res.json({
    success: true,

    service: 'FaceMeX AI',

    status: 'online',

    providers,
  });
});

// -----------------------------------------------------------------------------
// TEST
// -----------------------------------------------------------------------------

router.get('/test', async (req, res) => {
  try {
    const result =
      await generateAIResponse({
        messages: [
          {
            role: 'user',

            content:
              'Reply with exactly: FaceMeX AI is working.',
          },
        ],

        task: 'health_check',
      });

    return res.json(result);
  } catch (error) {
    console.error(
      '[FaceMeX AI] Test failed:',
      error?.message ||
        error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        'FaceMeX AI test failed.',
    });
  }
});

// -----------------------------------------------------------------------------
// GENERAL REPLY
// -----------------------------------------------------------------------------

router.post('/reply', async (req, res) => {
  return sendAIResponse(req, res);
});

// -----------------------------------------------------------------------------
// DEEPSEEK
// -----------------------------------------------------------------------------

router.post(
  '/deepseek',
  async (req, res) => {
    return sendAIResponse(req, res, {
      provider: 'deepseek',

      task: 'deepseek',
    });
  }
);

// -----------------------------------------------------------------------------
// WORKSPACE
// -----------------------------------------------------------------------------

router.post(
  '/workspace',
  async (req, res) => {
    return sendAIResponse(req, res, {
      task: 'workspace',
    });
  }
);

// -----------------------------------------------------------------------------
// PRO JOB ASSISTANT
// -----------------------------------------------------------------------------

router.post(
  '/pro/job-assistant',
  async (req, res) => {
    return sendAIResponse(req, res, {
      task: 'job_assistant',
    });
  }
);

// -----------------------------------------------------------------------------
// PRO RESUME BUILDER
// -----------------------------------------------------------------------------

router.post(
  '/pro/resume-builder',
  async (req, res) => {
    return sendAIResponse(req, res, {
      task: 'resume_builder',
    });
  }
);

// -----------------------------------------------------------------------------
// PRO COVER LETTER
// -----------------------------------------------------------------------------

router.post(
  '/pro/cover-letter',
  async (req, res) => {
    return sendAIResponse(req, res, {
      task: 'cover_letter',
    });
  }
);

// -----------------------------------------------------------------------------
// ROUTE REGISTRATION
// -----------------------------------------------------------------------------

export function registerAIRoutes(
  app,
  basePath = '/api/ai'
) {
  app.use(basePath, router);

  console.log(
    `[FaceMeX AI] Routes registered at ${basePath}`
  );
}

// -----------------------------------------------------------------------------
// DEFAULT EXPORT
// -----------------------------------------------------------------------------

export default router;
