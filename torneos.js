'use strict';

/*
 * torneos.js — Torneos de simulación de fútbol: /torneo
 *
 * Los CLUBES son roles de Discord ya existentes en el servidor (los de las plantillas de ligas, o cualquier otro).
 * Para inscribir un club eliges el rol y después tu 11 titular entre los miembros que YA tienen ese rol
 * (los «jugadores profesionales que tiene disponibles» el club). Un club solo se puede inscribir una vez.
 *
 *  /torneo crear     abre las inscripciones de un torneo nuevo en el canal (tipo Liga o Copa estilo Champions)
 *  /torneo cancelar   lo cancela (quien lo creó, el dueño o quien tenga Gestionar servidor)
 *  Botón «Inscribir club»   elige tu club (rol) y tu 11 titular → sale en el panel público con el club y quién lo inscribió
 *  Botón «Empezar» (quien creó el torneo)   cierra inscripciones, sortea el calendario/cuadro y simula la primera ronda
 *  Botón «Siguiente jornada/ronda»          simula la ronda que toca, hasta que sale un campeón
 *  Al terminar se vota un Balón de Oro (al azar, con algo más de peso para quien llegó más lejos) entre los 11 titulares.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits: P,
} = require('discord.js');
const bot = require('./bot');

const { L, GL, COLOR, jsonStore, logErr } = bot;
const EPH = MessageFlags.Ephemeral;
const es2 = (s) => ({ 'es-ES': s, 'es-419': s });
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const rm = (id) => '<@&' + id + '>';
const um = (id) => '<@' + id + '>';

const MAX_CLUBS = 16;
const MIN_CLUBS = 2;

/* ============================ datos ============================ */
const store = jsonStore('torneos.json', () => ({}));
function G(gid) {
  const g = store.data[gid] || (store.data[gid] = {});
  if (g.active === undefined) g.active = null;
  g.list = g.list || {};
  return g;
}
const save = () => store.save();
const activeOf = (gid) => { const g = G(gid); return g.active ? g.list[g.active] : null; };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* Estado efímero de quien está a mitad de inscribir un club (rol ya elegido, falta el 11) */
const pending = new Map(); // "guildId:userId" -> { roleId, at }
const PENDING_TTL = 10 * 60 * 1000;
setInterval(() => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > PENDING_TTL) pending.delete(k); }, 60000).unref();

/* ============================ utilidades ============================ */
async function fetchMembers(g) { try { await g.members.fetch(); } catch (_) { /* sin el intent de miembros solo se ve la caché */ } }

