'use strict';

/* manage.js — Gestionar el servidor desde el panel web: borrar roles y canales, banear / desbanear / expulsar,
 * dar y quitar roles. Todo pasa por el bot, pero SIEMPRE con las reglas de Discord de la persona que pulsa:
 *  · el dueño del servidor puede todo lo que el bot pueda;
 *  · el resto (también el creador del bot) necesita el permiso real en Discord (Banear, Expulsar, Gestionar roles /
 *    canales) y un rol por encima del miembro o rol afectado. Así el panel nunca da más poder del que ya tienes dentro
 *    de Discord, y el creador del bot no puede tocar los servidores de otras personas donde alguien invitó a Centinela.
 *  · única excepción: la sesión con la clave del panel (PANEL_PASSWORD, sin cuenta de Discord), que ya controla todo el despliegue. */

const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');

const ID = /^\d{15,25}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const fail = (m) => { throw new Error(m); };
const PERM_NAME = { BanMembers: 'Banear miembros', KickMembers: 'Expulsar miembros', ManageRoles: 'Gestionar roles', ManageChannels: 'Gestionar canales', CreateInstantInvite: 'Crear invitación' };

/* Mensajes claros para los errores típicos de Discord */
const DISCORD_ERR = {
  50013: 'Discord dice que Centinela no tiene permiso para eso. Sube el rol de Centinela por encima del rol o miembro afectado (Ajustes del servidor → Roles).',
  50001: 'Centinela no tiene acceso a eso.',
  10007: 'Ese miembro ya no está en el servidor.',
  10013: 'No encuentro a ese usuario.',
  10011: 'Ese rol ya no existe.',
  10003: 'Ese canal ya no existe.',
  10026: 'Ese usuario no está baneado.',
  50074: 'Discord no deja borrar los canales que la comunidad necesita (reglas y avisos de Discord). Cámbialos primero en Ajustes → Comunidad.',
  50035: 'Discord rechazó los datos enviados.',
  30005: 'El servidor llegó al máximo de roles.',
};
function explain(e) {
  if (e && e.code && DISCORD_ERR[e.code]) return DISCORD_ERR[e.code];
  return (e && e.message) || 'Error desconocido';
}

/* ---------- quién pulsa ---------- */
async function who(g, sess) {
  const uid = (sess && sess.uid) || null;
  const member = uid ? await g.members.fetch(uid).catch(() => null) : null;
  return { admin: !!(sess && sess.admin), uid, name: (sess && sess.name) || 'Panel web', owner: !!uid && uid === g.ownerId, member };
}
const privileged = (c) => c.owner || (c.admin && !c.uid);

function need(c, perm) {
  if (privileged(c)) return;
  if (!c.member) fail('No estás en este servidor, así que no puedo comprobar tus permisos.');
  if (c.member.permissions.has(P.Administrator) || c.member.permissions.has(P[perm])) return;
  fail('Te falta el permiso «' + PERM_NAME[perm] + '» en Discord.');
}
/* ¿El que pulsa tiene un rol por encima de este rol / miembro? (el dueño y el creador del bot, siempre) */
function outranks(c, thing) {
  if (privileged(c)) return true;
  if (!c.member) return false;
  const top = c.member.roles.highest;
  return top.comparePositionTo(thing.roles ? thing.roles.highest : thing) > 0;
}
const reasonOf = (c, extra) => ('Panel web · ' + c.name + (c.uid ? ' (' + c.uid + ')' : '') + (extra ? ' — ' + String(extra).replace(/\s+/g, ' ').trim() : '')).slice(0, 500);
const cleanReason = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);

function audit(g, c, title, fields, color) {
  try {
    bot.modLog(g, '🌐 ' + title, [['Quién', c.uid ? '<@' + c.uid + '>' : c.name], ...fields], color);
  } catch (_) { /* el registro es un extra */ }
}

/* ---------- listados ---------- */
const KIND = new Map([
  [ChannelType.GuildText, 'text'], [ChannelType.GuildVoice, 'voice'], [ChannelType.GuildCategory, 'category'],
  [ChannelType.GuildAnnouncement, 'news'], [ChannelType.GuildStageVoice, 'stage'], [ChannelType.GuildForum, 'forum'],
  [ChannelType.GuildMedia, 'forum'],
]);

