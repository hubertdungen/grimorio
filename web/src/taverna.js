// A Taverna (Taverna.jsx) fora do ecrã dela: «estou a jogar» (as mesas avisam ao abrir), o batimento de 25 em 25 s que
// mantém quem está ligado e dá o selo de mensagens por ler (na Taverna daqui e nas Tavernas de amigos guardadas, que
// vivem noutros Grimórios: pedidos diretos com o convite em Bearer), e a lista dessas Tavernas de amigos.
import { useEffect, useState } from 'react'
import { remoteOn } from './remote.js'

// ---------- a jogar: FreeTable e ForgeTable contam-se enquanto estão abertas ----------
let tables = 0
export const playing = () => tables > 0
export function usePlaying() {
  useEffect(() => { tables++; return () => { tables-- } }, [])
}

// ---------- Tavernas de amigos (noutro Grimório) onde já entraste: [{ base, token, name, hid, ts }] ----------
const K = 'grimorio.tavernasAmigos'
export const tavernas = () => { try { return JSON.parse(localStorage.getItem(K)) || [] } catch { return [] } }
const same = (x, y) => y.token === x.token && (y.base === x.base || (!!x.hid && y.hid === x.hid))
export const saveTaverna = x => { try { localStorage.setItem(K, JSON.stringify([{ ...x, kind: 'taverna', ts: Date.now() }, ...tavernas().filter(y => !same(x, y))].slice(0, 6))) } catch { /* sem armazenamento */ } }
export const dropTaverna = x => { try { localStorage.setItem(K, JSON.stringify(tavernas().filter(y => !same(x, y)))) } catch { /* sem armazenamento */ } }

// ---------- o batimento e o selo ----------
const ping = (url, init) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...init?.headers }, body: JSON.stringify({ playing: playing() }), ...init })
  .then(r => (r.ok ? r.json() : null)).catch(() => null)
const sum = xs => xs.reduce((a, x) => ({ unread: a.unread + (x?.unread || 0), at: a.at + (x?.at || 0), online: a.online + (x?.online || 0) }), { unread: 0, at: 0, online: 0 })
let last = { unread: 0, at: 0, online: 0 }
const subs = new Set()
// a própria Taverna, quando aberta, manda os números frescos (ao ler as mensagens o selo apaga-se logo)
export const setBadge = b => { last = { ...last, ...b }; subs.forEach(f => f(last)) }

export function useTavernaPulse(on = true) {
  const [b, setB] = useState(last)
  useEffect(() => { subs.add(setB); return () => { subs.delete(setB) } }, [])
  useEffect(() => {
    if (!on) return
    let off = false, t = 0
    const beat = async () => {
      const here = remoteOn() ? null : await ping('/api/taverna/ping')  // com a Taverna de um amigo aberta, o fetch daqui iria para lá
      const far = await Promise.all(tavernas().slice(0, 3).map(x => ping(`${x.base}/api/taverna/ping`, { headers: { Authorization: `Bearer ${x.token}` }, credentials: 'omit' })))
      if (off) return
      setBadge(sum([here?.member ? here : null, ...far.filter(x => x?.member)]))
      t = setTimeout(beat, here?.exists === false && !far.some(Boolean) ? 90000 : 25000)
    }
    t = setTimeout(beat, 1500)
    return () => { off = true; clearTimeout(t) }
  }, [on])
  return b
}

// ---------- texto das mensagens: @menções e #decks em pedaços (sem HTML: o React escreve texto) ----------
// -> [{ t: texto } | { at: nome, me } | { deck: id, name }]
export function pieces(m, { atn = [], me = '', decks = [] } = {}) {
  const keys = [...atn.map(n => ['@' + n, { at: n, me: n === me }]), ...decks.filter(d => d?.name).map(d => ['#' + d.name, { deck: d.id, name: d.name }])]
    .sort((a, b) => b[0].length - a[0].length)
  const out = []
  let s = String(m || '')
  while (s) {
    let best = null
    const low = s.toLowerCase()
    for (const [k, v] of keys) { const i = low.indexOf(k.toLowerCase()); if (i >= 0 && (!best || i < best[0])) best = [i, k, v] }
    if (!best) { out.push({ t: s }); break }
    if (best[0]) out.push({ t: s.slice(0, best[0]) })
    out.push(best[2]); s = s.slice(best[0] + best[1].length)
  }
  return out
}
