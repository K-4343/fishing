// 낚시 앱 Service Worker — v3
// 전략: 앱셸 캐시우선 / API 네트워크우선 / OSM타일 캐시우선(제한)
const CACHE_VERSION = 'v3';
const SHELL_CACHE = 'fishing-shell-' + CACHE_VERSION;
const TILE_CACHE  = 'fishing-tiles-' + CACHE_VERSION;
const MAX_TILES   = 300; // 약 3~6 MB 제한

const SHELL_FILES = [
  './',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
];

// 이 URL 패턴은 네트워크 우선 (실시간 데이터)
const NETWORK_FIRST = [
  'firebaseapp.com',
  'googleapis.com/firestore',
  'firebasestorage.app',
  'open-meteo.com',
  'marine-api.open-meteo.com',
  'nominatim.openstreetmap.org',
  'workers.dev',
  'api.open-meteo.com',
];

// ── 설치: 앱셸 프리캐시 ────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL_FILES).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── 활성화: 구버전 캐시 정리 + 클라이언트 즉시 제어 ─────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ includeUncontrolled: true }).then(clients =>
          clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION }))
        )
      )
  );
});

// ── 요청 인터셉트 ──────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { url, method } = e.request;
  if (!url.startsWith('http') || method !== 'GET') return;

  // OSM 타일 → 캐시우선 + 용량 제한
  if (url.includes('tile.openstreetmap.org') || url.includes('tiles.openstreetmap.org')) {
    e.respondWith(tileStrategy(e.request));
    return;
  }

  // Firebase / 날씨 API / Nominatim → 네트워크 우선
  if (NETWORK_FIRST.some(pat => url.includes(pat))) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // 앱셸 (같은 출처 파일, Leaflet CDN 등) → 캐시 우선
  e.respondWith(cacheFirst(e.request));
});

// ── 전략 함수들 ───────────────────────────────────────────────────────────
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const c = await caches.open(SHELL_CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function tileStrategy(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(TILE_CACHE);
      const keys = await cache.keys();
      if (keys.length >= MAX_TILES) {
        // LRU 근사: 가장 오래된 항목 제거
        await cache.delete(keys[0]);
      }
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return cached || new Response('', { status: 503 });
  }
}
