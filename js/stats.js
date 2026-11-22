// Calcolo statistiche: tutto in locale, a partire da partite, eventi e tracking.

export const EVENT_TYPES = {
  gol: { label: 'Gol', icon: '⚽' },
  golSubito: { label: 'Gol subito', icon: '🥅' },
  tiro: { label: 'Tiro', icon: '🎯' },
  passaggio: { label: 'Passaggio', icon: '➡️' },
  persa: { label: 'Palla persa', icon: '❌' },
  recupero: { label: 'Recupero', icon: '🛡️' },
  cambio: { label: 'Cambio', icon: '🔁' },
};

/** Metriche disponibili per grafici, confronti e tendenze. higherIsBetter=false per quelle "negative". */
export const METRICS = {
  minuti: { label: 'Minuti giocati', short: 'Min', per90: false },
  gol: { label: 'Gol', short: 'Gol', per90: true },
  assist: { label: 'Assist', short: 'Ast', per90: true },
  tiri: { label: 'Tiri', short: 'Tiri', per90: true },
  tiriPorta: { label: 'Tiri in porta', short: 'TiP', per90: true },
  passaggi: { label: 'Passaggi tentati', short: 'Pass', per90: true },
  passaggiOk: { label: 'Passaggi riusciti', short: 'PassOK', per90: true },
  precisione: { label: 'Precisione passaggi', short: '%Pass', per90: false, ratio: true },
  perse: { label: 'Palle perse', short: 'Perse', per90: true, higherIsBetter: false },
  recuperi: { label: 'Recuperi', short: 'Rec', per90: true },
  distanza: { label: 'Distanza (m)', short: 'Dist', per90: true, tracking: true },
  velMax: { label: 'Velocità max (km/h)', short: 'Vmax', per90: false, tracking: true },
  sprint: { label: 'Sprint', short: 'Spr', per90: true, tracking: true },
};

export const TRACKED_METRICS = ['gol', 'assist', 'tiri', 'tiriPorta', 'passaggiOk', 'precisione', 'perse', 'recuperi', 'distanza'];

function emptyLine() {
  return { minuti: 0, gol: 0, assist: 0, tiri: 0, tiriPorta: 0, passaggi: 0, passaggiOk: 0, perse: 0, recuperi: 0,
    entrato: 0, uscito: 0, titolare: 0, presenze: 0, distanza: null, velMax: null, sprint: null };
}

// ---------- Tempo di gioco ----------

export function periodElapsed(p, now = Date.now()) {
  if (!p) return 0;
  return (p.elapsed || 0) + (p.running && p.startedAt ? (now - p.startedAt) / 1000 : 0);
}

/** Durata in secondi di un tempo, usata per i minuti giocati. */
export function periodDuration(match, i, now = Date.now()) {
  const p = (match.periods || [])[i] || {};
  if (p.durationSec != null && p.durationSec !== '') return Number(p.durationSec);
  const live = periodElapsed(p, now);
  if (p.ended || p.running || live > 0) return live;
  return match.status === 'finita' ? (match.periodMinutes || 0) * 60 : 0;
}

/** Giocatori in campo all'inizio del tempo i (se non indicato: quelli in campo alla fine del tempo precedente). */
export function onFieldAtStart(match, events, i) {
  const p = (match.periods || [])[i];
  if (p && Array.isArray(p.onFieldStart)) return [...p.onFieldStart];
  if (i === 0) return [];
  return onFieldAtEnd(match, events, i - 1);
}

export function onFieldAt(match, events, i, t) {
  const set = new Set(onFieldAtStart(match, events, i));
  events.filter((e) => e.type === 'cambio' && e.period === i + 1 && e.t <= t)
    .sort((a, b) => a.t - b.t)
    .forEach((e) => { if (e.playerId) set.delete(e.playerId); if (e.playerInId) set.add(e.playerInId); });
  return [...set];
}

