'use strict';

/*
 * photos.js — fotos REALES de camisetas de clubes, buscadas en internet (nunca dibujadas por el bot).
 *
 * Fuentes (en este orden, todas con crédito al autor):
 *   · Wikimedia Commons  (gratis, sin clave, fotos con licencia libre)
 *   · Openverse          (gratis, sin clave, fotos con licencia libre de Flickr/Wikimedia)
 *   · Serper             (opcional: SERPER_API_KEY, Google Imágenes por API, 2.500 búsquedas gratis al registrarse) ← la que más fotos de camisetas tiene
 *   · Google Imágenes    (opcional: GOOGLE_API_KEY y GOOGLE_CX, 100 búsquedas gratis al día)
 *
 * El año sale del TÍTULO de la foto («Real Madrid home shirt 2002-03»); si el título no trae un año claro,
 * la foto se descarta para no inventar la respuesta. Se descartan escudos, plantillas dibujadas, estadios, etc.
 */

const UA = 'CentinelaBot/1.0 (https://github.com/riescorodrigoriesco-afk/Centinela-bot; Discord game bot)';
const MAX_BYTES = 7 * 1024 * 1024;

// [nombre, [alias para aceptar la respuesta], término de búsqueda]
const CLUBS = [
  ['Manchester United', ['man utd', 'man united', 'manchester utd', 'mufc'], 'Manchester United'],
  ['Liverpool', ['liverpool fc', 'lfc'], 'Liverpool FC'],
  ['Arsenal', ['arsenal fc', 'gunners'], 'Arsenal FC'],
  ['Chelsea', ['chelsea fc'], 'Chelsea FC'],
  ['Manchester City', ['man city', 'mcfc'], 'Manchester City'],
  ['Tottenham Hotspur', ['tottenham', 'spurs'], 'Tottenham Hotspur'],
  ['Newcastle United', ['newcastle', 'newcastle utd'], 'Newcastle United'],
  ['Leeds United', ['leeds', 'leeds utd'], 'Leeds United', ['rhinos', 'rugby', 'carnegie']],
  ['Everton', ['everton fc'], 'Everton FC'],
  ['Aston Villa', ['villa'], 'Aston Villa', ['villarreal']],
  ['West Ham United', ['west ham', 'west ham utd'], 'West Ham United'],
  ['Real Madrid', ['madrid', 'real madrid cf', 'rm'], 'Real Madrid', ['atletico', 'atleti']],
  ['FC Barcelona', ['barcelona', 'barca', 'fcb', 'fc barca'], 'FC Barcelona'],
  ['Atlético de Madrid', ['atletico', 'atletico madrid', 'atleti', 'atletico de madrid'], 'Atlético de Madrid', ['real']],
  ['Valencia', ['valencia cf'], 'Valencia CF'],
  ['Sevilla', ['sevilla fc'], 'Sevilla FC'],
  ['Athletic Club', ['athletic bilbao', 'athletic de bilbao', 'athletic'], 'Athletic Bilbao', ['oldham', 'charlton', 'wigan', 'dunfermline', 'hamilton', 'atletico']],
  ['Real Betis', ['betis'], 'Real Betis'],
  ['Real Sociedad', ['sociedad'], 'Real Sociedad'],
  ['Deportivo de La Coruña', ['deportivo', 'depor', 'deportivo la coruna'], 'Deportivo de La Coruña'],
  ['Villarreal', ['villarreal cf'], 'Villarreal CF'],
  ['Juventus', ['juve', 'juventus fc'], 'Juventus'],
  ['AC Milan', ['milan', 'ac milan'], 'AC Milan', ['inter']],
  ['Inter de Milán', ['inter', 'inter milan', 'internazionale', 'inter de milan', 'fc internazionale'], 'Inter Milan', ['acmilan', 'internacional', 'international', 'miami']],
  ['AS Roma', ['roma'], 'AS Roma'],
  ['Napoli', ['ssc napoli', 'nápoles', 'napoles'], 'SSC Napoli'],
  ['Lazio', ['ss lazio'], 'SS Lazio'],
  ['Fiorentina', ['acf fiorentina'], 'Fiorentina'],
  ['Parma', ['parma calcio'], 'Parma Calcio'],
  ['Bayern de Múnich', ['bayern', 'bayern munich', 'bayern munchen', 'fc bayern', 'bayern de munich'], 'Bayern Munich'],
  ['Borussia Dortmund', ['dortmund', 'bvb'], 'Borussia Dortmund'],
  ['Bayer Leverkusen', ['leverkusen'], 'Bayer Leverkusen'],
  ['Schalke 04', ['schalke'], 'Schalke 04'],
  ['Werder Bremen', ['werder', 'bremen'], 'Werder Bremen'],
  ['Paris Saint-Germain', ['psg', 'paris', 'paris sg', 'paris saint germain'], 'Paris Saint-Germain'],
  ['Olympique de Marsella', ['marseille', 'marsella', 'om', 'olympique marseille', 'olympique de marseille'], 'Olympique de Marseille'],
  ['Olympique de Lyon', ['lyon', 'olympique lyonnais', 'ol', 'olympique lyon'], 'Olympique Lyonnais'],
  ['AS Monaco', ['monaco'], 'AS Monaco'],
  ['Ajax', ['ajax amsterdam', 'afc ajax'], 'AFC Ajax', ['cape town', 'capetown', 'lasnamae']],
  ['PSV Eindhoven', ['psv'], 'PSV Eindhoven'],
  ['Benfica', ['sl benfica'], 'SL Benfica'],
  ['FC Porto', ['porto'], 'FC Porto', ['alegre']],
  ['Sporting CP', ['sporting', 'sporting lisboa', 'sporting de portugal', 'sporting lisbon'], 'Sporting CP', ['kansas', 'gijon', 'braga', 'charleroi']],
  ['Celtic', ['celtic fc'], 'Celtic FC'],
  ['Rangers', ['rangers fc', 'glasgow rangers'], 'Rangers FC', ['texas', 'new york', 'nyrangers', 'queens park', 'qpr', 'baseball', 'hockey']],
  ['Galatasaray', ['galatasaray sk'], 'Galatasaray'],
  ['Boca Juniors', ['boca'], 'Boca Juniors'],
  ['River Plate', ['river', 'river plate'], 'River Plate'],
  ['Flamengo', ['cr flamengo'], 'Flamengo'],
  ['Santos', ['santos fc'], 'Santos FC', ['laguna', 'dumont']],
  ['Corinthians', ['sc corinthians'], 'Corinthians'],
  ['São Paulo', ['sao paulo', 'sao paulo fc'], 'São Paulo FC'],
  ['Palmeiras', ['se palmeiras'], 'Palmeiras'],
  ['Peñarol', ['penarol'], 'Peñarol'],
  ['Club América', ['america', 'club america'], 'Club América'],
].map(([name, aliases, q, x]) => ({ name, aliases, q, x: x || [] }));

