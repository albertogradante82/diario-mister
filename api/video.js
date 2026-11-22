// Link ai video delle partite (Dropbox, Google Drive, YouTube…), divisi per tempo e in ordine.
// Visibili e modificabili solo dall'amministratore (contengono riprese di minori).
//
// Redis:  video:list  hash matchId -> JSON { matchId, teamId, title, date, status, parts:[{id, period, url, label, addedAt}] }
const crypto = require('crypto');
const { redisConfig, pipeline, isAdmin, ip, send, readBody, limited, hashToObj } = require('./_lib.js');

const MID = /^[A-Za-z0-9-]{1,64}$/;
const STATUS = ['da analizzare', 'in analisi', 'analizzata'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanUrl(u) {
  u = str(u, 500);
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    return x.toString();
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio non attivo: collega il database su Vercel.' });
    if (await limited(cfg, `rl:adm:${ip(req)}`, 120, 900)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'list';

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'video:list']]);
      const items = Object.values(hashToObj(all)).map((j) => JSON.parse(j)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return send(res, 200, { items });
    }

    if (req.method === 'POST' && action === 'save') {
      const b = await readBody(req);
      if (!MID.test(String(b.matchId))) return send(res, 400, { error: 'Partita non valida.' });
      const parts = [];
      for (const p of Array.isArray(b.parts) ? b.parts.slice(0, 40) : []) {
        const url = cleanUrl(p.url);
        if (!url) continue;
        parts.push({
          id: /^[0-9a-f]{12}$/.test(String(p.id)) ? p.id : crypto.randomBytes(6).toString('hex'),
          period: Math.min(4, Math.max(1, Number(p.period) || 1)), url, label: str(p.label, 80), addedAt: Number(p.addedAt) || Date.now(),
        });
      }
      const item = {
        matchId: b.matchId, teamId: str(b.teamId, 64), title: str(b.title, 120), date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? b.date : '',
        status: STATUS.includes(b.status) ? b.status : 'da analizzare', note: str(b.note, 500), parts, updatedAt: Date.now(),
      };
      if (!parts.length) await pipeline(cfg, [['HDEL', 'video:list', item.matchId]]);
      else await pipeline(cfg, [['HSET', 'video:list', item.matchId, JSON.stringify(item)]]);
      return send(res, 200, { item });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
