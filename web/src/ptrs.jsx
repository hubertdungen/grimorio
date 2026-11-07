// A «mãozinha» de cada outro jogador (mesa livre e lobby online): onde anda o rato/dedo dele, na cor dele, com o nome
// curto e a zona (nunca a carta). Desliza (transição), fica meio transparente quando parado e some sozinha.
import { useEffect, useState } from 'react'
import { PEN_COLS } from './tablepen.js'
import { tx } from './i18n.js'

export const ptrCol = k => PEN_COLS[(typeof k === 'number' ? k : [...String(k)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) % PEN_COLS.length]
const ZONE = { hand: tx('mão'), field: tx('campo'), graveyard: tx('cemitério'), exile: tx('exílio'), library: tx('biblioteca'), command: tx('comando'), stack: tx('pilha'), life: tx('vida'), table: '' }

// manda o meu cursor no máximo ~8 vezes por segundo e só quando mexe (mais de 3 px)
export function throttlePtr(send, ms = 120) {
  let at = 0, x0 = -99, y0 = -99, last = null, t = 0
  const go = v => { at = Date.now(); last = null; send(v) }
  return (v, cx, cy) => {
    if (v && Math.hypot(cx - x0, cy - y0) < 3) return
    if (v) { x0 = cx; y0 = cy }
    const wait = ms - (Date.now() - at)
    if (wait <= 0) return go(v)
    last = v; clearTimeout(t); t = setTimeout(() => last !== null && go(last), wait)
  }
}

// relógio de 1 s para o esbatimento (os pedidos param quando ninguém mexe)
export function useTick(on) {
  const [, set] = useState(0)
  useEffect(() => { if (!on) return; const t = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(t) }, [on])
}

// p: [{ key, x, y (px no contentor), col, name, zone, age (s desde que mexeu) }]
export function Hands({ list }) {
  return list.map(p => {
    const idle = p.age > 1.5
    if (p.age > 7) return null
    return (
      <div key={p.key} className={`ptr-hand ${idle ? 'idle' : ''}`} style={{ transform: `translate(${p.x}px, ${p.y}px)`, '--c': p.col }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 2.6a1.6 1.6 0 0 1 3.2 0V10l.1-.5a1.5 1.5 0 0 1 3 .3V11a1.5 1.5 0 0 1 3 .2v1a1.5 1.5 0 0 1 3 .3V16c0 3.6-2.7 6-6.2 6H12c-2 0-3.4-.9-4.6-2.5L4 15a1.6 1.6 0 0 1 2.4-2.1L8 14.6V2.6z" /></svg>
        <span>{p.name}{ZONE[p.zone] ? <small> · {ZONE[p.zone]}</small> : null}</span>
      </div>
    )
  })
}
