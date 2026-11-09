// Demo slate: realistic, seeded odds across books so the whole app works with zero setup.
// Matchups/prices/logs are SIMULATED. Weather for outdoor venues is pulled LIVE from Open-Meteo when in range.
import { TEAMS, findTeam } from './teams.js';
import { forecast } from './weather.js';
import { weatherTotalAdj } from './factors.js';
import { toAm, normCdf } from './model.js';

export function rng(seed) {
  let a = typeof seed === 'string' ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0 : seed >>> 0;
  const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.n = (mu = 0, sd = 1) => mu + sd * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pois = (lam) => { let L = Math.exp(-lam), k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };
  return r;
}

const CFG = {
  nfl: { games: 8, rsd: 3.6, cap: 12, hfa: 1.5, msd: 13.5, total: 44.5, tsd: 13, sp: 'pts' },
  nba: { games: 8, rsd: 3.8, cap: 14, hfa: 2.5, msd: 12, total: 227.5, tsd: 18 },
  nhl: { games: 8, rsd: 0.3, cap: 0.8, hfa: 0.2, msd: 2.4, total: 6.0, tsd: 2.3, puck: 1.5 },
  mlb: { games: 6, rsd: 0.35, cap: 1, hfa: 0.15, msd: 4.3, total: 8.5, tsd: 4.2, puck: 1.5 },
};
const SB = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'espnbet', 'fanatics', 'betrivers', 'pinnacle'];

// Real players for familiarity; every number attached to them in demo mode is simulated.
const PLAYERS = {
  nba: [
    ['Shai Gilgeous-Alexander', 'OKC', { Points: [31.5, 7], Assists: [6.3, 2.4], 'Pts+Reb+Ast': [42.5, 8] }],
    ['Nikola Jokić', 'DEN', { Points: [28.5, 7], Rebounds: [12.5, 3.6], Assists: [10.2, 3.2] }],
    ['Victor Wembanyama', 'SAS', { Points: [25.5, 7], Rebounds: [11.8, 3.5], 'Blocks': [3.6, 1.8] }],
    ['Luka Dončić', 'LAL', { Points: [30.5, 8], Assists: [8.5, 3], '3-Pointers': [3.6, 1.7] }],
    ['Anthony Edwards', 'MIN', { Points: [27.5, 7.5], '3-Pointers': [3.9, 1.8] }],
    ['Jalen Brunson', 'NYK', { Points: [27, 7], Assists: [7, 2.5] }],
    ['Cade Cunningham', 'DET', { Points: [26, 7], Assists: [9.2, 3] }],
    ['Deni Avdija', 'POR', { Points: [19.5, 6], Rebounds: [7.4, 2.8], 'Pts+Reb+Ast': [31.5, 7] }],
    ['Stephen Curry', 'GSW', { Points: [25.5, 8], '3-Pointers': [4.4, 1.9] }],
    ['Tyrese Maxey', 'PHI', { Points: [26.5, 7], Assists: [6.4, 2.4] }],
  ],
  nfl: [
    ['Sam Darnold', 'SEA', { 'Pass Yards': [242.5, 55], 'Pass TDs': [1.7, 1] }],
    ['Jaxon Smith-Njigba', 'SEA', { 'Rec Yards': [88.5, 32], Receptions: [6.8, 2.4] }],
    ['Josh Allen', 'BUF', { 'Pass Yards': [236.5, 55], 'Rush Yards': [36.5, 18] }],
    ['Lamar Jackson', 'BAL', { 'Pass Yards': [224.5, 55], 'Rush Yards': [52.5, 24] }],
    ["Ja'Marr Chase", 'CIN', { 'Rec Yards': [86.5, 34], Receptions: [7.2, 2.5] }],
    ['Justin Jefferson', 'MIN', { 'Rec Yards': [84.5, 33], Receptions: [6.4, 2.3] }],
    ['Saquon Barkley', 'PHI', { 'Rush Yards': [86.5, 35], Receptions: [2.6, 1.4] }],
    ['Bijan Robinson', 'ATL', { 'Rush Yards': [82.5, 33], 'Rec Yards': [32.5, 20] }],
    ['Jahmyr Gibbs', 'DET', { 'Rush Yards': [74.5, 32], 'Rec Yards': [30.5, 19] }],
    ['Puka Nacua', 'LAR', { 'Rec Yards': [92.5, 33], Receptions: [7.6, 2.5] }],
  ],
  nhl: [
    ['Connor McDavid', 'EDM', { Points: [1.6, 1.1], 'Shots on Goal': [3.8, 1.8] }],
    ['Nathan MacKinnon', 'COL', { Points: [1.5, 1.1], 'Shots on Goal': [4.4, 2] }],
    ['Auston Matthews', 'TOR', { 'Shots on Goal': [4.6, 2], Goals: [0.6, 0.7] }],
    ['David Pastrňák', 'BOS', { 'Shots on Goal': [4.1, 1.9], Points: [1.2, 1] }],
    ['Nikita Kucherov', 'TBL', { Points: [1.5, 1.1], 'Shots on Goal': [3.3, 1.6] }],
    ['Matty Beniers', 'SEA', { 'Shots on Goal': [2.4, 1.4], Points: [0.7, 0.8] }],
    ['Kirill Kaprizov', 'MIN', { 'Shots on Goal': [4.2, 1.9], Points: [1.2, 1] }],
    ['Igor Shesterkin', 'NYR', { Saves: [27.5, 5.5] }],
  ],
  mlb: [
    ['Cal Raleigh', 'SEA', { 'Total Bases': [1.7, 1.6], 'Hits+Runs+RBIs': [1.9, 1.5] }],
    ['Julio Rodríguez', 'SEA', { Hits: [1.1, 0.9], 'Total Bases': [1.8, 1.5] }],
    ['Logan Gilbert', 'SEA', { Strikeouts: [7.1, 2.3] }],
    ['Aaron Judge', 'NYY', { 'Total Bases': [2.1, 1.8], 'Hits+Runs+RBIs': [2.4, 1.6] }],
    ['Shohei Ohtani', 'LAD', { 'Total Bases': [2.0, 1.7], 'Hits+Runs+RBIs': [2.4, 1.6] }],
    ['Bobby Witt Jr.', 'KC', { Hits: [1.3, 0.95], 'Total Bases': [2.0, 1.6] }],
    ['Paul Skenes', 'PIT', { Strikeouts: [7.4, 2.3] }],
    ['Juan Soto', 'NYM', { Hits: [1.0, 0.9], 'Hits+Runs+RBIs': [2.1, 1.5] }],
  ],
};

