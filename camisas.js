'use strict';

/*
 * camisas.js — Juego «CATCH UP!» (estilo BallsDex): aparece una camiseta REAL de un club y hay que atraparla.
 *   El bot manda la foto con el botón «Catch me»; se pulsa, se escribe el club y el año, y se ganan monedas 🪙.
 *   La camiseta atrapada pasa a tu COLECCIÓN y se puede intercambiar con otros.
 *
 * Comandos de barra (solo estos):
 *   /setchannel [canal]   elige el canal, saca una camiseta YA y sigue saliendo siempre cada N mensajes (se guarda)
 *   /coleccion [usuario]  tus camisetas atrapadas (con fotos y páginas)
 *   /intercambio          cambia una camiseta tuya por una de otra persona (con autocompletado y confirmación)
 *   /ajustes              cada cuántos mensajes, modo, encender/apagar y estado del juego
 * Con prefijo siguen: $camisa (ronda ahora, añadir/lista/borrar fotos propias), $camisatop, $setcamisas
 * Fotos reales: las busca photos.js en Wikimedia Commons / Openverse (y Google si hay clave) con crédito al autor.
 * Las «dibujadas» son clubes ficticios hechos por código (solo en modo mixto o dibujadas).
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, SlashCommandBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');
const games = require('./games');
const kit = require('./kit');
const photos = require('./photos');
const dbstore = (() => { try { return require('./dbstore'); } catch (_) { return null; } })();

const { L, COLOR, jsonStore, canConfigure, logErr, getCfg, saveCfg } = bot;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const store = jsonStore('kits.json', () => ({}));
const EPH = MessageFlags.Ephemeral;

const ROUND_MS = 60000;
const HINT1_MS = 22000;
const HINT2_MS = 42000;
const BASE = 100; // por acertar el club
const MAX_GUESSES = 3;
const rounds = new Map(); // canal -> ronda
const byId = new Map(); // id de ronda -> ronda

const newId = () => Math.random().toString(36).slice(2, 8);
const decade = (y) => Math.floor(y / 10) * 10;
const clip = (s, n) => String(s == null ? '' : s).replace(/[*_`~|>@]/g, '').slice(0, n);
const lbl = (k) => k.team + ' · ' + k.season;
const creditLine = (k) => (k.credit ? '\n📷 ' + clip(k.credit.text, 120) + (k.credit.url ? ' — <' + k.credit.url + '>' : '') : '');

/* ============================ acertar club y año ============================ */
const GEN_START = /^(fc|cf|ac|as|sc|cd|ud|sd|ss|us|rc|afc|club|clube|the) /;
const GEN_END = / (fc|cf|cd|sc)$/;
function aliasSet(k) {
  const out = new Set();
  for (const a of [k.team, ...(k.aliases || [])]) {
    const base = String(a || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (const v of [base, base.replace(GEN_START, ''), base.replace(GEN_END, ''), base.replace(GEN_START, '').replace(GEN_END, '')]) {
      const n = v.replace(/ /g, '');
      if (n.length >= 2) out.add(n);
    }
  }
  return out;
}
function clubOk(guess, k) {
  const g = photos.norm(guess);
  if (g.length < 2) return false;
  if ((k.not || []).some((n) => g.includes(n))) return false;
  for (const a of aliasSet(k)) {
    if (g === a) return true;
    if (a.length >= 5 && g.includes(a)) return true;
    if (g.length >= 7 && a.startsWith(g)) return true;
  }
  return false;
}
function yearPts(y, k) {
  const d = Math.min(Math.abs(y - k.year), Math.abs(y - (k.year2 || k.year)));
  return d === 0 ? 100 : d === 1 ? 60 : d === 2 ? 40 : d <= 5 ? 15 : 0;
}

/* ============================ elegir camiseta ============================ */
async function drawnKit() {
  const r = await kit.randomKit();
  return { team: r.team, aliases: [], year: r.year, year2: r.year, season: String(r.year), png: r.png, name: 'camiseta.png', credit: null };
}
async function pickKit(gid) {
  const mode = (getCfg(gid).shirts || {}).mode || 'real';
  if (mode === 'drawn') return drawnKit();
  const mine = (store.data[gid] || []).filter((k) => fs.existsSync(k.file));
  const own = () => {
    const k = mine[Math.floor(Math.random() * mine.length)];
    return { team: k.team, aliases: [], year: k.year, year2: k.year, season: String(k.year), png: fs.readFileSync(k.file), name: 'camiseta' + path.extname(k.file), credit: null };
  };
  if (mine.length && Math.random() < 0.4) return own();
  const w = await photos.pick(gid).catch((e) => { logErr('[camisas] fotos: ' + e.message); return null; });
  if (w) return { ...w, not: (w.not || []) };
  if (mine.length) return own();
  return mode === 'mixed' ? drawnKit() : null;
}

/* ============================ ronda ============================ */
async function startRound(ctx) {
  const ch = ctx.channel;
  const lc = ctx.locale;
  if (rounds.has(ch.id)) return ctx.reply(L(lc, '👕 There is already a shirt in play in this channel!', '👕 ¡Ya hay una camiseta en juego en este canal!'));
  const me = ctx.guild.members.me;
  const need = [['ViewChannel', 'Ver canal'], ['SendMessages', 'Enviar mensajes'], ['AttachFiles', 'Adjuntar archivos']];
  const perms = me && ch.permissionsFor ? ch.permissionsFor(me) : null;
  const missing = perms ? need.filter(([k]) => !perms.has(P[k])) : [];
  if (missing.length) {
    return ctx.reply(L(lc, '❌ I need these permissions in this channel to send the shirt: ', '❌ Necesito estos permisos en este canal para enviar la camiseta: ') + missing.map(([, es]) => '**' + es + '**').join(', '));
  }
  rounds.set(ch.id, { pending: true }); // reserva el canal mientras se busca la foto
  try {
    await ctx.defer();
    const k = await pickKit(ctx.guild.id);
    if (!k) {
      rounds.delete(ch.id);
      return ctx.reply(L(lc, '📷 I could not find a real shirt photo right now (the free photo sources are slow or have none). Try again in a few seconds, or add your own with `$camisa add`.', '📷 Ahora mismo no encontré una foto real de camiseta (las fuentes gratuitas tardan o no tienen). Prueba otra vez en unos segundos, o añade las tuyas con `$camisa añadir`.'));
    }
    const id = newId();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('camisa:c:' + id).setLabel('Catch me').setStyle(ButtonStyle.Primary));
    let sent;
    try {
      sent = await ch.send({
        content: '⚡ **CATCH UP!** ' + L(lc, 'A wild shirt appeared!', '¡Ha aparecido una camiseta salvaje!') + ' 👕\n💡 ' + L(lc, 'Press **Catch me** and tell me the club and the year.', 'Pulsa **Catch me** y dime el club y el año.'),
        files: [{ attachment: k.png, name: k.name }], components: [row], allowedMentions: { parse: [] },
      });
    } catch (err) {
      rounds.delete(ch.id);
      logErr('[camisas] no se pudo enviar la camiseta: ' + err.message);
      return ctx.reply(L(lc, '⚠️ I could not send the shirt: ', '⚠️ No pude enviar la camiseta: ') + '`' + String(err.message).slice(0, 180) + '`\n' + L(lc, 'Check my permissions in this channel (**Attach files**, **Send messages**) and run `/ajustes`.', 'Revisa mis permisos en este canal (**Adjuntar archivos**, **Enviar mensajes**) y usa `/ajustes`.'));
    }
    if (ctx.done) await ctx.done();

    const r = { id, gid: ctx.guild.id, kit: k, t0: Date.now(), guesses: new Map(), lc, channel: ch, msg: sent, timers: [], closed: false };
    rounds.set(ch.id, r);
    byId.set(id, r);
    r.timers.push(setTimeout(() => ch.send({ content: L(lc, '💡 Hint: it is from the **' + decade(k.year) + 's**.', '💡 Pista: es de los **años ' + decade(k.year) + '**.'), allowedMentions: { parse: [] } }).catch(() => {}), HINT1_MS));
    r.timers.push(setTimeout(() => ch.send({ content: L(lc, '💡 Second hint: the club starts with **' + clip(k.team, 1).toUpperCase() + '**.', '💡 Segunda pista: el club empieza por **' + clip(k.team, 1).toUpperCase() + '**.'), allowedMentions: { parse: [] } }).catch(() => {}), HINT2_MS));
    r.timers.push(setTimeout(() => timeUp(r), ROUND_MS));
  } catch (e) {
    rounds.delete(ch.id);
    throw e;
  }
}

