// Sem Forge: a app Android a correr só no telemóvel (o Forge é Java de computador). O servidor diz forge=false em
// /api/health; o que precisa do Forge mostra para onde ir: um computador ou um servidor com o Grimório (na app, liga-se a
// ele aqui mesmo, por window.GrimorioApp.setMode). O resto (decks, biblioteca, regras, mesa livre, salas) funciona igual.
import { useEffect, useState } from 'react'
import { tx } from './i18n.js'

let known = null
const health = () => known || (known = fetch('/api/health').then(r => r.json()).then(j => j?.forge !== false).catch(() => true))
// enquanto não se sabe: a app em modo local nunca tem Forge (sem piscar o Laboratório antes do aviso)
const guess = () => { try { return window.GrimorioApp?.getMode?.() !== 'local' } catch { return true } }

export function useForge() {
  const [ok, setOk] = useState(guess)
  useEffect(() => { let live = true; health().then(v => { if (live) setOk(v) }); return () => { live = false } }, [])
  return ok
}

// compact: uma faixa por cima do que ainda se vê sem Forge (relatórios e ratings que vieram de outro aparelho)
export function NeedsForge({ compact = false }) {
  const app = !!window.GrimorioApp?.setMode
  const go = app && <button className={compact ? 'small' : 'primary'} onClick={() => window.GrimorioApp.setMode('remote', '')}>{tx('Ligar a um computador ou servidor')}</button>
  if (compact) return <p className="card needs-forge small">{tx('Os jogos com o Forge precisam de um computador ou servidor com o Grimório; aqui vês o que já foi jogado.')} {go}</p>
  return (
    <section className="card needs-forge">
      <h3>{tx('Precisa de um computador ou servidor com o Grimório')}</h3>
      <p className="muted">{tx('Isto usa o Forge, o motor de jogo do Grimório para computador, que não corre neste aparelho. Tudo o resto funciona aqui: decks, biblioteca, regras, mesa livre, amigos e salas online.')}</p>
      {app ? <p>{go}</p> : <p className="muted small">{tx('Abre o Grimório num computador (Windows ou Linux) ou num servidor para usares isto.')}</p>}
    </section>
  )
}