export function onFieldAtEnd(match, events, i) {
  return onFieldAt(match, events, i, Infinity);
}

/** Minuti giocati per giocatore in una partita: { playerId: minuti } e dettaglio per tempo. */
export function minutesPlayed(match, events, now = Date.now()) {
  const total = {}, byPeriod = {};
  const n = match.periodsCount || 2;
  for (let i = 0; i < n; i++) {
    const dur = periodDuration(match, i, now);
    if (dur <= 0) continue;
    const subs = events.filter((e) => e.type === 'cambio' && e.period === i + 1).sort((a, b) => a.t - b.t);
    const enteredAt = {};
    onFieldAtStart(match, events, i).forEach((id) => (enteredAt[id] = 0));
    const add = (id, sec) => {
      total[id] = (total[id] || 0) + sec / 60;
      byPeriod[id] = byPeriod[id] || {};
      byPeriod[id][i + 1] = (byPeriod[id][i + 1] || 0) + sec / 60;
    };
    for (const s of subs) {
      const t = Math.min(s.t, dur);
      if (s.playerId && enteredAt[s.playerId] != null) { add(s.playerId, t - enteredAt[s.playerId]); delete enteredAt[s.playerId]; }
      if (s.playerInId && enteredAt[s.playerInId] == null) enteredAt[s.playerInId] = t;
    }
    Object.entries(enteredAt).forEach(([id, t0]) => add(id, dur - t0));
  }
  return { total, byPeriod };
}

// ---------- Statistiche partita ----------

/** Statistiche dei giocatori in una partita. */
export function matchPlayerStats(match, events, tracking = [], now = Date.now()) {
  const res = {};
  const line = (id) => (res[id] = res[id] || emptyLine());
  const { total } = minutesPlayed(match, events, now);
  Object.entries(total).forEach(([id, m]) => { const l = line(id); l.minuti = m; if (m > 0) l.presenze = 1; });
  const starters = onFieldAtStart(match, events, 0);
  starters.forEach((id) => { line(id).titolare = 1; });

  for (const e of events) {
    if (e.type === 'cambio') {
      if (e.playerId) line(e.playerId).uscito++;
      if (e.playerInId) line(e.playerInId).entrato++;
      continue;
    }
    if (!e.playerId) continue;
    const l = line(e.playerId);
    switch (e.type) {
      case 'gol':
        l.gol++;
        if (e.assistId) line(e.assistId).assist++;
        break;
      case 'tiro': l.tiri++; if (e.result === 'porta') l.tiriPorta++; break;
      case 'passaggio': l.passaggi++; if (e.result === 'ok') l.passaggiOk++; break;
      case 'persa': l.perse++; break;
      case 'recupero': l.recuperi++; break;
    }
  }
  // un gol è anche un tiro in porta
  Object.values(res).forEach((l) => { l.tiri += l.gol; l.tiriPorta += l.gol; });

  for (const t of tracking) {
    if (!t.playerId) continue;
    const l = line(t.playerId);
    if (t.distance_m != null) l.distanza = (l.distanza || 0) + Number(t.distance_m);
    if (t.max_speed_kmh != null) l.velMax = Math.max(l.velMax || 0, Number(t.max_speed_kmh));
    if (t.sprints != null) l.sprint = (l.sprint || 0) + Number(t.sprints);
  }
  Object.values(res).forEach(finishLine);
  return res;
}

function finishLine(l) {
  l.precisione = l.passaggi > 0 ? l.passaggiOk / l.passaggi : null;
  return l;
}

