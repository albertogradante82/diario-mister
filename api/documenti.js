// Documenti dei giocatori: documento d'identità, certificato medico, ricevute di pagamento, altri.
// Li caricano il giocatore (con il suo PIN) o un genitore collegato; li vedono solo loro e il mister.
// I file (foto o PDF, max 3 MB) sono salvati nel database a pezzi.
//
// Redis:  doc:meta            hash docId -> JSON { id, playerId, kind, name, mime, size, chunks, note, expiry, rata, by, at }
//         doc:data:<id>:<n>   pezzo n del file (base64)
const crypto = require('crypto');
const { redisConfig, pipeline, isAdmin, ip, send, readBody, limited, hashToObj, authPlayer, roster } = require('./_lib.js');
const { notify } = require('./_push.js');

const DID = /^d-[0-9a-f]{16}$/;
const KINDS = ['identita', 'certificato', 'pagamento', 'altro'];
const LABEL = { identita: 'Documento d\'identità', certificato: 'Certificato medico', pagamento: 'Ricevuta di pagamento', altro: 'Documento' };
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX = 3 * 1024 * 1024;
const CHUNK = 600000;
const str = (v, max) => String(v ?? '').trim().slice(0, max);

async function allMeta(cfg) {
  const [all] = await pipeline(cfg, [['HGETALL', 'doc:meta']]);
  return Object.values(hashToObj(all)).map((j) => JSON.parse(j)).sort((a, b) => b.at - a.at);
}

async function readFile(cfg, meta) {
  const parts = await pipeline(cfg, Array.from({ length: meta.chunks }, (_, i) => ['GET', `doc:data:${meta.id}:${i}`]));
  return parts.join('');
}

async function removeDoc(cfg, meta) {
  await pipeline(cfg, [['HDEL', 'doc:meta', meta.id], ...Array.from({ length: meta.chunks }, (_, i) => ['DEL', `doc:data:${meta.id}:${i}`])]);
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio non attivo: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || '';
    const admin = !!req.headers['x-admin-code'];

    // ---- giocatore o genitore ----
    if (!admin && req.method === 'POST') {
      if (await limited(cfg, `rl:doc:${ip(req)}`, 120, 3600)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
      const b = await readBody(req);
      const a = await authPlayer(cfg, b.playerId, b.pin);
      if (a.error) return send(res, a.status, { error: a.error });
      const mine = (await allMeta(cfg)).filter((m) => m.playerId === b.playerId);

      if (action === 'list') return send(res, 200, { items: mine });

      if (action === 'upload') {
        if (!KINDS.includes(b.kind)) return send(res, 400, { error: 'Tipo di documento non valido.' });
        if (!MIMES.includes(b.mime)) return send(res, 400, { error: 'Carica una foto (JPG/PNG) o un PDF.' });
        const data = String(b.data || '');
        if (!/^[A-Za-z0-9+/=]+$/.test(data)) return send(res, 400, { error: 'File non valido.' });
        const size = Math.floor(data.length * 3 / 4);
        if (size > MAX) return send(res, 413, { error: 'File troppo grande (massimo 3 MB). Per i PDF prova a scansionare a risoluzione più bassa.' });
        if (mine.length >= 30) return send(res, 400, { error: 'Troppi documenti: cancellane qualcuno.' });
        const id = 'd-' + crypto.randomBytes(8).toString('hex');
        const chunks = Math.ceil(data.length / CHUNK) || 1;
        for (let i = 0; i < chunks; i++) await pipeline(cfg, [['SET', `doc:data:${id}:${i}`, data.slice(i * CHUNK, (i + 1) * CHUNK)]]);
        const meta = {
          id, playerId: b.playerId, kind: b.kind, name: str(b.name, 80) || LABEL[b.kind], mime: b.mime, size, chunks,
          note: str(b.note, 200), expiry: /^\d{4}-\d{2}-\d{2}$/.test(String(b.expiry || '')) ? b.expiry : '',
          rata: b.kind === 'pagamento' ? str(b.rata, 10) : '',
          by: a.who.role === 'genitore' ? `genitore: ${a.who.name}` : 'giocatore', at: Date.now(),
        };
        await pipeline(cfg, [['HSET', 'doc:meta', id, JSON.stringify(meta)]]);
        const r = await roster(req);
        await notify(cfg, { mister: true }, { title: b.kind === 'pagamento' ? '💶 Ricevuta di pagamento' : '📄 Nuovo documento', body: `${r.players[b.playerId]?.name || 'Giocatore'}: ${meta.name}`, url: b.kind === 'pagamento' ? './#/pagamenti' : './#/documenti', tag: 'doc-' + id });
        return send(res, 200, { item: meta });
      }

      if (action === 'get' || action === 'delete') {
        const meta = mine.find((m) => m.id === b.docId);
        if (!meta) return send(res, 404, { error: 'Documento non trovato.' });
        if (action === 'delete') { await removeDoc(cfg, meta); return send(res, 200, { ok: true }); }
        return send(res, 200, { item: meta, data: await readFile(cfg, meta) });
      }
      return send(res, 400, { error: 'Richiesta non valida.' });
    }

    // ---- mister ----
    if (await limited(cfg, `rl:adm:${ip(req)}`, 300, 900)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });

    if (req.method === 'GET' && action === 'list') return send(res, 200, { items: await allMeta(cfg) });

    if (req.method === 'POST' && (action === 'get' || action === 'delete')) {
      const { docId } = await readBody(req);
      if (!DID.test(String(docId))) return send(res, 400, { error: 'Id non valido.' });
      const [raw] = await pipeline(cfg, [['HGET', 'doc:meta', docId]]);
      if (!raw) return send(res, 404, { error: 'Documento non trovato.' });
      const meta = JSON.parse(raw);
      if (action === 'delete') { await removeDoc(cfg, meta); return send(res, 200, { ok: true }); }
      return send(res, 200, { item: meta, data: await readFile(cfg, meta) });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
