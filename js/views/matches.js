import * as db from '../db.js';
import { chooseFileAsAdmin } from '../admin.js';
import { esc, on, toast, confirmDialog, pick, sheet, fullName, fmtDate, clock, num, pct, today, chooseFile, readText, $, $$ } from '../util.js';
import { setHeader, loadSeason, state, route, byNumber } from '../app.js';
import {
  EVENT_TYPES, matchPlayerStats, matchTeamStats, minutesPlayed, onFieldAt, onFieldAtStart, periodElapsed, periodDuration,
  score, playerByNumber,
} from '../stats.js';
import { barChart, pitchHeatmap } from '../charts.js';
import { parseTracking, checkMeta } from '../tracking.js';
import { editConvocation } from './convocazioni.js';

const PERIOD_NAMES = ['1° tempo', '2° tempo', '3° tempo'];
const COMPETITIONS = ['Campionato', 'Torneo', 'Amichevole', 'Coppa'];

function scoreLabel(m, s) {
  return m.home === false ? `${s.subiti} – ${s.fatti}` : `${s.fatti} – ${s.subiti}`;
}

function matchTitle(m, team) {
  const us = 'Palazzo';
  return m.home === false ? `${m.opponent} – ${us}` : `${us} – ${m.opponent}`;
}

function shortName(p) {
  return p ? (p.lastName || p.firstName || '') : '?';
}

// ---------- Elenco partite ----------

export async function matchesView(root) {
  const ctx = await loadSeason();
  setHeader({ title: 'Partite', actions: `<a class="hdr-btn" href="#/partita/nuova" aria-label="Nuova partita">＋</a>` });
  if (!ctx.matches.length) {
    root.innerHTML = `<a class="btn block mb" href="#/calendario">📆 Calendario di tutte le squadre</a><div class="empty"><div class="empty-icon">📅</div><p>Nessuna partita in questa stagione.</p><a class="btn primary" href="#/partita/nuova">Crea la prima partita</a></div>`;
    return;
  }
  const res = { v: 0, n: 0, p: 0 };
  const items = ctx.matches.map((m) => {
    const ev = ctx.eventsByMatch[m.id] || [];
    const s = score(ev);
    const done = m.status === 'finita';
    if (done) res[s.fatti > s.subiti ? 'v' : s.fatti === s.subiti ? 'n' : 'p']++;
    const out = done ? (s.fatti > s.subiti ? 'win' : s.fatti === s.subiti ? 'draw' : 'loss') : '';
    const live = m.status === 'in corso';
    return `<a class="item" href="#/partita/${m.id}">
      <div class="date-box"><b>${esc(fmtDate(m.date, { day: '2-digit' }))}</b><small>${esc(fmtDate(m.date, { month: 'short' }))}</small></div>
      <div class="grow"><strong>${esc(m.opponent)}</strong> <span class="muted small">${m.home === false ? 'trasferta' : 'in casa'}</span>
        <div class="muted small">${esc(m.competition || '')}${m.round ? ' · ' + esc(m.round) : ''}${m.time ? ' · ' + esc(m.time) : ''}${(ctx.trackingByMatch[m.id] || []).length ? ' · 📡 tracking' : ''}</div></div>
      ${live ? '<span class="badge live">LIVE</span>' : done || ev.length ? `<span class="score ${out}">${scoreLabel(m, s)}</span>` : '<span class="badge">da giocare</span>'}
    </a>`;
  });
  root.innerHTML = `
    <a class="btn block mb" href="#/calendario">📆 Calendario di tutte le squadre</a>
    <div class="record"><span class="win">${res.v} V</span><span class="draw">${res.n} N</span><span class="loss">${res.p} P</span></div>
    <div class="list">${items.join('')}</div>`;
}

// ---------- Nuova / modifica partita ----------

