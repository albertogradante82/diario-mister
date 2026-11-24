// Iscrizione alle notifiche: giocatori verificati (con PIN) e mister (con password).
//
// Redis: push:subs  hash sha(endpoint) -> JSON { sub, role: 'giocatore'|'mister', playerId, teamId, at }
const { redisConfig, pipeline, sha, isAdmin, ip, send, readBody, limited, authPlayer, parPinHash, safeEq, roster } = require('./_lib.js');
const { vapidKeys, notify } = require('./_push.js');

const PID = /^imp-[0-9a-f]{16}$/;

async function teamOf(req, playerId) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = /^(localhost|127\.)/.test(host) ? 'http' : 'https';
    const pub = await (await fetch(`${proto}://${host}/dati/pubblico.json`)).json();
    return pub.players.find((p) => p.id === playerId)?.teamId || '';
  } catch { return ''; }
}

function validSub(s) {
  return s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Notifiche non attive: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'key';

    if (req.method === 'GET' && action === 'key') {
      return send(res, 200, { publicKey: (await vapidKeys(cfg)).publicKey });
    }

    if (req.method === 'POST' && action === 'subscribe') {
      if (await limited(cfg, `rl:push:${ip(req)}`, 30, 3600)) return send(res, 429, { error: 'Troppe richieste.' });
      const b = await readBody(req);
      if (!validSub(b.sub)) return send(res, 400, { error: 'Iscrizione non valida.' });
      let rec;
      if (b.role === 'mister') {
        if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });
        rec = { role: 'mister', playerId: '', teamId: '' };
      } else if (b.parentId) {
        // genitore: riceve le notifiche di tutti i figli collegati
        if (!/^g-[0-9a-f]{16}$/.test(String(b.parentId)) || !/^\d{4,6}$/.test(String(b.parentPin || ''))) return send(res, 400, { error: 'Accedi prima come genitore.' });
        const [stored, raw] = await pipeline(cfg, [['HGET', 'par:pin', b.parentId], ['HGET', 'par:list', b.parentId]]);
        if (!stored || !raw || !safeEq(stored, parPinHash(b.parentId, String(b.parentPin)))) return send(res, 403, { error: 'PIN errato.' });
        const kids = JSON.parse(raw).children.filter((c) => c.status === 'ok').map((c) => c.playerId);
        const r = await roster(req);
        rec = { role: 'genitore', parentId: b.parentId, playerId: '', teamId: '', players: kids, teams: [...new Set(kids.map((k) => r.players[k]?.teamId).filter(Boolean))] };
      } else {
        const a = await authPlayer(cfg, b.playerId, b.pin);
        if (a.error) return send(res, a.status, { error: a.error });
        rec = { role: 'giocatore', playerId: b.playerId, teamId: await teamOf(req, b.playerId) };
      }
      const key = sha(b.sub.endpoint);
      await pipeline(cfg, [['HSET', 'push:subs', key, JSON.stringify({ ...rec, sub: { endpoint: b.sub.endpoint, keys: b.sub.keys }, at: Date.now() })]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'unsubscribe') {
      const b = await readBody(req);
      if (b.endpoint) await pipeline(cfg, [['HDEL', 'push:subs', sha(b.endpoint)]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'test') {
      // notifica di prova al solo dispositivo che la chiede
      const b = await readBody(req);
      if (!b.endpoint) return send(res, 400, { error: 'Manca il dispositivo.' });
      const [raw] = await pipeline(cfg, [['HGET', 'push:subs', sha(b.endpoint)]]);
      if (!raw) return send(res, 404, { error: 'Dispositivo non iscritto.' });
      const s = JSON.parse(raw);
      const n = await notify(cfg, { keys: [sha(b.endpoint)] },
        { title: '⚽ Calcio Palazzo', body: 'Le notifiche funzionano! 🎉', url: s.role === 'mister' ? './#/home' : './#/g/bacheca', tag: 'test' });
      return send(res, 200, { sent: n });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
