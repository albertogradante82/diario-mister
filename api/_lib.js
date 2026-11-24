// Funzioni comuni alle API (i file che iniziano con "_" non diventano indirizzi pubblici su Vercel).
const crypto = require('crypto');

const ADMIN_HASH = process.env.ADMIN_HASH || '4e2b675ce189f521819362d26a421185528c788a0f7a1293108df1c50d13b4f6';

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function pipeline(cfg, commands) {
  const r = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Database: errore ${r.status}`);
  return (await r.json()).map((x) => { if (x.error) throw new Error(`Database: ${x.error}`); return x.result; });
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const pinHash = (id, pin) => sha(`mister-pin:${id}:${pin}`);
const safeEq = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
const SUPER_HASH = process.env.SUPER_HASH || 'f99f6bcc0a13f307b83f0a13961d457ca2fd0b87ea9cf05156dc1422f89b1e67';
/** Amministratore (seconda password): pagamenti, documenti, certificati, contatti completi. */
const isSuper = (req) => safeEq(sha('mister-super:' + String(req.headers['x-super-code'] || '').trim()), SUPER_HASH);
/** Oscura gli ultimi 3 caratteri (cellulari, email, codici) per chi non è amministratore. */
const maskTail = (v) => { v = String(v || ''); return v.length > 3 ? v.slice(0, -3) + '•••' : v ? '•••' : ''; };
const isMisterOnly = (req) => safeEq(sha('mister-admin:' + String(req.headers['x-admin-code'] || '').trim()), ADMIN_HASH);
const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function limited(cfg, key, max, seconds) {
  const [n] = await pipeline(cfg, [['INCR', key], ['EXPIRE', key, seconds]]);
  return Number(n) > max;
}

const hashToObj = (arr) => {
  const o = {};
  for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};

const parPinHash = (id, pin) => sha(`mister-par-pin:${id}:${pin}`);
const PLAYER_ID = /^imp-[0-9a-f]{16}$/;
const PAR_PIN = /^par:(g-[0-9a-f]{16}):(\d{4,6})$/;

/**
 * Chi agisce per un giocatore: il giocatore con il suo PIN, oppure un genitore collegato
 * (in quel caso il "pin" è "par:<idGenitore>:<pinGenitore>").
 * Restituisce { who } oppure { error, status }.
 */
async function authPlayer(cfg, playerId, pin) {
  pin = String(pin || '');
  if (!PLAYER_ID.test(String(playerId))) return { error: 'Giocatore non valido.', status: 400 };
  const m = pin.match(PAR_PIN);
  if (m) {
    const [, gid, gpin] = m;
    if (await limited(cfg, `rl:gpin:${gid}`, 60, 3600)) return { error: 'Troppi tentativi con il PIN: riprova tra un\'ora.', status: 429 };
    const [stored, raw] = await pipeline(cfg, [['HGET', 'par:pin', gid], ['HGET', 'par:list', gid]]);
    if (!stored || !raw || !safeEq(stored, parPinHash(gid, gpin))) return { error: 'PIN del genitore errato.', status: 403 };
    const g = JSON.parse(raw);
    if (!(g.children || []).some((c) => c.playerId === playerId && c.status === 'ok')) return { error: 'Questo giocatore non è ancora collegato al tuo profilo genitore (in attesa di conferma del mister).', status: 403 };
    return { who: { role: 'genitore', parentId: gid, name: `${g.firstName} ${g.lastName}`.trim() } };
  }
  if (!/^\d{4,6}$/.test(pin)) return { error: 'PIN non valido.', status: 400 };
  if (await limited(cfg, `rl:pin:${playerId}`, 30, 3600)) return { error: 'Troppi tentativi con il PIN: riprova tra un\'ora.', status: 429 };
  const [stored] = await pipeline(cfg, [['HGET', 'prof:pin', playerId]]);
  if (!stored) return { error: 'Prima compila la tua scheda giocatore e scegli un PIN.', status: 404 };
  if (!safeEq(stored, pinHash(playerId, pin))) return { error: 'PIN errato.', status: 403 };
  return { who: { role: 'giocatore' } };
}

/** Nomi dei giocatori e squadre dal file pubblico (con cache di 10 minuti). */
let rosterCache = null, rosterAt = 0;
async function roster(req) {
  if (rosterCache && Date.now() - rosterAt < 600000) return rosterCache;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = /^(localhost|127\.)/.test(host) ? 'http' : 'https';
    const d = await (await fetch(`${proto}://${host}/dati/pubblico.json`)).json();
    rosterCache = { players: Object.fromEntries(d.players.map((p) => [p.id, p])), teams: Object.fromEntries(d.teams.map((t) => [t.id, t])) };
    rosterAt = Date.now();
  } catch { if (!rosterCache) rosterCache = { players: {}, teams: {} }; }
  return rosterCache;
}

/** Registro delle attività (documenti, ricevute, fatture, richieste) mostrato al mister in bacheca. */
async function logActivity(cfg, item) {
  try { await pipeline(cfg, [['LPUSH', 'act:log', JSON.stringify({ ...item, at: Date.now() })], ['LTRIM', 'act:log', 0, 199]]); } catch { /* non blocca */ }
}

const isAdmin = (req) => isMisterOnly(req) || isSuper(req);

module.exports = { isSuper, maskTail, logActivity, redisConfig, pipeline, sha, pinHash, parPinHash, safeEq, isAdmin, ip, send, readBody, limited, hashToObj, authPlayer, roster };
