#!/usr/bin/env node
// Builds data/nfl-matchups.json from nflverse open data (https://github.com/nflverse/nflverse-data, CC-BY 4.0).
//   - Defensive scheme tendencies (man vs zone, coverage shells, blitz, pressure, 8-man boxes) from NGS-tagged
//     participation data. Coverage tags are only published for completed seasons, so this uses SCHEME_SEASON.
//   - Each defense's production allowed in the current season (yards per carry, pass yards per game, EPA/play).
//   - Player splits vs man vs zone (QBs: passing & scramble yards per dropback; receivers: targets & yards per
//     team dropback) and running backs by box count.
// Usage: node scripts/build-nfl-matchups.mjs [schemeSeason] [currentSeason]     (needs network to github.com)
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date();
const CURRENT = +(process.argv[3] || (now.getMonth() + 1 < 3 ? now.getFullYear() - 1 : now.getFullYear()));
const SCHEME = +(process.argv[2] || CURRENT - 1);
const REL = 'https://github.com/nflverse/nflverse-data/releases/download';
const CACHE = path.join(ROOT, '.cache', 'nflverse');
fs.mkdirSync(CACHE, { recursive: true });

async function download(rel) {
  const file = path.join(CACHE, path.basename(rel));
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 12 * 36e5) return file;
  const r = await fetch(`${REL}/${rel}`);
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
async function eachRow(file, cols, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let idx = null;
  for await (const line of rl) {
    const f = splitCsv(line);
    if (!idx) { idx = Object.fromEntries(cols.map((c) => [c, f.indexOf(c)])); continue; }
    const row = {};
    for (const c of cols) row[c] = idx[c] >= 0 ? f[idx[c]] : '';
    fn(row);
  }
}
const num = (x) => (x === '' || x === 'NA' || x == null ? 0 : +x);
const TEAM = (t) => (t === 'LA' ? 'LAR' : t); // nflverse uses LA for the Rams
const r3 = (x) => Math.round(x * 1000) / 1000;

console.log(`Scheme season ${SCHEME}, current season ${CURRENT}`);
const [partF, pbpF, curF, playersF] = await Promise.all([
  download(`pbp_participation/pbp_participation_${SCHEME}.csv`),
  download(`pbp/play_by_play_${SCHEME}.csv`),
  download(`pbp/play_by_play_${CURRENT}.csv`).catch(() => null),
  download('players/players.csv'),
]);

// ---- participation: coverage / box / rushers per play ----
const part = new Map();
await eachRow(partF, ['nflverse_game_id', 'play_id', 'defense_man_zone_type', 'defense_coverage_type', 'defenders_in_box', 'number_of_pass_rushers', 'was_pressure'], (r) => {
  part.set(r.nflverse_game_id + '|' + r.play_id, { cov: r.defense_man_zone_type === 'ZONE_COVERAGE' ? 'zone' : r.defense_man_zone_type === 'MAN_COVERAGE' ? 'man' : null, shell: r.defense_coverage_type, box: num(r.defenders_in_box) || null, rushers: num(r.number_of_pass_rushers) || null, pressure: r.was_pressure === 'TRUE' || r.was_pressure === '1' });
});
console.log('participation plays', part.size);

const PBP_COLS = ['game_id', 'play_id', 'season_type', 'posteam', 'defteam', 'qb_dropback', 'qb_scramble', 'qb_kneel', 'qb_spike', 'pass', 'rush', 'sack', 'two_point_attempt', 'passer_player_id', 'rusher_player_id', 'receiver_player_id', 'passing_yards', 'rushing_yards', 'receiving_yards', 'complete_pass', 'epa', 'pass_attempt'];

