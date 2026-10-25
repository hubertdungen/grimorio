// Biblioteca: os meus decks (abrir, duplicar, testar), o lixo (restaurar) e decks do meta para guardar como meus.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FORMATS, FORMAT } from './formats.js'
import { Empty, Mana, Stars } from './ui.jsx'
import { img, HUE, coverOf, colorsOf } from './data.js'
import ProfileImport from './ProfileImport.jsx'
import DeckSearch from './DeckSearch.jsx'
import DeckCompare, { similarity } from './DeckCompare.jsx'
import { ask, casualAsk } from './confirm.jsx'
import { BasicArtPicker, applyBasics } from './Basics.jsx'
import { tx, num, LOCALE } from './i18n.js'
import { trophyValue, deckSplit } from './trophyvalue.js'
import { SyncHint } from './Settings.jsx'

const META_FMTS = ['commander', 'duel', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern']
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch { return null } }

// rating: o normal em destaque e o casual pequeno («casual ★3,4»); um deck casual só tem o casual
function DeckRating({ d, rt, rtc }) {
  if (d.casual) return <span className="dbox-rt"><i className="badge cas" title={tx('Deck casual: pode violar as regras do formato e só joga em modo casual (Laboratório, torneios e Arena casuais)')}>casual</i><Stars r={rtc} label={tx('Rating casual: ')} /></span>
  return <span className="dbox-rt"><Stars r={rt} />{rtc && <small className="cas-st" title={tx('Rating casual (jogos em modo casual, com decks de todos os formatos): {s} de 6 estrelas · {n} jogos', { s: num(rtc.stars, 1), n: rtc.games }) + (rtc.prov ? tx(' · provisório') : '')}>casual ★{num(rtc.stars, 1)}</small>}</span>
}

