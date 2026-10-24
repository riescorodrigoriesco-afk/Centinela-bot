'use strict';

/*
 * games.js — Minijuegos con botones y economía de monedas (por servidor).
 * Exporta: commands (slash) y handleButton(interaction) → true si lo manejó.
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { jsonStore, L, COLOR } = require('./bot');

const EPHEMERAL = MessageFlags.Ephemeral;
const eco = jsonStore('economy.json', () => ({}));
const START_COINS = 100;

/* ============================ economía ============================ */
function acct(gid, uid) {
  const g = eco.data[gid] || (eco.data[gid] = {});
  if (!g[uid]) g[uid] = { coins: START_COINS, lastDaily: 0, streak: 0, lastWork: 0, won: 0, played: 0 };
  return g[uid];
}
const coinsTxt = (n) => '🪙 ' + Math.floor(n).toLocaleString('en-US');
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const newId = () => Math.random().toString(36).slice(2, 9);
const reply = (i, content, ephemeral = true) => i.reply({ content, ...(ephemeral ? { flags: EPHEMERAL } : {}) });

function loc(builder, esName, esDesc) {
  if (esName) builder.setNameLocalizations({ 'es-ES': esName, 'es-419': esName });
  if (esDesc) builder.setDescriptionLocalizations({ 'es-ES': esDesc, 'es-419': esDesc });
  return builder;
}

async function checkBet(i, bet) {
  const a = acct(i.guildId, i.user.id);
  if (bet > a.coins) {
    await reply(i, L(i.locale, '❌ You only have ' + coinsTxt(a.coins) + '.', '❌ Solo tienes ' + coinsTxt(a.coins) + '.'));
    return null;
  }
  return a;
}

function settle(a, bet, payout) {
  // payout = monedas devueltas en total (0 = pierde todo)
  a.coins += payout - bet;
  a.played++;
  if (payout > bet) a.won++;
  eco.save();
}

const betOption = (o) => o.setName('bet').setDescription('Coins to bet').setRequired(true).setMinValue(1).setMaxValue(1000000);

/* ============================ estado de partidas ============================ */
const games = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, g] of games) if (now > g.expires) games.delete(k);
}, 60000).unref();
const putGame = (g, minutes = 10) => {
  g.expires = Date.now() + minutes * 60000;
  games.set(g.id, g);
  return g;
};

const embed = (color, title, desc) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);

const commands = [];

/* ============================ /coinflip ============================ */
commands.push({
  data: loc(
    new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin and bet on it')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('side').setDescription('Heads or tails').setRequired(true).addChoices({ name: 'heads', value: 'h' }, { name: 'tails', value: 't' }))
      .addIntegerOption(betOption),
    'moneda',
    'Lanza una moneda y apuesta'
  ),
  async execute(i) {
    const bet = i.options.getInteger('bet', true);
    const a = await checkBet(i, bet);
    if (!a) return;
    const side = i.options.getString('side', true);
    const res = Math.random() < 0.5 ? 'h' : 't';
    const win = side === res;
    settle(a, bet, win ? bet * 2 : 0);
    const names = { h: L(i.locale, 'Heads', 'Cara'), t: L(i.locale, 'Tails', 'Cruz') };
    return i.reply({
      embeds: [
        embed(
          win ? COLOR.green : COLOR.red,
          '🪙 ' + names[res],
          (win ? L(i.locale, '🎉 You won ', '🎉 Ganaste ') + coinsTxt(bet) : L(i.locale, '💸 You lost ', '💸 Perdiste ') + coinsTxt(bet)) + '\n' + L(i.locale, 'Balance: ', 'Saldo: ') + coinsTxt(a.coins)
        ),
      ],
    });
  },
});

