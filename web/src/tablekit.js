// Peças da mesa de tamanho fixo partilhadas pelo Forge Play (ForgePlay.jsx) e pela mesa livre (FreeTable.jsx): mesa
// escalada (useStage), filas que se encostam (useOverlap), voos FLIP, arrastar com física, carta que vem à frente,
// arrumação em grelha e dados 3D na mesa.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fpPrefs } from './fpprefs.js'
import { tx } from './i18n.js'
import { play } from './sfx.js'

// camada por cima de tudo: em ecrã inteiro só o elemento em ecrã inteiro se vê (o que fosse para o body ficava invisível)
export const onTop = () => document.fullscreenElement || document.webkitFullscreenElement || document.body

// arrastar com física: a carta segue o ponteiro com um pouco de atraso, inclina-se com a velocidade e, se não puder
// ficar onde a largaste, volta ao sítio com mola. onDrop({id, from, target}) diz se a jogada foi aceite.
export function useDrag(onDrop, onLong, onMove, sel = '[data-h], .bside.bottom .pc[data-z^="k:"]') {  // sel: o que se pode agarrar (data-from diz de que zona vem)
  const dragged = useRef(false)
  const down = e => {
    if (e.button > 0) return
    const el = e.target.closest(sel)
    if (!el) return
    const id = +(el.dataset.h || el.dataset.z.slice(2)), from = el.dataset.from || (el.dataset.h ? 'hand' : 'field')
    const r = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY
    let gap = null, ghost = null, raf = 0, x = r.left + r.width / 2, y = r.top + r.height / 2, tx0 = x0, ty0 = y0, rot = 0, rx = 0, over = null
    const long = e.pointerType !== 'mouse' && setTimeout(() => onLong?.(id), 450)  // tocar e manter = ver em grande
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const mark = t => { if (over) over.classList.remove('fp-over'); over = t; if (t) t.classList.add('fp-over') }
    const targetAt = (px, py) => document.elementFromPoint(px, py)
    const zoneAt = t => t?.closest('.pc[data-z^="k:"]') || t?.closest('.bside') || t?.closest('.fp-mid')
    const tick = () => {
      if (calm) { x = tx0; y = ty0 } else { x += (tx0 - x) * 0.32; y += (ty0 - y) * 0.32 }  // movimento reduzido: segue o dedo, sem inclinar
      const want = Math.max(-26, Math.min(26, (tx0 - x) * 0.45))
      rot += (want - rot) * 0.22; rx += (Math.max(-22, Math.min(22, (y - ty0) * 0.5)) - rx) * 0.22  // a subir inclina-se para trás, a descer para a frente
      ghost.style.transform = `translate(${x - r.width / 2}px, ${y - r.height / 2}px) perspective(700px) rotateX(${rx.toFixed(2)}deg) rotate(${rot.toFixed(2)}deg) scale(1.12)`
      raf = requestAnimationFrame(tick)
    }
    const move = ev => {
      tx0 = ev.clientX; ty0 = ev.clientY
      if (!ghost) {
        if (Math.hypot(tx0 - x0, ty0 - y0) < 8) return
        clearTimeout(long)
        ghost = el.cloneNode(true)
        ghost.classList.add('fp-ghost')
        Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px` })
        onTop().appendChild(ghost)
        el.style.visibility = 'hidden'
        raf = requestAnimationFrame(tick)
      }
      const t = targetAt(tx0, ty0)
      mark(zoneAt(t)); onMove?.({ id, from, x: tx0, y: ty0, target: t })
      const g = t?.closest('.fp-hand [data-h]')  // por cima da mão: as outras cartas abrem espaço onde ela vai ficar
      if (g !== gap) { gap?.classList.remove('fp-gap'); gap = g && g !== el ? g : null; gap?.classList.add('fp-gap') }
    }
    const up = ev => {
      clearTimeout(long)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      if (!ghost) return
      cancelAnimationFrame(raf); mark(null); gap?.classList.remove('fp-gap'); onMove?.(null)
      dragged.current = true; setTimeout(() => { dragged.current = false }, 0)  // o clique que vem a seguir ao largar não conta
      const res = ev.type === 'pointerup' && onDrop({ id, from, target: targetAt(ev.clientX, ev.clientY), x: ev.clientX, y: ev.clientY }), g = ghost
      if (res === 'local') {  // arrumação: a carta a sério parte de onde a largaste e encaixa com mola no sítio novo (useFlip)
        flipFrom.set(String(id), g.getBoundingClientRect())
        g.remove(); el.style.visibility = ''
        return
      }
      const ok = !!res
      if (ok) flipFrom.set(String(id), g.getBoundingClientRect())
      g.style.transition = ok ? 'transform .25s ease-out, opacity .25s ease-out' : 'transform .55s cubic-bezier(.2, 1.6, .4, 1)'
      requestAnimationFrame(() => {
        g.style.transform = ok ? `translate(${ev.clientX - r.width / 2}px, ${ev.clientY - r.height / 2}px) perspective(700px) rotateX(0deg) rotate(0deg) scale(.9)` : `translate(${r.left}px, ${r.top}px) perspective(700px) rotateX(0deg) rotate(0deg) scale(1)`
        if (ok) g.style.opacity = '0'
      })
      setTimeout(() => { g.remove(); el.style.visibility = '' }, ok ? 700 : 560)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  return { down, dragged }
}

// Mesa de tamanho fixo (como o Balatro ou o Tabletop Simulator): a mesa tem sempre o mesmo tamanho «lógico» — deitada
// 1280×820, ao alto 760×1180 — e escala-se inteira para caber no ecrã. As cartas têm tamanho fixo lá dentro, por isso uma
// carta nova nunca empurra as zonas; num monte cheio as cartas encolhem dentro da fila. Só se volta a medir com mudanças a
// sério (rodar, redimensionar, ecrã inteiro): a barra do browser a aparecer/desaparecer (≈ 60–100 px) não conta.
export const STAGE = { wide: [1280, 820], tall: [760, 1180] }
// filas cheias (muitas criaturas, terrenos, a mão): as cartas encostam-se umas às outras (--ov negativo) em vez de
// saírem da mesa; mede-se depois de cada mudança, só dentro da mesa de tamanho fixo
export function useOverlap(tableRef) {
  useLayoutEffect(() => {
    for (const row of tableRef.current?.querySelectorAll('.brow.front, .brow.lands, .brow.others, .fp-hand') || []) {
      const kids = [...row.children].filter(k => k.offsetWidth), n = kids.length
      const cur = parseFloat(row.style.getPropertyValue('--ov')) || 0
      if (n < 2) { row.style.removeProperty('--ov'); continue }
      const span = kids[n - 1].offsetLeft + kids[n - 1].offsetWidth - kids[0].offsetLeft, natural = span - (n - 1) * cur
      const room = row.clientWidth - 4
      const ov = natural > room ? Math.max(-kids[0].offsetWidth * 0.82, (room - natural) / (n - 1)) : 0
      if (Math.abs(ov - cur) > 0.5) row.style.setProperty('--ov', `${ov}px`)
    }
  })
}

export function useStage(boxRef, wrapRef, ready, own = false) {  // own: com o painel por baixo, a mesa fica com o ecrã todo (o painel vem a seguir, a rolar)
  const [st, setSt] = useState({ shape: 'wide', sc: 1, left: 0 })
  useLayoutEffect(() => {
    const box = boxRef.current, wrap = wrapRef.current
    if (!box || !wrap) return
    let last = null
    const fit = force => {
      const vh = window.visualViewport?.height || innerHeight, fe = !!(document.fullscreenElement || document.webkitFullscreenElement)
      const top = Math.max(0, box.getBoundingClientRect().top), w = wrap.clientWidth
      if (!force && last && Math.abs(w - last.w) < 2 && Math.abs(vh - last.vh) < 110 && fe === last.fe) return  // barra do browser: ignora
      last = { w, vh, fe }
      // forma pela orientação do aparelho: ao alto (telemóvel, tablet ao alto) a mesa é alta e usa a altura do ecrã toda
      // (fora do ecrã inteiro a página desce até ela); deitado cabe no espaço que sobra por baixo do cabeçalho
      const tall = innerWidth < innerHeight, side = box.querySelector('.fp-side'), below = getComputedStyle(box).gridTemplateRows.split(' ').length > 1
      const total = Math.max(380, Math.floor(vh - (tall && !fe ? 0 : top) - (fe ? 4 : 10)))
      box.style.height = tall && !fe ? '' : `${total}px`
      const h = below && !own ? total - (side?.offsetHeight || 0) - 8 : total
      const shape = tall ? 'tall' : 'wide', [W, H] = STAGE[shape]
      const sc = Math.min(w / W, h / H)
      setSt({ shape, sc, left: Math.max(0, (w - W * sc) / 2), h: H * sc })
    }
    fit(true)
    const again = () => fit(false), hard = () => fit(true)
    const tm = [150, 500].map(x => setTimeout(hard, x))
    addEventListener('resize', again); window.visualViewport?.addEventListener('resize', again)
    const evs = ['fullscreenchange', 'webkitfullscreenchange', 'orientationchange']
    evs.forEach(e => (e === 'orientationchange' ? window : document).addEventListener(e, hard))
    return () => {
      tm.forEach(clearTimeout); removeEventListener('resize', again); window.visualViewport?.removeEventListener('resize', again)
      evs.forEach(e => (e === 'orientationchange' ? window : document).removeEventListener(e, hard))
    }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  return st
}

// cartas que mudam de sítio entre um estado do Forge e o seguinte (da mão para a mesa, presas a uma criatura, outra fila)
// deslizam com mola do sítio antigo para o novo (FLIP: mede antes e depois e anima a diferença). A mesma carta tem o
// mesmo id na mão e na mesa, por isso uma carta jogada voa da mão para o lugar dela.
export const flipFrom = new Map()  // carta largada na mesa: o voo parte de onde a largaste (não da mão)
export function useFlip(box, seq, lay) {
  const last = useRef(new Map())
  useLayoutEffect(() => {
    const t = box.current
    if (!t) return
    const now = new Map(), reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    for (const el of t.querySelectorAll('.pc[data-z^="k:"], .fp-hand [data-h]')) {
      const id = el.dataset.h || el.dataset.z.slice(2), r = el.getBoundingClientRect()
      if (!r.width) continue
      now.set(id, r)
      const o = flipFrom.get(id) || last.current.get(id)
      flipFrom.delete(id)
      if (!o || reduce) continue
      const sc = +t.closest('.fp-stage')?.dataset.sc || 1  // dentro da mesa escalada, o translate conta em px «lógicos»
      const dx = (o.left - r.left) / sc, dy = (o.top - r.top) / sc, k = o.width / r.width
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`
      el.style.zIndex = '6'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = 'transform .5s cubic-bezier(.2, 1.25, .35, 1)'
        el.style.transform = ''
        setTimeout(() => { el.style.transition = ''; el.style.zIndex = '' }, 520)
      }))
    }
    last.current = now
  }, [seq, lay])  // eslint-disable-line react-hooks/exhaustive-deps
}

