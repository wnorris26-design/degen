// Pricing math + the edge engine. Everything that decides "is this a good bet" lives here.
import { BOOKS, bookName } from './teams.js';

export const toDec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const toAm = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
export const imp = (a) => 1 / toDec(a);
export const probToAm = (p) => toAm(1 / Math.min(Math.max(p, 0.005), 0.995));
export const fmtAm = (a) => (a == null || isNaN(a) ? '—' : a > 0 ? '+' + a : '' + a);
export const fmtPct = (p, d = 1) => (p == null || isNaN(p) ? '—' : (p * 100).toFixed(d) + '%');
export const fmtPts = (x) => (x > 0 ? '+' + x : '' + x);
export const ev = (p, a) => p * toDec(a) - 1;
export function kelly(p, a, frac = 0.25) {
  const b = toDec(a) - 1;
  return Math.max(0, ((b * p - (1 - p)) / b) * frac);
}
export const normCdf = (x) => {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};
export function normInv(p) {
  // Acklam's approximation — accurate enough for line shifts
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  if (q < 0.02425) { const r = Math.sqrt(-2 * Math.log(q)); return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  if (q > 1 - 0.02425) return -normInv(1 - q);
  const r = q - 0.5, s = r * r;
  return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

// PrizePicks / Underdog-style fixed payouts. Break-even per leg = (1/payout)^(1/legs).
export const DFS_SLIPS = [
  { app: 'PrizePicks', type: '2-Pick Power', legs: 2, pay: 3 },
  { app: 'PrizePicks', type: '3-Pick Power', legs: 3, pay: 6 },
  { app: 'PrizePicks', type: '4-Pick Power', legs: 4, pay: 10 },
  { app: 'PrizePicks', type: '5-Pick Power', legs: 5, pay: 20 },
  { app: 'PrizePicks', type: '6-Pick Power', legs: 6, pay: 37.5 },
  { app: 'Underdog', type: '3-Pick Standard', legs: 3, pay: 6 },
  { app: 'Underdog', type: '5-Pick Standard', legs: 5, pay: 20 },
].map((s) => ({ ...s, breakEven: Math.pow(1 / s.pay, 1 / s.legs) }));
export const DFS_BREAKEVEN = Math.min(...DFS_SLIPS.map((s) => s.breakEven)); // best-case ≈ 54.6%

const WEIGHT = (k) => (BOOKS[k]?.kind === 'sharp' ? 3 : 1);

/**
 * Build the fair (no-vig) probability for one side of a two-way market from every book that
 * prices both sides at the same point. Sharp books (Pinnacle) carry 3× weight.
 */
export function consensus(pairs) {
  // pairs: [{book, a, b}] American odds for side A and side B
  let wsum = 0, psum = 0;
  const per = [];
  for (const { book, a, b } of pairs) {
    if (a == null || b == null) continue;
    const ia = imp(a), ib = imp(b);
    const pa = ia / (ia + ib);
    const w = WEIGHT(book);
    wsum += w; psum += pa * w;
    per.push({ book, pa, hold: ia + ib - 1 });
  }
  if (!wsum) return null;
  return { p: psum / wsum, n: per.length, per, avgHold: per.reduce((s, x) => s + x.hold, 0) / per.length };
}

const MARKET_LABEL = { h2h: 'Moneyline', spreads: 'Spread', totals: 'Total' };

/**
 * Turn one game's book-by-book prices into ranked opportunities.
 * game.books[bookKey] = { h2h:{home,away}, spreads:{home:{point,price},away:{point,price}}, totals:{over:{point,price},under:{point,price}} }
 */
export function analyzeGame(game) {
  const out = [];
  const books = Object.entries(game.books || {}).filter(([k]) => BOOKS[k]?.kind !== 'dfs');
  const sides = {
    h2h: [['home', 'away']],
    spreads: [['home', 'away']],
    totals: [['over', 'under']],
  };
  for (const market of ['h2h', 'spreads', 'totals']) {
    for (const [A, B] of sides[market]) {
      for (const [side, other] of [[A, B], [B, A]]) {
        // group by point so -3 and -3.5 are never mixed
        const byPoint = {};
        for (const [bk, m] of books) {
          const mk = m[market];
          if (!mk || mk[side] == null || mk[other] == null) continue;
          const price = market === 'h2h' ? mk[side] : mk[side].price;
          const oprice = market === 'h2h' ? mk[other] : mk[other].price;
          const point = market === 'h2h' ? 0 : mk[side].point;
          (byPoint[point] ||= []).push({ book: bk, a: price, b: oprice });
        }
        for (const [pointStr, pairs] of Object.entries(byPoint)) {
          if (pairs.length < 2) continue;
          const cons = consensus(pairs);
          if (!cons) continue;
          // Pinnacle informs the fair price but isn't bettable from the US, so it can't be the "best book"
          const bettable = pairs.filter((x) => BOOKS[x.book]?.kind !== 'sharp');
          if (!bettable.length) continue;
          const best = bettable.reduce((m, x) => (toDec(x.a) > toDec(m.a) ? x : m));
          const worst = bettable.reduce((m, x) => (toDec(x.a) < toDec(m.a) ? x : m));
          const point = +pointStr;
          const e = ev(cons.p, best.a);
          const pin = pairs.find((x) => x.book === 'pinnacle');
          const pinFair = pin ? imp(pin.a) / (imp(pin.a) + imp(pin.b)) : null;
          out.push({
            id: `${game.id}|${market}|${side}|${point}`,
            gameId: game.id, sport: game.sport, game, market, side, point,
            marketLabel: MARKET_LABEL[market],
            selection: selectionLabel(game, market, side, point),
            bestBook: best.book, bestPrice: best.a, worstPrice: worst.a,
            prices: Object.fromEntries(pairs.map((x) => [x.book, x.a])),
            fairP: cons.p, fairAm: probToAm(cons.p), breakEven: imp(best.a),
            ev: e, kelly: kelly(cons.p, best.a), nBooks: cons.n, hold: cons.avgHold,
            pinFair, cents: centsBetter(best.a, probToAm(cons.p)),
            open: market === 'h2h' ? game.openLine?.ml?.[side] : market === 'spreads' ? (side === 'home' ? game.openLine?.spread : game.openLine?.spread != null ? -game.openLine.spread : null) : game.openLine?.total,
          });
        }
      }
    }
  }
  return out;
}

export function selectionLabel(game, market, side, point) {
  const t = side === 'home' ? game.homeTeam : side === 'away' ? game.awayTeam : null;
  if (market === 'h2h') return `${t?.abbr || game[side]} ML`;
  if (market === 'spreads') return `${t?.abbr || game[side]} ${fmtPts(point)}`;
  return `${side === 'over' ? 'Over' : 'Under'} ${point}`;
}

// "Cents" of value — how many points of American odds better than fair the best price is.
export function centsBetter(price, fair) {
  const c = (x) => (x > 0 ? x - 100 : x + 100);
  return Math.round(c(price) - c(fair));
}

/** Prop analysis: books give O/U prices at a line; DFS apps give only a line with fixed payouts. */
export function analyzeProp(prop) {
  const bookPairs = Object.entries(prop.books).filter(([k]) => BOOKS[k]?.kind !== 'dfs');
  // consensus at the most common sportsbook line
  const lines = {};
  bookPairs.forEach(([k, v]) => (lines[v.line] ||= []).push({ book: k, a: v.over, b: v.under }));
  const main = Object.entries(lines).sort((a, b) => b[1].length - a[1].length)[0];
  if (!main) return null;
  const bookLine = +main[0];
  const cons = consensus(main[1]);
  if (!cons) return null;
  const pOver = cons.p;
  // implied mean via normal approx: P(X > line) = 1 - Φ((line - μ)/σ)
  const sd = prop.sd || Math.max(1, bookLine * 0.28);
  const mu = bookLine - sd * normInv(1 - pOver);
  const probAt = (line, dir) => {
    const po = 1 - normCdf((line - mu) / sd);
    return dir === 'over' ? po : 1 - po;
  };
  const bettable = main[1].filter((x) => BOOKS[x.book]?.kind !== 'sharp');
  const pool = bettable.length ? bettable : main[1];
  const sbBestOver = pool.reduce((m, x) => (toDec(x.a) > toDec(m.a) ? x : m));
  const sbBestUnder = pool.reduce((m, x) => (toDec(x.b) > toDec(m.b) ? x : m));
  const sbSide = ev(pOver, sbBestOver.a) >= ev(1 - pOver, sbBestUnder.b) ? 'over' : 'under';
  const sb = sbSide === 'over'
    ? { side: 'over', book: sbBestOver.book, price: sbBestOver.a, p: pOver, ev: ev(pOver, sbBestOver.a) }
    : { side: 'under', book: sbBestUnder.book, price: sbBestUnder.b, p: 1 - pOver, ev: ev(1 - pOver, sbBestUnder.b) };
  const dfs = Object.entries(prop.books).filter(([k]) => BOOKS[k]?.kind === 'dfs').map(([k, v]) => {
    const po = probAt(v.line, 'over');
    const side = po >= 0.5 ? 'over' : 'under';
    const p = side === 'over' ? po : 1 - po;
    return { book: k, line: v.line, side, p, edge: p - DFS_BREAKEVEN };
  }).sort((a, b) => b.edge - a.edge);
  return { bookLine, pOver, mu, sd, sb, dfs, nBooks: cons.n, hold: cons.avgHold };
}

export function hitRates(log, line, side = 'over') {
  const hit = (g) => (side === 'over' ? g.v > line : g.v < line);
  const rate = (arr) => (arr.length ? arr.filter(hit).length / arr.length : null);
  return {
    l5: rate(log.slice(-5)), l10: rate(log.slice(-10)), l20: rate(log.slice(-20)),
    home: rate(log.filter((g) => g.home)), away: rate(log.filter((g) => !g.home)),
    avg: log.length ? log.reduce((s, g) => s + g.v, 0) / log.length : null,
  };
}

/** Grade an opportunity 0–100 for sorting/badges: EV dominates, factors and book depth nudge. */
export function grade(o) {
  const evPts = Math.max(0, Math.min(1, o.ev / 0.08)) * 70;
  const factor = Math.max(-1, Math.min(1, (o.factorScore || 0) / 3)) * 20;
  const depth = Math.min(o.nBooks || 0, 7) / 7 * 10;
  return Math.round(Math.max(0, evPts + factor + depth));
}
export const tier = (g) => (g >= 70 ? { k: 'summit', label: 'Summit' } : g >= 50 ? { k: 'ridge', label: 'Ridge' } : g >= 30 ? { k: 'trail', label: 'Trail' } : { k: 'valley', label: 'Valley' });

export { bookName };

/**
 * Long-shot (Yes/No) pricing. Best case: de-vig books that post both Yes and No (usually Pinnacle) — that's a
 * true fair price. Otherwise US books only post "Yes", so we estimate fair as the median book's implied
 * probability with a 12% longshot margin removed (typical for TD / goal scorer markets) and label it an estimate.
 */
export const LONGSHOT_MARGIN = 0.12;
export function analyzeLongshot(l) {
  const sb = Object.entries(l.books).filter(([k]) => BOOKS[k]?.kind !== 'dfs');
  const yes = sb.filter(([, v]) => v.yes != null);
  if (!yes.length) return null;
  const two = sb.filter(([, v]) => v.yes != null && v.no != null).map(([book, v]) => ({ book, a: v.yes, b: v.no }));
  let fair, method;
  if (two.length) { fair = consensus(two).p; method = two.some((x) => x.book === 'pinnacle') ? 'pinnacle' : 'devig'; }
  else {
    const ims = yes.map(([, v]) => imp(v.yes)).sort((a, b) => a - b);
    const med = ims.length % 2 ? ims[(ims.length - 1) / 2] : (ims[ims.length / 2 - 1] + ims[ims.length / 2]) / 2;
    fair = med / (1 + LONGSHOT_MARGIN); method = 'estimate';
  }
  const bettable = yes.filter(([k]) => BOOKS[k]?.kind !== 'sharp');
  if (!bettable.length) return null;
  const [bestBook, bv] = bettable.reduce((m, x) => (toDec(x[1].yes) > toDec(m[1].yes) ? x : m));
  const worst = bettable.reduce((m, x) => (toDec(x[1].yes) < toDec(m[1].yes) ? x : m))[1].yes;
  return { fair, fairAm: probToAm(fair), method, bestBook, best: bv.yes, worst, ev: ev(fair, bv.yes), nBooks: bettable.length,
    prices: Object.fromEntries(bettable.map(([k, v]) => [k, v.yes])) };
}
