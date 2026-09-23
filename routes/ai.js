import { api } from './api';

/*
|--------------------------------------------------------------------------
| FACEMEX AI CLIENT
|--------------------------------------------------------------------------
|
| GENERAL AI
|   Groq -> Gemini -> Cerebras -> OpenRouter -> DeepSeek
|
| IMAGE
|   Gemini Vision
|
| DOCUMENT
|   Gemini
|
| JOB SEARCH
|   Gemini + Google Search
|
| JOB VERIFICATION
|   Gemini + Google Search
|
| DOCUMENT VERIFICATION
|   Gemini + Google Search
|
| WEB VERIFICATION
|   Gemini + Google Search
|
| LESSON / HOMEWORK
|   General AI unless current web information is required
|
|--------------------------------------------------------------------------
*/

export interface AIReplyContextMessage {
  sender: string;
  content: string;
}

export interface AIReplyImage {
  data: string;
  mimeType: string;
  name?: string;
}

export interface AIReplyDocument {
  data?: string;
  url?: string;
  mimeType: string;
  name?: string;
}

export interface AIReplyOptions {
  context: AIReplyContextMessage[];

  userMessage: string;

  tone?: 'professional' | 'casual' | 'friendly';

  maxLength?: number;

  image?: AIReplyImage | null;

  document?: AIReplyDocument | null;

  verify?: boolean;

  /*
   * Explicit request type.
   */
  type?:
    | 'reply'
    | 'vision'
    | 'document'
    | 'lesson'
    | 'homework'
    | 'job-search'
    | 'job-verification'
    | 'document-verification'
    | 'web-verification';
}

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function hasImage(
  image?: AIReplyImage | null
): boolean {
  return Boolean(
    image &&
      typeof image.data === 'string' &&
      image.data.trim().length > 0
  );
}

function hasDocument(
  document?: AIReplyDocument | null
): boolean {
  return Boolean(
    document &&
      (
        (
          typeof document.data === 'string' &&
          document.data.trim().length > 0
        ) ||
        (
          typeof document.url === 'string' &&
          document.url.trim().length > 0
        )
      )
  );
}

/*
|--------------------------------------------------------------------------
| TEXT DETECTION
|--------------------------------------------------------------------------
*/

function looksLikeVerificationRequest(
  message: string
): boolean {
  const text = message.toLowerCase();

  const words = [
    'verify',
    'verification',
    'is this real',
    'is this legitimate',
    'is this legit',
    'is this genuine',
    'is this fake',
    'is this a scam',
    'scam',
    'legitimate',
    'authentic',
    'real job',
    'real vacancy',
    'real company',
    'real document',
    'check this job',
    'check this vacancy',
    'check this document',
    'confirm this job',
    'confirm this vacancy',
    'confirm this company',
  ];

  return words.some((word) =>
    text.includes(word)
  );
}

function looksLikeJobSearchRequest(
  message: string
): boolean {
  const text = message.toLowerCase();

  const words = [
    'find me a job',
    'find jobs',
    'find a job',
    'job search',
    'search for jobs',
    'search jobs',
    'jobs near',
    'jobs in',
    'vacancies in',
    'vacancy in',
    'hiring in',
    'employment opportunities',
    'work opportunities',
    'career opportunities',
    'latest jobs',
    'current jobs',
    'available jobs',
    'job openings',
    'job opportunities',
    'internships',
    'internship opportunities',
    'learnerships',
    'learnership opportunities',
  ];

  return words.some((word) =>
    text.includes(word)
  );
}

function looksLikeLessonRequest(
  message: string
): boolean {
  const text = message.toLowerCase();

  const words = [
    'summarize this lesson',
    'summarise this lesson',
    'summarize the lesson',
    'summarise the lesson',
    'explain this lesson',
    'explain the lesson',
    'teach me this lesson',
    'what is this lesson about',
    'lesson summary',
    'lesson explanation',
    'help me understand this lesson',
    'what did i learn',
    'summarise this',
    'summarize this',
  ];

  return words.some((word) =>
    text.includes(word)
  );
}

