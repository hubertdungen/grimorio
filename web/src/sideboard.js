// Sideboard entre jogos de uma série: responde ao que o adversário jogou de facto (jogos exatos, pesado pela
// frequência) e ao que nos tirou vida; sai primeiro o que ficou preso na mão. O histórico penaliza trocas que já perderam.
import { HATE, CAT_LABEL, profile, stuckIn } from './tests.js'
import { tx } from './i18n.js'

const tally = pairs => { const m = {}; for (const [n, x] of pairs) m[n] = (m[n] || 0) + x; return m }

export function planSideboard(data, deck, opp, lastGames, history, max = 5, noAi = []) {  // noAi: cartas que a IA do Forge nunca lança (AI:RemoveDeck:All)
  const pl = profile(data, opp)
  const exact = lastGames.filter(g => g.exact)
  // o que lançou nos jogos exatos (cada lançamento conta) e o dano por carta em todos os jogos
  const pc = profile(data, { main: tally(exact.flatMap(g => (g.summary?.b?.cast || []).map(([, n]) => [n, 1]))) })
  const ph = profile(data, { main: tally(lastGames.flatMap(g => Object.entries(g.summary?.b?.damage_by_card || {}))) })
  const sh = (p, k) => (p.total ? p[k] / p.total : 0)
  const seen = pc.total >= 3 // jogou o suficiente para valer mais do que a lista
  const share = k => (seen ? 0.65 * sh(pc, k) + 0.35 * sh(pl, k) : sh(pl, k)) + 0.15 * sh(ph, k)
  const cand = []
  for (const [n, q] of Object.entries(deck.side || {})) {
    const c = data.byName.get(n); if (!c || noAi.includes(n)) continue  // ficava parada na mão
    let best = null
    for (const [k, re, label] of HATE) if (re.test(c.o) && (!best || share(k) >= best.v)) best = { v: share(k), label, k }
    if (!best || best.v < 0.12) continue
    const k = best.k, src = seen && pc[k] ? tx('lançou {n} {c}', { n: pc[k], c: CAT_LABEL[k] }) : tx('o adversário tem {p}% de {c}', { p: Math.round(sh(pl, k) * 100), c: CAT_LABEL[k] })
    cand.push({ n, q, v: best.v, why: `${best.label} (${src}${ph[k] ? tx('; tiraram-te {n} de vida', { n: ph[k] }) : ''})` })
  }
  const lost = new Set((history || []).filter(h => h.winner === 'b').flatMap(h => JSON.parse(h.a_side_in || '[]')))
  for (const x of cand) if (lost.has(x.n)) { x.v *= 0.6; x.why += tx(' · já perdeu com esta troca, vale menos') }
  cand.sort((a, b) => b.v - a.v)
  // jogada = lançada ou usada de outra forma (uma criatura reanimada nunca é «lançada»)
  const cast = new Set(lastGames.flatMap(g => [...(g.events || []).filter(e => e.p === 'a' && e.k === 'cast').map(e => e.card),
    ...(g.summary?.a?.used || [])]))
  // nos jogos exatos só conta como parada a carta que chegou à mão: não a comprar não diz nada sobre ela
  const drawn = new Set(exact.flatMap(g => (g.events || []).flatMap(e => e.hd?.a || [])))
  const idle = n => !cast.has(n) && (!exact.length || drawn.has(n))
  const stuck = tally(exact.flatMap(g => stuckIn(g, 2).map(n => [n, 1])))
  const outs = Object.entries(deck.main).map(([n, q]) => ({ n, q, c: data.byName.get(n) })).filter(x => x.c && x.c.mt !== 'Land')
    .map(x => {
      let v = stuck[x.n] ? 0.4 + 0.1 * stuck[x.n] : idle(x.n) ? 0.3 : 0
      if (x.c.cmc >= 5) v += 0.15
      if (x.c.tg.includes('removal') && share('creatures') < 0.25) v += 0.3
      if (x.c.tg.includes('counter') && share('spells') < 0.2) v += 0.2
      return { ...x, v }
    }).filter(x => x.v > 0).sort((a, b) => b.v - a.v)  // só sai com uma razão; o resto é o plano do deck (ex.: as auras de um voltron)
  const swaps = []
  for (const x of cand) {
    if (swaps.length >= max) break
    const o = outs.shift(); if (!o) break
    const k = Math.min(x.q, o.q, 2)
    swaps.push({ in: x.n, out: o.n, q: k, why: x.why,
      outWhy: stuck[o.n] ? (stuck[o.n] > 1 ? tx('ficou presa na mão em {n} jogos', { n: stuck[o.n] }) : tx('ficou presa na mão')) : idle(o.n) ? tx('não chegou a ser jogada') : o.c.cmc >= 5 ? tx('cara para este confronto') : tx('sem alvos neste confronto') })
  }
  return swaps
}

export const applySwaps = (deck, swaps) => {
  const main = { ...deck.main }, side = { ...deck.side }
  for (const s of swaps) {
    main[s.out] -= s.q; if (main[s.out] <= 0) delete main[s.out]
    main[s.in] = (main[s.in] || 0) + s.q
    side[s.in] -= s.q; if (side[s.in] <= 0) delete side[s.in]
    side[s.out] = (side[s.out] || 0) + s.q
  }
  return { ...deck, main, side }
}
