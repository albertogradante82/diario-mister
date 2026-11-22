// Video della partita: link per tempo (1°, 2°, 3°…), in ordine, solo per il mister.
import * as db from '../db.js';
import { esc, fmtDate, toast, sheet, confirmDialog, $, $$ } from '../util.js';
import { setHeader, route } from '../app.js';

const API = './api/video';
const STATUS = { 'da analizzare': ['⏳', 'Da analizzare'], 'in analisi': ['🔍', 'In analisi'], analizzata: ['✅', 'Analizzata'] };

async function call(url, code, opts = {}) {
  let r;
  try { r = await fetch(url, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'application/json', 'x-admin-code': code, ...(opts.headers || {}) } }); }
  catch { throw new Error('Nessuna connessione.'); }
  let d = {};
  try { d = await r.json(); } catch { /* */ }
  if (!r.ok) { const e = new Error(d.error || `Errore ${r.status}`); e.status = r.status; throw e; }
  return d;
}
export const listVideos = async (code) => (await call(`${API}?action=list`, code)).items || [];
const save = (code, item) => call(`${API}?action=save`, code, { method: 'POST', body: JSON.stringify(item) });

function source(url) {
  if (/dropbox\.com/i.test(url)) return ['📦', 'Dropbox'];
  if (/drive\.google|docs\.google/i.test(url)) return ['🟢', 'Google Drive'];
  if (/youtu\.?be/i.test(url)) return ['▶️', 'YouTube'];
  if (/wetransfer|we\.tl/i.test(url)) return ['📨', 'WeTransfer'];
  if (/icloud/i.test(url)) return ['☁️', 'iCloud'];
  return ['🔗', 'Link'];
}
const PERIOD = (n) => `${n}° tempo`;

