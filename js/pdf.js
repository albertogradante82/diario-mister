// Scheda giocatore in PDF, generata sul dispositivo con jsPDF (caricato solo quando serve).
import { fullName, fmtDate, shortDate, num, pct, age, shareOrDownload } from './util.js';
import { per90, METRICS } from './stats.js';

let loading;
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  loading = loading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './vendor/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf);
    s.onerror = () => reject(new Error('Libreria PDF non disponibile'));
    document.head.appendChild(s);
  });
  return loading;
}

// jsPDF con i font standard non gestisce bene alcuni caratteri: li sostituisco.
function t(s) {
  return String(s ?? '').replace(/[′’]/g, "'").replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/…/g, '...').replace(/→/g, '->').replace(/[^\x20-\xFF\n]/g, '');
}

export async function exportPlayerPdf({ player: p, team, season, rows, totals: tot, trends, heat, pitch }) {
  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;
  const blue = [42, 125, 225], gray = [110, 110, 120], dark = [25, 25, 30];
  let y = 0;

  const ensure = (h) => { if (y + h > 285) { doc.addPage(); y = 16; } };
  const h2 = (text) => {
    ensure(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...blue);
    doc.text(t(text), M, y);
    doc.setDrawColor(...blue); doc.setLineWidth(0.3); doc.line(M, y + 1.5, W - M, y + 1.5);
    y += 7;
    doc.setTextColor(...dark); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  };

  // Intestazione
  doc.setFillColor(...blue);
  doc.rect(0, 0, W, 36, 'F');
  let tx = M;
  if (p.photo) {
    try { doc.addImage(p.photo, 'JPEG', M, 5, 26, 26); tx = M + 31; } catch { /* foto non valida */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text(t(fullName(p)), tx, 16);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(t([p.number !== '' && p.number != null ? `#${p.number}` : '', p.role, p.foot ? `piede ${p.foot.toLowerCase()}` : ''].filter(Boolean).join('  ·  ')), tx, 23);
  doc.text(t(`${team?.name || ''}  ·  Stagione ${season?.name || ''}`), tx, 29);
  doc.setFontSize(8);
  doc.text(t(`Generato il ${new Date().toLocaleDateString('it-IT')}`), W - M, 33, { align: 'right' });
  y = 46;

  // Anagrafica
  const info = [
    ['Data di nascita', p.birthDate ? `${fmtDate(p.birthDate)} (${age(p.birthDate)} anni)` : ''],
    ['Luogo di nascita', p.birthPlace], ['Altezza', p.height ? `${p.height} cm` : ''], ['Peso', p.weight ? `${p.weight} kg` : ''],
    ['Posizione', p.position], ['Visita medica', p.medicalExpiry ? `scade il ${fmtDate(p.medicalExpiry)}` : ''],
    ...(team?.customFields || []).map((c) => [c.name, (p.custom || {})[c.id]]),
  ].filter(([, v]) => v != null && v !== '');
  if (info.length) {
    h2('Dati anagrafici');
    info.forEach(([k, v], i) => {
      const col = i % 2, x = M + col * 92;
      if (col === 0 && i > 0) y += 5.5;
      ensure(6);
      doc.setTextColor(...gray); doc.text(t(k), x, y);
      doc.setTextColor(...dark); doc.text(t(v), x + 32, y);
    });
    y += 9;
  }

  // Riepilogo stagione
  h2('Riepilogo stagione');
  const tiles = [
    ['Presenze', tot.presenze], ['Titolare', tot.titolare], ['Minuti', Math.round(tot.minuti)], ['Gol', tot.gol],
    ['Assist', tot.assist], ['Tiri (in porta)', `${tot.tiri} (${tot.tiriPorta})`], ['Passaggi ok/tot', `${tot.passaggiOk}/${tot.passaggi}`], ['Precisione', pct(tot.precisione)],
    ['Recuperi', tot.recuperi], ['Palle perse', tot.perse],
    ...(tot.distanza != null ? [['Km totali', num(tot.distanza / 1000, 1)], ['Vel. max km/h', num(tot.velMax, 1)]] : []),
  ];
  const tw = (W - 2 * M - 9) / 4;
  tiles.forEach(([l, v], i) => {
    const col = i % 4;
    if (col === 0 && i > 0) y += 15;
    ensure(15);
    const x = M + col * (tw + 3);
    doc.setFillColor(240, 244, 250); doc.roundedRect(x, y - 4, tw, 13, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...dark);
    doc.text(t(String(v)), x + 3, y + 2.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
    doc.text(t(l), x + 3, y + 7);
  });
  y += 17;
  doc.setFontSize(9.5); doc.setTextColor(...dark);

  // Per 90
  h2('Valori per 90 minuti');
  const p90 = ['gol', 'assist', 'tiri', 'passaggiOk', 'recuperi', 'perse', ...(tot.distanza != null ? ['distanza'] : [])];
  const p90lines = doc.splitTextToSize(t(p90.map((k) => `${METRICS[k].label}: ${num(per90(tot, k, 1), k === 'distanza' ? 0 : 2)}`).join('   ·   ')), W - 2 * M);
  p90lines.forEach((ln) => { doc.text(ln, M, y); y += 4.8; });
  if (tot.minuti < 90) { doc.setTextColor(...gray); doc.text(t('Meno di 90 minuti giocati: valori poco indicativi.'), M, y); doc.setTextColor(...dark); y += 4.8; }
  y += 4;

  // Grafico andamento (minuti e gol+assist)
  const played = rows.filter((r) => r.players[p.id] && r.players[p.id].minuti > 0);
  if (played.length > 1) {
    h2('Andamento: minuti giocati e precisione passaggi');
    ensure(48);
    drawLineChart(doc, M, y, W - 2 * M, 40, played.map((r) => shortDate(r.match.date)), [
      { values: played.map((r) => r.players[p.id].minuti), color: blue, max: Math.max(...played.map((r) => r.players[p.id].minuti), 1) },
      { values: played.map((r) => r.players[p.id].precisione), color: [232, 89, 12], max: 1 },
    ]);
    doc.setFontSize(7.5);
    doc.setTextColor(...blue); doc.text(t('- minuti'), M, y + 46);
    doc.setTextColor(232, 89, 12); doc.text(t('- precisione passaggi (0-100%)'), M + 20, y + 46);
    doc.setTextColor(...dark); doc.setFontSize(9.5);
    y += 52;
  }

  // Tendenze
  if (trends && trends.length) {
    h2('Tendenze ultime 3 partite');
    trends.forEach((tr) => {
      ensure(6);
      doc.setTextColor(...(tr.better ? [47, 158, 68] : [201, 42, 42]));
      doc.text(t(`${tr.better ? '+' : '-'} ${tr.label}: ${tr.text}`), M, y);
      y += 5.5;
    });
    doc.setTextColor(...dark);
    y += 3;
  }

  // Heatmap
  if (heat && heat.values && heat.values.some((v) => v > 0)) {
    const L = pitch?.length || 100, Wd = pitch?.width || 64;
    const pw = 110, ph = (pw * Wd) / L;
    ensure(ph + 16);
    h2('Mappa di calore (somma partite con tracking)');
    drawHeat(doc, M, y, pw, ph, heat);
    y += ph + 8;
  }

  // Tabella partite
  h2('Partite');
  const cols = [['Data', 18], ['Avversario', 46], ['Min', 12], ['Gol', 11], ['Ast', 11], ['Tiri', 13], ['Pass', 18], ['Rec', 12], ['Perse', 13], ['Metri', 16]];
  const header = () => {
    let x = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...gray);
    cols.forEach(([c, w]) => { doc.text(c, x, y); x += w; });
    y += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...dark);
  };
  header();
  played.forEach((r, i) => {
    if (y > 280) { doc.addPage(); y = 16; header(); }
    const l = r.players[p.id];
    if (i % 2 === 0) { doc.setFillColor(246, 247, 250); doc.rect(M - 1, y - 3.4, W - 2 * M + 2, 4.8, 'F'); }
    const vals = [shortDate(r.match.date), r.match.opponent, Math.round(l.minuti), l.gol, l.assist, l.tiri, `${l.passaggiOk}/${l.passaggi}`, l.recuperi, l.perse, l.distanza != null ? num(l.distanza) : '-'];
    let x = M;
    vals.forEach((v, j) => { doc.text(t(String(v)).slice(0, j === 1 ? 26 : 12), x, y); x += cols[j][1]; });
    y += 4.8;
  });
  if (!played.length) { doc.setTextColor(...gray); doc.text('Nessuna presenza registrata.', M, y); y += 6; }

  if (p.notes) {
    y += 4;
    h2('Note');
    const lines = doc.splitTextToSize(t(p.notes), W - 2 * M);
    lines.forEach((ln) => { ensure(5); doc.text(ln, M, y); y += 4.6; });
  }

  // numeri di pagina
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5); doc.setTextColor(...gray);
    doc.text(t(`Diario del Mister · ${fullName(p)} · pag. ${i}/${pages}`), W / 2, 292, { align: 'center' });
  }

  const blob = doc.output('blob');
  const safe = fullName(p).replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase();
  await shareOrDownload(blob, `scheda-${safe}-${(season?.name || '').replace(/\W+/g, '')}.pdf`);
}

