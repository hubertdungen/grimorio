import { StrictMode, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ready, tx, LANG } from './i18n.js'
import { initWake } from './wakelock.js'

// Erros do servidor: chegam em pt ({"erro": ...}); os textos fixos traduzem-se aqui para todos os pedidos da app.
// Os nomes «X (deck médio)» que o servidor gera também.
// code "profile" (401) = não há perfil escolhido: a app mostra «Quem vai jogar?».
// ponytail: só textos exatos; os que levam valores no meio (f-strings do Python) ficam em pt
const _fetch = window.fetch.bind(window), MEDIO = '(deck médio)'
// Sessão do login (Authelia, no endereço público) que expirou: os pedidos à API são reencaminhados para o login e falham
// em silêncio (decks e adversários vazios). Pergunta-se /api/me sem seguir o reencaminhamento; se for o login, uma barra
// pede para entrar outra vez (recarregar passa pelo login e volta aqui).
let sessT = 0
const checkSession = () => {
  if (Date.now() - sessT < 10000 || document.getElementById('sess-bar')) return
  sessT = Date.now()
  _fetch('./api/me', { redirect: 'manual', cache: 'no-store' }).then(r => {
    if (r.type !== 'opaqueredirect' && r.status !== 401) return
    const b = document.createElement('div')
    b.id = 'sess-bar'; b.className = 'sess-bar'; b.setAttribute('role', 'alert')
    b.innerHTML = `<span>${tx('A sessão terminou (o login expira com o tempo ou ao fechar o browser).')}</span>`
    const go = document.createElement('button'); go.className = 'primary'; go.textContent = tx('Entrar outra vez'); go.onclick = () => location.reload()
    b.append(go); document.body.append(b)
  }).catch(() => {})
}
const isApi = a => String(a[0]?.url || a[0]).includes('/api/')
window.fetch = async (...a) => {
  let r
  try { r = await _fetch(...a) } catch (e) { if (isApi(a) && navigator.onLine !== false) checkSession(); throw e }
  if (isApi(a) && r.redirected && !r.url.startsWith(location.origin)) checkSession()
  if (!(r.headers.get('content-type') || '').includes('json')) { if (isApi(a) && r.ok && /html/.test(r.headers.get('content-type') || '')) checkSession(); return r }
  if (r.ok) {  // nomes gerados no servidor em pt (decks médios do EDHREC) traduzem-se só à vista
    if (LANG === 'pt' || !String(a[0]?.url || a[0]).includes('/api/')) return r
    const s = await r.clone().text()
    if (!s.includes(MEDIO)) return r
    return new Response(s.replaceAll(MEDIO, JSON.stringify(tx(MEDIO)).slice(1, -1)), { status: r.status, statusText: r.statusText, headers: r.headers })
  }
  const j = await r.clone().json().catch(() => null)
  if (j?.code === 'profile') window.dispatchEvent(new Event('grimorio:profile'))
  if (typeof j?.erro !== 'string') return r
  return new Response(JSON.stringify({ ...j, erro: tx(j.erro) }), { status: r.status, statusText: r.statusText, headers: r.headers })
}

// Imagens próprias de decks importados (TappedOut, Archidekt) que não carregam (rede que as bloqueia): tenta outra vez
// pelo Grimório, que as vai buscar e guarda (/ext/…)
const EXT = /^https:\/\/(static\.tappedout\.net|storage\.googleapis\.com)\//
document.addEventListener('error', e => {
  const el = e.target
  if (el.tagName === 'IMG' && EXT.test(el.src) && !el.dataset.ext) { el.dataset.ext = '1'; el.src = el.src.replace(EXT, './ext/$1/') }
}, true)

// App Android (android/): os ficheiros feitos aqui (PDF/ZIP dos proxies, cópias) não passam pelo gestor de transferências
// do Android; vão em base64 para a app, que os guarda nas Transferências
if (window.GrimorioApp?.saveFile) {
  const click = HTMLAnchorElement.prototype.click
  const save = a => fetch(a.href).then(r => r.blob()).then(b => new Promise(ok => { const f = new FileReader(); f.onload = () => ok([b.type, String(f.result).split(',')[1]]); f.readAsDataURL(b) }))
    .then(([type, b64]) => window.GrimorioApp.saveFile(a.download || 'grimorio', type || 'application/octet-stream', b64)).catch(() => {})
  const mine = a => a.download != null && a.hasAttribute('download') && /^(blob|data):/.test(a.href)
  HTMLAnchorElement.prototype.click = function () { if (mine(this)) return void save(this); return click.call(this) }
  document.addEventListener('click', e => { const a = e.target.closest?.('a[download]'); if (a && mine(a)) { e.preventDefault(); save(a) } }, true)
}

// uma parte carregada a pedido (dados 3D, ecrãs) já não existe no servidor: a página é de antes de uma atualização.
// Recarrega uma vez (no máximo de 5 em 5 min, para não entrar em ciclo); o jogo do Forge Play continua no servidor.
addEventListener('vite:preloadError', e => {
  let last = 0
  try { last = +sessionStorage.getItem('grimorio.reloadAt') || 0 } catch { /* sem armazenamento */ }
  if (Date.now() - last < 300000) return
  e.preventDefault()
  try { sessionStorage.setItem('grimorio.reloadAt', String(Date.now())) } catch { /* sem armazenamento */ }
  location.reload()
})

// a app só carrega depois do dicionário da língua: as tabelas fixas dos módulos já nascem traduzidas
// (o data.js também só aqui: as tabelas dele — tipos, cores — traduzem-se ao carregar o módulo)
ready.catch(() => {}).then(() => Promise.all([import('./App.jsx'), import('./confirm.jsx'), import('./data.js'), import('./boundary.jsx')]))
  .then(([m, c, d, b]) => {
    // erros fora do desenho (eventos, promessas) também vão para o registo do servidor
    addEventListener('error', e => e.error && b.reportError(e.message, e.error?.stack))
    addEventListener('unhandledrejection', e => b.reportError(e.reason?.message || e.reason, e.reason?.stack))
    return initWake() || d.probeScryfall() || createRoot(document.getElementById('root')).render(createElement(StrictMode, null, createElement(b.Boundary, null, createElement(m.default)), createElement(c.ConfirmHost)))
  })

// Sliders: a parte preenchida do trilho segue o valor (--p); o Firefox tem ::-moz-range-progress, o Chrome precisa disto
const fill = el => { const lo = +el.min || 0, hi = +el.max || 100; el.style.setProperty('--p', `${((el.value - lo) / (hi - lo || 1)) * 100}%`) }
const scan = n => n.nodeType === 1 && (n.matches('input[type=range]') ? fill(n) : n.querySelectorAll('input[type=range]').forEach(fill))
document.addEventListener('input', e => { if (e.target.type === 'range') fill(e.target) })
new MutationObserver(ms => ms.forEach(m => (m.type === 'attributes' ? m.target.type === 'range' && fill(m.target) : m.addedNodes.forEach(scan))))
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', 'min', 'max'] })

// App instalável (PWA): o browser só permite service workers em HTTPS ou em localhost.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}))
}