async function overview(g, c) {
  await g.roles.fetch().catch(() => {});
  await g.channels.fetch().catch(() => {});
  const roles = [...g.roles.cache.values()]
    .filter((r) => r.id !== g.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id, name: r.name, color: HEX.test(r.hexColor || '') && r.hexColor !== '#000000' ? r.hexColor : null,
      managed: !!r.managed, hoist: !!r.hoist,
      deletable: !!r.editable && !r.managed && outranks(c, r),
      why: r.managed ? 'Rol de otro bot o integración: Discord no deja gestionarlo a mano.' : (!r.editable ? 'Está por encima del rol de Centinela (o igual): sube el rol de Centinela.' : (!outranks(c, r) ? 'Está por encima de tu rol más alto (o igual).' : '')),
    }));
  const chans = [...g.channels.cache.values()].filter((ch) => KIND.has(ch.type));
  const byPos = (a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0);
  const ser = (ch) => ({ id: ch.id, name: ch.name, kind: KIND.get(ch.type), parentId: ch.parentId || null, deletable: ch.deletable !== false && chanOk(c, ch), why: ch.deletable === false ? 'Centinela no puede borrarlo (sin permiso, o es un canal que Discord exige para la comunidad).' : (!chanOk(c, ch) ? 'No tienes «Gestionar canales» en este canal.' : '') });
  const cats = chans.filter((ch) => ch.type === ChannelType.GuildCategory).sort(byPos);
  const catIds = new Set(cats.map((x) => x.id));
  const channels = [];
  for (const ch of chans.filter((x) => x.type !== ChannelType.GuildCategory && (!x.parentId || !catIds.has(x.parentId))).sort(byPos)) channels.push(ser(ch));
  for (const cat of cats) {
    channels.push(ser(cat));
    for (const ch of chans.filter((x) => x.parentId === cat.id && x.type !== ChannelType.GuildCategory).sort(byPos)) channels.push(ser(ch));
  }
  return { id: g.id, name: g.name, members: g.memberCount, roles, channels };
}
/* ¿Esta persona puede gestionar ese canal? (permisos del canal incluidos) */
function chanOk(c, ch) {
  if (privileged(c)) return true;
  if (!c.member) return false;
  try { return ch.permissionsFor(c.member).has(P.ManageChannels); } catch (_) { return false; }
}

async function memberView(g, c, m) {
  const isMe = m.id === g.client.user.id;
  const self = !!c.uid && m.id === c.uid;
  const owner = m.id === g.ownerId;
  const above = outranks(c, m);
  const roles = [...m.roles.cache.values()].filter((r) => r.id !== g.id).sort((a, b) => b.position - a.position).map((r) => r.id);
  return {
    id: m.id, tag: m.user.tag || m.user.username, name: m.displayName || m.user.username, bot: !!m.user.bot,
    avatar: m.displayAvatarURL ? m.displayAvatarURL({ size: 64 }) : null, roles,
    owner, me: isMe, self,
    canBan: !isMe && !self && !owner && !!m.bannable && above,
    canKick: !isMe && !self && !owner && !!m.kickable && above,
  };
}

async function members(g, c, _b, q) {
  const text = String((q && q.q) || '').trim().slice(0, 100);
  let list = [];
  let note = '';
  if (!text) {
    list = [...g.members.cache.values()].sort((a, b) => (b.joinedTimestamp || 0) - (a.joinedTimestamp || 0)).slice(0, 20);
    note = list.length ? 'Últimos miembros que entraron. Escribe un nombre o un ID para buscar.' : 'Escribe un nombre o un ID para buscar a alguien.';
  } else if (ID.test(text)) {
    const m = await g.members.fetch(text).catch(() => null);
    if (m) list = [m];
    else note = 'Ese ID no es de un miembro del servidor (puedes banearlo por ID en la pestaña Baneos).';
  } else {
    try {
      list = [...(await g.members.search({ query: text, limit: 20 })).values()];
    } catch (_) {
      const t = text.toLowerCase();
      list = [...g.members.cache.values()].filter((m) => (m.displayName || '').toLowerCase().includes(t) || (m.user.username || '').toLowerCase().includes(t)).slice(0, 20);
    }
    if (!list.length) note = 'No encontré a nadie con ese nombre.';
  }
  return { members: await Promise.all(list.map((m) => memberView(g, c, m))), note };
}

