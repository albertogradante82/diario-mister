// Protezione delle importazioni con codice amministratore.
// Nel codice c'è solo l'impronta SHA-256 del codice, non il codice stesso.
// Nota: è una protezione dell'interfaccia (impedisce importazioni per errore o da chi non è admin),
// non una cifratura dei dati.
import { sheet, toast, chooseFile } from './util.js';

const ADMIN_HASH = '4e2b675ce189f521819362d26a421185528c788a0f7a1293108df1c50d13b4f6';
const UNLOCK_MINUTES = 10;
let unlockedUntil = 0;

async function hash(code) {
  const data = new TextEncoder().encode('mister-admin:' + code.trim());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sblocca la modalità admin (es. dopo aver decifrato i dati della società con lo stesso codice). */
export function markUnlocked() {
  unlockedUntil = Date.now() + UNLOCK_MINUTES * 60000;
}

export function isUnlocked() {
  return Date.now() < unlockedUntil;
}

/** Chiede il codice admin; risolve true se corretto (resta sbloccato per qualche minuto). */
export async function requireAdmin(reason = 'Questa operazione è riservata all\'amministratore.') {
  if (isUnlocked()) return true;
  const ok = await sheet('Codice amministratore', (body, close) => {
    body.innerHTML = `<p class="small muted mb">${reason}</p>
      <form id="adm" class="form">
        <input id="admcode" type="password" autocomplete="off" autocapitalize="off" placeholder="Codice admin" class="code-input">
        <p class="small warn" id="admerr" hidden>Codice errato</p>
        <button class="btn primary block mt">Sblocca</button>
      </form>`;
    const input = body.querySelector('#admcode');
    setTimeout(() => input.focus(), 300);
    body.querySelector('#adm').onsubmit = async (e) => {
      e.preventDefault();
      if ((await hash(input.value)) === ADMIN_HASH) close(true);
      else {
        body.querySelector('#admerr').hidden = false;
        input.value = '';
      }
    };
  });
  if (ok) {
    unlockedUntil = Date.now() + UNLOCK_MINUTES * 60000;
    toast('Modalità amministratore attiva');
    return true;
  }
  return false;
}

/**
 * Scelta di un file riservata all'amministratore.
 * Dopo l'inserimento del codice serve un nuovo tocco per aprire i file (requisito di Safari su iPhone).
 */
export async function chooseFileAsAdmin(accept, reason) {
  if (isUnlocked()) return chooseFile(accept);
  if (!(await requireAdmin(reason))) return null;
  return sheet('Importazione', (body, close) => {
    body.innerHTML = `<p class="small muted mb">Codice corretto. Ora scegli il file da importare.</p>
      <button class="btn primary block" id="pickfile">Scegli file</button>`;
    body.querySelector('#pickfile').onclick = async () => {
      const f = await chooseFile(accept);
      close(f || null);
    };
  });
}
