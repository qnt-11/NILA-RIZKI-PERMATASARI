/**
 * SERVICE WORKER keuanganNila (FINAL ABSOLUT + NETWORK SECURITY BUGFIX)
 */

const APP_VERSION = '4.0'; 

const CACHE_STATIC = 'keuangannila-static-v' + APP_VERSION;
const CACHE_DYNAMIC = 'keuangannila-dynamic-v' + APP_VERSION;

const staticAssets = [
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Pacifico&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

const dynamicAssets = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then(cache => cache.addAll(staticAssets)),
      caches.open(CACHE_DYNAMIC).then(cache => cache.addAll(dynamicAssets))
    ])
  );
});

self.addEventListener('activate', event => {
  self.clients.claim(); 
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_STATIC && key !== CACHE_DYNAMIC) return caches.delete(key);
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // ========================================================
  // A. FILTER KEAMANAN JARINGAN (ANTI-CRASH & BOM WAKTU)
  // ========================================================
  if (requestUrl.pathname.endsWith('sw.js')) return;
  if (event.request.method !== 'GET') return;
  if (!requestUrl.protocol.startsWith('http')) return;

  // B. JALUR KHUSUS GOOGLE SHEETS
  if (requestUrl.hostname === 'script.google.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // C. BRANKAS STATIS (Cache First)
  if (staticAssets.some(url => event.request.url.includes(url)) || requestUrl.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
        return cachedResponse || fetch(event.request).then(networkResponse => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
            caches.open(CACHE_STATIC).then(cache => cache.put(event.request, networkResponse.clone()));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // D. BRANKAS DINAMIS (True Stale-While-Revalidate)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
      const networkFetch = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_DYNAMIC).then(cache => cache.put(event.request.url.split('?')[0], responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html', { ignoreSearch: true });
      });

      if (cachedResponse) {
        event.waitUntil(networkFetch); 
        return cachedResponse; 
      }
      return networkFetch; 
    })
  );
});
