import * as db from '../db.js';
import { esc, on, toast, confirmDialog, avatar, fullName, age, fmtDate, shortDate, num, pct, resizeImage, ROLES, FEET, $, today } from '../util.js';
import { setHeader, loadSeason, state, route } from '../app.js';
import { seasonData, seasonTotals, per90, playerSeries, METRICS, numberAt, detectTrends } from '../stats.js';
import { lineChart, pitchHeatmap, mergeHeatmaps } from '../charts.js';
import { exportPlayerPdf } from '../pdf.js';

// ---------- Rosa ----------

export async function rosterView(root) {
  const ctx = await loadSeason();
  setHeader({ title: 'Rosa', actions: `<a class="hdr-btn" href="#/giocatore/nuovo" aria-label="Nuovo giocatore">＋</a>` });
  const rows = seasonData(ctx);
  const groups = ROLES.map((r) => [r, ctx.players.filter((p) => p.role === r)]);
  const other = ctx.players.filter((p) => !ROLES.includes(p.role));
  if (other.length) groups.push(['Senza ruolo', other]);
  const medExpiring = ctx.players.filter((p) => p.medicalExpiry && p.medicalExpiry <= addDays(today(), 30));

  root.innerHTML = ctx.players.length === 0
    ? `<div class="empty"><div class="empty-icon">👥</div><p>La rosa è vuota.</p><a class="btn primary" href="#/giocatore/nuovo">Aggiungi il primo giocatore</a></div>`
    : `${medExpiring.length ? `<div class="card warn-card small">🩺 Visita medica in scadenza o scaduta: ${medExpiring.map((p) => esc(fullName(p))).join(', ')}</div>` : ''}
      ${groups.filter(([, l]) => l.length).map(([role, list]) => `
      <h2 class="section">${esc(role)} <span class="muted">(${list.length})</span></h2>
      <div class="list">${list.map((p) => {
        const t = seasonTotals(rows, p.id);
        return `<a class="item" href="#/giocatore/${p.id}">${avatar(p)}
          <div class="grow"><strong>${esc(fullName(p))}</strong>
          <div class="muted small">#${esc(p.number ?? '–')} · ${t.presenze} pres. · ${Math.round(t.minuti)}′ · ${t.gol} gol</div></div><span class="chev">›</span></a>`;
      }).join('')}</div>`).join('')}`;
}

function addDays(d, n) {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}

// ---------- Scheda giocatore ----------

