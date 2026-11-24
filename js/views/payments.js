// Pagamenti della quota: rata unica o due rate, pagato segnato dal mister,
// ricevute caricate da giocatori/genitori, richiesta fattura.
import * as db from '../db.js';
import { esc, toast, sheet, confirmDialog, fmtDate, today, fullName, shareOrDownload, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { isSuperMode, superLogin } from '../admin.js';
import { me, asMe, call, euro } from '../family.js';
import { needIdentity, whoLine, uploadFlow, docRow, bindDocRows } from './docs.js';

const API = './api/pagamenti';
const RLABEL = new Proxy({}, { get: (_, k) => (k === 'unica' ? 'Rata unica' : `${String(k).slice(1)}ª rata`) });

/** Rate dovute secondo la modalità scelta (se non scelta: due rate). */
export function dues(conf, rec) {
  const plan = rec?.plan || '';
  return plan === 'unica' ? [{ key: 'unica', ...conf.unica }] : conf.rate.map((r) => ({ ...r }));
}
export function payStatus(conf, rec, teamId) {
  const td = today();
  if (rec?.exempt || (teamId && (conf.exemptTeams || []).includes(teamId))) return { exempt: true, total: 0, paid: 0, overdue: 0, list: [] };
  const list = dues(conf, rec).map((d) => {
    const p = rec?.paid?.[d.key];
    return { ...d, paid: p || null, overdue: !p && d.due < td };
  });
  const paid = list.reduce((s, d) => s + (d.paid ? Number(d.paid.amount) || d.amount : 0), 0);
  const total = list.reduce((s, d) => s + d.amount, 0);
  return { list, paid, total, overdue: list.filter((d) => d.overdue).length, done: list.every((d) => d.paid) };
}

const FATT = [
  ['intestatario', 'Intestatario (nome e cognome o ragione sociale)', 100, true], ['codiceFiscale', 'Codice fiscale', 16], ['partitaIva', 'Partita IVA (se azienda)', 13],
  ['indirizzo', 'Indirizzo', 120, true], ['cap', 'CAP', 5], ['citta', 'Città', 60, true], ['provincia', 'Provincia (sigla)', 2],
  ['email', 'Email', 80], ['pec', 'PEC (facoltativa)', 80], ['sdi', 'Codice destinatario SDI (facoltativo)', 7], ['note', 'Note', 300],
];

export async function playerPaymentsView(root) {
  setHeader({ title: 'Pagamenti', back: '#/g/altro' });
  if (!me()) return needIdentity(root, 'vedere i pagamenti');
  let d, docs;
  try { [d, docs] = await Promise.all([asMe('pagamenti', 'mine'), asMe('documenti', 'list').then((r) => r.items.filter((x) => x.kind === 'pagamento'))]); }
  catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const { conf, rec, fattura, teamId } = d;
  const teamExempt = (conf.exemptTeams || []).includes(teamId);
  const st = payStatus(conf, rec, teamId);
  const plan = rec.plan || '';
  const fv = (k) => esc(fattura?.[k] || '');
  root.innerHTML = `<div class="card small">${await whoLine()}</div>
    ${bankCard(d.bank, conf, me(), (await import('./board.js').then((x) => x.publicData())).players.find((p) => p.id === me().id)?.name || '')}
    <h2 class="section">💶 Quota stagione ${esc(conf.season)}</h2>
    ${teamExempt ? '<div class="card cert-card">✓ La tua squadra non paga la quota di iscrizione.</div>' : rec.exempt ? '<div class="card cert-card">✓ Quota non dovuta (esonero indicato dal mister).</div>' : `
    <div class="card">
      <p class="small muted mb">Scegli come pagare:</p>
      <div class="pay-plans">
        <label class="pay-plan ${plan === 'unica' ? 'on' : ''}"><input type="radio" name="plan" value="unica" ${plan === 'unica' ? 'checked' : ''}>
          <strong>Rata unica</strong><span class="pay-amount">${euro(conf.unica.amount)}</span><small>entro il ${esc(fmtDate(conf.unica.due))}</small></label>
        <label class="pay-plan ${plan === 'rate' ? 'on' : ''}"><input type="radio" name="plan" value="rate" ${plan === 'rate' ? 'checked' : ''}>
          <strong>${conf.rate.length === 1 ? '1 rata' : conf.rate.length + ' rate'}</strong><span class="pay-amount">${conf.rate.map((r) => euro(r.amount)).join(' + ')}</span><small>${conf.rate.map((r) => 'entro il ' + esc(fmtDate(r.due))).join('<br>')}</small></label>
      </div>
      ${!plan ? '<p class="small warn mt">Modalità non ancora scelta.</p>' : ''}
    </div>
    <div class="tiles mb"><div class="tile"><b class="ok">${euro(st.paid)}</b><small>pagato</small></div><div class="tile"><b class="${st.total - st.paid > 0 ? (st.overdue ? 'ko' : '') : 'ok'}">${euro(st.total - st.paid)}</b><small>da pagare</small></div></div>
    ${st.list.map((r) => `
      <div class="card pay-rata ${r.paid ? 'paid' : r.overdue ? 'overdue' : ''}">
        <div class="row center"><div class="grow"><strong>${RLABEL[r.key]}</strong> · ${euro(r.amount)}<div class="small muted">entro il ${esc(fmtDate(r.due))}</div></div>
          <span class="pay-badge">${r.paid ? `✅ Pagata il ${esc(fmtDate(r.paid.date))}` : r.overdue ? '⚠️ Scaduta' : '⏳ Da pagare'}</span></div>
        ${docs.filter((x) => x.rata === r.key).length ? `<div class="list mt">${docs.filter((x) => x.rata === r.key).map((x) => docRow(x, !r.paid)).join('')}</div>` : ''}
        ${r.paid ? '' : `<button class="btn block mt" data-rc="${r.key}">📤 Condividi copia del pagamento</button>`}
      </div>`).join('')}
    <p class="small muted">Il mister segna la rata come pagata quando verifica il pagamento. Puoi caricare la foto o il PDF del bonifico o della ricevuta.</p>`}

    <h2 class="section">🧾 Richiesta fattura</h2>
    <div class="card">
      ${fattura ? `<p class="small ok mb">✓ Richiesta inviata il ${esc(fmtDate(new Date(fattura.at).toISOString().slice(0, 10)))} (${esc(fattura.by)}). Puoi aggiornarla quando vuoi.</p>` : '<p class="small muted mb">Se ti serve la fattura (es. per detrazioni o rimborsi aziendali), scrivi i dati dell\'intestatario.</p>'}
      <form class="form" id="ff">${FATT.map(([k, l, max, req]) => k === 'note'
        ? `<label>${l}<textarea name="${k}" rows="2" maxlength="${max}">${fv(k)}</textarea></label>`
        : `<label>${l}<input name="${k}" maxlength="${max}" value="${fv(k)}" ${req ? 'required' : ''} ${['codiceFiscale', 'sdi', 'provincia'].includes(k) ? 'autocapitalize="characters"' : ''} ${k === 'email' || k === 'pec' ? 'type="email" autocapitalize="off"' : ''}></label>`).join('')}
        <button class="btn primary block mt">${fattura ? 'Aggiorna richiesta fattura' : 'Invia richiesta fattura'}</button></form>
    </div>`;
  $$('input[name=plan]', root).forEach((i) => (i.onchange = async () => {
    try { await asMe('pagamenti', 'plan', { plan: i.value }); toast(i.value === 'unica' ? 'Scelta: rata unica' : `Scelta: ${conf.rate.length} rate`); route(); } catch (e) { toast(e.message, 4000); route(); }
  }));
  $$('[data-rc]', root).forEach((b) => (b.onclick = async () => { if (await uploadFlow('pagamento', { rata: b.dataset.rc, name: `Pagamento ${RLABEL[b.dataset.rc]}` })) route(); }));
  bindDocRows(root, docs, (id) => asMe('documenti', 'get', { docId: id }), (id) => asMe('documenti', 'delete', { docId: id }));
  bindBank(root);
  $('#ff', root).onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(FATT.map(([k]) => [k, e.target[k].value]));
    try { await asMe('pagamenti', 'fattura', data); toast('Richiesta fattura inviata ✓', 3000); route(); } catch (err) { toast(err.message, 4500); }
  };
}

