// Ecrã sempre ligado (Screen Wake Lock): com a app à vista o telemóvel/tablet não apaga o ecrã (jogos ao vivo, torneios,
// contador de vida). Por omissão ligado nos ecrãs de toque; Definições › Ecrã. O browser só o permite em HTTPS e larga-o
// quando a página fica escondida: volta a pedir-se ao regressar.
const K = 'grimorio.ecraLigado'
const touch = () => { try { return matchMedia('(pointer: coarse)').matches } catch { return false } }
export const wakeSupported = () => 'wakeLock' in navigator && window.isSecureContext
export const wakeOn = () => { try { const v = localStorage.getItem(K); return v == null ? touch() : v === '1' } catch { return touch() } }
let lock = null
async function grab() {
  if (lock || !wakeOn() || document.visibilityState !== 'visible' || !wakeSupported()) return
  try {
    lock = await navigator.wakeLock.request('screen')
    lock.addEventListener('release', () => { lock = null })
  } catch { lock = null }  // bateria fraca ou o sistema recusou: fica como estava
}
export function setWake(on) {
  try { localStorage.setItem(K, on ? '1' : '0') } catch { /* sem armazenamento */ }
  if (on) grab(); else { lock?.release().catch(() => {}); lock = null }
}
let started = false
export function initWake() {
  if (started) return
  started = true
  grab()
  document.addEventListener('visibilitychange', grab)
  addEventListener('pointerdown', grab, { passive: true })  // alguns browsers só dão o pedido depois de um toque
}

// Orientação em ecrã inteiro (Coliseu): «auto» = telemóvel ao alto (deitado não se vê nada), tablet deitado.
// screen.orientation.lock só funciona em ecrã inteiro e no Android; no iPhone/iPad fica como o aparelho estiver.
const KO = 'grimorio.fsOrient'
export const fsOrientPref = () => { try { return localStorage.getItem(KO) || 'auto' } catch { return 'auto' } }
export const setFsOrientPref = v => { try { localStorage.setItem(KO, v) } catch { /* sem armazenamento */ } }
export function lockFsOrientation() {
  const p = fsOrientPref()
  const phone = Math.min(screen.width, screen.height) < 600
  const o = p === 'free' ? null : p === 'auto' ? (phone ? 'portrait' : 'landscape') : p
  return o ? screen.orientation?.lock?.(o) : undefined
}
