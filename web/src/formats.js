// Regras e modos de ajuda de cada formato.
// `lg` é o nome do formato no campo de legalidade da Scryfall (null = sem lista de legalidade).
// `cmd`: 'commander' | 'oathbreaker' | null.  `copies`: limite por nome (básicos sempre livres).
// `targets`: metas por etiqueta automática para o modo de ajuda (mínimo recomendado).

const T60 = { creature: 14, wincon: 4, removal: 6, draw: 4 }
const TCMD = { ramp: 10, draw: 10, removal: 8, wipe: 2, protection: 2, creature: 22, wincon: 5 }

// Metas ajustadas ao plano: decks de feitiços/controlo precisam de menos criaturas.
export function targetsFor(fmt, plan = [], prefs = null) {
  const t = { ...(fmt.targets || {}) }
  const spells = plan.some(x => /feitiços|Artefactos/i.test(x.label) && x.payoffs >= 2)
  const ctrl = prefs?.on && (prefs.estilo || []).some(k => k === 'controlo' || k === 'combo')
  if (t.creature && (spells || ctrl)) t.creature = Math.round(t.creature * 0.5)
  if (t.creature && plan.some(x => /Tribo|Fichas|Marcadores|Aristocratas/.test(x.label))) t.creature = Math.round(t.creature * 1.2)
  return t
}