function looksLikeHomeworkRequest(
  message: string
): boolean {
  const text = message.toLowerCase();

  const words = [
    'homework',
    'assignment',
    'solve this',
    'solve the question',
    'help me with this question',
    'explain this question',
    'answer this question',
    'help me understand',
    'step by step',
  ];

  return words.some((word) =>
    text.includes(word)
  );
}

/*
|--------------------------------------------------------------------------
| REQUEST TYPE
|--------------------------------------------------------------------------
*/

function determineRequestType(
  options: AIReplyOptions
):
  | 'reply'
  | 'vision'
  | 'document'
  | 'lesson'
  | 'homework'
  | 'job-search'
  | 'job-verification'
  | 'document-verification'
  | 'web-verification' {

  const {
    userMessage,
    image,
    document,
    verify,
    type,
  } = options;

  /*
   * Explicit type ALWAYS wins.
   *
   * This is important because the backend must not
   * guess what the frontend already knows.
   */
  if (type) {
    return type;
  }

  const verificationRequested =
    Boolean(verify) ||
    looksLikeVerificationRequest(
      userMessage
    );

  const jobSearchRequested =
    looksLikeJobSearchRequest(
      userMessage
    );

  /*
   * Job + attachment + verification
   */
  if (
    jobSearchRequested &&
    (
      hasImage(image) ||
      hasDocument(document)
    ) &&
    verificationRequested
  ) {
    return 'job-verification';
  }

  /*
   * Document verification
   */
  if (
    hasDocument(document) &&
    verificationRequested
  ) {
    return 'document-verification';
  }

  /*
   * Image verification
   */
  if (
    hasImage(image) &&
    verificationRequested
  ) {
    return 'web-verification';
  }

  /*
   * Live job search
   */
  if (jobSearchRequested) {
    return 'job-search';
  }

  /*
   * Image analysis
   */
  if (hasImage(image)) {
    return 'vision';
  }

  /*
   * Document analysis
   */
  if (hasDocument(document)) {
    return 'document';
  }

  /*
   * Lesson
   */
  if (
    looksLikeLessonRequest(
      userMessage
    )
  ) {
    return 'lesson';
  }

  /*
   * Homework
   */
  if (
    looksLikeHomeworkRequest(
      userMessage
    )
  ) {
    return 'homework';
  }

  return 'reply';
}

/*
|--------------------------------------------------------------------------
| CONTEXT
|--------------------------------------------------------------------------
*/

function buildConversationContext(
  context: AIReplyContextMessage[]
): string {

  return context
    .slice(-8)
    .map((message) => {

      const sender =
        String(
          message.sender || 'User'
        ).trim();

      const content =
        String(
          message.content || ''
        ).trim();

      if (!content) {
        return '';
      }

      return `${sender}: ${content}`;

    })
    .filter(Boolean)
    .join('\n');
}

/*
|--------------------------------------------------------------------------
| PROMPTS
|--------------------------------------------------------------------------
*/

function buildNormalReplyPrompt(
  options: AIReplyOptions
): string {

  const {
    context,
    userMessage,
    tone = 'casual',
    maxLength = 150,
  } = options;

  const toneInstruction = {
    professional:
      'Write professionally, clearly and politely.',

    casual:
      'Write naturally and casually like a real person texting.',

    friendly:
      'Write warmly, naturally and friendly.',
  }[tone];

  return `
You are FaceMeX AI.

Help the user respond naturally to the latest message.

Recent conversation:
${buildConversationContext(context) || '(No previous conversation)'}

Latest user request:
${userMessage}

Tone:
${toneInstruction}

Rules:
- Answer the actual request.
- Return ONLY the response.
- Do not explain your reasoning.
- Do not mention that you are an AI.
- Do not use quotation marks around the response.
- Keep it natural.
- Keep it concise.
- Do not ask unnecessary questions.
- Maximum ${maxLength} characters.
`.trim();
}