function canManage(i, t) {
  return i.user.id === t.creatorId || i.guild.ownerId === i.user.id || (i.member && i.member.permissions.has(P.ManageGuild));
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
/* Un gol «de mentira»: pesa hacia 0-2, con algún partidazo suelto. Sin estadísticas reales: todo es azar a propósito (es una simulación). */
const GOAL_POOL = [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4];
const simGoals = () => pick(GOAL_POOL);

function initStats() { return { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; }

function applyResult(t, homeId, awayId, hg, ag) {
  const H = t.clubs[homeId], A = t.clubs[awayId];
  H.played++; A.played++;
  H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
  if (hg > ag) { H.w++; A.l++; H.pts += 3; }
  else if (hg < ag) { A.w++; H.l++; A.pts += 3; }
  else { H.d++; A.d++; H.pts++; A.pts++; }
}

function standings(t) {
  return t.order
    .map((id) => ({ id, ...t.clubs[id] }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || t.order.indexOf(a.id) - t.order.indexOf(b.id));
}

/* Calendario de liga: todos contra todos una vez, repartido en jornadas sin que nadie juegue dos veces la misma (método del círculo) */
function roundRobin(ids) {
  const arr = ids.slice();
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a !== null && b !== null) round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* Primera ronda del cuadro: emparejamientos al azar; si no es potencia de 2 hay descansos (bye) que pasan directos */
function knockoutFirstRound(ids) {
  let size = 1; while (size < ids.length) size *= 2;
  const slots = shuffled(ids);
  while (slots.length < size) slots.push(null);
  const round = [];
  for (let i = 0; i < slots.length; i += 2) round.push({ home: slots[i], away: slots[i + 1], played: false });
  return round;
}

const ROUND_NAME = (left) => (left <= 2 ? 'Final' : left === 4 ? 'Semifinal' : left === 8 ? 'Cuartos de final' : left === 16 ? 'Octavos de final' : left === 32 ? 'Dieciseisavos de final' : (left / 2) + 'avos de final');

/* ============================ embeds ============================ */
function clubLine(t, id) {
  const c = t.clubs[id];
  return '🏳️ ' + rm(id) + ' — ' + um(c.presidentId) + (c.lineup.length === 11 ? ' ✅' : ' (' + c.lineup.length + '/11)');
}

function panelEmbed(guild, t) {
  const e = new EmbedBuilder().setColor(t.status === 'terminado' ? (t.champion ? COLOR.green : COLOR.red) : COLOR.blue).setTimestamp();
  const kindName = t.kind === 'champions' ? '🏆 Copa estilo Champions' : '🏅 Liga (todos contra todos)';
  e.setTitle((t.name || 'Torneo') + ' · ' + kindName);
  if (t.status === 'inscripcion') {
    e.setDescription(
      'Creado por ' + um(t.creatorId) + '. Pulsa **📝 Inscribir club** para apuntar tu club con tu 11 titular.\n' +
      'Hace falta el rol del club: solo puedes alinear a quien ya lo tenga. Mínimo ' + MIN_CLUBS + ' clubes, máximo ' + MAX_CLUBS + '.\n\n' +
      '**Clubes inscritos (' + t.order.length + '/' + MAX_CLUBS + '):**\n' +
      (t.order.length ? t.order.map((id) => clubLine(t, id)).join('\n') : '_Todavía ninguno._')
    );
  } else if (t.status === 'terminado') {
    e.setDescription(
      t.champion
        ? ('🏆 **Campeón: ' + rm(t.champion) + '** (presidente: ' + um(t.clubs[t.champion].presidentId) + ')\n' +
          (t.ballonDor ? '🥇 **Balón de Oro:** ' + um(t.ballonDor.userId) + ' (' + rm(t.ballonDor.roleId) + ')\n' : '') +
          '\n' + standingsTable(t))
        : '🚫 Torneo cancelado por ' + um(t.cancelledBy || t.creatorId) + '.'
    );
  } else if (t.kind === 'champions') {
    e.setDescription('Ronda actual: **' + ROUND_NAME(bracketLeft(t)) + '**.\n\n' + bracketText(t));
  } else {
    e.setDescription('Jornada ' + (t.roundIdx + 1) + ' de ' + t.fixtures.length + '.\n\n' + standingsTable(t));
  }
  return e;
}

function standingsTable(t) {
  const rows = standings(t);
  const names = rows.map((r) => clip(r.name, 18));
  const nw = Math.max(4, ...names.map((n) => n.length));
  const head = '#  ' + 'Club'.padEnd(nw) + ' Pts PJ  G  E  P  GF GC  DG';
  const lines = rows.map((r, i) => {
    const dg = r.gf - r.ga;
    return String(i + 1).padEnd(3) + clip(r.name, nw).padEnd(nw) + ' ' +
      String(r.pts).padStart(3) + String(r.played).padStart(3) + String(r.w).padStart(3) + String(r.d).padStart(3) + String(r.l).padStart(3) +
      String(r.gf).padStart(3) + String(r.ga).padStart(3) + (dg >= 0 ? '+' : '') + dg;
  });
  return '```\n' + head + '\n' + lines.join('\n') + '\n```';
}

function bracketLeft(t) { return t.bracket[t.roundIdx].length * 2; }
function bracketText(t) {
  const round = t.bracket[t.roundIdx];
  return round.map((m) => {
    if (m.home === null || m.away === null) {
      const w = m.home === null ? m.away : m.home;
      return '🏳️ ' + (w ? nameOf(t, w) : '?') + ' pasa de ronda (descanso)';
    }
    const line = '🏳️ ' + nameOf(t, m.home) + ' vs ' + nameOf(t, m.away);
    if (!m.played) return line;
    return line + '  →  **' + m.hg + '-' + m.ag + '**' + (m.pens ? ' _(penaltis, gana ' + nameOf(t, m.winner) + ')_' : '');
  }).join('\n');
}

function panelComponents(t) {
  if (t.status === 'terminado') return [];
  const rows = [];
  if (t.status === 'inscripcion') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('trn:join').setLabel('Inscribir club').setEmoji('📝').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('trn:start').setLabel('Empezar').setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(t.order.length < MIN_CLUBS)
    ));
  } else {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('trn:next').setLabel('Siguiente').setEmoji('⚽').setStyle(ButtonStyle.Primary)
    ));
  }
  return rows;
}

