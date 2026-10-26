'use strict';

/*
 * dbstore.js — guardado permanente en Postgres (opcional: solo si existe DATABASE_URL).
 *
 * El bot sigue trabajando con archivos en DATA_DIR (como siempre). Este módulo:
 *   · al ARRANCAR (start.js): baja de la base todos los datos a esos archivos (configuraciones, economía, colecciones…)
 *   · al GUARDAR (jsonStore): copia cada archivo a la base unos segundos después
 * Así los datos sobreviven a los reinicios y a los despliegues en hostings sin disco (Render gratis, etc.).
 *
 * Seguridad de los datos: si no se pudo LEER la base al arrancar, no se escribe nada en ella
 * (para no pisar los datos buenos con un estado vacío).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const URL = process.env.DATABASE_URL || '';
const WAIT = 2500; // ms entre el último guardado y la copia a la base

let pool = null;
let ready = false; // solo se escribe en la base si se pudo leer al arrancar
let aborted = false;
const timers = new Map(); // nombre -> temporizador
const latest = new Map(); // nombre -> { text, bin }

const enabled = () => !!URL;

function getPool() {
  if (!URL) return null;
  if (!pool) {
    const { Pool } = require('pg');
    const ssl = /sslmode=/.test(URL) ? undefined : /\.render\.com|neon\.tech|supabase|amazonaws|aivencloud/.test(URL) ? { rejectUnauthorized: false } : false;
    pool = new Pool({ connectionString: URL, ssl, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    pool.on('error', (e) => console.log('[datos] error de la base: ' + e.message));
  }
  return pool;
}

const safePath = (rel) => {
  const file = path.resolve(DATA_DIR, rel);
  return file.startsWith(path.resolve(DATA_DIR) + path.sep) ? file : null;
};

async function upsert(name, text) {
  await getPool().query('INSERT INTO kv (name, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [name, text]);
}

// Se llama una vez al arrancar, antes de cargar el bot
async function restore() {
  if (!URL) { console.log('[datos] sin DATABASE_URL: los datos solo se guardan en el disco del servidor'); return; }
  const p = getPool();
  await p.query('CREATE TABLE IF NOT EXISTS kv (name text PRIMARY KEY, data text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await p.query('SELECT name, data FROM kv');
  if (aborted) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const have = new Set();
  let n = 0;
  for (const r of rows) {
    have.add(r.name);
    const isFile = r.name.startsWith('file:');
    const file = safePath(isFile ? r.name.slice(5) : r.name);
    if (!file) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, isFile ? Buffer.from(r.data, 'base64') : r.data);
    n++;
  }
  // Archivos locales que aún no están en la base (primera vez con la base): se suben
  let up = 0;
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!/\.json$/.test(f) || have.has(f)) continue;
      await upsert(f, fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      up++;
    }
  } catch (e) { console.log('[datos] no se pudieron subir los archivos locales: ' + e.message); }
  if (aborted) return;
  ready = true;
  console.log('[datos] base conectada: ' + n + ' archivos restaurados' + (up ? ', ' + up + ' locales subidos' : ''));
}

function abort() { aborted = true; }

function schedule(name, value) {
  if (!ready) return;
  latest.set(name, value);
  clearTimeout(timers.get(name));
  const t = setTimeout(() => push(name).catch(() => {}), WAIT);
  if (t.unref) t.unref();
  timers.set(name, t);
}

async function push(name) {
  const v = latest.get(name);
  if (!v) return;
  latest.delete(name);
  timers.delete(name);
  try { await upsert(name, v.bin ? v.bin.toString('base64') : v.text); } catch (e) { console.log('[datos] no se pudo guardar ' + name + ' en la base: ' + e.message); }
}

// Copia de un archivo de datos de texto (jsonStore)
function mirror(name, text) { schedule(name, { text }); }
// Copia de un archivo binario (imágenes de camisetas propias), ruta relativa a DATA_DIR
function mirrorFile(rel, buf) { schedule('file:' + rel, { bin: buf }); }
async function removeFile(rel) {
  if (!ready) return;
  try { await getPool().query('DELETE FROM kv WHERE name = $1', ['file:' + rel]); } catch (e) { console.log('[datos] no se pudo borrar ' + rel + ': ' + e.message); }
}

// Al apagar el servidor: termina de copiar lo pendiente
async function flush() {
  if (!ready) return;
  for (const t of timers.values()) clearTimeout(t);
  await Promise.race([Promise.all([...latest.keys()].map((n) => push(n))), new Promise((r) => setTimeout(r, 6000))]);
}

module.exports = { enabled, restore, abort, mirror, mirrorFile, removeFile, flush };
