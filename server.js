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
const voiceMod = require('./voice');
const camisasMod = require('./camisas');
const tplMod = require('./templates');
const hacerMod = require('./hacer');
const sugMod = require('./sugerencias');

// Comandos slash: /help, /guía, /putbot, /setidioma, las camisetas y /hacer. El resto se maneja con menús, botones y el prefijo.
const ALL_COMMANDS = [...uiMod.commands, ...voiceMod.commands, ...camisasMod.commands, ...hacerMod.commands];
const COMMAND_MAP = new Map(ALL_COMMANDS.map((c) => [c.data.name, c]));

const FULL_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers, // privilegiado: detectar ingresos y bots añadidos
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.MessageContent, // privilegiado: antispam, invitaciones, comandos con !
];
const LIMITED_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageReactions,
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
  // Con el login de Discord activo, solo entra el dueño del bot con su cuenta de Discord.
  const sess = typeof sessionOf === 'function' ? sessionOf(req) : null;
  if (sess && sess.admin) return next();
  if (oauthReady()) {
    if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) return res.status(401).json({ error: 'Inicia sesión con la cuenta de Discord del dueño del bot.' });
    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  }
  // Respaldo mientras el login de Discord no esté configurado
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
  let r;
  try {
    r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bot ' + token },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error('No hay respuesta de Discord (' + (err && err.name === 'TimeoutError' ? 'tiempo agotado' : (err && err.cause && err.cause.code) || (err && err.message)) + ')');
  }
  if (r.status === 401) {
    const e = new Error('Token inválido. Cópialo de nuevo desde el Developer Portal (Bot > Reset Token).');
    e.fatal = true;
    throw e;
  }
  if (!r.ok) throw new Error('Discord respondió con error ' + r.status + ' ' + (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120));
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
  const rest = new REST({ version: '10' }).setToken(config.token);
  const detail = (e) => e.message + (e.rawError ? ' ' + JSON.stringify(e.rawError.errors || e.rawError).slice(0, 600) : '');
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: ALL_COMMANDS.map((x) => x.data.toJSON()) });
    log('Comandos slash registrados (' + ALL_COMMANDS.length + '): ' + ALL_COMMANDS.map((x) => '/' + x.data.name).join(' '));
    return;
  } catch (e) {
    log('No se pudieron registrar los comandos slash: ' + detail(e));
  }
  // Un comando con formato inválido no debe tumbar a los demás: se registran primero los básicos y luego uno a uno los extra
  try {
    const extra = [...camisasMod.commands, ...hacerMod.commands];
    const base = ALL_COMMANDS.filter((x) => !extra.includes(x));
    await rest.put(Routes.applicationCommands(c.user.id), { body: base.map((x) => x.data.toJSON()) });
    log('Comandos básicos registrados (' + base.length + ')');
    for (const x of extra) {
      try { await rest.post(Routes.applicationCommands(c.user.id), { body: x.data.toJSON() }); log('Registrado /' + x.data.name); } catch (e) { log('⚠️ Discord rechaza /' + x.data.name + ': ' + detail(e)); }
    }
  } catch (e) {
    log('Tampoco se pudieron registrar los comandos básicos: ' + detail(e));
  }
}

