#!/usr/bin/env node
// Builds data/nhl-matchups.json from ESPN's public NHL box scores (current regular season):
//   - Team shot volume (SOG for / against per game), goals for / against (shootout excluded), power play & penalty kill
//   - Shots, goals and points allowed per game to forwards vs defensemen
//   - Goalie save % ; ESPN athlete id → position group (F / D / G)
// Usage: node scripts/build-nhl-matchups.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TEAMS } from '../js/teams.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const now = new Date();
const startYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
const ABBR = Object.fromEntries(TEAMS.nhl.map((t) => [String(t.espn), t.abbr]));

async function json(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (r.ok) return await r.json(); } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); }
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;

const ids = new Set(), days = [];
for (let d = new Date(Date.UTC(startYear, 9, 1)); d < now; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymd(d));
await pool(days, 6, async (day) => { const sb = await json(`${BASE}/scoreboard?dates=${day}`); for (const e of sb?.events || []) if (e.season?.type === 2 && e.status?.type?.completed) ids.add(e.id); });
console.log(`${ids.size} completed regular-season games`);

const T = {}, G = {}, players = {};
const blankPos = () => ({ sog: 0, g: 0, a: 0 });
const team = (a) => (T[a] ||= { games: 0, sf: 0, sa: 0, gf: 0, ga: 0, ppo: 0, ppg: 0, pko: 0, pkga: 0, allowed: { F: blankPos(), D: blankPos() } });
let parsed = 0;
await pool([...ids], 6, async (id) => {
  const s = await json(`${BASE}/summary?event=${id}`);
  const box = s?.boxscore;
  if (!box?.teams?.length || !box.players?.length) return;
  const side = {};
  for (const t of box.teams) {
    const st = Object.fromEntries(t.statistics.map((x) => [x.name, +x.displayValue || 0]));
    side[ABBR[String(t.team.id)]] = { sf: st.shotsTotal, ppo: st.powerPlayOpportunities, ppg: st.powerPlayGoals, goals: 0 };
  }
  const abbrs = Object.keys(side);
  if (abbrs.length !== 2 || abbrs.includes('undefined')) return;
  const perTeam = {};
  for (const pl of box.players) {
    const me = ABBR[String(pl.team.id)], opp = abbrs.find((a) => a !== me);
    for (const grp of pl.statistics || []) {
      const k = Object.fromEntries((grp.keys || []).map((key, i) => [key, i]));
      for (const a of grp.athletes || []) {
        if (!a.stats?.length) continue;
        const v = (key) => +a.stats[k[key]] || 0;
        if (grp.name === 'goalies') {
          if (a.athlete?.id) players[a.athlete.id] = 'G';
          const gg = (G[a.athlete.id] ||= { name: a.athlete.displayName, team: me, gp: 0, sa: 0, sv: 0 });
          if (v('shotsAgainst') > 0) { gg.gp++; gg.sa += v('shotsAgainst'); gg.sv += v('saves'); gg.team = me; }
          continue;
        }
        const pos = grp.name === 'defenses' ? 'D' : grp.name === 'forwards' ? 'F' : null;
        if (!pos) continue;
        if (a.athlete?.id) players[a.athlete.id] = pos;
        side[me].goals += v('goals');
        const al = (perTeam[opp] ||= { F: blankPos(), D: blankPos() })[pos];
        al.sog += v('shotsTotal'); al.g += v('goals'); al.a += v('assists');
      }
    }
  }
  const [A, B] = abbrs;
  for (const [me, them] of [[A, B], [B, A]]) {
    const t = team(me);
    t.games++; t.sf += side[me].sf; t.sa += side[them].sf; t.gf += side[me].goals; t.ga += side[them].goals;
    t.ppo += side[me].ppo; t.ppg += side[me].ppg; t.pko += side[them].ppo; t.pkga += side[them].ppg;
    for (const p of ['F', 'D']) { const al = perTeam[me]?.[p]; if (al) { t.allowed[p].sog += al.sog; t.allowed[p].g += al.g; t.allowed[p].a += al.a; } }
  }
  parsed++;
});
console.log(`parsed ${parsed} box scores`);

const teams = {};
for (const [a, t] of Object.entries(T)) {
  const per = (x) => r2(x / t.games);
  teams[a] = { games: t.games, sf: per(t.sf), sa: per(t.sa), gf: per(t.gf), ga: per(t.ga), pp: r3(t.ppg / (t.ppo || 1)), pk: r3(1 - t.pkga / (t.pko || 1)),
    vsPos: Object.fromEntries(['F', 'D'].map((p) => [p, { sog: per(t.allowed[p].sog), pts: per(t.allowed[p].g + t.allowed[p].a), g: per(t.allowed[p].g) }])) };
}
const list = Object.values(teams), avg = (f) => r2(list.reduce((s, t) => s + f(t), 0) / (list.length || 1));
const league = { sf: avg((t) => t.sf), gf: avg((t) => t.gf), vsPos: Object.fromEntries(['F', 'D'].map((p) => [p, { sog: avg((t) => t.vsPos[p].sog), pts: avg((t) => t.vsPos[p].pts), g: avg((t) => t.vsPos[p].g) }])) };
const rank = (f, desc) => Object.fromEntries(Object.keys(teams).sort((a, b) => (desc ? f(teams[b]) - f(teams[a]) : f(teams[a]) - f(teams[b]))).map((k, i) => [k, i + 1]));
const rk = { sfRank: rank((t) => t.sf, true), saRank: rank((t) => t.sa, false), gfRank: rank((t) => t.gf, true), gaRank: rank((t) => t.ga, false) };
for (const a in teams) for (const [k, m] of Object.entries(rk)) teams[a][k] = m[a]; // sa/ga rank 1 = allows the fewest
const goalies = Object.fromEntries(Object.entries(G).filter(([, g]) => g.gp >= 2).map(([id, g]) => [id, { name: g.name, team: g.team, gp: g.gp, svPct: r3(g.sv / (g.sa || 1)), saPerGame: r2(g.sa / g.gp) }]));
const out = { built: new Date().toISOString(), season: `${startYear}-${String(startYear + 1).slice(2)}`, games: parsed, source: 'ESPN box scores', league, teams, goalies, players };
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'nhl-matchups.json'), JSON.stringify(out));
console.log(`teams ${list.length}, goalies ${Object.keys(goalies).length}, players ${Object.keys(players).length}, league SOG ${league.sf} GF ${league.gf}, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
