// Sincronizzazione con l'archivio condiviso (api/sync.js).
// Ogni telefono lavora sulla propria copia locale (funziona offline) e scambia le modifiche col server.
import * as db from './db.js';

const API = './api/sync';
const MAX_BATCH_BYTES = 900_000;

let running = null;
let timer = null;
let debounce = null;
const listeners = new Set();
export const status = { state: 'off', pending: 0, lastSync: null, error: null };

export function onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }
function emit(patch) { Object.assign(status, patch); listeners.forEach((fn) => fn(status)); }

export async function getConfig() {
  return (await db.getMeta('sync')) || { enabled: false, code: '', cursor: 0 };
}
async function setConfig(cfg) { await db.setMeta('sync', cfg); }

async function call(code, action, { method = 'GET', body, query = '' } = {}) {
  let r;
  try {
    r = await fetch(`${API}?action=${action}${query}`, {
      method,
      headers: { 'x-access-code': code, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    const e = new Error('Nessuna connessione');
    e.offline = true;
    throw e;
  }
  let data = {};
  try { data = await r.json(); } catch { /* risposta non JSON */ }
  if (!r.ok) {
    const e = new Error(data.error || `Errore ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

/** Verifica il codice e attiva la sincronizzazione. */
export async function connect(code, { uploadLocal = false } = {}) {
  code = code.trim();
  await call(code, 'ping');
  await setConfig({ enabled: true, code, cursor: 0 });
  if (uploadLocal) await db.queueAll();
  start();
  return syncNow();
}

export async function disconnect() {
  const cfg = await getConfig();
  await setConfig({ ...cfg, enabled: false });
  stop();
  emit({ state: 'off', error: null });
}

/** Invia le modifiche locali e scarica quelle degli altri. Restituisce {sent, received}. */
export function syncNow() {
  if (running) return running;
  running = (async () => {
    const cfg = await getConfig();
    if (!cfg.enabled) { emit({ state: 'off' }); return { sent: 0, received: 0 }; }
    if (!navigator.onLine) { await refreshPending(); emit({ state: 'offline' }); return { sent: 0, received: 0 }; }
    emit({ state: 'syncing', error: null });
    let sent = 0, received = 0;
    try {
      // 1. invio
      const queue = (await db.outbox()).sort((a, b) => a.at - b.at);
      let batch = [], entries = [], size = 0;
      const flush = async () => {
        if (!batch.length) return;
        await call(cfg.code, 'push', { method: 'POST', body: { changes: batch } });
        await db.clearOutbox(entries);
        sent += batch.length;
        batch = []; entries = []; size = 0;
      };
      for (const q of queue) {
        let record;
        if (q.op === 'del') record = { id: q.recId, _deleted: true, updatedAt: q.at };
        else {
          record = await db.getRaw(q.store, q.recId);
          if (!record) record = { id: q.recId, _deleted: true, updatedAt: q.at };
        }
        const len = JSON.stringify(record).length;
        if (size + len > MAX_BATCH_BYTES) await flush();
        batch.push({ store: q.store, record });
        entries.push(q);
        size += len;
      }
      await flush();

      // 2. ricezione
      let cursor = cfg.cursor || 0, more = true;
      while (more) {
        const res = await call(cfg.code, 'pull', { query: `&since=${cursor}` });
        received += await db.applyRemote(res.items || []);
        cursor = res.cursor;
        more = res.more;
        await setConfig({ ...(await getConfig()), cursor });
      }
      await refreshPending();
      emit({ state: 'ok', lastSync: Date.now(), error: null });
      return { sent, received };
    } catch (e) {
      await refreshPending();
      emit({ state: e.offline ? 'offline' : 'error', error: e.message });
      if (e.status === 401) await setConfig({ ...(await getConfig()), enabled: false });
      throw e;
    }
  })().finally(() => { running = null; });
  return running;
}

async function refreshPending() {
  emit({ pending: (await db.outbox()).length });
}

let onReceive = null;
/** Callback chiamata quando arrivano dati dagli altri mister (per aggiornare la schermata). */
export function onRemoteData(fn) { onReceive = fn; }

async function backgroundSync() {
  try {
    const r = await syncNow();
    if (r.received && onReceive) onReceive(r);
  } catch { /* lo stato mostra l'errore */ }
}

export async function start() {
  const cfg = await getConfig();
  if (!cfg.enabled) { emit({ state: 'off' }); return; }
  stop();
  db.onLocalChange(() => {
    refreshPending();
    clearTimeout(debounce);
    debounce = setTimeout(backgroundSync, 2500);
  });
  timer = setInterval(() => { if (document.visibilityState === 'visible') backgroundSync(); }, 30000);
  backgroundSync();
}

function stop() {
  clearInterval(timer);
  clearTimeout(debounce);
  timer = null;
  db.onLocalChange(null);
}

window.addEventListener('online', () => backgroundSync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') backgroundSync(); });
