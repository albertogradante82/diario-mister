// Documenti del giocatore (identità, certificato medico, altri): li caricano giocatore o genitore, li scarica il mister.
import * as db from '../db.js';
import { esc, toast, sheet, confirmDialog, fmtDate, today, fullName, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';
import { me, parent, asMe, call, fileToPayload, pickFile, openDoc, fmtSize } from '../family.js';
import { publicData } from './board.js';

export const KINDS = [
  ['identita', '🪪', 'Documento d\'identità', 'Carta d\'identità o passaporto, fronte e retro.'],
  ['certificato', '🩺', 'Certificato medico', 'Certificato di idoneità sportiva: indica la scadenza.'],
  ['altro', '📎', 'Altri documenti', 'Tessera sanitaria, permessi, moduli firmati…'],
];

export function needIdentity(root, what) {
  root.innerHTML = `<div class="card"><p><strong>Chi sei?</strong></p>
    <p class="small muted">Per ${what} collega il tuo profilo giocatore (dalla Bacheca) oppure entra nell'Area genitori.</p>
    <a class="btn primary block mt" href="#/g/bacheca">🔗 Sono il giocatore</a>
    <a class="btn block mt" href="#/g/genitore">👨‍👩‍👧 Sono un genitore</a></div>`;
}

/** Nome del giocatore attivo (con "Genitore di" se è un genitore). */
export async function whoLine() {
  const m = me();
  let name = '';
  try { name = (await publicData()).players.find((p) => p.id === m.id)?.name || ''; } catch { /* */ }
  return m.parent ? `👨‍👩‍👧 ${esc(parent()?.name || 'Genitore')} · per <strong>${esc(name)}</strong> <a class="small" href="#/g/genitore">cambia</a>` : `👤 <strong>${esc(name)}</strong>`;
}

/** Carica un file per il giocatore attivo. */
export async function uploadFlow(kind, extra = {}) {
  const file = await pickFile();
  if (!file) return false;
  let payload;
  try { payload = await fileToPayload(file); } catch (e) { toast(e.message, 4000); return false; }
  let meta = { name: payload.name, expiry: '', note: '' };
  if (kind === 'certificato' || kind === 'altro') {
    meta = await sheet(kind === 'certificato' ? 'Certificato medico' : 'Documento', (body, close) => {
      body.innerHTML = `<form class="form" id="mf">
        <label>Nome<input name="name" maxlength="80" value="${esc(kind === 'certificato' ? 'Certificato medico' : payload.name.replace(/\.[^.]+$/, ''))}"></label>
        ${kind === 'certificato' ? '<label>Scadenza del certificato<input type="date" name="expiry" required></label>' : ''}
        <label>Note <span class="muted">(facoltative)</span><input name="note" maxlength="200"></label>
        <button class="btn primary block mt">Carica</button></form>`;
      body.querySelector('#mf').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); close({ name: f.get('name'), expiry: f.get('expiry') || '', note: f.get('note') || '' }); };
    });
    if (!meta) return false;
  }
  toast('Caricamento…', 8000);
  try { await asMe('documenti', 'upload', { kind, ...payload, ...meta, ...extra }); toast('Documento caricato ✓ Il mister può scaricarlo'); return true; }
  catch (e) { toast(e.message, 5000); return false; }
}

export async function playerDocsView(root) {
  setHeader({ title: 'Documenti', back: '#/g/altro' });
  if (!me()) return needIdentity(root, 'caricare i documenti');
  let items;
  try { items = (await asMe('documenti', 'list')).items; } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const td = today();
  root.innerHTML = `<div class="card small">${await whoLine()}</div>
    ${KINDS.map(([k, icon, label, help]) => {
      const list = items.filter((d) => d.kind === k);
      const cert = k === 'certificato' ? list.find((d) => d.expiry) : null;
      return `<h2 class="section">${icon} ${label}</h2>
        ${k === 'certificato' ? `<div class="card small ${!cert ? 'warn-card' : cert.expiry < td ? 'warn-card' : 'cert-card'}">${!cert ? '⚠️ Certificato medico non ancora caricato.' : cert.expiry < td ? `⚠️ Certificato <strong>scaduto</strong> il ${esc(fmtDate(cert.expiry))}: caricane uno nuovo.` : `✓ Valido fino al <strong>${esc(fmtDate(cert.expiry))}</strong>`}</div>` : ''}
        ${list.length ? `<div class="list">${list.map((d) => docRow(d, true)).join('')}</div>` : `<p class="small muted">${help}</p>`}
        <button class="btn block" data-up="${k}">📤 Carica ${k === 'identita' ? 'documento' : k === 'certificato' ? 'certificato' : 'un documento'}</button>`;
    }).join('')}
    <p class="small muted mt">🔒 I documenti li vedete solo voi (giocatore e genitori collegati) e il mister. Foto o PDF fino a 3 MB: puoi anche fotografarli con il telefono.</p>`;
  $$('[data-up]', root).forEach((b) => (b.onclick = async () => { if (await uploadFlow(b.dataset.up)) route(); }));
  bindDocRows(root, items, (id) => asMe('documenti', 'get', { docId: id }), (id) => asMe('documenti', 'delete', { docId: id }));
}

