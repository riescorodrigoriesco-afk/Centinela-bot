'use strict';

/*
 * ui.js — Único comando slash: /help.
 * Desde /help se abre un menú interactivo: tabla de ayuda, instalación por módulos,
 * ajustes editables por módulo, reportes de miembros, rol de etiqueta y bloqueo de MD.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits: P,
  MessageFlags,
} = require('discord.js');
const bot = require('./bot');
const guard = require('./guard');
const backup = require('./backup');

const { getCfg, saveCfg, L, COLOR, punishMember, isStaff, canConfigure, lockedMsg, logErr, onOff } = bot;
const EPH = MessageFlags.Ephemeral;

/* ============================ utilidades ============================ */
const getPath = (o, p) => p.reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  let a = o;
  for (let n = 0; n < p.length - 1; n++) a = a[p[n]];
  a[p[p.length - 1]] = v;
}
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const langOf = (i, cfg) => (cfg.ui.lang === 'auto' ? i.locale : cfg.ui.lang);
const colorOf = (cfg) => {
  const m = String(cfg.ui.color || '').match(/^#?([0-9a-f]{6})$/i);
  return m ? parseInt(m[1], 16) : COLOR.blue;
};
const pick = (lc, arr) => L(lc, arr[0], arr[1]);

/* ============================ módulos ============================ */
/*
 * n: nombre [en, es] · d: descripción · on: ruta booleana (o get/set) · fields: valores editables
 * filters: interruptores múltiples · pickers: selectores de canal/rol/usuario · acts: botones de acción
 * inst: false = no aparece en la instalación
 */
const MODS = [
  {
    id: 'prefix', ico: '↪️', n: ['Prefix', 'Prefijo'], d: ['Enable commands by prefix', 'Activar los comandos por prefijo'],
    on: ['prefixEnabled'],
    fields: [{ k: 'prefix', path: ['prefix'], t: 'str', min: 1, max: 3, l: ['Prefix (1-3 characters)', 'Prefijo (1-3 caracteres)'] }],
  },
  {
    id: 'raidmode', ico: '🛡️', n: ['Auto RaidMode', 'Auto RaidMode'], d: ['Maximum people allowed to join every few seconds', 'Cantidad máxima de personas permitidas para unirse cada pocos segundos'],
    on: ['joinFlood', 'enabled'],
    fields: [
      { k: 'limit', path: ['joinFlood', 'limit'], t: 'int', min: 2, max: 50, l: ['Joins allowed', 'Ingresos permitidos'] },
      { k: 'window', path: ['joinFlood', 'windowSec'], t: 'int', min: 2, max: 120, l: ['Window (seconds)', 'Ventana (segundos)'] },
      { k: 'action', path: ['joinFlood', 'action'], t: 'choice', c: ['kick', 'ban', 'timeout'], l: ['Action: kick / ban / timeout', 'Acción: kick / ban / timeout'] },
      { k: 'minutes', path: ['joinFlood', 'raidMinutes'], t: 'int', min: 1, max: 1440, l: ['Raid mode minutes', 'Minutos de modo raid'] },
    ],
  },
  {
    id: 'captcha', ico: '🔁', n: ['Captcha', 'Captcha'], d: ['Block raids with a button and a quick question', 'Bloquear raids con botón y una pregunta rápida'],
    get: (c) => c.verification.enabled,
    set: (c, v) => {
      if (v && (!c.verification.channel || !c.verification.role)) throw new Error('need-verify');
      c.verification.enabled = v;
    },
    pickers: [
      { key: 'channel', type: 'channel', n: ['Verification channel', 'Canal de verificación'], set: (c, v) => (c.verification.channel = v[0]), show: (c) => (c.verification.channel ? '<#' + c.verification.channel + '>' : '—') },
      { key: 'role', type: 'role', n: ['Role given when verified', 'Rol al verificarse'], set: (c, v) => (c.verification.role = v[0]), show: (c) => (c.verification.role ? '<@&' + c.verification.role + '>' : '—') },
    ],
    acts: [{ key: 'panel', n: ['Post panel', 'Publicar panel'], run: async (x) => { await postVerify(x.g, x.cfg, x.lc); return pick(x.lc, ['✅ Panel posted.', '✅ Panel publicado.']); } }],
  },
  {
    id: 'minage', ico: '📅', n: ['Minimum account age', 'Antigüedad mínima'], d: ['Minimum account age to be able to join', 'Antigüedad mínima de cuenta para poder unirse'],
    get: (c) => c.minAccountAgeDays > 0,
    set: (c, v) => (c.minAccountAgeDays = v ? c.minAccountAgeDays || 3 : 0),
    fields: [{ k: 'days', path: ['minAccountAgeDays'], t: 'int', min: 0, max: 365, l: ['Days (0 = off)', 'Días (0 = apagado)'] }],
  },
  {
    id: 'antispam', ico: '🚫', n: ['Anti-spam', 'Anti-spam'], d: ['Protection against spam, links, mentions and selfbots', 'Protección contra spam, enlaces, menciones y selfbots'],
    on: ['antiSpam', 'enabled'],
    filters: [
      { k: 'mention', path: ['antiMassMention', 'enabled'], n: ['Mass mentions', 'Menciones masivas'] },
      { k: 'invite', path: ['antiInvite', 'enabled'], n: ['Invite links', 'Invitaciones de Discord'] },
      { k: 'link', path: ['antiLink', 'enabled'], n: ['All links', 'Todos los enlaces'] },
      { k: 'ip', path: ['antiIpLogger', 'enabled'], n: ['IP loggers', 'Robadores de IP'] },
      { k: 'everyone', path: ['antiEveryone', 'enabled'], n: ['@everyone bypass', 'Truco de @everyone'] },
      { k: 'caps', path: ['antiCaps', 'enabled'], n: ['Capital letters', 'Mayúsculas'] },
      { k: 'emoji', path: ['antiEmoji', 'enabled'], n: ['Emoji flood', 'Exceso de emojis'] },
    ],
    fields: [
      { k: 'limit', path: ['antiSpam', 'limit'], t: 'int', min: 3, max: 30, l: ['Messages allowed', 'Mensajes permitidos'] },
      { k: 'window', path: ['antiSpam', 'windowSec'], t: 'int', min: 2, max: 60, l: ['Window (seconds)', 'Ventana (segundos)'] },
      { k: 'timeout', path: ['antiSpam', 'timeoutMin'], t: 'int', min: 1, max: 1440, l: ['Timeout (minutes)', 'Silencio (minutos)'] },
      { k: 'mentions', path: ['antiMassMention', 'limit'], t: 'int', min: 2, max: 50, l: ['Mentions allowed', 'Menciones permitidas'] },
      { k: 'emojis', path: ['antiEmoji', 'limit'], t: 'int', min: 3, max: 50, l: ['Emojis allowed', 'Emojis permitidos'] },
    ],
  },
  {
    id: 'nuke', ico: '💥', n: ['Anti-nuke', 'Anti-nuke'], d: ['Stops mass deletions and bans, and restores what was deleted', 'Frena borrados y baneos masivos y restaura lo eliminado'],
    on: ['antiNuke', 'enabled'],
    filters: [
      { k: 'restore', path: ['antiNuke', 'restore'], n: ['Restore deleted channels and roles', 'Restaurar canales y roles borrados'] },
      { k: 'panic', path: ['antiNuke', 'panic'], n: ['Panic mode on attack', 'Modo pánico al ser atacado'] },
    ],
    fields: [
      { k: 'limit', path: ['antiNuke', 'limit'], t: 'int', min: 2, max: 30, l: ['Total actions allowed', 'Acciones totales permitidas'] },
      { k: 'window', path: ['antiNuke', 'windowSec'], t: 'int', min: 3, max: 120, l: ['Total window (seconds)', 'Ventana total (segundos)'] },
      { k: 'pertype', path: ['antiNuke', 'perTypeLimit'], t: 'int', min: 1, max: 30, l: ['Allowed per type', 'Permitidas por tipo'] },
      { k: 'pertypewin', path: ['antiNuke', 'perTypeWindowSec'], t: 'int', min: 10, max: 600, l: ['Per-type window (seconds)', 'Ventana por tipo (segundos)'] },
    ],
  },
  {
    id: 'botadd', ico: '🤖', n: ['Anti-bots', 'Anti-bots'], d: ['Blocks bots added without approval', 'Bloquea bots añadidos sin aprobación'],
    on: ['antiBotAdd', 'enabled'],
    fields: [{ k: 'punish', path: ['antiBotAdd', 'punishAdder'], t: 'choice', c: ['ban', 'kick', 'none'], l: ['Punish who adds: ban / kick / none', 'Sanción a quien lo añade: ban / kick / none'] }],
  },
  {
    id: 'warns', ico: '⚠️', n: ['Warnings', 'Advertencias'], d: ['Progressive sanctions: mute, kick, ban', 'Sanciones progresivas: silencio, expulsión, baneo'],
    on: ['autoWarn', 'enabled'],
    fields: [
      { k: 'mute', path: ['autoWarn', 'muteAt'], t: 'int', min: 0, max: 20, l: ['Mute at (0 = never)', 'Silenciar en (0 = nunca)'] },
      { k: 'mutemin', path: ['autoWarn', 'muteMin'], t: 'int', min: 1, max: 1440, l: ['Base mute minutes', 'Minutos base de silencio'] },
      { k: 'kick', path: ['autoWarn', 'kickAt'], t: 'int', min: 0, max: 30, l: ['Kick at (0 = never)', 'Expulsar en (0 = nunca)'] },
      { k: 'ban', path: ['autoWarn', 'banAt'], t: 'int', min: 0, max: 50, l: ['Ban at (0 = never)', 'Banear en (0 = nunca)'] },
      { k: 'expire', path: ['autoWarn', 'expireDays'], t: 'int', min: 1, max: 365, l: ['Warnings expire (days)', 'Las advertencias caducan (días)'] },
    ],
  },
  {
    id: 'guard', ico: '🔐', n: ['Guards', 'Guardias'], d: ['Permissions, server name, webhooks, mute evasion, global ban', 'Permisos, nombre del servidor, webhooks, evasión de silencio, ban global'],
    filters: [
      { k: 'perm', path: ['permGuard', 'enabled'], n: ['Dangerous permissions', 'Permisos peligrosos'] },
      { k: 'guild', path: ['guildGuard', 'enabled'], n: ['Server rename / settings', 'Cambios del servidor'] },
      { k: 'mute', path: ['antiMuteEvasion', 'enabled'], n: ['Mute evasion', 'Evasión de silencio'] },
      { k: 'gban', path: ['globalBan', 'enabled'], n: ['Global ban list', 'Lista de ban global'] },
      { k: 'max', path: ['maxSecurity'], n: ['Maximum security (owner/whitelist only)', 'Máxima seguridad (solo dueño/whitelist)'] },
    ],
  },
  {
    id: 'reports', ico: '🚩', n: ['Reports', 'Reportes'], d: ['Lets members report suspicious activity to your moderation team', 'Permite a los miembros reportar actividad sospechosa a tu equipo de moderación'],
    set: (c, v) => {
      if (v && !c.reports.channel) throw new Error('need-channel');
      c.reports.enabled = v;
    },
    get: (c) => c.reports.enabled,
    pickers: [{ key: 'channel', type: 'channel', n: ['Reports channel', 'Canal de reportes'], set: (c, v) => (c.reports.channel = v[0]), show: (c) => (c.reports.channel ? '<#' + c.reports.channel + '>' : '—') }],
  },
  {
    id: 'tagrole', ico: '🏷️', n: ['Tag role', 'Rol de etiqueta'], d: ['Give a role to members who wear your server tag', 'Dar un rol a los miembros que tengan tu etiqueta'],
    get: (c) => c.tagRole.enabled,
    set: (c, v) => {
      if (v && !c.tagRole.role) throw new Error('need-role');
      c.tagRole.enabled = v;
    },
    pickers: [{ key: 'role', type: 'role', n: ['Role for tag wearers', 'Rol para quienes usan la etiqueta'], set: (c, v) => (c.tagRole.role = v[0]), show: (c) => (c.tagRole.role ? '<@&' + c.tagRole.role + '>' : '—') }],
    acts: [{ key: 'sync', n: ['Sync now', 'Sincronizar ahora'], run: async (x) => pick(x.lc, ['✅ Synced. Roles changed: ', '✅ Sincronizado. Roles cambiados: ']) + (await syncAllTags(x.g)) }],
  },
  {
    id: 'dmlock', ico: '💬', n: ['DM lock', 'Bloqueo de MD'], d: ['Prevent phishing or scam attempts by closing DMs from this server', 'Prevenir intentos de phishing o estafa cerrando los MD'],
    on: ['dmLock', 'enabled'],
    fields: [{ k: 'hours', path: ['dmLock', 'hours'], t: 'int', min: 1, max: 24, l: ['Lock hours (1-24, renewed)', 'Horas de bloqueo (1-24, se renueva)'] }],
  },
  {
    id: 'honeypot', ico: '🍯', n: ['HoneyPot', 'HoneyPot'], d: ['Trap channel that sanctions members who write in it', 'Canal trampa que sanciona a los miembros que escriben en él'],
    get: (c) => c.honeypot.enabled,
    set: (c, v) => {
      if (v && !c.honeypot.channel) throw new Error('need-channel');
      c.honeypot.enabled = v;
    },
    fields: [{ k: 'action', path: ['honeypot', 'action'], t: 'choice', c: ['ban', 'kick', 'timeout'], l: ['Action: ban / kick / timeout', 'Acción: ban / kick / timeout'] }],
    pickers: [{ key: 'channel', type: 'channel', n: ['Trap channel', 'Canal trampa'], set: (c, v) => (c.honeypot.channel = v[0]), show: (c) => (c.honeypot.channel ? '<#' + c.honeypot.channel + '>' : '—') }],
    acts: [{ key: 'create', n: ['Create trap channel', 'Crear canal trampa'], run: async (x) => { const ch = await makeHoneypot(x.g, x.cfg, x.lc); return pick(x.lc, ['✅ Trap channel created: ', '✅ Canal trampa creado: ']) + '<#' + ch.id + '>'; } }],
  },
  {
    id: 'backups', ico: '💾', n: ['Backups', 'Backups'], d: ['Saves roles and channels so you can restore them', 'Guarda roles y canales para poder restaurarlos'],
    get: (c) => c.backup.autoHours > 0,
    set: (c, v) => (c.backup.autoHours = v ? c.backup.autoHours || 24 : 0),
    fields: [
      { k: 'hours', path: ['backup', 'autoHours'], t: 'int', min: 0, max: 168, l: ['Auto-backup every N hours (0 = off)', 'Backup automático cada N horas (0 = apagado)'] },
      { k: 'keep', path: ['backup', 'keep'], t: 'int', min: 1, max: 20, l: ['Backups to keep', 'Backups a conservar'] },
    ],
    acts: [{ key: 'now', n: ['Back up now', 'Crear backup ahora'], run: async (x) => { const b = await backup.takeBackup(x.g, { messages: true, by: x.i.user.id }); return '✅ `' + b.id + '` · ' + b.roles + ' roles · ' + b.channels + ' ' + pick(x.lc, ['channels', 'canales']) + '\n' + pick(x.lc, ['Restore with ', 'Restaura con ']) + '`' + (x.cfg.prefix || '$') + 'b-load ' + b.id + '`'; } }],
  },
  {
    id: 'logs', ico: '📜', n: ['Logs', 'Registros'], d: ['One log channel per event type', 'Un canal de registros por tipo de evento'],
    pickers: [
      { key: 'raid', type: 'channel', n: ['Raid & security alerts channel', 'Canal de alertas de raid y seguridad'], set: (c, v) => (c.logs.raid = [v[0]]), show: (c) => c.logs.raid.map((i) => '<#' + i + '>').join(' ') || '—' },
      { key: 'mod', type: 'channel', n: ['Moderation log channel', 'Canal de registros de moderación'], set: (c, v) => (c.logs.mod = [v[0]]), show: (c) => c.logs.mod.map((i) => '<#' + i + '>').join(' ') || '—' },
    ],
    acts: [{ key: 'create', n: ['Create log channels', 'Crear canales de registros'], run: async (x) => '✅ ' + (await makeLogs(x.g, x.cfg)) }],
  },
  {
    id: 'autorole', inst: false, ico: '🎭', n: ['Auto roles', 'Autoroles'], d: ['Give roles automatically to new members and bots (members wait for verification if Captcha is on)', 'Da roles automáticamente a nuevos miembros y bots (si el Captcha está activo, los miembros esperan a verificarse)'],
    on: ['autoRole', 'enabled'],
    fields: [{ k: 'delay', path: ['autoRole', 'delaySec'], t: 'int', min: 0, max: 3600, l: ['Delay (seconds)', 'Retraso (segundos)'] }],
    pickers: [
      { key: 'humans', type: 'role', multi: true, n: ['Roles for new members', 'Roles para nuevos miembros'], set: (c, v) => (c.autoRole.humans = v), show: (c) => c.autoRole.humans.map((i) => '<@&' + i + '>').join(' ') || '—' },
      { key: 'bots', type: 'role', multi: true, n: ['Roles for new bots', 'Roles para bots nuevos'], set: (c, v) => (c.autoRole.bots = v), show: (c) => c.autoRole.bots.map((i) => '<@&' + i + '>').join(' ') || '—' },
    ],
  },
  {
    id: 'welcome', ico: '👋', n: ['Welcome', 'Bienvenida'], d: ['Message when someone joins. Variables: {user} {username} {server} {count}', 'Mensaje al entrar alguien. Variables: {user} {username} {server} {count}'],
    inst: false,
    get: (c) => c.welcome.enabled,
    set: (c, v) => {
      if (v && !c.welcome.channel) throw new Error('need-channel');
      c.welcome.enabled = v;
    },
    fields: [{ k: 'message', path: ['welcome', 'message'], t: 'str', long: true, optional: true, min: 0, max: 800, l: ['Message (empty = default)', 'Mensaje (vacío = por defecto)'] }],
    pickers: [{ key: 'channel', type: 'channel', n: ['Welcome channel', 'Canal de bienvenida'], set: (c, v) => (c.welcome.channel = v[0]), show: (c) => (c.welcome.channel ? '<#' + c.welcome.channel + '>' : '—') }],
  },
  {
    id: 'goodbye', ico: '😢', n: ['Goodbye', 'Despedida'], d: ['Message when someone leaves. Variables: {username} {server}', 'Mensaje al irse alguien. Variables: {username} {server}'],
    inst: false,
    get: (c) => c.goodbye.enabled,
    set: (c, v) => {
      if (v && !c.goodbye.channel) throw new Error('need-channel');
      c.goodbye.enabled = v;
    },
    fields: [{ k: 'message', path: ['goodbye', 'message'], t: 'str', long: true, optional: true, min: 0, max: 800, l: ['Message (empty = default)', 'Mensaje (vacío = por defecto)'] }],
    pickers: [{ key: 'channel', type: 'channel', n: ['Goodbye channel', 'Canal de despedida'], set: (c, v) => (c.goodbye.channel = v[0]), show: (c) => (c.goodbye.channel ? '<#' + c.goodbye.channel + '>' : '—') }],
  },
  {
    id: 'trust', ico: '🤝', n: ['Trusted list', 'Lista de confianza'], d: ['Trusted users skip the protections; exempt channels are ignored', 'Los usuarios de confianza se saltan las protecciones; los canales exentos se ignoran'],
    inst: false,
    pickers: [
      { key: 'users', type: 'user', multi: true, n: ['Add trusted users or bots', 'Añadir usuarios o bots de confianza'], set: (c, v, x) => { for (const id of v) { const u = x.resolved.get(id); const list = c.whitelist[u && u.bot ? 'bots' : 'users']; if (!list.includes(id)) list.push(id); } }, show: (c) => (c.whitelist.users.map((i) => '<@' + i + '>').concat(c.whitelist.bots.map((i) => '🤖<@' + i + '>')).join(' ') || '—') },
      { key: 'exempt', type: 'channel', multi: true, n: ['Exempt channels (replaces the list)', 'Canales exentos (reemplaza la lista)'], set: (c, v) => (c.exemptChannels = v), show: (c) => c.exemptChannels.map((i) => '<#' + i + '>').join(' ') || '—' },
    ],
    acts: [{ key: 'clear', n: ['Clear trusted list', 'Vaciar lista de confianza'], run: async (x) => { x.cfg.whitelist.users = []; x.cfg.whitelist.bots = []; return pick(x.lc, ['✅ Trusted list cleared.', '✅ Lista de confianza vaciada.']); } }],
  },
  {
    id: 'look', ico: '🎨', n: ['Appearance', 'Apariencia'], d: ['Color and language of the bot panels', 'Color e idioma de los paneles del bot'],
    inst: false,
    filters: [{ k: 'eph', path: ['ui', 'ephemeral'], n: ['Panels visible only to you', 'Paneles visibles solo para ti'] }],
    fields: [
      { k: 'color', path: ['ui', 'color'], t: 'hex', l: ['Color (hex, e.g. #3fd0b0)', 'Color (hex, ej. #3fd0b0)'] },
      { k: 'lang', path: ['ui', 'lang'], t: 'choice', c: ['auto', 'es', 'en'], l: ['Language: auto / es / en', 'Idioma: auto / es / en'] },
    ],
  },
];
const MOD = new Map(MODS.map((m) => [m.id, m]));

const isOn = (cfg, m) => (m.get ? !!m.get(cfg) : m.on ? !!getPath(cfg, m.on) : null);
function setOn(cfg, m, v) {
  if (m.set) return m.set(cfg, v);
  if (m.on) setPath(cfg, m.on, v);
}

/* ============================ acciones sobre el servidor ============================ */
async function category(g) {
  const me = g.members.me;
  let cat = g.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Centinela');
  if (!cat) {
    cat = await g.channels.create({
      name: 'Centinela',
      type: ChannelType.GuildCategory,
      reason: 'Centinela',
      permissionOverwrites: [
        { id: g.id, type: 0, deny: [P.ViewChannel] },
        { id: me.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] },
      ],
    });
  }
  return cat;
}