async function bans(g, c, _b, q) {
  need(c, 'BanMembers');
  const text = String((q && q.q) || '').trim().toLowerCase().slice(0, 100);
  const all = await g.bans.fetch({ limit: 1000 });
  let list = [...all.values()];
  const total = list.length;
  if (text) list = list.filter((b) => b.user.id === text || (b.user.username || '').toLowerCase().includes(text) || (b.user.tag || '').toLowerCase().includes(text) || (b.reason || '').toLowerCase().includes(text));
  return {
    total, truncated: total >= 1000,
    bans: list.slice(0, 200).map((b) => ({ id: b.user.id, tag: b.user.tag || b.user.username, reason: b.reason || null, bot: !!b.user.bot })),
  };
}

/* ---------- acciones ---------- */
async function ban(g, c, b) {
  need(c, 'BanMembers');
  const id = String(b.userId || '');
  if (!ID.test(id)) fail('ID de usuario no válido.');
  if (id === g.client.user.id) fail('No puedo banearme a mí mismo.');
  if (id === g.ownerId) fail('No se puede banear al dueño del servidor.');
  if (c.uid && id === c.uid) fail('No puedes banearte a ti mismo.');
  const m = await g.members.fetch(id).catch(() => null);
  if (m) {
    if (!outranks(c, m)) fail('Ese miembro tiene un rol igual o superior al tuyo.');
    if (!m.bannable) fail('No puedo banear a ese miembro: su rol está por encima del de Centinela o igual.');
  }
  const days = Math.max(0, Math.min(7, parseInt(b.days, 10) || 0));
  const why = cleanReason(b.reason);
  const opts = { reason: reasonOf(c, why) };
  if (days) opts.deleteMessageSeconds = days * 86400;
  await g.members.ban(id, opts);
  const tag = m ? m.user.tag || m.user.username : id;
  audit(g, c, 'Baneo desde el panel', [['Usuario', '<@' + id + '>\n`' + id + '`'], ['Motivo', why || '—']], bot.COLOR.red);
  return { ok: true, note: '🔨 ' + tag + ' baneado.' };
}

async function unban(g, c, b) {
  need(c, 'BanMembers');
  const id = String(b.userId || '');
  if (!ID.test(id)) fail('ID de usuario no válido.');
  await g.members.unban(id, reasonOf(c));
  audit(g, c, 'Desbaneo desde el panel', [['Usuario', '<@' + id + '>\n`' + id + '`']], bot.COLOR.green);
  return { ok: true, note: '✅ Usuario desbaneado.' };
}

async function kick(g, c, b) {
  need(c, 'KickMembers');
  const id = String(b.userId || '');
  if (!ID.test(id)) fail('ID de usuario no válido.');
  if (id === g.client.user.id) fail('No puedo expulsarme a mí mismo.');
  if (id === g.ownerId) fail('No se puede expulsar al dueño del servidor.');
  if (c.uid && id === c.uid) fail('No puedes expulsarte a ti mismo.');
  const m = await g.members.fetch(id).catch(() => null);
  if (!m) fail('Ese miembro ya no está en el servidor.');
  if (!outranks(c, m)) fail('Ese miembro tiene un rol igual o superior al tuyo.');
  if (!m.kickable) fail('No puedo expulsar a ese miembro: su rol está por encima del de Centinela o igual.');
  const why = cleanReason(b.reason);
  await m.kick(reasonOf(c, why));
  audit(g, c, 'Expulsión desde el panel', [['Usuario', '<@' + id + '>\n`' + id + '`'], ['Motivo', why || '—']], bot.COLOR.orange);
  return { ok: true, note: '👢 ' + (m.user.tag || m.user.username) + ' expulsado.' };
}

