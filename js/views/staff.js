// Staff: mister, dirigenti e accompagnatori, con dati anagrafici, documento e matricola.
// Il mister crea i profili; la persona li completa e li conferma con il suo PIN (come i ragazzi):
// la scheda confermata è certificata con la stella verde.
import * as db from '../db.js';
import { esc, toast, sheet, confirmDialog, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { PRIVACY_VERSION, showPrivacy } from '../privacy.js';

const API = './api/staff';
export const ROLES = ['Allenatore', 'Allenatore in seconda', 'Dirigente accompagnatore', 'Preparatore dei portieri', 'Preparatore atletico', 'Medico / massaggiatore', 'Altro'];
const DOCS = ["Carta d'identità", 'Patente', 'Passaporto', 'Altro'];
const ICON = { Allenatore: '🧢', 'Allenatore in seconda': '🧢', 'Dirigente accompagnatore': '🧑‍💼', 'Preparatore dei portieri': '🧤', 'Preparatore atletico': '🏋️', 'Medico / massaggiatore': '⛑️', Altro: '👤' };
export const STAR = '<i class="vstar-inline" title="Profilo certificato">★</i>';

async function req(action, body, admin) {
  const headers = {};
  if (admin) {
    const c = await db.getMeta('clubCode');
    if (!c) throw new Error('Rientra come mister con la password.');
    headers['x-admin-code'] = c;
  }
  let r;
  try {
    r = await fetch(`${API}?action=${action}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }
      : { headers, cache: 'no-store' });
  } catch { throw new Error('Nessuna connessione.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Errore ${r.status}`);
  return d;
}
const call = (action, body) => req(action, body, true);

export const listStaff = async () => (await call('list')).items || [];
export const publicStaff = async () => (await req('public')).items || [];
export const staffName = (s) => `${s.firstName} ${s.lastName}`;
/** Identificativo per la distinta: matricola, altrimenti documento. */
export const staffIdent = (s) => (s.matricola ? `matr. ${s.matricola}` : s.docNumber ? `doc. ${s.docNumber}` : '');

// ---------- Area mister ----------

export async function staffView(root) {
  setHeader({ title: 'Staff e accompagnatori', back: '#/home', actions: '<button class="hdr-btn" id="newst" aria-label="Nuovo">＋</button>' });
  let items, teams;
  try { [items, teams] = await Promise.all([listStaff(), db.all('teams')]); } catch (e) {
    root.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div><p>${esc(e.message)}</p></div>`; return;
  }
  const tname = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const today = new Date().toISOString().slice(0, 10);
  const nCert = items.filter((s) => s.certifiedAt).length;
  root.innerHTML = `
    <button class="btn primary block mb" id="add">➕ Nuovo mister / accompagnatore</button>
    ${items.length ? `<p class="small muted mb">${STAR} ${nCert} su ${items.length} profili certificati dalla persona con il suo PIN.</p>
    <div class="list">${items.map((s) => `
      <button class="item" data-s="${s.id}"><span class="avatar staff-av">${ICON[s.role] || '👤'}${s.certifiedAt ? '<i class="vstar">★</i>' : ''}</span>
        <div class="grow"><strong>${esc(staffName(s))}</strong>${s.certifiedAt ? ' ' + STAR : ''}
          <div class="muted small">${esc(s.role)}${s.teams.length ? ' · ' + esc(s.teams.map((t) => tname[t] || '').filter(Boolean).join(', ')) : ''}</div>
          <div class="small">${s.matricola ? `🪪 Matricola <b>${esc(s.matricola)}</b>` : ''}${s.matricola && s.docNumber ? ' · ' : ''}${s.docNumber ? `📄 ${esc(s.docType)} <b>${esc(s.docNumber)}</b>` : ''}
            ${s.docExpiry && s.docExpiry < today ? ' <span class="ko">· documento scaduto</span>' : ''}${!s.matricola && !s.docNumber ? '<span class="warn">Mancano matricola e documento</span>' : ''}</div>
          <div class="small ${s.certifiedAt ? 'ok' : 'muted'}">${s.certifiedAt ? '✓ Confermato dalla persona' : s.hasPin ? '🔑 PIN scelto, scheda da confermare' : '⏳ Da confermare con il PIN'}</div></div>
        <span class="chev">›</span></button>`).join('')}</div>`
      : '<div class="empty"><div class="empty-icon">🧑‍💼</div><p>Nessun profilo ancora.</p><p class="small">Crea i profili di mister e accompagnatori: potrai sceglierli nelle convocazioni.</p></div>'}
    <div class="card small mt"><strong>🔑 Come si certifica un profilo</strong>
      <p class="muted">La persona apre l'app come <em>Giocatore o genitore</em> → Altro → <strong>Area staff: la mia scheda</strong>, sceglie il suo nome e un PIN, completa i dati e conferma. Da quel momento compare la stella ${STAR}.</p>
      <button class="btn block mt" id="selfme">Certifica la mia scheda (con il mio PIN)</button></div>
    <p class="small muted mt">🔒 Documento, matricola e contatti li vede solo chi entra come mister con la password. Nelle convocazioni i ragazzi vedono solo nome e ruolo.</p>`;
  const open = async (s) => { if (await editStaff(s, teams)) route(); };
  $('#add', root).onclick = () => open(null);
  $('#newst').onclick = () => open(null);
  $('#selfme', root).onclick = async () => { if (await selfStaffFlow()) route(); };
  $$('[data-s]', root).forEach((b) => (b.onclick = () => open(items.find((x) => x.id === b.dataset.s))));
}

function fieldsHtml(s, { admin, teams }) {
  const v = (k) => esc(s[k] || '');
  return `
      <h3>Dati anagrafici</h3>
      <div class="row gap"><label class="grow">Nome<input name="firstName" required maxlength="40" value="${v('firstName')}" autocomplete="off"></label>
        <label class="grow">Cognome<input name="lastName" required maxlength="40" value="${v('lastName')}" autocomplete="off"></label></div>
      ${admin ? `<label>Ruolo<select name="role">${ROLES.map((r) => `<option ${r === s.role ? 'selected' : ''}>${r}</option>`).join('')}</select></label>` : `<p class="small muted">Ruolo: <strong>${esc(s.role)}</strong> (lo decide il mister)</p>`}
      <div class="row gap"><label class="grow">Data di nascita<input type="date" name="birthDate" value="${v('birthDate')}"></label>
        <label class="grow">Luogo di nascita<input name="birthPlace" maxlength="60" value="${v('birthPlace')}"></label></div>
      <label>Codice fiscale <span class="muted">(facoltativo)</span><input name="taxCode" maxlength="16" value="${v('taxCode')}" autocapitalize="characters" autocomplete="off"></label>
      <label>Indirizzo <span class="muted">(facoltativo)</span><input name="address" maxlength="120" value="${v('address')}"></label>
      <div class="row gap"><label class="grow">Cellulare<input type="tel" name="phone" maxlength="30" value="${v('phone')}"></label>
        <label class="grow">Email<input type="email" name="email" maxlength="80" value="${v('email')}"></label></div>
      <h3 class="mt">Tesseramento e documento</h3>
      <label>Numero matricola (FIGC)<input name="matricola" maxlength="30" value="${v('matricola')}" inputmode="numeric" autocomplete="off"></label>
      <div class="row gap"><label class="grow">Documento<select name="docType">${DOCS.map((d) => `<option ${d === s.docType ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
        <label class="grow">Numero documento<input name="docNumber" maxlength="30" value="${v('docNumber')}" autocapitalize="characters" autocomplete="off"></label></div>
      <div class="row gap"><label class="grow">Rilasciato da<input name="docIssuedBy" maxlength="60" value="${v('docIssuedBy')}" placeholder="es. Comune di Assisi"></label>
        <label class="grow">Scadenza<input type="date" name="docExpiry" value="${v('docExpiry')}"></label></div>
      ${admin ? `<h3 class="mt">Squadre che segue</h3>
      <div class="chips">${teams.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<label class="chip"><input type="checkbox" name="teams" value="${t.id}" ${(s.teams || []).includes(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div>
      <label class="mt">Note<textarea name="note" rows="2" maxlength="300">${v('note')}</textarea></label>` : ''}
      <p class="small muted">Per la distinta serve almeno la <strong>matricola</strong> oppure il <strong>numero del documento</strong>.</p>`;
}

function readFields(f, s) {
  const fd = new FormData(f);
  const data = { ...s };
  ['firstName', 'lastName', 'role', 'birthDate', 'birthPlace', 'taxCode', 'address', 'phone', 'email', 'matricola', 'docType', 'docNumber', 'docIssuedBy', 'docExpiry', 'note']
    .forEach((k) => { if (fd.has(k)) data[k] = String(fd.get(k) || '').trim(); });
  if (f.querySelector('[name=teams]')) data.teams = fd.getAll('teams');
  return data;
}

/** Scheda di creazione/modifica del mister. Restituisce il profilo salvato (o true se eliminato). */
export async function editStaff(s, teams) {
  teams = teams || await db.all('teams');
  s = s || { firstName: '', lastName: '', role: 'Dirigente accompagnatore', docType: DOCS[0], teams: [] };
  return sheet(s.id ? 'Modifica profilo' : 'Nuovo mister / accompagnatore', (body, close) => {
    body.innerHTML = `<form class="form" id="sf">
      ${s.id ? `<div class="card small ${s.certifiedAt ? 'cert-card' : ''}">${s.certifiedAt
        ? `${STAR} <strong>Profilo certificato</strong><div class="muted">Confermato dalla persona con il suo PIN il ${esc(new Date(s.certifiedAt).toLocaleDateString('it-IT'))}.</div>`
        : `<strong>${s.hasPin ? '🔑 PIN già scelto' : '⏳ Non ancora certificato'}</strong><div class="muted">La persona può confermare la scheda da Altro → Area staff, con il suo PIN.</div>`}</div>` : ''}
      ${fieldsHtml(s, { admin: true, teams })}
      <button class="btn primary block">Salva</button>
      ${s.hasPin ? '<button type="button" class="btn block mt" id="rpin">🔑 Azzera il PIN (PIN dimenticato)</button>' : ''}
      ${s.id ? '<button type="button" class="btn danger block mt" id="del">Elimina profilo</button>' : ''}
    </form>`;
    const f = body.querySelector('#sf');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = readFields(f, s);
      if (!data.matricola && !data.docNumber && !(await confirmDialog('Mancano matricola e numero di documento: senza non potrà andare in distinta. Salvare lo stesso?\n\nPuò completarli anche la persona con il suo PIN.', 'Salva'))) return;
      const btn = f.querySelector('.btn.primary'); btn.disabled = true;
      try { const { item } = await call('save', data); toast('Profilo salvato ✓'); close(item); }
      catch (err) { toast(err.message, 4000); btn.disabled = false; }
    };
    const rp = body.querySelector('#rpin');
    if (rp) rp.onclick = async () => {
      if (!(await confirmDialog(`Azzerare il PIN di ${staffName(s)}? Al prossimo accesso ne sceglierà uno nuovo.`, 'Azzera'))) return;
      try { await call('resetpin', { id: s.id }); toast('PIN azzerato'); close(true); } catch (err) { toast(err.message, 4000); }
    };
    const del = body.querySelector('#del');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`Eliminare il profilo di ${staffName(s)}?`, 'Elimina', true))) return;
      try { await call('delete', { id: s.id }); toast('Profilo eliminato'); close(true); } catch (err) { toast(err.message, 4000); }
    };
  });
}

// ---------- La persona stessa (con PIN) ----------

/** Scegli il tuo nome → PIN → completa e conferma la scheda. */
export async function selfStaffFlow() {
  let list;
  try { list = await publicStaff(); } catch (e) { toast(e.message, 4000); return false; }
  if (!list.length) { toast('Nessun profilo staff: chiedi al responsabile di crearlo.', 4000); return false; }
  const who = await sheet('🧑‍💼 La mia scheda staff', (body, close) => {
    body.innerHTML = `<form class="form" id="wf">
      <label>Chi sei?<select name="id" required><option value="">—</option>${list.map((s) => `<option value="${s.id}" data-pin="${s.hasPin ? 1 : 0}">${esc(s.name)} · ${esc(s.role)}${s.cert ? ' ★' : ''}</option>`).join('')}</select></label>
      <label><span id="pinlbl">Il tuo PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required class="code-input" autocomplete="off"></label>
      <p class="small muted" id="pinhelp">Scegli il tuo nome.</p>
      <button class="btn primary block">Avanti</button></form>
      <p class="small muted mt">Non trovi il tuo nome? Chiedi al responsabile di crearti il profilo (Home → Nuovo mister / accompagnatore).</p>`;
    const f = body.querySelector('#wf');
    f.id.onchange = () => {
      const first = f.id.selectedOptions[0]?.dataset.pin === '0';
      body.querySelector('#pinlbl').textContent = first ? 'Scegli un PIN di 4-6 cifre' : 'Il tuo PIN';
      body.querySelector('#pinhelp').textContent = first ? 'Primo accesso: il PIN che scegli servirà per modificare la scheda in futuro. Ricordatelo!' : 'Il PIN scelto la prima volta. Dimenticato? Chiedi al responsabile di azzerarlo.';
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const id = f.id.value, pin = f.pin.value;
      try { const { item, hasPin } = await req('mine', { id, pin }); close({ item, pin, hasPin }); } catch (err) { toast(err.message, 4000); }
    };
  });
  if (!who) return false;
  const { item: s, pin } = who;
  return sheet(s.certifiedAt ? 'La mia scheda ★' : 'Completa e conferma', (body, close) => {
    body.innerHTML = `<form class="form" id="mf">
      ${s.certifiedAt ? `<div class="card small cert-card">${STAR} <strong>Scheda certificata</strong><div class="muted">Puoi correggere i dati e salvare di nuovo.</div></div>` : ''}
      ${fieldsHtml(s, { admin: false })}
      <div class="consent-box mt"><label class="consent-row"><input type="checkbox" name="consent" required>
        <span>Ho letto l'<a href="#" id="openPrivacy">informativa privacy</a> e acconsento al trattamento dei miei dati per il tesseramento e le distinte di gara. <span class="req">*obbligatorio</span></span></label></div>
      <button class="btn primary block mt">★ Conferma e certifica</button></form>`;
    body.querySelector('#openPrivacy').onclick = (e) => { e.preventDefault(); showPrivacy(); };
    const f = body.querySelector('#mf');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = readFields(f, s);
      if (!data.matricola && !data.docNumber) { toast('Inserisci la matricola o il numero del documento.', 3500); return; }
      const btn = f.querySelector('.btn.primary'); btn.disabled = true;
      try {
        const r = await req('self', { ...data, id: s.id, pin, consent: true, privacyVersion: PRIVACY_VERSION });
        toast(r.pinSet ? 'Scheda certificata ★ Ricorda il tuo PIN!' : 'Scheda certificata ★', 3500);
        close(true);
      } catch (err) { toast(err.message, 4000); btn.disabled = false; }
    };
  });
}

/** Pagina dell'area giocatori/genitori per lo staff. */
export async function playerStaffView(root) {
  setHeader({ title: 'Area staff', back: '#/g/altro' });
  let list = [];
  try { list = await publicStaff(); } catch { /* */ }
  root.innerHTML = `<div class="card">
      <p><strong>Sei un mister, un dirigente o un accompagnatore?</strong></p>
      <p class="small muted">Completa la tua scheda (anagrafica, documento, matricola) e confermala con il tuo PIN: il profilo diventa certificato ${STAR} e il mister può inserirti nelle distinte.</p>
      <button class="btn primary block mt" id="go">🔑 Apri la mia scheda</button></div>
    ${list.length ? `<h2 class="section">Staff della società</h2><div class="list">${list.map((s) => `
      <div class="item"><span class="avatar staff-av">${ICON[s.role] || '👤'}${s.cert ? '<i class="vstar">★</i>' : ''}</span>
        <div class="grow"><strong>${esc(s.name)}</strong>${s.cert ? ' ' + STAR : ''}<div class="muted small">${esc(s.role)}</div></div></div>`).join('')}</div>` : ''}`;
  $('#go', root).onclick = async () => { if (await selfStaffFlow()) route(); };
}
