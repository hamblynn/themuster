// Custom service worker (injectManifest strategy — see vite.config.js).
// Deliberately minimal: precache + push + notificationclick + subscription
// rotation only. No offline app-shell/navigateFallback — that's a separate,
// unrelated feature and out of scope here.
import { precacheAndRoute } from "workbox-precaching";

precacheAndRoute(self.__WB_MANIFEST);

// injectManifest mode (unlike the default generateSW) doesn't wire this
// up automatically. Without it, the "Update" button in PwaUpdateToast
// calls updateServiceWorker(true), which posts this message to the
// waiting worker expecting it to skipWaiting() and take over — but
// nothing here was listening, so the waiting worker never activated,
// controllerchange never fired, and the page never reloaded. Clicking
// Update looked like it did nothing.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Same env var the main app uses for its API base (src/App.jsx) — Vite
// replaces import.meta.env.* at build time in the service worker bundle
// too, since injectManifest runs src/sw.js through Vite's own build.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

// Push payloads are kept small server-side (4KB limit, encrypted) — just
// enough to build a notification and deep-link back into the app. The
// client fetches full detail (e.g. the tracking session) once opened.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const isSos = payload.type === "sos";
  const title = isSos ? "SOS — hunter needs help" : "The Muster";
  const body = isSos
    ? `${payload.hunter_name || "A hunter"} triggered an SOS nearby.`
    : payload.body || "";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: isSos ? `sos-${payload.session_id}` : undefined,
      requireInteraction: isSos,
      data: { url: "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(event.notification.data?.url || "/");
    })
  );
});

// Browsers can rotate/invalidate a push subscription's endpoint at any
// time. Without this, push_subscriptions on the server silently
// accumulates dead rows and the user stops getting alerts with no
// visible error anywhere.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? { applicationServerKey: event.oldSubscription.options.applicationServerKey, userVisibleOnly: true } : undefined)
      .then((subscription) =>
        fetch(`${API_BASE}/push/subscribe`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        })
      )
  );
});
