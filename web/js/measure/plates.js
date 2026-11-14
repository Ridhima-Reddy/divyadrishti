// Colour vision screening with number plates made of coloured dots, the
// format the ZEISS Online Vision Screening uses. Plates are generated, not
// copied from any published test: a circle packed with random dots; the dots
// inside a digit take "figure" colours and the rest "background" colours from
// either side of the red-green confusion lines, with the same spread of
// lightness in both, so only hue (not brightness) shows the number.
//
// Plate 0 is a demonstration plate everyone can read (figure differs in
// lightness too): it checks the patient understood the task.
// Scoring: demonstration misread -> inconclusive; 2 or more of the 5 test
// plates misread -> possible red-green colour vision difference.
// Phone screens are not colour-calibrated: this is a screen, not a diagnosis.

// Deterministic PRNG so a plate is reproducible from its seed (and testable).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seven-segment digits drawn with thick rounded strokes in a 0.6 x 1 box.
const SEG = {
  a: [[0.05, 0.05], [0.55, 0.05]], b: [[0.55, 0.05], [0.55, 0.5]], c: [[0.55, 0.5], [0.55, 0.95]],
  d: [[0.05, 0.95], [0.55, 0.95]], e: [[0.05, 0.5], [0.05, 0.95]], f: [[0.05, 0.05], [0.05, 0.5]], g: [[0.05, 0.5], [0.55, 0.5]],
};
const DIGIT_SEGS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

const distToSeg = (px, py, [[x1, y1], [x2, y2]]) => {
  const dx = x2 - x1; const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

// Is the point (u, v) in plate units (-1..1) inside the digit? Digits can be 1 or 2 characters.
export function inDigit(u, v, text, stroke = 0.075) {
  const chars = String(text).split('');
  const h = 1.1; // digit height in plate units
  const w = 0.6 * h; const gap = 0.18;
  const total = chars.length * w + (chars.length - 1) * gap;
  const x0 = -total / 2; const y0 = -h / 2;
  return chars.some((ch, i) => {
    const segs = DIGIT_SEGS[ch];
    if (!segs) return false;
    const lx = (u - (x0 + i * (w + gap))) / h;
    const ly = (v - y0) / h;
    return [...segs].some((s) => distToSeg(lx, ly, SEG[s]) <= stroke);
  });
}

// Figure and background colours. Red-green plates: orange-reds vs olive-greens
// of matched lightness. Demonstration plate: dark figure on light background.
const PALETTES = {
  rg: {
    figure: ['#d2783a', '#dc8a46', '#c96f32', '#e09450', '#d08040', '#c47a3c'],
    background: ['#8a9a4a', '#97a656', '#7f9044', '#a1a95c', '#8c9e50', '#94a04e'],
  },
  demo: {
    figure: ['#5a4a8a', '#4d3f7a', '#62538f', '#574887'],
    background: ['#e3c27a', '#ead08c', '#dcb86c', '#e8c884'],
  },
};

// Pack non-overlapping dots into the unit circle (dart throwing on a grid).
export function generatePlate({ seed = 1, digit = '7', kind = 'rg', tries = 9000 } = {}) {
  const rng = mulberry32(seed);
  const pal = PALETTES[kind] || PALETTES.rg;
  const dots = [];
  const cell = 0.06; const grid = new Map();
  const key = (gx, gy) => `${gx},${gy}`;
  for (let i = 0; i < tries; i++) {
    const r = 0.012 + rng() * 0.03;
    const ang = rng() * Math.PI * 2; const rad = Math.sqrt(rng()) * (0.98 - r);
    const x = rad * Math.cos(ang); const y = rad * Math.sin(ang);
    const gx = Math.floor(x / cell); const gy = Math.floor(y / cell);
    let ok = true;
    for (let dx = -1; dx <= 1 && ok; dx++) {
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (const d of grid.get(key(gx + dx, gy + dy)) || []) {
          if (Math.hypot(d.x - x, d.y - y) < d.r + r + 0.006) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;
    const fig = inDigit(x, y, digit);
    const list = fig ? pal.figure : pal.background;
    const dot = { x, y, r, fig, fill: list[Math.floor(rng() * list.length)] };
    dots.push(dot);
    const k = key(gx, gy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(dot);
  }
  return { seed, digit: String(digit), kind, dots };
}

export function plateSvg(plate, sizePx) {
  const c = (v) => ((v + 1) * 50).toFixed(2);
  const body = plate.dots.map((d) => `<circle cx="${c(d.x)}" cy="${c(d.y)}" r="${(d.r * 50).toFixed(2)}" fill="${d.fill}"/>`).join('');
  return `<svg class="plate" width="${sizePx}" height="${sizePx}" viewBox="0 0 100 100" role="img" aria-label="colour plate"><circle cx="50" cy="50" r="50" fill="#f3efe6"/>${body}</svg>`;
}

// The fixed series: a demonstration plate then five test plates.
export const SERIES = [
  { seed: 11, digit: '12', kind: 'demo' },
  { seed: 23, digit: '8', kind: 'rg' },
  { seed: 37, digit: '29', kind: 'rg' },
  { seed: 41, digit: '5', kind: 'rg' },
  { seed: 53, digit: '74', kind: 'rg' },
  { seed: 67, digit: '3', kind: 'rg' },
];

// answers: array aligned with SERIES; a string of digits or '' for "no number".
export function scorePlates(answers) {
  const norm = (x) => String(x ?? '').replace(/\D/g, '');
  const demoOk = norm(answers[0]) === SERIES[0].digit;
  const test = SERIES.slice(1);
  const correct = test.filter((p, i) => norm(answers[i + 1]) === p.digit).length;
  const errors = test.length - correct;
  const result = !demoOk ? 'inconclusive' : errors >= 2 ? 'possible_rg' : 'normal';
  return { result, correct, plates: test.length, demoOk };
}
