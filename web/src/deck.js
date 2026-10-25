// Modelo do deck, estatísticas, importação e exportação de listas.
import { tx } from './i18n.js'

export const emptyDeck = (format = 'commander') => ({
  id: null, name: tx('Deck sem nome'), format, commanders: [], signature: null,
  main: {}, side: {}, maybe: {}, seeds: [], notes: '', // maybe: maybeboard, fora da legalidade, estatísticas e testes
  groups: [], // secções propostas pela IA: [{nome, cartas: [nome]}]
  prints: {}, // nome -> impressão escolhida {id, set, cn, eur, eurFoil, foil, style}
  // art: {nome: link https da imagem escolhida no site de origem (TappedOut)}; source: link do deck no site
})

// link do site de onde o deck veio (campo source, ou as notas «Importado de X: link» / «Origem: link» dos decks antigos)
export const sourceOf = deck => deck.source || (deck.notes || '').match(/(?:Importado de [^:\n]+|Imported from [^:\n]+|Origem|Source): (https?:\/\/[^\s)]+)/)?.[1] || ''

export const count = zone => Object.values(zone).reduce((s, q) => s + q, 0)

export function deckIndices(deck, data) {
  return [...deck.commanders, deck.signature, ...Object.keys(deck.main)]
    .map(n => n && data.byName.get(n)).filter(Boolean).map(c => c.i)
}

export function stats(deck, data) {
  const curve = Array(8).fill(0)
  const types = {}, tags = {}, pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, sources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  let lands = 0, spells = 0, mvSum = 0, price = 0, cheapRampDraw = 0, missingPrice = 0
  const entries = [...Object.entries(deck.main), ...deck.commanders.map(n => [n, 1]), ...(deck.signature ? [[deck.signature, 1]] : [])]
  for (const [n, q] of entries) {
    const c = data.byName.get(n)
    if (!c) continue
    types[c.mt] = (types[c.mt] || 0) + q
    for (const t of c.tg) tags[t] = (tags[t] || 0) + q
    const pr = deck.prints?.[n]
    const p = (pr && (pr.foil ? pr.eurFoil ?? pr.eur : pr.eur ?? pr.eurFoil)) ?? c.eur ?? c.usd
    if (p == null) missingPrice += q; else price += p * q
    if (c.mt === 'Land') {
      lands += q
      const prod = c.o.match(/\{[WUBRGC]\}/g) || []
      const any = /any color|any one color|mana of any/i.test(c.o) && !/luck counter/i.test(c.o) && (deck.commanders?.length || !/commander's color identity/i.test(c.o))
      for (const k of Object.keys(sources)) if (any || prod.includes(`{${k}}`) || (c.t.includes('Basic') && basicColor(c.n) === k)) sources[k] += q
      continue
    }
    spells += q
    mvSum += c.cmc * q
    curve[Math.min(7, Math.floor(c.cmc))] += q
    if (c.cmc <= 2 && (c.tg.includes('ramp') || c.tg.includes('draw'))) cheapRampDraw += q
    for (const m of (c.mc || '').matchAll(/\{([^}]+)\}/g)) for (const ch of m[1]) if (ch in pips) pips[ch] += q
  }
  return { curve, types, tags, pips, sources, lands, spells, avgMv: spells ? mvSum / spells : 0, price, missingPrice, cheapRampDraw }
}

const basicColor = n => ({ Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' })[n.replace('Snow-Covered ', '')]

// Aceita listas do Arena, Moxfield, MTGO, Archidekt: "4 Lightning Bolt", "1x Sol Ring (CMR) 263 *F*", "SB: 2 Duress".
export function parseList(text, data) {
  const out = { commanders: [], main: {}, side: {}, maybe: {}, unknown: [], printRefs: [] }
  let zone = 'main'
  for (let raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      if (!line && zone === 'cmdhdr') zone = 'main'
      continue
    }
    const hdr = line.toLowerCase().replace(/[:\s]+$/, '')
    if (/^(commander|comandante|commanders)( \(\d+\))?$/.test(hdr)) { zone = 'cmdhdr'; continue }
    if (/^(deck|main|maindeck|mainboard|baralho)( \(\d+\))?$/.test(hdr)) { zone = 'main'; continue }
    if (/^(sideboard|side|banquinho)( \(\d+\))?$/.test(hdr)) { zone = 'side'; continue }
    if (/^(maybeboard|maybe|considering)( \(\d+\))?$/.test(hdr)) { zone = 'maybe'; continue }
    if (/^(companion|tokens?)( \(\d+\))?$/.test(hdr)) { zone = 'skip'; continue }
    let z = zone
    if (/^sb:\s*/i.test(line)) { z = 'side'; line = line.replace(/^sb:\s*/i, '') }
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i)
    let q = 1, name = line
    if (m) { q = +m[1]; name = m[2] }
    const foil = /\s\*(F|E)\*$/.test(name)
    name = name.replace(/\s+\*[A-Z]+\*$/, '').replace(/\s+#.*$/, '').trim()
    const ed = name.match(/\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\w★-]+))?$/)
    if (ed) name = name.slice(0, ed.index).trim()
    if (z === 'skip') continue
    const c = data.byLower.get(name.toLowerCase()) || data.byLower.get(name.split(' / ')[0].toLowerCase())
    if (!c) { out.unknown.push(name); continue }
    if (ed && ed[2]) out.printRefs.push({ name: c.n, set: ed[1].toUpperCase(), cn: ed[2], foil })
    if (z === 'cmdhdr') out.commanders.push(c.n)
    else { const tgt = out[z === 'side' || z === 'maybe' ? z : 'main']; tgt[c.n] = (tgt[c.n] || 0) + q }
  }
  return out
}

