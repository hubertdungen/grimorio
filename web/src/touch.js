// Ecrãs de toque (telemóvel, tablet, app Android): um só sítio para saber se é toque (isTouch e a classe .touch no
// <html>, com que o CSS esconde as teclas) e o «tocar e manter» da app toda: manter o dedo parado ~0,45 s faz o mesmo
// que o botão direito (o menu da carta na mesa livre…) ou, se ninguém o usar, o mesmo que passar o rato com demora
// (a carta em grande, as contas…), e mostra o texto do title (que no toque nunca aparece). O toque que se segue não é
// um clique. As peças que já têm o seu tocar e manter (arrastar cartas, ver em grande, estrelas…) chamam held() e
// este fica de fora.
import { tx } from './i18n.js'

const mq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null
export const isTouch = () => !!(mq?.matches || globalThis.window?.GrimorioApp)
const HOLD_MS = 450

// os gestos que a app faz, para as Definições › Mesa e o guia (no toque, em vez das teclas)
export const gestures = () => ({
  play: [
    [tx('Tocar'), tx('numa carta da mão levanta-a e mostra-a; numa permanente tua usa-a (a mana vai logo, as outras habilidades perguntam «Ativar?»); no P/T de uma criatura mostra as contas.')],
    [tx('Dois toques'), tx('numa carta da mão joga-a; numa permanente tua abre as ações dela, em qualquer fase.')],
    [tx('Arrastar'), tx('da mão para a mesa joga a carta; uma criatura para o lado do adversário ataca, para cima de um atacante bloqueia.')],
    [tx('Tocar e manter'), tx('numa carta mostra-a em grande; num botão ou num símbolo diz o que é.')],
    [tx('Carta em grande'), tx('dois dedos ampliam, dois toques aproximam; toca ou desliza para baixo para fechar.')],
    [tx('Cemitério e exílio'), tx('tocar nas pilhas abre-as; fecha-se com «fechar», tocando fora ou a deslizar para baixo.')],
    [tx('Esfera da vida'), tx('quando o Forge pede um alvo, toca nela para escolher esse jogador; arrasta-a para a atirar; mantém o dedo 3 s para veres o que ela mostra.')],
    [tx('Voltar'), tx('o botão «voltar» do telemóvel fecha a janela ou a carta aberta.')],
  ],
  free: [
    [tx('Tocar'), tx('numa carta tua na mesa vira-a (tap); na tua biblioteca abre o menu dela; na esfera da vida, a vida, o veneno e o resto.')],
    [tx('Dois toques'), tx('na biblioteca compra uma; numa carta da mão joga-a.')],
    [tx('Tocar e manter'), tx('numa carta abre o menu dela (o mesmo que o botão direito), com «Ver em grande».')],
    [tx('Arrastar'), tx('a carta para a mesa, para outra carta (alvo, aura, bloqueio) ou para um monte; um dado para o atirar.')],
  ],
})

let claimed = -1e9, press = null, eatUntil = 0, tip = null, hovered = null
// uma peça tratou ela própria o tocar e manter: vibra um pouco e o geral não faz mais nada
export const held = (ms = 12) => { claimed = performance.now(); try { navigator.vibrate?.(ms) } catch { /* sem vibração */ } }

const NATIVE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], a[href]'  // o browser trata (selecionar, colar, abrir)
const NOCALLOUT = 'img, svg, canvas, .fp, .board, .pc, .fp-card'
const layer = () => document.fullscreenElement || document.webkitFullscreenElement || document.body
const hideTip = () => { tip?.remove(); tip = null }
const unhover = () => { if (hovered?.isConnected) hovered.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); hovered = null }

function showTip(el, s) {
  hideTip()
  const r = el.getBoundingClientRect()
  tip = document.createElement('div'); tip.className = 'touch-tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = s
  layer().appendChild(tip)
  const w = tip.offsetWidth, h = tip.offsetHeight, y = r.top - h - 10
  Object.assign(tip.style, { left: `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`, top: `${y >= 8 ? y : Math.min(innerHeight - h - 8, r.bottom + 10)}px` })
}

function fire() {
  const p = press
  if (!p || p.done) return
  p.done = true
  if (performance.now() - claimed < 300) { p.used = p.eat = true; return }  // já tratado pela própria peça (o toque que se segue também não é clique)
  const t = p.target
  if (!t.isConnected || t.closest(NATIVE)) return
  p.eat = true; p.synth = true
  const o = { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, view: window }
  if (!t.dispatchEvent(new MouseEvent('contextmenu', { ...o, button: 2 }))) { p.used = true; held(); return }  // = botão direito
  t.dispatchEvent(new MouseEvent('mouseover', o)); hovered = t  // = passar o rato (sai no toque seguinte)
  const el = t.closest('[title]'), s = el?.getAttribute('title')
  const r = el?.getBoundingClientRect()
  if (s && r.width * r.height < innerWidth * innerHeight / 4) { p.used = true; showTip(el, s); held() }  // não o title de um painel inteiro
}

if (globalThis.document) {
  const sync = () => document.documentElement.classList.toggle('touch', isTouch())
  sync(); mq?.addEventListener?.('change', sync)
  // em captura: vê também os toques que as peças param (stopPropagation); o temporizador é 20 ms mais lento que os
  // delas (450 ms), por isso as que tratam o toque longo chegam primeiro e chamam held()
  addEventListener('pointerdown', e => {
    if (!e.target.closest?.('.touch-tip')) hideTip()
    eatUntil = 0
    unhover()
    clearTimeout(press?.t); press = null
    if (e.pointerType === 'mouse' || !e.isPrimary) return
    press = { target: e.target, x: e.clientX, y: e.clientY, ts: e.timeStamp, t: setTimeout(fire, HOLD_MS + 20) }
  }, true)
  addEventListener('pointermove', e => { if (press && !press.done && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press = null } }, true)
  addEventListener('pointerup', e => {
    if (!press) return
    clearTimeout(press.t)
    if (e.timeStamp - press.ts >= HOLD_MS + 20) fire()  // a página estava ocupada e o temporizador atrasou-se: conta o tempo do dedo
    if (press.eat) eatUntil = performance.now() + 3000  // o clique deste toque (que pode vir atrasado); o toque seguinte cancela
    press = null
  }, true)
  addEventListener('pointercancel', () => { clearTimeout(press?.t); press = null }, true)
  addEventListener('click', e => { if (performance.now() < eatUntil) { eatUntil = 0; e.preventDefault(); e.stopPropagation() } }, true)  // o toque longo não é um clique
  addEventListener('scroll', hideTip, true)
  // o toque longo do próprio browser (o Android chega aos ~400 ms): passa já pelo nosso; o menu do browser (guardar a
  // imagem, selecionar o texto) só fica quando o nosso não fez nada e não é numa carta, imagem ou mesa
  addEventListener('contextmenu', e => {
    if (!e.isTrusted || !press || e.target.closest?.(NATIVE)) return
    fire()
    if (press.synth) e.stopImmediatePropagation()  // os handlers já receberam o nosso
    if (press.used || e.target.closest?.(NOCALLOUT)) e.preventDefault()
  }, true)
}
