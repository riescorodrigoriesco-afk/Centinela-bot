'use strict';

/*
 * sugerencias.js — Avisos de «Sugerencia» al dueño cuando algo del servidor está incompleto.
 *
 * Revisa lo que el bot tiene configurado (bienvenidas, despedidas, tickets, roles por botones, autoroles,
 * verificación, registros) y los canales de reglas, y si algo está roto o a medias (el canal o el rol ya no existe,
 * el bot no puede escribir allí, falta el panel con los botones, el canal de reglas está vacío…)
 * menciona al dueño con «💡 Sugerencia» en el chat del equipo (o en el mejor canal disponible; si no, por MD).
 *
 * Cuándo revisa: al borrarse un canal o rol que estaba configurado, cada 6 horas y al terminar /hacer.
 * No repite el mismo aviso hasta pasados 7 días (si se arregla y vuelve a romperse, avisa de nuevo).
 */

const { ChannelType: CT, PermissionFlagsBits: P } = require('discord.js');
const bot = require('./bot');

const { getCfg, jsonStore, GL, logErr } = bot;

const store = jsonStore('sugerencias.json', () => ({}));
const COOLDOWN = 7 * 24 * 3600 * 1000;
const SWEEP_EVERY = 6 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/* ============================ revisión ============================ */
// Devuelve [{ key, text }]: key identifica el problema (para no repetirlo), text es el aviso ya en el idioma del servidor
async function audit(g) {
  const out = [];
  const me = g.members && g.members.me;
  if (!me) return out;
  const cfg = getCfg(g.id);
  const add = (key, en, es) => out.push({ key, text: GL(g, en, es) });
  const chan = (id) => (id ? g.channels.cache.get(id) : null);
  const role = (id) => (id ? g.roles.cache.get(id) : null);
  const canPost = (c, extra = []) => {
    const p = c.permissionsFor(me);
    return !!p && p.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, ...extra]);
  };
  // ¿Hay algún mensaje del propio bot en el canal? (el panel de botones). Si no se puede mirar, no se molesta.
  const hasBotMessage = async (c) => {
    try {
      const ms = await c.messages.fetch({ limit: 20 });
      return ms.some((m) => m.author && m.author.id === me.id);
    } catch (_) { return true; }
  };

  /* bienvenidas y despedidas */
  for (const [k, en, es] of [['welcome', 'Welcome messages', 'Las bienvenidas'], ['goodbye', 'Goodbye messages', 'Las despedidas']]) {
    const w = cfg[k];
    if (!w || !w.enabled) continue;
    const c = chan(w.channel);
    if (!c) add(k + ':missing:' + w.channel, en + ' are on but their channel no longer exists. Pick a new one in the panel.', es + ' están activadas pero su canal ya no existe. Elige otro en el panel.');
    else if (!c.isTextBased() || !canPost(c, w.image ? [P.AttachFiles] : [])) {
      add(k + ':perm:' + c.id, "I can't write" + (w.image ? ' or attach images' : '') + ' in <#' + c.id + '> (' + en.toLowerCase() + '). Give me that permission there.', 'No puedo escribir' + (w.image ? ' ni adjuntar imágenes' : '') + ' en <#' + c.id + '> (' + es.toLowerCase() + '). Dame ese permiso en el canal.');
    }
  }

  /* tickets */
  const tk = cfg.tickets;
  if (tk && tk.enabled) {
    const c = chan(tk.channel);
    if (!c) add('tickets:missing:' + tk.channel, 'Tickets are on but their channel no longer exists. Set it up again.', 'Los tickets están activados pero su canal ya no existe. Vuelve a configurarlos.');
    else {
      if (c.isTextBased() && !(await hasBotMessage(c))) add('tickets:panel:' + c.id, '<#' + c.id + '> is the tickets channel but it has no panel with the button yet.', '<#' + c.id + '> es el canal de tickets pero aún no tiene el panel con el botón.');
      else if (c.isTextBased() && !canPost(c)) add('tickets:perm:' + c.id, "I can't write in <#" + c.id + '> (tickets).', 'No puedo escribir en <#' + c.id + '> (tickets).');
    }
    if (tk.staffRole && !role(tk.staffRole)) add('tickets:staff:' + tk.staffRole, "The tickets team role was deleted, so nobody from the team will see them. Pick another one.", 'Se borró el rol del equipo de tickets, así que nadie del equipo los verá. Elige otro.');
    if (tk.logChannel && !chan(tk.logChannel)) add('tickets:log:' + tk.logChannel, 'The tickets log channel no longer exists.', 'El canal de registro de tickets ya no existe.');
  }

  /* roles por botones */
  const rp = cfg.rolePanel;
  if (rp && rp.channel) {
    const c = chan(rp.channel);
    const ids = rp.roles || [];
    const live = ids.filter((x) => role(x));
    if (!c) add('rolepanel:missing:' + rp.channel, 'The roles-by-buttons channel no longer exists.', 'El canal de roles por botones ya no existe.');
    else if (ids.length && !live.length) add('rolepanel:roles:' + c.id, 'All the roles of the panel in <#' + c.id + '> were deleted.', 'Se borraron todos los roles del panel de <#' + c.id + '>.');
    else {
      if (live.length < ids.length) add('rolepanel:partial:' + c.id + ':' + live.length, (ids.length - live.length) + ' role(s) of the panel in <#' + c.id + '> no longer exist.', 'Faltan ' + (ids.length - live.length) + ' rol(es) del panel de <#' + c.id + '>: ya no existen.');
      if (live.length && rp.mode === 'buttons' && c.isTextBased() && !(await hasBotMessage(c))) add('rolepanel:panel:' + c.id, '<#' + c.id + '> is set for roles but the buttons panel is not published yet.', '<#' + c.id + '> está para los roles pero el panel de botones aún no está publicado.');
    }
  }

  /* autoroles */
  const ar = cfg.autoRole;
  if (ar && ar.enabled) {
    const ids = [...(ar.humans || []), ...(ar.bots || [])];
    const found = ids.map(role).filter(Boolean);
    if (ids.length && !found.length) add('autorole:dead', 'Auto roles are on but all their roles were deleted.', 'Los autoroles están activados pero se borraron todos sus roles.');
    const high = found.filter((r) => r.position >= me.roles.highest.position);
    if (high.length) add('autorole:high:' + high.map((r) => r.id).join(','), "I can't hand out " + high.map((r) => '**@' + r.name + '**').join(', ') + ' because they are above my role. Move my role above them.', 'No puedo dar ' + high.map((r) => '**@' + r.name + '**').join(', ') + ' porque están por encima de mi rol. Sube mi rol por encima.');
  }

  /* verificación */
  const vf = cfg.verification;
  if (vf && vf.enabled && (!chan(vf.channel) || !role(vf.role))) add('verification:' + vf.channel + ':' + vf.role, 'Verification is on but its channel or role no longer exists.', 'La verificación está activada pero su canal o su rol ya no existe.');

  /* registros */
  const lost = [...new Set(Object.values(cfg.logs || {}).flat().filter((id) => !chan(id)))];
  if (lost.length) add('logs:missing:' + lost.sort().join(','), lost.length + ' log channel(s) no longer exist, so some alerts are not being delivered.', 'Ya no existen ' + lost.length + ' canal(es) de registros, así que algunos avisos no se están entregando.');

  /* canal de reglas vacío */
  const rules = new Map();
  if (g.rulesChannel) rules.set(g.rulesChannel.id, g.rulesChannel);
  for (const c of g.channels.cache.values()) if (c.type === CT.GuildText && /regla|norma|rules/i.test(c.name)) rules.set(c.id, c);
  for (const c of [...rules.values()].slice(0, 3)) {
    if (c.isTextBased() && c.viewable && !c.lastMessageId) add('rules:empty:' + c.id, '<#' + c.id + '> is empty: the rules are not posted yet.', '<#' + c.id + '> está vacío: aún no están publicadas las normas.');
  }
  return out;
}

