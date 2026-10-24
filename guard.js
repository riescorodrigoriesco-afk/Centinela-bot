'use strict';

/*
 * guard.js — Comandos de seguridad con prefijo ($) y slash (/), automoderación extra,
 * advertencias progresivas, verificación, ban global, backups, protección de permisos.
 *
 * Cada comando se define UNA vez y funciona igual con prefijo o con slash.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits: P,
  PermissionsBitField,
  ChannelType,
  AuditLogEvent,
  IntentsBitField,
  GatewayIntentBits,
  MessageFlags,
} = require('discord.js');
const bot = require('./bot');
const backup = require('./backup');
const snap = require('./snap');

const { getCfg, saveCfg, L, GL, COLOR, jsonStore, sendLog, mkEmbed, punishMember, isTrusted, isStaff, canConfigure, lockedMsg, modLog, doPurge, doLock, doIsolate, findAuditEntry, activateRaid, endRaid, onOff, logErr, hooks, DANGEROUS, INVITE_PERMS } = bot;
const EPHEMERAL = MessageFlags.Ephemeral;

const warnStore = jsonStore('warns.json', () => ({}));
const gbanStore = jsonStore('gbans.json', () => ({}));
const muteStore = jsonStore('mutes.json', () => ({}));

/* ============================ utilidades ============================ */
const T = (ctx, en, es) => L(ctx.locale, en, es);
const rnd = (n) => Math.floor(Math.random() * n);
const idOf = (s) => {
  const m = String(s || '').trim().match(/^(?:<(?:@[!&]?|#)(\d{15,25})>|(\d{15,25}))$/);
  return m ? m[1] || m[2] : null;
};
const mkE = (color, title, desc) => {
  const e = new EmbedBuilder().setColor(color).setTitle(String(title).slice(0, 250));
  if (desc) e.setDescription(String(desc).slice(0, 3900));
  return e;
};
const rel = (ms) => '<t:' + Math.floor(ms / 1000) + ':R>';
const prefixOf = (ctx) => getCfg(ctx.guild.id).prefix || '$';
const FLAG_PG = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks];
const PGMASK = FLAG_PG.reduce((a, b) => a | b, 0n);

/* ============================ contexto común (prefijo / slash) ============================ */
function baseCtx(extra) {
  const ctx = {
    ...extra,
    arg: (n) => ctx.args[n],
    id: (n) => idOf(ctx.args[n]),
    rest: (n) => ctx.args.slice(n).join(' '),
    has: (w) => ctx.args.some((a) => String(a).toLowerCase() === w),
  };
  return ctx;
}

function msgCtx(msg, name, args) {
  return baseCtx({
    kind: 'msg',
    raw: msg,
    guild: msg.guild,
    member: msg.member,
    user: msg.author,
    channel: msg.channel,
    client: msg.client,
    locale: msg.guild.preferredLocale,
    name,
    args,
    async defer() {
      msg.channel.sendTyping().catch(() => {});
    },
    async reply(payload) {
      const p = typeof payload === 'string' ? { content: payload } : { ...payload };
      p.allowedMentions = { parse: [], repliedUser: false };
      try {
        return await msg.reply(p);
      } catch (_) {
        return msg.channel.send(p).catch(() => null);
      }
    },
  });
}

function slashCtx(i, cmd) {
  const args = [];
  for (const [n, t] of cmd.opts || []) {
    let v = null;
    if (t === 'user') {
      const u = i.options.getUser(n);
      v = u && u.id;
    } else if (t === 'channel') {
      const c = i.options.getChannel(n);
      v = c && c.id;
    } else if (t === 'role') {
      const r = i.options.getRole(n);
      v = r && r.id;
    } else if (t === 'int') {
      const x = i.options.getInteger(n);
      v = x === null || x === undefined ? null : String(x);
    } else if (t === 'bool') {
      v = i.options.getBoolean(n) ? n : null; // una casilla marcada se pasa como palabra clave
    } else {
      v = i.options.getString(n);
    }
    if (v !== null && v !== undefined && v !== '') args.push(String(v));
  }
  let state = 'none';
  return baseCtx({
    kind: 'slash',
    raw: i,
    guild: i.guild,
    member: i.member,
    user: i.user,
    channel: i.channel,
    client: i.client,
    locale: i.locale,
    name: cmd.name,
    args,
    async defer(pub) {
      if (state === 'none') {
        await i.deferReply(pub ? {} : { flags: EPHEMERAL });
        state = 'deferred';
      }
    },
    async reply(payload, o = {}) {
      const p = typeof payload === 'string' ? { content: payload } : { ...payload };
      p.allowedMentions = { parse: [] };
      if (state === 'none') {
        if (!o.pub) p.flags = EPHEMERAL;
        state = 'replied';
        return i.reply(p);
      }
      if (state === 'deferred') {
        state = 'replied';
        return i.editReply(p);
      }
      if (!o.pub) p.flags = EPHEMERAL;
      return i.followUp(p);
    },
  });
}

/* ============================ permisos ============================ */
let ownerIds = null;
let ownerFetchedAt = 0;
async function isBotOwner(client, userId) {
  const env = String(process.env.BOT_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.includes(userId)) return true;
  try {
    if (!ownerIds || Date.now() - ownerFetchedAt > 3600000) {
      const app = await client.application.fetch();
      const o = app.owner;
      ownerIds = new Set();
      if (o) {
        if (o.members) for (const m of o.members.values()) ownerIds.add(m.id);
        else ownerIds.add(o.id);
      }
      ownerFetchedAt = Date.now();
    }
  } catch (_) {}
  return !!ownerIds && ownerIds.has(userId);
}

async function allowed(ctx, cmd) {
  const g = ctx.guild;
  if (cmd.level === 'public') return true;
  if (cmd.level === 'mod') return !!ctx.member && (ctx.member.permissions.has(cmd.perm) || ctx.user.id === g.ownerId);
  if (cmd.level === 'cfg') return canConfigure(g, ctx.user.id, ctx.member);
  if (cmd.level === 'owner') return ctx.user.id === g.ownerId;
  if (cmd.level === 'botowner') return isBotOwner(ctx.client, ctx.user.id);
  return false;
}

function deny(ctx, cmd) {
  if (cmd.level === 'cfg') {
    const cfg = getCfg(ctx.guild.id);
    return ctx.reply(cfg.maxSecurity ? lockedMsg(ctx.locale) : T(ctx, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'));
  }
  if (cmd.level === 'owner') return ctx.reply(T(ctx, '🔒 Only the server owner can do this.', '🔒 Solo el dueño del servidor puede hacer esto.'));
  if (cmd.level === 'botowner') return ctx.reply(T(ctx, '🔒 Only the bot owner can do this.', '🔒 Solo el dueño del bot puede hacer esto.'));
  return ctx.reply(T(ctx, '❌ You do not have permission for this.', '❌ No tienes permiso para esto.'));
}

function canActOn(ctx, target) {
  if (!target) return false;
  if (target.id === ctx.guild.ownerId) return false;
  if (ctx.guild.ownerId === ctx.user.id) return true;
  return ctx.member.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

const fetchMember = (ctx, id) => (id ? ctx.guild.members.fetch(id).catch(() => null) : null);
const usage = (ctx, text) => ctx.reply(T(ctx, 'Usage: ', 'Uso: ') + text);

/* ============================ tabla de comandos ============================ */
const CMDS = [];
const def = (c) => {
  CMDS.push(c);
  return c;
};

/* ---------- ajustes ---------- */
const MODULES = {
  antibotadd: ['antiBotAdd', 'enabled'],
  antinuke: ['antiNuke', 'enabled'],
  joinflood: ['joinFlood', 'enabled'],
  antispam: ['antiSpam', 'enabled'],
  antimention: ['antiMassMention', 'enabled'],
  antiinvite: ['antiInvite', 'enabled'],
  antilink: ['antiLink', 'enabled'],
  antiiplogger: ['antiIpLogger', 'enabled'],
  antieveryone: ['antiEveryone', 'enabled'],
  mutevasion: ['antiMuteEvasion', 'enabled'],
  permguard: ['permGuard', 'enabled'],
  guildguard: ['guildGuard', 'enabled'],
  globalban: ['globalBan', 'enabled'],
  autowarn: ['autoWarn', 'enabled'],
  maxsecurity: ['maxSecurity'],
};

const CFG_KEYS = {
  'nuke.limit': { p: ['antiNuke', 'limit'], t: 'int', min: 2, max: 30 },
  'nuke.window': { p: ['antiNuke', 'windowSec'], t: 'int', min: 3, max: 120 },
  'nuke.pertype': { p: ['antiNuke', 'perTypeLimit'], t: 'int', min: 1, max: 30 },
  'nuke.pertypewindow': { p: ['antiNuke', 'perTypeWindowSec'], t: 'int', min: 10, max: 600 },
  'nuke.restore': { p: ['antiNuke', 'restore'], t: 'bool' },
  'nuke.panic': { p: ['antiNuke', 'panic'], t: 'bool' },
  'join.limit': { p: ['joinFlood', 'limit'], t: 'int', min: 2, max: 50 },
  'join.window': { p: ['joinFlood', 'windowSec'], t: 'int', min: 2, max: 120 },
  'join.action': { p: ['joinFlood', 'action'], t: 'choice', c: ['kick', 'ban', 'timeout'] },
  'join.raidminutes': { p: ['joinFlood', 'raidMinutes'], t: 'int', min: 1, max: 1440 },
  minage: { p: ['minAccountAgeDays'], t: 'int', min: 0, max: 365 },
  'spam.limit': { p: ['antiSpam', 'limit'], t: 'int', min: 3, max: 30 },
  'spam.window': { p: ['antiSpam', 'windowSec'], t: 'int', min: 2, max: 60 },
  'spam.timeout': { p: ['antiSpam', 'timeoutMin'], t: 'int', min: 1, max: 1440 },
  'mention.limit': { p: ['antiMassMention', 'limit'], t: 'int', min: 2, max: 50 },
  botadder: { p: ['antiBotAdd', 'punishAdder'], t: 'choice', c: ['ban', 'kick', 'none'] },
  'warn.mute': { p: ['autoWarn', 'muteAt'], t: 'int', min: 0, max: 20 },
  'warn.mutemin': { p: ['autoWarn', 'muteMin'], t: 'int', min: 1, max: 1440 },
  'warn.kick': { p: ['autoWarn', 'kickAt'], t: 'int', min: 0, max: 30 },
  'warn.ban': { p: ['autoWarn', 'banAt'], t: 'int', min: 0, max: 50 },
  'warn.expire': { p: ['autoWarn', 'expireDays'], t: 'int', min: 1, max: 365 },
  'backup.keep': { p: ['backup', 'keep'], t: 'int', min: 1, max: 20 },
};

function parseValue(k, raw) {
  const v = String(raw === undefined ? '' : raw).toLowerCase();
  if (k.t === 'bool') {
    if (['on', 'true', 'si', 'sí', '1', 'yes'].includes(v)) return true;
    if (['off', 'false', 'no', '0'].includes(v)) return false;
    return undefined;
  }
  if (k.t === 'choice') return k.c.includes(v) ? v : undefined;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < k.min || n > k.max) return undefined;
  return n;
}

function setPath(obj, path, value) {
  let o = obj;
  for (let n = 0; n < path.length - 1; n++) o = o[path[n]];
  o[path[path.length - 1]] = value;
}
function getPath(obj, path) {
  let o = obj;
  for (const k of path) o = o[k];
  return o;
}

/* ---------- salud del bot ---------- */
const NEED = [
  ['View Audit Log', P.ViewAuditLog],
  ['Ban Members', P.BanMembers],
  ['Kick Members', P.KickMembers],
  ['Manage Roles', P.ManageRoles],
  ['Manage Channels', P.ManageChannels],
  ['Manage Server', P.ManageGuild],
  ['Moderate Members', P.ModerateMembers],
  ['Manage Messages', P.ManageMessages],
  ['Manage Webhooks', P.ManageWebhooks],
  ['Embed Links', P.EmbedLinks],
];

function health(g) {
  const me = g.members.me;
  const missing = NEED.filter(([, f]) => !me.permissions.has(f)).map(([n]) => n);
  const top = me.roles.highest;
  const above = g.roles.cache.filter((r) => r.id !== g.id && !r.managed && r.comparePositionTo(top) > 0 && r.permissions.any(DANGEROUS)).map((r) => r.name);
  return { missing, above, topRole: top.name, botPos: top.position, total: g.roles.cache.size };
}

function statusEmbed(ctx) {
  const g = ctx.guild;
  const cfg = getCfg(g.id);
  const lc = ctx.locale;
  const raidOn = cfg.raidUntil > Date.now();
  const mods = Object.entries(MODULES)
    .map(([name, p]) => onOff(getPath(cfg, p)) + ' ' + name)
    .join('\n');
  const an = cfg.antiNuke;
  const w = cfg.autoWarn;
  const e = mkE(raidOn ? COLOR.red : COLOR.blue, '🛡️ ' + g.name, raidOn ? L(lc, '🚨 **RAID MODE ON** until ', '🚨 **MODO RAID ACTIVO** hasta ') + '<t:' + Math.floor(cfg.raidUntil / 1000) + ':R>' : L(lc, '✅ No active raid.', '✅ Sin raid activo.'));
  e.addFields(
    { name: L(lc, 'Modules', 'Módulos'), value: mods, inline: true },
    {
      name: L(lc, 'Limits', 'Límites'),
      value: [
        'nuke: ' + an.limit + '/' + an.windowSec + 's · ' + an.perTypeLimit + '/' + an.perTypeWindowSec + 's',
        'join: ' + cfg.joinFlood.limit + '/' + cfg.joinFlood.windowSec + 's → ' + cfg.joinFlood.action,
        'spam: ' + cfg.antiSpam.limit + '/' + cfg.antiSpam.windowSec + 's',
        'mention: ≥' + cfg.antiMassMention.limit,
        'minage: ' + cfg.minAccountAgeDays + ' d',
        'warn: mute ' + w.muteAt + ' · kick ' + w.kickAt + ' · ban ' + w.banAt,
        'restore: ' + onOff(an.restore) + ' · panic: ' + onOff(an.panic),
      ].join('\n'),
      inline: true,
    },
    {
      name: L(lc, 'Other', 'Otros'),
      value: [
        'prefix: `' + cfg.prefix + '`',
        'backup: ' + (cfg.backup.autoHours ? cfg.backup.autoHours + 'h' : 'off') + ' (' + backup.listBackups(g.id).length + ')',
        'verify: ' + onOff(cfg.verification.enabled),
        'whitelist: ' + cfg.whitelist.users.length + ' + ' + cfg.whitelist.bots.length + ' bots',
        L(lc, 'exempt channels: ', 'canales exentos: ') + cfg.exemptChannels.length,
        'logs: ' + Object.entries(cfg.logs).map(([k, v]) => k + ' ' + v.length).join(', '),
      ].join('\n'),
      inline: false,
    }
  );
  return e;
}

/* ---------- advertencias ---------- */
function activeWarns(guildId, userId) {
  const cfg = getCfg(guildId);
  const gd = warnStore.data[guildId];
  const list = (gd && gd[userId]) || [];
  const exp = cfg.autoWarn.expireDays * 86400000;
  return list.filter((x) => Date.now() - x.ts < exp);
}

async function addWarn(guild, userId, reason, byId, channel, { manual = false } = {}) {
  const cfg = getCfg(guild.id);
  const w = cfg.autoWarn;
  const gd = warnStore.data[guild.id] || (warnStore.data[guild.id] = {});
  const list = activeWarns(guild.id, userId);
  list.push({ ts: Date.now(), reason: String(reason).slice(0, 200), by: byId });
  gd[userId] = list;
  warnStore.save();
  const count = list.length;

  let action = 'none';
  let mins = 0;
  if (w.enabled) {
    if (w.banAt && count >= w.banAt) action = 'ban';
    else if (w.kickAt && count >= w.kickAt) action = 'kick';
    else if (w.muteAt && count >= w.muteAt) {
      action = 'timeout';
      mins = Math.min(40320, w.muteMin * Math.pow(2, count - w.muteAt));
    }
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  let res = 'none';
  if (action !== 'none' && !isTrusted(guild, userId, cfg) && !(member && isStaff(member))) {
    res = await punishMember(guild, userId, action, 'Centinela: ' + count + ' warnings', mins);
  }

  if (member) {
    member
      .send(
        GL(guild, '⚠️ Warning in **' + guild.name + '**: ' + reason + ' (' + count + (w.banAt ? '/' + w.banAt : '') + ')', '⚠️ Advertencia en **' + guild.name + '**: ' + reason + ' (' + count + (w.banAt ? '/' + w.banAt : '') + ')')
      )
      .catch(() => {});
  }
  modLog(
    guild,
    GL(guild, 'Warning', 'Advertencia'),
    [
      [GL(guild, 'User', 'Usuario'), '<@' + userId + '>'],
      [GL(guild, 'Reason', 'Motivo'), reason],
      [GL(guild, 'Total', 'Total'), count],
      [GL(guild, 'Action', 'Acción'), res === 'none' ? '—' : res + (mins ? ' ' + mins + ' min' : '')],
    ],
    COLOR.orange
  );
  if (!manual && channel && channel.send) {
    channel
      .send({ content: GL(guild, '⚠️ <@' + userId + '>, ' + reason + ' (' + count + ')', '⚠️ <@' + userId + '>, ' + reason + ' (' + count + ')'), allowedMentions: { users: [userId] } })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 6000))
      .catch(() => {});
  }
  return { count, action, res, mins };
}

/* Enganche para bot.js (spam, menciones masivas, invitaciones) */
const REASONS = {
  'invite link': ['Posting invite links', 'Enviar invitaciones'],
  'mass mention': ['Mass mentions', 'Menciones masivas'],
  spam: ['Spam', 'Spam'],
};
hooks.warn = async (guild, userId, key, channel) => {
  if (!getCfg(guild.id).autoWarn.enabled) return;
  const r = REASONS[key] || [key, key];
  await addWarn(guild, userId, GL(guild, r[0], r[1]), guild.client.user.id, channel);
};

/* ============================ comandos ============================ */

/* ---------- ayuda ---------- */
def({
  name: 'help',
  aliases: ['ayuda', 'comandos'],
  level: 'public',
  slash: true,
  d: 'Show what this bot can do',
  es: 'Muestra lo que puede hacer este bot',
  async run(ctx) {
    const p = prefixOf(ctx);
    const c = (list) => list.map((x) => '`' + p + x + '`').join(' ');
    const lc = ctx.locale;
    const e = mkE(COLOR.blue, '🛡️ ' + L(lc, 'Help', 'Ayuda'), L(lc, 'Prefix: ', 'Prefijo: ') + '`' + p + '` · ' + L(lc, 'commands marked with / also work as slash commands.', 'los comandos marcados con / también funcionan como slash.'));
    e.addFields(
      { name: L(lc, '🛡️ Antiraid (/)', '🛡️ Antiraid (/)'), value: c(['autosetup', 'config', 'settings', 'check', 'whitelist', 'delwhitelist', 'whitelisted']) + ' `/antiraid` `/panic` `/logs`' },
      { name: '💾 Backups (/)', value: c(['b-create', 'b-list', 'b-load', 'b-delete', 'b-auto']) },
      { name: L(lc, '🔨 Moderation', '🔨 Moderación'), value: c(['clear', 'lock', 'unlock', 'ban', 'kick', 'mute', 'unmute']) + ' (' + L(lc, 'prefix', 'prefijo') + ')\n' + c(['lockserver', 'unlockserver', 'nuke', 'delchan', 'snipe', 'idban', 'idunban', 'warn', 'warnings', 'clearwarns']) + ' (/)' },
      { name: L(lc, '🔗 Exempt channels (/)', '🔗 Canales exentos (/)'), value: c(['canalwhite', 'delcanalwhite', 'listcanalwhite']) },
      { name: L(lc, '✅ Other', '✅ Otros'), value: c(['verify', 'setprefix', 'apelar', 'invite', 'tutorial', 'perfil', 'server', 'ping']) },
      { name: L(lc, '🎮 Games & economy (/)', '🎮 Juegos y economía (/)'), value: '`/coinflip` `/dice` `/rps` `/slots` `/hilo` `/trivia` `/tictactoe` `/8ball` `/daily` `/work` `/balance` `/leaderboard`' }
    );
    return ctx.reply({ embeds: [e] });
  },
});

def({
  name: 'tutorial',
  aliases: ['setup'],
  level: 'public',
  slash: true,
  d: 'Step by step guide to set up the protection',
  es: 'Guía paso a paso para configurar la protección',
  async run(ctx) {
    const p = prefixOf(ctx);
    const lc = ctx.locale;
    const e = mkE(
      COLOR.blue,
      '📘 ' + L(lc, 'Setup guide', 'Guía de configuración'),
      L(
        lc,
        '1. Drag the bot role to the **top** of Server Settings → Roles.\n2. Run `' + p + 'autosetup` (creates log channels, turns everything on, makes a first backup).\n3. Run `' + p + 'check` and fix anything marked ❌.\n4. Add trusted people or bots with `' + p + 'whitelist @user`.\n5. Optional: `' + p + 'verify setup #channel @role`, `' + p + 'b-auto 24`, `' + p + 'settings antilink on`.\n6. See all settings with `' + p + 'config show`.',
        '1. Arrastra el rol del bot al **tope** de Ajustes del servidor → Roles.\n2. Ejecuta `' + p + 'autosetup` (crea los canales de logs, activa todo y hace un primer backup).\n3. Ejecuta `' + p + 'check` y corrige lo que salga con ❌.\n4. Añade personas o bots de confianza con `' + p + 'whitelist @usuario`.\n5. Opcional: `' + p + 'verify setup #canal @rol`, `' + p + 'b-auto 24`, `' + p + 'settings antilink on`.\n6. Mira todos los ajustes con `' + p + 'config show`.'
      )
    );
    return ctx.reply({ embeds: [e] });
  },
});

def({
  name: 'invite',
  aliases: ['invitar'],
  level: 'public',
  slash: true,
  d: 'Get the invite link of this bot',
  es: 'Obtén el link para invitar este bot',
  async run(ctx) {
    const url = 'https://discord.com/oauth2/authorize?client_id=' + ctx.client.user.id + '&scope=bot%20applications.commands&permissions=' + INVITE_PERMS;
    return ctx.reply(T(ctx, '🔗 Invite me: ', '🔗 Invítame: ') + url);
  },
});

def({
  name: 'plantilla',
  aliases: ['plantillas', 'template', 'templates'],
  level: 'cfg',
  perm: P.ManageGuild,
  d: 'Server templates: creates roles, channels, tickets and setup for a server type',
  es: 'Plantillas de servidor: crea roles, canales, tickets y configuración según el tipo de servidor',
  async run(ctx) {
    const tpl = require('./templates');
    const id = String(ctx.arg(0) || '').toLowerCase();
    const p = prefixOf(ctx);
    if (!id || !tpl.T[id]) {
      return ctx.reply(T(ctx, 'Pick a template: ', 'Elige una plantilla: ') + '\n' + tpl.LIST().map((x) => x.ico + ' `' + x.id + '` — ' + x.desc).join('\n') + '\n\n' + T(ctx, 'Apply with ', 'Aplícala con ') + '`' + p + 'plantilla <' + T(ctx, 'name', 'nombre') + '> confirm`');
    }
    if (String(ctx.arg(1) || '').toLowerCase() !== 'confirm') {
      const x = tpl.LIST().find((y) => y.id === id);
      return ctx.reply(T(ctx, 'This will create ', 'Esto creará ') + x.roles + T(ctx, ' roles and ', ' roles y ') + x.channels + T(ctx, ' channels (nothing of yours is deleted). Confirm with ', ' canales (no se borra nada tuyo). Confirma con ') + '`' + p + 'plantilla ' + id + ' confirm`');
    }
    const job = tpl.start(ctx.guild, id, { userId: ctx.user.id, clean: String(ctx.arg(2) || '').toLowerCase() === 'clean' });
    void job;
    await ctx.reply('🧩 ' + T(ctx, 'Applying the template… I will report when it is done.', 'Aplicando la plantilla… te aviso cuando termine.'));
    const ch = ctx.channel;
    const t0 = Date.now();
    const iv = setInterval(async () => {
      const st = tpl.status(ctx.guild.id);
      if (st.running && Date.now() - t0 < 600000) return;
      clearInterval(iv);
      ch.send({ content: '```\n' + st.lines.slice(-18).join('\n').slice(0, 1800) + '\n```' }).catch(() => {});
    }, 3000);
  },
});

def({
  name: 'ping',
  level: 'public',
  d: 'Bot latency',
  es: 'Latencia del bot',
  async run(ctx) {
    return ctx.reply('🏓 ' + ctx.client.ws.ping + ' ms');
  },
});

def({
  name: 'server',
  aliases: ['serverinfo', 'servidor'],
  level: 'public',
  d: 'Server information',
  es: 'Información del servidor',
  async run(ctx) {
    const g = ctx.guild;
    const cfg = getCfg(g.id);
    const e = mkE(COLOR.blue, g.name).addFields(
      { name: T(ctx, 'Members', 'Miembros'), value: String(g.memberCount), inline: true },
      { name: T(ctx, 'Channels', 'Canales'), value: String(g.channels.cache.size), inline: true },
      { name: 'Roles', value: String(g.roles.cache.size), inline: true },
      { name: T(ctx, 'Created', 'Creado'), value: '<t:' + Math.floor(g.createdTimestamp / 1000) + ':D>', inline: true },
      { name: 'Raid', value: cfg.raidUntil > Date.now() ? '🚨 ON' : '✅ OFF', inline: true }
    );
    if (g.iconURL()) e.setThumbnail(g.iconURL());
    return ctx.reply({ embeds: [e] });
  },
});

def({
  name: 'perfil',
  aliases: ['userinfo', 'user', 'profile'],
  level: 'public',
  d: 'User information',
  es: 'Información de un usuario',
  async run(ctx) {
    const id = ctx.id(0) || ctx.user.id;
    const user = await ctx.client.users.fetch(id).catch(() => null);
    if (!user) return ctx.reply(T(ctx, '❌ User not found.', '❌ Usuario no encontrado.'));
    const m = await fetchMember(ctx, id);
    const e = mkE(COLOR.blue, user.username)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: T(ctx, 'Account created', 'Cuenta creada'), value: rel(user.createdTimestamp), inline: true },
        { name: T(ctx, 'Joined', 'Se unió'), value: m && m.joinedTimestamp ? rel(m.joinedTimestamp) : '—', inline: true },
        { name: T(ctx, 'Warnings', 'Advertencias'), value: String(activeWarns(ctx.guild.id, id).length), inline: true }
      );
    return ctx.reply({ embeds: [e] });
  },
});

/* ---------- antiraid: autosetup / config / settings / check ---------- */
def({
  name: 'autosetup',
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Automatically configure the full protection',
  es: 'Configura automáticamente toda la protección',
  async run(ctx) {
    await ctx.defer();
    const g = ctx.guild;
    const cfg = getCfg(g.id);
    const me = g.members.me;
    if (!me.permissions.has(P.ManageChannels)) return ctx.reply(T(ctx, '❌ I need the **Manage Channels** permission first.', '❌ Primero necesito el permiso **Gestionar canales**.'));

    const reason = 'Centinela autosetup';
    let cat = g.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Centinela');
    if (!cat) {
      cat = await g.channels.create({
        name: 'Centinela',
        type: ChannelType.GuildCategory,
        reason,
        permissionOverwrites: [
          { id: g.id, type: 0, deny: [P.ViewChannel] },
          { id: me.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] },
        ],
      });
    }
    const wanted = { 'raid-logs': ['raid'], 'mod-logs': ['mod'], 'server-logs': ['server'], 'message-logs': ['messages'], 'member-logs': ['welcome', 'goodbye'] };
    const made = [];
    for (const [name, types] of Object.entries(wanted)) {
      let ch = g.channels.cache.find((c) => c.parentId === cat.id && c.name === name && c.type === ChannelType.GuildText);
      if (!ch) {
        ch = await g.channels.create({ name, type: ChannelType.GuildText, parent: cat.id, reason });
        await ch.lockPermissions().catch(() => {});
      }
      for (const t of types) if (!cfg.logs[t].includes(ch.id)) cfg.logs[t].push(ch.id);
      made.push('<#' + ch.id + '>');
    }

    for (const k of ['antiBotAdd', 'antiNuke', 'joinFlood', 'antiSpam', 'antiMassMention', 'antiInvite', 'antiIpLogger', 'antiEveryone', 'antiMuteEvasion', 'permGuard', 'guildGuard', 'globalBan', 'autoWarn']) cfg[k].enabled = true;
    cfg.antiNuke.restore = true;
    cfg.antiNuke.panic = true;
    if (!cfg.minAccountAgeDays) cfg.minAccountAgeDays = 3;
    if (!cfg.backup.autoHours) cfg.backup.autoHours = 24;
    saveCfg();

    let bk = null;
    try {
      bk = await backup.takeBackup(g, { messages: true, by: ctx.user.id });
    } catch (_) {}
    const h = health(g);

    const lc = ctx.locale;
    const e = mkE(COLOR.green, '✅ ' + L(lc, 'Protection configured', 'Protección configurada'));
    e.addFields(
      { name: L(lc, 'Log channels', 'Canales de logs'), value: made.join(' '), inline: false },
      { name: L(lc, 'Turned on', 'Activado'), value: 'antibotadd, antinuke (+rollback), joinflood, antispam, antimention, antiinvite, antiiplogger, antieveryone, mutevasion, permguard, guildguard, globalban, autowarn, minage 3d', inline: false },
      { name: 'Backup', value: bk ? '`' + bk.id + '` (' + bk.roles + ' roles, ' + bk.channels + ' ' + L(lc, 'channels', 'canales') + ') · ' + L(lc, 'auto every 24 h', 'automático cada 24 h') : L(lc, 'could not create the first backup', 'no se pudo crear el primer backup'), inline: false }
    );
    if (h.missing.length) e.addFields({ name: '❌ ' + L(lc, 'Missing permissions', 'Permisos faltantes'), value: h.missing.join(', ') });
    if (h.above.length) e.addFields({ name: '⚠️ ' + L(lc, 'Roles above mine with dangerous permissions', 'Roles por encima del mío con permisos peligrosos'), value: h.above.slice(0, 10).join(', ') + '\n' + L(lc, 'Drag my role above them.', 'Sube mi rol por encima de ellos.') });
    return ctx.reply({ embeds: [e] });
  },
});

