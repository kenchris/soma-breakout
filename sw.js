// Service worker: makes the game installable and playable offline. Bump CACHE_VERSION whenever the file
// list below changes (a new js/*.js file added/removed) or you want to force clients to pick up new code —
// this is a static site with no build step, so this list is maintained by hand, same as the <script> tags
// in index.html.
const CACHE_VERSION = 'v17';
const CACHE_NAME = 'breakout-' + CACHE_VERSION;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './js/aliens.js',
    './js/asteroidsBoss.js',
    './js/audio.js',
    './js/boss.js',
    './js/chaos.js',
    './js/constants.js',
    './js/crates.js',
    './js/fx.js',
    './js/ghostRows.js',
    './js/guided.js',
    './js/input.js',
    './js/level.js',
    './js/main.js',
    './js/pongBoss.js',
    './js/portals.js',
    './js/powerups.js',
    './js/rally.js',
    './js/share.js',
    './js/snakeBoss.js',
    './js/sprites.js',
    './js/state.js',
    './js/ui.js',
    './js/warpRift.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Stale-while-revalidate: serve from cache instantly (so it works offline and loads fast), and refresh the
// cache from the network in the background so the next launch has whatever changed. Only same-origin GET
// requests are handled; everything else (e.g. a cross-origin request) just falls through to the network.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(req);
            const network = fetch(req).then((res) => {
                if (res.ok) cache.put(req, res.clone());
                return res;
            }).catch(() => cached); // offline and not cached: nothing more we can do
            return cached || network;
        })
    );
});
