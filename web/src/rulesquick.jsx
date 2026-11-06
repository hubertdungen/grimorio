// Regras rápidas no painel do jogo (Forge Play): escreves «dash» (ou «atropelar») e vês logo o que é — o glossário e as
// primeiras linhas da regra oficial, de /api/rules (a mesma pesquisa da secção Regras e dos símbolos das cartas).
import { useEffect, useRef, useState } from 'react'
import { tx } from './i18n.js'

export default function RulesQuick() {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [res, setRes] = useState(null), t = useRef(0)
  useEffect(() => {
    clearTimeout(t.current)
    const s = q.trim()
    if (s.length < 2) { setRes(null); return }
    t.current = setTimeout(() => {
      fetch(`/api/rules?q=${encodeURIComponent(s)}`).then(r => r.json()).then(r => setRes({ q: s, tr: r.translated, list: (r.results || []).slice(0, 4) })).catch(() => setRes({ q: s, err: true }))
    }, 250)
    return () => clearTimeout(t.current)
  }, [q])
  if (!open) return <button type="button" className="link small rq-open" onClick={() => setOpen(true)}>📖 {tx('Regras rápidas')}</button>
  return (
    <div className="rq">
      <div className="rq-bar">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Ex.: dash, atropelar, prioridade…')} aria-label={tx('Pesquisar nas regras')}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false) }} />
        <button type="button" className="link small" onClick={() => setOpen(false)} aria-label={tx('Fechar')}>✕</button>
      </div>
      {res?.err && <p className="muted small">{tx('Não deu para abrir as regras agora.')}</p>}
      {res && !res.err && !res.list.length && <p className="muted small">{tx('Nada encontrado.')}</p>}
      {res?.tr && <p className="muted small">→ {res.tr}</p>}
      {res?.list?.map((x, k) => (
        <div key={k} className="rq-hit">
          <b>{x.title || x.term}{x.num ? <small className="muted"> · {x.num}</small> : null}</b>
          {x.kind === 'rule' ? x.rules.slice(1, 3).map(([n, l]) => <p key={n}><small className="muted">{n}</small> {l.length > 360 ? `${l.slice(0, 357)}…` : l}</p>) : <p>{x.text}</p>}
        </div>
      ))}
    </div>
  )
}