/** Riquadro "Video della partita" dentro la scheda partita (mister). */
export async function videoCard(el, match) {
  const code = await db.getMeta('clubCode');
  if (!code) { el.innerHTML = ''; return; }
  let item = null;
  try { item = (await listVideos(code)).find((v) => v.matchId === match.id) || null; } catch (e) {
    el.innerHTML = `<div class="card small muted">🎬 Video: ${esc(e.message)}</div>`;
    return;
  }
  const n = Math.max(match.periodsCount || 2, ...(item?.parts || []).map((p) => p.period));
  const parts = item?.parts || [];
  const st = STATUS[item?.status || 'da analizzare'];
  el.innerHTML = `<div class="card video-card">
    <div class="row center"><h3 class="grow">🎬 Video della partita</h3>${parts.length ? `<span class="badge">${st[0]} ${st[1]}</span>` : ''}</div>
    ${Array.from({ length: n }, (_, i) => {
      const per = i + 1;
      const list = parts.filter((p) => p.period === per);
      return `<div class="video-period"><div class="small muted"><strong>${PERIOD(per)}</strong>${list.length > 1 ? ` · ${list.length} parti in ordine` : ''}</div>
        ${list.map((p, k) => {
          const [ic, src] = source(p.url);
          return `<div class="video-row"><span class="video-n">${k + 1}</span>
            <a class="grow video-link" href="${esc(p.url)}" target="_blank" rel="noopener">${ic} ${esc(p.label || `${PERIOD(per)} – parte ${k + 1}`)}<small>${src}</small></a>
            <button class="btn-text small" data-up="${p.id}" ${k === 0 ? 'disabled' : ''} aria-label="Su">▲</button>
            <button class="btn-text small" data-down="${p.id}" ${k === list.length - 1 ? 'disabled' : ''} aria-label="Giù">▼</button>
            <button class="btn-text small danger" data-rm="${p.id}" aria-label="Elimina">✕</button></div>`;
        }).join('')}
        <button class="btn small block" data-add="${per}">＋ Aggiungi link ${PERIOD(per)}</button></div>`;
    }).join('')}
    <div class="row gap mt">${n < 4 ? '<button class="btn-text small" id="addper">＋ Aggiungi un tempo</button>' : ''}<span class="grow"></span>
      ${parts.length ? `<select id="vstatus" class="small" style="width:auto">${Object.entries(STATUS).map(([k, [i, l]]) => `<option value="${k}" ${k === (item?.status || 'da analizzare') ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select>` : ''}</div>
    <p class="small muted mt">Carica i video su Dropbox o Google Drive (consigliato per l'analisi) o YouTube "non in elenco" e incolla qui il link di condivisione. Se un tempo è diviso in più file, aggiungili in ordine.</p>
  </div>`;

  const base = () => ({ matchId: match.id, teamId: match.teamId, date: match.date, title: match.home === false ? `${match.opponent} – Palazzo` : `Palazzo – ${match.opponent}`,
    status: item?.status || 'da analizzare', note: item?.note || '' });
  const persist = async (newParts, extra = {}) => {
    try { await save(code, { ...base(), ...extra, parts: newParts }); videoCard(el, { ...match, periodsCount: extra.periods || n }); }
    catch (e) { toast(e.message, 4000); }
  };
  const ordered = () => [...parts];

  $$('[data-add]', el).forEach((b) => (b.onclick = async () => {
    const per = Number(b.dataset.add);
    const res = await sheet(`Link video · ${PERIOD(per)}`, (body, close) => {
      body.innerHTML = `<form class="form" id="vf">
        <label>Link di condivisione<input name="url" type="url" required placeholder="https://www.dropbox.com/…" autocomplete="off"></label>
        <label>Descrizione (facoltativa)<input name="label" maxlength="80" placeholder="es. ${PERIOD(per)} – parte ${parts.filter((p) => p.period === per).length + 1}"></label>
        <button class="btn primary block">Aggiungi</button></form>`;
      body.querySelector('#vf').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); close({ url: f.get('url').trim(), label: f.get('label').trim() }); };
    });
    if (!res) return;
    if (!/^https?:\/\//i.test(res.url)) { toast('Il link deve iniziare con https://'); return; }
    await persist([...ordered(), { period: per, url: res.url, label: res.label, addedAt: Date.now() }]);
    toast('Link aggiunto 🎬');
  }));
  const move = async (id, dir) => {
    const list = ordered();
    const i = list.findIndex((p) => p.id === id);
    const per = list[i].period;
    let j = i + dir;
    while (j >= 0 && j < list.length && list[j].period !== per) j += dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await persist(list);
  };
  $$('[data-up]', el).forEach((b) => (b.onclick = () => move(b.dataset.up, -1)));
  $$('[data-down]', el).forEach((b) => (b.onclick = () => move(b.dataset.down, 1)));
  $$('[data-rm]', el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('Togliere questo link?', 'Togli', true))) return;
    await persist(ordered().filter((p) => p.id !== b.dataset.rm));
  }));
  const ap = $('#addper', el);
  if (ap) ap.onclick = () => videoCard(el, { ...match, periodsCount: n + 1 });
  const vs = $('#vstatus', el);
  if (vs) vs.onchange = () => persist(ordered(), { status: vs.value });
}

/** Elenco di tutte le partite con video (mister). */
export async function videoListView(root) {
  setHeader({ title: 'Video partite', back: '#/home' });
  const code = await db.getMeta('clubCode');
  if (!code) { root.innerHTML = '<div class="card">Entra come mister con la password.</div>'; return; }
  let items = [];
  try { items = await listVideos(code); } catch (e) { root.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const teams = Object.fromEntries((await db.all('teams')).map((t) => [t.id, t.name]));
  root.innerHTML = items.length ? `<div class="list">${items.map((v) => {
    const st = STATUS[v.status] || STATUS['da analizzare'];
    const per = [...new Set(v.parts.map((p) => p.period))].sort();
    return `<a class="item" href="#/partita/${esc(v.matchId)}"><span style="font-size:24px">🎬</span>
      <div class="grow"><strong>${esc(v.title)}</strong><div class="muted small">${esc(teams[v.teamId] || '')}${v.date ? ' · ' + esc(fmtDate(v.date)) : ''} · ${per.map((p) => `${p}°T (${v.parts.filter((x) => x.period === p).length})`).join(', ')}</div></div>
      <span class="badge">${st[0]} ${st[1]}</span></a>`;
  }).join('')}</div>` : '<div class="empty"><div class="empty-icon">🎬</div><p>Nessun video caricato. Aprilo dalla scheda di una partita.</p></div>';
}
