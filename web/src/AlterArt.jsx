// ✨ Criar alter art (🎨 Arte da carta): o texto da carta vira um pedido para um modelo de imagem, com toque pessoal e
// referências de estilo; gera pelo servidor (OpenAI, Gemini, gerador local — as chaves nunca saem do servidor) ou pelo
// ChatGPT do utilizador (copiar o pedido, trazer a imagem de volta). A escolhida fica como imagem própria da carta
// (arts/, como as carregadas): aparece no deck, na mesa e nos proxies. ⤢ Ampliar: Real-ESRGAN no browser (upscale.js).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx, num } from './i18n.js'
import { img } from './data.js'
import { useBackClose } from './backnav.js'
import { artBox, basePrompt, finalPrompt, costOf, dpiOf, prepareEdit, composite, bitmap, refURL, toBlob, alterHistory, rememberAlter } from './alterart.js'
import { upscale } from './upscale.js'

const lsGet = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }
const post = async blob => {
  const r = await fetch('/api/arts', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }), j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
  return j.url
}
const fetchable = u => (u?.startsWith('https:') && !/^https:\/\/(cards|backs)\.scryfall\.io\//.test(u) ? `/api/arts/proxy?url=${encodeURIComponent(u)}` : u)
const Dpi = ({ w, h }) => { const d = dpiOf(w); return <small className={d >= 300 ? 'ok-t' : 'muted'}>{w}×{h} px · ≈ {d} dpi {tx('a 63×88 mm')}{d >= 300 ? ' ✓' : ''}</small> }

// ⤢ ×2 / ×4 de um blob; devolve {blob, w, h}. Mostra o progresso (o motor descarrega-se só da primeira vez).
function useEnlarge() {
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

// Na «Imagem própria» da carta: tamanho, dpi para imprimir e ⤢ ampliar (guarda a ampliada no lugar da atual)
export function UpscaleArt({ src, onSaved }) {
  const [dim, setDim] = useState(null), [err, setErr] = useState('')
  const [run, view, busy] = useEnlarge()
  useEffect(() => { const im = new Image(); im.onload = () => setDim({ w: im.naturalWidth, h: im.naturalHeight }); im.src = fetchable(src) }, [src])
  const go = async k => {
    setErr('')
    try { const r = await run(await (await fetch(fetchable(src))).blob(), k); onSaved(await post(r.blob)) } catch (e) { setErr(e.message) }
  }
  return (
    <div className="row-btns alter-up">
      {dim && <Dpi {...dim} />}
      <button className="small" disabled={busy} onClick={() => go(2)} title={tx('Ampliar com Real-ESRGAN, no teu browser (grátis)')}>⤢ ×2</button>
      <button className="small" disabled={busy} onClick={() => go(4)}>⤢ ×4</button>
      {view}{err && <small className="bad-t">{err}</small>}
    </div>
  )
}

const PROV = () => ({ chatgpt: tx('ChatGPT (o teu plano, sem API)'), openai: tx('OpenAI (chave da API)'), gemini: tx('Google Gemini (chave da API)'), local: tx('Gerador local (A1111/Forge ou ComfyUI)'), mock: tx('Teste (imagens falsas)') })

export default function AlterArt({ c, deck, data, act, onClose }) {
  useBackClose(true, onClose)
  const pid = deck.prints?.[c.n]?.id || null, cardSrc = img(c, 'png', false, pid)
  const [pr, setPr] = useState(null), [cfg, setCfg] = useState(null)
  const [base, setBase] = useState(() => basePrompt(c, null)), edited = useRef(false)
  const [custom, setCustom] = useState(''), [mode, setMode] = useState('frame'), [aspect, setAspect] = useState('card'), [orig, setOrig] = useState(false)
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
  useEffect(() => { if (!box && mode === 'frame') setMode('art') }, [box, mode])
  useEffect(() => { setModel(lsGet(`grimorio.alter.model.${prov}`)); lsSet('grimorio.alter.prov', prov) }, [prov])

  const P = cfg?.providers?.find(p => p.id === prov)
  const ready = prov === 'chatgpt' || !!P?.hasKey
  const masked = mode === 'frame' && ['openai', 'local', 'mock'].includes(prov)
  const prompt = finalPrompt({ base, custom, mode, masked, aspect, refs: refs.length, orig: mode === 'art' && orig })
  const per = costOf(P?.cost, quality, 1)
  const mine = useMemo(() => [...new Set([...alterHistory(), ...Object.values(deck.art || {}).filter(u => u.startsWith('arts/'))])].slice(0, 24), [deck.art])
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s.length < 2 || !data ? [] : data.cards.filter(x => x.n.toLowerCase().includes(s)).slice(0, 6)
  }, [q, data])
  const addRef = r => { if (refs.length < 3 && !refs.some(x => x.src === r.src)) setRefs([...refs, r]); setQ('') }

  // resultado (do servidor ou trazido do ChatGPT) → a imagem final, já na moldura
  const finish = async (out, geo) => {
    const cv = composite(mode === 'art' && aspect === 'card' ? null : await getCard(), out, { mode, aspect, box, geo })
    const blob = await toBlob(cv)
    return { blob, url: URL.createObjectURL(blob), w: cv.width, h: cv.height, k: Math.random() }
  }
  const gen = async () => {
    setErr(''); setNote(''); setBusy(tx('A gerar… pode demorar um minuto.'))
    try {
      let image = null, mask = null, geo = null
      if (mode === 'frame') {
        const card = await getCard()
        if (masked) ({ image, mask, geo } = prepareEdit(card, box, prov === 'local' ? cfg.local.kind : 'openai'))
        else { image = await refURL(cardSrc); geo = { W: card.width, H: card.height, rect: { x: 0, y: 0, w: card.width, h: card.height } } }
      }
      const rs = await Promise.all([...(mode === 'art' && orig ? [img(c, 'art_crop', false, pid)] : []), ...refs.map(r => fetchable(r.src))].map(refURL))
      const r = await fetch('/api/ia/image', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: prov, prompt, n, quality, model: model.trim() || undefined, image, mask, refs: rs, size: mode === 'art' && aspect === 'box' ? '1536x1024' : '1024x1536' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
      const got = []
      for (const u of j.images) got.push(await finish(await bitmap(u), geo))
      setResults(x => [...got, ...x])
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
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setNote(tx('Pedido copiado.')); return } catch { /* http na rede de casa: sem clipboard API */ }
    const t = document.createElement('textarea'); t.value = prompt; document.body.append(t); t.select()
    const ok = document.execCommand('copy'); t.remove()  // ponytail: execCommand está obsoleto mas é o único sem https
    setNote(ok ? tx('Pedido copiado.') : tx('Não consegui copiar: seleciona o pedido em baixo e copia à mão.'))
  }
  const download = async () => {
    const list = [...(mode === 'frame' ? [[cardSrc, 'carta']] : mode === 'art' && orig ? [[img(c, 'art_crop', false, pid), 'arte-original']] : []), ...refs.map((r, k) => [fetchable(r.src), `estilo-${k + 1}`])]
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
    try { const url = await post(r.blob); act.setArt(c.n, url); rememberAlter(c.n, url); act.say(tx('Alter art guardada como imagem própria de {c}.', { c: c.n })); onClose() } catch (e) { setErr(e.message); setBusy('') }
  }

  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal alter" onClick={e => e.stopPropagation()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); bring(e.dataTransfer.files) }}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <div className="alter-card">
          <img src={cardSrc} alt={c.n} />
          {pr && <small className="muted">{pr.set_name} · {tx('ilustração de {a}', { a: pr.artist || '?' })}</small>}
        </div>
        <div className="alter-form">
          <h3>✨ {tx('Criar alter art de {c}', { c: c.n })}</h3>
          <fieldset className="alter-opts"><legend className="small">{tx('Modo')}</legend>
            <label className="chk"><input type="radio" checked={mode === 'frame'} disabled={!box} onChange={() => setMode('frame')} /> {tx('Nova arte na moldura original')}</label>
            <label className="chk"><input type="radio" checked={mode === 'art'} onChange={() => setMode('art')} /> {tx('Arte completa (só a ilustração)')}</label>
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
            <input value={custom} onChange={e => setCustom(e.target.value)} placeholder={tx('ex.: ao pôr do sol, aguarela, o elfo é uma criança…')} /></label>
          <div className="alter-refs">
            <span className="small">{tx('Referências de estilo (até 3)')}</span>
            <div className="alter-thumbs">{refs.map(r => <button key={r.src} className="alter-thumb on" onClick={() => setRefs(refs.filter(x => x !== r))} title={tx('Tirar')}><img src={fetchable(r.src)} alt="" /><small>{r.label} ×</small></button>)}</div>
            {refs.length < 3 && <>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar outra carta…')} />
              {hits.length > 0 && <div className="alter-thumbs">{hits.map(x => <button key={x.n} className="alter-thumb" onClick={() => addRef({ src: img(x, 'art_crop'), label: x.n })}><img src={img(x, 'art_crop')} alt="" loading="lazy" /><small>{x.n}</small></button>)}</div>}
              {mine.length > 0 && <details><summary className="small">{tx('As tuas alter arts')}</summary>
                <div className="alter-thumbs">{mine.map(u => <button key={u} className="alter-thumb" onClick={() => addRef({ src: u, label: tx('alter art') })}><img src={u} alt="" loading="lazy" /></button>)}</div></details>}
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
            <label className="small">{tx('Modelo')} <input className="alter-model" value={model} placeholder={P?.model || tx('o primeiro que houver')} onChange={e => { setModel(e.target.value); lsSet(`grimorio.alter.model.${prov}`, e.target.value) }} /></label>
          </div>}
          <p className="small muted">{prov === 'chatgpt' ? tx('Sem custo extra: usa o teu plano do ChatGPT. O ChatGPT Plus não inclui acesso à API, por isso aqui é copiar e colar.')
            : per ? tx('≈ US$ {u} por imagem · {n} = ≈ US$ {t} (preço indicativo; as imagens enviadas somam um pouco)', { u: num(per, 3), n, t: num(per * n, 3) }) : tx('Grátis.')}</p>
          {prov === 'chatgpt' ? <div className="alter-gpt">
            <ol className="small">
              <li><button onClick={copy}>📋 {tx('Copiar o pedido')}</button> <button onClick={download}>⬇ {tx('Descarregar as imagens de referência')}</button></li>
              <li><a className="btn" href="https://chatgpt.com/" target="_blank" rel="noreferrer">{tx('Abrir o ChatGPT ↗')}</a> {tx('cola o pedido e junta as imagens descarregadas.')}</li>
              <li>{tx('Traz a imagem: arrasta-a para aqui, cola-a (Ctrl+V) ou')} <label className="dbox-up">⬆ {tx('escolhe o ficheiro')}<input type="file" accept="image/*" multiple onChange={e => bring(e.target.files || [])} /></label></li>
            </ol>
          </div> : <button className="primary" disabled={!ready || !!busy || !prompt.trim()} onClick={gen}>✨ {tx('Gerar')}</button>}
          <details><summary className="small">{tx('Ver o pedido final')}</summary><textarea readOnly rows={8} value={prompt} onFocus={e => e.target.select()} /></details>
          {busy && <p className="small"><span className="spin-dot" /> {busy}</p>}
          {note && <p className="small muted">{note}</p>}
          {err && <p className="small bad-t">{err}</p>}
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
