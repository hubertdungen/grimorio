// ✨ Criar alter art (🎨 Arte da carta): o texto da carta vira um pedido para um modelo de imagem, com toque pessoal e
// referências de estilo; gera pelo servidor (OpenAI, Gemini, gerador local — as chaves nunca saem do servidor) ou pelo
// ChatGPT do utilizador (copiar o pedido, trazer a imagem de volta). A escolhida fica como imagem própria da carta
// (arts/, como as carregadas): aparece no deck, na mesa e nos proxies. ⤢ Ampliar: Real-ESRGAN no browser (upscale.js).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx, num } from './i18n.js'
import { img } from './data.js'
import { useBackClose } from './backnav.js'
import { VOC } from './vocab.js'
import { neutralPrompt, artBox, basePrompt, finalPrompt, costOf, dpiOf, prepareEdit, composite, bitmap, refURL, toBlob, alterHistory, rememberAlter, pickRecipe, recipeOf } from './alterart.js'
import { upscale } from './upscale.js'
import { startUpscale, useUpJobs } from './upjobs.js'

const lsGet = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }
export const post = async blob => {
  const r = await fetch('/api/arts', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }), j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
  return j.url
}
export const fetchable = u => (u?.startsWith('https:') && !/^https:\/\/(cards|backs)\.scryfall\.io\//.test(u) ? `/api/arts/proxy?url=${encodeURIComponent(u)}` : u)
export const Dpi = ({ w, h }) => { const d = dpiOf(w); return <small className={d >= 300 ? 'ok-t' : 'muted'}>{w}×{h} px · ≈ {d} dpi {tx('a 63×88 mm')}{d >= 300 ? ' ✓' : ''}</small> }

// ⤢ ×2 / ×4 de um blob; devolve {blob, w, h}. Mostra o progresso (o motor descarrega-se só da primeira vez).
export function useEnlarge() {
  const [st, setSt] = useState(null)
  const run = async (blob, scale) => {
    setSt({ f: 0, ep: '' })
    try {
      const cv = await upscale(blob, scale, (f, ep) => setSt({ f, ep }))
      return { blob: await toBlob(cv), w: cv.width, h: cv.height }
    } catch (e) {
      throw new Error(e.message === 'grande' ? tx('A imagem ficaria grande demais; experimenta ×2.') : tx('Não consegui ampliar: {e}', { e: e.message }))
    } finally { setSt(null) }
  }
  const view = st && <small className="muted"><span className="spin-dot" /> {st.ep ? tx('A ampliar… {p}% ({m})', { p: Math.round(st.f * 100), m: st.ep === 'webgpu' ? 'GPU' : 'CPU' }) : tx('A carregar o ampliador (só da primeira vez)…')}</small>
  return [run, view, !!st]
}

// Na «Imagem própria» da carta: tamanho, dpi para imprimir e ⤢ ampliar (guarda a ampliada no lugar da atual). A ampliação
// corre em segundo plano (upjobs.js): fechar a janela não a para, e no fim vai para esta carta deste deck (onSaved)
export function UpscaleArt({ src, onSaved, jobKey, label }) {
  const [dim, setDim] = useState(null)
  const job = useUpJobs().find(j => j.key === jobKey)
  const busy = !!job && !job.done && !job.err
  useEffect(() => { const im = new Image(); im.onload = () => setDim({ w: im.naturalWidth, h: im.naturalHeight }); im.src = fetchable(src) }, [src])
  const go = k => startUpscale({
    key: jobKey, label, scale: k, onDone: onSaved,
    work: async prog => {
      try {
        const cv = await upscale(await (await fetch(fetchable(src))).blob(), k, prog)
        return await post(await toBlob(cv))
      } catch (e) { throw new Error(e.message === 'grande' ? tx('A imagem ficaria grande demais; experimenta ×2.') : tx('Não consegui ampliar: {e}', { e: e.message })) }
    },
  })
  return (
    <div className="row-btns alter-up">
      {dim && <Dpi {...dim} />}
      <button className="small" disabled={busy} onClick={() => go(2)} title={tx('Ampliar com Real-ESRGAN, no teu browser (grátis)')}>⤢ ×2</button>
      <button className="small" disabled={busy} onClick={() => go(4)}>⤢ ×4</button>
      {busy && <small className="muted"><span className="spin-dot" /> {job.ep ? tx('A ampliar… {p}% ({m})', { p: Math.round(job.f * 100), m: job.ep === 'webgpu' ? 'GPU' : 'CPU' }) : tx('A carregar o ampliador…')} · {tx('podes fechar: continua em segundo plano')}</small>}
      {job?.err && <small className="bad-t">{job.err}</small>}
    </div>
  )
}


export const PROV = () => ({ chatgpt: tx('ChatGPT (o teu plano, sem API)'), openai: tx('OpenAI (chave da API)'), gemini: tx('Google Gemini (chave da API)'), local: tx('Gerador local (A1111/Forge ou ComfyUI)'), mock: tx('Teste (imagens falsas)') })

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true } catch { /* http na rede de casa: sem clipboard API */ }
  const el = document.createElement('textarea'); el.value = t; document.body.append(el); el.select()
  const ok = document.execCommand('copy'); el.remove()  // ponytail: execCommand está obsoleto mas é o único sem https
  return ok
}
// estes recebem a carta com máscara (a caixa da arte); o ChatGPT e o Gemini recebem a carta inteira
export const masks = prov => ['openai', 'local', 'mock'].includes(prov)
// Uma carta → as imagens finais já compostas ({blob, w, h}), pelo servidor. O mesmo caminho para uma carta e para o lote.
// mode 'frame': a carta (com máscara da caixa da arte para OpenAI/local) vai para editar; refs: srcs ou blobs de estilo.
export async function genCard({ c, pid, box, mode, aspect, orig, prov, localKind, prompt, n, quality, model, refs = [], card, own = null }) {
  const cardSrc = img(c, 'png', false, pid)
  let image = null, mask = null, geo = null
  if (mode === 'edit' && own) image = await refURL(fetchable(own))  // ✏️ a imagem própria, tal como está, para corrigir
  if (mode === 'frame') {
    const cd = await card()
    if (masks(prov)) ({ image, mask, geo } = prepareEdit(cd, box, prov === 'local' ? localKind : 'openai'))
    else { image = await refURL(cardSrc); geo = { W: cd.width, H: cd.height, rect: { x: 0, y: 0, w: cd.width, h: cd.height } } }
  }
  const rs = await Promise.all([...(mode === 'card' || mode === 'fullart' ? [cardSrc] : []), ...(mode === 'art' && orig ? [img(c, 'art_crop', false, pid)] : []), ...refs.map(r => (typeof r === 'string' ? fetchable(r) : r))].map(refURL))
  // em segundo plano: o servidor arranca a geração e responde logo; pergunta-se de 2 em 2 s (a Cloudflare corta aos 100 s)
  const r = await fetch('/api/ia/image', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: prov, prompt, n, quality, model: model?.trim() || undefined, image, mask, refs: rs, size: mode === 'art' && aspect === 'box' ? '1536x1024' : '1024x1536', async: true }) })
  let j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
  for (const t0 = Date.now(); j.job || j.state === 'running';) {
    if (Date.now() - t0 > 15 * 60e3) throw new Error(tx('A geração está a demorar demasiado; tenta outra vez.'))
    await new Promise(ok => setTimeout(ok, 2000))
    const q = await fetch(`/api/ia/image/job?id=${j.job || j.id}`).catch(() => null)
    if (!q) continue  // a rede falhou um instante: volta a perguntar
    const st = await q.json().catch(() => ({}))
    if (!q.ok) throw new Error(st.erro || `HTTP ${q.status}`)
    if (st.state === 'error') throw new Error(st.erro)
    j = st.state === 'done' ? st : { ...st, job: j.job }
  }
  const images = []
  for (const u of j.images) images.push(await finishOut(await bitmap(u), geo, { mode, aspect, box, card }))
  return { images, model: j.model, cost: j.cost || 0 }
}
// resultado (do servidor ou trazido do ChatGPT) → a imagem final, já na moldura; card() = a carta original (bitmap)
export async function finishOut(out, geo, { mode, aspect, box, card }) {
  if (mode === 'edit') { const cv = composite(null, out, { mode: 'art', aspect: 'card' }); return { blob: await toBlob(cv), w: cv.width, h: cv.height } }
  const full = mode === 'card' || mode === 'fullart' || (mode === 'art' && aspect === 'card')  // carta inteira ou ilustração no formato da carta: sem a moldura original por cima
  const cv = composite(full ? null : await card(), out, { mode: full ? 'art' : mode, aspect: full ? 'card' : aspect, box, geo })
  return { blob: await toBlob(cv), w: cv.width, h: cv.height }
}