async function refreshPanel(guild, t) {
  try {
    const ch = await guild.channels.fetch(t.panel.channelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(t.panel.messageId).catch(() => null);
    if (!msg) return;
    await msg.edit({ embeds: [panelEmbed(guild, t)], components: panelComponents(t) });
  } catch (e) { logErr(e); }
}

/* ============================ simulación ============================ */
function roundResultsEmbed(t, matches, title) {
  const e = new EmbedBuilder().setColor(COLOR.orange).setTitle(title);
  e.setDescription(matches.map((m) => {
    if (m.bye) return '🏳️ ' + t.clubs[m.winner].name + ' pasa de ronda (descanso)';
    return '🏳️ ' + t.clubs[m.home].name + '  **' + m.hg + ' - ' + m.ag + '**  ' + t.clubs[m.away].name + (m.pens ? ' _(penaltis, gana ' + t.clubs[m.winner].name + ')_' : '');
  }).join('\n').slice(0, 4000));
  return e;
}

function nameOf(t, id) { return t.clubs[id].name; }

/* ===================== un canal por enfrentamiento ===================== */
function slugPart(s) {
  const r = String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (r || 'club').slice(0, 40);
}
function categoryName(t) { return clip('🏆 ' + (t.name || 'Torneo'), 90); }
function matchChannelName(t, m) { return clip(slugPart(nameOf(t, m.home)) + '-vs-' + slugPart(nameOf(t, m.away)), 90); }

function matchEmbed(t, m, roundLabel) {
  const e = new EmbedBuilder().setColor(COLOR.orange).setTitle(roundLabel);
  e.setDescription('🏳️ ' + nameOf(t, m.home) + '  **' + m.hg + ' - ' + m.ag + '**  ' + nameOf(t, m.away) + (m.pens ? '\n_(penaltis, gana ' + nameOf(t, m.winner) + ')_' : ''));
  return e;
}

async function ensureCategory(guild, t) {
  if (t.categoryId) {
    const existing = await guild.channels.fetch(t.categoryId).catch(() => null);
    if (existing) return existing;
  }
  const cat = await guild.channels.create({ name: categoryName(t), type: ChannelType.GuildCategory, reason: 'Torneo: ' + (t.name || t.id) });
  t.categoryId = cat.id;
  save();
  return cat;
}

async function clearMatchChannels(guild, t) {
  if (!t.matchChannels || !t.matchChannels.length) return;
  for (const id of t.matchChannels) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch) await ch.delete('Torneo: siguiente ronda').catch(() => {});
  }
  t.matchChannels = [];
}

/* Crea (o renueva) un canal por cada enfrentamiento de la ronda y publica ahí su resultado.
   Si el bot no tiene permiso para crear canales, devuelve ok:false y se usa el embed combinado de siempre. */
async function postMatchChannels(guild, t, matches, roundLabel) {
  const real = matches.filter((m) => !m.bye);
  if (!real.length) return { ok: true, created: [] };
  try {
    await clearMatchChannels(guild, t);
    const cat = await ensureCategory(guild, t);
    const created = [];
    for (const m of real) {
      const ch = await guild.channels.create({ name: matchChannelName(t, m), type: ChannelType.GuildText, parent: cat.id, topic: clip(roundLabel, 1024), reason: 'Torneo: ' + roundLabel });
      await ch.send({ embeds: [matchEmbed(t, m, roundLabel)] }).catch(() => {});
      created.push(ch.id);
    }
    t.matchChannels = created;
    save();
    return { ok: true, created };
  } catch (e) {
    logErr(e);
    return { ok: false, created: [] };
  }
}