// Com estilo escolhido sai "1 Sol Ring (CMR) 263 *F*", que o Moxfield, o Archidekt e o Arena percebem.
// Cópias divididas por várias artes (deck.split) saem numa linha por arte; as que sobram ficam com a edição principal.
export function exportList(deck) {
  const one = (n, q, pr) => `${q} ${n}${pr?.set ? ` (${pr.set}) ${pr.cn}` : ''}${pr?.foil ? ' *F*' : ''}`
  const ln = (n, q) => {
    const pr = deck.prints?.[n], sp = deck.split?.[n]
    if (!sp?.length) return one(n, q, pr)
    let left = q
    const out = sp.map(x => { const k = Math.min(x.q, left); left -= k; return k ? one(n, k, x) : null }).filter(Boolean)
    if (left > 0) out.push(one(n, left, pr))
    return out.join('\n')
  }
  const lines = []
  if (deck.commanders.length) lines.push('Commander', ...deck.commanders.map(n => ln(n, 1)), '')
  if (deck.signature) lines.push('Signature Spell', ln(deck.signature, 1), '')
  lines.push('Deck', ...Object.entries(deck.main).sort(([a], [b]) => a.localeCompare(b)).map(([n, q]) => ln(n, q)))
  if (count(deck.side)) lines.push('', 'Sideboard', ...Object.entries(deck.side).map(([n, q]) => ln(n, q)))
  return lines.join('\n')
}

export function sampleHand(deck, size = 7) {
  const pool = []
  for (const [n, q] of Object.entries(deck.main)) for (let k = 0; k < q; k++) pool.push(n)
  for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]] }
  return pool.slice(0, size)
}

// Proxies: cada grupo de cópias com a mesma arte → { name, q, src } (src = id da edição, imagem própria ou null =
// a predefinida) e o verso das cartas de duas faces. Comandantes, deck e (opcional) sideboard.
export function proxyGroups(deck, data, { side = true } = {}) {
  const out = [], add = (n, q) => {
    const c = data.byName.get(n); if (!c || q <= 0) return
    const main = deck.art?.[n] || deck.prints?.[n]?.id || null
    let left = q
    for (const x of deck.split?.[n] || []) { const k = Math.min(x.q, left); left -= k; if (k) out.push({ c, q: k, src: x.id }) }
    if (left > 0) out.push({ c, q: left, src: main })
  }
  for (const n of deck.commanders || []) add(n, 1)
  if (deck.signature) add(deck.signature, 1)
  for (const [n, q] of Object.entries(deck.main || {})) add(n, q)
  if (side) for (const [n, q] of Object.entries(deck.side || {})) add(n, q)
  return out
}

// probabilidades de terrenos (hipergeométrica): N cartas, L terrenos. hist[k] = P(k terrenos na mão de 7);
// keep = P(2 a 4 na mão inicial); t3/t4 = P(ter a 3.ª/4.ª jogada de terreno a tempo, a jogar primeiro: 9/10 cartas vistas)
export function landOdds(N, L) {
  const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let j = 1; j <= k; j++) r = (r * (n - k + j)) / j; return r }
  const P = (n, k) => (N >= n ? (C(L, k) * C(N - L, n - k)) / C(N, n) : 0)
  const atLeast = (n, k) => { let s = 0; for (let j = k; j <= Math.min(n, L); j++) s += P(n, j); return s }
  const hist = Array.from({ length: 8 }, (_, k) => P(7, k))
  return { hist, keep: hist[2] + hist[3] + hist[4], t3: atLeast(9, 3), t4: atLeast(10, 4) }
}