async function privateChannel(g, name) {
  const cat = await category(g);
  let ch = g.channels.cache.find((c) => c.parentId === cat.id && c.name === name && c.type === ChannelType.GuildText);
  if (!ch) {
    ch = await g.channels.create({ name, type: ChannelType.GuildText, parent: cat.id, reason: 'Centinela' });
    await ch.lockPermissions().catch(() => {});
  }
  return ch;
}

async function makeLogs(g, cfg) {
  const wanted = { 'raid-logs': ['raid'], 'mod-logs': ['mod'], 'server-logs': ['server'], 'message-logs': ['messages'], 'member-logs': ['welcome', 'goodbye'] };
  const out = [];
  for (const [name, types] of Object.entries(wanted)) {
    const ch = await privateChannel(g, name);
    for (const t of types) if (!cfg.logs[t].includes(ch.id)) cfg.logs[t].push(ch.id);
    out.push('<#' + ch.id + '>');
  }
  return out.join(' ');
}

async function postVerify(g, cfg, lc) {
  const ch = cfg.verification.channel && (g.channels.cache.get(cfg.verification.channel) || (await g.channels.fetch(cfg.verification.channel).catch(() => null)));
  if (!ch || !ch.isTextBased()) throw new Error(L(lc, 'Pick a verification channel first.', 'Elige primero un canal de verificación.'));
  const e = new EmbedBuilder().setColor(colorOf(cfg)).setTitle('✅ ' + L(lc, 'Verification', 'Verificación')).setDescription(L(lc, 'Press the button and answer a quick question to get access to the server.', 'Pulsa el botón y responde una pregunta rápida para entrar al servidor.'));
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('v:start').setLabel(L(lc, 'Verify', 'Verificarme')).setEmoji('✅').setStyle(ButtonStyle.Success));
  await ch.send({ embeds: [e], components: [row] });
}