async function roleTarget(g, c, b) {
  need(c, 'ManageRoles');
  const uid = String(b.userId || '');
  const rid = String(b.roleId || '');
  if (!ID.test(uid) || !ID.test(rid)) fail('Faltan el miembro o el rol.');
  const role = g.roles.cache.get(rid) || (await g.roles.fetch(rid).catch(() => null));
  if (!role || role.id === g.id) fail('Ese rol no existe.');
  if (role.managed) fail('«' + role.name + '» es un rol de otro bot o integración: Discord no deja darlo ni quitarlo a mano.');
  if (!role.editable) fail('No puedo gestionar «' + role.name + '»: está por encima del rol de Centinela (o igual). Sube el rol de Centinela.');
  if (!outranks(c, role)) fail('«' + role.name + '» está por encima de tu rol más alto (o es igual): no puedes gestionarlo.');
  const m = await g.members.fetch(uid).catch(() => null);
  if (!m) fail('Ese miembro ya no está en el servidor.');
  return { role, m };
}
async function giveRole(g, c, b) {
  const { role, m } = await roleTarget(g, c, b);
  if (m.roles.cache.has(role.id)) return { ok: true, note: m.displayName + ' ya tenía «' + role.name + '».', roles: [...m.roles.cache.keys()].filter((x) => x !== g.id) };
  await m.roles.add(role, reasonOf(c));
  audit(g, c, 'Rol dado desde el panel', [['Miembro', '<@' + m.id + '>'], ['Rol', role.name]], bot.COLOR.blue);
  return { ok: true, note: '➕ «' + role.name + '» dado a ' + m.displayName + '.', roles: [...m.roles.cache.keys()].filter((x) => x !== g.id) };
}
async function takeRole(g, c, b) {
  const { role, m } = await roleTarget(g, c, b);
  if (!m.roles.cache.has(role.id)) return { ok: true, note: m.displayName + ' no tenía «' + role.name + '».', roles: [...m.roles.cache.keys()].filter((x) => x !== g.id) };
  await m.roles.remove(role, reasonOf(c));
  audit(g, c, 'Rol quitado desde el panel', [['Miembro', '<@' + m.id + '>'], ['Rol', role.name]], bot.COLOR.blue);
  return { ok: true, note: '➖ «' + role.name + '» quitado a ' + m.displayName + '.', roles: [...m.roles.cache.keys()].filter((x) => x !== g.id) };
}

async function deleteRole(g, c, b) {
  need(c, 'ManageRoles');
  const rid = String(b.roleId || '');
  if (!ID.test(rid)) fail('Rol no válido.');
  const role = g.roles.cache.get(rid) || (await g.roles.fetch(rid).catch(() => null));
  if (!role) fail('Ese rol ya no existe.');
  if (role.id === g.id) fail('@everyone no se puede borrar.');
  if (role.managed) fail('«' + role.name + '» es un rol de otro bot o integración: se quita echando al bot o desactivando la integración.');
  if (!role.editable) fail('No puedo borrar «' + role.name + '»: está por encima del rol de Centinela (o igual). Sube el rol de Centinela.');
  if (!outranks(c, role)) fail('«' + role.name + '» está por encima de tu rol más alto (o es igual): no puedes borrarlo.');
  const name = role.name;
  await role.delete(reasonOf(c));
  audit(g, c, 'Rol borrado desde el panel', [['Rol', name]], bot.COLOR.red);
  return { ok: true, note: '🗑️ Rol «' + name + '» borrado.' };
}

async function deleteChannel(g, c, b) {
  need(c, 'ManageChannels');
  const cid = String(b.channelId || '');
  if (!ID.test(cid)) fail('Canal no válido.');
  const ch = g.channels.cache.get(cid) || (await g.channels.fetch(cid).catch(() => null));
  if (!ch) fail('Ese canal ya no existe.');
  const check = (x) => {
    if (!chanOk(c, x)) fail('No tienes permiso de «Gestionar canales» en #' + x.name + '.');
    if (x.deletable === false) fail('No puedo borrar #' + x.name + ': o Centinela no tiene permiso en él, o es un canal que Discord exige (reglas / avisos de la comunidad).');
  };
  let inside = 0;
  if (ch.type === ChannelType.GuildCategory && b.children) {
    const kids = [...g.channels.cache.values()].filter((x) => x.parentId === ch.id);
    for (const k of kids) check(k);
    check(ch);
    for (const k of kids) { await k.delete(reasonOf(c)); inside++; }
  } else {
    check(ch);
  }
  const name = ch.name;
  const isCat = ch.type === ChannelType.GuildCategory;
  await ch.delete(reasonOf(c));
  audit(g, c, (isCat ? 'Categoría' : 'Canal') + ' borrado desde el panel', [[isCat ? 'Categoría' : 'Canal', name + (inside ? ' (+' + inside + ' canales)' : '')]], bot.COLOR.red);
  return { ok: true, note: '🗑️ ' + (isCat ? 'Categoría «' : '#') + name + (isCat ? '»' : '') + ' borrado' + (isCat ? 'a' : '') + (inside ? ' junto con ' + inside + ' canales' : '') + '.' };
}

