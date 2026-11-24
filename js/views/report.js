// Tabellino partita (dalla convocazione): titolari, cambi con tempo e minuto, eventi (gol con assist, palo,
// traversa, infortunio, …). Da qui si calcola il minutaggio di ogni giocatore.
// Lo compilano il mister o i giocatori registrati della squadra a partita conclusa.
import * as db from '../db.js';
import { esc, toast, fmtDate, today, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { me } from '../family.js';
import { publicData } from './board.js';

const API = './api/convocazioni';
export const EV = {
  gol: ['⚽', 'Gol'], assist: ['👟', 'Assist'], palo: ['🥅', 'Palo'], traversa: ['➖', 'Traversa'], infortunio: ['🩹', 'Infortunio'],
  ammonizione: ['🟨', 'Ammonizione'], espulsione: ['🟥', 'Espulsione'], rigoreSbagliato: ['❌', 'Rigore sbagliato'], parata: ['🧤', 'Parata decisiva'],
  autogol: ['🎁', 'Autogol avversario (a nostro favore)'],
};

async function call(url, opts = {}) {
  let r;
  try { r = await fetch(url, { cache: 'no-store', ...opts }); } catch { throw new Error('Nessuna connessione.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Errore ${r.status}`);
  return d;
}
let cache = null, cacheAt = 0;
export async function fetchReports(fresh = false) {
  if (!fresh && cache && Date.now() - cacheAt < 30000) return cache;
  cache = (await call(`${API}?action=reports`)).reports || {};
  cacheAt = Date.now();
  return cache;
}

/** Durata standard per categoria (modificabile nel tabellino). */
export function defaultFormat(teamName = '') {
  const n = teamName.toLowerCase();
  if (/prima squadra|juniores/.test(n)) return { halves: 2, halfLen: 45 };
  if (/allievi/.test(n)) return { halves: 2, halfLen: 40 };
  if (/giovanissimi/.test(n)) return { halves: 2, halfLen: 35 };
  if (/esordienti/.test(n)) return { halves: 3, halfLen: 20 };
  if (/pulcini/.test(n)) return { halves: 3, halfLen: 15 };
  if (/primi calci|piccoli/.test(n)) return { halves: 3, halfLen: 10 };
  return { halves: 2, halfLen: 35 };
}

/** Minuti giocati da ogni giocatore: titolari dal minuto 0, poi entrate/uscite in ordine di tempo. */
export function minutesOf(rep) {
  const L = rep.halfLen || 35, H = rep.halves || 2, total = L * H;
  const t = (h, m) => Math.min(total, (Math.min(h, H) - 1) * L + Math.min(m, L));
  const on = {}, min = {}, played = new Set(rep.starters || []);
  (rep.starters || []).forEach((p) => { on[p] = 0; min[p] = 0; });
  [...(rep.subs || [])].sort((a, b) => t(a.half, a.min) - t(b.half, b.min)).forEach((s) => {
    const at = t(s.half, s.min);
    if (s.out && on[s.out] != null) { min[s.out] = (min[s.out] || 0) + at - on[s.out]; delete on[s.out]; }
    if (s.in && on[s.in] == null) { on[s.in] = at; min[s.in] = min[s.in] || 0; played.add(s.in); }
  });
  Object.entries(on).forEach(([p, from]) => { min[p] = (min[p] || 0) + total - from; });
  return { min, played, total };
}

/** Statistiche di un giocatore da tutti i tabellini. */
export function playerReportStats(reports, playerId) {
  const out = { presenze: 0, titolare: 0, minuti: 0, gol: 0, assist: 0, palo: 0, traversa: 0, infortunio: 0, ammonizione: 0, espulsione: 0, partite: [] };
  Object.values(reports).sort((a, b) => b.date.localeCompare(a.date)).forEach((r) => {
    const { min, played } = minutesOf(r);
    const ev = (r.events || []);
    const mine = { gol: 0, assist: 0, palo: 0, traversa: 0, infortunio: 0, ammonizione: 0, espulsione: 0 };
    ev.forEach((e) => {
      if (e.playerId === playerId && mine[e.type] != null) mine[e.type]++;
      if (e.type === 'gol' && e.assistId === playerId) mine.assist++;
    });
    const was = played.has(playerId);
    if (!was && !Object.values(mine).some(Boolean)) return;
    if (was) out.presenze++;
    if ((r.starters || []).includes(playerId)) out.titolare++;
    out.minuti += min[playerId] || 0;
    Object.keys(mine).forEach((k) => (out[k] += mine[k]));
    out.partite.push({ title: r.title, date: r.date, min: min[playerId] || 0, starter: (r.starters || []).includes(playerId), ...mine });
  });
  return out;
}

const ico = (s) => ['gol', 'assist', 'palo', 'traversa', 'infortunio', 'ammonizione', 'espulsione'].filter((k) => s[k]).map((k) => `${EV[k][0]}${s[k] > 1 ? '×' + s[k] : ''}`).join(' ');

/** Riquadro "Minutaggio" per le schede giocatore (mister e ragazzi). */
export async function reportStatsCard(box, playerId) {
  let reports;
  try { reports = await fetchReports(); } catch { return; }
  const s = playerReportStats(reports, playerId);
  if (!s.partite.length) { box.innerHTML = '<div class="card small">⏱️ <strong>Minutaggio</strong>: comparirà quando verranno compilati i tabellini delle partite (Convocazioni → 📊 Tabellino).</div>'; return; }
  const tile = (l, v) => `<div class="tile"><b>${v}</b><small>${l}</small></div>`;
  box.innerHTML = `<h2 class="section">⏱️ Minutaggio e statistiche partite</h2>
    <div class="tiles">${tile('Presenze', s.presenze)}${tile('Titolare', s.titolare)}${tile('Minuti', s.minuti)}
      ${tile('Media min', s.presenze ? Math.round(s.minuti / s.presenze) : 0)}${tile('Gol', s.gol)}${tile('Assist', s.assist)}
      ${s.palo || s.traversa ? tile('Pali / traverse', `${s.palo} / ${s.traversa}`) : ''}${s.infortunio ? tile('Infortuni', s.infortunio) : ''}${s.ammonizione || s.espulsione ? tile('Gialli / rossi', `${s.ammonizione} / ${s.espulsione}`) : ''}</div>
    <div class="list">${s.partite.map((p) => `<div class="item"><div class="grow"><strong>${esc(p.title)}</strong><div class="muted small">${esc(fmtDate(p.date))} · ${p.starter ? 'titolare' : 'subentrato'}</div></div>
      <span class="small">${ico(p)}</span><span class="min-pill">${p.min}′</span></div>`).join('')}</div>
    <p class="small muted">Dai tabellini compilati dal mister e dai giocatori.</p>`;
}

// ---------- Elenco tabellini (area ragazzi) ----------

export async function playerReportsView(root) {
  setHeader({ title: 'Tabellini partite', back: '#/g/convocazioni' });
  const m = me();
  const [pub, convs, reports] = await Promise.all([publicData(), call(`${API}?action=list`).then((r) => r.items), fetchReports(true)]);
  const teamId = m ? pub.players.find((p) => p.id === m.id)?.teamId : null;
  const td = today();
  const list = convs.filter((c) => c.kind !== 'allenamento' && c.date <= td && (!teamId || c.teamId === teamId)).sort((a, b) => b.date.localeCompare(a.date));
  root.innerHTML = `${!m ? '<div class="card small">Collega il tuo profilo (Bacheca) per compilare i tabellini della tua squadra.</div>' : ''}
    ${list.length ? `<div class="list">${list.map((c) => {
      const r = reports[c.matchId || c.id];
      return `<a class="item" href="#/g/tabellino/${c.id}"><div class="grow"><strong>${esc(c.title)}</strong><div class="muted small">${esc(fmtDate(c.date))}</div></div>
        <span class="small ${r ? (r.locked ? 'ok' : '') : 'warn'}">${r ? (r.locked ? '🔒 confermato' : '✏️ compilato') : 'da compilare'}</span><span class="chev">›</span></a>`;
    }).join('')}</div>` : '<div class="empty"><div class="empty-icon">📊</div><p>Nessuna partita giocata con convocazione.</p></div>'}`;
}

// ---------- Pagina tabellino ----------

export function reportView(admin) {
  return async (root, convId) => {
    setHeader({ title: 'Tabellino', back: admin ? '#/convocazioni' : '#/g/tabellini' });
    let pub, conv, reports, code = null;
    try {
      [pub, conv, reports] = await Promise.all([publicData(), call(`${API}?action=list`).then((r) => r.items.find((c) => c.id === convId)), fetchReports(true)]);
      if (admin) code = await db.getMeta('clubCode');
    } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
    if (!conv) { root.innerHTML = '<div class="empty"><p>Convocazione non trovata.</p></div>'; return; }
    const team = pub.teams.find((t) => t.id === conv.teamId);
    const ident = me();
    const myTeam = ident && !ident.parent ? pub.players.find((p) => p.id === ident.id)?.teamId : null;
    const prev = reports[conv.matchId || conv.id];
    const concluded = conv.date <= today();
    const canEdit = admin ? !!code : (myTeam === conv.teamId && concluded && !prev?.locked);
    const fmt = defaultFormat(team?.name);
    const rep = prev ? JSON.parse(JSON.stringify(prev)) : { halves: fmt.halves, halfLen: fmt.halfLen, starters: [], squad: conv.players.slice(), subs: [], events: [], goalsAgainst: 0, note: '', locked: false };
    const pool = pub.players.filter((p) => p.teamId === conv.teamId);
    const name = (id) => pool.find((p) => p.id === id)?.name || pub.players.find((p) => p.id === id)?.name || '—';
    const short = (id) => { const n = name(id).split(' '); return n.length > 1 ? `${n[0][0]}. ${n.slice(1).join(' ')}` : n[0]; };
    const sortByNum = (a, b) => (Number(a.number) || 99) - (Number(b.number) || 99) || a.name.localeCompare(b.name);
    const squadIds = () => [...new Set([...(rep.squad || []), ...rep.starters])];
    const opts = (ids, sel, empty = '—') => `<option value="">${empty}</option>${ids.map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(name(id))}</option>`).join('')}`;
    const halfName = (h) => `${h}° tempo`;

    const draw = () => {
      const { min, played } = minutesOf(rep);
      const golF = rep.events.filter((e) => e.type === 'gol' || e.type === 'autogol').length;
      const squad = squadIds();
      const bench = squad.filter((id) => !rep.starters.includes(id));
      const evSorted = [...rep.events].map((e, i) => ({ ...e, i })).sort((a, b) => a.half - b.half || a.min - b.min);
      const subSorted = [...rep.subs].map((s, i) => ({ ...s, i })).sort((a, b) => a.half - b.half || a.min - b.min);
      root.innerHTML = `
        <div class="card center-col">
          <div class="muted small">${esc(fmtDate(conv.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(team?.name || '')}</div>
          <strong class="mt">${esc(conv.title)}</strong>
          <div class="report-score">${golF} – ${canEdit ? `<input type="number" id="ga" min="0" max="99" value="${rep.goalsAgainst}" inputmode="numeric">` : rep.goalsAgainst}</div>
          <div class="small muted">Gol nostri dagli eventi · gol subiti ${canEdit ? 'da inserire' : ''}</div>
          ${prev ? `<div class="small muted mt">${prev.locked ? '🔒 Confermato dal mister' : '✏️ Ultima modifica'}: ${esc(prev.by)} · ${esc(new Date(prev.updatedAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div>` : ''}
          ${!canEdit && !admin ? `<div class="small warn mt">${prev?.locked ? 'Tabellino confermato: sola lettura.' : !concluded ? 'Si compila a partita conclusa.' : 'Lo possono compilare il mister e i giocatori registrati della squadra.'}</div>` : ''}
        </div>
        ${canEdit ? `<div class="card row gap"><label class="grow">Tempi<select id="halves">${[1, 2, 3].map((n) => `<option ${n === rep.halves ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="grow">Minuti per tempo<input type="number" id="hl" min="10" max="60" value="${rep.halfLen}" inputmode="numeric"></label></div>` : `<p class="small muted">${rep.halves} tempi da ${rep.halfLen}′</p>`}

        <h2 class="section">1️⃣ Titolari · ${rep.starters.length}/11</h2>
        <div class="num-grid">${pool.slice().sort(sortByNum).filter((p) => canEdit || squad.includes(p.id)).map((p) => `<button type="button" class="num-btn ${rep.starters.includes(p.id) ? 'on' : squad.includes(p.id) ? 'bench' : ''}" data-st="${p.id}" ${canEdit ? '' : 'disabled'}>
          <b>${esc(p.number !== '' && p.number != null ? p.number : p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</b><small>${esc(p.name.split(' ').slice(-1)[0] === p.name ? p.name : p.name.split(' ')[1] || p.name)}</small></button>`).join('')}</div>
        ${canEdit ? '<p class="small muted">Tocca per segnare i titolari (blu). In grigio chiaro i convocati in panchina; tocca due volte un giocatore non convocato per aggiungerlo.</p>' : ''}

        <h2 class="section">🔁 Cambi</h2>
        ${subSorted.length ? `<div class="list">${subSorted.map((s) => `<div class="item"><span class="min-pill">${s.half}T ${s.min}′</span>
          <div class="grow small">${s.in ? `<span class="ok">⬆ ${esc(name(s.in))}</span>` : ''}${s.in && s.out ? '<br>' : ''}${s.out ? `<span class="ko">⬇ ${esc(name(s.out))}</span>` : ''}</div>
          ${canEdit ? `<button class="btn-text small danger" data-dsub="${s.i}">✕</button>` : ''}</div>`).join('')}</div>` : '<p class="small muted">Nessun cambio.</p>'}
        ${canEdit ? `<form class="card form add-row" id="addsub">
          <div class="row gap"><label class="grow">Tempo<select name="half">${Array.from({ length: rep.halves }, (_, i) => `<option value="${i + 1}">${halfName(i + 1)}</option>`).join('')}</select></label>
            <label class="grow">Minuto del tempo<input name="min" type="number" min="0" max="${rep.halfLen + 15}" inputmode="numeric" required></label></div>
          <label>⬆ Entra<select name="in">${opts(bench)}</select></label>
          <label>⬇ Esce<select name="out">${opts(squad)}</select></label>
          <button class="btn block">➕ Aggiungi cambio</button></form>` : ''}

        <h2 class="section">⚽ Eventi</h2>
        ${evSorted.length ? `<div class="list">${evSorted.map((e) => `<div class="item"><span class="min-pill">${e.half}T ${e.min}′</span><span style="font-size:20px">${EV[e.type][0]}</span>
          <div class="grow small"><strong>${esc(EV[e.type][1])}</strong>${e.playerId ? ' · ' + esc(name(e.playerId)) : ''}${e.assistId ? `<div class="muted">assist: ${esc(name(e.assistId))}</div>` : ''}${e.note ? `<div class="muted">${esc(e.note)}</div>` : ''}</div>
          ${canEdit ? `<button class="btn-text small danger" data-dev="${e.i}">✕</button>` : ''}</div>`).join('')}</div>` : '<p class="small muted">Nessun evento.</p>'}
        ${canEdit ? `<form class="card form add-row" id="addev">
          <label>Evento<select name="type">${Object.entries(EV).map(([k, [i, l]]) => `<option value="${k}">${i} ${l}</option>`).join('')}</select></label>
          <div class="row gap"><label class="grow">Tempo<select name="half">${Array.from({ length: rep.halves }, (_, i) => `<option value="${i + 1}">${halfName(i + 1)}</option>`).join('')}</select></label>
            <label class="grow">Minuto del tempo<input name="min" type="number" min="0" max="${rep.halfLen + 15}" inputmode="numeric" required></label></div>
          <label id="lblp">Giocatore<select name="playerId">${opts(squad)}</select></label>
          <label id="lbla">Assist di <span class="muted">(facoltativo)</span><select name="assistId">${opts(squad, '', 'nessuno')}</select></label>
          <label>Note <span class="muted">(facoltative)</span><input name="note" maxlength="80"></label>
          <button class="btn block">➕ Aggiungi evento</button></form>` : ''}

        <h2 class="section">⏱️ Minutaggio</h2>
        <div class="list">${squad.filter((id) => played.has(id)).sort((a, b) => (min[b] || 0) - (min[a] || 0)).map((id) => {
          const s = playerReportStats({ x: rep }, id);
          return `<div class="item"><div class="grow"><strong>${esc(name(id))}</strong><div class="muted small">${rep.starters.includes(id) ? 'titolare' : 'subentrato'}</div></div>
            <span class="small">${ico(s.partite[0] || {})}</span><span class="min-pill">${min[id] || 0}′</span></div>`;
        }).join('') || '<p class="small muted">Segna i titolari per calcolare i minuti.</p>'}</div>
        ${squad.filter((id) => !played.has(id)).length ? `<p class="small muted">Non entrati: ${squad.filter((id) => !played.has(id)).map((id) => esc(short(id))).join(', ')}</p>` : ''}

        ${canEdit ? `<label class="mt">Note<textarea id="rnote" rows="2" maxlength="400">${esc(rep.note || '')}</textarea></label>
          ${admin ? `<label class="consent-row mt"><input type="checkbox" id="lock" ${rep.locked ? 'checked' : ''}> 🔒 Conferma: i ragazzi non possono più modificarlo</label>` : ''}
          <button class="btn primary block mt" id="save">💾 Salva tabellino</button>` : ''}`;

      if (!canEdit) return;
      const sync = () => {
        rep.goalsAgainst = Number($('#ga', root).value) || 0;
        rep.note = $('#rnote', root).value;
        rep.locked = admin ? $('#lock', root).checked : rep.locked;
      };
      $('#halves', root).onchange = (e) => { sync(); rep.halves = Number(e.target.value); draw(); };
      $('#hl', root).onchange = (e) => { sync(); rep.halfLen = Math.max(10, Math.min(60, Number(e.target.value) || 35)); draw(); };
      $$('[data-st]', root).forEach((b) => (b.onclick = () => {
        sync();
        const id = b.dataset.st;
        if (!rep.squad.includes(id) && !rep.starters.includes(id)) rep.squad.push(id); // primo tocco: convocato
        else if (rep.starters.includes(id)) rep.starters = rep.starters.filter((x) => x !== id);
        else if (rep.starters.length >= 11) { toast('Già 11 titolari.'); return; } else rep.starters.push(id);
        draw();
      }));
      $('#addsub', root).onsubmit = (e) => {
        e.preventDefault(); sync();
        const f = new FormData(e.target);
        if (!f.get('in') && !f.get('out')) { toast('Scegli chi entra e/o chi esce.'); return; }
        if (f.get('in') && f.get('in') === f.get('out')) { toast('Entra ed esce lo stesso giocatore.'); return; }
        rep.subs.push({ half: Number(f.get('half')), min: Number(f.get('min')), in: f.get('in'), out: f.get('out') });
        draw();
      };
      const evf = $('#addev', root);
      const evType = () => { const t = evf.type.value; $('#lbla', root).hidden = t !== 'gol'; $('#lblp', root).hidden = t === 'autogol'; };
      evf.type.onchange = evType; evType();
      evf.onsubmit = (e) => {
        e.preventDefault(); sync();
        const f = new FormData(evf);
        const type = f.get('type');
        if (type !== 'autogol' && !f.get('playerId')) { toast('Scegli il giocatore.'); return; }
        rep.events.push({ type, half: Number(f.get('half')), min: Number(f.get('min')), playerId: type === 'autogol' ? '' : f.get('playerId'), assistId: type === 'gol' ? f.get('assistId') : '', note: f.get('note') });
        draw();
      };
      $$('[data-dsub]', root).forEach((b) => (b.onclick = () => { sync(); rep.subs.splice(Number(b.dataset.dsub), 1); draw(); }));
      $$('[data-dev]', root).forEach((b) => (b.onclick = () => { sync(); rep.events.splice(Number(b.dataset.dev), 1); draw(); }));
      $('#save', root).onclick = async () => {
        sync();
        if (!rep.starters.length) { toast('Segna almeno i titolari.'); return; }
        const body = { ...rep, convId: conv.id };
        try {
          const r = admin
            ? await call(`${API}?action=report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-code': code }, body: JSON.stringify(body) })
            : await call(`${API}?action=report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, playerId: ident.id, pin: ident.pin }) });
          cache = null;
          toast('Tabellino salvato ✓ Minutaggio aggiornato');
          Object.assign(rep, r.report);
          route();
        } catch (err) { toast(err.message, 4500); }
      };
    };
    draw();
  };
}
