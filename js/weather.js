// Live forecasts from Open-Meteo (free, no key, CORS-enabled). Cached per venue+hour for the session.
const CACHE_KEY = 'degen.wx.v1';
const cache = (() => { try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } })();
const save = () => { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {} };

export async function forecast(lat, lon, isoTime) {
  const t = new Date(isoTime);
  const hoursOut = (t - Date.now()) / 36e5;
  if (hoursOut > 15 * 24 || hoursOut < -6) return null; // outside forecast window
  const hourKey = t.toISOString().slice(0, 13);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${hourKey}`;
  if (cache[key]) return cache[key];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=UTC&forecast_days=16`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const idx = j.hourly.time.findIndex((x) => x.startsWith(hourKey));
    if (idx < 0) return null;
    const h = j.hourly;
    const wx = {
      temp: Math.round(h.temperature_2m[idx]), pop: h.precipitation_probability[idx] ?? 0,
      precip: h.precipitation[idx] ?? 0, wind: Math.round(h.wind_speed_10m[idx]),
      gust: Math.round(h.wind_gusts_10m[idx]), dir: h.wind_direction_10m[idx], code: h.weather_code[idx], live: true,
    };
    cache[key] = wx; save();
    return wx;
  } catch { return null; } finally { clearTimeout(timer); }
}

// WMO weather codes → label + glyph
export function wxLabel(code, pop = 0) {
  if (code == null) return { t: 'Fair', g: '☁' };
  if ([95, 96, 99].includes(code)) return { t: 'Thunderstorms', g: '⛈' };
  if (code >= 71 && code <= 86) return { t: 'Snow', g: '❄' };
  if (code >= 51 && code <= 67 || code >= 80) return { t: pop > 70 ? 'Rain' : 'Showers', g: '🌧' };
  if (code === 45 || code === 48) return { t: 'Fog', g: '🌫' };
  if (code >= 2) return { t: 'Overcast', g: '☁' };
  return { t: 'Clear', g: '☀' };
}
export const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) / 45)) % 8];