const SITE_URL = process.env.SITE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : process.env.RENDER_EXTERNAL_URL || 'https://bot-activador-production.up.railway.app');
// Enlace directo para añadir el bot: no lleva redirect_uri, así que nunca da «OAuth2 inválido» aunque la redirección del panel no esté registrada
const inviteLink = (id) => 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(id) + '&scope=bot%20applications.commands&permissions=' + botMod.INVITE_PERMS;
async function setDescription(c) {
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    const description = '🛡️ Antiraid extremo, bienvenidas, autoroles, tickets y más. Usa /help y /guía.\nWeb y panel: ' + SITE_URL;
    await rest.patch(Routes.currentApplication(), { body: { description, install_params: null, custom_install_url: inviteLink(c.user.id) } });
    // Intenta registrar la redirección OAuth2 automáticamente (si Discord no lo permite con el token del bot, se hace a mano en el Developer Portal)
    try {
      const cur = await rest.get(Routes.currentApplication());
      const want = SITE_URL + '/auth/callback';
      const have = Array.isArray(cur.redirect_uris) ? cur.redirect_uris : [];
      if (!have.includes(want)) {
        await rest.patch(Routes.currentApplication(), { body: { redirect_uris: [...have, want] } });
        const chk = await rest.get(Routes.currentApplication());
        if (Array.isArray(chk.redirect_uris) && chk.redirect_uris.includes(want)) log('Redirección OAuth2 registrada: ' + want);
        else log('⚠️ Discord NO permite registrar la redirección con el token del bot. Añádela a mano en discord.com/developers → tu app → OAuth2 → Redirects: ' + want);
      } else {
        log('Redirección OAuth2 ya registrada');
      }
    } catch (e) {
      log('No se pudo registrar la redirección OAuth2 sola: ' + e.message);
    }
    const me = await rest.get(Routes.currentApplication());
    log('«Añadir app» → ' + (me.custom_install_url || 'SIN URL personalizada') + ' · install_params: ' + JSON.stringify(me.install_params || null));
  } catch (e) {
    log('No se pudo actualizar la descripción del bot: ' + e.message);
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

    const c = new Client({ intents: limitedIntents ? LIMITED_INTENTS : FULL_INTENTS, partials: [Partials.GuildMember, Partials.Message, Partials.User, Partials.Reaction, Partials.Channel] });
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
      setDescription(c);
      try { botMod.restoreRaidTimers(c); } catch (e) { log('restoreRaidTimers: ' + e.message); }
    };

    botMod.attach(c);
    guardMod.attach(c);
    uiMod.attach(c);
    extrasMod.attach(c);
    voiceMod.attach(c);
    camisasMod.attach(c);
    sugMod.attach(c);
    c.on('interactionCreate', async (i) => {
      try {
        if (camisasMod.owns(i)) { await camisasMod.handleInteraction(i); return; }
        if (hacerMod.owns(i)) { await hacerMod.handleComponent(i); return; }
        if (i.isAutocomplete && i.isAutocomplete()) {
          const ac = COMMAND_MAP.get(i.commandName);
          if (ac && ac.autocomplete) await ac.autocomplete(i);
          return;
        }
        if (i.isChatInputCommand()) {
          const cmd = COMMAND_MAP.get(i.commandName);
          if (cmd) await cmd.execute(i);
        } else if (i.customId && i.customId.startsWith('ui:')) {
          await uiMod.handle(i);
        } else if (i.isMessageComponent()) {
          if (i.isButton() && (await guardMod.handleButton(i))) return;
          if (await extrasMod.handleComponent(i)) return;
          if (await voiceMod.handleComponent(i)) return;
          if (!i.isButton()) return;
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

    // Diagnóstico del gateway (sin el ruido de los latidos)
    c.on('debug', (m) => { if (!/heartbeat/i.test(m)) console.log('[gw] ' + String(m).replace(/\s+/g, ' ').slice(0, 220)); });
    c.on('warn', (m) => console.log('[gw-warn] ' + String(m).slice(0, 200)));
    const watch = setTimeout(() => { if (!c.isReady()) log('Sigue sin conectar tras 60 s (estado del gateway: ' + (c.ws && c.ws.status) + ')'); }, 60000);
    watch.unref();
    log('Conectando a Discord como ' + me.username + '…');
    await c.login(config.token);
    clearTimeout(watch);
    log('Sesión iniciada en Discord');
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
// Al abrir la web lo primero es iniciar sesión con Discord (la presentación queda en /info)
app.get('/', (_req, res) => res.redirect('/dashboard.html'));
app.get('/info', (_req, res) => res.sendFile(path.join(__dirname, 'site', 'index.html')));
app.use(express.static(path.join(__dirname, 'site'), { index: false }));
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
app.get('/panel/dashboard.html', (_req, res) => res.redirect('/dashboard.html'));
app.use('/panel', auth, express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

function currentState() {
  if (!config.enabled || !config.token) return 'detenido';
  if (client && client.isReady()) return 'en_linea';
  if (fatal) return 'error';
  return 'conectando';
}

app.get('/api/status', auth, (_req, res) => {
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

app.post('/api/connect', auth, async (req, res) => {
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

app.post('/api/stop', auth, async (_req, res) => {
  config.enabled = false;
  saveConfig();
  await stopClient();
  log('Bot detenido desde el panel');
  res.json({ ok: true });
});

app.post('/api/restart', auth, (_req, res) => {
  if (!config.token) return res.status(400).json({ error: 'Primero configura el token y el ID.' });
  config.enabled = true;
  saveConfig();
  attempt = 0;
  limitedIntents = false;
  log('Reinicio manual');
  startBot();
  res.json({ ok: true });
});

/* ---------- Sesiones y login con Discord ---------- */
const sessions = new Map(); // sid -> { admin, uid, name, avatar, guilds:Set, exp }
const SESSION_MS = 7 * 24 * 3600 * 1000;
const oauthStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
  for (const [k, v] of oauthStates) if (v.exp < now) oauthStates.delete(k);
}, 600000).unref();

const baseUrl = (req) => process.env.SITE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : process.env.RENDER_EXTERNAL_URL || req.protocol + '://' + req.get('host'));
const cookieOf = (req, name) => {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
};
function setCookie(req, res, name, value, maxAgeMs) {
  res.append('Set-Cookie', name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(maxAgeMs / 1000) + (req.secure ? '; Secure' : ''));
}
function sessionOf(req) {
  const sid = cookieOf(req, 'cs');
  const s = sid && sessions.get(sid);
  return s && s.exp > Date.now() ? s : null;
}
function startSession(req, res, data) {
  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, { ...data, exp: Date.now() + SESSION_MS });
  setCookie(req, res, 'cs', sid, SESSION_MS);
}
const oauthReady = () => !!config.id; // flujo implícito: no necesita secreto del cliente

async function botOwners() {
  const ids = new Set(String(process.env.BOT_OWNER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean));
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    const a = await rest.get(Routes.currentApplication());
    if (a.team && a.team.members) for (const m of a.team.members) ids.add(m.user.id);
    else if (a.owner) ids.add(a.owner.id);
  } catch (e) {
    log('No se pudo leer el dueño del bot: ' + e.message);
  }
  return ids;
}

app.get('/auth/login', (req, res) => {
  if (!oauthReady()) return res.redirect('/dashboard.html?e=nosetup');
  const state = crypto.randomBytes(16).toString('base64url');
  const next = String(req.query.next || '');
  oauthStates.set(state, { exp: Date.now() + 600000, next: next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard.html' });
  const url = 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(config.id) + '&response_type=token&scope=identify%20guilds&prompt=none&state=' + state + '&redirect_uri=' + encodeURIComponent(baseUrl(req) + '/auth/callback');
  res.redirect(url);
});

// Discord devuelve el token en el fragmento (#), que solo ve el navegador: esta página lo pasa al servidor.
app.get('/auth/callback', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrando…</title>
<body style="background:#0b1626;color:#c9d4e3;font:16px system-ui;padding:40px"><p id="m">Entrando con Discord…</p>
<script>
(async function(){
  var h=new URLSearchParams(location.hash.slice(1)),q=new URLSearchParams(location.search);
  if(!h.get('access_token')){location.replace('/dashboard.html?e='+(q.get('error')?'denied':'state'));return}
  try{
    var r=await fetch('/auth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:h.get('access_token'),state:h.get('state')})});
    var j=await r.json();
    if(!r.ok)throw new Error(j.error);
    location.replace(j.next||'/dashboard.html');
  }catch(e){location.replace('/dashboard.html?e=token')}
})();
</script></body>`);
});

app.post('/auth/token', async (req, res) => {
  try {
    const { access_token: tok, state } = req.body || {};
    const st = oauthStates.get(state);
    if (!oauthReady() || !tok || !st) return res.status(400).json({ error: 'state' });
    oauthStates.delete(state);
    const h = { Authorization: 'Bearer ' + tok };
    const info = await fetch('https://discord.com/api/v10/oauth2/@me', { headers: h });
    if (!info.ok) return res.status(400).json({ error: 'token' });
    const ij = await info.json();
    if (!ij.application || ij.application.id !== String(config.id) || !ij.user) return res.status(400).json({ error: 'app' });
    const me = ij.user;
    const gl = await (await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: h })).json();
    const manageList = (Array.isArray(gl) ? gl : []).filter((g) => g.owner || (BigInt(g.permissions || 0) & 0x28n) !== 0n).map((g) => ({ id: g.id, name: g.name }));
    const owners = await botOwners();
    const isOwner = owners.has(me.id);
    startSession(req, res, { admin: isOwner, uid: me.id, name: me.global_name || me.username, avatar: me.avatar ? 'https://cdn.discordapp.com/avatars/' + me.id + '/' + me.avatar + '.png?size=64' : null, guilds: new Set(manageList.map((g) => g.id)), manageList });
    res.json({ next: isOwner && st.next ? st.next : '/dashboard.html' });
  } catch (e) {
    log('Login con Discord falló: ' + e.message);
    res.status(400).json({ error: 'token' });
  }
});

// Respaldo: solo funciona mientras el login de Discord no esté configurado
app.get('/auth/admin', (req, res, next) => (oauthReady() ? res.redirect('/auth/login') : next()), auth, (req, res) => {
  startSession(req, res, { admin: true, uid: null, name: 'Administrador', avatar: null, guilds: new Set() });
  res.redirect('/dashboard.html');
});

app.get('/auth/logout', (req, res) => {
  const sid = cookieOf(req, 'cs');
  if (sid) sessions.delete(sid);
  setCookie(req, res, 'cs', '', 0);
  res.redirect('/dashboard.html');
});

app.get('/api/me', (req, res) => {
  const s = sessionOf(req);
  res.json({ loggedIn: !!s, admin: !!(s && s.admin), name: s ? s.name : null, avatar: s ? s.avatar : null, oauth: oauthReady() });
});

/* ---------- Panel completo de configuración (sesión de Discord o administrador) ---------- */
function dashAuth(req, res, next) {
  const s = sessionOf(req);
  if (!s) return res.status(401).json({ error: 'Inicia sesión para configurar tu servidor.' });
  req.sess = s;
  next();
}
async function guildOf(req, res) {
  const g = client && client.isReady() ? client.guilds.cache.get(req.params.id) : null;
  if (!g) { res.status(404).json({ error: 'Servidor no encontrado o el bot está desconectado.' }); return null; }
  const s = req.sess;
  if (!s.admin) {
    if (!s.guilds.has(g.id)) { res.status(403).json({ error: 'No tienes permisos de administrador en ese servidor.' }); return null; }
    const m = await g.members.fetch(s.uid).catch(() => null);
    if (!botMod.canConfigure(g, s.uid, m)) { res.status(403).json({ error: 'Máxima seguridad activa: solo el dueño del servidor o la lista de confianza pueden cambiar esto.' }); return null; }
  }
  return g;
}
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); }
};
app.get('/api/guilds', dashAuth, (req, res) => {
  const online = !!(client && client.isReady());
  const inv = (gid) => 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(config.id) + '&scope=bot%20applications.commands&permissions=' + botMod.INVITE_PERMS + '&guild_id=' + gid + '&disable_guild_select=true';
  const present = online ? client.guilds.cache.filter((g) => req.sess.admin || req.sess.guilds.has(g.id)) : [];
  const guilds = online ? present.map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), members: g.memberCount })) : [];
  const have = new Set(guilds.map((g) => g.id));
  const available = !req.sess.admin && config.id ? (req.sess.manageList || []).filter((g) => !have.has(g.id)).map((g) => ({ id: g.id, name: g.name, invite: inv(g.id) })) : [];
  res.json({ online, guilds, available });
});
app.get('/api/guild/:id', dashAuth, wrap(async (req, res) => { const g = await guildOf(req, res); if (g) res.json(uiMod.webGuild(g)); }));
app.post('/api/guild/:id/mod/:mod', dashAuth, wrap(async (req, res) => { const g = await guildOf(req, res); if (g) res.json(await uiMod.webApply(g, req.params.mod, req.body || {})); }));
app.post('/api/guild/:id/act/:mod/:key', dashAuth, wrap(async (req, res) => { const g = await guildOf(req, res); if (g) res.json(await uiMod.webAct(g, req.params.mod, req.params.key)); }));
app.get('/api/templates', dashAuth, (_req, res) => res.json({ templates: tplMod.LIST() }));
app.post('/api/guild/:id/template', dashAuth, wrap(async (req, res) => {
  const g = await guildOf(req, res); if (!g) return;
  const b = req.body || {};
  const job = tplMod.start(g, String(b.id || ''), { clean: !!b.clean, antiraid: b.antiraid !== false, userId: req.sess.admin ? null : req.sess.uid });
  res.json({ started: true, lines: job.lines });
}));
app.get('/api/guild/:id/template/status', dashAuth, wrap(async (req, res) => { const g = await guildOf(req, res); if (g) res.json(tplMod.status(g.id)); }));
app.post('/api/guild/:id/install', dashAuth, wrap(async (req, res) => { const g = await guildOf(req, res); if (g) res.json(await uiMod.webInstall(g, (req.body || {}).ids)); }));

app.listen(PORT, () => {
  console.log('Panel listo en el puerto ' + PORT);
  if (config.enabled && config.token) {
    log('Configuración encontrada: iniciando el bot automáticamente');
    startBot();
  }
  // Render (plan gratis) duerme el servicio sin visitas: se hace una visita propia cada 10 minutos
  if (process.env.RENDER_EXTERNAL_URL && process.env.KEEPALIVE !== 'off') {
    setInterval(() => { fetch(process.env.RENDER_EXTERNAL_URL + '/health').catch(() => {}); }, 600000).unref();
  }
});

/* ---------- Robustez del proceso ---------- */
process.on('unhandledRejection', (e) => log('unhandledRejection: ' + (e && e.message ? e.message : e)));
process.on('uncaughtException', (e) => log('uncaughtException: ' + e.message));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await stopClient();
    try { await require('./dbstore').flush(); } catch (_) { /* nada pendiente */ }
    process.exit(0);
  });
}
