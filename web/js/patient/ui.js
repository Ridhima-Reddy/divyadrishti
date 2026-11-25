// Small helpers shared by the patient app's screens.
import { ic } from '../icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A few icons the optical store app does not need, drawn on the same 24 px grid.
const EXTRA = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.2A1.7 1.7 0 0 0 8.7 21h6.6a1.7 1.7 0 0 0 1.7-1.8L18 7"/><path d="M9 7V4.5h6V7"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  record: '<rect x="5" y="3.5" width="14" height="17.5" rx="2.2"/><path d="M9 3.5h6v3H9zM8.5 11h7M8.5 15h5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" opacity=".35"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-.9 1.4-1.9-.5-1.1.2-2.3 1.4-2.3h1.9a3.8 3.8 0 0 0 3.8-3.8c0-5-3.8-9-8.5-9z"/><circle cx="7.8" cy="11" r="1.1"/><circle cx="10.5" cy="7.4" r="1.1"/><circle cx="15" cy="7.8" r="1.1"/>',
  dial: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18"/>',
  text: '<path d="M4 6.5h16M4 11h12M4 15.5h8M4 20h5"/>',
};

export function icon(name, { size = 18, label = '', cls = '' } = {}) {
  if (!EXTRA[name]) return ic(name, { size, label, cls });
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${EXTRA[name]}</svg>`;
}

// The Landolt C mark (system.md, Signature elements).
export const mark = (size = 28, cls = 'mark') => `<svg class="${cls}" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><path d="M26.2 13.2A10.6 10.6 0 1 0 26.2 18.8" fill="none" stroke="currentColor" stroke-width="3.2"/><circle cx="16" cy="16" r="3.1" fill="currentColor"/></svg>`;

// ---------------------------------------------------------------- outcomes (always a word with the colour)
export const OUTCOMES = {
  looks_good: { label: 'Looks good', tier: 'routine', lane: 'green' },
  follow_up: { label: 'Worth a check', tier: 'soon', lane: 'amber' },
  see_soon: { label: 'See an optometrist soon', tier: 'urgent', lane: 'orange' },
};
const ORDER = ['looks_good', 'follow_up', 'see_soon'];
export const worstOf = (list) => list.reduce((w, o) => (ORDER.indexOf(o) > ORDER.indexOf(w) ? o : w), 'looks_good');
export const tierChip = (o) => `<span class="tier ${OUTCOMES[o]?.tier || 'info'}">${esc(OUTCOMES[o]?.label || 'No result')}</span>`;

// ---------------------------------------------------------------- dates
export function asDate(iso) {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = asDate(iso);
  return d ? d.toLocaleDateString('en-IN', opts) : '';
}
export function fmtWhen(iso) {
  const d = asDate(iso);
  return d ? d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
}
export function fmtTime(iso) {
  const d = asDate(iso);
  return d ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
}

// ---------------------------------------------------------------- network
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Could not connect. Check the internet connection and try again.', 0);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail; } catch { /* not JSON */ }
    throw new ApiError(typeof detail === 'string' && detail ? detail : `The server said no (HTTP ${res.status}).`, res.status);
  }
  return res.json();
}

// ---------------------------------------------------------------- toast and clipboard
let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// sms: with no number, so the patient picks the contact (works on Android and iOS)
export const smsHref = (text) => `sms:?&body=${encodeURIComponent(text)}`;
