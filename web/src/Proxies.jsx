// Proxies: levar o deck com as artes escolhidas para uma gráfica ou para a impressora.
//  1. lista com as edições («4 Island (FRA) 386», cópias divididas numa linha por arte) — Moxfield, MPCFill, mtgprint…;
//  2. ZIP com as imagens (PNG da Scryfall e as imagens próprias), um ficheiro por grupo ou por cópia;
//  3. folha para imprimir: 63×88 mm, 9 por página A4/Letter, com linhas de corte (imprimir ou guardar em PDF).
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { img, sf, recommend } from './data.js'
import { exportList, proxyGroups } from './deck.js'
import { PAPERS, UNITS, PRINT0, layout, guides, pageOps, pdf } from './printpdf.js'
import { tx } from './i18n.js'
import { useBackClose } from './backnav.js'

const own = s => s && (s.startsWith('arts/') || s.startsWith('https:'))
const urlOf = (g, size, back = false) => (back ? (g.c.df && !own(g.src) ? img(g.c, size, true, g.src) : null) : img(g.c, size, false, g.src))

// cada arte numa imagem com o bleed à volta (300 ppp): preto, uma cor, ou a margem da carta esticada para fora
// (a cor de fundo é a mediana da margem, para os cantos redondos e as pontas das tiras)
const DPI = 300
const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url })
function edgeColor(im) {
  const iw = im.naturalWidth, ih = im.naturalHeight, cv = document.createElement('canvas')
  cv.width = iw; cv.height = ih
  const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0)
  const px = [], dx = Math.round(iw * 0.012), dy = Math.round(ih * 0.012)
  for (let t = 0.12; t <= 0.88; t += 0.04) for (const [a, b] of [[t * iw, dy], [t * iw, ih - 1 - dy], [dx, t * ih], [iw - 1 - dx, t * ih]]) px.push(x.getImageData(Math.round(a), Math.round(b), 1, 1).data)
  const med = k => px.map(p => p[k]).sort((a, b) => a - b)[px.length >> 1]
  return `rgb(${med(0)},${med(1)},${med(2)})`
}
async function renderCard(url, o, L) {
  const im = await loadImg(url)
  const k = DPI / 25.4, b = Math.round(L.b * k), w = Math.round(L.cw * k), h = Math.round(L.ch * k)
  const cv = document.createElement('canvas'); cv.width = w + 2 * b; cv.height = h + 2 * b
  const x = cv.getContext('2d')
  x.fillStyle = o.bleedFill === 'black' ? '#000' : o.bleedFill === 'color' ? o.bleedColor : edgeColor(im)
  x.fillRect(0, 0, cv.width, cv.height)
  if (o.bleedFill === 'replicate' && b) {
    const iw = im.naturalWidth, ih = im.naturalHeight, sx = Math.round(iw * 0.012), sy = Math.round(ih * 0.012)
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
  return { w: cv.width, h: cv.height, bytes: new Uint8Array(await blob.arrayBuffer()) }
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
function Preview({ L, o, slots }) {
  const g = guides(L, o.guides, o.individual !== false)
  return (
    <svg className="pprev" viewBox={`0 0 ${L.W} ${L.H}`} role="img" aria-label={tx('Pré-visualização da folha')}>
      <rect width={L.W} height={L.H} fill="#fff" />
      {L.cells.map((k, i) => { const s = slots[i]; const [l, t, r, b] = k.clip; return (
        <g key={i}>
          <rect x={l} y={t} width={r - l} height={b - t} fill={o.bleedFill === 'black' ? '#000' : o.bleedFill === 'color' ? o.bleedColor : '#3a3a3a'} />
          {s ? <image href={s.thumb} x={k.x} y={k.y} width={L.cw} height={L.ch} preserveAspectRatio="none" /> : <rect x={k.x} y={k.y} width={L.cw} height={L.ch} fill="#ddd" />}
        </g>) })}
      {g.map(([a, b, c, d], i) => <line key={i} x1={a} y1={b} x2={c} y2={d} stroke={o.guideColor} strokeWidth={Math.max(o.guideWidth, L.W / 600)} />)}
    </svg>
  )
}

// quantos tokens uma carta cria de cada vez («create two …», X conta como 3)
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, x: 3 }
const madeBy = c => { const m = /\bcreates? (a|an|one|two|three|four|five|six|x|\d+)\b/i.exec(c?.o || ''); return m ? NUMW[m[1].toLowerCase()] || +m[1] || 1 : 1 }

export default function ProxyDialog({ data, deck, ctx, onClose }) {
  useBackClose(true, onClose)  // «voltar» do telemóvel fecha esta janela
  const [side, setSide] = useState(true), [perCopy, setPerCopy] = useState(false)
  // extras: os tokens que as cartas do deck criam (Scryfall, pelo servidor) e as sugestões do Grimório para testar
  const [withTok, setWithTok] = useState(false), [toks, setToks] = useState(null), [tokErr, setTokErr] = useState('')
  const [withSug, setWithSug] = useState(false), [sugN, setSugN] = useState(10)
  useEffect(() => {
    if (!withTok || toks) return
    const names = [...new Set([...deck.commanders || [], ...Object.keys(deck.main || {}), ...Object.keys(side ? deck.side || {} : {})])]
    fetch('/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.erro); return j })
      .then(l => setToks(l.map(t => ({ ...t, q: Math.max(1, Math.min(12, t.from.reduce((a, n) => a + madeBy(data.byName.get(n)) * ((deck.main?.[n] || 0) + (deck.side?.[n] || 0) || 1), 0))) }))))
      .catch(e => { setTokErr(e.message); setWithTok(false) })
  }, [withTok, toks, deck, side, data])
  const sugs = useMemo(() => {
    if (!withSug || !ctx) return []
    const have = [...deck.commanders || [], ...Object.keys(deck.main || {})].map(n => data.byName.get(n)?.i).filter(i => i != null)
    const cols = new Set(have.flatMap(i => (data.cards[i].mt === 'Land' ? [] : [...data.cards[i].ci])))  // as cores do deck, sem os terrenos
    return recommend(data, { seeds: have.filter(i => data.cards[i].mt !== 'Land'), have, ctx, filters: { noLands: true }, limit: sugN * 3 }).map(r => r.c)
      .filter(c => !deck.main?.[c.n] && !deck.side?.[c.n] && [...c.ci].every(k => cols.has(k))).slice(0, sugN)
  }, [withSug, sugN, data, deck, ctx])
  const [o, setO] = useState(loadPrint), [pdfBusy, setPdfBusy] = useState('')
  const up = p => setO(x => { const n = { ...x, ...p }; try { localStorage.setItem('grimorio.print', JSON.stringify(n)) } catch { /* sem armazenamento */ } return n })
  const [busy, setBusy] = useState(''), [err, setErr] = useState(''), [warn, setWarn] = useState(''), [copied, setCopied] = useState(false)
  const groups = useMemo(() => [...proxyGroups(deck, data, { side }),
    ...(withTok && toks ? toks.filter(t => t.q > 0).map(t => ({ c: { n: t.name, id: t.id, df: false }, q: t.q, src: null, token: true })) : []),
    ...sugs.map(c => ({ c, q: 1, src: null, sug: true }))], [deck, data, side, withTok, toks, sugs])
  const list = useMemo(() => [exportList(side ? deck : { ...deck, side: {} }),
    ...(withTok && toks?.some(t => t.q > 0) ? [`\n// ${tx('Tokens')}`, ...toks.filter(t => t.q > 0).map(t => `${t.q} ${t.name}`)] : []),
    ...(sugs.length ? [`\n// ${tx('Sugestões do Grimório')}`, ...sugs.map(c => `1 ${c.n}`)] : [])].join('\n'), [deck, side, withTok, toks, sugs])
  const total = groups.reduce((a, g) => a + g.q, 0), owned = groups.filter(g => own(g.src)).reduce((a, g) => a + g.q, 0)
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  const L = useMemo(() => layout(o), [o])
  const slots = useMemo(() => groups.flatMap(g => Array.from({ length: g.q }, () => ({ g, thumb: urlOf(g, 'small'), front: urlOf(g, 'png'), back: urlOf(g, 'png', true) || CARD_BACK }))), [groups])
  const sheets = L.per ? Math.ceil(slots.length / L.per) : 0
  const makePdf = async () => {
    setErr(''); setWarn('')
    const urls = [...new Set(slots.flatMap(x => (o.duplex ? [x.front, x.back] : [x.front])))], idx = new Map(), images = []
    let missed = 0
    try {
      for (const u of urls) {
        setPdfBusy(tx('A preparar as imagens… {a}/{b}', { a: images.length + 1, b: urls.length }))
        let im
        try { im = await renderCard(fetchable(u), o, L) } catch {
          const sl = slots.find(x => x.front === u), fb = sl && img(sl.g.c, 'png', false, deck.prints?.[sl.g.c.n]?.id)  // imagem própria que não vem: a arte normal
          if (!fb || fb === u) throw new Error(tx('Não consegui carregar a imagem de {c}.', { c: sl?.g.c.n || u }))
          im = await renderCard(fb, o, L); missed++
        }
        idx.set(u, images.length); images.push(im)
      }
      setPdfBusy(tx('A montar o PDF…'))
      const bytes = pdf(L.W, L.H, pageOps(L, o, slots, (x, side) => idx.get(side === 'back' ? x.back : x.front)), images)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = `${deck.name.replace(/[^\w\- ]+/g, '') || 'deck'} - proxies.pdf`; a.click()
      if (missed) setWarn(tx('{n} imagem própria não veio e ficou a arte normal.|{n} imagens próprias não vieram e ficou a arte normal.', { n: missed }))
    } catch (e) { setErr(e.message) } finally { setPdfBusy('') }
  }
  const zip = async () => {
    setErr(''); setBusy(tx('A juntar {n} imagens…', { n: groups.length }))
    try {
      setWarn('')
      const items = groups.map(g => ({ name: g.c.n, q: g.q, url: urlOf(g, 'png'), back: urlOf(g, 'png', true), ...(own(g.src) && { fallback: img(g.c, 'png', false, deck.prints?.[g.c.n]?.id) }) }))
      const r = await fetch('/api/proxies.zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, list, perCopy, name: deck.name }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || tx('Não consegui juntar as imagens.'))
      const missed = +(r.headers.get('X-Missed') || 0)
      if (missed) setWarn(tx('{n} imagem própria não veio (o site recusa descargas que não sejam do browser) e ficou a arte normal; a lista está no faltam.txt. Para as incluir, guarda-as no computador e junta-as em «Imagem própria › Uma pasta de imagens › Pasta do computador». A folha para imprimir já as mostra.|{n} imagens próprias não vieram (o site recusa descargas que não sejam do browser) e ficou a arte normal; a lista está no faltam.txt. Para as incluir, guarda-as no computador e junta-as em «Imagem própria › Uma pasta de imagens › Pasta do computador». A folha para imprimir já as mostra.', { n: missed }))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await r.blob()); a.download = `${deck.name.replace(/[^\w\- ]+/g, '') || 'deck'} - proxies.zip`; a.click()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  return createPortal(
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal proxies" role="dialog" aria-label={tx('Proxies')}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>🖨 {tx('Proxies de «{name}»', { name: deck.name })}</h3>
        <p className="muted small">{tx('{n} cartas com as artes que escolheste', { n: total })}{owned ? ` · ${tx('{n} com imagem própria', { n: owned })}` : ''}</p>
        <label className="chk small"><input type="checkbox" checked={side} onChange={e => setSide(e.target.checked)} /> {tx('Incluir o sideboard')}</label>
        <label className="chk small"><input type="checkbox" checked={withTok} onChange={e => { setWithTok(e.target.checked); setTokErr('') }} /> {tx('Incluir os tokens que o deck cria')}</label>
        {withTok && !toks && <p className="muted small">{tx('A procurar os tokens na Scryfall…')}</p>}
        {withTok && toks && (toks.length ? <ul className="px-toks">{toks.map((t, k) => (
          <li key={t.id}><input type="number" min="0" max="40" value={t.q} onChange={e => setToks(l => l.map((x, j) => (j === k ? { ...x, q: Math.max(0, Math.min(40, +e.target.value || 0)) } : x)))} aria-label={tx('Quantos de {t}', { t: t.name })} />
            <b>{t.name}</b> <small className="muted">{t.type.replace(/^Token /, '')} · {tx('de {c}', { c: t.from.join(', ') })}</small></li>))}</ul>
          : <p className="muted small">{tx('Nenhuma carta do deck cria tokens.')}</p>)}
        {tokErr && <p className="small bad-t">{tokErr}</p>}
        {ctx && <label className="chk small"><input type="checkbox" checked={withSug} onChange={e => setWithSug(e.target.checked)} /> {tx('Incluir sugestões do Grimório para testar')} {withSug && <input className="px-n" type="number" min="1" max="40" value={sugN} onChange={e => setSugN(Math.max(1, Math.min(40, +e.target.value || 1)))} aria-label={tx('Quantas sugestões')} />}</label>}
        {withSug && sugs.length > 0 && <p className="muted small">{sugs.map(c => c.n).join(' · ')}</p>}

        <section className="px-opt">
          <h4>{tx('Lista para sites de proxies')}</h4>
          <p className="muted small">{tx('Com a edição de cada carta (e uma linha por arte nas cópias divididas). Serve para o Moxfield, Archidekt, MPCFill, mtgprint e afins. As imagens próprias não passam por uma lista: usa o ZIP ou a folha.')}</p>
          <textarea readOnly value={list} rows={6} />
          <div className="row-btns">
            <button onClick={async () => { try { await navigator.clipboard.writeText(list); setCopied(true) } catch { setErr(tx('O browser não deixou copiar; usa «Descarregar».')) } }}>{copied ? tx('✓ Copiada') : tx('Copiar lista')}</button>
            <button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([list], { type: 'text/plain' })); a.download = `${deck.name.replace(/[^\w\- ]+/g, '') || 'deck'}.txt`; a.click() }}>{tx('Descarregar')}</button>
          </div>
        </section>

        <section className="px-opt">
          <h4>{tx('Imagens (ZIP)')}</h4>
          <p className="muted small">{tx('Cada arte numa imagem de alta qualidade (PNG da Scryfall ou a tua), com o verso das cartas de duas faces e a lista dentro. Para enviar a uma gráfica (MakePlayingCards, loja local…).')}</p>
          <label className="chk small"><input type="checkbox" checked={perCopy} onChange={e => setPerCopy(e.target.checked)} /> {tx('Um ficheiro por cópia (em vez de «Island (x4)»)')}</label>
          <div className="row-btns"><button className="primary" disabled={!!busy || !groups.length} onClick={zip}>⬇ {busy || tx('Descarregar ZIP')}</button></div>
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
              <label><span>{tx('Guias de corte')}</span><select value={o.guides} onChange={e => up({ guides: e.target.value })}><option value="none">{tx('Nenhuma')}</option><option value="lines">{tx('Linhas a toda a folha')}</option><option value="margins">{tx('Só nas margens da folha')}</option><option value="corners">{tx('Marcas nos cantos')}</option></select></label>
              {o.guides !== 'none' && <div className="pair">
                <label><span>{tx('Cor')}</span><input type="color" value={o.guideColor} onChange={e => up({ guideColor: e.target.value })} /></label>
                <Num label={tx('Espessura')} v={o.guideWidth} unit="mm" set={v => up({ guideWidth: Math.max(0.05, v) })} />
              </div>}
              {(o.guides === 'lines' || o.guides === 'margins') && <label className="chk small"><input type="checkbox" checked={o.individual !== false} onChange={e => up({ individual: e.target.checked })} /> {tx('Corte individual para cada carta (linhas nos dois lados de cada espaço)')}</label>}
              <Num label={tx('Bleed')} v={o.bleed} unit={o.unit} set={v => up({ bleed: v })} />
              {o.bleed > 0 && <label><span>{tx('Bleed com')}</span><select value={o.bleedFill} onChange={e => up({ bleedFill: e.target.value })}><option value="replicate">{tx('A margem da carta esticada (inteligente)')}</option><option value="black">{tx('Preto')}</option><option value="color">{tx('Uma cor à escolha')}</option></select></label>}
              {o.bleed > 0 && o.bleedFill === 'color' && <label><span>{tx('Cor do bleed')}</span><input type="color" value={o.bleedColor} onChange={e => up({ bleedColor: e.target.value })} /></label>}
              <label className="chk small"><input type="checkbox" checked={o.fillCorners} onChange={e => up({ fillCorners: e.target.checked })} /> {tx('Preencher os cantos redondos')}</label>
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
              <Preview {...{ L, o, slots }} />
              <p className="small">{L.per ? tx('{n} por folha ({c}×{r}) · {s} folha|{n} por folha ({c}×{r}) · {s} folhas', { n: L.per, c: L.cols, r: L.rows, s: sheets }) : <span className="bad-t">{tx('A carta não cabe na folha com estas margens.')}</span>}{o.duplex && L.per ? ` · ${tx('frente e verso')}` : ''}</p>
              {L.warn.includes('bleed') && <p className="muted small">{tx('Entre cartas o bleed fica com metade do espaço ({v}), para não tapar a vizinha; por fora fica o bleed inteiro.', { v: `${+(Math.min(o.bleed, Math.min(o.gap[0], o.gap[1]) / 2) / UNITS[o.unit]).toFixed(3)} ${o.unit}` })}</p>}
              <button className="primary" disabled={!!pdfBusy || !L.per || !slots.length} onClick={makePdf}>⬇ {pdfBusy || tx('Gerar PDF')}</button>
            </div>
          </div>
        </section>
        {warn && <p className="small warn-t">{warn}</p>}
        {err && <p className="small bad-t">{err}</p>}
      </div>
    </div>, document.body)
}
