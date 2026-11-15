'use strict';

const db = require('./db');
const economy = require('./economy');

const MIN_CLUBS = 4;
const COMP_NAMES = { liga: 'Liga', ucl: 'Champions League', uel: 'Europa League' };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Método del círculo: liga de ida y vuelta no, solo una ronda por enfrentamiento (si se quiere
   ida/vuelta se puede duplicar la lista de rondas invirtiendo local/visitante). */
function roundRobinRounds(ids) {
  const arr = [...ids];
  if (arr.length % 2 !== 0) arr.push(null);
  const n = arr.length;
  const rounds = [];
  const work = [...arr];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = work[i];
      const b = work[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    work.splice(1, 0, work.pop());
  }
  return rounds;
}

function knockoutFirstRound(ids) {
  const list = shuffle(ids);
  const byes = [];
  const pairs = [];
  if (list.length % 2 !== 0) byes.push(list.pop());
  for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  return { pairs, byes };
}

async function getActiveSeason(guildId) {
  const { rows } = await db.query("SELECT * FROM seasons WHERE guild_id = $1 AND status = 'active'", [guildId]);
  return rows[0] || null;
}

async function startSeason(guildId) {
  const clubs = await economy.listClubs(guildId);
  if (clubs.length < MIN_CLUBS) {
    return { ok: false, reason: 'Hacen falta al menos ' + MIN_CLUBS + ' clubes inscritos para iniciar una temporada (ahora mismo hay ' + clubs.length + ').' };
  }
  const active = await getActiveSeason(guildId);
  if (active) return { ok: false, reason: 'Ya hay una temporada en curso (la número ' + active.number + '). Fínalizala antes de empezar otra.' };

  const { rows: numRows } = await db.query('SELECT coalesce(max(number),0)::int AS n FROM seasons WHERE guild_id = $1', [guildId]);
  const number = numRows[0].n + 1;

  return db.withTransaction(async (client) => {
    const season = (await client.query('INSERT INTO seasons (guild_id, number) VALUES ($1,$2) RETURNING *', [guildId, number])).rows[0];

    const allIds = clubs.map((c) => c.id);
    const shuffled = shuffle(allIds);
    const half = Math.ceil(shuffled.length / 2);
    const uclClubs = shuffled.slice(0, half);
    const uelClubs = shuffled.slice(half);

    const liga = (await client.query('INSERT INTO competitions (season_id, type, name) VALUES ($1,$2,$3) RETURNING *', [season.id, 'liga', COMP_NAMES.liga])).rows[0];
    for (const id of allIds) await client.query('INSERT INTO competition_clubs (competition_id, club_id) VALUES ($1,$2)', [liga.id, id]);
    const ligaRounds = roundRobinRounds(allIds);
    for (let r = 0; r < ligaRounds.length; r++) {
      for (const [home, away] of ligaRounds[r]) {
        await client.query(
          'INSERT INTO matches (competition_id, season_id, round_number, round_label, home_club_id, away_club_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [liga.id, season.id, r + 1, 'Jornada ' + (r + 1), home, away],
        );
      }
    }

    for (const [type, idsForComp] of [['ucl', uclClubs], ['uel', uelClubs]]) {
      if (idsForComp.length < 2) continue; // no hay suficientes para esa copa esta temporada
      const comp = (await client.query('INSERT INTO competitions (season_id, type, name) VALUES ($1,$2,$3) RETURNING *', [season.id, type, COMP_NAMES[type]])).rows[0];
      for (const id of idsForComp) await client.query('INSERT INTO competition_clubs (competition_id, club_id) VALUES ($1,$2)', [comp.id, id]);
      const { pairs, byes } = knockoutFirstRound(idsForComp);
      for (const [home, away] of pairs) {
        await client.query(
          'INSERT INTO matches (competition_id, season_id, round_number, round_label, home_club_id, away_club_id) VALUES ($1,$2,1,$3,$4,$5)',
          [comp.id, season.id, 'Ronda 1', home, away],
        );
      }
      for (const club of byes) {
        await client.query(
          'INSERT INTO matches (competition_id, season_id, round_number, round_label, home_club_id, away_club_id, is_bye, played, played_at) VALUES ($1,$2,1,$3,$4,NULL,TRUE,TRUE,now())',
          [comp.id, season.id, 'Ronda 1', club],
        );
      }
    }

    return { ok: true, season, uclCount: uclClubs.length, uelCount: uelClubs.length };
  });
}

