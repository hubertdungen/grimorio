// Destaque das cartas na lista do deck (linhas com data-card) a partir das sugestões: passar por cima acende-as
// (verde = entra, vermelho = sai, dourado = esta); abrir a carta pisca-a na lista e trá-la à vista. Uma regra de estilo
// gerada aqui, sem ligar componentes entre si.
let el = null
const TONE = {
  out: 'box-shadow: inset 3px 0 0 #ff6b5b, 0 0 0 1px #ff6b5b66, 0 0 18px -2px #ff6b5b66; background-color: #ff6b5b1a',
  in: 'box-shadow: inset 3px 0 0 #3dcf7a, 0 0 0 1px #3dcf7a66, 0 0 18px -2px #3dcf7a66; background-color: #3dcf7a1a',
  on: 'box-shadow: inset 3px 0 0 #ffd98a, 0 0 0 1px #ffd98a66, 0 0 18px -2px #f2b84b66; background-color: #f2b84b1a',
}
const esc = s => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))
function paint(cards) {
  if (typeof document === 'undefined') return
  if (!el || !el.isConnected) { el = document.createElement('style'); el.id = 'grim-hl'; document.head.appendChild(el) }
  el.textContent = (cards || []).map(({ n, tone = 'on' }) => `[data-card="${esc(n)}"]{${TONE[tone] || TONE.on}}`).join('\n')
}
let flashT = null, flashing = false, revealT = null, tips = null
// a lista do deck (com scroll próprio) desce/sobe até à 1.ª carta; as outras que fiquem fora de vista ganham uma
// etiqueta «↑ nome» / «↓ nome» na borda da lista. Só mexe na lista, nunca na página.
const scroller = node => { for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p } return null }
function clearTips() { if (tips) tips.textContent = '' }
function reveal(cards) {
  const els = cards.map(c => [c, document.querySelector(`.deck-panel [data-card="${esc(c.n)}"]`)]).filter(x => x[1])
  if (!els.length) return
  const box = scroller(els[0][1])
  if (!box) return
  const v = box.getBoundingClientRect(), r0 = els[0][1].getBoundingClientRect()
  if (r0.top < v.top + 8 || r0.bottom > v.bottom - 8) box.scrollTo({ top: box.scrollTop + r0.top - v.top - v.height / 3, behavior: 'smooth' })
  setTimeout(() => {  // depois do scroll: etiquetas para as que ficaram fora
    if (!tips || !tips.isConnected) { tips = document.createElement('div'); tips.id = 'grim-hl-tips'; document.body.appendChild(tips) }
    tips.textContent = ''
    const vv = box.getBoundingClientRect()
    for (const [c, e] of els.slice(1)) {
      const r = e.getBoundingClientRect(), up = r.bottom < vv.top + 4, down = r.top > vv.bottom - 4
      if (!up && !down) continue
      const t = document.createElement('div')
      t.className = `hl-tip ${c.tone || 'on'}`; t.textContent = `${up ? '↑' : '↓'} ${c.n}`
      Object.assign(t.style, { left: `${vv.left + 8}px`, width: `${vv.width - 16}px`, top: up ? `${vv.top + 6}px` : `${vv.bottom - 34}px` })
      tips.appendChild(t)
    }
  }, 380)
}
export const hl = cards => {  // sair da linha não apaga um piscar a decorrer
  if (!cards && flashing) return
  clearTimeout(flashT); flashing = false; paint(cards)
  clearTimeout(revealT); clearTips()
  if (cards?.length) revealT = setTimeout(() => reveal(cards), 160)  // um instante: percorrer as sugestões não faz a lista saltar
}
export function pin(cards) {  // clicar: pisca a carta na lista por uns segundos e trá-la à vista (não fica presa)
  clearTimeout(flashT); flashing = true; paint(cards); reveal(cards)
  flashT = setTimeout(() => { flashing = false; paint(null); clearTips() }, 2500)
}
// props para pôr num elemento da sugestão: rato por cima acende, sair apaga
export const hlProps = cards => ({ onPointerEnter: () => hl(cards), onPointerLeave: () => hl(null) })  // só o rato (o foco ficava preso num botão)
