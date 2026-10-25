// Pesquisa por frases em qualquer das línguas da app (pt, en, es, de, zh) e sintaxe do Scryfall:
// «encantamento que dê flying e custe no máximo 2», «Lands que permitam fazer draw», «terreno comprar cartas»,
// «criatura verde com atropelar até 3», «t:enchantment o:flying mv<=2», «抽牌的地». Devolve os filtros que percebeu
// (tipo, funções, texto, custo, cores) e o que sobra (vai para o nome); null se não percebeu nada.

const strip = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const TYPES = {
  encantamento: 'Enchantment', enchantment: 'Enchantment', encantamiento: 'Enchantment', verzauberung: 'Enchantment',
  criatura: 'Creature', creature: 'Creature', kreatur: 'Creature',
  instantaneo: 'Instant', instant: 'Instant', spontanzauber: 'Instant',
  feitico: 'Sorcery', sorcery: 'Sorcery', conjuro: 'Sorcery', hexerei: 'Sorcery',
  artefacto: 'Artifact', artefato: 'Artifact', artifact: 'Artifact', artefakt: 'Artifact',
  terreno: 'Land', land: 'Land', tierra: 'Land', lander: 'Land',
  planeswalker: 'Planeswalker', aura: 'Aura', equipamento: 'Equipment', equipment: 'Equipment', equipo: 'Equipment', ausrustung: 'Equipment',
  lendaria: 'Legendary', lendario: 'Legendary', legendary: 'Legendary', legendaria: 'Legendary', legendare: 'Legendary',
  batalha: 'Battle', battle: 'Battle', batalla: 'Battle', veiculo: 'Vehicle', vehicle: 'Vehicle', vehiculo: 'Vehicle', fahrzeug: 'Vehicle',
}
const COLORS = {
  branco: 'W', branca: 'W', white: 'W', blanco: 'W', blanca: 'W', weiss: 'W', weisse: 'W',
  azul: 'U', blue: 'U', blau: 'U', blaue: 'U',
  preto: 'B', preta: 'B', black: 'B', negro: 'B', negra: 'B', schwarz: 'B', schwarze: 'B',
  vermelho: 'R', vermelha: 'R', red: 'R', rojo: 'R', roja: 'R', rot: 'R', rote: 'R',
  verde: 'G', green: 'G', grun: 'G', grune: 'G',
}
// habilidades com nome (o texto em inglês a procurar), nas várias línguas
const KW = {
  flying: ['flying', 'voar', 'voo', 'volar', 'vuela', 'fliegend', 'flugfahigkeit'], trample: ['trample', 'atropelar', 'arrollar', 'trampelschaden'],
  deathtouch: ['deathtouch', 'toque mortifero', 'toque mortal', 'todesberuhrung'], lifelink: ['lifelink', 'vinculo com a vida', 'vinculo vital', 'lebensverknupfung'],
  haste: ['haste', 'impeto', 'prisa', 'eile'], vigilance: ['vigilance', 'vigilancia', 'wachsamkeit'],
  'double strike': ['double strike', 'golpe duplo', 'doble golpe', 'doppelschlag'], 'first strike': ['first strike', 'iniciativa', 'danar primero', 'erstschlag'],
  reach: ['reach', 'alcance', 'reichweite'], hexproof: ['hexproof', 'resistencia a magia', 'antimaleficio', 'fluchsicher'],
  indestructible: ['indestructible', 'indestrutivel', 'unzerstorbar'], flash: ['flash', 'lampejo', 'destello', 'aufblitzen'],
  menace: ['menace', 'ameacar', 'amenaza', 'bedrohlich'], defender: ['defender', 'defensor', 'verteidiger'], protection: ['protection', 'protecao', 'proteccion'],
  ward: ['ward'], cycling: ['cycling', 'reciclar', 'umwandlung'], flashback: ['flashback', 'recapitular', 'retrospectiva', 'ruckblende'],
  kicker: ['kicker', 'estimulo'], prowess: ['prowess', 'destreza', 'tapferkeit'], convoke: ['convoke', 'convocar', 'einberufen'],
  cascade: ['cascade', 'cascata', 'cascada', 'kaskade'], delve: ['delve', 'escavar', 'excavar'], persist: ['persist', 'persistir', 'beharrlichkeit'],
  undying: ['undying', 'imortal', 'inmortal', 'unsterblichkeit'], infect: ['infect', 'infectar', 'infizieren'], storm: ['storm', 'tempestade', 'tormenta'],
  proliferate: ['proliferate', 'proliferar', 'proliferieren'], outlast: ['outlast'], shadow: ['shadow', 'sombra'], ninjutsu: ['ninjutsu'], toxic: ['toxic', 'toxico'],
  treasure: ['treasure', 'tesouro', 'tesoro', 'schatz'], food: ['food', 'comida', 'nahrung'], clue: ['clue', 'pista', 'hinweis'],
}
// funções (as do filtro de funções: data.js TAG_LABEL) pelas palavras que se usam para elas
const CONCEPTS = {
  counters: ['+1/+1 counters', '+1/+1', 'marcadores', 'marcador', 'contadores'],
  draw: ['card draw', 'draw cards', 'draw', 'comprar cartas', 'comprar carta', 'compra de cartas', 'comprar', 'compra', 'compram', 'compre', 'robar cartas', 'roban cartas', 'robar', 'roban', 'roba', 'karten ziehen', 'ziehen', 'zieht', 'ziehe'],
  ramp: ['ramp', 'acelerar mana', 'aceleracao de mana', 'mana extra', 'aceleracion de mana', 'rampa', 'beschleunigung'],
  removal: ['removal', 'remocao', 'remover', 'remove', 'destruir', 'destroy', 'matar', 'kill', 'eliminar', 'entfernen', 'zerstoren'],
  wipe: ['board wipe', 'wipe', 'limpar a mesa', 'limpeza', 'arrasar', 'barrida', 'massenvernichtung'],
  counter: ['counterspell', 'contra-feitico', 'contrafeitico', 'contrarrestar', 'anular', 'neutralizar', 'konter', 'counter'],
  tokens: ['tokens', 'token', 'fichas', 'ficha', 'spielsteine', 'spielstein'],
  lifegain: ['lifegain', 'gain life', 'ganhar vida', 'ganho de vida', 'ganar vida', 'leben gewinnen', 'lebensgewinn'],
  tutor: ['tutor', 'procurar no grimorio', 'buscar en tu biblioteca', 'bibliothek durchsuchen'],
  recursion: ['recursion', 'recursao', 'devolver do cemiterio', 'volver del cementerio'],
  reanimate: ['reanimate', 'reanimar', 'reanimacao', 'reanimacion', 'reanimieren'],
  sacrifice: ['sacrifice', 'sacrificio', 'sacrificar', 'opfern'], discard: ['discard', 'descarte', 'descartar', 'abwerfen'],
  graveyard: ['graveyard', 'cemiterio', 'cementerio', 'friedhof'], mill: ['mill', 'moer', 'moler', 'mahlen', 'triturar'],
  burn: ['direct damage', 'burn', 'dano direto', 'dano directo', 'direktschaden'], pump: ['anthem', 'pump', 'buff', 'reforco', 'potenciar', 'verstarkung'],
  blink: ['blink', 'flicker', 'piscar', 'parpadeo'], bounce: ['bounce', 'devolver a mao', 'devolver a la mano', 'auf die hand'],
  copy: ['copy', 'copiar', 'kopieren'], steal: ['steal', 'gain control', 'roubar', 'ganhar controlo', 'ganhar controle', 'robar el control', 'kontrolle'],
  drain: ['drain', 'drenar', 'perder vida', 'lose life', 'entziehen'], selection: ['scry', 'surveil', 'videncia', 'adivinar', 'hellsicht', 'uberwachen'],
  cost: ['cost reduction', 'reduzir custos', 'reducir coste', 'kostensenkung'], untap: ['untap', 'desvirar', 'enderezar', 'enttappen'],
  extraturn: ['extra turn', 'turno extra', 'turno adicional', 'zusatzlicher zug'], landfall: ['landfall'], stax: ['stax', 'taxar', 'travar'],
  evasion: ['evasion', 'evasao', 'unblockable', 'imbloqueavel', 'imbloqueable'], wincon: ['win condition', 'wincon', 'condicao de vitoria', 'condicion de victoria', 'siegbedingung'],
  etb: ['etb', 'enters the battlefield', 'entra no campo', 'entra en el campo'],
}
// chinês: sem espaços, procura-se por bocados (os mais compridos primeiro: «地落» antes de «地»)
const ZH = [
  ['地落', { tag: 'landfall' }], ['抽牌', { tag: 'draw' }], ['抓牌', { tag: 'draw' }], ['抽卡', { tag: 'draw' }], ['加速', { tag: 'ramp' }], ['移除', { tag: 'removal' }],
  ['消灭', { tag: 'removal' }], ['清场', { tag: 'wipe' }], ['反击', { tag: 'counter' }], ['反制', { tag: 'counter' }], ['衍生物', { tag: 'tokens' }],
  ['获得生命', { tag: 'lifegain' }], ['搜寻', { tag: 'tutor' }], ['复活', { tag: 'reanimate' }], ['牺牲', { tag: 'sacrifice' }], ['弃牌', { tag: 'discard' }],
  ['坟墓场', { tag: 'graveyard' }], ['磨牌', { tag: 'mill' }], ['直伤', { tag: 'burn' }], ['闪烁', { tag: 'blink' }], ['弹回', { tag: 'bounce' }],
  ['复制', { tag: 'copy' }], ['夺取', { tag: 'steal' }], ['占卜', { tag: 'selection' }], ['额外回合', { tag: 'extraturn' }], ['指示物', { tag: 'counters' }],
  ['飞行', { kw: 'flying' }], ['践踏', { kw: 'trample' }], ['死触', { kw: 'deathtouch' }], ['系命', { kw: 'lifelink' }], ['敏捷', { kw: 'haste' }],
  ['警戒', { kw: 'vigilance' }], ['连击', { kw: 'double strike' }], ['先攻', { kw: 'first strike' }], ['延势', { kw: 'reach' }], ['辟邪', { kw: 'hexproof' }],
  ['不灭', { kw: 'indestructible' }], ['闪现', { kw: 'flash' }], ['威慑', { kw: 'menace' }],
  ['鹏洛客', { type: 'Planeswalker' }], ['生物', { type: 'Creature' }], ['结界', { type: 'Enchantment' }], ['法术', { type: 'Sorcery' }], ['瞬间', { type: 'Instant' }],
  ['神器', { type: 'Artifact' }], ['传奇', { type: 'Legendary' }], ['无色', { colorless: true }], ['地', { type: 'Land' }],
  ['白', { color: 'W' }], ['蓝', { color: 'U' }], ['黑', { color: 'B' }], ['红', { color: 'R' }], ['绿', { color: 'G' }],
]
const STOP = new Set(('que de do da dos das com e um uma a o os as no na nos nas em para por carta cartas permita permitam permite deixe deixem faca facam fazer faz '
  + 'dar de forneca fornecam tenha tenham tem seja sejam mas tambem qualquer mana custo custe custem custa coste cueste cuesten cuesta kosten kostet '
  + 'with that which who gives give grants grant has have and a an the card cards can let lets allow allows or but also any to of for in on '
  + 'con y la el los las un una permitan hacer den sea sean tenga tengan pero '
  + 'die der das dem des mit und ein eine einen einer fur karten karte oder aber auch '
  + 'mv cmc maximo max ate minimo pelo menos mais exatamente up most least less than hasta como al hochstens maximal mindestens bis').split(/\s+/))
