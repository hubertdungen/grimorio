// Peças da mesa de tamanho fixo partilhadas pelo Forge Play (ForgePlay.jsx) e pela mesa livre (FreeTable.jsx): mesa
// escalada (useStage), filas que se encostam (useOverlap), voos FLIP, arrastar com física, carta que vem à frente,
// arrumação em grelha e dados 3D na mesa.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fpPrefs } from './fpprefs.js'
import { tx } from './i18n.js'
import { play } from './sfx.js'
import { held as buzz } from './touch.js'  // tocar e manter: um toque no telemóvel (e o tocar e manter geral fica de fora)

// camada por cima de tudo: em ecrã inteiro só o elemento em ecrã inteiro se vê (o que fosse para o body ficava invisível)
export const onTop = () => document.fullscreenElement || document.webkitFullscreenElement || document.body
let dragEnd = 0  // quando acabou o último arrastar (a carta que vem à frente espera um pouco depois de arrumares)

// arrastar com física: a carta segue o ponteiro com um pouco de atraso, inclina-se com a velocidade e, se não puder
// ficar onde a largaste, volta ao sítio com mola. onDrop({id, from, target}) diz se a jogada foi aceite.
// onPeek(el): no toque, tocar e manter numa carta que não se arrasta (do adversário, empilhada na mão dele…) = vê-la em grande
export function useDrag(onDrop, onLong, onMove, sel = '[data-h], .bside.bottom .pc[data-z^="k:"]', onPeek) {  // sel: o que se pode agarrar (data-from diz de que zona vem)
  const dragged = useRef(false)
  const down = e => {
    if (e.button > 0) return
    const el = e.target.closest(sel)
    if (!el) {
      const card = e.pointerType !== 'mouse' && onPeek && e.target.closest('[data-z^="k:"], [data-zid], .hc[data-z], .stk[data-z]')
      if (!card) return
      let peeked = false
      const x0 = e.clientX, y0 = e.clientY, t = setTimeout(() => { peeked = true; buzz(); onPeek(card) }, 450)
      const off = () => { clearTimeout(t); removeEventListener('pointermove', mv); removeEventListener('pointerup', off); removeEventListener('pointercancel', off)
        if (peeked) { dragged.current = true; setTimeout(() => { dragged.current = false }, 0) } }
      const mv = ev => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) off() }
      addEventListener('pointermove', mv); addEventListener('pointerup', off); addEventListener('pointercancel', off)
      return
    }
    const id = +(el.dataset.h || el.dataset.z.slice(2)), from = el.dataset.from || (el.dataset.h ? 'hand' : 'field')
    const r = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY
    let gap = null, ghost = null, raf = 0, x = r.left + r.width / 2, y = r.top + r.height / 2, tx0 = x0, ty0 = y0, rot = 0, rx = 0, over = null, k = 1
    let longed = false
    const long = e.pointerType !== 'mouse' && setTimeout(() => { longed = true; buzz(); onLong?.(id) }, 450)  // tocar e manter = ver em grande (com um toque de vibração)
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const mark = t => { if (over) over.classList.remove('fp-over'); over = t; if (t) t.classList.add('fp-over') }
    const targetAt = (px, py) => document.elementFromPoint(px, py)
    const zoneAt = t => t?.closest('.pc[data-z^="k:"]') || t?.closest('.bside') || t?.closest('.fp-mid')
    const inGap = t => !!gap && !t?.closest('.fp-hand [data-h]') && t?.closest('.fp-hand') === gap.closest('.fp-hand')  // no espaço aberto da mão
    const tick = () => {
      if (calm) { x = tx0; y = ty0 } else { x += (tx0 - x) * 0.32; y += (ty0 - y) * 0.32 }  // movimento reduzido: segue o dedo, sem inclinar
      const want = Math.max(-26, Math.min(26, (tx0 - x) * 0.45))
      rot += (want - rot) * 0.22; rx += (Math.max(-22, Math.min(22, (y - ty0) * 0.5)) - rx) * 0.22  // a subir inclina-se para trás, a descer para a frente
      k += (1.12 - k) * 0.3  // levanta-se aos poucos: a 1.12 logo no 1.º frame a carta dava um salto ao agarrar
      ghost.style.transform = `translate(${x - r.width / 2}px, ${y - r.height / 2}px) perspective(700px) rotateX(${rx.toFixed(2)}deg) rotate(${rot.toFixed(2)}deg) scale(${k.toFixed(3)})`
      raf = requestAnimationFrame(tick)
    }
    const move = ev => {
      tx0 = ev.clientX; ty0 = ev.clientY
      if (!ghost) {
        if (Math.hypot(tx0 - x0, ty0 - y0) < 8) return
        clearTimeout(long)
        ghost = el.cloneNode(true)
        ghost.classList.add('fp-ghost')
        Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, transform: `translate(${r.left}px, ${r.top}px)` })  // já no sítio da carta antes do 1.º tick
        onTop().appendChild(ghost)
        el.style.visibility = 'hidden'
        raf = requestAnimationFrame(tick)
      }
      const t = targetAt(tx0, ty0)
      mark(zoneAt(t)); onMove?.({ id, from, x: tx0, y: ty0, target: t })
      // por cima da mão: as outras cartas abrem espaço onde ela vai ficar. No espaço aberto (já sem carta por baixo) fica
      // aberto — antes fechava, a carta voltava para baixo do ponteiro e abria outra vez (a piscar a cada movimento)
      const g = t?.closest('.fp-hand [data-h]') || (inGap(t) ? gap : null)
      if (g !== gap) { gap?.classList.remove('fp-gap'); gap = g && g !== el ? g : null; gap?.classList.add('fp-gap') }
    }
    const up = ev => {
      clearTimeout(long)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      // depois de manter premido (carta em grande), o toque que se segue não é um clique: abria o menu do planeswalker por
      // cima da carta em grande, ou ativava/virava a carta
      if (longed && !ghost) { dragged.current = true; setTimeout(() => { dragged.current = false }, 0); return }
      if (!ghost) return
      // largada no espaço aberto da mão: conta como em cima da carta que o abriu (vai para antes dela); por baixo do ponteiro
      // só havia a mão e a carta ia parar ao fim
      const t = targetAt(ev.clientX, ev.clientY), drop = inGap(t) ? gap : t
      cancelAnimationFrame(raf); mark(null); gap?.classList.remove('fp-gap'); onMove?.(null)
      dragged.current = true; dragEnd = Date.now(); setTimeout(() => { dragged.current = false }, 0)  // o clique que vem a seguir ao largar não conta
      const res = ev.type === 'pointerup' && onDrop({ id, from, target: drop, x: ev.clientX, y: ev.clientY }), g = ghost
      const flat = s => `translate(${ev.clientX - r.width / 2}px, ${ev.clientY - r.height / 2}px) perspective(700px) rotateX(0deg) rotate(0deg) scale(${s})`
      const home = q => { g.style.transition = 'transform .55s cubic-bezier(.2, 1.6, .4, 1)'; requestAnimationFrame(() => { g.style.transform = `translate(${q.left}px, ${q.top}px) perspective(700px) rotateX(0deg) rotate(0deg) scale(1)` }); setTimeout(() => { g.remove(); el.style.visibility = '' }, 560) }
      if (!res) return home(r)
      // a carta a sério parte do fantasma (useFlip: flipFrom = o fantasma, que ele tira no mesmo frame em que a carta
      // aparece). Antes o fantasma desvanecia logo e a carta só aparecia quando o Forge respondia — a partir da mão: um
      // vazio, a carta de volta à mão e depois o voo da mão para a mesa
      g._src = el; g._any = res === 'local'  // arrumação: é a própria carta que lhe pega; jogada: só a carta nova do campo
      flipFrom.set(String(id), g)
      if (res === 'local') {
        // arrumar a mão: as vizinhas partem de onde estão agora (com o espaço aberto) — o useFlip anima-as dali e não da
        // arrumação antes de agarrares (saltavam para trás) nem a meio da transição da margem (a carta assentava ~24 px ao lado)
        if (from === 'hand') for (const k of el.closest('.fp-hand')?.querySelectorAll('[data-h]') || []) if (k !== el) flipFrom.set(k.dataset.h, k.getBoundingClientRect())
        setTimeout(() => { if (g.isConnected) { g.remove(); el.style.visibility = ''; flipFrom.delete(String(id)) } }, 800); return
      }
      g.classList.add('fp-wait')
      g.style.transition = 'transform .2s ease-out'
      requestAnimationFrame(() => { g.style.transform = flat(1) })  // assenta onde a largaste e espera pelo Forge
      // res 'leave': a carta do campo vai sair (mesa livre: para um monte ou a mão) — espera pela resposta como uma da mão;
      // com os 250 ms das que ficam (atacar, equipar) voltava ao sítio antes de o servidor responder e só depois sumia
      const t0 = Date.now(), field = el.matches('.pc') && res !== 'leave'
      // a carta saiu de onde estava: o elemento foi-se (mão) ou passou a mostrar outra carta — o monte da biblioteca
      // (Courser of Kruphix, Future Sight) fica no DOM com o topo novo, e o React reaproveita o mesmo elemento
      const left = () => !el.isConnected || (el.dataset.h != null && el.dataset.h !== String(id)) || (el.dataset.h == null && el.dataset.z !== `k:${id}`)
      const wait = () => {
        if (!g.isConnected) return  // o useFlip já lhe pegou
        if (left()) {  // foi para outra zona: se aparece na pilha (Forge Play) voa até lá; senão desvanece onde está
          el.style.visibility = ''  // o monte (se ainda cá está) volta a ver-se, já com a carta de baixo
          const sk = stkOf(g)
          if (sk) { flipFrom.delete(String(id)); return toStack(g, sk, r) }
          if (!g._gone) { g._gone = Date.now(); g.style.transition = 'transform .25s ease-out, opacity .25s ease-out'; g.style.transform = flat(0.9); g.style.opacity = '0' }
          // ainda não está na pilha (o alvo a escolher, a mana a pagar): espera por ela até 3 s, invisível (não tapa o alvo)
          if (Date.now() - g._gone < 3000) return setTimeout(wait, 80)
          flipFrom.delete(String(id)); return g.remove()
        }
        // ainda no sítio de onde saiu: uma carta do campo (atacar, equipar, bloquear) fica lá — volta já; da mão o Forge
        // não a jogou (recusou, ou espera por uma escolha — o fantasma não pode tapar o alvo): ao fim de 1,5 s volta à mão
        if (Date.now() - t0 > (field ? 250 : 1500)) { flipFrom.delete(String(id)); return home(el.getBoundingClientRect()) }
        setTimeout(wait, 60)
      }
      setTimeout(wait, 60)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  return { down, dragged }
}
// carta da mão largada que vai para a pilha (feitiço lançado): o fantasma voa até à carta dela na pilha (.stackfx, pelo
// nome: a do topo) e entrega-lhe o lugar — a da pilha só aparece quando ele lá chega, sem a animação de entrada
const stkOf = g => (g.title ? [...document.querySelectorAll(`.stackfx .stk[data-z="n:${CSS.escape(g.title)}"]`)].filter(e => e.offsetWidth).pop() : null)
function toStack(g, sk, r) {
  sk.style.animation = 'none'; sk.style.visibility = 'hidden'
  const q = sk.getBoundingClientRect(), m = new DOMMatrixReadOnly(getComputedStyle(g).transform)
  // de onde o fantasma está até à carta da pilha, numa curva (antes em linha reta por transição)
  const x0 = m.m41, y0 = m.m42, x1 = q.left + q.width / 2 - r.width / 2, y1 = q.top + q.height / 2 - r.height / 2, k0 = Math.hypot(m.a, m.b) || 1, k1 = q.width / r.width
  const lift = Math.min(60, Math.hypot(x1 - x0, y1 - y0) * 0.15)
  g.style.transition = 'opacity .12s ease-out'; g.style.opacity = '1'
  g.style.transform = `translate(${x1}px, ${y1}px) scale(${k1.toFixed(3)})`
  g.animate(arcPath(x0 - x1, y0 - y1, lift, 20, t => `scale(${(k0 + (k1 - k0) * t).toFixed(4)})`).map(f => ({ ...f, transform: `translate(${x1}px, ${y1}px) ${f.transform}` })),
    { duration: 400, easing: 'cubic-bezier(.3, .7, .3, 1)' })
  setTimeout(() => { sk.style.visibility = ''; g.remove() }, 420)
}

