// api/calendar.js — Vercel Serverless Function
// ForexFactory public JSON feed — USD HIGH impact only

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.forexfactory.com/',
    'Origin': 'https://www.forexfactory.com',
  };

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',  { headers: HEADERS }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', { headers: HEADERS }),
    ]);

    const thisWeek = r1.ok ? await r1.json() : [];
    const nextWeek = r2.ok ? await r2.json() : [];
    const combined = [...thisWeek, ...nextWeek];

    // ── DEBUG: show exact raw values so we can see the real field names ──
    if (combined.length > 0) {
      console.log('[CAL] total:', combined.length);
      console.log('[CAL] keys:', Object.keys(combined[0]));
      // Show first 3 events in full
      combined.slice(0, 3).forEach((e, i) => console.log(`[CAL] event[${i}]:`, JSON.stringify(e)));
      // Show all unique impact values
      const impactVals = [...new Set(combined.map(e => JSON.stringify(e.impact)))];
      console.log('[CAL] impact values:', impactVals);
      // Show all unique currency values
      const currVals = [...new Set(combined.map(e => JSON.stringify(e.currency)))].slice(0, 15);
      console.log('[CAL] currency values:', currVals);
    }

    // ── FILTER: flexible match for USD + High impact ──
    // impact can be: "High", 3, "3", "high", true — try all
    // currency can be: "USD", "usd", "US" — try all
    const filtered = combined.filter(e => {
      const imp  = e.impact;
      const curr = (e.currency || e.country || '').toString().toUpperCase().trim();

      const isHigh = imp === 'High' || imp === 3 || imp === '3' ||
                     imp === 'high' || imp === 'HIGH' || imp === true;
      const isUSD  = curr === 'USD' || curr === 'US';

      return isHigh && isUSD;
    });

    console.log('[CAL] filtered USD+High:', filtered.length);
    if (filtered.length > 0) {
      console.log('[CAL] first filtered:', JSON.stringify(filtered[0]));
    }

    // ── PARSE ──
    function parseEvent(e) {
      const rawDate = (e.date || '').trim();
      let dateLabel = '', isoDate = '', timeLabel = '';

      if (rawDate.includes('T')) {
        try {
          const dt = new Date(rawDate);
          const isDST = dt.getUTCMonth() >= 2 && dt.getUTCMonth() <= 10;
          const offsetH = isDST ? -4 : -5;
          const local = new Date(dt.getTime() + offsetH * 3600000);
          dateLabel = `${DAYS[local.getUTCDay()]}, ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
          isoDate   = `${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,'0')}-${String(local.getUTCDate()).padStart(2,'0')}`;
          const h = local.getUTCHours(), m = local.getUTCMinutes();
          timeLabel = `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
        } catch(_) { dateLabel = rawDate; isoDate = rawDate; }

      } else if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [mm, dd, yyyy] = rawDate.split('-').map(Number);
        const dt = new Date(yyyy, mm-1, dd);
        dateLabel = `${DAYS[dt.getDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;

      } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [yyyy, mm, dd] = rawDate.split('-').map(Number);
        const dt = new Date(yyyy, mm-1, dd);
        dateLabel = `${DAYS[dt.getDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = rawDate;
      } else {
        dateLabel = rawDate; isoDate = rawDate;
      }

      if (!timeLabel) {
        const t = (e.time || '').trim().toLowerCase();
        timeLabel = !t || t === 'tentative' ? 'Tent.'
                  : t === 'all day'         ? 'Todo el día'
                  : (e.time || '').replace(/([ap]m)$/i, s => ' ' + s.toUpperCase());
      }

      const str = v => (v != null && v !== '') ? String(v) : '—';
      return {
        date:     dateLabel,
        isoDate:  isoDate,
        time:     timeLabel,
        currency: (e.currency || e.country || '').toString().toUpperCase().trim(),
        name:     (e.title || e.name || e.event || '').trim(),
        impact:   'high',
        forecast: str(e.forecast),
        previous: str(e.previous),
        actual:   str(e.actual),
      };
    }

    const events = filtered
      .map(parseEvent)
      .filter(e => e.name)
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.time.localeCompare(b.time));

    // Deduplicate
    const seen = new Set();
    const unique = events.filter(e => {
      const k = e.isoDate + '|' + e.name;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // ── If still empty, return ALL events for debug ──
    if (unique.length === 0) {
      const sample = combined.slice(0, 5).map(e => ({
        raw_impact: e.impact, raw_currency: e.currency, raw_country: e.country,
        title: e.title, date: e.date
      }));
      return res.status(200).json({ ok: true, updated: new Date().toISOString(),
        total_raw: combined.length, events: [], debug_sample: sample });
    }

    res.status(200).json({ ok: true, updated: new Date().toISOString(),
      total_raw: combined.length, events: unique });

  } catch (err) {
    console.error('[CAL] error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
