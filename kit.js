'use strict';

/*
 * kit.js — Camisetas de fútbol dibujadas por código (PNG sin librerías externas).
 * Clubes y diseños ORIGINALES (ficticios): cada época tiene su estilo (cuellos, patrones, patrocinador),
 * así que el año se puede deducir mirando la camiseta.
 */

const zlib = require('zlib');

/* ============================ clubes ficticios ============================ */
// [nombre, color principal, secundario, acento, fundación del estilo de escudo]
const TEAMS = [
  ['Club Deportivo Faro', '#1d4ed8', '#ffffff', '#facc15'],
  ['Atlético Marea', '#0ea5e9', '#0f172a', '#ffffff'],
  ['Real Cumbre', '#ffffff', '#7c3aed', '#facc15'],
  ['Unión Dorada', '#facc15', '#111827', '#ffffff'],
  ['Sporting Aurora', '#dc2626', '#ffffff', '#111827'],
  ['FC Volcán', '#ea580c', '#111827', '#ffffff'],
  ['Deportivo Esmeralda', '#16a34a', '#ffffff', '#facc15'],
  ['Racing Nieve', '#e5e7eb', '#1e3a8a', '#dc2626'],
  ['CF Tormenta', '#312e81', '#e5e7eb', '#38bdf8'],
  ['Athletic Pinar', '#166534', '#fef08a', '#ffffff'],
  ['Club Cóndor', '#7f1d1d', '#fde68a', '#ffffff'],
  ['Real Marina', '#0369a1', '#ffffff', '#f97316'],
  ['Estrella del Sur', '#be123c', '#111827', '#ffffff'],
  ['Juventud Roble', '#92400e', '#ffffff', '#16a34a'],
  ['Northbridge United', '#b91c1c', '#ffffff', '#111827'],
  ['Eastfield Rovers', '#1e40af', '#f8fafc', '#fbbf24'],
  ['Westport Albion', '#f8fafc', '#0f766e', '#fbbf24'],
  ['Ashford Athletic', '#111827', '#f59e0b', '#ffffff'],
  ['Kingsmere City', '#38bdf8', '#ffffff', '#1e3a8a'],
  ['Ravenhill Wanderers', '#581c87', '#f1f5f9', '#fb923c'],
  ['Stonebridge Town', '#15803d', '#111827', '#f8fafc'],
  ['Harborside FC', '#0f172a', '#38bdf8', '#f8fafc'],
  ['Lakeshire Rangers', '#2563eb', '#fde047', '#ffffff'],
  ['Oakwood Albion', '#ca8a04', '#14532d', '#ffffff'],
];

const YEAR_MIN = 1990;
const YEAR_MAX = 2026;

/* ============================ utilidades ============================ */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ============================ geometría ============================ */
const W = 640;
const H = 600;
// Contorno de la camiseta (sentido horario)
const SHIRT = [
  [250, 92], [150, 128], [62, 250], [122, 292], [178, 232], [178, 540], [462, 540], [462, 232], [518, 292], [578, 250], [490, 128], [390, 92],
];
const NECKS = {
  round: [[390, 92], [376, 128], [352, 148], [320, 156], [288, 148], [264, 128], [250, 92]],
  crew: [[390, 92], [380, 118], [356, 136], [320, 142], [284, 136], [260, 118], [250, 92]],
  v: [[390, 92], [356, 150], [320, 192], [284, 150], [250, 92]],
  polo: [[390, 92], [352, 108], [320, 114], [288, 108], [250, 92]],
};
const SHIRT_SEGS = SHIRT.map((p, i) => [p, SHIRT[(i + 1) % SHIRT.length]]);
const BACK = [[250, 92], [262, 72], [320, 62], [378, 72], [390, 92]];
const BACK_SEGS = BACK.map((p, i) => [p, BACK[(i + 1) % BACK.length]]);
const CUFFS = [[[62, 250], [122, 292]], [[518, 292], [578, 250]]];

function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy || 1;
  const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l, 0, 1);
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
function polyDist(x, y, pts) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, y, pts[i], pts[i + 1]));
  return d;
}
function outlineDist(x, y, neck) {
  let d = 1e9;
  for (const [a, b] of SHIRT_SEGS) d = Math.min(d, segDist(x, y, a, b));
  for (const [a, b] of BACK_SEGS) d = Math.min(d, segDist(x, y, a, b));
  return Math.min(d, polyDist(x, y, NECKS[neck]));
}

