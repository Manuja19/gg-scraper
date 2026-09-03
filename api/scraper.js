module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug, episode } = req.query;
  if (!slug || !episode) {
    return res.status(400).json({ error: 'Missing slug or episode' });
  }

  const targetUrl = `https://www.animegg.org/${slug}-episode-${episode}`;

  try {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });

    if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch episode page' });
    const html = await response.text();

    const subbedMatch = html.match(/<div id="subbed-Animegg"[^>]*>[\s\S]*?<iframe src="([^"]+)"/);
    const dubbedMatch = html.match(/<div id="dubbed-Animegg"[^>]*>[\s\S]*?<iframe src="([^"]+)"/);

    const result = { anime: slug, episode: episode, subbed: [], dubbed: [] };

    const extractSources = async (embedPath, type) => {
      if (!embedPath) return;
      const embedResponse = await fetch(`https://www.animegg.org${embedPath}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Referer': targetUrl },
      });
      if (!embedResponse.ok) return;
      
      const embedHtml = await embedResponse.text();
      const sourcesMatch = embedHtml.match(/var videoSources = (\[[\s\S]*?\]);/);
      
      if (sourcesMatch) {
        // Updated regex to capture the 'bk' (backup) field
        const regex = /\{file:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*bk:\s*"([^"]+)"/g;
        let match;
        while ((match = regex.exec(sourcesMatch[1])) !== null) {
          const base64Bk = match[3];
          
          try {
            // Decode the base64 string, then URL decode it to get the direct CDN link
            const decodedBk = Buffer.from(base64Bk, 'base64').toString('utf8');
            const directCdnUrl = decodeURIComponent(decodedBk);
            
            // Force HTTPS if the decoded URL is HTTP (some CDNs accept both, HTTPS is safer for frontend)
            const finalUrl = directCdnUrl.replace(/^http:\/\//i, 'https://');
            
            result[type].push({ 
              resolution: match[2], 
              url: finalUrl // Direct CDN link! Zero Vercel bandwidth used.
            });
          } catch (decodeError) {
            console.error('Failed to decode bk URL:', decodeError);
          }
        }
      }
    };

    if (subbedMatch) await extractSources(subbedMatch[1], 'subbed');
    if (dubbedMatch) await extractSources(dubbedMatch[1], 'dubbed');

    if (result.subbed.length === 0 && result.dubbed.length === 0) {
      return res.status(404).json({ error: 'No video sources found' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
