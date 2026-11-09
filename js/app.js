import { SPORTS, BOOKS, bookName, TEAMS } from './teams.js';
import { analyzeLongshot, analyzeGame, analyzeProp, hitRates, grade, tier, fmtAm, fmtPct, imp, kelly, toDec, DFS_SLIPS, DFS_BREAKEVEN, probToAm } from './model.js';
import { gameFactors, factorScore, weatherTotalAdj } from './factors.js';
import { demoSlate, rng } from './demo.js';
import { liveSlate, quota, loadGameProps, PROP_COST, loadGameLongshots, LONG_COST } from './live.js';
import { forecast, wxLabel, compass } from './weather.js';
import * as store from './store.js';
import { lineChart, hbars, logBars, ring, hydrate, sparkline } from './charts.js';
import { loadScheme, schemeAdjust, defenseLine, schemeData } from './scheme.js';
import { buildDfsSlips, buildBookParlays, buildLongParlays } from './parlay.js';
import { h2hLog, propLog, injuries, teamInjuries, supportsStat, pool, headshot } from './stats.js';

const { settings } = store;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, sign = false) => (v == null || isNaN(v) ? '—' : (sign && v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }));
const pctS = (v, d = 1) => (v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const sc = (s) => `var(--${s})`;
const time = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dateS = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const state = { focus: (() => { try { return localStorage.getItem('degen.focus'); } catch { return null; } })(), slate: null, loading: false, sport: localStorage.getItem('degen.sport') || 'all', opps: [], props: [], lines: { market: 'all', evOnly: true, q: '' }, propf: { sort: 'edge', venue: 'all', q: '', game: '' }, longf: { stat: 'all', sort: 'ev' }, longs: [], parlay: { book: 'all' }, slips: [], log: { status: 'all', q: '' }, homeWx: null };

// ---------------- data ----------------
async function load(force = false) {
  state.loading = true; $('#refreshBtn').classList.add('spin'); renderTop();
  try {
    if (settings.mode === 'live' && settings.oddsApiKey) {
      if (force) sessionStorage.removeItem('degen.odds.v1');
      state.slate = await liveSlate(settings);
      if (state.slate.errors?.length) toast('Some feeds failed: ' + state.slate.errors[0]);
      const total = Object.values(state.slate.games).flat().length;
      if (!total) toast('Live feed returned no games right now — check your key, sports or the schedule.');
    } else state.slate = await demoSlate();
  } catch (e) {
    toast('Live odds failed (' + e.message + '). Showing demo slate.');
    state.slate = await demoSlate();
  }
  compute();
  state.loading = false; $('#refreshBtn').classList.remove('spin');
  render();
  enrichReal();
}

// Real injury reports + player game logs from ESPN (free, no key). Runs after first paint.
async function enrichReal() {
  if (!settings.realStats || !state.slate) return;
  const slate = state.slate;
  state.enriching = true; renderTop();
  let injOk = 0, logOk = 0;
  await Promise.all(Object.entries(slate.games).filter(([, gs]) => gs.length).map(async ([s, gs]) => {
    const all = await injuries(s).catch(() => null);
    if (!all) return;
    injOk++;
    for (const g of gs) g.injuries = injuryFactors(g, all);
  }));
  const props = [...Object.values(slate.props).flat(), ...Object.values(slate.longs || {}).flat()].filter((p) => supportsStat(p.sport, p.stat) && !p.realLog);
  await pool(props, 6, async (p) => {
    const r = await propLog(p.sport, p.player, p.stat);
    if (!r || r.log.length < 3) return;
    p.log = r.log; p.espnId = r.espnId; p.realLog = true; logOk++;
    if (!p.team && r.team && p.game) {
      const m = (t) => t.abbr === r.team || t.abbr.startsWith(r.team) || r.team.startsWith(t.abbr.slice(0, 2));
      const home = m(p.game.homeTeam) && !m(p.game.awayTeam) ? true : m(p.game.awayTeam) && !m(p.game.homeTeam) ? false : null;
      if (home != null) { p.home = home; p.team = (home ? p.game.homeTeam : p.game.awayTeam).abbr; p.opp = (home ? p.game.awayTeam : p.game.homeTeam).abbr; p.oppTeam = home ? p.game.awayTeam : p.game.homeTeam; }
    }
  });
  if (state.slate !== slate) return; // a refresh replaced the slate meanwhile
  state.enriching = false; state.realInfo = { injOk, logOk, total: props.length };
  compute(); state.keepScroll = true; render();
  // career head-to-head vs tonight's opponent (slower: one request per career season, cached)
  const withOpp = props.filter((p) => p.realLog && p.oppTeam && !p.h2h);
  if (withOpp.length) {
    state.enriching = 'h2h'; renderTop();
    await pool(withOpp, 3, async (p) => { const h = await h2hLog(p.sport, p.player, p.stat, p.oppTeam).catch(() => null); if (h) p.h2h = h; });
    if (state.slate !== slate) return;
    state.enriching = false; compute(); state.keepScroll = true; render();
  }
  if (props.length && !logOk) toast('Couldn\'t reach ESPN for real game logs — showing simulated logs.');
}

function longTable(rows) {
  if (!rows.length) return '';
  const hitCell = (n, hits, label) => (n ? `<span class="${hits / n >= 0.5 ? 'pos' : ''}" data-tip="${esc(label)}">${hits}/${n}</span>` : '<span class="mut">—</span>');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>Market</th><th class="r">Best price</th><th class="r" data-tip="Pinnacle = true no-vig price. est. = median book with a 12% long-shot margin removed">Fair</th><th class="r">Edge</th><th>Other books</th><th class="r" data-tip="Games with at least one (TD / goal / HR / double-double)">L10</th><th class="r">L20</th><th class="r" data-tip="Career games vs this opponent">vs opp</th><th></th></tr></thead><tbody>
    ${rows.map((o) => { const a = o.a, l10 = (o.log || []).slice(-10), l20 = (o.log || []).slice(-20); const hit = (arr) => arr.filter((g) => g.v > 0.5).length;
      return `<tr><td><b>${esc(o.player)}</b><div class="mut" style="font-size:11.5px">${sportTag(o.sport)} ${o.team ? `${esc(o.team)} ${o.home ? 'vs' : '@'} ${esc(o.opp)}` : esc(o.opp)}</div></td>
      <td>${esc(o.stat)}${/^First/.test(o.stat) ? '<div class="mut" style="font-size:11px">logs = scored any</div>' : ''}</td>
      <td class="r"><span class="odds-cell best">${fmtAm(a.best)}</span><div style="margin-top:4px">${bookBadge(a.bestBook)}</div></td>
      <td class="r num">${fmtAm(a.fairAm)}<div class="mut" style="font-size:11px">${fmtPct(a.fair)} · ${a.method === 'estimate' ? 'est.' : a.method === 'pinnacle' ? 'Pinnacle' : 'no-vig'}</div></td>
      <td class="r">${evPill(a.ev)}</td>
      <td><div class="fchips">${Object.entries(a.prices).filter(([k]) => k !== a.bestBook).map(([k, v]) => `<span class="fchip" data-tip="${esc(bookName(k))}">${esc(BOOKS[k]?.short || k)} ${fmtAm(v)}</span>`).join('')}</div></td>
      <td class="r num">${hitCell(l10.length, hit(l10), 'Last 10 games')}</td><td class="r num">${hitCell(l20.length, hit(l20), 'Last 20 games')}</td>
      <td class="r num">${o.vs ? hitCell(o.vs.n, o.vs.hits, `Career vs ${o.opp} since ${o.vs.first || '—'}`) : '<span class="mut">—</span>'}</td>
      <td class="r"><button class="btn sm" data-act="loglong" data-id="${esc(o.id)}">Log</button></td></tr>`; }).join('')}
  </tbody></table></div>`;
}

function longPlan() {
  const now = Date.now();
  const games = allGames().filter((g) => new Date(g.time) - now < 24 * 36e5);
  const todo = games.filter((g) => !g.longsLoadedAt);
  return { games, todo, cost: todo.reduce((t, g) => t + LONG_COST[g.sport], 0) };
}
async function scanLongs(gameIds) {
  const todo = gameIds ? allGamesAll().filter((g) => gameIds.includes(g.id) && !g.longsLoadedAt) : longPlan().todo;
  const cost = todo.reduce((t, g) => t + LONG_COST[g.sport], 0);
  if (!todo.length || state.scanning) return;
  const left = quota.remaining != null ? +quota.remaining : null;
  if (left != null && cost > left) return toast(`Needs ${cost} credits but only ${left} are left.`);
  if (cost >= 15 && !confirm(`Load long shots for ${todo.length} games (${cost} credits${left != null ? `, ${left} left` : ''})?`)) return;
  state.scanning = { done: 0, total: todo.length }; state.keepScroll = true; render();
  let n = 0;
  await pool(todo, 3, async (g) => {
    const ls = await loadGameLongshots(g.sport, g, settings.oddsApiKey).catch(() => []);
    const list = ((state.slate.longs ||= {})[g.sport] ||= []);
    const have = new Set(list.map((x) => x.id));
    list.push(...ls.filter((x) => !have.has(x.id))); n += ls.length; state.scanning.done++;
  });
  state.scanning = null; compute(); state.keepScroll = true; render();
  toast(n ? `Loaded ${n} long shots · ${quota.remaining ?? '?'} credits left` : 'Books haven\'t posted these markets yet — try closer to game time.');
  enrichReal();
}

function scanPlan() {
  const now = Date.now();
  const games = allGames().filter((g) => new Date(g.time) - now < 24 * 36e5);
  const todo = games.filter((g) => !g.propsLoadedAt);
  return { games, todo, cost: todo.reduce((t, g) => t + PROP_COST[g.sport], 0) };
}
function scanCard() {
  if (state.slate?.source !== 'live') return '';
  const { games, todo, cost } = scanPlan();
  const sc2 = state.scanning;
  return `<div class="card scan" style="margin-bottom:18px"><div class="scan-row">
    <div class="scan-ic">🔭</div>
    <div class="grow"><h3 style="margin:0;font:600 18px var(--font-display)">Prop scanner</h3>
      <div class="mut" style="font-size:12.5px">Checks every ${state.sport === 'all' ? '' : SPORTS[state.sport].label + ' '}game in the next 24 hours, ranks the best props and builds parlays. ${games.length - todo.length}/${games.length} games scanned · <b>${quota.remaining ?? '—'}</b> credits left · results stay free for 20 min.</div></div>
    <button class="btn primary" data-act="scan" ${sc2 || !todo.length ? 'disabled' : ''}>${sc2 ? `Scanning ${sc2.done}/${sc2.total}…` : todo.length ? `Scan ${todo.length} game${todo.length > 1 ? 's' : ''} · ${cost} credits` : games.length ? 'All scanned ✓' : 'No games in 24h'}</button>
  </div></div>`;
}
async function scanProps() {
  const { todo, cost } = scanPlan();
  if (!todo.length || state.scanning) return;
  const left = quota.remaining != null ? +quota.remaining : null;
  if (left != null && cost > left) return toast(`This scan needs ${cost} credits but only ${left} are left. Pick one sport with the chips at the top to scan less.`);
  if (cost >= 40 && !confirm(`Scan ${todo.length} games for ${cost} credits${left != null ? ` (${left} left this month)` : ''}?\n\nTip: pick one sport with the chips at the top to scan fewer games.`)) return;
  state.scanning = { done: 0, total: todo.length }; state.keepScroll = true; render();
  let n = 0;
  await pool(todo, 3, async (g) => {
    const ps = await loadGameProps(g.sport, g, settings.oddsApiKey).catch(() => []);
    const list = (state.slate.props[g.sport] ||= []);
    const have = new Set(list.map((p) => p.id));
    list.push(...ps.filter((p) => !have.has(p.id)));
    n += ps.length; state.scanning.done++; state.keepScroll = true; renderTop(); const btn = document.querySelector('[data-act="scan"]'); if (btn) btn.textContent = `Scanning ${state.scanning.done}/${state.scanning.total}…`;
  });
  state.scanning = null;
  compute(); state.keepScroll = true; render();
  toast(n ? `Scanned ${todo.length} games · ${n} props · ${quota.remaining ?? '?'} credits left` : 'Books haven\'t posted props for these games yet — try closer to game time.');
  enrichReal();
}

async function loadProps(gameId) {
  const g = allGames().find((x) => x.id === gameId);
  if (!g || state.loadingProps) return;
  state.loadingProps = gameId; state.keepScroll = true; render();
  try {
    const ps = await loadGameProps(g.sport, g, settings.oddsApiKey);
    const list = (state.slate.props[g.sport] ||= []);
    const have = new Set(list.map((p) => p.id));
    list.push(...ps.filter((p) => !have.has(p.id)));
    state.propf.game = gameId;
    toast(ps.length ? `Loaded ${ps.length} props for ${matchup(g)} · ${quota.remaining ?? '?'} credits left` : `Books haven't posted props for ${matchup(g)} yet — try closer to game time.`);
  } catch (e) { toast('Couldn\'t load props: ' + e.message); }
  state.loadingProps = null;
  compute(); state.keepScroll = true; render();
  enrichReal(); // pull real ESPN game logs for the new players
}