// ---- scheme season: defense tendencies + player splits ----
const D = {}; // defense tendencies
const QB = {}, REC = {}, RB = {};
const teamCovPlays = {}; // offense team → game → {zone, man}: team dropbacks by coverage (receiver denominators)
const recGames = {}; // receiver → team → Set(games)
const blank = () => ({ zone: 0, man: 0 });
await eachRow(pbpF, PBP_COLS, (r) => {
  if (r.season_type !== 'REG' || r.two_point_attempt === '1' || r.qb_kneel === '1' || r.qb_spike === '1') return;
  const p = part.get(r.game_id + '|' + r.play_id);
  if (!p) return;
  const def = TEAM(r.defteam), off = TEAM(r.posteam);
  const d = (D[def] ||= { db: 0, zone: 0, man: 0, shells: {}, blitz: 0, rushTagged: 0, pressure: 0, runs: 0, box8: 0, boxLight: 0 });
  if (r.qb_dropback === '1') {
    d.db++;
    if (p.pressure) d.pressure++;
    if (p.rushers) { d.rushTagged++; if (p.rushers >= 5) d.blitz++; }
    if (p.cov) {
      d[p.cov]++; if (p.shell) d.shells[p.shell] = (d.shells[p.shell] || 0) + 1;
      const g = ((teamCovPlays[off] ||= {})[r.game_id] ||= blank()); g[p.cov]++;
      if (r.passer_player_id) {
        const q = ((QB[r.passer_player_id] ||= { team: off, zone: { db: 0, pyd: 0, att: 0, scr: 0, epa: 0 }, man: { db: 0, pyd: 0, att: 0, scr: 0, epa: 0 } })[p.cov]);
        q.db++; q.pyd += num(r.passing_yards); q.att += num(r.pass_attempt) && r.sack !== '1' ? 1 : 0; q.epa += num(r.epa);
        if (r.qb_scramble === '1') q.scr += num(r.rushing_yards);
        QB[r.passer_player_id].team = off;
      } else if (r.qb_scramble === '1' && r.rusher_player_id) {
        const q = ((QB[r.rusher_player_id] ||= { team: off, zone: { db: 0, pyd: 0, att: 0, scr: 0, epa: 0 }, man: { db: 0, pyd: 0, att: 0, scr: 0, epa: 0 } })[p.cov]);
        q.db++; q.scr += num(r.rushing_yards); q.epa += num(r.epa);
      }
      if (r.receiver_player_id) {
        const w = ((REC[r.receiver_player_id] ||= { team: off, zone: { tgt: 0, rec: 0, yd: 0 }, man: { tgt: 0, rec: 0, yd: 0 } })[p.cov]);
        w.tgt++; w.rec += num(r.complete_pass); w.yd += num(r.receiving_yards);
        REC[r.receiver_player_id].team = off;
        (((recGames[r.receiver_player_id] ||= {})[off]) ||= new Set()).add(r.game_id);
      }
    }
  } else if (r.rush === '1' && r.qb_scramble !== '1') {
    d.runs++;
    if (p.box >= 8) d.box8++; else if (p.box && p.box <= 6) d.boxLight++;
    if (r.rusher_player_id && p.box) {
      const k = p.box >= 8 ? 'heavy' : p.box <= 6 ? 'light' : 'normal';
      const b = ((RB[r.rusher_player_id] ||= { team: off, light: { car: 0, yd: 0 }, normal: { car: 0, yd: 0 }, heavy: { car: 0, yd: 0 } })[k]);
      b.car++; b.yd += num(r.rushing_yards); RB[r.rusher_player_id].team = off;
    }
  }
});

// ---- current season: production allowed ----
const A = {};
if (curF) await eachRow(curF, PBP_COLS, (r) => {
  if (r.season_type !== 'REG' || r.two_point_attempt === '1' || r.qb_kneel === '1' || r.qb_spike === '1' || !r.defteam) return;
  const a = (A[TEAM(r.defteam)] ||= { games: new Set(), db: 0, pyd: 0, pepa: 0, car: 0, ryd: 0, repa: 0 });
  a.games.add(r.game_id);
  if (r.qb_dropback === '1') { a.db++; a.pyd += num(r.passing_yards); a.pepa += num(r.epa); }
  else if (r.rush === '1') { a.car++; a.ryd += num(r.rushing_yards); a.repa += num(r.epa); }
});

// ---- names ----
const names = {};
await eachRow(playersF, ['gsis_id', 'display_name', 'position'], (r) => { if (r.gsis_id) names[r.gsis_id] = { n: r.display_name, pos: r.position }; });

