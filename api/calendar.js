// api/calendar.js — Vercel Serverless Function

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.forexfactory.com/',
  };

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',  { headers: HEADERS }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', { headers: HEADERS }),
    ]);
    const a = r1.ok ? await r1.json() : [];
    const b = r2.ok ? await r2.json() : [];
    const all = [...a, ...b];

    // ── FULL DEBUG: return raw sample so we can see exact field values ──
    if (req.query && req.query.debug === '1') {
      return res.status(200).json({
        thisWeek_count: a.length,
        nextWeek_count: b.length,
        first5: all.slice(0, 5),
        impact_values:   [...new Set(all.map(e => e.impact))],
        currency_values: [...new Set(all.map(e => e.currency))].slice(0, 15),
      });
    }

    // Today UTC-5
    const nowEC    = new Date(Date.now() - 5 * 3600000);
    const todayStr = nowEC.toISOString().slice(0, 10);

    function toIsoDate(raw) {
      raw = (raw || '').trim();
      if (raw.includes('T')) {
        const ec = new Date(new Date(raw).getTime() - 5 * 3600000);
        return ec.toISOString().slice(0, 10);
      }
      if (raw.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [mm, dd, yyyy] = raw.split('-');
        return `${yyyy}-${mm}-${dd}`;
      }
      if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) return raw;
      return '';
    }

    // ── Filter: High + USD + from today ──
    // Accept ANY non-low impact value that includes the word "high" or equals 3
    const filtered = all.filter(e => {
      const imp  = String(e.impact  ?? '').toLowerCase().trim();
      const curr = String(e.currency ?? e.country ?? '').toUpperCase().trim();
      const date = toIsoDate(e.date);
      const isHigh = imp.includes('high') || imp === '3';
      const isUSD  = curr === 'USD';
      const isFuture = date >= todayStr;
      return isHigh && isUSD && isFuture;
    });

    // ── Parse ──
    const events = filtered.map(e => {
      const raw = (e.date || '').trim();
      let dateLabel = '', isoDate = '', timeLabel = '';

      if (raw.includes('T')) {
        const ec  = new Date(new Date(raw).getTime() - 5 * 3600000);
        dateLabel = `${DAYS[ec.getUTCDay()]}, ${MONTHS[ec.getUTCMonth()]} ${ec.getUTCDate()}`;
        isoDate   = ec.toISOString().slice(0, 10);
        const h   = ec.getUTCHours(), m = ec.getUTCMinutes();
        timeLabel = `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
      } else if (raw.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [mm, dd, yyyy] = raw.split('-').map(Number);
        const dt = new Date(Date.UTC(yyyy, mm-1, dd));
        dateLabel = `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
      } else {
        dateLabel = raw; isoDate = toIsoDate(raw);
      }

      if (!timeLabel) {
        const t = (e.time || '').trim();
        timeLabel = !t || t.toLowerCase() === 'tentative' ? 'Tent.'
                  : t.toLowerCase() === 'all day' ? 'Todo el día'
                  : t.replace(/([ap]m)$/i, s => ' ' + s.toUpperCase());
      }

      const s = v => (v != null && String(v).trim() !== '') ? String(v).trim() : '—';
      return {
        date: dateLabel, isoDate, time: timeLabel, currency: 'USD',
        name: (e.title || e.name || e.event || '').trim(), impact: 'high',
        forecast: s(e.forecast), previous: s(e.previous), actual: s(e.actual),
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
      ok: true, updated: new Date().toISOString(),
      timezone: 'UTC-5 (Ecuador)', today: todayStr,
      total_raw: all.length, events: unique,
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
