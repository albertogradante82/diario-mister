// Area genitori: registrazione, accesso, collegamento ai figli. Area mister: conferma dei collegamenti.
import * as db from '../db.js';
import { esc, toast, sheet, confirmDialog, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { PRIVACY_VERSION, showPrivacy } from '../privacy.js';
import { publicData } from './board.js';
import { me, parent, setParent, setChild, logoutParent, call } from '../family.js';

const API = './api/genitori';
const RELATIONS = ['Madre', 'Padre', 'Tutore', 'Altro'];

function formFields(g = {}) {
  const v = (k) => esc(g[k] || '');
  return `
    <label>Sono<select name="relation">${RELATIONS.map((r) => `<option ${r === g.relation ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <div class="row gap"><label class="grow">Nome<input name="firstName" required maxlength="40" value="${v('firstName')}"></label>
      <label class="grow">Cognome<input name="lastName" required maxlength="40" value="${v('lastName')}"></label></div>
    <div class="row gap"><label class="grow">Codice fiscale<input name="taxCode" maxlength="16" autocapitalize="characters" value="${v('taxCode')}"></label>
      <label class="grow">Data di nascita<input type="date" name="birthDate" value="${v('birthDate')}"></label></div>
    <div class="row gap"><label class="grow">Cellulare<input type="tel" name="phone" maxlength="30" value="${v('phone')}"></label>
      <label class="grow">Email<input type="email" name="email" required maxlength="80" value="${v('email')}" autocapitalize="off"></label></div>
    <label>Indirizzo<input name="address" maxlength="160" value="${v('address')}" placeholder="Via, numero, CAP, città"></label>`;
}
const readFields = (f) => Object.fromEntries(['relation', 'firstName', 'lastName', 'taxCode', 'birthDate', 'phone', 'email', 'address'].map((k) => [k, String(new FormData(f).get(k) || '').trim()]));

export async function parentAreaView(root) {
  setHeader({ title: 'Area genitori', back: '#/g/altro' });
  const p = parent();
  if (!p) return loginOrRegister(root);
  let g;
  try { g = (await call(`${API}?action=me`, { id: p.id, pin: p.pin })).parent; setParent(g, p.pin); } catch (e) {
    if (e.status === 403) { logoutParent(); toast('Accedi di nuovo.'); return loginOrRegister(root); }
    root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return;
  }
  const cur = me();
  const ok = g.children.filter((c) => c.status === 'ok');
  root.innerHTML = `
    <div class="card row gap center"><span class="avatar" style="font-size:22px">👨‍👩‍👧</span>
      <div class="grow"><strong>${esc(g.firstName)} ${esc(g.lastName)}</strong><div class="muted small">${esc(g.relation)} · ${esc(g.email)}</div></div>
      <button class="btn-text small" id="edit">Modifica</button></div>
    <h2 class="section">I miei figli</h2>
    ${g.children.length ? `<div class="list">${g.children.map((c) => `
      <div class="item ${cur && cur.parent && cur.id === c.playerId ? 'item-on' : ''}">
        <span class="avatar" data-rphoto="${c.playerId}">${esc(c.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
        <div class="grow"><strong>${esc(c.name)}</strong><div class="muted small">${esc(c.team)}</div>
          <div class="small ${c.status === 'ok' ? 'ok' : 'warn'}">${c.status === 'ok' ? '✓ Collegato' : '⏳ In attesa di conferma del mister'}</div></div>
        ${c.status === 'ok' ? (cur && cur.parent && cur.id === c.playerId ? '<span class="badge">attivo</span>' : `<button class="btn small" data-use="${c.playerId}">Segui</button>`) : ''}
        <button class="btn-text small danger" data-un="${c.playerId}" aria-label="Scollega">✕</button></div>`).join('')}</div>`
      : '<div class="card small muted">Nessun figlio collegato.</div>'}
    <button class="btn primary block mt" id="link">➕ Collega un figlio</button>
    ${ok.length && cur && cur.parent ? `<h2 class="section">Per ${esc(ok.find((c) => c.playerId === cur.id)?.name || '')}</h2>
      <div class="quick">
        <a class="quick-btn" href="#/g/bacheca"><span>📣</span>Bacheca</a>
        <a class="quick-btn" href="#/g/convocazioni"><span>⚽</span>Convocazioni</a>
        <a class="quick-btn" href="#/g/allenamenti"><span>🏃</span>Allenamenti</a>
        <a class="quick-btn" href="#/g/documenti"><span>📄</span>Documenti</a>
        <a class="quick-btn" href="#/g/pagamenti"><span>💶</span>Pagamenti</a>
        <a class="quick-btn" href="#/g/giocatore/${cur.id}"><span>👤</span>Scheda giocatore</a>
      </div>` : ''}
    <button class="btn block mt" id="out">🚪 Esci dall'area genitori</button>
    <button class="btn-text small danger mt" id="erase">Cancella il mio profilo genitore</button>`;
  import('../profiles.js').then((m) => m.fillPhotos(root));

  $$('[data-use]', root).forEach((b) => (b.onclick = () => { setChild(b.dataset.use); toast('Ora segui ' + g.children.find((c) => c.playerId === b.dataset.use).name); route(); }));
  $$('[data-un]', root).forEach((b) => (b.onclick = async () => {
    const c = g.children.find((x) => x.playerId === b.dataset.un);
    if (!(await confirmDialog(`Scollegare ${c.name}?`, 'Scollega', true))) return;
    try { setParent((await call(`${API}?action=unlink`, { id: p.id, pin: p.pin, playerId: c.playerId })).parent, p.pin); route(); } catch (e) { toast(e.message, 4000); }
  }));
  $('#link', root).onclick = async () => { if (await linkChild(p)) route(); };
  $('#edit', root).onclick = async () => { if (await editParent(p, g)) route(); };
  $('#out', root).onclick = () => { logoutParent(); toast('Uscito dall\'area genitori'); route(); };
  $('#erase', root).onclick = async () => {
    if (!(await confirmDialog('Cancellare il tuo profilo genitore e tutti i collegamenti? I documenti e i pagamenti dei figli restano.', 'Cancella', true))) return;
    try { await call(`${API}?action=erase`, { id: p.id, pin: p.pin }); logoutParent(); toast('Profilo cancellato'); route(); } catch (e) { toast(e.message, 4000); }
  };
}

function loginOrRegister(root) {
  root.innerHTML = `
    <div class="card"><p><strong>Sei un genitore?</strong></p>
      <p class="small muted">Registra i tuoi dati, collegati a uno o più figli e vedi bacheca della squadra, convocazioni, allenamenti, documenti e pagamenti. Puoi rispondere alle convocazioni al posto di tuo figlio.</p></div>
    <div class="seg mb"><label><input type="radio" name="m" value="reg" checked><span>Prima volta</span></label><label><input type="radio" name="m" value="log"><span>Ho già un profilo</span></label></div>
    <form class="form card" id="reg">
      <label>🔑 PIN genitori della società<input name="clubPin" type="password" inputmode="numeric" maxlength="8" required class="code-input" autocomplete="off" value="${esc(localStorage.getItem('mister-clubpin') || '')}"></label>
      <p class="small muted">Te lo comunica il mister o la società.</p>
      ${formFields()}
      <label>Scegli un PIN di 4-6 cifre<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required class="code-input" autocomplete="off"></label>
      <p class="small muted">Con email e PIN accedi anche da un altro telefono.</p>
      <div class="consent-box"><label class="consent-row"><input type="checkbox" name="consent" required>
        <span>Ho letto l'<a href="#" class="openPrivacy">informativa privacy</a> e acconsento al trattamento dei miei dati e di quelli di mio figlio. <span class="req">*obbligatorio</span></span></label></div>
      <button class="btn primary block mt">Registrati</button></form>
    <form class="form card" id="log" hidden>
      <label>🔑 PIN genitori della società<input name="clubPin" type="password" inputmode="numeric" maxlength="8" required class="code-input" autocomplete="off" value="${esc(localStorage.getItem('mister-clubpin') || '')}"></label>
      <label>Email<input type="email" name="email" required autocapitalize="off"></label>
      <label>PIN<input name="pin" type="password" inputmode="numeric" maxlength="6" required class="code-input"></label>
      <button class="btn primary block mt">Entra</button>
      <p class="small muted">PIN dimenticato? Chiedi al mister di impostarne uno nuovo.</p></form>`;
  $$('input[name=m]', root).forEach((i) => (i.onchange = () => { $('#reg', root).hidden = i.value !== 'reg'; $('#log', root).hidden = i.value !== 'log'; }));
  $$('.openPrivacy', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); showPrivacy(); }));
  $('#reg', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, pin = f.pin.value;
    if (!f.consent.checked) { toast('Devi accettare l\'informativa privacy.'); return; }
    try {
      const { parent: g } = await call(`${API}?action=register`, { ...readFields(f), pin, clubPin: f.clubPin.value, consent: true, privacyVersion: PRIVACY_VERSION });
      localStorage.setItem('mister-clubpin', f.clubPin.value);
      setParent(g, pin);
      toast('Registrazione completata ✓ Ora collega tuo figlio');
      route();
      setTimeout(() => linkChild(parent()).then((x) => x && route()), 400);
    } catch (err) { toast(err.message, 4500); }
  };
  $('#log', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try { const { parent: g } = await call(`${API}?action=login`, { email: f.email.value, pin: f.pin.value, clubPin: f.clubPin.value }); localStorage.setItem('mister-clubpin', f.clubPin.value); setParent(g, f.pin.value); toast('Bentornato ✓'); route(); }
    catch (err) { toast(err.message, 4000); }
  };
}

async function editParent(p, g) {
  return sheet('I miei dati', (body, close) => {
    body.innerHTML = `<form class="form" id="ef">${formFields(g)}
      <label>Nuovo PIN <span class="muted">(lascia vuoto per non cambiarlo)</span><input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" class="code-input" autocomplete="off"></label>
      <button class="btn primary block mt">Salva</button></form>`;
    body.querySelector('#ef').onsubmit = async (e) => {
      e.preventDefault();
      const newPin = e.target.newPin.value;
      try {
        const r = await call(`${API}?action=update`, { id: p.id, pin: p.pin, ...readFields(e.target), newPin });
        setParent(r.parent, newPin || p.pin);
        toast('Dati salvati ✓'); close(true);
      } catch (err) { toast(err.message, 4000); }
    };
  });
}

async function linkChild(p) {
  const pub = await publicData();
  const teams = pub.teams.slice().sort((a, b) => a.name.localeCompare(b.name));
  return sheet('Collega un figlio', (body, close) => {
    body.innerHTML = `<form class="form" id="lf">
      <label>Squadra<select name="team" required><option value="">—</option>${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <label>Giocatore<select name="playerId" required disabled><option value="">Scegli prima la squadra</option></select></label>
      <label>PIN della scheda di tuo figlio <span class="muted">(facoltativo)</span><input name="childPin" type="password" inputmode="numeric" maxlength="6" class="code-input" autocomplete="off"></label>
      <p class="small muted">Con il PIN della scheda giocatore il collegamento è immediato. Senza PIN la richiesta va al mister, che la conferma.</p>
      <button class="btn primary block mt">Collega</button></form>`;
    const f = body.querySelector('#lf');
    f.team.onchange = () => {
      const list = pub.players.filter((x) => x.teamId === f.team.value).sort((a, b) => a.name.localeCompare(b.name));
      f.playerId.disabled = !list.length;
      f.playerId.innerHTML = `<option value="">—</option>${list.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}`;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await call(`${API}?action=link`, { id: p.id, pin: p.pin, playerId: f.playerId.value, childPin: f.childPin.value });
        setParent(r.parent, p.pin);
        if (r.status === 'ok') setChild(f.playerId.value);
        toast(r.status === 'ok' ? 'Collegato ✓' : 'Richiesta inviata al mister ⏳', 3500);
        close(true);
      } catch (err) { toast(err.message, 4500); }
    };
  });
}

// ---------- Area mister ----------

export async function misterParentsView(root) {
  setHeader({ title: 'Genitori', back: '#/home' });
  const code = await db.getMeta('clubCode');
  if (!code) { root.innerHTML = '<div class="empty"><p>Rientra come mister con la password.</p></div>'; return; }
  let items, clubPin;
  try { [items, clubPin] = await Promise.all([call(`${API}?action=list`, null, code).then((r) => r.items), call(`${API}?action=code`, null, code).then((r) => r.code)]); }
  catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const pending = items.flatMap((g) => g.children.filter((c) => c.status === 'pending').map((c) => ({ g, c })));
  root.innerHTML = `
    <div class="card"><div class="row center gap"><div class="grow"><div class="small muted">🔑 PIN genitori della società</div><div class="club-pin">${esc(clubPin)}</div></div>
        <button class="btn small" id="sharepin">📤 Invia</button><button class="btn-text small" id="chpin">Cambia</button></div>
      <p class="small muted">Serve ai genitori per registrarsi e per entrare da un nuovo telefono. Ognuno poi ha il suo PIN personale.</p></div>
    ${pending.length ? `<h2 class="section">⏳ Da confermare · ${pending.length}</h2><div class="list">${pending.map(({ g, c }) => `
      <div class="item"><div class="grow"><strong>${esc(g.firstName)} ${esc(g.lastName)}</strong> <span class="muted small">(${esc(g.relation)})</span>
        <div class="small">chiede di seguire <strong>${esc(c.name)}</strong> · ${esc(c.team)}</div>
        <div class="muted small">${esc(g.phone || '')} ${esc(g.email)}</div></div>
        <button class="btn small primary" data-ok="${g.id}|${c.playerId}">Conferma</button><button class="btn-text small danger" data-no="${g.id}|${c.playerId}">Rifiuta</button></div>`).join('')}</div>` : ''}
    <h2 class="section">Genitori registrati · ${items.length}</h2>
    ${items.length ? `<div class="list">${items.map((g) => `
      <details class="item-details card"><summary><strong>${esc(g.firstName)} ${esc(g.lastName)}</strong> <span class="muted small">${esc(g.relation)} di ${esc(g.children.map((c) => c.name).join(', ') || '—')}</span></summary>
        <div class="small mt">📞 ${esc(g.phone || '—')} · ✉️ ${esc(g.email)}</div>
        <div class="small">🪪 ${esc(g.taxCode || '—')}${g.birthDate ? ' · nato/a il ' + esc(g.birthDate.split('-').reverse().join('/')) : ''}</div>
        <div class="small">🏠 ${esc(g.address || '—')}</div>
        <div class="small mt">${g.children.map((c) => `${c.status === 'ok' ? '✓' : '⏳'} ${esc(c.name)} (${esc(c.team)})`).join('<br>') || 'Nessun figlio collegato'}</div>
        <div class="row gap mt"><button class="btn small" data-pin="${g.id}">🔑 Nuovo PIN</button><button class="btn small danger" data-del="${g.id}">Elimina</button></div>
      </details>`).join('')}</div>` : '<div class="empty"><div class="empty-icon">👨‍👩‍👧</div><p>Nessun genitore registrato.</p><p class="small">I genitori si registrano dall\'app: Altro → Area genitori.</p></div>'}
    <p class="small muted mt">🔒 Anagrafica e contatti dei genitori li vede solo il mister con la password.</p>`;
  $('#chpin', root).onclick = async () => {
    const v = prompt('Nuovo PIN genitori (4-8 cifre):', clubPin);
    if (!v || v === clubPin) return;
    try { await call(`${API}?action=setcode`, { code: v.trim() }, code); toast('PIN genitori cambiato ✓'); route(); } catch (e) { toast(e.message, 4000); }
  };
  $('#sharepin', root).onclick = async () => {
    const text = `Area genitori dell'app del Calcio Palazzo ⚽\nApri ${location.origin}/ → "Genitore" → registrati.\nPIN genitori della società: ${clubPin}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Messaggio copiato ✓'); } } catch { /* annullato */ }
  };
  const act = async (action, body, msg) => { try { await call(`${API}?action=${action}`, body, code); toast(msg); route(); } catch (e) { toast(e.message, 4000); } };
  $$('[data-ok]', root).forEach((b) => (b.onclick = () => { const [parentId, playerId] = b.dataset.ok.split('|'); act('approve', { parentId, playerId }, 'Collegamento confermato ✓'); }));
  $$('[data-no]', root).forEach((b) => (b.onclick = async () => { const [parentId, playerId] = b.dataset.no.split('|'); if (await confirmDialog('Rifiutare la richiesta?', 'Rifiuta', true)) act('reject', { parentId, playerId }, 'Richiesta rifiutata'); }));
  $$('[data-pin]', root).forEach((b) => (b.onclick = async () => {
    const newPin = prompt('Nuovo PIN (4-6 cifre) da comunicare al genitore:');
    if (newPin) act('resetpin', { parentId: b.dataset.pin, newPin }, 'PIN aggiornato');
  }));
  $$('[data-del]', root).forEach((b) => (b.onclick = async () => { if (await confirmDialog('Eliminare questo genitore?', 'Elimina', true)) act('delete', { parentId: b.dataset.del }, 'Eliminato'); }));
}
