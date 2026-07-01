// The progress graph: every speed run as a dot, the running personal best as a
// step line. Hand-rolled SVG — a chart library would be the only dependency in
// the whole app, for one line and some dots.

const W = 820, H = 300, PAD = { l: 46, r: 14, t: 14, b: 30 };

export function renderChart(el, runs) {
  const speed = runs.filter((r) => r.game === 'speed' && r.cpm > 0)
    .sort((a, b) => a.t.localeCompare(b.t));
  if (speed.length < 2) {
    el.innerHTML = '<div class="chart-empty">พิมพ์สักสองสามด่านก่อน แล้วกราฟจะโผล่มาที่นี่ 🌱</div>';
    return;
  }
  const t0 = new Date(speed[0].t).getTime();
  const t1 = new Date(speed[speed.length - 1].t).getTime();
  const span = Math.max(t1 - t0, 864e5); // at least a day wide
  const maxC = Math.max(...speed.map((r) => r.cpm)) * 1.15;
  const x = (t) => PAD.l + ((new Date(t).getTime() - t0) / span) * (W - PAD.l - PAD.r);
  const y = (c) => H - PAD.b - (c / maxC) * (H - PAD.t - PAD.b);

  let grid = '';
  for (let i = 1; i <= 4; i++) {
    const c = (maxC / 5) * i;
    grid += `<line class="c-grid" x1="${PAD.l}" y1="${y(c)}" x2="${W - PAD.r}" y2="${y(c)}"/>
      <text class="c-lab" x="${PAD.l - 8}" y="${y(c) + 4}" text-anchor="end"
      font-size="11">${Math.round(c)}</text>`;
  }

  const dots = speed.map((r) =>
    `<circle class="c-dot" cx="${x(r.t)}" cy="${y(r.cpm)}" r="3"/>`).join('');

  // running PB (>=95% accuracy, same rule as everywhere else)
  let pb = 0;
  const pts = [];
  for (const r of speed) {
    if (r.acc >= 0.95 && r.cpm > pb) { pb = r.cpm; pts.push(r); }
  }
  let line = '';
  if (pts.length) {
    let d = `M ${x(pts[0].t)} ${y(pts[0].cpm)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` H ${x(pts[i].t)} V ${y(pts[i].cpm)}`;
    }
    d += ` H ${W - PAD.r}`;
    line = `<path class="c-pb" d="${d}" fill="none" stroke-width="2.5"
      stroke-linejoin="round"/>` +
      pts.map((r) => `<circle class="c-pbdot" cx="${x(r.t)}" cy="${y(r.cpm)}" r="4.5"/>`).join('');
  }

  const fmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' });
  const ticks = [0, 0.5, 1].map((f) => {
    const t = t0 + f * span;
    return `<text class="c-lab" x="${PAD.l + f * (W - PAD.l - PAD.r)}" y="${H - 8}" font-size="11"
      text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${fmt.format(t)}</text>`;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"
    aria-label="กราฟความเร็วพิมพ์">${grid}${ticks}${dots}${line}</svg>`;
}
