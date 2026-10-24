// Seletor de decks do cabeçalho: pesquisa, separadores (Todos / ★ Favoritos / Recentes / formatos; os formatos a mais
// ficam em «⋯ mais») e lista com capa, cores e nº de cartas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { FORMAT } from './formats.js'
import { img } from './data.js'
import { Mana } from './ui.jsx'
import { tx } from './i18n.js'

const VISIBLE = 4  // formatos com separador próprio; os outros vão para «⋯ mais»
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch { return null } }
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function thumb(d, data) {
  if (d.coverImg) return d.coverImg
  const n = d.cover || d.commanders?.[0] || Object.entries(d.main || {}).map(([n, q]) => [data.byName.get(n), q]).filter(([c]) => c && c.mt !== 'Land').sort((a, b) => b[1] - a[1] || b[0].cmc - a[0].cmc)[0]?.[0]?.n
  const c = n && data.byName.get(n)
  return c ? img(c, 'art_crop') : null
}
const colors = (d, data) => 'WUBRG'.split('').filter(x => [...(d.commanders || []), ...Object.keys(d.main || {})].some(n => { const c = data.byName.get(n); return c && c.mt !== 'Land' && (c.ci || '').includes(x) }))

export default function DeckPicker({ decks, deck, data, onOpen }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState(() => ls('grimorio.picker.tab') || 'todos')
  const [more, setMore] = useState(false)
  const box = useRef(null), input = useRef(null)
  useEffect(() => { ls('grimorio.picker.tab', tab) }, [tab])
  useEffect(() => {
    if (!open) return
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', out)
    setTimeout(() => input.current?.focus(), 30)
    return () => document.removeEventListener('pointerdown', out)
  }, [open])
  const fmts = useMemo(() => {
    const m = {}
    for (const d of decks) m[d.format] = (m[d.format] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [decks])
  const shown = fmts.slice(0, VISIBLE), hidden = fmts.slice(VISIBLE)
  const list = useMemo(() => {
    let l = decks
    if (q.trim()) l = l.filter(d => norm(d.name).includes(norm(q)) || norm(FORMAT[d.format]?.name || d.format).includes(norm(q)))
    else if (tab === 'fav') l = l.filter(d => d.fav)
    else if (tab === 'recentes') l = [...l].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 10)
    else if (tab !== 'todos') l = l.filter(d => d.format === tab)
    return l
  }, [decks, q, tab])
  const pick = id => { setOpen(false); setQ(''); onOpen(id) }
  const cur = decks.find(d => d.id === deck.id)
  const t = cur && thumb(cur, data)
  const Tab = ({ k, children }) => <button className={tab === k && !q ? 'on' : ''} onClick={() => { setTab(k); setQ(''); setMore(false) }}>{children}</button>
  return (
    <div className="dpick" ref={box}>
      <button className="dpick-cur" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={tx('Escolher deck')}>
        {t ? <img src={t} alt="" /> : <span className="dpick-noimg">✦</span>}
        <span><b>{cur?.name || deck.name || tx('Deck novo')}</b><small>{FORMAT[deck.format]?.name || deck.format}{cur ? ` · ${tx('{n} carta|{n} cartas', { n: cur.count })}` : ''}</small></span>
        <i>▾</i>
      </button>
      {open && (
        <div className="dpick-pop" role="dialog" aria-label={tx('Os meus decks')} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && list[0]) pick(list[0].id) }}>
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar entre {n} decks…', { n: decks.length })} />
          <div className="dpick-tabs">
            <Tab k="todos">{tx('Todos')}</Tab>
            {decks.some(d => d.fav) && <Tab k="fav">{tx('★ Favoritos')}</Tab>}
            <Tab k="recentes">{tx('Recentes')}</Tab>
            {shown.map(([f, n]) => <Tab key={f} k={f}>{FORMAT[f]?.name || f} <i>{n}</i></Tab>)}
            {hidden.length > 0 && <span className="dpick-more">
              <button className={hidden.some(([f]) => f === tab) && !q ? 'on' : ''} onClick={() => setMore(m => !m)}>{hidden.some(([f]) => f === tab) ? FORMAT[tab]?.name || tab : tx('⋯ mais')} ▾</button>
              {more && <span className="dpick-menu">{hidden.map(([f, n]) => <Tab key={f} k={f}>{FORMAT[f]?.name || f} <i>{n}</i></Tab>)}</span>}
            </span>}
          </div>
          <ul className="dpick-list">
            {list.map(d => { const im = thumb(d, data), cs = colors(d, data); return (
              <li key={d.id}><button className={d.id === deck.id ? 'on' : ''} onClick={() => pick(d.id)}>
                {im ? <img src={im} alt="" loading="lazy" /> : <span className="dpick-noimg">✦</span>}
                <span className="dpick-name"><b>{d.fav ? '★ ' : ''}{d.name}</b><small>{FORMAT[d.format]?.name || d.format} · {tx('{n} carta|{n} cartas', { n: d.count })}</small></span>
                {cs.length > 0 && <Mana cost={cs.map(x => `{${x}}`).join('')} />}
              </button></li>
            ) })}
            {!list.length && <li className="muted small dpick-empty">{tx('Nenhum deck aqui.')}</li>}
          </ul>
          <button className="dpick-new" onClick={() => pick('')}>✦ {tx('Novo deck…')}</button>
        </div>
      )}
    </div>
  )
}
