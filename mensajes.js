'use strict';

/*
 * mensajes.js — /enviarmensaje: escribe un mensaje y el bot lo manda por MD (mensaje directo) a todos los miembros del servidor.
 *
 * Flujo: /enviarmensaje → cuadro con título (opcional), mensaje y botón con enlace (opcional)
 *        → vista previa exacta + cuántos lo recibirán → «Enviar a todos» (o «Enviarme una prueba»).
 *
 * · El mensaje admite el formato de Discord (negrita, listas, citas…) y enlaces de todo tipo: https://…, [texto](https://…)
 *   y un botón con enlace. Variables: {user} (menciona a quien lo recibe), {username} y {server}.
 * · Lo puede lanzar el dueño o un Administrador.
 * · Va despacio a propósito (≈2 s por persona) y se frena solo si Discord lo pide: los envíos masivos rápidos
 *   hacen que Discord marque al bot. Un servidor grande tarda; el progreso se ve en vivo y se puede parar.
 * · Cada mensaje dice de qué servidor viene y lleva «No recibir más»: quien lo pulsa no vuelve a recibir envíos masivos de ese servidor.
 * · Si se repite el mismo mensaje (por ejemplo tras un reinicio) se salta a quien ya lo recibió.
 * · Deja constancia en los registros del servidor y avisa por MD de cómo terminó.
 */

const crypto = require('crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');

const { L, getCfg, jsonStore, fmt, COLOR, logErr } = bot;
const EPH = MessageFlags.Ephemeral;
const es2 = (s) => ({ 'es-ES': s, 'es-419': s });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// Tiempos (ms). Se exponen para poder probarlos sin esperar.
const T = { delay: 1500, jitter: 700, backoff: 60000, progress: 5000, pendingTtl: 10 * 60 * 1000, keepSent: 5, keepDays: 14 };

const store = jsonStore('mensajes.json', () => ({ optout: {}, sent: {} }));
function S() {
  const d = store.data;
  d.optout = d.optout || {};
  d.sent = d.sent || {};
  return d;
}

const pending = new Map(); // id -> { gid, uid, title, text, btn, exp }
const jobs = new Map(); // gid -> job
const isAdmin = (member, g) => !!member && (member.id === g.ownerId || member.permissions.has(P.Administrator));
const hashOf = (m) => crypto.createHash('sha1').update(JSON.stringify([m.title, m.text, m.btn])).digest('hex').slice(0, 12);

/* ============================ mensaje ============================ */
// «Texto | https://enlace» o solo «https://enlace». null = vacío, false = enlace no válido
function parseButton(raw) {
  raw = String(raw || '').trim();
  if (!raw) return null;
  const k = raw.indexOf('|');
  const label = k >= 0 ? raw.slice(0, k).trim() : '';
  let url = (k >= 0 ? raw.slice(k + 1) : raw).trim();
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    url = u.toString();
  } catch (_) { return false; }
  if (url.length > 512) return false;
  return { label: clip(label || 'Abrir enlace', 80), url };
}

function colorOf(g) {
  const hex = String((getCfg(g.id).ui || {}).color || '').replace('#', '');
  return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : COLOR.blue;
}

// Lo que recibe cada persona (target = su miembro; en la vista previa, quien lo escribe)
function build(g, m, target) {
  const lc = g.preferredLocale;
  const vars = { user: target ? '<@' + target.id + '>' : '', username: target && target.user ? target.user.username : '', server: g.name };
  const e = new EmbedBuilder()
    .setColor(colorOf(g))
    .setDescription(clip(fmt(m.text, vars), 4096))
    .setFooter({ text: L(lc, 'Message from the team of ', 'Mensaje del equipo de ') + g.name })
    .setTimestamp();
  if (m.title) e.setTitle(clip(fmt(m.title, vars), 256));
  const icon = typeof g.iconURL === 'function' ? g.iconURL({ size: 64 }) : null;
  e.setAuthor(icon ? { name: g.name, iconURL: icon } : { name: g.name });
  const row = new ActionRowBuilder();
  if (m.btn) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(m.btn.label).setURL(m.btn.url));
  row.addComponents(new ButtonBuilder().setCustomId('enviar:out:' + g.id).setLabel(L(lc, 'Stop receiving these', 'No recibir más')).setEmoji('🔕').setStyle(ButtonStyle.Secondary));
  return { embeds: [e], components: [row] };
}

