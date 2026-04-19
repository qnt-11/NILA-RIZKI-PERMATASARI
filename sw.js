/**
 * SERVICE WORKER keuanganNila (VERSI FINAL ABSOLUT + BUGFIX RUNTIME)
 * Fitur: Cache Splitting, True Stale-While-Revalidate, Safe Offline Fallback, Background Lock.
 */

// =========================================================
// ⚠️ PENTING: GANTI ANGKA INI SETIAP ADA UPDATE DI INDEX.HTML
// =========================================================
const APP_VERSION = '3.0'; 

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

// 1. INSTALASI & SKIP WAITING
self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then(cache => cache.addAll(staticAssets)),
      caches.open(CACHE_DYNAMIC).then(cache => cache.addAll(dynamicAssets))
    ])
  );
});

// 2. AKTIVASI & AUTO-CLEANUP
self.addEventListener('activate', event => {
  self.clients.claim(); 
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
            console.log('[Service Worker] Menghapus Cache Lama:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
});

// 3. SMART FETCHING & ROUTING
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // A. JALUR EVAKUASI SW.JS (Tidak Boleh Masuk Cache)
  if (requestUrl.pathname.endsWith('sw.js')) return;

  // B. JALUR KHUSUS GOOGLE SHEETS (Network Only, No Cache)
  if (requestUrl.hostname === 'script.google.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // C. BRANKAS STATIS (Cache First untuk Library & Font)
  if (staticAssets.some(url => event.request.url.includes(url)) || requestUrl.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        return cachedResponse || fetch(event.request).then(networkResponse => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // D. BRANKAS DINAMIS (True Stale-While-Revalidate)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      
      // Proses download update di background
      const networkFetch = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_DYNAMIC).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // PERBAIKAN LOGIKA 1: OFFLINE FALLBACK AMAN
        // Hanya kembalikan index.html jika user sedang me-request halaman (navigasi)
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });

      // PERBAIKAN LOGIKA 2: KUNCI BACKGROUND PROCESS
      if (cachedResponse) {
        // Jangan biarkan browser membunuh SW sebelum networkFetch (download update) selesai!
        event.waitUntil(networkFetch); 
        return cachedResponse; // Tampilkan tampilan lama dengan cepat
      }

      // Jika cache kosong sama sekali, tunggu hasil download network
      return networkFetch; 
    })
  );
});
