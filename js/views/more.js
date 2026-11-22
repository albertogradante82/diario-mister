import * as db from '../db.js';
import { chooseFileAsAdmin } from '../admin.js';
import { esc, on, toast, confirmDialog, pick, shareOrDownload, chooseFile, readText, fullName, sheet, $ } from '../util.js';
import { setHeader, setCurrent, route, loadSeason, state, byNumber } from '../app.js';
import * as sync from '../sync.js';

const CATEGORIES = ['Piccoli Amici', 'Primi Calci', 'Pulcini', 'Esordienti', 'Giovanissimi', 'Allievi', 'Juniores', 'Altro'];

export function defaultSeasonName() {
  const d = new Date();
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${String(y + 1).slice(2)}`;
}

// ---------- Primo avvio ----------

export async function onboardingView(root) {
  root.innerHTML = `
    <div class="hero">
      <div class="hero-icon">⚽</div>
      <h1>Diario del Mister</h1>
      <p class="muted">Rosa, partite, eventi live e statistiche per il calcio giovanile. I dati restano solo su questo dispositivo.</p>
    </div>
    <form class="card form" id="f">
      <label>Nome squadra<input name="name" required placeholder="es. Esordienti 2014"></label>
      <label>Categoria<select name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label>Stagione<input name="season" required value="${defaultSeasonName()}"></label>
      <button class="btn primary block">Inizia</button>
    </form>
    <div class="card">
      <p class="small"><strong>Ti hanno dato un codice?</strong> Entra nell'archivio condiviso e trovi già squadre, giocatori e partite.</p>
      <div class="row gap"><input id="joincode" class="grow code-input" placeholder="Codice di accesso" autocomplete="off" autocapitalize="off"><button class="btn primary" id="join">Entra</button></div>
    </div>
    <div class="card">
      <p class="muted small">Hai un file di backup o un file rose (squadre e giocatori)?</p>
      <button class="btn block" id="restore">Apri file</button>
    </div>`;
  $('#join', root).onclick = async () => {
    const code = $('#joincode', root).value;
    if (!code.trim()) { toast('Inserisci il codice'); return; }
    toast('Collegamento in corso…');
    try {
      const r = await sync.connect(code);
      toast(`Collegato: ${r.received} elementi scaricati`);
      route();
    } catch (e) { toast(e.message, 4000); }
  };
  $('#f', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const team = await db.put('teams', { name: f.get('name').trim(), category: f.get('category'), customFields: [] });
    const season = await db.put('seasons', { teamId: team.id, name: f.get('season').trim() });
    await setCurrent(team.id, season.id);
    location.hash = '#/rosa';
    route();
  };
  $('#restore', root).onclick = restoreBackup;
}

// ---------- Altro ----------

export async function moreView(root) {
  setHeader({ title: 'Altro' });
  const teams = await db.all('teams');
  const seasons = await db.all('seasons');
  const { players, team } = await loadSeason();
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const lastBackup = await db.getMeta('lastBackup');

  root.innerHTML = `
    <h2 class="section">Archivio condiviso</h2>
    <div class="card" id="syncCard"></div>

    <h2 class="section">Squadre e stagioni</h2>
    <div class="list">
      ${teams.map((t) => `<a class="item" href="#/squadra/${t.id}">
        <div class="grow"><strong>${esc(t.name)}</strong><div class="muted small">${esc(t.category || '')} · ${seasons.filter((s) => s.teamId === t.id).map((s) => esc(s.name)).join(', ')}</div></div>
        <span class="chev">›</span></a>`).join('')}
      <a class="item" href="#/squadra/nuova"><span class="accent">+ Nuova squadra</span></a>
    </div>

    <h2 class="section">Giocatori</h2>
    <div class="list">
      <button class="item" data-action="merge"><div class="grow"><strong>Unisci giocatori</strong><div class="muted small">Se lo stesso ragazzo compare due volte (es. dopo un cambio di numero o un import), sposta tutti i dati su un solo profilo.</div></div><span class="chev">›</span></button>
      <button class="item" data-action="fields"><div class="grow"><strong>Campi personalizzati</strong><div class="muted small">${esc((team?.customFields || []).map((c) => c.name).join(', ') || 'Nessuno')}</div></div><span class="chev">›</span></button>
    </div>

    <h2 class="section">Backup</h2>
    <div class="card">
      <p class="small muted">Oltre all'eventuale archivio condiviso, i dati sono salvati su questo dispositivo. Esporta regolarmente un backup (es. su File/iCloud Drive) per non perderli e per spostarli su un altro telefono.</p>
      <p class="small">Ultimo backup: <strong>${lastBackup ? new Date(lastBackup).toLocaleString('it-IT') : 'mai'}</strong>${persisted ? '' : ' · <span class="warn">archivio non protetto dalla pulizia automatica del browser</span>'}</p>
      <div class="row gap">
        <button class="btn primary grow" data-action="export">Esporta backup</button>
        <button class="btn grow" data-action="import">Importa backup</button>
      </div>
      <button class="btn block mt" data-action="importRose">Importa rose o calendario</button>
      <p class="small muted">"Importa rose o calendario" aggiunge squadre, giocatori o partite da un file preparato (es. elenchi Excel della società, calendari del campionato) senza cancellare i dati presenti.</p>
    </div>

    <h2 class="section">File di tracking</h2>
    <div class="card small">
      <p>Dalla pagina di una partita puoi importare un file JSON con i dati GPS/video di ogni numero di maglia. Il file non contiene nomi: i dati vengono collegati ai giocatori tramite numero, squadra e stagione.</p>
      <a class="btn block" href="esempi/tracking-esempio.json" download>Scarica un file di esempio</a>
      <details class="mt"><summary>Formato del file</summary><pre class="code">{
  "formato": "mister-tracking",
  "versione": 1,
  "partita": { "data": "2026-10-12", "squadra": "Esordienti", "stagione": "2026/27" },
  "campo": { "lunghezza": 65, "larghezza": 45 },
  "giocatori": [
    {
      "numero": 7,
      "distanza_m": 5230,
      "velocita_max_kmh": 23.4,
      "sprint": 11,
      "posizioni": [[0, 32.5, 22.0], [1, 33.1, 21.4]],
      "heatmap": { "colonne": 12, "righe": 8, "valori": [0, 1, 4, …] }
    }
  ]
}</pre><p class="muted">"posizioni" = [secondo, x metri, y metri]. "heatmap" e "posizioni" sono facoltativi: se manca la heatmap viene calcolata dalle posizioni.</p></details>
    </div>

    <h2 class="section">Informazioni</h2>
    <div class="card small">
      <p><strong>Installare su iPhone:</strong> apri il link in Safari → tasto Condividi → <em>Aggiungi alla schermata Home</em>. L'app funziona anche senza connessione.</p>
      <p class="muted">Versione 1.0 · nessun dato inviato a server · rispetta la privacy dei minori: raccogli il consenso dei genitori per foto e dati.</p>
      <button class="btn danger block mt" data-action="wipe">Cancella tutti i dati</button>
    </div>`;

  renderSyncCard($('#syncCard', root), teams.length > 0);
  on(root, 'export', exportBackup);
  on(root, 'import', restoreBackup);
  on(root, 'importRose', importRose);
  on(root, 'merge', () => mergePlayers(players));
  on(root, 'fields', () => editCustomFields(team));
  on(root, 'wipe', async () => {
    if (!(await confirmDialog('Eliminare definitivamente TUTTI i dati dell\'app da questo dispositivo? Se sei collegato all\'archivio condiviso, i dati online non vengono toccati e verranno riscaricati.', 'Elimina tutto', true))) return;
    await db.importAll({ app: 'mister-app', data: {} });
    toast('Dati eliminati');
    location.hash = '#/partite';
    route();
  });
}

// ---------- Archivio condiviso ----------

async function renderSyncCard(el, hasLocalData) {
  const cfg = await sync.getConfig();
  if (!cfg.enabled) {
    el.innerHTML = `
      <p class="small">Con l'archivio condiviso tutti i mister che hanno il <strong>codice di accesso</strong> vedono e modificano le stesse squadre, giocatori, partite, eventi e tracking. Ogni telefono tiene una copia: l'app funziona anche offline e si aggiorna appena c'è rete.</p>
      <p class="small warn">Attenzione: chi ha il codice vede anche foto, date di nascita, contatti dei genitori e visite mediche dei ragazzi. Dai il codice solo a persone dello staff.</p>
      <label class="small muted">Codice di accesso<input id="scode" class="code-input" autocomplete="off" autocapitalize="off" value="${esc(cfg.code || '')}"></label>
      ${hasLocalData ? `<label class="switch small mt"><input type="checkbox" id="supload" checked> Carica nell'archivio anche i dati già presenti su questo telefono</label>` : ''}
      <button class="btn primary block mt" id="sconnect">Collega</button>`;
    el.querySelector('#sconnect').onclick = async () => {
      const code = el.querySelector('#scode').value;
      if (!code.trim()) { toast('Inserisci il codice'); return; }
      toast('Collegamento in corso…');
      try {
        const up = el.querySelector('#supload');
        const r = await sync.connect(code, { uploadLocal: !!(up && up.checked) });
        toast(`Collegato · inviati ${r.sent}, ricevuti ${r.received}`);
        route();
      } catch (e) { toast(e.message, 4000); }
    };
    return;
  }
  const draw = (st) => {
    const label = { ok: 'Sincronizzato', syncing: 'Sincronizzazione in corso…', offline: 'Offline', error: 'Errore', off: 'Non collegato' }[st.state] || st.state;
    el.innerHTML = `
      <div class="status-line"><span class="dot ${st.state === 'ok' ? 'ok' : st.state === 'error' ? 'err' : st.state === 'syncing' ? 'syncing' : ''}"></span><strong>${esc(label)}</strong></div>
      <p class="small muted">${st.lastSync ? 'Ultimo aggiornamento: ' + new Date(st.lastSync).toLocaleTimeString('it-IT') : ''}${st.pending ? ` · ${st.pending} modifiche da inviare` : ''}</p>
      ${st.error ? `<p class="small warn">${esc(st.error)}</p>` : ''}
      <div class="row gap"><button class="btn grow" id="snow">Sincronizza ora</button><button class="btn grow" id="sall">Invia tutti i miei dati</button></div>
      <button class="btn danger block mt" id="soff">Scollega questo telefono</button>
      <p class="small muted mt">Scollegando, i dati restano su questo telefono ma non si aggiornano più.</p>`;
    el.querySelector('#snow').onclick = async () => {
      try { const r = await sync.syncNow(); toast(`Inviati ${r.sent}, ricevuti ${r.received}`); if (r.received) route(); } catch (e) { toast(e.message, 4000); }
    };
    el.querySelector('#sall').onclick = async () => {
      if (!(await confirmDialog('Inviare all\'archivio condiviso tutti i dati presenti su questo telefono? Se un dato è stato modificato più di recente da un altro mister, resta quello più recente.', 'Invia'))) return;
      const n = await db.queueAll();
      try { await sync.syncNow(); toast(`${n} elementi inviati`); } catch (e) { toast(e.message, 4000); }
    };
    el.querySelector('#soff').onclick = async () => {
      if (!(await confirmDialog('Scollegare questo telefono dall\'archivio condiviso?', 'Scollega'))) return;
      await sync.disconnect();
      route();
    };
  };
  const off = sync.onStatus(draw);
  // smette di ascoltare quando si cambia pagina
  window.addEventListener('hashchange', off, { once: true });
}

export async function exportBackup() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const d = new Date();
  const name = `backup-mister-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  await shareOrDownload(blob, name);
  await db.setMeta('lastBackup', Date.now());
  toast('Backup creato');
}

