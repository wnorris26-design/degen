// Venue data for every team: [full name (as sportsbooks/The Odds API spell it), abbr, lat, lon, roof, utcOffset]
// roof: o = open air, r = retractable, d = dome/indoor. Indoor sports (NBA/NHL) are always 'd'.
const raw = {
  nfl: [
    ['Arizona Cardinals','ARI',33.528,-112.263,'r',-7],['Atlanta Falcons','ATL',33.755,-84.401,'r',-5],
    ['Baltimore Ravens','BAL',39.278,-76.623,'o',-5],['Buffalo Bills','BUF',42.774,-78.787,'o',-5],
    ['Carolina Panthers','CAR',35.226,-80.853,'o',-5],['Chicago Bears','CHI',41.862,-87.617,'o',-6],
    ['Cincinnati Bengals','CIN',39.095,-84.516,'o',-5],['Cleveland Browns','CLE',41.506,-81.700,'o',-5],
    ['Dallas Cowboys','DAL',32.748,-97.093,'r',-6],['Denver Broncos','DEN',39.744,-105.020,'o',-7],
    ['Detroit Lions','DET',42.340,-83.046,'d',-5],['Green Bay Packers','GB',44.501,-88.062,'o',-6],
    ['Houston Texans','HOU',29.685,-95.411,'r',-6],['Indianapolis Colts','IND',39.760,-86.164,'r',-5],
    ['Jacksonville Jaguars','JAX',30.324,-81.637,'o',-5],['Kansas City Chiefs','KC',39.049,-94.484,'o',-6],
    ['Las Vegas Raiders','LV',36.091,-115.184,'d',-8],['Los Angeles Chargers','LAC',33.953,-118.339,'d',-8],
    ['Los Angeles Rams','LAR',33.953,-118.339,'d',-8],['Miami Dolphins','MIA',25.958,-80.239,'o',-5],
    ['Minnesota Vikings','MIN',44.974,-93.258,'d',-6],['New England Patriots','NE',42.091,-71.264,'o',-5],
    ['New Orleans Saints','NO',29.951,-90.081,'d',-6],['New York Giants','NYG',40.814,-74.074,'o',-5],
    ['New York Jets','NYJ',40.814,-74.074,'o',-5],['Philadelphia Eagles','PHI',39.901,-75.168,'o',-5],
    ['Pittsburgh Steelers','PIT',40.447,-80.016,'o',-5],['San Francisco 49ers','SF',37.403,-121.970,'o',-8],
    ['Seattle Seahawks','SEA',47.595,-122.332,'o',-8],['Tampa Bay Buccaneers','TB',27.976,-82.503,'o',-5],
    ['Tennessee Titans','TEN',36.166,-86.771,'o',-6],['Washington Commanders','WAS',38.908,-76.864,'o',-5],
  ],
  nba: [
    ['Atlanta Hawks','ATL',33.757,-84.396],['Boston Celtics','BOS',42.366,-71.062],['Brooklyn Nets','BKN',40.683,-73.976],
    ['Charlotte Hornets','CHA',35.225,-80.839],['Chicago Bulls','CHI',41.881,-87.674],['Cleveland Cavaliers','CLE',41.497,-81.688],
    ['Dallas Mavericks','DAL',32.790,-96.810],['Denver Nuggets','DEN',39.749,-105.008],['Detroit Pistons','DET',42.341,-83.055],
    ['Golden State Warriors','GSW',37.768,-122.388],['Houston Rockets','HOU',29.751,-95.362],['Indiana Pacers','IND',39.764,-86.155],
    ['Los Angeles Clippers','LAC',33.945,-118.341],['Los Angeles Lakers','LAL',34.043,-118.267],['Memphis Grizzlies','MEM',35.138,-90.051],
    ['Miami Heat','MIA',25.781,-80.188],['Milwaukee Bucks','MIL',43.045,-87.917],['Minnesota Timberwolves','MIN',44.979,-93.276],
    ['New Orleans Pelicans','NOP',29.949,-90.082],['New York Knicks','NYK',40.751,-73.993],['Oklahoma City Thunder','OKC',35.463,-97.515],
    ['Orlando Magic','ORL',28.539,-81.384],['Philadelphia 76ers','PHI',39.901,-75.172],['Phoenix Suns','PHX',33.446,-112.071],
    ['Portland Trail Blazers','POR',45.532,-122.667],['Sacramento Kings','SAC',38.580,-121.500],['San Antonio Spurs','SAS',29.427,-98.437],
    ['Toronto Raptors','TOR',43.643,-79.379],['Utah Jazz','UTA',40.768,-111.901],['Washington Wizards','WAS',38.898,-77.021],
  ],
  mlb: [
    ['Arizona Diamondbacks','ARI',33.445,-112.067,'r'],['Atlanta Braves','ATL',33.891,-84.468,'o'],['Baltimore Orioles','BAL',39.284,-76.622,'o'],
    ['Boston Red Sox','BOS',42.346,-71.097,'o'],['Chicago Cubs','CHC',41.948,-87.656,'o'],['Chicago White Sox','CWS',41.830,-87.634,'o'],
    ['Cincinnati Reds','CIN',39.097,-84.507,'o'],['Cleveland Guardians','CLE',41.496,-81.685,'o'],['Colorado Rockies','COL',39.756,-104.994,'o'],
    ['Detroit Tigers','DET',42.339,-83.049,'o'],['Houston Astros','HOU',29.757,-95.355,'r'],['Kansas City Royals','KC',39.051,-94.480,'o'],
    ['Los Angeles Angels','LAA',33.800,-117.883,'o'],['Los Angeles Dodgers','LAD',34.074,-118.240,'o'],['Miami Marlins','MIA',25.778,-80.220,'r'],
    ['Milwaukee Brewers','MIL',43.028,-87.971,'r'],['Minnesota Twins','MIN',44.982,-93.278,'o'],['New York Mets','NYM',40.757,-73.846,'o'],
    ['New York Yankees','NYY',40.829,-73.926,'o'],['Athletics','ATH',38.580,-121.513,'o'],['Philadelphia Phillies','PHI',39.906,-75.166,'o'],
    ['Pittsburgh Pirates','PIT',40.447,-80.006,'o'],['San Diego Padres','SD',32.707,-117.157,'o'],['San Francisco Giants','SF',37.778,-122.389,'o'],
    ['Seattle Mariners','SEA',47.591,-122.332,'r'],['St. Louis Cardinals','STL',38.623,-90.193,'o'],['Tampa Bay Rays','TB',27.768,-82.653,'d'],
    ['Texas Rangers','TEX',32.747,-97.084,'r'],['Toronto Blue Jays','TOR',43.641,-79.389,'r'],['Washington Nationals','WSH',38.873,-77.007,'o'],
  ],
  nhl: [
    ['Anaheim Ducks','ANA',33.808,-117.877],['Boston Bruins','BOS',42.366,-71.062],['Buffalo Sabres','BUF',42.875,-78.876],
    ['Calgary Flames','CGY',51.037,-114.052],['Carolina Hurricanes','CAR',35.803,-78.722],['Chicago Blackhawks','CHI',41.881,-87.674],
    ['Colorado Avalanche','COL',39.749,-105.008],['Columbus Blue Jackets','CBJ',39.969,-83.006],['Dallas Stars','DAL',32.790,-96.810],
    ['Detroit Red Wings','DET',42.341,-83.055],['Edmonton Oilers','EDM',53.547,-113.498],['Florida Panthers','FLA',26.158,-80.326],
    ['Los Angeles Kings','LAK',34.043,-118.267],['Minnesota Wild','MIN',44.945,-93.101],['Montréal Canadiens','MTL',45.496,-73.569],
    ['Nashville Predators','NSH',36.159,-86.779],['New Jersey Devils','NJD',40.734,-74.171],['New York Islanders','NYI',40.712,-73.726],
    ['New York Rangers','NYR',40.751,-73.993],['Ottawa Senators','OTT',45.297,-75.927],['Philadelphia Flyers','PHI',39.901,-75.172],
    ['Pittsburgh Penguins','PIT',40.439,-79.989],['San Jose Sharks','SJS',37.333,-121.901],['Seattle Kraken','SEA',47.622,-122.354],
    ['St Louis Blues','STL',38.627,-90.203],['Tampa Bay Lightning','TBL',27.943,-82.452],['Toronto Maple Leafs','TOR',43.643,-79.379],
    ['Utah Mammoth','UTA',40.768,-111.901],['Vancouver Canucks','VAN',49.278,-123.109],['Vegas Golden Knights','VGK',36.103,-115.178],
    ['Washington Capitals','WSH',38.898,-77.021],['Winnipeg Jets','WPG',49.893,-97.144],
  ],
};

