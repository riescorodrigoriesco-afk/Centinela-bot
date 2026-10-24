'use strict';

/*
 * hub.js — Único comando slash: /help. Desde ahí se abre:
 *   · la tabla de ayuda (funciones + todos los comandos por categoría),
 *   · el menú de instalación (módulos con casillas + botón Activar),
 *   · el panel de ajustes (activar/desactivar y editar valores de cada módulo).
 * Todos los demás comandos siguen disponibles con prefijo ($).
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits: P,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const bot = require('./bot');
const guard = require('./guard');
const games = require('./games');

const { getCfg, saveCfg, L, COLOR, logErr, canConfigure, lockedMsg, sendLog, mkEmbed, isStaff, isTrusted } = bot;
const EPHEMERAL = MessageFlags.Ephemeral;

const idOf = (s) => {
  const m = String(s || '').trim().match(/^(?:<(?:@[!&]?|#)(\d{15,25})>|(\d{15,25}))$/);
  return m ? m[1] || m[2] : null;
};
const getP = (o, p) => p.reduce((a, k) => a[k], o);
const setP = (o, p, v) => {
  getP(o, p.slice(0, -1))[p[p.length - 1]] = v;
};
const emb = (color, title, desc) => {
  const e = new EmbedBuilder().setColor(color).setTitle(String(title).slice(0, 250));
  if (desc) e.setDescription(String(desc).slice(0, 4000));
  return e;
};
const dot = (b) => (b ? '🟢' : '🔴');
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/* ============================ módulos ============================ */
// n: [en, es] nombre · d: [en, es] descripción · on: ruta del interruptor · rec: marcado por defecto en la instalación
const MODS = [
  { id: 'prefix', ico: '↪️', n: ['Prefix', 'Prefijo'], d: ['Enable text commands with a prefix', 'Activar los comandos por prefijo'], on: ['prefixEnabled'], rec: true,
    fields: [{ p: ['prefix'], n: ['Prefix (1–3 characters)', 'Prefijo (1–3 caracteres)'], t: 'text', max: 3 }] },
  { id: 'raidmode', ico: '🛡️', n: ['Auto RaidMode', 'Auto RaidMode'], d: ['Max people allowed to join in a time window', 'Máximo de personas que pueden unirse en un intervalo'], on: ['joinFlood', 'enabled'], rec: true,
    fields: [
      { p: ['joinFlood', 'limit'], n: ['Max joins per window', 'Máx. ingresos por intervalo'], t: 'int', min: 2, max: 50 },
      { p: ['joinFlood', 'windowSec'], n: ['Window (seconds)', 'Intervalo (segundos)'], t: 'int', min: 2, max: 120 },
      { p: ['joinFlood', 'action'], n: ['Action: kick / ban / timeout', 'Acción: kick / ban / timeout'], t: 'choice', c: ['kick', 'ban', 'timeout'] },
      { p: ['joinFlood', 'raidMinutes'], n: ['Raid mode minutes', 'Minutos de modo raid'], t: 'int', min: 1, max: 1440 },
    ] },
  { id: 'captcha', ico: '🔁', n: ['Captcha', 'Captcha'], d: ['Block raids with a button + math captcha', 'Bloquear raids con botón y pregunta de verificación'], on: ['verification', 'enabled'], rec: true, after: 'captcha',
    fields: [
      { p: ['verification', 'channel'], n: ['Verification channel (ID or #)', 'Canal de verificación (ID o #)'], t: 'channel' },
      { p: ['verification', 'role'], n: ['Verified role (ID or @)', 'Rol de verificado (ID o @)'], t: 'role' },
    ] },
  { id: 'minage', ico: '📅', n: ['Minimum account age', 'Antigüedad mínima'], d: ['Minimum account age to be allowed in', 'Antigüedad mínima de cuenta para poder unirse'], rec: true,
    get: (c) => c.minAccountAgeDays > 0, set: (c, v) => { c.minAccountAgeDays = v ? c.minAccountAgeDays || 3 : 0; },
    fields: [{ p: ['minAccountAgeDays'], n: ['Minimum age in days (0 = off)', 'Días mínimos (0 = apagado)'], t: 'int', min: 0, max: 365 }] },
  { id: 'antispam', ico: '🚫', n: ['Anti-spam', 'Anti-spam'], d: ['Protection against message floods', 'Protección contra ráfagas de mensajes'], on: ['antiSpam', 'enabled'], rec: true,
    fields: [
      { p: ['antiSpam', 'limit'], n: ['Messages allowed', 'Mensajes permitidos'], t: 'int', min: 3, max: 30 },
      { p: ['antiSpam', 'windowSec'], n: ['Window (seconds)', 'Intervalo (segundos)'], t: 'int', min: 2, max: 60 },
      { p: ['antiSpam', 'timeoutMin'], n: ['Timeout minutes', 'Minutos de aislamiento'], t: 'int', min: 1, max: 1440 },
    ] },
  { id: 'mention', ico: '📣', n: ['Mass mentions', 'Menciones masivas'], d: ['Stops messages that ping too many people', 'Frena mensajes que mencionan a demasiada gente'], on: ['antiMassMention', 'enabled'], rec: true,
    fields: [{ p: ['antiMassMention', 'limit'], n: ['Max mentions per message', 'Máx. menciones por mensaje'], t: 'int', min: 2, max: 50 }] },
  { id: 'everyone', ico: '📢', n: ['@everyone bypass', '@everyone sin permiso'], d: ['Deletes @everyone/@here from people without permission', 'Borra @everyone/@here de quien no tiene permiso'], on: ['antiEveryone', 'enabled'], rec: true, fields: [] },
  { id: 'iplogger', ico: '🕵️', n: ['IP loggers', 'Robadores de IP'], d: ['Blocks IP grabber and fake gift links', 'Bloquea links que roban la IP y falsos regalos'], on: ['antiIpLogger', 'enabled'], rec: true, fields: [] },
  { id: 'invite', ico: '✉️', n: ['Invite links', 'Invitaciones'], d: ['Deletes invites to other servers', 'Borra invitaciones a otros servidores'], on: ['antiInvite', 'enabled'], fields: [] },
  { id: 'link', ico: '🔗', n: ['Links', 'Enlaces'], d: ['Deletes links except allowed domains', 'Borra enlaces salvo dominios permitidos'], on: ['antiLink', 'enabled'],
    fields: [{ p: ['antiLink', 'allow'], n: ['Allowed domains (comma separated)', 'Dominios permitidos (separados por coma)'], t: 'list' }] },
  { id: 'caps', ico: '🔠', n: ['Capital letters', 'Mayúsculas'], d: ['Deletes messages in ALL CAPS', 'Borra mensajes escritos en MAYÚSCULAS'], on: ['antiCaps', 'enabled'],
    fields: [
      { p: ['antiCaps', 'percent'], n: ['Percent of capitals', 'Porcentaje de mayúsculas'], t: 'int', min: 30, max: 100 },
      { p: ['antiCaps', 'minLength'], n: ['Minimum message length', 'Largo mínimo del mensaje'], t: 'int', min: 5, max: 200 },
    ] },
  { id: 'emoji', ico: '😀', n: ['Emoji spam', 'Spam de emojis'], d: ['Deletes messages with too many emojis', 'Borra mensajes con demasiados emojis'], on: ['antiEmoji', 'enabled'],
    fields: [{ p: ['antiEmoji', 'limit'], n: ['Max emojis per message', 'Máx. emojis por mensaje'], t: 'int', min: 3, max: 50 }] },
  { id: 'antinuke', ico: '💥', n: ['Anti-nuke', 'Anti-nuke'], d: ['Stops mass deletions/bans and restores what was deleted', 'Frena borrados/baneos masivos y restaura lo borrado'], on: ['antiNuke', 'enabled'], rec: true,
    fields: [
      { p: ['antiNuke', 'limit'], n: ['Total actions allowed', 'Acciones totales permitidas'], t: 'int', min: 2, max: 30 },
      { p: ['antiNuke', 'windowSec'], n: ['Total window (seconds)', 'Intervalo total (segundos)'], t: 'int', min: 3, max: 120 },
      { p: ['antiNuke', 'perTypeLimit'], n: ['Actions of one type', 'Acciones de un mismo tipo'], t: 'int', min: 1, max: 30 },
      { p: ['antiNuke', 'perTypeWindowSec'], n: ['Per-type window (seconds)', 'Intervalo por tipo (segundos)'], t: 'int', min: 10, max: 600 },
      { p: ['antiNuke', 'restore'], n: ['Restore deleted items (on/off)', 'Restaurar lo borrado (on/off)'], t: 'bool' },
    ] },
  { id: 'antibot', ico: '🤖', n: ['Anti bot-add', 'Anti bots'], d: ['Removes bots nobody approved and punishes who added them', 'Saca bots no aprobados y sanciona a quien los añadió'], on: ['antiBotAdd', 'enabled'], rec: true,
    fields: [{ p: ['antiBotAdd', 'punishAdder'], n: ['Punish adder: ban / kick / none', 'Sanción: ban / kick / none'], t: 'choice', c: ['ban', 'kick', 'none'] }] },
  { id: 'permguard', ico: '🔐', n: ['Permission guard', 'Guardia de permisos'], d: ['Reverts dangerous roles given by untrusted people', 'Revierte roles peligrosos dados por no confiables'], on: ['permGuard', 'enabled'], rec: true, fields: [] },
  { id: 'guildguard', ico: '🏰', n: ['Server guard', 'Guardia del servidor'], d: ['Reverts server rename and webhook abuse', 'Revierte cambios de nombre y abuso de webhooks'], on: ['guildGuard', 'enabled'], rec: true, fields: [] },
  { id: 'mutevasion', ico: '🎭', n: ['Mute evasion', 'Evasión de mute'], d: ['Re-mutes who leaves and rejoins to dodge a mute', 'Vuelve a silenciar a quien sale y entra para evadirlo'], on: ['antiMuteEvasion', 'enabled'], rec: true, fields: [] },
  { id: 'globalban', ico: '🌐', n: ['Global ban', 'Ban global'], d: ['Blocks users banned by the bot owner in every server', 'Bloquea a usuarios vetados por el dueño del bot'], on: ['globalBan', 'enabled'], rec: true, fields: [] },
  { id: 'warns', ico: '⚠️', n: ['Progressive warnings', 'Advertencias progresivas'], d: ['Warn → mute → kick → ban as faults add up', 'Aviso → silencio → expulsión → baneo según las faltas'], on: ['autoWarn', 'enabled'], rec: true,
    fields: [
      { p: ['autoWarn', 'muteAt'], n: ['Mute at N warnings (0 = never)', 'Silenciar a las N faltas (0 = nunca)'], t: 'int', min: 0, max: 20 },
      { p: ['autoWarn', 'muteMin'], n: ['Mute minutes', 'Minutos de silencio'], t: 'int', min: 1, max: 1440 },
      { p: ['autoWarn', 'kickAt'], n: ['Kick at N warnings (0 = never)', 'Expulsar a las N faltas (0 = nunca)'], t: 'int', min: 0, max: 30 },
      { p: ['autoWarn', 'banAt'], n: ['Ban at N warnings (0 = never)', 'Banear a las N faltas (0 = nunca)'], t: 'int', min: 0, max: 50 },
      { p: ['autoWarn', 'expireDays'], n: ['Warnings expire after (days)', 'Las faltas caducan a los (días)'], t: 'int', min: 1, max: 365 },
    ] },
  { id: 'reports', ico: '🚩', n: ['Reports', 'Reportes'], d: ['Members report suspicious activity with the report command', 'Los miembros reportan actividad sospechosa a tu equipo'], on: ['reports', 'enabled'], rec: true,
    fields: [{ p: ['reports', 'channel'], n: ['Reports channel (ID or #, empty = mod logs)', 'Canal de reportes (ID o #, vacío = logs de mod)'], t: 'channel' }] },
  { id: 'tagrole', ico: '🏷️', n: ['Tag role', 'Rol de etiqueta'], d: ['Give a role to members who wear your server tag', 'Da un rol a los miembros que llevan la etiqueta del servidor'], on: ['tagRole', 'enabled'], rec: true, after: 'tagrole',
    fields: [{ p: ['tagRole', 'role'], n: ['Role (ID or @)', 'Rol (ID o @)'], t: 'role' }] },
  { id: 'dmblock', ico: '💬', n: ['DM lock', 'Bloqueo de MD'], d: ['Close member DMs to stop phishing and scam attempts', 'Prevenir phishing o estafas cerrando los MD'], on: ['dmBlock', 'enabled'], rec: true, after: 'dmblock',
    fields: [{ p: ['dmBlock', 'hours'], n: ['Hours per cycle (1–24, renews itself)', 'Horas por ciclo (1–24, se renueva solo)'], t: 'int', min: 1, max: 24 }] },
  { id: 'honeypot', ico: '🍯', n: ['HoneyPot', 'HoneyPot'], d: ['Trap channel that punishes whoever writes in it', 'Canal trampa que sanciona a quien escribe en él'], on: ['honeypot', 'enabled'], rec: true, after: 'honeypot',
    fields: [
      { p: ['honeypot', 'action'], n: ['Action: ban / kick / timeout', 'Acción: ban / kick / timeout'], t: 'choice', c: ['ban', 'kick', 'timeout'] },
      { p: ['honeypot', 'channel'], n: ['Trap channel (ID or #)', 'Canal trampa (ID o #)'], t: 'channel' },
    ] },
];
const MOD = new Map(MODS.map((m) => [m.id, m]));
const isOn = (cfg, m) => (m.get ? m.get(cfg) : !!getP(cfg, m.on));
const setOn = (cfg, m, v) => (m.set ? m.set(cfg, v) : setP(cfg, m.on, v));
const mn = (lc, m) => L(lc, m.n[0], m.n[1]);
const md = (lc, m) => L(lc, m.d[0], m.d[1]);

