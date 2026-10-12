// api/calendar.js — Vercel Serverless Function
// ForexFactory feed — USD High impact only

// Última respuesta buena: si ForexFactory nos limita o falla, devolvemos esta copia
// en lugar de un error (vive mientras la función siga "caliente" en Vercel).
let lastGood = null;
// Resultados ya conseguidos de JB News (cada consulta a JB News cuesta 1 crédito)
const jbFound = {};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Vercel guarda la respuesta 5 min y, si el feed falla, sigue sirviendo la anterior hasta 1 día
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400, stale-if-error=86400');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.forexfactory.com/',
  };

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

  function toSortKey(raw) {
    if (!raw) return 0;
    raw = raw.trim();
    if (raw.includes('T')) return new Date(raw).getTime();
    const isoDate = toIsoDate(raw);
    return isoDate ? new Date(isoDate + 'T00:00:00Z').getTime() : 0;
  }

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

  function toDateLabel(isoDate) {
    if (!isoDate) return '';
    const [yyyy,mm,dd] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(yyyy,mm-1,dd));
    return `${DAYS[dt.getUTCDay()]}, ${MONTHS[mm-1]} ${dd}`;
  }

  function getMonday(date) {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0,10);
  }

  try {
    const todayStr  = new Date().toISOString().slice(0,10);
    const thisMon   = getMonday(new Date(todayStr));
    const nextMon   = new Date(new Date(thisMon).getTime() + 7*86400000).toISOString().slice(0,10);

    // ForexFactory bloquea por un rato si recibe muchas peticiones seguidas,
    // así que solo pedimos lo necesario: esta semana, y la próxima desde el viernes.
    const dow = new Date().getUTCDay();
    const urls = [`https://nfs.faireconomy.media/ff_calendar_thisweek.json`];
    if (dow === 5 || dow === 6 || dow === 0) urls.push(`https://nfs.faireconomy.media/ff_calendar_nextweek.json`);

    // Resultados reales ("Actual"): el feed gratis de ForexFactory no los trae,
    // así que los pedimos a JB News (mismo calendario de ForexFactory) si hay llave.
    const jbKey = process.env.JBNEWS_API_KEY;
    let jbStatus = jbKey ? 'sin respuesta' : 'sin llave';
    let jbRaw = '';
    const jbGet = (path, src) => fetch('https://www.jblanked.com/news/api/' + (src || 'forex-factory') + '/calendar/' + path, {
        headers: { 'Authorization': 'Api-Key ' + jbKey.trim(), 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      }).then(r => r.ok ? r.json() : r.text().then(t => { throw new Error('HTTP ' + r.status + ' ' + String(t).replace(/\s+/g, ' ').slice(0, 160)); }))
        .then(d => {
          if (Array.isArray(d)) return d;
          if (d && Array.isArray(d.data)) return d.data;
          jbRaw = JSON.stringify(d).slice(0, 200); // respuesta inesperada: la mostramos para revisarla
          return [];
        });
    // Pedimos la semana completa sin filtros (filtramos aquí); si viene vacía, probamos por rango de fechas
    const jbFetch = () => jbKey
      ? jbGet('week/')
          .then(d => { jbStatus = 'week: ' + d.length; if (d.length) return d;
            return new Promise(ok => setTimeout(ok, 1100)).then(() => jbGet('range/?from=' + thisMon + '&to=' + new Date(new Date(thisMon).getTime() + 6*86400000).toISOString().slice(0,10))
              .then(d2 => { jbStatus += ', range: ' + d2.length; return d2; })); })
          .catch(e => {
            // Si ForexFactory no está permitido con esta llave, probamos el calendario de MQL5
            jbStatus = 'forex-factory error: ' + (e && e.message);
            return new Promise(ok => setTimeout(ok, 1100)).then(() => jbGet('week/', 'mql5'))
              .then(d => { jbStatus += ' | mql5 week: ' + d.length; return d; })
              .catch(e2 => { jbStatus += ' | mql5 error: ' + (e2 && e2.message); return []; });
          })
      : Promise.resolve([]);

    const results = await Promise.allSettled(
      urls.map(url =>
        fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) })
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );

    const all = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
    }

    // If all fetches failed return error so client keeps cached data
    if (!all.length) {
      if (lastGood) return res.status(200).json(Object.assign({}, lastGood, { stale: true }));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ ok: false, error: 'Feed unavailable', events: [] });
    }

    const rawSeen = new Set();
    const unique_raw = all.filter(e => {
      const k = (e.title||'') + '|' + (e.date||'');
      if (rawSeen.has(k)) return false;
      rawSeen.add(k); return true;
    });

    const usdHigh = unique_raw.filter(e => e.country === 'USD' && e.impact === 'High');

    const future = usdHigh.filter(e => toIsoDate(e.date) >= todayStr);
    const past   = usdHigh.filter(e => toIsoDate(e.date) <  todayStr);
    const display = future.length > 0 ? future : past;

    const s = v => (v!=null && String(v).trim()!=='') ? String(v).trim() : '—';

    // Índice de resultados de JB News por día + nombre del evento
    // Solo gastamos un crédito de JB News si hay una noticia que ya salió (últimas 3 h)
    // y todavía no tenemos su resultado.
    const nowMs0 = Date.now();
    const keyOf = e => toIsoDate(e.date) + '|' + String(e.title||'').toLowerCase().replace(/\s+/g, ' ').trim();
    const needJb = display.some(e => {
      const t = toSortKey(e.date);
      return t <= nowMs0 && nowMs0 - t < 3 * 3600000 && s(e.actual) === '—' && jbFound[keyOf(e)] === undefined;
    });
    if (!needJb && jbKey) jbStatus = 'en espera (no hay noticias pendientes de resultado)';
    const jbList = needJb ? await jbFetch() : [];
    const norm = t => String(t||'').toLowerCase().replace(/\s+/g, ' ').trim();
    const jbActual = {};
    (Array.isArray(jbList) ? jbList : []).forEach(j => {
      if (j.Currency && j.Currency !== 'USD') return;
      const day = String(j.Date || '').slice(0, 10).replace(/\./g, '-');
      if (j.Actual === null || j.Actual === undefined || j.Actual === '') return;
      jbActual[day + '|' + norm(j.Name)] = j.Actual;
      jbFound[day + '|' + norm(j.Name)] = j.Actual;
    });
    // Le pone al número el mismo sufijo que usa ForexFactory (%, K, M, B)
    const withUnit = (val, like) => {
      const m = String(like || '').match(/([%KMBT])$/i);
      return String(val) + (m && !String(val).match(/[%KMBT]$/i) ? m[1] : '');
    };
    const nowMs = Date.now();

    const events = display.map(e => ({
      date:     toDateLabel(toIsoDate(e.date)),
      isoDate:  toIsoDate(e.date),
      sortKey:  toSortKey(e.date),
      time:     toTimeLabel(e.date),
      currency: 'USD',
      name:     (e.title||'').trim(),
      impact:   'high',
      forecast: s(e.forecast),
      previous: s(e.previous),
      actual:   (function() {
        const own = s(e.actual);
        if (own !== '—') return own;
        // Solo si la noticia ya salió (evita mostrar un 0 antes de tiempo)
        if (toSortKey(e.date) > nowMs) return own;
        const k = toIsoDate(e.date) + '|' + norm(e.title);
        const v = jbActual[k] !== undefined ? jbActual[k] : jbFound[k];
        return (v === undefined) ? own : withUnit(v, e.forecast || e.previous);
      })(),
    }))
    .filter(e => e.name)
    .sort((a, b) => a.sortKey - b.sortKey);

    const seenFinal = new Set();
    const final = events
      .filter(e => {
        const k = e.isoDate+'|'+e.name;
        if (seenFinal.has(k)) return false;
        seenFinal.add(k); return true;
      })
      .map(e => { delete e.sortKey; return e; });

    lastGood = {
      ok:       true,
      updated:  new Date().toISOString(),
      timezone: 'UTC-5 (Ecuador)',
      today:    todayStr,
      events:   final,
      jbnews:   jbStatus + (jbRaw ? ' · ' + jbRaw : ''), // para revisar en /api/calendar si JB News responde
    };
    res.status(200).json(lastGood);

  } catch(err) {
    if (lastGood) return res.status(200).json(Object.assign({}, lastGood, { stale: true }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: err.message, events: [] });
  }
};
