'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client, GatewayIntentBits, Partials, ActivityType, REST, Routes, MessageFlags } = require('discord.js');
const botMod = require('./bot');
const gamesMod = require('./games');
const guardMod = require('./guard');
const uiMod = require('./ui');
const extrasMod = require('./extras');

// Único comando slash: /help. El resto se maneja con menús, botones y el prefijo.
const ALL_COMMANDS = [...uiMod.commands];
const COMMAND_MAP = new Map(ALL_COMMANDS.map((c) => [c.data.name, c]));

const FULL_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers, // privilegiado: detectar ingresos y bots añadidos
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent, // privilegiado: antispam, invitaciones, comandos con !
];
const LIMITED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildMessages,
];
let limitedIntents = false;

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- Contraseña del panel (protege el token) ---------- */
let PANEL_PASSWORD = process.env.PANEL_PASSWORD;
if (!PANEL_PASSWORD) {
  PANEL_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.log('\n[!] No definiste PANEL_PASSWORD. Contraseña temporal del panel:');
  console.log('    usuario: admin');
  console.log('    clave:   ' + PANEL_PASSWORD + '\n');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString();
    const i = decoded.indexOf(':');
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    if (safeEqual(user, 'admin') && safeEqual(pass, PANEL_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Panel del bot"');
  res.status(401).send('Autenticación requerida');
}

/* ---------- Configuración persistente ---------- */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    // Alternativa para hosts sin disco persistente: variables de entorno
    if (process.env.BOT_TOKEN && process.env.BOT_ID) {
      return {
        token: process.env.BOT_TOKEN,
        id: process.env.BOT_ID,
        presence: process.env.BOT_PRESENCE || 'online',
        activityText: process.env.BOT_ACTIVITY || '',
        enabled: true,
      };
    }
    return { token: '', id: '', presence: 'online', activityText: '', enabled: false };
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

let config = loadConfig();

/* ---------- Registro en memoria ---------- */
const logs = [];
function log(msg) {
  logs.unshift({ t: Date.now(), msg });
  if (logs.length > 60) logs.length = 60;
  console.log('[bot] ' + msg);
}

/* ---------- Gestor del bot ---------- */
let client = null;
let starting = false;
let readyAt = null;
let lastError = null;
let fatal = false; // token inválido: no tiene sentido reintentar
let restarts = 0;
let attempt = 0;
let retryTimer = null;
let downSince = null;

async function validate(token, id) {
  const r = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: 'Bot ' + token },
  });
  if (r.status === 401) {
    const e = new Error('Token inválido. Cópialo de nuevo desde el Developer Portal (Bot > Reset Token).');
    e.fatal = true;
    throw e;
  }
  if (!r.ok) throw new Error('Discord respondió con error ' + r.status);
  const me = await r.json();
  if (id && me.id !== String(id)) {
    const e = new Error('El ID no coincide con el bot de ese token (el token pertenece al bot ' + me.id + ').');
    e.fatal = true;
    throw e;
  }
  return me;
}

async function stopClient() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (client) {
    try { await client.destroy(); } catch (_) {}
    client = null;
  }
  readyAt = null;
}

function applyPresence() {
  if (!client || !client.isReady()) return;
  try {
    client.user.setPresence({
      status: config.presence || 'online',
      activities: config.activityText
        ? [{ name: config.activityText, type: ActivityType.Playing }]
        : [],
    });
  } catch (e) {
    log('No se pudo fijar la presencia: ' + e.message);
  }
}

async function registerCommands(c) {
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationCommands(c.user.id), { body: ALL_COMMANDS.map((x) => x.data.toJSON()) });
    log('Comandos slash registrados (' + ALL_COMMANDS.length + ')');
  } catch (e) {
    log('No se pudieron registrar los comandos slash: ' + e.message);
  }
}

function scheduleRestart(reason) {
  if (!config.enabled || fatal) return;
  clearTimeout(retryTimer);
  const delay = Math.min(60000, 3000 * Math.pow(2, attempt));
  attempt++;
  log(reason + '. Reintentando en ' + Math.round(delay / 1000) + ' s…');
  retryTimer = setTimeout(() => {
    retryTimer = null;
    restarts++;
    startBot();
  }, delay);
}

