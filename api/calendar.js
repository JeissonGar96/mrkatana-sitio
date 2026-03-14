// api/calendar.js — Vercel Serverless Function
// ForexFactory public JSON feed — HIGH impact only

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  try {
    const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.forexfactory.com/',
      },
    });

    if (!response.ok) throw new Error(`Feed responded ${response.status}`);

    const raw = await response.json();

    // Keep only HIGH impact
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const events = raw
      .filter(e => e.impact === 'High')
      .map(e => {
        // date format from FF: "03-18-2026"
        // time format from FF: "8:30am" | "" | "Tentative" | "All Day"
        let dateLabel = '';
        let isoDate   = '';

        try {
          const parts = (e.date || '').split('-');
          const mo = parseInt(parts[0]) - 1;
          const da = parseInt(parts[1]);
          const yr = parseInt(parts[2]);
          const dt = new Date(yr, mo, da);
          dateLabel = `${DAYS[dt.getDay()]}, ${MONTHS[mo]} ${da}`;
          isoDate   = `${yr}-${String(mo+1).padStart(2,'0')}-${String(da).padStart(2,'0')}`;
        } catch(_) {
          dateLabel = e.date || '';
          isoDate   = e.date || '';
        }

        // Normalize time: "8:30am" → "8:30 AM"
        let timeLabel = e.time || '';
        if (!timeLabel || timeLabel.toLowerCase() === 'tentative' || timeLabel === '') {
          timeLabel = 'Tentativo';
        } else if (timeLabel.toLowerCase() === 'all day') {
          timeLabel = 'Todo el día';
        } else {
          // "8:30am" → "8:30 AM"  |  "12:00pm" → "12:00 PM"
          timeLabel = timeLabel.replace(/([ap]m)$/i, m => ' ' + m.toUpperCase());
        }

        return {
          date:     dateLabel,
          isoDate:  isoDate,
          time:     timeLabel,
          currency: e.currency || '',
          name:     e.title    || '',
          impact:   'high',
          forecast: (e.forecast && e.forecast !== '') ? e.forecast : '—',
          previous: (e.previous && e.previous !== '') ? e.previous : '—',
          actual:   (e.actual   && e.actual   !== '') ? e.actual   : '—',
        };
      })
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    res.status(200).json({ ok: true, updated: new Date().toISOString(), events });

  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
