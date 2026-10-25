// Base de mana: equilíbrio de terrenos, fontes por cor e terrenos sugeridos pela mecânica do deck.
import { passes, PAIRS, RB, ROLE_LABEL, deadRefsN, deckReps } from './data.js'
import { stats } from './deck.js'
import { landAdvice } from './formats.js'
import { tx, num } from './i18n.js'

const COLS = 'WUBRG'
const BASIC_OF = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

/** O que um terreno faz: cores, se entra virado, fetch, manland e funções extra. cmd: o deck tem comandante. */
export function landInfo(c, cmd = true) {
  const o = c.o.toLowerCase()
  // Command Tower sem comandante não dá cor; Gemstone Caverns só com o marcador de sorte (quase nunca)
  const any = /any color|any one color|mana of any type|mana of any one color/.test(o) && !/luck counter/.test(o) && (cmd || !/commander's color identity/.test(o))
  const colors = new Set()
  for (const k of COLS) if (c.o.includes(`{${k}}`)) colors.add(k)
  for (const [t, k] of Object.entries(BASIC_OF)) if (c.t.includes(t)) colors.add(k)
  const fetch = /search your library for (a|an|up to \w+)[^.]*(land|plains|island|swamp|mountain|forest)/.test(o) && /sacrifice/.test(o)
  if (fetch) {
    for (const [t, k] of Object.entries(BASIC_OF)) if (o.includes(t.toLowerCase())) colors.add(k)
    if (/basic land/.test(o) && !colors.size) colors.add('*')
  }
  const tappedAlways = /enters (the battlefield )?tapped\.?/.test(o) && !/unless|you may pay \d+ life|if you control|if it's not your first/.test(o)
  const tappedCond = /enters (the battlefield )?tapped/.test(o) && !tappedAlways
  const util = []
  if (/becomes? an? [^.]*creature/.test(o)) util.push(tx('vira criatura (manland)'))
  if (/draw (a|two) cards?/.test(o)) util.push(tx('compra cartas'))
  if (/(destroy|exile) target/.test(o)) util.push(tx('remove ameaças'))
  if (/scry|surveil/.test(o)) util.push(tx('filtra o topo'))
  if (/hexproof|indestructible|shroud/.test(o)) util.push(tx('protege'))
  if (/add \{c\}\{c\}|twice that much|additional/.test(o) && !any) util.push(tx('mana a mais'))
  // tapped: identificador interno ('sim' | 'às vezes' | 'não'), não se mostra
  return { any, colors, fetch, tapped: tappedAlways ? 'sim' : tappedCond ? 'às vezes' : 'não', util }
}

// Fontes recomendadas por cor (aprox. Karsten), consoante o maior número de símbolos dessa cor num só custo.
// terreno que só dá cores que o deck não usa (Arid Mesa num deck UB)
export const offColorLand = (L, cols) => !L.any && !L.colors.has('*') && L.colors.size > 0 && ![...L.colors].some(k => cols.includes(k))

const SRC = { 100: [0, 16, 22, 27], 60: [0, 13, 18, 22], 40: [0, 8, 11, 13] }

/** Necessidades de mana do deck: terrenos alvo, fontes por cor (tem/precisa), terrenos virados. */
// Deck de reanimação (tem cartas «reanimate»): as criaturas grandes (MV ≥ 6 ou poder ≥ 6) vêm do cemitério, não se
// lançam — não contam para as cores nem para o custo médio (que decide quantos terrenos)
export function reanimTargets(data, deck) {
  const cs = Object.keys(deck.main || {}).map(n => data.byName.get(n)).filter(Boolean)
  if (!cs.some(c => c.tg?.includes('reanimate'))) return new Set()
  return new Set(cs.filter(c => c.mt === 'Creature' && ((parseInt(c.pt) || 0) >= 6 || c.cmc >= 6)).map(c => c.n))
}

export function manaNeeds(data, deck, fmt) {
  const RT = reanimTargets(data, deck)
  const s0 = stats(RT.size ? { ...deck, main: Object.fromEntries(Object.entries(deck.main).filter(([n]) => !RT.has(n))) } : deck, data)
  const s = RT.size ? { ...s0, spells: s0.spells + [...RT].reduce((a, n) => a + deck.main[n], 0) } : s0  // o deck tem o mesmo tamanho
  const total = Math.max(fmt.size[0] || 60, 40)
  const table = total >= 99 ? SRC[100] : total >= 60 ? SRC[60] : SRC[40]
  const target = landAdvice(fmt, s.spells >= 10 ? s.avgMv : 3, s.cheapRampDraw)
  const maxPips = Object.fromEntries([...COLS].map(k => [k, 0]))
  const sources = Object.fromEntries([...COLS].map(k => [k, 0]))
  const deckColors = new Set()
  for (const n of [...Object.keys(deck.main), ...deck.commanders]) for (const k of data.byName.get(n)?.ci || '') deckColors.add(k)
  let tapped = 0
  const entries = [...Object.entries(deck.main), ...deck.commanders.map(n => [n, 1])]
  for (const [n, q] of entries) {
    const c = data.byName.get(n)
    if (!c || RT.has(n)) continue
    if (c.mt === 'Land') {
      const L = landInfo(c, deck.commanders.length > 0)
      if (L.tapped === 'sim') tapped += q
      for (const k of COLS) if (L.any || L.colors.has(k) || (L.colors.has('*') && deckColors.has(k))) sources[k] += q
      continue
    }
    for (const part of (c.mc || '').split('//')) for (const k of COLS) {
      const m = (part.match(new RegExp(`\\{${k}\\}`, 'g')) || []).length + (part.match(new RegExp(`\\{[^}]*${k}[^}]*/[^}]*\\}|\\{[^}]*/[^}]*${k}[^}]*\\}`, 'g')) || []).length * 0.5
      maxPips[k] = Math.max(maxPips[k], Math.min(3, Math.ceil(m)))
    }
  }
  const cols = {}
  for (const k of COLS) {
    if (!maxPips[k] && !s.pips[k]) continue
    // escala o alvo de fontes à proporção de terrenos que o deck já tem face ao alvo
    const need = Math.round(table[Math.max(1, maxPips[k])] * Math.min(1, s.lands / Math.max(1, target)))
    cols[k] = { have: sources[k], need: Math.max(1, need), full: table[Math.max(1, maxPips[k])], pips: s.pips[k], maxPips: maxPips[k] }
  }
  const progress = Math.min(1, (s.spells + s.lands + deck.commanders.length) / total)
  const expectedNow = Math.round(target * progress)
  return { s, total, target, lands: s.lands, expectedNow, deficit: expectedNow - s.lands, cols, tapped, fast: s.spells >= 10 && s.avgMv < 2.6 }
}

const LOGR = Math.log(40000)

/**
 * Terrenos sugeridos: corrigem as cores que faltam, entram destapados quando o deck é rápido,
 * e têm mecânica que encaixa no deck (fichas, sacrifício, landfall, cemitério…).
 */
export function recommendLands(data, { deck, fmt, ctx, co = null, meta = null, need = null, limit = 12 }) {
  const { cards } = data
  const N = need || manaNeeds(data, deck, fmt)
  const haveIdx = [...deck.commanders, ...Object.keys(deck.main)].map(n => data.byName.get(n)?.i).filter(x => x != null)
  const haveSet = new Set(haveIdx)
  const byRole = Object.fromEntries(Object.keys(RB).map(r => [r, haveIdx.filter(i => cards[i].ro & RB[r] && cards[i].mt !== 'Land')]))
  const deckCols = Object.keys(N.cols)
  const landfall = byRole.landfall.length, gy = byRole.recursion.length
  const deckCards = haveIdx.map(i => cards[i]), reps = deckReps(deckCards), cmd = deck.commanders.length > 0
  const out = []
  for (const c of cards) {
    if (c.mt !== 'Land' || haveSet.has(c.i) || /\bBasic\b/.test(c.t)) continue
    if (!passes(c, null, ctx)) continue
    if (ctx.identity == null && deckCols.length && c.ci && ![...c.ci].every(k => deckCols.includes(k))) continue
    const L = landInfo(c, cmd)
    if (deckCols.length && offColorLand(L, deckCols)) continue
    if (deadRefsN(c, deckCards, reps).length) continue  // Villainous Hideout sem Villains: a mana dela não serve ao deck
    const why = [], P = {}
    // 1) cores que faltam
    const gives = L.any || L.colors.has('*') ? deckCols : deckCols.filter(k => L.colors.has(k))
    let fix = 0
    const short = []
    for (const k of gives) {
      const x = N.cols[k]
      const gap = Math.max(0, x.full - x.have) / x.full
      fix += gap
      if (x.have < x.need) short.push(`${k} ${x.have}/${x.need}`)
    }
    P.cores = Math.min(0.4, 0.22 * fix) + (gives.length >= 2 ? 0.04 : 0)
    if (short.length) why.push({ k: 'falta', txt: tx('Dá {c}, cores com fontes a menos ({s})', { c: gives.join('/'), s: short.join(', ') }) })
    else if (gives.length >= 2) why.push({ k: 'tema', txt: tx('Dá {c}', { c: gives.join('/') }) })
    if (deckCols.length >= 3 && !gives.length && !L.any) { P.cores -= 0.1; why.push({ k: 'perto', txt: tx('Só dá mana incolor num deck de várias cores') }) }
    // 2) ritmo: virado ou destapado
    P.ritmo = L.tapped === 'sim' ? (N.fast ? -0.15 : -0.06) : L.tapped === 'às vezes' ? -0.01 : 0.03
    if (L.tapped === 'não' && gives.length >= 2) why.push({ k: 'tema', txt: tx('Entra destapada') })
    if (L.tapped === 'sim' && N.fast) why.push({ k: 'perto', txt: tx('Entra virada num deck rápido') })
    // 3) mecânica com o deck
    let mech = 0
    for (const [a, b] of PAIRS) {
      if (c.ro & RB[a] && byRole[b].length) { mech += 0.06; why.push({ k: 'inter', txt: tx('Alimenta {names}, que {role}', { names: byRole[b].slice(0, 2).map(i => cards[i].n).join(', ') + (byRole[b].length > 2 ? ` (+${byRole[b].length - 2})` : ''), role: ROLE_LABEL[b] }) }) }
      else if (c.ro & RB[b] && byRole[a].length >= 2) { mech += 0.05; why.push({ k: 'inter', txt: tx('Aproveita {names}, que {role}', { names: byRole[a].slice(0, 2).map(i => cards[i].n).join(', '), role: ROLE_LABEL[a] }) }) }
    }
    if (L.fetch && (landfall || gy)) { mech += 0.08; why.push({ k: 'inter', txt: landfall ? tx('Fetch: ativa o landfall de {c}', { c: byRole.landfall.slice(0, 2).map(i => cards[i].n).join(', ') }) : tx('Fetch: ativa o cemitério') }) }
    if (L.util.length) { mech += 0.02 * L.util.length; why.push({ k: 'tema', txt: tx('Utilidade: {u}', { u: L.util.join(', ') }) }) }
    P.mecanica = Math.min(0.2, mech)
    // 4) dados reais
    P.dados = 0
    const e = co?.get(c.i)?.find(x => x.kind === 'commanders')
    if (e) { P.dados += 0.3 * e.incl + 0.2 * Math.max(0, e.syn); why.push({ k: 'edh', txt: tx('Em {p}% dos decks de {c}', { p: Math.round(e.incl * 100), c: e.from }) }) }
    const m = meta?.byCard.get(c.i)
    if (m) { P.dados += 0.3 * Math.min(1, m.incl * 2.5); why.push({ k: 'meta', txt: tx('Em {p}% dos decks de {f} (≈{q} cópias)', { p: Math.round(m.incl * 100), f: meta.fmtName, q: num(m.copies, 1) }) }) }
    P.popular = c.er ? 0.05 * Math.max(0, 1 - Math.log(c.er) / LOGR) : 0
    const score = Object.values(P).reduce((a, b) => a + b, 0)
    if (score <= 0.02 && !why.length) continue
    out.push({ c, score, parts: P, why: why.slice(0, 4), land: L })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

/** Básicos para completar: um a um para a cor com mais falta de fontes (relativa). */
export function basicsFor(data, need, n, identity) {
  const cols = Object.keys(need.cols).filter(k => identity == null || identity.includes(k))
  const have = Object.fromEntries(cols.map(k => [k, need.cols[k].have]))
  const res = {}
  for (let j = 0; j < n; j++) {
    if (!cols.length) { res.Wastes = (res.Wastes || 0) + 1; continue }
    const k = cols.sort((a, b) => have[a] / need.cols[a].full - have[b] / need.cols[b].full)[0]
    const name = Object.keys(BASIC_OF).find(t => BASIC_OF[t] === k)
    res[name] = (res[name] || 0) + 1
    have[k]++
  }
  return res
}
