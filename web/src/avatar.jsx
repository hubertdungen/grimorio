// Imagens de perfil (avatars.py): a de quem aloja / de cada perfil e a de cada amigo. Uma imagem carregada (aqui
// cortada num quadrado de 256 px e comprimida em WebP ou JPEG antes de ir) ou a arte de uma carta (o nome e o id da
// Scryfall; a imagem vem pelo caminho das cartas, sf()). Sem imagem fica a inicial, como antes.
// AvFace: só o miolo (a imagem ou a letra) para os círculos que já existem (Taverna, perfis); PAv: o círculo inteiro
// para o resto (salas, mesas, torneios); AvatarEdit: a janela para escolher.
import './avatar.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tx } from './i18n.js'
import { sf, unaccent } from './data.js'
import { remoteBase } from './remote.js'

export const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
export const initial = name => ([...String(name || '?').trim()][0] || '?').toUpperCase()
const FILE = /^\/avatars\/[a-f0-9]{24}\.(webp|jpg|png)$/
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const artCrop = id => sf(`https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg`)

// o endereço da imagem (null: fica a inicial). As imagens carregadas vivem no Grimório de quem aloja: com a sala ou a
// Taverna de um amigo aberta (remote.js) vêm de lá; `local`: as minhas (o chip do cabeçalho, as Definições)
export function avSrc(av, local) {
  if (!av) return null
  if (typeof av === 'string') return FILE.test(av) ? (local ? '' : remoteBase()) + av : null
  return ID.test(String(av.id || '')) ? artCrop(av.id) : null
}
export const avTitle = av => (av && typeof av === 'object' && av.card ? av.card : '')

export function AvFace({ av, name, local }) {
  const src = avSrc(av, local)
  const [bad, setBad] = useState(null)  // a imagem que falhou (apagada, sem rede): volta a letra
  return src && bad !== src ? <img className="av-img" src={src} alt="" loading="lazy" draggable="false" onError={() => setBad(src)} /> : initial(name)
}

/** O círculo de uma pessoa: a imagem dela ou a inicial na cor do `who`. */
export function PAv({ av, name, who, size = 24, cls = '', local, title }) {
  return <span className={`pav ${cls}`} style={{ '--h': hue(who ?? name ?? ''), width: size, height: size, fontSize: Math.round(size * 0.46) }} title={title} aria-hidden={title ? undefined : 'true'}>
    <AvFace av={av} name={name} local={local} /></span>
}

// ---------- escolher: carregar uma imagem (cortar e ajustar) ou a arte de uma carta ----------
const OUT = 256, VIEW = 240, MAX_OUT = 60_000  // o quadrado que vai para o servidor (até ~60 KB; o servidor aceita até 100 KB)
const blobOf = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q))
const dataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b) })

// a imagem cortada -> data URL WebP (ou JPEG, onde o browser não faz WebP), a baixar a qualidade até caber
async function squeeze(draw) {
  for (const size of [OUT, 192, 128]) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    draw(cv.getContext('2d'), size)
    for (const q of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      let b = await blobOf(cv, 'image/webp', q)
      if (!b || b.type !== 'image/webp') b = await blobOf(cv, 'image/jpeg', q)
      if (b && b.size <= MAX_OUT) return dataUrl(b)
    }
  }
  throw new Error(tx('Não consegui comprimir esta imagem: experimenta outra.'))
}

