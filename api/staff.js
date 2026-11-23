// Profili di mister, dirigenti e accompagnatori (staff). Solo amministratore: contengono
// dati anagrafici, numero di documento e matricola, che non devono mai arrivare ai ragazzi.
//
// Redis:  staff:list  hash staffId -> JSON profilo
const crypto = require('crypto');
const { redisConfig, pipeline, isAdmin, ip, send, readBody, limited, hashToObj } = require('./_lib.js');

const SID = /^s-[0-9a-f]{16}$/;
const TID = /^imp-[0-9a-f]{16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const ROLES = ['Allenatore', 'Allenatore in seconda', 'Dirigente accompagnatore', 'Preparatore dei portieri', 'Preparatore atletico', 'Medico / massaggiatore', 'Altro'];
const DOCS = ["Carta d'identità", 'Patente', 'Passaporto', 'Altro'];

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio non attivo: collega il database su Vercel.' });
    if (await limited(cfg, `rl:adm:${ip(req)}`, 120, 900)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'list';

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'staff:list']]);
      const items = Object.values(hashToObj(all)).map((j) => JSON.parse(j))
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
      return send(res, 200, { items });
    }

    if (req.method === 'POST' && action === 'save') {
      const b = await readBody(req);
      const firstName = str(b.firstName, 40), lastName = str(b.lastName, 40);
      if (!firstName || !lastName) return send(res, 400, { error: 'Inserisci nome e cognome.' });
      const id = SID.test(String(b.id)) ? b.id : 's-' + crypto.randomBytes(8).toString('hex');
      const [old] = await pipeline(cfg, [['HGET', 'staff:list', id]]);
      const prev = old ? JSON.parse(old) : null;
      const item = {
        id, firstName, lastName,
        role: ROLES.includes(b.role) ? b.role : 'Dirigente accompagnatore',
        birthDate: DATE.test(String(b.birthDate || '')) ? b.birthDate : '',
        birthPlace: str(b.birthPlace, 60), taxCode: str(b.taxCode, 16).toUpperCase(),
        address: str(b.address, 120), phone: str(b.phone, 30), email: str(b.email, 80),
        docType: DOCS.includes(b.docType) ? b.docType : DOCS[0], docNumber: str(b.docNumber, 30).toUpperCase(),
        docIssuedBy: str(b.docIssuedBy, 60), docExpiry: DATE.test(String(b.docExpiry || '')) ? b.docExpiry : '',
        matricola: str(b.matricola, 30),
        teams: Array.isArray(b.teams) ? b.teams.filter((t) => TID.test(t)).slice(0, 20) : [],
        note: str(b.note, 300),
        createdAt: prev ? prev.createdAt : Date.now(), updatedAt: Date.now(),
      };
      await pipeline(cfg, [['HSET', 'staff:list', id, JSON.stringify(item)]]);
      return send(res, 200, { item });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { id } = await readBody(req);
      if (!SID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      await pipeline(cfg, [['HDEL', 'staff:list', id]]);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