/*
|--------------------------------------------------------------------------
| VISION PROMPT
|--------------------------------------------------------------------------
*/

function buildVisionPrompt(
  options: AIReplyOptions
): string {

  return `
You are FaceMeX AI's visual analysis assistant.

The user has attached an image.

You MUST analyze the actual image before answering.

User's question:
${options.userMessage}

Rules:

- Inspect the attached image carefully.
- Read visible text when possible.
- Describe only information actually visible.
- Do not invent missing information.
- If this is a job advertisement, identify:
  - employer
  - position
  - location
  - requirements
  - closing date
  - reference number
  - application instructions
- If something is unreadable, say so.
- If the user asks whether the image is legitimate, do NOT determine legitimacy from appearance alone.
- Explain what can and cannot be determined from the image.

Give the user a useful answer.

Do not talk about internal routing or APIs.
`.trim();
}

/*
|--------------------------------------------------------------------------
| DOCUMENT PROMPT
|--------------------------------------------------------------------------
*/

function buildDocumentPrompt(
  options: AIReplyOptions
): string {

  return `
You are FaceMeX AI's document analysis assistant.

The user has attached a document.

User's question:
${options.userMessage}

Rules:

- Analyze the actual document.
- Use the document contents.
- Do not invent missing information.
- Accurately handle:
  - dates
  - names
  - numbers
  - tables
  - requirements
  - reference numbers
  - application instructions
- If asked to summarize, summarize the actual document.
- If asked to explain something, explain it clearly.
- If asked whether the document is legitimate, do not determine legitimacy from appearance alone.
- Explain what requires external verification.

Return a clear answer.
`.trim();
}

/*
|--------------------------------------------------------------------------
| LESSON PROMPT
|--------------------------------------------------------------------------
*/

function buildLessonPrompt(
  options: AIReplyOptions
): string {

  const context =
    buildConversationContext(
      options.context
    );

  return `
You are FaceMeX AI's learning assistant.

The user is asking about an educational lesson.

User request:
${options.userMessage}

Lesson/conversation context:
${context || '(No additional lesson text was supplied)'}

IMPORTANT:

Do NOT answer with a generic description of FaceMeX.

Do NOT describe the "Homework Help process" unless that is actually what the user asked about.

The user wants help with the actual lesson.

If the lesson content is available in the context:
- Identify the main topic.
- Summarize the actual lesson.
- Explain the important concepts.
- Highlight key terms.
- Give simple examples where useful.
- Keep the explanation appropriate for a learner.
- Do not invent lesson content.

If the actual lesson content is NOT available:
- Clearly say that the lesson content was not supplied.
- Ask the user to provide the lesson text, screenshot or material.
- Do not invent a summary.

When summarizing:
1. Main idea
2. Key concepts
3. Important facts
4. Simple explanation
5. What the learner should remember

Return the educational answer directly.
`.trim();
}

/*
|--------------------------------------------------------------------------
| HOMEWORK PROMPT
|--------------------------------------------------------------------------
*/

function buildHomeworkPrompt(
  options: AIReplyOptions
): string {

  const context =
    buildConversationContext(
      options.context
    );

  return `
You are FaceMeX AI's Homework Help assistant.

Student request:
${options.userMessage}

Recent context:
${context || '(No previous context)'}

Help the student understand the problem.

Rules:
- Explain step by step.
- Do not simply give an unexplained answer.
- Use simple language.
- Show calculations when necessary.
- Explain important terms.
- Do not invent information.
- If information is missing, ask for it.
- If there is a correct final answer, clearly identify it.
- Help the learner understand how to solve similar problems.

Return the answer directly.
`.trim();
}

/*
|--------------------------------------------------------------------------
| VERIFICATION PROMPT
|--------------------------------------------------------------------------
*/