/* ============================ acciones al activar ============================ */
async function ensureLogs(g, cfg, out) {
  if (cfg.logs.raid.length) return;
  const me = g.members.me;
  if (!me.permissions.has(P.ManageChannels)) return out.push('⚠️ ' + 'Logs: falta Gestionar canales');
  let cat = g.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Centinela');
  if (!cat) {
    cat = await g.channels.create({
      name: 'Centinela',
      type: ChannelType.GuildCategory,
      reason: 'Centinela install',
      permissionOverwrites: [
        { id: g.id, type: 0, deny: [P.ViewChannel] },
        { id: me.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] },
      ],
    });
  }
  const wanted = { 'raid-logs': ['raid'], 'mod-logs': ['mod'], 'server-logs': ['server'], 'message-logs': ['messages'], 'member-logs': ['welcome', 'goodbye'] };
  for (const [name, types] of Object.entries(wanted)) {
    let ch = g.channels.cache.find((c) => c.parentId === cat.id && c.name === name && c.type === ChannelType.GuildText);
    if (!ch) {
      ch = await g.channels.create({ name, type: ChannelType.GuildText, parent: cat.id, reason: 'Centinela install' });
      await ch.lockPermissions().catch(() => {});
    }
    for (const t of types) if (!cfg.logs[t].includes(ch.id)) cfg.logs[t].push(ch.id);
  }
  out.push('📜 Canales de logs creados en la categoría **Centinela**');
}

