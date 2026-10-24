// Completar deck: rondas de sugestões sobre um deck simulado, para que cada carta escolhida
// influencie as seguintes. Ordem: funções em falta → sinergia (com teto na curva) → base de mana.
import { recommend, fmtBit, TAG_LABEL, detectArchetype, deckCombos, comboProb, comboTurn, deckPlan } from './data.js'
import { stats, count } from './deck.js'
import { landAdvice, maxCopies, targetsFor } from './formats.js'
import { manaNeeds, recommendLands, basicsFor } from './mana.js'

// Custo máximo por função: ramp caro já não é ramp.
const MAX_MV = { ramp: 3, draw: 5, removal: 4, counter: 3, protection: 3, creature: 6 }
const LOGR = Math.log(40000)
// Qualidade numa função: sinergia geral + popularidade + custo baixo + inclusão real nos decks do comandante.
function roleQuality(r) {
  const c = r.c
  return r.score + 0.15 * (c.er ? Math.max(0, 1 - Math.log(c.er) / LOGR) : 0) + (c.cmc <= 1 ? 0.1 : c.cmc <= 2 ? 0.08 : c.cmc <= 3 ? 0.03 : -0.05) + (r.parts?.decksReais || 0) * 0.5
}

export function autoBuild(data, deck, fmt, { ctx, co = null, bracket = null, meta = null, prefs = null, tastes = [] }) {
  const budget = prefs?.on && prefs.orcamento ? { priceMax: prefs.orcamento } : {}
  const deckSize = fmt.size[0] >= 99 ? 99 : Math.max(40, fmt.size[0] || 60), turn = comboTurn(fmt)
  const cmdIdx = deck.commanders.map(n => data.byName.get(n)?.i).filter(x => x != null)
  const sim = { ...deck, main: { ...deck.main } }
  const total = Math.max(fmt.size[0] || 60, 40)
  const current = () => count(sim.main) + sim.commanders.length + (sim.signature ? 1 : 0)
  if (current() >= total) return { adds: [], msg: `O deck já tem ${current()} cartas.` }
  const bit = fmtBit(data, fmt)
  // Sem comandante, escolhe as cores principais pelos símbolos das cartas iniciais: 2, ou 3 se a terceira pesar ≥25%.
  // As cartas iniciais fora dessas cores ficam (são tuas) mas é dito que pedem splash.
  let offColor = []
  if (!fmt.cmd && ctx.identity == null) {
    const w = {}
    for (const [n, q] of Object.entries(sim.main)) {
      const c = data.byName.get(n); if (!c || c.mt === 'Land') continue
      const pips = (c.mc || '').match(/\{[^}]*\}/g) || []
      for (const k of c.ci) w[k] = (w[k] || 0) + q * Math.max(1, pips.filter(p => p.includes(k)).length)
    }
    const order = Object.entries(w).sort((a, b) => b[1] - a[1])
    const tot = order.reduce((a, [, v]) => a + v, 0) || 1
    const main = order.slice(0, 2).map(([k]) => k)
    if (order[2] && order[2][1] / tot >= 0.25) main.push(order[2][0])
    if (main.length) {
      ctx = { ...ctx, identity: main.join('') }
      offColor = Object.keys(sim.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land' && ![...c.ci].every(k => main.includes(k))).map(c => c.n)
    }
  }
  const out = []
  const put = (c, q, group, why) => {
    const lim = maxCopies(c, fmt, bit)
    q = Math.min(q, lim - (sim.main[c.n] || 0), total - current())
    if (q <= 0) return 0
    sim.main[c.n] = (sim.main[c.n] || 0) + q
    const prev = out.find(x => x.c.i === c.i)
    if (prev) prev.q += q; else out.push({ c, q, group, why })
    return q
  }
  // Cópias: as das listas reais quando há meta (MTGTop8), senão pela regra do custo.
  const copiesFor = c => {
    if (fmt.copies === 1) return 1
    const m = meta?.byCard.get(c.i)
    if (m?.copies) return Math.max(1, Math.round(m.copies))
    return c.cmc >= 5 ? 2 : c.cmc >= 4 ? 3 : 4
  }

  // 1–2) feitiços, em rondas
  for (let round = 0; round < 14; round++) {
    const s = stats(sim, data)
    const landTarget = landAdvice(fmt, s.spells >= 10 ? s.avgMv : 3, s.cheapRampDraw)
    const spellRoom = total - current() - Math.max(0, landTarget - s.lands)
    if (spellRoom <= 0) break
    const have = [...cmdIdx, ...Object.keys(sim.main).map(n => data.byName.get(n)?.i).filter(x => x != null)]
    const seeds = [...cmdIdx, ...Object.keys(sim.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land').map(c => c.i).reverse()]
    if (!seeds.length) return { adds: [], msg: fmt.cmd ? 'Escolhe primeiro o comandante (ou junta umas cartas).' : 'Junta primeiro algumas cartas de que gostas.' }
    const needs = Object.fromEntries(Object.entries(targetsFor(fmt, deckPlan(data, have), prefs)).map(([t, n]) => [t, [s.tags[t] || 0, n]]))
    const gcCount = have.filter(i => data.cards[i].gc).length
    const archetype = detectArchetype(meta, have)
    const recs = recommend(data, { seeds, have, ctx, filters: { noLands: true, ...budget }, limit: 150, commanders: cmdIdx, needs, co, deckStats: s, bracket, gcCount, meta, archetype, prefs, tastes, deckSize, turn })
    if (!recs.length) break
    let room = Math.min(spellRoom, fmt.copies === 1 ? 10 : 12)
    const heavyCap = Math.ceil((s.spells + spellRoom) * 0.1)
    let heavy = Object.entries(sim.main).reduce((a, [n, q]) => a + ((data.byName.get(n)?.cmc ?? 0) >= 6 ? q : 0), 0)
    const taken = new Set()
    const take = (r, group, why) => {
      if (taken.has(r.c.i) || room <= 0) return
      if (r.c.cmc >= 6 && heavy >= heavyCap) return
      if (r.c.mt === 'Land') return
      if (r.c.tg.includes('hate')) return // fica para o sideboard
      const q = put(r.c, Math.min(copiesFor(r.c), room), group, why)
      if (q) { taken.add(r.c.i); room -= q; if (r.c.cmc >= 6) heavy += q }
    }
    // Funções em falta primeiro (até 3 por função e ronda). Cada função tem a sua pesquisa, ordenada
    // pela qualidade NESSA função: barata, muito jogada, presente nos decks do comandante.
    // défice relativo (falta/meta), e no construído uma carta (4 cópias) por função e ronda, para alternar entre funções
    for (const [t, [h, n]] of Object.entries(needs).sort((a, b) => (b[1][1] - b[1][0]) / b[1][1] - (a[1][1] - a[1][0]) / a[1][1])) {
      let k = fmt.copies === 1 ? Math.min(3, n - h) : Math.min(1, n - h)
      if (k <= 0 || room <= 0) continue
      const cand = recommend(data, { seeds, have, ctx, filters: { noLands: true, tag: t, cmcMax: MAX_MV[t] ?? '', ...budget }, limit: 40, commanders: cmdIdx, co, deckStats: s, bracket, gcCount, meta, archetype, prefs, tastes, deckSize, turn })
        .map(r => ({ r, q: roleQuality(r) })).sort((a, b) => b.q - a.q)
      for (const { r } of cand) {
        if (k <= 0 || room <= 0) break
        if (taken.has(r.c.i)) continue
        const why = r.why.filter(w => w.k !== 'falta').slice(0, 1).map(w => w.txt)
        take(r, `Função: ${TAG_LABEL[t]}`, [`${TAG_LABEL[t]} em falta (${h}/${n})`, r.c.cmc <= 2 ? `barata (MV ${r.c.cmc})` : '', ...why].filter(Boolean).join(' · '))
        k--
      }
    }
    for (const r of recs) { if (room <= 0) break; take(r, 'Sinergia', r.why.filter(w => w.k !== 'falta').slice(0, 2).map(w => w.txt).join(' · ') || r.why[0]?.txt) }
  }

  // 3) base de mana: terrenos sugeridos (cores em falta, ritmo, mecânica, dados) + básicos pela cor mais curta
  const landsLeft = total - current()
  if (landsLeft > 0) {
    const need = manaNeeds(data, { ...sim, main: { ...sim.main } }, fmt)
    // finge a base completa para medir as fontes contra o alvo final e não o parcial
    for (const x of Object.values(need.cols)) x.need = x.full
    const colors = Object.keys(need.cols)
    const share = fmt.copies === 1 ? [0.15, 0.15, 0.4, 0.55, 0.6, 0.6][colors.length] : [0.1, 0.1, 0.35, 0.5, 0.55, 0.55][colors.length]
    const nonbasic = Math.round(landsLeft * share)
    let k = 0
    for (const r of recommendLands(data, { deck: sim, fmt, ctx, co, meta, need, limit: 60 })) {
      if (k >= nonbasic) break
      if (r.score < 0.05) continue
      const q = put(r.c, fmt.copies === 1 ? 1 : Math.min(4, nonbasic - k), 'Terrenos', r.why.slice(0, 2).map(w => w.txt).join(' · ') || 'Produz as cores do deck')
      k += q
      for (const c of colors) if (r.land.any || r.land.colors.has(c) || r.land.colors.has('*')) need.cols[c].have += q
    }
    const rest = total - current()
    for (const [name, q] of Object.entries(basicsFor(data, need, rest, ctx.identity))) {
      const c = data.byName.get(name)
      if (c) put(c, q, 'Terrenos básicos', `Equilibra as fontes: ${Object.entries(need.cols).map(([x, v]) => `${x} ${v.have}/${v.full}`).join(', ')}`)
    }
  }
  // Combos do deck final e probabilidade de cada um até ao turno de referência.
  const finalIdx = [...cmdIdx, ...Object.keys(sim.main).map(n => data.byName.get(n)?.i).filter(x => x != null)]
  const cmdSet = new Set(cmdIdx)
  const tutors = finalIdx.filter(i => data.cards[i].tg.includes('tutor')).length
  const combos = deckCombos(data, finalIdx, ctx).full.slice(0, 8).map(({ cb }) => ({
    id: cb[0], cards: cb[1].map(i => data.cards[i].n), result: cb[2][0] || 'combo',
    p: comboProb({ pieces: cb[1].filter(x => !cmdSet.has(x)).length, tutors, deckSize, turn }),
  })).sort((a, b) => b.p - a.p)
  return { adds: out, msg: null, combos, tutors, turn, colors: ctx.identity, offColor }
}