export function docRow(d, canDelete) {
  return `<div class="item"><span style="font-size:22px">${d.mime === 'application/pdf' ? '📕' : '🖼️'}</span>
    <div class="grow"><strong>${esc(d.name)}</strong>
      <div class="muted small">${esc(fmtDate(new Date(d.at).toISOString().slice(0, 10)))} · ${esc(fmtSize(d.size))} · ${esc(d.by || '')}${d.expiry ? ` · scade il ${esc(fmtDate(d.expiry))}` : ''}</div>
      ${d.note ? `<div class="small">${esc(d.note)}</div>` : ''}</div>
    <button class="btn small" data-open="${d.id}">Apri</button>${canDelete ? `<button class="btn-text small danger" data-ddel="${d.id}" aria-label="Elimina">✕</button>` : ''}</div>`;
}

export function bindDocRows(root, items, get, del) {
  $$('[data-open]', root).forEach((b) => (b.onclick = async () => {
    b.disabled = true; b.textContent = '…';
    try { const r = await get(b.dataset.open); openDoc(r.item, r.data); } catch (e) { toast(e.message, 4000); }
    b.disabled = false; b.textContent = 'Apri';
  }));
  $$('[data-ddel]', root).forEach((b) => (b.onclick = async () => {
    const d = items.find((x) => x.id === b.dataset.ddel);
    if (!(await confirmDialog(`Eliminare "${d.name}"?`, 'Elimina', true))) return;
    try { await del(d.id); toast('Eliminato'); route(); } catch (e) { toast(e.message, 4000); }
  }));
}

// ---------- Area mister ----------

export async function misterDocsView(root) {
  setHeader({ title: 'Documenti giocatori', back: '#/home' });
  const code = await db.getMeta('clubCode');
  if (!code) { root.innerHTML = '<div class="empty"><p>Rientra come mister con la password.</p></div>'; return; }
  let items;
  try { items = (await call('./api/documenti?action=list', null, code)).items.filter((d) => d.kind !== 'pagamento'); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const [teams, players] = await Promise.all([db.all('teams'), db.all('players')]);
  teams.sort((a, b) => a.name.localeCompare(b.name));
  let sel = sessionStorage.getItem('docTeam') || teams[0]?.id;
  const td = today();
  const byP = {};
  items.forEach((d) => (byP[d.playerId] = byP[d.playerId] || []).push(d));
  const draw = () => {
    const list = players.filter((p) => p.teamId === sel).sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const status = (p) => {
      const ds = byP[p.id] || [];
      const cert = ds.filter((d) => d.kind === 'certificato').sort((a, b) => (b.expiry || '').localeCompare(a.expiry || ''))[0];
      return { ds, id: ds.some((d) => d.kind === 'identita'), cert, certOk: cert && (!cert.expiry || cert.expiry >= td) };
    };
    const st = list.map(status);
    root.innerHTML = `
      <div class="chips mb">${teams.map((t) => `<button class="chip-btn ${t.id === sel ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      <div class="tiles mb"><div class="tile"><b>${st.filter((s) => s.id).length}/${list.length}</b><small>🪪 documento</small></div>
        <div class="tile"><b>${st.filter((s) => s.certOk).length}/${list.length}</b><small>🩺 certificato valido</small></div>
        <div class="tile"><b class="${st.filter((s) => s.cert && !s.certOk).length ? 'ko' : ''}">${st.filter((s) => s.cert && !s.certOk).length}</b><small>certificati scaduti</small></div></div>
      <div class="list">${list.map((p, i) => {
        const s = st[i];
        return `<button class="item" data-p="${p.id}"><span class="avatar" data-rphoto="${p.id}">${esc(((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || ''))}</span>
          <div class="grow"><strong>${esc(fullName(p))}</strong>
            <div class="small">${s.id ? '<span class="ok">🪪 ✓</span>' : '<span class="muted">🪪 —</span>'} · ${!s.cert ? '<span class="muted">🩺 —</span>' : s.certOk ? `<span class="ok">🩺 fino al ${esc(fmtDate(s.cert.expiry))}</span>` : `<span class="ko">🩺 scaduto ${esc(fmtDate(s.cert.expiry))}</span>`}${s.ds.filter((d) => d.kind === 'altro').length ? ` · 📎 ${s.ds.filter((d) => d.kind === 'altro').length}` : ''}</div></div>
          <span class="chev">›</span></button>`;
      }).join('') || '<p class="muted">Nessun giocatore.</p>'}</div>
      <p class="small muted mt">I documenti li caricano i ragazzi o i genitori da Altro → Documenti.</p>`;
    import('../profiles.js').then((m) => m.fillPhotos(root));
    $$('[data-t]', root).forEach((b) => (b.onclick = () => { sel = b.dataset.t; sessionStorage.setItem('docTeam', sel); draw(); }));
    $$('[data-p]', root).forEach((b) => (b.onclick = () => {
      const p = players.find((x) => x.id === b.dataset.p);
      const ds = byP[p.id] || [];
      sheet(fullName(p), (body) => {
        body.innerHTML = ds.length ? KINDS.map(([k, icon, label]) => {
          const l = ds.filter((d) => d.kind === k);
          return l.length ? `<h3>${icon} ${label}</h3><div class="list">${l.map((d) => docRow(d, true)).join('')}</div>` : '';
        }).join('') : '<p class="muted">Nessun documento caricato.</p>';
        bindDocRows(body, ds, (id) => call('./api/documenti?action=get', { docId: id }, code), (id) => call('./api/documenti?action=delete', { docId: id }, code));
      });
    }));
  };
  draw();
}
