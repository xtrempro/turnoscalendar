// Service Worker del panel supervisor. Cachea el "shell" para reaperturas
// instantaneas y un offline basico. NO intercepta peticiones cross-origin
// (Firebase, Firestore, CDN del SDK, fuentes) para no interferir con la nube.

const CACHE = "proturnos-shell-v1";
const OFFLINE_URL = "/index.html";

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll([OFFLINE_URL, "/styles.css"]))
            .catch(() => {})
    );
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(key => key !== CACHE)
                .map(key => caches.delete(key))
        );
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Solo gestionamos peticiones del propio sitio.
    if (url.origin !== self.location.origin) return;

    // Navegaciones (index.html): red primero, con la copia cacheada como
    // respaldo offline. Asi un deploy nuevo siempre se toma estando online.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(response => {
                    caches.open(CACHE)
                        .then(cache => cache.put(OFFLINE_URL, response.clone()))
                        .catch(() => {});
                    return response;
                })
                .catch(() => caches.match(OFFLINE_URL))
        );
        return;
    }

    // Bundle con hash (inmutable): cache-first.
    if (url.pathname.startsWith("/assets/")) {
        event.respondWith(
            caches.match(request).then(cached =>
                cached ||
                fetch(request).then(response => {
                    const copy = response.clone();
                    caches.open(CACHE)
                        .then(cache => cache.put(request, copy))
                        .catch(() => {});
                    return response;
                })
            )
        );
        return;
    }

    // Resto (styles.css, img/, etc.): stale-while-revalidate.
    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE)
                        .then(cache => cache.put(request, copy))
                        .catch(() => {});
                    return response;
                })
                .catch(() => cached);

            return cached || network;
        })
    );
});
