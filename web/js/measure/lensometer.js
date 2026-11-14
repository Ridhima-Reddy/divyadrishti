// Camera lensometry: estimate the power of the patient's CURRENT spectacles
// with the phone's rear camera and a checkerboard target, so the optometrist
// knows what the patient wears today. The result is an estimate that the
// optometrist confirms. Pure functions (no DOM, no camera), so the same code
// runs in the browser and in the Node tests.
//
// Set-up. A checkerboard (any size) on a second screen or on paper. The phone's
// rear camera is L from the target (0.40 m: the field kit's cord), the
// spectacle lens is a from the camera (0.20 m: half the cord), temples toward
// the phone, so the camera looks through the lens the way the wearer does;
// b = L − a. Part of the frame sees the pattern through the lens (lens ROI),
// part sees it directly (reference ROI).
//
// Optics (pinhole camera at the origin, thin lens). A camera ray leaving at
// angle θ meets the lens at height h = a·θ. A thin lens of power P deviates a
// ray by −P·h (light paths are reversible, so tracing from the camera is
// fine); the ray continues at θ·(1 − a·P) and lands on the target at
//     y = a·θ + b·θ·(1 − a·P) = θ·(L − a·b·P).
// Seen directly, the same target point is at angle y / L. Every angle through
// the lens is scaled by the same factor, the angular magnification
//     M = θ_lens / θ_direct = L / (L − a·b·P)   ⇔   P = L·(M − 1) / (a·b·M).
// The camera maps angle to pixels the same way in both ROIs (pixel ≈ f·θ), so
// M is just the ratio of the imaged pattern periods: no focal length and no
// target size needed. Plus lenses magnify (M > 1), minus lenses minify.
// a·b is largest at a = L/2, so "glasses halfway" is also the position where
// an error in a matters least (1 cm off changes a·b by 0.25 %).
// With the defaults L/(a·b) = 10 D, so a 1 % error in M is ~0.1 D.
// Prism (decentration) only shifts the pattern, it does not change its period.
//
// Sphero-cylinder. An astigmatic thin lens deviates a ray by −F·h, where F is
// the symmetric 2×2 dioptric power matrix. The same algebra in vector form:
//     y = (L·I − a·b·F)·θ  ⇒  Mm = L·(L·I − a·b·F)⁻¹,  F = (L/(a·b))·(I − Mm⁻¹).
// Every lattice vector of the pattern is mapped by Mm, so with two basis
// vectors as matrix columns, B_lens = Mm·B_ref ⇒ Mm = B_lens·B_ref⁻¹.
// With square pixels Mm is symmetric. An antisymmetric part (a rotation
// between the two lattices) means the measurement is off (lens or target
// tilted, a wrong area, motion), so Mm is symmetrised and the asymmetry is
// reported as a quality metric.
//
// Coordinates and the TABO axis. Image pixels: x to the right, y DOWN, in the
// raw (unmirrored) rear-camera frame of a phone held upright, with the
// spectacle frame held level (top rim parallel to the image's x axis): the
// axis is measured against the image's horizontal. F and Mm are expressed in
// these image coordinates.
// TABO: 1–180°, counter-clockwise from the EXAMINER's right while the examiner
// faces the wearer (same scheme for both eyes; 180 instead of 0).
//   wearerView = true (default): the camera is on the wearer's side, so image
//   right = wearer's right = examiner's left and image down = down. Examiner
//   coordinates are (−x, −y): a 180° rotation, which leaves a line's
//   orientation unchanged. TABO axis = atan2(dy, dx) of the axis direction in
//   raw image coordinates (on screen, with y down, that reads clockwise).
//   wearerView = false: the camera faces the front of the spectacles like the
//   examiner: examiner coordinates are (x, −y), so TABO axis = 180° − that
//   image angle (45 ↔ 135).
//
// Period estimation. 2D autocorrelation of each ROI via FFT (mean removed,
// Hann window, zero-padded to a power of two so lags do not wrap). The
// autocorrelation is divided by the window's own autocorrelation; otherwise
// the window's fall-off pulls every peak towards the centre by up to ~1 %,
// which is 0.1 D. Local maxima are refined to sub-pixel with parabolas, and
// the lattice basis is then least-squares fitted to all lattice peaks found
// (far peaks have a long lever arm, which averages the sub-pixel error down).
// A checkerboard's lattice is the diagonal one ((s, s), (s, −s)); the method
// does not care which lattice it is.

