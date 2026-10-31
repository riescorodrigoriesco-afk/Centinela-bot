'use strict';

/*
 * extras.js — Funciones extra: palabras prohibidas, tickets, roles por botones y niveles.
 * Sus módulos usan el mismo esquema que ui.js, así aparecen en /help y en el panel web.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');
const guard = require('./guard');
const { getCfg, jsonStore, punishMember, isTrusted, isStaff, COLOR, DANGEROUS, logErr, L } = bot;

const levels = jsonStore('levels.json', () => ({}));
const lvlOf = (xp) => Math.floor(Math.sqrt(xp / 100));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ============================ módulos (esquema de ui.js) ============================ */
const mods = [
  {
    id: 'badwords', ico: '🧼', inst: false, n: ['Word filter', 'Palabras prohibidas'], d: ['Deletes messages with banned words', 'Borra los mensajes que contengan palabras prohibidas'],
    on: ['badWords', 'enabled'],
    fields: [
      { k: 'words', path: ['badWords', 'words'], t: 'list', max: 60, long: true, optional: true, l: ['Banned words (comma separated)', 'Palabras prohibidas (separadas por coma)'] },
      { k: 'action', path: ['badWords', 'action'], t: 'choice', c: ['delete', 'timeout', 'kick'], l: ['Action: delete / timeout / kick', 'Acción: delete / timeout / kick'] },
    ],
  },
  {
    id: 'tickets', ico: '🎫', inst: false, n: ['Tickets', 'Tickets'], d: ['Private support channels with categories, claiming, transcripts and ratings', 'Canales privados de soporte con categorías, reclamar, transcripciones y valoraciones'],
    get: (c) => c.tickets.enabled,
    set: (c, v) => {
      if (v && (!c.tickets.channel || !c.tickets.staffRole)) throw new Error('need-verify');
      c.tickets.enabled = v;
    },
    fields: [
      { k: 'categories', path: ['tickets', 'categories'], t: 'list', max: 20, long: true, optional: true, l: ['Support categories (comma separated)', 'Categorías de soporte (separadas por coma)'] },
      { k: 'peruser', path: ['tickets', 'perUser'], t: 'int', min: 1, max: 5, l: ['Open tickets per user', 'Tickets abiertos por usuario'] },
    ],
    pickers: [
      { key: 'channel', type: 'channel', n: ['Channel for the ticket panel', 'Canal del panel de tickets'], set: (c, v) => (c.tickets.channel = v[0]), show: (c) => (c.tickets.channel ? '<#' + c.tickets.channel + '>' : '—') },
      { key: 'staff', type: 'role', n: ['Staff role', 'Rol del equipo'], set: (c, v) => (c.tickets.staffRole = v[0]), show: (c) => (c.tickets.staffRole ? '<@&' + c.tickets.staffRole + '>' : '—') },
      { key: 'log', type: 'channel', n: ['Transcripts and ticket log channel', 'Canal de transcripciones y registro'], set: (c, v) => (c.tickets.logChannel = v[0]), show: (c) => (c.tickets.logChannel ? '<#' + c.tickets.logChannel + '>' : '—') },
    ],
    acts: [{
      key: 'panel', n: ['Post ticket panel', 'Publicar panel de tickets'],
      run: async (x) => {
        const t = x.cfg.tickets;
        const ch = t.channel && x.g.channels.cache.get(t.channel);
        if (!ch) throw new Error(L(x.lc, 'Pick a channel first.', 'Elige primero un canal.'));
        const e = new EmbedBuilder().setColor(COLOR.blue).setTitle('🎫 ' + L(x.lc, 'Support', 'Soporte')).setDescription(L(x.lc, 'Open a private ticket with the staff.', 'Abre un ticket privado con el equipo.'));
        let row;
        if (t.categories.length > 1) {
          row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('tk:cat').setPlaceholder(L(x.lc, 'Choose a category', 'Elige una categoría')).addOptions(t.categories.slice(0, 25).map((c) => ({ label: c.slice(0, 100), value: c.slice(0, 100) }))));
        } else {
          row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tk:open').setLabel(L(x.lc, 'Open ticket', 'Abrir ticket')).setEmoji('🎫').setStyle(ButtonStyle.Primary));
        }
        await ch.send({ embeds: [e], components: [row] });
        return L(x.lc, '✅ Panel posted.', '✅ Panel publicado.');
      },
    }],
  },
  {
    id: 'rolepanel', ico: '🎛️', inst: false, n: ['Role panels', 'Paneles de roles'], d: ['Members pick roles with buttons, a dropdown menu or reactions (up to 25 roles; 20 with reactions)', 'Los miembros eligen roles con botones, un menú desplegable o reacciones (hasta 25 roles; 20 con reacciones)'],
    fields: [
      { k: 'mode', path: ['rolePanel', 'mode'], t: 'choice', c: ['buttons', 'menu', 'reactions'], l: ['Mode: buttons / menu / reactions', 'Modo: buttons / menu / reactions'] },
      { k: 'emojis', path: ['rolePanel', 'emojis'], t: 'list', max: 20, optional: true, l: ['Emojis for reactions (same order as roles)', 'Emojis para reacciones (mismo orden que los roles)'] },
      { k: 'temp', path: ['rolePanel', 'tempHours'], t: 'int', min: 0, max: 8760, l: ['Temporary role hours (0 = permanent)', 'Horas del rol temporal (0 = permanente)'] },
    ],
    pickers: [
      { key: 'channel', type: 'channel', n: ['Panel channel', 'Canal del panel'], set: (c, v) => (c.rolePanel.channel = v[0]), show: (c) => (c.rolePanel.channel ? '<#' + c.rolePanel.channel + '>' : '—') },
      { key: 'roles', type: 'role', multi: true, n: ['Roles offered (max 25)', 'Roles ofrecidos (máx. 25)'], set: (c, v) => (c.rolePanel.roles = v.slice(0, 25)), show: (c) => c.rolePanel.roles.map((i) => '<@&' + i + '>').join(' ') || '—' },
    ],
    acts: [{
      key: 'panel', n: ['Post role panel', 'Publicar panel de roles'],
      run: async (x) => {
        const rp = x.cfg.rolePanel;
        const ch = rp.channel && x.g.channels.cache.get(rp.channel);
        const roles = rp.roles.map((id) => x.g.roles.cache.get(id)).filter((r) => safeRole(x.g, r));
        if (!ch || !roles.length) throw new Error(L(x.lc, 'Pick a channel and safe roles (no dangerous permissions).', 'Elige un canal y roles seguros (sin permisos peligrosos).'));
        const e = new EmbedBuilder().setColor(COLOR.blue).setTitle('🎛️ ' + L(x.lc, 'Pick your roles', 'Elige tus roles'));
        if (rp.mode === 'menu') {
          e.setDescription(L(x.lc, 'Choose your roles in the menu.', 'Elige tus roles en el menú.'));
          const menu = new StringSelectMenuBuilder().setCustomId('rpm').setPlaceholder(L(x.lc, 'Your roles', 'Tus roles')).setMinValues(0).setMaxValues(roles.length)
            .addOptions(roles.map((r) => ({ label: r.name.slice(0, 100), value: r.id })));
          await ch.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] });
        } else if (rp.mode === 'reactions') {
          const em = rp.emojis;
          if (roles.length > 20) throw new Error(L(x.lc, 'Discord allows 20 reactions per message: pick up to 20 roles or use buttons / menu.', 'Discord admite 20 reacciones por mensaje: elige hasta 20 roles o usa botones / menú.'));
          if (em.length < roles.length) throw new Error(L(x.lc, 'Add one emoji per role in "Edit values".', 'Añade un emoji por rol en "Editar valores".'));
          e.setDescription(roles.map((r, n) => em[n] + ' → ' + r.name).join('\n'));
          const m = await ch.send({ embeds: [e] });
          const map = {};
          for (let n = 0; n < roles.length; n++) { map[em[n]] = roles[n].id; await m.react(em[n]).catch(() => {}); }
          rp.reactionMsg = m.id;
          rp.reactionMap = map;
        } else {
          e.setDescription(L(x.lc, 'Press a button to get or remove a role.', 'Pulsa un botón para obtener o quitarte un rol.'));
          const rows = [];
          for (let n = 0; n < roles.length; n += 5) {
            rows.push(new ActionRowBuilder().addComponents(roles.slice(n, n + 5).map((r) => new ButtonBuilder().setCustomId('rp:' + r.id).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
          }
          await ch.send({ embeds: [e], components: rows });
        }
        return L(x.lc, '✅ Panel posted.', '✅ Panel publicado.');
      },
    }],
  },
  {
    id: 'levels', ico: '📈', inst: false, n: ['Levels & activity', 'Niveles y actividad'], d: ['XP by chatting, level roles and an activity role. See it with $rank and $top', 'XP al chatear, roles por nivel y un rol por actividad. Se ve con $rank y $top'],
    on: ['levels', 'enabled'],
    filters: [{ k: 'announce', path: ['levels', 'announce'], n: ['Announce level ups', 'Anunciar subidas de nivel'] }],
    fields: [
      { k: 'min', path: ['levels', 'xpMin'], t: 'int', min: 1, max: 100, l: ['Minimum XP per message', 'XP mínimo por mensaje'] },
      { k: 'max', path: ['levels', 'xpMax'], t: 'int', min: 1, max: 200, l: ['Maximum XP per message', 'XP máximo por mensaje'] },
      { k: 'cool', path: ['levels', 'cooldownSec'], t: 'int', min: 5, max: 600, l: ['Cooldown (seconds)', 'Espera entre mensajes (segundos)'] },
      { k: 'rewards', path: ['levels', 'rewards'], t: 'list', max: 15, long: true, optional: true, l: ['Level roles: level:roleId, ...', 'Roles por nivel: nivel:IDdelRol, ...'] },
      { k: 'actmsgs', path: ['levels', 'activityMessages'], t: 'int', min: 0, max: 100000, l: ['Messages for activity role (0 = off)', 'Mensajes para el rol de actividad (0 = apagado)'] },
    ],
    pickers: [{ key: 'activityrole', type: 'role', n: ['Activity role', 'Rol de actividad'], set: (c, v) => (c.levels.activityRole = v[0]), show: (c) => (c.levels.activityRole ? '<@&' + c.levels.activityRole + '>' : '—') }],
    acts: [{
      key: 'top', n: ['Show top 10', 'Ver top 10'],
      run: async (x) => topText(x.g) || L(x.lc, 'Nobody has XP yet.', 'Nadie tiene XP todavía.'),
    }],
  },
];