async function makeHoneypot(g, cfg, lc) {
  let ch = cfg.honeypot.channel && g.channels.cache.get(cfg.honeypot.channel);
  if (!ch) {
    ch = await g.channels.create({ name: 'no-escribir-aqui', type: ChannelType.GuildText, reason: 'Centinela honeypot', topic: L(lc, 'Trap channel: do not write here.', 'Canal trampa: no escribas aquí.') });
    const e = new EmbedBuilder().setColor(COLOR.red).setTitle('🍯 ' + L(lc, 'Do not write here', 'No escribas aquí')).setDescription(L(lc, 'This channel catches bots and raiders. Anyone who sends a message here is sanctioned automatically.', 'Este canal atrapa bots y raiders. Quien envíe un mensaje aquí recibe una sanción automática.'));
    await ch.send({ embeds: [e] }).catch(() => {});
  }
  cfg.honeypot.channel = ch.id;
  cfg.honeypot.enabled = true;
  return ch;
}

async function applyDmLock(g, on, hours) {
  if (typeof g.setIncidentActions !== 'function') throw new Error('Esta versión de discord.js no soporta el bloqueo de MD.');
  const inv = g.incidentsData && g.incidentsData.invitesDisabledUntil ? g.incidentsData.invitesDisabledUntil : null;
  await g.setIncidentActions({ invitesDisabledUntil: inv, dmsDisabledUntil: on ? new Date(Date.now() + Math.min(24, hours || 24) * 3600000) : null });
}

