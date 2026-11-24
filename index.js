// LLF Transfers Bot - base funcional en un solo archivo
// Requisitos: npm install discord.js dotenv
// Crea un archivo .env con:
// TOKEN=TU_TOKEN
// CLIENT_ID=ID_DE_TU_BOT
// GUILD_ID=ID_DE_TU_SERVIDOR   (opcional, recomendado para registrar comandos rápido)

require("dotenv").config();

// En Render las variables ya existían con otros nombres (DISCORD_BOT_TOKEN / BOT_TOKEN y BOT_ID).
// Se aceptan todos para no tener que renombrarlas.
const ENV_TOKEN = process.env.TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
const ENV_CLIENT_ID = process.env.CLIENT_ID || process.env.BOT_ID;
if (ENV_TOKEN) process.env.TOKEN = ENV_TOKEN;
if (ENV_CLIENT_ID) process.env.CLIENT_ID = ENV_CLIENT_ID;

const fs = require("fs");
const path = require("path");
const http = require("http");

// Render ("Web Service") exige que el proceso escuche en process.env.PORT.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Centinela bot activo.");
}).listen(PORT, () => console.log(`[http] Escuchando en el puerto ${PORT}`));

// En el plan gratuito, Render duerme el servicio tras ~15 min sin tráfico HTTP;
// el bot se hace un auto-ping cada 10 minutos para seguir conectado a Discord.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL || null;
if (SELF_URL && process.env.KEEPALIVE !== "off") {
  setInterval(() => {
    fetch(SELF_URL).catch(e => console.error("[keepalive] Fallo el auto-ping:", e.message));
  }, 10 * 60 * 1000).unref();
  console.log(`[keepalive] Auto-ping activado hacia ${SELF_URL} cada 10 minutos.`);
}
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function file(name, fallback) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
  return p;
}

const CONFIG_FILE = file("config.json", {});
const TEAMS_FILE = file("teams.json", {});
const TRANSFERS_FILE = file("transfers.json", []);
const PENDING_FILE = file("pending.json", {});
const ROSTER_FILE = file("roster.json", {});

const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const write = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

function cfg(guildId) {
  const all = read(CONFIG_FILE);
  if (!all[guildId]) {
    all[guildId] = {
      transferChannel: null,
      budgetChannel: null,
      budgetMessage: null,
      transferNumber: 0,
      fichajeRole: null,
      offersLogChannel: null
    };
    write(CONFIG_FILE, all);
  }
  if (all[guildId].fichajeRole === undefined) all[guildId].fichajeRole = null;
  if (all[guildId].offersLogChannel === undefined) all[guildId].offersLogChannel = null;
  // ajustes de los comandos en español (/config, /mercado)
  if (!Array.isArray(all[guildId].staffRoles)) all[guildId].staffRoles = [];
  if (!Array.isArray(all[guildId].helperRoles)) all[guildId].helperRoles = [];
  if (!Array.isArray(all[guildId].directorRoles)) all[guildId].directorRoles = [];
  if (all[guildId].mercadoAbierto === undefined) all[guildId].mercadoAbierto = false;
  if (all[guildId].temporada === undefined) all[guildId].temporada = 1;
  return all[guildId];
}
function saveCfg(guildId, value) {
  const all = read(CONFIG_FILE);
  all[guildId] = value;
  write(CONFIG_FILE, all);
}
function teams(guildId) {
  const all = read(TEAMS_FILE);
  if (!all[guildId]) {
    all[guildId] = {};
    write(TEAMS_FILE, all);
  }
  return all[guildId];
}
function saveTeams(guildId, value) {
  const all = read(TEAMS_FILE);
  all[guildId] = value;
  write(TEAMS_FILE, all);
}
function roster(guildId) {
  const all = read(ROSTER_FILE);
  if (!all[guildId]) {
    all[guildId] = {};
    write(ROSTER_FILE, all);
  }
  return all[guildId];
}
function saveRoster(guildId, value) {
  const all = read(ROSTER_FILE);
  all[guildId] = value;
  write(ROSTER_FILE, all);
}

function money(value) {
  if (!value) return 0;
  const t = String(value).trim().toUpperCase().replace(/[€$]/g, "").replace(",", ".");
  if (t.endsWith("M")) return Number(t.slice(0, -1)) * 1000000;
  if (t.endsWith("K")) return Number(t.slice(0, -1)) * 1000;
  return Number(t);
}
function formatMoney(n) {
  if (n < 0) return `-${formatMoney(-n)}`;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(".0", "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".0", "")}K`;
  return String(n);
}

async function updateBudgetPanel(guild) {
  const c = cfg(guild.id);
  if (!c.budgetChannel) return;
  const channel = await guild.channels.fetch(c.budgetChannel).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const allTeams = teams(guild.id);
  const lines = Object.values(allTeams)
    .sort((a, b) => b.budget - a.budget)
    .map(t => `🏆 <@&${t.roleId}> — 💵 **${formatMoney(t.budget)}**`);

  const embed = new EmbedBuilder()
    .setTitle("💰 PRESUPUESTOS DE CLUBES")
    .setDescription(lines.length ? lines.join("\n") : "Todavía no hay clubes añadidos.")
    .setFooter({ text: "El panel se actualiza automáticamente." });

  let message = null;
  if (c.budgetMessage) message = await channel.messages.fetch(c.budgetMessage).catch(() => null);

  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    const sent = await channel.send({ embeds: [embed] });
    c.budgetMessage = sent.id;
    saveCfg(guild.id, c);
  }
}

const CLAUSULA_OPTIONS_M = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 240, 250];
const CESION_DURATION_OPTIONS = ["1 partido", "3 partidos", "5 partidos", "10 partidos", "15 partidos", "Media temporada", "1 temporada", "2 temporadas", "3 temporadas"];

// ===== Comandos en español (estilo LLV): definición =====
const CLAUSULA_CHOICES = CLAUSULA_OPTIONS_M.map(v => ({ name: `${v}M`, value: `${v}M` }));
const TEMPORADAS_CHOICES = Array.from({ length: 10 }, (_, i) => ({ name: `${i + 1} temporada${i ? "s" : ""}`, value: `T${i + 1}` }));
const CESION_CHOICES = CESION_DURATION_OPTIONS.map(v => ({ name: v, value: v }));

const optClub = (o, desc = "Club") => o.setName("club").setDescription(desc).setRequired(true);
const optJugador = o => o.setName("jugador").setDescription("Jugador").setRequired(true);
const optRol = (o, required) => o.setName("rol").setDescription(required ? "Rol" : "Rol (vacío = quitar todos)").setRequired(required);
const optCanal = o => o.setName("canal").setDescription("Canal").setRequired(true).addChannelTypes(ChannelType.GuildText);
const MOTIVOS = ["Inactividad", "Exceso", "Fichaje ilegal", "No contamos con él", "Otro"].map(v => ({ name: v, value: v }));

