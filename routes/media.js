import express from 'express';
import { MediaProviderError, searchUnsplashImages } from '../services/media.js';

const router = express.Router();

router.get('/images/search', async (req, res) => {
  const query = typeof req.query.query === 'string'
    ? req.query.query.replace(/\s+/g, ' ').trim()
    : '';
  const requestedLimit = req.query.limit === undefined ? 3 : Number(req.query.limit);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 10)
    : 3;

  if (
    query.length < 2 ||
    query.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(query)
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'invalid_search_query',
        message: 'Enter a search topic between 2 and 160 characters.',
      },
    });
  }

  try {
    const images = await searchUnsplashImages(query, { limit });
    return res.json({ success: true, images });
  } catch (error) {
    const providerError = error instanceof MediaProviderError
      ? error
      : new MediaProviderError('image_search_unavailable');
    if (providerError.retryAfter) {
      res.set('Retry-After', String(providerError.retryAfter));
    }
    return res.status(providerError.statusCode).json({
      success: false,
      error: {
        code: providerError.code,
        message: providerError.code === 'image_search_not_configured'
          ? 'Image search is not configured on the server.'
          : providerError.code === 'image_search_rate_limited'
            ? 'Image search is temporarily rate-limited. Please try again shortly.'
            : providerError.code === 'image_search_credentials_rejected'
              ? 'Image search credentials were rejected by the provider.'
              : providerError.code === 'invalid_search_query'
                ? 'Enter a search topic between 2 and 160 characters.'
                : 'Image search is temporarily unavailable.',
      },
    });
  }
});

export default router;
