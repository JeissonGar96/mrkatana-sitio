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
    // Fetch both feeds always
    const [r1, r2] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',  { headers: HEADERS }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', { headers: HEADERS }),
    ]);
    const thisWeek = r1.ok ? await r1.json() : [];
    const nextWeek = r2.ok ? await r2.json() : [];
    const combined = [...thisWeek, ...nextWeek];

    // Today in YYYY-MM-DD at UTC-5
    const nowEC    = new Date(Date.now() - 5 * 3600000);
    const todayStr = nowEC.toISOString().slice(0, 10); // "2026-03-14"

    console.log('[CAL] today UTC-5:', todayStr, '| combined:', combined.length);
    if (combined.length > 0) {
      console.log('[CAL] sample keys:', Object.keys(combined[0]));
      console.log('[CAL] sample[0]:', JSON.stringify(combined[0]));
      const impactSet = [...new Set(combined.map(e => String(e.impact)))];
      const currSet   = [...new Set(combined.map(e => String(e.currency || e.country || '')))].slice(0,10);
      console.log('[CAL] impact set:', impactSet);
      console.log('[CAL] currency set:', currSet);
    }

    // ── Filter: USD + High + date >= today ──
    const filtered = combined.filter(e => {
      const imp  = String(e.impact  || '').trim();
      const curr = String(e.currency || e.country || '').toUpperCase().trim();
      const isHigh = ['high','High','HIGH','3'].includes(imp) || imp === '3';
      const isUSD  = curr === 'USD' || curr === 'US';
      if (!isHigh || !isUSD) return false;

      // Parse event date to YYYY-MM-DD
      const raw = (e.date || '').trim();
      let evDate = '';
      if (raw.includes('T')) {
        // ISO: convert to UTC-5 date
        const dt = new Date(raw);
        const ec = new Date(dt.getTime() - 5 * 3600000);
        evDate = ec.toISOString().slice(0, 10);
      } else if (raw.match(/^\d{2}-\d{2}-\d{4}$/)) {
        // MM-DD-YYYY
        const [mm, dd, yyyy] = raw.split('-');
        evDate = `${yyyy}-${mm}-${dd}`;
      } else if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) {
        evDate = raw;
      }

      // Only include events from today onwards
      return evDate >= todayStr;
    });

    console.log('[CAL] after filter (USD+High+future):', filtered.length);

    // ── Parse ──
    const events = filtered.map(e => {
      const raw = (e.date || '').trim();
      let dateLabel = '', isoDate = '', timeLabel = '';

      if (raw.includes('T')) {
        const dt  = new Date(raw);
        const ec  = new Date(dt.getTime() - 5 * 3600000);
        dateLabel = `${DAYS[ec.getUTCDay()]}, ${MONTHS[ec.getUTCMonth()]} ${ec.getUTCDate()}`;
        isoDate   = ec.toISOString().slice(0, 10);
        const h   = ec.getUTCHours(), m = ec.getUTCMinutes();
        timeLabel = `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;

      } else if (raw.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [mm, dd, yyyy] = raw.split('-').map(Number);
        const dt = new Date(Date.UTC(yyyy, mm-1, dd));
        dateLabel = `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;

      } else if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [yyyy, mm, dd] = raw.split('-').map(Number);
        const dt = new Date(Date.UTC(yyyy, mm-1, dd));
        dateLabel = `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = raw;
      } else {
        dateLabel = raw; isoDate = raw;
      }

      // Time from separate field (if no time in ISO)
      if (!timeLabel) {
        const t = (e.time || '').trim();
        if (!t || t.toLowerCase() === 'tentative') {
          timeLabel = 'Tentativo';
        } else if (t.toLowerCase() === 'all day') {
          timeLabel = 'Todo el día';
        } else {
          timeLabel = t.replace(/([ap]m)$/i, s => ' ' + s.toUpperCase());
        }
      }

      const str = v => (v != null && String(v).trim() !== '') ? String(v).trim() : '—';
      return {
        date:     dateLabel,
        isoDate:  isoDate,
        time:     timeLabel,
        currency: 'USD',
        name:     (e.title || e.name || e.event || '').trim(),
        impact:   'high',
        forecast: str(e.forecast),
        previous: str(e.previous),
        actual:   str(e.actual),
      };
    })
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
    console.error('[CAL] error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
