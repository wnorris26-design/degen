// Local persistence (your browser only — nothing leaves your machine except API calls you configure).
import { toDec, imp } from './model.js';
import { rng } from './demo.js';
import { BOOKS } from './teams.js';

const K = { settings: 'degen.settings', bets: 'degen.bets', accounts: 'degen.accounts' };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const DEFAULT_SETTINGS = {
  mode: 'demo', oddsApiKey: '', includeSharp: true, includeUs2: false, fetchProps: false, propEvents: 3,
  sports: { nfl: true, nba: true, mlb: true, nhl: true },
  books: Object.keys(BOOKS), includeBookFilter: false,
  bankroll: 1000, unit: 25, kellyFrac: 0.25, minEv: 0.01, theme: 'auto', rain: true, firstRun: true, realStats: true,
};
export const settings = { ...DEFAULT_SETTINGS, ...read(K.settings, {}) };
settings.sports = { ...DEFAULT_SETTINGS.sports, ...(settings.sports || {}) };
export const saveSettings = () => write(K.settings, settings);

export let bets = read(K.bets, null);
export let accounts = read(K.accounts, {});
export const saveBets = () => write(K.bets, bets);
export const saveAccounts = () => write(K.accounts, accounts);

export function payout(b) {
  if (b.status === 'won') return b.stake * (toDec(b.odds) - 1);
  if (b.status === 'lost') return -b.stake;
  return 0;
}

export function addBet(b) {
  bets.unshift({ id: crypto.randomUUID?.() || String(Date.now() + Math.random()), placed: new Date().toISOString(), status: 'pending', ...b });
  saveBets();
}
export function updateBet(id, patch) { const b = bets.find((x) => x.id === id); if (b) Object.assign(b, patch); saveBets(); }
export function removeBet(id) { bets = bets.filter((x) => x.id !== id); saveBets(); }
export function clearSample() { bets = bets.filter((b) => !b.sample); saveBets(); }

export function stats(list) {
  const settled = list.filter((b) => ['won', 'lost', 'push'].includes(b.status));
  const decided = settled.filter((b) => b.status !== 'push');
  const won = decided.filter((b) => b.status === 'won').length;
  const staked = settled.reduce((s, b) => s + +b.stake, 0);
  const profit = settled.reduce((s, b) => s + payout(b), 0);
  const withClose = settled.filter((b) => b.closeOdds);
  const clv = withClose.length ? withClose.reduce((s, b) => s + (imp(b.closeOdds) - imp(b.odds)), 0) / withClose.length : null;
  const expHit = decided.length ? decided.reduce((s, b) => s + imp(b.odds), 0) / decided.length : null;
  return { n: list.length, settled: settled.length, pending: list.filter((b) => b.status === 'pending').length, won, lost: decided.length - won,
    hit: decided.length ? won / decided.length : null, expHit, staked, profit, roi: staked ? profit / staked : null, clv,
    pendingStake: list.filter((b) => b.status === 'pending').reduce((s, b) => s + +b.stake, 0) };
}

