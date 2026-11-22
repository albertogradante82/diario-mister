// Classifica di società: gol e assist di tutti i ragazzi delle giovanili (dati ufficiali Tuttocampo).
import { esc } from '../util.js';
import { fillPhotos } from '../profiles.js';

/**
 * teams: [{ id, name, stats|tcStats: { marcatori:[{name, playerId, gol, assist, rigori}] } }]
 * Unisce i ragazzi che hanno segnato in più squadre.
 */
export function buildLeaderboard(teams) {
  const by = new Map();
  for (const t of teams) {
    const st = t.stats || t.tcStats;
    for (const m of st?.marcatori || []) {
      const key = m.playerId || m.name.toLowerCase();
      const cur = by.get(key) || { id: m.playerId || null, name: m.name, gol: 0, assist: 0, rigori: 0, teams: [] };
      cur.gol += m.gol || 0;
      cur.assist += m.assist || 0;
      cur.rigori += m.rigori || 0;
      cur.teams.push({ team: t.name, gol: m.gol || 0, assist: m.assist || 0 });
      by.set(key, cur);
    }
  }
  return [...by.values()];
}

const SORTS = {
  totale: ['Gol + assist', (a, b) => b.gol + b.assist - (a.gol + a.assist) || b.gol - a.gol],
  gol: ['Gol', (a, b) => b.gol - a.gol || b.assist - a.assist],
  assist: ['Assist', (a, b) => b.assist - a.assist || b.gol - a.gol],
};

/** Disegna la classifica in root. link(id) → href del profilo (o null). */
export function renderLeaderboard(root, list, { link = () => null, updated = '' } = {}) {
  let sort = sessionStorage.getItem('lbSort') || 'totale';
  const short = (n) => n.replace(/ (Provinciali|Sperimentali|Regionali)$/i, '');
  const draw = () => {
    const rows = list.filter((r) => (sort === 'gol' ? r.gol : sort === 'assist' ? r.assist : r.gol + r.assist) > 0).sort(SORTS[sort][1]);
    let pos = 0, prev = null;
    const val = (r) => (sort === 'gol' ? r.gol : sort === 'assist' ? r.assist : r.gol + r.assist);
    root.innerHTML = `
      <div class="seg">${Object.entries(SORTS).map(([k, [l]]) => `<label><input type="radio" name="lbs" value="${k}" ${k === sort ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      ${rows.length ? `<div class="list">${rows.map((r, i) => {
        if (val(r) !== prev) { pos = i + 1; prev = val(r); }
        const href = r.id ? link(r.id) : null;
        const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos;
        return `<${href ? `a href="${href}"` : 'div'} class="item lb-row">
          <span class="rank">${medal}</span>
          <span class="avatar" style="width:44px;height:44px;font-size:15px" ${r.id ? `data-rphoto="${esc(r.id)}"` : ''}>${esc(r.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
          <div class="grow"><strong>${esc(r.name)}</strong>
            <div class="muted small">${r.teams.map((t) => esc(short(t.team))).join(' · ')}</div></div>
          <div class="lb-nums"><div><b>${r.gol}</b><small>gol</small></div><div><b>${r.assist}</b><small>ast</small></div><div class="lb-tot"><b>${r.gol + r.assist}</b><small>tot</small></div></div>
        </${href ? 'a' : 'div'}>`;
      }).join('')}</div>` : '<div class="empty"><p>Ancora nessun dato.</p></div>'}
      <p class="small muted">Tutte le squadre del Calcio Palazzo · fonte Tuttocampo${updated ? `, aggiornata al ${esc(updated)}` : ''}. Chi ha giocato in più squadre ha i numeri sommati.</p>`;
    root.querySelectorAll('input[name=lbs]').forEach((i) => (i.onchange = () => { sort = i.value; sessionStorage.setItem('lbSort', sort); draw(); }));
    fillPhotos(root);
  };
  draw();
}
