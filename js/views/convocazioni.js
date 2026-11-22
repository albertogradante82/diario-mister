// Convocazioni partita (Presente / Non ci sono) e Presenze allenamenti (P / A).
import * as db from '../db.js';
import { esc, fmtDate, toast, sheet, confirmDialog, fullName, today, $, $$ } from '../util.js';
import { setHeader, route, byNumber } from '../app.js';
import { fillPhotos } from '../profiles.js';
import { me, linkProfile, updateBadge } from './board.js';

const API = './api/convocazioni';
const LABEL = {
  partita: { title: 'Convocazioni partita', icon: '⚽', yes: '✅ Presente', no: '❌ Non ci sono', yesShort: 'Presenti', noShort: 'Non ci sono', route: '#/convocazioni' },
  allenamento: { title: 'Presenze allenamenti', icon: '🏃', yes: 'P', no: 'A', yesShort: 'Presenti (P)', noShort: 'Assenti (A)', route: '#/allenamenti' },
};

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

/** Risposte in attesa del giocatore collegato, per i pallini sulla barra. */
export async function pendingCounts() {
  const ident = me();
  if (!ident) return { partita: 0, allenamento: 0 };
  const items = (await listConvocations()).filter((c) => upcoming(c) && c.players.includes(ident.id) && !c.closed);
  if (!items.length) return { partita: 0, allenamento: 0 };
  const mine = (await post('mine', { playerId: ident.id, pin: ident.pin })).mine || {};
  const p = items.filter((c) => !mine[c.id]);
  return { partita: p.filter((c) => c.kind !== 'allenamento').length, allenamento: p.filter((c) => c.kind === 'allenamento').length };
}

// ---------- Area giocatori ----------

