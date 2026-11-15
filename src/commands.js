'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');
const { embed, COLOR, fmtMoney, safeReply, safeError, POSITIONS, POSITION_NAMES } = require('./helpers');
const economy = require('./economy');
const futdb = require('./futdb');
const competitions = require('./competitions');
const panels = require('./panels');
const cards = require('./cards');

function isAdmin(interaction) {
  return Boolean(interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild));
}

async function requireAdmin(i) {
  if (isAdmin(i)) return true;
  await safeReply(i, { content: '❌ Necesitas el permiso de "Gestionar servidor" para usar esto.', flags: 64 });
  return false;
}

/* Publica (o republica) el resultado de un partido en el canal configurado, además de
   responder a quien jugó el partido. Si no hay canal configurado o es el mismo canal
   actual, no se duplica el mensaje. */
async function announceMatch(interaction, guild, resultEmbed) {
  const channelId = guild.channel_resultados || guild.channel_partidos;
  if (channelId && channelId !== interaction.channelId) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      await ch.send({ embeds: [resultEmbed] });
    } catch (e) {
      console.error('[jugar] No se pudo publicar en el canal configurado:', e.message);
    }
  }
}

const commands = [
  // ---------- /panel ----------
  {
    data: new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Publica un panel interactivo del bot (solo administradores).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sc) => sc.setName('fichajes').setDescription('Publica el panel de fichajes en este canal.'))
      .addSubcommand((sc) => sc.setName('inscripciones').setDescription('Publica el panel de inscripción de clubes en este canal.')),
    async execute(i) {
      if (!(await requireAdmin(i))) return;
      const sub = i.options.getSubcommand();
      const guildRow = await economy.ensureGuild(i.guildId);
      if (sub === 'fichajes') {
        await i.reply({ embeds: [panels.fichajesEmbed()], components: panels.fichajesComponents() });
        return;
      }
      const clubs = await economy.listClubs(i.guildId);
      const msg = await i.reply({
        embeds: [panels.inscripcionEmbed(guildRow, clubs)],
        components: panels.inscripcionComponents(guildRow, clubs),
        fetchReply: true,
      });
      await economy.setInscripcionPanel(i.guildId, msg.channelId, msg.id);
    },
  },

  // ---------- /config ----------
  {
    data: new SlashCommandBuilder()
      .setName('config')
      .setDescription('Configura el bot (solo administradores).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sc) => sc
        .setName('canal')
        .setDescription('Define el canal usado para una función del bot.')
        .addStringOption((o) => o.setName('tipo').setDescription('Función').setRequired(true).addChoices(
          { name: 'Fichajes', value: 'fichajes' },
          { name: 'Inscripciones', value: 'inscripciones' },
          { name: 'Partidos', value: 'partidos' },
          { name: 'Resultados', value: 'resultados' },
        ))
        .addChannelOption((o) => o.setName('canal').setDescription('Canal a usar').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand((sc) => sc
        .setName('max-clubes')
        .setDescription('Define el máximo de clubes que se pueden inscribir.')
        .addIntegerOption((o) => o.setName('cantidad').setDescription('Máximo de clubes').setRequired(true).setMinValue(2).setMaxValue(64)))
      .addSubcommand((sc) => sc
        .setName('inscripciones')
        .setDescription('Abre o cierra las inscripciones de clubes.')
        .addBooleanOption((o) => o.setName('abiertas').setDescription('¿Abiertas?').setRequired(true))),
    async execute(i) {
      if (!(await requireAdmin(i))) return;
      const sub = i.options.getSubcommand();
      if (sub === 'canal') {
        const tipo = i.options.getString('tipo');
        const canal = i.options.getChannel('canal');
        await economy.setChannel(i.guildId, tipo, canal.id);
        await i.reply({ embeds: [embed(COLOR.green, '✅ Canal actualizado', 'El canal de **' + tipo + '** ahora es ' + canal.toString() + '.')] });
      } else if (sub === 'max-clubes') {
        const cantidad = i.options.getInteger('cantidad');
        await economy.setMaxClubs(i.guildId, cantidad);
        await i.reply({ embeds: [embed(COLOR.green, '✅ Límite actualizado', 'El máximo de clubes ahora es **' + cantidad + '**.')] });
      } else if (sub === 'inscripciones') {
        const abiertas = i.options.getBoolean('abiertas');
        await economy.ensureGuild(i.guildId);
        const { query } = require('./db');
        await query('UPDATE guilds SET inscripcion_open = $2 WHERE guild_id = $1', [i.guildId, abiertas]);
        await i.reply({ embeds: [embed(COLOR.green, '✅ Inscripciones ' + (abiertas ? 'abiertas' : 'cerradas'), null)] });
      }
    },
  },

  // ---------- /plantilla ----------
  {
    data: new SlashCommandBuilder().setName('plantilla').setDescription('Muestra el presupuesto y la plantilla de tu club.'),
    async execute(i) {
      const club = await economy.getClubByOwner(i.guildId, i.user.id);
      if (!club) return safeReply(i, { content: '❌ No tienes un club inscrito en este servidor.', flags: 64 });
      const squad = await economy.squad(i.guildId, club.id);
      const e = embed(COLOR.blue, '🏟️ ' + club.name, 'Presupuesto: **' + fmtMoney(club.budget) + '**');
      if (!squad.length) {
        e.addFields({ name: 'Plantilla', value: 'Todavía no tienes jugadores. Usa el panel de fichajes para empezar a fichar.' });
      } else {
        const byPos = {};
        for (const p of squad) (byPos[p.position] ||= []).push(p);
        for (const [pos, players] of Object.entries(byPos)) {
          e.addFields({
            name: POSITION_NAMES[pos] + ' (' + pos + ')',
            value: players.map((p) => '• **' + p.name + '** — ' + p.rating + ' ovr · RIT ' + p.pace + ' TIR ' + p.shooting + ' PAS ' + p.passing + ' REG ' + p.dribbling + ' DEF ' + p.defending + ' FÍS ' + p.physical).join('\n').slice(0, 1024),
          });
        }
      }
      await safeReply(i, { embeds: [e] });
    },
  },

  // ---------- /actualizar-jugadores ----------
  {
    data: new SlashCommandBuilder().setName('actualizar-jugadores').setDescription('Sincroniza el catálogo de jugadores (solo administradores).').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(i) {
      if (!(await requireAdmin(i))) return;
      await i.deferReply();
      const r = await futdb.syncCatalog(i.guildId);
      if (!r.ok) {
        const motivo = {
          'sin-clave': 'No hay una FUTDB_API_KEY configurada en los Secrets del host.',
          'clave-invalida': 'La FUTDB_API_KEY configurada no es válida (error 401/403).',
          'sin-datos': 'FUT-DB respondió pero sin jugadores aprovechables.',
        }[r.reason] || ('No se pudo contactar con FUT-DB (' + r.reason + ').');
        const extra = r.kept ? ' El catálogo ya existente se mantiene sin cambios; no se borró nada.' : ' Se usará (o se mantiene) el catálogo de cartas de prueba.';
        return safeReply(i, { embeds: [embed(COLOR.gold, '⚠️ No se pudo actualizar desde FUT-DB', motivo + extra)] });
      }
      const origen = r.source === 'futdb' ? 'FUT-DB (datos oficiales)' : 'cartas de prueba (FUT-DB no disponible)';
      await safeReply(i, { embeds: [embed(COLOR.green, '✅ Catálogo actualizado', 'Origen: **' + origen + '**\nJugadores en catálogo: **' + r.count + '**\n\nLos jugadores ya fichados y las estadísticas de temporadas anteriores no se tocan.')] });
    },
  },

  // ---------- /crear-carta ----------
  {
    data: new SlashCommandBuilder()
      .setName('crear-carta')
      .setDescription('Crea una carta de jugador personalizada para el catálogo (solo administradores).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre del jugador').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('posicion').setDescription('Posición').setRequired(true).addChoices(...POSITIONS.map((p) => ({ name: POSITION_NAMES[p] + ' (' + p + ')', value: p }))))
      .addIntegerOption((o) => o.setName('valoracion').setDescription('Valoración general (1-99)').setRequired(true).setMinValue(1).setMaxValue(99))
      .addIntegerOption((o) => o.setName('precio').setDescription('Precio en euros (0 = agente libre)').setRequired(true).setMinValue(0))
      .addAttachmentOption((o) => o.setName('imagen').setDescription('Foto del jugador (opcional; si no se da, la carta usa un diseño genérico)'))
      .addIntegerOption((o) => o.setName('ritmo').setDescription('RIT (por defecto, igual a la valoración)').setMinValue(1).setMaxValue(99))
      .addIntegerOption((o) => o.setName('tiro').setDescription('TIR (por defecto, igual a la valoración)').setMinValue(1).setMaxValue(99))
      .addIntegerOption((o) => o.setName('pase').setDescription('PAS (por defecto, igual a la valoración)').setMinValue(1).setMaxValue(99))
      .addIntegerOption((o) => o.setName('regate').setDescription('REG (por defecto, igual a la valoración)').setMinValue(1).setMaxValue(99))
      .addIntegerOption((o) => o.setName('defensa').setDescription('DEF (por defecto, igual a la valoración)').setMinValue(1).setMaxValue(99))
      .addIntegerOption((o) => o.setName('fisico').setDescription('FÍS (por defecto, igual a la valoración)').setMinValue(1).setMaxValue(99)),
    async execute(i) {
      if (!(await requireAdmin(i))) return;
      const imagen = i.options.getAttachment('imagen');
      if (imagen && !/^image\//.test(imagen.contentType || '')) {
        return safeReply(i, { content: '❌ El archivo adjunto tiene que ser una imagen (PNG, JPG, etc.).', flags: 64 });
      }
      const rating = i.options.getInteger('valoracion');
      await i.deferReply();
      const player = await futdb.createCustomCard(i.guildId, {
        name: i.options.getString('nombre'),
        position: i.options.getString('posicion'),
        rating,
        price: i.options.getInteger('precio'),
        pace: i.options.getInteger('ritmo') ?? rating,
        shooting: i.options.getInteger('tiro') ?? rating,
        passing: i.options.getInteger('pase') ?? rating,
        dribbling: i.options.getInteger('regate') ?? rating,
        defending: i.options.getInteger('defensa') ?? rating,
        physical: i.options.getInteger('fisico') ?? rating,
        imageUrl: imagen ? imagen.url : null,
      });
      const buffer = await cards.renderPlayerCard(player);
      const file = new AttachmentBuilder(buffer, { name: 'carta.png' });
      const e = embed(COLOR.green, '✅ Carta creada', null)
        .setImage('attachment://carta.png')
        .addFields(
          { name: 'Jugador', value: player.name, inline: true },
          { name: 'Posición', value: POSITION_NAMES[player.position] + ' (' + player.position + ')', inline: true },
          { name: 'Precio', value: player.price > 0 ? fmtMoney(player.price) : 'Agente libre', inline: true },
        )
        .setFooter({ text: 'Ya está disponible en el panel de fichajes, en su posición correspondiente.' });
      await safeReply(i, { embeds: [e], files: [file] });
    },
  },

  // ---------- /temporada ----------
  {
    data: new SlashCommandBuilder().setName('temporada').setDescription('Inicia una nueva temporada (Liga, Champions y Europa League) (solo administradores).').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(i) {
      if (!(await requireAdmin(i))) return;
      const r = await competitions.startSeason(i.guildId);
      if (!r.ok) return safeReply(i, { embeds: [embed(COLOR.gold, '⚠️ No se pudo iniciar la temporada', r.reason)] });
      const e = embed(COLOR.green, '🏆 Temporada ' + r.season.number + ' iniciada', 'Se generaron la Liga, la Champions League y la Europa League.')
        .addFields(
          { name: 'Champions League', value: r.uclCount + ' clubes', inline: true },
          { name: 'Europa League', value: r.uelCount + ' clubes', inline: true },
        );
      await safeReply(i, { embeds: [e] });
    },
  },

  // ---------- /jugar ----------
  {
    data: new SlashCommandBuilder().setName('jugar').setDescription('Disputa el siguiente partido pendiente de tu club.'),
    async execute(i) {
      const club = await economy.getClubByOwner(i.guildId, i.user.id);
      if (!club) return safeReply(i, { content: '❌ No tienes un club inscrito en este servidor.', flags: 64 });
      const season = await competitions.getActiveSeason(i.guildId);
      if (!season) return safeReply(i, { content: '❌ No hay ninguna temporada en curso.', flags: 64 });
      const pending = await competitions.nextPendingMatch(i.guildId, season.id, club.id);
      if (!pending) return safeReply(i, { content: 'ℹ️ No tienes partidos pendientes por ahora.', flags: 64 });

      await i.deferReply();
      const r = await competitions.playMatch(i.guildId, pending.id, club.id);
      if (!r.ok) return safeReply(i, { content: '❌ ' + r.reason });

      const homeClub = await economy.getClubById(i.guildId, pending.home_club_id);
      const awayClub = await economy.getClubById(i.guildId, pending.away_club_id);
      const goleadores = (events) => events.length
        ? events.map((e) => '⚽ ' + e.scorer + (e.assist ? ' (asist. ' + e.assist + ')' : '') + ' — min. ' + e.minute).join('\n')
        : '—';

      const e = embed(COLOR.blue, '⚽ ' + pending.round_label + ' — ' + pending.comp_name, null)
        .addFields(
          { name: homeClub.name, value: String(r.home.goals), inline: true },
          { name: 'vs', value: '—', inline: true },
          { name: awayClub.name, value: String(r.away.goals), inline: true },
          { name: 'Goles de ' + homeClub.name, value: goleadores(r.home.events) },
          { name: 'Goles de ' + awayClub.name, value: goleadores(r.away.events) },
        );
      if (r.penalties) e.addFields({ name: 'Nota', value: 'Terminó empatado y se resolvió en la tanda de penaltis.' });

      await safeReply(i, { embeds: [e] });
      const guildRow = await economy.ensureGuild(i.guildId);
      await announceMatch(i, guildRow, e);
    },
  },

  // ---------- /tabla ----------
  {
    data: new SlashCommandBuilder()
      .setName('tabla')
      .setDescription('Muestra las clasificaciones de la temporada en curso.')
      .addStringOption((o) => o.setName('competicion').setDescription('Competición a mostrar').addChoices(
        { name: 'Liga', value: 'liga' }, { name: 'Champions League', value: 'ucl' }, { name: 'Europa League', value: 'uel' },
      )),
    async execute(i) {
      const season = await competitions.getActiveSeason(i.guildId);
      if (!season) return safeReply(i, { content: 'ℹ️ No hay ninguna temporada en curso.' });
      const tipos = i.options.getString('competicion') ? [i.options.getString('competicion')] : ['liga', 'ucl', 'uel'];
      const embeds = [];
      for (const tipo of tipos) {
        const s = await competitions.standings(season.id, tipo);
        if (!s) continue;
        const nombre = { liga: 'Liga', ucl: 'Champions League', uel: 'Europa League' }[tipo];
        if (tipo === 'liga') {
          const lines = s.table.map((row, idx) => (idx + 1) + '. **' + row.name + '** — ' + row.pts + ' pts (PJ ' + row.pj + ', G ' + row.g + ', E ' + row.e + ', P ' + row.p + ', GF ' + row.gf + ', GC ' + row.gc + ')');
          embeds.push(embed(COLOR.blue, '📊 ' + nombre, lines.join('\n').slice(0, 4000) || 'Sin partidos jugados todavía.'));
        } else {
          const lines = s.table.filter((r) => r.pj > 0).sort((a, b) => b.pts - a.pts).map((row) => '**' + row.name + '** — ' + row.pj + ' jugados, ' + row.g + 'G ' + row.e + 'E ' + row.p + 'P');
          embeds.push(embed(COLOR.gold, '🏆 ' + nombre, lines.length ? lines.join('\n') : 'Eliminatoria en curso, todavía sin resultados.'));
        }
      }
      if (!embeds.length) return safeReply(i, { content: 'ℹ️ Esa competición no existe esta temporada (quizá no hubo clubes suficientes).' });
      await safeReply(i, { embeds: embeds.slice(0, 10) });
    },
  },

  // ---------- /premios ----------
  {
    data: new SlashCommandBuilder().setName('premios').setDescription('Muestra los premios de la última temporada finalizada.'),
    async execute(i) {
      const season = await competitions.lastFinishedSeason(i.guildId);
      if (!season) return safeReply(i, { content: 'ℹ️ Todavía no se ha finalizado ninguna temporada.' });
      const awards = await competitions.seasonAwards(season.id);
      const e = embed(COLOR.gold, '🏅 Premios — Temporada ' + season.number, null);
      const line = (row, extra) => (row ? '**' + row.name + '**' + (extra ? ' — ' + extra : '') : 'Sin datos suficientes');
      e.addFields(
        { name: '🥇 Balón de Oro', value: line(awards.balon_de_oro, awards.balon_de_oro ? (awards.balon_de_oro.goals || 0) + ' goles, ' + (awards.balon_de_oro.assists || 0) + ' asist.' : null) },
        { name: '👟 Bota de Oro', value: line(awards.bota_de_oro, awards.bota_de_oro ? (awards.bota_de_oro.goals || 0) + ' goles' : null) },
        { name: '🧤 Guante de Oro', value: line(awards.guante_de_oro) },
        { name: '🏟️ Club del Año', value: line(awards.club_del_ano, awards.club_del_ano ? (awards.club_del_ano.pts || 0) + ' pts' : null) },
      );
      await safeReply(i, { embeds: [e] });
    },
  },

  // ---------- /finalizar-temporada ----------
  {
    data: new SlashCommandBuilder().setName('finalizar-temporada').setDescription('Finaliza la temporada en curso y calcula los premios (solo administradores).').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(i) {
      if (!(await requireAdmin(i))) return;
      const season = await competitions.getActiveSeason(i.guildId);
      if (!season) return safeReply(i, { content: 'ℹ️ No hay ninguna temporada en curso.' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fin:confirmar:' + i.user.id).setLabel('Sí, finalizar temporada').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('fin:cancelar:' + i.user.id).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      );
      await i.reply({
        embeds: [embed(COLOR.gold, '⚠️ ¿Finalizar la temporada ' + season.number + '?', 'Se calcularán los premios y no se podrán jugar más partidos de esta temporada. Esta acción no se puede deshacer.')],
        components: [row],
      });
    },
  },
];

module.exports = { commands, isAdmin, requireAdmin, announceMatch };
