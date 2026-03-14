// api/calendar.js — Vercel Serverless Function (CommonJS)
// Scrapes ForexFactory and returns HIGH impact events only

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    const response = await fetch('https://www.forexfactory.com/calendar', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.forexfactory.com/',
      },
    });

    if (!response.ok) throw new Error(`FF responded ${response.status}`);

    const html = await response.text();
    const events = parseCalendar(html);

    res.status(200).json({ ok: true, updated: new Date().toISOString(), events });
  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};

function parseCalendar(html) {
  const events = [];
  const rowRegex = /<tr[^>]*class="[^"]*calendar__row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [...html.matchAll(rowRegex)];
  let currentDate = '';

  for (const row of rows) {
    const r = row[1];

    const dateMatch = r.match(/<td[^>]*class="[^"]*calendar__date[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (dateMatch) { const d = strip(dateMatch[1]); if (d) currentDate = d; }

    const impactMatch = r.match(/impact--([a-z]+)/i);
    if (!impactMatch || impactMatch[1].toLowerCase() !== 'red') continue;

    const timeMatch = r.match(/<td[^>]*class="[^"]*calendar__time[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const currMatch = r.match(/<td[^>]*class="[^"]*calendar__currency[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const nameMatch = r.match(/<span[^>]*class="[^"]*calendar__event-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!nameMatch) continue;

    const forecastMatch = r.match(/<td[^>]*class="[^"]*calendar__forecast[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const previousMatch = r.match(/<td[^>]*class="[^"]*calendar__previous[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const actualMatch   = r.match(/<td[^>]*class="[^"]*calendar__actual[^"]*"[^>]*>([\s\S]*?)<\/td>/i);

    events.push({
      date:     currentDate,
      time:     timeMatch ? strip(timeMatch[1]) : 'All Day',
      currency: currMatch ? strip(currMatch[1]) : '',
      name:     strip(nameMatch[1]),
      impact:   'high',
      forecast: forecastMatch ? (strip(forecastMatch[1]) || '—') : '—',
      previous: previousMatch ? (strip(previousMatch[1]) || '—') : '—',
      actual:   actualMatch   ? (strip(actualMatch[1])   || '—') : '—',
    });
  }
  return events;
}

function strip(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
