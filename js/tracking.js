// Importazione file JSON di tracking (solo numeri di maglia, nessun nome).
import { heatmapFromPositions } from './charts.js';

const pickKey = (o, ...keys) => {
  for (const k of keys) if (o && o[k] != null) return o[k];
  return undefined;
};

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Riduce il numero di posizioni per non appesantire l'archivio. */
function downsample(list, max = 2500) {
  if (list.length <= max) return list;
  const step = list.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

function normPositions(raw) {
  if (!Array.isArray(raw)) return [];
  const pts = raw.map((p) => {
    if (Array.isArray(p)) return [toNum(p[0]), toNum(p[1]), toNum(p[2])];
    return [toNum(pickKey(p, 't', 'tempo', 'time')), toNum(pickKey(p, 'x')), toNum(pickKey(p, 'y'))];
  }).filter((p) => p[1] != null && p[2] != null);
  return downsample(pts.map((p) => [p[0] ?? 0, Math.round(p[1] * 100) / 100, Math.round(p[2] * 100) / 100]));
}

function normHeatmap(raw) {
  if (!raw) return null;
  // Formato 1: {colonne, righe, valori:[...]} ; Formato 2: matrice [[...],[...]]
  if (Array.isArray(raw)) {
    const rows = raw.length, cols = rows ? raw[0].length : 0;
    return rows && cols ? { cols, rows, values: raw.flat().map((v) => toNum(v) || 0) } : null;
  }
  const cols = toNum(pickKey(raw, 'colonne', 'cols', 'columns'));
  const rows = toNum(pickKey(raw, 'righe', 'rows'));
  let values = pickKey(raw, 'valori', 'values', 'data');
  if (Array.isArray(values) && Array.isArray(values[0])) values = values.flat();
  if (!cols || !rows || !Array.isArray(values) || values.length !== cols * rows) return null;
  return { cols, rows, values: values.map((v) => toNum(v) || 0) };
}

/**
 * Legge e valida il file. Restituisce { meta, pitch, players:[...] } oppure lancia un errore leggibile.
 */
export function parseTracking(text) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Il file non è un JSON valido.'); }
  const list = pickKey(json, 'giocatori', 'players');
  if (!Array.isArray(list) || !list.length) throw new Error('Il file non contiene l\'elenco "giocatori".');

  const meta = pickKey(json, 'partita', 'match') || {};
  const campo = pickKey(json, 'campo', 'pitch') || {};
  const pitch = {
    length: toNum(pickKey(campo, 'lunghezza', 'length')) || 100,
    width: toNum(pickKey(campo, 'larghezza', 'width')) || 64,
  };

  const errors = [];
  const players = list.map((p, i) => {
    const number = toNum(pickKey(p, 'numero', 'number', 'maglia', 'jersey'));
    if (number == null) errors.push(`Riga ${i + 1}: manca il numero di maglia.`);
    const positions = normPositions(pickKey(p, 'posizioni', 'positions'));
    let heatmap = normHeatmap(pickKey(p, 'heatmap', 'mappa_calore'));
    if (!heatmap && positions.length) heatmap = heatmapFromPositions(positions, pitch);
    return {
      number,
      distance_m: toNum(pickKey(p, 'distanza_m', 'distanza', 'distance_m', 'distance')),
      max_speed_kmh: toNum(pickKey(p, 'velocita_max_kmh', 'vel_max_kmh', 'max_speed_kmh')),
      sprints: toNum(pickKey(p, 'sprint', 'sprints')),
      minutes: toNum(pickKey(p, 'minuti', 'minutes')),
      positions,
      heatmap,
    };
  });
  if (errors.length) throw new Error(errors.slice(0, 5).join('\n'));
  const dup = players.map((p) => p.number).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length) throw new Error(`Numero di maglia ripetuto nel file: ${[...new Set(dup)].join(', ')}.`);

  return {
    meta: {
      date: pickKey(meta, 'data', 'date') || null,
      opponent: pickKey(meta, 'avversario', 'opponent') || null,
      team: pickKey(meta, 'squadra', 'team') || null,
      season: pickKey(meta, 'stagione', 'season') || null,
    },
    pitch,
    players,
  };
}

/** Avvisi (non bloccanti) se il file sembra riferirsi a un'altra partita. */
export function checkMeta(parsed, { match, team, season }) {
  const w = [];
  const m = parsed.meta;
  if (m.date && match.date && m.date.slice(0, 10) !== match.date) w.push(`Data nel file ${m.date}, partita del ${match.date}.`);
  if (m.team && team && m.team.trim().toLowerCase() !== team.name.trim().toLowerCase()) w.push(`Squadra nel file "${m.team}", squadra attuale "${team.name}".`);
  if (m.season && season && m.season.trim() !== season.name.trim()) w.push(`Stagione nel file "${m.season}", stagione attuale "${season.name}".`);
  return w;
}