const CJK = /[\u3400-\u9fff]/

export function parseQuery(q) {
  let s = ' ' + strip(q).replace(/[.,;!?¿¡()]/g, ' ') + ' '
  const f = {}
  const take = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m }
  const add = (k, v) => { if (!(f[k] ||= []).includes(v)) f[k].push(v) }
  let m
  // sintaxe do Scryfall
  while ((m = take(/\s(?:t|type):("[^"]+"|\S+)/))) { const v = m[1].replace(/"/g, ''); f.type = TYPES[v] || v[0].toUpperCase() + v.slice(1) }
  while ((m = take(/\s(?:o|oracle|kw|keyword):("[^"]+"|\S+)/))) add('oracle', m[1].replace(/"/g, ''))
  while ((m = take(/\s(?:c|color|cor):([wubrg]+)/))) f.colors = [...m[1].toUpperCase()]
  while ((m = take(/\s(?:mv|cmc)\s*(<=|>=|<|>|=|:)\s*(\d+)/))) {
    const n = +m[2]
    if (m[1] === '<=' || m[1] === '<') f.cmcMax = m[1] === '<' ? n - 1 : n
    else if (m[1] === '>=' || m[1] === '>') f.cmcMin = m[1] === '>' ? n + 1 : n
    else { f.cmcMin = n; f.cmcMax = n }
  }
  // custo em frase (pt, en, es, de, zh)
  if ((m = take(/(?:\s|^|(?=[最不至]))(?:no maximo|como maximo|hochstens|maximal|ate|hasta|bis|max(?:imo)?|at most|up to|<=|最多|不超过|至多)\s*(\d+)/))) f.cmcMax = +m[1]
  if ((m = take(/\s(?:menos (?:de|que)|less than|weniger als|<)\s*(\d+)/))) f.cmcMax = +m[1] - 1
  if ((m = take(/(?:\s|(?=[至不]))(?:pelo menos|no minimo|como minimo|al menos|mindestens|minimo|at least|>=|至少|不少于)\s*(\d+)/))) f.cmcMin = +m[1]
  if ((m = take(/\s(?:mais (?:de|que)|more than|mas de|mehr als|>)\s*(\d+)/))) f.cmcMin = +m[1] + 1
  if ((m = take(/(?:\s|(?=费))(?:custo|custe|custa|cost|costs|coste|cueste|kosten|kostet|mv|cmc|费用)\s*(?:exatamente\s*|de\s*|von\s*)?(\d+)(?=\s|$|[\u3400-\u9fff])/))) { f.cmcMin ??= +m[1]; f.cmcMax ??= +m[1] }
  // chinês por bocados
  if (CJK.test(s)) for (const [w, x] of ZH) if (s.includes(w)) {
    s = s.replaceAll(w, ' ')
    if (x.tag) add('tags', x.tag)
    if (x.kw) add('oracle', x.kw)
    if (x.type) f.type ||= x.type
    if (x.color) add('colors', x.color)
    if (x.colorless) f.colorless = true
  }
  // funções e habilidades por frases (as compridas primeiro, para «robar el control» não ser «robar»)
  const phrases = [...Object.entries(CONCEPTS).flatMap(([t, ws]) => ws.map(w => [w, 'tags', t])), ...Object.entries(KW).flatMap(([k, ws]) => ws.map(w => [w, 'oracle', k]))]
    .sort((a, b) => b[0].length - a[0].length)
  for (const [w, k, v] of phrases) {
    const re = new RegExp(`(^|\\s)${w.replace(/[+/]/g, c => `\\${c}`)}s?(?=\\s|$)`)
    if (re.test(s)) { s = s.replace(re, ' '); add(k, v) }
  }
  // tipos, cores, incolor (singular e plural: «lands», «criaturas», «tierras», «Kreaturen»)
  for (const w of s.trim().split(/\s+/)) {
    const base = [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/en$/, ''), w.replace(/n$/, '')].find(x => TYPES[x] || COLORS[x])
    if (base && TYPES[base]) { f.type ||= TYPES[base]; s = s.replace(` ${w} `, ' ') }
    else if (base && COLORS[base]) { add('colors', COLORS[base]); s = s.replace(` ${w} `, ' ') }
    else if (['incolor', 'incolores', 'colorless', 'farblos', 'farblose'].includes(w)) { f.colorless = true; s = s.replace(` ${w} `, ' ') }
  }
  if (!Object.keys(f).length) return null
  const rest = s.replace(/[\u3400-\u9fff]+/g, ' ').trim().split(/\s+/).filter(w => w && !STOP.has(w)).join(' ')
  const got = []
  if (f.type) got.push({ k: 'type', v: f.type })
  for (const t of f.tags || []) got.push({ k: 'tag', v: t })
  for (const o of f.oracle || []) got.push({ k: 'oracle', v: o })
  if (f.cmcMin != null || f.cmcMax != null) got.push({ k: 'mv', v: f.cmcMin === f.cmcMax ? `= ${f.cmcMin}` : f.cmcMin != null && f.cmcMax != null ? `${f.cmcMin}–${f.cmcMax}` : f.cmcMax != null ? `≤ ${f.cmcMax}` : `≥ ${f.cmcMin}` })
  if (f.colors) got.push({ k: 'colors', v: f.colors.join('') })
  if (f.colorless) got.push({ k: 'colors', v: 'C' })
  return { f, rest, got }
}
