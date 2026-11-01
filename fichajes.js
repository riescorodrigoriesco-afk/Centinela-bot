'use strict';

/*
 * fichajes.js — Sistema de fichajes para ligas: /fichaje
 *
 * Los EQUIPOS son roles de Discord (las plantillas de ligas los crean y lo dejan todo configurado). Cada jugador está en un
 * equipo como mucho; fichar = cambiarle el rol de equipo. Quien ficha son los «Presidentes» (rol configurable) de cada equipo
 * y el staff (dueño, Administrador o Gestionar servidor).
 *
 *  /fichaje ofrecer   un presidente ofrece un fichaje o una cesión. Si el jugador ya tiene equipo, primero el club de origen
 *                     aprueba la venta; después el jugador acepta. Al aceptar se cambia el rol y sale el anuncio oficial.
 *  /fichaje fichar    (staff) ficha directamente, sin ofertas
 *  /fichaje libre     un presidente (o el staff) da de baja a un jugador de su equipo: queda como «Agente libre»
 *  /fichaje plantilla los jugadores de un equipo      /fichaje historial  los últimos movimientos
 *  /fichaje mercado   (staff) abre o cierra la ventana de fichajes
 *  /fichaje config    (staff) canales, rol de presidente, rol de agente libre, equipos y plantilla máxima
 *  /fichaje rumor     cualquiera suelta un rumor en el canal del mercado y los demás votan si es creíble
 *
 * Las ofertas duran 48 h y se guardan (sobreviven a un reinicio si hay base de datos).
 */

const crypto = require('crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');

const { L, jsonStore, COLOR, logErr } = bot;
const EPH = MessageFlags.Ephemeral;
const es2 = (s) => ({ 'es-ES': s, 'es-419': s });
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

// Tiempos (ms). Se exponen para poder probarlos sin esperar.
const T = { offerTtl: 48 * 3600 * 1000, keepOffers: 7 * 24 * 3600 * 1000, rumorCooldown: 60 * 1000, keepHist: 300, keepRumors: 150 };

/* ============================ datos ============================ */
const store = jsonStore('fichajes.json', () => ({}));
function C(gid) {
  const c = store.data[gid] || (store.data[gid] = {});
  if (!Array.isArray(c.teams)) c.teams = [];
  if (c.open === undefined) c.open = true;
  for (const k of ['announce', 'market', 'manager', 'free']) if (c[k] === undefined) c[k] = null;
  if (typeof c.max !== 'number') c.max = 0;
  if (typeof c.n !== 'number') c.n = 0;
  c.offers = c.offers || {};
  c.hist = c.hist || [];
  c.rumors = c.rumors || {};
  return c;
}
const save = () => store.save();

/* La usan las plantillas de ligas: deja el sistema listo (equipos, canales y roles) y empieza de cero */
function setup(g, o) {
  const c = C(g.id);
  Object.assign(c, { announce: o.announce || null, market: o.market || null, manager: o.manager || null, free: o.free || null, teams: [...(o.teams || [])], open: true, max: 0, n: 0, offers: {}, hist: [], rumors: {} });
  save();
  return c;
}

/* ============================ utilidades ============================ */
const isStaff = (m, g) => !!m && (m.id === g.ownerId || m.permissions.has(P.Administrator) || m.permissions.has(P.ManageGuild));
const isManager = (m, c) => !!m && !!c.manager && m.roles.cache.has(c.manager);
const teamsOf = (m, c) => c.teams.filter((id) => m.roles.cache.has(id));
const um = (id) => '<@' + id + '>';
const rm = (id) => '<@&' + id + '>';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const newId = () => crypto.randomBytes(4).toString('hex');
const NOMENT = { parse: [] };

function reply(i, content, extra = {}) {
  const p = { content, allowedMentions: NOMENT, ...extra };
  return i.deferred || i.replied ? i.editReply(p) : i.reply({ ...p, flags: EPH });
}

async function fetchMembers(g) { try { await g.members.fetch(); } catch (_) { /* sin el intent de miembros solo se ve la caché */ } }

async function channelOf(g, id) {
  if (!id) return null;
  const ch = g.channels.cache.get(id) || (await g.channels.fetch(id).catch(() => null));
  return ch && ch.isTextBased() && !ch.isDMBased() ? ch : null;
}

/* Permisos que le faltan al bot en un canal para publicar tarjetas con botones */
function missingIn(g, ch) {
  const me = g.members.me;
  const perms = me && ch.permissionsFor ? ch.permissionsFor(me) : null;
  if (!perms) return [];
  const names = { ViewChannel: 'Ver el canal', SendMessages: 'Enviar mensajes', EmbedLinks: 'Insertar enlaces' };
  return Object.keys(names).filter((k) => !perms.has(P[k])).map((k) => names[k]);
}