// Troféus: pódios em torneios — ouro, prata e bronze (até 3 sobrepostos e «+N»); casuais em degradê com azul (como as
// estrelas). Passar o rato ou tocar mostra a lista. Só contam enquanto a lista não mudar mais de 10% (tournament.py trophies).
// torneio dos campeões: 1.º platina, 2.º safira, 3.º rubi (pedras preciosas, com o brilho da platina)
const MEDAL = { plat: ['#ffffff', '#9cc7f0'], safira: ['#bfe0ff', '#1f4fd1'], rubi: ['#ffc2cc', '#b3122f'], 1: ['#ffd98a', '#e9a93a'], 2: ['#f4f7fb', '#a9b4c2'], 3: ['#f0b27a', '#a8652f'] }
const CUP = 'M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A6 6 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A6 6 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3V3zm-1 4v1a2 2 0 0 0 1.2 1.8A6 6 0 0 1 6 9V7H5zm13 0v2a6 6 0 0 1-.2.8A2 2 0 0 0 19 8V7h-1z'
// forma do troféu por tipo de torneio (as cores continuam a ser as do lugar; azul nos casuais / não ranked)
const SHAPE = {
  elim: { d: CUP },
  dupla: { d: 'M8 1h8v3a4 4 0 0 1-8 0zM11 7.5h2V10h-2zM5 10h14v2a7 5 0 0 1-14 0zM10.5 16.5h3V19h3v3h-9v-3h3z' },
  suico: { d: 'M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM10 5.5V10H5.5v4H10v4.5h4V14h4.5v-4H14V5.5z', eo: true },
  liga: { d: 'M12 1.5l9 3v6.5c0 6-4 10-9 12-5-2-9-6-9-12V4.5zM12 6.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z', eo: true },
  mesas: { d: 'M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 1 1 0-5z', eo: true },
  gauntlet: { d: 'M10.6 1h2.8l1.1 3.2V15h-5V4.2zM5.5 15h13v2.4h-13zM10.7 17.4h2.6V21h-2.6zM9.5 21h5v2h-5z' },
  rei: { d: 'M2.5 7.5l4.7 3.6L12 3.5l4.8 7.6 4.7-3.6-1.9 11H4.4zM4.4 20h15.2v2.5H4.4z' },
  grupos: { d: 'M1.5 13.5h6.5V22H1.5zM8.8 8h6.4v14H8.8zM16 11h6.5v11H16z' },
  equipas: { d: 'M1.5 3.5h8.5v3a4.3 4.3 0 0 1-3.1 4.1v3.4h2v2.2H2.6V14h2v-3.4A4.3 4.3 0 0 1 1.5 6.5zM14 3.5h8.5v3a4.3 4.3 0 0 1-3.1 4.1v3.4h2v2.2h-6.8V14h2v-3.4A4.3 4.3 0 0 1 14 6.5zM1.5 18h21v3.5h-21z' },
}
export function Cup({ place, casual, off, kind = 'elim' }) {
  const id = `cup${useId().replace(/[^\w-]/g, '')}`, [hi, lo] = MEDAL[place] || MEDAL[1], sh = SHAPE[kind] || SHAPE.elim
  return (
    <svg className={`cup ${off ? 'off' : ''} ${place === 'plat' ? 'plat' : ''} ${place === 'safira' || place === 'rubi' ? `gem ${place}` : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        {casual ? <><stop offset="0" stopColor="#4ea8ff" /><stop offset=".55" stopColor={hi} /><stop offset="1" stopColor={lo} /></> : <><stop offset="0" stopColor={hi} /><stop offset="1" stopColor={lo} /></>}
      </linearGradient></defs>
      <path d={sh.d} fillRule={sh.eo ? 'evenodd' : undefined} fill={`url(#${id})`} stroke={casual ? '#4ea8ff' : '#0008'} strokeWidth=".8" />
    </svg>
  )
}
export const PLACE = { plat: tx('Platina: campeão dos campeões'), safira: tx('Safira: 2.º no torneio dos campeões'), rubi: tx('Rubi: 3.º no torneio dos campeões'), 1: tx('1.º lugar'), 2: tx('2.º lugar'), 3: tx('3.º lugar') }
export const TIERS = ['plat', 'safira', 'rubi', 1, 2, 3]
// tipo de torneio de cada troféu (para o texto ao passar por cima)
export const KIND = { elim: tx('Eliminação simples'), dupla: tx('Dupla eliminação'), suico: tx('Suíço'), liga: tx('Liga'), mesas: tx('Mesas'), gauntlet: tx('Gauntlet'), rei: tx('Rei da colina'), grupos: tx('Grupos + eliminação'), equipas: tx('Equipas') }
const BLUE = tx('troféu azul: casual ou não ranked')
export const tierOf = (place, champions) => (champions ? { 1: 'plat', 2: 'safira', 3: 'rubi' }[place] : place)
const tier = x => (x.platinum ? 'plat' : tierOf(x.place, x.champions))
const ptsOf = x => trophyValue({ tier: tier(x), kind: x.type, casual: x.casual, n: x.n, m: x.m })  // pontos que este troféu dá ao deck
const ptsTxt = x => (x.valid === false ? tx('não conta (0 pontos)') : tx('+{p} pontos', { p: ptsOf(x) }))
const label = x => [PLACE[tier(x)], KIND[x.type], `«${x.name}»`, x.casual && BLUE, ptsTxt(x)].filter(Boolean).join(' · ')
function Trophies({ list }) {
  const [open, setOpen] = useState(null)  // posição no ecrã (o cartão do deck corta o que sai dele)
  useEffect(() => {  // fecha ao tocar fora ou ao rolar a página (está preso ao ecrã)
    if (!open) return
    const c = e => { if (!e.target.closest?.('.tro')) setOpen(null) }
    const off = () => setOpen(null)
    document.addEventListener('pointerdown', c); addEventListener('scroll', off, true)
    return () => { document.removeEventListener('pointerdown', c); removeEventListener('scroll', off, true) }
  }, [open])
  if (!list?.length) return null
  const show = e => { const r = e.currentTarget.getBoundingClientRect(); setOpen({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 8, innerWidth - 330)) }) }
  const ok = list.filter(x => x.valid).sort((a, b) => TIERS.indexOf(tier(a)) - TIERS.indexOf(tier(b))), shown = ok.length ? ok : list.slice(0, 1)  // a platina à frente
  const n = p => ok.filter(x => tier(x) === p).length
  const sum = TIERS.filter(n).map(p => `${n(p)}× ${PLACE[p]}`).join(' · ') || tx('Nenhum troféu válido')
  return (
    <span className={`tro ${ok.length ? '' : 'lost'}`} onMouseEnter={show} onMouseLeave={() => setOpen(null)}>
      <button className="tro-ic" onClick={e => { e.stopPropagation(); if (open) setOpen(null); else show({ currentTarget: e.currentTarget.parentNode }) }} aria-expanded={!!open} aria-label={sum}>
        {shown.slice(0, 3).map((x, k) => <i key={`${x.tid}-${x.place}`} style={{ zIndex: 3 - k }} title={label(x)}><Cup place={tier(x)} casual={x.casual} off={!x.valid} kind={x.type} /></i>)}
        {shown.length > 3 && <small>+{shown.length - 3}</small>}
      </button>
      {open && createPortal(
        <span className="tro-pop" role="tooltip" style={open}>
          <b>{sum}</b>
          {list.map(x => (
            <span key={`${x.tid}-${x.place}`} className={`tro-row ${x.valid ? '' : 'off'}`}>
              <span className="tro-t"><Cup place={tier(x)} casual={x.casual} off={!x.valid} kind={x.type} /> {PLACE[tier(x)]} · {KIND[x.type] ? `${KIND[x.type]} · ` : ''}{x.name} <b className="tro-p">{ptsTxt(x)}</b></span>
              <small>{new Date(x.ts * 1000).toLocaleDateString(LOCALE)}{x.casual ? ` · ${tx('casual')}` : ''} · {tx('{n} decks', { n: x.n })} · {tx('{v}V {d}D', { v: x.rec[0], d: x.rec[1] })}{x.rec[2] ? ` ${x.rec[2]}E` : ''}{x.place > 1 && x.first.length ? ` · ${tx('1.º: {d}', { d: x.first.join(', ') })}` : x.second.length ? ` · ${tx('2.º: {d}', { d: x.second.join(', ') })}` : ''}</small>
              {!x.valid && <small className="tro-why">{tx('Não conta: a lista mudou {p} desde este torneio (máx. 10%)', { p: `${Math.round((1 - x.same) * 100)}%` })}</small>}
            </span>
          ))}
        </span>, document.body)}
    </span>
  )
}

