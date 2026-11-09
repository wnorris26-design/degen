#!/usr/bin/env node
// Builds data/nba-matchups.json from ESPN's public box scores (current regular season):
//   - Team pace (possessions per 48) and offensive/defensive rating (points per 100 possessions)
//   - Defense vs position: points / rebounds / assists / 3PM allowed per game to guards, forwards and centers
//   - ESPN athlete id → position, so props can be matched to the right position group
// Possessions = FGA − OREB + TOV + 0.44·FTA (averaged for both teams). Usage: node scripts/build-nba-matchups.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ESPN_TEAM_IDS } from '../js/teams.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const now = new Date();
const seasonStartYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
const ABBR = Object.fromEntries(Object.entries(ESPN_TEAM_IDS.nba).map(([name, id]) => [String(id), null]));
// our abbreviations, keyed by ESPN team id
const { TEAMS } = await import('../js/teams.js');
for (const t of TEAMS.nba) ABBR[String(t.espn)] = t.abbr;

async function json(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (r.ok) return await r.json(); } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); }
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const split = (v) => String(v || '0').split('-').map(Number);
const r2 = (x) => Math.round(x * 100) / 100;
const POS = (p) => (!p ? null : p[0] === 'C' ? 'C' : p[0] === 'F' ? 'F' : p[0] === 'G' || p === 'PG' || p === 'SG' ? 'G' : null);

// 1) completed regular-season games, day by day (ESPN's scoreboard only takes single dates)
const ids = new Set();
const days = [];
for (let d = new Date(Date.UTC(seasonStartYear, 9, 1)); d < now; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymd(d));
await pool(days, 6, async (day) => {
  const sb = await json(`${BASE}/scoreboard?dates=${day}`);
  for (const e of sb?.events || []) if (e.season?.type === 2 && e.status?.type?.completed) ids.add(e.id);
});
console.log(`${ids.size} completed regular-season games`);

// 2) box scores
const T = {}; // team abbr → accumulators
const players = {};
const team = (a) => (T[a] ||= { games: 0, poss: 0, min: 0, pts: 0, opp: 0, allowed: { G: { pts: 0, reb: 0, ast: 0, tpm: 0 }, F: { pts: 0, reb: 0, ast: 0, tpm: 0 }, C: { pts: 0, reb: 0, ast: 0, tpm: 0 } } });
let parsed = 0;
await pool([...ids], 6, async (id) => {
  const s = await json(`${BASE}/summary?event=${id}`);
  const box = s?.boxscore, comp = s?.header?.competitions?.[0];
  if (!box?.teams?.length || !comp) return;
  const periods = comp.status?.period || 4;
  const minutes = 48 + Math.max(0, periods - 4) * 5;
  const score = Object.fromEntries((comp.competitors || []).map((c) => [String(c.team?.id || c.id), +c.score]));
  const sides = box.teams.map((t) => {
    const st = Object.fromEntries(t.statistics.map((x) => [x.name, x.displayValue]));
    const [, fga] = split(st['fieldGoalsMade-fieldGoalsAttempted']), [, fta] = split(st['freeThrowsMade-freeThrowsAttempted']);
    const tov = +(st.totalTurnovers ?? st.turnovers ?? 0);
    return { id: String(t.team.id), abbr: ABBR[String(t.team.id)], poss: fga - +(st.offensiveRebounds || 0) + tov + 0.44 * fta, pts: score[String(t.team.id)] };
  });
  if (sides.length !== 2 || sides.some((x) => !x.abbr)) return;
  const poss = (sides[0].poss + sides[1].poss) / 2;
  for (const [me, them] of [[sides[0], sides[1]], [sides[1], sides[0]]]) {
    const t = team(me.abbr); t.games++; t.poss += poss; t.min += minutes; t.pts += me.pts; t.opp += them.pts;
  }
  // what each defense allowed, by the opposing players' positions
  for (const pl of box.players || []) {
    const off = ABBR[String(pl.team.id)], def = sides.find((x) => x.abbr !== off)?.abbr;
    const st = pl.statistics?.[0]; if (!st || !def) continue;
    const k = Object.fromEntries((st.keys || []).map((key, i) => [key, i]));
    for (const a of st.athletes || []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const pos = POS(a.athlete?.position?.abbreviation);
      if (a.athlete?.id && pos) players[a.athlete.id] = pos;
      if (!pos) continue;
      const v = (key) => split(a.stats[k[key]])[0] || 0;
      const al = team(def).allowed[pos];
      al.pts += v('points'); al.reb += v('rebounds'); al.ast += v('assists'); al.tpm += v('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
    }
  }
  parsed++;
});
console.log(`parsed ${parsed} box scores`);

// 3) assemble
const teams = {};
for (const [a, t] of Object.entries(T)) {
  if (!t.games) continue;
  const per = (x) => r2(x / t.games);
  teams[a] = { games: t.games, pace: r2((t.poss / t.min) * 48), ortg: r2((t.pts / t.poss) * 100), drtg: r2((t.opp / t.poss) * 100),
    vsPos: Object.fromEntries(Object.entries(t.allowed).map(([p, x]) => [p, { pts: per(x.pts), reb: per(x.reb), ast: per(x.ast), tpm: per(x.tpm) }])) };
}
const list = Object.values(teams);
const avg = (f) => r2(list.reduce((s, t) => s + f(t), 0) / (list.length || 1));
const league = { pace: avg((t) => t.pace), ortg: avg((t) => t.ortg), vsPos: {} };
for (const p of ['G', 'F', 'C']) league.vsPos[p] = Object.fromEntries(['pts', 'reb', 'ast', 'tpm'].map((k) => [k, avg((t) => t.vsPos[p][k])]));
const rankBy = (f, desc) => { const ks = Object.keys(teams).sort((a, b) => (desc ? f(teams[b]) - f(teams[a]) : f(teams[a]) - f(teams[b]))); ks.forEach((k, i) => (f.r ? 0 : 0)); return Object.fromEntries(ks.map((k, i) => [k, i + 1])); };
const paceRank = rankBy((t) => t.pace, true), drtgRank = rankBy((t) => t.drtg, false);
for (const a in teams) {
  teams[a].paceRank = paceRank[a]; teams[a].drtgRank = drtgRank[a];
  teams[a].vsPosRank = {};
  for (const p of ['G', 'F', 'C']) { teams[a].vsPosRank[p] = {}; for (const k of ['pts', 'reb', 'ast', 'tpm']) teams[a].vsPosRank[p][k] = rankBy((t) => t.vsPos[p][k], false)[a]; } // 1 = allows the least
}
const out = { built: new Date().toISOString(), season: `${seasonStartYear}-${String(seasonStartYear + 1).slice(2)}`, games: parsed, source: 'ESPN box scores', league, teams, players };
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'nba-matchups.json'), JSON.stringify(out));
console.log(`teams ${list.length}, players ${Object.keys(players).length}, league pace ${league.pace}, size ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
