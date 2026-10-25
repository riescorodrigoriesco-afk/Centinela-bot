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
  ['Liverpool', ['liverpool fc', 'lfc'], 'Liverpool FC', ['montevideo', 'uruguay', 'ecuador', 'quito']],
  ['Arsenal', ['arsenal fc', 'gunners'], 'Arsenal FC', ['tula', 'sarandi', 'kyiv', 'kiev', 'crewe']],
  ['Chelsea', ['chelsea fc'], 'Chelsea FC'],
  ['Manchester City', ['man city', 'mcfc'], 'Manchester City'],
  ['Tottenham Hotspur', ['tottenham', 'spurs'], 'Tottenham Hotspur'],
  ['Newcastle United', ['newcastle', 'newcastle utd'], 'Newcastle United', ['jets', 'falcons', 'knights', 'rugby']],
  ['Leeds United', ['leeds', 'leeds utd'], 'Leeds United', ['rhinos', 'rugby', 'carnegie']],
  ['Everton', ['everton fc'], 'Everton FC', ['vina', 'chile', 'del mar']],
  ['Aston Villa', ['villa'], 'Aston Villa', ['villarreal']],
  ['West Ham United', ['west ham', 'west ham utd'], 'West Ham United'],
  ['Real Madrid', ['madrid', 'real madrid cf', 'rm'], 'Real Madrid', ['atletico', 'atleti']],
  ['FC Barcelona', ['barcelona', 'barca', 'fcb', 'fc barca'], 'FC Barcelona', ['guayaquil', 'ecuador', 'sporting club', 'bsc']],
  ['Atlético de Madrid', ['atletico', 'atletico madrid', 'atleti', 'atletico de madrid'], 'Atlético de Madrid', ['real']],
  ['Valencia', ['valencia cf'], 'Valencia CF', ['venezuela', 'torque', 'caracas']],
  ['Sevilla', ['sevilla fc'], 'Sevilla FC', ['atletico', 'fc 2']],
  ['Athletic Club', ['athletic bilbao', 'athletic de bilbao', 'athletic'], 'Athletic Bilbao', ['oldham', 'charlton', 'wigan', 'dunfermline', 'hamilton', 'atletico', 'havre', 'academical']],
  ['Real Betis', ['betis'], 'Real Betis'],
  ['Real Sociedad', ['sociedad'], 'Real Sociedad'],
  ['Deportivo de La Coruña', ['deportivo', 'depor', 'deportivo la coruna'], 'Deportivo de La Coruña'],
  ['Villarreal', ['villarreal cf'], 'Villarreal CF'],
  ['Juventus', ['juve', 'juventus fc'], 'Juventus'],
  ['AC Milan', ['milan', 'ac milan'], 'AC Milan', ['inter']],
  ['Inter de Milán', ['inter', 'inter milan', 'internazionale', 'inter de milan', 'fc internazionale'], 'Inter Milan', ['acmilan', 'internacional', 'international', 'miami']],
  ['AS Roma', ['roma'], 'AS Roma'],
  ['Napoli', ['ssc napoli', 'nápoles', 'napoles'], 'SSC Napoli', ['basket']],
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
  ['Celtic', ['celtic fc'], 'Celtic FC', ['boston', 'celtics', 'basket']],
  ['Rangers', ['rangers fc', 'glasgow rangers'], 'Rangers FC', ['texas', 'new york', 'nyrangers', 'queens park', 'qpr', 'baseball', 'hockey', 'deportes', 'talca', 'chile', 'tigres', 'paraguay']],
  ['Galatasaray', ['galatasaray sk'], 'Galatasaray'],
  ['Boca Juniors', ['boca'], 'Boca Juniors', ['unidos', 'raton']],
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
// Palabras que indican que la foto ES de una camiseta (local, visitante, alternativa…) y no de un jugador con ella puesta
const KIT = /\b(home|away|third|local|visitante|visitor|alternat\w*|alternativ\w*|titular|suplente|primera|segunda|tercera|1st|2nd|3rd|gk|goalkeeper|portero|heim\w*|ausw\w*)\b|shirt|jersey|camiseta|camisa|maillot|trikot|maglia|equipaci|kit\b/i;
// Títulos típicos de fotos de jugadores o partidos
const PERSON = /(\bof\b|free kick|bundesarchiv|\(\d{6,}\)|dsc[_ ]?\d|img[_ ]?\d|\bvs\b|goal\b|celebrat|training|match\b|final\b|scores?\b|tackle|header|penalty|\bwith\b|wearing|ambassador|president|minister|mayor|visit|meeting|signing|presents?\b|receives?\b|holding)/i;
const BAD = /(logo|crest|badge|escudo|emblem|sticker|wappen|template|kit[ _]?(body|left|right|shorts|socks|sleeve|collar)|stadium|estadio|stadion|\bfans?\b|supporters|ultras|scarf|bufanda|flag\b|bandera|poster|ticket|banner|trophy|copa\b|statue|mural|\bvs\b|\bv\b|\bgame\b)/i;