// Cierra la ronda y deja el mensaje con el resultado (sin botón)
function finish(r, text) {
  if (r.closed) return;
  r.closed = true;
  for (const t of r.timers) clearTimeout(t);
  if (rounds.get(r.channel.id) === r) rounds.delete(r.channel.id);
  byId.delete(r.id);
  if (r.msg && r.msg.edit) r.msg.edit({ content: String(text).slice(0, 1900), components: [], allowedMentions: { parse: [] } }).catch(() => {});
}

function timeUp(r) {
  if (r.closed) return;
  // Nadie acertó: se rompen las rachas de quien lo intentó
  for (const uid of r.guesses.keys()) {
    const a = games.acct(r.gid, uid);
    if (a.shirt) a.shirt.streak = 0;
  }
  games.eco.save();
  finish(r, '⏱️ ' + L(r.lc, 'Time is up! Nobody caught it. It was **', '¡Se acabó el tiempo! Nadie la atrapó. Era **') + lbl(r.kit) + '**' + creditLine(r.kit));
}

/* ============================ botón «Catch me» y cuadro de respuesta ============================ */
const owns = (i) => !!(i && i.customId && String(i.customId).startsWith('camisa:') && ((i.isButton && i.isButton()) || (i.isModalSubmit && i.isModalSubmit())));