async function restoreBackup() {
  const file = await chooseFileAsAdmin('application/json,.json', 'Le importazioni sono riservate all\'amministratore.');
  if (!file) return;
  try {
    const json = JSON.parse(await readText(file));
    if (json.app !== 'mister-app') throw new Error('Questo file non è un backup del Diario del Mister.');
    if (json.kind === 'rose') { await mergeRose(json); return; }
    const n = (json.data.players || []).length, m = (json.data.matches || []).length;
    if (!(await confirmDialog(`Il backup contiene ${n} giocatori e ${m} partite. I dati attuali su questo dispositivo verranno SOSTITUITI. Continuare?`, 'Ripristina', true))) return;
    await db.importAll(json);
    await db.setMeta('current', {});
    toast('Backup ripristinato');
    location.hash = '#/partite';
    route();
  } catch (e) {
    toast(e.message || 'File non valido', 4000);
  }
}

// ---------- Importazione rose (unione, non sostituzione) ----------

async function importRose() {
  const file = await chooseFileAsAdmin('application/json,.json', 'Le importazioni sono riservate all\'amministratore.');
  if (!file) return;
  try {
    const json = JSON.parse(await readText(file));
    if (json.app !== 'mister-app' || !json.data) throw new Error('File non valido.');
    await mergeRose(json);
  } catch (e) {
    toast(e.message || 'File non valido', 4000);
  }
}

