// The patient's own data, kept in this browser only (localStorage). Shared by
// the patient app (patient.html) and the share viewer (share.html), which can
// save an opened Vision Passport into the same record.
//
//   dd.patient.record    entries: visits, self-check results, prescriptions, passports
//   dd.patient.requests  appointment requests: {id, secret, shopName, kind, createdAt}
//   dd.patient.prefs     age band, screen size (px per mm), reminder kind, last PIN code

export const KEYS = { record: 'dd.patient.record', requests: 'dd.patient.requests', prefs: 'dd.patient.prefs' };

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

// ---------------------------------------------------------------- preferences
const PREF_DEFAULTS = { ageBand: null, pxPerMm: null, remindFor: 'adult', pin: '' };
export const prefs = () => ({ ...PREF_DEFAULTS, ...read(KEYS.prefs, {}) });
export const setPrefs = (patch) => write(KEYS.prefs, { ...prefs(), ...patch });

// ---------------------------------------------------------------- the record
export function entries() {
  const v = read(KEYS.record, []);
  return Array.isArray(v) ? v.filter((e) => e && typeof e === 'object' && e.id && e.type) : [];
}
// newest first: by the date of the event, then by when it was added
export const sortedEntries = () => entries().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
  || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

export function addEntry(entry) {
  const all = entries();
  const e = { id: uid(), createdAt: new Date().toISOString(), date: today(), ...entry };
  all.push(e);
  return write(KEYS.record, all) ? e : null;
}
export function removeEntry(id) {
  write(KEYS.record, entries().filter((e) => e.id !== id));
}

// the last visit to an eye-care place: a visit, a prescription or a passport
export function lastVisit() {
  return sortedEntries().find((e) => ['visit', 'rx', 'passport'].includes(e.type)) || null;
}
export function latestRx() {
  return sortedEntries().find((e) => (e.type === 'rx' || e.type === 'passport') && hasRx(e.rx)) || null;
}
export const hasRx = (rx) => Boolean(rx && (rx.R || rx.L));

// ---------------------------------------------------------------- appointment requests
export function requests() {
  const v = read(KEYS.requests, []);
  return Array.isArray(v) ? v.filter((r) => r && r.id && r.secret) : [];
}
export function addRequest(r) {
  const all = requests();
  all.unshift({ id: r.id, secret: r.secret, shopName: r.shopName, kind: r.kind, createdAt: r.createdAt || new Date().toISOString() });
  write(KEYS.requests, all);
}
export function removeRequest(id) {
  write(KEYS.requests, requests().filter((r) => r.id !== id));
}

// ---------------------------------------------------------------- Vision Passport text
// The passport is plain text (web/js/passport.js): the first line is the title
// with the case code, the second the patient's name and the date (en-IN
// dd/mm/yyyy), and a line "Rx: R -1.25 / −0.50 × 90  Add +1.50   L plano".
const NUM = String.raw`[+\-−]?\d+(?:\.\d+)?`;
const EYE_RE = new RegExp(String.raw`^(plano|${NUM})(?:\s*\/\s*(${NUM})\s*[×x]\s*(\d{1,3}))?(?:\s+Add\s+(${NUM}))?`, 'i');
const toNum = (s) => (s === undefined || s === null || s === '' ? null : Number(String(s).replace('−', '-')));

export function parseEye(text) {
  const m = EYE_RE.exec(String(text || '').trim());
  if (!m) return null;
  const sph = /plano/i.test(m[1]) ? 0 : toNum(m[1]);
  if (!Number.isFinite(sph)) return null;
  const eye = { sph };
  if (m[2] !== undefined) { eye.cyl = toNum(m[2]); eye.axis = toNum(m[3]); }
  if (m[4] !== undefined) eye.add = toNum(m[4]);
  return eye;
}

export function parseRxLine(line) {
  const body = String(line || '').replace(/^\s*Rx:\s*/i, '');
  const m = /^\s*R\s+(.+?)\s+L\s+(.+)$/.exec(body);
  if (!m) return null;
  const R = parseEye(m[1]); const L = parseEye(m[2]);
  return R || L ? { R, L } : null;
}

export function parsePassport(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = lines[0] || 'Vision Passport';
  const code = (/\bDD-[A-Z0-9]{4,8}\b/.exec(title) || [])[0] || '';
  let date = null;
  for (const l of lines.slice(0, 4)) {
    const d = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(l);
    if (d) { date = `${d[3]}-${pad(d[2])}-${pad(d[1])}`; break; }
  }
  const rxLine = lines.find((l) => /^Rx:/i.test(l));
  return { title, code, date, rx: rxLine ? parseRxLine(rxLine) : null };
}

// Save an opened passport. Returns {entry, duplicate}.
export function savePassport({ text, place = '' }) {
  const clean = String(text || '').trim();
  const dup = entries().find((e) => e.type === 'passport' && e.text === clean);
  if (dup) return { entry: dup, duplicate: true };
  const p = parsePassport(clean);
  const entry = addEntry({ type: 'passport', date: p.date || today(), place: String(place).trim().slice(0, 80), title: p.title, code: p.code, text: clean, ...(p.rx ? { rx: p.rx } : {}) });
  return { entry, duplicate: false };
}