async function handleInteraction(i) {
  const [, kind, id] = String(i.customId).split(':');
  const lc = i.locale;
  if (kind === 'v') return viewCollection(i);
  if (kind === 't') return tradeButton(i);
  const r = byId.get(id);
  if (!r || r.closed) return i.reply({ content: L(lc, '⌛ This shirt is gone. Wait for the next one!', '⌛ Esta camiseta ya no está. ¡Espera a la siguiente!'), flags: EPH });
  if (kind === 'c') {
    if ((r.guesses.get(i.user.id) || 0) >= MAX_GUESSES) return i.reply({ content: L(lc, 'No more tries for you on this shirt.', 'Ya no te quedan intentos con esta camiseta.'), flags: EPH });
    const modal = new ModalBuilder().setCustomId('camisa:m:' + id).setTitle(L(lc, 'Which shirt is this?', '¿De qué camiseta se trata?')).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('club').setLabel(L(lc, 'Club or team', 'Club o equipo')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60).setPlaceholder('Real Madrid')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('year').setLabel(L(lc, 'Year of the shirt (e.g. 2002)', 'Año de la camiseta (ej. 2002)')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(9).setPlaceholder('2002')),
    );
    return i.showModal(modal);
  }
  if (kind === 'm') return onSubmit(i, r);
}

async function onSubmit(i, r) {
  const lc = r.lc;
  const club = i.fields.getTextInputValue('club');
  let yearTxt = '';
  try { yearTxt = i.fields.getTextInputValue('year') || ''; } catch (_) { /* campo vacío */ }
  const n = (r.guesses.get(i.user.id) || 0) + 1;
  if (n > MAX_GUESSES) return i.reply({ content: L(lc, 'No more tries for you on this shirt.', 'Ya no te quedan intentos con esta camiseta.'), flags: EPH });
  r.guesses.set(i.user.id, n);

  if (!clubOk(club, r.kit)) {
    const left = MAX_GUESSES - n;
    return i.reply({ content: '❌ ' + L(lc, '**' + clip(club, 40) + '** is not the club. ', '**' + clip(club, 40) + '** no es el club. ') + (left ? L(lc, 'Tries left: ', 'Intentos que te quedan: ') + left : L(lc, 'No more tries for you.', 'Ya no te quedan intentos.')), flags: EPH });
  }

  // ¡Atrapada! (todo síncrono hasta cerrar la ronda para que solo gane uno)
  if (r.closed) return i.reply({ content: L(lc, '⌛ Someone was faster than you!', '⌛ ¡Alguien se te adelantó!'), flags: EPH });
  const m = String(yearTxt).match(/(?:19|20)\d{2}/);
  const gy = m ? parseInt(m[0], 10) : null;
  const yp = gy ? yearPts(gy, r.kit) : 0;
  const left = Math.max(0, ROUND_MS - (Date.now() - r.t0));
  const speed = Math.round(50 * (left / ROUND_MS));
  const a = games.acct(r.gid, i.user.id);
  a.shirt = a.shirt || { wins: 0, streak: 0, best: 0 };
  a.shirt.wins++;
  a.shirt.streak++;
  a.shirt.best = Math.max(a.shirt.best, a.shirt.streak);
  const streakBonus = Math.min(50, (a.shirt.streak - 1) * 10);
  const total = BASE + yp + speed + streakBonus;
  a.coins += total;
  games.eco.save();
  addToCollection(r.gid, i.user.id, r.kit);
  finish(r, '✅ **' + lbl(r.kit) + '** — ' + L(lc, 'caught by ', 'atrapada por ') + '<@' + i.user.id + '>' + creditLine(r.kit));

  const yearLine = gy
    ? '📅 ' + L(lc, 'Your year: ', 'Tu año: ') + gy + ' → ' + L(lc, 'it was ', 'era ') + '**' + r.kit.season + '** (+' + yp + ')'
    : '📅 ' + L(lc, 'You did not give a year (it was **', 'No pusiste año (era **') + r.kit.season + '**) (+0)';
  const e = new EmbedBuilder().setColor(COLOR.green || 0x2ecc71).setTitle('🏆 CATCH UP!')
    .setDescription(
      '<@' + i.user.id + '> ' + L(lc, 'caught **' + lbl(r.kit) + '**!', '¡atrapó **' + lbl(r.kit) + '**!') + '\n' + yearLine + '\n\n' +
      '**+' + games.coinsTxt(total) + '**  (' + L(lc, 'club ', 'club ') + BASE + (yp ? ' + ' + L(lc, 'year ', 'año ') + yp : '') + ' + ' + L(lc, 'speed ', 'rapidez ') + speed + (streakBonus ? ' + ' + L(lc, 'streak ', 'racha ') + streakBonus : '') + ')\n' +
      '🔥 ' + L(lc, 'Streak: ', 'Racha: ') + a.shirt.streak + ' · ' + L(lc, 'Wins: ', 'Aciertos: ') + a.shirt.wins + '\n' +
      L(lc, 'Balance: ', 'Saldo: ') + games.coinsTxt(a.coins) + '\n📦 ' + L(lc, 'Added to your collection: `/coleccion`', 'Añadida a tu colección: `/coleccion`')
    );
  return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
}