// ícones em SVG (os emojis ⚔ ⧉ 🖼 🗑 saíam a preto e branco e desalinhados no Windows; assim são iguais em todo o lado)
const ICONS = {
  play: <><path d="M4 4l10 10M11 17l6-6M16 16l4 4" /><path d="M20 4L10 14M7 11l6 6M8 16l-4 4" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  dice: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="15" cy="9" r="1.2" fill="currentColor" /><circle cx="9" cy="15" r="1.2" fill="currentColor" /></>,
}
export const Ico = ({ n }) => <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">{ICONS[n]}</svg>

// Escolher a capa: popup com todas as cartas do deck (deck, sideboard, comandantes; terrenos no fim), pesquisa,
// link ou imagem carregada. As artes próprias (TappedOut) vêm do deck completo.
function CoverPicker({ d, data, setCover, setImg, onClose }) {
  const [full, setFull] = useState(null), [q, setQ] = useState(''), [link, setLink] = useState('')
  useEffect(() => { fetch(`/api/decks/${d.id}`).then(r => r.json()).then(setFull).catch(() => setFull({})) }, [d.id])
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  const art = full?.art || {}, cur = coverOf(d, data)
  const cards = useMemo(() => {
    const x = full || d, names = [...new Set([...(x.commanders || []), ...Object.keys(x.main || {}), ...Object.keys(x.side || {})])]
    const cs = names.map(n => data.byName.get(n)).filter(Boolean)
    return [...cs.filter(c => c.mt !== 'Land'), ...cs.filter(c => c.mt === 'Land')]
  }, [full, d, data])
  const shown = q.trim() ? cards.filter(c => c.n.toLowerCase().includes(q.trim().toLowerCase())) : cards
  const done = f => { f(); onClose() }
  return createPortal(
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal cover-pick" role="dialog" aria-label={tx('Escolher a capa')}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>{tx('Capa de «{name}»', { name: d.name })}</h3>
        <div className="cover-own">
          <form onSubmit={e => { e.preventDefault(); if (link.trim()) done(() => setImg(d.id, { url: link.trim() })) }}>
            <input value={link} onChange={e => setLink(e.target.value)} placeholder={tx('Link de uma imagem (https://…)')} inputMode="url" /><button disabled={!link.trim()}>{tx('Usar')}</button>
          </form>
          <label className="dbox-up">⬆ {tx('Carregar imagem')}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { const f = e.target.files?.[0]; if (f) done(() => setImg(d.id, { file: f })) }} /></label>
          {d.coverImg && <button className="link small" onClick={() => done(() => setImg(d.id, { url: null }))}>{tx('tirar a imagem (volta à carta)')}</button>}
        </div>
        <input className="cover-q" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar uma carta do deck…')} />
        <div className="cover-grid">{shown.map(c => {
          const own = art[c.n], on = own ? d.coverImg === own : !d.coverImg && c.n === cur?.n
          return (
            <button key={c.n} className={on ? 'on' : ''} onClick={() => done(() => (own ? setImg(d.id, { url: own }) : setCover(d.id, c.n)))} title={own ? tx('{name} (arte própria)', { name: c.n }) : c.n}>
              <img src={img(c, 'normal', false, own)} alt={c.n} loading="lazy" />
            </button>
          )
        })}{!shown.length && <p className="muted small">{tx('Nenhuma carta com esse nome.')}</p>}</div>
      </div>
    </div>, document.body)
}