async function nextPendingMatch(guildId, seasonId, clubId) {
  const { rows } = await db.query(
    `SELECT m.*, c.type AS comp_type, c.name AS comp_name FROM matches m
     JOIN competitions c ON c.id = m.competition_id
     WHERE m.season_id = $1 AND m.is_bye = FALSE AND m.played = FALSE
       AND (m.home_club_id = $2 OR m.away_club_id = $2)
     ORDER BY c.type ASC, m.round_number ASC, m.id ASC LIMIT 1`,
    [seasonId, clubId],
  );
  return rows[0] || null;
}

function weightedPick(list, weightFn) {
  const weights = list.map(weightFn).map((w) => Math.max(0.01, w));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

function squadStrength(squad) {
  if (!squad.length) return 55;
  return squad.reduce((a, p) => a + p.rating, 0) / squad.length;
}

function simulateGoals(squad, strength, oppStrength) {
  const diff = strength - oppStrength;
  const lambda = Math.max(0.15, Math.min(5, 1.35 + diff / 22));
  // Aproximación tipo Poisson con tiradas Bernoulli (sin librerías externas).
  const trials = 90;
  const p = lambda / trials;
  let goals = 0;
  const minutes = [];
  for (let m = 1; m <= trials; m++) {
    if (Math.random() < p) { goals++; minutes.push(m); }
  }
  const attackers = squad.filter((pl) => ['DC', 'MCO', 'MD', 'MI', 'MC'].includes(pl.position));
  const pool = attackers.length ? attackers : squad;
  const events = minutes.map((minute) => {
    if (!pool.length) return { minute, scorer: 'Jugador del equipo', assist: null };
    const scorer = weightedPick(pool, (pl) => pl.rating);
    const assistCandidates = pool.filter((pl) => pl.id !== scorer.id);
    const assist = assistCandidates.length && Math.random() < 0.65 ? weightedPick(assistCandidates, (pl) => pl.rating) : null;
    return { minute, scorer: scorer.name, scorerId: scorer.id, assist: assist ? assist.name : null, assistId: assist ? assist.id : null };
  });
  return { goals, events };
}

async function playMatch(guildId, matchId, userClubId) {
  const { rows } = await db.query('SELECT m.*, c.type AS comp_type FROM matches m JOIN competitions c ON c.id = m.competition_id WHERE m.id = $1', [matchId]);
  const match = rows[0];
  if (!match) return { ok: false, reason: 'No encuentro ese partido.' };
  if (match.played) return { ok: false, reason: 'Ese partido ya se jugó.' };
  if (match.home_club_id !== userClubId && match.away_club_id !== userClubId) return { ok: false, reason: 'Ese partido no es tuyo.' };

  const homeSquad = await economy.squad(guildId, match.home_club_id);
  const awaySquad = await economy.squad(guildId, match.away_club_id);
  const homeStrength = squadStrength(homeSquad);
  const awayStrength = squadStrength(awaySquad);

  let home = simulateGoals(homeSquad, homeStrength, awayStrength);
  let away = simulateGoals(awaySquad, awayStrength, homeStrength);

  // En eliminatoria no puede quedar empate: si el marcador empata se decide en penaltis, pero
  // eso NO se cuenta como un gol más (para que las estadísticas de jugadores sigan cuadrando
  // exactamente con el marcador del partido). El ganador de los penaltis se guarda aparte.
  const isKnockout = match.comp_type === 'ucl' || match.comp_type === 'uel';
  let penalties = false;
  let penaltyWinner = null;
  if (isKnockout && home.goals === away.goals) {
    penalties = true;
    penaltyWinner = Math.random() < 0.5 ? 'home' : 'away';
  }

  await db.withTransaction(async (client) => {
    await client.query(
      'UPDATE matches SET played = TRUE, home_goals = $2, away_goals = $3, events = $4, played_at = now() WHERE id = $1',
      [matchId, home.goals, away.goals, JSON.stringify({ home: home.events, away: away.events, penalties, penaltyWinner })],
    );
    for (const [events] of [[home.events], [away.events]]) {
      for (const ev of events) {
        if (!ev.scorerId) continue;
        await client.query(
          `INSERT INTO player_stats (player_id, season_id, goals, matches_played) VALUES ($1,$2,1,0)
           ON CONFLICT (player_id, season_id) DO UPDATE SET goals = player_stats.goals + 1`,
          [ev.scorerId, match.season_id],
        );
        if (ev.assistId) {
          await client.query(
            `INSERT INTO player_stats (player_id, season_id, assists, matches_played) VALUES ($1,$2,1,0)
             ON CONFLICT (player_id, season_id) DO UPDATE SET assists = player_stats.assists + 1`,
            [ev.assistId, match.season_id],
          );
        }
      }
    }
    for (const [squad] of [[homeSquad], [awaySquad]]) {
      for (const pl of squad) {
        await client.query(
          `INSERT INTO player_stats (player_id, season_id, matches_played) VALUES ($1,$2,1)
           ON CONFLICT (player_id, season_id) DO UPDATE SET matches_played = player_stats.matches_played + 1`,
          [pl.id, match.season_id],
        );
      }
    }
  });

  if (isKnockout) await advanceKnockoutIfRoundDone(match.competition_id, match.round_number);

  return { ok: true, match, home, away, penalties, isKnockout };
}

async function advanceKnockoutIfRoundDone(competitionId, roundNumber) {
  const { rows: pending } = await db.query(
    'SELECT count(*)::int AS n FROM matches WHERE competition_id = $1 AND round_number = $2 AND played = FALSE',
    [competitionId, roundNumber],
  );
  if (pending[0].n > 0) return; // aún quedan partidos de esta ronda

  const { rows: roundMatches } = await db.query(
    'SELECT * FROM matches WHERE competition_id = $1 AND round_number = $2 ORDER BY id ASC',
    [competitionId, roundNumber],
  );
  const winners = roundMatches.map((m) => {
    if (m.is_bye) return m.home_club_id || m.away_club_id;
    if (m.home_goals !== m.away_goals) return m.home_goals > m.away_goals ? m.home_club_id : m.away_club_id;
    // Empate en eliminatoria: el ganador quedó guardado en los penaltis, no en el marcador.
    // (la columna es JSONB: pg ya la entrega como objeto, nunca como texto para volver a parsear)
    const ev = m.events;
    if (ev && ev.penaltyWinner === 'away') return m.away_club_id;
    return m.home_club_id;
  });
  if (winners.length <= 1) return; // ya hay campeón, no se genera más

  const season = (await db.query('SELECT season_id FROM competitions WHERE id = $1', [competitionId])).rows[0];
  const nextRound = roundNumber + 1;
  const shuffled = winners; // el orden de emparejamiento ya viene del bracket, no hace falta volver a mezclar
  const byes = [];
  const pairs = [];
  const list = [...shuffled];
  if (list.length % 2 !== 0) byes.push(list.pop());
  for (let i = 0; i < list.length; i += 2) pairs.push([list[i], list[i + 1]]);

  const label = pairs.length === 1 ? 'Final' : pairs.length === 2 ? 'Semifinal' : pairs.length === 4 ? 'Cuartos de final' : 'Ronda ' + nextRound;
  for (const [home, away] of pairs) {
    await db.query(
      'INSERT INTO matches (competition_id, season_id, round_number, round_label, home_club_id, away_club_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [competitionId, season.season_id, nextRound, label, home, away],
    );
  }
  for (const club of byes) {
    await db.query(
      'INSERT INTO matches (competition_id, season_id, round_number, round_label, home_club_id, away_club_id, is_bye, played, played_at) VALUES ($1,$2,$3,$4,$5,NULL,TRUE,TRUE,now())',
      [competitionId, season.season_id, nextRound, label, club],
    );
  }
}

async function standings(seasonId, compType) {
  const { rows: comp } = await db.query('SELECT * FROM competitions WHERE season_id = $1 AND type = $2', [seasonId, compType]);
  if (!comp[0]) return null;
  const { rows: clubs } = await db.query(
    `SELECT cl.id, cl.name FROM competition_clubs cc JOIN clubs cl ON cl.id = cc.club_id WHERE cc.competition_id = $1`,
    [comp[0].id],
  );
  const table = Object.fromEntries(clubs.map((c) => [c.id, { id: c.id, name: c.name, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 }]));
  const { rows: matches } = await db.query('SELECT * FROM matches WHERE competition_id = $1 AND played = TRUE AND is_bye = FALSE', [comp[0].id]);
  for (const m of matches) {
    const h = table[m.home_club_id];
    const a = table[m.away_club_id];
    if (!h || !a) continue;
    h.pj++; a.pj++;
    h.gf += m.home_goals; h.gc += m.away_goals;
    a.gf += m.away_goals; a.gc += m.home_goals;
    if (m.home_goals > m.away_goals) { h.g++; a.p++; h.pts += 3; }
    else if (m.home_goals < m.away_goals) { a.g++; h.p++; a.pts += 3; }
    else { h.e++; a.e++; h.pts++; a.pts++; }
  }
  const list = Object.values(table).sort((x, y) => y.pts - x.pts || (y.gf - y.gc) - (x.gf - x.gc) || y.gf - x.gf);
  return { competition: comp[0], table: list };
}

async function seasonAwards(seasonId) {
  const q = (sql) => db.query(sql, [seasonId]).then((r) => r.rows[0] || null);
  const topScorer = await q(`SELECT p.*, ps.goals FROM player_stats ps JOIN players p ON p.id = ps.player_id WHERE ps.season_id = $1 ORDER BY ps.goals DESC LIMIT 1`);
  const ballonDor = await q(
    `SELECT p.*, ps.goals, ps.assists FROM player_stats ps JOIN players p ON p.id = ps.player_id WHERE ps.season_id = $1
     ORDER BY (ps.goals * 2 + ps.assists + p.rating / 10.0) DESC LIMIT 1`,
  );
  const bestKeeper = await q(
    `SELECT p.*, ps.matches_played FROM player_stats ps JOIN players p ON p.id = ps.player_id WHERE ps.season_id = $1 AND p.position = 'POR'
     ORDER BY p.rating DESC, ps.matches_played DESC LIMIT 1`,
  );
  const bestClub = await db.query(
    `SELECT cl.*, SUM(CASE WHEN (m.home_club_id = cl.id AND m.home_goals > m.away_goals) OR (m.away_club_id = cl.id AND m.away_goals > m.home_goals) THEN 3
                           WHEN m.played AND m.home_goals = m.away_goals THEN 1 ELSE 0 END)::int AS pts
     FROM clubs cl LEFT JOIN matches m ON (m.home_club_id = cl.id OR m.away_club_id = cl.id) AND m.season_id = $1 AND m.played = TRUE AND m.is_bye = FALSE
     WHERE cl.guild_id = (SELECT guild_id FROM seasons WHERE id = $1)
     GROUP BY cl.id ORDER BY pts DESC LIMIT 1`,
    [seasonId],
  ).then((r) => r.rows[0] || null);

  return {
    balon_de_oro: ballonDor,
    bota_de_oro: topScorer,
    guante_de_oro: bestKeeper,
    club_del_ano: bestClub,
  };
}

const AWARD_IS_CLUB = { balon_de_oro: false, bota_de_oro: false, guante_de_oro: false, club_del_ano: true };
const AWARD_LABELS = { balon_de_oro: 'Balón de Oro', bota_de_oro: 'Bota de Oro', guante_de_oro: 'Guante de Oro', club_del_ano: 'Club del Año' };

async function finishSeason(guildId) {
  const season = await getActiveSeason(guildId);
  if (!season) return { ok: false, reason: 'No hay ninguna temporada en curso.' };
  const awards = await seasonAwards(season.id);
  await db.withTransaction(async (client) => {
    await client.query("UPDATE seasons SET status = 'finished', finished_at = now() WHERE id = $1", [season.id]);
    for (const [category, row] of Object.entries(awards)) {
      if (!row) continue;
      const isClub = AWARD_IS_CLUB[category];
      await client.query(
        'INSERT INTO awards (season_id, category, club_id, player_id, details) VALUES ($1,$2,$3,$4,$5)',
        [season.id, category, isClub ? row.id : null, isClub ? null : row.id, JSON.stringify(row)],
      );
    }
  });
  return { ok: true, season, awards };
}

async function lastFinishedSeason(guildId) {
  const { rows } = await db.query("SELECT * FROM seasons WHERE guild_id = $1 AND status = 'finished' ORDER BY number DESC LIMIT 1", [guildId]);
  return rows[0] || null;
}

module.exports = {
  MIN_CLUBS, getActiveSeason, startSeason, nextPendingMatch, playMatch, standings,
  seasonAwards, finishSeason, lastFinishedSeason, AWARD_LABELS,
};
