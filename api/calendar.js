// api/calendar.js — Vercel Serverless Function

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.forexfactory.com/',
  };

  try {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: HEADERS });
    if (!r.ok) throw new Error(`Feed ${r.status}`);
    const all = await r.json();

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
        const [mm,dd,yyyy] = raw.split('-');
        return `${yyyy}-${mm}-${dd}`;
      }
      if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) return raw;
      return '';
    }

    // Show raw debug in response so we can diagnose
    const debugInfo = {
      total: all.length,
      today: todayStr,
      impact_values:  [...new Set(all.map(e => e.impact))],
      country_values: [...new Set(all.map(e => e.country))].slice(0,10),
      date_sample:    all.slice(0,2).map(e => ({ date: e.date, parsed: toIsoDate(e.date) })),
      usd_high_sample: all.filter(e => e.country === 'USD' && e.impact === 'High').slice(0,3),
      usd_high_total:  all.filter(e => e.country === 'USD' && e.impact === 'High').length,
      usd_high_future: all.filter(e => e.country === 'USD' && e.impact === 'High' && toIsoDate(e.date) >= todayStr).length,
    };

    // Filter
    const filtered = all.filter(e =>
      e.country === 'USD' && e.impact === 'High' && toIsoDate(e.date) >= todayStr
    );

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
        const [mm,dd,yyyy] = raw.split('-').map(Number);
        const dt = new Date(Date.UTC(yyyy,mm-1,dd));
        dateLabel = `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
        isoDate   = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
      } else {
        dateLabel = raw; isoDate = toIsoDate(raw);
      }

      if (!timeLabel) {
        const t = (e.time||'').trim();
        timeLabel = !t||t.toLowerCase()==='tentative' ? 'Tent.'
                  : t.toLowerCase()==='all day' ? 'Todo el día'
                  : t.replace(/([ap]m)$/i, s=>' '+s.toUpperCase());
      }

      const s = v => (v!=null && String(v).trim()!=='') ? String(v).trim() : '—';
      return {
        date:dateLabel, isoDate, time:timeLabel, currency:'USD',
        name:(e.title||'').trim(), impact:'high',
        forecast:s(e.forecast), previous:s(e.previous), actual:s(e.actual),
      };
    }).filter(e=>e.name);

    res.status(200).json({
      ok:true, updated:new Date().toISOString(),
      timezone:'UTC-5 (Ecuador)', today:todayStr,
      debug: debugInfo,
      events,
    });

  } catch(err) {
    res.status(500).json({ ok:false, error:err.message, events:[] });
  }
};
