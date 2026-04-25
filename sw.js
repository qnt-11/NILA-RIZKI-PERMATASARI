/**
 * SERVICE WORKER uang famBARLA (ENTERPRISE SECURITY & CACHE LIMIT)
 * Versi 1.1 (PRO)
 */

const APP_VERSION = '1.1'; 
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

// FIX BUG: Batch Delete agar tidak looping berlebihan (Ramah Baterai & CPU)
const limitCacheSize = (name, size) => {
  caches.open(name).then(cache => {
    cache.keys().then(keys => {
      if (keys.length > size) {
        const keysToDelete = keys.slice(0, keys.length - size);
        Promise.all(keysToDelete.map(key => cache.delete(key)));
      }
    });
  });
};

self.addEventListener('install', event => {
  self.skipWaiting(); 
  // FIX BUG: Ubah All-or-Nothing menjadi Individual Caching agar PWA kebal jika CDN down
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.all(
        staticAssets.map(asset => {
          return fetch(asset)
            .then(response => {
              if (response.ok) {
                return cache.put(asset, response);
              }
            })
            .catch(error => {
              console.warn('Lewati cache sementara (offline/CDN down):', asset);
            });
        })
      );
    })
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

  // FIX BUG: Bypass Google Sheets mencakup script.googleusercontent.com
  if (reqUrl.hostname.includes('script.google')) {
    event.respondWith(fetch(req));
    return;
  }

  // FIX BUG: Normalisasi request ke root / menjadi index.html (Aman untuk GitHub Pages)
  const isIndex = reqUrl.pathname.endsWith('/') || reqUrl.pathname.endsWith('/index.html');
  const cacheKey = isIndex ? new Request('./index.html') : req;

  event.respondWith(
    caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
      
      // FIX BUG: Pencocokan string presisi (menggunakan pathname utuh) untuk file statis
      const isLocalStatic = staticAssets.some(asset => {
        if (asset.startsWith('http')) return false;
        const assetUrl = new URL(asset, self.location.origin);
        return reqUrl.pathname === assetUrl.pathname;
      });
      const isCDNStatic = staticAssets.some(asset => asset.startsWith('http') && reqUrl.href === asset);
      
      // FIX BUG: Masukkan font .woff2 dari gstatic ke dalam cache statis
      const isGstaticFont = reqUrl.hostname === 'fonts.gstatic.com';
      
      const isStatic = isIndex || isLocalStatic || isCDNStatic || isGstaticFont;

      if (isStatic) {
        // STRATEGI CACHE-FIRST
        return cachedResponse || fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, networkResponse.clone()));
          }
          return networkResponse;
        }).catch(() => {
          if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
          // FIX BUG: Mengembalikan error resmi agar SW tidak crash saat offline merequest gambar/api
          return Response.error();
        });
      } else {
        // STRATEGI STALE-WHILE-REVALIDATE
        const fetchPromise = fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok && !networkResponse.redirected && networkResponse.type !== 'opaque') {
            caches.open(CACHE_DYNAMIC).then(cache => {
              cache.put(req, networkResponse.clone());
              limitCacheSize(CACHE_DYNAMIC, 60); 
            });
          }
          return networkResponse;
        }).catch(() => {
          if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
          // FIX BUG: Mengembalikan error resmi agar SW tidak crash
          return Response.error(); 
        });

        // FIX BUG: Tampilkan cache jika ada, JALANKAN update di latar belakang TANPA dibunuh browser
        if (cachedResponse) {
          event.waitUntil(fetchPromise);
          return cachedResponse;
        }
        
        return fetchPromise;
      }
    })
  );
});