function topText(g) {
  const gd = levels.data[g.id] || {};
  return Object.entries(gd).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, xp], n) => (n + 1) + '. ' + id + ' — nivel ' + lvlOf(xp) + ' (' + xp + ' XP)').join('\n');
}

/* ============================ comandos con prefijo ============================ */
function addCmd(c) {
  guard.CMDS.push(c);
  guard.BY_NAME.set(c.name, c);
}
addCmd({
  name: 'rank', level: 'public', d: 'Show your level', es: 'Muestra tu nivel',
  async run(ctx) {
    const xp = ((levels.data[ctx.guild.id] || {})[ctx.user.id]) || 0;
    const lv = lvlOf(xp);
    const next = (lv + 1) * (lv + 1) * 100;
    return ctx.reply('📈 <@' + ctx.user.id + '> — ' + L(ctx.locale, 'level ', 'nivel ') + lv + ' · ' + xp + '/' + next + ' XP');
  },
});
addCmd({
  name: 'top', level: 'public', d: 'Top 10 by XP', es: 'Top 10 por XP',
  async run(ctx) {
    const gd = levels.data[ctx.guild.id] || {};
    const t = Object.entries(gd).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, xp], n) => (n + 1) + '. <@' + id + '> — ' + L(ctx.locale, 'level ', 'nivel ') + lvlOf(xp) + ' (' + xp + ' XP)').join('\n');
    return ctx.reply(t || L(ctx.locale, 'Nobody has XP yet.', 'Nadie tiene XP todavía.'));
  },
});

