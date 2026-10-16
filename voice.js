'use strict';

/*
 * voice.js — Habla con el bot en un canal de voz.
 *   /putbot     entra a tu canal de voz y te escucha
 *   /setidioma  elige el idioma en el que escucha y habla
 *
 * Flujo: audio del usuario → texto (Whisper) → respuesta (Claude / Groq / OpenAI) → voz (TTS) → canal de voz.
 * Claves (variables de entorno): GROQ_API_KEY (gratis, sirve para oír y pensar) o OPENAI_API_KEY,
 * y/o ANTHROPIC_API_KEY para que piense con Claude.
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits: P, MessageFlags } = require('discord.js');
const { Readable } = require('stream');
const bot = require('./bot');

const { getCfg, saveCfg, L, COLOR, canConfigure, lockedMsg, logErr } = bot;
const EPH = MessageFlags.Ephemeral;

let V = null;
let prism = null;
try { V = require('@discordjs/voice'); } catch (_) { V = null; }
try { prism = require('prism-media'); } catch (_) { prism = null; }

const LANGS = {
  es: { name: 'Español', en: 'Spanish', stt: 'es' },
  en: { name: 'English', en: 'English', stt: 'en' },
  pt: { name: 'Português', en: 'Portuguese', stt: 'pt' },
  fr: { name: 'Français', en: 'French', stt: 'fr' },
  de: { name: 'Deutsch', en: 'German', stt: 'de' },
  it: { name: 'Italiano', en: 'Italian', stt: 'it' },
  ja: { name: '日本語', en: 'Japanese', stt: 'ja' },
};

// Voces neuronales de Microsoft Edge (gratis, sin clave). Si no están disponibles se usa la voz de Google.
const VOICES = {
  es: { female: 'es-MX-DaliaNeural', male: 'es-MX-JorgeNeural' },
  en: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' },
  pt: { female: 'pt-BR-FranciscaNeural', male: 'pt-BR-AntonioNeural' },
  fr: { female: 'fr-FR-DeniseNeural', male: 'fr-FR-HenriNeural' },
  de: { female: 'de-DE-KatjaNeural', male: 'de-DE-ConradNeural' },
  it: { female: 'it-IT-ElsaNeural', male: 'it-IT-DiegoNeural' },
  ja: { female: 'ja-JP-NanamiNeural', male: 'ja-JP-KeitaNeural' },
};
let Edge = null;
try { Edge = require('msedge-tts'); } catch (_) { Edge = null; }

async function edgeTts(text, lang, gender) {
  if (!Edge) throw new Error('no-edge');
  const voice = (VOICES[lang] || VOICES.es)[gender === 'male' ? 'male' : 'female'];
  const t = new Edge.MsEdgeTTS();
  await t.setMetadata(voice, Edge.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const r = t.toStream(text);
  const stream = r && r.audioStream ? r.audioStream : r;
  return await new Promise((resolve, reject) => {
    const bufs = [];
    const timer = setTimeout(() => reject(new Error('edge timeout')), 12000);
    stream.on('data', (c) => bufs.push(Buffer.from(c)));
    stream.on('end', () => { clearTimeout(timer); const b = Buffer.concat(bufs); b.length ? resolve(b) : reject(new Error('edge vacío')); });
    stream.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/* ============================ módulo para /help y el panel web ============================ */
const mods = [
  {
    id: 'voice', ico: '🎙️', inst: false, n: ['Voice chat', 'Chat de voz'], d: ['Talk to the bot in a voice channel (/putbot). It listens, thinks and answers out loud', 'Habla con el bot en un canal de voz (/putbot). Te escucha, piensa y te responde en voz alta'],
    on: ['voice', 'enabled'],
    filters: [{ k: 'transcript', path: ['voice', 'transcript'], n: ['Write what is said in the channel chat', 'Escribir lo que se dice en el chat del canal'] }],
    fields: [
      { k: 'lang', path: ['voice', 'lang'], t: 'choice', c: Object.keys(LANGS), l: ['Language: ' + Object.keys(LANGS).join(' / '), 'Idioma: ' + Object.keys(LANGS).join(' / ')] },
      { k: 'gender', path: ['voice', 'gender'], t: 'choice', c: ['female', 'male'], l: ['Voice: female / male', 'Voz: female / male'] },
      { k: 'persona', path: ['voice', 'persona'], t: 'str', long: true, optional: true, min: 0, max: 500, l: ['Personality (optional)', 'Personalidad (opcional)'] },
    ],
  },
];