/* ============================ /dice ============================ */
commands.push({
  data: loc(new SlashCommandBuilder().setName('dice').setDescription('Roll two dice against the bot').setDMPermission(false).addIntegerOption(betOption), 'dados', 'Tira dos dados contra el bot'),
  async execute(i) {
    const bet = i.options.getInteger('bet', true);
    const a = await checkBet(i, bet);
    if (!a) return;
    const d = () => 1 + rnd(6);
    const you = [d(), d()];
    const bot = [d(), d()];
    const ys = you[0] + you[1];
    const bs = bot[0] + bot[1];
    const payout = ys > bs ? bet * 2 : ys === bs ? bet : 0;
    settle(a, bet, payout);
    const lc = i.locale;
    const out = ys > bs ? L(lc, '🎉 You win ', '🎉 Ganas ') + coinsTxt(bet) : ys === bs ? L(lc, '🤝 Tie, bet returned.', '🤝 Empate, se devuelve la apuesta.') : L(lc, '💸 You lose ', '💸 Pierdes ') + coinsTxt(bet);
    return i.reply({
      embeds: [
        embed(
          ys > bs ? COLOR.green : ys === bs ? COLOR.blue : COLOR.red,
          '🎲 ' + L(lc, 'Dice', 'Dados'),
          L(lc, 'You', 'Tú') + ': 🎲 ' + you.join(' + ') + ' = **' + ys + '**\nBot: 🎲 ' + bot.join(' + ') + ' = **' + bs + '**\n\n' + out + '\n' + L(lc, 'Balance: ', 'Saldo: ') + coinsTxt(a.coins)
        ),
      ],
    });
  },
});

/* ============================ /rps ============================ */
commands.push({
  data: loc(
    new SlashCommandBuilder()
      .setName('rps')
      .setDescription('Rock, paper, scissors against the bot')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('choice').setDescription('Your move').setRequired(true).addChoices({ name: 'rock', value: 'r' }, { name: 'paper', value: 'p' }, { name: 'scissors', value: 's' }))
      .addIntegerOption((o) => o.setName('bet').setDescription('Coins to bet (optional)').setMinValue(1).setMaxValue(1000000)),
    'ppt',
    'Piedra, papel o tijera contra el bot'
  ),
  async execute(i) {
    const bet = i.options.getInteger('bet') || 0;
    const a = acct(i.guildId, i.user.id);
    if (bet) {
      if (!(await checkBet(i, bet))) return;
    }
    const mine = i.options.getString('choice', true);
    const bots = pick(['r', 'p', 's']);
    const icon = { r: '🪨', p: '📄', s: '✂️' };
    const beats = { r: 's', p: 'r', s: 'p' };
    const win = beats[mine] === bots;
    const tie = mine === bots;
    if (bet) settle(a, bet, win ? bet * 2 : tie ? bet : 0);
    const lc = i.locale;
    const txt = win ? L(lc, '🎉 You win!', '🎉 ¡Ganas!') : tie ? L(lc, '🤝 Tie.', '🤝 Empate.') : L(lc, '💸 You lose.', '💸 Pierdes.');
    return i.reply({
      embeds: [embed(win ? COLOR.green : tie ? COLOR.blue : COLOR.red, L(lc, 'Rock Paper Scissors', 'Piedra, Papel o Tijera'), L(lc, 'You', 'Tú') + ': ' + icon[mine] + '  vs  Bot: ' + icon[bots] + '\n\n' + txt + (bet ? '\n' + L(lc, 'Balance: ', 'Saldo: ') + coinsTxt(a.coins) : ''))],
    });
  },
});

