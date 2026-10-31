// App Android: o ecrã vem do servidor (atualiza-se sozinho), mas a própria app (o .apk) só muda se se instalar a nova.
// Compara a versão da app (GrimorioApp.version) com a release «latest» do GitHub e oferece o .apk novo; o link passa
// pelo DownloadManager da app (MainActivity) e o Android pergunta se instala por cima (os dados ficam).
import { useEffect, useState } from 'react'
import { tx } from './i18n.js'
import { newer } from './apkver.js'

const REL = 'https://api.github.com/repos/hubertdungen/grimorio/releases/latest', K = 'grimorio.apk.latest', DAY = 86400000
const mine = () => window.GrimorioApp?.version?.() || ''

// {v, url} da release mais recente (guardada um dia neste aparelho: o GitHub limita os pedidos sem conta)
async function latest(force) {
  try { const c = JSON.parse(localStorage.getItem(K) || 'null'); if (!force && c && Date.now() - c.at < DAY) return c } catch { /* sem armazenamento */ }
  const r = await fetch(REL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`GitHub ${r.status}`)
  const j = await r.json(), apk = (j.assets || []).find(a => /-android\.apk$/.test(a.name))
  const c = { v: String(j.tag_name || '').replace(/^v/, ''), url: apk?.browser_download_url || null, at: Date.now() }
  try { localStorage.setItem(K, JSON.stringify(c)) } catch { /* sem armazenamento */ }
  return c
}
function useLatest(force) {
  const [l, setL] = useState(null)
  useEffect(() => { if (window.GrimorioApp) latest(force).then(setL).catch(e => setL({ err: e.message })) }, [force])
  return l
}

// Definições › App Android
export function ApkUpdate() {
  const l = useLatest(true)
  if (!l) return null
  if (l.err) return <p className="small bad-t">{tx('Não deu para verificar se há uma app nova: {e}', { e: l.err })}</p>
  if (!l.url || !newer(l.v, mine())) return <p className="muted small">{tx('A app está na versão mais recente.')}</p>
  return <p><a className="btn primary" href={l.url}>⬇ {tx('Descarregar a app {v}', { v: l.v })}</a> <span className="muted small">{tx('Depois de descarregar, abre o ficheiro para instalar por cima: os dados ficam.')}</span></p>
}

// aviso ao abrir a app (no máximo uma verificação por dia); «✕» cala esta versão
export function ApkBanner() {
  const l = useLatest(false), [off, setOff] = useState(() => { try { return localStorage.getItem(K + '.off') } catch { return null } })
  if (!l?.url || !newer(l.v, mine()) || off === l.v) return null
  const close = () => { try { localStorage.setItem(K + '.off', l.v) } catch { /* sem armazenamento */ } setOff(l.v) }
  return (
    <div className="apk-banner" role="status">
      <span>{tx('Há uma versão nova da app Android: {v}', { v: l.v })}</span>
      <a className="btn primary small" href={l.url}>⬇ {tx('Descarregar')}</a>
      <button className="link small" onClick={close} aria-label={tx('Fechar')}>✕</button>
    </div>
  )
}

// pacotes de Windows e Linux: o launcher descarrega a versão nova sozinho (update.json → /api/update). Aqui só se mostra:
// «a descarregar…» com animação enquanto vem e «pronta» quando já está (começa ao voltar a abrir o Grimório)
export function DesktopUpdBanner() {
  const [u, setU] = useState(null), [off, setOff] = useState(() => { try { return localStorage.getItem(K + '.desk') } catch { return null } })
  useEffect(() => {
    if (window.GrimorioApp) return  // a app Android tem o aviso dela
    let t, live = true
    const get = () => fetch('/api/update').then(r => r.json()).then(x => { if (!live) return; setU(x); if (x?.packaged && x.downloading) t = setTimeout(get, 15000) }).catch(() => {})
    get()
    const iv = setInterval(get, 30 * 60000)  // de meia em meia hora: o launcher procura atualizações em segundo plano
    return () => { live = false; clearTimeout(t); clearInterval(iv) }
  }, [])
  if (!u?.packaged || !(u.downloading || u.ready) || off === (u.ready || u.downloading)) return null
  const close = () => { const v = u.ready || u.downloading; try { localStorage.setItem(K + '.desk', v) } catch { /* sem armazenamento */ } setOff(v) }
  return (
    <div className={`apk-banner upd-banner ${u.ready ? 'ready' : 'busy'}`} role="status">
      <i className="upd-ico" aria-hidden="true">{u.ready ? '✓' : '⟳'}</i>
      <span>{u.ready ? tx('Grimório {v} pronto: começa quando voltares a abrir o Grimório (os teus dados passam tal como estão).', { v: u.ready }) : tx('A descarregar o Grimório {v}…', { v: u.downloading })}</span>
      {u.ready && <button className="link small" onClick={close} aria-label={tx('Fechar')}>✕</button>}
    </div>
  )
}
