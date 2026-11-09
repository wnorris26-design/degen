// NHL shot volume, scoring environment and defense vs position. Data: data/nhl-matchups.json (scripts/build-nhl-matchups.mjs).
let data = null;
export async function loadNhl() {
  try { const r = await fetch('data/nhl-matchups.json', { cache: 'no-cache' }); if (r.ok) data = await r.json(); } catch {}
  return data;
}
export const nhlData = () => data;

const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const rankWord = (rk, n, few, many) => (rk <= n / 2 ? `${ord(rk)} ${few}` : `${ord(n + 1 - rk)} ${many}`);
const pctS = (m) => `${m >= 1 ? '+' : '−'}${Math.abs((m - 1) * 100).toFixed(0)}%`;
const K = 10; // early-season shrink toward league average (games)
const shrink = (rel, games) => (rel * games + K) / (games + K);

/** Expected goals for each side and the total vs league average (for the game factor). */
export function scoringFactor(g) {
  const h = data?.teams?.[g.homeTeam.abbr], a = data?.teams?.[g.awayTeam.abbr];
  if (!h || !a) return null;
  const L = data.league, n = Object.keys(data.teams).length;
  const xh = (h.gf * a.ga) / L.gf, xa = (a.gf * h.ga) / L.gf, tot = xh + xa, diff = tot - 2 * L.gf;
  return {
    key: 'nhlx', icon: '🥅', label: 'Scoring environment', value: `${g.awayTeam.abbr} ${xa.toFixed(1)} · ${g.homeTeam.abbr} ${xh.toFixed(1)} → ${tot.toFixed(1)} goals`,
    note: `Expected goals from each team's scoring vs the other's goals allowed (league avg ${(2 * L.gf).toFixed(1)} per game). Shots: ${g.awayTeam.abbr} ${a.sf.toFixed(1)} for (${rankWord(a.sfRank, n, 'most', 'fewest')}) / ${a.sa.toFixed(1)} against; ${g.homeTeam.abbr} ${h.sf.toFixed(1)} for / ${h.sa.toFixed(1)} against (${rankWord(h.saRank, n, 'fewest', 'most')} allowed). PP ${g.awayTeam.abbr} ${(a.pp * 100).toFixed(0)}% vs PK ${g.homeTeam.abbr} ${(h.pk * 100).toFixed(0)}%.`,
    lean: diff >= 0.4 ? { m: 'totals', s: 'over', w: Math.min(1, diff / 0.8) } : diff <= -0.4 ? { m: 'totals', s: 'under', w: Math.min(1, -diff / 0.8) } : null,
  };
}

/** Adjustment for an NHL prop: shot volume (SOG, saves) or scoring environment (points/goals/assists), × defense vs F/D. */
export function nhlAdjust(o) {
  if (!data || o.sport !== 'nhl' || !o.oppTeam) return null;
  const teamAbbr = o.team || (o.home ? o.game?.homeTeam?.abbr : o.game?.awayTeam?.abbr);
  const mine = data.teams[teamAbbr], opp = data.teams[o.oppTeam.abbr];
  if (!mine || !opp) return null;
  const L = data.league, n = Object.keys(data.teams).length, OA = o.oppTeam.abbr;
  const pos = o.espnId ? data.players[o.espnId] : null;
  let mult, lines = [];
  if (o.stat === 'Saves') {
    // more shots fired at him = more saves
    const xsa = (opp.sf * mine.sa) / L.sf;
    mult = shrink(xsa / mine.sa, Math.min(mine.games, opp.games));
    lines.push(`Shot volume: ${OA} shoots ${opp.sf.toFixed(1)}/g (${rankWord(opp.sfRank, n, 'most', 'fewest')}), ${teamAbbr} allows ${mine.sa.toFixed(1)} → ${xsa.toFixed(1)} shots expected at him`);
    const gl = o.espnId && data.goalies[o.espnId];
    if (gl) lines.push(`${gl.name}: ${(gl.svPct * 100).toFixed(1)} sv% over ${gl.gp} games`);
  } else if (o.stat === 'Shots on Goal') {
    const xsf = (mine.sf * opp.sa) / L.sf;
    const team = shrink(xsf / mine.sf, opp.games);
    let tilt = 1;
    if (pos === 'F' || pos === 'D') tilt = shrink((opp.vsPos[pos].sog / L.vsPos[pos].sog) / (opp.sa / L.sf), opp.games);
    mult = team * tilt;
    lines.push(`Shot volume: ${teamAbbr} ${mine.sf.toFixed(1)} SOG/g vs ${OA} allowing ${opp.sa.toFixed(1)} (${rankWord(opp.saRank, n, 'fewest', 'most')}) → ${xsf.toFixed(1)} expected (${pctS(team)})`);
    if (pos === 'F' || pos === 'D') lines.push(`${OA} allows ${opp.vsPos[pos].sog.toFixed(1)} SOG/g to ${pos === 'F' ? 'forwards' : 'defensemen'} (${pctS(tilt)} vs avg after volume)`);
  } else if (['Points', 'Goals', 'Assists', 'Anytime Goal'].includes(o.stat)) {
    const xgf = (mine.gf * opp.ga) / L.gf;
    const team = shrink(xgf / mine.gf, opp.games);
    let tilt = 1;
    if (pos === 'F' || pos === 'D') { const f = o.stat === 'Goals' || o.stat === 'Anytime Goal' ? 'g' : 'pts'; tilt = shrink((opp.vsPos[pos][f] / L.vsPos[pos][f]) / (opp.ga / L.gf), opp.games); }
    mult = team * tilt;
    lines.push(`Scoring: ${teamAbbr} ${mine.gf.toFixed(2)} goals/g vs ${OA} allowing ${opp.ga.toFixed(2)} (${rankWord(opp.gaRank, n, 'fewest', 'most')}) → ${xgf.toFixed(2)} expected (${pctS(team)})`);
    if (opp.pk < 0.78) lines.push(`${OA} penalty kill is ${(opp.pk * 100).toFixed(0)}% — power-play points come easier`);
  } else return null;
  const base = o.hr?.avg ?? o.a?.mu;
  if (!base) return null;
  const delta = base * (mult - 1);
  return { delta, mult, opp: OA, lines, season: data.season, games: data.games,
    headline: Math.abs(mult - 1) < 0.01 ? 'even with his average' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(Math.abs(delta) < 1 ? 2 : 1)} vs his average` };
}
