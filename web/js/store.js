// Offline-first case store. Cases are written to IndexedDB first and synced
// to the bridge server when the phone is online. POST is idempotent on the
// client-generated case id, so retries over flaky 2G never duplicate a case.

const DB_NAME = 'divyadrishti';
const STORE = 'cases';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

export const putCase = (c) => tx('readwrite', (s) => s.put(c));
export const getCase = (id) => tx('readonly', (s) => s.get(id));
export async function allCases() {
  const list = await tx('readonly', (s) => s.getAll());
  return (list || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export const API = (() => {
  const u = new URL(location.href);
  return u.searchParams.get('api') || localStorage.getItem('dd.api') || '/api';
})();

export async function syncPending() {
  const list = await allCases();
  let sent = 0;
  for (const c of list.filter((x) => x.sync !== 'sent')) {
    try {
      const { sync, review, ...payload } = c;
      const r = await fetch(`${API}/cases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (r.ok) { c.sync = 'sent'; c.sentAt = new Date().toISOString(); await putCase(c); sent++; }
    } catch { /* offline: try later */ }
  }
  return sent;
}

// Pull optometrist decisions back for cases this phone sent.
export async function pullReviews() {
  const list = (await allCases()).filter((c) => c.sync === 'sent' && !c.review);
  for (const c of list) {
    try {
      const r = await fetch(`${API}/cases/${c.id}`);
      if (!r.ok) continue;
      const remote = await r.json();
      if (remote.review) { c.review = remote.review; await putCase(c); }
    } catch { /* offline */ }
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { syncPending(); });
