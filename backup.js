'use strict';

/*
 * backup.js — Copias de seguridad del servidor (roles, canales, categorías, permisos,
 * últimos 30 mensajes por canal, nombre/icono y ajustes) y restauración.
 * Se guardan en DATA_DIR/backups/<servidor>/<id>.json
 */

const fs = require('fs');
const path = require('path');
const { ChannelType } = require('discord.js');
const snap = require('./snap');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ID_RE = /^[a-z0-9]{4,12}$/;
const MAX_MANUAL = 10;
const busy = new Set();

const dirFor = (gid) => path.join(DATA_DIR, 'backups', String(gid).replace(/\D/g, ''));
const newId = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

function readBackup(gid, id) {
  if (!ID_RE.test(String(id))) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dirFor(gid), id + '.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function listBackups(gid) {
  let files = [];
  try {
    files = fs.readdirSync(dirFor(gid)).filter((f) => f.endsWith('.json'));
  } catch (_) {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dirFor(gid), f), 'utf8'));
      if (b && b.meta) out.push(b.meta);
    } catch (_) {}
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function deleteBackup(gid, id) {
  if (!ID_RE.test(String(id))) return false;
  try {
    fs.unlinkSync(path.join(dirFor(gid), id + '.json'));
    return true;
  } catch (_) {
    return false;
  }
}

function pruneAuto(gid, keep) {
  const autos = listBackups(gid).filter((m) => m.auto);
  for (const m of autos.slice(Math.max(1, keep))) deleteBackup(gid, m.id);
}

async function iconAsDataUri(guild) {
  try {
    const url = guild.iconURL({ extension: 'png', size: 1024 });
    if (!url) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return null;
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch (_) {
    return null;
  }
}

async function takeBackup(guild, { auto = false, messages = true, by = null } = {}) {
  if (busy.has(guild.id)) throw new Error('busy');
  busy.add(guild.id);
  try {
    await guild.roles.fetch().catch(() => {});
    await guild.channels.fetch().catch(() => {});

    const roles = [...guild.roles.cache.values()]
      .filter((r) => !r.managed && r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(snap.snapRole);

    const chObjs = [...guild.channels.cache.values()].filter((c) => !c.isThread());
    const channels = chObjs.sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0)).map(snap.snapChannel);

    const msgs = {};
    let msgTotal = 0;
    if (messages) {
      let scanned = 0;
      for (const s of channels) {
        if (!snap.isText(s.type)) continue;
        if (scanned++ >= 60) break;
        const ch = guild.channels.cache.get(s.id);
        if (!ch || !ch.viewable || !ch.messages) continue;
        try {
          const f = await ch.messages.fetch({ limit: 30 });
          const list = [...f.values()]
            .reverse()
            .map((m) => ({
              a: m.author ? m.author.username : '?',
              t: m.createdTimestamp,
              c: String(m.content || '').slice(0, 1500),
              f: [...m.attachments.values()].slice(0, 3).map((x) => x.url),
            }))
            .filter((m) => m.c || m.f.length);
          if (list.length) {
            msgs[s.id] = list;
            msgTotal += list.length;
          }
        } catch (_) {}
      }
    }

    const id = newId();
    const backup = {
      meta: { id, createdAt: Date.now(), auto: !!auto, by, roles: roles.length, channels: channels.length, messages: msgTotal, name: guild.name },
      settings: {
        name: guild.name,
        icon: await iconAsDataUri(guild),
        verificationLevel: guild.verificationLevel,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        explicitContentFilter: guild.explicitContentFilter,
        afkTimeout: guild.afkTimeout,
        everyonePerms: guild.roles.everyone.permissions.bitfield.toString(),
      },
      roles,
      channels,
      messages: msgs,
    };

    fs.mkdirSync(dirFor(guild.id), { recursive: true });
    fs.writeFileSync(path.join(dirFor(guild.id), id + '.json'), JSON.stringify(backup));

    if (!auto) {
      const manual = listBackups(guild.id).filter((m) => !m.auto);
      for (const m of manual.slice(MAX_MANUAL)) deleteBackup(guild.id, m.id);
    }
    return backup.meta;
  } finally {
    busy.delete(guild.id);
  }
}

