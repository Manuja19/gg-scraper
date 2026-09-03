module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const videoUrl = req.query.url;
  if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('https://www.animegg.org/play/')) {
    return res.status(400).json({ error: 'Invalid video URL' });
  }

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.animegg.org/',
    };

    // Forward the Range header: This is CRUCIAL. It allows the video player to 
    // request small chunks, preventing Vercel's 10-second timeout limit.
    if (req.headers.range) {
      fetchHeaders['Range'] = req.headers.range;
    }

    const response = await fetch(videoUrl, { headers: fetchHeaders });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch video from source' });
    }

    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
    
    if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));
    if (response.headers.get('content-range')) res.setHeader('Content-Range', response.headers.get('content-range'));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Stream the video chunks to the client
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Internal proxy error' });
  }
}
