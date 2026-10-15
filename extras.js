'use strict';

/*
 * extras.js — Funciones extra: palabras prohibidas, tickets, roles por botones y niveles.
 * Sus módulos usan el mismo esquema que ui.js, así aparecen en /help y en el panel web.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: P } = require('discord.js');
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
    id: 'tickets', ico: '🎫', inst: false, n: ['Tickets', 'Tickets'], d: ['A button opens a private channel with your staff', 'Un botón abre un canal privado con tu equipo'],
    get: (c) => c.tickets.enabled,
    set: (c, v) => {
      if (v && (!c.tickets.channel || !c.tickets.staffRole)) throw new Error('need-verify');
      c.tickets.enabled = v;
    },
    pickers: [
      { key: 'channel', type: 'channel', n: ['Channel for the ticket button', 'Canal del botón de tickets'], set: (c, v) => (c.tickets.channel = v[0]), show: (c) => (c.tickets.channel ? '<#' + c.tickets.channel + '>' : '—') },
      { key: 'staff', type: 'role', n: ['Staff role', 'Rol del equipo'], set: (c, v) => (c.tickets.staffRole = v[0]), show: (c) => (c.tickets.staffRole ? '<@&' + c.tickets.staffRole + '>' : '—') },
    ],
    acts: [{
      key: 'panel', n: ['Post ticket panel', 'Publicar panel de tickets'],
      run: async (x) => {
        const ch = x.cfg.tickets.channel && x.g.channels.cache.get(x.cfg.tickets.channel);
        if (!ch) throw new Error(L(x.lc, 'Pick a channel first.', 'Elige primero un canal.'));
        const e = new EmbedBuilder().setColor(COLOR.blue).setTitle('🎫 ' + L(x.lc, 'Support', 'Soporte')).setDescription(L(x.lc, 'Press the button to open a private ticket with the staff.', 'Pulsa el botón para abrir un ticket privado con el equipo.'));
        await ch.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tk:open').setLabel(L(x.lc, 'Open ticket', 'Abrir ticket')).setEmoji('🎫').setStyle(ButtonStyle.Primary))] });
        return L(x.lc, '✅ Panel posted.', '✅ Panel publicado.');
      },
    }],
  },
  {
    id: 'rolepanel', ico: '🎛️', inst: false, n: ['Button roles', 'Roles por botones'], d: ['Members pick their own roles with buttons (up to 10)', 'Los miembros eligen sus roles con botones (hasta 10)'],
    pickers: [
      { key: 'channel', type: 'channel', n: ['Panel channel', 'Canal del panel'], set: (c, v) => (c.rolePanel.channel = v[0]), show: (c) => (c.rolePanel.channel ? '<#' + c.rolePanel.channel + '>' : '—') },
      { key: 'roles', type: 'role', multi: true, n: ['Roles offered (max 10)', 'Roles ofrecidos (máx. 10)'], set: (c, v) => (c.rolePanel.roles = v.slice(0, 10)), show: (c) => c.rolePanel.roles.map((i) => '<@&' + i + '>').join(' ') || '—' },
    ],
    acts: [{
      key: 'panel', n: ['Post role panel', 'Publicar panel de roles'],
      run: async (x) => {
        const rp = x.cfg.rolePanel;
        const ch = rp.channel && x.g.channels.cache.get(rp.channel);
        const roles = rp.roles.map((id) => x.g.roles.cache.get(id)).filter((r) => r && !r.managed && !r.permissions.any(DANGEROUS));
        if (!ch || !roles.length) throw new Error(L(x.lc, 'Pick a channel and safe roles (no dangerous permissions).', 'Elige un canal y roles seguros (sin permisos peligrosos).'));
        const rows = [];
        for (let n = 0; n < roles.length; n += 5) {
          rows.push(new ActionRowBuilder().addComponents(roles.slice(n, n + 5).map((r) => new ButtonBuilder().setCustomId('rp:' + r.id).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
        }
        const e = new EmbedBuilder().setColor(COLOR.blue).setTitle('🎛️ ' + L(x.lc, 'Pick your roles', 'Elige tus roles')).setDescription(L(x.lc, 'Press a button to get or remove a role.', 'Pulsa un botón para obtener o quitarte un rol.'));
        await ch.send({ embeds: [e], components: rows });
        return L(x.lc, '✅ Panel posted.', '✅ Panel publicado.');
      },
    }],
  },
  {
    id: 'levels', ico: '📈', inst: false, n: ['Levels', 'Niveles'], d: ['Members earn XP by chatting. See it with $rank and $top', 'Los miembros ganan XP al chatear. Se ve con $rank y $top'],
    on: ['levels', 'enabled'],
    filters: [{ k: 'announce', path: ['levels', 'announce'], n: ['Announce level ups', 'Anunciar subidas de nivel'] }],
    fields: [
      { k: 'min', path: ['levels', 'xpMin'], t: 'int', min: 1, max: 100, l: ['Minimum XP per message', 'XP mínimo por mensaje'] },
      { k: 'max', path: ['levels', 'xpMax'], t: 'int', min: 1, max: 200, l: ['Maximum XP per message', 'XP máximo por mensaje'] },
      { k: 'cool', path: ['levels', 'cooldownSec'], t: 'int', min: 5, max: 600, l: ['Cooldown (seconds)', 'Espera entre mensajes (segundos)'] },
    ],
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

/* ============================ eventos ============================ */
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
  if (lv.enabled && content.length > 2) {
    const key = msg.guild.id + ':' + msg.author.id;
    if (Date.now() - (xpSeen.get(key) || 0) >= lv.cooldownSec * 1000) {
      xpSeen.set(key, Date.now());
      const gd = levels.data[msg.guild.id] || (levels.data[msg.guild.id] = {});
      const before = gd[msg.author.id] || 0;
      const after = before + rnd(Math.min(lv.xpMin, lv.xpMax), Math.max(lv.xpMin, lv.xpMax));
      gd[msg.author.id] = after;
      levels.save();
      if (lv.announce && lvlOf(after) > lvlOf(before)) {
        msg.channel.send({ content: '🎉 <@' + msg.author.id + '> ' + L(msg.guild.preferredLocale, 'reached level ', 'subió al nivel ') + lvlOf(after) + '!', allowedMentions: { users: [msg.author.id] } }).catch(() => {});
      }
    }
  }
}

