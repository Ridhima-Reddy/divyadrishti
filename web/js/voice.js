// Thin wrapper over the browser's speech APIs (Web Speech API).
// Chrome on Android: Google speech recognition for en-IN, hi-IN, ta-IN, bn-IN and
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
let finishActive = null;
let cancelActive = null;

// Listening that gives people time to answer. Older patients pause, think and
// restart ("enna... oru anju varusham irukkum"), so recognition runs
// continuously and ends only after a pause in speech:
//   waitMs     how long to wait for speech to start            (default 10 s)
//   silenceMs  pause after speech that counts as "finished"    (default 2.5 s)
//   maxMs      hard limit for one answer                        (default 30 s)
// The operator can end it early with finishListening() ("Done speaking").
// Resolves with { transcript, confidence, alternatives: [{ text, confidence }] }
// or null on silence / error. Confidence is 0..1 (0 = engine did not say).
export function listen(lang, { onInterim = () => {}, onState = () => {}, waitMs = 10000, silenceMs = 2500, maxMs = 30000 } = {}) {
  return new Promise((resolve) => {
    if (!Rec) { resolve(null); return; }
    stopListening();
    const r = new Rec();
    r.lang = LOCALE[lang] || lang || 'en-IN';
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.continuous = true;
    const finals = []; // [{ text, alternatives }]
    let interim = '';
    let finished = false;
    let silenceTimer = null;
    const joined = (extra = '') => [...finals.map((f) => f.text), extra].join(' ').replace(/\s+/g, ' ').trim();
    const result = () => {
      const text = joined(interim);
      if (!text) return null;
      const last = finals.at(-1);
      const head = finals.slice(0, -1).map((f) => f.text).join(' ');
      const alternatives = last && !interim
        ? last.alternatives.map((a) => ({ text: `${head} ${a.text}`.trim(), confidence: a.confidence }))
        : [{ text, confidence: 0 }];
      return { transcript: alternatives[0].text, confidence: alternatives[0].confidence, alternatives };
    };
    const end = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(waitTimer); clearTimeout(maxTimer); clearTimeout(silenceTimer);
      activeRec = null; finishActive = null; cancelActive = null;
      try { r.stop(); } catch { /* already stopped */ }
      onState('done');
      resolve(value);
    };
    const finish = () => end(result());
    const armSilence = () => { clearTimeout(silenceTimer); silenceTimer = setTimeout(finish, silenceMs); };
    const waitTimer = setTimeout(() => { if (!finals.length && !interim) finish(); }, waitMs);
    const maxTimer = setTimeout(finish, maxMs);
    r.onspeechstart = () => { clearTimeout(waitTimer); onState('hearing'); };
    r.onresult = (e) => {
      clearTimeout(waitTimer);
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (!res.isFinal) { interim = `${interim} ${text}`.trim(); continue; }
        const alternatives = Array.from(res).map((x) => ({ text: x.transcript.trim(), confidence: x.confidence || 0 }));
        // Chrome on Android can resend the whole utterance as a longer final: keep one copy
        const prev = finals.at(-1);
        if (prev && text.startsWith(prev.text)) finals[finals.length - 1] = { text, alternatives };
        else if (!(prev && prev.text.startsWith(text))) finals.push({ text, alternatives });
      }
      onInterim(joined(interim));
      armSilence();
    };
    r.onspeechend = armSilence;
    r.onerror = (e) => { if (e.error === 'no-speech' && !finals.length) finish(); else if (e.error !== 'no-speech') finish(); };
    // some browsers end continuous sessions on their own: restart until our timers decide
    r.onend = () => { if (!finished) { try { r.start(); } catch { finish(); } } };
    activeRec = r;
    finishActive = finish;
    cancelActive = () => end(null);
    try { r.start(); onState('listening'); } catch { finish(); }
  });
}

// "Done speaking": end the current answer now and use what was heard.
export function finishListening() { if (finishActive) finishActive(); }

export function stopListening() {
  const r = activeRec;
  if (cancelActive) cancelActive();
  if (r) { r.onend = null; try { r.abort(); } catch { /* ignore */ } }
}

export function stopAll() {
  stopListening();
  if (ttsSupported()) window.speechSynthesis.cancel();
}
