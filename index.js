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
  StringSelectMenuBuilder, UserSelectMenuBuilder,
  RoleSelectMenuBuilder, ChannelSelectMenuBuilder,
  ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder
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

const esCommands = [
  new SlashCommandBuilder().setName("club").setDescription("Gestión de clubes")
    .addSubcommand(s => s.setName("crear").setDescription("Crear un club y asociarle un rol de Discord")
      .addRoleOption(o => o.setName("rol").setDescription("Rol del club").setRequired(true))
      .addStringOption(o => o.setName("presupuesto").setDescription("Presupuesto inicial (ej: 50M). Por defecto 50M"))
      .addUserOption(o => o.setName("director").setDescription("Director del club (opcional)")))
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
    .addSubcommand(s => s.setName("ver").setDescription("Ver la configuración actual de permisos")),

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
    .addSubcommand(s => s.setName("añadir").setDescription("Inscribir un jugador como agente libre")
      .addUserOption(o => optJugador(o))
      .addStringOption(o => o.setName("posicion").setDescription("Posición (opcional, ej: DC, MC, POR)").setMaxLength(30)))
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
    .addSubcommand(s => s.setName("fin_temporada").setDescription("⚠️ Cerrar la temporada: resta 1 a todos los contratos y libera a los que llegan a 0")),

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

const commandData = [
  new SlashCommandBuilder().setName("menu").setDescription("Abre el menú de fichajes"),
  new SlashCommandBuilder().setName("personalizar").setDescription("Configura el bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("añadirequipo").setDescription("Añade un equipo, y opcionalmente sus dueños y jugadores")
    .addRoleOption(opt => opt.setName("equipo").setDescription("Rol del club").setRequired(true))
    .addUserOption(opt => opt.setName("dueño1").setDescription("Primer dueño (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("dueño2").setDescription("Segundo dueño (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador1").setDescription("Jugador (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador2").setDescription("Jugador (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador3").setDescription("Jugador (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador4").setDescription("Jugador (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador5").setDescription("Jugador (opcional)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("personalizarpresupuesto").setDescription("Añade o resta presupuesto")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("dueño").setDescription("Asigna los dueños de un club")
    .addRoleOption(opt => opt.setName("equipo").setDescription("Club").setRequired(true))
    .addUserOption(opt => opt.setName("dueño1").setDescription("Primer dueño").setRequired(true))
    .addUserOption(opt => opt.setName("dueño2").setDescription("Segundo dueño (opcional)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("plantilla").setDescription("Muestra la plantilla de un club")
    .addRoleOption(opt => opt.setName("equipo").setDescription("Club").setRequired(true)),
  new SlashCommandBuilder().setName("añadirjugador").setDescription("Añade uno o varios jugadores directamente a un club, sin oferta")
    .addUserOption(opt => opt.setName("jugador1").setDescription("Jugador a añadir").setRequired(true))
    .addRoleOption(opt => opt.setName("equipo").setDescription("Club").setRequired(true))
    .addStringOption(opt => opt.setName("clausula").setDescription("Cláusula (opcional)").setRequired(false)
      .addChoices(...CLAUSULA_OPTIONS_M.map(v => ({ name: `${v}M`, value: `${v}M` }))))
    .addStringOption(opt => opt.setName("temporadas").setDescription("Temporadas del contrato (opcional)").setRequired(false)
      .addChoices(...Array.from({ length: 10 }, (_, i) => ({ name: `T${i + 1}`, value: `T${i + 1}` }))))
    .addUserOption(opt => opt.setName("jugador2").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador3").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador4").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador5").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador6").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador7").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador8").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador9").setDescription("Jugador adicional (opcional)").setRequired(false))
    .addUserOption(opt => opt.setName("jugador10").setDescription("Jugador adicional (opcional)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("quitarequipo").setDescription("Elimina un club existente")
    .addRoleOption(opt => opt.setName("equipo").setDescription("Club a eliminar").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ...esCommands
].map(x => x.toJSON());

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

function mainMenu(showRoster = false, showRevert = false) {
  const options = [
    { label: "Fichaje libre", value: "Fichaje libre", emoji: "🆓" },
    { label: "Compra", value: "Compra", emoji: "💰" },
    { label: "Cesión", value: "Cesión", emoji: "🔄" },
    { label: "Revocar cesión", value: "Revocar cesión", emoji: "↩️" },
    { label: "Renovación", value: "Renovación", emoji: "✍️" },
    { label: "Subida de Cláusula", value: "Subida de Cláusula", emoji: "📈" },
    { label: "Bajada de Cláusula", value: "Bajada de Cláusula", emoji: "📉" },
    { label: "Rescindir", value: "Rescindir", emoji: "❌" }
  ];
  if (showRoster) options.push({ label: "Ver mi plantilla", value: "Mi plantilla", emoji: "📋" });
  if (showRevert) options.push({ label: "Revertir fichaje", value: "Revertir fichaje", emoji: "🔙" });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("transfer_type")
      .setPlaceholder("¿Qué quieres hacer?")
      .addOptions(options)
  );
}

function modalFor(type) {
  const modal = new ModalBuilder().setCustomId(`transfer_modal:${type}`).setTitle(type);

  const add = (id, label, required = true) => {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setStyle(TextInputStyle.Short)
          .setRequired(required)
      )
    );
  };

  switch (type) {
    case "Compra":
      add("precio", "Precio de compra");
      return modal;
    case "Cesión":
      add("precio", "Precio de la cesión");
      return modal;
    case "Revocar cesión":
      add("motivo", "Motivo de revocar la cesión");
      return modal;
    default:
      return null; // este tipo no necesita modal, ya se resolvió todo con selectores
  }
}

function buildPlantillaEmbed(guildId, role) {
  const t = teams(guildId);
  const teamData = t[role.id];
  const r = roster(guildId);

  const players = Object.entries(r).filter(([, info]) => info.teamRoleId === role.id);

  const ownersText = teamData?.owners?.length
    ? teamData.owners.map(id => `<@${id}>`).join(", ")
    : "Sin dueño asignado";

  const lines = players.length
    ? players.map(([playerId, info]) => {
        const v = info.values || {};
        const detalles = [
          v.clausula ? `Cláusula: ${v.clausula}` : null,
          v.temporadas ? `Temporadas: ${v.temporadas}` : null,
          v.precio ? `Precio: ${v.precio}` : null
        ].filter(Boolean).join(" | ");
        return `👤 <@${playerId}> — ${detalles || "sin detalles"}`;
      }).join("\n")
    : "No hay jugadores fichados.";

  return new EmbedBuilder()
    .setTitle(`📋 Plantilla de ${role.name}`)
    .setDescription(`👑 Dueño(s): ${ownersText}\n\n${lines}`);
}

function ownedTeams(guildId, userId) {
  const t = teams(guildId);
  return Object.values(t).filter(team => team.owners?.includes(userId));
}

async function buildOwnPlayersOptions(interaction, roleId) {
  const r = roster(interaction.guildId);
  const playerIds = Object.entries(r).filter(([, info]) => info.teamRoleId === roleId).map(([id]) => id);
  if (playerIds.length === 0) return [];

  const members = await interaction.guild.members.fetch().catch(() => null);
  if (!members) return null;

  return playerIds
    .map(id => {
      const m = members.get(id);
      return m ? { label: m.displayName.slice(0, 100), value: id } : { label: `Usuario ${id}`, value: id };
    })
    .slice(0, 25);
}

async function continueAfterTarget(interaction, data) {
  // Rescindir: flujo aparte, sin modal, con motivo por lista y ejecución inmediata
  if (data.type === "Rescindir") {
    const pending = read(PENDING_FILE);
    pending[interaction.user.id] = data;
    write(PENDING_FILE, pending);

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("rescind_reason")
        .setPlaceholder("¿Cuál es el motivo?")
        .addOptions(
          { label: "Inactividad", value: "Inactividad" },
          { label: "Exceso", value: "Exceso" },
          { label: "Fichaje ilegal", value: "Fichaje ilegal" },
          { label: "No contamos con él", value: "No contamos con él" },
          { label: "Otro...", value: "Otro" }
        )
    );
    return interaction.reply({ content: "❌ **Rescindir**\nSelecciona el motivo.", components: [row], ephemeral: true });
  }

  const needsTeam = ["Fichaje libre", "Compra", "Cesión", "Renovación"].includes(data.type);
  if (!needsTeam) return continueFlow(interaction, data);

  const mine = ownedTeams(interaction.guildId, interaction.user.id);

  // si eres dueño de un solo club, se asigna automáticamente sin preguntar
  if (mine.length === 1) {
    data.teamRoleId = mine[0].roleId;
    data.teamRoleName = interaction.guild.roles.cache.get(mine[0].roleId)?.name || "Equipo";
    return continueFlow(interaction, data);
  }

  // si eres dueño de varios clubes, eliges solo entre los tuyos; si no eres dueño de ninguno, eliges entre todos
  const sourceTeams = mine.length > 1
    ? Object.fromEntries(mine.map(t => [t.roleId, t]))
    : teams(interaction.guildId);

  const teamOptions = Object.keys(sourceTeams)
    .map(roleId => {
      const role = interaction.guild.roles.cache.get(roleId);
      return role ? { label: role.name.slice(0, 100), value: roleId } : null;
    })
    .filter(Boolean)
    .slice(0, 25);

  if (teamOptions.length === 0) {
    return interaction.reply({ content: "❌ No hay equipos añadidos. Usa /añadirequipo primero.", ephemeral: true });
  }

  const pending = read(PENDING_FILE);
  pending[interaction.user.id] = data;
  write(PENDING_FILE, pending);

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("transfer_team")
      .setPlaceholder("Selecciona el equipo")
      .addOptions(teamOptions)
  );

  return interaction.reply({ content: "🏆 Selecciona el equipo.", components: [row], ephemeral: true });
}

// decide el siguiente paso: pedir cláusula, pedir temporadas, mostrar modal (si falta texto libre) o finalizar
async function continueFlow(interaction, data) {
  const needsClausula = ["Fichaje libre", "Compra", "Cesión", "Renovación", "Subida de Cláusula", "Bajada de Cláusula"].includes(data.type);
  const needsTemporadas = ["Fichaje libre", "Compra", "Cesión", "Renovación"].includes(data.type);

  data.values = data.values || {};

  if (needsClausula && data.values.clausula === undefined) {
    const pending = read(PENDING_FILE);
    pending[interaction.user.id] = data;
    write(PENDING_FILE, pending);

    const options = CLAUSULA_OPTIONS_M.map(v => ({ label: `${v}M`, value: `${v}M` }));
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("select_clausula").setPlaceholder("Selecciona la cláusula").addOptions(options)
    );
    return interaction.reply({ content: "💰 Selecciona la cláusula.", components: [row], ephemeral: true });
  }

  if (needsTemporadas && data.values.temporadas === undefined) {
    const pending = read(PENDING_FILE);
    pending[interaction.user.id] = data;
    write(PENDING_FILE, pending);

    if (data.type === "Cesión") {
      const options = CESION_DURATION_OPTIONS.map(v => ({ label: v, value: v }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("select_cesion_duracion").setPlaceholder("Selecciona la duración de la cesión").addOptions(options)
      );
      return interaction.reply({ content: "📅 Selecciona la duración de la cesión.", components: [row], ephemeral: true });
    }

    const options = Array.from({ length: 10 }, (_, i) => ({ label: `T${i + 1}`, value: `T${i + 1}` }));
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("select_temporadas").setPlaceholder("Selecciona las temporadas").addOptions(options)
    );
    return interaction.reply({ content: "📅 Selecciona las temporadas.", components: [row], ephemeral: true });
  }

  const modal = modalFor(data.type);
  if (modal) {
    const pending = read(PENDING_FILE);
    pending[interaction.user.id] = data;
    write(PENDING_FILE, pending);
    return interaction.showModal(modal);
  }

  return finalizeOffer(interaction, data);
}

// arma y envía la oferta por MD (sin paso de confirmar), valida legalidad y registra el log
async function finalizeOffer(interaction, data) {
  const type = data.type;
  const values = data.values || {};
  if (data.teamRoleId) values.equipo = data.teamRoleName || "Equipo";

  data.guildId = data.originGuildId || interaction.guildId || null;

  const currentEntry = data.guildId ? roster(data.guildId)[data.targetId] : null;
  const currentClausula = currentEntry?.values?.clausula ? money(currentEntry.values.clausula) : null;

  if (currentClausula !== null) {
    if (type === "Compra" && money(values.precio) < currentClausula) {
      return interaction.reply({
        content: `❌ Oferta no válida: el precio ofrecido (${values.precio}) es menor que la cláusula actual del jugador (${currentEntry.values.clausula}).`,
        ephemeral: true
      });
    }
    if (type === "Subida de Cláusula" && money(values.clausula) <= currentClausula) {
      return interaction.reply({
        content: `❌ Oferta no válida: la nueva cláusula debe ser mayor que la actual (${currentEntry.values.clausula}).`,
        ephemeral: true
      });
    }
    if (type === "Bajada de Cláusula" && money(values.clausula) >= currentClausula) {
      return interaction.reply({
        content: `❌ Oferta no válida: la nueva cláusula debe ser menor que la actual (${currentEntry.values.clausula}).`,
        ephemeral: true
      });
    }
  }

  const target = await client.users.fetch(data.targetId);
  const fields = Object.entries(values).map(([k, v]) => `**${k}:** ${v}`).join("\n");

  const pendingId = `${interaction.user.id}_${Date.now()}`;
  const approvals = read(PENDING_FILE);
  approvals[`approval:${pendingId}`] = {
    ...data,
    values,
    senderId: interaction.user.id,
    pendingId
  };
  delete approvals[interaction.user.id];
  write(PENDING_FILE, approvals);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve:${pendingId}`).setLabel("Aceptar").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject:${pendingId}`).setLabel("Rechazar").setEmoji("❌").setStyle(ButtonStyle.Danger)
  );

  await target.send({
    content: `📩 **Nueva operación**\n\n**Tipo:** ${type}\n\n${fields}\n\n¿Aceptas esta operación?`,
    components: [row]
  }).catch(() => {});

  if (data.guildId) {
    const logGuild = client.guilds.cache.get(data.guildId);
    if (logGuild) {
      const c = cfg(data.guildId);
      if (c.offersLogChannel) {
        const logChannel = await logGuild.channels.fetch(c.offersLogChannel).catch(() => null);
        if (logChannel?.isTextBased()) {
          await logChannel.send(
            `📨 **Oferta enviada**\n` +
            `De: <@${interaction.user.id}> → Para: <@${data.targetId}>\n` +
            `Tipo: **${type}**\n` +
            `${fields}`
          ).catch(() => {});
        }
      }
    }
  }

  return interaction.reply({ content: "📩 Solicitud enviada correctamente por MD.", ephemeral: true });
}

// rescinde el contrato de inmediato, sin necesitar aceptación del jugador
async function executeRescission(interaction, data, motivo) {
  const guildId = data.originGuildId || interaction.guildId;
  const guild = guildId ? client.guilds.cache.get(guildId) : null;

  let prevTeamName = null;
  let prevTeamRoleId = null;
  let prevValues = null;
  if (guild) {
    const r = roster(guild.id);
    const prevEntry = r[data.targetId];
    prevTeamRoleId = prevEntry?.teamRoleId || null;
    prevValues = prevEntry?.values || null;
    prevTeamName = prevEntry?.values?.equipo || (prevTeamRoleId ? guild.roles.cache.get(prevTeamRoleId)?.name : null);

    // el jugador queda como agente libre (aparece en /jugador libres)
    r[data.targetId] = {
      teamRoleId: null,
      type: "Agente libre",
      values: prevValues?.posicion ? { posicion: prevValues.posicion } : {},
      since: new Date().toISOString()
    };
    saveRoster(guild.id, r);

    const member = await guild.members.fetch(data.targetId).catch(() => null);
    if (member && prevTeamRoleId) await member.roles.remove(prevTeamRoleId).catch(() => {});
  }

  const transfers = read(TRANSFERS_FILE);
  let number = transfers.length + 1;
  if (guild) {
    const c = cfg(guild.id);
    c.transferNumber += 1;
    number = c.transferNumber;
    saveCfg(guild.id, c);
  }
  transfers.push({
    id: number,
    guildId: guildId || null,
    type: "Rescindir",
    senderId: interaction.user.id,
    targetId: data.targetId,
    teamRoleId: null,
    prevTeamRoleId,
    prevValues,
    price: 0,
    values: { motivo },
    confirmedAt: new Date().toISOString(),
    reverted: false
  });
  write(TRANSFERS_FILE, transfers);

  if (guild) {
    const c = cfg(guild.id);
    if (c.transferChannel) {
      const channel = await guild.channels.fetch(c.transferChannel).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send(
          `❌ | **Operación #${number}**\n` +
          `👤 <@${data.targetId}>\n` +
          (prevTeamName ? `🏳️ Antiguo equipo: **${prevTeamName}**\n` : "") +
          `📋 Motivo: **${motivo}**`
        ).catch(() => {});
      }
    }
  }

  const pending = read(PENDING_FILE);
  delete pending[interaction.user.id];
  write(PENDING_FILE, pending);

  return interaction.reply({ content: `✅ Operación #${number} — Contrato de <@${data.targetId}> rescindido. Motivo: **${motivo}**`, ephemeral: true });
}

// revierte una operación ya confirmada (solo administradores)
async function revertOperation(interaction, transferId) {
  const guildId = interaction.guildId;
  const transfers = read(TRANSFERS_FILE);
  const t = transfers.find(x => x.id === transferId && x.guildId === guildId);

  if (!t) return interaction.reply({ content: "❌ No encontré esa operación en este servidor.", ephemeral: true });
  if (t.reverted) return interaction.reply({ content: "❌ Esa operación ya fue revertida antes.", ephemeral: true });
  if (t.type === "Subida de Cláusula" || t.type === "Bajada de Cláusula" || t.type === "Fin de cesión") {
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
      r[t.targetId] = { teamRoleId: t.prevTeamRoleId, type: "Revertido", values: {}, since: new Date().toISOString() };
      if (member) await member.roles.add(t.prevTeamRoleId).catch(() => {});
    } else {
      delete r[t.targetId];
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
// COMANDOS EN ESPAÑOL: lógica. Comparten datos con /menu:
// clubes = equipos, directores = dueños, jugadores = plantilla.
// =====================================================================

const ES_TITULOS = { traspaso: "Propuesta de traspaso", clausula: "Pago de cláusula", cesion: "Propuesta de cesión", fin_cesion: "Fin anticipado de cesión" };
const ES_TIPOS = { traspaso: "Traspaso", clausula: "Cláusula pagada", cesion: "Cesión", fin_cesion: "Fin de cesión" };
const ES_ICONOS = { traspaso: "✅️", clausula: "💥", cesion: "🔄", fin_cesion: "↩️" };

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
  lineas.push(op.tipo === "fin_cesion" ? `↩️ Vuelve de **${a}** a **${de}**` : `🔁 De **${de}** → a **${a}**`);
  if (op.tipo === "cesion") lineas.push(`📅 Duración: **${op.duracion}**`);
  if (op.precio) lineas.push(`💰 ${op.tipo === "clausula" ? "Cláusula pagada" : "Precio"}: **${formatMoney(op.precio)}**`);
  if (op.values?.temporadas) lineas.push(`📝 Contrato: **${op.values.temporadas}**`);
  if (op.values?.clausula) lineas.push(`🔒 Nueva cláusula: **${op.values.clausula}**`);
  return lineas.join("\n");
}
function esAprobadores(op) {
  const paso = op.pasos[op.paso];
  if (!paso) return [];
  if (paso.tipo === "club") return teams(op.guildId)[paso.roleId]?.owners || [];
  return [paso.userId];
}
function esQuienFalta(op, guild) {
  const paso = op.pasos[op.paso];
  if (!paso) return "nadie";
  return paso.tipo === "club" ? `los directores de **${esClubNombre(guild, paso.roleId)}**` : `<@${paso.userId}>`;
}
async function esEnviarPaso(op) {
  const guild = client.guilds.cache.get(op.guildId);
  const paso = op.pasos[op.paso];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`es_ok:${op.id}`).setLabel("Aceptar").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`es_no:${op.id}`).setLabel("Rechazar").setEmoji("❌").setStyle(ButtonStyle.Danger)
  );
  const pregunta = paso.tipo === "club"
    ? `Como director de **${esClubNombre(guild, paso.roleId)}**, ¿aceptas?`
    : "¿Aceptas esta operación?";
  const contenido = `📩 **${ES_TITULOS[op.tipo]}** — ${guild?.name || "servidor"}\nPropuesta por <@${op.proponenteId}>\n\n${esDescribirOp(op, guild)}\n\n${pregunta}`;
  let enviados = 0;
  for (const id of esAprobadores(op)) {
    const user = await client.users.fetch(id).catch(() => null);
    const ok = user ? await user.send({ content: contenido, components: [row] }).then(() => true).catch(() => false) : false;
    if (ok) enviados++;
  }
  return enviados;
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
  if (!cfg(guild.id).mercadoAbierto) return { ok: false, msg: "El mercado está cerrado." };

  const t = teams(guild.id);
  const r = roster(guild.id);
  const entry = r[op.jugadorId];
  const actual = entry?.teamRoleId || null;
  const precio = op.precio || 0;
  const ahora = new Date().toISOString();

  if (op.tipo === "fin_cesion") {
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
  if (op.tipo === "fin_cesion") {
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
  await esCambiarRol(guild, op.jugadorId, clubAnterior, nuevoClub);
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

  if (accion === "es_no") {
    esBorrarOp(id);
    await esAvisar(op.proponenteId, `❌ <@${interaction.user.id}> ha rechazado: **${ES_TITULOS[op.tipo]}**\n${esDescribirOp(op, guild)}`);
    if (guild) await esEnviarCanal(guild, cfg(guild.id).offersLogChannel, `❌ **${ES_TITULOS[op.tipo]} rechazada** por <@${interaction.user.id}>\n${esDescribirOp(op, guild)}`);
    return interaction.update({ content: `❌ Has rechazado: **${ES_TITULOS[op.tipo]}**\n\n${esDescribirOp(op, guild)}`, components: [] });
  }

  await interaction.deferUpdate();
  op.paso += 1;

  if (op.paso < op.pasos.length) {
    pending[`op:${id}`] = op;
    write(PENDING_FILE, pending);
    const enviados = await esEnviarPaso(op);
    if (!enviados) {
      esBorrarOp(id);
      await esAvisar(op.proponenteId, `❌ Tu ${ES_TITULOS[op.tipo].toLowerCase()} se canceló: no pude enviar el MD a ${esQuienFalta(op, guild)}.`);
      return interaction.editReply({ content: `✅ Aceptado, pero no pude enviar el MD a ${esQuienFalta(op, guild)}. La operación se canceló.`, components: [] });
    }
    return interaction.editReply({ content: `✅ Aceptado. Ahora falta la respuesta de ${esQuienFalta(op, guild)}.\n\n${esDescribirOp(op, guild)}`, components: [] });
  }

  esBorrarOp(id);
  const res = await esEjecutarOp(op);
  if (res.ok) {
    await esAvisar(op.proponenteId, `✅ Operación #${res.numero} completada: **${ES_TIPOS[op.tipo]}**\n${esDescribirOp(op, guild)}`);
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
    const director = interaction.options.getUser("director");
    if (director?.bot) return esError(interaction, "Un bot no puede ser director.");
    t[role.id] = { roleId: role.id, budget: presupuesto, owners: director ? [director.id] : [] };
    saveTeams(guild.id, t);
    await updateBudgetPanel(guild);
    return interaction.reply({
      content: `✅ Club <@&${role.id}> creado con **${formatMoney(presupuesto)}**${director ? ` y director <@${director.id}>` : ""}.`,
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
    const embed = new EmbedBuilder().setTitle("⚙️ Permisos del bot").setDescription(
      `🛡️ **Staff** (gestionar el bot, clubes y mercado): ${fmt(c.staffRoles)}\n` +
      `🧰 **Ayudantes** (gestionar jugadores): ${fmt(c.helperRoles)}\n` +
      `👔 **Directores** (traspasos y cesiones): ${c.directorRoles.length ? fmt(c.directorRoles) : "todos (no hay ninguno configurado)"}\n\n` +
      `Los administradores del servidor siempre tienen todos los permisos, y los directores de un club siempre pueden usar los comandos de director.\n\n` +
      `🛒 Mercado: **${c.mercadoAbierto ? "abierto" : "cerrado"}** · 📅 Temporada: **${c.temporada}**`
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
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
    if (user.bot) return esError(interaction, "Un bot no puede ser jugador.");
    if (info) {
      return esError(interaction, `<@${user.id}> ya está registrado ${info.teamRoleId ? `en <@&${info.teamRoleId}>` : "como agente libre"}. Usa /jugador modificar.`);
    }
    const posicion = interaction.options.getString("posicion");
    r[user.id] = { teamRoleId: null, type: "Agente libre", values: posicion ? { posicion } : {}, since: new Date().toISOString() };
    saveRoster(guild.id, r);
    return interaction.reply({ content: `✅ <@${user.id}> inscrito como **agente libre**${posicion ? ` (${posicion})` : ""}.`, ephemeral: true });
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
      { name: "👤 /jugador", value: "`añadir` · `info` · `libres` · `lista` · `modificar` · `quitar`\nInscribir agentes libres, ver plantillas y editar contratos." },
      { name: "🛒 /mercado", value: "`abrir` · `cerrar` · `estado` · `fin_temporada`\nLos traspasos y cesiones solo funcionan con el mercado abierto." },
      { name: "💸 /traspaso", value: "`proponer` — el club vendedor y el jugador deben aceptar por MD.\n`clausula` — pagas la cláusula y solo el jugador debe aceptar." },
      { name: "🔄 /cesion", value: "`proponer` · `terminar` · `lista`\nCesiones entre clubes; el fin anticipado necesita el acuerdo de los 2 clubes." },
      { name: "⚙️ /config", value: "`rol_staff` · `rol_ayudante` · `rol_director` · `quitar_rol_…` · `ver`\nQuién puede usar cada comando (solo administradores)." },
      { name: "📋 Menú clásico", value: "`/menu` · `/personalizar` · `/añadirequipo` · `/quitarequipo` · `/dueño` · `/añadirjugador` · `/plantilla` · `/personalizarpresupuesto`" }
    )
    .setFooter({ text: "Staff: gestiona el bot · Ayudantes: gestionan jugadores · Directores: traspasos y cesiones" });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function manejarComandosES(interaction) {
  if (interaction.isButton() && /^es_(ok|no):/.test(interaction.customId)) {
    await esBotonOp(interaction);
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

    // /menu
    if (interaction.isChatInputCommand() && interaction.commandName === "menu") {
      if (!interaction.guildId) {
        return interaction.reply({ content: "❌ Usa este comando dentro de un servidor.", ephemeral: true });
      }
      const c = cfg(interaction.guildId);
      const hasRole = c.fichajeRole && interaction.member.roles.cache.has(c.fichajeRole);
      const isManager = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
      if (c.fichajeRole && !hasRole && !isManager) {
        return interaction.reply({ content: "❌ No tienes el rol necesario para usar este comando.", ephemeral: true });
      }
      const isOwner = ownedTeams(interaction.guildId, interaction.user.id).length > 0;
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle("📋 ¿Qué quieres hacer?").setDescription("Selecciona una opción.")],
        components: [mainMenu(isOwner, isManager)],
        ephemeral: true
      });
    }

    // /personalizar
    if (interaction.isChatInputCommand() && interaction.commandName === "personalizar") {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("customize")
          .setPlaceholder("Selecciona qué quieres configurar")
          .addOptions(
            { label: "Canal de fichajes", value: "transfer_channel", emoji: "📢" },
            { label: "Canal de presupuestos", value: "budget_channel", emoji: "💰" },
            { label: "Canal de logs de ofertas", value: "offers_log_channel", emoji: "📨" },
            { label: "Nombre del bot en este servidor", value: "bot_name", emoji: "🏷️" },
            { label: "Rol permitido para /menu", value: "ficha_role", emoji: "🔑" },
            { label: "Cómo se usa el bot", value: "help_panel", emoji: "❓" }
          )
      );
      return interaction.reply({ content: "⚙️ Panel de personalización", components: [row], ephemeral: true });
    }

    // /añadirequipo
    if (interaction.isChatInputCommand() && interaction.commandName === "añadirequipo") {
      const role = interaction.options.getRole("equipo");
      const owner1 = interaction.options.getUser("dueño1");
      const owner2 = interaction.options.getUser("dueño2");
      const players = ["jugador1", "jugador2", "jugador3", "jugador4", "jugador5"]
        .map(name => interaction.options.getUser(name))
        .filter(Boolean);

      const t = teams(interaction.guildId);
      const owners = [owner1?.id, owner2?.id].filter(Boolean);
      t[role.id] = { roleId: role.id, budget: 50000000, owners };
      saveTeams(interaction.guildId, t);

      if (players.length > 0) {
        const r = roster(interaction.guildId);
        for (const player of players) {
          r[player.id] = { teamRoleId: role.id, type: "Añadido manualmente", values: {}, since: new Date().toISOString() };
        }
        saveRoster(interaction.guildId, r);
      }

      await updateBudgetPanel(interaction.guild);

      const partes = [`✅ Equipo <@&${role.id}> añadido con **50M**.`];
      if (owners.length) partes.push(`👑 Dueño(s): ${owners.map(id => `<@${id}>`).join(", ")}`);
      if (players.length) partes.push(`👤 Jugador(es): ${players.map(p => `<@${p.id}>`).join(", ")}`);

      return interaction.reply({ content: partes.join("\n"), ephemeral: true });
    }

    // /personalizarpresupuesto
    if (interaction.isChatInputCommand() && interaction.commandName === "personalizarpresupuesto") {
      const row = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("budget_role")
          .setPlaceholder("Selecciona el club")
          .setMinValues(1).setMaxValues(1)
      );
      return interaction.reply({ content: "💰 Selecciona el club cuyo presupuesto quieres modificar.", components: [row], ephemeral: true });
    }

    // /dueño
    if (interaction.isChatInputCommand() && interaction.commandName === "dueño") {
      const role = interaction.options.getRole("equipo");
      const owner1 = interaction.options.getUser("dueño1");
      const owner2 = interaction.options.getUser("dueño2");

      const t = teams(interaction.guildId);
      if (!t[role.id]) {
        return interaction.reply({ content: "❌ Ese equipo no está añadido. Usa /añadirequipo primero.", ephemeral: true });
      }

      t[role.id].owners = [owner1.id, owner2?.id].filter(Boolean);
      saveTeams(interaction.guildId, t);

      return interaction.reply({
        content: `✅ Dueño(s) de <@&${role.id}> actualizados: ${t[role.id].owners.map(id => `<@${id}>`).join(", ")}`,
        ephemeral: true
      });
    }

    // /plantilla
    if (interaction.isChatInputCommand() && interaction.commandName === "plantilla") {
      const role = interaction.options.getRole("equipo");
      const embed = buildPlantillaEmbed(interaction.guildId, role);
      return interaction.reply({ embeds: [embed] });
    }

    // /añadirjugador
    if (interaction.isChatInputCommand() && interaction.commandName === "añadirjugador") {
      const role = interaction.options.getRole("equipo");
      const clausula = interaction.options.getString("clausula");
      const temporadas = interaction.options.getString("temporadas");
      const players = ["jugador1", "jugador2", "jugador3", "jugador4", "jugador5", "jugador6", "jugador7", "jugador8", "jugador9", "jugador10"]
        .map(name => interaction.options.getUser(name))
        .filter(Boolean);

      const t = teams(interaction.guildId);
      if (!t[role.id]) {
        return interaction.reply({ content: "❌ Ese equipo no está añadido. Usa /añadirequipo primero.", ephemeral: true });
      }

      const values = {};
      if (clausula) values.clausula = clausula;
      if (temporadas) values.temporadas = temporadas;

      const r = roster(interaction.guildId);
      for (const player of players) {
        r[player.id] = {
          teamRoleId: role.id,
          type: "Añadido manualmente",
          values,
          since: new Date().toISOString()
        };
      }
      saveRoster(interaction.guildId, r);

      const detalles = [clausula ? `Cláusula: ${clausula}` : null, temporadas ? `Temporadas: ${temporadas}` : null].filter(Boolean).join(" | ");
      return interaction.reply({
        content: `✅ ${players.map(p => `<@${p.id}>`).join(", ")} añadido(s) a <@&${role.id}>${detalles ? ` (${detalles})` : " (sin cláusula ni temporadas)"}.`,
        ephemeral: true
      });
    }

    // /quitarequipo
    if (interaction.isChatInputCommand() && interaction.commandName === "quitarequipo") {
      const role = interaction.options.getRole("equipo");
      const t = teams(interaction.guildId);

      if (!t[role.id]) {
        return interaction.reply({ content: "❌ Ese equipo no estaba añadido.", ephemeral: true });
      }

      delete t[role.id];
      saveTeams(interaction.guildId, t);

      const r = roster(interaction.guildId);
      let freed = 0;
      for (const [playerId, info] of Object.entries(r)) {
        if (info.teamRoleId === role.id) {
          delete r[playerId];
          freed++;
        }
      }
      saveRoster(interaction.guildId, r);

      await updateBudgetPanel(interaction.guild);

      return interaction.reply({
        content: `✅ Equipo <@&${role.id}> eliminado. ${freed} jugador(es) han quedado libres.`,
        ephemeral: true
      });
    }

    // menú de tipo (en el canal del servidor)
    if (interaction.isStringSelectMenu() && interaction.customId === "transfer_type") {
      const type = interaction.values[0];

      // revertir fichaje (solo administradores)
      if (type === "Revertir fichaje") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: "❌ No tienes permiso para revertir operaciones.", ephemeral: true });
        }
        const modal = new ModalBuilder().setCustomId("revert_modal").setTitle("Revertir operación");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("numero").setLabel("Número de operación (ej: 5)").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
      }

      // ver mi plantilla (no requiere formulario)
      if (type === "Mi plantilla") {
        const mine = ownedTeams(interaction.guildId, interaction.user.id);
        if (mine.length === 0) {
          return interaction.reply({ content: "❌ No eres dueño de ningún club.", ephemeral: true });
        }
        if (mine.length === 1) {
          const role = interaction.guild.roles.cache.get(mine[0].roleId);
          if (!role) return interaction.reply({ content: "❌ No encontré el rol de tu club.", ephemeral: true });
          const embed = buildPlantillaEmbed(interaction.guildId, role);
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        const options = mine
          .map(team => {
            const role = interaction.guild.roles.cache.get(team.roleId);
            return role ? { label: role.name.slice(0, 100), value: team.roleId } : null;
          })
          .filter(Boolean);
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("own_roster_pick")
            .setPlaceholder("¿De qué club quieres ver la plantilla?")
            .addOptions(options)
        );
        return interaction.reply({ content: "📋 Selecciona el club.", components: [row], ephemeral: true });
      }

      const pending = read(PENDING_FILE);
      pending[interaction.user.id] = { type, step: "user", originGuildId: interaction.guildId };
      write(PENDING_FILE, pending);

      // Rescindir: si eres dueño de un club, solo se muestran tus jugadores (sin elegir club)
      if (type === "Rescindir") {
        const mine = ownedTeams(interaction.guildId, interaction.user.id);

        if (mine.length === 1) {
          const embedOptions = await buildOwnPlayersOptions(interaction, mine[0].roleId);
          if (embedOptions === null) {
            return interaction.reply({ content: "❌ No pude obtener la lista de miembros del servidor.", ephemeral: true });
          }
          if (embedOptions.length === 0) {
            return interaction.reply({ content: "❌ Tu club no tiene jugadores fichados.", ephemeral: true });
          }
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("transfer_user_own")
              .setPlaceholder("¿A qué jugador quieres rescindir?")
              .addOptions(embedOptions)
          );
          return interaction.reply({ content: `👤 **${type}**\nSelecciona al jugador.`, components: [row], ephemeral: true });
        }

        if (mine.length > 1) {
          const options = mine
            .map(team => {
              const role = interaction.guild.roles.cache.get(team.roleId);
              return role ? { label: role.name.slice(0, 100), value: team.roleId } : null;
            })
            .filter(Boolean);
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("rescind_club_pick")
              .setPlaceholder("¿De qué club quieres rescindir?")
              .addOptions(options)
          );
          return interaction.reply({ content: "❌ Selecciona el club.", components: [row], ephemeral: true });
        }
        // si no eres dueño de ningún club, sigue el flujo normal (cualquier usuario)
      }

      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId("transfer_user")
          .setPlaceholder("¿A quién quieres enviar la operación?")
          .setMinValues(1).setMaxValues(1)
      );

      return interaction.reply({
        content: `👤 **${type}**\nSelecciona al usuario.`,
        components: [row],
        ephemeral: true
      });
    }

    // plantilla propia (cuando el dueño tiene más de un club)
    if (interaction.isStringSelectMenu() && interaction.customId === "own_roster_pick") {
      const role = interaction.guild.roles.cache.get(interaction.values[0]);
      if (!role) return interaction.reply({ content: "❌ No encontré el rol de tu club.", ephemeral: true });
      const embed = buildPlantillaEmbed(interaction.guildId, role);
      return interaction.update({ content: null, embeds: [embed], components: [] });
    }

    // rescindir: club elegido cuando el dueño tiene varios clubes
    if (interaction.isStringSelectMenu() && interaction.customId === "rescind_club_pick") {
      const roleId = interaction.values[0];
      const options = await buildOwnPlayersOptions(interaction, roleId);
      if (options === null) {
        return interaction.update({ content: "❌ No pude obtener la lista de miembros del servidor.", components: [] });
      }
      if (options.length === 0) {
        return interaction.update({ content: "❌ Ese club no tiene jugadores fichados.", components: [] });
      }

      const pending = read(PENDING_FILE);
      pending[interaction.user.id] = { type: "Rescindir", step: "user", originGuildId: interaction.guildId };
      write(PENDING_FILE, pending);

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("transfer_user_own")
          .setPlaceholder("¿A qué jugador quieres rescindir?")
          .addOptions(options)
      );
      return interaction.update({ content: "👤 **Rescindir**\nSelecciona al jugador.", components: [row] });
    }

    // usuario seleccionado (flujo normal)
    if (interaction.isUserSelectMenu() && interaction.customId === "transfer_user") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      // en fichaje libre no se puede fichar a alguien que ya tiene club
      if (data.type === "Fichaje libre") {
        const r = roster(interaction.guildId);
        if (r[interaction.values[0]]?.teamRoleId) {
          return interaction.reply({ content: "❌ Ese jugador ya está fichado en un club, no está libre.", ephemeral: true });
        }
      }

      data.targetId = interaction.values[0];
      pending[interaction.user.id] = data;
      write(PENDING_FILE, pending);

      return continueAfterTarget(interaction, data);
    }

    // usuario seleccionado (rescindir, solo tus propios jugadores)
    if (interaction.isStringSelectMenu() && interaction.customId === "transfer_user_own") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      data.targetId = interaction.values[0];
      pending[interaction.user.id] = data;
      write(PENDING_FILE, pending);

      return continueAfterTarget(interaction, data);
    }

    // equipo seleccionado
    if (interaction.isStringSelectMenu() && interaction.customId === "transfer_team") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      data.teamRoleId = interaction.values[0];
      data.teamRoleName = interaction.guild.roles.cache.get(data.teamRoleId)?.name || "Equipo";
      return continueFlow(interaction, data);
    }

    // cláusula seleccionada
    if (interaction.isStringSelectMenu() && interaction.customId === "select_clausula") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      data.values = data.values || {};
      data.values.clausula = interaction.values[0];
      return continueFlow(interaction, data);
    }

    // temporadas seleccionadas
    if (interaction.isStringSelectMenu() && interaction.customId === "select_temporadas") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      data.values = data.values || {};
      data.values.temporadas = interaction.values[0];
      return continueFlow(interaction, data);
    }

    // duración de la cesión seleccionada (1 partido a 3 temporadas)
    if (interaction.isStringSelectMenu() && interaction.customId === "select_cesion_duracion") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      data.values = data.values || {};
      data.values.temporadas = interaction.values[0];
      return continueFlow(interaction, data);
    }

    // motivo de rescindir seleccionado -> ejecuta ya, sin confirmar ni pedir aceptación
    if (interaction.isStringSelectMenu() && interaction.customId === "rescind_reason") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      const reason = interaction.values[0];
      if (reason === "Otro") {
        const modal = new ModalBuilder().setCustomId("rescind_reason_modal").setTitle("Motivo de la rescisión");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("motivo").setLabel("Especifica el motivo").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
      }

      return executeRescission(interaction, data, reason);
    }

    if (interaction.isModalSubmit() && interaction.customId === "rescind_reason_modal") {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      const motivo = interaction.fields.getTextInputValue("motivo");
      return executeRescission(interaction, data, motivo);
    }

    // revertir operación: número enviado
    if (interaction.isModalSubmit() && interaction.customId === "revert_modal") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "❌ No tienes permiso para revertir operaciones.", ephemeral: true });
      }
      const raw = interaction.fields.getTextInputValue("numero").replace("#", "").trim();
      const transferId = parseInt(raw, 10);
      if (!transferId || isNaN(transferId)) {
        return interaction.reply({ content: "❌ Número de operación inválido.", ephemeral: true });
      }
      return revertOperation(interaction, transferId);
    }

    // formulario operación (solo precio/motivo cuando aplica) -> se envía directo por MD, sin paso extra de confirmar
    if (interaction.isModalSubmit() && interaction.customId.startsWith("transfer_modal:")) {
      const pending = read(PENDING_FILE);
      const data = pending[interaction.user.id];
      if (!data) return interaction.reply({ content: "❌ La sesión ha caducado.", ephemeral: true });

      data.values = data.values || {};
      for (const field of interaction.fields.fields.values()) {
        data.values[field.customId] = field.value;
      }

      return finalizeOffer(interaction, data);
    }

    // aceptar/rechazar
    if (interaction.isButton() && (interaction.customId.startsWith("approve:") || interaction.customId.startsWith("reject:"))) {
      const [action, pendingId] = interaction.customId.split(":");
      const pending = read(PENDING_FILE);
      const data = pending[`approval:${pendingId}`];

      if (!data) return interaction.reply({ content: "❌ Esta solicitud ya no existe.", ephemeral: true });
      if (interaction.user.id !== data.targetId) return interaction.reply({ content: "❌ Esta solicitud no es para ti.", ephemeral: true });

      if (action === "reject") {
        delete pending[`approval:${pendingId}`];
        write(PENDING_FILE, pending);

        if (data.guildId) {
          const logGuild = client.guilds.cache.get(data.guildId);
          if (logGuild) {
            const cLog = cfg(data.guildId);
            if (cLog.offersLogChannel) {
              const logChannel = await logGuild.channels.fetch(cLog.offersLogChannel).catch(() => null);
              if (logChannel?.isTextBased()) {
                await logChannel.send(`❌ **Oferta rechazada**\nTipo: **${data.type}**\nDe: <@${data.senderId}> → Para: <@${data.targetId}>`).catch(() => {});
              }
            }
        
