// api/calendar.js — Vercel Serverless Function
// ForexFactory public JSON feed — HIGH impact only

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  try {
    const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.forexfactory.com/',
        'Origin': 'https://www.forexfactory.com',
      },
    });

    if (!response.ok) throw new Error(`Feed responded ${response.status}`);

    const raw = await response.json();

    // ── DEBUG: log first HIGH event so we can see exact field names/formats
    const firstHigh = raw.find(e => (e.impact||'').toLowerCase() === 'high');
    if (firstHigh) console.log('[DEBUG] first HIGH event:', JSON.stringify(firstHigh));

    const events = raw
      .filter(e => (e.impact || '').toLowerCase() === 'high' && (e.currency || '').toUpperCase() === 'USD')
      .map(e => {
        // ── DATE + TIME ──
        // The feed date field can be:
        //   "03-18-2026"          (MM-DD-YYYY — no time)
        //   "2026-03-18T12:30:00-0500"  (ISO with time)
        //   "2026-03-18 12:30:00"       (space-separated)
        const rawDate = (e.date || '').trim();
        let dateLabel = '', timeLabel = '', isoDate = '';

        if (rawDate.includes('T') || rawDate.includes(' ')) {
          // ISO or space-separated datetime
          const dt = new Date(rawDate);
          if (!isNaN(dt)) {
            // Convert to EST (UTC-5 standard, UTC-4 daylight)
            const estOffset = -5 * 60; // minutes
            const localMs = dt.getTime() + (estOffset * 60000) + (dt.getTimezoneOffset() * 60000);
            const est = new Date(localMs);
            dateLabel = `${DAYS[est.getDay()]}, ${MONTHS[est.getMonth()]} ${est.getDate()}`;
            isoDate   = `${est.getFullYear()}-${String(est.getMonth()+1).padStart(2,'0')}-${String(est.getDate()).padStart(2,'0')}`;
            const h = est.getHours(), m = est.getMinutes();
            const hh = h % 12 || 12, mm = String(m).padStart(2,'0'), ampm = h < 12 ? 'AM' : 'PM';
            timeLabel = `${hh}:${mm} ${ampm}`;
          }
        } else if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
          // MM-DD-YYYY
          const [mm, dd, yyyy] = rawDate.split('-').map(Number);
          const dt = new Date(yyyy, mm - 1, dd);
          dateLabel = `${DAYS[dt.getDay()]}, ${MONTHS[mm-1]} ${dd}`;
          isoDate   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // YYYY-MM-DD
          const [yyyy, mm, dd] = rawDate.split('-').map(Number);
          const dt = new Date(yyyy, mm - 1, dd);
          dateLabel = `${DAYS[dt.getDay()]}, ${MONTHS[mm-1]} ${dd}`;
          isoDate   = rawDate;
        } else {
          dateLabel = rawDate;
          isoDate   = rawDate;
        }

        // ── TIME (separate field if present) ──
        // Only use e.time if we didn't already extract time from ISO date
        if (!timeLabel) {
          const rawTime = (e.time || '').trim();
          if (!rawTime || rawTime.toLowerCase() === 'tentative' || rawTime.toLowerCase() === 'all day') {
            timeLabel = rawTime.toLowerCase() === 'all day' ? 'Todo el día' : 'Tent.';
          } else {
            // "8:30am" → "8:30 AM"
            timeLabel = rawTime.replace(/([ap]m)$/i, s => ' ' + s.toUpperCase());
          }
        }

        return {
          date:     dateLabel,
          isoDate:  isoDate,
          time:     timeLabel,
          currency: e.currency || e.country || '',
          name:     e.title    || e.name    || e.event || '',
          impact:   'high',
          forecast: (e.forecast  != null && e.forecast  !== '') ? String(e.forecast)  : '—',
          previous: (e.previous  != null && e.previous  !== '') ? String(e.previous)  : '—',
          actual:   (e.actual    != null && e.actual    !== '') ? String(e.actual)    : '—',
        };
      })
      .filter(e => e.name) // remove empty
      .sort((a, b) => {
        if (a.isoDate < b.isoDate) return -1;
        if (a.isoDate > b.isoDate) return 1;
        return a.time.localeCompare(b.time);
      });

    res.status(200).json({ ok: true, updated: new Date().toISOString(), events });

  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
