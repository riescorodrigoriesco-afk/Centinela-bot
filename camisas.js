'use strict';

/*
 * camisas.js — Juego «CATCH UP!»: el bot manda la camiseta de un equipo y hay que adivinar de qué AÑO es.
 *   $camisa            empieza una ronda (también: $camiseta, $shirt)
 *   $camisatop         ranking de aciertos
 *   $setcamisas [#canal|off]   (o $camisa canal) la camiseta aparece sola cada 10 mensajes en ese canal; $camisa cada <n> cambia el número
 *   $camisa añadir   (adjunta imágenes llamadas «Equipo 2002.png») añade tus propias camisetas reales
 *   $camisa modo real|mixto|dibujadas   elige de dónde salen las camisetas
 *   $camisa lista / $camisa borrar <id>
 * El primero que escribe el año correcto en el canal gana monedas (🪙, las mismas de /daily y los minijuegos).
 * Camisetas incluidas: clubes y diseños originales (ficticios) dibujados por código.
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, SlashCommandBuilder, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');
const games = require('./games');
const kit = require('./kit');

const { L, COLOR, jsonStore, canConfigure, logErr, getCfg, saveCfg } = bot;
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
  const mode = (getCfg(gid).shirts || {}).mode || 'mixed';
  const mine = (store.data[gid] || []).filter((k) => fs.existsSync(k.file));
  const useMine = mode === 'real' ? mine.length > 0 : mode === 'drawn' ? false : mine.length > 0 && Math.random() < 0.5;
  if (mode === 'real' && !mine.length) return null;
  if (useMine) {
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
  const me = ctx.guild.members.me;
  const need = [['ViewChannel', 'Ver canal'], ['SendMessages', 'Enviar mensajes'], ['EmbedLinks', 'Insertar enlaces'], ['AttachFiles', 'Adjuntar archivos']];
  const perms = me && ch.permissionsFor ? ch.permissionsFor(me) : null;
  const missing = perms ? need.filter(([k]) => !perms.has(P[k])) : [];
  if (missing.length) {
    return ctx.reply(L(lc, '❌ I need these permissions in this channel to send the shirt: ', '❌ Necesito estos permisos en este canal para enviar la camiseta: ') + missing.map(([, es]) => '**' + es + '**').join(', '));
  }
  rounds.set(ch.id, { pending: true }); // reserva el canal mientras se dibuja
  try {
    await ctx.defer();
    const k = await pickKit(ctx.guild.id);
    if (!k) {
      rounds.delete(ch.id);
      return ctx.reply(L(lc, '👕 Real-shirts mode is on but you have none yet. Add them with `$camisa add` (attach the images; name each file like `Real Madrid 2002.png`).', '👕 Está el modo «solo reales» pero aún no hay camisetas tuyas. Añádelas con `$camisa añadir` (adjunta las imágenes y nombra cada archivo como `Real Madrid 2002.png`).'));
    }
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
    try {
      if (ctx.kind === 'slash') await ctx.reply({ embeds: [e], files: [{ attachment: k.png, name: k.name }] });
      else await ch.send({ embeds: [e], files: [{ attachment: k.png, name: k.name }] });
    } catch (err) {
      rounds.delete(ch.id);
      logErr('[camisas] no se pudo enviar la camiseta: ' + err.message);
      return ctx.reply(L(lc, '⚠️ I could not send the shirt: ', '⚠️ No pude enviar la camiseta: ') + '`' + String(err.message).slice(0, 180) + '`\n' + L(lc, 'Check my permissions in this channel (**Attach files**, **Embed links**, **Send messages**) and run `/camisa estado`.', 'Revisa mis permisos en este canal (**Adjuntar archivos**, **Insertar enlaces**, **Enviar mensajes**) y usa `/camisa estado`.'));
    }

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

const counters = new Map(); // canal -> mensajes desde la última camiseta
async function onMessage(msg) {
  if (!msg.guild || !msg.author || msg.author.bot) return;
  const r = rounds.get(msg.channelId);
  if (!r) {
    // Camiseta automática: cada N mensajes en el canal elegido con «$camisa canal»
    const cfg = getCfg(msg.guild.id);
    const sh = cfg.shirts || {};
    if (!sh.channel || sh.channel !== msg.channelId) return;
    if (/^[$!.]/.test(msg.content || '')) return; // los comandos no cuentan
    const n = (counters.get(msg.channelId) || 0) + 1;
    if (n < (sh.every || 10)) { counters.set(msg.channelId, n); return; }
    counters.set(msg.channelId, 0);
    const ctx = {
      channel: msg.channel, guild: msg.guild, locale: msg.guild.preferredLocale,
      defer: () => msg.channel.sendTyping().catch(() => {}),
      reply: (p) => msg.channel.send(p),
    };
    return startRound(ctx);
  }
  if (r.pending) return;
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

async function saveImage(gid, att, team, year) {
  const list = store.data[gid] || (store.data[gid] = []);
  const r = await fetch(att.url);
  if (!r.ok) throw new Error('download');
  const buf = Buffer.from(await r.arrayBuffer());
  const id = newId();
  const ext = /png/i.test(att.contentType) ? '.png' : /webp/i.test(att.contentType) ? '.webp' : '.jpg';
  const dir = path.join(DATA_DIR, 'kits');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, gid + '_' + id + ext);
  fs.writeFileSync(file, buf);
  list.push({ id, team: team.slice(0, 60), year, file });
  store.save();
  return id;
}
// «Real Madrid 2002.png» -> { team: 'Real Madrid', year: 2002 }
function parseName(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/((?:19|20)\d{2})[-\/](?:\d{4}|\d{2})(?!\d)/, '$1').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = base.match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  if (!m) return null;
  const team = base.replace(m[1], '').replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return team ? { team, year: parseInt(m[1], 10) } : null;
}

async function addKit(ctx) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const msg = ctx.raw;
  const atts = msg && msg.attachments ? [...msg.attachments.values()] : [];
  const usage = L(lc, 'Attach one or more images. Name each file like `Team name 2002.png` and write `$camisa add`, or one image with `$camisa add Team name | year`.', 'Adjunta una o varias imágenes. Nombra cada archivo como `Nombre del equipo 2002.png` y escribe `$camisa añadir`, o una sola imagen con `$camisa añadir Nombre del equipo | año`.');
  if (!atts.length) return ctx.reply(usage);
  const list = store.data[ctx.guild.id] || (store.data[ctx.guild.id] = []);
  const text = ctx.rest(1);
  const ok = [];
  const bad = [];
  await ctx.defer();
  for (const att of atts) {
    if (list.length >= 100) { bad.push(att.name + ' (' + L(lc, 'limit 100', 'límite 100') + ')'); continue; }
    if (!/^image\/(png|jpe?g|webp)/i.test(att.contentType || '') || att.size > 8 * 1024 * 1024) { bad.push(att.name + ' (' + L(lc, 'not a PNG/JPG/WEBP under 8 MB', 'no es PNG/JPG/WEBP de menos de 8 MB') + ')'); continue; }
    let info = null;
    if (atts.length === 1 && text.includes('|')) {
      const [t, y] = text.split('|').map((x) => x.trim());
      const year = parseInt(y, 10);
      if (t && year >= 1900 && year <= 2035) info = { team: t, year };
    } else info = parseName(att.name);
    if (!info || !(info.year >= 1900 && info.year <= 2035)) { bad.push(att.name + ' (' + L(lc, 'I need team and year in the file name', 'falta equipo y año en el nombre del archivo') + ')'); continue; }
    try { const id = await saveImage(ctx.guild.id, att, info.team, info.year); ok.push(info.team + ' ' + info.year + ' (`' + id + '`)'); } catch (_) { bad.push(att.name + ' (' + L(lc, 'download failed', 'no se pudo descargar') + ')'); }
  }
  return ctx.reply((ok.length ? '✅ ' + L(lc, 'Added ', 'Añadidas ') + ok.length + ': ' + ok.join(', ').slice(0, 1200) : '') + (bad.length ? '\n⚠️ ' + L(lc, 'Skipped: ', 'Omitidas: ') + bad.join(', ').slice(0, 600) : '') + (ok.length ? '\n' + L(lc, 'Tip: `$camisa mode real` makes the game use only your shirts.', 'Consejo: `$camisa modo real` hace que el juego use solo tus camisetas.') : ''));
}

function setChannel(ctx, at) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const cfg = getCfg(ctx.guild.id);
  cfg.shirts = { mode: 'mixed', channel: null, every: 10, ...(cfg.shirts || {}) };
  const raw = String(ctx.arg(at) || '').toLowerCase();
  if (['off', 'apagar', 'quitar', 'no'].includes(raw)) {
    cfg.shirts.channel = null;
    saveCfg();
    return ctx.reply('🔕 ' + L(lc, 'Automatic shirts are off.', 'Las camisetas automáticas están apagadas.'));
  }
  const id = !raw || ['aqui', 'aquí', 'here'].includes(raw) ? ctx.channel.id : ctx.id(at);
  const ch = id && ctx.guild.channels.cache.get(id);
  if (!ch || !ch.isTextBased()) return ctx.reply(L(lc, 'Pick a text channel: `/camisa canal`.', 'Elige un canal de texto: `/camisa canal`.'));
  cfg.shirts.channel = ch.id;
  saveCfg();
  counters.set(ch.id, 0);
  return ctx.reply('✅ ' + L(lc, 'A shirt will appear in <#' + ch.id + '> every **' + (cfg.shirts.every || 10) + '** messages.', 'Aparecerá una camiseta en <#' + ch.id + '> cada **' + (cfg.shirts.every || 10) + '** mensajes.') + '\n' + L(lc, 'Change the number with `/camisa cada`, turn it off with `/camisa apagar`.', 'Cambia el número con `/camisa cada` y apágalo con `/camisa apagar`.'));
}

function setEvery(ctx) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const n = parseInt(ctx.arg(1), 10);
  if (!(n >= 3 && n <= 100)) return ctx.reply(L(lc, 'Use a number from 3 to 100: `$camisa every 10`', 'Usa un número de 3 a 100: `$camisa cada 10`'));
  const cfg = getCfg(ctx.guild.id);
  cfg.shirts = { mode: 'mixed', channel: null, every: 10, ...(cfg.shirts || {}), every: n };
  saveCfg();
  return ctx.reply('✅ ' + L(lc, 'A shirt every **' + n + '** messages.', 'Una camiseta cada **' + n + '** mensajes.'));
}

async function estado(ctx) {
  const lc = ctx.locale;
  const ch = ctx.channel;
  const me = ctx.guild.members.me;
  const perms = me && ch.permissionsFor ? ch.permissionsFor(me) : null;
  const need = [['ViewChannel', 'Ver canal'], ['SendMessages', 'Enviar mensajes'], ['EmbedLinks', 'Insertar enlaces'], ['AttachFiles', 'Adjuntar archivos'], ['AddReactions', 'Añadir reacciones'], ['ReadMessageHistory', 'Leer historial']];
  const lines = need.map(([k, es]) => (perms ? (perms.has(P[k]) ? '✅ ' : '❌ ') : '❓ ') + es);
  const cfg = getCfg(ctx.guild.id);
  const sh = cfg.shirts || {};
  const mine = (store.data[ctx.guild.id] || []).length;
  let draw = '—';
  try { const t0 = Date.now(); const r = await kit.randomKit(); draw = '✅ ' + (Date.now() - t0) + ' ms · ' + Math.round(r.png.length / 1024) + ' KB'; } catch (e) { draw = '❌ ' + e.message; }
  const e = new EmbedBuilder().setColor(COLOR.blue || 0x3498db).setTitle('🩺 ' + L(lc, 'Shirt game status', 'Estado del juego de camisetas'))
    .setDescription('**' + L(lc, 'Permissions in this channel', 'Permisos en este canal') + '**\n' + lines.join('\n') + '\n\n**' + L(lc, 'Drawing a shirt', 'Dibujar una camiseta') + ':** ' + draw + '\n**' + L(lc, 'Auto channel', 'Canal automático') + ':** ' + (sh.channel ? '<#' + sh.channel + '> · ' + L(lc, 'every ', 'cada ') + (sh.every || 10) : L(lc, 'off', 'apagado')) + '\n**' + L(lc, 'Mode', 'Modo') + ':** ' + (sh.mode || 'mixed') + ' · ' + L(lc, 'your shirts: ', 'tus camisetas: ') + mine);
  return ctx.reply({ embeds: [e] });
}

function setMode(ctx) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const raw = String(ctx.arg(1) || '').toLowerCase();
  const map = { real: 'real', reales: 'real', mixto: 'mixed', mixed: 'mixed', mix: 'mixed', dibujadas: 'drawn', drawn: 'drawn', ficticias: 'drawn' };
  const cfg = getCfg(ctx.guild.id);
  if (!map[raw]) return ctx.reply(L(lc, 'Current mode: **', 'Modo actual: **') + (cfg.shirts || {}).mode + '**\n`real` — ' + L(lc, 'only your shirts', 'solo tus camisetas') + '\n`mixto` — ' + L(lc, 'yours and drawn ones', 'las tuyas y las dibujadas') + '\n`dibujadas` — ' + L(lc, 'only the drawn (fictional) ones', 'solo las dibujadas (ficticias)') + '\n' + L(lc, 'Change it: `$camisa mode <real|mixed|drawn>`', 'Cámbialo: `$camisa modo <real|mixto|dibujadas>`'));
  cfg.shirts = { ...(cfg.shirts || {}), mode: map[raw] };
  saveCfg();
  return ctx.reply('✅ ' + L(lc, 'Mode set to **', 'Modo: **') + map[raw] + '**');
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


/* ============================ comandos con barra: /camisa ============================ */
const idOf = (s) => { const m = String(s || '').match(/(\d{15,25})/); return m ? m[1] : null; };
function slashCtx(i, args) {
  const send = (p) => {
    const payload = typeof p === 'string' ? { content: p } : { ...p };
    payload.allowedMentions = { parse: [], ...(payload.allowedMentions || {}) };
    return i.deferred || i.replied ? i.editReply(payload) : i.reply(payload);
  };
  return {
    kind: 'slash', raw: null, guild: i.guild, member: i.member, user: i.user, channel: i.channel, locale: i.locale, args,
    arg: (n) => args[n], id: (n) => idOf(args[n]), rest: (n) => args.slice(n).join(' '),
    defer: async () => { if (!i.deferred && !i.replied) await i.deferReply(); },
    reply: send,
  };
}

