// Dati della società (rose e calendari) pubblicati con l'app in forma cifrata.
// Si sbloccano con il codice amministratore: senza codice il file non è leggibile.
import { sheet, toast } from './util.js';
import { markUnlocked } from './admin.js';

const URL_DATA = './dati/societa.enc.json';

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decrypt(pkg, code) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim()), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(pkg.salt), iterations: pkg.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(pkg.iv) }, key, b64(pkg.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Chiede il codice, decifra e restituisce i dati della società (oppure null se annullato). */
export async function unlockClubData() {
  let pkg;
  try {
    const r = await fetch(URL_DATA, { cache: 'no-cache' });
    if (!r.ok) throw new Error();
    pkg = await r.json();
  } catch {
    toast('Dati della società non disponibili: controlla la connessione.', 4000);
    return null;
  }
  return sheet('Dati della società', (body, close) => {
    body.innerHTML = `<p class="small muted mb">Inserisci il codice amministratore per caricare squadre, giocatori e calendari del Calcio Palazzo.</p>
      <form id="cd" class="form">
        <input id="cdcode" type="password" autocomplete="off" autocapitalize="off" placeholder="Codice admin" class="code-input">
        <p class="small warn" id="cderr" hidden>Codice errato</p>
        <button class="btn primary block mt" id="cdbtn">Carica i dati</button>
      </form>`;
    const input = body.querySelector('#cdcode');
    setTimeout(() => input.focus(), 300);
    body.querySelector('#cd').onsubmit = async (e) => {
      e.preventDefault();
      const btn = body.querySelector('#cdbtn');
      btn.disabled = true;
      btn.textContent = 'Verifica…';
      try {
        const data = await decrypt(pkg, input.value);
        markUnlocked();
        close(data);
      } catch {
        body.querySelector('#cderr').hidden = false;
        input.value = '';
        btn.disabled = false;
        btn.textContent = 'Carica i dati';
      }
    };
  });
}