/* ============================ camiseta automática ============================ */
const counters = new Map(); // canal -> mensajes desde la última camiseta
async function onMessage(msg) {
  if (!msg.guild || !msg.author || msg.author.bot) return;
  if (rounds.has(msg.channelId)) return; // ya hay una camiseta en juego (se responde con el botón)
  // Cada N mensajes en el canal elegido con «/setchannel»
  const cfg = getCfg(msg.guild.id);
  const sh = cfg.shirts || {};
  if (!sh.channel || sh.channel !== msg.channelId || sh.on === false) return;
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
  try { if (dbstore) dbstore.mirrorFile(path.relative(DATA_DIR, file), buf); } catch (_) { /* sin base */ }
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
  return ctx.reply((ok.length ? '✅ ' + L(lc, 'Added ', 'Añadidas ') + ok.length + ': ' + ok.join(', ').slice(0, 1200) : '') + (bad.length ? '\n⚠️ ' + L(lc, 'Skipped: ', 'Omitidas: ') + bad.join(', ').slice(0, 600) : '') + (ok.length ? '\n' + L(lc, 'Your shirts will show up between the real photos from the internet.', 'Tus camisetas saldrán entre las fotos reales de internet.') : ''));
}

// Activa el juego automático en un canal: se guarda para siempre y saca una camiseta ahora mismo
async function activate(ctx, ch) {
  const lc = ctx.locale;
  const cfg = getCfg(ctx.guild.id);
  cfg.shirts = { mode: 'real', channel: null, every: 10, ...(cfg.shirts || {}), channel: ch.id, on: true };
  saveCfg();
  counters.set(ch.id, 0);
  await ctx.reply('✅ ' + L(lc, 'Done! A shirt is coming now, and then one will appear in <#' + ch.id + '> every **' + (cfg.shirts.every || 10) + '** messages, for good (it is saved). Adjust it with `/ajustes`.', '¡Listo! Sale una camiseta ahora y luego aparecerá otra en <#' + ch.id + '> cada **' + (cfg.shirts.every || 10) + '** mensajes, para siempre (queda guardado). Ajústalo con `/ajustes`.'));
  return startRound({ ...ctx, channel: ch, defer: async () => {}, done: undefined });
}

async function setChannel(ctx, at) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const cfg = getCfg(ctx.guild.id);
  cfg.shirts = { mode: 'real', channel: null, every: 10, ...(cfg.shirts || {}) };
  const raw = String(ctx.arg(at) || '').toLowerCase();
  if (['off', 'apagar', 'quitar', 'no'].includes(raw)) {
    cfg.shirts.channel = null;
    saveCfg();
    return ctx.reply('🔕 ' + L(lc, 'Automatic shirts are off.', 'Las camisetas automáticas están apagadas.'));
  }
  const id = !raw || ['aqui', 'aquí', 'here'].includes(raw) ? ctx.channel.id : ctx.id(at);
  const ch = id && ctx.guild.channels.cache.get(id);
  if (!ch || !ch.isTextBased()) return ctx.reply(L(lc, 'Pick a text channel: `/setchannel`.', 'Elige un canal de texto: `/setchannel`.'));
  return activate(ctx, ch);
}

function setEvery(ctx) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const n = parseInt(ctx.arg(1), 10);
  if (!(n >= 3 && n <= 100)) return ctx.reply(L(lc, 'Use a number from 3 to 100: `$camisa every 10`', 'Usa un número de 3 a 100: `$camisa cada 10`'));
  const cfg = getCfg(ctx.guild.id);
  cfg.shirts = { mode: 'real', channel: null, every: 10, ...(cfg.shirts || {}), every: n };
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
  if (photos.stats().pool < 3) await photos.warm(2, 9000).catch(() => {});
  const ps = photos.stats();
  const pv = ps.providers;
  const real = '📸 ' + ps.pool + ' ' + L(lc, 'real photos ready', 'fotos reales listas') + ' (' + ps.clubs + ' ' + L(lc, 'clubs', 'clubes') + ')\nSerper: ' + (pv.serper.enabled ? pv.serper.n + (pv.serper.err ? ' ⚠️ ' + pv.serper.err : '') : L(lc, 'no key', 'sin clave')) + ' · Commons: ' + pv.commons.n + (pv.commons.err ? ' ⚠️ ' + pv.commons.err : '') + ' · Openverse: ' + pv.openverse.n + (pv.openverse.err ? ' ⚠️ ' + pv.openverse.err : '') + ' · Google: ' + (pv.google.enabled ? pv.google.n + (pv.google.err ? ' ⚠️ ' + pv.google.err : '') : L(lc, 'no key', 'sin clave'));
  const e = new EmbedBuilder().setColor(COLOR.blue || 0x3498db).setTitle('🩺 ' + L(lc, 'Shirt game status', 'Estado del juego de camisetas'))
    .setDescription('**' + L(lc, 'Permissions in this channel', 'Permisos en este canal') + '**\n' + lines.join('\n') + '\n\n**' + L(lc, 'Real photos', 'Fotos reales') + ':** ' + real + '\n**' + L(lc, 'Drawing a shirt', 'Dibujar una camiseta') + ':** ' + draw + '\n**' + L(lc, 'Auto channel', 'Canal automático') + ':** ' + (sh.channel ? '<#' + sh.channel + '> · ' + L(lc, 'every ', 'cada ') + (sh.every || 10) : L(lc, 'off', 'apagado')) + '\n**' + L(lc, 'Mode', 'Modo') + ':** ' + (sh.mode || 'real') + ' · ' + L(lc, 'your shirts: ', 'tus camisetas: ') + mine);
  return ctx.reply({ embeds: [e] });
}