/* El equipo que se pide: id de rol o parte del nombre (si escriben a mano en vez de elegir de la lista) */
function resolveTeam(g, c, raw) {
  if (!raw) return null;
  if (c.teams.includes(raw)) return raw;
  const q = norm(raw);
  if (!q) return null;
  const hits = c.teams.filter((id) => { const r = g.roles.cache.get(id); return r && norm(r.name).includes(q); });
  return hits.length === 1 ? hits[0] : null;
}

function checkEditable(g, ids) {
  for (const id of ids) {
    const r = g.roles.cache.get(id);
    if (!r) throw new Error('Un rol de equipo ya no existe. Revisa /fichaje config.');
    if (!r.editable) throw new Error('No puedo gestionar el rol «' + r.name + '»: sube el rol de Centinela por encima de los equipos.');
  }
}

/* Cambia el equipo de un jugador (toId = null → agente libre). Un jugador solo está en un equipo. */
async function setTeam(g, member, c, toId, reason) {
  const remove = c.teams.filter((id) => id !== toId && member.roles.cache.has(id));
  const add = [];
  if (toId && !member.roles.cache.has(toId)) add.push(toId);
  if (c.free) {
    if (toId && member.roles.cache.has(c.free)) remove.push(c.free);
    if (!toId && !member.roles.cache.has(c.free)) add.push(c.free);
  }
  checkEditable(g, [...remove, ...add]);
  if (remove.length) await member.roles.remove(remove, reason);
  if (add.length) await member.roles.add(add, reason);
}

function record(c, e) {
  c.n++;
  e.n = c.n;
  e.at = Date.now();
  c.hist.push(e);
  if (c.hist.length > T.keepHist) c.hist.splice(0, c.hist.length - T.keepHist);
  save();
  return e;
}

const KIND = { fichaje: ['✅ FICHAJE OFICIAL', 'Fichaje'], cesion: ['🔁 CESIÓN OFICIAL', 'Cesión'], baja: ['🚪 BAJA', 'Baja'] };

/* Anuncio oficial en el canal de fichajes (o, si no hay, en el del mercado o donde se usó el comando) */
async function announce(g, c, kind, e, fallback) {
  try {
    const ch = (await channelOf(g, c.announce)) || (await channelOf(g, c.market)) || fallback;
    if (!ch) return null;
    const to = e.to ? g.roles.cache.get(e.to) : null;
    const from = e.from ? g.roles.cache.get(e.from) : null;
    const member = g.members.cache.get(e.player);
    const emb = new EmbedBuilder().setColor((to && to.color) || (from && from.color) || (kind === 'baja' ? COLOR.orange : COLOR.green)).setTitle(KIND[kind][0]);
    emb.setDescription(kind === 'baja' ? um(e.player) + ' deja ' + (e.from ? rm(e.from) : 'su equipo') + ' y queda como **agente libre**.' : um(e.player) + '  ➜  ' + rm(e.to));
    const fields = [];
    if (kind !== 'baja') fields.push({ name: 'Procedencia', value: e.from ? rm(e.from) : '🆓 Agente libre', inline: true }, { name: 'Destino', value: rm(e.to), inline: true });
    if (e.cond) fields.push({ name: kind === 'baja' ? 'Motivo' : 'Condiciones', value: clip(e.cond, 300), inline: false });
    if (fields.length) emb.addFields(fields);
    if (member && member.user && member.user.displayAvatarURL) emb.setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }));
    emb.setFooter({ text: KIND[kind][1] + ' #' + e.n }).setTimestamp();
    return await ch.send({ embeds: [emb], allowedMentions: { users: [e.player] } });
  } catch (err) {
    logErr(err);
    return null;
  }
}

/* ============================ ofertas ============================ */
function offerEmbed(o, state, by) {
  const states = {
    club: '⏳ Esperando la aprobación del club de origen (' + (o.from ? rm(o.from) : '—') + ')',
    player: '⏳ Esperando la respuesta de ' + um(o.player),
    done: '✅ **Fichaje completado**',
    rejected: '❌ **Rechazada**' + (by ? ' por ' + um(by) : ''),
    cancelled: '🗑️ **Retirada**' + (by ? ' por ' + um(by) : ''),
    expired: '⌛ **Caducó** sin respuesta',
    failed: '⚠️ **No se pudo completar**' + (by ? ': ' + by : ''),
  };
  const e = new EmbedBuilder().setColor(state === 'done' ? COLOR.green : state === 'club' || state === 'player' ? COLOR.blue : COLOR.orange)
    .setTitle(o.type === 'cesion' ? '🔁 OFERTA DE CESIÓN' : '🖊️ OFERTA DE FICHAJE')
    .setDescription(um(o.player) + '  ➜  ' + rm(o.to) + '\n\n' + states[state]);
  const f = [{ name: 'Procedencia', value: o.from ? rm(o.from) : '🆓 Agente libre', inline: true }, { name: 'Ofrece', value: um(o.by), inline: true }];
  if (o.cond) f.push({ name: 'Condiciones', value: clip(o.cond, 300), inline: false });
  if (state === 'club' || state === 'player') f.push({ name: 'Caduca', value: '<t:' + Math.floor(o.exp / 1000) + ':R>', inline: true });
  e.addFields(f);
  return e;
}