const ALTITUDE = { 'Denver Broncos': 5280, 'Denver Nuggets': 5280, 'Colorado Avalanche': 5280, 'Colorado Rockies': 5200, 'Utah Jazz': 4226, 'Utah Mammoth': 4226 };

// Rough UTC offset from longitude when not given (good enough for body-clock / travel factors).
const tzFromLon = (lon) => (lon < -114.5 ? -8 : lon < -102 ? -7 : lon < -87.5 ? -6 : -5);

// ESPN team ids. ESPN keeps a franchise's id through renames/relocations (Oakland → Sacramento A's are both 11),
// so career head-to-head matching uses these instead of names.
export const ESPN_TEAM_IDS = {
  nfl: {"Arizona Cardinals": "22", "Atlanta Falcons": "1", "Baltimore Ravens": "33", "Buffalo Bills": "2", "Carolina Panthers": "29", "Chicago Bears": "3", "Cincinnati Bengals": "4", "Cleveland Browns": "5", "Dallas Cowboys": "6", "Denver Broncos": "7", "Detroit Lions": "8", "Green Bay Packers": "9", "Houston Texans": "34", "Indianapolis Colts": "11", "Jacksonville Jaguars": "30", "Kansas City Chiefs": "12", "Las Vegas Raiders": "13", "Los Angeles Chargers": "24", "Los Angeles Rams": "14", "Miami Dolphins": "15", "Minnesota Vikings": "16", "New England Patriots": "17", "New Orleans Saints": "18", "New York Giants": "19", "New York Jets": "20", "Philadelphia Eagles": "21", "Pittsburgh Steelers": "23", "San Francisco 49ers": "25", "Seattle Seahawks": "26", "Tampa Bay Buccaneers": "27", "Tennessee Titans": "10", "Washington Commanders": "28"},
  nba: {"Atlanta Hawks": "1", "Boston Celtics": "2", "Brooklyn Nets": "17", "Charlotte Hornets": "30", "Chicago Bulls": "4", "Cleveland Cavaliers": "5", "Dallas Mavericks": "6", "Denver Nuggets": "7", "Detroit Pistons": "8", "Golden State Warriors": "9", "Houston Rockets": "10", "Indiana Pacers": "11", "Los Angeles Clippers": "12", "Los Angeles Lakers": "13", "Memphis Grizzlies": "29", "Miami Heat": "14", "Milwaukee Bucks": "15", "Minnesota Timberwolves": "16", "New Orleans Pelicans": "3", "New York Knicks": "18", "Oklahoma City Thunder": "25", "Orlando Magic": "19", "Philadelphia 76ers": "20", "Phoenix Suns": "21", "Portland Trail Blazers": "22", "Sacramento Kings": "23", "San Antonio Spurs": "24", "Toronto Raptors": "28", "Utah Jazz": "26", "Washington Wizards": "27"},
  nhl: {"Anaheim Ducks": "25", "Boston Bruins": "1", "Buffalo Sabres": "2", "Calgary Flames": "3", "Carolina Hurricanes": "7", "Chicago Blackhawks": "4", "Colorado Avalanche": "17", "Columbus Blue Jackets": "29", "Dallas Stars": "9", "Detroit Red Wings": "5", "Edmonton Oilers": "6", "Florida Panthers": "26", "Los Angeles Kings": "8", "Minnesota Wild": "30", "Montréal Canadiens": "10", "Nashville Predators": "27", "New Jersey Devils": "11", "New York Islanders": "12", "New York Rangers": "13", "Ottawa Senators": "14", "Philadelphia Flyers": "15", "Pittsburgh Penguins": "16", "San Jose Sharks": "18", "Seattle Kraken": "124292", "St Louis Blues": "19", "Tampa Bay Lightning": "20", "Toronto Maple Leafs": "21", "Utah Mammoth": "129764", "Vancouver Canucks": "22", "Vegas Golden Knights": "37", "Washington Capitals": "23", "Winnipeg Jets": "28"},
  mlb: {"Arizona Diamondbacks": "29", "Atlanta Braves": "15", "Baltimore Orioles": "1", "Boston Red Sox": "2", "Chicago Cubs": "16", "Chicago White Sox": "4", "Cincinnati Reds": "17", "Cleveland Guardians": "5", "Colorado Rockies": "27", "Detroit Tigers": "6", "Houston Astros": "18", "Kansas City Royals": "7", "Los Angeles Angels": "3", "Los Angeles Dodgers": "19", "Miami Marlins": "28", "Milwaukee Brewers": "8", "Minnesota Twins": "9", "New York Mets": "21", "New York Yankees": "10", "Athletics": "11", "Philadelphia Phillies": "22", "Pittsburgh Pirates": "23", "San Diego Padres": "25", "San Francisco Giants": "26", "Seattle Mariners": "12", "St. Louis Cardinals": "24", "Tampa Bay Rays": "30", "Texas Rangers": "13", "Toronto Blue Jays": "14", "Washington Nationals": "20"},
};