async function ensureCaptcha(g, cfg, out, lc) {
  const v = cfg.verification;
  let role = v.role && g.roles.cache.get(v.role);
  let ch = v.channel && g.channels.cache.get(v.channel);
  if (role && ch) return;
  const me = g.members.me;
  if (!me.permissions.has(P.ManageRoles) || !me.permissions.has(P.ManageChannels)) {
    v.enabled = false;
    return out.push('⚠️ Captcha: faltan permisos **Gestionar roles** y **Gestionar canales**');
  }
  if (!role) role = await g.roles.create({ name: 'Verificado', reason: 'Centinela captcha' });
  if (!ch) {
    ch = await g.channels.create({
      name: 'verificación',
      type: ChannelType.GuildText,
      reason: 'Centinela captcha',
      permissionOverwrites: [{ id: g.id, type: 0, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] }],
    });
  }
  const e = emb(COLOR.blue, '✅ ' + L(lc, 'Verification', 'Verificación'), L(lc, 'Press the button and answer a quick question to get access to the server.', 'Pulsa el botón y responde una pregunta rápida para entrar al servidor.'));
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('v:start').setLabel(L(lc, 'Verify', 'Verificarme')).setEmoji('✅').setStyle(ButtonStyle.Success));
  await ch.send({ embeds: [e], components: [row] });
  v.role = role.id;
  v.channel = ch.id;
  out.push('✅ Captcha: canal <#' + ch.id + '> y rol **' + role.name + '**. Haz que @everyone solo vea ese canal y que **' + role.name + '** vea el resto.');
}

async function ensureHoneypot(g, cfg, out) {
  if (cfg.honeypot.channel && g.channels.cache.has(cfg.honeypot.channel)) return;
  if (!g.members.me.permissions.has(P.ManageChannels)) {
    cfg.honeypot.enabled = false;
    return out.push('⚠️ HoneyPot: falta **Gestionar canales**');
  }
  const ch = await g.channels.create({ name: 'no-escribir', type: ChannelType.GuildText, reason: 'Centinela honeypot', topic: 'Canal trampa: quien escriba aquí será sancionado automáticamente.' });
  await ch.send('⚠️ **No escribas aquí.** Este canal es una trampa para bots y raiders: quien envíe un mensaje será sancionado automáticamente.').catch(() => {});
  cfg.honeypot.channel = ch.id;
  out.push('🍯 HoneyPot: canal <#' + ch.id + '> (acción: ' + cfg.honeypot.action + ')');
}

async function ensureTagRole(g, cfg, out) {
  if (cfg.tagRole.role && g.roles.cache.has(cfg.tagRole.role)) return;
  if (!g.members.me.permissions.has(P.ManageRoles)) {
    cfg.tagRole.enabled = false;
    return out.push('⚠️ Rol de etiqueta: falta **Gestionar roles**');
  }
  const role = await g.roles.create({ name: 'Etiqueta del servidor', reason: 'Centinela tag role' });
  cfg.tagRole.role = role.id;
  out.push('🏷️ Rol de etiqueta: **' + role.name + '** (se da a quien lleve la etiqueta del servidor)');
}