// Nombres sueltos que valen para ACERTAR pero no para reconocer el club de una foto («Liga Deportiva», «Villa Dálmine», «Sporting Cristal»…)
const NO_DETECT = new Set(['deportivo', 'depor', 'sporting', 'america', 'villa', 'river', 'inter', 'athletic', 'paris', 'sociedad', 'bremen']);
function matcher(club) {
  const names = [...new Set([club.name, ...club.aliases, club.q].map(flat).filter((n) => n.replace(/ /g, '').length >= 3 && !NO_DETECT.has(n)))];
  const res = names.map((n) => new RegExp('(^| )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)'));
  return (title) => { const t = flat(title); return res.some((re) => re.test(t)); };
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
function accept(club, title, desc) {
  const t = clean(title);
  const d = String(desc || '');
  if (BAD.test(t)) return null;
  if (!(KIT.test(t) || SHIRT.test(d))) return null; // tiene que ser una camiseta
  if (PERSON.test(t) && !SHIRT.test(t)) return null; // foto de un jugador o de un partido
  if (!club.has(t) && !(d && club.has(d))) return null;
  const nt = norm(t);
  if ((club.x || []).some((x) => nt.includes(norm(x)))) return null; // es de otro club con nombre parecido
  return parseSeason(t) || parseSeason(d);
}

/* ---------- red ---------- */
async function getJson(url, patient) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(patient ? 20000 : 9000) });
    if ((r.status === 429 || r.status === 503) && patient && attempt < 5) {
      const wait = Math.min(45, parseInt(r.headers.get('retry-after'), 10) || 8 * (attempt + 1));
      console.log('[camisas] Commons pide esperar (' + r.status + '): ' + wait + ' s');
      await new Promise((res) => setTimeout(res, wait * 1000));
      continue;
    }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
}

const off = { serper: 0, commons: 0, openverse: 0, google: 0 }; // proveedor apagado hasta (ms)
const st = { serper: { n: 0, err: '' }, commons: { n: 0, err: '' }, openverse: { n: 0, err: '' }, google: { n: 0, err: '' } };