function Cropper({ src, onReady }) {
  const cv = useRef(null), drag = useRef(null)
  const [im, setIm] = useState(null)
  const [v, setV] = useState({ z: 1, x: 0, y: 0 })  // zoom (1 = a imagem a cobrir o quadrado) e o centro deslocado (px do quadrado)
  useEffect(() => { const i = new Image(); i.onload = () => setIm(i); i.onerror = () => onReady(null, tx('Essa imagem não se lê.')); i.src = src }, [src])  // eslint-disable-line react-hooks/exhaustive-deps -- uma vez por imagem
  // onde fica a imagem no quadrado de lado S, sem deixar aparecer o fundo
  const place = (S, z, x, y) => {
    const s = Math.max(S / im.width, S / im.height) * z, w = im.width * s, h = im.height * s
    const mx = (w - S) / 2, my = (h - S) / 2, k = S / VIEW
    return { w, h, x: (S - w) / 2 + Math.max(-mx, Math.min(mx, x * k)), y: (S - h) / 2 + Math.max(-my, Math.min(my, y * k)) }
  }
  const clamp = (z, x, y) => { const p = place(VIEW, z, x, y); return { z, x: p.x - (VIEW - p.w) / 2, y: p.y - (VIEW - p.h) / 2 } }
  useEffect(() => {
    if (!im || !cv.current) return
    const d = Math.min(2, window.devicePixelRatio || 1), c = cv.current, g = c.getContext('2d')
    c.width = c.height = VIEW * d
    const p = place(VIEW * d, v.z, v.x, v.y)
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(im, p.x, p.y, p.w, p.h)
    onReady((ctx, S) => { const q = place(S, v.z, v.x, v.y); ctx.drawImage(im, q.x, q.y, q.w, q.h) })
  }, [im, v])  // eslint-disable-line react-hooks/exhaustive-deps -- desenha quando muda
  const down = e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: v.x, y: v.y } }
  const move = e => { const d = drag.current; if (d) setV(o => clamp(o.z, d.x + e.clientX - d.px, d.y + e.clientY - d.py)) }
  const up = () => { drag.current = null }
  const zoom = z => setV(o => clamp(Math.max(1, Math.min(4, z)), o.x, o.y))
  if (!im) return <p className="muted small">{tx('A ler a imagem…')}</p>
  return (
    <div className="av-crop">
      <canvas ref={cv} className="av-crop-c" style={{ width: VIEW, height: VIEW }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={e => zoom(v.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))} role="img" aria-label={tx('Arrasta para escolher a parte da imagem que fica no círculo')} />
      <label className="av-zoom"><span aria-hidden="true">−</span><input type="range" min="1" max="4" step="0.01" value={v.z} onChange={e => zoom(+e.target.value)} aria-label={tx('Zoom')} /><span aria-hidden="true">＋</span></label>
      <small className="muted">{tx('Arrasta para escolher a parte que fica no círculo; o zoom aproxima.')}</small>
    </div>
  )
}

function CardPick({ data, pick, setPick }) {
  const [q, setQ] = useState(pick?.card || '')
  const [i, setI] = useState(0)
  const hits = useMemo(() => {
    const n = unaccent(q.trim().replace(/^@/, '').toLowerCase())
    if (n.length < 2 || !data?.cards) return []
    const st = [], inn = []  // o nome exato primeiro, depois os que começam assim (os mais curtos antes), depois os que o contêm
    for (const c of data.cards) if (!c.un && c.id) { if (c.f.startsWith(n)) st.push(c); else if (inn.length < 8 && c.f.includes(n)) inn.push(c) }
    return [...st.sort((x, y) => x.f.length - y.f.length), ...inn].slice(0, 8)
  }, [q, data])
  const go = c => { setPick({ card: c.n, id: c.id }); setQ(c.n) }
  const key = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setI(k => (k + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length)) }
    if (e.key === 'Enter' && hits[i]) { e.preventDefault(); go(hits[i]) }
  }
  if (!data?.cards) return <p className="muted small">{tx('A carregar as cartas…')}</p>
  return (
    <div className="av-cards">
      <input type="search" value={q} autoFocus onChange={e => { setQ(e.target.value); setI(0) }} onKeyDown={key} placeholder={tx('Escreve o nome de uma carta…')} aria-label={tx('Carta')}
        role="combobox" aria-expanded={hits.length > 0} aria-controls="av-card-list" aria-autocomplete="list" />
      {hits.length > 0 && <ul id="av-card-list" role="listbox" className="av-card-list">{hits.map((c, k) => (
        <li key={c.n} role="option" aria-selected={pick?.id === c.id}><button type="button" className={`${k === i ? 'on' : ''} ${pick?.id === c.id ? 'sel' : ''}`} onMouseEnter={() => setI(k)} onClick={() => go(c)}>
          <img src={artCrop(c.id)} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /><span>{c.n}</span></button></li>))}</ul>}
      {q.trim().length >= 2 && !hits.length && <p className="muted small">{tx('Nenhuma carta com esse nome.')}</p>}
    </div>
  )
}

/** A janela: «Carregar imagem» ou «Arte de uma carta». path: /api/avatar (eu: quem aloja, um perfil) ou /api/guest/avatar
 * (um convidado; com a Taverna de um amigo aberta vai para lá, remote.js). Ao guardar: onSaved(avatar) e o evento
 * «grimorio:avatar» (o cabeçalho e as Definições releem). */
