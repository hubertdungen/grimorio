// Caneta da mesa livre (como no untap.in): riscos que brilham e se desvanecem em poucos segundos, vistos ao vivo por todos.
// Cada ponto guarda-se na zona da mesa onde caiu — no campo de um jogador (em fração dele, como as cartas) ou na mesa
// toda (em fração do palco) —, por isso um risco por cima de uma carta aparece por cima dessa carta em todos os ecrãs,
// mesmo com o lado dos outros ao contrário. Os pontos vão ao servidor aos bocados (≈ 8 por segundo).
import { useEffect, useRef, useState } from 'react'

export const PEN_COLS = ['#ffd166', '#ff5c8a', '#4cc9f0', '#80ed99', '#ffffff', '#c77dff']  // como freetable.PEN
const HOLD = 1300, FADE = 1100, MAXP = 120  // cada ponto brilha HOLD ms e desvanece em FADE: a cauda vai-se apagando enquanto desenhas; no máximo MAXP pontos por traço

export function usePen({ table, layer, me, flip, send, chunks }) {
  const [on, setOn] = useState(false), [col, setCol] = useState(() => PEN_COLS[me % PEN_COLS.length])
  const strokes = useRef(new Map()), seen = useRef(0), raf = useRef(0), cur = useRef(null)
  // ponto do ecrã -> [zona, x, y] (zona = lugar do campo, −1 = a mesa toda); e ao contrário, para desenhar
  const toTable = (px, py) => {
    const f = document.elementFromPoint(px, py)?.closest('.ml-field'), t = table.current
    if (f && t?.contains(f)) {
      const r = f.getBoundingClientRect(), x = (px - r.left) / r.width, y = (py - r.top) / r.height, m = f.classList.contains('mirror')
      return [+f.dataset.seat, +(m ? 1 - x : x).toFixed(3), +(m ? 1 - y : y).toFixed(3)]
    }
    const r = t.getBoundingClientRect(), x = (px - r.left) / r.width, y = (py - r.top) / r.height
    return [-1, +(flip ? 1 - x : x).toFixed(3), +(flip ? 1 - y : y).toFixed(3)]
  }
  const draw = () => {
    cancelAnimationFrame(raf.current)
    const cv = layer.current, t = table.current
    if (!cv || !t) return
    const dpr = Math.min(2, devicePixelRatio || 1), box = cv.getBoundingClientRect()
    if (cv.width !== Math.round(box.width * dpr) || cv.height !== Math.round(box.height * dpr)) { cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr) }
    const g = cv.getContext('2d'), now = performance.now()
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, box.width, box.height)
    const rects = new Map([[-1, { r: t.getBoundingClientRect(), m: flip }]])
    for (const f of t.querySelectorAll('.ml-field')) rects.set(+f.dataset.seat, { r: f.getBoundingClientRect(), m: f.classList.contains('mirror') })
    const at = ([z, x, y]) => { const q = rects.get(z) || rects.get(-1); return [q.r.left - box.left + (q.m ? 1 - x : x) * q.r.width, q.r.top - box.top + (q.m ? 1 - y : y) * q.r.height] }
    let alive = false
    g.lineCap = g.lineJoin = 'round'
    const alpha = t0 => { const age = now - t0; return age < HOLD ? 1 : Math.max(0, 1 - (age - HOLD) / FADE) }
    for (const [k, s] of strokes.current) {
      s.pts = s.pts.filter(q => alpha(q.t) > 0).slice(-MAXP)  // a cauda apaga-se (pelo tempo e pelo comprimento)
      if (!s.pts.length) { strokes.current.delete(k); continue }
      alive = true
      g.strokeStyle = s.col; g.shadowColor = s.col
      for (let i = 0; i < s.pts.length; i++) {  // segmento a segmento: cada um com a idade do seu ponto
        const a = alpha(s.pts[i].t) * (s.pts.length > 30 ? Math.min(1, (i + 1) / 30) : 1), [x1, y1] = at(s.pts[i].p), [x0, y0] = i ? at(s.pts[i - 1].p) : [x1 - 0.1, y1]
        g.globalAlpha = a; g.shadowBlur = 14; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
        g.shadowBlur = 0; g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.globalAlpha = a * 0.7; g.stroke(); g.strokeStyle = s.col  // o miolo branco: brilho de néon
      }
    }
    if (alive) raf.current = requestAnimationFrame(draw)
  }
  const add = (k, c, pts) => {  // pts que chegam juntos (dos outros, aos bocados) espalham-se no tempo: a cauda fica igual à de quem desenha
    const s = strokes.current.get(k) || { col: c, pts: [] }, now = performance.now()
    pts.forEach((p, i) => s.pts.push({ p, t: now - (pts.length - 1 - i) * 15 })); strokes.current.set(k, s)
    draw()
  }
  useEffect(() => {  // traços dos outros (os meus já estão desenhados)
    for (const ch of chunks || []) {
      if (ch.pn <= seen.current) continue
      seen.current = ch.pn
      if (ch.s !== me) add(`${ch.s}:${ch.sid}`, ch.col, ch.pts)
    }
  }, [chunks]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  // a desenhar: pointerdown na mesa com a caneta ligada; os pontos seguem para o servidor de 120 em 120 ms
  const down = e => {
    if (!on || e.button > 0) return false
    e.preventDefault(); e.stopPropagation()
    const sid = (Math.random() * 2 ** 31) | 0, key = `${me}:${sid}`, buf = []
    let lastP = null
    const push = ev => {
      const p = toTable(ev.clientX, ev.clientY)
      if (lastP && Math.hypot(ev.clientX - lastP[0], ev.clientY - lastP[1]) < 3) return
      lastP = [ev.clientX, ev.clientY]; buf.push(p); add(key, col, [p])
    }
    const flush = () => { if (buf.length) send({ c: 'pen', sid, col, pts: buf.splice(0, 80) }) }
    const timer = setInterval(flush, 120)
    const up = () => { clearInterval(timer); flush(); removeEventListener('pointermove', push); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); cur.current = null }
    push(e); addEventListener('pointermove', push); addEventListener('pointerup', up); addEventListener('pointercancel', up)
    cur.current = key
    return true
  }
  return { on, setOn, col, setCol, down }
}