async function commonsSearch(q, offset) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: '50', gsroffset: String(offset || 0),
    prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '900', iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription', iiextmetadatalanguage: 'en',
  });
  const j = await getJson(u);
  const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
  return pages.map((p) => {
    const ii = (p.imageinfo || [])[0];
    if (!ii || !/^image\/(jpeg|png|webp)/i.test(ii.mime || '')) return null;
    const md = ii.extmetadata || {};
    if (ii.width && ii.width < 450) return null; // demasiado pequeña
    return {
      title: p.title, url: ii.thumburl || ii.url, page: ii.descriptionurl, desc: strip(md.ImageDescription && md.ImageDescription.value).slice(0, 300),
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

const CAT_ROOTS = ['Association football jerseys', 'Football jerseys', 'Football shirts', 'Association football shirts'];
async function fromCommons(club, offset) {
  for (const root of CAT_ROOTS) {
    const items = await commonsSearch('deepcat:"' + root + '" ' + club.q, offset);
    if (items.length) return items;
  }
  return [];
}

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
let dryUntil = 0; // si la última búsqueda no trajo nada, no se vuelve a buscar hasta entonces

async function fetchClub(club) {
  const n = fetched.get(club.name) || 0;
  fetched.set(club.name, n + 1);
  let added = 0;
  for (const [name, fn] of PROVIDERS) {
    if (Date.now() < off[name]) continue;
    try {
      const items = await fn(club, n);
      if (n === 0) console.log('[camisas] fotos: ' + name + ' «' + club.q + '» → ' + items.length + ' resultados, válidos ' + items.filter((it) => accept(club, it.title, it.desc)).length + (items.length ? ' · ej: ' + items.slice(0, 3).map((it) => clean(it.title).slice(0, 60)).join(' | ') : ''));
      for (const it of items) {
        const s = accept(club, it.title, it.desc);
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
    const before = pool.length;
    const order = [...CLUBS].sort((a, b) => (fetched.get(a.name) || 0) - (fetched.get(b.name) || 0) || Math.random() - 0.5);
    for (const club of order.slice(0, count)) {
      if (budgetMs && Date.now() - t0 > budgetMs) break;
      await fetchClub(club);
      await new Promise((r) => setTimeout(r, budgetMs > 60000 ? 900 : 250));
    }
    dryUntil = pool.length === before ? Date.now() + 600000 : 0;
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
  if (!pool.length && crawling) await Promise.race([crawling, sleep(20000)]);
  if (!pool.length && !crawled) await Promise.race([startCrawl(), sleep(20000)]);
  if (!pool.length && Date.now() < dryUntil) return null; // las fuentes no tienen nada ahora mismo: no hacer esperar
  if (pool.length < 6) await warm(4, 9000).catch(() => {});
  else if (pool.length < 40 && Date.now() >= dryUntil) warm(2, 6000).catch(() => {});
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

/* ---------- rastreo de las categorías de camisetas de Commons ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let crawling = null;
let crawled = false;

async function catPage(cat, type, cont) {
  const q = { action: 'query', format: 'json', list: 'categorymembers', cmtitle: 'Category:' + cat, cmtype: type, cmlimit: '500' };
  if (cont) q.cmcontinue = cont;
  const j = await getJson('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams(q), true);
  return { items: (j.query && j.query.categorymembers) || [], next: j.continue && j.continue.cmcontinue };
}

const DYN = new Map();
// Club sacado de una categoría de Commons como «River Plate team jerseys (adidas)» dentro de «… by team»
function dynClub(path) {
  if (!path.some((x) => /\bby (team|club)\b/i.test(x))) return null;
  const last = path[path.length - 1];
  if (/\bby\b|national|schemes|template|supporters|fans|brand|colou?r|player|season|decade/i.test(last)) return null;
  const name = last.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\b(association football|football|soccer|team|club)\b/ig, ' ').replace(/\b(jerseys?|shirts?|kits?|uniforms?)\b.*$/i, '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || /^\d+$/.test(name) || !/jersey|shirt|kit|uniform/i.test(last)) return null;
  if (!DYN.has(name)) DYN.set(name, { name, aliases: [], q: name, x: [], has: () => true, dyn: true });
  return DYN.get(name);
}

const clubOf = (text) => {
  const t = flat(text);
  return CLUBS.find((c) => c.has(t) && !c.x.some((x) => norm(t).includes(norm(x)))) || null;
};

async function crawl(budgetMs) {
  const t0 = Date.now();
  const seenCat = new Set();
  const queue = CAT_ROOTS.map((c) => ({ cat: c, path: [c], d: 0 }));
  const files = new Map(); // título -> ruta de categorías
  const tree = [];
  let cats = 0;
  while (queue.length && cats < 320 && Date.now() - t0 < budgetMs && files.size < 8000) {
    const { cat, path, d } = queue.shift();
    if (seenCat.has(cat)) continue;
    seenCat.add(cat);
    cats++;
    try {
      let cont;
      let nf = 0;
      for (let pg = 0; pg < 3; pg++) {
        const r = await catPage(cat, 'file', cont);
        for (const f of r.items) if (!files.has(f.title)) { files.set(f.title, path); nf++; }
        cont = r.next;
        if (!cont) break;
        await sleep(450);
      }
      let ns = 0;
      if (d < 4) {
        const r = await catPage(cat, 'subcat');
        for (const sc of r.items) {
          const name = sc.title.replace(/^Category:/, '');
          const node = { cat: name, path: [...path, name], d: d + 1 };
          if (clubOf(name) || /\bby (team|club)\b/i.test(name) || path.some((x) => /\bby (team|club)\b/i.test(x))) queue.unshift(node); else queue.push(node);
          ns++;
        }
      }
      if (tree.length < 40) tree.push(cat + ' (' + nf + ' fotos, ' + ns + ' subcat.)');
    } catch (e) {
      console.log('[camisas] rastreo «' + cat + '» falló: ' + e.message);
      if (e.status === 429) break;
    }
    await sleep(450);
  }
  console.log('[camisas] rastreo: ' + cats + ' categorías, ' + files.size + ' archivos | ' + tree.slice(0, 14).join(' ; '));

  // Candidatas: club conocido (por título o por categoría) y no dibujos/escudos
  const cand = [];
  const noClub = [];
  for (const [title, path] of files) {
    if (!/\.(jpe?g|png|webp)$/i.test(title)) continue;
    const t = clean(title);
    if (BAD.test(t)) continue;
    let club = clubOf(t);
    if (!club) for (const pc of [...path].reverse()) { club = clubOf(pc); if (club) break; }
    if (!club) club = dynClub(path);
    if (!club) { if (noClub.length < 8) noClub.push(t.slice(0, 50)); continue; }
    cand.push({ title, club, ys: parseSeason(t) ? 1 : 0 });
  }
  cand.sort((a, b) => b.ys - a.ys);
  console.log('[camisas] rastreo: ' + cand.length + ' (' + cand.filter((x) => x.ys).length + ' con temporada en el título)' + ' candidatas con club conocido · sin club, ej: ' + noClub.join(' | '));

  // Datos de cada candidata (dirección, licencia, descripción) de 40 en 40
  let added = 0;
  const noYear = [];
  const sample = [];
  const tData = Date.now();
  for (let i = 0; i < cand.length && i < 2000 && Date.now() - tData < 240000; i += 40) {
    const batch = cand.slice(i, i + 40);
    try {
      const j = await getJson('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
        action: 'query', format: 'json', titles: batch.map((b) => b.title).join('|'), prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata',
        iiurlwidth: '900', iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription', iiextmetadatalanguage: 'en',
      }), true);
      const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
      for (const pg of pages) {
        const c = batch.find((b) => b.title === pg.title) || batch.find((b) => flat(b.title) === flat(pg.title));
        const ii = (pg.imageinfo || [])[0];
        if (!c || !ii || !/^image\/(jpeg|png|webp)/i.test(ii.mime || '') || (ii.width && ii.width < 450)) continue;
        const md = ii.extmetadata || {};
        const desc = strip(md.ImageDescription && md.ImageDescription.value).slice(0, 300);
        const t = clean(pg.title);
        if (!(KIT.test(t) || SHIRT.test(desc))) continue;
        if (PERSON.test(t) && !SHIRT.test(t)) continue;
        const sn = parseSeason(t) || parseSeason(desc);
        if (!sn) { if (noYear.length < 6) noYear.push(t.slice(0, 50)); continue; }
        const key = 'commons:' + (ii.thumburl || ii.url);
        if (pool.some((x) => x.key === key)) continue;
        pool.push({ key, club: c.club, year: sn.year, year2: sn.year2, label: sn.label, title: pg.title, url: ii.thumburl || ii.url, page: ii.descriptionurl, desc,
          author: strip(md.Artist && md.Artist.value).slice(0, 60), license: strip(md.LicenseShortName && md.LicenseShortName.value).slice(0, 30), source: 'commons' });
        st.commons.n++;
        added++;
        if (sample.length < 8) sample.push(c.club.name + ' ' + sn.label + ' ← ' + t.slice(0, 50));
      }
    } catch (e) {
      console.log('[camisas] rastreo datos falló: ' + e.message);
      if (e.status === 429) break;
    }
    await sleep(600);
  }
  console.log('[camisas] rastreo: ' + added + ' fotos reales añadidas (' + new Set(pool.map((x) => x.club.name)).size + ' clubes) · sin año, ej: ' + noYear.join(' | ') + ' · ej: ' + sample.join(' | ') + ' · ' + (Date.now() - t0) + ' ms');
  return added;
}

async function testDownloads() {
  const sample = pool.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  for (const it of sample) {
    const t0 = Date.now();
    const img = await download(it);
    console.log('[camisas] descarga de prueba ' + it.club.name + ' ' + it.label + ' → ' + (img ? Math.round(img.buf.length / 1024) + ' KB ' + img.ext : 'FALLÓ') + ' · ' + (Date.now() - t0) + ' ms · ' + it.url.slice(0, 90));
  }
}

function startCrawl(budgetMs) {
  if (crawling) return crawling;
  crawling = crawl(budgetMs || 150000).then(() => testDownloads()).catch((e) => console.log('[camisas] rastreo falló: ' + e.message)).finally(() => { crawling = null; crawled = true; });
  // Después, en segundo plano y sin prisa, una búsqueda por cada club para llenar la reserva
  crawling.then(async () => {
    if (pool.length < 6) return;
    const n0 = pool.length;
    await warm(CLUBS.length, 420000).catch((e) => console.log('[camisas] llenado falló: ' + e.message));
    console.log('[camisas] llenado por clubes: reserva ' + n0 + ' → ' + pool.length + ' fotos de ' + new Set(pool.map((x) => x.club.name)).size + ' clubes');
  });
  return crawling;
}

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
  startCrawl(150000); // en segundo plano
  try {
    await warm(3, 15000);
  } catch (e) { console.log('[camisas] autoprueba de fotos falló: ' + e.message); }
  const s = stats();
  console.log('[camisas] fotos reales: reserva=' + s.pool + ' clubes=' + s.clubs + ' | commons=' + s.providers.commons.n + (s.providers.commons.err ? '(' + s.providers.commons.err + ')' : '') + ' openverse=' + s.providers.openverse.n + (s.providers.openverse.err ? '(' + s.providers.openverse.err + ')' : '') + ' google=' + (s.providers.google.enabled ? s.providers.google.n : 'sin clave') + ' serper=' + (s.providers.serper.enabled ? s.providers.serper.n + (s.providers.serper.err ? '(' + s.providers.serper.err + ')' : '') : 'sin clave') + ' | ' + (Date.now() - t0) + ' ms');
  for (const p of pool.slice(0, 5)) console.log('[camisas]   · ' + p.club.name + ' ' + p.label + ' ← «' + clean(p.title).slice(0, 80) + '» (' + p.source + ')');
}

module.exports = { CLUBS, pick, warm, stats, selfTest, parseSeason, accept, norm, startCrawl, clubOf };
