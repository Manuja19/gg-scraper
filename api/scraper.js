module.exports = async function handler(req, res) {
  // 1. Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. Get slug and episode from query parameters (passed by vercel.json)
  const { slug, episode } = req.query;

  if (!slug || !episode) {
    return res.status(400).json({ error: 'Missing slug or episode. Example: /api/to-be-hero-x/2' });
  }

  const targetUrl = `https://www.animegg.org/${slug}-episode-${episode}`;

  try {
    // 3. Fetch the main episode page
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch episode page' });
    }

    const html = await response.text();

    // 4. Extract iframe paths for subbed and dubbed
    const subbedMatch = html.match(/<div id="subbed-Animegg"[^>]*>[\s\S]*?<iframe src="([^"]+)"/);
    const dubbedMatch = html.match(/<div id="dubbed-Animegg"[^>]*>[\s\S]*?<iframe src="([^"]+)"/);

    const result = {
      anime: slug,
      episode: episode,
      subbed: [],
      dubbed: []
    };

    // 5. Helper function to extract MP4 sources
    const extractSources = async (embedPath, type) => {
      if (!embedPath) return;
      
      const embedUrl = `https://www.animegg.org${embedPath}`;
      const embedResponse = await fetch(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': targetUrl
        },
      });
      
      if (!embedResponse.ok) return;
      
      const embedHtml = await embedResponse.text();
      const sourcesMatch = embedHtml.match(/var videoSources = (\[[\s\S]*?\]);/);
      
      if (sourcesMatch) {
        const arrayStr = sourcesMatch[1];
        const regex = /\{file:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g;
        let match;
        while ((match = regex.exec(arrayStr)) !== null) {
          result[type].push({
            resolution: match[2],
            url: `https://www.animegg.org${match[1]}`
          });
        }
      }
    };

    // 6. Run extraction
    if (subbedMatch) await extractSources(subbedMatch[1], 'subbed');
    if (dubbedMatch) await extractSources(dubbedMatch[1], 'dubbed');

    if (result.subbed.length === 0 && result.dubbed.length === 0) {
      return res.status(404).json({ error: 'No video sources found for this episode' });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
