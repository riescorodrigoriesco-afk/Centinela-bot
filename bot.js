'use strict';

/*
 * bot.js — Antiraid, moderación, logs por tipo, bienvenidas/despedidas.
 * Exporta: commands (slash), buttons, attach(client), restoreRaidTimers(client) y utilidades.
 */

const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  PermissionsBitField,
  AuditLogEvent,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const snap = require('./snap');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

/* ============================ utilidades ============================ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const lang = (locale) => (String(locale || 'en').toLowerCase().startsWith('es') ? 'es' : 'en');
const L = (locale, en, es) => (lang(locale) === 'es' ? es : en);
const GL = (guild, en, es) => L(guild.preferredLocale, en, es);
const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
const EPHEMERAL = MessageFlags.Ephemeral;
const COLOR = { red: 0xed4245, orange: 0xf0b232, green: 0x3ba55d, blue: 0x5865f2 };
const logErr = (e) => console.error('[bot]', e && e.message ? e.message : e);
const onOff = (b) => (b ? '🟢' : '🔴');
const say = (i, content, ephemeral = true) => i.reply({ content, ...(ephemeral ? { flags: EPHEMERAL } : {}) });

function jsonStore(name, fallback) {
  const file = path.join(DATA_DIR, name);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    data = fallback();
  }
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
      } catch (e) {
        logErr('No se pudo guardar ' + name + ': ' + e.message);
      }
    }, 1000);
    if (timer.unref) timer.unref();
  };
  return { data, save };
}

/* ======================= configuración por servidor ======================= */
const DEFAULTS = {
  prefix: '$',
  prefixEnabled: true,
  reports: { enabled: false, channel: null },
  tagRole: { enabled: false, role: null },
  dmLock: { enabled: false, hours: 24 },
  badWords: { enabled: false, words: [], action: 'delete' },
  tickets: { enabled: false, channel: null, staffRole: null, logChannel: null, categories: [], perUser: 1 },
  rolePanel: { channel: null, roles: [], mode: 'buttons', emojis: [], tempHours: 0, reactionMsg: null, reactionMap: {} },
  levels: { enabled: false, announce: true, xpMin: 15, xpMax: 25, cooldownSec: 60, rewards: [], activityRole: null, activityMessages: 0 },
  voice: { enabled: true, lang: 'es', gender: 'female', persona: '', transcript: true, roast: true, ignored: [] },
  shirts: { mode: 'real', channel: null, every: 10 },
  autoRole: { enabled: false, humans: [], bots: [], delaySec: 0, tempHours: 0 },
  maxSecurity: true,
  exemptChannels: [],
  lockedChannels: {},
  antiBotAdd: { enabled: true, punishAdder: 'ban' },
  antiNuke: { enabled: true, limit: 3, windowSec: 10, perTypeLimit: 3, perTypeWindowSec: 60, restore: true, panic: true },
  joinFlood: { enabled: true, limit: 6, windowSec: 10, action: 'kick', raidMinutes: 10 },
  minAccountAgeDays: 0,
  antiSpam: { enabled: true, limit: 7, windowSec: 5, timeoutMin: 10 },
  antiMassMention: { enabled: true, limit: 6 },
  antiInvite: { enabled: false },
  antiLink: { enabled: false, allow: ['tenor.com', 'giphy.com', 'discord.com', 'discordapp.com', 'discordapp.net'] },
  antiIpLogger: { enabled: true },
  antiEveryone: { enabled: true },
  antiCaps: { enabled: false, percent: 70, minLength: 12 },
  antiEmoji: { enabled: false, limit: 10 },
  honeypot: { enabled: false, channel: null, action: 'ban' },
  ui: { color: '#3fd0b0', lang: 'auto', ephemeral: true },
  antiMuteEvasion: { enabled: true },
  permGuard: { enabled: true },
  guildGuard: { enabled: true },
  globalBan: { enabled: true },
  autoWarn: { enabled: true, muteAt: 3, muteMin: 60, kickAt: 5, banAt: 7, expireDays: 30 },
  verification: { enabled: false, channel: null, role: null },
  backup: { autoHours: 0, keep: 5, lastAuto: 0 },
  whitelist: { users: [], bots: [] },
  raidUntil: 0,
  invitesWereOff: false,
  logs: { raid: [], mod: [], welcome: [], goodbye: [], messages: [], server: [] },
  welcome: { enabled: false, channel: null, message: null, dm: false, dmMessage: null, image: false },
  goodbye: { enabled: false, channel: null, message: null, dm: false, dmMessage: null, image: false },
};

const guilds = jsonStore('guilds.json', () => ({}));

function fill(target, defs) {
  for (const k of Object.keys(defs)) {
    if (target[k] === undefined) target[k] = clone(defs[k]);
    else if (isObj(defs[k]) && isObj(target[k])) fill(target[k], defs[k]);
  }
  return target;
}

function getCfg(guildId) {
  if (!guilds.data[guildId]) guilds.data[guildId] = {};
  return fill(guilds.data[guildId], DEFAULTS);
}
const saveCfg = () => guilds.save();

/* ============================ logs ============================ */
const ownerPing = new Map();

function mkEmbed(guild, color, title, desc, fields = []) {
  const e = new EmbedBuilder().setColor(color).setTitle(String(title).slice(0, 250)).setTimestamp().setFooter({ text: guild.name });
  if (desc) e.setDescription(String(desc).slice(0, 3900));
  if (fields.length) {
    e.addFields(fields.map(([name, value]) => ({ name: String(name).slice(0, 250), value: String(value || '—').slice(0, 1000), inline: true })));
  }
  return e;
}

