'use strict';

/* card.js — Imagen de bienvenida/despedida: avatar, título, nombre y un texto.
 * Usa @napi-rs/canvas. Como el contenedor del bot (Alpine) no trae NINGUNA fuente del sistema, se registran las
 * del repositorio (fonts/): sin ellas el texto salía en blanco. Si algo falla, devuelve null (se envía solo el texto). */

const fs = require('fs');
const path = require('path');

let canvasLib;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

const FONT_DIR = path.join(__dirname, 'fonts');
const FAMILY = 'CentinelaCard, CentinelaFallback, sans-serif';
let fontsOk = null;
let lastError = null;

function loadFonts() {
  if (fontsOk !== null) return fontsOk;
  fontsOk = false;
  if (!canvasLib || !canvasLib.GlobalFonts) return fontsOk;
  const files = [['Poppins-Regular.ttf', 'CentinelaCard'], ['Poppins-Medium.ttf', 'CentinelaCard'], ['Poppins-Bold.ttf', 'CentinelaCard'], ['DejaVuSans.ttf', 'CentinelaFallback'], ['DejaVuSans-Bold.ttf', 'CentinelaFallback']];
  let n = 0;
  for (const [f, fam] of files) {
    try {
      const p = path.join(FONT_DIR, f);
      if (fs.existsSync(p) && canvasLib.GlobalFonts.registerFromPath(p, fam)) n++;
    } catch (e) { lastError = e; }
  }
  fontsOk = n > 0;
  return fontsOk;
}

const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#3fd0b0');

/* Quita solo los emojis (las fuentes no los dibujan); sirve para los nombres, que pueden llevar _ o * de verdad */
const noEmoji = (s) => String(s || '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/\s+/g, ' ').trim();

/* Limpia un texto para la imagen: sin menciones, enlaces, formato de Discord ni emojis */
function clean(s) {
  return String(s || '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`|>]/g, '')
    .replace(/[\p{Extended_Pictographic}‍️\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Reparte el texto en líneas que quepan en maxW (como mucho maxLines; lo que sobre se corta con «…») */
function wrap(x, text, maxW, maxLines) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  let i = 0;
  for (; i < words.length; i++) {
    let w = words[i];
    while (x.measureText(w).width > maxW && w.length > 1) { // palabra más larga que la línea: se parte
      let k = w.length - 1;
      while (k > 1 && x.measureText(w.slice(0, k)).width > maxW) k--;
      if (cur) { lines.push(cur); cur = ''; if (lines.length >= maxLines) break; }
      lines.push(w.slice(0, k)); w = w.slice(k);
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
    const t = cur ? cur + ' ' + w : w;
    if (x.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(' ').split(' ').filter(Boolean).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last.replace(/[ ,.;:]+$/, '') + '…';
  }
  return lines;
}

async function getAvatar(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('avatar HTTP ' + res.status);
    return await canvasLib.loadImage(Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    lastError = e;
    return null; // sin avatar se dibuja un círculo con la inicial: la tarjeta sale igual
  }
}

/* make({ title, name, text, sub, avatar, color }) → Buffer PNG o null */
async function make({ title, name, text, sub, avatar, color }) {
  if (!canvasLib) return null;
  try {
    loadFonts();
    const { createCanvas } = canvasLib;
    const W = 1000, H = 360;
    const c = createCanvas(W, H);
    const x = c.getContext('2d');
    const accent = hex(color);
    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1626'); bg.addColorStop(1, '#16263f');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = accent; x.fillRect(0, 0, 12, H);
    x.globalAlpha = 0.10; x.beginPath(); x.arc(W - 40, 40, 190, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;

    // avatar circular (o inicial si no se pudo descargar)
    const cx = 170, cy = H / 2, r = 100;
    const img = await getAvatar(avatar);
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
    if (img) x.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    else {
      x.fillStyle = accent; x.fillRect(cx - r, cy - r, r * 2, r * 2);
      x.fillStyle = '#0b1626'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 110px ' + FAMILY;
      x.fillText((noEmoji(name)[0] || '?').toUpperCase(), cx, cy + 6);
    }
    x.restore();
    x.lineWidth = 7; x.strokeStyle = accent; x.beginPath(); x.arc(cx, cy, r + 3.5, 0, Math.PI * 2); x.stroke();

    // textos
    const left = 310, maxW = W - left - 40;
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillStyle = accent; x.font = 'bold 34px ' + FAMILY;
    x.fillText(clean(title).toUpperCase().slice(0, 40), left, 100);
    x.fillStyle = '#ffffff';
    let nm = noEmoji(name) || '?';
    let size = 64;
    do { x.font = 'bold ' + size + 'px ' + FAMILY; size -= 4; } while (x.measureText(nm).width > maxW && size > 32);
    if (x.measureText(nm).width > maxW) { // aun a tamaño mínimo no cabe: se corta con «…»
      while (nm.length > 1 && x.measureText(nm + '…').width > maxW) nm = nm.slice(0, -1);
      nm += '…';
    }
    x.fillText(nm, left, 175);
    const body = clean(text);
    let y = 222;
    if (body) {
      x.fillStyle = '#dbe5f2'; x.font = '500 28px ' + FAMILY;
      for (const ln of wrap(x, body, maxW, 2)) { x.fillText(ln, left, y); y += 38; }
    }
    const foot = clean(sub);
    if (foot) { x.fillStyle = '#8ea0b8'; x.font = '22px ' + FAMILY; x.fillText(foot.slice(0, 80), left, H - 36); }
    return c.toBuffer('image/png');
  } catch (e) {
    lastError = e;
    console.log('[tarjeta] no pude dibujar la imagen: ' + (e && e.message));
    return null;
  }
}

/* Comprobación al arrancar: dibuja texto y cuenta los píxeles encendidos. Si salen 0, las fuentes no funcionan. */
async function selfTest() {
  if (!canvasLib) return { ok: false, why: '@napi-rs/canvas no está instalado (las bienvenidas salen sin imagen)' };
  try {
    loadFonts();
    const { createCanvas } = canvasLib;
    const c = createCanvas(240, 60);
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 240, 60);
    x.fillStyle = '#fff'; x.font = 'bold 36px ' + FAMILY; x.textBaseline = 'middle'; x.fillText('Hola ñ', 10, 30);
    const d = x.getImageData(0, 0, 240, 60).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 128) lit++;
    const png = await make({ title: 'Prueba', name: 'Usuario', text: 'Texto de prueba', sub: 'Servidor', avatar: null, color: '#3fd0b0' });
    return { ok: lit > 50 && !!png, lit, fonts: fontsOk, png: png ? png.length : 0, why: lit > 50 ? '' : 'el texto sale en blanco (sin fuentes)' };
  } catch (e) {
    return { ok: false, why: (e && e.message) || String(e) };
  }
}

module.exports = { make, selfTest, clean, wrap, lastError: () => lastError };