/* ============================ estilo por época ============================ */
function eraOf(year) {
  if (year < 2000) return 90;
  if (year < 2010) return 0;
  if (year < 2020) return 10;
  return 20;
}
const POOLS = {
  90: { patterns: ['zigzag', 'sash', 'chevron', 'blocks', 'stripes', 'halves'], necks: ['polo', 'polo', 'v'], sponsor: [150, 62], cuffs: false, panel: false },
  0: { patterns: ['hoops', 'pinstripe', 'stripes', 'solid', 'sash', 'halves'], necks: ['v', 'round', 'polo'], sponsor: [124, 48], cuffs: true, panel: false },
  10: { patterns: ['solid', 'solid', 'stripes', 'hoops', 'sash'], necks: ['crew', 'round', 'v'], sponsor: [104, 40], cuffs: true, panel: true },
  20: { patterns: ['gradient', 'checker', 'solid', 'bands', 'pinstripe'], necks: ['crew', 'round'], sponsor: [76, 30], cuffs: false, panel: false },
};

/** Especificación determinista de la camiseta de un club en un año. */
function specFor(teamIdx, year) {
  const team = TEAMS[teamIdx];
  const r = rng(hash(team[0] + ':' + year));
  const era = eraOf(year);
  const pool = POOLS[era];
  let c1 = hex(team[1]), c2 = hex(team[2]), c3 = hex(team[3]);
  const away = r() < 0.28; // algunos años salen de visitante
  if (away) { const t = c1; c1 = lum(c2) > 140 ? c2 : mix(c2, [255, 255, 255], 0.6); c2 = t; }
  const pattern = pool.patterns[Math.floor(r() * pool.patterns.length)];
  const neck = pool.necks[Math.floor(r() * pool.necks.length)];
  const far = (a, b) => Math.abs(lum(a) - lum(b)) > 45;
  const trim = far(c3, c1) ? c3 : far(c2, c1) ? c2 : lum(c1) > 128 ? [20, 24, 34] : [240, 240, 240];
  return { team: team[0], teamIdx, year, era, c1, c2, c3, trim, pattern, neck, pool, away, seed: hash(team[0]) };
}

/* ============================ pintura ============================ */
// Color de la tela en (x, y) según el patrón
function fabric(s, x, y) {
  const { c1, c2, pattern } = s;
  const lx = x - 320;
  switch (pattern) {
    case 'stripes': return ((Math.floor((x - 130) / 46) % 2) + 2) % 2 ? c2 : c1;
    case 'hoops': return Math.floor((y - 80) / 44) % 2 ? c2 : c1;
    case 'pinstripe': return Math.abs(((x + 1000) % 22) - 11) < 2 ? mix(c1, c2, 0.85) : c1;
    case 'halves': return x < 320 ? c1 : c2;
    case 'sash': return Math.abs(x - 0.65 * (y - 90) - 200) < 40 ? c2 : c1;
    case 'chevron': { const d = Math.abs(lx) * 0.8 + (y - 90); return Math.floor(d / 46) % 3 === 1 ? c2 : c1; }
    case 'zigzag': { const tri = Math.abs(((x + 1000) % 60) - 30) / 30; const yy = 260 + tri * 34; return Math.abs(y - yy) < 22 ? c2 : c1; }
    case 'blocks': { const cx = Math.floor((x + 1000) / 71), cy = Math.floor((y - 60) / 71); return (cx + cy) % 3 === 0 ? mix(c1, c2, 0.9) : c1; }
    case 'checker': { const cx = Math.floor((x + 1000) / 26), cy = Math.floor(y / 26); return (cx + cy) % 2 ? mix(c1, c2, 0.16) : c1; }
    case 'gradient': return mix(c1, c2, smooth(150, 560, y) * 0.55);
    case 'bands': return Math.floor((y - 60) / 78) % 2 ? mix(c1, c2, 0.14) : c1;
    default: return c1;
  }
}

function shapeHit(kind, x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  switch (kind) {
    case 'circle': return dx * dx + dy * dy < r * r;
    case 'diamond': return Math.abs(dx) + Math.abs(dy) < r * 1.2;
    case 'star': { const a = Math.atan2(dy, dx), d = Math.hypot(dx, dy); return d < r * (0.55 + 0.45 * Math.abs(Math.cos(2.5 * a))); }
    case 'bar': return Math.abs(dx) < r * 0.28 && Math.abs(dy) < r;
    case 'chev': return Math.abs(dx) < r && dy > -r * 0.6 + Math.abs(dx) * 0.8 - r * 0.2 && dy < -r * 0.1 + Math.abs(dx) * 0.8 + r * 0.45;
    default: return false;
  }
}

