// Quote di iscrizione: rata unica oppure due rate, pagato segnato dal mister,
// ricevute caricate da giocatori/genitori (in /api/documenti, tipo "pagamento"), richiesta fattura.
//
// Redis:  pay:conf   JSON { season, unica:{amount,due}, rate:[{key,amount,due}] }
//         pay:list   hash playerId -> JSON { plan:'unica'|'rate'|'', paid:{ unica|r1|r2: {at, amount, method, date} }, exempt, note, updatedAt }
//         pay:fatt   hash playerId -> JSON { intestatario, codiceFiscale, partitaIva, indirizzo, cap, citta, provincia, email, pec, sdi, note, by, at }
const { isSuper, redisConfig, pipeline, isAdmin, ip, send, readBody, limited, hashToObj, authPlayer, roster, logActivity } = require('./_lib.js');
const { notify } = require('./_push.js');

const PID = /^imp-[0-9a-f]{16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const DEFAULT_CONF = {
  season: '2026/27',
  unica: { amount: 450, due: '2026-09-30' },
  rate: [{ key: 'r1', amount: 250, due: '2026-09-30' }, { key: 'r2', amount: 200, due: '2026-12-31' }],
  exemptTeams: ['imp-17fa2ce80b5d0376'], // Prima Squadra: non paga la quota
};

async function conf(cfg) {
  const [raw] = await pipeline(cfg, [['GET', 'pay:conf']]);
  const c = raw ? JSON.parse(raw) : {};
  return { ...DEFAULT_CONF, ...c, exemptTeams: Array.isArray(c.exemptTeams) ? c.exemptTeams : DEFAULT_CONF.exemptTeams };
}

function cleanFatt(b) {
  return {
    intestatario: str(b.intestatario, 100), codiceFiscale: str(b.codiceFiscale, 16).toUpperCase(), partitaIva: str(b.partitaIva, 13),
    indirizzo: str(b.indirizzo, 120), cap: str(b.cap, 5), citta: str(b.citta, 60), provincia: str(b.provincia, 2).toUpperCase(),
    email: str(b.email, 80), pec: str(b.pec, 80), sdi: str(b.sdi, 7).toUpperCase(), note: str(b.note, 300),
  };
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio non attivo: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || '';
    const admin = !!req.headers['x-admin-code'];

    if (req.method === 'GET' && action === 'conf') return send(res, 200, { conf: await conf(cfg) });

    // ---- giocatore o genitore ----
    if (!admin && req.method === 'POST') {
      if (await limited(cfg, `rl:pay:${ip(req)}`, 120, 3600)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
      const b = await readBody(req);
      const a = await authPlayer(cfg, b.playerId, b.pin);
      if (a.error) return send(res, a.status, { error: a.error });
      const [rec, fatt] = await pipeline(cfg, [['HGET', 'pay:list', b.playerId], ['HGET', 'pay:fatt', b.playerId]]);
      const r = rec ? JSON.parse(rec) : { plan: '', paid: {} };

      if (action === 'mine') {
        const ro = await roster(req);
        return send(res, 200, { conf: await conf(cfg), rec: r, fattura: fatt ? JSON.parse(fatt) : null, teamId: ro.players[b.playerId]?.teamId || '' });
      }

      if (action === 'plan') {
        if (!['unica', 'rate'].includes(b.plan)) return send(res, 400, { error: 'Scegli rata unica o due rate.' });
        if (Object.keys(r.paid || {}).length && r.plan && r.plan !== b.plan) return send(res, 400, { error: 'C\'è già un pagamento registrato: per cambiare modalità chiedi al mister.' });
        const upd = { ...r, plan: b.plan, updatedAt: Date.now() };
        await pipeline(cfg, [['HSET', 'pay:list', b.playerId, JSON.stringify(upd)]]);
        return send(res, 200, { rec: upd });
      }

      if (action === 'fattura') {
        const f = cleanFatt(b);
        if (!f.intestatario) return send(res, 400, { error: 'Scrivi a chi intestare la fattura.' });
        if (!f.codiceFiscale && !f.partitaIva) return send(res, 400, { error: 'Serve il codice fiscale o la partita IVA.' });
        if (!f.indirizzo || !f.citta) return send(res, 400, { error: 'Serve l\'indirizzo completo.' });
        const item = { ...f, by: a.who.role === 'genitore' ? `genitore: ${a.who.name}` : 'giocatore', at: Date.now() };
        await pipeline(cfg, [['HSET', 'pay:fatt', b.playerId, JSON.stringify(item)]]);
        const ro = await roster(req);
        await logActivity(cfg, { type: 'fattura', playerId: b.playerId, player: ro.players[b.playerId]?.name || '', name: f.intestatario, by: item.by });
        await notify(cfg, { mister: true }, { title: '🧾 Richiesta fattura', body: `${ro.players[b.playerId]?.name || 'Giocatore'}: intestata a ${f.intestatario}`, url: './#/pagamenti', tag: 'fatt-' + b.playerId });
        return send(res, 200, { fattura: item });
      }
      return send(res, 400, { error: 'Richiesta non valida.' });
    }

    // ---- mister ----
    if (await limited(cfg, `rl:adm:${ip(req)}`, 300, 900)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
    if (!isSuper(req)) return send(res, 403, { error: 'Solo l\'amministratore può vedere i pagamenti: Altro → Accedi come admin.' });

    if (req.method === 'GET' && action === 'list') {
      const [list, fatt] = await pipeline(cfg, [['HGETALL', 'pay:list'], ['HGETALL', 'pay:fatt']]);
      const parse = (o) => Object.fromEntries(Object.entries(hashToObj(o)).map(([k, v]) => [k, JSON.parse(v)]));
      return send(res, 200, { conf: await conf(cfg), recs: parse(list), fatture: parse(fatt) });
    }

    if (req.method === 'POST' && action === 'mark') {
      const b = await readBody(req);
      if (!PID.test(String(b.playerId)) || !['unica', 'r1', 'r2'].includes(b.key)) return send(res, 400, { error: 'Dati non validi.' });
      const [raw] = await pipeline(cfg, [['HGET', 'pay:list', b.playerId]]);
      const r = raw ? JSON.parse(raw) : { plan: '', paid: {} };
      r.paid = r.paid || {};
      if (b.paid) {
        const c = await conf(cfg);
        const def = b.key === 'unica' ? c.unica.amount : (c.rate.find((x) => x.key === b.key) || {}).amount;
        r.paid[b.key] = { at: Date.now(), amount: Number(b.amount) > 0 ? Number(b.amount) : def, method: str(b.method, 30), date: DATE.test(String(b.date || '')) ? b.date : new Date().toISOString().slice(0, 10) };
        if (!r.plan) r.plan = b.key === 'unica' ? 'unica' : 'rate';
      } else delete r.paid[b.key];
      r.updatedAt = Date.now();
      await pipeline(cfg, [['HSET', 'pay:list', b.playerId, JSON.stringify(r)]]);
      if (b.paid) await notify(cfg, { players: [b.playerId] }, { title: '✅ Pagamento registrato', body: `${b.key === 'unica' ? 'Quota' : b.key === 'r1' ? '1ª rata' : '2ª rata'}: € ${r.paid[b.key].amount}. Grazie!`, url: './#/g/pagamenti', tag: 'pay-' + b.playerId });
      return send(res, 200, { rec: r });
    }

    if (req.method === 'POST' && action === 'set') {
      const b = await readBody(req);
      if (!PID.test(String(b.playerId))) return send(res, 400, { error: 'Dati non validi.' });
      const [raw] = await pipeline(cfg, [['HGET', 'pay:list', b.playerId]]);
      const r = raw ? JSON.parse(raw) : { plan: '', paid: {} };
      if (b.plan !== undefined) r.plan = ['unica', 'rate'].includes(b.plan) ? b.plan : '';
      if (b.exempt !== undefined) r.exempt = !!b.exempt;
      if (b.note !== undefined) r.note = str(b.note, 200);
      r.updatedAt = Date.now();
      await pipeline(cfg, [['HSET', 'pay:list', b.playerId, JSON.stringify(r)]]);
      return send(res, 200, { rec: r });
    }

    if (req.method === 'POST' && action === 'conf') {
      const b = await readBody(req);
      const n = (v) => Math.max(0, Math.round(Number(v) || 0));
      const d = (v, def) => (DATE.test(String(v || '')) ? v : def);
      const c = {
        season: str(b.season, 10) || DEFAULT_CONF.season,
        unica: { amount: n(b.unica?.amount), due: d(b.unica?.due, DEFAULT_CONF.unica.due) },
        rate: [0, 1].map((i) => ({ key: `r${i + 1}`, amount: n(b.rate?.[i]?.amount), due: d(b.rate?.[i]?.due, DEFAULT_CONF.rate[i].due) })),
        exemptTeams: Array.isArray(b.exemptTeams) ? b.exemptTeams.filter((t) => /^imp-[0-9a-f]{16}$/.test(t)).slice(0, 30) : DEFAULT_CONF.exemptTeams,
      };
      await pipeline(cfg, [['SET', 'pay:conf', JSON.stringify(c)]]);
      return send(res, 200, { conf: c });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
