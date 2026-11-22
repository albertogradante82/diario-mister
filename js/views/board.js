// Bacheca della società: avvisi, allenamenti, eventi. Lettura confermata dai giocatori verificati.
import * as db from '../db.js';
import { esc, fmtDate, toast, sheet, confirmDialog, fullName, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { listProfiles, fillPhotos } from '../profiles.js';
import { playerConvocationsBlock } from './convocazioni.js';

const API = './api/bacheca';
const KINDS = { comunicazione: ['📢', 'Comunicazione'], allenamento: ['🏃', 'Allenamento'], evento: ['🎉', 'Evento'], partita: ['⚽', 'Partita'] };

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

// ---------- identità del giocatore su questo telefono ----------
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return v; };
export const me = () => LS('mister-me');
const seen = () => new Set(LS('mister-seen') || []);
const markSeen = (id) => { const s = seen(); s.add(id); LS('mister-seen', [...s]); };

/** Avvisi non ancora letti su questo telefono (per il pallino sulla barra). */
export async function unreadCount(teamId) {
  try {
    const s = seen();
    return (await listNotices()).filter((n) => !s.has(n.id) && (!teamId || !n.teams.length || n.teams.includes(teamId))).length;
  } catch { return 0; }
}

function noticeCard(n, teamName, { unread = false, extra = '' } = {}) {
  const [icon, label] = KINDS[n.kind] || KINDS.comunicazione;
  return `<div class="card notice ${unread ? 'unread' : ''}" data-n="${n.id}">
    <div class="row gap center"><span class="notice-icon">${icon}</span>
      <div class="grow"><div class="small muted">${label}${n.teams.length ? ' · ' + n.teams.map((t) => esc(teamName(t))).join(', ') : ' · Tutta la società'}</div>
      <strong class="notice-title">${esc(n.title)}</strong></div>${unread ? '<span class="dot-new"></span>' : ''}</div>
    ${n.date || n.time || n.place ? `<div class="notice-when">🗓️ ${n.date ? esc(fmtDate(n.date, { weekday: 'long', day: 'numeric', month: 'long' })) : ''}${n.time ? ' · ore ' + esc(n.time) : ''}${n.place ? ' · 📍 ' + esc(n.place) : ''}</div>` : ''}
    ${n.text ? `<div class="notice-text">${esc(n.text)}</div>` : ''}
    <div class="small muted mt">${esc(new Date(n.createdAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${n.author ? ' · ' + esc(n.author) : ''}</div>
    ${extra}</div>`;
}

// ---------- Area giocatori ----------