/* ============================ sesiones ============================ */
const sessions = new Map(); // guildId -> sesión

function keys() {
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const anth = process.env.ANTHROPIC_API_KEY;
  return {
    stt: groq ? { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: groq, model: process.env.STT_MODEL || 'whisper-large-v3-turbo' } : openai ? { url: 'https://api.openai.com/v1/audio/transcriptions', key: openai, model: process.env.STT_MODEL || 'whisper-1' } : null,
    brain: anth ? { type: 'anthropic', key: anth, model: process.env.VOICE_MODEL || 'claude-haiku-5-5' } : groq ? { type: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', key: groq, model: process.env.VOICE_MODEL || 'llama-3.3-70b-versatile' } : openai ? { type: 'openai', url: 'https://api.openai.com/v1/chat/completions', key: openai, model: process.env.VOICE_MODEL || 'gpt-4o-mini' } : null,
    openai,
  };
}

/* ============================ audio ============================ */
// PCM 48 kHz estéreo 16 bits -> WAV 16 kHz mono (más ligero para la transcripción)
function toWav16k(pcm) {
  const frames = Math.floor(pcm.length / 4);
  const outN = Math.floor(frames / 3);
  const out = Buffer.alloc(44 + outN * 2);
  for (let n = 0; n < outN; n++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      const o = (n * 3 + k) * 4;
      sum += (pcm.readInt16LE(o) + pcm.readInt16LE(o + 2)) / 2;
    }
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / 3))), 44 + n * 2);
  }
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + outN * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24);
  out.writeUInt32LE(32000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(outN * 2, 40);
  return out;
}

function loud(pcm) {
  let peak = 0;
  for (let i = 0; i < pcm.length - 1; i += 40) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  return peak > 900;
}

async function transcribe(pcm, lang) {
  const k = keys().stt;
  if (!k) throw new Error('no-stt');
  const fd = new FormData();
  fd.append('file', new Blob([toWav16k(pcm)], { type: 'audio/wav' }), 'audio.wav');
  fd.append('model', k.model);
  fd.append('language', LANGS[lang].stt);
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  const r = await fetch(k.url, { method: 'POST', headers: { Authorization: 'Bearer ' + k.key }, body: fd });
  if (!r.ok) throw new Error('stt ' + r.status);
  const j = await r.json();
  return String(j.text || '').trim();
}

