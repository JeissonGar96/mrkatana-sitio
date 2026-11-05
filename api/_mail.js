// api/_mail.js
// Diseño común de todos los correos de la plataforma (aprobado por Jeisson el 2026-11-05):
// bloque azul arriba con logo, título y textura de velas; objetos 3D que salen del bloque;
// texto en blanco, un solo botón azul, redes con íconos y avisos legales al final.
// Las imágenes viven en /img/correos/ del sitio (deben estar en la página publicada).

const SITE = 'https://www.mrkatanafx.com';
const IMG = SITE + '/img/correos/';
const G = '#3B4CF0';
const F = "font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;";

// Redes: deja el link vacío para ocultar el ícono
const REDES = [
  ['ig', 'Instagram', 'https://www.instagram.com/mrkatana.fx'],
  ['yt', 'YouTube', 'https://www.youtube.com/@MrKatanaFX'],
  ['tt', 'TikTok', 'https://www.tiktok.com/@mrkatana.fx'],
  ['dc', 'Discord', 'https://discord.com/app'],
  ['wa', 'WhatsApp', 'https://wa.me/593995014247']
];

const RISK = '<b>Aviso de riesgo:</b> operar divisas, oro, índices y otros instrumentos con apalancamiento tiene un alto riesgo y puede no ser adecuado para todos. Puedes perder parte o todo tu capital. El contenido de Mr Katana FX es educativo y no es asesoría financiera ni una recomendación de inversión. Los resultados pasados no garantizan resultados futuros.';
const PRIZE = 'Los premios del ranking mensual dependen de cada edición y están sujetos a los términos y condiciones de la plataforma. Mr Katana FX puede cambiarlos o cancelarlos con aviso previo.';
const SERVICE = 'Este es un correo de servicio sobre tu cuenta en Mr Katana FX. Lo recibes aunque no estés suscrito a promociones.';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const b = t => '<b style="color:#14161f;">' + t + '</b>';
const hl = t => '<b style="color:' + G + ';">' + t + '</b>';
const p = (t, center) => '<div style="' + F + 'font-size:13.5px;line-height:22px;color:#3f4250;margin:0 0 12px;' + (center ? 'text-align:center;' : '') + '">' + t + '</div>';
const h2 = t => '<div style="' + F + 'font-size:18px;line-height:25px;color:#14161f;font-weight:800;text-align:center;margin:6px 0 14px;">' + t + '</div>';
const icon = (f, w) => '<img src="' + IMG + f + '" width="' + w + '" alt="" style="display:block;margin:0 auto 6px;width:' + w + 'px;height:auto;">';
const hr = '<div style="height:1px;background:#e9eaf2;margin:20px 0 22px;"></div>';
function bl(items) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">' + items.map(t =>
    '<tr><td width="22" valign="top"><div style="width:7px;height:7px;border-radius:50%;background:' + G + ';margin-top:7px;"></div></td><td style="' + F + 'font-size:13px;line-height:20px;color:#3f4250;padding:0 0 9px;">' + t + '</td></tr>').join('') + '</table>';
}
function box(rows) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4fb;border-radius:12px;margin:4px 0 18px;">' + rows.map((r, i) => {
    const ln = i < rows.length - 1 ? 'border-bottom:1px solid #e4e6f2;' : '';
    return '<tr><td style="' + F + 'font-size:12px;color:#7c8090;padding:11px 16px;' + ln + '">' + r[0] + '</td><td align="right" style="' + F + 'font-size:13px;color:#14161f;font-weight:700;padding:11px 16px;' + ln + '">' + r[1] + '</td></tr>';
  }).join('') + '</table>';
}

