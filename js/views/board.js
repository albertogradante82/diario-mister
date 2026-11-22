// Bacheca divisa per gruppo (squadra / società): solo il mister pubblica, i giocatori verificati rispondono.
import * as db from '../db.js';
import { esc, fmtDate, toast, sheet, confirmDialog, fullName, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { listProfiles, fillPhotos } from '../profiles.js';

const API = './api/bacheca';
const KINDS = { comunicazione: ['📢', 'Comunicazione'], allenamento: ['🏃', 'Allenamento'], evento: ['🎉', 'Evento'], partita: ['⚽', 'Partita'] };
const CLUB = 'societa';

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
export const listNotices = async () => (await call(`${API}?action=list`)).items || [];
const groupOf = (n) => (n.teams && n.teams.length ? n.teams[0] : CLUB);

// ---------- identità del giocatore su questo telefono ----------
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return v; };
export const me = () => LS('mister-me');
const seen = () => new Set(LS('mister-seen') || []);
const markSeen = (id) => { const s = seen(); s.add(id); LS('mister-seen', [...s]); };
let pubCache = null;
export async function publicData() {
  if (!pubCache) pubCache = fetch('./dati/pubblico.json', { cache: 'no-cache' }).then((r) => r.json()).catch((e) => { pubCache = null; throw e; });
  return pubCache;
}

export async function unreadCount(teamId) {
  try {
    const s = seen();
    return (await listNotices()).filter((n) => !s.has(n.id) && (groupOf(n) === CLUB || !teamId || groupOf(n) === teamId)).length;
  } catch { return 0; }
}

