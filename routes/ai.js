import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let expressModule = null;

try {
  expressModule = require('express');
} catch {
  expressModule = null;
}

/*
|--------------------------------------------------------------------------
| FaceMeX AI Provider Configuration
|--------------------------------------------------------------------------
|
| Order matters.
|
| Gemini -> Groq -> Cerebras -> OpenRouter -> DeepSeek
|
| If one provider fails, FaceMeX automatically tries the next one.
|
*/

const PROVIDER_ORDER = [
  'gemini',
  'groq',
  'cerebras',
  'openrouter',
  'deepseek',
];

const DEFAULT_TIMEOUT_MS = Number(
  process.env.AI_TIMEOUT_MS || 25000
);

/*
|--------------------------------------------------------------------------
| Provider configuration
|--------------------------------------------------------------------------
*/

function getProviderConfig(provider) {
  switch (provider) {
    case 'gemini':
      return {
        name: 'gemini',
        model:
          process.env.GEMINI_MODEL ||
          'gemini-3.6-flash',
        endpoint:
          `https://generativelanguage.googleapis.com/v1beta/models/` +
          `${process.env.GEMINI_MODEL || 'gemini-3.6-flash'}` +
          `:generateContent?key=${process.env.GEMINI_API_KEY || ''}`,
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
          'https://api.deepseek.com/v1/chat/completions',
      };

    default:
      throw new Error(
        `Unsupported provider: ${provider}`
      );
  }
}

/*
|--------------------------------------------------------------------------
| Environment key lookup
|--------------------------------------------------------------------------
*/

function getProviderKey(provider) {
  const envName =
    `${provider.toUpperCase()}_API_KEY`;

  return process.env[envName] || '';
}

/*
|--------------------------------------------------------------------------
| Message normalization
|--------------------------------------------------------------------------
*/

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(
      (message) =>
        message &&
        typeof message === 'object'
    )
    .map((message) => {
      let role = 'user';

      if (message.role === 'assistant') {
        role = 'assistant';
      }

      if (message.role === 'system') {
        role = 'system';
      }

      return {
        role,
        content: String(
          message.content ?? ''
        ).trim(),
      };
    })
    .filter(
      (message) =>
        message.content.length > 0
    );
}

/*
|--------------------------------------------------------------------------
| Abort / timeout
|--------------------------------------------------------------------------
*/

function createAbortController(
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    timer,
  };
}

/*
|--------------------------------------------------------------------------
| Extract response text
|--------------------------------------------------------------------------
*/

function extractAnswer(payload, provider) {
  /*
   * Gemini
   */
  if (provider === 'gemini') {
    const candidates =
      Array.isArray(payload?.candidates)
        ? payload.candidates
        : [];

    const parts =
      candidates[0]?.content?.parts || [];

    const text = parts
      .map((part) => {
        if (typeof part?.text === 'string') {
          return part.text;
        }

        return '';
      })
      .join('')
      .trim();

    if (text) {
      return text;
    }
  }

  /*
   * OpenAI-compatible providers
   */
  const choiceContent =
    payload?.choices?.[0]?.message?.content;

  if (
    typeof choiceContent === 'string' &&
    choiceContent.trim()
  ) {
    return choiceContent.trim();
  }

  /*
   * Some providers may return content arrays.
   */
  if (Array.isArray(choiceContent)) {
    const joined = choiceContent
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        return part?.text || '';
      })
      .join('')
      .trim();

    if (joined) {
      return joined;
    }
  }

  /*
   * Generic fallback
   */
  const fallback =
    payload?.output?.text ||
    payload?.text ||
    '';

  if (
    typeof fallback === 'string' &&
    fallback.trim()
  ) {
    return fallback.trim();
  }

  return '';
}

/*
|--------------------------------------------------------------------------
| Authentication headers
|--------------------------------------------------------------------------
*/

function getProviderAuthHeaders(provider) {
  const key = getProviderKey(provider);

  switch (provider) {
    case 'gemini':
      return {};

    case 'groq':
    case 'cerebras':
    case 'openrouter':
    case 'deepseek':
      return {
        Authorization: `Bearer ${key}`,
      };

    default:
      return {};
  }
}

/*
|--------------------------------------------------------------------------
| System prompt
|--------------------------------------------------------------------------
*/

