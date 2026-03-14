// api/calendar.js — Vercel Serverless Function
// Scrapes ForexFactory calendar and returns only HIGH impact events
// Deployed automatically by Vercel — accessible at /api/calendar

export default async function handler(req, res) {
  // CORS — allow your domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate'); // cache 30 min

  try {
    // ForexFactory calendar URL — defaults to current week
    const url = 'https://www.forexfactory.com/calendar';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.forexfactory.com/',
        'Cookie': 'fftimezoneoffset=-300; fflocale=en', // UTC-5 (EST)
      },
    });

    if (!response.ok) {
      throw new Error(`ForexFactory responded with ${response.status}`);
    }

    const html = await response.text();
    const events = parseCalendar(html);

    res.status(200).json({
      ok: true,
      updated: new Date().toISOString(),
      events,
    });
  } catch (err) {
    console.error('Calendar scrape error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
}

// ── PARSER ──
function parseCalendar(html) {
  const events = [];

  // Extract all table rows from the calendar
  // ForexFactory uses <tr class="calendar__row ...">
  const rowRegex = /<tr[^>]*class="[^"]*calendar__row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [...html.matchAll(rowRegex)];

  let currentDate = '';

  for (const row of rows) {
    const rowHtml = row[1];

    // ── Date ──
    const dateMatch = rowHtml.match(/<td[^>]*class="[^"]*calendar__date[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (dateMatch) {
      const dateText = stripTags(dateMatch[1]).trim();
      if (dateText) currentDate = dateText;
    }

    // ── Impact — only keep HIGH impact (red) ──
    const impactMatch = rowHtml.match(/impact--([a-z]+)/i);
    if (!impactMatch) continue;
    const impact = impactMatch[1].toLowerCase(); // red | ora | yel | gra
    if (impact !== 'red') continue; // HIGH impact only

    // ── Time ──
    const timeMatch = rowHtml.match(/<td[^>]*class="[^"]*calendar__time[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const time = timeMatch ? stripTags(timeMatch[1]).trim() : '';

    // ── Currency ──
    const currMatch = rowHtml.match(/<td[^>]*class="[^"]*calendar__currency[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const currency = currMatch ? stripTags(currMatch[1]).trim() : '';

    // ── Event name ──
    const nameMatch = rowHtml.match(/<span[^>]*class="[^"]*calendar__event-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!nameMatch) continue;
    const name = stripTags(nameMatch[1]).trim();
    if (!name) continue;

    // ── Forecast / Previous / Actual ──
    const forecastMatch = rowHtml.match(/<td[^>]*class="[^"]*calendar__forecast[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const previousMatch = rowHtml.match(/<td[^>]*class="[^"]*calendar__previous[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const actualMatch   = rowHtml.match(/<td[^>]*class="[^"]*calendar__actual[^"]*"[^>]*>([\s\S]*?)<\/td>/i);

    const forecast = forecastMatch ? stripTags(forecastMatch[1]).trim() : '';
    const previous = previousMatch ? stripTags(previousMatch[1]).trim() : '';
    const actual   = actualMatch   ? stripTags(actualMatch[1]).trim()   : '';

    events.push({
      date:     currentDate,
      time:     time || 'All Day',
      currency,
      name,
      impact:   'high',
      forecast: forecast || '—',
      previous: previous || '—',
      actual:   actual   || '—',
    });
  }

  return events;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