/* ---------- rol de etiqueta ---------- */
async function syncTag(member, cfg) {
  const tr = cfg.tagRole;
  if (!tr.enabled || !tr.role || member.user.bot) return 0;
  const pg = member.user.primaryGuild;
  if (pg === undefined) return 0; // la librería no expone la etiqueta
  const has = !!(pg && pg.identityGuildId === member.guild.id && pg.identityEnabled !== false);
  const role = member.guild.roles.cache.get(tr.role);
  if (!role || role.managed || role.comparePositionTo(member.guild.members.me.roles.highest) >= 0) return 0;
  try {
    if (has && !member.roles.cache.has(role.id)) { await member.roles.add(role, 'Centinela: tag role'); return 1; }
    if (!has && member.roles.cache.has(role.id)) { await member.roles.remove(role, 'Centinela: tag role'); return 1; }
  } catch (_) {}
  return 0;
}
async function syncAllTags(g) {
  const cfg = getCfg(g.id);
  const all = await g.members.fetch().catch(() => null);
  if (!all) return 0;
  let n = 0;
  for (const m of all.values()) n += await syncTag(m, cfg);
  return n;
}

/* ---------- autoroles ---------- */
async function giveAutoRoles(member) {
  const g = member.guild;
  const cfg = getCfg(g.id);
  const ar = cfg.autoRole;
  if (!ar.enabled) return;
  const ids = member.user.bot ? ar.bots : cfg.verification.enabled ? [] : ar.humans;
  if (!ids.length) return;
  if (ar.delaySec > 0) await new Promise((r) => setTimeout(r, ar.delaySec * 1000));
  const top = g.members.me.roles.highest;
  const ok = ids.filter((id) => { const r = g.roles.cache.get(id); return r && !r.managed && r.comparePositionTo(top) < 0; });
  if (ok.length) await member.roles.add(ok, 'Centinela: autorole').catch(() => {});
}

/* ============================ instalación ============================ */
const INSTALLABLE = MODS.filter((m) => m.inst !== false);
const instSel = new Map(); // guild:user -> Set(ids)
const selKey = (i) => i.guildId + ':' + i.user.id;

