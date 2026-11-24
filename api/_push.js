// Notifiche Web Push (RFC 8291 + VAPID RFC 8292) senza librerie esterne.
// Le chiavi VAPID vengono generate al primo uso e conservate nel database (mai nel codice).
const crypto = require('crypto');
const { pipeline, hashToObj } = require('./_lib.js');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function vapidKeys(cfg) {
  const [raw] = await pipeline(cfg, [['GET', 'push:vapid']]);
  if (raw) return JSON.parse(raw);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const keys = {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(pubJwk.x), fromB64u(pubJwk.y)])),
    privateJwk: privateKey.export({ format: 'jwk' }),
  };
  // SETNX: se due richieste generano insieme, vince la prima
  await pipeline(cfg, [['SETNX', 'push:vapid', JSON.stringify(keys)]]);
  const [again] = await pipeline(cfg, [['GET', 'push:vapid']]);
  return JSON.parse(again);
}

function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:noreply@diario-mister.vercel.app' }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

/** Cifra il messaggio per l'abbonamento (aes128gcm, RFC 8291). */
function encrypt(sub, payload) {
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

async function sendOne(cfg, keys, sub, payload) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: vapidHeader(sub.endpoint, keys) },
    body: encrypt(sub, JSON.stringify(payload)),
    signal: AbortSignal.timeout(8000),
  });
  return r.status;
}

/**
 * Invia una notifica agli abbonati che corrispondono al filtro.
 * filter: { players?: [ids], teams?: [teamIds], all?: true, mister?: true, keys?: [sha(endpoint)] }
 */
async function notify(cfg, filter, payload) {
  try {
    const [all] = await pipeline(cfg, [['HGETALL', 'push:subs']]);
    const subs = Object.entries(hashToObj(all)).map(([k, j]) => [k, JSON.parse(j)]);
    const targets = subs.filter(([k, s]) => {
      if (filter.keys) return filter.keys.includes(k);
      if (filter.mister) return s.role === 'mister';
      if (s.role === 'mister') return false;
      if (filter.all) return true;
      const ps = [s.playerId, ...(s.players || [])].filter(Boolean);
      const ts = [s.teamId, ...(s.teams || [])].filter(Boolean);
      if (filter.players && ps.some((p) => filter.players.includes(p))) return true;
      if (filter.teams && ts.some((t) => filter.teams.includes(t))) return true;
      return false;
    });
    if (!targets.length) return 0;
    const keys = await vapidKeys(cfg);
    const dead = [];
    await Promise.all(targets.map(async ([k, s]) => {
      try {
        const st = await sendOne(cfg, keys, s.sub, payload);
        if (st === 404 || st === 410) dead.push(k);
      } catch { /* rete: riproverà al prossimo invio */ }
    }));
    if (dead.length) await pipeline(cfg, [['HDEL', 'push:subs', ...dead]]);
    return targets.length - dead.length;
  } catch { return 0; }
}

const GG = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
/** "gio 27/11 ore 15:30" */
function quando(date, time) {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00Z');
  return `${GG[d.getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}${time ? ' ore ' + time : ''}`;
}

module.exports = { vapidKeys, notify, quando };