/* ---------- utilidades ---------- */
const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const flat = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const strip = (h) => String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const clean = (title) => String(title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]{3,4}$/i, '').replace(/_/g, ' ');

const SHIRT = /(shirt|jersey|camiseta|camisa|maillot|trikot|maglia|equipaci|kit\b|trøje|tr[oö]ja|koszulka|shirts|jerseys)/i;
const BAD = /(logo|crest|badge|escudo|emblem|sticker|wappen|template|kit[ _]?(body|left|right|shorts|socks|sleeve|collar)|stadium|estadio|stadion|\bfans?\b|supporters|ultras|scarf|bufanda|flag\b|bandera|poster|ticket|banner|trophy|copa\b|statue|mural|\bvs\b|\bv\b|\bgame\b)/i;

function matcher(club) {
  const names = [club.name, ...club.aliases, club.q].map(flat).filter(Boolean);
  const long = [...new Set(names.filter((n) => n.replace(/ /g, '').length >= 5))];
  const shortRes = [...new Set(names.filter((n) => n.replace(/ /g, '').length < 5))].map((n) => new RegExp('(^| )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)'));
  return (title) => {
    const t = flat(title);
    return long.some((n) => t.includes(n)) || shortRes.some((re) => re.test(t));
  };
}
for (const c of CLUBS) c.has = matcher(c);

