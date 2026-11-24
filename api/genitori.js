// Accesso genitori: anagrafica del genitore, PIN, collegamento a uno o più figli.
// Il collegamento è immediato se il genitore conosce il PIN della scheda del figlio,
// altrimenti resta "in attesa" finché il mister non lo conferma.
//
// Redis:  par:list   hash parentId -> JSON { id, firstName, lastName, taxCode, phone, email, address, relation, children:[{playerId,status,at}], consent, createdAt, updatedAt }
//         par:pin    hash parentId -> sha256 del PIN
//         par:email  hash email (minuscolo) -> parentId
const crypto = require('crypto');
const { isSuper, maskTail, redisConfig, pipeline, sha, pinHash, parPinHash, safeEq, isAdmin, ip, send, readBody, limited, hashToObj, roster, logActivity } = require('./_lib.js');

const STAFF_ROLES = ['Dirigente accompagnatore', 'Allenatore', 'Allenatore in seconda', 'Preparatore dei portieri', 'Preparatore atletico', 'Medico / massaggiatore', 'Altro'];
const DOCS = ["Carta d'identità", 'Patente', 'Passaporto', 'Altro'];
const staffPinHash = (id, pin) => sha(`mister-staff-pin:${id}:${pin}`);

/** Crea (o aggiorna) la richiesta come accompagnatore collegata al profilo genitore: la approva il mister. */
async function staffRequest(cfg, g, b, pin) {
  const s = b.staff || {};
  const id = g.staffId || 's-' + crypto.randomBytes(8).toString('hex');
  const [old] = await pipeline(cfg, [['HGET', 'staff:list', id]]);
  const prev = old ? JSON.parse(old) : null;
  const now = Date.now();
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const item = {
    ...(prev || {}), id, parentId: g.id, firstName: g.firstName, lastName: g.lastName,
    role: STAFF_ROLES.includes(s.role) ? s.role : prev?.role || 'Dirigente accompagnatore',
    birthDate: g.birthDate || '', birthPlace: str(s.birthPlace, 60), taxCode: g.taxCode || '', address: g.address || '', phone: g.phone || '', email: g.email || '',
    docType: DOCS.includes(s.docType) ? s.docType : DOCS[0], docNumber: str(s.docNumber, 30).toUpperCase(), docIssuedBy: str(s.docIssuedBy, 60),
    docExpiry: D.test(String(s.docExpiry || '')) ? s.docExpiry : '', matricola: str(s.matricola, 30),
    teams: prev?.teams || [], note: prev?.note || 'Richiesta dall\'area genitori',
    status: prev && prev.status === 'ok' ? 'ok' : 'pending', createdAt: prev?.createdAt || now, updatedAt: now,
  };
  await pipeline(cfg, [['HSET', 'staff:list', id, JSON.stringify(item)], ['HSET', 'staff:pin', id, staffPinHash(id, String(pin))]]);
  if (item.status === 'pending') {
    await logActivity(cfg, { type: 'staff', name: `${g.firstName} ${g.lastName}`, role: item.role, staffId: id });
    await notify(cfg, { mister: true }, { title: '🧑‍💼 Richiesta accompagnatore', body: `${g.firstName} ${g.lastName} chiede di essere ${item.role.toLowerCase()}`, url: './#/bacheca', tag: 'staff-' + id });
  }
  return item;
}
const { notify } = require('./_push.js');

const GID = /^g-[0-9a-f]{16}$/;
const PID = /^imp-[0-9a-f]{16}$/;
const PIN = /^\d{4,6}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RELATIONS = ['Madre', 'Padre', 'Tutore', 'Altro'];

function fields(b, prev = {}) {
  return {
    firstName: str(b.firstName ?? prev.firstName, 40), lastName: str(b.lastName ?? prev.lastName, 40),
    relation: RELATIONS.includes(b.relation) ? b.relation : prev.relation || 'Altro',
    taxCode: str(b.taxCode ?? prev.taxCode, 16).toUpperCase(), birthDate: /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthDate || '')) ? b.birthDate : prev.birthDate || '',
    phone: str(b.phone ?? prev.phone, 30), email: str(b.email ?? prev.email, 80).toLowerCase(), address: str(b.address ?? prev.address, 160),
  };
}