function paint(s, x, y) {
  // 1) tela
  let c = fabric(s, x, y);
  if (y < 92 && inPoly(BACK, x, y)) return mul(s.c1, 0.5 * (1.05 - 0.4 * smooth(62, 92, y) * 0 ));
  const dEdge = outlineDist(x, y, s.neck);
  const neckPts = NECKS[s.neck];
  const dNeck = polyDist(x, y, neckPts);

  // 2) paneles laterales (años 2010)
  if (s.pool.panel && y > 232 && (x < 196 || x > 444)) c = s.c2;
  // 3) puños de manga
  for (const [a, b] of CUFFS) {
    const dc = segDist(x, y, a, b);
    if (s.pool.cuffs ? dc < 12 : dc < 7) c = s.pool.cuffs ? s.trim : s.c2;
  }
  // 4) franja de hombro
  if (s.era !== 20 && y < 190 && Math.abs((x < 320 ? x : 640 - x) - (y - 92) * 0.55 - 110) < 6 && (x < 178 || x > 462 || y < 135)) c = s.trim;
  // 5) cuello
  const bw = s.neck === 'crew' ? 14 : s.neck === 'polo' ? 9 : 10;
  if (dNeck < bw) c = s.neck === 'polo' ? (Math.abs(lum(s.c2) - lum(s.c1)) > 30 ? s.c2 : s.trim) : s.trim;
  // solapas del polo y botones
  if (s.neck === 'polo') {
    const flapL = [[250, 92], [304, 90], [322, 150], [262, 118]];
    const flapR = [[390, 92], [336, 90], [318, 150], [378, 118]];
    if (inPoly(flapL, x, y) || inPoly(flapR, x, y)) c = mix(s.c2, [255, 255, 255], 0.12);
    if (Math.abs(x - 320) < 5 && y > 112 && y < 196) c = mix(c, s.c2, 0.8);
    for (const by of [140, 164, 188]) if ((x - 320) ** 2 + (y - by) ** 2 < 16) c = mul(s.c3, 0.9);
  }
  // 6) escudo (pecho izquierdo)
  const ecx = 252, ecy = 228;
  const r = rng(s.seed);
  const shape = ['shield', 'round', 'diamond'][Math.floor(r() * 3)];
  const sym = ['star', 'bar', 'circle', 'chev', 'diamond'][Math.floor(r() * 5)];
  const er = s.era === 20 ? 24 : 30;
  let inCrest = false;
  if (shape === 'round') inCrest = (x - ecx) ** 2 + (y - ecy) ** 2 < er * er;
  else if (shape === 'diamond') inCrest = Math.abs(x - ecx) + Math.abs(y - ecy) < er * 1.25;
  else inCrest = Math.abs(x - ecx) < er * 0.85 && y > ecy - er && y < ecy + er * 1.05 - Math.max(0, Math.abs(x - ecx) - er * 0.2) * 1.15;
  if (inCrest) {
    const border = shape === 'round' ? er - Math.hypot(x - ecx, y - ecy) : shape === 'diamond' ? er * 1.25 - (Math.abs(x - ecx) + Math.abs(y - ecy)) : er * 0.85 - Math.abs(x - ecx);
    c = border < 4 ? s.c3 : mix(s.c2, s.c1, 0.35);
    if (border >= 4 && shapeHit(sym, x, y, ecx, ecy + 1, er * 0.5)) c = s.c3;
  }
  // 7) marca del fabricante (geometría abstracta, pecho derecho)
  const mk = (x - 388) ** 2 + (y - 220) ** 2;
  if (s.era === 90 ? Math.abs(x - 388) + Math.abs(y - 220) < 11 : mk < 90) c = lum(c) > 150 ? mul(s.c3, 0.5) : [245, 245, 245];
  // 8) patrocinador
  const [sw, sh] = s.pool.sponsor;
  const sy = s.era === 20 ? 330 : 300;
  if (Math.abs(x - 320) < sw / 2 && Math.abs(y - sy) < sh / 2) {
    const bg = lum(s.c1) > 135 ? [24, 28, 38] : [244, 244, 244];
    c = bg;
    const ink = lum(bg) > 128 ? [30, 34, 46] : [235, 235, 235];
    const u = (x - (320 - sw / 2)) / sw, v = (y - (sy - sh / 2)) / sh;
    const bars = [0.18, 0.38, 0.6, 0.8];
    for (let i = 0; i < bars.length; i++) {
      if (Math.abs(u - (0.12 + i * 0.21)) < 0.065 && v > 0.22 + 0.1 * (i % 2) && v < 0.8) c = ink;
    }
  }
  // 9) luz y sombras
  const light = 1.06 - 0.16 * smooth(100, 560, y) - 0.05 * smooth(120, 520, x);
  let k = light;
  k *= 1 - 0.14 * (1 - smooth(0, 16, dEdge));
  k *= 1 - 0.07 * smooth(0, 1, Math.abs(Math.sin((x + y * 0.4) / 23)) * 0.5); // arruga suave
  const armL = Math.hypot(x - 178, y - 236), armR = Math.hypot(x - 462, y - 236);
  k *= 1 - 0.12 * (1 - smooth(0, 46, Math.min(armL, armR)));
  return mul(c, k);
}

