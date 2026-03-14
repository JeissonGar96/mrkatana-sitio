// api/calendar.js — Vercel Serverless Function
// Uses ForexFactory's public RSS + JSON calendar (no API key needed)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    // ForexFactory exposes a public JSON calendar endpoint used by their own site
    // We fetch the current week with impact filter
    const now   = new Date();
    const day   = now.getDay();
    const diff  = day === 0 ? -6 : 1 - day;
    const mon   = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0,0,0,0);
    const sun   = new Date(mon); sun.setDate(mon.getDate() + 6);

    const pad   = n => String(n).padStart(2,'0');
    const fmt   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

    // Try ForexFactory's internal calendar JSON endpoint
    const ffUrl = `https://nfs.faireconomy.media/ff_calendar_thisweek.json`;

    const response = await fetch(ffUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.forexfactory.com/',
      },
    });

    if (!response.ok) throw new Error(`Calendar feed responded ${response.status}`);

    const raw = await response.json();

    // Filter HIGH impact only (impact === "High")
    const events = raw
      .filter(e => e.impact === 'High')
      .map(e => {
        // Parse date/time — FF format: "03-14-2026" and "8:30am"
        const dateParts = (e.date || '').split('-');
        let dateLabel = e.date || '';
        let timeLabel = e.time || 'All Day';

        // Try to build a readable date label
        try {
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          const m = parseInt(dateParts[0]) - 1;
          const d = parseInt(dateParts[1]);
          const y = parseInt(dateParts[2]);
          const dt = new Date(y, m, d);
          dateLabel = `${days[dt.getDay()]}, ${months[m]} ${d}`;
        } catch(_) {}

        return {
          date:     dateLabel,
          time:     timeLabel,
          currency: e.currency || '',
          name:     e.title    || '',
          impact:   'high',
          forecast: e.forecast || '—',
          previous: e.previous || '—',
          actual:   e.actual   || '—',
        };
      });

    res.status(200).json({ ok: true, updated: new Date().toISOString(), events });

  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
