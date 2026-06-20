importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

const CACHE_NAME = 'pwp-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(STATIC_ASSETS.map(function(url) {
        return fetch(url, { cache: 'reload' }).then(function(resp) {
          return cache.put(url, resp);
        });
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Apakah request ini kode aplikasi (HTML/JS/CSS/manifest atau navigasi)?
// Kode app pakai NETWORK-FIRST supaya update langsung sampai ke device tanpa
// perlu clear cache; aset lain (gambar/icon) tetap CACHE-FIRST biar cepat.
function isAppCode(req) {
  if (req.mode === 'navigate') return true;
  return /\.(?:js|css|html)$|\/manifest\.json$/.test(new URL(req.url).pathname);
}

self.addEventListener('fetch', function(e) {
  var req = e.request;

  // GAS API — selalu live, jangan disentuh SW
  if (req.url.includes('script.google.com')) return;

  if (isAppCode(req)) {
    // NETWORK-FIRST: ambil versi terbaru, simpan ke cache; offline → fallback cache
    e.respondWith(
      fetch(req).then(function(resp) {
        if (resp && resp.ok) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(req, clone); });
        }
        return resp;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
    );
    return;
  }

  // CACHE-FIRST untuk aset statis (gambar, icon, dll)
  e.respondWith(
    caches.match(req).then(function(cached) {
      return cached || fetch(req).then(function(resp) {
        if (resp && resp.ok && req.method === 'GET') {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(req, clone); });
        }
        return resp;
      });
    })
  );
});