async function sendLog(guild, type, embed) {
  try {
    const cfg = getCfg(guild.id);
    let sent = 0;
    for (const id of cfg.logs[type] || []) {
      const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
      if (ch && ch.isTextBased()) {
        const ok = await ch.send({ embeds: [embed] }).then(() => true).catch(() => false);
        if (ok) sent++;
      }
    }
    // Sin canal de raid configurado: avisar al dueño por DM (máx. 1 por minuto)
    if (!sent && type === 'raid') {
      const last = ownerPing.get(guild.id) || 0;
      if (Date.now() - last > 60000) {
        ownerPing.set(guild.id, Date.now());
        const owner = await guild.fetchOwner().catch(() => null);
        if (owner) owner.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch (e) {
    logErr(e);
  }
}

/* ============================ permisos ============================ */
function isTrusted(guild, userId, cfg) {
  const c = cfg || getCfg(guild.id);
  return userId === guild.ownerId || userId === guild.client.user.id || c.whitelist.users.includes(userId) || c.whitelist.bots.includes(userId);
}

/* Máxima seguridad: solo el dueño y la whitelist pueden cambiar la protección. */
function canConfigure(guild, userId, member) {
  const cfg = getCfg(guild.id);
  if (userId === guild.ownerId || cfg.whitelist.users.includes(userId)) return true;
  if (cfg.maxSecurity) return false;
  return !!member && (member.permissions.has(P.ManageGuild) || member.permissions.has(P.Administrator));
}
const lockedMsg = (locale) =>
  L(locale, '🔒 Maximum security is on: only the server owner or whitelisted users can change this.', '🔒 Máxima seguridad activa: solo el dueño del servidor o usuarios de la whitelist pueden cambiar esto.');

/* Enganche para las advertencias automáticas (lo registra guard.js). */
const hooks = { warn: null };
function warnHook(guild, userId, reason, channel) {
  try {
    if (hooks.warn) Promise.resolve(hooks.warn(guild, userId, reason, channel)).catch(logErr);
  } catch (e) {
    logErr(e);
  }
}

function isStaff(member) {
  return (
    member.permissions.has(P.Administrator) ||
    member.permissions.has(P.ManageMessages) ||
    member.permissions.has(P.ModerateMembers)
  );
}

function canAct(i, target) {
  if (!target) return false;
  if (i.guild.ownerId === i.user.id) return true;
  return i.member.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

const INVITE_PERMS = new PermissionsBitField([
  P.ViewChannel,
  P.SendMessages,
  P.EmbedLinks,
  P.ReadMessageHistory,
  P.AttachFiles,
  P.AddReactions,
  P.ManageMessages,
  P.ManageChannels,
  P.ManageGuild,
  P.ManageRoles,
  P.KickMembers,
  P.BanMembers,
  P.ModerateMembers,
  P.ViewAuditLog,
  P.ManageWebhooks,
  P.Connect,
  P.Speak,
]).bitfield.toString();

/* ============================ acciones base ============================ */
async function punishMember(guild, userId, action, reason, minutes = 60) {
  try {
    if (action === 'ban') {
      await guild.members.ban(userId, { reason });
      return 'ban';
    }
    const m = await guild.members.fetch(userId).catch(() => null);
    if (!m) return 'none';
    if (action === 'kick') {
      await m.kick(reason);
      return 'kick';
    }
    if (action === 'timeout') {
      await m.timeout(Math.min(minutes, 40320) * 60000, reason);
      return 'timeout';
    }
  } catch (e) {
    return 'failed: ' + e.message;
  }
  return 'none';
}

async function doPurge(channel, amount, userId) {
  const n = Math.max(1, Math.min(100, amount));
  let toDelete = n;
  if (userId) {
    const fetched = await channel.messages.fetch({ limit: 100 });
    toDelete = [...fetched.filter((m) => m.author.id === userId).values()].slice(0, n);
  }
  const deleted = await channel.bulkDelete(toDelete, true);
  return deleted.size;
}

async function doLock(channel, lock, reason) {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: lock ? false : null }, { reason });
}

async function doIsolate(member, minutes, reason) {
  if (minutes <= 0) return member.timeout(null, reason);
  return member.timeout(Math.min(minutes, 40320) * 60000, reason);
}

function modLog(guild, title, fields, color = COLOR.orange) {
  return sendLog(guild, 'mod', mkEmbed(guild, color, title, null, fields));
}

async function findAuditEntry(guild, type, targetId, maxAgeMs = 15000, tries = 4) {
  for (let n = 0; n < tries; n++) {
    try {
      const logs = await guild.fetchAuditLogs({ type, limit: 6 });
      const e = logs.entries.find((x) => (!targetId || x.targetId === targetId) && Date.now() - x.createdTimestamp < maxAgeMs);
      if (e) return e;
    } catch (_) {
      return null;
    }
    await sleep(700);
  }
  return null;
}

/* ============================ modo raid ============================ */
const raidTimers = new Map();
const raidBuf = new Map();

async function setInvites(guild, disabled) {
  try {
    if (typeof guild.disableInvites === 'function') await guild.disableInvites(disabled);
  } catch (_) {}
}

function scheduleRaidEnd(guild) {
  clearTimeout(raidTimers.get(guild.id));
  const left = getCfg(guild.id).raidUntil - Date.now();
  const t = setTimeout(() => endRaid(guild).catch(logErr), Math.max(1000, left));
  raidTimers.set(guild.id, t);
}

async function activateRaid(guild, reason, minutes) {
  const cfg = getCfg(guild.id);
  const was = cfg.raidUntil > Date.now();
  cfg.raidUntil = Date.now() + minutes * 60000;
  if (!was) cfg.invitesWereOff = guild.features.includes('INVITES_DISABLED');
  saveCfg();
  scheduleRaidEnd(guild);
  if (!was) {
    await setInvites(guild, true);
    sendLog(
      guild,
      'raid',
      mkEmbed(guild, COLOR.red, GL(guild, '🚨 RAID MODE ON', '🚨 MODO RAID ACTIVADO'), reason, [
        [GL(guild, 'Duration', 'Duración'), minutes + ' min'],
        [GL(guild, 'New members', 'Nuevos miembros'), cfg.joinFlood.action],
        [GL(guild, 'Invites', 'Invitaciones'), GL(guild, 'paused', 'pausadas')],
      ])
    );
  }
}

async function endRaid(guild) {
  const cfg = getCfg(guild.id);
  if (!cfg.raidUntil) return;
  cfg.raidUntil = 0;
  saveCfg();
  clearTimeout(raidTimers.get(guild.id));
  if (!cfg.invitesWereOff) await setInvites(guild, false);
  sendLog(guild, 'raid', mkEmbed(guild, COLOR.green, GL(guild, '✅ Raid mode OFF', '✅ Modo raid desactivado'), GL(guild, 'Normal operation restored.', 'Funcionamiento normal restablecido.')));
}

function restoreRaidTimers(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = guilds.data[guild.id];
    if (cfg && cfg.raidUntil) {
      if (cfg.raidUntil <= Date.now()) endRaid(guild).catch(logErr);
      else scheduleRaidEnd(guild);
    }
  }
}

function bufferRaidLog(guild, member, res) {
  let b = raidBuf.get(guild.id);
  if (!b) {
    b = { rows: [] };
    b.timer = setTimeout(() => {
      raidBuf.delete(guild.id);
      const lines = b.rows.slice(0, 20).map((r) => '• ' + r).join('\n');
      sendLog(
        guild,
        'raid',
        mkEmbed(guild, COLOR.red, GL(guild, 'Raid mode: joins blocked', 'Modo raid: ingresos bloqueados') + ' (' + b.rows.length + ')', lines)
      );
    }, 15000);
    raidBuf.set(guild.id, b);
  }
  b.rows.push(member.user.username + ' (' + member.id + ') → ' + res);
}

/* ============================ ingresos ============================ */
const recentJoins = new Map();

async function handleBotAdd(member) {
  const guild = member.guild;
  const cfg = getCfg(guild.id);
  if (!cfg.antiBotAdd.enabled) return;
  if (cfg.whitelist.bots.includes(member.id)) return;

  const entry = await findAuditEntry(guild, AuditLogEvent.BotAdd, member.id);
  const adder = entry && entry.executor;
  if (adder && isTrusted(guild, adder.id, cfg)) return;

  const botRes = await punishMember(guild, member.id, 'ban', 'Antiraid: unauthorized bot');
  let adderRes = GL(guild, 'unknown (needs View Audit Log permission)', 'desconocido (requiere permiso Ver registro de auditoría)');
  if (adder) {
    adderRes = cfg.antiBotAdd.punishAdder === 'none' ? 'none' : await punishMember(guild, adder.id, cfg.antiBotAdd.punishAdder, 'Antiraid: added an unauthorized bot');
  }
  sendLog(
    guild,
    'raid',
    mkEmbed(guild, COLOR.red, GL(guild, '🤖 Unauthorized bot blocked', '🤖 Bot no autorizado bloqueado'), null, [
      ['Bot', member.user.username + '\n`' + member.id + '`'],
      [GL(guild, 'Added by', 'Añadido por'), adder ? '<@' + adder.id + '>\n`' + adder.id + '`' : '—'],
      [GL(guild, 'Bot action', 'Acción al bot'), botRes],
      [GL(guild, 'Adder action', 'Acción al autor'), adderRes],
      [GL(guild, 'Adder account created', 'Cuenta del autor creada'), adder ? '<t:' + Math.floor(adder.createdTimestamp / 1000) + ':R>' : '—'],
    ])
  );
}

async function handleJoin(member) {
  const guild = member.guild;
  const cfg = getCfg(guild.id);
  if (member.user.bot) return handleBotAdd(member);
  const now = Date.now();

  // 1) Modo raid activo: todo nuevo miembro recibe la acción
  if (cfg.raidUntil > now) {
    const res = await punishMember(guild, member.id, cfg.joinFlood.action, 'Antiraid: raid mode active', 60);
    bufferRaidLog(guild, member, res);
    return;
  }

  // 2) Edad mínima de cuenta
  if (cfg.minAccountAgeDays > 0) {
    const ageDays = (now - member.user.createdTimestamp) / 86400000;
    if (ageDays < cfg.minAccountAgeDays) {
      await member
        .send(GL(guild, 'Your account is too new to join **' + guild.name + '**.', 'Tu cuenta es demasiado nueva para entrar a **' + guild.name + '**.'))
        .catch(() => {});
      const res = await punishMember(guild, member.id, 'kick', 'Antiraid: account too new');
      sendLog(
        guild,
        'raid',
        mkEmbed(guild, COLOR.orange, GL(guild, 'New account rejected', 'Cuenta nueva rechazada'), null, [
          [GL(guild, 'User', 'Usuario'), member.user.username + '\n`' + member.id + '`'],
          [GL(guild, 'Age', 'Edad'), ageDays.toFixed(1) + ' d'],
          [GL(guild, 'Action', 'Acción'), res],
        ])
      );
      return;
    }
  }

  // 3) Detección de oleada de ingresos
  if (cfg.joinFlood.enabled) {
    const list = (recentJoins.get(guild.id) || []).filter((j) => now - j.ts < cfg.joinFlood.windowSec * 1000);
    list.push({ id: member.id, name: member.user.username, ts: now });
    recentJoins.set(guild.id, list);
    if (list.length >= cfg.joinFlood.limit) {
      recentJoins.set(guild.id, []);
      await activateRaid(
        guild,
        GL(guild, list.length + ' joins in ' + cfg.joinFlood.windowSec + ' s', list.length + ' ingresos en ' + cfg.joinFlood.windowSec + ' s'),
        cfg.joinFlood.raidMinutes
      );
      const rows = [];
      for (const j of list) {
        const res = await punishMember(guild, j.id, cfg.joinFlood.action, 'Antiraid: join flood', 60);
        rows.push('• ' + j.name + ' (' + j.id + ') → ' + res);
      }
      sendLog(guild, 'raid', mkEmbed(guild, COLOR.red, GL(guild, 'Join flood: members removed', 'Oleada de ingresos: miembros sancionados'), rows.join('\n')));
      return;
    }
  }

  // 4) Ingreso normal
  sendLog(
    guild,
    'welcome',
    mkEmbed(guild, COLOR.green, GL(guild, 'Member joined', 'Miembro nuevo'), null, [
      [GL(guild, 'User', 'Usuario'), '<@' + member.id + '>\n`' + member.id + '`'],
      [GL(guild, 'Account created', 'Cuenta creada'), '<t:' + Math.floor(member.user.createdTimestamp / 1000) + ':R>'],
      [GL(guild, 'Members', 'Miembros'), guild.memberCount],
    ])
  );
  sendGreeting('welcome', member);
}

/* ============================ bienvenidas / despedidas ============================ */
async function sendGreeting(kind, member) {
  try {
    const guild = member.guild;
    const g = getCfg(guild.id)[kind];
    if (!g.enabled) return;
    const w = kind === 'welcome';
    const vars = { user: '<@' + member.id + '>', username: member.user.username, server: guild.name, count: guild.memberCount };
    const defMsg = w
      ? GL(guild, '👋 Welcome {user} to **{server}**! You are member #{count}.', '👋 ¡Bienvenido {user} a **{server}**! Eres el miembro #{count}.')
      : GL(guild, '😢 **{username}** left **{server}**.', '😢 **{username}** se fue de **{server}**.');
    const defDm = w
      ? GL(guild, 'Welcome to **{server}**!', '¡Bienvenido a **{server}**!')
      : GL(guild, 'Sorry to see you go from **{server}**.', 'Lamentamos que te vayas de **{server}**.');
    if (g.channel) {
      const ch = guild.channels.cache.get(g.channel) || (await guild.channels.fetch(g.channel).catch(() => null));
      if (ch && ch.isTextBased()) {
        const payload = { content: fmt(g.message || defMsg, vars), allowedMentions: { users: [member.id] } };
        if (g.image) {
          const png = await require('./card').make({ title: w ? GL(guild, 'Welcome!', '¡Bienvenido!') : GL(guild, 'Goodbye', 'Hasta luego'), name: member.user.username, sub: guild.name + ' · #' + guild.memberCount, avatar: member.user.displayAvatarURL({ extension: 'png', size: 256 }), color: getCfg(guild.id).ui.color });
          if (png) payload.files = [{ attachment: png, name: (w ? 'welcome' : 'goodbye') + '.png' }];
        }
        await ch.send(payload).catch(() => {});
      }
    }
    if (g.dm) await member.send(fmt(g.dmMessage || defDm, vars)).catch(() => {});
  } catch (e) {
    logErr(e);
  }
}

/* ============================ anti-nuke ============================ */
const nukeHist = new Map();
const seenEntries = new Set();
const kickLookups = new Map();
const DANGEROUS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks, P.MentionEveryone];