/** Statistiche di squadra per tempo: { 1: {...}, 2: {...}, totale: {...} } */
export function matchTeamStats(match, events) {
  const n = match.periodsCount || 2;
  const blank = () => ({ golFatti: 0, golSubiti: 0, tiri: 0, tiriPorta: 0, passaggi: 0, passaggiOk: 0, perse: 0, recuperi: 0, cambi: 0 });
  const out = { totale: blank() };
  for (let i = 1; i <= n; i++) out[i] = blank();
  for (const e of events) {
    const targets = [out.totale, out[e.period]].filter(Boolean);
    for (const s of targets) {
      switch (e.type) {
        case 'gol': s.golFatti++; s.tiri++; s.tiriPorta++; break;
        case 'golSubito': s.golSubiti++; break;
        case 'tiro': s.tiri++; if (e.result === 'porta') s.tiriPorta++; break;
        case 'passaggio': s.passaggi++; if (e.result === 'ok') s.passaggiOk++; break;
        case 'persa': s.perse++; break;
        case 'recupero': s.recuperi++; break;
        case 'cambio': s.cambi++; break;
      }
    }
  }
  Object.values(out).forEach((s) => { s.precisione = s.passaggi ? s.passaggiOk / s.passaggi : null; });
  return out;
}

export function score(events) {
  return {
    fatti: events.filter((e) => e.type === 'gol').length,
    subiti: events.filter((e) => e.type === 'golSubito').length,
  };
}

// ---------- Stagione ----------

/**
 * Prepara i dati di stagione: elenco partite ordinate con statistiche per giocatore e squadra.
 * ctx = { matches, eventsByMatch, trackingByMatch }
 */
export function seasonData(ctx) {
  const matches = [...ctx.matches].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return matches.map((m) => {
    const ev = ctx.eventsByMatch[m.id] || [];
    const tr = ctx.trackingByMatch[m.id] || [];
    return { match: m, events: ev, tracking: tr, players: matchPlayerStats(m, ev, tr), team: matchTeamStats(m, ev), score: score(ev) };
  });
}

/** Totali di stagione per giocatore. */
export function seasonTotals(rows, playerId) {
  const tot = emptyLine();
  let trackedMinutes = 0, trackedMatches = 0;
  for (const r of rows) {
    const l = r.players[playerId];
    if (!l) continue;
    ['minuti', 'gol', 'assist', 'tiri', 'tiriPorta', 'passaggi', 'passaggiOk', 'perse', 'recuperi', 'entrato', 'uscito', 'titolare', 'presenze']
      .forEach((k) => (tot[k] += l[k] || 0));
    if (l.distanza != null) { tot.distanza = (tot.distanza || 0) + l.distanza; trackedMinutes += l.minuti; trackedMatches++; }
    if (l.velMax != null) tot.velMax = Math.max(tot.velMax || 0, l.velMax);
    if (l.sprint != null) tot.sprint = (tot.sprint || 0) + l.sprint;
  }
  finishLine(tot);
  tot.trackedMinutes = trackedMinutes;
  tot.trackedMatches = trackedMatches;
  return tot;
}

/** Valore per 90 minuti (null se i minuti sono troppo pochi per essere significativi). */
export function per90(line, key, minMinutes = 1) {
  const meta = METRICS[key];
  const v = line[key];
  if (v == null) return null;
  if (!meta || !meta.per90) return v;
  const minutes = meta.tracking ? (line.trackedMinutes ?? line.minuti) : line.minuti;
  if (!minutes || minutes < minMinutes) return null;
  return (v / minutes) * 90;
}

/** Serie partita per partita di una metrica per un giocatore. */
export function playerSeries(rows, playerId, key, { normalize = false } = {}) {
  return rows.map((r) => {
    const l = r.players[playerId];
    if (!l || !l.minuti) return null;
    if (normalize) return per90(l, key, 10);
    return l[key] ?? null;
  });
}

// ---------- Tendenze ----------

