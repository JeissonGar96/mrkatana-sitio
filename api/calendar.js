// api/calendar.js — Vercel Serverless Function
// ForexFactory public JSON feed — USD HIGH impact only
// Shows current week (if Mon-Fri) OR next week (if Sat-Sun)

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

  // ── Determine which week(s) to show based on current day (UTC-5) ──
  const nowUTC  = new Date();
  const nowEC   = new Date(nowUTC.getTime() - 5 * 3600000); // Ecuador UTC-5
  const dowEC   = nowEC.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dowEC === 0 || dowEC === 6;

  // Get Monday of a given week (UTC-5)
  function getMondayOf(d) {
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(d.getTime() + diff * 86400000);
    mon.setUTCHours(0,0,0,0);
    return mon;
  }

  const thisMonday = getMondayOf(nowEC);
  const nextMonday = new Date(thisMonday.getTime() + 7 * 86400000);
  const nextSunday = new Date(nextMonday.getTime() + 6 * 86400000);
  nextSunday.setUTCHours(23,59,59,999);

  // On weekends show NEXT week; on weekdays show THIS week
  const windowStart = isWeekend
    ? nextMonday
    : thisMonday;
  const windowEnd = isWeekend
    ? nextSunday
    : new Date(thisMonday.getTime() + 6 * 86400000 + 86399999);

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',  { headers: HEADERS }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', { headers: HEADERS }),
    ]);

    const thisWeek = r1.ok ? await r1.json() : [];
    const nextWeek = r2.ok ? await r2.json() : [];
    const combined = [...thisWeek, ...nextWeek];

    // ── Filter: USD + High impact ──
    const filtered = combined.filter(e => {
      const imp  = e.impact;
      const curr = (e.currency || e.country || '').toString().toUpperCase().trim();
      const isHigh = imp === 'High' || imp === 3 || imp === '3' || imp === 'high' || imp === 'HIGH';
      const isUSD  = curr === 'USD' || curr === 'US';
      return isHigh && isUSD;
    });

    // ── Parse + convert to UTC-5 ──
    function parseEvent(e) {
      const rawDate = (e.date || '').trim();
      let dateLabel = '', isoDate = '', timeLabel = '', eventMs = 0;

      if (rawDate.includes('T')) {
        try {
          const dt    = new Date(rawDate);
          eventMs     = dt.getTime();
          // Convert to UTC-5 (Ecuador — no DST)
          const local = new Date(dt.getTime() - 5 * 3600000);
          dateLabel   = `${DAYS[local.getUTCDay()]}, ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
          isoDate     = `${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,'0')}-${String(local.getUTCDate()).padStart(2,'0')}`;
          const h     = local.getUTCHours(), m = local.getUTCMinutes();
          timeLabel   = `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
        } catch(_) { dateLabel = rawDate; isoDate = rawDate; }

      } else if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [mm, dd, yyyy] = rawDate.split('-').map(Number);
        const dt = new Date(Date.UTC(yyyy, mm-1, dd));
        eventMs   = dt.getTime();
        dateLabel = `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;

      } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [yyyy, mm, dd] = rawDate.split('-').map(Number);
        const dt = new Date(Date.UTC(yyyy, mm-1, dd));
        eventMs   = dt.getTime();
        dateLabel = `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = rawDate;
      } else {
        dateLabel = rawDate; isoDate = rawDate;
      }

      // Time from separate field
      if (!timeLabel) {
        const t = (e.time || '').trim().toLowerCase();
        if (!t || t === 'tentative') {
          timeLabel = 'Tentativo';
        } else if (t === 'all day') {
          timeLabel = 'Todo el día';
        } else {
          // "8:30am" → "8:30 AM"
          timeLabel = (e.time || '').replace(/([ap]m)$/i, s => ' ' + s.toUpperCase());
        }
      }

      const str = v => (v != null && String(v).trim() !== '') ? String(v).trim() : '—';
      return {
        date:     dateLabel,
        isoDate:  isoDate,
        eventMs:  eventMs,
        time:     timeLabel,
        currency: (e.currency || e.country || '').toString().toUpperCase().trim(),
        name:     (e.title || e.name || e.event || '').trim(),
        impact:   'high',
        forecast: str(e.forecast),
        previous: str(e.previous),
        actual:   str(e.actual),
      };
    }

    const parsed = filtered
      .map(parseEvent)
      .filter(e => e.name);

    // ── Keep only events within the display window ──
    const inWindow = parsed.filter(e => {
      if (!e.isoDate) return false;
      // Compare by isoDate string (YYYY-MM-DD) against window
      const eDate = e.isoDate;
      const wStart = windowStart.toISOString().slice(0,10);
      const wEnd   = windowEnd.toISOString().slice(0,10);
      return eDate >= wStart && eDate <= wEnd;
    });

    // If nothing in window (edge case), fall back to all filtered future events
    let display = inWindow;
    if (!display.length) {
      const todayStr = nowEC.toISOString().slice(0,10);
      display = parsed.filter(e => e.isoDate >= todayStr);
    }

    // Sort by date then time
    display.sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.time.localeCompare(b.time));

    // Deduplicate
    const seen = new Set();
    const unique = display.filter(e => {
      const k = e.isoDate + '|' + e.name;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    // Remove eventMs from output
    unique.forEach(e => delete e.eventMs);

    res.status(200).json({
      ok:        true,
      updated:   new Date().toISOString(),
      timezone:  'UTC-5 (Ecuador)',
      week:      isWeekend ? 'next' : 'current',
      events:    unique,
    });

  } catch (err) {
    console.error('[CAL] error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