export async function matchEditView(root, id) {
  const ctx = await loadSeason();
  const m = id ? await db.get('matches', id) : {
    teamId: state.teamId, seasonId: state.seasonId, date: today(), opponent: '', home: true, competition: 'Campionato',
    periodsCount: 2, periodMinutes: defaultMinutes(ctx.team), squad: ctx.players.map((p) => p.id), periods: [], status: 'da giocare',
  };
  if (!m) { root.innerHTML = '<div class="card">Partita non trovata.</div>'; return; }
  setHeader({ title: id ? 'Modifica partita' : 'Nuova partita', back: id ? `#/partita/${id}` : '#/partite' });
  const starters = new Set((m.periods?.[0]?.onFieldStart) || []);
  // partite importate dal calendario: convocati di default tutta la rosa
  const squad = new Set(m.squad && m.squad.length ? m.squad : ctx.players.map((p) => p.id));

  root.innerHTML = `
    <form class="form" id="mf">
      <div class="card">
        <label>Avversario<input name="opponent" required value="${esc(m.opponent)}" autocomplete="off"></label>
        <div class="row gap">
          <label class="grow">Data<input type="date" name="date" required value="${esc(m.date)}"></label>
          <label class="grow">Ora<input type="time" name="time" value="${esc(m.time || '')}"></label>
        </div>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="home" value="1" ${m.home !== false ? 'checked' : ''}><span>In casa</span></label>
          <label><input type="radio" name="home" value="0" ${m.home === false ? 'checked' : ''}><span>Trasferta</span></label>
        </div>
        <label>Competizione<select name="competition">${COMPETITIONS.map((c) => `<option ${c === m.competition ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Luogo<input name="place" value="${esc(m.place || '')}"></label>
      </div>
      <div class="card">
        <h3>Tempi</h3>
        <div class="seg">${[1, 2, 3].map((n) => `<label><input type="radio" name="periodsCount" value="${n}" ${Number(m.periodsCount) === n ? 'checked' : ''}><span>${n} ${n === 1 ? 'tempo' : 'tempi'}</span></label>`).join('')}</div>
        <label>Durata di ogni tempo (minuti)<input type="number" name="periodMinutes" inputmode="numeric" min="1" max="60" value="${esc(m.periodMinutes)}"></label>
        <label>Stato<select name="status">${['da giocare', 'in corso', 'finita'].map((s) => `<option ${s === m.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <p class="small muted">Se inserisci i dati a fine partita (senza live), imposta "finita": i minuti si calcolano sulla durata dei tempi.</p>
      </div>
      <div class="card">
        <h3>Convocati e titolari</h3>
        ${ctx.players.length ? `<div class="row gap mb"><button type="button" class="btn small" id="all">Tutti convocati</button><button type="button" class="btn small" id="none">Nessuno</button></div>
        <div class="lineup">${ctx.players.map((p) => `
          <div class="lineup-row"><span class="num">${esc(p.number ?? '')}</span><span class="grow">${esc(fullName(p))}</span>
            <label class="chip"><input type="checkbox" name="squad" value="${p.id}" ${squad.has(p.id) ? 'checked' : ''}><span>Conv.</span></label>
            <label class="chip"><input type="checkbox" name="starter" value="${p.id}" ${starters.has(p.id) ? 'checked' : ''}><span>Titolare</span></label></div>`).join('')}</div>
        <p class="small muted mt" id="cnt"></p>` : '<p class="muted">Aggiungi prima i giocatori nella Rosa.</p>'}
      </div>
      <div class="card"><label>Note<textarea name="notes" rows="3">${esc(m.notes || '')}</textarea></label></div>
      <button class="btn primary block">Salva</button>
      ${id ? '<button type="button" class="btn danger block mt" id="del">Elimina partita</button>' : ''}
    </form>`;

  const count = () => {
    const c = $$('input[name=starter]:checked', root).length;
    const s = $$('input[name=squad]:checked', root).length;
    const el = $('#cnt', root);
    if (el) el.textContent = `${s} convocati · ${c} titolari`;
  };
  $$('input[name=starter]', root).forEach((i) => i.addEventListener('change', () => {
    if (i.checked) root.querySelector(`input[name=squad][value="${i.value}"]`).checked = true;
    count();
  }));
  $$('input[name=squad]', root).forEach((i) => i.addEventListener('change', () => {
    if (!i.checked) root.querySelector(`input[name=starter][value="${i.value}"]`).checked = false;
    count();
  }));
  if ($('#all', root)) {
    $('#all', root).onclick = () => { $$('input[name=squad]', root).forEach((i) => (i.checked = true)); count(); };
    $('#none', root).onclick = () => { $$('input[name=squad], input[name=starter]', root).forEach((i) => (i.checked = false)); count(); };
  }
  count();

  $('#mf', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    m.opponent = f.get('opponent').trim();
    m.date = f.get('date');
    m.time = f.get('time');
    m.home = f.get('home') === '1';
    m.competition = f.get('competition');
    m.place = f.get('place').trim();
    m.periodsCount = Number(f.get('periodsCount'));
    m.periodMinutes = Number(f.get('periodMinutes')) || 20;
    m.status = f.get('status');
    m.notes = f.get('notes');
    m.squad = f.getAll('squad');
    m.periods = m.periods || [];
    m.periods[0] = { ...(m.periods[0] || {}), onFieldStart: f.getAll('starter') };
    await db.put('matches', m);
    toast('Partita salvata');
    location.hash = `#/partita/${m.id}`;
  };
  if (id) {
    $('#del', root).onclick = async () => {
      if (!(await confirmDialog('Eliminare la partita con tutti gli eventi e il tracking?', 'Elimina', true))) return;
      await db.deleteMatch(m.id);
      location.hash = '#/partite';
    };
  }
}

function defaultMinutes(team) {
  const c = (team?.category || '').toLowerCase();
  if (c.includes('piccoli') || c.includes('primi')) return 15;
  if (c.includes('pulcini') || c.includes('esordienti')) return 20;
  if (c.includes('giovanissimi')) return 35;
  if (c.includes('allievi')) return 40;
  if (c.includes('juniores')) return 45;
  return 20;
}

// ---------- Dettaglio partita ----------

export async function matchView(root, id) {
  const ctx = await loadSeason();
  const m = await db.get('matches', id);
  if (!m) { root.innerHTML = '<div class="card">Partita non trovata.</div>'; return; }
  const events = await db.where('events', 'matchId', id);
  const tracking = await db.where('tracking', 'matchId', id);
  const players = ctx.players;
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const s = score(events);
  const pstats = matchPlayerStats(m, events, tracking);
  const tstats = matchTeamStats(m, events);
  const n = m.periodsCount || 2;
  const tab = sessionStorage.getItem('matchTab') || 'giocatori';

  setHeader({ title: m.opponent, back: '#/partite', actions: `<a class="hdr-btn" href="#/partita/${id}/modifica">Modifica</a>` });

  const ids = Object.keys(pstats).filter((pid) => byId[pid]).sort((a, b) => byNumber(byId[a], byId[b]));
  const hasTr = tracking.length > 0;

  root.innerHTML = `
    <div class="match-head card">
      <div class="muted small">${esc(fmtDate(m.date, { weekday: 'long', day: 'numeric', month: 'long' }))}${m.time ? ' · ' + esc(m.time) : ''} · ${esc(m.competition || '')}${m.round ? ' · ' + esc(m.round) : ''}</div>
      <div class="mh-title">${esc(matchTitle(m, ctx.team))}</div>
      <div class="mh-score">${scoreLabel(m, s)}</div>
      <div class="muted small">${esc(m.status)} · ${n} ${n === 1 ? 'tempo' : 'tempi'} da ${m.periodMinutes}′</div>
      <button class="btn block mt" id="convoca">📋 Convoca i ragazzi (rispondono dall'app)</button>
      <a class="btn primary block mt" href="#/partita/${id}/live">${m.status === 'finita' ? '✏️ Apri tagging eventi' : m.status === 'in corso' ? '▶ Continua live' : '▶ Avvia live'}</a>
    </div>
    <div class="tabs" id="tabs">
      ${[['giocatori', 'Giocatori'], ['squadra', 'Squadra'], ['eventi', `Eventi (${events.length})`], ['minuti', 'Formazioni'], ['tracking', 'Tracking']]
        .map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}
    </div>

    <section data-pane="giocatori" ${tab === 'giocatori' ? '' : 'hidden'}>
      <div class="table-wrap"><table class="table sticky">
        <thead><tr><th>Giocatore</th><th>Min</th><th>G</th><th>A</th><th>Tiri</th><th>Pass</th><th>%</th><th>Rec</th><th>Perse</th>${hasTr ? '<th>m</th><th>Vmax</th>' : ''}</tr></thead>
        <tbody>${ids.map((pid) => {
          const l = pstats[pid], p = byId[pid];
          return `<tr onclick="location.hash='#/giocatore/${pid}'"><td><b>${esc(p.number ?? '')}</b> ${esc(shortName(p))}${l.entrato ? ' <span class="muted">↑</span>' : ''}${l.uscito ? ' <span class="muted">↓</span>' : ''}</td>
            <td>${Math.round(l.minuti)}</td><td>${l.gol || ''}</td><td>${l.assist || ''}</td><td>${l.tiri ? `${l.tiri}(${l.tiriPorta})` : ''}</td>
            <td>${l.passaggi ? `${l.passaggiOk}/${l.passaggi}` : ''}</td><td>${l.passaggi ? pct(l.precisione) : ''}</td><td>${l.recuperi || ''}</td><td>${l.perse || ''}</td>
            ${hasTr ? `<td>${l.distanza != null ? num(l.distanza) : ''}</td><td>${l.velMax != null ? num(l.velMax, 1) : ''}</td>` : ''}</tr>`;
        }).join('') || '<tr><td colspan="11" class="muted">Nessun dato. Indica i titolari e registra gli eventi.</td></tr>'}</tbody>
      </table></div>
      <p class="small muted">Tiri tra parentesi: in porta (gol compresi). ↑ entrato · ↓ uscito.</p>
    </section>

    <section data-pane="squadra" ${tab === 'squadra' ? '' : 'hidden'}>
      <div class="table-wrap"><table class="table">
        <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}°T</th>`).join('')}<th>Tot</th></tr></thead>
        <tbody>${[['golFatti', 'Gol fatti'], ['golSubiti', 'Gol subiti'], ['tiri', 'Tiri'], ['tiriPorta', 'Tiri in porta'], ['passaggiOk', 'Passaggi riusciti'], ['passaggi', 'Passaggi tentati'], ['precisione', 'Precisione'], ['recuperi', 'Recuperi'], ['perse', 'Palle perse'], ['cambi', 'Cambi']]
          .map(([k, l]) => `<tr><td>${l}</td>${Array.from({ length: n }, (_, i) => `<td>${k === 'precisione' ? pct(tstats[i + 1][k]) : tstats[i + 1][k]}</td>`).join('')}<td><b>${k === 'precisione' ? pct(tstats.totale[k]) : tstats.totale[k]}</b></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="card mt">${barChart({
        groups: ['Tiri', 'Pass. ok', 'Recuperi', 'Perse'],
        series: Array.from({ length: n }, (_, i) => ({ name: PERIOD_NAMES[i], values: [tstats[i + 1].tiri, tstats[i + 1].passaggiOk, tstats[i + 1].recuperi, tstats[i + 1].perse] })),
      })}</div>
    </section>

    <section data-pane="eventi" ${tab === 'eventi' ? '' : 'hidden'}>
      <button class="btn block mb" data-action="addEvent">+ Aggiungi evento manualmente</button>
      ${Array.from({ length: n }, (_, i) => {
        const list = events.filter((e) => e.period === i + 1).sort((a, b) => a.t - b.t);
        return `<h2 class="section">${PERIOD_NAMES[i]}</h2><div class="list">${list.map((e) => eventRow(e, byId, true)).join('') || '<div class="item muted">Nessun evento</div>'}</div>`;
      }).join('')}
    </section>

    <section data-pane="minuti" ${tab === 'minuti' ? '' : 'hidden'}>
      <p class="small muted">In campo all'inizio di ogni tempo e durata effettiva. I minuti di ogni giocatore si calcolano da qui e dai cambi.</p>
      ${Array.from({ length: n }, (_, i) => {
        const start = onFieldAtStart(m, events, i);
        const set = Array.isArray(m.periods?.[i]?.onFieldStart);
        return `<div class="card"><div class="row center"><h3 class="grow">${PERIOD_NAMES[i]}</h3><span class="muted small">${clock(periodDuration(m, i))}</span></div>
          <p class="small">${start.map((pid) => byId[pid] ? `<span class="pill">${esc(byId[pid].number ?? '')} ${esc(shortName(byId[pid]))}</span>` : '').join(' ') || '<span class="muted">Nessuno indicato</span>'}
          ${!set && i > 0 ? '<br><span class="muted">(stessi giocatori in campo a fine tempo precedente)</span>' : ''}</p>
          <div class="row gap"><button class="btn small grow" data-action="editField" data-i="${i}">Modifica in campo</button>
          <button class="btn small grow" data-action="editDur" data-i="${i}">Durata</button></div></div>`;
      }).join('')}
    </section>

    <section data-pane="tracking" ${tab === 'tracking' ? '' : 'hidden'}>
      <div class="card small">
        <p>Importa il file JSON del tracking di questa partita. I dati vengono collegati ai giocatori della rosa ${esc(ctx.team?.name || '')} ${esc(ctx.season?.name || '')} tramite il numero di maglia (considerando lo storico dei numeri).</p>
        <button class="btn primary block" data-action="importTracking">${hasTr ? 'Sostituisci file di tracking' : 'Importa file di tracking'}</button>
      </div>
      ${hasTr ? `<div class="list">${tracking.sort((a, b) => a.number - b.number).map((t) => {
        const p = byId[t.playerId];
        return `<div class="item"><span class="num-badge">${esc(t.number)}</span>
          <div class="grow">${p ? esc(fullName(p)) : '<span class="warn">Non collegato</span>'}<div class="muted small">${t.distance_m != null ? num(t.distance_m) + ' m' : ''}${t.max_speed_kmh != null ? ' · ' + num(t.max_speed_kmh, 1) + ' km/h' : ''}${t.sprints != null ? ' · ' + t.sprints + ' sprint' : ''}</div></div>
          ${t.heatmap ? `<button class="btn-text" data-action="heat" data-id="${t.id}">Mappa</button>` : ''}
          <button class="btn-text" data-action="relink" data-id="${t.id}">Collega</button></div>`;
      }).join('')}</div>
      <button class="btn danger block mt" data-action="delTracking">Elimina dati di tracking</button>` : ''}
    </section>`;

  $('#convoca', root).onclick = () => editConvocation(null, { code: null, match: m });
  $$('#tabs button', root).forEach((b) => (b.onclick = () => {
    sessionStorage.setItem('matchTab', b.dataset.tab);
    $$('#tabs button', root).forEach((x) => x.classList.toggle('active', x === b));
    $$('[data-pane]', root).forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  }));

  bindEventRows(root, events, m, players, () => route());

  on(root, 'addEvent', async () => {
    const e = await eventForm(m, players, { period: 1, t: 0, type: 'gol' });
    if (e) { await db.put('events', e); route(); }
  });
  on(root, 'editField', async (b) => {
    const i = +b.dataset.i;
    const chosen = await chooseOnField(m, players, onFieldAtStart(m, events, i), `In campo a inizio ${PERIOD_NAMES[i]}`);
    if (!chosen) return;
    m.periods = m.periods || [];
    m.periods[i] = { ...(m.periods[i] || {}), onFieldStart: chosen };
    await db.put('matches', m);
    route();
  });
  on(root, 'editDur', async (b) => {
    const i = +b.dataset.i;
    const cur = Math.round(periodDuration(m, i) / 60) || m.periodMinutes;
    const v = prompt(`Durata effettiva del ${PERIOD_NAMES[i]} in minuti (vuoto = automatica)`, cur);
    if (v === null) return;
    m.periods = m.periods || [];
    m.periods[i] = { ...(m.periods[i] || {}), durationSec: v.trim() === '' ? null : Math.round(Number(v.replace(',', '.')) * 60) };
    await db.put('matches', m);
    route();
  });
  on(root, 'importTracking', () => importTrackingFlow(m, ctx, tracking));
  on(root, 'delTracking', async () => {
    if (!(await confirmDialog('Eliminare tutti i dati di tracking di questa partita?', 'Elimina', true))) return;
    await db.delMany('tracking', tracking.map((t) => t.id));
    route();
  });
  on(root, 'relink', async (b) => {
    const t = tracking.find((x) => x.id === b.dataset.id);
    const v = await pick(`Numero ${t.number}: a chi appartiene?`, [
      { value: '__none', label: 'Nessuno (scollega)' },
      ...[...players].sort(byNumber).map((p) => ({ value: p.id, label: `${p.number ?? '–'} · ${fullName(p)}` })),
    ]);
    if (!v) return;
    t.playerId = v === '__none' ? null : v;
    await db.put('tracking', t);
    route();
  });
  on(root, 'heat', async (b) => {
    const t = tracking.find((x) => x.id === b.dataset.id);
    const p = byId[t.playerId];
    await sheet(`#${t.number} ${p ? fullName(p) : ''}`, (body) => {
      body.innerHTML = pitchHeatmap(t.heatmap, t.pitch, { trail: (t.positions || []).length < 1500 ? t.positions : null })
        + `<p class="small muted mt">${t.distance_m != null ? num(t.distance_m) + ' m percorsi' : ''}</p>`;
    });
  });
}

function eventRow(e, byId, editable) {
  const t = EVENT_TYPES[e.type] || { label: e.type, icon: '•' };
  const p = byId[e.playerId];
  let desc = t.label;
  if (e.type === 'tiro') desc += e.result === 'porta' ? ' in porta' : ' fuori';
  if (e.type === 'passaggio') desc += e.result === 'ok' ? ' riuscito' : ' sbagliato';
  let who = p ? `${p.number ?? ''} ${shortName(p)}` : '';
  if (e.type === 'cambio') who = `↓ ${p ? `${p.number ?? ''} ${shortName(p)}` : '?'}  ↑ ${byId[e.playerInId] ? `${byId[e.playerInId].number ?? ''} ${shortName(byId[e.playerInId])}` : '?'}`;
  if (e.type === 'gol' && byId[e.assistId]) who += ` (assist ${shortName(byId[e.assistId])})`;
  return `<div class="item ev-${e.type}"><span class="ev-time">${clock(e.t)}</span><span class="ev-icon">${t.icon}</span>
    <div class="grow"><strong>${esc(desc)}</strong><div class="muted small">${esc(who)}</div></div>
    ${editable ? `<button class="btn-text" data-edit="${e.id}">Modifica</button>` : ''}<button class="btn-text danger" data-delev="${e.id}" aria-label="Elimina">✕</button></div>`;
}

function bindEventRows(root, events, m, players, after) {
  $$('[data-delev]', root).forEach((b) => (b.onclick = async () => {
    await db.del('events', b.dataset.delev);
    toast('Evento eliminato');
    after();
  }));
  $$('[data-edit]', root).forEach((b) => (b.onclick = async () => {
    const e = events.find((x) => x.id === b.dataset.edit);
    const res = await eventForm(m, players, e);
    if (res) { await db.put('events', res); after(); }
  }));
}

/** Form completo per inserire/modificare un evento (uso post-partita). */
function eventForm(m, players, e) {
  const sorted = [...players].sort(byNumber);
  const opts = (sel) => `<option value="">—</option>` + sorted.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.number ?? '')} ${esc(fullName(p))}</option>`).join('');
  return sheet(e.id ? 'Modifica evento' : 'Nuovo evento', (body, close) => {
    body.innerHTML = `<form class="form" id="ef">
      <div class="row gap">
        <label class="grow">Tempo<select name="period">${Array.from({ length: m.periodsCount || 2 }, (_, i) => `<option value="${i + 1}" ${e.period === i + 1 ? 'selected' : ''}>${PERIOD_NAMES[i]}</option>`).join('')}</select></label>
        <label class="grow">Minuto<input name="min" type="number" inputmode="decimal" step="0.5" min="0" value="${Math.round((e.t || 0) / 6) / 10}"></label>
      </div>
      <label>Evento<select name="type">${Object.entries(EVENT_TYPES).map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
      <label data-show="res">Esito<select name="result"></select></label>
      <label data-show="player"><span data-plabel>Giocatore</span><select name="playerId">${opts(e.playerId)}</select></label>
      <label data-show="in">Entra<select name="playerInId">${opts(e.playerInId)}</select></label>
      <label data-show="assist">Assist<select name="assistId">${opts(e.assistId)}</select></label>
      <button class="btn primary block">Salva</button></form>`;
    const f = body.querySelector('#ef');
    const sync = () => {
      const type = f.type.value;
      const show = (k, v) => (body.querySelector(`[data-show="${k}"]`).hidden = !v);
      show('res', type === 'tiro' || type === 'passaggio');
      show('player', type !== 'golSubito');
      show('in', type === 'cambio');
      show('assist', type === 'gol');
      body.querySelector('[data-plabel]').textContent = type === 'cambio' ? 'Esce' : 'Giocatore';
      const resOpts = type === 'tiro' ? [['porta', 'In porta'], ['fuori', 'Fuori']] : [['ok', 'Riuscito'], ['ko', 'Sbagliato']];
      const cur = f.result.value || e.result;
      f.result.innerHTML = resOpts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
    };
    f.type.onchange = sync;
    sync();
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const type = f.type.value;
      close({
        ...e, matchId: m.id, type, period: Number(f.period.value), t: Math.round(Number(f.min.value || 0) * 60),
        result: type === 'tiro' || type === 'passaggio' ? f.result.value : null,
        playerId: type === 'golSubito' ? null : f.playerId.value || null,
        playerInId: type === 'cambio' ? f.playerInId.value || null : null,
        assistId: type === 'gol' ? f.assistId.value || null : null,
      });
    };
  });
}

/** Scelta multipla dei giocatori in campo. */
function chooseOnField(m, players, current, title) {
  const pool = [...players].filter((p) => !m.squad?.length || m.squad.includes(p.id) || current.includes(p.id)).sort(byNumber);
  return sheet(title, (body, close) => {
    const sel = new Set(current);
    const draw = () => {
      body.innerHTML = `<p class="small muted mb">${sel.size} selezionati</p>
        <div class="num-grid">${pool.map((p) => `<button class="num-btn ${sel.has(p.id) ? 'on' : ''}" data-id="${p.id}"><b>${esc(p.number ?? '–')}</b><small>${esc(shortName(p))}</small></button>`).join('')}</div>
        <button class="btn primary block mt" data-ok>Conferma</button>`;
      $$('[data-id]', body).forEach((b) => (b.onclick = () => { sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); draw(); }));
      body.querySelector('[data-ok]').onclick = () => close([...sel]);
    };
    draw();
  });
}

// ---------- Import tracking ----------

async function importTrackingFlow(m, ctx, existing) {
  const file = await chooseFileAsAdmin('application/json,.json', 'Le importazioni sono riservate all\'amministratore.');
  if (!file) return;
  let parsed;
  try {
    parsed = parseTracking(await readText(file));
  } catch (e) {
    toast(e.message, 5000);
    return;
  }
  const warnings = checkMeta(parsed, { match: m, team: ctx.team, season: ctx.season });
  const players = [...ctx.players].sort(byNumber);
  const mapping = parsed.players.map((tp) => ({ tp, playerId: playerByNumber(players, tp.number, m.date)?.id || null }));

  const ok = await sheet('Collega i numeri di maglia', (body, close) => {
    body.innerHTML = `
      ${warnings.length ? `<div class="warn-card card small">⚠️ ${warnings.map(esc).join('<br>')}</div>` : ''}
      <p class="small muted mb">${parsed.players.length} numeri nel file. Controlla i collegamenti (proposti in base al numero di maglia alla data della partita).</p>
      ${mapping.map((r, i) => `<div class="row gap center mb"><span class="num-badge">${esc(r.tp.number)}</span>
        <select class="grow" data-map="${i}"><option value="">— non collegare —</option>${players.map((p) => `<option value="${p.id}" ${p.id === r.playerId ? 'selected' : ''}>${esc(p.number ?? '–')} · ${esc(fullName(p))}</option>`).join('')}</select>
        <span class="small muted">${r.tp.distance_m != null ? num(r.tp.distance_m) + ' m' : ''}</span></div>`).join('')}
      <button class="btn primary block mt" data-ok>Importa</button>`;
    $$('[data-map]', body).forEach((s) => (s.onchange = () => (mapping[+s.dataset.map].playerId = s.value || null)));
    body.querySelector('[data-ok]').onclick = () => close(true);
  });
  if (!ok) return;
  const ids = mapping.map((r) => r.playerId).filter(Boolean);
  if (new Set(ids).size !== ids.length && !(await confirmDialog('Lo stesso giocatore è collegato a più numeri. I dati verranno sommati. Continuare?', 'Continua'))) return;

  await db.delMany('tracking', existing.map((t) => t.id));
  await db.putMany('tracking', mapping.map((r) => ({
    matchId: m.id, playerId: r.playerId, number: r.tp.number, distance_m: r.tp.distance_m, max_speed_kmh: r.tp.max_speed_kmh,
    sprints: r.tp.sprints, minutes: r.tp.minutes, positions: r.tp.positions, heatmap: r.tp.heatmap, pitch: parsed.pitch,
    importedAt: Date.now(), fileName: file.name,
  })));
  toast(`Tracking importato: ${mapping.filter((r) => r.playerId).length} giocatori collegati`);
  sessionStorage.setItem('matchTab', 'tracking');
  route();
}

// ---------- Live ----------

export async function liveView(root, id) {
  const ctx = await loadSeason();
  let m = await db.get('matches', id);
  if (!m) { root.innerHTML = '<div class="card">Partita non trovata.</div>'; return; }
  let events = await db.where('events', 'matchId', id);
  const players = ctx.players;
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const squad = () => (m.squad && m.squad.length ? players.filter((p) => m.squad.includes(p.id)) : players).sort(byNumber);
  m.periods = m.periods || [];
  if (m.livePeriod == null) m.livePeriod = 0;
  setHeader({ title: 'Live', back: `#/partita/${id}` });

  let wakeLock = null;
  const requestWake = async () => {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* non supportato */ }
  };
  requestWake();
  const onVis = () => { if (document.visibilityState === 'visible') requestWake(); };
  document.addEventListener('visibilitychange', onVis);

  const save = () => db.put('matches', m);
  const cur = () => m.periods[m.livePeriod] || (m.periods[m.livePeriod] = {});
  const now = () => periodElapsed(cur());
  const onField = () => onFieldAt(m, events, m.livePeriod, now() + 0.001);

  const draw = () => {
    const p = cur();
    const s = score(events);
    const field = onField();
    const n = m.periodsCount || 2;
    const started = p.running || (p.elapsed || 0) > 0 || p.ended;
    const recent = events.filter((e) => e.period === m.livePeriod + 1).sort((a, b) => b.t - a.t).slice(0, 6);
    root.innerHTML = `
      <div class="live-top">
        <div class="live-score"><span>${esc(m.home === false ? m.opponent : 'Palazzo')}</span><b>${scoreLabel(m, s)}</b><span>${esc(m.home === false ? 'Palazzo' : m.opponent)}</span></div>
        <div class="live-clock-row">
          <button class="period-btn" data-action="period">${PERIOD_NAMES[m.livePeriod]} ▾</button>
          <span class="live-clock ${p.running ? 'running' : ''}" id="clk">${clock(now())}</span>
          ${p.ended ? '<span class="badge">finito</span>'
            : p.running ? '<button class="btn small" data-action="pause">⏸</button>'
            : `<button class="btn small primary" data-action="start">${started ? '▶' : '▶ Inizia'}</button>`}
          ${started && !p.ended ? '<button class="btn small" data-action="end">Fine tempo</button>' : ''}
        </div>
        <div class="onfield small">${field.length ? field.map((pid) => byId[pid] ? `<span class="pill">${esc(byId[pid].number ?? '')}</span>` : '').join('') : '<span class="warn">Nessun giocatore in campo: tocca "In campo"</span>'}
          <button class="btn-text small" data-action="field">In campo</button></div>
      </div>

      <div class="actions">
        <button class="act act-gol" data-ev="gol">⚽<span>Gol</span></button>
        <button class="act" data-ev="tiro:porta">🎯<span>Tiro in porta</span></button>
        <button class="act" data-ev="tiro:fuori">↗️<span>Tiro fuori</span></button>
        <button class="act act-ok" data-ev="passaggio:ok">✅<span>Passaggio ok</span></button>
        <button class="act act-ko" data-ev="passaggio:ko">↪️<span>Passaggio sbagliato</span></button>
        <button class="act act-ko" data-ev="persa">❌<span>Palla persa</span></button>
        <button class="act act-ok" data-ev="recupero">🛡️<span>Recupero</span></button>
        <button class="act" data-ev="cambio">🔁<span>Cambio</span></button>
        <button class="act act-against" data-ev="golSubito">🥅<span>Gol subito</span></button>
      </div>

      <h2 class="section">Ultimi eventi · ${PERIOD_NAMES[m.livePeriod]}</h2>
      <div class="list">${recent.map((e) => eventRow(e, byId, false)).join('') || '<div class="item muted">Ancora nessun evento</div>'}</div>
      ${m.livePeriod === n - 1 && p.ended ? `<a class="btn primary block mt" href="#/partita/${id}">Partita finita · vedi statistiche</a>` : ''}`;

    on(root, 'start', startPeriod);
    on(root, 'pause', () => { const q = cur(); q.elapsed = periodElapsed(q); q.running = false; q.startedAt = null; save(); draw(); });
    on(root, 'end', endPeriod);
    on(root, 'field', editField);
    on(root, 'period', async () => {
      const v = await pick('Tempo', Array.from({ length: n }, (_, i) => ({ value: String(i), label: PERIOD_NAMES[i], sub: m.periods[i]?.ended ? 'finito' : '' })));
      if (v == null) return;
      if (cur().running) { const q = cur(); q.elapsed = periodElapsed(q); q.running = false; q.startedAt = null; }
      m.livePeriod = Number(v);
      await save();
      draw();
    });
    $$('[data-ev]', root).forEach((b) => (b.onclick = () => tag(b.dataset.ev)));
    bindEventRows(root, events, m, players, async () => { events = await db.where('events', 'matchId', id); draw(); });
  };

  async function editField() {
    const chosen = await chooseOnField(m, players, onFieldAtStart(m, events, m.livePeriod), `In campo a inizio ${PERIOD_NAMES[m.livePeriod]}`);
    if (!chosen) return;
    cur().onFieldStart = chosen;
    await save();
    draw();
  }

  async function startPeriod() {
    const p = cur();
    if (!(p.elapsed > 0) && !Array.isArray(p.onFieldStart)) {
      const def = onFieldAtStart(m, events, m.livePeriod);
      const chosen = await chooseOnField(m, players, def, `Chi inizia il ${PERIOD_NAMES[m.livePeriod]}?`);
      if (!chosen) return;
      p.onFieldStart = chosen;
    }
    p.running = true;
    p.startedAt = Date.now();
    m.status = 'in corso';
    await save();
    draw();
  }

  async function endPeriod() {
    if (!(await confirmDialog(`Terminare il ${PERIOD_NAMES[m.livePeriod]} al minuto ${clock(now())}?`, 'Fine tempo'))) return;
    const p = cur();
    p.elapsed = periodElapsed(p);
    p.running = false;
    p.startedAt = null;
    p.ended = true;
    if (m.livePeriod < (m.periodsCount || 2) - 1) {
      m.livePeriod++;
      toast(`Fine ${PERIOD_NAMES[m.livePeriod - 1]}`);
    } else {
      m.status = 'finita';
      toast('Partita finita');
    }
    await save();
    draw();
  }

  const playerOptions = (list, extra = []) => [
    ...list.map((p) => ({ value: p.id, label: String(p.number ?? '–'), sub: shortName(p) })),
    ...extra,
  ];

  async function tag(code) {
    const [type, result] = code.split(':');
    const t = Math.round(now());
    const period = m.livePeriod + 1;
    const fieldIds = onField();
    const inField = squad().filter((p) => fieldIds.includes(p.id));
    const bench = squad().filter((p) => !fieldIds.includes(p.id));
    const source = inField.length ? inField : squad();
    let ev = { matchId: m.id, period, t, type, result: result || null, playerId: null };

    if (type === 'golSubito') {
      // nessun giocatore
    } else if (type === 'cambio') {
      const out = await pick('Chi esce?', playerOptions(inField.length ? inField : squad()), { columns: 4 });
      if (!out) return;
      const inn = await pick('Chi entra?', playerOptions(bench.length ? bench : squad().filter((p) => p.id !== out)), { columns: 4 });
      if (!inn) return;
      ev.playerId = out;
      ev.playerInId = inn;
    } else {
      const label = { gol: 'Chi ha segnato?', tiro: 'Chi ha tirato?', passaggio: 'Chi ha passato?', persa: 'Chi ha perso palla?', recupero: 'Chi ha recuperato?' }[type];
      const extra = bench.length && inField.length ? [{ value: '__bench', label: 'Panchina…', cls: 'muted' }] : [];
      let pid = await pick(label, playerOptions(source, extra), { columns: 4 });
      if (pid === '__bench') pid = await pick(label, playerOptions(bench), { columns: 4 });
      if (!pid) return;
      ev.playerId = pid;
      if (type === 'gol') {
        const a = await pick('Assist?', [{ value: '__none', label: 'Nessuno', cls: 'muted' }, ...playerOptions(source.filter((p) => p.id !== pid))], { columns: 4 });
        if (a === undefined) return;
        ev.assistId = a && a !== '__none' ? a : null;
      }
    }
    ev = await db.put('events', ev);
    events.push(ev);
    if (navigator.vibrate) navigator.vibrate(30);
    const p = byId[ev.playerId];
    toast(`${EVENT_TYPES[type].label}${p ? ' · ' + (p.number ?? '') + ' ' + shortName(p) : ''} · ${clock(t)}`);
    draw();
  }

  draw();
  const timer = setInterval(() => {
    const el = document.getElementById('clk');
    if (el && cur().running) el.textContent = clock(now());
  }, 500);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    if (wakeLock) wakeLock.release().catch(() => {});
  };
}

export { minutesPlayed };
