import express from 'express';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { text, to = 'en', from } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const key = process.env.AZURE_TRANSLATOR_KEY;
    const region = process.env.AZURE_TRANSLATOR_REGION;
    const endpoint =
      process.env.AZURE_TRANSLATOR_ENDPOINT ||
      'https://api.cognitive.microsofttranslator.com';

    if (!key || !region) {
      return res.status(500).json({
        error: 'Azure Translator is not configured on the server',
      });
    }

    const params = new URLSearchParams({
      'api-version': '3.0',
      to,
    });

    if (from) params.set('from', from);

    const response = await fetch(`${endpoint}/translate?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ text }]),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Translation failed',
        details: data,
      });
    }

    const result = data?.[0];
    const translatedText = result?.translations?.[0]?.text || '';

    return res.json({
      ok: true,
      originalText: text,
      translatedText,
      detectedLanguage: result?.detectedLanguage || null,
      to,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Translation server error',
      message: error.message,
    });
  }
});

export default router;
