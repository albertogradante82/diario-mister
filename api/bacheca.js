// Bacheca della società: avvisi pubblicati dai mister, con conferma di lettura dei giocatori verificati.
//
// Redis:
//   avv:list        hash avvisoId -> JSON avviso
//   avv:read:<id>   hash playerId -> timestamp lettura
//   avv:rep:<id>    lista JSON risposte { rid, playerId, name, text, at, mister }
const crypto = require('crypto');
const { isSuper, maskTail, redisConfig, pipeline, isAdmin, ip, send, readBody, limited, hashToObj, authPlayer, roster: rosterOf } = require('./_lib.js');
const { notify, quando } = require('./_push.js');

const PID = /^imp-[0-9a-f]{16}$/;
const AID = /^a-[0-9a-f]{16}$/;
const KINDS = ['comunicazione', 'allenamento', 'evento', 'partita'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);

// nome del giocatore dalla rosa pubblicata con l'app
let roster = null, rosterAt = 0;
async function playerName(req, playerId) {
  try {
    if (!roster || Date.now() - rosterAt > 600000) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = /^(localhost|127\.)/.test(host) ? 'http' : 'https';
      const r = await fetch(`${proto}://${host}/dati/pubblico.json`);
      roster = Object.fromEntries((await r.json()).players.map((p) => [p.id, p.name]));
      rosterAt = Date.now();
    }
  } catch { /* */ }
  return (roster && roster[playerId]) || 'Giocatore';
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Bacheca non attiva: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'list';

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'avv:list']]);
      const items = Object.values(hashToObj(all)).map((j) => JSON.parse(j)).sort((a, b) => b.createdAt - a.createdAt);
      const reps = items.length ? await pipeline(cfg, items.map((n) => ['LRANGE', `avv:rep:${n.id}`, 0, 199])) : [];
      items.forEach((n, i) => { n.replies = (reps[i] || []).map((j) => JSON.parse(j)); });
      return send(res, 200, { items });
    }

    if (req.method === 'POST' && action === 'read') {
      if (await limited(cfg, `rl:read:${ip(req)}`, 200, 3600)) return send(res, 429, { error: 'Troppe richieste.' });
      const { avvisoId, playerId, pin } = await readBody(req);
      if (!AID.test(String(avvisoId))) return send(res, 400, { error: 'Dati non validi.' });
      const a = await authPlayer(cfg, playerId, pin);
      if (a.error) return send(res, a.status, { error: a.error });
      const [exists] = await pipeline(cfg, [['HEXISTS', 'avv:list', avvisoId]]);
      if (!Number(exists)) return send(res, 404, { error: 'Avviso non trovato.' });
      await pipeline(cfg, [['HSETNX', `avv:read:${avvisoId}`, playerId, String(Date.now())]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'reply' && !req.headers['x-admin-code']) {
      // risposta di un giocatore verificato (il nome viene preso dalla rosa ufficiale, non dal telefono)
      if (await limited(cfg, `rl:rep:${ip(req)}`, 60, 3600)) return send(res, 429, { error: 'Troppe risposte, riprova più tardi.' });
      const { avvisoId, playerId, pin, text } = await readBody(req);
      const t = String(text || '').trim().slice(0, 500);
      if (!AID.test(String(avvisoId)) || !t) return send(res, 400, { error: 'Scrivi un messaggio.' });
      const a = await authPlayer(cfg, playerId, pin);
      if (a.error) return send(res, a.status, { error: a.error });
      const [raw] = await pipeline(cfg, [['HGET', 'avv:list', avvisoId]]);
      if (!raw) return send(res, 404, { error: 'Avviso non trovato.' });
      const child = await playerName(req, playerId);
      // il nome viene dalla rosa ufficiale (o dal profilo del genitore), non dal telefono
      const name = a.who.role === 'genitore' ? `${a.who.name} (genitore di ${child})` : child;
      const rep = { rid: crypto.randomBytes(6).toString('hex'), playerId, name, text: t, at: Date.now() };
      await pipeline(cfg, [['RPUSH', `avv:rep:${avvisoId}`, JSON.stringify(rep)], ['HSETNX', `avv:read:${avvisoId}`, playerId, String(Date.now())]]);
      await notify(cfg, { mister: true }, { title: `💬 ${rep.name}`, body: rep.text.slice(0, 180), url: './#/bacheca', tag: 'rep-' + avvisoId });
      return send(res, 200, { reply: rep });
    }

    if (req.method === 'POST' && action === 'verify') {
      // collega il telefono al proprio profilo (verifica del PIN)
      const { playerId, pin } = await readBody(req);
      const a = await authPlayer(cfg, playerId, pin);
      if (a.error) return send(res, a.status, { error: a.error });
      return send(res, 200, { ok: true, role: a.who.role });
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
      // notifica: nuovo avviso, oppure cambio di data/ora/luogo
      const changed = prev && (prev.date !== item.date || prev.time !== item.time || prev.place !== item.place);
      if ((!prev || changed) && b.notify !== false) {
        const dove = [quando(item.date, item.time), item.place].filter(Boolean).join(' · ');
        await notify(cfg, item.teams.length ? { teams: item.teams } : { all: true }, {
          title: (changed ? '🔄 Cambio: ' : '📌 ') + item.title,
          body: (changed ? (dove || 'Avviso aggiornato') : [dove, item.text].filter(Boolean).join(' — ')).slice(0, 180),
          url: './#/g/bacheca', tag: 'avv-' + id,
        });
      }
      return send(res, 200, { item });
    }

    if (req.method === 'POST' && action === 'reply') {
      const { avvisoId, text, author } = await readBody(req);
      const t = String(text || '').trim().slice(0, 500);
      if (!AID.test(String(avvisoId)) || !t) return send(res, 400, { error: 'Scrivi un messaggio.' });
      const rep = { rid: crypto.randomBytes(6).toString('hex'), playerId: '', name: str(author, 40) || 'Mister', text: t, at: Date.now(), mister: true };
      await pipeline(cfg, [['RPUSH', `avv:rep:${avvisoId}`, JSON.stringify(rep)]]);
      const [rawA] = await pipeline(cfg, [['HGET', 'avv:list', avvisoId]]);
      if (rawA) {
        const a = JSON.parse(rawA);
        await notify(cfg, a.teams && a.teams.length ? { teams: a.teams } : { all: true },
          { title: `💬 ${rep.name} · ${a.title}`, body: t.slice(0, 180), url: './#/g/bacheca', tag: 'rep-' + avvisoId });
      }
      return send(res, 200, { reply: rep });
    }

    if (req.method === 'POST' && action === 'delreply') {
      const { avvisoId, rid } = await readBody(req);
      if (!AID.test(String(avvisoId))) return send(res, 400, { error: 'Id non valido.' });
      const [list] = await pipeline(cfg, [['LRANGE', `avv:rep:${avvisoId}`, 0, -1]]);
      const hit = (list || []).find((j) => JSON.parse(j).rid === rid);
      if (hit) await pipeline(cfg, [['LREM', `avv:rep:${avvisoId}`, 1, hit]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { id } = await readBody(req);
      if (!AID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      await pipeline(cfg, [['HDEL', 'avv:list', id], ['DEL', `avv:read:${id}`], ['DEL', `avv:rep:${id}`]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && action === 'activity') {
      // richieste da approvare (accompagnatori, genitori) e ultime attività (documenti, ricevute, fatture)
      const [log, staffAll, parAll] = await pipeline(cfg, [['LRANGE', 'act:log', 0, 59], ['HGETALL', 'staff:list'], ['HGETALL', 'par:list']]);
      const r = await rosterOf(req);
      const staff = Object.values(hashToObj(staffAll)).map((j) => JSON.parse(j)).filter((s) => s.status === 'pending')
        .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, role: s.role, matricola: s.matricola, docType: s.docType, docNumber: s.docNumber, phone: s.phone, email: s.email, at: s.createdAt }));
      const parents = [];
      Object.values(hashToObj(parAll)).map((j) => JSON.parse(j)).forEach((g) => (g.children || []).filter((c) => c.status === 'pending')
        .forEach((c) => parents.push({ parentId: g.id, name: `${g.firstName} ${g.lastName}`, relation: g.relation, playerId: c.playerId, player: r.players[c.playerId]?.name || '', team: r.teams[r.players[c.playerId]?.teamId]?.name || '', at: c.at })));
      const full = isSuper(req);
      const priv = ['documento', 'ricevuta', 'fattura'];
      return send(res, 200, {
        full,
        log: (log || []).map((j) => JSON.parse(j)).filter((a) => full || !priv.includes(a.type)),
        staff: full ? staff : staff.map((s) => ({ ...s, phone: maskTail(s.phone), email: maskTail(s.email) })),
        parents,
      });
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