/* ============================ roles seguros y temporales ============================ */
const tempStore = jsonStore('temproles.json', () => ({ list: [] }));
const actStore = jsonStore('activity.json', () => ({}));
const tkStore = jsonStore('tickets.json', () => ({}));

function safeRole(g, r) {
  return !!r && !r.managed && r.id !== g.id && !r.permissions.any(DANGEROUS) && r.comparePositionTo(g.members.me.roles.highest) < 0;
}

async function giveRoles(member, ids, hours, reason) {
  const g = member.guild;
  const ok = ids.filter((id) => safeRole(g, g.roles.cache.get(id)));
  if (!ok.length) return;
  await member.roles.add(ok, reason || 'Centinela').catch(() => {});
  if (hours > 0) {
    for (const r of ok) tempStore.data.list.push({ g: g.id, u: member.id, r, until: Date.now() + hours * 3600000 });
    tempStore.save();
  }
}

async function expireTemps(client) {
  const now = Date.now();
  const due = tempStore.data.list.filter((x) => x.until <= now);
  if (!due.length) return;
  tempStore.data.list = tempStore.data.list.filter((x) => x.until > now);
  tempStore.save();
  for (const x of due) {
    const g = client.guilds.cache.get(x.g);
    const m = g && (await g.members.fetch(x.u).catch(() => null));
    if (m && m.roles.cache.has(x.r)) await m.roles.remove(x.r, 'Centinela: rol temporal').catch(() => {});
  }
}

