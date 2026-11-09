// NBA pace + defense-vs-position adjustments. Data: data/nba-matchups.json (scripts/build-nba-matchups.mjs, nightly CI).
let data = null;
export async function loadNba() {
  try { const r = await fetch('data/nba-matchups.json', { cache: 'no-cache' }); if (r.ok) data = await r.json(); } catch {}
  return data;
}
export const nbaData = () => data;

const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const POS_NAME = { G: 'guards', F: 'forwards', C: 'centers' };
const FIELDS = { Points: ['pts'], Rebounds: ['reb'], Assists: ['ast'], '3-Pointers': ['tpm'], 'Pts+Reb+Ast': ['pts', 'reb', 'ast'] };
const K = 8; // shrink early-season team numbers toward league average (8 games' worth)

/** Projected possessions for a game: pace multiplies (fast vs fast is faster than either alone). */
export function gamePace(homeAbbr, awayAbbr) {
  const h = data?.teams?.[homeAbbr], a = data?.teams?.[awayAbbr];
  if (!h || !a) return null;
  const L = data.league.pace;
  return { home: h, away: a, proj: (h.pace * a.pace) / L, league: L };
}

/** Pace factor for the game card (replaces the simulated one). */
export function paceFactor(g) {
  const gp = gamePace(g.homeTeam.abbr, g.awayTeam.abbr);
  if (!gp) return null;
  const diff = gp.proj - gp.league;
  return {
    text: `${g.awayTeam.abbr} ${gp.away.pace.toFixed(1)} (${ord(gp.away.paceRank)}) · ${g.homeTeam.abbr} ${gp.home.pace.toFixed(1)} (${ord(gp.home.paceRank)}) → ${gp.proj.toFixed(1)}`,
    note: `Projected ${gp.proj.toFixed(1)} possessions per 48 vs a league average of ${gp.league.toFixed(1)} (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}). More possessions = more shots, rebounds and assists for everyone. Real ${data.season} pace from ${data.games} games.`,
    lean: diff >= 2 ? { m: 'totals', s: 'over', w: Math.min(1, diff / 4) } : diff <= -2 ? { m: 'totals', s: 'under', w: Math.min(1, -diff / 4) } : null,
  };
}

/** Adjustment for an NBA prop: pace (vs the player's own team pace) × opponent's defense vs his position. */
export function nbaAdjust(o) {
  if (!data || o.sport !== 'nba' || !o.oppTeam) return null;
  const fields = FIELDS[o.stat];
  const teamAbbr = o.team || (o.home ? o.game?.homeTeam?.abbr : o.game?.awayTeam?.abbr);
  const mine = data.teams[teamAbbr], opp = data.teams[o.oppTeam.abbr];
  if (!mine || !opp) return null;
  const L = data.league;
  const proj = (mine.pace * opp.pace) / L.pace;
  const paceMult = proj / mine.pace; // vs the pace his averages were built at
  let dvpMult = 1, dvpLine = null;
  const pos = o.espnId ? data.players[o.espnId] : null;
  if (fields && pos) {
    const allowed = fields.reduce((s, f) => s + opp.vsPos[pos][f], 0), avg = fields.reduce((s, f) => s + L.vsPos[pos][f], 0);
    const raw = allowed / avg / (opp.pace / L.pace); // strip the opponent's own pace out so it isn't counted twice
    dvpMult = (raw * opp.games + 1 * K) / (opp.games + K);
    const rk = fields.length === 1 ? opp.vsPosRank[pos][fields[0]] : null;
    dvpLine = `${o.oppTeam.abbr} allows ${allowed.toFixed(1)} ${fields.length === 1 ? fields[0].replace('pts', 'pts').replace('tpm', '3PM') : 'PRA'}/g to ${POS_NAME[pos]}${rk ? ` (${rk <= 15 ? `${ord(rk)} fewest` : `${ord(31 - rk)} most`})` : ''} — ${dvpMult >= 1 ? '+' : '−'}${Math.abs((dvpMult - 1) * 100).toFixed(0)}% vs average after pace`;
  }
  const mult = paceMult * dvpMult;
  const base = o.hr?.avg ?? o.a?.mu;
  if (!base) return null;
  const delta = base * (mult - 1);
  return {
    delta, mult, paceMult, dvpMult, pos, opp: o.oppTeam.abbr,
    headline: Math.abs(delta) < 0.05 ? 'even with his average' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} vs his average`,
    paceLine: `Pace: ${teamAbbr} ${mine.pace.toFixed(1)} vs ${o.oppTeam.abbr} ${opp.pace.toFixed(1)} → ${proj.toFixed(1)} projected (${paceMult >= 1 ? '+' : '−'}${Math.abs((paceMult - 1) * 100).toFixed(1)}% possessions for him)`,
    dvpLine,
    season: data.season, games: data.games,
  };
}