/** Aggiunge squadre, stagioni e giocatori. I dati già presenti (es. numeri inseriti a mano) hanno la precedenza. */
async function mergeRose(json) {
  const teams = json.data.teams || [], seasons = json.data.seasons || [], players = json.data.players || [];
  const matches = json.data.matches || [], events = json.data.events || [];
  // le partite devono appartenere a una squadra/stagione presente nel file o già nell'app
  const knownSeasons = new Set([...seasons.map((s) => s.id), ...(await db.all('seasons')).map((s) => s.id)]);
  const orphan = matches.filter((m) => !knownSeasons.has(m.seasonId)).length;
  if (orphan) { toast(`${orphan} partite appartengono a una squadra non presente: importa prima le rose.`, 5000); return; }
  const allTeams = [...teams, ...(await db.all('teams'))];
  const lines = [
    ...teams.map((t) => `• ${t.name}: ${players.filter((p) => p.teamId === t.id).length} giocatori`),
    ...[...new Set(matches.map((m) => m.teamId))].map((tid) => `• ${allTeams.find((t) => t.id === tid)?.name || 'Squadra'}: ${matches.filter((m) => m.teamId === tid).length} partite`),
  ];
  const what = [teams.length && `${teams.length} squadre`, players.length && `${players.length} giocatori`, matches.length && `${matches.length} partite`, events.length && `${events.length} eventi (gol)`].filter(Boolean).join(', ');
  if (!(await confirmDialog(`Importare ${what}?\n${lines.join('\n')}\n\nI dati già presenti non vengono cancellati.`, 'Importa'))) return;
  const filled = (v) => v !== '' && v != null && !(Array.isArray(v) && !v.length);
  const merge = (imp, cur) => {
    if (!cur) return imp;
    const out = { ...imp };
    Object.entries(cur).forEach(([k, v]) => { if (filled(v) && k !== 'custom' && k !== 'customFields') out[k] = v; });
    // un risultato importato chiude la partita
    if (imp.status === 'finita') out.status = 'finita';
    if (imp.custom || cur.custom) {
      out.custom = { ...(imp.custom || {}) };
      Object.entries(cur.custom || {}).forEach(([k, v]) => { if (filled(v)) out.custom[k] = v; });
    }
    if (imp.customFields || cur.customFields) {
      const ids = new Set((cur.customFields || []).map((c) => c.id));
      out.customFields = [...(cur.customFields || []), ...(imp.customFields || []).filter((c) => !ids.has(c.id))];
    }
    return out;
  };
  const write = async (name, list) => {
    const out = [];
    for (const r of list) out.push(merge({ ...r }, await db.get(name, r.id)));
    await db.putMany(name, out);
  };
  await write('teams', teams);
  await write('seasons', seasons);
  await write('players', players);
  await write('matches', matches);
  await write('events', events);
  if (!state.teamId && teams[0]) await setCurrent(teams[0].id, seasons.find((s) => s.teamId === teams[0].id)?.id || null);
  toast(`Importati: ${what}`);
  location.hash = '#/altro';
  route();
}