async function startBot() {
  if (starting) return;
  starting = true;
  fatal = false;
  try {
    await stopClient();
    log('Validando token e ID…');
    const me = await validate(config.token, config.id);

    const c = new Client({ intents: limitedIntents ? LIMITED_INTENTS : FULL_INTENTS, partials: [Partials.GuildMember, Partials.Message, Partials.User] });
    client = c;
    let readyHandled = false;
    const onReady = () => {
      if (readyHandled) return;
      readyHandled = true;
      readyAt = Date.now();
      attempt = 0;
      downSince = null;
      lastError = null;
      log('Bot en línea como ' + c.user.tag);
      applyPresence();
      registerCommands(c);
      try { botMod.restoreRaidTimers(c); } catch (e) { log('restoreRaidTimers: ' + e.message); }
    };

    botMod.attach(c);
    guardMod.attach(c);
    uiMod.attach(c);
    extrasMod.attach(c);
    c.on('interactionCreate', async (i) => {
      try {
        if (i.isChatInputCommand()) {
          const cmd = COMMAND_MAP.get(i.commandName);
          if (cmd) await cmd.execute(i);
        } else if (i.customId && i.customId.startsWith('ui:')) {
          await uiMod.handle(i);
        } else if (i.isButton()) {
          if (await guardMod.handleButton(i)) return;
          if (await extrasMod.handleButton(i)) return;
          await gamesMod.handleButton(i);
        }
      } catch (e) {
        log('Error en interacción: ' + e.message);
        const msg = { content: '⚠️ ' + e.message.slice(0, 300), flags: MessageFlags.Ephemeral };
        try {
          if (i.deferred || i.replied) await i.followUp(msg);
          else await i.reply(msg);
        } catch (_) {}
      }
    });
    c.once('clientReady', onReady);
    c.once('ready', onReady);
    c.on('shardDisconnect', (ev, id) => log('Shard ' + id + ' desconectado (código ' + (ev && ev.code) + '). Reconectando…'));
    c.on('shardResume', () => { log('Conexión reanudada'); applyPresence(); });
    c.on('error', (e) => { lastError = e.message; log('Error del cliente: ' + e.message); });
    c.on('invalidated', () => { readyAt = null; scheduleRestart('Sesión invalidada'); });

    await c.login(config.token);
    log('Conectando a Discord como ' + me.username + '…');
  } catch (e) {
    lastError = e.message;
    log('Fallo al iniciar: ' + e.message);
    if (e.fatal) {
      fatal = true;
    } else if (/disallowed intents/i.test(e.message) && !limitedIntents) {
      // Intents privilegiados no activados en el Developer Portal: arrancar igual con los básicos
      limitedIntents = true;
      log('⚠️ Intents privilegiados desactivados en el Developer Portal. Arrancando en modo limitado (sin detección de ingresos ni lectura de mensajes). Actívalos y pulsa Reiniciar.');
      retryTimer = setTimeout(() => { retryTimer = null; startBot(); }, 500);
    } else {
      scheduleRestart('No se pudo conectar');
    }
  } finally {
    starting = false;
  }
}

/* Vigilante: si el bot lleva > 90 s caído, lo reinicia. También reafirma la presencia. */
setInterval(() => {
  if (!config.enabled || fatal || starting || retryTimer) return;
  if (!client || !client.isReady()) {
    if (!downSince) downSince = Date.now();
    if (Date.now() - downSince > 90000) {
      downSince = null;
      restarts++;
      log('El vigilante detectó el bot caído. Reiniciando…');
      startBot();
    }
  } else {
    downSince = null;
  }
}, 30000);

setInterval(applyPresence, 10 * 60 * 1000);

/* ---------- API ---------- */
const app = express();
app.use(express.json({ limit: '50kb' }));

// Sin autenticación: para servicios de monitoreo (UptimeRobot, etc.)
app.get('/health', (_req, res) => {
  res.json({ ok: true, bot: currentState() });
});

// Web pública (sin contraseña) y datos públicos
app.use(express.static(path.join(__dirname, 'site')));
app.get('/api/public', (_req, res) => {
  const online = client && client.isReady();
  res.json({
    online: !!online,
    guilds: online ? client.guilds.cache.size : null,
    ping: online ? client.ws.ping : null,
    uptimeMs: readyAt ? Date.now() - readyAt : 0,
    commandCount: ALL_COMMANDS.length,
    prefix: '$',
    inviteUrl: config.id
      ? 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(config.id) + '&scope=bot%20applications.commands&permissions=' + botMod.INVITE_PERMS
      : null,
    commands: (guardMod.CMDS || []).filter((c) => c.d).map((c) => ({ name: c.name, en: c.d, es: c.es || c.d, level: c.level || 'public', aliases: c.aliases || [], slash: !!c.slash })),
  });
});

