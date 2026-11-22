// Archivio locale su IndexedDB. Nessun dato lascia il dispositivo.
const DB_NAME = 'mister-db';
const DB_VERSION = 1;
export const STORES = ['teams', 'seasons', 'players', 'matches', 'events', 'tracking', 'meta'];

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

export async function put(name, obj) {
  if (!obj.id) obj.id = uid();
  obj.updatedAt = Date.now();
  await wrap((await store(name, 'readwrite')).put(obj));
  return obj;
}

export async function putMany(name, list) {
  const db = await open();
  const tx = db.transaction(name, 'readwrite');
  const s = tx.objectStore(name);
  list.forEach((o) => { if (!o.id) o.id = uid(); s.put(o); });
  return new Promise((res, rej) => { tx.oncomplete = () => res(list); tx.onerror = () => rej(tx.error); });
}

export async function del(name, id) {
  return wrap((await store(name, 'readwrite')).delete(id));
}

export async function delMany(name, ids) {
  if (!ids.length) return;
  const db = await open();
  const tx = db.transaction(name, 'readwrite');
  ids.forEach((id) => tx.objectStore(name).delete(id));
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
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
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    os.clear();
    (backup.data[s] || []).forEach((o) => os.put(o));
  }
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
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