/** PIN dei genitori: lo decide il mister, serve per registrarsi ed entrare da un nuovo telefono. */
async function clubPin(cfg) {
  const [cur] = await pipeline(cfg, [['GET', 'par:code']]);
  if (cur) return cur;
  const code = String(crypto.randomInt(100000, 1000000));
  await pipeline(cfg, [['SETNX', 'par:code', code]]);
  const [again] = await pipeline(cfg, [['GET', 'par:code']]);
  return again;
}
async function checkClubPin(cfg, req, b) {
  if (await limited(cfg, `rl:gcode:${ip(req)}`, 20, 3600)) return 'Troppi tentativi, riprova tra un\'ora.';
  const code = await clubPin(cfg);
  return safeEq(String(b.clubPin || '').trim(), code) ? null : 'PIN genitori della società errato: chiedilo al mister.';
}

async function auth(cfg, id, pin) {
  if (!GID.test(String(id)) || !PIN.test(String(pin || ''))) return { error: 'Accesso non valido.', status: 400 };
  if (await limited(cfg, `rl:gpin:${id}`, 60, 3600)) return { error: 'Troppi tentativi con il PIN: riprova tra un\'ora.', status: 429 };
  const [stored, raw] = await pipeline(cfg, [['HGET', 'par:pin', id], ['HGET', 'par:list', id]]);
  if (!stored || !raw || !safeEq(stored, parPinHash(id, String(pin)))) return { error: 'Email o PIN errati.', status: 403 };
  return { g: JSON.parse(raw) };
}

/** Profilo con i nomi dei figli (dalla rosa pubblica). */
async function withNames(req, g, cfg) {
  const r = await roster(req);
  let staff = null;
  if (g.staffId && cfg) {
    const [raw] = await pipeline(cfg, [['HGET', 'staff:list', g.staffId]]);
    if (raw) { const s = JSON.parse(raw); staff = { status: s.status || 'ok', role: s.role, matricola: s.matricola, docType: s.docType, docNumber: s.docNumber, docExpiry: s.docExpiry, docIssuedBy: s.docIssuedBy, birthPlace: s.birthPlace }; }
  }
  return {
    ...g, staff,
    children: (g.children || []).map((c) => ({ ...c, name: r.players[c.playerId]?.name || 'Giocatore', teamId: r.players[c.playerId]?.teamId || '', team: r.teams[r.players[c.playerId]?.teamId]?.name || '' })),
  };
}