function buildVerificationPrompt(
  options: AIReplyOptions
): string {

  return `
You are FaceMeX Verification AI.

The user wants information verified using current web sources.

User request:
${options.userMessage}

IMPORTANT:

1. Analyze the supplied image or document when one is attached.

2. Extract useful identifying information.

3. Identify:
   - organizations
   - companies
   - institutions
   - job titles
   - reference numbers
   - dates
   - locations
   - websites
   - application information

4. Use current web search to verify the information.

5. Prefer authoritative sources:
   - Government websites
   - Official company websites
   - Official university websites
   - Official recruitment portals
   - Official institutional sources

6. Compare the supplied information against current sources.

7. Clearly distinguish:
   - What the attachment says
   - What the web sources say
   - What is confirmed
   - What could not be confirmed
   - What conflicts

8. Never call a job legitimate merely because the poster looks professional.

9. Never invent a source.

10. Never invent an application URL.

11. If no authoritative matching source can be found, say so.

For job advertisements identify where available:

- Employer
- Position
- Location
- Closing date
- Reference number
- Application method
- Official listing
- Application URL
- Any mismatch between the attachment and official source

Use careful verification language:

"Confirmed by official source"

"Matching official listing found"

"Could not independently verify"

"Details do not match"

"Needs further verification"

Do not claim certainty beyond the evidence.

Return a useful evidence-based verification.
`.trim();
}

/*
|--------------------------------------------------------------------------
| PAYLOAD
|--------------------------------------------------------------------------
*/

function buildPayload(
  options: AIReplyOptions,
  requestType: ReturnType<
    typeof determineRequestType
  >
) {

  const maxLength =
    options.maxLength ?? 150;

  let prompt: string;

  switch (requestType) {

    case 'vision':
      prompt =
        buildVisionPrompt(options);
      break;

    case 'document':
      prompt =
        buildDocumentPrompt(options);
      break;

    case 'lesson':
      prompt =
        buildLessonPrompt(options);
      break;

    case 'homework':
      prompt =
        buildHomeworkPrompt(options);
      break;

    case 'job-verification':
    case 'document-verification':
    case 'web-verification':
      prompt =
        buildVerificationPrompt(options);
      break;

    case 'job-search':
      prompt = `
You are FaceMeX's live job search assistant.

Find CURRENT jobs matching the user's request.

User request:
${options.userMessage}

Use live web search.

Prioritize:
- Official employer websites
- Government websites
- University websites
- Official recruitment portals

Never invent jobs.

Never invent employers.

Never invent application URLs.

For each useful result provide:
- Job title
- Employer
- Location
- Closing date if available
- Source
- Application URL if available
- Important requirements if available

Clearly distinguish official sources from third-party job boards.

If a job cannot be independently verified, say so.
`.trim();
      break;

    case 'reply':
    default:
      prompt =
        buildNormalReplyPrompt(
          options
        );
      break;
  }

  const isVerification =
    requestType ===
      'job-verification' ||
    requestType ===
      'document-verification' ||
    requestType ===
      'web-verification';

  const isLiveSearch =
    requestType ===
      'job-search' ||
    isVerification;

  return {

    /*
     * This gives the backend the exact task.
     */
    task:
      requestType === 'vision'
        ? 'vision'
        : requestType === 'document'
        ? 'document'
        : requestType === 'lesson'
        ? 'lesson_explanation'
        : requestType === 'homework'
        ? 'homework'
        : requestType === 'job-search'
        ? 'job_search'
        : requestType ===
          'job-verification'
        ? 'job_verification'
        : requestType ===
          'document-verification'
        ? 'document_verification'
        : requestType ===
          'web-verification'
        ? 'job_verification'
        : 'general_chat',

    type: requestType,

    prompt,

    message:
      options.userMessage,

    context:
      options.context,

    verify:
      Boolean(options.verify) ||
      isVerification,

    googleSearch:
      isLiveSearch,

    maxLength,

    image:
      hasImage(options.image)
        ? {
            data:
              options.image!.data,

            mimeType:
              options.image!
                .mimeType ||
              'image/jpeg',

            name:
              options.image!.name,
          }
        : null,

    document:
      hasDocument(
        options.document
      )
        ? {
            data:
              options.document?.data,

            url:
              options.document?.url,

            mimeType:
              options.document!
                .mimeType ||
              'application/pdf',

            name:
              options.document?.name,
          }
        : null,
  };
}