/* ============================ comandos con prefijo ============================ */
function addCmd(c) {
  guard.CMDS.push(c);
  guard.BY_NAME.set(c.name, c);
}
addCmd({
  name: 'rank', level: 'public', d: 'Show your level', es: 'Muestra tu nivel',
  async run(ctx) {
    const xp = ((levels.data[ctx.guild.id] || {})[ctx.user.id]) || 0;
    const lv = lvlOf(xp);
    const next = (lv + 1) * (lv + 1) * 100;
    return ctx.reply('📈 <@' + ctx.user.id + '> — ' + L(ctx.locale, 'level ', 'nivel ') + lv + ' · ' + xp + '/' + next + ' XP');
  },
});
addCmd({
  name: 'top', level: 'public', d: 'Top 10 by XP', es: 'Top 10 por XP',
  async run(ctx) {
    const gd = levels.data[ctx.guild.id] || {};
    const t = Object.entries(gd).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, xp], n) => (n + 1) + '. <@' + id + '> — ' + L(ctx.locale, 'level ', 'nivel ') + lvlOf(xp) + ' (' + xp + ' XP)').join('\n');
    return ctx.reply(t || L(ctx.locale, 'Nobody has XP yet.', 'Nadie tiene XP todavía.'));
  },
});

/* ============================ mensajes ============================ */
const xpSeen = new Map();
async function onMessage(msg) {
  if (!msg.guild || !msg.author || msg.author.bot || !msg.member) return;
  const cfg = getCfg(msg.guild.id);
  const content = msg.content || '';

  const bw = cfg.badWords;
  if (bw.enabled && bw.words.length && content && !isTrusted(msg.guild, msg.author.id, cfg) && !isStaff(msg.member) && !cfg.exemptChannels.includes(msg.channelId)) {
    const low = content.toLowerCase();
    const hit = bw.words.find((w) => w && new RegExp('(^|[^\\p{L}\\p{N}])' + esc(w.toLowerCase()) + '($|[^\\p{L}\\p{N}])', 'u').test(low));
    if (hit) {
      await msg.delete().catch(() => {});
      if (bw.action !== 'delete') await punishMember(msg.guild, msg.author.id, bw.action, 'Centinela: palabra prohibida', 5);
      msg.channel.send({ content: '🧼 <@' + msg.author.id + '>, ' + L(msg.guild.preferredLocale, 'that word is not allowed here.', 'esa palabra no está permitida aquí.'), allowedMentions: { users: [msg.author.id] } })
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
      return;
    }
  }

  const lv = cfg.levels;
  if (!lv.enabled || content.length <= 2) return;
  const key = msg.guild.id + ':' + msg.author.id;
  if (Date.now() - (xpSeen.get(key) || 0) < lv.cooldownSec * 1000) return;
  xpSeen.set(key, Date.now());
  const gd = levels.data[msg.guild.id] || (levels.data[msg.guild.id] = {});
  const before = gd[msg.author.id] || 0;
  const after = before + rnd(Math.min(lv.xpMin, lv.xpMax), Math.max(lv.xpMin, lv.xpMax));
  gd[msg.author.id] = after;
  levels.save();
  const newLv = lvlOf(after);
  if (newLv > lvlOf(before)) {
    if (lv.announce) msg.channel.send({ content: '🎉 <@' + msg.author.id + '> ' + L(msg.guild.preferredLocale, 'reached level ', 'subió al nivel ') + newLv + '!', allowedMentions: { users: [msg.author.id] } }).catch(() => {});
    const ids = lv.rewards.map((r) => String(r).split(':')).filter(([n, id]) => parseInt(n, 10) <= newLv && /^\d{15,25}$/.test(id || '') && !msg.member.roles.cache.has(id)).map(([, id]) => id);
    if (ids.length) await giveRoles(msg.member, ids, 0, 'Centinela: rol por nivel');
  }
  if (lv.activityRole && lv.activityMessages > 0) {
    const ad = actStore.data[msg.guild.id] || (actStore.data[msg.guild.id] = {});
    ad[msg.author.id] = (ad[msg.author.id] || 0) + 1;
    if (ad[msg.author.id] % 20 === 0) actStore.save();
    if (ad[msg.author.id] >= lv.activityMessages && !msg.member.roles.cache.has(lv.activityRole)) await giveRoles(msg.member, [lv.activityRole], 0, 'Centinela: rol por actividad');
  }
}

