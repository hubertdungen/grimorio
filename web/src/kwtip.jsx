// Os símbolos das palavras-chave nas cartas da mesa (♥ vínculo com a vida, ➶ voar…; data-kw no Board.jsx): passar o
// rato ou tocar mostra o que é; clicar abre à direita o resumo das regras oficiais (/api/rules), em qualquer mesa.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx } from './i18n.js'

const DESC = {
  Flying: tx('Só pode ser bloqueada por criaturas com voar ou alcance.'),
  'First strike': tx('Faz o dano de combate antes das criaturas sem iniciativa.'),
  'Double strike': tx('Faz dano de combate duas vezes: com a iniciativa e outra vez no dano normal.'),
  Deathtouch: tx('Qualquer dano que faça a uma criatura chega para a destruir.'),
  Lifelink: tx('O dano que faz dá a mesma quantidade de vida a quem a controla.'),
  Trample: tx('Ao atacar, o dano que sobra depois de matar os bloqueadores passa para o jogador.'),
  Vigilance: tx('Atacar não a vira: continua pronta para bloquear.'),
  Haste: tx('Pode atacar e usar habilidades com ↷ no turno em que entra.'),
  Hexproof: tx('Não pode ser alvo de feitiços nem habilidades dos adversários.'),
  Indestructible: tx('Não é destruída por dano nem por efeitos que «destroem».'),
  Menace: tx('Só pode ser bloqueada por duas ou mais criaturas.'),
  Reach: tx('Pode bloquear criaturas com voar.'),
  Infect: tx('Faz dano a criaturas como marcadores −1/−1 e a jogadores como marcadores de veneno.'),
}
const host = () => document.fullscreenElement || document.webkitFullscreenElement || document.body

export default function KwTip() {
  const [tip, setTip] = useState(null), [rule, setRule] = useState(null)
  useEffect(() => {
    const show = el => { const r = el.getBoundingClientRect(); setTip({ k: el.dataset.kw, label: el.getAttribute('aria-label') || el.dataset.kw, x: r.left + r.width / 2, y: r.top }) }
    const over = e => { const el = e.target.closest?.('[data-kw]'); if (el) show(el); else setTip(t => (t ? null : t)) }
    const down = e => { const el = e.target.closest?.('[data-kw]'); if (el && e.pointerType !== 'mouse') show(el) }  // no telemóvel: tocar = «passar por cima»
    const click = async e => {
      const el = e.target.closest?.('[data-kw]')
      if (!el) return
      e.stopPropagation(); e.preventDefault()  // não é um clique na carta
      const k = el.dataset.kw
      setRule({ k, label: el.getAttribute('aria-label') || k, busy: true })
      try {
        const r = await fetch(`/api/rules?q=${encodeURIComponent(k)}`).then(x => x.json())
        const hit = (r.results || []).find(x => x.kind === 'rule' && x.title?.toLowerCase() === k.toLowerCase()) || (r.results || []).find(x => x.kind === 'gloss') || r.results?.[0]
        setRule({ k, label: el.getAttribute('aria-label') || k, hit })
      } catch { setRule({ k, label: el.getAttribute('aria-label') || k, err: true }) }
    }
    addEventListener('pointerover', over); addEventListener('pointerdown', down, true); addEventListener('click', click, true)
    return () => { removeEventListener('pointerover', over); removeEventListener('pointerdown', down, true); removeEventListener('click', click, true) }
  }, [])
  const lines = rule?.hit?.kind === 'rule' ? rule.hit.rules.slice(1, 4).map(([n, t]) => `${n} ${t}`) : rule?.hit?.text ? [rule.hit.text] : []
  return <>
    {tip && createPortal(<div className="kwtip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.label}</b><span>{DESC[tip.k] || ''}</span><small>{tx('Clica para ver as regras')}</small>
    </div>, host())}
    {rule && createPortal(<aside className="kwrule" role="dialog" aria-label={rule.label}>
      <button type="button" className="kwrule-x" onClick={() => setRule(null)} aria-label={tx('Fechar')}>✕</button>
      <b>📖 {rule.label}</b>
      <p>{DESC[rule.k]}</p>
      {rule.busy ? <small className="muted">{tx('a carregar…')}</small> : rule.err ? <small className="muted">{tx('Não deu para abrir as regras agora.')}</small>
        : lines.length > 0 && <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {rule.hit?.num && <small className="muted">{tx('Regras completas, n.º {n}', { n: rule.hit.num })}</small>}
    </aside>, host())}
  </>
}
