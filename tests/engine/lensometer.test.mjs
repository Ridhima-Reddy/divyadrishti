import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toGray, autocorrPeaks, latticeBasis, matchBasis, magnificationMatrix, powerFromMagnification, magnificationFromPower,
  powerMatrix, powerMatrixFromRx, magnificationMatrixFromPower, spheroCyl, roundRx, measureLens, roiAround, synthCheckerboard,
} from '../../web/js/measure/lensometer.js';

// Synthetic camera frame: reference pattern on the left, the lens on the
// right (a region larger than the lens ROI, like a real spectacle lens).
const W = 512;
const H = 320;
const LENS_REGION = { x: 272, y: 32, w: 224, h: 256 };
const refRoi = roiAround(128, 160, 128, W, H);
const lensRoi = roiAround(384, 160, 128, W, H);

function scene(rx, { angleDeg = 0, squarePx = 8, noise = 0, seed = 11, wearerView = true } = {}) {
  const Mm = magnificationMatrixFromPower(powerMatrixFromRx(rx, { wearerView }));
  const img = synthCheckerboard(W, H, { squarePx, angleDeg, regions: [{ roi: LENS_REGION, Mm }] });
  if (noise) addNoise(img, noise, seed);
  return img;
}

// Gaussian luminance noise, sigma = fraction of full scale, from a seeded PRNG.
function addNoise(img, sigma, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < img.data.length; k += 4) {
    const g = Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd()) * sigma * 255;
    const v = img.data[k] + g;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
  }
}

const axisDiff = (a, b) => ((((a - b + 90) % 180) + 180) % 180) - 90;

function assertRx(r, rx, { tolSph = 0.15, tolCyl = 0.25, tolAxis = 7 } = {}) {
  const label = `${rx.sph}/${rx.cyl}x${rx.axis}`;
  assert.equal(r.ok, true, `${label}: ${r.reason} ${r.message}`);
  assert.ok(Math.abs(r.sph - rx.sph) <= tolSph, `${label}: sph ${r.sph}`);
  assert.ok(Math.abs(r.cyl - rx.cyl) <= tolCyl, `${label}: cyl ${r.cyl}`);
  assert.ok(Math.abs(r.se - (rx.sph + rx.cyl / 2)) <= tolSph, `${label}: se ${r.se}`);
  if (rx.cyl) assert.ok(Math.abs(axisDiff(r.axis, rx.axis)) <= tolAxis, `${label}: axis ${r.axis}`);
  assert.ok(r.axis > 0 && r.axis <= 180, `${label}: axis ${r.axis} outside 1-180`);
}

test('scalar optics: P -> M -> P round trip, plus magnifies, minus minifies', () => {
  for (let P = -8; P <= 6; P += 0.25) {
    const M = magnificationFromPower(P);
    assert.ok(Math.abs(powerFromMagnification(M) - P) < 1e-9, `P ${P}`);
    assert.ok(P > 0 ? M > 1 : P < 0 ? M < 1 : M === 1);
  }
  // M = L / (L - a*b*P): at 40 cm with the lens halfway, -2 D shows the pattern at 0.4/0.48
  assert.ok(Math.abs(magnificationFromPower(-2) - 0.4 / 0.48) < 1e-12);
  assert.ok(Math.abs(powerFromMagnification(1.25, { L: 0.5, a: 0.1 }) - (0.5 * 0.25) / (0.1 * 0.4 * 1.25)) < 1e-12);
});

