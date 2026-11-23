// LLF Transfers Bot - base funcional en un solo archivo
// Requisitos: npm install discord.js dotenv
// Crea un archivo .env con:
// TOKEN=TU_TOKEN
// CLIENT_ID=ID_DE_TU_BOT
// GUILD_ID=ID_DE_TU_SERVIDOR   (opcional, recomendado para registrar comandos rápido)

require("dotenv").config();

const fs = require("fs");
const path = require("path");
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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

    delete r[data.targetId];
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
  if (t.type === "Subida de Cláusula" || t.type === "Bajada de Cláusula") {
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

client.once("ready", async () => {
  console.log(`🤖 Conectado como ${client.user.tag}`);
  await registerCommands().catch(console.error);
});

client.on("interactionCreate", async interaction => {
  try {
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
        if (r[interaction.values[0]]) {
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
          }
        }

        return interaction.update({ content: "❌ Has rechazado la operación.", embeds: [], components: [] });
      }

      // Para anunciar hace falta que la operación se haya iniciado desde un servidor.
      const guild = data.guildId ? client.guilds.cache.get(data.guildId) : null;

      let number = 1;
      if (guild) {
        const c = cfg(guild.id);
        c.transferNumber += 1;
        number = c.transferNumber;
        saveCfg(guild.id, c);
      } else {
        const transfers = read(TRANSFERS_FILE);
        number = transfers.length + 1;
      }

      let prevTeamRoleId = null;
      let price = 0;

      if (guild) {
        const r = roster(guild.id);
        const member = await guild.members.fetch(data.targetId).catch(() => null);
        prevTeamRoleId = r[data.targetId]?.teamRoleId || null;

        if (["Fichaje libre", "Compra", "Cesión", "Renovación"].includes(data.type) && data.teamRoleId) {
          r[data.targetId] = {
            teamRoleId: data.teamRoleId,
            type: data.type,
            values: data.values,
            since: new Date().toISOString()
          };
          if (member) {
            if (prevTeamRoleId && prevTeamRoleId !== data.teamRoleId) await member.roles.remove(prevTeamRoleId).catch(() => {});
            await member.roles.add(data.teamRoleId).catch(() => {});
          }

          // mover presupuesto entre clubes cuando hay precio de por medio (Compra/Cesión)
          if (["Compra", "Cesión"].includes(data.type)) {
            price = money(data.values.precio);
            if (price > 0) {
              const t = teams(guild.id);
              if (t[data.teamRoleId]) t[data.teamRoleId].budget -= price;
              if (prevTeamRoleId && prevTeamRoleId !== data.teamRoleId && t[prevTeamRoleId]) t[prevTeamRoleId].budget += price;
              saveTeams(guild.id, t);
              await updateBudgetPanel(guild);
            }
          }
        } else if (["Subida de Cláusula", "Bajada de Cláusula"].includes(data.type) && r[data.targetId]) {
          r[data.targetId].values.clausula = data.values.clausula;
        }
        saveRoster(guild.id, r);
      }

      const transfer = {
        id: number,
        guildId: data.guildId || null,
        type: data.type,
        senderId: data.senderId,
        targetId: data.targetId,
        teamRoleId: data.teamRoleId || null,
        prevTeamRoleId,
        price,
        values: data.values,
        confirmedAt: new Date().toISOString(),
        reverted: false
      };

      const transfers = read(TRANSFERS_FILE);
      transfers.push(transfer);
      write(TRANSFERS_FILE, transfers);

      if (guild) {
        const c = cfg(guild.id);
        if (c.transferChannel) {
          const channel = await guild.channels.fetch(c.transferChannel).catch(() => null);
          if (channel?.isTextBased()) {
            const details = Object.entries(data.values).map(([k, v]) => `**${k}:** ${v}`).join(" | ");
            await channel.send(
              `✅️ | **Operación #${number}**\n` +
              `👤 <@${data.targetId}>\n` +
              `📋 Tipo: **${data.type}**\n` +
              `${details}\n` +
              `✅ <@${data.targetId}> ha confirmado.`
            );
          }
        }
        if (c.offersLogChannel) {
          const logChannel = await guild.channels.fetch(c.offersLogChannel).catch(() => null);
          if (logChannel?.isTextBased()) {
            await logChannel.send(`✅ **Oferta aceptada** — Operación #${number}\nTipo: **${data.type}**\nDe: <@${data.senderId}> → Para: <@${data.targetId}>`).catch(() => {});
          }
        }
      }

      delete pending[`approval:${pendingId}`];
      write(PENDING_FILE, pending);

      return interaction.update({
        content: `✅ Operación #${number} confirmada.`,
        embeds: [],
        components: []
      });
    }

    // personalización
    if (interaction.isStringSelectMenu() && interaction.customId === "customize") {
      const option = interaction.values[0];

      if (option === "bot_name") {
        const modal = new ModalBuilder().setCustomId("bot_name_modal").setTitle("Nombre del bot");
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("name").setLabel("Nuevo nombre en este servidor").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
      }

      if (option === "ficha_role") {
        const row = new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId("ficha_role")
            .setPlaceholder("Selecciona el rol permitido para /menu")
            .setMinValues(1).setMaxValues(1)
        );
        return interaction.update({ content: "Selecciona el rol que podrá usar /menu para fichar.", components: [row] });
      }

      if (option === "help_panel") {
        const embed = new EmbedBuilder()
          .setTitle("❓ Cómo se usa el bot")
          .setDescription(
            "**Para fichar/hacer operaciones**\n" +
            "Escribe `/menu` en cualquier canal. Ahí eliges qué operación hacer (Fichaje libre, Compra, Cesión, Renovación, Subida/Bajada de Cláusula, Rescindir) y sigues los pasos.\n\n" +
            "**Comandos de administración** (requieren permiso de Gestionar Servidor)\n" +
            "`/añadirequipo` — crea un club (rol), y opcionalmente le pones dueños y jugadores en el mismo comando.\n" +
            "`/quitarequipo` — elimina un club y libera a sus jugadores.\n" +
            "`/dueño` — asigna 1 o 2 dueños a un club ya creado.\n" +
            "`/añadirjugador` — añade jugadores directo a un club (hasta 10 a la vez), sin pasar por oferta.\n" +
            "`/personalizarpresupuesto` — suma o resta presupuesto a un club.\n" +
            "`/personalizar` — configura canales, el rol permitido para `/menu`, el nombre del bot, y este panel.\n\n" +
            "**Para cualquiera**\n" +
            "`/plantilla equipo:@rol` — muestra los jugadores fichados de un club, sus dueños y sus contratos.\n\n" +
            "**Si eres dueño de un club**\n" +
            "En `/menu` te aparece la opción \"Ver mi plantilla\". Y al hacer Fichaje libre/Compra/Cesión/Renovación o Rescindir, el bot detecta tu club automáticamente y no te pide elegirlo."
          );
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(option)
          .setPlaceholder("Selecciona un canal")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1).setMaxValues(1)
      );
      return interaction.update({ content: "Selecciona el canal.", components: [row] });
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === "ficha_role") {
      const c = cfg(interaction.guild.id);
      c.fichajeRole = interaction.values[0];
      saveCfg(interaction.guild.id, c);
      return interaction.update({ content: `✅ Ahora solo <@&${c.fichajeRole}> (o quien tenga permiso de Gestionar Servidor) puede usar /menu.`, components: [] });
    }

    if (interaction.isChannelSelectMenu() && ["transfer_channel", "budget_channel", "offers_log_channel"].includes(interaction.customId)) {
      const c = cfg(interaction.guild.id);
      const channelId = interaction.values[0];

      if (interaction.customId === "transfer_channel") c.transferChannel = channelId;
      if (interaction.customId === "offers_log_channel") c.offersLogChannel = channelId;
      if (interaction.customId === "budget_channel") {
        c.budgetChannel = channelId;
        c.budgetMessage = null;
      }

      saveCfg(interaction.guild.id, c);

      if (interaction.customId === "budget_channel") await updateBudgetPanel(interaction.guild);

      return interaction.update({ content: "✅ Configuración guardada.", components: [] });
    }

    if (interaction.isModalSubmit() && interaction.customId === "bot_name_modal") {
      const name = interaction.fields.getTextInputValue("name").slice(0, 32);
      await interaction.guild.members.me.setNickname(name);
      return interaction.reply({ content: `✅ Nombre cambiado a **${name}** en este servidor.`, ephemeral: true });
    }

    // seleccionar equipo para presupuesto
    if (interaction.isRoleSelectMenu() && interaction.customId === "budget_role") {
      const roleId = interaction.values[0];
      const modal = new ModalBuilder().setCustomId(`budget_modal:${roleId}`).setTitle("Modificar presupuesto");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("action").setLabel("Escribe: sumar o restar").setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("amount").setLabel("Cantidad (ejemplo: 10M)").setStyle(TextInputStyle.Short).setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("budget_modal:")) {
      const roleId = interaction.customId.split(":")[1];
      const action = interaction.fields.getTextInputValue("action").toLowerCase().trim();
      const amount = money(interaction.fields.getTextInputValue("amount"));

      const t = teams(interaction.guild.id);
      if (!t[roleId]) return interaction.reply({ content: "❌ Ese equipo no está añadido.", ephemeral: true });
      if (!amount || amount < 0) return interaction.reply({ content: "❌ Cantidad inválida.", ephemeral: true });

      if (action === "sumar" || action === "añadir" || action === "add") t[roleId].budget += amount;
      else if (action === "restar" || action === "quitar" || action === "subtract") t[roleId].budget -= amount;
      else return interaction.reply({ content: "❌ Acción inválida. Usa `sumar` o `restar`.", ephemeral: true });

      saveTeams(interaction.guild.id, t);
      await updateBudgetPanel(interaction.guild);

      return interaction.reply({
        content: `✅ <@&${roleId}> ahora tiene **${formatMoney(t[roleId].budget)}**.`,
        ephemeral: true
      });
    }

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
  console.log("❌ Falta TOKEN o CLIENT_ID en el archivo .env");
} else {
  client.login(process.env.TOKEN);
      }
