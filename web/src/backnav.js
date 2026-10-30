// «Voltar» dentro da app (gesto/botão do telemóvel, botão do browser, APK com webView.goBack()): primeiro fecha a janela
// aberta por cima (useBackClose), depois volta à vista anterior (App.jsx: área, separador, modo do Coliseu, deck).
// Cada passo é uma entrada do histórico; o URL não muda (as ligações /sala/… e #online ficam como estão).
import { useEffect, useRef } from 'react'

const wins = []  // janelas abertas, a última por cima
let skip = 0, later = [], onView = null
// enquanto um history.back() nosso não chega, as entradas novas esperam (senão o «back» desfazia a entrada errada)
const run = f => (skip ? later.push(f) : f())
addEventListener('popstate', e => {
  if (skip) { if (!--skip) { const q = later; later = []; q.forEach(f => f()) } return }
  if (wins.length) return wins.pop().close()
  if (e.state?.v) onView?.(e.state.v)
})

// a vista atual (texto, ex. JSON): entra como passo novo, ou substitui o atual (1.ª vista, ou mudança que não é um passo)
export const pushView = (v, replace) => run(() => { if (history.state?.v !== v) history[replace ? 'replaceState' : 'pushState']({ v }, '') })
export const viewNow = () => history.state?.v
export const setOnView = f => { onView = f }

// janela/painel por cima: abrir acrescenta uma entrada e «voltar» fecha-a; fechar à mão (×, Esc, fora) tira a entrada
export function useBackClose(open, onClose) {
  const f = useRef(onClose)
  useEffect(() => { f.current = onClose })
  useEffect(() => {
    if (!open) return
    const me = { close: () => f.current() }
    wins.push(me)
    run(() => history.pushState({ ...history.state, ov: wins.length }, ''))
    return () => {
      const k = wins.indexOf(me)
      if (k < 0) return  // já fechada pelo «voltar»
      wins.splice(k, 1); skip++; history.back()
    }
  }, [open])
}
