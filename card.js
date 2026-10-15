'use strict';

/* card.js — Imagen de bienvenida/despedida con avatar y nombre.
 * Usa @napi-rs/canvas si está instalado; si no, devuelve null y se envía solo el texto. */

let canvasLib;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { canvasLib = null; }

async function make({ title, name, sub, avatar, color }) {
  if (!canvasLib) return null;
  try {
    const { createCanvas, loadImage } = canvasLib;
    const W = 900, H = 300;
    const c = createCanvas(W, H);
    const x = c.getContext('2d');
    const accent = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#3fd0b0';
    x.fillStyle = '#0b1626';
    x.fillRect(0, 0, W, H);
    x.fillStyle = accent;
    x.fillRect(0, 0, 10, H);
    // avatar circular
    const buf = Buffer.from(await (await fetch(avatar)).arrayBuffer());
    const img = await loadImage(buf);
    x.save();
    x.beginPath();
    x.arc(150, 150, 90, 0, Math.PI * 2);
    x.closePath();
    x.clip();
    x.drawImage(img, 60, 60, 180, 180);
    x.restore();
    x.lineWidth = 6;
    x.strokeStyle = accent;
    x.beginPath();
    x.arc(150, 150, 93, 0, Math.PI * 2);
    x.stroke();
    x.fillStyle = '#c9d4e3';
    x.font = 'bold 36px sans-serif';
    x.fillText(title, 280, 120);
    x.fillStyle = '#ffffff';
    let size = 56;
    do { x.font = 'bold ' + size + 'px sans-serif'; size -= 4; } while (x.measureText(name).width > 570 && size > 20);
    x.fillText(name, 280, 190);
    x.fillStyle = '#8ea0b8';
    x.font = '28px sans-serif';
    x.fillText(sub, 280, 235);
    return c.toBuffer('image/png');
  } catch (_) {
    return null;
  }
}

module.exports = { make };