/* ============================ reacciones ============================ */
async function onReaction(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const msg = reaction.message;
  if (!msg.guild) return;
  const cfg = getCfg(msg.guild.id);
  const rp = cfg.rolePanel;
  if (!rp.reactionMsg || rp.reactionMsg !== msg.id) return;
  const rid = rp.reactionMap[reaction.emoji.toString()];
  if (!rid || !safeRole(msg.guild, msg.guild.roles.cache.get(rid))) return;
  const m = await msg.guild.members.fetch(user.id).catch(() => null);
  if (!m) return;
  if (add) await giveRoles(m, [rid], rp.tempHours, 'Centinela: reaction role');
  else await m.roles.remove(rid, 'Centinela: reaction role').catch(() => {});
}

/* ============================ tickets ============================ */
const EPH = 64;
const isTicketStaff = (i, cfg) => !!i.member && ((cfg.tickets.staffRole && i.member.roles.cache.has(cfg.tickets.staffRole)) || i.member.permissions.has(P.ManageChannels));

async function ticketLog(g, cfg, embed, files) {
  const id = cfg.tickets.logChannel;
  const ch = id && (g.channels.cache.get(id) || (await g.channels.fetch(id).catch(() => null)));
  if (ch && ch.isTextBased()) await ch.send({ embeds: [embed], files: files || [] }).catch(() => {});
}

function ticketButtons(lc, claimed) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tk:claim').setLabel(L(lc, 'Claim', 'Reclamar')).setEmoji('🙋').setStyle(ButtonStyle.Success).setDisabled(!!claimed),
    new ButtonBuilder().setCustomId('tk:add').setLabel(L(lc, 'Add user', 'Añadir usuario')).setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tk:rem').setLabel(L(lc, 'Remove user', 'Quitar usuario')).setEmoji('➖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tk:close').setLabel(L(lc, 'Close', 'Cerrar')).setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
}

