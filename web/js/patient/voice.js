// Voice for the self-checks: each instruction is read aloud, and the patient can
// answer by speaking ("up", "left", "yes", "no", "not sure", a number) instead of
// tapping. Uses the browser's own speech services; where they are missing the
// switch is hidden and the checks work by touch as before.
const KEY = 'dd.patient.voice';
const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = Boolean(Rec);
export const canSpeak = 'speechSynthesis' in globalThis;
export const supported = canListen || canSpeak;
export const isOn = () => supported && localStorage.getItem(KEY) === '1';
export function setOn(v) { localStorage.setItem(KEY, v ? '1' : '0'); if (!v) stop(); }

// spoken word -> the button it presses (English, plus common Hindi and Tamil words)
const WORDS = [
  [/\b(up|top|upar|mele)\b/, '[data-d=up]'],
  [/\b(down|bottom|neeche|niche|keezhe)\b/, '[data-d=down]'],
  [/\b(left|baayen|bayen|baen|idathu|idadu)\b/, '[data-d=left]'],
  [/\b(right|daayen|dayen|daen|valathu|valadu)\b/, '[data-d=right]'],
  [/\b(not sure|don'?t know|can'?t see|cannot see|no number|pata nahi)\b/, '#unsure, #cant, #noNum'],
  [/\b(yes|haan|ha|aamaa|ama|darker|wavy)\b/, '#aYes, #dDark'],
  [/\b(no|nahin|nahi|illai|straight|same)\b/, '#aNo, #dSame'],
  [/\b(next|start|ready|continue|okay|ok|done)\b/, '#go'],
];
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, twenty: 20, 'twenty six': 26, 'twenty nine': 29, forty: 40, 'forty two': 42, 'forty five': 45, seventy: 70, 'seventy four': 74 };

let rec = null; let root = null; let heard = () => {};

function act(text) {
  const t = text.toLowerCase().trim();
  const digits = t.match(/\d{1,2}/)?.[0] ?? (NUM[t] !== undefined ? String(NUM[t]) : null);
  const plate = root?.querySelector('#plateIn, input[inputmode=numeric]');
  if (plate && digits) { plate.value = digits; plate.dispatchEvent(new Event('input', { bubbles: true })); root.querySelector('#plateNext')?.click(); heard(t); return; }
  for (const [re, sel] of WORDS) {
    if (!re.test(t)) continue;
    const b = [...(root?.querySelectorAll(sel) || [])].find((x) => !x.disabled && x.offsetParent !== null);
    if (b) { b.click(); heard(t); return; }
  }
  heard(t, true);
}

export function listen(el, onHeard = () => {}) {
  root = el; heard = onHeard;
  if (!canListen || !isOn() || rec) return;
  rec = new Rec();
  rec.lang = 'en-IN'; rec.continuous = true; rec.interimResults = false;
  rec.onresult = (e) => { const r = e.results[e.results.length - 1]; if (r.isFinal) act(r[0].transcript); };
  rec.onend = () => { if (rec && isOn()) { try { rec.start(); } catch { rec = null; } } };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setOn(false); heard('Microphone blocked: answer by tapping.', true); } };
  try { rec.start(); } catch { rec = null; }
}
export function stop() { const r = rec; rec = null; if (r) { r.onend = null; try { r.stop(); } catch { /* already stopped */ } } if (canSpeak) speechSynthesis.cancel(); }

export function say(text) {
  if (!canSpeak || !isOn() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-IN'; u.rate = 0.95;
  speechSynthesis.speak(u);
}
