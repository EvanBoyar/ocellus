// Offline cache for the app shell. Bump the version whenever any
// shipped file changes so clients pick up updates.
const CACHE = 'ocellus-v0.0.10';

const SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'js/app.js',
  'js/version.js',
  'js/storage.js',
  'js/vendor/jsQR.js',
  'js/vendor/qrcode.mjs',
  'js/model/codec.js',
  'js/model/crypt.js',
  'js/model/election.js',
  'js/model/ballotid.js',
  'js/model/star.js',
  'js/model/records.js',
  'js/model/eic.js',
  'js/model/share.js',
  'js/model/layout.js',
  'js/model/render.js',
  'js/scan/homography.js',
  'js/scan/detect.js',
  'js/scan/camera.js',
  'js/ui/dom.js',
  'js/ui/home.js',
  'js/ui/design.js',
  'js/ui/ballots.js',
  'js/ui/scan.js',
  'js/ui/results.js',
  'js/ui/help.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(
      (hit) => hit || fetch(event.request),
    ),
  );
});