async function applyDm(g, cfg, out) {
  try {
    if (cfg.dmBlock.enabled) {
      const until = new Date(Date.now() + cfg.dmBlock.hours * 3600000);
      await g.setIncidentActions({ dmsDisabledUntil: until, invitesDisabledUntil: g.incidentsData ? g.incidentsData.invitesDisabledUntil || null : null });
      cfg.dmBlock.until = until.getTime();
      if (out) out.push('💬 MD cerrados por ' + cfg.dmBlock.hours + ' h (se renuevan solos)');
    } else {
      await g.setIncidentActions({ dmsDisabledUntil: null, invitesDisabledUntil: g.incidentsData ? g.incidentsData.invitesDisabledUntil || null : null });
      cfg.dmBlock.until = 0;
    }
  } catch (e) {
    cfg.dmBlock.enabled = false;
    if (out) out.push('⚠️ Bloqueo de MD: no se pudo aplicar (' + clip(e.message, 80) + ')');
  }
}

async function runAfter(g, cfg, m, out, lc) {
  try {
    if (m.after === 'captcha') await ensureCaptcha(g, cfg, out, lc);
    else if (m.after === 'honeypot') await ensureHoneypot(g, cfg, out);
    else if (m.after === 'tagrole') {
      await ensureTagRole(g, cfg, out);
      syncTagRole(g).catch(logErr);
    } else if (m.after === 'dmblock') await applyDm(g, cfg, out);
  } catch (e) {
    out.push('⚠️ ' + m.id + ': ' + clip(e.message, 100));
  }
}

/* ============================ rol de etiqueta ============================ */
function hasTag(user, g) {
  const pg = user.primaryGuild || user.clan;
  return !!pg && pg.identityEnabled !== false && String(pg.identityGuildId || pg.guildId) === g.id;
}
async function tagSync(member) {
  const g = member.guild;
  const cfg = getCfg(g.id);
  if (!cfg.tagRole.enabled || !cfg.tagRole.role || member.user.bot) return;
  const role = g.roles.cache.get(cfg.tagRole.role);
  if (!role || role.managed || role.comparePositionTo(g.members.me.roles.highest) >= 0) return;
  const has = member.roles.cache.has(role.id);
  const want = hasTag(member.user, g);
  if (want && !has) await member.roles.add(role, 'Centinela: server tag').catch(() => {});
  else if (!want && has) await member.roles.remove(role, 'Centinela: server tag removed').catch(() => {});
}
async function syncTagRole(g) {
  const members = await g.members.fetch().catch(() => g.members.cache);
  for (const m of members.values()) await tagSync(m);
}

/* ============================ ciclo de MD ============================ */
function startDmRenew(client) {
  const t = setInterval(() => {
    for (const g of client.guilds.cache.values()) {
      const cfg = getCfg(g.id);
      if (cfg.dmBlock.enabled && (cfg.dmBlock.until || 0) - Date.now() < 3600000) applyDm(g, cfg, null).then(saveCfg).catch(logErr);
    }
  }, 30 * 60000);
  if (t.unref) t.unref();
}

/* ============================ catálogo de comandos ============================ */
const GAME_ES = {};
const gameCmds = games.commands.map((c) => {
  const j = c.data.toJSON();
  return { name: j.name, es: (j.description_localizations && (j.description_localizations['es-ES'] || j.description_localizations['es-419'])) || j.description, en: j.description, level: 'public', alias: (j.name_localizations && (j.name_localizations['es-ES'] || j.name_localizations['es-419'])) || null, exec: c, json: j };
});
for (const g of gameCmds) if (g.alias) GAME_ES[g.alias.toLowerCase()] = g;
const GAME_BY = new Map(gameCmds.map((g) => [g.name, g]));
for (const [k, v] of Object.entries(GAME_ES)) if (!GAME_BY.has(k)) GAME_BY.set(k, v);

const HUB_EXTRA = [
  { name: 'help', en: 'This help table', es: 'Esta tabla de ayuda (también /help)', level: 'public', cat: 'util', aliases: ['ayuda', 'comandos'] },
  { name: 'install', en: 'Choose and activate protection modules', es: 'Elige y activa los módulos de protección', level: 'cfg', cat: 'prot', aliases: ['instalar'] },
  { name: 'panel', en: 'Edit every setting of every module', es: 'Edita todos los ajustes de cada módulo', level: 'cfg', cat: 'prot', aliases: ['ajustes'] },
  { name: 'report', en: 'Report suspicious activity to the staff', es: 'Reporta actividad sospechosa al equipo', level: 'public', cat: 'mod', aliases: ['reportar'] },
];
const CAT_OF = {
  prot: ['autosetup', 'install', 'panel', 'config', 'settings', 'check', 'whitelist', 'delwhitelist', 'whitelisted', 'canalwhite', 'delcanalwhite', 'listcanalwhite', 'setprefix', 'verify', 'panic'],
  back: ['b-create', 'b-list', 'b-delete', 'b-auto', 'b-load'],
  mod: ['clear', 'lockserver', 'unlockserver', 'nuke', 'delchan', 'snipe', 'idban', 'idunban', 'mute', 'unmute', 'warn', 'warnings', 'clearwarns', 'report', 'apelar', 'gban', 'ungban'],
  util: ['help', 'tutorial', 'invite', 'ping', 'server', 'perfil'],
};
function catalog() {
  const all = new Map();
  for (const c of guard.CMDS) all.set(c.name, { name: c.name, en: c.d, es: c.es || c.d, level: c.level || 'public', aliases: c.aliases || [] });
  for (const c of HUB_EXTRA) all.set(c.name, c);
  const out = [];
  for (const [cat, names] of Object.entries(CAT_OF)) for (const n of names) if (all.has(n)) out.push({ ...all.get(n), cat });
  for (const g of gameCmds) out.push({ name: g.name, en: g.en, es: g.es, level: 'public', aliases: g.alias ? [g.alias] : [], cat: 'game' });
  for (const n of ['camisa', 'camisatop', 'setcamisas']) if (all.has(n)) out.push({ ...all.get(n), cat: 'game' });
  return out;
}
function publicCatalog() {
  return {
    commands: catalog().map((c) => ({ name: c.name, en: c.en, es: c.es, level: c.level, aliases: c.aliases || [], cat: c.cat })),
    modules: MODS.map((m) => ({ id: m.id, ico: m.ico, en: m.n[0], es: m.n[1], d_en: m.d[0], d_es: m.d[1], editable: m.fields.length > 0 })),
  };
}