module.exports = async function handler(req, res) {
  try {
    const cfg = redisConfig();
    if (!cfg) return send(res, 503, { error: 'Servizio non attivo: collega il database su Vercel.' });
    const action = new URL(req.url, 'http://x').searchParams.get('action') || '';

    if (req.method === 'POST' && action === 'register') {
      if (await limited(cfg, `rl:greg:${ip(req)}`, 10, 3600)) return send(res, 429, { error: 'Troppe registrazioni da questa rete, riprova più tardi.' });
      const b = await readBody(req);
      const ce = await checkClubPin(cfg, req, b);
      if (ce) return send(res, 403, { error: ce });
      const f = fields(b);
      if (!f.firstName || !f.lastName) return send(res, 400, { error: 'Inserisci nome e cognome.' });
      if (!EMAIL.test(f.email)) return send(res, 400, { error: 'Inserisci un\'email valida: serve per accedere da un altro telefono.' });
      if (!PIN.test(String(b.pin || ''))) return send(res, 400, { error: 'Il PIN deve avere da 4 a 6 cifre.' });
      if (b.consent !== true) return send(res, 400, { error: 'Devi accettare l\'informativa privacy.' });
      const id = 'g-' + crypto.randomBytes(8).toString('hex');
      const [taken] = await pipeline(cfg, [['HSETNX', 'par:email', f.email, id]]);
      if (!Number(taken)) return send(res, 409, { error: 'Questa email è già registrata: usa "Ho già un profilo".' });
      const now = Date.now();
      const g = { id, ...f, children: [], consent: { version: str(b.privacyVersion, 20), at: now, ip: ip(req) }, createdAt: now, updatedAt: now };
      if (b.asStaff === true) g.staffId = 's-' + crypto.randomBytes(8).toString('hex');
      await pipeline(cfg, [['HSET', 'par:list', id, JSON.stringify(g)], ['HSET', 'par:pin', id, parPinHash(id, String(b.pin))]]);
      if (g.staffId) await staffRequest(cfg, g, b, b.pin);
      return send(res, 200, { parent: await withNames(req, g, cfg) });
    }

    if (req.method === 'POST' && action === 'login') {
      if (await limited(cfg, `rl:glog:${ip(req)}`, 30, 3600)) return send(res, 429, { error: 'Troppi tentativi, riprova più tardi.' });
      const b = await readBody(req);
      const ce = await checkClubPin(cfg, req, b);
      if (ce) return send(res, 403, { error: ce });
      const [id] = await pipeline(cfg, [['HGET', 'par:email', str(b.email, 80).toLowerCase()]]);
      if (!id) return send(res, 403, { error: 'Email o PIN errati.' });
      const a = await auth(cfg, id, b.pin);
      if (a.error) return send(res, a.status, { error: a.error });
      return send(res, 200, { parent: await withNames(req, a.g, cfg) });
    }

    if (req.method === 'POST' && ['me', 'update', 'link', 'unlink', 'erase', 'staff'].includes(action)) {
      const b = await readBody(req);
      const a = await auth(cfg, b.id, b.pin);
      if (a.error) return send(res, a.status, { error: a.error });
      const g = a.g;
      if (action === 'me') return send(res, 200, { parent: await withNames(req, g, cfg) });

      if (action === 'staff') {
        // diventa (o aggiorna i dati come) accompagnatore: serve l'approvazione del mister
        const upd = { ...g, staffId: g.staffId || 's-' + crypto.randomBytes(8).toString('hex'), updatedAt: Date.now() };
        await pipeline(cfg, [['HSET', 'par:list', g.id, JSON.stringify(upd)]]);
        await staffRequest(cfg, upd, b, b.pin);
        return send(res, 200, { parent: await withNames(req, upd, cfg) });
      }

      if (action === 'update') {
        const f = fields(b, g);
        if (!f.firstName || !f.lastName) return send(res, 400, { error: 'Inserisci nome e cognome.' });
        if (!EMAIL.test(f.email)) return send(res, 400, { error: 'Email non valida.' });
        const cmds = [];
        if (f.email !== g.email) {
          const [taken] = await pipeline(cfg, [['HSETNX', 'par:email', f.email, g.id]]);
          if (!Number(taken)) return send(res, 409, { error: 'Questa email è già usata da un altro profilo.' });
          cmds.push(['HDEL', 'par:email', g.email]);
        }
        const upd = { ...g, ...f, updatedAt: Date.now() };
        cmds.push(['HSET', 'par:list', g.id, JSON.stringify(upd)]);
        if (PIN.test(String(b.newPin || ''))) cmds.push(['HSET', 'par:pin', g.id, parPinHash(g.id, String(b.newPin))]);
        await pipeline(cfg, cmds);
        return send(res, 200, { parent: await withNames(req, upd, cfg) });
      }

      if (action === 'link') {
        if (!PID.test(String(b.playerId))) return send(res, 400, { error: 'Scegli il giocatore.' });
        const r = await roster(req);
        if (!r.players[b.playerId]) return send(res, 404, { error: 'Giocatore non trovato.' });
        const children = (g.children || []).filter((c) => c.playerId !== b.playerId);
        if (children.length >= 6) return send(res, 400, { error: 'Puoi collegare al massimo 6 giocatori.' });
        let status = 'pending';
        if (b.childPin) {
          if (!PIN.test(String(b.childPin))) return send(res, 400, { error: 'PIN del figlio non valido.' });
          if (await limited(cfg, `rl:pin:${b.playerId}`, 30, 3600)) return send(res, 429, { error: 'Troppi tentativi con il PIN.' });
          const [stored] = await pipeline(cfg, [['HGET', 'prof:pin', b.playerId]]);
          if (!stored || !safeEq(stored, pinHash(b.playerId, String(b.childPin)))) return send(res, 403, { error: 'PIN della scheda del figlio errato. Lascialo vuoto per chiedere la conferma al mister.' });
          status = 'ok';
        }
        const upd = { ...g, children: [...children, { playerId: b.playerId, status, at: Date.now() }], updatedAt: Date.now() };
        await pipeline(cfg, [['HSET', 'par:list', g.id, JSON.stringify(upd)]]);
        if (status === 'pending') {
          await logActivity(cfg, { type: 'genitore', name: `${g.firstName} ${g.lastName}`, player: r.players[b.playerId].name, parentId: g.id, playerId: b.playerId });
          await notify(cfg, { mister: true }, { title: '👨‍👩‍👧 Richiesta genitore', body: `${g.firstName} ${g.lastName} chiede di collegarsi a ${r.players[b.playerId].name}`, url: './#/genitori', tag: 'par-' + g.id });
        }
        return send(res, 200, { parent: await withNames(req, upd, cfg), status });
      }

      if (action === 'unlink') {
        const upd = { ...g, children: (g.children || []).filter((c) => c.playerId !== b.playerId), updatedAt: Date.now() };
        await pipeline(cfg, [['HSET', 'par:list', g.id, JSON.stringify(upd)]]);
        return send(res, 200, { parent: await withNames(req, upd, cfg) });
      }

      if (action === 'erase') {
        await pipeline(cfg, [['HDEL', 'par:list', g.id], ['HDEL', 'par:pin', g.id], ['HDEL', 'par:email', g.email]]);
        return send(res, 200, { ok: true });
      }
    }

    // ---- solo amministratore ----
    if (await limited(cfg, `rl:adm:${ip(req)}`, 120, 900)) return send(res, 429, { error: 'Troppe richieste, riprova più tardi.' });
    if (!isAdmin(req)) return send(res, 401, { error: 'Password amministratore errata.' });

    if (req.method === 'GET' && action === 'list') {
      const [all] = await pipeline(cfg, [['HGETALL', 'par:list']]);
      const items = await Promise.all(Object.values(hashToObj(all)).map((j) => withNames(req, JSON.parse(j), cfg)));
      items.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
      const full = isSuper(req);
      return send(res, 200, { full, items: full ? items : items.map((g) => ({ ...g, phone: maskTail(g.phone), email: maskTail(g.email), taxCode: maskTail(g.taxCode), consent: undefined })) });
    }

    if (req.method === 'GET' && action === 'code') return send(res, 200, { code: await clubPin(cfg) });

    if (req.method === 'POST' && action === 'setcode') {
      const { code } = await readBody(req);
      if (!/^\d{4,8}$/.test(String(code || ''))) return send(res, 400, { error: 'Il PIN genitori deve avere da 4 a 8 cifre.' });
      await pipeline(cfg, [['SET', 'par:code', String(code)]]);
      return send(res, 200, { code: String(code) });
    }

    if (req.method === 'POST' && (action === 'approve' || action === 'reject')) {
      const b = await readBody(req);
      if (!GID.test(String(b.parentId)) || !PID.test(String(b.playerId))) return send(res, 400, { error: 'Dati non validi.' });
      const [raw] = await pipeline(cfg, [['HGET', 'par:list', b.parentId]]);
      if (!raw) return send(res, 404, { error: 'Genitore non trovato.' });
      const g = JSON.parse(raw);
      g.children = action === 'approve'
        ? (g.children || []).map((c) => (c.playerId === b.playerId ? { ...c, status: 'ok', approvedAt: Date.now() } : c))
        : (g.children || []).filter((c) => c.playerId !== b.playerId);
      await pipeline(cfg, [['HSET', 'par:list', g.id, JSON.stringify(g)]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'resetpin') {
      const { parentId, newPin } = await readBody(req);
      if (!GID.test(String(parentId)) || !PIN.test(String(newPin || ''))) return send(res, 400, { error: 'Scegli un PIN di 4-6 cifre.' });
      await pipeline(cfg, [['HSET', 'par:pin', parentId, parPinHash(parentId, String(newPin))]]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { parentId } = await readBody(req);
      if (!GID.test(String(parentId))) return send(res, 400, { error: 'Id non valido.' });
      const [raw] = await pipeline(cfg, [['HGET', 'par:list', parentId]]);
      const cmds = [['HDEL', 'par:list', parentId], ['HDEL', 'par:pin', parentId]];
      if (raw) cmds.push(['HDEL', 'par:email', JSON.parse(raw).email]);
      await pipeline(cfg, cmds);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'Richiesta non valida.' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Errore del server' });
  }
};