export function playerConvView(kind) {
  return async (root) => {
    const L = LABEL[kind];
    setHeader({ title: L.title });
    const ident = me();
    if (!ident) {
      root.innerHTML = `<div class="card"><p><strong>Collega il tuo profilo</strong> per vedere ${kind === 'partita' ? 'le convocazioni' : 'gli allenamenti'} e rispondere al mister.</p>
        <button class="btn primary block mt" id="link">🔗 Collega il mio profilo</button>
        <p class="small muted mt">Serve aver compilato la tua scheda giocatore (Altro → Squadre → il tuo nome) e il tuo PIN.</p></div>`;
      $('#link', root).onclick = () => linkProfile();
      return;
    }
    let items = [], mine = {};
    try {
      const all = (await listConvocations()).filter((c) => c.players.includes(ident.id) && (kind === 'allenamento' ? c.kind === 'allenamento' : c.kind !== 'allenamento'));
      items = all.filter(upcoming);
      if (all.length) mine = (await post('mine', { playerId: ident.id, pin: ident.pin })).mine || {};
      // riepilogo presenze del ragazzo
      const past = all.filter((c) => !upcoming(c));
      const pres = past.filter((c) => mine[c.id]?.r === 'si').length;
      var summary = kind === 'allenamento' && past.length ? `<div class="card small row gap center"><span style="font-size:26px">📊</span><div class="grow">Le tue presenze agli allenamenti: <strong>${pres}/${past.length}</strong> (${Math.round((pres / past.length) * 100)}%)</div></div>` : '';
    } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }

    root.innerHTML = `${summary}
      ${items.length ? items.map((c) => {
        const r = mine[c.id];
        const state = r ? (r.r === 'si' ? 'si' : 'no') : 'wait';
        return `<div class="card conv conv-${state}">
          <div class="small muted">${L.icon} ${kind === 'partita' ? 'Convocazione' : 'Allenamento'}</div>
          <strong class="notice-title">${esc(c.title)}</strong>
          <div class="notice-when">🗓️ ${whenTxt(c)}${c.meetTime ? ` · ritrovo ${esc(c.meetTime)}` : ''}${c.place ? ` · 📍 ${esc(c.place)}` : ''}</div>
          ${c.note ? `<div class="notice-text">${esc(c.note)}</div>` : ''}
          <div class="conv-answer mt">${r ? (r.r === 'si' ? `✅ Hai risposto: <strong>${kind === 'partita' ? 'presente' : 'P – presente'}</strong>` : `❌ Hai risposto: <strong>${kind === 'partita' ? 'non ci sono' : 'A – assente'}</strong>${r.note ? ` (${esc(r.note)})` : ''}`) : '<span class="warn">⏳ Il mister aspetta la tua risposta</span>'}</div>
          ${c.closed ? '<p class="small muted">Risposte chiuse.</p>' : kind === 'allenamento'
            ? `<div class="pa-row mt"><button class="pa-btn pa-p ${r?.r === 'si' ? 'on' : ''}" data-yes="${c.id}">P<small>presente</small></button><button class="pa-btn pa-a ${r?.r === 'no' ? 'on' : ''}" data-no="${c.id}">A<small>assente</small></button></div>`
            : `<div class="row gap mt"><button class="btn grow conv-yes ${r?.r === 'si' ? 'primary' : ''}" data-yes="${c.id}">${L.yes}</button><button class="btn grow conv-no ${r?.r === 'no' ? 'danger' : ''}" data-no="${c.id}">${L.no}</button></div>`}
        </div>`;
      }).join('') : `<div class="empty"><div class="empty-icon">${L.icon}</div><p>${kind === 'partita' ? 'Nessuna convocazione in arrivo.' : 'Nessun allenamento in programma.'}</p></div>`}`;

    const answer = async (convId, r) => {
      let note = '';
      if (r === 'no') {
        note = await sheet(kind === 'partita' ? 'Non ci sei?' : 'Assente', (body, close) => {
          body.innerHTML = `<p class="small muted mb">Se vuoi, scrivi il motivo al mister (facoltativo).</p>
            <form id="nf" class="form"><input name="note" maxlength="200" placeholder="es. malato, scuola, impegno di famiglia…"><button class="btn danger block mt">Conferma</button></form>`;
          body.querySelector('#nf').onsubmit = (e) => { e.preventDefault(); close(new FormData(e.target).get('note') || ' '); };
        });
        if (note === undefined) return;
      }
      try { await post('respond', { convId, r, note: note.trim(), playerId: ident.id, pin: ident.pin }); toast('Risposta inviata ✓'); route(); updateBadge(); }
      catch (e) { toast(e.message, 4000); }
    };
    $$('[data-yes]', root).forEach((b) => (b.onclick = () => answer(b.dataset.yes, 'si')));
    $$('[data-no]', root).forEach((b) => (b.onclick = () => answer(b.dataset.no, 'no')));
  };
}

// ---------- Area mister ----------

