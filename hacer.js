'use strict';

/*
 * hacer.js — /hacer: construye el servidor entero.
 *
 * Borra TODOS los canales y roles que haya y crea los de la plantilla elegida (con permisos), publica normas,
 * tickets y roles por botones, y deja listos autoroles, bienvenidas, niveles, antiraid, registros, backups y el juego de camisetas.
 *
 * · Lo puede pedir el dueño o cualquier Administrador (no solo el dueño).
 * · Pide confirmación con un botón (solo quien lo pidió) y guarda una copia del servidor antes de borrar.
 * · Al terminar avisa en el canal nuevo y, si algo quedó a medias, menciona al dueño con una «Sugerencia».
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits: P, ChannelType: CT } = require('discord.js');
const bot = require('./bot');
const tpl = require('./templates');
const sug = require('./sugerencias');
const backup = require('./backup');

const { L, getCfg, saveCfg, logErr, COLOR } = bot;
const EPH = MessageFlags.Ephemeral;
const REASON = 'Centinela: /hacer';
const CONFIRM_MS = 120000;
// Módulos de ui.js que se instalan: antiraid completo, registros, avisos y backups automáticos
const INSTALL = ['logs', 'antispam', 'nuke', 'botadd', 'warns', 'guard', 'minage', 'raidmode', 'reports', 'backups'];
const running = new Set(); // servidores donde hay un /hacer en marcha
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const es2 = (s) => ({ 'es-ES': s, 'es-419': s });

const isAdmin = (member, g) => !!member && (member.id === g.ownerId || member.permissions.has(P.Administrator));

/* ============================ qué se va a borrar ============================ */
function scan(g, member) {
  const me = g.members.me;
  const protect = new Set();
  if (me) for (const r of me.roles.cache.values()) protect.add(r.id); // los roles del propio bot no se tocan
  // Si no es el dueño, el rol que le da Administrador se conserva: si no, se quedaría sin acceso al servidor
  if (member.id !== g.ownerId) for (const r of member.roles.cache.values()) if (r.id !== g.id && r.permissions.has(P.Administrator)) protect.add(r.id);
  const channels = [...g.channels.cache.values()].filter((c) => !c.isThread()).length;
  const roles = [...g.roles.cache.values()].filter((r) => r.id !== g.id && !r.managed && !protect.has(r.id) && r.editable).length;
  return { channels, roles, protectRoleIds: [...protect] };
}