/* ============================ /slots ============================ */
commands.push({
  data: loc(new SlashCommandBuilder().setName('slots').setDescription('Spin the slot machine').setDMPermission(false).addIntegerOption(betOption), 'tragamonedas', 'Gira la máquina tragamonedas'),
  async execute(i) {
    const bet = i.options.getInteger('bet', true);
    const a = await checkBet(i, bet);
    if (!a) return;
    const sym = ['🍒', '🍋', '🍇', '🔔', '⭐', '💎'];
    const r = [pick(sym), pick(sym), pick(sym)];
    const same = new Set(r).size;
    let payout = 0;
    let label = L(i.locale, '💸 No match.', '💸 Sin coincidencias.');
    if (same === 1) {
      payout = bet * (r[0] === '💎' ? 25 : 10);
      label = L(i.locale, '🎰 JACKPOT!', '🎰 ¡JACKPOT!');
    } else if (same === 2) {
      payout = Math.floor(bet * 1.5);
      label = L(i.locale, '✨ Pair!', '✨ ¡Pareja!');
    }
    settle(a, bet, payout);
    return i.reply({
      embeds: [
        embed(
          payout > bet ? COLOR.green : payout === bet ? COLOR.blue : COLOR.red,
          '🎰 ' + r.join(' | '),
          label + '\n' + (payout ? L(i.locale, 'Payout: ', 'Premio: ') + coinsTxt(payout) : '') + '\n' + L(i.locale, 'Balance: ', 'Saldo: ') + coinsTxt(a.coins)
        ),
      ],
    });
  },
});

/* ============================ /8ball ============================ */
const BALL_ES = ['Sí, sin duda.', 'Todo apunta a que sí.', 'Probablemente.', 'Las señales dicen que sí.', 'Pregunta de nuevo más tarde.', 'Mejor no decirte ahora.', 'No cuentes con ello.', 'Mi respuesta es no.', 'Muy dudoso.', 'Definitivamente no.'];
const BALL_EN = ['Yes, definitely.', 'All signs point to yes.', 'Probably.', 'Outlook good.', 'Ask again later.', 'Better not tell you now.', 'Do not count on it.', 'My answer is no.', 'Very doubtful.', 'Definitely not.'];
commands.push({
  data: loc(
    new SlashCommandBuilder().setName('8ball').setDescription('Ask the magic 8-ball').addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(200)),
    'bola8',
    'Pregúntale a la bola mágica'
  ),
  async execute(i) {
    const es = String(i.locale).toLowerCase().startsWith('es');
    return i.reply({ embeds: [embed(COLOR.blue, '🎱 ' + i.options.getString('question', true).slice(0, 200), pick(es ? BALL_ES : BALL_EN))] });
  },
});

