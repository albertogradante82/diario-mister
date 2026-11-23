// Convocazioni (partite e allenamenti) con risposta dei giocatori: "ci sono" / "non ci sono".
//
// Redis:
//   conv:list        hash convId -> JSON convocazione
//   conv:resp:<id>   hash playerId -> JSON { r: 'si'|'no', note, at }
const crypto = require('crypto');
const { redisConfig, pipeline, pinHash, safeEq, isAdmin, ip, send, readBody, limited, hashToObj } = require('./_lib.js');
const { notify, quando } = require('./_push.js');

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
        // staff in distinta: qui solo nome e ruolo (i documenti restano nell'area mister)
        staff: Array.isArray(b.staff) ? b.staff.filter((x) => x && /^s-[0-9a-f]{16}$/.test(String(x.id))).slice(0, 10)
          .map((x) => ({ id: x.id, name: str(x.name, 80), role: str(x.role, 40) })) : [],
        createdAt: prev ? prev.createdAt : Date.now(), updatedAt: Date.now(),
      };
      await pipeline(cfg, [['HSET', 'conv:list', id, JSON.stringify(item)]]);
      // notifiche: solo per eventi di oggi o futuri
      const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
      if (b.notify !== false && item.date >= today) {
        const isAll = item.kind === 'allenamento';
        const dove = [quando(item.date, item.time), item.meetTime ? 'ritrovo ' + item.meetTime : '', item.place].filter(Boolean).join(' · ');
        const url = isAll ? './#/g/allenamenti' : './#/g/convocazioni';
        const moved = prev && (prev.date !== item.date || prev.time !== item.time || prev.meetTime !== item.meetTime || prev.place !== item.place);
        const nuovi = prev ? players.filter((p) => !prev.players.includes(p)) : players;
        const vecchi = prev ? players.filter((p) => prev.players.includes(p)) : [];
        if (nuovi.length) {
          await notify(cfg, { players: nuovi }, {
            title: isAll ? `🏃 ${item.title}` : `📋 Sei convocato: ${item.title}`,
            body: (dove + (isAll ? '' : ' — Rispondi Presente o Non ci sono')).slice(0, 180), url, tag: 'conv-' + id,
          });
        }
        if (moved && vecchi.length) {
          await notify(cfg, { players: vecchi }, { title: `🔄 Cambio orario: ${item.title}`, body: dove.slice(0, 180), url, tag: 'conv-' + id });
        }
      }
      return send(res, 200, { item });
    }

    if (req.method === 'POST' && action === 'savemany') {
      // creazione in blocco (es. allenamenti di tutta la stagione)
      const b = await readBody(req);
      const list = Array.isArray(b.items) ? b.items.slice(0, 300) : [];
      const cmds = [];
      for (const x of list) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ''))) continue;
        const players = Array.isArray(x.players) ? [...new Set(x.players.filter((p) => PID.test(p)))].slice(0, 60) : [];
        if (!players.length) continue;
        const id = CID.test(String(x.id)) ? x.id : 'c-' + crypto.randomBytes(8).toString('hex');
        cmds.push(['HSET', 'conv:list', id, JSON.stringify({
          id, kind: x.kind === 'allenamento' ? 'allenamento' : 'partita', teamId: PID.test(String(x.teamId)) ? x.teamId : '', matchId: str(x.matchId, 60),
          title: str(x.title, 120) || 'Allenamento', date: x.date, time: /^\d{2}:\d{2}$/.test(String(x.time || '')) ? x.time : '',
          meetTime: '', place: str(x.place, 120), note: str(x.note, 600), players, closed: false, createdAt: Date.now(), updatedAt: Date.now(),
        })]);
      }
      if (cmds.length) await pipeline(cfg, cmds);
      return send(res, 200, { created: cmds.length });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { id } = await readBody(req);
      if (!CID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      const [rawC] = await pipeline(cfg, [['HGET', 'conv:list', id]]);
      await pipeline(cfg, [['HDEL', 'conv:list', id], ['DEL', `conv:resp:${id}`]]);
      if (rawC) {
        const c = JSON.parse(rawC);
        const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
        if (c.date >= today) {
          await notify(cfg, { players: c.players }, {
            title: `❌ Annullato: ${c.title}`, body: quando(c.date, c.time),
            url: c.kind === 'allenamento' ? './#/g/allenamenti' : './#/g/convocazioni', tag: 'conv-' + id,
          });
        }
      }
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