// ---------- Unione giocatori ----------

export async function mergePlayers(players) {
  if (players.length < 2) { toast('Servono almeno due giocatori nella stagione.'); return; }
  const opts = [...players].sort(byNumber).map((p) => ({ value: p.id, label: `${p.number ?? '–'} · ${fullName(p)}` }));
  const fromId = await pick('Giocatore da eliminare (i suoi dati verranno spostati)', opts);
  if (!fromId) return;
  const toId = await pick('Giocatore da mantenere', opts.filter((o) => o.value !== fromId));
  if (!toId) return;
  const from = players.find((p) => p.id === fromId), to = players.find((p) => p.id === toId);
  if (!(await confirmDialog(`Spostare eventi, minuti e tracking di "${fullName(from)}" su "${fullName(to)}" ed eliminare il primo profilo?`, 'Unisci'))) return;
  await mergeInto(from, to);
  toast('Giocatori uniti');
  route();
}

export async function mergeInto(from, to) {
  const events = (await db.all('events')).filter((e) => [e.playerId, e.playerInId, e.assistId].includes(from.id));
  events.forEach((e) => {
    if (e.playerId === from.id) e.playerId = to.id;
    if (e.playerInId === from.id) e.playerInId = to.id;
    if (e.assistId === from.id) e.assistId = to.id;
  });
  await db.putMany('events', events);
  const tracking = await db.where('tracking', 'playerId', from.id);
  tracking.forEach((t) => (t.playerId = to.id));
  await db.putMany('tracking', tracking);
  const matches = await db.where('matches', 'seasonId', from.seasonId);
  for (const m of matches) {
    let changed = false;
    const swap = (arr) => {
      if (!Array.isArray(arr) || !arr.includes(from.id)) return arr;
      changed = true;
      return [...new Set(arr.map((id) => (id === from.id ? to.id : id)))];
    };
    m.squad = swap(m.squad);
    (m.periods || []).forEach((p) => { p.onFieldStart = swap(p.onFieldStart); });
    if (changed) await db.put('matches', m);
  }
  // conserva il numero del profilo eliminato nello storico
  if (from.number != null && from.number !== '' && Number(from.number) !== Number(to.number)) {
    to.numberHistory = [...(to.numberHistory || []), ...(from.numberHistory || []), { number: Number(from.number), from: '', to: '', note: 'da unione' }];
  }
  to.notes = [to.notes, from.notes].filter(Boolean).join('\n');
  to.custom = { ...(from.custom || {}), ...(to.custom || {}) };
  if (!to.photo && from.photo) to.photo = from.photo;
  await db.put('players', to);
  await db.del('players', from.id);
}

