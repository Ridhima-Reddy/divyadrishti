// DivyaDrishti story page: the hero product straightens as it rises into view,
// the phone plays a real interview from the demo patients (R. Lakshmi, Tamil),
// the how-it-works visual follows the step being read, and the test tiles draw
// their stimuli. Everything rests under prefers-reduced-motion.
const $ = (s, r = document) => r.querySelector(s);

// Coming back to the story page ends any demo in this tab, so each app opens on
// its own sign-in and demo choice again. Real sign-ins are left alone.
(() => {
  const ss = (() => { try { return sessionStorage; } catch { return null; } })();
  if (!ss) return;
  const json = (k) => { try { return JSON.parse(ss.getItem(k) || 'null'); } catch { return null; } };
  ss.removeItem('dd.demo'); // field app
  ss.removeItem('dd.patient.session'); // the patient app keeps only demo sessions here
  if (json('dd.clin')?.demo) ss.removeItem('dd.clin'); // optometrist portal
  if (ss.getItem('dd.zeiss.mode') === 'demo') { ss.removeItem('dd.zeiss.mode'); ss.removeItem('dd.zeiss.token'); }
  if (json('dd.displayShop')?.demo) { ss.removeItem('dd.displayShop'); } // test screen
})();
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SVG = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------- nav: glass once scrolled, tone from the section beneath it
const nav = $('#nav');
const menuBtn = $('#menuBtn');
const links = $('#links');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  links.classList.toggle('open', open);
});
links.addEventListener('click', (e) => { if (e.target.closest('a')) { menuBtn.setAttribute('aria-expanded', 'false'); links.classList.remove('open'); } });

const stage = $('#stage');
let ticking = false;
function onScroll() {
  ticking = false;
  const y = window.scrollY;
  nav.classList.toggle('scrolled', y > 8);
  const probe = document.elementsFromPoint(innerWidth / 2, 40).find((el) => !nav.contains(el) && el.closest('[data-tone]'));
  const tone = probe?.closest('[data-tone]')?.dataset.tone || 'light';
  if (nav.dataset.tone !== tone) nav.dataset.tone = tone;
  if (still) return;
  document.documentElement.style.setProperty('--sy', String(Math.round(y)));
  // the product lies back while below the fold and straightens as it rises
  if (stage && innerWidth > 760) {
    const top = stage.getBoundingClientRect().top;
    stage.style.setProperty('--tilt', clamp((top - innerHeight * 0.12) / (innerHeight * 0.62), 0, 1).toFixed(3));
  }
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
addEventListener('resize', onScroll);
onScroll();

// ---------------------------------------------------------------- the phone: a real interview, as the app runs it
const BEATS = [
  { tag: 'Health', q: 'Q6', prog: 34, ta: 'சுகர், பிபி, தைராய்டு ஏதாவது இருக்கா?', en: 'Do you have diabetes, high blood pressure, or a thyroid problem?',
    why: 'Diabetes damages the retina silently and makes glasses power fluctuate.', said: 'சுகர் இருக்கு', heard: 'Diabetes' },
  { tag: 'Health', q: 'Q7', prog: 42, ta: 'சுகர் எத்தனை வருஷமா இருக்குங்க?', en: 'For how many years have you had diabetes?',
    why: 'Retinopathy risk rises with every year of diabetes.', said: 'எட்டு வருஷம்', heard: '8 years' },
  { tag: 'Health', q: 'Q8', prog: 50, ta: 'டாக்டர் கடைசியா எப்போ கண்ணுல சொட்டு மருந்து போட்டு, கண்ணோட உள்ளப் பகுதியைப் பார்த்தாங்க?',
    en: 'When did a doctor last put drops in your eyes and check the back of the eye?',
    why: 'People with diabetes need a dilated retina check every year; an overdue check is referred.', said: 'ஒருபோதும் பார்க்கவில்லை', heard: 'Never', refer: true },
];
const el = {
  tag: $('#pTag'), q: $('#pQ'), prog: $('#pProg'), question: $('#pQuestion'), en: $('#pEn'), state: $('#pState'),
  trans: $('#pTrans'), heard: $('#pHeard'), heardV: $('#pHeardV'), whyT: $('#pWhyT'), queue: $('#queue'), ctl: $('#playCtl'),
};
let playing = !still;
let visible = true;
let run = 0;
const freshRow = () => {
  const li = document.createElement('li');
  li.className = 'qrow amber fresh';
  li.innerHTML = '<em class="av">RL</em><span><b>R. Lakshmi</b><small>Diabetes, retina never checked</small></span><span class="tier soon">Soon</span><span class="due mono">received just now</span>';
  return li;
};
function showBeat(b, { said = '', heard = false } = {}) {
  el.tag.textContent = b.tag; el.q.textContent = b.q; el.prog.style.width = `${b.prog}%`;
  el.question.textContent = b.ta; el.en.textContent = b.en; el.whyT.textContent = b.why;
  el.trans.textContent = said ? `“${said}”` : '';
  el.heard.hidden = !heard; el.heardV.textContent = b.heard;
  el.state.className = `pill ${heard ? 'listening' : said ? 'hearing' : 'speaking'}`;
  el.state.textContent = said || heard ? 'Listening' : 'Speaking';
  const card = el.heard.parentElement;
  card.querySelector('.pref')?.remove();
  if (heard && b.refer) card.insertAdjacentHTML('beforeend', '<div class="pref">Retina check overdue · referred to the optometrist</div>');
}
async function wait(ms, my) {
  const end = performance.now() + ms;
  while (performance.now() < end) { await sleep(60); if (my !== run) return false; while ((!playing || !visible) && my === run) await sleep(120); }
  return my === run;
}
async function loop() {
  const my = ++run;
  for (;;) {
    el.queue.querySelector('.fresh')?.remove();
    for (const b of BEATS) {
      showBeat(b);
      if (!await wait(1300, my)) return;
      for (let i = 1; i <= b.said.length; i += 1) {
        el.trans.textContent = `“${b.said.slice(0, i)}”`;
        el.state.className = 'pill hearing';
        if (!await wait(55, my)) return;
      }
      showBeat(b, { said: b.said });
      if (!await wait(450, my)) return;
      showBeat(b, { said: b.said, heard: true });
      if (!await wait(b.refer ? 1200 : 1700, my)) return;
    }
    el.queue.prepend(freshRow());
    if (!await wait(4200, my)) return;
  }
}
if (still) {
  const last = BEATS[BEATS.length - 1];
  showBeat(last, { said: last.said, heard: true });
  const row = freshRow(); row.classList.remove('fresh'); el.queue.prepend(row);
  el.ctl.hidden = true;
} else {
  el.ctl.addEventListener('click', () => {
    playing = !playing;
    el.ctl.textContent = playing ? 'Pause' : 'Play';
    el.ctl.setAttribute('aria-pressed', String(!playing));
  });
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.15 }).observe(stage);
  loop();
}