function injuryFactors(g, all) {
  const out = [];
  for (const side of ['home', 'away']) {
    const team = side === 'home' ? g.homeTeam : g.awayTeam;
    const list = teamInjuries(all, team.name).filter((i) => !/^active$|probable/i.test(i.status || '')).map((i) => {
      const s = (i.status || '').toLowerCase();
      let x = /^out|suspen/.test(s) ? 0.35 : /doubt/.test(s) ? 0.25 : /quest|day-to-day/.test(s) ? 0.08 : 0.05;
      if (g.sport === 'nfl' && i.pos === 'QB') x *= 3;
      if (g.sport === 'nhl' && i.pos === 'G') x *= 1.6;
      const away = i.returnDate ? new Date(i.returnDate) - Date.now() : 0;
      if (away > 21 * 864e5 || /injured reserve|60-day|season|physically unable/.test(s + ' ' + (i.note || '').toLowerCase())) x *= 0.08; // long-term: already priced in
      return { ...i, x };
    }).sort((a, b) => b.x - a.x);
    if (!list.length) continue;
    const w = Math.min(1.5, list.reduce((t, i) => t + i.x, 0) * 0.5);
    out.push({ team: side, real: true, count: list.length, top: list.slice(0, 4), w: Math.round(w * 10) / 10 });
  }
  return out;
}

function h2hSummary(log, line, side) {
  const hit = (g) => (side === 'over' ? g.v > line : g.v < line);
  const sum = (arr) => ({ n: arr.length, hits: arr.filter(hit).length, rate: arr.length ? arr.filter(hit).length / arr.length : null, avg: arr.length ? arr.reduce((t, g) => t + g.v, 0) / arr.length : null });
  const cutoff = Date.now() - 3 * 365 * 864e5;
  return { ...sum(log), recent: sum(log.filter((g) => new Date(g.date) >= cutoff)), first: log[0]?.date?.slice(0, 4), last5: log.slice(-5), log };
}

function compute() {
  const opps = [], props = [];
  for (const [sport, games] of Object.entries(state.slate.games)) {
    for (const g of games) {
      g.factors = gameFactors(g);
      if (sport === 'nfl' && schemeData()) for (const [side, t] of [['home', g.homeTeam], ['away', g.awayTeam]]) {
        const line = defenseLine(t.abbr);
        if (line) g.factors.push({ key: 'scheme', icon: '🛡', label: `${t.abbr} defense`, value: line.split(' · ').slice(0, 2).join(' · '), note: `${line}. Scheme tendencies from the ${schemeData().schemeSeason} season (coverage charting for the current season isn't public yet); yards allowed are this season. Player props factor in how each player performs against this defense's coverage mix.`, lean: null, side });
      }
      for (const o of analyzeGame(g)) {
        const fs = factorScore(o, g.factors);
        o.factorScore = fs.score; o.factorHits = fs.hits; o.kind = 'line';
        o.grade = grade(o);
        opps.push(o);
      }
    }
    for (const p of state.slate.props[sport] || []) {
      const a = analyzeProp(p);
      if (!a) continue;
      const dfsBest = a.dfs[0];
      const dfsEv = dfsBest ? dfsBest.p / DFS_BREAKEVEN - 1 : -1;
      const useDfs = dfsBest && dfsEv > a.sb.ev;
      const side = useDfs ? dfsBest.side : a.sb.side;
      const line = useDfs ? dfsBest.line : a.bookLine;
      const o = { ...p, kind: 'prop', a, useDfs, side, line, ev: Math.max(a.sb.ev, dfsEv), p: useDfs ? dfsBest.p : a.sb.p,
        hr: hitRates(p.log || [], line, side), nBooks: a.nBooks, factorScore: 0 };
      // hit-rate agreement nudges the factor score for props
      if (o.hr.l10 != null) o.factorScore = Math.round(((o.hr.l10 - 0.5) * 4 + ((o.hr.l20 ?? 0.5) - 0.5) * 2) * 10) / 10;
      o.vs = p.h2h ? h2hSummary(p.h2h, line, side) : null;
      o.scheme = schemeAdjust(o);
      if (o.scheme) o.factorScore = Math.round((o.factorScore + Math.max(-1.5, Math.min(1.5, (o.scheme.delta / Math.max(1, line)) * 12)) * (side === 'over' ? 1 : -1)) * 10) / 10;
      // matchup history nudges the factor score, weighted toward recent seasons and shrunk for small samples
      if (o.vs?.n) { const r = o.vs.recent.n >= 3 ? o.vs.recent : o.vs; o.factorScore = Math.round((o.factorScore + (r.rate - 0.5) * 3 * (r.n / (r.n + 6))) * 10) / 10; }
      o.grade = grade(o);
      props.push(o);
    }
  }
  const longs = [];
  for (const [, ls] of Object.entries(state.slate.longs || {})) for (const l of ls) {
    const a = analyzeLongshot(l);
    if (!a) continue;
    longs.push({ ...l, a, ev: a.ev, hr: hitRates(l.log || [], 0.5, 'over'), vs: l.h2h ? h2hSummary(l.h2h, 0.5, 'over') : null });
  }
  state.opps = opps; state.props = props; state.longs = longs;
}

const bySport = (arr) => (state.sport === 'all' ? arr : arr.filter((x) => x.sport === state.sport));
const allGames = () => bySport(Object.values(state.slate?.games || {}).flat());
const allGamesAll = () => Object.values(state.slate?.games || {}).flat();

