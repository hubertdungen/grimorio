// Destaque das cartas na lista do deck (linhas com data-card) a partir das sugestões: passar por cima acende-as
// (verde = entra, vermelho = sai, dourado = esta), clicar fixa o destaque e traz a carta à vista. Uma regra de estilo
// gerada aqui, sem ligar componentes entre si.
let el = null, pinned = null
const TONE = {
  out: 'box-shadow: inset 3px 0 0 #ff6b5b, 0 0 0 1px #ff6b5b88, 0 0 14px #ff6b5b55; background: #ff6b5b1f; font-weight: 700',
  in: 'box-shadow: inset 3px 0 0 #3dcf7a, 0 0 0 1px #3dcf7a88, 0 0 14px #3dcf7a55; background: #3dcf7a1f; font-weight: 700',
  on: 'box-shadow: inset 3px 0 0 #ffd98a, 0 0 0 1px #ffd98a88, 0 0 14px #f2b84b55; background: #f2b84b1f; font-weight: 700',
}
const esc = s => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))
function paint(cards) {
  if (typeof document === 'undefined') return
  if (!el || !el.isConnected) { el = document.createElement('style'); el.id = 'grim-hl'; document.head.appendChild(el) }
  el.textContent = (cards || []).map(({ n, tone = 'on' }) => `[data-card="${esc(n)}"]{${TONE[tone] || TONE.on}}`).join('\n')
}
export const hl = cards => paint(cards || pinned)
export function pin(cards) {  // clicar: fixa (outro clique no mesmo, solta) e mostra a 1.ª na lista
  const same = pinned && cards && pinned.map(x => x.n).join('|') === cards.map(x => x.n).join('|')
  pinned = same ? null : cards; paint(pinned)
  if (pinned?.[0]) document.querySelector(`[data-card="${esc(pinned[0].n)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
// props para pôr num elemento da sugestão: rato por cima / foco acendem, sair apaga (volta ao fixado)
export const hlProps = cards => ({ onPointerEnter: () => hl(cards), onPointerLeave: () => hl(null), onFocus: () => hl(cards), onBlur: () => hl(null) })