const esCommands = [
  new SlashCommandBuilder().setName("club").setDescription("Gestión de clubes")
    .addSubcommand(s => s.setName("crear").setDescription("Crear un club y asociarle un rol de Discord")
      .addRoleOption(o => o.setName("rol").setDescription("Rol del club").setRequired(true))
      .addStringOption(o => o.setName("presupuesto").setDescription("Presupuesto inicial (ej: 50M). Por defecto 50M"))
      .addUserOption(o => o.setName("director").setDescription("Director del club (opcional)"))
      .addUserOption(o => o.setName("director2").setDescription("Segundo director (opcional)")))
    .addSubcommand(s => s.setName("presupuesto").setDescription("Modificar el presupuesto de un club")
      .addRoleOption(o => optClub(o))
      .addStringOption(o => o.setName("accion").setDescription("Qué quieres hacer").setRequired(true)
        .addChoices({ name: "Sumar", value: "sumar" }, { name: "Restar", value: "restar" }, { name: "Fijar cantidad exacta", value: "fijar" }))
      .addStringOption(o => o.setName("cantidad").setDescription("Cantidad (ej: 10M o 500K)").setRequired(true)))
    .addSubcommand(s => s.setName("presupuestos").setDescription("Tabla de presupuestos de todos los clubes"))
    .addSubcommand(s => s.setName("info").setDescription("Ver la información de un club")
      .addRoleOption(o => optClub(o)))
    .addSubcommand(s => s.setName("lista").setDescription("Ver todos los clubes registrados"))
    .addSubcommand(s => s.setName("renombrar").setDescription("Cambiar el nombre de un club")
      .addRoleOption(o => optClub(o))
      .addStringOption(o => o.setName("nombre").setDescription("Nuevo nombre").setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName("eliminar").setDescription("Eliminar un club (sus jugadores quedan libres)")
      .addRoleOption(o => optClub(o, "Club a eliminar"))),

  new SlashCommandBuilder().setName("config").setDescription("Permisos del bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("rol_staff").setDescription("Añadir un rol autorizado a gestionar el bot")
      .addRoleOption(o => optRol(o, true)))
    .addSubcommand(s => s.setName("rol_ayudante").setDescription("Añadir un rol autorizado a gestionar los jugadores")
      .addRoleOption(o => optRol(o, true)))
    .addSubcommand(s => s.setName("rol_director").setDescription("Añadir un rol autorizado a usar los comandos habituales")
      .addRoleOption(o => optRol(o, true)))
    .addSubcommand(s => s.setName("quitar_rol_staff").setDescription("Quitar un rol staff, o todos si se deja vacío")
      .addRoleOption(o => optRol(o, false)))
    .addSubcommand(s => s.setName("quitar_rol_ayudante").setDescription("Quitar un rol ayudante, o todos si se deja vacío")
      .addRoleOption(o => optRol(o, false)))
    .addSubcommand(s => s.setName("quitar_rol_director").setDescription("Quitar un rol director, o todos si se deja vacío")
      .addRoleOption(o => optRol(o, false)))
    .addSubcommand(s => s.setName("canal_fichajes").setDescription("Canal donde se anuncian las operaciones")
      .addChannelOption(o => optCanal(o)))
    .addSubcommand(s => s.setName("canal_presupuestos").setDescription("Canal con el panel de presupuestos (se actualiza solo)")
      .addChannelOption(o => optCanal(o)))
    .addSubcommand(s => s.setName("canal_logs").setDescription("Canal donde se registran todas las ofertas")
      .addChannelOption(o => optCanal(o)))
    .addSubcommand(s => s.setName("nombre_bot").setDescription("Cambiar el nombre del bot en este servidor")
      .addStringOption(o => o.setName("nombre").setDescription("Nuevo nombre").setRequired(true).setMaxLength(32)))
    .addSubcommand(s => s.setName("ver").setDescription("Ver la configuración actual")),

  new SlashCommandBuilder().setName("director").setDescription("Directores de los clubes")
    .addSubcommand(s => s.setName("asignar").setDescription("Asignar un director a un club")
      .addRoleOption(o => optClub(o))
      .addUserOption(o => o.setName("usuario").setDescription("Nuevo director").setRequired(true)))
    .addSubcommand(s => s.setName("lista").setDescription("Ver todos los directores en el cargo"))
    .addSubcommand(s => s.setName("quitar").setDescription("Quitar el director de un club (o todos si se deja vacío)")
      .addRoleOption(o => optClub(o))
      .addUserOption(o => o.setName("usuario").setDescription("Director a quitar (vacío = todos)"))),

  new SlashCommandBuilder().setName("ayuda").setDescription("Mostrar todos los comandos del bot"),

  new SlashCommandBuilder().setName("jugador").setDescription("Gestión de jugadores")
    .addSubcommand(s => {
      s.setName("añadir").setDescription("Inscribir jugadores como agentes libres, o directamente en un club")
        .addUserOption(o => optJugador(o))
        .addRoleOption(o => o.setName("club").setDescription("Añadirlos directamente a este club (opcional)"))
        .addStringOption(o => o.setName("clausula").setDescription("Cláusula (opcional)").addChoices(...CLAUSULA_CHOICES))
        .addStringOption(o => o.setName("temporadas").setDescription("Temporadas de contrato (opcional)").addChoices(...TEMPORADAS_CHOICES))
        .addStringOption(o => o.setName("posicion").setDescription("Posición (opcional, ej: DC, MC, POR)").setMaxLength(30));
      for (let n = 2; n <= 10; n++) s.addUserOption(o => o.setName(`jugador${n}`).setDescription("Jugador adicional (opcional)"));
      return s;
    })
    .addSubcommand(s => s.setName("info").setDescription("Ver la información de un jugador")
      .addUserOption(o => optJugador(o)))
    .addSubcommand(s => s.setName("libres").setDescription("Ver todos los agentes libres (sin club)"))
    .addSubcommand(s => s.setName("lista").setDescription("Ver la plantilla de un club")
      .addRoleOption(o => optClub(o)))
    .addSubcommand(s => s.setName("modificar").setDescription("Modificar los datos de un jugador existente")
      .addUserOption(o => optJugador(o))
      .addRoleOption(o => o.setName("club").setDescription("Moverlo directamente a este club"))
      .addBooleanOption(o => o.setName("libre").setDescription("Dejarlo como agente libre"))
      .addStringOption(o => o.setName("clausula").setDescription("Nueva cláusula").addChoices(...CLAUSULA_CHOICES))
      .addStringOption(o => o.setName("temporadas").setDescription("Temporadas de contrato").addChoices(...TEMPORADAS_CHOICES))
      .addStringOption(o => o.setName("posicion").setDescription("Posición").setMaxLength(30)))
    .addSubcommand(s => s.setName("quitar").setDescription("Quitar un jugador del bot")
      .addUserOption(o => optJugador(o))),

  new SlashCommandBuilder().setName("mercado").setDescription("Mercado de fichajes")
    .addSubcommand(s => s.setName("abrir").setDescription("Abrir el mercado de fichajes (solo staff)"))
    .addSubcommand(s => s.setName("cerrar").setDescription("Cerrar el mercado de fichajes (solo staff)"))
    .addSubcommand(s => s.setName("estado").setDescription("Ver si el mercado está abierto o cerrado"))
    .addSubcommand(s => s.setName("fin_temporada").setDescription("⚠️ Cerrar la temporada: resta 1 a todos los contratos y libera a los que llegan a 0"))
    .addSubcommand(s => s.setName("revertir").setDescription("Deshacer una operación ya confirmada (solo staff)")
      .addIntegerOption(o => o.setName("numero").setDescription("Número de la operación (ej: 5)").setRequired(true).setMinValue(1))),

  new SlashCommandBuilder().setName("contrato").setDescription("Contratos de los jugadores")
    .addSubcommand(s => s.setName("renovar").setDescription("Renovar el contrato de un jugador de tu club; el jugador debe aceptar")
      .addUserOption(o => optJugador(o))
      .addStringOption(o => o.setName("temporadas").setDescription("Nuevas temporadas de contrato").setRequired(true).addChoices(...TEMPORADAS_CHOICES))
      .addStringOption(o => o.setName("clausula").setDescription("Nueva cláusula (opcional)").addChoices(...CLAUSULA_CHOICES)))
    .addSubcommand(s => s.setName("clausula").setDescription("Subir o bajar la cláusula de un jugador de tu club; el jugador debe aceptar")
      .addUserOption(o => optJugador(o))
      .addStringOption(o => o.setName("clausula").setDescription("Nueva cláusula").setRequired(true).addChoices(...CLAUSULA_CHOICES)))
    .addSubcommand(s => s.setName("rescindir").setDescription("Rescindir el contrato de un jugador de tu club (queda libre al momento)")
      .addUserOption(o => optJugador(o))
      .addStringOption(o => o.setName("motivo").setDescription("Motivo").setRequired(true).addChoices(...MOTIVOS))
      .addStringOption(o => o.setName("detalle").setDescription("Detalle del motivo (opcional)").setMaxLength(200))),

  new SlashCommandBuilder().setName("cesion").setDescription("Cesiones de jugadores")
    .addSubcommand(s => s.setName("lista").setDescription("Ver todas las cesiones activas y pendientes"))
    .addSubcommand(s => s.setName("proponer").setDescription("Ceder un jugador a otro club (requiere mercado abierto)")
      .addUserOption(o => optJugador(o))
      .addRoleOption(o => optClub(o, "Club que recibe al jugador"))
      .addStringOption(o => o.setName("duracion").setDescription("Duración de la cesión").setRequired(true).addChoices(...CESION_CHOICES))
      .addStringOption(o => o.setName("precio").setDescription("Precio de la cesión (ej: 2M). Por defecto gratis")))
    .addSubcommand(s => s.setName("terminar").setDescription("Pedir el fin anticipado de una cesión (mercado abierto, acuerdo de los 2 clubes)")
      .addUserOption(o => optJugador(o))),

  new SlashCommandBuilder().setName("traspaso").setDescription("Traspasos de jugadores")
    .addSubcommand(s => s.setName("clausula").setDescription("Pagar la cláusula de un jugador; el jugador debe aceptar")
      .addUserOption(o => optJugador(o))
      .addRoleOption(o => o.setName("club").setDescription("Tu club (solo si diriges varios)")))
    .addSubcommand(s => s.setName("proponer").setDescription("Proponer un traspaso por un jugador")
      .addUserOption(o => optJugador(o))
      .addStringOption(o => o.setName("precio").setDescription("Precio ofrecido (ej: 20M). 0 si es agente libre").setRequired(true))
      .addRoleOption(o => o.setName("club").setDescription("Tu club (solo si diriges varios)"))
      .addStringOption(o => o.setName("temporadas").setDescription("Temporadas de contrato").addChoices(...TEMPORADAS_CHOICES))
      .addStringOption(o => o.setName("clausula").setDescription("Nueva cláusula").addChoices(...CLAUSULA_CHOICES)))
];

const commandData = esCommands.map(x => x.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  // Limpieza: si antes se registraron comandos solo para un servidor (usando GUILD_ID),
  // hay que borrarlos para que no aparezcan duplicados junto a los comandos globales.
  if (process.env.GUILD_ID) {
    try {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
      console.log("🧹 Comandos antiguos de servidor eliminados (evita duplicados).");
    } catch (err) {
      console.error("No se pudieron limpiar los comandos antiguos:", err);
    }
  }

  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandData });
  console.log("✅ Comandos registrados (global, funcionan en todos los servidores).");
}

function ownedTeams(guildId, userId) {
  const t = teams(guildId);
  return Object.values(t).filter(team => team.owners?.includes(userId));
}

// revierte una operación ya confirmada (solo administradores)
async function revertOperation(interaction, transferId) {
  const guildId = interaction.guildId;
  const transfers = read(TRANSFERS_FILE);
  const t = transfers.find(x => x.id === transferId && x.guildId === guildId);

  if (!t) return interaction.reply({ content: "❌ No encontré esa operación en este servidor.", ephemeral: true });
  if (t.reverted) return interaction.reply({ content: "❌ Esa operación ya fue revertida antes.", ephemeral: true });
  if (["Subida de Cláusula", "Bajada de Cláusula", "Fin de cesión", "Renovación", "Cambio de cláusula"].includes(t.type)) {
    return interaction.reply({ content: "❌ Ese tipo de operación no se puede revertir.", ephemeral: true });
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return interaction.reply({ content: "❌ No pude acceder al servidor.", ephemeral: true });

  const r = roster(guildId);
  const member = await guild.members.fetch(t.targetId).catch(() => null);

  if (t.type === "Rescindir") {
    if (t.prevTeamRoleId) {
      r[t.targetId] = { teamRoleId: t.prevTeamRoleId, type: "Revertido", values: t.prevValues || {}, since: new Date().toISOString() };
      if (member) await member.roles.add(t.prevTeamRoleId).catch(() => {});
    }
  } else {
    if (member && t.teamRoleId) await member.roles.remove(t.teamRoleId).catch(() => {});

    if (t.prevTeamRoleId) {
      r[t.targetId] = { teamRoleId: t.prevTeamRoleId, type: "Revertido", values: t.prevValues || {}, since: new Date().toISOString() };
      if (member) await member.roles.add(t.prevTeamRoleId).catch(() => {});
    } else {
      r[t.targetId] = { teamRoleId: null, type: "Agente libre", values: {}, since: new Date().toISOString() };
    }

    if (t.price > 0) {
      const teamsData = teams(guildId);
      if (t.teamRoleId && teamsData[t.teamRoleId]) teamsData[t.teamRoleId].budget += t.price;
      if (t.prevTeamRoleId && teamsData[t.prevTeamRoleId]) teamsData[t.prevTeamRoleId].budget -= t.price;
      saveTeams(guildId, teamsData);
      await updateBudgetPanel(guild);
    }
  }

  saveRoster(guildId, r);
  t.reverted = true;
  write(TRANSFERS_FILE, transfers);

  const c = cfg(guildId);
  if (c.transferChannel) {
    const channel = await guild.channels.fetch(c.transferChannel).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send(`↩️ | **Operación #${t.id} revertida** (${t.type}) — <@${t.targetId}>`).catch(() => {});
    }
  }

  return interaction.reply({ content: `✅ Operación #${t.id} (${t.type}) revertida correctamente.`, ephemeral: true });
}