/* ============================ economía: daily / work / balance / leaderboard ============================ */
commands.push({
  data: loc(new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins').setDMPermission(false), 'diario', 'Reclama tus monedas diarias'),
  async execute(i) {
    const a = acct(i.guildId, i.user.id);
    const now = Date.now();
    const lc = i.locale;
    const left = a.lastDaily + 20 * 3600000 - now;
    if (left > 0) {
      return reply(i, L(lc, '⏳ Come back <t:' + Math.floor((now + left) / 1000) + ':R>.', '⏳ Vuelve <t:' + Math.floor((now + left) / 1000) + ':R>.'));
    }
    a.streak = now - a.lastDaily < 48 * 3600000 ? a.streak + 1 : 1;
    const reward = 100 + Math.min(a.streak, 30) * 10;
    a.coins += reward;
    a.lastDaily = now;
    eco.save();
    return i.reply({ embeds: [embed(COLOR.green, '🎁 ' + L(lc, 'Daily reward', 'Recompensa diaria'), '+' + coinsTxt(reward) + '\n🔥 ' + L(lc, 'Streak: ', 'Racha: ') + a.streak + '\n' + L(lc, 'Balance: ', 'Saldo: ') + coinsTxt(a.coins))] });
  },
});

const JOBS_ES = ['programaste un bot', 'repartiste pizzas', 'moderaste un servidor', 'streameaste juegos', 'arreglaste una PC', 'diseñaste un logo'];
const JOBS_EN = ['coded a bot', 'delivered pizzas', 'moderated a server', 'streamed games', 'fixed a PC', 'designed a logo'];
commands.push({
  data: loc(new SlashCommandBuilder().setName('work').setDescription('Work to earn coins (once per hour)').setDMPermission(false), 'trabajar', 'Trabaja para ganar monedas (1 vez por hora)'),
  async execute(i) {
    const a = acct(i.guildId, i.user.id);
    const now = Date.now();
    const lc = i.locale;
    const left = a.lastWork + 3600000 - now;
    if (left > 0) return reply(i, L(lc, '⏳ You are tired. Try <t:' + Math.floor((now + left) / 1000) + ':R>.', '⏳ Estás cansado. Prueba <t:' + Math.floor((now + left) / 1000) + ':R>.'));
    const reward = 30 + rnd(71);
    a.coins += reward;
    a.lastWork = now;
    eco.save();
    const es = String(lc).toLowerCase().startsWith('es');
    return i.reply({ embeds: [embed(COLOR.green, '💼 ' + L(lc, 'Work', 'Trabajo'), (es ? 'Hoy ' + pick(JOBS_ES) + ' y ganaste ' : 'Today you ' + pick(JOBS_EN) + ' and earned ') + coinsTxt(reward) + '\n' + L(lc, 'Balance: ', 'Saldo: ') + coinsTxt(a.coins))] });
  },
});

commands.push({
  data: loc(new SlashCommandBuilder().setName('balance').setDescription('Show your coins').setDMPermission(false).addUserOption((o) => o.setName('user').setDescription('Another user')), 'saldo', 'Muestra tus monedas'),
  async execute(i) {
    const u = i.options.getUser('user') || i.user;
    const a = acct(i.guildId, u.id);
    const lc = i.locale;
    return i.reply({
      embeds: [embed(COLOR.blue, '👛 ' + u.username, coinsTxt(a.coins) + '\n' + L(lc, 'Games won: ', 'Juegos ganados: ') + a.won + ' / ' + a.played + '\n🔥 ' + L(lc, 'Daily streak: ', 'Racha diaria: ') + a.streak)],
    });
  },
});

commands.push({
  data: loc(new SlashCommandBuilder().setName('leaderboard').setDescription('Richest members of this server').setDMPermission(false), 'ranking', 'Los miembros más ricos del servidor'),
  async execute(i) {
    const g = eco.data[i.guildId] || {};
    const top = Object.entries(g).sort((x, y) => y[1].coins - x[1].coins).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map(([id, v], n) => (medals[n] || '**' + (n + 1) + '.**') + ' <@' + id + '> — ' + coinsTxt(v.coins));
    return i.reply({ embeds: [embed(COLOR.orange, '🏆 ' + L(i.locale, 'Leaderboard', 'Ranking'), lines.join('\n') || L(i.locale, 'Nobody has played yet.', 'Nadie ha jugado todavía.'))], allowedMentions: { parse: [] } });
  },
});

/* ============================ /trivia ============================ */
const TRIVIA_ES = [
  ['¿Cuál es el planeta más grande del sistema solar?', 'Júpiter', ['Saturno', 'Neptuno', 'Tierra']],
  ['¿Cuántos lados tiene un hexágono?', '6', ['5', '7', '8']],
  ['¿Cuál es la capital de Japón?', 'Tokio', ['Kioto', 'Osaka', 'Seúl']],
  ['¿Qué gas respiramos principalmente para vivir?', 'Oxígeno', ['Nitrógeno', 'Helio', 'Hidrógeno']],
  ['¿Quién pintó la Mona Lisa?', 'Leonardo da Vinci', ['Miguel Ángel', 'Picasso', 'Van Gogh']],
  ['¿Cuántos jugadores hay en un equipo de fútbol en cancha?', '11', ['9', '10', '12']],
  ['¿Cuál es el océano más grande?', 'Pacífico', ['Atlántico', 'Índico', 'Ártico']],
  ['¿Qué lenguaje se usa para dar estilo a páginas web?', 'CSS', ['SQL', 'Python', 'C++']],
  ['¿Cuál es el metal líquido a temperatura ambiente?', 'Mercurio', ['Plomo', 'Hierro', 'Cobre']],
  ['¿En qué continente está Egipto?', 'África', ['Asia', 'Europa', 'Oceanía']],
];
const TRIVIA_EN = [
  ['What is the largest planet in the solar system?', 'Jupiter', ['Saturn', 'Neptune', 'Earth']],
  ['How many sides does a hexagon have?', '6', ['5', '7', '8']],
  ['What is the capital of Japan?', 'Tokyo', ['Kyoto', 'Osaka', 'Seoul']],
  ['Which gas do we mainly breathe to live?', 'Oxygen', ['Nitrogen', 'Helium', 'Hydrogen']],
  ['Who painted the Mona Lisa?', 'Leonardo da Vinci', ['Michelangelo', 'Picasso', 'Van Gogh']],
  ['How many players per side are on the field in football (soccer)?', '11', ['9', '10', '12']],
  ['What is the largest ocean?', 'Pacific', ['Atlantic', 'Indian', 'Arctic']],
  ['Which language styles web pages?', 'CSS', ['SQL', 'Python', 'C++']],
  ['Which metal is liquid at room temperature?', 'Mercury', ['Lead', 'Iron', 'Copper']],
  ['On which continent is Egypt?', 'Africa', ['Asia', 'Europe', 'Oceania']],
];
const TRIVIA_REWARD = 30;

commands.push({
  data: loc(new SlashCommandBuilder().setName('trivia').setDescription('Answer a trivia question and win coins').setDMPermission(false), 'trivia', 'Responde una pregunta y gana monedas'),
  async execute(i) {
    const es = String(i.locale).toLowerCase().startsWith('es');
    const [q, right, wrong] = pick(es ? TRIVIA_ES : TRIVIA_EN);
    const options = [right, ...wrong].map((t, n) => ({ t, ok: n === 0 })).sort(() => Math.random() - 0.5);
    const g = putGame({ id: newId(), type: 'trivia', user: i.user.id, guild: i.guildId, options, q }, 2);
    const row = new ActionRowBuilder().addComponents(options.map((o, n) => new ButtonBuilder().setCustomId('g:trivia:' + g.id + ':' + n).setLabel(o.t.slice(0, 80)).setStyle(ButtonStyle.Secondary)));
    return i.reply({ embeds: [embed(COLOR.blue, '🧠 Trivia', q + '\n\n' + L(i.locale, 'Reward: ', 'Premio: ') + coinsTxt(TRIVIA_REWARD))], components: [row] });
  },
});

/* ============================ /hilo ============================ */
const CARD = (n) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[n] || String(n));
const HILO_STEP = 1.4;

