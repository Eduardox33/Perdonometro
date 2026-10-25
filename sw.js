/* ============================================================
   El Perdonómetro · service worker (PWA)
   ------------------------------------------------------------
   · Páginas (navegaciones): primero red, si no hay internet →
     lo que tengas guardado. Así nunca ves una versión vieja.
   · Archivos estáticos (css/js/íconos): "stale-while-revalidate"
     (sirve de caché al tiro y actualiza en segundo plano).
   ============================================================ */

const CACHE = "perdonometro-v5";

const RECURSOS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./js/store.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      // allSettled: si un recurso falla, igual se instala
      .then((c) => Promise.allSettled(RECURSOS.map((r) => c.add(r))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((llaves) =>
        Promise.all(llaves.filter((l) => l !== CACHE).map((l) => caches.delete(l)))
      )
      .then(() => self.clients.claim())
  );
});

async function redPrimero(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const copia = res.clone();
      const cache = await caches.open(CACHE);
      cache.put(req, copia);
    }
    return res;
  } catch (e) {
    const cacheado = await caches.match(req, { ignoreSearch: true });
    if (cacheado) return cacheado;
    throw e;
  }
}

/* Archivos del mismo origen: siempre intenta red primero (nunca
   mezclas versiones de html/css/js) y si no hay internet usa la
   caché. Archivos de otros orígenes (módulos CDN): cache primero. */
self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const mismoOrigen = new URL(req.url).origin === location.origin;

  evento.respondWith(
    mismoOrigen
      ? redPrimero(req)
      : fetch(req).catch(async () => (await caches.match(req)) || Response.error())
  );
});
