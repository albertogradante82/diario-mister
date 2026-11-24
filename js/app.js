import * as db from './db.js';
import './install.js';
import './admin.js';
import * as sync from './sync.js';
import { fillPhotos } from './profiles.js';
import { esc, $, toast, pick } from './util.js';
import { matchesView, matchEditView, matchView, liveView } from './views/matches.js';
import { rosterView, playerView, playerEditView } from './views/players.js';
import { analysisView } from './views/analysis.js';
import { calendarView } from './views/calendar.js';
import { homeView } from './views/home.js';
import { playerBoardView, misterBoardView, updateBadge } from './views/board.js';
import { misterConvView, playerConvView } from './views/convocazioni.js';
import { videoListView } from './views/video.js';
import { staffView, playerStaffView } from './views/staff.js';
import { parentAreaView, misterParentsView } from './views/parents.js';
import { playerDocsView, misterDocsView } from './views/docs.js';
import { playerPaymentsView, misterPaymentsView } from './views/payments.js';
import { reportView, playerReportsView } from './views/report.js';
import { playerCalendarView, playerRosterView, playerScorersView, playerProfileView, playerProfileEditView, playerMoreView } from './views/player.js';
import { roleChoiceView, autoUpdateClubData } from './views/more.js';
import { getRole, logout } from './roles.js';
import { confirmDialog } from './util.js';
import { moreView, teamEditView, onboardingView } from './views/more.js';

// ---------- Stato globale (squadra e stagione selezionate) ----------

export const state = { teamId: null, seasonId: null };

export async function loadCurrent() {
  const cur = await db.getMeta('current', {});
  const teams = await db.all('teams');
  let team = teams.find((t) => t.id === cur.teamId) || teams[0] || null;
  let season = null;
  if (team) {
    const seasons = await db.where('seasons', 'teamId', team.id);
    season = seasons.find((s) => s.id === cur.seasonId) || seasons.sort((a, b) => b.name.localeCompare(a.name))[0] || null;
  }
  state.teamId = team?.id || null;
  state.seasonId = season?.id || null;
  return { team, season, teams };
}

export async function setCurrent(teamId, seasonId) {
  state.teamId = teamId;
  state.seasonId = seasonId;
  await db.setMeta('current', { teamId, seasonId });
}

