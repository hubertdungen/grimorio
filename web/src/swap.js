// Trocas inteligentes: para cada sugestão, que carta(s) do deck sair para ela entrar, e porquê.
// Mesma função primeiro (remoção por remoção, criatura por criatura), depois o que é pior em eixos objetivos:
// eficiência de mana, probabilidade de a lançar a tempo, cores, popularidade, interações e plano, curva,
// preço e, sobretudo, o que os jogos do deck dizem (gameEvidence): presa na mão, pouco lançada nas vitórias,
// ganha menos quando aparece; e protege o que faz o deck GANHAR pela via que ele ganha (dano, dreno, mill,
// veneno, combo) ou o segura (remoção, compra, bloqueios). Terrenos só por terrenos.
// Puro (browser e node). prepareSwaps calcula o deck uma vez; cada sugestão custa < 1 ms.
import { passes, deckCombos, deckPlan, deckCuts, fmtBit, RB, PAIRS, TAG_LABEL, SIDE_CATS, deadRefsN, deckReps, deadTxt as refTxt } from './data.js'
import { stats } from './deck.js'
import { maxCopies, targetsFor } from './formats.js'
import { manaNeeds, landInfo, recommendLands } from './mana.js'
import { SYN } from './synergy.js'
import { testEvidence, testsBoost, heldTurns, wrDelta as wrD } from './tests.js'
import { tx, LOCALE } from './i18n.js'

// kind é um identificador; mostrar com KIND_LABEL
export const KIND_LABEL = { 'mesmo papel': tx('mesmo papel'), 'mais caro': tx('mais caro'), 'fora do plano': tx('fora do plano'), 'linha fraca': tx('linha fraca'), curva: tx('curva') }
export const NO_SWAP = tx('Não há troca óbvia: junta-a como carta extra ou corta outra coisa')
const WEAK = tx('Sem troca evidente: é a linha mais fraca')
// custo alternativo ou lançada de outro sítio (delve, convoke, afinidade, evocar, do cemitério…): o MV não diz o que custa
const ALT = /\b(delve|convoke|improvise|affinity for|emerge|evoke|suspend|foretell|escape|unearth|dash|madness|spectacle|prowl|surge|blitz|disturb|flashback|bestow|ninjutsu)\b|costs? \{\d+\} less|costs? less to cast|without paying (its|their|that card's) mana cost/i
export const altCost = c => ALT.test(c.o || '')
// como o deck ganha: identificadores de gameEvidence().wincon.kind
export const WIN_LABEL = { damage: tx('dano'), drain: tx('dreno de vida'), mill: tx('mill'), poison: tx('veneno'), alt: tx('combo / vitória alternativa') }

const FN = ['removal', 'counter', 'wipe', 'draw', 'ramp', 'tutor', 'protection', 'recursion', 'reanimate', 'discard']
const THEME = ['tokens', 'sacrifice', 'counters', 'lifegain', 'graveyard', 'etb', 'spellslinger', 'artifacts', 'enchantments', 'evasion', 'wincon']
const subtypes = c => { const f = c.t.split(' // ')[0]; return f.includes('Creature') && f.includes('—') ? f.split('—')[1].trim().split(/\s+/) : [] }
const synTxt = c => c.o.toLowerCase().replace(/\([^)]*\)/g, '')
const sideCats = c => SIDE_CATS.map(([, re], k) => (re.test(c.o.toLowerCase()) ? k : -1)).filter(k => k >= 0)
const roleLabel = t => (t === 'creature' ? tx('criatura') : TAG_LABEL[t].toLowerCase())
// num() do i18n cria um formatador por chamada: lento a ~100 motivos por sugestão
const NF = [1, 2].map(d => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }))
const num = (x, d) => NF[d - 1].format(x)
// Funções «de verdade» para comparar duas cartas: um wipe não é remoção pontual, e uma criatura com um efeito
// secundário de remoção (Tinder Wall) não faz o mesmo papel que um feitiço de remoção.
const sweeper = c => c.tg.includes('wipe') || /(destroy|exile) all (other )?(creatures|nonland permanents|permanents)|all (other )?creatures get -|damage to each creature|each creature gets -/.test(c.o.toLowerCase())
const fnOf = c => [...new Set(c.tg.filter(t => FN.includes(t)).map(t => (t === 'removal' && sweeper(c) ? 'wipe' : t)).concat(sweeper(c) ? ['wipe'] : []))]
const group = c => (c.mt === 'Creature' ? 'creature' : c.mt === 'Land' ? 'land' : 'spell')
const pipsOf = (c, k) => ((c.mc || '').split('//')[0].match(new RegExp(`\\{${k}\\}`, 'g')) || []).length

// P(X ≥ k) numa hipergeométrica (N cartas, K boas, n vistas).
const lnF = (() => { const f = [0]; for (let i = 1; i <= 260; i++) f[i] = f[i - 1] + Math.log(i); return n => f[Math.min(260, n)] })()
const lnC = (n, k) => (k < 0 || k > n ? -Infinity : lnF(n) - lnF(k) - lnF(n - k))
function atLeast(N, K, n, k) {
  let p = 0
  for (let x = k; x <= Math.min(K, n); x++) p += Math.exp(lnC(K, x) + lnC(N - K, n - x) - lnC(N, n))
  return Math.min(1, p)
}

// --- Provas dos jogos ---------------------------------------------------------------------------------
const lossKind = t => (/life total/i.test(t) ? 'damage' : /poison/i.test(t) ? 'poison' : /library|draw/i.test(t) ? 'mill' : 'alt')
const blank = () => ({ seen: 0, seenW: 0, seenL: 0, played: 0, playedW: 0, cast: 0, castW: 0, castN: 0, lateSum: 0, lateN: 0, dead: 0, deadL: 0,
  dmg: 0, drain: 0, mill: 0, poison: 0, presentW: 0, remW: 0, drawW: 0, blockW: 0, gainW: 0, rem: 0, draw: 0, block: 0 })

/**
 * Provas por carta a partir de jogos ({winner, reason, exact, events, summary}, nós = 'a'), venham do
 * Laboratório, de torneios ou da Arena. Superconjunto de testEvidence() (dead/impact/cats continuam lá).
 * Jogos exatos (com eventos): vista/presa na mão, turno em que foi lançada, o que cada fonte fez
 * (dano, dreno, cartas moídas, remoções, compras, bloqueios, vida) e o que estava em campo ao ganhar.
 * wincon: como o deck ganha de facto (a via mais comum nas vitórias); units = total dessa via nas vitórias.
 */
