// Sinergias gerais do deck (além dos combos fechados do Commander Spellbook): categorias com
// quem «ativa» (enablers) e quem «beneficia» (payoffs), por padrões no texto, tipo e palavras-chave.
// Puro: corre no browser e no node (selfcheck).
import { RB, passes, colorsOf } from './data.js'

// Texto em minúsculas sem lembretes entre parênteses (o «(Equip only as a sorcery.)» confunde os padrões).
const txt = c => (c._so ??= c.o.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^.]*doesn't remove[^.]*\./g, ''))
const isT = (c, re) => re.test(c.t.split(' // ')[0])
const kw = (c, k) => c.kw?.includes(k)
const nonland = c => !isT(c, /Land/)
const creature = c => isT(c, /Creature/)
const evasive = c => creature(c) && c.cmc <= 3 && (/can't be blocked|\bshadow\b|\bmenace\b|\bfear\b|\bintimidate\b/.test(txt(c)) || kw(c, 'Flying'))
// «sacrifica X» no imperativo (és tu quem sacrifica), não «each opponent sacrifices»
const sacYou = /(^|[.:,•—]\s*|additional cost[^.]*?)sacrifice (a|an|another|x|any number of|one or more) (creatures?|artifacts?|permanents?|tokens?|nontoken)/m

/**
 * Categorias. en/pay: (c, o) => bool, com o = texto em minúsculas.
 * core: o lado estreito, cuja presença sozinha já indica o tema ('en', 'pay' ou 'both').
 * lands: os terrenos contam (artefactos-terreno, fetches).
 */
export const SYN = [
  { k: 'equip', ic: '⚔', name: 'Equipamentos', core: 'both',
    why: 'Equipamentos baratos transformam criaturas pequenas em ameaças; as que gostam de estar equipadas, reduzem o custo de equipar ou vão buscar equipamentos fazem cada um valer a dobrar.',
    en: (c, o) => isT(c, /Equipment/) || /search your library for an? (artifact or )?equipment|create[^.]*equipment|attach (target|an|any number of|up to \w+)[^.]*equipment/.test(o),
    pay: (c, o) => /\b(is|are|was) equipped|equipped creatures you control|whenever (an|a|one or more) equipment|equipment you control|equip abilities|equip costs?|for each equipment|equipment attached|whenever[^.]*becomes equipped|equipment (spells|cards) you cast/.test(o) || (!isT(c, /Equipment/) && /\bequip \{0\}/.test(o)) },
  { k: 'art', ic: '⚙', name: 'Artefactos e tesouros', core: 'pay', lands: true,
    why: 'Muitos artefactos (incluindo terrenos-artefacto, tesouros e pistas) ligam metalcraft, affinity e quem conta ou sacrifica artefactos.',
    en: c => (c.ro & RB.artifactMaker) || isT(c, /Artifact/),
    pay: (c, o) => (c.ro & RB.artifactPayoff) || /for each artifact|sacrifice (an|another|a) artifact|artifact spells? (you cast )?cost|whenever you sacrifice[^.]*artifact|treasures? you control/.test(o) },
  { k: 'tokens', ic: '✦', name: 'Fichas e go-wide', core: 'pay',
    why: 'Quem gera fichas enche a mesa; anthems, convoke e «por cada criatura» convertem a largura em dano ou recursos.',
    en: c => c.ro & RB.tokenMaker,
    pay: (c, o) => (c.ro & RB.tokenPayoff) || /creatures you control get \+|for each creature you control(?! with)|\bconvoke\b|\bpopulate\b|whenever one or more (other )?(creatures|tokens) you control (enter|attack)/.test(o) },
  { k: 'sac', ic: '☠', name: 'Sacrifício e mortes', core: 'both',
    why: 'Sacrifícios (custos e saídas) e criaturas que deixam algo ao morrer dão vantagem a cada morte; os gatilhos de morte e o morbid pagam por isso.',
    en: (c, o) => (c.ro & RB.sacOutlet) || sacYou.test(o) || /when (this creature|it|this card|[^.]*?) dies|gains "when this creature dies/.test(o),
    pay: (c, o) => (c.ro & RB.deathPayoff) || /whenever (you|a player) sacrifices?|if a creature died this turn|\bmorbid\b|whenever another creature (you control )?dies/.test(o) },
  { k: 'counters', ic: '⊕', name: 'Marcadores +1/+1', core: 'pay',
    why: 'Quem põe marcadores cresce sozinho; proliferar, duplicar ou «com um marcador» multiplica esse crescimento.',
    en: c => c.ro & RB.counterPlacer,
    pay: (c, o) => (c.ro & RB.counterPayoff) || /with (a|one or more) \+1\/\+1 counters?|for each \+1\/\+1 counter|whenever (one or more )?\+1\/\+1 counters? (is|are) put|move[^.]*\+1\/\+1 counters?|remove (a|an|x|one|two) \+1\/\+1 counters?/.test(o) },
  { k: 'gy', ic: '⚱', name: 'Cemitério', core: 'pay',
    why: 'Encher o próprio cemitério (mill, descarte, surveil) alimenta recursão, flashback, delve e quem conta cartas no cemitério.',
    en: (c, o) => (c.ro & RB.selfFill) || /into your graveyard|\bentomb\b/.test(o),
    pay: (c, o) => (c.ro & RB.recursion) || c.tg.includes('reanimate') || /cards? in your graveyard|\bdelve\b|\bthreshold\b|\bdelirium\b|\bdescend|from your graveyard/.test(o) },
  { k: 'reanimate', ic: '⚰', name: 'Reanimação', core: 'en',
    why: 'Reanimar só vale com alvos grandes: criaturas caras e poderosas que nunca se pagariam a lançar.',
    en: c => c.tg.includes('reanimate'),
    pay: c => creature(c) && c.cmc >= 6 && ((parseInt(c.pt) || 0) >= 5 || /when(ever)? [^.]*enters/.test(txt(c))) },
  { k: 'spells', ic: 'ϟ', name: 'Feitiços e prowess', core: 'pay',
    why: 'Cada instantâneo ou feitiço dispara prowess, magecraft e «sempre que lanças»; cartas baratas encadeiam vários por turno.',
    en: c => c.ro & RB.spells,
    pay: (c, o) => (c.ro & RB.spellPayoff) || kw(c, 'Prowess') || /whenever you cast[^.]*(instant|sorcery|noncreature)|instant and sorcery spells you cast cost|instants? and sorcer(y|ies) (cards )?in your graveyard/.test(o) },
  { k: 'cast', ic: '✶', name: 'Sempre que lanças', core: 'pay',
    why: 'Gatilhos «sempre que lanças» (criaturas, artefactos, históricos, qualquer feitiço) pagam por jogar muitas cartas baratas e redutores de custo.',
    en: (c, o) => nonland(c) && (c.cmc <= 2 || /spells? you cast cost \{\d\} less|\bcascade\b/.test(o)),
    pay: (c, o) => /whenever you cast (a|an|your (first|second)|another)[^.]*spell/.test(o) && !/whenever you cast[^.]*(instant|sorcery|noncreature)/.test(o) },
  { k: 'life', ic: '♥', name: 'Ganho de vida', core: 'pay',
    why: 'Lifelink e ganhos pequenos e repetidos disparam quem paga por ganhar vida (fichas, marcadores, dano).',
    en: c => c.ro & RB.lifeGain,
    pay: (c, o) => (c.ro & RB.lifePayoff) || /gained (\d+ or more )?life this turn|for each 1 life you gained/.test(o) },
  { k: 'land', ic: '⛰', name: 'Landfall', core: 'pay', lands: true,
    why: 'Fetches, terrenos extra e ramp que põe terrenos em jogo disparam landfall duas vezes por turno.',
    en: (c, o) => (c.ro & RB.extraLands) || /search your library for[^.]*lands?[^.]*(onto|put (it|them|that card) onto) the battlefield|return a land you control to its owner's hand/.test(o) || (isT(c, /Land/) && /sacrifice[^.]*search your library/.test(o)),
    pay: c => c.ro & RB.landfall },
  { k: 'blink', ic: '↺', name: 'Blink e entradas', core: 'en',
    why: 'Exilar e devolver (blink) repete o efeito de entrada das criaturas: cada ETB passa a ser um recurso reutilizável.',
    en: (c, o) => (c.ro & RB.blink) || /exile (target|another|up to \w+)[^.]*, then return (it|that card|them)|return (target|another) (creature|permanent) you control to its owner's hand/.test(o),
    pay: c => creature(c) && (c.ro & RB.etb) },
  { k: 'auras', ic: '✧', name: 'Auras e encantamentos', core: 'pay',
    why: 'Auras e encantamentos alimentam quem gosta de estar encantado, constellation e as «enchantress» que compram por cada um.',
    en: c => nonland(c) && isT(c, /Enchantment/),
    pay: (c, o) => /\bis enchanted|enchanted creatures you control|auras? you control|aura spells|auras? attached|for each aura|whenever you cast an? (aura|enchantment)|enchantments? you control|\bconstellation\b|whenever an? (aura|enchantment) (you control )?enters|search your library for an aura/.test(o) },
  { k: 'discard', ic: '✋', name: 'Descarte e madness', core: 'pay',
    why: 'Descartar de propósito (rummage, cycling, custos) dispara madness e quem paga por descartar.',
    en: (c, o) => kw(c, 'Cycling') || kw(c, 'Connive') || /(^|[.:,•—]\s*|then |, )discard (a|an|two|three|x|one or more|any number of|your hand)/m.test(o),
    pay: (c, o) => kw(c, 'Madness') || /\bmadness\b|whenever you (discard|cycle)|discarded this turn|cycle or discard/.test(o) },
  { k: 'mill', ic: '⌛', name: 'Mill (adversário)', core: 'both',
    why: 'Moer a biblioteca do adversário ganha por si e enche o cemitério dele, que alimenta quem conta cartas nos cemitérios.',
    en: (c, o) => /(target (player|opponent)|each opponent|that player|target player or planeswalker) mills|reveals cards from the top of their library until[^.]*graveyard|(each|target) opponent exiles cards from the top/.test(o),
    pay: (c, o) => /cards? in (each|an|target|that) (opponent's|player's) graveyard|opponent has (\w+) or more cards in their graveyard|cards in its controller's graveyard|a graveyard has (\w+) or more cards|cards in all graveyards|has no cards in (their|his or her) library/.test(o) },
  { k: 'defender', ic: '🛡', name: 'Defensores e muralhas', core: 'pay',
    why: 'Muralhas com defender aguentam a mesa; quem conta defensores (mana, dano), usa a resistência como dano ou os deixa atacar transforma-as numa ofensiva.',
    en: c => kw(c, 'Defender') || isT(c, /\bWall\b/),
    pay: (c, o) => /creatures? you control with defender|(card|creature) with defender[^.]*(into|onto|to) your (hand|the battlefield)|defenders? you control|damage equal to (its|their|that creature's) toughness|as though (it|they) didn't have defender|sum of (the )?toughness|(greatest|highest|total) toughness|target wall|walls? you control/.test(o) },
  { k: 'energy', ic: '⚡', name: 'Energia', core: 'both',
    why: 'Quem dá energia ({E}) carrega a bateria; quem a gasta converte-a em dano, crescimento ou cartas.',
    en: (c, o) => /you get (\{e\})+|get (an amount of|that much) \{e\}/.test(o),
    pay: (c, o) => /pay (\{e\})+|pay (any amount of|an amount of) \{e\}|for each \{e\}/.test(o) },
  { k: 'combat', ic: '🗡', name: 'Evasão e dano de combate', core: 'pay',
    why: 'Criaturas baratas com evasão garantem o dano ao jogador; ninjutsu e gatilhos «quando causa dano de combate» pagam a cada ataque que passa.',
    en: c => evasive(c),
    pay: (c, o) => kw(c, 'Ninjutsu') || /\bninjutsu\b|whenever [^.]*deals combat damage to (a player|an opponent|one or more players)/.test(o) },
]

// Índice estático (uma vez por data): bits de quem ativa / beneficia em cada categoria.
function index(data) {
  if (data._syn) return data._syn
  const N = data.cards.length, en = new Uint32Array(N), pay = new Uint32Array(N)
  data.cards.forEach((c, i) => {
    const o = txt(c), land = !nonland(c)
    SYN.forEach((s, b) => {
      if (land && !s.lands) return
      if (s.en(c, o)) en[i] |= 1 << b
      if (s.pay(c, o)) pay[i] |= 1 << b
    })
  })
  return (data._syn = { en, pay })
}

const subOf = c => c.t.split(' // ').flatMap(f => (f.includes('—') ? f.split('—')[1].trim().split(/\s+/) : []))
const word = s => new RegExp(`\\b${s.toLowerCase()}s?\\b`)
const LAND_SUB = /^(Plains|Island|Swamp|Mountain|Forest|Desert|Gate|Cave|Town|Sphere|Locus|Lair|Mine|Tower|Power-Plant|Urza's)$/

// Tribos do deck: tipos de criatura com cópias suficientes. «Wall» fica para os defensores.
function tribes(entries, nl) {
  const n = {}
  for (const [c, q] of entries) if (creature(c) && !kw(c, 'Changeling')) for (const s of subOf(c)) n[s] = (n[s] || 0) + q
  return Object.entries(n).filter(([s, q]) => s !== 'Wall' && q >= Math.max(4, 0.1 * nl)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s)
}
const tribeCat = T => {
  const re = word(T)
  return { k: `tribe:${T}`, ic: '👑', name: `Tribal: ${T}`, core: 'pay', tribe: T,
    why: `Lords e cartas que falam de ${T} melhoram cada ${T} em jogo; quantos mais membros, mais forte cada lord.`,
    en: c => (creature(c) && (subOf(c).includes(T) || kw(c, 'Changeling'))) || new RegExp(`create[^.]*\\b${T.toLowerCase()}\\b[^.]*token`).test(txt(c)),
    pay: c => { const o = txt(c).replace(/create[^.]*/g, '').replace(/this \w+/g, ''); return re.test(o) || /choose a creature type|creatures? (cards? )?of the chosen type|creature type of your choice|share a creature type/.test(o) } }
}

/**
 * Sinergias de um deck: {cats, pairs}.
 * cats: [{s, en:[{c,q}], pay:[{c,q}], E, P, strength 0..1, reasons, sug:[{c, side}]}] por força.
 * strength = (média harmónica das cópias dos dois lados + ¼ das cópias do lado estreito) / (¼ das não-terreno):
 * premeia ter as duas metades equilibradas; um lado sozinho fica fraco.
 */
export function deckSynergy(data, deck, ctx, { perCat = 6 } = {}) {
  const { en: EN, pay: PAY } = index(data)
  const q = {}
  for (const [n, k] of [...Object.entries(deck.main || {}), ...(deck.commanders || []).map(n => [n, 1]), ...(deck.signature ? [[deck.signature, 1]] : [])]) q[n] = (q[n] || 0) + k
  const entries = Object.entries(q).map(([n, k]) => [data.byName.get(n), k]).filter(([c]) => c)
  const nl = entries.reduce((s, [c, k]) => s + (nonland(c) ? k : 0), 0) || 1
  const target = Math.max(4, 0.25 * nl)
  const tri = tribes(entries, nl).map(tribeCat)
  const all = [...SYN.map((s, b) => ({ s, test: (c, side) => ((side ? PAY : EN)[c.i] >> b) & 1 })),
    ...tri.map(s => ({ s, test: (c, side) => ((!nonland(c) && !s.lands) ? 0 : side ? s.pay(c) : s.en(c)) }))]
  const cats = []
  for (const { s, test } of all) {
    const en = [], pay = []
    for (const [c, k] of entries) { if (test(c, 0)) en.push({ c, q: k }); if (test(c, 1)) pay.push({ c, q: k }) }
    const E = en.reduce((a, x) => a + x.q, 0), P = pay.reduce((a, x) => a + x.q, 0)
    const narrow = s.core === 'en' ? E : s.core === 'pay' ? P : Math.max(E, P)
    if (!(E && P) && narrow < 0.1 * nl) continue
    if (!P && s.core === 'en' && !E) continue
    const H = E + P ? (2 * E * P) / (E + P) : 0
    const raw = (H + 0.25 * narrow) / target, strength = Math.min(1, raw)
    if (strength < 0.2 || en.length + pay.length < 2) continue
    const reasons = []
    if (!P) reasons.push('Falta quem beneficie: as que ativam estão sozinhas.')
    else if (!E) reasons.push('Falta quem ative: as que beneficiam não têm combustível.')
    else if (P * 4 < E) reasons.push('Muito combustível para poucas que beneficiam.')
    else if (E * 4 < P) reasons.push('Muitas que beneficiam para pouco combustível.')
    const byQ = (a, b) => b.q - a.q || (a.c.er ?? 1e9) - (b.c.er ?? 1e9)
    cats.push({ s, test, en: en.sort(byQ), pay: pay.sort(byQ), E, P, raw, strength, reasons, sug: [] })
  }
  cats.sort((a, b) => b.raw - a.raw)
  // Sugestões: uma passagem pelas cartas; legais no formato, dentro das cores, fora do deck.
  // Ordem = rank EDHREC ÷ (1 + encaixe noutras categorias do deck); se um lado está em falta, esse primeiro.
  const cols = ctx?.identity ?? colorsOf(deck, data).join('')
  const sctx = { ...ctx, identity: cols }
  const noCmd = !(deck.commanders || []).length // sem comandante, «commander's color identity» não serve
  const cand = cats.map(() => [])
  for (const c of data.cards) {
    if (q[c.n] || c.tg.includes('hate') || (noCmd && /\bcommander\b/.test(c.o))) continue
    let hits = null
    cats.forEach((x, k) => {
      if (!nonland(c) && !x.s.lands) return
      const e = x.test(c, 0), p = x.test(c, 1)
      if (e || p) (hits ||= []).push([k, e, p])
    })
    if (!hits || !passes(c, null, sctx)) continue
    for (const [k, e, p] of hits) {
      const x = cats[k], weak = x.P <= x.E ? 1 : 0 // lado em falta: 1 = beneficiam
      const side = p && (weak || !e) ? 'pay' : 'en'
      // desequilibrado (um lado com o dobro do outro): o lado em falta vem primeiro
      const need = (side === 'pay') === !!weak && Math.max(x.E, x.P) >= 2 * Math.min(x.E, x.P)
      cand[k].push({ c, side, key: (need ? 0 : 1e9) + (c.er ?? 1e6) / (1 + 0.6 * (hits.length - 1)) })
    }
  }
  cats.forEach((x, k) => {
    const l = cand[k].sort((a, b) => a.key - b.key)
    if (l[0]?.key >= 1e9) { // equilibrado: alterna quem ativa e quem beneficia
      const a = l.filter(y => y.side === 'en'), b = l.filter(y => y.side === 'pay')
      l.splice(0, l.length, ...a.flatMap((y, j) => [y, b[j]]).filter(Boolean), ...b.slice(a.length))
    }
    x.sug = l.slice(0, perCat); delete x.test
  })
  return { cats, pairs: pairsOf(entries) }
}

/**
 * Pares fortes: cartas que nomeiam outra do deck, ou falam de um subtipo que o deck tem (Equipment, Ninja, Aura…).
 * [{a:[cards], b:[cards], q, why}] — quem fala do mesmo subtipo fica junto; as referências mais povoadas primeiro.
 */
export function pairsOf(entries, max = 10) {
  const subs = new Map()
  for (const [c, k] of entries) if (nonland(c)) for (const s of subOf(c)) if (!LAND_SUB.test(s)) (subs.get(s) || subs.set(s, []).get(s)).push([c, k])
  const out = [], bySub = new Map()
  for (const [a] of entries) {
    if (!nonland(a)) continue
    const o = txt(a), oo = o.replace(/create[^.]*/g, '').replace(/this \w+/g, '')
    for (const [b, k] of entries) {
      const nm = b.n.split(' // ')[0].toLowerCase()
      if (b !== a && nonland(b) && nm.length >= 4 && o.includes(nm)) out.push({ a: [a], b: [b], q: k, why: `nomeia ${b.n.split(' // ')[0]}` })
    }
    for (const [s] of subs) if (word(s).test(oo)) (bySub.get(s) || bySub.set(s, []).get(s)).push(a)
  }
  for (const [s, as] of bySub) {
    const others = subs.get(s).filter(([b]) => as.length > 1 || b !== as[0])
    if (others.length) out.push({ a: as, b: others.map(([b]) => b), q: others.reduce((t, [, k]) => t + k, 0) * as.length, why: `fala${as.length > 1 ? 'm' : ''} de ${s}` })
  }
  return out.sort((x, y) => y.q - x.q).slice(0, max)
}