function playLigaRound(t) {
  const round = t.fixtures[t.roundIdx];
  const matches = [];
  for (const [home, away] of round) {
    const hg = simGoals(), ag = simGoals();
    applyResult(t, home, away, hg, ag);
    matches.push({ home, away, hg, ag });
  }
  const finished = t.roundIdx >= t.fixtures.length - 1;
  if (finished) {
    t.status = 'terminado';
    t.champion = standings(t)[0].id;
  }
  return { matches, title: 'Jornada ' + (t.roundIdx + 1) + ' — resultados', finished };
}

function playKnockoutRound(t) {
  const round = t.bracket[t.roundIdx];
  const matches = [];
  const winners = [];
  for (const m of round) {
    if (m.home === null || m.away === null) {
      const w = m.home === null ? m.away : m.home;
      m.winner = w; m.played = true;
      matches.push({ bye: true, winner: w });
      winners.push(w);
      continue;
    }
    const hg = simGoals(), ag = simGoals();
    const pens = hg === ag;
    const winner = pens ? (Math.random() < 0.5 ? m.home : m.away) : (hg > ag ? m.home : m.away);
    m.hg = hg; m.ag = ag; m.pens = pens; m.played = true; m.winner = winner;
    applyResult(t, m.home, m.away, hg, ag); // el marcador (empate incluido) sí cuenta para los goles a favor/en contra
    matches.push(m);
    winners.push(m.winner);
  }
  const title = ROUND_NAME(round.length * 2) + ' — resultados';
  let finished = false;
  if (winners.length === 1) {
    finished = true;
    t.status = 'terminado';
    t.champion = winners[0];
  } else {
    const next = [];
    for (let i = 0; i < winners.length; i += 2) next.push({ home: winners[i], away: winners[i + 1] ?? null, played: false });
    t.bracket.push(next);
  }
  return { matches, title, finished };
}

function ballonDor(t) {
  const pool = [];
  for (const id of t.order) {
    const c = t.clubs[id];
    const weight = 1 + c.played; // quien jugó más rondas pesa algo más, sigue siendo al azar
    for (const uid of c.lineup) for (let k = 0; k < weight; k++) pool.push({ userId: uid, roleId: id });
  }
  return pool.length ? pick(pool) : null;
}

async function finish(channel, guild, t) {
  const champEmbed = new EmbedBuilder().setColor(0xf5b800).setTitle('🏆 ¡Tenemos campeón!')
    .setDescription('**' + rm(t.champion) + '** se proclama campeón de **' + (t.name || 'el torneo') + '**.\nPresidente: ' + um(t.clubs[t.champion].presidentId));
  await channel.send({ embeds: [champEmbed] }).catch(() => {});
  const bo = ballonDor(t);
  if (bo) {
    t.ballonDor = bo;
    const boEmbed = new EmbedBuilder().setColor(0xf5b800).setTitle('🥇 Balón de Oro')
      .setDescription(um(bo.userId) + ' se lleva el Balón de Oro del torneo, jugando con ' + rm(bo.roleId) + '.');
    await channel.send({ embeds: [boEmbed] }).catch(() => {});
  }
}

/* ============================ comando ============================ */
const data = new SlashCommandBuilder()
  .setName('tournament')
  .setNameLocalizations(es2('torneo'))
  .setDescription('Football simulation tournaments between your server clubs')
  .setDescriptionLocalizations(es2('Torneos de simulación de fútbol entre los clubes del servidor'))
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('create').setNameLocalizations(es2('crear')).setDescription('Open registration for a new tournament').setDescriptionLocalizations(es2('Abre las inscripciones de un torneo nuevo'))
    .addStringOption((o) => o.setName('type').setNameLocalizations(es2('tipo')).setDescription('League (round robin) or Champions-style knockout').setDescriptionLocalizations(es2('Liga (todos contra todos) o copa estilo Champions')).setRequired(true)
      .addChoices({ name: 'Liga (todos contra todos)', value: 'liga' }, { name: 'Champions (eliminatoria directa)', value: 'champions' }))
    .addStringOption((o) => o.setName('name').setNameLocalizations(es2('nombre')).setDescription('Tournament name').setDescriptionLocalizations(es2('Nombre del torneo')).setMaxLength(80)))
  .addSubcommand((s) => s.setName('cancel').setNameLocalizations(es2('cancelar')).setDescription('Cancel the active tournament').setDescriptionLocalizations(es2('Cancela el torneo activo')));