export function gameEvidence(data, games) {
  const base = testEvidence(data, games)
  const cards = {}
  const C = n => (cards[n] ||= blank())
  let wins = 0, exactN = 0, winsExact = 0
  const kinds = {}
  for (const g of games) {
    const won = g.winner === 'a', lost = g.winner && g.winner !== 'a' && g.winner !== 'draw'
    if (won) wins++
    const a = g.summary?.a || {}
    const loser = (g.events || []).find(e => e.k === 'outcome' && e.p !== 'a' && /lost/.test(e.txt || ''))?.txt || g.reason || ''
    let kind = won ? lossKind(loser) : null
    const per = {}
    const P = n => (per[n] ||= blank())
    for (const [n, d] of Object.entries(a.damage_by_card || {})) P(n).dmg += d
    for (const [n, d] of Object.entries(a.poison_by_card || {})) P(n).poison += d
    const castT = {}
    if (g.exact && g.events?.length) {
      exactN++
      if (won) winsExact++
      let myTurn = 0, src = null, phase = '', prevDmg = false, hand = []
      const life = { a: g.startLife || 20, b: g.startLife || 20 }, bf = new Map(), seen = new Set(), played = new Set()  // played: lançada ou posta em campo
      for (const e of g.events) {
        if (e.hd?.a) { hand = e.hd.a; for (const n of hand) seen.add(n) }
        const ours = e.p === 'a'
        switch (e.k) {
          case 'turn': if (ours) myTurn++; src = null; break
          case 'phase': phase = e.ph || ''; src = null; break
          case 'cast': if (e.card) { src = ours ? e.card : null; if (ours) { seen.add(e.card); played.add(e.card); P(e.card).castN++; (castT[e.card] ||= myTurn) } } break
          case 'activate': case 'trigger': case 'resolve': if (e.card) src = ours ? e.card : null; break
          case 'life':
            if (e.p === 'b' && e.n < life.b && !prevDmg && src) P(src).drain += life.b - e.n
            if (ours && e.n > life.a && src) P(src).gainW += e.n - life.a
            if (e.p in life) life[e.p] = e.n
            break
          case 'mill': if (e.p === 'b' && src) P(src).mill += e.x || 1; break
          case 'draw': if (ours && phase !== 'draw' && src) P(src).draw += e.x || 1; break
          case 'block': if (ours && e.card) P(e.card).block++; break
          case 'countered': if (e.p === 'b' && src) P(src).rem++; break
          case 'destroy': case 'exile': case 'bounce':
            // ponytail: atribui à última fonte nossa na mesma fase; mortes em combate ficam de fora
            if (src && !/combat|damage|attack|block/i.test(phase)) for (const z of e.zn || []) if (z.fp === 'b' && z.from === 'battlefield') P(src).rem++
            break
        }
        for (const z of e.zn || []) {
          if (z.to === 'battlefield' && z.tp === 'a') { bf.set(z.id, z.card); if (!z.tok) played.add(z.card) }
          else if (z.from === 'battlefield') bf.delete(z.id)
        }
        prevDmg = e.k === 'damage'
      }
      const held = heldTurns(g), usedSet = new Set(a.used || [])
      for (const n of seen) {
        const x = P(n)
        x.seen = 1
        if ((held[n] || 0) >= 3 && !castT[n] && !usedSet.has(n)) x.dead = 1
      }
      for (const n of played) P(n).played = 1
      if (won) for (const n of new Set(bf.values())) P(n).presentW = 1
      for (const [n, t] of Object.entries(castT)) { const c = data.byName.get(n); if (c && c.mt !== 'Land') { P(n).lateSum = t - Math.max(1, Math.ceil(c.cmc)); P(n).lateN = 1 } }
    } else for (const [, n] of a.cast || []) { P(n).castN++; castT[n] = 1 }
    if (won && kind === 'damage') { // dano ou dreno: o que pesou mais nesta vitória
      let d = 0, r = 0
      for (const x of Object.values(per)) { d += x.dmg; r += x.drain }
      if (r > d) kind = 'drain'
    }
    if (won) kinds[kind] = (kinds[kind] || 0) + 1
    for (const [n, x] of Object.entries(per)) {
      const y = C(n)
      y.seen += x.seen; y.played += x.played; y.dead += x.dead; y.castN += x.castN; y.lateSum += x.lateSum; y.lateN += x.lateN
      if (castT[n]) y.cast++
      if (won) { y.seenW += x.seen; y.playedW += x.played; if (castT[n]) y.castW++; y.dmg += x.dmg; y.drain += x.drain; y.mill += x.mill; y.poison += x.poison; y.presentW += x.presentW; y.remW += x.rem; y.drawW += x.draw; y.blockW += x.block; y.gainW += x.gainW }
      if (lost) { y.seenL += x.seen; y.deadL += x.dead }
      y.rem += x.rem; y.draw += x.draw; y.block += x.block
    }
  }
  const kind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const unitsOf = x => (kind === 'damage' || kind === 'drain' ? x.dmg + x.drain : kind === 'mill' ? x.mill : kind === 'poison' ? x.poison : kind === 'alt' ? x.presentW : 0)
  let units = 0
  for (const x of Object.values(cards)) { x.units = unitsOf(x); units += x.units }
  return { ...base, wins, exact: exactN, winsExact, wincon: kind ? { kind, games: kinds[kind] } : null, units, cards }
}

// --- Trocas -------------------------------------------------------------------------------------------
const cache = new WeakMap() // deck (imutável) -> {key, fn}

/**
 * Pré-cálculo por deck. opts: {evidence, co, archetype, meta}. evidence = gameEvidence() (ou testEvidence(),
 * só com «presa na mão»), de qualquer fonte de jogos; por omissão ctx.tests.
 * Devolve (card, {limit}) => [{out, q, score, why, kind, zone, eur}] com .none quando vazio e
 * .kept = [{n, why}] (cartas da mesma função que os jogos mandam manter).
 */
export function prepareSwaps(data, deck, fmt, ctx, opts = {}) {
  const key = [data, fmt, ctx, opts.evidence, opts.co, opts.archetype, opts.meta]
  const hit = cache.get(deck)
  if (hit && hit.key.every((x, k) => x === key[k])) return hit.fn
  const fn = build(data, deck, fmt, ctx, opts)
  cache.set(deck, { key, fn })
  return fn
}

export function swapFor(data, deck, fmt, card, ctx, opts = {}) {
  return prepareSwaps(data, deck, fmt, ctx, opts)(card, opts)
}

