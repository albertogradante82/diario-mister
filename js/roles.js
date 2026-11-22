// Due accessi: MISTER (con codice, vede e modifica tutto) e GIOCATORI (senza codice, sola lettura).
import * as db from './db.js';
import { sheet, toast } from './util.js';
import { checkAdminCode, markUnlocked } from './admin.js';
import { fetchClubData } from './clubdata.js';

const KEY = 'mister-role';

function read() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function write(v) {
  try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* */ }
}

/** Ruolo attuale: 'mister', 'giocatore' oppure null (da scegliere). */
export async function getRole() {
  const r = read();
  if (r === 'scelta') return null; // ha fatto "Esci": deve scegliere di nuovo
  if (r) return r;
  // chi usava già l'app con dei dati è un mister
  if ((await db.all('teams')).length) { write('mister'); return 'mister'; }
  return null;
}

export function setRole(r) { write(r); }

export function logout() { write('scelta'); }

/**
 * Accesso mister: chiede il codice; se il telefono non ha ancora dati, carica quelli della società.
 * Restituisce i dati da importare (o null se già presenti) oppure false se annullato.
 */
export function misterLogin() {
  return sheet('Accesso mister', (body, close) => {
    body.innerHTML = `<p class="small muted mb">Inserisci la password del mister.</p>
      <form id="ml" class="form">
        <input id="mlcode" type="password" autocomplete="current-password" autocapitalize="off" placeholder="Password" class="code-input">
        <p class="small warn" id="mlerr" hidden>Password errata</p>
        <button class="btn primary block mt" id="mlbtn">Entra</button>
      </form>`;
    const input = body.querySelector('#mlcode');
    setTimeout(() => input.focus(), 300);
    body.querySelector('#ml').onsubmit = async (e) => {
      e.preventDefault();
      const btn = body.querySelector('#mlbtn');
      if (!(await checkAdminCode(input.value))) {
        body.querySelector('#mlerr').hidden = false;
        input.value = '';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Caricamento dati…';
      markUnlocked();
      write('mister');
      let data = null;
      await db.setMeta('clubCode', input.value.trim());
      if (!(await db.all('teams')).length) {
        try { data = await fetchClubData(input.value); } catch { toast('Dati della società non disponibili: potrai caricarli da Altro.', 4000); }
      }
      close({ data });
    };
  }).then((r) => (r === undefined ? false : r.data));
}
