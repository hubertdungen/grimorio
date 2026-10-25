// Carregamento dos dados e motor de pesquisa/sugestões. Tudo corre no browser:
// os embeddings (int8, 128 dim) chegam para fazer as contas de semelhança em ~50 ms.
import { testsBoost, wrDelta } from './tests.js'
import { landInfo, offColorLand } from './mana.js'
import { tx, num, LOCALE } from './i18n.js'

export const TAG_LABEL = {
  ramp: tx('Ramp'), draw: tx('Compra'), removal: tx('Remoção'), wipe: tx('Wipe'), counter: tx('Contra-feitiço'),
  tutor: tx('Tutor'), recursion: tx('Recursão'), protection: tx('Proteção'), tokens: tx('Fichas'),
  sacrifice: tx('Sacrifício'), counters: tx('Marcadores +1/+1'), lifegain: tx('Ganho de vida'),
  graveyard: tx('Cemitério'), etb: tx('Entradas (ETB)'), spellslinger: tx('Instantâneos e feitiços'),
  artifacts: tx('Artefactos'), enchantments: tx('Encantamentos'), discard: tx('Descarte'), evasion: tx('Evasão'), land: tx('Terreno'),
  creature: tx('Criaturas'), wincon: tx('Condição de vitória'), hate: tx('Resposta de sideboard'), reanimate: tx('Reanimação'),
}

// Papéis mecânicos: quem alimenta quem. Calculados uma vez por carta ao carregar.
const ROLE_RE = {
  tokenMaker: /create[^.]*tokens?/,
  tokenPayoff: /whenever (a|one or more)[^.]*tokens?[^.]*(enter|created)|tokens? you control (get|have)|for each (creature|artifact) you control|creatures you control get \+/,
  sacOutlet: /sacrifice (a|another|an|x|any number of) [^:.]*:|, sacrifice (a|another) (creature|artifact|permanent)[^.]*:/,
  deathPayoff: /whenever [^.]*(creature|creatures|permanent)[^.]*(dies|die|is put into a graveyard from the battlefield)/,
  counterPlacer: /put (a|an|one|two|three|x|that many)?[^.]*\+1\/\+1 counters? on/,
  counterPayoff: /proliferate|twice that many|additional \+1\/\+1 counter|for each \+1\/\+1 counter|with (a|one or more) \+1\/\+1 counters? on/,
  etb: /when(ever)? [^.]*enters/,
  blink: /exile (target|another|up to|each)[^.]*return (it|that card|them|those cards|the exiled card)[^.]* to the battlefield/,
  selfFill: /\bmill|discard (a|two|three|x|any number of) cards?|surveil|cards? from the top of your library into your graveyard/,
  recursion: /return[^.]*from your graveyard|flashback|unearth|escape—|disturb|embalm|eternalize|from your graveyard to the battlefield/,
  lifeGain: /you gain (\d+|x|that much)? ?life|lifelink/,
  lifePayoff: /whenever you gain life/,
  spellPayoff: /whenever you cast (an|a|your first) (instant|sorcery|noncreature)|magecraft|prowess|copy target instant or sorcery/,
  artifactMaker: /create[^.]*(treasure|clue|food|blood|map|artifact)/,
  artifactPayoff: /artifacts? you control|whenever[^.]*artifact[^.]*enters|affinity for artifacts|improvise|metalcraft/,
  extraLands: /play an additional land|you may play (two|three) additional lands|put (a|that|up to \w+)[^.]*land cards?[^.]* onto the battlefield/,
  landfall: /landfall|whenever a land (you control )?enters/,
  drawPayoff: /whenever you draw/,
  draw: /draws? (a|two|three|x|that many) cards?/,
  ninjutsu: /ninjutsu/,
  equipped: /\bequipped\b|\bequipment\b/,
}
const ROLES = Object.keys(ROLE_RE)
export const ROLE_LABEL = {
  tokenMaker: tx('geram fichas'), tokenPayoff: tx('gostam de fichas'), sacOutlet: tx('sacrificam'), deathPayoff: tx('disparam quando algo morre'),
  counterPlacer: tx('põem marcadores +1/+1'), counterPayoff: tx('multiplicam marcadores'), etb: tx('têm efeito ao entrar'), blink: tx('fazem blink'),
  selfFill: tx('enchem o cemitério'), recursion: tx('recuperam do cemitério'), lifeGain: tx('ganham vida'), lifePayoff: tx('pagam por ganhar vida'),
  spells: tx('são instantâneos ou feitiços'), spellPayoff: tx('pagam por lançar feitiços'), artifactMaker: tx('criam artefactos'),
  artifactPayoff: tx('gostam de artefactos'), extraLands: tx('põem terrenos a mais'), landfall: tx('disparam com terrenos (landfall)'),
  draw: tx('compram cartas'), drawPayoff: tx('pagam por comprar cartas'),
  evasive: tx('são difíceis de bloquear'), ninjutsu: tx('têm ninjutsu'), equipment: tx('são equipamentos'), equipped: tx('gostam de equipamentos'),
}
// [quem alimenta, quem aproveita]
export const PAIRS = [['tokenMaker', 'tokenPayoff'], ['tokenMaker', 'sacOutlet'], ['sacOutlet', 'deathPayoff'], ['counterPlacer', 'counterPayoff'],
  ['etb', 'blink'], ['selfFill', 'recursion'], ['lifeGain', 'lifePayoff'], ['spells', 'spellPayoff'], ['artifactMaker', 'artifactPayoff'],
  ['extraLands', 'landfall'], ['draw', 'drawPayoff'], ['evasive', 'ninjutsu'], ['equipment', 'equipped']]
const ALL_ROLES = [...ROLES, 'spells', 'evasive', 'equipment']
const EVASIVE_KW = ['Flying', 'Menace', 'Shadow', 'Fear', 'Intimidate', 'Skulk', 'Horsemanship']
export const RB = Object.fromEntries(ALL_ROLES.map((r, k) => [r, 1 << k]))

