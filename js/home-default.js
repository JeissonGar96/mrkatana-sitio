// Contenido por defecto de la página de inicio (index.html).
// El admin lo cambia en Admin > Página de inicio (app.html); lo guardado allí
// se mezcla encima de esto (site_settings fila id=2, leído por /api/site-home).
var HOME_DEFAULT = {
  whatsapp: '593995014247',
  wa_text: 'Hola Jeisson, quiero información sobre la mentoría',
  order: ['hero', 'stats', 'oferta', 'video', 'metodo', 'resultados', 'sobre', 'faq', 'cierre'],
  off: ['video', 'resultados'],
  hero: { eyebrow: 'Trading institucional en oro', title: 'Opera como los grandes.', gold: 'Con precisión.', text: 'El método, las sesiones en vivo y el acompañamiento para llevarte a tu primera cuenta fondeada.', note: 'Entra gratis y mira la plataforma por dentro.', img: '/img/plataforma.jpg' },
  stats: { items: [ { v: '6+', l: 'Años en los mercados' }, { v: '45 días', l: 'Meta para fondearte' }, { v: 'Diario', l: 'Sesiones en vivo' }, { v: '1:1', l: 'Mentoría personal' } ] },
  oferta: { eyebrow: 'La formación', title: 'Todo lo que necesitas,', gold: 'en un solo lugar.', text: 'Una plataforma propia, pensada para que aprendas, practiques y operes acompañado desde el primer día.',
    items: [
      { t: 'Sesiones en vivo cada día', d: 'Analizamos el mercado en tiempo real y ves cómo se toma cada decisión, sin retrasos, dentro de la plataforma.' },
      { t: 'El método grabado', d: 'Clases paso a paso, de las bases hasta el challenge.' },
      { t: 'Reuniones 1-1', d: 'Revisamos tu operativa, solo tú y yo.' },
      { t: 'Ruta de fondeo', d: 'Un plan semana a semana para pasar tu challenge.', big: '45' },
      { t: 'Herramientas', d: 'Calendario económico, journal e indicadores propios.' },
      { t: 'Comunidad privada', d: 'Traders que operan lo mismo que tú, cada día.' }
    ] },
  video: { eyebrow: 'Presentación', title: 'Conoce el método', gold: 'en 3 minutos.', text: '', url: '' },
  metodo: { eyebrow: 'El método', title: 'Seis meses.', gold: 'Un camino claro.', text: 'Sin estrategias sueltas de internet. Cada etapa tiene un objetivo y sabes en todo momento dónde estás.',
    steps: [
      { w: 'Semanas 1 a 4', t: 'Bases institucionales', d: 'Entiendes cómo piensan bancos y fondos, y aplicas tus primeros setups con reglas claras.', goal: '' },
      { w: 'Días 30 a 45', t: 'Challenge de fondeo', d: 'Con tu sistema afinado, presentas el reto de una firma fondeadora.', goal: 'Meta: tu cuenta fondeada' },
      { w: 'Meses 2 a 4', t: 'Consistencia', d: 'Operas con capital de la firma y construyes consistencia con gestión de riesgo real.', goal: '' },
      { w: 'Meses 5 y 6', t: 'Primeros retiros', d: 'Haces tus primeros retiros de la cuenta fondeada.', goal: 'Meta: $1,000 a $3,000' }
    ] },
  resultados: { eyebrow: 'Resultados', title: 'Alumnos que ya', gold: 'están operando.', text: 'Capturas reales de cuentas fondeadas y retiros de alumnos.', items: [] },
  sobre: { eyebrow: 'Sobre mí', title: 'La katana no golpea.', gold: 'Corta con precisión.', firma: 'Mr. Katana', img: '/img/jeisson.webp',
    p1: 'Soy Jeisson García, trader de oro con enfoque institucional. Mi camino me llevó a entender cómo se mueven los grandes: bancos, fondos y market makers.',
    p2: 'Hoy mi misión es acortar tu curva de aprendizaje con un método claro y acompañamiento real. Así opero, y así enseño.',
    facts: [ { v: '6+ años', l: 'Operando' }, { v: 'XAUUSD', l: 'Oro' }, { v: 'Ecuador', l: 'Desde' } ] },
  faq: { eyebrow: 'Preguntas', title: 'Preguntas', gold: 'frecuentes.', text: '¿Tienes otra duda? Escríbeme y lo vemos en una llamada.',
    items: [
      { q: '¿Necesito experiencia previa?', a: 'No. Empezamos desde las bases y avanzamos paso a paso hasta el challenge de fondeo.' },
      { q: '¿Qué incluye la cuenta gratis?', a: 'Entras a la plataforma, ves cómo está hecha por dentro y usas las herramientas gratuitas. Las clases, las sesiones en vivo y las reuniones 1-1 son para alumnos.' },
      { q: '¿Cuánto tiempo necesito al día?', a: 'Con una a dos horas al día puedes seguir las clases y las sesiones en vivo.' },
      { q: '¿Qué pasa si no puedo entrar a una sesión en vivo?', a: 'Las clases quedan grabadas en la plataforma para que las veas cuando quieras.' },
      { q: '¿Cómo empiezo la mentoría?', a: 'Escríbeme por WhatsApp. Agendamos una llamada, vemos tu caso y te explico cómo funciona.' }
    ] },
  cierre: { title: 'El mercado no espera.', gold: '¿Y tú?', text: 'Crea tu cuenta gratis y mira todo por dentro, o escríbeme y agendamos una llamada.' }
};
