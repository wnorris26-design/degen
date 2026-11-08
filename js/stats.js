// Free, keyless player stats + injury reports from ESPN's public site API (CORS-enabled, works in the browser).
// Note: ESPN's API is undocumented/unofficial. It's free and widely used, but endpoints can change without notice.
//   search:    site.web.api.espn.com/apis/common/v3/search?query=NAME&type=player
//   game log:  site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{id}/gamelog[?season=YYYY]
//   injuries:  site.api.espn.com/apis/site/v2/sports/{sport}/{league}/injuries
const WEB = 'https://site.web.api.espn.com/apis/common/v3';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
export const ESPN_PATH = { nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };

const ID_KEY = 'degen.espn.ids', LOG_KEY = 'degen.espn.logs.v1';
const LOG_TTL = 3 * 36e5; // game logs: refresh every 3 hours
const seasonsOf = {}; // career seasons per athlete (from the gamelog's season filter)
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const ids = load(ID_KEY);
const logs = load(LOG_KEY);
const persist = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full: drop log cache */ if (k === LOG_KEY) localStorage.removeItem(LOG_KEY); } };

async function getJson(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('ESPN ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

/** Resolve a player name to an ESPN athlete id (cached forever in localStorage). */
export async function findAthlete(sport, name) {
  const key = sport + ':' + norm(name);
  if (ids[key] !== undefined) return ids[key];
  const j = await getJson(`${WEB}/search?query=${encodeURIComponent(name)}&limit=10&type=player`);
  const items = (j.items || []).filter((i) => i.league === sport);
  const hit = items.find((i) => norm(i.displayName) === norm(name)) || items[0];
  ids[key] = hit ? hit.id : null;
  persist(ID_KEY, ids);
  return ids[key];
}
export const headshot = (sport, id) => (id ? `https://a.espncdn.com/i/headshots/${sport}/players/full/${id}.png` : null);

// ---- stat extractors: prop market label -> value from a game-log row ----
const first = (v) => parseFloat(String(v).split('-')[0]);
const n = (r, k) => { const v = r[k]; return v == null || v === '' || v === '--' ? 0 : first(v); };
const STAT = {
  nba: { Points: (r) => n(r, 'points'), Rebounds: (r) => n(r, 'totalRebounds'), Assists: (r) => n(r, 'assists'), Blocks: (r) => n(r, 'blocks'), Steals: (r) => n(r, 'steals'),
    '3-Pointers': (r) => n(r, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'), 'Pts+Reb+Ast': (r) => n(r, 'points') + n(r, 'totalRebounds') + n(r, 'assists') },
  nfl: { 'Pass Yards': (r) => n(r, 'passingYards'), 'Pass TDs': (r) => n(r, 'passingTouchdowns'), 'Rush Yards': (r) => n(r, 'rushingYards'), 'Rec Yards': (r) => n(r, 'receivingYards'), Receptions: (r) => n(r, 'receptions') },
  nhl: { Points: (r) => n(r, 'points'), Goals: (r) => n(r, 'goals'), Assists: (r) => n(r, 'assists'), 'Shots on Goal': (r) => n(r, 'shotsTotal'), Saves: (r) => n(r, 'saves') },
  mlb: { Hits: (r) => n(r, 'hits'), 'Home Runs': (r) => n(r, 'homeRuns'), 'Total Bases': (r) => n(r, 'hits') + n(r, 'doubles') + 2 * n(r, 'triples') + 3 * n(r, 'homeRuns'),
    'Hits+Runs+RBIs': (r) => n(r, 'hits') + n(r, 'runs') + n(r, 'RBIs'), Strikeouts: (r) => n(r, 'strikeouts') },
};
export const supportsStat = (sport, stat) => !!STAT[sport]?.[stat];

function currentSeason(sport, d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  if (sport === 'nba' || sport === 'nhl') return m >= 8 ? y + 1 : y; // labelled by the year the season ends
  return m < 3 ? y - 1 : y;
}

function parseLog(j) {
  const out = [];
  for (const st of j.seasonTypes || []) {
    if (/preseason|spring|all-star/i.test(st.displayName)) continue;
    for (const cat of st.categories || []) {
      if (cat.type !== 'event') continue;
      for (const e of cat.events || []) {
        const meta = j.events?.[e.eventId];
        if (!meta) continue;
        const row = Object.fromEntries((j.names || []).map((nm, i) => [nm, e.stats[i]]));
        // MLB pitchers and NFL non-passers share keys with hitters/QBs; "innings" marks a pitcher row
        out.push({ id: e.eventId, date: meta.gameDate, opp: meta.opponent?.abbreviation || '?', oppId: meta.opponent?.id || null, oppName: meta.opponent?.displayName || '', home: meta.atVs !== '@', result: meta.gameResult, team: meta.team?.abbreviation, row, pitcher: 'innings' in row });
      }
    }
  }
  return out;
}

/** Last N games for an athlete (merges previous season if the current one is short). Oldest → newest. */
export async function rawLog(sport, athleteId, want = 20) {
  const key = sport + ':' + athleteId;
  const c = logs[key];
  if (c && Date.now() - c.t < LOG_TTL && c.seasons) { seasonsOf[key] = c.seasons; return c.g; }
  const base = `${WEB}/sports/${ESPN_PATH[sport]}/athletes/${athleteId}/gamelog`;
  const first = await getJson(base);
  seasonsOf[key] = (first.filters || []).find((f) => f.name === 'season')?.options?.map((o) => +o.value).filter(Boolean) || [];
  let games = parseLog(first);
  if (games.length < want) {
    const prev = await getJson(`${base}?season=${currentSeason(sport) - 1}`).catch(() => null);
    if (prev) games = games.concat(parseLog(prev));
  }
  const seen = new Set();
  games = games.filter((g) => !seen.has(g.id) && seen.add(g.id)).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-30);
  logs[key] = { t: Date.now(), g: games, seasons: seasonsOf[key] };
  persist(LOG_KEY, logs);
  return games;
}

/** Game log for one prop market, in the shape the app's hit-rate + chart code expects. */
export async function propLog(sport, player, stat) {
  const fn = STAT[sport]?.[stat];
  if (!fn) return null;
  const id = await findAthlete(sport, player);
  if (!id) return null;
  const games = await rawLog(sport, id);
  // pitchers' strikeouts vs hitters' strikeouts: keep the rows that match the role
  const rows = sport === 'mlb' && stat === 'Strikeouts' ? games.filter((g) => g.pitcher) : games;
  const log = rows.map((g, i) => ({ d: rows.length - 1 - i, date: g.date, opp: g.opp, home: g.home, v: fn(g.row) })).slice(-20);
  return { espnId: id, log, team: games[games.length - 1]?.team, last: games[games.length - 1]?.date };
}

// ---------------- career head-to-head ----------------
// Every regular/postseason game a player has played against one franchise, across their whole career.
// Past seasons never change, so we cache only the matching games (small) for 12 hours.
const H2H_KEY = 'degen.espn.h2h.v1', H2H_TTL = 12 * 36e5;
const h2hCache = load(H2H_KEY);
for (const k in h2hCache) if (Date.now() - h2hCache[k].t > H2H_TTL) delete h2hCache[k]; // prune stale entries
const careerSeasonCache = {}; // in-memory: parsed seasons for this page session

async function careerGames(sport, id) {
  const key = sport + ':' + id;
  await rawLog(sport, id); // also learns the season list
  const seasons = (seasonsOf[key] || []).slice(0, 12);
  const all = [];
  await pool(seasons, 4, async (yr) => {
    const ck = key + ':' + yr;
    careerSeasonCache[ck] ||= getJson(`${WEB}/sports/${ESPN_PATH[sport]}/athletes/${id}/gamelog?season=${yr}`).then(parseLog).catch(() => []);
    all.push(...(await careerSeasonCache[ck]));
  });
  const seen = new Set();
  return all.filter((g) => !seen.has(g.id) && seen.add(g.id)).sort((a, b) => new Date(a.date) - new Date(b.date));
}

/** Career games vs one opponent for a prop stat. oppTeam = {name, abbr, espn}. Oldest → newest. */
export async function h2hLog(sport, player, stat, oppTeam) {
  const fn = STAT[sport]?.[stat];
  if (!fn || !oppTeam) return null;
  const id = await findAthlete(sport, player);
  if (!id) return null;
  const ck = `${sport}:${id}:${oppTeam.espn || norm(oppTeam.name)}`;
  let games = h2hCache[ck] && Date.now() - h2hCache[ck].t < H2H_TTL ? h2hCache[ck].g : null;
  if (!games) {
    const all = await careerGames(sport, id);
    games = all.filter((g) => (oppTeam.espn ? g.oppId === String(oppTeam.espn) : norm(g.oppName) === norm(oppTeam.name)))
      .map(({ date, home, result, row, pitcher, opp }) => ({ date, home, result, row, pitcher, opp }));
    h2hCache[ck] = { t: Date.now(), g: games };
    persist(H2H_KEY, h2hCache);
  }
  const rows = sport === 'mlb' && stat === 'Strikeouts' ? games.filter((g) => g.pitcher) : games;
  return rows.map((g) => ({ date: g.date, home: g.home, opp: g.opp, v: fn(g.row) }));
}

// ---------------- injuries ----------------
let injCache = {};
const INJ_TTL = 30 * 60e3;
export async function injuries(sport) {
  const c = injCache[sport];
  if (c && Date.now() - c.t < INJ_TTL) return c.d;
  const j = await getJson(`${SITE}/${ESPN_PATH[sport]}/injuries`);
  const d = {};
  for (const team of j.injuries || []) {
    d[norm(team.displayName)] = (team.injuries || []).map((i) => ({
      player: i.athlete?.displayName, pos: i.athlete?.position?.abbreviation || '', status: i.status || i.type?.description || '',
      note: i.shortComment || i.longComment || '', returnDate: i.details?.returnDate || null, date: i.date,
    }));
  }
  injCache[sport] = { t: Date.now(), d };
  return d;
}
const INJ_ALIAS = { 'Los Angeles Clippers': 'LA Clippers', 'St Louis Blues': 'St. Louis Blues', 'Montréal Canadiens': 'Montreal Canadiens' };
export const teamInjuries = (all, teamName) => all?.[norm(teamName)] || all?.[norm(INJ_ALIAS[teamName] || '')] || [];

/** Run async jobs with limited concurrency so we don't hammer ESPN. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch { out[k] = null; } }
  }));
  return out;
}
