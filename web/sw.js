// Offline cache for the web version. The build stamps VERSION, so each release gets a fresh cache
// and old ones are removed. The app is served cache-first; a new version is picked up on the next
// launch after it has been downloaded in the background.
const VERSION = '__VERSION__';
const CACHE = `oche-${VERSION}`;
const SHELL = [
  './', 'index.html', 'native.js', 'manifest.webmanifest', 'privacy.html',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'fonts/fonts.css',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Font files are listed in fonts.css; cache whichever it names
    const css = await (await cache.match('fonts/fonts.css')).text();
    const fonts = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => 'fonts/' + m[1]);
    await cache.addAll(fonts);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('index.html'));
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return hit || Response.error();
    }
  })());
});
