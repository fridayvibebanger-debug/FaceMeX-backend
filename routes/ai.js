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
| FaceMeX AI Router
|--------------------------------------------------------------------------
|
| FaceMeX is task-aware.
|
| GENERAL CHAT
|   Groq -> Gemini -> Cerebras -> OpenRouter -> DeepSeek
|
| EDUCATION / SEARCH / MULTIMODAL
|   Gemini -> Groq -> Cerebras -> OpenRouter -> DeepSeek
|
| JOB SEARCH / VERIFICATION / WEB
|   Gemini + Google Search -> fallbacks
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Provider routing
|--------------------------------------------------------------------------
*/

const ROUTES = {
  general_chat: [
    'groq',
    'gemini',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  homework: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  lesson_explanation: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  video_explanation: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  image_analysis: [
    'gemini',
    'groq',
    'openrouter',
  ],

  document_analysis: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  summarization: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  web_search: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  current_information: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  job_search: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  job_verification: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
  ],

  job_assistant: [
    'groq',
    'gemini',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  resume_builder: [
    'groq',
    'gemini',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  cover_letter: [
    'groq',
    'gemini',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  interview: [
    'groq',
    'gemini',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  workspace_assistant: [
    'groq',
    'gemini',
    'cerebras',
    'openrouter',
    'deepseek',
  ],

  health_check: [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'deepseek',
  ],
};

const DEFAULT_PROVIDER_ORDER = [
  'groq',
  'gemini',
  'cerebras',
  'openrouter',
  'deepseek',
];

const DEFAULT_TIMEOUT_MS = Number(
  process.env.AI_TIMEOUT_MS || 30000
);

/*
|--------------------------------------------------------------------------
| Provider configuration
|--------------------------------------------------------------------------
*/

function getProviderConfig(provider, task = 'general_chat') {
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

    case 'groq': {
      /*
       * Groq needs a vision-capable model for images.
       */
      const isVisionTask =
        task === 'image_analysis';

      return {
        name: 'groq',

        model:
          isVisionTask
            ? (
                process.env.GROQ_VISION_MODEL ||
                'qwen/qwen3.8-27b'
              )
            : (
                process.env.GROQ_MODEL ||
                'llama-3.3-70b-versatile'
              ),

        endpoint:
          'https://api.groq.com/openai/v1/chat/completions',
      };
    }

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
| Provider key
|--------------------------------------------------------------------------
*/

function getProviderKey(provider) {
  const envName =
    `${provider.toUpperCase()}_API_KEY`;

  return process.env[envName] || '';
}

/*
|--------------------------------------------------------------------------
| Normalize messages
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

        content:
          typeof message.content === 'string'
            ? message.content.trim()
            : '',
      };
    })
    .filter(
      (message) =>
        message.content.length > 0
    );
}

/*
|--------------------------------------------------------------------------
| Normalize attachments
|--------------------------------------------------------------------------
|
| Supported input formats:
|
| {
|   mimeType: "image/jpeg",
|   data: "BASE64..."
| }
|
| {
|   mimeType: "application/pdf",
|   data: "BASE64..."
| }
|
| {
|   mimeType: "video/mp4",
|   data: "BASE64..."
| }
|
| {
|   fileUri: "https://..."
|   mimeType: "application/pdf"
| }
|
|--------------------------------------------------------------------------
*/

function normalizeAttachments(
  payload = {}
) {
  let attachments =
    payload.attachments ||
    payload.files ||
    [];

  if (!Array.isArray(attachments)) {
    attachments = [];
  }

  /*
   * Support singular image/file fields too.
   */
  if (
    payload.image &&
    !attachments.length
  ) {
    attachments = [
      {
        mimeType:
          payload.imageMimeType ||
          'image/jpeg',

        data:
          typeof payload.image === 'string'
            ? payload.image
            : '',
      },
    ];
  }

  if (
    payload.file &&
    !attachments.length
  ) {
    attachments = [
      payload.file,
    ];
  }

  return attachments
    .filter(Boolean)
    .map((file) => ({
      name:
        file.name ||
        file.filename ||
        null,

      mimeType:
        file.mimeType ||
        file.type ||
        'application/octet-stream',

      data:
        file.data ||
        file.base64 ||
        null,

      fileUri:
        file.fileUri ||
        file.uri ||
        file.url ||
        null,
    }));
}

/*
|--------------------------------------------------------------------------
| Detect task automatically
|--------------------------------------------------------------------------
*/

function detectTask(
  message = '',
  attachments = [],
  requestedTask = ''
) {
  if (
    requestedTask &&
    requestedTask !== 'general_chat'
  ) {
    return requestedTask;
  }

  const text =
    String(message || '')
      .toLowerCase()
      .trim();

  /*
   * Attachments take priority.
   */
  if (
    attachments.some(
      (file) =>
        String(
          file.mimeType || ''
        ).startsWith('image/')
    )
  ) {
    return 'image_analysis';
  }

  if (
    attachments.some(
      (file) =>
        String(
          file.mimeType || ''
        ) === 'application/pdf'
    )
  ) {
    return 'document_analysis';
  }

  if (
    attachments.some(
      (file) =>
        String(
          file.mimeType || ''
        ).startsWith('video/')
    )
  ) {
    return 'video_explanation';
  }

  if (
    attachments.some(
      (file) =>
        String(
          file.mimeType || ''
        ).startsWith('audio/')
    )
  ) {
    return 'lesson_explanation';
  }

  /*
   * Job search.
   */
  if (
    text.includes('find jobs') ||
    text.includes('find a job') ||
    text.includes('job vacancies') ||
    text.includes('job vacancy') ||
    text.includes('vacancies') ||
    text.includes('job openings') ||
    text.includes('jobs near') ||
    text.includes('jobs in ') ||
    text.includes('jobs around')
  ) {
    return 'job_search';
  }

  /*
   * Job verification.
   */
  if (
    text.includes('verify this job') ||
    text.includes('verify this vacancy') ||
    text.includes('is this job real') ||
    text.includes('is this vacancy real') ||
    text.includes('is this job legitimate') ||
    text.includes('is this vacancy legitimate') ||
    text.includes('check this job')
  ) {
    return 'job_verification';
  }

  /*
   * Web/current information.
   */
  if (
    text.includes('search online') ||
    text.includes('search the web') ||
    text.includes('google this') ||
    text.includes('look online') ||
    text.includes('latest') ||
    text.includes('today') ||
    text.includes('current') ||
    text.includes('recent')
  ) {
    return 'web_search';
  }

  /*
   * Summarization.
   */
  if (
    text.includes('summarize') ||
    text.includes('summarise') ||
    text.includes('summary') ||
    text.includes('give me a summary')
  ) {
    return 'summarization';
  }

  /*
   * Video / lesson.
   */
  if (
    text.includes('explain this video') ||
    text.includes('explain this lesson') ||
    text.includes('teach me this lesson') ||
    text.includes('what does this video') ||
    text.includes('what is this lesson about')
  ) {
    return 'video_explanation';
  }

  /*
   * Homework.
   */
  if (
    text.includes('homework') ||
    text.includes('assignment') ||
    text.includes('solve this') ||
    text.includes('help me with maths') ||
    text.includes('help me with math') ||
    text.includes('explain this question')
  ) {
    return 'homework';
  }

  return 'general_chat';
}

/*
|--------------------------------------------------------------------------
| System prompt
|--------------------------------------------------------------------------
*/

function getSystemPrompt(task = 'general_chat') {
  const prompts = {
    general_chat: `
You are FaceMeX AI.

FaceMeX is an education, career and opportunity platform.

Be helpful, natural, accurate and practical.

Answer directly.

Do not unnecessarily mention that you are an AI.

If the user asks a simple question, keep the answer concise.
`.trim(),

    homework: `
You are FaceMeX AI Education Tutor.

Teach the student.

Explain difficult concepts step by step in simple language.

Do not just dump an answer.

When solving a problem:
1. Explain what is being asked.
2. Show the method.
3. Work through the solution.
4. Give the final answer.
5. Give a short way to remember the concept.

Adapt the explanation to the student's apparent level.
`.trim(),

    image_analysis: `
You are FaceMeX AI Vision Tutor.

Analyze the supplied image carefully.

If it contains homework, explain the question and solve it step by step.

If it contains a document, screenshot, chart, diagram or table, explain what it shows.

Do not invent details that cannot be seen.

Clearly distinguish what is visible from what is inferred.
`.trim(),

    document_analysis: `
You are FaceMeX AI Document Assistant.

Analyze the supplied document carefully.

You can summarize, explain, extract important information and answer questions about it.

If information is missing from the document, say so.

Do not invent facts.
`.trim(),

    video_explanation: `
You are FaceMeX AI Video Lesson Tutor.

Analyze the supplied lesson/video content.

Explain the lesson in simple language.

Identify:
- main topic
- important concepts
- important definitions
- formulas where applicable
- examples
- what the student should remember

Finish with a short practice question when appropriate.
`.trim(),

    lesson_explanation: `
You are FaceMeX AI Education Tutor.

Explain the lesson clearly and practically.

Teach the concept rather than merely repeating it.
`.trim(),

    summarization: `
You are FaceMeX AI.

Summarize the supplied information accurately.

Prioritize:
- main ideas
- important facts
- conclusions
- actions
- dates
- names
- numbers

Do not add information that is not supported by the source.
`.trim(),

    web_search: `
You are FaceMeX AI Research Assistant.

Use current web information when available.

Give the user a clear answer and distinguish current information from general background.

When search results are available, rely on them rather than guessing.
`.trim(),

    current_information: `
You are FaceMeX AI Research Assistant.

Use current information from the web when appropriate.

Do not present outdated information as current.
`.trim(),

    job_search: `
You are FaceMeX AI Job Search Assistant.

Find useful and relevant job opportunities.

When web search is available:
- prioritize current listings
- identify the employer
- identify the role
- identify location
- identify the source
- identify the application link when available
- mention the posting date when available

Do not invent job listings.

If you cannot verify something, say that it could not be verified.
`.trim(),

    job_verification: `
You are FaceMeX AI Job Verification Assistant.

The user wants to determine whether a job or vacancy appears legitimate.

Use current web information.

Check, where possible:
- official employer website
- official careers page
- recruiter identity
- application URL
- posting date
- consistency of company information
- suspicious payment requests
- suspicious contact details
- duplicate or copied listings

Do not guarantee that a job is legitimate.

Use clear labels such as:
VERIFIED SOURCE
LIKELY LEGITIMATE
NEEDS CAUTION
COULD NOT VERIFY

Explain the evidence behind the assessment.
`.trim(),

    job_assistant: `
You are FaceMeX AI Career Assistant.

Help the user search, understand and act on job opportunities.

Give practical next steps.
`.trim(),

    resume_builder: `
You are FaceMeX AI Resume Assistant.

Help create clear, truthful, professional CV/resume content.

Never invent qualifications, employers or experience.
`.trim(),

    cover_letter: `
You are FaceMeX AI Cover Letter Assistant.

Write professional, specific and truthful cover letters.

Tailor the letter to the job and user's actual background.
`.trim(),

    interview: `
You are FaceMeX AI Interview Coach.

Ask realistic interview questions.

Give practical feedback.

Help the user improve their answers without inventing experience.
`.trim(),

    workspace_assistant: `
You are FaceMeX AI Workspace Assistant.

Help the user write, organize, analyze and improve documents and ideas.
`.trim(),

    health_check: `
You are FaceMeX AI.

Reply exactly as requested.
`.trim(),
  };

  return (
    prompts[task] ||
    prompts.general_chat
  );
}

/*
|--------------------------------------------------------------------------
| Does Gemini need Google Search?
|--------------------------------------------------------------------------
*/

function shouldUseGoogleSearch(task) {
  return [
    'job_search',
    'job_verification',
    'web_search',
    'current_information',
  ].includes(task);
}

/*
|--------------------------------------------------------------------------
| Gemini parts
|--------------------------------------------------------------------------
*/

function buildGeminiParts(
  messages,
  attachments = []
) {
  const parts = [];

  /*
   * Put conversation text into the request.
   */
  for (const message of messages) {
    if (!message?.content) {
      continue;
    }

    parts.push({
      text:
        message.role === 'assistant'
          ? `Previous FaceMeX AI response:\n${message.content}`
          : message.content,
    });
  }

  /*
   * Add media/files.
   */
  for (const file of attachments) {
    if (
      file.data &&
      file.mimeType
    ) {
      parts.push({
        inlineData: {
          mimeType:
            file.mimeType,

          data:
            String(file.data)
              .replace(
                /^data:[^;]+;base64,/,
                ''
              ),
        },
      });

      continue;
    }

    if (
      file.fileUri &&
      file.mimeType
    ) {
      parts.push({
        fileData: {
          mimeType:
            file.mimeType,

          fileUri:
            file.fileUri,
        },
      });
    }
  }

  if (!parts.length) {
    parts.push({
      text: 'Hello',
    });
  }

  return parts;
}

/*
|--------------------------------------------------------------------------
| Build Gemini payload
|--------------------------------------------------------------------------
*/

function buildGeminiPayload(
  messages,
  task,
  attachments
) {
  const systemPrompt =
    getSystemPrompt(task);

  const tools = [];

  if (
    shouldUseGoogleSearch(task)
  ) {
    tools.push({
      google_search: {},
    });
  }

  return {
    systemInstruction: {
      parts: [
        {
          text: systemPrompt,
        },
      ],
    },

    contents: [
      {
        role: 'user',

        parts:
          buildGeminiParts(
            messages,
            attachments
          ),
      },
    ],

    ...(tools.length
      ? {
          tools,
        }
      : {}),

    generationConfig: {
      temperature:
        task === 'job_verification'
          ? 0.2
          : 0.7,

      maxOutputTokens: 4096,
    },
  };
}

/*
|--------------------------------------------------------------------------
| Build OpenAI-compatible messages
|--------------------------------------------------------------------------
*/

function buildOpenAIContent(
  messages,
  attachments,
  provider
) {
  const output = [];

  for (const message of messages) {
    output.push({
      role:
        message.role === 'system'
          ? 'system'
          : message.role === 'assistant'
            ? 'assistant'
            : 'user',

      content:
        message.content,
    });
  }

  /*
   * Groq vision.
   */
  if (
    provider === 'groq' &&
    attachments.length > 0
  ) {
    const lastUser =
      output.findLast(
        (message) =>
          message.role === 'user'
      );

    if (lastUser) {
      const content = [
        {
          type: 'text',
          text:
            lastUser.content ||
            'Analyze this image.',
        },
      ];

      for (
        const file
        of attachments
      ) {
        if (
          String(
            file.mimeType || ''
          ).startsWith('image/')
        ) {
          let imageUrl =
            file.fileUri;

          if (
            !imageUrl &&
            file.data
          ) {
            imageUrl =
              `data:${file.mimeType};base64,` +
              String(file.data)
                .replace(
                  /^data:[^;]+;base64,/,
                  ''
                );
          }

          if (imageUrl) {
            content.push({
              type: 'image_url',

              image_url: {
                url: imageUrl,
              },
            });
          }
        }
      }

      if (content.length > 1) {
        lastUser.content =
          content;
      }
    }
  }

  return output;
}

/*
|--------------------------------------------------------------------------
| Build provider payload
|--------------------------------------------------------------------------
*/

function buildProviderPayload(
  provider,
  messages,
  task,
  attachments = []
) {
  const systemPrompt =
    getSystemPrompt(task);

  /*
   * Gemini.
   */
  if (provider === 'gemini') {
    return buildGeminiPayload(
      messages,
      task,
      attachments
    );
  }

  /*
   * OpenAI-compatible.
   */
  const chatMessages = [
    {
      role: 'system',
      content:
        systemPrompt,
    },

    ...buildOpenAIContent(
      messages,
      attachments,
      provider
    ),
  ];

  return {
    model:
      getProviderConfig(
        provider,
        task
      ).model,

    messages:
      chatMessages,

    temperature:
      task === 'job_verification'
        ? 0.2
        : 0.7,

    max_tokens:
      4096,
  };
}

/*
|--------------------------------------------------------------------------
| Extract answer
|--------------------------------------------------------------------------
*/

function extractAnswer(
  payload,
  provider
) {
  /*
   * Gemini.
   */
  if (
    provider === 'gemini'
  ) {
    const candidates =
      Array.isArray(
        payload?.candidates
      )
        ? payload.candidates
        : [];

    const parts =
      candidates[0]
        ?.content
        ?.parts || [];

    const text =
      parts
        .map((part) =>
          typeof part?.text === 'string'
            ? part.text
            : ''
        )
        .join('')
        .trim();

    if (text) {
      return text;
    }
  }

  /*
   * OpenAI-compatible.
   */
  const choiceContent =
    payload
      ?.choices?.[0]
      ?.message
      ?.content;

  if (
    typeof choiceContent ===
      'string' &&
    choiceContent.trim()
  ) {
    return choiceContent.trim();
  }

  /*
   * Content arrays.
   */
  if (
    Array.isArray(
      choiceContent
    )
  ) {
    const joined =
      choiceContent
        .map((part) => {
          if (
            typeof part ===
            'string'
          ) {
            return part;
          }

          return (
            part?.text ||
            ''
          );
        })
        .join('')
        .trim();

    if (joined) {
      return joined;
    }
  }

  /*
   * Generic fallback.
   */
  const fallback =
    payload?.output?.text ||
    payload?.text ||
    '';

  if (
    typeof fallback ===
      'string' &&
    fallback.trim()
  ) {
    return fallback.trim();
  }

  return '';
}

/*
|--------------------------------------------------------------------------
| Extract Google grounding sources
|--------------------------------------------------------------------------
*/

function extractGroundingSources(
  payload
) {
  const metadata =
    payload
      ?.candidates?.[0]
      ?.groundingMetadata;

  if (!metadata) {
    return [];
  }

  const chunks =
    metadata.groundingChunks ||
    [];

  return chunks
    .map((chunk) => {
      const web =
        chunk?.web;

      if (
        web?.uri ||
        web?.title
      ) {
        return {
          title:
            web.title ||
            'Source',

          url:
            web.uri ||
            null,
        };
      }

      return null;
    })
    .filter(Boolean);
}

/*
|--------------------------------------------------------------------------
| Provider auth headers
|--------------------------------------------------------------------------
*/

function getProviderAuthHeaders(
  provider
) {
  const key =
    getProviderKey(provider);

  switch (provider) {
    case 'gemini':
      return {};

    case 'groq':
    case 'cerebras':
    case 'openrouter':
    case 'deepseek':
      return {
        Authorization:
          `Bearer ${key}`,
      };

    default:
      return {};
  }
}

/*
|--------------------------------------------------------------------------
| Abort / timeout
|--------------------------------------------------------------------------
*/

function createAbortController(
  timeoutMs =
    DEFAULT_TIMEOUT_MS
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      timeoutMs
    );

  return {
    controller,
    timer,
  };
}

/*
|--------------------------------------------------------------------------
| Call provider
|--------------------------------------------------------------------------
*/

async function callProvider(
  provider,
  messages,
  task,
  attachments = []
) {
  const config =
    getProviderConfig(
      provider,
      task
    );

  const providerKey =
    getProviderKey(
      provider
    );

  if (!providerKey) {
    const error =
      new Error(
        `${provider}_key_missing`
      );

    error.code =
      'KEY_MISSING';

    error.status =
      401;

    throw error;
  }

  const body =
    buildProviderPayload(
      provider,
      messages,
      task,
      attachments
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
     * OpenRouter.
     */
    if (
      provider ===
      'openrouter'
    ) {
      headers[
        'HTTP-Referer'
      ] =
        process.env.OPENROUTER_SITE_URL ||
        'https://facemex.online';

      headers[
        'X-Title'
      ] =
        process.env.OPENROUTER_APP_NAME ||
        'FaceMeX';
    }

    const response =
      await fetch(
        config.endpoint,
        {
          method: 'POST',

          headers,

          body:
            JSON.stringify(body),

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
          ? JSON.parse(
              rawText
            )
          : {};
    } catch {
      data = {
        raw: rawText,
      };
    }

    if (
      !response.ok
    ) {
      const errorMessage =
        data?.error
          ?.message ||
        data?.message ||
        data?.error ||
        rawText ||
        `provider_${provider}_failed`;

      const error =
        new Error(
          String(
            errorMessage
          )
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

      error.status =
        502;

      error.provider =
        provider;

      throw error;
    }

    const sources =
      provider === 'gemini'
        ? extractGroundingSources(
            data
          )
        : [];

    return {
      success: true,

      provider,

      model:
        config.model,

      task,

      content,

      response:
        content,

      text:
        content,

      sources,

      searched:
        sources.length > 0,
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

      timeoutError.status =
        408;

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
| Retry logic
|--------------------------------------------------------------------------
*/

export function isRetryableFailure(
  error
) {
  if (!error) {
    return true;
  }

  const status =
    Number(
      error.status || 0
    );

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
    retryableStatuses.has(
      status
    )
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
      message.includes(
        word
      )
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

  if (
    messages.length === 0
  ) {
    messages.push({
      role: 'user',

      content:
        'Hello, introduce yourself as FaceMeX AI.',
    });
  }

  const attachments =
    normalizeAttachments(
      payload
    );

  const lastUserMessage =
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role ===
          'user'
      );

  const task =
    detectTask(
      lastUserMessage
        ?.content || '',
      attachments,
      String(
        payload.task ||
        ''
      ).trim()
    );

  const providers =
    ROUTES[task] ||
    DEFAULT_PROVIDER_ORDER;

  const errors = [];

  console.log(
    `[FaceMeX AI] Task: ${task}`
  );

  console.log(
    `[FaceMeX AI] Providers: ${providers.join(
      ' -> '
    )}`
  );

  if (
    attachments.length
  ) {
    console.log(
      `[FaceMeX AI] Attachments: ${attachments.length}`
    );
  }

  for (
    const provider
    of providers
  ) {
    try {
      console.log(
        `[FaceMeX AI] Trying ${provider} for ${task}...`
      );

      const result =
        await callProvider(
          provider,
          messages,
          task,
          attachments
        );

      console.log(
        `[FaceMeX AI] ${provider} succeeded for ${task}`
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

      if (
        isRetryableFailure(
          error
        )
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

    task,

    details:
      errors,
  };
}

/*
|--------------------------------------------------------------------------
| Express request normalization
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
      suppliedMessages.length
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
      '',

    provider:
      body.provider ||
      query.provider ||
      null,

    attachments:
      body.attachments ||
      body.files ||
      [],

    image:
      body.image ||
      null,

    imageMimeType:
      body.imageMimeType ||
      null,

    file:
      body.file ||
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
  if (
    result?.success
  ) {
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

        task:
          result.task ||
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

        sources:
          result.sources ||
          [],

        searched:
          Boolean(
            result.searched
          ),
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

      task:
        result?.task ||
        null,

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
   * HEALTH
   */
  router.get(
    '/health',
    (req, res) => {
      const providers =
        [
          'gemini',
          'groq',
          'cerebras',
          'openrouter',
          'deepseek',
        ].map(
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

      res
        .status(200)
        .json({
          ok: true,

          service:
            'facemex-ai-router',

          routes:
            Object.keys(
              ROUTES
            ),

          providers,
        });
    }
  );

  /*
   * TEST
   */
  router.get(
    '/test',
    async (
      req,
      res
    ) => {
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
    async (
      req,
      res
    ) => {
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
              payload.task ||
              'auto',

            attachments:
              payload.attachments
                ?.length || 0,
          }
        );

        const result =
          await generateAIResponse({
            messages:
              payload.messages,

            task:
              payload.task,

            attachments:
              payload.attachments,

            image:
              payload.image,

            imageMimeType:
              payload.imageMimeType,

            file:
              payload.file,
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
   * DEEPSEEK BACKWARD COMPATIBILITY
   */
  router.post(
    '/deepseek',
    async (
      req,
      res
    ) => {
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
              'general_chat',

            attachments:
              payload.attachments,

            image:
              payload.image,

            imageMimeType:
              payload.imageMimeType,

            file:
              payload.file,
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
              'AI route failed',
          });
      }
    }
  );

  /*
   * WORKSPACE
   */
  router.post(
    '/workspace',
    async (
      req,
      res
    ) => {
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
              'workspace_assistant',

            attachments:
              payload.attachments,

            image:
              payload.image,

            imageMimeType:
              payload.imageMimeType,

            file:
              payload.file,
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
   * JOB ASSISTANT
   */
  router.post(
    '/pro/job-assistant',
    async (
      req,
      res
    ) => {
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

            attachments:
              payload.attachments,
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
   * RESUME BUILDER
   */
  router.post(
    '/pro/resume-builder',
    async (
      req,
      res
    ) => {
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

            attachments:
              payload.attachments,
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
   * COVER LETTER
   */
  router.post(
    '/pro/cover-letter',
    async (
      req,
      res
    ) => {
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

            attachments:
              payload.attachments,
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
    typeof app.use !==
      'function'
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
  ROUTES,

  PROVIDER_ORDER:
    DEFAULT_PROVIDER_ORDER,

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
