// Pagamenti della quota: rata unica o due rate, pagato segnato dal mister,
// ricevute caricate da giocatori/genitori, richiesta fattura.
import * as db from '../db.js';
import { esc, toast, sheet, confirmDialog, fmtDate, today, fullName, shareOrDownload, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { me, asMe, call, euro } from '../family.js';
import { needIdentity, whoLine, uploadFlow, docRow, bindDocRows } from './docs.js';

const API = './api/pagamenti';
const RLABEL = { unica: 'Rata unica', r1: '1ª rata', r2: '2ª rata' };

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
    <h2 class="section">💶 Quota stagione ${esc(conf.season)}</h2>
    ${teamExempt ? '<div class="card cert-card">✓ La tua squadra non paga la quota di iscrizione.</div>' : rec.exempt ? '<div class="card cert-card">✓ Quota non dovuta (esonero indicato dal mister).</div>' : `
    <div class="card">
      <p class="small muted mb">Scegli come pagare:</p>
      <div class="pay-plans">
        <label class="pay-plan ${plan === 'unica' ? 'on' : ''}"><input type="radio" name="plan" value="unica" ${plan === 'unica' ? 'checked' : ''}>
          <strong>Rata unica</strong><span class="pay-amount">${euro(conf.unica.amount)}</span><small>entro il ${esc(fmtDate(conf.unica.due))}</small></label>
        <label class="pay-plan ${plan === 'rate' ? 'on' : ''}"><input type="radio" name="plan" value="rate" ${plan === 'rate' ? 'checked' : ''}>
          <strong>Due rate</strong><span class="pay-amount">${conf.rate.map((r) => euro(r.amount)).join(' + ')}</span><small>${conf.rate.map((r) => 'entro il ' + esc(fmtDate(r.due))).join('<br>')}</small></label>
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
    try { await asMe('pagamenti', 'plan', { plan: i.value }); toast(i.value === 'unica' ? 'Scelta: rata unica' : 'Scelta: due rate'); route(); } catch (e) { toast(e.message, 4000); route(); }
  }));
  $$('[data-rc]', root).forEach((b) => (b.onclick = async () => { if (await uploadFlow('pagamento', { rata: b.dataset.rc, name: `Pagamento ${RLABEL[b.dataset.rc]}` })) route(); }));
  bindDocRows(root, docs, (id) => asMe('documenti', 'get', { docId: id }), (id) => asMe('documenti', 'delete', { docId: id }));
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
  let data, receipts;
  try {
    [data, receipts] = await Promise.all([call(`${API}?action=list`, null, code), call('./api/documenti?action=list', null, code).then((r) => r.items.filter((x) => x.kind === 'pagamento'))]);
  } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const { conf, recs, fatture } = data;
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
      <div class="seg mb"><label><input type="radio" name="pt" value="quote" ${tab === 'quote' ? 'checked' : ''}><span>Quote</span></label><label><input type="radio" name="pt" value="fatture" ${tab === 'fatture' ? 'checked' : ''}><span>🧾 Fatture (${Object.keys(fatture).length})</span></label><label><input type="radio" name="pt" value="imp" ${tab === 'imp' ? 'checked' : ''}><span>⚙️ Importi</span></label></div>
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
          try { recs[playerId] = (await call(`${API}?action=mark`, { playerId, key, paid: false }, code)).rec; draw(); } catch (e) { toast(e.message, 4000); }
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
        try { recs[playerId] = (await call(`${API}?action=mark`, { playerId, key, paid: true, ...ok }, code)).rec; toast('Pagamento registrato ✓'); draw(); } catch (e) { toast(e.message, 4000); }
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
      pane.innerHTML = `<form class="form card" id="cf">
        <label>Stagione<input name="season" value="${esc(conf.season)}"></label>
        <h3>Rata unica</h3>
        <div class="row gap"><label class="grow">Importo €<input name="ua" type="number" value="${conf.unica.amount}"></label><label class="grow">Entro il<input name="ud" type="date" value="${conf.unica.due}"></label></div>
        <h3>Due rate</h3>
        ${conf.rate.map((r, i) => `<div class="row gap"><label class="grow">${i + 1}ª rata €<input name="r${i}a" type="number" value="${r.amount}"></label><label class="grow">Entro il<input name="r${i}d" type="date" value="${r.due}"></label></div>`).join('')}
        <h3>Squadre esonerate (non pagano la quota)</h3>
        <div class="chips">${teams.map((t) => `<label class="chip"><input type="checkbox" name="ex" value="${t.id}" ${exT.has(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div>
        <button class="btn primary block mt">Salva importi</button>
        <p class="small muted">Valgono per tutti i giocatori. Chi non deve pagare si segna come esonerato (tocca il nome nella lista).</p></form>`;
      $('#cf', pane).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          const r = await call(`${API}?action=conf`, { season: f.season.value, unica: { amount: f.ua.value, due: f.ud.value }, rate: [0, 1].map((i) => ({ amount: f[`r${i}a`].value, due: f[`r${i}d`].value })), exemptTeams: [...f.querySelectorAll('[name=ex]:checked')].map((x) => x.value) }, code);
          Object.assign(conf, r.conf); toast('Importi salvati ✓'); draw();
        } catch (err) { toast(err.message, 4000); }
      };
    }
    $$('input[name=pt]', root).forEach((i) => (i.onchange = () => { tab = i.value; sessionStorage.setItem('payTab', tab); draw(); }));
    $$('[data-t]', root).forEach((b) => (b.onclick = () => { sel = b.dataset.t; sessionStorage.setItem('payTeam', sel); draw(); }));
  };

  async function playerSheet(p) {
    const r = recs[p.id] || {};
    const rc = rcBy[p.id] || [];
    await sheet(fullName(p), (body, close) => {
      body.innerHTML = `<form class="form" id="ps">
        <label>Modalità<select name="plan"><option value="">Non scelta</option><option value="unica" ${r.plan === 'unica' ? 'selected' : ''}>Rata unica ${euro(conf.unica.amount)}</option><option value="rate" ${r.plan === 'rate' ? 'selected' : ''}>Due rate ${conf.rate.map((x) => euro(x.amount)).join(' + ')}</option></select></label>
        <label class="switch"><input type="checkbox" name="exempt" ${r.exempt ? 'checked' : ''}> Esonerato (non deve pagare)</label>
        <label>Note<input name="note" maxlength="200" value="${esc(r.note || '')}"></label>
        <button class="btn primary block">Salva</button></form>
        <h3 class="mt">📎 Ricevute caricate</h3>
        ${rc.length ? `<div class="list">${rc.map((d) => docRow({ ...d, name: `${d.name}${d.rata ? ' (' + RLABEL[d.rata] + ')' : ''}` }, true)).join('')}</div>` : '<p class="small muted">Nessuna ricevuta.</p>'}
        ${fatture[p.id] ? `<h3 class="mt">🧾 Fattura</h3><pre class="fatt">${esc(fattText(fatture[p.id]))}</pre>` : ''}`;
      body.querySelector('#ps').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try { recs[p.id] = (await call(`${API}?action=set`, { playerId: p.id, plan: f.plan.value, exempt: f.exempt.checked, note: f.note.value }, code)).rec; toast('Salvato ✓'); close(); draw(); } catch (err) { toast(err.message, 4000); }
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
