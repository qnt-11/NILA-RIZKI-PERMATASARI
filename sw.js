/**
 * SERVICE WORKER uang famBARLA (ENTERPRISE SECURITY & SMART CACHE)
 * Versi 2.7 (PRO)
 */

const APP_VERSION = '2.7'; 
const CACHE_PREFIX = 'uang-fambarla-';
const CACHE_STATIC = CACHE_PREFIX + 'static-v' + APP_VERSION;
const CACHE_DYNAMIC = CACHE_PREFIX + 'dynamic-v' + APP_VERSION;

// Catatan: CSS Google Fonts dikeluarkan dari sini untuk menggunakan strategi Split Caching
const staticAssets = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// FUNGSI CERDAS: Pembersih Cache Dinamis (Self-Cleaning) agar memori HP tidak bengkak
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

// EVENT: Install PWA & Cache Aset Statis Inti secara individu (Anti-Gagal)
self.addEventListener('install', event => {
  self.skipWaiting(); // Memaksa SW baru untuk langsung mengambil alih
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.all(
        staticAssets.map(asset => {
          return fetch(asset)
            .then(response => {
              if (response.ok || response.type === 'opaque') {
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

// EVENT: Activate PWA & Hapus Versi Cache Lama
self.addEventListener('activate', event => {
  self.clients.claim(); 
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key.startsWith(CACHE_PREFIX) && key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
            console.log('Menghapus cache versi lama:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
});

// EVENT: Pesan dari Aplikasi (Fitur Hapus Semua Data)
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

// EVENT: Intersepsi Jaringan (The Brain of the Service Worker)
self.addEventListener('fetch', event => {
  let req = event.request;
  let reqUrl = new URL(req.url);

  // Abaikan request selain GET dan ekstensi non-HTTP
  if (req.method !== 'GET') return;
  if (!reqUrl.protocol.startsWith('http')) return;
  if (reqUrl.pathname.endsWith('sw.js')) return;

  // 1. BYPASS GOOGLE SHEETS API: Tidak pernah di-cache, selalu live!
  if (reqUrl.hostname.includes('script.google')) {
    event.respondWith(fetch(req));
    return;
  }

  // FIX BUG 3: Deteksi Halaman Utama (Index) yang lebih cerdas dan kebal sub-folder
  const isHtmlRequest = req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
  const cacheKey = isHtmlRequest ? './index.html' : req;

  // 2. SPLIT CACHING UNTUK GOOGLE FONTS (Super Stabil & Cepat)
  if (reqUrl.hostname === 'fonts.googleapis.com') {
    // File CSS Font: Stale-While-Revalidate (Tampil cepat dari cache, lalu diperbarui diam-diam)
    event.respondWith(
      caches.match(req).then(cachedRes => {
        const fetchPromise = fetch(req).then(networkRes => {
          if (networkRes && networkRes.ok) {
            caches.open(CACHE_DYNAMIC).then(cache => {
              cache.put(req, networkRes.clone());
              limitCacheSize(CACHE_DYNAMIC, 50); // Batasi maks 50 file
            });
          }
          return networkRes;
        }).catch(() => cachedRes);
        
        // FIX BUG 2: Melindungi proses update background agar tidak dimatikan browser
        if (cachedRes) {
            event.waitUntil(fetchPromise);
        }
        
        return cachedRes || fetchPromise;
      })
    );
    return;
  }

  if (reqUrl.hostname === 'fonts.gstatic.com') {
    // File Fisik Font (.woff2): Cache-First (Sangat stabil, simpan permanen)
    event.respondWith(
      caches.match(req).then(cachedRes => {
        return cachedRes || fetch(req).then(networkRes => {
          if (networkRes && networkRes.ok) {
            caches.open(CACHE_STATIC).then(cache => cache.put(req, networkRes.clone()));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 3. PENCOCOKAN ASET STATIS vs DINAMIS UMUM
  // FIX BUG 1: Menggunakan self.location.href agar aman jika diletakkan di Sub-Folder hosting
  const isLocalStatic = staticAssets.some(asset => {
    if (asset.startsWith('http')) return false;
    if (asset === './') return isHtmlRequest;
    const assetUrl = new URL(asset, self.location.href);
    return reqUrl.pathname === assetUrl.pathname;
  });
  const isCDNStatic = staticAssets.some(asset => asset.startsWith('http') && reqUrl.href === asset);

  if (isHtmlRequest || isLocalStatic || isCDNStatic) {
    // STRATEGI CACHE-FIRST: Mengunci aset inti (JS, HTML, Icon, Chart.js, XLSX)
    event.respondWith(
      caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
        return cachedResponse || fetch(req).then(networkResponse => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, networkResponse.clone()));
          }
          return networkResponse;
        }).catch(() => {
          // Jika offline dan mencari halaman, kembalikan ke index html
          if (isHtmlRequest) {
            return caches.match('./index.html');
          }
          return Response.error(); // SW tidak crash jika gagal tarik gambar dll saat offline
        });
      })
    );
  } else {
    // STRATEGI STALE-WHILE-REVALIDATE: Untuk request dinamis lainnya
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cachedResponse => {
        const fetchPromise = fetch(req).then(networkResponse => {
          // Tolak Opaque Response pada dinamis agar RAM tidak bocor
          if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
            caches.open(CACHE_DYNAMIC).then(cache => {
              cache.put(req, networkResponse.clone());
              limitCacheSize(CACHE_DYNAMIC, 60); 
            });
          }
          return networkResponse;
        }).catch(() => {
          if (isHtmlRequest) {
            return caches.match('./index.html');
          }
          return Response.error();
        });

        if (cachedResponse) {
          event.waitUntil(fetchPromise); // Jalankan update di background secara aman
          return cachedResponse; // Langsung tampilkan cache instan
        }
        
        return fetchPromise;
      })
    );
  }
});