/**
 * «Trocar no deck»: o motor das trocas ao contrário — as cartas do deck (e do sideboard) que alguma sugestão substitui
 * de forma clara (o limiar do motor: score ≥ 0,3 com motivos contra a carta) e, para cada uma, a melhor substituta.
 * Só se julgam cartas vistas em `minSeen`+ jogos exatos (as que nunca tiveram hipótese de aparecer ficam de fora); as
 * ilegais entram sempre. fn = prepareSwaps(…); cands = sugestões (cartas) do deck e do sideboard; ev = gameEvidence().
 * Devolve {cuts: [{out, q, zone, score, why, kind, seen, inc, alts}], games}.
 */
export function cutPlan(fn, cands, ev, { minSeen = 3, n = 10 } = {}) {
  const games = ev?.exact || 0, by = new Map()
  const illegal = w => w.some(t => t === tx('Ilegal no formato') || t === tx('Fora da identidade ou ilegal no formato'))
  for (const S of cands) {
    let list = []
    try { list = fn(S, { limit: 3 }) || [] } catch { continue }
    if (list.none) continue
    for (const x of list) {
      if (x.why[0] === WEAK) continue  // não é «claramente pior»
      const seen = ev?.cards?.[x.out]?.seen || 0
      if (!illegal(x.why) && seen < minSeen) continue
      const cur = by.get(x.out)
      if (!cur) by.set(x.out, { ...x, seen, inc: S, alts: [] })
      else if (x.score > cur.score) by.set(x.out, { ...x, seen, inc: S, alts: [cur.inc, ...cur.alts].slice(0, 3) })
      else if (cur.alts.length < 3 && !cur.alts.includes(S)) cur.alts.push(S)
    }
  }
  return { cuts: [...by.values()].sort((a, b) => b.score - a.score).slice(0, n), games }
}

/**
 * «⛰ Terrenos»: equilíbrio e otimização dos terrenos, sem precisar de jogos (o motor das trocas usa-os quando há).
 * 1) quantidade: com o deck quase completo, −1 terreno por +1 carta (sobram 2+) ou o contrário (faltam 2+), até 3;
 * 2) cores: cor com fontes a menos → um terreno que a dê no lugar de um básico da cor que sobra;
 * 3) melhores terrenos: as sugestões de recommendLands que o motor troca por um terreno do deck de forma clara.
 * fn = prepareSwaps(…); recs = sugestões (cartas que não são terreno vêm daqui). Devolve {N, diff, acts}.
 */
const BASIC = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
export function landPlan(data, deck, fmt, ctx, { fn = null, recs = [], co = null, meta = null } = {}) {
  const N = manaNeeds(data, deck, fmt), get = n => data.byName.get(n)
  const lands = Object.entries(deck.main || {}).map(([n, q]) => [get(n), q]).filter(([c]) => c?.mt === 'Land')
  const done = N.s.spells + N.s.lands + (deck.commanders?.length || 0) >= N.total * 0.9
  // a regra (Karsten) pede terrenos a mais em decks agressivos, que jogam de propósito com menos: aí não se pede «mais»
  const raw = done ? N.lands - N.target : 0, diff = raw >= 3 || (raw <= -3 && N.s.avgMv >= 2.4) ? raw : 0
  const acts = [], used = new Set()
  const surplus = k => (N.cols[k]?.have || 0) - (N.cols[k]?.need || 0)
  const landOut = except => {  // um básico da cor com mais sobra; senão um terreno que entra virado
    const b = lands.filter(([c]) => /\bBasic\b/.test(c.t) && !used.has(c.n)).map(([c]) => ({ c, k: Object.keys(BASIC).find(k => BASIC[k] === c.n) }))
      .filter(x => x.k && x.k !== except && surplus(x.k) > 0).sort((a, b2) => surplus(b2.k) - surplus(a.k))[0]
    return b?.c || lands.find(([c]) => !used.has(c.n) && landInfo(c).tapped === 'sim')?.[0] || null
  }
  const rl = recommendLands(data, { deck, fmt, ctx, co, meta, need: N, limit: 12 })
  const why0 = tx('O deck tem {l} terrenos; para o MV médio {m} e o ramp/compra que tem, o ideal são {t}', { l: N.lands, m: N.s.avgMv.toFixed(1), t: N.target })
  if (diff >= 2) {
    for (const r of recs.filter(r => r.c.mt !== 'Land').slice(0, Math.min(3, diff))) {
      const o = landOut(); if (!o) break
      used.add(o.n); acts.push({ kind: 'menos', out: o.n, in: r.c, q: 1, why: [why0, r.why?.[0]?.txt].filter(Boolean) })
    }
  } else if (diff <= -2) {
    const cmd = (deck.commanders || []).map(n => get(n)?.i).filter(i => i != null)
    const FNS = ['removal', 'draw', 'ramp', 'counter', 'wipe', 'protection', 'tutor']  // cartas de função não saem por terrenos
    const weak = deckCuts(data, deck, { ctx, co, commanders: cmd, recs, limit: 8 }).filter(x => !x.c.tg.some(t => FNS.includes(t)))
    for (const x of weak.slice(0, Math.min(3, -diff))) {
      const k = Object.keys(N.cols).sort((a, b) => surplus(a) - surplus(b))[0]
      const multi = rl.find(r => !used.has(r.c.n) && !r.land.any && [...r.land.colors].filter(c => N.cols[c] && surplus(c) < 2).length >= 2)?.c
      const inn = multi || (k ? get(BASIC[k]) : rl[0]?.c)
      if (!inn) break
      used.add(inn.n); used.add(x.c.n)
      acts.push({ kind: 'mais', out: x.c.n, in: inn, q: 1, why: [why0, ...x.why.slice(0, 1)] })
    }
  }
  // cores com fontes a menos, da mais em falta para a menos: de preferência um terreno duplo que dê essa cor E a do
  // básico que sai (Plains → Temple Garden mantém o branco e junta o verde), várias cópias se faltar muito
  const rlx = recommendLands(data, { deck, fmt, ctx, co, meta, need: N, limit: 60 })
  const colOf = c => Object.keys(BASIC).find(k => BASIC[k] === c.n)
  for (const [k, v] of Object.entries(N.cols).filter(([, x]) => x.have < x.need).sort((a, b) => (b[1].need - b[1].have) - (a[1].need - a[1].have))) {
    const miss = v.need - v.have, why = [tx('Só {h} fontes de {k} para {n} precisas', { h: v.have, k, n: v.need })]
    let left = miss, made = 0
    for (let t = 0; t < 2 && left > 0; t++) {  // até dois pares por cor (ex.: Island → U/G e Plains → W/G)
      let pair = null
      for (const r of [...rlx.filter(x => !x.land.any), ...rlx.filter(x => x.land.any)]) {  // duplos a sério primeiro; «qualquer cor» só em último
        if (used.has(r.c.n) || !(r.land.colors.has(k) || (r.land.any && r.land.anyQ >= 1))) continue
        const b = lands.filter(([c, q]) => !used.has(c.n) && q > 0 && colOf(c) && colOf(c) !== k && (r.land.any || r.land.colors.has(colOf(c)))).sort((x, y) => surplus(colOf(y[0])) - surplus(colOf(x[0])))[0]
        if (b) { pair = { inn: r.c, o: b[0], have: b[1] }; break }
      }
      if (!pair) break
      const q = Math.max(1, Math.min(left, pair.have, fmt.copies === 1 ? 1 : 4))
      used.add(pair.inn.n); used.add(pair.o.n); left -= q; made++
      acts.push({ kind: 'cor', out: pair.o.n, in: pair.inn, q, why: [...why, tx('{in} dá {k} e continua a dar {k2}: trocar {out} não perde fontes', { in: pair.inn.n, k, k2: colOf(pair.o), out: pair.o.n })] })
    }
    if (made) continue
    const inn = rl.find(r => !used.has(r.c.n) && (r.land.any || r.land.colors.has(k)))?.c || get(BASIC[k])
    const o = landOut(k)
    if (!inn || !o) continue
    used.add(inn.n); used.add(o.n)
    acts.push({ kind: 'cor', out: o.n, in: inn, q: 1, why })
  }
  if (fn) for (const r of rl.slice(0, 8)) {  // melhores terrenos (o motor diz qual sai e porquê)
    if (used.has(r.c.n)) continue
    let list = []
    try { list = fn(r.c, { limit: 1 }) || [] } catch { continue }
    const x = list[0]
    if (list.none || !x || x.why[0] === WEAK || used.has(x.out)) continue
    used.add(x.out); used.add(r.c.n)
    acts.push({ kind: 'melhor', out: x.out, in: r.c, q: x.q, why: [...x.why, ...r.why.slice(0, 1).map(w => w.txt ?? w)].slice(0, 3) })
  }
  return { N, diff, acts }
}