function offerRow(o, state) {
  if (state !== 'club' && state !== 'player') return [];
  const row = new ActionRowBuilder();
  if (state === 'club') row.addComponents(new ButtonBuilder().setCustomId('fich:sell:' + o.id).setLabel('Aprobar venta').setEmoji('🤝').setStyle(ButtonStyle.Success));
  else row.addComponents(new ButtonBuilder().setCustomId('fich:acc:' + o.id).setLabel('Aceptar').setEmoji('✅').setStyle(ButtonStyle.Success));
  row.addComponents(
    new ButtonBuilder().setCustomId('fich:rej:' + o.id).setLabel('Rechazar').setEmoji('❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('fich:cancel:' + o.id).setLabel('Retirar oferta').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
  );
  return [row];
}

const view = (o, state, by) => ({ content: '', embeds: [offerEmbed(o, state, by)], components: offerRow(o, state), allowedMentions: NOMENT });

/* Quita ofertas viejas del almacén */
function sweep(c) {
  const now = Date.now();
  for (const [id, o] of Object.entries(c.offers)) if (now - o.at > T.keepOffers) delete c.offers[id];
}

/* Cuántos jugadores tiene un equipo (con la caché de miembros) */
async function squadSize(g, teamId) {
  await fetchMembers(g);
  const r = g.roles.cache.get(teamId);
  return r ? r.members.size : 0;
}

/* ============================ comandos ============================ */
const sub = (name, desc, esDesc, fn) => (s) => {
  s.setName(name).setDescription(desc).setDescriptionLocalizations(es2(esDesc));
  fn(s);
  return s;
};
const teamOpt = (required, d) => (o) => o.setName('equipo').setDescription(d || 'Team').setDescriptionLocalizations(es2(d ? 'Equipo (por defecto, el tuyo)' : 'Equipo')).setAutocomplete(true).setRequired(required);
const playerOpt = (required) => (o) => o.setName('jugador').setDescription('Player').setDescriptionLocalizations(es2('Jugador')).setRequired(required);

const data = new SlashCommandBuilder()
  .setName('fichaje')
  .setDescription('Transfer market: offers, signings, releases and history')
  .setDescriptionLocalizations(es2('Mercado de fichajes: ofertas, altas, bajas e historial'))
  .setDMPermission(false)
  .addSubcommand(sub('ofrecer', 'Offer a player to sign for your team', 'Ofrece un fichaje o una cesión a un jugador', (s) => {
    s.addUserOption(playerOpt(true));
    s.addStringOption(teamOpt(false, 'Team (default: yours)'));
    s.addStringOption((o) => o.setName('tipo').setDescription('Type').setDescriptionLocalizations(es2('Tipo')).addChoices({ name: 'Fichaje', value: 'fichaje' }, { name: 'Cesión (préstamo)', value: 'cesion' }));
    s.addStringOption((o) => o.setName('condiciones').setDescription('Contract, salary, clause…').setDescriptionLocalizations(es2('Contrato, sueldo, cláusula, duración…')).setMaxLength(300));
  }))
  .addSubcommand(sub('fichar', 'Staff: sign a player right away', 'Staff: ficha a un jugador directamente, sin oferta', (s) => {
    s.addUserOption(playerOpt(true));
    s.addStringOption(teamOpt(true));
    s.addStringOption((o) => o.setName('nota').setDescription('Note').setDescriptionLocalizations(es2('Nota (sale en el anuncio)')).setMaxLength(300));
  }))
  .addSubcommand(sub('libre', 'Release a player: free agent', 'Da de baja a un jugador: queda como agente libre', (s) => {
    s.addUserOption(playerOpt(true));
    s.addStringOption((o) => o.setName('motivo').setDescription('Reason').setDescriptionLocalizations(es2('Motivo (sale en el anuncio)')).setMaxLength(300));
  }))
  .addSubcommand(sub('plantilla', 'Players of a team', 'Los jugadores de un equipo', (s) => { s.addStringOption(teamOpt(true)); }))
  .addSubcommand(sub('historial', 'Latest transfers', 'Los últimos movimientos del mercado', (s) => {
    s.addUserOption((o) => o.setName('jugador').setDescription('Player').setDescriptionLocalizations(es2('Solo de este jugador')));
    s.addStringOption(teamOpt(false));
  }))
  .addSubcommand(sub('mercado', 'Staff: open or close the transfer window', 'Staff: abre o cierra la ventana de fichajes', (s) => {
    s.addStringOption((o) => o.setName('estado').setDescription('State').setDescriptionLocalizations(es2('Estado')).setRequired(true).addChoices({ name: 'Abrir', value: 'abrir' }, { name: 'Cerrar', value: 'cerrar' }));
  }))
  .addSubcommand(sub('config', 'Staff: channels, roles and teams of the market', 'Staff: canales, roles y equipos del mercado', (s) => {
    s.addChannelOption((o) => o.setName('anuncios').setDescription('Official announcements').setDescriptionLocalizations(es2('Canal de los anuncios oficiales')).addChannelTypes(...TEXT_CHANNELS));
    s.addChannelOption((o) => o.setName('ofertas').setDescription('Offers and rumors').setDescriptionLocalizations(es2('Canal de las ofertas y los rumores')).addChannelTypes(...TEXT_CHANNELS));
    s.addRoleOption((o) => o.setName('presidente').setDescription('Who can sign for a team').setDescriptionLocalizations(es2('Rol de los presidentes (los que ofrecen y venden)')));
    s.addRoleOption((o) => o.setName('agente_libre').setDescription('Free agent role').setDescriptionLocalizations(es2('Rol de los jugadores sin equipo')));
    s.addRoleOption((o) => o.setName('equipo_add').setDescription('Add a team').setDescriptionLocalizations(es2('Añade un rol como equipo')));
    s.addRoleOption((o) => o.setName('equipo_quitar').setDescription('Remove a team').setDescriptionLocalizations(es2('Quita un equipo')));
    s.addIntegerOption((o) => o.setName('maximo').setDescription('Max players per team (0 = no limit)').setDescriptionLocalizations(es2('Jugadores máximos por equipo (0 = sin límite)')).setMinValue(0).setMaxValue(99));
  }))
  .addSubcommand(sub('rumor', 'Drop a transfer rumor', 'Suelta un rumor de fichaje y los demás votan', (s) => {
    s.addStringOption((o) => o.setName('texto').setDescription('The rumor').setDescriptionLocalizations(es2('El rumor')).setRequired(true).setMaxLength(300));
  }));

async function autocomplete(i) {
  try {
    const g = i.guild;
    if (!g) return await i.respond([]);
    const c = C(g.id);
    const f = i.options.getFocused(true);
    if (f.name !== 'equipo') return await i.respond([]);
    let ids = c.teams;
    if (i.options.getSubcommand(false) === 'ofrecer' && !isStaff(i.member, g)) ids = teamsOf(i.member, c);
    const q = norm(f.value);
    const out = ids.map((id) => g.roles.cache.get(id)).filter((r) => r && (!q || norm(r.name).includes(q))).slice(0, 25).map((r) => ({ name: clip(r.name, 100), value: r.id }));
    await i.respond(out);
  } catch (e) { logErr(e); }
}

async function execute(i) {
  const g = i.guild;
  if (!g) return reply(i, 'Solo funciona dentro de un servidor.');
  const c = C(g.id);
  const s = i.options.getSubcommand();
  if (s === 'ofrecer') return ofrecer(i, g, c);
  if (s === 'fichar') return fichar(i, g, c);
  if (s === 'libre') return libre(i, g, c);
  if (s === 'plantilla') return plantilla(i, g, c);
  if (s === 'historial') return historial(i, g, c);
  if (s === 'mercado') return mercado(i, g, c);
  if (s === 'config') return config(i, g, c);
  if (s === 'rumor') return rumor(i, g, c);
}

const NO_TEAMS = '⚠️ Aún no hay equipos. El staff puede añadirlos con `/fichaje config equipo_add:@rol` (o aplicar una plantilla de liga con `/hacer`).';

/* ---- /fichaje ofrecer ---- */
async function ofrecer(i, g, c) {
  await i.deferReply({ flags: EPH });
  if (!c.teams.length) return reply(i, NO_TEAMS);
  if (!c.open) return reply(i, '🔴 El mercado está **cerrado**. Espera a que el staff lo abra.');
  const staff = isStaff(i.member, g);
  if (!staff && !isManager(i.member, c)) return reply(i, '⛔ Solo los presidentes' + (c.manager ? ' (' + rm(c.manager) + ')' : '') + ' y el staff pueden hacer ofertas.');
  const player = i.options.getMember('jugador');
  if (!player) return reply(i, '⚠️ Esa persona no está en el servidor.');
  if (player.user.bot) return reply(i, '🤖 No se puede fichar a un bot.');
  if (player.id === i.user.id) return reply(i, '⚠️ No puedes ficharte a ti mismo: pide a otro presidente que lo haga.');
  // equipo que ficha: el pedido o, si no, el del presidente
  const raw = i.options.getString('equipo');
  let to = raw ? resolveTeam(g, c, raw) : null;
  if (raw && !to) return reply(i, '⚠️ No encuentro ese equipo. Elige uno de la lista al escribir `equipo:`.');
  const mine = teamsOf(i.member, c);
  if (!to) {
    if (mine.length === 1) to = mine[0];
    else return reply(i, mine.length ? '⚠️ Estás en varios equipos: elige con `equipo:`.' : '⚠️ No estás en ningún equipo: elige con `equipo:`.');
  }
  if (!staff && !mine.includes(to)) return reply(i, '⛔ Solo puedes ofrecer fichajes para **tu** equipo.');
  const cur = teamsOf(player, c);
  if (cur.includes(to)) return reply(i, '⚠️ ' + um(player.id) + ' ya es de ' + rm(to) + '.');
  if (c.max > 0 && (await squadSize(g, to)) >= c.max) return reply(i, '⚠️ ' + rm(to) + ' tiene la plantilla completa (' + c.max + ' jugadores).');
  for (const o of Object.values(c.offers)) if (o.status === 'open' && o.player === player.id && o.to === to && o.exp > Date.now()) return reply(i, '⚠️ Ya hay una oferta abierta de ' + rm(to) + ' por ' + um(player.id) + '.');
  const chan = (await channelOf(g, c.market)) || i.channel;
  const miss = missingIn(g, chan);
  if (miss.length) return reply(i, '⚠️ Me falta en <#' + chan.id + '>: ' + miss.join(', ') + '.');
  sweep(c);
  const o = { id: newId(), status: 'open', step: cur.length ? 'club' : 'player', type: i.options.getString('tipo') === 'cesion' ? 'cesion' : 'fichaje', player: player.id, to, from: cur[0] || null, by: i.user.id, cond: i.options.getString('condiciones') || '', at: Date.now(), exp: Date.now() + T.offerTtl, msg: null };
  let content = '';
  let users = [];
  if (o.step === 'player') { content = um(player.id) + ' tienes una oferta de ' + rm(to) + ' 👇'; users = [player.id]; } else {
    await fetchMembers(g);
    const fr = g.roles.cache.get(o.from);
    users = fr ? [...fr.members.values()].filter((m) => isManager(m, c)).slice(0, 5).map((m) => m.id) : [];
    content = (users.length ? users.map(um).join(' ') : rm(o.from)) + ' ' + rm(to) + ' quiere fichar a ' + um(player.id) + '. ¿Aprobáis la venta? 👇';
  }
  let msg;
  try {
    msg = await chan.send({ ...view(o, o.step), content, allowedMentions: { users, roles: users.length ? [] : [o.from] } });
  } catch (e) { return reply(i, '❌ No pude publicar la oferta en <#' + chan.id + '>: ' + e.message); }
  o.msg = { ch: chan.id, id: msg.id };
  c.offers[o.id] = o;
  save();
  return reply(i, '✅ Oferta enviada a <#' + chan.id + '>. ' + (o.step === 'club' ? 'Primero la tiene que aprobar el club de origen y luego ' + um(player.id) + ' tiene que aceptar.' : um(player.id) + ' tiene 48 h para aceptar.'));
}

/* ---- /fichaje fichar (staff) ---- */
async function fichar(i, g, c) {
  await i.deferReply({ flags: EPH });
  if (!isStaff(i.member, g)) return reply(i, '⛔ Solo el staff puede fichar directamente.');
  const player = i.options.getMember('jugador');
  const to = resolveTeam(g, c, i.options.getString('equipo'));
  if (!player) return reply(i, '⚠️ Esa persona no está en el servidor.');
  if (player.user.bot) return reply(i, '🤖 No se puede fichar a un bot.');
  if (!to) return reply(i, c.teams.length ? '⚠️ No encuentro ese equipo. Elige uno de la lista al escribir `equipo:`.' : NO_TEAMS);
  const cur = teamsOf(player, c);
  if (cur.includes(to)) return reply(i, '⚠️ ' + um(player.id) + ' ya es de ' + rm(to) + '.');
  if (c.max > 0 && (await squadSize(g, to)) >= c.max) return reply(i, '⚠️ ' + rm(to) + ' tiene la plantilla completa (' + c.max + ' jugadores).');
  try { await setTeam(g, player, c, to, 'Fichaje (staff): ' + i.user.username); } catch (e) { return reply(i, '❌ ' + e.message); }
  const e = record(c, { kind: 'fichaje', player: player.id, from: cur[0] || null, to, by: i.user.id, cond: i.options.getString('nota') || '' });
  await announce(g, c, 'fichaje', e, i.channel);
  return reply(i, '✅ ' + um(player.id) + ' ficha por ' + rm(to) + '.');
}

/* ---- /fichaje libre ---- */
async function libre(i, g, c) {
  await i.deferReply({ flags: EPH });
  const player = i.options.getMember('jugador');
  if (!player) return reply(i, '⚠️ Esa persona no está en el servidor.');
  const cur = teamsOf(player, c);
  if (!cur.length) return reply(i, '⚠️ ' + um(player.id) + ' no tiene equipo.');
  const mine = teamsOf(i.member, c);
  if (!isStaff(i.member, g) && !(isManager(i.member, c) && mine.some((id) => cur.includes(id)))) return reply(i, '⛔ Solo el presidente de su equipo o el staff pueden darle de baja.');
  try { await setTeam(g, player, c, null, 'Baja: ' + i.user.username); } catch (e) { return reply(i, '❌ ' + e.message); }
  const e = record(c, { kind: 'baja', player: player.id, from: cur[0], to: null, by: i.user.id, cond: i.options.getString('motivo') || '' });
  await announce(g, c, 'baja', e, i.channel);
  return reply(i, '✅ ' + um(player.id) + ' queda libre.');
}

/* ---- /fichaje plantilla ---- */
async function plantilla(i, g, c) {
  await i.deferReply({ flags: EPH });
  const id = resolveTeam(g, c, i.options.getString('equipo'));
  if (!id) return reply(i, c.teams.length ? '⚠️ No encuentro ese equipo. Elige uno de la lista.' : NO_TEAMS);
  await fetchMembers(g);
  const role = g.roles.cache.get(id);
  const list = role ? [...role.members.values()].filter((m) => !m.user.bot) : [];
  list.sort((a, b) => (isManager(b, c) ? 1 : 0) - (isManager(a, c) ? 1 : 0) || String(a.displayName).localeCompare(String(b.displayName)));
  const shown = list.slice(0, 60).map((m) => (isManager(m, c) ? '👔 ' : '• ') + um(m.id)).join('\n');
  const e = new EmbedBuilder().setColor((role && role.color) || COLOR.blue).setTitle('📋 Plantilla · ' + (role ? role.name : '?'))
    .setDescription(list.length ? shown + (list.length > 60 ? '\n… y ' + (list.length - 60) + ' más' : '') : 'Aún no tiene jugadores.')
    .setFooter({ text: list.length + ' jugador' + (list.length === 1 ? '' : 'es') + (c.max ? ' · máximo ' + c.max : '') });
  return i.editReply({ embeds: [e], allowedMentions: NOMENT });
}

/* ---- /fichaje historial ---- */
async function historial(i, g, c) {
  await i.deferReply({ flags: EPH });
  const p = i.options.getUser ? i.options.getUser('jugador') : null;
  const teamRaw = i.options.getString('equipo');
  const team = teamRaw ? resolveTeam(g, c, teamRaw) : null;
  if (teamRaw && !team) return reply(i, '⚠️ No encuentro ese equipo.');
  let list = c.hist.slice().reverse();
  if (p) list = list.filter((e) => e.player === p.id);
  if (team) list = list.filter((e) => e.from === team || e.to === team);
  list = list.slice(0, 12);
  if (!list.length) return reply(i, 'Todavía no hay movimientos' + (p || team ? ' con ese filtro' : '') + '.');
  const line = (e) => '`#' + e.n + '` <t:' + Math.floor(e.at / 1000) + ':d> · ' + (e.kind === 'baja' ? '🚪 ' + um(e.player) + ' deja ' + (e.from ? rm(e.from) : '—') : (e.kind === 'cesion' ? '🔁 ' : '✅ ') + um(e.player) + ': ' + (e.from ? rm(e.from) : '🆓') + ' ➜ ' + rm(e.to));
  const e = new EmbedBuilder().setColor(COLOR.blue).setTitle('🗂️ Últimos movimientos').setDescription(list.map(line).join('\n'));
  return i.editReply({ embeds: [e], allowedMentions: NOMENT });
}

/* ---- /fichaje mercado ---- */
async function mercado(i, g, c) {
  await i.deferReply({ flags: EPH });
  if (!isStaff(i.member, g)) return reply(i, '⛔ Solo el staff puede abrir o cerrar el mercado.');
  const open = i.options.getString('estado') === 'abrir';
  if (c.open === open) return reply(i, open ? '🟢 El mercado ya estaba abierto.' : '🔴 El mercado ya estaba cerrado.');
  c.open = open;
  save();
  const ch = (await channelOf(g, c.announce)) || (await channelOf(g, c.market)) || i.channel;
  try {
    await ch.send({ embeds: [new EmbedBuilder().setColor(open ? COLOR.green : COLOR.red).setTitle(open ? '🟢 MERCADO ABIERTO' : '🔴 MERCADO CERRADO').setDescription(open ? 'Ya se pueden hacer ofertas con `/fichaje ofrecer`.' : 'No se pueden hacer ni aceptar fichajes hasta que se abra de nuevo.')] });
  } catch (_) { /* sin permiso: el estado queda guardado igualmente */ }
  return reply(i, (open ? '🟢 Mercado abierto' : '🔴 Mercado cerrado') + '. Aviso enviado a <#' + ch.id + '>.');
}

/* ---- /fichaje config ---- */
async function config(i, g, c) {
  await i.deferReply({ flags: EPH });
  if (!isStaff(i.member, g)) return reply(i, '⛔ Solo el staff puede cambiar la configuración.');
  const o = i.options;
  const ann = o.getChannel('anuncios'), off = o.getChannel('ofertas'), pres = o.getRole('presidente'), free = o.getRole('agente_libre');
  const add = o.getRole('equipo_add'), del = o.getRole('equipo_quitar'), max = o.getInteger('maximo');
  const touched = !!(ann || off || pres || free || add || del) || max !== null;
  const notes = [];
  if (ann) c.announce = ann.id;
  if (off) c.market = off.id;
  if (pres) c.manager = pres.id;
  if (free) c.free = free.id;
  if (max !== null) c.max = max;
  if (add) {
    if (add.id === g.id || add.managed) notes.push('⚠️ Ese rol no puede ser un equipo.');
    else if (!c.teams.includes(add.id)) { c.teams.push(add.id); notes.push('➕ Equipo añadido: ' + rm(add.id)); } else notes.push('↺ ' + rm(add.id) + ' ya era un equipo.');
  }
  if (del) {
    if (c.teams.includes(del.id)) { c.teams = c.teams.filter((x) => x !== del.id); notes.push('➖ Equipo quitado: ' + rm(del.id)); } else notes.push('⚠️ ' + rm(del.id) + ' no era un equipo.');
  }
  if (touched) save();
  const lines = [touched ? '✅ Guardado.' : 'ℹ️ Configuración actual:'];
  lines.push((c.open ? '🟢 Mercado abierto' : '🔴 Mercado cerrado') + ' · plantilla máxima: ' + (c.max || 'sin límite'));
  lines.push('📢 Anuncios: ' + (c.announce ? '<#' + c.announce + '>' : '—') + ' · 📝 Ofertas: ' + (c.market ? '<#' + c.market + '>' : '— (se usa el canal donde se escribe)'));
  lines.push('👔 Presidentes: ' + (c.manager ? rm(c.manager) : '— (solo el staff puede ofrecer)') + ' · 🆓 Agente libre: ' + (c.free ? rm(c.free) : '—'));
  lines.push('🏟️ Equipos (' + c.teams.length + '): ' + (c.teams.length ? c.teams.map(rm).join(' ').slice(0, 900) : '—'));
  for (const id of [c.announce, c.market]) {
    const ch = id && (await channelOf(g, id));
    const miss = ch ? missingIn(g, ch) : [];
    if (miss.length) lines.push('⚠️ Me falta en <#' + ch.id + '>: ' + miss.join(', ') + '.');
  }
  return reply(i, lines.concat(notes).join('\n'));
}

/* ---- /fichaje rumor ---- */
const lastRumor = new Map();
async function rumor(i, g, c) {
  await i.deferReply({ flags: EPH });
  const last = lastRumor.get(i.guildId + ':' + i.user.id) || 0;
  if (Date.now() - last < T.rumorCooldown) return reply(i, '⏳ Espera un poco antes de soltar otro rumor.');
  const chan = (await channelOf(g, c.market)) || i.channel;
  const miss = missingIn(g, chan);
  if (miss.length) return reply(i, '⚠️ Me falta en <#' + chan.id + '>: ' + miss.join(', ') + '.');
  const r = { id: newId(), by: i.user.id, text: i.options.getString('texto'), up: [], down: [], at: Date.now() };
  let msg;
  try { msg = await chan.send({ ...rumorView(r), allowedMentions: NOMENT }); } catch (e) { return reply(i, '❌ No pude publicar el rumor: ' + e.message); }
  r.msg = { ch: chan.id, id: msg.id };
  lastRumor.set(i.guildId + ':' + i.user.id, Date.now());
  c.rumors[r.id] = r;
  const ids = Object.keys(c.rumors);
  if (ids.length > T.keepRumors) for (const id of ids.slice(0, ids.length - T.keepRumors)) delete c.rumors[id];
  save();
  return reply(i, '🗞️ Rumor publicado en <#' + chan.id + '>.');
}

function rumorView(r) {
  const e = new EmbedBuilder().setColor(COLOR.orange).setTitle('🗞️ RUMOR').setDescription(clip(r.text, 300)).addFields({ name: 'Lo suelta', value: um(r.by), inline: true }, { name: 'Votos', value: '🟢 ' + r.up.length + ' creíble · 🔴 ' + r.down.length + ' falso', inline: true });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fich:ru:' + r.id).setLabel('Creíble').setEmoji('🟢').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('fich:rd:' + r.id).setLabel('Falso').setEmoji('🔴').setStyle(ButtonStyle.Secondary)
  );
  return { content: '', embeds: [e], components: [row] };
}

