'use strict';

const db = require('./db');
const { fmtMoney } = require('./helpers');

const START_BUDGET = 500_000_000;

async function ensureGuild(guildId) {
  await db.query('INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING', [guildId]);
  const { rows } = await db.query('SELECT * FROM guilds WHERE guild_id = $1', [guildId]);
  return rows[0];
}

async function setMaxClubs(guildId, max) {
  await ensureGuild(guildId);
  await db.query('UPDATE guilds SET max_clubs = $2 WHERE guild_id = $1', [guildId, max]);
}

async function setChannel(guildId, kind, channelId) {
  await ensureGuild(guildId);
  const col = { fichajes: 'channel_fichajes', inscripciones: 'channel_inscripciones', partidos: 'channel_partidos', resultados: 'channel_resultados' }[kind];
  if (!col) throw new Error('Tipo de canal no válido: ' + kind);
  await db.query('UPDATE guilds SET ' + col + ' = $2 WHERE guild_id = $1', [guildId, channelId]);
}

async function setInscripcionPanel(guildId, channelId, messageId) {
  await ensureGuild(guildId);
  await db.query('UPDATE guilds SET inscripcion_panel_channel_id = $2, inscripcion_panel_message_id = $3 WHERE guild_id = $1', [guildId, channelId, messageId]);
}

async function getClubByOwner(guildId, userId) {
  const { rows } = await db.query('SELECT * FROM clubs WHERE guild_id = $1 AND owner_user_id = $2', [guildId, userId]);
  return rows[0] || null;
}

async function getClubById(guildId, clubId) {
  const { rows } = await db.query('SELECT * FROM clubs WHERE guild_id = $1 AND id = $2', [guildId, clubId]);
  return rows[0] || null;
}

async function listClubs(guildId) {
  const { rows } = await db.query('SELECT * FROM clubs WHERE guild_id = $1 ORDER BY created_at ASC', [guildId]);
  return rows;
}

/* Registra un club. Lanza un error legible en español ante nombre repetido o segundo club del mismo usuario. */
async function registerClub(guildId, userId, name) {
  const g = await ensureGuild(guildId);
  const current = await listClubs(guildId);
  if (current.length >= g.max_clubs) throw new Error('Ya se alcanzó el máximo de ' + g.max_clubs + ' clubes en este servidor.');
  try {
    const { rows } = await db.query(
      'INSERT INTO clubs (guild_id, owner_user_id, name, budget) VALUES ($1,$2,$3,$4) RETURNING *',
      [guildId, userId, name, START_BUDGET],
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') {
      if (String(e.detail || '').includes('owner_user_id')) throw new Error('Ya tienes un club inscrito en este servidor.');
      throw new Error('Ya hay un club con ese nombre. Elige otro.');
    }
    throw e;
  }
}

function marketWhere(pool, clubId) {
  if (pool === 'free') return { clause: 'owner_club_id IS NULL AND is_free_agent = TRUE', params: [] };
  if (pool === 'buy') return { clause: 'owner_club_id IS NULL AND is_free_agent = FALSE', params: [] };
  if (pool === 'own') return { clause: 'owner_club_id = $3', params: [clubId] };
  throw new Error('Mercado no válido: ' + pool);
}

async function countMarket(guildId, pool, position, clubId) {
  const w = marketWhere(pool, clubId);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM players WHERE guild_id = $1 AND position = $2 AND ${w.clause}`,
    [guildId, position, ...w.params],
  );
  return rows[0].n;
}

async function marketPage(guildId, pool, position, clubId, offset) {
  const w = marketWhere(pool, clubId);
  const { rows } = await db.query(
    `SELECT * FROM players WHERE guild_id = $1 AND position = $2 AND ${w.clause} ORDER BY rating DESC, name ASC LIMIT 1 OFFSET $${3 + w.params.length}`,
    [guildId, position, ...w.params, offset],
  );
  return rows[0] || null;
}

async function getPlayer(guildId, playerId) {
  const { rows } = await db.query('SELECT * FROM players WHERE guild_id = $1 AND id = $2', [guildId, playerId]);
  return rows[0] || null;
}

async function signFreeAgent(guildId, clubId, playerId) {
  const { rows } = await db.query(
    `UPDATE players SET owner_club_id = $3 WHERE guild_id = $1 AND id = $2 AND owner_club_id IS NULL AND is_free_agent = TRUE RETURNING *`,
    [guildId, playerId, clubId],
  );
  if (!rows[0]) return { ok: false, reason: 'Ese jugador ya no está libre.' };
  return { ok: true, player: rows[0] };
}

/* Compra con presupuesto: bloquea la fila del club y la del jugador dentro de una transacción,
   así dos compras a la vez nunca pueden dejar un presupuesto incorrecto ni fichar dos veces al mismo jugador. */
async function buyPlayer(guildId, clubId, playerId) {
  return db.withTransaction(async (client) => {
    const pRes = await client.query('SELECT * FROM players WHERE guild_id = $1 AND id = $2 FOR UPDATE', [guildId, playerId]);
    const player = pRes.rows[0];
    if (!player) return { ok: false, reason: 'Ese jugador ya no existe.' };
    if (player.owner_club_id) return { ok: false, reason: 'Ese jugador ya no está en venta.' };

    const cRes = await client.query('SELECT * FROM clubs WHERE guild_id = $1 AND id = $2 FOR UPDATE', [guildId, clubId]);
    const club = cRes.rows[0];
    if (!club) return { ok: false, reason: 'No encuentro tu club.' };
    if (Number(club.budget) < Number(player.price)) {
      return {
        ok: false,
        reason: 'No te alcanza el presupuesto: tienes ' + fmtMoney(club.budget) + ' y cuesta ' + fmtMoney(player.price) + '. No se descontó nada.',
        budget: club.budget,
        price: player.price,
      };
    }

    await client.query('UPDATE clubs SET budget = budget - $2 WHERE id = $1', [clubId, player.price]);
    await client.query('UPDATE players SET owner_club_id = $2 WHERE id = $1', [playerId, clubId]);
    return { ok: true, player, spent: player.price, remaining: Number(club.budget) - Number(player.price) };
  });
}

async function releasePlayer(guildId, clubId, playerId) {
  const { rows } = await db.query(
    'UPDATE players SET owner_club_id = NULL WHERE guild_id = $1 AND id = $2 AND owner_club_id = $3 RETURNING *',
    [guildId, playerId, clubId],
  );
  if (!rows[0]) return { ok: false, reason: 'Ese jugador no está en tu plantilla.' };
  return { ok: true, player: rows[0] };
}

async function squad(guildId, clubId) {
  const { rows } = await db.query('SELECT * FROM players WHERE guild_id = $1 AND owner_club_id = $2 ORDER BY position ASC, rating DESC', [guildId, clubId]);
  return rows;
}

module.exports = {
  START_BUDGET, ensureGuild, setMaxClubs, setChannel, setInscripcionPanel,
  getClubByOwner, getClubById, listClubs, registerClub,
  countMarket, marketPage, getPlayer, signFreeAgent, buyPlayer, releasePlayer, squad,
};