function slateTimes(sport, now) {
  const d = new Date(now);
  if (sport === 'mlb') return [17, 20, 23, 23.17, 1.67, 2.17].map((h, i) => Date.UTC(2027, 2, 26 + (i > 3 ? 1 : 0), Math.floor(h), Math.round((h % 1) * 60)));
  if (sport === 'nfl') {
    const sun = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    while (sun.getUTCDay() !== 0 || sun.getTime() + 18 * 36e5 < now) sun.setUTCDate(sun.getUTCDate() + 1);
    const b = sun.getTime();
    return [18, 18, 18, 18, 21.08, 21.42, 21.42, 25.33].map((h) => b + h * 36e5);
  }
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 24 * 36e5; // tonight ET = 00:00Z+
  const start = base + 23.5 * 36e5 < now ? base + 24 * 36e5 : base;
  return [0, 0, 0.5, 0.5, 1, 1, 2, 3].map((h) => start + h * 36e5);
}

const round5 = (a) => (Math.abs(a) < 100 ? a : Math.round(a / 5) * 5);
function bookPrice(r, p, book, vig) {
  // noise in log-odds space so favorites and dogs move realistically; ~5% of quotes are "stale" (slow to move)
  const lg = Math.log(p / (1 - p));
  const sd = book === 'pinnacle' ? 0.025 : r() < 0.012 ? 0.09 : 0.045;
  const pb = 1 / (1 + Math.exp(-(lg + r.n(0, sd))));
  const v = book === 'pinnacle' ? 0.022 : Math.max(0.03, vig + r.n(0, 0.006));
  const cap = (x) => Math.min(0.985, Math.max(0.012, x));
  let a = toAm(1 / cap(pb * (1 + v))), b = toAm(1 / cap((1 - pb) * (1 + v)));
  if (book !== 'pinnacle') { a = round5(a); b = round5(b); }
  const fix = (x) => (x > -100 && x < 100 ? (x >= 0 ? 100 : -100) : x);
  return [fix(a), fix(b)];
}