/* ============================ vistas ============================ */
const PAGES = ['mods', 'prot', 'back', 'mod', 'util', 'game'];
const PAGE_NAME = {
  mods: ['⚙️ Functions', '⚙️ Funciones'],
  prot: ['🛡️ Protection & setup', '🛡️ Protección y configuración'],
  back: ['💾 Backups', '💾 Backups'],
  mod: ['🔨 Moderation & reports', '🔨 Moderación y reportes'],
  util: ['ℹ️ Utilities', 'ℹ️ Utilidades'],
  game: ['🎮 Games & economy', '🎮 Juegos y economía'],
};
const LEVEL_NAME = { public: ['everyone', 'todos'], mod: ['moderators', 'moderadores'], cfg: ['configurators', 'configuración'], owner: ['server owner', 'dueño'], botowner: ['bot owner', 'dueño del bot'] };

function helpView(i, page) {
  const lc = i.locale;
  const g = i.guild;
  const cfg = getCfg(g.id);
  const p = cfg.prefix || '$';
  page = PAGES.includes(page) ? page : 'mods';
  const e = emb(COLOR.blue, '🛡️ Centinela · ' + L(lc, PAGE_NAME[page][0], PAGE_NAME[page][1]));
  if (page === 'mods') {
    e.setDescription(
      L(lc, 'Every function can be turned on/off and tuned in **Settings**. 🟢 on · 🔴 off.\n\n', 'Cada función se activa/desactiva y se ajusta en **Ajustes**. 🟢 activa · 🔴 apagada.\n\n') +
        MODS.map((m) => dot(isOn(cfg, m)) + ' ' + m.ico + ' **' + mn(lc, m) + '** — ' + md(lc, m)).join('\n')
    );
  } else {
    const list = catalog().filter((c) => c.cat === page);
    const w = Math.max(...list.map((c) => (page === 'game' ? 1 : p.length) + c.name.length)) + 2;
    const rows = list.map((c) => {
      const left = ((page === 'game' ? p : p) + c.name).padEnd(w);
      return left + clip(L(lc, c.en, c.es), 60);
    });
    e.setDescription(
      L(lc, 'Prefix: ', 'Prefijo: ') + '`' + p + '` · ' + L(lc, 'Only ', 'Solo ') + '`/help` ' + L(lc, 'is a slash command; everything else uses the prefix.', 'es slash; todo lo demás usa el prefijo.') +
        '\n```\n' + rows.join('\n') + '\n```' +
        (page !== 'game' ? L(lc, 'Who can use them: ', 'Quién puede usarlos: ') + [...new Set(list.map((c) => L(lc, LEVEL_NAME[c.level][0], LEVEL_NAME[c.level][1])))].join(', ') : '')
    );
  }
  const sel = new StringSelectMenuBuilder()
    .setCustomId('h:cat')
    .setPlaceholder(L(lc, 'Choose a section', 'Elige una sección'))
    .addOptions(PAGES.map((k) => ({ label: L(lc, PAGE_NAME[k][0], PAGE_NAME[k][1]).slice(0, 100), value: k, default: k === page })));
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('h:install').setLabel(L(lc, 'Install modules', 'Instalar módulos')).setEmoji('📦').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('h:set').setLabel(L(lc, 'Settings', 'Ajustes')).setEmoji('⚙️').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [e], components: [new ActionRowBuilder().addComponents(sel), row2] };
}

const picks = new Map(); // guildId:userId → Set de módulos elegidos en la instalación
const pickKey = (i) => i.guildId + ':' + i.user.id;

function installView(i) {
  const lc = i.locale;
  const cfg = getCfg(i.guildId);
  let set = picks.get(pickKey(i));
  if (!set) {
    set = new Set(MODS.filter((m) => m.rec).map((m) => m.id));
    picks.set(pickKey(i), set);
  }
  const e = emb(
    COLOR.red,
    L(lc, 'Installation', 'Instalación'),
    L(
      lc,
      'Pick the functions you want and press **Activate**. Modules you leave unchecked stay as they are. Anything the bot has to create (log channels, roles, trap channels) is listed afterwards.',
      'Elige las funciones que quieres y pulsa **Activar**. Los módulos que dejes sin marcar no se tocan. Lo que el bot tenga que crear (canales de logs, roles, canales trampa) se lista al final.'
    )
  );
  const sel = new StringSelectMenuBuilder()
    .setCustomId('h:inst')
    .setPlaceholder(L(lc, 'Choose the modules to install', 'Elige los módulos a instalar'))
    .setMinValues(0)
    .setMaxValues(MODS.length)
    .addOptions(MODS.map((m) => ({ label: clip(mn(lc, m), 100), description: clip(md(lc, m), 100), emoji: m.ico, value: m.id, default: set.has(m.id) })));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('h:instgo').setLabel(L(lc, 'Activate', 'Activar')).setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('h:set').setLabel(L(lc, 'Settings', 'Ajustes')).setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('h:cat:mods').setLabel(L(lc, 'Back to help', 'Volver a la ayuda')).setStyle(ButtonStyle.Secondary)
  );
  e.setFooter({ text: L(lc, set.size + ' selected · ' + MODS.filter((m) => isOn(cfg, m)).length + ' already on', set.size + ' elegidos · ' + MODS.filter((m) => isOn(cfg, m)).length + ' ya activos') });
  return { embeds: [e], components: [new ActionRowBuilder().addComponents(sel), row] };
}

function settingsView(i) {
  const lc = i.locale;
  const cfg = getCfg(i.guildId);
  const e = emb(
    COLOR.blue,
    '⚙️ ' + L(lc, 'Settings', 'Ajustes'),
    L(lc, 'Pick a module to switch it on/off or edit its values.\n\n', 'Elige un módulo para activarlo/apagarlo o editar sus valores.\n\n') + MODS.map((m) => dot(isOn(cfg, m)) + ' ' + m.ico + ' ' + mn(lc, m)).join('\n')
  );
  const sel = new StringSelectMenuBuilder()
    .setCustomId('h:mod')
    .setPlaceholder(L(lc, 'Choose a module', 'Elige un módulo'))
    .addOptions(MODS.map((m) => ({ label: clip(mn(lc, m), 100), description: clip((isOn(cfg, m) ? '🟢 ' : '🔴 ') + md(lc, m), 100), emoji: m.ico, value: m.id })));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('h:install').setLabel(L(lc, 'Install modules', 'Instalar módulos')).setEmoji('📦').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('h:cat:mods').setLabel(L(lc, 'Back to help', 'Volver a la ayuda')).setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [e], components: [new ActionRowBuilder().addComponents(sel), row] };
}