// Mesa de tamanho fixo (como o Balatro ou o Tabletop Simulator): a mesa tem sempre o mesmo tamanho «lógico» — deitada
// 1280×820, ao alto 760×1180 — e escala-se inteira para caber no ecrã. As cartas têm tamanho fixo lá dentro, por isso uma
// carta nova nunca empurra as zonas; num monte cheio as cartas encolhem dentro da fila. Só se volta a medir com mudanças a
// sério (rodar, redimensionar, ecrã inteiro): a barra do browser a aparecer/desaparecer (≈ 60–100 px) não conta.
export const STAGE = { wide: [1280, 820], tall: [560, 1000] }  // ao alto mais estreita: no telemóvel as cartas saíam com ~47 px
// filas cheias (muitas criaturas, terrenos, a mão): as cartas encostam-se umas às outras (--ov negativo) em vez de
// saírem da mesa; mede-se depois de cada mudança, só dentro da mesa de tamanho fixo
export function useOverlap(tableRef) {
  useLayoutEffect(() => {
    const root = tableRef.current
    if (!root) return
    const tb = () => root.getBoundingClientRect().bottom
    const tight = () => [...root.querySelectorAll('.bside')].some(bs => {
      // só as filas: o que flutua (o sítio onde a carta vai cair, .fp-slot, camadas absolutas) não conta como fila a encavalitar
      const ks = [...bs.children].filter(k => k.offsetHeight && !k.classList.contains('bfree') && !k.classList.contains('fp-slot') && getComputedStyle(k).position !== 'absolute').map(k => k.getBoundingClientRect())
      return ks.some((q, i) => i && q.top < ks[i - 1].bottom - 4) || bs.getBoundingClientRect().bottom > tb() + 2
    })
    // para partir uma fila em duas linhas: as filas não se podem encavalitar umas nas outras nem no nome, na vida e nos
    // montes do jogador (a mão é uma camada por cima, pode tapá-las), nem sair da mesa
    const clash = () => [...root.querySelectorAll('.bside')].some(bs => {
      const rows = [...bs.children].filter(k => k.matches('.brow') && k.offsetHeight).map(k => k.getBoundingClientRect())
      const hud = [...bs.querySelectorAll(':scope > .bhud > :not(.myhand):not(.fp-hand)')].filter(k => k.offsetHeight).map(k => k.getBoundingClientRect())
      return rows.some((q, i) => (i && q.top < rows[i - 1].bottom - 4) || q.bottom > tb() + 2 || hud.some(h => h.top < q.bottom - 4 && h.bottom > q.top + 4)) || hud.some(h => h.bottom > tb() + 2)
    })
    const kidsOf = row => [...row.children].filter(k => k.offsetWidth && !k.classList.contains('brk'))
    // encosta as cartas de cada linha da fila (--ov negativo) até caberem; numa fila com duas linhas, pela mais comprida
    const overlap = row => {
      const kids = kidsOf(row), n = kids.length, cur = parseFloat(row.style.getPropertyValue('--ov')) || 0
      if (n < 2) { row.style.removeProperty('--ov'); return true }
      const two = row.dataset.lines === '2', b = two ? kids.findIndex(k => k.previousElementSibling?.classList.contains('brk')) : -1
      const lines = b > 0 ? [kids.slice(0, b), kids.slice(b)] : [kids]
      // as outras permanentes (artefactos, encantamentos, planeswalkers) medem-se pelo conteúdo: o espaço delas é até 60%
      // da faixa de trás (medir a largura delas próprias encolhia-as de vez e o planeswalker ficava tapado pela saga)
      const room = (row.matches('.brow.rear > .brow.others') ? row.parentElement.clientWidth * 0.6 : row.clientWidth) - 4
      let ov = 0, fits = true
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0
      for (const ks of lines) {
        if (ks.length < 2) continue
        // em duas linhas, pela largura própria de cada grupo (scrollWidth: no Coliseu os grupos encolhem, e a quebra de
        // linha conta com a largura toda — passar dela fazia uma 3.ª linha)
        const natural = two ? ks.reduce((a, k) => a + k.scrollWidth, 0) + (ks.length - 1) * gap : ks[ks.length - 1].offsetLeft + ks[ks.length - 1].offsetWidth - ks[0].offsetLeft - (ks.length - 1) * cur
        const want = (room - natural) / (ks.length - 1), min = 8 - ks[0].offsetWidth  // até ficar só uma tira de 8 px: nunca passa da borda
        if (natural > room) { ov = Math.min(ov, Math.max(min, want)); fits &&= want >= min }
      }
      if (Math.abs(ov - cur) > 0.5) row.style.setProperty('--ov', `${ov}px`)
      return fits
    }
    // grelha adaptável (Definições › Mesa): a fila das criaturas e a dos terrenos partem-se em duas linhas (até 4 filas por
    // lado) quando numa linha só as cartas ficariam tapadas mais de um terço cada — mas só se as duas linhas couberem na
    // altura do lado, com o tamanho de carta que está; com espaço outra vez, voltam a uma linha
    // a mais apertada primeiro; a decisão parte sempre de todas numa linha, para não depender do que estava antes
    const two = fpPrefs().rowsMax !== 2, want = [], px = root.classList.contains('px')  // px: um tamanho escolhido não encolhe para dar lugar às linhas
    for (const row of root.querySelectorAll('.bside > .brow.front, .bside .brow.rear > .brow.lands')) {
      const kids = kidsOf(row), n = kids.length
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0, natural = kids.reduce((a, k) => a + k.scrollWidth, 0) + (n - 1) * gap
      // (e cada linha tem de caber, nem que encostadas: senão a quebra de linha fazia uma 3.ª)
      if (two && n > 2 && row.querySelector(':scope > .brk') && natural - (row.clientWidth - 4) > (n - 1) * (natural / n) / 3) want.push([1 - (row.clientWidth - 4) / natural, row])
      else if (row.dataset.lines) { delete row.dataset.lines; overlap(row) }
    }
    if (want.length) {
      for (const [, row] of want) if (row.dataset.lines) { delete row.dataset.lines; overlap(row) }
      for (const [, row] of want.sort((a, b) => b[0] - a[0])) { row.dataset.lines = '2'; if (!overlap(row) || clash() || (px && tight())) { delete row.dataset.lines; overlap(row) } }
    }
    // tamanho de carta escolhido (Definições › Mesa) maior do que cabe na altura da mesa: as filas de um lado
    // encavalitavam-se (a dos terrenos por cima das criaturas) — encolhe-se aos poucos (--pk) até cada lado caber
    // a arrastar uma carta (o fantasma existe) não se mexe no tamanho: a carta no ar fazia uma fila parecer cheia, tudo
    // encolhia de repente e depois voltava a crescer um passo por desenho (cartas a crescer e nunca alinhadas)
    if (root.classList.contains('px') && !document.querySelector('.fp-ghost:not(.fp-wait)')) {  // fp-wait: já largada, à espera do Forge
      let k = +root.style.getPropertyValue('--pk') || 1  // parte do valor atual: cresce um passo de cada vez quando há espaço
      const set = v => root.style.setProperty('--pk', v.toFixed(2))
      if (tight()) while (k > 0.45 && tight()) { k -= 0.05; set(k) }
      else while (k < 1) { const n = Math.min(1, k + 0.05); set(n); if (tight()) { set(k); break } k = n }  // cresce de uma vez até ao maior que cabe
    }
    for (const row of root.querySelectorAll('.brow.front, .brow.lands, .brow.others, .fp-hand')) overlap(row)
  })
}