async function makeGames(sport, now, seed) {
  const r = rng(seed + sport);
  const c = CFG[sport];
  const teams = [...TEAMS[sport]];
  const rating = (t) => rng('rating' + t.name).n(0, c.rsd);
  // force PNW team + teams with featured players into the slate
  const featured = new Set(PLAYERS[sport].map((p) => p[1]));
  const pnw = teams.filter((t) => t.pnw);
  const prio = [...pnw, ...teams.filter((t) => featured.has(t.abbr) && !t.pnw)];
  const rest = teams.filter((t) => !prio.includes(t)).sort(() => r() - 0.5);
  const pool = [...prio, ...rest].slice(0, c.games * 2).sort(() => r() - 0.5);
  const times = slateTimes(sport, now);
  const games = [];
  for (let i = 0; i < c.games; i++) {
    let [H, A] = [pool[2 * i], pool[2 * i + 1]];
    if (A.pnw && !H.pnw) [H, A] = [A, H]; // PNW teams at home — it's our dashboard
    const time = new Date(times[i % times.length]).toISOString();
    // weather — live where possible
    let weather = null;
    if (H.roof !== 'd' && (sport === 'nfl' || sport === 'mlb')) {
      weather = await forecast(H.lat, H.lon, time);
      if (!weather) {
        const base = sport === 'mlb' ? 62 - (H.lat - 33) * 1.4 : 58 - (H.lat - 30) * 1.6;
        weather = { temp: Math.round(base + r.n(0, 6)), wind: Math.max(0, Math.round(r.n(8, 6))), gust: 0, dir: r() * 360, pop: Math.round(r() * 60), precip: r() < 0.25 ? 0.05 : 0, code: r() < 0.25 ? 61 : 3, live: false };
        weather.gust = weather.wind + Math.round(r() * 8);
      }
    }
    const mu = Math.max(-c.cap, Math.min(c.cap, rating(H) - rating(A) + c.hfa));
    const wxAdj = weatherTotalAdj(sport, weather, H.roof);
    const trueTotal = c.total + r.n(0, c.tsd * 0.12) + wxAdj;
    const mktMu = mu + r.n(0, c.msd * 0.03);
    const mktTotal = trueTotal - wxAdj * 0.5 + r.n(0, c.tsd * 0.03); // markets only half-price weather
    const pHomeMkt = normCdf(mktMu / c.msd);
    const spread = c.puck ? (mktMu > 0 ? -c.puck : c.puck) : -Math.round(mktMu * 2) / 2 || -0.5;
    const pHomeCover = normCdf((mktMu + spread) / c.msd);
    const totalLine = sport === 'nfl' || sport === 'nba' ? Math.round(mktTotal * 2) / 2 : Math.round(mktTotal - 0.5) + 0.5;
    const pOver = 1 - normCdf((totalLine - mktTotal) / c.tsd);
    const books = {};
    for (const bk of SB) {
      if (bk !== 'pinnacle' && r() < 0.08) continue; // some books haven't posted
      const [mh, ma] = bookPrice(r, pHomeMkt, bk, 0.045);
      const [sh, sa] = bookPrice(r, pHomeCover, bk, 0.045);
      const [ov, un] = bookPrice(r, pOver, bk, 0.045);
      books[bk] = { h2h: { home: mh, away: ma }, spreads: { home: { point: spread, price: sh }, away: { point: -spread, price: sa } }, totals: { over: { point: totalLine, price: ov }, under: { point: totalLine, price: un } } };
    }
    const homeTix = Math.round(Math.min(85, Math.max(18, 50 + mktMu / c.msd * 40 + r.n(0, 14))));
    const homeMoney = Math.round(Math.min(92, Math.max(10, homeTix + r.n(0, 14))));
    const moveStep = c.puck ? 0 : r.pick([-1, -0.5, 0, 0, 0.5, 1, 1.5]);
    const injuries = r() < 0.35 ? [{ team: r() < 0.5 ? 'home' : 'away', player: r.pick(INJ[sport]), status: r.pick(['Out', 'Doubtful', 'Questionable']), note: 'Simulated injury (ESPN injury feed unavailable) — check the official report before betting.', w: 0.5 + r() * 0.6 }] : [];
    const g = {
      id: `${sport}-${i}-${H.abbr}-${A.abbr}`, sport, demo: true, time,
      home: H.name, away: A.name, homeTeam: H, awayTeam: A, books, weather,
      current: { spread, total: totalLine },
      openLine: { spread: spread + moveStep, total: totalLine + (r() < 0.4 ? r.pick([-1, -0.5, 0.5, 1]) : 0), ml: { home: round5(toAm(1 / (normCdf((mktMu - moveStep * 0.8) / c.msd) * 1.022))), away: null } },
      rest: sport === 'nfl' ? { home: r() < 0.12 ? 13 : 6, away: r() < 0.12 ? 13 : 6 } : { home: r() < 0.2 ? 0 : r.int(1, 3), away: r() < 0.25 ? 0 : r.int(1, 3) },
      awayPrev: sport === 'nfl' ? A : r.pick(TEAMS[sport]),
      splits: { homeTix, homeMoney }, injuries,
      divisional: sport === 'nfl' && r() < 0.3,
      truth: { mu, trueTotal, wxAdj },
    };
    if (sport === 'nhl' && r() < 0.4) { const s = r() < 0.5 ? 'home' : 'away'; g.goalie = { text: `Backup in net for ${(s === 'home' ? H : A).abbr}`, note: 'Backup goalies average a ~.010 lower save %. Fade that team and nudge the total up.', lean: { m: 'side', s: s === 'home' ? 'away' : 'home', w: 0.7 } }; }
    if (sport === 'nba') { const ph = r.int(1, 30), pa = r.int(1, 30); g.pace = { text: `Pace rank ${ph} vs ${pa}`, note: ph <= 10 && pa <= 10 ? 'Two top-10 pace teams — more possessions, lean over.' : ph >= 21 && pa >= 21 ? 'Two bottom-10 pace teams — fewer possessions, lean under.' : 'No pace extreme.', lean: ph <= 10 && pa <= 10 ? { m: 'totals', s: 'over', w: 0.6 } : ph >= 21 && pa >= 21 ? { m: 'totals', s: 'under', w: 0.6 } : null }; }
    if (sport === 'mlb') { const gap = r.n(0, 1.1); g.pitchers = { text: gap > 0.6 ? `${H.abbr} ace vs ${A.abbr} back-end SP` : gap < -0.6 ? `${A.abbr} ace vs ${H.abbr} back-end SP` : 'Even matchup', note: 'Starting pitching is the single biggest driver of MLB prices. Simulated matchup quality.', lean: Math.abs(gap) > 0.6 ? { m: 'side', s: gap > 0 ? 'home' : 'away', w: 0.6 } : null }; }
    games.push(g);
  }
  return games;
}
const INJ = { nfl: ['Starting LT', 'WR1', 'Starting CB', 'Edge rusher', 'RB1'], nba: ['Starting PG', 'Starting C', 'Sixth man', 'Starting wing'], nhl: ['Top-line C', '1st-pair D', 'Top-6 winger'], mlb: ['Leadoff hitter', 'Cleanup hitter', 'Closer'] };

