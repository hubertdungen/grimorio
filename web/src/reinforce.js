import { roleQuality } from './autobuild.js'
// 💪 Reforçar o deck: escolhem-se as funções de que o deck precisa mais (remoção, ramp, terrenos…) e, por função, as melhores
// cartas novas (recommend: plano, tribo, comandante, combos, EDHREC, orçamento), cada uma com a carta que sai: a mais fraca
// do deck pelas funções (deckCuts) e pelo histórico dos testes (quem ganha menos quando aparece sai primeiro).
import { recommend, deckCuts, termMatch, TAG_LABEL } from './data.js'
import { recommendLands, reanimTargets } from './mana.js'
import { maxCopies, subsOf } from './formats.js'
import { wrDelta } from './tests.js'
import { tx } from './i18n.js'

// as funções que se podem reforçar (etiquetas de TAG_LABEL; 'land' = mais terrenos)
export const REFORCO = ['removal', 'wipe', 'ramp', 'draw', 'counter', 'protection', 'recursion', 'tutor', 'land', 'creature', 'wincon',
  'tokens', 'counters', 'evasion', 'sacrifice', 'lifegain', 'reanimate', 'burn', 'discard', 'selection']

// tem/alvo por função: alvos do formato e do plano (targetsFor → needs); terrenos pelo MV médio (manaNeeds)
export function roleState(tags, needs, N, fmt) {
  return REFORCO.map(t => {
    const have = t === 'land' ? N?.lands ?? tags.land ?? 0 : tags[t] || 0
    const target = t === 'land' ? N?.target ?? null : needs[t]?.[1] ?? fmt?.targets?.[t] ?? null
    return { t, have, target, low: target != null && have < target }
  })
}

// o que os jogos gravados dizem de uma carta: diferença de % de vitórias quando passou pela mão (3+ jogos exatos, vista 2+)
export function cardHistory(ev, n) {
  const x = ev?.cards?.[n]
  if (!x || (ev.exact || 0) < 3 || (x.seen || 0) < 2) return null
  return { d: wrDelta(ev, x), seen: x.seen, won: x.seenW || 0 }
}
const HIST_W = 1.2  // −10 pontos de % de vitórias valem tanto como 0,12 de encaixe pelo texto

// Fila de cortes: as cartas do deck que não são terrenos, da mais fraca para a mais forte. Nunca o comandante, a assinatura
// nem os alvos de reanimação; as sementes, as peças centrais do arquétipo e quem ganha nos testes já ficam de fora em deckCuts.
// prot: porque só sai se não houver outra (subcomandante ★ tema essencial), as funções vêem-se ao escolher (pickCut).
export function cutQueue(data, deck, { ctx, co = null, commanders = [], needs = {}, recs = [], meta = null, archetype = null }) {
  const ev = ctx?.tests
  const keep = new Set([...(deck.commanders || []), ...(deck.signature ? [deck.signature] : []), ...reanimTargets(data, deck)])
  const subs = new Set(subsOf(deck)), terms = (deck.seedTerms || []).filter(t => t.k !== 'arch'), stars = terms.filter(t => t.s)
  const out = []
  for (const x of deckCuts(data, deck, { ctx, co, commanders, needs, recs, meta, archetype, every: true })) {
    const c = x.c
    if (keep.has(c.n) || !deck.main[c.n]) continue
    const h = cardHistory(ev, c.n)
    const why = x.why.filter(w => !w.startsWith(tx('Mas'))).slice(0, 2)
    if (h && h.d <= -0.04) why.unshift(tx('Testes: ganhou {p}% menos quando apareceu ({w} de {n} jogos)', { p: Math.round(-h.d * 100), w: h.won, n: h.seen }))
    else if (h && h.d >= 0.04) why.push(tx('Mas nos testes ganhou {p}% mais quando apareceu', { p: Math.round(h.d * 100) }))
    if (!why.length) why.push(tx('A que menos encaixa no plano do deck, entre as que podem sair'))
    const star = stars.find(t => termMatch(c, t))
    const theme = terms.filter(t => termMatch(c, t)).length  // serve o tema escrito do deck (Pirate, Flying…): fica antes das outras
    out.push({ c, score: x.fit + (h ? HIST_W * h.d : 0) + 0.15 * Math.min(2, theme), why, hist: h, prot: subs.has(c.n) ? 'sub' : star ? 'star' : null })
  }
  return out.sort((a, b) => a.score - b.score)
}