function drawLineChart(doc, x, y, w, h, labels, series) {
  doc.setDrawColor(220, 220, 228); doc.setLineWidth(0.2);
  for (let k = 0; k <= 4; k++) doc.line(x, y + (h * k) / 4, x + w, y + (h * k) / 4);
  const n = labels.length;
  const px = (i) => x + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  series.forEach((s) => {
    doc.setDrawColor(...s.color); doc.setLineWidth(0.6);
    let prev = null;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { prev = null; return; }
      const pt = [px(i), y + h - (v / s.max) * h];
      if (prev) doc.line(prev[0], prev[1], pt[0], pt[1]);
      doc.setFillColor(...s.color); doc.circle(pt[0], pt[1], 0.7, 'F');
      prev = pt;
    });
  });
  doc.setFontSize(6.5); doc.setTextColor(120, 120, 130);
  const step = Math.ceil(n / 10);
  labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) doc.text(l, px(i), y + h + 3.5, { align: 'center' }); });
}

function drawHeat(doc, x, y, w, h, heat) {
  doc.setFillColor(47, 125, 64); doc.rect(x, y, w, h, 'F');
  const max = Math.max(...heat.values) || 1;
  const cw = w / heat.cols, ch = h / heat.rows;
  heat.values.forEach((v, i) => {
    const n = v / max;
    if (n < 0.05) return;
    const c = i % heat.cols, r = Math.floor(i / heat.cols);
    // blu -> giallo -> rosso, mescolato col verde del campo
    const col = n < 0.5 ? [40 + 400 * n, 120 + 200 * n, 220 - 300 * n] : [240, 240 - 360 * (n - 0.5), 20];
    const a = 0.35 + 0.65 * n;
    doc.setFillColor(...col.map((c2, k) => Math.round(c2 * a + [47, 125, 64][k] * (1 - a))).map((v2) => Math.max(0, Math.min(255, v2))));
    doc.rect(x + c * cw, y + r * ch, cw + 0.05, ch + 0.05, 'F');
  });
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.4);
  doc.rect(x, y, w, h);
  doc.line(x + w / 2, y, x + w / 2, y + h);
  doc.circle(x + w / 2, y + h / 2, h * 0.14);
}
