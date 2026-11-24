// Profili di mister, dirigenti e accompagnatori (staff).
// - Il mister (password) crea, modifica, elimina e azzera il PIN.
// - La persona stessa, con il suo PIN (come i ragazzi), completa e conferma la propria scheda:
//   la scheda confermata è "certificata" (stella verde).
// Documento, matricola, codice fiscale e contatti non arrivano mai ai ragazzi:
// l'elenco pubblico contiene solo nome, ruolo e certificazione.
//
// Redis:  staff:list  hash staffId -> JSON profilo
//         staff:pin   hash staffId -> sha256 del PIN
const crypto = require('crypto');
const { isSuper, maskTail, redisConfig, pipeline, sha, safeEq, isAdmin, ip, send, readBody, limited, hashToObj } = require('./_lib.js');

const SID = /^s-[0-9a-f]{16}$/;
const TID = /^imp-[0-9a-f]{16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PIN = /^\d{4,6}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const ROLES = ['Allenatore', 'Allenatore in seconda', 'Dirigente accompagnatore', 'Preparatore dei portieri', 'Preparatore atletico', 'Medico / massaggiatore', 'Altro'];
const DOCS = ["Carta d'identità", 'Patente', 'Passaporto', 'Altro'];
const staffPinHash = (id, pin) => sha(`mister-staff-pin:${id}:${pin}`);

/** Campi modificabili; `teams` e `role` li decide solo il mister. */
function clean(b, prev, { admin }) {
  // valori oscurati (mister senza password admin): si tengono quelli salvati
  ['phone', 'email', 'taxCode'].forEach((k) => { if (String(b[k] || '').includes('•')) b = { ...b, [k]: prev?.[k] || '' }; });
  const keep = (k, v) => (v === undefined ? prev?.[k] ?? '' : v);
  return {
    firstName: str(keep('firstName', b.firstName), 40), lastName: str(keep('lastName', b.lastName), 40),
    role: admin ? (ROLES.includes(b.role) ? b.role : prev?.role || 'Dirigente accompagnatore') : prev?.role || 'Dirigente accompagnatore',
    birthDate: DATE.test(String(b.birthDate || '')) ? b.birthDate : '',
    birthPlace: str(b.birthPlace, 60), taxCode: str(b.taxCode, 16).toUpperCase(),
    address: str(b.address, 120), phone: str(b.phone, 30), email: str(b.email, 80),
    docType: DOCS.includes(b.docType) ? b.docType : DOCS[0], docNumber: str(b.docNumber, 30).toUpperCase(),
    docIssuedBy: str(b.docIssuedBy, 60), docExpiry: DATE.test(String(b.docExpiry || '')) ? b.docExpiry : '',
    matricola: str(b.matricola, 30),
    teams: admin ? (Array.isArray(b.teams) ? b.teams.filter((t) => TID.test(t)).slice(0, 20) : []) : prev?.teams || [],
    note: admin ? str(b.note, 300) : prev?.note || '',
  };
}

async function checkPin(cfg, id, pin) {
  if (!SID.test(String(id)) || !PIN.test(String(pin || ''))) return 'PIN non valido (4-6 cifre).';
  if (await limited(cfg, `rl:spin:${id}`, 30, 3600)) return 'Troppi tentativi con il PIN: riprova tra un\'ora.';
  const [stored] = await pipeline(cfg, [['HGET', 'staff:pin', id]]);
  if (!stored) return null; // primo accesso: il PIN verrà impostato al salvataggio
  return safeEq(stored, staffPinHash(id, String(pin))) ? null : 'PIN errato.';
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio non attivo: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || 'list';

    // ---- pubblico: solo nome, ruolo e certificazione ----
    if (req.method === 'GET' && action === 'public') {
      const [all, pins] = await pipeline(cfg, [['HGETALL', 'staff:list'], ['HKEYS', 'staff:pin']]);
      const hasPin = new Set(pins || []);
      const items = Object.values(hashToObj(all)).map((j) => JSON.parse(j))
        .filter((s) => s.status !== 'pending')
        .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, role: s.role, teams: s.teams, cert: !!s.certifiedAt, hasPin: hasPin.has(s.id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return send(res, 200, { items });
    }

    // ---- la persona stessa, con il PIN ----
    if (req.method === 'POST' && (action === 'mine' || action === 'self')) {
      if (await limited(cfg, `rl:sself:${ip(req)}`, 60, 3600)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
      const b = await readBody(req);
      const err = await checkPin(cfg, b.id, b.pin);
      if (err) return send(res, 403, { error: err });
      const [raw, stored] = await pipeline(cfg, [['HGET', 'staff:list', b.id], ['HGET', 'staff:pin', b.id]]);
      if (!raw) return send(res, 404, { error: 'Scheda non trovata.' });
      const prev = JSON.parse(raw);
      if (action === 'mine') return send(res, 200, { item: prev, hasPin: !!stored });
      if (b.consent !== true) return send(res, 400, { error: 'Devi accettare l\'informativa privacy.' });
      const data = clean(b, prev, { admin: false });
      if (!data.firstName || !data.lastName) return send(res, 400, { error: 'Inserisci nome e cognome.' });
      if (!data.matricola && !data.docNumber) return send(res, 400, { error: 'Inserisci la matricola o il numero del documento.' });
      const now = Date.now();
      const item = { ...prev, ...data, id: prev.id, certifiedAt: now, updatedAt: now,
        consent: { version: str(b.privacyVersion, 20), at: now, ip: ip(req) } };
      const cmds = [['HSET', 'staff:list', item.id, JSON.stringify(item)]];
      if (!stored) cmds.push(['HSET', 'staff:pin', item.id, staffPinHash(item.id, String(b.pin))]);
      await pipeline(cfg, cmds);
      return send(res, 200, { item, pinSet: !stored });
    }

    // ---- solo amministratore ----
    if (await limited(cfg, `rl:adm:${ip(req)}`, 120, 900)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });

    if (req.method === 'GET' && action === 'list') {
      const [all, pins] = await pipeline(cfg, [['HGETALL', 'staff:list'], ['HKEYS', 'staff:pin']]);
      const hasPin = new Set(pins || []);
      const items = Object.values(hashToObj(all)).map((j) => ({ ...JSON.parse(j), hasPin: false }))
        .map((s) => ({ ...s, hasPin: hasPin.has(s.id) }))
        .map((s) => (isSuper(req) ? s : { ...s, phone: maskTail(s.phone), email: maskTail(s.email), taxCode: maskTail(s.taxCode), consent: undefined }))
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
      return send(res, 200, { items });
    }

    if (req.method === 'POST' && action === 'save') {
      const b = await readBody(req);
      const id = SID.test(String(b.id)) ? b.id : 's-' + crypto.randomBytes(8).toString('hex');
      const [old] = await pipeline(cfg, [['HGET', 'staff:list', id]]);
      const prev = old ? JSON.parse(old) : null;
      const data = clean(b, prev, { admin: true });
      if (!data.firstName || !data.lastName) return send(res, 400, { error: 'Inserisci nome e cognome.' });
      const item = {
        ...(prev || {}), ...data, id,
        createdAt: prev ? prev.createdAt : Date.now(), updatedAt: Date.now(),
      };
      delete item.hasPin;
      await pipeline(cfg, [['HSET', 'staff:list', id, JSON.stringify(item)]]);
      return send(res, 200, { item });
    }

    if (req.method === 'POST' && (action === 'approve' || action === 'reject')) {
      const { id } = await readBody(req);
      if (!SID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      const [raw] = await pipeline(cfg, [['HGET', 'staff:list', id]]);
      if (!raw) return send(res, 404, { error: 'Richiesta non trovata.' });
      const s = JSON.parse(raw);
      if (action === 'reject') {
        await pipeline(cfg, [['HDEL', 'staff:list', id], ['HDEL', 'staff:pin', id]]);
        return send(res, 200, { ok: true });
      }
      // dati inseriti dalla persona stessa con il suo PIN: approvata = certificata
      const now = Date.now();
      const upd = { ...s, status: 'ok', approvedAt: now, certifiedAt: s.certifiedAt || (s.parentId ? now : undefined), updatedAt: now };
      await pipeline(cfg, [['HSET', 'staff:list', id, JSON.stringify(upd)]]);
      return send(res, 200, { item: upd });
    }

    if (req.method === 'POST' && action === 'resetpin') {
      const { id } = await readBody(req);
      if (!SID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      await pipeline(cfg, [['HDEL', 'staff:pin', id]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { id } = await readBody(req);
      if (!SID.test(String(id))) return send(res, 400, { error: 'Id non valido.' });
      await pipeline(cfg, [['HDEL', 'staff:list', id], ['HDEL', 'staff:pin', id]]);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
