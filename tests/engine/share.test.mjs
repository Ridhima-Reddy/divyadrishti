import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptShare, decryptShare, parseShareFragment, createShareLink, revokeShare, fetchShare, shareUrl, ShareError,
} from '../../web/js/share.js';
import { qrSvg } from '../../web/js/qr.js';

const FAST = { iterations: 1000 }; // tests only; the app uses 310,000
const PASSPORT = { title: 'Vision Passport · DD-4F2A91', text: 'R. Lakshmi\nUsed for: near work.\nSuggested: readers (add +1.75).', lang: 'en' };
const code = (c) => (e) => e instanceof ShareError && e.code === c;
const flip = (b64s) => { // flip one bit of base64 data
  const b = Buffer.from(b64s, 'base64'); b[b.length >> 1] ^= 1; return b.toString('base64');
};

test('round trip without a PIN; server record holds no plaintext', async () => {
  const { id, key, record } = await encryptShare(PASSPORT);
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(record.id, id);
  assert.equal(record.salt, null);
  assert.equal(record.iterations, null);
  assert.ok(!JSON.stringify(record).includes('Lakshmi'));
  assert.ok(!JSON.stringify(record).includes(key), 'the key never goes into the record');
  assert.deepEqual(await decryptShare(record, key, { id }), PASSPORT);
  assert.deepEqual(await decryptShare(record, key), PASSPORT, 'id defaults to record.id');
});

test('round trip with a PIN; wrong or missing PIN is rejected', async () => {
  const { id, key, record } = await encryptShare(PASSPORT, { pin: '4821', ...FAST });
  assert.ok(record.salt && record.iterations === 1000);
  assert.ok(!JSON.stringify(record).includes('4821'));
  assert.deepEqual(await decryptShare(record, key, { id, pin: '4821' }), PASSPORT);
  await assert.rejects(decryptShare(record, key, { id, pin: '4822' }), code('wrong_pin'));
  await assert.rejects(decryptShare(record, key, { id }), code('pin_required'));
  // the fragment key alone is not enough, and neither is the PIN with another key
  const other = await encryptShare(PASSPORT);
  await assert.rejects(decryptShare(record, other.key, { id, pin: '4821' }), code('wrong_pin'));
  // default iteration count is the vault's 310,000 and travels in the record
  const slow = await encryptShare({ a: 1 }, { pin: '123456' });
  assert.equal(slow.record.iterations, 310000);
  assert.deepEqual(await decryptShare(slow.record, slow.key, { pin: '123456' }), { a: 1 });
  await assert.rejects(encryptShare(PASSPORT, { pin: '12' }), code('bad_pin'));
  await assert.rejects(encryptShare(PASSPORT, { pin: '12ab56' }), code('bad_pin'));
});

test('tampered ciphertext, iv or salt is rejected', async () => {
  const plain = await encryptShare(PASSPORT);
  await assert.rejects(decryptShare({ ...plain.record, ciphertext: flip(plain.record.ciphertext) }, plain.key), code('damaged'));
  await assert.rejects(decryptShare({ ...plain.record, iv: flip(plain.record.iv) }, plain.key), code('damaged'));
  const pinned = await encryptShare(PASSPORT, { pin: '9090', ...FAST });
  await assert.rejects(decryptShare({ ...pinned.record, salt: flip(pinned.record.salt) }, pinned.key, { pin: '9090' }), code('wrong_pin'));
  await assert.rejects(decryptShare({ ...pinned.record, iterations: 2000 }, pinned.key, { pin: '9090' }), code('wrong_pin'));
  // a server cannot strip the PIN requirement: without the salt the key differs
  await assert.rejects(decryptShare({ ...pinned.record, salt: null, iterations: null }, pinned.key), code('damaged'));
});

test('a ciphertext cannot be moved under another share id (AAD)', async () => {
  const a = await encryptShare(PASSPORT);
  const b = await encryptShare({ other: true });
  await assert.rejects(decryptShare(a.record, a.key, { id: b.id }), code('damaged'));
  await assert.rejects(decryptShare({ ...b.record, ciphertext: a.record.ciphertext, iv: a.record.iv }, a.key, { id: b.id }), code('damaged'));
});

