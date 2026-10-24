// Biblioteca: os meus decks (abrir, duplicar, testar), o lixo (restaurar) e decks do meta para guardar como meus.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FORMATS, FORMAT } from './formats.js'
import { Empty, Mana, Stars } from './ui.jsx'
import { img, HUE, coverOf, colorsOf } from './data.js'
import ProfileImport from './ProfileImport.jsx'
import DeckSearch from './DeckSearch.jsx'
import DeckCompare, { ConfirmDelete, similarity } from './DeckCompare.jsx'
import { tx, num, LOCALE } from './i18n.js'
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
const MEDAL = { plat: ['#ffffff', '#9cc7f0'], 1: ['#ffd98a', '#e9a93a'], 2: ['#f4f7fb', '#a9b4c2'], 3: ['#f0b27a', '#a8652f'] }
const CUP = 'M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A6 6 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A6 6 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3V3zm-1 4v1a2 2 0 0 0 1.2 1.8A6 6 0 0 1 6 9V7H5zm13 0v2a6 6 0 0 1-.2.8A2 2 0 0 0 19 8V7h-1z'
function Cup({ place, casual, off }) {
  const id = `cup${useId().replace(/[^\w-]/g, '')}`, [hi, lo] = MEDAL[place] || MEDAL[1]
  return (
    <svg className={`cup ${off ? 'off' : ''} ${place === 'plat' ? 'plat' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        {casual ? <><stop offset="0" stopColor="#4ea8ff" /><stop offset=".55" stopColor={hi} /><stop offset="1" stopColor={lo} /></> : <><stop offset="0" stopColor={hi} /><stop offset="1" stopColor={lo} /></>}
      </linearGradient></defs>
      <path d={CUP} fill={`url(#${id})`} stroke={casual ? '#4ea8ff' : '#0008'} strokeWidth=".8" />
    </svg>
  )
}
const PLACE = { plat: tx('Platina: campeão dos campeões'), 1: tx('1.º lugar'), 2: tx('2.º lugar'), 3: tx('3.º lugar') }
const tier = x => (x.platinum ? 'plat' : x.place)
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
  const ok = list.filter(x => x.valid).sort((a, b) => !!b.platinum - !!a.platinum), shown = ok.length ? ok : list.slice(0, 1)  // a platina à frente
  const n = p => ok.filter(x => tier(x) === p).length
  const sum = ['plat', 1, 2, 3].filter(n).map(p => `${n(p)}× ${PLACE[p]}`).join(' · ') || tx('Nenhum troféu válido')
  return (
    <span className={`tro ${ok.length ? '' : 'lost'}`} onMouseEnter={show} onMouseLeave={() => setOpen(null)}>
      <button className="tro-ic" onClick={e => { e.stopPropagation(); if (open) setOpen(null); else show({ currentTarget: e.currentTarget.parentNode }) }} aria-expanded={!!open} aria-label={sum}>
        {shown.slice(0, 3).map((x, k) => <i key={`${x.tid}-${x.place}`} style={{ zIndex: 3 - k }}><Cup place={tier(x)} casual={x.casual} off={!x.valid} /></i>)}
        {shown.length > 3 && <small>+{shown.length - 3}</small>}
      </button>
      {open && createPortal(
        <span className="tro-pop" role="tooltip" style={open}>
          <b>{sum}</b>
          {list.map(x => (
            <span key={`${x.tid}-${x.place}`} className={`tro-row ${x.valid ? '' : 'off'}`}>
              <span className="tro-t"><Cup place={tier(x)} casual={x.casual} off={!x.valid} /> {PLACE[tier(x)]} · {x.name}</span>
              <small>{new Date(x.ts * 1000).toLocaleDateString(LOCALE)}{x.casual ? ` · ${tx('casual')}` : ''} · {tx('{n} decks', { n: x.n })} · {tx('{v}V {d}D', { v: x.rec[0], d: x.rec[1] })}{x.rec[2] ? ` ${x.rec[2]}E` : ''}{x.place > 1 && x.first.length ? ` · ${tx('1.º: {d}', { d: x.first.join(', ') })}` : x.second.length ? ` · ${tx('2.º: {d}', { d: x.second.join(', ') })}` : ''}</small>
              {!x.valid && <small className="tro-why">{tx('Não conta: a lista mudou {p} desde este torneio (máx. 10%)', { p: `${Math.round((1 - x.same) * 100)}%` })}</small>}
            </span>
          ))}
        </span>, document.body)}
    </span>
  )
}

function DeckBox({ d, data, openDeck, goTab, duplicate, setCover, setImg, rt, rtc, tro, selected, onSelect, onFav, onCom, onDelete }) {
  const [link, setLink] = useState('')
  const [pick, setPick] = useState(false)
  const c = coverOf(d, data), cols = colorsOf(d, data)
  const edge = cols.length ? cols.map(x => HUE[x]) : ['#8a8a99']
  const bg = edge.length > 1 ? `linear-gradient(135deg, ${edge.join(', ')})` : edge[0]
  const open = t => openDeck(d.id).then(() => goTab(t))
  const opts = Object.keys(d.main || {}).map(n => data.byName.get(n)).filter(x => x && x.mt !== 'Land')
  // artes próprias do deck (TappedOut): só no deck completo, lidas ao abrir a escolha da capa
  const [art, setArt] = useState(null)
  useEffect(() => { if (pick && !art) fetch(`/api/decks/${d.id}`).then(r => r.json()).then(x => setArt(x.art || {})).catch(() => setArt({})) }, [pick, art, d.id])
  return (
    <div className={`dbox ${selected ? 'sel' : ''}`} style={{ '--edge': bg }} data-deck={d.id}>
      <label className="dbox-check" title={tx('Selecionar (para comparar ou mudar vários de uma vez)')}><input type="checkbox" checked={!!selected} onChange={() => onSelect(d.id)} /></label>
      <button className={`dbox-fav ${d.fav ? 'on' : ''}`} onClick={() => onFav(d)} title={d.fav ? tx('Tirar dos favoritos') : tx('Pôr nos favoritos')}>{d.fav ? '★' : '☆'}</button>
      <button className="dbox-art" onClick={() => open('deck')} title={d.coverImg ? tx('Capa: imagem própria') : c ? tx('Capa: {name}', { name: c.n }) : d.name}>
        {d.coverImg ? <img src={d.coverImg} alt="" loading="lazy" /> : c && d.art?.[c.n] ? <img className="own-art" src={d.art[c.n]} alt={c.n} loading="lazy" /> : c ? <img src={img(c, 'art_crop')} alt={c.n} loading="lazy" /> : <span className="dbox-noart">✦</span>}
        <span className="dbox-fmt">{FORMAT[d.format]?.name || d.format}{d.community && <span title={tx('Deck da comunidade (de outra pessoa)')}> · 🌐 {tx('Comunidade')}</span>}</span>
      </button>
      <div className="dbox-body">
        <b title={d.name}>{d.name}</b>
        <span className="dbox-meta">{cols.length ? <Mana cost={cols.map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}<span className="muted small">{tx('{n} carta|{n} cartas', { n: d.count })} · {when(d.updated)}</span><button className={`dbox-com ${d.community ? 'on' : ''}`} onClick={() => onCom(d)} title={d.community ? tx('Deck da comunidade (de outra pessoa) — clica para passar a meu') : tx('Deck meu — clica para marcar como da comunidade (de outra pessoa)')}>{d.community ? '🌐' : '🧙'}</button><Trophies list={tro} /><DeckRating d={d} rt={rt} rtc={rtc} /></span>
        <span className="row-btns">
          <button onClick={() => open('deck')}>{tx('Abrir')}</button>
          <button onClick={() => open('teste')} title={tx('Testar no Forge')}>⚔</button>
          <button onClick={() => duplicate(d.id)} title={tx('Duplicar')}>⧉</button>
          <button className={pick ? 'on' : ''} onClick={() => setPick(x => !x)} title={tx('Escolher a capa: carta do deck, link ou imagem tua')}>🖼</button>
          <button onClick={() => onDelete(d)} title={tx('Apagar (vai para o lixo)')}>🗑</button>
        </span>
        {pick && <div className="dbox-own">
          <form onSubmit={e => { e.preventDefault(); if (link.trim()) { setImg(d.id, { url: link.trim() }); setLink(''); setPick(false) } }}>
            <input value={link} onChange={e => setLink(e.target.value)} placeholder={tx('Link de uma imagem (https://…)')} inputMode="url" /><button disabled={!link.trim()}>{tx('Usar')}</button>
          </form>
          <label className="dbox-up">⬆ {tx('Carregar imagem')}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { const f = e.target.files?.[0]; if (f) { setImg(d.id, { file: f }); setPick(false) } }} /></label>
          {d.coverImg && <button className="link small" onClick={() => { setImg(d.id, { url: null }); setPick(false) }}>{tx('tirar a imagem (volta à carta)')}</button>}
          <small className="muted">{tx('ou escolhe uma carta do deck:')}</small>
        </div>}
        {pick && <div className="dbox-pick">{opts.map(o => (
          <button key={o.n} className={(art?.[o.n] ? d.coverImg === art[o.n] : !d.coverImg && o.n === c?.n) ? 'on' : ''} onClick={() => { if (art?.[o.n]) setImg(d.id, { url: art[o.n] }); else setCover(d.id, o.n); setPick(false) }} title={art?.[o.n] ? tx('{name} (arte própria)', { name: o.n }) : o.n}><img src={img(o, 'small', false, art?.[o.n])} alt={o.n} loading="lazy" /></button>
        ))}</div>}
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
  const [sel, setSel] = useState([]), [cmp, setCmp] = useState(false), [del, setDel] = useState(null)
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
  const [bulkDel, setBulkDel] = useState(false)
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
    await fetch(`/api/decks/${d.id}`, { method: 'DELETE' }); setDel(null); setSel(s => s.filter(x => x !== d.id))
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
  const duplicate = async id => { const d = await (await fetch(`/api/decks/${id}`)).json(); const n = await post('/api/decks', { ...d, id: undefined, name: tx('{name} (cópia)', { name: d.name }) }); say(tx('Duplicado: {name}', { name: n.name })); reload() }
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
  const sorted = useMemo(() => {
    const W = 'WUBRG', st = (d, k) => rt[`deck:${d.id}`]?.[k] ?? -1
    const won = d => (tro[d.id] || []).filter(x => x.valid).reduce((t, x) => t + (x.platinum ? 1000 : { 1: 100, 2: 10, 3: 1 }[x.place] || 0), 0)  // platina > ouro > prata > bronze
    const key = {
      alterado: d => -(d.updated || 0), criado: d => -(d.created || d.updated || 0), nome: null,
      cores: d => { const c = colorsOf(d, data); return c.length * 100 + (c.length ? W.indexOf(c[0]) * 10 + W.indexOf(c[c.length - 1]) : 0) },
      amarelo: d => -st(d, 'stars'), azul: d => -st(d, 'blue'), vermelho: d => -st(d, 'red'),
      casual: d => -(rt[`deck:${d.id}|casual`]?.stars ?? -1), trofeus: d => -won(d),
    }[sort]
    const byName = (a, b) => a.name.localeCompare(b.name, LOCALE, { sensitivity: 'base' })
    return [...mine].sort((a, b) => (key ? key(a) - key(b) : 0) || byName(a, b))
  }, [mine, sort, rt, tro, data])
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
          <button className="primary" disabled={sel.length < 2 || sel.length > 3} title={tx('escolhe 2 ou 3 para comparar')} onClick={() => setCmp(true)}>⇄ {tx('Comparar')}</button>
          <span className="cmp-mass">
            <button onClick={() => bulk({ community: true }, '{n} deck passou a ser da comunidade|{n} decks passaram a ser da comunidade')}>🌐 {tx('Comunidade')}</button>
            <button onClick={() => bulk({ community: false }, '{n} deck passou a ser teu|{n} decks passaram a ser teus')}>🧙 {tx('Meus')}</button>
            <button onClick={() => bulk({ casual: true }, '{n} deck passou a casual|{n} decks passaram a casual')}>🎲 {tx('Casual')}</button>
            <button onClick={() => bulk({ casual: false }, '{n} deck deixou de ser casual|{n} decks deixaram de ser casual')}>{tx('Tirar casual')}</button>
            <button onClick={() => bulk({ fav: true }, '{n} deck nos favoritos|{n} decks nos favoritos')}>★ {tx('Favoritos')}</button>
            <button onClick={() => bulk({ fav: false }, '{n} deck tirado dos favoritos|{n} decks tirados dos favoritos')}>☆ {tx('Tirar favorito')}</button>
            <button className="danger" onClick={() => setBulkDel(true)}>🗑 {tx('Apagar')}</button>
          </span>
          <button className="link small" onClick={() => setSel([])}>{tx('limpar')}</button>
        </div>}
        {bulkDel && <div className="modal-bg" onClick={() => setBulkDel(false)}><div className="modal" onClick={e => e.stopPropagation()}>
          <h3>{tx('Apagar {n} decks?', { n: sel.length })}</h3>
          <p className="muted small">{sel.map(id => mine.find(d => d.id === id)?.name).filter(Boolean).join(' · ')}</p>
          <p className="small">{tx('Vão para o lixo e podes recuperá-los durante 30 dias.')}</p>
          <div className="row"><button className="danger" onClick={removeSel}>🗑 {tx('Apagar')}</button><button onClick={() => setBulkDel(false)}>{tx('Cancelar')}</button></div>
        </div></div>}
        {cmp && <DeckCompare data={data} decks={sel.map(id => mine.find(d => d.id === id)).filter(Boolean)} onClose={() => setCmp(false)}
          onOpen={id => { setCmp(false); openDeck(id).then(() => goTab('deck')) }} onFav={toggleFav} onDelete={setDel} />}
        {del && <ConfirmDelete deck={del} onYes={() => remove(del)} onNo={() => setDel(null)} />}
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
            {view === 'grelha' ? <div className="dgrid">{ds.map(d => <DeckBox key={d.id} d={d} data={data} openDeck={openDeck} goTab={goTab} duplicate={duplicate} setCover={setCover} setImg={setImg} rt={rt[`deck:${d.id}`]} rtc={rt[`deck:${d.id}|casual`]} tro={tro[d.id]} onCom={toggleCom} selected={sel.includes(d.id)} onSelect={toggleSel} onFav={toggleFav} onDelete={setDel} />)}</div> : <ul className="lib-list">{ds.map(d => (
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
        <h3>{tx('Decks repetidos ou muito parecidos')} <span className="muted small">{tx('{n} grupo|{n} grupos', { n: dupes.length })} · {tx('mesmo com nomes e capas diferentes')}</span></h3>
        {dupes.map((g, k) => (
          <div key={k} className="dupe-g">
            <span className={`chip ${g.top >= 0.999 ? 'bad' : ''}`}>{g.top >= 0.999 ? tx('iguais') : tx('{p}% iguais', { p: Math.round(g.top * 100) })}</span>
            {g.decks.map(d => <span key={d.id} className="dupe-d"><b>{d.name}</b><small className="muted">{FORMAT[d.format]?.name || d.format} · {when(d.updated)}</small>
              <button onClick={() => setDel(d)} title={tx('Apagar este (vai para o lixo)')}>🗑</button></span>)}
            <button className="primary" onClick={() => { setSel(g.decks.slice(0, 3).map(d => d.id)); setCmp(true) }}>⇄ {tx('Comparar')}</button>
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