async function execute(i) {
  const lc = i.locale;
  if (!i.guild) return i.reply({ content: L(lc, '❌ Only works in a server.', '❌ Solo funciona en un servidor.'), flags: EPH });
  const sub = i.options.getSubcommand();
  const g = i.guild;
  const store_ = G(g.id);

  if (sub === 'create') {
    const existing = activeOf(g.id);
    if (existing) return i.reply({ content: L(lc, '❌ There’s already a tournament running here: **' + (existing.name || 'Torneo') + '**. Finish it or use `/torneo cancelar` first.', '❌ Ya hay un torneo en marcha: **' + (existing.name || 'Torneo') + '**. Termínalo o usa `/torneo cancelar` primero.'), flags: EPH });
    const kind = i.options.getString('type', true);
    const name = clip(String(i.options.getString('name') || (kind === 'champions' ? 'Champions de ' + g.name : 'Liga de ' + g.name)).trim(), 80);
    const id = newId();
    const t = { id, name, kind, creatorId: i.user.id, channelId: i.channelId, status: 'inscripcion', clubs: {}, order: [], roundIdx: -1, fixtures: [], bracket: [], champion: null, ballonDor: null, panel: null, categoryId: null, matchChannels: [], createdAt: Date.now() };
    store_.list[id] = t;
    store_.active = id;
    save();
    await i.reply({ embeds: [panelEmbed(g, t)], components: panelComponents(t) });
    const reply = await i.fetchReply();
    t.panel = { channelId: i.channelId, messageId: reply.id };
    save();
    return;
  }

  if (sub === 'cancel') {
    const t = activeOf(g.id);
    if (!t) return i.reply({ content: L(lc, '❌ There’s no active tournament.', '❌ No hay ningún torneo activo.'), flags: EPH });
    if (!canManage(i, t)) return i.reply({ content: L(lc, '🔒 Only the creator, the server owner or someone with Manage Server can cancel it.', '🔒 Solo quien lo creó, el dueño del servidor o alguien con Gestionar servidor puede cancelarlo.'), flags: EPH });
    t.status = 'terminado';
    t.cancelledBy = i.user.id;
    store_.active = null;
    save();
    await refreshPanel(g, t).catch(() => {});
    try {
      const ch = await g.channels.fetch(t.panel.channelId).catch(() => null);
      if (ch) await ch.send({ content: '🚫 Torneo **' + (t.name || '') + '** cancelado por ' + um(i.user.id) + '.' }).catch(() => {});
    } catch (_) { /* no pasa nada si no se pudo avisar */ }
    await clearMatchChannels(g, t).catch(() => {});
    if (t.categoryId) {
      const cat = await g.channels.fetch(t.categoryId).catch(() => null);
      if (cat) await cat.delete('Torneo cancelado').catch(() => {});
      t.categoryId = null;
    }
    save();
    return i.reply({ content: L(lc, '✅ Tournament cancelled.', '✅ Torneo cancelado.'), flags: EPH });
  }
}

/* ============================ componentes ============================ */
const owns = (i) => !!(i && i.customId && String(i.customId).startsWith('trn:'));

