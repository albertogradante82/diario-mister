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

const hashToObj = (arr) => {
  const o = {};
  for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};

module.exports = { redisConfig, pipeline, sha, pinHash, safeEq, isAdmin, ip, send, readBody, limited, hashToObj };
