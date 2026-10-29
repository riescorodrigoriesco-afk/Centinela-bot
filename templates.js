'use strict';

/*
 * templates.js — Plantillas de servidor.
 * Creas un servidor, metes a Centinela y eliges un tipo: el bot crea roles, categorías y canales con sus permisos,
 * publica reglas, tickets y roles por botones, y deja listos autoroles, bienvenidas, niveles y antiraid.
 * Es seguro repetirlo: lo que ya existe (mismo nombre) no se duplica.
 */

const { ChannelType: CT, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const bot = require('./bot');

const { getCfg, saveCfg, COLOR, logErr } = bot;

/* ============================ datos ============================ */
// Roles del equipo (jerarquía fija, de arriba abajo)
const STAFF = {
  admin: { name: 'Administrador', color: 0xe74c3c, hoist: true, perms: ['ManageChannels', 'ManageRoles', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ViewAuditLog', 'ManageNicknames', 'ManageGuild', 'MentionEveryone'] },
  mod: { name: 'Moderador', color: 0xe67e22, hoist: true, perms: ['ManageMessages', 'KickMembers', 'ModerateMembers', 'ViewAuditLog', 'ManageNicknames'] },
  helper: { name: 'Ayudante', color: 0xf1c40f, hoist: true, perms: ['ManageMessages', 'ModerateMembers'] },
};

// Canales: t = texto, a = anuncios, v = voz. Opciones: ro (solo lectura), staff (solo equipo), sp (función especial)
const t = (name, topic, o) => ({ k: 'text', name, topic, ...o });
const a = (name, topic, o) => ({ k: 'news', name, topic, ...o });
const v = (name, o) => ({ k: 'voice', name, ...o });

const BASE_INFO = {
  name: '📌 INFORMACIÓN',
  ch: [
    a('📢│anuncios', 'Noticias y avisos importantes', { ro: true }),
    t('📜│reglas', 'Lee las normas antes de participar', { ro: true, sp: 'rules' }),
    t('👋│bienvenida', 'Aquí damos la bienvenida a los nuevos', { ro: true, sp: 'welcome' }),
    t('🚪│despedidas', 'Los que se van', { ro: true, sp: 'goodbye' }),
    t('🎭│roles', 'Elige tus roles pulsando los botones', { ro: true, sp: 'roles' }),
  ],
};
const BASE_SUPPORT = {
  name: '🎫 SOPORTE',
  ch: [
    t('🎫│abrir-ticket', 'Pulsa el botón para hablar con el equipo en privado', { ro: true, sp: 'tickets' }),
    t('❓│preguntas', 'Dudas rápidas de la comunidad'),
  ],
};
const BASE_STAFF = {
  name: '🛡️ EQUIPO',
  ch: [
    t('🛡️│staff-chat', 'Chat privado del equipo', { staff: true }),
    t('🤖│comandos-staff', 'Comandos de moderación', { staff: true }),
    t('📋│registro-tickets', 'Transcripciones y registro de tickets', { staff: true, sp: 'ticketlog' }),
  ],
};
const TALK_BOTS = t('🤖│comandos', 'Comandos de bots y minijuegos de Centinela', { sp: 'bots' });

const T = {
  comunidad: {
    ico: '🌍', n: 'Comunidad general', d: 'Servidor social para charlar, compartir y conocer gente.',
    levels: true,
    roles: [{ name: 'Fundador', color: 0xf5b800, hoist: true, founder: true }],
    selfRoles: [['🎮 Gamer', 0x9b59b6], ['🎨 Artista', 0xe91e63], ['🎵 Música', 0x1abc9c], ['📚 Lector', 0x3498db], ['💻 Tech', 0x2ecc71], ['🎬 Cine', 0xe67e22]],
    rules: ['Respeta a todos: nada de insultos, acoso ni discriminación.', 'Sin spam, publicidad ni enlaces sospechosos.', 'Nada de contenido +18, violento o ilegal.', 'Usa cada canal para lo que es.', 'Haz caso al equipo; si algo falla, abre un ticket.'],
    ticketCats: ['Ayuda', 'Reporte', 'Sugerencia', 'Otro'],
    cats: [
      { name: '💬 COMUNIDAD', ch: [t('💬│general', 'Charla libre'), t('😂│memes', 'Memes y humor'), t('📸│fotos', 'Comparte tus fotos'), t('🧠│debates', 'Debates con respeto'), TALK_BOTS] },
      { name: '🔊 VOZ', ch: [v('🔊 Sala 1'), v('🔊 Sala 2'), v('🎵 Música'), v('💤 AFK')] },
    ],
  },
  gaming: {
    ico: '🎮', n: 'Gaming', d: 'Comunidad de videojuegos: buscar equipo, clips, torneos y salas de voz.',
    levels: true,
    roles: [{ name: 'Fundador', color: 0xf5b800, hoist: true, founder: true }, { name: 'Capitán', color: 0x00b894, hoist: true }, { name: 'Pro Player', color: 0x6c5ce7 }],
    selfRoles: [['🖥️ PC', 0x3498db], ['🎮 PlayStation', 0x2980b9], ['🟩 Xbox', 0x27ae60], ['🔴 Switch', 0xe74c3c], ['📱 Móvil', 0xf39c12], ['🏆 Competitivo', 0x8e44ad]],
    rules: ['Cero toxicidad: buen rollo con tus compañeros de equipo.', 'Prohibido hacer trampas, vender cuentas o hackear.', 'Sin spam ni publicidad.', 'Busca equipo solo en su canal.', 'Respeta las decisiones del equipo.'],
    ticketCats: ['Soporte', 'Reporte de jugador', 'Torneos', 'Otro'],
    cats: [
      { name: '🎮 JUEGOS', ch: [t('💬│general', 'Charla general'), t('🔎│buscar-equipo', 'Encuentra con quién jugar'), t('🎬│clips', 'Tus mejores jugadas'), t('🏆│torneos', 'Torneos y eventos'), t('🛒│ofertas', 'Ofertas de juegos'), TALK_BOTS] },
      { name: '🔊 SALAS', ch: [v('🎧 Lobby'), v('🔫 Squad 1', { limit: 4 }), v('🔫 Squad 2', { limit: 4 }), v('🤝 Dúo', { limit: 2 }), v('💤 AFK')] },
    ],
  },
  minecraft: {
    ico: '⛏️', n: 'Minecraft', d: 'Servidor de Minecraft: IP, builds, redstone y sala de voz del survival.',
    levels: true,
    roles: [{ name: 'Fundador', color: 0xf5b800, hoist: true, founder: true }, { name: 'Constructor', color: 0x27ae60 }, { name: 'VIP', color: 0xf1c40f, hoist: true }],
    selfRoles: [['⛏️ Survival', 0x27ae60], ['🏗️ Builder', 0xe67e22], ['🔧 Redstone', 0xe74c3c], ['⚔️ PvP', 0x8e44ad], ['🌍 Exploración', 0x3498db]],
    rules: ['Prohibido griefear, robar o destruir construcciones ajenas.', 'Nada de hacks, X-ray ni duplicación.', 'Respeta a todos en el chat y en el juego.', 'Sin spam ni publicidad.', 'Haz caso al equipo.'],
    ticketCats: ['Soporte del servidor', 'Reporte de griefing', 'Compras / VIP', 'Otro'],
    cats: [
      { name: '⛏️ MINECRAFT', ch: [t('🌐│ip-del-servidor', 'IP, versión y cómo entrar', { ro: true }), t('💬│general', 'Charla general'), t('🏗️│builds', 'Presume tus construcciones'), t('🔧│redstone', 'Granjas y máquinas'), t('📸│capturas', 'Capturas del mundo'), TALK_BOTS] },
      { name: '🔊 VOZ', ch: [v('🔊 Survival'), v('🏗️ Construyendo'), v('💤 AFK')] },
    ],
  },
  estudio: {
    ico: '📚', n: 'Estudio / Educación', d: 'Grupo de estudio o clase: dudas, recursos, tareas y salas para estudiar juntos.',
    levels: true,
    roles: [{ name: 'Profesor', color: 0x00cec9, hoist: true }, { name: 'Tutor', color: 0x0984e3, hoist: true }],
    selfRoles: [['📐 Matemáticas', 0x3498db], ['🧪 Ciencias', 0x2ecc71], ['📖 Lengua', 0xe67e22], ['🌎 Idiomas', 0x9b59b6], ['💻 Programación', 0x1abc9c], ['🎓 Universidad', 0xe74c3c]],
    rules: ['Respeto ante todo: aquí se viene a aprender.', 'Pregunta sin miedo, nadie nace sabiendo.', 'No compartas exámenes ni hagas trampas.', 'Sin spam ni temas fuera de lugar.', 'Ayuda a los demás cuando puedas.'],
    ticketCats: ['Duda académica', 'Tutoría', 'Problema técnico', 'Otro'],
    cats: [
      { name: '📚 AULA', ch: [t('💬│general', 'Charla entre estudiantes'), t('🙋│dudas', 'Pregunta tus dudas aquí'), t('📎│recursos', 'Apuntes, libros y enlaces útiles'), t('📝│tareas', 'Tareas y fechas de entrega'), t('📅│calendario', 'Exámenes y eventos', { ro: true }), TALK_BOTS] },
      { name: '🔊 SALAS DE ESTUDIO', ch: [v('📖 Estudio en silencio'), v('🧠 Grupo 1', { limit: 6 }), v('🧠 Grupo 2', { limit: 6 }), v('☕ Descanso')] },
    ],
  },
  tienda: {
    ico: '🛒', n: 'Tienda / Negocio', d: 'Comunidad de clientes: catálogo, ofertas, reseñas, pedidos por ticket y soporte.',
    levels: false,
    roles: [{ name: 'Vendedor', color: 0x00b894, hoist: true }, { name: 'Cliente VIP', color: 0xf1c40f, hoist: true }, { name: 'Cliente', color: 0x74b9ff }],
    selfRoles: [['🔔 Avisos de ofertas', 0xf39c12], ['🆕 Novedades', 0x3498db], ['🎁 Sorteos', 0xe91e63]],
    rules: ['Trato amable y respetuoso con clientes y equipo.', 'Los pedidos y pagos se gestionan solo por ticket.', 'No compartas datos personales ni de pago en canales públicos.', 'Sin spam ni publicidad de terceros.', 'Las reseñas deben ser honestas.'],
    ticketCats: ['Hacer un pedido', 'Soporte de pedido', 'Reembolso', 'Alianzas'],
    cats: [
      { name: '🛒 TIENDA', ch: [t('🛍️│catálogo', 'Lo que ofrecemos', { ro: true }), t('🔥│ofertas', 'Descuentos y promociones', { ro: true }), t('⭐│reseñas', 'Opiniones de clientes'), t('📦│entregas', 'Pruebas de entregas', { ro: true }), t('💬│general', 'Charla con la comunidad'), TALK_BOTS] },
      { name: '🔊 VOZ', ch: [v('🔊 Atención al cliente'), v('💤 AFK')] },
    ],
  },
  anime: {
    ico: '🌸', n: 'Anime / Otaku', d: 'Servidor de anime y manga: recomendaciones, fanart, spoilers y watch parties.',
    levels: true,
    roles: [{ name: 'Fundador', color: 0xf5b800, hoist: true, founder: true }, { name: 'Senpai', color: 0xff7675, hoist: true }],
    selfRoles: [['⚔️ Shonen', 0xe74c3c], ['💖 Shojo', 0xe91e63], ['🧠 Seinen', 0x8e44ad], ['🎌 Isekai', 0x3498db], ['📖 Manga', 0x2ecc71], ['🎨 Fanartista', 0xf39c12]],
    rules: ['Respeta los gustos de los demás: no hay animes “malos”.', 'Usa el canal de spoilers para spoilers.', 'Nada de contenido +18 ni pirata.', 'Sin spam ni publicidad.', 'Haz caso al equipo.'],
    ticketCats: ['Ayuda', 'Reporte', 'Sugerencia', 'Otro'],
    cats: [
      { name: '🌸 ANIME', ch: [t('💬│general', 'Charla otaku'), t('📺│anime', 'Qué estás viendo'), t('📖│manga', 'Manga y novelas ligeras'), t('⭐│recomendaciones', 'Recomienda y descubre'), t('🎨│fanart', 'Dibujos y arte'), t('⚠️│spoilers', 'Solo aquí se hacen spoilers'), TALK_BOTS] },
      { name: '🔊 VOZ', ch: [v('🔊 Charla'), v('🍿 Watch party'), v('🎵 Openings'), v('💤 AFK')] },
    ],
  },
  creador: {
    ico: '🎥', n: 'Streamer / Creador', d: 'Comunidad de un creador: avisos de directos, clips, fanart y zona de suscriptores.',
    levels: true,
    roles: [{ name: 'Creador', color: 0xf5b800, hoist: true, founder: true }, { name: 'Suscriptor', color: 0x9146ff, hoist: true }, { name: 'VIP', color: 0xff7675 }],
    selfRoles: [['🔴 Avisos de directo', 0xe74c3c], ['🎬 Avisos de vídeo', 0xff7675], ['🎁 Sorteos', 0xe91e63], ['🎮 Jugar con el streamer', 0x3498db]],
    rules: ['Respeto al creador y a la comunidad.', 'Sin spam, autopromoción ni enlaces sospechosos.', 'No spoilers de lo que se juega en directo.', 'Nada de contenido ofensivo.', 'Haz caso al equipo.'],
    ticketCats: ['Colaboraciones', 'Soporte', 'Reporte', 'Otro'],
    cats: [
      { name: '🎥 DIRECTOS', ch: [a('🔴│directos', 'Avisos de directos', { ro: true }), a('🎬│vídeos', 'Nuevos vídeos', { ro: true }), t('✂️│clips', 'Clips de la comunidad'), t('🎨│fanart', 'Fanart y memes'), t('💬│general', 'Charla general'), t('💡│sugerencias', 'Ideas para el canal'), TALK_BOTS] },
      { name: '⭐ SUSCRIPTORES', ch: [t('⭐│zona-subs', 'Solo para suscriptores', { sp: 'sub' }), v('⭐ Voz subs', { sp: 'subvoice' })] },
      { name: '🔊 VOZ', ch: [v('🔊 Charla'), v('🎮 Jugando con el creador'), v('💤 AFK')] },
    ],
  },
  roleplay: {
    ico: '🎭', n: 'Roleplay', d: 'Servidor de rol: lore, fichas de personaje, escenarios y canal fuera de personaje.',
    levels: false,
    roles: [{ name: 'Narrador', color: 0xf5b800, hoist: true }, { name: 'Jugador', color: 0x6c5ce7 }],
    selfRoles: [['⚔️ Aventurero', 0xe67e22], ['🧙 Mago', 0x9b59b6], ['🗡️ Pícaro', 0x636e72], ['🛡️ Guerrero', 0x2980b9], ['🌿 Explorador', 0x27ae60]],
    rules: ['Respeta el rol de los demás: no hagas god-moding ni metagaming.', 'Separa lo que pasa en personaje (IC) de lo de fuera (OOC).', 'Sin contenido explícito.', 'Sé constante: avisa si dejas una historia.', 'El narrador tiene la última palabra.'],
    ticketCats: ['Ficha de personaje', 'Duda de reglas', 'Reporte', 'Otro'],
    cats: [
      { name: '📜 LORE', ch: [t('🗺️│mundo-y-lore', 'La historia del mundo', { ro: true }), t('📋│fichas', 'Presenta a tu personaje'), t('📜│normas-de-rol', 'Reglas de rol', { ro: true })] },
      { name: '🎭 ROL', ch: [t('🍺│taberna', 'Donde empiezan las aventuras'), t('🏰│ciudad', 'Escenario: la ciudad'), t('🌲│bosque', 'Escenario: el bosque'), t('⚔️│mazmorra', 'Escenario: la mazmorra')] },
      { name: '💬 FUERA DE PERSONAJE', ch: [t('💬│ooc', 'Charla fuera de personaje'), TALK_BOTS] },
      { name: '🔊 VOZ', ch: [v('🎙️ Sesión de rol'), v('🔊 Charla'), v('💤 AFK')] },
    ],
  },
  proyecto: {
    ico: '🧩', n: 'Proyecto / Soporte', d: 'Comunidad de un proyecto, app o bot: anuncios, changelog, bugs, sugerencias y ayuda.',
    levels: false,
    roles: [{ name: 'Desarrollador', color: 0x00cec9, hoist: true }, { name: 'Beta tester', color: 0xa29bfe }],
    selfRoles: [['🔔 Novedades', 0x3498db], ['🐞 Reportar bugs', 0xe74c3c], ['💡 Ideas', 0xf1c40f]],
    rules: ['Sé claro al pedir ayuda: explica qué pasó y qué esperabas.', 'Un problema, un hilo.', 'Busca en las preguntas frecuentes antes de preguntar.', 'Sin spam ni publicidad.', 'Respeto a todos.'],
    ticketCats: ['Soporte', 'Bug', 'Sugerencia', 'Negocios'],
    cats: [
      { name: '🧩 PROYECTO', ch: [a('🚀│changelog', 'Novedades de cada versión', { ro: true }), t('📖│faq', 'Preguntas frecuentes', { ro: true }), t('💬│general', 'Charla general'), t('🐞│bugs', 'Reporta errores'), t('💡│sugerencias', 'Propón mejoras'), TALK_BOTS] },
      { name: '🔊 VOZ', ch: [v('🔊 Charla'), v('💤 AFK')] },
    ],
  },
};

const LIST = () => Object.entries(T).map(([id, x]) => ({ id, ico: x.ico, name: x.n, desc: x.d, roles: 3 + x.roles.length + x.selfRoles.length + 2, channels: chanCount(x) }));
function chanCount(x) {
  return [BASE_INFO, ...x.cats, BASE_SUPPORT, BASE_STAFF].reduce((n, c) => n + c.ch.length, 0);
}

/* ============================ ejecución ============================ */
const DEFAULT_NAMES = new Set(['general', 'text channels', 'voice channels', 'canales de texto', 'canales de voz', 'texto', 'voz', 'general ']);
const jobs = new Map(); // guildId -> { running, lines, done, error, tpl }

const perm = (names) => names.map((n) => P[n]).filter(Boolean);
const kindOf = { text: CT.GuildText, news: CT.GuildAnnouncement, voice: CT.GuildVoice };

/*
 * Borrado total (solo lo pide /hacer, ya confirmado): quita todos los canales y todos los roles que el bot pueda borrar.
 * Nunca toca: el canal indicado en keepChannelId (se borra al final), los roles de integraciones (managed),
 * los roles del propio bot ni los que se pidan proteger en protectRoleIds.
 */
async function wipeServer(g, opts, log) {
  await g.channels.fetch().catch(() => {});
  await g.roles.fetch().catch(() => {});
  const res = { channels: 0, roles: 0, failedChannels: [], keptRoles: [], failedRoles: 0 };
  const REASON = 'Centinela: /hacer';

  const chans = [...g.channels.cache.values()].filter((c) => !c.isThread() && c.id !== opts.keepChannelId);
  chans.sort((a, b) => (a.type === CT.GuildCategory) - (b.type === CT.GuildCategory)); // primero los canales, al final las categorías
  for (const c of chans) {
    try { await c.delete(REASON); res.channels++; } catch (e) { res.failedChannels.push({ id: c.id, name: c.name, err: e.message }); }
  }
  log('  🗑️ ' + res.channels + ' canales borrados' + (res.failedChannels.length ? ' (' + res.failedChannels.length + ' no se pudieron borrar todavía)' : ''));

  const protect = new Set(opts.protectRoleIds || []);
  const me = g.members.me;
  if (me) for (const r of me.roles.cache.values()) protect.add(r.id);
  for (const r of [...g.roles.cache.values()]) {
    if (r.id === g.id || r.managed) continue;
    if (protect.has(r.id)) { res.keptRoles.push(r.name); continue; }
    if (!r.editable) { res.failedRoles++; continue; }
    try { await r.delete(REASON); res.roles++; } catch (_) { res.failedRoles++; }
  }
  log('  🗑️ ' + res.roles + ' roles borrados' + (res.keptRoles.length ? ' · conservados: ' + res.keptRoles.map((n) => '@' + n).join(', ') : '') + (res.failedRoles ? ' · ' + res.failedRoles + ' por encima de mí (no puedo borrarlos)' : ''));

  // Las configuraciones que apuntaban a canales/roles borrados se limpian para no dejar referencias rotas
  const cfg = getCfg(g.id);
  for (const k of ['reports', 'honeypot', 'verification', 'tagRole', 'logs', 'lockedChannels', 'exemptChannels', 'welcome', 'goodbye', 'tickets', 'rolePanel', 'autoRole']) delete cfg[k];
  cfg.shirts = { ...(cfg.shirts || {}), channel: null };
  if (cfg.levels) { cfg.levels.rewards = []; cfg.levels.activityRole = null; }
  if (cfg.voice) cfg.voice.ignored = [];
  getCfg(g.id); // vuelve a rellenar lo borrado con los valores por defecto
  return res;
}

async function run(g, id, opts, job) {
  const tpl = T[id];
  const log = (s) => { job.lines.push(s); };
  const cfg = getCfg(g.id);
  const me = g.members.me;
  const roles = {};
  const specials = {};
  const created = new Set(); // ids de canales creados ahora

  /* ---- borrado total (solo /hacer) ---- */
  if (opts.wipe) {
    log('🧹 Borrando todo lo que había…');
    job.wipe = await wipeServer(g, opts, log);
  }

  /* ---- roles ---- */
  log('👥 Creando roles…');
  const mkRole = async (def, extra) => {
    let r = g.roles.cache.find((x) => x.name === def.name);
    if (!r) {
      r = await g.roles.create({ name: def.name, color: def.color || 0x99aab5, hoist: !!def.hoist, mentionable: !!def.mentionable, permissions: perm(def.perms || []), reason: 'Centinela: plantilla ' + id });
      log('  ✅ @' + def.name);
    } else log('  ↺ @' + def.name + ' ya existía');
    return r;
  };
  for (const key of ['admin', 'mod', 'helper']) {
    try { roles[key] = await mkRole(STAFF[key]); } catch (e) { log('  ❌ ' + STAFF[key].name + ': ' + e.message); }
  }
  roles.extra = [];
  for (const def of tpl.roles) {
    try { const r = await mkRole(def); roles.extra.push(r); if (def.founder) roles.founder = r; } catch (e) { log('  ❌ ' + def.name + ': ' + e.message); }
  }
  try { roles.member = await mkRole({ name: 'Miembro', color: 0x95a5a6 }); } catch (e) { log('  ❌ Miembro: ' + e.message); }
  try { roles.bot = await mkRole({ name: 'Bots', color: 0x5865f2 }); } catch (e) { log('  ❌ Bots: ' + e.message); }
  roles.self = [];
  for (const [name, color] of tpl.selfRoles) {
    try { roles.self.push(await mkRole({ name, color })); } catch (e) { log('  ❌ ' + name + ': ' + e.message); }
  }

  /* ---- limpieza de los canales por defecto (solo servidores nuevos) ---- */
  if (opts.clean) {
    if (g.channels.cache.size <= 8) {
      for (const c of [...g.channels.cache.values()]) {
        if (DEFAULT_NAMES.has(String(c.name).toLowerCase())) await c.delete('Centinela: plantilla').catch(() => {});
      }
      log('🧹 Canales por defecto quitados.');
    } else log('🧹 Servidor con muchos canales: no toco los existentes.');
  }

  /* ---- canales ---- */
  log('📁 Creando canales…');
  const staffIds = ['admin', 'mod', 'helper'].map((k) => roles[k] && roles[k].id).filter(Boolean);
  const overwrites = (c) => {
    const ow = [];
    const botId = me.id;
    if (c.staff) {
      ow.push({ id: g.id, deny: [P.ViewChannel] });
      for (const sid of staffIds) ow.push({ id: sid, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages] });
      ow.push({ id: botId, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] });
    } else if (c.ro) {
      ow.push({ id: g.id, deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads, P.AddReactions] });
      for (const sid of staffIds) ow.push({ id: sid, allow: [P.SendMessages] });
      ow.push({ id: botId, allow: [P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.AddReactions] });
    }
    return ow;
  };
  const cats = [BASE_INFO, ...tpl.cats, BASE_SUPPORT, BASE_STAFF];
  for (const cdef of cats) {
    try {
      const isStaffCat = cdef === BASE_STAFF;
      let cat = g.channels.cache.find((c) => c.type === CT.GuildCategory && c.name === cdef.name);
      if (!cat) cat = await g.channels.create({ name: cdef.name, type: CT.GuildCategory, permissionOverwrites: isStaffCat ? overwrites({ staff: true }) : undefined, reason: 'Centinela: plantilla ' + id });
      for (const c of cdef.ch) {
        try {
          const type = kindOf[c.k];
          const want = c.k === 'voice' ? c.name : c.name.toLowerCase().replace(/\s+/g, '-');
          let ch = g.channels.cache.find((x) => x.parentId === cat.id && (x.name === want || x.name === c.name));
          if (!ch) {
            const payload = { name: c.name, type, parent: cat.id, reason: 'Centinela: plantilla ' + id };
            if (c.topic && c.k !== 'voice') payload.topic = c.topic;
            if (c.limit) payload.userLimit = c.limit;
            const ow = overwrites(c);
            if (ow.length) payload.permissionOverwrites = ow;
            try { ch = await g.channels.create(payload); } catch (err) {
              if (c.k !== 'news') throw err;
              payload.type = CT.GuildText; // sin «Comunidad» no hay canales de anuncios
              ch = await g.channels.create(payload);
            }
            created.add(ch.id);
          }
          if (c.sp) specials[c.sp] = ch;
        } catch (e) { log('  ❌ ' + c.name + ': ' + e.message); }
      }
      log('  ✅ ' + cdef.name + ' (' + cdef.ch.length + ')');
    } catch (e) { log('  ❌ ' + cdef.name + ': ' + e.message); }
  }
  // Zona de suscriptores: solo para el rol Suscriptor
  const subRole = roles.extra.find((r) => r.name === 'Suscriptor');
  if (subRole) {
    for (const ch of [specials.sub, specials.subvoice].filter(Boolean)) {
      await ch.permissionOverwrites.set([{ id: g.id, deny: [P.ViewChannel] }, { id: subRole.id, allow: [P.ViewChannel, P.SendMessages, P.Connect, P.Speak] }, ...staffIds.map((sid) => ({ id: sid, allow: [P.ViewChannel, P.SendMessages, P.Connect] })), { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.Connect] }]).catch(() => {});
    }
  }

  /* ---- reglas ---- */
  if (specials.rules && created.has(specials.rules.id)) {
    const e = new EmbedBuilder().setColor(COLOR.blue || 0x3498db).setTitle('📜 Normas de ' + g.name).setDescription(tpl.rules.map((r, n) => '**' + (n + 1) + '.** ' + r).join('\n\n')).setFooter({ text: 'Al participar aceptas estas normas.' });
    await specials.rules.send({ embeds: [e] }).catch(() => {});
    log('📜 Normas publicadas.');
  }

  /* ---- autoroles ---- */
  if (roles.member) {
    cfg.autoRole = { enabled: true, humans: [roles.member.id], bots: roles.bot ? [roles.bot.id] : [], delaySec: 0, tempHours: 0 };
    log('🤖 Autorol: los nuevos reciben @Miembro y los bots @Bots.');
  }

  /* ---- bienvenida y despedida ---- */
  if (specials.welcome) {
    cfg.welcome = { ...cfg.welcome, enabled: true, channel: specials.welcome.id, image: true, message: '👋 ¡Bienvenido {user} a **{server}**! Lee las <#' + (specials.rules ? specials.rules.id : specials.welcome.id) + '> y elige tus roles en <#' + (specials.roles ? specials.roles.id : specials.welcome.id) + '>. Eres el miembro #{count}. 🎉' };
    log('👋 Bienvenidas activadas en #' + specials.welcome.name);
  }
  if (specials.goodbye) {
    cfg.goodbye = { ...cfg.goodbye, enabled: true, channel: specials.goodbye.id, image: false };
    log('🚪 Despedidas activadas.');
  }

  /* ---- niveles ---- */
  if (tpl.levels) { cfg.levels.enabled = true; log('📈 Niveles activados.'); }

  /* ---- roles por botones ---- */
  if (specials.roles && roles.self.length) {
    cfg.rolePanel = { ...cfg.rolePanel, channel: specials.roles.id, roles: roles.self.slice(0, 10).map((r) => r.id), mode: 'buttons', emojis: [], tempHours: 0, reactionMsg: null, reactionMap: {} };
    if (created.has(specials.roles.id)) {
      try {
        const ex = require('./extras').mods.find((m) => m.id === 'rolepanel');
        await ex.acts[0].run({ g, cfg, lc: 'es' });
        log('🎛️ Panel de roles publicado en #' + specials.roles.name);
      } catch (e) { log('  ❌ Panel de roles: ' + e.message); }
    } else log('🎛️ Panel de roles configurado (el canal ya existía: publícalo desde Roles por botones).');
  }

  /* ---- tickets ---- */
  if (specials.tickets && roles.mod) {
    cfg.tickets = { ...cfg.tickets, enabled: true, channel: specials.tickets.id, staffRole: roles.mod.id, logChannel: specials.ticketlog ? specials.ticketlog.id : null, categories: tpl.ticketCats, perUser: 1 };
    if (created.has(specials.tickets.id)) {
      try {
        const ex = require('./extras').mods.find((m) => m.id === 'tickets');
        await ex.acts[0].run({ g, cfg, lc: 'es' });
        log('🎫 Tickets listos en #' + specials.tickets.name + ' (categorías: ' + tpl.ticketCats.join(', ') + ')');
      } catch (e) { log('  ❌ Tickets: ' + e.message); }
    } else log('🎫 Tickets configurados (el canal ya existía: publica el panel desde Tickets).');
  }

  /* ---- antiraid y registros ---- */
  if (opts.antiraid !== false) {
    try {
      const r = await require('./ui').webInstall(g, opts.install || ['logs', 'antispam', 'nuke', 'guard', 'minage']);
      log('🛡️ Antiraid y registros instalados.');
      void r;
    } catch (e) { log('  ❌ Antiraid: ' + e.message); }
  }

  /* ---- fundador ---- */
  if (opts.userId && roles.founder) {
    const m = await g.members.fetch(opts.userId).catch(() => null);
    if (m) { await m.roles.add(roles.founder, 'Centinela: plantilla').catch(() => {}); log('👑 Te di el rol @' + roles.founder.name); }
    // Tras un borrado total, quien lo pidió también entra en el equipo de administración
    if (m && opts.wipe && roles.admin) await m.roles.add(roles.admin, 'Centinela: /hacer').catch(() => {});
  } else if (opts.userId && roles.admin) {
    const m = await g.members.fetch(opts.userId).catch(() => null);
    if (m) await m.roles.add(roles.admin, 'Centinela: plantilla').catch(() => {});
  }

  saveCfg();
  log('✅ ¡Listo! Sube el rol de Centinela por encima de los demás roles para que pueda gestionarlos.');
  return { roles, specials, created };
}

