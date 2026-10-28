const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';
const IMAGE_HOST = 'images.unsplash.com';
const UNSPLASH_HOST = 'unsplash.com';

export class MediaProviderError extends Error {
  constructor(code, statusCode = 502, retryAfter) {
    super(code);
    this.name = 'MediaProviderError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

function trustedUrl(value, hostname) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function addAttributionParameters(value) {
  const url = trustedUrl(value, UNSPLASH_HOST);
  if (!url) return null;
  url.searchParams.set('utm_source', 'facemexsocial');
  url.searchParams.set('utm_medium', 'referral');
  return url.toString();
}

export async function searchUnsplashImages(
  query,
  { apiKey = process.env.UNSPLASH_ACCESS_KEY, fetchImpl = fetch, limit = 3, timeoutMs = 8_000 } = {},
) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (normalizedQuery.length < 2 || normalizedQuery.length > 160) {
    throw new MediaProviderError('invalid_search_query', 400);
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new MediaProviderError('image_search_not_configured', 503);
  }

  const resultLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 10) : 3;
  const endpoint = new URL(UNSPLASH_SEARCH_URL);
  endpoint.searchParams.set('query', normalizedQuery);
  endpoint.searchParams.set('per_page', String(resultLimit));
  endpoint.searchParams.set('content_filter', 'high');

  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Client-ID ${apiKey.trim()}`,
        'Accept-Version': 'v1',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new MediaProviderError(
      timedOut ? 'image_search_timeout' : 'image_search_unavailable',
      timedOut ? 504 : 502,
    );
  }

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('retry-after');
    const parsedRetryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    const retryAfter = Number.isFinite(parsedRetryAfter)
      ? Math.max(1, Math.min(Math.floor(parsedRetryAfter), 300))
      : 60;
    throw new MediaProviderError('image_search_rate_limited', 429, retryAfter);
  }
  if (response.status === 401 || response.status === 403) {
    throw new MediaProviderError('image_search_credentials_rejected', 503);
  }
  if (!response.ok) {
    throw new MediaProviderError('image_search_unavailable', 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MediaProviderError('image_search_invalid_response', 502);
  }
  if (!Array.isArray(data?.results)) {
    throw new MediaProviderError('image_search_invalid_response', 502);
  }

  const seen = new Set();
  return data.results
    .map((photo) => {
      const imageUrl = trustedUrl(photo?.urls?.regular, IMAGE_HOST);
      const attributionUrl = addAttributionParameters(photo?.user?.links?.html);
      const photographer = typeof photo?.user?.name === 'string'
        ? photo.user.name.trim().slice(0, 120)
        : '';
      const alt = typeof photo?.alt_description === 'string' && photo.alt_description.trim()
        ? photo.alt_description.trim().slice(0, 240)
        : typeof photo?.description === 'string' && photo.description.trim()
          ? photo.description.trim().slice(0, 240)
          : `Unsplash photo related to ${normalizedQuery}`;
      const id = typeof photo?.id === 'string' ? photo.id : '';

      if (!id || !imageUrl || !attributionUrl || !photographer) return null;
      return {
        id,
        url: imageUrl.toString(),
        alt,
        photographer,
        attributionUrl,
        source: 'unsplash',
      };
    })
    .filter((image) => {
      if (!image || seen.has(image.id)) return false;
      seen.add(image.id);
      return true;
    })
    .slice(0, resultLimit);
}
