import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string; episode: string } | Promise<{ slug: string; episode: string }> }
) {
  // Handle both Next.js 14 and 15 param structures
  const resolvedParams = await params;
  const { slug, episode } = resolvedParams;

  // CORS headers for your AnimeVault frontend
  const headers = {
    'Access-Control-Allow-Origin': '*', // Replace '*' with your frontend URL in production
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { headers });
  }

  const targetUrl = `https://www.animegg.org/${slug}-episode-${episode}`;

  try {
    // 1. Fetch the main episode page
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      next: { revalidate: 60 } // Cache for 60 seconds to reduce load
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch episode page' }, { status: response.status, headers });
    }

    const html = await response.text();

    // 2. Extract iframe sources for subbed and dubbed
    const subbedMatch = html.match(/<div id="subbed-Animegg"[^>]*>[\s\S]*?<iframe src="([^"]+)"/);
    const dubbedMatch = html.match(/<div id="dubbed-Animegg"[^>]*>[\s\S]*?<iframe src="([^"]+)"/);

    const result: any = {
      anime: slug,
      episode: episode,
      subbed: [],
      dubbed: []
    };

    // 3. Helper to extract video sources from the embed page
    const extractSources = async (embedPath: string, type: 'subbed' | 'dubbed') => {
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
      
      // Extract the videoSources array using regex
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

    if (subbedMatch) await extractSources(subbedMatch[1], 'subbed');
    if (dubbedMatch) await extractSources(dubbedMatch[1], 'dubbed');

    if (result.subbed.length === 0 && result.dubbed.length === 0) {
      return NextResponse.json({ error: 'No video sources found' }, { status: 404, headers });
    }

    return NextResponse.json(result, { headers });

  } catch (error) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers });
  }
}