/* ============================ pantallas ============================ */
function confirmView(lc, id, uid, plan) {
  const x = tpl.T[id];
  const info = tpl.LIST().find((y) => y.id === id);
  const e = new EmbedBuilder()
    .setColor(COLOR.red)
    .setTitle(L(lc, '⚠️ Build the whole server?', '⚠️ ¿Hacer todo el servidor?'))
    .setDescription(L(lc,
      '**This deletes EVERYTHING that is here now:** ' + plan.channels + ' channels and ' + plan.roles + ' roles. Then it builds **' + x.ico + ' ' + x.n + '**:\n• about ' + info.roles + ' roles and ' + info.channels + ' channels with their permissions\n• rules, tickets, roles by buttons, welcome, auto roles and levels\n• antiraid, logs, backups and the shirts game\n\n💾 I save a copy of the server first (the owner can restore it).\nPress the red button within 2 minutes to confirm.',
      '**Esto borra TODO lo que hay ahora:** ' + plan.channels + ' canales y ' + plan.roles + ' roles. Después crea **' + x.ico + ' ' + x.n + '**:\n• unos ' + info.roles + ' roles y ' + info.channels + ' canales con sus permisos\n• normas, tickets, roles por botones, bienvenidas, autoroles y niveles\n• antiraid, registros, backups y el juego de camisetas\n\n💾 Antes guardo una copia del servidor (el dueño puede restaurarla).\nPulsa el botón rojo en menos de 2 minutos para confirmar.'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hacer:go:' + id + ':' + uid + ':' + Date.now()).setLabel(L(lc, 'Yes, delete everything and build it', 'Sí, borrar todo y hacerlo')).setEmoji('🧱').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('hacer:no:' + uid).setLabel(L(lc, 'Cancel', 'Cancelar')).setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [e], components: [row] };
}

function progressEmbed(lc, x, lines, color) {
  return new EmbedBuilder()
    .setColor(color || COLOR.blue)
    .setTitle('🧱 ' + L(lc, 'Building ', 'Haciendo el servidor ') + x.ico + ' ' + x.n + '…')
    .setDescription('```\n' + lines.join('\n').slice(-1800) + '\n```');
}

/* ============================ comando ============================ */
// Hay decenas de plantillas (más de las 25 opciones que admite Discord), así que «tipo» se escribe y se busca con autocompletado
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
const POPULAR = ['comunidad', 'gaming', 'minecraft', 'anime', 'estudio', 'laliga', 'premier', 'seriea', 'bundesliga', 'ligue1', 'ligamx', 'champions', 'selecciones', 'futbol', 'torneo', 'eafc', 'boxeo', 'mma', 'lucha', 'nba', 'nfl', 'f1', 'tenis', 'todos', 'esports'];
const label = (id) => { const x = tpl.T[id]; return (x.ico + ' ' + x.n).slice(0, 100); };

// Plantillas que encajan con lo escrito (nombre, id o descripción), las mejores primero
function search(q) {
  const n = norm(q);
  if (!n) return POPULAR.filter((id) => tpl.T[id]);
  const words = n.split(' ');
  const scored = [];
  for (const [id, x] of Object.entries(tpl.T)) {
    const name = norm(x.n);
    const hay = name + ' ' + norm(id) + ' ' + norm(x.d);
    if (!words.every((w) => hay.includes(w))) continue;
    scored.push([(name.startsWith(n) || norm(id) === n ? 0 : name.includes(n) ? 1 : words.every((w) => name.includes(w)) ? 2 : 3), id]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map((y) => y[1]);
}

// Lo que llega en «tipo»: el id exacto (lo normal al elegir de la lista) o, si lo escribieron a mano, la mejor coincidencia
function resolve(raw) {
  const r = String(raw || '').trim();
  if (!r) return 'comunidad';
  if (tpl.T[r]) return r;
  const low = norm(r);
  const byName = Object.entries(tpl.T).find(([id, x]) => norm(x.ico + ' ' + x.n) === low || norm(x.n) === low || norm(id) === low);
  if (byName) return byName[0];
  return search(r)[0] || null;
}

const command = {
  data: new SlashCommandBuilder()
    .setName('hacer')
    .setDescription('Build the whole server: channels, roles, permissions and bot setup (deletes what is there)')
    .setDescriptionLocalizations(es2('Hace el servidor entero: canales, roles, permisos y la configuración del bot (borra lo que haya)'))
    .setDMPermission(false)
    .setDefaultMemberPermissions(P.Administrator)
    .addStringOption((o) => o.setName('tipo').setDescription('Kind of server: type to search (football leagues, boxing, NBA, gaming…)').setDescriptionLocalizations(es2('Tipo de servidor: escribe para buscar (ligas de fútbol, boxeo, NBA, gaming…)')).setAutocomplete(true)),
  async autocomplete(i) {
    try {
      const out = search(i.options.getFocused()).slice(0, 25).map((id) => ({ name: label(id), value: id }));
      await i.respond(out);
    } catch (_) { /* la interacción caducó */ }
  },
  async execute(i) {
    const g = i.guild;
    if (!g) return;
    const lc = g.preferredLocale;
    if (!isAdmin(i.member, g)) return i.reply({ content: L(lc, '❌ You need the **Administrator** permission.', '❌ Necesitas el permiso de **Administrador**.'), flags: EPH });
    const me = g.members.me;
    if (!me || !(me.permissions.has(P.Administrator) || (me.permissions.has(P.ManageChannels) && me.permissions.has(P.ManageRoles)))) {
      return i.reply({ content: L(lc, '❌ I need the **Manage Channels** and **Manage Roles** permissions (or Administrator).', '❌ Necesito los permisos **Gestionar canales** y **Gestionar roles** (o Administrador).'), flags: EPH });
    }
    if (running.has(g.id) || tpl.status(g.id).running) return i.reply({ content: L(lc, '⏳ The server is already being built.', '⏳ Ya se está haciendo el servidor.'), flags: EPH });
    const raw = i.options.getString('tipo');
    const id = resolve(raw);
    if (!id) {
      const sug = POPULAR.filter((k) => tpl.T[k]).slice(0, 8).map((k) => label(k)).join(', ');
      return i.reply({ content: L(lc, '❌ I found no type called “' + String(raw).slice(0, 60) + '”. Start typing in the **tipo** option and pick one from the list, e.g.: ' + sug, '❌ No encontré ningún tipo llamado «' + String(raw).slice(0, 60) + '». Empieza a escribir en la opción **tipo** y elige uno de la lista, por ejemplo: ' + sug), flags: EPH });
    }
    return i.reply({ ...confirmView(lc, id, i.user.id, scan(g, i.member)), flags: EPH });
  },
};

/* ============================ botones ============================ */
async function handleComponent(i) {
  if (!i.customId || !i.customId.startsWith('hacer:')) return false;
  const [, act, a, b, c] = i.customId.split(':');
  const g = i.guild;
  const lc = g ? g.preferredLocale : i.locale;
  const uid = act === 'go' ? b : a;
  if (i.user.id !== uid) { await i.reply({ content: L(lc, '❌ Only who ran the command can confirm.', '❌ Solo quien lanzó el comando puede confirmar.'), flags: EPH }); return true; }
  if (act === 'no') { await i.update({ content: L(lc, '❌ Cancelled. Nothing was changed.', '❌ Cancelado. No se cambió nada.'), embeds: [], components: [] }); return true; }
  if (act !== 'go' || !g) return true;
  if (Date.now() - Number(c) > CONFIRM_MS) { await i.update({ content: L(lc, '⌛ That confirmation expired. Use /hacer again.', '⌛ La confirmación caducó. Usa /hacer otra vez.'), embeds: [], components: [] }); return true; }
  if (!isAdmin(i.member, g)) { await i.update({ content: L(lc, '❌ You need the **Administrator** permission.', '❌ Necesitas el permiso de **Administrador**.'), embeds: [], components: [] }); return true; }
  perform(i, a).catch(logErr);
  return true;
}

/* ============================ ejecución ============================ */
async function perform(i, id) {
  const g = i.guild;
  const lc = g.preferredLocale;
  const x = tpl.T[id];
  if (running.has(g.id) || tpl.status(g.id).running) { await i.update({ content: L(lc, '⏳ The server is already being built.', '⏳ Ya se está haciendo el servidor.'), embeds: [], components: [] }); return; }
  running.add(g.id);
  // Las ediciones del mensaje van en cola para que una vieja nunca pise la final
  let queue = Promise.resolve();
  const edit = (payload) => { queue = queue.then(() => i.editReply({ content: '', components: [], ...payload }).catch(() => {})); return queue; };
  try {
    await i.update({ content: '', embeds: [progressEmbed(lc, x, [L(lc, '💾 Saving a backup first…', '💾 Guardando antes una copia de seguridad…')])], components: [] });

    // Copia de seguridad: si no se puede guardar, no se borra nada
    let bk = null;
    let lastErr = null;
    for (let n = 0; n < 3 && !bk; n++) {
      try { bk = await backup.takeBackup(g, { messages: false, by: i.user.id }); } catch (e) { lastErr = e; if (n < 2) await sleep(4000); }
    }
    if (!bk) {
      await edit({ embeds: [progressEmbed(lc, x, ['❌ ' + L(lc, "I couldn't save the safety backup, so I deleted nothing.", 'No pude guardar la copia de seguridad, así que no borré nada.') + (lastErr && lastErr.message && lastErr.message !== 'busy' ? ' (' + lastErr.message.slice(0, 120) + ')' : '')], COLOR.red)] });
      return;
    }

    const plan = scan(g, i.member);
    const job = tpl.start(g, id, {
      userId: i.user.id,
      wipe: true,
      keepChannelId: i.channelId,
      protectRoleIds: plan.protectRoleIds,
      install: INSTALL,
      after: (result, j) => finish({ g, i, id, bk, result, job: j, lc, edit }),
    });
    while (job.running) {
      await sleep(3500);
      if (job.running && !job.finalized) await edit({ embeds: [progressEmbed(lc, x, job.lines.slice(-14))] });
    }
    if (job.error) await edit({ embeds: [progressEmbed(lc, x, ['❌ ' + job.error, ...job.lines.slice(-8)], COLOR.red)] });
  } catch (e) {
    logErr(e);
    await edit({ embeds: [progressEmbed(lc, x, ['❌ ' + e.message], COLOR.red)] });
  } finally {
    running.delete(g.id);
  }
}

// Remate: ajustes del servidor, reintentos de borrado, camisetas, aviso final y sugerencias al dueño
async function finish({ g, i, id, bk, result, job, lc, edit }) {
  job.finalized = true;
  const x = tpl.T[id];
  const { specials } = result;
  const wipe = job.wipe || { channels: 0, roles: 0, failedChannels: [], keptRoles: [], failedRoles: 0 };
  const find = (re, type) => g.channels.cache.find((c) => c.type === (type === undefined ? CT.GuildText : type) && re.test(c.name));

  // 1) Ajustes del servidor. En servidores con «Comunidad» las normas y novedades se pasan a los canales nuevos
  //    (si no, Discord no deja borrar los viejos).
  const edits = {};
  const news = find(/anuncios/i, CT.GuildAnnouncement) || find(/anuncios/i) || specials.welcome;
  if (g.features.includes('COMMUNITY')) {
    if (specials.rules) edits.rulesChannel = specials.rules;
    if (news) edits.publicUpdatesChannel = news;
  }
  if (specials.welcome) edits.systemChannel = specials.welcome;
  const afk = find(/afk/i, CT.GuildVoice);
  if (afk) { edits.afkChannel = afk; edits.afkTimeout = 300; }
  if (Object.keys(edits).length) {
    try { await g.edit({ ...edits, reason: REASON }); } catch (_) {
      for (const [k, v] of Object.entries(edits)) await g.edit({ [k]: v, reason: REASON }).catch(() => {});
    }
  }

  // 2) Lo que no se pudo borrar al principio se reintenta
  const left = [];
  for (const f of wipe.failedChannels) {
    const c = g.channels.cache.get(f.id);
    if (!c) continue;
    try { await c.delete(REASON); wipe.channels++; } catch (_) { left.push(c.name); }
  }

  // 3) Juego de camisetas: activado en el canal de comandos, para siempre
  if (specials.bots) {
    const cfg = getCfg(g.id);
    cfg.shirts = { mode: 'real', channel: null, every: 10, ...(cfg.shirts || {}), channel: specials.bots.id, on: true };
    saveCfg();
  }

  // 4) Aviso final en el canal nuevo
  const home = find(/general/i) || specials.bots || specials.welcome || find(/./);
  const total = [...g.channels.cache.values()].filter((c) => !c.isThread()).length;
  const nRoles = g.roles.cache.size - 1;
  const lines = [
    '✅ ' + L(lc, '**Server built:** ', '**Servidor hecho:** ') + x.ico + ' ' + x.n,
    '🗑️ ' + L(lc, 'Deleted ', 'Borré ') + wipe.channels + L(lc, ' channels and ', ' canales y ') + wipe.roles + L(lc, ' roles.', ' roles.') + ' · 🆕 ' + L(lc, 'Now there are ', 'Ahora hay ') + total + L(lc, ' channels and ', ' canales y ') + nRoles + L(lc, ' roles.', ' roles.'),
    '🛡️ ' + L(lc, 'Antiraid, logs, auto backups, welcome, auto roles, tickets, roles by buttons and levels are set up.', 'Antiraid, registros, backups automáticos, bienvenidas, autoroles, tickets, roles por botones y niveles listos.') + (specials.bots ? ' 🎮 ' + L(lc, 'Shirts game on in <#' + specials.bots.id + '>.', 'Camisetas activadas en <#' + specials.bots.id + '>.') : ''),
    '💾 ' + L(lc, 'Backup of the previous server: `' + bk.id + '` (the owner restores it with `$b-load ' + bk.id + ' confirm`).', 'Copia del servidor anterior: `' + bk.id + '` (el dueño la restaura con `$b-load ' + bk.id + ' confirm`).'),
  ];
  if (wipe.keptRoles.length) lines.push('🔑 ' + L(lc, 'Kept ' + wipe.keptRoles.map((n) => '**@' + n + '**').join(', ') + ' so nobody loses access.', 'Conservé ' + wipe.keptRoles.map((n) => '**@' + n + '**').join(', ') + ' para que nadie pierda el acceso.'));
  const summary = '<@' + i.user.id + '>\n' + lines.join('\n');
  let posted = false;
  if (home) posted = await home.send({ content: summary.slice(0, 1990), allowedMentions: { users: [i.user.id] } }).then(() => true, () => false);
  if (!posted) await i.user.send({ content: summary.slice(0, 1990) }).catch(() => {});

  // 5) Sugerencias al dueño: lo que falló o quedó a medias
  const extra = job.lines.filter((l) => l.includes('❌')).map((l) => l.replace(/^\s*❌\s*/, '').trim()).filter(Boolean);
  if (left.length) extra.push(L(lc, "I couldn't delete these channels (Discord needs them): ", 'No pude borrar estos canales (Discord los necesita): ') + left.map((n) => '#' + n).join(', ') + '.');
  if (wipe.failedRoles) extra.push(L(lc, wipe.failedRoles + ' old role(s) are above mine so I could not delete them. Move my role to the top and run /hacer again.', wipe.failedRoles + ' rol(es) viejos están por encima del mío y no pude borrarlos. Sube mi rol al máximo y vuelve a usar /hacer.'));
  try { await sug.notify(g, { channel: home || undefined, force: true, extra }); } catch (e) { logErr(e); }

  // 6) Mensaje privado de quien lo pidió y, por último, se borra el canal donde se escribió el comando
  await edit({ embeds: [new EmbedBuilder().setColor(COLOR.green).setTitle('✅ ' + L(lc, 'Done!', '¡Listo!')).setDescription(L(lc, 'Your server is ready' + (home ? ': go to <#' + home.id + '>.' : '.'), 'Tu servidor está listo' + (home ? ': ve a <#' + home.id + '>.' : '.')))] });
  const old = g.channels.cache.get(i.channelId);
  if (old && (!home || old.id !== home.id)) await old.delete(REASON).catch((e) => job.lines.push('❌ ' + L(lc, "Couldn't delete #" + old.name + ': ', 'No pude borrar #' + old.name + ': ') + e.message));
}

function owns(i) { return !!(i.customId && String(i.customId).startsWith('hacer:')); }

module.exports = { commands: [command], handleComponent, owns, scan, search, resolve };