function mean(arr) {
  const v = arr.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/**
 * Confronta la media delle ultime 3 partite con la media delle precedenti.
 * Restituisce le segnalazioni ordinate per rilevanza.
 */
export function detectTrends(rows, players) {
  const alerts = [];
  const keys = ['gol', 'tiri', 'passaggiOk', 'precisione', 'perse', 'recuperi', 'distanza', 'minuti'];
  for (const p of players) {
    const played = rows.filter((r) => r.players[p.id] && r.players[p.id].minuti >= 10);
    if (played.length < 4) continue;
    const last = played.slice(-3), prev = played.slice(0, -3);
    for (const key of keys) {
      const meta = METRICS[key];
      const val = (r) => {
        const l = r.players[p.id];
        if (key === 'minuti') return l.minuti;
        return meta.per90 ? per90(l, key, 10) : l[key];
      };
      const a = mean(prev.map(val)), b = mean(last.map(val));
      const a2 = mean(prev.map(val).filter((x) => x != null));
      if (a == null || b == null || a2 == null) continue;
      let delta, significant, text;
      if (meta.ratio) {
        delta = b - a;
        significant = Math.abs(delta) >= 0.1 && last.every((r) => (r.players[p.id].passaggi || 0) >= 3);
        text = `${Math.round(a * 100)}% → ${Math.round(b * 100)}%`;
      } else {
        const base = Math.max(Math.abs(a), key === 'distanza' ? 500 : key === 'minuti' ? 10 : 0.8);
        delta = (b - a) / base;
        significant = Math.abs(delta) >= 0.25 && Math.abs(b - a) >= (key === 'distanza' ? 300 : key === 'minuti' ? 8 : 0.75);
        const d = key === 'distanza' || key === 'minuti' ? 0 : 1;
        const unit = key === 'minuti' ? ' min' : meta.per90 ? ' /90′' : '';
        text = `${fmt(a, d)} → ${fmt(b, d)}${unit}`;
      }
      if (!significant) continue;
      const better = (meta.higherIsBetter === false ? -delta : delta) > 0;
      alerts.push({ player: p, key, label: meta.label, better, delta, text, score: Math.abs(delta) });
    }
  }
  return alerts.sort((x, y) => y.score - x.score);
}

/** Tendenze di squadra sulle ultime 3 partite. */
export function detectTeamTrends(rows) {
  if (rows.length < 4) return [];
  const last = rows.slice(-3), prev = rows.slice(0, -3);
  const defs = [
    ['golFatti', 'Gol fatti a partita', true, 0.5],
    ['golSubiti', 'Gol subiti a partita', false, 0.5],
    ['tiri', 'Tiri a partita', true, 2],
    ['recuperi', 'Recuperi a partita', true, 3],
    ['perse', 'Palle perse a partita', false, 3],
    ['precisione', 'Precisione passaggi', true, 0.08],
  ];
  const out = [];
  for (const [k, label, hib, minAbs] of defs) {
    const a = mean(prev.map((r) => r.team.totale[k])), b = mean(last.map((r) => r.team.totale[k]));
    if (a == null || b == null) continue;
    const diff = b - a;
    const rel = k === 'precisione' ? diff : diff / Math.max(Math.abs(a), 1);
    if (Math.abs(diff) < minAbs || Math.abs(rel) < (k === 'precisione' ? 0.08 : 0.25)) continue;
    out.push({ key: k, label, better: hib ? diff > 0 : diff < 0,
      text: k === 'precisione' ? `${Math.round(a * 100)}% → ${Math.round(b * 100)}%` : `${fmt(a, 1)} → ${fmt(b, 1)}` });
  }
  return out;
}

function fmt(v, d) {
  return Number(v).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ---------- Numeri di maglia ----------

/** Numero di maglia del giocatore alla data indicata, tenendo conto dello storico. */
export function numberAt(player, date) {
  for (const h of player.numberHistory || []) {
    if ((!h.from || !date || h.from <= date) && (!h.to || !date || date <= h.to)) return Number(h.number);
  }
  return player.number === '' || player.number == null ? null : Number(player.number);
}

export function playerByNumber(players, number, date) {
  return players.find((p) => numberAt(p, date) === Number(number)) || null;
}