export function AvatarEdit({ cur, name, who, path = '/api/avatar', data, local, onClose, onSaved }) {
  const [tab, setTab] = useState(cur && typeof cur === 'object' ? 'carta' : 'imagem')
  const [file, setFile] = useState(null)  // o object URL da imagem escolhida
  const [pick, setPick] = useState(cur && typeof cur === 'object' ? cur : null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const draw = useRef(null)
  useEffect(() => () => { if (file) URL.revokeObjectURL(file) }, [file])
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  const choose = e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    setErr('')
    if (!f) return
    if (!/^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(f.type)) return setErr(tx('Escolhe uma fotografia ou imagem (JPEG, PNG ou WebP).'))
    if (f.size > 25e6) return setErr(tx('Essa imagem é grande demais (até 25 MB).'))
    setFile(URL.createObjectURL(f))
  }
  const send = async body => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(tx(j.erro || `HTTP ${r.status}`))
      onSaved?.(j.avatar || null)
      window.dispatchEvent(new CustomEvent('grimorio:avatar', { detail: j.avatar || null }))
      onClose()
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const save = async () => {
    if (tab === 'carta') return pick ? send({ card: pick.card, id: pick.id }) : setErr(tx('Escolhe uma carta da lista.'))
    if (!draw.current) return setErr(tx('Escolhe uma imagem primeiro.'))
    try { setBusy(true); await send({ img: await squeeze(draw.current) }) } catch (x) { setErr(x.message); setBusy(false) }
  }
  const preview = tab === 'carta' ? pick || cur : cur  // por cima: a escolhida ou a de agora
  return (
    <div className="modal-bg av-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal av-modal" role="dialog" aria-modal="true" aria-label={tx('Imagem de perfil')}>
        <header className="av-head">
          {tab === 'carta' || !file ? <PAv av={preview} name={name} who={who} size={64} local={local} /> : null}
          <div><h3>{tx('Imagem de perfil')}</h3><small className="muted">{tx('Aparece na Taverna, nas salas, nas mesas e nos torneios. Sem imagem fica a inicial.')}</small></div>
        </header>
        <div className="av-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'imagem'} className={tab === 'imagem' ? 'on' : ''} onClick={() => setTab('imagem')}>📷 {tx('Carregar imagem')}</button>
          <button type="button" role="tab" aria-selected={tab === 'carta'} className={tab === 'carta' ? 'on' : ''} onClick={() => setTab('carta')}>🃏 {tx('Arte de uma carta')}</button>
        </div>
        {tab === 'imagem' ? <div className="av-up">
          {file ? <Cropper key={file} src={file} onReady={(fn, e) => { draw.current = fn; if (e) { setErr(e); setFile(null) } }} /> : null}
          <label className={`btn av-file ${file ? '' : 'primary'}`}>📁 {file ? tx('Outra imagem') : tx('Escolher uma imagem')}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" onChange={choose} hidden /></label>
          {!file && <small className="muted">{tx('JPEG, PNG ou WebP. Fica um quadrado pequeno (256 px) para não pesar.')}</small>}
        </div> : <CardPick data={data} pick={pick} setPick={setPick} />}
        {err && <p className="bad-t small" role="alert">{err}</p>}
        <div className="row-btns av-btns">
          {cur && <button type="button" className="danger" disabled={busy} onClick={() => send({ clear: true })}>🗑 {tx('Tirar a imagem')}</button>}
          <span className="av-sp" />
          <button type="button" onClick={onClose}>{tx('Cancelar')}</button>
          <button type="button" className="primary" disabled={busy || (tab === 'carta' ? !pick : !file)} onClick={save}>{busy ? tx('A guardar…') : tx('Guardar')}</button>
        </div>
      </div>
    </div>
  )
}

/** A minha imagem com o botão para a mudar (Definições). */
export function MyAvatar({ name, data, path = '/api/avatar', size = 56 }) {
  const [av, setAv] = useState(undefined)
  const [open, setOpen] = useState(false)
  useEffect(() => { fetch(path).then(r => (r.ok ? r.json() : {})).then(j => setAv(j.avatar || null)).catch(() => setAv(null)) }, [path])
  return (
    <div className="av-mine">
      <button type="button" className="av-mine-b" onClick={() => setOpen(true)} title={tx('Mudar a imagem de perfil')} aria-label={tx('Mudar a imagem de perfil')}>
        <PAv av={av} name={name} who="host" size={size} local /><i aria-hidden="true">✎</i></button>
      <span className="av-mine-t"><b>{name}</b><small className="muted">{av ? avTitle(av) || tx('Imagem carregada') : tx('Sem imagem: aparece a inicial.')}</small></span>
      <button type="button" onClick={() => setOpen(true)}>🖼 {av ? tx('Mudar a imagem') : tx('Pôr uma imagem')}</button>
      {open && <AvatarEdit cur={av} name={name} who="host" path={path} data={data} local onClose={() => setOpen(false)} onSaved={setAv} />}
    </div>
  )
}
