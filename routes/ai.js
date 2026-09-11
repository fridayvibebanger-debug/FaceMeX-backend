import { createRequire } from 'node:module';

const PROVIDER_ORDER = ['gemini', 'groq', 'cerebras', 'openrouter'];
const DEFAULT_TIMEOUT_MS = 25000;
const RETRYABLE_STATUS_CODES = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504]);

const require = createRequire(import.meta.url);
let expressModule = null;

try {
  expressModule = require('express');
} catch {
  expressModule = null;
}

function getProviderConfig(provider) {
  switch (provider) {
    case 'gemini':
      return {
        name: 'gemini',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent?key=${process.env.GEMINI_API_KEY || ''}`,
      };
    case 'groq':
      return {
        name: 'groq',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      };
    case 'cerebras':
      return {
        name: 'cerebras',
        model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
        endpoint: 'https://api.cerebras.ai/v1/chat/completions',
      };
    case 'openrouter':
      return {
        name: 'openrouter',
        model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      };
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      content: String(message.content || ''),
    }))
    .filter((message) => message.content.trim().length > 0);
}

function createAbortController(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timer };
}

function extractAnswer(payload, provider) {
  if (provider === 'gemini') {
    const candidates = payload?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const text = parts
      .map((part) => part?.text || '')
      .join('')
      .trim();

    if (text) {
      return text;
    }
  }

  const text = payload?.choices?.[0]?.message?.content || payload?.output?.text || payload?.text || '';

  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  if (Array.isArray(text)) {
    const joined = text
      .map((part) => typeof part === 'string' ? part : part?.text || '')
      .join('')
      .trim();

    if (joined) {
      return joined;
    }
  }

  return '';
}

function getProviderAuthHeaders(provider) {
  switch (provider) {
    case 'gemini':
      return {};
    case 'groq':
      return {
        Authorization: `Bearer ${process.env.GROQ_API_KEY || ''}`,
      };
    case 'cerebras':
      return {
        Authorization: `Bearer ${process.env.CEREBRAS_API_KEY || ''}`,
      };
    case 'openrouter':
      return {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY || ''}`,
      };
    default:
      return {};
  }
}

function buildProviderPayload(provider, messages, task) {
  const normalizedMessages = normalizeMessages(messages);
  const systemMessage = task ? `Task: ${task}` : 'You are FaceMeX AI.';

  if (provider === 'gemini') {
    const contents = normalizedMessages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

    return {
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: systemMessage }] }],
      systemInstruction: {
        parts: [{ text: systemMessage }],
      },
      generationConfig: {
        temperature: 0.7,
      },
    };
  }

  const chatMessages = [
    {
      role: 'system',
      content: systemMessage,
    },
    ...normalizedMessages,
  ];

  return {
    model: getProviderConfig(provider).model,
    messages: chatMessages,
    temperature: 0.7,
  };
}

