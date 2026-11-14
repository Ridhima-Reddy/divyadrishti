// Small chart helpers for the near-vision, astigmatism-dial and duochrome tests.

// ---------------------------------------------------------------- near vision (N notation)
// N notation: the print size in typographic points (1 pt = 0.3528 mm of font
// body height). N5-N6 is newspaper small print, N8 a normal book, N12 large print.
// Sizes are drawn from the calibrated screen pixels per millimetre.
export const N_SIZES = [24, 18, 14, 12, 10, 8, 6, 5];
export const POINT_MM = 25.4 / 72;
export const nSizeMm = (n) => n * POINT_MM;
export const nSizePx = (n, pxPerMm) => Math.max(5, nSizeMm(n) * pxPerMm);

// ---------------------------------------------------------------- astigmatism dial
// A "clock" of lines every 30 degrees. With uncorrected astigmatism the
// lines along one meridian look darker and sharper. Rule of 30: the
// minus-cylinder axis is about 30 x the LOWER clock number of the darkest line
// (3-9 o'clock -> 90, 12-6 -> 180, 1-7 -> 30, 2-8 -> 60, 4-10 -> 120, 5-11 -> 150).
export const DIAL_LINES = [[12, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11]];
export function axisFromClock(hour) {
  const pair = DIAL_LINES.find((p) => p.includes(Number(hour)));
  if (!pair) return null;
  const low = Math.min(...pair);
  return low === 6 ? 180 : low * 30;
}
// SVG of the dial; each line is tappable via data-line="<lower hour>".
export function dialSvg(sizePx) {
  const lines = DIAL_LINES.map(([a, b]) => {
    const ang = (a % 12) * 30; // clock angle from 12 o'clock, clockwise
    const rad = ((ang - 90) * Math.PI) / 180;
    const x = Math.cos(rad) * 44; const y = Math.sin(rad) * 44;
    const low = Math.min(a, b) === 6 ? 6 : Math.min(a, b);
    return `<g data-line="${low}" class="dline"><line x1="${50 + x}" y1="${50 + y}" x2="${50 - x}" y2="${50 - y}" stroke="#111" stroke-width="1.6"/>`
      + `<line x1="${50 + x}" y1="${50 + y}" x2="${50 - x}" y2="${50 - y}" stroke="transparent" stroke-width="9"/></g>`;
  }).join('');
  const labels = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => {
    const rad = ((h * 30 - 90) * Math.PI) / 180;
    return `<text x="${50 + Math.cos(rad) * 48.5}" y="${50 + Math.sin(rad) * 48.5 + 1.4}" font-size="4" text-anchor="middle" fill="#555">${h}</text>`;
  }).join('');
  return `<svg class="dial" width="${sizePx}" height="${sizePx}" viewBox="0 0 100 100" role="img" aria-label="astigmatism dial">${lines}${labels}<circle cx="50" cy="50" r="1.6" fill="#d96d24"/></svg>`;
}

// ---------------------------------------------------------------- duochrome
// Red and green halves with black rings. Long (red) wavelengths focus behind
// short (green) ones, so: red clearer = the eye focuses in front of the retina
// = needs more minus (or less plus); green clearer = needs less minus (or more
// plus); equal = balanced. Works with colour vision deficiency too. At 2 m the
// target is 0.5 D closer than optical infinity, which biases a non-focusing eye
// slightly toward green: recorded with the result.
export function duochromeSvg(sizePx) {
  const ring = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="${(r / 4).toFixed(2)}"/>`;
  const rings = (x0) => [[x0, 30, 9], [x0, 58, 6.5], [x0, 80, 4.5]].map(([x, y, r]) => ring(x, y, r)).join('');
  return `<svg class="duo" width="${sizePx}" height="${sizePx}" viewBox="0 0 100 100" role="img" aria-label="duochrome">`
    + '<rect x="0" y="0" width="50" height="100" fill="#d0021b"/><rect x="50" y="0" width="50" height="100" fill="#1f9a3a"/>'
    + `${rings(25)}${rings(75)}</svg>`;
}
export function duochromeMeaning(side) {
  return { red: 'needs more minus (or less plus)', green: 'needs less minus (or more plus)', equal: 'balanced' }[side] || '';
}