function getSystemPrompt(task = 'general_chat') {
  return `
You are FaceMeX AI.

FaceMeX is an education, career and opportunity platform.

Help the user clearly, accurately and practically.

Be concise when the question is simple.
Explain difficult subjects step by step.
For education questions, teach rather than simply giving an answer.
For career questions, provide practical guidance.
For job-search questions, help the user understand and act on opportunities.

Current task:
${String(task || 'general_chat')}
`.trim();
}

/*
|--------------------------------------------------------------------------
| Build provider payload
|--------------------------------------------------------------------------
*/

function buildProviderPayload(
  provider,
  messages,
  task
) {
  const normalizedMessages =
    normalizeMessages(messages);

  const systemPrompt =
    getSystemPrompt(task);

  /*
   * Gemini
   */
  if (provider === 'gemini') {
    const contents =
      normalizedMessages
        .filter(
          (message) =>
            message.role !== 'system'
        )
        .map((message) => ({
          role:
            message.role === 'assistant'
              ? 'model'
              : 'user',
          parts: [
            {
              text: message.content,
            },
          ],
        }));

    return {
      systemInstruction: {
        parts: [
          {
            text: systemPrompt,
          },
        ],
      },

      contents:
        contents.length > 0
          ? contents
          : [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      'Hello',
                  },
                ],
              },
            ],

      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };
  }

  /*
   * OpenAI-compatible providers
   */
  const chatMessages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...normalizedMessages,
  ];

  return {
    model:
      getProviderConfig(provider).model,

    messages: chatMessages,

    temperature: 0.7,

    max_tokens: 2048,
  };
}

/*
|--------------------------------------------------------------------------
| Call one provider
|--------------------------------------------------------------------------
*/

async function callProvider(
  provider,
  messages,
  task
) {
  const config =
    getProviderConfig(provider);

  const providerKey =
    getProviderKey(provider);

  /*
   * Don't waste time calling providers
   * that don't have an API key.
   */
  if (!providerKey) {
    const error =
      new Error(
        `${provider}_key_missing`
      );

    error.code = 'KEY_MISSING';
    error.status = 401;

    throw error;
  }

  const body =
    buildProviderPayload(
      provider,
      messages,
      task
    );

  const {
    controller,
    timer,
  } =
    createAbortController();

  try {
    const headers = {
      'Content-Type':
        'application/json',

      ...getProviderAuthHeaders(
        provider
      ),
    };

    /*
     * OpenRouter likes these headers.
     * They are harmless to omit if not configured.
     */
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] =
        process.env.OPENROUTER_SITE_URL ||
        'https://facemex.online';

      headers['X-Title'] =
        process.env.OPENROUTER_APP_NAME ||
        'FaceMeX';
    }

    const response =
      await fetch(
        config.endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal:
            controller.signal,
        }
      );

    const rawText =
      await response.text();

    let data = {};

    try {
      data =
        rawText
          ? JSON.parse(rawText)
          : {};
    } catch {
      data = {
        raw: rawText,
      };
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        data?.error ||
        rawText ||
        `provider_${provider}_failed`;

      const error =
        new Error(
          String(errorMessage)
        );

      error.status =
        response.status;

      error.provider =
        provider;

      throw error;
    }

    const content =
      extractAnswer(
        data,
        provider
      );

    if (!content) {
      const error =
        new Error(
          `provider_${provider}_empty_response`
        );

      error.status = 502;
      error.provider =
        provider;

      throw error;
    }

    return {
      success: true,
      provider,
      model: config.model,
      content,
      response: content,
      text: content,
    };
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      const timeoutError =
        new Error(
          `provider_${provider}_timeout`
        );

      timeoutError.status = 408;
      timeoutError.provider =
        provider;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/*
|--------------------------------------------------------------------------
| Decide whether to try another provider
|--------------------------------------------------------------------------
*/

export function isRetryableFailure(
  error
) {
  if (!error) {
    return true;
  }

  const status =
    Number(error.status || 0);

  /*
   * For FaceMeX fallback architecture,
   * most provider-side failures should
   * move to the next provider.
   */

  const retryableStatuses =
    new Set([
      400,
      401,
      402,
      403,
      408,
      409,
      429,
      500,
      502,
      503,
      504,
    ]);

  if (
    retryableStatuses.has(status)
  ) {
    return true;
  }

  const message =
    String(
      error.message ||
      error ||
      ''
    ).toLowerCase();

  const retryableWords = [
    'key_missing',
    'timeout',
    'network',
    'fetch failed',
    'rate limit',
    'temporarily unavailable',
    'empty_response',
    'insufficient balance',
    'quota',
    'overloaded',
    'provider_',
    'failed',
  ];

  return retryableWords.some(
    (word) =>
      message.includes(word)
  );
}

