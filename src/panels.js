'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { embed, COLOR, fmtMoney, POSITIONS, POSITION_NAMES } = require('./helpers');
const economy = require('./economy');

function inscripcionEmbed(guild, clubs) {
  const e = embed(COLOR.blue, '📋 Inscripción de clubes', 'Pulsa el botón para inscribir tu club. Cada club empieza con ' + fmtMoney(economy.START_BUDGET) + '.');
  e.addFields({ name: 'Cupos', value: clubs.length + ' / ' + guild.max_clubs + ' clubes inscritos' });
  if (clubs.length) {
    e.addFields({
      name: 'Clubes inscritos',
      value: clubs.map((c) => '• **' + c.name + '** — <@' + c.owner_user_id + '>').join('\n').slice(0, 1024),
    });
  }
  if (!guild.inscripcion_open) e.addFields({ name: 'Estado', value: '🔒 Las inscripciones están cerradas por ahora.' });
  return e;
}

function inscripcionComponents(guild, clubs) {
  const full = clubs.length >= guild.max_clubs;
  const btn = new ButtonBuilder()
    .setCustomId('panel:inscribirme')
    .setLabel(full ? 'Cupo completo' : 'Inscribirme')
    .setStyle(ButtonStyle.Success)
    .setDisabled(full || !guild.inscripcion_open);
  return [new ActionRowBuilder().addComponents(btn)];
}

function fichajesEmbed() {
  return embed(
    COLOR.green,
    '🧾 Panel de fichajes',
    'Elige qué quieres hacer:\n\n' +
      '**Fichaje libre** — agentes libres, sin coste.\n' +
      '**Comprar** — jugadores en venta, se descuenta de tu presupuesto.\n' +
      '**Rescindir** — jugadores de tu propio club, vuelven al mercado (sin reembolso).',
  );
}

function fichajesComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:mercado:libre').setLabel('Fichaje libre').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:mercado:comprar').setLabel('Comprar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel:mercado:rescindir').setLabel('Rescindir').setStyle(ButtonStyle.Danger),
  );
  return [row];
}

function positionSelectRow(pool) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('select:posicion:' + pool)
    .setPlaceholder('Elige una posición')
    .addOptions(POSITIONS.map((p) => ({ label: POSITION_NAMES[p] + ' (' + p + ')', value: p })));
  return [new ActionRowBuilder().addComponents(menu)];
}

const POOL_LABELS = { libre: 'Fichaje libre', comprar: 'Comprar', rescindir: 'Rescindir' };
const POOL_TO_DB = { libre: 'free', comprar: 'buy', rescindir: 'own' };
const POOL_ACTION_LABEL = { libre: 'Fichar gratis', comprar: 'Comprar', rescindir: 'Rescindir' };
const POOL_ACTION_STYLE = { libre: ButtonStyle.Success, comprar: ButtonStyle.Success, rescindir: ButtonStyle.Danger };

async function buildMarketPage(guildId, pool, position, clubId, offset) {
  const dbPool = POOL_TO_DB[pool];
  const total = await economy.countMarket(guildId, dbPool, position, clubId);
  if (total === 0) {
    return { empty: true, embed: embed(COLOR.gray, POOL_LABELS[pool] + ' — ' + POSITION_NAMES[position], 'No hay jugadores disponibles en esta categoría ahora mismo.') };
  }
  const safeOffset = Math.max(0, Math.min(offset, total - 1));
  const player = await economy.marketPage(guildId, dbPool, position, clubId, safeOffset);
  const cards = require('./cards');
  const buffer = await cards.renderPlayerCard(player);
  const file = new AttachmentBuilder(buffer, { name: 'carta.png' });

  const e = embed(COLOR.gold, POOL_LABELS[pool] + ' — ' + POSITION_NAMES[position], null)
    .setImage('attachment://carta.png')
    .addFields(
      { name: 'Jugador', value: player.name + (player.is_test_card ? ' *(carta de prueba)*' : ''), inline: true },
      { name: 'Valoración', value: String(player.rating), inline: true },
      { name: 'Precio', value: player.price > 0 ? fmtMoney(player.price) : 'Gratis (agente libre)', inline: true },
    )
    .setFooter({ text: 'Jugador ' + (safeOffset + 1) + ' de ' + total });

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mkt:prev:${pool}:${position}:${safeOffset}`).setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(safeOffset <= 0),
    new ButtonBuilder().setCustomId(`mkt:next:${pool}:${position}:${safeOffset}`).setLabel('Siguiente ▶').setStyle(ButtonStyle.Secondary).setDisabled(safeOffset >= total - 1),
  );
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mkt:action:${pool}:${position}:${safeOffset}:${player.id}`).setLabel(POOL_ACTION_LABEL[pool]).setStyle(POOL_ACTION_STYLE[pool]),
  );
  return { empty: false, embed: e, components: [navRow, actionRow], files: [file] };
}

module.exports = {
  inscripcionEmbed, inscripcionComponents, fichajesEmbed, fichajesComponents,
  positionSelectRow, buildMarketPage, POOL_LABELS, POOL_TO_DB,
};