const DEG = 180 / Math.PI;

export const LENSOMETER_DEFAULTS = Object.freeze({ L: 0.40, a: 0.20, roiSize: 128 });

// Thresholds. Contrast is the luminance standard deviation (0–255) in the ROI.
export const LENSOMETER_LIMITS = Object.freeze({
  minRoiPx: 32,
  minContrast: 6,
  minPeakValue: 0.2, // normalised autocorrelation of the strongest lattice peak
  maxSph: 12,
  maxCyl: 6,
  rejectAsymmetry: 0.15, // ≈ 8.6° rotation between the lattices
  goodAsymmetry: 0.03, // ≈ 1.7°
  minPeriodPx: 5, // below this the camera undersamples the pattern
  maxResidualPx: 0.5,
  // Scale difference between reference areas. Interpolation removes the
  // first-order tilt error (10° and a 19 % spread left 0.03 D in a ray-traced
  // test), so this only flags a target that is clearly not square-on.
  maxRefSpread: 0.15,
});

// ---------------------------------------------------------------------------
// Image helpers

// Luminance (Rec. 601, the weights phone cameras use for Y).
export function toGray(rgba, width, height) {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return out;
}

// Square ROI centred on a tap, clamped inside the image.
export function roiAround(cx, cy, size = LENSOMETER_DEFAULTS.roiSize, width = Infinity, height = Infinity) {
  const s = Math.max(1, Math.round(Math.min(size ?? LENSOMETER_DEFAULTS.roiSize, width, height)));
  return { x: clamp(Math.round(cx - s / 2), 0, width - s), y: clamp(Math.round(cy - s / 2), 0, height - s), w: s, h: s };
}

const normRoi = (roi) => roi && { x: Math.round(roi.x), y: Math.round(roi.y), w: Math.round(roi.w), h: Math.round(roi.h) };

function roiInside(roi, width, height) {
  if (!roi || ![roi.x, roi.y, roi.w, roi.h].every(Number.isFinite)) return false;
  return roi.w > 0 && roi.h > 0 && roi.x >= 0 && roi.y >= 0 && roi.x + roi.w <= width && roi.y + roi.h <= height;
}

// Mean and standard deviation of the luminance inside an ROI.
export function roiContrast(gray, width, roi) {
  const { x, y, w, h } = normRoi(roi);
  let s = 0, s2 = 0;
  for (let j = 0; j < h; j++) {
    const row = (y + j) * width + x;
    for (let i = 0; i < w; i++) { const g = gray[row + i]; s += g; s2 += g * g; }
  }
  const n = w * h;
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

// ---------------------------------------------------------------------------
// FFT (iterative radix-2, in place) and autocorrelation

const twiddleCache = new Map();
function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) { t.cos[k] = Math.cos((2 * Math.PI * k) / n); t.sin[k] = Math.sin((2 * Math.PI * k) / n); }
    twiddleCache.set(n, t);
  }
  return t;
}

function fft1(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const { cos, sin } = twiddles(n);
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step];
        const s = sign * sin[k * step];
        const p = i + k;
        const q = p + half;
        const tr = re[q] * c - im[q] * s;
        const ti = re[q] * s + im[q] * c;
        re[q] = re[p] - tr; im[q] = im[p] - ti;
        re[p] += tr; im[p] += ti;
      }
    }
  }
}

