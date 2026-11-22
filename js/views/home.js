import * as db from '../db.js';
import { esc, fmtDate, today, fullName, avatar } from '../util.js';
import { setHeader, loadSeason, setCurrent } from '../app.js';
import { loadClubData } from './more.js';
import { listNotices } from './board.js';
import { editConvocation } from './convocazioni.js';
import { seasonData, seasonTotals, detectTrends } from '../stats.js';

/** Home: riepilogo della squadra selezionata e della società. */
export async function homeView(root) {
  setHeader({ title: 'Home' });
  const ctx = await loadSeason();
  const td = today();
  const rows = seasonData(ctx);
  const played = rows.filter((r) => r.match.status === 'finita');
  const res = { v: 0, n: 0, p: 0, gf: 0, gs: 0 };
  played.forEach((r) => {
    res[r.score.fatti > r.score.subiti ? 'v' : r.score.fatti === r.score.subiti ? 'n' : 'p']++;
    res.gf += r.score.fatti;
    res.gs += r.score.subiti;
  });
  const upcoming = ctx.matches.filter((m) => m.status !== 'finita' && (m.date || '') >= td).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const live = ctx.matches.find((m) => m.status === 'in corso');
  const next = live || upcoming[0];
  const last = [...played].reverse().slice(0, 3);
  const scorers = ctx.players.map((p) => ({ p, t: seasonTotals(rows, p.id) })).filter((x) => x.t.gol > 0).sort((a, b) => b.t.gol - a.t.gol || b.t.assist - a.t.assist).slice(0, 5);
  const trends = detectTrends(rows, ctx.players).slice(0, 4);
  const tc = ctx.team?.tcStats || null;
  const soon = new Date(); soon.setDate(soon.getDate() + 30);
  const medical = ctx.players.filter((p) => p.medicalExpiry && p.medicalExpiry <= soon.toISOString().slice(0, 10));
  const lastBackup = await db.getMeta('lastBackup');
  const backupOld = !lastBackup || Date.now() - lastBackup > 14 * 864e5;

  // prossime partite di tutte le squadre (stagione più recente di ciascuna)
  const [teams, seasons, allMatches] = await Promise.all([db.all('teams'), db.all('seasons'), db.all('matches')]);
  const latest = {};
  seasons.forEach((s) => { if (!latest[s.teamId] || s.name > latest[s.teamId].name) latest[s.teamId] = s; });
  const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const clubNext = allMatches
    .filter((m) => latest[m.teamId] && m.seasonId === latest[m.teamId].id && m.status !== 'finita' && (m.date || '') >= td)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .slice(0, 6);

  const vsLabel = (m) => (m.home === false ? `${esc(m.opponent)} – Palazzo` : `Palazzo – ${esc(m.opponent)}`);
  const daysTo = (d) => {
    const n = Math.round((new Date(d + 'T12:00:00') - new Date(td + 'T12:00:00')) / 864e5);
    return n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`;
  };

  let notices = [];
  try { notices = (await listNotices()).slice(0, 2); } catch { /* bacheca non attiva */ }
  const updBanner = sessionStorage.getItem('clubUpdate') ? `<button class="choice choice-main" id="clubupd"><span class="choice-icon">🔄</span><span><strong>Nuovi risultati e classifiche disponibili</strong><small>Tocca per aggiornare i dati del Calcio Palazzo.</small></span></button>` : '';
  root.innerHTML = `${updBanner}
    ${next ? `
    <div class="card next-match ${live ? 'is-live' : ''}">
      <div class="small muted">${live ? '<span class="badge live">LIVE</span>' : `Prossima partita · <strong>${daysTo(next.date)}</strong>`}</div>
      <div class="nm-title">${vsLabel(next)}</div>
      <div class="small muted">${esc(fmtDate(next.date, { weekday: 'long', day: 'numeric', month: 'long' }))}${next.time ? ' · ore ' + esc(next.time) : ''} · ${next.home === false ? 'trasferta' : 'in casa'}${next.round ? ' · ' + esc(next.round) : ''}</div>
      <div class="row gap mt">
        <a class="btn primary grow" href="#/partita/${next.id}/live">${live ? '▶ Continua live' : '▶ Avvia live'}</a>
        <button class="btn grow" id="convnext">📋 Convoca</button>
      </div>
    </div>` : `
    <div class="card"><p class="muted">Nessuna partita in programma per ${esc(ctx.team?.name || 'questa squadra')}.</p>
      <a class="btn block" href="#/partita/nuova">+ Nuova partita</a></div>`}

    <div class="tiles">
      <a class="tile" href="#/partite"><div class="tile-v"><span class="win">${res.v}</span>-<span class="draw">${res.n}</span>-<span class="loss">${res.p}</span></div><div class="tile-l">V-N-P</div></a>
      <a class="tile" href="#/partite"><div class="tile-v">${res.gf}:${res.gs}</div><div class="tile-l">Gol fatti:subiti</div></a>
      <a class="tile" href="#/rosa"><div class="tile-v">${ctx.players.length}</div><div class="tile-l">Giocatori</div></a>
    </div>

    ${medical.length || backupOld ? `<div class="card warn-card small">
      ${medical.length ? `<div>🩺 Visita medica in scadenza o scaduta: ${medical.map((p) => `<a href="#/giocatore/${p.id}">${esc(fullName(p))}</a>`).join(', ')}</div>` : ''}
      ${backupOld ? `<div${medical.length ? ' class="mt"' : ''}>💾 ${lastBackup ? 'Ultimo backup più di 2 settimane fa.' : 'Non hai ancora fatto un backup.'} <a href="#/altro">Fallo ora</a></div>` : ''}
    </div>` : ''}

    ${last.length ? `<h2 class="section">Ultimi risultati</h2>
    <div class="list">${last.map((r) => {
      const s = r.score, m = r.match;
      const out = s.fatti > s.subiti ? 'win' : s.fatti === s.subiti ? 'draw' : 'loss';
      return `<a class="item" href="#/partita/${m.id}"><div class="grow"><strong>${esc(m.opponent)}</strong> <span class="muted small">${m.home === false ? 'trasferta' : 'in casa'}</span><div class="muted small">${esc(fmtDate(m.date))}</div></div>
        <span class="score ${out}">${m.home === false ? `${s.subiti} – ${s.fatti}` : `${s.fatti} – ${s.subiti}`}</span></a>`;
    }).join('')}</div>` : ''}

    ${tc ? standingsCard(tc) : ''}

    ${scorers.length ? `<h2 class="section">Marcatori</h2>
    <div class="list">${scorers.map(({ p, t }, i) => `<a class="item" href="#/giocatore/${p.id}"><span class="rank">${i + 1}</span>${avatar(p, 34)}
      <div class="grow">${esc(fullName(p))}</div><strong>${t.gol}</strong><span class="muted small">gol${t.assist ? ` · ${t.assist} ast` : ''}</span></a>`).join('')}</div>`
    : tc && tc.marcatori?.length ? `<h2 class="section">Marcatori <span class="muted">· Tuttocampo</span></h2>
    <div class="list">${tc.marcatori.filter((m) => m.gol > 0).map((m, i) => {
      const p = ctx.players.find((x) => x.id === m.playerId);
      return `<a class="item" ${p ? `href="#/giocatore/${p.id}"` : ''}><span class="rank">${i + 1}</span>${p ? avatar(p, 34) : ''}
        <div class="grow">${esc(p ? fullName(p) : m.name)}</div><strong>${m.gol}</strong><span class="muted small">gol${m.rigori ? ` (${m.rigori} rig.)` : ''}${m.assist ? ` · ${m.assist} ast` : ''}</span></a>`;
    }).join('')}</div>` : ''}

    ${trends.length ? `<h2 class="section">Tendenze</h2>
    <div class="list">${trends.map((a) => `<a class="item" href="#/giocatore/${a.player.id}"><span class="trend ${a.better ? 'up' : 'down'}">${a.better ? '▲' : '▼'}</span>
      <div class="grow"><strong>${esc(fullName(a.player))}</strong> · ${esc(a.label)}<div class="muted small">${esc(a.text)}</div></div></a>`).join('')}
      <a class="item accent small" href="#/analisi">Tutte le analisi ›</a></div>` : ''}

    ${clubNext.length ? `<h2 class="section">Prossime partite della società</h2>
    <div class="list">${clubNext.map((m) => `<button class="item" data-m="${m.id}">
      <div class="date-box"><b>${esc(fmtDate(m.date, { day: '2-digit' }))}</b><small>${esc(fmtDate(m.date, { month: 'short' }))}</small></div>
      <div class="grow"><div class="small accent">${esc(teamName[m.teamId] || '')}</div><strong>${vsLabel(m)}</strong><div class="muted small">${m.time ? 'ore ' + esc(m.time) : ''}</div></div></button>`).join('')}
      <a class="item accent small" href="#/calendario">Calendario completo ›</a></div>` : ''}

    <h2 class="section">Bacheca</h2>
    <div class="list">${notices.map((n) => `<a class="item" href="#/bacheca"><span style="font-size:22px">${{ comunicazione: '📢', allenamento: '🏃', evento: '🎉', partita: '⚽' }[n.kind] || '📢'}</span>
      <div class="grow"><strong>${esc(n.title)}</strong><div class="muted small">${n.date ? esc(fmtDate(n.date)) + (n.time ? ' · ' + esc(n.time) : '') : esc(new Date(n.createdAt).toLocaleDateString('it-IT'))}</div></div><span class="chev">›</span></a>`).join('')}
      <a class="item accent small" href="#/bacheca">${notices.length ? 'Tutti gli avvisi e chi li ha visti ›' : '📣 Pubblica il primo avviso ›'}</a></div>

    <h2 class="section">Azioni rapide</h2>
    <div class="quick">
      <a class="quick-btn" href="#/convocazioni"><span>⚽</span>Convocazioni partita</a>
      <a class="quick-btn" href="#/allenamenti"><span>🏃</span>Presenze allenamenti</a>
      <a class="quick-btn" href="#/bacheca"><span>📣</span>Bacheca</a>
      <a class="quick-btn" href="#/partita/nuova"><span>➕</span>Nuova partita</a>
      <a class="quick-btn" href="#/giocatore/nuovo"><span>👤</span>Nuovo giocatore</a>
      <a class="quick-btn" href="#/calendario"><span>📆</span>Calendario</a>
      <a class="quick-btn" href="#/analisi" onclick="sessionStorage.setItem('anTab','giovanili')"><span>🏆</span>Classifica giovanili</a>
      <a class="quick-btn" href="#/altro"><span>📂</span>Importa / backup</a>
    </div>`;

  const cn = root.querySelector('#convnext');
  if (cn) cn.onclick = () => editConvocation(null, { code: null, match: next, kind: 'partita' });
  const ub = root.querySelector('#clubupd');
  if (ub) ub.onclick = loadClubData;
  root.querySelectorAll('[data-m]').forEach((b) => (b.onclick = async () => {
    const m = allMatches.find((x) => x.id === b.dataset.m);
    await setCurrent(m.teamId, m.seasonId);
    location.hash = `#/partita/${m.id}`;
  }));
}

