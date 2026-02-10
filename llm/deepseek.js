import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import gpt4all from 'gpt4all';

const { GPT4All } = gpt4all;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let client = null;
let loadingPromise = null;

function findModelFile() {
  const envDir = process.env.DEEPSEEK_MODEL_PATH;
  const defaultDir = envDir || 'C:/Users/luck/AppData/Local/nomic.ai/GPT4All';
  let dir = defaultDir;

  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const files = fs.readdirSync(dir);
  const candidates = files.filter((f) => /\.(gguf|bin|gpt4all|chat)$/i.test(f));
  if (candidates.length === 0) return null;

  // Prefer DeepSeek-named models
  const deepseek = candidates.find((f) => /deepseek/i.test(f));
  const chosen = deepseek || candidates[0];

  return { dir, file: chosen };
}

async function getClient() {
  if (client) return client;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const found = findModelFile();
    if (!found) {
      throw new Error('No DeepSeek/GPT4All model file found in DEEPSEEK_MODEL_PATH');
    }

    const modelName = found.file; // GPT4All will resolve from modelPath
    const gpt = new GPT4All(modelName, {
      modelPath: found.dir,
      verbose: false,
    });

    await gpt.init();
    await gpt.open();
    client = gpt;
    return client;
  })();

  return loadingPromise;
}

export async function generateResponse(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt is required');
  }

  const useLocal = String(process.env.USE_LOCAL_AI || 'true').toLowerCase() === 'true';
  if (!useLocal) {
    throw new Error('USE_LOCAL_AI is not enabled on the server');
  }

  const gpt = await getClient();
  const text = await gpt.prompt(prompt, {
    temp: 0.7,
    topP: 0.9,
    nPredict: 512,
  });
  return text?.toString() || '';
}