export function misterConvView(kind) {
  return async (root) => {
    const L = LABEL[kind];
    setHeader({ title: L.title, back: '#/home', actions: '<button class="hdr-btn" id="newc" aria-label="Nuovo">＋</button>' });
    const code = await db.getMeta('clubCode');
    const [teams, players] = await Promise.all([db.all('teams'), db.all('players')]);
    teams.sort((a, b) => a.name.localeCompare(b.name));
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    let items = [], resp = {};
    try {
      items = (await listConvocations()).filter((c) => (kind === 'allenamento' ? c.kind === 'allenamento' : c.kind !== 'allenamento'));
      if (code) resp = (await call(`${API}?action=responses`, { headers: { 'x-admin-code': code } })).responses || {};
    } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    let team = sessionStorage.getItem('convTeam') || 'tutte';
    const show = sessionStorage.getItem('convShow') || 'prossime';
    const inTeam = items.filter((c) => team === 'tutte' || c.teamId === team);
    const list = inTeam.filter((c) => (show === 'prossime' ? upcoming(c) : !upcoming(c))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) * (show === 'prossime' ? 1 : -1));

    root.innerHTML = `
      <div class="chips mb"><button class="chip-btn ${team === 'tutte' ? 'on' : ''}" data-t="tutte">Tutte</button>${teams.map((t) => `<button class="chip-btn ${team === t.id ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      <div class="seg">${[['prossime', 'Prossimi'], ['passate', 'Passati'], ...(kind === 'allenamento' ? [['stat', '📊 Presenze']] : [])].map(([k, l]) => `<label><input type="radio" name="cs" value="${k}" ${show === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      ${show === 'stat' ? statsHtml(inTeam, resp, byId) : list.length ? list.map((c) => convCard(c, resp[c.id] || {}, byId, teams, kind)).join('')
        : `<div class="empty"><div class="empty-icon">${L.icon}</div><p>${kind === 'partita' ? 'Nessuna convocazione. Usa ＋ oppure “📋 Convoca” dalla partita.' : 'Nessun allenamento. Usa ＋ per crearli (anche ripetuti ogni settimana).'}</p></div>`}`;
    fillPhotos(root);
    $$('[data-t]', root).forEach((b) => (b.onclick = () => { sessionStorage.setItem('convTeam', b.dataset.t); route(); }));
    $$('input[name=cs]', root).forEach((i) => (i.onchange = () => { sessionStorage.setItem('convShow', i.value); route(); }));
    $('#newc').onclick = () => editConvocation(null, { teams, players, code, kind, teamId: team !== 'tutte' ? team : null });
    $$('[data-cedit]', root).forEach((b) => (b.onclick = () => editConvocation(items.find((c) => c.id === b.dataset.cedit), { teams, players, code, kind })));
    $$('[data-cdel]', root).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog('Eliminare e cancellare le risposte?', 'Elimina', true))) return;
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
  };
}

function statsHtml(items, resp, byId) {
  const past = items.filter((c) => !upcoming(c) || c.date === today());
  if (!past.length) return '<div class="empty"><p>Le percentuali compaiono dopo i primi allenamenti.</p></div>';
  const by = {};
  past.forEach((c) => c.players.forEach((pid) => {
    const s = (by[pid] = by[pid] || { p: 0, a: 0, n: 0, tot: 0 });
    s.tot++;
    const r = resp[c.id]?.[pid];
    if (!r) s.n++; else if (r.r === 'si') s.p++; else s.a++;
  }));
  const rows = Object.entries(by).filter(([id]) => byId[id]).sort((a, b) => b[1].p / b[1].tot - a[1].p / a[1].tot || byNumber(byId[a[0]], byId[b[0]]));
  return `<p class="small muted">${past.length} allenamenti. P = presente, A = assente, – = nessuna risposta.</p>
    <div class="list">${rows.map(([id, s]) => {
      const pct = Math.round((s.p / s.tot) * 100);
      return `<div class="item"><span class="avatar" style="width:34px;height:34px;font-size:12px" data-rphoto="${id}">${esc(((byId[id].firstName || '')[0] || '') + ((byId[id].lastName || '')[0] || ''))}</span>
        <div class="grow"><strong>${esc(fullName(byId[id]))}</strong><div class="pres-bar"><span style="width:${pct}%"></span></div></div>
        <div class="lb-nums"><div><b class="ok">${s.p}</b><small>P</small></div><div><b class="ko">${s.a}</b><small>A</small></div><div><b class="muted">${s.n}</b><small>–</small></div><div class="lb-tot"><b>${pct}%</b><small>pres.</small></div></div></div>`;
    }).join('')}</div>`;
}

function convCard(c, r, byId, teams, kind) {
  const L = LABEL[kind];
  const yes = c.players.filter((p) => r[p]?.r === 'si'), no = c.players.filter((p) => r[p]?.r === 'no'), wait = c.players.filter((p) => !r[p]);
  const chip = (id, extra = '') => { const p = byId[id]; return `<div class="seen-row"><span class="avatar" style="width:28px;height:28px;font-size:11px" data-rphoto="${id}">${esc(p ? ((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || '') : '?')}</span><span class="grow">${esc(p ? fullName(p) : 'Giocatore')}</span>${extra}</div>`; };
  const team = teams.find((t) => t.id === c.teamId);
  return `<div class="card conv">
    <div class="small muted">${L.icon} ${team ? esc(team.name) : ''}${c.closed ? ' · 🔒 chiuso' : ''}</div>
    <strong class="notice-title">${esc(c.title)}</strong>
    <div class="notice-when">🗓️ ${whenTxt(c)}${c.meetTime ? ` · ritrovo ${esc(c.meetTime)}` : ''}${c.place ? ` · 📍 ${esc(c.place)}` : ''}</div>
    <div class="conv-count mt"><span class="ok">${kind === 'allenamento' ? 'P' : '✅'} ${yes.length}</span><span class="ko">${kind === 'allenamento' ? 'A' : '❌'} ${no.length}</span><span class="muted">⏳ ${wait.length}</span><span class="muted">su ${c.players.length}</span></div>
    <details class="seen mt"><summary>Vedi le risposte</summary>
      ${yes.length ? `<div class="small ok mt"><strong>${L.yesShort}</strong></div><div class="seen-list">${yes.map((id) => chip(id)).join('')}</div>` : ''}
      ${no.length ? `<div class="small ko mt"><strong>${L.noShort}</strong></div><div class="seen-list">${no.map((id) => chip(id, r[id].note ? `<span class="small muted">${esc(r[id].note)}</span>` : '')).join('')}</div>` : ''}
      ${wait.length ? `<div class="small muted mt"><strong>In attesa</strong></div><div class="seen-list">${wait.map((id) => chip(id)).join('')}</div>` : ''}
    </details>
    <div class="row gap mt" style="flex-wrap:wrap">
      ${c.matchId ? '<button class="btn small grow" data-capply="' + c.id + '">Usa i presenti come convocati</button>' : ''}
      <button class="btn small" data-cedit="${c.id}">Modifica</button>
      <button class="btn small" data-cclose="${c.id}">${c.closed ? 'Riapri' : 'Chiudi risposte'}</button>
      <button class="btn small danger" data-cdel="${c.id}">Elimina</button>
    </div></div>`;
}

const DAYS = [['1', 'Lun'], ['2', 'Mar'], ['3', 'Mer'], ['4', 'Gio'], ['5', 'Ven'], ['6', 'Sab'], ['0', 'Dom']];

/** Nuova convocazione/allenamento (anche da una partita) o modifica. */
export async function editConvocation(c, { teams, players, code, match = null, teamId = null, kind = null }) {
  code = code || await db.getMeta('clubCode');
  if (!code) { toast('Rientra come mister con la password per convocare.', 4000); return; }
  teams = teams || await db.all('teams');
  players = players || await db.all('players');
  kind = c?.kind || kind || 'partita';
  const team0 = c?.teamId || match?.teamId || teamId || teams[0]?.id;
  c = c || {
    kind, teamId: team0, matchId: match?.id || '',
    title: match ? (match.home === false ? `${match.opponent} – Palazzo` : `Palazzo – ${match.opponent}`) : kind === 'allenamento' ? 'Allenamento' : '',
    date: match?.date || '', time: match?.time || '', meetTime: '', place: match?.place || (match ? (match.home === false ? 'Trasferta' : 'Campo di casa') : ''),
    note: '', players: match?.squad?.length ? match.squad : players.filter((p) => p.teamId === team0).map((p) => p.id),
  };
  const isNewTraining = kind === 'allenamento' && !c.id;
  const saved = await sheet(c.id ? 'Modifica' : kind === 'allenamento' ? 'Nuovo allenamento' : 'Nuova convocazione', (body, close) => {
    const draw = (teamSel, sel) => {
      const pool = players.filter((p) => p.teamId === teamSel).sort(byNumber);
      body.innerHTML = `<form class="form" id="cf">
        <label>Squadra<select name="teamId">${teams.map((t) => `<option value="${t.id}" ${t.id === teamSel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label>Titolo<input name="title" maxlength="120" value="${esc(c.title)}"></label>
        <div class="row gap"><label class="grow">${isNewTraining ? 'Dal giorno' : 'Data'}<input type="date" name="date" required value="${esc(c.date)}"></label><label class="grow">Ora<input type="time" name="time" value="${esc(c.time)}"></label></div>
        ${isNewTraining ? `<div class="small muted">Ripeti ogni settimana (facoltativo)</div>
          <div class="chips">${DAYS.map(([v, l]) => `<label class="chip"><input type="checkbox" name="days" value="${v}"><span>${l}</span></label>`).join('')}</div>
          <label class="mt">Fino al<input type="date" name="until"></label>` : ''}
        <div class="row gap"><label class="grow">Ritrovo<input type="time" name="meetTime" value="${esc(c.meetTime)}"></label><label class="grow">Luogo<input name="place" maxlength="120" value="${esc(c.place)}"></label></div>
        <label>Note<textarea name="note" rows="2" maxlength="600">${esc(c.note)}</textarea></label>
        <div class="row center"><span class="small muted grow">Giocatori: <b id="cnt">${sel.size}</b></span><button type="button" class="btn-text small" id="all">Tutti</button><button type="button" class="btn-text small" id="none">Nessuno</button></div>
        <div class="num-grid mb">${pool.map((p) => `<button type="button" class="num-btn ${sel.has(p.id) ? 'on' : ''}" data-p="${p.id}"><b>${esc(p.number !== '' && p.number != null ? p.number : ((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || ''))}</b><small>${esc(p.lastName || p.firstName)}</small></button>`).join('')}</div>
        <button class="btn primary block">${c.id ? 'Salva' : kind === 'allenamento' ? '🏃 Pubblica allenamento' : '📋 Pubblica convocazione'}</button></form>`;
      const f = body.querySelector('#cf');
      f.teamId.onchange = () => { c = readForm(f, c); draw(f.teamId.value, new Set(players.filter((p) => p.teamId === f.teamId.value).map((p) => p.id))); };
      const cnt = () => (body.querySelector('#cnt').textContent = sel.size);
      $$('[data-p]', body).forEach((b) => (b.onclick = () => { sel.has(b.dataset.p) ? sel.delete(b.dataset.p) : sel.add(b.dataset.p); b.classList.toggle('on'); cnt(); }));
      body.querySelector('#all').onclick = () => { pool.forEach((p) => sel.add(p.id)); $$('[data-p]', body).forEach((b) => b.classList.add('on')); cnt(); };
      body.querySelector('#none').onclick = () => { sel.clear(); $$('[data-p]', body).forEach((b) => b.classList.remove('on')); cnt(); };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const data = { ...readForm(f, c), kind, players: [...sel] };
        const fd = new FormData(f);
        const days = fd.getAll('days'), until = fd.get('until');
        let dates = [data.date];
        if (isNewTraining && days.length && until) {
          dates = [];
          for (let d = new Date(data.date + 'T12:00:00'); d <= new Date(until + 'T12:00:00') && dates.length < 120; d.setDate(d.getDate() + 1)) {
            if (days.includes(String(d.getDay()))) dates.push(d.toISOString().slice(0, 10));
          }
          if (!dates.length) { toast('Nessun giorno nel periodo scelto.'); return; }
          if (!(await confirmDialog(`Creare ${dates.length} allenamenti?`, 'Crea'))) return;
        }
        try { for (const date of dates) await post('save', { ...data, date }, code); close(dates.length); } catch (err) { toast(err.message, 4000); }
      };
    };
    draw(c.teamId, new Set(c.players));
  });
  if (saved) {
    toast(c.id ? 'Aggiornato' : saved > 1 ? `${saved} allenamenti creati 🏃` : 'Pubblicato ✓');
    location.hash = LABEL[kind].route; route();
  }
}

function readForm(f, c) {
  const fd = new FormData(f);
  return { ...c, teamId: fd.get('teamId'), title: fd.get('title'), date: fd.get('date'), time: fd.get('time'), meetTime: fd.get('meetTime'), place: fd.get('place'), note: fd.get('note') };
}
