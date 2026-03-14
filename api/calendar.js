// api/calendar.js — Vercel Serverless Function
// ForexFactory feed — USD High impact only

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.forexfactory.com/',
  };

  // Convert ISO date string to YYYY-MM-DD in UTC-5
  function toIsoDate(raw) {
    raw = (raw || '').trim();
    if (!raw) return '';
    if (raw.includes('T')) {
      // Keep the original date from the ISO string without timezone conversion
      // e.g. "2026-03-11T08:30:00-04:00" → date is Mar 11
      return raw.slice(0, 10); // just take YYYY-MM-DD directly
    }
    if (raw.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [mm, dd, yyyy] = raw.split('-');
      return `${yyyy}-${mm}-${dd}`;
    }
    if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) return raw;
    return '';
  }

  // Convert ISO time to UTC-5 time label
  function toTimeLabel(raw) {
    raw = (raw || '').trim();
    if (!raw) return 'Tent.';
    if (raw.includes('T')) {
      const dt  = new Date(raw);
      const ec  = new Date(dt.getTime() - 5 * 3600000);
      const h   = ec.getUTCHours(), m = ec.getUTCMinutes();
      return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
    }
    const t = raw.toLowerCase();
    if (t === 'tentative' || t === '') return 'Tent.';
    if (t === 'all day') return 'Todo el día';
    return raw.replace(/([ap]m)$/i, s => ' ' + s.toUpperCase());
  }

  // Parse date label from ISO string
  function toDateLabel(raw) {
    raw = (raw || '').trim();
    if (raw.includes('T')) {
      const isoDate = raw.slice(0, 10); // YYYY-MM-DD
      const [yyyy, mm, dd] = isoDate.split('-').map(Number);
      const dt = new Date(Date.UTC(yyyy, mm-1, dd));
      return `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
    }
    if (raw.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [mm, dd, yyyy] = raw.split('-').map(Number);
      const dt = new Date(Date.UTC(yyyy, mm-1, dd));
      return `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
    }
    if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [yyyy, mm, dd] = raw.split('-').map(Number);
      const dt = new Date(Date.UTC(yyyy, mm-1, dd));
      return `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
    }
    return raw;
  }

  try {
    // Fetch both feeds
    const [r1, r2] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',  { headers: HEADERS }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', { headers: HEADERS }),
    ]);
    const thisWeek = r1.ok ? await r1.json() : [];
    const nextWeek = r2.ok ? await r2.json() : [];
    const all = [...thisWeek, ...nextWeek];

    // Today YYYY-MM-DD — use simple UTC date (close enough, max 1 day diff)
    const todayStr = new Date().toISOString().slice(0, 10);

    // Filter USD + High
    const usdHigh = all.filter(e =>
      e.country === 'USD' && e.impact === 'High'
    );

    // Try future events first
    let display = usdHigh.filter(e => toIsoDate(e.date) >= todayStr);

    // If none, show all USD High events (entire week — better than nothing)
    if (!display.length) {
      display = usdHigh;
    }

    const s = v => (v != null && String(v).trim() !== '') ? String(v).trim() : '—';

    const events = display.map(e => ({
      date:     toDateLabel(e.date),
      isoDate:  toIsoDate(e.date),
      time:     toTimeLabel(e.date),
      currency: 'USD',
      name:     (e.title || '').trim(),
      impact:   'high',
      forecast: s(e.forecast),
      previous: s(e.previous),
      actual:   s(e.actual),
    }))
    .filter(e => e.name)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.time.localeCompare(b.time));

    // Deduplicate
    const seen = new Set();
    const unique = events.filter(e => {
      const k = e.isoDate + '|' + e.name;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    res.status(200).json({
      ok:       true,
      updated:  new Date().toISOString(),
      timezone: 'UTC-5 (Ecuador)',
      today:    todayStr,
      events:   unique,
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
