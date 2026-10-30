// Mecânicas a negrito (Atropelar, Flying, Scry…) em qualquer ecrã, menos na mesa do Forge Play: com o rato por cima
// abre-se um cartãozinho com a regra e «📖 Abrir nas Regras» mostra as Regras numa janela, sem sair de onde estás.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { KW, normKw, define } from './keywords.js'
import { Syms } from './ui.jsx'
import { tx } from './i18n.js'

const Rules = lazy(() => import('./Rules.jsx'))
const EN = new Set(KW.source.slice(3, -3).split('|').map(normKw))
export default function KwPeek({ data }) {
  const [pt, setPt] = useState(null), [peek, setPeek] = useState(null), [full, setFull] = useState(null)
  const t = useRef(0), inBox = useRef(false)
  useEffect(() => { fetch('/api/rules?terms=1').then(r => (r.ok ? r.json() : {})).then(d => setPt(new Set((d.pt || []).map(normKw)))).catch(() => setPt(new Set())) }, [])
  useEffect(() => {
    if (!pt) return
    const over = e => {
      const el = e.target.closest?.('b, strong')
      if (!el || el.closest('.fp, .kw-peek, .modal-bg, .rules-v, input, textarea, button')) return
      const term = el.textContent.trim()
      if (term.length > 32 || !(EN.has(normKw(term)) || pt.has(normKw(term)))) return
      clearTimeout(t.current)
      t.current = setTimeout(() => {
        const r = el.getBoundingClientRect()
        setPeek({ term, x: Math.min(r.left, window.innerWidth - 330), y: r.bottom + 6, info: null })
        define(term).then(info => setPeek(p => (p?.term === term ? { ...p, info: info || { text: '' } } : p)))
      }, 350)
      el.addEventListener('mouseleave', () => { clearTimeout(t.current); t.current = setTimeout(() => { if (!inBox.current) setPeek(null) }, 300) }, { once: true })
    }
    document.addEventListener('mouseover', over)
    return () => document.removeEventListener('mouseover', over)
  }, [pt])
  return <>
    {peek && createPortal(
      <div className="kw-peek" style={{ left: Math.max(8, peek.x), top: peek.y }} role="tooltip"
        onMouseEnter={() => { inBox.current = true; clearTimeout(t.current) }} onMouseLeave={() => { inBox.current = false; setPeek(null) }}>
        <b>{peek.info?.name || peek.term}</b>{peek.info?.num && <code> {peek.info.num}</code>}
        <p>{peek.info ? <Syms text={peek.info.text || tx('Sem definição nas regras.')} /> : tx('A carregar…')}</p>
        <button className="link small" onClick={() => { setFull(peek.info?.name || peek.term); setPeek(null) }}>📖 {tx('Abrir nas Regras')}</button>
      </div>, document.body)}
    {full && createPortal(
      <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setFull(null) }}>
        <div className="modal kw-rules"><button className="kw-x" onClick={() => setFull(null)} aria-label={tx('Fechar')}>×</button>
          <Suspense fallback={<p className="muted">{tx('A carregar…')}</p>}><Rules data={data} initial={full} /></Suspense></div>
      </div>, document.body)}
  </>
}
