// Provas dos testes do Laboratório (sessões guardadas no deck): o que ficou morto na mão, o que pesou
// e o que o adversário jogou nos jogos que perdemos. Alimenta as sugestões, os cortes e o sideboard.
import { tx } from './i18n.js'

// Perfil de uma lista {main: {nome: peso}}: o peso pode ser cópias, vezes lançada ou dano.
export function profile(data, list) {
  const pr = { creatures: 0, artifacts: 0, enchantments: 0, spells: 0, graveyard: 0, lifegain: 0, flyers: 0, total: 0 }
  for (const [n, q] of Object.entries(list.main || {})) {
    const c = data.byName.get(n); if (!c || c.mt === 'Land') continue
    pr.total += q
    for (const k of catsOf(c)) pr[k] += q
  }
  return pr
}
export const catsOf = c => [c.mt === 'Creature' && 'creatures', /Artifact/.test(c.t) && 'artifacts', /Enchantment/.test(c.t) && 'enchantments',
  /Instant|Sorcery/.test(c.t) && 'spells', (c.tg.includes('graveyard') || c.tg.includes('recursion')) && 'graveyard',
  c.tg.includes('lifegain') && 'lifegain', c.kw.includes('Flying') && 'flyers'].filter(Boolean)
export const HATE = [
  ['artifacts', /destroy (target|all|each)[^.]*artifact|artifacts? (can't|cost)|exile target artifact/i, tx('remove artefactos')],
  ['enchantments', /destroy (target|all|each)[^.]*enchantment|exile target enchantment/i, tx('remove encantamentos')],
  ['graveyard', /exile (all|each)[^.]*graveyards?|target player's graveyard|card (from|in) (a|an opponent's) graveyard|search its owner's graveyard|graveyards? (can't|lose)|cards in graveyards can't/i, tx('castiga o cemitério')],
  ['spells', /counter target (spell|instant|sorcery|noncreature)|instant (and|or) sorcery spells? cost|nonland card from it|instant or sorcery card from it/i, tx('trava instantâneos e feitiços')],
  ['creatures', /counter target creature spell|destroy all creatures|damage to each creature|each creature gets -|destroy target creature|exile target creature/i, tx('trava criaturas')],
  ['flyers', /creature with flying|reach|destroy target creature with flying/i, tx('trava voadores')],
  ['lifegain', /can't gain life|life total can't|players can't gain/i, tx('corta o ganho de vida')],
]
export const CAT_LABEL = { creatures: tx('criaturas'), flyers: tx('criaturas voadoras'), artifacts: tx('artefactos'), enchantments: tx('encantamentos'), spells: tx('instantâneos e feitiços'), graveyard: tx('cemitério'), lifegain: tx('ganho de vida') }

// Jogo exato: quantos inícios de turno nossos cada carta passou na mão (o «hd» só vem quando muda).
export function heldTurns(g) {
  const out = {}
  let hand = []
  for (const e of g.events || []) {
    if (e.hd?.a) hand = e.hd.a
    if (e.k === 'turn' && e.p === 'a') for (const n of new Set(hand)) out[n] = (out[n] || 0) + 1
  }
  return out
}
// Cartas presas: na mão em `min` inícios de turno e nunca usadas no jogo.
export function stuckIn(g, min = 3) {
  const used = new Set(g.summary?.a?.used || [])
  return Object.entries(heldTurns(g)).filter(([n, t]) => t >= min && !used.has(n)).map(([n]) => n)
}

// games: [{winner, exact, events, summary}] → provas por carta e por categoria do adversário.
export function testEvidence(data, games) {
  const dead = {}, impact = {}, cats = {}
  let lost = 0, exact = 0
  for (const g of games) {
    const a = g.summary?.a || {}, b = g.summary?.b || {}
    if (g.winner && g.winner !== 'a' && g.winner !== 'draw') lost++  // com 3–4 jogadores ganha qualquer um dos outros
    for (const [, n] of a.cast || []) (impact[n] ||= { cast: 0, dmg: 0 }).cast++
    for (const [n, d] of [...Object.entries(a.damage_by_card || {}), ...Object.entries(a.damage_to_creatures || {})]) (impact[n] ||= { cast: 0, dmg: 0 }).dmg += d
    if (g.exact) {
      exact++
      const stuck = new Set(stuckIn(g))
      for (const n of Object.keys(heldTurns(g))) { const x = (dead[n] ||= { seen: 0, dead: 0 }); x.seen++; if (stuck.has(n)) x.dead++ }
    }
    // o que o adversário lançou de facto: «contra X» com 2+ cartas dessa categoria;
    // «perdeste contra X» se, além disso, X fez 30%+ do dano que levámos (o que nos matou)
    const per = {}, dmg = {}, hit = b.damage_by_card || {}
    const tot = Object.values(hit).reduce((s, v) => s + v, 0)
    for (const [, n] of b.cast || []) { const c = data.byName.get(n); if (c) for (const k of catsOf(c)) (per[k] ||= []).push(n) }
    for (const [n, d] of Object.entries(hit)) { const c = data.byName.get(n); if (c) for (const k of catsOf(c)) dmg[k] = (dmg[k] || 0) + d }
    for (const [k, ns] of Object.entries(per)) {
      if (ns.length < 2) continue
      const x = (cats[k] ||= { games: 0, lost: 0, cards: {} })
      x.games++
      if (g.winner !== 'a' && g.winner !== 'draw' && (!tot || (dmg[k] || 0) / tot >= 0.3)) { x.lost++; for (const n of ns) x.cards[n] = (x.cards[n] || 0) + 1 + (hit[n] || 0) / 5 }
    }
  }
  return { games: games.length, exact, lost, dead, impact, cats }
}

// Fator «testes» de uma candidata: responde a uma categoria com que perdemos 2+ jogos e metade ou mais.
export function testsBoost(c, T) {
  if (!T?.games) return null
  let best = null
  for (const [k, re] of HATE) {
    const x = T.cats[k]
    if (!x || x.lost < 2 || x.lost / x.games < 0.5 || !re.test(c.o)) continue
    const v = 0.1 * (x.lost / x.games) * Math.min(1, x.lost / 3)
    if (!best || v >= best.v) { // empate: ganha a categoria mais específica (voadores depois de criaturas)
      const top = Object.entries(x.cards).sort((p, q) => q[1] - p[1])[0]?.[0]
      best = { v, txt: tx('Testes: perdeste {a} de {n} jogos contra {c}{top}; isto responde', { a: x.lost, n: x.games, c: CAT_LABEL[k], top: top ? ` (${top})` : '' }) }
    }
  }
  return best
}

// Jogos do deck (Laboratório e torneios, o deck sempre no lado 'a'), os mais recentes primeiro.
// Servidor antigo sem /games: as últimas 8 sessões guardadas do Laboratório.
export async function loadGames(deckId, limit = 40) {
  const r = await fetch(`/api/decks/${deckId}/games?limit=${limit}`)
  if (r.status !== 404) { if (!r.ok) throw new Error(`games ${r.status}`); return r.json() }
  const list = await (await fetch(`/api/sim/runs?deck_id=${deckId}`)).json()
  const bodies = await Promise.all(list.slice(0, 8).map(x => fetch(`/api/sim/runs/${x.id}`).then(r => r.json()).catch(() => null)))
  return bodies.filter(Boolean).flatMap(b => (b.runs || []).flatMap(r => r.games || []))
}
export const loadTests = async (data, deckId) => testEvidence(data, await loadGames(deckId))

// Avisos de confiança nos testes: cartas que o Forge diz que a IA joga mal, decks de combo/reanimação
// (a IA não planeia vários turnos) e, com jogos exatos, cartas que ficaram presas na mão.
export function aiCaveats(data, deck, flags, games = []) {
  const names = [...(deck.commanders || []), ...Object.keys(deck.main || {})]
  const set = new Set(flags || [])
  const flagged = names.filter(n => set.has(n) || set.has(n.split(' // ')[0]))
  const cards = names.map(n => data.byName.get(n)).filter(Boolean), idx = new Set(cards.map(c => c.i))
  const reanim = cards.filter(c => c.tg.includes('reanimate')).length
  const combos = new Set(cards.flatMap(c => (data.combosByCard?.[c.i] || []).filter(k => data.combos[k][1].every(i => idx.has(i)))))
  const style = [reanim >= 2 && tx('reanimação'), combos.size > 0 && tx('combo ({n} no deck)', { n: combos.size })].filter(Boolean)
  const ev = games.length ? testEvidence(data, games) : null
  const unused = ev ? Object.entries(ev.dead).filter(([, x]) => x.dead >= 2 && x.dead / x.seen >= 0.5).sort((a, b) => b[1].dead - a[1].dead).map(([n, x]) => tx('{c} ({a} de {n})', { c: n, a: x.dead, n: x.seen })) : []
  return { flagged, style, unused }
}
