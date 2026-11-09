# 🌲 Cascadia Line Lab

A Pacific Northwest–themed betting dashboard for **NFL, NBA, MLB and NHL**. It shops every line across the major books, strips out the vig to find the fair price, flags +EV bets, compares PrizePicks/Underdog lines to the sportsbook consensus, layers in weather, travel, rest and home/away factors, and keeps a logbook of every bet you place.

No build step and no dependencies. It's plain HTML/CSS/ES modules.

## Run it on your laptop

**Windows (easiest):**
1. Install **Node.js LTS** from https://nodejs.org (accept the defaults). This is a one-time step.
2. Download this repo: on GitHub click **Code → Download ZIP**, then right-click the ZIP and choose **Extract All…**.
3. Open the extracted folder and double-click **`Start Line Lab.bat`**. Your browser opens to http://localhost:5173.
4. Keep the black window open while you use the site. Close it to stop.

If Windows shows "Windows protected your PC", click **More info → Run anyway**. That warning appears for any script downloaded from the internet.

**Mac:** double-click **`Start Line Lab.command`** instead (the first time, right-click it and choose **Open**).

**Any OS, from a terminal:**

```bash
npm start
```

The server only listens on your own machine (127.0.0.1), so nobody else on your Wi-Fi can reach it. Your bets, accounts and API key are saved in that browser. Use the same browser each time, and back up with **Logbook → Export CSV**.

## Use it on your phone (GitHub Pages)

It's a static site, so GitHub Pages hosts it for free:

1. Repo **Settings → General → Danger Zone → Change visibility → Public** (free accounts need a public repo for Pages).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose the branch and `/ (root)`, then **Save**.
3. After about a minute it's live at `https://<your-username>.github.io/degen/`.
4. On your phone, open the link and use **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android) to get a full-screen app icon.

Your API key, bets and accounts live in each browser's local storage, never in the repo. So on your phone, paste the key into Settings once and use **Import CSV** to bring over the logbook you exported from your computer.

## What's inside

| Page | What it does |
|---|---|
| **Basecamp** | Top-graded bets ("Summit picks"), bankroll, ROI, hit rate vs break-even, CLV, weather watch |
| **Line Shop** | Every book side by side with the best price highlighted, plus the no-vig fair line, edge, hold, factor score and grade |
| **Prop Lab** | Player props with real L5/L10/L20/home/away hit rates and **career head-to-head vs tonight's opponent** (ESPN), game-log charts vs the line, and PrizePicks/Underdog break-even math |
| **Game Focus** | Pick one game (e.g. Monday Night Football) and see only that game: every book's lines, its player props (loaded for that game alone, e.g. 4 credits for NFL), career matchups, conditions, and same-game pick'em slips with both teams represented. Remembers your last game |
| **Parlay Builder** | One **Scan** checks every game in the next 24 hours, ranks the best legs, and builds PrizePicks/Underdog slips (2–6 picks) and same-book sportsbook parlays (2–4 legs), with one leg per game so legs don't move together. Shows hit chance, payout, EV and a stake capped at one unit |
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

The app opens in **Demo mode**. Matchups and prices are simulated, but stadium weather, player game logs and injury reports are real. To switch to real lines:

1. Get a free key at [the-odds-api.com](https://the-odds-api.com) (500 credits/month).
2. Go to **Settings**, paste the key, and click **Save & load live odds**.

Covered books: DraftKings, FanDuel, BetMGM, Caesars, theScore/ESPN Bet, Fanatics, BetRivers, Pinnacle (sharp reference), and PrizePicks/Underdog when props are on. Books are requested by name, so overseas books never show up as the "best price", and a full refresh costs about 3 credits per in-season sport. Responses are cached for 5 minutes to save credits.

## Prop credits

Player props cost **1 credit per stat per game**: an NBA game (points, rebounds, assists, threes, PRA) is 5, NFL 4, NHL 3. The scanner shows the cost before it runs and asks before anything over 40 credits. Scanned props are cached for 20 minutes, so reloading or switching pages is free. To scan less, pick one sport with the chips at the top. The free plan (500/month) covers about 3–4 full slates; the $30/month plan (20,000) is effectively unlimited.

## Real player stats & injuries (free, no key)

Player game logs and injury reports come from **ESPN's public site API**. It's free, needs no key, and allows browser calls, so it works in both demo and live mode:

| Data | Endpoint |
|---|---|
| Player lookup | `site.web.api.espn.com/apis/common/v3/search?query=NAME&type=player` |
| Game logs (last 20, pulls last season too if needed) | `site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{id}/gamelog` |
| Injury reports | `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/injuries` |

**Career head-to-head:** for every prop, the app pulls the player's full career game logs (up to 12 seasons) and keeps every game against tonight's opponent. Teams are matched by ESPN team ID, so renames and moves still count (Oakland → Sacramento A's, Indians → Guardians). Each card shows the career hit rate at today's line, the last 3 seasons, the last 5 meetings and a bar chart. That history feeds the factor score, weighted toward recent seasons and discounted for small samples. It's never mixed into the price-based edge. The results are cached for 12 hours.

These drive the L5/L10/L20/home/away hit rates, the game-log charts, player headshots, and the injury factor. Out and doubtful players count the most, NFL QBs and NHL goalies are weighted up, and long-term injured-reserve absences are mostly ignored because the line already reflects them. Results are cached in your browser (game logs for 3 hours, injuries for 30 minutes). You can turn this off in **Settings**.

ESPN's API is undocumented and unofficial. It's widely used, but it can change without notice. If a call fails, the app falls back to simulated data and keeps working.

**Still not covered in live mode:** bet/money splits, confirmed goalies and starting pitchers. Travel assumes the away team is coming from home.

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