async function think(s, who, text, cfg) {
  const k = keys().brain;
  if (!k) throw new Error('no-brain');
  const lang = LANGS[cfg.voice.lang] || LANGS.es;
  const system = 'You are Centinela, a Discord bot having a live spoken conversation in a voice channel. Talk like a warm, relaxed friend would: natural, casual and expressive, with light humor, short reactions (like "ah, vaya", "uf", "claro") and, now and then, a brief follow-up question. Answer in ' + lang.en + ' in one to three short sentences, as spoken language: contractions, no markdown, no lists, no emojis, no stage directions. Do not claim to be human or to have a body or a real life; if someone asks what you are, say you are a bot, honestly and with good humor. Be accurate: if you do not know something, say so. The speaker is ' + who + '.' + (cfg.voice.persona ? ' Extra personality: ' + cfg.voice.persona : '');
  s.history.push({ role: 'user', content: text });
  s.history = s.history.slice(-8);
  let out = '';
  if (k.type === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': k.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: k.model, max_tokens: 220, system, messages: s.history }),
    });
    if (!r.ok) throw new Error('brain ' + r.status);
    const j = await r.json();
    out = (j.content || []).map((c) => c.text || '').join(' ');
  } else {
    const r = await fetch(k.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + k.key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: k.model, max_tokens: 220, messages: [{ role: 'system', content: system }, ...s.history] }),
    });
    if (!r.ok) throw new Error('brain ' + r.status);
    const j = await r.json();
    out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }
  out = out.replace(/[*_`#>]/g, '').trim();
  s.history.push({ role: 'assistant', content: out });
  return out;
}

function chunks(text) {
  const parts = text.match(/[^.!?¿¡\n]+[.!?]?/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if ((cur + ' ' + p).length > 180) { if (cur) out.push(cur); cur = p.slice(0, 180); } else cur = (cur ? cur + ' ' : '') + p;
  }
  if (cur) out.push(cur);
  return out.slice(0, 4);
}

async function tts(text, lang, gender) {
  const k = keys();
  try { return await edgeTts(text, lang, gender); } catch (_) { /* cae a la voz de Google */ }
  if (process.env.VOICE_TTS === 'openai' && k.openai) {
    const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + k.openai, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3' }) });
    if (!r.ok) throw new Error('tts ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lang) + '&q=' + encodeURIComponent(text);
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('tts ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function speak(s, text, lang, gender) {
  s.speaking = true;
  try {
    // Genera todos los trozos a la vez y los reproduce en orden (menos espera entre frases)
    const jobs = chunks(text).map((c) => tts(c, lang, gender));
    for (const job of jobs) {
      const mp3 = await job;
      const res = V.createAudioResource(Readable.from(mp3), { inputType: V.StreamType.Arbitrary });
      s.player.play(res);
      await V.entersState(s.player, V.AudioPlayerStatus.Playing, 5000).catch(() => {});
      await V.entersState(s.player, V.AudioPlayerStatus.Idle, 30000).catch(() => {});
    }
  } finally {
    s.speaking = false;
  }
}

/* ============================ escuchar ============================ */
async function onUtterance(s, guild, userId, pcm) {
  const cfg = getCfg(guild.id);
  if (!cfg.voice.enabled || s.busy) return;
  const bytes = pcm.length;
  if (bytes < 48000 * 4 * 0.7 || bytes > 48000 * 4 * 25 || !loud(pcm)) return;
  // límite por usuario: 6 frases por minuto
  const now = Date.now();
  const hist = (s.rate.get(userId) || []).filter((t) => now - t < 60000);
  if (hist.length >= 6) return;
  hist.push(now);
  s.rate.set(userId, hist);

  s.busy = true;
  s.last = now;
  try {
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    const who = member ? member.displayName : 'someone';
    const text = await transcribe(pcm, cfg.voice.lang);
    if (text.length < 2 || /^(\W|\s)*$/.test(text)) return;
    const answer = await think(s, who, text, cfg);
    if (!answer) return;
    if (cfg.voice.transcript && s.textChannelId) {
      const ch = guild.channels.cache.get(s.textChannelId);
      if (ch) ch.send({ content: '🎤 **' + who.replace(/[*_`@]/g, '') + ':** ' + text.slice(0, 300) + '\n🤖 ' + answer.slice(0, 400), allowedMentions: { parse: [] } }).catch(() => {});
    }
    await speak(s, answer, cfg.voice.lang, cfg.voice.gender);
  } catch (e) {
    if (e.message === 'no-stt' || e.message === 'no-brain') {
      const ch = s.textChannelId && guild.channels.cache.get(s.textChannelId);
      if (ch && !s.warnedKeys) {
        s.warnedKeys = true;
        ch.send('⚠️ ' + L(guild.preferredLocale, 'I can hear you but I am missing API keys. The server owner must set `GROQ_API_KEY` (free) or `OPENAI_API_KEY` in the bot host.', 'Te oigo pero me faltan claves. El dueño del bot debe poner `GROQ_API_KEY` (gratis) u `OPENAI_API_KEY` en el hosting.')).catch(() => {});
      }
    } else {
      logErr(e);
    }
  } finally {
    s.busy = false;
  }
}

