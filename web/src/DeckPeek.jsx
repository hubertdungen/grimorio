// Ver um deck sem sair de onde estás (Hall da fama, galeria de troféus): rato por cima = cartão rápido (capa, formato,
// cores, cartas-chave); clique = a lista inteira, só para ler (decks do meta incluídos). Os meus abrem-se na Biblioteca.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { img, coverOf, colorsOf, TYPE_LABEL } from './data.js'
import { FORMAT } from './formats.js'
import { Mana } from './ui.jsx'
import { tx } from './i18n.js'
import { loadDeck } from './peek.jsx'
import { showCardPeek, hideCardPeek } from './deckview.js'
import { useBackClose } from './backnav.js'

const ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land']
const groupsOf = (d, data) => {
  const g = {}
  for (const [n, q] of Object.entries(d.main || {})) { const c = data.byName.get(n); const t = c?.mt || 'Other'; (g[t] ||= []).push({ n, q, c }) }
  return ORDER.filter(t => g[t]).map(t => [t, g[t].sort((a, b) => (a.c?.cmc ?? 0) - (b.c?.cmc ?? 0) || a.n.localeCompare(b.n))]).concat(g.Other ? [['Other', g.Other]] : [])
}
const count = d => Object.values(d.main || {}).reduce((a, b) => a + b, 0) + (d.commanders?.length || 0)

export function PeekCard({ d, p, x, y, data }) {
  const f = FORMAT[d.format || p?.format]?.name || d.format || p?.format
  const c = coverOf(d, data), cols = colorsOf(d, data)
  const key = Object.entries(d.main || {}).map(([n, q]) => ({ n, q, c: data.byName.get(n) })).filter(o => o.c && o.c.mt !== 'Land').sort((a, b) => b.q - a.q || (a.c.er || 1e9) - (b.c.er || 1e9)).slice(0, 6)
  return (
    <div className="dpeek" style={{ left: Math.max(8, x), top: y }} role="tooltip">
      {c && <img src={img(c, 'art_crop')} alt="" />}
      <b>{d.name}</b>
      <small className="muted">{f ? `${f} · ` : ''}{tx('{n} cartas', { n: count(d) })} {cols.length > 0 && <Mana cost={cols.map(k => `{${k}}`).join('')} />}</small>
      {d.commanders?.length > 0 && <small>👑 {d.commanders.join(', ')}</small>}
      <ul>{key.map(o => <li key={o.n}><span>{o.q}×</span> {o.n}</li>)}</ul>
      <small className="muted">{tx('Clica para ver a lista')}</small>
    </div>
  )
}

// a lista inteira, só para ler: agrupada por tipo (quantidades e custos), comandante e sideboard à parte; rato por cima
// de uma carta = a imagem ao lado; toque/clique = a imagem grande (no telemóvel não há rato). `extra` = o que vem de fora
// (os troféus do deck, na galeria)
export function DeckView({ p, data, onClose, onOpen, extra }) {
  useBackClose(true, onClose)  // «voltar» do telemóvel fecha esta janela
  const [d, setD] = useState(null), [zoom, setZoom] = useState(null)
  useEffect(() => { loadDeck(p).then(x => setD(x || { name: p.name, main: {} })) }, [p])
  useEffect(() => { const k = e => { if (e.key === 'Escape') { if (zoom) setZoom(null); else onClose() } }; addEventListener('keydown', k); return () => { removeEventListener('keydown', k); hideCardPeek() } }, [onClose, zoom])
  const cover = d && coverOf(d, data), cols = d ? colorsOf(d, data) : []
  const line = (n, q) => {
    const c = data.byName.get(n)
    return <li key={n}><button className="plain" onClick={() => c && (hideCardPeek(), setZoom(c))} onMouseEnter={e => c && showCardPeek(e, c)} onMouseLeave={hideCardPeek}>
      <span className="dv-q">{q}</span><span className="dv-n">{n}</span>{c?.mc && <Mana cost={c.mc} />}</button></li>
  }
  const sec = (title, xs) => <section key={title}><h4>{title} <span className="muted small">{xs.reduce((a, o) => a + o.q, 0)}</span></h4><ul>{xs.map(o => line(o.n, o.q))}</ul></section>
  const side = d && Object.entries(d.side || {}).map(([n, q]) => ({ n, q, c: data.byName.get(n) })).sort((a, b) => (a.c?.cmc ?? 0) - (b.c?.cmc ?? 0) || a.n.localeCompare(b.n))
  return createPortal(
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal dview" role="dialog" aria-label={d?.name || p.name}>
        <header className="dv-head">
          {cover && <img src={img(cover, 'art_crop')} alt="" />}
          <span className="dv-t"><b>{d?.name || p.name}</b>
            {d && <small className="muted">{[FORMAT[d.format || p.format]?.name || d.format || p.format, tx('{n} cartas', { n: count(d) })].filter(Boolean).join(' · ')} {cols.length > 0 && <Mana cost={cols.map(k => `{${k}}`).join('')} />}</small>}
            {p.src !== 'meus' && <small className="muted">🔒 {tx('só para ler (deck do meta)')}</small>}</span>
          <span className="dv-btns">{p.src === 'meus' && onOpen && <button className="primary" onClick={() => { onClose(); onOpen(p.ref) }}>{tx('Abrir na Biblioteca')}</button>}
            <button onClick={onClose} aria-label={tx('Fechar')}>×</button></span>
        </header>
        {extra}
        {!d ? <p className="muted">{tx('A carregar…')}</p> : (
          <div className="dview-cols">
            {d.commanders?.length > 0 && sec(tx('Comandante'), d.commanders.map(n => ({ n, q: 1 })))}
            {groupsOf(d, data).map(([t, xs]) => sec(TYPE_LABEL[t] || tx('Outras'), xs))}
            {side?.length > 0 && sec(tx('Sideboard'), side)}
          </div>)}
        {zoom && <div className="dv-zoom" onClick={() => setZoom(null)} role="button" aria-label={tx('Fechar')}><img src={img(zoom, 'normal')} alt={zoom.n} />
          {!!zoom.df && <img src={img(zoom, 'normal', true)} alt="" />}</div>}
      </div>
    </div>, document.body)
}
