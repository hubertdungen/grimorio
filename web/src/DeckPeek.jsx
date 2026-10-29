// Ver um deck sem sair de onde estás (Hall da fama, galeria de troféus): rato por cima = cartão rápido (capa, formato,
// cores, cartas-chave); clique = a lista inteira, só para ler (decks do meta incluídos). Os meus abrem-se na Biblioteca.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { img, coverOf, colorsOf, TYPE_LABEL } from './data.js'
import { FORMAT } from './formats.js'
import { Mana } from './ui.jsx'
import { tx } from './i18n.js'
import { loadDeck } from './peek.jsx'

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

// a lista inteira, só para ler
export function DeckView({ p, data, onClose, onOpen }) {
  const [d, setD] = useState(null)
  useEffect(() => { loadDeck(p).then(x => setD(x || { name: p.name, main: {} })) }, [p])
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  return createPortal(
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal dview" role="dialog" aria-label={d?.name || p.name}>
        <div className="row-btns"><b>{d?.name || p.name}</b>{d && <span className="muted small">{[FORMAT[d.format || p.format]?.name || d.format || p.format, tx('{n} cartas', { n: count(d) })].filter(Boolean).join(' · ')}</span>}
          <span style={{ flex: 1 }} />{p.src === 'meus' && onOpen && <button className="primary" onClick={() => { onClose(); onOpen(p.ref) }}>{tx('Abrir na Biblioteca')}</button>}
          {p.src !== 'meus' && <span className="muted small">🔒 {tx('só para ler (deck do meta)')}</span>}
          <button onClick={onClose} aria-label={tx('Fechar')}>×</button></div>
        {!d ? <p className="muted">{tx('A carregar…')}</p> : (
          <div className="dview-cols">
            {d.commanders?.length > 0 && <section><h4>{tx('Comandante')}</h4><ul>{d.commanders.map(n => <li key={n}>1 {n}</li>)}</ul></section>}
            {groupsOf(d, data).map(([t, xs]) => (
              <section key={t}><h4>{TYPE_LABEL[t] || tx('Outras')} <span className="muted small">{xs.reduce((a, o) => a + o.q, 0)}</span></h4>
                <ul>{xs.map(o => <li key={o.n} title={o.n}><span>{o.q}</span> {o.n} {o.c?.mc && <Mana cost={o.c.mc} />}</li>)}</ul></section>))}
            {Object.keys(d.side || {}).length > 0 && <section><h4>{tx('Sideboard')} <span className="muted small">{Object.values(d.side).reduce((a, b) => a + b, 0)}</span></h4>
              <ul>{Object.entries(d.side).map(([n, q]) => <li key={n}><span>{q}</span> {n}</li>)}</ul></section>}
          </div>)}
      </div>
    </div>, document.body)
}