// ---------- Campi personalizzati ----------

async function editCustomFields(team) {
  if (!team) return;
  await sheet('Campi personalizzati', (body, close) => {
    const draw = () => {
      body.innerHTML = `<p class="small muted mb">Campi aggiuntivi visibili nel profilo di ogni giocatore della squadra (es. "Taglia", "Allergie", "Contatto genitore").</p>
        <div class="list">${(team.customFields || []).map((c, i) => `<div class="item"><div class="grow">${esc(c.name)} <span class="muted small">(${c.type === 'number' ? 'numero' : 'testo'})</span></div><button class="btn-text danger" data-del="${i}">Elimina</button></div>`).join('') || '<div class="item muted">Nessun campo</div>'}</div>
        <form class="form mt" id="cf"><div class="row gap"><input name="name" placeholder="Nome campo" required class="grow"><select name="type"><option value="text">Testo</option><option value="number">Numero</option></select></div>
        <button class="btn primary block mt">Aggiungi</button></form>`;
      body.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
        team.customFields.splice(+b.dataset.del, 1);
        await db.put('teams', team);
        draw();
      }));
      body.querySelector('#cf').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        team.customFields = [...(team.customFields || []), { id: db.uid(), name: f.get('name').trim(), type: f.get('type') }];
        await db.put('teams', team);
        draw();
      };
    };
    draw();
  });
  route();
}

// ---------- Squadra ----------