function chunkLines(lines, max = 1900) {
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    if ((cur + '\n' + line).length > max) {
      if (cur) chunks.push(cur);
      cur = line.slice(0, max);
    } else {
      cur = cur ? cur + '\n' + line : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/*
 * mode "merge": recrea solo lo que falta (roles y canales que ya existen no se tocan).
 * mode "full":  borra todos los canales y los roles que el bot pueda borrar y lo recrea todo.
 */
async function restoreBackup(guild, b, { mode = 'merge' } = {}) {
  if (busy.has(guild.id)) throw new Error('busy');
  busy.add(guild.id);
  const rep = { mode, rolesCreated: 0, rolesFailed: 0, chansCreated: 0, chansFailed: 0, msgs: 0, wipedChans: 0, wipedRoles: 0, errors: [] };
  const note = (m) => {
    if (rep.errors.length < 8) rep.errors.push(String(m).slice(0, 160));
  };
  try {
    await guild.roles.fetch();
    await guild.channels.fetch();
    const me = guild.members.me;

    if (mode === 'full') {
      for (const c of [...guild.channels.cache.values()]) {
        if (c.isThread()) continue;
        try {
          await c.delete('Centinela: restauración completa');
          rep.wipedChans++;
        } catch (e) {
          note('borrar #' + c.name + ': ' + e.message);
        }
      }
      for (const r of [...guild.roles.cache.values()]) {
        if (r.id === guild.id || r.managed || r.comparePositionTo(me.roles.highest) >= 0) continue;
        try {
          await r.delete('Centinela: restauración completa');
          rep.wipedRoles++;
        } catch (e) {
          note('borrar @' + r.name + ': ' + e.message);
        }
      }
      try {
        await guild.roles.everyone.setPermissions(BigInt(b.settings.everyonePerms));
      } catch (e) {
        note('permisos @everyone: ' + e.message);
      }
    }

    // Roles (de arriba hacia abajo para conservar el orden relativo)
    const roleMap = new Map();
    const byName = new Map();
    for (const r of guild.roles.cache.values()) if (!byName.has(r.name)) byName.set(r.name, r);
    for (const s of b.roles) {
      const ex = byName.get(s.name);
      if (ex) {
        roleMap.set(s.id, ex.id);
        continue;
      }
      try {
        const nr = await snap.createRoleFrom(guild, s);
        roleMap.set(s.id, nr.id);
        byName.set(nr.name, nr);
        rep.rolesCreated++;
      } catch (e) {
        rep.rolesFailed++;
        note('rol ' + s.name + ': ' + e.message);
      }
    }

    // Categorías y canales
    const keyOf = (type, name, parent) => type + '|' + String(name).toLowerCase() + '|' + String(parent || '').toLowerCase();
    const existing = new Map();
    for (const c of guild.channels.cache.values()) {
      if (c.isThread()) continue;
      existing.set(keyOf(c.type, c.name, c.parent ? c.parent.name : ''), c);
    }
    const snapById = new Map(b.channels.map((c) => [c.id, c]));
    const cats = b.channels.filter((c) => c.type === ChannelType.GuildCategory);
    const rest = b.channels.filter((c) => c.type !== ChannelType.GuildCategory);
    const parentMap = new Map();
    const created = new Map();

    for (const s of cats) {
      const ex = existing.get(keyOf(s.type, s.name, ''));
      if (ex) {
        parentMap.set(s.id, ex.id);
        continue;
      }
      try {
        const nc = await snap.createChannelFrom(guild, s, { roleMap, parentMap });
        parentMap.set(s.id, nc.id);
        created.set(s.id, nc);
        rep.chansCreated++;
      } catch (e) {
        rep.chansFailed++;
        note('categoría ' + s.name + ': ' + e.message);
      }
    }
    for (const s of rest) {
      const parent = s.parentId && snapById.get(s.parentId) ? snapById.get(s.parentId).name : '';
      if (existing.get(keyOf(s.type, s.name, parent))) continue;
      try {
        const nc = await snap.createChannelFrom(guild, s, { roleMap, parentMap });
        created.set(s.id, nc);
        rep.chansCreated++;
      } catch (e) {
        rep.chansFailed++;
        note('canal ' + s.name + ': ' + e.message);
      }
    }

    // Mensajes: solo en los canales que se acaban de crear
    for (const [oldId, ch] of created) {
      const list = b.messages && b.messages[oldId];
      if (!list || !ch.isTextBased()) continue;
      const lines = list.map((m) => {
        const d = new Date(m.t).toISOString().slice(0, 16).replace('T', ' ');
        return '`' + d + '` **' + String(m.a).replace(/[*_`~|>]/g, '') + '**: ' + (m.c || '') + (m.f && m.f.length ? ' ' + m.f.join(' ') : '');
      });
      try {
        await ch.send({ content: '📦 **Mensajes restaurados desde el backup ' + b.meta.id + '**', allowedMentions: { parse: [] } });
        for (const chunk of chunkLines(lines)) await ch.send({ content: chunk, allowedMentions: { parse: [] } });
        rep.msgs += list.length;
      } catch (e) {
        note('mensajes #' + ch.name + ': ' + e.message);
      }
    }

    // Ajustes del servidor (solo en modo completo)
    if (mode === 'full') {
      const s = b.settings;
      const tryDo = async (label, fn) => {
        try {
          await fn();
        } catch (e) {
          note(label + ': ' + e.message);
        }
      };
      await tryDo('nombre', () => guild.setName(s.name));
      if (s.icon) await tryDo('icono', () => guild.setIcon(s.icon));
      await tryDo('verificación', () => guild.setVerificationLevel(s.verificationLevel));
      await tryDo('notificaciones', () => guild.setDefaultMessageNotifications(s.defaultMessageNotifications));
      await tryDo('filtro de contenido', () => guild.setExplicitContentFilter(s.explicitContentFilter));
      await tryDo('AFK', () => guild.setAFKTimeout(s.afkTimeout));
    }
    return rep;
  } finally {
    busy.delete(guild.id);
  }
}

/* Backups automáticos: un solo temporizador para todo el proceso. */
let timer = null;
let currentClient = null;
function startAuto(client, getCfg, saveCfg, logErr) {
  currentClient = client;
  if (timer) return;
  const tick = async () => {
    const c = currentClient;
    if (!c || !c.isReady()) return;
    for (const g of c.guilds.cache.values()) {
      try {
        const cfg = getCfg(g.id);
        const h = cfg.backup.autoHours;
        if (!h || Date.now() - (cfg.backup.lastAuto || 0) < h * 3600000) continue;
        cfg.backup.lastAuto = Date.now();
        saveCfg();
        await takeBackup(g, { auto: true, messages: false, by: 'auto' });
        pruneAuto(g.id, cfg.backup.keep);
      } catch (e) {
        if (e.message !== 'busy') logErr(e);
      }
    }
  };
  timer = setInterval(tick, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
  const first = setTimeout(tick, 90 * 1000);
  if (first.unref) first.unref();
}

module.exports = { takeBackup, restoreBackup, listBackups, readBackup, deleteBackup, startAuto, isBusy: (gid) => busy.has(gid) };
