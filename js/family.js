// Identità su questo telefono (giocatore o genitore) e funzioni comuni a documenti e pagamenti.
import { toast } from './util.js';

const LS = (k, v) => {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  } catch { return null; }
  return v;
};

/** Giocatore attivo: { id, pin } oppure, per un genitore, { id: figlio, pin: 'par:<genitore>:<pin>', parent: true } */
export const me = () => LS('mister-me');
/** Genitore collegato su questo telefono: { id, pin, email, name } */
export const parent = () => LS('mister-parent');

export function setParent(p, pin) {
  LS('mister-parent', { id: p.id, pin, email: p.email, name: `${p.firstName} ${p.lastName}` });
  LS('mister-parent-kids', p.children || []);
  const ok = (p.children || []).filter((c) => c.status === 'ok');
  const cur = me();
  if (ok.length && (!cur || !cur.parent || !ok.some((c) => c.playerId === cur.id))) setChild(ok[0].playerId);
  if (!ok.length && cur && cur.parent) LS('mister-me', null);
}
export const parentKids = () => LS('mister-parent-kids') || [];

/** Il genitore sceglie quale figlio seguire. */
export function setChild(playerId) {
  const p = parent();
  if (!p) return;
  LS('mister-me', { id: playerId, pin: `par:${p.id}:${p.pin}`, parent: true });
  localStorage.removeItem('mister-seen');
}

export function logoutParent() {
  LS('mister-parent', null);
  LS('mister-parent-kids', null);
  const cur = me();
  if (cur && cur.parent) LS('mister-me', null);
}

export async function call(url, body, admin) {
  let r;
  try {
    r = await fetch(url, body
      ? { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin-code': admin } : {}) }, body: JSON.stringify(body) }
      : { cache: 'no-store', headers: admin ? { 'x-admin-code': admin } : {} });
  } catch { throw new Error('Nessuna connessione.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `Errore ${r.status}`); e.status = r.status; throw e; }
  return d;
}

/** Richiesta a nome del giocatore attivo (giocatore con PIN o genitore collegato). */
export function asMe(api, action, body = {}) {
  const m = me();
  if (!m) throw new Error('Collega prima il profilo.');
  return call(`./api/${api}?action=${action}`, { ...body, playerId: m.id, pin: m.pin });
}

/** Foto ridotta (max 1800 px) o PDF così com'è → { mime, data (base64), name } */
export async function fileToPayload(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 3 * 1024 * 1024) throw new Error('PDF troppo grande (massimo 3 MB).');
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { mime: 'application/pdf', data: btoa(bin), name: file.name };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Immagine non leggibile: usa JPG, PNG o PDF.')); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.82);
    return { mime: 'image/jpeg', data: dataUrl.split(',')[1], name: (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg' };
  } finally { URL.revokeObjectURL(url); }
}

/** Chiede un file (foto, fotocamera o PDF). */
export function pickFile() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*,application/pdf';
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

/** Apre/scarica un documento ricevuto in base64. */
export function openDoc(item, b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: item.mime });
  const ext = item.mime === 'application/pdf' ? '.pdf' : '.jpg';
  const name = /\.[a-z0-9]{2,4}$/i.test(item.name) ? item.name : item.name + ext;
  const file = new File([blob], name, { type: item.mime });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/.test(navigator.userAgent)) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.target = '_blank';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('Documento scaricato');
}

export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const euro = (n) => `€ ${Number(n || 0).toLocaleString('it-IT')}`;