// =====================================================================
// COMANDOS: /club, /config, /director, /jugador, /mercado, /cesion,
// /traspaso, /contrato y /ayuda (directores = dueños de cada club).
// =====================================================================

const ES_TITULOS = { traspaso: "Propuesta de traspaso", clausula: "Pago de cláusula", cesion: "Propuesta de cesión", fin_cesion: "Fin anticipado de cesión", renovacion: "Propuesta de renovación", cambio_clausula: "Cambio de cláusula" };
const ES_TIPOS = { traspaso: "Traspaso", clausula: "Cláusula pagada", cesion: "Cesión", fin_cesion: "Fin de cesión", renovacion: "Renovación", cambio_clausula: "Cambio de cláusula" };
const ES_ICONOS = { traspaso: "✅️", clausula: "💥", cesion: "🔄", fin_cesion: "↩️", renovacion: "✍️", cambio_clausula: "🔒" };
const ES_CONTRATO = ["renovacion", "cambio_clausula"]; // no cambian de club ni necesitan mercado abierto

function esClubNombre(guild, roleId) {
  return guild?.roles.cache.get(roleId)?.name || "club eliminado";
}
function esTieneRol(member, ids) {
  return (ids || []).some(id => member?.roles?.cache?.has(id));
}
// niveles: staff (gestiona el bot) > ayudante (gestiona jugadores) > director (comandos habituales)
function esPuede(interaction, nivel) {
  const m = interaction.member;
  const c = cfg(interaction.guildId);
  if (m.permissions.has(PermissionFlagsBits.ManageGuild) || esTieneRol(m, c.staffRoles)) return true;
  if (nivel === "staff") return false;
  if (esTieneRol(m, c.helperRoles)) return true;
  if (nivel === "ayudante") return false;
  if (!c.directorRoles.length) return true;
  return esTieneRol(m, c.directorRoles) || ownedTeams(interaction.guildId, interaction.user.id).length > 0;
}
function esSinPermiso(interaction, nivel) {
  return interaction.reply({ content: `❌ Necesitas permisos de **${nivel}** para usar este comando.`, ephemeral: true });
}
function esError(interaction, texto) {
  return interaction.reply({ content: `❌ ${texto}`, ephemeral: true });
}
function esLista(lineas, vacio) {
  if (!lineas.length) return vacio;
  let out = "";
  for (let i = 0; i < lineas.length; i++) {
    if ((out + lineas[i] + "\n").length > 3900) return `${out}…y ${lineas.length - i} más.`;
    out += `${lineas[i]}\n`;
  }
  return out.trim();
}
function esContrato(values) {
  const m = /^T(\d+)$/.exec(values?.temporadas || "");
  return m ? Number(m[1]) : null;
}
function esDetalleJugador(guild, info) {
  const v = info.values || {};
  const partes = [];
  if (v.posicion) partes.push(v.posicion);
  if (v.temporadas) partes.push(`Contrato: ${v.temporadas}`);
  if (v.clausula) partes.push(`Cláusula: ${v.clausula}`);
  if (info.cesion) partes.push(`Cedido por ${esClubNombre(guild, info.cesion.origenRoleId)} (${info.cesion.duracion})`);
  return partes.join(" | ") || "sin detalles";
}
// deja al jugador como agente libre: sin club, sin cesión y sin contrato (se conserva la posición)
function esLiberar(info) {
  info.teamRoleId = null;
  info.type = "Agente libre";
  delete info.cesion;
  if (info.values) for (const k of ["temporadas", "clausula", "precio", "equipo"]) delete info.values[k];
}
async function esCambiarRol(guild, userId, quitarRoleId, ponerRoleId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  if (quitarRoleId && quitarRoleId !== ponerRoleId) await member.roles.remove(quitarRoleId).catch(() => {});
  if (ponerRoleId) await member.roles.add(ponerRoleId).catch(() => {});
}
async function esEnviarCanal(guild, channelId, contenido) {
  if (!channelId) return;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (ch?.isTextBased()) await ch.send(contenido.slice(0, 2000)).catch(() => {});
}
async function esAvisar(userId, contenido) {
  const u = await client.users.fetch(userId).catch(() => null);
  if (u) await u.send(contenido.slice(0, 2000)).catch(() => {});
}
// club que dirige quien usa el comando (el staff puede indicar cualquiera)
function esClubPropio(interaction, role) {
  const t = teams(interaction.guildId);
  if (role) {
    if (!t[role.id]) return { error: "Ese rol no es un club registrado. Usa /club crear." };
    if (t[role.id].owners?.includes(interaction.user.id) || esPuede(interaction, "staff")) return { roleId: role.id };
    return { error: "No eres director de ese club." };
  }
  const mine = ownedTeams(interaction.guildId, interaction.user.id);
  if (mine.length === 1) return { roleId: mine[0].roleId };
  if (mine.length > 1) return { error: "Diriges varios clubes: indica cuál con la opción `club`." };
  return { error: "No eres director de ningún club. El staff te puede asignar con /director asignar." };
}

// ----- operaciones con aceptación por MD (traspaso, cláusula, cesión, fin de cesión) -----
function esDescribirOp(op, guild) {
  const de = op.origenRoleId ? esClubNombre(guild, op.origenRoleId) : "Agente libre";
  const a = esClubNombre(guild, op.destinoRoleId);
  const lineas = [`👤 Jugador: <@${op.jugadorId}>`];
  if (ES_CONTRATO.includes(op.tipo)) lineas.push(`🏆 Club: **${de}**`);
  else lineas.push(op.tipo === "fin_cesion" ? `↩️ Vuelve de **${a}** a **${de}**` : `🔁 De **${de}** → a **${a}**`);
  if (op.tipo === "cesion") lineas.push(`📅 Duración: **${op.duracion}**`);
  if (op.precio) lineas.push(`💰 ${op.tipo === "clausula" ? "Cláusula pagada" : "Precio"}: **${formatMoney(op.precio)}**`);
  if (op.values?.temporadas) lineas.push(`📝 Contrato: **${op.values.temporadas}**`);
  if (op.tipo === "cambio_clausula") lineas.push(`🔒 Cláusula: **${op.clausulaAnterior || "sin cláusula"}** → **${op.values.clausula}**`);
  else if (op.values?.clausula) lineas.push(`🔒 Nueva cláusula: **${op.values.clausula}**`);
  return lineas.join("\n");
}
function esAprobadores(op) {
  if (op.contra) return [op.proponenteId]; // contraoferta: responde quien hizo la oferta
  const paso = op.pasos[op.paso];
  if (!paso) return [];
  if (paso.tipo === "club") return teams(op.guildId)[paso.roleId]?.owners || [];
  return [paso.userId];
}
function esQuienFalta(op, guild) {
  if (op.contra) return `<@${op.proponenteId}>`;
  const paso = op.pasos[op.paso];
  if (!paso) return "nadie";
  return paso.tipo === "club" ? `los directores de **${esClubNombre(guild, paso.roleId)}**` : `<@${paso.userId}>`;
}

// ----- texto de los MD de ofertas -----
const ES_CONTRATO_JUGADOR = ["traspaso", "clausula", "renovacion", "cambio_clausula"];
// condiciones que se ofrecen: las nuevas o, si no cambian, las que ya tiene el jugador
function esTerminos(op) {
  const actual = roster(op.guildId)[op.jugadorId]?.values || {};
  const temporadas = op.values?.temporadas || actual.temporadas || null;
  return { temporadas: temporadas ? temporadas.replace(/^T/, "") : null, clausula: op.values?.clausula || actual.clausula || null };
}
function esContratoTexto(op) {
  const { temporadas, clausula } = esTerminos(op);
  return `un contrato${temporadas ? ` de **${temporadas}** Temporada(s)` : ""}${clausula ? ` con cláusula de **${clausula}**` : " sin cláusula"}`;
}
function esMensajeOferta(op, guild) {
  const paso = op.pasos[op.paso];
  const de = op.origenRoleId ? esClubNombre(guild, op.origenRoleId) : null;
  const a = esClubNombre(guild, op.destinoRoleId);
  const precio = op.precio ? `**${formatMoney(op.precio)}**` : "**0**";
  const J = `<@${op.jugadorId}>`;
  const extra = [];
  let principal;
  if (op.contra) {
    const quien = paso.tipo === "club" ? `**${esClubNombre(guild, paso.roleId)}**` : J;
    if (paso.tipo === "usuario" && ES_CONTRATO_JUGADOR.includes(op.tipo)) principal = `${quien} quiere renegociar: pide ${esContratoTexto(op)} ¿Aceptas?`;
    else if (paso.tipo === "club" && op.tipo === "traspaso") principal = `${quien} quiere renegociar: pide ${precio} por ${J} ¿Aceptas?`;
    else if (paso.tipo === "club" && op.tipo === "cesion") principal = `${quien} quiere renegociar: ofrece ${precio} por la cesión de ${J} durante **${op.duracion}** ¿Aceptas?`;
    else principal = `${quien} quiere renegociar. ¿Seguimos con la operación?`;
    extra.push(`📋 ${ES_TITULOS[op.tipo]} de ${J}`);
  } else if (op.tipo === "traspaso" && paso.tipo === "club") {
    principal = `**${a}** ofrece ${precio} por ${J} ¿Aceptas?`;
    extra.push(`📝 Le ofrece ${esContratoTexto(op)}`);
  } else if (op.tipo === "cesion" && paso.tipo === "club") {
    principal = `**${de}** te ofrece la cesión de ${J} durante **${op.duracion}**${op.precio ? ` por ${precio}` : " gratis"} ¿Aceptas?`;
  } else if (op.tipo === "cesion") {
    principal = `**${a}** te ofrece una cesión de **${op.duracion}** ¿Aceptas?`;
    extra.push(`🔄 Cedido por **${de}**${op.precio ? ` por ${precio}` : ""}`);
  } else if (op.tipo === "fin_cesion") {
    principal = `Se propone terminar ya la cesión de ${J}: vuelve de **${a}** a **${de}** ¿Aceptas?`;
  } else {
    principal = `**${ES_CONTRATO.includes(op.tipo) ? de : a}** te ofrece ${esContratoTexto(op)} ¿Aceptas?`;
    if (op.tipo === "traspaso") extra.push(op.origenRoleId ? `🔁 Traspaso desde **${de}** por ${precio}` : "🆓 Fichaje como agente libre");
    if (op.tipo === "clausula") extra.push(`💥 Han pagado tu cláusula de ${precio} a **${de}**`);
    if (op.tipo === "renovacion") extra.push("✍️ Renovación de contrato");
    if (op.tipo === "cambio_clausula") extra.push(`🔒 Cláusula actual: **${op.clausulaAnterior || "sin cláusula"}**`);
  }
  if (op.mensaje) extra.push(`💬 "${op.mensaje}"`);
  const cabecera = op.contra ? "🔄 **Contraoferta**" : op.rondas ? "🔄 **Nueva oferta**" : `📩 **${ES_TITULOS[op.tipo]}**`;
  return `${cabecera} · ${guild?.name || "servidor"}\n\n${principal}\n${extra.join("\n")}`.trim();
}
function esBotonesOferta(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`es_ok:${id}`).setLabel("Confirmar").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`es_reneg:${id}`).setLabel("Renegociar").setEmoji("🔄").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`es_no:${id}`).setLabel("Rescindir").setEmoji("❌").setStyle(ButtonStyle.Danger)
  );
}
async function esEnviarPaso(op) {
  const guild = client.guilds.cache.get(op.guildId);
  const contenido = esMensajeOferta(op, guild);
  let enviados = 0;
  for (const id of esAprobadores(op)) {
    const user = await client.users.fetch(id).catch(() => null);
    const ok = user ? await user.send({ content: contenido, components: [esBotonesOferta(op.id)] }).then(() => true).catch(() => false) : false;
    if (ok) enviados++;
  }
  return enviados;
}