/*
|--------------------------------------------------------------------------
| Generate AI response
|--------------------------------------------------------------------------
*/

export async function generateAIResponse(
  request = {}
) {
  const payload =
    request?.body ||
    request ||
    {};

  let rawMessages = [];

  if (
    Array.isArray(
      payload.messages
    )
  ) {
    rawMessages =
      payload.messages;
  } else {
    const singleMessage =
      payload.message ||
      payload.prompt ||
      payload.content;

    if (
      typeof singleMessage ===
        'string' &&
      singleMessage.trim()
    ) {
      rawMessages = [
        {
          role: 'user',
          content:
            singleMessage,
        },
      ];
    }
  }

  const messages =
    normalizeMessages(
      rawMessages
    );

  /*
   * If there are no messages,
   * give the model a harmless default.
   */
  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content:
        'Hello, introduce yourself as FaceMeX AI.',
    });
  }

  const task =
    String(
      payload.task ||
      'general_chat'
    ).trim();

  const errors = [];

  for (
    const provider
    of PROVIDER_ORDER
  ) {
    try {
      console.log(
        `[FaceMeX AI] Trying ${provider}...`
      );

      const result =
        await callProvider(
          provider,
          messages,
          task
        );

      console.log(
        `[FaceMeX AI] ${provider} succeeded`
      );

      return result;
    } catch (error) {
      const errorInfo = {
        provider,
        status:
          error?.status ||
          null,
        message:
          error?.message ||
          'provider_error',
      };

      errors.push(
        errorInfo
      );

      console.error(
        `[FaceMeX AI] ${provider} failed:`,
        errorInfo
      );

      /*
       * Try next provider.
       */
      if (
        isRetryableFailure(error)
      ) {
        continue;
      }

      break;
    }
  }

  return {
    success: false,

    error:
      'FaceMeX AI is temporarily unavailable.',

    provider: null,

    details: errors,
  };
}

/*
|--------------------------------------------------------------------------
| Normalize Express request
|--------------------------------------------------------------------------
*/

function normalizeRequestPayload(
  req = {}
) {
  const body =
    req.body || {};

  const query =
    req.query || {};

  const suppliedMessages =
    body.messages ||
    body.chat ||
    body.conversation ||
    [];

  const fallbackSingle =
    body.message ||
    body.prompt ||
    body.content ||
    query.prompt ||
    query.message ||
    '';

  return {
    messages:
      Array.isArray(
        suppliedMessages
      ) &&
      suppliedMessages.length > 0
        ? suppliedMessages
        : fallbackSingle
          ? [
              {
                role: 'user',
                content:
                  String(
                    fallbackSingle
                  ),
              },
            ]
          : [],

    task:
      body.task ||
      query.task ||
      'general_chat',

    provider:
      body.provider ||
      query.provider ||
      null,
  };
}

/*
|--------------------------------------------------------------------------
| Send response
|--------------------------------------------------------------------------
*/

function sendAIResponse(
  res,
  result
) {
  if (result?.success) {
    return res
      .status(200)
      .json({
        success: true,
        provider:
          result.provider ||
          null,
        model:
          result.model ||
          null,
        content:
          result.content ||
          '',
        response:
          result.content ||
          result.response ||
          '',
        text:
          result.content ||
          result.text ||
          '',
      });
  }

  return res
    .status(502)
    .json({
      success: false,
      error:
        result?.error ||
        'AI temporarily unavailable',
      provider: null,
      details:
        result?.details ||
        [],
    });
}

/*
|--------------------------------------------------------------------------
| Express router
|--------------------------------------------------------------------------
*/

