'use strict';

/*
 * templates_deportes.js — Plantillas de deportes y ligas (fútbol, boxeo, MMA, NBA, NFL, F1, tenis…).
 *
 * Mismo formato que templates.js, pero se generan con unas pocas funciones a partir de listas de equipos, categorías de peso, etc.
 * Los equipos se convierten en roles por botones (con su color) y en un canal por equipo.
 * Regla de oro: máximo 25 roles elegibles (límite de botones y menús de Discord).
 */

const SEP = '│';
const t = (name, topic, o) => ({ k: 'text', name, topic, ...o });
const v = (name, o) => ({ k: 'voice', name, ...o });
const TALK_BOTS = t('🤖' + SEP + 'comandos', 'Comandos de bots y minijuegos de Centinela', { sp: 'bots' });
const ENG = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'; // bandera de Inglaterra
const FOUNDER = { name: 'Fundador', color: 0xf5b800, hoist: true, founder: true };

/* ============================ utilidades ============================ */
// Círculo de color más parecido al color del equipo (para el rol y el canal)
const DOTS = [['🔴', [220, 40, 40]], ['🟠', [240, 140, 30]], ['🟡', [245, 205, 40]], ['🟢', [40, 160, 70]], ['🔵', [40, 90, 200]], ['🟣', [130, 60, 180]], ['🟤', [120, 75, 45]], ['⚫', [30, 30, 30]], ['⚪', [235, 235, 235]]];
function dot(c) {
  const rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  let best = DOTS[0][0];
  let bd = Infinity;
  for (const [e, p] of DOTS) {
    const d = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// Nombre de canal limpio: minúsculas, sin espacios ni signos raros (se conservan las tildes)
const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const PAL = [0xe74c3c, 0xe67e22, 0xf1c40f, 0x2ecc71, 0x1abc9c, 0x3498db, 0x9b59b6, 0xe91e63, 0x95a5a6, 0x00b894];
const pal = (names) => names.map((n, i) => [n, PAL[i % PAL.length]]);

const hub = ([ico, name, topic, opt]) => t(ico + SEP + name, topic, opt);

const rulesFan = (extra) => [
  'Respeta a todos los aficionados: la rivalidad es buena, los insultos no.',
  'Nada de racismo, xenofobia ni insultos discriminatorios.',
  'Sin spam, publicidad de casas de apuestas ni enlaces a retransmisiones piratas.',
  extra || 'Los spoilers de resultados van en su canal o marcados.',
  'Haz caso al equipo; si algo falla, abre un ticket.',
];
const TICKETS = ['Ayuda', 'Reporte', 'Sugerencia', 'Otro'];

/*
 * make(o): crea una plantilla.
 *  o.teams     [[nombre, color, emoji?]] → roles elegibles + un canal por equipo (si teamCat)
 *  o.chanTeams lista para los canales si es distinta a la de roles
 *  o.pre/post  roles elegibles extra ([nombre, color]) antes/después de los equipos
 *  o.hub       canales principales [emoji, nombre, tema, opciones]
 *  o.cats      categorías extra [nombre, [canales]]
 *  o.voice     canales de voz [nombre, opciones]
 */
function make(o) {
  const team = (o.teams || []).map(([n, c, e]) => ({ n, c, e: e || dot(c) }));
  const chanTeams = (o.chanTeams || o.teams || []).map(([n, c, e]) => ({ n, c, e: e || dot(c) }));
  const selfRoles = [...(o.pre || []), ...team.map((x) => [x.e + ' ' + x.n, x.c]), ...(o.post || [])];
  const cats = [{ name: o.hubName, ch: [...o.hub.map(hub), TALK_BOTS] }];
  if (o.teamCat && chanTeams.length) cats.push({ name: o.teamCat, ch: chanTeams.map((x) => t(x.e + SEP + slug(x.n), (o.teamTopic || 'Afición de ') + x.n)) });
  for (const [name, list] of o.cats || []) cats.push({ name, ch: list.map(hub) });
  cats.push({ name: '🔊 VOZ', ch: (o.voice || [['🔊 Charla'], ['💤 AFK']]).map(([nm, opt]) => v(nm, opt)) });
  return {
    ico: o.ico, n: o.n, d: o.d, levels: o.levels !== false,
    roles: o.roles || [FOUNDER, ...(o.staff || [])],
    selfRoles, rules: o.rules || rulesFan(o.rule5), ticketCats: o.ticketCats || TICKETS, cats,
  };
}

/* ============================ ligas de fútbol ============================ */
const REF = { name: 'Árbitro', color: 0x2d3436, hoist: true };
const PRESS = { name: 'Periodista', color: 0x00cec9 };

function league(o) {
  return make({
    ico: o.ico, n: o.n, d: o.d || ('Servidor de la ' + o.short + ': un rol y un canal por equipo, jornada, fichajes, tácticas, quiniela y voz para ver los partidos.'),
    staff: [REF, PRESS], teams: o.teams, teamCat: '🏟️ ' + o.teamWord, teamTopic: 'Afición de ',
    hubName: o.ico + ' ' + o.short.toUpperCase(),
    hub: [
      ['💬', 'general', 'Charla sobre ' + o.short],
      ['📅', 'jornada', 'Partidos de la jornada y resultados en vivo'],
      ['📊', 'clasificación', 'La tabla, los goleadores y las estadísticas'],
      ['🔁', 'fichajes', 'Mercado de fichajes y rumores'],
      ['🧠', 'tácticas', 'Análisis táctico y alineaciones'],
      ['😂', 'memes', 'Memes y humor futbolero'],
      ['🔥', 'debates', 'Debates con respeto: ¿quién es mejor?'],
    ],
    cats: [['🎯 JUEGOS', [
      ['🎯', 'quiniela', 'Pronostica los resultados de la jornada'],
      ['🃏', 'fantasy', 'La liga fantasy de la comunidad'],
      ['🏆', 'porra-del-campeón', 'Quién ganará la liga'],
      ['❓', 'trivia', 'Preguntas y retos de fútbol'],
    ]]],
    voice: [['📺 Partido en directo'], ['🏟️ Tribuna local'], ['🏟️ Tribuna visitante'], ['🎙️ Tertulia'], ['💤 AFK']],
    ticketCats: ['Ayuda', 'Reporte', 'Quiniela / Fantasy', 'Otro'],
  });
}

const FOOTBALL = {
  laliga: league({
    ico: '🇪🇸', n: 'LaLiga (España)', short: 'LaLiga', teamWord: 'EQUIPOS',
    teams: [['FC Barcelona', 0xa50044], ['Real Madrid', 0xe8e8e8], ['Atlético de Madrid', 0xcb3524], ['Alavés', 0x0761af], ['Getafe', 0x005999], ['Sevilla', 0xd71920], ['Rayo Vallecano', 0xe53027], ['Villarreal', 0xfbe122], ['Espanyol', 0x007fc8], ['Levante', 0xb4053f], ['Celta de Vigo', 0x8ac3ee], ['Osasuna', 0xd91a21], ['Elche', 0x0b8f3b], ['Real Betis', 0x0bb363], ['Athletic Club', 0xee2523], ['Valencia', 0xf28c28], ['Real Sociedad', 0x0067b1], ['Deportivo de La Coruña', 0x0a4ea2], ['Racing de Santander', 0x00a651], ['Málaga', 0x1e90e0]],
  }),
  premier: league({
    ico: '🦁', n: 'Premier League (Inglaterra)', short: 'Premier League', teamWord: 'CLUBES',
    teams: [['Arsenal', 0xef0107], ['Aston Villa', 0x670e36], ['Bournemouth', 0xda291c], ['Brentford', 0xe30613], ['Brighton', 0x0057b8], ['Chelsea', 0x034694], ['Coventry City', 0x59c2f0], ['Crystal Palace', 0x1b458f], ['Everton', 0x003399], ['Fulham', 0xeeeeee], ['Hull City', 0xf5a11c], ['Ipswich Town', 0x3a64a3], ['Leeds United', 0xf2f2f2], ['Liverpool', 0xc8102e], ['Manchester City', 0x6cabdd], ['Manchester United', 0xda291c], ['Newcastle United', 0x2b2b2b], ['Nottingham Forest', 0xdd0000], ['Sunderland', 0xeb172b], ['Tottenham', 0x132257]],
  }),
  seriea: league({
    ico: '🇮🇹', n: 'Serie A (Italia)', short: 'Serie A', teamWord: 'SQUADRE',
    teams: [['Atalanta', 0x1e71b8], ['Bologna', 0x9b1b30], ['Cagliari', 0xa01b2a], ['Como', 0x1d4ea0], ['Fiorentina', 0x5b2a86], ['Frosinone', 0xf4d03f], ['Genoa', 0xa3162b], ['Inter', 0x0e4b99], ['Juventus', 0x1c1c1c], ['Lazio', 0x87d8f7], ['Lecce', 0xf6c200], ['Milan', 0xfb090b], ['Monza', 0xd1252d], ['Napoli', 0x12a0d7], ['Parma', 0xf8d210], ['Roma', 0x970a2c], ['Sassuolo', 0x00a650], ['Torino', 0x8b1d2b], ['Udinese', 0x2b2b2b], ['Venezia', 0x0f6b3e]],
  }),
  bundesliga: league({
    ico: '🇩🇪', n: 'Bundesliga (Alemania)', short: 'Bundesliga', teamWord: 'VEREINE',
    teams: [['Bayern Múnich', 0xdc052d], ['Borussia Dortmund', 0xfde100], ['RB Leipzig', 0xdd0741], ['Bayer Leverkusen', 0xe32221], ['Borussia Mönchengladbach', 0x00a650], ['Eintracht Fráncfort', 0xe1000f], ['Augsburgo', 0xba3733], ['Colonia', 0xed1c24], ['Maguncia 05', 0xc3141e], ['Hamburgo', 0x0a3a8c], ['Friburgo', 0xd4001c], ['Paderborn', 0x1a56db], ['Schalke 04', 0x004d9d], ['Elversberg', 0x2b2b2b], ['Hoffenheim', 0x1961b5], ['Unión Berlín', 0xeb1923], ['Stuttgart', 0xe32219], ['Werder Bremen', 0x1d9053]],
  }),
  ligue1: league({
    ico: '🇫🇷', n: 'Ligue 1 (Francia)', short: 'Ligue 1', teamWord: 'CLUBS',
    teams: [['Mónaco', 0xe30613], ['Lyon', 0x1b3e8f], ['Paris FC', 0x213a8f], ['Lille', 0xe01e13], ['Rennes', 0xe2001a], ['Brest', 0xd9232d], ['Estrasburgo', 0x0089cf], ['Lorient', 0xf47920], ['Troyes', 0x0b6eb5], ['Marsella', 0x2faee0], ['Lens', 0xfcd116], ['Angers', 0x2b2b2b], ['París Saint-Germain', 0x004170], ['Le Mans', 0xf6c500], ['Niza', 0xc8102e], ['Le Havre', 0x0e7ad1], ['Toulouse', 0x4b2c82], ['Auxerre', 0x0057b8]],
  }),
  ligamx: league({
    ico: '🇲🇽', n: 'Liga MX (México)', short: 'Liga MX', teamWord: 'EQUIPOS',
    teams: [['América', 0xffcc00], ['Chivas', 0xce1126], ['Cruz Azul', 0x0033a0], ['Pumas', 0xdca911], ['Tigres', 0xf5a800], ['Rayados', 0x002b5c], ['Toluca', 0xd3202f], ['Santos Laguna', 0x00a651], ['León', 0x00873e], ['Pachuca', 0x1b2f6e], ['Atlas', 0xc8102e], ['Necaxa', 0xd4202a], ['Querétaro', 0x1d4aa6], ['Xolos', 0xb71c1c], ['Puebla', 0x1b55b5], ['FC Juárez', 0x2d8f3c], ['Atlético San Luis', 0xd91f26], ['Mazatlán', 0x6f2c91]],
  }),
  argentina: league({
    ico: '🇦🇷', n: 'Liga Profesional (Argentina)', short: 'Liga Argentina', teamWord: 'CLUBES',
    teams: [['Boca Juniors', 0x103f91], ['River Plate', 0xe3141c], ['Racing Club', 0x74acdf], ['Independiente', 0xd5121b], ['San Lorenzo', 0x1b2a6b], ['Estudiantes', 0xd4202a], ['Vélez Sarsfield', 0x1d3f8f], ['Lanús', 0x8d1b2e], ['Talleres', 0x1a3f8f], ['Rosario Central', 0xf2c200], ['Newell\'s Old Boys', 0xc8102e], ['Argentinos Juniors', 0xd2232a], ['Huracán', 0xeeeeee], ['Belgrano', 0x4aa3df], ['Gimnasia La Plata', 0x2b4a9b], ['Banfield', 0x1b8a3a], ['Godoy Cruz', 0x1a3f8f], ['Tigre', 0x1b4fa5], ['Platense', 0x6e3a1c], ['Unión de Santa Fe', 0xd4202a], ['Instituto', 0xd4202a], ['Defensa y Justicia', 0xd9d200], ['Central Córdoba', 0x2b2b2b], ['Sarmiento', 0x1b8a3a], ['Barracas Central', 0xc8102e]],
  }),
  brasil: league({
    ico: '🇧🇷', n: 'Brasileirão (Brasil)', short: 'Brasileirão', teamWord: 'TIMES',
    teams: [['Flamengo', 0xc8102e], ['Palmeiras', 0x006437], ['Corinthians', 0x2b2b2b], ['São Paulo', 0xd4202a], ['Santos', 0xeeeeee], ['Grêmio', 0x0d80bf], ['Internacional', 0xe5050f], ['Fluminense', 0x7a1f3d], ['Botafogo', 0x2b2b2b], ['Vasco da Gama', 0x1c1c1c], ['Atlético Mineiro', 0x2b2b2b], ['Cruzeiro', 0x1b4fa5], ['Bahia', 0x1b4fa5], ['Fortaleza', 0x0a3d91], ['Athletico Paranaense', 0xd4202a], ['Red Bull Bragantino', 0xe30613], ['Vitória', 0xd4202a], ['Sport Recife', 0xd4202a], ['Ceará', 0x2b2b2b], ['Juventude', 0x1b8a3a]],
  }),
  portugal: league({
    ico: '🇵🇹', n: 'Primeira Liga (Portugal)', short: 'Liga Portugal', teamWord: 'CLUBES',
    teams: [['Benfica', 0xe30613], ['Oporto', 0x003c8f], ['Sporting CP', 0x008a4b], ['Braga', 0xd4202a], ['Vitória de Guimarães', 0xeeeeee], ['Famalicão', 0x1b4fa5], ['Gil Vicente', 0xd4202a], ['Estoril', 0xf2c200], ['Moreirense', 0x1b8a3a], ['Arouca', 0xf2c200], ['Casa Pia', 0x2b2b2b], ['Rio Ave', 0x1b8a3a], ['Santa Clara', 0xd4202a], ['Nacional', 0x2b2b2b], ['Estrela da Amadora', 0xd4202a], ['AVS', 0x1b4fa5], ['Farense', 0x2b2b2b], ['Boavista', 0x2b2b2b]],
  }),
  eredivisie: league({
    ico: '🇳🇱', n: 'Eredivisie (Países Bajos)', short: 'Eredivisie', teamWord: 'CLUBS',
    teams: [['Ajax', 0xd2122e], ['PSV', 0xe30613], ['Feyenoord', 0xe30613], ['AZ Alkmaar', 0xd2122e], ['Twente', 0xd2122e], ['Utrecht', 0xd2122e], ['Heerenveen', 0x0a62b5], ['Go Ahead Eagles', 0xf2c200], ['Sparta Rotterdam', 0xd2122e], ['NEC Nijmegen', 0x1b8a3a], ['Fortuna Sittard', 0xf2c200], ['Heracles', 0x2b2b2b], ['PEC Zwolle', 0x1b4fa5], ['Groningen', 0x1b8a3a], ['Willem II', 0xd2122e], ['Excelsior', 0xd2122e], ['NAC Breda', 0xf2c200], ['Telstar', 0xeeeeee]],
  }),
  saudi: league({
    ico: '🇸🇦', n: 'Saudi Pro League (Arabia Saudí)', short: 'Saudi Pro League', teamWord: 'CLUBES',
    teams: [['Al-Hilal', 0x1b4fa5], ['Al-Nassr', 0xf2c200], ['Al-Ittihad', 0xf2c200], ['Al-Ahli', 0x1b8a3a], ['Al-Shabab', 0xeeeeee], ['Al-Ettifaq', 0x1b8a3a], ['Al-Fateh', 0x1b8a3a], ['Al-Taawoun', 0xd4202a], ['Al-Fayha', 0x1b8a3a], ['Al-Khaleej', 0xd4202a], ['Damac', 0xd4202a], ['Al-Raed', 0xd4202a], ['Al-Okhdood', 0xd4202a], ['Al-Riyadh', 0x1b4fa5], ['Al-Kholood', 0xd4202a], ['Al-Najma', 0x1b8a3a], ['Neom', 0x1b4fa5], ['Al-Qadsiah', 0xf2c200]],
  }),
  mls: league({
    ico: '🇺🇸', n: 'MLS (EE. UU. y Canadá)', short: 'MLS', teamWord: 'CLUBS',
    teams: [['Inter Miami', 0xf7b5cd], ['LA Galaxy', 0x00245d], ['LAFC', 0x2b2b2b], ['Seattle Sounders', 0x5d9732], ['Atlanta United', 0x80000a], ['New York City FC', 0x6cabdd], ['New York Red Bulls', 0xe30613], ['Columbus Crew', 0xfedd00], ['Portland Timbers', 0x00482b], ['Austin FC', 0x00b140], ['FC Cincinnati', 0xf05323], ['Philadelphia Union', 0x071b2c], ['Toronto FC', 0xb81137], ['CF Montréal', 0x2b2b2b], ['Vancouver Whitecaps', 0x00245e], ['Sporting Kansas City', 0x93b1d7], ['Real Salt Lake', 0xb30838], ['Houston Dynamo', 0xff6b00], ['FC Dallas', 0xbf0d3e], ['Nashville SC', 0xece83a], ['Chicago Fire', 0xff0000], ['Orlando City', 0x633492], ['Minnesota United', 0x8cd2f4], ['San Diego FC', 0x9ecfe5], ['DC United', 0x2b2b2b]],
  }),
};

// Champions League: los grandes de Europa
FOOTBALL.champions = make({
  ico: '🏆', n: 'Champions League / Europa', d: 'Servidor de las competiciones europeas: un rol y canal por gran club, una sala por fase, quiniela y voz para ver los partidos.',
  staff: [REF, PRESS], teamCat: '🏟️ CLUBES DE EUROPA', teamTopic: 'Afición de ',
  teams: [['Real Madrid', 0xe8e8e8], ['FC Barcelona', 0xa50044], ['Bayern Múnich', 0xdc052d], ['Manchester City', 0x6cabdd], ['Liverpool', 0xc8102e], ['París Saint-Germain', 0x004170], ['Inter', 0x0e4b99], ['Milan', 0xfb090b], ['Juventus', 0x1c1c1c], ['Borussia Dortmund', 0xfde100], ['Atlético de Madrid', 0xcb3524], ['Arsenal', 0xef0107], ['Chelsea', 0x034694], ['Manchester United', 0xda291c], ['Napoli', 0x12a0d7], ['Benfica', 0xe30613], ['Oporto', 0x003c8f], ['Ajax', 0xd2122e], ['Bayer Leverkusen', 0xe32221], ['Tottenham', 0x132257], ['Atalanta', 0x1e71b8], ['Sporting CP', 0x008a4b], ['Roma', 0x970a2c], ['RB Leipzig', 0xdd0741]],
  hubName: '🏆 COMPETICIONES',
  hub: [
    ['💬', 'general', 'Charla sobre las competiciones europeas'],
    ['🏆', 'champions-league', 'Champions League: partidos y debate'],
    ['🟠', 'europa-league', 'Europa League'],
    ['🟢', 'conference-league', 'Conference League'],
    ['🌍', 'supercopa-y-mundial-de-clubes', 'Supercopa de Europa y Mundial de Clubes'],
    ['🔁', 'fichajes', 'Mercado de fichajes y rumores'],
    ['🧠', 'tácticas', 'Análisis táctico'],
    ['😂', 'memes', 'Memes y humor futbolero'],
  ],
  cats: [
    ['📅 FASES', [['🧮', 'fase-de-liga', 'Clasificación y partidos de la fase de liga'], ['⚔️', 'playoffs', 'Eliminatorias de acceso'], ['🎯', 'octavos', 'Octavos de final'], ['🔥', 'cuartos', 'Cuartos de final'], ['⭐', 'semifinales', 'Semifinales'], ['🏆', 'final', 'La gran final']]],
    ['🎯 JUEGOS', [['🎯', 'quiniela', 'Pronostica los resultados'], ['🃏', 'fantasy', 'Fantasy de la Champions'], ['❓', 'trivia', 'Preguntas y retos']]],
  ],
  voice: [['📺 Partido en directo'], ['🏟️ Tribuna 1'], ['🏟️ Tribuna 2'], ['🎙️ Tertulia'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Quiniela / Fantasy', 'Otro'],
});

// Selecciones y Mundial
FOOTBALL.selecciones = make({
  ico: '🌍', n: 'Selecciones y Mundial', d: 'Mundial, Eurocopa, Copa América y selecciones: un rol con bandera y un canal por país.',
  staff: [REF, PRESS], teamCat: '🌎 SELECCIONES', teamTopic: 'Afición de ',
  teams: [['España', 0xc60b1e, '🇪🇸'], ['Argentina', 0x74acdf, '🇦🇷'], ['Brasil', 0x009c3b, '🇧🇷'], ['Francia', 0x0055a4, '🇫🇷'], ['Inglaterra', 0xcf081f, ENG], ['Alemania', 0x2b2b2b, '🇩🇪'], ['Portugal', 0x006600, '🇵🇹'], ['México', 0x006847, '🇲🇽'], ['Países Bajos', 0xf36c21, '🇳🇱'], ['Italia', 0x0066b3, '🇮🇹'], ['Uruguay', 0x5eb6e4, '🇺🇾'], ['Colombia', 0xfcd116, '🇨🇴'], ['Marruecos', 0xc1272d, '🇲🇦'], ['Estados Unidos', 0x3c3b6e, '🇺🇸'], ['Japón', 0xbc002d, '🇯🇵'], ['Croacia', 0xff0000, '🇭🇷'], ['Bélgica', 0xed2939, '🇧🇪'], ['Chile', 0xd52b1e, '🇨🇱'], ['Perú', 0xd91023, '🇵🇪'], ['Ecuador', 0xffd100, '🇪🇨'], ['Venezuela', 0x7b1e3a, '🇻🇪'], ['Senegal', 0x00853f, '🇸🇳'], ['Corea del Sur', 0xcd2e3a, '🇰🇷'], ['Canadá', 0xff0000, '🇨🇦']],
  hubName: '🌍 MUNDIAL',
  hub: [
    ['💬', 'general', 'Charla sobre selecciones'],
    ['🏆', 'mundial', 'La Copa del Mundo'],
    ['🇪🇺', 'eurocopa', 'La Eurocopa'],
    ['🌎', 'copa-américa', 'La Copa América'],
    ['🌍', 'copa-africana-y-asiática', 'Copa Africana y Copa Asiática'],
    ['🧮', 'clasificatorias', 'Eliminatorias y clasificación'],
    ['🧠', 'tácticas', 'Análisis táctico'],
    ['😂', 'memes', 'Memes y humor futbolero'],
  ],
  cats: [['🎯 JUEGOS', [['🎯', 'quiniela', 'Pronostica los partidos'], ['🃏', 'fantasy', 'Fantasy del torneo'], ['❓', 'trivia', 'Preguntas de historia de los Mundiales']]]],
  voice: [['📺 Partido en directo'], ['🏟️ Tribuna 1'], ['🏟️ Tribuna 2'], ['🎙️ Tertulia'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Quiniela / Fantasy', 'Otro'],
});

// Fútbol general: todas las ligas en un sitio
FOOTBALL.futbol = make({
  ico: '⚽', n: 'Fútbol (todas las ligas)', d: 'Un servidor para todo el fútbol: un canal por liga, fichajes, tácticas, EA FC, fantasy y quiniela.',
  staff: [REF, PRESS],
  pre: [['⚽ Delantero', 0xe74c3c], ['🎯 Mediocentro', 0xf1c40f], ['🛡️ Defensa', 0x3498db], ['🧤 Portero', 0x2ecc71], ['🏟️ Aficionado de estadio', 0xe67e22], ['📊 Analista', 0x9b59b6], ['🎮 EA FC', 0x1abc9c], ['🃏 Fantasy', 0xe91e63], ['🔔 Partidos en directo', 0xf39c12], ['📣 Fichajes y rumores', 0x00b894], ['👩 Fútbol femenino', 0xff7675], ['🇪🇸 LaLiga', 0xd71920], ['🦁 Premier League', 0x3d195b], ['🇮🇹 Serie A', 0x008c45], ['🇩🇪 Bundesliga', 0xdc052d], ['🇫🇷 Ligue 1', 0x0055a4], ['🇲🇽 Liga MX', 0x006847], ['🇦🇷 Liga Argentina', 0x74acdf], ['🇧🇷 Brasileirão', 0x009c3b], ['🏆 Champions League', 0x1b4fa5], ['🌍 Selecciones', 0xf5b800]],
  hubName: '⚽ FÚTBOL',
  hub: [
    ['💬', 'general', 'Charla de fútbol'],
    ['📅', 'partidos-de-hoy', 'Los partidos de hoy y resultados en vivo'],
    ['🔁', 'fichajes', 'Mercado de fichajes y rumores'],
    ['🧠', 'tácticas', 'Análisis táctico'],
    ['⭐', 'jugadores', 'Los mejores jugadores: debate y vídeos'],
    ['👩', 'fútbol-femenino', 'Fútbol femenino'],
    ['📜', 'historia', 'Leyendas e historia del fútbol'],
    ['😂', 'memes', 'Memes y humor futbolero'],
    ['🔥', 'debates', 'Debates con respeto'],
  ],
  cats: [
    ['🌍 LIGAS', [['🇪🇸', 'laliga', 'LaLiga'], ['🦁', 'premier-league', 'Premier League'], ['🇮🇹', 'serie-a', 'Serie A'], ['🇩🇪', 'bundesliga', 'Bundesliga'], ['🇫🇷', 'ligue-1', 'Ligue 1'], ['🇲🇽', 'liga-mx', 'Liga MX'], ['🇦🇷', 'liga-argentina', 'Liga Profesional Argentina'], ['🇧🇷', 'brasileirão', 'Brasileirão'], ['🇵🇹', 'liga-portugal', 'Primeira Liga'], ['🇳🇱', 'eredivisie', 'Eredivisie'], ['🏆', 'champions-league', 'Champions League'], ['🌍', 'mundial-y-selecciones', 'Mundial y selecciones']]],
    ['🎯 JUEGOS', [['🎯', 'quiniela', 'Pronostica los resultados'], ['🃏', 'fantasy', 'Liga fantasy'], ['🎮', 'ea-fc', 'Charla y partidos de EA FC'], ['❓', 'trivia', 'Preguntas y retos de fútbol']]],
  ],
  voice: [['📺 Partido en directo'], ['🎙️ Tertulia'], ['🎮 EA FC'], ['🔊 Sala 1'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Quiniela / Fantasy', 'Otro'],
});

// Liga o torneo propio
FOOTBALL.torneo = make({
  ico: '🏅', n: 'Mi liga / torneo de fútbol', d: 'Organiza tu propia liga o torneo: inscripciones, reglamento, calendario, resultados, sanciones y un canal por equipo.',
  staff: [{ name: 'Organizador', color: 0xe17055, hoist: true }, REF, { name: 'Capitán', color: 0x00b894, hoist: true }, { name: 'Entrenador', color: 0x0984e3 }],
  pre: [['⚽ Delantero', 0xe74c3c], ['🎯 Mediocentro', 0xf1c40f], ['🛡️ Defensa', 0x3498db], ['🧤 Portero', 0x2ecc71], ['🔎 Busco equipo', 0xe67e22], ['🔔 Avisos de partidos', 0x9b59b6], ['📸 Cronista', 0x1abc9c]],
  hubName: '🏅 TORNEO',
  hub: [
    ['📝', 'inscripciones', 'Apunta a tu equipo al torneo'],
    ['📜', 'reglamento', 'Reglamento y formato del torneo', { ro: true }],
    ['📅', 'calendario', 'Partidos y horarios', { ro: true }],
    ['⚽', 'resultados', 'Resultados de cada jornada'],
    ['🏆', 'clasificación', 'Tabla de posiciones', { ro: true }],
    ['🚨', 'sanciones', 'Tarjetas y sanciones', { ro: true }],
    ['🔁', 'fichajes', 'Fichajes entre equipos'],
    ['🔎', 'busco-equipo', 'Jugadores sin equipo'],
    ['📸', 'crónicas', 'Crónicas y fotos de los partidos'],
    ['💬', 'general', 'Charla general'],
  ],
  cats: [['🏟️ EQUIPOS', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ['⚽', 'equipo-' + n, 'Canal del equipo ' + n])]],
  voice: [['🏟️ Vestuario local', { limit: 15 }], ['🏟️ Vestuario visitante', { limit: 15 }], ['🧑‍⚖️ Sala de árbitros'], ['📺 Tribuna'], ['💤 AFK']],
  ticketCats: ['Inscripción', 'Reclamación', 'Árbitros', 'Otro'],
  rule5: 'El reglamento del torneo es de obligado cumplimiento; las reclamaciones, por ticket.',
});

// EA FC
FOOTBALL.eafc = make({
  ico: '🎮', n: 'EA FC / FIFA', d: 'Comunidad de EA FC: Ultimate Team, Clubes Pro, mercado, SBC, torneos y salas de voz.',
  pre: [['🎮 PlayStation', 0x2980b9], ['🟩 Xbox', 0x27ae60], ['🖥️ PC', 0x7f8c8d], ['🃏 Ultimate Team', 0xf1c40f], ['🏆 FUT Champions', 0xe67e22], ['🤝 Clubes Pro', 0x1abc9c], ['🎯 Modo Carrera', 0x3498db], ['🏟️ Volta', 0x9b59b6], ['⚔️ Competitivo', 0xe74c3c], ['💰 Mercado', 0x2ecc71], ['🔔 Avisos de SBC y eventos', 0xf39c12]],
  hubName: '🎮 EA FC',
  hub: [
    ['💬', 'general', 'Charla general de EA FC'],
    ['🃏', 'ultimate-team', 'Ultimate Team: plantillas y consejos'],
    ['💰', 'mercado', 'Trading y consejos de mercado'],
    ['🎁', 'sobres', 'Enseña tus sobres'],
    ['🧩', 'sbc', 'Retos de creación de plantillas'],
    ['🤝', 'clubes-pro', 'Clubes Pro: busca equipo'],
    ['🎯', 'modo-carrera', 'Modo Carrera'],
    ['🎬', 'golazos', 'Tus mejores goles y jugadas'],
    ['🏆', 'torneos', 'Torneos de la comunidad'],
    ['🔎', 'buscar-partida', 'Encuentra con quién jugar'],
  ],
  voice: [['🎧 Lobby'], ['🤝 Dúo', { limit: 2 }], ['🏟️ Clubes Pro', { limit: 11 }], ['🏆 Torneo'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte de jugador', 'Torneos', 'Otro'],
});

/* ============================ otros deportes ============================ */
const COMBAT_VOICE = [['🥊 Pelea en vivo'], ['🔴 Esquina roja'], ['🔵 Esquina azul'], ['🏋️ Gimnasio'], ['💤 AFK']];
const SPORTS = {};

SPORTS.boxeo = make({
  ico: '🥊', n: 'Boxeo', d: 'Servidor de boxeo: carteleras, resultados, rankings, un rol por categoría de peso, federaciones y gimnasio.',
  staff: [{ name: 'Promotor', color: 0xe17055, hoist: true }, { name: 'Campeón', color: 0xf1c40f, hoist: true }, { name: 'Entrenador', color: 0x0984e3, hoist: true }, { name: 'Árbitro', color: 0x2d3436 }],
  pre: pal(['⚖️ Peso Minimosca', '⚖️ Peso Mosca', '⚖️ Peso Supermosca', '⚖️ Peso Gallo', '⚖️ Peso Supergallo', '⚖️ Peso Pluma', '⚖️ Peso Superpluma', '⚖️ Peso Ligero', '⚖️ Peso Superligero', '⚖️ Peso Welter', '⚖️ Peso Superwelter', '⚖️ Peso Medio', '⚖️ Peso Supermedio', '⚖️ Peso Semipesado', '⚖️ Peso Crucero', '⚖️ Peso Pesado']),
  post: [['🥊 Boxeador', 0xe74c3c], ['👀 Aficionado', 0x95a5a6], ['🧑‍🏫 Entrenador', 0x0984e3], ['🔔 Avisos de peleas', 0xf39c12], ['👩 Boxeo femenino', 0xe91e63]],
  hubName: '🥊 BOXEO',
  hub: [
    ['💬', 'general', 'Charla de boxeo'],
    ['📅', 'cartelera', 'Próximas peleas y veladas'],
    ['🥇', 'resultados', 'Resultados de las peleas'],
    ['📊', 'rankings', 'Rankings y libra por libra'],
    ['🧠', 'análisis', 'Análisis técnico y táctico'],
    ['🔮', 'predicciones', 'Quién gana: pronósticos'],
    ['🎬', 'clips', 'Los mejores KO y rounds'],
    ['📜', 'leyendas', 'Historia y leyendas del boxeo'],
    ['👩', 'boxeo-femenino', 'Boxeo femenino'],
    ['😂', 'memes', 'Memes de boxeo'],
  ],
  cats: [
    ['🏆 FEDERACIONES', [['🟢', 'wbc', 'Consejo Mundial de Boxeo'], ['🔵', 'wba', 'Asociación Mundial de Boxeo'], ['🔴', 'ibf', 'Federación Internacional de Boxeo'], ['🟠', 'wbo', 'Organización Mundial de Boxeo'], ['💍', 'the-ring', 'Los cinturones de The Ring'], ['🥉', 'amateur-y-olímpico', 'Boxeo amateur y olímpico']]],
    ['🏋️ GIMNASIO', [['🏋️', 'entrenamiento', 'Rutinas y entrenamiento'], ['🧠', 'técnica', 'Técnica, guardia y juego de pies'], ['🥗', 'peso-y-dieta', 'Hacer peso y alimentación'], ['🤝', 'busco-sparring', 'Encuentra compañeros de sparring']]],
  ],
  voice: COMBAT_VOICE,
  ticketCats: ['Ayuda', 'Reporte', 'Organizar un evento', 'Otro'],
  rule5: 'Aquí se comentan las peleas del deporte: nada de promover la violencia fuera del ring.',
});

SPORTS.mma = make({
  ico: '🥋', n: 'MMA / UFC', d: 'Servidor de artes marciales mixtas: UFC, PFL, ONE, categorías de peso, disciplinas, predicciones y técnica.',
  staff: [{ name: 'Promotor', color: 0xe17055, hoist: true }, { name: 'Campeón', color: 0xf1c40f, hoist: true }, { name: 'Entrenador', color: 0x0984e3, hoist: true }],
  pre: pal(['⚖️ Peso Mosca', '⚖️ Peso Gallo', '⚖️ Peso Pluma', '⚖️ Peso Ligero', '⚖️ Peso Welter', '⚖️ Peso Medio', '⚖️ Peso Semipesado', '⚖️ Peso Pesado', '👩 Peso Paja', '👩 Peso Mosca fem.', '🥋 Jiu-jitsu brasileño', '🥊 Boxeo', '🦵 Muay Thai', '🤼 Lucha olímpica', '🥋 Judo', '🥷 Kickboxing']),
  post: [['👀 Aficionado', 0x95a5a6], ['🥊 Peleador', 0xe74c3c], ['🔔 Avisos de cartelera', 0xf39c12], ['🔮 Pronosticador', 0x9b59b6]],
  hubName: '🥋 MMA',
  hub: [
    ['💬', 'general', 'Charla de MMA'],
    ['📅', 'cartelera', 'Próximos eventos: UFC, PFL, ONE y más'],
    ['🥇', 'resultados', 'Resultados de los combates'],
    ['📊', 'rankings', 'Rankings por categoría'],
    ['🔮', 'predicciones', 'Quién gana: pronósticos'],
    ['🧠', 'análisis', 'Análisis de peleadores y peleas'],
    ['🎬', 'clips', 'Los mejores finales y momentos'],
    ['📜', 'historia', 'Leyendas e historia del MMA'],
    ['😂', 'memes', 'Memes de MMA'],
  ],
  cats: [
    ['🏆 ORGANIZACIONES', [['🔴', 'ufc', 'UFC'], ['🟡', 'pfl', 'PFL'], ['🟠', 'one-championship', 'ONE Championship'], ['🟣', 'bellator-y-otras', 'Bellator y otras organizaciones'], ['🌎', 'mma-en-español', 'MMA hispano y latinoamericano']]],
    ['🏋️ GIMNASIO', [['🏋️', 'entrenamiento', 'Rutinas y preparación física'], ['🥋', 'técnica', 'Técnica de pie y suelo'], ['🥗', 'corte-de-peso', 'Hacer peso con cabeza'], ['🤝', 'busco-sparring', 'Encuentra compañeros de entrenamiento']]],
  ],
  voice: COMBAT_VOICE,
  ticketCats: ['Ayuda', 'Reporte', 'Organizar un evento', 'Otro'],
  rule5: 'Aquí se comentan los combates del deporte: nada de promover la violencia fuera del octágono.',
});

SPORTS.lucha = make({
  ico: '🤼', n: 'Lucha libre / Wrestling', d: 'WWE, AEW, lucha libre mexicana y japonesa: carteleras, resultados, fantasy booking y un rol por marca.',
  staff: [{ name: 'Booker', color: 0xe17055, hoist: true }, { name: 'Campeón', color: 0xf1c40f, hoist: true }],
  pre: [['🔴 WWE Raw', 0xe74c3c], ['🔵 WWE SmackDown', 0x3498db], ['🟡 WWE NXT', 0xf1c40f], ['⚫ AEW', 0x2c3e50], ['🟠 TNA', 0xe67e22], ['🎭 Lucha Libre AAA', 0x9b59b6], ['🎭 CMLL', 0xe91e63], ['🇯🇵 NJPW', 0x1abc9c], ['😇 Face', 0x2ecc71], ['😈 Heel', 0xc0392b], ['🔔 Avisos de eventos', 0xf39c12], ['📝 Fantasy booker', 0x8e44ad]],
  hubName: '🤼 LUCHA',
  hub: [
    ['💬', 'general', 'Charla de lucha libre'],
    ['📅', 'cartelera', 'Próximos shows y premium live events'],
    ['🥇', 'resultados', 'Resultados de los shows'],
    ['🗞️', 'rumores', 'Noticias y rumores'],
    ['📝', 'fantasy-booking', 'Tu propia cartelera ideal'],
    ['🔮', 'predicciones', 'Pronostica los combates'],
    ['🎬', 'momentos', 'Los mejores momentos y promos'],
    ['📜', 'historia', 'Leyendas e historia de la lucha'],
    ['😂', 'memes', 'Memes de lucha libre'],
  ],
  cats: [['🏆 PROMOCIONES', [['🔴', 'wwe', 'WWE'], ['⚫', 'aew', 'AEW'], ['🎭', 'lucha-libre-mexicana', 'AAA, CMLL y la lucha mexicana'], ['🇯🇵', 'puroresu', 'Lucha japonesa'], ['🌍', 'independientes', 'Lucha independiente']]]],
  voice: [['📺 Show en directo'], ['🎙️ Charla'], ['🔔 Ringside'], ['💤 AFK']],
  rule5: 'Los spoilers de los shows grabados van en su canal.',
});

const NBA = [['Lakers', 0x552583], ['Celtics', 0x007a33], ['Warriors', 0x1d428a], ['Bulls', 0xce1141], ['Heat', 0x98002e], ['Knicks', 0xf58426], ['Nets', 0x2b2b2b], ['Spurs', 0xc4ced4], ['Mavericks', 0x00538c], ['Suns', 0xe56020], ['Bucks', 0x00471b], ['76ers', 0x006bb6], ['Nuggets', 0xfec524], ['Clippers', 0xc8102e], ['Rockets', 0xce1141], ['Thunder', 0x007ac1], ['Cavaliers', 0x860038], ['Raptors', 0xce1141], ['Grizzlies', 0x5d76a9], ['Timberwolves', 0x236192], ['Pacers', 0xfdbb30], ['Hawks', 0xe03a3e], ['Kings', 0x5a2d81], ['Magic', 0x0077c0]];
SPORTS.nba = make({
  ico: '🏀', n: 'NBA', d: 'Servidor de la NBA: un rol y un canal por equipo, partidos de hoy, draft, traspasos, fantasy y voz.',
  staff: [REF, PRESS], teams: NBA, post: [['🏀 Otro equipo', 0x95a5a6]], teamCat: '🏟️ EQUIPOS', teamTopic: 'Afición de los ',
  hubName: '🏀 NBA',
  hub: [
    ['💬', 'general', 'Charla de la NBA'],
    ['📅', 'partidos-de-hoy', 'Partidos de hoy y resultados'],
    ['📊', 'clasificación', 'Clasificación del Este y del Oeste'],
    ['🔁', 'traspasos', 'Traspasos y rumores'],
    ['🎓', 'draft', 'Draft y novatos'],
    ['⭐', 'mvp-y-premios', 'MVP, premios y All-Star'],
    ['🧠', 'análisis', 'Análisis y estadísticas'],
    ['🎬', 'highlights', 'Mates, triples y mejores jugadas'],
    ['😂', 'memes', 'Memes de baloncesto'],
  ],
  cats: [['🎯 JUEGOS', [['🎯', 'quiniela', 'Pronostica los partidos'], ['🃏', 'fantasy', 'Liga fantasy de la NBA'], ['🏆', 'playoffs', 'Los playoffs'], ['❓', 'trivia', 'Preguntas y retos']]]],
  voice: [['📺 Partido en directo'], ['🏟️ Pabellón local'], ['🏟️ Pabellón visitante'], ['🎙️ Tertulia'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Quiniela / Fantasy', 'Otro'],
});

SPORTS.baloncesto = make({
  ico: '⛹️', n: 'Baloncesto (general)', d: 'Todo el baloncesto: NBA, Euroliga, ACB, FIBA, WNBA, NCAA y de barrio, con roles por competición y posición.',
  staff: [REF, PRESS],
  pre: [['🏀 NBA', 0xe74c3c], ['🇪🇺 Euroliga', 0xe67e22], ['🇪🇸 Liga ACB', 0xd71920], ['🌍 FIBA y selecciones', 0x3498db], ['👩 WNBA y femenino', 0xe91e63], ['🎓 NCAA', 0x2ecc71], ['🏙️ Baloncesto de barrio', 0x9b59b6], ['⛹️ Base', 0xf1c40f], ['🎯 Escolta', 0x1abc9c], ['🦅 Alero', 0x00b894], ['💪 Ala-pívot', 0x0984e3], ['🗼 Pívot', 0x6c5ce7], ['🏀 Jugador', 0xe17055], ['🔔 Partidos en directo', 0xf39c12]],
  hubName: '⛹️ BALONCESTO',
  hub: [
    ['💬', 'general', 'Charla de baloncesto'],
    ['📅', 'partidos-de-hoy', 'Partidos de hoy y resultados'],
    ['🔁', 'fichajes', 'Fichajes y rumores'],
    ['🧠', 'análisis', 'Análisis y estadísticas'],
    ['🎬', 'highlights', 'Las mejores jugadas'],
    ['😂', 'memes', 'Memes de baloncesto'],
  ],
  cats: [
    ['🏆 COMPETICIONES', [['🏀', 'nba', 'NBA'], ['🇪🇺', 'euroliga', 'Euroliga y Eurocup'], ['🇪🇸', 'liga-acb', 'Liga Endesa'], ['🌍', 'fiba-y-selecciones', 'Mundial, Eurobasket y Juegos Olímpicos'], ['👩', 'wnba-y-femenino', 'WNBA y baloncesto femenino'], ['🎓', 'ncaa', 'NCAA y March Madness']]],
    ['🏙️ A JUGAR', [['🔎', 'buscar-partido', 'Encuentra con quién jugar'], ['🧠', 'entrenamiento', 'Técnica y entrenamiento'], ['👟', 'zapatillas', 'Zapatillas y equipación'], ['🎯', 'quiniela', 'Pronósticos']]],
  ],
  voice: [['📺 Partido en directo'], ['🎙️ Tertulia'], ['🏀 Sala 1'], ['💤 AFK']],
});

const NFL_DIV = [['AFC Este', 0xc8102e], ['AFC Norte', 0xe67e22], ['AFC Sur', 0x1b4fa5], ['AFC Oeste', 0xf1c40f], ['NFC Este', 0x34495e], ['NFC Norte', 0x2ecc71], ['NFC Sur', 0x9b59b6], ['NFC Oeste', 0x1abc9c]];
const NFL_TEAMS = [['Bills', 0x00338d], ['Dolphins', 0x008e97], ['Patriots', 0x002244], ['Jets', 0x125740], ['Ravens', 0x241773], ['Bengals', 0xfb4f14], ['Browns', 0x311d00], ['Steelers', 0xffb612], ['Texans', 0x03202f], ['Colts', 0x002c5f], ['Jaguars', 0x006778], ['Titans', 0x4b92db], ['Broncos', 0xfb4f14], ['Chiefs', 0xe31837], ['Raiders', 0x2b2b2b], ['Chargers', 0x0080c6], ['Cowboys', 0x003594], ['Giants', 0x0b2265], ['Eagles', 0x004c54], ['Commanders', 0x5a1414], ['Bears', 0x0b162a], ['Lions', 0x0076b6], ['Packers', 0x203731], ['Vikings', 0x4f2683], ['Falcons', 0xa71930], ['Panthers', 0x0085ca], ['Saints', 0xd3bc8d], ['Buccaneers', 0xd50a0a], ['Cardinals', 0x97233f], ['Rams', 0x003594], ['49ers', 0xaa0000], ['Seahawks', 0x002244]];
SPORTS.nfl = make({
  ico: '🏈', n: 'NFL / Fútbol americano', d: 'Servidor de la NFL: roles por división, un canal por cada uno de los 32 equipos, draft, fantasy y Super Bowl.',
  staff: [REF, PRESS],
  pre: [...NFL_DIV.map(([n, c]) => ['🏈 ' + n, c]), ['🧢 Quarterback', 0xf39c12], ['🏃 Corredor', 0xe74c3c], ['🙌 Receptor', 0x3498db], ['🛡️ Defensa', 0x2ecc71], ['🃏 Fantasy', 0xe91e63], ['🔔 Partidos en directo', 0x9b59b6]],
  chanTeams: NFL_TEAMS, teamCat: '🏟️ EQUIPOS', teamTopic: 'Afición de los ',
  hubName: '🏈 NFL',
  hub: [
    ['💬', 'general', 'Charla de la NFL'],
    ['📅', 'partidos-de-la-semana', 'Los partidos de la semana y resultados'],
    ['📊', 'clasificación', 'Clasificación por divisiones'],
    ['🔁', 'traspasos', 'Traspasos y rumores'],
    ['🎓', 'draft', 'El draft y los novatos'],
    ['🧠', 'análisis', 'Estrategia y análisis de jugadas'],
    ['🎬', 'highlights', 'Touchdowns y mejores jugadas'],
    ['😂', 'memes', 'Memes de la NFL'],
  ],
  cats: [['🎯 JUEGOS', [['🃏', 'fantasy', 'Liga fantasy de la NFL'], ['🎯', 'quiniela', 'Pronostica los partidos'], ['🏆', 'playoffs-y-super-bowl', 'Playoffs y Super Bowl'], ['🎓', 'college-football', 'Fútbol americano universitario']]]],
  voice: [['📺 Partido en directo'], ['🏟️ Estadio local'], ['🏟️ Estadio visitante'], ['🎙️ Tertulia'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Fantasy', 'Otro'],
});

SPORTS.mlb = make({
  ico: '⚾', n: 'Béisbol (MLB)', d: 'Servidor de béisbol: un rol y canal por equipo de las Grandes Ligas, resultados, traspasos, fantasy y Serie Mundial.',
  staff: [REF, PRESS],
  teams: [['Yankees', 0x0c2340], ['Dodgers', 0x005a9c], ['Red Sox', 0xbd3039], ['Cubs', 0x0e3386], ['Cardinals', 0xc41e3a], ['Giants', 0xfd5a1e], ['Braves', 0xce1141], ['Astros', 0xeb6e1f], ['Mets', 0xff5910], ['Phillies', 0xe81828], ['Padres', 0x8c6a3d], ['Blue Jays', 0x134a8e], ['Mariners', 0x005c5c], ['Rangers', 0x003278], ['Orioles', 0xdf4601], ['Guardians', 0xe31937], ['Tigers', 0x0c2340], ['Twins', 0x002b5c], ['Brewers', 0x12284b], ['Diamondbacks', 0xa71930], ['Rays', 0x092c5c], ['Angels', 0xba0021], ['White Sox', 0x2b2b2b], ['Reds', 0xc6011f], ['Royals', 0x004687]],
  teamCat: '🏟️ EQUIPOS', teamTopic: 'Afición de los ',
  hubName: '⚾ BÉISBOL',
  hub: [
    ['💬', 'general', 'Charla de béisbol'],
    ['📅', 'juegos-de-hoy', 'Los juegos de hoy y resultados'],
    ['📊', 'posiciones', 'Posiciones por división'],
    ['🔁', 'traspasos', 'Traspasos y rumores'],
    ['⭐', 'jonrones-y-estadísticas', 'Jonrones, promedios y récords'],
    ['🌎', 'béisbol-latino', 'Liga mexicana, caribeña y Serie del Caribe'],
    ['🎬', 'highlights', 'Las mejores jugadas'],
    ['😂', 'memes', 'Memes de béisbol'],
  ],
  cats: [['🎯 JUEGOS', [['🃏', 'fantasy', 'Liga fantasy de béisbol'], ['🎯', 'quiniela', 'Pronostica los juegos'], ['🏆', 'serie-mundial', 'Playoffs y Serie Mundial']]]],
  voice: [['📺 Juego en directo'], ['🏟️ Estadio local'], ['🏟️ Estadio visitante'], ['🎙️ Tertulia'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Fantasy', 'Otro'],
});

SPORTS.f1 = make({
  ico: '🏎️', n: 'Fórmula 1', d: 'Servidor de F1: un rol y canal por escudería, Gran Premio del fin de semana, estrategia, simracing y fantasy.',
  staff: [{ name: 'Comisario', color: 0x2d3436, hoist: true }, PRESS],
  teams: [['Mercedes', 0x27f4d2], ['Ferrari', 0xe8002d], ['Red Bull Racing', 0x3671c6], ['McLaren', 0xff8000], ['Aston Martin', 0x229971], ['Alpine', 0x0093cc], ['Williams', 0x64c4ff], ['Racing Bulls', 0x6692ff], ['Audi', 0xb6001e], ['Haas', 0xb6babd], ['Cadillac', 0x2b2b2b]],
  post: [['🏁 Simracer', 0x9b59b6], ['🔔 Avisos de carrera', 0xf39c12], ['🃏 Fantasy F1', 0xe91e63], ['📻 Estratega', 0x1abc9c]],
  teamCat: '🏁 ESCUDERÍAS', teamTopic: 'Afición de ',
  hubName: '🏎️ FÓRMULA 1',
  hub: [
    ['💬', 'general', 'Charla de Fórmula 1'],
    ['🏁', 'gran-premio', 'El Gran Premio de este fin de semana'],
    ['⏱️', 'clasificación-y-parrilla', 'Qualy, parrilla y resultados'],
    ['🏆', 'campeonato', 'Campeonato de pilotos y constructores'],
    ['🔧', 'técnica', 'Aerodinámica, motores y reglamento'],
    ['📻', 'estrategia', 'Estrategia, neumáticos y paradas'],
    ['🔁', 'mercado-de-pilotos', 'Fichajes y rumores del paddock'],
    ['🎬', 'onboards-y-clips', 'Adelantamientos y mejores momentos'],
    ['😂', 'memes', 'Memes de F1'],
  ],
  cats: [['🎮 SIMRACING', [['🏁', 'simracing', 'F1 25, iRacing, Assetto Corsa y más'], ['🔧', 'setups', 'Reglajes del coche'], ['🏆', 'ligas-online', 'Ligas y carreras de la comunidad'], ['🃏', 'fantasy', 'Fantasy de F1'], ['🎯', 'quiniela', 'Pronostica el podio']]]],
  voice: [['📺 Carrera en directo'], ['🏁 Parrilla de salida'], ['🔧 Boxes'], ['🎮 Simracing'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Liga de simracing', 'Otro'],
});

SPORTS.motogp = make({
  ico: '🏍️', n: 'MotoGP / Motociclismo', d: 'Servidor de MotoGP: roles por marca, Gran Premio, Moto2, Moto3, superbikes, rally y rutas en moto.',
  staff: [{ name: 'Comisario', color: 0x2d3436, hoist: true }, PRESS],
  pre: [['🔴 Ducati', 0xe8002d], ['🟣 Aprilia', 0x7d2d8f], ['🟠 KTM', 0xff6600], ['🔵 Yamaha', 0x1b4fa5], ['⚪ Honda', 0xdddddd], ['🏍️ Moto2', 0x3498db], ['🏍️ Moto3', 0x2ecc71], ['🏁 Superbikes', 0xe67e22], ['🛣️ Motero de calle', 0x95a5a6], ['🏜️ Rally y Dakar', 0xf1c40f], ['🏁 Simracer', 0x9b59b6], ['🔔 Avisos de carrera', 0xf39c12], ['🃏 Fantasy', 0xe91e63]],
  hubName: '🏍️ MOTOGP',
  hub: [
    ['💬', 'general', 'Charla de motos'],
    ['🏁', 'gran-premio', 'El Gran Premio del fin de semana'],
    ['⏱️', 'clasificación-y-parrilla', 'Qualy, parrilla y resultados'],
    ['🏆', 'campeonato', 'Campeonato de pilotos y equipos'],
    ['🔧', 'técnica', 'Mecánica y reglamento'],
    ['🔁', 'fichajes', 'Mercado de pilotos y rumores'],
    ['🎬', 'clips', 'Adelantamientos y mejores momentos'],
    ['😂', 'memes', 'Memes de motos'],
  ],
  cats: [['🛣️ MOTEROS', [['🛣️', 'rutas', 'Rutas y quedadas'], ['🔧', 'mecánica', 'Mantenimiento y consejos'], ['🛒', 'compra-venta', 'Motos y equipación'], ['📸', 'fotos', 'Fotos de tu moto'], ['🎯', 'quiniela', 'Pronostica el podio']]]],
  voice: [['📺 Carrera en directo'], ['🛣️ En ruta'], ['🔧 Garaje'], ['💤 AFK']],
});

SPORTS.tenis = make({
  ico: '🎾', n: 'Tenis', d: 'Servidor de tenis: Grand Slams, ATP y WTA, rankings, técnica, material y jugadores para entrenar juntos.',
  staff: [REF, PRESS],
  pre: [['🎾 ATP', 0x3498db], ['🎾 WTA', 0xe91e63], ['🟠 Tierra batida', 0xe67e22], ['🟢 Hierba', 0x2ecc71], ['🔵 Pista dura', 0x2980b9], ['🤝 Dobles', 0x9b59b6], ['🎾 Jugador de club', 0xf1c40f], ['🧑‍🏫 Entrenador', 0x0984e3], ['🏆 Competición', 0xe74c3c], ['🔎 Busco compañero', 0x1abc9c], ['🔔 Avisos de partidos', 0xf39c12], ['🃏 Fantasy', 0x636e72]],
  hubName: '🎾 TENIS',
  hub: [
    ['💬', 'general', 'Charla de tenis'],
    ['📅', 'partidos-de-hoy', 'Partidos de hoy y resultados'],
    ['📊', 'rankings', 'Rankings ATP y WTA'],
    ['🔮', 'predicciones', 'Quién gana: pronósticos'],
    ['🎬', 'highlights', 'Los mejores puntos'],
    ['📜', 'historia', 'Leyendas e historia del tenis'],
    ['😂', 'memes', 'Memes de tenis'],
  ],
  cats: [
    ['🏆 TORNEOS', [['🇦🇺', 'australian-open', 'Abierto de Australia'], ['🇫🇷', 'roland-garros', 'Roland Garros'], ['🇬🇧', 'wimbledon', 'Wimbledon'], ['🇺🇸', 'us-open', 'Abierto de EE. UU.'], ['🏅', 'masters-1000', 'Masters 1000 y torneos ATP/WTA'], ['🌍', 'copa-davis-y-bjk-cup', 'Copa Davis, Billie Jean King Cup y Juegos Olímpicos']]],
    ['🎾 A JUGAR', [['🔎', 'buscar-partido', 'Encuentra con quién jugar'], ['🧠', 'técnica', 'Golpes, tácticas y consejos'], ['🛒', 'material', 'Raquetas, cuerdas y zapatillas'], ['🏟️', 'pistas-y-clubes', 'Dónde jugar']]],
  ],
  voice: [['📺 Partido en directo'], ['🎙️ Charla'], ['🎾 Peloteo'], ['💤 AFK']],
});

SPORTS.ciclismo = make({
  ico: '🚴', n: 'Ciclismo', d: 'Servidor de ciclismo: Tour, Giro y Vuelta, ruta, MTB y gravel, rutas, mecánica y quedadas.',
  pre: [['🚴 Ruta', 0xe74c3c], ['🏔️ MTB', 0x27ae60], ['🪨 Gravel', 0xe67e22], ['🏙️ Urbano', 0x3498db], ['🔌 Bici eléctrica', 0x1abc9c], ['🏁 Competición', 0xf1c40f], ['⛰️ Escalador', 0x9b59b6], ['⚡ Esprínter', 0xe91e63], ['⏱️ Contrarrelojista', 0x0984e3], ['👀 Aficionado', 0x95a5a6], ['🔔 Avisos de etapa', 0xf39c12]],
  hubName: '🚴 CICLISMO',
  hub: [
    ['💬', 'general', 'Charla de ciclismo'],
    ['🏁', 'etapa-del-día', 'La etapa de hoy y resultados'],
    ['🏆', 'clasificaciones', 'Clasificación general y por equipos'],
    ['🔁', 'fichajes', 'Fichajes y rumores del pelotón'],
    ['🎬', 'clips', 'Ataques y mejores momentos'],
    ['😂', 'memes', 'Memes de ciclismo'],
  ],
  cats: [
    ['🏆 GRANDES VUELTAS', [['🇫🇷', 'tour-de-francia', 'Tour de Francia'], ['🇮🇹', 'giro-de-italia', 'Giro de Italia'], ['🇪🇸', 'vuelta-a-españa', 'Vuelta a España'], ['🧱', 'clásicas', 'Monumentos y clásicas'], ['👩', 'ciclismo-femenino', 'Ciclismo femenino']]],
    ['🛣️ A RODAR', [['🛣️', 'rutas', 'Rutas y quedadas'], ['🔧', 'mecánica', 'Mantenimiento y consejos'], ['🛒', 'compra-venta', 'Bicis y componentes'], ['🏋️', 'entrenamiento', 'Planes y entrenamiento'], ['📸', 'fotos', 'Fotos de tus salidas']]],
  ],
  voice: [['📺 Etapa en directo'], ['🛣️ En ruta'], ['🔧 Taller'], ['💤 AFK']],
});

SPORTS.rugby = make({
  ico: '🏉', n: 'Rugby', d: 'Servidor de rugby: Seis Naciones, Rugby Championship, Mundial, ligas de clubes, posiciones y tercer tiempo.',
  staff: [REF, PRESS],
  pre: [['🏉 Seis Naciones', 0x3498db], ['🏉 Rugby Championship', 0x2ecc71], ['🌍 Mundial de Rugby', 0xf1c40f], ['🏆 Clubes y ligas', 0xe67e22], ['🧱 Delantero', 0xe74c3c], ['⚡ Tres cuartos', 0x9b59b6], ['🦵 Apertura', 0x1abc9c], ['🏉 Jugador de club', 0x0984e3], ['🍻 Tercer tiempo', 0xe91e63], ['🔔 Avisos de partidos', 0xf39c12]],
  hubName: '🏉 RUGBY',
  hub: [
    ['💬', 'general', 'Charla de rugby'],
    ['📅', 'partidos', 'Partidos y resultados'],
    ['📊', 'clasificaciones', 'Tablas y estadísticas'],
    ['🧠', 'tácticas', 'Análisis y estrategia'],
    ['🔁', 'fichajes', 'Fichajes y rumores'],
    ['🎬', 'ensayos', 'Los mejores ensayos'],
    ['🍻', 'tercer-tiempo', 'Charla relajada después del partido'],
    ['😂', 'memes', 'Memes de rugby'],
  ],
  cats: [['🏆 COMPETICIONES', [['🏆', 'seis-naciones', 'Seis Naciones'], ['🌏', 'rugby-championship', 'The Rugby Championship'], ['🌍', 'mundial', 'Copa del Mundo'], ['🏟️', 'ligas-de-clubes', 'Top 14, Premiership, URC y más'], ['🔟', 'rugby-seven', 'Rugby 7 y Juegos Olímpicos']]]],
  voice: [['📺 Partido en directo'], ['🍻 Tercer tiempo'], ['🎙️ Charla'], ['💤 AFK']],
});

SPORTS.golf = make({
  ico: '⛳', n: 'Golf', d: 'Servidor de golf: majors, PGA, DP World Tour y LPGA, swing, material, campos y partidas entre amigos.',
  staff: [REF, PRESS],
  pre: [['⛳ PGA Tour', 0x2ecc71], ['🇪🇺 DP World Tour', 0x3498db], ['👩 LPGA', 0xe91e63], ['🏆 Majors', 0xf1c40f], ['⛳ Jugador de club', 0xe67e22], ['🏌️ Principiante', 0x95a5a6], ['🎯 Handicap bajo', 0x9b59b6], ['🧑‍🏫 Profesor', 0x0984e3], ['🎮 Golf virtual', 0x1abc9c], ['🔎 Busco partida', 0xe74c3c], ['🔔 Avisos de torneos', 0xf39c12]],
  hubName: '⛳ GOLF',
  hub: [
    ['💬', 'general', 'Charla de golf'],
    ['📅', 'torneos-de-la-semana', 'Torneos y clasificación en vivo'],
    ['📊', 'rankings', 'Ranking mundial'],
    ['🔮', 'predicciones', 'Quién gana: pronósticos'],
    ['🎬', 'golpes', 'Los mejores golpes'],
    ['😂', 'memes', 'Memes de golf'],
  ],
  cats: [
    ['🏆 MAJORS', [['🟢', 'masters', 'Masters de Augusta'], ['🇺🇸', 'pga-championship', 'PGA Championship'], ['🏴', 'us-open', 'US Open'], ['🇬🇧', 'the-open', 'The Open'], ['🏆', 'ryder-cup', 'Ryder Cup']]],
    ['⛳ A JUGAR', [['🔎', 'buscar-partida', 'Encuentra con quién jugar'], ['🧠', 'swing-y-técnica', 'Swing, putt y consejos'], ['🛒', 'material', 'Palos, bolas y accesorios'], ['🏌️', 'campos', 'Campos que recomiendas'], ['🎮', 'golf-virtual', 'Simuladores y videojuegos']]],
  ],
  voice: [['📺 Torneo en directo'], ['⛳ Ronda de amigos'], ['🎙️ Charla'], ['💤 AFK']],
});

SPORTS.padel = make({
  ico: '🏓', n: 'Pádel', d: 'Servidor de pádel: circuito profesional, partidos entre amigos, técnica, palas y pistas.',
  pre: [['🏓 Principiante', 0x95a5a6], ['🏓 Intermedio', 0x3498db], ['🏓 Avanzado', 0xe67e22], ['🏆 Competición', 0xe74c3c], ['⬅️ Revés', 0x9b59b6], ['➡️ Drive', 0x1abc9c], ['🧑‍🏫 Entrenador', 0x0984e3], ['🔎 Busco pareja', 0xe91e63], ['🔔 Avisos de torneos', 0xf39c12], ['👀 Aficionado', 0xf1c40f]],
  hubName: '🏓 PÁDEL',
  hub: [
    ['💬', 'general', 'Charla de pádel'],
    ['🏆', 'circuito-profesional', 'Premier Padel, World Padel Tour y resultados'],
    ['🔮', 'predicciones', 'Quién gana: pronósticos'],
    ['🎬', 'mejores-puntos', 'Víboras, bandejas y puntazos'],
    ['😂', 'memes', 'Memes de pádel'],
  ],
  cats: [['🏓 A JUGAR', [['🔎', 'buscar-partido', 'Encuentra con quién jugar'], ['🧠', 'técnica', 'Golpes, tácticas y consejos'], ['🛒', 'palas-y-material', 'Palas, zapatillas y ropa'], ['🏟️', 'pistas-y-clubes', 'Dónde jugar'], ['🏅', 'torneos-amateurs', 'Torneos de la comunidad']]]],
  voice: [['📺 Partido en directo'], ['🏓 Partido de amigos', { limit: 4 }], ['🎙️ Charla'], ['💤 AFK']],
});

SPORTS.running = make({
  ico: '🏃', n: 'Running / Atletismo', d: 'Servidor de running y atletismo: carreras populares, planes de entrenamiento, ritmos, zapatillas y retos.',
  pre: [['🏃 5K', 0x2ecc71], ['🏃 10K', 0x1abc9c], ['🏃 Media maratón', 0x3498db], ['🏃 Maratón', 0xe74c3c], ['⛰️ Trail', 0x27ae60], ['🏟️ Pista y atletismo', 0xe67e22], ['🚶 Principiante', 0x95a5a6], ['⏱️ Busco marcas', 0xf1c40f], ['🧑‍🏫 Entrenador', 0x0984e3], ['🔔 Avisos de carreras', 0xf39c12]],
  hubName: '🏃 RUNNING',
  hub: [
    ['💬', 'general', 'Charla de running'],
    ['⏱️', 'marcas-y-entrenos', 'Comparte tus entrenos y marcas'],
    ['🗓️', 'carreras', 'Carreras populares y fechas'],
    ['🧠', 'planes-de-entrenamiento', 'Planes y consejos'],
    ['👟', 'zapatillas', 'Zapatillas y material'],
    ['🥗', 'nutrición', 'Alimentación e hidratación'],
    ['🏆', 'retos', 'Retos mensuales de la comunidad'],
    ['😂', 'memes', 'Memes de corredores'],
  ],
  cats: [['🏟️ ATLETISMO PROFESIONAL', [['🌍', 'mundiales-y-olimpiadas', 'Campeonatos del mundo y Juegos Olímpicos'], ['⚡', 'velocidad', '100 m, 200 m y relevos'], ['🏃', 'fondo-y-maratón', 'Fondo, maratón y grandes carreras'], ['🏋️', 'saltos-y-lanzamientos', 'Saltos y lanzamientos']]]],
  voice: [['🏃 Salida en grupo'], ['🎙️ Charla'], ['🧘 Recuperación'], ['💤 AFK']],
  rule5: 'No des consejos médicos como si fueras profesional: ante una lesión, consulta a un especialista.',
});

SPORTS.fitness = make({
  ico: '💪', n: 'Gimnasio / Fitness', d: 'Servidor de gimnasio: rutinas, progreso, nutrición, calistenia, retos y salas para entrenar juntos.',
  pre: [['💪 Fuerza', 0xe74c3c], ['🏋️ Powerlifting', 0xc0392b], ['🤸 Calistenia', 0xe67e22], ['🏃 Cardio', 0x2ecc71], ['🧘 Yoga y movilidad', 0x9b59b6], ['🥊 Deportes de contacto', 0x34495e], ['🔥 Definición', 0xf39c12], ['📈 Volumen', 0x3498db], ['🥗 Nutrición', 0x27ae60], ['🚶 Principiante', 0x95a5a6], ['🧑‍🏫 Entrenador', 0x0984e3], ['🔔 Retos semanales', 0xe91e63]],
  hubName: '💪 GIMNASIO',
  hub: [
    ['💬', 'general', 'Charla de entrenamiento'],
    ['🏋️', 'rutinas', 'Rutinas y programas de entrenamiento'],
    ['📈', 'progreso', 'Comparte tu progreso'],
    ['🧠', 'técnica', 'Técnica y ejecución de ejercicios'],
    ['🥗', 'nutrición', 'Alimentación y recetas fit'],
    ['💊', 'suplementos', 'Suplementos: debate informado'],
    ['🧘', 'recuperación', 'Descanso, movilidad y estiramientos'],
    ['🏆', 'retos', 'Retos semanales de la comunidad'],
    ['🔥', 'motivación', 'Motivación y logros'],
  ],
  voice: [['🏋️ Entrenando juntos'], ['🏃 Cardio'], ['🧘 Estiramientos'], ['💤 AFK']],
  rule5: 'No des consejos médicos como si fueras profesional: ante una lesión o dieta especial, consulta a un especialista.',
});

SPORTS.esports = make({
  ico: '🕹️', n: 'Esports / Competitivo', d: 'Servidor de esports: un rol y canal por juego (LoL, Valorant, CS2…), torneos, scrims, equipos y calendario.',
  staff: [{ name: 'Caster', color: 0xe17055, hoist: true }, { name: 'Capitán', color: 0x00b894, hoist: true }],
  pre: [['🏆 Competitivo', 0xe74c3c], ['🔎 Busco equipo', 0xf39c12], ['🔔 Avisos de torneos', 0x9b59b6]],
  teams: [['League of Legends', 0x3498db], ['Valorant', 0xe74c3c], ['Counter-Strike 2', 0xf1c40f], ['Dota 2', 0xc0392b], ['Rocket League', 0x2980b9], ['Fortnite', 0x9b59b6], ['Overwatch 2', 0xe67e22], ['Apex Legends', 0xd35400], ['Call of Duty', 0x2b2b2b], ['Rainbow Six Siege', 0x7f8c8d], ['EA FC', 0x2ecc71], ['Street Fighter', 0xe91e63], ['Free Fire', 0xf39c12], ['Mobile Legends', 0x1abc9c], ['Clash Royale', 0x0984e3], ['Brawl Stars', 0xfdcb6e]].map(([n, c]) => [n, c, '🎮']),
  teamCat: '🎮 JUEGOS', teamTopic: 'Comunidad de ',
  hubName: '🕹️ ESPORTS',
  hub: [
    ['💬', 'general', 'Charla de esports'],
    ['📅', 'calendario', 'Torneos y partidos profesionales'],
    ['🥇', 'resultados', 'Resultados y clasificaciones'],
    ['🔮', 'predicciones', 'Quién gana: pronósticos'],
    ['🎬', 'clips', 'Las mejores jugadas'],
    ['😂', 'memes', 'Memes de esports'],
  ],
  cats: [['⚔️ COMPETICIÓN', [['🔎', 'buscar-equipo', 'Encuentra equipo o jugadores'], ['🤝', 'scrims', 'Partidas de práctica'], ['🏆', 'torneos', 'Torneos de la comunidad'], ['🧠', 'estrategia', 'Estrategia y análisis']]]],
  voice: [['📺 Torneo en directo'], ['🎧 Lobby'], ['⚔️ Scrim 1'], ['⚔️ Scrim 2'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte de jugador', 'Torneos', 'Otro'],
});

// Todos los deportes: un rol y un canal por deporte
const DEP = [['⚽', 'Fútbol', 0x2ecc71], ['🏀', 'Baloncesto', 0xe67e22], ['🏈', 'Fútbol americano', 0x8e5a2b], ['⚾', 'Béisbol', 0xe74c3c], ['🎾', 'Tenis', 0xf1c40f], ['🥊', 'Boxeo', 0xc0392b], ['🥋', 'MMA', 0x34495e], ['🏎️', 'Fórmula 1', 0xe8002d], ['🏍️', 'MotoGP', 0xe67e22], ['🏒', 'Hockey', 0x3498db], ['🏐', 'Voleibol', 0xf39c12], ['🏉', 'Rugby', 0x27ae60], ['🚴', 'Ciclismo', 0x1abc9c], ['⛳', 'Golf', 0x2ecc71], ['🏊', 'Natación', 0x0984e3], ['🏃', 'Atletismo', 0xe91e63], ['🏓', 'Pádel y tenis de mesa', 0x9b59b6], ['🏋️', 'Gimnasio', 0xd35400], ['🤸', 'Gimnasia', 0xfd79a8], ['🏹', 'Tiro con arco', 0x636e72], ['🏂', 'Deportes de invierno', 0x74b9ff], ['🏄', 'Surf y deportes de agua', 0x00cec9], ['🕹️', 'Esports', 0x6c5ce7], ['🏅', 'Juegos Olímpicos', 0xf5b800]];
SPORTS.todos = make({
  ico: '🏅', n: 'Todos los deportes', d: 'Un servidor para todos los deportes: un rol y un canal por cada uno (fútbol, baloncesto, tenis, boxeo, F1…) y quinielas.',
  staff: [REF, PRESS],
  teams: DEP.map(([e, n, c]) => [n, c, e]), teamCat: '🏅 DEPORTES', teamTopic: 'Todo sobre ',
  hubName: '🏅 DEPORTES',
  hub: [
    ['💬', 'general', 'Charla de deportes'],
    ['📅', 'agenda-deportiva', 'Qué se juega hoy'],
    ['🥇', 'resultados', 'Resultados y marcadores'],
    ['🗞️', 'noticias', 'Noticias del mundo del deporte'],
    ['🔥', 'debates', 'Debates con respeto'],
    ['🎬', 'highlights', 'Las mejores jugadas'],
    ['😂', 'memes', 'Memes deportivos'],
  ],
  cats: [['🎯 JUEGOS', [['🎯', 'quiniela', 'Pronostica los resultados'], ['🃏', 'fantasy', 'Ligas fantasy'], ['❓', 'trivia', 'Preguntas y retos deportivos'], ['🏃', 'retos', 'Retos deportivos de la comunidad']]]],
  voice: [['📺 Evento en directo'], ['🎙️ Tertulia'], ['🔊 Sala 1'], ['🔊 Sala 2'], ['💤 AFK']],
  ticketCats: ['Ayuda', 'Reporte', 'Quiniela / Fantasy', 'Otro'],
});

module.exports = { SPORTS: { ...FOOTBALL, ...SPORTS }, dot, slug };
