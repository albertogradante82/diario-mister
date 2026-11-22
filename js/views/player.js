// Accesso giocatori/genitori: sola lettura, dati pubblici (dati/pubblico.json).
import { esc, fmtDate, today } from '../util.js';
import { setHeader } from '../app.js';
import { PALETTE } from '../charts.js';

let cache = null;
async function load() {
  if (cache) return cache;
  const r = await fetch('./dati/pubblico.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Dati non disponibili');
  cache = await r.json();
  return cache;
}

const ROLE_ORDER = ['Portiere', 'Difensore', 'Centrocampista', 'Attaccante', ''];

function teamColors(teams) {
  return Object.fromEntries([...teams].sort((a, b) => a.name.localeCompare(b.name)).map((t, i) => [t.id, PALETTE[i % PALETTE.length]]));
}

/** Chips per scegliere la squadra (ricordata tra le schermate). */
function teamPicker(teams, color, { all = false } = {}) {
  const sel = sessionStorage.getItem('pTeam') || (all ? 'tutte' : teams[0]?.id);
  return {
    sel,
    html: `<div class="chips mb">${all ? `<button class="chip-btn ${sel === 'tutte' ? 'on' : ''}" data-pt="tutte">Tutte</button>` : ''}${teams.map((t) =>
      `<button class="chip-btn ${sel === t.id ? 'on' : ''}" data-pt="${t.id}" style="${sel === t.id ? `background:${color[t.id]};border-color:${color[t.id]}` : ''}">${esc(t.name)}</button>`).join('')}</div>`,
  };
}
function bindPicker(root, redraw) {
  root.querySelectorAll('[data-pt]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('pTeam', b.dataset.pt); redraw(); }));
}

async function withData(root, fn) {
  try {
    return fn(await load());
  } catch {
    root.innerHTML = '<div class="empty"><div class="empty-icon">📡</div><p>Dati non disponibili. Controlla la connessione e riprova.</p></div>';
    return null;
  }
}

// ---------- Calendario e risultati ----------

export async function playerCalendarView(root) {
  setHeader({ title: 'Calendario' });
  await withData(root, (d) => {
    const color = teamColors(d.teams);
    const withMatches = d.teams.filter((t) => d.matches.some((m) => m.teamId === t.id));
    const draw = () => {
      const pick = teamPicker(withMatches, color, { all: true });
      const mode = sessionStorage.getItem('pMode') || 'prossime';
      const td = today();
      let list = d.matches.filter((m) => pick.sel === 'tutte' || m.teamId === pick.sel);
      list = mode === 'prossime' ? list.filter((m) => !m.played && m.date >= td) : list.filter((m) => m.played || m.date < td);
      list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) * (mode === 'prossime' ? 1 : -1));
      const tname = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
      root.innerHTML = `
        <div class="seg">${[['prossime', 'Prossime'], ['risultati', 'Risultati']].map(([k, l]) => `<label><input type="radio" name="pm" value="${k}" ${k === mode ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        ${pick.html}
        ${list.length ? `<div class="list">${list.map((m) => {
          const res = m.played && m.goalsFor != null ? (m.home === false ? `${m.goalsAgainst} – ${m.goalsFor}` : `${m.goalsFor} – ${m.goalsAgainst}`) : '';
          const out = res ? (m.goalsFor > m.goalsAgainst ? 'win' : m.goalsFor === m.goalsAgainst ? 'draw' : 'loss') : '';
          return `<div class="item"><span class="team-bar" style="background:${color[m.teamId]}"></span>
            <div class="date-box"><b>${esc(fmtDate(m.date, { day: '2-digit' }))}</b><small>${esc(fmtDate(m.date, { month: 'short' }))}</small></div>
            <div class="grow"><div class="small" style="color:${color[m.teamId]};font-weight:700">${esc(tname[m.teamId] || '')}</div>
              <strong>${m.home === false ? `${esc(m.opponent)} – Palazzo` : `Palazzo – ${esc(m.opponent)}`}</strong>
              <div class="muted small">${m.time ? 'ore ' + esc(m.time) + ' · ' : ''}${m.home === false ? 'trasferta' : 'in casa'}${m.round ? ' · ' + esc(m.round) : ''}</div>
              ${m.scorers && m.scorers.length ? `<div class="small">⚽ ${m.scorers.map(esc).join(', ')}</div>` : ''}</div>
            ${res ? `<span class="score ${out}">${res}</span>` : ''}</div>`;
        }).join('')}</div>` : `<div class="empty"><p>${mode === 'prossime' ? 'Nessuna partita in programma.' : 'Nessun risultato ancora.'}</p></div>`}`;
      root.querySelectorAll('input[name=pm]').forEach((i) => (i.onchange = () => { sessionStorage.setItem('pMode', i.value); draw(); }));
      bindPicker(root, draw);
    };
    draw();
  });
}

// ---------- Rose ----------

export async function playerRosterView(root) {
  setHeader({ title: 'Squadre' });
  await withData(root, (d) => {
    const color = teamColors(d.teams);
    const draw = () => {
      let pick = teamPicker(d.teams, color);
      if (!d.teams.some((t) => t.id === pick.sel)) { sessionStorage.setItem('pTeam', d.teams[0]?.id); pick = teamPicker(d.teams, color); }
      const list = d.players.filter((p) => p.teamId === pick.sel);
      const groups = ROLE_ORDER.map((r) => [r || 'Altri', list.filter((p) => (p.role || '') === r)]).filter(([, l]) => l.length);
      root.innerHTML = `${pick.html}
        ${groups.map(([role, l]) => `<h2 class="section">${esc(role)} <span class="muted">(${l.length})</span></h2>
          <div class="list">${l.sort((a, b) => (Number(a.number) || 99) - (Number(b.number) || 99) || a.name.localeCompare(b.name)).map((p) =>
            `<div class="item"><span class="num-badge">${esc(p.number === '' ? '–' : p.number)}</span><div class="grow">${esc(p.name)}</div></div>`).join('')}</div>`).join('')
          || '<div class="empty"><p>Rosa non disponibile.</p></div>'}`;
      bindPicker(root, draw);
    };
    draw();
  });
}

// ---------- Classifica e marcatori ----------

export async function playerScorersView(root) {
  setHeader({ title: 'Classifica' });
  await withData(root, (d) => {
    const color = teamColors(d.teams);
    const draw = () => {
      let pick = teamPicker(d.teams, color);
      if (!d.teams.some((t) => t.id === pick.sel)) { sessionStorage.setItem('pTeam', d.teams[0]?.id); pick = teamPicker(d.teams, color); }
      const team = d.teams.find((t) => t.id === pick.sel);
      const st = team?.stats;
      // marcatori: dati ufficiali se presenti, altrimenti dai tabellini registrati
      let scorers = (st?.marcatori || []).filter((m) => m.gol > 0).map((m) => ({ name: m.name, gol: m.gol, rig: m.rigori, ast: m.assist }));
      if (!scorers.length) {
        const count = {};
        d.matches.filter((m) => m.teamId === pick.sel).forEach((m) => (m.scorers || []).forEach((n) => { if (n) count[n] = (count[n] || 0) + 1; }));
        scorers = Object.entries(count).map(([name, gol]) => ({ name, gol }));
      }
      scorers.sort((a, b) => b.gol - a.gol || a.name.localeCompare(b.name));
      const assists = (st?.marcatori || []).filter((m) => m.assist > 0).sort((a, b) => b.assist - a.assist);
      root.innerHTML = `${pick.html}
        ${st?.classifica?.length ? `<h2 class="section">Classifica</h2>
          <div class="table-wrap"><table class="table standings">
            <thead><tr><th>#</th><th>Squadra</th><th>PT</th><th>G</th><th>V</th><th>N</th><th>P</th><th>DR</th></tr></thead>
            <tbody>${st.classifica.map((r) => `<tr class="${/palazzo/i.test(r.squadra) ? 'us' : ''}"><td>${r.pos}</td><td>${esc(r.squadra)}</td><td><b>${r.pt}</b></td><td>${r.g}</td><td>${r.v}</td><td>${r.n}</td><td>${r.p}</td><td>${r.dr > 0 ? '+' : ''}${r.dr}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}
        <h2 class="section">Marcatori</h2>
        ${scorers.length ? `<div class="list">${scorers.map((m, i) => `<div class="item"><span class="rank">${i + 1}</span><div class="grow">${esc(m.name)}</div><strong>${m.gol}</strong><span class="muted small">gol${m.rig ? ` (${m.rig} rig.)` : ''}</span></div>`).join('')}</div>`
          : '<div class="empty"><div class="empty-icon">⚽</div><p>Ancora nessun gol registrato per questa squadra.</p></div>'}
        ${assists.length ? `<h2 class="section">Assist</h2><div class="list">${assists.map((m, i) => `<div class="item"><span class="rank">${i + 1}</span><div class="grow">${esc(m.name)}</div><strong>${m.assist}</strong><span class="muted small">assist</span></div>`).join('')}</div>` : ''}
        ${st ? `<p class="small muted">Fonte: ${esc(st.fonte || 'Tuttocampo')}, aggiornata al ${esc(fmtDate(st.aggiornato))}.</p>` : ''}`;
      bindPicker(root, draw);
    };
    draw();
  });
}
