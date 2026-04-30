/**
 * SERVICE WORKER uang famBARLA (ENTERPRISE SECURITY & SMART CACHE)
 * Versi 2.7 (EXTREME PRO - PATCHED)
 * Optimasi: Network-First HTML, Safe Cache Limit, & Background Sync Prep
 */

const APP_VERSION = '2.7'; 
const CACHE_PREFIX = 'uang-fambarla-';
const CACHE_STATIC = CACHE_PREFIX + 'static-v' + APP_VERSION;
const CACHE_DYNAMIC = CACHE_PREFIX + 'dynamic-v' + APP_VERSION;

const staticAssets = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

let isCleaning = false;

const limitCacheSize = (name, size) => {
  if (isCleaning) return Promise.resolve(); 
  isCleaning = true;
  
  return caches.open(name).then(cache => {
    return cache.keys().then(keys => {
      if (keys.length > size) {
        const keysToDelete = keys.slice(0, keys.length - size);
        return Promise.all(keysToDelete.map(key => cache.delete(key)));
      }
    });
  }).catch(err => {
    console.warn('[SW] Pembersihan cache dilewati:', err);
  }).finally(() => {
    isCleaning = false; 
  });
};

self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.all(
        staticAssets.map(asset => {
          return fetch(asset)
            .then(response => {
              if (response.ok || response.type === 'opaque') {
                return cache.put(asset, response).catch(() => {}); 
              }
            })
            .catch(error => {
              console.warn('[SW] Lewati cache sementara (offline/CDN down):', asset);
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
            console.log('[SW] Menghapus cache versi lama:', key);
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

// =========================================================
// BACKGROUND SYNC API (EXTREME PHASE 2 PREP)
// =========================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-cloud-upload') {
    console.log('[SW] Sinyal internet terdeteksi. Memulai Background Sync ke Cloud...');
    event.waitUntil(prosesUploadTertunda());
  }
});

async function prosesUploadTertunda() {
  try {
    // Catatan Arsitek: Implementasi baca IndexedDB -> Fetch ke GAS -> Hapus antrean
    console.log('[SW] Proses Background Sync selesai (Placeholder).');
  } catch (error) {
    console.error('[SW] Background Sync gagal, browser akan retry:', error);
    throw error;
  }
}

// =========================================================
// INTERCEPTOR JARINGAN & CACHE STRATEGY TERPISAH
// =========================================================
self.addEventListener('fetch', event => {
  let req = event.request;
  let reqUrl = new URL(req.url);

  if (req.method !== 'GET') return;
  if (!reqUrl.protocol.startsWith('http')) return;
  if (reqUrl.pathname.endsWith('sw.js')) return;

  // Bebaskan Google Script (API) dari Cache
  if (reqUrl.hostname.includes('script.google')) {
    event.respondWith(fetch(req));
    return;
  }

  const isHtmlRequest = req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
  const cacheKey = isHtmlRequest ? './index.html' : req;

  // 1. STRATEGI NETWORK-FIRST UNTUK HTML (Mencegah Zombie App saat Hotfix)
  if (isHtmlRequest) {
    event.respondWith(
      fetch(req).then(networkResponse => {
        if (networkResponse && networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, clone));
        }
        return networkResponse;
      }).catch(() => {
        // Fallback ke Cache jika Offline
        return caches.match(cacheKey).then(cachedRes => cachedRes || caches.match('./'));
      })
    );
    return;
  }

  // 2. STRATEGI STALE-WHILE-REVALIDATE UNTUK GOOGLE FONTS (CSS)
  if (reqUrl.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        const fetchPromise = fetch(req).then(networkRes => {
          if (networkRes && networkRes.ok) {
            caches.open(CACHE_DYNAMIC).then(cache => {
              cache.put(req, networkRes.clone()).catch(() => {}); 
              // FIX: Penambahan waitUntil agar SW tidak dibunuh browser saat membersihkan memori
              event.waitUntil(limitCacheSize(CACHE_DYNAMIC, 50)); 
            });
          }
          return networkRes;
        }).catch(() => cachedRes);
        
        if (cachedRes) event.waitUntil(fetchPromise);
        return cachedRes || fetchPromise;
      })
    );
    return;
  }

  // 3. STRATEGI CACHE-FIRST UNTUK GOOGLE FONTS (WOFF2)
  if (reqUrl.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        return cachedRes || fetch(req).then(networkRes => {
          if (networkRes && networkRes.ok) {
            caches.open(CACHE_STATIC).then(cache => {
              cache.put(req, networkRes.clone()).catch(() => {});
            });
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 4. STRATEGI CACHE-FIRST UNTUK ASET STATIS LOKAL & CDN
  const isLocalStatic = staticAssets.some(asset => {
    if (asset.startsWith('http')) return false;
    const assetUrl = new URL(asset, self.location.href);
    return reqUrl.pathname === assetUrl.pathname;
  });
  const isCDNStatic = staticAssets.some(asset => asset.startsWith('http') && reqUrl.href === asset);

  if (isLocalStatic || isCDNStatic) {
    event.respondWith(
      caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
        return cachedResponse || fetch(req).then(networkResponse => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            caches.open(CACHE_STATIC).then(cache => {
              cache.put(cacheKey, networkResponse.clone()).catch(() => {});
            });
          }
          return networkResponse;
        }).catch(() => Response.error());
      })
    );
  } else {
    // 5. STRATEGI STALE-WHILE-REVALIDATE UNTUK REQUEST DINAMIS LAINNYA
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cachedResponse => {
        const fetchPromise = fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
            caches.open(CACHE_DYNAMIC).then(cache => {
              cache.put(req, networkResponse.clone()).catch(() => {});
              event.waitUntil(limitCacheSize(CACHE_DYNAMIC, 60)); 
            });
          }
          return networkResponse;
        }).catch(() => Response.error());

        if (cachedResponse) {
          event.waitUntil(fetchPromise); 
          return cachedResponse; 
        }
        
        return fetchPromise;
      })
    );
  }
});
