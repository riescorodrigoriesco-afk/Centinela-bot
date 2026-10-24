'use strict';

/*
 * camisas.js — Juego «CATCH UP!»: el bot manda la camiseta de un equipo y hay que adivinar de qué AÑO es.
 *   $camisa            empieza una ronda (también: $camiseta, $shirt)
 *   $camisatop         ranking de aciertos
 *   $camisa añadir Equipo | año   (con una imagen adjunta) añade tus propias camisetas al juego
 *   $camisa lista / $camisa borrar <id>
 * El primero que escribe el año correcto en el canal gana monedas (🪙, las mismas de /daily y los minijuegos).
 * Camisetas incluidas: clubes y diseños originales (ficticios) dibujados por código.
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const bot = require('./bot');
const games = require('./games');
const kit = require('./kit');

const { L, COLOR, jsonStore, canConfigure, logErr } = bot;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const store = jsonStore('kits.json', () => ({}));

const ROUND_MS = 45000;
const HINT1_MS = 18000;
const HINT2_MS = 32000;
const BASE = 150;
const MAX_GUESSES = 3;
const rounds = new Map(); // canal -> ronda

const newId = () => Math.random().toString(36).slice(2, 8);
const decade = (y) => Math.floor(y / 10) * 10;
const guessOf = (txt) => {
  const t = String(txt || '').trim();
  if (t.length > 26) return null;
  const m = t.match(/^\D{0,14}((?:19|20)\d{2})\D{0,8}$/);
  return m ? parseInt(m[1], 10) : null;
};

/* ============================ ronda ============================ */
async function pickKit(gid) {
  const mine = (store.data[gid] || []).filter((k) => fs.existsSync(k.file));
  if (mine.length && Math.random() < 0.5) {
    const k = mine[Math.floor(Math.random() * mine.length)];
    return { team: k.team, year: k.year, png: fs.readFileSync(k.file), name: 'camisa' + path.extname(k.file), custom: true };
  }
  const r = await kit.randomKit();
  return { team: r.team, year: r.year, png: r.png, name: 'camisa.png', custom: false };
}

async function startRound(ctx) {
  const ch = ctx.channel;
  const lc = ctx.locale;
  if (rounds.has(ch.id)) return ctx.reply(L(lc, '👕 There is already a shirt in play in this channel!', '👕 ¡Ya hay una camiseta en juego en este canal!'));
  rounds.set(ch.id, { pending: true }); // reserva el canal mientras se dibuja
  try {
    await ctx.defer();
    const k = await pickKit(ctx.guild.id);
    const e = new EmbedBuilder()
      .setColor(COLOR.blue || 0x3498db)
      .setTitle('⚡ CATCH UP!')
      .setDescription(
        '**' + k.team + '**\n' +
        L(lc, '🗓️ What **year** is this shirt from? Type the year in the chat (e.g. `2004`).', '🗓️ ¿De qué **año** es esta camiseta? Escribe el año en el chat (ej. `2004`).') + '\n' +
        L(lc, '🏁 The first correct answer wins 🪙!  ⏱️ ' + ROUND_MS / 1000 + ' s · ' + MAX_GUESSES + ' tries each', '🏁 ¡La primera respuesta correcta gana 🪙!  ⏱️ ' + ROUND_MS / 1000 + ' s · ' + MAX_GUESSES + ' intentos cada uno')
      )
      .setImage('attachment://' + k.name)
      .setFooter({ text: L(lc, 'Tip: the design changes with every era', 'Pista: el diseño cambia con cada época') });
    await ctx.reply({ embeds: [e], files: [{ attachment: k.png, name: k.name }] });

    const r = { gid: ctx.guild.id, answer: k.year, team: k.team, t0: Date.now(), guesses: new Map(), lc, channel: ch, timers: [] };
    rounds.set(ch.id, r);
    r.timers.push(setTimeout(() => ch.send(L(lc, '💡 Hint: it is from the **' + decade(k.year) + 's**.', '💡 Pista: es de los **años ' + decade(k.year) + '**.')).catch(() => {}), HINT1_MS));
    r.timers.push(setTimeout(() => {
      const lo = k.year - Math.floor(Math.random() * 5);
      ch.send(L(lc, '💡 Second hint: between **' + lo + '** and **' + (lo + 5) + '**.', '💡 Segunda pista: entre **' + lo + '** y **' + (lo + 5) + '**.')).catch(() => {});
    }, HINT2_MS));
    r.timers.push(setTimeout(() => endRound(ch.id, null), ROUND_MS));
  } catch (e) {
    rounds.delete(ch.id);
    throw e;
  }
}