function fmtVal(f, v, lc) {
  if (v === null || v === undefined || v === '') return L(lc, 'not set', 'sin definir');
  if (f.t === 'channel') return '<#' + v + '>';
  if (f.t === 'role') return '<@&' + v + '>';
  if (f.t === 'list') return v.length ? v.join(', ') : L(lc, 'none', 'ninguno');
  if (f.t === 'bool') return v ? 'on' : 'off';
  return '`' + v + '`';
}

function moduleView(i, id) {
  const lc = i.locale;
  const m = MOD.get(id);
  const cfg = getCfg(i.guildId);
  const on = isOn(cfg, m);
  const e = emb(on ? COLOR.green : COLOR.red, m.ico + ' ' + mn(lc, m), md(lc, m) + '\n\n' + L(lc, 'Status: ', 'Estado: ') + dot(on) + ' ' + (on ? L(lc, 'on', 'activo') : L(lc, 'off', 'apagado')));
  if (m.fields.length) {
    e.addFields(m.fields.map((f) => ({ name: L(lc, f.n[0], f.n[1]), value: fmtVal(f, getP(cfg, f.p), lc), inline: true })));
  }
  if (m.id === 'captcha') e.setFooter({ text: L(lc, 'Tip: also ' + (cfg.prefix || '$') + 'verify setup #channel @role', 'Tip: también ' + (cfg.prefix || '$') + 'verify setup #canal @rol') });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('h:tog:' + id).setLabel(on ? L(lc, 'Turn off', 'Apagar') : L(lc, 'Turn on', 'Encender')).setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success)
  );
  if (m.fields.length) row.addComponents(new ButtonBuilder().setCustomId('h:edit:' + id).setLabel(L(lc, 'Edit values', 'Editar valores')).setEmoji('✏️').setStyle(ButtonStyle.Primary));
  row.addComponents(new ButtonBuilder().setCustomId('h:set').setLabel(L(lc, 'All modules', 'Todos los módulos')).setStyle(ButtonStyle.Secondary));
  return { embeds: [e], components: [row] };
}

/* Muestra una vista: edita el mensaje efímero actual o responde uno nuevo. */
async function show(i, view) {
  const isEph = i.message && i.message.flags && i.message.flags.has(EPHEMERAL);
  if (i.isModalSubmit() ? i.isFromMessage() : isEph) return i.update(view);
  return i.reply({ ...view, flags: EPHEMERAL });
}

/* ============================ manejo de interacciones ============================ */
async function handle(i) {
  if (!i.customId || !i.customId.startsWith('h:')) return false;
  const lc = i.locale;
  if (!i.guild) return true;
  const parts = i.customId.split(':');
  const act = parts[1];

  if (act === 'cat') {
    const page = i.isStringSelectMenu() ? i.values[0] : parts[2];
    await show(i, helpView(i, page));
    return true;
  }

  // Todo lo demás cambia la configuración o la muestra
  if (!canConfigure(i.guild, i.user.id, i.member)) {
    await i.reply({ content: getCfg(i.guildId).maxSecurity ? lockedMsg(lc) : L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'), flags: EPHEMERAL });
    return true;
  }
  const cfg = getCfg(i.guildId);

  if (act === 'install') return (await show(i, installView(i)), true);
  if (act === 'set') return (await show(i, settingsView(i)), true);

  if (act === 'inst' && i.isStringSelectMenu()) {
    picks.set(pickKey(i), new Set(i.values));
    await i.update(installView(i));
    return true;
  }

  if (act === 'instgo') {
    const set = picks.get(pickKey(i)) || new Set(MODS.filter((m) => m.rec).map((m) => m.id));
    await i.deferUpdate();
    const out = [];
    const done = [];
    try {
      await ensureLogs(i.guild, cfg, out);
    } catch (e) {
      out.push('⚠️ Logs: ' + clip(e.message, 100));
    }
    for (const m of MODS) {
      if (!set.has(m.id)) continue;
      setOn(cfg, m, true);
      if (m.after || m.id === 'dmblock') await runAfter(i.guild, cfg, m, out, lc);
      done.push(m);
    }
    saveCfg();
    picks.delete(pickKey(i));
    const e = emb(COLOR.green, '✅ ' + L(lc, 'Installed', 'Instalado'));
    e.addFields({ name: L(lc, 'Active now', 'Activo ahora'), value: done.length ? done.map((m) => m.ico + ' ' + mn(lc, m)).join('\n').slice(0, 1000) : L(lc, 'Nothing selected.', 'No elegiste nada.') });
    if (out.length) e.addFields({ name: L(lc, 'Changes made to the server', 'Cambios hechos en el servidor'), value: out.join('\n').slice(0, 1000) });
    e.setFooter({ text: L(lc, 'Fine-tune anything in Settings · /help', 'Ajusta lo que quieras en Ajustes · /help') });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('h:set').setLabel(L(lc, 'Settings', 'Ajustes')).setEmoji('⚙️').setStyle(ButtonStyle.Primary));
    await i.editReply({ embeds: [e], components: [row] });
    return true;
  }

  if (act === 'mod' && i.isStringSelectMenu()) {
    await i.update(moduleView(i, i.values[0]));
    return true;
  }

  if (act === 'tog') {
    const m = MOD.get(parts[2]);
    if (!m) return true;
    const turnOn = !isOn(cfg, m);
    setOn(cfg, m, turnOn);
    const out = [];
    if (turnOn) {
      await i.deferUpdate();
      await runAfter(i.guild, cfg, m, out, lc);
    } else if (m.id === 'dmblock') {
      await i.deferUpdate();
      await applyDm(i.guild, cfg, out);
    } else await i.deferUpdate();
    saveCfg();
    const v = moduleView(i, m.id);
    if (out.length) v.content = out.join('\n').slice(0, 1800);
    await i.editReply(v);
    return true;
  }

  if (act === 'edit') {
    const m = MOD.get(parts[2]);
    if (!m) return true;
    const modal = new ModalBuilder().setCustomId('h:m:' + m.id).setTitle(clip(mn(lc, m), 45));
    m.fields.slice(0, 5).forEach((f, n) => {
      const cur = getP(cfg, f.p);
      let val = cur === null || cur === undefined ? '' : f.t === 'list' ? cur.join(', ') : f.t === 'bool' ? (cur ? 'on' : 'off') : String(cur);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('f' + n).setLabel(clip(L(lc, f.n[0], f.n[1]), 45)).setStyle(f.t === 'list' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setValue(clip(val, 400))
        )
      );
    });
    await i.showModal(modal);
    return true;
  }

  if (act === 'm' && i.isModalSubmit()) {
    const m = MOD.get(parts[2]);
    if (!m) return true;
    const errors = [];
    const updates = [];
    m.fields.slice(0, 5).forEach((f, n) => {
      const raw = String(i.fields.getTextInputValue('f' + n) || '').trim();
      const label = L(lc, f.n[0], f.n[1]);
      if (f.t === 'int') {
        if (raw === '') return;
        const v = parseInt(raw, 10);
        if (!/^-?\d+$/.test(raw) || v < f.min || v > f.max) errors.push('**' + label + '**: ' + L(lc, 'a number from ', 'un número entre ') + f.min + '–' + f.max);
        else updates.push([f, v]);
      } else if (f.t === 'choice') {
        if (raw === '') return;
        if (!f.c.includes(raw.toLowerCase())) errors.push('**' + label + '**: ' + f.c.join(' / '));
        else updates.push([f, raw.toLowerCase()]);
      } else if (f.t === 'bool') {
        if (raw === '') return;
        const v = raw.toLowerCase();
        if (['on', 'si', 'sí', 'true', '1', 'yes'].includes(v)) updates.push([f, true]);
        else if (['off', 'no', 'false', '0'].includes(v)) updates.push([f, false]);
        else errors.push('**' + label + '**: on / off');
      } else if (f.t === 'text') {
        if (raw === '') return;
        if (raw.length > f.max || /\s/.test(raw)) errors.push('**' + label + '**: 1–' + f.max + L(lc, ' characters, no spaces', ' caracteres, sin espacios'));
        else updates.push([f, raw]);
      } else if (f.t === 'list') {
        const v = raw.split(/[,\n]/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean).slice(0, 40);
        updates.push([f, v]);
      } else if (f.t === 'channel' || f.t === 'role') {
        if (raw === '') return updates.push([f, null]);
        const id = idOf(raw);
        const exists = id && (f.t === 'channel' ? i.guild.channels.cache.get(id) : i.guild.roles.cache.get(id));
        if (!exists || (f.t === 'channel' && !exists.isTextBased())) errors.push('**' + label + '**: ' + L(lc, 'not found in this server', 'no existe en este servidor'));
        else updates.push([f, id]);
      }
    });
    if (errors.length) {
      await i.reply({ content: '❌ ' + L(lc, 'Nothing was saved:', 'No se guardó nada:') + '\n' + errors.join('\n'), flags: EPHEMERAL });
      return true;
    }
    for (const [f, v] of updates) setP(cfg, f.p, v);
    if (m.id === 'minage' && cfg.minAccountAgeDays === 0) setOn(cfg, m, false);
    saveCfg();
    const out = [];
    if (isOn(cfg, m) && m.after === 'dmblock') await applyDm(i.guild, cfg, out);
    if (m.id === 'tagrole' && cfg.tagRole.enabled) syncTagRole(i.guild).catch(logErr);
    saveCfg();
    const v = moduleView(i, m.id);
    v.content = '✅ ' + L(lc, 'Saved.', 'Guardado.') + (out.length ? '\n' + out.join('\n') : '');
    await show(i, v);
    return true;
  }
  return true;
}