function repliesHtml(n, { admin = false } = {}) {
  const reps = n.replies || [];
  return `<div class="replies">${reps.map((r) => `<div class="reply ${r.mister ? 'reply-mister' : ''}">
      ${r.mister ? '<span class="avatar" style="width:30px;height:30px;font-size:13px">📋</span>' : `<span class="avatar" style="width:30px;height:30px;font-size:11px" data-rphoto="${esc(r.playerId)}">${esc(r.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`}
      <div class="grow"><div class="reply-head"><strong>${esc(r.name)}</strong> <span class="muted small">${esc(new Date(r.at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
        ${admin ? `<button class="btn-text small danger" data-delrep="${n.id}|${r.rid}">elimina</button>` : ''}</div>
      <div class="reply-text">${esc(r.text)}</div></div></div>`).join('')}</div>`;
}

function noticeCard(n, { unread = false, extra = '', replyBox = '', admin = false } = {}) {
  const [icon, label] = KINDS[n.kind] || KINDS.comunicazione;
  return `<div class="card notice ${unread ? 'unread' : ''}" data-n="${n.id}">
    <div class="row gap center"><span class="notice-icon">${icon}</span>
      <div class="grow"><div class="small muted">${label} · 📋 ${esc(n.author || 'Il mister')}</div>
      <strong class="notice-title">${esc(n.title)}</strong></div>${unread ? '<span class="dot-new"></span>' : ''}</div>
    ${n.date || n.time || n.place ? `<div class="notice-when">🗓️ ${n.date ? esc(fmtDate(n.date, { weekday: 'long', day: 'numeric', month: 'long' })) : ''}${n.time ? ' · ore ' + esc(n.time) : ''}${n.place ? ' · 📍 ' + esc(n.place) : ''}</div>` : ''}
    ${n.text ? `<div class="notice-text">${esc(n.text)}</div>` : ''}
    <div class="small muted mt">${esc(new Date(n.createdAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div>
    ${extra}
    ${(n.replies || []).length ? `<div class="small muted mt">💬 ${(n.replies || []).length} rispost${(n.replies || []).length === 1 ? 'a' : 'e'}</div>` : ''}
    ${repliesHtml(n, { admin })}
    ${replyBox}</div>`;
}

function groupChips(groups, sel) {
  return `<div class="chips mb">${groups.map(([id, name]) => `<button class="chip-btn ${id === sel ? 'on' : ''}" data-g="${id}">${esc(name)}</button>`).join('')}</div>`;
}

// ---------- Area giocatori ----------

export async function playerBoardView(root) {
  setHeader({ title: 'Bacheca' });
  let items, pub;
  try { [items, pub] = await Promise.all([listNotices(), publicData()]); } catch (e) {
    root.innerHTML = `<div class="empty"><div class="empty-icon">📡</div><p>${esc(e.status === 503 ? 'Bacheca non ancora attiva.' : 'Bacheca non disponibile. Controlla la connessione.')}</p></div>`;
    return;
  }
  const ident = me();
  const mine = ident && pub.players.find((p) => p.id === ident.id);
  const tname = (id) => (pub.teams.find((t) => t.id === id)?.name || '');
  const groups = mine
    ? [[mine.teamId, tname(mine.teamId)], [CLUB, 'Società']]
    : [[CLUB, 'Società'], ...pub.teams.map((t) => [t.id, t.name])];
  let sel = sessionStorage.getItem('boardG');
  if (!groups.some(([g]) => g === sel)) sel = groups[0][0];
  const s = seen();
  const unreadIn = (g) => items.filter((n) => groupOf(n) === g && !s.has(n.id)).length;
  const list = items.filter((n) => groupOf(n) === sel);

  root.innerHTML = `
    ${mine ? `<div class="card small row gap center"><span class="avatar" style="width:36px;height:36px" data-rphoto="${mine.id}">${esc(mine.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
        <div class="grow">Sei <strong>${esc(mine.name)}</strong><div class="muted">Puoi rispondere ai messaggi del mister · il mister vede chi ha letto ✓</div></div>
        <button class="btn-text small" id="unlink">Cambia</button></div>`
      : `<div class="card small"><strong>Chi sei?</strong> Collega il tuo profilo per vedere la bacheca della tua squadra, rispondere al mister e ricevere convocazioni.
        <button class="btn primary block mt" id="link">🔗 Collega il mio profilo</button>
        <p class="muted mt">Serve aver compilato la tua scheda giocatore (Altro → Squadre → il tuo nome) e il tuo PIN.</p></div>`}
    <div class="chips mb">${groups.map(([id, name]) => `<button class="chip-btn ${id === sel ? 'on' : ''}" data-g="${id}">${esc(name)}${unreadIn(id) ? ` <span class="chip-dot">${unreadIn(id)}</span>` : ''}</button>`).join('')}</div>
    ${list.length ? list.map((n) => noticeCard(n, {
      unread: !s.has(n.id),
      replyBox: mine ? `<form class="reply-form" data-rf="${n.id}"><input name="t" maxlength="500" placeholder="Rispondi come ${esc(mine.name)}…" autocomplete="off"><button class="btn small primary">Invia</button></form>` : '',
    })).join('') : '<div class="empty"><div class="empty-icon">📣</div><p>Nessun messaggio in questa bacheca.</p></div>'}`;
  fillPhotos(root);

  $$('[data-g]', root).forEach((b) => (b.onclick = () => { sessionStorage.setItem('boardG', b.dataset.g); route(); }));
  $$('[data-rf]', root).forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const text = f.t.value.trim();
    if (!text) return;
    f.querySelector('button').disabled = true;
    try { await post('reply', { avvisoId: f.dataset.rf, playerId: ident.id, pin: ident.pin, text }); route(); }
    catch (err) { toast(err.message, 4000); f.querySelector('button').disabled = false; }
  }));

  const confirmRead = async (id) => {
    if (s.has(id)) return;
    s.add(id); markSeen(id);
    const card = root.querySelector(`[data-n="${id}"]`);
    if (card) { card.classList.remove('unread'); card.querySelector('.dot-new')?.remove(); }
    if (mine) { try { await post('read', { avvisoId: id, playerId: ident.id, pin: ident.pin }); } catch { /* */ } }
    updateBadge();
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => ents.forEach((e) => {
    if (e.isIntersecting) { setTimeout(() => confirmRead(e.target.dataset.n), 1200); io.unobserve(e.target); }
  }), { threshold: [0.4] }) : null;
  $$('[data-n]', root).forEach((el) => (io ? io.observe(el) : confirmRead(el.dataset.n)));

  const ul = $('#unlink', root);
  if (ul) ul.onclick = () => { localStorage.removeItem('mister-me'); route(); };
  const lk = $('#link', root);
  if (lk) lk.onclick = () => linkProfile(pub);
  return () => io && io.disconnect();
}

export async function linkProfile(pub) {
  pub = pub || await publicData();
  const profs = await listProfiles();
  const verified = pub.players.filter((p) => profs[p.id]).sort((a, b) => a.name.localeCompare(b.name));
  if (!verified.length) { toast('Nessuna scheda compilata: prima compila la tua scheda giocatore.', 4000); return; }
  const done = await sheet('Collega il mio profilo', (body, close) => {
    body.innerHTML = `<form class="form" id="lf">
      <label>Chi sei?<select name="id" required><option value="">—</option>${verified.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc((pub.teams.find((t) => t.id === p.teamId)?.name) || '')}</option>`).join('')}</select></label>
      <label>Il tuo PIN<input name="pin" type="password" inputmode="numeric" maxlength="6" required class="code-input"></label>
      <p class="small warn" id="lerr" hidden></p>
      <button class="btn primary block">Collega</button></form>
      <p class="small muted mt">Non trovi il tuo nome? Prima compila la tua scheda da Altro → Squadre → il tuo nome.</p>`;
    body.querySelector('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await post('verify', { playerId: f.get('id'), pin: f.get('pin') });
        LS('mister-me', { id: f.get('id'), pin: f.get('pin') });
        localStorage.removeItem('mister-seen');
        close(true);
      } catch (err) { const el = body.querySelector('#lerr'); el.hidden = false; el.textContent = err.message; }
    };
  });
  if (done) { toast('Profilo collegato ✓'); route(); }
}

/** Pallini rossi sulle schede dell'area giocatori. */
export async function updateBadge() {
  const ident = me();
  let teamId = null;
  if (ident) { try { teamId = (await publicData()).players.find((p) => p.id === ident.id)?.teamId; } catch { /* */ } }
  const set = (tab, n) => {
    const el = document.querySelector(`.tabbar a[data-tab="${tab}"]`);
    if (!el) return;
    let b = el.querySelector('.tab-badge');
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('i'); b.className = 'tab-badge'; el.appendChild(b); }
    b.textContent = n > 9 ? '9+' : n;
  };
  set('g-bacheca', await unreadCount(teamId));
  if (ident) {
    try {
      const { pendingCounts } = await import('./convocazioni.js');
      const c = await pendingCounts();
      set('g-conv', c.partita); set('g-all', c.allenamento);
    } catch { /* */ }
  }
}

// ---------- Area mister ----------

export async function misterBoardView(root) {
  setHeader({ title: 'Bacheca', back: '#/home', actions: '<button class="hdr-btn" id="newn" aria-label="Nuovo messaggio">＋</button>' });
  const code = await db.getMeta('clubCode');
  const [teams, players] = await Promise.all([db.all('teams'), db.all('players')]);
  teams.sort((a, b) => a.name.localeCompare(b.name));
  let items = [], reads = {}, profs = {};
  try {
    items = await listNotices();
    profs = await listProfiles();
    if (code) reads = (await call(`${API}?action=reads`, { headers: { 'x-admin-code': code } })).reads || {};
  } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const groups = [[CLUB, 'Società'], ...teams.map((t) => [t.id, t.name])];
  let sel = sessionStorage.getItem('mBoardG') || CLUB;
  if (!groups.some(([g]) => g === sel)) sel = CLUB;
  const count = (g) => items.filter((n) => groupOf(n) === g).length;
  const list = items.filter((n) => groupOf(n) === sel);

  root.innerHTML = `
    <div class="chips mb">${groups.map(([id, name]) => `<button class="chip-btn ${id === sel ? 'on' : ''}" data-g="${id}">${esc(name)}${count(id) ? ` <span class="muted">${count(id)}</span>` : ''}</button>`).join('')}</div>
    <button class="btn primary block mb" id="newn2">📣 Nuovo messaggio in “${esc(groups.find(([g]) => g === sel)[1])}”</button>
    ${list.length ? list.map((n) => {
      const target = players.filter((p) => groupOf(n) === CLUB || p.teamId === groupOf(n));
      const verified = target.filter((p) => profs[p.id]);
      const r = reads[n.id] || {};
      const seenBy = verified.filter((p) => r[p.id]).sort((a, b) => r[a.id] - r[b.id]);
      const notSeen = verified.filter((p) => !r[p.id]);
      const extra = `<details class="seen mt"><summary>👁️ <strong>Visto da ${seenBy.length}/${verified.length}</strong> giocatori verificati${target.length > verified.length ? ` <span class="muted">(${target.length - verified.length} senza scheda)</span>` : ''}</summary>
          ${seenBy.length ? `<div class="seen-list">${seenBy.map((p) => `<div class="seen-row"><span class="avatar" style="width:28px;height:28px;font-size:11px" data-rphoto="${p.id}">${esc(((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || ''))}</span><span class="grow">${esc(fullName(p))}</span><span class="ok small">✓ ${esc(new Date(r[p.id]).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></div>`).join('')}</div>` : ''}
          ${notSeen.length ? `<div class="small muted mt">Non ancora visto: ${notSeen.map((p) => esc(fullName(p))).join(', ')}</div>` : ''}
        </details>
        <div class="row gap mt"><button class="btn small grow" data-edit="${n.id}">Modifica</button><button class="btn small danger" data-del="${n.id}">Elimina</button></div>`;
      return noticeCard(n, { extra, admin: true, replyBox: `<form class="reply-form" data-rf="${n.id}"><input name="t" maxlength="500" placeholder="Rispondi come mister…" autocomplete="off"><button class="btn small primary">Invia</button></form>` });
    }).join('') : '<div class="empty"><div class="empty-icon">📣</div><p>Nessun messaggio in questa bacheca.</p></div>'}`;
  fillPhotos(root);

  const open = (n) => editNotice(n, teams, code, n ? groupOf(n) : sel);
  $('#newn').onclick = () => open(null);
  $('#newn2', root).onclick = () => open(null);
  $$('[data-g]', root).forEach((b) => (b.onclick = () => { sessionStorage.setItem('mBoardG', b.dataset.g); route(); }));
  $$('[data-edit]', root).forEach((b) => (b.onclick = () => open(items.find((n) => n.id === b.dataset.edit))));
  $$('[data-del]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('Eliminare questo messaggio e le risposte?', 'Elimina', true))) return;
    try { await post('delete', { id: b.dataset.del }, code); toast('Messaggio eliminato'); route(); } catch (e) { toast(e.message, 4000); }
  }));
  $$('[data-rf]', root).forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.t.value.trim()) return;
    try { await post('reply', { avvisoId: f.dataset.rf, text: f.t.value, author: 'Mister' }, code); route(); } catch (err) { toast(err.message, 4000); }
  }));
  $$('[data-delrep]', root).forEach((b) => (b.onclick = async () => {
    const [avvisoId, rid] = b.dataset.delrep.split('|');
    if (!(await confirmDialog('Eliminare questa risposta?', 'Elimina', true))) return;
    try { await post('delreply', { avvisoId, rid }, code); route(); } catch (e) { toast(e.message, 4000); }
  }));
}

async function editNotice(n, teams, code, group) {
  if (!code) { toast('Rientra come mister con la password per scrivere in bacheca.', 4000); return; }
  n = n || { title: '', text: '', kind: 'comunicazione', teams: group === CLUB ? [] : [group], date: '', time: '', place: '' };
  const g0 = groupOf(n);
  const saved = await sheet(n.id ? 'Modifica messaggio' : 'Nuovo messaggio', (body, close) => {
    body.innerHTML = `<form class="form" id="nf">
      <label>Bacheca<select name="group"><option value="${CLUB}" ${g0 === CLUB ? 'selected' : ''}>Società (tutti)</option>${teams.map((t) => `<option value="${t.id}" ${g0 === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <div class="seg seg-scroll">${Object.entries(KINDS).map(([k, [i, l]]) => `<label><input type="radio" name="kind" value="${k}" ${k === n.kind ? 'checked' : ''}><span>${i} ${l}</span></label>`).join('')}</div>
      <label>Titolo<input name="title" required maxlength="120" value="${esc(n.title)}" placeholder="es. Allenamento spostato a giovedì"></label>
      <label>Testo<textarea name="text" rows="4" maxlength="2000">${esc(n.text)}</textarea></label>
      <div class="row gap"><label class="grow">Data<input type="date" name="date" value="${esc(n.date)}"></label><label class="grow">Ora<input type="time" name="time" value="${esc(n.time)}"></label></div>
      <label>Luogo<input name="place" maxlength="120" value="${esc(n.place)}"></label>
      <label>Firma<input name="author" maxlength="60" value="${esc(n.author || 'Il mister')}"></label>
      <button class="btn primary block">${n.id ? 'Salva' : '📣 Pubblica'}</button></form>`;
    const f = body.querySelector('#nf');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await post('save', { id: n.id, title: fd.get('title'), text: fd.get('text'), kind: fd.get('kind'), date: fd.get('date'), time: fd.get('time'),
          place: fd.get('place'), teams: fd.get('group') === CLUB ? [] : [fd.get('group')], author: fd.get('author') }, code);
        sessionStorage.setItem('mBoardG', fd.get('group'));
        close(true);
      } catch (err) { toast(err.message, 4000); }
    };
  });
  if (saved) { toast(n.id ? 'Messaggio aggiornato' : 'Messaggio pubblicato 📣'); route(); }
}

export { groupChips };