/* ============================ destinatarios ============================ */
async function humans(g) {
  let complete = true;
  try { await g.members.fetch(); } catch (e) { complete = false; logErr('mensajes: no pude traer todos los miembros: ' + e.message); }
  return { list: [...g.members.cache.values()].filter((x) => !x.user.bot), complete };
}

function recipients(all, g, sender, hash) {
  const d = S();
  const out = new Set(d.optout[g.id] || []);
  const done = new Set((((d.sent[g.id] || {})[hash]) || {}).ids || []);
  const list = all.filter((x) => x.id !== sender.id && !out.has(x.id) && !done.has(x.id));
  return { list, optedOut: all.filter((x) => out.has(x.id)).length, already: all.filter((x) => done.has(x.id) && !out.has(x.id)).length };
}

const minutes = (n) => Math.max(1, Math.ceil((n * (T.delay + T.jitter / 2)) / 60000));

/* ============================ pantallas ============================ */
function previewView(g, p, id, info, complete) {
  const lc = g.preferredLocale;
  const note =
    '📨 ' + L(lc, '**Preview** — this is exactly what each member will get by DM.', '**Vista previa** — así lo recibirá cada miembro por MD.') + '\n' +
    L(lc, 'It will go to **' + info.list.length + '** members', 'Se enviará a **' + info.list.length + '** miembros') +
    (info.list.length ? ' (≈ ' + minutes(info.list.length) + ' min)' : '') + '.' +
    (info.already ? '\n↩️ ' + L(lc, info.already + ' already got this exact message and are skipped.', info.already + ' ya recibieron este mismo mensaje y se saltan.') : '') +
    (info.optedOut ? '\n🔕 ' + L(lc, info.optedOut + ' asked not to receive these.', info.optedOut + ' pidieron no recibir más.') : '') +
    (complete ? '' : '\n⚠️ ' + L(lc, "I can only see part of the members (turn on the Server Members Intent for the bot).", 'Solo veo a una parte de los miembros (activa el Server Members Intent del bot).'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('enviar:go:' + id).setLabel(L(lc, 'Send to everyone', 'Enviar a todos')).setEmoji('📨').setStyle(ButtonStyle.Danger).setDisabled(!info.list.length),
    new ButtonBuilder().setCustomId('enviar:test:' + id).setLabel(L(lc, 'Send me a test', 'Enviarme una prueba')).setEmoji('🧪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('enviar:no:' + id).setLabel(L(lc, 'Cancel', 'Cancelar')).setStyle(ButtonStyle.Secondary)
  );
  const pv = build(g, p, g.members.cache.get(p.uid));
  // La vista previa no lleva el botón «No recibir más» real (es solo una imagen de cómo queda)
  return { content: note, embeds: pv.embeds, components: [row] };
}

function bar(done, total) {
  const n = total ? Math.round((done / total) * 12) : 12;
  return '▰'.repeat(n) + '▱'.repeat(12 - n);
}

function progressView(g, job, final) {
  const lc = g.preferredLocale;
  const done = job.sent + job.closed + job.failed;
  const e = new EmbedBuilder()
    .setColor(final ? (job.abort ? COLOR.red : COLOR.green) : COLOR.blue)
    .setTitle((final ? (job.abort ? '⚠️ ' : job.stop ? '⏹️ ' : '✅ ') : '📨 ') + (final ? (job.abort ? L(lc, 'Stopped', 'Detenido') : job.stop ? L(lc, 'Stopped by you', 'Parado por ti') : L(lc, 'Done', 'Terminado')) : L(lc, 'Sending…', 'Enviando…')))
    .setDescription(
      bar(done, job.total) + ' **' + done + '/' + job.total + '**\n' +
      '✅ ' + L(lc, 'Delivered: ', 'Entregados: ') + job.sent + '\n' +
      '🔒 ' + L(lc, 'DMs closed: ', 'Con MD cerrado: ') + job.closed + '\n' +
      '⚠️ ' + L(lc, 'Failed: ', 'Fallidos: ') + job.failed +
      (job.abort ? '\n\n' + job.abort : '') +
      (final && job.stop && !job.abort ? '\n\n' + L(lc, 'Send the same message again to continue with whoever is missing.', 'Vuelve a enviar el mismo mensaje para seguir con quienes faltan.') : '')
    );
  if (final) return { content: '', embeds: [e], components: [] };
  return { content: '', embeds: [e], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('enviar:stop:' + g.id).setLabel(L(lc, 'Stop', 'Parar')).setEmoji('⏹️').setStyle(ButtonStyle.Secondary))] };
}