export function rolesOf(c) {
  const o = c.o.toLowerCase()
  let m = 0
  for (const r of ROLES) if (ROLE_RE[r].test(o)) m |= RB[r]
  if (/Instant|Sorcery/.test(c.t)) m |= RB.spells
  if (/Artifact/.test(c.t.split(' // ')[0])) m |= RB.artifactMaker
  if (!/Creature/.test(c.t)) m &= ~RB.etb // blink só serve para permanentes que entram com efeito
  if (/Creature/.test(c.t) && ((c.kw || []).some(k => EVASIVE_KW.includes(k)) || /can't be blocked/.test(o))) m |= RB.evasive // abre caminho ao ninjutsu
  if (/Equipment/.test(c.t)) m = (m | RB.equipment) & ~RB.equipped
  return m
}

// Estilos que o utilizador pode escolher na personalização (viés opcional nas sugestões).
export const STYLES = {
  aggro: { label: tx('Aggro'), test: c => c.mt !== 'Land' && (c.cmc <= 2 || c.tg.includes('evasion')), neg: c => c.cmc >= 5 },
  midrange: { label: tx('Midrange'), test: c => c.cmc >= 2 && c.cmc <= 4 && (c.mt === 'Creature' || c.tg.includes('removal')) },
  controlo: { label: tx('Controlo'), test: c => ['counter', 'removal', 'wipe', 'draw'].some(t => c.tg.includes(t)) },
  combo: { label: tx('Combo'), test: (c, d) => c.tg.includes('tutor') || d.combosByCard[c.i].length > 0 },
  tribal: { label: tx('Tribal'), test: null },
  fichas: { label: tx('Fichas'), test: c => c.ro & (RB.tokenMaker | RB.tokenPayoff) },
  aristocratas: { label: tx('Aristocratas'), test: c => c.ro & (RB.sacOutlet | RB.deathPayoff) },
  marcadores: { label: tx('Marcadores +1/+1'), test: c => c.ro & (RB.counterPlacer | RB.counterPayoff) },
  feiticos: { label: tx('Instantâneos e feitiços'), test: c => c.ro & (RB.spells | RB.spellPayoff) },
  artefactos: { label: tx('Artefactos'), test: c => c.ro & (RB.artifactMaker | RB.artifactPayoff) },
  cemiterio: { label: tx('Cemitério'), test: c => c.ro & (RB.selfFill | RB.recursion) },
  vida: { label: tx('Ganho de vida'), test: c => c.ro & (RB.lifeGain | RB.lifePayoff) },
  landfall: { label: tx('Landfall'), test: c => c.ro & (RB.extraLands | RB.landfall) },
  jank: { label: tx('Fun/jank'), test: c => !c.er || c.er > 5000 },
}
export const LEVELS = ['', 'Fun/jank', tx('Base'), tx('Melhorado'), tx('Otimizado'), tx('Competitivo')]

// Nome no formato dos URLs do EDHREC ("Kaya's Ghostform" -> "kayas-ghostform").
export const edhSlug = n => n.split(' // ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const edhCache = new Map()
export function fetchEdh(kind, name) {
  const key = `${kind}/${edhSlug(name)}`
  if (!edhCache.has(key)) edhCache.set(key, fetch(`/api/edhrec/${key}`).then(r => r.json()).catch(() => ({ cards: [] })))
  return edhCache.get(key)
}

export const COLORS = { W: tx('Branco'), U: tx('Azul'), B: tx('Preto'), R: tx('Vermelho'), G: tx('Verde') }

export const TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
export const TYPE_LABEL = { Creature: tx('Criaturas'), Instant: tx('Instantâneos'), Sorcery: tx('Feitiços'), Artifact: tx('Artefactos'), Enchantment: tx('Encantamentos'), Planeswalker: tx('Planeswalkers'), Land: tx('Terrenos'), Battle: tx('Batalhas') }

export function mainType(c) {
  const front = c.t.split('//')[0]
  for (const t of ['Land', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment']) if (front.includes(t)) return t
  return 'Artifact'
}

// `pid`: id Scryfall de uma impressão escolhida (estilo alternativo); senão, a predefinida.
// pid: id de uma impressão da Scryfall ou o link da arte própria do deck (https://…, ex.: alterada no TappedOut)
// Arte por omissão dos terrenos básicos (Definições › Terrenos básicos): {Island: print, …}; vale onde o deck não
// escolheu outra (img sem pid). Fica neste browser.
export const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']
const BK = 'grimorio.basicos'
let basicDef = (() => { try { return JSON.parse(localStorage.getItem(BK) || '{}') } catch { return {} } })()
export const getBasicDefaults = () => basicDef
// cada básico pode ter várias artes por omissão (até 10): a lista, e a forma «cópias divididas» para o tabuleiro
export const basicList = n => { const v = basicDef[n]; return Array.isArray(v) ? v : v ? [v] : [] }
export const basicSplit = n => { const l = basicList(n); return l.length > 1 ? l.map(p => ({ id: p.id, q: 1 })) : null }
export function setBasicDefaults(v) { basicDef = v || {}; try { localStorage.setItem(BK, JSON.stringify(basicDef)) } catch { /* sem armazenamento */ } }
export const img = (c, size = 'normal', back = false, pid = null) => {
  if (pid?.startsWith('https:') || pid?.startsWith('arts/')) { if (!back) return pid; pid = null }  // imagem própria (site de origem ou carregada)
  const id = pid || basicList(c.n)[0]?.id || c.id
  return `https://cards.scryfall.io/${size}/${back ? 'back' : 'front'}/${id[0]}/${id[1]}/${id}.${size === 'png' ? 'png' : 'jpg'}`
}

// --- Estilos alternativos (impressões), pedidos à API da Scryfall a pedido ---
const SF = 'https://api.scryfall.com'
const printsCache = new Map()

function styleOf(p) {
  const s = []
  const fx = p.frame_effects || []
  if (p.border_color === 'borderless') s.push(tx('Sem margem'))
  if (fx.includes('showcase')) s.push('Showcase')
  if (fx.includes('extendedart')) s.push(tx('Arte estendida'))
  if (p.full_art) s.push(tx('Arte completa'))
  if (fx.includes('inverted')) s.push(tx('Invertida'))
  if (p.frame === '1993' || p.frame === '1997') s.push(tx('Moldura antiga'))
  if (p.textless) s.push(tx('Sem texto'))
  if (p.finishes?.includes('etched')) s.push('Etched')
  if (p.promo) s.push('Promo')
  if (p.set_type === 'masterpiece') s.push('Masterpiece')
  if (p.lang && p.lang !== 'en') s.push(p.lang.toUpperCase())
  return s
}

const toPrint = p => ({
  id: p.id, set: p.set.toUpperCase(), setName: p.set_name, cn: p.collector_number, y: (p.released_at || '').slice(0, 4),
  eur: p.prices?.eur ? +p.prices.eur : null, eurFoil: p.prices?.eur_foil ? +p.prices.eur_foil : null,
  usd: p.prices?.usd ? +p.prices.usd : null, style: styleOf(p), finishes: p.finishes || [],
  digital: p.digital, artist: p.artist,
})

export async function fetchPrints(name) {
  if (printsCache.has(name)) return printsCache.get(name)
  const q = encodeURIComponent(`!"${name.split(' // ')[0]}" include:extras`)
  let url = `${SF}/cards/search?q=${q}&unique=prints&order=released&dir=desc`
  const out = []
  for (let page = 0; url && page < 4; page++) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) break
    const j = await r.json()
    out.push(...j.data.filter(p => !p.digital || p.games?.includes('arena')).map(toPrint))
    url = j.has_more ? j.next_page : null
  }
  printsCache.set(name, out)
  return out
}

// Resolve "(SET) número" de uma lista importada para impressões concretas (75 por pedido).
export async function fetchCollection(ids) {
  const out = new Map()
  for (let k = 0; k < ids.length; k += 75) {
    const chunk = ids.slice(k, k + 75)
    const r = await fetch(`${SF}/cards/collection`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map(x => ({ set: x.set.toLowerCase(), collector_number: x.cn })) }),
    })
    if (!r.ok) continue
    const j = await r.json()
    for (const p of j.data) out.set(`${p.set.toUpperCase()}|${p.collector_number}`, toPrint(p))
    if (k + 75 < ids.length) await new Promise(res => setTimeout(res, 120)) // regra da Scryfall: ≤10 pedidos/s
  }
  return out
}