/*
 * opts: userId, clean, antiraid, install[] (módulos de ui.js), wipe (borrado total), keepChannelId, protectRoleIds[],
 *       after(result, job) → se ejecuta al terminar, antes de marcar el trabajo como acabado.
 */
function start(g, id, opts = {}) {
  if (!T[id]) throw new Error('Plantilla desconocida');
  const cur = jobs.get(g.id);
  if (cur && cur.running) throw new Error('Ya hay una plantilla aplicándose en este servidor.');
  const me = g.members.me;
  if (!me || !me.permissions.has(P.ManageChannels) || !me.permissions.has(P.ManageRoles)) throw new Error('Necesito los permisos Gestionar canales y Gestionar roles.');
  const job = { running: true, lines: ['🧩 Aplicando plantilla «' + T[id].n + '»…'], done: false, error: null, tpl: id, at: Date.now() };
  jobs.set(g.id, job);
  run(g, id, opts, job)
    .then(async (result) => { if (opts.after) await opts.after(result, job); })
    .catch((e) => { logErr(e); job.error = e.message; job.lines.push('❌ ' + e.message); })
    .finally(() => { job.running = false; job.done = true; });
  return job;
}
const status = (gid) => {
  const j = jobs.get(gid);
  return j ? { running: j.running, done: j.done, error: j.error, tpl: j.tpl, lines: j.lines } : { running: false, done: false, lines: [] };
};

module.exports = { T, LIST, start, status, wipeServer };