export async function teamEditView(root, id) {
  const team = id ? await db.get('teams', id) : { name: '', category: 'Esordienti', customFields: [] };
  const seasons = id ? (await db.where('seasons', 'teamId', id)).sort((a, b) => b.name.localeCompare(a.name)) : [];
  setHeader({ title: id ? team.name : 'Nuova squadra', back: '#/altro' });

  root.innerHTML = `
    <form class="card form" id="tf">
      <label>Nome squadra<input name="name" required value="${esc(team.name)}"></label>
      <label>Categoria<select name="category">${CATEGORIES.map((c) => `<option ${c === team.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      ${id ? '' : `<label>Prima stagione<input name="season" required value="${defaultSeasonName()}"></label>`}
      <button class="btn primary block">Salva</button>
    </form>
    ${id ? `
    <h2 class="section">Stagioni</h2>
    <div class="list">
      ${seasons.map((s) => `<div class="item"><div class="grow"><strong>${esc(s.name)}</strong>${s.id === state.seasonId ? ' <span class="badge">attiva</span>' : ''}</div>
        <button class="btn-text" data-action="use" data-id="${s.id}">Usa</button>
        <button class="btn-text" data-action="rename" data-id="${s.id}">Rinomina</button>
        <button class="btn-text danger" data-action="delseason" data-id="${s.id}">Elimina</button></div>`).join('')}
    </div>
    <button class="btn block mt" data-action="newseason">+ Nuova stagione</button>
    <button class="btn danger block mt" data-action="delteam">Elimina squadra</button>` : ''}`;

  $('#tf', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    team.name = f.get('name').trim();
    team.category = f.get('category');
    await db.put('teams', team);
    if (!id) {
      const s = await db.put('seasons', { teamId: team.id, name: f.get('season').trim() });
      await setCurrent(team.id, s.id);
      location.hash = '#/rosa';
    } else {
      toast('Salvato');
      route();
    }
  };
  if (!id) return;

  on(root, 'use', async (b) => { await setCurrent(team.id, b.dataset.id); location.hash = '#/partite'; });
  on(root, 'rename', async (b) => {
    const s = seasons.find((x) => x.id === b.dataset.id);
    const name = prompt('Nome stagione', s.name);
    if (name && name.trim()) { s.name = name.trim(); await db.put('seasons', s); route(); }
  });
  on(root, 'delseason', async (b) => {
    const s = seasons.find((x) => x.id === b.dataset.id);
    if (!(await confirmDialog(`Eliminare la stagione ${s.name} con rosa, partite e statistiche?`, 'Elimina', true))) return;
    await db.deleteSeason(s.id);
    if (state.seasonId === s.id) await setCurrent(team.id, null);
    route();
  });
  on(root, 'delteam', async () => {
    if (!(await confirmDialog(`Eliminare la squadra ${team.name} e tutte le sue stagioni?`, 'Elimina', true))) return;
    await db.deleteTeam(team.id);
    await db.setMeta('current', {});
    location.hash = '#/altro';
    route();
  });
  on(root, 'newseason', async () => {
    const name = prompt('Nome della nuova stagione', nextSeasonName(seasons[0]?.name));
    if (!name || !name.trim()) return;
    const s = await db.put('seasons', { teamId: team.id, name: name.trim() });
    if (seasons.length) {
      const from = await pick('Copiare la rosa da una stagione precedente?', [
        { value: '__none', label: 'No, rosa vuota' },
        ...seasons.map((x) => ({ value: x.id, label: `Copia da ${x.name}` })),
      ]);
      if (from && from !== '__none') {
        const old = await db.where('players', 'seasonId', from);
        await db.putMany('players', old.map((p) => ({ ...p, id: db.uid(), seasonId: s.id, numberHistory: [], prevPlayerId: p.id })));
      }
    }
    await setCurrent(team.id, s.id);
    toast(`Stagione ${s.name} creata`);
    route();
  });
}

function nextSeasonName(prev) {
  const m = /(\d{4})/.exec(prev || '');
  if (!m) return defaultSeasonName();
  const y = Number(m[1]) + 1;
  return `${y}/${String(y + 1).slice(2)}`;
}