// ---------------------------------------------------------------- how it works: the visual follows the step being read
const steps = $$('.step');
const panels = $$('.howvis .vpanel');
// the phone layout shows each panel under its step: clone it, renaming SVG ids so
// gradients and clip paths still resolve to the visible copy
const cloneWithIds = (node, suffix) => {
  const c = node.cloneNode(true);
  const ids = [...c.querySelectorAll('[id]')].map((el) => { const old = el.id; el.id = `${old}${suffix}`; return old; });
  if (ids.length) {
    c.querySelectorAll('*').forEach((el) => {
      for (const a of ['fill', 'stroke', 'clip-path', 'mask', 'filter']) {
        const v = el.getAttribute(a);
        if (v && v.includes('url(#')) el.setAttribute(a, v.replace(/url\(#([^)]+)\)/g, (m, id) => (ids.includes(id) ? `url(#${id}${suffix})` : m)));
      }
    });
  }
  return c;
};
steps.forEach((st, i) => { const m = st.querySelector('.mvis'); if (m && panels[i]) m.append(cloneWithIds(panels[i], `-m${i}`)); });
const setStep = (i) => {
  steps.forEach((s, k) => s.classList.toggle('on', k === i));
  panels.forEach((p, k) => p.classList.toggle('on', k === i));
};
const stepObserver = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) setStep(steps.indexOf(e.target));
}, { rootMargin: '-45% 0px -45% 0px' });
steps.forEach((s) => stepObserver.observe(s));

// ---------------------------------------------------------------- the tests, drawn as the patient sees them
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const node = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const ROT = [0, 90, 180, 270];