/** Troca q cópias de outName por inName na zona onde outName está (deck, sideboard ou comandantes). */
export function applySwap(deck, inName, outName, q = 1) {
  if (deck.commanders?.includes(outName)) return { ...deck, commanders: deck.commanders.map(n => (n === outName ? inName : n)) }
  const zone = deck.main?.[outName] ? 'main' : deck.side?.[outName] ? 'side' : null
  if (!zone || inName === outName) return deck
  const z = { ...deck[zone] }, k = Math.min(q, z[outName])
  z[outName] -= k
  if (z[outName] <= 0) delete z[outName]
  z[inName] = (z[inName] || 0) + k
  return { ...deck, [zone]: z }
}

function build(data, deck, fmt, ctx, opts) {
  const { cards, emb: E, D } = data
  const T = opts.evidence ?? ctx?.tests ?? null
  const bit = fmtBit(data, fmt)
  const get = n => data.byName.get(n)
  const mainE = Object.entries(deck.main || {}).map(([n, q]) => [get(n), q]).filter(([c]) => c)
  const sideE = Object.entries(deck.side || {}).map(([n, q]) => [get(n), q]).filter(([c]) => c)
  const cmds = [...(deck.commanders || []), deck.signature].map(n => n && get(n)).filter(Boolean)
  const idxs = [...cmds, ...mainE.map(([c]) => c)].map(c => c.i)
  const nonland = mainE.filter(([c]) => c.mt !== 'Land' && !c.tg.includes('hate')).map(([c]) => c.i)
  const all = [...new Set([...nonland, ...cmds.map(c => c.i)])]
  const deckCards = [...cmds, ...mainE.map(([c]) => c)]
  const reps = deckReps(deckCards)
  const s = stats(deck, data)
  // EDHREC (rank «er») só em formatos de comandante; nos de 60 cartas, a inclusão no meta dos torneios
  const edhOk = !!(fmt.cmd || cmds.length)
  const mInc = c => opts.meta?.byCard.get(c.i)?.incl || 0

  // Protegidas: sementes, comandantes, peças de combos completos, peças centrais do arquétipo.
  const prot = new Set([...(deck.seeds || []), ...cmds.map(c => c.n)])
  for (const x of deckCombos(data, idxs, ctx).full) for (const i of x.cb[1]) prot.add(cards[i].n)
  for (const x of opts.archetype?.core || []) if (x.incl >= 0.75 && x.i != null) prot.add(cards[x.i].n)

  // Plano (eixos alimenta/aproveita) e quem é o único a fazer um dos lados.
  const plan = deckPlan(data, idxs)
  let planBits = 0
  const soleRole = new Map() // nome -> bits de papéis do plano que só ele tem
  for (const p of plan) for (const r of p.roles) {
    planBits |= RB[r]
    const who = all.filter(i => cards[i].ro & RB[r])
    if (who.length === 1) soleRole.set(cards[who[0]].n, (soleRole.get(cards[who[0]].n) || 0) | RB[r])
  }
  const planName = plan[0]?.label.toLowerCase()

  // Funções: metas do formato e quem é a única carta de uma função.
  const targets = s.spells + s.lands >= 10 ? targetsFor(fmt, plan, deck.prefs) : {}
  const distinct = {}
  for (const [c] of mainE) for (const t of c.tg) distinct[t] = (distinct[t] || 0) + 1

  // Tribo (5+ do mesmo subtipo): membros e lords não saem, a não ser por outro membro.
  const tribeN = {}
  for (const i of nonland) for (const t of subtypes(cards[i])) tribeN[t] = (tribeN[t] || 0) + 1
  const [tribe0, tn] = Object.entries(tribeN).sort((a, b) => b[1] - a[1])[0] || []
  const tribe = tn >= 5 ? tribe0 : null
  const tribeRe = tribe && new RegExp(`\\b${tribe.toLowerCase()}s?\\b`)
  const isLord = c => !!tribe && tribeRe.test(c.o.toLowerCase())
  const isMember = c => !!tribe && (subtypes(c).includes(tribe) || /changeling/i.test(c.o) || isLord(c))

  // Interações: pares alimenta/aproveita (como em deckCuts) e categorias de sinergia (synergy.js).
  const byRole = Object.fromEntries(Object.keys(RB).map(r => [r, all.filter(i => cards[i].ro & RB[r])]))
  const partners = c => {
    const p = new Set()
    for (const [a, b] of PAIRS) {
      if (c.ro & RB[a]) for (const j of byRole[b]) if (j !== c.i) p.add(j)
      if (c.ro & RB[b]) for (const j of byRole[a]) if (j !== c.i) p.add(j)
    }
    return p.size
  }
  // categorias com os dois lados no deck e 4+ cartas (deckSynergy completo percorre a base toda: lento demais aqui);
  // quem é o único a ativar (ou a beneficiar) de uma categoria é um «enabler» do plano e só sai por outro igual
  const cats = [], inCat = new Map(), soleSyn = new Map()
  for (const x of SYN) {
    const en = [], pay = []
    for (const c of deckCards) {
      if (c.mt === 'Land' && !x.lands) continue
      const o = synTxt(c)
      if (x.en(c, o)) en.push(c.n)
      if (x.pay(c, o)) pay.push(c.n)
    }
    if (!en.length || !pay.length || new Set([...en, ...pay]).size < 4) continue
    cats.push(x)
    for (const n of new Set([...en, ...pay])) inCat.set(n, (inCat.get(n) || 0) + 1)
    for (const l of [en, pay]) if (l.length === 1) soleSyn.set(l[0], [...(soleSyn.get(l[0]) || []), x])
  }
  const catsOfNew = c => { const o = synTxt(c); return cats.filter(x => (c.mt !== 'Land' || x.lands) && (x.en(c, o) || x.pay(c, o))).length }
  const inSyn = (c, x) => { const o = synTxt(c); return x.en(c, o) || x.pay(c, o) }
  // Via de vitória: a dos jogos (gameEvidence) ou, sem jogos, mill se 8+ cópias moem o adversário.
  // Peças dessa via (e escoadouros de mana num deck com motor de mana) só saem por outra peça.
  const millCat = cats.find(x => x.k === 'mill')
  const millN = millCat ? mainE.reduce((a, [c, q]) => a + (millCat.en(c, synTxt(c)) ? q : 0), 0) : 0
  const winKind = (T?.cards && T.wincon?.kind) || (millN >= 8 ? 'mill' : null)
  const engine = mainE.reduce((a, [c, q]) => a + (c.mt !== 'Land' && /\{t\}[^.]*: add /i.test(c.o) ? q : 0), 0) >= 6 // 6+ produtores de mana
  const sink = c => engine && /\{(?:[6-9]|\d\d|X)\}[^:.]*:/.test(c.o)
  const winPiece = c => (winKind === 'mill' && millCat && c.mt !== 'Land' && millCat.en(c, synTxt(c))) || (winKind === 'poison' && /\binfect\b|\btoxic\b|poison counter/i.test(c.o)) || sink(c)
  const pieceWhy = c => (sink(c) ? tx('Escoadouro do teu motor de mana: é por onde o deck ganha — fica') : tx('Peça do teu plano de {p} — fica', { p: WIN_LABEL[winKind] }))
  // plano de reanimação: os alvos grandes não se avaliam pelo custo e só saem por outro alvo
  const reanimating = deckCards.some(c => c.tg.includes('reanimate'))
  const reanTarget = c => reanimating && c.mt === 'Creature' && ((parseInt(c.pt) || 0) >= 6 || c.cmc >= 6)

  // Texto: semelhança de cada carta ao resto (deixando-a de fora) e de uma candidata ao deck inteiro.
  const sum = new Float32Array(D)
  for (const i of all) for (let k = 0; k < D; k++) sum[k] += E[i * D + k]
  let sumN = 0
  for (let k = 0; k < D; k++) sumN += sum[k] * sum[k]
  sumN = Math.sqrt(sumN) || 1
  const simOf = new Map()
  for (const i of nonland) {
    let dot = 0, nn = 0
    for (let k = 0; k < D; k++) { const v = sum[k] - E[i * D + k]; dot += v * E[i * D + k]; nn += v * v }
    simOf.set(i, dot / ((Math.sqrt(nn) || 1) * 127))
  }
  const sims = [...simOf.values()].sort((a, b) => a - b)
  const q25 = sims[Math.floor(sims.length * 0.25)] ?? -1
  const cmdSim = c => cmds.reduce((m, k) => { let d = 0; for (let j = 0; j < D; j++) d += E[k.i * D + j] * E[c.i * D + j]; return Math.max(m, d / 16129) }, 0)
  const simNew = c => { let d = 0; for (let k = 0; k < D; k++) d += sum[k] * E[c.i * D + k]; return d / (sumN * 127) }

  // Mana: fontes por cor, splash (< 12% dos símbolos num deck de 2+ cores) e P(lançar a tempo).
  const N = manaNeeds(data, deck, fmt)
  const deckCols = Object.keys(N.cols)
  const pipT = [...'WUBRG'].reduce((a, k) => a + s.pips[k], 0) || 1
  const used = [...'WUBRG'].filter(k => s.pips[k])
  const splash = used.length >= 2 ? used.filter(k => s.pips[k] / pipT < 0.12) : []
  const strain = c => splash.find(k => pipsOf(c, k))
  const nDeck = Math.max(40, s.lands + s.spells)
  // ponytail: terrenos e cores tratados como independentes e sem contar o ramp; serve para comparar duas cartas
  const castProb = c => {
    if (!c.cmc || s.lands < 8 || altCost(c) || reanTarget(c)) return 1  // alvos de reanimação não se lançam com mana
    const t = Math.ceil(c.cmc), n = Math.min(nDeck, 6 + t)
    let p = atLeast(nDeck, s.lands, n, t)
    for (const k of deckCols) { const m = pipsOf(c, k); if (m) p *= atLeast(nDeck, N.cols[k].have, n, m) }
    return p
  }
  // fontes recomendadas para p símbolos de k (tabela de mana.js, à escala do deck)
  const SRC = nDeck >= 99 ? [0, 16, 22, 27] : nDeck >= 60 ? [0, 13, 18, 22] : [0, 8, 11, 13]
  const needFor = (k, p) => SRC[Math.min(3, p)] * (N.cols[k].need / N.cols[k].full)
  const pct = p => `${Math.round(p * 100)}%`

  const crowd = slot => s.curve[slot] >= Math.max(6, Math.round(s.spells * 0.28))
  const budget = deck.prefs?.on ? deck.prefs.orcamento : null
  const priceOf = c => c.eur ?? c.usd
  const have = n => (deck.main?.[n] || 0) + (deck.side?.[n] || 0) + (deck.commanders?.includes(n) ? 1 : 0)
  const erT = c => (c.er ? `#${c.er}` : tx('sem rank'))
  const cmdE = c => opts.co?.get(c.i)?.find(x => x.kind === 'commanders')
  const edhVal = c => { const e = cmdE(c); return e ? 0.6 * e.incl + 0.4 * Math.max(0, e.syn || 0) : 0 }

  // Provas dos jogos (gameEvidence; com testEvidence só há «presa na mão»).
  const ev = T?.cards ? T : null
  const wk = ev?.wincon?.kind
  const evC = n => ev?.cards[n]
  const wrDelta = x => wrD(ev, x)
  const unitsTxt = x => ({ damage: tx('fez {n} de dano', { n: x.units }), drain: tx('drenou {n} de vida', { n: x.units }), mill: tx('moeu {n} cartas', { n: x.units }),
    poison: tx('deu {n} de veneno', { n: x.units }), alt: tx('esteve em campo em {n} vitórias', { n: x.units }) }[wk])
  const deadOf = n => {
    const x = evC(n)
    if (x) return x.dead >= 2 && x.dead / x.seen >= 0.5 ? { dead: x.dead, seen: x.seen, lost: x.deadL } : null
    const d = T?.dead?.[n]
    return d && d.dead >= 2 && d.dead / d.seen >= 0.5 ? d : null
  }
  // fica, pelos jogos: peça da via de vitória, ganha mais quando aparece, ou segura as vitórias (remoção/compra/bloqueios)
  const keepWhy = n => {
    const x = evC(n)
    if (!x || deadOf(n)) return null
    if (wk && ev.units && x.units >= 3 && x.units / ev.units >= 0.15) return tx('Peça do teu plano de {p}: {v} nos testes — fica', { p: WIN_LABEL[wk], v: unitsTxt(x) })
    if (x.seen >= 3 && wrDelta(x) >= 0.2) return tx('Com ela na mão ganhaste {a} de {n} jogos — fica', { a: x.seenW, n: x.seen })
    const sup = [x.remW >= 2 && tx('{n} remoções ou contra-feitiços', { n: x.remW }), x.drawW >= 3 && tx('{n} cartas compradas', { n: x.drawW }), x.blockW >= 3 && tx('{n} bloqueios', { n: x.blockW })].filter(Boolean)
    if (x.remW + x.drawW + x.blockW >= 4) return tx('Nas vitórias: {t} — fica', { t: sup.join(', ') })
    return null
  }

  // Terrenos: valor pela base de mana (cores com falta, virado, utilidade, sinergias).
  const landGives = c => { const L = landInfo(c, (deck.commanders?.length || 0) > 0); return { L, gives: L.any || L.colors.has('*') ? deckCols : deckCols.filter(k => L.colors.has(k)) } }
  const landVal = c => {
    const { L, gives } = landGives(c)
    let v = 0
    for (const k of gives) v += N.cols[k].have < N.cols[k].full ? 1 : 0.5
    if (deckCols.length >= 2 && gives.length >= 2) v += 0.3
    if (L.tapped === 'sim') v -= N.fast ? 0.6 : 0.3
    return v + 0.3 * L.util.length + 0.5 * (inCat.get(c.n) || catsOfNew(c) > 0 ? 1 : 0) + (c.tg.some(t => FN.includes(t)) ? 0.4 : 0)
  }
  const deadTxt = d => (d.lost >= 2 ? tx('Esteve na mão em {n} derrotas sem ser lançada', { n: d.lost }) : tx('Ficou presa na mão em {a} de {n} jogos', { a: d.dead, n: d.seen }))

  function landSwaps(S, room, limit) {
    const vS = landVal(S), gS = landGives(S).gives, deadS = deadRefsN(S, deckCards, reps)
    const out = []
    for (const [X, q0] of mainE) {
      if (X.mt !== 'Land' || X.n === S.n || prot.has(X.n) || keepWhy(X.n)) continue
      const q = Math.min(room, q0), { L, gives } = landGives(X)
      // tirar X não pode deixar uma cor abaixo do mínimo que S não dá
      if (gives.some(k => !gS.includes(k) && N.cols[k].have - q < N.cols[k].need)) continue
      const why = []
      let gain = vS - landVal(X)
      const short = gS.filter(k => N.cols[k].have < N.cols[k].need)
      if (short.length) why.push(tx('{c} dá {k}, cor com fontes a menos ({s})', { c: S.n, k: short.join('/'), s: short.map(k => `${N.cols[k].have}/${N.cols[k].need}`).join(', ') }))
      if (/\bBasic\b/.test(X.t) && gives.length === 1) { const k = gives[0]; if (N.cols[k].have >= N.cols[k].need) why.push(tx('Básico de {k}: já tens {h} fontes de {k} (alvo ~{n})', { k, h: N.cols[k].have, n: N.cols[k].need })) }
      if (L.tapped === 'sim' && landGives(S).L.tapped !== 'sim') why.push(tx('{c} entra sempre virado', { c: X.n }))
      if (deckCols.length >= 2 && !gives.length && !L.any) why.push(tx('Só dá mana incolor'))
      const d = deadOf(X.n)
      if (d) { gain += 0.3; why.push(deadTxt(d)) }
      gain -= 0.15 * deadS.length  // Villainous Hideout sem Villains
      if (gain <= 0.05 || !why.length) continue
      out.push({ out: X.n, q, score: +gain.toFixed(3), why: why.slice(0, 3), kind: 'mesmo papel', zone: 'main', eur: eurDelta(S, X, q) })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit)
  }
  const eurDelta = (S, X, q) => (priceOf(S) != null && priceOf(X) != null ? +((priceOf(S) - priceOf(X)) * q).toFixed(2) : null)

  return function swaps(S, { limit = 3 } = {}) {
    const none = (r, kept = []) => Object.assign([], { none: r, kept })
    if (!S) return none(NO_SWAP)
    const room = maxCopies(S, fmt, bit) - have(S.n)
    if (room <= 0) return none(tx('Já tens o máximo de cópias de {c}', { c: S.n }))
    if (S.mt === 'Land') { const r = landSwaps(S, room, limit); return r.length ? Object.assign(r, { kept: [] }) : none(NO_SWAP) }

    const side = S.tg.includes('hate') && fmt.side > 0 && sideE.length > 0
    const pool = side ? sideE : mainE.filter(([c]) => c.mt !== 'Land' && !c.tg.includes('hate'))
    const sCats = side ? sideCats(S) : []
    const sideN = {}
    if (side) for (const [c] of sideE) for (const k of sideCats(c)) sideN[k] = (sideN[k] || 0) + 1
    const memberS = isMember(S)
    const simS = simNew(S), partS = partners(S), synS = catsOfNew(S)
    const intS = partS + 2 * synS
    const onPlan = !!(S.ro & planBits) || synS > 0
    const lerS = Math.log(S.er || 40000)
    const answers = testsBoost(S, T)?.txt
    const slotS = Math.min(7, Math.floor(S.cmc))
    const pS = castProb(S)
    const deadS = deadRefsN(S, deckCards, reps)  // a sugestão refere um tipo/mecânica que o deck não tem

    const res = [], kept = []
    for (const [X, q0] of pool) {
      if (X.n === S.n || prot.has(X.n)) continue
      const fX = fnOf(X), fS = fnOf(S)
      const sharedFn = side || group(X) !== group(S) ? [] : fX.filter(t => fS.includes(t)) // mesmo papel: mesma função e o mesmo tipo (criatura/feitiço)
      const bothCre = X.mt === 'Creature' && S.mt === 'Creature'
      const kw = keepWhy(X.n) || (winPiece(X) && !winPiece(S) && !deadOf(X.n) && pieceWhy(X))
      if (kw) { if (sharedFn.length || bothCre || X.mt === S.mt) kept.push({ n: X.n, why: kw }); continue }
      if (!side && tribe && isMember(X) && !(memberS && !isLord(X))) continue
      if (reanTarget(X) && !reanTarget(S)) continue
      if (!side && (soleSyn.get(X.n) || []).some(x => !inSyn(S, x))) continue // único enabler/payoff de uma sinergia do deck
      const q = Math.min(room, q0)
      const xCats = side ? sideCats(X) : []
      const sharedSide = xCats.filter(k => sCats.includes(k))
      if (side && xCats.some(k => sideN[k] === 1 && !sCats.includes(k))) continue // única resposta do sideboard a essa ameaça
      // a única carta de uma função (ou de um lado do plano) só sai por outra que faça o mesmo
      // (a etiqueta «condição de vitória» só conta em decks que ganham por dano: num deck de mill a via é outra)
      if (!side && X.tg.some(t => (FN.includes(t) || targets[t]) && distinct[t] === 1 && !S.tg.includes(t) && (t !== 'wincon' || !winKind || /damage|drain/.test(winKind)))) continue
      if (!side && (soleRole.get(X.n) || 0) & ~S.ro) continue
      const illegal = !passes(X, null, ctx), d = deadOf(X.n), x = evC(X.n)
      const xFn = fX.length > 0
      // carta de função (remoção, compra, contra…) só sai por outra com a mesma função, a não ser que esteja morta ou ilegal
      if (!side && xFn && !sharedFn.length && !illegal && !d) continue
      const sharedTheme = THEME.filter(t => X.tg.includes(t) && S.tg.includes(t))
      const rel = (sharedFn.length || sharedSide.length ? 0.35 : bothCre ? 0.25 : X.mt === S.mt && sharedTheme.length ? 0.15 : X.mt === S.mt ? 0.08 : 0) * (deadS.length ? 0.5 : 1)
      const role = sharedSide.length ? SIDE_CATS[sharedSide[0]][0].toLowerCase() : sharedFn.length ? roleLabel(sharedFn[0]) : bothCre ? roleLabel('creature') : null
      const ax = [] // [peso, kind, texto]
      const push = (w, kind, t) => ax.push([w, kind, t])

      if (illegal) push(0.6, 'linha fraca', ctx?.identity != null ? tx('Fora da identidade ou ilegal no formato') : tx('Ilegal no formato'))
      // o que os jogos dizem
      // respostas (remoção, contra) ficam na mão à espera de alvo: estar presa conta metade
      const rt = reanTarget(X)  // alvo de reanimação: ficar na mão / não ser lançado é o normal (vai para o cemitério)
      if (d && !rt) push((0.25 + 0.35 * d.dead / d.seen) * (X.tg.some(t => t === 'counter' || t === 'removal') ? 0.5 : 1), 'linha fraca', deadTxt(d))
      if (!rt && x && ev.wins >= 3 && x.seenW >= 2 && x.castW <= 1) push(0.2, 'linha fraca', x.castW ? tx('Nos teus {w} jogos ganhos só a lançaste 1 vez', { w: ev.wins }) : tx('Nos teus {w} jogos ganhos nunca a lançaste', { w: ev.wins }))
      if (x && x.seen >= 3 && wrDelta(x) <= -0.15) push(0.2, 'linha fraca', tx('Com ela na mão ganhaste {a} de {n} jogos; sem ela, {p}', { a: x.seenW, n: x.seen, p: pct((ev.winsExact - x.seenW) / Math.max(1, ev.exact - x.seen)) }))
      if (!rt && x && x.lateN >= 2 && x.lateSum / x.lateN >= 2) push(0.1, 'curva', tx('Nos testes saiu em média {d} turnos depois do custo', { d: num(x.lateSum / x.lateN, 1) }))
      // eficiência de mana: mesmo efeito mais caro, cores exigentes, lançar a tempo
      if (role && X.cmc > S.cmc && !(reanTarget(X) && reanTarget(S)) && !altCost(X)) push(Math.min(0.45, 0.15 * (X.cmc - S.cmc)), 'mais caro', null)
      const pX = castProb(X)
      const hard = deckCols.find(k => pipsOf(X, k) >= 2 && pipsOf(X, k) > pipsOf(S, k) && N.cols[k].have < 0.9 * needFor(k, pipsOf(X, k)))
      if (hard) push(0.12, 'linha fraca', tx('Pede {p} com só {h} fontes de {k}', { p: `{${hard}}`.repeat(pipsOf(X, hard)), h: N.cols[hard].have, k: hard }))
      else if (pS - pX >= 0.15) push(0.12, 'curva', tx('A tempo em {x} dos jogos; a sugestão em {s}', { x: pct(pX), s: pct(pS) }))
      const lr = Math.log(X.er || 40000) - lerS
      if (edhOk && lr > Math.log(2.5) && (X.er || 40000) > 1500) push(0.06 * Math.min(3, lr), 'mesmo papel', tx('Pouco usada (EDHREC {x}) face a {s}', { x: erT(X), s: erT(S) }))
      if (!side) {
        const partX = partners(X), synX = inCat.get(X.n) || 0, intX = partX + 2 * synX
        if (xFn) { /* funções valem por si: não se medem por interações nem pelo plano */ } else if (intX === 0 && intS > 0) push(0.22, role ? 'mesmo papel' : 'fora do plano', tx('Sem interações no deck; {c} liga a {n}', { c: S.n, n: intS }))
        else if (intX <= 1 && intS >= intX + 3) push(0.12, role ? 'mesmo papel' : 'fora do plano', tx('Poucas interações ({a}) face a {b}', { a: intX, b: intS }))
        if (!xFn && plan.length && onPlan && !(X.ro & planBits) && !synX && !sharedFn.length) push(0.2, 'fora do plano', tx('Fora do plano ({p}); nenhuma sinergia no deck', { p: planName }))
        const simX = simOf.get(X.i) ?? 0
        if (simX < q25 && simS > simX + 0.05) push(0.15, 'linha fraca', tx('Texto entre os mais afastados do resto do deck'))
        if (crowd(slotS) && Math.min(7, Math.floor(X.cmc)) === slotS) push(0.15, 'curva', tx('Curva: já tens {n} cartas de {mv} de mana', { n: s.curve[slotS], mv: slotS }))
        else if (s.avgMv > 3.8 && X.cmc >= 5 && X.cmc > S.cmc && !reanTarget(X) && !altCost(X)) push(0.1, 'curva', tx('Deck pesado (MV médio {m}); esta custa {mv}', { m: num(s.avgMv, 1), mv: X.cmc }))
        const k = strain(X)
        if (k && !strain(S) && !hard) push(0.12, 'linha fraca', tx('Pede {k}, a cor de splash do deck', { k }))
        if (opts.co && cmds.length) {  // só com comandante: fora disso o EDHREC não diz nada sobre a carta
          const e = cmdE(X), eS = cmdE(S)
          if (!e) push(0.08, 'fora do plano', tx('Fora das cartas mais jogadas com o comandante (EDHREC)'))
          else if (edhVal(S) - edhVal(X) >= 0.15) push(0.15, 'fora do plano', tx('Com {c}: em {a}% dos decks; a sugestão em {b}% (EDHREC)', { c: e.from, a: Math.round(e.incl * 100), b: Math.round((eS?.incl || 0) * 100) }))
        }
      }
      // preço: as duas cartas
      const prX = priceOf(X), prS = priceOf(S)
      if (budget && prX > budget && !(prS > budget)) push(0.15, 'linha fraca', tx('Acima do orçamento ({p} €)', { p: num(prX, 2) }))
      else if (prX != null && prS != null && prX - prS >= 3 && prX >= 2 * prS) push(budget ? 0.12 : 0.04, 'linha fraca', tx('Poupas {d} € por cópia ({x} € → {s} €)', { d: num(prX - prS, 2), x: num(prX, 2), s: num(prS, 2) }))
      if (!ax.length) continue

      // contra: função abaixo da meta, staples, muito jogada com o comandante, mexer na curva, a sugestão é cara, rende nos jogos
      let pen = 0
      for (const t of X.tg) if (targets[t] && !S.tg.includes(t) && (s.tags[t] || 0) - q < targets[t] && (t !== 'wincon' || !winKind || /damage|drain/.test(winKind))) pen += 0.25
      if (edhOk ? X.er && X.er < 1000 && !(S.er < X.er) : mInc(X) >= 0.1 && !(mInc(S) > mInc(X))) pen += 0.3 // staple: só sai por outra ainda mais jogada
      if (role) pen += 0.08 * Math.max(0, S.cmc - X.cmc - 1) // trocar uma barata por uma bem mais cara mexe na curva
      if (role && X.cmc <= S.cmc && (edhOk ? X.er && (!S.er || X.er * 3 < S.er) : mInc(X) >= 0.05 && mInc(X) > 3 * mInc(S))) pen += 0.25 // a que sai parece a versão melhor
      if (deadS.length) pen += 0.15
      if (budget && prS > budget) pen += 0.2
      if (opts.co) pen += Math.max(0, edhVal(X) - edhVal(S)) // mais jogada com o comandante do que a sugestão
      if (cmds.length && cmdSim(X) >= 0.5 && cmdSim(X) > cmdSim(S)) pen += 0.2 // perto do comandante pelo texto
      if (x && wk && ev.units) pen += Math.min(0.3, 2 * x.units / ev.units) // contribui para a via de vitória do deck
      if (x && x.seen >= 3) pen += Math.max(0, Math.min(0.2, wrDelta(x)))
      const worse = ax.reduce((a, y) => a + y[0], 0)
      const score = rel + worse - pen
      ax.sort((a, b) => b[0] - a[0])
      const why = []
      if (role) {
        const cmc = ax.some(y => y[1] === 'mais caro')
        why.push(cmc ? (sharedFn.length ? tx('Mesmo papel ({r}): custa {a} para o que a sugestão faz por {b}', { r: role, a: X.cmc, b: S.cmc }) : tx('Mesmo papel ({r}), mas custa {a} em vez de {b}', { r: role, a: X.cmc, b: S.cmc })) : tx('Mesmo papel ({r})', { r: role }))
      }
      for (const y of ax) if (y[2] && why.length < 3) why.push(y[2])
      if (answers && why.length < 4) why.push(answers)
      for (const dr of deadS) why.push(refTxt(dr))
      res.push({ out: X.n, q, score: +score.toFixed(3), worse, why, kind: role && ax[0][1] === 'linha fraca' ? 'mesmo papel' : ax[0][1], zone: side ? 'side' : 'main', eur: eurDelta(S, X, q) })
    }
    res.sort((a, b) => b.score - a.score)
    const strip = ({ worse, ...r }) => r // eslint-disable-line no-unused-vars
    // «Claramente pior»: mesma função com um eixo a favor, ou sem função comum mas com motivos fortes.
    const clear = res.filter(r => r.score >= 0.3 && r.worse >= 0.12)
    if (clear.length) return Object.assign(clear.slice(0, limit).map(strip), { kept: kept.slice(0, 3) })
    // senão, a linha mais fraca com um motivo honesto
    const weak = res.find(r => r.score >= 0.15)
    if (!weak) return none(NO_SWAP, kept.slice(0, 3))
    const w = strip(weak)
    return Object.assign([{ ...w, kind: 'linha fraca', why: [WEAK, ...w.why].slice(0, 3) }], { kept: kept.slice(0, 3) })
  }
}
