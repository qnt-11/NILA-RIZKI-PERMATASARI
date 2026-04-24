/**
 * SERVICE WORKER uang famBARLA (ENTERPRISE SECURITY & CACHE LIMIT)
 * Versi 1.01 (PRO)
 */

const APP_VERSION = '1.01'; 
const CACHE_PREFIX = 'uang-fambarla-';
const CACHE_STATIC = CACHE_PREFIX + 'static-v' + APP_VERSION;
const CACHE_DYNAMIC = CACHE_PREFIX + 'dynamic-v' + APP_VERSION;

const staticAssets = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Audiowide&family=Montserrat:wght@400;500;600;700&family=Poppins:wght@700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

const limitCacheSize = (name, size) => {
  caches.open(name).then(cache => {
    cache.keys().then(keys => {
      if (keys.length > size) {
        cache.delete(keys[0]).then(() => limitCacheSize(name, size));
      }
    });
  });
};

self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => cache.addAll(staticAssets))
  );
});

self.addEventListener('activate', event => {
  self.clients.claim(); 
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key.startsWith(CACHE_PREFIX) && key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.action === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(
          keys.filter(key => key.startsWith(CACHE_PREFIX))
              .map(key => caches.delete(key))
        );
      })
    );
  }
});

self.addEventListener('fetch', event => {
  let req = event.request;
  let reqUrl = new URL(req.url);

  if (req.method !== 'GET') return;
  if (!reqUrl.protocol.startsWith('http')) return;
  if (reqUrl.pathname.endsWith('sw.js')) return;

  // Bypass Google Sheets (Harus selalu langsung ke internet)
  if (reqUrl.hostname === 'script.google.com') {
    event.respondWith(fetch(req));
    return;
  }

  // Normalisasi request ke root / menjadi index.html
  const isIndex = reqUrl.pathname === '/' || reqUrl.pathname === '/index.html';
  const cacheKey = isIndex ? './index.html' : req;

  event.respondWith(
    caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
      // Cek apakah file ini termasuk file statis bawaan aplikasi
      const isStatic = isIndex || staticAssets.some(asset => reqUrl.href.includes(asset.replace('./', '')));

      if (isStatic) {
        // STRATEGI CACHE-FIRST: Hemat kuota, ambil dari cache dulu. Fetch hanya jika gagal.
        return cachedResponse || fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, networkResponse.clone()));
          }
          return networkResponse;
        }).catch(() => {
          // Fallback offline untuk file statis untuk mencegah error layar putih
          if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      } else {
        // STRATEGI STALE-WHILE-REVALIDATE: Untuk file dinamis di luar bawaan aplikasi
        const fetchPromise = fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok && !networkResponse.redirected && networkResponse.type !== 'opaque') {
            caches.open(CACHE_DYNAMIC).then(cache => {
              cache.put(req, networkResponse.clone());
              limitCacheSize(CACHE_DYNAMIC, 60); 
            });
          }
          return networkResponse;
        }).catch(() => {
          // Fallback offline untuk file dinamis
          if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });

        return cachedResponse || fetchPromise;
      }
    })
  );
});
