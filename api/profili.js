// Schede compilate dai giocatori: foto e data di nascita (visibili a tutti nell'app),
// cellulare ed email (visibili solo all'amministratore con password).
//
// Richiede il database Upstash Redis collegato al progetto Vercel
// (variabili KV_REST_API_URL / KV_REST_API_TOKEN create automaticamente da Vercel → Storage).
//
// Redis:
//   prof:pub    hash id -> JSON {birthDate, hasPhoto, updatedAt}
//   prof:photo  hash id -> data URL JPEG
//   prof:priv   hash id -> JSON {phone, email, updatedAt}
//   prof:pin    hash id -> sha256 del PIN scelto dal ragazzo

const crypto = require('crypto');

// impronta SHA-256 di "mister-admin:<password admin>" (la stessa usata dall'app)
const ADMIN_HASH = process.env.ADMIN_HASH || '4e2b675ce189f521819362d26a421185528c788a0f7a1293108df1c50d13b4f6';
const ID_RE = /^imp-[0-9a-f]{16}$/;
const MAX_PHOTO = 150_000;

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
function safeEq(a, b) {
  return crypto.timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
}
const isAdmin = (req) => safeEq(sha('mister-admin:' + String(req.headers['x-admin-code'] || '').trim()), ADMIN_HASH);
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

function clean(body) {
  const out = {};
  const bd = String(body.birthDate || '').trim();
  if (bd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || bd < '1990-01-01' || bd > '2025-12-31') throw new Error('Data di nascita non valida.');
    out.birthDate = bd;
  }
  const phone = String(body.phone || '').trim();
  if (phone && !/^\+?[0-9 ]{6,20}$/.test(phone)) throw new Error('Numero di cellulare non valido.');
  out.phone = phone;
  const email = String(body.email || '').trim().toLowerCase();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) throw new Error('Email non valida.');
  out.email = email;
  if (body.photo != null && body.photo !== '') {
    const p = String(body.photo);
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) || p.length > MAX_PHOTO) throw new Error('Foto non valida o troppo grande.');
    out.photo = p;
  } else if (body.photo === '') out.photo = '';
  return out;
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio schede non ancora attivo: collega il database su Vercel.' });
    const url = new URL(req.url, 'http://x');
    const action = url.searchParams.get('action') || 'list';

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'prof:pub']]);
      const profiles = {};
      for (let i = 0; i < (all || []).length; i += 2) profiles[all[i]] = JSON.parse(all[i + 1]);
      return send(res, 200, { profiles });
    }

    if (req.method === 'GET' && action === 'photo') {
      const id = url.searchParams.get('id') || '';
      if (!ID_RE.test(id)) return send(res, 400, { error: 'Id non valido' });
      const [photo] = await pipeline(cfg, [['HGET', 'prof:photo', id]]);
      return send(res, 200, { photo: photo || null });
    }

    if (req.method === 'GET' && action === 'private') {
      if (await limited(cfg, `rl:adm:${ip(req)}`, 30, 900)) return send(res, 429, { error: 'Troppi tentativi, riprova più tardi.' });
      if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });
      const [all] = await pipeline(cfg, [['HGETALL', 'prof:priv']]);
      const profiles = {};
      for (let i = 0; i < (all || []).length; i += 2) profiles[all[i]] = JSON.parse(all[i + 1]);
      return send(res, 200, { profiles });
    }

    if (req.method === 'POST' && action === 'save') {
      if (await limited(cfg, `rl:save:${ip(req)}`, 40, 3600)) return send(res, 429, { error: 'Troppi invii, riprova più tardi.' });
      const body = await readBody(req);
      const id = String(body.id || '');
      const pin = String(body.pin || '').trim();
      if (!ID_RE.test(id)) return send(res, 400, { error: 'Giocatore non valido.' });
      if (!/^\d{4,6}$/.test(pin)) return send(res, 400, { error: 'Il PIN deve avere da 4 a 6 cifre.' });
      if (body.consent !== true) return send(res, 400, { error: 'Serve il consenso al trattamento dei dati.' });
      if (await limited(cfg, `rl:pin:${id}`, 10, 3600)) return send(res, 429, { error: 'Troppi tentativi con il PIN: riprova tra un\'ora o chiedi al mister di azzerarlo.' });
      const [stored, oldPubRaw] = await pipeline(cfg, [['HGET', 'prof:pin', id], ['HGET', 'prof:pub', id]]);
      if (stored && !safeEq(stored, pinHash(id, pin))) return send(res, 403, { error: 'PIN errato. Se l\'hai dimenticato chiedi al mister di azzerarlo.' });
      let data;
      try { data = clean(body); } catch (e) { return send(res, 400, { error: e.message }); }
      const oldPub = oldPubRaw ? JSON.parse(oldPubRaw) : {};
      const now = Date.now();
      const hasPhoto = data.photo === undefined ? !!oldPub.hasPhoto : !!data.photo;
      const cmds = [
        ['HSET', 'prof:pub', id, JSON.stringify({ birthDate: data.birthDate || '', hasPhoto, updatedAt: now })],
        ['HSET', 'prof:priv', id, JSON.stringify({ phone: data.phone, email: data.email, updatedAt: now })],
      ];
      if (!stored) cmds.push(['HSET', 'prof:pin', id, pinHash(id, pin)]);
      if (data.photo) cmds.push(['HSET', 'prof:photo', id, data.photo]);
      if (data.photo === '') cmds.push(['HDEL', 'prof:photo', id]);
      await pipeline(cfg, cmds);
      return send(res, 200, { ok: true, newPin: !stored });
    }

    if (req.method === 'POST' && action === 'resetpin') {
      if (await limited(cfg, `rl:adm:${ip(req)}`, 30, 900)) return send(res, 429, { error: 'Troppi tentativi, riprova più tardi.' });
      if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });
      const { id } = await readBody(req);
      if (!ID_RE.test(String(id))) return send(res, 400, { error: 'Id non valido' });
      await pipeline(cfg, [['HDEL', 'prof:pin', id], ['DEL', `rl:pin:${id}`]]);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