// tumbling E chart: rows shrink as on a printed chart
const acuity = $('.viz-acuity');
if (acuity) {
  const rows = document.createElement('div');
  rows.className = 'erows';
  [[58, 1], [42, 2], [30, 3], [21, 4], [15, 5], [10, 6]].forEach(([size, n]) => {
    const row = document.createElement('div');
    row.className = 'erow';
    row.style.setProperty('--g', `${Math.round(size * 0.6)}px`);
    for (let i = 0; i < n; i++) {
      const s = node('svg', { viewBox: '0 0 5 5', width: size, height: size, style: `transform:rotate(${ROT[Math.floor(rnd() * 4)]}deg)` });
      s.append(node('path', { d: 'M0 0H5V1H1V2H5V3H1V4H5V5H0Z', fill: 'currentColor' }));
      row.append(s);
    }
    rows.append(row);
  });
  acuity.append(rows);
}

// Landolt C rings that fade step by step
const contrast = $('.viz-contrast');
if (contrast) {
  const C = 2 * Math.PI * 2;
  ['#111', '#5a5a5a', '#8d8d8d', '#b8b8b8', '#d9d9d9'].forEach((col, i) => {
    const s = node('svg', { viewBox: '0 0 5 5', width: 32, height: 32 });
    s.append(node('circle', { cx: 2.5, cy: 2.5, r: 2, fill: 'none', stroke: col, 'stroke-width': 1, 'stroke-dasharray': `${C - 1.01} 1.01`, transform: `rotate(${ROT[(i * 3) % 4] + 5.6} 2.5 2.5)` }));
    contrast.append(s);
  });
}

// a colour plate: dots inside the number take the warm set, the rest the olive set
const plate = $('#plate');
if (plate) {
  const cv = document.createElement('canvas');
  cv.width = 200; cv.height = 200;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.font = '700 118px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('74', 100, 106);
  const px = g.getImageData(0, 0, 200, 200).data;
  const inside = (x, y) => px[((Math.round(y) * 200 + Math.round(x)) * 4) + 3] > 120;
  const warm = ['#e08a4a', '#d9773a', '#eaa05f', '#cf6a3a', '#e79a56'];
  const olive = ['#8fae5a', '#a3b86a', '#7a9a4a', '#b5c27a', '#6f8f45', '#9cb36a'];
  const dots = [];
  for (let tries = 0; tries < 9000 && dots.length < 520; tries++) {
    const r = 2.6 + rnd() * 4.6; const a = rnd() * Math.PI * 2; const d = Math.sqrt(rnd()) * (94 - r);
    const x = 100 + Math.cos(a) * d; const y = 100 + Math.sin(a) * d;
    if (dots.every((o) => (o.x - x) ** 2 + (o.y - y) ** 2 > (o.r + r + 0.8) ** 2)) dots.push({ x, y, r });
  }
  for (const o of dots) {
    const pal = inside(o.x, o.y) ? warm : olive;
    plate.append(node('circle', { cx: o.x.toFixed(1), cy: o.y.toFixed(1), r: o.r.toFixed(1), fill: pal[Math.floor(rnd() * pal.length)] }));
  }
}

// astigmatism dial: a fan of lines, one meridian a little darker
const dial = $('svg.dial');
if (dial) {
  for (let deg = 0; deg <= 180; deg += 15) {
    const a = (deg * Math.PI) / 180;
    const [x1, y1, x2, y2] = [110 + Math.cos(a) * 20, 112 - Math.sin(a) * 20, 110 + Math.cos(a) * 104, 112 - Math.sin(a) * 104];
    dial.append(node('line', { x1, y1, x2, y2, stroke: '#111', 'stroke-width': deg === 60 ? 3.4 : 1.6, 'stroke-linecap': 'round' }));
  }
  dial.setAttribute('viewBox', '0 0 220 120');
}

// ---------------------------------------------------------------- test groups: show all, or one group
const tchips = $$('[data-tg]');
tchips.forEach((b) => b.addEventListener('click', () => {
  const g = b.dataset.tg;
  tchips.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
  $$('.tgroup').forEach((sec) => { sec.hidden = g !== 'all' && sec.dataset.g !== g; });
}));

// ---------------------------------------------------------------- numbers count up once, the first time they are seen
const nums = $$('[data-count]');
if (!still && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const end = Number(e.target.dataset.count); const t0 = performance.now(); const dur = 1300;
      const tick = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        e.target.textContent = String(Math.round(end * (1 - (1 - p) ** 4)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, { threshold: 0.6 });
  nums.forEach((n) => { if (n.getBoundingClientRect().top > innerHeight) io.observe(n); });
}
