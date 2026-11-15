'use strict';

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { embed, COLOR, fmtMoney, safeReply, safeError } = require('./helpers');
const economy = require('./economy');
const competitions = require('./competitions');
const panels = require('./panels');
const { isAdmin } = require('./commands');

async function refreshInscripcionPanel(client, guildId) {
  const guildRow = await economy.ensureGuild(guildId);
  if (!guildRow.inscripcion_panel_channel_id || !guildRow.inscripcion_panel_message_id) return;
  try {
    const ch = await client.channels.fetch(guildRow.inscripcion_panel_channel_id);
    const msg = await ch.messages.fetch(guildRow.inscripcion_panel_message_id);
    const clubs = await economy.listClubs(guildId);
    await msg.edit({ embeds: [panels.inscripcionEmbed(guildRow, clubs)], components: panels.inscripcionComponents(guildRow, clubs) });
  } catch (e) {
    console.error('[panel] No se pudo refrescar el panel de inscripción:', e.message);
  }
}

async function handleButton(i) {
  const id = i.customId;

  if (id === 'panel:inscribirme') {
    const guildRow = await economy.ensureGuild(i.guildId);
    if (!guildRow.inscripcion_open) return safeReply(i, { content: '🔒 Las inscripciones están cerradas ahora mismo.', flags: 64 });
    const existing = await economy.getClubByOwner(i.guildId, i.user.id);
    if (existing) return safeReply(i, { content: '❌ Ya tienes un club inscrito: **' + existing.name + '**.', flags: 64 });
    const modal = new ModalBuilder().setCustomId('modal:inscribir').setTitle('Inscribir club');
    const input = new TextInputBuilder().setCustomId('nombre').setLabel('Nombre del club').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(40);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return i.showModal(modal);
  }

  if (id.startsWith('panel:mercado:')) {
    const pool = id.split(':')[2];
    return safeReply(i, { content: 'Elige una posición para ' + panels.POOL_LABELS[pool].toLowerCase() + ':', components: panels.positionSelectRow(pool), flags: 64 });
  }

  if (id.startsWith('mkt:prev:') || id.startsWith('mkt:next:')) {
    const [, dir, pool, position, offsetStr] = id.split(':');
    const offset = parseInt(offsetStr, 10) + (dir === 'next' ? 1 : -1);
    await i.deferUpdate();
    const club = await economy.getClubByOwner(i.guildId, i.user.id);
    const page = await panels.buildMarketPage(i.guildId, pool, position, club ? club.id : null, offset);
    if (page.empty) return i.editReply({ embeds: [page.embed], components: [], files: [] });
    return i.editReply({ embeds: [page.embed], components: page.components, files: page.files });
  }

  if (id.startsWith('mkt:action:')) {
    const [, , pool, position, offsetStr, playerIdStr] = id.split(':');
    const offset = parseInt(offsetStr, 10);
    const playerId = parseInt(playerIdStr, 10);
    await i.deferUpdate();

    const club = await economy.getClubByOwner(i.guildId, i.user.id);
    let msg;
    if (!club) {
      msg = { ok: false, content: '❌ No tienes un club inscrito en este servidor.' };
    } else if (pool === 'libre') {
      const r = await economy.signFreeAgent(i.guildId, club.id, playerId);
      msg = r.ok ? { ok: true, content: '✅ Fichaste a **' + r.player.name + '** como agente libre.' } : { ok: false, content: '❌ ' + r.reason };
    } else if (pool === 'comprar') {
      const r = await economy.buyPlayer(i.guildId, club.id, playerId);
      msg = r.ok
        ? { ok: true, content: '✅ Compraste a **' + r.player.name + '** por ' + fmtMoney(r.spent) + '. Presupuesto restante: ' + fmtMoney(r.remaining) + '.' }
        : { ok: false, content: '❌ ' + r.reason };
    } else if (pool === 'rescindir') {
      const r = await economy.releasePlayer(i.guildId, club.id, playerId);
      msg = r.ok ? { ok: true, content: 'ℹ️ Rescindiste a **' + r.player.name + '**. Vuelve al mercado y no hay reembolso; tu presupuesto no cambió.' } : { ok: false, content: '❌ ' + r.reason };
    } else {
      msg = { ok: false, content: '❌ Acción no reconocida.' };
    }

    const page = await panels.buildMarketPage(i.guildId, pool, position, club ? club.id : null, offset);
    if (page.empty) await i.editReply({ embeds: [page.embed], components: [], files: [] });
    else await i.editReply({ embeds: [page.embed], components: page.components, files: page.files });
    await i.followUp({ content: msg.content, flags: 64 });
    return;
  }

  if (id.startsWith('fin:')) {
    const [, accion, userId] = id.split(':');
    if (i.user.id !== userId) return safeReply(i, { content: '❌ Solo quien inició esta confirmación puede responderla.', flags: 64 });
    if (!isAdmin(i)) return safeReply(i, { content: '❌ Necesitas el permiso de "Gestionar servidor" para esto.', flags: 64 });
    if (accion === 'cancelar') return i.update({ embeds: [embed(COLOR.gray, 'Cancelado', 'No se finalizó la temporada.')], components: [] });

    await i.deferUpdate();
    const r = await competitions.finishSeason(i.guildId);
    if (!r.ok) return i.editReply({ embeds: [embed(COLOR.gold, '⚠️ No se pudo finalizar', r.reason)], components: [] });
    const line = (row) => (row ? '**' + row.name + '**' : 'Sin datos suficientes');
    const e = embed(COLOR.gold, '🏁 Temporada ' + r.season.number + ' finalizada', 'Estos son los premios de la temporada:')
      .addFields(
        { name: '🥇 Balón de Oro', value: line(r.awards.balon_de_oro) },
        { name: '👟 Bota de Oro', value: line(r.awards.bota_de_oro) },
        { name: '🧤 Guante de Oro', value: line(r.awards.guante_de_oro) },
        { name: '🏟️ Club del Año', value: line(r.awards.club_del_ano) },
      );
    return i.editReply({ embeds: [e], components: [] });
  }
}

async function handleSelect(i) {
  if (i.customId.startsWith('select:posicion:')) {
    const pool = i.customId.split(':')[2];
    const position = i.values[0];
    await i.deferUpdate();
    const club = await economy.getClubByOwner(i.guildId, i.user.id);
    const page = await panels.buildMarketPage(i.guildId, pool, position, club ? club.id : null, 0);
    if (page.empty) return i.editReply({ content: null, embeds: [page.embed], components: [] });
    return i.editReply({ content: null, embeds: [page.embed], components: page.components, files: page.files });
  }
}

async function handleModal(i) {
  if (i.customId === 'modal:inscribir') {
    const nombre = i.fields.getTextInputValue('nombre').trim();
    await i.deferReply({ flags: 64 });
    try {
      const club = await economy.registerClub(i.guildId, i.user.id, nombre);
      await i.editReply({ content: '✅ Inscribiste el club **' + club.name + '** con ' + fmtMoney(club.budget) + ' de presupuesto.' });
      await refreshInscripcionPanel(i.client, i.guildId);
    } catch (e) {
      await i.editReply({ content: '❌ ' + e.message });
    }
  }
}

async function handleInteraction(i) {
  try {
    if (i.isButton()) return await handleButton(i);
    if (i.isStringSelectMenu()) return await handleSelect(i);
    if (i.isModalSubmit()) return await handleModal(i);
  } catch (e) {
    await safeError(i, e);
  }
}

module.exports = { handleInteraction };