function setMode(ctx) {
  const lc = ctx.locale;
  if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return ctx.reply(L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  const raw = String(ctx.arg(1) || '').toLowerCase();
  const map = { real: 'real', reales: 'real', mixto: 'mixed', mixed: 'mixed', mix: 'mixed', dibujadas: 'drawn', drawn: 'drawn', ficticias: 'drawn' };
  const cfg = getCfg(ctx.guild.id);
  if (!map[raw]) return ctx.reply(L(lc, 'Current mode: **', 'Modo actual: **') + (cfg.shirts || {}).mode + '**\n`real` — ' + L(lc, 'real photos from the internet (+ yours)', 'fotos reales de internet (+ las tuyas)') + '\n`mixto` — ' + L(lc, 'real photos, drawn ones if none is found', 'fotos reales; dibujadas si no hay ninguna') + '\n`dibujadas` — ' + L(lc, 'only the drawn (fictional) ones', 'solo las dibujadas (ficticias)') + '\n' + L(lc, 'Change it: `$camisa mode <real|mixed|drawn>`', 'Cámbialo: `$camisa modo <real|mixto|dibujadas>`'));
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
  try { if (dbstore) dbstore.removeFile(path.relative(DATA_DIR, list[i].file)); } catch (_) { /* sin base */ }
  list.splice(i, 1);
  store.save();
  return ctx.reply('🗑️ ' + L(lc, 'Removed.', 'Eliminada.'));
}


/* ============================ colección ============================ */
const col = jsonStore('collection.json', () => ({})); // servidor -> usuario -> [camisetas atrapadas]
const MAX_COL = 500;
const mineOf = (gid, uid) => (col.data[gid] && col.data[gid][uid]) || [];

function addToCollection(gid, uid, k) {
  const g = col.data[gid] || (col.data[gid] = {});
  const list = g[uid] || (g[uid] = []);
  let id = newId();
  while (list.some((x) => x.id === id)) id = newId();
  const item = {
    id, team: String(k.team).slice(0, 60), season: String(k.season), year: k.year, url: k.url || null,
    page: (k.credit && k.credit.url) || null, credit: k.credit ? String(k.credit.text).slice(0, 120) : null, at: Date.now(),
  };
  list.unshift(item);
  if (list.length > MAX_COL) list.length = MAX_COL;
  col.save();
  return item;
}

function cardEmbed(lc, ownerId, list, idx) {
  const it = list[idx];
  const uniq = new Set(list.map((x) => x.team + '|' + x.season)).size;
  const e = new EmbedBuilder().setColor(COLOR.blue || 0x3498db)
    .setTitle('👕 ' + lbl(it))
    .setDescription('<@' + ownerId + '>\n' + L(lc, 'Caught ', 'Atrapada ') + '<t:' + Math.floor(it.at / 1000) + ':R>\n🆔 `' + it.id + '`' +
      (it.credit ? '\n📷 ' + clip(it.credit, 120) + (it.page ? ' — <' + it.page + '>' : '') : ''))
    .setFooter({ text: (idx + 1) + '/' + list.length + ' · ' + L(lc, 'unique: ', 'únicas: ') + uniq });
  if (it.url) e.setImage(it.url);
  return e;
}

function navRow(ownerId, idx, n, viewerId) {
  const id = (k) => 'camisa:v:' + ownerId + ':' + k + ':' + viewerId;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id(Math.max(0, idx - 1))).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(idx <= 0),
    new ButtonBuilder().setCustomId(id(Math.min(n - 1, idx + 1))).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(idx >= n - 1),
  );
}

async function viewCollection(i) {
  const [, , ownerId, idxS, viewerId] = String(i.customId).split(':');
  const lc = i.locale;
  if (i.user.id !== viewerId) return i.reply({ content: L(lc, 'Only the person who opened this can flip the pages. Use `/coleccion`.', 'Solo quien abrió esto puede pasar las páginas. Usa `/coleccion`.'), flags: EPH });
  const list = mineOf(i.guildId, ownerId);
  if (!list.length) return i.update({ content: L(lc, 'Empty collection.', 'Colección vacía.'), embeds: [], components: [] });
  const idx = Math.max(0, Math.min(list.length - 1, parseInt(idxS, 10) || 0));
  return i.update({ embeds: [cardEmbed(lc, ownerId, list, idx)], components: list.length > 1 ? [navRow(ownerId, idx, list.length, viewerId)] : [] });
}

/* ============================ intercambio ============================ */
const trades = new Map(); // id -> { gid, from, to, A, B, timer }
const TRADE_MS = 300000;