// «2002-03» → { year: 2002, year2: 2003, label: '2002/03' } · «2004» → { year: 2004, year2: 2004, label: '2004' }
function parseSeason(text) {
  const s = String(text || '');
  let m = s.match(/(?<![0-9])((?:19[89]\d|20[0-3]\d))\s*[-–\/_]\s*((?:19|20)?\d{2})(?![0-9])/);
  if (m) {
    const y = +m[1];
    let e = m[2].length === 2 ? Math.floor(y / 100) * 100 + (+m[2]) : +m[2];
    if (e < y) e += 100;
    if (e - y > 1) return null; // un rango largo no es una temporada
    return { year: y, year2: e, label: e === y ? String(y) : y + '/' + String(e).slice(2) };
  }
  m = s.match(/(?<![0-9])((?:19[89]\d|20[0-3]\d))(?![0-9])/);
  return m ? { year: +m[1], year2: +m[1], label: m[1] } : null;
}

// ¿Esta foto sirve para el juego? Devuelve { year, year2, label } o null
function accept(club, title) {
  const t = clean(title);
  if (!SHIRT.test(t) || BAD.test(t)) return null;
  if (!club.has(t)) return null;
  const nt = norm(t);
  if ((club.x || []).some((x) => nt.includes(norm(x)))) return null; // es de otro club con nombre parecido
  return parseSeason(t);
}

/* ---------- red ---------- */
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

const off = { serper: 0, commons: 0, openverse: 0, google: 0 }; // proveedor apagado hasta (ms)
const st = { serper: { n: 0, err: '' }, commons: { n: 0, err: '' }, openverse: { n: 0, err: '' }, google: { n: 0, err: '' } };

async function commonsSearch(q, offset) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: '50', gsroffset: String(offset || 0),
    prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '900', iiextmetadatafilter: 'Artist|LicenseShortName', iiextmetadatalanguage: 'en',
  });
  const j = await getJson(u);
  const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
  return pages.map((p) => {
    const ii = (p.imageinfo || [])[0];
    if (!ii || !/^image\/(jpeg|png|webp)/i.test(ii.mime || '')) return null;
    const md = ii.extmetadata || {};
    return {
      title: p.title, url: ii.thumburl || ii.url, page: ii.descriptionurl,
      author: strip(md.Artist && md.Artist.value).slice(0, 60), license: strip(md.LicenseShortName && md.LicenseShortName.value).slice(0, 30), source: 'commons',
    };
  }).filter(Boolean);
}

async function fromOpenverse(club, page) {
  const u = 'https://api.openverse.org/v1/images/?' + new URLSearchParams({ q: club.q + ' shirt', page_size: '30', page: String((page || 0) + 1), mature: 'false' });
  const j = await getJson(u);
  return (j.results || []).map((x) => ({
    title: x.title || '', url: x.url, thumb: x.thumbnail, page: x.foreign_landing_url,
    author: String(x.creator || '').slice(0, 60), license: String((x.license || '') + ' ' + (x.license_version || '')).toUpperCase().trim().slice(0, 30), source: 'openverse',
  })).filter((x) => x.url);
}

async function fromGoogle(club, page) {
  const key = process.env.GOOGLE_API_KEY, cx = process.env.GOOGLE_CX;
  if (!key || !cx) return [];
  const u = 'https://www.googleapis.com/customsearch/v1?' + new URLSearchParams({ key, cx, q: club.q + ' ' + randSeason() + ' shirt', searchType: 'image', num: '10', start: '1', safe: 'active', imgSize: 'large' });
  const j = await getJson(u);
  return (j.items || []).map((x) => {
    let host = '';
    try { host = new URL(x.image && x.image.contextLink || x.link).hostname.replace(/^www\./, ''); } catch (_) { /* sin dominio */ }
    return { title: x.title || '', url: x.link, thumb: x.image && x.image.thumbnailLink, page: x.image && x.image.contextLink, author: host, license: '', source: 'google' };
  }).filter((x) => x.url);
}