// arrumação livre do teu lado: o centro da carta largada em (px, py) do ecrã, em px «lógicos» do teu lado e em fração
// dele. Com grelha encaixa na casa livre mais perto (casas do tamanho da carta; as ocupadas por outras cartas saltam-se);
// livre fica onde a largaste. Nunca por cima da tua barra (vida, mão, montes).
export function spotOn(side, px, py, kind, grid, skip) {
  const sc = +side.closest('.fp-stage')?.dataset.sc || 1, r = side.getBoundingClientRect(), W = side.clientWidth, H0 = side.clientHeight
  const H = side.querySelector('.bhud')?.offsetTop || H0
  const w = parseFloat(getComputedStyle(side).getPropertyValue(kind === 'front' ? '--cw' : kind === 'lands' ? '--lw' : '--ow')) || 80, h = w * 680 / 488
  let x = (px - r.left) / sc, y = (py - r.top) / sc
  const sx = w + 10, sy = h + 10, ox = 8, oy = 6
  if (grid) {
    const taken = [...side.querySelectorAll('.pc[data-z^="k:"]')].filter(e => e.dataset.z !== `k:${skip}` && !e.closest('.pc-att')).map(e => {
      const q = e.getBoundingClientRect(); return [(q.left + q.width / 2 - r.left) / sc, (q.top + q.height / 2 - r.top) / sc, q.width / sc / 2, q.height / sc / 2]
    })
    let best = null
    for (let i = 0; ox + (i + 1) * sx <= W; i++) for (let j = 0; oy + (j + 1) * sy <= H || j === 0; j++) {
      const cx = ox + sx / 2 + i * sx, cy = oy + sy / 2 + j * sy, d = Math.hypot(cx - x, cy - y)
      if ((!best || d < best.d) && !taken.some(t => Math.abs(t[0] - cx) < (w / 2 + t[2]) * 0.85 && Math.abs(t[1] - cy) < (h / 2 + t[3]) * 0.85)) best = { d, cx, cy }
    }
    if (best) { x = best.cx; y = best.cy }
  }
  x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x)); y = Math.max(h / 2 + 4, Math.min(H - h / 2 - 2, y))
  return { x: x / W, y: y / H0, px: x, py: y, w, h, sx, sy }
}