// ----- renegociar: formulario con las condiciones que se pueden cambiar -----
function esCamposReneg(op) {
  const paso = op.pasos[op.paso];
  const campos = [];
  if (paso.tipo === "usuario" && ES_CONTRATO_JUGADOR.includes(op.tipo)) {
    if (op.tipo !== "cambio_clausula") campos.push("temporadas");
    campos.push("clausula");
  }
  if (paso.tipo === "club" && (op.tipo === "traspaso" || op.tipo === "cesion")) campos.push("precio");
  return campos;
}
function esModalReneg(op) {
  const t = esTerminos(op);
  const def = {
    temporadas: ["Temporadas de contrato (1 a 10)", t.temporadas],
    clausula: ["Cláusula (ej: 30M)", t.clausula],
    precio: ["Precio (ej: 20M)", formatMoney(op.precio || 0)]
  };
  const modal = new ModalBuilder().setCustomId(`es_mod:${op.id}`).setTitle("Renegociar");
  for (const k of esCamposReneg(op)) {
    const input = new TextInputBuilder().setCustomId(k).setLabel(def[k][0]).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10);
    if (def[k][1]) input.setValue(def[k][1]);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId("mensaje").setLabel("Mensaje (opcional)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300)
  ));
  return modal;
}
// cantidades: "30M", "500K" o "30" (un número pequeño se entiende en millones)
function esCantidad(texto) {
  let v = money(texto);
  if (Number.isFinite(v) && v > 0 && v < 1000) v *= 1000000;
  return v;
}
async function esModalRenegEnviado(interaction) {
  const id = interaction.customId.split(":")[1];
  const pending = read(PENDING_FILE);
  const op = pending[`op:${id}`];
  if (!op) return interaction.reply({ content: "⌛ Esta propuesta ya no existe.", ephemeral: true });
  if (!esAprobadores(op).includes(interaction.user.id)) return interaction.reply({ content: "⌛ Esta propuesta ya no está esperando tu respuesta.", ephemeral: true });
  const campo = k => { try { return interaction.fields.getTextInputValue(k).trim(); } catch { return null; } };

  const nuevos = {};
  const tTxt = campo("temporadas");
  if (tTxt !== null) {
    const n = Number(tTxt.replace(/^T/i, ""));
    if (!Number.isInteger(n) || n < 1 || n > 10) return interaction.reply({ content: "❌ Las temporadas deben ser un número del 1 al 10.", ephemeral: true });
    nuevos.temporadas = `T${n}`;
  }
  const cTxt = campo("clausula");
  if (cTxt !== null) {
    const v = esCantidad(cTxt);
    if (!Number.isFinite(v) || v <= 0) return interaction.reply({ content: "❌ Cláusula inválida. Ejemplo: 30M.", ephemeral: true });
    nuevos.clausula = formatMoney(v);
  }
  const pTxt = campo("precio");
  if (pTxt !== null) {
    const v = esCantidad(pTxt);
    if (!Number.isFinite(v) || v < 0) return interaction.reply({ content: "❌ Precio inválido. Ejemplo: 20M.", ephemeral: true });
    op.precio = v;
  }
  op.values = { ...(op.values || {}), ...nuevos };
  op.mensaje = campo("mensaje") || null;
  op.rondas = (op.rondas || 0) + 1;
  op.contra = !op.contra; // la pelota pasa al otro lado
  pending[`op:${id}`] = op;
  write(PENDING_FILE, pending);

  const desdeMensaje = interaction.isFromMessage();
  await (desdeMensaje ? interaction.deferUpdate() : interaction.deferReply({ ephemeral: true }));
  const guild = client.guilds.cache.get(op.guildId);
  const enviados = await esEnviarPaso(op);
  if (!enviados) {
    esBorrarOp(id);
    return interaction.editReply({ content: `❌ No pude enviar la contraoferta a ${esQuienFalta(op, guild)} por MD. La operación se canceló.`, components: [] });
  }
  if (guild) await esEnviarCanal(guild, cfg(guild.id).offersLogChannel, `🔄 **Renegociación** de <@${interaction.user.id}>\n${esDescribirOp(op, guild)}`);
  return interaction.editReply({ content: `🔄 Contraoferta enviada a ${esQuienFalta(op, guild)}. Te avisaré cuando responda.\n\n${esDescribirOp(op, guild)}`, components: [] });
}
function esBorrarOp(id) {
  const pending = read(PENDING_FILE);
  delete pending[`op:${id}`];
  write(PENDING_FILE, pending);
}

async function esIniciarOp(interaction, op) {
  op.id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  op.guildId = interaction.guildId;
  op.proponenteId = interaction.user.id;
  op.paso = 0;
  op.creado = new Date().toISOString();

  for (const paso of op.pasos) {
    if (paso.tipo === "club" && !teams(op.guildId)[paso.roleId]?.owners?.length) {
      return esError(interaction, `**${esClubNombre(interaction.guild, paso.roleId)}** no tiene director, así que nadie puede aceptar. Asigna uno con /director asignar.`);
    }
  }

  await interaction.deferReply({ ephemeral: true });

  // sin nadie más a quien preguntar (p. ej. diriges los dos clubes): se ejecuta ya
  if (!op.pasos.length) {
    const res = await esEjecutarOp(op);
    return interaction.editReply(res.ok ? `✅ Operación #${res.numero} completada.\n\n${esDescribirOp(op, interaction.guild)}` : `❌ ${res.msg}`);
  }

  const pending = read(PENDING_FILE);
  pending[`op:${op.id}`] = op;
  write(PENDING_FILE, pending);

  const enviados = await esEnviarPaso(op);
  if (!enviados) {
    esBorrarOp(op.id);
    return interaction.editReply(`❌ No pude enviar la propuesta por MD a ${esQuienFalta(op, interaction.guild)} (puede que tengan los MD cerrados). Se ha cancelado.`);
  }
  await esEnviarCanal(interaction.guild, cfg(op.guildId).offersLogChannel, `📨 **${ES_TITULOS[op.tipo]}** de <@${op.proponenteId}>\n${esDescribirOp(op, interaction.guild)}`);
  return interaction.editReply(`📩 Propuesta enviada por MD a ${esQuienFalta(op, interaction.guild)}. Te avisaré cuando respondan.\n\n${esDescribirOp(op, interaction.guild)}`);
}

async function esEjecutarOp(op) {
  const guild = client.guilds.cache.get(op.guildId);
  if (!guild) return { ok: false, msg: "No encuentro el servidor." };
  const contrato = ES_CONTRATO.includes(op.tipo);
  if (!contrato && !cfg(guild.id).mercadoAbierto) return { ok: false, msg: "El mercado está cerrado." };

  const t = teams(guild.id);
  const r = roster(guild.id);
  const entry = r[op.jugadorId];
  const actual = entry?.teamRoleId || null;
  const precio = op.precio || 0;
  const ahora = new Date().toISOString();
  const prevValues = { ...(entry?.values || {}) }; // para poder revertir

  if (contrato) {
    const dueno = entry?.cesion ? entry.cesion.origenRoleId : actual;
    if (!entry || dueno !== op.origenRoleId) return { ok: false, msg: "El jugador ya no está en el mismo club que cuando se propuso." };
  } else if (op.tipo === "fin_cesion") {
    if (!entry?.cesion || entry.teamRoleId !== op.destinoRoleId || entry.cesion.origenRoleId !== op.origenRoleId) {
      return { ok: false, msg: "Esa cesión ya no está activa." };
    }
  } else {
    if (actual !== (op.origenRoleId || null) || entry?.cesion) return { ok: false, msg: "El jugador ya no está en el mismo club que cuando se propuso." };
    if (!t[op.destinoRoleId]) return { ok: false, msg: "El club de destino ya no existe." };
    if (precio > 0 && t[op.destinoRoleId].budget < precio) {
      return { ok: false, msg: `**${esClubNombre(guild, op.destinoRoleId)}** no tiene presupuesto suficiente (tiene ${formatMoney(t[op.destinoRoleId].budget)}).` };
    }
  }

  let clubAnterior;
  let nuevoClub;
  if (contrato) {
    clubAnterior = op.origenRoleId;
    nuevoClub = op.origenRoleId;
    entry.values = { ...(entry.values || {}), ...op.values };
    entry.type = ES_TIPOS[op.tipo];
  } else if (op.tipo === "fin_cesion") {
    clubAnterior = op.destinoRoleId;
    nuevoClub = op.origenRoleId;
    entry.teamRoleId = nuevoClub;
    entry.type = "Vuelta de cesión";
    entry.since = ahora;
    delete entry.cesion;
  } else if (op.tipo === "cesion") {
    clubAnterior = op.origenRoleId;
    nuevoClub = op.destinoRoleId;
    entry.teamRoleId = nuevoClub;
    entry.type = "Cesión";
    entry.since = ahora;
    entry.cesion = { origenRoleId: op.origenRoleId, duracion: op.duracion, precio, desde: ahora };
  } else {
    clubAnterior = actual;
    nuevoClub = op.destinoRoleId;
    r[op.jugadorId] = {
      teamRoleId: nuevoClub,
      type: ES_TIPOS[op.tipo],
      values: {
        ...(entry?.values || {}),
        ...(op.values || {}),
        ...(precio ? { precio: formatMoney(precio) } : {}),
        equipo: esClubNombre(guild, nuevoClub)
      },
      since: ahora
    };
  }

  if (precio > 0) {
    t[op.destinoRoleId].budget -= precio;
    if (op.origenRoleId && t[op.origenRoleId]) t[op.origenRoleId].budget += precio;
    saveTeams(guild.id, t);
  }
  saveRoster(guild.id, r);
  if (!contrato) await esCambiarRol(guild, op.jugadorId, clubAnterior, nuevoClub);
  if (precio > 0) await updateBudgetPanel(guild);

  const c = cfg(guild.id);
  c.transferNumber += 1;
  const numero = c.transferNumber;
  saveCfg(guild.id, c);

  const transfers = read(TRANSFERS_FILE);
  transfers.push({
    id: numero,
    guildId: guild.id,
    type: ES_TIPOS[op.tipo],
    senderId: op.proponenteId,
    targetId: op.jugadorId,
    teamRoleId: nuevoClub,
    prevTeamRoleId: clubAnterior || null,
    prevValues,
    price: precio,
    values: r[op.jugadorId].values || {},
    confirmedAt: ahora,
    reverted: false
  });
  write(TRANSFERS_FILE, transfers);

  await esEnviarCanal(guild, c.transferChannel, `${ES_ICONOS[op.tipo]} | **Operación #${numero}** — ${ES_TIPOS[op.tipo]}\n${esDescribirOp(op, guild)}`);
  return { ok: true, numero };
}

