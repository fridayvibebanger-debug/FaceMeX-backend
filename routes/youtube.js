const express = require('express');

const router = express.Router();

router.get('/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required.',
      });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'YouTube API key is not configured.',
      });
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search');

    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '6');
    url.searchParams.set('safeSearch', 'strict');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('q', query);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: data?.error?.message || 'YouTube search failed.',
      });
    }

    const videos = (data.items || []).map((item) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      channelTitle: item.snippet?.channelTitle,
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url,
      embedUrl: `https://www.youtube.com/embed/${item.id?.videoId}`,
      watchUrl: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    }));

    return res.json({
      success: true,
      videos,
    });
  } catch (error) {
    console.error('YouTube search error:', error);

    return res.status(500).json({
      success: false,
      message: 'Could not search YouTube videos.',
    });
  }
});

module.exports = router;
