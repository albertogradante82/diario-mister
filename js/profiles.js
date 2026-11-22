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
  // ad ogni lettura dell'elenco dimentico le foto già viste, così una foto nuova compare subito
  photoCache.clear();
  try { return (await call(`${API}?action=list`)).profiles || {}; } catch { return {}; }
}

export async function getPhoto(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  const p = call(`${API}?action=photo&id=${encodeURIComponent(id)}`).then((d) => d.photo).catch(() => null);
  photoCache.set(id, p);
  // se la foto non c'è (ancora) non la ricordo: al prossimo controllo la riscarica
  p.then((ph) => { if (!ph) photoCache.delete(id); });
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

/** Cancella la scheda (giocatore con PIN, oppure mister con la password). */
export async function eraseProfile(id, { pin, adminCode } = {}) {
  const r = await call(`${API}?action=erase`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(adminCode ? { 'x-admin-code': adminCode } : {}) }, body: JSON.stringify({ id, pin }) });
  photoCache.delete(id);
  return r;
}

/** Dati privati del giocatore, verificando il suo PIN. */
export async function myPrivate(id, pin) {
  return (await call(`${API}?action=mine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pin }) })).priv || {};
}

/**
 * Sostituisce con la foto inviata dal ragazzo ogni elemento [data-rphoto="<id>"]
 * che non ha già un'immagine (es. avatar con le iniziali).
 */
export async function fillPhotos(root) {
  const all = [...root.querySelectorAll('[data-rphoto]')];
  if (!all.length) return;
  const profs = await listProfiles();
  // ★ verde = profilo certificato (scheda compilata dal ragazzo con il suo PIN)
  all.forEach((el) => {
    if (!profs[el.dataset.rphoto] || el.querySelector('.vstar')) return;
    el.classList.add('verified');
    const big = parseInt(el.style.width, 10) >= 60 || el.offsetWidth >= 60;
    el.insertAdjacentHTML('beforeend', `<i class="vstar${big ? ' vstar-lg' : ''}" title="Profilo certificato">★</i>`);
  });
  const els = all.filter((el) => !el.querySelector('img'));
  els.forEach(async (el) => {
    const id = el.dataset.rphoto;
    if (!profs[id]?.hasPhoto) return;
    const ph = await getPhoto(id);
    if (!ph || !el.isConnected && !root.contains(el)) return;
    const star = el.querySelector('.vstar');
    el.innerHTML = `<img src="${ph}" alt="">`;
    if (star) el.appendChild(star);
  });
}
