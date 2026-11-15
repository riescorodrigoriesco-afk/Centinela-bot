'use strict';

/* Acceso a Postgres. Todo vive bajo el esquema "ultimate_team" para no chocar con otras
   tablas que puedan existir en la misma base de datos (se comparte host con otros proyectos). */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[db] Falta DATABASE_URL en las variables de entorno.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  options: '-c search_path=ultimate_team,public',
});

pool.on('error', (e) => console.error('[db] Error inesperado del pool:', e.message));

async function query(sql, params) {
  return pool.query(sql, params);
}

/* Una transacción = un cliente dedicado durante todo el bloque; evita condiciones de
   carrera reales (dos /comprar a la vez sobre el mismo presupuesto, etc.). */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS ultimate_team;
SET search_path TO ultimate_team, public;

CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  max_clubs INTEGER NOT NULL DEFAULT 20,
  channel_fichajes TEXT,
  channel_inscripciones TEXT,
  channel_partidos TEXT,
  channel_resultados TEXT,
  inscripcion_open BOOLEAN NOT NULL DEFAULT TRUE,
  inscripcion_panel_channel_id TEXT,
  inscripcion_panel_message_id TEXT
);

CREATE TABLE IF NOT EXISTS clubs (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  budget BIGINT NOT NULL DEFAULT 500000000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, owner_user_id),
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  catalog_key TEXT NOT NULL,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL,
  position TEXT NOT NULL,
  pace INTEGER NOT NULL DEFAULT 50,
  shooting INTEGER NOT NULL DEFAULT 50,
  passing INTEGER NOT NULL DEFAULT 50,
  dribbling INTEGER NOT NULL DEFAULT 50,
  defending INTEGER NOT NULL DEFAULT 50,
  physical INTEGER NOT NULL DEFAULT 50,
  image_url TEXT,
  price BIGINT NOT NULL DEFAULT 0,
  is_free_agent BOOLEAN NOT NULL DEFAULT TRUE,
  is_test_card BOOLEAN NOT NULL DEFAULT FALSE,
  owner_club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, catalog_key)
);
CREATE INDEX IF NOT EXISTS idx_players_guild_owner ON players(guild_id, owner_club_id);
CREATE INDEX IF NOT EXISTS idx_players_guild_position ON players(guild_id, position);

CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (guild_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_season_per_guild ON seasons(guild_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS competitions (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('liga', 'ucl', 'uel')),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competition_clubs (
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  PRIMARY KEY (competition_id, club_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  round_label TEXT NOT NULL,
  home_club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
  away_club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
  is_bye BOOLEAN NOT NULL DEFAULT FALSE,
  played BOOLEAN NOT NULL DEFAULT FALSE,
  home_goals INTEGER,
  away_goals INTEGER,
  events JSONB,
  played_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_matches_pending ON matches(season_id, played);

CREATE TABLE IF NOT EXISTS player_stats (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  clean_sheets INTEGER NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, season_id)
);

CREATE TABLE IF NOT EXISTS awards (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  details TEXT
);
`;

async function migrate() {
  await pool.query(SCHEMA_SQL);
  console.log('[db] Esquema listo.');
}

module.exports = { pool, query, withTransaction, migrate };