const EPH = 64;
async function handleButton(i) {
  const id = i.customId || '';
  if (!i.guild || !i.member) return false;
  const lc = i.locale;
  const cfg = getCfg(i.guild.id);

  if (id === 'tk:open') {
    const t = cfg.tickets;
    const staff = t.staffRole && i.guild.roles.cache.get(t.staffRole);
    if (!t.enabled || !staff) { await i.reply({ content: L(lc, 'Tickets are not active.', 'Los tickets no están activos.'), flags: EPH }); return true; }
    const open = i.guild.channels.cache.find((c) => c.topic === 'ticket:' + i.user.id);
    if (open) { await i.reply({ content: L(lc, 'You already have a ticket: ', 'Ya tienes un ticket: ') + '<#' + open.id + '>', flags: EPH }); return true; }
    let cat = i.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Tickets');
    if (!cat) cat = await i.guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, reason: 'Centinela' }).catch(() => null);
    const ch = await i.guild.channels.create({
      name: 'ticket-' + i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20),
      type: ChannelType.GuildText,
      parent: cat ? cat.id : undefined,
      topic: 'ticket:' + i.user.id,
      reason: 'Centinela ticket',
      permissionOverwrites: [
        { id: i.guild.id, type: 0, deny: [P.ViewChannel] },
        { id: i.user.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] },
        { id: staff.id, type: 0, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages] },
        { id: i.guild.members.me.id, type: 1, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.EmbedLinks] },
      ],
    }).catch((e) => { logErr(e); return null; });
    if (!ch) { await i.reply({ content: L(lc, '❌ I could not create the ticket (check my permissions).', '❌ No pude crear el ticket (revisa mis permisos).'), flags: EPH }); return true; }
    const e = new EmbedBuilder().setColor(COLOR.blue).setTitle('🎫 Ticket').setDescription(L(lc, 'Describe your problem. The staff will answer soon.', 'Describe tu problema. El equipo te responderá pronto.'));
    await ch.send({ content: '<@' + i.user.id + '> <@&' + staff.id + '>', embeds: [e], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tk:close').setLabel(L(lc, 'Close ticket', 'Cerrar ticket')).setEmoji('🔒').setStyle(ButtonStyle.Danger))] });
    await i.reply({ content: '✅ <#' + ch.id + '>', flags: EPH });
    return true;
  }

  if (id === 'tk:close') {
    const ch = i.channel;
    const owner = ch && ch.topic && ch.topic.startsWith('ticket:') ? ch.topic.slice(7) : null;
    const staffRole = cfg.tickets.staffRole;
    const ok = owner && (i.user.id === owner || (staffRole && i.member.roles.cache.has(staffRole)) || i.member.permissions.has(P.ManageChannels));
    if (!ok) { await i.reply({ content: L(lc, '❌ You cannot close this.', '❌ No puedes cerrar esto.'), flags: EPH }); return true; }
    await i.reply(L(lc, '🔒 Closing in 5 seconds…', '🔒 Cerrando en 5 segundos…'));
    setTimeout(() => ch.delete('Ticket cerrado por ' + i.user.tag).catch(() => {}), 5000);
    return true;
  }

  if (id.startsWith('rp:')) {
    const rid = id.slice(3);
    const role = i.guild.roles.cache.get(rid);
    if (!cfg.rolePanel.roles.includes(rid) || !role || role.managed || role.permissions.any(DANGEROUS) || role.comparePositionTo(i.guild.members.me.roles.highest) >= 0) {
      await i.reply({ content: L(lc, '❌ That role is not available.', '❌ Ese rol no está disponible.'), flags: EPH });
      return true;
    }
    const has = i.member.roles.cache.has(rid);
    try {
      if (has) await i.member.roles.remove(rid, 'Centinela role panel');
      else await i.member.roles.add(rid, 'Centinela role panel');
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
}

module.exports = { mods, attach, handleButton };
