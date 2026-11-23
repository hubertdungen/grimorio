// 🔍 Comparar com outro deck (Sugestões): quão parecido é, o que ele tem a mais ou a menos por função e mecânica (com o juízo
// do Grimório: é bom ou mau para o TEU deck?) e as cartas dele que te servem, cada uma com a tua que sai.
import { TAG_LABEL, passes } from './data.js'
import { tx } from './i18n.js'

const BASIC = /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/
const isLand = c => c?.mt === 'Land'

// as cartas que contam para a semelhança: sem terrenos básicos nem o comandante; nome da frente das cartas duplas
export const keyOf = (data, n) => {
  const c = data.byName.get(n) || data.byLower.get(String(n).toLowerCase()) || data.byLower.get(String(n).split(' // ')[0].toLowerCase())
  return c ? c.n : null
}
export function cardSet(data, main, commanders = []) {
  const s = new Set()
  for (const n of [...Object.keys(main || {}), ...commanders]) { const k = keyOf(data, n); if (k && !BASIC.test(k)) s.add(k) }
  return s
}

// parecença: que parte das TUAS cartas (sem básicos) o outro também joga; mesmo comandante conta à parte
export function likeness(mine, other, myCmds = [], oCmds = []) {
  let shared = 0
  for (const n of mine) if (other.has(n)) shared++
  const sameCmd = myCmds.length > 0 && myCmds.some(n => oCmds.includes(n))
  return { shared, pct: mine.size ? shared / mine.size : 0, sameCmd }
}
export const likeLabel = l => (l.sameCmd && l.pct >= 0.2) || l.pct >= 0.35 ? 'muito' : l.pct >= 0.15 || l.sameCmd ? 'parecido' : 'pouco'

// perfil de um deck: funções (etiquetas), tipos, terrenos, MV médio e remoção instantânea
const ROLE_TAGS = ['removal', 'wipe', 'ramp', 'draw', 'counter', 'protection', 'recursion', 'reanimate', 'tutor', 'creature', 'wincon',
  'tokens', 'sacrifice', 'counters', 'mill', 'graveyard', 'discard', 'spellslinger', 'etb', 'blink', 'landfall', 'lifegain', 'burn', 'evasion', 'selection', 'artifacts', 'enchantments', 'stax']
export function profile(data, main, commanders = []) {
  const P = { tags: {}, lands: 0, spells: 0, mv: 0, inst: 0, sorc: 0, instRemoval: 0, total: 0 }
  for (const [n, q] of [...Object.entries(main || {}), ...commanders.map(n => [n, 1])]) {
    const c = data.byName.get(keyOf(data, n))
    if (!c) continue
    P.total += q
    if (isLand(c)) { P.lands += q; continue }
    P.spells += q; P.mv += c.cmc * q
    for (const t of c.tg) P.tags[t] = (P.tags[t] || 0) + q
    const fast = /Instant/.test(c.t) || /\bFlash\b/.test(c.o)
    if (/Instant/.test(c.t)) P.inst += q
    if (/Sorcery/.test(c.t)) P.sorc += q
    if (fast && (c.tg.includes('removal') || c.tg.includes('counter'))) P.instRemoval += q
  }
  P.avgMv = P.spells ? P.mv / P.spells : 0
  return P
}

// pares fonte → recompensa: «ele tem mais X, que alimenta as tuas Y»
const SYN = [
  [['mill', 'discard', 'selection'], ['recursion', 'reanimate', 'graveyard'], 'Ele enche mais o cemitério ({t}: +{d}), o que alimenta as tuas {n} cartas que vão buscar ao cemitério.'],
  [['tokens'], ['sacrifice'], 'Ele cria mais fichas (+{d}): mais alimento para as tuas {n} cartas de sacrifício.'],
  [['sacrifice'], ['tokens'], 'Ele tem mais formas de sacrificar (+{d}): tiram mais proveito das tuas {n} cartas de fichas.'],
  [['etb'], ['blink'], 'Ele tem mais criaturas com efeito ao entrar (+{d}): cada blink teu vale mais ({n} cartas de blink).'],
  [['blink'], ['etb'], 'Ele tem mais blink (+{d}): repete as tuas {n} entradas (ETB).'],
  [['ramp'], ['landfall'], 'Ele tem mais ramp (+{d}): mais terrenos a entrar para as tuas {n} cartas de landfall.'],
  [['spellslinger', 'draw'], ['spellslinger'], 'Ele lança mais instantâneos e feitiços (+{d}): mais gatilhos para as tuas {n} cartas que os pedem.'],
  [['counters'], ['counters'], 'Ele aposta mais em marcadores (+{d}), o tema que as tuas {n} cartas já seguem.'],
]

