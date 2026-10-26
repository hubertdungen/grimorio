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
  batalha: 'Battle', battle: 'Battle', batalla: 'Battle', veiculo: 'Vehicle', vehicle: 'Vehicle', vehiculo: 'Vehicle', fahrzeug: 'Vehicle',
}
const COLORS = {
  branco: 'W', branca: 'W', white: 'W', blanco: 'W', blanca: 'W', weiss: 'W', weisse: 'W',
  azul: 'U', blue: 'U', blau: 'U', blaue: 'U',
  preto: 'B', preta: 'B', black: 'B', negro: 'B', negra: 'B', schwarz: 'B', schwarze: 'B',
  vermelho: 'R', vermelha: 'R', red: 'R', rojo: 'R', roja: 'R', rot: 'R', rote: 'R',
  verde: 'G', green: 'G', grun: 'G', grune: 'G',
  // os básicos dentro de uma frase também são a cor («removal forest» = remoção verde); sozinhos («Forest») ganha o nome
  plains: 'W', planicie: 'W', planicies: 'W', llanura: 'W', llanuras: 'W', ebene: 'W',
  island: 'U', islands: 'U', ilha: 'U', ilhas: 'U', isla: 'U', islas: 'U', insel: 'U',
  swamp: 'B', swamps: 'B', pantano: 'B', pantanos: 'B', sumpf: 'B',
  mountain: 'R', mountains: 'R', montanha: 'R', montanhas: 'R', montana: 'R', montanas: 'R', gebirge: 'R',
  forest: 'G', forests: 'G', floresta: 'G', florestas: 'G', bosque: 'G', bosques: 'G', wald: 'G',
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
  ['神器', { type: 'Artifact' }], ['传奇', { legendary: true }], ['无色', { colorless: true }], ['地', { type: 'Land' }],
  ['白', { color: 'W' }], ['蓝', { color: 'U' }], ['黑', { color: 'B' }], ['红', { color: 'R' }], ['绿', { color: 'G' }],
]

// tipos de criatura nas várias línguas (os em inglês reconhecem-se pelos dados: opts.types)
const SUBS = {
  humano: 'Human', humana: 'Human', mensch: 'Human', menschen: 'Human', menschlich: 'Human', menschliche: 'Human', elfico: 'Elf', elfica: 'Elf', elfo: 'Elf', elf: 'Elf', elfen: 'Elf', dragao: 'Dragon', dragon: 'Dragon', drache: 'Dragon', drachen: 'Dragon',
  anjo: 'Angel', angel: 'Angel', engel: 'Angel', demonio: 'Demon', damon: 'Demon', damonen: 'Demon', zombie: 'Zombie', zumbi: 'Zombie', zombi: 'Zombie',
  vampiro: 'Vampire', vampir: 'Vampire', vampire: 'Vampire', goblin: 'Goblin', kobold: 'Goblin', mago: 'Wizard', feiticeiro: 'Wizard', zauberer: 'Wizard',
  guerreiro: 'Warrior', guerrero: 'Warrior', krieger: 'Warrior', soldado: 'Soldier', soldat: 'Soldier', soldaten: 'Soldier', cavaleiro: 'Knight', caballero: 'Knight', ritter: 'Knight',
  clerigo: 'Cleric', kleriker: 'Cleric', ladino: 'Rogue', picaro: 'Rogue', schurke: 'Rogue', espirito: 'Spirit', espiritu: 'Spirit', geist: 'Spirit', geister: 'Spirit',
  besta: 'Beast', bestia: 'Beast', bestie: 'Beast', gato: 'Cat', katze: 'Cat', rato: 'Rat', ratazana: 'Rat', rata: 'Rat', ratte: 'Rat', ave: 'Bird', passaro: 'Bird', pajaro: 'Bird', vogel: 'Bird',
  fada: 'Faerie', hada: 'Faerie', fee: 'Faerie', tritao: 'Merfolk', triton: 'Merfolk', meervolk: 'Merfolk', esqueleto: 'Skeleton', skelett: 'Skeleton',
  dinossauro: 'Dinosaur', dinosaurio: 'Dinosaur', dinosaurier: 'Dinosaur', pirata: 'Pirate', pirat: 'Pirate', xama: 'Shaman', chaman: 'Shaman', schamane: 'Shaman',
  druida: 'Druid', druide: 'Druid', monge: 'Monk', monje: 'Monk', monch: 'Monk', barbaro: 'Barbarian', barbar: 'Barbarian', assassino: 'Assassin', asesino: 'Assassin', assassine: 'Assassin',
  artifice: 'Artificer', lobisomem: 'Werewolf', werwolf: 'Werewolf', lobo: 'Wolf', wolf: 'Wolf', serpente: 'Serpent', serpiente: 'Serpent', schlange: 'Serpent',
  hidra: 'Hydra', hydra: 'Hydra', gigante: 'Giant', riese: 'Giant', riesen: 'Giant', anao: 'Dwarf', enano: 'Dwarf', zwerg: 'Dwarf', urso: 'Bear', oso: 'Bear', bar: 'Bear',
  aranha: 'Spider', arana: 'Spider', spinne: 'Spider', inseto: 'Insect', insecto: 'Insect', insekt: 'Insect', fungo: 'Fungus', hongo: 'Fungus', pilz: 'Fungus', planta: 'Plant', pflanze: 'Plant',
  cavalo: 'Horse', caballo: 'Horse', pferd: 'Horse', coelho: 'Rabbit', conejo: 'Rabbit', hase: 'Rabbit', rana: 'Frog', sapo: 'Frog', frosch: 'Frog', raposa: 'Fox', zorro: 'Fox', fuchs: 'Fox',
}
const ZH_SUBS = [['人类', 'Human'], ['精灵', 'Elf'], ['天使', 'Angel'], ['恶魔', 'Demon'], ['灵俑', 'Zombie'], ['吸血鬼', 'Vampire'], ['鬼怪', 'Goblin'], ['法师', 'Wizard'],
  ['战士', 'Warrior'], ['士兵', 'Soldier'], ['骑士', 'Knight'], ['僧侣', 'Cleric'], ['浪客', 'Rogue'], ['精怪', 'Spirit'], ['野兽', 'Beast'], ['猫', 'Cat'], ['鼠', 'Rat'], ['龙', 'Dragon']]