/* ============================ aviso ============================ */
function pickChannel(g) {
  const me = g.members.me;
  const cfg = getCfg(g.id);
  const can = (c) => !!c && c.isTextBased() && !c.isThread() && !!c.permissionsFor(me) && c.permissionsFor(me).has([P.ViewChannel, P.SendMessages]);
  const logs = [...(cfg.logs.server || []), ...(cfg.logs.mod || []), ...(cfg.logs.raid || [])].map((id) => g.channels.cache.get(id));
  const cands = [
    g.channels.cache.find((c) => c.type === CT.GuildText && /staff|equipo/i.test(c.name) && can(c)),
    ...logs,
    g.systemChannel,
    g.channels.cache.find((c) => c.type === CT.GuildText && can(c)),
  ];
  return cands.find(can) || null;
}

function compose(g, list) {
  const head = GL(g, '💡 **Suggestion** — I checked the server and this looks unfinished:', '💡 **Sugerencia** — revisé el servidor y esto está incompleto:');
  const shown = list.slice(0, 8).map((x) => '• ' + clip(x.text, 230));
  const more = list.length > 8 ? '\n' + GL(g, '…and ' + (list.length - 8) + ' more.', '…y ' + (list.length - 8) + ' más.') : '';
  return clip('<@' + g.ownerId + '> ' + head + '\n' + shown.join('\n') + more, 1950);
}

