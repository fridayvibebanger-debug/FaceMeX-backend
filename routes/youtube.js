import express from 'express';

const router = express.Router();

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

function clean(value) {
  return String(value || '').trim();
}

function safeLower(value) {
  return clean(value).toLowerCase();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) return fallback;

  return Math.min(Math.max(number, min), max);
}

function parseIsoDurationToSeconds(duration = '') {
  const match = String(duration || '').match(
    /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i
  );

  if (!match) return 0;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(seconds = 0) {
  const total = Number(seconds || 0);

  if (!total) return '';

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function isBadVideoText(video = {}) {
  const text = `${video.title || ''} ${video.description || ''} ${video.channelTitle || ''}`.toLowerCase();

  const blockedPatterns = [
    /#shorts\b/i,
    /\bshorts\b/i,
    /\byt shorts\b/i,
    /\btiktok\b/i,
    /\bfunny\b/i,
    /\bmeme\b/i,
    /\bprank\b/i,
    /\breaction\b/i,
    /\bcompilation\b/i,
    /\bstatus\b/i,
    /\bviral\b/i,
    /\bchallenge\b/i,
    /\bgossip\b/i,
  ];

  return blockedPatterns.some((pattern) => pattern.test(text));
}

function scoreVideo(video = {}) {
  const text = `${video.title || ''} ${video.description || ''} ${video.channelTitle || ''}`.toLowerCase();

  let score = 0;

  if (video.durationSeconds >= 240) score += 20;
  if (video.durationSeconds >= 480) score += 15;
  if (video.durationSeconds > 3600) score -= 10;

  if (/\blesson\b/i.test(text)) score += 20;
  if (/\btutorial\b/i.test(text)) score += 16;
  if (/\bexplained\b/i.test(text)) score += 16;
  if (/\bguide\b/i.test(text)) score += 14;
  if (/\bstep by step\b/i.test(text)) score += 18;
  if (/\bfull\b/i.test(text)) score += 8;
  if (/\bexam\b/i.test(text)) score += 10;
  if (/\bpast paper\b/i.test(text)) score += 12;
  if (/\bgrade\b/i.test(text)) score += 10;
  if (/\bsouth africa\b/i.test(text)) score += 8;
  if (/\bapplication\b/i.test(text)) score += 8;
  if (/\bfunding\b/i.test(text)) score += 8;
  if (/\binvestor\b/i.test(text)) score += 8;
  if (/\bjobs?\b/i.test(text)) score += 8;

  if (/\bshort\b/i.test(text)) score -= 20;
  if (/\bfunny\b/i.test(text)) score -= 25;
  if (/\bquick clip\b/i.test(text)) score -= 15;

  const views = Number(video.viewCount || 0);
  if (views > 100000) score += 10;
  if (views > 1000000) score += 15;

  return score;
}

const CATEGORY_PRESETS = {
  math: {
    library: 'students',
    title: 'Math',
    query: 'Grade 12 mathematics lesson South Africa exam questions step by step',
  },
  history: {
    library: 'students',
    title: 'History',
    query: 'South African history lesson grade 10 11 12 explained',
  },
  accounting: {
    library: 'students',
    title: 'Accounting',
    query: 'Grade 12 accounting lesson journals ledgers financial statements South Africa',
  },
  science: {
    library: 'students',
    title: 'Science',
    query: 'Physical Sciences Grade 12 lesson South Africa explained',
  },
  english: {
    library: 'students',
    title: 'English',
    query: 'English essay writing lesson grammar comprehension high school',
  },
  business_studies: {
    library: 'students',
    title: 'Business Studies',
    query: 'Business Studies Grade 12 lesson South Africa exam answers',
  },
  university_applications: {
    library: 'students',
    title: 'University Applications',
    query: 'How to apply for university in South Africa step by step',
  },
  nsfas_bursaries: {
    library: 'students',
    title: 'NSFAS / Bursaries',
    query: 'NSFAS bursary application South Africa step by step guide',
  },
  grants_funding: {
    library: 'investors',
    title: 'Grants / Funding',
    query: 'How to apply for business grants funding South Africa step by step',
  },
  investors: {
    library: 'investors',
    title: 'Investors',
    query: 'What investors want in a startup pitch deck traction revenue explained',
  },
  pitch_deck: {
    library: 'investors',
    title: 'Pitch Deck',
    query: 'How to create a startup pitch deck investors explained',
  },
  startup_funding: {
    library: 'investors',
    title: 'Startup Funding',
    query: 'Startup funding explained how to raise money for business',
  },
  jobs_abroad: {
    library: 'jobs',
    title: 'Jobs Abroad',
    query: 'How to find jobs abroad online safely application tips',
  },
  jobs_south_africa: {
    library: 'jobs',
    title: 'Jobs South Africa',
    query: 'How to find jobs online in South Africa CV application interview',
  },
  cv_interview: {
    library: 'jobs',
    title: 'CV & Interview Prep',
    query: 'How to write a CV and prepare for interview South Africa',
  },
  learnerships: {
    library: 'jobs',
    title: 'Learnerships',
    query: 'How to apply for learnerships in South Africa step by step',
  },
};

function getPresetQuery(category) {
  const key = safeLower(category).replace(/[\s/-]+/g, '_');
  return CATEGORY_PRESETS[key] || null;
}

function buildSmartQuery(rawQuery = '', options = {}) {
  const query = clean(rawQuery);
  const library = safeLower(options.library);
  const categoryPreset = getPresetQuery(options.category);

  if (categoryPreset?.query) return categoryPreset.query;

  if (!query) return '';

  const lower = query.toLowerCase();

  if (library === 'students') {
    return `${query} full lesson tutorial explained step by step no shorts`;
  }

  if (library === 'investors') {
    return `${query} explained guide startup funding investors pitch deck no shorts`;
  }

  if (library === 'jobs') {
    return `${query} step by step guide applications CV interview no shorts`;
  }

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
    lower.includes('economics') ||
    lower.includes('business studies') ||
    lower.includes('english')
  ) {
    return `${query} full lesson tutorial explained step by step no shorts`;
  }

  if (
    lower.includes('grant') ||
    lower.includes('funding') ||
    lower.includes('investor') ||
    lower.includes('pitch') ||
    lower.includes('business funding') ||
    lower.includes('startup')
  ) {
    return `${query} explained guide step by step no shorts`;
  }

  if (
    lower.includes('job') ||
    lower.includes('jobs') ||
    lower.includes('cv') ||
    lower.includes('interview') ||
    lower.includes('learnership') ||
    lower.includes('abroad')
  ) {
    return `${query} step by step guide no shorts`;
  }

  if (
    lower.includes('university') ||
    lower.includes('college') ||
    lower.includes('tvet') ||
    lower.includes('nsfas') ||
    lower.includes('bursary')
  ) {
    return `${query} application guide explained step by step no shorts`;
  }

  return `${query} useful full educational video explained no shorts`;
}

function normalizeSearchItem(item = {}) {
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
      thumbnails.maxres?.url ||
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      null,
  };
}

