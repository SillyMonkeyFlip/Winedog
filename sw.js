// WineDog service worker.
// Adds a small helper script (assets/game-hook.js) to every game page under /Games/
// so the Mute button can silence the game's sound.

const HOOK = '<script src="/assets/game-hook.js"></script>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/Games/')) return;
  if (req.mode !== 'navigate' && req.destination !== 'iframe' && req.destination !== 'document') return;

  event.respondWith((async () => {
    const res = await fetch(req);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || res.type === 'opaqueredirect' || !type.includes('text/html')) return res;
    const html = await res.text();
    const out = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (m) => m + HOOK)
      : HOOK + html;
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(out, { status: res.status, statusText: res.statusText, headers });
  })());
});
