import express from 'express';

const router = express.Router();

function clean(value) {
  return String(value || '').trim();
}

function normalizeYouTubeVideo(item = {}) {
  const videoId = item?.id?.videoId;
  const snippet = item?.snippet || {};
  const thumbnails = snippet?.thumbnails || {};

  if (!videoId) return null;

  return {
    videoId,
    title: clean(snippet.title),
    description: clean(snippet.description),
    channelTitle: clean(snippet.channelTitle),
    publishedAt: snippet.publishedAt || null,
    thumbnail:
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      null,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function buildSmartQuery(rawQuery = '') {
  const query = clean(rawQuery);

  if (!query) return '';

  const lower = query.toLowerCase();

  if (
    lower.includes('grade') ||
    lower.includes('homework') ||
    lower.includes('assignment') ||
    lower.includes('math') ||
    lower.includes('maths') ||
    lower.includes('science') ||
    lower.includes('history') ||
    lower.includes('geography') ||
    lower.includes('accounting') ||
    lower.includes('economics')
  ) {
    return `${query} lesson tutorial explained`;
  }

  if (
    lower.includes('grant') ||
    lower.includes('funding') ||
    lower.includes('investor') ||
    lower.includes('pitch') ||
    lower.includes('business funding')
  ) {
    return `${query} explained application guide`;
  }

  if (
    lower.includes('university') ||
    lower.includes('college') ||
    lower.includes('tvet') ||
    lower.includes('nsfas') ||
    lower.includes('bursary')
  ) {
    return `${query} application guide explained`;
  }

  return `${query} educational lesson explained`;
}

router.get('/search', async (req, res) => {
  try {
    const rawQuery = clean(req.query.q || req.query.query || '');
    const maxResults = Math.min(Math.max(Number(req.query.limit || 6), 1), 12);

    if (!rawQuery) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: 'Search query is required.',
      });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        success: false,
        message: 'YouTube API key is not configured. Add YOUTUBE_API_KEY in Render environment.',
      });
    }

    const finalQuery = buildSmartQuery(rawQuery);

    const url = new URL('https://www.googleapis.com/youtube/v3/search');

    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('safeSearch', 'strict');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('relevanceLanguage', 'en');
    url.searchParams.set('q', finalQuery);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        success: false,
        message: data?.error?.message || 'YouTube search failed.',
        details: data?.error || null,
      });
    }

    const videos = (data.items || [])
      .map(normalizeYouTubeVideo)
      .filter(Boolean);

    return res.json({
      ok: true,
      success: true,
      query: rawQuery,
      smartQuery: finalQuery,
      count: videos.length,
      videos,
    });
  } catch (error) {
    console.error('YouTube search error:', error);

    return res.status(500).json({
      ok: false,
      success: false,
      message: error?.message || 'Could not search YouTube videos.',
    });
  }
});

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'youtube-route',
    configured: !!process.env.YOUTUBE_API_KEY,
    route: '/api/youtube/search?q=grade%2012%20maths',
  });
});

export default router;
