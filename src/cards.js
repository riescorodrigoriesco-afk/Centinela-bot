'use strict';

/* Genera la imagen PNG de una carta de jugador. Usa @napi-rs/canvas (binarios precompilados,
   no necesita compilar nada en el host). Si el jugador trae image_url (de FUT-DB), se intenta
   usar como fondo del retrato; si no hay imagen o falla la descarga, se usa un fondo liso. */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { POSITION_NAMES, fmtMoney } = require('./helpers');

function tierColor(rating) {
  if (rating >= 90) return ['#f7e98e', '#caa23b']; // especial / dorado claro
  if (rating >= 83) return ['#ffe28a', '#caa23b']; // oro
  if (rating >= 75) return ['#d9d9d9', '#8c8c8c']; // plata
  return ['#c88a54', '#8a5a2e']; // bronce
}

async function renderPlayerCard(player) {
  const W = 420;
  const H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const [c1, c2] = tierColor(player.rating);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  roundRect(ctx, 6, 6, W - 12, H - 12, 24);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 4;
  roundRect(ctx, 6, 6, W - 12, H - 12, 24);
  ctx.stroke();

  // Retrato (si hay imagen real) o silueta simple
  let hadPhoto = false;
  if (player.image_url) {
    try {
      const img = await loadImage(player.image_url);
      ctx.save();
      roundRect(ctx, W / 2 - 110, 150, 220, 220, 16);
      ctx.clip();
      ctx.drawImage(img, W / 2 - 110, 150, 220, 220);
      ctx.restore();
      hadPhoto = true;
    } catch (_) { /* seguimos sin foto */ }
  }
  if (!hadPhoto) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(W / 2, 260, 95, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚽', W / 2, 290);
  }

  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'left';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText(String(player.rating), 36, 100);
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(player.position, 40, 135);

  ctx.textAlign = 'center';
  ctx.font = 'bold 34px sans-serif';
  const name = player.name.length > 20 ? player.name.slice(0, 19) + '…' : player.name;
  ctx.fillText(name, W / 2, 410);
  ctx.font = '20px sans-serif';
  ctx.fillStyle = 'rgba(27,27,27,0.75)';
  ctx.fillText(POSITION_NAMES[player.position] || player.position, W / 2, 438);

  const stats = [
    ['RIT', player.pace], ['TIR', player.shooting], ['PAS', player.passing],
    ['REG', player.dribbling], ['DEF', player.defending], ['FÍS', player.physical],
  ];
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  const colX = [60, 230];
  const startY = 470;
  stats.forEach(([label, val], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = colX[col];
    const y = startY + row * 34;
    ctx.fillStyle = '#1b1b1b';
    ctx.fillText(String(val), x, y);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(27,27,27,0.7)';
    ctx.fillText(label, x + 44, y);
    ctx.font = 'bold 22px sans-serif';
  });

  ctx.textAlign = 'center';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = '#0b3d0b';
  ctx.fillText(player.price > 0 ? fmtMoney(player.price) : 'Agente libre', W / 2, H - 30);

  if (player.is_test_card) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 8);
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = 'rgba(200,0,0,0.55)';
    ctx.textAlign = 'center';
    ctx.fillText('CARTA DE PRUEBA', 0, 0);
    ctx.restore();
  }

  return canvas.encode('png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

module.exports = { renderPlayerCard };