function hiloView(g, locale, over) {
  const mult = Math.pow(HILO_STEP, g.streak);
  const now = Math.floor(g.bet * mult);
  const desc =
    L(locale, 'Current card: ', 'Carta actual: ') + '**' + CARD(g.card) + '**\n' +
    L(locale, 'Will the next card be higher or lower? (ties lose)', '¿La siguiente carta será mayor o menor? (el empate pierde)') + '\n\n' +
    L(locale, 'Bet: ', 'Apuesta: ') + coinsTxt(g.bet) + ' · ' + L(locale, 'Streak: ', 'Racha: ') + g.streak + ' · ' + L(locale, 'Cash out: ', 'Retirar: ') + coinsTxt(now);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('g:hilo:' + g.id + ':hi').setLabel(L(locale, 'Higher', 'Mayor')).setEmoji('⬆️').setStyle(ButtonStyle.Primary).setDisabled(over),
    new ButtonBuilder().setCustomId('g:hilo:' + g.id + ':lo').setLabel(L(locale, 'Lower', 'Menor')).setEmoji('⬇️').setStyle(ButtonStyle.Primary).setDisabled(over),
    new ButtonBuilder().setCustomId('g:hilo:' + g.id + ':cash').setLabel(L(locale, 'Cash out', 'Retirar')).setEmoji('💰').setStyle(ButtonStyle.Success).setDisabled(over)
  );
  return { embeds: [embed(COLOR.blue, '🃏 Hi-Lo', desc)], components: [row] };
}