export const TEAMS = {};
export const TEAM_BY_NAME = {};
for (const [sport, list] of Object.entries(raw)) {
  TEAMS[sport] = list.map(([name, abbr, lat, lon, roof = 'd', tz]) => {
    const t = { sport, name, abbr, lat, lon, roof, tz: tz ?? tzFromLon(lon), alt: ALTITUDE[name] || 0, espn: ESPN_TEAM_IDS[sport]?.[name] || null,
      pnw: ['Seattle', 'Portland', 'Vancouver'].some((c) => name.startsWith(c)) };
    TEAM_BY_NAME[sport + ':' + name] = t;
    return t;
  });
}
// Alternate spellings sportsbook feeds sometimes use
const ALIASES = { 'LA Clippers': 'Los Angeles Clippers', 'Oakland Athletics': 'Athletics', 'St. Louis Blues': 'St Louis Blues', 'Montreal Canadiens': 'Montréal Canadiens', 'Utah Hockey Club': 'Utah Mammoth' };
export function findTeam(sport, name) {
  return TEAM_BY_NAME[sport + ':' + name] || TEAM_BY_NAME[sport + ':' + (ALIASES[name] || '')] ||
    TEAMS[sport]?.find((t) => name && (t.name.endsWith(name.split(' ').pop()) || name.includes(t.abbr))) || null;
}