// mesa compacta (telemóvel e tablet; ou sempre / nunca, Definições › Mesa): a mesa fica com o ecrã todo — as barras da app
// escondem-se (☰ mostra-as), o painel lateral vira gaveta e OK / Acabar o turno ficam numa barra só, por baixo da mesa (ou à
// direita, num ecrã muito largo e baixo como o telemóvel deitado). --chrome-h: a altura do que fica por cima da mesa
export const COMPACT_Q = '(pointer: coarse), (max-width: 900px), (max-height: 560px)'
export const isCompact = () => { const l = fpPrefs().layout; return l === 'compact' || (l === 'auto' && matchMedia(COMPACT_Q).matches) }
export function useGameFocus(boxRef) {
  const pick = isCompact
  const [compact, setCompact] = useState(pick), [chrome, setChrome] = useState(false)
  useEffect(() => { const m = matchMedia(COMPACT_Q), f = () => setCompact(pick()); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const box = boxRef.current
    document.body.classList.toggle('fp-chrome', compact && chrome)
    if (!compact || !box) return
    const top = () => box.style.setProperty('--chrome-h', `${Math.max(0, Math.round(box.getBoundingClientRect().top + (box.closest('.coliseu:fullscreen') ? 0 : scrollY)))}px`)
    scrollTo(0, 0); top()
    addEventListener('resize', top)
    return () => { removeEventListener('resize', top); document.body.classList.remove('fp-chrome') }
  }, [compact, chrome])  // eslint-disable-line react-hooks/exhaustive-deps
  return { compact, chrome, setChrome }
}

