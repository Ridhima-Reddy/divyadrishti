// Thin wrapper over the browser's speech APIs (Web Speech API).
// Chrome on Android: Google speech recognition for en-IN, hi-IN, ta-IN and
// Google TTS voices if installed. Edge on desktop has natural Hindi/Tamil voices.
// Production plan: Bhashini / AI4Bharat IndicConformer + IndicTTS, which run
// for 22 Indian languages and can be hosted in India.
import { LOCALE } from './i18n.js';

const Rec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
let voices = [];
function loadVoices() { voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const sttSupported = () => Boolean(Rec);

export function voiceFor(lang) {
  if (!voices.length) loadVoices();
  const loc = LOCALE[lang] || 'en-IN';
  const base = loc.slice(0, 2);
  const exact = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === loc.toLowerCase());
  const same = exact.length ? exact : voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const score = (v) => (/natural|online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return same.sort((a, b) => score(b) - score(a))[0] || null;
}

export const hasVoice = (lang) => ttsSupported() && Boolean(voiceFor(lang));

let speakingUtterance = null;
export function speak(text, lang, { rate = 0.92 } = {}) {
  return new Promise((resolve) => {
    if (!ttsSupported() || !text) { resolve(false); return; }
    const v = voiceFor(lang);
    if (!v) { resolve(false); return; } // never read Tamil with an English voice
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = rate;
    const done = () => { clearTimeout(timer); speakingUtterance = null; resolve(true); };
    // Chrome sometimes never fires onend for long utterances
    const timer = setTimeout(done, Math.min(30000, 1500 + text.length * 90));
    u.onend = done; u.onerror = done;
    speakingUtterance = u;
    window.speechSynthesis.speak(u);
  });
}

let activeRec = null;
// Resolves with { transcript, alternatives } or null on silence / error.
export function listen(lang, { onInterim = () => {}, timeoutMs = 9000 } = {}) {
  return new Promise((resolve) => {
    if (!Rec) { resolve(null); return; }
    stopListening();
    const r = new Rec();
    r.lang = LOCALE[lang] || lang || 'en-IN';
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.continuous = false;
    let finished = false;
    const finish = (val) => { if (finished) return; finished = true; clearTimeout(timer); activeRec = null; try { r.stop(); } catch { /* already stopped */ } resolve(val); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    r.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (!res.isFinal) { onInterim(res[0].transcript); return; }
      const alternatives = Array.from(res).map((x) => x.transcript);
      finish({ transcript: alternatives[0], alternatives });
    };
    r.onerror = () => finish(null);
    r.onend = () => finish(null);
    activeRec = r;
    try { r.start(); } catch { finish(null); }
  });
}

export function stopListening() {
  if (activeRec) { try { activeRec.abort(); } catch { /* ignore */ } activeRec = null; }
}

export function stopAll() {
  stopListening();
  if (ttsSupported()) window.speechSynthesis.cancel();
}