// o: { eyebrow, title, sub, body, cta, url, note, art, big, panel, unsub, unsubUrl, prize, foot }
// art: lanz wix conf pass magic mail inv live week aviso ren renf cuo cuof
function page(o) {
  const big = !!o.big;
  const hero = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" background="' + IMG + 'fondo2.jpg" style="background-color:' + G + ';background-image:url(' + IMG + 'fondo2.jpg);background-position:center bottom;background-size:100% auto;background-repeat:no-repeat;border-radius:16px 16px 0 0;">' +
    '<tr><td align="center" style="padding:28px 24px 0;"><img src="' + IMG + 'logo.png" width="130" alt="Mr Katana" style="display:block;width:130px;height:auto;"></td></tr>' +
    '<tr><td align="center" style="padding:22px 24px 0;' + F + 'font-size:11px;letter-spacing:3px;color:#c9cdff;font-weight:700;text-transform:uppercase;">' + (o.eyebrow || 'Mr Katana FX') + '</td></tr>' +
    '<tr><td align="center" style="padding:10px 28px 0;' + F + 'font-size:' + (big ? 32 : 28) + 'px;line-height:' + (big ? 38 : 35) + 'px;color:#ffffff;font-weight:800;letter-spacing:-.5px;">' + o.title + '</td></tr>' +
    (o.sub ? '<tr><td align="center" style="padding:12px 40px 4px;' + F + 'font-size:14px;line-height:22px;color:#dfe2ff;">' + o.sub + '</td></tr>' : '<tr><td style="padding:4px;"></td></tr>') +
    '</table>';
  const btn = o.cta ? '<a href="' + (o.url || SITE + '/app') + '" style="display:block;background:' + G + ';border-radius:12px;padding:15px 20px;text-align:center;' + F + 'font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">' + o.cta + '</a>' : '';
  const panel = o.panel ? '<tr><td style="padding:6px 36px 22px;"><div style="' + F + 'font-size:12px;letter-spacing:2px;color:#7c8090;font-weight:700;text-transform:uppercase;text-align:center;margin-bottom:12px;">Así se ve tu panel</div><img src="' + IMG + 'panel.jpg" width="528" alt="Panel de Mr Katana" style="display:block;width:100%;height:auto;border-radius:12px;border:1px solid #e4e6f2;"></td></tr>' : '';
  const lk = 'color:#7c8090;';
  const links = '<a href="' + SITE + '/legal" style="' + lk + '">Términos y condiciones</a> &nbsp;·&nbsp; <a href="' + SITE + '/legal" style="' + lk + '">Política de privacidad</a>' +
    (o.unsub ? ' &nbsp;·&nbsp; <a href="' + (o.unsubUrl || SITE + '/app/perfil') + '" style="' + lk + '">Darme de baja</a>' : ' &nbsp;·&nbsp; <a href="' + SITE + '/app/perfil" style="' + lk + '">Ajustes de notificaciones</a>');
  const soc = REDES.filter(r => r[2]).map(r => '<td style="padding:0 6px;"><a href="' + r[2] + '"><img src="' + IMG + 'red-' + r[0] + '.png" width="34" height="34" alt="' + r[1] + '" style="display:block;width:34px;height:34px;"></a></td>').join('');
  const small = t => '<tr><td align="center" style="padding:10px 34px 0;' + F + 'font-size:11px;line-height:17px;color:#8a8e9c;">' + t + '</td></tr>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light only;supported-color-schemes:light only;}</style></head><body style="margin:0;padding:0;background:#eef0f7;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f7;"><tr><td align="center" style="padding:24px 10px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;">' +
    '<tr><td style="padding:12px 2% 0;">' + hero + '</td></tr>' +
    '<tr><td style="padding:0;"><img src="' + IMG + 'b-' + (o.art || 'aviso') + '.png" width="600" alt="" style="display:block;width:100%;height:auto;"></td></tr>' +
    '<tr><td style="padding:14px 36px 8px;">' + (o.body || '') + '</td></tr>' + panel +
    '<tr><td style="padding:4px 36px 34px;">' + btn + (o.note ? '<div style="' + F + 'font-size:12px;line-height:18px;color:#8a8e9c;text-align:center;padding-top:12px;">' + o.note + '</div>' : '') + '</td></tr>' +
    '</table>' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">' +
    '<tr><td align="center" style="padding:26px 20px 6px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' + soc + '</tr></table></td></tr>' +
    '<tr><td align="center" style="padding:14px 30px 0;' + F + 'font-size:13px;color:#3f4250;font-weight:700;">Mr Katana FX</td></tr>' +
    '<tr><td align="center" style="padding:4px 30px 0;' + F + 'font-size:12px;line-height:18px;color:#7c8090;">Formación de trading · www.mrkatanafx.com<br>¿Dudas? Escríbenos por WhatsApp o en Instagram @mrkatana.fx. No respondas a este correo.</td></tr>' +
    '<tr><td align="center" style="padding:14px 30px 0;' + F + 'font-size:11px;line-height:17px;color:#7c8090;">' + links + '</td></tr>' +
    '<tr><td style="padding:16px 36px 0;"><div style="height:1px;background:#dfe1ea;"></div></td></tr>' +
    small(o.foot || SERVICE) + (o.prize ? small(PRIZE) : '') + small(RISK) +
    '<tr><td align="center" style="padding:12px 34px 10px;' + F + 'font-size:11px;color:#a3a7b4;">© ' + new Date().getFullYear() + ' Mr Katana FX. Todos los derechos reservados.</td></tr>' +
    '</table></td></tr></table></body></html>';
}