// carta que vem à frente: com o rato por cima de uma carta da mesa (tua ou do adversário, mesmo inclinada pela
// perspetiva), uma cópia do que se vê dela sobe, endireita-se e cresce virada para o ecrã; ao sair volta ao lugar.
// É uma cópia da face à vista: uma carta virada para baixo continua de costas (nada escondido se revela).
export function usePeek() {
  const cur = useRef(null)
  const hide = () => {
    const c = cur.current
    cur.current = null
    if (!c) return
    clearTimeout(c.t)
    if (!c.node) return
    c.node.style.transform = c.from; c.node.style.opacity = '0'
    setTimeout(() => c.node.remove(), 260)
  }
  const over = pc => {
    if (cur.current?.pc === pc) return
    hide()
    if (!pc || pc.classList.contains('dying') || document.querySelector('.fp-ghost') || !window.matchMedia?.('(hover: hover)').matches) return
    const c = { pc }
    cur.current = c
    c.t = setTimeout(() => {
      const att = pc.classList.contains('pc-attc')  // aura/equipamento preso: a própria carta pequena
      const face = att ? pc : pc.querySelector(pc.querySelector('.pc-flip.on .pc-b') ? '.pc-b' : '.pc-f'), rot = att ? pc : pc.querySelector('.pc-rot')
      if (!face || !rot || cur.current !== c) return
      const sc = +pc.closest('.fp-stage')?.dataset.sc || 1, q = rot.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2
      const w0 = rot.offsetWidth * sc, w = Math.max(190, Math.min(250, w0 * 2.2)), h = w * 680 / 488
      const x = Math.max(8, Math.min(innerWidth - w - 8, cx - w / 2)), y = Math.max(8, Math.min(innerHeight - h - 8, cy - h / 2))
      const tilt = pc.closest('.bside.top') && pc.closest('.fp-stage.persp') ? fpPrefs().tilt : 0
      c.from = `translate(${cx - x - w / 2}px, ${cy - y - h / 2}px) perspective(800px) rotateX(${tilt}deg) rotate(${pc.classList.contains('tapped') ? 90 : 0}deg) scale(${(w0 / w).toFixed(3)})`
      const n = document.createElement('div')
      n.className = 'fp-peek'
      n.appendChild(face.cloneNode(true))
      Object.assign(n.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, transform: c.from })
      onTop().appendChild(n)
      c.node = n
      requestAnimationFrame(() => requestAnimationFrame(() => { if (cur.current === c) { n.style.transform = 'none'; n.style.opacity = '1' } }))
    }, 90)
  }
  useEffect(() => hide, [])
  return { over, hide }
}

