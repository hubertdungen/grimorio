// Contas do Universo (mapa 3D): regiões por função, desempenho das cartas nos jogos, constelações do meta e o laço.
// Só funções puras sobre `data` (cartas, posições, embeddings); o desenho fica em Map3D.jsx e a interface em Views.jsx.
import { TAG_LABEL } from './data.js'
import { tx } from './i18n.js'

// funções com zona própria no mapa (sem «criatura», «condição de vitória», terrenos e respostas de sideboard)
export const REGION_TAGS = ['ramp', 'draw', 'removal', 'wipe', 'counter', 'tutor', 'protection', 'recursion', 'reanimate', 'tokens',
  'sacrifice', 'counters', 'lifegain', 'graveyard', 'etb', 'spellslinger', 'artifacts', 'enchantments', 'discard', 'evasion']

const at = (data, i) => [data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]]
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

// Regiões: para cada função, o sítio mais denso dessas cartas (amostra de até 500, raio = 12% do tamanho do mapa).
// O centro é a média dos vizinhos desse ponto; `i` é a carta mais perto do centro (para onde a câmara voa).
const REG = new WeakMap()
export function regionsOf(data) {
  if (REG.has(data)) return REG.get(data)
  let ext = 0
  for (let k = 0; k < data.pos.length; k++) ext = Math.max(ext, Math.abs(data.pos[k]))
  const R2 = (ext * 0.12) ** 2
  const out = []
  for (const t of REGION_TAGS) {
    const all = data.cards.filter(c => c.mt !== 'Land' && c.tg.includes(t)).map(c => c.i)
    if (all.length < 8) continue
    const step = Math.max(1, Math.floor(all.length / 500)), S = all.filter((_, k) => k % step === 0).map(i => ({ i, p: at(data, i) }))
    let best = null, bestN = -1
    for (const a of S) { let n = 0; for (const b of S) if (d2(a.p, b.p) < R2) n++; if (n > bestN) { bestN = n; best = a } }
    const near = S.filter(b => d2(best.p, b.p) < R2)
    const pos = [0, 1, 2].map(k => near.reduce((s, b) => s + b.p[k], 0) / near.length)
    const i = near.reduce((m, b) => (d2(b.p, pos) < d2(m.p, pos) ? b : m), near[0]).i
    out.push({ key: t, label: TAG_LABEL[t], pos, i, total: all.length })
  }
  REG.set(data, out)
  return out
}

// Desempenho de cada carta nos jogos do Coliseu (swap.js gameEvidence): s de −1 (pesa) a +1 (ganha jogos).
// Junta a diferença de % de vitórias com ela vista e sem ela (encolhida para 3 jogos médios de cada lado), a parte
// que fez da via de vitória e as vezes que ficou presa na mão. Só cartas vistas em 2+ jogos exatos.
export function perfOf(ev) {
  const out = new Map()
  if (!ev?.cards || !ev.exact) return out
  const p0 = ev.winsExact / ev.exact
  for (const [n, x] of Object.entries(ev.cards)) {
    if (x.seen < 2) continue
    const wr = (x.seenW + 3 * p0) / (x.seen + 3) - (ev.winsExact - x.seenW + 3 * p0) / Math.max(1, ev.exact - x.seen + 3)
    const share = ev.units ? x.units / ev.units : 0
    const dead = x.dead >= 2 && x.dead / x.seen >= 0.5
    const s = Math.max(-1, Math.min(1, wr * 2.5 + share * 2 - (dead ? 0.5 : 0)))
    const why = dead ? tx('Presa na mão em {d} de {n} jogos', { d: x.dead, n: x.seen })
      : tx('Com ela vista: {w} vitórias em {n} jogos', { w: x.seenW, n: x.seen }) + (share >= 0.1 ? ` · ${tx('{p} da via de vitória', { p: `${Math.round(share * 100)}%` })}` : '')
    out.set(n, { s, why })
  }
  return out
}

