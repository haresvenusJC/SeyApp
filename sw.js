// Service Worker básico para PWA - Control de Auditoría Sey
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Permite que la app maneje las solicitudes de red normalmente hacia Supabase y el hosting
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});