function makeProps(sport, games, seed) {
  const r = rng(seed + 'props' + sport);
  const props = [];
  for (const [player, abbr, markets] of PLAYERS[sport]) {
    const g = games.find((x) => x.homeTeam.abbr === abbr || x.awayTeam.abbr === abbr);
    if (!g) continue;
    const home = g.homeTeam.abbr === abbr;
    const opp = home ? g.awayTeam : g.homeTeam;
    for (const [stat, [mu, sd]] of Object.entries(markets)) {
      const small = mu < 4.5;
      let wxMult = 1;
      if (sport === 'nfl' && g.weather && g.homeTeam.roof !== 'd' && /Pass|Rec/.test(stat)) wxMult = 1 - Math.max(0, g.weather.wind - 10) * 0.012;
      const matchup = r.n(0, 0.07);
      const trueMu = mu * (1 + matchup) * wxMult * (home ? 1.02 : 0.98);
      const mktMu = mu * (1 + matchup * 0.4) * (1 - (1 - wxMult) * 0.4) + r.n(0, sd * 0.05);
      const line = small ? Math.max(0.5, Math.round(mktMu - 0.5) + 0.5) : Math.floor(mktMu) + 0.5;
      const pOver = 1 - normCdf((line - mktMu) / sd);
      const books = {};
      for (const bk of ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'espnbet', 'pinnacle']) {
        if (bk !== 'pinnacle' && r() < 0.15) continue;
        const [o, u] = bookPrice(r, pOver, bk, 0.07);
        books[bk] = { line, over: o, under: u };
      }
      const dfsLine = () => {
        const shift = small ? 0 : Math.round(r.n(0, sd * 0.07));
        return Math.max(0.5, line + shift);
      };
      // pick'em apps only post near-coin-flip lines; lopsided low-count markets (e.g. 1.5 hits at +200) aren't offered as standard picks
      if (!(small && Math.abs(pOver - 0.5) > 0.12)) {
        books.prizepicks = { line: dfsLine() };
        if (r() < 0.8) books.underdog = { line: dfsLine() };
      }
      const log = [];
      for (let k = 19; k >= 0; k--) {
        const hm = r() < 0.5;
        const v = small ? r.pois(Math.max(0.1, trueMu * (hm ? 1.03 : 0.97))) : Math.max(0, Math.round(r.n(trueMu * (hm ? 1.03 : 0.97), sd)));
        log.push({ d: k, opp: r.pick(TEAMS[sport]).abbr, home: hm, v });
      }
      props.push({ id: `${g.id}|${player}|${stat}`, sport, player, team: abbr, teamObj: home ? g.homeTeam : g.awayTeam, oppTeam: opp, opp: opp.abbr, home, gameId: g.id, time: g.time, stat, sd, books, log, game: g, demo: true });
    }
  }
  return props;
}