function swap(gid, uA, idA, uB, idB) {
  const la = mineOf(gid, uA);
  const lb = mineOf(gid, uB);
  const ia = la.findIndex((x) => x.id === idA);
  const ib = lb.findIndex((x) => x.id === idB);
  if (ia < 0 || ib < 0) return null;
  const [a] = la.splice(ia, 1);
  const [b] = lb.splice(ib, 1);
  const give = (list, it) => { let id = it.id; while (list.some((x) => x.id === id)) id = newId(); return { ...it, id, at: Date.now() }; };
  la.unshift(give(la, b));
  lb.unshift(give(lb, a));
  col.save();
  return { a, b };
}

function tradeEmbed(lc, t, state) {
  const color = state === 'ok' ? (COLOR.green || 0x2ecc71) : state ? (COLOR.red || 0xed4245) : (COLOR.blue || 0x3498db);
  const tail = state === 'ok' ? '✅ ' + L(lc, 'Trade done!', '¡Intercambio hecho!')
    : state === 'no' ? '✖️ ' + L(lc, 'Trade rejected.', 'Intercambio rechazado.')
      : state === 'exp' ? '⌛ ' + L(lc, 'Trade expired.', 'El intercambio caducó.')
        : state === 'gone' ? '⚠️ ' + L(lc, 'One of the shirts is no longer available.', 'Una de las camisetas ya no está disponible.')
          : L(lc, '<@' + t.to + '>, do you accept?', '<@' + t.to + '>, ¿aceptas?');
  const e = new EmbedBuilder().setColor(color).setTitle('🔄 ' + L(lc, 'Shirt trade', 'Intercambio de camisetas'))
    .setDescription('<@' + t.from + '> ' + L(lc, 'offers', 'ofrece') + ' **' + lbl(t.A) + '**\n<@' + t.to + '> ' + L(lc, 'would give', 'daría') + ' **' + lbl(t.B) + '**\n\n' + tail);
  if (t.A.url) e.setThumbnail(t.A.url);
  if (t.B.url) e.setImage(t.B.url);
  return e;
}

async function tradeButton(i) {
  const [, , act, id] = String(i.customId).split(':');
  const lc = i.locale;
  const t = trades.get(id);
  if (!t) return i.update({ components: [] }).catch(() => {});
  if (act === 'y' && i.user.id !== t.to) return i.reply({ content: L(lc, 'Only the person who received the offer can accept it.', 'Solo quien recibió la oferta puede aceptarla.'), flags: EPH });
  if (act === 'n' && i.user.id !== t.to && i.user.id !== t.from) return i.reply({ content: L(lc, 'Only the two people in the trade can cancel it.', 'Solo las dos personas del intercambio pueden cancelarlo.'), flags: EPH });
  clearTimeout(t.timer);
  trades.delete(id);
  const noMentions = { parse: [] };
  if (act === 'n') return i.update({ content: '', embeds: [tradeEmbed(lc, t, 'no')], components: [], allowedMentions: noMentions });
  const done = swap(t.gid, t.from, t.A.id, t.to, t.B.id);
  return i.update({ content: '', embeds: [tradeEmbed(lc, t, done ? 'ok' : 'gone')], components: [], allowedMentions: noMentions });
}

/* ============================ comandos de barra ============================ */
const es2 = (es) => ({ 'es-ES': es, 'es-419': es });
const noPerm = (lc) => L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.');

function settingsEmbed(g, lc) {
  const cfg = getCfg(g.id);
  const sh = cfg.shirts || {};
  const ch = sh.channel && g.channels.cache.get(sh.channel);
  const me = g.members.me;
  const need = [['ViewChannel', 'Ver canal'], ['SendMessages', 'Enviar mensajes'], ['EmbedLinks', 'Insertar enlaces'], ['AttachFiles', 'Adjuntar archivos']];
  const perms = ch && me && ch.permissionsFor ? ch.permissionsFor(me) : null;
  const permLine = ch ? need.map(([k, es]) => (perms && perms.has(P[k]) ? '✅ ' : '❌ ') + es).join(' · ') : '—';
  const ps = photos.stats();
  const caught = Object.values(col.data[g.id] || {}).reduce((n, l) => n + l.length, 0);
  const modeTxt = { real: L(lc, 'real photos', 'fotos reales'), mixed: L(lc, 'real + drawn as backup', 'reales + dibujadas si faltan'), drawn: L(lc, 'drawn only', 'solo dibujadas') }[sh.mode || 'real'] || sh.mode;
  const on = sh.channel && sh.on !== false;
  return new EmbedBuilder().setColor(COLOR.blue || 0x3498db).setTitle('⚙️ ' + L(lc, 'Shirt game settings', 'Ajustes del juego de camisetas'))
    .setDescription(
      '**' + L(lc, 'Channel', 'Canal') + ':** ' + (ch ? '<#' + ch.id + '>' : L(lc, 'not set — use `/setchannel`', 'sin elegir — usa `/setchannel`')) + '\n' +
      '**' + L(lc, 'Status', 'Estado') + ':** ' + (on ? '🟢 ' + L(lc, 'on, a shirt every **', 'encendido, una camiseta cada **') + (sh.every || 10) + L(lc, '** messages', '** mensajes') : '🔴 ' + L(lc, 'off', 'apagado')) + '\n' +
      '**' + L(lc, 'Mode', 'Modo') + ':** ' + modeTxt + '\n' +
      '**' + L(lc, 'Bot permissions there', 'Permisos del bot ahí') + ':** ' + permLine + '\n' +
      '**' + L(lc, 'Real photos ready', 'Fotos reales listas') + ':** ' + ps.pool + ' (' + ps.clubs + ' ' + L(lc, 'clubs', 'clubes') + ')\n' +
      '**' + L(lc, 'Shirts caught here', 'Camisetas atrapadas aquí') + ':** ' + caught + '\n' +
      '**' + L(lc, 'Saved for good', 'Guardado para siempre') + ':** ' + (dbstore && dbstore.enabled() ? '✅' : '⚠️ ' + L(lc, 'no database: data is lost when the bot restarts', 'sin base de datos: se pierde al reiniciar el bot')),
    );
}