def({
  name: 'config',
  level: 'mod',
  perm: P.ManageGuild,
  slash: true,
  d: 'Show or change the protection settings',
  es: 'Muestra o cambia los ajustes de protección',
  opts: [
    ['action', 'string', false, 'show or set', ['show', 'set']],
    ['key', 'string', false, 'Setting, e.g. nuke.limit or warn.ban'],
    ['value', 'string', false, 'New value'],
  ],
  async run(ctx) {
    const sub = String(ctx.arg(0) || 'show').toLowerCase();
    if (sub === 'show') return ctx.reply({ embeds: [statusEmbed(ctx)] });
    if (sub !== 'set') return usage(ctx, '`config show` · `config set <key> <value>`');
    if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return deny(ctx, { level: 'cfg' });
    const key = String(ctx.arg(1) || '').toLowerCase();
    const k = CFG_KEYS[key];
    if (!k) return ctx.reply(T(ctx, 'Available keys:\n', 'Claves disponibles:\n') + Object.keys(CFG_KEYS).map((x) => '`' + x + '`').join(' '));
    const v = parseValue(k, ctx.arg(2));
    if (v === undefined) return ctx.reply(T(ctx, '❌ Invalid value for `' + key + '`.', '❌ Valor no válido para `' + key + '`.') + (k.t === 'int' ? ' (' + k.min + '–' + k.max + ')' : k.t === 'choice' ? ' (' + k.c.join('/') + ')' : ' (on/off)'));
    const cfg = getCfg(ctx.guild.id);
    setPath(cfg, k.p, v);
    saveCfg();
    return ctx.reply('✅ `' + key + '` = `' + v + '`');
  },
});

