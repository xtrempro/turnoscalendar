// Service Worker del panel supervisor. Cachea el "shell" para reaperturas
// instantaneas y un offline basico. NO intercepta peticiones cross-origin
// (Firebase, Firestore, CDN del SDK, fuentes) para no interferir con la nube.

const CACHE = "proturnos-shell-v3";
const OFFLINE_URL = "/index.html";
const APP_SHELL = [
    OFFLINE_URL,
    "/styles.css",
    "/manifest.webmanifest",
    "/img/pwa/icon-192.png",
    "/img/pwa/icon-512.png"
];

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(APP_SHELL))
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
                    if (response.ok) {
                        caches.open(CACHE)
                            .then(cache => cache.put(OFFLINE_URL, response.clone()))
                            .catch(() => {});
                    }
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
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE)
                            .then(cache => cache.put(request, copy))
                            .catch(() => {});
                    }
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
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE)
                            .then(cache => cache.put(request, copy))
                            .catch(() => {});
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || network;
        })
    );
});

function parsePushPayload(event) {
    if (!event.data) return {};

    try {
        return event.data.json();
    } catch {
        try {
            return JSON.parse(event.data.text() || "{}");
        } catch {
            return {};
        }
    }
}

function notificationDataFromPayload(payload = {}) {
    return {
        ...(payload.data || {}),
        ...(payload.notification?.data || {}),
        ...(payload.webpush?.notification?.data || {})
    };
}

self.addEventListener("push", event => {
    const payload = parsePushPayload(event);
    const data = notificationDataFromPayload(payload);
    const notification =
        payload.notification ||
        payload.webpush?.notification ||
        {};
    const title =
        data.title ||
        notification.title ||
        "TurnoPlus";
    const body =
        data.body ||
        notification.body ||
        "Tienes una nueva notificaci\u00f3n.";
    const vibrate = data.vibrate === "true"
        ? [320, 120, 320, 120, 220]
        : undefined;

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: data.icon || notification.icon || "/img/pwa/icon-192.png",
            badge: data.badge || notification.badge || "/img/pwa/icon-192.png",
            tag: data.tag || notification.tag || data.eventId || "turnoplus",
            renotify: true,
            requireInteraction:
                data.requireInteraction === "true" ||
                notification.requireInteraction === true,
            vibrate,
            data: {
                ...data,
                url:
                    data.url ||
                    payload.fcmOptions?.link ||
                    payload.webpush?.fcmOptions?.link ||
                    "/"
            }
        })
    );
});

self.addEventListener("notificationclick", event => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || "/";

    event.waitUntil((async () => {
        const url = new URL(targetUrl, self.location.origin).href;
        const clientList = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        });

        for (const client of clientList) {
            if ("focus" in client) {
                await client.focus();
                if ("navigate" in client) {
                    await client.navigate(url);
                }
                return;
            }
        }

        if (self.clients.openWindow) {
            await self.clients.openWindow(url);
        }
    })());
});