/* ============================ comando /help ============================ */
const helpData = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Help table: every function and command, plus install and settings')
  .setDescriptionLocalizations({ 'es-ES': 'Tabla de ayuda: todas las funciones y comandos, más instalación y ajustes', 'es-419': 'Tabla de ayuda: todas las funciones y comandos, más instalación y ajustes' })
  .setDMPermission(false);

const commands = [
  {
    data: helpData,
    async execute(i) {
      if (!i.guild) return;
      await i.reply({ ...helpView(i, 'mods'), flags: EPHEMERAL });
    },
  },
];

/* ============================ prefijo: help/install/panel/report/juegos ============================ */
const reportCool = new Map();

async function gameFromMessage(msg, g, args) {
  const opts = g.json.options || [];
  const vals = {};
  const users = {};
  let idx = 0;
  const lc = msg.guild.preferredLocale;
  for (const o of opts) {
    const tok = args[idx];
    if (tok === undefined) {
      if (o.required) return L(lc, 'Missing: ', 'Falta: ') + '`' + o.name + '` — ' + o.description;
      continue;
    }
    idx++;
    if (o.type === 6) {
      const id = idOf(tok);
      const u = id && (await msg.client.users.fetch(id).catch(() => null));
      if (!u) return L(lc, 'Mention a user for `', 'Menciona a un usuario en `') + o.name + '`';
      users[o.name] = u;
    } else if (o.type === 4) {
      const n = parseInt(tok, 10);
      if (!Number.isFinite(n)) return '`' + o.name + '`: ' + L(lc, 'must be a number', 'debe ser un número');
      vals[o.name] = n;
    } else if (o.choices) {
      const ch = o.choices.find((c) => c.name === tok.toLowerCase() || String(c.value) === tok.toLowerCase());
      if (!ch) return '`' + o.name + '`: ' + o.choices.map((c) => c.name).join(' / ');
      vals[o.name] = ch.value;
    } else vals[o.name] = args.slice(idx - 1).join(' ');
  }
  const shim = {
    commandName: g.name,
    locale: lc,
    user: msg.author,
    member: msg.member,
    guild: msg.guild,
    guildId: msg.guildId,
    channel: msg.channel,
    channelId: msg.channelId,
    client: msg.client,
    replied: false,
    deferred: false,
    options: {
      getInteger: (n) => (vals[n] === undefined ? null : vals[n]),
      getString: (n) => (vals[n] === undefined ? null : vals[n]),
      getUser: (n) => users[n] || null,
    },
    async deferReply() {},
    async reply(p) {
      const o = typeof p === 'string' ? { content: p } : { ...p };
      delete o.flags;
      delete o.ephemeral;
      o.allowedMentions = { parse: [], repliedUser: false };
      this.replied = true;
      return msg.reply(o).catch(() => msg.channel.send(o));
    },
  };
  shim.editReply = shim.reply;
  shim.followUp = shim.reply;
  await g.exec.execute(shim);
  return null;
}