// Long shots for featured players: true probability → book "Yes" prices with a fat longshot margin (US books),
// Pinnacle posts Yes AND No. Probabilities are rough, player-type based.
function longProb(sport, player, markets) {
  const m = Object.keys(markets);
  if (sport === 'nfl') {
    if (m.includes('Pass Yards')) return { 'Anytime TD': /Allen|Lamar/.test(player) ? 0.33 : 0.1 };
    const rb = m.includes('Rush Yards');
    return { 'Anytime TD': rb ? 0.5 : 0.4, 'First TD': rb ? 0.12 : 0.1 };
  }
  if (sport === 'nhl') { if (m.includes('Saves')) return {}; const sog = markets['Shots on Goal']?.[0] || 2.5; const p = 1 - Math.exp(-sog * 0.11); return { 'Anytime Goal': p, 'First Goal': p * 0.17 }; }
  if (sport === 'nba') { const reb = markets.Rebounds?.[0] || 0, ast = markets.Assists?.[0] || 0; return reb >= 7 || ast >= 8 ? { 'Double-Double': Math.min(0.85, 0.2 + (Math.max(reb, ast) - 6) * 0.1) } : {}; }
  if (sport === 'mlb') return m.includes('Strikeouts') ? {} : { 'Home Run': /Judge|Ohtani|Raleigh/.test(player) ? 0.22 : 0.13 };
  return {};
}
function makeLongs(sport, games, seed) {
  const r = rng(seed + 'longs' + sport);
  const out = [];
  for (const [player, abbr, markets] of PLAYERS[sport]) {
    const g = games.find((x) => x.homeTeam.abbr === abbr || x.awayTeam.abbr === abbr);
    if (!g) continue;
    const home = g.homeTeam.abbr === abbr, opp = home ? g.awayTeam : g.homeTeam;
    for (const [stat, p] of Object.entries(longProb(sport, player, markets))) {
      const books = {};
      for (const bk of ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'espnbet', 'pinnacle']) {
        if (r() < 0.12 && bk !== 'pinnacle') continue;
        const lg = Math.log(p / (1 - p)) + r.n(0, bk === 'pinnacle' ? 0.03 : 0.1); // noise in log-odds space
        const pb = 1 / (1 + Math.exp(-lg));
        if (bk === 'pinnacle') { const [y, n] = bookPrice(r, p, 'pinnacle', 0.03); books[bk] = { yes: y, no: n }; }
        else {
          const m = 0.1 + r() * 0.08; // longshot margin on the Yes side; for heavy favorites apply it to the "No" share instead
          const implied = pb < 0.5 ? pb * (1 + m) : 1 - (1 - pb) / (1 + m);
          const a = toAm(1 / Math.min(0.95, implied)); books[bk] = { yes: Math.abs(a) < 100 ? -100 : round5(a) };
        }
      }
      out.push({ id: `${g.id}|${player}|${stat}`, kind: 'long', sport, player, stat, team: abbr, teamObj: home ? g.homeTeam : g.awayTeam, oppTeam: opp, opp: opp.abbr, home, gameId: g.id, time: g.time, game: g, books, log: [], demo: true });
    }
  }
  return out;
}

export async function demoSlate(now = Date.now()) {
  const seed = new Date(now).toISOString().slice(0, 10);
  const games = {}, props = {}, longs = {};
  await Promise.all(['nfl', 'nba', 'mlb', 'nhl'].map(async (s) => { games[s] = await makeGames(s, now, seed); props[s] = makeProps(s, games[s], seed); longs[s] = makeLongs(s, games[s], seed); }));
  return { games, props, longs, source: 'demo', fetchedAt: now };
}

export { findTeam };
