// Screens for the extra vision tests: contrast, colour plates, astigmatism
// dial, duochrome, near vision, convergence near point and camera lensometry.
// app.js passes in its screen helpers (api) so these screens look and behave
// like the rest of the optical store app. Every result lands in C.measurements and is
// interpreted by engine/profile.js (findings) and engine/redflags.js (urgency).
import { createContrastTest, nextRing, respondRing, landoltSvg } from './measure/contrast.js';
import { SERIES, generatePlate, plateSvg, scorePlates } from './measure/plates.js';
import { N_SIZES, nSizePx, dialSvg, axisFromClock, duochromeSvg, duochromeMeaning } from './measure/charts.js';
import { ic } from './icons.js';
import { PACK_BY_CODE } from './lang/index.js';

const EYES = ['R', 'L'];
const coverOf = (api, eye) => (eye === 'R' ? api.tp('leftEye') : api.tp('rightEye'));
const eyeName = (eye) => (eye === 'R' ? 'Right eye' : 'Left eye');
const fitPx = (want, pad = 48, max = 420) => Math.round(Math.min(want, max, (window.innerWidth || 400) - pad));

function arrowsHtml(extra = '') {
  return `<div class="arrows">
      <button class="btn" data-d="up" aria-label="up">${ic('up', { size: 26 })}</button>
      <div class="row gap"><button class="btn" data-d="left" aria-label="left">${ic('left', { size: 26 })}</button><button class="btn" data-d="right" aria-label="right">${ic('right', { size: 26 })}</button></div>
      <button class="btn" data-d="down" aria-label="down">${ic('down', { size: 26 })}</button>
      ${extra}</div>`;
}
function wireArrows(api, stage, answer) {
  api.$$('[data-d]').forEach((b) => { b.onclick = () => answer(b.dataset.d); });
  let x0 = null; let y0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) answer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    x0 = null;
  });
  const key = (e) => { const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]; if (m) { e.preventDefault(); answer(m); } };
  document.addEventListener('keydown', key);
  api.setCleanup(() => document.removeEventListener('keydown', key));
}
const footer = (api, key) => `${api.demoBtn(key)}<button class="btn ghost" id="backChecks">${ic('left')} ${api.t('back')}</button>`;
function wireFooter(api) { api.$('#backChecks').onclick = api.back; api.wireDemo(); }

// ---------------------------------------------------------------- contrast
export function contrast(api, eye = 'R') {
  const st = createContrastTest();
  const scr = api.onScreen('contrast');
  const say = api.tp('contrastSetup', { eye: coverOf(api, eye) });
  const size = fitPx(25 * api.pxPerMm(), 48, 260); // ~25 mm ring: about 3 degrees at arm's length
  api.setScreen(`<section class="card test">
      <h2>${api.t('chk_contrast')} · ${eyeName(eye)}</h2>
      <p class="say">${api.esc(say)}</p>
      ${scr ? api.screenNote('Patient 1 m from the screen. Tap the way the gap points.') : '<div class="estage white" id="stage"></div>'}
      ${arrowsHtml(`<button class="btn ghost" id="cant">${api.t('cantSee')}</button>`)}
      <p class="muted small" id="lvl"></p>
      ${footer(api, 'contrast')}</section>`, 'check-contrast');
  wireFooter(api);
  api.say(say);
  const show = () => {
    const r = nextRing(st);
    if (scr) api.remote.send({ chart: 'contrast', dir: r.dir, grey: r.grey, eye, distanceM: 1 });
    else api.$('#stage').innerHTML = landoltSvg(r.dir, size, r.grey);
    api.$('#lvl').textContent = `log CS ${r.logCS.toFixed(2)} · contrast ${(r.contrast * 100).toFixed(r.contrast < 0.1 ? 1 : 0)}% · ring ${st.trials.length + 1}`;
  };
  const answer = (d) => {
    respondRing(st, d);
    if (!st.done) { show(); return; }
    const m = api.C.measurements;
    m.contrast = { ...(m.contrast || {}), [eye]: { logCS: st.result.logCS, actualLogCS: st.result.actualLogCS, rings: st.trials.length }, ...(scr ? { method: 'chart screen, 1 m' } : {}) };
    if (eye === 'R') contrast(api, 'L'); else api.back();
  };
  wireArrows(api, api.$('#stage') || document.createElement('div'), answer);
  api.$('#cant').onclick = () => answer('none');
  show();
}