const INSTALLERS = {
  captcha: async (x) => {
    const g = x.g;
    let role = g.roles.cache.find((r) => r.name === 'Verificado');
    if (!role) role = await g.roles.create({ name: 'Verificado', reason: 'Centinela' });
    let ch = g.channels.cache.find((c) => c.name === 'verificacion' && c.type === ChannelType.GuildText);
    if (!ch) ch = await g.channels.create({ name: 'verificacion', type: ChannelType.GuildText, reason: 'Centinela' });
    x.cfg.verification = { enabled: true, channel: ch.id, role: role.id };
    await postVerify(g, x.cfg, x.lc);
    return '<#' + ch.id + '> · <@&' + role.id + '> ' + L(x.lc, '(make @everyone see only that channel)', '(haz que @everyone solo vea ese canal)');
  },
  minage: async (x) => { if (!x.cfg.minAccountAgeDays) x.cfg.minAccountAgeDays = 3; return x.cfg.minAccountAgeDays + ' d'; },
  antispam: async (x) => { for (const f of ['antiMassMention', 'antiInvite', 'antiIpLogger', 'antiEveryone']) x.cfg[f].enabled = true; },
  nuke: async (x) => { x.cfg.antiNuke.enabled = true; x.cfg.antiNuke.restore = true; x.cfg.antiNuke.panic = true; },
  guard: async (x) => { for (const f of ['permGuard', 'guildGuard', 'antiMuteEvasion', 'globalBan']) x.cfg[f].enabled = true; },
  reports: async (x) => { const ch = await privateChannel(x.g, 'reportes'); x.cfg.reports = { enabled: true, channel: ch.id }; return '<#' + ch.id + '>'; },
  tagrole: async (x) => {
    let role = x.cfg.tagRole.role && x.g.roles.cache.get(x.cfg.tagRole.role);
    if (!role) role = await x.g.roles.create({ name: L(x.lc, 'Server tag', 'Tag del servidor'), reason: 'Centinela' });
    x.cfg.tagRole = { enabled: true, role: role.id };
    return '<@&' + role.id + '>';
  },
  dmlock: async (x) => { await applyDmLock(x.g, true, x.cfg.dmLock.hours); x.cfg.dmLock.enabled = true; return x.cfg.dmLock.hours + ' h'; },
  honeypot: async (x) => { const ch = await makeHoneypot(x.g, x.cfg, x.lc); return '<#' + ch.id + '> → ' + x.cfg.honeypot.action; },
  backups: async (x) => {
    x.cfg.backup.autoHours = x.cfg.backup.autoHours || 24;
    const b = await backup.takeBackup(x.g, { messages: true, by: x.i.user.id });
    return '`' + b.id + '` · ' + x.cfg.backup.autoHours + ' h';
  },
  logs: async (x) => makeLogs(x.g, x.cfg),
};

function installView(i, cfg, lc) {
  const key = selKey(i);
  if (!instSel.has(key)) instSel.set(key, new Set(INSTALLABLE.map((m) => m.id)));
  const sel = instSel.get(key);
  const e = new EmbedBuilder()
    .setColor(colorOf(cfg))
    .setTitle(L(lc, 'Installation', 'Instalación'))
    .setDescription(L(lc, 'Turn on or reinstall the functions you want with the menu. The bot will send you a summary of what was enabled and the changes it made to the server. (Use **Settings** to turn off or tune a function.)', 'Activa o reinstala las funciones deseadas usando el menú de selección. El bot te enviará un resumen de las funciones activadas y los cambios que hará al servidor. (Usa **Ajustes** para desactivar o ajustar una función.)'));
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ui:instsel')
    .setPlaceholder(L(lc, 'Choose the modules to install', 'Elige los módulos a instalar'))
    .setMinValues(0)
    .setMaxValues(INSTALLABLE.length)
    .addOptions(INSTALLABLE.map((m) => ({ label: cut(m.ico + ' ' + pick(lc, m.n), 100), description: cut(pick(lc, m.d), 100), value: m.id, default: sel.has(m.id) })));
  return {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ui:instgo').setLabel(L(lc, 'Activate', 'Activar')).setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ui:home').setLabel(L(lc, 'Back', 'Volver')).setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

async function runInstall(i, cfg, lc, selOverride) {
  const g = i.guild;
  const sel = selOverride || instSel.get(selKey(i)) || new Set(INSTALLABLE.map((m) => m.id));
  const lines = [];
  for (const m of INSTALLABLE) {
    if (!sel.has(m.id)) continue;
    const x = { i, g, cfg, lc };
    try {
      if (m.on && typeof getPath(cfg, m.on) === 'boolean') setPath(cfg, m.on, true);
      const extra = INSTALLERS[m.id] ? await INSTALLERS[m.id](x) : '';
      lines.push('✅ ' + m.ico + ' **' + pick(lc, m.n) + '**' + (extra ? ' — ' + extra : ''));
    } catch (e) {
      lines.push('❌ ' + m.ico + ' **' + pick(lc, m.n) + '** — ' + cut(e.message, 150));
    }
  }
  saveCfg();
  const e = new EmbedBuilder().setColor(colorOf(cfg)).setTitle(L(lc, 'Installation summary', 'Resumen de la instalación')).setDescription(lines.join('\n') || L(lc, 'Nothing selected.', 'No elegiste nada.'));
  e.setFooter({ text: L(lc, 'Raise my role above the others and use Settings to fine-tune.', 'Sube mi rol por encima de los demás y usa Ajustes para afinar.') });
  return e;
}

/* ============================ ajuda: tabla de comandos ============================ */
function catOf(c) {
  if (/^b-/.test(c.name)) return 'backup';
  if (['warn', 'warnings', 'clearwarns'].includes(c.name)) return 'warn';
  if (c.level === 'mod') return 'mod';
  if (c.level === 'cfg' || c.level === 'owner' || c.level === 'botowner') return 'antiraid';
  return 'general';
}
const CATS = [
  ['home', '🏠', ['Home', 'Inicio']],
  ['func', '🧩', ['Functions', 'Funciones']],
  ['antiraid', '🛡️', ['Antiraid & setup', 'Antiraid y configuración']],
  ['mod', '🔨', ['Moderation', 'Moderación']],
  ['warn', '⚠️', ['Warnings', 'Advertencias']],
  ['backup', '💾', ['Backups', 'Backups']],
  ['general', '✅', ['General', 'General']],
];

function navRows(cat, lc, cfg) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ui:cat')
    .setPlaceholder(L(lc, 'Choose a section', 'Elige una sección'))
    .addOptions(CATS.map(([id, ico, n]) => ({ label: ico + ' ' + pick(lc, n), value: id, default: id === cat })));
  const b = (id, label, style, emoji) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setEmoji(emoji);
  return [
    new ActionRowBuilder().addComponents(menu),
    new ActionRowBuilder().addComponents(
      b('ui:inst', L(lc, 'Install', 'Instalar'), ButtonStyle.Success, '🛠️'),
      b('ui:set', L(lc, 'Settings', 'Ajustes'), ButtonStyle.Primary, '⚙️'),
      b('ui:status', L(lc, 'Status', 'Estado'), ButtonStyle.Secondary, '📊'),
      b('ui:report', L(lc, 'Report', 'Reportar'), ButtonStyle.Danger, '🚩')
    ),
  ];
}

