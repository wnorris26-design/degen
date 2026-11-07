// Live odds via The Odds API (the-odds-api.com). Covers DraftKings, FanDuel, BetMGM, Caesars,
// theScore/ESPN Bet, Fanatics, BetRivers, Pinnacle (eu region) and PrizePicks/Underdog (us_dfs region).
// Free tier: 500 credits/month. Cost per call ≈ markets × regions; naming up to 10 bookmakers counts as ONE region,
// so we request our books by name (cheaper, and no overseas books you can't bet at). Cached for 5 minutes.
import { SPORTS, BOOKS, findTeam } from './teams.js';
import { forecast } from './weather.js';

const BASE = 'https://api.the-odds-api.com/v4';
const CACHE = 'degen.odds.v1';
export const quota = { remaining: null, used: null };

const PROP_MARKETS = {
  nba: { player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: '3-Pointers', player_points_rebounds_assists: 'Pts+Reb+Ast' },
  nfl: { player_pass_yds: 'Pass Yards', player_rush_yds: 'Rush Yards', player_reception_yds: 'Rec Yards', player_receptions: 'Receptions' },
  mlb: { batter_hits: 'Hits', batter_total_bases: 'Total Bases', pitcher_strikeouts: 'Strikeouts' },
  nhl: { player_shots_on_goal: 'Shots on Goal', player_points: 'Points', player_total_saves: 'Saves' },
};
const PROP_BOOKS = Object.keys(BOOKS).join(','); // 8 sportsbooks + PrizePicks + Underdog = 10 → 1 region of cost
const PROP_SD = { 'Points': 7, Rebounds: 3.2, Assists: 2.6, '3-Pointers': 1.6, 'Pts+Reb+Ast': 8, 'Pass Yards': 55, 'Rush Yards': 25, 'Rec Yards': 28, Receptions: 2.2, Hits: 0.9, 'Total Bases': 1.5, Strikeouts: 2.3, 'Shots on Goal': 1.7, Saves: 5.5 };

async function get(path, params, key) {
  const qs = new URLSearchParams({ apiKey: key, oddsFormat: 'american', ...params });
  const url = `${BASE}${path}?${qs}`;
  const cacheKey = path + '?' + JSON.stringify(params);
  const all = JSON.parse(sessionStorage.getItem(CACHE) || '{}');
  const hit = all[cacheKey];
  if (hit && Date.now() - hit.t < 5 * 60e3) return hit.d;
  const r = await fetch(url);
  quota.remaining = r.headers.get('x-requests-remaining') ?? quota.remaining;
  quota.used = r.headers.get('x-requests-used') ?? quota.used;
  if (!r.ok) throw new Error(`Odds API ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  all[cacheKey] = { t: Date.now(), d };
  try { sessionStorage.setItem(CACHE, JSON.stringify(all)); } catch {}
  return d;
}

function mapEvent(sport, ev) {
  const homeTeam = findTeam(sport, ev.home_team) || { name: ev.home_team, abbr: ev.home_team.slice(0, 3).toUpperCase(), roof: 'o', lat: 0, lon: 0, tz: -5, alt: 0 };
  const awayTeam = findTeam(sport, ev.away_team) || { name: ev.away_team, abbr: ev.away_team.slice(0, 3).toUpperCase(), roof: 'o', lat: 0, lon: 0, tz: -5, alt: 0 };
  const books = {};
  for (const b of ev.bookmakers || []) {
    const o = (books[b.key] = {});
    for (const m of b.markets) {
      const find = (name) => m.outcomes.find((x) => x.name === name);
      if (m.key === 'h2h') o.h2h = { home: find(ev.home_team)?.price, away: find(ev.away_team)?.price };
      if (m.key === 'spreads') { const h = find(ev.home_team), a = find(ev.away_team); if (h && a) o.spreads = { home: { point: h.point, price: h.price }, away: { point: a.point, price: a.price } }; }
      if (m.key === 'totals') { const ov = find('Over'), un = find('Under'); if (ov && un) o.totals = { over: { point: ov.point, price: ov.price }, under: { point: un.point, price: un.price } }; }
    }
  }
  const dk = books.draftkings || Object.values(books)[0] || {};
  return { id: ev.id, sport, time: ev.commence_time, home: ev.home_team, away: ev.away_team, homeTeam, awayTeam, books,
    current: { spread: dk.spreads?.home?.point, total: dk.totals?.over?.point }, awayPrev: null, live: true };
}

export async function liveSlate(settings) {
  const key = settings.oddsApiKey;
  const bookmakers = Object.keys(BOOKS).filter((k) => BOOKS[k].kind === 'book' || (k === 'pinnacle' && settings.includeSharp)).join(',');
  const games = {}, props = {}, errors = [];
  await Promise.all(Object.entries(SPORTS).map(async ([s, meta]) => {
    games[s] = []; props[s] = [];
    if (!settings.sports[s]) return;
    try {
      const data = await get(`/sports/${meta.key}/odds`, { bookmakers, markets: 'h2h,spreads,totals' }, key);
      const horizon = Date.now() + 7 * 864e5;
      games[s] = data.filter((e) => new Date(e.commence_time) < horizon).slice(0, 16).map((e) => mapEvent(s, e));
      if (settings.includeBookFilter) {
        const keep = new Set(settings.books);
        games[s].forEach((g) => { for (const k of Object.keys(g.books)) if (!keep.has(k) && k !== 'pinnacle') delete g.books[k]; });
      }
      await Promise.all(games[s].map(async (g) => { if (g.homeTeam.roof !== 'd' && (s === 'nfl' || s === 'mlb') && g.homeTeam.lat) g.weather = await forecast(g.homeTeam.lat, g.homeTeam.lon, g.time); }));
      if (settings.fetchProps) props[s] = await liveProps(s, games[s].slice(0, settings.propEvents || 3), key);
    } catch (e) { errors.push(`${meta.label}: ${e.message}`); }
  }));
  return { games, props, source: 'live', fetchedAt: Date.now(), errors };
}

async function liveProps(sport, games, key) {
  const out = [];
  const markets = Object.keys(PROP_MARKETS[sport]).join(',');
  for (const g of games) {
    const ev = await get(`/sports/${SPORTS[sport].key}/events/${g.id}/odds`, { bookmakers: PROP_BOOKS, markets }, key).catch(() => null);
    if (!ev) continue;
    const by = {};
    for (const b of ev.bookmakers || []) for (const m of b.markets) for (const oc of m.outcomes) {
      if (!oc.description) continue;
      const id = `${g.id}|${oc.description}|${m.key}`;
      const p = (by[id] ||= { id, sport, player: oc.description, stat: PROP_MARKETS[sport][m.key], gameId: g.id, time: g.time, game: g, books: {}, log: [], live: true });
      const bk = (p.books[b.key] ||= { line: oc.point });
      if (oc.name === 'Over') bk.over = oc.price; else if (oc.name === 'Under') bk.under = oc.price;
    }
    for (const p of Object.values(by)) { p.sd = PROP_SD[p.stat] || 3; p.team = ''; p.opp = `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}`; out.push(p); }
  }
  return out;
}