// Correo de lanzamiento: alumnos/registrados (kind 'users') o contactos antiguos (kind 'wix')
function launch(kind, unsubUrl) {
  const wix = kind === 'wix';
  const premios = icon('i-premio.png', 56) + h2('Cada mes hay premios') +
    p('Con el ' + b('ranking del mes') + ' compites con los demás alumnos por ser el más constante. Sumas un punto por cada día que operas, y los primeros del mes pueden ganar ' + hl('efectivo o cuentas de fondeo') + '.', true);
  if (wix) return page({ art: 'wix', big: true, panel: true, prize: true, unsub: true, unsubUrl,
    eyebrow: 'Mr Katana FX', title: 'Volvimos, y ahora<br>con plataforma propia', sub: 'Crea tu cuenta gratis y conoce todo lo que preparamos.',
    body: p('Hola, hace un tiempo fuiste parte de la comunidad de Mr Katana. Hoy abrimos nuestra plataforma, y puedes entrar ' + b('gratis') + ':', true) +
      bl(['Journal automático para tus cuentas de Exness o Funding Pips.', 'Ranking mensual con premios como ' + hl('efectivo o cuentas de fondeo') + '.', 'Calendario económico y avisos de noticias fuertes.', 'Cuando quieras, sumas las clases, los en vivos y las sesiones 1-1.']),
    cta: 'Crear mi cuenta gratis', url: SITE + '/login#registro', note: 'Toma menos de un minuto.',
    foot: 'Recibes este correo porque en algún momento dejaste tus datos en Mr Katana FX. Si no quieres recibir más, toca Darme de baja.' });
  return page({ art: 'lanz', big: true, panel: true, prize: true, unsub: true, unsubUrl,
    eyebrow: 'Ya está abierta', title: 'Tu nueva plataforma<br>de trading', sub: 'Clases, en vivos, tu journal y un ranking con premios. Todo en un solo lugar.',
    body: icon('i-nuevo.png', 52) + h2('Lo nuevo que vas a encontrar') +
      bl([b('Progreso semanal:') + ' una barra por día que se llena cuando entras, operas, anotas tu trade y ves una clase.',
        b('Journal automático:') + ' conecta tu cuenta de Exness o Funding Pips y tus trades se anotan solos.',
        b('En vivo dentro de la plataforma:') + ' entras a los directos sin buscar ningún link.',
        b('Avisos:') + ' te recordamos tus clases, tus 1-1 y las noticias fuertes del mercado.']) + hr + premios + p('Entra hoy y empieza a sumar.', true),
    cta: 'Entrar a la plataforma', url: SITE + '/app', note: 'Al entrar, un tutorial corto te muestra dónde está todo.',
    foot: 'Recibes este correo porque tienes una cuenta en Mr Katana FX. Si no quieres recibir novedades, toca Darme de baja.' });
}

module.exports = { page, launch, p, bl, box, h2, b, hl, esc, SITE };