function endRound(chId, winner) {
  const r = rounds.get(chId);
  if (!r || r.pending) return;
  rounds.delete(chId);
  for (const t of r.timers) clearTimeout(t);
  if (winner) return;
  // Nadie acertó: se rompen las rachas de quien lo intentó
  for (const uid of r.guesses.keys()) {
    const a = games.acct(r.gid, uid);
    if (a.shirt) a.shirt.streak = 0;
  }
  games.eco.save();
  const e = new EmbedBuilder().setColor(COLOR.red || 0xe74c3c).setTitle('⏱️ ' + L(r.lc, 'Time is up!', '¡Se acabó el tiempo!'))
    .setDescription(L(r.lc, 'It was **' + r.team + '**, **' + r.answer + '**. Nobody got it.', 'Era **' + r.team + '**, **' + r.answer + '**. Nadie acertó.') + '\n' + L(r.lc, 'Try another with `$camisa`.', 'Prueba otra con `$camisa`.'));
  r.channel.send({ embeds: [e] }).catch(() => {});
}

async function onGuess(msg) {
  if (!msg.guild || !msg.author || msg.author.bot) return;
  const r = rounds.get(msg.channelId);
  if (!r || r.pending) return;
  const y = guessOf(msg.content);
  if (y === null) return;
  const n = (r.guesses.get(msg.author.id) || 0) + 1;
  if (n > MAX_GUESSES) return;
  r.guesses.set(msg.author.id, n);
  const lc = r.lc;

  if (y !== r.answer) {
    const d = Math.abs(y - r.answer);
    await msg.react(d <= 2 ? '🔥' : d <= 5 ? '🙂' : '🧊').catch(() => {});
    if (n === MAX_GUESSES) msg.reply({ content: L(lc, 'No more tries for you this round.', 'Ya no te quedan intentos en esta ronda.'), allowedMentions: { repliedUser: false } }).catch(() => {});
    return;
  }

  // ¡Acierto!
  const left = Math.max(0, ROUND_MS - (Date.now() - r.t0));
  const speed = Math.round(100 * (left / ROUND_MS));
  const a = games.acct(r.gid, msg.author.id);
  a.shirt = a.shirt || { wins: 0, streak: 0, best: 0 };
  a.shirt.wins++;
  a.shirt.streak++;
  a.shirt.best = Math.max(a.shirt.best, a.shirt.streak);
  const streakBonus = Math.min(50, (a.shirt.streak - 1) * 10);
  const total = BASE + speed + streakBonus;
  a.coins += total;
  games.eco.save();
  endRound(msg.channelId, msg.author.id);

  const e = new EmbedBuilder().setColor(COLOR.green || 0x2ecc71).setTitle('🏆 CATCH UP!')
    .setDescription(
      '<@' + msg.author.id + '> ' + L(lc, 'nailed it! It was **' + r.team + '**, **' + r.answer + '**.', '¡lo clavó! Era **' + r.team + '**, **' + r.answer + '**.') + '\n\n' +
      '**+' + games.coinsTxt(total) + '**  (' + L(lc, 'base ', 'base ') + BASE + ' + ' + L(lc, 'speed ', 'rapidez ') + speed + (streakBonus ? ' + ' + L(lc, 'streak ', 'racha ') + streakBonus : '') + ')\n' +
      '🔥 ' + L(lc, 'Streak: ', 'Racha: ') + a.shirt.streak + ' · ' + L(lc, 'Wins: ', 'Aciertos: ') + a.shirt.wins + '\n' +
      L(lc, 'Balance: ', 'Saldo: ') + games.coinsTxt(a.coins)
    );
  msg.reply({ embeds: [e], allowedMentions: { repliedUser: false, users: [] } }).catch(() => {});
}

/* ============================ ranking y camisetas propias ============================ */
function top(ctx) {
  const lc = ctx.locale;
  const g = games.eco.data[ctx.guild.id] || {};
  const rows = Object.entries(g).filter(([, v]) => v.shirt && v.shirt.wins > 0).sort((x, y) => y[1].shirt.wins - x[1].shirt.wins || y[1].shirt.best - x[1].shirt.best).slice(0, 10);
  if (!rows.length) return ctx.reply(L(lc, 'Nobody has won yet. Start with `$camisa`!', 'Todavía nadie ha acertado. ¡Empieza con `$camisa`!'));
  const medals = ['🥇', '🥈', '🥉'];
  const e = new EmbedBuilder().setColor(COLOR.blue || 0x3498db).setTitle('👕 ' + L(lc, 'Shirt guessers', 'Mejores adivinos de camisetas'))
    .setDescription(rows.map(([id, v], i) => (medals[i] || '**' + (i + 1) + '.**') + ' <@' + id + '> — ' + v.shirt.wins + ' ' + L(lc, 'correct', 'aciertos') + ' · ' + L(lc, 'best streak', 'mejor racha') + ' ' + v.shirt.best).join('\n'));
  return ctx.reply({ embeds: [e] });
}

