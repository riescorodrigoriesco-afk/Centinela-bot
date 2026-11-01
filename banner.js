'use strict';

/* banner.js — Banner del perfil del bot en Discord (la imagen ancha que sale arriba del todo al abrir su ficha).
 * Dibujo propio con @napi-rs/canvas (mismo estilo que la tarjeta de bienvenida en card.js): nada de logos de terceros.
 * Un bot SÍ puede tener banner sin Nitro (restricción solo de cuentas normales); se pone con client.user.setBanner().
 * Solo se toca si el bot todavía no tiene banner, para no pisar uno que el dueño haya puesto a mano desde Discord. */

const card = require('./card');

const W = 960, H = 384;
let lastError = null;
let tried = false;

function draw() {
  const canvasLib = card.canvasLib();
  if (!canvasLib) return null;
  try {
    card.loadFonts();
    const { createCanvas, Path2D } = canvasLib;
    const c = createCanvas(W, H);
    const x = c.getContext('2d');
    const accent = '#3fd0b0';

    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1626'); bg.addColorStop(1, '#16263f');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.globalAlpha = 0.09;
    x.beginPath(); x.arc(W + 30, -40, 260, 0, Math.PI * 2); x.fillStyle = accent; x.fill();
    x.beginPath(); x.arc(-60, H + 60, 220, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;

    // Emblema: escudo abstracto propio (nada de logos existentes) con una muesca en forma de «ojo» vigilante
    const cx = 185, cy = H / 2, s = 118;
    x.save(); x.translate(cx, cy);
    const shield = new Path2D();
    shield.moveTo(0, -s);
    shield.bezierCurveTo(s * 0.62, -s * 0.78, s * 0.86, -s * 0.5, s * 0.86, -s * 0.12);
    shield.bezierCurveTo(s * 0.86, s * 0.56, s * 0.46, s * 0.92, 0, s);
    shield.bezierCurveTo(-s * 0.46, s * 0.92, -s * 0.86, s * 0.56, -s * 0.86, -s * 0.12);
    shield.bezierCurveTo(-s * 0.86, -s * 0.5, -s * 0.62, -s * 0.78, 0, -s);
    shield.closePath();
    const sg = x.createLinearGradient(0, -s, 0, s);
    sg.addColorStop(0, accent); sg.addColorStop(1, '#1f8f73');
    x.fillStyle = sg; x.fill(shield);
    x.lineWidth = 5; x.strokeStyle = '#0b1626'; x.globalAlpha = 0.25; x.stroke(shield); x.globalAlpha = 1;
    // «ojo» vigilante tallado en el centro
    x.save(); x.clip(shield);
    x.fillStyle = '#0b1626';
    x.beginPath(); x.ellipse(0, -2, s * 0.56, s * 0.3, 0, 0, Math.PI * 2); x.fill();
    x.restore();
    x.fillStyle = sg;
    x.beginPath(); x.arc(0, -2, s * 0.2, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#0b1626';
    x.beginPath(); x.arc(0, -2, s * 0.09, 0, Math.PI * 2); x.fill();
    x.restore();

    // Texto: nombre + lema
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#ffffff';
    x.font = '800 76px ' + card.FAMILY;
    const word = 'CENTINELA';
    const gap = 3;
    let tw = 0; for (const ch of word) tw += x.measureText(ch).width + gap; tw -= gap;
    let tx = 345;
    const ty = H / 2 - 6;
    for (const ch of word) { x.fillText(ch, tx, ty); tx += x.measureText(ch).width + gap; }
    x.fillStyle = accent; x.font = '600 25px ' + card.FAMILY;
    x.fillText('SEGURIDAD · MODERACIÓN · COMUNIDAD', 348, ty + 40);

    return c.toBuffer('image/png');
  } catch (e) {
    lastError = e;
    console.log('[banner] no pude dibujar el banner: ' + (e && e.message));
    return null;
  }
}

/* Se llama una vez al conectar: si el bot ya tiene banner (puesto a mano o por un arranque anterior), no hace nada. */
async function ensure(client) {
  if (tried) return { ok: false, why: 'ya se intentó en este arranque' };
  tried = true;
  try {
    const me = client.user;
    if (!me) return { ok: false, why: 'el bot todavía no está listo' };
    await me.fetch().catch(() => {}); // refresca me.banner por si lo guardó Discord de una sesión anterior
    if (me.banner) { console.log('[banner] el bot ya tiene uno puesto: no se toca'); return { ok: true, skipped: true }; }
    if (typeof me.setBanner !== 'function') { console.log('[banner] esta versión de discord.js no deja poner banner al bot'); return { ok: false, why: 'sin setBanner' }; }
    const png = draw();
    if (!png) { console.log('[banner] no se pudo generar la imagen (sin @napi-rs/canvas o sin fuentes)'); return { ok: false, why: 'sin imagen' }; }
    await me.setBanner(png);
    console.log('[banner] puesto en el perfil del bot (' + png.length + ' B)');
    return { ok: true, png: png.length };
  } catch (e) {
    lastError = e;
    // Algunas cuentas muy nuevas o con la verificación pendiente puede que Discord no se lo permita: no es grave, se reintenta en el próximo arranque
    console.log('[banner] no se pudo poner: ' + (e && e.message));
    tried = false; // para que lo reintente si fue un fallo pasajero (p. ej. de red) y no una negativa de Discord
    return { ok: false, why: (e && e.message) || String(e) };
  }
}

module.exports = { draw, ensure, lastError: () => lastError };