async function handle(i) {
  const lc = i.locale;
  try {
    const g = i.guild;
    if (!g) return;
    const t = activeOf(g.id);

    if (i.customId === 'trn:join') {
      if (!t || t.status !== 'inscripcion') return i.reply({ content: L(lc, '❌ Registration is closed.', '❌ Las inscripciones ya están cerradas.'), flags: EPH });
      if (t.order.length >= MAX_CLUBS) return i.reply({ content: GL(g, '❌ Tournament full.', '❌ El torneo está lleno (' + MAX_CLUBS + ' clubes como máximo).'), flags: EPH });
      if (t.order.some((id) => t.clubs[id].presidentId === i.user.id)) return i.reply({ content: L(lc, '❌ You already registered a club in this tournament.', '❌ Ya has inscrito un club en este torneo.'), flags: EPH });
      const sel = new RoleSelectMenuBuilder().setCustomId('trn:role').setPlaceholder(L(lc, 'Which club are you registering?', '¿Qué club vas a inscribir?')).setMinValues(1).setMaxValues(1);
      return i.reply({ content: L(lc, 'Pick your club’s role:', 'Elige el rol de tu club:'), components: [new ActionRowBuilder().addComponents(sel)], flags: EPH });
    }

    if (i.isRoleSelectMenu && i.isRoleSelectMenu() && i.customId === 'trn:role') {
      if (!t || t.status !== 'inscripcion') return i.update({ content: L(lc, '❌ Registration closed in the meantime.', '❌ Las inscripciones se cerraron mientras tanto.'), components: [] });
      const role = i.roles.first();
      if (!role || role.id === g.id || role.managed) return i.update({ content: L(lc, '❌ That role doesn’t work. Pick your club’s role.', '❌ Ese rol no vale. Elige el rol de tu club.'), components: [] });
      if (t.clubs[role.id]) return i.update({ content: L(lc, '❌ That club is already registered (by ' + '<@' + t.clubs[role.id].presidentId + '>' + ').', '❌ Ese club ya está inscrito (por ' + um(t.clubs[role.id].presidentId) + ').'), components: [] });
      await fetchMembers(g);
      const count = role.members ? role.members.size : g.members.cache.filter((m) => m.roles.cache.has(role.id) && !m.user.bot).size;
      if (count < 11) return i.update({ content: GL(g, '❌ Not enough members with that role.', '❌ Ese club tiene menos de 11 miembros con el rol (' + count + '). Dales el rol antes de inscribirlo.'), components: [] });
      pending.set(g.id + ':' + i.user.id, { roleId: role.id, at: Date.now() });
      const sel = new UserSelectMenuBuilder().setCustomId('trn:xi').setPlaceholder(L(lc, 'Pick your starting 11 (11 members with that role)', 'Elige tu 11 titular (11 miembros que tengan ese rol)')).setMinValues(11).setMaxValues(11);
      return i.update({ content: L(lc, 'Club: ' + role.name + '. Now pick your starting 11:', 'Club: ' + role.name + '. Ahora elige tu 11 titular:'), components: [new ActionRowBuilder().addComponents(sel)] });
    }

    if (i.isUserSelectMenu && i.isUserSelectMenu() && i.customId === 'trn:xi') {
      const key = g.id + ':' + i.user.id;
      const p = pending.get(key);
      if (!p) return i.update({ content: L(lc, '❌ This timed out. Press “Register club” again.', '❌ Se agotó el tiempo. Pulsa «Inscribir club» otra vez.'), components: [] });
      if (!t || t.status !== 'inscripcion') { pending.delete(key); return i.update({ content: L(lc, '❌ Registration closed in the meantime.', '❌ Las inscripciones se cerraron mientras tanto.'), components: [] }); }
      if (t.clubs[p.roleId]) { pending.delete(key); return i.update({ content: L(lc, '❌ That club just got registered by someone else.', '❌ Ese club lo acaba de inscribir otra persona.'), components: [] }); }
      if (t.order.some((id) => t.clubs[id].presidentId === i.user.id)) { pending.delete(key); return i.update({ content: L(lc, '❌ You already registered a club in this tournament.', '❌ Ya has inscrito un club en este torneo.'), components: [] }); }
      const members = [...i.members.values()];
      if (members.length !== 11) return i.update({ content: L(lc, '❌ Pick exactly 11 people.', '❌ Elige exactamente 11 personas.'), components: [] });
      const bots = members.filter((m) => m.user.bot);
      if (bots.length) return i.update({ content: L(lc, '❌ Bots can’t play: ' + bots.map((m) => m.toString()).join(', '), '❌ Los bots no pueden jugar: ' + bots.map((m) => m.toString()).join(', ')), components: [] });
      const missing = members.filter((m) => !m.roles.cache.has(p.roleId));
      if (missing.length) return i.update({ content: L(lc, '❌ These aren’t on that club: ' + missing.map((m) => m.toString()).join(', '), '❌ Estos no son del club ' + rm(p.roleId) + ': ' + missing.map((m) => m.toString()).join(', ') + '. Elige solo jugadores que ya tengan el rol.'), components: [] });
      const role = g.roles.cache.get(p.roleId);
      t.clubs[p.roleId] = { roleId: p.roleId, name: role ? role.name : 'Club', presidentId: i.user.id, lineup: members.map((m) => m.id), ...initStats() };
      t.order.push(p.roleId);
      pending.delete(key);
      save();
      await i.update({ content: L(lc, '✅ **' + (role ? role.name : 'Club') + '** registered with your starting 11.', '✅ **' + (role ? role.name : 'Club') + '** inscrito con tu 11 titular.'), components: [] });
      return refreshPanel(g, t);
    }

    if (i.customId === 'trn:start' || i.customId === 'trn:next') {
      if (!t) return i.reply({ content: L(lc, '❌ There’s no active tournament.', '❌ No hay ningún torneo activo.'), flags: EPH });
      if (!canManage(i, t)) return i.reply({ content: L(lc, '🔒 Only the creator, the server owner or someone with Manage Server can do that.', '🔒 Solo quien creó el torneo, el dueño del servidor o alguien con Gestionar servidor puede hacer eso.'), flags: EPH });

      if (i.customId === 'trn:start') {
        if (t.status !== 'inscripcion') return i.reply({ content: L(lc, '❌ The tournament already started.', '❌ El torneo ya ha empezado.'), flags: EPH });
        if (t.order.length < MIN_CLUBS) return i.reply({ content: GL(g, '❌ Need at least ' + MIN_CLUBS + ' clubs.', '❌ Hacen falta al menos ' + MIN_CLUBS + ' clubes inscritos.'), flags: EPH });
        if (t.kind === 'champions') { t.bracket = [knockoutFirstRound(t.order)]; t.status = 'eliminatorias'; }
        else { t.fixtures = roundRobin(t.order); t.status = 'liga'; }
        t.roundIdx = 0;
      } else {
        if (t.status === 'inscripcion' || t.status === 'terminado') return i.reply({ content: L(lc, '❌ Nothing to simulate right now.', '❌ Ahora mismo no hay nada que simular.'), flags: EPH });
        t.roundIdx++;
      }

      await i.deferUpdate();
      const result = t.kind === 'champions' ? playKnockoutRound(t) : playLigaRound(t);
      save();
      const ch = i.channel;
      const chans = await postMatchChannels(g, t, result.matches, result.title);
      if (chans.ok && chans.created.length) {
        const list = chans.created.map((id) => '<#' + id + '>').join(' · ');
        const byes = result.matches.filter((m) => m.bye);
        let note = '⚽ **' + result.title + '** — ' + list;
        if (byes.length) note += '\n' + byes.map((m) => '🏳️ ' + nameOf(t, m.winner) + ' pasa de ronda (descanso)').join('\n');
        await ch.send({ content: note }).catch(() => {});
      } else {
        await ch.send({ embeds: [roundResultsEmbed(t, result.matches, result.title)] }).catch(() => {});
      }
      if (result.finished) { save(); await finish(ch, g, t); G(g.id).active = null; save(); }
      return refreshPanel(g, t);
    }
  } catch (e) {
    logErr(e);
    try { if (i.deferred || i.replied) await i.editReply({ content: '⚠️ ' + e.message, components: [] }); else await i.reply({ content: '⚠️ ' + e.message, flags: EPH }); } catch (_) { /* nada */ }
  }
}

module.exports = { commands: [{ data, execute }], owns, handle };