/* Deshace lo que destruyó el atacante: roles y canales borrados y baneos. */
async function rollback(guild, list) {
  const res = { roles: 0, channels: 0, unbans: 0 };
  try {
    const roleMap = new Map();
    const roles = list.filter((x) => x.snap && x.snap.kind === 'role').map((x) => x.snap.data).sort((x, y) => y.position - x.position);
    for (const s of roles) {
      try {
        const nr = await snap.createRoleFrom(guild, s, 'Antiraid: rollback');
        roleMap.set(s.id, nr.id);
        res.roles++;
      } catch (e) {
        logErr(e);
      }
    }
    const chans = list.filter((x) => x.snap && x.snap.kind === 'channel').map((x) => x.snap.data);
    const parentMap = new Map();
    for (const s of chans.filter((c) => c.type === ChannelType.GuildCategory)) {
      try {
        const nc = await snap.createChannelFrom(guild, s, { roleMap, parentMap, reason: 'Antiraid: rollback' });
        parentMap.set(s.id, nc.id);
        res.channels++;
      } catch (e) {
        logErr(e);
      }
    }
    for (const s of chans.filter((c) => c.type !== ChannelType.GuildCategory)) {
      try {
        await snap.createChannelFrom(guild, s, { roleMap, parentMap, reason: 'Antiraid: rollback' });
        res.channels++;
      } catch (e) {
        logErr(e);
      }
    }
    for (const x of list) {
      if (x.label === 'ban' && x.targetId) {
        try {
          await guild.members.unban(x.targetId, 'Antiraid: rollback');
          res.unbans++;
        } catch (_) {}
      }
    }
  } catch (e) {
    logErr(e);
  }
  return res;
}

/*
 * Registra una acción destructiva (borrar/crear canales o roles, banear, expulsar, webhooks).
 * Devuelve { entry, exec, trusted, triggered } o null si no se pudo saber quién fue.
 */