export async function playerBoardView(root) {
  setHeader({ title: 'Bacheca' });
  let items, pub;
  try {
    [items, pub] = await Promise.all([listNotices(), fetch('./dati/pubblico.json', { cache: 'no-cache' }).then((r) => r.json())]);
  } catch (e) {
    root.innerHTML = `<div class="empty"><div class="empty-icon">📡</div><p>${esc(e.status === 503 ? 'Bacheca non ancora attiva.' : 'Bacheca non disponibile. Controlla la connessione.')}</p></div>`;
    return;
  }
  const teamName = (id) => (pub.teams.find((t) => t.id === id)?.name || '').replace(/ (Provinciali|Sperimentali)$/, '');
  const ident = me();
  const mine = ident && pub.players.find((p) => p.id === ident.id);
  const list = mine ? items.filter((n) => !n.teams.length || n.teams.includes(mine.teamId)) : items;
  const s = seen();
  const conv = await playerConvocationsBlock();

  root.innerHTML = `
    ${mine ? `<div class="card small row gap center"><span class="avatar" style="width:36px;height:36px" data-rphoto="${mine.id}">${esc(mine.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
        <div class="grow">Sei <strong>${esc(mine.name)}</strong> · ${esc(teamName(mine.teamId))}<div class="muted">Il mister vede quando leggi un avviso ✓</div></div>
        <button class="btn-text small" id="unlink">Cambia</button></div>`
      : `<div class="card small"><strong>Chi sei?</strong> Collega il tuo profilo per vedere gli avvisi della tua squadra e far sapere al mister che li hai letti.
        <button class="btn primary block mt" id="link">🔗 Collega il mio profilo</button>
        <p class="muted mt">Serve aver compilato la tua scheda giocatore (Squadre → il tuo nome) e il tuo PIN. Così vedi anche le <strong>convocazioni</strong> e puoi rispondere.</p></div>`}
    ${conv.html}
    ${conv.html && list.length ? '<h2 class="section">📣 Avvisi</h2>' : ''}
    ${list.length ? list.map((n) => noticeCard(n, teamName, { unread: !s.has(n.id) })).join('') : conv.html ? '' : '<div class="empty"><div class="empty-icon">📣</div><p>Nessun avviso per ora.</p></div>'}`;
  fillPhotos(root);
  conv.bind(root);

  // apertura/lettura: l'avviso è già visibile; lo segno come letto quando entra nello schermo
  const confirmRead = async (id) => {
    if (s.has(id)) return;
    s.add(id); markSeen(id);
    const card = root.querySelector(`[data-n="${id}"]`);
    if (card) { card.classList.remove('unread'); card.querySelector('.dot-new')?.remove(); }
    if (mine) { try { await post('read', { avvisoId: id, playerId: ident.id, pin: ident.pin }); } catch { /* riproverà */ } }
    updateBadge();
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => ents.forEach((e) => {
    if (e.isIntersecting && e.intersectionRatio > 0.6) { setTimeout(() => confirmRead(e.target.dataset.n), 1200); io.unobserve(e.target); }
  }), { threshold: [0.6] }) : null;
  $$('[data-n]', root).forEach((el) => (io ? io.observe(el) : confirmRead(el.dataset.n)));

  const ul = $('#unlink', root);
  if (ul) ul.onclick = () => { localStorage.removeItem('mister-me'); route(); };
  const lk = $('#link', root);
  if (lk) lk.onclick = () => linkProfile(pub);
  return () => io && io.disconnect();
}

async function linkProfile(pub) {
  const profs = await listProfiles();
  const verified = pub.players.filter((p) => profs[p.id]).sort((a, b) => a.name.localeCompare(b.name));
  if (!verified.length) { toast('Nessuna scheda compilata: prima compila la tua scheda giocatore.', 4000); return; }
  const done = await sheet('Collega il mio profilo', (body, close) => {
    body.innerHTML = `<form class="form" id="lf">
      <label>Chi sei?<select name="id" required><option value="">—</option>${verified.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc((pub.teams.find((t) => t.id === p.teamId)?.name) || '')}</option>`).join('')}</select></label>
      <label>Il tuo PIN<input name="pin" type="password" inputmode="numeric" maxlength="6" required class="code-input"></label>
      <p class="small warn" id="lerr" hidden></p>
      <button class="btn primary block">Collega</button></form>
      <p class="small muted mt">Non trovi il tuo nome? Prima compila la tua scheda da Squadre → il tuo nome.</p>`;
    body.querySelector('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await post('verify', { playerId: f.get('id'), pin: f.get('pin') });
        LS('mister-me', { id: f.get('id'), pin: f.get('pin') });
        localStorage.removeItem('mister-seen'); // ora le letture vengono confermate al mister
        close(true);
      } catch (err) { const el = body.querySelector('#lerr'); el.hidden = false; el.textContent = err.message; }
    };
  });
  if (done) { toast('Profilo collegato ✓'); route(); }
}

/** Aggiorna il pallino rosso sulla scheda Bacheca. */
export async function updateBadge() {
  const tab = document.querySelector('.tabbar a[data-tab="g-bacheca"]');
  if (!tab) return;
  let teamId = null;
  const ident = me();
  if (ident) {
    try { teamId = (await fetch('./dati/pubblico.json').then((r) => r.json())).players.find((p) => p.id === ident.id)?.teamId; } catch { /* */ }
  }
  let n = await unreadCount(teamId);
  if (ident) { try { n += (await playerConvocationsBlock()).pending; } catch { /* */ } }
  let b = tab.querySelector('.tab-badge');
  if (!n) { b?.remove(); return; }
  if (!b) { b = document.createElement('i'); b.className = 'tab-badge'; tab.appendChild(b); }
  b.textContent = n > 9 ? '9+' : n;
}

// ---------- Area mister ----------

export async function misterBoardView(root) {
  setHeader({ title: 'Bacheca', back: '#/home', actions: '<button class="hdr-btn" id="newn" aria-label="Nuovo avviso">＋</button>' });
  const code = await db.getMeta('clubCode');
  const [teams, players] = await Promise.all([db.all('teams'), db.all('players')]);
  const teamName = (id) => teams.find((t) => t.id === id)?.name || '';
  let items = [], reads = {}, profs = {};
  try {
    items = await listNotices();
    profs = await listProfiles();
    if (code) reads = (await call(`${API}?action=reads`, { headers: { 'x-admin-code': code } })).reads || {};
  } catch (e) {
    root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
    return;
  }

  root.innerHTML = items.length ? items.map((n) => {
    const target = players.filter((p) => !n.teams.length || n.teams.includes(p.teamId));
    const verified = target.filter((p) => profs[p.id]);
    const r = reads[n.id] || {};
    const seenBy = verified.filter((p) => r[p.id]).sort((a, b) => r[a.id] - r[b.id]);
    const notSeen = verified.filter((p) => !r[p.id]);
    const extra = `<details class="seen mt"><summary>👁️ <strong>Visto da ${seenBy.length}/${verified.length}</strong> giocatori verificati${target.length > verified.length ? ` <span class="muted">(${target.length - verified.length} senza scheda)</span>` : ''}</summary>
        ${seenBy.length ? `<div class="seen-list">${seenBy.map((p) => `<div class="seen-row"><span class="avatar" style="width:28px;height:28px;font-size:11px" data-rphoto="${p.id}">${esc(((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || ''))}</span><span class="grow">${esc(fullName(p))}</span><span class="ok small">✓ ${esc(new Date(r[p.id]).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></div>`).join('')}</div>` : ''}
        ${notSeen.length ? `<div class="small muted mt">Non ancora visto: ${notSeen.map((p) => esc(fullName(p))).join(', ')}</div>` : ''}
      </details>
      <div class="row gap mt"><button class="btn small grow" data-edit="${n.id}">Modifica</button><button class="btn small danger" data-del="${n.id}">Elimina</button></div>`;
    return noticeCard(n, teamName, { extra });
  }).join('') : '<div class="empty"><div class="empty-icon">📣</div><p>Nessun avviso. Tocca ＋ per pubblicarne uno.</p></div>';
  fillPhotos(root);

  $('#newn').onclick = () => editNotice(null, teams, code);
  $$('[data-edit]', root).forEach((b) => (b.onclick = () => editNotice(items.find((n) => n.id === b.dataset.edit), teams, code)));
  $$('[data-del]', root).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('Eliminare questo avviso?', 'Elimina', true))) return;
    try { await post('delete', { id: b.dataset.del }, code); toast('Avviso eliminato'); route(); } catch (e) { toast(e.message, 4000); }
  }));
}

async function editNotice(n, teams, code) {
  if (!code) { toast('Rientra come mister con la password per pubblicare avvisi.', 4000); return; }
  n = n || { title: '', text: '', kind: 'comunicazione', teams: [], date: '', time: '', place: '' };
  const saved = await sheet(n.id ? 'Modifica avviso' : 'Nuovo avviso', (body, close) => {
    body.innerHTML = `<form class="form" id="nf">
      <div class="seg seg-scroll">${Object.entries(KINDS).map(([k, [i, l]]) => `<label><input type="radio" name="kind" value="${k}" ${k === n.kind ? 'checked' : ''}><span>${i} ${l}</span></label>`).join('')}</div>
      <label>Titolo<input name="title" required maxlength="120" value="${esc(n.title)}" placeholder="es. Allenamento spostato a giovedì"></label>
      <label>Testo<textarea name="text" rows="4" maxlength="2000">${esc(n.text)}</textarea></label>
      <div class="row gap"><label class="grow">Data<input type="date" name="date" value="${esc(n.date)}"></label><label class="grow">Ora<input type="time" name="time" value="${esc(n.time)}"></label></div>
      <label>Luogo<input name="place" maxlength="120" value="${esc(n.place)}" placeholder="es. Campo comunale Palazzo"></label>
      <div class="small muted">Per chi è?</div>
      <div class="chips mb"><label class="chip"><input type="checkbox" name="all" ${!n.teams.length ? 'checked' : ''}><span>Tutta la società</span></label>
        ${teams.sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<label class="chip"><input type="checkbox" name="teams" value="${t.id}" ${n.teams.includes(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div>
      <button class="btn primary block">${n.id ? 'Salva' : '📣 Pubblica'}</button></form>`;
    const f = body.querySelector('#nf');
    const all = f.querySelector('input[name=all]');
    const tcs = [...f.querySelectorAll('input[name=teams]')];
    all.onchange = () => { if (all.checked) tcs.forEach((c) => (c.checked = false)); };
    tcs.forEach((c) => (c.onchange = () => { all.checked = !tcs.some((x) => x.checked); }));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await post('save', { id: n.id, title: fd.get('title'), text: fd.get('text'), kind: fd.get('kind'), date: fd.get('date'), time: fd.get('time'),
          place: fd.get('place'), teams: all.checked ? [] : fd.getAll('teams'), author: 'Il mister' }, code);
        close(true);
      } catch (err) { toast(err.message, 4000); }
    };
  });
  if (saved) { toast(n.id ? 'Avviso aggiornato' : 'Avviso pubblicato 📣'); route(); }
}
