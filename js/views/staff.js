// Staff: mister, dirigenti e accompagnatori, con dati anagrafici, documento e matricola.
// Visibili solo all'area mister (servono per la distinta), mai ai ragazzi.
import * as db from '../db.js';
import { esc, fmtDate, toast, sheet, confirmDialog, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';

const API = './api/staff';
export const ROLES = ['Allenatore', 'Allenatore in seconda', 'Dirigente accompagnatore', 'Preparatore dei portieri', 'Preparatore atletico', 'Medico / massaggiatore', 'Altro'];
const DOCS = ["Carta d'identità", 'Patente', 'Passaporto', 'Altro'];
const ICON = { Allenatore: '🧢', 'Allenatore in seconda': '🧢', 'Dirigente accompagnatore': '🧑‍💼', 'Preparatore dei portieri': '🧤', 'Preparatore atletico': '🏋️', 'Medico / massaggiatore': '⛑️', Altro: '👤' };

async function code() {
  const c = await db.getMeta('clubCode');
  if (!c) throw new Error('Rientra come mister con la password.');
  return c;
}
async function call(action, body) {
  const c = await code();
  let r;
  try {
    r = await fetch(`${API}?action=${action}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-code': c }, body: JSON.stringify(body) }
      : { headers: { 'x-admin-code': c }, cache: 'no-store' });
  } catch { throw new Error('Nessuna connessione.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Errore ${r.status}`);
  return d;
}

export const listStaff = async () => (await call('list')).items || [];
export const staffName = (s) => `${s.firstName} ${s.lastName}`;
/** Identificativo per la distinta: matricola, altrimenti documento. */
export const staffIdent = (s) => (s.matricola ? `matr. ${s.matricola}` : s.docNumber ? `doc. ${s.docNumber}` : '');

export async function staffView(root) {
  setHeader({ title: 'Staff e accompagnatori', back: '#/home', actions: '<button class="hdr-btn" id="newst" aria-label="Nuovo">＋</button>' });
  let items, teams;
  try { [items, teams] = await Promise.all([listStaff(), db.all('teams')]); } catch (e) {
    root.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div><p>${esc(e.message)}</p></div>`; return;
  }
  const tname = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const today = new Date().toISOString().slice(0, 10);
  root.innerHTML = `
    <button class="btn primary block mb" id="add">➕ Nuovo mister / accompagnatore</button>
    ${items.length ? `<div class="list">${items.map((s) => `
      <button class="item" data-s="${s.id}"><span class="avatar">${ICON[s.role] || '👤'}</span>
        <div class="grow"><strong>${esc(staffName(s))}</strong>
          <div class="muted small">${esc(s.role)}${s.teams.length ? ' · ' + esc(s.teams.map((t) => tname[t] || '').filter(Boolean).join(', ')) : ''}</div>
          <div class="small">${s.matricola ? `🪪 Matricola <b>${esc(s.matricola)}</b>` : ''}${s.matricola && s.docNumber ? ' · ' : ''}${s.docNumber ? `📄 ${esc(s.docType)} <b>${esc(s.docNumber)}</b>` : ''}
            ${s.docExpiry && s.docExpiry < today ? ' <span class="ko">· documento scaduto</span>' : ''}${!s.matricola && !s.docNumber ? '<span class="warn">Mancano matricola e documento</span>' : ''}</div></div>
        <span class="chev">›</span></button>`).join('')}</div>`
      : '<div class="empty"><div class="empty-icon">🧑‍💼</div><p>Nessun profilo ancora.</p><p class="small">Crea i profili di mister e accompagnatori: potrai sceglierli nelle convocazioni.</p></div>'}
    <p class="small muted mt">🔒 Questi dati (documento, matricola, contatti) li vede solo chi entra come mister con la password. Nelle convocazioni i ragazzi vedono solo nome e ruolo.</p>`;
  const open = async (s) => { if (await editStaff(s, teams)) route(); };
  $('#add', root).onclick = () => open(null);
  $('#newst').onclick = () => open(null);
  $$('[data-s]', root).forEach((b) => (b.onclick = () => open(items.find((x) => x.id === b.dataset.s))));
}

/** Scheda di creazione/modifica. Restituisce il profilo salvato (o true se eliminato). */
export async function editStaff(s, teams) {
  teams = teams || await db.all('teams');
  s = s || { firstName: '', lastName: '', role: 'Dirigente accompagnatore', birthDate: '', birthPlace: '', taxCode: '', address: '', phone: '', email: '', docType: DOCS[0], docNumber: '', docIssuedBy: '', docExpiry: '', matricola: '', teams: [], note: '' };
  const v = (k) => esc(s[k] || '');
  return sheet(s.id ? 'Modifica profilo' : 'Nuovo mister / accompagnatore', (body, close) => {
    body.innerHTML = `<form class="form" id="sf">
      <h3>Dati anagrafici</h3>
      <div class="row gap"><label class="grow">Nome<input name="firstName" required maxlength="40" value="${v('firstName')}" autocomplete="off"></label>
        <label class="grow">Cognome<input name="lastName" required maxlength="40" value="${v('lastName')}" autocomplete="off"></label></div>
      <label>Ruolo<select name="role">${ROLES.map((r) => `<option ${r === s.role ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
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
      <h3 class="mt">Squadre che segue</h3>
      <div class="chips">${teams.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<label class="chip"><input type="checkbox" name="teams" value="${t.id}" ${s.teams.includes(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div>
      <label class="mt">Note<textarea name="note" rows="2" maxlength="300">${v('note')}</textarea></label>
      <p class="small muted">Per la distinta serve almeno la <strong>matricola</strong> oppure il <strong>numero del documento</strong>.</p>
      <button class="btn primary block">Salva</button>
      ${s.id ? '<button type="button" class="btn danger block mt" id="del">Elimina profilo</button>' : ''}
    </form>`;
    const f = body.querySelector('#sf');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const data = { ...s };
      ['firstName', 'lastName', 'role', 'birthDate', 'birthPlace', 'taxCode', 'address', 'phone', 'email', 'matricola', 'docType', 'docNumber', 'docIssuedBy', 'docExpiry', 'note'].forEach((k) => (data[k] = String(fd.get(k) || '').trim()));
      data.teams = fd.getAll('teams');
      if (!data.matricola && !data.docNumber && !(await confirmDialog('Mancano matricola e numero di documento: senza non potrà andare in distinta. Salvare lo stesso?', 'Salva'))) return;
      const btn = f.querySelector('.btn.primary'); btn.disabled = true;
      try { const { item } = await call('save', data); toast('Profilo salvato ✓'); close(item); }
      catch (err) { toast(err.message, 4000); btn.disabled = false; }
    };
    const del = body.querySelector('#del');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`Eliminare il profilo di ${staffName(s)}?`, 'Elimina', true))) return;
      try { await call('delete', { id: s.id }); toast('Profilo eliminato'); close(true); } catch (err) { toast(err.message, 4000); }
    };
  });
}