// as dicas: só as diferenças que contam (2+ cartas ou 25%+), cada uma com o juízo para o teu deck
export function compareTips(A, B, { needs = {}, targets = {}, N = null, scale = 1 }) {
  const out = []
  const tB = t => Math.round((B.tags[t] || 0) * scale), tA = t => A.tags[t] || 0
  const big = (a, b, low) => Math.abs(a - b) >= (low ? 2 : 3) && Math.abs(a - b) >= 0.25 * Math.max(a, b, 1)
  const lands = Math.round(B.lands * scale)
  if (Math.abs(lands - A.lands) >= 2) {
    const tgt = N?.target
    const closer = tgt != null && Math.abs(lands - tgt) < Math.abs(A.lands - tgt)
    out.push({ k: 'land', good: closer, txt: tx('Terrenos: tens {a}, ele tem {b}.', { a: A.lands, b: lands }) + ' ' +
      (tgt == null ? '' : closer ? tx('Para a tua curva o alvo é ~{t}: o número dele está mais perto, vale a pena mudar.', { t: tgt }) : tx('Para a tua curva o alvo é ~{t}: o teu número já está melhor.', { t: tgt })) })
  }
  if (Math.abs(B.avgMv - A.avgMv) >= 0.3) out.push({ k: 'mv', good: B.avgMv < A.avgMv, txt: B.avgMv < A.avgMv
    ? tx('A curva dele é mais baixa (MV médio {b} contra {a}): joga mais depressa. Corta as tuas cartas mais caras primeiro.', { a: A.avgMv.toFixed(2), b: B.avgMv.toFixed(2) })
    : tx('A curva dele é mais alta (MV médio {b} contra {a}): a tua é mais rápida, não a subas sem razão.', { a: A.avgMv.toFixed(2), b: B.avgMv.toFixed(2) }) })
  const ir = Math.round(B.instRemoval * scale)
  if (big(A.instRemoval, ir)) out.push({ k: 'inst', good: ir > A.instRemoval, txt: ir > A.instRemoval
    ? tx('Ele tem mais respostas instantâneas (remoção/contra-feitiço a instante ou flash: {b} contra {a}): responde no turno dos outros.', { a: A.instRemoval, b: ir })
    : tx('Tens mais respostas instantâneas do que ele ({a} contra {b}).', { a: A.instRemoval, b: ir }) })
  const synOut = []
  for (const [src, pay, txt] of SYN) {
    const n = pay.reduce((s, t) => s + tA(t), 0)
    const d = src.reduce((s, t) => s + tB(t) - tA(t), 0)
    if (n >= 3 && d >= 2) synOut.push({ k: 'syn-' + src[0], src, good: true, syn: true, txt: tx(txt, { d, n, t: src.map(t => (TAG_LABEL[t] || t).toLowerCase()).join('/') }) })
  }
  const inSyn = new Set(synOut.flatMap(x => x.src))
  for (const t of ROLE_TAGS) {
    const a = tA(t), b = tB(t), tgt0 = needs[t]?.[1] ?? targets[t]
    if (inSyn.has(t) || !big(a, b, tgt0 != null && a < tgt0)) continue
    const tgt = tgt0, L = (TAG_LABEL[t] || t).toLowerCase()
    if (b > a) {
      const low = tgt != null && a < tgt
      if (a <= 1 && b >= 4) out.push({ k: t, good: null, more: true, txt: tx('Ele usa uma mecânica que tu quase não tens: {l} ({b} cartas). Vê as cartas abaixo se te interessar.', { l: L, b }) })
      else out.push({ k: t, good: low ? true : null, more: true, txt: low ? tx('Ele tem mais {l} ({b} contra {a}) e tu estás abaixo do alvo ({a}/{t}): boa fonte de ideias.', { l: L, a, b, t: tgt })
        : tx('Ele tem mais {l} ({b} contra {a}).', { l: L, a, b }) })
    } else {
      const over = tgt != null && a > tgt + 2
      out.push({ k: t, good: over ? false : null, txt: over ? tx('Tens mais {l} do que ele ({a} contra {b}) e acima do alvo ({t}): há espaço para cortar aqui.', { l: L, a, b, t: tgt })
        : tx('Tens mais {l} do que ele ({a} contra {b}).', { l: L, a, b }) })
    }
  }
  out.push(...synOut)
  // primeiro as sinergias e o que te faz falta, depois o resto
  const rank = x => (x.syn ? 0 : x.good === true ? 1 : x.good === false ? 2 : x.more ? 3 : 4)
  return out.sort((x, y) => rank(x) - rank(y))
}

