// sw.js — Service Worker: хранит сайт и расписание в памяти телефона, чтобы всё открывалось без интернета.
// ВАЖНО: при изменении иконок или манифеста увеличьте VERSION — тогда браузер обновит кэш.
const VERSION = "v1";
const CACHE = `schedule-${VERSION}`;
const SHELL = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];

// Установка: кладём «каркас» сайта в кэш (каждый файл отдельно — отсутствие одного не ломает установку)
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

// Активация: удаляем кэши старых версий
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith("/sw.js")) return;

  if (url.pathname.endsWith("/schedules.json")) e.respondWith(schedulesFirst(req, e));   // расписание: мгновенно из памяти + тихое обновление
  else if (req.mode === "navigate" || url.pathname.endsWith(".html")) e.respondWith(networkFirst(req, 3000));  // страница: свежая, если сеть есть
  else e.respondWith(cacheFirst(req));                                                    // иконки, манифест
});

// Расписание: отдаём сохранённую копию сразу, а новую скачиваем в фоне.
// Если данные изменились — сообщаем странице, и она обновляет экран сама.
async function schedulesFirst(req, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req.url, { ignoreSearch: true });
  const old = cached ? cached.clone() : null;   // копия нужна до того, как страница прочитает ответ

  const refresh = fetch(req.url, { cache: "no-cache" }).then(async res => {
    if (!res.ok) return res;
    if (old) {
      const [a, b] = await Promise.all([old.text(), res.clone().text()]);
      await cache.put(req.url, res.clone());
      if (a !== b) {
        for (const c of await self.clients.matchAll()) c.postMessage("schedules-updated");
      }
    } else {
      await cache.put(req.url, res.clone());
    }
    return res;
  }).catch(() => null);

  if (cached) { event.waitUntil(refresh); return cached; }
  return (await refresh) || Response.error();
}

// Страница: пробуем сеть (до ms миллисекунд), при неудаче или медленной сети — берём копию из кэша
async function networkFirst(req, ms) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  return (await cache.match(req)) || fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
}
