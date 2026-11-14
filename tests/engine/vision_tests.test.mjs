// Contrast, colour plates and chart helpers (the ZEISS-style screening tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greyFor, achievedContrast, levelFor, createContrastTest, nextRing, respondRing, landoltSvg, MAX_LOGCS } from '../../web/js/measure/contrast.js';
import { generatePlate, inDigit, scorePlates, SERIES, plateSvg, mulberry32 } from '../../web/js/measure/plates.js';
import { axisFromClock, nSizeMm, duochromeMeaning, dialSvg } from '../../web/js/measure/charts.js';

// simulate an observer whose true threshold is `thr` log CS
function runContrast(thr, seed = 1) {
  const st = createContrastTest({ rng: mulberry32(seed) });
  for (let i = 0; i < 60 && !st.done; i++) {
    const r = nextRing(st);
    respondRing(st, r.logCS <= thr + 1e-9 ? r.dir : (r.dir === 'up' ? 'down' : 'up'));
  }
  return st;
}

test('contrast grey levels: full contrast is black; the faintest level is one grey step below white', () => {
  assert.equal(greyFor(1), 0);
  assert.equal(greyFor(0.0001), 254);
  assert.ok(Math.abs(achievedContrast(greyFor(0.25)) - 0.25) < 0.01);
  const faint = levelFor(MAX_LOGCS);
  assert.ok(faint.grey === 254 && faint.actualLogCS > 2.0);
});

test('contrast staircase finds the threshold in 0.15 log steps, in under 20 rings', () => {
  for (const thr of [0.3, 0.75, 1.2, 1.65, 1.95]) {
    const st = runContrast(thr);
    assert.ok(st.done, `done at ${thr}`);
    assert.ok(Math.abs(st.result.logCS - thr) <= 0.15 + 1e-9, `threshold ${thr} -> ${st.result.logCS}`);
    assert.ok(st.trials.length <= 20, `${st.trials.length} rings at ${thr}`);
  }
});

test('contrast: an eye that cannot see even full contrast scores 0', () => {
  const st = runContrast(-1);
  assert.equal(st.result.logCS, 0);
});

test('Landolt ring SVG has a gap and uses the requested grey', () => {
  const svg = landoltSvg('up', 120, 200);
  assert.match(svg, /rgb\(200,200,200\)/);
  assert.match(svg, /rotate\(270deg\)/);
});

test('colour plates are deterministic, non-overlapping and carry the digit', () => {
  const a = generatePlate({ seed: 23, digit: '8' });
  const b = generatePlate({ seed: 23, digit: '8' });
  assert.deepEqual(a.dots.slice(0, 20), b.dots.slice(0, 20));
  assert.ok(a.dots.length > 300, `${a.dots.length} dots`);
  const fig = a.dots.filter((d) => d.fig);
  assert.ok(fig.length > 40 && fig.length < a.dots.length / 2);
  for (let i = 0; i < 200; i++) {
    for (let j = i + 1; j < 200; j++) {
      const p = a.dots[i]; const q = a.dots[j];
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r, 'dots overlap');
    }
  }
  assert.ok(inDigit(0, -0.5, '8') && !inDigit(0, -0.25, '8') && inDigit(0, 0, '8'));
  assert.match(plateSvg(a, 300), /^<svg/);
});

test('plate scoring: demonstration misread is inconclusive; 2+ misses flag a possible red-green difference', () => {
  const right = SERIES.map((p) => p.digit);
  assert.equal(scorePlates(right).result, 'normal');
  assert.equal(scorePlates(['', ...right.slice(1)]).result, 'inconclusive');
  const one = [...right]; one[2] = '';
  assert.equal(scorePlates(one).result, 'normal');
  const two = [...right]; two[2] = ''; two[4] = '21';
  const s = scorePlates(two);
  assert.equal(s.result, 'possible_rg');
  assert.equal(s.correct, 3);
});

test('astigmatism rule of 30 and chart sizes', () => {
  assert.equal(axisFromClock(3), 90);
  assert.equal(axisFromClock(9), 90);
  assert.equal(axisFromClock(12), 180);
  assert.equal(axisFromClock(6), 180);
  assert.equal(axisFromClock(1), 30);
  assert.equal(axisFromClock(11), 150);
  assert.ok(Math.abs(nSizeMm(8) - 2.82) < 0.01);
  assert.equal(duochromeMeaning('red'), 'needs more minus (or less plus)');
  assert.equal((dialSvg(200).match(/data-line=/g) || []).length, 6);
});