def({
  name: 'settings',
  level: 'mod',
  perm: P.ManageGuild,
  slash: true,
  d: 'Turn protection modules on or off',
  es: 'Activa o desactiva módulos de protección',
  opts: [
    ['module', 'string', false, 'Module name (leave empty to list)'],
    ['state', 'string', false, 'on or off', ['on', 'off']],
  ],
  async run(ctx) {
    const cfg = getCfg(ctx.guild.id);
    const key = String(ctx.arg(0) || '').toLowerCase();
    if (!key) {
      const lines = Object.entries(MODULES).map(([n, p]) => onOff(getPath(cfg, p)) + ' `' + n + '`');
      lines.push(onOff(cfg.minAccountAgeDays > 0) + ' `altblock` (' + cfg.minAccountAgeDays + ' d)');
      return ctx.reply(lines.join('\n') + '\n\n' + T(ctx, 'Change one with `settings <module> on|off`.', 'Cambia uno con `settings <módulo> on|off`.'));
    }
    if (!canConfigure(ctx.guild, ctx.user.id, ctx.member)) return deny(ctx, { level: 'cfg' });
    const raw = String(ctx.arg(1) || '').toLowerCase();
    if (key === 'altblock') {
      const on = raw ? raw === 'on' : cfg.minAccountAgeDays === 0;
      cfg.minAccountAgeDays = on ? cfg.minAccountAgeDays || 7 : 0;
      saveCfg();
      return ctx.reply((on ? '🟢' : '🔴') + ' altblock: ' + (on ? cfg.minAccountAgeDays + ' d' : 'OFF'));
    }
    const m = MODULES[key];
    if (!m) return ctx.reply(T(ctx, '❌ Unknown module. Use `settings` to list them.', '❌ Módulo desconocido. Usa `settings` para ver la lista.'));
    const cur = getPath(cfg, m);
    const on = raw === 'on' ? true : raw === 'off' ? false : !cur;
    setPath(cfg, m, on);
    saveCfg();
    return ctx.reply((on ? '🟢 ' : '🔴 ') + key + ': ' + (on ? 'ON' : 'OFF'));
  },
});