async function onMessage(msg) {
  if (!msg.guild || !msg.author || msg.author.bot || !msg.member) return;
  const cfg = getCfg(msg.guild.id);
  const p = cfg.prefix || '$';
  const c = msg.content || '';
  if (!cfg.prefixEnabled || c.length <= p.length || !c.startsWith(p)) return;
  const [first, ...args] = c.slice(p.length).trim().split(/\s+/);
  const name = String(first).toLowerCase();
  const lc = msg.guild.preferredLocale;
  const fake = (extra) => ({ locale: lc, guild: msg.guild, guildId: msg.guildId, user: msg.author, member: msg.member, ...extra });

  if (['help', 'ayuda', 'comandos'].includes(name)) {
    const v = helpView(fake({}), 'mods');
    return void msg.reply({ ...v, allowedMentions: { repliedUser: false } }).catch(() => {});
  }
  if (['install', 'instalar', 'panel', 'ajustes'].includes(name)) {
    if (!canConfigure(msg.guild, msg.author.id, msg.member)) return void msg.reply(cfg.maxSecurity ? lockedMsg(lc) : L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.')).catch(() => {});
    const open = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(['install', 'instalar'].includes(name) ? 'h:install' : 'h:set').setLabel(['install', 'instalar'].includes(name) ? L(lc, 'Open installation', 'Abrir instalación') : L(lc, 'Open settings', 'Abrir ajustes')).setStyle(ButtonStyle.Primary));
    return void msg.reply({ content: L(lc, 'Press the button (only you can use it).', 'Pulsa el botón (solo tú podrás usarlo).'), components: [open], allowedMentions: { repliedUser: false } }).catch(() => {});
  }
  if (['report', 'reportar'].includes(name)) return report(msg, cfg, args, lc);
  const g = GAME_BY.get(name);
  if (g) {
    try {
      const err = await gameFromMessage(msg, g, args);
      if (err) msg.reply({ content: '❌ ' + err, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    } catch (e) {
      logErr(e);
    }
  }
}

async function report(msg, cfg, args, lc) {
  const g = msg.guild;
  const reply = (t) => msg.reply({ content: t, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  if (!cfg.reports.enabled) return void reply(L(lc, '🚩 Reports are turned off in this server.', '🚩 Los reportes están apagados en este servidor.'));
  const last = reportCool.get(msg.author.id) || 0;
  if (Date.now() - last < 60000) return void reply(L(lc, '⏳ Wait a minute before sending another report.', '⏳ Espera un minuto antes de enviar otro reporte.'));
  const id = idOf(args[0]);
  const reason = args.slice(1).join(' ').trim();
  if (!id || !reason) return void reply(L(lc, 'Usage: `' + (cfg.prefix || '$') + 'report @user reason`', 'Uso: `' + (cfg.prefix || '$') + 'report @usuario motivo`'));
  if (id === msg.author.id) return void reply(L(lc, "You can't report yourself.", 'No puedes reportarte a ti mismo.'));
  reportCool.set(msg.author.id, Date.now());
  const e = mkEmbed(g, COLOR.orange, '🚩 ' + L(lc, 'Report', 'Reporte'), clip(reason, 1000), [
    [L(lc, 'Reported', 'Reportado'), '<@' + id + '>\n`' + id + '`'],
    [L(lc, 'By', 'Por'), '<@' + msg.author.id + '>'],
    [L(lc, 'Channel', 'Canal'), '<#' + msg.channelId + '>'],
  ]);
  const ch = cfg.reports.channel && g.channels.cache.get(cfg.reports.channel);
  if (ch && ch.isTextBased()) await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
  else await sendLog(g, 'mod', e);
  msg.delete().catch(() => {});
  const ok = await msg.channel.send(L(lc, '✅ Report sent to the staff.', '✅ Reporte enviado al equipo.')).catch(() => null);
  if (ok) setTimeout(() => ok.delete().catch(() => {}), 5000);
}

/* ============================ mensaje de bienvenida del bot ============================ */
async function onGuildCreate(g) {
  const lc = g.preferredLocale;
  const e = emb(
    COLOR.red,
    L(lc, 'Installation', 'Instalación'),
    L(
      lc,
      'Thanks for adding Centinela! Turn on the protections you want with the menu. The bot will show a summary of what it activated and the changes it made to the server. (Use `/help` for the full table of functions and commands.)',
      '¡Gracias por añadir a Centinela! Activa las protecciones que quieras con el menú. El bot te mostrará un resumen de lo activado y los cambios que haga al servidor. (Usa `/help` para ver la tabla completa de funciones y comandos.)'
    )
  );
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('h:install').setLabel(L(lc, 'Activate', 'Activar')).setEmoji('✅').setStyle(ButtonStyle.Success));
  const me = g.members.me;
  const can = (c) => c && c.isTextBased() && c.permissionsFor(me) && c.permissionsFor(me).has([P.ViewChannel, P.SendMessages]);
  let ch = g.systemChannel && can(g.systemChannel) ? g.systemChannel : g.channels.cache.find((c) => c.type === ChannelType.GuildText && can(c));
  if (ch) await ch.send({ embeds: [e], components: [row] }).catch(() => {});
  else {
    const owner = await g.fetchOwner().catch(() => null);
    if (owner) owner.send({ content: '**' + g.name + '**: ' + L(lc, 'run `$install` or `/help` in your server to set me up.', 'usa `$install` o `/help` en tu servidor para configurarme.') }).catch(() => {});
  }
}

function attach(client) {
  client.on('messageCreate', (m) => onMessage(m).catch(logErr));
  client.on('guildCreate', (g) => onGuildCreate(g).catch(logErr));
  client.on('guildMemberAdd', (m) => tagSync(m).catch(logErr));
  client.on('guildMemberUpdate', (a, b) => tagSync(b).catch(logErr));
  client.on('userUpdate', (a, b) => {
    for (const g of client.guilds.cache.values()) {
      const m = g.members.cache.get(b.id);
      if (m) tagSync(m).catch(logErr);
    }
  });
  startDmRenew(client);
}

module.exports = { commands, handle, attach, publicCatalog, MODS };