async function openTicket(i, cfg, category) {
  const lc = i.locale;
  const g = i.guild;
  const t = cfg.tickets;
  const staff = t.staffRole && g.roles.cache.get(t.staffRole);
  if (!t.enabled || !staff) return i.reply({ content: L(lc, 'Tickets are not active.', 'Los tickets no están activos.'), flags: EPH });
  const mine = Object.entries(tkStore.data).filter(([cid, m]) => m.guild === g.id && m.opener === i.user.id && !m.closed && g.channels.cache.has(cid));
  if (mine.length >= t.perUser) return i.reply({ content: L(lc, 'You already have a ticket: ', 'Ya tienes un ticket: ') + '<#' + mine[0][0] + '>', flags: EPH });
  await i.deferReply({ flags: EPH });
  let cat = g.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Tickets');
  if (!cat) cat = await g.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, reason: 'Centinela' }).catch(() => null);
  const slug = (category || 'ticket').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'ticket';
  const ch = await g.channels.create({
    name: slug + '-' + i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18),
    type: ChannelType.GuildText,
    parent: cat ? cat.id : undefined,
    topic: 'ticket:' + i.user.id + ' · ' + category,
    reason: 'Centinela ticket',
    permissionOverwrites: [
      { id: g.id, type: 0, deny: [P.ViewChannel] },
      { id: i.user.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] },
      { id: staff.id, type: 0, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages] },
      { id: g.members.me.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.EmbedLinks, P.AttachFiles, P.ManageRoles] },
    ],
  }).catch((e) => { logErr(e); return null; });
  if (!ch) return i.editReply({ content: L(lc, '❌ I could not create the ticket (check my permissions).', '❌ No pude crear el ticket (revisa mis permisos).') });
  tkStore.data[ch.id] = { guild: g.id, opener: i.user.id, category, claimer: null, createdAt: Date.now(), closed: false, extra: [] };
  tkStore.save();
  const e = new EmbedBuilder().setColor(COLOR.blue).setTitle('🎫 ' + category).setDescription(L(lc, 'Describe your problem. The staff will answer soon.', 'Describe tu problema. El equipo te responderá pronto.'))
    .addFields({ name: L(lc, 'Opened by', 'Abierto por'), value: '<@' + i.user.id + '>', inline: true }, { name: L(lc, 'Category', 'Categoría'), value: category, inline: true });
  await ch.send({ content: '<@' + i.user.id + '> <@&' + staff.id + '>', embeds: [e], components: [ticketButtons(lc, false)] });
  ticketLog(g, cfg, new EmbedBuilder().setColor(COLOR.green).setTitle('🎫 ' + L(lc, 'Ticket opened', 'Ticket abierto')).setTimestamp().addFields({ name: L(lc, 'By', 'Por'), value: '<@' + i.user.id + '> (`' + i.user.id + '`)', inline: true }, { name: L(lc, 'Channel', 'Canal'), value: '<#' + ch.id + '>', inline: true }, { name: L(lc, 'Category', 'Categoría'), value: category, inline: true }));
  return i.editReply({ content: '✅ <#' + ch.id + '>' });
}

async function transcript(ch) {
  const all = [];
  let before;
  for (let n = 0; n < 5; n++) {
    const batch = await ch.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  all.reverse();
  const lines = all.map((m) => '[' + new Date(m.createdTimestamp).toISOString() + '] ' + m.author.tag + ': ' + (m.content || '') + (m.attachments.size ? ' ' + [...m.attachments.values()].map((a) => a.url).join(' ') : '') + (m.embeds.length && !m.content ? ' [embed]' : ''));
  return Buffer.from(lines.join('\n') || '(vacío)', 'utf8');
}

async function closeTicket(i, cfg, meta) {
  const lc = i.locale;
  const g = i.guild;
  const ch = i.channel;
  await i.deferReply();
  const buf = await transcript(ch);
  meta.closed = true;
  meta.closedBy = i.user.id;
  tkStore.save();
  await ch.permissionOverwrites.edit(meta.opener, { ViewChannel: false }).catch(() => {});
  await ticketLog(g, cfg, new EmbedBuilder().setColor(COLOR.red).setTitle('🔒 ' + L(lc, 'Ticket closed', 'Ticket cerrado')).setTimestamp().addFields(
    { name: L(lc, 'Opened by', 'Abierto por'), value: '<@' + meta.opener + '>', inline: true },
    { name: L(lc, 'Closed by', 'Cerrado por'), value: '<@' + i.user.id + '>', inline: true },
    { name: L(lc, 'Claimed by', 'Reclamado por'), value: meta.claimer ? '<@' + meta.claimer + '>' : '—', inline: true },
    { name: L(lc, 'Category', 'Categoría'), value: meta.category || '—', inline: true }
  ), [{ attachment: buf, name: 'transcript-' + ch.name + '.txt' }]);
  // Valoración por mensaje privado
  const opener = await g.members.fetch(meta.opener).catch(() => null);
  if (opener) {
    const row = new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map((n) => new ButtonBuilder().setCustomId('tk:rate:' + n + ':' + ch.id + ':' + g.id).setLabel('⭐'.repeat(n)).setStyle(ButtonStyle.Secondary)));
    opener.send({ content: L(lc, 'Your ticket in **' + g.name + '** was closed. How was the support?', 'Tu ticket en **' + g.name + '** fue cerrado. ¿Qué tal el soporte?'), components: [row] }).catch(() => {});
  }
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tk:reopen').setLabel(L(lc, 'Reopen', 'Reabrir')).setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('tk:delete').setLabel(L(lc, 'Delete channel', 'Eliminar canal')).setEmoji('🗑️').setStyle(ButtonStyle.Danger)
  );
  return i.editReply({ content: '🔒 ' + L(lc, 'Ticket closed by ', 'Ticket cerrado por ') + '<@' + i.user.id + '>.', components: [row2], allowedMentions: { parse: [] } });
}

