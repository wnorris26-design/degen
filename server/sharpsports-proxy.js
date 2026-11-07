// Template backend for auto-syncing sportsbook accounts through SharpSports (https://sharpsports.io).
// SharpSports hosts the sportsbook login ("Link UI"), so your sportsbook credentials never touch this app.
// Private API keys must stay server-side — that's why this proxy exists.
//
//   SHARPSPORTS_PRIVATE_KEY=... SHARPSPORTS_PUBLIC_KEY=... node server/sharpsports-proxy.js
//
// ⚠️ Endpoint paths below follow SharpSports' public docs at the time of writing; confirm them against
// https://docs.sharpsports.io before relying on this, as their API may change.
import http from 'http';
const PORT = process.env.PORT || 8787;
const PRIV = process.env.SHARPSPORTS_PRIVATE_KEY, PUB = process.env.SHARPSPORTS_PUBLIC_KEY;
const API = 'https://api.sharpsports.io/v1';
const ORIGIN = process.env.ALLOW_ORIGIN || 'http://localhost:5173';

async function ss(path, opts = {}, key = PRIV) {
  const r = await fetch(API + path, { ...opts, headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`SharpSports ${r.status}: ${await r.text()}`);
  return r.json();
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (!PRIV || !PUB) return send(500, { error: 'Set SHARPSPORTS_PRIVATE_KEY and SHARPSPORTS_PUBLIC_KEY' });
    const bettor = u.searchParams.get('bettor') || 'me';
    if (u.pathname === '/link') {
      // Create a context for the Link UI; user completes the sportsbook login on SharpSports' page.
      const ctx = await ss('/context', { method: 'POST', body: JSON.stringify({ internalId: bettor }) }, PUB);
      return send(200, { linkUrl: `https://ui.sharpsports.io/link/${ctx.cid}` });
    }
    if (u.pathname === '/betslips') {
      const slips = await ss(`/bettors/${encodeURIComponent(bettor)}/betSlips`);
      return send(200, slips);
    }
    if (u.pathname === '/accounts') return send(200, await ss(`/bettors/${encodeURIComponent(bettor)}/bettorAccounts`));
    send(404, { error: 'not found' });
  } catch (e) { send(502, { error: e.message }); }
}).listen(PORT, () => console.log(`SharpSports proxy on http://localhost:${PORT}`));