export const FORMATS = [
  { key: 'commander', name: 'Commander (EDH)', lg: 'commander', group: 'Multijogador', size: [100, 100], copies: 1, side: 0, cmd: 'commander', lands: 'cmd', targets: TCMD,
    tips: ['100 cartas exatas, incluindo o comandante, uma cópia de cada (exceto terrenos básicos).', 'Todas as cartas têm de caber na identidade de cor do comandante.', 'Base habitual: 36–38 terrenos, ~10 ramp, ~10 compra, 8–10 remoção, 2–3 wipes.', 'As cartas «Game Changer» empurram o deck para os brackets 3 e 4.'] },
  { key: 'duel', name: 'Duel Commander', lg: 'duel', group: 'Multijogador', size: [100, 100], copies: 1, side: 0, cmd: 'commander', lands: 'cmd', targets: { ramp: 6, draw: 8, removal: 10, wipe: 1, creature: 20, wincon: 5 },
    tips: ['Commander 1 contra 1 com 20 de vida e banlist própria.', 'Mais interação e menos ramp do que no EDH multijogador.'] },
  { key: 'oathbreaker', name: 'Oathbreaker', lg: 'oathbreaker', group: 'Multijogador', size: [60, 60], copies: 1, side: 0, cmd: 'oathbreaker', lands: 'o60', targets: { ramp: 4, draw: 6, removal: 6, wincon: 3 },
    tips: ['58 cartas + um planeswalker (Oathbreaker) + um instantâneo ou feitiço de assinatura.', 'A identidade de cor vem do Oathbreaker.', 'Costuma levar 30–33 terrenos.'] },
  { key: 'brawl', name: 'Brawl (Arena, 100)', lg: 'brawl', group: 'Multijogador', size: [100, 100], copies: 1, side: 0, cmd: 'commander', lands: 'cmd', targets: TCMD,
    tips: ['Historic Brawl do Arena: 100 cartas, o comandante pode ser planeswalker.', 'Só cartas do pool do Arena.'] },
  { key: 'standardbrawl', name: 'Standard Brawl', lg: 'standardbrawl', group: 'Multijogador', size: [60, 60], copies: 1, side: 0, cmd: 'commander', lands: 'o60', targets: { ramp: 4, draw: 5, removal: 6, creature: 14, wincon: 4 },
    tips: ['60 cartas com comandante, pool do Standard.', 'Costuma levar ~24 terrenos.'] },
  { key: 'paupercommander', name: 'Pauper Commander', lg: 'paupercommander', group: 'Multijogador', size: [100, 100], copies: 1, side: 0, cmd: 'commander', lands: 'cmd', targets: TCMD,
    tips: ['Comandante: criatura incomum. O resto do deck: só comuns.'] },
  { key: 'predh', name: 'PreDH', lg: 'predh', group: 'Multijogador', size: [100, 100], copies: 1, side: 0, cmd: 'commander', lands: 'cmd', targets: TCMD,
    tips: ['Commander só com cartas até Commander 2011.'] },

  { key: 'standard', name: 'Standard', lg: 'standard', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60,
    tips: ['Mínimo 60 cartas, até 4 cópias, sideboard até 15.', 'Rotação: só os sets dos últimos ~3 anos.'] },
  { key: 'pioneer', name: 'Pioneer', lg: 'pioneer', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Sets desde Return to Ravnica.'] },
  { key: 'modern', name: 'Modern', lg: 'modern', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Sets desde a 8.ª Edição.', 'Formato rápido: conta com interação barata (custo 1–2).'] },
  { key: 'legacy', name: 'Legacy', lg: 'legacy', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Quase todas as cartas; banlist própria.'] },
  { key: 'vintage', name: 'Vintage', lg: 'vintage', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['As cartas «restritas» só podem ter 1 cópia.'] },
  { key: 'pauper', name: 'Pauper', lg: 'pauper', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Só cartas que já saíram como comuns.'] },
  { key: 'premodern', name: 'Premodern', lg: 'premodern', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Sets da 4.ª Edição a Scourge.'] },
  { key: 'oldschool', name: 'Old School 93/94', lg: 'oldschool', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Cartas de 1993–94; as restritas têm 1 cópia.'] },
  { key: 'penny', name: 'Penny Dreadful', lg: 'penny', group: 'Construído', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Só cartas baratas no MTGO (a lista muda por época).'] },
  { key: 'historic', name: 'Historic (Arena)', lg: 'historic', group: 'Arena', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Pool do Arena.'] },
  { key: 'timeless', name: 'Timeless (Arena)', lg: 'timeless', group: 'Arena', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Pool do Arena com banlist mínima; as restritas têm 1 cópia.'] },
  { key: 'alchemy', name: 'Alchemy (Arena)', lg: 'alchemy', group: 'Arena', size: [60, null], copies: 4, side: 15, lands: '60', targets: T60, tips: ['Standard com cartas digitais rebalanceadas.'] },
  { key: 'gladiator', name: 'Gladiator (Arena)', lg: 'gladiator', group: 'Arena', size: [100, 100], copies: 1, side: 0, lands: 'g100', targets: { ramp: 4, draw: 8, removal: 10, creature: 22, wincon: 5 }, tips: ['100 cartas singleton, sem comandante, 1 contra 1.'] },

  { key: 'limited', name: 'Limitado (draft/selado)', lg: null, group: 'Outros', size: [40, null], copies: Infinity, side: null, lands: '40', targets: { removal: 3, evasion: 4, creature: 15, wincon: 3 },
    tips: ['Mínimo 40 cartas; regra de bolso: 17 terrenos, 15–17 criaturas.', 'Prioridade: bombas, remoção, evasão e só depois a curva.'] },
  { key: 'casual', name: 'Casual (sem regras)', lg: null, group: 'Outros', size: [0, null], copies: Infinity, side: null, lands: '60', targets: T60, tips: ['Sem validação de legalidade nem de cópias.', 'As metas de criaturas, condições de vitória e funções são as de um deck de 60 cartas.'] },
]

export const FORMAT = Object.fromEntries(FORMATS.map(f => [f.key, f]))

const ANY_NUMBER = /a deck can have any number of cards named|a deck can have up to (\w+) cards named/i
const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }

export function maxCopies(card, fmt, fmtBit) {
  if (/\bBasic\b/.test(card.t)) return Infinity
  const m = card.o.match(ANY_NUMBER)
  if (m) return m[1] ? (WORDS[m[1].toLowerCase()] || Number(m[1]) || Infinity) : Infinity
  if (fmtBit >= 0 && card.rs & (1 << fmtBit)) return 1
  return fmt.copies
}

export function canBeCommander(card, fmt) {
  if (fmt.cmd === 'oathbreaker') return /Planeswalker/.test(card.t)
  if (/can be your commander/i.test(card.o)) return true
  if (fmt.key === 'brawl' || fmt.key === 'standardbrawl') return /Legendary/.test(card.t) && /(Creature|Planeswalker)/.test(card.t)
  if (fmt.key === 'paupercommander') return /Creature/.test(card.t) && card.r === 'u'
  return /Legendary/.test(card.t) && /Creature/.test(card.t)
}

const subset = (a, b) => [...a].every(c => b.includes(c))

// Valida um deck. Devolve [{nivel: 'erro'|'aviso'|'info', msg}]
export function validate(deck, fmt, data) {
  const out = []
  const bit = fmt.lg ? data.meta.formats.indexOf(fmt.lg) : -1
  const cmdCards = deck.commanders.map(n => data.byName.get(n)).filter(Boolean)
  const ident = cmdCards.map(c => c.ci).join('')
  const sig = fmt.cmd === 'oathbreaker' && deck.signature ? data.byName.get(deck.signature) : null
  const mainCount = Object.values(deck.main).reduce((s, q) => s + q, 0)
  const total = mainCount + (fmt.cmd ? cmdCards.length + (sig ? 1 : 0) : 0)
  const [min, max] = fmt.size
  if (total < min) out.push({ nivel: 'erro', msg: `Faltam ${min - total} cartas (tem ${total}, mínimo ${min}).` })
  if (max && total > max) out.push({ nivel: 'erro', msg: `Sobram ${total - max} cartas (tem ${total}, máximo ${max}).` })
  const sideCount = Object.values(deck.side).reduce((s, q) => s + q, 0)
  if (fmt.side != null && sideCount > fmt.side) out.push({ nivel: 'erro', msg: `Sideboard com ${sideCount} cartas (máximo ${fmt.side}).` })

  if (fmt.cmd) {
    const label = fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : 'comandante'
    if (!cmdCards.length) out.push({ nivel: 'erro', msg: fmt.cmd === 'oathbreaker' ? 'Escolhe um Oathbreaker (planeswalker).' : 'Escolhe o comandante.' })
    for (const c of cmdCards) if (!canBeCommander(c, fmt)) out.push({ nivel: 'erro', msg: `${c.n} não pode ser ${label}.` })
    if (cmdCards.length === 2 && !cmdCards.every(c => /Partner|Friends forever|Doctor's companion|Choose a Background/i.test(c.o) || /Background/.test(c.t)))
      out.push({ nivel: 'erro', msg: 'Dois comandantes só com Partner, Friends forever, Background ou Doctor\'s companion.' })
    if (cmdCards.length > 2) out.push({ nivel: 'erro', msg: 'No máximo dois comandantes.' })
    if (fmt.cmd === 'oathbreaker') {
      if (!sig) out.push({ nivel: 'erro', msg: 'Falta o feitiço de assinatura (instantâneo ou feitiço).' })
      else if (!/Instant|Sorcery/.test(sig.t)) out.push({ nivel: 'erro', msg: `${sig.n} não é instantâneo nem feitiço.` })
    }
  }

  const seen = new Map()
  for (const [n, q] of [...Object.entries(deck.main), ...Object.entries(deck.side)]) seen.set(n, (seen.get(n) || 0) + q)
  for (const n of [...deck.commanders, sig?.n].filter(Boolean)) seen.set(n, (seen.get(n) || 0) + 1)
  for (const [n, q] of seen) {
    const c = data.byName.get(n)
    if (!c) { out.push({ nivel: 'aviso', msg: `«${n}» não foi encontrada na base de cartas.` }); continue }
    const lim = maxCopies(c, fmt, bit)
    if (q > lim) out.push({ nivel: 'erro', msg: `${n}: ${q} cópias (máximo ${lim}).` })
    if (bit >= 0 && !(c.lg & (1 << bit))) out.push({ nivel: 'erro', msg: `${n} não é legal em ${fmt.name}.` })
    if (fmt.cmd && cmdCards.length && !deck.commanders.includes(n) && !subset(c.ci, ident))
      out.push({ nivel: 'erro', msg: `${n} está fora da identidade de cor (${ident || 'incolor'}).` })
  }
  if (fmt.cmd === 'commander') {
    const gc = [...seen.keys()].filter(n => data.byName.get(n)?.gc)
    const b = deck.bracket
    if (b && b <= 2 && gc.length) out.push({ nivel: 'aviso', msg: `Bracket ${b} não leva Game Changers; tens ${gc.length}: ${gc.join(', ')}.` })
    else if (b === 3 && gc.length > 3) out.push({ nivel: 'aviso', msg: `Bracket 3 leva até 3 Game Changers; tens ${gc.length}: ${gc.join(', ')}.` })
    else if (gc.length && fmt.key === 'commander') out.push({ nivel: 'info', msg: `${gc.length} Game Changer${gc.length > 1 ? 's' : ''} (${gc.join(', ')}): ${gc.length > 3 ? 'bracket 4' : 'bracket 3 ou superior'}.` })
  }
  return out
}

// Terrenos recomendados: fórmulas de Frank Karsten (60 cartas e Commander); 17 em 40 no limitado.
export function landAdvice(fmt, avgMv, cheapRampDraw) {
  switch (fmt.lands) {
    case 'cmd': return Math.min(40, Math.max(33, Math.round(31.42 + 3.13 * avgMv - 0.28 * cheapRampDraw)))
    case 'g100': return Math.round(38 + 2.5 * avgMv - 0.28 * cheapRampDraw)
    case 'o60': return Math.round(22 + 2.5 * avgMv - 0.28 * cheapRampDraw)
    case '40': return Math.round(17 + (avgMv - 3))
    default: return Math.round(19.59 + 1.9 * avgMv - 0.28 * cheapRampDraw)
  }
}

// Formato pelas cartas: comandante/100 singleton → Commander; ~40 → Limitado; senão o formato mais restrito em que tudo é legal.
export function inferFormat(data, deck) {
  const main = Object.entries(deck.main || {}), cmds = deck.commanders || []
  const total = main.reduce((s, [, q]) => s + q, 0) + cmds.length
  const cards = [...cmds, ...main.map(([n]) => n), ...Object.keys(deck.side || {})].map(n => data.byName.get(n)).filter(Boolean)
  const singleton = main.every(([n, q]) => q === 1 || /\bBasic\b/.test(data.byName.get(n)?.t || ''))
  if (cmds.length || (total >= 98 && singleton)) return 'commander'
  if (total <= 45) return 'limited'
  for (const f of ['pauper', 'standard', 'pioneer', 'modern', 'legacy', 'vintage']) {
    const bit = data.meta.formats.indexOf(f)
    if (bit >= 0 && cards.every(c => c.lg & (1 << bit)) && main.every(([n, q]) => { const c = data.byName.get(n); return !c || q <= maxCopies(c, FORMAT[f], bit) })) return f
  }
  return 'casual'
}
// O formato indicado pelo site serve se a lista for legal nele; senão detecta-se.
export function fixFormat(data, deck, given) {
  const f = FORMAT[given]
  if (f && given !== 'casual') {
    const errs = validate({ ...emptyLike(deck) }, f, data).filter(i => i.nivel === 'erro' && !/Faltam|Sobram|Escolhe o comandante/.test(i.msg))
    if (!errs.length) return { format: given, detected: false }
  }
  return { format: inferFormat(data, deck), detected: true }
}
const emptyLike = d => ({ commanders: d.commanders || [], main: d.main || {}, side: d.side || {}, signature: null, seeds: [], prints: {} })

// Modo casual (formatos misturados, sim.py casual=True): texto para o Laboratório e o Torneio e a vida das regras base
// (igual a sim.base_life)
export const CASUAL_INFO = 'Modo casual: entram decks de qualquer formato. As regras base dão a todos a vida inicial e o tipo de jogo (ex.: Modern = 20 de vida, Commander = 40). Um deck com comandante continua a jogar com ele: começa na zona de comando, paga o imposto de comandante, pode voltar à zona de comando e 21 de dano de combate do mesmo comandante elimina. Não se aplica: cartas proibidas, tamanho mínimo e identidade de cor (cada deck joga como está).'
export const CASUAL_META = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern', 'commander', 'duel']  // sim.opponents
export const baseLife = (k, n = 2) => ((k === 'brawl' || k === 'standardbrawl') && n > 2 ? 30 : { commander: 40, predh: 40, paupercommander: 30, brawl: 25, standardbrawl: 25 }[k] || 20)