// ---------------------------------------------------------------- colour plates
export function colour(api, i = 0, answers = []) {
  const p = SERIES[i];
  const plate = generatePlate(p);
  const scr = api.onScreen('colour');
  const size = fitPx(320, 40, 360);
  const say = api.tp('colourAsk');
  api.setScreen(`<section class="card test">
      <h2>${api.t('chk_colour')} · ${i === 0 ? 'demonstration plate' : `plate ${i} of ${SERIES.length - 1}`}</h2>
      <p class="say">${api.esc(say)}</p>
      ${scr ? api.screenNote(i === 0 ? 'Plates show on the screen. Patient at reading distance from it. Type the number the patient says.' : `Plate ${i} is on the screen`) : `<div class="pstage">${plateSvg(plate, size)}</div>`}
      <div class="numpad">
        <output id="numOut" aria-live="polite">–</output>
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => `<button class="btn" data-n="${n}">${n}</button>`).join('')}
        <button class="btn ghost" data-n="del" aria-label="delete">${ic('backspace', { size: 22 })}</button>
      </div>
      <div class="row gap wrap"><button class="btn" id="noNum">${api.t('noNumber')}</button><button class="btn primary" id="plateNext" disabled>${api.t('next')} ${ic('right')}</button></div>
      <p class="muted small">Screen colours are not calibrated: a screening, not a diagnosis. Use good daylight or room light.</p>
      ${footer(api, 'colour')}</section>`, 'check-colour');
  wireFooter(api);
  if (i <= 1) api.say(say);
  if (scr) api.remote.send({ chart: 'plate', index: i });
  let typed = '';
  const out = api.$('#numOut');
  const go = (val) => {
    const next = [...answers, val];
    if (i + 1 < SERIES.length) { colour(api, i + 1, next); return; }
    api.C.measurements.colour = { ...scorePlates(next), answers: next, eyes: 'both' };
    api.back();
  };
  api.$$('[data-n]').forEach((b) => {
    b.onclick = () => {
      typed = b.dataset.n === 'del' ? typed.slice(0, -1) : (typed + b.dataset.n).slice(0, 2);
      out.textContent = typed || '–';
      api.$('#plateNext').disabled = !typed;
    };
  });
  api.$('#noNum').onclick = () => go('');
  api.$('#plateNext').onclick = () => go(typed);
}

// ---------------------------------------------------------------- astigmatism dial
export function astigmatism(api, eye = 'R') {
  const say = api.tp('astigAsk', { eye: coverOf(api, eye) });
  const scr = api.onScreen('astigmatism');
  const ro = api.remote.options();
  const size = scr ? fitPx(220, 40, 260) : fitPx(300, 40, 380);
  api.setScreen(`<section class="card test">
      <h2>${api.t('chk_astigmatism')} · ${eyeName(eye)}</h2>
      <p class="say">${api.esc(say)}</p>
      ${scr ? api.screenNote(`Patient ${ro.distanceM} m from the screen. Tap the line the patient names as darkest.`) : '<p class="muted small">Glasses off (or with current glasses, and note it). Patient at about 1 m.</p>'}
      <div class="pstage" id="dial">${dialSvg(size)}</div>
      <button class="btn big" id="even">${api.t('allSame')}</button>
      ${footer(api, 'astigmatism')}</section>`, 'check-astigmatism');
  wireFooter(api);
  api.say(say);
  if (scr) api.remote.send({ chart: 'astigmatism', eye, distanceM: ro.distanceM });
  const rec = (v) => {
    const m = api.C.measurements;
    m.astigmatism = { ...(m.astigmatism || {}), [eye]: v, distanceM: scr ? ro.distanceM : 1 };
    if (eye === 'R') astigmatism(api, 'L'); else api.back();
  };
  api.$$('#dial [data-line]').forEach((g) => {
    g.style.cursor = 'pointer';
    g.onclick = () => {
      const low = Number(g.dataset.line);
      const pair = low === 6 ? '12-6' : `${low}-${low + 6}`;
      rec({ even: false, line: pair, axis: axisFromClock(low) });
    };
  });
  api.$('#even').onclick = () => rec({ even: true });
}

