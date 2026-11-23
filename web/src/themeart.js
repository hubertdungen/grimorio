// 🎨 Artes do tema: um deck com tema (o universo do «Gosto de…» ou o do comandante, ex.: Marneus Calgar → Warhammer
// 40,000) passa a usar as impressões desse universo nas cartas que as têm (o Sol Ring, a Command Tower e os básicos dos
// precons 40K). Quais cartas têm impressão lá diz o vocabulário (vocab.js setMembers: índice da carta por edição);
// o id/número de cada impressão vem da Scryfall (/cards/collection com {name, set}, 75 por pedido, sem imagens).
// As impressões ficam em deck.prints[nome] como as do «Escolher arte», com theme = o universo; as escolhidas à mão
// (sem theme), as artes próprias (deck.art) e as divisões por cópias (deck.split, ex.: as favoritas dos básicos) ficam,
// salvo «Substituir também as escolhidas» (as artes próprias ficam sempre).
import { VOC, setGroup, flavorOf, norm } from './vocab.js'

// o universo de uma edição: o mais pequeno que a tem (Spider-Man antes de Marvel; «Universes Beyond» é só o guarda-chuva)
export function universeOf(code) {
  let best = null
  for (const f of VOC.fr.values()) if (f.id !== 'ub' && f.sets.includes(code) && (!best || f.sets.length < best.sets.length)) best = f
  return best?.id || null
}

// um tema: { v, name, tag (para o botão: 40K, LTR, Marvel), sets (a edição do comandante primeiro), from }
export function makeTheme(v, from = 'set', lead = null) {
  const f = VOC.fr.get(v), s = VOC.sets.get(v), sets = setGroup(v)
  if (!sets.length && !f?.extra?.length) return null
  return { v, from, name: f?.name || s?.name || v.toUpperCase(), tag: s || !f ? v.toUpperCase() : f.name,
    sets: lead && sets.includes(lead) ? [lead, ...sets.filter(x => x !== lead)] : sets }
}

// os temas do deck, o mais forte primeiro: os universos/edições do «Gosto de…» e o universo onde o comandante nasceu
export function artThemes(data, deck) {
  if (!VOC.on) return []
  const out = [], push = th => { if (th && !out.some(x => x.v === th.v)) out.push(th) }
  for (const t of deck.seedTerms || []) if (t.k === 'set') push(makeTheme(t.v, 'like'))
  for (const n of deck.commanders || []) {
    const c = data.byName.get(n), code = c && VOC.first[c.i], u = code && universeOf(code)
    if (u) push(makeTheme(u, 'cmd', code))
  }
  return out
}

// para o escolher à mão: os temas e também a edição onde o comandante nasceu, mesmo fora de um universo (C16, CMM…)
export function themeOptions(data, deck) {
  const out = artThemes(data, deck)
  for (const n of deck.commanders || []) {
    const c = data.byName.get(n), code = c && VOC.first[c.i]
    if (code && !out.some(x => x.v === code || x.sets.includes(code))) { const th = makeTheme(code, 'cmdset'); if (th) out.push(th) }
  }
  return out
}

// procurar qualquer edição ou universo pelo nome ou pelo código
export function findThemes(q, limit = 8) {
  const w = norm(q || '')
  if (!VOC.on || w.length < 2) return []
  const out = []
  for (const f of VOC.fr.values()) if (norm(f.name).includes(w) || f.id === w || f.alias.some(a => norm(a).includes(w))) out.push(f.id)
  for (const s of VOC.sets.values()) if (!out.includes(s.code) && (s.code === w || norm(s.name).includes(w))) out.push(s.code)
  return out.map(v => makeTheme(v, 'set')).filter(Boolean).slice(0, limit)
}

const deckNames = d => [...new Set([...(d.commanders || []), ...Object.keys(d.main || {}), ...Object.keys(d.side || {}), ...Object.keys(d.maybe || {})])]

// que cartas mudam: items = [{ n, set }] (para pedir à Scryfall) ou [{ n, print }] (impressão com nome do universo, já
// conhecida pelo vocabulário: o Megatron da Secret Lair); skip = quantas ficaram (arte própria, escolhida à mão)
export function themePlan(data, deck, th, { replace = false } = {}) {
  const items = [], skip = { own: 0, chosen: 0, have: 0 }
  if (!th) return { items, skip }
  const mine = new Set(th.sets)
  for (const n of deckNames(deck)) {
    const c = data.byName.get(n)
    if (!c) continue
    const set = th.sets.find(k => VOC.sets.get(k)?.m.has(c.i)), fl = set ? null : flavorOf(c, th.v)
    if (!set && !fl) continue
    const cur = deck.prints?.[n]
    if (deck.art?.[n]) { skip.own++; continue }
    if (cur && (cur.theme === th.v || (cur.theme && mine.has(String(cur.set).toLowerCase())))) { skip.have++; continue }
    if (!replace && ((cur && !cur.theme) || deck.split?.[n]?.length)) { skip.chosen++; continue }
    items.push(set ? { n, set } : { n, print: { id: fl.id, set: fl.set.toUpperCase(), cn: fl.cn, style: [], foil: false } })
  }
  return { items, skip }
}

export const chunks = (l, k = 75) => { const out = []; for (let i = 0; i < l.length; i += k) out.push(l.slice(i, i + k)); return out }

// a impressão preferida entre as que vieram para uma carta: papel, moldura normal; sem margem/showcase só se não houver
const odd = p => (p.style || []).length
export const bestPrint = l => l.filter(p => !p.digital).sort((a, b) => odd(a) - odd(b))[0] || null

// aplica o que veio (found: Map nome em minúsculas → impressão) ao deck como está agora; volta a ver as regras, porque o
// deck pode ter mudado durante o pedido
export function applyTheme(deck, th, items, found, { replace = false } = {}) {
  const prints = { ...(deck.prints || {}) }, split = { ...(deck.split || {}) }
  let n = 0
  for (const it of items) {
    const p = it.print || found.get(it.n.toLowerCase()) || found.get(it.n.split(' // ')[0].toLowerCase())
    if (!p || deck.art?.[it.n]) continue
    const cur = prints[it.n]
    if (!replace && ((cur && !cur.theme) || split[it.n]?.length)) continue
    prints[it.n] = { id: p.id, set: p.set, cn: p.cn, eur: p.eur ?? null, eurFoil: p.eurFoil ?? null, style: p.style || [], foil: false, theme: th.v }
    delete split[it.n]
    n++
  }
  return n ? { deck: { ...deck, prints, split }, n } : { deck, n: 0 }
}
