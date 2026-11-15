'use strict';

/*
 * Catálogo de jugadores: intenta FUT-DB (si hay FUTDB_API_KEY) y, si falla, devuelve/usa
 * cartas de prueba. No encontré documentación pública de un servicio "FUT-DB" verificable
 * desde aquí, así que este adaptador llama a una forma razonable de API REST (parecida a la
 * de la mayoría de catálogos de cartas) pero está pensado para fallar con elegancia: cualquier
 * respuesta inesperada, error de red o 401 cae automáticamente al catálogo de prueba. Si el
 * dueño del bot tiene la URL/forma real del servicio, hay que ajustar solo `normalizeFutDbPlayer`
 * y la URL de `fetchFromFutDb`.
 */

const db = require('./db');

const BASE_URL = (process.env.FUTDB_BASE_URL || 'https://futdb.app/api').replace(/\/+$/, '');

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function normalizeFutDbPlayer(p) {
  try {
    const rating = Number(p.rating ?? p.overall ?? p.ovr);
    if (!rating) return null;
    const stat = (keys, fallback) => {
      for (const k of keys) if (typeof p[k] === 'number') return clamp(p[k], 1, 99);
      return fallback;
    };
    return {
      catalog_key: 'futdb:' + String(p.id ?? p.resourceId ?? p.slug ?? p.name),
      name: String(p.name ?? p.commonName ?? 'Jugador').slice(0, 80),
      rating: clamp(Math.round(rating), 1, 99),
      position: String(p.position ?? p.position_code ?? 'MC').toUpperCase().slice(0, 4),
      pace: stat(['pace', 'pac'], rating),
      shooting: stat(['shooting', 'sho'], rating),
      passing: stat(['passing', 'pas'], rating),
      dribbling: stat(['dribbling', 'dri'], rating),
      defending: stat(['defending', 'def'], rating),
      physical: stat(['physicality', 'physical', 'phy'], rating),
      image_url: p.image || p.imageUrl || p.card || null,
      price: Math.round(Math.max(0, rating - 60) ** 3 * 50000),
      is_free_agent: rating < 70,
      is_test_card: false,
    };
  } catch (_) {
    return null;
  }
}

async function fetchFromFutDb(limit = 200) {
  const key = process.env.FUTDB_API_KEY;
  if (!key) return { ok: false, reason: 'sin-clave' };
  try {
    const res = await fetch(BASE_URL + '/players?limit=' + limit, {
      headers: { Authorization: 'Bearer ' + key, 'X-API-Key': key },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'clave-invalida' };
    if (!res.ok) return { ok: false, reason: 'http-' + res.status };
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.items || data.players || data.data || [];
    const players = list.map(normalizeFutDbPlayer).filter(Boolean);
    if (!players.length) return { ok: false, reason: 'sin-datos' };
    return { ok: true, players };
  } catch (e) {
    return { ok: false, reason: 'red: ' + e.message };
  }
}

/* 40 cartas de prueba (4 por posición), claramente marcadas, para poder probar todo el flujo
   sin depender de una API externa. Los precios suben de forma no lineal con la valoración,
   como en un mercado real; la franja más baja se deja como agentes libres (precio 0). */
function testCards() {
  const { POSITIONS } = require('./helpers');
  const ratings = [68, 76, 83, 89];
  const out = [];
  for (const pos of POSITIONS) {
    ratings.forEach((rating, idx) => {
      const price = idx === 0 ? 0 : Math.round((rating - 60) ** 3 * 45000);
      out.push({
        catalog_key: 'test:' + pos + ':' + rating,
        name: 'Prueba ' + pos + ' ' + rating,
        rating,
        position: pos,
        pace: clamp(rating + (Math.random() * 10 - 5), 1, 99) | 0,
        shooting: clamp(rating + (Math.random() * 10 - 5), 1, 99) | 0,
        passing: clamp(rating + (Math.random() * 10 - 5), 1, 99) | 0,
        dribbling: clamp(rating + (Math.random() * 10 - 5), 1, 99) | 0,
        defending: clamp(rating + (Math.random() * 10 - 5), 1, 99) | 0,
        physical: clamp(rating + (Math.random() * 10 - 5), 1, 99) | 0,
        image_url: null,
        price,
        is_free_agent: price === 0,
        is_test_card: true,
      });
    });
  }
  return out;
}

/* Guarda/actualiza el catálogo de un servidor. Nunca borra filas ni toca owner_club_id:
   así un jugador ya fichado, o las estadísticas de temporadas pasadas, no se pierden. */
async function syncCatalog(guildId) {
  const live = await fetchFromFutDb();
  const { rows } = await db.query('SELECT count(*)::int AS n FROM players WHERE guild_id = $1 AND is_test_card = FALSE', [guildId]);
  const hasRealData = rows[0].n > 0;
  let players;
  let source;
  if (live.ok) {
    players = live.players;
    source = 'futdb';
  } else if (hasRealData) {
    // Ya había catálogo real antes; un fallo puntual de la API no debe sustituirlo por cartas de prueba.
    return { ok: false, source: 'futdb', reason: live.reason, kept: true };
  } else {
    players = testCards();
    source = 'test';
  }

  await db.withTransaction(async (client) => {
    for (const p of players) {
      await client.query(
        `INSERT INTO players (guild_id, catalog_key, name, rating, position, pace, shooting, passing, dribbling, defending, physical, image_url, price, is_free_agent, is_test_card, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
         ON CONFLICT (guild_id, catalog_key) DO UPDATE SET
           name = EXCLUDED.name, rating = EXCLUDED.rating, position = EXCLUDED.position,
           pace = EXCLUDED.pace, shooting = EXCLUDED.shooting, passing = EXCLUDED.passing,
           dribbling = EXCLUDED.dribbling, defending = EXCLUDED.defending, physical = EXCLUDED.physical,
           image_url = EXCLUDED.image_url, price = EXCLUDED.price, is_free_agent = EXCLUDED.is_free_agent,
           updated_at = now()`,
        [guildId, p.catalog_key, p.name, p.rating, p.position, p.pace, p.shooting, p.passing, p.dribbling, p.defending, p.physical, p.image_url, p.price, p.is_free_agent, p.is_test_card],
      );
    }
  });

  return { ok: true, source, count: players.length };
}

/* Crea una carta de jugador hecha a mano por un administrador (no es FUT-DB ni carta de
   prueba: es contenido propio del servidor). La clave de catálogo lleva un prefijo "custom:"
   único, así nunca puede chocar con las claves que genera syncCatalog ni ser tocada por él. */
async function createCustomCard(guildId, data) {
  const key = 'custom:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8);
  const { rows } = await db.query(
    `INSERT INTO players (guild_id, catalog_key, name, rating, position, pace, shooting, passing, dribbling, defending, physical, image_url, price, is_free_agent, is_test_card)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,FALSE) RETURNING *`,
    [
      guildId, key, data.name, data.rating, data.position,
      data.pace, data.shooting, data.passing, data.dribbling, data.defending, data.physical,
      data.imageUrl || null, data.price, data.price === 0,
    ],
  );
  return rows[0];
}

module.exports = { syncCatalog, fetchFromFutDb, testCards, createCustomCard };