// ---------------------------------------------------------------- duochrome
export function duochrome(api, eye = 'R') {
  const m = api.C.measurements;
  const withGl = m.duochrome?.withGlasses ?? (api.C.session.answers.glasses_now === true);
  const say = api.tp('duoAsk', { eye: coverOf(api, eye) });
  const scr = api.onScreen('duochrome');
  const ro = api.remote.options();
  const size = fitPx(300, 40, 420);
  api.setScreen(`<section class="card test">
      <h2>${api.t('chk_duochrome')} · ${eyeName(eye)}</h2>
      <p class="say">${api.esc(say)}</p>
      <label class="check"><input type="checkbox" id="withGl" ${withGl ? 'checked' : ''}> ${api.t('withGlasses')}</label>
      ${scr ? api.screenNote(`Patient ${ro.mirror ? '3 m from the mirror (6 m optical path)' : `${ro.distanceM} m from the screen`}`) : `<div class="pstage">${duochromeSvg(size)}</div>`}
      <div class="row gap wrap center">
        <button class="btn big duo-red" data-side="red">${api.t('redSide')}</button>
        <button class="btn big" data-side="equal">${api.t('sameBoth')}</button>
        <button class="btn big duo-green" data-side="green">${api.t('greenSide')}</button>
      </div>
      <p class="muted small">Red clearer: ${duochromeMeaning('red')}. Green clearer: ${duochromeMeaning('green')}. Works with colour vision differences too.</p>
      ${footer(api, 'duochrome')}</section>`, 'check-duochrome');
  wireFooter(api);
  api.say(say);
  if (scr) api.remote.send({ chart: 'duochrome', eye, distanceM: ro.distanceM });
  api.$$('[data-side]').forEach((b) => {
    b.onclick = () => {
      m.duochrome = { ...(m.duochrome || {}), [eye]: b.dataset.side, withGlasses: api.$('#withGl').checked, distanceM: scr ? ro.distanceM : 2 };
      if (eye === 'R') duochrome(api, 'L'); else api.back();
    };
  });
}

// ---------------------------------------------------------------- near vision (N chart)
export function nearAcuity(api) {
  const C = api.C;
  const lang = C.lang;
  const pack = PACK_BY_CODE[lang];
  const lines = pack?.nearText?.length ? pack.nearText
    : lang === 'en' ? ['the farmer sold rice at the market', 'my son reads the paper each morning', 'take two tablets after food', 'the bus leaves at nine', 'please sign here', 'rain is good for crops', 'thread the needle', 'call me tomorrow']
      : [pack?.nearWords || 'read the small words'];
  const scr = api.onScreen('near_acuity');
  const cm = scr ? 40 : Math.round(C.measurements.readingDistanceCm || 40);
  const say = api.tp('nearAsk');
  const withGl = C.measurements.nearAcuity?.withGlasses ?? ['reading', 'bifocal', 'progressive'].includes(C.session.answers.glasses_type);
  api.setScreen(`<section class="card test">
      <h2>${api.t('chk_near_acuity')} · ${cm} cm</h2>
      <p class="say">${api.esc(say)}</p>
      <label class="check"><input type="checkbox" id="withGl" ${withGl ? 'checked' : ''}> ${api.t('withGlasses')}</label>
      <p class="muted small">${api.t('smallestRead')}. Sizes assume ${api.calibrated() ? 'the calibrated screen' : 'an uncalibrated screen (calibrate for true sizes)'}.</p>
      ${scr ? `${api.screenNote('N chart on the screen at true print size. Patient 40 cm from it. Tap the smallest line read.')}<div class="nbtns">${N_SIZES.map((n) => `<button class="btn" data-n="${n}">N${n}</button>`).join('')}</div>`
    : `<ol class="nchart" lang="${lang}">${N_SIZES.map((n, i) => `<li><button class="nline" data-n="${n}" style="font-size:${nSizePx(n, api.pxPerMm()).toFixed(1)}px"><span class="nlabel">N${n}</span>${api.esc(lines[i % lines.length])}</button></li>`).join('')}</ol>`}
      <button class="btn ghost" id="cantRead">${api.t('cantRead')}</button>
      ${footer(api, 'near_acuity')}</section>`, 'check-near');
  wireFooter(api);
  api.say(say);
  if (scr) api.remote.send({ chart: 'near', lang });
  const rec = (n) => { C.measurements.nearAcuity = { N: n, distanceCm: cm, withGlasses: api.$('#withGl').checked, ...(scr ? { method: 'chart screen' } : {}) }; api.back(); };
  api.$$('[data-n]').forEach((b) => { b.onclick = () => rec(Number(b.dataset.n)); });
  api.$('#cantRead').onclick = () => rec(36);
}

