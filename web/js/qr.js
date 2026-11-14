// QR codes as SVG strings, so the patient can scan a share link from the
// store phone. Wraps the vendored qrcode-generator 1.4.4 (MIT, Kazuhiko Arase,
// web/vendor/qrcode-generator.js); nothing is loaded from a CDN.
//
// Fails soft: returns null when the library is unavailable or the text does
// not fit in a QR code, so callers can just show the link instead.
import qrcode from '../vendor/qrcode-generator.js';

if (typeof qrcode === 'function' && qrcode.stringToBytesFuncs?.['UTF-8']) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; // default is Latin-1 only
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// cellSize: pixels per module. margin: quiet zone in pixels (default 4 modules).
// ecl: error correction 'L' | 'M' | 'Q' | 'H'. label: accessible name.
export function qrSvg(text, { cellSize = 4, margin, ecl = 'M', label = 'QR code' } = {}) {
  if (typeof qrcode !== 'function' || typeof text !== 'string' || !text) return null;
  const cs = Math.max(1, Math.round(Number(cellSize) || 4));
  const m = Math.max(0, Math.round(margin === undefined ? cs * 4 : Number(margin) || 0));
  try {
    const qr = qrcode(0, ['L', 'M', 'Q', 'H'].includes(ecl) ? ecl : 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const size = n * cs + 2 * m;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n;) {
        if (!qr.isDark(r, c)) { c++; continue; }
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += `M${m + c * cs} ${m + r * cs}h${run * cs}v${cs}h-${run * cs}z`;
        c += run;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" `
      + `shape-rendering="crispEdges" role="img" aria-label="${esc(label)}">`
      + `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  } catch {
    return null; // e.g. text too long for a QR code
  }
}