// arte de uma carta no deck: a do site de origem, senão a edição escolhida
export const pidOf = (deck, n) => deck?.art?.[n] || deck?.prints?.[n]?.id
// artes de um deck para o tabuleiro (como sim.art_map no servidor): edição escolhida, imagem própria ou cópias divididas
export const artMapOf = d => (d ? { ...Object.fromEntries(Object.entries(d.prints || {}).filter(([, p]) => p?.id).map(([n, p]) => [n, p.id])), ...(d.art || {}), ...(d.split || {}) } : null)
// arte de uma cópia: com as cópias divididas ([{id, q}]), cada cópia (inst = chave estável) fica sempre com a mesma
export function artPick(v, inst) {
  if (!Array.isArray(v)) return v || null
  const total = v.reduce((a, x) => a + (x.q || 0), 0)
  if (!total) return v[0]?.id || null
  let h = 0
  for (const ch of String(inst ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  let k = h % total
  for (const x of v) { if (k < x.q) return x.id; k -= x.q }
  return v[0].id
}

// Extras de um deck lido por link: arte própria do site (j.art, TappedOut) com os nomes canónicos,
// e as edições «(SET) nº» da lista (Moxfield, Archidekt…) resolvidas na Scryfall.
export async function importExtras(data, p, j) {
  const art = {}, prints = {}
  for (const [n, u] of Object.entries(j?.art || {})) {
    const c = data.byLower.get(n.toLowerCase()) || data.byLower.get(n.split(' // ')[0].toLowerCase())
    if (c && /^https:\/\/\S+$/.test(u)) art[c.n] ||= u
  }
  if (p.printRefs.length) {
    try {
      const found = await fetchCollection(p.printRefs)
      for (const r of p.printRefs) { const pr = found.get(`${r.set}|${r.cn}`); if (pr) prints[r.name] = { ...pr, foil: r.foil } }
    } catch { /* sem Scryfall: ficam as predefinidas */ }
  }
  return { art, prints }
}

async function get(name, kind) {
  const r = await fetch(`data/${name}`)
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
  return kind === 'json' ? r.json() : r.arrayBuffer()
}

// Remoção (igual a build_data.py): exilar/destruir as tuas próprias criaturas é blink, não remoção.
export const REMOVAL_RE = /(destroy|exile) target (?!card)(?![^.]*\byou control\b)[^.]*(creature|artifact|enchantment|planeswalker|permanent|nonland)|deals? (\d+|x) damage to (any target|target creature|target planeswalker)|target creature gets -\d|return target (nonland )?(creature|permanent)(?![^.]*\byou control\b)[^.]*to its owner's hand|fights? target/
// Tipos de criatura (das linhas de tipo), para ler «If it's a Spirit…» no texto.
export const CREATURE_TYPES = new Set()
const NOT_CREATURE = new Set(['Saga', 'Equipment', 'Aura', 'Food', 'Clue', 'Treasure', 'Vehicle', 'Time', 'Lord', 'Eye'])
const ownTypes = c => new Set(c.t.split(' // ').flatMap(f => (f.includes('—') ? f.split('—')[1].trim().split(/\s+/) : [])))

export async function loadData() {
  const [meta, cards, combos, emb, pos] = await Promise.all([
    get('meta.json', 'json'), get('cards.json', 'json'), get('combos.json', 'json'),
    get('emb.bin'), get('pos.bin'),
  ])
  return prepData(meta, cards, combos, emb, pos)
}

// Índices e etiquetas calculadas por carta (separado de loadData para o selfcheck usar cartas inventadas).
export function prepData(meta, cards, combos, emb, pos) {
  const byName = new Map(), byLower = new Map()
  const tc = {} // 3+ cartas a sério com o tipo; subtipos de artefacto/encantamento que aparecem em criaturas ficam de fora
  for (const c of cards) if (!c.un) for (const f of c.t.split(' // ')) if (/Creature|Kindred|Tribal/.test(f) && f.includes('—')) for (const w of f.split('—')[1].trim().split(/\s+/)) tc[w] = (tc[w] || 0) + 1
  for (const [w, n] of Object.entries(tc)) if (n >= 3 && !NOT_CREATURE.has(w)) CREATURE_TYPES.add(w)
  cards.forEach((c, i) => {
    c.i = i
    c.l = c.n.toLowerCase()
    c.mt = mainType(c)
    c.ro = rolesOf(c)
    // Estrutura do deck: criaturas, condições de vitória, respostas de sideboard, reanimação.
    const o = c.o.toLowerCase(), pw = parseInt(c.pt) || 0
    if (c.tg.includes('removal') && !REMOVAL_RE.test(o)) c.tg = c.tg.filter(t => t !== 'removal') // dados antigos: Ephemerate, Essence Flux…
    if (c.mt === 'Creature') c.tg.push('creature')
    if (/you win the game|loses the game|each opponent loses (\d+|x|that much|half)|deals? (\d+|x) damage to each opponent|creatures you control get \+[1-9]|double strike|\binfect\b|poison counter/.test(o)
      || (c.mt === 'Creature' && (pw >= 6 || (pw >= 4 && /flying|trample|menace|can't be blocked/.test(o))))
      || (/Planeswalker/.test(c.t) && c.cmc >= 3)) c.tg.push('wincon')
    if (/exile (all|target|each)[^.]*(cards? )?from (a|an|target|that|their|each|all) (player's |opponent's )?graveyards?|exile target player's graveyard|exile all graveyards|search its owner's graveyard, hand, and library|players can't gain life|(instant|noncreature|artifact) spells? (your opponents cast )?cost \{?\d/.test(o)) c.tg.push('hate')
    if (/return target creature card from (a|your|any|an opponent's) graveyard to the battlefield|put target creature card from a graveyard onto the battlefield|return up to (one|two) target creature cards? from (your|a) graveyard to the battlefield|target creature cards? in your graveyard[^.]*\.[^.]*return (the chosen cards|them|it) to the battlefield|return the chosen cards? to the battlefield/.test(o)) c.tg.push('reanimate')
    byName.set(c.n, c)
    byLower.set(c.l, c)
    for (const part of c.n.split(' // ')) { if (!byLower.has(part.toLowerCase())) byLower.set(part.toLowerCase(), c) }
  })
  const combosByCard = cards.map(() => [])
  combos.forEach((cb, k) => { for (const i of cb[1]) combosByCard[i].push(k) })
  return { meta, cards, combos, combosByCard, emb: new Int8Array(emb), pos: new Float32Array(pos), byName, byLower, D: meta.dim }
}

// --- Referências a tipos/mecânicas que o deck não tem (Essence Flux sem Spirits, Puresteel Paladin sem equipamentos) ---
const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }
const typeWord = w => { // «Dragons» → Dragon, «Elves» → Elf
  for (const t of [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ves$/, 'f')]) if (CREATURE_TYPES.has(t)) return t
  return null
}
// alvo de um troço que só olha para o adversário: «protection from Dragons», «can block Dragons», «an opponent casts a red spell»…
const HL = String.raw`((?:\w+, )*(?:\w+,? (?:or|and) )?\w+)(?: (?:creature|permanent|spell)s?)?` // «Spirit, Werewolf, or Demon»
const HATE_TARGET = new RegExp(String.raw`protection from ${HL}|can block ${HL}(?: as though it had reach)?|can.t be blocked by ${HL}|opponents? casts? an? ${HL}|${HL} (?:your opponents control|an opponent controls)|(?:destroy|exile) (?:target|all) ${HL}`, 'gi')
const TOKENS = /create[^.]*?tokens?/gi
const typesIn = s => (s.match(/\b[A-Z][a-z'-]+\b/g) || []).map(typeWord).filter(Boolean)
function textInfo(c) {
  if (c._ti) return c._ti
  let o = c.o.replace(/\([^)]*\)/g, '')
  for (const n of [c.n, ...c.n.split(' // '), c.n.split(',')[0]]) if (n.length > 3) o = o.split(n).join('~')
  const own = ownTypes(c), refs = [], hate = new Set()
  for (const m of o.match(TOKENS) || []) for (const t of typesIn(m)) own.add(t) // os ovos que a própria carta cria
  // tipos que a carta dá (becomes, «is a black Zombie», «doesn't remove Auras») não são referências
  o = o.replace(TOKENS, '').replace(/becomes? [^.]*/gi, '').replace(/doesn't remove [^.]*/gi, '')
    .replace(/\b(is|are) (an? )?((white|blue|black|red|green|colorless) )?[A-Z][a-z]+( [A-Z][a-z]+)*( in addition to (its|their) other (creature )?types)?/g, '')
  const lines = o.split(/[\n.;]/).map(x => x.trim()).filter(x => x && x !== '~' && x !== '//')
  let targeted = 0
  for (let line of lines) {
    // troços que só olham para o adversário: o tipo/cor é o dele, não conta como referência
    let any = false
    line = line.replace(HATE_TARGET, (m, ...g) => {
      const hits = g.slice(0, 5).filter(x => typeof x === 'string').flatMap(x => x.split(/,? (?:or|and) |, /))
        .map(w => (COLOR_WORD[w.toLowerCase()] ? w.toLowerCase() : typeWord(w))).filter(Boolean)
      if (!hits.length) return m
      any = true; for (const x of hits) hate.add(x)
      return ''
    })
    if (any && !line.replace(/~|\bthis (creature|card|permanent)\b|[\s,]/gi, '')) { targeted++; continue }
    // por linha: «Ninja and Rogue creatures» só está morta se nenhum dos tipos da linha estiver no deck
    const ts = (line.match(/(?<!non-)\b[A-Z][a-z'-]+\b/g) || []).map(typeWord).filter(Boolean)
    if (ts.some(t => own.has(t))) continue // a linha também fala do tipo da própria carta (Ninja and Rogue num Ninja)
    const g = new Set(ts)
    if (!own.has('Equipment') && /\bEquipment\b|\bequipped\b/.test(line)) g.add('Equipment')
    if (!own.has('Aura') && /\bAuras?\b/.test(line)) g.add('Aura')
    if (g.size) refs.push([...g])
  }
  // estreita: todas as linhas do texto só servem contra um tipo/cor do adversário (Dragon Hunter, Thraben Exorcism)
  return (c._ti = { refs, hate: c.mt !== 'Land' && lines.length && targeted === lines.length ? [...hate] : [] })
}
export const narrowHate = c => textInfo(c).hate
const COUNTERS_REF = tx('marcadores +1/+1')
/** Quantos representantes de cada tipo/mecânica o deck tem (changelings contam para todos; fichas criadas também). */
export function deckReps(deckCards) {
  const types = new Map(), add = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  let changeling = 0, placers = 0, spells = 0
  for (const d of deckCards) {
    if (d.mt !== 'Land') spells++
    if (/\bchangeling\b/i.test(d.o) || d.kw?.includes('Changeling')) changeling++
    for (const t of ownTypes(d)) add(types, t)
    for (const t of new Set((d.o.match(TOKENS) || []).flatMap(typesIn))) if (!ownTypes(d).has(t)) add(types, t)
    if (d.ro & RB.counterPlacer) placers++
  }
  return { types, changeling, placers, spells }
}
/** [[ref, n]] das referências da carta com menos de 2 representantes no deck (terrenos: 20% das não-terreno, porque a
 * mana deles só serve a esse tipo — Villainous Hideout com 2 Villains em 60 cartas é um terreno incolor). */
export function deadRefsN(c, deckCards, reps = deckReps(deckCards)) {
  const min = c.mt === 'Land' ? Math.max(2, Math.round(0.2 * reps.spells)) : 2
  const out = [], seen = new Set()
  for (const g of textInfo(c).refs) {
    const ns = g.map(r => [r, (reps.types.get(r) || 0) + (r === 'Equipment' || r === 'Aura' ? 0 : reps.changeling)])
    if (ns.every(([, n]) => n < min)) for (const x of ns) if (!seen.has(x[0])) { seen.add(x[0]); out.push(x) }
  }
  if (c.ro & RB.counterPayoff && !(c.ro & RB.counterPlacer) && reps.placers < 2) out.push([COUNTERS_REF, reps.placers])
  return out
}
export const deadRefs = (c, deckCards, reps) => deadRefsN(c, deckCards, reps).map(x => x[0])
export const deadTxt = ([t, n]) => (n ? tx('Refere {t}: o deck só tem {n}', { t, n }) : tx('Refere {t}: o deck não tem nenhum', { t }))

export const fmtBit = (data, fmt) => (fmt?.lg ? data.meta.formats.indexOf(fmt.lg) : -1)
const subset = (a, b) => { for (const ch of a) if (!b.includes(ch)) return false; return true }

// Filtros comuns à pesquisa e às sugestões.
export function passes(c, f, ctx) {
  if (ctx.bit >= 0 && !(c.lg & (1 << ctx.bit))) return false
  if (ctx.bit < 0 && c.un && !ctx.allowUn) return false
  if (ctx.identity != null && !subset(c.ci, ctx.identity)) return false
  if (!f) return true
  if (f.colors?.length) {
    const cs = c.co || ''
    if (f.colorMode === 'exact' && (cs.length !== f.colors.length || !subset(cs, f.colors.join('')))) return false
    if (f.colorMode === 'within' && !subset(cs, f.colors.join(''))) return false
    if ((f.colorMode || 'incl') === 'incl' && !f.colors.some(x => cs.includes(x))) return false
  }
  if (f.colorless && (c.co || '').length) return false
  if (f.type && c.mt !== f.type && !c.t.includes(f.type)) return false
  if (f.sub && !c.t.toLowerCase().includes(f.sub.toLowerCase())) return false
  if (f.tag && !c.tg.includes(f.tag)) return false
  if (f.rarity && c.r !== f.rarity) return false
  if (f.cmcMin != null && f.cmcMin !== '' && c.cmc < +f.cmcMin) return false
  if (f.cmcMax != null && f.cmcMax !== '' && c.cmc > +f.cmcMax) return false
  if (f.priceMax && (c.eur ?? c.usd ?? 0) > +f.priceMax) return false
  if (f.noLands && c.mt === 'Land') return false
  return true
}

export function search(data, q, f, ctx, limit = 150) {
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const out = []
  for (const c of data.cards) {
    if (words.length) {
      const hay = f?.inText ? c.l + '\n' + c.o.toLowerCase() + '\n' + c.t.toLowerCase() : c.l
      if (!words.every(w => hay.includes(w))) continue
    }
    if (!passes(c, f, ctx)) continue
    out.push(c)
  }
  const sort = f?.sort || 'pop'
  const key = {
    pop: c => c.er ?? 1e9, name: c => c.l, cmc: c => c.cmc, price: c => c.eur ?? c.usd ?? 1e9, new: c => -(+c.y || 0),
  }[sort]
  out.sort((a, b) => {
    if (words.length && sort === 'pop') {
      const pa = a.l.startsWith(words.join(' ')) ? 0 : 1, pb = b.l.startsWith(words.join(' ')) ? 0 : 1
      if (pa !== pb) return pa - pb
    }
    const ka = key(a), kb = key(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  return { total: out.length, cards: out.slice(0, limit) }
}

function dotInt8(E, D, a, b) {
  let s = 0
  const oa = a * D, ob = b * D
  for (let k = 0; k < D; k++) s += E[oa + k] * E[ob + k]
  return s / 16129 // 127²
}

export function similar(data, i, ctx, n = 12) {
  const { emb: E, D, cards } = data
  const best = []
  for (let j = 0; j < cards.length; j++) {
    if (j === i || !passes(cards[j], null, ctx)) continue
    const s = dotInt8(E, D, i, j)
    if (best.length < n || s > best[best.length - 1].s) {
      best.push({ c: cards[j], s }); best.sort((a, b) => b.s - a.s); if (best.length > n) best.pop()
    }
  }
  return best
}

const subtypes = c => {
  const front = c.t.split(' // ')[0]
  return front.includes('Creature') && front.includes('—') ? front.split('—')[1].trim().split(/\s+/) : []
}

/**
 * Sugestões a partir de sementes (as cartas de que gostas, ou o deck: comandantes primeiro e
 * as últimas cartas juntadas a seguir, porque são as que mais pesam no «mx»).
 * score = semelhança ao centro + à semente mais próxima + ao comandante
 *       + combos (completa / quase) + funções em falta no formato + tribo + palavras-chave + popularidade.
 * needs: {tag: [tem, meta]} vindo do modo de ajuda do formato.
 */
// Sementes que não são cartas: keywords (Flying, Outlast…), subtipos (Rat, Human…) e tipos (Creature, Artifact…).
// termsOf: o índice (com quantas cartas têm cada um), feito uma vez; termMatch: a carta tem esse termo?
const MAIN_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle', 'Legendary', 'Kindred']
const subsOf = c => (c.t.split('—')[1] || '').split('//')[0].trim().split(/\s+/).filter(Boolean)
export function termMatch(c, t) {
  if (t.k === 'kw') return (c.kw || []).includes(t.v)
  if (t.k === 'sub') return subsOf(c).includes(t.v)
  return c.t.split('—')[0].includes(t.v)
}
let TERMS = null
export function termsOf(data) {
  if (TERMS?.data === data) return TERMS.list
  const n = new Map(), add = (k, v) => { const key = `${k}:${v}`; n.set(key, (n.get(key) || 0) + 1) }
  for (const c of data.cards) {
    for (const k of c.kw || []) add('kw', k)
    for (const x of subsOf(c)) if (/^[A-Z]/.test(x)) add('sub', x)
    for (const x of MAIN_TYPES) if (c.t.split('—')[0].includes(x)) add('type', x)
  }
  const list = [...n].map(([key, count]) => { const [k, ...v] = key.split(':'); return { k, v: v.join(':'), n: count } }).filter(t => t.n >= 3).sort((a, b) => b.n - a.n)
  TERMS = { data, list }
  return list
}

export function recommend(data, { seeds, have, ctx, filters, limit = 60, seedTerms = [], commanders = [], needs = {}, co = null, deckStats = null, bracket = null, gcCount = 0, meta = null, archetype = null, prefs = null, tastes = [], deckSize = 99, turn = 8 }) {
  const pf = prefs?.on ? prefs : null
  const nivel = pf?.nivel ?? 3
  const metaW = pf ? 0.3 + 1.4 * (pf.meta ?? 0.5) : 1
  const styles = (pf?.estilo || []).filter(k => STYLES[k])
  const noCombos = bracket != null && bracket <= 2
  const gcLimit = bracket == null ? Infinity : bracket <= 2 ? 0 : bracket === 3 ? 3 : Infinity
  const { emb: E, D, cards, combos, combosByCard } = data
  if (!seeds.length) return []
  const pinned = seeds.slice(0, 16)
  const cen = new Float32Array(D)
  for (const s of seeds) for (let k = 0; k < D; k++) cen[k] += E[s * D + k]
  let norm = 0
  for (let k = 0; k < D; k++) norm += cen[k] * cen[k]
  norm = Math.sqrt(norm) * 127 || 1

  // Combos: o que falta a cada combo que já toca nas cartas que tens.
  const haveSet = new Set(have)
  const comboHits = new Map() // carta -> [{k, missing:[...]}]
  const touched = new Set()
  for (const i of haveSet) for (const k of combosByCard[i]) touched.add(k)
  for (const k of touched) {
    const missing = combos[k][1].filter(i => !haveSet.has(i))
    if (!missing.length || missing.length > 2) continue
    if (missing.some(i => !passes(cards[i], null, ctx))) continue // a outra peça fora das cores ou ilegal: combo impossível
    for (const i of missing) {
      if (!comboHits.has(i)) comboHits.set(i, [])
      comboHits.get(i).push({ k, missing })
    }
  }

  // Características do que já existe: temas, tribo dominante, palavras-chave frequentes.
  const tagCount = {}, tribeCount = {}, kwCount = {}
  let creatures = 0, spells = 0
  for (const s of seeds) {
    const c = cards[s]
    if (c.tg.includes('hate')) continue // respostas de sideboard não definem o plano do deck
    for (const t of c.tg) if (!['land', 'creature', 'wincon', 'hate'].includes(t)) tagCount[t] = (tagCount[t] || 0) + 1
    if (c.mt === 'Land') continue
    spells++
    const st = subtypes(c)
    if (st.length) creatures++
    for (const t of st) tribeCount[t] = (tribeCount[t] || 0) + 1
    for (const k of c.kw) kwCount[k] = (kwCount[k] || 0) + 1
  }
  const themes = new Set(Object.entries(tagCount).filter(([, n]) => n >= Math.max(2, seeds.length * 0.25)).map(([t]) => t))
  const [tribe, tribeN] = Object.entries(tribeCount).sort((a, b) => b[1] - a[1])[0] || []
  const hasTribe = tribe && tribeN >= Math.max(3, creatures * 0.3)
  const tribeRe = hasTribe ? new RegExp(`\\b${tribe.toLowerCase()}s?\\b|${tribe === 'Elf' ? 'elves' : '$^'}`) : null
  const topKw = Object.entries(kwCount).filter(([, n]) => n >= Math.max(3, spells * 0.15)).map(([k]) => k)

  // Probabilidade de montar combos (peças fora do comandante, tutores no deck).
  const cmdSet = new Set(commanders)
  const tutorsN = [...haveSet].filter(i => cards[i].tg.includes('tutor')).length
  const piecesOf = cb => cb[1].filter(x => !cmdSet.has(x)).length
  const pOf = (cb, extraTutor = 0) => comboProb({ pieces: piecesOf(cb), tutors: tutorsN + extraTutor, deckSize, turn })
  const Pref = comboProb({ pieces: 2, tutors: 3, deckSize, turn })
  const wP = p => Math.min(1.5, p / Pref)
  // bracket ≤ 3: combos infinitos de 2 cartas pesam metade
  const cbW = cb => (bracket != null && bracket <= 3 && cb[1].length === 2 && /infinite/i.test(cb[2].join(' ')) ? 0.5 : 1)
  const fullInDeck = deckCombos(data, [...haveSet], ctx).full
  const bestDeckCombo = fullInDeck[0]?.cb

  // Torneios: núcleo do arquétipo provável e parceiras das cartas do deck.
  const archCore = new Map((archetype?.core || []).map(x => [x.i, x]))
  const metaPartner = new Map()
  if (meta) for (const h of haveSet) for (const p of meta.pairs.get(h) || []) {
    if (!metaPartner.has(p.i)) metaPartner.set(p.i, [])
    metaPartner.get(p.i).push({ from: cards[h].n, lift: p.lift, cond: p.cond })
  }

  // Quem no deck tem cada papel (para dizer "alimenta X, Y" com nomes).
  const byRole = Object.fromEntries(ALL_ROLES.map(r => [r, []]))
  for (const i of haveSet) if (!cards[i].tg.includes('hate')) for (const r of ALL_ROLES) if (cards[i].ro & RB[r]) byRole[r].push(i)
  const reanimators = [...haveSet].filter(i => cards[i].tg.includes('reanimate'))

  // Curva e cores do deck.
  const cheapN = deckStats ? deckStats.curve[0] + deckStats.curve[1] + deckStats.curve[2] : 0
  const lowCheap = deckStats && deckStats.spells >= 15 && cheapN < deckStats.spells * 0.25
  const heavy = deckStats && deckStats.spells >= 15 && deckStats.avgMv > 3.8
  const needColors = []
  if (deckStats && deckStats.lands >= 8) {
    const pipTotal = Object.values(deckStats.pips).reduce((a, b) => a + b, 0) || 1
    for (const k of 'WUBRG') {
      const share = deckStats.pips[k] / pipTotal
      if (share >= 0.1 && deckStats.sources[k] / deckStats.lands < share * 0.85) needColors.push(k)
    }
  }

  // EDHREC (rank «er») só diz algo em formatos de comandante; nos de 60 cartas manda o meta dos torneios
  const edhOk = commanders.length > 0 || deckSize >= 99
  const deckCards = [...haveSet].map(i => cards[i]), reps = deckReps(deckCards)
  // «Sugerir cartas fora das cores» (preferências; só sem comandante): sem cores do deck, nada se corta por cor
  const deckCi = prefs?.foraCores && !commanders.length ? '' : ctx?.identity ?? [...new Set(deckCards.filter(c => c.mt !== 'Land').flatMap(c => [...c.ci]))].join('')
  const cSrc = deckStats ? deckStats.sources.C : Infinity
  // meta: só conta a inclusão vinda de arquétipos com cores compatíveis (Arid Mesa não vem dos decks R/W para um deck UB)
  const archOk = meta ? meta.archetypes.map(a => !deckCi || [...a.colors].every(k => deckCi.includes(k))) : []
  const metaIncl = m => (!m?.archs.length || !deckCi ? m?.incl || 0 : m.incl * m.archs.filter(k => archOk[k]).length / m.archs.length)

  const LOGR = Math.log(40000)
  const res = [], allSem = [], allCmd = []
  for (let i = 0; i < cards.length; i++) {
    if (haveSet.has(i)) continue
    const c = cards[i]
    if (/\bBasic\b/.test(c.t)) continue
    if (!passes(c, filters, ctx)) continue
    if (c.gc && gcCount >= gcLimit) continue
    if (c.mt === 'Land' && ((deckCi && offColorLand(landInfo(c, commanders.length > 0), deckCi)) || deadRefsN(c, deckCards, reps).length)) continue
    if (cSrc < 4 && /\{C\}/.test(c.mc || '')) continue // {C} no custo sem fontes de incolor
    let sem = 0
    const o = i * D
    for (let k = 0; k < D; k++) sem += cen[k] * E[o + k]
    sem /= norm * 127
    let mx = -1, near = -1
    for (const s of pinned) { const v = dotInt8(E, D, s, i); if (v > mx) { mx = v; near = s } }
    let cmd = 0
    for (const s of commanders) cmd = Math.max(cmd, dotInt8(E, D, s, i))
    // Cada fator guarda o seu peso: é o que o «Porquê?» mostra.
    const P = {}
    P.texto = commanders.length ? 0.4 * sem + 0.35 * mx : 0.55 * sem + 0.45 * mx
    const stm = seedTerms.length ? seedTerms.filter(t => termMatch(c, t)) : []  // sementes-termo (Flying, Rat…) que a carta tem
    if (seedTerms.length) P.semente = stm.length ? 0.22 + 0.08 * (stm.length - 1) : 0
    P.comandante = commanders.length ? 0.25 * cmd : 0
    P.popular = edhOk && c.er ? 0.06 * Math.max(0, 1 - Math.log(c.er) / LOGR) : 0
    const hits = comboHits.get(i)
    let completes = 0, partial = 0
    let comboP = 0, cw = 0, pw = 0
    if (hits) for (const h of hits) {
      const p = pOf(combos[h.k]), w = wP(p) * cbW(combos[h.k])
      if (h.missing.length === 1) { completes++; cw += 0.18 * w; comboP = Math.max(comboP, p) } else { partial++; pw += 0.025 * w }
    }
    P.combos = noCombos ? 0 : Math.min(0.35, cw) + Math.min(0.08, pw)
    // Tutor num deck com combos: sobe a probabilidade de os montar.
    let tutorGain = null
    if (!noCombos && bestDeckCombo && c.tg.includes('tutor')) {
      const a = pOf(bestDeckCombo), b = pOf(bestDeckCombo, 1)
      P.combos += Math.min(0.08, (b - a) * 2)
      tutorGain = [a, b]
    }
    let need = null
    for (const t of c.tg) {
      const n = needs[t]
      if (n && n[0] < n[1] && (!need || n[1] - n[0] > need[1][1] - need[1][0])) need = [t, n]
    }
    P.falta = need ? 0.08 * Math.min(1, (need[1][1] - need[1][0]) / need[1][1]) : 0
    const tribal = hasTribe && (subtypes(c).includes(tribe) || tribeRe.test(c.o.toLowerCase()) || /changeling/i.test(c.o))
    const kws = topKw.filter(k => c.kw.includes(k))
    P.tribo = (tribal ? 0.07 : 0) + Math.min(0.04, kws.length * 0.02)
    const dead = deadRefsN(c, deckCards, reps)
    P.tribo -= 0.06 * dead.length
    // Plano de reanimação: as criaturas grandes são o alvo.
    const power = parseInt(c.pt) || 0
    const reanTarget = reanimators.length > 0 && c.mt === 'Creature' && (power >= 6 || c.cmc >= 6)
    if (reanTarget) P.tribo += 0.1
    // Respostas de sideboard contam pouco como cartas do deck principal.
    if (c.tg.includes('hate')) P.texto *= 0.5
    // Interações: esta carta aproveita o que o deck gera, ou gera o que o deck aproveita.
    const inter = []
    for (const [a, b] of PAIRS) {
      if (c.ro & RB[b] && byRole[a].length >= 2) inter.push({ side: 'usa', role: a, who: byRole[a] })
      else if (c.ro & RB[a] && byRole[b].length >= 2) inter.push({ side: 'alimenta', role: b, who: byRole[b] })
    }
    P.interacoes = Math.min(0.12, inter.reduce((s, x) => s + 0.03 + 0.01 * Math.min(4, x.who.length), 0))
    // Decks reais (EDHREC): inclusão e sinergia com o comandante, lift com as outras cartas.
    const edh = co?.get(i)
    let edhCmd = null
    const edhCards = []
    P.decksReais = 0
    if (edh) {
      let b = 0
      for (const e of edh) {
        if (e.kind === 'commanders') { edhCmd = e; b += 0.35 * Math.max(0, Math.min(e.syn, 0.5)) / 0.5 + 0.2 * e.incl }
        else if (e.lift > 1) { edhCards.push(e); b += 0.05 * Math.min(1, Math.log(e.lift) / Math.log(6)) * Math.min(1, e.incl * 4) * e.pot / (e.pot + 200) }
      }
      P.decksReais = Math.min(0.4, b)
      edhCards.sort((x, y) => y.lift - x.lift)
    }
    // Torneios (MTGTop8): inclusão no formato, peça do arquétipo, parceiras em listas reais.
    P.torneios = 0
    const mRow0 = meta?.byCard.get(i), mInc = metaIncl(mRow0), mRow = mInc > 0 ? mRow0 : null
    const mArch = archCore.get(i), mPart = (metaPartner.get(i) || []).sort((a, b) => b.cond - a.cond)
    if (mRow) P.torneios += 0.25 * Math.min(1, mInc * 2.5)
    if (mArch) P.torneios += 0.25 * mArch.incl
    if (mPart.length) P.torneios += 0.04 * Math.min(3, mPart.length)
    P.torneios = Math.min(0.45, P.torneios)
    // Com meta suficiente, o que os torneios jogam pesa mais do que o texto parecido.
    if (meta && meta.decks >= 100) {
      P.texto *= 0.6
      if (!mRow && !mArch && !mPart.length) P.torneios = -0.05
    }
    // Testes do Laboratório: responde ao que nos venceu nos jogos guardados.
    const tb = testsBoost(c, ctx?.tests)
    if (tb) P.testes = tb.v
    let curveNote = null
    if (lowCheap && c.mt !== 'Land' && c.cmc <= 2) { P.falta += 0.03; curveNote = tx('Barata (MV {mv}): o deck só tem {n} cartas até 2', { mv: c.cmc, n: cheapN }) }
    if (heavy && c.cmc >= 5) P.falta -= 0.03
    let fix = null
    if (needColors.length && c.mt === 'Land') {
      const any = /any color|any one color/i.test(c.o)
      const gives = needColors.filter(k => any || c.o.includes(`{${k}}`))
      if (gives.length) { P.falta += 0.05 * gives.length; fix = gives }
    }
    // Personalização (opcional): nível, peso do meta, estilo e gosto pelos decks do utilizador.
    const stHit = []
    let tasteBest = 0, tasteName = ''
    if (pf) {
      P.decksReais *= metaW
      if (P.torneios > 0) P.torneios *= metaW
      P.popular = nivel >= 4 ? P.popular * 3 : nivel <= 1 ? -P.popular : P.popular
      P.combos *= nivel >= 5 ? 1.6 : nivel === 4 ? 1.2 : nivel === 2 ? 0.4 : nivel <= 1 ? 0 : 1
      if ((pf.meta ?? 0.5) < 0.3 && (!c.er || c.er > 3000)) P.original = 0.05
      // Peso do estilo: manda mais em decks originais/fun, menos quando se segue o meta e se joga a competir.
      const styleW = 0.12 * (1.4 - (pf.meta ?? 0.5)) * (nivel <= 1 ? 1.2 : nivel >= 5 ? 0.7 : nivel === 4 ? 0.85 : 1) * (pf.estiloForca ?? 1)
      let st = 0
      for (const k of styles) {
        const S = STYLES[k]
        const hit = k === 'tribal' ? tribal : S.test(c, data)
        if (hit) { st += k === 'combo' ? styleW / 2 + P.combos : styleW; stHit.push(S.label) }
        if (S.neg?.(c)) st -= 0.06
      }
      P.estilo = st
      for (const t of tastes) {
        let d = 0
        for (let k = 0; k < D; k++) d += t.vec[k] * E[o + k]
        d /= 127
        if (d > tasteBest) { tasteBest = d; tasteName = t.name }
      }
      if (tastes.length) P.gosto = 0.35 * tasteBest
    }
    const score = Object.values(P).reduce((a, b) => a + b, 0)
    allSem.push(sem)
    if (commanders.length) allCmd.push(cmd)
    res.push({ i, score, P, sem, near, cmd, stm, completes, partial, hits, comboP, tutorGain, reanTarget, pw: power, need, tribal, kws, inter, edhCmd, edhCards, curveNote, fix, mRow, mInc, mArch, mPart, stHit, tasteBest, tasteName, tb, dead })
  }
  res.sort((a, b) => b.score - a.score)
  const name = i => cards[i].n
  allSem.sort((a, b) => a - b)
  allCmd.sort((a, b) => a - b)
  const rank = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m } return arr.length ? lo / arr.length : 0 }
  return res.slice(0, limit).map(r => {
    const c = cards[r.i]
    const why = []
    if (r.completes && !noCombos) {
      const h = r.hits.filter(h => h.missing.length === 1).sort((a, b) => (combos[b.k][5] || 0) - (combos[a.k][5] || 0))[0]
      const cb = combos[h.k]
      why.push({ k: 'combo', txt: tx('Combo com {with} → {res}{more} · ≈{p} até ao turno {turn}', { with: cb[1].filter(x => x !== r.i).map(name).join(' + '), res: cb[2][0] || 'combo', more: r.completes > 1 ? ` (+${r.completes - 1})` : '', p: pctP(pOf(cb)), turn }), combo: cb[0] })
    } else if (r.partial && !noCombos) {
      const h = r.hits[0], cb = combos[h.k]
      const other = h.missing.find(x => x !== r.i)
      why.push({ k: 'combo2', txt: tx('Quase-combo com {with}: falta também {c}', { with: cb[1].filter(x => haveSet.has(x)).map(name).join(' + '), c: name(other) }), combo: cb[0] })
    }
    if (r.tb) why.push({ k: 'testes', txt: r.tb.txt })
    if (r.mArch) why.push({ k: 'meta', txt: tx('Peça de {a}: em {p}% das listas, {q} cópias', { a: archetype.name, p: Math.round(r.mArch.incl * 100), q: num(r.mArch.copies, 1) }) })
    else if (r.mRow && r.mInc >= 0.03) why.push({ k: 'meta', txt: tx('Em {p}% dos decks de {f} (MTGTop8, {n} listas)', { p: Math.round(r.mRow.incl * 100), f: meta.fmtName, n: meta.decks }) })
    if (r.mPart.length) why.push({ k: 'meta', txt: tx('Jogada com {with} em torneios ({p}% das vezes)', { with: r.mPart.slice(0, 2).map(p => p.from).join(tx(' e ')), p: Math.round(r.mPart[0].cond * 100) }) })
    if (r.tutorGain) why.push({ k: 'combo', txt: tx('Tutor: o teu combo passa de ≈{a} para ≈{b} até ao turno {turn}', { a: pctP(r.tutorGain[0]), b: pctP(r.tutorGain[1]), turn }) })
    if (r.edhCmd) {
      const e = r.edhCmd
      why.push({ k: 'edh', txt: tx('Em {p}% dos {n} decks de {c}', { p: Math.round(e.incl * 100), n: e.pot.toLocaleString(LOCALE), c: e.from }) + (e.syn ? tx(' (sinergia {s}%)', { s: `${e.syn > 0 ? '+' : ''}${Math.round(e.syn * 100)}` }) : '') })
    }
    if (r.edhCards.length) {
      const top = r.edhCards.slice(0, 2)
      why.push({ k: 'edh', txt: tx('Jogada com {with} em decks reais ({x}× mais do que o normal)', { with: top.map(e => e.from).join(tx(' e ')), x: num(top[0].lift, 1) }) })
    }
    for (const x of r.inter.slice(0, 2)) {
      const names = x.who.slice(0, 2).map(name).join(', ') + (x.who.length > 2 ? ` (+${x.who.length - 2})` : '')
      why.push({ k: 'inter', txt: x.side === 'usa' ? tx('Aproveita {names}, que {role}', { names, role: ROLE_LABEL[x.role] }) : tx('Alimenta {names}, que {role}', { names, role: ROLE_LABEL[x.role] }) })
    }
    if (r.stm?.length) why.unshift({ k: 'semente', txt: tx('Semente: {t}', { t: r.stm.map(t => t.v).join(', ') }) })
    if (r.need) why.push({ k: 'falta', txt: tx('O deck precisa de {what} ({h}/{n})', { what: r.need[0] === 'wincon' ? tx('condições de vitória') : TAG_LABEL[r.need[0]].toLowerCase(), h: r.need[1][0], n: r.need[1][1] }) })
    if (r.reanTarget) why.push({ k: 'inter', txt: tx('Alvo de reanimação (poder {p}) para {who}', { p: r.pw, who: reanimators.slice(0, 2).map(name).join(', ') }) })
    if (c.tg.includes('wincon') && !r.need) why.push({ k: 'tema', txt: tx('Condição de vitória') })
    if (r.fix) why.push({ k: 'falta', txt: tx('Dá {c}, as cores com menos fontes no deck', { c: r.fix.join('/') }) })
    if (r.curveNote) why.push({ k: 'falta', txt: r.curveNote })
    if (commanders.length && r.cmd >= 0.5) why.push({ k: 'cmd', txt: tx('Sinergia com {c}', { c: commanders.map(name).join(tx(' e ')) }) })
    if (r.tribal) why.push({ k: 'tribo', txt: tx('Tribo {t}: {n} no deck', { t: tribe, n: tribeN }) })
    if (r.kws.length) why.push({ k: 'kw', txt: tx('{kw}, como várias cartas do deck', { kw: r.kws.join(', ') }) })
    const shared = c.tg.filter(t => themes.has(t)).map(t => TAG_LABEL[t])
    if (shared.length && !r.inter.length) why.push({ k: 'tema', txt: tx('Reforça: {t}', { t: shared.slice(0, 3).join(', ') }) })
    if (r.stHit.length) why.push({ k: 'estilo', txt: tx('Estilo: {s}', { s: r.stHit.join(', ') }) })
    if (r.tasteName && r.tasteBest >= 0.3) why.push({ k: 'gosto', txt: tx('Ao teu gosto: perto das cartas de «{d}»', { d: r.tasteName }) })
    if (r.P.original) why.push({ k: 'estilo', txt: tx('Escolha original (pouco jogada)') })
    if (r.near >= 0 && why.length < 3) why.push({ k: 'perto', txt: tx('Parecida com {c}', { c: name(r.near) }) })
    if (edhOk && c.er && c.er <= 300 && why.length < 3) why.push({ k: 'tema', txt: tx('Staple: n.º {n} do EDHREC', { n: c.er }) })
    why.splice(Math.min(1, why.length), 0, ...r.dead.map(d => ({ k: 'tribo', txt: deadTxt(d) }))) // aviso logo a seguir ao 1.º motivo
    // Detalhe completo para o «Porquê?».
    const detail = {
      combos: (r.hits || []).sort((a, b) => a.missing.length - b.missing.length || (combos[b.k][5] || 0) - (combos[a.k][5] || 0)).slice(0, 4).map(h => {
        const cb = combos[h.k]
        return { id: cb[0], with: cb[1].filter(x => x !== r.i).map(name), missing: h.missing.filter(x => x !== r.i).map(name), produces: cb[2], requires: cb[3], decks: cb[5] }
      }),
      edhCmd: r.edhCmd, edhCards: r.edhCards.slice(0, 5), mRow: r.mRow, mArch: r.mArch ? { ...r.mArch, name: archetype.name } : null, mPart: r.mPart.slice(0, 4), metaName: meta?.fmtName, metaDecks: meta?.decks,
      inter: r.inter.map(x => ({ side: x.side, label: ROLE_LABEL[x.role], who: x.who.map(name) })),
      roles: ALL_ROLES.filter(k => c.ro & RB[k]).map(k => ROLE_LABEL[k]),
      near: r.near >= 0 ? name(r.near) : null, simPct: rank(allSem, r.sem), cmdPct: commanders.length ? rank(allCmd, r.cmd) : null,
    }
    return { c, score: r.score, parts: r.P, why: why.slice(0, 6), hits: r.hits, detail }
  })
}

// Eixos do deck: pares alimenta/aproveita com pelo menos um "payoff" (é isso que mostra intenção).
const AXES = [
  [tx('Fichas'), 'tokenMaker', 'tokenPayoff'], [tx('Aristocratas (sacrifício)'), 'sacOutlet', 'deathPayoff'],
  [tx('Marcadores +1/+1'), 'counterPlacer', 'counterPayoff'], [tx('ETB e blink'), 'etb', 'blink'],
  [tx('Cemitério'), 'selfFill', 'recursion'], [tx('Ganho de vida'), 'lifeGain', 'lifePayoff'],
  [tx('Instantâneos e feitiços'), 'spells', 'spellPayoff'], [tx('Artefactos'), 'artifactMaker', 'artifactPayoff'],
  [tx('Terrenos (landfall)'), 'extraLands', 'landfall'], [tx('Compra de cartas'), 'draw', 'drawPayoff'],
]
export function deckPlan(data, idxs) {
  const out = []
  idxs = idxs.filter(i => !data.cards[i].tg.includes('hate'))
  for (const [label, a, b] of AXES) {
    const en = idxs.filter(i => data.cards[i].ro & RB[a]), pay = idxs.filter(i => data.cards[i].ro & RB[b])
    if (pay.length && en.length + pay.length >= 4) out.push({ label, enablers: en.length, payoffs: pay.length, n: new Set([...en, ...pay]).size, score: en.length + 2 * pay.length, roles: [a, b] })
  }
  const tribes = {}
  for (const i of idxs) for (const t of subtypes(data.cards[i])) tribes[t] = (tribes[t] || 0) + 1
  const [tribe, tn] = Object.entries(tribes).sort((x, y) => y[1] - x[1])[0] || []
  if (tn >= 5) out.push({ label: tx('Tribo {t}', { t: tribe }), n: tn, score: tn * 1.5, enablers: tn, payoffs: 0, roles: [] })
  return out.sort((x, y) => y.score - x.score).slice(0, 4)
}

const ROLE_TAGS = ['ramp', 'draw', 'removal', 'wipe', 'counter', 'tutor', 'protection', 'recursion']

/**
 * Cartas do deck que menos encaixam, com o porquê, e uma troca com a mesma função.
 * fit = semelhança ao resto + interações + combos + decks reais + função de que o deck precisa.
 */
export function deckCuts(data, deck, { ctx, co, commanders = [], needs = {}, recs = [], limit = 8, meta = null, archetype = null }) {
  const { emb: E, D, cards } = data
  const main = Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && !/\bBasic\b/.test(c.t))
  const nonland = main.filter(c => c.mt !== 'Land').map(c => c.i)
  if (nonland.length < 8) return []
  const all = [...new Set([...nonland, ...commanders])]
  const sum = new Float32Array(D)
  for (const i of all) for (let k = 0; k < D; k++) sum[k] += E[i * D + k]
  const byRole = Object.fromEntries(ALL_ROLES.map(r => [r, []]))
  for (const i of all) for (const r of ALL_ROLES) if (cards[i].ro & RB[r]) byRole[r].push(i)
  const full = new Set(deckCombos(data, all, ctx).full.flatMap(x => x.cb[1]))
  const name = i => cards[i].n
  const sims = new Map()
  for (const i of nonland) {
    let dot = 0, nn = 0
    for (let k = 0; k < D; k++) { const v = sum[k] - E[i * D + k]; dot += v * E[i * D + k]; nn += v * v }
    sims.set(i, dot / ((Math.sqrt(nn) || 1) * 127))
  }
  const q25 = [...sims.values()].sort((a, b) => a - b)[Math.floor(nonland.length * 0.25)]
  const out = []
  const seedSet = new Set(deck.seeds || [])
  const tribeCount = {}
  for (const i of nonland) for (const t of subtypes(cards[i])) tribeCount[t] = (tribeCount[t] || 0) + 1
  const [tribe0, tn] = Object.entries(tribeCount).sort((a, b) => b[1] - a[1])[0] || []
  const tribe = tn >= 5 ? tribe0 : null
  const edhOk = commanders.length > 0  // EDHREC só com comandante; nos de 60 cartas, o meta
  const ev = ctx?.tests?.cards && ctx.tests.exact >= 10 ? ctx.tests : null
  // frequência no meta de um alvo (tipo ou cor): a maior inclusão de uma carta dele, ou a quota dos arquétipos que o jogam
  const isT = (c, t) => c.mt !== 'Land' && (COLOR_WORD[t] ? (c.co || '').includes(COLOR_WORD[t]) : ownTypes(c).has(t))
  const metaShare = t => {
    let p = 0
    for (const [j, m] of meta.byCard) if (m.incl > p && isT(cards[j], t)) p = m.incl
    const arch = meta.archetypes.filter(a => a.core.some(x => x.incl >= 0.5 && isT(cards[x.i], t))).reduce((a, x) => a + x.share, 0)
    return Math.min(1, Math.max(p, arch))
  }
  for (const i of nonland) {
    const c = cards[i]
    if (seedSet.has(c.n) || c.tg.includes('hate')) continue // as tuas sementes não se cortam; respostas de sideboard têm aviso próprio
    const why = []
    let fit = 0, buts = 0, force = false, sb = false  // buts: motivos «Mas…», a favor de ficar
    // só serve contra um tipo/cor do adversário (Dragon Hunter): para o sideboard, ou fora se o meta quase não o joga
    const hate = narrowHate(c)
    if (hate.length) {
      const x = hate.map(t => (COLOR_WORD[t] ? COLORS[COLOR_WORD[t]].toLowerCase() : t)).join('/')
      const p = meta ? Math.max(...hate.map(metaShare)) : null
      fit -= 0.3; force = true
      why.push(p == null ? tx('Carta de sideboard: só serve contra {x}', { x }) : tx('Carta de sideboard: só serve contra {x} ({p}% do meta de {f})', { x, p: Math.round(p * 100), f: meta.fmtName }))
      if (p != null && p < 0.05) { fit -= 0.3; why.push(tx('Quase ninguém joga {x}: corta de vez', { x })) } else sb = true
    }
    // com 10+ jogos exatos: quem ganha mais quando aparece não se corta pelo texto
    const xe = ev?.cards[c.n]
    if (!force && xe?.seen && wrDelta(ev, xe) > 0 && passes(c, null, ctx)) continue
    if (!passes(c, null, ctx)) { fit -= 2; why.push(ctx.identity != null ? tx('Fora da identidade ou ilegal no formato') : tx('Ilegal no formato')) }
    const sim = sims.get(i)
    fit += 0.5 * sim
    const partners = new Set()
    for (const [a, b] of PAIRS) {
      if (c.ro & RB[a]) for (const j of byRole[b]) if (j !== i) partners.add(j)
      if (c.ro & RB[b]) for (const j of byRole[a]) if (j !== i) partners.add(j)
    }
    fit += 0.05 * Math.min(4, partners.size)
    const inCombo = full.has(i)
    if (inCombo) fit += 0.25
    const e = co?.get(i)?.find(x => x.kind === 'commanders')
    if (e) fit += 0.35 * Math.max(-0.2, Math.min(e.syn, 0.5)) / 0.5 + 0.2 * e.incl
    const mRow = meta?.byCard.get(i), archIncl = archetype?.core.find(x => x.i === i)?.incl || 0
    if (archIncl >= 0.75) continue // peça central do arquétipo: não se propõe cortar
    if (meta && archetype) { // só faz sentido comparar com o meta se o deck for um arquétipo do meta
      fit += 0.3 * Math.min(1, (mRow?.incl || 0) * 2.5) + 0.5 * archIncl
      if (!archIncl && (!mRow || mRow.incl < 0.02)) why.push(tx('Quase não aparece em torneios de {f} ({p}% das listas)', { f: meta.fmtName, p: mRow ? Math.round(mRow.incl * 100) : 0 }))
      else if (archIncl) { buts++; why.push(tx('Mas está em {p}% das listas de {a}', { p: Math.round(archIncl * 100), a: archetype.name })) }
    }
    const needed = c.tg.find(t => needs[t] && needs[t][0] <= needs[t][1])
    if (needed) fit += 0.1
    if (edhOk && c.er) fit += 0.04 * Math.max(0, 1 - Math.log(c.er) / Math.log(40000))
    else if (!edhOk && mRow) fit += 0.04 * Math.min(1, mRow.incl * 2.5)
    const roleCard = c.tg.some(t => ['removal', 'draw', 'ramp', 'counter', 'wipe', 'protection', 'tutor', 'discard'].includes(t))
    if (roleCard && (edhOk ? c.er && c.er < 800 : (mRow?.incl || 0) >= 0.1)) fit += 0.15 // peça de função muito jogada: vale por si
    const tribal = tribe && (subtypes(c).includes(tribe) || c.o.toLowerCase().includes(tribe.toLowerCase()))
    if (tribal) fit += 0.25
    if (sim < q25 && !tribal) why.push(tx('Texto entre os mais afastados do resto do deck'))
    if (!partners.size && !roleCard) why.push(tx('Não interage com nenhuma carta do deck'))
    else if (partners.size === 1 && !roleCard) why.push(tx('Só interage com {c}', { c: [...partners].map(name).join('') }))
    if (commanders.length && co) {
      if (!e) why.push(tx('Fora das ~400 cartas mais jogadas com {c} (EDHREC)', { c: commanders.map(name).join(tx(' e ')) }))
      else if (e.incl < 0.05) why.push(tx('Só em {p}% dos decks de {c}', { p: Math.max(1, Math.round(e.incl * 100)), c: e.from }) + (e.syn < 0 ? tx(' (sinergia {s}%)', { s: Math.round(e.syn * 100) }) : ''))
    }
    if (!needed && !inCombo && c.cmc >= 6) why.push(tx('MV {mv} sem função de que o deck precise', { mv: c.cmc }))
    const dd = ctx?.tests?.dead[c.n], im = ctx?.tests?.impact[c.n]
    if (dd && dd.dead >= 2 && dd.dead / dd.seen >= 0.5) { fit -= 0.2 * dd.dead / dd.seen; why.push(tx('Testes: ficou na mão sem ser jogada em {a} de {n} jogos', { a: dd.dead, n: dd.seen })) }
    if (im?.dmg >= 5) { fit += 0.1; buts++; why.push(tx('Mas nos testes causou {n} de dano', { n: im.dmg })) }
    if (needed) { buts++; why.push(tx('Mas conta como {t}, de que o deck precisa', { t: TAG_LABEL[needed].toLowerCase() })) }
    out.push({ c, fit, why, buts, force, sb })
  }
  out.sort((a, b) => a.fit - b.fit)
  const used = new Set()
  const real = out.filter(x => x.force || x.why.length > x.buts) // só se propõe cortar com um motivo
  return real.slice(0, limit).map(x => {
    const fn = x.c.tg.filter(t => ROLE_TAGS.includes(t))
    const swap = recs.find(r => !used.has(r.c.i) && r.c.mt !== 'Land' && (fn.length ? fn.some(t => r.c.tg.includes(t)) : !r.c.tg.some(t => ROLE_TAGS.includes(t))))
    if (swap) used.add(swap.c.i)
    return { ...x, swap: swap ? { c: swap.c, why: swap.why[0]?.txt, fn: fn.map(t => TAG_LABEL[t].toLowerCase()) } : null }
  })
}

// Combos completos e a uma carta de distância, considerando o que se tem.
export function deckCombos(data, have, ctx) {
  const haveSet = new Set(have)
  const touched = new Set()
  for (const i of haveSet) for (const k of data.combosByCard[i]) touched.add(k)
  const full = [], near = []
  for (const k of touched) {
    const cb = data.combos[k]
    const missing = cb[1].filter(i => !haveSet.has(i))
    if (missing.some(i => !passes(data.cards[i], null, ctx))) continue
    if (!missing.length) full.push({ k, cb, missing })
    else if (missing.length === 1) near.push({ k, cb, missing })
  }
  const byPop = (a, b) => (b.cb[5] || 0) - (a.cb[5] || 0)
  return { full: full.sort(byPop), near: near.sort(byPop) }
}

/**
 * Ligações dentro do deck para o mapa: combos completos (dourado) e pares alimenta→aproveita (ciano).
 * Devolve [{a, b, kind: 'combo'|'inter', label}], limitado para o mapa continuar legível.
 */
export function deckLinks(data, idxs, ctx, max = 160) {
  const { cards } = data
  const out = [], seen = new Set()
  const push = (a, b, kind, label) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`
    if (a === b || seen.has(k)) return
    seen.add(k); out.push({ a, b, kind, label })
  }
  for (const { cb } of deckCombos(data, idxs, ctx).full.slice(0, 20)) {
    const ids = cb[1]
    for (let k = 0; k < ids.length; k++) push(ids[k], ids[(k + 1) % ids.length], 'combo', cb[2][0] || 'combo')
  }
  for (const [a, b] of PAIRS) {
    const en = idxs.filter(i => cards[i].ro & RB[a]), pay = idxs.filter(i => cards[i].ro & RB[b])
    for (const p of pay) for (const e of en.slice(0, 3)) { if (out.length >= max) return out; push(e, p, 'inter', `${ROLE_LABEL[a]} → ${ROLE_LABEL[b]}`) }
  }
  return out
}

// --- Sideboard sem meta: respostas por tipo de ameaça ---
export const SIDE_CATS = [
  [tx('Contra cemitério'), /exile (all|target|each)[^.]*graveyards?|exile target player's graveyard|cards in graveyards can't|graveyards? (can't|lose)/],
  [tx('Contra artefactos e encantamentos'), /destroy target (artifact|enchantment|artifact or enchantment)|destroy all (artifacts|enchantments)|exile target (artifact|enchantment)/],
  [tx('Contra feitiços e combo'), /counter target (instant|sorcery|noncreature|activated)|spells? (your opponents cast )?cost \{|can't cast|players can't (search|activate)/],
  [tx('Contra aggro'), /damage to each creature|destroy all creatures|each creature gets -|you gain (4|5|6|7) life/],
  [tx('Contra voadores'), /creature with flying|destroy target creature with flying|\breach\b/],
  [tx('Contra controlo'), /can't be countered|hexproof|uncounterable/],
]
export function sideSuggest(data, deck, ctx, perCat = 3) {
  const inDeck = n => deck.main[n] || deck.side[n]
  const cols = new Set([...deck.commanders, ...Object.keys(deck.main)].flatMap(n => [...(data.byName.get(n)?.ci || '')]))
  const out = []
  for (const [label, re] of SIDE_CATS) {
    const list = data.cards.filter(c => c.mt !== 'Land' && c.cmc <= 4 && !inDeck(c.n) && re.test(c.o.toLowerCase()) && passes(c, null, ctx) && [...c.ci].every(k => cols.has(k)))
      .sort((a, b) => (a.er ?? 1e9) - (b.er ?? 1e9)).slice(0, perCat)
    if (list.length) out.push({ label, cards: list })
  }
  return out
}

// --- Meta de torneios (MTGTop8), para formatos construídos ---
export const META_FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern']
const metaCache = new Map()
export function fetchMeta(key) {
  if (!META_FORMATS.includes(key)) return Promise.resolve(null)
  if (!metaCache.has(key)) metaCache.set(key, fetch(`/api/meta/${key}`).then(r => (r.ok ? r.json() : null)).catch(() => null))
  return metaCache.get(key)
}

/** Índice da meta: por carta {incl, copies, side, sideCopies, archs}, núcleos dos arquétipos e pares. */
export function metaIndex(data, raw, fmtName) {
  if (!raw?.cards?.length) return null
  const find = n => (data.byName.get(n) || data.byLower.get(n.toLowerCase()))?.i
  const byCard = new Map()
  for (const [n, incl, copies, side, sideCopies, archs] of raw.cards) {
    const i = find(n)
    if (i != null) byCard.set(i, { incl, copies, side, sideCopies, archs: archs || [] })
  }
  const archetypes = (raw.archetypes || []).map(a => ({ name: a.name, share: a.share, decks: a.decks, core: a.core.map(([n, incl, copies]) => ({ i: find(n), incl, copies })).filter(x => x.i != null) }))
  // cores de cada arquétipo: identidade das cartas do núcleo em metade ou mais das listas
  for (const a of archetypes) a.colors = [...new Set(a.core.filter(x => x.incl >= 0.5).flatMap(x => [...data.cards[x.i].ci]))].join('')
  const ciOf = i => data.cards[i].mt === 'Land' ? '' : data.cards[i].ci
  const pairs = new Map()
  for (const [n, list] of Object.entries(raw.pairs || {})) {
    const i = find(n)
    if (i != null) pairs.set(i, list.map(([m, lift, cond]) => ({ i: find(m), lift, cond })).filter(x => x.i != null))
  }
  return { byCard, archetypes, pairs, decks: raw.decks, since: raw.since, fmtName, ciOf }
}

/** Arquétipo mais parecido com o deck: fração do núcleo (pesada pela inclusão) que já lá está. */
export function detectArchetype(meta, haveIdx) {
  if (!meta || haveIdx.length < 4) return null
  const have = new Set(haveIdx)
  const cols = new Set(haveIdx.flatMap(i => [...(meta.ciOf?.(i) || '')]))
  let best = null
  for (const a of meta.archetypes) {
    if (meta.ciOf && cols.size && ![...(a.colors || '')].every(k => cols.has(k))) continue // cores incompatíveis com o deck
    const tot = a.core.reduce((s, x) => s + x.incl, 0) || 1
    const got = a.core.filter(x => have.has(x.i))
    const fit = got.reduce((s, x) => s + x.incl, 0) / tot
    if (!best || fit > best.fit) best = { ...a, fit, got: got.length }
  }
  return best && best.fit >= 0.45 ? best : null // abaixo disto é coincidência, não o arquétipo
}

export const pctP = p => (p >= 0.995 ? '99%' : p >= 0.1 ? `${Math.round(p * 100)}%` : `${num(p * 100, 1)}%`)

// --- Probabilidade de montar um combo até ao turno T ---
// Hipergeométricas: X = peças vistas (de k), Y = tutores vistos (de t); cada tutor vai buscar uma peça.
// P ≈ Σx P(X=x)·P(Y ≥ k−x). Aproximação (trata X e Y como independentes); o comandante conta como peça garantida.
const lnFact = (() => { const f = [0]; for (let i = 1; i <= 200; i++) f[i] = f[i - 1] + Math.log(i); return n => f[Math.min(200, n)] })()
const lnC = (n, k) => (k < 0 || k > n ? -Infinity : lnFact(n) - lnFact(k) - lnFact(n - k))
const hyper = (N, K, n, x) => Math.exp(lnC(K, x) + lnC(N - K, n - x) - lnC(N, n))
export function comboProb({ pieces, tutors = 0, deckSize, turn }) {
  if (pieces <= 0) return 1
  const n = Math.min(deckSize, 7 + turn)
  let p = 0
  for (let x = 0; x <= pieces; x++) {
    const need = pieces - x
    let py = need === 0 ? 1 : 0
    if (need > 0) for (let y = need; y <= Math.min(tutors, n); y++) py += hyper(deckSize, tutors, n, y)
    p += hyper(deckSize, pieces, n, x) * Math.min(1, py)
  }
  return Math.min(1, p)
}
export const comboTurn = fmt => (fmt?.cmd ? 8 : 6)

// caixa do deck (Biblioteca, Torneio): cores das bordas, capa e cores do deck
export const HUE = { W: '#efe3b8', U: '#3f86d6', B: '#7a6585', R: '#d6503a', G: '#3d9a58' }
// capa: a escolhida, senão o comandante, a 1.ª semente ou a carta não-terreno com mais cópias (e mais cara de mana)
export const coverOf = (d, data) => {
  const n = d.cover || d.commanders?.[0] || d.seeds?.[0] ||
    Object.entries(d.main || {}).map(([n, q]) => [data.byName.get(n), q]).filter(([c]) => c && c.mt !== 'Land').sort((a, b) => b[1] - a[1] || b[0].cmc - a[0].cmc)[0]?.[0]?.n
  return n && data.byName.get(n)
}
export const colorsOf = (d, data) => {
  const set = new Set()
  for (const n of [...(d.commanders || []), ...Object.keys(d.main || {})]) { const c = data.byName.get(n); if (c && c.mt !== 'Land') for (const x of c.ci || '') set.add(x) }
  return 'WUBRG'.split('').filter(x => set.has(x))
}