test('fragment parsing', () => {
  const id = 'AAAAAAAAAAAAAAAAAAAAAA';
  const key = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  assert.deepEqual(parseShareFragment(`#${id}.${key}`), { id, key });
  assert.deepEqual(parseShareFragment(`${id}.${key}`), { id, key });
  assert.deepEqual(parseShareFragment(`https://x.example/share.html#${id}.${key}`), { id, key });
  assert.deepEqual(parseShareFragment(`#${id}.${key}.`), { id, key }, 'trailing full stop from a chat message');
  assert.deepEqual(parseShareFragment(`#${id}.${key})`), { id, key });
  assert.deepEqual(parseShareFragment(` #${id}.${key}\n`), { id, key });
  assert.equal(parseShareFragment(''), null);
  assert.equal(parseShareFragment('#'), null);
  assert.equal(parseShareFragment(undefined), null);
  assert.equal(parseShareFragment(`#${id}`), null, 'key missing');
  assert.equal(parseShareFragment(`#${id}.${key.slice(0, 40)}`), null, 'key cut short');
  assert.equal(parseShareFragment(`#${id}.${key}B`), null, 'key too long');
  assert.equal(parseShareFragment(`#${id.slice(1)}.${key}`), null, 'id too short');
  assert.equal(parseShareFragment(`#${id}+${key}`), null);
  assert.equal(parseShareFragment('#%E0%A4'), null, 'bad percent-encoding');
});

test('createShareLink uploads only the record; link round-trips; revoke sends the token', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: body.id, expiresAt: '2026-11-20T10:00:00+00:00', maxViews: body.maxViews, deleteToken: 'tok' }), { status: 201 });
    }
    if (init.method === 'DELETE') return new Response(JSON.stringify({ id: 'x', status: 'revoked' }), { status: 200 });
    return new Response(JSON.stringify({ detail: 'expired' }), { status: 410 });
  };
  const out = await createShareLink(PASSPORT, {
    pin: '2468', kind: 'passport', maxViews: 5, caseRef: 'case-1', iterations: 1000,
    api: '/api', base: 'https://dd.example/share.html', fetch: fakeFetch,
  });
  assert.equal(out.deleteToken, 'tok');
  assert.equal(out.expiresAt, '2026-11-20T10:00:00+00:00');
  assert.equal(calls[0].url, '/api/shares');
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(sent).sort(), ['caseRef', 'ciphertext', 'expiresDays', 'id', 'iterations', 'iv', 'kind', 'maxViews', 'salt']);
  assert.equal(sent.kind, 'passport');
  assert.ok(!calls[0].init.body.includes('Lakshmi') && !calls[0].init.body.includes('2468'));
  const parsed = parseShareFragment(new URL(out.url).hash);
  assert.equal(parsed.id, out.id);
  assert.ok(out.url.startsWith(`https://dd.example/share.html#${out.id}.`));
  assert.ok(!calls[0].init.body.includes(parsed.key), 'the key never leaves the browser');
  assert.deepEqual(await decryptShare(sent, parsed.key, { id: parsed.id, pin: '2468' }), PASSPORT);

  await revokeShare(out.id, 'tok', { fetch: fakeFetch });
  assert.equal(calls[1].init.method, 'DELETE');
  assert.equal(calls[1].url, `/api/shares/${out.id}`);
  assert.equal(calls[1].init.headers['X-Delete-Token'], 'tok');

  await assert.rejects(fetchShare(out.id, { fetch: fakeFetch }), (e) => e.code === 'gone' && e.reason === 'expired' && e.status === 410);
  await assert.rejects(fetchShare('nope', { fetch: fakeFetch }), code('bad_link'));
  await assert.rejects(createShareLink(PASSPORT, { kind: 'letter', fetch: fakeFetch }), code('bad_kind'));
  await assert.rejects(createShareLink(PASSPORT, { fetch: async () => { throw new TypeError('offline'); } }), code('network'));
  assert.equal(shareUrl('i', 'k', 'https://a/share.html#old'), 'https://a/share.html#i.k');
});

test('oversized documents are refused before upload', async () => {
  await assert.rejects(encryptShare({ blob: 'x'.repeat(70000) }), code('too_large'));
});

test('QR wrapper returns an SVG for a share link and fails soft', () => {
  const url = `https://dd.example/share.html#${'A'.repeat(22)}.${'B'.repeat(43)}`;
  const svg = qrSvg(url, { cellSize: 4, margin: 16 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  assert.equal((size - 32) % 4, 0);
  assert.ok((size - 32) / 4 >= 21, 'at least a version-1 symbol');
  assert.ok(svg.includes('<path d="M'));
  assert.equal(qrSvg(''), null);
  assert.equal(qrSvg(null), null);
  assert.equal(qrSvg('x'.repeat(5000)), null, 'too long for any QR code');
  assert.ok(qrSvg('தமிழ் · हिन्दी'), 'non-Latin text is encoded as UTF-8');
});