export function milesBetween(a, b) {
  if (!a || !b) return 0;
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const SPORTS = {
  nfl: { key: 'americanfootball_nfl', label: 'NFL', icon: '🏈', outdoor: true, unit: 'pts' },
  nba: { key: 'basketball_nba', label: 'NBA', icon: '🏀', outdoor: false, unit: 'pts' },
  mlb: { key: 'baseball_mlb', label: 'MLB', icon: '⚾', outdoor: true, unit: 'runs' },
  nhl: { key: 'icehockey_nhl', label: 'NHL', icon: '🏒', outdoor: false, unit: 'goals' },
};

// Sportsbooks + DFS pick'em apps. "sharp" books are weighted more heavily when building the fair line.
export const BOOKS = {
  draftkings: { name: 'DraftKings', short: 'DK', kind: 'book', hue: '#53d337' },
  fanduel: { name: 'FanDuel', short: 'FD', kind: 'book', hue: '#1493ff' },
  betmgm: { name: 'BetMGM', short: 'MGM', kind: 'book', hue: '#c5a562' },
  williamhill_us: { name: 'Caesars', short: 'CZR', kind: 'book', hue: '#b89b5e' },
  espnbet: { name: 'theScore Bet', short: 'TSB', kind: 'book', hue: '#e2492f' },
  fanatics: { name: 'Fanatics', short: 'FAN', kind: 'book', hue: '#e0303c' },
  betrivers: { name: 'BetRivers', short: 'BR', kind: 'book', hue: '#2f6fd6' },
  pinnacle: { name: 'Pinnacle', short: 'PIN', kind: 'sharp', hue: '#f07a26' },
  prizepicks: { name: 'PrizePicks', short: 'PP', kind: 'dfs', hue: '#8b5cf6' },
  underdog: { name: 'Underdog', short: 'UD', kind: 'dfs', hue: '#f5c518' },
};
export const bookName = (k) => BOOKS[k]?.name || k;
