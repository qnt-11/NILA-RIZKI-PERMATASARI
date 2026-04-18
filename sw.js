const CACHE_NAME = 'keuangan-nila-v4';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            })
        ))
    );
});

self.addEventListener('fetch', event => {
    // JANGAN cache link Google Script agar Cloud selalu fresh dan tidak error
    if (event.request.url.includes('script.google.com')) {
        return;
    }
    event.respondWith(
        caches.match(event.request).then(res => res || fetch(event.request))
    );
});