// 2D FFT of an nx × ny row-major array (both powers of two).
function fft2(re, im, nx, ny, inverse) {
  for (let y = 0; y < ny; y++) fft1(re.subarray(y * nx, (y + 1) * nx), im.subarray(y * nx, (y + 1) * nx), inverse);
  const cr = new Float64Array(ny);
  const ci = new Float64Array(ny);
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) { cr[y] = re[y * nx + x]; ci[y] = im[y * nx + x]; }
    fft1(cr, ci, inverse);
    for (let y = 0; y < ny; y++) { re[y * nx + x] = cr[y]; im[y * nx + x] = ci[y]; }
  }
  if (inverse) {
    const k = 1 / (nx * ny);
    for (let i = 0; i < re.length; i++) { re[i] *= k; im[i] *= k; }
  }
}

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

// Periodic Hann window sampled at pixel centres (never exactly zero).
function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.sin((Math.PI * (i + 0.5)) / n) ** 2;
  return w;
}

// Autocorrelation of a 1D window at every lag 0..n−1.
function selfCorr(w) {
  const n = w.length;
  const out = new Float64Array(n);
  for (let d = 0; d < n; d++) { let s = 0; for (let i = 0; i + d < n; i++) s += w[i] * w[i + d]; out[d] = s; }
  return out;
}

// Parabola through three samples: offset of the vertex from the middle one.
function parabolic(a, b, c) {
  const den = a - 2 * b + c;
  return den < 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
}