/** Sample history so the logbook and charts have something to show on first launch. */
export function seedSample() {
  const r = rng('sample-history');
  const list = [];
  const books = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'prizepicks', 'underdog', 'fanatics'];
  const picks = {
    nfl: ['SEA -3', 'Under 41.5', 'KC ML', 'DET -6.5', 'Over 47', 'BUF -2.5', 'J. Smith-Njigba o5.5 rec'],
    nba: ['POR +6.5', 'Over 231.5', 'OKC -8', 'SGA o30.5 pts', 'DEN ML', 'Under 224', 'Avdija o7.5 reb'],
    nhl: ['SEA ML', 'Under 6', 'COL -1.5', 'McDavid o3.5 SOG', 'VAN ML', 'Over 6.5'],
    mlb: ['SEA ML', 'Under 7.5', 'Raleigh o1.5 TB', 'LAD -1.5', 'Gilbert o6.5 K', 'Over 9 (COL)'],
  };
  for (let i = 0; i < 64; i++) {
    const sport = r.pick(['nfl', 'nfl', 'nba', 'nba', 'nhl', 'mlb']);
    const sel = r.pick(picks[sport]);
    const book = r.pick(books);
    const isDfs = BOOKS[book].kind === 'dfs';
    const odds = isDfs ? -122 : r.pick([-120, -115, -110, -110, -105, +100, +105, +120, +135, +150, -140, +185]);
    const fair = imp(odds) + 0.014 + r.n(0, 0.01);
    const daysAgo = 70 - i - r();
    const status = daysAgo < 3 ? 'pending' : r() < 0.04 ? 'push' : r() < fair ? 'won' : 'lost';
    const close = odds + Math.round(r.n(-6, 10) / 5) * 5 * (odds < 0 ? 1 : -1);
    list.push({ id: 's' + i, sample: true, sport, book, selection: sel,
      market: /o\d|u\d|Over|Under/.test(sel) ? (/ (pts|reb|SOG|rec|TB|K)/.test(sel) ? 'prop' : 'total') : / ML/.test(sel) ? 'moneyline' : 'spread',
      odds, closeOdds: Math.abs(close) < 100 ? (close < 0 ? -100 : 100) : close,
      stake: r.pick([20, 25, 25, 25, 30, 40, 50]), status, placed: new Date(Date.now() - daysAgo * 864e5).toISOString() });
  }
  bets = list.reverse();
  saveBets();
}
if (!bets) seedSample();

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const COLS = {
  placed: ['date', 'placed', 'placed date', 'bet date', 'time', 'created'],
  selection: ['selection', 'description', 'bet', 'pick', 'wager', 'event', 'leg'],
  odds: ['odds', 'price', 'american odds', 'line odds'],
  stake: ['stake', 'wager amount', 'risk', 'amount', 'bet amount', 'entry fee', 'entry'],
  status: ['status', 'result', 'outcome', 'settlement'],
  sport: ['sport', 'league'],
  book: ['book', 'sportsbook', 'site', 'operator'],
  payoutCol: ['payout', 'to win', 'returns', 'winnings', 'return'],
};
export function importCsv(text, defaultBook) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, skipped: 0 };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  let added = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const v = (k) => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');
    const stake = parseFloat(v('stake').replace(/[$,]/g, ''));
    let odds = parseInt(v('odds').replace(/[^\d+-]/g, ''), 10);
    if (!odds && v('payoutCol') && stake) { const pay = parseFloat(v('payoutCol').replace(/[$,]/g, '')); const dec = pay > stake ? pay / stake : 1 + pay / stake; odds = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)); }
    if (!stake || !odds || isNaN(odds)) { skipped++; continue; }
    const st = v('status').toLowerCase();
    const status = /won|win|cashed|paid/.test(st) ? 'won' : /lost|loss|lose/.test(st) ? 'lost' : /push|void|refund|cancel/.test(st) ? 'push' : 'pending';
    const sportRaw = v('sport').toLowerCase();
    const sport = ['nfl', 'nba', 'mlb', 'nhl'].find((s) => sportRaw.includes(s)) || (/football/.test(sportRaw) ? 'nfl' : /basket/.test(sportRaw) ? 'nba' : /base/.test(sportRaw) ? 'mlb' : /hockey/.test(sportRaw) ? 'nhl' : 'nfl');
    const d = new Date(v('placed'));
    addBet({ selection: v('selection') || 'Imported bet', odds, stake, status, sport, book: defaultBook || v('book').toLowerCase() || 'other', market: 'imported', placed: isNaN(d) ? new Date().toISOString() : d.toISOString(), imported: true });
    added++;
  }
  return { added, skipped };
}

export function exportCsv() {
  const head = ['placed', 'sport', 'book', 'market', 'selection', 'odds', 'closeOdds', 'stake', 'status', 'profit'];
  const lines = [head.join(',')].concat(bets.map((b) => head.map((h) => { const x = h === 'profit' ? payout(b).toFixed(2) : b[h] ?? ''; return /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x; }).join(',')));
  return lines.join('\n');
}
