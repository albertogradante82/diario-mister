// Area mister: documenti, pagamenti e fattura del singolo ragazzo (nella scheda aperta dalla Rosa).
import * as db from '../db.js';
import { esc, toast, sheet, confirmDialog, fmtDate, today } from '../util.js';
import { call, euro } from '../family.js';
import { docRow, bindDocRows, KINDS } from './docs.js';
import { payStatus } from './payments.js';

const RLABEL = { unica: 'Rata unica', r1: '1ª rata', r2: '2ª rata' };
let cache = null, cacheAt = 0;

/** Documenti e pagamenti di tutti (una richiesta, valida 30 s). */
export async function adminData(fresh = false) {
  const code = await db.getMeta('clubCode');
  if (!code) return null;
  if (!fresh && cache && Date.now() - cacheAt < 30000) return { ...cache, code };
  const [docs, pay] = await Promise.all([call('./api/documenti?action=list', null, code), call('./api/pagamenti?action=list', null, code)]);
  cache = { docs: docs.items, ...pay };
  cacheAt = Date.now();
  return { ...cache, code };
}

/** Riassunto per le card della rosa: { doc, cert, pay } */
export function quickStatus(d, p) {
  const td = today();
  const ds = d.docs.filter((x) => x.playerId === p.id);
  const cert = ds.filter((x) => x.kind === 'certificato').sort((a, b) => (b.expiry || '').localeCompare(a.expiry || ''))[0];
  const st = payStatus(d.conf, d.recs[p.id], p.teamId);
  return {
    id: ds.some((x) => x.kind === 'identita'),
    cert: !cert ? 'no' : cert.expiry && cert.expiry < td ? 'scaduto' : 'ok',
    pay: st.exempt ? 'esente' : st.done ? 'ok' : st.overdue ? 'scaduto' : 'aperto',
  };
}

export async function adminPlayerCard(box, p) {
  let d;
  try { d = await adminData(true); } catch (e) { box.innerHTML = `<div class="card small warn">Documenti e pagamenti: ${esc(e.message)}</div>`; return; }
  if (!d) { box.innerHTML = '<div class="card small muted">🔒 Documenti e pagamenti: entra con la password del mister.</div>'; return; }
  const { code } = d;
  const td = today();
  const ds = d.docs.filter((x) => x.playerId === p.id);
  const st = payStatus(d.conf, d.recs[p.id], p.teamId);
  const fatt = d.fatture[p.id];
  const cert = ds.filter((x) => x.kind === 'certificato').sort((a, b) => (b.expiry || '').localeCompare(a.expiry || ''))[0];
  const docsOf = (k) => ds.filter((x) => x.kind === k);
  box.innerHTML = `
    <h2 class="section">📄 Documenti</h2>
    <div class="card">
      <div class="small">${ds.some((x) => x.kind === 'identita') ? '<span class="ok">🪪 Documento d\'identità ✓</span>' : '<span class="warn">🪪 Documento d\'identità mancante</span>'}</div>
      <div class="small">${!cert ? '<span class="warn">🩺 Certificato medico mancante</span>' : cert.expiry && cert.expiry < td ? `<span class="ko">🩺 Certificato scaduto il ${esc(fmtDate(cert.expiry))}</span>` : `<span class="ok">🩺 Certificato valido${cert.expiry ? ' fino al ' + esc(fmtDate(cert.expiry)) : ''}</span>`}</div>
      ${KINDS.map(([k, icon, label]) => docsOf(k).length ? `<div class="small muted mt">${icon} ${label}</div><div class="list">${docsOf(k).map((x) => docRow(x, true)).join('')}</div>` : '').join('')}
      ${!ds.filter((x) => x.kind !== 'pagamento').length ? '<p class="small muted mt">Nessun documento caricato. Li caricano il ragazzo o i genitori da Altro → Documenti.</p>' : ''}
    </div>
    <h2 class="section">💶 Pagamenti</h2>
    <div class="card">
      ${st.exempt ? '<p class="ok">✓ Esonerato dalla quota</p>' : `
        <div class="small muted">${d.recs[p.id]?.plan === 'unica' ? 'Rata unica' : d.recs[p.id]?.plan === 'rate' ? 'Due rate' : 'Modalità non ancora scelta (mostrate due rate)'} · pagato <b class="ok">${euro(st.paid)}</b> su ${euro(st.total)}</div>
        <div class="pay-chips mt">${st.list.map((r) => `<button class="pay-chip ${r.paid ? 'paid' : r.overdue ? 'overdue' : ''}" data-mk="${r.key}">${r.paid ? '✓' : r.overdue ? '!' : '○'} ${RLABEL[r.key]} ${euro(r.amount)}${r.paid ? ' · ' + esc(fmtDate(r.paid.date)) : ' · entro ' + esc(fmtDate(r.due))}</button>`).join('')}</div>
        <p class="small muted">Tocca una rata per segnarla pagata o togliere il segno.</p>`}
      ${docsOf('pagamento').length ? `<div class="small muted mt">📎 Ricevute caricate</div><div class="list">${docsOf('pagamento').map((x) => docRow({ ...x, name: `${x.name}${x.rata ? ' (' + RLABEL[x.rata] + ')' : ''}` }, true)).join('')}</div>` : ''}
      ${fatt ? `<div class="small muted mt">🧾 Richiesta fattura (${esc(fatt.by)})</div><pre class="fatt">${esc([fatt.intestatario, fatt.codiceFiscale && 'C.F. ' + fatt.codiceFiscale, fatt.partitaIva && 'P.IVA ' + fatt.partitaIva, fatt.indirizzo, [fatt.cap, fatt.citta, fatt.provincia && `(${fatt.provincia})`].filter(Boolean).join(' '), fatt.email, fatt.pec && 'PEC ' + fatt.pec, fatt.sdi && 'SDI ' + fatt.sdi].filter(Boolean).join('\n'))}</pre>` : '<p class="small muted mt">🧾 Nessuna richiesta di fattura.</p>'}
      <a class="btn small mt" href="#/pagamenti">Tutti i pagamenti ›</a>
    </div>`;
  bindDocRows(box, ds, (id) => call('./api/documenti?action=get', { docId: id }, code), (id) => call('./api/documenti?action=delete', { docId: id }, code));
  box.querySelectorAll('[data-mk]').forEach((b) => (b.onclick = async () => {
    const key = b.dataset.mk;
    const r = st.list.find((x) => x.key === key);
    try {
      if (r.paid) {
        if (!(await confirmDialog(`Togliere "pagata" a ${RLABEL[key]}?`, 'Togli', true))) return;
        await call('./api/pagamenti?action=mark', { playerId: p.id, key, paid: false }, code);
      } else {
        const ok = await sheet(RLABEL[key], (body, close) => {
          body.innerHTML = `<form class="form" id="mk"><div class="row gap"><label class="grow">Importo €<input name="amount" type="number" value="${r.amount}"></label>
            <label class="grow">Data<input name="date" type="date" value="${today()}"></label></div>
            <label>Metodo<select name="method"><option>Bonifico</option><option>Contanti</option><option>POS / carta</option><option>Altro</option></select></label>
            <button class="btn primary block mt">✅ Segna pagata</button></form>`;
          body.querySelector('#mk').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); close(Object.fromEntries(f)); };
        });
        if (!ok) return;
        await call('./api/pagamenti?action=mark', { playerId: p.id, key, paid: true, ...ok }, code);
        toast('Pagamento registrato ✓');
      }
      adminPlayerCard(box, p);
    } catch (e) { toast(e.message, 4000); }
  }));
}
