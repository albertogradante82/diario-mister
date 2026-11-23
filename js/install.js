// Installazione dell'app sul telefono (icona sulla schermata Home) e invio del link.
// Android/Chrome: installazione con un tocco. iPhone: Apple non lo permette in automatico,
// quindi mostriamo una guida passo passo con la freccia sul tasto giusto.
import { sheet, toast } from './util.js';

const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; localStorage.setItem('mister-installed', '1'); });

const ua = navigator.userAgent;
export const isIOS = () => /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(ua);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|WhatsApp|Telegram|Snapchat|TikTok/i.test(ua);
const iosOtherBrowser = () => isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

/** Il pulsante "Installa" ha senso? (no se l'app è già aperta dall'icona) */
export const canOfferInstall = () => !isStandalone();

export async function installApp() {
  if (isStandalone()) {
    return sheet('📲 Aggiungi alla Home', (body) => {
      body.innerHTML = `<p class="ok mb"><strong>✓ Su questo telefono l'app è già sulla schermata Home.</strong></p>
        <p class="small muted">Se hai cancellato l'icona: apri il link in Safari (iPhone) o Chrome (Android) e tocca di nuovo questo pulsante.</p>
        <button class="btn primary block mt" id="sh">📤 Invia il link a un altro telefono</button><button class="btn block mt" id="cp">📋 Copia link</button>`;
      body.querySelector('#sh').onclick = shareApp;
      body.querySelector('#cp').onclick = () => copyLink();
    });
  }
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') { localStorage.setItem('mister-installed', '1'); toast('App installata ✓ La trovi tra le app del telefono'); }
    return;
  }
  if (isIOS()) return iosGuide();
  return otherGuide();
}

function iosGuide() {
  if (inAppBrowser()) {
    return sheet('📲 Aggiungi alla Home', (body) => {
      body.innerHTML = `<p class="mb">Stai usando il browser interno di un'altra app (WhatsApp, Instagram…): da qui non si può installare.</p>
        <ol class="install-steps"><li>Tocca <strong>Copia link</strong> qui sotto</li><li>Apri <strong>Safari</strong> e incolla il link</li><li>Tocca di nuovo <strong>📲 Aggiungi alla Home</strong></li></ol>
        <button class="btn primary block mt" id="cp">📋 Copia link</button>`;
      body.querySelector('#cp').onclick = () => copyLink();
    });
  }
  // guida a schermo intero con freccia verso il tasto Condividi
  const ov = document.createElement('div');
  ov.className = 'install-ov';
  ov.innerHTML = `<div class="install-card">
      <img src="icons/apple-touch-icon.png?v=2" alt="" class="install-icon">
      <h3>Aggiungi l'app alla schermata Home</h3>
      <ol class="install-steps">
        <li>Tocca <strong>Condividi</strong> <span class="ios-share">⬆︎</span> nella barra di ${iosOtherBrowser() ? 'Chrome (in alto a destra)' : 'Safari qui sotto'}<br><span class="muted small">Non lo vedi? Tocca <strong>•••</strong> e poi <strong>Condividi</strong></span></li>
        <li>Scorri e scegli <strong>Aggiungi alla schermata Home</strong> <span class="ios-add">＋</span></li>
        <li>Tocca <strong>Aggiungi</strong> in alto a destra</li>
      </ol>
      <p class="small muted">Poi apri l'app dall'icona con lo stemma: funziona a schermo intero, anche senza internet, e riceve le notifiche.</p>
      <button class="btn block mt" id="ovclose">Ho capito</button>
    </div>
    <div class="install-arrow ${iosOtherBrowser() ? 'top' : ''}">${iosOtherBrowser() ? '⬆' : '⬇'}</div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('#ovclose').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
}

function otherGuide() {
  return sheet('📲 Aggiungi alla Home', (body) => {
    body.innerHTML = isAndroid()
      ? `<ol class="install-steps"><li>Apri il menu <strong>⋮</strong> di Chrome in alto a destra</li><li>Scegli <strong>Installa app</strong> (o <em>Aggiungi a schermata Home</em>)</li><li>Conferma con <strong>Installa</strong></li></ol>
         <p class="small muted">Se non vedi la voce, apri il link con <strong>Chrome</strong>.</p><button class="btn block mt" id="cp">📋 Copia link</button>`
      : `<p>Apri questo link dal telefono: su iPhone con <strong>Safari</strong>, su Android con <strong>Chrome</strong>, poi tocca <strong>📲 Aggiungi alla Home</strong>.</p>
         <p class="mt"><strong>${APP_URL}</strong></p><button class="btn block mt" id="cp">📋 Copia link</button>`;
    body.querySelector('#cp').onclick = () => copyLink();
  });
}

async function copyLink() {
  try { await navigator.clipboard.writeText(APP_URL); toast('Link copiato ✓'); }
  catch { prompt('Copia il link:', APP_URL); }
}

/** Invia il link dell'app (WhatsApp, messaggi…) */
export async function shareApp() {
  const text = 'App del Calcio Palazzo ⚽ Calendario, convocazioni, bacheca e notifiche. Aprila e tocca "📲 Aggiungi alla Home":';
  if (navigator.share) {
    try { await navigator.share({ title: 'Calcio Palazzo', text, url: APP_URL }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  await sheet('📤 Invia il link dell\'app', (body) => {
    body.innerHTML = `<a class="btn primary block" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + APP_URL)}">Invia con WhatsApp</a>
      <button class="btn block mt" id="cp">📋 Copia link</button><p class="small muted mt">${APP_URL}</p>`;
    body.querySelector('#cp').onclick = () => copyLink();
  });
}

/** Riquadro "Installa l'app" da mettere in cima a una pagina (si può nascondere). */
export function installBanner() {
  if (!canOfferInstall() || localStorage.getItem('mister-install-hide') === '1') return null;
  const box = document.createElement('div');
  box.className = 'card small row gap center install-banner';
  box.innerHTML = `<img src="icons/apple-touch-icon.png?v=2" alt="" style="width:40px;height:40px;border-radius:9px">
    <div class="grow"><strong>Metti l'app sul telefono</strong><div class="muted">Icona sulla schermata Home e notifiche</div></div>
    <div><button class="btn primary small" data-inst>📲 Aggiungi</button><button class="btn-text small" data-insthide>No</button></div>`;
  box.querySelector('[data-inst]').onclick = installApp;
  box.querySelector('[data-insthide]').onclick = () => { localStorage.setItem('mister-install-hide', '1'); box.remove(); };
  return box;
}