function background(x, y) {
  const g = mix([20, 30, 48], [8, 14, 26], y / H);
  const v = Math.hypot(x - W / 2, y - H / 2) / 420;
  return mul(g, 1.12 - 0.35 * clamp(v, 0, 1));
}

/* ============================ PNG ============================ */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Dibuja la camiseta y devuelve un PNG (Buffer). */
function covered(spec, x, y) {
  return (inPoly(SHIRT, x, y) && !inPoly(NECKS[spec.neck], x, y)) || inPoly(BACK, x, y);
}
function render(spec) {
  const rgb = Buffer.alloc(W * H * 3);
  const put = (i, c) => { rgb[i] = clamp(Math.round(c[0]), 0, 255); rgb[i + 1] = clamp(Math.round(c[1]), 0, 255); rgb[i + 2] = clamp(Math.round(c[2]), 0, 255); };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5, py = y + 0.5;
      let col;
      if (px < 52 || px > 588 || py < 56 || py > 548) col = background(px, py);
      else {
        const d = outlineDist(px, py, spec.neck);
        if (d > 2.2) col = covered(spec, px, py) ? paint(spec, px, py) : background(px, py);
        else {
          let r = 0, g = 0, b = 0;
          for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
            const qx = x + (sx + 0.5) / 3, qy = y + (sy + 0.5) / 3;
            const c = covered(spec, qx, qy) ? paint(spec, qx, qy) : background(qx, qy);
            r += c[0]; g += c[1]; b += c[2];
          }
          col = [r / 9, g / 9, b / 9];
        }
      }
      put((y * W + x) * 3, col);
    }
  }
  return png(rgb);
}
/** Dibuja en un hilo aparte para no bloquear el bot (cae al hilo principal si no se puede). */
function renderAsync(spec) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (b) => { if (!done) { done = true; resolve(b); } };
    try {
      const { Worker } = require('worker_threads');
      const w = new Worker(__filename, { workerData: { spec: { ...spec, pool: undefined } } });
      w.once('message', (m) => fin(Buffer.from(m)));
      w.once('error', () => fin(render(spec)));
      w.once('exit', () => fin(render(spec)));
    } catch (_) { fin(render(spec)); }
  });
}

/** Elige una camiseta al azar: devuelve { spec, png } */
async function randomKit(rand = Math.random) {
  const teamIdx = Math.floor(rand() * TEAMS.length);
  const year = YEAR_MIN + Math.floor(rand() * (YEAR_MAX - YEAR_MIN + 1));
  const spec = specFor(teamIdx, year);
  return { spec, team: spec.team, year, png: await renderAsync(spec) };
}

// Si este archivo se ejecuta como hilo, dibuja la camiseta pedida y devuelve el PNG
try {
  const wt = require('worker_threads');
  if (!wt.isMainThread && wt.workerData && wt.workerData.spec && wt.workerData.spec.team) {
    const sp = wt.workerData.spec;
    const fresh = specFor(sp.teamIdx, sp.year);
    wt.parentPort.postMessage(render(fresh));
  }
} catch (_) { /* sin hilos */ }

module.exports = { TEAMS, YEAR_MIN, YEAR_MAX, specFor, render, randomKit, eraOf };
