// Ler uma carta pela câmara (ou por uma foto): OCR no próprio browser (tesseract.js, servido pela app — funciona sem
// internet), depois cardmatch.js encontra a carta pelo nome e, se der, pela edição/número. Fica aberto para ler a seguinte.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buildIndex, matchName, setInfo } from './cardmatch.js'
import { img } from './data.js'
import { tx } from './i18n.js'

let WORKER = null, IDX = null, onProg = null
const worker = () => (WORKER ??= import('tesseract.js').then(({ createWorker }) => {
  const base = new URL('ocr/', document.baseURI).href
  return createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, gzip: false, workerBlobURL: false, logger: m => onProg?.(m) })
}).catch(e => { WORKER = null; throw e }))

const CARD = 63 / 88  // proporção de uma carta
// um pedaço da imagem num canvas, com no máximo `max` px de largura (o OCR não ganha com mais e fica lento)
function cut(src, sx, sy, sw, sh, max = 1400, up = 1) {
  const k = Math.min(up, max / sw), cv = document.createElement('canvas')
  cv.width = Math.round(sw * k); cv.height = Math.round(sh * k)
  cv.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height)
  return cv
}

export default function CardScan({ data, onPick, onClose }) {
  const video = useRef(null), stream = useRef(null), guide = useRef(null), fileIn = useRef(null)
  const camOk = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches  // telemóvel/tablet: câmara em ecrã inteiro
  const [camFail, setCamFail] = useState(false)
  const [live, setLive] = useState(false), [busy, setBusy] = useState(''), [res, setRes] = useState(null), [shot, setShot] = useState(''), [added, setAdded] = useState([]), [err, setErr] = useState('')
  useEffect(() => {
    if (!camOk) return
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(s => { stream.current = s; if (video.current) { video.current.srcObject = s; setLive(true) } })
      .catch(() => { setLive(false); setCamFail(true) })
    return () => stream.current?.getTracks().forEach(t => t.stop())
  }, [camOk])
  // sem câmara ao vivo (http): abre logo a câmara do telemóvel (ainda dentro do toque que abriu o leitor)
  useLayoutEffect(() => { if (!camOk) fileIn.current?.click() }, [camOk])
  useEffect(() => { onProg = m => { if (m.status === 'recognizing text') setBusy(tx('a ler… {p}%', { p: Math.round(m.progress * 100) })); else if (/load|initializ/.test(m.status)) setBusy(tx('a preparar o leitor (só da 1.ª vez)…')) }; return () => { onProg = null } }, [])

  // canvases a ler: a carta inteira e a faixa do nome (ampliada, lê-se melhor)
  const read = async parts => {
    setErr(''); setRes(null); setBusy(tx('a preparar o leitor (só da 1.ª vez)…'))
    try {
      const w = await worker()
      IDX ??= buildIndex(data.cards)
      let text = ''
      for (const cv of parts) text += `${(await w.recognize(cv)).data.text}\n`
      const lines = text.split('\n').map(x => x.trim()).filter(Boolean)
      const out = matchName(IDX, lines, { top: 6 }).filter(x => x.score > 0.55).map(x => ({ c: data.cards[x.i], score: x.score }))
      const si = setInfo(text)
      if (si?.set && si.cn && navigator.onLine) {  // edição + número: a impressão exata (Scryfall), se houver net
        const r = await fetch(`https://api.scryfall.com/cards/${si.set}/${si.cn}`).then(x => (x.ok ? x.json() : null)).catch(() => null)
        const c = r && (data.byName.get(r.name) || data.byLower.get(String(r.name).toLowerCase()))
        if (c) { const k = out.findIndex(x => x.c === c); const e = k >= 0 ? out.splice(k, 1)[0] : { c, score: 1 }; out.unshift({ ...e, print: `${r.set.toUpperCase()} #${r.collector_number}` }) }
      }
      setRes(out)
      if (!out.length) setErr(tx('Não consegui ler o nome. Tenta com mais luz, a carta direita e o nome bem visível.'))
    } catch (e) { setErr(tx('O leitor não arrancou: {e}', { e: e.message })) } finally { setBusy('') }
  }
  const snap = () => {  // da câmara: exatamente o que se vê dentro da moldura (o vídeo está em «cover»: parte fica de fora)
    const v = video.current, W = v.videoWidth, H = v.videoHeight
    const vr = v.getBoundingClientRect(), gr = guide.current.getBoundingClientRect()
    const k = Math.max(vr.width / W, vr.height / H), ox = (vr.width - W * k) / 2, oy = (vr.height - H * k) / 2
    const x = Math.max(0, (gr.left - vr.left - ox) / k), y = Math.max(0, (gr.top - vr.top - oy) / k)
    const w = Math.min(W - x, gr.width / k), h = Math.min(H - y, gr.height / k)
    setShot(cut(v, x, y, w, h, 900).toDataURL('image/jpeg', 0.8))
    read([cut(v, x, y, w, h), cut(v, x, y, w, h * 0.13, 1600, 2.5), cut(v, x, y + h * 0.88, w, h * 0.12, 1600, 2.5)])
  }
  const file = e => {  // foto tirada ou escolhida: a imagem toda e o terço de cima ampliado
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const im = new Image()
    im.onload = () => { setShot(cut(im, 0, 0, im.width, im.height, 900).toDataURL('image/jpeg', 0.8)); read([cut(im, 0, 0, im.width, im.height), cut(im, 0, 0, im.width, im.height * 0.34, 1800, 2)]); URL.revokeObjectURL(im.src) }
    im.src = URL.createObjectURL(f)
  }
  const pick = c => { onPick(c); setAdded(a => [c.n, ...a]); setRes(null); setShot('') }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal scan ${touch && camOk && !camFail ? 'full' : ''}`} onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Ler carta')}>
        <header className="scan-h"><h3>📷 {tx('Ler carta')}</h3><button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button></header>
        {camOk && <div className={`scan-cam ${live ? '' : 'off'}`} onClick={() => live && !busy && snap()} title={tx('Toca para ler')}><video ref={video} autoPlay playsInline muted /><i className="scan-guide" ref={guide} data-l={tx('nome')} /></div>}
        <p className="small muted">{live ? tx('Põe a carta dentro da moldura, com o nome em cima, e toca na imagem ou em «Tirar foto e ler».') : tx('Tira uma foto à carta (de frente, com o nome visível) ou escolhe uma imagem. Para a câmara ao vivo abre a app em https.')}</p>
        <div className="row-btns">
          {live && <button className="primary" onClick={snap} disabled={!!busy}>📸 {tx('Tirar foto e ler')}</button>}
          {camFail && <button className="primary big" onClick={() => fileIn.current?.click()}>📷 {tx('Abrir a câmara')}</button>}
          <label className={`btn ${live ? '' : 'primary'}`}>{live ? '🖼' : '📷'} {live ? tx('Foto ou imagem') : tx('Tirar foto')}<input ref={fileIn} type="file" accept="image/*" capture="environment" onChange={file} hidden /></label>
          {busy && <span className="small muted">{busy}</span>}
        </div>
        {err && <p className="small bad-t">{err}</p>}
        {(shot || res) && <div className="scan-res">
          {shot && <img className="scan-shot" src={shot} alt="" />}
          {res && <ul>{res.map(({ c, score, print }) => (
            <li key={c.n}><img src={img(c, 'art_crop')} alt="" loading="lazy" /><span><b>{c.n}</b><small className="muted">{print || c.t}</small><small className="muted">{tx('certeza {p}%', { p: Math.round(Math.min(1, score) * 100) })}</small></span>
              <button className="primary" onClick={() => pick(c)}>＋ {tx('Juntar')}</button></li>))}</ul>}
        </div>}
        {added.length > 0 && <p className="small">{tx('Juntadas ao deck: {n}', { n: added.length })} <span className="muted">· {added.slice(0, 6).join(' · ')}</span></p>}
      </div>
    </div>
  )
}