// ---------- Area mister ----------

export async function misterPaymentsView(root) {
  setHeader({ title: 'Pagamenti', back: '#/home' });
  const code = await db.getMeta('clubCode');
  if (!code) { root.innerHTML = '<div class="empty"><p>Rientra come mister con la password.</p></div>'; return; }
  if (!isSuperMode()) {
    root.innerHTML = '<div class="empty"><div class="empty-icon">🔐</div><p>Solo l\'amministratore può vedere i pagamenti.</p><button class="btn primary" id="sl">Accedi come admin</button></div>';
    root.querySelector('#sl').onclick = async () => { if (await superLogin()) route(); };
    return;
  }
  let data, receipts;
  try {
    [data, receipts] = await Promise.all([call(`${API}?action=list&season=${encodeURIComponent(sessionStorage.getItem('paySeason') || '')}`, null, code), call('./api/documenti?action=list', null, code).then((r) => r.items.filter((x) => x.kind === 'pagamento'))]);
  } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const { conf, recs, fatture, seasons, current } = data;
  let bank = data.bank;
  const season = data.season;
  const [teams, players] = await Promise.all([db.all('teams'), db.all('players')]);
  teams.sort((a, b) => a.name.localeCompare(b.name));
  const tname = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  let sel = sessionStorage.getItem('payTeam') || 'tutte';
  let tab = sessionStorage.getItem('payTab') || 'quote';
  const rcBy = {};
  receipts.forEach((d) => (rcBy[d.playerId] = rcBy[d.playerId] || []).push(d));

  const draw = () => {
    const exT = new Set(conf.exemptTeams || []);
    // le squadre esonerate non compaiono nelle quote
    const list = players.filter((p) => !exT.has(p.teamId) && (sel === 'tutte' || p.teamId === sel)).sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const sts = list.map((p) => payStatus(conf, recs[p.id], p.teamId));
    const sum = (f) => sts.reduce((s, x) => s + f(x), 0);
    const fl = Object.entries(fatture).map(([pid, f]) => ({ pid, f, p: players.find((x) => x.id === pid) })).filter((x) => x.p && (sel === 'tutte' || x.p.teamId === sel)).sort((a, b) => b.f.at - a.f.at);
    root.innerHTML = `
      <div class="seg mb"><label><input type="radio" name="pt" value="quote" ${tab === 'quote' ? 'checked' : ''}><span>Quote</span></label><label><input type="radio" name="pt" value="fatture" ${tab === 'fatture' ? 'checked' : ''}><span>🧾 Fatture (${Object.keys(fatture).length})</span></label><label><input type="radio" name="pt" value="imp" ${tab === 'imp' ? 'checked' : ''}><span>⚙️ Imposta</span></label></div>
      <div class="row gap center mb"><span class="small muted">Anno calcistico</span><select id="seasonSel" class="grow">${Object.keys(seasons).sort().reverse().map((k) => `<option value="${k}" ${k === season ? 'selected' : ''}>${esc(k)}${k === current ? ' (in corso)' : ''}</option>`).join('')}</select></div>
      <div class="chips mb"><button class="chip-btn ${sel === 'tutte' ? 'on' : ''}" data-t="tutte">Tutte</button>${teams.filter((t) => !exT.has(t.id)).map((t) => `<button class="chip-btn ${t.id === sel ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      ${exT.size ? `<p class="small muted mb">Esonerate (non pagano): ${esc(teams.filter((t) => exT.has(t.id)).map((t) => t.name).join(', '))}</p>` : ''}
      <div id="pane"></div>`;
    const pane = $('#pane', root);
    if (tab === 'quote') {
      pane.innerHTML = `
        <div class="tiles mb"><div class="tile"><b class="ok">${euro(sum((x) => x.paid))}</b><small>incassato</small></div>
          <div class="tile"><b>${euro(sum((x) => x.total - x.paid))}</b><small>da incassare</small></div>
          <div class="tile"><b class="${sum((x) => x.overdue) ? 'ko' : ''}">${sts.filter((x) => x.overdue).length}</b><small>con rate scadute</small></div></div>
        <button class="btn small mb" id="csv">⬇️ Esporta elenco (CSV)</button>
        <div class="list">${list.map((p, i) => {
          const s = sts[i], r = recs[p.id] || {};
          return `<div class="item pay-row"><span class="avatar" data-rphoto="${p.id}">${esc(((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || ''))}</span>
            <div class="grow"><button class="btn-text pay-name" data-p="${p.id}"><strong>${esc(fullName(p))}</strong></button>
              <div class="muted small">${sel === 'tutte' ? esc(tname[p.teamId] || '') + ' · ' : ''}${s.exempt ? 'esonerato' : r.plan === 'unica' ? 'rata unica' : r.plan === 'rate' ? 'due rate' : 'modalità non scelta'}${(rcBy[p.id] || []).length ? ` · 📎 ${(rcBy[p.id] || []).length} ricevute` : ''}${fatture[p.id] ? ' · 🧾 fattura' : ''}</div>
              ${s.exempt ? '' : `<div class="pay-chips">${s.list.map((d) => `<button class="pay-chip ${d.paid ? 'paid' : d.overdue ? 'overdue' : ''}" data-mark="${p.id}|${d.key}">${d.paid ? '✓' : d.overdue ? '!' : '○'} ${d.key === 'unica' ? 'Unica' : d.key.toUpperCase()} ${euro(d.amount)}</button>`).join('')}</div>`}</div></div>`;
        }).join('') || '<p class="muted">Nessun giocatore.</p>'}</div>
        <p class="small muted mt">Tocca una rata per segnarla pagata (o togliere il segno). Tocca il nome per ricevute, modalità ed esonero.</p>`;
      import('../profiles.js').then((m) => m.fillPhotos(pane));
      $('#csv', pane).onclick = () => {
        const rows = [['Giocatore', 'Squadra', 'Modalità', 'Pagato', 'Da pagare', 'Rate scadute', 'Fattura a']];
        list.forEach((p, i) => { const s = sts[i]; rows.push([fullName(p), tname[p.teamId] || '', s.exempt ? 'esonerato' : (recs[p.id]?.plan || ''), s.paid, s.total - s.paid, s.overdue, fatture[p.id]?.intestatario || '']); });
        const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
        shareOrDownload(new Blob(['﻿' + csv], { type: 'text/csv' }), `pagamenti-${today()}.csv`);
      };
      $$('[data-mark]', pane).forEach((b) => (b.onclick = async () => {
        const [playerId, key] = b.dataset.mark.split('|');
        const p = players.find((x) => x.id === playerId);
        const s = payStatus(conf, recs[playerId]).list.find((d) => d.key === key);
        if (s.paid) {
          if (!(await confirmDialog(`Togliere "pagata" a ${fullName(p)} – ${RLABEL[key]}?`, 'Togli', true))) return;
          try { recs[playerId] = (await call(`${API}?action=mark`, { playerId, key, paid: false, season }, code)).rec; draw(); } catch (e) { toast(e.message, 4000); }
          return;
        }
        const ok = await sheet(`${fullName(p)} · ${RLABEL[key]}`, (body, close) => {
          body.innerHTML = `<form class="form" id="mk">
            <div class="row gap"><label class="grow">Importo €<input name="amount" type="number" inputmode="decimal" min="0" value="${s.amount}"></label>
              <label class="grow">Data<input name="date" type="date" value="${today()}"></label></div>
            <label>Metodo<select name="method"><option>Bonifico</option><option>Contanti</option><option>POS / carta</option><option>Altro</option></select></label>
            <button class="btn primary block mt">✅ Segna pagata</button></form>`;
          body.querySelector('#mk').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); close({ amount: f.get('amount'), date: f.get('date'), method: f.get('method') }); };
        });
        if (!ok) return;
        try { recs[playerId] = (await call(`${API}?action=mark`, { playerId, key, paid: true, season, ...ok }, code)).rec; toast('Pagamento registrato ✓'); draw(); } catch (e) { toast(e.message, 4000); }
      }));
      $$('[data-p]', pane).forEach((b) => (b.onclick = () => playerSheet(players.find((x) => x.id === b.dataset.p))));
    } else if (tab === 'fatture') {
      pane.innerHTML = fl.length ? fl.map(({ p, f }) => `<div class="card small">
          <div class="row center"><strong class="grow">${esc(fullName(p))}</strong><span class="muted">${esc(fmtDate(new Date(f.at).toISOString().slice(0, 10)))}</span></div>
          <div class="muted">${esc(tname[p.teamId] || '')} · richiesta da ${esc(f.by)}</div>
          <pre class="fatt">${esc(fattText(f))}</pre>
          <button class="btn small" data-copy="${p.id}">📋 Copia dati</button></div>`).join('')
        : '<div class="empty"><div class="empty-icon">🧾</div><p>Nessuna richiesta di fattura.</p></div>';
      $$('[data-copy]', pane).forEach((b) => (b.onclick = async () => {
        try { await navigator.clipboard.writeText(fattText(fatture[b.dataset.copy])); toast('Dati copiati ✓'); } catch { toast('Copia non riuscita'); }
      }));
    } else {
      setupPane(pane);
    }
    $$('input[name=pt]', root).forEach((i) => (i.onchange = () => { tab = i.value; sessionStorage.setItem('payTab', tab); draw(); }));
    $('#seasonSel', root).onchange = (e) => { sessionStorage.setItem('paySeason', e.target.value); route(); };
    $$('[data-t]', root).forEach((b) => (b.onclick = () => { sel = b.dataset.t; sessionStorage.setItem('payTeam', sel); draw(); }));
  };

  // ---------- ⚙️ Imposta pagamenti (solo admin) ----------
  function setupPane(pane) {
    let c = JSON.parse(JSON.stringify(conf));
    const exT = new Set(c.exemptTeams || []);
    const drawSetup = () => {
      const sumRate = c.rate.reduce((x, r) => x + (Number(r.amount) || 0), 0);
      pane.innerHTML = `
      <form class="form card" id="cf">
        <h3>📅 Anno calcistico ${esc(c.season)}${c.season === current ? ' <span class="badge">in corso</span>' : ''}</h3>
        <label>Importo annuale (quota) €<input name="total" type="number" min="0" inputmode="numeric" value="${c.total || c.unica.amount}"></label>
        <h3 class="mt">Rata unica</h3>
        <div class="row gap"><label class="grow">Importo €<input name="ua" type="number" min="0" value="${c.unica.amount}"></label><label class="grow">Entro il<input name="ud" type="date" value="${c.unica.due}"></label></div>
        <h3 class="mt">Pagamento a rate</h3>
        <label>Numero di rate<select name="nr">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === c.rate.length ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${c.rate.map((r, i) => `<div class="row gap"><label class="grow">${i + 1}ª rata €<input name="r${i}a" type="number" min="0" value="${r.amount}"></label><label class="grow">Entro il<input name="r${i}d" type="date" value="${r.due || ''}"></label></div>`).join('')}
        <p class="small ${sumRate === Number(c.total || c.unica.amount) ? 'ok' : 'warn'}">Somma delle rate: ${euro(sumRate)}${sumRate === Number(c.total || c.unica.amount) ? ' ✓' : ` — diversa dalla quota annuale (${euro(c.total || c.unica.amount)})`}</p>
        <h3 class="mt">Squadre esonerate (non pagano)</h3>
        <div class="chips">${teams.map((t) => `<label class="chip"><input type="checkbox" name="ex" value="${t.id}" ${exT.has(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div>
        <label class="consent-row mt"><input type="checkbox" name="cur" ${c.season === current ? 'checked' : ''}><span>È l'anno calcistico <strong>in corso</strong> (quello che vedono ragazzi e genitori)</span></label>
        <button class="btn primary block mt">💾 Salva ${esc(c.season)}</button>
        ${c.season !== current ? '<button type="button" class="btn danger block mt" id="delS">Elimina questo anno</button>' : ''}
      </form>
      <button class="btn block mb" id="newS">➕ Nuovo anno calcistico</button>

      <form class="form card" id="bf">
        <h3>🏦 Dati per il pagamento</h3>
        <p class="small muted">Li vedono ragazzi e genitori in Altro → Dati per pagamento e nella pagina Pagamenti.</p>
        <label>IBAN<input name="iban" maxlength="40" autocapitalize="characters" value="${esc(bank.iban || '')}" placeholder="IT00 X000 0000 0000 0000 0000 000"></label>
        <label>Intestatario del conto<input name="intestatario" maxlength="100" value="${esc(bank.intestatario || '')}"></label>
        <label>Banca <span class="muted">(facoltativo)</span><input name="banca" maxlength="80" value="${esc(bank.banca || '')}"></label>
        <label>Causale<input name="causale" maxlength="140" value="${esc(bank.causale || '')}"></label>
        <p class="small muted">Nella causale puoi usare {giocatore}, {stagione} e {rata}: vengono sostituiti con i dati del ragazzo.</p>
        <label>Altre indicazioni <span class="muted">(es. contanti in segreteria, orari)</span><textarea name="note" rows="2" maxlength="400">${esc(bank.note || '')}</textarea></label>
        <button class="btn primary block mt">💾 Salva dati per il pagamento</button>
      </form>`;
      const f = $('#cf', pane);
      const read = () => {
        const n = Number(f.nr.value);
        c.total = Number(f.total.value) || 0;
        c.unica = { amount: Number(f.ua.value) || 0, due: f.ud.value };
        c.rate = Array.from({ length: n }, (_, i) => ({ amount: f[`r${i}a`] ? Number(f[`r${i}a`].value) || 0 : 0, due: f[`r${i}d`] ? f[`r${i}d`].value : '' }));
        c.exemptTeams = [...f.querySelectorAll('[name=ex]:checked')].map((x) => x.value);
      };
      f.nr.onchange = () => { read(); drawSetup(); };
      f.total.onchange = () => { const old = Number(f.ua.value); read(); if (!old || old === conf.unica.amount) c.unica.amount = c.total; drawSetup(); };
      f.querySelectorAll('[name$=a]').forEach((i) => (i.oninput = () => { read(); const sr = c.rate.reduce((x, r) => x + r.amount, 0); const el = f.querySelector('p.small'); if (el) { const ok = sr === c.total; el.className = 'small ' + (ok ? 'ok' : 'warn'); el.textContent = `Somma delle rate: ${euro(sr)}${ok ? ' ✓' : ` — diversa dalla quota annuale (${euro(c.total)})`}`; } }));
      f.onsubmit = async (e) => {
        e.preventDefault(); read();
        const sr = c.rate.reduce((x, r) => x + r.amount, 0);
        if (sr !== c.total && !(await confirmDialog(`La somma delle rate (${euro(sr)}) è diversa dalla quota annuale (${euro(c.total)}). Salvare lo stesso?`, 'Salva'))) return;
        try {
          await call(`${API}?action=conf`, { season: c.season, total: c.total, unica: c.unica, rate: c.rate, exemptTeams: c.exemptTeams, current: f.cur.checked }, code);
          toast(`Impostazioni ${c.season} salvate ✓`);
          sessionStorage.setItem('paySeason', c.season); route();
        } catch (err) { toast(err.message, 4500); }
      };
      $('#newS', pane).onclick = () => {
        const y = Number((c.season || '2026/27').slice(0, 4)) + 1;
        const ns = prompt('Nuovo anno calcistico (es. 2027/28):', `${y}/${String(y + 1).slice(2)}`);
        if (!ns) return;
        if (!/^\d{4}\/\d{2}$/.test(ns.trim())) { toast('Formato: 2027/28'); return; }
        const shift = (d) => (d ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : '');
        c = { ...JSON.parse(JSON.stringify(conf)), season: ns.trim(), unica: { ...conf.unica, due: shift(conf.unica.due) }, rate: conf.rate.map((r) => ({ ...r, due: shift(r.due) })) };
        drawSetup();
        toast('Controlla importi e scadenze, poi salva');
      };
      const del = $('#delS', pane);
      if (del) del.onclick = async () => {
        if (!(await confirmDialog(`Eliminare le impostazioni dell'anno ${c.season}?`, 'Elimina', true))) return;
        try { await call(`${API}?action=delseason`, { season: c.season }, code); sessionStorage.removeItem('paySeason'); route(); } catch (err) { toast(err.message, 4000); }
      };
      $('#bf', pane).onsubmit = async (e) => {
        e.preventDefault();
        const g = Object.fromEntries(new FormData(e.target));
        try { bank = (await call(`${API}?action=bank`, g, code)).bank; toast('Dati per il pagamento salvati ✓'); drawSetup(); } catch (err) { toast(err.message, 4500); }
      };
    };
    drawSetup();
  }

  async function playerSheet(p) {
    const r = recs[p.id] || {};
    const rc = rcBy[p.id] || [];
    await sheet(fullName(p), (body, close) => {
      body.innerHTML = `<form class="form" id="ps">
        <label>Modalità<select name="plan"><option value="">Non scelta</option><option value="unica" ${r.plan === 'unica' ? 'selected' : ''}>Rata unica ${euro(conf.unica.amount)}</option><option value="rate" ${r.plan === 'rate' ? 'selected' : ''}>${conf.rate.length} rate ${conf.rate.map((x) => euro(x.amount)).join(' + ')}</option></select></label>
        <label class="switch"><input type="checkbox" name="exempt" ${r.exempt ? 'checked' : ''}> Esonerato (non deve pagare)</label>
        <label>Note<input name="note" maxlength="200" value="${esc(r.note || '')}"></label>
        <button class="btn primary block">Salva</button></form>
        <h3 class="mt">📎 Ricevute caricate</h3>
        ${rc.length ? `<div class="list">${rc.map((d) => docRow({ ...d, name: `${d.name}${d.rata ? ' (' + RLABEL[d.rata] + ')' : ''}` }, true)).join('')}</div>` : '<p class="small muted">Nessuna ricevuta.</p>'}
        ${fatture[p.id] ? `<h3 class="mt">🧾 Fattura</h3><pre class="fatt">${esc(fattText(fatture[p.id]))}</pre>` : ''}`;
      body.querySelector('#ps').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try { recs[p.id] = (await call(`${API}?action=set`, { playerId: p.id, plan: f.plan.value, exempt: f.exempt.checked, note: f.note.value, season }, code)).rec; toast('Salvato ✓'); close(); draw(); } catch (err) { toast(err.message, 4000); }
      };
      bindDocRows(body, rc, (id) => call('./api/documenti?action=get', { docId: id }, code), (id) => call('./api/documenti?action=delete', { docId: id }, code));
    });
  }
  draw();
}