/* ============================ botones ============================ */
const owns = (i) => !!(i && i.customId && String(i.customId).startsWith('fich:'));

async function handle(i) {
  const [, act, id] = String(i.customId).split(':');
  const g = i.guild;
  if (!g) return;
  const c = C(g.id);
  if (act === 'ru' || act === 'rd') return vote(i, c, act, id);
  return offerButton(i, g, c, act, id);
}

async function vote(i, c, act, id) {
  const r = c.rumors[id];
  if (!r) return i.reply({ content: 'Ese rumor ya no está guardado.', flags: EPH });
  const mine = act === 'ru' ? r.up : r.down;
  const other = act === 'ru' ? r.down : r.up;
  const k = other.indexOf(i.user.id);
  if (k >= 0) other.splice(k, 1);
  const j = mine.indexOf(i.user.id);
  if (j >= 0) mine.splice(j, 1); else mine.push(i.user.id); // pulsar de nuevo quita el voto
  save();
  return i.update(rumorView(r));
}

async function offerButton(i, g, c, act, id) {
  const o = c.offers[id];
  if (!o || o.status !== 'open') return i.reply({ content: 'Esta oferta ya no está activa.', flags: EPH });
  if (o.exp < Date.now()) {
    o.status = 'expired';
    save();
    return i.update(view(o, 'expired'));
  }
  const staff = isStaff(i.member, g);
  const canSell = o.step === 'club' && (staff || (isManager(i.member, c) && teamsOf(i.member, c).includes(o.from)));
  const deny = (t) => i.reply({ content: t, flags: EPH });

  if (act === 'cancel') {
    if (i.user.id !== o.by && !staff) return deny('⛔ Solo quien hizo la oferta o el staff pueden retirarla.');
    o.status = 'cancelled';
    save();
    return i.update(view(o, 'cancelled', i.user.id));
  }
  if (act === 'rej') {
    if (i.user.id !== o.player && !canSell) return deny(o.step === 'club' ? '⛔ Solo los presidentes del club de origen (o el staff) pueden rechazarla.' : '⛔ Solo ' + um(o.player) + ' puede rechazar esta oferta.');
    o.status = 'rejected';
    save();
    return i.update(view(o, 'rejected', i.user.id));
  }
  if (act === 'sell') {
    if (!canSell) return deny('⛔ Solo los presidentes de ' + (o.from ? rm(o.from) : 'su club') + ' (o el staff) pueden aprobar la venta.');
    o.step = 'player';
    save();
    await i.update(view(o, 'player'));
    try { await i.channel.send({ content: um(o.player) + ' ' + rm(o.from) + ' aprobó la venta: tienes una oferta de ' + rm(o.to) + ' 👆', allowedMentions: { users: [o.player] }, reply: { messageReference: i.message.id, failIfNotExists: false } }); } catch (e) { logErr(e); }
    return;
  }
  if (act === 'acc') {
    if (i.user.id !== o.player) return deny('⛔ Solo ' + um(o.player) + ' puede aceptar esta oferta.');
    if (o.step !== 'player') return deny('⏳ Antes tiene que aprobar la venta el club de origen.');
    if (!c.open) return deny('🔴 El mercado está cerrado: no se puede completar el fichaje ahora. La oferta sigue abierta hasta que caduque.');
    await i.deferUpdate();
    const fail = async (why) => { o.status = 'failed'; save(); await i.editReply(view(o, 'failed', why)); };
    const member = await g.members.fetch(o.player).catch(() => null);
    if (!member) return fail('el jugador ya no está en el servidor');
    const cur = teamsOf(member, c);
    if (cur.includes(o.to)) return fail('ya es de ese equipo');
    if (c.max > 0 && (await squadSize(g, o.to)) >= c.max) return fail('el equipo tiene la plantilla completa');
    try { await setTeam(g, member, c, o.to, 'Fichaje aceptado (oferta ' + o.id + ')'); } catch (e) {
      await i.followUp({ content: '❌ ' + e.message, flags: EPH });
      return; // la oferta sigue abierta: se puede volver a intentar cuando se arregle el permiso
    }
    o.status = 'done';
    const e = record(c, { kind: o.type, player: o.player, from: cur[0] || null, to: o.to, by: o.by, cond: o.cond });
    await i.editReply(view({ ...o, from: cur[0] || null }, 'done'));
    await announce(g, c, o.type === 'cesion' ? 'cesion' : 'fichaje', e, i.channel);
    return;
  }
}

module.exports = {
  commands: [{ data, execute, autocomplete }],
  owns,
  handle,
  setup,
  autocomplete,
  _store: store,
  _t: T,
  _C: C,
};