// Panel privado
app.use('/panel', auth, express.static(path.join(__dirname, 'public')));
app.use('/api', auth);

function currentState() {
  if (!config.enabled || !config.token) return 'detenido';
  if (client && client.isReady()) return 'en_linea';
  if (fatal) return 'error';
  return 'conectando';
}

app.get('/api/status', (_req, res) => {
  const online = client && client.isReady();
  res.json({
    configured: !!config.token,
    state: currentState(),
    id: config.id || '',
    presence: config.presence,
    activityText: config.activityText,
    tokenHint: config.token ? '••••••' + config.token.slice(-4) : '',
    bot: online
      ? { tag: client.user.tag, id: client.user.id, avatar: client.user.displayAvatarURL({ size: 64 }) }
      : null,
    uptimeMs: readyAt ? Date.now() - readyAt : 0,
    ping: online ? client.ws.ping : null,
    guilds: online ? client.guilds.cache.size : null,
    restarts,
    lastError,
    limitedIntents,
    commandCount: ALL_COMMANDS.length,
    inviteUrl: config.id
      ? 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(config.id) + '&scope=bot%20applications.commands&permissions=' + botMod.INVITE_PERMS
      : null,
    logs,
  });
});

app.post('/api/connect', async (req, res) => {
  const { token, id, presence, activityText } = req.body || {};
  const newToken = (token || '').trim() || config.token;
  const newId = String(id || '').trim();
  if (!newToken) return res.status(400).json({ error: 'Falta el token.' });
  if (!/^\d{15,25}$/.test(newId)) return res.status(400).json({ error: 'El ID debe ser numérico (17–20 dígitos).' });
  if (!['online', 'idle', 'dnd', 'invisible'].includes(presence || 'online')) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  try {
    await validate(newToken, newId); // da error claro antes de guardar
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  config = {
    token: newToken,
    id: newId,
    presence: presence || 'online',
    activityText: String(activityText || '').slice(0, 100),
    enabled: true,
  };
  saveConfig();
  attempt = 0;
  restarts = 0;
  limitedIntents = false;
  startBot();
  res.json({ ok: true });
});

app.post('/api/stop', async (_req, res) => {
  config.enabled = false;
  saveConfig();
  await stopClient();
  log('Bot detenido desde el panel');
  res.json({ ok: true });
});

app.post('/api/restart', (_req, res) => {
  if (!config.token) return res.status(400).json({ error: 'Primero configura el token y el ID.' });
  config.enabled = true;
  saveConfig();
  attempt = 0;
  limitedIntents = false;
  log('Reinicio manual');
  startBot();
  res.json({ ok: true });
});

/* ---------- Panel completo de configuración (protegido por /api auth) ---------- */
function guildOf(req, res) {
  const g = client && client.isReady() ? client.guilds.cache.get(req.params.id) : null;
  if (!g) res.status(404).json({ error: 'Servidor no encontrado o el bot está desconectado.' });
  return g;
}
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); }
};
app.get('/api/guilds', (_req, res) => {
  if (!client || !client.isReady()) return res.json([]);
  res.json(client.guilds.cache.map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), members: g.memberCount })));
});
app.get('/api/guild/:id', wrap(async (req, res) => { const g = guildOf(req, res); if (g) res.json(uiMod.webGuild(g)); }));
app.post('/api/guild/:id/mod/:mod', wrap(async (req, res) => { const g = guildOf(req, res); if (g) res.json(await uiMod.webApply(g, req.params.mod, req.body || {})); }));
app.post('/api/guild/:id/act/:mod/:key', wrap(async (req, res) => { const g = guildOf(req, res); if (g) res.json(await uiMod.webAct(g, req.params.mod, req.params.key)); }));
app.post('/api/guild/:id/install', wrap(async (req, res) => { const g = guildOf(req, res); if (g) res.json(await uiMod.webInstall(g, (req.body || {}).ids)); }));

app.listen(PORT, () => {
  console.log('Panel listo en el puerto ' + PORT);
  if (config.enabled && config.token) {
    log('Configuración encontrada: iniciando el bot automáticamente');
    startBot();
  }
});

/* ---------- Robustez del proceso ---------- */
process.on('unhandledRejection', (e) => log('unhandledRejection: ' + (e && e.message ? e.message : e)));
process.on('uncaughtException', (e) => log('uncaughtException: ' + e.message));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await stopClient();
    process.exit(0);
  });
}