function fattText(f) {
  return [f.intestatario, f.codiceFiscale && `C.F. ${f.codiceFiscale}`, f.partitaIva && `P.IVA ${f.partitaIva}`, f.indirizzo, [f.cap, f.citta, f.provincia && `(${f.provincia})`].filter(Boolean).join(' '),
    f.email && `Email: ${f.email}`, f.pec && `PEC: ${f.pec}`, f.sdi && `SDI: ${f.sdi}`, f.note && `Note: ${f.note}`].filter(Boolean).join('\n');
}

// ---------- Dati per il pagamento (ragazzi e genitori) ----------

function causale(bank, conf, playerName, rata = '') {
  return (bank.causale || 'Quota iscrizione {stagione} – {giocatore}').replace(/\{giocatore\}/g, playerName || '…').replace(/\{stagione\}/g, conf.season).replace(/\{rata\}/g, rata);
}

export function bankCard(bank, conf, ident, playerName = '') {
  if (!bank || (!bank.iban && !bank.note)) return '<div class="card small muted">🏦 I dati per il pagamento non sono ancora stati inseriti dalla società.</div>';
  return `<div class="card bank-card">
    <h3>🏦 Dati per il pagamento</h3>
    ${bank.iban ? `<div class="small muted">IBAN</div><div class="iban">${esc(bank.iban.replace(/(.{4})/g, '$1 ').trim())}</div>
      <button class="btn small mt" data-copyiban="${esc(bank.iban)}">📋 Copia IBAN</button>` : ''}
    ${bank.intestatario ? `<div class="small mt"><span class="muted">Intestato a</span> <strong>${esc(bank.intestatario)}</strong></div>` : ''}
    ${bank.banca ? `<div class="small"><span class="muted">Banca</span> ${esc(bank.banca)}</div>` : ''}
    ${bank.iban ? `<div class="small mt"><span class="muted">Causale</span> <strong>${esc(causale(bank, conf, playerName))}</strong></div>` : ''}
    ${bank.note ? `<p class="small mt">${esc(bank.note)}</p>` : ''}
  </div>`;
}