async function addFromSlash(i) {
  const ctx = slashCtx(i, []);
  const lc = ctx.locale;
  if (!canConfigure(i.guild, i.user.id, i.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  await ctx.defer();
  const att = i.options.getAttachment('imagen');
  const team = i.options.getString('equipo');
  const year = i.options.getInteger('año');
  const list = store.data[i.guild.id] || (store.data[i.guild.id] = []);
  if (list.length >= 100) return ctx.reply(L(lc, '❌ Limit reached (100 shirts).', '❌ Límite alcanzado (100 camisetas).'));
  if (!/^image\/(png|jpe?g|webp)/i.test(att.contentType || '') || att.size > 8 * 1024 * 1024) return ctx.reply(L(lc, '❌ It must be a PNG, JPG or WEBP image under 8 MB.', '❌ Debe ser una imagen PNG, JPG o WEBP de menos de 8 MB.'));
  try {
    const id = await saveImage(i.guild.id, att, team, year);
    return ctx.reply('✅ ' + L(lc, 'Added ', 'Añadida ') + '**' + team + ' ' + year + '** (`' + id + '`)');
  } catch (_) {
    return ctx.reply(L(lc, '❌ I could not download the image.', '❌ No pude descargar la imagen.'));
  }
}

function makeSlash() {
  return {
  data: new SlashCommandBuilder().setName('camisa').setDescription('CATCH UP! Guess the year of a football shirt and win coins')
    .setDescriptionLocalizations({ 'es-ES': '¡CATCH UP! Adivina de qué año es la camiseta y gana monedas', 'es-419': '¡CATCH UP! Adivina de qué año es la camiseta y gana monedas' })
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('jugar').setDescription('Start a round').setDescriptionLocalizations({ 'es-ES': 'Empieza una ronda', 'es-419': 'Empieza una ronda' }))
    .addSubcommand((s) => s.setName('top').setDescription('Best shirt guessers').setDescriptionLocalizations({ 'es-ES': 'Ranking de aciertos', 'es-419': 'Ranking de aciertos' }))
    .addSubcommand((s) => s.setName('canal').setDescription('Channel where a shirt appears every N messages').setDescriptionLocalizations({ 'es-ES': 'Canal donde aparece una camiseta cada N mensajes', 'es-419': 'Canal donde aparece una camiseta cada N mensajes' })
      .addChannelOption((o) => o.setName('canal').setDescription('Text channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('apagar').setDescription('Turn off automatic shirts').setDescriptionLocalizations({ 'es-ES': 'Apaga las camisetas automáticas', 'es-419': 'Apaga las camisetas automáticas' }))
    .addSubcommand((s) => s.setName('cada').setDescription('Show a shirt every N messages (3-100)').setDescriptionLocalizations({ 'es-ES': 'Una camiseta cada N mensajes (3-100)', 'es-419': 'Una camiseta cada N mensajes (3-100)' })
      .addIntegerOption((o) => o.setName('mensajes').setDescription('Messages').setRequired(true).setMinValue(3).setMaxValue(100)))
    .addSubcommand((s) => s.setName('modo').setDescription('Where the shirts come from').setDescriptionLocalizations({ 'es-ES': 'De dónde salen las camisetas', 'es-419': 'De dónde salen las camisetas' })
      .addStringOption((o) => o.setName('modo').setDescription('Mode').setRequired(true).addChoices({ name: 'Solo reales (las tuyas) / Real only', value: 'real' }, { name: 'Mixto / Mixed', value: 'mixto' }, { name: 'Solo dibujadas / Drawn only', value: 'dibujadas' })))
    .addSubcommand((s) => s.setName('agregar').setDescription('Add your own shirt image').setDescriptionLocalizations({ 'es-ES': 'Añade una camiseta tuya (imagen)', 'es-419': 'Añade una camiseta tuya (imagen)' })
      .addAttachmentOption((o) => o.setName('imagen').setDescription('Shirt image').setRequired(true))
      .addStringOption((o) => o.setName('equipo').setDescription('Team name').setRequired(true).setMaxLength(60))
      .addIntegerOption((o) => o.setName('año').setDescription('Year').setRequired(true).setMinValue(1900).setMaxValue(2035)))
    .addSubcommand((s) => s.setName('estado').setDescription('Check permissions and that the game works').setDescriptionLocalizations({ 'es-ES': 'Comprueba permisos y que el juego funciona', 'es-419': 'Comprueba permisos y que el juego funciona' }))
    .addSubcommand((s) => s.setName('lista').setDescription('List your added shirts').setDescriptionLocalizations({ 'es-ES': 'Lista tus camisetas añadidas', 'es-419': 'Lista tus camisetas añadidas' }))
    .addSubcommand((s) => s.setName('borrar').setDescription('Remove one of your added shirts').setDescriptionLocalizations({ 'es-ES': 'Borra una camiseta añadida', 'es-419': 'Borra una camiseta añadida' })
      .addStringOption((o) => o.setName('id').setDescription('Shirt id (see /camisa lista)').setRequired(true))),
  async execute(i) {
    if (!i.guild) return;
    const sub = i.options.getSubcommand();
    if (sub === 'agregar') return addFromSlash(i);
    const args = [sub];
    if (sub === 'canal') args.push('<#' + i.options.getChannel('canal').id + '>');
    if (sub === 'cada') args.push(String(i.options.getInteger('mensajes')));
    if (sub === 'modo') args.push(i.options.getString('modo'));
    if (sub === 'borrar') args.push(i.options.getString('id'));
    if (sub === 'apagar') { args[0] = 'canal'; args.push('off'); }
    const ctx = slashCtx(i, args);
    if (sub === 'jugar') return startRound(ctx);
    if (sub === 'top') return top(ctx);
    if (sub === 'estado') { await ctx.defer(); return estado(ctx); }
    if (sub === 'canal' || sub === 'apagar') return setChannel(ctx, 1);
    if (sub === 'cada') return setEvery(ctx);
    if (sub === 'modo') return setMode(ctx);
    if (sub === 'lista') return listKits(ctx);
    if (sub === 'borrar') return delKit(ctx);
  },
  };
}
// Si el comando de barra tuviera algún fallo de formato, se desactiva él solo y el bot sigue normal
let camisaSlash = null;
try {
  camisaSlash = makeSlash();
  camisaSlash.data.toJSON();
} catch (e) {
  camisaSlash = null;
  console.error('[camisas] /camisa no disponible: ' + e.message);
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
      if (['estado', 'status', 'diag'].includes(sub)) return estado(ctx);
      if (['modo', 'mode'].includes(sub)) return setMode(ctx);
      if (['canal', 'channel', 'setchannel'].includes(sub)) return setChannel(ctx, 1);
      if (['cada', 'every'].includes(sub)) return setEvery(ctx);
      return startRound(ctx);
    },
  });
  def({
    name: 'setcamisas',
    aliases: ['setcamisa', 'camisacanal', 'setchannelcamisas'],
    level: 'cfg',
    perm: P.ManageGuild,
    d: 'Set the channel where a shirt appears every 10 messages',
    es: 'Elige el canal donde aparece una camiseta cada 10 mensajes',
    async run(ctx) { return setChannel(ctx, 0); },
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
  client.on('messageCreate', (m) => onMessage(m).catch(logErr));
}

module.exports = { register, attach, commands: camisaSlash ? [camisaSlash] : [] };