function helpPayload(g, cfg, lc, cat = 'home') {
  const p = cfg.prefix || '$';
  const embeds = [];
  const color = colorOf(cfg);
  if (cat === 'home') {
    const e = new EmbedBuilder().setColor(color).setTitle('🛡️ Centinela')
      .setDescription(L(lc,
        'Antiraid protection for your server.\n\n• **Install** turns on modules in one step.\n• **Settings** lets you tune every module.\n• Commands use the prefix `' + p + '` (turn it off in Settings).\n• Pick a section below to see every command and function.',
        'Protección antiraid para tu servidor.\n\n• **Instalar** activa módulos en un paso.\n• **Ajustes** te deja afinar cada módulo.\n• Los comandos usan el prefijo `' + p + '` (se apaga en Ajustes).\n• Elige una sección abajo para ver todos los comandos y funciones.'));
    const mods = MODS.map((m) => { const s = isOn(cfg, m); return (s === null ? '▫️' : onOff(s)) + ' ' + pick(lc, m.n); });
    e.addFields({ name: L(lc, 'Functions', 'Funciones'), value: mods.slice(0, 10).join('\n'), inline: true }, { name: '​', value: mods.slice(10).join('\n'), inline: true });
    embeds.push(e);
  } else if (cat === 'func') {
    const lines = MODS.map((m) => { const s = isOn(cfg, m); return (s === null ? '▫️' : onOff(s)) + ' ' + m.ico + ' **' + pick(lc, m.n) + '** — ' + pick(lc, m.d); });
    embeds.push(new EmbedBuilder().setColor(color).setTitle('🧩 ' + L(lc, 'Functions', 'Funciones')).setDescription(lines.join('\n').slice(0, 4000)));
  } else {
    const info = CATS.find((c) => c[0] === cat);
    const list = guard.CMDS.filter((c) => c.d && catOf(c) === cat);
    const lines = list.map((c) => '`' + p + c.name + '`' + (c.aliases && c.aliases.length ? ' *(' + c.aliases.join(', ') + ')*' : '') + ' — ' + L(lc, c.d, c.es || c.d));
    if (cat === 'general') lines.unshift('`/help` — ' + L(lc, 'Open this panel', 'Abre este panel'));
    let chunk = '';
    const parts = [];
    for (const l of lines) {
      if ((chunk + l).length > 3800) { parts.push(chunk); chunk = ''; }
      chunk += l + '\n';
    }
    parts.push(chunk);
    parts.forEach((t, n) => {
      const e = new EmbedBuilder().setColor(color).setDescription(t || '—');
      if (n === 0) e.setTitle(info[1] + ' ' + pick(lc, info[2]));
      embeds.push(e);
    });
  }
  return { embeds, components: navRows(cat, lc, cfg) };
}

/* ============================ ajustes ============================ */
function settingsList(i, cfg, lc) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ui:setmod')
    .setPlaceholder(L(lc, 'Choose a module to configure', 'Elige un módulo para configurar'))
    .addOptions(MODS.map((m) => { const s = isOn(cfg, m); return { label: cut((s === null ? '▫️' : onOff(s)) + ' ' + pick(lc, m.n), 100), description: cut(pick(lc, m.d), 100), value: m.id }; }));
  return {
    embeds: [new EmbedBuilder().setColor(colorOf(cfg)).setTitle('⚙️ ' + L(lc, 'Settings', 'Ajustes')).setDescription(L(lc, 'Pick a module to turn it on or off and change its values.', 'Elige un módulo para encenderlo, apagarlo y cambiar sus valores.'))],
    components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ui:home').setLabel(L(lc, 'Back', 'Volver')).setStyle(ButtonStyle.Secondary))],
  };
}

function detailView(g, cfg, m, lc, note) {
  const s = isOn(cfg, m);
  const e = new EmbedBuilder().setColor(colorOf(cfg)).setTitle(m.ico + ' ' + pick(lc, m.n) + (s === null ? '' : ' — ' + (s ? L(lc, 'ON', 'ACTIVO') : L(lc, 'OFF', 'APAGADO')))).setDescription(pick(lc, m.d));
  if (m.fields) e.addFields({ name: L(lc, 'Values', 'Valores'), value: m.fields.map((f) => '`' + pick(lc, f.l) + '`: **' + (getPath(cfg, f.path) === null || getPath(cfg, f.path) === '' ? '—' : cut(getPath(cfg, f.path), 80)) + '**').join('\n') });
  if (m.filters) e.addFields({ name: L(lc, 'Filters', 'Filtros'), value: m.filters.map((f) => onOff(getPath(cfg, f.path)) + ' ' + pick(lc, f.n)).join('\n') });
  if (m.pickers) e.addFields({ name: L(lc, 'Selected', 'Seleccionado'), value: m.pickers.map((p) => '`' + pick(lc, p.n) + '`: ' + cut(p.show(cfg), 300)).join('\n') });
  if (note) e.setFooter({ text: cut(note, 200) });

  const rows = [];
  const btns = [];
  if (s !== null) btns.push(new ButtonBuilder().setCustomId('ui:tog:' + m.id).setLabel(s ? L(lc, 'Turn off', 'Apagar') : L(lc, 'Turn on', 'Encender')).setStyle(s ? ButtonStyle.Danger : ButtonStyle.Success));
  if (m.fields) btns.push(new ButtonBuilder().setCustomId('ui:edit:' + m.id).setLabel(L(lc, 'Edit values', 'Editar valores')).setStyle(ButtonStyle.Primary));
  for (const a of m.acts || []) btns.push(new ButtonBuilder().setCustomId('ui:act:' + m.id + ':' + a.key).setLabel(cut(pick(lc, a.n), 80)).setStyle(ButtonStyle.Secondary));
  btns.push(new ButtonBuilder().setCustomId('ui:set').setLabel(L(lc, 'Back', 'Volver')).setStyle(ButtonStyle.Secondary));
  rows.push(new ActionRowBuilder().addComponents(btns.slice(0, 5)));
  if (m.filters) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('ui:filt:' + m.id).setPlaceholder(L(lc, 'Filters', 'Filtros')).setMinValues(0).setMaxValues(m.filters.length)
        .addOptions(m.filters.map((f) => ({ label: cut(pick(lc, f.n), 100), value: f.k, default: !!getPath(cfg, f.path) })))
    ));
  }
  for (const p of m.pickers || []) {
    if (rows.length >= 5) break;
    const id = 'ui:pick:' + m.id + ':' + p.key;
    const ph = cut(pick(lc, p.n), 150);
    let menu;
    if (p.type === 'channel') menu = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(ph).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    else if (p.type === 'role') menu = new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(ph);
    else menu = new UserSelectMenuBuilder().setCustomId(id).setPlaceholder(ph);
    menu.setMinValues(1).setMaxValues(p.multi ? 10 : 1);
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  return { embeds: [e], components: rows };
}

function parseField(f, raw) {
  const v = String(raw === undefined ? '' : raw).trim();
  if (f.t === 'int') { const n = parseInt(v, 10); return Number.isFinite(n) && n >= f.min && n <= f.max ? n : undefined; }
  if (f.t === 'choice') return f.c.includes(v.toLowerCase()) ? v.toLowerCase() : undefined;
  if (f.t === 'hex') return /^#?[0-9a-f]{6}$/i.test(v) ? '#' + v.replace('#', '').toLowerCase() : undefined;
  if (f.t === 'str') {
    if (!v) return f.optional ? null : undefined;
    return v.length >= (f.min || 1) && v.length <= f.max ? v : undefined;
  }
  return undefined;
}

function editModal(m, cfg, lc) {
  const md = new ModalBuilder().setCustomId('ui:modal:' + m.id).setTitle(cut(pick(lc, m.n), 45));
  for (const f of m.fields) {
    const cur = getPath(cfg, f.path);
    const inp = new TextInputBuilder().setCustomId(f.k).setLabel(cut(pick(lc, f.l), 45)).setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(!f.optional);
    if (cur !== null && cur !== undefined && cur !== '') inp.setValue(String(cur).slice(0, f.max || 100));
    if (f.t === 'str') inp.setMaxLength(f.max);
    md.addComponents(new ActionRowBuilder().addComponents(inp));
  }
  return md;
}

