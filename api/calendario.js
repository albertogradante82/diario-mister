// Spostamenti delle partite di campionato decisi dal mister (data, ora, campo).
// Valgono per tutti: area mister e area giocatori leggono queste modifiche sopra al calendario ufficiale.
//
// Redis:  cal:mod  hash matchId -> JSON { matchId, teamId, date, time, place, title, at }
const { redisConfig, pipeline, isAdmin, ip, send, readBody, limited, hashToObj } = require('./_lib.js');
const { notify, quando } = require('./_push.js');

const MID = /^[A-Za-z0-9-]{1,64}$/;
const TID = /^imp-[0-9a-f]{16}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio non attivo: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'list';

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'cal:mod']]);
      const mods = {};
      Object.values(hashToObj(all)).forEach((j) => { const m = JSON.parse(j); mods[m.matchId] = m; });
      return send(res, 200, { mods });
    }

    // ---- solo amministratore ----
    if (await limited(cfg, `rl:adm:${ip(req)}`, 60, 900)) return send(res, 429, { error: 'Troppi tentativi, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });

    if (req.method === 'POST' && action === 'save') {
      const b = await readBody(req);
      if (!MID.test(String(b.matchId))) return send(res, 400, { error: 'Partita non valida.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return send(res, 400, { error: 'Manca la data.' });
      const item = {
        matchId: b.matchId, teamId: TID.test(String(b.teamId)) ? b.teamId : '',
        date: b.date, time: /^\d{2}:\d{2}$/.test(String(b.time || '')) ? b.time : '',
        place: str(b.place, 120), title: str(b.title, 120) || 'Partita', at: Date.now(),
      };
      const [convAll] = await pipeline(cfg, [['HGETALL', 'conv:list']]);
      const cmds = [['HSET', 'cal:mod', item.matchId, JSON.stringify(item)]];
      // aggiorna anche le convocazioni collegate a questa partita (senza doppia notifica)
      Object.values(hashToObj(convAll)).map((j) => JSON.parse(j)).filter((c) => c.matchId === item.matchId).forEach((c) => {
        cmds.push(['HSET', 'conv:list', c.id, JSON.stringify({ ...c, date: item.date, time: item.time, place: item.place || c.place, updatedAt: Date.now() })]);
      });
      await pipeline(cfg, cmds);
      const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
      let sent = 0;
      if (b.notify !== false && item.teamId && item.date >= today) {
        sent = await notify(cfg, { teams: [item.teamId] }, {
          title: `🔄 Partita spostata: ${item.title}`,
          body: [quando(item.date, item.time), item.place].filter(Boolean).join(' · '),
          url: './#/g/calendario', tag: 'match-' + item.matchId,
        });
      }
      return send(res, 200, { item, convocazioni: cmds.length - 1, sent });
    }

    if (req.method === 'POST' && action === 'reset') {
      const { matchId } = await readBody(req);
      if (!MID.test(String(matchId))) return send(res, 400, { error: 'Partita non valida.' });
      await pipeline(cfg, [['HDEL', 'cal:mod', matchId]]);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