/** Classifica del campionato (dati Tuttocampo), con il Palazzo evidenziato. */
export function standingsCard(tc) {
  const rows = tc.classifica || [];
  if (!rows.length) return '';
  return `<h2 class="section">Classifica <span class="muted">· ${esc(tc.campionato || '')}</span></h2>
    <div class="table-wrap"><table class="table standings">
      <thead><tr><th>#</th><th>Squadra</th><th>PT</th><th>G</th><th>V</th><th>N</th><th>P</th><th>DR</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${/palazzo/i.test(r.squadra) ? 'us' : ''} ${r.zona ? 'zona-' + r.zona : ''}"><td>${r.pos}</td><td>${esc(r.squadra)}</td><td><b>${r.pt}</b></td><td>${r.g}</td><td>${r.v}</td><td>${r.n}</td><td>${r.p}</td><td>${r.dr > 0 ? '+' : ''}${r.dr}</td></tr>`).join('')}</tbody>
    </table></div>
    ${tc.legenda ? `<p class="small">${Object.entries(tc.legenda).map(([k, v]) => `<span class="zona-dot zona-${k}"></span> ${esc(v)}`).join(' &nbsp; ')}</p>` : ''}
    <p class="small muted">Fonte: ${esc(tc.fonte || 'Tuttocampo')}, aggiornata al ${esc(fmtDate(tc.aggiornato))}${tc.classificaCompleta === false ? ' · classifica parziale' : ''}.</p>
    ${evidenzaCard(tc)}`;
}

export function evidenzaCard(tc) {
  if (!tc || !tc.evidenza || !tc.evidenza.length) return '';
  return `<h2 class="section">In evidenza</h2><div class="list">${tc.evidenza.map((t) => `<div class="item small">🔥 ${esc(t)}</div>`).join('')}</div>`;
}
