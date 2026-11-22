// Convocazioni: il mister convoca, i ragazzi rispondono "ci sono / non ci sono".
import * as db from '../db.js';
import { esc, fmtDate, toast, sheet, confirmDialog, fullName, today, $, $$ } from '../util.js';
import { setHeader, route, byNumber } from '../app.js';
import { fillPhotos } from '../profiles.js';
import { me } from './board.js';

const API = './api/convocazioni';

async function call(url, opts = {}) {
  let r;
  try { r = await fetch(url, { cache: 'no-store', ...opts }); } catch { throw new Error('Nessuna connessione.'); }
  let d = {};
  try { d = await r.json(); } catch { /* */ }
  if (!r.ok) { const e = new Error(d.error || `Errore ${r.status}`); e.status = r.status; throw e; }
  return d;
}
const post = (action, body, admin) => call(`${API}?action=${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin-code': admin } : {}) }, body: JSON.stringify(body),
});
export const listConvocations = async () => (await call(`${API}?action=list`)).items || [];
const upcoming = (c) => c.date >= today();
const whenTxt = (c) => `${esc(fmtDate(c.date, { weekday: 'long', day: 'numeric', month: 'long' }))}${c.time ? ' · ore ' + esc(c.time) : ''}`;

// ---------- Area giocatori (dentro la Bacheca) ----------

/** Convocazioni del giocatore collegato: restituisce l'HTML e una funzione per collegare i pulsanti. */
export async function playerConvocationsBlock() {
  const ident = me();
  if (!ident) return { html: '', bind: () => {}, pending: 0 };
  let items = [], mine = {};
  try {
    items = (await listConvocations()).filter((c) => upcoming(c) && c.players.includes(ident.id));
    if (items.length) mine = (await post('mine', { playerId: ident.id, pin: ident.pin })).mine || {};
  } catch { return { html: '', bind: () => {}, pending: 0 }; }
  if (!items.length) return { html: '', bind: () => {}, pending: 0 };
  const pending = items.filter((c) => !mine[c.id]).length;
  const html = `<h2 class="section">📋 Convocazioni</h2>${items.map((c) => {
    const r = mine[c.id];
    return `<div class="card conv ${r ? 'conv-' + r.r : 'conv-wait'}">
      <div class="small muted">${c.kind === 'allenamento' ? '🏃 Allenamento' : '⚽ Partita'}</div>
      <strong class="notice-title">${esc(c.title)}</strong>
      <div class="notice-when">🗓️ ${whenTxt(c)}${c.meetTime ? ` · ritrovo ${esc(c.meetTime)}` : ''}${c.place ? ` · 📍 ${esc(c.place)}` : ''}</div>
      ${c.note ? `<div class="notice-text">${esc(c.note)}</div>` : ''}
      ${r ? `<div class="conv-answer mt">${r.r === 'si' ? '✅ Hai risposto: <strong>ci sono</strong>' : `❌ Hai risposto: <strong>non ci sono</strong>${r.note ? ` (${esc(r.note)})` : ''}`}</div>` : '<div class="conv-answer mt warn">⏳ Il mister aspetta la tua risposta</div>'}
      ${c.closed ? '<p class="small muted">Risposte chiuse.</p>' : `<div class="row gap mt"><button class="btn grow conv-yes ${r?.r === 'si' ? 'primary' : ''}" data-yes="${c.id}">✅ Ci sono</button><button class="btn grow conv-no ${r?.r === 'no' ? 'danger' : ''}" data-no="${c.id}">❌ Non ci sono</button></div>`}
    </div>`;
  }).join('')}`;
  const bind = (root) => {
    $$('[data-yes]', root).forEach((b) => (b.onclick = () => answer(b.dataset.yes, 'si')));
    $$('[data-no]', root).forEach((b) => (b.onclick = () => answer(b.dataset.no, 'no')));
  };
  const answer = async (convId, r) => {
    let note = '';
    if (r === 'no') {
      note = await sheet('Non ci sei?', (body, close) => {
        body.innerHTML = `<p class="small muted mb">Se vuoi, scrivi il motivo al mister (facoltativo).</p>
          <form id="nf" class="form"><input name="note" maxlength="200" placeholder="es. malato, in vacanza, scuola…"><button class="btn danger block mt">Conferma: non ci sono</button></form>`;
        body.querySelector('#nf').onsubmit = (e) => { e.preventDefault(); close(new FormData(e.target).get('note') || ' '); };
      });
      if (note === undefined) return;
    }
    try { await post('respond', { convId, r, note: note.trim(), playerId: ident.id, pin: ident.pin }); toast(r === 'si' ? 'Risposta inviata: ci sei ✅' : 'Risposta inviata ❌'); route(); }
    catch (e) { toast(e.message, 4000); }
  };
  return { html, bind, pending };
}

// ---------- Area mister ----------

export async function misterConvView(root) {
  setHeader({ title: 'Convocazioni', back: '#/home', actions: '<button class="hdr-btn" id="newc" aria-label="Nuova convocazione">＋</button>' });
  const code = await db.getMeta('clubCode');
  const [teams, players] = await Promise.all([db.all('teams'), db.all('players')]);
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  let items = [], resp = {};
  try {
    items = await listConvocations();
    if (code) resp = (await call(`${API}?action=responses`, { headers: { 'x-admin-code': code } })).responses || {};
  } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const show = sessionStorage.getItem('convShow') || 'prossime';
  const list = items.filter((c) => (show === 'prossime' ? upcoming(c) : !upcoming(c))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) * (show === 'prossime' ? 1 : -1));

  root.innerHTML = `
    <div class="seg"><label><input type="radio" name="cs" value="prossime" ${show === 'prossime' ? 'checked' : ''}><span>Prossime</span></label><label><input type="radio" name="cs" value="passate" ${show !== 'prossime' ? 'checked' : ''}><span>Passate</span></label></div>
    ${list.length ? list.map((c) => convCard(c, resp[c.id] || {}, byId, teams)).join('') : '<div class="empty"><div class="empty-icon">📋</div><p>Nessuna convocazione. Aprila dalla scheda di una partita (📋 Convoca) o con ＋.</p></div>'}`;
  fillPhotos(root);
  $$('input[name=cs]', root).forEach((i) => (i.onchange = () => { sessionStorage.setItem('convShow', i.value); route(); }));
  $('#newc').onclick = () => editConvocation(null, { teams, players, code });
  $$('[data-cedit]', root).forEach((b) => (b.onclick = () => editConvocation(items.find((c) => c.id === b.dataset.cedit), { teams, players, code })));
  $$('[data-cdel]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('Eliminare la convocazione e le risposte?', 'Elimina', true))) return;
    try { await post('delete', { id: b.dataset.cdel }, code); route(); } catch (e) { toast(e.message, 4000); }
  }));
  $$('[data-cclose]', root).forEach((b) => (b.onclick = async () => {
    const c = items.find((x) => x.id === b.dataset.cclose);
    try { await post('save', { ...c, closed: !c.closed }, code); route(); } catch (e) { toast(e.message, 4000); }
  }));
  $$('[data-capply]', root).forEach((b) => (b.onclick = async () => {
    const c = items.find((x) => x.id === b.dataset.capply);
    const m = await db.get('matches', c.matchId);
    if (!m) { toast('Partita non trovata su questo telefono.'); return; }
    m.squad = Object.entries(resp[c.id] || {}).filter(([, r]) => r.r === 'si').map(([p]) => p);
    await db.put('matches', m);
    toast(`Convocati della partita aggiornati: ${m.squad.length} giocatori`);
  }));
}

function convCard(c, r, byId, teams) {
  const yes = c.players.filter((p) => r[p]?.r === 'si'), no = c.players.filter((p) => r[p]?.r === 'no'), wait = c.players.filter((p) => !r[p]);
  const chip = (id, extra = '') => { const p = byId[id]; return `<div class="seen-row"><span class="avatar" style="width:28px;height:28px;font-size:11px" data-rphoto="${id}">${esc(p ? ((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || '') : '?')}</span><span class="grow">${esc(p ? fullName(p) : 'Giocatore')}</span>${extra}</div>`; };
  const team = teams.find((t) => t.id === c.teamId);
  return `<div class="card conv">
    <div class="small muted">${c.kind === 'allenamento' ? '🏃 Allenamento' : '⚽ Partita'}${team ? ' · ' + esc(team.name) : ''}${c.closed ? ' · 🔒 chiusa' : ''}</div>
    <strong class="notice-title">${esc(c.title)}</strong>
    <div class="notice-when">🗓️ ${whenTxt(c)}${c.meetTime ? ` · ritrovo ${esc(c.meetTime)}` : ''}${c.place ? ` · 📍 ${esc(c.place)}` : ''}</div>
    <div class="conv-count mt"><span class="ok">✅ ${yes.length}</span><span class="ko">❌ ${no.length}</span><span class="muted">⏳ ${wait.length}</span><span class="muted">su ${c.players.length}</span></div>
    <details class="seen mt"><summary>Vedi le risposte</summary>
      ${yes.length ? `<div class="small ok mt"><strong>Ci sono</strong></div><div class="seen-list">${yes.map((id) => chip(id)).join('')}</div>` : ''}
      ${no.length ? `<div class="small ko mt"><strong>Non ci sono</strong></div><div class="seen-list">${no.map((id) => chip(id, r[id].note ? `<span class="small muted">${esc(r[id].note)}</span>` : '')).join('')}</div>` : ''}
      ${wait.length ? `<div class="small muted mt"><strong>In attesa</strong></div><div class="seen-list">${wait.map((id) => chip(id)).join('')}</div>` : ''}
    </details>
    <div class="row gap mt" style="flex-wrap:wrap">
      ${c.matchId ? `<button class="btn small grow" data-capply="${c.id}">Usa i "ci sono" come convocati</button>` : ''}
      <button class="btn small" data-cedit="${c.id}">Modifica</button>
      <button class="btn small" data-cclose="${c.id}">${c.closed ? 'Riapri' : 'Chiudi risposte'}</button>
      <button class="btn small danger" data-cdel="${c.id}">Elimina</button>
    </div></div>`;
}

/** Nuova convocazione (anche partendo da una partita) o modifica. */
export async function editConvocation(c, { teams, players, code, match = null, teamId = null }) {
  code = code || await db.getMeta('clubCode');
  if (!code) { toast('Rientra come mister con la password per convocare.', 4000); return; }
  teams = teams || await db.all('teams');
  players = players || await db.all('players');
  const team0 = c?.teamId || match?.teamId || teamId || teams[0]?.id;
  c = c || {
    kind: 'partita', teamId: team0, matchId: match?.id || '',
    title: match ? (match.home === false ? `${match.opponent} – Palazzo` : `Palazzo – ${match.opponent}`) : '',
    date: match?.date || '', time: match?.time || '', meetTime: '', place: match?.place || (match ? (match.home === false ? 'Trasferta' : 'Campo di casa') : ''),
    note: '', players: match?.squad?.length ? match.squad : players.filter((p) => p.teamId === team0).map((p) => p.id),
  };
  const saved = await sheet(c.id ? 'Modifica convocazione' : 'Nuova convocazione', (body, close) => {
    const draw = (teamSel, sel) => {
      const pool = players.filter((p) => p.teamId === teamSel).sort(byNumber);
      body.innerHTML = `<form class="form" id="cf">
        <div class="seg"><label><input type="radio" name="kind" value="partita" ${c.kind !== 'allenamento' ? 'checked' : ''}><span>⚽ Partita</span></label><label><input type="radio" name="kind" value="allenamento" ${c.kind === 'allenamento' ? 'checked' : ''}><span>🏃 Allenamento</span></label></div>
        <label>Squadra<select name="teamId">${teams.sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<option value="${t.id}" ${t.id === teamSel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label>Titolo<input name="title" maxlength="120" value="${esc(c.title)}" placeholder="es. Palazzo – Trevana"></label>
        <div class="row gap"><label class="grow">Data<input type="date" name="date" required value="${esc(c.date)}"></label><label class="grow">Ora<input type="time" name="time" value="${esc(c.time)}"></label></div>
        <div class="row gap"><label class="grow">Ritrovo<input type="time" name="meetTime" value="${esc(c.meetTime)}"></label><label class="grow">Luogo<input name="place" maxlength="120" value="${esc(c.place)}"></label></div>
        <label>Note<textarea name="note" rows="2" maxlength="600" placeholder="es. divisa blu, portare documento">${esc(c.note)}</textarea></label>
        <div class="row center"><span class="small muted grow">Convocati: <b id="cnt">${sel.size}</b></span><button type="button" class="btn-text small" id="all">Tutti</button><button type="button" class="btn-text small" id="none">Nessuno</button></div>
        <div class="num-grid mb">${pool.map((p) => `<button type="button" class="num-btn ${sel.has(p.id) ? 'on' : ''}" data-p="${p.id}"><b>${esc(p.number !== '' && p.number != null ? p.number : ((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || ''))}</b><small>${esc(p.lastName || p.firstName)}</small></button>`).join('')}</div>
        <p class="small muted">Rispondono dall'app solo i ragazzi con la scheda compilata e il profilo collegato.</p>
        <button class="btn primary block">${c.id ? 'Salva' : '📋 Pubblica convocazione'}</button></form>`;
      const f = body.querySelector('#cf');
      f.teamId.onchange = () => { c = readForm(f, c); draw(f.teamId.value, new Set(players.filter((p) => p.teamId === f.teamId.value).map((p) => p.id))); };
      $$('[data-p]', body).forEach((b) => (b.onclick = () => { sel.has(b.dataset.p) ? sel.delete(b.dataset.p) : sel.add(b.dataset.p); b.classList.toggle('on'); body.querySelector('#cnt').textContent = sel.size; }));
      body.querySelector('#all').onclick = () => { pool.forEach((p) => sel.add(p.id)); $$('[data-p]', body).forEach((b) => b.classList.add('on')); body.querySelector('#cnt').textContent = sel.size; };
      body.querySelector('#none').onclick = () => { sel.clear(); $$('[data-p]', body).forEach((b) => b.classList.remove('on')); body.querySelector('#cnt').textContent = 0; };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const data = { ...readForm(f, c), players: [...sel] };
        try { await post('save', data, code); close(true); } catch (err) { toast(err.message, 4000); }
      };
    };
    draw(c.teamId, new Set(c.players));
  });
  if (saved) { toast(c.id ? 'Convocazione aggiornata' : 'Convocazione pubblicata 📋'); location.hash = '#/convocazioni'; route(); }
}

function readForm(f, c) {
  const fd = new FormData(f);
  return { ...c, kind: fd.get('kind'), teamId: fd.get('teamId'), title: fd.get('title'), date: fd.get('date'), time: fd.get('time'), meetTime: fd.get('meetTime'), place: fd.get('place'), note: fd.get('note') };
}
