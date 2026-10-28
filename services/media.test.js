import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { MediaProviderError, searchUnsplashImages } from './media.js';
import mediaRouter from '../routes/media.js';

const TEST_KEY = 'test-unsplash-key';

function photo(id) {
  return {
    id,
    urls: { regular: `https://images.unsplash.com/photo-${id}` },
    alt_description: `Photo of ${id}`,
    user: {
      name: `Photographer ${id}`,
      links: { html: `https://unsplash.com/@photographer-${id}` },
    },
  };
}

async function withMediaServer(callback) {
  const app = express();
  app.use('/api/media', mediaRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('returns validated, attributed Unsplash results and caps requests at ten', async () => {
  let requestedUrl;
  let requestOptions;
  const images = await searchUnsplashImages('photosynthesis', {
    apiKey: TEST_KEY,
    limit: 50,
    fetchImpl: async (url, options) => {
      requestedUrl = new URL(url);
      requestOptions = options;
      return new Response(JSON.stringify({
        results: [
          photo('one'),
          photo('one'),
          { ...photo('untrusted'), urls: { regular: 'https://example.com/image.jpg' } },
        ],
      }), { status: 200 });
    },
  });

  assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://api.unsplash.com/search/photos');
  assert.equal(requestedUrl.searchParams.get('query'), 'photosynthesis');
  assert.equal(requestedUrl.searchParams.get('per_page'), '10');
  assert.equal(requestOptions.headers.Authorization, `Client-ID ${TEST_KEY}`);
  assert.equal(images.length, 1);
  assert.deepEqual(images[0], {
    id: 'one',
    url: 'https://images.unsplash.com/photo-one',
    alt: 'Photo of one',
    photographer: 'Photographer one',
    attributionUrl: 'https://unsplash.com/@photographer-one?utm_source=facemexsocial&utm_medium=referral',
    source: 'unsplash',
  });
  assert.doesNotMatch(JSON.stringify(images), new RegExp(TEST_KEY));
});

test('returns an empty result list when Unsplash finds no images', async () => {
  const images = await searchUnsplashImages('empty search', {
    apiKey: TEST_KEY,
    fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
  });
  assert.deepEqual(images, []);
});

test('rejects missing server credentials without calling Unsplash', async () => {
  let called = false;
  await assert.rejects(
    searchUnsplashImages('photosynthesis', {
      apiKey: '',
      fetchImpl: async () => { called = true; },
    }),
    (error) => error instanceof MediaProviderError &&
      error.code === 'image_search_not_configured' &&
      error.statusCode === 503,
  );
  assert.equal(called, false);
});

test('converts Unsplash rate limiting into a safe retryable error', async () => {
  await assert.rejects(
    searchUnsplashImages('photosynthesis', {
      apiKey: TEST_KEY,
      fetchImpl: async () => new Response('Rate limited', {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    }),
    (error) => error.code === 'image_search_rate_limited' &&
      error.statusCode === 429 &&
      error.retryAfter === 30,
  );
});

test('handles network failures and timeout errors without exposing details', async () => {
  await assert.rejects(
    searchUnsplashImages('photosynthesis', {
      apiKey: TEST_KEY,
      fetchImpl: async () => { throw new TypeError('network failure'); },
    }),
    (error) => error.code === 'image_search_unavailable' && error.statusCode === 502,
  );
  await assert.rejects(
    searchUnsplashImages('photosynthesis', {
      apiKey: TEST_KEY,
      fetchImpl: async () => {
        const error = new Error('timeout details');
        error.name = 'TimeoutError';
        throw error;
      },
    }),
    (error) => error.code === 'image_search_timeout' && error.statusCode === 504,
  );
});

test('rejects invalid provider responses and reports provider failures safely', async () => {
  await assert.rejects(
    searchUnsplashImages('photosynthesis', {
      apiKey: TEST_KEY,
      fetchImpl: async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    }),
    (error) => error.code === 'image_search_invalid_response' && error.statusCode === 502,
  );
  await assert.rejects(
    searchUnsplashImages('photosynthesis', {
      apiKey: TEST_KEY,
      fetchImpl: async () => new Response('provider error', { status: 500 }),
    }),
    (error) => error.code === 'image_search_unavailable' && error.statusCode === 502,
  );
});

test('serves Unsplash image results from the mounted endpoint', async () => {
  const previousKey = process.env.UNSPLASH_ACCESS_KEY;
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  process.env.UNSPLASH_ACCESS_KEY = TEST_KEY;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname !== 'api.unsplash.com') {
      return originalFetch(input, options);
    }

    requestedUrl = url;
    return new Response(JSON.stringify({ results: [photo('route-result')] }), { status: 200 });
  };

  try {
    await withMediaServer(async (baseUrl) => {
      const response = await originalFetch(
        `${baseUrl}/api/media/images/search?query=photosynthesis`,
      );
      assert.equal(response.status, 200);
      assert.equal(requestedUrl.pathname, '/search/photos');
      assert.equal(requestedUrl.searchParams.get('query'), 'photosynthesis');
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.images.length, 1);
      assert.deepEqual(body.images[0], {
        id: 'route-result',
        url: 'https://images.unsplash.com/photo-route-result',
        alt: 'Photo of route-result',
        photographer: 'Photographer route-result',
        attributionUrl: 'https://unsplash.com/@photographer-route-result?utm_source=facemexsocial&utm_medium=referral',
        source: 'unsplash',
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.UNSPLASH_ACCESS_KEY;
    else process.env.UNSPLASH_ACCESS_KEY = previousKey;
  }
});

test('returns HTTP 400 for an empty query and a safe configuration error without a key', async () => {
  const previousKey = process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.UNSPLASH_ACCESS_KEY;

  try {
    await withMediaServer(async (baseUrl) => {
      const emptyResponse = await fetch(`${baseUrl}/api/media/images/search`);
      assert.equal(emptyResponse.status, 400);
      assert.equal((await emptyResponse.json()).success, false);

      const configResponse = await fetch(`${baseUrl}/api/media/images/search?query=photosynthesis`);
      assert.equal(configResponse.status, 503);
      const body = await configResponse.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'image_search_not_configured');
      assert.doesNotMatch(JSON.stringify(body), /UNSPLASH_ACCESS_KEY|test-unsplash-key/);
    });
  } finally {
    if (previousKey === undefined) delete process.env.UNSPLASH_ACCESS_KEY;
    else process.env.UNSPLASH_ACCESS_KEY = previousKey;
  }
});