async function nukeCheck(guild, auditType, targetId, label, snapshot, desc) {
  try {
    const cfg = getCfg(guild.id);
    if (label === 'kick') {
      // Evita saturar la API en servidores grandes donde salen muchos miembros a la vez
      const t = kickLookups.get(guild.id) || { n: 0, ts: Date.now() };
      if (Date.now() - t.ts > 10000) {
        t.n = 0;
        t.ts = Date.now();
      }
      t.n++;
      kickLookups.set(guild.id, t);
      if (t.n > 12) return null;
    }
    const entry = await findAuditEntry(guild, auditType, targetId, 10000, 2);
    if (!entry || !entry.executor) return null;
    const exec = entry.executor;
    const trusted = isTrusted(guild, exec.id, cfg);
    const info = { entry, exec, trusted, triggered: false };
    if (seenEntries.has(entry.id)) return info;
    seenEntries.add(entry.id);
    setTimeout(() => seenEntries.delete(entry.id), 60000).unref();

    if (cfg.logs.server.length) {
      sendLog(
        guild,
        'server',
        mkEmbed(guild, COLOR.blue, GL(guild, 'Server change: ', 'Cambio en el servidor: ') + label, null, [
          [GL(guild, 'By', 'Por'), '<@' + exec.id + '>' + (exec.bot ? ' 🤖' : '')],
          [GL(guild, 'Target', 'Objetivo'), desc || (targetId ? '`' + targetId + '`' : '—')],
        ])
      );
    }
    if (!cfg.antiNuke.enabled || trusted) return info;

    const an = cfg.antiNuke;
    const key = guild.id + ':' + exec.id;
    const now = Date.now();
    const maxWin = Math.max(an.windowSec, an.perTypeWindowSec) * 1000;
    const list = (nukeHist.get(key) || []).filter((x) => now - x.ts < maxWin);
    list.push({ ts: now, label, targetId, snap: snapshot || null });
    nukeHist.set(key, list);

    const burst = list.filter((x) => now - x.ts < an.windowSec * 1000).length;
    const typeLimit = /create/.test(label) ? an.perTypeLimit * 2 : an.perTypeLimit;
    const perType = list.filter((x) => x.label === label && now - x.ts < an.perTypeWindowSec * 1000).length;
    if (burst < an.limit && perType < typeLimit) return info;

    nukeHist.delete(key);
    info.triggered = true;

    let res = await punishMember(guild, exec.id, 'ban', 'Antiraid: mass destructive actions');
    if (res.startsWith('failed') || res === 'none') {
      const m = await guild.members.fetch(exec.id).catch(() => null);
      if (m) {
        const bad = m.roles.cache.filter((r) => !r.managed && r.id !== guild.id && r.permissions.any(DANGEROUS));
        try {
          await m.roles.remove(bad, 'Antiraid: mass destructive actions');
          res = GL(guild, 'dangerous roles removed (' + bad.size + ')', 'roles peligrosos quitados (' + bad.size + ')');
        } catch (e) {
          res = 'failed: ' + e.message;
        }
      }
    }
    if (an.panic) await activateRaid(guild, GL(guild, 'Anti-nuke triggered by ' + exec.username, 'Anti-nuke activado por ' + exec.username), cfg.joinFlood.raidMinutes).catch(logErr);
    const rb = an.restore ? await rollback(guild, list) : { roles: 0, channels: 0, unbans: 0 };

    sendLog(
      guild,
      'raid',
      mkEmbed(guild, COLOR.red, GL(guild, '💥 Anti-nuke triggered', '💥 Anti-nuke activado'), null, [
        [GL(guild, 'Executor', 'Autor'), '<@' + exec.id + '>\n`' + exec.id + '`' + (exec.bot ? ' (bot)' : '')],
        [GL(guild, 'Actions', 'Acciones'), list.length + ' (' + [...new Set(list.map((x) => x.label))].join(', ') + ')'],
        [GL(guild, 'Result', 'Resultado'), res],
        [GL(guild, 'Rollback', 'Recuperación'), GL(guild, rb.channels + ' channels, ' + rb.roles + ' roles, ' + rb.unbans + ' unbans', rb.channels + ' canales, ' + rb.roles + ' roles, ' + rb.unbans + ' desbaneos')],
        [GL(guild, 'Account created', 'Cuenta creada'), '<t:' + Math.floor(exec.createdTimestamp / 1000) + ':R>'],
      ])
    );
    return info;
  } catch (e) {
    logErr(e);
    return null;
  }
}

/* ============================ mensajes (spam / menciones / invitaciones) ============================ */
const msgHist = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of msgHist) if (!v.length || now - v[v.length - 1].ts > 60000) msgHist.delete(k);
}, 60000).unref();

async function handleMessage(msg) {
  if (!msg.guild || msg.author.bot || !msg.member) return;
  const guild = msg.guild;
  const cfg = getCfg(guild.id);

  // Los comandos antiguos con "!" siguen funcionando mientras el prefijo del servidor no sea "!"
  // (si lo es, los atiende guard.js y así no se ejecutan dos veces).
  if (msg.content && msg.content.startsWith('!') && (cfg.prefix || '$') !== '!') {
    if (await prefixCommand(msg)) return;
  }
  if (isTrusted(guild, msg.author.id, cfg) || isStaff(msg.member)) return;
  if (cfg.exemptChannels.includes(msg.channelId)) return;

  const now = Date.now();

  // Invitaciones
  if (cfg.antiInvite.enabled && msg.content && /(discord\.gg|discord(app)?\.com\/invite)\/[\w-]+/i.test(msg.content)) {
    await msg.delete().catch(() => {});
    modLog(guild, GL(guild, 'Invite link deleted', 'Invitación eliminada'), [[GL(guild, 'User', 'Usuario'), '<@' + msg.author.id + '>'], [GL(guild, 'Channel', 'Canal'), '<#' + msg.channelId + '>']]);
    warnHook(guild, msg.author.id, 'invite link', msg.channel);
    return;
  }

  // Menciones masivas
  if (cfg.antiMassMention.enabled) {
    const count = msg.mentions.users.size + msg.mentions.roles.size;
    if (count >= cfg.antiMassMention.limit) {
      await msg.delete().catch(() => {});
      const res = await punishMember(guild, msg.author.id, 'timeout', 'Antiraid: mass mention', cfg.antiSpam.timeoutMin);
      modLog(guild, GL(guild, 'Mass mention', 'Menciones masivas'), [[GL(guild, 'User', 'Usuario'), '<@' + msg.author.id + '>'], ['Mentions', count], [GL(guild, 'Action', 'Acción'), res]], COLOR.red);
      warnHook(guild, msg.author.id, 'mass mention', msg.channel);
      return;
    }
  }

  // Spam
  if (cfg.antiSpam.enabled) {
    const key = guild.id + ':' + msg.author.id;
    const h = (msgHist.get(key) || []).filter((x) => now - x.ts < cfg.antiSpam.windowSec * 1000);
    h.push({ ts: now, id: msg.id, ch: msg.channelId });
    msgHist.set(key, h);
    if (h.length >= cfg.antiSpam.limit) {
      msgHist.delete(key);
      const res = await punishMember(guild, msg.author.id, 'timeout', 'Antiraid: spam', cfg.antiSpam.timeoutMin);
      const ids = h.filter((x) => x.ch === msg.channelId).map((x) => x.id);
      await msg.channel.bulkDelete(ids, true).catch(() => {});
      modLog(guild, GL(guild, 'Spam stopped', 'Spam detenido'), [[GL(guild, 'User', 'Usuario'), '<@' + msg.author.id + '>'], [GL(guild, 'Messages', 'Mensajes'), h.length], [GL(guild, 'Action', 'Acción'), res]], COLOR.red);
      warnHook(guild, msg.author.id, 'spam', msg.channel);
    }
  }
}