function normalizeVideoDetails(searchVideo = {}, details = {}) {
  const contentDetails = details?.contentDetails || {};
  const statistics = details?.statistics || {};
  const status = details?.status || {};

  const durationSeconds = parseIsoDurationToSeconds(contentDetails.duration);

  return {
    videoId: searchVideo.videoId,
    title: clean(searchVideo.title),
    description: clean(searchVideo.description),
    channelTitle: clean(searchVideo.channelTitle),
    publishedAt: searchVideo.publishedAt || null,
    thumbnail: searchVideo.thumbnail || null,
    duration: formatDuration(durationSeconds),
    durationSeconds,
    viewCount: Number(statistics.viewCount || 0),
    likeCount: Number(statistics.likeCount || 0),
    embeddable: status.embeddable !== false,
    embedUrl: `https://www.youtube.com/embed/${searchVideo.videoId}`,
    watchUrl: `https://www.youtube.com/watch?v=${searchVideo.videoId}`,
  };
}

async function fetchYouTubeSearch({ query, maxResults, pageToken }) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  const url = new URL(YOUTUBE_SEARCH_URL);

  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('safeSearch', 'strict');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('videoSyndicated', 'true');
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('relevanceLanguage', 'en');

  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || 'YouTube search failed.';
    const error = new Error(message);
    error.status = response.status;
    error.details = data?.error || null;
    throw error;
  }

  return data;
}

