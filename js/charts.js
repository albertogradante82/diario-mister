// Grafici SVG leggeri (nessuna libreria esterna, funzionano offline).
import { esc } from './util.js';

export const PALETTE = ['#2a7de1', '#e8590c', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#c2255c', '#5c7cfa'];

function niceMax(v) {
  if (!v || v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function fmtTick(v, isPct) {
  if (isPct) return `${Math.round(v * 100)}%`;
  if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10}k`;
  return (Math.round(v * 100) / 100).toLocaleString('it-IT');
}

/**
 * Grafico a linee. series: [{name, values:[n|null], color}], labels: [string]
 */
export function lineChart({ labels, series, height = 200, percent = false, empty = 'Nessun dato' }) {
  const all = series.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  if (!all.length) return `<div class="chart-empty">${esc(empty)}</div>`;
  const W = 340, H = height, L = 34, R = 10, T = 12, B = 28;
  const max = percent ? 1 : niceMax(Math.max(...all));
  const n = labels.length;
  const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${L - 4}" y="${y(v) + 3}" class="tick" text-anchor="end">${fmtTick(v, percent)}</text>`;
  }
  const step = Math.ceil(n / 7);
  labels.forEach((lb, i) => {
    if (i % step === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 8}" class="tick" text-anchor="middle">${esc(lb)}</text>`;
  });
  series.forEach((s, si) => {
    const c = s.color || PALETTE[si % PALETTE.length];
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    g += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.2" fill="${c}"><title>${esc(s.name)} · ${esc(labels[i])}: ${fmtTick(v, percent)}</title></circle>`;
    });
  });
  const legend = series.length > 1
    ? `<div class="legend">${series.map((s, i) => `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${legend}`;
}

/**
 * Barre raggruppate. groups: [string] (asse x), series: [{name, values, color}]
 */
export function barChart({ groups, series, height = 200, percent = false }) {
  const all = series.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  if (!all.length) return `<div class="chart-empty">Nessun dato</div>`;
  const W = 340, H = height, L = 34, R = 8, T = 12, B = 28;
  const max = percent ? 1 : niceMax(Math.max(...all));
  const gw = (W - L - R) / groups.length;
  const bw = Math.min(26, (gw * 0.8) / series.length);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${L - 4}" y="${y(v) + 3}" class="tick" text-anchor="end">${fmtTick(v, percent)}</text>`;
  }
  groups.forEach((lb, gi) => {
    const cx = L + gw * gi + gw / 2;
    const start = cx - (bw * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.values[gi];
      if (v == null || !Number.isFinite(v)) return;
      const c = s.color || PALETTE[si % PALETTE.length];
      g += `<rect x="${start + si * bw + 1}" y="${y(v)}" width="${bw - 2}" height="${Math.max(0, y(0) - y(v))}" rx="2" fill="${c}"><title>${esc(s.name)} · ${esc(lb)}: ${fmtTick(v, percent)}</title></rect>`;
    });
    g += `<text x="${cx}" y="${H - 8}" class="tick" text-anchor="middle">${esc(lb)}</text>`;
  });
  const legend = series.length > 1
    ? `<div class="legend">${series.map((s, i) => `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${legend}`;
}

/** Barre orizzontali con etichetta (classifiche). items: [{label, value, display}] */
export function hBars(items, { color = PALETTE[0], percent = false } = {}) {
  const vals = items.map((i) => i.value).filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return `<div class="chart-empty">Nessun dato</div>`;
  const max = percent ? 1 : Math.max(...vals) || 1;
  return `<div class="hbars">${items.map((i) => `
    <div class="hbar"><span class="hbar-label">${i.photoId ? `<span class="avatar hbar-av" data-rphoto="${esc(i.photoId)}">${esc(String(i.label).split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>` : ''}${esc(i.label)}</span>
      <span class="hbar-track"><span style="width:${i.value == null ? 0 : Math.max(2, (i.value / max) * 100)}%;background:${i.color || color}"></span></span>
      <span class="hbar-val">${esc(i.display ?? fmtTick(i.value ?? 0, percent))}</span></div>`).join('')}</div>`;
}

// ---------- Campo ----------

function pitchLines(L, W) {
  const box = Math.min(W * 0.6, 40.3), depth = Math.min(L * 0.16, 16.5);
  const r = Math.min(9.15, W * 0.13);
  return `<rect x="0" y="0" width="${L}" height="${W}" class="pitch-line"/>
    <line x1="${L / 2}" y1="0" x2="${L / 2}" y2="${W}" class="pitch-line"/>
    <circle cx="${L / 2}" cy="${W / 2}" r="${r}" class="pitch-line"/>
    <rect x="0" y="${(W - box) / 2}" width="${depth}" height="${box}" class="pitch-line"/>
    <rect x="${L - depth}" y="${(W - box) / 2}" width="${depth}" height="${box}" class="pitch-line"/>`;
}

function heatColor(v) {
  const hue = 220 - 220 * v; // blu -> rosso
  return `hsla(${hue},95%,50%,${0.15 + 0.7 * v})`;
}

/**
 * Heatmap sul campo. heatmap = {cols, rows, values:[...]} (valori qualsiasi, normalizzati qui).
 */
export function pitchHeatmap(heatmap, pitch = { length: 100, width: 64 }, { trail = null } = {}) {
  const L = pitch.length || 100, W = pitch.width || 64;
  let cells = '';
  if (heatmap && heatmap.values && heatmap.values.length) {
    const max = Math.max(...heatmap.values) || 1;
    const cw = L / heatmap.cols, ch = W / heatmap.rows;
    heatmap.values.forEach((v, i) => {
      const n = v / max;
      if (n < 0.03) return;
      const c = i % heatmap.cols, r = Math.floor(i / heatmap.cols);
      cells += `<rect x="${(c * cw).toFixed(2)}" y="${(r * ch).toFixed(2)}" width="${(cw + 0.05).toFixed(2)}" height="${(ch + 0.05).toFixed(2)}" fill="${heatColor(n)}"/>`;
    });
  }
  let path = '';
  if (trail && trail.length > 1) {
    path = `<polyline points="${trail.map((p) => `${p[1]},${p[2]}`).join(' ')}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${L / 300}"/>`;
  }
  const blurId = 'b' + Math.random().toString(36).slice(2, 7);
  return `<svg class="pitch" viewBox="-1 -1 ${L + 2} ${W + 2}" preserveAspectRatio="xMidYMid meet">
    <defs><filter id="${blurId}"><feGaussianBlur stdDeviation="${L / 70}"/></filter></defs>
    <rect x="-1" y="-1" width="${L + 2}" height="${W + 2}" class="pitch-grass"/>
    <g filter="url(#${blurId})">${cells}</g>${path}${pitchLines(L, W)}</svg>`;
}

/** Calcola una heatmap da posizioni [[t,x,y],...]. */
export function heatmapFromPositions(positions, pitch, cols = 24, rows = 16) {
  const values = new Array(cols * rows).fill(0);
  const L = pitch.length || 100, W = pitch.width || 64;
  for (const p of positions || []) {
    const c = Math.floor((p[1] / L) * cols), r = Math.floor((p[2] / W) * rows);
    if (c >= 0 && c < cols && r >= 0 && r < rows) values[r * cols + c]++;
  }
  return { cols, rows, values };
}

/** Somma più heatmap (anche con griglie diverse, ricampionando su 24x16). */
export function mergeHeatmaps(list, cols = 24, rows = 16) {
  const out = new Array(cols * rows).fill(0);
  for (const h of list) {
    if (!h || !h.values) continue;
    const max = Math.max(...h.values) || 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sc = Math.floor((c / cols) * h.cols), sr = Math.floor((r / rows) * h.rows);
        out[r * cols + c] += (h.values[sr * h.cols + sc] || 0) / max;
      }
    }
  }
  return { cols, rows, values: out };
}
