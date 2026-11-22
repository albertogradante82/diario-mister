// Schede compilate dai giocatori (api/profili.js).
const API = './api/profili';
const photoCache = new Map();

async function call(url, opts = {}) {
  let r;
  try { r = await fetch(url, { cache: 'no-store', ...opts }); } catch { throw new Error('Nessuna connessione.'); }
  let data = {};
  try { data = await r.json(); } catch { /* */ }
  if (!r.ok) { const e = new Error(data.error || `Errore ${r.status}`); e.status = r.status; throw e; }
  return data;
}

/** { id: { birthDate, hasPhoto, updatedAt } } – oppure {} se il servizio non è attivo. */
export async function listProfiles() {
  try { return (await call(`${API}?action=list`)).profiles || {}; } catch { return {}; }
}

export async function getPhoto(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  const p = call(`${API}?action=photo&id=${encodeURIComponent(id)}`).then((d) => d.photo).catch(() => null);
  photoCache.set(id, p);
  return p;
}

export async function saveProfile(data) {
  const r = await call(`${API}?action=save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  photoCache.delete(data.id);
  return r;
}

export async function privateProfiles(adminCode) {
  return (await call(`${API}?action=private`, { headers: { 'x-admin-code': adminCode } })).profiles || {};
}

export async function resetPin(adminCode, id) {
  return call(`${API}?action=resetpin`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-code': adminCode }, body: JSON.stringify({ id }) });
}

/** Il servizio schede è attivo? */
export async function serviceActive() {
  try { await call(`${API}?action=list`); return true; } catch (e) { return e.status !== 503 && e.status !== 404 ? true : false; }
}

/** Dati privati del giocatore, verificando il suo PIN. */
export async function myPrivate(id, pin) {
  return (await call(`${API}?action=mine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pin }) })).priv || {};
}
