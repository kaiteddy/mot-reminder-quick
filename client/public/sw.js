/**
 * Service worker — exists purely to raise a notification when a customer messages, and to open
 * the right conversation when it's tapped. No offline caching: the app talks to a live database,
 * and a stale cached shell would be worse than a spinner.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ELI Motors", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "New customer message";
  const options = {
    body: data.body || "",
    icon: "/eli-logo.png",
    badge: "/eli-logo.png",
    // Same tag per customer so a chatty thread replaces its own banner instead of stacking.
    tag: data.tag || "customer-message",
    renotify: true,
    data: { url: data.url || "/conversations" },
    timestamp: Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/conversations";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an already-open window where we can — on iOS a second window would lose state.
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) return client.navigate(url).catch(() => undefined);
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