test('power matrix <-> sphero-cylinder: minus-cyl form, TABO axis 1-180', () => {
  for (const rx of [
    { sph: -1, cyl: -1.5, axis: 90 }, { sph: -2, cyl: -1, axis: 45 }, { sph: 1.5, cyl: -0.75, axis: 170 },
    { sph: 0.5, cyl: -2, axis: 180 }, { sph: -4, cyl: -0.5, axis: 5 },
  ]) {
    const back = spheroCyl(powerMatrixFromRx(rx));
    assert.ok(Math.abs(back.sph - rx.sph) < 1e-9 && Math.abs(back.cyl - rx.cyl) < 1e-9, JSON.stringify(back));
    assert.ok(Math.abs(axisDiff(back.axis, rx.axis)) < 1e-6 && back.axis > 0 && back.axis <= 180, JSON.stringify(back));
  }
  // plus-cylinder input comes back transposed: -3.00 / +1.00 x 90 = -2.00 / -1.00 x 180
  const t = spheroCyl(powerMatrixFromRx({ sph: -3, cyl: 1, axis: 90 }));
  assert.deepEqual(roundRx(t), { sph: -2, cyl: -1, axis: 180 });
  // the matrix route through magnification is exact too
  const F = powerMatrixFromRx({ sph: 2, cyl: -1, axis: 30 });
  const F2 = powerMatrix(magnificationMatrixFromPower(F));
  for (const i of [0, 1]) for (const j of [0, 1]) assert.ok(Math.abs(F2[i][j] - F[i][j]) < 1e-9);
  assert.deepEqual(roundRx({ sph: -1.1, cyl: -0.1, axis: 3 }), { sph: -1, cyl: 0, axis: null });
});

test('autocorrelation finds the diagonal lattice of a checkerboard', () => {
  const img = synthCheckerboard(256, 256, { squarePx: 8 });
  const peaks = autocorrPeaks(toGray(img.data, 256, 256), 256, 256, roiAround(128, 128, 128, 256, 256));
  assert.ok(peaks.length > 8);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i].r >= peaks[i - 1].r);
  const basis = latticeBasis(peaks);
  for (const [x, y] of basis) {
    assert.ok(Math.abs(Math.abs(x) - 8) < 0.05 && Math.abs(Math.abs(y) - 8) < 0.05, `${x}, ${y}`);
  }
  // the lens lattice is matched by direction, not by its own reduced basis
  const lens = latticeBasis(peaks).map(([x, y]) => [1.3 * x, 0.8 * y]);
  const fake = lens.flatMap(([x, y]) => [1, 2, -1].map((k) => ({ dx: k * x, dy: k * y, r: Math.hypot(k * x, k * y), value: 0.9 })));
  const m = matchBasis(basis, fake.sort((p, q) => p.r - q.r));
  const Mm = magnificationMatrix(basis, m);
  assert.ok(Math.abs(Mm[0][0] - 1.3) < 1e-9 && Math.abs(Mm[1][1] - 0.8) < 1e-9 && Math.abs(Mm[0][1]) < 1e-9);
});

test('synthetic spheres: -2.00 DS and +3.00 DS within 0.15 D', () => {
  for (const sph of [-2, 3]) {
    const rx = { sph, cyl: 0, axis: 180 };
    const r = measureLens(scene(rx), { lensRoi, refRoi });
    assertRx(r, rx);
    assert.equal(r.rounded.sph, sph);
    assert.equal(r.rounded.cyl, 0);
    assert.equal(r.quality.ok, true, r.quality.notes.join());
    assert.ok(sph > 0 ? r.quality.lensPeriodPx > r.quality.refPeriodPx : r.quality.lensPeriodPx < r.quality.refPeriodPx);
  }
});

test('synthetic sphero-cylinders: cyl within 0.25 D, axis within 7 deg (wrap at 180)', () => {
  for (const rx of [{ sph: -1, cyl: -1.5, axis: 90 }, { sph: -2, cyl: -1, axis: 45 }, { sph: 1.5, cyl: -0.75, axis: 170 }]) {
    const r = measureLens(scene(rx), { lensRoi, refRoi });
    assertRx(r, rx);
    assert.deepEqual(r.rounded, { sph: rx.sph, cyl: rx.cyl, axis: rx.axis });
    assert.ok(r.quality.asymmetry < 0.01);
  }
});

test('target rotated 12 deg against the camera axes', () => {
  for (const rx of [{ sph: -2, cyl: 0, axis: 180 }, { sph: -2, cyl: -1, axis: 45 }, { sph: 1.5, cyl: -0.75, axis: 170 }]) {
    assertRx(measureLens(scene(rx, { angleDeg: 12 }), { lensRoi, refRoi }), rx);
  }
});

test('5% Gaussian noise (seeded)', () => {
  for (const rx of [{ sph: 3, cyl: 0, axis: 180 }, { sph: -1, cyl: -1.5, axis: 90 }, { sph: 1.5, cyl: -0.75, axis: 170 }]) {
    assertRx(measureLens(scene(rx, { noise: 0.05 }), { lensRoi, refRoi }), rx);
  }
});