/* ============================ comandos con prefijo (!) ============================ */
async function prefixCommand(msg) {
  const [cmd, ...args] = msg.content.slice(1).trim().split(/\s+/);
  const name = (cmd || '').toLowerCase();
  const guild = msg.guild;
  const lc = guild.preferredLocale;
  const need = { purge: P.ManageMessages, lock: P.ManageChannels, unlock: P.ManageChannels, aislamiento: P.ModerateMembers };
  if (!need[name]) return false;
  if (!msg.member.permissions.has(need[name])) {
    msg.reply(L(lc, 'You do not have permission.', 'No tienes permiso.')).catch(() => {});
    return true;
  }
  try {
    if (name === 'purge') {
      const n = parseInt(args[0], 10);
      if (!n || n < 1) return !!msg.reply('Uso: `!purge <1-100>`');
      await msg.delete().catch(() => {});
      const done = await doPurge(msg.channel, n);
      const note = await msg.channel.send(L(lc, '🧹 Deleted ' + done + ' messages.', '🧹 Se borraron ' + done + ' mensajes.'));
      setTimeout(() => note.delete().catch(() => {}), 4000);
      modLog(guild, 'Purge', [[GL(guild, 'By', 'Por'), '<@' + msg.author.id + '>'], [GL(guild, 'Channel', 'Canal'), '<#' + msg.channelId + '>'], [GL(guild, 'Messages', 'Mensajes'), done]]);
    } else if (name === 'lock' || name === 'unlock') {
      await doLock(msg.channel, name === 'lock', 'By ' + msg.author.username);
      await msg.reply(name === 'lock' ? L(lc, '🔒 Channel locked.', '🔒 Canal bloqueado.') : L(lc, '🔓 Channel unlocked.', '🔓 Canal desbloqueado.'));
      modLog(guild, name === 'lock' ? 'Lock' : 'Unlock', [[GL(guild, 'By', 'Por'), '<@' + msg.author.id + '>'], [GL(guild, 'Channel', 'Canal'), '<#' + msg.channelId + '>']]);
    } else if (name === 'aislamiento') {
      const target = msg.mentions.members.first();
      const minutes = args.find((a) => /^\d+$/.test(a));
      if (!target) return !!msg.reply('Uso: `!aislamiento @usuario [minutos]`');
      const mins = minutes ? parseInt(minutes, 10) : 10;
      if (!target.moderatable || msg.member.roles.highest.comparePositionTo(target.roles.highest) <= 0) return !!msg.reply(L(lc, 'I cannot isolate that member.', 'No puedo aislar a ese miembro.'));
      await doIsolate(target, mins, 'By ' + msg.author.username);
      await msg.reply(L(lc, '⏳ ' + target.user.username + ' isolated for ' + mins + ' min.', '⏳ ' + target.user.username + ' aislado por ' + mins + ' min.'));
      modLog(guild, GL(guild, 'Isolation', 'Aislamiento'), [[GL(guild, 'User', 'Usuario'), '<@' + target.id + '>'], [GL(guild, 'By', 'Por'), '<@' + msg.author.id + '>'], ['min', mins]]);
    }
  } catch (e) {
    msg.reply('⚠️ ' + e.message).catch(() => {});
  }
  return true;
}

/* ============================ definición de comandos slash ============================ */
function loc(builder, esName, esDesc) {
  if (esName) builder.setNameLocalizations({ 'es-ES': esName, 'es-419': esName });
  if (esDesc) builder.setDescriptionLocalizations({ 'es-ES': esDesc, 'es-419': esDesc });
  return builder;
}

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const commands = [];