async function addKit(ctx) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const msg = ctx.raw;
  const att = msg && msg.attachments && msg.attachments.first();
  const [teamRaw, yearRaw] = ctx.rest(1).split('|').map((s) => s.trim());
  const year = parseInt(yearRaw, 10);
  if (!att || !teamRaw || !(year >= 1900 && year <= 2035)) {
    return ctx.reply(L(lc, 'Attach an image and write: `$camisa add Team name | year`', 'Adjunta una imagen y escribe: `$camisa añadir Nombre del equipo | año`'));
  }
  if (!/^image\/(png|jpe?g|webp)/i.test(att.contentType || '') || att.size > 8 * 1024 * 1024) return ctx.reply(L(lc, '❌ It must be a PNG, JPG or WEBP image under 8 MB.', '❌ Debe ser una imagen PNG, JPG o WEBP de menos de 8 MB.'));
  const list = store.data[ctx.guild.id] || (store.data[ctx.guild.id] = []);
  if (list.length >= 60) return ctx.reply(L(lc, '❌ Limit reached (60 shirts).', '❌ Límite alcanzado (60 camisetas).'));
  const r = await fetch(att.url);
  if (!r.ok) return ctx.reply(L(lc, '❌ I could not download the image.', '❌ No pude descargar la imagen.'));
  const buf = Buffer.from(await r.arrayBuffer());
  const id = newId();
  const ext = /png/i.test(att.contentType) ? '.png' : /webp/i.test(att.contentType) ? '.webp' : '.jpg';
  const dir = path.join(DATA_DIR, 'kits');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ctx.guild.id + '_' + id + ext);
  fs.writeFileSync(file, buf);
  list.push({ id, team: teamRaw.slice(0, 60), year, file });
  store.save();
  return ctx.reply('✅ ' + L(lc, 'Added ', 'Añadida ') + '**' + teamRaw.slice(0, 60) + ' ' + year + '** (`' + id + '`). ' + L(lc, 'It will show up in rounds.', 'Saldrá en las rondas.'));
}

function listKits(ctx) {
  const lc = ctx.locale;
  const list = store.data[ctx.guild.id] || [];
  if (!list.length) return ctx.reply(L(lc, 'No custom shirts yet. Add one with `$camisa add Team | year` and an image.', 'Aún no hay camisetas propias. Añade una con `$camisa añadir Equipo | año` y una imagen.'));
  return ctx.reply(list.map((k) => '`' + k.id + '` · ' + k.team + ' · ' + k.year).join('\n').slice(0, 1900));
}

async function delKit(ctx) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const list = store.data[ctx.guild.id] || [];
  const i = list.findIndex((k) => k.id === String(ctx.arg(1) || ''));
  if (i < 0) return ctx.reply(L(lc, 'I do not find that id. See `$camisa list`.', 'No encuentro ese id. Mira `$camisa lista`.'));
  try { fs.unlinkSync(list[i].file); } catch (_) {}
  list.splice(i, 1);
  store.save();
  return ctx.reply('🗑️ ' + L(lc, 'Removed.', 'Eliminada.'));
}

/* ============================ registro ============================ */
function register(def) {
  def({
    name: 'camisa',
    aliases: ['camiseta', 'shirt', 'catchup'],
    level: 'public',
    d: 'CATCH UP! Guess the year of a football shirt and win coins',
    es: '¡CATCH UP! Adivina de qué año es la camiseta de un equipo y gana monedas',
    async run(ctx) {
      const sub = String(ctx.arg(0) || '').toLowerCase();
      if (['añadir', 'anadir', 'add'].includes(sub)) return addKit(ctx);
      if (['lista', 'list'].includes(sub)) return listKits(ctx);
      if (['borrar', 'del', 'delete', 'remove'].includes(sub)) return delKit(ctx);
      if (['top', 'ranking'].includes(sub)) return top(ctx);
      return startRound(ctx);
    },
  });
  def({
    name: 'camisatop',
    aliases: ['topcamisas', 'shirttop'],
    level: 'public',
    d: 'Ranking of the best shirt guessers',
    es: 'Ranking de los mejores adivinando camisetas',
    async run(ctx) { return top(ctx); },
  });
}

function attach(client) {
  client.on('messageCreate', (m) => onGuess(m).catch(logErr));
}

module.exports = { register, attach };
