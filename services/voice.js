import {
  PollyClient,
  SynthesizeSpeechCommand,
} from '@aws-sdk/client-polly';

const TTS_PROVIDERS = ['elevenlabs', 'polly'];
const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

export class VoiceProviderError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'VoiceProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function providerAvailability(env) {
  return {
    deepgram: Boolean(env.DEEPGRAM_API_KEY),
    elevenlabs: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID && env.ELEVENLABS_MODEL_ID),
    polly: Boolean(
      env.AWS_ACCESS_KEY_ID &&
      env.AWS_SECRET_ACCESS_KEY &&
      env.AWS_REGION &&
      env.AWS_POLLY_VOICE_ID,
    ),
  };
}

export function getVoiceProviderConfig(env = process.env) {
  const available = providerAvailability(env);
  const defaultProvider = available.elevenlabs
    ? 'elevenlabs'
    : available.polly
      ? 'polly'
      : null;
  const configuredFallback = env.VOICE_TTS_FALLBACK_PROVIDER;
  const fallbackProvider = TTS_PROVIDERS.includes(configuredFallback) &&
    configuredFallback !== defaultProvider &&
    available[configuredFallback]
    ? configuredFallback
    : defaultProvider === 'elevenlabs' && available.polly
      ? 'polly'
      : defaultProvider === 'polly' && available.elevenlabs
        ? 'elevenlabs'
        : null;

  return {
    transcription: {
      provider: 'deepgram',
      available: available.deepgram,
      model: env.DEEPGRAM_MODEL || 'nova-3',
      language: env.DEEPGRAM_LANGUAGE || 'en-US',
      maxAudioBytes: 8 * 1024 * 1024,
    },
    tts: {
      defaultProvider,
      fallbackProvider,
      outputFormat: 'mp3',
      maxTextLength: 2500,
      providers: {
        elevenlabs: { available: available.elevenlabs },
        polly: { available: available.polly },
      },
    },
  };
}

function createTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error('Voice provider request timed out.');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function providerStatus(status) {
  return status === 429 ? 429 : 502;
}