/* ---------- /antiraid ---------- */
commands.push({
  data: loc(
    new SlashCommandBuilder()
      .setName('antiraid')
      .setDescription('Configure the anti-raid protection')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) => s.setName('status').setDescription('Show the protection status'))
      .addSubcommand((s) =>
        s
          .setName('toggle')
          .setDescription('Turn a protection module on or off')
          .addStringOption((o) =>
            o
              .setName('module')
              .setDescription('Module')
              .setRequired(true)
              .addChoices(
                { name: 'Anti bot-add', value: 'antiBotAdd' },
                { name: 'Anti-nuke', value: 'antiNuke' },
                { name: 'Join flood', value: 'joinFlood' },
                { name: 'Anti spam', value: 'antiSpam' },
                { name: 'Anti mass mention', value: 'antiMassMention' },
                { name: 'Anti invite links', value: 'antiInvite' }
              )
          )
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName('tune')
          .setDescription('Adjust thresholds')
          .addIntegerOption((o) => o.setName('join_limit').setDescription('Joins that trigger raid mode').setMinValue(2).setMaxValue(50))
          .addIntegerOption((o) => o.setName('join_window').setDescription('Join window in seconds').setMinValue(2).setMaxValue(120))
          .addStringOption((o) =>
            o.setName('join_action').setDescription('What to do with new members in a raid').addChoices({ name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }, { name: 'timeout', value: 'timeout' })
          )
          .addIntegerOption((o) => o.setName('raid_minutes').setDescription('Raid mode duration (minutes)').setMinValue(1).setMaxValue(1440))
          .addIntegerOption((o) => o.setName('min_account_age').setDescription('Minimum account age in days (0 = off)').setMinValue(0).setMaxValue(365))
          .addIntegerOption((o) => o.setName('spam_limit').setDescription('Messages that count as spam').setMinValue(3).setMaxValue(30))
          .addIntegerOption((o) => o.setName('nuke_limit').setDescription('Destructive actions that trigger anti-nuke').setMinValue(2).setMaxValue(20))
          .addStringOption((o) =>
            o.setName('bot_adder_action').setDescription('Punishment for who adds an unauthorized bot').addChoices({ name: 'ban', value: 'ban' }, { name: 'kick', value: 'kick' }, { name: 'none', value: 'none' })
          )
      )
      .addSubcommandGroup((g) =>
        g
          .setName('whitelist')
          .setDescription('Trusted users and allowed bots')
          .addSubcommand((s) => s.setName('add').setDescription('Trust a user or allow a bot').addUserOption((o) => o.setName('user').setDescription('User or bot').setRequired(true)))
          .addSubcommand((s) => s.setName('remove').setDescription('Remove from the list').addUserOption((o) => o.setName('user').setDescription('User or bot').setRequired(true)))
          .addSubcommand((s) => s.setName('list').setDescription('Show the list'))
      ),
    'antiraid',
    'Configura la protección antiraid'
  ),
  async execute(i) {
    const guild = i.guild;
    const cfg = getCfg(guild.id);
    const lc = i.locale;
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand();
    const readOnly = sub === 'status' || (group === 'whitelist' && sub === 'list');
    if (!readOnly && !canConfigure(guild, i.user.id, i.member)) return say(i, lockedMsg(lc));

    if (group === 'whitelist') {
      if (sub === 'list') {
        const u = cfg.whitelist.users.map((id) => '<@' + id + '>').join(', ') || '—';
        const b = cfg.whitelist.bots.map((id) => '<@' + id + '>').join(', ') || '—';
        return say(i, L(lc, '**Trusted users:** ', '**Usuarios de confianza:** ') + u + '\n' + L(lc, '**Allowed bots:** ', '**Bots permitidos:** ') + b);
      }
      const user = i.options.getUser('user', true);
      const listName = user.bot ? 'bots' : 'users';
      const arr = cfg.whitelist[listName];
      if (sub === 'add' && !arr.includes(user.id)) arr.push(user.id);
      if (sub === 'remove') cfg.whitelist[listName] = arr.filter((x) => x !== user.id);
      saveCfg();
      return say(i, sub === 'add' ? L(lc, '✅ Added <@' + user.id + '>.', '✅ Añadido <@' + user.id + '>.') : L(lc, '✅ Removed <@' + user.id + '>.', '✅ Quitado <@' + user.id + '>.'));
    }

    if (sub === 'toggle') {
      const mod = i.options.getString('module', true);
      const on = i.options.getBoolean('enabled', true);
      cfg[mod].enabled = on;
      saveCfg();
      return say(i, (on ? '🟢 ' : '🔴 ') + mod + ': ' + (on ? 'ON' : 'OFF'));
    }

    if (sub === 'tune') {
      const g = (n) => i.options.getInteger(n);
      const s = (n) => i.options.getString(n);
      if (g('join_limit') !== null) cfg.joinFlood.limit = g('join_limit');
      if (g('join_window') !== null) cfg.joinFlood.windowSec = g('join_window');
      if (s('join_action')) cfg.joinFlood.action = s('join_action');
      if (g('raid_minutes') !== null) cfg.joinFlood.raidMinutes = g('raid_minutes');
      if (g('min_account_age') !== null) cfg.minAccountAgeDays = g('min_account_age');
      if (g('spam_limit') !== null) cfg.antiSpam.limit = g('spam_limit');
      if (g('nuke_limit') !== null) cfg.antiNuke.limit = g('nuke_limit');
      if (s('bot_adder_action')) cfg.antiBotAdd.punishAdder = s('bot_adder_action');
      saveCfg();
      return say(i, L(lc, '✅ Settings updated. Use `/antiraid status` to review them.', '✅ Ajustes actualizados. Usa `/antiraid status` para revisarlos.'));
    }

    // status
    const raidOn = cfg.raidUntil > Date.now();
    const e = new EmbedBuilder()
      .setColor(raidOn ? COLOR.red : COLOR.blue)
      .setTitle('🛡️ Antiraid — ' + guild.name)
      .setDescription(raidOn ? L(lc, '🚨 **RAID MODE ON** until <t:' + Math.floor(cfg.raidUntil / 1000) + ':R>', '🚨 **MODO RAID ACTIVO** hasta <t:' + Math.floor(cfg.raidUntil / 1000) + ':R>') : L(lc, '✅ No active raid.', '✅ Sin raid activo.'))
      .addFields(
        { name: onOff(cfg.antiBotAdd.enabled) + ' Anti bot-add', value: L(lc, 'Adder: ', 'Autor: ') + cfg.antiBotAdd.punishAdder, inline: true },
        { name: onOff(cfg.antiNuke.enabled) + ' Anti-nuke', value: cfg.antiNuke.limit + ' / ' + cfg.antiNuke.windowSec + ' s', inline: true },
        { name: onOff(cfg.joinFlood.enabled) + ' Join flood', value: cfg.joinFlood.limit + ' / ' + cfg.joinFlood.windowSec + ' s → ' + cfg.joinFlood.action + ' (' + cfg.joinFlood.raidMinutes + ' min)', inline: true },
        { name: onOff(cfg.antiSpam.enabled) + ' Anti spam', value: cfg.antiSpam.limit + ' / ' + cfg.antiSpam.windowSec + ' s → timeout ' + cfg.antiSpam.timeoutMin + ' min', inline: true },
        { name: onOff(cfg.antiMassMention.enabled) + ' Anti mass mention', value: '≥ ' + cfg.antiMassMention.limit, inline: true },
        { name: onOff(cfg.antiInvite.enabled) + ' Anti invites', value: '​', inline: true },
        { name: L(lc, 'Min. account age', 'Edad mín. de cuenta'), value: cfg.minAccountAgeDays ? cfg.minAccountAgeDays + ' d' : L(lc, 'off', 'desactivado'), inline: true },
        { name: 'Whitelist', value: cfg.whitelist.users.length + ' users · ' + cfg.whitelist.bots.length + ' bots', inline: true },
        { name: 'Logs', value: Object.entries(cfg.logs).map(([k, v]) => k + ': ' + v.length).join(' · '), inline: false }
      );
    const missing = [];
    const me = guild.members.me;
    if (me) {
      if (!me.permissions.has(P.ViewAuditLog)) missing.push('View Audit Log');
      if (!me.permissions.has(P.BanMembers)) missing.push('Ban Members');
      if (!me.permissions.has(P.ManageGuild)) missing.push('Manage Server');
      if (!me.permissions.has(P.ManageRoles)) missing.push('Manage Roles');
    }
    if (missing.length) e.addFields({ name: '⚠️ ' + L(lc, 'Missing permissions', 'Permisos faltantes'), value: missing.join(', ') });
    return i.reply({ embeds: [e], flags: EPHEMERAL });
  },
});

/* ---------- /panic ---------- */
commands.push({
  data: loc(
    new SlashCommandBuilder()
      .setName('panic')
      .setDescription('Manually turn raid mode on or off')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addStringOption((o) => o.setName('mode').setDescription('On or off').setRequired(true).addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }))
      .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes (default 30)').setMinValue(1).setMaxValue(1440)),
    'panico',
    'Activa o desactiva el modo raid manualmente'
  ),
  async execute(i) {
    await i.deferReply({ flags: EPHEMERAL });
    const lc = i.locale;
    if (i.options.getString('mode', true) === 'on') {
      const mins = i.options.getInteger('minutes') || 30;
      await activateRaid(i.guild, L(lc, 'Manual panic by ' + i.user.username, 'Pánico manual por ' + i.user.username), mins);
      return i.editReply(L(lc, '🚨 Raid mode ON for ' + mins + ' min. New members will be removed and invites paused.', '🚨 Modo raid ACTIVO por ' + mins + ' min. Los nuevos miembros serán sancionados y las invitaciones pausadas.'));
    }
    await endRaid(i.guild);
    return i.editReply(L(lc, '✅ Raid mode OFF.', '✅ Modo raid desactivado.'));
  },
});

/* ---------- /logs ---------- */
const LOG_TYPES = [
  { name: 'raid', value: 'raid' },
  { name: 'moderation', value: 'mod' },
  { name: 'welcome', value: 'welcome' },
  { name: 'goodbye', value: 'goodbye' },
  { name: 'messages', value: 'messages' },
  { name: 'server', value: 'server' },
];
commands.push({
  data: loc(
    new SlashCommandBuilder()
      .setName('logs')
      .setDescription('Choose the log channels per type')
      .setDefaultMemberPermissions(P.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a channel to a log type')
          .addStringOption((o) => o.setName('type').setDescription('Log type').setRequired(true).addChoices(...LOG_TYPES))
          .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS))
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a channel from a log type')
          .addStringOption((o) => o.setName('type').setDescription('Log type').setRequired(true).addChoices(...LOG_TYPES))
          .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS))
      )
      .addSubcommand((s) => s.setName('list').setDescription('Show configured logs')),
    'registros',
    'Elige los canales de registro por tipo'
  ),
  async execute(i) {
    const cfg = getCfg(i.guild.id);
    const lc = i.locale;
    const sub = i.options.getSubcommand();
    if (sub !== 'list' && !canConfigure(i.guild, i.user.id, i.member)) return say(i, lockedMsg(lc));
    if (sub === 'list') {
      const lines = Object.entries(cfg.logs).map(([k, v]) => '**' + k + ':** ' + (v.map((id) => '<#' + id + '>').join(' ') || '—'));
      return say(i, lines.join('\n'));
    }
    const type = i.options.getString('type', true);
    const ch = i.options.getChannel('channel', true);
    const arr = cfg.logs[type];
    if (sub === 'add') {
      if (!arr.includes(ch.id)) arr.push(ch.id);
    } else {
      cfg.logs[type] = arr.filter((x) => x !== ch.id);
    }
    saveCfg();
    return say(i, (sub === 'add' ? '✅ ' : '🗑️ ') + type + ' → <#' + ch.id + '>');
  },
});

