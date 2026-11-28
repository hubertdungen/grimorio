// Proxies: levar o deck com as artes escolhidas para uma gráfica ou para a impressora.
//  1. lista com as edições («4 Island (FRA) 386», cópias divididas numa linha por arte) — Moxfield, MPCFill, mtgprint…;
//  2. ZIP com as imagens (PNG da Scryfall e as imagens próprias), um ficheiro por grupo ou por cópia;
//  3. folha para imprimir: 63×88 mm, 9 por página A4/Letter, com linhas de corte (imprimir ou guardar em PDF).
// Vários decks de uma vez (Biblioteca › selecionar, ou «＋ Juntar outros decks»): folhas seguidas ou uma por deck,
// nomes dos decks na folha e cartas partilhadas entre decks (printpdf.packDecks).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { img, sf, recommend, fmtBit, fetchPrints } from './data.js'
import { subsOf } from './formats.js'
import { alterHistory } from './alterart.js'
import { FORMAT } from './formats.js'
import { exportList, proxyGroups, listLine } from './deck.js'
import { PAPERS, UNITS, PRINT0, layout, guides, gapRects, pageOps, pdf, packDecks, sheetLabels, tagRoom } from './printpdf.js'
const GRID = [24, 34]  // amostra de cada carta (rgb) para o contraste das guias
import { tx } from './i18n.js'
import { useBackClose } from './backnav.js'

const own = s => s && (s.startsWith('arts/') || s.startsWith('https:'))
const urlOf = (g, size, back = false) => (back ? (g.c.df && !own(g.src) ? img(g.c, size, true, g.src) : null) : img(g.c, size, false, g.src))