async function callProvider(provider, messages, task) {
  const config = getProviderConfig(provider);

  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('gemini_key_missing');
    }

    const body = buildProviderPayload(provider, messages, task);
    const { controller, timer } = createAbortController();

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage = data?.error?.message || `provider_${provider}_failed`;
        const error = new Error(errorMessage);
        error.status = response.status;
        throw error;
      }

      const content = extractAnswer(data, provider);
      if (!content) {
        throw new Error(`provider_${provider}_empty_response`);
      }

      return {
        success: true,
        content,
        provider,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const abortError = new Error(`provider_${provider}_timeout`);
        abortError.status = 408;
        throw abortError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const providerKey = process.env[`${provider.toUpperCase()}_API_KEY`];
  if (!providerKey) {
    throw new Error(`${provider}_key_missing`);
  }

  const body = buildProviderPayload(provider, messages, task);
  const { controller, timer } = createAbortController();

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getProviderAuthHeaders(provider),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data?.error?.message || `provider_${provider}_failed`;
      const error = new Error(errorMessage);
      error.status = response.status;
      throw error;
    }

    const content = extractAnswer(data, provider);
    if (!content) {
      throw new Error(`provider_${provider}_empty_response`);
    }

    return {
      success: true,
      content,
      provider,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const abortError = new Error(`provider_${provider}_timeout`);
      abortError.status = 408;
      throw abortError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableFailure(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message || error || '').toLowerCase();
  const status = Number(error.status || 0);

  if (RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  if (
    message.includes('401') ||
    message.includes('402') ||
    message.includes('403') ||
    message.includes('408') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('insufficient balance') ||
    message.includes('rate limit') ||
    message.includes('temporarily unavailable')
  ) {
    return true;
  }

  return false;
}

export async function generateAIResponse(request = {}) {
  const payload = request?.body || request || {};
  const messages = normalizeMessages(payload.messages || []);
  const task = String(payload.task || payload.prompt || 'general_chat').trim();

  const errors = [];

  for (const provider of PROVIDER_ORDER) {
    try {
      const result = await callProvider(provider, messages, task);
      return result;
    } catch (error) {
      const status = error?.status || null;
      const message = error?.message || 'provider_error';
      errors.push({ provider, status, message });

      if (provider !== PROVIDER_ORDER[PROVIDER_ORDER.length - 1] && isRetryableFailure(error)) {
        continue;
      }

      break;
    }
  }

  return {
    success: false,
    error: 'AI temporarily unavailable',
    provider: null,
    details: errors,
  };
}

function normalizeRequestPayload(req = {}) {
  const body = req.body || {};
  const query = req.query || {};

  return {
    messages: body.messages || body.chat || body.conversation || [],
    task: body.task || body.prompt || query.task || query.prompt || 'general_chat',
    provider: body.provider || query.provider || null,
  };
}

function sendAIResponse(res, result) {
  if (result.success) {
    return res.status(200).json(result);
  }

  return res.status(502).json(result);
}

export function createAIRouter() {
  if (!expressModule) {
    throw new Error('createAIRouter requires the Express package to be installed in the backend runtime.');
  }

  const router = expressModule.Router();

  router.get('/health', (req, res) => {
    res.status(200).json({
      ok: true,
      service: 'faceme-ai-router',
      providers: PROVIDER_ORDER,
    });
  });

  router.get('/test', async (req, res) => {
    try {
      const result = await generateAIResponse({
        task: 'test',
        messages: [{ role: 'user', content: 'Reply with a short confirmation that the AI router is healthy.' }],
      });
      return sendAIResponse(res, result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message || 'AI test failed',
      });
    }
  });

  router.post('/reply', async (req, res) => {
    try {
      const payload = normalizeRequestPayload(req);
      const result = await generateAIResponse({
        messages: payload.messages,
        task: payload.task,
      });
      return sendAIResponse(res, result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message || 'AI reply failed',
      });
    }
  });

  router.post('/deepseek', async (req, res) => {
    try {
      const payload = normalizeRequestPayload(req);
      const result = await generateAIResponse({
        messages: payload.messages,
        task: payload.task,
      });
      return sendAIResponse(res, result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message || 'DeepSeek route failed',
      });
    }
  });

  router.post('/workspace', async (req, res) => {
    try {
      const payload = normalizeRequestPayload(req);
      const result = await generateAIResponse({
        messages: payload.messages,
        task: payload.task,
      });
      return sendAIResponse(res, result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Workspace AI route failed',
      });
    }
  });

  return router;
}

export function registerAIRoutes(app, basePath = '/api/ai') {
  if (!app || typeof app.use !== 'function') {
    throw new Error('registerAIRoutes expects an Express app or router instance.');
  }

  const router = createAIRouter();
  app.use(basePath, router);
  return router;
}

export const aiRouter = {
  PROVIDER_ORDER,
  generateAIResponse,
  createAIRouter,
  registerAIRoutes,
};

export default aiRouter;