export default function AlterArt({ c, deck, data, act, onClose, initMode = 'frame' }) {
  useBackClose(true, onClose)
  const pid = deck.prints?.[c.n]?.id || null, own = deck.art?.[c.n] || null, cardSrc = img(c, 'png', false, pid)
  const [pr, setPr] = useState(null), [cfg, setCfg] = useState(null)
  const [base, setBase] = useState(() => basePrompt(c, null)), edited = useRef(false)
  const [custom, setCustom] = useState(''), [mode, setMode] = useState(initMode), [aspect, setAspect] = useState('card'), [orig, setOrig] = useState(false)
  const [frame, setFrame] = useState(''), [font, setFont] = useState('')  // modo «carta inteira»: estilo da moldura e da letra
  const [altName, setAltName] = useState(''), [autoAlt, setAutoAlt] = useState(false)  // nome alternativo (o original fica por baixo)
  const [refs, setRefs] = useState([]), [q, setQ] = useState(''), [n, setN] = useState(2), [quality, setQuality] = useState('medium')
  const [prov, setProv] = useState(() => lsGet('grimorio.alter.prov') || 'chatgpt'), [model, setModel] = useState('')
  const [results, setResults] = useState([]), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [note, setNote] = useState('')
  const [run, enlView, enlBusy] = useEnlarge()
  const cardP = useRef(null), getCard = () => (cardP.current ??= bitmap(cardSrc).catch(e => { cardP.current = null; throw e }))

  useEffect(() => {  // a impressão escolhida: moldura, texto de ambiente e edição (sem rede: só os dados locais)
    fetch(`https://api.scryfall.com/cards/${pid || c.id}`, { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : null))
      .then(j => { if (!j) return; setPr(j); if (!edited.current) setBase(basePrompt(c, j)) }).catch(() => {})
    fetch('/api/ia/image').then(r => r.json()).then(setCfg).catch(() => setCfg({ providers: [], local: {} }))
  }, [c, pid])
  const box = artBox(c, pr)
  useEffect(() => { if ((!box && mode === 'frame') || (mode === 'edit' && !own)) setMode('art') }, [box, mode, own])
  useEffect(() => { setModel(lsGet(`grimorio.alter.model.${prov}`)); lsSet('grimorio.alter.prov', prov) }, [prov])

  const P = cfg?.providers?.find(p => p.id === prov)
  const ready = prov === 'chatgpt' || !!P?.hasKey
  const masked = mode === 'frame' && masks(prov)
  const prompt = finalPrompt({ base, custom, mode, masked, aspect, refs: refs.length, orig: mode === 'art' && orig, frame, font, altName: mode === 'card' ? altName : '', autoAlt: mode === 'card' && autoAlt, name: c.n })
  const per = costOf(P?.cost, quality, 1)
  const mine = useMemo(() => [...new Set([...alterHistory(), ...Object.values(deck.art || {}).filter(u => u.startsWith('arts/'))])].slice(0, 24), [deck.art])
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s.length < 2 || !data ? [] : data.cards.filter(x => x.n.toLowerCase().includes(s)).slice(0, 6)
  }, [q, data])
  // referências de estilo: cartas deste deck (com a arte própria, se tiver), alter arts (este e outros decks) e cartas de outros decks
  const [src, setSrc] = useState('pesquisa'), [others, setOthers] = useState(null), [od, setOd] = useState('')
  useEffect(() => { if ((src === 'outros' || src === 'alters') && !others) fetch('/api/decks').then(r => (r.ok ? r.json() : [])).then(l => setOthers(l.filter(x => x.id !== deck.id))).catch(() => setOthers([])) }, [src, others, deck.id])
  const thumb = (d, n) => { const own = d.art?.[n]; const x = data?.byName.get(n); return own ? own : x ? img(x, 'art_crop') : null }
  const deckCards = useMemo(() => [...(deck.commanders || []), ...Object.keys(deck.main || {})].filter(n => n !== c.n && !/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(n)), [deck, c.n])
  const filt = l => { const s = q.trim().toLowerCase(); return s ? l.filter(n => n.toLowerCase().includes(s)) : l }
  const alterAll = useMemo(() => [...new Set([...mine, ...(others || []).flatMap(d => Object.values(d.art || {}).filter(u => u.startsWith('arts/')))])], [mine, others])
  const odDeck = (others || []).find(x => x.id === od)
  // ao escolher como referência uma alter art feita aqui, oferece colar o estilo com que foi feita
  const [rec, setRec] = useState(null)
  const pasteRec = () => { if (rec.custom != null) setCustom(rec.custom); if (rec.frame != null) setFrame(rec.frame); if (rec.font != null) setFont(rec.font); if (rec.mode) setMode(rec.mode); setRec(null) }
  const addRef = r => { if (refs.length < 3 && !refs.some(x => x.src === r.src)) setRefs([...refs, r]); setQ(''); const rc = recipeOf(r.src, [deck, ...(others || [])]); setRec(rc && Object.keys(rc).length ? rc : null) }

  // resultado (do servidor ou trazido do ChatGPT) → a imagem final, já na moldura
  const withUrl = r => ({ ...r, url: URL.createObjectURL(r.blob), k: Math.random() })
  const finish = async (out, geo) => withUrl(await finishOut(out, geo, { mode, aspect, box, card: getCard }))
  // neutral: depois de uma recusa por segurança, sem nomes de personagens/marcas nem a arte original (neutralPrompt)
  const gen = async (neutral = false) => {
    setErr(''); setNote(''); setBusy(tx('A gerar… pode demorar um minuto.'))
    const words = neutral ? [...VOC.fr.values()].flatMap(f => f.alias) : []
    try {
      const j = await genCard({ c, pid, box, mode, aspect, orig: neutral ? false : orig, prov, localKind: cfg?.local?.kind, own,
        prompt: neutral ? neutralPrompt(prompt, c, words) : prompt, n, quality, model, refs: refs.map(r => r.src), card: getCard })
      setResults(x => [...j.images.map(withUrl), ...x])
      setNote(`${j.model}${j.cost ? ` · ≈ US$ ${num(j.cost, 3)}` : ''}`)
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const bring = async files => {  // ChatGPT (ou outro sítio): a imagem que o utilizador traz de volta
    setErr('')
    for (const f of [...files].filter(f => /^image\//.test(f.type))) {
      try { const r = await finish(await bitmap(f), null); setResults(x => [r, ...x]) } catch (e) { setErr(e.message) }
    }
  }
  useEffect(() => {
    if (prov !== 'chatgpt') return
    const onPaste = e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); bring(fs) } }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })
  const copy = async () => setNote(await copyText(prompt) ? tx('Pedido copiado.') : tx('Não consegui copiar: seleciona o pedido em baixo e copia à mão.'))
  const download = async () => {
    const list = [...(mode === 'edit' && own ? [[fetchable(own), 'imagem-a-corrigir']] : mode === 'frame' || mode === 'card' || mode === 'fullart' ? [[cardSrc, 'carta']] : mode === 'art' && orig ? [[img(c, 'art_crop', false, pid), 'arte-original']] : []), ...refs.map((r, k) => [fetchable(r.src), `estilo-${k + 1}`])]
    for (const [u, name] of list) {
      try {
        const b = await (await fetch(u)).blob(), a = document.createElement('a')
        a.href = URL.createObjectURL(b); a.download = `${c.n.replace(/[^\w-]+/g, '-')}-${name}.${(b.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`; a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      } catch (e) { setErr(e.message) }
    }
  }
  const enlarge = async (k, scale) => {
    setErr('')
    try { const r = await run(results[k].blob, scale); setResults(x => x.map((y, j) => (j === k ? { ...y, ...r, url: URL.createObjectURL(r.blob) } : y))) } catch (e) { setErr(e.message) }
  }
  const use = async r => {
    setBusy(tx('A guardar…'))
    try { const url = await post(r.blob), rec = pickRecipe({ custom, frame, font, mode, altName: mode === 'card' ? altName : '' }); act.setArt(c.n, url, rec); rememberAlter(c.n, url, rec); act.say(tx('Alter art guardada como imagem própria de {c}.', { c: c.n })); onClose() } catch (e) { setErr(e.message); setBusy('') }
  }

  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal alter" onClick={e => e.stopPropagation()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); bring(e.dataTransfer.files) }}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <div className="alter-card">
          <img src={mode === 'edit' && own ? fetchable(own) : cardSrc} alt={c.n} />
          {pr && <small className="muted">{pr.set_name} · {tx('ilustração de {a}', { a: pr.artist || '?' })}</small>}
        </div>
        <div className="alter-form">
          <h3>✨ {tx('Criar alter art de {c}', { c: c.n })}</h3>
          <fieldset className="alter-opts"><legend className="small">{tx('Modo')}</legend>
            <label className="chk"><input type="radio" checked={mode === 'frame'} disabled={!box} onChange={() => setMode('frame')} /> {tx('Nova arte na moldura original')}</label>
            <label className="chk"><input type="radio" checked={mode === 'art'} onChange={() => setMode('art')} /> {tx('Arte completa (só a ilustração)')}</label>
            <label className="chk"><input type="radio" checked={mode === 'card'} onChange={() => setMode('card')} /> {tx('Carta inteira (moldura e letra novas)')}</label>
            {own && <label className="chk" title={tx('Envia a tua imagem própria tal como está e só a correção que escreveres; o resto fica igual')}><input type="radio" checked={mode === 'edit'} onChange={() => setMode('edit')} /> ✏️ {tx('Corrigir a imagem atual')}</label>}
            <label className="chk" title={tx('A carta inteira refeita como full-art: a arte de ponta a ponta e o texto por cima; a carta original só serve de inspiração')}><input type="radio" checked={mode === 'fullart'} onChange={() => setMode('fullart')} /> ⚡ {tx('Full-art (a carta inteira refeita como full-art, a original só inspira)')}</label>
            {mode === 'card' && <div className="alter-card-st">
              <label><span className="small">{tx('Estilo da moldura')}</span><input value={frame} onChange={e => setFrame(e.target.value)} placeholder={tx('ex.: art nouveau dourada, gótica com ossos, minimalista…')} /></label>
              <label><span className="small">{tx('Estilo da letra')}</span><input value={font} onChange={e => setFont(e.target.value)} placeholder={tx('ex.: caligrafia medieval, letras gravadas em pedra…')} /></label>
              <label><span className="small">{tx('Nome alternativo (opcional)')}</span><input value={altName} onChange={e => { setAltName(e.target.value); if (e.target.value) setAutoAlt(false) }} placeholder={tx('ex.: Megatron, Godzilla… o nome original fica por baixo')} /></label>
              {!altName.trim() && <label className="chk small"><input type="checkbox" checked={autoAlt} onChange={e => setAutoAlt(e.target.checked)} /> ✨ {tx('A IA inventa um nome alternativo')}</label>}
              <p className="muted small">{tx('A IA redesenha a carta toda: o texto pode sair com erros, confere antes de usar.')}</p>
            </div>}
            {!box && <small className="muted">{tx('Esta moldura não tem caixa da arte conhecida (sem margem, arte completa, showcase, planeswalker…): fica a arte completa.')}</small>}
            {mode === 'art' && <div className="row-btns">
              <label className="chk"><input type="radio" checked={aspect === 'card'} onChange={() => setAspect('card')} /> {tx('Do tamanho da carta (sem moldura)')}</label>
              {box && <label className="chk"><input type="radio" checked={aspect === 'box'} onChange={() => setAspect('box')} /> {tx('Do tamanho da caixa da arte (entra na moldura original)')}</label>}
              <label className="chk"><input type="checkbox" checked={orig} onChange={e => setOrig(e.target.checked)} /> {tx('Enviar a arte original como referência')}</label>
            </div>}
          </fieldset>
          <label className="small">{tx('Pedido base (o texto da carta; vai em inglês, que os modelos entendem melhor)')}
            <textarea rows={6} value={base} onChange={e => { edited.current = true; setBase(e.target.value) }} /></label>
          <label className="small">{tx('Personalizar (podes escrever na tua língua)')}
            <input value={custom} onChange={e => setCustom(e.target.value)} placeholder={mode === 'edit' ? tx('O que corrigir, ex.: dá-lhe o olho biónico do lado esquerdo') : tx('ex.: ao pôr do sol, aguarela, o elfo é uma criança…')} /></label>
          <div className="alter-refs">
            <span className="small">{tx('Referências de estilo (até 3)')}</span>
            {rec && <div className="alter-rec small"><span>{tx('Esta alter art foi feita com:')} {[rec.custom && `«${rec.custom}»`, rec.frame && `${tx('moldura')}: ${rec.frame}`, rec.font && `${tx('letra')}: ${rec.font}`].filter(Boolean).join(' · ')}</span>
              <span className="row-btns"><button className="primary" onClick={pasteRec}>⧉ {tx('Usar o mesmo estilo')}</button><button className="link small" onClick={() => setRec(null)}>{tx('Não')}</button></span></div>}
            <div className="alter-thumbs">{refs.map(r => <button key={r.src} className="alter-thumb on" onClick={() => setRefs(refs.filter(x => x !== r))} title={tx('Tirar')}><img src={fetchable(r.src)} alt="" /><small>{r.label} ×</small></button>)}</div>
            {refs.length < 3 && <>
              <div className="seg alter-src">{[['pesquisa', tx('Pesquisar')], ['deck', tx('Deste deck')], ['alters', tx('Alter arts')], ['outros', tx('Outros decks')]].map(([k, l]) => <button key={k} className={src === k ? 'on' : ''} onClick={() => setSrc(k)}>{l}</button>)}</div>
              {src !== 'alters' && <input value={q} onChange={e => setQ(e.target.value)} placeholder={src === 'pesquisa' ? tx('Procurar outra carta…') : tx('Filtrar pelo nome…')} />}
              {src === 'deck' && <div className="alter-thumbs alter-scroll">{filt(deckCards).slice(0, 60).map(n => { const u = thumb(deck, n); return u && <button key={n} className="alter-thumb" title={n} onClick={() => addRef({ src: u, label: n })}><img src={fetchable(u)} alt={n} loading="lazy" /></button> })}</div>}
              {src === 'alters' && (!others ? <p className="muted small">{tx('A carregar…')}</p> : alterAll.length ? <div className="alter-thumbs alter-scroll">{alterAll.map(u => <button key={u} className="alter-thumb" onClick={() => addRef({ src: u, label: tx('alter art') })}><img src={u} alt="" loading="lazy" /></button>)}</div> : <p className="muted small">{tx('Ainda não há alter arts.')}</p>)}
              {src === 'outros' && (!others ? <p className="muted small">{tx('A carregar…')}</p> : <>
                <select value={od} onChange={e => setOd(e.target.value)} aria-label={tx('Deck')}><option value="">{tx('Escolhe um deck…')}</option>{others.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                {odDeck && <div className="alter-thumbs alter-scroll">{filt([...(odDeck.commanders || []), ...Object.keys(odDeck.main || {})]).slice(0, 60).map(n => { const u = thumb(odDeck, n); return u && <button key={n} className={`alter-thumb${odDeck.art?.[n] ? ' own' : ''}`} title={n} onClick={() => addRef({ src: u, label: n })}><img src={fetchable(u)} alt={n} loading="lazy" /></button> })}</div>}
              </>)}
              {src === 'pesquisa' && hits.length > 0 && <div className="alter-thumbs">{hits.map(x => <button key={x.n} className="alter-thumb" onClick={() => addRef({ src: img(x, 'art_crop'), label: x.n })}><img src={img(x, 'art_crop')} alt="" loading="lazy" /><small>{x.n}</small></button>)}</div>}
            </>}
          </div>
          <fieldset className="alter-opts"><legend className="small">{tx('Quem gera')}</legend>
            {['chatgpt', ...(cfg?.providers || []).map(p => p.id)].map(id => (
              <label key={id} className="chk"><input type="radio" checked={prov === id} onChange={() => setProv(id)} /> {PROV()[id]}
                {id !== 'chatgpt' && !cfg.providers.find(p => p.id === id).hasKey && <small className="muted"> — {id === 'local' ? tx('falta o endereço em Definições › IA') : tx('falta a chave em Definições › IA')}</small>}</label>))}
          </fieldset>
          {prov !== 'chatgpt' && <div className="row-btns">
            <label className="small">{tx('Variações')} <select value={n} onChange={e => setN(+e.target.value)}>{[1, 2, 3, 4].map(k => <option key={k}>{k}</option>)}</select></label>
            {prov === 'openai' && <label className="small">{tx('Qualidade')} <select value={quality} onChange={e => setQuality(e.target.value)}>
              <option value="low">{tx('rascunho')}</option><option value="medium">{tx('normal')}</option><option value="high">{tx('alta')}</option></select></label>}
            <label className="small">{tx('Modelo')} <input className="alter-model" list="alter-models" value={model} placeholder={P?.model || tx('o primeiro que houver')} onChange={e => { setModel(e.target.value); lsSet(`grimorio.alter.model.${prov}`, e.target.value) }} />{P?.models?.length > 0 && <datalist id="alter-models">{P.models.map(m => <option key={m} value={m} />)}</datalist>}</label>
          </div>}
          <p className="small muted">{prov === 'chatgpt' ? tx('Sem custo extra: usa o teu plano do ChatGPT. O ChatGPT Plus não inclui acesso à API, por isso aqui é copiar e colar.')
            : per ? tx('≈ US$ {u} por imagem · {n} = ≈ US$ {t} (preço indicativo; as imagens enviadas somam um pouco)', { u: num(per, 3), n, t: num(per * n, 3) }) : tx('Grátis.')}</p>
          {prov === 'chatgpt' ? <div className="alter-gpt">
            <ol className="small">
              <li><button onClick={copy}>📋 {tx('Copiar o pedido')}</button> <button onClick={download}>⬇ {tx('Descarregar as imagens de referência')}</button></li>
              <li><a className="btn" href="https://chatgpt.com/" target="_blank" rel="noreferrer">{tx('Abrir o ChatGPT ↗')}</a> {tx('cola o pedido e junta as imagens descarregadas.')}</li>
              <li>{tx('Traz a imagem: arrasta-a para aqui, cola-a (Ctrl+V) ou')} <label className="dbox-up">⬆ {tx('escolhe o ficheiro')}<input type="file" accept="image/*" multiple onChange={e => bring(e.target.files || [])} /></label></li>
            </ol>
          </div> : <button className="primary" disabled={!ready || !!busy || !prompt.trim() || (mode === 'edit' && !custom.trim())} onClick={() => gen()}>✨ {tx('Gerar')}</button>}
          <details><summary className="small">{tx('Ver o pedido final')}</summary><textarea readOnly rows={8} value={prompt} onFocus={e => e.target.select()} /></details>
          {busy && <p className="small"><span className="spin-dot" /> {busy}</p>}
          {note && <p className="small muted">{note}</p>}
          {err && <p className="small bad-t">{err}</p>}
          {err && /seguran|safety/i.test(err) && <div className="alter-safe">
            <p className="small muted">{tx('Os filtros dos geradores costumam barrar personagens e marcas com direitos de autor (nomes, edição, arte oficial como referência).')}</p>
            <button className="small" disabled={!!busy} onClick={() => gen(true)}>↻ {tx('Tentar de forma neutra (sem nomes, sem a arte original)')}</button>
          </div>}
          {results.length > 0 && <div className="alter-res">{results.map((r, k) => (
            <figure key={r.k}>
              <img src={r.url} alt="" />
              <figcaption><Dpi w={r.w} h={r.h} />
                <div className="row-btns">
                  <button className="primary small" disabled={!!busy || enlBusy} onClick={() => use(r)}>{tx('Usar esta')}</button>
                  <button className="small" disabled={enlBusy} onClick={() => enlarge(k, 2)} title={tx('Ampliar com Real-ESRGAN, no teu browser (grátis)')}>⤢ ×2</button>
                  <button className="small" disabled={enlBusy} onClick={() => enlarge(k, 4)}>⤢ ×4</button>
                  <button className="link small" onClick={() => setResults(results.filter(x => x !== r))}>{tx('descartar')}</button>
                </div>
              </figcaption>
            </figure>))}</div>}
          {enlView}
        </div>
      </div>
    </div>, document.body)
}
