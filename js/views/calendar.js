import * as db from '../db.js';
import { esc, fmtDate, today, $, $$ } from '../util.js';
import { setHeader, setCurrent } from '../app.js';
import { score } from '../stats.js';
import { PALETTE } from '../charts.js';

/** Calendario della società: le partite di tutte le squadre, divise per giorno. */
export async function calendarView(root) {
  setHeader({ title: 'Calendario', back: '#/partite' });
  const [teams, seasons, matches, events] = await Promise.all([db.all('teams'), db.all('seasons'), db.all('matches'), db.all('events')]);
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const color = Object.fromEntries([...teams].sort((a, b) => a.name.localeCompare(b.name)).map((t, i) => [t.id, PALETTE[i % PALETTE.length]]));
  const evByMatch = {};
  events.forEach((e) => (evByMatch[e.matchId] = evByMatch[e.matchId] || []).push(e));
  // solo la stagione più recente di ogni squadra
  const latest = {};
  seasons.forEach((s) => { if (!latest[s.teamId] || s.name > latest[s.teamId].name) latest[s.teamId] = s; });
  const current = matches.filter((m) => latest[m.teamId] && m.seasonId === latest[m.teamId].id && teamById[m.teamId]);

  let filter = sessionStorage.getItem('calFilter') || 'prossime';
  let teamSel = JSON.parse(sessionStorage.getItem('calTeams') || 'null');
  const teamsWithMatches = teams.filter((t) => current.some((m) => m.teamId === t.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (!teamSel) teamSel = teamsWithMatches.map((t) => t.id);

  root.innerHTML = `
    <div class="seg">${[['prossime', 'Prossime'], ['giocate', 'Giocate'], ['tutte', 'Tutte']].map(([k, l]) =>
      `<label><input type="radio" name="cf" value="${k}" ${k === filter ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <div class="chips mb">${teamsWithMatches.map((t) => `<button class="chip-btn ${teamSel.includes(t.id) ? 'on' : ''}" data-t="${t.id}" style="${teamSel.includes(t.id) ? `background:${color[t.id]};border-color:${color[t.id]}` : ''}">${esc(t.name)}</button>`).join('')}</div>
    <div id="cal"></div>`;

  const draw = () => {
    const td = today();
    let list = current.filter((m) => teamSel.includes(m.teamId));
    if (filter === 'prossime') list = list.filter((m) => (m.date || '') >= td && m.status !== 'finita');
    if (filter === 'giocate') list = list.filter((m) => m.status === 'finita' || (m.date || '') < td);
    list.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')) * (filter === 'giocate' ? -1 : 1));
    const days = [];
    list.forEach((m) => {
      const last = days[days.length - 1];
      if (last && last.date === m.date) last.items.push(m); else days.push({ date: m.date, items: [m] });
    });
    $('#cal', root).innerHTML = days.length ? days.map((d) => `
      <h2 class="section">${esc(fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${d.date === td ? ' · oggi' : ''}</h2>
      <div class="list">${d.items.map((m) => {
        const t = teamById[m.teamId];
        const ev = evByMatch[m.id] || [];
        const s = score(ev);
        const played = m.status === 'finita' || ev.length;
        const res = played ? (m.home === false ? `${s.subiti} – ${s.fatti}` : `${s.fatti} – ${s.subiti}`) : '';
        const out = m.status === 'finita' ? (s.fatti > s.subiti ? 'win' : s.fatti === s.subiti ? 'draw' : 'loss') : '';
        return `<button class="item" data-m="${m.id}">
          <span class="team-bar" style="background:${color[m.teamId]}"></span>
          <div class="cal-time">${esc(m.time || '')}</div>
          <div class="grow"><div class="small" style="color:${color[m.teamId]};font-weight:700">${esc(t.name)}</div>
            <strong>${m.home === false ? esc(m.opponent) + ' – Palazzo' : 'Palazzo – ' + esc(m.opponent)}</strong>
            <div class="muted small">${m.moved && m.status !== 'finita' ? '<b class="warn">🔄 spostata</b> · ' : ''}${m.home === false ? 'trasferta' : 'in casa'}${m.round ? ' · ' + esc(m.round) : ''}${m.place ? ' · ' + esc(m.place) : ''}</div></div>
          ${res ? `<span class="score ${out}">${res}</span>` : m.status === 'in corso' ? '<span class="badge live">LIVE</span>' : ''}
        </button>`;
      }).join('')}</div>`).join('')
      : `<div class="empty"><div class="empty-icon">📆</div><p>${filter === 'prossime' ? 'Nessuna partita in programma.' : 'Nessuna partita.'}</p><p class="small">I calendari si importano da Altro → Importa rose o calendario.</p></div>`;
    $$('[data-m]', root).forEach((b) => (b.onclick = async () => {
      const m = current.find((x) => x.id === b.dataset.m);
      await setCurrent(m.teamId, m.seasonId);
      location.hash = `#/partita/${m.id}`;
    }));
  };

  $$('input[name=cf]', root).forEach((i) => (i.onchange = () => { filter = i.value; sessionStorage.setItem('calFilter', filter); draw(); }));
  $$('[data-t]', root).forEach((b) => (b.onclick = () => {
    const id = b.dataset.t;
    teamSel = teamSel.includes(id) ? teamSel.filter((x) => x !== id) : [...teamSel, id];
    sessionStorage.setItem('calTeams', JSON.stringify(teamSel));
    const on = teamSel.includes(id);
    b.classList.toggle('on', on);
    b.style.background = on ? color[id] : '';
    b.style.borderColor = on ? color[id] : '';
    draw();
  }));
  draw();
}
