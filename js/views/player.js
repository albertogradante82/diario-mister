// Accesso giocatori/genitori: sola lettura, dati pubblici (dati/pubblico.json).
import { esc, fmtDate, today, toast, resizeImage, age, $ } from '../util.js';
import { listProfiles, getPhoto, saveProfile, myPrivate, fillPhotos } from '../profiles.js';
import { sheet } from '../util.js';
import { exportPublicPlayerPdf } from '../pdf.js';
import { buildLeaderboard, renderLeaderboard } from './leaderboard.js';
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
  let sel = sessionStorage.getItem('pTeam') || (all ? 'tutte' : teams[0]?.id);
  if (sel === 'giovanili') sel = all ? 'tutte' : teams[0]?.id;
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
  const profs = await listProfiles();
  await withData(root, (d) => {
    const color = teamColors(d.teams);
    const draw = () => {
      let pick = teamPicker(d.teams, color);
      if (!d.teams.some((t) => t.id === pick.sel)) { sessionStorage.setItem('pTeam', d.teams[0]?.id); pick = teamPicker(d.teams, color); }
      const list = d.players.filter((p) => p.teamId === pick.sel);
      const groups = ROLE_ORDER.map((r) => [r || 'Altri', list.filter((p) => (p.role || '') === r)]).filter(([, l]) => l.length);
      root.innerHTML = `${pick.html}
        ${groups.map(([role, l]) => `<h2 class="section">${esc(role)} <span class="muted">(${l.length})</span></h2>
          <div class="roster-grid">${l.sort((a, b) => (Number(a.number) || 99) - (Number(b.number) || 99) || a.name.localeCompare(b.name)).map((p) =>
            `<a class="roster-card" href="#/g/giocatore/${p.id}"><div class="roster-photo" data-ph="${p.id}">${esc(p.number === '' ? p.name.split(' ').map((w) => w[0]).join('').slice(0, 2) : p.number)}</div>
              ${p.number !== '' ? `<span class="roster-num">${esc(p.number)}</span>` : ''}${profs[p.id] ? '<span class="roster-ok">✓</span>' : ''}
              <div class="roster-name">${esc(p.name)}</div></a>`).join('')}</div>`).join('')
          || '<div class="empty"><p>Rosa non disponibile.</p></div>'}
        <p class="small muted mt">Tocca il tuo nome per vedere la tua scheda e completarla (foto, data di nascita, contatti). ✅ = scheda compilata.</p>`;
      bindPicker(root, draw);
      root.querySelectorAll('[data-ph]').forEach(async (el) => {
        if (!profs[el.dataset.ph]?.hasPhoto) return;
        const ph = await getPhoto(el.dataset.ph);
        if (ph) el.innerHTML = `<img src="${ph}" alt="">`;
      });
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
      if (sessionStorage.getItem('pTeam') === 'giovanili') {
        const pick = teamPicker(d.teams, color);
        root.innerHTML = `<div class="chips mb"><button class="chip-btn on lb-chip" data-pt="giovanili">🏆 Tutte le giovanili</button>${pick.html.replace('<div class="chips mb">', '').replace(/<\/div>$/, '').replace(/chip-btn on/g, 'chip-btn').replace(/ style="[^"]*"/g, '')}</div><div id="lb"></div>`;
        bindPicker(root, draw);
        const upd = d.teams.map((t) => t.stats?.aggiornato).filter(Boolean).sort().pop();
        renderLeaderboard(root.querySelector('#lb'), buildLeaderboard(d.teams), { link: (id) => `#/g/giocatore/${id}`, updated: upd ? fmtDate(upd) : '' });
        return;
      }
      let pick = teamPicker(d.teams, color);
      if (!d.teams.some((t) => t.id === pick.sel)) { sessionStorage.setItem('pTeam', d.teams[0]?.id); pick = teamPicker(d.teams, color); }
      const team = d.teams.find((t) => t.id === pick.sel);
      const st = team?.stats;
      // marcatori: dati ufficiali se presenti, altrimenti dai tabellini registrati
      let scorers = (st?.marcatori || []).filter((m) => m.gol > 0).map((m) => ({ id: m.playerId, name: m.name, gol: m.gol, rig: m.rigori, ast: m.assist }));
      if (!scorers.length) {
        const count = {};
        d.matches.filter((m) => m.teamId === pick.sel).forEach((m) => (m.scorers || []).forEach((n) => { if (n) count[n] = (count[n] || 0) + 1; }));
        scorers = Object.entries(count).map(([name, gol]) => ({ name, gol }));
      }
      scorers.sort((a, b) => b.gol - a.gol || a.name.localeCompare(b.name));
      const assists = (st?.marcatori || []).filter((m) => m.assist > 0).sort((a, b) => b.assist - a.assist);
      root.innerHTML = `${pick.html.replace('<div class="chips mb">', '<div class="chips mb"><button class="chip-btn lb-chip" data-pt="giovanili">🏆 Tutte le giovanili</button>')}
        ${st?.classifica?.length ? `<h2 class="section">Classifica</h2>
          <div class="table-wrap"><table class="table standings">
            <thead><tr><th>#</th><th>Squadra</th><th>PT</th><th>G</th><th>V</th><th>N</th><th>P</th><th>DR</th></tr></thead>
            <tbody>${st.classifica.map((r) => `<tr class="${/palazzo/i.test(r.squadra) ? 'us' : ''} ${r.zona ? 'zona-' + r.zona : ''}"><td>${r.pos}</td><td>${esc(r.squadra)}</td><td><b>${r.pt}</b></td><td>${r.g}</td><td>${r.v}</td><td>${r.n}</td><td>${r.p}</td><td>${r.dr > 0 ? '+' : ''}${r.dr}</td></tr>`).join('')}</tbody>
          </table></div>${st.legenda ? `<p class="small">${Object.entries(st.legenda).map(([k, v]) => `<span class="zona-dot zona-${k}"></span> ${esc(v)}`).join(' &nbsp; ')}</p>` : ''}` : ''}
        ${st?.evidenza?.length ? `<h2 class="section">In evidenza</h2><div class="list">${st.evidenza.map((t) => `<div class="item small">🔥 ${esc(t)}</div>`).join('')}</div>` : ''}
        <h2 class="section">Marcatori</h2>
        ${scorers.length ? `<div class="list">${scorers.map((m, i) => `<div class="item"><span class="rank">${i + 1}</span>${m.id || m.playerId ? `<span class="avatar" style="width:38px;height:38px;font-size:14px" data-rphoto="${m.id || m.playerId}">${esc(m.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>` : ''}<div class="grow">${esc(m.name)}</div><strong>${m.gol}</strong><span class="muted small">gol${m.rig ? ` (${m.rig} rig.)` : ''}</span></div>`).join('')}</div>`
          : '<div class="empty"><div class="empty-icon">⚽</div><p>Ancora nessun gol registrato per questa squadra.</p></div>'}
        ${assists.length ? `<h2 class="section">Assist</h2><div class="list">${assists.map((m, i) => `<div class="item"><span class="rank">${i + 1}</span>${m.id || m.playerId ? `<span class="avatar" style="width:38px;height:38px;font-size:14px" data-rphoto="${m.id || m.playerId}">${esc(m.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>` : ''}<div class="grow">${esc(m.name)}</div><strong>${m.assist}</strong><span class="muted small">assist</span></div>`).join('')}</div>` : ''}
        ${st ? `<p class="small muted">Fonte: ${esc(st.fonte || 'Tuttocampo')}, aggiornata al ${esc(fmtDate(st.aggiornato))}.</p>` : ''}`;
      bindPicker(root, draw);
      fillPhotos(root);
    };
    draw();
  });
}

// ---------- Scheda giocatore (pubblica) e compilazione ----------

function findPlayer(d, id) {
  const p = d.players.find((x) => x.id === id);
  if (!p) return null;
  const team = d.teams.find((t) => t.id === p.teamId);
  const official = d.teams.flatMap((t) => (t.stats?.marcatori || []).filter((m) => m.playerId === id).map((m) => ({ ...m, team: t.name })));
  return { p, team, official };
}

export async function playerProfileView(root, id) {
  setHeader({ title: 'Scheda giocatore', back: '#/g/rose' });
  const profs = await listProfiles();
  await withData(root, async (d) => {
    const f = findPlayer(d, id);
    if (!f) { root.innerHTML = '<div class="card">Giocatore non trovato.</div>'; return; }
    const { p, team, official } = f;
    const pr = profs[id] || {};
    const photo = pr.hasPhoto ? await getPhoto(id) : null;
    const gol = official.reduce((a, m) => a + (m.gol || 0), 0), ast = official.reduce((a, m) => a + (m.assist || 0), 0);
    root.innerHTML = `
      <div class="card center-col">
        ${photo ? `<img class="avatar" style="width:110px;height:110px" src="${photo}" alt="">` : `<span class="avatar" style="width:110px;height:110px;font-size:40px">${esc(p.number === '' ? p.name.split(' ').map((w) => w[0]).join('').slice(0, 2) : p.number)}</span>`}
        <h2 class="mt">${esc(p.name)}</h2>
        <div class="muted">${esc(team?.name || '')}${p.role ? ' · ' + esc(p.role) : ''}${p.number !== '' ? ' · #' + esc(p.number) : ''}</div>
        ${pr.birthDate ? `<div class="mt">🎂 ${esc(fmtDate(pr.birthDate, { day: 'numeric', month: 'long', year: 'numeric' }))} (${age(pr.birthDate)} anni)</div>` : ''}
      </div>
      <div class="tiles">
        <div class="tile"><div class="tile-v">${gol}</div><div class="tile-l">Gol</div></div>
        <div class="tile"><div class="tile-v">${ast}</div><div class="tile-l">Assist</div></div>
        <div class="tile"><div class="tile-v">${gol + ast}</div><div class="tile-l">Gol + assist</div></div>
      </div>
      ${official.length > 1 ? `<div class="card small">${official.map((m) => `<div>${esc(m.team)}: ${m.gol} gol, ${m.assist} assist</div>`).join('')}</div>` : ''}
      <a class="btn primary block mt" href="#/g/giocatore/${id}/modifica">${pr.updatedAt ? '✏️ Modifica la mia scheda' : '✏️ È la mia scheda: compilala'}</a>
      ${pr.updatedAt ? '<button class="btn block mt" id="mypdf">📄 Scarica la mia scheda PDF (serve il PIN)</button>' : ''}
      <p class="small muted mt">Foto e data di nascita sono visibili a tutti nell'app. Cellulare ed email li vede solo la società.</p>`;
    const btn = root.querySelector('#mypdf');
    if (btn) btn.onclick = () => downloadMyPdf(d, f, pr, photo);
  });
}

function teamInfo(d, teamId) {
  const team = d.teams.find((t) => t.id === teamId);
  const st = team?.stats?.classifica?.find((r) => /palazzo/i.test(r.squadra)) || null;
  const results = d.matches.filter((m) => m.teamId === teamId && m.played && m.goalsFor != null).sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({
    date: fmtDate(m.date, { day: '2-digit', month: '2-digit' }),
    label: m.home === false ? `${m.opponent} - Palazzo` : `Palazzo - ${m.opponent}`,
    score: m.home === false ? `${m.goalsAgainst}-${m.goalsFor}` : `${m.goalsFor}-${m.goalsAgainst}`,
  }));
  return { team, st, results };
}

async function downloadMyPdf(d, f, pr, photo) {
  const { p, official } = f;
  const priv = await sheet('Scheda PDF', (body, close) => {
    body.innerHTML = `<p class="small muted mb">Inserisci il PIN che hai scelto quando hai compilato la scheda.</p>
      <form id="pp" class="form"><input id="pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN" class="code-input" autocomplete="off">
      <p class="small warn" id="perr" hidden></p><button class="btn primary block mt" id="pbtn">Scarica PDF</button></form>`;
    setTimeout(() => body.querySelector('#pin').focus(), 300);
    body.querySelector('#pp').onsubmit = async (e) => {
      e.preventDefault();
      const b = body.querySelector('#pbtn'); b.disabled = true; b.textContent = 'Verifica…';
      try { close(await myPrivate(p.id, body.querySelector('#pin').value)); } catch (err) {
        const el = body.querySelector('#perr'); el.hidden = false; el.textContent = err.message; b.disabled = false; b.textContent = 'Scarica PDF';
      }
    };
  });
  if (!priv) return;
  toast('Creo il PDF…');
  const { team, st, results } = teamInfo(d, p.teamId);
  try {
    await exportPublicPlayerPdf({ name: p.name, number: p.number, role: p.role, team: team?.name, birthDate: pr.birthDate, phone: priv.phone, email: priv.email,
      photo, official, teamStats: st, results });
  } catch (e) { toast('Errore PDF: ' + e.message, 4000); }
}

export async function playerProfileEditView(root, id) {
  setHeader({ title: 'La mia scheda', back: `#/g/giocatore/${id}` });
  const profs = await listProfiles();
  await withData(root, async (d) => {
    const f = findPlayer(d, id);
    if (!f) { root.innerHTML = '<div class="card">Giocatore non trovato.</div>'; return; }
    const { p } = f;
    const pr = profs[id] || {};
    let photo;  // undefined = invariata
    const current = pr.hasPhoto ? await getPhoto(id) : null;
    root.innerHTML = `
      <form class="form" id="pf">
        <div class="card center-col">
          <div id="ph">${current ? `<img class="avatar" style="width:100px;height:100px" src="${current}" alt="">` : '<span class="avatar" style="width:100px;height:100px;font-size:36px">📷</span>'}</div>
          <div class="row gap mt"><label class="btn small">Scegli foto<input type="file" accept="image/*" id="photo" hidden></label>
          ${current ? '<button type="button" class="btn small" id="nophoto">Rimuovi</button>' : ''}</div>
          <h3 class="mt">${esc(p.name)}</h3>
        </div>
        <div class="card">
          <label>Data di nascita<input type="date" name="birthDate" value="${esc(pr.birthDate || '')}" required></label>
          <label>Cellulare <span class="muted">(visibile solo alla società)</span><input type="tel" name="phone" inputmode="tel" placeholder="es. 333 1234567" autocomplete="tel"></label>
          <label>Email <span class="muted">(visibile solo alla società)</span><input type="email" name="email" placeholder="nome@esempio.it" autocomplete="email"></label>
          ${pr.updatedAt ? '<p class="small muted">Per sicurezza cellulare ed email già inviati non vengono mostrati: lasciali vuoti per cancellarli o riscrivili.</p>' : ''}
        </div>
        <div class="card">
          <label>${pr.updatedAt ? 'Il tuo PIN' : 'Scegli un PIN di 4-6 cifre'} <input type="password" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required autocomplete="off"></label>
          <p class="small muted">${pr.updatedAt ? 'Il PIN che hai scelto la prima volta. Se l\'hai dimenticato chiedi al mister di azzerarlo.' : 'Servirà per modificare la scheda in futuro: così nessun altro può cambiarla. Ricordatelo!'}</p>
          <label class="switch small mt" style="white-space:normal"><input type="checkbox" name="consent" required> Sono il giocatore, oppure il genitore/tutore se minorenne, e acconsento a condividere questi dati con la società ASD Calcio Palazzo.</label>
        </div>
        <button class="btn primary block" id="send">Invia</button>
      </form>`;
    $('#photo', root).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { photo = await resizeImage(file, 256); $('#ph', root).innerHTML = `<img class="avatar" style="width:100px;height:100px" src="${photo}" alt="">`; } catch (err) { toast(err.message); }
    };
    const np = $('#nophoto', root);
    if (np) np.onclick = () => { photo = ''; $('#ph', root).innerHTML = '<span class="avatar" style="width:100px;height:100px;font-size:36px">📷</span>'; };
    $('#pf', root).onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = $('#send', root);
      btn.disabled = true; btn.textContent = 'Invio…';
      try {
        const r = await saveProfile({ id, pin: fd.get('pin'), birthDate: fd.get('birthDate'), phone: fd.get('phone'), email: fd.get('email'), consent: fd.get('consent') === 'on', ...(photo !== undefined ? { photo } : {}) });
        toast(r.newPin ? 'Scheda inviata! Ricorda il tuo PIN.' : 'Scheda aggiornata!', 3500);
        location.hash = `#/g/giocatore/${id}`;
      } catch (err) {
        toast(err.status === 503 ? 'Servizio non ancora attivo: avvisa il mister.' : err.message, 4500);
        btn.disabled = false; btn.textContent = 'Invia';
      }
    };
  });
}

// ---------- Menu "Altro" dell'area giocatori ----------
export async function playerMoreView(root) {
  setHeader({ title: 'Altro' });
  root.innerHTML = `<div class="list">
    <a class="item" href="#/g/rose"><span style="font-size:24px">👥</span><div class="grow"><strong>Squadre e schede giocatori</strong><div class="muted small">Rose con foto · compila la tua scheda</div></div><span class="chev">›</span></a>
    <a class="item" href="#/g/marcatori"><span style="font-size:24px">🏆</span><div class="grow"><strong>Classifiche e marcatori</strong><div class="muted small">Campionati e classifica di tutte le giovanili</div></div><span class="chev">›</span></a>
    <a class="item" href="#/g/esci"><span style="font-size:24px">🚪</span><div class="grow"><strong>Esci</strong><div class="muted small">Torna alla scelta dell'accesso</div></div><span class="chev">›</span></a>
  </div>`;
}