export function useStage(boxRef, wrapRef, ready, own = false, compact = false) {  // own: com o painel por baixo, a mesa fica com o ecrã todo (o painel vem a seguir, a rolar)
  const [st, setSt] = useState({ shape: 'wide', sc: 1, left: 0 })
  useLayoutEffect(() => {
    const box = boxRef.current, wrap = wrapRef.current
    if (!box || !wrap) return
    if (compact) {  // a caixa já tem o tamanho certo (a grelha da .fp.compact): a mesa estica-se para a forma dela e escala-se
      box.style.height = ''
      const fit = () => {
        const w = wrap.clientWidth, h = wrap.clientHeight
        if (!w || !h) return
        const shape = innerWidth < innerHeight ? 'tall' : 'wide', a = h / w
        let [W, H] = shape === 'tall' ? STAGE.tall : [1280, 740]  // deitada: 740 de altura (e não 820) — as cartas ficam ~10% maiores; o que sobrava era vazio entre os terrenos e a mão
        if (shape === 'tall') { H = Math.min(1700, Math.max(wrap.querySelector('.opps, .withmate') ? 1240 : 1100, Math.floor(W * a))); W = Math.max(W, Math.floor(H / a)) }  // 1100: o lado do adversário já não fica com espaço vazio (as filas dele medem-se pelo conteúdo); com 3–4 jogadores 1240, como antes
        else if (w / h > W / H) W = Math.min(2400, Math.floor(H / a))  // mais larga do que 1280×820: mais espaço nas filas, cartas do mesmo tamanho
        else H = Math.min(1100, Math.floor(W * a))
        const sc = Math.min(w / W, h / H)
        setSt({ shape, sc, left: Math.max(0, (w - W * sc) / 2), h: H * sc, W, H })
      }
      fit()
      const ro = new ResizeObserver(fit); ro.observe(wrap)
      return () => ro.disconnect()
    }
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
      // com o painel por baixo a mesa fica com o que sobra — num ecrã baixo (telemóvel deitado) sobrava quase nada e a mesa
      // ficava minúscula: aí a mesa fica com a altura toda e o painel vem a seguir, a rolar (a caixa cresce: altura automática)
      // só em ecrãs de toque (telemóvel/tablet): no PC fica como estava
      // telemóvel/tablet (ecrã de toque) com o painel por baixo: a mesa fica sempre com a altura toda e o painel vem a seguir
      const rest = total - (side?.offsetHeight || 0) - 8, full = below && !own && matchMedia('(pointer: coarse)').matches
      box.style.height = full ? `${total + (side?.offsetHeight || 0) + 8}px` : tall && !fe ? '' : `${total}px`
      const bar = full ? box.querySelector('.fp-actbar')?.offsetHeight || 0 : 0  // a barra fixa de OK/Cancelar (telemóvel) tapa o fundo do ecrã
      const h = below && !own && !full ? rest : total - bar
      const shape = tall ? 'tall' : 'wide'
      let [W, H] = STAGE[shape]
      // ao alto num ecrã de toque a mesa fica com a forma do ecrã e pelo menos 1240 de altura (o teu lado + nome, vida,
      // montes e mão por baixo); antes era 560×1000: no telemóvel sobravam ~150 px vazios e no tablet a mão tapava os montes
      if (full && tall) { const a = h / w; H = Math.min(1700, Math.max(1240, Math.floor(W * a))); W = Math.max(W, Math.floor(H / a)) }
      const sc = Math.min(w / W, h / H)
      setSt({ shape, sc, left: Math.max(0, (w - W * sc) / 2), h: H * sc, W, H })
    }
    fit(true)
    if (!document.fullscreenElement && matchMedia('(pointer: coarse)').matches) requestAnimationFrame(() => box.scrollIntoView({ block: 'start' }))  // telemóvel/tablet: a página desce até à mesa
    const again = () => fit(false), hard = () => fit(true)
    const tm = [150, 500].map(x => setTimeout(hard, x))
    addEventListener('resize', again); window.visualViewport?.addEventListener('resize', again)
    const evs = ['fullscreenchange', 'webkitfullscreenchange', 'orientationchange']
    evs.forEach(e => (e === 'orientationchange' ? window : document).addEventListener(e, hard))
    return () => {
      tm.forEach(clearTimeout); removeEventListener('resize', again); window.visualViewport?.removeEventListener('resize', again)
      evs.forEach(e => (e === 'orientationchange' ? window : document).removeEventListener(e, hard))
    }
  }, [ready, compact]) // eslint-disable-line react-hooks/exhaustive-deps
  return st
}

