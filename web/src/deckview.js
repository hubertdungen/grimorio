// Vistas do deck, sem componentes: a pré-visualização da carta (rato por cima ou toque longo; antes em Views.jsx) e as
// categorias fechadas (▸)
import { useSyncExternalStore } from 'react'
import { img } from './data.js'

let peek
// ao lado da linha; num scroll (do rato ou do browser a reajustar a página) acompanha a linha enquanto o rato lá estiver
const placePeek = (el, a) => {
  const r = a.getBoundingClientRect()
  el.style.top = `${Math.min(window.innerHeight - 350, Math.max(8, r.top - 120))}px`
  el.style.left = `${Math.min(window.innerWidth - 250, r.right + 12)}px`
}
// cartas de duas faces: a imagem vira em 3D para a outra face passado 1 s (e com F ou o ⟲ da linha)
let peekFlipT
export const peekOpen = () => peek?.style.display === 'block'
export function flipCardPeek() { clearTimeout(peekFlipT); if (peek?.dataset.df && peek.style.display === 'block') peek.classList.toggle('flipped') }  // virar à mão cancela o automático
export function showCardPeek(e, c, pid) {
  if (!matchMedia('(hover: hover)').matches) return
  openPeek(e.currentTarget, c, pid)
  watchPeek(peek, e.currentTarget)
}
function openPeek(a, c, pid) {
  if (!peek) {
    peek = document.body.appendChild(document.createElement('div')); peek.className = 'peek'
    peek.innerHTML = '<div class="peek-in"><img class="pf" alt=""><img class="pb" alt=""></div>'
  }
  peek.querySelector('.pf').src = img(c, 'normal', false, pid)
  peek.dataset.df = c.df ? '1' : ''
  peek.querySelector('.pb').src = c.df ? img(c, 'normal', true, pid) : ''
  peek.classList.remove('flipped')
  clearTimeout(peekFlipT)
  if (c.df) peekFlipT = setTimeout(flipCardPeek, 1000)
  placePeek(peek, a)
  peek.style.display = 'block'
}
// toque longo (telemóvel/tablet): a carta aparece ao centro enquanto o dedo está em cima; ao largar fecha e esse toque
// não abre a ficha. Se o dedo arrastar, o browser cancela (pointercancel) e a página faz scroll como sempre.
let pressT, pressed = false
const endPress = () => { clearTimeout(pressT); if (pressed) hideCardPeek() }
export const pressPeek = (c, pid) => ({
  onPointerDown: e => {
    pressed = false; clearTimeout(pressT)
    if (e.pointerType !== 'touch') return
    const a = e.currentTarget
    pressT = setTimeout(() => { pressed = true; openPeek(a, c, pid); Object.assign(peek.style, { top: `${Math.max(8, (innerHeight - 340) / 2)}px`, left: `${(innerWidth - 240) / 2}px` }) }, 450)
  },
  onPointerUp: endPress, onPointerCancel: endPress,
  onContextMenu: e => { if (e.pointerType === 'touch' || pressed) e.preventDefault() },  // sem o menu do browser por cima
  onClickCapture: e => { if (pressed) { pressed = false; e.preventDefault(); e.stopPropagation() } },
})
// fecha-se se a linha por baixo desaparecer (ex.: «−» tirou a última cópia), se o rato sair dela ou a qualquer clique/tecla
let peekAnchor, peekTimer
const anchored = () => peekAnchor?.isConnected && (peekAnchor.matches(':hover') || !!peekAnchor.parentElement?.matches('.row:hover'))  // a linha inteira (o ⟲ incluído)
function watchPeek(el, a) {
  peekAnchor = a
  if (!window.__peekGuard) {
    window.__peekGuard = true
    addEventListener('pointerdown', e => { if (!e.target.closest?.('.peek-flip')) hideCardPeek() }, true)
    addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { if (peek?.dataset.df && peek.style.display === 'block') { e.preventDefault(); clearTimeout(peekFlipT); flipCardPeek() } } else hideCardPeek() }, true)
    addEventListener('scroll', () => { if (peek?.style.display === 'block') { if (anchored()) placePeek(peek, peekAnchor); else hideCardPeek() } }, true)
  }
  clearInterval(peekTimer)
  peekTimer = setInterval(() => { if (!anchored()) { el.style.display = 'none'; clearInterval(peekTimer) } }, 250)
}

export function hideCardPeek() { clearTimeout(peekFlipT); if (peek) peek.style.display = 'none' }

// categorias do deck fechadas (▸): guardadas no browser e iguais na lista, na grelha e no painel lateral
const FOLD_K = 'grimorio.fechadas', foldSubs = new Set()
let folded = new Set((() => { try { return JSON.parse(localStorage.getItem(FOLD_K)) || [] } catch { return [] } })())
const putFolded = n => { folded = n; try { localStorage.setItem(FOLD_K, JSON.stringify([...n])) } catch { /* sem storage */ } foldSubs.forEach(f => f()) }
export function useFolded() {
  const s = useSyncExternalStore(f => { foldSubs.add(f); return () => foldSubs.delete(f) }, () => folded)
  return {
    shut: k => s.has(k),
    toggle: k => { const n = new Set(folded); if (!n.delete(k)) n.add(k); putFolded(n) },
    all: (ks, on) => putFolded(new Set(on ? [...folded, ...ks] : [...folded].filter(k => !ks.includes(k)))),
  }
}