// ---------------------------------------------------------------- convergence near point (NPC)
export function npc(api) {
  const samples = [];
  let lastValid = null;
  const say = api.tp('npcAsk');
  api.cameraScreen({
    key: 'npc', title: api.t('chk_npc'), instruction: say,
    extraHtml: '<p class="npc-target" aria-hidden="true">E</p>',
    actions: `<button class="btn primary big" id="npcStop">${api.t('stopDouble')}</button>`,
    onFrame: (f) => {
      const ro = api.$('#readout'); if (!ro) return;
      if (!f || !f.distanceMm) { ro.textContent = lastValid ? `closer than ${Math.round(lastValid)} cm` : api.t('noFace'); samples.push(null); return; }
      const cm = f.distanceMm / 10;
      lastValid = cm;
      samples.push(cm); if (samples.length > 60) samples.shift();
      ro.innerHTML = `<b>${Math.round(cm)} cm</b>`;
    },
  });
  setTimeout(() => {
    const b = api.$('#npcStop'); if (!b) return;
    b.onclick = () => {
      const recent = samples.slice(-6);
      const valid = recent.filter((x) => x);
      api.C.measurements.npc = valid.length >= 3
        ? { cm: Math.round(api.median(valid)), method: 'camera' }
        : { cm: null, bound: lastValid ? `closer than ${Math.round(lastValid)} cm` : 'not measured', method: 'camera' };
      api.back();
    };
    api.$('#manualSave').onclick = () => { const v = Number(api.$('#manualIn').value); if (v >= 2 && v <= 60) { api.C.measurements.npc = { cm: v, method: 'manual (ruler)' }; api.back(); } };
  }, 0);
}

