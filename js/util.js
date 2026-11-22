// Utilità condivise: escaping HTML, finestre modali, file, formattazione.

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Collega un handler a tutti gli elementi con data-action="name". */
export function on(root, action, fn, ev = 'click') {
  $$(`[data-action="${action}"]`, root).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
}

export function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach((old) => old.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

/**
 * Pannello dal basso. `build(body, close)` riempie il contenuto;
 * la promessa si risolve con il valore passato a close().
 */
export function sheet(title, build) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><strong>${esc(title)}</strong><button class="btn-text" data-close>Chiudi</button></div>
      <div class="sheet-body"></div></div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      back.classList.remove('show');
      setTimeout(() => back.remove(), 250);
      resolve(val);
    };
    back.addEventListener('click', (e) => { if (e.target === back) close(undefined); });
    back.querySelector('[data-close]').addEventListener('click', () => close(undefined));
    build(back.querySelector('.sheet-body'), close);
  });
}

export function confirmDialog(message, okLabel = 'Conferma', danger = false) {
  return sheet('Conferma', (body, close) => {
    body.innerHTML = `<p class="mb" style="white-space:pre-line">${esc(message)}</p>
      <div class="row gap"><button class="btn grow" data-no>Annulla</button>
      <button class="btn grow ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`;
    body.querySelector('[data-no]').onclick = () => close(false);
    body.querySelector('[data-yes]').onclick = () => close(true);
  }).then((v) => !!v);
}

/** Scelta da elenco di opzioni {value,label,sub?}. */
export function pick(title, options, { columns = 1 } = {}) {
  return sheet(title, (body, close) => {
    body.innerHTML = `<div class="pick-grid" style="--cols:${columns}">${options.map((o, i) =>
      `<button class="pick ${o.cls || ''}" data-i="${i}"><span>${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('')}</div>`;
    $$('[data-i]', body).forEach((b) => (b.onclick = () => close(options[+b.dataset.i].value)));
  });
}

/** Condivide (iPhone) o scarica un file. */
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function chooseFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

export function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

/** Ridimensiona una foto a JPEG quadrato (data URL) per il profilo. */
export function resizeImage(file, size = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
    img.src = url;
  });
}

export function fmtDate(d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  return new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('it-IT', opts);
}

export function shortDate(d) {
  return fmtDate(d, { day: '2-digit', month: '2-digit' });
}

export function clock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export function num(v, digits = 0) {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return '–';
  return Number(v).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(v) {
  return v == null || !Number.isFinite(v) ? '–' : `${Math.round(v * 100)}%`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function age(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

export function initials(p) {
  return ((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || '');
}

export function fullName(p) {
  return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Senza nome' : 'Sconosciuto';
}

export function avatar(p, size = 44) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
  return p && p.photo
    ? `<img class="avatar" style="${st}" src="${esc(p.photo)}" alt="">`
    : `<span class="avatar" style="${st}">${esc(p && p.number != null && p.number !== '' ? p.number : initials(p || {}))}</span>`;
}

export const ROLES = ['Portiere', 'Difensore', 'Centrocampista', 'Attaccante'];
export const FEET = ['Destro', 'Sinistro', 'Ambidestro'];