/** Carica tutti i dati della stagione corrente. */
export async function loadSeason(seasonId = state.seasonId) {
  const season = await db.get('seasons', seasonId);
  const team = season ? await db.get('teams', season.teamId) : null;
  const players = (await db.where('players', 'seasonId', seasonId)).sort(byNumber);
  const matches = (await db.where('matches', 'seasonId', seasonId)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const ids = new Set(matches.map((m) => m.id));
  const eventsByMatch = {}, trackingByMatch = {};
  (await db.all('events')).forEach((e) => { if (ids.has(e.matchId)) (eventsByMatch[e.matchId] = eventsByMatch[e.matchId] || []).push(e); });
  (await db.all('tracking')).forEach((t) => { if (ids.has(t.matchId)) (trackingByMatch[t.matchId] = trackingByMatch[t.matchId] || []).push(t); });
  return { team, season, players, matches, eventsByMatch, trackingByMatch };
}

export function byNumber(a, b) {
  const na = a.number === '' || a.number == null ? 999 : Number(a.number);
  const nb = b.number === '' || b.number == null ? 999 : Number(b.number);
  return na - nb || (a.lastName || '').localeCompare(b.lastName || '');
}

// ---------- Header ----------

export function setHeader({ title = '', back = null, actions = '' } = {}) {
  $('#hdr-title').textContent = title;
  const b = $('#hdr-back');
  b.hidden = !back;
  b.onclick = back ? () => (back === true ? history.back() : (location.hash = back)) : null;
  $('#hdr-actions').innerHTML = actions;
}

async function renderContext() {
  const { team, season } = await loadCurrent();
  const el = $('#ctx');
  el.innerHTML = team
    ? `<button class="ctx-btn" id="ctx-team">${esc(team.name)} ▾</button><button class="ctx-btn" id="ctx-season">${esc(season ? season.name : 'Nessuna stagione')} ▾</button>`
    : '';
  if (!team) return;
  $('#ctx-team').onclick = async () => {
    const teams = await db.all('teams');
    const id = await pick('Squadra', [...teams.map((t) => ({ value: t.id, label: t.name, sub: t.category })), { value: '__new', label: '+ Nuova squadra' }]);
    if (!id) return;
    if (id === '__new') { location.hash = '#/squadra/nuova'; return; }
    const seasons = (await db.where('seasons', 'teamId', id)).sort((a, b) => b.name.localeCompare(a.name));
    await setCurrent(id, seasons[0]?.id || null);
    route();
  };
  $('#ctx-season').onclick = async () => {
    const seasons = (await db.where('seasons', 'teamId', team.id)).sort((a, b) => b.name.localeCompare(a.name));
    const id = await pick('Stagione', [...seasons.map((s) => ({ value: s.id, label: s.name })), { value: '__new', label: '+ Nuova stagione' }]);
    if (!id) return;
    if (id === '__new') { location.hash = `#/squadra/${team.id}`; return; }
    await setCurrent(team.id, id);
    route();
  };
}

// ---------- Router ----------

const routes = [
  [/^#\/home$/, homeView, 'home'],
  [/^#\/partite$/, matchesView, 'partite'],
  [/^#\/calendario$/, calendarView, 'partite'],
  [/^#\/bacheca$/, misterBoardView, 'home'],
  [/^#\/convocazioni$/, misterConvView('partita'), 'home'],
  [/^#\/allenamenti$/, misterConvView('allenamento'), 'home'],
  [/^#\/video$/, videoListView, 'home'],
  [/^#\/staff$/, staffView, 'home'],
  [/^#\/genitori$/, misterParentsView, 'home'],
  [/^#\/tabellino\/([^/]+)$/, reportView(true), 'home'],
  [/^#\/documenti$/, misterDocsView, 'home'],
  [/^#\/pagamenti$/, misterPaymentsView, 'home'],
  [/^#\/partita\/nuova$/, (r) => matchEditView(r, null), 'partite'],
  [/^#\/partita\/([^/]+)\/modifica$/, (r, id) => matchEditView(r, id), 'partite'],
  [/^#\/partita\/([^/]+)\/live$/, liveView, 'partite'],
  [/^#\/partita\/([^/]+)$/, matchView, 'partite'],
  [/^#\/rosa$/, rosterView, 'rosa'],
  [/^#\/giocatore\/nuovo$/, (r) => playerEditView(r, null), 'rosa'],
  [/^#\/giocatore\/([^/]+)\/modifica$/, (r, id) => playerEditView(r, id), 'rosa'],
  [/^#\/giocatore\/([^/]+)$/, playerView, 'rosa'],
  [/^#\/analisi$/, analysisView, 'analisi'],
  [/^#\/altro$/, moreView, 'altro'],
  [/^#\/squadra\/nuova$/, (r) => teamEditView(r, null), 'altro'],
  [/^#\/squadra\/([^/]+)$/, (r, id) => teamEditView(r, id), 'altro'],
];

function getRoleSync() {
  try { return localStorage.getItem('mister-role'); } catch { return null; }
}

const playerRoutes = [
  [/^#\/g\/bacheca$/, playerBoardView, 'g-bacheca'],
  [/^#\/g\/convocazioni$/, playerConvView('partita'), 'g-conv'],
  [/^#\/g\/allenamenti$/, playerConvView('allenamento'), 'g-all'],
  [/^#\/g\/altro$/, playerMoreView, 'g-altro'],
  [/^#\/g\/calendario$/, playerCalendarView, 'g-cal'],
  [/^#\/g\/staff$/, playerStaffView, 'g-altro'],
  [/^#\/g\/genitore$/, parentAreaView, 'g-altro'],
  [/^#\/g\/tabellini$/, playerReportsView, 'g-conv'],
  [/^#\/g\/tabellino\/([^/]+)$/, reportView(false), 'g-conv'],
  [/^#\/g\/documenti$/, playerDocsView, 'g-altro'],
  [/^#\/g\/pagamenti$/, playerPaymentsView, 'g-altro'],
  [/^#\/g\/rose$/, playerRosterView, 'g-altro'],
  [/^#\/g\/marcatori$/, playerScorersView, 'g-altro'],
  [/^#\/g\/giocatore\/([^/]+)\/modifica$/, playerProfileEditView, 'g-altro'],
  [/^#\/g\/giocatore\/([^/]+)$/, playerProfileView, 'g-altro'],
];

const TABS = {
  mister: [['#/home', 'home', '🏠', 'Home'], ['#/partite', 'partite', '📅', 'Partite'], ['#/rosa', 'rosa', '👥', 'Rosa'], ['#/analisi', 'analisi', '📊', 'Analisi'], ['#/altro', 'altro', '⚙️', 'Altro']],
  giocatore: [['#/g/bacheca', 'g-bacheca', '📣', 'Bacheca'], ['#/g/convocazioni', 'g-conv', '⚽', 'Convocazioni'], ['#/g/allenamenti', 'g-all', '🏃', 'Allenamenti'], ['#/g/calendario', 'g-cal', '📅', 'Calendario'], ['#/g/altro', 'g-altro', '☰', 'Altro']],
};
let tabsFor = null;
function renderTabbar(role) {
  const nav = document.querySelector('.tabbar');
  document.body.classList.toggle('no-tabs', !role);
  if (!role || tabsFor === role) return;
  tabsFor = role;
  nav.innerHTML = TABS[role].map(([href, tab, icon, label]) => `<a href="${href}" data-tab="${tab}"><span>${icon}</span>${label}</a>`).join('');
}

let cleanup = null;
let navToken = 0;

/**
 * Ogni vista viene disegnata in un contenitore nuovo, che sostituisce quello visibile
 * solo se nel frattempo non è partita un'altra navigazione (evita sovrapposizioni).
 */
export async function route() {
  const my = ++navToken;
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  const view = $('#view');
  const hash = location.hash || '#/home';
  const { team, season } = await loadCurrent();
  if (my !== navToken) return;
  document.body.classList.toggle('live-mode', /\/live$/.test(hash));

  const run = async (fn, args, tab) => {
    const box = document.createElement('div');
    let clean = null;
    try {
      clean = (await fn(box, ...args)) || null;
    } catch (e) {
      console.error(e);
      box.innerHTML = `<div class="card"><p>Si è verificato un errore: ${esc(e.message)}</p></div>`;
    }
    if (my !== navToken) { if (clean) try { clean(); } catch { /* */ } return; }
    setTab(tab);
    view.replaceChildren(box);
    fillPhotos(box).catch(() => {});
    window.scrollTo(0, 0);
    cleanup = clean;
  };

  // ---- Scelta dell'accesso / area giocatori ----
  const role = await getRole();
  if (my !== navToken) return;
  renderTabbar(role);
  if (!role) {
    setHeader({ title: 'Benvenuto' });
    $('#ctx').innerHTML = '';
    await run(roleChoiceView, [], null);
    return;
  }
  if (role === 'giocatore') {
    $('#ctx').innerHTML = '';
    if (hash === '#/g/esci') {
      if (await confirmDialog('Uscire dall\'area giocatori?', 'Esci')) logout();
      location.replace(role && getRoleSync() === 'giocatore' ? '#/g/bacheca' : '#/home');
      route();
      return;
    }
    for (const [re, fn, tab] of playerRoutes) {
      const mm = hash.match(re);
      if (mm) { await run(fn, mm.slice(1).map(decodeURIComponent), tab); updateBadge(); return; }
    }
    location.replace('#/g/bacheca');
    return;
  }

  // Nessuna squadra ancora: la Home mostra le scelte per iniziare; Altro e Calendario restano usabili
  if ((!team || !season) && !/^#\/(squadra\/|altro$|calendario$)/.test(hash)) {
    const tab = (hash.match(/^#\/(home|partite|rosa|analisi)/) || [])[1] || 'home';
    setHeader({ title: tab === 'home' ? 'Home' : 'Benvenuto' });
    $('#ctx').innerHTML = '';
    await run(onboardingView, [team, tab], tab);
    return;
  }
  await renderContext();
  if (my !== navToken) return;
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (m) {
      await run(fn, m.slice(1).map(decodeURIComponent), tab);
      return;
    }
  }
  location.replace('#/home');
}

function setTab(tab) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
}

// ---------- Avvio ----------

export const APP_VERSION = '1.28.0';
let swReg = null;

/** Controlla subito se c'è una versione nuova dell'app; restituisce true se è stata trovata. */
export async function checkForUpdate() {
  if (!swReg) return false;
  await swReg.update();
  const nw = swReg.installing || swReg.waiting;
  if (!nw) return false;
  await new Promise((res) => {
    if (nw.state === 'activated') return res();
    nw.addEventListener('statechange', () => { if (nw.state === 'activated') res(); });
    setTimeout(res, 8000);
  });
  location.reload();
  return true;
}

window.addEventListener('hashchange', route);
function syncIndicator(st) {
  const el = $('#sync-ind');
  if (!el) return;
  el.hidden = st.state === 'off';
  const map = {
    ok: ['☁︎', 'Sincronizzato', 'ok'],
    syncing: ['↻', 'Sincronizzazione…', 'busy'],
    offline: ['☁︎', 'Offline: le modifiche verranno inviate appena torna la rete', 'off'],
    error: ['!', 'Errore di sincronizzazione', 'err'],
  };
  const [icon, title, cls] = map[st.state] || map.ok;
  el.className = `sync-ind ${cls}`;
  el.textContent = st.pending && st.state !== 'syncing' ? `${icon} ${st.pending}` : icon;
  el.title = st.error ? `${title}: ${st.error}` : title;
}

window.addEventListener('DOMContentLoaded', async () => {
  sync.onStatus(syncIndicator);
  sync.onRemoteData(() => {
    // aggiorna la schermata con i dati degli altri mister, ma non durante modifica o live
    if (/\/(modifica|nuovo|nuova|live)$/.test(location.hash) || document.querySelector('.sheet-back')) return;
    route();
    toast('Dati aggiornati dall\'archivio condiviso');
  });
  route();
  sync.start();
  // il mister riceve da solo i dati aggiornati della società
  const checkClub = async () => {
    if ((await getRole()) !== 'mister') return;
    await autoUpdateClubData().catch(() => {});
    const n = await import('./calmods.js').then((c) => c.applyModsToDb()).catch(() => 0);
    if (n && !/\/(modifica|nuovo|nuova|live)$/.test(location.hash) && !document.querySelector('.sheet-back')) route();
  };
  setTimeout(checkClub, 1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkClub(); });
  db.requestPersistence();
  if ('serviceWorker' in navigator) {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      swReg = reg;
      // quando una versione nuova prende il controllo, ricarica (ma non durante il live o una modifica)
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        if (/\/(live|modifica|nuovo|nuova)$/.test(location.hash)) {
          toast('Nuova versione pronta: verrà usata alla prossima apertura.', 4000);
          return;
        }
        reloading = true;
        location.reload();
      });
      // controlla gli aggiornamenti all'avvio e ogni volta che l'app torna in primo piano
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (e) { console.warn('Service worker non registrato', e); }
  }
});
