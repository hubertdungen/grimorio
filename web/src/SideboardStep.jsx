// Sideboard entre jogos de uma série (Forge Play e torneios): o deck e o sideboard lado a lado, com as cartas. Clicar
// (ou arrastar para o outro lado) passa uma cópia; o total fica igual e o mínimo do formato é respeitado. A lista guardada
// do deck não muda: quem chama guarda a lista da série.
// Ver uma carta em grande, como no resto da app: rato por cima (computador), tocar e manter (telemóvel/tablet: a carta em
// grande, BigCard) ou a lupa de cada carta (os dois); o clique na carta continua a passá-la para o outro lado.
import { useState } from 'react'
import { tx } from './i18n.js'
import { img, pidOf } from './data.js'
import { showCardPeek, hideCardPeek } from './deckview.js'
import { BigCard } from './ForgePlay.jsx'
import { held, isTouch } from './touch.js'
import { cnt, sbMove, sbCheck } from './sideboard.js'
import './SideboardStep.css'

const order = (a, b) => (a.c?.mt === 'Land') - (b.c?.mt === 'Land') || (a.c?.cmc ?? 99) - (b.c?.cmc ?? 99) || a.n.localeCompare(b.n)

// deck = a lista do jogo anterior {main, side, …}; base = a lista guardada (para o «repor» e os +/−); fmt = FORMAT[…]
export default function SideboardStep({ data, deck, base = deck, fmt, onReady, onKeep, children, extra }) {
  const [d, setD] = useState(deck)
  const [drag, setDrag] = useState(null)  // {from, n}
  const [big, setBig] = useState(null)  // a carta em grande (nome)
  const touch = isTouch()  // no toque nada de arrastar à HTML5: o toque longo do Chrome começava a arrastar e a carta em grande não abria
  const bad = sbCheck(d, base, fmt)
  const delta = n => (d.main[n] || 0) - (base.main?.[n] || 0)
  const ins = Object.keys({ ...d.main, ...base.main }).filter(n => delta(n) > 0), outs = Object.keys({ ...d.main, ...base.main }).filter(n => delta(n) < 0)
  const mv = (from, n) => setD(x => sbMove(x, from, n))
  const col = (k, label) => {
    const items = Object.entries(d[k] || {}).map(([n, q]) => ({ n, q, c: data.byName.get(n) })).sort(order)
    const drop = drag && drag.from !== k
    return (
      <section className={`sbs-col ${k} ${drop ? 'drop' : ''}`} onDragOver={e => { if (drop) e.preventDefault() }}
        onDrop={e => { e.preventDefault(); if (drop) mv(drag.from, drag.n); setDrag(null) }}>
        <h4>{label} <b>{cnt(d[k])}</b></h4>
        <div className="sbs-grid">{items.map(({ n, q, c }) => {
          const dl = k === 'main' ? delta(n) : -delta(n)
          return (
            <div key={n} role="button" tabIndex={0} className={`sbs-card ${dl > 0 ? 'up' : ''}`} draggable={!touch} onDragStart={() => { hideCardPeek(); setDrag({ from: k, n }) }} onDragEnd={() => setDrag(null)}
              onClick={() => { hideCardPeek(); mv(k, n) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mv(k, n) } }}
              title={`${n} · ${k === 'main' ? tx('Tirar um para o sideboard') : tx('Pôr um no deck')}`}
              onContextMenu={e => { e.preventDefault(); if (c) { held(); hideCardPeek(); setBig(n) } }}  // tocar e manter (ou o botão direito): em grande
              {...(c && { onMouseEnter: e => showCardPeek(e, c, pidOf(d, n)), onMouseLeave: hideCardPeek })}>
              {c ? <img src={img(c, 'small', false, pidOf(d, n))} alt={n} loading="lazy" draggable={false} /> : <span className="sbs-nm">{n}</span>}
              <b className="sbs-q">{q}</b>
              {dl !== 0 && <small className={`sbs-d ${dl > 0 ? 'up' : 'dn'}`}>{dl > 0 ? `+${dl}` : dl}</small>}
              {c && <button type="button" className="sbs-zoom" onClick={e => { e.stopPropagation(); hideCardPeek(); setBig(n) }} title={tx('Ver em grande')} aria-label={`${tx('Ver em grande')}: ${n}`}>🔍</button>}
            </div>)
        })}
        {!items.length && <p className="muted small">{k === 'side' ? tx('Este deck não tem sideboard.') : tx('O deck está vazio.')}</p>}
        </div>
      </section>)
  }
  const list = ns => ns.map(n => `${Math.abs(delta(n))}× ${n}`).join(', ')
  return (
    <div className="sbs">
      {big && <BigCard name={big} data={data} onClose={() => setBig(null)} />}
      {children}
      <p className="small muted">{tx('Clica numa carta (ou arrasta-a) para a passar para o outro lado. As trocas valem só para esta série: a lista guardada do deck fica como está.')} {touch ? tx('Toca e mantém (ou 🔍) para a ver em grande.') : tx('Passa o rato por cima (ou 🔍) para a ver em grande.')}</p>
      <div className="sbs-cols">{col('main', tx('Deck'))}{col('side', tx('Sideboard'))}</div>
      <p className="sbs-sum small">{ins.length || outs.length
        ? <><span className="ok-t">{tx('Entram')}: {list(ins) || '—'}</span> · <span className="bad-t">{tx('Saem')}: {list(outs) || '—'}</span></>
        : <span className="muted">{tx('Sem trocas: a lista guardada do deck.')}</span>}</p>
      <div className="row-btns sbs-act">
        <button className="primary" onClick={() => onReady(d)} disabled={!!bad} title={bad || undefined}>✓ {tx('Pronto')}</button>
        <button onClick={() => onKeep(deck)}>{tx('Manter o deck')}</button>
        {(ins.length > 0 || outs.length > 0) && <button className="link small" onClick={() => setD({ ...d, main: { ...base.main }, side: { ...base.side } })}>{tx('repor')}</button>}
        {extra}
        {bad && <span className="small bad-t">{bad}</span>}
      </div>
    </div>
  )
}