const fromCommons = (club, offset) => commonsSearch(club.q + ' shirt', offset);

// Temporada al azar para variar los años: «2002-03»
const randSeason = () => { const y = 1992 + Math.floor(Math.random() * 32); return y + '-' + String(y + 1).slice(2); };

async function fromSerper(club) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  const r = await fetch('https://google.serper.dev/images', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ q: club.q + ' ' + randSeason() + ' home shirt', num: 30 }), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  return (j.images || []).map((x) => ({ title: x.title || '', url: x.imageUrl, thumb: x.thumbnailUrl, page: x.link, author: x.domain || x.source || '', license: '', source: 'serper' })).filter((x) => x.url);
}

const PROVIDERS = [['serper', fromSerper], ['commons', fromCommons], ['openverse', fromOpenverse], ['google', fromGoogle]];

/* ---------- reserva de fotos ---------- */
const pool = []; // { key, club, year, year2, label, url, thumb, page, author, license, source, title }
const fetched = new Map(); // club.name -> veces que se ha pedido (para variar de página)
let warming = null;

async function fetchClub(club) {
  const n = fetched.get(club.name) || 0;
  fetched.set(club.name, n + 1);
  let added = 0;
  for (const [name, fn] of PROVIDERS) {
    if (Date.now() < off[name]) continue;
    try {
      const items = await fn(club, n);
      if (n === 0) console.log('[camisas] fotos: ' + name + ' «' + club.q + '» → ' + items.length + ' resultados, válidos ' + items.filter((it) => accept(club, it.title)).length + (items.length ? ' · ej: ' + items.slice(0, 3).map((it) => clean(it.title).slice(0, 60)).join(' | ') : ''));
      for (const it of items) {
        const s = accept(club, it.title);
        if (!s) continue;
        const key = name + ':' + it.url;
        if (pool.some((p) => p.key === key)) continue;
        pool.push({ key, club, year: s.year, year2: s.year2, label: s.label, ...it });
        st[name].n++;
        added++;
      }
      st[name].err = '';
    } catch (e) {
      st[name].err = e.message;
      if (e.status === 401 || e.status === 403) off[name] = Infinity; // pide registro o clave: no se vuelve a intentar
      else if (e.status === 429) off[name] = Date.now() + 3600000;
      else off[name] = Date.now() + 60000;
      console.log('[camisas] fotos: ' + name + ' falló (' + e.message + ')');
    }
  }
  return added;
}

// Rellena la reserva con algunos clubes elegidos al azar (con tope de tiempo)
function warm(count, budgetMs) {
  if (warming) return warming;
  warming = (async () => {
    const t0 = Date.now();
    const order = [...CLUBS].sort((a, b) => (fetched.get(a.name) || 0) - (fetched.get(b.name) || 0) || Math.random() - 0.5);
    for (const club of order.slice(0, count)) {
      if (budgetMs && Date.now() - t0 > budgetMs) break;
      await fetchClub(club);
      await new Promise((r) => setTimeout(r, 250));
    }
  })().finally(() => { warming = null; });
  return warming;
}

async function download(it) {
  for (const u of [it.url, it.thumb].filter(Boolean)) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (!/^image\/(jpeg|png|webp)/i.test(ct)) continue;
      if ((+r.headers.get('content-length') || 0) > MAX_BYTES) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES || buf.length < 4000) continue;
      return { buf, ext: /png/i.test(ct) ? 'png' : /webp/i.test(ct) ? 'webp' : 'jpg' };
    } catch (_) { /* prueba con la siguiente dirección */ }
  }
  return null;
}

const used = new Map(); // servidor -> claves ya usadas