// Local maxima of the normalised autocorrelation of an ROI, excluding the
// central peak. value is the normalised autocorrelation at the peak (1 = the
// pattern repeats perfectly at that shift). Sorted by radius.
export function autocorrPeaks(gray, width, height, roi, { maxRadius, minValue = 0.1, minRadius = 2 } = {}) {
  const r0 = normRoi(roi);
  if (!roiInside(r0, width, height)) throw new RangeError('autocorrPeaks: roi outside the image');
  const { x, y, w, h } = r0;
  const rMax = Math.max(minRadius + 1, Math.min(maxRadius ?? Math.floor(0.5 * Math.min(w, h)), Math.min(w, h) - 2));
  const wx = hann(w);
  const wy = hann(h);

  let sw = 0, sg = 0;
  for (let j = 0; j < h; j++) {
    const row = (y + j) * width + x;
    for (let i = 0; i < w; i++) { const wt = wx[i] * wy[j]; sw += wt; sg += wt * gray[row + i]; }
  }
  const mean = sg / sw; // window-weighted, so the windowed signal has no DC

  // Zero padding of at least rMax + 1 keeps the lags we read free of wrap-around.
  const nx = nextPow2(w + rMax + 2);
  const ny = nextPow2(h + rMax + 2);
  const re = new Float64Array(nx * ny);
  const im = new Float64Array(nx * ny);
  for (let j = 0; j < h; j++) {
    const row = (y + j) * width + x;
    for (let i = 0; i < w; i++) re[j * nx + i] = (gray[row + i] - mean) * wx[i] * wy[j];
  }
  fft2(re, im, nx, ny, false);
  for (let k = 0; k < re.length; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
  fft2(re, im, nx, ny, true); // Wiener–Khinchin: autocorrelation = IFFT(|FFT|²)

  // Divide by the window's autocorrelation (separable) so that the estimate
  // is unbiased at every lag, then normalise so that lag 0 is 1.
  const ax = selfCorr(wx);
  const ay = selfCorr(wy);
  const zero = re[0] / (ax[0] * ay[0]);
  if (!(zero > 1e-9)) return [];
  const R = rMax + 1;
  const side = 2 * R + 1;
  const C = new Float64Array(side * side).fill(NaN);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const wgt = ax[Math.abs(dx)] * ay[Math.abs(dy)];
      if (wgt < 0.03 * ax[0] * ay[0]) continue; // too little overlap to trust
      C[(dy + R) * side + dx + R] = re[((dy + ny) % ny) * nx + ((dx + nx) % nx)] / wgt / zero;
    }
  }

  const peaks = [];
  const at = (dx, dy) => C[(dy + R) * side + dx + R];
  for (let dy = -rMax; dy <= rMax; dy++) {
    for (let dx = -rMax; dx <= rMax; dx++) {
      const r = Math.hypot(dx, dy);
      if (r < minRadius || r > rMax) continue;
      const c = at(dx, dy);
      if (!(c >= minValue)) continue;
      let isMax = true;
      for (let j = -1; j <= 1 && isMax; j++) {
        for (let i = -1; i <= 1; i++) {
          if (!i && !j) continue;
          const n = at(dx + i, dy + j);
          // ties: the earlier neighbour wins, so a plateau yields one peak
          if (Number.isNaN(n) || (j < 0 || (j === 0 && i < 0) ? n > c : n >= c)) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      const px = dx + parabolic(at(dx - 1, dy), c, at(dx + 1, dy));
      const py = dy + parabolic(at(dx, dy - 1), c, at(dx, dy + 1));
      peaks.push({ dx: px, dy: py, r: Math.hypot(px, py), value: c });
    }
  }
  return peaks.sort((p, q) => p.r - q.r);
}

// ---------------------------------------------------------------------------
// Lattice from peaks

// Angle between two undirected lines, 0–90°.
function lineAngle(u, v) {
  const c = Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
  return Math.acos(Math.min(1, c)) * DEG;
}

// Pick the sign that points the vector into the right half-plane.
const normSign = ([x, y]) => (x < 0 || (x === 0 && y < 0) ? [-x, -y] : [x, y]);

function strongPeaks(peaks, rel = 0.5) {
  if (!peaks?.length) return [];
  const top = Math.max(...peaks.map((p) => p.value));
  return peaks.filter((p) => p.value >= rel * top);
}

// Least-squares fit of a lattice basis to every peak that lies near a lattice
// point of the starting basis. Returns the basis and the RMS residual (px).
export function fitLattice(basis, peaks, { tol = 0.2, iterations = 3 } = {}) {
  let B = basis;
  let rms = NaN;
  let used = 0;
  const pts = strongPeaks(peaks, 0.25);
  for (let it = 0; it < iterations; it++) {
    const inv = inv2(cols(B));
    if (!inv) break;
    const minLen = Math.min(Math.hypot(...B[0]), Math.hypot(...B[1]));
    let n11 = 0, n12 = 0, n22 = 0, p11 = 0, p12 = 0, p21 = 0, p22 = 0, e2 = 0, wsum = 0, count = 0;
    const idx = new Set();
    for (const p of pts) {
      const k1 = Math.round(inv[0][0] * p.dx + inv[0][1] * p.dy);
      const k2 = Math.round(inv[1][0] * p.dx + inv[1][1] * p.dy);
      if (!k1 && !k2) continue;
      const ex = B[0][0] * k1 + B[1][0] * k2 - p.dx;
      const ey = B[0][1] * k1 + B[1][1] * k2 - p.dy;
      if (Math.hypot(ex, ey) > tol * minLen) continue;
      const wt = Math.max(p.value, 1e-3);
      n11 += wt * k1 * k1; n12 += wt * k1 * k2; n22 += wt * k2 * k2;
      p11 += wt * p.dx * k1; p12 += wt * p.dx * k2; p21 += wt * p.dy * k1; p22 += wt * p.dy * k2;
      e2 += wt * (ex * ex + ey * ey); wsum += wt; count++;
      idx.add(`${k1},${k2}`);
    }
    rms = wsum ? Math.sqrt(e2 / wsum) : NaN;
    used = count;
    const N = inv2([[n11, n12], [n12, n22]]);
    if (!N || idx.size < 3) break; // need two independent directions
    const P = mul2([[p11, p12], [p21, p22]], N); // columns = fitted basis vectors
    B = [[P[0][0], P[1][0]], [P[0][1], P[1][1]]];
  }
  return { basis: B, rmsPx: rms, used };
}

// Reduced lattice basis from autocorrelation peaks: the shortest strong peak
// plus the shortest strong peak that is not collinear with it (> 25° apart),
// signs normalised, then least-squares refined on all lattice peaks.
export function latticeBasis(peaks, { minAngleDeg = 25 } = {}) {
  const strong = strongPeaks(peaks);
  if (strong.length < 2) return null;
  const b1 = [strong[0].dx, strong[0].dy];
  const second = strong.find((p) => lineAngle([p.dx, p.dy], b1) > minAngleDeg);
  if (!second) return null;
  const { basis } = fitLattice([normSign(b1), normSign([second.dx, second.dy])], peaks);
  return basis;
}

// Find, for each reference basis vector, the corresponding lattice vector seen
// through the lens: the lens peak closest in direction (mod 180°) and, among
// those, the shortest; its sign is aligned with the reference vector. This
// does not assume that the lens's own reduced basis corresponds to the
// reference one (a strong cylinder can change which vectors are shortest).
// A 6 D cylinder turns a lattice vector by < 15°, so 30° is a safe cone; any
// other lattice vector inside the cone is longer.
export function matchBasis(refBasis, lensPeaks, { maxAngleDeg = 30 } = {}) {
  if (!refBasis) return null;
  const strong = strongPeaks(lensPeaks);
  const out = [];
  for (const v of refBasis) {
    let best = null;
    for (const p of strong) {
      const ang = lineAngle([p.dx, p.dy], v);
      if (ang > maxAngleDeg) continue;
      if (!best || p.r < best.p.r - 0.5 || (Math.abs(p.r - best.p.r) <= 0.5 && ang < best.ang)) best = { p, ang };
    }
    if (!best) return null;
    const s = best.p.dx * v[0] + best.p.dy * v[1] < 0 ? -1 : 1;
    out.push([s * best.p.dx, s * best.p.dy]);
  }
  if (lineAngle(out[0], out[1]) < 15) return null;
  return fitLattice(out, lensPeaks).basis;
}

// Mm with B_lens = Mm·B_ref (basis vectors as columns). null if degenerate.
export function magnificationMatrix(refBasis, lensBasis) {
  const inv = inv2(cols(refBasis));
  return inv ? mul2(cols(lensBasis), inv) : null;
}

// ---------------------------------------------------------------------------
// Optics

export const magnificationFromPower = (P, { L = 0.40, a = 0.20 } = {}) => L / (L - a * (L - a) * P);

export const powerFromMagnification = (M, { L = 0.40, a = 0.20 } = {}) => (L * (M - 1)) / (a * (L - a) * M);

// F = (L/(a·b))·(I − Mm⁻¹), dioptres, image coordinates.
export function powerMatrix(Mm, { L = 0.40, a = 0.20 } = {}) {
  const k = L / (a * (L - a));
  const inv = inv2(Mm);
  if (!inv) return null;
  return [[k * (1 - inv[0][0]), -k * inv[0][1]], [-k * inv[1][0], k * (1 - inv[1][1])]];
}

// Mm = L·(L·I − a·b·F)⁻¹ (the forward model, used by the tests and the demo).
export function magnificationMatrixFromPower(F, { L = 0.40, a = 0.20 } = {}) {
  const ab = a * (L - a);
  const inv = inv2([[L - ab * F[0][0], -ab * F[0][1]], [-ab * F[1][0], L - ab * F[1][1]]]);
  return inv && inv.map((row) => row.map((v) => L * v));
}

// TABO axis ↔ angle of the axis direction in raw image coordinates (y down).
const wrap180 = (deg) => ((deg % 180) + 180) % 180;
const taboFromImage = (deg, wearerView) => wrap180(wearerView ? deg : -deg) || 180;
const imageFromTabo = (axis, wearerView) => (wearerView ? axis : -axis);

// Power matrix of a sphero-cylinder (either cylinder sign), image coordinates.
// A cylinder of power C with axis u has power C across its axis: C·n·nᵀ, n ⊥ u.
export function powerMatrixFromRx({ sph, cyl = 0, axis = 180 }, { wearerView = true } = {}) {
  const t = imageFromTabo(axis, wearerView) / DEG;
  const nx = -Math.sin(t);
  const ny = Math.cos(t);
  return [[sph + cyl * nx * nx, cyl * nx * ny], [cyl * nx * ny, sph + cyl * ny * ny]];
}

// Minus-cylinder form of a power matrix. The eigenvector with the larger
// eigenvalue is the cylinder axis (power along it = sph); the other meridian
// has sph + cyl. se = spherical equivalent.
export function spheroCyl(F, { wearerView = true } = {}) {
  const p = F[0][0];
  const r = F[1][1];
  const q = (F[0][1] + F[1][0]) / 2;
  const d = Math.hypot((p - r) / 2, q);
  const sph = (p + r) / 2 + d;
  const cyl = -2 * d;
  const imageAxis = 0.5 * Math.atan2(2 * q, p - r) * DEG;
  return { sph, cyl, axis: taboFromImage(imageAxis, wearerView), se: sph + cyl / 2 };
}

// Clinical rounding: 0.25 D steps, 5° axis steps (180 instead of 0). A lens
// that rounds to no cylinder has no axis (null).
export function roundRx({ sph, cyl, axis }) {
  const q = (v) => (Math.round(v * 4) / 4) || 0;
  const c = q(cyl);
  return { sph: q(sph), cyl: c, axis: c === 0 ? null : (Math.round(axis / 5) * 5) % 180 || 180 };
}

// ---------------------------------------------------------------------------
// Full measurement from one camera frame

const fail = (reason, message, extra = {}) => ({ ok: false, reason, message, ...extra });

// Weights that interpolate a quantity known at `pts` linearly to `p` (least
// squares; along a line for two points, plain mean for one). They sum to 1.
function interpWeights(pts, p) {
  const n = pts.length;
  const mx = pts.reduce((s, q) => s + q.x, 0) / n;
  const my = pts.reduce((s, q) => s + q.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const q of pts) { sxx += (q.x - mx) ** 2; sxy += (q.x - mx) * (q.y - my); syy += (q.y - my) ** 2; }
  const tr = sxx + syy;
  if (n < 2 || tr < 1e-9) return pts.map(() => 1 / n);
  // pseudo-inverse of the 2×2 scatter matrix: drop a direction the points do not span
  const rad = Math.hypot((sxx - syy) / 2, sxy);
  const l1 = tr / 2 + rad;
  const l2 = tr / 2 - rad;
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const e1 = [Math.cos(th), Math.sin(th)];
  const e2 = [-e1[1], e1[0]];
  const qx = p.x - mx;
  const qy = p.y - my;
  const c1 = (e1[0] * qx + e1[1] * qy) / l1;
  const c2 = l2 > 0.01 * l1 ? (e2[0] * qx + e2[1] * qy) / l2 : 0;
  const gx = e1[0] * c1 + e2[0] * c2;
  const gy = e1[1] * c1 + e2[1] * c2;
  return pts.map((q) => 1 / n + (q.x - mx) * gx + (q.y - my) * gy);
}

// refRoi may be one ROI or several. A target that is not square to the camera
// changes the pattern's scale across the image: the horizontal-meridian error
// is roughly 50 D × ΔX·sin(tilt), ΔX (m) being the distance on the target
// between the spots seen in the two areas (1.3 D for 15 cm at 10°). With two
// or more reference areas around the lens, the reference lattice is
// interpolated linearly to the lens area, which cancels that gradient to first
// order; their disagreement (refSpread) shows how tilted the target is.
export function measureLens(image, { lensRoi, refRoi, L = 0.40, a = 0.20, wearerView = true } = {}) {
  const lim = LENSOMETER_LIMITS;
  const { data, width, height } = image || {};
  if (!data || !(width > 0) || !(height > 0) || data.length < width * height * 4) return fail('no_image', 'No camera image.');
  if (!(L > 0 && a > 0 && a < L)) return fail('bad_geometry', 'The lens must be between the camera and the target (0 < a < L).');

  const refs = (Array.isArray(refRoi) ? refRoi : [refRoi]).map(normRoi);
  const rois = [...refs.map((roi) => ['reference', roi]), ['lens', normRoi(lensRoi)]];
  if (!refs.length) return fail('roi_outside_image', 'No reference area.', { where: 'reference' });
  for (const [where, roi] of rois) {
    if (!roiInside(roi, width, height)) return fail('roi_outside_image', `The ${where} area is outside the camera image.`, { where });
    if (roi.w < lim.minRoiPx || roi.h < lim.minRoiPx) return fail('roi_too_small', `The ${where} area is smaller than ${lim.minRoiPx} px.`, { where });
  }

  const gray = toGray(data, width, height);
  const found = [];
  for (const [where, roi] of rois) {
    const { std } = roiContrast(gray, width, roi);
    if (std < lim.minContrast) return fail('low_contrast', `The ${where} area has too little contrast: aim it at the checkerboard.`, { where });
    const peaks = autocorrPeaks(gray, width, height, roi);
    if (!peaks.length || Math.max(...peaks.map((p) => p.value)) < lim.minPeakValue) {
      return fail('no_pattern', `No clear checkerboard in the ${where} area.`, { where });
    }
    found.push(peaks);
  }
  const lensPeaks = found.pop();

  // Reference lattice: the first area's basis, the others matched to it, averaged.
  const first = latticeBasis(found[0]);
  if (!first) return fail('no_pattern', 'No clear checkerboard in the reference area.', { where: 'reference' });
  const bases = [first];
  for (const peaks of found.slice(1)) {
    const b = matchBasis(first, peaks);
    if (!b) return fail('no_pattern', 'The reference areas show different patterns.', { where: 'reference' });
    bases.push(b);
  }
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const wts = interpWeights(refs.map(centre), centre(rois[rois.length - 1][1]));
  const refBasis = [0, 1].map((i) => [0, 1].map((j) => bases.reduce((s, b, k) => s + wts[k] * b[i][j], 0)));
  const scales = bases.map((b) => Math.sqrt(Math.abs(det2(b))));
  const refSpread = (Math.max(...scales) - Math.min(...scales)) / (scales.reduce((s, v) => s + v, 0) / scales.length);

  const lensBasis = matchBasis(refBasis, lensPeaks);
  if (!lensBasis) return fail('no_pattern', 'The pattern through the lens does not match the reference pattern.', { where: 'lens' });

  const raw = magnificationMatrix(refBasis, lensBasis);
  if (!raw) return fail('no_pattern', 'The reference pattern is degenerate.', { where: 'reference' });
  const off = (raw[0][1] + raw[1][0]) / 2;
  const M = [[raw[0][0], off], [off, raw[1][1]]];
  // Antisymmetric part relative to the scale ≈ rotation (radians) between the lattices.
  const asymmetry = Math.abs(raw[0][1] - raw[1][0]) / (Math.abs(raw[0][0]) + Math.abs(raw[1][1]));
  const refPeriodPx = Math.min(Math.hypot(...refBasis[0]), Math.hypot(...refBasis[1]));
  const lensPeriodPx = Math.min(Math.hypot(...lensBasis[0]), Math.hypot(...lensBasis[1]));
  const residualPx = Math.max(
    ...bases.map((b, i) => fitLattice(b, found[i], { iterations: 1 }).rmsPx),
    fitLattice(lensBasis, lensPeaks, { iterations: 1 }).rmsPx,
  );

  const notes = [];
  if (asymmetry > lim.goodAsymmetry) notes.push('asymmetric');
  if (refSpread > lim.maxRefSpread) notes.push('target_tilted');
  if (Math.min(refPeriodPx, lensPeriodPx) < lim.minPeriodPx) notes.push('pattern_too_fine');
  const minSide = Math.min(...rois.map(([, roi]) => Math.min(roi.w, roi.h)));
  if (Math.max(refPeriodPx, lensPeriodPx) > minSide / 4) notes.push('pattern_too_coarse');
  if (!(residualPx <= lim.maxResidualPx)) notes.push('irregular_pattern');
  const quality = { asymmetry, refPeriodPx, lensPeriodPx, residualPx, refSpread, ok: notes.length === 0, notes };

  if (asymmetry > lim.rejectAsymmetry) {
    return fail('inconsistent', 'The two patterns are rotated against each other: hold the lens and phone straight.', { quality, M });
  }
  // A mirror image (one meridian inverted) cannot come from a real lens at
  // these distances. Note that a fully inverted image (plus lenses stronger
  // than L/(a·b), +10 D at the defaults) is NOT detectable: a point-symmetric
  // lattice looks the same upside down, so such lenses alias to lower powers.
  if (!(det2(M) > 0 && M[0][0] + M[1][1] > 0)) return fail('implausible', 'The image through the lens is mirrored.', { quality, M });

  const F = powerMatrix(M, { L, a });
  const rx = spheroCyl(F, { wearerView });
  const rounded = roundRx(rx);
  if (Math.abs(rounded.sph) > lim.maxSph || Math.abs(rounded.cyl) > lim.maxCyl) {
    return fail('implausible', 'The result is outside the plausible range: check the distances and the areas.', { quality, M, ...rx });
  }
  return { ok: true, ...rx, rounded, M, F, quality };
}

// ---------------------------------------------------------------------------
// Synthetic images for the tests

// Square wave (+1 on [0, 1), −1 on [1, 2)) box-filtered over a width f:
// difference of its antiderivative, a triangle wave, so edges are anti-aliased.
function boxSquare(z, f) {
  const tri = (u) => { const m = ((u % 2) + 2) % 2; return m <= 1 ? m : 2 - m; };
  if (f < 1e-6) return ((Math.floor(z) % 2) + 2) % 2 === 0 ? 1 : -1;
  return (tri(z + f / 2) - tri(z - f / 2)) / f;
}

// RGBA checkerboard with squares of `squarePx`, rotated by `angleDeg` (image
// coordinates). Each region { roi, Mm } shows the pattern magnified by Mm
// about the ROI centre: the pixel p shows the target point c + Mm⁻¹·(p − c),
// so every lattice vector there is Mm times the direct one.
export function synthCheckerboard(width, height, { squarePx = 10, angleDeg = 0, regions = [], dark = 20, light = 235 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const t = angleDeg / DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const regs = regions.map(({ roi, Mm }) => ({ ...normRoi(roi), cx: roi.x + roi.w / 2, cy: roi.y + roi.h / 2, J: inv2(Mm) }));
  const I = [[1, 0], [0, 1]];
  const mid = (dark + light) / 2;
  const amp = (light - dark) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let qx = x + 0.5;
      let qy = y + 0.5;
      let J = I;
      const reg = regs.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      if (reg) {
        J = reg.J;
        const dx = qx - reg.cx;
        const dy = qy - reg.cy;
        qx = reg.cx + J[0][0] * dx + J[0][1] * dy;
        qy = reg.cy + J[1][0] * dx + J[1][1] * dy;
      }
      // target coordinates (in squares): rotate by −angle
      const u = (c * qx + s * qy) / squarePx;
      const v = (-s * qx + c * qy) / squarePx;
      // footprint of the pixel in target coordinates, for the box filter
      const fu = (Math.abs(c * J[0][0] + s * J[1][0]) + Math.abs(c * J[0][1] + s * J[1][1])) / squarePx;
      const fv = (Math.abs(-s * J[0][0] + c * J[1][0]) + Math.abs(-s * J[0][1] + c * J[1][1])) / squarePx;
      const g = mid + amp * boxSquare(u, fu) * boxSquare(v, fv);
      const k = (y * width + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = g;
      data[k + 3] = 255;
    }
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// 2×2 matrix helpers

function cols(basis) { return [[basis[0][0], basis[1][0]], [basis[0][1], basis[1][1]]]; }
function det2(m) { return m[0][0] * m[1][1] - m[0][1] * m[1][0]; }
function inv2(m) {
  const d = det2(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  return [[m[1][1] / d, -m[0][1] / d], [-m[1][0] / d, m[0][0] / d]];
}
function mul2(a, b) {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