// As cartas dele que te servem (legais e nas tuas cores), primeiro as que dão o que te falta; cada uma com a tua que sai:
// igual por igual se já tens que chegue dessa função, a tua mais fraca fora do que te falta se não. Cortes: as tuas cartas
// que ele não joga, da mais fraca para a mais forte (cutQueue). Terrenos trocam por um básico.
export function comparePlan(data, deck, other, { ctx, needs = {}, queue = [], roleQ = null, per = 12, more = {}, have = {}, targets = {} }) {
  const mine = new Set([...Object.keys(deck.main), ...deck.commanders])
  const low = t => needs[t] && needs[t][0] < needs[t][1]
  const adds = []
  for (const n of other) {
    const c = data.byName.get(n)
    if (!c || mine.has(c.n) || BASIC.test(c.n) || !passes(c, null, ctx)) continue
    const fills = c.tg.filter(low)
    adds.push({ c, fills, score: fills.reduce((s, t) => s + (t === 'creature' ? 0.4 : 1.5), 0) + c.tg.reduce((s, t) => s + (more[t] > 0 ? Math.min(1, 0.3 * more[t]) : 0), 0) + (roleQ ? roleQ(c) : 0) + (c.er ? Math.max(0, 1 - Math.log(c.er) / 9) : 0) })
  }
  adds.sort((a, b) => b.score - a.score)
  // variedade: no máximo 4 seguidas da mesma função principal (senão eram 12 criaturas)
  const seen = {}, picked = [], rest = []
  for (const a of adds) { const t = a.c.tg.find(t => CORE.includes(t)) || a.c.mt; (seen[t] = (seen[t] || 0) + 1) <= 4 ? picked.push(a) : rest.push(a) }
  adds.splice(0, adds.length, ...picked, ...rest)
  const cuts = queue.filter(x => !other.has(x.c.n))
  const used = new Set(), out = [], cnt = { ...have }
  const basics = Object.keys(deck.main).filter(n => BASIC.test(n)).sort((a, b) => deck.main[b] - deck.main[a])
  let bi = 0
  for (const a of adds.slice(0, per)) {
    let cut = null
    if (isLand(a.c)) {
      const b = basics.find((n, i) => i >= bi && deck.main[n] > 1) || basics[bi]
      if (b) { cut = { c: data.byName.get(b), why: [tx('Um básico dá lugar a um terreno que ele usa')] }; bi += deck.main[b] > 2 ? 0 : 1 }
    } else {
      const same = !a.fills.length && a.c.tg.find(t => CORE.includes(t))  // função que já tens que chegue: sai uma tua igual
      const pool = cuts.filter(x => !used.has(x.c.n) && !isLand(x.c) && !x.c.tg.some(low))
      // a que sai só leva funções que a nova também faz, ou de que o deck tem de sobra (acima do alvo; remoção: 2+ acima)
      const covered = x => x.c.tg.filter(t => CORE.includes(t)).every(t => a.c.tg.includes(t) ||
        (cnt[t] ?? 0) - 1 >= (needs[t]?.[1] ?? targets[t] ?? 0) + (t === 'removal' || t === 'wipe' ? 2 : 0))
      const tgtOf = t => needs[t]?.[1] ?? targets[t] ?? 0
      // sem nenhuma de sobra: a mais fraca que não seja remoção, com o aviso do que fica abaixo do alvo
      const soft = !pool.some(covered) && pool.find(x => x.c.tg.every(t => a.c.tg.includes(t) || !CORE.includes(t) ||
        (t !== 'removal' && t !== 'wipe' && (cnt[t] ?? 0) - 1 >= tgtOf(t) - 1)))  // no máximo 1 abaixo do alvo, nunca remoção
      const pick = (same && pool.find(x => x.c.tg.includes(same) && covered(x))) || pool.find(covered) || soft
      const warn = pick && pick === soft ? pick.c.tg.filter(t => CORE.includes(t) && !a.c.tg.includes(t)).map(t => `${(TAG_LABEL[t] || t).toLowerCase()} ${(cnt[t] ?? 0) - 1}/${tgtOf(t)}`) : []
      if (pick) { used.add(pick.c.n); cut = { c: pick.c, why: [...(warn.length ? [tx('Fica abaixo do alvo: {l}', { l: warn.join(', ') })] : []), ...pick.why.slice(0, 2)] }; for (const t of pick.c.tg) cnt[t] = (cnt[t] || 0) - 1; for (const t of a.c.tg) cnt[t] = (cnt[t] || 0) + 1 } else if (pool.length) cut = { none: true }  // só sairia uma com função que a nova não faz: escolhes tu
    }
    out.push({ add: a, cut })
  }
  return { swaps: out, cuts: cuts.filter(x => !isLand(x.c)).slice(0, 8), more: Math.max(0, adds.length - per) }
}

const CORE = ['removal', 'wipe', 'ramp', 'draw', 'counter', 'protection', 'recursion', 'tutor', 'wincon']

// slug do EDHREC: «Teval, the Balanced Scale» → teval-the-balanced-scale (cartas duplas: a frente)
export const edhSlug = n => String(n).split(' // ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['",.!?:]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