// cada arte numa imagem com o bleed à volta (300 ppp): preto, uma cor, ou a margem da carta esticada para fora
// (a cor de fundo é a mediana da margem, para os cantos redondos e as pontas das tiras)
const DPI = 300  // resolução por omissão das cartas no PDF (o.dpi: 300/450/600)
const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url })
const dims = im => [im.naturalWidth || im.width, im.naturalHeight || im.height]  // <img> ou canvas (ampliado)
function edgeColor(im) {
  const [iw, ih] = dims(im), cv = document.createElement('canvas')
  cv.width = iw; cv.height = ih
  const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0)
  const px = [], dx = Math.round(iw * 0.012), dy = Math.round(ih * 0.012)
  for (let t = 0.12; t <= 0.88; t += 0.04) for (const [a, b] of [[t * iw, dy], [t * iw, ih - 1 - dy], [dx, t * ih], [iw - 1 - dx, t * ih]]) px.push(x.getImageData(Math.round(a), Math.round(b), 1, 1).data)
  const med = k => px.map(p => p[k]).sort((a, b) => a - b)[px.length >> 1]
  return `rgb(${med(0)},${med(1)},${med(2)})`
}
// o.upAI: a imagem com menos píxeis do que a carta pede na resolução escolhida amplia-se primeiro com o Real-ESRGAN no
// browser (upscale.js, ×2 ou ×4); senão o canvas estica-a com suavização. onUp(): avisa que esta foi ampliada
async function renderCard(url, o, L, onUp) {
  let im = await loadImg(url)
  const k = (o.dpi || DPI) / 25.4, b = Math.round(L.b * k), w = Math.round(L.cw * k), h = Math.round(L.ch * k)
  if (o.upAI && im.naturalWidth < w * 0.9) {
    const { upscale } = await import('./upscale.js')
    im = await upscale(await createImageBitmap(im), w / im.naturalWidth > 2 ? 4 : 2)
    onUp?.()
  }
  const cv = document.createElement('canvas'); cv.width = w + 2 * b; cv.height = h + 2 * b
  const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'
  x.fillStyle = o.bleedFill === 'black' ? '#000' : o.bleedFill === 'color' ? o.bleedColor : edgeColor(im)
  x.fillRect(0, 0, cv.width, cv.height)
  if (o.bleedFill === 'replicate' && b) {
    const [iw, ih] = dims(im), sx = Math.round(iw * 0.012), sy = Math.round(ih * 0.012)
    x.drawImage(im, 0, sy, iw, 1, b, 0, w, b); x.drawImage(im, 0, ih - 1 - sy, iw, 1, b, b + h, w, b)
    x.drawImage(im, sx, 0, 1, ih, 0, b, b, h); x.drawImage(im, iw - 1 - sx, 0, 1, ih, b + w, b, b, h)
  }
  if (!o.fillCorners) { x.fillStyle = '#fff'; x.fillRect(b, b, w, h) }  // cantos redondos ficam brancos
  x.drawImage(im, b, b, w, h)
  if (o.watermark && o.watermarkText) {
    x.save(); x.translate(b + w / 2, b + h / 2); x.rotate(-Math.PI / 6); x.globalAlpha = 0.28
    x.font = `900 ${Math.round(h * 0.11)}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'
    x.lineWidth = h * 0.006; x.strokeStyle = '#000'; x.fillStyle = '#fff'; x.strokeText(o.watermarkText, 0, 0); x.fillText(o.watermarkText, 0, 0); x.restore()
  }
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92))
  let grid = null
  if ((o.guideContrast || 'off') !== 'off') {  // a carta em ponto pequeno: a cor por baixo de cada pedaço de guia
    const sc = document.createElement('canvas'); sc.width = GRID[0]; sc.height = GRID[1]
    const sx = sc.getContext('2d', { willReadFrequently: true }); sx.drawImage(cv, 0, 0, GRID[0], GRID[1])
    try { grid = sx.getImageData(0, 0, GRID[0], GRID[1]).data } catch { grid = null }
  }
  return { w: cv.width, h: cv.height, bytes: new Uint8Array(await blob.arrayBuffer()), grid }
}
const CARD_BACK = sf('https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg')
const fetchable = u => (u?.startsWith('https:') && !/^https:\/\/(cards|backs)\.scryfall\.io\//.test(u) ? `/api/arts/proxy?url=${encodeURIComponent(u)}` : u)
const loadPrint = () => { try { return { ...PRINT0, ...JSON.parse(localStorage.getItem('grimorio.print') || '{}') } } catch { return PRINT0 } }

// número numa unidade (cm, mm, polegadas); guarda sempre em mm
function Num({ v, unit, set, label, min = 0 }) {
  const k = UNITS[unit]
  return <label className="pnum"><span>{label}</span><input type="number" min={min} step={unit === 'mm' ? 0.1 : 0.01} value={+(v / k).toFixed(unit === 'mm' ? 1 : 3)} onChange={e => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) set(n * k) }} /><small>{unit}</small></label>
}

// pré-visualização da 1.ª folha: cartas (com o bleed que cabe), margens e guias
function Preview({ L, o, slots, labels }) {
  const g = guides(L, o.guides, o.individual !== false, o.markLen ?? 3)
  return (
    <svg className="pprev" viewBox={`0 0 ${L.W} ${L.H}`} role="img" aria-label={tx('Pré-visualização da folha')}>
      <rect width={L.W} height={L.H} fill="#fff" />
      {L.cells.map((k, i) => { const s = slots[i]; const [l, t, r, b] = k.clip; return (
        <g key={i}>
          <rect x={l} y={t} width={r - l} height={b - t} fill={o.bleedFill === 'black' ? '#000' : o.bleedFill === 'color' ? o.bleedColor : '#3a3a3a'} />
          {s ? <image href={s.thumb} x={k.x} y={k.y} width={L.cw} height={L.ch} preserveAspectRatio="none" /> : <rect x={k.x} y={k.y} width={L.cw} height={L.ch} fill="#ddd" />}
        </g>) })}
      {gapRects(L, o).map(([x, y, w, h], i) => <rect key={`g${i}`} x={x} y={y} width={w} height={h} fill={o.gapColor || '#000'} />)}
      {g.map(([a, b, c, d], i) => <line key={i} x1={a} y1={b} x2={c} y2={d} stroke={o.guideColor} strokeWidth={Math.max(o.guideWidth, L.W / 600)} />)}
      {labels.map((t, i) => <text key={`t${i}`} x={t.x} y={t.y} fontSize={t.s} fill="#737373" fontFamily="Helvetica, Arial, sans-serif">{t.t}</text>)}
    </svg>
  )
}

// 🧮 Custo estimado da impressão: preço por imagem (à mão), verso opcional, recorte por carta e preço por folha opcionais;
// os valores ficam neste browser
const COST0 = { img: '', back: true, cut: '', sheet: '', cur: '€' }
const numOf = v => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : 0 }
function CostCalc({ n, sheets, duplex }) {
  const [c, setC] = useState(() => { try { return { ...COST0, ...JSON.parse(localStorage.getItem('grimorio.pxcost') || '{}') } } catch { return COST0 } })
  const up = p => setC(x => { const y = { ...x, ...p }; try { localStorage.setItem('grimorio.pxcost', JSON.stringify(y)) } catch { /* sem armazenamento */ } return y })
  const imgs = n * (duplex && c.back ? 2 : 1)
  const money = v => `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c.cur}`
  const parts = [[imgs, numOf(c.img), tx('imagens')], [n, numOf(c.cut), tx('recortes')], [sheets, numOf(c.sheet), tx('folhas')]].filter(([k, v]) => k && v)
  const total = parts.reduce((a, [k, v]) => a + k * v, 0)
  const field = (k, label, ph) => <label><span>{label}</span><input inputMode="decimal" value={c[k]} placeholder={ph} onChange={e => up({ [k]: e.target.value })} /></label>
  return (
    <details className="pcalc">
      <summary>🧮 {tx('Calcular o custo')}{total > 0 && <b> · {money(total)}</b>}</summary>
      <div className="pcalc-f">
        {field('img', tx('Preço por imagem'), '0,25')}
        {field('cut', tx('Recorte por carta (opcional)'), '0,05')}
        {field('sheet', tx('Preço por folha (opcional)'), '0')}
        <label><span>{tx('Moeda')}</span><input value={c.cur} maxLength={4} onChange={e => up({ cur: e.target.value })} /></label>
      </div>
      {duplex && <label className="chk small"><input type="checkbox" checked={c.back} onChange={e => up({ back: e.target.checked })} /> {tx('O verso conta como outra imagem')}</label>}
      {parts.length ? <p className="small">{parts.map(([k, v, l]) => `${k} ${l} × ${money(v)}`).join(' + ')} = <b>{money(total)}</b>{n ? <span className="muted"> · {tx('{v} por carta', { v: money(total / n) })}</span> : null}</p>
        : <p className="muted small">{tx('Mete o preço por imagem da gráfica (e, se cobrar, o recorte e a folha) para ver o total de {n} cartas em {s} folhas.', { n, s: sheets })}</p>}
    </details>
  )
}

// 👑 Artes extra do comandante e dos sub-comandantes: as impressões da carta (Scryfall), a imagem própria e as alter arts
// deste aparelho; cada uma marcada sai como mais uma cópia nos proxies (a arte do deck já vai)
function CmdAlts({ data, d, alts, setAlts }) {
  const names = [...new Set([...(d.commanders || []), ...subsOf(d)])].filter(n => data.byName.get(n))
  const [open, setOpen] = useState(null), [prints, setPrints] = useState({})
  useEffect(() => {
    if (!open || prints[open]) return
    fetchPrints(open).then(l => setPrints(m => ({ ...m, [open]: l }))).catch(() => setPrints(m => ({ ...m, [open]: [] })))
  }, [open, prints])
  if (!names.length) return null
  const cur = n => d.art?.[n] || d.prints?.[n]?.id || null
  const opts = n => {
    const c = data.byName.get(n), mine = [...new Set([d.art?.[n], ...alterHistory(n)].filter(Boolean))]
    return [...mine.map(u => ({ src: u, label: tx('Imagem própria') })), ...(prints[n] || []).map(p => ({ src: p.id, label: `${String(p.set || '').toUpperCase()} ${p.cn || ''}` }))]
      .filter(x => x.src !== cur(n)).map(x => ({ ...x, url: img(c, 'small', false, x.src) }))
  }
  const toggle = (n, src) => setAlts({ ...alts, [n]: (alts[n] || []).includes(src) ? alts[n].filter(x => x !== src) : [...(alts[n] || []), src] })
  return (
    <div className="px-alts">
      <span className="small muted">👑 {tx('Artes extra do comandante')}:</span>
      {names.map(n => <button key={n} className={`small ${open === n ? 'on' : ''}`} onClick={() => setOpen(open === n ? null : n)}>{n.split(' // ')[0].split(',')[0]}{alts[n]?.length ? ` +${alts[n].length}` : ''}</button>)}
      {open && <div className="px-alt-grid">
        {!prints[open] && <span className="muted small">{tx('A carregar…')}</span>}
        {opts(open).map(x => (
          <button key={x.src} className={`px-alt ${(alts[open] || []).includes(x.src) ? 'on' : ''}`} onClick={() => toggle(open, x.src)} title={x.label}>
            <img src={x.url} alt="" loading="lazy" /><small>{x.label}</small>
          </button>))}
        {prints[open] && !opts(open).length && <span className="muted small">{tx('Não há outras artes desta carta.')}</span>}
      </div>}
    </div>
  )
}

// quantos tokens uma carta cria de cada vez («create two …», X conta como 3)
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, x: 3 }
const madeBy = c => { const m = /\bcreates? (a|an|one|two|three|four|five|six|x|\d+)\b/i.exec(c?.o || ''); return m ? NUMW[m[1].toLowerCase()] || +m[1] || 1 : 1 }


// vários decks: cada um com as suas opções; o aberto usa o contexto do App, os outros o mesmo cálculo sem os testes
const OPT0 = { on: true, main: true, side: true, maybe: false, tok: false, sug: false, sugN: 10, alts: {} }  // o que entra de cada deck; alts: {carta: [artes extra]}
const keyOf = d => d.id || 'cur'
const ctxOf = (data, d) => {
  const fmt = FORMAT[d.format] || FORMAT.casual, cmd = (d.commanders || []).map(n => data.byName.get(n)).filter(Boolean)
  return d.casual ? { bit: -1, identity: null, allowUn: true } : { bit: fmtBit(data, fmt), identity: fmt.cmd && cmd.length ? cmd.map(c => c.ci).join('') : null, allowUn: fmt.key === 'casual' }
}
function suggest(data, deck, ctx, n) {
  const have = [...deck.commanders || [], ...Object.keys(deck.main || {})].map(n => data.byName.get(n)?.i).filter(i => i != null)
  const cols = new Set(have.flatMap(i => (data.cards[i].mt === 'Land' ? [] : [...data.cards[i].ci])))  // as cores do deck, sem os terrenos
  return recommend(data, { seeds: have.filter(i => data.cards[i].mt !== 'Land'), have, ctx, filters: { noLands: true }, limit: n * 3 }).map(r => r.c)
    .filter(c => !deck.main?.[c.n] && !deck.side?.[c.n] && [...c.ci].every(k => cols.has(k))).slice(0, n)
}
const fileBase = ds => { const j = ds.map(d => d.name).join(' + '); return (ds.length > 1 && j.length > 60 ? `${ds.length} decks` : j).replace(/[^\w\- +]+/g, '').trim() || 'deck' }

// «＋ Juntar outros decks»: os decks guardados, com filtros (de quem, formato), pesquisa (nome ou comandante) e ordem
const kindOf = d => (d.friend ? 'amigos' : d.community ? 'comunidade' : 'meus')
function JoinPicker({ have, onAdd, onClose }) {
  const [list, setList] = useState(null), [q, setQ] = useState(''), [pick, setPick] = useState([]), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [who, setWho] = useState('meus'), [fmt, setFmt] = useState(''), [ord, setOrd] = useState('recentes')
  useEffect(() => { fetch('/api/decks').then(r => (r.ok ? r.json() : Promise.reject(new Error()))).then(setList).catch(() => setErr(tx('Não consegui ler os teus decks.'))) }, [])
  const base = (list || []).filter(d => !have.includes(d.id) && !d.deleted)
  const fmts = [...new Set(base.filter(d => who === 'todos' || kindOf(d) === who).map(d => d.format))].sort((x, y) => (FORMAT[x]?.name || x).localeCompare(FORMAT[y]?.name || y))
  const qq = q.trim().toLowerCase()
  const shown = base.filter(d => (who === 'todos' || kindOf(d) === who) && (!fmt || d.format === fmt) &&
    (!qq || d.name.toLowerCase().includes(qq) || (d.commanders || []).some(c => c.toLowerCase().includes(qq))))
    .sort((x, y) => (ord === 'nome' ? x.name.localeCompare(y.name) : (y.updated || 0) - (x.updated || 0)))
  const count = k => base.filter(d => k === 'todos' || kindOf(d) === k).length
  const add = async () => {
    setBusy(true)
    try { onAdd(await Promise.all(pick.map(id => fetch(`/api/decks/${id}`).then(r => (r.ok ? r.json() : Promise.reject(new Error())))))) } catch { setErr(tx('Não consegui ler os teus decks.')) } finally { setBusy(false) }
  }
  const allOn = shown.length > 0 && shown.every(d => pick.includes(d.id))
  return (
    <div className="px-join">
      <div className="px-jf">
        <input type="search" placeholder={tx('Procurar deck ou comandante…')} value={q} onChange={e => setQ(e.target.value)} aria-label={tx('Procurar deck ou comandante…')} />
        <select value={fmt} onChange={e => setFmt(e.target.value)} aria-label={tx('Formato')}><option value="">{tx('Todos os formatos')}</option>{fmts.map(f => <option key={f} value={f}>{FORMAT[f]?.name || f}</option>)}</select>
        <select value={ord} onChange={e => setOrd(e.target.value)} aria-label={tx('Ordenar')}><option value="recentes">{tx('Mais recentes')}</option><option value="nome">{tx('Nome')}</option></select>
      </div>
      <div className="px-jw">
        <div className="seg">{[['meus', tx('Meus')], ['amigos', tx('Amigos')], ['comunidade', tx('Comunidade')], ['todos', tx('Todos')]].map(([k, l]) => (
          <button key={k} className={who === k ? 'on' : ''} onClick={() => { setWho(k); setFmt('') }}>{l} <small>{count(k)}</small></button>))}</div>
        {shown.length > 0 && <button className="link small" onClick={() => setPick(p => (allOn ? p.filter(id => !shown.some(d => d.id === id)) : [...new Set([...p, ...shown.map(d => d.id)])]))}>{allOn ? tx('desmarcar estes') : tx('marcar todos ({n})', { n: shown.length })}</button>}
        {pick.length > 0 && <button className="link small" onClick={() => setPick([])}>{tx('limpar ({n})', { n: pick.length })}</button>}
      </div>
      {!list && !err && <p className="muted small">{tx('A carregar…')}</p>}
      {list && !shown.length && <p className="muted small">{tx('Nenhum deck com estes filtros.')}</p>}
      <ul>{shown.map(d => <li key={d.id}><label className="chk small"><input type="checkbox" checked={pick.includes(d.id)} onChange={() => setPick(p => (p.includes(d.id) ? p.filter(x => x !== d.id) : [...p, d.id]))} />
        <span className="px-jn"><b>{d.name}</b><small className="muted">{FORMAT[d.format]?.name || d.format} · {tx('{n} cartas', { n: d.count })}{d.commanders?.length ? ` · ${d.commanders.join(' + ')}` : ''}{d.friend ? ` · 🤝 ${d.friendName || ''}` : ''}</small></span></label></li>)}</ul>
      {err && <p className="small bad-t">{err}</p>}
      <div className="row-btns"><button className="primary" disabled={!pick.length || busy} onClick={add}>{tx('Juntar {n} deck|Juntar {n} decks', { n: pick.length })}</button><button onClick={onClose}>{tx('Cancelar')}</button></div>
    </div>
  )
}

// deck = o deck aberto (com ctx); decks = outros decks inteiros (da Biblioteca ou de «Juntar outros decks")
export default function ProxyDialog({ data, deck, decks, ctx, onClose }) {
  useBackClose(true, onClose)  // «voltar» do telemóvel fecha esta janela
  const [extra, setExtra] = useState(() => decks || []), [joining, setJoining] = useState(false)
  const all = useMemo(() => (deck ? [deck, ...extra.filter(d => !deck.id || d.id !== deck.id)] : extra), [deck, extra])
  const multi = all.length > 1
  const [opts, setOpts] = useState({}), [perCopy, setPerCopy] = useState(false)
  const optOf = k => ({ ...OPT0, ...opts[k] }), setOpt = (k, p) => setOpts(m => ({ ...m, [k]: { ...OPT0, ...m[k], ...p } }))
  // extras: os tokens que as cartas de cada deck criam (Scryfall, pelo servidor) e as sugestões do Grimório para testar
  const [toks, setToks] = useState({}), [tokErr, setTokErr] = useState('')  // toks[k]: null = a procurar
  useEffect(() => {
    for (const d of all) {
      const k = keyOf(d), r = { ...OPT0, ...opts[k] }
      if (!r.tok || k in toks) continue
      setToks(t => ({ ...t, [k]: null }))
      const names = [...new Set([...(r.main ? [...d.commanders || [], ...Object.keys(d.main || {})] : []), ...Object.keys(r.side ? d.side || {} : {}), ...Object.keys(r.maybe ? d.maybe || {} : {})])]
      fetch('/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) })
        .then(async res => { const j = await res.json(); if (!res.ok) throw new Error(j.erro); return j })
        .then(l => setToks(t => ({ ...t, [k]: l.map(x => ({ ...x, q: Math.max(1, Math.min(12, x.from.reduce((a, n) => a + madeBy(data.byName.get(n)) * ((d.main?.[n] || 0) + (d.side?.[n] || 0) || 1), 0))) })) })))
        .catch(e => { setTokErr(e.message); setOpts(m => ({ ...m, [k]: { ...OPT0, ...m[k], tok: false } })); setToks(t => { const n = { ...t }; delete n[k]; return n }) })
    }
  }, [all, opts, toks, data])
  const sugCache = useRef(new Map())  // recomendar é pesado: só se refaz quando o deck ou o número mudam
  const sugs = useMemo(() => Object.fromEntries(all.map(d => {
    const k = keyOf(d), r = { ...OPT0, ...opts[k] }, c = d === deck ? ctx : ctxOf(data, d)
    if (!r.sug || !c) return [k, []]
    const hit = sugCache.current.get(k), cc = d === deck ? ctx : null
    if (hit?.d === d && hit.n === r.sugN && hit.c === cc) return [k, hit.out]
    const out = suggest(data, d, c, r.sugN)
    sugCache.current.set(k, { d, n: r.sugN, c: cc, out })
    return [k, out]
  })), [all, opts, data, deck, ctx])
  const secs = useMemo(() => all.filter(d => ({ ...OPT0, ...opts[keyOf(d)] }).on).map(d => {
    const k = keyOf(d), r = { ...OPT0, ...opts[k] }, tk = r.tok && toks[k] ? toks[k].filter(t => t.q > 0) : [], sg = sugs[k] || []
    return { d, k, r, tk, sg, groups: [
      ...proxyGroups(d, data, { side: r.side, main: r.main, maybe: r.maybe }).map(g => ({ ...g, key: `${g.c.n}|${g.src || ''}`, fb: d.prints?.[g.c.n]?.id })),
      // artes extra do comandante e dos sub-comandantes: uma cópia de cada, além da do deck
      ...(r.main ? Object.entries(r.alts || {}).flatMap(([n, l]) => { const c = data.byName.get(n); return c ? l.map(src => ({ c, q: 1, src, key: `${n}|${src}|alt`, alt: true })) : [] }) : []),
      ...tk.map(t => ({ c: { n: t.name, id: t.id, df: false }, q: t.q, src: null, token: true, key: `tok|${t.id}` })),
      ...sg.map(c => ({ c, q: 1, src: null, sug: true, key: `${c.n}|` }))] }
  }), [all, opts, toks, sugs, data])
  const [o, setO] = useState(loadPrint), [pdfBusy, setPdfBusy] = useState('')
  const up = p => setO(x => { const n = { ...x, ...p }; try { localStorage.setItem('grimorio.print', JSON.stringify(n)) } catch { /* sem armazenamento */ } return n })
  const [busy, setBusy] = useState(''), [err, setErr] = useState(''), [warn, setWarn] = useState(''), [copied, setCopied] = useState(false)
  const L = useMemo(() => layout(o), [o])
  const share = multi && o.share, newSheet = multi && o.newSheet
  const pack = useMemo(() => packDecks(secs, L.per, { share, newSheet }), [secs, L.per, share, newSheet])
  const slots = useMemo(() => {
    const ex = new Map(pack.items.map(it => [it, { ...it, thumb: urlOf(it.g, 'small'), front: urlOf(it.g, 'png'), back: urlOf(it.g, 'png', true) || CARD_BACK }]))
    return pack.slots.map(s => s && ex.get(s))
  }, [pack])
  const names = secs.map(s => s.d.name)
  const list = useMemo(() => {
    const extras = (tk, sg) => [...(tk.length ? [`\n// ${tx('Tokens')}`, ...tk.map(t => `${t.q} ${t.name}`)] : []), ...(sg.length ? [`\n// ${tx('Sugestões do Grimório')}`, ...sg.map(c => `1 ${c.n}`)] : [])]
    const full = s => [...(s.r.main || s.r.side ? [exportList({ ...s.d, ...(s.r.main ? {} : { main: {}, commanders: [], signature: null }), side: s.r.side ? s.d.side || {} : {} }, { maybe: false })] : []),
      ...(s.r.maybe && Object.keys(s.d.maybe || {}).length ? [`\n// Maybeboard`, ...Object.entries(s.d.maybe).map(([n, q]) => listLine(n, q, s.d.prints?.[n]))] : []), ...extras(s.tk, s.sg)]
    if (!multi) return secs[0] ? full(secs[0]).join('\n') : ''
    const shared = i => {  // só as cópias que os decks de cima ainda não têm
      const mine = pack.items.filter(it => it.deck === i), by = f => mine.filter(it => f(it.g))
      const out = [...by(g => !g.token && !g.sug).map(it => listLine(it.g.c.n, it.q, it.g.pr)), ...extras(by(g => g.token).map(it => ({ q: it.q, name: it.g.c.n })), by(g => g.sug).map(it => it.g.c))]
      return out.length ? out : [`// ${tx('(já está tudo nos decks de cima)')}`]
    }
    return [...(share ? [`// ${tx('Cartas partilhadas: cada deck só traz as cópias que os de cima ainda não têm')}`] : []),
      ...secs.map((s, i) => [`// ${s.d.name}`, ...(share ? shared(i) : full(s))].join('\n'))].join('\n\n')
  }, [secs, multi, share, pack])
  const total = slots.filter(Boolean).length, owned = pack.items.filter(it => own(it.g.src)).reduce((a, it) => a + it.q, 0)
  const sum = secs.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.q, 0), 0)
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  const sheets = L.per ? Math.ceil(slots.length / L.per) : 0
  const [pgS, setPg] = useState(0), pg = Math.min(pgS, Math.max(0, sheets - 1))
  // nomes dos decks na folha: no cimo os que lá estão; por baixo de cada carta, se couber, o(s) deck(s) dela
  const labelsOf = p => (multi && o.deckNames && pack.sheets[p] ? sheetLabels(L, `${pack.sheets[p].map(i => names[i]).join(' · ')} — ${p + 1}/${sheets}`,
    o.deckTags ? slots.slice(p * L.per, (p + 1) * L.per).map(s => s && s.decks.map(i => names[i]).join(' + ')) : null) : [])
  const base = fileBase(secs.map(s => s.d))
  const makePdf = async () => {
    setErr(''); setWarn('')
    const real = slots.filter(Boolean), urls = [...new Set(real.flatMap(x => (o.duplex ? [x.front, x.back] : [x.front])))], idx = new Map(), images = []
    let missed = 0, ups = 0
    const up1 = () => { ups++ }
    try {
      for (const u of urls) {
        setPdfBusy(tx('A preparar as imagens… {a}/{b}', { a: images.length + 1, b: urls.length }))
        let im
        try { im = await renderCard(fetchable(u), o, L, up1) } catch {
          const sl = real.find(x => x.front === u), fb = sl && img(sl.g.c, 'png', false, sl.g.fb)  // imagem própria que não vem: a arte normal
          if (!fb || fb === u) throw new Error(tx('Não consegui carregar a imagem de {c}.', { c: sl?.g.c.n || u }))
          im = await renderCard(fb, o, L, up1); missed++
        }
        idx.set(u, images.length); images.push(im)
      }
      setPdfBusy(tx('A montar o PDF…'))
      // o fundo por baixo de um ponto da folha: espaço pintado, a carta (amostra da imagem com o bleed) ou o papel
      const gr = gapRects(L, o), gcol = [1, 3, 5].map(k => parseInt((o.gapColor || '#000000').slice(k, k + 2), 16) / 255)
      const bgAt = (p, x, y) => {
        if (gr.some(([gx, gy, w, h]) => x >= gx && x <= gx + w && y >= gy && y <= gy + h)) return gcol
        for (let i = 0; i < L.cells.length; i++) {
          const k = L.cells[i], [l, t, r, b] = k.clip
          if (x < l || x > r || y < t || y > b) continue
          const sl = slots[p * L.per + i], im = sl && images[idx.get(sl.front)]
          if (!im?.grid) return [0.25, 0.25, 0.25]
          const u = Math.min(GRID[0] - 1, Math.max(0, Math.floor((x - (k.x - L.b)) / (L.cw + 2 * L.b) * GRID[0])))
          const v = Math.min(GRID[1] - 1, Math.max(0, Math.floor((y - (k.y - L.b)) / (L.ch + 2 * L.b) * GRID[1])))
          const q = (v * GRID[0] + u) * 4
          return [im.grid[q] / 255, im.grid[q + 1] / 255, im.grid[q + 2] / 255]
        }
        return [1, 1, 1]
      }
      const bytes = pdf(L.W, L.H, pageOps(L, o, slots, (x, side) => idx.get(side === 'back' ? x.back : x.front), labelsOf, bgAt), images)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = `${base} - proxies.pdf`; a.click()
      if (ups) setWarn(tx('{n} imagem com pouca resolução foi ampliada com IA.|{n} imagens com pouca resolução foram ampliadas com IA.', { n: ups }) + (missed ? ' ' : ''))
      if (missed) setWarn(w => w + tx('{n} imagem própria não veio e ficou a arte normal.|{n} imagens próprias não vieram e ficou a arte normal.', { n: missed }))
    } catch (e) { setErr(e.message) } finally { setPdfBusy('') }
  }
  const zip = async () => {
    // partilhadas: tudo numa pasta, cada arte uma vez; senão uma pasta por deck (com um deck só, como sempre)
    const merged = new Map()
    for (const it of pack.items) { const x = share && merged.get(it.g.key); if (x) x.q += it.q; else merged.set(share ? it.g.key : merged.size, { ...it }) }
    const items = [...merged.values()].map(it => ({ name: it.g.c.n, q: it.q, url: urlOf(it.g, 'png'), back: urlOf(it.g, 'png', true), ...(own(it.g.src) && { fallback: img(it.g.c, 'png', false, it.g.fb) }), ...(multi && !share && { folder: names[it.deck] }) }))
    setErr(''); setBusy(tx('A juntar {n} imagens…', { n: items.length }))
    try {
      setWarn('')
      const r = await fetch('/api/proxies.zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, list, perCopy, name: base }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || tx('Não consegui juntar as imagens.'))
      const missed = +(r.headers.get('X-Missed') || 0)
      if (missed) setWarn(tx('{n} imagem própria não veio (o site recusa descargas que não sejam do browser) e ficou a arte normal; a lista está no faltam.txt. Para as incluir, guarda-as no computador e junta-as em «Imagem própria › Uma pasta de imagens › Pasta do computador». A folha para imprimir já as mostra.|{n} imagens próprias não vieram (o site recusa descargas que não sejam do browser) e ficou a arte normal; a lista está no faltam.txt. Para as incluir, guarda-as no computador e junta-as em «Imagem própria › Uma pasta de imagens › Pasta do computador». A folha para imprimir já as mostra.', { n: missed }))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await r.blob()); a.download = `${base} - proxies.zip`; a.click()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const tokList = k => {
    const t0 = toks[k]
    if (!optOf(k).tok) return null
    if (!t0) return <p className="muted small">{tx('A procurar os tokens na Scryfall…')}</p>
    return t0.length ? <ul className="px-toks">{t0.map((t, j) => (
      <li key={t.id}><input type="number" min="0" max="40" value={t.q} onChange={e => setToks(m => ({ ...m, [k]: m[k].map((x, i) => (i === j ? { ...x, q: Math.max(0, Math.min(40, +e.target.value || 0)) } : x)) }))} aria-label={tx('Quantos de {t}', { t: t.name })} />
        <b>{t.name}</b> <small className="muted">{t.type.replace(/^Token /, '')} · {tx('de {c}', { c: t.from.join(', ') })}</small></li>))}</ul>
      : <p className="muted small">{tx('Nenhuma carta do deck cria tokens.')}</p>
  }
  const sugNames = k => (optOf(k).sug && sugs[k]?.length > 0 ? <p className="muted small">{sugs[k].map(c => c.n).join(' · ')}</p> : null)
  const sugN = (k, r) => <input className="px-n" type="number" min="1" max="40" value={r.sugN} onChange={e => setOpt(k, { sugN: Math.max(1, Math.min(40, +e.target.value || 1)) })} aria-label={tx('Quantas sugestões')} />
  const k0 = all[0] && keyOf(all[0]), r0 = optOf(k0)
  // sem deck nenhum (o quadrado «Proxies» do início): começa por escolher os decks
  if (!all.length) return createPortal(
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal proxies" role="dialog" aria-label={tx('Proxies')}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>🖨 {tx('Proxies')}</h3>
        <p className="muted small">{tx('Escolhe um ou mais decks: lista para sites de proxies, ZIP com as imagens ou folhas para imprimir, com os tokens e as sugestões de cada deck.')}</p>
        <JoinPicker have={[]} onAdd={ds => setExtra(ds)} onClose={onClose} />
      </div>
    </div>, document.body)
  return createPortal(
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal proxies" role="dialog" aria-label={tx('Proxies')}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>🖨 {multi ? tx('Proxies de {n} decks', { n: all.length }) : tx('Proxies de «{name}»', { name: all[0]?.name })}</h3>
        <p className="muted small">{multi ? tx('{n} cartas de {d} decks', { n: total, d: secs.length }) : tx('{n} cartas com as artes que escolheste', { n: total })}{share && sum > total ? ` · ${tx('{n} a menos por partilhar', { n: sum - total })}` : ''}{owned ? ` · ${tx('{n} com imagem própria', { n: owned })}` : ''}</p>
        {!multi ? <>
          <label className="chk small"><input type="checkbox" checked={r0.main} onChange={e => setOpt(k0, { main: e.target.checked })} /> {tx('Incluir o deck (comandante e principal)')}</label>
          <label className="chk small"><input type="checkbox" checked={r0.side} onChange={e => setOpt(k0, { side: e.target.checked })} /> {tx('Incluir o sideboard')}</label>
          {Object.keys(all[0]?.maybe || {}).length > 0 && <label className="chk small"><input type="checkbox" checked={r0.maybe} onChange={e => setOpt(k0, { maybe: e.target.checked })} /> {tx('Incluir o maybeboard ({n})', { n: Object.values(all[0].maybe).reduce((a, b) => a + b, 0) })}</label>}
          <label className="chk small"><input type="checkbox" checked={r0.tok} onChange={e => { setOpt(k0, { tok: e.target.checked }); setTokErr('') }} /> {tx('Incluir os tokens que o deck cria')}</label>
          {tokList(k0)}
          {tokErr && <p className="small bad-t">{tokErr}</p>}
          {r0.main && <CmdAlts data={data} d={all[0]} alts={r0.alts || {}} setAlts={a => setOpt(k0, { alts: a })} />}
          {(ctx || !deck) && <label className="chk small"><input type="checkbox" checked={r0.sug} onChange={e => setOpt(k0, { sug: e.target.checked })} /> {tx('Incluir sugestões do Grimório para testar')} {r0.sug && sugN(k0, r0)}</label>}
          {sugNames(k0)}
        </> : <>
          <ul className="px-decks">{all.map(d => {
            const k = keyOf(d), r = optOf(k), s = secs.find(x => x.k === k)
            return (
              <li key={k} className={r.on ? '' : 'off'}>
                <div className="px-drow">
                  <label className="chk"><input type="checkbox" checked={r.on} onChange={e => setOpt(k, { on: e.target.checked })} /> <b>{d.name}</b></label>
                  {s && <small className="muted">{tx('{n} carta|{n} cartas', { n: s.groups.reduce((a, g) => a + g.q, 0) })}</small>}
                </div>
                {r.on && <div className="px-dopts">
                  <label className="chk small"><input type="checkbox" checked={r.main} onChange={e => setOpt(k, { main: e.target.checked })} /> {tx('Deck')}</label>
                  <label className="chk small"><input type="checkbox" checked={r.side} onChange={e => setOpt(k, { side: e.target.checked })} /> {tx('Sideboard')}</label>
                  {Object.keys(d.maybe || {}).length > 0 && <label className="chk small"><input type="checkbox" checked={r.maybe} onChange={e => setOpt(k, { maybe: e.target.checked })} /> Maybeboard</label>}
                  <label className="chk small"><input type="checkbox" checked={r.tok} onChange={e => { setOpt(k, { tok: e.target.checked }); setTokErr('') }} /> {tx('Tokens')}</label>
                  <label className="chk small"><input type="checkbox" checked={r.sug} onChange={e => setOpt(k, { sug: e.target.checked })} /> {tx('Sugestões')} {r.sug && sugN(k, r)}</label>
                </div>}
                {r.on && r.main && <CmdAlts data={data} d={d} alts={r.alts || {}} setAlts={a => setOpt(k, { alts: a })} />}
                {r.on && tokList(k)}
                {r.on && sugNames(k)}
              </li>)
          })}</ul>
          {tokErr && <p className="small bad-t">{tokErr}</p>}
        </>}
        <div className="row-btns"><button className="link small" onClick={() => setJoining(j => !j)}>＋ {tx('Juntar outros decks')}</button></div>
        {joining && <JoinPicker have={all.map(d => d.id).filter(Boolean)} onAdd={ds => { setExtra(x => [...x, ...ds]); setJoining(false) }} onClose={() => setJoining(false)} />}

        {multi && <section className="px-opt px-multi">
          <h4>{tx('Vários decks')}</h4>
          {[[false, tx('Otimizar folhas'), tx('Os decks seguem uns atrás dos outros, sem folhas meio vazias.')], [true, tx('Cada deck começa numa folha nova'), tx('Mais fácil de separar depois do corte, mas a última folha de cada deck pode ficar meio vazia.')]].map(([v, l, d]) => (
            <label key={l} className="chk small"><input type="radio" name="px-sheets" checked={!!o.newSheet === v} onChange={() => up({ newSheet: v })} /> <span><b>{l}</b> <span className="muted">· {d}</span></span></label>))}
          <label className="chk small"><input type="checkbox" checked={o.deckNames} onChange={e => up({ deckNames: e.target.checked })} /> {tx('Nome do deck na folha (na margem de cima)')}</label>
          {o.deckNames && <label className="chk small"><input type="checkbox" checked={o.deckTags} onChange={e => up({ deckTags: e.target.checked })} /> {tx('E uma etiqueta pequena debaixo de cada carta, fora do corte')}</label>}
          {o.deckNames && o.deckTags && tagRoom(L) < 1.4 && <p className="muted small">{tx('As etiquetas precisam de espaço entre as cartas (pelo menos 1,4 mm, como na pré-definição de gráfica); assim fica só o nome no cimo.')}</p>}
          <label className="chk small"><input type="checkbox" checked={o.share} onChange={e => up({ share: e.target.checked })} /> {tx('Partilhar cartas entre decks')}</label>
          <p className="muted small">{tx('Cada arte sai só as vezes que o deck que mais a usa precisa, em vez da soma — para quem nunca tem os decks montados ao mesmo tempo.')}</p>
        </section>}

        <section className="px-opt">
          <h4>{tx('Lista para sites de proxies')}</h4>
          <p className="muted small">{tx('Com a edição de cada carta (e uma linha por arte nas cópias divididas). Serve para o Moxfield, Archidekt, MPCFill, mtgprint e afins. As imagens próprias não passam por uma lista: usa o ZIP ou a folha.')}</p>
          <textarea readOnly value={list} rows={6} />
          <div className="row-btns">
            <button onClick={async () => { try { await navigator.clipboard.writeText(list); setCopied(true) } catch { setErr(tx('O browser não deixou copiar; usa «Descarregar».')) } }}>{copied ? tx('✓ Copiada') : tx('Copiar lista')}</button>
            <button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([list], { type: 'text/plain' })); a.download = `${base}.txt`; a.click() }}>{tx('Descarregar')}</button>
          </div>
        </section>

        <section className="px-opt">
          <h4>{tx('Imagens (ZIP)')}</h4>
          <p className="muted small">{tx('Cada arte numa imagem de alta qualidade (PNG da Scryfall ou a tua), com o verso das cartas de duas faces e a lista dentro. Para enviar a uma gráfica (MakePlayingCards, loja local…).')}{multi ? ` ${share ? tx('Com as cartas partilhadas fica tudo numa pasta.') : tx('Uma pasta por deck.')}` : ''}</p>
          <label className="chk small"><input type="checkbox" checked={perCopy} onChange={e => setPerCopy(e.target.checked)} /> {tx('Um ficheiro por cópia (em vez de «Island (x4)»)')}</label>
          <div className="row-btns"><button className="primary" disabled={!!busy || !pack.items.length} onClick={zip}>⬇ {busy || tx('Descarregar ZIP')}</button></div>
        </section>

        <section className="px-opt px-print">
          <h4>{tx('Folha para imprimir (PDF)')}</h4>
          <p className="muted small">{tx('Tamanho real, pronta para a impressora ou para uma gráfica: papel, margens, espaço entre cartas, bleed e guias de corte. Imprime a 100%.')}</p>
          <div className="row-btns"><button className="link small" onClick={() => up({ gap: [2.8, 2.8], bleed: 10, guides: 'lines', individual: true, guideColor: '#808080', bleedFill: 'replicate', customMargins: true, margins: [10, 10, 10, 10] })}>⚙ {tx('Pré-definição de gráfica: 0,28 cm entre cartas, bleed 1 cm, corte individual')}</button></div>
          <div className="pgrid">
            <div className="pset">
              <label><span>{tx('Unidade')}</span><select value={o.unit} onChange={e => up({ unit: e.target.value })}><option value="cm">{tx('Centímetros')}</option><option value="mm">{tx('Milímetros')}</option><option value="in">{tx('Polegadas')}</option></select></label>
              <label><span>{tx('Papel')}</span><select value={o.paper} onChange={e => up({ paper: e.target.value })}>{Object.entries(PAPERS).map(([k, [w, h]]) => <option key={k} value={k}>{k} · {+(w / UNITS[o.unit]).toFixed(2)}×{+(h / UNITS[o.unit]).toFixed(2)} {o.unit}</option>)}<option value="custom">{tx('À medida')}</option></select></label>
              {o.paper === 'custom' && <div className="pair"><Num label={tx('Largura')} v={o.custom[0]} unit={o.unit} set={v => up({ custom: [v, o.custom[1]] })} /><Num label={tx('Altura')} v={o.custom[1]} unit={o.unit} set={v => up({ custom: [o.custom[0], v] })} /></div>}
              <label><span>{tx('Orientação')}</span><select value={o.landscape ? 'h' : 'v'} onChange={e => up({ landscape: e.target.value === 'h' })}><option value="v">{tx('Vertical')}</option><option value="h">{tx('Horizontal')}</option></select></label>
              <label><span>{tx('Guias de corte')}</span><select value={o.guides} onChange={e => up({ guides: e.target.value })}><option value="none">{tx('Nenhuma')}</option><option value="lines">{tx('Linhas a toda a folha')}</option><option value="margins">{tx('Só nas margens da folha')}</option><option value="corners">{tx('Marcas nos cantos')}</option><option value="crosses">{tx('Cruzes nos cantos + margens (gráfica)')}</option></select></label>
              {(o.guides === 'corners' || o.guides === 'crosses') && <Num label={tx('Tamanho das marcas')} v={o.markLen ?? 3} unit="mm" set={v => up({ markLen: Math.max(0.5, v) })} />}
              {o.guides !== 'none' && <label><span>{tx('Cor das linhas de corte')}</span><input type="color" value={o.guideColor} onChange={e => up({ guideColor: e.target.value })} /></label>}
              {o.guides !== 'none' && <Num label={tx('Espessura das linhas')} v={o.guideWidth} unit="mm" set={v => up({ guideWidth: Math.max(0.05, v) })} />}
              {o.guides !== 'none' && <label><span>{tx('Contraste das linhas')}</span><select value={o.guideContrast || 'off'} onChange={e => up({ guideContrast: e.target.value })}
                title={tx('A cor de cada pedaço da linha muda conforme o que está por baixo: o cinzento escolhido fica mais claro sobre o escuro e mais escuro sobre o claro; só onde o cinzento não chega muda de cor.')}>
                <option value="off">{tx('Desligado (sempre a cor escolhida)')}</option><option value="some">{tx('Algum (cinzentos)')}</option><option value="strong">{tx('Bastante (do preto ao branco)')}</option></select></label>}
              {(o.guides === 'lines' || o.guides === 'margins' || o.guides === 'crosses') && <label className="chk small"><input type="checkbox" checked={o.individual !== false} onChange={e => up({ individual: e.target.checked })} /> {tx('Corte individual para cada carta (linhas nos dois lados de cada espaço)')}</label>}
              <Num label={tx('Bleed')} v={o.bleed} unit={o.unit} set={v => up({ bleed: v })} />
              {o.bleed > 0 && <label><span>{tx('Bleed com')}</span><select value={o.bleedFill} onChange={e => up({ bleedFill: e.target.value })}><option value="replicate">{tx('A margem da carta esticada (inteligente)')}</option><option value="black">{tx('Preto')}</option><option value="color">{tx('Uma cor à escolha')}</option></select></label>}
              {o.bleed > 0 && o.bleedFill === 'color' && <label><span>{tx('Cor do bleed')}</span><input type="color" value={o.bleedColor} onChange={e => up({ bleedColor: e.target.value })} /></label>}
              <label className="chk small"><input type="checkbox" checked={o.fillCorners} onChange={e => up({ fillCorners: e.target.checked })} /> {tx('Preencher os cantos redondos')}</label>
              {(o.gap[0] > 0 || o.gap[1] > 0) && <label><span>{tx('Pintar entre cartas')}</span><select value={o.gapFill || 'off'} onChange={e => up({ gapFill: e.target.value })} title={tx('Onde se cruzam os cantos de 4 cartas o bleed esticado de cada uma não combina; uma cor lisa deixa o corte limpo.')}>
                <option value="off">{tx('Nada')}</option><option value="cross">{tx('Só os cruzamentos (cantos de 4 cartas)')}</option><option value="gaps">{tx('Todo o espaço entre cartas')}</option></select></label>}
              {(o.gap[0] > 0 || o.gap[1] > 0) && (o.gapFill || 'off') !== 'off' && <label><span>{o.gapFill === 'cross' ? tx('Cor dos cruzamentos') : tx('Cor entre cartas')}</span><input type="color" value={o.gapColor || '#000000'} onChange={e => up({ gapColor: e.target.value })} /></label>}
              <label><span>{tx('Resolução')}</span><select value={o.dpi || DPI} onChange={e => up({ dpi: +e.target.value })}>
                {[300, 450, 600].map(d => <option key={d} value={d}>{tx('{d} dpi', { d })}{d === 300 ? ` · ${tx('normal')}` : d === 600 ? ` · ${tx('máxima (PDF ~4× maior)')}` : ''}</option>)}</select></label>
              <label className="chk small"><input type="checkbox" checked={!!o.upAI} onChange={e => up({ upAI: e.target.checked })} /> {tx('Ampliar com IA as imagens com pouca resolução (Real-ESRGAN no browser; mais lento)')}</label>
              <label className="chk small"><input type="checkbox" checked={o.watermark} onChange={e => up({ watermark: e.target.checked })} /> {tx('Marca de água')}</label>
              {o.watermark && <label><span>{tx('Texto')}</span><input value={o.watermarkText} maxLength={24} onChange={e => up({ watermarkText: e.target.value })} /></label>}
              <label className="chk small"><input type="checkbox" checked={o.duplex} onChange={e => up({ duplex: e.target.checked })} /> {tx('Frente e verso (o verso das cartas de duas faces ou as costas do Magic)')}</label>
              {o.duplex && <label><span>{tx('A folha vira pela')}</span><select value={o.flip} onChange={e => up({ flip: e.target.value })}><option value="side">{tx('margem lateral')}</option><option value="top">{tx('margem de cima')}</option></select></label>}
              <details className="padv">
                <summary>{tx('Opções avançadas')}</summary>
                <label className="chk small"><input type="checkbox" checked={o.customMargins} onChange={e => up({ customMargins: e.target.checked })} /> {tx('Margens da folha à medida')}</label>
                {o.customMargins && <div className="quad">{[tx('Cima'), tx('Direita'), tx('Baixo'), tx('Esquerda')].map((l, k) => <Num key={k} label={l} v={o.margins[k]} unit={o.unit} set={v => up({ margins: o.margins.map((m, j) => (j === k ? v : m)) })} />)}</div>}
                <label className="chk small"><input type="checkbox" checked={o.center} onChange={e => up({ center: e.target.checked })} /> {tx('Centrar as cartas na folha')}</label>
                <div className="pair"><Num label={tx('Carta: largura')} v={o.card[0]} unit={o.unit} set={v => up({ card: [v, o.card[1]] })} /><Num label={tx('altura')} v={o.card[1]} unit={o.unit} set={v => up({ card: [o.card[0], v] })} /></div>
                <div className="pair"><Num label={tx('Espaço entre cartas: ↔')} v={o.gap[0]} unit={o.unit} set={v => up({ gap: [v, o.gap[1]] })} /><Num label="↕" v={o.gap[1]} unit={o.unit} set={v => up({ gap: [o.gap[0], v] })} /></div>
                <button className="link small" onClick={() => up(PRINT0)}>{tx('Repor tudo')}</button>
              </details>
            </div>
            <div className="pview">
              <Preview {...{ L, o, slots: slots.slice(pg * L.per, (pg + 1) * L.per), labels: labelsOf(pg) }} />
              {sheets > 1 && <div className="ppager"><button className="link" disabled={!pg} onClick={() => setPg(pg - 1)} aria-label={tx('Folha anterior')}>‹</button> <span className="small">{tx('Folha {a} de {b}', { a: pg + 1, b: sheets })}</span> <button className="link" disabled={pg >= sheets - 1} onClick={() => setPg(pg + 1)} aria-label={tx('Folha seguinte')}>›</button></div>}
              <p className="small">{L.per ? tx('{n} por folha ({c}×{r}) · {s} folha|{n} por folha ({c}×{r}) · {s} folhas', { n: L.per, c: L.cols, r: L.rows, s: sheets }) : <span className="bad-t">{tx('A carta não cabe na folha com estas margens.')}</span>}{o.duplex && L.per ? ` · ${tx('frente e verso')}` : ''}</p>
              {L.warn.includes('bleed') && <p className="muted small">{tx('Entre cartas o bleed fica com metade do espaço ({v}), para não tapar a vizinha; por fora fica o bleed inteiro.', { v: `${+(Math.min(o.bleed, Math.min(o.gap[0], o.gap[1]) / 2) / UNITS[o.unit]).toFixed(3)} ${o.unit}` })}</p>}
              <button className="primary" disabled={!!pdfBusy || !L.per || !slots.length} onClick={makePdf}>⬇ {pdfBusy || tx('Gerar PDF')}</button>
              <CostCalc n={total} sheets={sheets} duplex={o.duplex} />
            </div>
          </div>
        </section>
        {warn && <p className="small warn-t">{warn}</p>}
        {err && <p className="small bad-t">{err}</p>}
      </div>
    </div>, document.body)
}