/* ============================ comando ============================ */
const command = {
  data: new SlashCommandBuilder()
    .setName('enviarmensaje')
    .setDescription('Write a message and send it by DM to every member of the server (links and formatting allowed)')
    .setDescriptionLocalizations(es2('Escribe un mensaje y envíalo por MD a todos los miembros del servidor (admite enlaces y formato)'))
    .setDMPermission(false)
    .setDefaultMemberPermissions(P.Administrator),
  async execute(i) {
    const g = i.guild;
    if (!g) return;
    const lc = g.preferredLocale;
    if (!isAdmin(i.member, g)) return i.reply({ content: L(lc, '❌ You need the **Administrator** permission.', '❌ Necesitas el permiso de **Administrador**.'), flags: EPH });
    const cur = jobs.get(g.id);
    if (cur && cur.running) return i.reply({ content: '⏳ ' + L(lc, 'A message is already being sent: ', 'Ya hay un envío en marcha: ') + (cur.sent + cur.closed + cur.failed) + '/' + cur.total + '.', flags: EPH });
    const modal = new ModalBuilder().setCustomId('enviar:modal').setTitle(L(lc, 'Message to every member', 'Mensaje para todos los miembros'))
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('titulo').setLabel(L(lc, 'Title (optional)', 'Título (opcional)')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('texto').setLabel(L(lc, 'Message (links and **bold** work)', 'Mensaje (valen enlaces y **negrita**)')).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setPlaceholder(L(lc, 'Hi {user}! Join our event: [click here](https://example.com)', '¡Hola {user}! Únete a nuestro evento: [pulsa aquí](https://ejemplo.com)'))),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('boton').setLabel(L(lc, 'Link button (optional)', 'Botón con enlace (opcional)')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setPlaceholder(L(lc, 'Text | https://link   e.g. Join | https://discord.gg/...', 'Texto | https://enlace   ej. Unirme | https://discord.gg/...')))
      );
    return i.showModal(modal);
  },
};

/* ============================ interacciones ============================ */
const owns = (i) => !!(i.customId && String(i.customId).startsWith('enviar:'));

