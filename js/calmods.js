// Partite spostate dal mister: valgono sopra al calendario ufficiale, per tutti i telefoni.
import * as db from './db.js';
import { sheet, toast, esc, fmtDate } from './util.js';

const API = './api/calendario';

export async function fetchMods() {
  try {
    const r = await fetch(`${API}?action=list`, { cache: 'no-store' });
    if (!r.ok) return {};
    return (await r.json()).mods || {};
  } catch { return {}; }
}

/** Area giocatori: applica gli spostamenti ai dati pubblici. */
export async function applyModsToPublic(d) {
  const mods = await fetchMods();
  d.matches.forEach((m) => {
    const x = mods[m.id];
    if (x) { m.date = x.date; m.time = x.time; if (x.place) m.place = x.place; m.moved = true; }
  });
  return d;
}

/** Area mister: riporta gli spostamenti nelle partite salvate sul telefono. Restituisce quante ne ha cambiate. */
export async function applyModsToDb() {
  const mods = await fetchMods();
  let n = 0;
  for (const x of Object.values(mods)) {
    const m = await db.get('matches', x.matchId);
    if (!m) continue;
    if (m.date !== x.date || (m.time || '') !== x.time || (x.place && m.place !== x.place) || !m.moved) {
      await db.put('matches', { ...m, date: x.date, time: x.time, place: x.place || m.place, moved: true });
      n++;
    }
  }
  return n;
}

/** Salva lo spostamento per tutti e avvisa i ragazzi della squadra. */
export async function saveMod(m, title, { notify = true } = {}) {
  const code = await db.getMeta('clubCode');
  if (!code) throw new Error('Serve la password: carica prima i dati del Calcio Palazzo (Altro).');
  const r = await fetch(`${API}?action=save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-code': code },
    body: JSON.stringify({ matchId: m.id, teamId: m.teamId, date: m.date, time: m.time || '', place: m.place || '', title, notify }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Errore di rete');
  return j;
}

/** Foglio rapido "Cambia data e ora". Restituisce true se salvato. */
export async function moveMatchSheet(m, title) {
  return sheet('📅 Cambia data e ora', (body, close) => {
    body.innerHTML = `<form class="form" id="mv">
      <p class="small muted">${esc(title)} · ora: <strong>${esc(fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'short' }))}${m.time ? ' ore ' + esc(m.time) : ''}</strong></p>
      <div class="row gap">
        <label class="grow">Nuova data<input type="date" name="date" required value="${esc(m.date)}"></label>
        <label class="grow">Ora<input type="time" name="time" value="${esc(m.time || '')}"></label>
      </div>
      <label>Campo / luogo <span class="muted">(facoltativo)</span><input name="place" value="${esc(m.place || '')}" maxlength="120"></label>
      <label class="switch small"><input type="checkbox" name="notify" checked> Avvisa i ragazzi con una notifica</label>
      <button class="btn primary block mt">Salva per tutti</button>
      <p class="small muted mt">La modifica vale per tutti: calendario del mister, dei ragazzi e convocazioni collegate. Gli aggiornamenti dei dati ufficiali non la cancellano.</p>
    </form>`;
    body.querySelector('#mv').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = body.querySelector('button'); btn.disabled = true; btn.textContent = 'Salvataggio…';
      const upd = { ...m, date: f.get('date'), time: f.get('time') || '', place: String(f.get('place') || '').trim(), moved: true };
      try {
        const res = await saveMod(upd, title, { notify: !!f.get('notify') });
        await db.put('matches', upd);
        toast(`Partita spostata ✓${res.sent ? ` · avvisati ${res.sent} telefoni` : ''}`, 3500);
        close(true);
      } catch (err) { toast(err.message, 4500); btn.disabled = false; btn.textContent = 'Salva per tutti'; }
    };
  });
}
