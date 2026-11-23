// Notifiche sul telefono (Web Push).
// Su iPhone funzionano solo se l'app è stata aggiunta alla schermata Home (iOS 16.4 o successivo).
import { sheet, toast, esc } from './util.js';

const API = './api/push';

const b64uToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function call(action, body, headers = {}) {
  const r = await fetch(`${API}?action=${action}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }
    : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Errore di rete');
  return j;
}

async function currentSub() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** 'on' | 'off' | 'denied' | 'install' (iPhone fuori dalla Home) | 'unsupported' */
export async function pushState() {
  if (!supported()) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSub()) && localStorage.getItem('mister-push') ? 'on' : 'off';
}

/** Attiva le notifiche. who = { role: 'mister', adminCode } oppure { playerId, pin } */
export async function enablePush(who) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permesso negato. Puoi attivarlo da Impostazioni → Notifiche → Mister.');
  const { publicKey } = await call('key');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) { try { await sub.unsubscribe(); } catch { /* */ } }
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  const json = sub.toJSON();
  if (who.role === 'mister') await call('subscribe', { role: 'mister', sub: json }, { 'x-admin-code': who.adminCode });
  else await call('subscribe', { playerId: who.playerId, pin: who.pin, sub: json });
  localStorage.setItem('mister-push', who.role === 'mister' ? 'mister' : who.playerId);
}

export async function disablePush() {
  const sub = await currentSub();
  if (sub) {
    try { await call('unsubscribe', { endpoint: sub.endpoint }); } catch { /* */ }
    try { await sub.unsubscribe(); } catch { /* */ }
  }
  localStorage.removeItem('mister-push');
}

export async function testPush() {
  const sub = await currentSub();
  if (!sub) throw new Error('Notifiche non attive su questo telefono.');
  return call('test', { endpoint: sub.endpoint });
}

/** Foglio di gestione notifiche. getWho() restituisce chi si iscrive (o null con un messaggio). */
export async function pushSheet(getWho, what) {
  const state = await pushState();
  await sheet('🔔 Notifiche', (body, close) => {
    const steps = `<ol class="small" style="padding-left:20px;line-height:1.6">
      <li>Apri <strong>diario-mister.vercel.app</strong> in <strong>Safari</strong></li>
      <li>Tocca <strong>Condividi</strong> (il quadrato con la freccia ↑)</li>
      <li>Scegli <strong>Aggiungi alla schermata Home</strong></li>
      <li>Apri l'app dall'icona con lo stemma e torna qui</li></ol>`;
    const info = `<p class="small muted mb">Ricevi sul telefono: ${esc(what)}.</p>`;
    if (state === 'install') {
      body.innerHTML = `${info}<p class="mb">Su iPhone le notifiche funzionano solo se l'app è sulla schermata Home:</p>${steps}
        <p class="small muted">Serve iOS 16.4 o successivo.</p>`;
      return;
    }
    if (state === 'unsupported') { body.innerHTML = `${info}<p>Questo browser non supporta le notifiche. Su iPhone usa Safari e aggiungi l'app alla schermata Home.</p>`; return; }
    if (state === 'denied') { body.innerHTML = `${info}<p>Le notifiche sono bloccate. Riattivale da <strong>Impostazioni → Notifiche → Mister</strong>, poi torna qui.</p>`; return; }
    body.innerHTML = state === 'on'
      ? `${info}<p class="ok mb"><strong>✓ Notifiche attive su questo telefono</strong></p>
        <button class="btn block" id="ptest">Invia una notifica di prova</button>
        <button class="btn danger block mt" id="poff">Disattiva</button>`
      : `${info}<button class="btn primary block" id="pon">🔔 Attiva notifiche</button>
        <p class="small muted mt">Il telefono ti chiederà il permesso: tocca <strong>Consenti</strong>.</p>`;
    const busy = (b, t) => { b.disabled = true; b.textContent = t; };
    const on = body.querySelector('#pon');
    if (on) on.onclick = async () => {
      const who = await getWho();
      if (!who) return;
      busy(on, 'Attivazione…');
      try { await enablePush(who); toast('Notifiche attive ✓'); close(true); try { await testPush(); } catch { /* */ } }
      catch (e) { toast(e.message, 5000); on.disabled = false; on.textContent = '🔔 Attiva notifiche'; }
    };
    const t = body.querySelector('#ptest');
    if (t) t.onclick = async () => { busy(t, 'Invio…'); try { await testPush(); toast('Inviata: guarda tra qualche secondo'); } catch (e) { toast(e.message, 4000); } close(); };
    const off = body.querySelector('#poff');
    if (off) off.onclick = async () => { busy(off, '…'); await disablePush(); toast('Notifiche disattivate'); close(); };
  });
}