// cartas que mudam de sítio entre um estado do Forge e o seguinte (da mão para a mesa, presas a uma criatura, outra fila)
// deslizam com mola do sítio antigo para o novo (FLIP: mede antes e depois e anima a diferença). A mesma carta tem o
// mesmo id na mão e na mesa, por isso uma carta jogada voa da mão para o lugar dela.
// Mede-se o sítio de layout (offsetLeft/Top até à mesa, em px «lógicos»), que não vê transformações: a carta da mão
// levantada pelo rato, o atacante que avança, a perspetiva ou uma animação a meio já não contam como «mudou de sítio»
// (era isso que fazia cartas saltar e voltar a cada OK).
export const flipFrom = new Map()  // carta largada na mesa: o voo parte de onde a largaste, em px do ecrã (não da mão)
// Dos que a contêm conta-se a deslocação fixa (translate 2D): a mão centrada com translateX(-50%) e a casa da carta
// livre com translate(-50%, -50%) — sem isso a mão e o campo ficavam ~390 px desencontrados e uma carta jogada com duplo
// clique (ou devolvida à mão) partia de longe do sítio dela. A própria carta continua sem transformações.
const shiftOf = (e, cache) => {
  let v = cache.get(e)
  if (!v) { const t = getComputedStyle(e).transform, m = new DOMMatrixReadOnly(t === 'none' ? undefined : t); v = m.is2D ? { x: m.m41, y: m.m42 } : { x: 0, y: 0 }; cache.set(e, v) }
  return v
}
const layoutPos = (el, stop, cache = new Map()) => {
  let x = 0, y = 0
  for (let e = el; e && e !== stop; e = e.offsetParent) {
    x += e.offsetLeft; y += e.offsetTop
    if (e !== el) { const s = shiftOf(e, cache); x += s.x; y += s.y }
    if (!e.offsetParent || e.offsetParent === document.body) break
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}
// caminho curvo e suave (bezier quadrática amostrada): pontos de (dx, dy) até (0, 0), com o ponto de controlo a meio e
// levantado (lift, para cima no ecrã). As animações dos voos (useFlip, fantasmas da pilha, bolinhas, mana) usam isto em
// vez de 2–3 keyframes em linha reta, que davam caminhos com esquinas. f(t) acrescenta o resto (escala, rotação, opacidade)
export function arcPath(dx, dy, lift, n = 24, f = () => '') {
  const cx = dx / 2, cy = dy / 2 - lift, out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, x = u * u * dx + 2 * u * t * cx, y = u * u * dy + 2 * u * t * cy
    out.push({ offset: t, transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) ${f(t)}`.trim() })
  }
  return out
}
// voo FLIP de uma carta: parte de (dx, dy, escala k) em relação ao sítio dela e chega lá por uma curva (os voos longos
// sobem um pouco a meio; os pequenos ajustes de fila vão direitos). Por WAAPI: um voo novo a meio de outro parte de onde
// ela está agora (antes recomeçava do sítio antigo: a carta dava um salto); o fim é o transform dela (CSS), sem saltos
export function flyEl(el, dx, dy, k = 1, ms = 520) {
  el._flipAn?.cancel(); clearTimeout(el._flipT)
  el.classList.add('flipping'); el.style.zIndex = '6'
  const d = Math.hypot(dx, dy), lift = d > 140 ? Math.min(70, d * 0.16) : 0
  const kf = arcPath(dx, dy, lift, d > 140 ? 24 : 2, t => `scale(${(k + (1 - k) * t).toFixed(4)})`)
  // o fim: o transform que ela tem por CSS (a mão em leque, a casa livre…) — com «none» explícito ficava torta no último frame
  const base = getComputedStyle(el).transform
  kf[kf.length - 1].transform = base === 'none' ? 'none' : base
  const an = el.animate(kf, { duration: ms, easing: 'cubic-bezier(.2, 1.12, .35, 1)' })
  el._flipAn = an
  const done = () => { if (el._flipAn !== an) return; el._flipAn = null; el.style.zIndex = ''; el.classList.remove('flipping') }
  an.onfinish = done; an.oncancel = () => { if (el._flipAn === an) el._flipAn = null }
  return an
}
// uma cópia (a imagem da carta) voa no ecrã de `from` até à carta `el` (a .pc-rot dela), numa curva, enquanto ela fica
// escondida; no fim cruzam-se (a cópia desvanece e a carta aparece). Para quando o FLIP no espaço da carta não serve
export function ghostToCard(el, from, ms = 600) {
  el._flipAn?.cancel(); el.classList.add('flipping')  // sem o «aparecer» (.pc.in): mede-se o sítio final, em tamanho real
  const rot = el.querySelector('.pc-rot') || el, b = rot.getBoundingClientRect()
  if (!b.width || !from?.width || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.classList.remove('flipping'); return false }
  const g = document.createElement('div'), ax = from.left + from.width / 2, ay = from.top + from.height / 2, bx = b.left + b.width / 2, by = b.top + b.height / 2
  g.className = 'zghost fly'
  Object.assign(g.style, { left: `${bx - from.width / 2}px`, top: `${by - from.height / 2}px`, width: `${from.width}px`, height: `${from.height}px`, transformOrigin: '50% 50%' })
  const src = from.src || el.querySelector('.pc-f img')?.src
  if (src) g.style.backgroundImage = `url("${src}")`
  onTop().append(g)
  const d = Math.hypot(bx - ax, by - ay), k = Math.min(b.width / from.width, b.height / from.height)
  const an = g.animate(arcPath(ax - bx, ay - by, Math.min(70, d * 0.16), 24, t => `scale(${(1 + (k - 1) * t).toFixed(4)})`), { duration: ms, easing: 'cubic-bezier(.35, 0, .25, 1)', fill: 'forwards' })
  el.style.visibility = 'hidden'
  let over = false
  const done = () => {
    if (over) return
    over = true; el.style.visibility = ''; el.classList.remove('flipping')
    el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' })
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).onfinish = () => g.remove()
  }
  an.onfinish = done; setTimeout(done, ms + 300)
  return true
}
// onde a carta está agora, a meio de um voo: o deslocamento e a escala do transform atual (no espaço dela, também em perspetiva)
const flightNow = el => {
  if (!el._flipAn) return null
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
  return { x: m.m41, y: m.m42, k: Math.hypot(m.a, m.b) || 1 }
}
export function useFlip(box, seq, lay) {
  const last = useRef(new Map()), was = useRef(null)
  useLayoutEffect(() => {  // mede a cada desenho (o ponto de partida fica sempre em dia); só anima quando o estado mudou
    const t = box.current
    if (!t) return
    const fly = !was.current || was.current.seq !== seq || was.current.lay !== lay
    was.current = { seq, lay }
    const stage = t.closest('.fp-stage') || t, sc = +stage.dataset?.sc || 1
    const now = new Map(), reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, shifts = new Map()
    // mão arrumada: as cartas que vão voar perdem já a transição da margem (.22 s) — mede-se o sítio final e não um de
    // meio caminho, que a margem a acabar de mudar depois empurrava (a carta assentava e saltava ~24 px)
    for (const el of t.querySelectorAll('.fp-hand [data-h]')) if (flipFrom.has(el.dataset.h)) { el.style.transition = 'none'; requestAnimationFrame(() => { if (!el.classList.contains('flipping')) el.style.transition = '' }) }
    // .pc-attc: a aura/equipamento preso a outra carta — voa do sítio de onde veio (o fantasma largado em cima da carta,
    // ou a carta solta de antes); depois de presa anda com a carta dela (sem voo próprio, senão o voo contava a dobrar)
    for (const el of t.querySelectorAll('.pc[data-z^="k:"], .pc-attc[data-z^="k:"], .fp-hand [data-h]')) {
      const id = el.dataset.h || el.dataset.z.slice(2), att = el.matches('.pc-attc')
      if (!el.offsetWidth) continue
      const p = layoutPos(el, stage, shifts)
      now.set(id, { ...p, att })
      let drop = flipFrom.get(id)
      const o = last.current.get(id)
      if (drop?.nodeType) {  // o fantasma do arrastar: a carta parte dele e ele sai no mesmo frame (sem vazio nem salto)
        const g = drop
        drop = g._any || (el !== g._src && el.matches('.pc, .pc-attc, .fp-hand [data-h]')) ? g.getBoundingClientRect() : null  // (do campo largada na mão: parte de onde a largaste)
        if (drop) { g.remove(); el.style.visibility = ''; if (g._src?.isConnected) g._src.style.visibility = '' }  // o monte da biblioteca (topo jogado) fica no DOM: volta a ver-se
      }
      if (att && !drop && (!o || o.att)) continue
      if (!fly && !drop) continue
      if (drop) flipFrom.delete(id)
      if (drop?.stk) el._stk = performance.now()  // veio da pilha (ver StackFx)
      if (!drop && !o && !reduce && last.current.size) {  // nova sem origem conhecida (ficha criada…): aparece por WAAPI (não compete com nada)
        el.animate([{ opacity: 0, transform: 'scale(.7) translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'ease-out' })
        continue
      }
      if (reduce || (!drop && !o)) continue
      let dx, dy, k
      // pelos centros: a escala é em volta do centro da carta (pelos cantos, com escala ≠ 1, partia uns px ao lado)
      // da pilha para o lado de cima em perspetiva: a carta lá está inclinada (um trapézio) e um FLIP no espaço dela não
      // parte do retângulo direito da pilha — voa uma cópia no ecrã, numa curva, e a carta aparece quando ela chega
      if (drop?.stk && el.closest('.fp-stage.persp .bside.top') && ghostToCard(el, drop)) continue
      if (drop) {  // vem do sítio do ecrã onde a largaste (ou da carta na pilha): compara com o retângulo atual no ecrã
        // sem o voo que ainda leve a meio (e sem o «aparecer»): medido com ele, o novo partia muito ao lado — no lado de
        // cima em perspetiva, a carta do outro que já voava da mão dele surgia enorme na borda da mesa
        el._flipAn?.cancel(); el.classList.add('flipping'); el.style.transition = 'none'; el.style.transform = ''
        const r = el.getBoundingClientRect()
        // px do ecrã -> px da carta: pela escala a que ela se vê (a mesa escalada e, no lado de cima, a perspetiva que a
        // encolhe — dividir só pela escala da mesa fazia a carta da pilha partir uns 30 px ao lado e mais pequena)
        const fx = r.width / (el.offsetWidth || r.width) || sc, fy = r.height / (el.offsetHeight || r.height) || sc
        dx = (drop.left + drop.width / 2 - r.left - r.width / 2) / fx; dy = (drop.top + drop.height / 2 - r.top - r.height / 2) / fy; k = drop.width / r.width
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) { el.classList.remove('flipping'); el.style.transition = '' }  // já está lá: não voa
      } else {
        dx = o.x + o.w / 2 - p.x - p.w / 2; dy = o.y + o.h / 2 - p.y - p.h / 2; k = o.w / p.w
        const cur = flightNow(el)  // a meio de outro voo: parte de onde está agora, não do sítio antigo
        if (cur) { dx += cur.x; dy += cur.y; k *= cur.k }
      }
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) continue  // não se mexeu (ou quase): deixa-a como está, a meio do que estiver a fazer
      // .flipping: sem o «aparecer» (.pc.in anima o transform e, por ser animação CSS, ganhava ao voo: a carta aparecia
      // logo no sítio e depois dava um salto a meio do caminho) e com sombra de quem vai no ar
      el.style.transition = ''
      flyEl(el, dx, dy, k, drop?.stk ? 620 : 520)
    }
    last.current = now
  })
}

// cartas que mudam de zona sem passar pela tua mão ou pelo campo (reanimar, devolver do exílio, regrowth, o adversário
// que joga da mão dele): o useFlip não as conhece no sítio antigo, por isso o voo parte do monte/mão de onde vieram.
// at(): Map id -> {z, src (seletor do sítio onde a zona se vê), fly (o sítio novo é seguido pelo useFlip)}. Corre antes
// do useFlip (chamar este primeiro).
export function useZoneFlights(box, seq, at) {
  const prev = useRef(new Map()), seen = useRef(new Map())
  useLayoutEffect(() => {
    const now = at(), pv = prev.current, was = seen.current
    prev.current = now
    if (!box.current) return
    // cartas que saíram do campo: a cópia faz a saída onde ela estava (o React já a tirou da mesa)
    // ponytail: o retângulo é o do último estado; se a janela mudou de tamanho entretanto, a cópia nasce um pouco ao lado
    // (para a minha mão não: a própria carta voa do campo para a mão pelo useFlip — a cópia a cair no sítio antigo era a dobrar)
    for (const [id, o] of pv) if (o.z === 'battlefield' && now.get(id)?.z !== 'battlefield' && !(now.get(id)?.z === 'hand' && now.get(id).fly) && was.has(id)) { const g = was.get(id); leaveGhost(g.r, g.src, g.tapped, now.get(id)?.z || 'library') }
    seen.current = new Map([...box.current.querySelectorAll('.pc[data-z^="k:"]')].filter(e => e.offsetWidth).map(e => {
      const rot = e.querySelector('.pc-rot') || e
      return [e.dataset.z.slice(2), { r: rot.getBoundingClientRect(), src: e.querySelector('.pc-f img')?.src, tapped: e.classList.contains('tapped') }]
    }))
    // na pilha (z 'stack', Forge Play): guarda-se já o sítio dela, pelo layout dentro do monte (sem a animação de entrada
    // nem o abanar) — quando resolver, a carta da pilha já saiu do DOM
    for (const w of now.values()) {
      const e = w.z === 'stack' && box.current.querySelector(w.src), pile = e?.offsetParent
      if (!pile) continue
      const q = pile.getBoundingClientRect(), s = q.width / (pile.offsetWidth || q.width) || 1
      w.r = { left: q.left + e.offsetLeft * s, top: q.top + e.offsetTop * s, width: e.offsetWidth * s, height: e.offsetHeight * s, src: e.querySelector('img')?.src }
    }
    if (!pv.size) return
    for (const [id, w] of now) {
      // w.from: de onde vem uma carta que antes não se via (a mesa livre: a comprada voa da biblioteca para a mão)
      const o = pv.get(id), src = o ? o.src : w.from
      // resolveu para o campo: a carta do campo voa do sítio onde estava na pilha (stk: o StackFx não faz a cópia «A resolver»)
      if (o?.z === 'stack') { if (o.r && w.z === 'battlefield' && w.fly) flipFrom.set(String(id), { ...o.r, stk: true }); continue }
      if ((o && o.z === w.z) || !w.fly || !src) continue
      const el = box.current.querySelector(src)
      // de uma mão em leque: parte de uma carta do meio (o leque inteiro fazia-a começar quase 3× maior)
      const kids = el ? [...el.querySelectorAll('*')].filter(x => x.offsetWidth > 14 && x.offsetWidth < el.offsetWidth * 0.6 && x.offsetHeight > x.offsetWidth) : []
      const kid = kids[Math.floor(kids.length / 2)]
      const from = kid?.offsetWidth ? kid : el
      if (from?.offsetWidth) flipFrom.set(String(id), from.getBoundingClientRect())
    }
  }, [seq]) // eslint-disable-line react-hooks/exhaustive-deps
}

// a carta que sai do campo (exílio, mão, biblioteca, cemitério): uma cópia dela faz a animação toda numa camada própria,
// porque a carta da mesa sai logo a seguir (o evento ou o estado seguinte tira-a) e antes desaparecia de repente a meio
export function leaveGhost(r, src, tapped, to) {
  if (!r?.width || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const g = document.createElement('div'), W = tapped ? r.height : r.width, H = tapped ? r.width : r.height
  g.className = `zghost to-${to}`
  Object.assign(g.style, { left: `${r.left + r.width / 2 - W / 2}px`, top: `${r.top + r.height / 2 - H / 2}px`, width: `${W}px`, height: `${H}px`, rotate: tapped ? '90deg' : '0deg' })
  if (src) g.style.backgroundImage = `url("${src}")`
  ;(document.fullscreenElement || document.webkitFullscreenElement || document.body).append(g)
  g.onanimationend = () => g.remove(); setTimeout(() => g.remove(), 2500)  // só sai quando acabou de desvanecer
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
// Só vem ao fim de PEEK_MS com o rato parado na mesma carta (passar por cima a arrumar terrenos não a chama) e nunca
// durante ou logo a seguir a um arrastar; no toque não há (tocar e manter mostra-a em grande no painel).
const PEEK_MS = 450
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
      if (document.querySelector('.fp-ghost') || Date.now() - dragEnd < 700) { cur.current = null; return }
      const att = pc.classList.contains('pc-attc')  // aura/equipamento preso: a própria carta pequena
      const face = att ? pc : pc.querySelector(pc.querySelector('.pc-flip.on .pc-b') ? '.pc-b' : '.pc-f'), rot = att ? pc : pc.querySelector('.pc-rot')
      if (!face || !rot || cur.current !== c) return
      const sc = +pc.closest('.fp-stage')?.dataset.sc || 1, q = rot.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2
      const w0 = rot.offsetWidth * sc, w = Math.max(190, Math.min(250, w0 * 2.2)), h = w * 680 / 488
      const x = Math.max(8, Math.min(innerWidth - w - 8, cx - w / 2)), y = Math.max(8, Math.min(innerHeight - h - 8, cy - h / 2))
      const tilt = pc.closest('.bside.top') && pc.closest('.fp-stage.persp') ? fpPrefs().tilt : 0
      c.from = `translate(${cx - x - w / 2}px, ${cy - y - h / 2}px) perspective(800px) rotateX(${tilt}deg) rotate(${(pc.classList.contains('tapped') ? 90 : 0) + (pc.closest('.fp-stage.opp-far .bside.top') ? 180 : 0)}deg) scale(${(w0 / w).toFixed(3)})`
      const n = document.createElement('div')
      n.className = 'fp-peek'
      n.appendChild(face.cloneNode(true))
      Object.assign(n.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, transform: c.from })
      onTop().appendChild(n)
      c.node = n
      requestAnimationFrame(() => requestAnimationFrame(() => { if (cur.current === c) { n.style.transform = 'none'; n.style.opacity = '1' } }))
    }, PEEK_MS)
  }
  useEffect(() => hide, [])
  return { over, hide }
}

// dados na mesa: os mesmos dados 3D da Mesa (Dice3D.js, three.js + dicephys.js, só carregados ao primeiro lançamento)
// rolam por cima da mesa e assentam lá; a camada não apanha o rato (as cartas continuam a responder por baixo)
const DICE_COL = { d6: ['#fff6e6', '#cdb894', '#3a2a10'], d20: ['#8cc8ff', '#1f4fb8', '#ffffff'], moeda: ['#ffe9a3', '#b8860b', '#ffffff'] }
// o = {box, rot, onThrow, keep} (mesa livre): caixa fixa, vista rodada para o teu lado, dados que se agarram e lançam
// pelo servidor (ver Dice3D.createTray); keep = quanto tempo os dados ficam na mesa depois de assentarem
export function useTableDice(box, o = null) {
  const tray = useRef(null), clear = useRef(0), lastWords = useRef(null), [res, setRes] = useState(null), opt = useRef(o)
  opt.current = o
  useEffect(() => () => { clearTimeout(clear.current); tray.current?.dispose?.() }, [])
  const ensure = async () => {
    if (!tray.current) {
      const D = await import('./Dice3D.js')
      if (!box.current || tray.current) return tray.current
      const O = opt.current
      tray.current = D.webglOk() ? D.createTray(box.current, { view: 13, colors: DICE_COL, words: [tx('Cara'), tx('Coroa')], onHit: a => play('diceHit', { amount: a }),
        ...(O && { box: O.box, rot: O.rot || 0, onThrow: (types, thr) => opt.current?.onThrow?.(types, thr), onDrag: (x, y) => opt.current?.onDrag?.(x, y) }),
        onSettle: items => { setRes({ items, words: lastWords.current }); play('tick', { amount: 1 }); if (items.some(x => x.type === 'moeda')) play('coin'); clearTimeout(clear.current); clear.current = setTimeout(() => { tray.current?.clear(); setRes(null) }, opt.current?.keep || 20000) } }) : 'flat'
    }
    return tray.current
  }
  const roll = async (types, want, extra) => {  // want: os valores já sorteados (mesa livre: o servidor tira-os e todos veem o mesmo); extra = {seed, thr, words}
    clearTimeout(clear.current); setRes({ rolling: true, types }); lastWords.current = extra?.words || null
    if (!(await ensure())) return
    play('dice', { amount: types.length })
    if (tray.current === 'flat') return setRes({ words: lastWords.current, items: types.map((type, i) => ({ type, v: want?.[i] ?? 1 + Math.floor(Math.random() * (type === 'moeda' ? 2 : +type.slice(1))) })) })  // sem WebGL: só o número
    tray.current.roll(types, want, extra)
  }
  const off = () => { clearTimeout(clear.current); if (tray.current && tray.current !== 'flat') tray.current.clear(); setRes(null) }
  const live = () => tray.current && tray.current !== 'flat' ? tray.current : null
  const grab = e => { const t = live(); if (t?.has() && t.grab(e)) { clearTimeout(clear.current); return true } return false }  // agarrar um dado que está na mesa
  const throwFrom = async () => { const t = await ensure(); return t && t !== 'flat' ? t.throwFrom() : null }
  const setRot = a => live()?.setRot(a)
  // a esfera da vida atirada pela mesa empurra os dados (Board.jsx manda «grim-orb» a cada frame enquanto voa)
  useEffect(() => {
    const f = e => { const d = e.detail; if (d && Math.hypot(d.vx, d.vy) > 120) live()?.push?.(d.x, d.y, d.vx, d.vy) }
    addEventListener('grim-orb', f); return () => removeEventListener('grim-orb', f)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const warm = () => { ensure().catch(() => {}) }  // carrega o three.js e cria a camada antes do 1.º lançamento (a moeda do início sai logo)
  return { roll, res, off, grab, throwFrom, setRot, warm }
}
