import { generateResponse } from '../llm/deepseek.js';

// Returns an async function(prompt: string) => Promise<any JSON parsed response>
// Prefers local DeepSeek; falls back to OpenAI if DeepSeek is not available.
export async function getAIClient() {
  const useLocal = String(process.env.USE_LOCAL_AI || 'true').toLowerCase() === 'true';
  const hasDeepseek = !!process.env.DEEPSEEK_MODEL_PATH;
  const openaiKey = process.env.OPENAI_API_KEY;

  // 1) Try local DeepSeek JSON-style client
  if (useLocal && hasDeepseek) {
    return async (prompt) => {
      try {
        const raw = await generateResponse(prompt);
        try {
          return JSON.parse(raw);
        } catch {
          return {};
        }
      } catch (e) {
        console.error('DeepSeek safety helper error', e);
        return {};
      }
    };
  }

  // 2) Fallback to OpenAI if configured
  if (!openaiKey) return null;

  let OpenAI;
  try {
    const mod = await import('openai');
    OpenAI = mod.default || mod.OpenAI || mod;
  } catch (e) {
    console.warn('OpenAI SDK not available for safety helpers, skipping AI layer.', e);
    return null;
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  return async (prompt) => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content:
            'You are a strict safety classifier. Respond ONLY with a single valid JSON object, no commentary.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };
}
