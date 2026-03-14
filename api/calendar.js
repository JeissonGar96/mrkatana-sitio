// api/calendar.js — Vercel Serverless Function
// Fetches HIGH impact economic events from Finnhub API

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    const API_KEY = 'd6qrn99r01qgdhqc53lgd6qrn99r01qgdhqc53m0';

    // Get current week range (Mon → Sun)
    const now   = new Date();
    const day   = now.getDay(); // 0=Sun
    const diff  = day === 0 ? -6 : 1 - day;
    const mon   = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0,0,0,0);
    const sun   = new Date(mon); sun.setDate(mon.getDate() + 6);   sun.setHours(23,59,59,0);

    const from = mon.toISOString().slice(0, 10);
    const to   = sun.toISOString().slice(0, 10);

    const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Finnhub responded ${response.status}`);

    const data = await response.json();
    const raw  = data.economicCalendar || [];

    // Keep only HIGH impact events
    // Finnhub impact: 1=low, 2=medium, 3=high (some use strings)
    const events = raw
      .filter(e => e.impact === 3 || e.impact === '3' || e.impact === 'high')
      .map(e => ({
        date:     formatDate(e.time),
        time:     formatTime(e.time),
        currency: e.country ? countryToCurrency(e.country) : '',
        name:     e.event || '',
        impact:   'high',
        forecast: e.estimate  != null ? String(e.estimate)  : '—',
        previous: e.prev      != null ? String(e.prev)      : '—',
        actual:   e.actual    != null ? String(e.actual)    : '—',
        unit:     e.unit      || '',
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    res.status(200).json({ ok: true, updated: new Date().toISOString(), events });
  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};

// ── HELPERS ──

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    timeZone: 'America/New_York'
  });
}

function formatTime(isoStr) {
  if (!isoStr) return 'All Day';
  const d = new Date(isoStr);
  const t = d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'America/New_York'
  });
  return t === '12:00 AM' ? 'All Day' : t;
}

// Map Finnhub country codes to currency symbols
function countryToCurrency(country) {
  const map = {
    'US': 'USD', 'EU': 'EUR', 'GB': 'GBP', 'JP': 'JPY',
    'AU': 'AUD', 'CA': 'CAD', 'CH': 'CHF', 'NZ': 'NZD',
    'CN': 'CNY', 'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR',
    'ES': 'EUR', 'KR': 'KRW', 'IN': 'INR', 'BR': 'BRL',
    'MX': 'MXN', 'ZA': 'ZAR', 'SG': 'SGD', 'HK': 'HKD',
  };
  return map[country.toUpperCase()] || country;
}