// ---------------- explanation engine ----------------
function whyLine(o) {
  const b = [];
  const others = Object.entries(o.prices).filter(([k]) => k !== o.bestBook);
  b.push(`<b>${bookName(o.bestBook)} ${fmtAm(o.bestPrice)}</b> is the best of ${o.nBooks} books${others.length ? ` (worst: ${fmtAm(o.worstPrice)})` : ''}. Strip out the vig and the market's fair price is <b>${fmtAm(o.fairAm)}</b>.`);
  b.push(`At ${fmtAm(o.bestPrice)} you need to win <b>${fmtPct(o.breakEven)}</b> to break even; the market says this hits <b>${fmtPct(o.fairP)}</b> — ${o.ev > 0 ? `an edge of <b class="pos">${pctS(o.ev)}</b> per dollar.` : `<b class="neg">no edge</b> (${pctS(o.ev)}).`}`);
  if (o.pinFair != null) b.push(o.pinFair > o.breakEven ? `Pinnacle — the sharpest market — has it at ${fmtPct(o.pinFair)}, which <b>confirms</b> the edge.` : `Caution: Pinnacle has it at only ${fmtPct(o.pinFair)}, below break-even.`);
  if (o.market !== 'h2h' && o.open != null && o.open !== o.point) b.push(`Line opened at ${o.open > 0 && o.market === 'spreads' ? '+' : ''}${o.open}, now ${o.point > 0 && o.market === 'spreads' ? '+' : ''}${o.point}.`);
  for (const f of (o.factorHits || []).slice().sort((x, y) => y.lean.w - x.lean.w).slice(0, 2)) b.push(`${f.icon} ${f.sign > 0 ? 'Supports' : 'Works against'}: <b>${esc(f.label)}</b> — ${esc(f.value)}.`);
  return `<ul>${b.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}
function whyProp(o) {
  const a = o.a, b = [];
  b.push(`Sportsbooks hang <b>${a.bookLine}</b> and price the over at <b>${fmtPct(a.pOver)}</b> after removing vig (${a.nBooks} books) — that implies a projection of <b>${a.mu.toFixed(1)}</b>.`);
  if (o.useDfs) {
    const d = a.dfs[0];
    b.push(`${bookName(d.book)} posts <b>${d.line}</b> — ${d.line < a.bookLine ? 'lower' : d.line > a.bookLine ? 'higher' : 'the same as'} the books. ${d.side === 'over' ? 'More' : 'Less'} hits <b>${fmtPct(d.p)}</b> vs the <b>${fmtPct(DFS_BREAKEVEN)}</b> per-pick break-even of a 5/6-pick slip.`);
  } else b.push(`Best sportsbook price: <b>${bookName(a.sb.book)} ${a.sb.side} ${fmtAm(a.sb.price)}</b> (${pctS(a.sb.ev)} EV).`);
  if (o.scheme) b.push(`🛡 Scheme: ${esc(o.scheme.defLine)}. ${esc(o.scheme.detail)} → <b>${esc(o.scheme.headline)}</b> against this defense.`);
  if (o.vs?.n) b.push(`Career vs <b>${esc(o.opp)}</b>: ${o.side === 'over' ? 'over' : 'under'} ${o.line} in <b>${o.vs.hits} of ${o.vs.n}</b> games since ${o.vs.first} (avg ${o.vs.avg.toFixed(1)})${o.vs.recent.n ? `; last 3 seasons <b>${o.vs.recent.hits} of ${o.vs.recent.n}</b>` : ''}.`);
  else if (o.h2h && !o.h2h.length) b.push(`No career games against ${esc(o.opp)} yet.`);
  if (o.hr.l10 != null) b.push(`${o.side === 'over' ? 'Over' : 'Under'} ${o.line} has hit <b>${fmtPct(o.hr.l10, 0)}</b> of the last 10 and ${fmtPct(o.hr.l20, 0)} of the last 20 (avg ${o.hr.avg.toFixed(1)}).`);
  return `<ul>${b.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

// ---------------- components ----------------
const sportTag = (s) => `<span class="sport-tag"><span class="dot" style="background:${sc(s)}"></span>${SPORTS[s].label}</span>`;
const bookBadge = (k) => `<span class="book-badge"><i style="background:${BOOKS[k]?.hue || '#777'}">${esc(BOOKS[k]?.short || k.slice(0, 2).toUpperCase())}</i>${esc(bookName(k))}</span>`;
const tierBadge = (g) => { const t = tier(g); return `<span class="tier ${t.k}" data-tip="Grade ${g}/100 — EV, situational factors and market depth">${t.k === 'summit' ? '▲' : t.k === 'ridge' ? '△' : '·'} ${t.label}</span>`; };
const matchup = (g) => `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}`;
const evPill = (e) => `<span class="ev-pill ${e >= 0.04 ? 'hot' : e > 0 ? 'p' : 'n'}">${pctS(e)}</span>`;

function probBar(p, be) {
  return `<div class="prob-bar" data-tip="Fair win probability ${fmtPct(p)} vs break-even ${fmtPct(be)}"><div class="track"><div class="fill" style="width:${p * 100}%"></div><div class="be" style="left:${be * 100}%"></div></div><div class="lbls"><span>Fair ${fmtPct(p)}</span><span>Break-even ${fmtPct(be)}</span></div></div>`;
}

function pickCard(o) {
  if (o.kind === 'prop') return propPickCard(o);
  const g = o.game;
  const chips = (o.factorHits || []).slice(0, 3).map((f) => `<span class="fchip ${f.sign > 0 ? 'up' : 'down'}" data-tip="${esc(f.note)}">${f.icon} ${esc(f.label)}</span>`).join('');
  return `<article class="card pick" style="--sc:${sc(o.sport)}">
    <div class="pick-top">${sportTag(o.sport)}<span>· ${o.marketLabel} · ${time(g.time)}</span>${tierBadge(o.grade)}</div>
    <div class="pick-sel"><div><h3>${esc(o.selection)}</h3><div class="match">${esc(g.away)} @ ${esc(g.home)}</div></div>
      <div class="price"><b>${fmtAm(o.bestPrice)}</b>${bookBadge(o.bestBook)}</div></div>
    <div class="prob-row">${ring(o.fairP, { color: sc(o.sport), label: 'Expected hit rate' })}${probBar(o.fairP, o.breakEven)}</div>
    <div class="metrics"><div class="metric"><small>Edge</small><b class="${o.ev > 0 ? 'pos' : 'neg'}">${pctS(o.ev)}</b></div><div class="metric"><small>Fair odds</small><b>${fmtAm(o.fairAm)}</b></div><div class="metric"><small>Kelly stake</small><b>${money(settings.bankroll * kelly(o.fairP, o.bestPrice, settings.kellyFrac))}</b></div></div>
    ${chips ? `<div class="fchips">${chips}</div>` : ''}
    <details class="why"><summary>Why this bet</summary>${whyLine(o)}</details>
    <div class="pick-foot"><a class="btn sm ghost" href="#/game?g=${encodeURIComponent(o.gameId)}">Focus game</a><button class="btn sm primary" data-act="log" data-id="${esc(o.id)}">+ Log bet</button></div>
  </article>`;
}

function propPickCard(o) {
  const a = o.a;
  const where = o.useDfs ? a.dfs[0].book : a.sb.book;
  const be = o.useDfs ? DFS_BREAKEVEN : imp(a.sb.price);
  return `<article class="card pick" style="--sc:${sc(o.sport)}">
    <div class="pick-top">${sportTag(o.sport)}<span>· Player prop · ${time(o.time)}</span>${tierBadge(o.grade)}</div>
    <div class="pick-sel"><div><h3>${esc(o.player)}</h3><div class="match">${o.useDfs ? `<span class="more-less">${o.side === 'over' ? 'MORE' : 'LESS'}</span>` : esc(o.side === 'over' ? 'Over' : 'Under')} ${o.line} ${esc(o.stat)} · ${esc(o.team ? `${o.home ? 'vs' : '@'} ${o.opp}` : o.opp)}</div></div>
      <div class="price"><b>${o.useDfs ? o.line : fmtAm(a.sb.price)}</b>${bookBadge(where)}</div></div>
    <div class="prob-row">${ring(o.p, { color: sc(o.sport), label: 'Expected hit rate' })}${probBar(o.p, be)}</div>
    <div class="metrics"><div class="metric"><small>L10 hit</small><b>${fmtPct(o.hr.l10, 0)}</b></div><div class="metric"><small>L20 hit</small><b>${fmtPct(o.hr.l20, 0)}</b></div><div class="metric"><small>${o.useDfs ? 'vs B/E' : 'Edge'}</small><b class="pos">${o.useDfs ? '+' + ((o.p - DFS_BREAKEVEN) * 100).toFixed(1) + ' pts' : pctS(a.sb.ev)}</b></div></div>
    <details class="why"><summary>Why this pick</summary>${whyProp(o)}</details>
    <div class="pick-foot"><a class="btn sm ghost" href="#/props?q=${encodeURIComponent(o.player)}">Game log</a><button class="btn sm primary" data-act="logprop" data-id="${esc(o.id)}">+ Log pick</button></div>
  </article>`;
}

function mountains() {
  const r = rng('trees');
  let trees = '', trees2 = '';
  for (let x = -10; x < 1210; x += 9 + r() * 8) { const h = 26 + r() * 34; const w = h * 0.32; trees += `M${x.toFixed(0)} 300L${(x + w).toFixed(0)} ${(300 - h).toFixed(0)}L${(x + 2 * w).toFixed(0)} 300Z`; }
  for (let x = -10; x < 1210; x += 14 + r() * 12) { const h = 18 + r() * 22; const w = h * 0.34; trees2 += `M${x.toFixed(0)} 270L${(x + w).toFixed(0)} ${(270 - h).toFixed(0)}L${(x + 2 * w).toFixed(0)} 270Z`; }
  return `<svg class="range" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <path fill="var(--mtn-1)" d="M0 300V205l110-38 90 22 95-52 80 35 95-60 85 48 80-18 80 32 100-52 80 40 100-34 105 38 100-28V300Z"/>
    <path fill="var(--mtn-2)" d="M540 300 690 212l80-58 52-46 38-15 40 13 55 45 80 58 115 91Z"/>
    <path fill="var(--snow)" opacity=".92" d="M792 134l30-26 38-15 40 13 30 25-20-5-14 12-18-14-20 17-16-13-20 12Z"/>
    <path fill="var(--mtn-2)" opacity=".8" d="M0 300V250l120-42 70 18 80-36 90 40 70-12 60 82Z"/>
    <path fill="var(--mtn-3)" d="M0 300v-56c150-22 250 6 380-14s240-18 380 10 240-22 440-6v66Z"/>
    <path fill="var(--trees)" opacity=".7" d="${trees2}"/>
    <path fill="var(--trees)" d="${trees}"/>
  </svg><div class="fog"></div><div class="fog f2"></div>`;
}

// ---------------- views ----------------
const views = {
  home() {
    const opps = bySport(state.opps).filter((o) => o.ev >= settings.minEv);
    const props = bySport(state.props).filter((o) => o.ev > 0);
    // game lines and props are scored on different scales, so interleave the best of each
    const rank = (a, b) => b.grade - a.grade || b.ev - a.ev;
    const tl = [...opps].sort(rank), tp = [...props].sort(rank), top = [];
    while (top.length < 6 && (tl.length || tp.length)) { if (tl.length) top.push(tl.shift()); if (tp.length && top.length < 6) top.push(tp.shift()); }
    const st = store.stats(store.bets);
    const s30 = store.stats(store.bets.filter((b) => Date.now() - new Date(b.placed) < 30 * 864e5));
    const nBooks = new Set(allGames().flatMap((g) => Object.keys(g.books))).size;
    const bestEdge = Math.max(0, ...opps.map((o) => o.ev));
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
    const wxGames = allGames().filter((g) => g.weather && g.homeTeam.roof !== 'd').map((g) => ({ g, adj: weatherTotalAdj(g.sport, g.weather, g.homeTeam.roof) })).sort((a, b) => Math.abs(b.adj) - Math.abs(a.adj) || b.g.weather.wind - a.g.weather.wind).slice(0, 5);
    const bySportHit = ['nfl', 'nba', 'nhl', 'mlb'].map((s) => { const x = store.stats(store.bets.filter((b) => b.sport === s)); return { label: SPORTS[s].label, value: x.hit, color: sc(s), icon: 1, sub: `${x.won}-${x.lost}`, tip: `${SPORTS[s].label}: ${x.won}-${x.lost} · hit ${fmtPct(x.hit)} vs ${fmtPct(x.expHit)} needed · ROI ${pctS(x.roi)}` }; }).filter((r) => r.value != null);
    return `
      ${demoBanner()}
      <section class="hero">
        ${mountains()}
        <div class="hero-k">${greet} from the Cascades · ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h2>${opps.length ? `<em>${opps.length}</em> lines are priced better than fair right now.` : 'The market looks efficient right now.'}</h2>
        <p>Every price from ${nBooks} books, de-vigged and compared to the sharp consensus, then pressure-tested against weather, travel, rest and home/away splits.</p>
        <div class="hero-cta"><a class="btn primary" href="#/lines">Open Line Shop →</a><a class="btn" href="#/props">Prop Lab</a><a class="btn" href="#/guide">How the edge works</a></div>
        <div class="hero-stats">
          <div class="hero-stat"><small>Best edge</small><b class="pos">${pctS(bestEdge)}</b></div>
          <div class="hero-stat"><small>+EV props</small><b>${props.length}</b></div>
        </div>
      </section>
      <div class="kpis">
        ${kpi('Bankroll', money(settings.bankroll + st.profit), `${money(st.profit, true)} all-time`, st.profit >= 0 ? 'pos' : 'neg')}
        ${kpi('ROI · 30d', pctS(s30.roi), `${money(s30.staked)} staked`, s30.roi >= 0 ? 'pos' : 'neg')}
        ${kpi('Hit rate', fmtPct(st.hit), `needed ${fmtPct(st.expHit)} to break even`, st.hit >= st.expHit ? 'pos' : 'neg')}
        ${kpi('Avg CLV', st.clv == null ? '—' : pctS(st.clv), 'beat the closing line?', st.clv >= 0 ? 'pos' : 'neg')}
        ${kpi('Open action', money(st.pendingStake), `${st.pending} pending bets`)}
      </div>
      <div class="section-t"><h2>Summit picks</h2><p>Highest-graded bets on the board — price edge first, situation second.</p><div class="right"><a class="btn sm" href="#/lines">All lines</a></div></div>
      <div class="grid g-main">
        <div class="picks">${top.length ? top.map(pickCard).join('') : `<div class="card empty"><div style="font-size:34px">🌲</div><h3>Nothing clears your ${pctS(settings.minEv)} threshold</h3><p>Lower the minimum edge in Settings or check back closer to game time — lines move.</p></div>`}</div>
        <div class="stack">
          <div class="card"><div class="card-h"><h3>Bankroll trail</h3><span class="sub">settled bets</span></div>${bankrollChart(180)}</div>
          <div class="card"><div class="card-h"><h3>Weather watch</h3><span class="sub">outdoor venues</span></div>
            ${wxGames.length ? `<div class="wx-list">${wxGames.map(({ g, adj }) => { const l = wxLabel(g.weather.code, g.weather.pop); return `<a class="wx-item" href="#/conditions?g=${encodeURIComponent(g.id)}"><div class="g">${l.g}</div><div><b>${matchup(g)}</b> <span class="mut">· ${SPORTS[g.sport].label}</span><small>${g.weather.temp}°F · wind ${g.weather.wind} mph ${compass(g.weather.dir)} · ${g.weather.pop}% precip${g.weather.live ? ' · live' : ''}</small></div><div class="imp ${adj < -0.4 ? 'neg' : adj > 0.4 ? 'pos' : 'mut'}" data-tip="Model total adjustment from weather">${adj ? (adj > 0 ? '+' : '') + adj.toFixed(1) : '±0'}</div></a>`; }).join('')}</div>` : '<div class="empty-mini">No outdoor games on this slate.</div>'}
          </div>
          <div class="card"><div class="card-h"><h3>Your hit rate by sport</h3><span class="sub">marker = break-even</span></div>${bySportHit.length ? hbars(bySportHit, { ref: st.expHit, refLabel: 'Break-even' }) : '<div class="empty-mini">Log some bets to see this.</div>'}</div>
        </div>
      </div>`;
  },

  lines() {
    const f = state.lines;
    let rows = bySport(state.opps);
    if (f.market !== 'all') rows = rows.filter((o) => o.market === f.market);
    if (f.evOnly) rows = rows.filter((o) => o.ev > 0);
    if (f.q) rows = rows.filter((o) => (o.selection + o.game.home + o.game.away).toLowerCase().includes(f.q.toLowerCase()));
    const books = Object.keys(BOOKS).filter((k) => BOOKS[k].kind !== 'dfs' && rows.some((o) => o.prices[k] != null));
    const games = [...new Map(rows.map((o) => [o.gameId, o.game])).values()].sort((a, b) => new Date(a.time) - new Date(b.time));
    const body = games.map((g) => {
      const rs = rows.filter((o) => o.gameId === g.id).sort((a, b) => b.ev - a.ev);
      return `<tr class="game-row"><td colspan="${7 + books.length}">${sportTag(g.sport)} &nbsp; ${esc(g.away)} @ ${esc(g.home)} <span class="mut">· ${time(g.time)}</span> <a class="btn sm ghost" href="#/game?g=${encodeURIComponent(g.id)}">Focus →</a> ${g.weather && g.homeTeam.roof !== 'd' ? `<span class="mut">· ${wxLabel(g.weather.code).g} ${g.weather.temp}° ${g.weather.wind}mph</span>` : ''}</td></tr>` +
        rs.map((o) => `<tr>
          <td><b>${esc(o.selection)}</b><div class="mut" style="font-size:11.5px">${o.marketLabel}</div></td>
          <td class="r num">${fmtAm(o.fairAm)}<div class="mut" style="font-size:11px">${fmtPct(o.fairP)}</div></td>
          ${books.map((k) => { const p = o.prices[k]; return `<td class="c">${p == null ? '<span class="mut">—</span>' : `<span class="odds-cell ${k === o.bestBook ? 'best' : p === o.worstPrice && p !== o.bestPrice ? 'worst' : ''}">${fmtAm(p)}</span>`}</td>`; }).join('')}
          <td class="r">${evPill(o.ev)}</td>
          <td class="r num">${o.factorScore ? `<span class="${o.factorScore > 0 ? 'pos' : 'neg'}" data-tip="${esc((o.factorHits || []).map((h) => (h.sign > 0 ? '+ ' : '− ') + h.label).join(' · '))}">${o.factorScore > 0 ? '+' : ''}${o.factorScore}</span>` : '<span class="mut">0</span>'}</td>
          <td class="r num mut">${fmtPct(o.hold)}</td>
          <td>${tierBadge(o.grade)}</td>
          <td class="r"><button class="btn sm" data-act="log" data-id="${esc(o.id)}">Log</button></td></tr>`).join('');
    }).join('');
    return `${demoBanner()}
      <div class="toolbar">
        <div class="seg" data-seg="market">${[['all', 'All'], ['h2h', 'Moneyline'], ['spreads', 'Spread'], ['totals', 'Total']].map(([k, l]) => `<button class="${f.market === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
        <label class="switch"><input type="checkbox" data-f="evOnly" ${f.evOnly ? 'checked' : ''}/> +EV only</label>
        <div class="grow"></div>
        <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input class="input" data-f="q" placeholder="Search team…" value="${esc(f.q)}"/></div>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Selection</th><th class="r" data-tip="No-vig consensus price; Pinnacle weighted 3×">Fair</th>${books.map((k) => `<th class="c">${esc(BOOKS[k].short)}</th>`).join('')}<th class="r">Edge</th><th class="r" data-tip="Situational factor score (weather, rest, travel, splits)">Factors</th><th class="r" data-tip="Average book margin (vig) on this market">Hold</th><th>Grade</th><th></th></tr></thead>
        <tbody>${body || `<tr><td colspan="99"><div class="empty"><h3>No lines match</h3><p>Turn off “+EV only” or pick another sport.</p></div></td></tr>`}</tbody>
      </table></div>
      <p class="mut" style="font-size:12px;margin-top:10px">Green = best available price. Edge = fair probability × best decimal odds − 1. Lines are only compared at identical points (−3 is never mixed with −3.5).</p>`;
  },

  props() {
    const f = state.propf;
    let ps = bySport(state.props);
    if (f.venue === 'dfs') ps = ps.filter((o) => o.useDfs); else if (f.venue === 'books') ps = ps.filter((o) => !o.useDfs);
    if (f.q) ps = ps.filter((o) => (o.player + o.stat + o.team).toLowerCase().includes(f.q.toLowerCase()));
    if (f.game) ps = ps.filter((o) => o.gameId === f.game);
    const live = state.slate?.source === 'live';
    const loader = scanCard();
    ps.sort(f.sort === 'hit' ? (a, b) => (b.hr.l10 ?? 0) - (a.hr.l10 ?? 0) : f.sort === 'grade' ? (a, b) => b.grade - a.grade : (a, b) => b.ev - a.ev);
    return `${demoBanner()}
      <div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Pick'em break-even</h3><span class="sub">what each leg must hit for PrizePicks / Underdog to be profitable</span></div>
        <div class="dfs-row">${DFS_SLIPS.map((s) => `<div class="dfs"><small>${s.app}</small><b>${fmtPct(s.breakEven)}</b><span>${s.type} · ${s.pay}×</span></div>`).join('')}</div>
        <p class="why" style="margin:12px 0 0">Pick'em apps don't show odds — they pay a fixed multiple. The trick is comparing their line to the sportsbooks' de-vigged price. When PrizePicks hangs 24.5 and the books make 26.5 a coin flip, <b>More 24.5</b> is far better than 54.6%.</p>
      </div>
      ${loader}
      <div class="toolbar">
        <div class="seg" data-seg="venue">${[['all', 'All'], ['dfs', "Pick'em"], ['books', 'Sportsbooks']].map(([k, l]) => `<button class="${f.venue === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="seg" data-seg="sort">${[['edge', 'Edge'], ['hit', 'L10 hit rate'], ['grade', 'Grade']].map(([k, l]) => `<button class="${f.sort === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="grow"></div>
        <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input class="input" data-pf="q" placeholder="Search player…" value="${esc(f.q)}"/></div>
      </div>
      <div class="grid g-auto">${ps.map(propCard).join('') || `<div class="card empty"><div style="font-size:34px">🧪</div><h3>No props loaded yet</h3><p>${live ? 'Hit <b>Scan</b> above — it checks every game in the next 24 hours and ranks the best props automatically.' : 'Pick another sport.'}</p></div>`}</div>`;
  },

  parlays() {
    const props = bySport(state.props), opps = bySport(state.opps);
    const dfs = buildDfsSlips(props);
    const bf = state.parlay.book;
    const bp = buildBookParlays(opps, props, bf === 'all' ? undefined : [bf]).filter((x) => x.ev > 0).slice(0, 6);
    state.slips = [...dfs, ...bp];
    const books = Object.keys(BOOKS).filter((k) => BOOKS[k].kind === 'book');
    const hasProps = props.length > 0;
    return `${demoBanner()}${scanCard()}
      <div class="banner" style="background:var(--surface)">🎯 <span><b>How these are built:</b> the strongest legs on the board, one per game so they don't move together, combined into the slip sizes each app pays on. Parlays multiply your edge <i>and</i> your variance — a +30% EV 5-pick still loses most of the time.</span></div>
      <div class="section-t"><h2>Pick'em slips</h2><p>PrizePicks & Underdog — legs where the fair probability beats the break-even</p></div>
      <div class="picks">${dfs.length ? dfs.map((x, i) => slipCard(x, i)).join('') : `<div class="card empty"><div style="font-size:34px">🎟</div><h3>${hasProps ? 'Not enough +edge pick\'em legs' : 'No props scanned yet'}</h3><p>${hasProps ? 'Need at least 2 qualifying picks from different games. Try All sports or rescan closer to game time.' : 'Run a scan above to pull PrizePicks & Underdog lines.'}</p></div>`}</div>
      <div class="section-t"><h2>Sportsbook parlays</h2><p>Every leg +EV at the same book</p><div class="right"><select class="input" data-pb="book" style="width:auto">${[['all', 'All books'], ...books.map((k) => [k, BOOKS[k].name])].map(([k, l]) => `<option value="${k}" ${bf === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="picks">${bp.length ? bp.map((x, i) => slipCard(x, dfs.length + i)).join('') : `<div class="card empty"><div style="font-size:34px">🧾</div><h3>No +EV parlays at ${bf === 'all' ? 'any book' : esc(bookName(bf))} right now</h3><p>A parlay needs 2+ legs from different games that are each priced better than fair at the same book.</p></div>`}</div>`;
  },

  game() {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const id = qs.has('g') ? qs.get('g') : state.focus; // '#/game?g=' (empty) = show the picker
    const g = id && allGamesAll().find((x) => x.id === id);
    const live = state.slate?.source === 'live';
    if (!g) {
      // picker: upcoming games, soonest first, grouped by day
      const games = allGames().sort((a, b) => new Date(a.time) - new Date(b.time));
      const day = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      const groups = [...new Set(games.map((x) => day(x.time)))];
      return `${demoBanner()}<div class="section-t" style="margin-top:0"><h2>Pick a game to focus on</h2><p>Lines, props, career matchups, conditions and same-game pick'em — for just that game.</p></div>
        ${groups.map((d) => `<h3 class="day-h">${d}</h3><div class="game-pills">${games.filter((x) => day(x.time) === d).map((x) => `<a class="gpill" href="#/game?g=${encodeURIComponent(x.id)}"><span class="dot" style="background:${sc(x.sport)}"></span><b>${esc(x.awayTeam.abbr)} @ ${esc(x.homeTeam.abbr)}</b><small>${esc(x.away)} at ${esc(x.home)}</small><em>${new Date(x.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${x.propsLoadedAt ? ' · props ✓' : ''}</em></a>`).join('')}</div>`).join('') || '<div class="card empty"><h3>No upcoming games</h3><p>Turn on more sports in Settings or hit refresh.</p></div>'}`;
    }
    state.focus = g.id; try { localStorage.setItem('degen.focus', g.id); } catch {}
    const opps = state.opps.filter((o) => o.gameId === g.id).sort((a, b) => b.ev - a.ev);
    const props = state.props.filter((o) => o.gameId === g.id).sort((a, b) => b.grade - a.grade || b.ev - a.ev);
    const slips = buildDfsSlips(props, { sameGame: true }).filter((x) => x.legs.length <= 4 && x.ev > 0).slice(0, 3);
    state.slips = slips;
    const books = Object.keys(BOOKS).filter((k) => BOOKS[k].kind !== 'dfs' && opps.some((o) => o.prices[k] != null));
    const started = new Date(g.time) <= Date.now();
    const wx = g.weather;
    const propBtn = live && !g.propsLoadedAt ? `<button class="btn primary" data-act="loadprops" data-id="${esc(g.id)}" ${state.loadingProps ? 'disabled' : ''}>${state.loadingProps === g.id ? 'Loading props…' : `Load props for this game · ${PROP_COST[g.sport]} credits`}</button>` : '';
    return `${demoBanner()}
      <div class="card focus-h" style="--sc:${sc(g.sport)}">
        <div class="focus-top"><a class="btn sm ghost" href="#/game?g=">← All games</a>${sportTag(g.sport)}<span class="mut">${time(g.time)}${started ? ' · <b class="neg">in progress</b>' : ''}</span></div>
        <div class="focus-match"><div><small>Away</small><b>${esc(g.away)}</b></div><span class="at">@</span><div style="text-align:right"><small>Home</small><b>${esc(g.home)}</b></div></div>
        <div class="fchips" style="justify-content:center">${g.homeTeam.roof === 'd' ? '<span class="fchip">🏟 Indoors</span>' : wx ? `<span class="fchip">${wxLabel(wx.code, wx.pop).g} ${wx.temp}°F</span><span class="fchip">🌬 ${wx.wind} mph ${compass(wx.dir)}</span><span class="fchip">🌧 ${wx.pop}%</span>` : ''}${g.homeTeam.roof === 'r' ? '<span class="fchip">Retractable roof</span>' : ''}</div>
      </div>

      <div class="section-t"><h2>Game lines</h2><p>Every book, best price highlighted</p></div>
      ${opps.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Selection</th><th class="r">Fair</th>${books.map((k) => `<th class="c">${esc(BOOKS[k].short)}</th>`).join('')}<th class="r">Edge</th><th></th></tr></thead><tbody>
        ${opps.map((o) => `<tr><td><b>${esc(o.selection)}</b><div class="mut" style="font-size:11.5px">${o.marketLabel}</div></td><td class="r num">${fmtAm(o.fairAm)}</td>${books.map((k) => { const p = o.prices[k]; return `<td class="c">${p == null ? '<span class="mut">—</span>' : `<span class="odds-cell ${k === o.bestBook ? 'best' : ''}">${fmtAm(p)}</span>`}</td>`; }).join('')}<td class="r">${evPill(o.ev)}</td><td class="r"><button class="btn sm" data-act="log" data-id="${esc(o.id)}">Log</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty-mini">No game lines for this game.</div>'}

      <div class="section-t"><h2>Player props</h2><p>${props.length ? `${props.length} props · best first · career vs ${esc(g.homeTeam.abbr)}/${esc(g.awayTeam.abbr)} included` : 'Only this game — nothing else'}</p><div class="right">${propBtn}</div></div>
      ${props.length ? `<div class="grid g-auto">${props.map(propCard).join('')}</div>` : `<div class="card empty"><div style="font-size:34px">🎯</div><h3>${live ? (g.propsLoadedAt ? 'Books haven\'t posted props for this game yet' : 'Props not loaded yet') : 'No featured players in this demo game'}</h3><p>${live ? (g.propsLoadedAt ? 'Try again closer to kickoff.' : `Loads only this game — ${PROP_COST[g.sport]} credits, cached free for 20 min.`) : 'Demo props only exist for a handful of star players. With your Odds API key you get every player.'}</p>${propBtn ? `<div style="margin-top:12px">${propBtn}</div>` : ''}</div>`}

      ${(() => { const ls = state.longs.filter((o) => o.gameId === g.id).sort((a, b) => b.ev - a.ev); const btn = live && !g.longsLoadedAt ? `<button class="btn" data-act="gamelong" data-id="${esc(g.id)}" ${state.scanning ? 'disabled' : ''}>${state.scanning ? 'Loading…' : `Load long shots · ${LONG_COST[g.sport]} credits`}</button>` : '';
        return `<div class="section-t"><h2>Long shots</h2><p>${{ nfl: 'Anytime & first TD scorers', nhl: 'Goal scorers', mlb: 'Home runs', nba: 'Double-doubles & first basket' }[g.sport]}</p><div class="right">${btn}</div></div>${ls.length ? longTable(ls) : `<div class="card empty-mini">${live ? (g.longsLoadedAt ? 'Books haven\'t posted these yet.' : 'Not loaded yet.') : 'No featured long shots in this demo game.'}</div>`}`; })()}

      ${slips.length ? `<div class="section-t"><h2>Same-game pick'em</h2><p>Best legs from both teams in this game</p></div><div class="picks">${slips.map((x, i) => slipCard(x, i)).join('')}</div>` : ''}

      <div class="section-t"><h2>Conditions & factors</h2></div>
      ${condCard(g, false)}`;
  },

  longshots() {
    const f = state.longf, live = state.slate?.source === 'live';
    let rows = bySport(state.longs);
    const stats = [...new Set(rows.map((o) => o.stat))];
    if (f.stat !== 'all') rows = rows.filter((o) => o.stat === f.stat);
    const l10 = (o) => { const L = (o.log || []).slice(-10); return L.length ? L.filter((g) => g.v > 0.5).length / L.length : -1; };
    rows.sort(f.sort === 'hit' ? (a, b) => l10(b) - l10(a) : f.sort === 'price' ? (a, b) => toDec(b.a.best) - toDec(a.a.best) : (a, b) => b.ev - a.ev);
    const parlays = buildLongParlays(bySport(state.longs)).filter((x) => x.ev > 0).slice(0, 3);
    state.slips = parlays;
    const { games, todo, cost } = longPlan();
    const scanner = live ? `<div class="card scan" style="margin-bottom:18px"><div class="scan-row"><div class="scan-ic">🎰</div>
      <div class="grow"><h3 style="margin:0;font:600 18px var(--font-display)">Long-shot scanner</h3><div class="mut" style="font-size:12.5px">Anytime / first TD, anytime goal, home runs, double-doubles for every ${state.sport === 'all' ? '' : SPORTS[state.sport].label + ' '}game in the next 24h. 1 credit per market per game · <b>${quota.remaining ?? '—'}</b> credits left · cached 20 min. Tip: use <b>Game Focus</b> to load just one game.</div></div>
      <button class="btn primary" data-act="scanlong" ${state.scanning || !todo.length ? 'disabled' : ''}>${state.scanning ? `Loading ${state.scanning.done}/${state.scanning.total}…` : todo.length ? `Load ${todo.length} game${todo.length > 1 ? 's' : ''} · ${cost} credits` : games.length ? 'All loaded ✓' : 'No games in 24h'}</button></div></div>` : '';
    return `${demoBanner()}${scanner}
      <div class="banner" style="background:var(--surface)">🎰 <span><b>Long shots live on line shopping.</b> Books disagree wildly on scorer markets (+300 here, +450 there), and their margins are fat. We compare every book to <b>Pinnacle's no-vig price</b> when they post one, otherwise to an estimate. Even a +EV +400 hits only ~1 in 5 — bet small, expect long dry spells.</span></div>
      <div class="toolbar">
        <div class="seg" data-lseg="stat">${[['all', 'All'], ...stats.map((x) => [x, x])].map(([k, l]) => `<button class="${f.stat === k ? 'on' : ''}" data-v="${esc(k)}">${esc(l)}</button>`).join('')}</div>
        <div class="seg" data-lseg="sort">${[['ev', 'Edge'], ['hit', 'L10 hit rate'], ['price', 'Biggest payout']].map(([k, l]) => `<button class="${f.sort === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
      </div>
      ${rows.length ? longTable(rows) : `<div class="card empty"><div style="font-size:34px">🎰</div><h3>No long shots loaded</h3><p>${live ? 'Load them with the scanner above, or for one game in Game Focus.' : 'Pick another sport.'}</p></div>`}
      ${parlays.length ? `<div class="section-t"><h2>Long-shot parlays</h2><p>Lottery tickets: every leg +EV at the same book, different games</p></div><div class="picks">${parlays.map((x, i) => slipCard(x, i)).join('')}</div>` : ''}`;
  },

  conditions() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const outdoor = (g) => (g.homeTeam.roof !== 'd' && g.weather ? 1 + Math.abs(weatherTotalAdj(g.sport, g.weather, g.homeTeam.roof)) : 0);
    let games = allGames().sort((a, b) => outdoor(b) - outdoor(a) || new Date(a.time) - new Date(b.time));
    const focus = q.get('g');
    if (focus) games = games.sort((a, b) => (b.id === focus) - (a.id === focus));
    return `${demoBanner()}<div class="stack">${games.map((g) => condCard(g, g.id === focus)).join('') || '<div class="card empty"><h3>No games</h3></div>'}</div>`;
  },

  logbook() {
    const f = state.log;
    let list = state.sport === 'all' ? store.bets : store.bets.filter((b) => b.sport === state.sport);
    const st = store.stats(list);
    const shown = list.filter((b) => (f.status === 'all' || b.status === f.status) && (!f.q || (b.selection + bookName(b.book)).toLowerCase().includes(f.q.toLowerCase())));
    const group = (key, label) => {
      const keys = [...new Set(list.map((b) => b[key]))];
      return keys.map((k) => { const x = store.stats(list.filter((b) => b[key] === k)); return { label: label(k), value: x.roi, sub: `${x.settled}`, tip: `${label(k)}: ${x.won}-${x.lost}, ${money(x.profit, true)} on ${money(x.staked)}`, color: x.roi >= 0 ? 'var(--good)' : 'var(--bad)' }; }).filter((r) => r.value != null).sort((a, b) => b.value - a.value);
    };
    const roiList = (rows) => rows.length ? `<div class="hbars">${rows.map((r) => `<div class="hbar" data-tip="${esc(r.tip)}"><div class="hbar-l">${esc(r.label)}<small>${r.sub}</small></div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.min(100, Math.abs(r.value) / Math.max(0.05, ...rows.map((x) => Math.abs(x.value))) * 100)}%;background:${r.color}"></div></div><div class="hbar-v ${r.value >= 0 ? 'pos' : 'neg'}">${pctS(r.value, 0)}</div></div>`).join('')}</div>` : '<div class="empty-mini">—</div>';
    const sample = store.bets.some((b) => b.sample);
    return `
      ${sample ? `<div class="banner">🌲 <span><b>Sample history loaded</b> so you can see how the logbook works. Clear it whenever you're ready to track your own.</span><button class="btn sm" data-act="clearSample">Clear sample bets</button></div>` : ''}
      <div class="toolbar">
        <button class="btn primary" data-act="newbet">+ Log a bet</button>
        <label class="btn" for="csvIn">Import CSV</label><input type="file" id="csvIn" accept=".csv,text/csv" hidden />
        <button class="btn" data-act="export">Export CSV</button>
        <div class="grow"></div>
        <div class="seg" data-seg="status">${['all', 'pending', 'won', 'lost', 'push'].map((k) => `<button class="${f.status === k ? 'on' : ''}" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="kpis" style="margin-top:0">
        ${kpi('Profit', money(st.profit, true), `${st.won}-${st.lost} record`, st.profit >= 0 ? 'pos' : 'neg')}
        ${kpi('ROI', pctS(st.roi), `${money(st.staked)} staked`, st.roi >= 0 ? 'pos' : 'neg')}
        ${kpi('Hit rate', fmtPct(st.hit), `break-even ${fmtPct(st.expHit)}`, st.hit >= st.expHit ? 'pos' : 'neg')}
        ${kpi('Closing line value', st.clv == null ? '—' : pctS(st.clv), 'avg implied-prob gain vs close', st.clv >= 0 ? 'pos' : 'neg')}
        ${kpi('Pending', money(st.pendingStake), `${st.pending} open`)}
      </div>
      <div class="grid g-main" style="margin-top:18px">
        <div class="card"><div class="card-h"><h3>Bankroll trail</h3><span class="sub">starting ${money(settings.bankroll)}</span></div>${bankrollChart(260, list)}</div>
        <div class="stack">
          <div class="card"><div class="card-h"><h3>ROI by book</h3></div>${roiList(group('book', bookName))}</div>
          <div class="card"><div class="card-h"><h3>ROI by bet type</h3></div>${roiList(group('market', (k) => ({ moneyline: 'Moneyline', spread: 'Spread', total: 'Total', prop: 'Props', parlay: 'Parlay', imported: 'Imported' }[k] || k)))}</div>
        </div>
      </div>
      <div class="section-t"><h2>Bets</h2><p>${shown.length} shown</p><div class="right"><div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input class="input" data-lf="q" placeholder="Search bets…" value="${esc(f.q)}"/></div></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Sport</th><th>Selection</th><th>Book</th><th class="r">Odds</th><th class="r">Close</th><th class="r">Stake</th><th>Status</th><th class="r">P/L</th><th></th></tr></thead>
      <tbody>${shown.slice(0, 200).map((b) => `<tr>
        <td class="mut">${dateS(b.placed)}</td><td>${SPORTS[b.sport] ? sportTag(b.sport) : esc(b.sport)}</td>
        <td><b>${esc(b.selection)}</b>${b.sample ? ' <span class="mut" style="font-size:11px">sample</span>' : ''}</td>
        <td>${BOOKS[b.book] ? bookBadge(b.book) : esc(b.book)}</td>
        <td class="r num">${fmtAm(b.odds)}</td><td class="r num mut">${b.closeOdds ? fmtAm(b.closeOdds) : '—'}</td><td class="r num">${money(+b.stake)}</td>
        <td><select class="status-sel st-${b.status}" data-act="status" data-id="${b.id}">${['pending', 'won', 'lost', 'push'].map((s) => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td class="r num ${store.payout(b) > 0 ? 'pos' : store.payout(b) < 0 ? 'neg' : 'mut'}">${b.status === 'pending' ? '<span class="mut">to win ' + money(b.stake * (toDec(b.odds) - 1)) + '</span>' : money(store.payout(b), true)}</td>
        <td class="r"><button class="btn sm ghost" data-act="editbet" data-id="${b.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="10"><div class="empty"><h3>No bets yet</h3><p>Log one from any pick card, or import a CSV from your book.</p></div></td></tr>'}</tbody></table></div>`;
  },

  accounts() {
    const ks = Object.keys(BOOKS).filter((k) => k !== 'pinnacle');
    const linked = ks.filter((k) => store.accounts[k]?.linked);
    const totalBal = linked.reduce((s, k) => s + (+store.accounts[k].balance || 0), 0);
    return `
      <div class="card" style="margin-bottom:18px;display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <div style="font-size:34px">🔗</div>
        <div style="flex:1;min-width:260px"><h3 style="margin:0;font:600 18px var(--font-display)">Your outposts</h3>
          <p class="why" style="margin:4px 0 0">US sportsbooks don't offer public APIs, so there are three honest ways to bring an account in: <b>manual tracking</b>, <b>CSV import</b> of your bet history, or <b>auto-sync through an aggregator</b> (SharpSports) that handles the sportsbook login on their side. This app never asks for, or stores, a sportsbook password.</p></div>
        <div class="kpi" style="padding:0 10px"><small>Linked</small><b>${linked.length}/${ks.length}</b></div>
        <div class="kpi" style="padding:0 10px"><small>Total balance</small><b>${money(totalBal)}</b></div>
      </div>
      <div class="grid g-auto">${ks.map((k) => {
        const a = store.accounts[k] || {}, b = BOOKS[k];
        const st = store.stats(store.bets.filter((x) => x.book === k));
        return `<div class="card acct">
          <div class="acct-h"><div class="monogram" style="background:${b.hue}">${b.short}</div><div><h3>${b.name}</h3><span class="mut" style="font-size:12px">${b.kind === 'dfs' ? "Pick'em / DFS" : 'Sportsbook'}</span></div>
          <span class="status ${a.linked ? 'on' : 'off'}">${a.linked ? { manual: 'Manual', csv: 'CSV', sync: 'Sync' }[a.method] || 'Linked' : 'Not linked'}</span></div>
          <div class="acct-stats"><div class="metric"><small>Balance</small><b>${a.linked ? money(+a.balance || 0) : '—'}</b></div><div class="metric"><small>P/L</small><b class="${st.profit >= 0 ? 'pos' : 'neg'}">${st.settled ? money(st.profit, true) : '—'}</b></div><div class="metric"><small>Bets</small><b>${st.n}</b></div></div>
          ${a.linked && a.linkedAt ? `<div class="mut" style="font-size:12px">Linked ${dateS(a.linkedAt)}${a.lastImport ? ` · last import ${dateS(a.lastImport)}` : ''}</div>` : ''}
          <div class="pick-foot">${a.linked ? `<button class="btn sm ghost danger" data-act="unlink" data-k="${k}">Unlink</button><button class="btn sm" data-act="link" data-k="${k}">Manage</button>` : `<button class="btn sm primary" data-act="link" data-k="${k}">Connect</button>`}</div>
        </div>`;
      }).join('')}</div>`;
  },

  guide() {
    const sec = (id, t, body) => `<div class="card prose" id="${id}" style="margin-bottom:16px"><h3>${t}</h3>${body}</div>`;
    return `<div class="toc">${[['vig', 'The vig'], ['ev', 'Expected value'], ['shop', 'Line shopping'], ['dfs', "Pick'em math"], ['hit', 'Hit rates'], ['clv', 'CLV'], ['factors', 'Factors'], ['kelly', 'Sizing'], ['rg', 'Play safe']].map(([k, l]) => `<a class="chip" href="#/guide" data-jump="${k}">${l}</a>`).join('')}</div>
    ${sec('vig', '1 · Every price has a tax built in', `<p>A coin flip should be +100 both ways. Books hang −110 on both sides instead. −110 implies 52.4%, so the two sides add up to 104.8% — the extra 4.8% is the <b>vig</b> (or hold). To find what the market <i>really</i> thinks, divide each side's implied probability by the total:</p><span class="formula">fair p = implied(A) ÷ (implied(A) + implied(B))</span><p>We do that for every book and average them, weighting Pinnacle 3× because it takes the largest limits from sharp bettors and moves fastest. That's the <b>fair line</b> shown everywhere in the app.</p>`)}
    ${sec('ev', '2 · Why these bets have the best odds: expected value', `<p>A bet is good when the price pays more than the true chance of winning deserves. Expected value per $1:</p><span class="formula">EV = fair p × decimal odds − 1</span><p>Example: fair price is +128 (43.9%). DraftKings is dealing +145 (decimal 2.45). EV = 0.439 × 2.45 − 1 = <b>+7.6%</b>. Over hundreds of bets like that, you expect to earn 7.6¢ per dollar risked. Edges of 1–3% are normal; anything above 5% is rare and usually disappears within minutes.</p>`)}
    ${sec('shop', '3 · Line shopping is the easiest edge there is', `<p>Books disagree all the time. Taking the best of 7 prices instead of always using one book is worth roughly 1.5–2.5% of ROI on its own — the difference between a losing and a winning bettor for most people. That's why the Line Shop shows every book side-by-side with the best price in green.</p>`)}
    ${sec('dfs', "4 · PrizePicks & Underdog: break-even math", `<p>Pick'em apps pay fixed multiples. A 5-pick Power pays 20×, so each leg must win (1/20)^(1/5) = <b>54.9%</b> just to break even. 2-pick Power at 3× needs 57.7%. The edge comes when their line is softer than the sportsbook consensus — e.g. PrizePicks 24.5 points when the books' de-vigged projection is 26.4.</p><p>We convert sportsbook prices into a projection (mean) using a normal approximation for that stat, then compute the exact probability of clearing the app's line.</p>`)}
    ${sec('hit', '5 · Two kinds of hit rate', `<p><b>Expected hit rate</b> is the fair probability from the market — it's the best single estimate of how often the bet wins. <b>Observed hit rate</b> (L5/L10/L20, home/away) is how often the player actually cleared that number. Small samples are noisy: 7/10 is consistent with a true 50% player more often than you'd think. Use game logs as a tiebreaker, not the main reason.</p>`)}
    ${sec('clv', '6 · Closing line value — your real report card', `<p>Results take thousands of bets to mean anything. CLV tells you much sooner. If you bet −110 and it closes −130, you beat the market's final, sharpest number. Bettors who consistently beat the close win long-term. Record the closing odds in your Logbook and watch the CLV tile.</p>`)}
    ${sec('factors', '7 · Situational factors', `<ul><li><b>Weather</b> (live Open-Meteo forecasts at each stadium): wind over ~12 mph suppresses NFL passing and kicking; rain and extreme cold lean under; heat helps baseballs carry; Coors Field altitude inflates scoring. Domes are ignored; retractable roofs are discounted.</li><li><b>Home vs away + travel</b>: miles flown and time zones crossed; West-coast teams in 1 PM ET kickoffs are a classic fade.</li><li><b>Rest</b>: NBA/NHL back-to-backs, NFL bye weeks.</li><li><b>Market signals</b>: ticket % vs money %, reverse line movement (line moves against the public side).</li><li><b>Injuries, goalies, starting pitchers, pace</b>.</li></ul><p>Factor scores are shown <i>separately</i> from EV. The price already includes most public information; factors tell you when the situation agrees or disagrees with the price.</p>`)}
    ${sec('kelly', '8 · Bet sizing', `<p>Kelly stake = (b·p − q) / b, where b = decimal odds − 1. Full Kelly is too volatile; this app defaults to <b>¼ Kelly</b> and you can change it in Settings. Stick to 1–2% of bankroll per bet.</p>`)}
    ${sec('rg', '9 · Play it safe', `<p>Even +EV bettors have long losing streaks. Set a budget, never chase losses, and use your books' deposit limits. If it stops being fun, call or text <b>1-800-GAMBLER</b>.</p>`)}`;
  },

  settings() {
    const live = settings.mode === 'live';
    return `<div class="grid g-2">
      <div class="card"><div class="card-h"><h3>Data source</h3></div>
        <div class="seg" data-set="mode" style="margin-bottom:14px"><button class="${!live ? 'on' : ''}" data-v="demo">Demo slate</button><button class="${live ? 'on' : ''}" data-v="live">Live odds</button></div>
        <div class="form-grid">
          <div class="field full"><label>The Odds API key</label><input class="input" type="password" data-s="oddsApiKey" value="${esc(settings.oddsApiKey)}" placeholder="Paste your key from the-odds-api.com" autocomplete="off"/><small>Free tier = 500 credits/month. A full refresh ≈ 3 credits per in-season sport (props cost more). Your key is stored only in this browser.</small></div>
          <label class="switch full"><input type="checkbox" data-sb="includeSharp" ${settings.includeSharp ? 'checked' : ''}/> Include Pinnacle as the sharp reference (no extra cost)</label>
          <label class="switch full"><input type="checkbox" data-sb="fetchProps" ${settings.fetchProps ? 'checked' : ''}/> Auto-load props for the next few games on every refresh (otherwise load per game in Prop Lab)</label>
          <label class="switch full"><input type="checkbox" data-sb="realStats" ${settings.realStats ? 'checked' : ''}/> Real player game logs & injury reports from ESPN (free, no key)</label>
          <div class="field"><label>Auto-load: games per sport</label><input class="input" type="number" min="1" max="10" data-sn="propEvents" value="${settings.propEvents}"/></div>
          <div class="field"><label>Credits remaining</label><div class="input num">${quota.remaining ?? '—'}</div></div>
        </div>
        <div class="modal-foot" style="justify-content:flex-start"><button class="btn primary" data-act="testKey">Save & load live odds</button></div>
      </div>
      <div class="card"><div class="card-h"><h3>Bankroll & sizing</h3></div>
        <div class="form-grid">
          <div class="field"><label>Starting bankroll ($)</label><input class="input" type="number" data-sn="bankroll" value="${settings.bankroll}"/></div>
          <div class="field"><label>Default unit ($)</label><input class="input" type="number" data-sn="unit" value="${settings.unit}"/></div>
          <div class="field"><label>Kelly fraction</label><select class="input" data-sn="kellyFrac">${[[0.1, '1/10 Kelly'], [0.25, '¼ Kelly'], [0.5, '½ Kelly'], [1, 'Full Kelly']].map(([v, l]) => `<option value="${v}" ${+settings.kellyFrac === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Minimum edge for Summit picks</label><select class="input" data-sn="minEv">${[0, 0.01, 0.02, 0.03, 0.05].map((v) => `<option value="${v}" ${+settings.minEv === v ? 'selected' : ''}>${(v * 100).toFixed(0)}%</option>`).join('')}</select></div>
        </div>
      </div>
      <div class="card"><div class="card-h"><h3>Sports</h3></div>
        <div class="form-grid">${Object.entries(SPORTS).map(([k, s]) => `<label class="switch"><input type="checkbox" data-sport="${k}" ${settings.sports[k] ? 'checked' : ''}/> <span class="dot" style="background:${sc(k)}"></span> ${s.label}</label>`).join('')}</div>
      </div>
      <div class="card"><div class="card-h"><h3>Look & feel</h3></div>
        <div class="seg" data-set="theme" style="margin-bottom:14px">${[['auto', 'Auto'], ['dark', 'Night Forest'], ['light', 'Morning Fog']].map(([k, l]) => `<button class="${settings.theme === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
        <label class="switch"><input type="checkbox" data-sb="rain" ${settings.rain ? 'checked' : ''}/> Seattle drizzle (ambient rain)</label>
        <div class="modal-foot" style="justify-content:flex-start"><button class="btn danger" data-act="reset">Reset all local data</button></div>
      </div>
    </div>`;
  },
};

function slipCard(x, i) {
  const stake = Math.min(+settings.unit || 25, settings.bankroll * kelly(x.pAll, x.odds, settings.kellyFrac)); // long shots: never more than 1 unit
  return `<article class="card pick slip" style="--sc:${BOOKS[x.book]?.hue || 'var(--accent)'}">
    <div class="pick-top">${bookBadge(x.book)}<span>· ${esc(x.name)}</span>${x.ev > 0 ? `<span class="tier summit" style="margin-left:auto">${pctS(x.ev, 0)} EV</span>` : `<span class="tier" style="margin-left:auto">${pctS(x.ev, 0)} EV</span>`}</div>
    <ol class="legs">${x.legs.map((l) => `<li><span class="dot" style="background:${sc(l.sport)}"></span><div><b>${l.kind === 'dfs' ? `${esc(l.player)} <span class="more-less">${l.side === 'over' ? 'MORE' : 'LESS'}</span> ${l.line} ${esc(l.stat)}` : esc(l.label)}</b><small>${l.kind === 'dfs' ? `${esc(l.game.awayTeam.abbr)} @ ${esc(l.game.homeTeam.abbr)}` : esc(l.sub)}${l.hr?.l10 != null ? ` · L10 ${fmtPct(l.hr.l10, 0)}` : ''}${l.vs?.n ? ` · vs opp ${l.vs.hits}/${l.vs.n}` : ''}</small></div><em>${l.kind === 'dfs' ? fmtPct(l.p, 0) : `${fmtAm(l.price)} · ${fmtPct(l.p, 0)}`}</em></li>`).join('')}</ol>
    <div class="metrics"><div class="metric"><small>Hits</small><b>${fmtPct(x.pAll, 1)}</b></div><div class="metric"><small>Pays</small><b>${x.type === 'dfs' ? x.pay + '×' : fmtAm(x.odds)}</b></div><div class="metric"><small>Stake</small><b data-tip="Quarter-Kelly, capped at your unit size for parlays">${money(Math.max(0, stake))}</b></div></div>
    <div class="why">${x.type === 'dfs' ? `Each pick needs ${fmtPct(x.breakEven)} to break even; these average ${fmtPct(x.legs.reduce((t, l) => t + l.p, 0) / x.legs.length)}.` : `Every leg is +EV at ${esc(bookName(x.book))}'s own price. Fair odds ${fmtAm(probToAm(x.pAll))} vs ${fmtAm(x.odds)} offered.`} Loses ${fmtPct(1 - x.pAll, 0)} of the time — size it small.</div>
    <div class="pick-foot"><span class="mut" style="font-size:12px">${x.sameGame ? 'Same game — legs are correlated, hit % is approximate' : 'One leg per game (no correlation)'}</span><button class="btn sm primary" data-act="logslip" data-i="${i}">+ Log ${x.type === 'dfs' ? 'slip' : 'parlay'}</button></div>
  </article>`;
}

function kpi(label, value, sub, cls = '') { return `<div class="card kpi"><small>${label}</small><b class="${cls}">${value}</b><span>${sub}</span></div>`; }

function bankrollChart(h, list = store.bets) {
  const settled = list.filter((b) => ['won', 'lost', 'push'].includes(b.status)).sort((a, b) => new Date(a.placed) - new Date(b.placed));
  let bank = +settings.bankroll;
  const pts = [{ x: settled[0]?.placed || new Date().toISOString(), y: bank, label: 'Start' }].concat(settled.map((b) => { bank += store.payout(b); return { x: b.placed, y: bank, label: `${b.selection} (${b.status})` }; }));
  return lineChart(pts, { height: h, fmtY: (v) => '$' + Math.round(v).toLocaleString(), fmtX: (v) => dateS(v), color: bank >= settings.bankroll ? 'var(--moss)' : 'var(--bad)', baseline: +settings.bankroll, label: 'Bankroll over time' });
}

function propCard(o) {
  const a = o.a;
  const initials = o.player.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const hrc = (v) => (v == null ? '' : v >= 0.6 ? 'hot' : v <= 0.4 ? 'cold' : '');
  const books = Object.entries(o.books).filter(([k]) => BOOKS[k]?.kind !== 'dfs');
  return `<article class="card prop" style="--sc:${sc(o.sport)}">
    <div class="prop-h"><div class="avatar" style="background:${sc(o.sport)}">${esc(initials)}${o.espnId ? `<img src="${headshot(o.sport, o.espnId)}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}</div>
      <div><h3>${esc(o.player)}</h3><div class="sub">${o.team ? `${esc(o.team)} ${o.home ? 'vs' : '@'} ${esc(o.opp)}` : esc(o.opp)} · ${time(o.time)}</div></div>
      <div class="prop-line"><small>${esc(o.stat)}</small><b>${a.bookLine}</b></div></div>
    <div class="fchips">${tierBadge(o.grade)}<span class="fchip">Proj ${a.mu.toFixed(1)}</span><span class="fchip">Over ${fmtPct(a.pOver, 0)} fair</span>${books.slice(0, 4).map(([k, v]) => `<span class="fchip" data-tip="${esc(bookName(k))} ${v.line}: o${fmtAm(v.over)} / u${fmtAm(v.under)}">${esc(BOOKS[k]?.short || k)} ${fmtAm(v.over)}</span>`).join('')}</div>
    <div class="dfs-row">
      <div class="dfs ${!o.useDfs && a.sb.ev > 0 ? 'good' : ''}"><small>Best book</small><b>${a.sb.side === 'over' ? 'o' : 'u'}${a.bookLine} ${fmtAm(a.sb.price)}</b><span>${esc(bookName(a.sb.book))} · ${pctS(a.sb.ev)} EV</span></div>
      ${a.dfs.map((d) => `<div class="dfs ${d.edge > 0 ? 'good' : ''}"><small>${esc(bookName(d.book))}</small><b><span class="more-less">${d.side === 'over' ? 'MORE' : 'LESS'}</span> ${d.line}</b><span>${fmtPct(d.p)} · ${d.edge > 0 ? '+' : ''}${(d.edge * 100).toFixed(1)} vs B/E</span></div>`).join('')}
    </div>
    ${o.vs ? `<div class="vs-box"><div class="vs-h"><b>vs ${esc(o.opp)} · career</b><span>${o.vs.n ? `${o.vs.hits}/${o.vs.n} ${o.side === 'over' ? 'over' : 'under'} · avg ${o.vs.avg.toFixed(1)} · since ${o.vs.first}` : 'never faced them'}</span></div>
      ${o.vs.n ? `<div class="hr-row" style="grid-template-columns:repeat(3,1fr)">${[['Career', o.vs.rate, o.vs.n], ['Last 3 seasons', o.vs.recent.rate, o.vs.recent.n], ['Last 5 vs them', o.vs.last5.filter((g) => (o.side === 'over' ? g.v > o.line : g.v < o.line)).length / (o.vs.last5.length || 1), o.vs.last5.length]].map(([l, v, n]) => `<div class="hr ${hrc(n ? v : null)}"><small>${l}</small><b>${n ? fmtPct(v, 0) : '—'}</b></div>`).join('')}</div>
      ${logBars(o.vs.log.map((g) => ({ ...g, opp: "'" + g.date.slice(2, 4) })), o.line, o.side, { n: 8 })}` : ''}</div>` : ''}
    ${o.scheme ? `<div class="scheme-box"><div class="vs-h"><b>🛡 Scheme vs ${esc(o.scheme.opp)}</b><span class="${(o.scheme.delta >= 0) === (o.side === 'over') ? 'pos' : 'neg'}">${esc(o.scheme.headline)}</span></div>
      <p>${esc(o.scheme.defLine)}</p><p>${esc(o.scheme.detail)}</p><small>Coverage splits: ${o.scheme.season} season · nflverse</small></div>` : ''}
    <div class="hr-row">${[['L5', o.hr.l5], ['L10', o.hr.l10], ['L20', o.hr.l20], ['Home', o.hr.home], ['Away', o.hr.away]].map(([l, v]) => `<div class="hr ${hrc(v)}"><small>${l}</small><b>${fmtPct(v, 0)}</b></div>`).join('')}</div>
    ${logBars(o.log || [], o.line, o.side)}
    <details class="why"><summary>Why ${o.side === 'over' ? (o.useDfs ? 'More' : 'Over') : (o.useDfs ? 'Less' : 'Under')} ${o.line}</summary>${whyProp(o)}</details>
    <div class="pick-foot"><span class="mut" style="font-size:12px">${o.realLog ? '<span class="real-dot"></span>Real ESPN game log' : 'Simulated game log'} · ${o.live ? 'live prices' : 'simulated prices'}</span><button class="btn sm primary" data-act="logprop" data-id="${esc(o.id)}">+ Log pick</button></div>
  </article>`;
}

function windSvg(deg, mph) {
  // wind direction is where it comes FROM; arrow points where it blows TO
  return `<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="none" stroke="var(--line-2)"/><text x="22" y="9" text-anchor="middle" font-size="7" fill="var(--muted)">N</text>
    <g transform="rotate(${(deg + 180) % 360} 22 22)"><path d="M22 34V12m0 0-5 6m5-6 5 6" fill="none" stroke="var(--glacier)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

function condCard(g, focus) {
  const wx = g.weather, l = wx ? wxLabel(wx.code, wx.pop) : null;
  const leans = {};
  for (const f of g.factors) if (f.lean) { const k = f.lean.s; leans[k] = (leans[k] || 0) + f.lean.w; }
  const leanName = (k) => (k === 'home' ? g.homeTeam.abbr : k === 'away' ? g.awayTeam.abbr : k === 'over' ? 'Over' : 'Under');
  const best = state.opps.filter((o) => o.gameId === g.id).sort((a, b) => b.ev - a.ev)[0];
  return `<div class="card" id="g-${esc(g.id)}" ${focus ? 'style="border-color:var(--accent)"' : ''}>
    <div class="card-h"><div class="matchup">${sportTag(g.sport)}<span class="team">${esc(g.away)}</span><span class="at">at</span><span class="team">${esc(g.home)}</span></div><div class="right mut">${time(g.time)} <a class="btn sm ghost" href="#/game?g=${encodeURIComponent(g.id)}">Focus →</a></div></div>
    <div class="cond">
      <div class="wx-panel">
        ${g.homeTeam.roof === 'd' ? `<div class="big"><span>🏟</span>Indoors</div><div class="mut" style="font-size:12.5px">Climate-controlled. Weather doesn't apply.</div>` : wx ? `
          <div class="big"><span>${l.g}</span>${wx.temp}°</div><div style="font-weight:600">${l.t}${g.homeTeam.roof === 'r' ? ' · retractable roof' : ''}</div>
          <div class="wind">${windSvg(wx.dir, wx.wind)}<div><b class="num">${wx.wind} mph</b><div class="mut" style="font-size:12px">from ${compass(wx.dir)}${wx.gust ? ` · gusts ${wx.gust}` : ''}</div></div></div>
          <div class="wx-grid"><div>Precip<b>${wx.pop}%</b></div><div>Total adj.<b>${(() => { const x = weatherTotalAdj(g.sport, wx, g.homeTeam.roof); return x ? (x > 0 ? '+' : '') + x.toFixed(1) : '±0'; })()}</b></div></div>
          <div class="mut" style="font-size:11px">${wx.live ? '● Live forecast · Open-Meteo' : '○ Simulated (outside forecast window)'}</div>` : `<div class="big"><span>⛅</span>—</div><div class="mut" style="font-size:12.5px">Forecast not available yet.</div>`}
      </div>
      <div>
        <div class="factor-list">${g.factors.map((f) => `<div class="factor"><div class="ic">${f.icon}</div><div class="lb2">${esc(f.label)}<small>${esc(f.value)}</small></div><p>${esc(f.note)}</p>${f.lean ? `<span class="lean on">→ ${esc(leanName(f.lean.s))} ${f.lean.w.toFixed(1)}</span>` : '<span class="lean">neutral</span>'}</div>`).join('')}</div>
        <div class="lean-sum" style="margin-top:12px"><span class="mut" style="font-size:12.5px;align-self:center">Situation leans:</span>${Object.entries(leans).sort((a, b) => b[1] - a[1]).map(([k, w]) => `<span class="fchip up">${esc(leanName(k))} +${w.toFixed(1)}</span>`).join('') || '<span class="fchip">No strong lean</span>'}
          ${best ? `<span style="margin-left:auto" class="fchip">Best price edge: <b>&nbsp;${esc(best.selection)} ${fmtAm(best.bestPrice)} (${pctS(best.ev)})</b></span>` : ''}</div>
      </div>
    </div></div>`;
}

function demoBanner() {
  if (settings.mode === 'live' && state.slate?.source === 'live') return '';
  const mlb = state.sport === 'mlb' || state.sport === 'all';
  return `<div class="banner">🧭 <span><b>Demo slate.</b> Matchups and prices are simulated so you can explore everything${state.slate?.games.nfl?.some((g) => g.weather?.live) ? ' — stadium weather is <b>live</b>' : ''}${state.realInfo?.logOk ? `; player game logs and injury reports are <b>real</b> (ESPN)` : ''}. ${mlb ? 'MLB is in the offseason, so its slate is a sandbox. ' : ''}Add a free Odds API key for real DraftKings, FanDuel, BetMGM, Caesars, PrizePicks & Underdog lines.</span><a class="btn sm" href="#/settings">Go live</a></div>`;
}

// ---------------- modals ----------------
function modal(html, onMount) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  const close = () => (root.innerHTML = '');
  onMount?.(bg, close);
  bg.querySelector('input,select')?.focus();
  return close;
}

function betModal(pre = {}, editId = null) {
  const existing = editId ? store.bets.find((b) => b.id === editId) : null;
  const b = { sport: state.sport === 'all' ? 'nfl' : state.sport, book: 'draftkings', market: 'spread', stake: settings.unit, odds: -110, ...pre, ...(existing || {}) };
  const sugg = pre.fairP ? settings.bankroll * kelly(pre.fairP, b.odds, settings.kellyFrac) : null;
  modal(`<h2>${existing ? 'Edit bet' : 'Log a bet'}</h2><p class="lede">${pre.fairP ? `Fair ${fmtPct(pre.fairP)} · ¼-Kelly suggests <b>${money(sugg)}</b>` : 'Track everything — the logbook computes ROI, hit rate and CLV.'}</p>
    <form class="form-grid" id="betForm">
      <div class="field full"><label>Selection</label><input class="input" name="selection" required value="${esc(b.selection || '')}" placeholder="e.g. SEA -3, Over 44.5, SGA o30.5 pts"/></div>
      <div class="field"><label>Sport</label><select class="input" name="sport">${Object.entries(SPORTS).map(([k, s]) => `<option value="${k}" ${b.sport === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div class="field"><label>Book</label><select class="input" name="book">${Object.entries(BOOKS).map(([k, x]) => `<option value="${k}" ${b.book === k ? 'selected' : ''}>${x.name}</option>`).join('')}<option value="other">Other</option></select></div>
      <div class="field"><label>Bet type</label><select class="input" name="market">${['moneyline', 'spread', 'total', 'prop', 'parlay'].map((k) => `<option ${b.market === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
      <div class="field"><label>Odds (American)</label><input class="input" name="odds" type="number" required value="${b.odds}"/><small>Pick'em: use the slip's effective price (−122 ≈ 5-pick at break-even)</small></div>
      <div class="field"><label>Stake ($)</label><input class="input" name="stake" type="number" step="0.01" required value="${sugg && !existing ? Math.max(1, Math.round(sugg)) : b.stake}"/></div>
      <div class="field"><label>Closing odds (optional)</label><input class="input" name="closeOdds" type="number" value="${b.closeOdds || ''}"/><small>Fill in later to track CLV</small></div>
      <div class="field"><label>Status</label><select class="input" name="status">${['pending', 'won', 'lost', 'push'].map((s) => `<option ${(b.status || 'pending') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Date placed</label><input class="input" name="placed" type="date" value="${(b.placed || new Date().toISOString()).slice(0, 10)}"/></div>
      <div class="field full"><label>Notes</label><input class="input" name="notes" value="${esc(b.notes || '')}" placeholder="Why you took it"/></div>
    </form>
    <div class="modal-foot">${existing ? '<button class="btn danger" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${existing ? 'Save' : 'Log bet'}</button></div>`,
  (bg, close) => {
    bg.querySelector('[data-save]').onclick = () => {
      const form = bg.querySelector('#betForm');
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form));
      const rec = { ...d, odds: +d.odds, stake: +d.stake, closeOdds: d.closeOdds ? +d.closeOdds : null, placed: new Date(d.placed + 'T12:00:00').toISOString(), fairP: pre.fairP || existing?.fairP || null };
      if (existing) store.updateBet(existing.id, rec); else store.addBet(rec);
      close(); toast(existing ? 'Bet updated' : `Logged: ${rec.selection} ${fmtAm(rec.odds)}`); render();
    };
    bg.querySelector('[data-del]')?.addEventListener('click', () => { store.removeBet(existing.id); close(); toast('Bet deleted'); render(); });
  });
}

function linkModal(k) {
  const b = BOOKS[k], a = store.accounts[k] || {};
  const step1 = `<h2>Connect ${b.name}</h2><p class="lede">Pick how you want to bring this account in. You can switch any time.</p>
    <div class="methods">
      <button class="method" data-m="manual"><span class="mi">✍️</span><span><b>Manual tracking</b><small>Enter your balance and log bets as you place them. Works for every book, instantly.</small></span></button>
      <button class="method" data-m="csv"><span class="mi">📄</span><span><b>Import bet history (CSV)</b><small>Export your history from ${b.name} (or a tracker like Pikkit) and drop the file here. Columns are auto-detected.</small></span></button>
      <button class="method" data-m="sync"><span class="mi">🔄</span><span><b>Auto-sync via SharpSports</b><small>Aggregator that links ${b.name} through its own secure flow and syncs bet slips. Requires a SharpSports developer key and a small backend — see README.</small></span></button>
    </div><div class="modal-foot"><button class="btn" data-close>Cancel</button></div>`;
  modal(step1, (bg, close) => {
    bg.querySelectorAll('[data-m]').forEach((btn) => btn.onclick = () => {
      const m = btn.dataset.m;
      const m$ = bg.querySelector('.modal');
      if (m === 'manual') {
        m$.innerHTML = `<h2>${b.name} · manual</h2><p class="lede">Balances are for your dashboard only.</p>
          <div class="form-grid"><div class="field"><label>Current balance ($)</label><input class="input" id="bal" type="number" value="${a.balance || ''}"/></div><div class="field"><label>Username / nickname (optional)</label><input class="input" id="nick" value="${esc(a.nick || '')}"/></div></div>
          <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button></div>`;
        m$.querySelector('#go').onclick = () => { store.accounts[k] = { ...a, linked: true, method: 'manual', balance: +$('#bal').value || 0, nick: $('#nick').value, linkedAt: a.linkedAt || new Date().toISOString() }; store.saveAccounts(); close(); toast(`${b.name} linked`); render(); };
      } else if (m === 'csv') {
        m$.innerHTML = `<h2>${b.name} · import CSV</h2><p class="lede">Needs at least <code>stake</code> and <code>odds</code> (or <code>payout</code>) columns. Optional: date, selection/description, status/result, sport.</p>
          <div class="form-grid"><div class="field full"><label>CSV file</label><input class="input" id="file" type="file" accept=".csv,text/csv"/></div><div class="field"><label>Current balance ($)</label><input class="input" id="bal" type="number" value="${a.balance || ''}"/></div></div>
          <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Import</button></div>`;
        m$.querySelector('#go').onclick = async () => {
          const file = $('#file').files[0];
          let res = { added: 0, skipped: 0 };
          if (file) res = store.importCsv(await file.text(), k);
          store.accounts[k] = { ...a, linked: true, method: 'csv', balance: +$('#bal').value || a.balance || 0, linkedAt: a.linkedAt || new Date().toISOString(), lastImport: new Date().toISOString() };
          store.saveAccounts(); close(); toast(`${b.name}: imported ${res.added} bets${res.skipped ? `, skipped ${res.skipped}` : ''}`); render();
        };
      } else {
        m$.innerHTML = `<h2>${b.name} · SharpSports sync</h2><p class="lede">SharpSports' Link UI handles the sportsbook login; your backend exchanges a <b>private</b> API key for bet slips. Private keys must never live in a browser, so point this at your own proxy (a template is in <code>server/sharpsports-proxy.js</code>).</p>
          <div class="form-grid"><div class="field full"><label>Your proxy URL</label><input class="input" id="proxy" placeholder="http://localhost:8787" value="${esc(a.proxy || localStorage.getItem('degen.ssProxy') || '')}"/></div><div class="field full"><label>Bettor ID (internal)</label><input class="input" id="bettor" value="${esc(a.bettor || 'me')}"/></div></div>
          <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Connect & sync</button></div>`;
        m$.querySelector('#go').onclick = async () => {
          const proxy = $('#proxy').value.replace(/\/$/, ''), bettor = $('#bettor').value;
          localStorage.setItem('degen.ssProxy', proxy);
          try {
            const r = await fetch(`${proxy}/link?bettor=${encodeURIComponent(bettor)}&book=${k}`);
            if (!r.ok) throw new Error(r.status);
            const { linkUrl } = await r.json();
            if (linkUrl) window.open(linkUrl, '_blank', 'noopener');
            store.accounts[k] = { ...a, linked: true, method: 'sync', proxy, bettor, linkedAt: new Date().toISOString() };
            store.saveAccounts(); close(); toast('Finish linking in the SharpSports window, then hit Sync.'); render();
          } catch (e) { toast(`Couldn't reach your proxy (${e.message}). See README → Account sync.`); }
        };
      }
    });
  });
}

// ---------------- chrome ----------------
function renderTop() {
  const chips = [['all', 'All', null], ...Object.entries(SPORTS).filter(([k]) => settings.sports[k]).map(([k, s]) => [k, s.label, k])];
  $('#sportChips').innerHTML = chips.map(([k, l, c]) => `<button class="chip ${state.sport === k ? 'on' : ''}" data-sport-chip="${k}" role="tab" aria-selected="${state.sport === k}">${c ? `<span class="dot" style="background:${sc(c)}"></span>` : ''}${l}</button>`).join('');
  const src = state.slate ? (state.slate.source === 'live' ? 'Live odds' : 'Demo slate') : 'Loading…';
  $('#topSub').innerHTML = `<span>${state.loading ? 'Refreshing lines…' : src}${state.enriching === 'h2h' ? ' · pulling career matchups…' : state.enriching ? ' · pulling real stats from ESPN…' : state.realInfo?.logOk ? ` · ${state.realInfo.logOk} real game logs` : ''}${state.slate ? ' · updated ' + new Date(state.slate.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span>${state.homeWx ? `<span>· Seattle ${state.homeWx.t}°F ${state.homeWx.g}</span>` : ''}`;
  const st = store.stats(store.bets);
  $('#sideFoot').innerHTML = `<div class="bank-card"><small>Bankroll</small><b>${money(settings.bankroll + st.profit)}</b><span class="${st.profit >= 0 ? 'pos' : 'neg'}">${money(st.profit, true)} · ROI ${pctS(st.roi)}</span></div>
    <a class="mode-pill ${state.slate?.source === 'live' ? 'live' : ''}" href="#/settings"><i></i>${state.slate?.source === 'live' ? 'Live odds' : 'Demo mode'}</a>`;
}

const TITLES = { home: 'Basecamp', lines: 'Line Shop', props: 'Prop Lab', parlays: 'Parlay Builder', game: 'Game Focus', longshots: 'Long Shots', conditions: 'Conditions', logbook: 'Logbook', accounts: 'Accounts', guide: 'Field Guide', settings: 'Settings' };
function route() { const r = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'home'); return views[r] ? r : 'home'; }

function render() {
  const r = route();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r));
  $('#pageTitle').textContent = TITLES[r];
  document.title = `${TITLES[r]} · Cascadia Line Lab`;
  renderTop();
  const v = $('#view');
  const needsSlate = !['logbook', 'accounts', 'guide', 'settings'].includes(r);
  if (needsSlate && !state.slate) { v.innerHTML = `<div class="empty"><div style="font-size:36px">🌲</div><h3>Scouting the lines…</h3><p>Pulling prices and stadium forecasts.</p></div>`; return; }
  const scrollY = window.scrollY;
  v.innerHTML = views[r]();
  hydrate(v);
  if (state.keepScroll) window.scrollTo(0, scrollY); state.keepScroll = false;
  const csv = $('#csvIn');
  if (csv) csv.onchange = async () => { const f = csv.files[0]; if (!f) return; const res = store.importCsv(await f.text()); toast(`Imported ${res.added} bets${res.skipped ? `, skipped ${res.skipped}` : ''}`); render(); };
  if (r === 'conditions') { const g = new URLSearchParams(location.hash.split('?')[1] || '').get('g'); if (g) document.getElementById('g-' + g)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  if (r === 'props') { const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q'); if (q && state.propf.q !== q) { state.propf.q = q; render(); } }
}

function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4200);
}

function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = settings.theme;
}
const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

// ---------------- events ----------------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-sport-chip],[data-seg] button,[data-lseg] button,[data-set] button,[data-jump]');
  if (!t) return;
  if (t.dataset.sportChip) { state.sport = t.dataset.sportChip; localStorage.setItem('degen.sport', state.sport); state.keepScroll = true; return render(); }
  if (t.dataset.jump) { e.preventDefault(); return document.getElementById(t.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }); }
  const lseg = t.closest('[data-lseg]');
  if (lseg) { state.longf[lseg.dataset.lseg] = t.dataset.v; state.keepScroll = true; return render(); }
  const seg = t.closest('[data-seg]');
  if (seg) { const k = seg.dataset.seg; if (k === 'market') state.lines.market = t.dataset.v; else if (k === 'status') state.log.status = t.dataset.v; else state.propf[k] = t.dataset.v; state.keepScroll = true; return render(); }
  const set = t.closest('[data-set]');
  if (set) { settings[set.dataset.set] = t.dataset.v; store.saveSettings(); applyTheme(); if (set.dataset.set === 'mode') load(); return render(); }
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case 'log': { const o = state.opps.find((x) => x.id === id); if (o) betModal({ selection: `${o.selection} (${matchup(o.game)})`, sport: o.sport, book: o.bestBook, odds: o.bestPrice, market: { h2h: 'moneyline', spreads: 'spread', totals: 'total' }[o.market], fairP: o.fairP }); break; }
    case 'logprop': { const o = state.props.find((x) => x.id === id); if (o) betModal({ selection: `${o.player} ${o.side === 'over' ? 'o' : 'u'}${o.line} ${o.stat}`, sport: o.sport, book: o.useDfs ? o.a.dfs[0].book : o.a.sb.book, odds: o.useDfs ? -122 : o.a.sb.price, market: 'prop', fairP: o.p }); break; }
    case 'loadprops': loadProps(id); break;
    case 'scan': scanProps(); break;
    case 'scanlong': scanLongs(); break;
    case 'gamelong': scanLongs([id]); break;
    case 'loglong': { const o = state.longs.find((x) => x.id === id); if (o) betModal({ selection: `${o.player} ${o.stat} (${o.opp})`, sport: o.sport, book: o.a.bestBook, odds: o.a.best, market: 'prop', fairP: o.a.fair }); break; }
    case 'logslip': { const x = state.slips[+t.dataset.i]; if (x) betModal({ selection: x.legs.map((l) => (l.kind === 'dfs' ? `${l.player} ${l.side === 'over' ? 'MORE' : 'LESS'} ${l.line} ${l.stat}` : l.label)).join(' + '), sport: x.legs[0].sport, book: x.book, odds: x.odds, market: 'parlay', fairP: x.pAll }); break; }
    case 'propgame': state.propf.game = id; state.keepScroll = true; render(); break;
    case 'newbet': betModal(); break;
    case 'editbet': betModal({}, id); break;
    case 'clearSample': store.clearSample(); toast('Sample bets cleared — your logbook is all yours.'); render(); break;
    case 'export': { const blob = new Blob([store.exportCsv()], { type: 'text/csv' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `cascadia-logbook-${new Date().toISOString().slice(0, 10)}.csv` }); a.click(); break; }
    case 'link': linkModal(t.dataset.k); break;
    case 'unlink': delete store.accounts[t.dataset.k]; store.saveAccounts(); render(); break;
    case 'testKey': settings.mode = 'live'; store.saveSettings(); if (!settings.oddsApiKey) { toast('Paste an Odds API key first.'); render(); break; } toast('Loading live odds…'); load(true); break;
    case 'reset': if (confirm('Erase all bets, accounts and settings stored in this browser?')) { localStorage.clear(); sessionStorage.clear(); location.reload(); } break;
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-act="status"]')) { store.updateBet(t.dataset.id, { status: t.value }); state.keepScroll = true; return render(); }
  if (t.dataset.s) { settings[t.dataset.s] = t.value.trim(); store.saveSettings(); }
  if (t.dataset.sn) { settings[t.dataset.sn] = +t.value; store.saveSettings(); }
  if (t.dataset.sb) { settings[t.dataset.sb] = t.checked; store.saveSettings(); if (t.dataset.sb === 'rain') rain(); if (t.dataset.sb === 'realStats') load(); }
  if (t.dataset.sport) { settings.sports[t.dataset.sport] = t.checked; store.saveSettings(); renderTop(); }
  if (t.dataset.pb) { state.parlay.book = t.value; state.keepScroll = true; return render(); }
  if (t.dataset.f === 'evOnly') { state.lines.evOnly = t.checked; state.keepScroll = true; render(); }
});
let qTimer;
document.addEventListener('input', (e) => {
  const t = e.target;
  const apply = (obj, k) => { obj[k] = t.value; clearTimeout(qTimer); qTimer = setTimeout(() => { const pos = t.selectionStart; state.keepScroll = true; render(); const n = document.querySelector(`[data-${t.dataset.f ? 'f' : t.dataset.pf ? 'pf' : 'lf'}="${k}"]`); n?.focus(); n?.setSelectionRange(pos, pos); }, 220); };
  if (t.dataset.f === 'q') apply(state.lines, 'q');
  if (t.dataset.pf === 'q') { apply(state.propf, 'q'); if (location.hash.includes('?q=')) history.replaceState(null, '', '#/props'); }
  if (t.dataset.lf === 'q') apply(state.log, 'q');
});
$('#refreshBtn').onclick = () => load(true);
$('#themeBtn').onclick = () => { settings.theme = isDark() ? 'light' : 'dark'; store.saveSettings(); applyTheme(); rain(); };
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');
window.addEventListener('hashchange', () => { $('#side').classList.remove('open'); render(); window.scrollTo(0, 0); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modalRoot').innerHTML = ''; });

// ---------------- ambient rain ----------------
let rainRaf;
function rain() {
  const c = $('#rain'), ctx = c.getContext('2d');
  cancelAnimationFrame(rainRaf);
  ctx.clearRect(0, 0, c.width, c.height);
  if (!settings.rain || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const resize = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; };
  resize(); window.onresize = resize;
  const drops = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), v: 0.004 + Math.random() * 0.006, l: 8 + Math.random() * 14 }));
  const col = isDark() ? 'rgba(170,200,210,.22)' : 'rgba(60,90,100,.16)';
  const tick = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = col; ctx.lineWidth = 1 * devicePixelRatio; ctx.beginPath();
    for (const d of drops) {
      d.y += d.v; d.x -= d.v * 0.12; if (d.y > 1.05) { d.y = -0.05; d.x = Math.random() * 1.1; }
      const x = d.x * c.width, y = d.y * c.height;
      ctx.moveTo(x, y); ctx.lineTo(x - d.l * 0.12 * devicePixelRatio, y + d.l * devicePixelRatio);
    }
    ctx.stroke();
    rainRaf = requestAnimationFrame(tick);
  };
  tick();
}

// ---------------- boot ----------------
applyTheme(); rain(); render(); load();
loadScheme().then((d) => { if (d && state.slate) { compute(); state.keepScroll = true; render(); } });
forecast(47.606, -122.332, new Date(Math.ceil(Date.now() / 36e5) * 36e5).toISOString()).then((w) => { if (w) { state.homeWx = { t: w.temp, g: wxLabel(w.code, w.pop).g }; renderTop(); } });
void TEAMS; void sparkline; void probToAm;
