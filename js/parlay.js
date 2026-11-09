// Parlay builder: turns the best single legs into pick'em slips and same-book sportsbook parlays.
// Legs are assumed independent, so we never put two legs from the same game in one slip (that's where
// correlation lives). Parlay EV = (product of fair probabilities) × payout − 1.
import { DFS_SLIPS, toDec, toAm, imp, ev as evOf } from './model.js';
import { BOOKS } from './teams.js';

const prod = (a) => a.reduce((x, y) => x * y, 1);

/** Pick'em legs: one per player (their best DFS line), only where fair prob beats the slip break-even. */
export function dfsLegs(props) {
  const best = {};
  for (const o of props) for (const d of o.a?.dfs || []) {
    if (d.edge <= 0) continue;
    const leg = { kind: 'dfs', app: d.book, player: o.player, team: o.team || null, stat: o.stat, side: d.side, line: d.line, p: d.p, gameId: o.gameId, sport: o.sport, game: o.game, hr: o.hr, vs: o.side === d.side && o.line === d.line ? o.vs : null, id: `${o.id}|${d.book}` };
    const k = d.book + '|' + o.player;
    if (!best[k] || leg.p > best[k].p) best[k] = leg;
  }
  return Object.values(best).sort((a, b) => b.p - a.p);
}

/** Sportsbook legs at a specific book: game lines + props that are +EV at that book's own price. */
export function bookLegs(opps, props, book) {
  const legs = [];
  for (const o of opps) {
    const price = o.prices[book];
    if (price == null) continue;
    const e = evOf(o.fairP, price);
    if (e > 0) legs.push({ kind: 'line', book, label: o.selection, sub: `${o.game.awayTeam.abbr} @ ${o.game.homeTeam.abbr} · ${o.marketLabel}`, price, p: o.fairP, ev: e, gameId: o.gameId, sport: o.sport, id: o.id + '|' + book });
  }
  for (const o of props) {
    const b = o.books?.[book];
    if (!o.a || !b || b.line !== o.a.bookLine) continue;
    for (const [side, price, p] of [['over', b.over, o.a.pOver], ['under', b.under, 1 - o.a.pOver]]) {
      if (price == null) continue;
      const e = evOf(p, price);
      if (e > 0) legs.push({ kind: 'prop', book, label: `${o.player} ${side === 'over' ? 'o' : 'u'}${b.line} ${o.stat}`, sub: o.team ? `${o.team} ${o.home ? 'vs' : '@'} ${o.opp}` : o.opp, price, p, ev: e, gameId: o.gameId, sport: o.sport, hr: o.hr, vs: o.side === side && o.line === b.line ? o.vs : null, id: o.id + '|' + side + '|' + book });
    }
  }
  return legs.sort((a, b) => b.ev - a.ev);
}

// Greedy: take the strongest legs. Default: one leg per game (independent legs).
// sameGame: legs all come from one game — one per player, and (PrizePicks rule) both teams represented.
function pickLegs(legs, n, score, { sameGame = false } = {}) {
  const out = [], games = new Set(), players = new Set();
  for (const l of [...legs].sort((a, b) => score(b) - score(a))) {
    if ((!sameGame && games.has(l.gameId)) || (l.player && players.has(l.player))) continue;
    out.push(l); games.add(l.gameId); if (l.player) players.add(l.player);
    if (out.length === n) break;
  }
  if (out.length < n) return null;
  if (sameGame) {
    const teams = new Set(out.map((l) => l.team).filter(Boolean));
    if (out.every((l) => l.team) && teams.size < 2) {
      // swap the weakest leg for the best leg from the other team, if there is one
      const other = [...legs].sort((a, b) => score(b) - score(a)).find((l) => l.team && !teams.has(l.team) && !players.has(l.player));
      if (!other) return null;
      out[out.length - 1] = other;
    }
  }
  return out;
}

export function buildDfsSlips(props, { sameGame = false } = {}) {
  const legs = dfsLegs(props);
  const slips = [];
  for (const s of DFS_SLIPS) {
    const pool = legs.filter((l) => l.app === (s.app === 'PrizePicks' ? 'prizepicks' : 'underdog'));
    const chosen = pickLegs(pool, s.legs, (l) => l.p, { sameGame });
    if (!chosen) continue;
    const pAll = prod(chosen.map((l) => l.p));
    slips.push({ type: 'dfs', app: s.app, book: chosen[0].app, name: `${s.app} ${s.type}`, legs: chosen, pay: s.pay, pAll, ev: s.pay * pAll - 1, breakEven: s.breakEven, odds: toAm(s.pay), sameGame });
  }
  return slips.sort((a, b) => b.ev - a.ev);
}

export function buildBookParlays(opps, props, books = Object.keys(BOOKS).filter((k) => BOOKS[k].kind === 'book')) {
  const out = [];
  for (const book of books) {
    const legs = bookLegs(opps, props, book);
    for (const n of [2, 3, 4]) {
      const chosen = pickLegs(legs, n, (l) => l.ev);
      if (!chosen) continue;
      const dec = prod(chosen.map((l) => toDec(l.price)));
      const pAll = prod(chosen.map((l) => l.p));
      out.push({ type: 'book', book, name: `${n}-leg parlay`, legs: chosen, dec, odds: toAm(dec), pAll, ev: pAll * dec - 1, impliedAll: 1 / dec });
    }
  }
  return out.sort((a, b) => b.ev - a.ev);
}

export { imp };