function listen(s, guild) {
  const receiver = s.conn.receiver;
  receiver.speaking.on('start', (userId) => {
    if (s.active.has(userId) || s.speaking) return;
    const m = guild.members.cache.get(userId);
    if (m && m.user.bot) return;
    s.active.add(userId);
    const opus = receiver.subscribe(userId, { end: { behavior: V.EndBehaviorType.AfterSilence, duration: 1100 } });
    const dec = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const bufs = [];
    let total = 0;
    const finish = () => {
      if (!s.active.has(userId)) return;
      s.active.delete(userId);
      onUtterance(s, guild, userId, Buffer.concat(bufs)).catch(logErr);
    };
    opus.on('error', () => { s.active.delete(userId); });
    dec.on('error', () => { s.active.delete(userId); });
    dec.on('data', (c) => { total += c.length; if (total < 48000 * 4 * 26) bufs.push(c); });
    dec.on('end', finish);
    opus.pipe(dec);
  });
}

/* ============================ entrar / salir ============================ */
function leave(guildId) {
  const s = sessions.get(guildId);
  if (!s) return false;
  clearInterval(s.timer);
  try { s.player.stop(true); } catch (_) {}
  try { s.conn.destroy(); } catch (_) {}
  sessions.delete(guildId);
  return true;
}

async function join(i) {
  const cfg = getCfg(i.guild.id);
  const lc = i.locale;
  if (!V || !prism) return i.reply({ content: L(lc, '❌ Voice is not installed on this host yet (missing libraries).', '❌ El soporte de voz no está instalado en este hosting todavía (faltan librerías).'), flags: EPH });
  if (!cfg.voice.enabled) return i.reply({ content: L(lc, '🔇 Voice chat is turned off in this server.', '🔇 El chat de voz está apagado en este servidor.'), flags: EPH });
  const vc = i.member.voice && i.member.voice.channel;
  if (!vc) return i.reply({ content: L(lc, '🎙️ Join a voice channel first, then use /putbot.', '🎙️ Entra primero a un canal de voz y luego usa /putbot.'), flags: EPH });
  const perms = vc.permissionsFor(i.guild.members.me);
  if (!perms || !perms.has([P.Connect, P.Speak, P.ViewChannel])) return i.reply({ content: L(lc, '❌ I need the **Connect** and **Speak** permissions in that channel.', '❌ Necesito los permisos **Conectar** y **Hablar** en ese canal.'), flags: EPH });

  await i.deferReply();
  leave(i.guild.id);
  const conn = V.joinVoiceChannel({ channelId: vc.id, guildId: i.guild.id, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  try {
    await V.entersState(conn, V.VoiceConnectionStatus.Ready, 20000);
  } catch (e) {
    try { conn.destroy(); } catch (_) {}
    return i.editReply(L(lc, '❌ I could not connect to the voice channel.', '❌ No pude conectarme al canal de voz.'));
  }
  const player = V.createAudioPlayer();
  conn.subscribe(player);
  const s = { conn, player, history: [], active: new Set(), rate: new Map(), busy: false, speaking: false, last: Date.now(), textChannelId: i.channelId, channelId: vc.id };
  sessions.set(i.guild.id, s);
  conn.on(V.VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([V.entersState(conn, V.VoiceConnectionStatus.Signalling, 5000), V.entersState(conn, V.VoiceConnectionStatus.Connecting, 5000)]);
    } catch (_) {
      leave(i.guild.id);
    }
  });
  // Se va solo si lleva 10 minutos sin que nadie le hable o se queda solo
  s.timer = setInterval(() => {
    const ch = i.guild.channels.cache.get(s.channelId);
    const humans = ch ? ch.members.filter((m) => !m.user.bot).size : 0;
    if (!humans || Date.now() - s.last > 10 * 60000) leave(i.guild.id);
  }, 30000);
  listen(s, i.guild);

  const lang = LANGS[cfg.voice.lang] || LANGS.es;
  const k = keys();
  const e = new EmbedBuilder().setColor(COLOR.green).setTitle('🎙️ ' + L(lc, 'Connected to ', 'Conectado a ') + vc.name)
    .setDescription(L(lc, 'Talk and I will answer out loud. Language: **' + lang.name + '** (change it with `/setidioma`).', 'Habla y te responderé en voz alta. Idioma: **' + lang.name + '** (cámbialo con `/setidioma`).')
      + (!k.stt || !k.brain ? '\n\n⚠️ ' + L(lc, 'Missing API keys: set `GROQ_API_KEY` (free) or `OPENAI_API_KEY` in the host so I can hear and answer.', 'Faltan claves: pon `GROQ_API_KEY` (gratis) u `OPENAI_API_KEY` en el hosting para que pueda oír y responder.') : ''));
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('vb:leave').setLabel(L(lc, 'Leave', 'Salir')).setEmoji('👋').setStyle(ButtonStyle.Secondary));
  await i.editReply({ embeds: [e], components: [row] });
  if (k.stt && k.brain) {
    s.busy = true;
    speak(s, L(lc, 'Hey! I am here. What is up?', '¡Ey, hola! Ya estoy aquí. ¿Qué cuentas?'), cfg.voice.lang, cfg.voice.gender).catch(() => {}).finally(() => { s.busy = false; });
  }
}

