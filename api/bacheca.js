// Bacheca della società: avvisi pubblicati dai mister, con conferma di lettura dei giocatori verificati.
//
// Redis:
//   avv:list        hash avvisoId -> JSON avviso
//   avv:read:<id>   hash playerId -> timestamp lettura
const crypto = require('crypto');
const { redisConfig, pipeline, pinHash, safeEq, isAdmin, ip, send, readBody, limited, hashToObj } = require('./_lib.js');

const PID = /^imp-[0-9a-f]{16}$/;
const AID = /^a-[0-9a-f]{16}$/;
const KINDS = ['comunicazione', 'allenamento', 'evento', 'partita'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Bacheca non attiva: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'list';

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'avv:list']]);
      const items = Object.values(hashToObj(all)).map((j) => JSON.parse(j)).sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, { items });
    }

    if (req.method === 'POST' && action === 'read') {
      if (await limited(cfg, `rl:read:${ip(req)}`, 200, 3600)) return send(res, 429, { error: 'Troppe richieste.' });
      const { avvisoId, playerId, pin } = await readBody(req);
      if (!AID.test(String(avvisoId)) || !PID.test(String(playerId)) || !/^\d{4,6}$/.test(String(pin || ''))) return send(res, 400, { error: 'Dati non validi.' });
      if (await limited(cfg, `rl:pin:${playerId}`, 30, 3600)) return send(res, 429, { error: 'Troppi tentativi con il PIN.' });
      const [stored, exists] = await pipeline(cfg, [['HGET', 'prof:pin', playerId], ['HEXISTS', 'avv:list', avvisoId]]);
      if (!stored) return send(res, 404, { error: 'Profilo non verificato.' });
      if (!safeEq(stored, pinHash(playerId, String(pin)))) return send(res, 403, { error: 'PIN errato.' });
      if (!Number(exists)) return send(res, 404, { error: 'Avviso non trovato.' });
      await pipeline(cfg, [['HSETNX', `avv:read:${avvisoId}`, playerId, String(Date.now())]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'verify') {
      // collega il telefono al proprio profilo (verifica del PIN)
      const { playerId, pin } = await readBody(req);
      if (!PID.test(String(playerId)) || !/^\d{4,6}$/.test(String(pin || ''))) return send(res, 400, { error: 'PIN non valido.' });
      if (await limited(cfg, `rl:pin:${playerId}`, 30, 3600)) return send(res, 429, { error: 'Troppi tentativi con il PIN: riprova tra un\'ora.' });
      const [stored] = await pipeline(cfg, [['HGET', 'prof:pin', playerId]]);
      if (!stored) return send(res, 404, { error: 'Prima compila la tua scheda giocatore e scegli un PIN.' });
      if (!safeEq(stored, pinHash(playerId, String(pin)))) return send(res, 403, { error: 'PIN errato.' });
      return send(res, 200, { ok: true });
    }

    // ---- solo amministratore ----
    if (await limited(cfg, `rl:adm:${ip(req)}`, 60, 900)) return send(res, 429, { error: 'Troppi tentativi, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });

    if (req.method === 'POST' && action === 'save') {
      const b = await readBody(req);
      const title = str(b.title, 120);
      if (!title) return send(res, 400, { error: 'Manca il titolo.' });
      const id = AID.test(String(b.id)) ? b.id : 'a-' + crypto.randomBytes(8).toString('hex');
      const [old] = await pipeline(cfg, [['HGET', 'avv:list', id]]);
      const prev = old ? JSON.parse(old) : null;
      const item = {
        id, title, text: str(b.text, 2000), kind: KINDS.includes(b.kind) ? b.kind : 'comunicazione',
        teams: Array.isArray(b.teams) ? b.teams.filter((t) => /^imp-[0-9a-f]{16}$/.test(t)).slice(0, 20) : [],
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : '', time: /^\d{2}:\d{2}$/.test(String(b.time || '')) ? b.time : '',
        place: str(b.place, 120), author: str(b.author, 60),
        createdAt: prev ? prev.createdAt : Date.now(), updatedAt: Date.now(),
      };
      await pipeline(cfg, [['HSET', 'avv:list', id, JSON.stringify(item)]]);
      return send(res, 200, { item });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { id } = await readBody(req);
      if (!AID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      await pipeline(cfg, [['HDEL', 'avv:list', id], ['DEL', `avv:read:${id}`]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && action === 'reads') {
      const [all] = await pipeline(cfg, [['HKEYS', 'avv:list']]);
      const ids = all || [];
      const res2 = ids.length ? await pipeline(cfg, ids.map((i) => ['HGETALL', `avv:read:${i}`])) : [];
      const reads = {};
      ids.forEach((i, k) => { reads[i] = Object.fromEntries(Object.entries(hashToObj(res2[k])).map(([p, t]) => [p, Number(t)])); });
      return send(res, 200, { reads });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
