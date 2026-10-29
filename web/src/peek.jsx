// carregar um deck (meu ou do meta) para o ver, e o cartão do rato por cima (DeckPeek.jsx)
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PeekCard } from './DeckPeek.jsx'

const cache = new Map()
// p: {src: 'meus'|'meta', ref} (como nos pódios)
export const loadDeck = p => {
  const k = `${p.src}:${p.ref}`
  if (!cache.has(k)) cache.set(k, fetch(p.src === 'meus' ? `/api/decks/${p.ref}` : `/api/sim/opponents/${encodeURIComponent(p.ref)}`).then(r => (r.ok ? r.json() : null)).catch(() => null))
  return cache.get(k)
}
// o cartão do rato por cima: segue o elemento, fecha ao sair
export function usePeek(data) {
  const [peek, setPeek] = useState(null), t = useRef(0)
  const on = (p, e) => {
    const r = e.currentTarget.getBoundingClientRect()
    clearTimeout(t.current)
    t.current = setTimeout(() => loadDeck(p).then(d => d && setPeek({ d, p, x: Math.min(r.left, innerWidth - 300), y: r.bottom + 6 > innerHeight - 260 ? Math.max(8, r.top - 250) : r.bottom + 6 })), 280)
  }
  const off = () => { clearTimeout(t.current); setPeek(null) }
  const card = peek && createPortal(<PeekCard {...peek} data={data} />, document.body)
  return { on, off, card }
}