/* ============================ comandos ============================ */
const putbot = {
  data: new SlashCommandBuilder().setName('putbot').setDescription('Bring the bot to your voice channel to talk with it')
    .setDescriptionLocalizations({ 'es-ES': 'Mete al bot en tu canal de voz para hablar con él', 'es-419': 'Mete al bot en tu canal de voz para hablar con él' }).setDMPermission(false),
  async execute(i) { if (i.guild) return join(i); },
};

const setidioma = {
  data: new SlashCommandBuilder().setName('setidioma').setDescription('Set the language the bot listens and speaks in')
    .setDescriptionLocalizations({ 'es-ES': 'Elige el idioma en el que el bot te escucha y habla', 'es-419': 'Elige el idioma en el que el bot te escucha y habla' })
    .setDMPermission(false)
    .addStringOption((o) => o.setName('idioma').setDescription('Language').setRequired(true).addChoices(...Object.entries(LANGS).map(([v, l]) => ({ name: l.name, value: v }))))
    .addStringOption((o) => o.setName('voz').setDescription('Voice').addChoices({ name: 'Femenina / Female', value: 'female' }, { name: 'Masculina / Male', value: 'male' })),
  async execute(i) {
    if (!i.guild) return;
    const lc = i.locale;
    const cfg = getCfg(i.guild.id);
    if (!canConfigure(i.guild, i.user.id, i.member)) {
      return i.reply({ content: cfg.maxSecurity ? lockedMsg(lc) : L(lc, '❌ You need the **Manage Server** permission.', '❌ Necesitas el permiso **Gestionar servidor**.'), flags: EPH });
    }
    const v = i.options.getString('idioma');
    cfg.voice.lang = v;
    const g = i.options.getString('voz');
    if (g) cfg.voice.gender = g;
    saveCfg();
    return i.reply({ content: '🌐 ' + L(lc, 'Voice language set to ', 'Idioma de voz: ') + '**' + LANGS[v].name + '**' + (g ? ' · ' + (g === 'male' ? '🧔' : '👩') : ''), flags: EPH });
  },
};

async function handleComponent(i) {
  if (i.customId !== 'vb:leave') return false;
  if (!i.guild) return true;
  const s = sessions.get(i.guild.id);
  const inVoice = s && i.member.voice && i.member.voice.channelId === s.channelId;
  if (!s) return (await i.update({ components: [] }), true);
  if (!inVoice && !canConfigure(i.guild, i.user.id, i.member)) {
    await i.reply({ content: L(i.locale, '❌ Join my voice channel to make me leave.', '❌ Entra a mi canal de voz para que me vaya.'), flags: EPH });
    return true;
  }
  leave(i.guild.id);
  await i.update({ components: [] });
  return true;
}

module.exports = { commands: [putbot, setidioma], handleComponent, mods, leave };