/* ---------- /welcome y /goodbye ---------- */
function greetCommand(kind) {
  const w = kind === 'welcome';
  return {
    data: loc(
      new SlashCommandBuilder()
        .setName(kind)
        .setDescription(w ? 'Configure the welcome message' : 'Configure the goodbye message')
        .setDefaultMemberPermissions(P.ManageGuild)
        .setDMPermission(false)
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn on or off'))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel for the message').addChannelTypes(...TEXT_CHANNELS))
        .addStringOption((o) => o.setName('message').setDescription('Text. Variables: {user} {username} {server} {count}').setMaxLength(1500))
        .addBooleanOption((o) => o.setName('dm').setDescription('Also send it by DM'))
        .addStringOption((o) => o.setName('dm_message').setDescription('DM text (same variables)').setMaxLength(1500)),
      w ? 'bienvenida' : 'despedida',
      w ? 'Configura el mensaje de bienvenida' : 'Configura el mensaje de despedida'
    ),
    async execute(i) {
      const cfg = getCfg(i.guild.id);
      const g = cfg[kind];
      const en = i.options.getBoolean('enabled');
      const ch = i.options.getChannel('channel');
      const msg = i.options.getString('message');
      const dm = i.options.getBoolean('dm');
      const dmMsg = i.options.getString('dm_message');
      if (en !== null) g.enabled = en;
      if (ch) g.channel = ch.id;
      if (msg) g.message = msg;
      if (dm !== null) g.dm = dm;
      if (dmMsg) g.dmMessage = dmMsg;
      saveCfg();
      const lc = i.locale;
      return say(
        i,
        L(lc, '✅ Saved.\n', '✅ Guardado.\n') +
          onOff(g.enabled) + ' · ' + (g.channel ? '<#' + g.channel + '>' : L(lc, 'no channel', 'sin canal')) + ' · DM: ' + (g.dm ? 'on' : 'off')
      );
    },
  };
}
commands.push(greetCommand('welcome'), greetCommand('goodbye'));

/* ---------- moderación ---------- */
commands.push({
  data: loc(
    new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Delete recent messages')
      .setDefaultMemberPermissions(P.ManageMessages)
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('amount').setDescription('How many (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('user').setDescription('Only this user')),
    'limpiar',
    'Borra mensajes recientes'
  ),
  async execute(i) {
    await i.deferReply({ flags: EPHEMERAL });
    const lc = i.locale;
    try {
      const user = i.options.getUser('user');
      const done = await doPurge(i.channel, i.options.getInteger('amount', true), user && user.id);
      modLog(i.guild, 'Purge', [[GL(i.guild, 'By', 'Por'), '<@' + i.user.id + '>'], [GL(i.guild, 'Channel', 'Canal'), '<#' + i.channelId + '>'], [GL(i.guild, 'Messages', 'Mensajes'), done]]);
      return i.editReply(L(lc, '🧹 Deleted ' + done + ' messages (messages older than 14 days cannot be bulk deleted).', '🧹 Se borraron ' + done + ' mensajes (los de más de 14 días no se pueden borrar en masa).'));
    } catch (e) {
      return i.editReply('⚠️ ' + e.message);
    }
  },
});

function lockCommand(lock) {
  return {
    data: loc(
      new SlashCommandBuilder()
        .setName(lock ? 'lock' : 'unlock')
        .setDescription(lock ? 'Lock a channel (nobody can write)' : 'Unlock a channel')
        .setDefaultMemberPermissions(P.ManageChannels)
        .setDMPermission(false)
        .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').addChannelTypes(...TEXT_CHANNELS)),
      lock ? 'bloquear' : 'desbloquear',
      lock ? 'Bloquea un canal (nadie puede escribir)' : 'Desbloquea un canal'
    ),
    async execute(i) {
      await i.deferReply({ flags: EPHEMERAL });
      const lc = i.locale;
      try {
        const ch = i.options.getChannel('channel') || i.channel;
        await doLock(ch, lock, 'By ' + i.user.username);
        modLog(i.guild, lock ? 'Lock' : 'Unlock', [[GL(i.guild, 'By', 'Por'), '<@' + i.user.id + '>'], [GL(i.guild, 'Channel', 'Canal'), '<#' + ch.id + '>']]);
        return i.editReply(lock ? L(lc, '🔒 Locked <#' + ch.id + '>.', '🔒 Bloqueado <#' + ch.id + '>.') : L(lc, '🔓 Unlocked <#' + ch.id + '>.', '🔓 Desbloqueado <#' + ch.id + '>.'));
      } catch (e) {
        return i.editReply('⚠️ ' + e.message);
      }
    },
  };
}
commands.push(lockCommand(true), lockCommand(false));

commands.push({
  data: loc(
    new SlashCommandBuilder()
      .setName('isolate')
      .setDescription('Isolate (timeout) a member')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('minutes').setDescription('Minutes (0 = remove isolation)').setRequired(true).setMinValue(0).setMaxValue(40320))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
    'aislamiento',
    'Aísla (silencia) a un miembro por un tiempo'
  ),
  async execute(i) {
    await i.deferReply({ flags: EPHEMERAL });
    const lc = i.locale;
    const target = await i.guild.members.fetch(i.options.getUser('user', true).id).catch(() => null);
    if (!target || !target.moderatable || !canAct(i, target)) return i.editReply(L(lc, '❌ I cannot isolate that member (hierarchy or permissions).', '❌ No puedo aislar a ese miembro (jerarquía o permisos).'));
    const mins = i.options.getInteger('minutes', true);
    const reason = i.options.getString('reason') || 'By ' + i.user.username;
    try {
      await doIsolate(target, mins, reason);
      modLog(i.guild, GL(i.guild, 'Isolation', 'Aislamiento'), [[GL(i.guild, 'User', 'Usuario'), '<@' + target.id + '>'], [GL(i.guild, 'By', 'Por'), '<@' + i.user.id + '>'], ['min', mins], [GL(i.guild, 'Reason', 'Motivo'), reason]]);
      return i.editReply(mins ? L(lc, '⏳ Isolated for ' + mins + ' min.', '⏳ Aislado por ' + mins + ' min.') : L(lc, '✅ Isolation removed.', '✅ Aislamiento quitado.'));
    } catch (e) {
      return i.editReply('⚠️ ' + e.message);
    }
  },
});

