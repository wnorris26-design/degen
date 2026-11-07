// Tiny SVG chart kit. Thin marks, recessive grid, hover on everything.
const registry = new Map();
let uid = 0;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function niceTicks(min, max, n = 4) {
  const span = max - min || 1;
  const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(6));
  return t;
}

/** Area/line chart (single series). points: [{x:Date|number, y, label?}] */
export function lineChart(points, { height = 220, fmtY = (v) => v, fmtX = (v) => v, color = 'var(--accent)', baseline = null, label = '' } = {}) {
  const id = 'c' + ++uid;
  registry.set(id, { points, fmtY, fmtX, color, baseline, height, label });
  return `<div class="chart" data-chart="line" data-id="${id}" style="height:${height}px" role="img" aria-label="${esc(label)}"></div>`;
}

function drawLine(el, cfg) {
  const { points, fmtY, fmtX, color, baseline, height } = cfg;
  const W = el.clientWidth || 600, H = height, P = { l: 52, r: 16, t: 14, b: 26 };
  if (!points.length) { el.innerHTML = `<div class="empty-mini">No settled bets yet</div>`; return; }
  const ys = points.map((p) => p.y).concat(baseline != null ? [baseline] : []);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const sx = (i) => P.l + (points.length === 1 ? 0.5 : i / (points.length - 1)) * (W - P.l - P.r);
  const sy = (v) => P.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const area = `${path}L${sx(points.length - 1)},${H - P.b}L${sx(0)},${H - P.b}Z`;
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const xt = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${P.l - 8}" y="${sy(t) + 4}" class="axis" text-anchor="end">${fmtY(t)}</text>`).join('')}
    ${baseline != null ? `<line x1="${P.l}" x2="${W - P.r}" y1="${sy(baseline)}" y2="${sy(baseline)}" class="baseline"/>` : ''}
    ${xt.map((i) => `<text x="${sx(i)}" y="${H - 6}" class="axis" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${fmtX(points[i].x)}</text>`).join('')}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${sx(points.length - 1)}" cy="${sy(points[points.length - 1].y)}" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
    <g class="xhair" style="display:none"><line y1="${P.t}" y2="${H - P.b}" class="xline"/><circle r="5" fill="${color}" stroke="var(--surface)" stroke-width="2"/></g>
    <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" class="hit"/>
  </svg>`;
  const svg = el.querySelector('svg'), xh = svg.querySelector('.xhair');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((x - P.l) / (W - P.l - P.r)) * (points.length - 1))));
    const p = points[i];
    xh.style.display = '';
    xh.querySelector('line').setAttribute('x1', sx(i)); xh.querySelector('line').setAttribute('x2', sx(i));
    xh.querySelector('circle').setAttribute('cx', sx(i)); xh.querySelector('circle').setAttribute('cy', sy(p.y));
    showTip(e, `<b>${fmtY(p.y)}</b><span>${fmtX(p.x)}</span>${p.label ? `<em>${esc(p.label)}</em>` : ''}`);
  };
  svg.querySelector('.hit').addEventListener('pointermove', move);
  svg.querySelector('.hit').addEventListener('pointerleave', () => { xh.style.display = 'none'; hideTip(); });
}

/** Horizontal bars. rows: [{label, value, color?, sub?, tip?}] values 0..1 by default */
export function hbars(rows, { fmt = (v) => (v * 100).toFixed(0) + '%', max = 1, ref = null, refLabel = '' } = {}) {
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar" data-tip="${esc(r.tip || `${r.label}: ${fmt(r.value)}`)}">
      <div class="hbar-l">${r.icon ? `<span class="dot" style="background:${r.color}"></span>` : ''}${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${Math.max(0, Math.min(1, r.value / max)) * 100}%;background:${r.color || 'var(--accent)'}"></div>
        ${ref != null ? `<div class="hbar-ref" style="left:${(ref / max) * 100}%" title="${esc(refLabel)}"></div>` : ''}
      </div>
      <div class="hbar-v">${r.value == null ? '—' : fmt(r.value)}</div>
    </div>`).join('')}</div>`;
}

/** Prop game-log bars vs the line. log: [{v, opp, home}] */
export function logBars(log, line, side = 'over', { n = 10 } = {}) {
  const L = log.slice(-n);
  if (!L.length) return `<div class="empty-mini">Game logs available in demo mode / with a stats feed</div>`;
  const max = Math.max(line * 1.6, ...L.map((g) => g.v)) || 1;
  return `<div class="logbars" style="--line:${(line / max) * 100}%">
    <div class="logline"><span>${line}</span></div>
    ${L.map((g) => { const hit = side === 'over' ? g.v > line : g.v < line; return `<div class="lb ${hit ? 'hit' : 'miss'}" data-tip="${g.home ? 'vs' : '@'} ${g.opp}: ${g.v} — ${hit ? 'HIT' : 'miss'}"><i style="height:${Math.max(3, (g.v / max) * 100)}%"></i><b>${g.v}</b><small>${g.home ? '' : '@'}${g.opp}</small></div>`; }).join('')}
  </div>`;
}

export function sparkline(vals, { w = 90, h = 26, color = 'var(--ink-2)' } = {}) {
  if (vals.length < 2) return '';
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (w - 4) + 2},${h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 6)}`).join(' ');
  return `<svg width="${w}" height="${h}" class="spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Ring gauge for a single probability. */
export function ring(p, { size = 64, color = 'var(--accent)', label = '' } = {}) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" class="ring" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)} ${(p * 100).toFixed(0)}%">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})" class="ring-fg"/>
    <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle">${(p * 100).toFixed(0)}<tspan>%</tspan></text></svg>`;
}

// ---------- tooltip ----------
let tipEl;
export function showTip(e, html) {
  tipEl ||= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'tip' });
  tipEl.innerHTML = html; tipEl.style.display = 'block';
  const r = tipEl.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY - r.height - 10;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y < 8) y = e.clientY + 16;
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
document.addEventListener('pointerover', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(e, esc(t.dataset.tip)); });
document.addEventListener('pointermove', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(e, esc(t.dataset.tip)); });
document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]')) hideTip(); });

export function hydrate(root) {
  root.querySelectorAll('[data-chart="line"]').forEach((el) => { const cfg = registry.get(el.dataset.id); if (cfg) { drawLine(el, cfg); new ResizeObserver(() => drawLine(el, cfg)).observe(el); } });
}
