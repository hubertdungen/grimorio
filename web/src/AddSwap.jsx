// «+» com troca: juntar a carta ou trocá-la pela pior do deck na mesma função (swap.js).
// Toque: o «+» abre um menu (Adicionar / Trocar por…). Rato: o «+» junta como sempre; ao passar por cima aparece
// «⇄ carta» ao lado (com 2+ opções abre o mesmo menu). As trocas só se calculam com o rato em cima ou o menu aberto.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mana } from './ui.jsx'
import { KIND_LABEL } from './swap.js'
import { tx } from './i18n.js'
import './AddSwap.css'
import { hlProps } from './hl.js'

const coarse = () => matchMedia('(pointer: coarse)').matches
// motivos com símbolos de mana («Pede {U}{U}{U} com só 2 fontes de U») → os símbolos do Scryfall
const Reason = ({ t }) => t.split(/(\{[WUBRGCSX0-9/]+\})/).map((p, k) => (p.startsWith('{') ? <Mana key={k} cost={p} /> : p))

function Menu({ anchor, c, opts, act, close }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!anchor.isConnected) return  // o botão saiu da página: fica onde estava (não salta para o canto)
    const r = anchor.getBoundingClientRect(), m = ref.current.getBoundingClientRect(), W = innerWidth, H = innerHeight
    const left = Math.max(8, Math.min(r.right - m.width, W - m.width - 8))
    const top = r.bottom + 4 + m.height > H - 8 && r.top - 4 - m.height > 8 ? r.top - 4 - m.height : Math.min(r.bottom + 4, H - m.height - 8)
    setPos({ left, top: Math.max(8, top) })
  }, [anchor, opts])
  useEffect(() => {
    const out = e => { if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) close() }
    const key = e => { if (e.key === 'Escape') { close(); anchor.focus() } }
    const away = e => { if (!ref.current?.contains(e.target)) close() }
    document.addEventListener('pointerdown', out, true)
    document.addEventListener('keydown', key)
    addEventListener('scroll', away, true)
    ref.current.querySelector('button:not([disabled])')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', key); removeEventListener('scroll', away, true) }
  }, [anchor, close])
  const go = f => () => { f(); close() }
  return createPortal(
    <div ref={ref} className="aos-menu" role="menu" aria-label={c.n} style={pos || { visibility: 'hidden', left: 0, top: 0 }}>
      <button role="menuitem" onClick={go(() => act.add(c))}><b>＋ {tx('Adicionar')}</b></button>
      {opts.map(o => (
        <button key={o.out} role="menuitem" onClick={go(() => act.swap(c, o))} title={o.why.join(' · ')} {...hlProps([{ n: o.out, tone: 'out' }])}>
          <b>⇄ {tx('Trocar por {q}× {out}', { q: o.q, out: o.out })}</b>
          <small><i className="aos-kind">{KIND_LABEL[o.kind] || o.kind}</i> <Reason t={o.why[0] || ''} /></small>
        </button>
      ))}
      {!opts.length && <>
        <button role="menuitem" disabled><small>{opts.none}</small></button>
        {(opts.kept || []).map(k => <p key={k.n} className="aos-kept"><b>{k.n}</b>: <Reason t={k.why} /></p>)}
      </>}
    </div>, document.body)
}

/** children = o «+» de sempre; swaps = useDeckRecs().swaps (sem ele fica só o «+»); up = «⇄» por cima (cartas em grelha). */
export default function AddOrSwap({ c, act, swaps, up = false, children }) {
  const [hot, setHot] = useState(false)
  const [open, setOpen] = useState(null) // elemento onde o menu se ancora
  const box = useRef(null)
  const opts = useMemo(() => (swaps && (hot || open) ? swaps(c, { limit: 3 }) : null), [swaps, c, hot, open])
  if (!swaps) return children
  const close = () => { setOpen(null); setHot(false) }
  const onClickCapture = e => {
    if (!coarse() || !e.target.closest('.act.add')) return
    e.stopPropagation(); e.preventDefault()
    setOpen(open ? null : e.target.closest('button'))
  }
  const first = opts?.[0]
  return (
    <span ref={box} className={`aos ${up ? 'up' : ''}`} onClickCapture={onClickCapture}
      onMouseEnter={() => !coarse() && setHot(true)} onMouseLeave={() => { if (!open) setHot(false) }}
      onFocus={() => !coarse() && setHot(true)} onBlur={e => { if (!box.current.contains(e.relatedTarget)) setHot(false) }}>
      {children}
      {(hot || open) && first && (
        <button className="act aos-x" title={first.why.join(' · ')} aria-haspopup={opts.length > 1 ? 'menu' : undefined} {...hlProps(opts.map(o => ({ n: o.out, tone: 'out' })))}
          onClick={e => (opts.length > 1 ? setOpen(open ? null : e.currentTarget) : act.swap(c, first))}>
          ⇄ <span>{first.q > 1 ? `${first.q}× ` : ''}{first.out}</span>{opts.length > 1 ? ' ▾' : ''}
        </button>
      )}
      {open && opts && <Menu anchor={open} c={c} opts={opts} act={act} close={close} />}
    </span>
  )
}