async function readAudioStream(stream) {
  if (!stream) return Buffer.alloc(0);
  if (typeof stream.transformToByteArray === 'function') {
    return Buffer.from(await stream.transformToByteArray());
  }
  if (Buffer.isBuffer(stream) || stream instanceof Uint8Array) {
    return Buffer.from(stream);
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createVoiceService({
  env = process.env,
  fetchImpl = fetch,
  createPollyClient = (options) => new PollyClient(options),
} = {}) {
  let pollyClient;

  function getPollyClient() {
    if (!pollyClient) {
      const credentials = env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined;
      pollyClient = createPollyClient({
        region: env.AWS_REGION,
        ...(credentials ? { credentials } : {}),
      });
    }
    return pollyClient;
  }

  async function transcribe({ audio, mimeType, language }) {
    if (!env.DEEPGRAM_API_KEY) {
      throw new VoiceProviderError(
        'deepgram_not_configured',
        'Speech recognition is not configured.',
        503,
      );
    }

    const model = env.DEEPGRAM_MODEL || 'nova-3';
    const selectedLanguage = language || env.DEEPGRAM_LANGUAGE || 'en-US';
    const endpoint = new URL(DEEPGRAM_URL);
    endpoint.searchParams.set('model', model);
    endpoint.searchParams.set('language', selectedLanguage);
    endpoint.searchParams.set('smart_format', 'true');

    const timeout = createTimeout(20_000);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
          'Content-Type': mimeType,
        },
        body: audio,
        signal: timeout.signal,
      });
      if (!response.ok) {
        throw new VoiceProviderError(
          'deepgram_request_failed',
          'Speech recognition could not process this recording.',
          providerStatus(response.status),
        );
      }

      let data;
      try {
        data = await response.json();
      } catch {
        throw new VoiceProviderError(
          'deepgram_invalid_response',
          'Speech recognition returned an invalid response.',
        );
      }
      const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      if (typeof text !== 'string') {
        throw new VoiceProviderError(
          'deepgram_invalid_response',
          'Speech recognition returned an invalid response.',
        );
      }

      return { text: text.trim(), provider: 'deepgram', model, language: selectedLanguage };
    } catch (error) {
      if (error instanceof VoiceProviderError) throw error;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new VoiceProviderError(
        timedOut ? 'deepgram_timeout' : 'deepgram_unavailable',
        timedOut ? 'Speech recognition timed out. Please try again.' : 'Speech recognition is temporarily unavailable.',
        timedOut ? 504 : 502,
      );
    } finally {
      timeout.clear();
    }
  }

  async function synthesizeWithElevenLabs(text) {
    const endpoint = new URL(
      `${ELEVENLABS_URL}/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}`,
    );
    endpoint.searchParams.set('output_format', 'mp3_44100_128');

    const timeout = createTimeout(25_000);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: env.ELEVENLABS_MODEL_ID,
        }),
        signal: timeout.signal,
      });
      if (!response.ok) {
        throw new VoiceProviderError(
          'elevenlabs_request_failed',
          'ElevenLabs could not generate speech.',
          providerStatus(response.status),
        );
      }

      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) {
        throw new VoiceProviderError('elevenlabs_empty_audio', 'ElevenLabs returned empty audio.');
      }
      return { audio, mimeType: 'audio/mpeg', provider: 'elevenlabs' };
    } catch (error) {
      if (error instanceof VoiceProviderError) throw error;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new VoiceProviderError(
        timedOut ? 'elevenlabs_timeout' : 'elevenlabs_unavailable',
        timedOut ? 'ElevenLabs speech generation timed out.' : 'ElevenLabs speech generation is temporarily unavailable.',
        timedOut ? 504 : 502,
      );
    } finally {
      timeout.clear();
    }
  }

  async function synthesizeWithPolly(text) {
    const timeout = createTimeout(25_000);
    try {
      const result = await getPollyClient().send(
        new SynthesizeSpeechCommand({
          Text: text,
          VoiceId: env.AWS_POLLY_VOICE_ID,
          OutputFormat: 'mp3',
          Engine: env.AWS_POLLY_ENGINE || 'neural',
        }),
        { abortSignal: timeout.signal },
      );
      const audio = await readAudioStream(result?.AudioStream);
      if (!audio.length) {
        throw new VoiceProviderError('polly_empty_audio', 'Amazon Polly returned empty audio.');
      }
      return { audio, mimeType: 'audio/mpeg', provider: 'polly' };
    } catch (error) {
      if (error instanceof VoiceProviderError) throw error;
      throw new VoiceProviderError(
        'polly_request_failed',
        'Amazon Polly could not generate speech.',
        error?.name === 'TimeoutError' ? 504 : 502,
      );
    } finally {
      timeout.clear();
    }
  }

  async function speak({ text, provider }) {
    const config = getVoiceProviderConfig(env);
    const selectedProvider = provider || config.tts.defaultProvider;
    if (!TTS_PROVIDERS.includes(selectedProvider)) {
      throw new VoiceProviderError('invalid_tts_provider', 'Choose ElevenLabs or Amazon Polly.', 400);
    }

    const available = providerAvailability(env);
    const configuredFallback = env.VOICE_TTS_FALLBACK_PROVIDER;
    const fallbackProvider = TTS_PROVIDERS.includes(configuredFallback) &&
      configuredFallback !== selectedProvider &&
      available[configuredFallback]
      ? configuredFallback
      : selectedProvider === 'elevenlabs'
        ? 'polly'
        : 'elevenlabs';
    const providersToTry = [selectedProvider, fallbackProvider]
      .filter((name, index, list) => available[name] && list.indexOf(name) === index);

    if (!providersToTry.length) {
      throw new VoiceProviderError('tts_not_configured', 'No text-to-speech provider is configured.', 503);
    }

    let lastError;
    for (let index = 0; index < providersToTry.length; index += 1) {
      const name = providersToTry[index];
      try {
        const result = name === 'elevenlabs'
          ? await synthesizeWithElevenLabs(text)
          : await synthesizeWithPolly(text);
        return {
          ...result,
          fallbackUsed: index > 0,
          audio: result.audio.toString('base64'),
        };
      } catch (error) {
        lastError = error instanceof VoiceProviderError
          ? error
          : new VoiceProviderError('tts_provider_failed', 'Speech generation failed.');
      }
    }

    if (lastError) throw lastError;
    throw new VoiceProviderError('tts_not_configured', 'No text-to-speech provider is configured.', 503);
  }

  return { transcribe, speak };
}
