// Pesquisa por frases (pt/en) e sintaxe do Scryfall: «encantamento que dê flying e custe no máximo 2», «criatura verde
// com atropelar até 3», «t:enchantment o:flying mv<=2». Devolve os filtros que percebeu (tipo, texto, custo, cores) e o
// que sobra (vai para a pesquisa por nome); null se não percebeu nada (pesquisa normal por nome).

const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const TYPES = { encantamento: 'Enchantment', enchantment: 'Enchantment', criatura: 'Creature', creature: 'Creature', instantaneo: 'Instant',
  instant: 'Instant', feitico: 'Sorcery', sorcery: 'Sorcery', artefacto: 'Artifact', artefato: 'Artifact', artifact: 'Artifact',
  terreno: 'Land', land: 'Land', planeswalker: 'Planeswalker', aura: 'Aura', equipamento: 'Equipment', equipment: 'Equipment',
  lendaria: 'Legendary', lendario: 'Legendary', legendary: 'Legendary', batalha: 'Battle', battle: 'Battle', veiculo: 'Vehicle', vehicle: 'Vehicle' }
const COLORS = { branco: 'W', branca: 'W', white: 'W', azul: 'U', blue: 'U', preto: 'B', preta: 'B', black: 'B', vermelho: 'R', vermelha: 'R',
  red: 'R', verde: 'G', green: 'G' }
// habilidades: nome em português (das cartas impressas em PT) -> texto em inglês a procurar
const KW_PT = { voar: 'flying', voo: 'flying', atropelar: 'trample', 'toque mortifero': 'deathtouch', 'vinculo com a vida': 'lifelink', impeto: 'haste',
  vigilancia: 'vigilance', 'golpe duplo': 'double strike', iniciativa: 'first strike', alcance: 'reach', 'resistencia a magia': 'hexproof',
  indestrutivel: 'indestructible', lampejo: 'flash', ameacar: 'menace', defensor: 'defender', protecao: 'protection', vidência: 'scry', videncia: 'scry',
  triturar: 'mill', reciclar: 'cycling', recapitular: 'flashback', destreza: 'prowess', persistir: 'persist', imortal: 'undying', infectar: 'infect' }
const KW_EN = ['flying', 'trample', 'deathtouch', 'lifelink', 'haste', 'vigilance', 'double strike', 'first strike', 'reach', 'hexproof', 'indestructible',
  'flash', 'menace', 'defender', 'protection', 'ward', 'scry', 'mill', 'cycling', 'flashback', 'kicker', 'prowess', 'convoke', 'cascade', 'delve',
  'shroud', 'persist', 'undying', 'storm', 'infect', 'proliferate', 'outlast', 'shadow', 'landfall', 'ninjutsu', 'toxic', 'treasure', 'food', 'clue']
const STOP = new Set(['que', 'de', 'do', 'da', 'com', 'e', 'um', 'uma', 'a', 'o', 'os', 'as', 'no', 'na', 'em', 'para', 'carta', 'cartas', 'with', 'that',
  'gives', 'give', 'grants', 'grant', 'has', 'have', 'and', 'a', 'an', 'the', 'card', 'cards', 'de', 'forneca', 'forneça', 'de', 'tenha', 'tem', 'tenham',
  'seja', 'sejam', 'mana', 'custo', 'custe', 'custem', 'cost', 'costs', 'or', 'ou', 'mv', 'cmc', 'maximo', 'max', 'ate', 'minimo', 'pelo', 'menos', 'mais',
  'exatamente', 'up', 'to', 'at', 'most', 'least', 'less', 'than', 'qualquer', 'dar', 'mas', 'but', 'which', 'provide', 'provides', 'fornecam', 'deem', 'dao', 'da', 'tambem', 'also'])

