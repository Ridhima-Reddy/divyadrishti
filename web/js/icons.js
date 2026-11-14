// Line icons (24 px grid, 1.75 stroke, currentColor) used instead of emoji, so
// buttons look the same on every phone and read cleanly next to text.
const P = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  shield: '<path d="M12 21.5s7.5-3.6 7.5-9.5V5.5L12 2.8 4.5 5.5V12c0 5.9 7.5 9.5 7.5 9.5z"/><path d="m9 12 2.2 2.2L15.2 10"/>',
  volume: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  volumeOff: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="m21 9.5-5 5M16 9.5l5 5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M18 13l-6 6-6-6"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v5h-5"/>',
  inbox: '<path d="M21.5 12.5h-6l-2 3h-3l-2-3h-6"/><path d="M5.6 5.2 2.5 12.5V18a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-5.5l-3.1-7.3A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.8 1.2z"/>',
  rules: '<path d="m3.5 6.5 1.8 1.8L8.5 5M3.5 13.5l1.8 1.8L8.5 12"/><path d="M12 7h8.5M12 14h8.5M12 20h8.5M4 20h4"/>',
  ruler: '<rect x="2.5" y="7.5" width="19" height="9" rx="1.5"/><path d="M6.5 7.5v3.5M10.5 7.5v2.5M14.5 7.5v3.5M18.5 7.5v2.5"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  alert: '<path d="M10.3 4 2.4 17.6A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-2.9L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="m21 3-6.5 18-4-7.5L3 9.5z"/>',
  camera: '<path d="M14.5 4.5h-5L7.5 7H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  printer: '<path d="M6.5 9V3h11v6"/><path d="M6.5 17.5h-2a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-2"/><rect x="6.5" y="14" width="11" height="7"/>',
  backspace: '<path d="M21 5H8.5L2.5 12l6 7H21a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m17.5 9.5-5 5M12.5 9.5l5 5"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
  micOff: '<path d="M15 9.4V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M5.5 11a6.5 6.5 0 0 0 10.9 4.8M18.5 11c0 .7-.1 1.4-.3 2M12 17.5V21M3 3l18 18"/>',
  phoneEnd: '<path d="M3.2 14.6c5-4.7 12.6-4.7 17.6 0l-2.4 2.6-3.6-1.6v-2.4a11 11 0 0 0-5.6 0v2.4l-3.6 1.6z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  glasses: '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 14a2 2 0 0 1 4 0M3 14 4.5 7.5 7 6.5M21 14l-1.5-6.5L17 6.5"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.2" height="7" rx="1"/><rect x="10.4" y="5" width="3.2" height="13" rx="1"/><rect x="15.8" y="8.5" width="3.2" height="9.5" rx="1"/>',
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.2a6.5 6.5 0 0 1 4 5.8"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  torch: '<path d="M8 2.5h8l-1.5 6h-5z"/><path d="M9.5 8.5h5V21h-5z"/><path d="M12 12.5v2"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

// ic('lock') → inline SVG string; decorative (aria-hidden) unless a label is given.
export function ic(name, { label = '', size = 18, cls = '' } = {}) {
  const body = P[name];
  if (!body) return '';
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

// The brand mark: an eye inside a rounded square.
export const MARK = '<svg class="mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M5.5 16c2.9-4.7 6.4-7 10.5-7s7.6 2.3 10.5 7c-2.9 4.7-6.4 7-10.5 7s-7.6-2.3-10.5-7z" fill="none" stroke="var(--mark-ink, #fff)" stroke-width="1.9"/><circle cx="16" cy="16" r="3.6" fill="var(--accent)"/></svg>';
