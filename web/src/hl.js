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
let flashT = null, flashing = false
export const hl = cards => { if (!cards && flashing) return; clearTimeout(flashT); flashing = false; paint(cards) }  // sair da linha não apaga um piscar a decorrer
export function pin(cards) {  // clicar: pisca a carta na lista por uns segundos e trá-la à vista (não fica presa)
  clearTimeout(flashT); flashing = true; paint(cards)
  if (cards?.[0]) document.querySelector(`[data-card="${esc(cards[0].n)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  flashT = setTimeout(() => { flashing = false; paint(null) }, 2500)
}
// props para pôr num elemento da sugestão: rato por cima acende, sair apaga
export const hlProps = cards => ({ onPointerEnter: () => hl(cards), onPointerLeave: () => hl(null) })  // só o rato (o foco ficava preso num botão)