def({
  name: 'check',
  aliases: ['permcheck'],
  level: 'mod',
  perm: P.ManageGuild,
  slash: true,
  d: 'Check permissions, role position and intents',
  es: 'Revisa permisos, posición del rol e intents',
  async run(ctx) {
    const g = ctx.guild;
    const cfg = getCfg(g.id);
    const h = health(g);
    const lc = ctx.locale;
    const ib = new IntentsBitField(ctx.client.options.intents);
    const rows = NEED.map(([n, f]) => (g.members.me.permissions.has(f) ? '✅' : '❌') + ' ' + n).join('\n');
    const e = mkE(h.missing.length || h.above.length ? COLOR.orange : COLOR.green, '🔎 ' + L(lc, 'Health check', 'Revisión'));
    e.addFields(
      { name: L(lc, 'Permissions', 'Permisos'), value: rows, inline: true },
      {
        name: L(lc, 'Position & intents', 'Posición e intents'),
        value: [
          L(lc, 'My top role: ', 'Mi rol más alto: ') + h.topRole + ' (' + h.botPos + '/' + (h.total - 1) + ')',
          (h.above.length ? '⚠️ ' + L(lc, 'Above me: ', 'Por encima de mí: ') + h.above.slice(0, 8).join(', ') : '✅ ' + L(lc, 'No dangerous role above me', 'Ningún rol peligroso por encima de mí')),
          (ib.has(GatewayIntentBits.GuildMembers) ? '✅' : '❌') + ' Server Members Intent',
          (ib.has(GatewayIntentBits.MessageContent) ? '✅' : '❌') + ' Message Content Intent',
          (cfg.logs.raid.length ? '✅' : '⚠️') + ' ' + L(lc, 'Raid log channel', 'Canal de logs de raid'),
          (backup.listBackups(g.id).length ? '✅' : '⚠️') + ' ' + L(lc, 'Backups: ', 'Backups: ') + backup.listBackups(g.id).length,
        ].join('\n'),
        inline: true,
      }
    );
    return ctx.reply({ embeds: [e] });
  },
});

/* ---------- whitelist ---------- */
def({
  name: 'whitelist',
  aliases: ['wl'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Trust a user or allow a bot',
  es: 'Da confianza a un usuario o permite un bot',
  opts: [['user', 'user', true, 'User or bot']],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'whitelist @user`');
    const u = await ctx.client.users.fetch(id).catch(() => null);
    if (!u) return ctx.reply(T(ctx, '❌ User not found.', '❌ Usuario no encontrado.'));
    const cfg = getCfg(ctx.guild.id);
    const list = cfg.whitelist[u.bot ? 'bots' : 'users'];
    if (!list.includes(id)) list.push(id);
    saveCfg();
    return ctx.reply('✅ ' + (u.bot ? '🤖 ' : '') + u.username + T(ctx, ' added to the whitelist.', ' añadido a la whitelist.'));
  },
});

def({
  name: 'delwhitelist',
  aliases: ['unwhitelist', 'dwl'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Remove a user or bot from the whitelist',
  es: 'Quita a un usuario o bot de la whitelist',
  opts: [['user', 'user', true, 'User or bot']],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'delwhitelist @user`');
    const cfg = getCfg(ctx.guild.id);
    cfg.whitelist.users = cfg.whitelist.users.filter((x) => x !== id);
    cfg.whitelist.bots = cfg.whitelist.bots.filter((x) => x !== id);
    saveCfg();
    return ctx.reply(T(ctx, '✅ Removed from the whitelist.', '✅ Quitado de la whitelist.'));
  },
});

def({
  name: 'whitelisted',
  aliases: ['whitelistlist', 'wls'],
  level: 'mod',
  perm: P.ManageGuild,
  slash: true,
  d: 'Show the whitelist',
  es: 'Muestra la whitelist',
  async run(ctx) {
    const cfg = getCfg(ctx.guild.id);
    const u = cfg.whitelist.users.map((id) => '<@' + id + '>').join(', ') || '—';
    const b = cfg.whitelist.bots.map((id) => '<@' + id + '>').join(', ') || '—';
    return ctx.reply(T(ctx, '**Trusted users:** ', '**Usuarios de confianza:** ') + u + '\n' + T(ctx, '**Allowed bots:** ', '**Bots permitidos:** ') + b);
  },
});

/* ---------- backups ---------- */
const busyMsg = (ctx) => ctx.reply(T(ctx, '⏳ Another backup operation is running. Try again in a moment.', '⏳ Hay otra operación de backup en curso. Prueba en un momento.'));