async function handle(i) {
  const id = String(i.customId);
  if (id.startsWith('enviar:out:')) return optOut(i);
  const g = i.guild;
  if (!g) return;
  if (id === 'enviar:modal' && i.isModalSubmit && i.isModalSubmit()) return onModal(i);
  const [, act, key] = id.split(':');
  const lc = g.preferredLocale;
  if (act === 'stop') {
    const job = jobs.get(key);
    if (job && job.running && isAdmin(i.member, g)) { job.stop = true; return i.reply({ content: '⏹️ ' + L(lc, 'Stopping after the current member…', 'Parando tras el miembro actual…'), flags: EPH }); }
    return i.reply({ content: L(lc, 'Nothing to stop.', 'No hay nada que parar.'), flags: EPH });
  }
  const p = pending.get(key);
  if (!p || p.exp < Date.now()) { pending.delete(key); return i.update({ content: '⌛ ' + L(lc, 'That draft expired. Use /enviarmensaje again.', 'Ese borrador caducó. Usa /enviarmensaje otra vez.'), embeds: [], components: [] }); }
  if (i.user.id !== p.uid) return i.reply({ content: L(lc, '❌ Only who wrote it can send it.', '❌ Solo quien lo escribió puede enviarlo.'), flags: EPH });
  if (!isAdmin(i.member, g)) return i.reply({ content: L(lc, '❌ You need the **Administrator** permission.', '❌ Necesitas el permiso de **Administrador**.'), flags: EPH });
  if (act === 'no') { pending.delete(key); return i.update({ content: '❌ ' + L(lc, 'Cancelled. Nothing was sent.', 'Cancelado. No se envió nada.'), embeds: [], components: [] }); }
  if (act === 'test') {
    try { await i.user.send(build(g, p, i.member)); return i.reply({ content: '🧪 ' + L(lc, 'Sent to your DMs.', 'Te la mandé por MD.'), flags: EPH }); } catch (_) {
      return i.reply({ content: '❌ ' + L(lc, "I can't DM you: open your DMs from this server.", 'No puedo escribirte por MD: abre tus mensajes directos de este servidor.'), flags: EPH });
    }
  }
  if (act === 'go') return start(i, g, p, key);
}

async function onModal(i) {
  const g = i.guild;
  const lc = g.preferredLocale;
  if (!isAdmin(i.member, g)) return i.reply({ content: L(lc, '❌ You need the **Administrator** permission.', '❌ Necesitas el permiso de **Administrador**.'), flags: EPH });
  const text = String(i.fields.getTextInputValue('texto') || '').trim();
  const title = String(i.fields.getTextInputValue('titulo') || '').trim();
  const btn = parseButton(i.fields.getTextInputValue('boton'));
  if (!text) return i.reply({ content: L(lc, '❌ The message is empty.', '❌ El mensaje está vacío.'), flags: EPH });
  if (btn === false) return i.reply({ content: '❌ ' + L(lc, 'The button link is not valid. Use `Text | https://link` (it must start with https://).', 'El enlace del botón no es válido. Usa `Texto | https://enlace` (debe empezar por https://).'), flags: EPH });
  await i.deferReply({ flags: EPH });
  const p = { gid: g.id, uid: i.user.id, title, text, btn, exp: Date.now() + T.pendingTtl };
  p.hash = hashOf(p);
  const key = crypto.randomBytes(5).toString('hex');
  pending.set(key, p);
  const { list, complete } = await humans(g);
  const info = recipients(list, g, i.member, p.hash);
  return i.editReply(previewView(g, p, key, info, complete));
}

async function optOut(i) {
  const gid = String(i.customId).split(':')[2];
  const d = S();
  const set = new Set(d.optout[gid] || []);
  set.add(i.user.id);
  d.optout[gid] = [...set];
  store.save();
  const name = (i.client && i.client.guilds && i.client.guilds.cache.get(gid) && i.client.guilds.cache.get(gid).name) || '';
  const lc = (i.client && i.client.guilds && i.client.guilds.cache.get(gid) && i.client.guilds.cache.get(gid).preferredLocale) || i.locale;
  return i.reply({ content: '🔕 ' + L(lc, "Done. You won't get more mass messages" + (name ? ' from **' + name + '**' : '') + '.', 'Listo. No recibirás más mensajes masivos' + (name ? ' de **' + name + '**' : '') + '.'), flags: EPH });
}