export function parseQuery(q) {
  let s = ' ' + strip(q) + ' '
  const f = {}, got = []
  const take = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m }
  // sintaxe do Scryfall
  let m
  while ((m = take(/\s(?:t|type):("[^"]+"|\S+)/))) { const v = m[1].replace(/"/g, ''); f.type = TYPES[v] || v[0].toUpperCase() + v.slice(1) }
  while ((m = take(/\s(?:o|oracle|kw|keyword):("[^"]+"|\S+)/))) (f.oracle ||= []).push(m[1].replace(/"/g, ''))
  while ((m = take(/\s(?:c|color|cor):([wubrg]+)/))) f.colors = [...m[1].toUpperCase()]
  while ((m = take(/\s(?:mv|cmc)\s*(<=|>=|<|>|=|:)\s*(\d+)/))) {
    const n = +m[2]
    if (m[1] === '<=' || m[1] === '<') f.cmcMax = m[1] === '<' ? n - 1 : n
    else if (m[1] === '>=' || m[1] === '>') f.cmcMin = m[1] === '>' ? n + 1 : n
    else { f.cmcMin = n; f.cmcMax = n }
  }
  // custo em frase
  if ((m = take(/\s(?:no maximo|ate|max(?:imo)?|at most|up to|<=)\s*(\d+)/))) f.cmcMax = +m[1]
  if ((m = take(/\s(?:menos (?:de|que)|less than|<)\s*(\d+)/))) f.cmcMax = +m[1] - 1
  if ((m = take(/\s(?:pelo menos|no minimo|minimo|at least|>=)\s*(\d+)/))) f.cmcMin = +m[1]
  if ((m = take(/\s(?:mais (?:de|que)|more than|>)\s*(\d+)/))) f.cmcMin = +m[1] + 1
  if ((m = take(/\s(?:custo|custe|custa|cost|costs|mv|cmc)\s*(?:exatamente\s*|de\s*)?(\d+)(?=\s)/))) { f.cmcMin ??= +m[1]; f.cmcMax ??= +m[1] }
  // habilidades (pt e en, várias palavras primeiro)
  for (const [pt, en] of Object.entries(KW_PT).sort((a, b) => b[0].length - a[0].length)) if (s.includes(` ${pt} `)) { s = s.replace(` ${pt} `, ' '); (f.oracle ||= []).push(en) }
  for (const en of [...KW_EN].sort((a, b) => b.length - a.length)) if (s.includes(` ${en} `)) { s = s.replace(` ${en} `, ' '); (f.oracle ||= []).push(en) }
  // tipos, cores, incolor
  for (const w of s.trim().split(/\s+/)) {
    const base = w.replace(/s$/, '')
    if (TYPES[w] || TYPES[base]) { f.type ||= TYPES[w] || TYPES[base]; s = s.replace(` ${w} `, ' ') }
    else if (COLORS[w] || COLORS[base]) { (f.colors ||= []).push(COLORS[w] || COLORS[base]); s = s.replace(` ${w} `, ' ') }
    else if (w === 'incolor' || w === 'colorless') { f.colorless = true; s = s.replace(` ${w} `, ' ') }
  }
  if (f.colors) f.colors = [...new Set(f.colors)]
  if (!Object.keys(f).length) return null
  const rest = s.trim().split(/\s+/).filter(w => w && !STOP.has(w)).join(' ')
  if (f.type) got.push({ k: 'type', v: f.type })
  for (const o of f.oracle || []) got.push({ k: 'oracle', v: o })
  if (f.cmcMin != null || f.cmcMax != null) got.push({ k: 'mv', v: f.cmcMin === f.cmcMax ? `= ${f.cmcMin}` : f.cmcMin != null && f.cmcMax != null ? `${f.cmcMin}–${f.cmcMax}` : f.cmcMax != null ? `≤ ${f.cmcMax}` : `≥ ${f.cmcMin}` })
  if (f.colors) got.push({ k: 'colors', v: f.colors.join('') })
  if (f.colorless) got.push({ k: 'colors', v: 'C' })
  return { f, rest, got }
}