// «que beneficiem de X» / «that benefit from X» / «care about X»: cartas cujo texto fala de X (qualquer das palavras)
// marcadores (e não «counter target spell» / «can't be countered»)
const CTR = ['+1/+1 counter', '-1/-1 counter', 'counter on', 'counters on', 'proliferate', 'number of counters', 'with counters', 'counters among']
const CARES = {
  encantamento: ['enchantment', 'aura', 'enchanted'], enchantment: ['enchantment', 'aura', 'enchanted'], encantamiento: ['enchantment', 'aura', 'enchanted'], verzauberung: ['enchantment', 'aura', 'enchanted'],
  aura: ['aura', 'enchanted'], auren: ['aura', 'enchanted'], artefacto: ['artifact'], artefato: ['artifact'], artifact: ['artifact'], artefakt: ['artifact'],
  ficha: ['token'], token: ['token'], spielstein: ['token'], terreno: ['land'], land: ['land'], tierra: ['land'], lander: ['land'],
  feitico: ['instant', 'sorcery', 'noncreature spell'], instantaneo: ['instant', 'sorcery', 'noncreature spell'], spell: ['instant', 'sorcery', 'noncreature spell'], hechizo: ['instant', 'sorcery'], zauber: ['instant', 'sorcery'],
  equipamento: ['equip'], equipment: ['equip'], equipo: ['equip'], ausrustung: ['equip'], marcador: CTR, counter: CTR, contador: CTR, marke: CTR, zahlmarke: CTR,
  cemiterio: ['graveyard'], graveyard: ['graveyard'], cementerio: ['graveyard'], friedhof: ['graveyard'], vida: ['gain life', 'life'], life: ['gain life', 'life'], leben: ['gain life', 'life'],
  criatura: ['creature'], creature: ['creature'], kreatur: ['creature'],
}
const ZH_CARES = [['结界', 'encantamento'], ['神器', 'artefacto'], ['衍生物', 'ficha'], ['坟墓场', 'cemiterio']]
const CARE_RE = /(?:^|\s)(?:que\s+)?(?:se\s+)?(?:beneficiem|beneficiam|beneficie|beneficia|gostem|gostam|goste|gosta|aproveitem|aproveitam|liguem|ligam|sinergia com|com sinergia com|benefit|benefits|that benefit|care|cares|that care|caring|synergy with|synergizes with|like|likes|beneficien|benefician|aprovechen|sinergia con|profitieren|profitiert|synergie mit)\s+(?:de|do|da|dos|das|com|from|about|with|von|mit|del|de los|de las|con)?\s*(\S+)/
const STOP = new Set(('que de do da dos das com e um uma a o os as no na nos nas em para por carta cartas permita permitam permite deixe deixem faca facam fazer faz '
  + 'dar de forneca fornecam tenha tenham tem seja sejam mas tambem qualquer mana custo custe custem custa coste cueste cuesten cuesta kosten kostet '
  + 'with that which who gives give grants grant has have and a an the card cards can let lets allow allows or but also any to of for in on '
  + 'con y la el los las un una permitan hacer den sea sean tenga tengan pero '
  + 'die der das dem des mit und ein eine einen einer fur karten karte oder aber auch '
  + 'mv cmc maximo max ate minimo pelo menos mais exatamente up most least less than hasta como al hochstens maximal mindestens bis').split(/\s+/))
