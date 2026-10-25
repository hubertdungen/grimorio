// A sessão de testes do Laboratório fora do componente: sair do separador (ou da secção) não a perde, as duas vistas
// do Laboratório (Construir › Teste e Coliseu › Bots) mostram a mesma, e o cabeçalho sabe que está a decorrer.
import { useCallback, useSyncExternalStore } from 'react'

export const runState = { busy: null, runs: [], played: [], watch: null, err: '', cur: 0, deckId: null, deckName: '', stop: false }
const subs = new Set()
const sub = f => { subs.add(f); return () => subs.delete(f) }
export function setRun(k, v) { runState[k] = typeof v === 'function' ? v(runState[k]) : v; subs.forEach(f => f()) }
export function useRun(k) {
  const v = useSyncExternalStore(sub, () => runState[k])
  return [v, useCallback(x => setRun(k, x), [k])]
}
// o «Parar» com a mesma forma de um useRef, partilhado
export const stopRef = { get current() { return runState.stop }, set current(v) { runState.stop = v } }
