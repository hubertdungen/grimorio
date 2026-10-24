// Service worker do Grimório: app instalável e utilizável sem rede (o que já foi visto).
const CACHE = 'grimorio-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())))

self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return
  // ficheiros com hash: nunca mudam
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r })))
    return
  }
  // dados das cartas: devolve o que há e atualiza por trás
  if (url.pathname.includes('/data/')) {
    e.respondWith(caches.open(CACHE).then(async x => {
      const hit = await x.match(req)
      const net = fetch(req).then(r => { if (r.ok) x.put(req, r.clone()); return r }).catch(() => hit)
      return hit || net
    }))
    return
  }
  // páginas e restantes: rede primeiro, cache se não houver rede
  e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r }).catch(() => caches.match(req).then(h => h || caches.match('./'))))
})