// «lendária» é um filtro à parte (junta-se ao tipo: «criatura lendária»)
const LEGEND = new Set(['lendaria', 'lendario', 'legendary', 'legendaria', 'legendario', 'legendare', 'legendar', 'legendaren', 'legendares'])
const CJK = /[\u3400-\u9fff]/

const subOf = (w, types) => {
  for (const x of [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/en$/, ''), w.replace(/n$/, ''), w.replace(/e$/, '')]) {
    if (SUBS[x]) return SUBS[x]
    const cap = x[0]?.toUpperCase() + x.slice(1)
    if (x.length > 2 && types?.has(cap) && !COLORS[x] && !TYPES[x]) return cap
  }
  return null
}

// ciclos de terrenos pelas alcunhas (en e as usadas cá): tipo Land + pedaços do texto que todos têm (sem o nome da carta)
const LAND_CYCLES = [
  [/\b(?:fetch ?lands?|fetches|terrenos? de busca|tierras? de busqueda|suchlander)\b/, ['pay 1 life, sacrifice', 'search your library']],
  [/\b(?:shock ?lands?|terrenos? de choque|tierras? de choque|schocklander)\b/, ['you may pay 2 life', 'enters tapped']],
  [/\b(?:check ?lands?)\b/, ['enters tapped unless you control a']],
  [/\b(?:fast ?lands?)\b/, ['two or fewer other lands']],
  [/\b(?:slow ?lands?)\b/, ['two or more other lands']],
  [/\b(?:pain ?lands?|terrenos? de dor|tierras? de dolor)\b/, ['deals 1 damage to you']],
  [/\b(?:bounce ?lands?|karoos?)\b/, ['return a land you control to its owner']],
  [/\b(?:gain ?lands?|life ?lands?)\b/, ['enters tapped', 'you gain 1 life']],
  [/\b(?:scry ?lands?)\b/, ['enters tapped', 'scry 1']],
  [/\b(?:surveil ?lands?)\b/, ['surveil 1']],
  [/\b(?:triomes?|tri ?lands?)\b/, ['cycling {3}']],
  [/\b(?:man ?lands?|creature ?lands?|terrenos? criatura)\b/, ['becomes a', 'creature']],
]
export function parseQuery(q, opts = {}) {
  let s = ' ' + strip(q).replace(/[.,;!?¿¡()]/g, ' ').replace(/\b1\s*\+\s*\/\s*1\s*\+/g, '+1/+1').replace(/\+\s*1\s*\/\s*\+\s*1/g, '+1/+1') + ' '
  const f = {}
  const take = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m }
  const add = (k, v) => { if (!(f[k] ||= []).includes(v)) f[k].push(v) }
  let m
  for (const [re, txt] of LAND_CYCLES) if ((m = take(re))) { f.type = 'Land'; for (const t of txt) add('oracle', t) }
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
  // «que beneficiem de X» (pt, en, es, de; zh: 受益于/配合 X)
  for (const [w, k] of ZH_CARES) if (CJK.test(s) && (s.includes(`受益于${w}`) || s.includes(`配合${w}`))) { s = s.replace(`受益于${w}`, ' ').replace(`配合${w}`, ' '); add('cares', k) }
  // alemão: o verbo vem no fim («die von Verzauberungen profitieren»)
  while ((m = s.match(/(?:^|\s)(?:die\s+|der\s+|das\s+)?(?:von|mit)\s+(\S+)\s+(?:profitieren|profitiert|synergieren)/))) {
    const w = m[1], base = [w, w.replace(/en$/, ''), w.replace(/n$/, ''), w.replace(/e$/, ''), w.replace(/s$/, '')].find(x => CARES[x])
    if (!base) break
    s = s.replace(m[0], ' '); add('cares', base)
  }
  while ((m = s.match(CARE_RE))) {
    const w = m[1], base = [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/en$/, ''), w.replace(/n$/, ''), w.replace(/e$/, '')].find(x => CARES[x])
    if (!base) break
    s = s.replace(m[0], ' '); add('cares', base)
  }
  // chinês por bocados
  if (CJK.test(s)) for (const [w, x] of ZH) if (s.includes(w)) {
    s = s.replaceAll(w, ' ')
    if (x.tag) add('tags', x.tag)
    if (x.kw) add('oracle', x.kw)
    if (x.type) { if (!f.type) f.type = x.type; else if (f.type !== x.type && !(f.types2 ||= []).includes(x.type)) f.types2.push(x.type) }
    if (x.color) add('colors', x.color)
    if (x.colorless) f.colorless = true
    if (x.legendary) f.legendary = true
  }
  if (CJK.test(s)) for (const [w, t] of ZH_SUBS) if (s.includes(w)) { s = s.replaceAll(w, ' '); f.sub ||= t }
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
    if (LEGEND.has(w) || LEGEND.has(w.replace(/s$/, '')) || LEGEND.has(w.replace(/n$/, ''))) { f.legendary = true; s = s.replace(` ${w} `, ' ') }
    else if (base && TYPES[base]) { const t = TYPES[base]; if (!f.type) f.type = t; else if (f.type !== t && !(f.types2 ||= []).includes(t)) f.types2.push(t); s = s.replace(` ${w} `, ' ') }  // vários tipos: todos («criatura encantamento»)
    else if (!f.sub && subOf(w, opts.types)) { f.sub = subOf(w, opts.types); s = s.replace(` ${w} `, ' ') }
    else if (base && COLORS[base]) { add('colors', COLORS[base]); s = s.replace(` ${w} `, ' ') }
    else if (['incolor', 'incolores', 'colorless', 'farblos', 'farblose'].includes(w)) { f.colorless = true; s = s.replace(` ${w} `, ' ') }
  }
  if (f.cares) f.anyText = f.cares.map(c => CARES[c])
  if (!Object.keys(f).length) return null
  const rest = s.replace(/[\u3400-\u9fff]+/g, ' ').trim().split(/\s+/).filter(w => w && !STOP.has(w)).join(' ')
  const got = []
  if (f.type) got.push({ k: 'type', v: f.type })
  for (const t of f.types2 || []) got.push({ k: 'type', v: t })
  if (f.legendary) got.push({ k: 'legendary', v: '' })
  if (f.sub) got.push({ k: 'sub', v: f.sub })
  for (const c of f.cares || []) got.push({ k: 'cares', v: CARES[c].join(' / ') })
  for (const t of f.tags || []) got.push({ k: 'tag', v: t })
  for (const o of f.oracle || []) got.push({ k: 'oracle', v: o })
  if (f.cmcMin != null || f.cmcMax != null) got.push({ k: 'mv', v: f.cmcMin === f.cmcMax ? `= ${f.cmcMin}` : f.cmcMin != null && f.cmcMax != null ? `${f.cmcMin}–${f.cmcMax}` : f.cmcMax != null ? `≤ ${f.cmcMax}` : `≥ ${f.cmcMin}` })
  if (f.colors) got.push({ k: 'colors', v: f.colors.join('') })
  if (f.colorless) got.push({ k: 'colors', v: 'C' })
  return { f, rest, got }
}
