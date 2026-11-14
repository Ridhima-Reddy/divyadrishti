// Video consult between the optometrist (portal, role 'hub') and the store or
// camp phone with the patient (role 'store'). Audio and video go directly
// between the two browsers (WebRTC, encrypted by DTLS-SRTP); the hub server
// only passes the connection set-up messages and never sees the media.
// A public STUN server helps the two find each other across networks; it sees
// network addresses only. Set localStorage 'dd.stun' to 'none' to turn it off
// (then both must be on the same network) or to your own stun: URL.
import { ic } from './icons.js';

const POLL_MS = 700;
const stunUrl = () => { try { return localStorage.getItem('dd.stun') || 'stun:stun.l.google.com:19302'; } catch { return 'stun:stun.l.google.com:19302'; } };

// Open the call overlay. initiator: true for the side that created the call
// (it sends the offer once the other side joins).
export function openCall({ api, headers = {}, callId, role, initiator, title = 'Video consult', side = '', onEnd = () => {} }) {
  const el = document.createElement('div');
  el.className = 'call';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  el.innerHTML = `
    <div class="call-main">
      <div class="call-top"><span class="pill" id="cState">Connecting…</span><b>${title}</b></div>
      <video class="call-remote" id="cRemote" autoplay playsinline></video>
      <div class="call-wait" id="cWait">${ic('user', { size: 40 })}<span>${initiator ? 'Waiting for the other side to join…' : 'Joining…'}</span></div>
      <video class="call-local" id="cLocal" autoplay playsinline muted></video>
      <div class="call-bar">
        <button class="cbtn" id="cMute" type="button" aria-label="Mute microphone" aria-pressed="false">${ic('mic', { size: 20 })}</button>
        <button class="cbtn" id="cCam" type="button" aria-label="Turn camera off" aria-pressed="false">${ic('video', { size: 20 })}</button>
        <button class="cbtn" id="cFlip" type="button" aria-label="Switch camera">${ic('refresh', { size: 20 })}</button>
        <button class="cbtn" id="cTorch" type="button" aria-label="Torch" aria-pressed="false" hidden>${ic('torch', { size: 20 })}</button>
        ${role === 'hub' ? `<button class="cbtn" id="cEye" type="button" aria-label="Ask to see the eye with the rear camera" title="Ask to see the eye">${ic('eye', { size: 20 })}</button>` : ''}
        <button class="cbtn end" id="cEnd" type="button" aria-label="End call">${ic('phoneEnd', { size: 22 })}</button>
      </div>
    </div>
    ${side ? `<aside class="call-side">${side}</aside>` : ''}`;
  document.body.appendChild(el);
  const q = (s) => el.querySelector(s);
  const state = (txt, cls = '') => { q('#cState').textContent = txt; q('#cState').className = `pill ${cls}`; };

  const servers = stunUrl() === 'none' ? [] : [{ urls: stunUrl() }];
  const pc = new RTCPeerConnection({ iceServers: servers });
  let local = null; let facing = 'user'; let next = 0; let closed = false; let timer = null; let offered = false;
  const signal = (type, data = null) => fetch(`${api}/calls/${callId}/signal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ role, type, data }),
  }).catch(() => {});

  pc.onicecandidate = (e) => { if (e.candidate) signal('ice', e.candidate.toJSON()); };
  pc.ontrack = (e) => { q('#cRemote').srcObject = e.streams[0]; q('#cWait').hidden = true; };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') state('Connected', 'listening');
    else if (s === 'failed') state('Could not connect: check both are online', 'demo');
    else if (s === 'disconnected') state('Reconnecting…', 'demo');
  };

  const makeOffer = async () => {
    if (offered) return; offered = true;
    const o = await pc.createOffer(); await pc.setLocalDescription(o);
    signal('offer', { type: o.type, sdp: o.sdp });
  };
  // Network candidates can arrive before the offer or answer they belong to
  // (the two messages race to the hub): hold them until it is applied.
  const early = [];
  const remoteSet = async (desc) => {
    await pc.setRemoteDescription(desc);
    for (const c of early.splice(0)) { try { await pc.addIceCandidate(c); } catch { /* stale */ } }
  };
  const handle = async (m) => {
    if (m.type === 'join' && initiator) await makeOffer();
    else if (m.type === 'offer') {
      await remoteSet(m.data);
      const a = await pc.createAnswer(); await pc.setLocalDescription(a);
      signal('answer', { type: a.type, sdp: a.sdp });
    } else if (m.type === 'answer') await remoteSet(m.data);
    else if (m.type === 'ice') {
      if (!pc.remoteDescription) early.push(m.data);
      else { try { await pc.addIceCandidate(m.data); } catch { /* stale candidate */ } }
    }
    else if (m.type === 'ctrl' && m.data?.action === 'rear' && role === 'store') {
      await switchCam('environment');
      toast('The optometrist asked to see the eye: rear camera on. Hold it 10 to 15 cm from the eye.');
    } else if (m.type === 'end') { state('The other side ended the call'); setTimeout(() => end(false), 1200); }
  };
  const poll = async () => {
    if (closed) return;
    try {
      const r = await fetch(`${api}/calls/${callId}/signal?role=${role}&since=${next}`, { headers });
      if (r.status === 404) { state('Call ended'); setTimeout(() => end(false), 1000); return; }
      const j = await r.json();
      next = j.next;
      for (const m of j.msgs) await handle(m);
    } catch { /* offline: keep polling */ }
    timer = setTimeout(poll, POLL_MS);
  };

  async function end(tell = true) {
    if (closed) return; closed = true;
    clearTimeout(timer);
    if (tell) await signal('end');
    local?.getTracks().forEach((t) => t.stop());
    pc.close(); el.remove(); onEnd();
  }

  (async () => {
    try {
      local = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: true });
      q('#cLocal').srcObject = local;
      local.getTracks().forEach((t) => pc.addTrack(t, local));
    } catch { state('Camera or microphone blocked: allow them and try again', 'demo'); }
    if (!initiator) await signal('join');
    state(initiator ? 'Calling…' : 'Joining…');
    poll();
  })();

  q('#cEnd').onclick = () => end(true);
  q('#cMute').onclick = (e) => {
    const t = local?.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled; e.currentTarget.setAttribute('aria-pressed', String(!t.enabled));
    e.currentTarget.innerHTML = ic(t.enabled ? 'mic' : 'micOff', { size: 20 });
  };
  q('#cCam').onclick = (e) => {
    const t = local?.getVideoTracks()[0]; if (!t) return;
    t.enabled = !t.enabled; e.currentTarget.setAttribute('aria-pressed', String(!t.enabled));
  };
  // Switch between the front camera and the rear one (to show an eye up close).
  async function switchCam(mode) {
    if (!local || mode === facing) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
      const nt = s.getVideoTracks()[0];
      const sender = pc.getSenders().find((x) => x.track?.kind === 'video');
      await sender?.replaceTrack(nt);
      local.getVideoTracks().forEach((t) => { t.stop(); local.removeTrack(t); });
      local.addTrack(nt); q('#cLocal').srcObject = local;
      facing = mode;
      q('#cLocal').classList.toggle('rear', facing !== 'user');
      torchCheck();
    } catch { /* single camera */ }
  }
  // The rear camera's torch lights the eye (Android Chrome; hidden where unsupported).
  let torchOn = false;
  function torchCheck() {
    const t = local?.getVideoTracks()[0];
    const ok = Boolean(t?.getCapabilities?.().torch);
    q('#cTorch').hidden = !ok;
    torchOn = false; q('#cTorch').setAttribute('aria-pressed', 'false');
  }
  const toast = (msg) => {
    const d = document.createElement('div'); d.className = 'call-toast'; d.textContent = msg;
    q('.call-main').appendChild(d); setTimeout(() => d.remove(), 5000);
  };
  q('#cFlip').onclick = () => switchCam(facing === 'user' ? 'environment' : 'user');
  q('#cTorch').onclick = async () => {
    const t = local?.getVideoTracks()[0]; if (!t) return;
    try { torchOn = !torchOn; await t.applyConstraints({ advanced: [{ torch: torchOn }] }); q('#cTorch').setAttribute('aria-pressed', String(torchOn)); } catch { torchOn = false; }
  };
  // Tap the small picture to swap it with the big one, as in a normal video call.
  q('#cLocal').onclick = () => q('.call-main').classList.toggle('swapped');
  q('#cRemote').onclick = () => { if (q('.call-main').classList.contains('swapped')) q('.call-main').classList.remove('swapped'); };
  const eyeBtn = q('#cEye');
  if (eyeBtn) eyeBtn.onclick = () => { signal('ctrl', { action: 'rear' }); toast('Asked the store phone to show the eye with its rear camera.'); };
  return { end, el };
}

// Start a new call for a case. by: 'hub' (portal, needs the portal token) or 'store'.
export async function createCall(api, caseId, by, headers = {}) {
  const r = await fetch(`${api}/calls`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ caseId, by }) });
  if (!r.ok) throw new Error(`call ${r.status}`);
  return (await r.json()).id;
}