// «± Ajustar quantidades»: com os jogos, mais cópias das cartas que ganham e menos das que pesam, aos pares para o deck
// manter o tamanho. Só cartas que não são terreno vistas em 3+ jogos; nunca desce uma função abaixo da meta do formato
// (needs = {função: [tem, meta]}); maxOf(carta) = máximo de cópias (singleton → 1, e aí não há nada a ajustar).
export function adjustPlan(data, deck, ev, { needs = {}, maxOf = () => 4, n = 5, skip = new Set() } = {}) {
  const P = perfOf(ev), main = deck.main || {}
  const row = name => { const c = data.byName.get(name), p = P.get(name); return c && c.mt !== 'Land' && p && ev.cards[name].seen >= 3 ? { c, s: p.s, why: p.why, q: main[name] } : null }
  const all = Object.keys(main).filter(x => !skip.has(x)).map(row).filter(Boolean)  // skip: alvos de reanimação (ficar na mão é normal)
  const up = all.filter(r => r.s >= 0.3 && r.q < maxOf(r.c)).sort((a, b) => b.s - a.s)
  const down = all.filter(r => r.s <= -0.25 && r.q >= 2 && !r.c.tg.some(t => needs[t] && needs[t][0] - 1 < needs[t][1])).sort((a, b) => a.s - b.s)
  return Array.from({ length: Math.min(up.length, down.length, n) }, (_, i) => {
    const a = up[i], b = down[i]
    return { add: a, cut: b, k: a.s >= 0.6 && b.s <= -0.5 && maxOf(a.c) - a.q >= 2 && b.q >= 3 ? 2 : 1 }
  })
}

// «± Ajustar quantidades» quando o deck não tem o tamanho do formato: fecha a diferença com cópias, cada uma com o porquê.
// Faltam cartas: terrenos primeiro se faltarem para o alvo (o básico da cor com menos fontes), depois mais cópias das
// que ganham jogos, das que cobrem funções em falta e, por fim, das que já são o núcleo (mais cópias = mais consistência).
// Sobram: sai o que pesa nos jogos, terrenos a mais e cópias extra das menos centrais. Sem jogos também funciona.
const BASIC = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
export function sizePlan(data, deck, ev, { min, max = Infinity, maxOf = () => 4, need = null, needs = {} } = {}) {
  const main = deck.main || {}, total = Object.values(main).reduce((a, q) => a + q, 0) + (deck.commanders?.length || 0)
  const gap = total < min ? min - total : total > max ? max - total : 0
  if (!gap) return { total, gap, items: [] }
  const P = perfOf(ev), q = { ...main }, items = []
  const put = (c, k, why) => { const e = items.find(x => x.c === c); if (e) e.k += k; else items.push({ c, k, why }); q[c.n] = (q[c.n] || 0) + k }
  const cards = Object.keys(main).map(n => data.byName.get(n)).filter(Boolean)
  let left = Math.abs(gap)
  const lands = need ? need.lands : cards.filter(c => c.mt === 'Land').reduce((a, c) => a + main[c.n], 0)
  if (gap > 0) {
    // 1) terrenos até ao alvo, pela cor mais em falta
    let lg = need ? Math.max(0, need.target - lands) : 0
    while (left > 0 && lg > 0) {
      const short = Object.entries(need.cols || {}).filter(([k]) => BASIC[k]).sort((a, b) => (b[1].full - b[1].have) - (a[1].full - a[1].have))[0]
      const c = short && data.byName.get(BASIC[short[0]])
      if (!c) break
      put(c, 1, tx('faltam terrenos: {h} para ~{t}', { h: lands, t: need.target })); short[1].have++; lg--; left--
    }
    // 2) mais cópias: as que ganham, as que cobrem funções em falta, as do núcleo
    const can = c => c.mt !== 'Land' && (q[c.n] || 0) < maxOf(c)
    const score = c => { const p = P.get(c.n), fn = c.tg.filter(t => needs[t] && needs[t][0] < needs[t][1]); return (p ? p.s * 2 : 0) + fn.length * 0.4 + Math.min(4, main[c.n] || 0) * 0.1 }
    const why = c => { const p = P.get(c.n), fn = c.tg.filter(t => needs[t] && needs[t][0] < needs[t][1])
      return p && p.s > 0.2 ? p.why : fn.length ? tx('reforça {f} ({h}/{n})', { f: TAG_LABEL[fn[0]]?.toLowerCase() || fn[0], h: needs[fn[0]][0], n: needs[fn[0]][1] }) : tx('mais consistência: é das cartas centrais do deck') }
    while (left > 0) {
      const c = cards.filter(can).sort((a, b) => score(b) - score(a))[0]
      if (!c) break
      put(c, 1, why(c)); left--
    }
  } else {
    // sobram: o que pesa, terrenos a mais, cópias extra das menos centrais
    let lx = need ? Math.max(0, lands - need.target) : 0
    const basics = Object.values(BASIC).map(n => data.byName.get(n)).filter(c => c && main[c.n])
    while (left > 0 && lx > 0 && basics.length) {
      const c = basics.sort((a, b) => (q[b.n] || 0) - (q[a.n] || 0))[0]
      if ((q[c.n] || 0) <= 1) break
      put(c, -1, tx('terrenos a mais: {h} para ~{t}', { h: lands, t: need.target })); lx--; left--
    }
    const weak = c => { const p = P.get(c.n); return (p ? p.s * 2 : 0) + Math.min(4, main[c.n] || 0) * 0.1 }
    while (left > 0) {
      const c = cards.filter(c => c.mt !== 'Land' && (q[c.n] || 0) > 0).sort((a, b) => weak(a) - weak(b))[0]
      if (!c) break
      const p = P.get(c.n)
      put(c, -1, p && p.s < -0.2 ? p.why : tx('das menos centrais do deck')); left--
    }
  }
  return { total, gap, items }
}