async function handleTicket(i, cfg) {
  const id = i.customId;
  const lc = i.locale;
  const g = i.guild;
  const meta = tkStore.data[i.channelId];

  if (id === 'tk:open') return openTicket(i, cfg, (cfg.tickets.categories[0] || 'Soporte').slice(0, 100));
  if (id === 'tk:cat') return openTicket(i, cfg, i.values[0]);
  if (!meta) return i.reply({ content: L(lc, 'This is not an active ticket.', 'Este no es un ticket activo.'), flags: EPH });
  const staff = isTicketStaff(i, cfg);
  const mine = i.user.id === meta.opener;

  if (id === 'tk:claim') {
    if (!staff) return i.reply({ content: L(lc, '❌ Staff only.', '❌ Solo el equipo.'), flags: EPH });
    if (meta.claimer) return i.reply({ content: L(lc, 'Already claimed by ', 'Ya lo reclamó ') + '<@' + meta.claimer + '>', flags: EPH });
    meta.claimer = i.user.id;
    tkStore.save();
    await i.update({ components: [ticketButtons(lc, true)] });
    return i.channel.send({ content: '🙋 <@' + i.user.id + '> ' + L(lc, 'claimed this ticket.', 'reclamó este ticket.'), allowedMentions: { parse: [] } });
  }
  if (id === 'tk:close') {
    if (!staff && !mine) return i.reply({ content: L(lc, '❌ You cannot close this.', '❌ No puedes cerrar esto.'), flags: EPH });
    if (meta.closed) return i.reply({ content: L(lc, 'Already closed.', 'Ya está cerrado.'), flags: EPH });
    return closeTicket(i, cfg, meta);
  }
  if (id === 'tk:reopen') {
    if (!staff) return i.reply({ content: L(lc, '❌ Staff only.', '❌ Solo el equipo.'), flags: EPH });
    meta.closed = false;
    tkStore.save();
    await i.channel.permissionOverwrites.edit(meta.opener, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    await i.update({ components: [] });
    ticketLog(g, cfg, new EmbedBuilder().setColor(COLOR.orange).setTitle('🔓 ' + L(lc, 'Ticket reopened', 'Ticket reabierto')).setTimestamp().addFields({ name: L(lc, 'By', 'Por'), value: '<@' + i.user.id + '>', inline: true }, { name: L(lc, 'Channel', 'Canal'), value: '<#' + i.channelId + '>', inline: true }));
    return i.channel.send({ content: '🔓 <@' + meta.opener + '> ' + L(lc, 'your ticket was reopened.', 'tu ticket fue reabierto.') });
  }
  if (id === 'tk:delete') {
    if (!staff) return i.reply({ content: L(lc, '❌ Staff only.', '❌ Solo el equipo.'), flags: EPH });
    await i.reply(L(lc, '🗑️ Deleting in 5 seconds…', '🗑️ Eliminando en 5 segundos…'));
    delete tkStore.data[i.channelId];
    tkStore.save();
    const ch = i.channel;
    return setTimeout(() => ch.delete('Ticket eliminado por ' + i.user.tag).catch(() => {}), 5000);
  }
  if (id === 'tk:add' || id === 'tk:rem') {
    if (!staff) return i.reply({ content: L(lc, '❌ Staff only.', '❌ Solo el equipo.'), flags: EPH });
    const menu = new UserSelectMenuBuilder().setCustomId(id === 'tk:add' ? 'tk:addsel' : 'tk:remsel').setPlaceholder(id === 'tk:add' ? L(lc, 'Who do you want to add?', '¿A quién quieres añadir?') : L(lc, 'Who do you want to remove?', '¿A quién quieres quitar?')).setMinValues(1).setMaxValues(5);
    return i.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: EPH });
  }
  if (id === 'tk:addsel' || id === 'tk:remsel') {
    if (!staff) return i.reply({ content: L(lc, '❌ Staff only.', '❌ Solo el equipo.'), flags: EPH });
    for (const uid of i.values) {
      if (uid === meta.opener || uid === g.ownerId) continue;
      if (id === 'tk:addsel') await i.channel.permissionOverwrites.edit(uid, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
      else await i.channel.permissionOverwrites.delete(uid).catch(() => {});
    }
    await i.update({ content: '✅', components: [] });
    return i.channel.send({ content: (id === 'tk:addsel' ? '➕ ' : '➖ ') + i.values.map((u) => '<@' + u + '>').join(' '), allowedMentions: { parse: [] } });
  }
}

