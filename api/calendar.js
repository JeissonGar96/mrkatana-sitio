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

  // Get YYYY-MM-DD from ISO string using the date as-is (no tz conversion for date)
  function toIsoDate(raw) {
    if (!raw) return '';
    raw = raw.trim();
    if (raw.includes('T')) return raw.slice(0, 10);
    if (raw.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [mm,dd,yyyy] = raw.split('-');
      return `${yyyy}-${mm}-${dd}`;
    }
    if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) return raw;
    return '';
  }

  // Convert ISO datetime to UTC-5 time label
  function toTimeLabel(raw) {
    if (!raw || !raw.includes('T')) {
      const t = (raw||'').trim().toLowerCase();
      return !t||t==='tentative' ? 'Tent.'
           : t==='all day' ? 'Todo el día'
           : (raw||'').replace(/([ap]m)$/i, s=>' '+s.toUpperCase());
    }
    const dt = new Date(raw);
    const ec = new Date(dt.getTime() - 5*3600000);
    const h  = ec.getUTCHours(), m = ec.getUTCMinutes();
    return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
  }

  // Convert YYYY-MM-DD to readable label
  function toDateLabel(isoDate) {
    if (!isoDate) return '';
    const [yyyy,mm,dd] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(yyyy,mm-1,dd));
    return `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
  }

  // Get Monday of the week containing a given date
  function getMonday(date) {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0,10);
  }

  try {
    const todayStr   = new Date().toISOString().slice(0,10);
    const todayDate  = new Date(todayStr);

    // Calculate this Monday and next Monday
    const thisMon = getMonday(todayDate);
    const nextMon = new Date(new Date(thisMon).getTime() + 7*86400000).toISOString().slice(0,10);

    // Build URLs for this week and next week by date
    // FF feed format: ff_calendar_YYYY-MM-DD.json (week starting that Monday)
    const urls = [
      `https://nfs.faireconomy.media/ff_calendar_thisweek.json`,
      `https://nfs.faireconomy.media/ff_calendar_nextweek.json`,
      `https://nfs.faireconomy.media/ff_calendar_${thisMon}.json`,
      `https://nfs.faireconomy.media/ff_calendar_${nextMon}.json`,
    ];

    // Fetch all, ignore errors
    const results = await Promise.allSettled(
      urls.map(url => fetch(url, { headers: HEADERS }).then(r => r.ok ? r.json() : []))
    );

    const all = [];
    const seen_urls = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        all.push(...r.value);
      }
    }

    // Deduplicate raw events by title+date
    const rawSeen = new Set();
    const unique_raw = all.filter(e => {
      const k = (e.title||'') + '|' + (e.date||'');
      if (rawSeen.has(k)) return false;
      rawSeen.add(k); return true;
    });

    // Filter: USD + High impact
    const usdHigh = unique_raw.filter(e =>
      e.country === 'USD' && e.impact === 'High'
    );

    // Split into future and past
    const future = usdHigh.filter(e => toIsoDate(e.date) >= todayStr);
    const past   = usdHigh.filter(e => toIsoDate(e.date) <  todayStr);

    // Show future events; if none, show this week's past events as fallback
    const display = future.length > 0 ? future : past;

    const s = v => (v!=null && String(v).trim()!=='') ? String(v).trim() : '—';

    const events = display.map(e => {
      const isoDate = toIsoDate(e.date);
      return {
        date:     toDateLabel(isoDate),
        isoDate,
        time:     toTimeLabel(e.date),
        currency: 'USD',
        name:     (e.title||'').trim(),
        impact:   'high',
        forecast: s(e.forecast),
        previous: s(e.previous),
        actual:   s(e.actual),
      };
    })
    .filter(e => e.name)
    .sort((a,b) => a.isoDate.localeCompare(b.isoDate) || a.time.localeCompare(b.time));

    // Final dedup
    const seenFinal = new Set();
    const final = events.filter(e => {
      const k = e.isoDate+'|'+e.name;
      if (seenFinal.has(k)) return false;
      seenFinal.add(k); return true;
    });

    res.status(200).json({
      ok:       true,
      updated:  new Date().toISOString(),
      timezone: 'UTC-5 (Ecuador)',
      today:    todayStr,
      events:   final,
    });

  } catch(err) {
    res.status(500).json({ ok:false, error:err.message, events:[] });
  }
};
