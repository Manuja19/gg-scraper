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
        const regex = /\{file:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*bk:\s*"([^"]*)"/g;
        let match;
        while ((match = regex.exec(sourcesMatch[1])) !== null) {
          const base64Bk = match[3];
          const label = match[2];
          
          if (!base64Bk) continue; // Skip if no backup link

          try {
            // Decode the base64 string, then URL decode it
            const decodedBk = Buffer.from(base64Bk, 'base64').toString('utf8');
            let finalUrl = decodeURIComponent(decodedBk);

            // Check if it's already a direct video link
            if (finalUrl.includes('.mp4') || finalUrl.includes('.m3u8')) {
              result[type].push({ resolution: label, url: finalUrl.replace(/^http:\/\//i, 'https://') });
            } 
            // If it's an embed page (like mp4upload), scrape it for the real MP4
            else if (finalUrl.includes('http')) {
              const embedPageResponse = await fetch(finalUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.animegg.org/' }
              });
              
              if (embedPageResponse.ok) {
                const embedPageHtml = await embedPageResponse.text();
                
                // Skip if the file was deleted
                if (embedPageHtml.includes('File was deleted') || embedPageHtml.includes('Video is processing')) {
                  continue;
                }

                // Try to extract direct mp4 link from the embed page's JavaScript
                const mp4Match = embedPageHtml.match(/(?:file|src|url):\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) || 
                                 embedPageHtml.match(/["'](https?:\/\/[^"']+\.mp4\?[^"']*)["']/i);
                
                if (mp4Match && mp4Match[1]) {
                  result[type].push({ resolution: label, url: mp4Match[1] });
                }
              }
            }
          } catch (decodeError) {
            console.error('Failed to process bk URL:', decodeError);
          }
        }
      }
    };

    if (subbedMatch) await extractSources(subbedMatch[1], 'subbed');
    if (dubbedMatch) await extractSources(dubbedMatch[1], 'dubbed');

    if (result.subbed.length === 0 && result.dubbed.length === 0) {
      return res.status(404).json({ error: 'No valid video sources found (files may be deleted)' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