// «🧩 Preencher o deck»: com cartas a menos (qualquer formato, Commander incluído), as cartas NOVAS que o fecham, pela
// ordem: terrenos até ao alvo (sugestões de terrenos, depois básicos da cor em falta), cartas que cobrem funções em
// falta, e as melhores sugestões. recs = sugestões (sem terrenos) e lands = recommendLands, já legais e fora do deck.
// estratégias: equilibrada (terrenos → funções em falta → melhores), plano (terrenos → melhores), interacao (terrenos →
// remoção/contra-feitiços/proteção → melhores), curva (terrenos → as mais baratas entre as 40 melhores)
const INTER = ['removal', 'counter', 'wipe', 'protection', 'hate']
export function fillPlan(data, deck, { min, recs = [], lands = [], need = null, needs = {}, strategy = 'equilibrada' } = {}) {
  const main = deck.main || {}, total = Object.values(main).reduce((a, q) => a + q, 0) + (deck.commanders?.length || 0)
  const gap = Math.max(0, min - total)
  if (!gap) return { total, gap, items: [] }
  const items = [], used = new Set()
  const put = (c, k, why) => { const e = items.find(x => x.c === c); if (e) e.k += k; else items.push({ c, k, why }); used.add(c.n) }
  let left = gap
  // 1) terrenos até ao alvo
  let lg = need ? Math.min(left, Math.max(0, need.target - need.lands)) : 0
  const lw = need ? tx('faltam terrenos: {h} para ~{t}', { h: need.lands, t: need.target }) : ''
  for (const l of lands) { if (lg <= 0) break; if (used.has(l.c.n)) continue; put(l.c, 1, [lw, ...(l.why || []).slice(0, 1).map(w => w.txt || w)]); lg--; left-- }
  const cols = Object.entries(need?.cols || {}).filter(([k]) => BASIC[k]).map(([k, x]) => ({ k, gap: x.full - x.have }))
  while (lg > 0 && cols.length) {  // básicos (podem repetir-se em qualquer formato)
    cols.sort((a, b) => b.gap - a.gap)
    const c = data.byName.get(BASIC[cols[0].k]); if (!c) break
    put(c, 1, [lw, tx('a cor com menos fontes')]); cols[0].gap--; lg--; left--
  }
  // 2) conforme a estratégia: funções em falta, interação ou curva; 3) as melhores sugestões
  const syn = r => Object.entries(r.parts || {}).filter(([k]) => /texto|comandante|tribo|combo|inter|semente/.test(k)).reduce((a, [, v]) => a + v, 0)  // sinergia com o deck
  const pool = strategy === 'curva' ? [...recs.slice(0, 40)].sort((a, b) => a.c.cmc - b.c.cmc) : strategy === 'plano' ? [...recs.slice(0, 60)].sort((a, b) => syn(b) - syn(a)) : recs
  if (strategy === 'interacao') for (const r of pool) {
    if (left <= 0) break
    if (used.has(r.c.n) || main[r.c.n] || !r.c.tg.some(t => INTER.includes(t))) continue
    put(r.c, 1, [tx('interação: {f}', { f: r.c.tg.filter(t => INTER.includes(t)).map(t => TAG_LABEL[t]?.toLowerCase() || t).join(', ') }), ...(r.why || []).slice(0, 1).map(w => w.txt)]); left--
  }
  const short = strategy === 'equilibrada' ? Object.entries(needs).filter(([, [h, n]]) => h < n).map(([t, [h, n]]) => ({ t, miss: n - h })) : []
  for (const r of short.length ? pool : []) {
    if (left <= 0) break
    if (used.has(r.c.n) || main[r.c.n]) continue
    const s = short.find(x => x.miss > 0 && r.c.tg.includes(x.t))
    if (!s) continue
    put(r.c, 1, [tx('cobre {f} ({h}/{n})', { f: TAG_LABEL[s.t]?.toLowerCase() || s.t, h: needs[s.t][1] - s.miss, n: needs[s.t][1] }), ...(r.why || []).slice(0, 1).map(w => w.txt)]); s.miss--; left--
  }
  for (const r of pool) {
    if (left <= 0) break
    if (used.has(r.c.n) || main[r.c.n]) continue
    put(r.c, 1, [...(strategy === 'curva' ? [tx('custo {m}', { m: r.c.cmc })] : []), ...(r.why || []).slice(0, 2).map(w => w.txt)]); left--
  }
  const spells = items.filter(x => x.c.mt !== 'Land'), lands_ = items.filter(x => x.c.mt === 'Land').reduce((a, x) => a + x.k, 0)
  return { total, gap, items, lands: lands_, mv: spells.length ? spells.reduce((a, x) => a + x.c.cmc * x.k, 0) / spells.reduce((a, x) => a + x.k, 0) : 0 }
}