function makeCommands() {
  const setchannel = {
    data: new SlashCommandBuilder().setName('setchannel').setDescription('Choose the channel where shirts keep appearing (one starts now)')
      .setDescriptionLocalizations(es2('Elige el canal donde salen camisetas siempre (empieza una ahora)')).setDMPermission(false)
      .addChannelOption((o) => o.setName('canal').setDescription('Text channel (default: this one)').setDescriptionLocalizations(es2('Canal de texto (por defecto: este)')).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    async execute(i) {
      if (!i.guild) return;
      const lc = i.locale;
      if (!canConfigure(i.guild, i.user.id, i.member)) return i.reply({ content: noPerm(lc), flags: EPH });
      const picked = i.options.getChannel('canal');
      const ch = (picked && i.guild.channels.cache.get(picked.id)) || i.channel;
      if (!ch || !ch.isTextBased || !ch.isTextBased()) return i.reply({ content: L(lc, 'Pick a text channel.', 'Elige un canal de texto.'), flags: EPH });
      const ctx = {
        guild: i.guild, member: i.member, user: i.user, channel: i.channel, locale: lc,
        reply: (p) => (i.replied || i.deferred ? i.followUp({ ...(typeof p === 'string' ? { content: p } : p), flags: EPH, allowedMentions: { parse: [] } }) : i.reply({ ...(typeof p === 'string' ? { content: p } : p), flags: EPH, allowedMentions: { parse: [] } })),
      };
      return activate(ctx, ch);
    },
  };

  const coleccion = {
    data: new SlashCommandBuilder().setName('coleccion').setDescription('See the shirts you have caught').setDescriptionLocalizations(es2('Mira las camisetas que has atrapado')).setDMPermission(false)
      .addUserOption((o) => o.setName('usuario').setDescription('Whose collection (default: yours)').setDescriptionLocalizations(es2('De quién (por defecto, la tuya)'))),
    async execute(i) {
      if (!i.guild) return;
      const lc = i.locale;
      const u = i.options.getUser('usuario') || i.user;
      const list = mineOf(i.guild.id, u.id);
      if (!list.length) return i.reply({ content: (u.id === i.user.id ? L(lc, 'You have not caught any shirt yet.', 'Todavía no has atrapado ninguna camiseta.') : '<@' + u.id + '> ' + L(lc, 'has not caught any shirt yet.', 'todavía no ha atrapado ninguna camiseta.')) + ' ' + L(lc, 'Press **Catch me** when one appears!', '¡Pulsa **Catch me** cuando salga una!'), allowedMentions: { parse: [] } });
      return i.reply({ embeds: [cardEmbed(lc, u.id, list, 0)], components: list.length > 1 ? [navRow(u.id, 0, list.length, i.user.id)] : [], allowedMentions: { parse: [] } });
    },
  };

  const intercambio = {
    data: new SlashCommandBuilder().setName('intercambio').setDescription('Trade one of your shirts for one of another person').setDescriptionLocalizations(es2('Cambia una camiseta tuya por una de otra persona')).setDMPermission(false)
      .addUserOption((o) => o.setName('usuario').setDescription('Who to trade with').setDescriptionLocalizations(es2('Con quién cambiar')).setRequired(true))
      .addStringOption((o) => o.setName('tuya').setDescription('Your shirt').setDescriptionLocalizations(es2('Tu camiseta')).setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('suya').setDescription('Their shirt').setDescriptionLocalizations(es2('Su camiseta')).setRequired(true).setAutocomplete(true)),
    async autocomplete(i) {
      if (!i.guildId) return i.respond([]);
      const f = i.options.getFocused(true);
      let uid = i.user.id;
      if (f.name === 'suya') { const o = i.options.get('usuario'); uid = o && o.value; }
      const q = photos.norm(f.value);
      const out = (uid ? mineOf(i.guildId, uid) : []).filter((it) => !q || photos.norm(it.team + it.season + it.id).includes(q)).slice(0, 25)
        .map((it) => ({ name: (lbl(it) + ' · ' + it.id).slice(0, 100), value: it.id }));
      return i.respond(out);
    },
    async execute(i) {
      if (!i.guild) return;
      const lc = i.locale;
      const target = i.options.getUser('usuario');
      if (!target || target.bot || target.id === i.user.id) return i.reply({ content: L(lc, 'Pick another person (not a bot, not yourself).', 'Elige a otra persona (no un bot, ni tú).'), flags: EPH });
      const A = mineOf(i.guild.id, i.user.id).find((x) => x.id === i.options.getString('tuya'));
      const B = mineOf(i.guild.id, target.id).find((x) => x.id === i.options.getString('suya'));
      if (!A) return i.reply({ content: L(lc, '❌ That shirt is not in your collection. Pick it from the list.', '❌ Esa camiseta no está en tu colección. Elígela de la lista.'), flags: EPH });
      if (!B) return i.reply({ content: L(lc, '❌ That shirt is not in their collection. Pick it from the list.', '❌ Esa camiseta no está en su colección. Elígela de la lista.'), flags: EPH });
      const id = newId();
      const t = { gid: i.guild.id, from: i.user.id, to: target.id, A: { ...A }, B: { ...B }, timer: null };
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('camisa:t:y:' + id).setLabel(L(lc, 'Accept', 'Aceptar')).setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('camisa:t:n:' + id).setLabel(L(lc, 'Decline', 'Rechazar')).setEmoji('✖️').setStyle(ButtonStyle.Danger),
      );
      await i.reply({ content: '<@' + target.id + '>', embeds: [tradeEmbed(lc, t, null)], components: [row], allowedMentions: { users: [target.id] } });
      trades.set(id, t);
      const msg = await i.fetchReply().catch(() => null);
      t.timer = setTimeout(() => {
        if (!trades.delete(id)) return;
        if (msg && msg.edit) msg.edit({ content: '', embeds: [tradeEmbed(lc, t, 'exp')], components: [], allowedMentions: { parse: [] } }).catch(() => {});
      }, TRADE_MS);
      if (t.timer.unref) t.timer.unref();
    },
  };

  const ajustes = {
    data: new SlashCommandBuilder().setName('ajustes').setDescription('Shirt game settings').setDescriptionLocalizations(es2('Ajustes del juego de camisetas')).setDMPermission(false)
      .addIntegerOption((o) => o.setName('cada').setDescription('A shirt every N messages (3-100)').setDescriptionLocalizations(es2('Una camiseta cada N mensajes (3-100)')).setMinValue(3).setMaxValue(100))
      .addStringOption((o) => o.setName('modo').setDescription('Where the shirts come from').setDescriptionLocalizations(es2('De dónde salen las camisetas'))
        .addChoices({ name: 'Fotos reales / Real photos', value: 'real' }, { name: 'Reales + dibujadas si faltan / Real, drawn as backup', value: 'mixed' }, { name: 'Solo dibujadas / Drawn only', value: 'drawn' }))
      .addBooleanOption((o) => o.setName('activado').setDescription('Turn the automatic shirts on or off').setDescriptionLocalizations(es2('Enciende o apaga las camisetas automáticas'))),
    async execute(i) {
      if (!i.guild) return;
      const lc = i.locale;
      if (!canConfigure(i.guild, i.user.id, i.member)) return i.reply({ content: noPerm(lc), flags: EPH });
      const cfg = getCfg(i.guild.id);
      cfg.shirts = { mode: 'real', channel: null, every: 10, ...(cfg.shirts || {}) };
      const every = i.options.getInteger('cada');
      const mode = i.options.getString('modo');
      const on = i.options.getBoolean('activado');
      const changes = [];
      if (every !== null && every !== undefined) { cfg.shirts.every = every; changes.push(L(lc, 'every ' + every + ' messages', 'cada ' + every + ' mensajes')); }
      if (mode) { cfg.shirts.mode = mode; changes.push(L(lc, 'mode ' + mode, 'modo ' + mode)); }
      if (on !== null && on !== undefined) { cfg.shirts.on = on; changes.push(on ? L(lc, 'turned on', 'encendido') : L(lc, 'turned off', 'apagado')); }
      if (changes.length) saveCfg();
      return i.reply({ content: changes.length ? '✅ ' + L(lc, 'Saved: ', 'Guardado: ') + changes.join(', ') : undefined, embeds: [settingsEmbed(i.guild, lc)], flags: EPH });
    },
  };
  return [setchannel, coleccion, intercambio, ajustes];
}
// Si algún comando tuviera un fallo de formato, se descarta solo ese y el bot sigue normal
const slashCommands = [];
try {
  for (const c of makeCommands()) {
    try { c.data.toJSON(); slashCommands.push(c); } catch (e) { console.error('[camisas] /' + (c.data && c.data.name) + ' no disponible: ' + e.message); }
  }
} catch (e) { console.error('[camisas] comandos no disponibles: ' + e.message); }

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
  // Al conectar, prueba las fuentes de fotos y deja el resultado en los logs
  let tested = false;
  const test = () => { if (tested) return; tested = true; photos.selfTest().catch((e) => console.log('[camisas] autoprueba: ' + e.message)); };
  client.once('clientReady', test);
  client.once('ready', test);
}

module.exports = { register, attach, owns, handleInteraction, commands: slashCommands };
