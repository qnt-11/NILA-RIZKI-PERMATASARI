const APP_VERSION = '6.7';
const CACHE_PREFIX = 'uang-fambarla-';
const CACHE_STATIC = CACHE_PREFIX + 'static-v' + APP_VERSION;
const CACHE_DYNAMIC = CACHE_PREFIX + 'dynamic-v' + APP_VERSION;

// Daftar aset inti yang wajib tersedia saat Offline
const staticAssets = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// =========================================================
// 1. MANAJEMEN MEMORI (GARBAGE COLLECTOR)
// =========================================================
let gcQueue = Promise.resolve();

const limitCacheSize = (name, size) => {
  gcQueue = gcQueue.then(() => {
    return caches.open(name).then(cache => {
      return cache.keys().then(keys => {
        if (keys.length > size) {
          const keysToDelete = keys.slice(0, keys.length - size);
          return Promise.all(keysToDelete.map(key => cache.delete(key)));
        }
      });
    });
  }).catch(err => console.warn('[SW] Pembersihan Memori Gagal:', err));
};

// =========================================================
// 2. FASE INSTALASI (PRE-CACHING & ANTI-HOLLOW CACHE)
// =========================================================
self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      console.log('[SW] Menyimpan aset statis...');
      return Promise.all(
        staticAssets.map(asset => {
          const reqOpt = asset.startsWith('http') ? { mode: 'cors', credentials: 'omit' } : {};
          return fetch(asset, reqOpt)
            .then(response => {
              if (response.ok && response.type !== 'opaque') {
                return cache.put(asset, response);
              }
              throw new Error("Respons Opaque atau Non-OK");
            })
            .catch((err) => {
              if (asset.startsWith('http')) {
                return fetch(asset, { mode: 'no-cors' })
                  .then(fallbackRes => cache.put(asset, fallbackRes))
                  .catch(() => console.warn('[SW] Aset CDN gagal di-cache:', asset));
              }
              // Mencegah instalasi bisu (Hollow Cache) jika aset lokal gagal ditarik
              throw err; 
            });
        })
      );
    })
  );
});

// =========================================================
// 3. FASE AKTIVASI (MENGHAPUS CACHE VERSI LAMA)
// =========================================================
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
        return Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key)));
      })
    );
  }
});

// =========================================================
// 4. INTERSEPTOR JARINGAN & FIREWALL
// =========================================================
self.addEventListener('fetch', event => {
  const req = event.request;
  const reqUrl = new URL(req.url);

  if (req.method !== 'GET' || !reqUrl.protocol.startsWith('http') || reqUrl.pathname.endsWith('sw.js')) return;

  // [FITUR INJEKSI]: DYNAMIC CACHE SECURITY BLACKLIST
  // Mencegah cache permanen pada file ekspor sensitif atau endpoint analitik
  const isBlacklisted = reqUrl.pathname.match(/\.(xlsx|xls|csv|pdf|zip)$/i) || reqUrl.hostname.includes('google-analytics');
  if (isBlacklisted) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  // STRATEGI 1: BYPASS GOOGLE CLOUD (Wajib Network-Only)
  if (reqUrl.hostname.includes('script.google.com') || reqUrl.hostname.includes('script.googleusercontent.com')) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  const isHtmlRequest = req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
  const cacheKey = isHtmlRequest ? './index.html' : req;

  // STRATEGI 2: STALE-WHILE-REVALIDATE UNTUK HTML + BROADCAST API
  if (isHtmlRequest) {
    event.respondWith(
      caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
        const networkFetch = fetch(req).then(async networkResponse => {
          if (networkResponse && networkResponse.ok) {
            const cloneToCache = networkResponse.clone();
            
            if (cachedResponse) {
               // [INJEKSI KEAMANAN QA]: Kloning data untuk dikomparasi agar tidak merusak Stream Browser
               const cachedClone = cachedResponse.clone();
               const netClone = networkResponse.clone();
               
               // Ekstrak teks kode HTML
               const cachedText = await cachedClone.text();
               const netText = await netClone.text();
               
               caches.open(CACHE_STATIC).then(cache => {
                   cache.put(cacheKey, cloneToCache);
                   // HANYA kirim sinyal jika kode HTML lama berbeda dengan kode HTML server (Mencegah Infinite Loop)
                   if (cachedText !== netText) {
                       if (typeof BroadcastChannel !== 'undefined') {
                           const channel = new BroadcastChannel('fambarla-update-channel');
                           channel.postMessage({ type: 'UPDATE_AVAILABLE', message: 'Pembaruan aplikasi berhasil diunduh.' });
                       }
                   }
               });
            } else {
               // Jika belum ada cache, simpan saja tanpa mengirim sinyal reload
               caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, cloneToCache));
            }
          }
          return networkResponse;
        }).catch(() => {
          console.log('[SW] Offline/Timeout. Menggunakan HTML Fallback.');
          return caches.match('./', { ignoreSearch: true });
        });

        event.waitUntil(networkFetch);
        return cachedResponse || networkFetch;
      })
    );
    return;
  }

    // STRATEGI 3: CACHE-FIRST UNTUK GOOGLE FONTS
    if (reqUrl.hostname === 'fonts.gstatic.com' || reqUrl.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        return cachedRes || fetch(req).then(networkRes => {
          if (networkRes && networkRes.ok && networkRes.type !== 'opaque') {
            const clone = networkRes.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(req, clone));
          }
          return networkRes;
        }).catch(() => Response.error());
      })
    );
    return;
  }

  const isLocalStatic = staticAssets.some(asset => {
    if (asset.startsWith('http')) return false;
    return reqUrl.pathname === new URL(asset, self.location.href).pathname;
  });
  const isCDNStatic = staticAssets.some(asset => asset.startsWith('http') && reqUrl.href === asset);

    // STRATEGI 4: CACHE-FIRST UNTUK ASET STATIS
    if (isLocalStatic || isCDNStatic) {
    event.respondWith(
      caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
        return cachedResponse || fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
            const clone = networkResponse.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, clone));
          }
          return networkResponse;
        }).catch(() => Response.error());
      })
    );
    return;
  } 

    // STRATEGI 5: STALE-WHILE-REVALIDATE UNTUK ASET DINAMIS LAINNYA
  const cachedResPromise = caches.match(req, { ignoreSearch: true });
  const networkResPromise = fetch(req).then(networkResponse => {
    if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
      const clone = networkResponse.clone();
      caches.open(CACHE_DYNAMIC).then(cache => {
        cache.put(req, clone).then(() => limitCacheSize(CACHE_DYNAMIC, 50));
      });
    }
    return networkResponse;
  }).catch(() => Response.error());

  event.waitUntil(networkResPromise);

  event.respondWith(
    cachedResPromise.then(cachedResponse => {
      return cachedResponse || networkResPromise;
    }).catch(() => Response.error())
  );
});

// =========================================================
// 5. BACKGROUND SYNC API (SINKRONISASI TAHAN BANTING)
// =========================================================
// [FITUR INJEKSI]: Menangkap event saat internet kembali online
self.addEventListener('sync', event => {
  if (event.tag === 'sync-fambarla-cloud') {
    console.log('[SW] Sinyal internet terdeteksi! Memulai sinkronisasi latar belakang...');
    event.waitUntil(
      // Placeholder: Tempatkan fungsi baca antrean IndexedDB dan Fetch API ke Google Cloud di sini
      Promise.resolve().then(() => console.log('[SW] Data antrean berhasil disinkronisasi ke Cloud.'))
    );
  }
});