commands.push({
  data: loc(new SlashCommandBuilder().setName('hilo').setDescription('Guess higher or lower and build a streak').setDMPermission(false).addIntegerOption(betOption), 'mayormenor', 'Adivina si la carta es mayor o menor y arma una racha'),
  async execute(i) {
    const bet = i.options.getInteger('bet', true);
    const a = await checkBet(i, bet);
    if (!a) return;
    a.coins -= bet; // se descuenta al empezar; se devuelve al retirar
    eco.save();
    const g = putGame({ id: newId(), type: 'hilo', user: i.user.id, guild: i.guildId, bet, card: 1 + rnd(13), streak: 0 }, 10);
    return i.reply(hiloView(g, i.locale, false));
  },
});

/* ============================ /tictactoe ============================ */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winner = (b) => {
  for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x];
  return b.every(Boolean) ? 'draw' : null;
};

function tttView(g, locale, endText) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const v = g.board[idx];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('g:ttt:' + g.id + ':' + idx)
          .setLabel(v || '​')
          .setStyle(v === 'X' ? ButtonStyle.Danger : v === 'O' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(!!v || !!endText)
      );
    }
    rows.push(row);
  }
  const turn = g.players[g.turn];
  const head = '❌ <@' + g.players[0] + '>  vs  ⭕ <@' + g.players[1] + '>\n\n';
  return { content: head + (endText || L(locale, 'Turn: ', 'Turno: ') + (g.turn === 0 ? '❌' : '⭕') + ' <@' + turn + '>'), components: rows, allowedMentions: { users: [g.players[g.turn]] } };
}

commands.push({
  data: loc(
    new SlashCommandBuilder().setName('tictactoe').setDescription('Play tic-tac-toe against another member').setDMPermission(false).addUserOption((o) => o.setName('opponent').setDescription('Who do you challenge?').setRequired(true)),
    'gato',
    'Juega al gato (tres en raya) contra otro miembro'
  ),
  async execute(i) {
    const opp = i.options.getUser('opponent', true);
    if (opp.bot || opp.id === i.user.id) return reply(i, L(i.locale, '❌ Pick another human member.', '❌ Elige a otro miembro (no bots ni tú mismo).'));
    const g = putGame({ id: newId(), type: 'ttt', players: [i.user.id, opp.id], board: Array(9).fill(null), turn: 0 }, 15);
    return i.reply(tttView(g, i.locale));
  },
});