// dados na mesa: os mesmos dados 3D da Mesa (Dice3D.js, three.js + dicephys.js, só carregados ao primeiro lançamento)
// rolam por cima da mesa e assentam lá; a camada não apanha o rato (as cartas continuam a responder por baixo)
const DICE_COL = { d6: ['#fff6e6', '#cdb894', '#3a2a10'], d20: ['#8cc8ff', '#1f4fb8', '#ffffff'], moeda: ['#ffe9a3', '#b8860b', '#ffffff'] }
export function useTableDice(box) {
  const tray = useRef(null), clear = useRef(0), [res, setRes] = useState(null)
  useEffect(() => () => { clearTimeout(clear.current); tray.current?.dispose?.() }, [])
  const roll = async (types, want) => {  // want: os valores já sorteados (mesa livre: o servidor tira-os e todos veem o mesmo)
    clearTimeout(clear.current); setRes({ rolling: true, types })
    if (!tray.current) {
      const D = await import('./Dice3D.js')
      if (!box.current) return
      tray.current = D.webglOk() ? D.createTray(box.current, { view: 13, colors: DICE_COL, words: [tx('Cara'), tx('Coroa')], onHit: a => play('diceHit', { amount: a }),
        onSettle: items => { setRes({ items }); play('tick', { amount: 1 }); if (items.some(x => x.type === 'moeda')) play('coin'); clearTimeout(clear.current); clear.current = setTimeout(() => { tray.current?.clear(); setRes(null) }, 20000) } }) : 'flat'
    }
    play('dice', { amount: types.length })
    if (tray.current === 'flat') return setRes({ items: types.map((type, i) => ({ type, v: want?.[i] ?? 1 + Math.floor(Math.random() * (type === 'moeda' ? 2 : +type.slice(1))) })) })  // sem WebGL: só o número
    tray.current.roll(types, want)
  }
  const off = () => { clearTimeout(clear.current); if (tray.current !== 'flat') tray.current?.clear(); setRes(null) }
  return { roll, res, off }
}