function banKick(kind) {
  const ban = kind === 'ban';
  return {
    data: loc(
      new SlashCommandBuilder()
        .setName(kind)
        .setDescription(ban ? 'Ban a member' : 'Kick a member')
        .setDefaultMemberPermissions(ban ? P.BanMembers : P.KickMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
      ban ? 'banear' : 'expulsar',
      ban ? 'Banea a un miembro' : 'Expulsa a un miembro'
    ),
    async execute(i) {
      await i.deferReply({ flags: EPHEMERAL });
      const lc = i.locale;
      const user = i.options.getUser('user', true);
      const reason = i.options.getString('reason') || 'By ' + i.user.username;
      const target = await i.guild.members.fetch(user.id).catch(() => null);
      if (target && (!(ban ? target.bannable : target.kickable) || !canAct(i, target))) return i.editReply(L(lc, '❌ I cannot do that (hierarchy or permissions).', '❌ No puedo hacerlo (jerarquía o permisos).'));
      if (!target && !ban) return i.editReply(L(lc, '❌ Member not found.', '❌ Miembro no encontrado.'));
      try {
        if (ban) await i.guild.members.ban(user.id, { reason });
        else await target.kick(reason);
        modLog(i.guild, ban ? 'Ban' : 'Kick', [[GL(i.guild, 'User', 'Usuario'), user.username + '\n`' + user.id + '`'], [GL(i.guild, 'By', 'Por'), '<@' + i.user.id + '>'], [GL(i.guild, 'Reason', 'Motivo'), reason]], COLOR.red);
        return i.editReply(ban ? L(lc, '🔨 Banned.', '🔨 Baneado.') : L(lc, '👢 Kicked.', '👢 Expulsado.'));
      } catch (e) {
        return i.editReply('⚠️ ' + e.message);
      }
    },
  };
}
commands.push(banKick('ban'), banKick('kick'));

/* ---------- utilidades ---------- */
commands.push({
  data: loc(new SlashCommandBuilder().setName('ping').setDescription('Bot latency'), 'ping', 'Latencia del bot'),
  async execute(i) {
    return say(i, '🏓 ' + i.client.ws.ping + ' ms');
  },
});

commands.push({
  data: loc(new SlashCommandBuilder().setName('serverinfo').setDescription('Server information').setDMPermission(false), 'infoservidor', 'Información del servidor'),
  async execute(i) {
    const g = i.guild;
    const lc = i.locale;
    const cfg = getCfg(g.id);
    const e = new EmbedBuilder()
      .setColor(COLOR.blue)
      .setTitle(g.name)
      .addFields(
        { name: L(lc, 'Members', 'Miembros'), value: String(g.memberCount), inline: true },
        { name: L(lc, 'Channels', 'Canales'), value: String(g.channels.cache.size), inline: true },
        { name: L(lc, 'Roles', 'Roles'), value: String(g.roles.cache.size), inline: true },
        { name: L(lc, 'Created', 'Creado'), value: '<t:' + Math.floor(g.createdTimestamp / 1000) + ':D>', inline: true },
        { name: L(lc, 'Boosts', 'Boosts'), value: String(g.premiumSubscriptionCount || 0), inline: true },
        { name: 'Raid', value: cfg.raidUntil > Date.now() ? '🚨 ON' : '✅ OFF', inline: true }
      );
    if (g.iconURL()) e.setThumbnail(g.iconURL());
    return i.reply({ embeds: [e] });
  },
});

commands.push({
  data: loc(
    new SlashCommandBuilder().setName('userinfo').setDescription('User information').setDMPermission(false).addUserOption((o) => o.setName('user').setDescription('User (default: you)')),
    'infousuario',
    'Información de un usuario'
  ),
  async execute(i) {
    const lc = i.locale;
    const user = i.options.getUser('user') || i.user;
    const m = await i.guild.members.fetch(user.id).catch(() => null);
    const e = new EmbedBuilder()
      .setColor(COLOR.blue)
      .setTitle(user.username)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: L(lc, 'Account created', 'Cuenta creada'), value: '<t:' + Math.floor(user.createdTimestamp / 1000) + ':R>', inline: true },
        { name: L(lc, 'Joined', 'Se unió'), value: m && m.joinedTimestamp ? '<t:' + Math.floor(m.joinedTimestamp / 1000) + ':R>' : '—', inline: true },
        { name: L(lc, 'Bot', 'Bot'), value: user.bot ? '🤖' : '👤', inline: true }
      );
    return i.reply({ embeds: [e] });
  },
});

commands.push({
  data: loc(new SlashCommandBuilder().setName('help').setDescription('Show what this bot can do'), 'ayuda', 'Muestra lo que puede hacer este bot'),
  async execute(i) {
    const lc = i.locale;
    const e = new EmbedBuilder()
      .setColor(COLOR.blue)
      .setTitle('🛡️ ' + L(lc, 'Help', 'Ayuda'))
      .addFields(
        {
          name: L(lc, '🛡️ Protection', '🛡️ Protección'),
          value: '`/antiraid` `/panic` `/logs` `/welcome` `/goodbye`\n' + L(lc, 'Automatic: unauthorized bots, join floods, nukes, spam, mass mentions.', 'Automático: bots no autorizados, oleadas de ingresos, nukes, spam, menciones masivas.'),
        },
        { name: L(lc, '🔨 Moderation', '🔨 Moderación'), value: '`/purge` `/lock` `/unlock` `/isolate` `/ban` `/kick`\n' + L(lc, 'Prefix: ', 'Prefijo: ') + '`!purge` `!lock` `!unlock` `!aislamiento`' },
        { name: L(lc, '🎮 Games & economy', '🎮 Juegos y economía'), value: '`/coinflip` `/dice` `/rps` `/slots` `/hilo` `/trivia` `/tictactoe` `/8ball`\n`/daily` `/work` `/balance` `/leaderboard`' },
        { name: 'ℹ️', value: '`/serverinfo` `/userinfo` `/ping`' }
      );
    return i.reply({ embeds: [e], flags: EPHEMERAL });
  },
});

/* ============================ conexión de eventos ============================ */
function attach(client) {
  client.on('guildMemberAdd', (m) => handleJoin(m).catch(logErr));
  client.on('guildMemberRemove', (m) => {
    const guild = m.guild;
    sendLog(
      guild,
      'goodbye',
      mkEmbed(guild, COLOR.orange, GL(guild, 'Member left', 'Miembro salió'), null, [[GL(guild, 'User', 'Usuario'), (m.user ? m.user.username : '?') + '\n`' + m.id + '`'], [GL(guild, 'Members', 'Miembros'), guild.memberCount]])
    );
    if (m.user && !m.user.bot) sendGreeting('goodbye', m);
    nukeCheck(guild, AuditLogEvent.MemberKick, m.id, 'kick', null, m.user ? m.user.username : m.id);
  });
  client.on('channelDelete', (ch) => ch.guild && nukeCheck(ch.guild, AuditLogEvent.ChannelDelete, ch.id, 'channel delete', { kind: 'channel', data: snap.snapChannel(ch) }, '#' + ch.name));
  client.on('channelCreate', (ch) => ch.guild && nukeCheck(ch.guild, AuditLogEvent.ChannelCreate, ch.id, 'channel create', null, '#' + ch.name));
  client.on('roleDelete', (r) => nukeCheck(r.guild, AuditLogEvent.RoleDelete, r.id, 'role delete', { kind: 'role', data: snap.snapRole(r) }, '@' + r.name));
  client.on('roleCreate', (r) => nukeCheck(r.guild, AuditLogEvent.RoleCreate, r.id, 'role create', null, '@' + r.name));
  client.on('guildBanAdd', (b) => nukeCheck(b.guild, AuditLogEvent.MemberBanAdd, b.user.id, 'ban', null, b.user.username));
  client.on('webhooksUpdate', (ch) => ch.guild && nukeCheck(ch.guild, AuditLogEvent.WebhookCreate, null, 'webhook', null, '#' + ch.name));
  client.on('messageCreate', (m) => handleMessage(m).catch(logErr));
}

module.exports = {
  commands,
  buttons: [],
  attach,
  restoreRaidTimers,
  jsonStore,
  L,
  GL,
  lang,
  fmt,
  COLOR,
  INVITE_PERMS,
  EPHEMERAL,
  TEXT_CHANNELS,
  hooks,
  guilds,
  getCfg,
  saveCfg,
  sendLog,
  mkEmbed,
  punishMember,
  isTrusted,
  isStaff,
  canAct,
  canConfigure,
  lockedMsg,
  modLog,
  doPurge,
  doLock,
  doIsolate,
  findAuditEntry,
  activateRaid,
  endRaid,
  say,
  onOff,
  sleep,
  logErr,
  DANGEROUS,
};
