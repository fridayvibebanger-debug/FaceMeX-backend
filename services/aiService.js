import gpt4allPkg from "gpt4all";
const GPT4AllCtor = (gpt4allPkg && (gpt4allPkg.GPT4All || gpt4allPkg.default || gpt4allPkg));

const aiCache = new Map(); // modelFile -> instance

export async function initAI(modelFile) {
  try {
    if (!modelFile) {
      // Preload all configured models from env if no specific filename provided
      const files = [
        process.env.LOCAL_GPT4ALL_MODEL_CHAT,
        process.env.LOCAL_GPT4ALL_MODEL_UTILITY,
        process.env.LOCAL_GPT4ALL_MODEL_TOOLS,
      ].filter(Boolean);
      if (!files.length) {
        throw new Error('Model filename required');
      }
      for (const f of files) {
        try { await initAI(f); } catch (e) { /* continue loading others */ }
      }
      return {
        ok: true,
        loaded: files.filter(f => aiCache.has(f)),
      };
    }
    const existing = aiCache.get(modelFile);
    if (existing) return existing;

    if (typeof GPT4AllCtor !== 'function') {
      throw new Error('GPT4All constructor not found from gpt4all package');
    }

    const modelDir = process.env.GPT4ALL_MODEL_DIR || "./models";
    const inst = new GPT4AllCtor(modelFile, {
      modelPath: modelDir
    });

    await inst.init();
    // Some GPT4All versions require an explicit open() after init
    if (typeof inst.open === 'function') {
      await inst.open();
    }
    aiCache.set(modelFile, inst);
    console.log(`🔥 Local model loaded: ${modelFile} (dir: ${modelDir})`);

    return inst;
  } catch (err) {
    console.error("❌ Failed to load local GPT4All model:", err.message);
    throw err;
  }
}

export async function askAIWithModel(modelFile, prompt) {
  const gpt = await initAI(modelFile);
  const output = await gpt.prompt(prompt);
  return output;
}

export async function askChat(prompt) {
  const modelFile = process.env.LOCAL_GPT4ALL_MODEL_CHAT || process.env.LOCAL_GPT4ALL_MODEL || "deepseek-r1-chat.Q4_0.gguf";
  return askAIWithModel(modelFile, prompt);
}

export async function askUtility(prompt) {
  const modelFile = process.env.LOCAL_GPT4ALL_MODEL_UTILITY || "llama-3.2-1b-instruct.Q4_0.gguf";
  return askAIWithModel(modelFile, prompt);
}

export async function askTools(prompt) {
  const modelFile = process.env.LOCAL_GPT4ALL_MODEL_TOOLS || "qwen2-1_5b-instruct-q4_0.gguf";
  return askAIWithModel(modelFile, prompt);
}