/* ============================ envío ============================ */
async function start(i, g, p, key) {
  const lc = g.preferredLocale;
  const cur = jobs.get(g.id);
  if (cur && cur.running) return i.reply({ content: '⏳ ' + L(lc, 'A message is already being sent.', 'Ya hay un envío en marcha.'), flags: EPH });
  await i.deferUpdate(); // traer a todos los miembros puede tardar más de 3 s
  let q = Promise.resolve();
  const edit = (payload) => { q = q.then(() => i.editReply(payload).catch(() => {})); return q; };
  const { list: all } = await humans(g);
  const info = recipients(all, g, i.member, p.hash);
  if (!info.list.length) return edit({ content: L(lc, 'There is nobody left to send it to.', 'No queda nadie a quien enviárselo.'), embeds: [], components: [] });
  const again = jobs.get(g.id);
  if (again && again.running) return edit({ content: '⏳ ' + L(lc, 'A message is already being sent.', 'Ya hay un envío en marcha.'), embeds: [], components: [] });
  pending.delete(key);
  const job = { gid: g.id, total: info.list.length, sent: 0, closed: 0, failed: 0, running: true, stop: false, abort: null, hash: p.hash };
  jobs.set(g.id, job);
  await edit(progressView(g, job, false));
  const iv = setInterval(() => { if (job.running) edit(progressView(g, job, false)); }, T.progress);
  if (iv.unref) iv.unref();
  run(g, p, info.list, job)
    .catch((e) => { logErr(e); job.abort = '❌ ' + e.message; })
    .then(async () => {
      clearInterval(iv);
      job.running = false;
      const view = progressView(g, job, true);
      await edit(view);
      await i.user.send({ embeds: view.embeds }).catch(() => {}); // la ventana de edición dura 15 min: el informe también llega por MD
      try {
        await bot.sendLog(g, 'server', bot.mkEmbed(g, COLOR.blue, L(lc, '📨 Mass message', '📨 Mensaje masivo'), null, [
          [L(lc, 'By', 'Por'), '<@' + i.user.id + '>'], [L(lc, 'Delivered', 'Entregados'), job.sent], [L(lc, 'Closed / failed', 'Cerrados / fallidos'), job.closed + ' / ' + job.failed],
        ]));
      } catch (_) { /* sin registros */ }
    });
}

async function run(g, p, list, job) {
  const d = S();
  const perGuild = (d.sent[g.id] = d.sent[g.id] || {});
  const rec = (perGuild[job.hash] = perGuild[job.hash] || { at: Date.now(), ids: [] });
  rec.at = Date.now();
  let frozen = 0; // «abriendo MD demasiado rápido» seguidos
  let sinceSave = 0;
  for (const member of list) {
    if (job.stop) break;
    let tries = 0;
    for (;;) {
      try {
        await member.send(build(g, p, member));
        job.sent++;
        rec.ids.push(member.id);
        frozen = 0;
        break;
      } catch (e) {
        const code = e && e.code;
        if (code === 50007) { job.closed++; break; } // tiene los MD cerrados
        if (code === 40003 && tries < 2) { // Discord pide ir más despacio
          tries++;
          if (++frozen >= 3) { job.abort = '⚠️ ' + L(g.preferredLocale, 'Discord keeps asking me to slow down, so I stopped. Try again later.', 'Discord me sigue pidiendo ir más despacio, así que paré. Inténtalo más tarde.'); break; }
          await sleep(T.backoff);
          continue;
        }
        if (code === 40002 || code === 20026) { job.abort = '⚠️ ' + L(g.preferredLocale, 'Discord is blocking this bot from sending DMs (code ' + code + '), so I stopped.', 'Discord bloquea a este bot para mandar MD (código ' + code + '), así que paré.'); break; }
        job.failed++;
        break;
      }
    }
    if (job.abort) break;
    if (++sinceSave >= 25) { sinceSave = 0; store.save(); }
    await sleep(T.delay + Math.random() * T.jitter);
  }
  // Limpieza: se guardan solo los últimos envíos
  const cutoff = Date.now() - T.keepDays * 86400000;
  const keys = Object.keys(perGuild).sort((a, b) => perGuild[b].at - perGuild[a].at);
  for (const [n, k] of keys.entries()) if (n >= T.keepSent || perGuild[k].at < cutoff) delete perGuild[k];
  store.save();
}

module.exports = { commands: [command], handle, owns, parseButton, build, _t: T, _jobs: jobs, _store: store };