// Constelações do meta: cada arquétipo no centro (pesado pela inclusão) das cartas do núcleo; fit = parte do núcleo
// que o deck já tem (como detectArchetype); missing = o que falta, do mais jogado para o menos.
export function archetypesOf(data, meta, have) {
  if (!meta?.archetypes?.length) return []
  const H = new Set(have)
  return meta.archetypes.map(a => {
    const core = a.core.filter(x => x.i != null)
    const w = core.reduce((s, x) => s + x.incl, 0) || 1
    const pos = [0, 1, 2].map(k => core.reduce((s, x) => s + data.pos[x.i * 3 + k] * x.incl, 0) / w)
    const fit = core.filter(x => H.has(x.i)).reduce((s, x) => s + x.incl, 0) / w
    return { key: a.name, name: a.name, share: a.share, pos, fit, core, missing: core.filter(x => !H.has(x.i)).sort((p, q) => q.incl - p.incl) }
  })
}

// Laço: ponto dentro do polígono (contagem de cruzamentos)
export function inPoly(x, y, poly) {
  let inside = false
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a], [xb, yb] = poly[b]
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside
  }
  return inside
}

// As melhores cartas de uma zona para o deck: as sugestões que lá caem primeiro (pela ordem delas), depois as outras
// pela semelhança de texto ao deck inteiro (soma dos embeddings das cartas que não são terreno).
export function rankZone(data, idxs, have, recs, ok, n = 12) {
  const H = new Set(have), byRec = new Map(recs.map((r, k) => [r.c.i, k]))
  const sum = new Float32Array(data.D)
  for (const i of have) if (data.cards[i].mt !== 'Land') for (let k = 0; k < data.D; k++) sum[k] += data.emb[i * data.D + k]
  const sim = i => { let d = 0; for (let k = 0; k < data.D; k++) d += sum[k] * data.emb[i * data.D + k]; return d }
  return idxs.filter(i => !H.has(i) && data.cards[i].mt !== 'Land' && ok(data.cards[i]))
    .map(i => ({ i, r: byRec.has(i) ? byRec.get(i) : 1e9, s: sim(i) }))
    .sort((a, b) => a.r - b.r || b.s - a.s).slice(0, n).map(x => x.i)
}

export function selfcheck() {
  const ok = (c, m) => { if (!c) throw new Error(`universe selfcheck: ${m}`) }
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]]
  ok(inPoly(5, 5, sq) && !inPoly(15, 5, sq) && !inPoly(-1, -1, sq), 'inPoly')
  const ev = { exact: 10, winsExact: 5, units: 20, cards: { Good: { seen: 6, seenW: 5, dead: 0, units: 10 }, Bad: { seen: 6, seenW: 1, dead: 4, units: 0 }, Rare: { seen: 1, seenW: 1, dead: 0, units: 0 } } }
  const p = perfOf(ev)
  ok(p.get('Good').s > 0.5 && p.get('Bad').s < -0.5 && !p.has('Rare'), 'perfOf')
  const data = { byName: new Map([['Good', { mt: 'Creature', tg: [] }], ['Bad', { mt: 'Instant', tg: ['removal'] }]]) }
  const deck = { main: { Good: 2, Bad: 3 } }
  ok(adjustPlan(data, deck, ev)[0]?.add.c === data.byName.get('Good') && adjustPlan(data, deck, ev)[0].cut.q === 3, 'adjustPlan')
  ok(!adjustPlan(data, deck, ev, { needs: { removal: [3, 3] } }).length, 'adjustPlan respeita as metas')
  return true
}
