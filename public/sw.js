const CACHE = 'joshs-health-v4';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'sw-updated' })))
  );
});

self.addEventListener('fetch', e => {
  // Never intercept API calls or navigation — always go to network
  if (e.request.url.includes('/api/') || e.request.mode === 'navigate') return;
});