export async function playerView(root, id) {
  const ctx = await loadSeason();
  const p = ctx.players.find((x) => x.id === id) || (await db.get('players', id));
  if (!p) { root.innerHTML = '<div class="card">Giocatore non trovato.</div>'; return; }
  setHeader({ title: fullName(p), back: '#/rosa', actions: `<a class="hdr-btn" href="#/giocatore/${p.id}/modifica">Modifica</a>` });

  const rows = seasonData(ctx);
  const tot = seasonTotals(rows, p.id);
  const played = rows.filter((r) => r.players[p.id] && r.players[p.id].minuti > 0);
  const trends = detectTrends(rows, [p]);
  const team = ctx.team;
  const heat = mergeHeatmaps(played.flatMap((r) => r.tracking.filter((t) => t.playerId === p.id).map((t) => t.heatmap)));
  const pitch = played.flatMap((r) => r.tracking.filter((t) => t.playerId === p.id).map((t) => t.pitch)).find(Boolean);
  const hasTracking = tot.distanza != null;

  const info = [
    ['Ruolo', p.role], ['Piede', p.foot], ['Nato il', p.birthDate ? `${fmtDate(p.birthDate)} (${age(p.birthDate)} anni)` : ''],
    ['Luogo di nascita', p.birthPlace], ['Altezza', p.height ? `${p.height} cm` : ''], ['Peso', p.weight ? `${p.weight} kg` : ''],
    ['Contatto', p.contact], ['Visita medica', p.medicalExpiry ? `scade il ${fmtDate(p.medicalExpiry)}` : ''],
    ...(team?.customFields || []).map((c) => [c.name, (p.custom || {})[c.id]]),
  ].filter(([, v]) => v != null && v !== '');

  const metricOpts = ['gol', 'assist', 'tiri', 'passaggiOk', 'precisione', 'perse', 'recuperi', 'minuti', ...(hasTracking ? ['distanza', 'velMax'] : [])];

  root.innerHTML = `
    <div class="profile">
      ${avatar(p, 84)}
      <div><div class="big-num">#${esc(p.number ?? '–')}</div><div class="muted">${esc(p.role || '')}${p.foot ? ' · piede ' + esc(p.foot.toLowerCase()) : ''}</div></div>
    </div>

    <div class="tiles">
      ${tile('Presenze', tot.presenze)}${tile('Titolare', tot.titolare)}${tile('Minuti', Math.round(tot.minuti))}
      ${tile('Gol', tot.gol)}${tile('Assist', tot.assist)}${tile('Tiri (porta)', `${tot.tiri} (${tot.tiriPorta})`)}
      ${tile('Passaggi', `${tot.passaggiOk}/${tot.passaggi}`)}${tile('Precisione', pct(tot.precisione))}${tile('Recuperi', tot.recuperi)}
      ${tile('Palle perse', tot.perse)}${hasTracking ? tile('Km totali', num(tot.distanza / 1000, 1)) + tile('Vel. max', num(tot.velMax, 1)) : ''}
    </div>

    ${trends.length ? `<h2 class="section">Tendenze ultime 3 partite</h2><div class="list">${trends.map((t) => `<div class="item"><span class="trend ${t.better ? 'up' : 'down'}">${t.better ? '▲' : '▼'}</span><div class="grow">${esc(t.label)}<div class="muted small">${esc(t.text)}</div></div></div>`).join('')}</div>` : ''}

    <h2 class="section">Andamento stagione</h2>
    <div class="card">
      <div class="row gap mb">
        <select id="metric" class="grow">${metricOpts.map((k) => `<option value="${k}">${esc(METRICS[k].label)}</option>`).join('')}</select>
        <label class="switch small"><input type="checkbox" id="norm"> per 90′</label>
      </div>
      <div id="chart"></div>
    </div>

    <h2 class="section">Per 90 minuti</h2>
    <div class="card"><div class="tiles compact">
      ${['gol', 'assist', 'tiri', 'passaggiOk', 'recuperi', 'perse', ...(hasTracking ? ['distanza'] : [])].map((k) => tile(METRICS[k].label, num(per90(tot, k, 1), k === 'distanza' ? 0 : 2))).join('')}
    </div>${tot.minuti < 90 ? '<p class="small muted mt">Meno di 90 minuti giocati: i valori sono poco indicativi.</p>' : ''}</div>

    ${hasTracking ? `<h2 class="section">Mappa di calore (stagione)</h2><div class="card">${pitchHeatmap(heat, pitch)}<p class="small muted">Somma delle partite con dati di tracking (${tot.trackedMatches}). Verso d'attacco come nel file importato.</p></div>` : ''}

    <h2 class="section">Partite</h2>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Data</th><th>Avv.</th><th>Min</th><th>G</th><th>A</th><th>Tiri</th><th>Pass</th><th>Rec</th><th>Perse</th>${hasTracking ? '<th>m</th>' : ''}</tr></thead>
      <tbody>${played.slice().reverse().map((r) => {
        const l = r.players[p.id];
        return `<tr onclick="location.hash='#/partita/${r.match.id}'"><td>${shortDate(r.match.date)}</td><td>${esc(r.match.opponent)}</td><td>${Math.round(l.minuti)}</td><td>${l.gol}</td><td>${l.assist}</td><td>${l.tiri}</td><td>${l.passaggiOk}/${l.passaggi}</td><td>${l.recuperi}</td><td>${l.perse}</td>${hasTracking ? `<td>${l.distanza != null ? num(l.distanza) : '–'}</td>` : ''}</tr>`;
      }).join('') || `<tr><td colspan="10" class="muted">Nessuna presenza</td></tr>`}</tbody>
    </table></div>

    ${info.length || p.notes ? `<h2 class="section">Profilo</h2><div class="card"><dl class="dl">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${(p.numberHistory || []).length ? `<p class="small muted mt">Numeri precedenti: ${(p.numberHistory || []).map((h) => `#${esc(h.number)}${h.from || h.to ? ` (${h.from ? 'dal ' + shortDate(h.from) : ''}${h.to ? ' al ' + shortDate(h.to) : ''})` : ''}`).join(', ')}</p>` : ''}
      ${p.notes ? `<p class="notes mt">${esc(p.notes)}</p>` : ''}</div>` : ''}

    <button class="btn primary block mt" data-action="pdf">📄 Esporta scheda PDF</button>`;

  const drawChart = () => {
    const key = $('#metric', root).value;
    const norm = $('#norm', root).checked && METRICS[key].per90;
    const series = playerSeries(rows, p.id, key, { normalize: norm });
    $('#chart', root).innerHTML = lineChart({
      labels: rows.map((r) => shortDate(r.match.date)),
      series: [{ name: METRICS[key].label, values: series }],
      percent: !!METRICS[key].ratio,
      empty: 'Nessuna partita giocata',
    });
  };
  $('#metric', root).onchange = drawChart;
  $('#norm', root).onchange = drawChart;
  drawChart();

  on(root, 'pdf', async () => {
    toast('Creo il PDF…');
    try {
      await exportPlayerPdf({ player: p, team, season: ctx.season, rows, totals: tot, trends, heat: hasTracking ? heat : null, pitch });
    } catch (e) {
      console.error(e);
      toast('Errore nella creazione del PDF: ' + e.message, 4000);
    }
  });
}

function tile(label, value) {
  return `<div class="tile"><div class="tile-v">${esc(value)}</div><div class="tile-l">${esc(label)}</div></div>`;
}

// ---------- Modifica giocatore ----------

export async function playerEditView(root, id) {
  const ctx = await loadSeason();
  const p = id ? await db.get('players', id) : {
    teamId: state.teamId, seasonId: state.seasonId, firstName: '', lastName: '', number: '', role: '', foot: '', custom: {}, numberHistory: [],
  };
  if (!p) { root.innerHTML = '<div class="card">Giocatore non trovato.</div>'; return; }
  const team = ctx.team;
  const originalNumber = p.number;
  setHeader({ title: id ? 'Modifica giocatore' : 'Nuovo giocatore', back: id ? `#/giocatore/${id}` : '#/rosa' });
  let photo = p.photo || null;
  let history = [...(p.numberHistory || [])];

  const field = (label, name, value, type = 'text', extra = '') =>
    `<label>${label}<input name="${name}" type="${type}" value="${esc(value ?? '')}" ${extra}></label>`;
  const select = (label, name, opts, value) =>
    `<label>${label}<select name="${name}"><option value="">—</option>${opts.map((o) => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;

  const drawHistory = () => {
    $('#hist', root).innerHTML = history.length
      ? history.map((h, i) => `<div class="row gap center mb"><span class="grow">#${esc(h.number)} ${h.from ? 'dal ' + shortDate(h.from) : ''} ${h.to ? 'al ' + shortDate(h.to) : ''}</span><button type="button" class="btn-text danger" data-hdel="${i}">Rimuovi</button></div>`).join('')
      : '<p class="small muted">Nessun numero precedente.</p>';
    root.querySelectorAll('[data-hdel]').forEach((b) => (b.onclick = () => { history.splice(+b.dataset.hdel, 1); drawHistory(); }));
  };

  root.innerHTML = `
    <form class="form" id="pf">
      <div class="card center-col">
        <div id="ph">${avatar({ ...p, photo }, 96)}</div>
        <div class="row gap mt"><label class="btn small">Scegli foto<input type="file" accept="image/*" id="photo" hidden></label>
        <button type="button" class="btn small" id="nophoto">Rimuovi</button></div>
      </div>
      <div class="card">
        ${field('Nome', 'firstName', p.firstName, 'text', 'required autocomplete="off"')}
        ${field('Cognome', 'lastName', p.lastName, 'text', 'autocomplete="off"')}
        ${field('Numero di maglia', 'number', p.number, 'number', 'inputmode="numeric" min="0" max="99"')}
        ${select('Ruolo', 'role', ROLES, p.role)}
        ${field('Ruolo secondario / posizione', 'position', p.position)}
        ${select('Piede', 'foot', FEET, p.foot)}
      </div>
      <div class="card">
        <h3>Dati anagrafici</h3>
        ${field('Data di nascita', 'birthDate', p.birthDate, 'date')}
        ${field('Luogo di nascita', 'birthPlace', p.birthPlace)}
        <div class="row gap">${field('Altezza (cm)', 'height', p.height, 'number', 'inputmode="numeric"')}${field('Peso (kg)', 'weight', p.weight, 'number', 'inputmode="decimal" step="0.1"')}</div>
        ${field('Contatto genitore', 'contact', p.contact, 'text', 'placeholder="Nome e telefono"')}
        ${field('Scadenza visita medica', 'medicalExpiry', p.medicalExpiry, 'date')}
      </div>
      ${(team?.customFields || []).length ? `<div class="card"><h3>Campi personalizzati</h3>
        ${team.customFields.map((c) => field(esc(c.name), 'cf_' + c.id, (p.custom || {})[c.id], c.type === 'number' ? 'number' : 'text')).join('')}</div>` : ''}
      <div class="card"><h3>Note</h3><textarea name="notes" rows="4" placeholder="Caratteristiche, obiettivi, osservazioni…">${esc(p.notes || '')}</textarea></div>
      <div class="card">
        <h3>Storico numeri di maglia</h3>
        <p class="small muted">Serve per collegare correttamente i file di tracking se il numero è cambiato durante la stagione.</p>
        <div id="hist"></div>
        <div class="hist-add"><small>Numero</small><small>Dal</small><small>Al</small><input id="hnum" type="number" inputmode="numeric" placeholder="N°"><input id="hfrom" type="date"><input id="hto" type="date"></div>
        <button type="button" class="btn small block mt" id="hadd">Aggiungi periodo (numero, dal, al)</button>
      </div>
      <button class="btn primary block">Salva</button>
      ${id ? '<button type="button" class="btn danger block mt" id="del">Elimina giocatore</button>' : ''}
    </form>`;
  drawHistory();

  $('#photo', root).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { photo = await resizeImage(f); $('#ph', root).innerHTML = avatar({ ...p, photo }, 96); } catch (err) { toast(err.message); }
  };
  $('#nophoto', root).onclick = () => { photo = null; $('#ph', root).innerHTML = avatar({ ...p, photo }, 96); };
  $('#hadd', root).onclick = () => {
    const n = $('#hnum', root).value;
    if (n === '') { toast('Indica il numero'); return; }
    history.push({ number: Number(n), from: $('#hfrom', root).value, to: $('#hto', root).value });
    $('#hnum', root).value = '';
    drawHistory();
  };

  $('#pf', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    ['firstName', 'lastName', 'role', 'position', 'foot', 'birthDate', 'birthPlace', 'contact', 'medicalExpiry', 'notes'].forEach((k) => (p[k] = (f.get(k) || '').trim()));
    ['number', 'height', 'weight'].forEach((k) => { const v = f.get(k); p[k] = v === '' || v == null ? '' : Number(v); });
    p.custom = p.custom || {};
    (team?.customFields || []).forEach((c) => { p.custom[c.id] = f.get('cf_' + c.id); });
    p.photo = photo;

    // numero duplicato nella stessa stagione
    const dup = ctx.players.find((x) => x.id !== p.id && x.number !== '' && Number(x.number) === Number(p.number) && p.number !== '');
    if (dup && !(await confirmDialog(`Il numero ${p.number} è già di ${fullName(dup)}. Salvare comunque?`, 'Salva'))) return;

    // cambio numero: proponi di salvare il vecchio nello storico
    if (id && originalNumber !== '' && originalNumber != null && Number(originalNumber) !== Number(p.number)) {
      const hasMatches = ctx.matches.some((m) => m.date && m.date < today());
      if (hasMatches && !history.some((h) => Number(h.number) === Number(originalNumber)) &&
        await confirmDialog(`Il giocatore aveva il numero ${originalNumber}. Salvarlo nello storico (valido fino a ieri) così i tracking delle partite passate restano collegati?`, 'Sì, salva')) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        history.push({ number: Number(originalNumber), from: '', to: y.toISOString().slice(0, 10) });
      }
    }
    p.numberHistory = history;
    await db.put('players', p);
    toast('Giocatore salvato');
    location.hash = `#/giocatore/${p.id}`;
  };

  if (id) {
    $('#del', root).onclick = async () => {
      if (!(await confirmDialog(`Eliminare ${fullName(p)}? Gli eventi registrati resteranno senza giocatore.`, 'Elimina', true))) return;
      await db.del('players', p.id);
      location.hash = '#/rosa';
    };
  }
}

export { numberAt };
