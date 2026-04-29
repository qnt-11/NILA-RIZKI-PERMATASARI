/**
 * SERVICE WORKER uang famBARLA (ENTERPRISE SECURITY & SMART CACHE)
 * Versi 2.3 (PRO)
 * Optimasi: Anti-Quota Crash & Concurrency Lock CPU
 */

const APP_VERSION = '2.3'; 
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

// Anti-Race Condition Flag untuk mencegah CPU Spiking
let isCleaning = false;

const limitCacheSize = (name, size) => {
  if (isCleaning) return Promise.resolve(); // Jika sedang bersih-bersih, abaikan request baru
  isCleaning = true;
  
  return caches.open(name).then(cache => {
    return cache.keys().then(keys => {
      if (keys.length > size) {
        const keysToDelete = keys.slice(0, keys.length - size);
        return Promise.all(keysToDelete.map(key => cache.delete(key)));
      }
    });
  }).catch(err => {
    console.warn('Pembersihan cache dilewati:', err);
  }).finally(() => {
    isCleaning = false; // Buka kunci setelah selesai
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
                // Tangkap error jika storage benar-benar 0 Byte agar SW tidak crash
                return cache.put(asset, response).catch(() => {}); 
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
            console.log('Menghapus cache versi lama:', key);
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

  if (reqUrl.hostname.includes('script.google')) {
    event.respondWith(fetch(req));
    return;
  }

  const isHtmlRequest = req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
  const cacheKey = isHtmlRequest ? './index.html' : req;

  if (reqUrl.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        const fetchPromise = fetch(req).then(networkRes => {
          if (networkRes && networkRes.ok) {
            caches.open(CACHE_DYNAMIC).then(cache => {
              cache.put(req, networkRes.clone()).catch(() => {}); // Fallback memori penuh
              limitCacheSize(CACHE_DYNAMIC, 50); 
            });
          }
          return networkRes;
        }).catch(() => cachedRes);
        
        if (cachedRes) {
            event.waitUntil(fetchPromise);
        }
        
        return cachedRes || fetchPromise;
      })
    );
    return;
  }

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

  const isLocalStatic = staticAssets.some(asset => {
    if (asset.startsWith('http')) return false;
    if (asset === './') return isHtmlRequest;
    const assetUrl = new URL(asset, self.location.href);
    return reqUrl.pathname === assetUrl.pathname;
  });
  const isCDNStatic = staticAssets.some(asset => asset.startsWith('http') && reqUrl.href === asset);

  if (isHtmlRequest || isLocalStatic || isCDNStatic) {
    event.respondWith(
      caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
        return cachedResponse || fetch(req).then(networkResponse => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            caches.open(CACHE_STATIC).then(cache => {
              cache.put(cacheKey, networkResponse.clone()).catch(() => {});
            });
          }
          return networkResponse;
        }).catch(() => {
          if (isHtmlRequest) {
            return caches.match('./index.html').then(res => res || caches.match('./'));
          }
          return Response.error(); 
        });
      })
    );
  } else {
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
        }).catch(() => {
          if (isHtmlRequest) {
            return caches.match('./index.html').then(res => res || caches.match('./'));
          }
          return Response.error();
        });

        if (cachedResponse) {
          event.waitUntil(fetchPromise); 
          return cachedResponse; 
        }
        
        return fetchPromise;
      })
    );
  }
});