async function fetchVideoDetails(videoIds = []) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!videoIds.length) return [];

  const url = new URL(YOUTUBE_VIDEOS_URL);

  url.searchParams.set('part', 'contentDetails,statistics,status');
  url.searchParams.set('id', videoIds.join(','));
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || 'Could not load YouTube video details.';
    const error = new Error(message);
    error.status = response.status;
    error.details = data?.error || null;
    throw error;
  }

  return data.items || [];
}

function filterAndRankVideos(videos = []) {
  return videos
    .filter((video) => video.videoId)
    .filter((video) => video.embeddable !== false)
    .filter((video) => video.durationSeconds >= 150)
    .filter((video) => !isBadVideoText(video))
    .map((video) => ({
      ...video,
      qualityScore: scoreVideo(video),
    }))
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'youtube-route',
    configured: !!process.env.YOUTUBE_API_KEY,
    routes: {
      health: '/api/youtube/health',
      search: '/api/youtube/search?q=grade%2012%20maths',
      categories: '/api/youtube/categories',
    },
    filters: {
      safeSearch: 'strict',
      embeddableOnly: true,
      shortsFiltered: true,
      minimumDurationSeconds: 150,
    },
  });
});

router.get('/categories', (_req, res) => {
  const categories = Object.entries(CATEGORY_PRESETS).map(([key, value]) => ({
    key,
    ...value,
  }));

  res.json({
    ok: true,
    count: categories.length,
    libraries: {
      students: categories.filter((item) => item.library === 'students'),
      investors: categories.filter((item) => item.library === 'investors'),
      jobs: categories.filter((item) => item.library === 'jobs'),
    },
  });
});

router.get('/search', async (req, res) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        success: false,
        message:
          'YouTube API key is not configured. Add YOUTUBE_API_KEY in Render environment.',
      });
    }

    const rawQuery = clean(req.query.q || req.query.query || '');
    const category = clean(req.query.category || '');
    const library = clean(req.query.library || '');
    const limit = clampNumber(req.query.limit, 1, 12, 6);
    const pageToken = clean(req.query.pageToken || '');

    const finalQuery = buildSmartQuery(rawQuery, {
      category,
      library,
    });

    if (!finalQuery) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: 'Search query or category is required.',
      });
    }

    const searchMaxResults = Math.min(Math.max(limit * 3, 12), 25);

    const searchData = await fetchYouTubeSearch({
      query: finalQuery,
      maxResults: searchMaxResults,
      pageToken,
    });

    const searchVideos = (searchData.items || [])
      .map(normalizeSearchItem)
      .filter(Boolean);

    const videoIds = searchVideos.map((video) => video.videoId);
    const details = await fetchVideoDetails(videoIds);

    const detailsMap = new Map(
      details.map((item) => [item.id, item])
    );

    const videos = searchVideos
      .map((video) => normalizeVideoDetails(video, detailsMap.get(video.videoId)))
      .filter(Boolean);

    const rankedVideos = filterAndRankVideos(videos).slice(0, limit);

    return res.json({
      ok: true,
      success: true,
      query: rawQuery,
      category: category || null,
      library: library || null,
      smartQuery: finalQuery,
      count: rankedVideos.length,
      nextPageToken: searchData.nextPageToken || null,
      videos: rankedVideos,
    });
  } catch (error) {
    console.error('YouTube search error:', error);

    return res.status(error.status || 500).json({
      ok: false,
      success: false,
      message: error?.message || 'Could not search YouTube videos.',
      details: error?.details || null,
    });
  }
});

export default router;