/* ============================ botones ============================ */
async function handleButton(i) {
  if (!i.customId.startsWith('g:')) return false;
  const [, type, id, arg] = i.customId.split(':');
  const lc = i.locale;
  const g = games.get(id);
  if (!g) {
    await i.reply({ content: L(lc, '⌛ This game has expired.', '⌛ Esta partida ya expiró.'), flags: EPHEMERAL }).catch(() => {});
    return true;
  }

  /* ---- trivia ---- */
  if (type === 'trivia') {
    if (i.user.id !== g.user) {
      await i.reply({ content: L(lc, 'This question is not for you. Use `/trivia`.', 'Esta pregunta no es para ti. Usa `/trivia`.'), flags: EPHEMERAL });
      return true;
    }
    games.delete(id);
    const chosen = g.options[parseInt(arg, 10)];
    const a = acct(g.guild, g.user);
    a.played++;
    if (chosen && chosen.ok) {
      a.coins += TRIVIA_REWARD;
      a.won++;
    }
    eco.save();
    const rightTxt = g.options.find((o) => o.ok).t;
    const row = new ActionRowBuilder().addComponents(
      g.options.map((o, n) =>
        new ButtonBuilder()
          .setCustomId('g:done:' + id + ':' + n)
          .setLabel(o.t.slice(0, 80))
          .setStyle(o.ok ? ButtonStyle.Success : n === parseInt(arg, 10) ? ButtonStyle.Danger : ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
    await i.update({
      embeds: [embed(chosen && chosen.ok ? COLOR.green : COLOR.red, '🧠 Trivia', g.q + '\n\n' + (chosen && chosen.ok ? L(lc, '✅ Correct! +', '✅ ¡Correcto! +') + coinsTxt(TRIVIA_REWARD) : L(lc, '❌ Wrong. Answer: **', '❌ Incorrecto. Respuesta: **') + rightTxt + '**'))],
      components: [row],
    });
    return true;
  }

  /* ---- hi-lo ---- */
  if (type === 'hilo') {
    if (i.user.id !== g.user) {
      await i.reply({ content: L(lc, 'This is not your game. Use `/hilo`.', 'Esta no es tu partida. Usa `/hilo`.'), flags: EPHEMERAL });
      return true;
    }
    const a = acct(g.guild, g.user);
    const payAndClose = async (payout, title, color) => {
      games.delete(id);
      a.coins += payout;
      a.played++;
      if (payout > g.bet) a.won++;
      eco.save();
      const v = hiloView(g, lc, true);
      v.embeds = [embed(color, title, v.embeds[0].data.description + '\n\n' + L(lc, 'Balance: ', 'Saldo: ') + coinsTxt(a.coins))];
      await i.update(v);
    };
    if (arg === 'cash') {
      const payout = Math.floor(g.bet * Math.pow(HILO_STEP, g.streak));
      await payAndClose(payout, L(lc, '💰 Cashed out ', '💰 Retiraste ') + coinsTxt(payout), COLOR.green);
      return true;
    }
    let next = 1 + rnd(13);
    const win = arg === 'hi' ? next > g.card : next < g.card;
    if (!win) {
      const lastCard = g.card;
      g.card = next;
      await payAndClose(0, L(lc, '💥 Lost! Previous card ', '💥 ¡Perdiste! Carta anterior ') + CARD(lastCard) + ' → ' + CARD(next), COLOR.red);
      return true;
    }
    g.streak++;
    g.card = next;
    g.expires = Date.now() + 10 * 60000;
    if (g.streak >= 10) {
      const payout = Math.floor(g.bet * Math.pow(HILO_STEP, g.streak));
      await payAndClose(payout, L(lc, '🏆 Max streak! ', '🏆 ¡Racha máxima! ') + coinsTxt(payout), COLOR.green);
      return true;
    }
    await i.update(hiloView(g, lc, false));
    return true;
  }

  /* ---- tic-tac-toe ---- */
  if (type === 'ttt') {
    if (!g.players.includes(i.user.id)) {
      await i.reply({ content: L(lc, 'You are not playing this game.', 'No estás jugando esta partida.'), flags: EPHEMERAL });
      return true;
    }
    if (g.players[g.turn] !== i.user.id) {
      await i.reply({ content: L(lc, 'Not your turn.', 'No es tu turno.'), flags: EPHEMERAL });
      return true;
    }
    const idx = parseInt(arg, 10);
    if (g.board[idx]) {
      await i.reply({ content: L(lc, 'That square is taken.', 'Esa casilla está ocupada.'), flags: EPHEMERAL });
      return true;
    }
    g.board[idx] = g.turn === 0 ? 'X' : 'O';
    g.expires = Date.now() + 15 * 60000;
    const w = winner(g.board);
    if (w) {
      games.delete(id);
      const txt = w === 'draw' ? L(lc, '🤝 Draw!', '🤝 ¡Empate!') : '🏆 ' + L(lc, 'Winner: ', 'Ganador: ') + '<@' + g.players[g.turn] + '>';
      await i.update(tttView(g, lc, txt));
      return true;
    }
    g.turn = 1 - g.turn;
    await i.update(tttView(g, lc));
    return true;
  }

  return false;
}

module.exports = { commands, handleButton, acct, eco, coinsTxt };
