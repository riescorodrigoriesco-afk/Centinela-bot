'use strict';

/* unban.js — /unban (en español /desbanear): quita el ban a alguien sin tener que saberse su ID.
 * Al escribir en la casilla «usuario» se enseña la lista de baneados del servidor (por nombre, ID o motivo);
 * también vale pegar un ID directamente (aunque la persona no esté en la lista que ve Discord). */

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');
const { explain } = require('./manage');

const { L, GL, COLOR } = bot;
const EPH = MessageFlags.Ephemeral;
const es2 = (s) => ({ 'es-ES': s, 'es-419': s });
const ID = /^\d{15,25}$/;

const data = new SlashCommandBuilder()
  .setName('unban')
  .setNameLocalizations(es2('desbanear'))
  .setDescription('Unban someone (type to search the banned list, or paste an ID)')
  .setDescriptionLocalizations(es2('Quita el ban a alguien (escribe para buscar en los baneados, o pega un ID)'))
  .setDefaultMemberPermissions(P.BanMembers)
  .setDMPermission(false)
  .addStringOption((o) => o.setName('user').setNameLocalizations(es2('usuario')).setDescription('Banned user: type a name / ID / reason').setDescriptionLocalizations(es2('Usuario baneado: escribe nombre, ID o motivo')).setRequired(true).setAutocomplete(true).setMaxLength(100))
  .addStringOption((o) => o.setName('reason').setNameLocalizations(es2('motivo')).setDescription('Why (saved in the audit log)').setDescriptionLocalizations(es2('Por qué (queda en el registro de auditoría)')).setMaxLength(300));

/* La lista de baneados se guarda unos segundos: el autocompletado consulta a Discord con cada letra */
const cache = new Map(); // guildId -> { at, list }
const TTL = 20000;
async function banList(guild, fresh) {
  const c = cache.get(guild.id);
  if (!fresh && c && Date.now() - c.at < TTL) return c.list;
  const all = await guild.bans.fetch({ limit: 1000, cache: false });
  const list = [...all.values()].map((b) => ({ id: b.user.id, tag: b.user.tag || b.user.username, username: b.user.username || '', reason: b.reason || '' }));
  cache.set(guild.id, { at: Date.now(), list });
  return list;
}
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const norm = (s) => String(s || '').toLowerCase();

async function autocomplete(i) {
  let out = [];
  try {
    // Solo quien puede banear ve la lista (no se filtran los baneados a cualquiera)
    if (i.guild && i.memberPermissions && i.memberPermissions.has(P.BanMembers)) {
      const q = norm(i.options.getFocused()).trim().replace(/^<@!?(\d+)>$/, '$1');
      const list = await banList(i.guild);
      out = list
        .filter((b) => !q || b.id.includes(q) || norm(b.username).includes(q) || norm(b.tag).includes(q) || norm(b.reason).includes(q))
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .slice(0, 25)
        .map((b) => ({ name: clip(b.tag + (b.reason ? ' · ' + b.reason : '') + ' (' + b.id + ')', 100), value: b.id }));
    }
  } catch (_) { out = []; }
  try { await i.respond(out); } catch (_) { /* el autocompletado caduca a los 3 s */ }
}

async function execute(i) {
  const lc = i.locale;
  if (!i.guild) return i.reply({ content: L(lc, '❌ Only works in a server.', '❌ Solo funciona en un servidor.'), flags: EPH });
  if (!(i.memberPermissions && i.memberPermissions.has(P.BanMembers))) {
    return i.reply({ content: L(lc, '🔒 You need the “Ban Members” permission.', '🔒 Necesitas el permiso «Banear miembros».'), flags: EPH });
  }
  await i.deferReply({ flags: EPH });
  const g = i.guild;
  const raw = String(i.options.getString('user', true)).trim().replace(/^<@!?(\d+)>$/, '$1');
  const why = String(i.options.getString('reason') || '').replace(/\s+/g, ' ').trim().slice(0, 300);

  // ¿Tiene Centinela el permiso? (si no, Discord solo diría «Missing Permissions»)
  const me = g.members.me;
  if (me && !me.permissions.has(P.BanMembers)) {
    return i.editReply(L(lc, '❌ I need the “Ban Members” permission to unban people. Give it to my role.', '❌ Necesito el permiso «Banear miembros» para desbanear. Dáselo a mi rol.'));
  }

  // Quién es: un ID, o lo que se escribió (nombre exacto o única coincidencia entre los baneados)
  let id = null;
  let tag = null;
  if (ID.test(raw)) {
    id = raw;
  } else {
    let list = [];
    try { list = await banList(g, true); } catch (e) { return i.editReply('⚠️ ' + explain(e)); }
    const q = norm(raw);
    const exact = list.filter((b) => norm(b.tag) === q || norm(b.username) === q);
    const some = exact.length ? exact : list.filter((b) => norm(b.tag).includes(q) || norm(b.username).includes(q));
    if (some.length === 1) { id = some[0].id; tag = some[0].tag; }
    else if (!some.length) return i.editReply(L(lc, '❌ I can’t find “' + clip(raw, 40) + '” among the banned users. Pick one from the list that appears while you type, or paste an ID.', '❌ No encuentro a «' + clip(raw, 40) + '» entre los baneados. Elige uno de la lista que sale al escribir, o pega un ID.'));
    else return i.editReply(L(lc, '❌ ' + some.length + ' banned users match. Pick one from the list that appears while you type.', '❌ Hay ' + some.length + ' baneados que coinciden. Elige uno de la lista que sale al escribir.'));
  }

  if (!tag) {
    const c = cache.get(g.id);
    const hit = c && c.list.find((b) => b.id === id);
    tag = hit ? hit.tag : null;
  }
  try {
    await g.members.unban(id, 'Unban por ' + i.user.username + (why ? ' — ' + why : ''));
  } catch (e) {
    if (e && e.code === 10026) return i.editReply(L(lc, '❌ That user is not banned.', '❌ Ese usuario no está baneado.'));
    return i.editReply('⚠️ ' + explain(e));
  }
  cache.delete(g.id);
  if (!tag) { const u = await i.client.users.fetch(id).catch(() => null); tag = u ? u.tag || u.username : id; }
  try {
    bot.modLog(g, GL(g, 'Unban', 'Desbaneo'), [[GL(g, 'User', 'Usuario'), '<@' + id + '>\n`' + id + '`'], [GL(g, 'By', 'Por'), '<@' + i.user.id + '>'], [GL(g, 'Reason', 'Motivo'), why || '—']], COLOR.green);
  } catch (_) { /* el registro es un extra */ }
  return i.editReply(L(lc, '✅ **' + tag + '** has been unbanned. They can join again with an invite.', '✅ **' + tag + '** desbaneado. Ya puede volver a entrar con una invitación.'));
}

module.exports = { commands: [{ data, execute, autocomplete }], _cache: cache };
