// AgilNote: 本体はキャッシュしてオフラインでも開けるようにする。
// 本体を更新したら VERSION を上げる。
const VERSION = "agilnote-v3";
const SHELL = ["./", "index.html", "md.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
const FONT_CACHE = "agilnote-fonts";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Google Fonts：一度読み込んだ書体を保存しておき、オフラインでも使う
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // 本体：ネットにつながれば最新、だめならキャッシュ
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; })
        .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
    );
  }
});
