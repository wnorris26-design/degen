// Situational factors. Each factor can "lean" a market: {m:'side'|'totals', s:'home'|'away'|'over'|'under', w:strength}
// Strengths are model heuristics on a roughly -3..+3 scale, not guarantees. They never change the
// market-derived EV; they are shown separately as a "factor score" so you can see when the
// situation agrees or disagrees with the price.
import { milesBetween } from './teams.js';
import { compass, wxLabel } from './weather.js';

const HFA = { nfl: '≈1.5 pts', nba: '≈2.5 pts', nhl: '≈0.2 goals', mlb: '≈54% home win rate' };

export function gameFactors(g) {
  const f = [];
  const H = g.homeTeam, A = g.awayTeam, sp = g.sport, wx = g.weather;
  const add = (key, icon, label, value, note, lean) => f.push({ key, icon, label, value, note, lean });

  // Home / away
  add('home', '🏠', 'Home field', `${H.abbr} home`, `League-average home edge is ${HFA[sp]}. Already baked into the line — this only matters when combined with travel, rest or altitude.`, null);
  if (H.name === 'Seattle Seahawks') add('crowd', '📣', 'Lumen Field noise', '12th Man', 'One of the loudest venues in the league — visiting offenses historically commit more false starts here.', { m: 'side', s: 'home', w: 0.4 });

  // Altitude
  if (H.alt >= 4000) add('alt', '⛰', 'Altitude', `${H.alt.toLocaleString()} ft`, sp === 'mlb' ? 'Thin air: fly balls carry ~5% farther, breaking balls flatten. Overs historically do well at altitude.' : 'Visiting teams fatigue faster at elevation, especially on short rest.',
    sp === 'mlb' ? { m: 'totals', s: 'over', w: 1.0 } : { m: 'side', s: 'home', w: 0.5 });

  // Travel + body clock
  const miles = milesBetween(g.awayPrev || A, H);
  const tzShift = (H.tz - (g.awayPrev || A).tz);
  if (miles > 0) {
    let lean = null, note = `${A.abbr} traveled ${miles.toLocaleString()} mi${tzShift ? `, ${Math.abs(tzShift)} time zone${Math.abs(tzShift) > 1 ? 's' : ''} ${tzShift > 0 ? 'east' : 'west'}` : ''}.`;
    const localHour = new Date(g.time).getUTCHours() + H.tz;
    if (sp === 'nfl' && tzShift >= 2 && localHour <= 13) { lean = { m: 'side', s: 'home', w: 0.6 }; note += ' West-coast team in a 1 PM ET kickoff (body clock ~10 AM) — a well-documented fade spot.'; }
    else if (miles > 1800) { lean = { m: 'side', s: 'home', w: 0.3 }; note += ' Long haul trip.'; }
    add('travel', '✈', 'Travel', `${miles.toLocaleString()} mi`, note, lean);
  }

  // Rest
  if (g.rest) {
    const { home: rh, away: ra } = g.rest;
    if ((sp === 'nba' || sp === 'nhl') && (rh === 0 || ra === 0)) {
      const tired = rh === 0 && ra !== 0 ? 'home' : ra === 0 && rh !== 0 ? 'away' : null;
      if (tired) add('rest', '🔋', 'Back-to-back', `${(tired === 'home' ? H : A).abbr} on B2B`, 'Second night of a back-to-back: legs fade late, shooting and save % dip. Fade the tired team, lean over on defensive slippage.', { m: 'side', s: tired === 'home' ? 'away' : 'home', w: 0.8 });
      else add('rest', '🔋', 'Rest', 'Both on B2B', 'Both teams on zero rest — tends to wash out, slight over lean.', { m: 'totals', s: 'over', w: 0.3 });
    } else if (Math.abs(rh - ra) >= 3) {
      const fresh = rh > ra ? 'home' : 'away';
      add('rest', '🔋', 'Rest edge', `${rh}d vs ${ra}d`, `${(fresh === 'home' ? H : A).abbr} has ${Math.abs(rh - ra)} extra days of rest${sp === 'nfl' && Math.max(rh, ra) >= 13 ? ' (off a bye)' : ''}.`, { m: 'side', s: fresh, w: 0.5 });
    } else add('rest', '🔋', 'Rest', `${rh}d vs ${ra}d`, 'No meaningful rest edge.', null);
  }

  // Weather
  if (H.roof === 'd') add('roof', '🏟', 'Indoors', 'Dome', 'Climate controlled — weather is irrelevant.', null);
  else if (wx) {
    const lbl = wxLabel(wx.code, wx.pop);
    const roofNote = H.roof === 'r' ? ' Retractable roof — likely closed in rain or cold, which neutralizes this.' : '';
    const damp = H.roof === 'r' ? 0.35 : 1;
    add('wx', lbl.g, 'Conditions', `${wx.temp}°F · ${lbl.t}`, `${wx.live ? 'Live Open-Meteo forecast' : 'Simulated forecast'} for kickoff/first pitch.${roofNote}`, null);
    if (wx.wind >= 12) {
      const w = Math.min(3, (wx.wind - 10) / 5) * damp;
      add('wind', '🌬', 'Wind', `${wx.wind} mph ${compass(wx.dir)}${wx.gust > wx.wind + 6 ? ` (gusts ${wx.gust})` : ''}`,
        sp === 'nfl' ? `Sustained wind over ~12 mph hurts deep passing and kicking. Model trims about 0.4 pts from the total per mph over 10. Markets often only price part of it.`
          : `Wind ${wx.wind} mph out of the ${compass(wx.dir)}. Blowing out to center = homers and overs; blowing in = pitcher's day. Check park orientation.`,
        sp === 'nfl' ? { m: 'totals', s: 'under', w } : null);
    }
    if (wx.pop >= 55 && wx.precip >= 0.02) add('rain', '🌧', 'Precipitation', `${wx.pop}% · ${wx.precip.toFixed(2)}″/hr`, sp === 'nfl' ? 'Wet ball → more fumbles, more running, shorter games. Slight under lean.' : 'Rain delay / postponement risk. Wet conditions suppress offense.', { m: 'totals', s: 'under', w: 0.6 * damp });
    if (sp === 'nfl' && wx.temp <= 25) add('cold', '🥶', 'Cold', `${wx.temp}°F`, 'Frigid temps shrink the ball and stiffen hands — scoring dips, especially for dome teams visiting.', { m: 'totals', s: 'under', w: 0.5 * damp });
    if (sp === 'mlb' && wx.temp >= 82) add('heat', '🌡', 'Heat', `${wx.temp}°F`, 'Warm, less dense air: the ball carries ~3–4 ft farther per 10°F. Lean over.', { m: 'totals', s: 'over', w: 0.5 * damp });
    if (sp === 'mlb' && wx.temp <= 50) add('cold', '🥶', 'Cold', `${wx.temp}°F`, 'Dense, cold air kills fly balls. Lean under.', { m: 'totals', s: 'under', w: 0.6 * damp });
  }

  // Market signals (demo or when data provider supplies them)
  if (g.splits) {
    const { homeTix, homeMoney } = g.splits;
    const pub = homeTix >= 50 ? 'home' : 'away';
    const pubPct = Math.max(homeTix, 100 - homeTix);
    const sharpGap = Math.abs(homeMoney - homeTix);
    const moneySide = homeMoney > homeTix ? 'home' : 'away';
    add('splits', '📊', 'Bets vs money', `${homeTix}% / ${homeMoney}% ${H.abbr}`,
      sharpGap >= 15 ? `Big gap between ticket count and dollars — fewer, larger bets (typically sharper) are on ${(moneySide === 'home' ? H : A).abbr}.` : `Tickets and handle roughly agree; no strong sharp signal.`,
      sharpGap >= 15 ? { m: 'side', s: moneySide, w: 0.7 } : null);
    if (g.openLine?.spread != null && g.current?.spread != null) {
      const move = g.current.spread - g.openLine.spread; // home spread movement (negative = toward home)
      const towards = move < 0 ? 'home' : move > 0 ? 'away' : null;
      if (towards && pubPct >= 62 && towards !== pub)
        add('rlm', '↩', 'Reverse line move', `${fmtMove(g.openLine.spread)} → ${fmtMove(g.current.spread)}`, `${pubPct}% of bets are on ${(pub === 'home' ? H : A).abbr}, yet the line moved the other way. Books only do that when respected money disagrees with the public.`, { m: 'side', s: towards, w: 1.0 });
      else if (towards) add('move', '📈', 'Line movement', `${fmtMove(g.openLine.spread)} → ${fmtMove(g.current.spread)}`, `Line moved toward ${(towards === 'home' ? H : A).abbr} since open.`, { m: 'side', s: towards, w: 0.3 });
    }
  }
  for (const inj of g.injuries || []) {
    const lean = inj.w >= 0.15 ? { m: 'side', s: inj.team === 'home' ? 'away' : 'home', w: inj.w } : null;
    if (inj.real) add('inj', '🩹', `Injuries · ${inj.team === 'home' ? H.abbr : A.abbr}`, `${inj.top[0].player} (${inj.top[0].status})${inj.count > 1 ? ` +${inj.count - 1}` : ''}`,
      `Live ESPN injury report — ${inj.top.map((i) => `${i.player}${i.pos ? ' ' + i.pos : ''} (${i.status})`).join(', ')}${inj.count > inj.top.length ? `, and ${inj.count - inj.top.length} more` : ''}. ${inj.top[0].note || ''} Long-term absences are discounted because the line already reflects them.`, lean);
    else add('inj', '🩹', `Injury · ${inj.team === 'home' ? H.abbr : A.abbr}`, `${inj.player} (${inj.status})`, inj.note, lean);
  }
  if (g.goalie) add('goalie', '🥅', 'Goalie', g.goalie.text, g.goalie.note, g.goalie.lean);
  if (g.pace) add('pace', '⚡', 'Pace', g.pace.text, g.pace.note, g.pace.lean);
  if (g.pitchers) add('sp', '⚾', 'Starting pitchers', g.pitchers.text, g.pitchers.note, g.pitchers.lean);
  if (g.divisional) add('div', '🤝', 'Divisional game', 'Familiar foes', 'Division rivals play tighter games — underdogs cover at a slightly higher rate.', null);
  return f;
}
const fmtMove = (x) => (x > 0 ? '+' + x : '' + x);

/** Sum of factor leans in the direction of this opportunity. */
export function factorScore(opp, factors) {
  let s = 0; const hits = [];
  for (const f of factors) {
    if (!f.lean) continue;
    const mkt = opp.market === 'totals' ? 'totals' : 'side';
    if (f.lean.m !== mkt) continue;
    const sign = f.lean.s === opp.side ? 1 : -1;
    s += sign * f.lean.w;
    hits.push({ ...f, sign });
  }
  return { score: Math.round(s * 10) / 10, hits };
}

/** Points the weather model would move a total by (used by the demo pricer and shown in UI). */
export function weatherTotalAdj(sport, wx, roof) {
  if (!wx || roof === 'd') return 0;
  const damp = roof === 'r' ? 0.35 : 1;
  let adj = 0;
  if (sport === 'nfl') {
    if (wx.wind > 10) adj -= (wx.wind - 10) * 0.4;
    if (wx.pop >= 55 && wx.precip >= 0.02) adj -= 1.2;
    if (wx.temp <= 25) adj -= 1;
  } else if (sport === 'mlb') {
    if (wx.temp >= 82) adj += 0.35;
    if (wx.temp <= 50) adj -= 0.4;
  }
  return adj * damp;
}
