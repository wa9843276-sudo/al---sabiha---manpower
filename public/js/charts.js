/* Tiny chart helpers: no external libraries, all text escaped. Requires app.js (esc). */
const PALETTE = ["#16315a", "#0e8aa6", "#b88a2a", "#12805a", "#7a5bd0", "#c2303a", "#5b6b80", "#d9702b"];

function barChart(el, items, { gold = false, max = null, empty = "No data for the selected filters." } = {}) {
  if (!items || !items.length) { el.innerHTML = `<div class="empty">${esc(empty)}</div>`; return; }
  const top = max || Math.max(...items.map(i => i.count), 1);
  el.innerHTML = `<div class="bars" role="list">` + items.map(i =>
    `<div class="bar-row" role="listitem"><span class="lbl" title="${esc(i.name)}">${esc(i.name)}</span>
     <div class="bar-track"><div class="bar-fill ${gold ? "gold" : ""}" style="width:${Math.max(1, (i.count / top) * 100)}%"></div></div>
     <b>${esc(i.count)}</b></div>`).join("") + `</div>`;
}

function donutChart(el, items, { centerLabel = "Total" } = {}) {
  const total = (items || []).reduce((s, i) => s + i.count, 0);
  if (!total) { el.innerHTML = `<div class="empty">No data for the selected filters.</div>`; return; }
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = items.filter(i => i.count > 0).map((i, k) => {
    const len = (i.count / total) * C;
    const s = `<circle r="${R}" cx="75" cy="75" fill="none" stroke="${PALETTE[k % PALETTE.length]}" stroke-width="22"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"/>`;
    off += len; return s;
  }).join("");
  el.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 150 150" role="img" aria-label="${esc(centerLabel)} ${total}">${arcs}
    <text x="75" y="72" text-anchor="middle" font-size="22" font-weight="700" fill="#101a2c">${total}</text>
    <text x="75" y="90" text-anchor="middle" font-size="10" fill="#566579">${esc(centerLabel)}</text></svg>
    <div class="legend">${items.filter(i => i.count > 0).map((i, k) =>
      `<div><i style="background:${PALETTE[k % PALETTE.length]}"></i>${esc(i.name)} — <b>${esc(i.count)}</b> (${Math.round((i.count / total) * 100)}%)</div>`).join("")}</div></div>`;
}

function lineChart(el, points, { key = "workers", label = d => d, color = "#0e8aa6", key2 = null, color2 = "#b88a2a" } = {}) {
  if (!points || !points.length) { el.innerHTML = `<div class="empty">No data for the selected filters.</div>`; return; }
  const W = 640, H = 220, P = { l: 34, r: 10, t: 12, b: 28 };
  const max = Math.max(1, ...points.map(p => Math.max(p[key] || 0, key2 ? p[key2] || 0 : 0)));
  const x = i => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (points.length - 1));
  const y = v => P.t + (1 - v / max) * (H - P.t - P.b);
  const path = k => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k] || 0).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1].map(t => Math.round(max * t));
  const step = Math.max(1, Math.ceil(points.length / 8));
  el.innerHTML = `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e1e7ef"/><text x="${P.l - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join("")}
    ${key2 ? `<path d="${path(key2)}" fill="none" stroke="${color2}" stroke-width="2" stroke-dasharray="5 4"/>` : ""}
    <path d="${path(key)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[key] || 0)}" r="3" fill="${color}"><title>${esc(label(p))}: ${p[key] || 0}</title></circle>`).join("")}
    ${points.map((p, i) => i % step === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(label(p))}</text>` : "").join("")}
  </svg>`;
}