/*
 * Revisa y avisa al dueño de lo que no haya avisado ya.
 * opts: channel (dónde avisar; si no, el mejor), force (ignora la espera de 7 días y el trabajo en curso), extra ([texto] avisos propios que se suman)
 * Devuelve la lista de avisos enviados.
 */
async function notify(g, opts = {}) {
  let tpl = null;
  try { tpl = require('./templates'); } catch (_) { /* aún no cargado */ }
  if (!opts.force && tpl && tpl.status(g.id).running) return [];
  const all = [...(await audit(g)), ...(opts.extra || []).map((t) => ({ key: 'x:' + clip(t, 60), text: t }))];
  const seen = store.data[g.id] || (store.data[g.id] = {});
  const live = new Set(all.map((x) => x.key));
  for (const k of Object.keys(seen)) if (!live.has(k)) delete seen[k]; // lo arreglado se olvida: si vuelve a romperse, se avisa
  const now = Date.now();
  const fresh = all.filter((x) => opts.force || !seen[x.key] || now - seen[x.key] > COOLDOWN);
  if (!fresh.length) { store.save(); return []; }

  const text = compose(g, fresh);
  const ch = opts.channel || pickChannel(g);
  let sent = false;
  if (ch) sent = await ch.send({ content: text, allowedMentions: { users: [g.ownerId] } }).then(() => true, () => false);
  if (!sent) {
    const owner = await g.fetchOwner().catch(() => null);
    if (owner) sent = await owner.send({ content: '**' + g.name + '**\n' + text }).then(() => true, () => false);
  }
  if (sent) for (const x of fresh) seen[x.key] = now;
  store.save();
  return sent ? fresh : [];
}

/* ============================ cuándo revisar ============================ */
const timers = new Map(); // guildId -> temporizador (un solo aviso aunque se borren varios canales seguidos)
let sweepTimer = null;
let bootTimer = null;

function soon(g, ms = 20000) {
  clearTimeout(timers.get(g.id));
  const t = setTimeout(() => { timers.delete(g.id); notify(g).catch(logErr); }, ms);
  if (t.unref) t.unref();
  timers.set(g.id, t);
}

// ¿Alguna configuración del bot apunta a este canal o rol?
const referenced = (g, id) => JSON.stringify(getCfg(g.id)).includes('"' + id + '"');

async function sweep(client) {
  for (const g of [...client.guilds.cache.values()]) {
    try { await notify(g); } catch (e) { logErr(e); }
    await sleep(2000);
  }
}

function attach(client) {
  client.on('channelDelete', (c) => { if (c.guild && referenced(c.guild, c.id)) soon(c.guild); });
  client.on('roleDelete', (r) => { if (r.guild && referenced(r.guild, r.id)) soon(r.guild); });
  let started = false;
  const boot = () => {
    if (started) return;
    started = true;
    clearTimeout(bootTimer);
    clearInterval(sweepTimer);
    bootTimer = setTimeout(() => sweep(client).catch(logErr), 120000);
    sweepTimer = setInterval(() => sweep(client).catch(logErr), SWEEP_EVERY);
    if (bootTimer.unref) bootTimer.unref();
    if (sweepTimer.unref) sweepTimer.unref();
  };
  client.once('clientReady', boot);
  client.once('ready', boot);
}

module.exports = { audit, notify, attach };
