// Offline shell: the field app must open in a village with no signal.
// API calls are never cached (cases queue in IndexedDB instead).
const CACHE = 'dd-shell-v8';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon.svg',
  'js/app.js', 'js/icons.js', 'js/remote.js', 'js/account.js', 'js/tryon.js', 'js/call.js', 'display.html', 'js/display.js', 'fonts/Geist-Variable.woff2', 'fonts/PlusJakartaSans-Variable.woff2', 'fonts/DMSerifDisplay-Regular.woff2', 'js/charts_ui.js', 'fonts/GeistMono-Variable.woff2', 'js/i18n.js', 'js/voice.js', 'js/store.js', 'js/passport.js', 'js/profile_view.js', 'js/crypto.js', 'js/tests_ui.js',
  'js/share.js', 'js/qr.js', 'vendor/qrcode-generator.js', 'share.html', 'js/share_view.js', 'lensometer-target.html', 'js/lensometer_target.js',
  'js/lang/index.js', 'js/lang/hi.js', 'js/lang/ta.js', 'js/lang/te.js', 'js/lang/mr.js', 'js/lang/kn.js', 'js/lang/bn.js',
  'js/engine/adaptive.js', 'js/engine/questions.js', 'js/engine/profile.js', 'js/engine/redflags.js', 'js/engine/parse.js', 'js/engine/rx.js', 'js/engine/personas.js',
  'js/measure/geometry.js', 'js/measure/acuity.js', 'js/measure/face.js', 'js/measure/contrast.js', 'js/measure/plates.js', 'js/measure/charts.js', 'js/measure/lensometer.js',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  // network first so updates reach the phone, cache as the offline fallback
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && (url.origin === location.origin || url.hostname.endsWith('jsdelivr.net') || url.hostname.endsWith('googleapis.com'))) {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return r;
  }).catch(() => caches.match(e.request)));
});