async function esBotonOp(interaction) {
  const [accion, id] = interaction.customId.split(":");
  const pending = read(PENDING_FILE);
  const op = pending[`op:${id}`];
  if (!op) return interaction.update({ content: "⌛ Esta propuesta ya fue respondida o ya no existe.", components: [] });
  if (!esAprobadores(op).includes(interaction.user.id)) {
    return interaction.reply({ content: "⌛ Esta propuesta ya no está esperando tu respuesta.", ephemeral: true });
  }
  const guild = client.guilds.cache.get(op.guildId);

  if (accion === "es_reneg") return interaction.showModal(esModalReneg(op));

  if (accion === "es_no") {
    esBorrarOp(id);
    // avisar a la otra parte
    const otros = op.contra ? esAprobadores({ ...op, contra: false }) : [op.proponenteId];
    for (const uid of otros) {
      if (uid !== interaction.user.id) await esAvisar(uid, `❌ <@${interaction.user.id}> ha rescindido: **${ES_TITULOS[op.tipo]}**\n${esDescribirOp(op, guild)}`);
    }
    if (guild) await esEnviarCanal(guild, cfg(guild.id).offersLogChannel, `❌ **${ES_TITULOS[op.tipo]} rescindida** por <@${interaction.user.id}>\n${esDescribirOp(op, guild)}`);
    return interaction.update({ content: `❌ Has rescindido: **${ES_TITULOS[op.tipo]}**\n\n${esDescribirOp(op, guild)}`, components: [] });
  }

  // Confirmar (también cuando quien hizo la oferta acepta una contraoferta: ese paso queda aceptado)
  await interaction.deferUpdate();
  op.contra = false;
  op.mensaje = null;
  op.rondas = 0;
  op.paso += 1;

  if (op.paso < op.pasos.length) {
    pending[`op:${id}`] = op;
    write(PENDING_FILE, pending);
    const enviados = await esEnviarPaso(op);
    if (!enviados) {
      esBorrarOp(id);
      await esAvisar(op.proponenteId, `❌ Tu ${ES_TITULOS[op.tipo].toLowerCase()} se canceló: no pude enviar el MD a ${esQuienFalta(op, guild)}.`);
      return interaction.editReply({ content: `✅ Confirmado, pero no pude enviar el MD a ${esQuienFalta(op, guild)}. La operación se canceló.`, components: [] });
    }
    return interaction.editReply({ content: `✅ Confirmado. Ahora falta la respuesta de ${esQuienFalta(op, guild)}.\n\n${esDescribirOp(op, guild)}`, components: [] });
  }

  esBorrarOp(id);
  const res = await esEjecutarOp(op);
  if (res.ok) {
    if (op.proponenteId !== interaction.user.id) await esAvisar(op.proponenteId, `✅ Operación #${res.numero} completada: **${ES_TIPOS[op.tipo]}**\n${esDescribirOp(op, guild)}`);
    if (guild) await esEnviarCanal(guild, cfg(guild.id).offersLogChannel, `✅ **${ES_TITULOS[op.tipo]} aceptada** — Operación #${res.numero}`);
  } else {
    await esAvisar(op.proponenteId, `❌ No se pudo completar: **${ES_TITULOS[op.tipo]}** — ${res.msg}`);
  }
  return interaction.editReply({
    content: res.ok ? `✅ Operación #${res.numero} confirmada.\n\n${esDescribirOp(op, guild)}` : `❌ No se pudo completar: ${res.msg}`,
    components: []
  });
}

function esBotonesConfirmar(id, textoSi) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id).setLabel(textoSi).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("es_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
  );
}

async function esConfirmar(interaction) {
  if (interaction.customId === "es_cancel") return interaction.update({ content: "Cancelado.", components: [] });
  if (!esPuede(interaction, "staff")) return esSinPermiso(interaction, "staff");
  const [, accion, arg] = interaction.customId.split(":");
  const guild = interaction.guild;
  await interaction.deferUpdate();

  if (accion === "club_eliminar") {
    const t = teams(guild.id);
    if (!t[arg]) return interaction.editReply({ content: "Ese club ya no existe.", components: [] });
    delete t[arg];
    saveTeams(guild.id, t);

    const r = roster(guild.id);
    let libres = 0;
    let vueltas = 0;
    for (const [id, info] of Object.entries(r)) {
      if (info.cesion?.origenRoleId === arg) {
        // era de este club y estaba cedido: queda libre
        await esCambiarRol(guild, id, info.teamRoleId, null);
        esLiberar(info);
        libres++;
      } else if (info.teamRoleId === arg && info.cesion) {
        // estaba cedido aquí: vuelve a su club
        info.teamRoleId = info.cesion.origenRoleId;
        await esCambiarRol(guild, id, arg, info.teamRoleId);
        info.type = "Vuelta de cesión";
        delete info.cesion;
        vueltas++;
      } else if (info.teamRoleId === arg) {
        await esCambiarRol(guild, id, arg, null);
        esLiberar(info);
        libres++;
      }
    }
    saveRoster(guild.id, r);
    await updateBudgetPanel(guild);
    return interaction.editReply({
      content: `✅ Club <@&${arg}> eliminado. ${libres} jugador(es) quedaron libres${vueltas ? ` y ${vueltas} cedido(s) volvieron a su club` : ""}.`,
      components: []
    });
  }

  if (accion === "fin_temporada") {
    const r = roster(guild.id);
    const liberados = [];
    const vueltas = [];
    for (const [id, info] of Object.entries(r)) {
      if (!info.teamRoleId) continue;
      const n = esContrato(info.values);
      if (n !== null && n - 1 <= 0) {
        await esCambiarRol(guild, id, info.teamRoleId, null);
        esLiberar(info);
        liberados.push(id);
        continue;
      }
      if (n !== null) info.values.temporadas = `T${n - 1}`;
      if (info.cesion) {
        const d = info.cesion.duracion;
        if (d === "2 temporadas") info.cesion.duracion = "1 temporada";
        else if (d === "3 temporadas") info.cesion.duracion = "2 temporadas";
        else {
          const origen = info.cesion.origenRoleId;
          await esCambiarRol(guild, id, info.teamRoleId, origen);
          info.teamRoleId = origen;
          info.type = "Vuelta de cesión";
          delete info.cesion;
          vueltas.push(id);
        }
      }
    }
    saveRoster(guild.id, r);

    const c = cfg(guild.id);
    const terminada = c.temporada;
    c.temporada += 1;
    saveCfg(guild.id, c);

    const resumen =
      `🏁 **Fin de la temporada ${terminada}**\n` +
      `📉 A todos los contratos se les restó 1 temporada.\n` +
      `🆓 Quedan libres (${liberados.length}): ${liberados.length ? liberados.map(id => `<@${id}>`).join(", ") : "ninguno"}\n` +
      `↩️ Cesiones terminadas (${vueltas.length}): ${vueltas.length ? vueltas.map(id => `<@${id}>`).join(", ") : "ninguna"}\n` +
      `▶️ Empieza la temporada ${c.temporada}.`;
    await esEnviarCanal(guild, c.transferChannel, resumen);
    return interaction.editReply({ content: resumen.slice(0, 2000), components: [] });
  }

  return interaction.editReply({ content: "Acción desconocida.", components: [] });
}

