// Convocazioni (partite e allenamenti) con risposta dei giocatori: "ci sono" / "non ci sono".
//
// Redis:
//   conv:list        hash convId -> JSON convocazione
//   conv:resp:<id>   hash playerId -> JSON { r: 'si'|'no', note, at }
const crypto = require('crypto');
const { redisConfig, pipeline, pinHash, safeEq, isAdmin, ip, send, readBody, limited, hashToObj } = require('./_lib.js');

const PID = /^imp-[0-9a-f]{16}$/;
const CID = /^c-[0-9a-f]{16}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);

async function checkPin(cfg, playerId, pin) {
  if (!PID.test(String(playerId)) || !/^\d{4,6}$/.test(String(pin || ''))) return 'PIN non valido.';
  if (await limited(cfg, `rl:pin:${playerId}`, 40, 3600)) return 'Troppi tentativi con il PIN: riprova tra un\'ora.';
  const [stored] = await pipeline(cfg, [['HGET', 'prof:pin', playerId]]);
  if (!stored) return 'Prima compila la tua scheda giocatore.';
  if (!safeEq(stored, pinHash(playerId, String(pin)))) return 'PIN errato.';
  return null;
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Convocazioni non attive: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'list';

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'conv:list']]);
      const items = Object.values(hashToObj(all)).map((j) => JSON.parse(j)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return send(res, 200, { items });
    }

    if (req.method === 'POST' && (action === 'mine' || action === 'respond')) {
      if (await limited(cfg, `rl:conv:${ip(req)}`, 300, 3600)) return send(res, 429, { error: 'Troppe richieste.' });
      const b = await readBody(req);
      const err = await checkPin(cfg, b.playerId, b.pin);
      if (err) return send(res, 403, { error: err });
      if (action === 'respond') {
        if (!CID.test(String(b.convId)) || !['si', 'no'].includes(b.r)) return send(res, 400, { error: 'Risposta non valida.' });
        const [raw] = await pipeline(cfg, [['HGET', 'conv:list', b.convId]]);
        if (!raw) return send(res, 404, { error: 'Convocazione non trovata.' });
        const conv = JSON.parse(raw);
        if (!conv.players.includes(b.playerId)) return send(res, 403, { error: 'Non sei tra i convocati.' });
        if (conv.closed) return send(res, 409, { error: 'Le risposte sono chiuse: contatta il mister.' });
        await pipeline(cfg, [['HSET', `conv:resp:${b.convId}`, b.playerId, JSON.stringify({ r: b.r, note: str(b.note, 200), at: Date.now() })]]);
      }
      const [ids] = await pipeline(cfg, [['HKEYS', 'conv:list']]);
      const got = (ids || []).length ? await pipeline(cfg, ids.map((i) => ['HGET', `conv:resp:${i}`, b.playerId])) : [];
      const mine = {};
      (ids || []).forEach((i, k) => { if (got[k]) mine[i] = JSON.parse(got[k]); });
      return send(res, 200, { mine });
    }

    // ---- solo amministratore ----
    if (await limited(cfg, `rl:adm:${ip(req)}`, 60, 900)) return send(res, 429, { error: 'Troppi tentativi, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });

    if (req.method === 'POST' && action === 'save') {
      const b = await readBody(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return send(res, 400, { error: 'Manca la data.' });
      const players = Array.isArray(b.players) ? [...new Set(b.players.filter((p) => PID.test(p)))].slice(0, 60) : [];
      if (!players.length) return send(res, 400, { error: 'Scegli almeno un giocatore.' });
      const id = CID.test(String(b.id)) ? b.id : 'c-' + crypto.randomBytes(8).toString('hex');
      const [old] = await pipeline(cfg, [['HGET', 'conv:list', id]]);
      const prev = old ? JSON.parse(old) : null;
      const item = {
        id, kind: b.kind === 'allenamento' ? 'allenamento' : 'partita',
        teamId: PID.test(String(b.teamId)) ? b.teamId : '', matchId: str(b.matchId, 60),
        title: str(b.title, 120) || (b.kind === 'allenamento' ? 'Allenamento' : 'Partita'),
        date: b.date, time: /^\d{2}:\d{2}$/.test(String(b.time || '')) ? b.time : '',
        meetTime: /^\d{2}:\d{2}$/.test(String(b.meetTime || '')) ? b.meetTime : '', place: str(b.place, 120),
        note: str(b.note, 600), players, closed: !!b.closed,
        createdAt: prev ? prev.createdAt : Date.now(), updatedAt: Date.now(),
      };
      await pipeline(cfg, [['HSET', 'conv:list', id, JSON.stringify(item)]]);
      return send(res, 200, { item });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { id } = await readBody(req);
      if (!CID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      await pipeline(cfg, [['HDEL', 'conv:list', id], ['DEL', `conv:resp:${id}`]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && action === 'responses') {
      const [ids] = await pipeline(cfg, [['HKEYS', 'conv:list']]);
      const got = (ids || []).length ? await pipeline(cfg, ids.map((i) => ['HGETALL', `conv:resp:${i}`])) : [];
      const responses = {};
      (ids || []).forEach((i, k) => { responses[i] = Object.fromEntries(Object.entries(hashToObj(got[k])).map(([p, j]) => [p, JSON.parse(j)])); });
      return send(res, 200, { responses });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
