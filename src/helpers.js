'use strict';

const { EmbedBuilder } = require('discord.js');

const COLOR = { blue: 0x5865f2, green: 0x57f287, red: 0xed4245, gold: 0xf1c40f, gray: 0x99aab5 };

function embed(color, title, desc) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) e.setTitle(title);
  if (desc) e.setDescription(desc);
  return e;
}

function fmtMoney(n) {
  const m = Number(n) / 1_000_000;
  const s = Number.isInteger(m) ? String(m) : m.toFixed(1);
  return s + ' M€';
}

/* Traduce los errores técnicos más comunes de discord.js/Discord a algo que un usuario entienda.
   Nunca se les enseña el código o el texto original en inglés. */
function friendlyError(e) {
  const code = e && e.code;
  const map = {
    50001: 'No tengo acceso a ese canal. Pide a un administrador que me dé permiso para verlo.',
    50013: 'Me falta un permiso para hacer eso aquí (revisa que pueda ver el canal, enviar mensajes, insertar enlaces y adjuntar archivos).',
    50035: 'Algo de lo que mandé no es válido (puede ser un texto demasiado largo). Inténtalo de nuevo con un valor más corto.',
    10008: 'Ese mensaje ya no existe (puede que lo borraran).',
    10062: 'Se me pasó el tiempo para responder a esa interacción. Vuelve a intentarlo.',
    40060: 'Esa acción ya se había procesado; no hace falta repetirla.',
    160002: 'Ya hay un hilo abierto para eso.',
  };
  if (code && map[code]) return map[code];
  if (e && e.message && /missing access/i.test(e.message)) return map[50001];
  if (e && e.message && /missing permissions/i.test(e.message)) return map[50013];
  return 'Algo falló al hacer eso. Si pasa otra vez, avisa a un administrador.';
}

/* Responde (o sigue respondiendo) a una interacción sin crear errores de "ya se respondió",
   y con los fallos ya traducidos al español. */
async function safeReply(i, payload) {
  try {
    if (i.deferred) return await i.editReply(payload);
    if (i.replied) return await i.followUp(payload);
    return await i.reply(payload);
  } catch (e) {
    console.error('[discord] safeReply falló:', e.message);
  }
}

async function safeError(i, e) {
  console.error('[error]', e);
  const content = '❌ ' + friendlyError(e);
  try {
    if (i.deferred || i.replied) await i.followUp({ content, flags: 64 });
    else await i.reply({ content, flags: 64 });
  } catch (_) { /* si ni eso funciona, ya no hay nada que hacer */ }
}

const POSITIONS = ['POR', 'LD', 'DFC', 'LI', 'MCD', 'MC', 'MCO', 'MD', 'MI', 'DC'];
const POSITION_NAMES = {
  POR: 'Portero', LD: 'Lateral derecho', DFC: 'Defensa central', LI: 'Lateral izquierdo',
  MCD: 'Mediocentro defensivo', MC: 'Mediocentro', MCO: 'Mediocentro ofensivo',
  MD: 'Extremo derecho', MI: 'Extremo izquierdo', DC: 'Delantero centro',
};

module.exports = { COLOR, embed, fmtMoney, friendlyError, safeReply, safeError, POSITIONS, POSITION_NAMES };