function DeckBox({ d, data, openDeck, goTab, duplicate, setCover, setImg, rt, rtc, tro, tp, selected, onSelect, onFav, onCom, onDelete }) {
  const [pick, setPick] = useState(false)
  const c = coverOf(d, data), cols = colorsOf(d, data)
  const edge = cols.length ? cols.map(x => HUE[x]) : ['#8a8a99']
  const bg = edge.length > 1 ? `linear-gradient(135deg, ${edge.join(', ')})` : edge[0]
  const open = t => openDeck(d.id).then(() => goTab(t))
  return (
    <div className={`dbox ${selected ? 'sel' : ''}`} style={{ '--edge': bg }} data-deck={d.id}>
      <label className="dbox-check" title={tx('Selecionar (para comparar ou mudar vários de uma vez)')}><input type="checkbox" checked={!!selected} onChange={() => onSelect(d.id)} /></label>
      <button className={`dbox-fav ${d.fav ? 'on' : ''}`} onClick={() => onFav(d)} title={d.fav ? tx('Tirar dos favoritos') : tx('Pôr nos favoritos')}>{d.fav ? '★' : '☆'}</button>
      <div className="dbox-top">
      <button className="dbox-art" onClick={() => open('deck')} title={d.coverImg ? tx('Capa: imagem própria') : c ? tx('Capa: {name}', { name: c.n }) : d.name}>
        {d.coverImg ? <img src={d.coverImg} alt="" loading="lazy" /> : c && d.art?.[c.n] ? <img className="own-art" src={d.art[c.n]} alt={c.n} loading="lazy" /> : c ? <img src={img(c, 'art_crop')} alt={c.n} loading="lazy" /> : <span className="dbox-noart">✦</span>}
        <span className="dbox-fmt">{FORMAT[d.format]?.name || d.format}{d.community && <span title={tx('Deck da comunidade (de outra pessoa)')}> · <Ico n="globe" /> {tx('Comunidade')}</span>}</span>
      </button>{tro?.length > 0 && <span className="dbox-tro"><Trophies list={tro} />{tp && <b className="tro-pts" title={`${tx('{p} pontos de troféus · n.º {r} de {n} no ranking dos teus decks', { p: tp.p, r: tp.rank, n: tp.of })}${tp.blue ? `\n${tx('{a} normais (ranked) + {b} de troféus azuis (casual ou não ranked, valem metade)', { a: tp.p - tp.blue, b: tp.blue })}` : ''}`}>{tp.rank === 1 ? '👑 ' : `#${tp.rank} · `}{tp.p}</b>}</span>}</div>
      <div className="dbox-body">
        <b title={d.name}>{d.name}</b>
        <span className="dbox-l1">{cols.length ? <Mana cost={cols.map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}<span className="muted small">{tx('{n} carta|{n} cartas', { n: d.count })} · {when(d.updated)}</span><button className={`dbox-com ${d.community ? 'on' : ''}`} onClick={() => onCom(d)} title={d.community ? tx('Deck da comunidade (de outra pessoa) — clica para passar a meu') : tx('Deck meu — clica para marcar como da comunidade (de outra pessoa)')}>{d.community ? '🌐' : '🧙'}</button></span>
        <span className="dbox-l2"><DeckRating d={d} rt={rt} rtc={rtc} /></span>
        <span className="row-btns">
          <button onClick={() => open('deck')}>{tx('Abrir')}</button>
          <button className="ib" onClick={() => open('teste')} title={tx('Testar no Forge')} aria-label={tx('Testar no Forge')}><Ico n="play" /></button>
          <button className="ib" onClick={() => duplicate(d.id)} title={tx('Duplicar')} aria-label={tx('Duplicar')}><Ico n="copy" /></button>
          <button className={`ib ${pick ? 'on' : ''}`} onClick={() => setPick(true)} title={tx('Escolher a capa: carta do deck, link ou imagem tua')} aria-label={tx('Escolher a capa')}><Ico n="image" /></button>
          <button className="ib" onClick={() => onDelete(d)} title={tx('Apagar (vai para o lixo)')} aria-label={tx('Apagar')}><Ico n="trash" /></button>
        </span>
        {pick && <CoverPicker {...{ d, data, setCover, setImg }} onClose={() => setPick(false)} />}
      </div>
    </div>
  )
}

const when = t => new Date(t * 1000).toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' })

export default function Library({ data, openDeck, goTab, say, importLinks = '', focus = null }) {
  const [mine, setMine] = useState([])
  const [trash, setTrash] = useState([])
  const [me, setMe] = useState('')
  const [mf, setMf] = useState('modern')
  const [meta, setMeta] = useState([])
  const [busy, setBusy] = useState('')
  const [rt, setRt] = useState({})  // estrelas dos ratings
  const [tro, setTro] = useState({})  // troféus por deck
  useEffect(() => { fetch('/api/tournaments/trophies').then(r => (r.ok ? r.json() : {})).then(setTro).catch(() => {}) }, [])
  const [view, setView] = useState(() => ls('grimorio.lib.view') || 'grelha')
  const [sel, setSel] = useState([]), [cmp, setCmp] = useState(false)
  const toggleSel = id => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  // alterações em massa aos selecionados: o mesmo GET+PUT de um deck, campo posto a um valor (não alternado)
  const bulk = async (patch, msg) => {
    const ids = sel.filter(id => mine.some(d => d.id === id && Object.keys(patch).some(k => !!d[k] !== patch[k])))
    for (const id of ids) {
      const full = await (await fetch(`/api/decks/${id}`)).json()
      await fetch(`/api/decks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...full, ...patch }) })
    }
    setMine(m => m.map(x => (sel.includes(x.id) ? { ...x, ...patch } : x)))
    say(tx(msg, { n: ids.length }))
  }
  const [bulkDel, setBulkDel] = useState(false), [bulkLand, setBulkLand] = useState(false)
  const landsSel = async map => {  // arte dos básicos nos decks selecionados
    setBulkLand(false)
    const n = await applyBasics(sel, map)
    say(tx('Básicos mudados em {n} deck|Básicos mudados em {n} decks', { n })); reload()
  }
  const removeSel = async () => {
    for (const id of sel) await fetch(`/api/decks/${id}`, { method: 'DELETE' })
    say(tx('{n} deck foi para o lixo (30 dias).|{n} decks foram para o lixo (30 dias).', { n: sel.length })); setSel([]); setBulkDel(false); reload()
  }
  const toggleCom = async d => {  // meu ↔ comunidade (deck de outra pessoa guardado na Biblioteca)
    const full = await (await fetch(`/api/decks/${d.id}`)).json()
    await fetch(`/api/decks/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...full, community: !d.community }) })
    setMine(m => m.map(x => (x.id === d.id ? { ...x, community: !d.community } : x)))
  }
  const toggleFav = async d => {
    const full = await (await fetch(`/api/decks/${d.id}`)).json()
    await fetch(`/api/decks/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...full, fav: !d.fav }) })
    setMine(m => m.map(x => (x.id === d.id ? { ...x, fav: !d.fav } : x)))
  }
  const remove = async d => {
    if (!(await ask('apagar', { title: tx('Apagar «{name}»?', { name: d.name }), body: tx('Vai para o lixo e podes recuperá-lo durante 30 dias.'), ok: tx('Apagar') }))) return
    await fetch(`/api/decks/${d.id}`, { method: 'DELETE' }); setSel(s => s.filter(x => x !== d.id))
    say(tx('«{name}» foi para o lixo (30 dias).', { name: d.name })); reload()
  }
  // formatos fechados (▸) e filtro «só este formato»; lembrados neste browser
  const [closed, setClosed] = useState(() => { try { return JSON.parse(ls('grimorio.lib.fechados') || '{}') } catch { return {} } })
  const [only, setOnly] = useState(() => ls('grimorio.lib.so') || '')
  useEffect(() => { ls('grimorio.lib.fechados', JSON.stringify(closed)) }, [closed])
  useEffect(() => { ls('grimorio.lib.so', only) }, [only])
  useEffect(() => { ls('grimorio.lib.view', view) }, [view])
  const reload = () => {
    fetch('/api/decks').then(r => r.json()).then(setMine).catch(() => {})
    fetch('/api/decks/trash').then(r => r.json()).then(setTrash).catch(() => {})
  }
  useEffect(() => { reload(); fetch('/api/ratings/stars').then(r => r.json()).then(setRt).catch(() => {}); fetch('/api/me').then(r => r.json()).then(j => setMe(j.user)).catch(() => {}) }, [])
  useEffect(() => { setMeta([]); fetch(`/api/sim/opponents?format=${mf}`).then(r => r.json()).then(setMeta).catch(() => setMeta([])) }, [mf])

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(r => r.json())
  const duplicate = async id => { const d = await (await fetch(`/api/decks/${id}`)).json(); if (!(await ask('duplicar', { title: tx('Duplicar «{name}»?', { name: d.name }), body: tx('Fica uma cópia nova na Biblioteca, com «(cópia)» no nome.'), ok: tx('Duplicar'), danger: false }))) return; const n = await post('/api/decks', { ...d, id: undefined, name: tx('{name} (cópia)', { name: d.name }) }); say(tx('Duplicado: {name}', { name: n.name })); reload() }
  const setCover = async (id, name) => {
    const d = await (await fetch(`/api/decks/${id}`)).json()
    await fetch(`/api/decks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, cover: name, coverImg: null }) }); setMine(m => m.map(x => (x.id === id ? { ...x, cover: name, coverImg: null } : x)))
  }
  // capa própria: {url} (link https ou null para tirar) ou {file} (imagem carregada, até 6 MB)
  const setImg = async (id, { url, file }) => {
    if (file && file.size > 6e6) return say(tx('A imagem tem de ter até 6 MB.'))
    const r = await fetch(`/api/decks/${id}/cover`, file ? { method: 'POST', headers: { 'Content-Type': file.type }, body: file }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
    const j = await r.json()
    if (!r.ok) return say(j.erro || tx('Não consegui guardar a imagem.'))
    setMine(m => m.map(x => (x.id === id ? { ...x, coverImg: j.coverImg } : x))); say(j.coverImg ? tx('Capa atualizada.') : tx('Capa: volta à carta.'))
  }
  const restore = async id => { await post(`/api/decks/${id}/restore`); say(tx('Deck restaurado.')); reload() }
  const saveMeta = async o => {
    setBusy(o.id)
    const d = await (await fetch(`/api/sim/opponents/${encodeURIComponent(o.id)}`)).json()
    const n = await post('/api/decks', { name: `${d.name} (${o.source})`, format: mf === 'duel' ? 'duel' : mf, commanders: d.commanders || [], main: d.main, side: d.side || {}, seeds: [], notes: d.url ? tx('Origem: {url}', { url: d.url }) : '', count: Object.values(d.main).reduce((a, b) => a + b, 0) + (d.commanders || []).length })
    setBusy(''); say(tx('Guardado nos teus decks: {name}', { name: n.name })); reload()
  }
  // ordenação (guardada): dentro de cada grupo de formato
  const [sort, setSortS] = useState(() => ls('grimorio.lib.sort') || 'alterado')
  const setSort = v => { setSortS(v); ls('grimorio.lib.sort', v) }
  // pontos de troféus de cada deck (soma do valor dos troféus que ainda contam) e o lugar no ranking dos meus decks
  const tpts = useMemo(() => {
    const v = mine.map(d => [d.id, (tro[d.id] || []).filter(x => x.valid).reduce((t, x) => t + trophyValue({ tier: tier(x), kind: x.type, casual: x.casual, n: x.n, m: x.m }), 0)])
    const r = v.filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])
    return Object.fromEntries(r.map(([id, p], k) => [id, { p, rank: k + 1, of: r.length, blue: deckSplit(tro[id]).blue }]))
  }, [mine, tro])
  const sorted = useMemo(() => {
    const W = 'WUBRG', st = (d, k) => rt[`deck:${d.id}`]?.[k] ?? -1
    const won = d => tpts[d.id]?.p || 0  // valor dos troféus (trophyvalue.js)
    const key = {
      alterado: d => -(d.updated || 0), criado: d => -(d.created || d.updated || 0), nome: null,
      cores: d => { const c = colorsOf(d, data); return c.length * 100 + (c.length ? W.indexOf(c[0]) * 10 + W.indexOf(c[c.length - 1]) : 0) },
      amarelo: d => -st(d, 'stars'), azul: d => -st(d, 'blue'), vermelho: d => -st(d, 'red'),
      casual: d => -(rt[`deck:${d.id}|casual`]?.stars ?? -1), trofeus: d => -won(d),
    }[sort]
    const byName = (a, b) => a.name.localeCompare(b.name, LOCALE, { sensitivity: 'base' })
    return [...mine].sort((a, b) => (key ? key(a) - key(b) : 0) || byName(a, b))
  }, [mine, sort, rt, tpts, data])
  const byFmt = {}
  for (const d of sorted) (byFmt[d.format] ||= []).push(d)
  // deck pedido de fora (pódio): mostra todos os formatos, abre o grupo dele, desliza até ao cartão e acende-o
  const focused = useRef(null)
  useEffect(() => {
    if (!focus || focused.current === focus.n || !mine.some(d => d.id === focus.id)) return
    focused.current = focus.n
    const f = mine.find(d => d.id === focus.id).format
    setOnly(''); setClosed(c => { const n = { ...c }; delete n[f]; return n })
    setTimeout(() => {
      const el = [...document.querySelectorAll(`[data-deck="${focus.id}"]`)].pop()
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2400)
    }, 250)
  }, [focus, mine])
  // decks repetidos ou muito parecidos (≥80% da lista igual, mesmo com nomes e capas diferentes): grupos ligados
  const dupes = useMemo(() => {
    const ds = mine.filter(d => Object.keys(d.main || {}).length), up = ds.map((_, i) => i), sim = {}
    const root = i => (up[i] === i ? i : (up[i] = root(up[i])))
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const x = similarity(data, ds[i], ds[j])
      if (x >= 0.8) { up[root(i)] = root(j); sim[`${ds[i].id}|${ds[j].id}`] = x }
    }
    const g = {}
    ds.forEach((d, i) => (g[root(i)] ||= []).push(d))
    return Object.values(g).filter(x => x.length > 1).map(x => ({ decks: x, top: Math.max(...x.flatMap((a, i) => x.slice(i + 1).map(b => sim[`${a.id}|${b.id}`] || sim[`${b.id}|${a.id}`] || 0))) }))
      .sort((a, b) => b.top - a.top)
  }, [mine, data])
  // grupos ignorados (pelos ids do grupo: se entrar outro deck parecido, o grupo volta a aparecer); lembrados neste browser
  const [ign, setIgn] = useState(() => { try { return JSON.parse(ls('grimorio.lib.parecidos') || '[]') } catch { return [] } })
  useEffect(() => { ls('grimorio.lib.parecidos', JSON.stringify(ign)) }, [ign])
  const gid = g => g.decks.map(d => d.id).sort().join('|')
  const shownDupes = dupes.filter(g => !ign.includes(gid(g))), hiddenDupes = dupes.length - shownDupes.length
  const favs = sorted.filter(d => d.fav)
  const fmts = [...(favs.length ? [['★', favs]] : []), ...Object.entries(byFmt).sort((a, b) => b[1].length - a[1].length)]
  const fname = f => (f === '★' ? tx('★ Favoritos') : FORMAT[f]?.name || f)
  return (
    <div className="view library">
      <section className="card">
        <h3>{tx('Os meus decks')} <span className="muted small">{mine.length}{me ? ` · ${me}` : ''}</span>
          <select className="small lib-sort" value={sort} onChange={e => setSort(e.target.value)} aria-label={tx('Ordenar')}>
            {[['alterado', tx('Ordenar: última alteração')], ['criado', tx('Ordenar: data de criação')], ['nome', tx('Ordenar: nome')], ['cores', tx('Ordenar: cores')],
              ['amarelo', tx('Ordenar: rating (amarelo)')], ['azul', tx('Ordenar: todos os jogos (azul)')], ['vermelho', tx('Ordenar: objetivo (vermelho)')], ['casual', tx('Ordenar: rating casual')],
              ['trofeus', tx('Ordenar: troféus')]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="seg small">{[['grelha', tx('▦ Grelha')], ['lista', tx('☰ Lista')]].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</span></h3>
        <SyncHint />
        {!mine.length && <Empty>{tx('Ainda não tens decks guardados. Usa «✦ Novo deck» ou guarda um do meta abaixo.')}</Empty>}
        {sel.length > 0 && <div className="cmp-bar">
          <b>{tx('{n} deck selecionado|{n} decks selecionados', { n: sel.length })}</b>
          <button className="primary" disabled={sel.length < 2 || sel.length > 4} title={tx('escolhe 2 a 4 para comparar')} onClick={() => setCmp(true)}>⇄ {tx('Comparar')}</button>
          <span className="cmp-mass">
            <button onClick={() => bulk({ community: true }, '{n} deck passou a ser da comunidade|{n} decks passaram a ser da comunidade')}>🌐 {tx('Comunidade')}</button>
            <button onClick={() => bulk({ community: false }, '{n} deck passou a ser teu|{n} decks passaram a ser teus')}>🧙 {tx('Meus')}</button>
            <button onClick={async () => (await casualAsk(true, sel.length)) && bulk({ casual: true }, '{n} deck passou a casual|{n} decks passaram a casual')}><Ico n="dice" /> {tx('Casual')}</button>
            <button onClick={async () => (await casualAsk(false, sel.length)) && bulk({ casual: false }, '{n} deck deixou de ser casual|{n} decks deixaram de ser casual')}>{tx('Tirar casual')}</button>
            <button onClick={() => bulk({ fav: true }, '{n} deck nos favoritos|{n} decks nos favoritos')}>★ {tx('Favoritos')}</button>
            <button onClick={() => bulk({ fav: false }, '{n} deck tirado dos favoritos|{n} decks tirados dos favoritos')}>☆ {tx('Tirar favorito')}</button>
            <button onClick={() => setBulkLand(true)}>⛰ {tx('Terrenos básicos')}</button>
            <button className="danger" onClick={() => setBulkDel(true)}><Ico n="trash" /> {tx('Apagar')}</button>
          </span>
          <button className="link small" onClick={() => setSel([])}>{tx('limpar')}</button>
        </div>}
        {bulkLand && <BasicArtPicker title={tx('Arte dos terrenos básicos em {n} decks', { n: sel.length })} applyLabel={tx('Aplicar a {n} decks', { n: sel.length })} onClose={() => setBulkLand(false)} onApply={landsSel} />}
        {bulkDel && <div className="modal-bg" onClick={() => setBulkDel(false)}><div className="modal" onClick={e => e.stopPropagation()}>
          <h3>{tx('Apagar {n} decks?', { n: sel.length })}</h3>
          <p className="muted small">{sel.map(id => mine.find(d => d.id === id)?.name).filter(Boolean).join(' · ')}</p>
          <p className="small">{tx('Vão para o lixo e podes recuperá-los durante 30 dias.')}</p>
          <div className="row"><button className="danger" onClick={removeSel}><Ico n="trash" /> {tx('Apagar')}</button><button onClick={() => setBulkDel(false)}>{tx('Cancelar')}</button></div>
        </div></div>}
        {cmp && <DeckCompare data={data} decks={sel.map(id => mine.find(d => d.id === id)).filter(Boolean)} onClose={() => setCmp(false)}
          onOpen={id => { setCmp(false); openDeck(id).then(() => goTab('deck')) }} onFav={toggleFav} onDelete={remove} rt={rt} trophies={d => (tro[d.id]?.length ? <Trophies list={tro[d.id]} /> : null)} />}
        {fmts.length > 1 && <div className="fmt-chips">
          <button className={!only ? 'on' : ''} onClick={() => setOnly('')}>{tx('Todos')} <i>{mine.length}</i></button>
          {fmts.map(([f, ds]) => <button key={f} className={only === f ? 'on' : ''} onClick={() => { setOnly(only === f ? '' : f); setClosed(c => { const n = { ...c }; delete n[f]; return n }) }}>{fname(f)} <i>{ds.length}</i></button>)}
          <span className="fmt-all"><button className="link small" onClick={() => setClosed({})}>{tx('abrir todos')}</button><button className="link small" onClick={() => setClosed(Object.fromEntries(fmts.map(([f]) => [f, 1])))}>{tx('fechar todos')}</button></span>
        </div>}
        {fmts.filter(([f]) => !only || f === only).map(([f, ds]) => (
          <div key={f} className={`fmt-sec ${closed[f] ? 'shut' : ''}`}>
            <button className="fmt-head" onClick={() => setClosed(c => { const n = { ...c }; if (n[f]) delete n[f]; else n[f] = 1; return n })} aria-expanded={!closed[f]}>
              <i className="chev">▾</i><b>{fname(f)}</b><span className="muted">{ds.length} {ds.length === 1 ? 'deck' : 'decks'}</span><span className="fmt-line" />
            </button>
            {view === 'grelha' ? <div className="dgrid">{ds.map(d => <DeckBox key={d.id} d={d} data={data} openDeck={openDeck} goTab={goTab} duplicate={duplicate} setCover={setCover} setImg={setImg} rt={rt[`deck:${d.id}`]} rtc={rt[`deck:${d.id}|casual`]} tro={tro[d.id]} tp={tpts[d.id]} onCom={toggleCom} selected={sel.includes(d.id)} onSelect={toggleSel} onFav={toggleFav} onDelete={remove} />)}</div> : <ul className="lib-list">{ds.map(d => (
              <li key={d.id}>
                <button className="link plain" onClick={() => openDeck(d.id).then(() => goTab('deck'))}><b>{d.name}</b></button>
                <span className="muted small">{tx('{n} carta|{n} cartas', { n: d.count })} · {when(d.updated)}</span>
                <Trophies list={tro[d.id]} />
                <DeckRating d={d} rt={rt[`deck:${d.id}`]} rtc={rt[`deck:${d.id}|casual`]} />
                <span className="row-btns">
                  <button onClick={() => openDeck(d.id).then(() => goTab('deck'))}>{tx('Abrir')}</button>
                  <button onClick={() => openDeck(d.id).then(() => goTab('teste'))}>{tx('Testar no Forge')}</button>
                  <button onClick={() => duplicate(d.id)}>{tx('Duplicar')}</button>
                </span>
              </li>
            ))}</ul>}
          </div>
        ))}
      </section>

      {dupes.length > 0 && <section className="card dupes">
        <h3>{tx('Decks repetidos ou muito parecidos')} <span className="muted small">{tx('{n} grupo|{n} grupos', { n: shownDupes.length })} · {tx('mesmo com nomes e capas diferentes')}</span>
          {shownDupes.length > 1 && <button className="link small" onClick={() => setIgn(i => [...i, ...shownDupes.map(gid)])}>{tx('ignorar todos')}</button>}</h3>
        {hiddenDupes > 0 && <p className="muted small">{tx('{n} grupo ignorado|{n} grupos ignorados', { n: hiddenDupes })} · <button className="link small" onClick={() => setIgn([])}>↻ {tx('voltar a verificar')}</button></p>}
        {shownDupes.map(g => (
          <div key={gid(g)} className="dupe-g">
            <span className={`chip ${g.top >= 0.999 ? 'bad' : ''}`}>{g.top >= 0.999 ? tx('iguais') : tx('{p}% iguais', { p: Math.round(g.top * 100) })}</span>
            {g.decks.map(d => <span key={d.id} className="dupe-d"><b>{d.name}</b><small className="muted">{FORMAT[d.format]?.name || d.format} · {when(d.updated)}</small>
              <button onClick={() => remove(d)} className="ib" title={tx('Apagar este (vai para o lixo)')} aria-label={tx('Apagar')}><Ico n="trash" /></button></span>)}
            <button className="primary" onClick={() => { setSel(g.decks.slice(0, 4).map(d => d.id)); setCmp(true) }}>⇄ {tx('Comparar')}</button>
            <button className="link small" onClick={() => setIgn(i => [...i, gid(g)])} title={tx('Esconder este grupo: são decks diferentes de propósito')}>{tx('ignorar')}</button>
          </div>
        ))}
      </section>}

      <section className="card">
        <h3>{tx('Procurar decks públicos')} <span className="muted small">{tx('decks de jogadores no Archidekt, com filtros')}</span></h3>
        <DeckSearch data={data} say={say} onDone={reload} />
      </section>

      <section className="card">
        <h3>{tx('Importar decks de um perfil')} <span className="muted small">{tx('escolhe quais entram')}</span></h3>
        <ProfileImport data={data} initial={importLinks} say={say} onDone={reload} />
      </section>

      <section className="card">
        <h3>{tx('Decks do meta')} <span className="muted small">{tx('listas reais recentes (MTGTop8; EDHREC para Commander)')}</span></h3>
        <select value={mf} onChange={e => setMf(e.target.value)}>{META_FMTS.map(f => <option key={f} value={f}>{FORMAT[f]?.name || FORMATS.find(x => x.key === f)?.name || f}</option>)}</select>
        <ul className="lib-list">{meta.map(o => (
          <li key={o.id}>
            <b>{o.name}</b><span className="muted small">{o.share ? tx('{p}% do meta', { p: Math.round(o.share * 100) }) : ''} · {o.source}</span>
            <span className="row-btns"><button disabled={busy === o.id} onClick={() => saveMeta(o)}>{busy === o.id ? tx('A guardar…') : tx('Guardar nos meus decks')}</button></span>
          </li>
        ))}</ul>
        {!meta.length && <p className="muted small">{tx('Sem decks do meta para este formato.')}</p>}
      </section>

      {trash.length > 0 && (
        <section className="card">
          <h3>{tx('Lixo')} <span className="muted small">{tx('decks apagados ficam aqui 30 dias')}</span></h3>
          <ul className="lib-list">{trash.map(d => (
            <li key={d.id}><b>{d.name}</b><span className="muted small">{FORMAT[d.format]?.name || d.format} · {tx('apagado a {date}', { date: when(d.deleted) })}</span>
              <span className="row-btns"><button onClick={() => restore(d.id)}>{tx('Restaurar')}</button></span></li>
          ))}</ul>
        </section>
      )}
    </div>
  )
}