// Devuelve una camiseta real lista para enviar, o null si no hay ahora mismo
async function pick(gid) {
  if (pool.length < 6) await warm(4, 9000).catch(() => {});
  else if (pool.length < 40) warm(2, 6000).catch(() => {});
  const seen = used.get(gid) || new Set();
  used.set(gid, seen);
  for (let tries = 0; tries < 6; tries++) {
    let cands = pool.filter((x) => !seen.has(x.key));
    if (!cands.length) { seen.clear(); cands = pool.slice(); }
    if (!cands.length) return null;
    const clubs = [...new Set(cands.map((x) => x.club))];
    const club = clubs[Math.floor(Math.random() * clubs.length)];
    const own = cands.filter((x) => x.club === club);
    const it = own[Math.floor(Math.random() * own.length)];
    seen.add(it.key);
    const img = await download(it);
    if (!img) { const i = pool.indexOf(it); if (i >= 0) pool.splice(i, 1); continue; }
    const who = it.author ? it.author : 'autor desconocido';
    return {
      team: it.club.name, aliases: [it.club.name, ...it.club.aliases, it.club.q], not: it.club.x, year: it.year, year2: it.year2, season: it.label,
      png: img.buf, name: 'camiseta.' + img.ext,
      credit: { text: who + (it.license ? ' · ' + it.license : '') + ' · ' + it.source, url: it.page || it.url },
    };
  }
  return null;
}

const stats = () => ({ pool: pool.length, clubs: new Set(pool.map((p) => p.club.name)).size, providers: { serper: { ...st.serper, enabled: !!process.env.SERPER_API_KEY }, commons: st.commons, openverse: st.openverse, google: { ...st.google, enabled: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX) } } });

// Sonda de diagnóstico: qué devuelve Commons con distintas búsquedas
async function probe() {
  const qs = ['Real Madrid shirt', 'Real Madrid jersey', 'Real Madrid camiseta', 'FC Barcelona jersey filetype:bitmap', 'football shirt 2002', 'camiseta fútbol 1998', 'Manchester United shirt 1999'];
  for (const q of qs) {
    try {
      const items = await commonsSearch(q, 0);
      console.log('[camisas] sonda «' + q + '» → ' + items.length + ' · ' + items.slice(0, 5).map((it) => clean(it.title).slice(0, 55)).join(' | '));
    } catch (e) { console.log('[camisas] sonda «' + q + '» falló: ' + e.message); }
  }
}

async function catProbe() {
  for (const c of ['Association football shirts', 'Football shirts', 'Football jerseys', 'Association football jerseys', 'Football kits', 'Camisetas de fútbol']) {
    const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', list: 'categorymembers', cmtitle: 'Category:' + c, cmlimit: '30', cmtype: 'file|subcat' });
    try {
      const j = await getJson(u);
      const m = (j.query && j.query.categorymembers) || [];
      console.log('[camisas] sonda categoría «' + c + '» → ' + m.length + ' · ' + m.slice(0, 8).map((x) => clean(x.title).slice(0, 40)).join(' | '));
    } catch (e) { console.log('[camisas] sonda categoría «' + c + '» falló: ' + e.message); }
  }
}

// Al arrancar: prueba las fuentes y deja el resultado en los logs
async function selfTest() {
  const t0 = Date.now();
  await catProbe();
  try {
    await warm(5, 25000);
  } catch (e) { console.log('[camisas] autoprueba de fotos falló: ' + e.message); }
  const s = stats();
  console.log('[camisas] fotos reales: reserva=' + s.pool + ' clubes=' + s.clubs + ' | commons=' + s.providers.commons.n + (s.providers.commons.err ? '(' + s.providers.commons.err + ')' : '') + ' openverse=' + s.providers.openverse.n + (s.providers.openverse.err ? '(' + s.providers.openverse.err + ')' : '') + ' google=' + (s.providers.google.enabled ? s.providers.google.n : 'sin clave') + ' serper=' + (s.providers.serper.enabled ? s.providers.serper.n + (s.providers.serper.err ? '(' + s.providers.serper.err + ')' : '') : 'sin clave') + ' | ' + (Date.now() - t0) + ' ms');
  for (const p of pool.slice(0, 5)) console.log('[camisas]   · ' + p.club.name + ' ' + p.label + ' ← «' + clean(p.title).slice(0, 80) + '» (' + p.source + ')');
}

module.exports = { CLUBS, pick, warm, stats, selfTest, parseSeason, accept, norm };