def({
  name: 'b-create',
  aliases: ['backup', 'bcreate'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Create a backup of the server',
  es: 'Crea un backup del servidor',
  opts: [['nomsg', 'bool', false, 'Do not save the last messages']],
  async run(ctx) {
    await ctx.defer();
    try {
      const m = await backup.takeBackup(ctx.guild, { messages: !ctx.has('nomsg'), by: ctx.user.id });
      return ctx.reply('✅ ' + T(ctx, 'Backup created: ', 'Backup creado: ') + '`' + m.id + '` — ' + m.roles + ' roles, ' + m.channels + ' ' + T(ctx, 'channels', 'canales') + ', ' + m.messages + ' ' + T(ctx, 'messages', 'mensajes') + '\n' + T(ctx, 'Restore with ', 'Restaura con ') + '`' + prefixOf(ctx) + 'b-load ' + m.id + ' confirm`');
    } catch (e) {
      if (e.message === 'busy') return busyMsg(ctx);
      throw e;
    }
  },
});

def({
  name: 'b-list',
  aliases: ['backups', 'blist'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'List the server backups',
  es: 'Lista los backups del servidor',
  async run(ctx) {
    const list = backup.listBackups(ctx.guild.id);
    if (!list.length) return ctx.reply(T(ctx, 'No backups yet. Create one with `' + prefixOf(ctx) + 'b-create`.', 'Aún no hay backups. Crea uno con `' + prefixOf(ctx) + 'b-create`.'));
    const lines = list.slice(0, 15).map((m) => '`' + m.id + '` ' + rel(m.createdAt) + ' · ' + m.roles + ' roles · ' + m.channels + ' ch · ' + m.messages + ' msg' + (m.auto ? ' · auto' : ''));
    return ctx.reply(lines.join('\n'));
  },
});

def({
  name: 'b-delete',
  aliases: ['bdelete'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Delete a backup',
  es: 'Borra un backup',
  opts: [['id', 'string', true, 'Backup id']],
  async run(ctx) {
    const id = String(ctx.arg(0) || '').toLowerCase();
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'b-delete <id>`');
    return ctx.reply(backup.deleteBackup(ctx.guild.id, id) ? T(ctx, '🗑️ Backup deleted.', '🗑️ Backup borrado.') : T(ctx, '❌ Backup not found.', '❌ Backup no encontrado.'));
  },
});

def({
  name: 'b-auto',
  aliases: ['bauto'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Automatic backups every N hours (or off)',
  es: 'Backups automáticos cada N horas (o apagados)',
  opts: [['hours', 'string', true, 'Hours between backups (1-168) or off']],
  async run(ctx) {
    const raw = String(ctx.arg(0) || '').toLowerCase();
    const cfg = getCfg(ctx.guild.id);
    if (raw === 'off' || raw === '0') {
      cfg.backup.autoHours = 0;
      saveCfg();
      return ctx.reply(T(ctx, '🔴 Automatic backups off.', '🔴 Backups automáticos desactivados.'));
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 168) return usage(ctx, '`' + prefixOf(ctx) + 'b-auto <1-168|off>`');
    cfg.backup.autoHours = n;
    cfg.backup.lastAuto = 0;
    saveCfg();
    return ctx.reply(T(ctx, '🟢 Automatic backup every ' + n + ' h (keeps the last ' + cfg.backup.keep + ').', '🟢 Backup automático cada ' + n + ' h (guarda los últimos ' + cfg.backup.keep + ').'));
  },
});

def({
  name: 'b-load',
  aliases: ['bload', 'restore'],
  level: 'owner',
  perm: P.Administrator,
  slash: true,
  d: 'Restore a backup (server owner only)',
  es: 'Restaura un backup (solo el dueño del servidor)',
  opts: [
    ['id', 'string', true, 'Backup id'],
    ['full', 'bool', false, 'Wipe everything first and restore it all'],
    ['confirm', 'bool', false, 'Required to actually run it'],
  ],
  async run(ctx) {
    const id = String(ctx.arg(0) || '').toLowerCase();
    const p = prefixOf(ctx);
    if (!id || ['full', 'confirm'].includes(id)) return usage(ctx, '`' + p + 'b-load <id> [full] confirm`');
    const b = backup.readBackup(ctx.guild.id, id);
    if (!b) return ctx.reply(T(ctx, '❌ Backup not found. See `' + p + 'b-list`.', '❌ Backup no encontrado. Mira `' + p + 'b-list`.'));
    const full = ctx.has('full');
    if (!ctx.has('confirm')) {
      return ctx.reply(
        full
          ? T(ctx, '⚠️ **FULL restore** deletes ALL channels and roles I can delete, then recreates everything from backup `' + id + '`.\nTo continue: `' + p + 'b-load ' + id + ' full confirm`', '⚠️ La restauración **COMPLETA** borra TODOS los canales y los roles que pueda borrar y recrea todo desde el backup `' + id + '`.\nPara continuar: `' + p + 'b-load ' + id + ' full confirm`')
          : T(ctx, 'ℹ️ This recreates only what is **missing** (channels and roles that already exist are not touched).\nTo continue: `' + p + 'b-load ' + id + ' confirm` — or add `full` to wipe and rebuild.', 'ℹ️ Esto recrea solo lo que **falta** (los canales y roles que ya existen no se tocan).\nPara continuar: `' + p + 'b-load ' + id + ' confirm` — o añade `full` para borrar y reconstruir.')
      );
    }
    await ctx.defer();
    if (ctx.kind === 'msg') await ctx.reply(T(ctx, '⏳ Restoring backup `' + id + '`… this can take a few minutes.', '⏳ Restaurando el backup `' + id + '`… puede tardar unos minutos.'));
    let rep;
    try {
      rep = await backup.restoreBackup(ctx.guild, b, { mode: full ? 'full' : 'merge' });
    } catch (e) {
      if (e.message === 'busy') return busyMsg(ctx);
      throw e;
    }
    const text =
      '✅ ' + T(ctx, 'Restore finished (', 'Restauración terminada (') + rep.mode + ')\n' +
      T(ctx, 'Roles created: ', 'Roles creados: ') + rep.rolesCreated + (rep.rolesFailed ? ' (' + rep.rolesFailed + ' ' + T(ctx, 'failed', 'fallaron') + ')' : '') + '\n' +
      T(ctx, 'Channels created: ', 'Canales creados: ') + rep.chansCreated + (rep.chansFailed ? ' (' + rep.chansFailed + ' ' + T(ctx, 'failed', 'fallaron') + ')' : '') + '\n' +
      T(ctx, 'Messages restored: ', 'Mensajes restaurados: ') + rep.msgs +
      (rep.mode === 'full' ? '\n' + T(ctx, 'Deleted before: ', 'Borrados antes: ') + rep.wipedChans + ' ch, ' + rep.wipedRoles + ' roles' : '') +
      (rep.errors.length ? '\n⚠️ ' + rep.errors.join('\n⚠️ ') : '');
    const out = await ctx.reply(text);
    if (!out) await ctx.user.send(text).catch(() => {});
    modLog(ctx.guild, 'Backup restore', [[T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], ['ID', id], ['mode', rep.mode]], COLOR.orange);
    return out;
  },
});

/* ---------- canales exentos ---------- */
function channelArg(ctx) {
  return ctx.id(0) || ctx.channel.id;
}
def({
  name: 'canalwhite',
  aliases: ['channelwhite'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Exempt a channel from link, invite and spam rules',
  es: 'Exime un canal de las reglas de enlaces, invitaciones y spam',
  opts: [['channel', 'channel', false, 'Channel (default: this one)']],
  async run(ctx) {
    const cfg = getCfg(ctx.guild.id);
    const id = channelArg(ctx);
    if (!cfg.exemptChannels.includes(id)) cfg.exemptChannels.push(id);
    saveCfg();
    return ctx.reply('✅ <#' + id + '> ' + T(ctx, 'is now exempt.', 'ahora está exento.'));
  },
});
def({
  name: 'delcanalwhite',
  aliases: ['delchannelwhite'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Remove a channel from the exempt list',
  es: 'Quita un canal de la lista de exentos',
  opts: [['channel', 'channel', false, 'Channel (default: this one)']],
  async run(ctx) {
    const cfg = getCfg(ctx.guild.id);
    const id = channelArg(ctx);
    cfg.exemptChannels = cfg.exemptChannels.filter((x) => x !== id);
    saveCfg();
    return ctx.reply('✅ <#' + id + '> ' + T(ctx, 'is protected again.', 'vuelve a estar protegido.'));
  },
});
def({
  name: 'listcanalwhite',
  aliases: ['listchannelwhite'],
  level: 'mod',
  perm: P.ManageGuild,
  slash: true,
  d: 'List the exempt channels',
  es: 'Lista los canales exentos',
  async run(ctx) {
    const cfg = getCfg(ctx.guild.id);
    return ctx.reply(cfg.exemptChannels.length ? cfg.exemptChannels.map((id) => '<#' + id + '>').join(' ') : T(ctx, 'No exempt channels.', 'No hay canales exentos.'));
  },
});

/* ---------- configuración básica ---------- */
def({
  name: 'setprefix',
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Change the prefix for text commands',
  es: 'Cambia el prefijo de los comandos de texto',
  opts: [['prefix', 'string', true, 'New prefix (1-3 characters)']],
  async run(ctx) {
    const p = String(ctx.arg(0) || '');
    if (!p || p.length > 3 || /\s/.test(p)) return usage(ctx, '`' + prefixOf(ctx) + 'setprefix <1-3 caracteres>`');
    getCfg(ctx.guild.id).prefix = p;
    saveCfg();
    return ctx.reply(T(ctx, '✅ New prefix: ', '✅ Nuevo prefijo: ') + '`' + p + '`');
  },
});

const appealCd = new Map();
def({
  name: 'apelar',
  aliases: ['appeal', 'staff'],
  level: 'public',
  slash: true,
  d: 'Send a message to the staff',
  es: 'Envía un mensaje al equipo de moderación',
  opts: [['message', 'string', true, 'What you want to tell the staff']],
  async run(ctx) {
    const text = ctx.rest(0).slice(0, 900);
    if (!text) return usage(ctx, '`' + prefixOf(ctx) + 'apelar <mensaje>`');
    const key = ctx.guild.id + ':' + ctx.user.id;
    if (Date.now() - (appealCd.get(key) || 0) < 300000) return ctx.reply(T(ctx, '⏳ Wait a few minutes before sending another message.', '⏳ Espera unos minutos antes de enviar otro mensaje.'));
    appealCd.set(key, Date.now());
    const e = mkEmbed(ctx.guild, COLOR.blue, GL(ctx.guild, '📨 Message for the staff', '📨 Mensaje para el staff'), text, [[GL(ctx.guild, 'From', 'De'), '<@' + ctx.user.id + '>'], [GL(ctx.guild, 'Channel', 'Canal'), '<#' + ctx.channel.id + '>']]);
    const cfg = getCfg(ctx.guild.id);
    if (cfg.logs.mod.length) await sendLog(ctx.guild, 'mod', e);
    else {
      const owner = await ctx.guild.fetchOwner().catch(() => null);
      if (owner) owner.send({ embeds: [e] }).catch(() => {});
    }
    return ctx.reply(T(ctx, '✅ Your message was sent to the staff.', '✅ Tu mensaje fue enviado al staff.'));
  },
});

/* ---------- moderación ---------- */
def({
  name: 'clear',
  aliases: ['purge', 'limpiar'],
  level: 'mod',
  perm: P.ManageMessages,
  d: 'Delete recent messages',
  es: 'Borra mensajes recientes',
  async run(ctx) {
    const n = parseInt(ctx.arg(0), 10);
    if (!n || n < 1) return usage(ctx, '`' + prefixOf(ctx) + 'clear <1-100> [@user]`');
    if (ctx.kind === 'msg') await ctx.raw.delete().catch(() => {});
    const done = await doPurge(ctx.channel, n, ctx.id(1));
    modLog(ctx.guild, 'Purge', [[T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Channel', 'Canal'), '<#' + ctx.channel.id + '>'], [T(ctx, 'Messages', 'Mensajes'), done]]);
    const note = await ctx.channel.send(T(ctx, '🧹 Deleted ' + done + ' messages.', '🧹 Se borraron ' + done + ' mensajes.'));
    setTimeout(() => note.delete().catch(() => {}), 4000);
  },
});

for (const lock of [true, false]) {
  def({
    name: lock ? 'lock' : 'unlock',
    aliases: lock ? ['bloquear'] : ['desbloquear'],
    level: 'mod',
    perm: P.ManageChannels,
    d: lock ? 'Lock a channel' : 'Unlock a channel',
    es: lock ? 'Bloquea un canal' : 'Desbloquea un canal',
    async run(ctx) {
      const id = ctx.id(0) || ctx.channel.id;
      const ch = ctx.guild.channels.cache.get(id);
      if (!ch) return ctx.reply(T(ctx, '❌ Channel not found.', '❌ Canal no encontrado.'));
      await doLock(ch, lock, 'By ' + ctx.user.username);
      modLog(ctx.guild, lock ? 'Lock' : 'Unlock', [[T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Channel', 'Canal'), '<#' + id + '>']]);
      return ctx.reply(lock ? '🔒 <#' + id + '>' : '🔓 <#' + id + '>');
    },
  });
}

def({
  name: 'lockserver',
  aliases: ['lockall'],
  level: 'mod',
  perm: P.ManageChannels,
  slash: true,
  d: 'Lock every text channel (nobody can write)',
  es: 'Bloquea todos los canales de texto (nadie puede escribir)',
  async run(ctx) {
    await ctx.defer();
    const g = ctx.guild;
    const cfg = getCfg(g.id);
    let n = 0;
    for (const ch of g.channels.cache.values()) {
      if (!snap.isText(ch.type) || cfg.lockedChannels[ch.id] !== undefined) continue;
      const ow = ch.permissionOverwrites.cache.get(g.id);
      const prev = ow ? (ow.deny.has(P.SendMessages) ? 'deny' : ow.allow.has(P.SendMessages) ? 'allow' : 'none') : 'none';
      if (prev === 'deny') continue;
      try {
        await doLock(ch, true, 'lockserver by ' + ctx.user.username);
        cfg.lockedChannels[ch.id] = prev;
        n++;
      } catch (_) {}
    }
    saveCfg();
    modLog(g, 'Lockserver', [[T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Channels', 'Canales'), n]], COLOR.red);
    return ctx.reply('🔒 ' + T(ctx, n + ' channels locked. Undo with `' + prefixOf(ctx) + 'unlockserver`.', n + ' canales bloqueados. Deshaz con `' + prefixOf(ctx) + 'unlockserver`.'));
  },
});

def({
  name: 'unlockserver',
  aliases: ['unlockall'],
  level: 'mod',
  perm: P.ManageChannels,
  slash: true,
  d: 'Unlock the channels locked by lockserver',
  es: 'Desbloquea los canales bloqueados con lockserver',
  async run(ctx) {
    await ctx.defer();
    const g = ctx.guild;
    const cfg = getCfg(g.id);
    let n = 0;
    for (const [id, prev] of Object.entries(cfg.lockedChannels)) {
      const ch = g.channels.cache.get(id);
      if (ch) {
        try {
          await ch.permissionOverwrites.edit(g.id, { SendMessages: prev === 'allow' ? true : null }, { reason: 'unlockserver by ' + ctx.user.username });
          n++;
        } catch (_) {}
      }
      delete cfg.lockedChannels[id];
    }
    saveCfg();
    modLog(g, 'Unlockserver', [[T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Channels', 'Canales'), n]]);
    return ctx.reply('🔓 ' + T(ctx, n + ' channels unlocked.', n + ' canales desbloqueados.'));
  },
});

def({
  name: 'nuke',
  level: 'mod',
  perm: P.ManageChannels,
  slash: true,
  d: 'Wipe a channel by recreating it empty',
  es: 'Vacía un canal recreándolo sin mensajes',
  opts: [['channel', 'channel', false, 'Channel (default: this one)']],
  async run(ctx) {
    await ctx.defer();
    const id = ctx.id(0) || ctx.channel.id;
    const ch = ctx.guild.channels.cache.get(id);
    if (!ch || !snap.isText(ch.type)) return ctx.reply(T(ctx, '❌ Only text channels can be nuked.', '❌ Solo se pueden vaciar canales de texto.'));
    const pos = ch.rawPosition;
    const nc = await ch.clone({ reason: 'nuke by ' + ctx.user.username });
    await ch.delete('nuke by ' + ctx.user.username);
    await nc.setPosition(pos).catch(() => {});
    modLog(ctx.guild, 'Nuke', [[T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Channel', 'Canal'), '<#' + nc.id + '>']], COLOR.red);
    await nc.send('💥 ' + T(ctx, 'Channel wiped by ', 'Canal vaciado por ') + '<@' + ctx.user.id + '>').catch(() => {});
    if (ctx.kind === 'slash') await ctx.reply('✅ <#' + nc.id + '>');
  },
});

def({
  name: 'delchan',
  aliases: ['delchannel'],
  level: 'mod',
  perm: P.ManageChannels,
  slash: true,
  d: 'Delete a channel',
  es: 'Borra un canal',
  opts: [['channel', 'channel', false, 'Channel (default: this one)']],
  async run(ctx) {
    const id = ctx.id(0) || ctx.channel.id;
    const ch = ctx.guild.channels.cache.get(id);
    if (!ch) return ctx.reply(T(ctx, '❌ Channel not found.', '❌ Canal no encontrado.'));
    const name = ch.name;
    await ch.delete('delchan by ' + ctx.user.username);
    modLog(ctx.guild, 'Delete channel', [[T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Channel', 'Canal'), '#' + name]], COLOR.red);
    if (id !== ctx.channel.id || ctx.kind === 'slash') return ctx.reply('🗑️ #' + name);
  },
});

const snipes = new Map();
def({
  name: 'snipe',
  level: 'mod',
  perm: P.ManageMessages,
  slash: true,
  d: 'Show the last deleted message in this channel',
  es: 'Muestra el último mensaje borrado en este canal',
  async run(ctx) {
    const s = snipes.get(ctx.channel.id);
    if (!s) return ctx.reply(T(ctx, 'Nothing to snipe.', 'No hay nada que mostrar.'));
    const e = mkE(COLOR.orange, '🕵️ ' + s.author, s.content || '—').addFields({ name: T(ctx, 'Deleted', 'Borrado'), value: rel(s.ts), inline: true });
    if (s.files.length) e.addFields({ name: T(ctx, 'Attachments', 'Adjuntos'), value: s.files.join('\n').slice(0, 1000) });
    return ctx.reply({ embeds: [e] });
  },
});

def({
  name: 'idban',
  level: 'mod',
  perm: P.BanMembers,
  slash: true,
  d: 'Ban a user by ID, even if not in the server',
  es: 'Banea a un usuario por ID, aunque no esté en el servidor',
  opts: [
    ['id', 'string', true, 'User ID'],
    ['reason', 'string', false, 'Reason'],
  ],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'idban <id> [razón]`');
    if (id === ctx.guild.ownerId || id === ctx.client.user.id) return ctx.reply(T(ctx, '❌ I cannot ban that user.', '❌ No puedo banear a ese usuario.'));
    const member = await fetchMember(ctx, id);
    if (member && !canActOn(ctx, member)) return ctx.reply(T(ctx, '❌ Hierarchy prevents this.', '❌ La jerarquía lo impide.'));
    const reason = ctx.rest(1) || 'By ' + ctx.user.username;
    await ctx.guild.members.ban(id, { reason });
    modLog(ctx.guild, 'ID ban', [['ID', id], [T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Reason', 'Motivo'), reason]], COLOR.red);
    return ctx.reply('🔨 `' + id + '`');
  },
});

def({
  name: 'idunban',
  aliases: ['unban'],
  level: 'mod',
  perm: P.BanMembers,
  slash: true,
  d: 'Unban a user by ID',
  es: 'Quita el ban a un usuario por ID',
  opts: [['id', 'string', true, 'User ID']],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'idunban <id>`');
    try {
      await ctx.guild.members.unban(id, 'By ' + ctx.user.username);
    } catch (_) {
      return ctx.reply(T(ctx, '❌ That user is not banned.', '❌ Ese usuario no está baneado.'));
    }
    modLog(ctx.guild, 'ID unban', [['ID', id], [T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>']]);
    return ctx.reply('✅ `' + id + '`');
  },
});

for (const kind of ['ban', 'kick']) {
  const isBan = kind === 'ban';
  def({
    name: kind,
    level: 'mod',
    perm: isBan ? P.BanMembers : P.KickMembers,
    d: isBan ? 'Ban a member' : 'Kick a member',
    es: isBan ? 'Banea a un miembro' : 'Expulsa a un miembro',
    async run(ctx) {
      const id = ctx.id(0);
      if (!id) return usage(ctx, '`' + prefixOf(ctx) + kind + ' @user [razón]`');
      const m = await fetchMember(ctx, id);
      if (!m && !isBan) return ctx.reply(T(ctx, '❌ Member not found.', '❌ Miembro no encontrado.'));
      if (m && (!canActOn(ctx, m) || !(isBan ? m.bannable : m.kickable))) return ctx.reply(T(ctx, '❌ I cannot do that (hierarchy or permissions).', '❌ No puedo hacerlo (jerarquía o permisos).'));
      const reason = ctx.rest(1) || 'By ' + ctx.user.username;
      if (isBan) await ctx.guild.members.ban(id, { reason });
      else await m.kick(reason);
      modLog(ctx.guild, isBan ? 'Ban' : 'Kick', [['ID', id], [T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], [T(ctx, 'Reason', 'Motivo'), reason]], COLOR.red);
      return ctx.reply((isBan ? '🔨 ' : '👢 ') + '<@' + id + '>');
    },
  });
}

def({
  name: 'mute',
  aliases: ['aislar', 'aislamiento', 'timeout'],
  level: 'mod',
  perm: P.ModerateMembers,
  d: 'Isolate (timeout) a member',
  es: 'Aísla (silencia) a un miembro',
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'mute @user [minutos] [razón]`');
    const m = await fetchMember(ctx, id);
    if (!m || !m.moderatable || !canActOn(ctx, m)) return ctx.reply(T(ctx, '❌ I cannot mute that member.', '❌ No puedo silenciar a ese miembro.'));
    const hasMin = /^\d+$/.test(String(ctx.arg(1) || ''));
    const mins = hasMin ? parseInt(ctx.arg(1), 10) : 10;
    const reason = ctx.rest(hasMin ? 2 : 1) || 'By ' + ctx.user.username;
    await doIsolate(m, mins, reason);
    modLog(ctx.guild, T(ctx, 'Isolation', 'Aislamiento'), [[T(ctx, 'User', 'Usuario'), '<@' + id + '>'], [T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>'], ['min', mins], [T(ctx, 'Reason', 'Motivo'), reason]]);
    return ctx.reply('⏳ <@' + id + '> ' + mins + ' min');
  },
});

def({
  name: 'unmute',
  aliases: ['desaislar'],
  level: 'mod',
  perm: P.ModerateMembers,
  d: 'Remove the isolation of a member',
  es: 'Quita el aislamiento de un miembro',
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'unmute @user`');
    const m = await fetchMember(ctx, id);
    if (!m || !m.moderatable) return ctx.reply(T(ctx, '❌ I cannot do that.', '❌ No puedo hacerlo.'));
    await doIsolate(m, 0, 'By ' + ctx.user.username);
    return ctx.reply('✅ <@' + id + '>');
  },
});

def({
  name: 'panic',
  aliases: ['panico'],
  level: 'mod',
  perm: P.ManageGuild,
  d: 'Turn raid mode on or off',
  es: 'Activa o desactiva el modo raid',
  async run(ctx) {
    const mode = String(ctx.arg(0) || '').toLowerCase();
    if (mode === 'on') {
      const mins = parseInt(ctx.arg(1), 10) || 30;
      await activateRaid(ctx.guild, T(ctx, 'Manual panic by ' + ctx.user.username, 'Pánico manual por ' + ctx.user.username), mins);
      return ctx.reply('🚨 ' + T(ctx, 'Raid mode ON for ' + mins + ' min.', 'Modo raid ACTIVO por ' + mins + ' min.'));
    }
    if (mode === 'off') {
      await endRaid(ctx.guild);
      return ctx.reply('✅ ' + T(ctx, 'Raid mode OFF.', 'Modo raid desactivado.'));
    }
    return usage(ctx, '`' + prefixOf(ctx) + 'panic on [min]` · `' + prefixOf(ctx) + 'panic off`');
  },
});

/* ---------- advertencias ---------- */
def({
  name: 'warn',
  aliases: ['advertir'],
  level: 'mod',
  perm: P.ModerateMembers,
  slash: true,
  d: 'Warn a member (escalates to mute, kick, ban)',
  es: 'Advierte a un miembro (escala a mute, kick y ban)',
  opts: [
    ['user', 'user', true, 'Member'],
    ['reason', 'string', false, 'Reason'],
  ],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'warn @user [razón]`');
    const m = await fetchMember(ctx, id);
    if (!m || !canActOn(ctx, m) || isTrusted(ctx.guild, id)) return ctx.reply(T(ctx, '❌ I cannot warn that member.', '❌ No puedo advertir a ese miembro.'));
    const reason = ctx.rest(1) || T(ctx, 'No reason given', 'Sin motivo');
    const r = await addWarn(ctx.guild, id, reason, ctx.user.id, null, { manual: true });
    return ctx.reply('⚠️ <@' + id + '> — ' + T(ctx, 'warnings: ', 'advertencias: ') + r.count + (r.action !== 'none' ? ' → ' + r.action + (r.mins ? ' ' + r.mins + ' min' : '') : ''));
  },
});

def({
  name: 'warnings',
  aliases: ['warns', 'advertencias'],
  level: 'mod',
  perm: P.ModerateMembers,
  slash: true,
  d: 'Show the warnings of a member',
  es: 'Muestra las advertencias de un miembro',
  opts: [['user', 'user', false, 'Member (default: you)']],
  async run(ctx) {
    const id = ctx.id(0) || ctx.user.id;
    const list = activeWarns(ctx.guild.id, id);
    if (!list.length) return ctx.reply(T(ctx, '✅ No active warnings.', '✅ Sin advertencias activas.'));
    return ctx.reply(list.slice(-10).map((w, n) => '**' + (n + 1) + '.** ' + rel(w.ts) + ' — ' + w.reason + (w.by ? ' (<@' + w.by + '>)' : '')).join('\n'));
  },
});

def({
  name: 'clearwarns',
  aliases: ['unwarn', 'borrarwarns'],
  level: 'mod',
  perm: P.ModerateMembers,
  slash: true,
  d: 'Clear the warnings of a member',
  es: 'Borra las advertencias de un miembro',
  opts: [['user', 'user', true, 'Member']],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'clearwarns @user`');
    if (warnStore.data[ctx.guild.id]) delete warnStore.data[ctx.guild.id][id];
    warnStore.save();
    modLog(ctx.guild, T(ctx, 'Warnings cleared', 'Advertencias borradas'), [[T(ctx, 'User', 'Usuario'), '<@' + id + '>'], [T(ctx, 'By', 'Por'), '<@' + ctx.user.id + '>']]);
    return ctx.reply('✅ <@' + id + '>');
  },
});

/* ---------- ban global (solo el dueño del bot) ---------- */
def({
  name: 'gban',
  level: 'botowner',
  perm: P.Administrator,
  slash: true,
  d: 'Global ban across every server using this bot (bot owner)',
  es: 'Ban global en todos los servidores con este bot (dueño del bot)',
  opts: [
    ['id', 'string', true, 'User ID'],
    ['reason', 'string', false, 'Reason'],
  ],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'gban <id> [razón]`');
    if (id === ctx.user.id || id === ctx.client.user.id) return ctx.reply('❌');
    await ctx.defer();
    const reason = ctx.rest(1) || 'Confirmed raider';
    gbanStore.data[id] = { reason: reason.slice(0, 200), by: ctx.user.id, ts: Date.now() };
    gbanStore.save();
    let n = 0;
    for (const g of ctx.client.guilds.cache.values()) {
      const cfg = getCfg(g.id);
      if (!cfg.globalBan.enabled || id === g.ownerId) continue;
      try {
        await g.members.ban(id, { reason: 'Global ban: ' + reason });
        n++;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 250));
    }
    return ctx.reply('🌐 `' + id + '` — ' + T(ctx, 'banned in ' + n + ' servers.', 'baneado en ' + n + ' servidores.'));
  },
});

def({
  name: 'ungban',
  level: 'botowner',
  perm: P.Administrator,
  slash: true,
  d: 'Remove a user from the global ban list (bot owner)',
  es: 'Quita a un usuario de la lista de ban global (dueño del bot)',
  opts: [['id', 'string', true, 'User ID']],
  async run(ctx) {
    const id = ctx.id(0);
    if (!id) return usage(ctx, '`' + prefixOf(ctx) + 'ungban <id>`');
    await ctx.defer();
    delete gbanStore.data[id];
    gbanStore.save();
    let n = 0;
    for (const g of ctx.client.guilds.cache.values()) {
      try {
        const b = await g.bans.fetch(id);
        if (b && String(b.reason || '').startsWith('Global ban')) {
          await g.members.unban(id, 'Global ban removed');
          n++;
        }
      } catch (_) {}
    }
    return ctx.reply('✅ `' + id + '` — ' + T(ctx, 'unbanned in ' + n + ' servers.', 'desbaneado en ' + n + ' servidores.'));
  },
});

/* ---------- verificación ---------- */
def({
  name: 'verify',
  aliases: ['verificar'],
  level: 'cfg',
  perm: P.ManageGuild,
  slash: true,
  d: 'Set up the verification button for new members',
  es: 'Configura el botón de verificación para nuevos miembros',
  opts: [
    ['action', 'string', true, 'setup or off', ['setup', 'off']],
    ['channel', 'channel', false, 'Channel where the button is posted'],
    ['role', 'role', false, 'Role given when verified'],
  ],
  async run(ctx) {
    const cfg = getCfg(ctx.guild.id);
    const act = String(ctx.arg(0) || '').toLowerCase();
    if (act === 'off') {
      cfg.verification.enabled = false;
      saveCfg();
      return ctx.reply(T(ctx, '🔴 Verification off.', '🔴 Verificación desactivada.'));
    }
    if (act !== 'setup') return usage(ctx, '`' + prefixOf(ctx) + 'verify setup #canal @rol` · `' + prefixOf(ctx) + 'verify off`');
    const chId = ctx.id(1);
    const roleId = ctx.id(2);
    const ch = chId && ctx.guild.channels.cache.get(chId);
    const role = roleId && ctx.guild.roles.cache.get(roleId);
    if (!ch || !ch.isTextBased() || !role) return usage(ctx, '`' + prefixOf(ctx) + 'verify setup #canal @rol`');
    if (role.managed || role.comparePositionTo(ctx.guild.members.me.roles.highest) >= 0) return ctx.reply(T(ctx, '❌ That role is above mine or managed by an integration.', '❌ Ese rol está por encima del mío o lo gestiona una integración.'));
    const lc = ctx.guild.preferredLocale;
    const e = mkE(COLOR.blue, '✅ ' + L(lc, 'Verification', 'Verificación'), L(lc, 'Press the button and answer a quick question to get access to the server.', 'Pulsa el botón y responde una pregunta rápida para entrar al servidor.'));
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('v:start').setLabel(L(lc, 'Verify', 'Verificarme')).setEmoji('✅').setStyle(ButtonStyle.Success));
    await ch.send({ embeds: [e], components: [row] });
    cfg.verification = { enabled: true, channel: ch.id, role: role.id };
    saveCfg();
    return ctx.reply(T(ctx, '✅ Verification panel sent to <#' + ch.id + '>. Make sure @everyone can only see that channel and **' + role.name + '** can see the rest.', '✅ Panel de verificación enviado a <#' + ch.id + '>. Haz que @everyone solo vea ese canal y que **' + role.name + '** vea el resto.'));
  },
});

/* ============================ comandos slash ============================ */
const LEVEL_PERM = { owner: P.Administrator, botowner: P.Administrator };

function buildSlash(c) {
  const b = new SlashCommandBuilder().setName(c.name).setDescription(c.d).setDMPermission(false);
  b.setDescriptionLocalizations({ 'es-ES': c.es, 'es-419': c.es });
  const perm = LEVEL_PERM[c.level] || (c.level === 'cfg' || c.level === 'mod' ? c.perm : null);
  if (perm) b.setDefaultMemberPermissions(perm);
  const opts = c.opts || [];
  const ordered = [...opts.filter((o) => o[2]), ...opts.filter((o) => !o[2])];
  for (const [n, t, req, d, choices] of ordered) {
    const fill = (o) => {
      o.setName(n).setDescription(d).setRequired(!!req);
      if (choices) o.addChoices(...choices.map((v) => ({ name: v, value: v })));
      return o;
    };
    if (t === 'user') b.addUserOption(fill);
    else if (t === 'channel') b.addChannelOption((o) => fill(o).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));
    else if (t === 'role') b.addRoleOption(fill);
    else if (t === 'int') b.addIntegerOption(fill);
    else if (t === 'bool') b.addBooleanOption(fill);
    else b.addStringOption(fill);
  }
  return b;
}

const commands = CMDS.filter((c) => c.slash).map((c) => ({
  data: buildSlash(c),
  async execute(i) {
    const ctx = slashCtx(i, c);
    if (!i.guild) return;
    if (!(await allowed(ctx, c))) return deny(ctx, c);
    return c.run(ctx);
  },
}));

require('./camisas').register(def);

const BY_NAME = new Map();
for (const c of CMDS) {
  BY_NAME.set(c.name, c);
  for (const a of c.aliases || []) if (!BY_NAME.has(a)) BY_NAME.set(a, c);
}

/* ============================ comandos con prefijo + automoderación ============================ */
const URL_RE = /https?:\/\/[^\s<>()]+|www\.[^\s<>()]+/gi;
const IP_LOGGERS = [
  'iplogger.org', 'iplogger.com', 'iplogger.ru', 'iplogger.co', 'iplogger.info', '2no.co', 'yip.su', 'iplog.co', 'ipgraber.ru', 'ipgrabber.ru',
  'grabify.link', 'grabify.org', 'blasze.com', 'blasze.tk', 'bmwforum.co', 'leancoding.co', 'quickmessage.us', 'spottyfly.com', 'stopify.co',
  'freegiftcards.co', 'joinmy.site', 'curiouscat.club', 'gyazo.nl', 'xn--discrd-x3a.com', 'discordgift.site', 'discord-gifts.com', 'dlscord.com',
];
const hostsIn = (text) => {
  const out = [];
  for (const m of String(text).matchAll(URL_RE)) {
    let u = m[0];
    if (!/^https?:/i.test(u)) u = 'http://' + u;
    try {
      out.push(new URL(u).hostname.toLowerCase().replace(/^www\./, ''));
    } catch (_) {}
  }
  return out;
};
const hostIn = (h, list) => list.some((d) => h === d || h.endsWith('.' + d));
const dupes = new Map();

async function violation(msg, reasonEn, reasonEs, color) {
  const g = msg.guild;
  await msg.delete().catch(() => {});
  modLog(g, GL(g, reasonEn, reasonEs), [[GL(g, 'User', 'Usuario'), '<@' + msg.author.id + '>'], [GL(g, 'Channel', 'Canal'), '<#' + msg.channelId + '>']], color || COLOR.orange);
  await addWarn(g, msg.author.id, GL(g, reasonEn, reasonEs), g.client.user.id, msg.channel);
}

async function automod(msg, cfg) {
  const g = msg.guild;
  const text = msg.content || '';
  if (!text) return;
  if (isTrusted(g, msg.author.id, cfg) || isStaff(msg.member)) return;
  const hosts = text.includes('.') ? hostsIn(text) : [];

  // Enlaces que registran la IP: se borran siempre, incluso en canales exentos
  if (cfg.antiIpLogger.enabled && hosts.some((h) => hostIn(h, IP_LOGGERS))) {
    sendLog(g, 'raid', mkEmbed(g, COLOR.red, GL(g, '🕵️ IP logger link blocked', '🕵️ Enlace de IP logger bloqueado'), null, [[GL(g, 'User', 'Usuario'), '<@' + msg.author.id + '>\n`' + msg.author.id + '`'], [GL(g, 'Channel', 'Canal'), '<#' + msg.channelId + '>']]));
    return violation(msg, 'IP logger link', 'Enlace de IP logger', COLOR.red);
  }

  if (cfg.antiEveryone.enabled && /@(everyone|here)\b/.test(text) && !msg.member.permissions.has(P.MentionEveryone)) {
    return violation(msg, 'Tried to mention @everyone', 'Intentó mencionar @everyone');
  }

  if (cfg.exemptChannels.includes(msg.channelId)) return;

  if (cfg.antiLink.enabled && hosts.length && hosts.some((h) => !hostIn(h, cfg.antiLink.allow))) {
    return violation(msg, 'Links are not allowed', 'No se permiten enlaces');
  }

  if (cfg.antiCaps.enabled && text.length >= cfg.antiCaps.minLength) {
    const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
    if (letters.length >= cfg.antiCaps.minLength * 0.6) {
      const caps = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
      if ((caps / letters.length) * 100 >= cfg.antiCaps.percent) return violation(msg, 'Too many capital letters', 'Demasiadas mayúsculas');
    }
  }
  if (cfg.antiEmoji.enabled) {
    const n = (text.match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) || []).length;
    if (n >= cfg.antiEmoji.limit) return violation(msg, 'Too many emojis', 'Demasiados emojis');
  }

  if (cfg.antiSpam.enabled && text.length >= 3) {
    const key = g.id + ':' + msg.author.id;
    const now = Date.now();
    const h = (dupes.get(key) || []).filter((x) => now - x.ts < 20000);
    h.push({ ts: now, c: text.toLowerCase().slice(0, 200) });
    dupes.set(key, h);
    if (h.filter((x) => x.c === h[h.length - 1].c).length >= 4) {
      dupes.delete(key);
      await msg.delete().catch(() => {});
      await punishMember(g, msg.author.id, 'timeout', 'Antiraid: repeated messages', cfg.antiSpam.timeoutMin);
      modLog(g, GL(g, 'Repeated messages', 'Mensajes repetidos'), [[GL(g, 'User', 'Usuario'), '<@' + msg.author.id + '>'], [GL(g, 'Action', 'Acción'), 'timeout ' + cfg.antiSpam.timeoutMin + ' min']], COLOR.red);
      await addWarn(g, msg.author.id, GL(g, 'Repeated messages', 'Mensajes repetidos'), g.client.user.id, msg.channel);
    }
  }
}

async function onMessage(msg) {
  if (!msg.guild || !msg.author || msg.author.bot || !msg.member) return;
  const cfg = getCfg(msg.guild.id);
  const content = msg.content || '';
  const prefix = cfg.prefix || '$';
  if (cfg.honeypot.enabled && cfg.honeypot.channel === msg.channelId && !isTrusted(msg.guild, msg.author.id, cfg) && !isStaff(msg.member)) {
    await msg.delete().catch(() => {});
    const act = cfg.honeypot.action;
    const res = await punishMember(msg.guild, msg.author.id, act, 'Centinela: honeypot', 60);
    sendLog(msg.guild, 'raid', mkEmbed(msg.guild, COLOR.red, GL(msg.guild, '🍯 Honeypot triggered', '🍯 Honeypot activado'), null, [[GL(msg.guild, 'User', 'Usuario'), '<@' + msg.author.id + '>\n`' + msg.author.id + '`'], [GL(msg.guild, 'Action', 'Acción'), res]]));
    return;
  }
  if (cfg.prefixEnabled !== false && content.length > prefix.length && content.startsWith(prefix)) {
    const [first, ...args] = content.slice(prefix.length).trim().split(/\s+/);
    const cmd = BY_NAME.get(String(first).toLowerCase());
    if (cmd) {
      const ctx = msgCtx(msg, cmd.name, args);
      try {
        if (!(await allowed(ctx, cmd))) await deny(ctx, cmd);
        else await cmd.run(ctx);
      } catch (e) {
        logErr(e);
        ctx.reply('⚠️ ' + String(e.message).slice(0, 300)).catch(() => {});
      }
      return;
    }
  }
  await automod(msg, cfg);
}

/* ============================ ingresos / salidas ============================ */
async function onJoin(member) {
  const g = member.guild;
  const cfg = getCfg(g.id);
  if (member.user.bot) return;

  const gb = gbanStore.data[member.id];
  if (cfg.globalBan.enabled && gb) {
    const res = await punishMember(g, member.id, 'ban', 'Global ban: ' + gb.reason);
    sendLog(g, 'raid', mkEmbed(g, COLOR.red, GL(g, '🌐 Global ban blocked a join', '🌐 Ban global bloqueó un ingreso'), null, [[GL(g, 'User', 'Usuario'), member.user.username + '\n`' + member.id + '`'], [GL(g, 'Reason', 'Motivo'), gb.reason], [GL(g, 'Action', 'Acción'), res]]));
    return;
  }

  if (cfg.antiMuteEvasion.enabled) {
    const gm = muteStore.data[g.id];
    const until = gm && gm[member.id];
    if (until) {
      delete gm[member.id];
      muteStore.save();
      if (until > Date.now()) {
        const dur = Math.min((until - Date.now()) * 2, 28 * 86400000);
        try {
          await member.timeout(dur, 'Centinela: mute evasion');
          modLog(g, GL(g, 'Mute evasion', 'Evasión de mute'), [[GL(g, 'User', 'Usuario'), '<@' + member.id + '>'], [GL(g, 'Muted for', 'Silenciado por'), Math.round(dur / 60000) + ' min']], COLOR.red);
        } catch (_) {}
      }
    }
  }
}

function onLeave(member) {
  try {
    const until = member.communicationDisabledUntilTimestamp;
    if (until && until > Date.now()) {
      const gm = muteStore.data[member.guild.id] || (muteStore.data[member.guild.id] = {});
      gm[member.id] = until;
      muteStore.save();
    }
  } catch (_) {}
}

/* ============================ protección de permisos, nombre y webhooks ============================ */
async function onRoleUpdate(oldR, newR) {
  const g = newR.guild;
  const cfg = getCfg(g.id);
  if (!cfg.permGuard.enabled || newR.managed) return;
  const gained = newR.permissions.bitfield & ~oldR.permissions.bitfield & PGMASK;
  if (gained === 0n) return;
  const entry = await findAuditEntry(g, AuditLogEvent.RoleUpdate, newR.id, 10000, 3);
  if (!entry || !entry.executor || isTrusted(g, entry.executor.id, cfg)) return;
  let res = 'ok';
  try {
    await newR.setPermissions(oldR.permissions, 'Centinela: permission guard');
  } catch (e) {
    res = 'failed: ' + e.message;
  }
  sendLog(g, 'raid', mkEmbed(g, COLOR.red, GL(g, '🔐 Role permission escalation reverted', '🔐 Subida de permisos de un rol revertida'), null, [
    [GL(g, 'Role', 'Rol'), '@' + newR.name],
    [GL(g, 'By', 'Por'), '<@' + entry.executor.id + '>'],
    [GL(g, 'Added', 'Añadido'), new PermissionsBitField(gained).toArray().join(', ')],
    [GL(g, 'Result', 'Resultado'), res],
  ]));
}

async function onMemberUpdate(oldM, newM) {
  if (oldM.partial) return;
  const g = newM.guild;
  const cfg = getCfg(g.id);
  if (!cfg.permGuard.enabled) return;
  const added = newM.roles.cache.filter((r) => !oldM.roles.cache.has(r.id) && !r.managed && (r.permissions.bitfield & PGMASK) !== 0n);
  if (!added.size) return;
  const entry = await findAuditEntry(g, AuditLogEvent.MemberRoleUpdate, newM.id, 10000, 3);
  if (!entry || !entry.executor || isTrusted(g, entry.executor.id, cfg)) return;
  let res = 'ok';
  try {
    await newM.roles.remove(added, 'Centinela: permission guard');
  } catch (e) {
    res = 'failed: ' + e.message;
  }
  sendLog(g, 'raid', mkEmbed(g, COLOR.red, GL(g, '🔐 Dangerous role assignment reverted', '🔐 Asignación de rol peligroso revertida'), null, [
    [GL(g, 'Member', 'Miembro'), '<@' + newM.id + '>'],
    [GL(g, 'Roles', 'Roles'), added.map((r) => '@' + r.name).join(', ')],
    [GL(g, 'By', 'Por'), '<@' + entry.executor.id + '>'],
    [GL(g, 'Result', 'Resultado'), res],
  ]));
}

async function onGuildUpdate(oldG, newG) {
  const cfg = getCfg(newG.id);
  if (!cfg.guildGuard.enabled || oldG.name === newG.name) return;
  const entry = await findAuditEntry(newG, AuditLogEvent.GuildUpdate, null, 10000, 3);
  if (!entry || !entry.executor || isTrusted(newG, entry.executor.id, cfg)) return;
  let res = 'ok';
  try {
    await newG.setName(oldG.name, 'Centinela: guild guard');
  } catch (e) {
    res = 'failed: ' + e.message;
  }
  sendLog(newG, 'raid', mkEmbed(newG, COLOR.red, GL(newG, '🏷️ Server rename reverted', '🏷️ Cambio de nombre del servidor revertido'), null, [[GL(newG, 'By', 'Por'), '<@' + entry.executor.id + '>'], [GL(newG, 'Attempted name', 'Nombre intentado'), newG.name], [GL(newG, 'Result', 'Resultado'), res]]));
}

async function onWebhooks(ch) {
  const g = ch.guild;
  if (!g) return;
  const cfg = getCfg(g.id);
  if (!cfg.permGuard.enabled || !ch.fetchWebhooks) return;
  const entry = await findAuditEntry(g, AuditLogEvent.WebhookCreate, null, 8000, 2);
  if (!entry || !entry.executor || isTrusted(g, entry.executor.id, cfg)) return;
  try {
    const list = await ch.fetchWebhooks();
    const wh = list.get(entry.targetId);
    if (!wh) return;
    await wh.delete('Centinela: webhook guard');
    sendLog(g, 'raid', mkEmbed(g, COLOR.orange, GL(g, '🪝 Webhook deleted', '🪝 Webhook eliminado'), null, [[GL(g, 'Channel', 'Canal'), '<#' + ch.id + '>'], [GL(g, 'Created by', 'Creado por'), '<@' + entry.executor.id + '>']]));
  } catch (_) {}
}

/* ============================ mensajes borrados / editados ============================ */
function onDelete(msg) {
  if (!msg.guild || msg.partial || !msg.author || msg.author.bot) return;
  const files = [...msg.attachments.values()].map((a) => a.url).slice(0, 3);
  snipes.set(msg.channelId, { content: String(msg.content || '').slice(0, 1500), author: msg.author.username, ts: Date.now(), files });
  if (snipes.size > 500) snipes.delete(snipes.keys().next().value);
  const cfg = getCfg(msg.guild.id);
  if (cfg.logs.messages.length && (msg.content || files.length)) {
    sendLog(msg.guild, 'messages', mkEmbed(msg.guild, COLOR.orange, GL(msg.guild, '🗑️ Message deleted', '🗑️ Mensaje borrado'), msg.content || files.join('\n'), [[GL(msg.guild, 'Author', 'Autor'), '<@' + msg.author.id + '>'], [GL(msg.guild, 'Channel', 'Canal'), '<#' + msg.channelId + '>']]));
  }
}

function onEdit(oldM, newM) {
  if (!newM.guild || oldM.partial || !newM.author || newM.author.bot || oldM.content === newM.content) return;
  const cfg = getCfg(newM.guild.id);
  if (!cfg.logs.messages.length) return;
  sendLog(newM.guild, 'messages', mkEmbed(newM.guild, COLOR.blue, GL(newM.guild, '✏️ Message edited', '✏️ Mensaje editado'), null, [
    [GL(newM.guild, 'Before', 'Antes'), String(oldM.content || '—').slice(0, 900)],
    [GL(newM.guild, 'After', 'Después'), String(newM.content || '—').slice(0, 900)],
    [GL(newM.guild, 'Author', 'Autor'), '<@' + newM.author.id + '>'],
    [GL(newM.guild, 'Channel', 'Canal'), '<#' + newM.channelId + '>'],
  ]));
}

/* ============================ botón de verificación ============================ */
const challenges = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) if (now > v.exp) challenges.delete(k);
}, 60000).unref();

function question(userId, tries) {
  const x = 2 + rnd(8);
  const y = 2 + rnd(8);
  const ans = x + y;
  const opts = new Set([ans]);
  while (opts.size < 4) opts.add(Math.max(1, ans + rnd(7) - 3));
  const arr = [...opts].sort(() => Math.random() - 0.5);
  return {
    ans,
    tries,
    exp: Date.now() + 120000,
    text: x + ' + ' + y,
    row: new ActionRowBuilder().addComponents(arr.map((n) => new ButtonBuilder().setCustomId('v:a:' + userId + ':' + n).setLabel(String(n)).setStyle(ButtonStyle.Secondary))),
  };
}

async function handleButton(i) {
  if (!i.customId.startsWith('v:')) return false;
  const g = i.guild;
  const lc = i.locale;
  if (!g || !i.member) return true;
  const cfg = getCfg(g.id);
  const role = cfg.verification.role && g.roles.cache.get(cfg.verification.role);
  if (!cfg.verification.enabled || !role) {
    await i.reply({ content: L(lc, 'Verification is not active.', 'La verificación no está activa.'), flags: EPHEMERAL });
    return true;
  }
  const [, act, uid, val] = i.customId.split(':');
  const key = i.user.id + ':' + g.id;

  if (act === 'start') {
    if (i.member.roles.cache.has(role.id)) {
      await i.reply({ content: L(lc, '✅ You are already verified.', '✅ Ya estás verificado.'), flags: EPHEMERAL });
      return true;
    }
    const prev = challenges.get(key);
    const q = question(i.user.id, prev ? prev.tries : 0);
    challenges.set(key, q);
    await i.reply({ content: '🔐 ' + L(lc, 'How much is ', '¿Cuánto es ') + '**' + q.text + '**?', components: [q.row], flags: EPHEMERAL });
    return true;
  }

  if (act === 'a') {
    if (uid !== i.user.id) {
      await i.reply({ content: L(lc, 'This question is not for you.', 'Esta pregunta no es para ti.'), flags: EPHEMERAL });
      return true;
    }
    const ch = challenges.get(key);
    if (!ch || Date.now() > ch.exp) {
      await i.update({ content: L(lc, '⌛ Expired. Press the verify button again.', '⌛ Expiró. Pulsa de nuevo el botón de verificar.'), components: [] });
      return true;
    }
    if (parseInt(val, 10) === ch.ans) {
      challenges.delete(key);
      try {
        await i.member.roles.add(role, 'Centinela: verification');
        await i.update({ content: L(lc, '✅ Verified! Welcome.', '✅ ¡Verificado! Bienvenido.'), components: [] });
        modLog(g, GL(g, 'Member verified', 'Miembro verificado'), [[GL(g, 'User', 'Usuario'), '<@' + i.user.id + '>']], COLOR.green);
      } catch (e) {
        await i.update({ content: L(lc, '⚠️ I could not give you the role. Tell the staff.', '⚠️ No pude darte el rol. Avisa al staff.'), components: [] });
      }
      return true;
    }
    ch.tries++;
    if (ch.tries >= 3) {
      challenges.delete(key);
      await i.update({ content: L(lc, '❌ Too many wrong answers.', '❌ Demasiadas respuestas incorrectas.'), components: [] });
      modLog(g, GL(g, 'Verification failed', 'Verificación fallida'), [[GL(g, 'User', 'Usuario'), '<@' + i.user.id + '>']], COLOR.red);
      if (i.member.kickable) await i.member.kick('Centinela: failed verification').catch(() => {});
      return true;
    }
    const q = question(i.user.id, ch.tries);
    challenges.set(key, q);
    await i.update({ content: '❌ ' + L(lc, 'Wrong. Try again: ', 'Incorrecto. Prueba otra vez: ') + '**' + q.text + '**', components: [q.row] });
    return true;
  }
  return false;
}

/* ============================ conexión de eventos ============================ */
function attach(client) {
  client.on('messageCreate', (m) => onMessage(m).catch(logErr));
  client.on('guildMemberAdd', (m) => onJoin(m).catch(logErr));
  client.on('guildMemberRemove', onLeave);
  client.on('guildMemberUpdate', (a, b) => onMemberUpdate(a, b).catch(logErr));
  client.on('roleUpdate', (a, b) => onRoleUpdate(a, b).catch(logErr));
  client.on('guildUpdate', (a, b) => onGuildUpdate(a, b).catch(logErr));
  client.on('webhooksUpdate', (ch) => onWebhooks(ch).catch(logErr));
  client.on('messageDelete', onDelete);
  client.on('messageUpdate', onEdit);
  backup.startAuto(client, getCfg, saveCfg, logErr);
}

module.exports = { commands, handleButton, attach, CMDS, BY_NAME, statusEmbed, health };