// ----- /club -----
async function esComandoClub(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const t = teams(guild.id);

  if (sub === "presupuestos") {
    const lineas = Object.values(t)
      .sort((a, b) => b.budget - a.budget)
      .map((club, i) => `**${i + 1}.** <@&${club.roleId}> — 💵 **${formatMoney(club.budget)}**`);
    const embed = new EmbedBuilder().setTitle("💰 Presupuestos de los clubes")
      .setDescription(esLista(lineas, "Todavía no hay clubes. Usa /club crear."));
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === "lista") {
    const r = roster(guild.id);
    const lineas = Object.values(t).map(club => {
      const n = Object.values(r).filter(i => i.teamRoleId === club.roleId).length;
      const dirs = club.owners?.length ? club.owners.map(id => `<@${id}>`).join(", ") : "sin director";
      return `🏆 <@&${club.roleId}> — 👥 ${n} — 💵 ${formatMoney(club.budget)} — 👑 ${dirs}`;
    });
    const embed = new EmbedBuilder().setTitle(`📋 Clubes registrados (${lineas.length})`)
      .setDescription(esLista(lineas, "Todavía no hay clubes. Usa /club crear."));
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === "info") {
    const role = interaction.options.getRole("club");
    const club = t[role.id];
    if (!club) return esError(interaction, "Ese rol no es un club registrado.");
    const r = roster(guild.id);
    const propios = Object.values(r).filter(i => i.teamRoleId === role.id && !i.cesion).length;
    const cedidosAqui = Object.values(r).filter(i => i.teamRoleId === role.id && i.cesion).length;
    const cedidosFuera = Object.values(r).filter(i => i.cesion?.origenRoleId === role.id).length;
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${role.name}`)
      .setDescription(`<@&${role.id}>`)
      .addFields(
        { name: "💵 Presupuesto", value: formatMoney(club.budget), inline: true },
        { name: "👥 Jugadores", value: String(propios), inline: true },
        { name: "🔄 Cedidos", value: `${cedidosAqui} en el club · ${cedidosFuera} fuera`, inline: true },
        { name: "👑 Director(es)", value: club.owners?.length ? club.owners.map(id => `<@${id}>`).join(", ") : "Sin director" }
      )
      .setFooter({ text: "Plantilla completa: /jugador lista" });
    return interaction.reply({ embeds: [embed] });
  }

  if (!esPuede(interaction, "staff")) return esSinPermiso(interaction, "staff");

  if (sub === "crear") {
    const role = interaction.options.getRole("rol");
    if (role.id === guild.id) return esError(interaction, "No puedes usar @everyone como club.");
    if (t[role.id]) return esError(interaction, "Ese club ya existe.");
    const textoPres = interaction.options.getString("presupuesto");
    const presupuesto = textoPres ? money(textoPres) : 50000000;
    if (!Number.isFinite(presupuesto) || presupuesto < 0) return esError(interaction, "Presupuesto inválido. Ejemplos: 50M, 750K, 1000000.");
    const directores = [interaction.options.getUser("director"), interaction.options.getUser("director2")].filter(Boolean);
    if (directores.some(u => u.bot)) return esError(interaction, "Un bot no puede ser director.");
    const owners = [...new Set(directores.map(u => u.id))];
    t[role.id] = { roleId: role.id, budget: presupuesto, owners };
    saveTeams(guild.id, t);
    await updateBudgetPanel(guild);
    return interaction.reply({
      content: `✅ Club <@&${role.id}> creado con **${formatMoney(presupuesto)}**${owners.length ? `. Director(es): ${owners.map(id => `<@${id}>`).join(", ")}` : ""}.`,
      ephemeral: true
    });
  }

  const role = interaction.options.getRole("club");
  if (!t[role.id]) return esError(interaction, "Ese rol no es un club registrado.");

  if (sub === "presupuesto") {
    const accion = interaction.options.getString("accion");
    const cantidad = money(interaction.options.getString("cantidad"));
    if (!Number.isFinite(cantidad) || cantidad < 0) return esError(interaction, "Cantidad inválida. Ejemplos: 10M, 500K.");
    if (accion === "sumar") t[role.id].budget += cantidad;
    else if (accion === "restar") t[role.id].budget -= cantidad;
    else t[role.id].budget = cantidad;
    saveTeams(guild.id, t);
    await updateBudgetPanel(guild);
    return interaction.reply({ content: `✅ <@&${role.id}> ahora tiene **${formatMoney(t[role.id].budget)}**.`, ephemeral: true });
  }

  if (sub === "renombrar") {
    const nombre = interaction.options.getString("nombre").trim();
    const antes = role.name;
    const ok = await role.setName(nombre).then(() => true).catch(() => false);
    if (!ok) return esError(interaction, "No pude cambiar el nombre del rol. Revisa que el bot tenga **Gestionar roles** y que su rol esté por encima del rol del club.");
    return interaction.reply({ content: `✅ **${antes}** ahora se llama <@&${role.id}>.`, ephemeral: true });
  }

  if (sub === "eliminar") {
    return interaction.reply({
      content: `⚠️ ¿Seguro que quieres eliminar <@&${role.id}>? Sus jugadores quedarán como agentes libres, los cedidos en el club volverán a su equipo y se perderá su presupuesto. El rol de Discord no se borra.`,
      components: [esBotonesConfirmar(`es_conf:club_eliminar:${role.id}`, "Sí, eliminar")],
      ephemeral: true
    });
  }
}

// ----- /config -----
async function esComandoConfig(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return esSinPermiso(interaction, "administrador (Gestionar servidor)");
  }
  const sub = interaction.options.getSubcommand();
  const c = cfg(interaction.guildId);
  const fmt = ids => (ids.length ? ids.map(id => `<@&${id}>`).join(", ") : "ninguno");

  if (sub === "ver") {
    const canal = id => (id ? `<#${id}>` : "sin configurar");
    const embed = new EmbedBuilder().setTitle("⚙️ Configuración del bot").setDescription(
      `🛡️ **Staff** (gestionar el bot, clubes y mercado): ${fmt(c.staffRoles)}\n` +
      `🧰 **Ayudantes** (gestionar jugadores): ${fmt(c.helperRoles)}\n` +
      `👔 **Directores** (traspasos, cesiones y contratos): ${c.directorRoles.length ? fmt(c.directorRoles) : "todos (no hay ninguno configurado)"}\n` +
      `Los administradores siempre tienen todos los permisos, y los directores de un club siempre pueden usar los comandos de director.\n\n` +
      `📢 Fichajes: ${canal(c.transferChannel)}\n💰 Presupuestos: ${canal(c.budgetChannel)}\n📨 Logs de ofertas: ${canal(c.offersLogChannel)}\n\n` +
      `🛒 Mercado: **${c.mercadoAbierto ? "abierto" : "cerrado"}** · 📅 Temporada: **${c.temporada}**`
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const canales = { canal_fichajes: "transferChannel", canal_presupuestos: "budgetChannel", canal_logs: "offersLogChannel" };
  if (canales[sub]) {
    const canal = interaction.options.getChannel("canal");
    c[canales[sub]] = canal.id;
    if (sub === "canal_presupuestos") c.budgetMessage = null;
    saveCfg(interaction.guildId, c);
    if (sub === "canal_presupuestos") await updateBudgetPanel(interaction.guild);
    return interaction.reply({ content: `✅ Canal guardado: <#${canal.id}>`, ephemeral: true });
  }

  if (sub === "nombre_bot") {
    const nombre = interaction.options.getString("nombre").trim();
    const ok = await interaction.guild.members.me.setNickname(nombre).then(() => true).catch(() => false);
    if (!ok) return esError(interaction, "No pude cambiar el nombre. El bot necesita el permiso **Cambiar apodo**.");
    return interaction.reply({ content: `✅ Ahora me llamo **${nombre}** en este servidor.`, ephemeral: true });
  }

  const quitar = sub.startsWith("quitar_");
  const tipo = sub.replace("quitar_", "").replace("rol_", "");
  const key = { staff: "staffRoles", ayudante: "helperRoles", director: "directorRoles" }[tipo];
  const role = interaction.options.getRole("rol");

  if (!quitar) {
    if (role.id === interaction.guildId) return esError(interaction, "No puedes usar @everyone.");
    if (!c[key].includes(role.id)) c[key].push(role.id);
    saveCfg(interaction.guildId, c);
    return interaction.reply({ content: `✅ <@&${role.id}> añadido como **${tipo}**. Ahora: ${fmt(c[key])}`, ephemeral: true });
  }
  c[key] = role ? c[key].filter(id => id !== role.id) : [];
  saveCfg(interaction.guildId, c);
  return interaction.reply({
    content: role ? `✅ <@&${role.id}> ya no es **${tipo}**. Quedan: ${fmt(c[key])}` : `✅ Quitados todos los roles **${tipo}**.`,
    ephemeral: true
  });
}

// ----- /director -----
async function esComandoDirector(interaction) {
  const sub = interaction.options.getSubcommand();
  const t = teams(interaction.guildId);

  if (sub === "lista") {
    const lineas = Object.values(t).map(club =>
      `🏆 <@&${club.roleId}> — 👑 ${club.owners?.length ? club.owners.map(id => `<@${id}>`).join(", ") : "sin director"}`);
    const embed = new EmbedBuilder().setTitle("👔 Directores de los clubes")
      .setDescription(esLista(lineas, "Todavía no hay clubes. Usa /club crear."));
    return interaction.reply({ embeds: [embed] });
  }

  if (!esPuede(interaction, "staff")) return esSinPermiso(interaction, "staff");
  const role = interaction.options.getRole("club");
  if (!t[role.id]) return esError(interaction, "Ese rol no es un club registrado.");
  const user = interaction.options.getUser("usuario");
  t[role.id].owners = t[role.id].owners || [];

  if (sub === "asignar") {
    if (user.bot) return esError(interaction, "Un bot no puede ser director.");
    if (!t[role.id].owners.includes(user.id)) t[role.id].owners.push(user.id);
    saveTeams(interaction.guildId, t);
    return interaction.reply({
      content: `✅ <@${user.id}> es director de <@&${role.id}>. Directores: ${t[role.id].owners.map(id => `<@${id}>`).join(", ")}`,
      ephemeral: true
    });
  }

  if (sub === "quitar") {
    t[role.id].owners = user ? t[role.id].owners.filter(id => id !== user.id) : [];
    saveTeams(interaction.guildId, t);
    return interaction.reply({
      content: user ? `✅ <@${user.id}> ya no es director de <@&${role.id}>.` : `✅ <@&${role.id}> se ha quedado sin directores.`,
      ephemeral: true
    });
  }
}

// ----- /jugador -----
async function esComandoJugador(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const r = roster(guild.id);

  if (sub === "libres") {
    const lineas = Object.entries(r)
      .filter(([, i]) => !i.teamRoleId)
      .map(([id, i]) => `🆓 <@${id}>${i.values?.posicion ? ` — ${i.values.posicion}` : ""}`);
    const embed = new EmbedBuilder().setTitle(`🆓 Agentes libres (${lineas.length})`)
      .setDescription(esLista(lineas, "No hay agentes libres. Inscríbelos con /jugador añadir."));
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === "lista") {
    const role = interaction.options.getRole("club");
    const club = teams(guild.id)[role.id];
    if (!club) return esError(interaction, "Ese rol no es un club registrado.");
    const entradas = Object.entries(r);
    const propios = entradas.filter(([, i]) => i.teamRoleId === role.id && !i.cesion);
    const aqui = entradas.filter(([, i]) => i.teamRoleId === role.id && i.cesion);
    const fuera = entradas.filter(([, i]) => i.cesion?.origenRoleId === role.id);
    const lineas = [
      `👑 Director(es): ${club.owners?.length ? club.owners.map(id => `<@${id}>`).join(", ") : "sin director"}`,
      `💵 Presupuesto: **${formatMoney(club.budget)}**`,
      "",
      `**Plantilla (${propios.length})**`,
      ...(propios.length ? propios.map(([id, i]) => `👤 <@${id}> — ${esDetalleJugador(guild, i)}`) : ["No hay jugadores."])
    ];
    if (aqui.length) lineas.push("", `**Cedidos en el club (${aqui.length})**`, ...aqui.map(([id, i]) => `🔄 <@${id}> — ${esDetalleJugador(guild, i)}`));
    if (fuera.length) lineas.push("", `**Cedidos a otros clubes (${fuera.length})**`, ...fuera.map(([id, i]) => `↗️ <@${id}> → ${esClubNombre(guild, i.teamRoleId)} (${i.cesion.duracion})`));
    const embed = new EmbedBuilder().setTitle(`📋 Plantilla de ${role.name}`).setDescription(esLista(lineas, "—"));
    return interaction.reply({ embeds: [embed] });
  }

  const user = interaction.options.getUser("jugador");
  const info = r[user.id];

  if (sub === "info") {
    if (!info) return esError(interaction, `<@${user.id}> no está registrado en el bot.`);
    const v = info.values || {};
    const fields = [
      { name: "🏆 Club", value: info.teamRoleId ? `<@&${info.teamRoleId}>` : "🆓 Agente libre", inline: true },
      { name: "📍 Posición", value: v.posicion || "—", inline: true },
      { name: "📝 Contrato", value: v.temporadas || "—", inline: true },
      { name: "🔒 Cláusula", value: v.clausula || "—", inline: true }
    ];
    if (info.cesion) fields.push({ name: "🔄 Cesión", value: `Cedido por <@&${info.cesion.origenRoleId}> (${info.cesion.duracion})`, inline: true });
    if (info.since) fields.push({ name: "📅 Desde", value: `<t:${Math.floor(new Date(info.since).getTime() / 1000)}:D>`, inline: true });
    const embed = new EmbedBuilder().setTitle(`👤 ${user.username}`).setDescription(`<@${user.id}>`).addFields(fields);
    return interaction.reply({ embeds: [embed] });
  }

  if (!esPuede(interaction, "ayudante")) return esSinPermiso(interaction, "ayudante");

  if (sub === "añadir") {
    const role = interaction.options.getRole("club");
    if (role && !teams(guild.id)[role.id]) return esError(interaction, "Ese rol no es un club registrado.");
    const nombres = ["jugador", ...Array.from({ length: 9 }, (_, i) => `jugador${i + 2}`)];
    const usuarios = [...new Map(nombres.map(n => interaction.options.getUser(n)).filter(Boolean).map(u => [u.id, u])).values()];
    const extra = {};
    for (const k of ["posicion", "clausula", "temporadas"]) {
      const v = interaction.options.getString(k);
      if (v) extra[k] = v;
    }
    await interaction.deferReply({ ephemeral: true });
    const hechos = [];
    const saltados = [];
    for (const u of usuarios) {
      const prev = r[u.id];
      if (u.bot) { saltados.push(`<@${u.id}> (es un bot)`); continue; }
      if (prev && !role) { saltados.push(`<@${u.id}> (ya registrado: usa /jugador modificar)`); continue; }
      const values = { ...(prev?.values || {}), ...extra };
      if (role) {
        await esCambiarRol(guild, u.id, prev?.teamRoleId, role.id);
        r[u.id] = { teamRoleId: role.id, type: "Añadido manualmente", values, since: new Date().toISOString() };
      } else {
        r[u.id] = { teamRoleId: null, type: "Agente libre", values, since: new Date().toISOString() };
      }
      hechos.push(`<@${u.id}>`);
    }
    saveRoster(guild.id, r);
    const partes = [];
    if (hechos.length) partes.push(`✅ ${hechos.join(", ")} ${role ? `añadido(s) a <@&${role.id}>` : "inscrito(s) como agente(s) libre(s)"}${Object.keys(extra).length ? ` (${Object.values(extra).join(" | ")})` : ""}.`);
    if (saltados.length) partes.push(`⚠️ No añadidos: ${saltados.join(", ")}`);
    return interaction.editReply(partes.join("\n"));
  }

  if (!info) return esError(interaction, `<@${user.id}> no está registrado en el bot. Usa /jugador añadir.`);

  if (sub === "modificar") {
    const role = interaction.options.getRole("club");
    const libre = interaction.options.getBoolean("libre");
    const clausula = interaction.options.getString("clausula");
    const temporadas = interaction.options.getString("temporadas");
    const posicion = interaction.options.getString("posicion");
    if (!role && !libre && !clausula && !temporadas && !posicion) return esError(interaction, "No indicaste ningún cambio.");
    if (role && libre) return esError(interaction, "Elige un club **o** dejarlo libre, no las dos cosas.");

    if (role) {
      if (!teams(guild.id)[role.id]) return esError(interaction, "Ese rol no es un club registrado.");
      await esCambiarRol(guild, user.id, info.teamRoleId, role.id);
      info.teamRoleId = role.id;
      info.type = "Modificado";
      delete info.cesion;
    }
    if (libre) {
      await esCambiarRol(guild, user.id, info.teamRoleId, null);
      esLiberar(info);
    }
    info.values = info.values || {};
    if (clausula) info.values.clausula = clausula;
    if (temporadas) info.values.temporadas = temporadas;
    if (posicion) info.values.posicion = posicion;
    saveRoster(guild.id, r);
    return interaction.reply({
      content: `✅ <@${user.id}> actualizado — ${info.teamRoleId ? `<@&${info.teamRoleId}>` : "🆓 Agente libre"} | ${esDetalleJugador(guild, info)}`,
      ephemeral: true
    });
  }

  if (sub === "quitar") {
    if (info.teamRoleId) await esCambiarRol(guild, user.id, info.teamRoleId, null);
    delete r[user.id];
    saveRoster(guild.id, r);
    return interaction.reply({ content: `✅ <@${user.id}> eliminado del bot.`, ephemeral: true });
  }
}

// ----- /mercado -----
async function esComandoMercado(interaction) {
  const sub = interaction.options.getSubcommand();
  const c = cfg(interaction.guildId);

  if (sub === "estado") {
    return interaction.reply(`${c.mercadoAbierto ? "🟢 El mercado está **ABIERTO**." : "🔴 El mercado está **CERRADO**."} Temporada actual: **${c.temporada}**.`);
  }
  if (!esPuede(interaction, "staff")) return esSinPermiso(interaction, "staff");

  if (sub === "abrir" || sub === "cerrar") {
    const abrir = sub === "abrir";
    if (c.mercadoAbierto === abrir) return esError(interaction, `El mercado ya estaba ${abrir ? "abierto" : "cerrado"}.`);
    c.mercadoAbierto = abrir;
    saveCfg(interaction.guildId, c);
    await esEnviarCanal(interaction.guild, c.transferChannel, abrir ? "🟢 **¡El mercado de fichajes está ABIERTO!**" : "🔴 **El mercado de fichajes se ha CERRADO.**");
    return interaction.reply({ content: `✅ Mercado ${abrir ? "abierto" : "cerrado"}.`, ephemeral: true });
  }

  if (sub === "fin_temporada") {
    return interaction.reply({
      content: `⚠️ **Cerrar la temporada ${c.temporada}**\nSe restará 1 temporada a todos los contratos, quedarán libres los jugadores que lleguen a 0 y terminarán las cesiones de esta temporada (las de 2 o 3 temporadas bajan 1). ¿Continuar?`,
      components: [esBotonesConfirmar("es_conf:fin_temporada", "Sí, cerrar temporada")],
      ephemeral: true
    });
  }

  if (sub === "revertir") return revertOperation(interaction, interaction.options.getInteger("numero"));
}

// ----- /contrato -----
async function esComandoContrato(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const t = teams(guild.id);
  const r = roster(guild.id);

  if (!esPuede(interaction, "director")) return esSinPermiso(interaction, "director");
  const user = interaction.options.getUser("jugador");
  const info = r[user.id];
  if (!info?.teamRoleId) return esError(interaction, "Ese jugador no tiene club.");
  const club = info.cesion ? info.cesion.origenRoleId : info.teamRoleId; // el club dueño de su contrato
  if (!t[club]?.owners?.includes(interaction.user.id) && !esPuede(interaction, "staff")) {
    return esError(interaction, "Solo el director de su club (o el staff) puede hacerlo.");
  }

  if (sub === "renovar") {
    const values = { temporadas: interaction.options.getString("temporadas") };
    const clausula = interaction.options.getString("clausula");
    if (clausula) values.clausula = clausula;
    return esIniciarOp(interaction, {
      tipo: "renovacion", jugadorId: user.id, origenRoleId: club, destinoRoleId: club, precio: 0, values,
      pasos: [{ tipo: "usuario", userId: user.id }]
    });
  }

  if (sub === "clausula") {
    const nueva = interaction.options.getString("clausula");
    const actual = info.values?.clausula || null;
    if (actual === nueva) return esError(interaction, `Ya tiene una cláusula de ${nueva}.`);
    return esIniciarOp(interaction, {
      tipo: "cambio_clausula", jugadorId: user.id, origenRoleId: club, destinoRoleId: club, precio: 0,
      clausulaAnterior: actual, values: { clausula: nueva },
      pasos: [{ tipo: "usuario", userId: user.id }]
    });
  }

  if (sub === "rescindir") {
    const motivoBase = interaction.options.getString("motivo");
    const detalle = interaction.options.getString("detalle");
    const motivo = motivoBase === "Otro" ? detalle || "Otro" : detalle ? `${motivoBase} — ${detalle}` : motivoBase;
    const prevValues = { ...(info.values || {}) };
    await interaction.deferReply({ ephemeral: true });
    await esCambiarRol(guild, user.id, info.teamRoleId, null);
    esLiberar(info);
    saveRoster(guild.id, r);

    const c = cfg(guild.id);
    c.transferNumber += 1;
    const numero = c.transferNumber;
    saveCfg(guild.id, c);
    const transfers = read(TRANSFERS_FILE);
    transfers.push({
      id: numero, guildId: guild.id, type: "Rescindir", senderId: interaction.user.id, targetId: user.id,
      teamRoleId: null, prevTeamRoleId: club, prevValues, price: 0, values: { motivo },
      confirmedAt: new Date().toISOString(), reverted: false
    });
    write(TRANSFERS_FILE, transfers);
    await esEnviarCanal(guild, c.transferChannel, `❌ | **Operación #${numero}** — Rescisión\n👤 <@${user.id}>\n🏳️ Antiguo club: **${esClubNombre(guild, club)}**\n📋 Motivo: **${motivo}**`);
    await esAvisar(user.id, `❌ Tu contrato con **${esClubNombre(guild, club)}** ha sido rescindido. Motivo: **${motivo}**. Ahora eres agente libre.`);
    return interaction.editReply(`✅ Operación #${numero} — contrato de <@${user.id}> rescindido. Motivo: **${motivo}**. Ahora es agente libre.`);
  }
}

// ----- /cesion -----
async function esComandoCesion(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const t = teams(guild.id);
  const r = roster(guild.id);

  if (sub === "lista") {
    const activas = Object.entries(r)
      .filter(([, i]) => i.cesion)
      .map(([id, i]) => `🔄 <@${id}>: ${esClubNombre(guild, i.cesion.origenRoleId)} → ${esClubNombre(guild, i.teamRoleId)} (${i.cesion.duracion})`);
    const pendientes = Object.entries(read(PENDING_FILE))
      .filter(([k, op]) => k.startsWith("op:") && op.guildId === guild.id && (op.tipo === "cesion" || op.tipo === "fin_cesion"))
      .map(([, op]) => `⏳ <@${op.jugadorId}>: ${op.tipo === "fin_cesion" ? "fin anticipado" : `${esClubNombre(guild, op.origenRoleId)} → ${esClubNombre(guild, op.destinoRoleId)} (${op.duracion})`} — esperando a ${esQuienFalta(op, guild)}`);
    const embed = new EmbedBuilder().setTitle("🔄 Cesiones").setDescription(esLista([
      `**Activas (${activas.length})**`, ...(activas.length ? activas : ["Ninguna."]),
      "", `**Pendientes (${pendientes.length})**`, ...(pendientes.length ? pendientes : ["Ninguna."])
    ], "—"));
    return interaction.reply({ embeds: [embed] });
  }

  if (!esPuede(interaction, "director")) return esSinPermiso(interaction, "director");
  if (!cfg(guild.id).mercadoAbierto) return esError(interaction, "El mercado está cerrado. El staff puede abrirlo con /mercado abrir.");
  const user = interaction.options.getUser("jugador");
  const info = r[user.id];
  const uid = interaction.user.id;

  if (sub === "proponer") {
    if (!info?.teamRoleId) return esError(interaction, "Ese jugador no tiene club.");
    if (info.cesion) return esError(interaction, "Ese jugador ya está cedido.");
    const origen = info.teamRoleId;
    if (!t[origen]?.owners?.includes(uid) && !esPuede(interaction, "staff")) return esError(interaction, "Solo el director de su club puede cederlo.");
    const destino = interaction.options.getRole("club");
    if (!t[destino.id]) return esError(interaction, "El club que lo recibe no está registrado.");
    if (destino.id === origen) return esError(interaction, "Ya juega en ese club.");
    const precio = money(interaction.options.getString("precio") || "0");
    if (!Number.isFinite(precio) || precio < 0) return esError(interaction, "Precio inválido. Ejemplos: 2M, 500K, 0.");
    if (precio > t[destino.id].budget) return esError(interaction, `**${destino.name}** no tiene presupuesto suficiente (tiene ${formatMoney(t[destino.id].budget)}).`);
    return esIniciarOp(interaction, {
      tipo: "cesion",
      jugadorId: user.id,
      origenRoleId: origen,
      destinoRoleId: destino.id,
      duracion: interaction.options.getString("duracion"),
      precio,
      values: {},
      pasos: [{ tipo: "club", roleId: destino.id }, { tipo: "usuario", userId: user.id }]
    });
  }

  if (sub === "terminar") {
    if (!info?.cesion) return esError(interaction, "Ese jugador no está cedido.");
    const origen = info.cesion.origenRoleId;
    const destino = info.teamRoleId;
    const dirOrigen = t[origen]?.owners?.includes(uid);
    const dirDestino = t[destino]?.owners?.includes(uid);
    if (!dirOrigen && !dirDestino && !esPuede(interaction, "staff")) {
      return esError(interaction, "Solo los directores de los dos clubes implicados pueden pedirlo.");
    }
    const pasos = [];
    if (!dirOrigen) pasos.push({ tipo: "club", roleId: origen });
    if (!dirDestino) pasos.push({ tipo: "club", roleId: destino });
    return esIniciarOp(interaction, { tipo: "fin_cesion", jugadorId: user.id, origenRoleId: origen, destinoRoleId: destino, precio: 0, values: {}, pasos });
  }
}

// ----- /traspaso -----
async function esComandoTraspaso(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const t = teams(guild.id);
  const r = roster(guild.id);

  if (!esPuede(interaction, "director")) return esSinPermiso(interaction, "director");
  if (!cfg(guild.id).mercadoAbierto) return esError(interaction, "El mercado está cerrado. El staff puede abrirlo con /mercado abrir.");
  const user = interaction.options.getUser("jugador");
  if (user.bot) return esError(interaction, "Un bot no puede ser jugador.");
  const info = r[user.id];
  if (info?.cesion) return esError(interaction, "Ese jugador está cedido; espera a que termine la cesión.");
  const comprador = esClubPropio(interaction, interaction.options.getRole("club"));
  if (comprador.error) return esError(interaction, comprador.error);
  const origen = info?.teamRoleId || null;
  if (origen === comprador.roleId) return esError(interaction, "Ese jugador ya es de tu club.");

  if (sub === "proponer") {
    const precio = money(interaction.options.getString("precio"));
    if (!Number.isFinite(precio) || precio < 0) return esError(interaction, "Precio inválido. Ejemplos: 20M, 750K, 0.");
    if (precio > t[comprador.roleId].budget) {
      return esError(interaction, `Tu club no tiene presupuesto suficiente (tiene ${formatMoney(t[comprador.roleId].budget)}).`);
    }
    const values = {};
    const temporadas = interaction.options.getString("temporadas");
    const clausula = interaction.options.getString("clausula");
    if (temporadas) values.temporadas = temporadas;
    if (clausula) values.clausula = clausula;
    const pasos = [];
    if (origen) pasos.push({ tipo: "club", roleId: origen });
    pasos.push({ tipo: "usuario", userId: user.id });
    return esIniciarOp(interaction, { tipo: "traspaso", jugadorId: user.id, origenRoleId: origen, destinoRoleId: comprador.roleId, precio, values, pasos });
  }

  if (sub === "clausula") {
    if (!origen) return esError(interaction, "Ese jugador es agente libre, no tiene cláusula. Usa /traspaso proponer.");
    const clausula = info.values?.clausula;
    if (!clausula) return esError(interaction, "Ese jugador no tiene cláusula registrada.");
    const precio = money(clausula);
    if (precio > t[comprador.roleId].budget) {
      return esError(interaction, `Tu club no tiene presupuesto para pagar la cláusula de ${clausula} (tiene ${formatMoney(t[comprador.roleId].budget)}).`);
    }
    return esIniciarOp(interaction, {
      tipo: "clausula",
      jugadorId: user.id,
      origenRoleId: origen,
      destinoRoleId: comprador.roleId,
      precio,
      values: {},
      pasos: [{ tipo: "usuario", userId: user.id }]
    });
  }
}

// ----- /ayuda -----
async function esComandoAyuda(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("📖 Comandos del bot")
    .addFields(
      { name: "🏆 /club", value: "`crear` · `presupuesto` · `presupuestos` · `info` · `lista` · `renombrar` · `eliminar`\nCrear y gestionar clubes y sus presupuestos." },
      { name: "👔 /director", value: "`asignar` · `lista` · `quitar`\nQuién dirige cada club. Los directores proponen traspasos y cesiones." },
      { name: "👤 /jugador", value: "`añadir` · `info` · `libres` · `lista` · `modificar` · `quitar`\nInscribir jugadores (libres o en un club, hasta 10 a la vez), ver plantillas y editar datos." },
      { name: "💸 /traspaso", value: "`proponer` — fichar a un jugador (o agente libre); el club vendedor y el jugador aceptan por MD.\n`clausula` — pagas la cláusula y solo el jugador debe aceptar." },
      { name: "🔄 /cesion", value: "`proponer` · `terminar` · `lista`\nCesiones entre clubes; el fin anticipado necesita el acuerdo de los 2 clubes." },
      { name: "✍️ /contrato", value: "`renovar` · `clausula` (subir o bajar) — el jugador acepta por MD.\n`rescindir` — el jugador queda libre al momento." },
      { name: "🛒 /mercado", value: "`abrir` · `cerrar` · `estado` · `fin_temporada` · `revertir`\nTraspasos y cesiones solo con el mercado abierto. `revertir` deshace una operación por su número." },
      { name: "⚙️ /config", value: "`rol_staff` · `rol_ayudante` · `rol_director` · `quitar_rol_…` · `canal_fichajes` · `canal_presupuestos` · `canal_logs` · `nombre_bot` · `ver`\nPermisos, canales y nombre del bot (solo administradores)." }
    )
    .setFooter({ text: "Staff: gestiona el bot · Ayudantes: gestionan jugadores · Directores: traspasos, cesiones y contratos" });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function manejarComandosES(interaction) {
  if (interaction.isButton() && /^es_(ok|no|reneg):/.test(interaction.customId)) {
    await esBotonOp(interaction);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith("es_mod:")) {
    await esModalRenegEnviado(interaction);
    return true;
  }
  if (interaction.isButton() && (interaction.customId.startsWith("es_conf:") || interaction.customId === "es_cancel")) {
    await esConfirmar(interaction);
    return true;
  }
  if (!interaction.isChatInputCommand()) return false;
  const handlers = {
    club: esComandoClub,
    config: esComandoConfig,
    director: esComandoDirector,
    jugador: esComandoJugador,
    mercado: esComandoMercado,
    cesion: esComandoCesion,
    traspaso: esComandoTraspaso,
    contrato: esComandoContrato,
    ayuda: esComandoAyuda
  };
  const handler = handlers[interaction.commandName];
  if (!handler) return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "❌ Usa este comando dentro de un servidor.", ephemeral: true });
    return true;
  }
  await handler(interaction);
  return true;
}

client.once("ready", async () => {
  console.log(`🤖 Conectado como ${client.user.tag}`);
  await registerCommands().catch(console.error);
});

client.on("interactionCreate", async interaction => {
  try {
    // comandos en español (/club, /config, /director, /jugador, /mercado, /cesion, /traspaso, /ayuda)
    if (await manejarComandosES(interaction)) return;
  } catch (error) {
    console.error(error);
    const message = { content: "❌ Ha ocurrido un error. Revisa la configuración y los permisos del bot.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

if (!process.env.TOKEN || !process.env.CLIENT_ID) {
  console.error("❌ Falta el token (TOKEN, DISCORD_BOT_TOKEN o BOT_TOKEN) o el ID (CLIENT_ID o BOT_ID) en las variables de entorno.");
  process.exit(1);
} else {
  client.login(process.env.TOKEN);
      }