function bindBank(root) {
  root.querySelectorAll('[data-copyiban]').forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copyiban); toast('IBAN copiato ✓'); } catch { prompt('Copia l\'IBAN:', b.dataset.copyiban); }
  }));
}

export async function bankView(root) {
  setHeader({ title: 'Dati per pagamento', back: '#/g/altro' });
  let d;
  try { d = await call(`${API}?action=bank`); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const { conf, bank } = d;
  let name = '';
  const m = me();
  if (m) { try { name = (await import('./board.js').then((x) => x.publicData())).players.find((p) => p.id === m.id)?.name || ''; } catch { /* */ } }
  root.innerHTML = `${bankCard(bank, conf, m, name)}
    <h2 class="section">💶 Quota ${esc(conf.season)}</h2>
    <div class="card">
      <div class="row center"><strong class="grow">Rata unica</strong><span>${euro(conf.unica.amount)} · entro il ${esc(fmtDate(conf.unica.due))}</span></div>
      <div class="small muted mt">oppure a rate:</div>
      ${conf.rate.map((r, i) => `<div class="row center"><span class="grow">${i + 1}ª rata</span><span>${euro(r.amount)} · entro il ${esc(fmtDate(r.due))}</span></div>`).join('')}
    </div>
    <a class="btn primary block mt" href="#/g/pagamenti">💶 I miei pagamenti, ricevute e fattura</a>
    <p class="small muted mt">Dopo il pagamento carica la ricevuta in "I miei pagamenti": il mister la vede e segna la rata come pagata.</p>`;
  bindBank(root);
}
