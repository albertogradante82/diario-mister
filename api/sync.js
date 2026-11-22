// Archivio condiviso: funzione serverless Vercel + database Upstash Redis (REST).
//
// Variabili d'ambiente (Vercel → Settings → Environment Variables):
//   ACCESS_CODE                          codice segreto da dare ai mister
//   KV_REST_API_URL / KV_REST_API_TOKEN  (create in automatico da Vercel → Storage → Upstash Redis)
//   oppure UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//
// Modello dati in Redis:
//   rec:<store>   hash  id -> JSON del record (i record eliminati restano come {id,_deleted:true,updatedAt})
//   changes       zset  "<store>:<id>" con punteggio = numero progressivo di modifica
//   seq           contatore delle modifiche
//   fail:<ip>     tentativi di accesso errati (blocco temporaneo)

const crypto = require('crypto');

const STORES = ['teams', 'seasons', 'players', 'matches', 'events', 'tracking'];
const PAGE = 400;
const MAX_FAILS = 20;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function pipeline(cfg, commands) {
  if (!commands.length) return [];
  const r = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Database: errore ${r.status}`);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error(`Database: ${x.error}`);
    return x.result;
  });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

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

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    const code = process.env.ACCESS_CODE;
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || 'ping';

    if (!cfg || !code) {
      return send(res, 503, { error: 'Archivio condiviso non configurato sul server (manca il database o ACCESS_CODE).' });
    }

    // Controllo codice con blocco dopo troppi tentativi errati
    const ip = clientIp(req);
    const failKey = `fail:${ip}`;
    const [fails] = await pipeline(cfg, [['GET', failKey]]);
    if (Number(fails || 0) >= MAX_FAILS) {
      return send(res, 429, { error: 'Troppi tentativi errati. Riprova tra 15 minuti.' });
    }
    if (!safeEqual(req.headers['x-access-code'] || '', code)) {
      await pipeline(cfg, [['INCR', failKey], ['EXPIRE', failKey, 900]]);
      return send(res, 401, { error: 'Codice di accesso errato.' });
    }

    if (action === 'ping') {
      const [seq] = await pipeline(cfg, [['GET', 'seq']]);
      return send(res, 200, { ok: true, seq: Number(seq || 0) });
    }

    if (action === 'pull' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const [members] = await pipeline(cfg, [['ZRANGEBYSCORE', 'changes', `(${since}`, '+inf', 'WITHSCORES', 'LIMIT', '0', String(PAGE)]]);
      const pairs = [];
      for (let i = 0; i < members.length; i += 2) pairs.push([members[i], Number(members[i + 1])]);
      const byStore = {};
      pairs.forEach(([m]) => {
        const idx = m.indexOf(':');
        const store = m.slice(0, idx), id = m.slice(idx + 1);
        (byStore[store] = byStore[store] || []).push(id);
      });
      const stores = Object.keys(byStore).filter((s) => STORES.includes(s));
      const results = await pipeline(cfg, stores.map((s) => ['HMGET', `rec:${s}`, ...byStore[s]]));
      const items = [];
      stores.forEach((s, i) => {
        (results[i] || []).forEach((json) => { if (json) items.push({ store: s, record: JSON.parse(json) }); });
      });
      const cursor = pairs.length ? pairs[pairs.length - 1][1] : since;
      return send(res, 200, { items, cursor, more: pairs.length === PAGE });
    }

    if (action === 'push' && req.method === 'POST') {
      const body = await readBody(req);
      const changes = Array.isArray(body.changes) ? body.changes : [];
      const valid = changes.filter((c) => c && STORES.includes(c.store) && c.record && typeof c.record.id === 'string' && c.record.id.length < 100);
      if (!valid.length) return send(res, 200, { applied: 0, skipped: 0 });

      // Legge le versioni attuali per tenere la modifica più recente (last-write-wins)
      const byStore = {};
      valid.forEach((c) => (byStore[c.store] = byStore[c.store] || []).push(c));
      const stores = Object.keys(byStore);
      const current = await pipeline(cfg, stores.map((s) => ['HMGET', `rec:${s}`, ...byStore[s].map((c) => c.record.id)]));
      const toWrite = [];
      stores.forEach((s, i) => {
        byStore[s].forEach((c, j) => {
          const old = current[i][j] ? JSON.parse(current[i][j]) : null;
          if (old && Number(old.updatedAt || 0) > Number(c.record.updatedAt || 0)) return;
          toWrite.push(c);
        });
      });
      if (toWrite.length) {
        const [last] = await pipeline(cfg, [['INCRBY', 'seq', toWrite.length]]);
        let n = Number(last) - toWrite.length;
        const cmds = [];
        toWrite.forEach((c) => {
          n += 1;
          const rec = { ...c.record, serverSeq: n };
          cmds.push(['HSET', `rec:${c.store}`, rec.id, JSON.stringify(rec)]);
          cmds.push(['ZADD', 'changes', n, `${c.store}:${rec.id}`]);
        });
        await pipeline(cfg, cmds);
      }
      return send(res, 200, { applied: toWrite.length, skipped: valid.length - toWrite.length });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