// ---------------------------------------------------------------- lensometry (rear camera)
export async function lensometry(api, eye = 'R') {
  const target = new URL('lensometer-target.html', location.href).href;
  let qr = '';
  try { const { qrSvg } = await import('./qr.js'); qr = qrSvg(target, { cellSize: 3, label: 'pattern page' }) || ''; } catch { qr = ''; }
  const say = api.tp('lensoSetup');
  api.setScreen(`<section class="card test">
      <h2>${api.t('chk_lensometry')} · ${eye === 'R' ? 'right lens' : 'left lens'}</h2>
      <p class="say">${api.esc(say)}</p>
      ${api.remote.paired() ? api.screenNote('Lens pattern is on the chart screen. Phone 40 cm from the screen, glasses halfway between.') : ''}
      <div class="lenso-setup" ${api.remote.paired() ? 'hidden' : ''}>
        <div class="qr">${qr}</div>
        <p class="small">Open on a laptop or a second phone: <a href="${api.esc(target)}" target="_blank" rel="noopener">${api.t('lensoShow')}</a>. Or print it.</p>
      </div>
      <div class="cam rear"><video id="lvid" playsinline muted></video><canvas id="lstill" hidden></canvas><div id="lhint" class="readout">…</div></div>
      <div class="row gap wrap"><button class="btn primary" id="lcap">${api.t('capture')}</button><button class="btn" id="lretake" hidden>${api.t('retake')}</button></div>
      <div id="lout" class="pdout"></div>
      <p class="muted small">Estimate only (thin-lens model, ±0.50 D expected): the optometrist confirms on a lensmeter. Progressive lenses: only the zone you look through is measured.</p>
      <details class="small"><summary>${api.t('enterManually')}</summary>
        <div class="row gap wrap"><input id="mSph" type="number" step="0.25" placeholder="SPH"><input id="mCyl" type="number" step="0.25" placeholder="CYL"><input id="mAx" type="number" step="5" placeholder="AXIS"><button class="btn" id="mSave">${api.t('done')}</button></div></details>
      ${footer(api, 'lensometry')}</section>`, 'check-lensometry');
  wireFooter(api);
  api.say(say);
  if (api.remote.paired()) api.remote.send({ chart: 'lenso' });
  const m = api.C.measurements;
  const save = (r, quality) => {
    m.lensometry = { ...(m.lensometry || {}), [eye]: r, method: 'camera magnification (L 40 cm, a 20 cm)' };
    m.lensometry.quality = m.lensometry.quality === 'low' || quality === 'low' ? 'low' : 'good';
    if (eye === 'R') lensometry(api, 'L'); else api.back();
  };
  api.$('#mSave').onclick = () => {
    const sph = Number(api.$('#mSph').value); const cyl = Number(api.$('#mCyl').value || 0); const axis = Number(api.$('#mAx').value || 0);
    if (Number.isFinite(sph) && api.$('#mSph').value !== '') save({ sph, cyl, axis: cyl ? axis : null, se: sph + cyl / 2, method: 'manual' }, 'good');
  };
  const vid = api.$('#lvid'); const still = api.$('#lstill'); const hint = api.$('#lhint');
  let stream = null;
  api.setCleanup(() => stream?.getTracks().forEach((x) => x.stop()));
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    if (!vid.isConnected) { stream.getTracks().forEach((x) => x.stop()); return; }
    vid.srcObject = stream; await vid.play();
    hint.textContent = 'Lens over the pattern, pattern also visible on both sides';
  } catch { hint.textContent = api.t('cameraFail'); return; }
  const L = await import('./measure/lensometer.js');
  api.$('#lcap').onclick = () => {
    const W = vid.videoWidth; const H = vid.videoHeight;
    if (!W) return;
    still.width = W; still.height = H;
    const g = still.getContext('2d', { willReadFrequently: true });
    g.drawImage(vid, 0, 0, W, H); // raw, unmirrored frame
    const img = g.getImageData(0, 0, W, H);
    still.hidden = false; vid.hidden = true;
    api.$('#lcap').hidden = true; api.$('#lretake').hidden = false;
    const taps = [];
    const prompts = [api.t('lensoTapLens'), api.t('lensoTapRef1'), api.t('lensoTapRef2')];
    hint.textContent = prompts[0];
    const size = Math.round(Math.min(128, W / 8, H / 6));
    const draw = () => {
      g.putImageData(img, 0, 0);
      g.lineWidth = Math.max(2, W / 500);
      taps.forEach((p, k) => { g.strokeStyle = k === 0 ? '#ff7a1a' : '#1f9bb0'; g.strokeRect(p.x - size / 2, p.y - size / 2, size, size); });
    };
    still.onclick = (e) => {
      if (taps.length >= 3) return;
      const r = still.getBoundingClientRect();
      taps.push({ x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) });
      draw();
      if (taps.length < 3) { hint.textContent = prompts[taps.length]; return; }
      hint.textContent = 'Measuring…';
      const roi = (p) => L.roiAround(p.x, p.y, size, W, H);
      const res = L.measureLens(img, { lensRoi: roi(taps[0]), refRoi: [roi(taps[1]), roi(taps[2])], L: 0.40, a: 0.20 });
      const out = api.$('#lout');
      if (!res.ok) {
        hint.textContent = 'Could not measure';
        out.innerHTML = `<p class="warn-text">${api.esc(res.message || res.reason)}</p>`;
        return;
      }
      const rr = res.rounded;
      const txt = `${rr.sph > 0 ? '+' : ''}${rr.sph.toFixed(2)}${rr.cyl ? ` / ${rr.cyl.toFixed(2)} × ${rr.axis}` : ' DS'}`;
      const quality = res.quality.ok ? 'good' : 'low';
      hint.textContent = txt;
      out.innerHTML = `<p><b>${eye === 'R' ? 'Right' : 'Left'} lens ≈ ${txt}</b> (SE ${res.se.toFixed(2)} D)</p>
        ${quality === 'low' ? `<p class="warn-text small">Low quality: ${api.esc((res.quality.notes || []).join(', '))}. Retake with the screen square to the phone.</p>` : ''}
        <button class="btn primary" id="lsave">${api.t('useThis')}</button>`;
      api.$('#lsave').onclick = () => save({ sph: rr.sph, cyl: rr.cyl || 0, axis: rr.cyl ? rr.axis : null, se: Math.round(res.se * 100) / 100, quality }, quality);
    };
  };
  api.$('#lretake').onclick = () => lensometry(api, eye);
}

// ---------------------------------------------------------------- Amsler follow-up: when did it start?
export function amslerOnset(api) {
  const say = api.tp('amslerOnsetAsk');
  api.setScreen(`<section class="card test">
      <h2>${api.t('chk_amsler')}</h2>
      <p class="say">${api.esc(say)}</p>
      <div class="row gap wrap">
        <button class="btn big warn" data-o="new">${api.tp('onsetNew')}</button>
        <button class="btn big" data-o="old">${api.tp('onsetOld')}</button>
        <button class="btn big" data-o="unsure">${api.tp('onsetUnsure')}</button>
      </div>
      <p class="muted small">New distortion: macula check within 1 working day (NICE NG82). Long-standing: within a few weeks.</p></section>`, 'amsler-onset');
  api.say(say);
  api.$$('[data-o]').forEach((b) => { b.onclick = () => { api.C.measurements.amsler.onset = b.dataset.o; api.back(); }; });
}

export { EYES };