/* ============================ reportes ============================ */
const repCooldown = new Map();
function reportModal(lc) {
  return new ModalBuilder().setCustomId('ui:repmodal').setTitle(L(lc, 'Report to the moderators', 'Reportar a los moderadores')).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('who').setLabel(L(lc, 'User ID or mention', 'ID o mención del usuario')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('why').setLabel(L(lc, 'What happened?', '¿Qué pasó?')).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900))
  );
}

async function submitReport(i, cfg, lc) {
  const g = i.guild;
  if (!cfg.reports.enabled || !cfg.reports.channel) return i.reply({ content: L(lc, '🚩 Reports are not enabled on this server.', '🚩 Los reportes no están activados en este servidor.'), flags: EPH });
  const last = repCooldown.get(i.user.id) || 0;
  if (Date.now() - last < 60000) return i.reply({ content: L(lc, '⏳ Wait a minute before sending another report.', '⏳ Espera un minuto antes de enviar otro reporte.'), flags: EPH });
  const raw = i.fields.getTextInputValue('who');
  const m = raw.match(/(\d{15,25})/);
  const why = i.fields.getTextInputValue('why');
  const ch = g.channels.cache.get(cfg.reports.channel) || (await g.channels.fetch(cfg.reports.channel).catch(() => null));
  if (!ch) return i.reply({ content: L(lc, '❌ The reports channel no longer exists.', '❌ El canal de reportes ya no existe.'), flags: EPH });
  repCooldown.set(i.user.id, Date.now());
  const e = new EmbedBuilder().setColor(COLOR.red).setTitle('🚩 ' + L(lc, 'New report', 'Nuevo reporte')).setTimestamp()
    .addFields(
      { name: L(lc, 'Reported', 'Reportado'), value: m ? '<@' + m[1] + '>\n`' + m[1] + '`' : cut(raw, 100), inline: true },
      { name: L(lc, 'Reported by', 'Reportado por'), value: '<@' + i.user.id + '>', inline: true },
      { name: L(lc, 'Reason', 'Motivo'), value: cut(why, 1000) }
    );
  const rows = [];
  if (m) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ui:rep:timeout:' + m[1]).setLabel(L(lc, 'Timeout 1h', 'Silenciar 1 h')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ui:rep:kick:' + m[1]).setLabel(L(lc, 'Kick', 'Expulsar')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ui:rep:ban:' + m[1]).setLabel(L(lc, 'Ban', 'Banear')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ui:rep:dismiss:' + m[1]).setLabel(L(lc, 'Dismiss', 'Descartar')).setStyle(ButtonStyle.Secondary)
    ));
  }
  await ch.send({ embeds: [e], components: rows, allowedMentions: { parse: [] } });
  return i.reply({ content: L(lc, '✅ Report sent to the moderators.', '✅ Reporte enviado a los moderadores.'), flags: EPH });
}

async function reportAction(i, lc) {
  const [, , act, uid] = i.customId.split(':');
  const ok = i.member && (isStaff(i.member) || i.member.permissions.has(P.ModerateMembers) || i.member.permissions.has(P.BanMembers));
  if (!ok) return i.reply({ content: L(lc, '❌ You do not have permission for this.', '❌ No tienes permiso para esto.'), flags: EPH });
  let res = 'dismiss';
  if (act !== 'dismiss') {
    if (uid === i.guild.ownerId || bot.isTrusted(i.guild, uid, getCfg(i.guild.id))) return i.reply({ content: L(lc, '❌ That user is protected.', '❌ Ese usuario está protegido.'), flags: EPH });
    res = await punishMember(i.guild, uid, act, 'Centinela report · ' + i.user.tag, 60);
  }
  const e = EmbedBuilder.from(i.message.embeds[0]).setColor(COLOR.green).setFooter({ text: L(lc, 'Resolved by ', 'Resuelto por ') + i.user.username + ' · ' + res });
  return i.update({ embeds: [e], components: [] });
}

/* ============================ enrutador de interacciones ============================ */
const home = (i, cfg, lc, cat) => helpPayload(i.guild, cfg, lc, cat);