/* Enlace de invitación del servidor (permanente y sin límite de usos; Discord reutiliza uno igual si ya existe).
 * Se crea en un canal que vea todo el mundo (reglas, avisos del sistema…) para que quien entre no caiga en un canal vacío. */
async function invite(g, c) {
  need(c, 'CreateInstantInvite');
  await g.channels.fetch().catch(() => {});
  const me = g.members.me || (await g.members.fetchMe().catch(() => null));
  if (!me) fail('Ahora mismo no puedo comprobar mis permisos en el servidor. Inténtalo en unos segundos.');
  const has = (ch, who, perm) => { try { return !!ch.permissionsFor(who).has(perm); } catch (_) { return false; } };
  const usable = (ch) => !!ch && typeof ch.createInvite === 'function' && has(ch, me, P.ViewChannel) && has(ch, me, P.CreateInstantInvite);
  const everyone = g.roles.everyone || g.roles.cache.get(g.id);
  const seen = (ch) => !everyone || has(ch, everyone, P.ViewChannel);
  const byPos = (a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0);
  const all = [...g.channels.cache.values()].filter(usable).sort(byPos);
  const ch = [g.rulesChannel, g.systemChannel, g.publicUpdatesChannel].find((x) => usable(x) && seen(x)) || all.find(seen) || all[0];
  if (!ch) fail('Centinela no puede crear invitaciones en ningún canal. Dale el permiso «Crear invitación» a su rol (o a @everyone).');
  const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: reasonOf(c) });
  audit(g, c, 'Invitación creada desde el panel', [['Canal', '#' + ch.name], ['Código', inv.code || '—']], bot.COLOR.blue);
  return { ok: true, url: inv.url || 'https://discord.gg/' + inv.code, code: inv.code, channel: ch.name, note: '🔗 Invitación lista (entra por #' + ch.name + ').' };
}

/* ---------- rutas HTTP ---------- */
function router(express, { dashAuth, guildOf }) {
  const r = express.Router({ mergeParams: true });
  r.use(dashAuth);
  // Defensa extra contra peticiones desde otras webs: solo acepta las que salen de este mismo panel
  r.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    let ok = !site || site === 'same-origin' || site === 'none';
    if (ok && origin) { try { ok = new URL(origin).host === req.get('host'); } catch (_) { ok = false; } }
    if (!ok) return res.status(403).json({ error: 'Petición bloqueada: solo se puede usar desde el panel.' });
    next();
  });
  const h = (fn) => async (req, res) => {
    try {
      const g = await guildOf(req, res);
      if (!g) return;
      const c = await who(g, req.sess);
      res.json(await fn(g, c, req.body || {}, req.query || {}));
    } catch (e) {
      res.status(400).json({ error: explain(e) });
    }
  };
  r.get('/overview', h(overview));
  r.get('/members', h(members));
  r.get('/bans', h(bans));
  r.post('/ban', h(ban));
  r.post('/unban', h(unban));
  r.post('/kick', h(kick));
  r.post('/role/give', h(giveRole));
  r.post('/role/remove', h(takeRole));
  r.post('/role/delete', h(deleteRole));
  r.post('/channel/delete', h(deleteChannel));
  r.post('/invite', h(invite));
  return r;
}

module.exports = { router, who, overview, members, bans, ban, unban, kick, giveRole, takeRole, deleteRole, deleteChannel, invite, explain };