test('two reference areas around the lens give the same answer on a square-on target', () => {
  const rx = { sph: -2, cyl: -1, axis: 45 };
  const img = scene(rx);
  const r = measureLens(img, { lensRoi, refRoi: [roiAround(64, 64, 96, W, H), roiAround(200, 256, 96, W, H)] });
  assertRx(r, rx);
  assert.ok(r.quality.refSpread < 0.01, `spread ${r.quality.refSpread}`);
});

test('axis convention in raw image coordinates (x right, y down)', () => {
  // -1.00 D cylinder whose axis (the meridian with no cylinder power) runs
  // from the image's top-left to its bottom-right, i.e. direction (1, 1).
  // Wearer's side: top-left of the image is the wearer's upper left, which the
  // examiner facing the wearer sees on their upper right: TABO 45.
  const F = [[-0.5, 0.5], [0.5, -0.5]];
  assert.deepEqual(roundRx(spheroCyl(F)), { sph: 0, cyl: -1, axis: 45 });
  // Examiner's side: image = examiner's view with y flipped: TABO 135.
  assert.deepEqual(roundRx(spheroCyl(F, { wearerView: false })), { sph: 0, cyl: -1, axis: 135 });
  // A horizontal axis is 180 (never 0), a vertical one 90, from either side.
  for (const wearerView of [true, false]) {
    assert.equal(spheroCyl([[0, 0], [0, -1]], { wearerView }).axis, 180);
    assert.equal(spheroCyl([[-1, 0], [0, 0]], { wearerView }).axis, 90);
  }
});

test('wearerView=false mirrors the axis (45 <-> 135)', () => {
  const F = powerMatrixFromRx({ sph: -1, cyl: -1, axis: 45 });
  assert.ok(Math.abs(spheroCyl(F).axis - 45) < 1e-9);
  assert.ok(Math.abs(spheroCyl(F, { wearerView: false }).axis - 135) < 1e-9);
  assert.ok(Math.abs(spheroCyl(powerMatrixFromRx({ sph: 0, cyl: -1, axis: 180 }), { wearerView: false }).axis - 180) < 1e-9);
  // same frame, two interpretations
  const img = scene({ sph: -1, cyl: -1, axis: 30 });
  const asWearer = measureLens(img, { lensRoi, refRoi });
  const asExaminer = measureLens(img, { lensRoi, refRoi, wearerView: false });
  assert.equal(asWearer.rounded.axis, 30);
  assert.equal(asExaminer.rounded.axis, 150);
  assert.equal(asExaminer.sph, asWearer.sph);
});

test('rejections: flat grey, noise only, ROI outside the image, implausible power', () => {
  const grey = { data: new Uint8ClampedArray(W * H * 4).fill(128), width: W, height: H };
  const flat = measureLens(grey, { lensRoi, refRoi });
  assert.equal(flat.ok, false);
  assert.equal(flat.reason, 'low_contrast');
  assert.ok(flat.message.length > 0);

  addNoise(grey, 0.05, 3);
  const noisy = measureLens(grey, { lensRoi, refRoi });
  assert.equal(noisy.ok, false);
  assert.equal(noisy.reason, 'no_pattern');

  const img = scene({ sph: -2, cyl: 0, axis: 180 });
  const out = measureLens(img, { lensRoi: { x: W - 64, y: 10, w: 128, h: 128 }, refRoi });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'roi_outside_image');
  assert.equal(out.where, 'lens');

  const strong = measureLens(scene({ sph: -14, cyl: 0, axis: 180 }), { lensRoi, refRoi });
  assert.equal(strong.ok, false);
  assert.equal(strong.reason, 'implausible');
});

test('roiAround keeps the area inside the image', () => {
  assert.deepEqual(roiAround(100, 100, 64, 640, 480), { x: 68, y: 68, w: 64, h: 64 });
  assert.deepEqual(roiAround(5, 470, 128, 640, 480), { x: 0, y: 352, w: 128, h: 128 });
  assert.deepEqual(roiAround(320, 240, undefined, 640, 480), { x: 256, y: 176, w: 128, h: 128 });
  assert.deepEqual(roiAround(50, 50, 200, 120, 90), { x: 5, y: 0, w: 90, h: 90 }); // shrunk to fit
});
