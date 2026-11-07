# 🌲 Cascadia Line Lab

A Pacific Northwest–themed betting dashboard for **NFL, NBA, MLB and NHL**. It shops every line across the major books, strips out the vig to find the fair price, flags +EV bets, compares PrizePicks/Underdog lines to the sportsbook consensus, layers in weather, travel, rest and home/away factors, and keeps a logbook of every bet you place.

No build step and no dependencies. It's plain HTML/CSS/ES modules.

## Run it

```bash
npm start            # or: node server.js
```

Open http://localhost:5173. (ES modules won't load from `file://`, so you need the tiny server. GitHub Pages or any static host also works.)

## What's inside

| Page | What it does |
|---|---|
| **Basecamp** | Top-graded bets ("Summit picks"), bankroll, ROI, hit rate vs break-even, CLV, weather watch |
| **Line Shop** | Every book side by side with the best price highlighted, plus the no-vig fair line, edge, hold, factor score and grade |
| **Prop Lab** | Player props with L5/L10/L20/home/away hit rates, game-log charts vs the line, and PrizePicks/Underdog break-even math |
| **Conditions** | Per-game weather (live Open-Meteo forecast at the stadium), wind direction, roof type, altitude, travel miles and time zones, rest/back-to-backs, bets vs money splits, reverse line moves, injuries, goalies, pitchers and pace |
| **Logbook** | Log, settle and edit bets. Tracks profit, ROI, hit rate, closing line value, and ROI by book and bet type. CSV import/export |
| **Accounts** | Connect each book manually, by CSV import, or by auto-sync through an aggregator (see below) |
| **Field Guide** | How the math works: vig, EV, line shopping, pick'em break-evens, CLV, Kelly |

## How a bet gets picked

1. **Fair price.** For each book: `fair p = implied(A) / (implied(A) + implied(B))`. Average across books, with Pinnacle weighted 3×.
2. **Edge.** `EV = fair p × best decimal odds − 1`. Lines are only compared at the same point (−3 is never mixed with −3.5).
3. **Pick'em.** Sportsbook prices are turned into a projection, then the exact probability of clearing the PrizePicks/Underdog line is compared to the slip break-even (5-pick 20× = 54.9% per leg).
4. **Factors.** Weather, travel, rest, splits and so on produce a separate **factor score**. It is shown next to the EV and never mixed into it.
5. **Grade.** 0–100 (Summit / Ridge / Trail / Valley): mostly EV, then factors and market depth.

## Live odds

The app opens in **Demo mode**. The slate, prices and game logs are simulated, but stadium weather is real. To switch to real lines:

1. Get a free key at [the-odds-api.com](https://the-odds-api.com) (500 credits/month).
2. Go to **Settings**, paste the key, and click **Save & load live odds**.

Covered books: DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Pinnacle (eu region), plus ESPN/theScore and Fanatics (us2), and PrizePicks/Underdog (us_dfs, when props are on). Responses are cached for 5 minutes to save credits.

**Limitations in live mode:**
- Player game logs and hit rates need a stats feed, so they are only populated in demo mode.
- Bet/money splits, injuries, goalies and starting pitchers aren't in the odds feed and are skipped.
- Travel assumes the away team is coming from home.

## Connecting sportsbook accounts

DraftKings, FanDuel, PrizePicks and the rest **do not offer public APIs**. Scraping them with your login breaks their terms and can get the account closed. This app never asks for a sportsbook password. You have three options:

- **Manual.** Enter your balance and log bets from any pick card in one click.
- **CSV import.** Export your bet history (from the book, or from a tracker like Pikkit) and import it. Columns are detected automatically: date, selection, odds or payout, stake, status, sport.
- **Auto-sync (SharpSports).** SharpSports is a licensed aggregator that hosts the sportsbook login and returns bet slips. You need a developer account and their **private** key, which must stay on a server. Run the template proxy:
  ```bash
  SHARPSPORTS_PUBLIC_KEY=... SHARPSPORTS_PRIVATE_KEY=... npm run sync-proxy
  ```
  Then pick "Auto-sync" on an account and enter `http://localhost:8787`. Check the endpoint paths against SharpSports' current docs before relying on it.

## Privacy

Bets, accounts, settings and your API key live in your browser's `localStorage`. Nothing is sent anywhere except the Odds API and Open-Meteo requests.

---

For research and entertainment. Prices move fast, so always confirm in the app before you bet. Gambling problem? Call or text **1-800-GAMBLER**.
