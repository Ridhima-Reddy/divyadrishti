// Contrast sensitivity with a Landolt C, as in the ZEISS Online Vision
// Screening: one large ring (about 3 degrees, far above the acuity limit) at
// falling contrast; the patient says where the gap is (up, down, left, right).
//
// Levels are 0.15 log units apart, like Pelli-Robson triplets. A level passes
// with 2 of 3 correct. The test jumps 0.30 log units while the patient is
// right, then steps back and refines in 0.15 steps, so a normal eye finishes
// in about 12 rings. Result = highest level passed, in log contrast
// sensitivity (log CS). Healthy adults score about 1.65-1.95 on Pelli-Robson.
//
// Contrast is Weber contrast of a grey ring on a white screen. The grey level
// is computed for an sRGB display (gamma about 2.2) and the ACHIEVED contrast
// after 8-bit rounding is what gets recorded. Screen brightness and ambient
// light are not calibrated: this is a screening test.

export const DIRECTIONS = ['up', 'right', 'down', 'left'];
export const STEP = 0.15;
export const MAX_LOGCS = 2.05; // one grey level below white on an 8-bit screen
const r2 = (x) => Math.round(x * 100) / 100;

const toLinear = (v) => (v / 255) ** 2.2;

// Grey level (0-255) on a white background for a target Weber contrast.
export function greyFor(contrast) {
  const c = Math.min(1, Math.max(0, contrast));
  const v = Math.round(255 * (1 - c) ** (1 / 2.2));
  return Math.min(254, Math.max(0, v));
}
export const achievedContrast = (grey) => 1 - toLinear(grey);
export const logCsOf = (contrast) => r2(-Math.log10(contrast));

export function levelFor(logCS) {
  const contrast = 10 ** -logCS;
  const grey = greyFor(contrast);
  const actual = achievedContrast(grey);
  return { logCS: r2(logCS), grey, contrast: actual, actualLogCS: logCsOf(actual) };
}

export function createContrastTest({ start = 0.6, rng = Math.random } = {}) {
  return { logCS: start, trials: [], passed: [], failed: [], done: false, result: null, rng, current: null, lastDir: null, phase: 'jump' };
}

export function nextRing(st) {
  let dir;
  do { dir = DIRECTIONS[Math.floor(st.rng() * 4)]; } while (dir === st.lastDir);
  st.lastDir = dir;
  st.current = { ...levelFor(st.logCS), dir };
  return st.current;
}

export function respondRing(st, answered) {
  if (st.done || !st.current) return st;
  const ok = answered === st.current.dir;
  st.trials.push({ logCS: st.logCS, shown: st.current.dir, answered, ok });
  st.current = null;
  const here = st.trials.filter((x) => x.logCS === st.logCS);
  const right = here.filter((x) => x.ok).length;
  const wrong = here.length - right;
  if (right < 2 && wrong < 2) return st; // need another ring at this level
  const pass = right >= 2;
  (pass ? st.passed : st.failed).push(st.logCS);
  const best = st.passed.length ? Math.max(...st.passed) : null;
  if (pass) {
    if (st.logCS >= MAX_LOGCS - 1e-9) return finish(st);
    const step = st.phase === 'jump' ? 2 * STEP : STEP;
    const nxt = r2(Math.min(MAX_LOGCS, st.logCS + step));
    if (st.failed.some((f) => f <= nxt + 1e-9)) {
      // the next jump lands on a level already failed: refine in single steps
      const fine = r2(st.logCS + STEP);
      if (st.failed.includes(fine) || st.passed.includes(fine)) return finish(st);
      st.phase = 'refine'; st.logCS = fine; return st;
    }
    st.logCS = nxt;
    return st;
  }
  // failed this level
  if (best === null) {
    if (st.logCS <= 0) return finish(st);
    st.logCS = r2(Math.max(0, st.logCS - 2 * STEP));
    return st;
  }
  const fine = r2(best + STEP);
  if (fine < st.logCS && !st.failed.includes(fine) && !st.passed.includes(fine)) { st.phase = 'refine'; st.logCS = fine; return st; }
  return finish(st);
}

function finish(st) {
  st.done = true;
  const best = st.passed.length ? Math.max(...st.passed) : null;
  st.result = best === null ? { logCS: 0, actualLogCS: 0, note: 'could not see the ring at full contrast' } : { logCS: best, actualLogCS: levelFor(best).actualLogCS };
  return st;
}

// SVG Landolt C: outer diameter 5 units, stroke 1 unit, gap 1 unit, gap
// direction given. `grey` is the ring colour (white background).
export function landoltSvg(dir, sizePx, grey = 0) {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir] || 0;
  const g = `rgb(${grey},${grey},${grey})`;
  // ring with a gap at angle 0 (pointing right): arc from +12 deg to -12 deg the long way
  const r = 2; // centreline radius (outer 2.5, inner 1.5)
  const a = Math.asin(0.5 / r); // half-gap angle for a 1-unit gap
  const x1 = 2.5 + r * Math.cos(a); const y1 = 2.5 + r * Math.sin(a);
  const x2 = 2.5 + r * Math.cos(-a); const y2 = 2.5 + r * Math.sin(-a);
  return `<svg class="optotype" width="${sizePx}" height="${sizePx}" viewBox="0 0 5 5" style="transform:rotate(${rot}deg)" aria-label="ring">`
    + `<path d="M${x1.toFixed(4)} ${y1.toFixed(4)} A${r} ${r} 0 1 1 ${x2.toFixed(4)} ${y2.toFixed(4)}" fill="none" stroke="${g}" stroke-width="1"/></svg>`;
}
