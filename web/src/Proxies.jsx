// Proxies: levar o deck com as artes escolhidas para uma gráfica ou para a impressora.
//  1. lista com as edições («4 Island (FRA) 386», cópias divididas numa linha por arte) — Moxfield, MPCFill, mtgprint…;
//  2. ZIP com as imagens (PNG da Scryfall e as imagens próprias), um ficheiro por grupo ou por cópia;
//  3. folha para imprimir: 63×88 mm, 9 por página A4/Letter, com linhas de corte (imprimir ou guardar em PDF).
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { img } from './data.js'
import { exportList, proxyGroups } from './deck.js'
import { tx } from './i18n.js'

const own = s => s && (s.startsWith('arts/') || s.startsWith('https:'))
const urlOf = (g, size, back = false) => (back ? (g.c.df && !own(g.src) ? img(g.c, size, true, g.src) : null) : img(g.c, size, false, g.src))

function printSheet(groups, paper, name) {
  const cards = groups.flatMap(g => Array.from({ length: g.q }, () => [urlOf(g, 'large'), urlOf(g, 'large', true)]).flat()).filter(Boolean)
  const abs = u => new URL(u, location.href).href
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${name.replace(/[<>&]/g, '')} – proxies</title><style>
    @page { size: ${paper}; margin: 8mm; } * { box-sizing: border-box; } body { margin: 0; background: #fff; }
    .sheet { display: grid; grid-template-columns: repeat(3, 63mm); grid-auto-rows: 88mm; gap: 0; justify-content: center; }
    .sheet img { width: 63mm; height: 88mm; object-fit: cover; display: block; outline: .2mm dashed #999; outline-offset: -.1mm; break-inside: avoid; }
    @media screen { body { background: #555; } .sheet { background: #fff; width: max-content; margin: 10px auto; padding: 8mm; } .tip { font: 14px system-ui; color: #fff; text-align: center; margin: 10px; } }
    @media print { .tip { display: none; } .sheet img:nth-child(9n) { break-after: page; } }
  </style></head><body><p class="tip">${tx('Imprime a 100% (sem «ajustar à página») para as cartas ficarem com 63×88 mm. Também dá para guardar em PDF.')}</p>
  <div class="sheet">${cards.map(u => `<img src="${abs(u)}">`).join('')}</div>
  <script>Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r }))).then(() => setTimeout(() => print(), 300))</${"script"}></body></html>`)
  w.document.close()
  return true
}

export default function ProxyDialog({ data, deck, onClose }) {
  const [side, setSide] = useState(true), [perCopy, setPerCopy] = useState(false), [paper, setPaper] = useState('A4')
  const [busy, setBusy] = useState(''), [err, setErr] = useState(''), [warn, setWarn] = useState(''), [copied, setCopied] = useState(false)
  const groups = useMemo(() => proxyGroups(deck, data, { side }), [deck, data, side])
  const list = useMemo(() => exportList(side ? deck : { ...deck, side: {} }), [deck, side])
  const total = groups.reduce((a, g) => a + g.q, 0), owned = groups.filter(g => own(g.src)).reduce((a, g) => a + g.q, 0)
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
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

        <section className="px-opt">
          <h4>{tx('Folha para imprimir')}</h4>
          <p className="muted small">{tx('Tamanho real (63×88 mm), 9 por página, com linhas de corte. Abre numa janela nova pronta a imprimir ou a guardar em PDF.')}</p>
          <div className="row-btns">
            <select value={paper} onChange={e => setPaper(e.target.value)} aria-label={tx('Papel')}><option value="A4">A4</option><option value="letter">Letter</option></select>
            <button disabled={!groups.length} onClick={() => { if (!printSheet(groups, paper, deck.name)) setErr(tx('O browser bloqueou a janela nova: deixa abrir pop-ups para este site.')) }}>🖨 {tx('Abrir a folha')}</button>
          </div>
        </section>
        {warn && <p className="small warn-t">{warn}</p>}
        {err && <p className="small bad-t">{err}</p>}
      </div>
    </div>, document.body)
}