// a melhor carta a sair para dar lugar a uma de função t: nem uma que também faz t ou outra função escolhida, nem uma que
// deixe uma função abaixo do alvo (cnt: contagens correntes, já com as trocas anteriores) — salvo se não houver mais nenhuma.
// left: cópias que ainda podem sair de cada carta; keep: peças de combo das cartas que entram (não se corta a outra metade)
function pickCut(queue, left, keep, t, roles, needs, cnt, q, full) {
  const lowOf = x => x.c.tg.find(g => needs[g] && (cnt[g] || 0) - q < needs[g][1])
  const tier = x => {
    if (x.prot === 'sub') return 3
    const low = lowOf(x)
    if (x.prot === 'star' || low || x.c.tg.some(g => roles.includes(g))) return 1 + (low ? 1 : 0)
    return 0
  }
  let best = null, bt = 9
  for (const x of queue) {
    if (!(left.get(x.c.n) > 0) || keep.has(x.c.n) || x.c.tg.includes(t)) continue
    const k = tier(x) + (left.get(x.c.n) < full.get(x.c.n) ? 0.5 : 0)  // nos de 60: outra carta antes de mais uma cópia da mesma
    if (k < bt) { best = x; bt = k; if (!k) break }  // a fila já vem ordenada: a primeira livre é a mais fraca
  }
  if (!best) return null
  const low = lowOf(best)
  bt = Math.floor(bt)
  const warn = bt === 3 ? tx('É subcomandante: só porque não há outra que possa sair')
    : low ? tx('Fica abaixo do alvo de {t}: só porque não há outra que possa sair', { t: (TAG_LABEL[low] || low).toLowerCase() })
      : bt ? tx('Não há outra que possa sair sem tirar uma função escolhida ou um tema ★') : null
  return { x: best, warn }
}

// Plano: por função escolhida, até `per` linhas { t, add: {c, why[]}, q, cut: {c, why[], hist, warn} | null }.
// rq: os argumentos de recommend do deck (useDeckRecs); N: manaNeeds. Sem carta a sair, a linha só fica com o deck abaixo do
// tamanho do formato («Só juntar»). Nos formatos de 60, cópias: até ao que falta para o alvo (máx. as cópias da que sai).
export function reinforcePlan(data, deck, fmt, { roles = [], rq, N, needs = {}, tags = {}, ctx, co = null, commanders = [], meta = null, archetype = null, recs = [], intent = [], per = 4, queue = null }) {
  if (!roles.length || !rq) return []
  const Q = queue || cutQueue(data, deck, { ctx, co, commanders, needs, recs, meta, archetype })
  const total = Object.values(deck.main).reduce((a, q) => a + q, 0) + (deck.commanders?.length || 0)
  let room = Math.max(0, (fmt.size?.[0] || 0) - total)  // lugares livres até ao tamanho mínimo
  const full = new Map(Q.map(x => [x.c.n, deck.main[x.c.n] || 0])), left = new Map(full), keep = new Set(), cnt = { ...tags }, taken = new Set(Object.keys(deck.main)), out = []
  const { cards, combos, combosByCard } = data
  for (const t of roles) {
    const adds = t === 'land'
      ? recommendLands(data, { deck, fmt, ctx: rq.ctx, co, meta, need: N, limit: per * 3, terms: intent }).map(r => ({ c: r.c, why: r.why.map(w => w.txt) }))
      // a qualidade na função manda (custo, popularidade, decks reais); o tema só desempata até 0,25 — pedir «remoção» num
      // deck de piratas traz boa remoção (de preferência pirata), e não um pirata que remove mal
      : recommend(data, { ...rq, filters: { ...(rq.filters || {}), tag: t }, limit: per * 6 }).filter(r => r.c.tg.includes(t))
        .sort((a, b) => roleQuality(b, rq.prefs?.staples !== false, rq.prefs?.cmdEdh !== false) - roleQuality(a, rq.prefs?.staples !== false, rq.prefs?.cmdEdh !== false))
        .slice(0, per * 3).map(r => ({ c: r.c, why: r.why.map(w => w.txt) }))
    const target = t === 'land' ? N?.target : needs[t]?.[1]
    const rows = []
    let landsIn = 0
    for (const a of adds) {
      if (rows.length >= per) break
      if (taken.has(a.c.n)) continue
      for (const k of combosByCard?.[a.c.i] || []) for (const j of combos[k][1]) keep.add(cards[j].n)
      const have = t === 'land' ? (N?.lands || 0) + landsIn : cnt[t] || 0
      const gap = target != null ? target - have : 0
      let q = fmt.copies === 1 ? 1 : Math.max(1, Math.min(maxCopies(a.c, fmt, ctx?.bit ?? -1), gap > 0 ? gap : 1, 4))
      const pick = pickCut(Q, left, keep, t, roles, needs, cnt, q, full)
      if (pick) q = Math.min(q, left.get(pick.x.c.n))
      else if (room <= 0) continue
      else { q = Math.min(q, room); room -= q }
      taken.add(a.c.n)
      if (pick) { left.set(pick.x.c.n, left.get(pick.x.c.n) - q); for (const g of pick.x.c.tg) cnt[g] = (cnt[g] || 0) - q }
      for (const g of a.c.tg) cnt[g] = (cnt[g] || 0) + q
      if (t === 'land') landsIn += q
      rows.push({ t, add: a, q, cut: pick ? { c: pick.x.c, why: pick.x.why, hist: pick.x.hist, warn: pick.warn } : null })
    }
    out.push({ t, rows })
  }
  return out
}
