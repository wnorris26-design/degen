// NFL scheme matchups: how a player's man-vs-zone (or box-count) splits line up with tonight's defense.
// Data: data/nfl-matchups.json, built from nflverse by scripts/build-nfl-matchups.mjs (refreshed weekly by CI).
let data = null;
export async function loadScheme() {
  try { const r = await fetch('data/nfl-matchups.json', { cache: 'no-cache' }); if (r.ok) data = await r.json(); } catch {}
  return data;
}
export const schemeData = () => data;

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
const pct = (x) => Math.round(x * 100) + '%';
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
// shrink a split toward the player's overall rate so 30-play samples don't swing projections
const shrink = (rate, n, overall, k) => (rate * n + overall * k) / (n + k);
const DB_PER_GAME = 35; // team dropbacks per game (league average)

export function defense(abbr) { return data?.teams?.[abbr] || null; }
export function defenseLine(abbr) {
  const d = defense(abbr);
  if (!d) return null;
  const a = d.allowed;
  return `${pct(d.zone)} zone (${ord(d.zoneRank)} most) · blitz ${pct(d.blitz)} (${ord(d.blitzRank)}) · ${d.shells.map(([s, v]) => `${s} ${pct(v)}`).join(', ')}${a ? ` · allows ${a.passYpg} pass yds/g (${ord(a.passRank)} fewest), ${a.ypc.toFixed(1)} YPC (${ord(a.ypcRank)})` : ''}`;
}

/** Scheme adjustment for an NFL prop: { delta (stat units vs the player's norm), lines[], def, player } or null */
export function schemeAdjust(o) {
  if (!data || o.sport !== 'nfl' || !o.oppTeam) return null;
  const def = defense(o.oppTeam.abbr), pl = data.players[norm(o.player)];
  if (!def || !pl) return null;
  const opp = o.oppTeam.abbr;
  const mix = (z, m) => def.zone * z + def.man * m;
  let delta = null, detail = '';
  const S = o.stat;
  if (pl.qb && (S === 'Pass Yards' || S === 'Rush Yards')) {
    const key = S === 'Pass Yards' ? 'ypdb' : 'scr', { zone: z, man: m } = pl.qb;
    const overall = (z[key] * z.db + m[key] * m.db) / (z.db + m.db || 1);
    const zs = shrink(z[key], z.db, overall, 80), ms = shrink(m[key], m.db, overall, 80);
    delta = (mix(zs, ms) - overall) * DB_PER_GAME;
    detail = S === 'Pass Yards' ? `${pl.name} gains ${z.ypdb.toFixed(1)} yds/dropback vs zone, ${m.ypdb.toFixed(1)} vs man` : `${pl.name} scrambles for ${z.scr.toFixed(2)} yds/dropback vs zone, ${m.scr.toFixed(2)} vs man (designed runs not coverage-dependent)`;
  } else if (pl.rec && (S === 'Rec Yards' || S === 'Receptions')) {
    const key = S === 'Rec Yards' ? 'ypd' : 'rpd', { zone: z, man: m } = pl.rec;
    const overall = (z[key] * z.n + m[key] * m.n) / (z.n + m.n || 1);
    const zs = shrink(z[key], z.n, overall, 150), ms = shrink(m[key], m.n, overall, 150);
    delta = (mix(zs, ms) - overall) * DB_PER_GAME;
    detail = S === 'Rec Yards' ? `${pl.name}: ${z.ypd.toFixed(2)} rec yds per team dropback vs zone, ${m.ypd.toFixed(2)} vs man` : `${pl.name}: ${(z.rpd * DB_PER_GAME).toFixed(1)} catches/game pace vs zone, ${(m.rpd * DB_PER_GAME).toFixed(1)} vs man`;
  } else if (pl.rb && S === 'Rush Yards') {
    const b = pl.rb, car = b.light.car + b.normal.car + b.heavy.car;
    const overall = (b.light.ypc * b.light.car + b.normal.ypc * b.normal.car + b.heavy.ypc * b.heavy.car) / (car || 1);
    const ys = (k) => shrink(b[k].ypc, b[k].car, overall, 30);
    const own = { light: b.light.car / car, heavy: b.heavy.car / car }; own.normal = 1 - own.light - own.heavy;
    const vs = { light: def.boxLight, heavy: def.box8, normal: Math.max(0, 1 - def.boxLight - def.box8) };
    const exp = (dist) => dist.light * ys('light') + dist.normal * ys('normal') + dist.heavy * ys('heavy');
    const perGame = Math.min(22, car / 15);
    delta = (exp(vs) - exp(own)) * perGame;
    detail = `${pl.name}: ${b.light.ypc.toFixed(1)} YPC vs light boxes, ${b.heavy.ypc.toFixed(1)} vs 8-man boxes; ${opp} stacks 8+ on ${pct(def.box8)} of runs (${ord(def.box8Rank)} most)`;
  }
  if (delta == null) return null;
  const sign = delta >= 0 ? '+' : '−';
  const unit = S === 'Receptions' ? 'catches' : 'yds';
  const mag = S === 'Receptions' ? Math.abs(delta).toFixed(1) : Math.round(Math.abs(delta));
  return {
    delta, def, player: pl, opp,
    headline: +mag === 0 ? 'even with his norm' : `${sign}${mag} ${unit} vs his norm`,
    defLine: `${opp}: ${pct(def.zone)} zone (${ord(def.zoneRank)} most), ${pct(def.man)} man · blitz ${pct(def.blitz)}`,
    detail,
    season: data.schemeSeason,
  };
}