/*
|--------------------------------------------------------------------------
| RESPONSE EXTRACTION
|--------------------------------------------------------------------------
*/

function extractReply(
  data: any
): string {

  let reply = String(
    data?.text ??
      data?.reply ??
      data?.content ??
      data?.response ??
      data?.message ??
      ''
  ).trim();

  if (!reply) {
    throw new Error(
      'The AI service returned an empty response.'
    );
  }

  /*
   * Remove accidental markdown code fences.
   */
  reply = reply
    .replace(
      /^```(?:text|markdown)?/i,
      ''
    )
    .replace(
      /```$/i,
      ''
    )
    .trim();

  /*
   * Remove unnecessary wrapping quotes.
   */
  if (
    (
      reply.startsWith('"') &&
      reply.endsWith('"')
    ) ||
    (
      reply.startsWith("'") &&
      reply.endsWith("'")
    )
  ) {
    reply = reply
      .substring(
        1,
        reply.length - 1
      )
      .trim();
  }

  return reply;
}

/*
|--------------------------------------------------------------------------
| ERROR EXTRACTION
|--------------------------------------------------------------------------
*/

function extractErrorDetails(
  error: unknown
): string {

  if (
    error instanceof Error &&
    error.message
  ) {

    try {

      const parsed =
        JSON.parse(
          error.message
        );

      return (
        parsed?.error ||
        parsed?.message ||
        parsed?.details ||
        error.message
      );

    } catch {

      return error.message;
    }
  }

  return 'Please try again.';
}

/*
|--------------------------------------------------------------------------
| MAIN AI FUNCTION
|--------------------------------------------------------------------------
*/

export async function generateAIReply(
  options: AIReplyOptions
): Promise<string> {

  const maxLength =
    options.maxLength ?? 150;

  const requestType =
    determineRequestType(
      options
    );

  const payload =
    buildPayload(
      options,
      requestType
    );

  console.log(
    '[FaceMeX AI] Client request:',
    {
      type:
        requestType,

      task:
        payload.task,

      googleSearch:
        payload.googleSearch,

      hasImage:
        Boolean(
          payload.image
        ),

      hasDocument:
        Boolean(
          payload.document
        ),
    }
  );

  try {

    /*
     * ALL requests use the same backend entry point.
     *
     * The backend decides:
     *
     * General -> Groq first
     * Search -> Gemini + Google Search
     * Image -> Gemini
     * Verification -> Gemini + Search
     */
    const data =
      await api.post(
        '/api/ai/reply',
        payload
      );

    let reply =
      extractReply(data);

    /*
     * Verification and job-search responses
     * MUST NOT be aggressively truncated.
     */
    const noTruncate =
      requestType ===
        'job-search' ||
      requestType ===
        'job-verification' ||
      requestType ===
        'document-verification' ||
      requestType ===
        'web-verification' ||
      requestType ===
        'vision' ||
      requestType ===
        'document' ||
      requestType ===
        'lesson' ||
      requestType ===
        'homework';

    if (
      noTruncate ||
      reply.length <= maxLength
    ) {
      return reply;
    }

    /*
     * Normal social/chat replies can be short.
     */
    return (
      reply
        .substring(
          0,
          Math.max(
            0,
            maxLength - 3
          )
        )
        .trimEnd() +
      '...'
    );

  } catch (error) {

    console.error(
      '[FaceMeX AI] Request failed:',
      error
    );

    const details =
      extractErrorDetails(
        error
      );

    throw new Error(
      `Failed to generate FaceMeX AI response. ${details}`
    );
  }
}
