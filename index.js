'use strict';

require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const db = require('./src/db');
const { commands } = require('./src/commands');
const { handleInteraction } = require('./src/components');
const { safeError } = require('./src/helpers');

// Acepta tanto los nombres nuevos (DISCORD_BOT_TOKEN/CLIENT_ID) como los que usaba
// Centinela (BOT_TOKEN/BOT_ID), para no depender de que alguien reconfigure las
// variables de entorno ya existentes en el servicio al reutilizar el mismo bot.
const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.BOT_ID;

if (!TOKEN) {
  console.error('[boot] Falta el token del bot en las variables de entorno (DISCORD_BOT_TOKEN o BOT_TOKEN). El bot no puede arrancar sin ella.');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error('[boot] Falta el ID de la aplicación en las variables de entorno (CLIENT_ID o BOT_ID). El bot no puede registrar sus comandos sin él.');
  process.exit(1);
}

// Servidor mínimo de salud: Render (y servicios similares) esperan que un "Web Service"
// escuche en process.env.PORT; este bot no sirve nada por HTTP más allá de esto.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Ultimate Team bot activo.');
}).listen(PORT, () => console.log('[http] Escuchando en el puerto ' + PORT));

// En el plan gratuito, Render apaga el contenedor tras ~15 minutos sin tráfico HTTP
// entrante, lo que mataría también la conexión con Discord. Para evitarlo, el propio
// servicio se hace una petición a sí mismo cada 10 minutos (igual que hacía Centinela).
// Si KEEPALIVE=off, o no hay URL pública conocida, esto se desactiva.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL || null;
if (SELF_URL && process.env.KEEPALIVE !== 'off') {
  setInterval(() => {
    fetch(SELF_URL).catch((e) => console.error('[keepalive] Fallo el auto-ping:', e.message));
  }, 10 * 60 * 1000).unref();
  console.log('[keepalive] Auto-ping activado hacia ' + SELF_URL + ' cada 10 minutos.');
} else {
  console.log('[keepalive] Desactivado (sin RENDER_EXTERNAL_URL o KEEPALIVE=off). En el plan gratuito, Render puede dormir el servicio tras inactividad.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = commands.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
  console.log('[comandos] ' + commands.length + ' comandos registrados globalmente.');
  if (process.env.DEV_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, process.env.DEV_GUILD_ID), { body });
    console.log('[comandos] También registrados en el servidor de pruebas ' + process.env.DEV_GUILD_ID + ' (propagación instantánea).');
  }
}

client.once('ready', async () => {
  console.log('[boot] Conectado como ' + client.user.tag);
  try {
    await db.migrate();
  } catch (e) {
    console.error('[boot] No se pudo preparar la base de datos:', e.message);
    process.exit(1);
  }
  try {
    await registerCommands();
  } catch (e) {
    console.error('[boot] No se pudieron registrar los comandos:', e.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.guildId) {
      if (interaction.isRepliable()) await interaction.reply({ content: 'Este bot solo funciona dentro de un servidor.', flags: 64 });
      return;
    }
    if (interaction.isChatInputCommand()) {
      const cmd = commands.find((c) => c.data.name === interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }
    await handleInteraction(interaction);
  } catch (e) {
    await safeError(interaction, e);
  }
});

client.on('error', (e) => console.error('[discord] Error del cliente:', e.message));
process.on('unhandledRejection', (e) => console.error('[proceso] Rechazo no controlado:', e));

client.login(TOKEN);
