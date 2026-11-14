// Service worker do Grimório: app instalável e utilizável sem rede (o que já foi visto).
const CACHE = 'grimorio-v1'
// quantos ficheiros de cada tipo ficam guardados: os das builds antigas (/assets/ com outro hash) e as imagens das cartas
// já vistas acumulavam-se para sempre no telemóvel; saem os mais antigos (as chaves vêm pela ordem em que entraram)
const MAX = { assets: 160, img: 800 }
const kind = u => (u.includes('/assets/') ? 'assets' : /\/(sf|ext|arts|covers|avatars)\//.test(u) ? 'img' : '')
const trim = async x => {
  const ks = await x.keys()
  for (const [k, n] of Object.entries(MAX)) {
    const of = ks.filter(q => kind(q.url) === k)
    for (const q of of.slice(0, Math.max(0, of.length - n))) await x.delete(q)
  }
}
let puts = 0
// só respostas boas: um 404/502 de um servidor a reiniciar ficava guardado para sempre num ficheiro com hash (a app não abria)
const keep = (req, r) => {
  if (r.status !== 200 || r.type !== 'basic') return
  const c = r.clone()
  caches.open(CACHE).then(async x => { await x.put(req, c); if (++puts % 25 === 0) await trim(x) }).catch(() => {})
}
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(k => k !== CACHE).map(k => caches.delete(k)))
  const x = await caches.open(CACHE)
  for (const k of await x.keys()) { const r = await x.match(k); if (!r || r.status !== 200) await x.delete(k) }  // erros guardados por versões antigas
  await trim(x)
  await self.clients.claim()
})()))

self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return
  // ficheiros com hash: nunca mudam
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { keep(req, r); return r })))
    return
  }
  // dados das cartas: devolve o que há e atualiza por trás
  if (url.pathname.includes('/data/')) {
    e.respondWith(caches.open(CACHE).then(async x => {
      const hit = await x.match(req)
      const net = fetch(req).then(r => { keep(req, r); return r }).catch(() => hit)
      return hit || net
    }))
    return
  }
  // páginas e restantes: rede primeiro, cache se não houver rede
  e.respondWith(fetch(req).then(r => { keep(req, r); return r }).catch(() => caches.match(req).then(h => h || caches.match('./'))))
})
