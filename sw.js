// Service worker: makes the game installable and playable offline. Bump CACHE_VERSION whenever the file
// list below changes (a new js/*.js file added/removed); code changes reach players on their next load
// anyway (see the network-first fetch handler below). This is a static site with no build step, so this
// list is maintained by hand, same as the <script> tags in index.html.
const CACHE_VERSION = 'v36';
const CACHE_NAME = 'breakout-' + CACHE_VERSION;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './js/aliens.js',
    './js/assist.js',
    './js/asteroidsBoss.js',
    './js/audio.js',
    './js/boss.js',
    './js/bumpers.js',
    './js/chaos.js',
    './js/colourChain.js',
    './js/constants.js',
    './js/crates.js',
    './js/fx.js',
    './js/ghostRows.js',
    './js/guided.js',
    './js/input.js',
    './js/kongBoss.js',
    './js/level.js',
    './js/main.js',
    './js/music.js',
    './js/physics.js',
    './js/pongBoss.js',
    './js/portals.js',
    './js/powerups.js',
    './js/rally.js',
    './js/share.js',
    './js/snakeBoss.js',
    './js/spaceChomp.js',
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

// Network-first: online, every load gets the latest files, revalidated against the server so neither this
// cache nor the browser's HTTP cache can hand back a stale script; offline, the cached copy. Each successful
// fetch refreshes the cache for the next offline launch. (Stale-while-revalidate, used before, always
// served the previous version and only picked changes up on the load after.) Only same-origin GET requests
// are handled; everything else (e.g. a cross-origin request) just falls through to the network.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    // Every page load (?level=N, a shared ?code=XXXX link, ...) is the same page: cache it under one key, so
    // an offline launch from any link finds it, and each new link doesn't add another copy
    const key = req.mode === 'navigate' ? './index.html' : req;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            const res = await fetch(req, { cache: 'no-cache' });
            if (res.ok) cache.put(key, res.clone());
            return res;
        } catch (e) {
            return (await cache.match(key)) || Response.error(); // offline and never cached: nothing to give
        }
    })());
});