// ---- assemble ----
const rank = (obj, key, desc = true) => { const ks = Object.keys(obj).sort((a, b) => (desc ? obj[b][key] - obj[a][key] : obj[a][key] - obj[b][key])); return Object.fromEntries(ks.map((k, i) => [k, i + 1])); };
const teams = {};
for (const [t, d] of Object.entries(D)) {
  const tagged = d.zone + d.man;
  if (!tagged) continue;
  const shells = Object.entries(d.shells).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => [k.replace('COVER_', 'Cover ').replace('2_MAN', '2-Man'), r3(v / tagged)]);
  teams[t] = { zone: r3(d.zone / tagged), man: r3(d.man / tagged), shells, blitz: r3(d.blitz / (d.rushTagged || 1)), pressure: r3(d.pressure / (d.db || 1)), box8: r3(d.box8 / (d.runs || 1)), boxLight: r3(d.boxLight / (d.runs || 1)) };
}
for (const [k, key, desc] of [['zoneRank', 'zone', true], ['blitzRank', 'blitz', true], ['box8Rank', 'box8', true]]) { const rk = rank(teams, key, desc); for (const t in teams) teams[t][k] = rk[t]; }
const allowed = {};
for (const [t, a] of Object.entries(A)) { const g = a.games.size || 1; allowed[t] = { games: a.games.size, passYpg: Math.round(a.pyd / g), rushYpg: Math.round(a.ryd / g), ypc: r3(a.ryd / (a.car || 1)), passEpa: r3(a.pepa / (a.db || 1)), rushEpa: r3(a.repa / (a.car || 1)) }; }
for (const [k, key] of [['passRank', 'passYpg'], ['rushRank', 'rushYpg'], ['ypcRank', 'ypc']]) { const rk = rank(allowed, key, false); for (const t in allowed) allowed[t][k] = rk[t]; } // 1 = stingiest
for (const t in teams) teams[t].allowed = allowed[t] || null;

const players = {};
const put = (id, obj) => { const nm = names[id]; if (!nm) return; const key = nm.n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); players[key] = { ...(players[key] || {}), name: nm.n, pos: nm.pos, ...obj }; };
for (const [id, q] of Object.entries(QB)) {
  if (q.zone.db + q.man.db < 100) continue;
  const s = (x) => ({ db: x.db, ypdb: r3(x.pyd / (x.db || 1)), scr: r3(x.scr / (x.db || 1)), epa: r3(x.epa / (x.db || 1)) });
  put(id, { team: q.team, qb: { zone: s(q.zone), man: s(q.man) } });
}
for (const [id, w] of Object.entries(REC)) {
  if (w.zone.tgt + w.man.tgt < 20) continue;
  const den = blank();
  for (const [team, gs] of Object.entries(recGames[id] || {})) for (const g of gs) { const c = teamCovPlays[team]?.[g]; if (c) { den.zone += c.zone; den.man += c.man; } }
  const s = (x, n) => ({ tgt: x.tgt, n, tpd: r3(x.tgt / (n || 1)), rpd: r3(x.rec / (n || 1)), ypd: r3(x.yd / (n || 1)) }); // per team dropback in his games
  put(id, { team: w.team, rec: { zone: s(w.zone, den.zone), man: s(w.man, den.man) } });
}
for (const [id, b] of Object.entries(RB)) {
  if (b.light.car + b.normal.car + b.heavy.car < 40) continue;
  const s = (x) => ({ car: x.car, ypc: r3(x.yd / (x.car || 1)) });
  put(id, { team: b.team, rb: { light: s(b.light), normal: s(b.normal), heavy: s(b.heavy) } });
}

const out = { built: new Date().toISOString(), schemeSeason: SCHEME, currentSeason: curF ? CURRENT : null, source: 'nflverse (NGS participation + play-by-play), CC-BY 4.0', teams, players };
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'nfl-matchups.json'), JSON.stringify(out));
console.log(`teams ${Object.keys(teams).length}, players ${Object.keys(players).length}, size ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
