'use strict';

/*
 * snap.js — Captura y recreación de roles y canales.
 * Lo usan el anti-nuke (para deshacer borrados) y el sistema de backups.
 */

const { ChannelType } = require('discord.js');

const TEXTLIKE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const VOICELIKE = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const isText = (t) => TEXTLIKE.has(t);
const isVoice = (t) => VOICELIKE.has(t);

function snapRole(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    hoist: !!r.hoist,
    mentionable: !!r.mentionable,
    permissions: r.permissions.bitfield.toString(),
    position: r.position,
  };
}

function snapChannel(ch) {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type,
    parentId: ch.parentId || null,
    position: typeof ch.rawPosition === 'number' ? ch.rawPosition : 0,
    topic: ch.topic || null,
    nsfw: !!ch.nsfw,
    rateLimitPerUser: ch.rateLimitPerUser || 0,
    bitrate: ch.bitrate || null,
    userLimit: ch.userLimit || 0,
    overwrites: ch.permissionOverwrites
      ? [...ch.permissionOverwrites.cache.values()].map((o) => ({
          id: o.id,
          type: o.type,
          allow: o.allow.bitfield.toString(),
          deny: o.deny.bitfield.toString(),
        }))
      : [],
  };
}

/* Solo se recrean los permisos de roles (los de miembros concretos no se pueden garantizar). */
function mapOverwrites(guild, overwrites, roleMap) {
  const out = [];
  for (const o of overwrites || []) {
    if (o.type !== 0) continue;
    const id = (roleMap && roleMap.get(o.id)) || (guild.roles.cache.has(o.id) ? o.id : null);
    if (!id) continue;
    out.push({ id, type: 0, allow: BigInt(o.allow), deny: BigInt(o.deny) });
  }
  return out;
}

async function createRoleFrom(guild, s, reason) {
  const base = { name: s.name, color: s.color, hoist: s.hoist, mentionable: s.mentionable, reason: reason || 'Centinela: restore' };
  try {
    return await guild.roles.create({ ...base, permissions: BigInt(s.permissions) });
  } catch (e) {
    // El bot no puede otorgar permisos que él mismo no tiene: reintenta con la intersección.
    const me = guild.members.me;
    const allowed = me ? BigInt(s.permissions) & me.permissions.bitfield : 0n;
    return guild.roles.create({ ...base, permissions: allowed });
  }
}

async function createChannelFrom(guild, s, o = {}) {
  const base = { name: s.name, type: s.type, reason: o.reason || 'Centinela: restore' };
  if (s.type !== ChannelType.GuildCategory) {
    const pid = (o.parentMap && o.parentMap.get(s.parentId)) || (s.parentId && guild.channels.cache.has(s.parentId) ? s.parentId : null);
    if (pid) base.parent = pid;
  }
  const ow = mapOverwrites(guild, s.overwrites, o.roleMap);
  if (ow.length) base.permissionOverwrites = ow;
  if (isText(s.type)) {
    if (s.topic) base.topic = s.topic;
    base.nsfw = !!s.nsfw;
    if (s.rateLimitPerUser) base.rateLimitPerUser = s.rateLimitPerUser;
  }
  if (isVoice(s.type)) {
    if (s.bitrate) base.bitrate = Math.min(s.bitrate, guild.maximumBitrate || 64000);
    if (s.userLimit) base.userLimit = s.userLimit;
  }
  try {
    return await guild.channels.create(base);
  } catch (e) {
    // Los canales de anuncios requieren servidor Comunidad: se recrean como texto.
    if (s.type === ChannelType.GuildAnnouncement) return guild.channels.create({ ...base, type: ChannelType.GuildText });
    throw e;
  }
}

module.exports = { isText, isVoice, snapRole, snapChannel, mapOverwrites, createRoleFrom, createChannelFrom };