async function handleRating(i) {
  const [, , n, chId, gId] = i.customId.split(':');
  const g = i.client.guilds.cache.get(gId);
  const meta = tkStore.data[chId];
  if (meta && meta.rating) return i.update({ content: 'Gracias / Thanks 💙', components: [] });
  if (meta) { meta.rating = parseInt(n, 10); tkStore.save(); }
  if (g) {
    const cfg = getCfg(g.id);
    ticketLog(g, cfg, new EmbedBuilder().setColor(COLOR.blue).setTitle('⭐ ' + n + '/5').setTimestamp().addFields({ name: 'Ticket', value: '`' + chId + '`', inline: true }, { name: 'Usuario', value: '<@' + i.user.id + '>', inline: true }, { name: 'Soporte', value: meta && meta.claimer ? '<@' + meta.claimer + '>' : '—', inline: true }));
  }
  return i.update({ content: 'Gracias por tu valoración / Thanks for your rating: ' + '⭐'.repeat(parseInt(n, 10)), components: [] });
}

/* ============================ componentes (botones y menús) ============================ */
async function handleComponent(i) {
  const id = i.customId || '';
  if (id.startsWith('tk:rate:')) { await handleRating(i); return true; }
  if (!i.guild || !i.member) return false;
  const lc = i.locale;
  const cfg = getCfg(i.guild.id);

  if (id.startsWith('tk:')) { await handleTicket(i, cfg); return true; }

  if (id === 'rpm') {
    const rp = cfg.rolePanel;
    const chosen = new Set(i.values);
    const add = [];
    const rem = [];
    for (const rid of rp.roles) {
      if (!safeRole(i.guild, i.guild.roles.cache.get(rid))) continue;
      if (chosen.has(rid)) { if (!i.member.roles.cache.has(rid)) add.push(rid); } else if (i.member.roles.cache.has(rid)) rem.push(rid);
    }
    if (rem.length) await i.member.roles.remove(rem, 'Centinela role panel').catch(() => {});
    if (add.length) await giveRoles(i.member, add, rp.tempHours, 'Centinela role panel');
    await i.reply({ content: '✅ ' + L(lc, 'Roles updated.', 'Roles actualizados.'), flags: EPH });
    return true;
  }

  if (id.startsWith('rp:')) {
    const rid = id.slice(3);
    const role = i.guild.roles.cache.get(rid);
    if (!cfg.rolePanel.roles.includes(rid) || !safeRole(i.guild, role)) {
      await i.reply({ content: L(lc, '❌ That role is not available.', '❌ Ese rol no está disponible.'), flags: EPH });
      return true;
    }
    const has = i.member.roles.cache.has(rid);
    try {
      if (has) await i.member.roles.remove(rid, 'Centinela role panel');
      else await giveRoles(i.member, [rid], cfg.rolePanel.tempHours, 'Centinela role panel');
      await i.reply({ content: (has ? '➖ ' : '➕ ') + role.name, flags: EPH });
    } catch (_) {
      await i.reply({ content: L(lc, '❌ I could not change that role.', '❌ No pude cambiar ese rol.'), flags: EPH });
    }
    return true;
  }
  return false;
}

function attach(client) {
  client.on('messageCreate', (m) => onMessage(m).catch(logErr));
  client.on('messageReactionAdd', (r, u) => onReaction(r, u, true).catch(logErr));
  client.on('messageReactionRemove', (r, u) => onReaction(r, u, false).catch(logErr));
  const t = setInterval(() => expireTemps(client).catch(logErr), 60000);
  if (t.unref) t.unref();
}

module.exports = { mods, attach, handleComponent, giveRoles };
