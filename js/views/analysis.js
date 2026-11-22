import { esc, fullName, shortDate, num, pct, ROLES, $, $$ } from '../util.js';
import { setHeader, loadSeason } from '../app.js';
import { seasonData, seasonTotals, per90, playerSeries, METRICS, detectTrends, detectTeamTrends } from '../stats.js';
import { lineChart, barChart, hBars, PALETTE } from '../charts.js';

const TABS = [['andamento', 'Andamento'], ['ruoli', 'Ruoli'], ['per90', 'Per 90′'], ['tempi', 'Tempi'], ['tendenze', 'Tendenze']];
const PERIOD_NAMES = ['1° tempo', '2° tempo', '3° tempo'];

export async function analysisView(root) {
  setHeader({ title: 'Analisi' });
  const ctx = await loadSeason();
  const rows = seasonData(ctx).filter((r) => r.match.status === 'finita' || r.events.length || r.tracking.length);
  const players = ctx.players;
  const totals = Object.fromEntries(players.map((p) => [p.id, seasonTotals(rows, p.id)]));
  const hasTracking = rows.some((r) => r.tracking.length);
  let tab = sessionStorage.getItem('anTab') || 'andamento';

  if (!rows.length) {
    root.innerHTML = `<div class="empty"><div class="empty-icon">📊</div><p>Le analisi compariranno dopo aver registrato almeno una partita.</p></div>`;
    return;
  }

  root.innerHTML = `<div class="tabs" id="atabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="pane"></div>`;
  const pane = $('#pane', root);
  $$('#atabs button', root).forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    sessionStorage.setItem('anTab', tab);
    $$('#atabs button', root).forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));

  const metricKeys = ['gol', 'assist', 'tiri', 'tiriPorta', 'passaggiOk', 'precisione', 'recuperi', 'perse', 'minuti', ...(hasTracking ? ['distanza', 'velMax', 'sprint'] : [])];
  const labels = rows.map((r) => shortDate(r.match.date));
  const active = players.filter((p) => totals[p.id].minuti > 0);

  function draw() {
    ({ andamento, ruoli, per90: per90Tab, tempi, tendenze })[tab]();
  }

  // ---- Andamento: un grafico per giocatori selezionati ----
  let selected = JSON.parse(sessionStorage.getItem('anSel') || 'null') ||
    [...active].sort((a, b) => totals[b.id].minuti - totals[a.id].minuti).slice(0, 3).map((p) => p.id);
  function andamento() {
    pane.innerHTML = `
      <div class="card">
        <div class="row gap mb"><select id="am" class="grow">${metricKeys.map((k) => `<option value="${k}">${esc(METRICS[k].label)}</option>`).join('')}</select>
        <label class="switch small"><input type="checkbox" id="an"> per 90′</label></div>
        <div id="ach"></div>
        <p class="small muted">Tocca i giocatori per aggiungerli o toglierli dal grafico (max 6).</p>
        <div class="chips">${active.map((p) => `<button class="chip-btn ${selected.includes(p.id) ? 'on' : ''}" data-p="${p.id}">${esc(p.number ?? '')} ${esc(p.lastName || p.firstName)}</button>`).join('')}</div>
      </div>
      <h2 class="section">Squadra partita per partita</h2>
      <div class="card">${lineChart({ labels, series: [
        { name: 'Gol fatti', values: rows.map((r) => r.team.totale.golFatti), color: PALETTE[2] },
        { name: 'Gol subiti', values: rows.map((r) => r.team.totale.golSubiti), color: PALETTE[6] },
        { name: 'Tiri', values: rows.map((r) => r.team.totale.tiri), color: PALETTE[0] },
      ] })}</div>
      <div class="card">${lineChart({ labels, percent: true, series: [{ name: 'Precisione passaggi', values: rows.map((r) => r.team.totale.precisione) }] })}<p class="small muted">Precisione passaggi della squadra</p></div>`;
    const m = $('#am', pane), n = $('#an', pane);
    m.value = sessionStorage.getItem('anMetric') || 'gol';
    const chart = () => {
      sessionStorage.setItem('anMetric', m.value);
      const key = m.value;
      const norm = n.checked && METRICS[key].per90;
      $('#ach', pane).innerHTML = lineChart({
        labels,
        percent: !!METRICS[key].ratio,
        series: selected.map((id, i) => ({ name: shortLabel(players.find((p) => p.id === id)), values: playerSeries(rows, id, key, { normalize: norm }), color: PALETTE[i % PALETTE.length] })),
        empty: 'Seleziona almeno un giocatore',
      });
    };
    m.onchange = chart;
    n.onchange = chart;
    $$('[data-p]', pane).forEach((b) => (b.onclick = () => {
      const id = b.dataset.p;
      selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-6);
      sessionStorage.setItem('anSel', JSON.stringify(selected));
      $$('[data-p]', pane).forEach((x) => x.classList.toggle('on', selected.includes(x.dataset.p)));
      chart();
    }));
    chart();
  }

  // ---- Confronto per ruolo ----
  function ruoli() {
    const role = sessionStorage.getItem('anRole') || ROLES[2];
    const keys = ['gol', 'assist', 'tiri', 'passaggiOk', 'precisione', 'recuperi', 'perse', ...(hasTracking ? ['distanza'] : [])];
    pane.innerHTML = `
      <div class="card">
        <div class="seg seg-scroll">${ROLES.map((r) => `<label><input type="radio" name="role" value="${r}" ${r === role ? 'checked' : ''}><span>${r}</span></label>`).join('')}</div>
        <div class="row gap mt"><select id="rm" class="grow">${keys.map((k) => `<option value="${k}">${esc(METRICS[k].label)}${METRICS[k].per90 ? ' /90′' : ''}</option>`).join('')}</select>
        <select id="rmin"><option value="45">≥45′</option><option value="90">≥90′</option><option value="1">tutti</option></select></div>
      </div>
      <div class="card" id="rbars"></div>
      <div class="table-wrap" id="rtable"></div>`;
    const drawRole = () => {
      const r = $('input[name=role]:checked', pane).value;
      sessionStorage.setItem('anRole', r);
      const key = $('#rm', pane).value, min = Number($('#rmin', pane).value);
      const list = players.filter((p) => p.role === r && totals[p.id].minuti >= min);
      const meta = METRICS[key];
      const items = list.map((p) => ({ p, v: per90(totals[p.id], key, min) }))
        .sort((a, b) => (meta.higherIsBetter === false ? (a.v ?? 1e9) - (b.v ?? 1e9) : (b.v ?? -1) - (a.v ?? -1)));
      const avg = mean(items.map((i) => i.v));
      $('#rbars', pane).innerHTML = list.length
        ? hBars(items.map((i, idx) => ({ label: shortLabel(i.p), value: i.v, display: fmtMetric(key, i.v), color: idx === 0 ? PALETTE[2] : PALETTE[0] })), { percent: !!meta.ratio })
          + `<p class="small muted mt">Media ruolo: <b>${fmtMetric(key, avg)}</b>${meta.higherIsBetter === false ? ' · più basso è meglio' : ''}</p>`
        : `<p class="muted">Nessun ${r.toLowerCase()} con almeno ${min} minuti.</p>`;
      $('#rtable', pane).innerHTML = list.length ? `<table class="table"><thead><tr><th>Giocatore</th><th>Min</th>${keys.map((k) => `<th>${METRICS[k].short}</th>`).join('')}</tr></thead>
        <tbody>${list.map((p) => `<tr onclick="location.hash='#/giocatore/${p.id}'"><td>${esc(shortLabel(p))}</td><td>${Math.round(totals[p.id].minuti)}</td>${keys.map((k) => {
          const v = per90(totals[p.id], k, min);
          const vals = list.map((x) => per90(totals[x.id], k, min)).filter((x) => x != null);
          const best = METRICS[k].higherIsBetter === false ? Math.min(...vals) : Math.max(...vals);
          return `<td class="${v != null && v === best && vals.length > 1 ? 'best' : ''}">${fmtMetric(k, v)}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table><p class="small muted">Valori per 90 minuti (precisione in %). In verde il migliore del ruolo.</p>` : '';
    };
    $$('input[name=role]', pane).forEach((i) => (i.onchange = drawRole));
    $('#rm', pane).onchange = drawRole;
    $('#rmin', pane).onchange = drawRole;
    drawRole();
  }

  // ---- Tabella per 90 minuti ----
  let sortKey = 'minuti', sortDir = -1, minMin = 45;
  function per90Tab() {
    const keys = ['gol', 'assist', 'tiri', 'tiriPorta', 'passaggiOk', 'precisione', 'recuperi', 'perse', ...(hasTracking ? ['distanza', 'sprint'] : [])];
    const list = players.filter((p) => totals[p.id].minuti >= minMin);
    const val = (p, k) => (k === 'minuti' ? totals[p.id].minuti : k === 'nome' ? null : per90(totals[p.id], k, minMin));
    list.sort((a, b) => sortKey === 'nome' ? (a.lastName || '').localeCompare(b.lastName || '') * -sortDir : ((val(a, sortKey) ?? -1) - (val(b, sortKey) ?? -1)) * sortDir);
    pane.innerHTML = `
      <div class="row gap center mb"><span class="small muted grow">Statistiche normalizzate su 90 minuti. Tocca un'intestazione per ordinare.</span>
      <select id="pmin">${[1, 45, 90, 180].map((v) => `<option value="${v}" ${v === minMin ? 'selected' : ''}>${v === 1 ? 'tutti' : '≥' + v + '′'}</option>`).join('')}</select></div>
      <div class="table-wrap"><table class="table sticky"><thead><tr>
        <th data-s="nome">Giocatore</th><th data-s="minuti">Min</th>${keys.map((k) => `<th data-s="${k}">${METRICS[k].short}${sortKey === k ? (sortDir < 0 ? '↓' : '↑') : ''}</th>`).join('')}
      </tr></thead><tbody>${list.map((p) => `<tr onclick="location.hash='#/giocatore/${p.id}'"><td>${esc(shortLabel(p))}</td><td>${Math.round(totals[p.id].minuti)}</td>${keys.map((k) => `<td>${fmtMetric(k, val(p, k))}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="12" class="muted">Nessun giocatore con almeno ${minMin} minuti.</td></tr>`}</tbody></table></div>
      <p class="small muted">Legenda: ${keys.map((k) => `${METRICS[k].short} = ${METRICS[k].label}`).join(' · ')}</p>`;
    $('#pmin', pane).onchange = (e) => { minMin = Number(e.target.value); per90Tab(); };
    $$('[data-s]', pane).forEach((th) => (th.onclick = () => {
      if (sortKey === th.dataset.s) sortDir *= -1; else { sortKey = th.dataset.s; sortDir = -1; }
      per90Tab();
    }));
  }

  // ---- Confronto tra i tempi ----
  function tempi() {
    const maxP = Math.max(...rows.map((r) => r.match.periodsCount || 2));
    const keys = [['golFatti', 'Gol fatti'], ['golSubiti', 'Gol subiti'], ['tiri', 'Tiri'], ['tiriPorta', 'Tiri in porta'], ['passaggiOk', 'Passaggi riusciti'], ['precisione', 'Precisione pass.'], ['recuperi', 'Recuperi'], ['perse', 'Palle perse']];
    const avg = {};
    for (let i = 1; i <= maxP; i++) {
      const rs = rows.filter((r) => (r.match.periodsCount || 2) >= i);
      avg[i] = {};
      keys.forEach(([k]) => {
        if (k === 'precisione') {
          const ok = rs.reduce((a, r) => a + r.team[i].passaggiOk, 0), tot = rs.reduce((a, r) => a + r.team[i].passaggi, 0);
          avg[i][k] = tot ? ok / tot : null;
        } else avg[i][k] = rs.length ? rs.reduce((a, r) => a + r.team[i][k], 0) / rs.length : null;
      });
    }
    const insights = periodInsights(avg, maxP);
    pane.innerHTML = `
      <p class="small muted">Media a partita per ogni tempo, su ${rows.length} partite.</p>
      ${insights.length ? `<div class="list mb">${insights.map((t) => `<div class="item"><span class="trend ${t.good ? 'up' : 'down'}">${t.good ? '▲' : '▼'}</span><div class="grow small">${esc(t.text)}</div></div>`).join('')}</div>` : ''}
      <div class="card">${barChart({ groups: ['Gol fatti', 'Gol subiti', 'Tiri', 'Tiri porta'], series: Array.from({ length: maxP }, (_, i) => ({ name: PERIOD_NAMES[i], values: ['golFatti', 'golSubiti', 'tiri', 'tiriPorta'].map((k) => avg[i + 1][k]) })) })}</div>
      <div class="card">${barChart({ groups: ['Pass. riusciti', 'Recuperi', 'Perse'], series: Array.from({ length: maxP }, (_, i) => ({ name: PERIOD_NAMES[i], values: ['passaggiOk', 'recuperi', 'perse'].map((k) => avg[i + 1][k]) })) })}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Media</th>${Array.from({ length: maxP }, (_, i) => `<th>${i + 1}°T</th>`).join('')}</tr></thead>
      <tbody>${keys.map(([k, l]) => `<tr><td>${l}</td>${Array.from({ length: maxP }, (_, i) => `<td>${k === 'precisione' ? pct(avg[i + 1][k]) : num(avg[i + 1][k], 1)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  // ---- Tendenze ----
  function tendenze() {
    const alerts = detectTrends(rows, players);
    const team = detectTeamTrends(rows);
    const up = alerts.filter((a) => a.better), down = alerts.filter((a) => !a.better);
    const item = (a) => `<a class="item" href="#/giocatore/${a.player.id}"><span class="trend ${a.better ? 'up' : 'down'}">${a.better ? '▲' : '▼'}</span>
      <div class="grow"><strong>${esc(shortLabel(a.player))}</strong> · ${esc(a.label)}<div class="muted small">${esc(a.text)}</div></div><span class="chev">›</span></a>`;
    pane.innerHTML = `
      <p class="small muted">Confronto tra la media delle ultime 3 partite giocate e quella delle partite precedenti (servono almeno 4 presenze da 10′). Le statistiche di gioco sono normalizzate su 90′.</p>
      <h2 class="section">Squadra</h2>
      <div class="list">${team.map((t) => `<div class="item"><span class="trend ${t.better ? 'up' : 'down'}">${t.better ? '▲' : '▼'}</span><div class="grow">${esc(t.label)}<div class="muted small">${esc(t.text)}</div></div></div>`).join('')
        || `<div class="item muted">${rows.length < 4 ? 'Servono almeno 4 partite.' : 'Nessuna variazione significativa.'}</div>`}</div>
      <h2 class="section">📈 In miglioramento (${up.length})</h2>
      <div class="list">${up.map(item).join('') || '<div class="item muted">Nessuna segnalazione</div>'}</div>
      <h2 class="section">📉 In calo (${down.length})</h2>
      <div class="list">${down.map(item).join('') || '<div class="item muted">Nessuna segnalazione</div>'}</div>`;
  }

  draw();
}

function periodInsights(avg, maxP) {
  if (maxP < 2) return [];
  const out = [];
  const last = maxP, first = 1;
  const cmp = (k, label, higherBetter, minDiff) => {
    const a = avg[first][k], b = avg[last][k];
    if (a == null || b == null || Math.abs(b - a) < minDiff) return;
    const better = higherBetter ? b > a : b < a;
    const fa = k === 'precisione' ? pct(a) : num(a, 1), fb = k === 'precisione' ? pct(b) : num(b, 1);
    out.push({ good: better, text: `${label}: ${fa} nel 1° tempo, ${fb} nel ${last}° tempo.` });
  };
  cmp('golSubiti', 'Gol subiti', false, 0.4);
  cmp('golFatti', 'Gol fatti', true, 0.4);
  cmp('tiri', 'Tiri', true, 1.5);
  cmp('recuperi', 'Recuperi', true, 2);
  cmp('perse', 'Palle perse', false, 2);
  cmp('precisione', 'Precisione passaggi', true, 0.07);
  return out;
}

function mean(a) {
  const v = a.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

function shortLabel(p) {
  if (!p) return '?';
  return `${p.number ?? ''} ${p.lastName || p.firstName || fullName(p)}`.trim();
}

function fmtMetric(key, v) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (METRICS[key]?.ratio) return pct(v);
  if (key === 'distanza') return num(v);
  if (key === 'minuti') return num(v);
  return num(v, 2);
}
