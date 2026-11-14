// Small SVG charts for the dashboards (home, portal overview, camp planning).
// Colours come from CSS variables (--c1 … --c7, --lane-*), so they follow the
// theme; every chart has a text alternative and a legend.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = (v) => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };

// Stacked or grouped columns. series: [{ name, color, values: [] }] aligned with labels.
export function barChart({ labels, series, height = 170, stacked = true, title = '' }) {
  const W = 320; const H = height; const padL = 26; const padB = 22; const padT = 8;
  const totals = labels.map((_, i) => (stacked ? series.reduce((s, x) => s + (x.values[i] || 0), 0) : Math.max(...series.map((x) => x.values[i] || 0))));
  const max = nice(Math.max(1, ...totals));
  const cw = (W - padL) / labels.length;
  const bw = Math.min(26, cw * (stacked ? 0.55 : 0.75 / series.length));
  const y = (v) => H - padB - ((H - padB - padT) * v) / max;
  const grid = [0, 0.5, 1].map((f) => `<line x1="${padL}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="cg"/><text x="${padL - 6}" y="${y(max * f) + 3}" class="ct" text-anchor="end">${Math.round(max * f)}</text>`).join('');
  let bars = '';
  labels.forEach((lab, i) => {
    const cx = padL + cw * i + cw / 2;
    if (stacked) {
      let acc = 0;
      series.forEach((s, si) => {
        const v = s.values[i] || 0; if (!v) return;
        const top = y(acc + v); const h = y(acc) - top; acc += v;
        const last = series.slice(si + 1).every((x) => !(x.values[i] || 0));
        bars += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, h)}" rx="${last ? 5 : 0}" style="fill:${s.color}"><title>${esc(lab)}: ${esc(s.name)} ${v}</title></rect>`;
      });
      if (!totals[i]) bars += `<rect x="${cx - bw / 2}" y="${y(0) - 3}" width="${bw}" height="3" rx="1.5" class="cz"/>`;
    } else {
      series.forEach((s, si) => {
        const v = s.values[i] || 0; const x = cx - (bw * series.length) / 2 + bw * si;
        bars += `<rect x="${x + 1}" y="${y(v)}" width="${bw - 2}" height="${Math.max(1, y(0) - y(v))}" rx="4" style="fill:${s.color}"><title>${esc(lab)}: ${esc(s.name)} ${v}</title></rect>`;
      });
    }
    bars += `<text x="${cx}" y="${H - 6}" class="ct" text-anchor="middle">${esc(lab)}</text>`;
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${bars}</svg>${legend}</figure>`;
}

// Donut with a figure in the middle. segments: [{ label, value, color }]
export function donut({ segments, size = 150, thickness = 18, center = '', sub = '', title = '' }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2; const c = size / 2; const C = 2 * Math.PI * r;
  let off = 0;
  const arcs = total ? segments.filter((s) => s.value).map((s) => {
    const len = (s.value / total) * C;
    const gap = segments.filter((x) => x.value).length > 1 ? Math.min(3, len / 3) : 0;
    const a = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${thickness}" stroke-linecap="butt" style="stroke:${s.color}" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"><title>${esc(s.label)}: ${s.value}</title></circle>`;
    off += len; return a;
  }).join('') : '';
  return `<figure class="chart donut"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(title)}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${thickness}" class="ctrack"/>${arcs}
      <text x="${c}" y="${c + 2}" text-anchor="middle" class="cbig">${esc(center)}</text><text x="${c}" y="${c + 20}" text-anchor="middle" class="ct">${esc(sub)}</text></svg>
    <div class="legend col">${segments.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}<b>${s.value}</b></span>`).join('')}</div></figure>`;
}

// Area trend line, e.g. cases per day.
export function trend({ labels, values, color = 'var(--c1)', height = 120, title = '' }) {
  const W = 320; const H = height; const pad = 18; const max = nice(Math.max(1, ...values));
  const x = (i) => pad + ((W - 2 * pad) * i) / Math.max(1, values.length - 1);
  const y = (v) => H - pad - ((H - 2 * pad) * v) / max;
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
      <polygon points="${x(0)},${H - pad} ${pts} ${x(values.length - 1)},${H - pad}" style="fill:${color};opacity:.14"/>
      <polyline points="${pts}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" style="stroke:${color}"/>
      ${values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === values.length - 1 ? 4 : 2.5}" style="fill:${color}"><title>${esc(labels[i])}: ${v}</title></circle>`).join('')}
      ${labels.map((l, i) => `<text x="${x(i)}" y="${H - 3}" text-anchor="middle" class="ct">${esc(l)}</text>`).join('')}</svg></figure>`;
}

// Coloured horizontal bars for ranked lists (referral reasons, lens mix, areas).
export function hbars(items, { max, palette = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)'] } = {}) {
  const m = max || Math.max(1, ...items.map((i) => i.value));
  return `<ul class="hbars">${items.map((it, i) => `<li><span class="hl">${esc(it.label)}${it.note ? ` <small>${esc(it.note)}</small>` : ''}</span>
      <span class="ht"><i style="width:${Math.max(3, (it.value / m) * 100)}%;background:${it.color || palette[i % palette.length]}"></i></span><b>${it.value}</b></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- India tile map
// One rounded tile per state, laid out roughly where the state is, shaded by
// count. No map service or geodata: PIN codes map to a state by their first
// digits (India Post's postal regions), which is approximate near borders.
const TILES = {
  JK: [3, 0, 'Jammu, Kashmir, Ladakh'], PB: [2, 1, 'Punjab, Chandigarh'], HP: [3, 1, 'Himachal Pradesh'], UK: [4, 1, 'Uttarakhand'],
  RJ: [1, 2, 'Rajasthan'], HR: [2, 2, 'Haryana'], DL: [3, 2, 'Delhi'], UP: [4, 2, 'Uttar Pradesh'], BR: [5, 2, 'Bihar'], SK: [6, 2, 'Sikkim'], AR: [7, 2, 'Arunachal Pradesh'],
  GJ: [0, 3, 'Gujarat'], MP: [2, 3, 'Madhya Pradesh'], JH: [4, 3, 'Jharkhand'], WB: [5, 3, 'West Bengal'], AS: [6, 3, 'Assam'], NL: [7, 3, 'Nagaland'],
  MH: [1, 4, 'Maharashtra'], TG: [2, 4, 'Telangana'], CT: [3, 4, 'Chhattisgarh'], OD: [4, 4, 'Odisha'], ML: [6, 4, 'Meghalaya'], MN: [7, 4, 'Manipur'],
  GA: [1, 5, 'Goa'], KA: [2, 5, 'Karnataka'], AP: [3, 5, 'Andhra Pradesh'], TR: [6, 5, 'Tripura'], MZ: [7, 5, 'Mizoram'],
  KL: [2, 6, 'Kerala'], TN: [3, 6, 'Tamil Nadu, Puducherry'],
};
export function pinToState(pin) {
  const p = String(pin || '').replace(/\D/g, '');
  if (p.length < 3) return null;
  const n2 = Number(p.slice(0, 2)); const n3 = Number(p.slice(0, 3));
  if (n2 === 11) return 'DL';
  if (n2 === 12 || n2 === 13) return 'HR';
  if (n2 >= 14 && n2 <= 16) return 'PB';
  if (n2 === 17) return 'HP';
  if (n2 === 18 || n2 === 19) return 'JK';
  if ([246, 247, 248, 249, 262, 263].includes(n3)) return 'UK';
  if (n2 >= 20 && n2 <= 28) return 'UP';
  if (n2 >= 30 && n2 <= 34) return 'RJ';
  if (n2 >= 36 && n2 <= 39) return 'GJ';
  if (n3 === 403) return 'GA';
  if (n2 >= 40 && n2 <= 44) return 'MH';
  if (n2 >= 45 && n2 <= 48) return 'MP';
  if (n2 === 49) return 'CT';
  if (n2 === 50) return 'TG';
  if (n2 >= 51 && n2 <= 53) return 'AP';
  if (n2 >= 56 && n2 <= 59) return 'KA';
  if (n2 >= 60 && n2 <= 64) return 'TN';
  if (n2 >= 67 && n2 <= 69) return 'KL';
  if (n3 === 737) return 'SK';
  if (n2 >= 70 && n2 <= 74) return 'WB';
  if (n2 >= 75 && n2 <= 77) return 'OD';
  if (n2 === 78) return 'AS';
  if (n3 >= 790 && n3 <= 792) return 'AR';
  if (n3 === 793 || n3 === 794) return 'ML';
  if (n3 === 795) return 'MN';
  if (n3 === 796) return 'MZ';
  if (n3 === 797 || n3 === 798) return 'NL';
  if (n3 === 799) return 'TR';
  if ((n3 >= 814 && n3 <= 816) || (n3 >= 822 && n3 <= 835)) return 'JH';
  if (n2 >= 80 && n2 <= 85) return 'BR';
  return null;
}
export function indiaMap(byState = {}, { unit = 'patients' } = {}) {
  const max = Math.max(1, ...Object.values(byState));
  const tiles = Object.entries(TILES).map(([code, [x, y, name]]) => {
    const n = byState[code] || 0;
    const pct = n ? Math.round(18 + 72 * (n / max)) : 0;
    return `<div class="st ${n ? 'on' : ''} ${pct > 55 ? 'dark' : ''}" style="grid-column:${x + 1};grid-row:${y + 1};${n ? `background:color-mix(in srgb, var(--accent) ${pct}%, var(--surface-2))` : ''}" title="${esc(name)}: ${n} ${esc(unit)}"><span>${code}</span>${n ? `<b>${n}</b>` : ''}</div>`;
  }).join('');
  const top = Object.entries(byState).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `<figure class="chart mapfig"><div class="tmap" role="img" aria-label="${esc(unit)} by state: ${esc(top.map(([c, n]) => `${TILES[c]?.[2] || c} ${n}`).join(', ') || 'none yet')}">${tiles}</div>
    <div class="legend"><span><i style="background:color-mix(in srgb, var(--accent) 20%, var(--surface-2))"></i>fewer</span><span><i style="background:var(--accent)"></i>more ${esc(unit)}</span></div></figure>`;
}

// Last n days as short weekday labels, oldest first, with ISO date keys.
export function lastDays(n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    out.push({ key: d.toDateString(), label: d.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 3) });
  }
  return out;
}
