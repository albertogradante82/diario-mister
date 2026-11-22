// Archivio locale su IndexedDB. Nessun dato lascia il dispositivo.
const DB_NAME = 'mister-db';
const DB_VERSION = 2;
export const STORES = ['teams', 'seasons', 'players', 'matches', 'events', 'tracking', 'meta'];
/** Archivi sincronizzati con l'archivio condiviso online. */
export const SYNC_STORES = ['teams', 'seasons', 'players', 'matches', 'events', 'tracking'];

// Avvisa il modulo di sincronizzazione quando ci sono modifiche locali da inviare.
let changeListener = null;
export function onLocalChange(fn) { changeListener = fn; }
function notify() { if (changeListener) try { changeListener(); } catch { /* */ } }

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const make = (name, indexes = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, { keyPath: 'id' });
        indexes.forEach((i) => s.createIndex(i, i));
      };
      make('teams');
      make('seasons', ['teamId']);
      make('players', ['seasonId', 'teamId']);
      make('matches', ['seasonId', 'teamId']);
      make('events', ['matchId']);
      make('tracking', ['matchId', 'playerId']);
      make('meta');
      make('outbox'); // modifiche locali in attesa di invio all'archivio condiviso
    };
    req.onsuccess = () => {
      const db = req.result;
      // se un'altra copia dell'app (più nuova) deve aggiornare l'archivio, liberalo
      db.onversionchange = () => { db.close(); dbPromise = null; location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // una copia vecchia dell'app aperta in background blocca l'aggiornamento dell'archivio
    req.onblocked = () => {
      const v = document.getElementById('view');
      if (v) v.innerHTML = '<div class="card"><p><strong>Aggiornamento in corso</strong></p><p class="small">Chiudi del tutto l\'app (anche le altre finestre o schede aperte con l\'app) e riaprila.</p></div>';
    };
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function get(name, id) {
  if (id == null) return undefined;
  return wrap((await store(name)).get(id));
}

export async function all(name) {
  return wrap((await store(name)).getAll());
}

export async function where(name, index, value) {
  if (value == null) return [];
  return wrap((await store(name)).index(index).getAll(value));
}

const tracked = (name) => SYNC_STORES.includes(name);

function done(tx, value) {
  return new Promise((res, rej) => { tx.oncomplete = () => res(value); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export async function put(name, obj) {
  return (await putMany(name, [obj]))[0];
}

export async function putMany(name, list) {
  if (!list.length) return list;
  const db = await open();
  const names = tracked(name) ? [name, 'outbox'] : [name];
  const tx = db.transaction(names, 'readwrite');
  const s = tx.objectStore(name);
  const now = Date.now();
  list.forEach((o) => {
    if (!o.id) o.id = uid();
    o.updatedAt = now;
    s.put(o);
    if (tracked(name)) tx.objectStore('outbox').put({ id: `${name}:${o.id}`, store: name, recId: o.id, op: 'put', at: now });
  });
  await done(tx, list);
  if (tracked(name)) notify();
  return list;
}

export async function del(name, id) {
  return delMany(name, [id]);
}

export async function delMany(name, ids) {
  if (!ids.length) return;
  const db = await open();
  const names = tracked(name) ? [name, 'outbox'] : [name];
  const tx = db.transaction(names, 'readwrite');
  const now = Date.now();
  ids.forEach((id) => {
    tx.objectStore(name).delete(id);
    if (tracked(name)) tx.objectStore('outbox').put({ id: `${name}:${id}`, store: name, recId: id, op: 'del', at: now });
  });
  await done(tx);
  if (tracked(name)) notify();
}

// ---------- Supporto alla sincronizzazione ----------

export async function outbox() {
  return all('outbox');
}

/** Rimuove dalla coda le voci inviate (solo se non sono cambiate nel frattempo). */
export async function clearOutbox(entries) {
  const db = await open();
  const tx = db.transaction('outbox', 'readwrite');
  const os = tx.objectStore('outbox');
  entries.forEach((e) => {
    const r = os.get(e.id);
    r.onsuccess = () => { if (r.result && r.result.at === e.at) os.delete(e.id); };
  });
  return done(tx);
}

/** Applica record arrivati dall'archivio condiviso, senza rimetterli in coda. */
export async function applyRemote(items) {
  if (!items.length) return 0;
  const db = await open();
  const tx = db.transaction([...SYNC_STORES, 'outbox'], 'readwrite');
  const ob = tx.objectStore('outbox');
  let changed = 0;
  items.forEach(({ store: name, record }) => {
    if (!SYNC_STORES.includes(name)) return;
    const pending = ob.get(`${name}:${record.id}`);
    pending.onsuccess = () => {
      // una modifica locale più recente non ancora inviata vince
      if (pending.result && pending.result.at > (record.updatedAt || 0)) return;
      const os = tx.objectStore(name);
      const local = os.get(record.id);
      local.onsuccess = () => {
        const cur = local.result;
        if (record._deleted) {
          if (cur) { os.delete(record.id); changed++; }
        } else if (!cur || cur.updatedAt !== record.updatedAt) {
          // eslint-disable-next-line no-unused-vars
          const { serverSeq, ...rec } = record;
          os.put(rec);
          changed++;
        }
      };
    };
  });
  await done(tx);
  return changed;
}

/** Mette in coda tutti i dati locali (primo caricamento nell'archivio condiviso). */
export async function queueAll() {
  const db = await open();
  const now = Date.now();
  let n = 0;
  for (const name of SYNC_STORES) {
    const list = await all(name);
    const tx = db.transaction('outbox', 'readwrite');
    list.forEach((o) => { tx.objectStore('outbox').put({ id: `${name}:${o.id}`, store: name, recId: o.id, op: 'put', at: now }); n++; });
    await done(tx);
  }
  notify();
  return n;
}

export async function getRaw(name, id) {
  return get(name, id);
}

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}

export async function setMeta(key, value) {
  return put('meta', { id: key, value });
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
}

// ---------- Backup completo ----------

export async function exportAll() {
  const data = {};
  for (const s of STORES) data[s] = await all(s);
  return { app: 'mister-app', version: 1, exportedAt: new Date().toISOString(), data };
}

export async function importAll(backup) {
  if (!backup || backup.app !== 'mister-app' || !backup.data) throw new Error('File di backup non valido.');
  // la configurazione dell'archivio condiviso resta quella di questo telefono
  const syncCfg = await get('meta', 'sync');
  const db = await open();
  const tx = db.transaction([...STORES, 'outbox'], 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    os.clear();
    (backup.data[s] || []).forEach((o) => { if (!(s === 'meta' && o.id === 'sync')) os.put(o); });
  }
  if (syncCfg) tx.objectStore('meta').put({ ...syncCfg, value: { ...syncCfg.value, cursor: 0 } });
  tx.objectStore('outbox').clear();
  return done(tx);
}

/** Elimina una partita con eventi e tracking collegati. */
export async function deleteMatch(id) {
  const ev = await where('events', 'matchId', id);
  const tr = await where('tracking', 'matchId', id);
  await delMany('events', ev.map((e) => e.id));
  await delMany('tracking', tr.map((t) => t.id));
  await del('matches', id);
}

/** Elimina una stagione con tutto il contenuto. */
export async function deleteSeason(id) {
  const matches = await where('matches', 'seasonId', id);
  for (const m of matches) await deleteMatch(m.id);
  const players = await where('players', 'seasonId', id);
  await delMany('players', players.map((p) => p.id));
  await del('seasons', id);
}

export async function deleteTeam(id) {
  const seasons = await where('seasons', 'teamId', id);
  for (const s of seasons) await deleteSeason(s.id);
  await del('teams', id);
}

/** Chiede al browser di non cancellare i dati in caso di poco spazio. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignorato */ }
  return false;
}