export function createAIRouter() {
  if (!expressModule) {
    throw new Error(
      'Express is not installed.'
    );
  }

  const router =
    expressModule.Router();

  /*
   * Health
   */
  router.get(
    '/health',
    (req, res) => {
      const providers =
        PROVIDER_ORDER.map(
          (provider) => ({
            provider,
            configured:
              Boolean(
                getProviderKey(
                  provider
                )
              ),
            model:
              getProviderConfig(
                provider
              ).model,
          })
        );

      res.status(200).json({
        ok: true,
        service:
          'facemex-ai-router',
        providers,
      });
    }
  );

  /*
   * Simple GET test
   */
  router.get(
    '/test',
    async (req, res) => {
      try {
        const result =
          await generateAIResponse({
            task:
              'health_check',
            messages: [
              {
                role: 'user',
                content:
                  'Reply with exactly: FaceMeX AI is working.',
              },
            ],
          });

        return sendAIResponse(
          res,
          result
        );
      } catch (error) {
        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ||
              'AI test failed',
          });
      }
    }
  );

  /*
   * MAIN AI ENDPOINT
   */
  router.post(
    '/reply',
    async (req, res) => {
      try {
        const payload =
          normalizeRequestPayload(
            req
          );

        console.log(
          '[FaceMeX AI] /reply request:',
          {
            messageCount:
              payload.messages
                .length,
            task:
              payload.task,
          }
        );

        const result =
          await generateAIResponse({
            messages:
              payload.messages,
            task:
              payload.task,
          });

        return sendAIResponse(
          res,
          result
        );
      } catch (error) {
        console.error(
          '[FaceMeX AI] /reply fatal error:',
          error
        );

        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ||
              'AI reply failed',
          });
      }
    }
  );

  /*
   * DeepSeek-compatible route
   * Kept for backwards compatibility.
   */
  router.post(
    '/deepseek',
    async (req, res) => {
      try {
        const payload =
          normalizeRequestPayload(
            req
          );

        const result =
          await generateAIResponse({
            messages:
              payload.messages,
            task:
              payload.task,
          });

        return sendAIResponse(
          res,
          result
        );
      } catch (error) {
        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ||
              'DeepSeek route failed',
          });
      }
    }
  );

  /*
   * Workspace
   */
  router.post(
    '/workspace',
    async (req, res) => {
      try {
        const payload =
          normalizeRequestPayload(
            req
          );

        const result =
          await generateAIResponse({
            messages:
              payload.messages,
            task:
              payload.task ||
              'workspace_assistant',
          });

        return sendAIResponse(
          res,
          result
        );
      } catch (error) {
        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ||
              'Workspace AI route failed',
          });
      }
    }
  );

  /*
   * Job Assistant
   */
  router.post(
    '/pro/job-assistant',
    async (req, res) => {
      try {
        const payload =
          normalizeRequestPayload(
            req
          );

        const result =
          await generateAIResponse({
            messages:
              payload.messages,
            task:
              'job_assistant',
          });

        return sendAIResponse(
          res,
          result
        );
      } catch (error) {
        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ||
              'Job Assistant AI route failed',
          });
      }
    }
  );

  /*
   * Resume Builder
   */
  router.post(
    '/pro/resume-builder',
    async (req, res) => {
      try {
        const payload =
          normalizeRequestPayload(
            req
          );

        const result =
          await generateAIResponse({
            messages:
              payload.messages,
            task:
              'resume_builder',
          });

        return sendAIResponse(
          res,
          result
        );
      } catch (error) {
        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ||
              'Resume builder AI route failed',
          });
      }
    }
  );

  /*
   * Cover Letter
   */
  router.post(
    '/pro/cover-letter',
    async (req, res) => {
      try {
        const payload =
          normalizeRequestPayload(
            req
          );

        const result =
          await generateAIResponse({
            messages:
              payload.messages,
            task:
              'cover_letter',
          });

        return sendAIResponse(
          res,
          result
        );
      } catch (error) {
        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ||
              'Cover letter AI route failed',
          });
      }
    }
  );

  return router;
}

/*
|--------------------------------------------------------------------------
| Register routes
|--------------------------------------------------------------------------
*/

export function registerAIRoutes(
  app,
  basePath = '/api/ai'
) {
  if (
    !app ||
    typeof app.use !== 'function'
  ) {
    throw new Error(
      'registerAIRoutes expects an Express app or router.'
    );
  }

  const router =
    createAIRouter();

  app.use(
    basePath,
    router
  );

  return router;
}

/*
|--------------------------------------------------------------------------
| Public export
|--------------------------------------------------------------------------
*/

export const aiRouter = {
  PROVIDER_ORDER,
  generateAIResponse,
  createAIRouter,
  registerAIRoutes,
};

const defaultAIRouter =
  expressModule
    ? createAIRouter()
    : null;

export default
  defaultAIRouter ||
  aiRouter;