async function handle(i) {
  if (!i.guild) return;
  const cfg = getCfg(i.guild.id);
  const lc = langOf(i, cfg);
  const parts = i.customId.split(':');
  const act = parts[1];

  // Acceso libre: ayuda, reportar
  if (act === 'cat') return i.update(home(i, cfg, lc, i.values[0]));
  if (act === 'home') return i.update(home(i, cfg, lc, 'home'));
  if (act === 'report') return i.showModal(reportModal(lc));
  if (act === 'repmodal') return submitReport(i, cfg, lc);
  if (act === 'rep') return reportAction(i, lc);

  // El resto exige permisos de configuración
  const staffOnly = act === 'status';
  const ok = staffOnly ? isStaff(i.member) || canConfigure(i.guild, i.user.id, i.member) : canConfigure(i.guild, i.user.id, i.member);
  if (!ok) {
    const msg = cfg.maxSecurity ? lockedMsg(lc) : L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.');
    return i.reply({ content: msg, flags: EPH });
  }

  if (act === 'status') {
    const e = guard.statusEmbed({ guild: i.guild, locale: lc });
    return i.reply({ embeds: [e], flags: EPH });
  }
  if (act === 'inst') return i.update(installView(i, cfg, lc));
  if (act === 'instsel') {
    instSel.set(selKey(i), new Set(i.values));
    return i.update(installView(i, cfg, lc));
  }
  if (act === 'instgo') {
    await i.update({ embeds: [new EmbedBuilder().setColor(colorOf(cfg)).setDescription('⏳ ' + L(lc, 'Installing…', 'Instalando…'))], components: [] });
    const e = await runInstall(i, cfg, lc);
    return i.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ui:set').setLabel(L(lc, 'Settings', 'Ajustes')).setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('ui:home').setLabel(L(lc, 'Home', 'Inicio')).setStyle(ButtonStyle.Secondary))] });
  }
  if (act === 'set') return i.update(settingsList(i, cfg, lc));
  if (act === 'setmod') return i.update(detailView(i.guild, cfg, MOD.get(i.values[0]), lc));

  const m = MOD.get(parts[2]);
  if (!m) return;
  const detail = (note) => detailView(i.guild, cfg, m, lc, note);

  if (act === 'tog') {
    const want = !isOn(cfg, m);
    try {
      if (m.id === 'dmlock') await applyDmLock(i.guild, want, cfg.dmLock.hours);
      setOn(cfg, m, want);
      saveCfg();
      return i.update(detail());
    } catch (e) {
      const need = { 'need-channel': ['Pick a channel first.', 'Primero elige un canal.'], 'need-role': ['Pick a role first.', 'Primero elige un rol.'], 'need-verify': ['Pick the channel and role first.', 'Primero elige el canal y el rol.'] }[e.message];
      return i.update(detail('⚠️ ' + (need ? pick(lc, need) : e.message)));
    }
  }
  if (act === 'edit') return i.showModal(editModal(m, cfg, lc));
  if (act === 'modal') {
    const errs = [];
    for (const f of m.fields) {
      const v = parseField(f, i.fields.getTextInputValue(f.k));
      if (v === undefined) errs.push(pick(lc, f.l));
      else setPath(cfg, f.path, v);
    }
    saveCfg();
    if (m.id === 'dmlock' && cfg.dmLock.enabled) await applyDmLock(i.guild, true, cfg.dmLock.hours).catch(() => {});
    const note = errs.length ? L(lc, 'Invalid: ', 'No válido: ') + errs.join(', ') : L(lc, 'Saved.', 'Guardado.');
    return i.isFromMessage() ? i.update(detail(note)) : i.reply({ content: note, flags: EPH });
  }
  if (act === 'filt') {
    for (const f of m.filters) setPath(cfg, f.path, i.values.includes(f.k));
    saveCfg();
    return i.update(detail());
  }
  if (act === 'pick') {
    const p = m.pickers.find((x) => x.key === parts[3]);
    if (!p) return;
    p.set(cfg, i.values, { resolved: i.users || new Map() });
    saveCfg();
    return i.update(detail(L(lc, 'Saved.', 'Guardado.')));
  }
  if (act === 'act') {
    const a = m.acts.find((x) => x.key === parts[3]);
    if (!a) return;
    await i.deferUpdate();
    let note;
    try {
      note = await a.run({ i, g: i.guild, cfg, lc });
    } catch (e) {
      note = '❌ ' + e.message;
    }
    saveCfg();
    return i.editReply(detail(String(note).replace(/<[#@&]+\d+>/g, '…')));
  }
}

/* ============================ /help ============================ */
const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Open the Centinela help panel')
    .setDescriptionLocalizations({ 'es-ES': 'Abre el panel de ayuda de Centinela', 'es-419': 'Abre el panel de ayuda de Centinela' })
    .setDMPermission(false),
  async execute(i) {
    if (!i.guild) return;
    const cfg = getCfg(i.guild.id);
    const lc = langOf(i, cfg);
    const payload = helpPayload(i.guild, cfg, lc, 'home');
    if (cfg.ui.ephemeral) payload.flags = EPH;
    return i.reply(payload);
  },
};

/* ============================ eventos ============================ */
function attach(client) {
  const tagSeen = new Map();
  client.on('guildMemberAdd', (m) => syncTag(m, getCfg(m.guild.id)).catch(logErr));
  client.on('guildMemberAdd', (m) => giveAutoRoles(m).catch(logErr));
  client.on('guildMemberUpdate', (a, b) => syncTag(b, getCfg(b.guild.id)).catch(logErr));
  client.on('messageCreate', (msg) => {
    if (!msg.guild || !msg.member || msg.author.bot) return;
    const cfg = getCfg(msg.guild.id);
    if (!cfg.tagRole.enabled) return;
    if (Date.now() - (tagSeen.get(msg.author.id) || 0) < 600000) return;
    tagSeen.set(msg.author.id, Date.now());
    syncTag(msg.member, cfg).catch(logErr);
  });
  // El bloqueo de MD de Discord dura como máximo 24 h: se renueva cada 6 h.
  const t = setInterval(() => {
    for (const g of client.guilds.cache.values()) {
      const cfg = getCfg(g.id);
      if (cfg.dmLock.enabled) applyDmLock(g, true, cfg.dmLock.hours).catch(logErr);
    }
  }, 6 * 3600000);
  if (t.unref) t.unref();
}


/* ============================ API web (panel completo) ============================ */
const WL = 'es';
function serializeMod(g, cfg, m) {
  return {
    id: m.id, ico: m.ico, n: pick(WL, m.n), d: pick(WL, m.d), installable: m.inst !== false,
    on: isOn(cfg, m),
    fields: (m.fields || []).map((f) => ({ k: f.k, l: pick(WL, f.l), t: f.t, c: f.c || null, min: f.min, max: f.max, long: !!f.long, value: getPath(cfg, f.path) })),
    filters: (m.filters || []).map((f) => ({ k: f.k, n: pick(WL, f.n), value: !!getPath(cfg, f.path) })),
    pickers: (m.pickers || []).map((p) => ({ key: p.key, type: p.type, multi: !!p.multi, n: pick(WL, p.n), shown: p.show(cfg).replace(/<[#@&]+(\d+)>/g, '$1') })),
    acts: (m.acts || []).map((a) => ({ key: a.key, n: pick(WL, a.n) })),
  };
}
function webGuild(g) {
  const cfg = getCfg(g.id);
  return {
    id: g.id, name: g.name, icon: g.iconURL ? g.iconURL({ size: 64 }) : null, members: g.memberCount,
    channels: g.channels.cache.filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).map((c) => ({ id: c.id, name: c.name })),
    roles: g.roles.cache.filter((r) => r.id !== g.id && !r.managed).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name })),
    mods: MODS.map((m) => serializeMod(g, cfg, m)),
  };
}
async function webApply(g, modId, body) {
  const m = MOD.get(modId);
  if (!m) throw new Error('Módulo desconocido');
  const cfg = getCfg(g.id);
  const errs = [];
  for (const [k, raw] of Object.entries(body.fields || {})) {
    const f = (m.fields || []).find((x) => x.k === k);
    if (!f) continue;
    const v = parseField(f, raw);
    if (v === undefined) errs.push(pick(WL, f.l)); else setPath(cfg, f.path, v);
  }
  for (const [k, v] of Object.entries(body.filters || {})) {
    const f = (m.filters || []).find((x) => x.k === k);
    if (f) setPath(cfg, f.path, !!v);
  }
  for (const [k, v] of Object.entries(body.pickers || {})) {
    const p = (m.pickers || []).find((x) => x.key === k);
    const ids = (Array.isArray(v) ? v : [v]).filter((x) => /^\d{15,25}$/.test(String(x))).map(String);
    if (p && ids.length) p.set(cfg, p.multi ? ids : [ids[0]], { resolved: g.client.users.cache });
  }
  if (typeof body.on === 'boolean') {
    try {
      if (m.id === 'dmlock') await applyDmLock(g, body.on, cfg.dmLock.hours);
      setOn(cfg, m, body.on);
    } catch (e) {
      errs.push({ 'need-channel': 'Primero elige un canal', 'need-role': 'Primero elige un rol', 'need-verify': 'Primero elige canal y rol' }[e.message] || e.message);
    }
  }
  saveCfg();
  return { mod: serializeMod(g, cfg, m), errors: errs };
}
async function webAct(g, modId, key) {
  const m = MOD.get(modId);
  const a = m && (m.acts || []).find((x) => x.key === key);
  if (!a) throw new Error('Acción desconocida');
  const cfg = getCfg(g.id);
  const note = await a.run({ i: { user: { id: 'web' } }, g, cfg, lc: WL });
  saveCfg();
  return { note: String(note).replace(/<[#@&]+(\d+)>/g, '$1'), mod: serializeMod(g, cfg, m) };
}
async function webInstall(g, ids) {
  const cfg = getCfg(g.id);
  const sel = new Set((ids && ids.length ? ids : INSTALLABLE.map((m) => m.id)).filter((id) => INSTALLABLE.some((m) => m.id === id)));
  const e = await runInstall({ guild: g, user: { id: 'web' } }, cfg, WL, sel);
  return { summary: e.data.description };
}

module.exports = { webGuild, webApply, webAct, webInstall, commands: [helpCommand], handle, attach, MODS };
