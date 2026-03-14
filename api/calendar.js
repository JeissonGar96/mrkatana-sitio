// api/calendar.js — Vercel Serverless Function
// ForexFactory public JSON feed — USD HIGH impact only
// Fetches this week + next week, shows the most relevant upcoming events

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.forexfactory.com/',
    'Origin': 'https://www.forexfactory.com',
  };

  try {
    // Fetch both this week and next week in parallel
    const [r1, r2] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',  { headers: HEADERS }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', { headers: HEADERS }),
    ]);

    const thisWeek = r1.ok ? await r1.json() : [];
    const nextWeek = r2.ok ? await r2.json() : [];
    const combined = [...thisWeek, ...nextWeek];

    console.log('[DEBUG] thisWeek:', thisWeek.length, '| nextWeek:', nextWeek.length);
    if (combined.length > 0) {
      console.log('[DEBUG] Sample fields:', Object.keys(combined[0]));
      console.log('[DEBUG] Sample event:', JSON.stringify(combined[0]));
      console.log('[DEBUG] Impact values:', [...new Set(combined.map(e => e.impact))]);
      console.log('[DEBUG] Currency sample:', [...new Set(combined.map(e => e.currency))].slice(0,8));
    }

    // Filter: USD + HIGH impact only
    const filtered = combined.filter(e => {
      const imp  = (e.impact   || '').trim();
      const curr = (e.currency || '').trim().toUpperCase();
      const isHigh = imp === 'High' || imp === 'HIGH' || imp === 'high';
      const isUSD  = curr === 'USD';
      return isHigh && isUSD;
    });

    console.log('[DEBUG] USD High count:', filtered.length);

    // ── Parse each event ──
    const events = filtered.map(e => {
      const rawDate = (e.date || '').trim();
      let dateLabel = '', isoDate = '', timeLabel = '';

      // ISO datetime: "2026-03-18T12:30:00-0500"
      if (rawDate.includes('T')) {
        try {
          const dt = new Date(rawDate);
          // Use EST/EDT offset
          const month = dt.getUTCMonth(); // 0=Jan
          const isDST = month >= 2 && month <= 10; // Mar–Nov approx
          const offsetH = isDST ? -4 : -5;
          const local = new Date(dt.getTime() + (offsetH * 3600000));
          dateLabel = `${DAYS[local.getUTCDay()]}, ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
          isoDate   = `${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,'0')}-${String(local.getUTCDate()).padStart(2,'0')}`;
          const h = local.getUTCHours(), m = local.getUTCMinutes();
          const hh = h % 12 || 12, mm = String(m).padStart(2,'0'), ap = h < 12 ? 'AM' : 'PM';
          timeLabel = `${hh}:${mm} ${ap}`;
        } catch(_) { dateLabel = rawDate; isoDate = rawDate; }

      // MM-DD-YYYY: "03-18-2026"
      } else if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [mm, dd, yyyy] = rawDate.split('-').map(Number);
        const dt = new Date(yyyy, mm - 1, dd);
        dateLabel = `${DAYS[dt.getDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;

      // YYYY-MM-DD: "2026-03-18"
      } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [yyyy, mm, dd] = rawDate.split('-').map(Number);
        const dt = new Date(yyyy, mm - 1, dd);
        dateLabel = `${DAYS[dt.getDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = rawDate;
      } else {
        dateLabel = rawDate; isoDate = rawDate;
      }

      // Separate time field (used when date has no time component)
      if (!timeLabel) {
        const rawTime = (e.time || '').trim();
        if (!rawTime || rawTime.toLowerCase() === 'tentative') {
          timeLabel = 'Tent.';
        } else if (rawTime.toLowerCase() === 'all day') {
          timeLabel = 'Todo el día';
        } else {
          timeLabel = rawTime.replace(/([ap]m)$/i, s => ' ' + s.toUpperCase());
        }
      }

      return {
        date:     dateLabel,
        isoDate:  isoDate,
        time:     timeLabel,
        currency: (e.currency || '').trim(),
        name:     (e.title || e.name || e.event || '').trim(),
        impact:   'high',
        forecast: (e.forecast != null && e.forecast !== '') ? String(e.forecast) : '—',
        previous: (e.previous != null && e.previous !== '') ? String(e.previous) : '—',
        actual:   (e.actual   != null && e.actual   !== '') ? String(e.actual)   : '—',
      };
    })
    .filter(e => e.name)
    .sort((a, b) => {
      const dc = a.isoDate.localeCompare(b.isoDate);
      if (dc !== 0) return dc;
      return a.time.localeCompare(b.time);
    });

    // Deduplicate (same date + name)
    const seen = new Set();
    const unique = events.filter(e => {
      const key = e.isoDate + '|' + e.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.status(200).json({
      ok: true,
      updated: new Date().toISOString(),
      total_raw: combined.length,
      events: unique,
    });

  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
