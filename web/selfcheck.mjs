// Verificação rápida das regras e das listas: `node web/selfcheck.mjs`
import assert from 'node:assert/strict'
import { FORMAT, validate, maxCopies, landAdvice } from './src/formats.js'
import { parseList, exportList, emptyDeck, sourceOf } from './src/deck.js'
import { landInfo, basicsFor } from './src/mana.js'

const F = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander']
const bits = (...fs) => fs.reduce((s, f) => s | (1 << F.indexOf(f)), 0)
const C = [
  { n: 'Atraxa, Praetors\' Voice', t: 'Legendary Creature — Phyrexian Angel Horror', o: 'Flying', ci: 'WUBG', lg: bits('legacy', 'vintage', 'commander'), rs: 0, r: 'm' },
  { n: 'Sol Ring', t: 'Artifact', o: '{T}: Add {C}{C}.', ci: '', lg: bits('vintage', 'commander'), rs: bits('vintage'), r: 'u' },
  { n: 'Lightning Bolt', t: 'Instant', o: 'Lightning Bolt deals 3 damage to any target.', ci: 'R', lg: bits('modern', 'legacy', 'vintage', 'pauper', 'commander'), rs: 0, r: 'c' },
  { n: 'Forest', t: 'Basic Land — Forest', o: '({T}: Add {G}.)', ci: 'G', lg: bits(...F), rs: 0, r: 'c' },
  { n: 'Relentless Rats', t: 'Creature — Rat', o: 'A deck can have any number of cards named Relentless Rats.', ci: 'B', lg: bits(...F), rs: 0, r: 'u' },
  { n: 'Fire // Ice', t: 'Instant // Instant', o: '...', ci: 'UR', lg: bits('modern', 'legacy', 'vintage', 'commander'), rs: 0, r: 'u' },
]
const byName = new Map(C.map(c => [c.n, c]))
const byLower = new Map()
for (const c of C) { byLower.set(c.n.toLowerCase(), c); for (const p of c.n.split(' // ')) byLower.set(p.toLowerCase(), c) }
const data = { meta: { formats: F }, byName, byLower }

// Cópias: básicos e "any number" sem limite; restrita = 1 no Vintage.
assert.equal(maxCopies(byName.get('Forest'), FORMAT.modern, 2), Infinity)
assert.equal(maxCopies(byName.get('Relentless Rats'), FORMAT.commander, 6), Infinity)
assert.equal(maxCopies(byName.get('Sol Ring'), FORMAT.vintage, 4), 1)
assert.equal(maxCopies(byName.get('Lightning Bolt'), FORMAT.modern, 2), 4)

// Commander: identidade de cor, tamanho e singleton.
const d = { ...emptyDeck('commander'), commanders: ['Atraxa, Praetors\' Voice'], main: { 'Sol Ring': 2, 'Lightning Bolt': 1, Forest: 96 } }
const msgs = validate(d, FORMAT.commander, data).map(i => i.msg).join('\n')
assert.match(msgs, /Sol Ring: 2 cópias/)
assert.match(msgs, /Lightning Bolt está fora da identidade/)
assert.doesNotMatch(msgs, /Faltam|Sobram/) // 1 + 2 + 1 + 96 = 100
assert.match(validate({ ...d, main: { Forest: 10 } }, FORMAT.commander, data)[0].msg, /Faltam 89/)

// Legalidade no formato.
assert.match(validate({ ...emptyDeck('modern'), main: { 'Sol Ring': 1, Forest: 59 } }, FORMAT.modern, data).map(i => i.msg).join(), /Sol Ring não é legal/)

// Listas: cabeçalhos, "1x", edição, foil, SB:, cartas desconhecidas, nome de uma face.
const txt = `Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1x Sol Ring (CMR) 263 *F*\n4 Lightning Bolt\nFire\n2 Carta Inventada\nSB: 3 Forest`
const p = parseList(txt, data)
assert.deepEqual(p.commanders, ['Atraxa, Praetors\' Voice'])
assert.deepEqual(p.main, { 'Sol Ring': 1, 'Lightning Bolt': 4, 'Fire // Ice': 1 })
assert.deepEqual(p.side, { Forest: 3 })
assert.deepEqual(p.unknown, ['Carta Inventada'])
assert.deepEqual(p.printRefs, [{ name: 'Sol Ring', set: 'CMR', cn: '263', foil: true }])

// Exportar com o estilo escolhido volta a ler igual.
const out = exportList({ ...emptyDeck(), commanders: p.commanders, main: p.main, side: p.side, prints: { 'Sol Ring': { set: 'CMR', cn: '263', foil: true } } })
assert.match(out, /1 Sol Ring \(CMR\) 263 \*F\*/)
const back = parseList(out, data)
assert.deepEqual(back.main, p.main)
assert.deepEqual(back.printRefs, p.printRefs)
// Maybeboard (Moxfield/Archidekt/TappedOut pelo link): secção própria, fora do deck; tokens continuam ignorados.
const mb = parseList('Deck\n4 Lightning Bolt\n\nMaybeboard\n1 Sol Ring (CMR) 263\nConsidering\n2 Forest\nTokens\n1 Fire // Ice', data)
assert.deepEqual(mb.main, { 'Lightning Bolt': 4 })
assert.deepEqual(mb.maybe, { 'Sol Ring': 1, Forest: 2 })
// link de origem: campo source ou as notas dos decks importados antes
assert.equal(sourceOf({ notes: 'Importado de tappedout: https://tappedout.net/mtg-decks/x/\nnotas' }), 'https://tappedout.net/mtg-decks/x/')
assert.equal(sourceOf({ source: 'https://archidekt.com/decks/1', notes: '' }), 'https://archidekt.com/decks/1')
assert.equal(sourceOf({ notes: 'sem link' }), '')

// Terrenos (Karsten, limitado a 33–40 no Commander): custo médio 3 sem ramp barato daria 41 → 40; com 15 de ramp/compra baratos ~37.
assert.equal(landAdvice(FORMAT.commander, 3, 0), 40)
assert.equal(landAdvice(FORMAT.commander, 3, 15), 37)
assert.equal(landAdvice(FORMAT.modern, 2, 4), 22)
// Terrenos: cores, virado/condicional, fetch.
const L = (n, t, o) => landInfo({ n, t, o })
const pool = L('Breeding Pool', 'Land — Forest Island', "({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life. If you don't, it enters tapped.")
assert.deepEqual([...pool.colors].sort(), ['G', 'U'])
assert.equal(pool.tapped, 'às vezes')
const gate = L('Simic Guildgate', 'Land — Gate', 'Simic Guildgate enters tapped.\n{T}: Add {G} or {U}.')
assert.equal(gate.tapped, 'sim')
const wilds = L('Evolving Wilds', 'Land', '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.')
assert.ok(wilds.fetch && wilds.colors.has('*'))
assert.equal(wilds.tapped, 'sim')  // o terreno que vai buscar entra virado
assert.equal(L('Fabled Passage', 'Land', '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.').tapped, 'às vezes')
// «unless» noutra frase não torna condicional (Gateway Plaza entra sempre virada); Demolition Field não é fetch
assert.equal(L('Gateway Plaza', 'Land', 'This land enters tapped.\nWhen this land enters, sacrifice it unless you pay {1}.\n{T}: Add one mana of any color.').tapped, 'sim')
assert.ok(!L('Demolition Field', 'Land', "{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Destroy target nonbasic land an opponent controls. That land's controller may search their library for a basic land card, put it onto the battlefield, then shuffle. You may search your library for a basic land card, put it onto the battlefield, then shuffle.").fetch)
assert.ok(L('Mishra\'s Factory', 'Land', '{1}: Mishra\'s Factory becomes a 2/2 Assembly-Worker artifact creature until end of turn.').util.includes('vira criatura (manland)'))
// Sideboard por tipo de ameaça: só respostas a sério
{ const { SIDE_CATS: S } = await import('./src/data.js'), hit = (k, o) => S[k][1].test(o.toLowerCase())
  assert.ok(hit(0, 'When Rest in Peace enters, exile all graveyards.') && !hit(0, '{W}: Exile target card from a graveyard.'))
  assert.ok(hit(3, 'Each creature gets -X/-X until end of turn.') && !hit(3, 'You gain 5 life and shuffle your graveyard into your library.') && !hit(3, 'Creatures your opponents control get -2/-0 until end of turn.'))
  assert.ok(hit(4, 'Destroy target creature with flying.') && hit(4, 'Reach, trample') && !hit(4, 'This spell costs {1} less to cast if you control a creature with flying.'))
  assert.ok(!hit(5, 'Permanents your opponents control lose hexproof and indestructible.'))
  const { HATE } = await import('./src/tests.js'), fly = HATE.find(x => x[0] === 'flyers')[1]
  assert.ok(fly.test('Destroy target creature with flying.') && !fly.test("Signal Pest can't be blocked except by creatures with flying or reach.")) }
// Básicos vão para a cor com menos fontes face ao alvo.
const b = basicsFor(null, { cols: { G: { have: 10, full: 20 }, U: { have: 2, full: 16 } } }, 6, 'GU')
assert.ok(b.Island >= 5, JSON.stringify(b))
console.log('selfcheck ok')
// Combos: 2 peças num deck de 99 até ao turno 8 (15 cartas vistas) ≈ 2%; com 5 tutores sobe bastante; comandante já é peça.
import { comboProb } from './src/data.js'
const p2 = comboProb({ pieces: 2, deckSize: 99, turn: 8 })
assert.ok(p2 > 0.015 && p2 < 0.03, String(p2))
assert.ok(comboProb({ pieces: 2, tutors: 5, deckSize: 99, turn: 8 }) > p2 * 3)
assert.equal(comboProb({ pieces: 0, deckSize: 99, turn: 8 }), 1)
console.log('selfcheck combos ok')
// Formato detetado pelas cartas
import { inferFormat } from './src/formats.js'
assert.equal(inferFormat(data, { commanders: ["Atraxa, Praetors' Voice"], main: { Forest: 99 } }), 'commander')
assert.equal(inferFormat(data, { commanders: [], main: { 'Lightning Bolt': 4, Forest: 56 } }), 'pauper')
assert.equal(inferFormat(data, { commanders: [], main: { 'Sol Ring': 1, Forest: 59 } }), 'vintage')
console.log('selfcheck formato ok')
// Modelo do tabuleiro (game.js) com eventos tirados de registos reais do Forge (sim.py, parse_game)
import { replayStates, powTough } from './src/game.js'
{
  const G = [
    { n: 'Krenko, Mob Boss', t: 'Legendary Creature — Goblin Warrior', o: '{T}: Create X 1/1 red Goblin creature tokens.', pt: '3/3', kw: [] },
    { n: 'Mountain', t: 'Basic Land — Mountain', o: '({T}: Add {R}.)', pt: '', kw: [] },
    { n: 'Steam Vents', t: 'Land — Island Mountain', o: '({T}: Add {U} or {R}.)', pt: '', kw: [] },
    { n: 'Goblin Guide', t: 'Creature — Goblin Scout', o: 'Haste', pt: '2/2', kw: ['Haste'] },
    { n: 'Leatherback Baloth', t: 'Creature — Beast', o: '', pt: '4/5', kw: [] },
    { n: 'Arcbound Ravager', t: 'Artifact Creature — Beast', o: 'Modular 1', pt: '0/0', kw: ['Modular'] },
    { n: 'Delver of Secrets // Insectile Aberration', t: 'Creature — Human Wizard // Creature — Human Insect', o: '…\n//\nFlying', pt: '', kw: ['Flying'], df: 1 },
  ]
  const gm = { byName: new Map(G.map(c => [c.n, c])), byLower: new Map() }
  for (const c of G) for (const p of [c.n, ...c.n.split(' // ')]) gm.byLower.set(p.toLowerCase(), c)
  const E = [
    { t: 0, k: 'mulligan', p: 'a', n: 7, card: 'kept' },
    { t: 1, k: 'turn', p: 'a', reveal: { a: ['Mountain', 'Goblin Guide'] } },
    { t: 1, k: 'land', p: 'a', card: 'Mountain', id: 26 },
    { t: 1, k: 'tap', p: 'a', card: 'Mountain', id: 26 },
    { t: 1, k: 'cast', p: 'a', card: 'Goblin Guide' },
    { t: 1, k: 'resolve', p: 'a', card: 'Goblin Guide', pt: '2/2' },
    { t: 1, k: 'cast', p: 'a', card: 'Krenko, Mob Boss' },
    { t: 1, k: 'resolve', p: 'a', card: 'Krenko, Mob Boss', pt: '3/3' },
    { t: 1, k: 'phase', p: 'a', ph: 'combat' },
    { t: 1, k: 'attack', p: 'a', card: 'Goblin Guide', id: 10, target: 'b' },
    { t: 2, k: 'turn', p: 'b' },
    { t: 2, k: 'search', p: 'b', to: 'battlefield' },
    { t: 2, k: 'tap', p: 'b', card: 'Steam Vents', id: 114 },
    { t: 2, k: 'cast', p: 'b', card: 'Arcbound Ravager' },
    { t: 2, k: 'resolve', p: 'b', card: 'Arcbound Ravager', pt: '0/0' },
    { t: 2, k: 'token', p: 'b', card: 'Vampire Token', n: 2, pt: '1/1', kw: ['Lifelink'] },
    { t: 2, k: 'attack', p: 'b', card: 'Vampire Token', id: 206, target: 'a' },
    { t: 2, k: 'block', p: 'a', card: 'Goblin Guide', id: 10, target: 'Vampire Token', tid: 206 },
    { t: 2, k: 'damage', p: 'a', card: 'Goblin Guide', id: 10, n: 2, target: 'Vampire Token', tid: 206, combat: 1, gone: 1 },
    { t: 2, k: 'damage', p: 'b', card: 'Vampire Token', id: 206, n: 1, target: 'Goblin Guide', tid: 10, combat: 1 },
    { t: 2, k: 'life', p: 'b', n: 18 },
    { t: 2, k: 'counters', p: 'b', card: 'Arcbound Ravager', ct: '+1/+1', n: 2 },
    { t: 2, k: 'transform', card: 'Delver of Secrets // Insectile Aberration', id: 79, to: 'Insectile Aberration' },
    { t: 2, k: 'exile', p: 'a', card: 'Krenko, Mob Boss', id: 100, target: 'battlefield>exile' },
    { t: 3, k: 'turn', p: 'a' },
  ]
  const st = replayStates(E, gm, 20, { a: { commanders: ['Krenko, Mob Boss'], size: 99 }, b: { commanders: [], size: 60 } })
  const at = (n, side) => st[n][side]
  // terreno jogado, virado para mana; a mão conhecida perde as cartas jogadas; o comandante sai da zona de comando
  assert.equal(at(4, 'a').perms[0].tapped, true)
  assert.deepEqual(at(8, 'a').known, [])
  assert.equal(at(8, 'a').command[0].casts, 1)
  assert.equal(at(8, 'a').library, 92)
  // ataque vira a criatura (com ímpeto: sem enjoo); a do Krenko entra enjoada
  const gg = at(10, 'a').perms.find(p => p.name === 'Goblin Guide')
  assert.ok(gg.tapped && gg.attacking === 'b' && !gg.sick && gg.fid === 10)
  assert.equal(at(10, 'a').perms.find(p => p.name === 'Krenko, Mob Boss').sick, true)
  // turno do outro: desvira só os dele e compra (≈); terreno procurado é adotado quando dá mana
  assert.equal(at(11, 'a').perms[0].tapped, true)
  assert.equal(at(11, 'b').hand, 8)
  const vents = at(13, 'b').perms.find(p => p.fid === 114)
  assert.ok(vents && vents.name === 'Steam Vents' && vents.tapped && !vents.hidden)
  // Modular 1 lido do texto da carta; fichas com P/R; bloqueio; dano letal a uma ficha que o Forge nunca mais mostra
  assert.equal(at(15, 'b').perms.find(p => p.name === 'Arcbound Ravager').counters['+1/+1'], 1)
  assert.equal(at(16, 'b').perms.filter(p => p.token).length, 2)
  assert.ok(at(18, 'a').perms.find(p => p.fid === 10).blocking)
  assert.ok(at(19, 'b').perms.find(p => p.fid === 206).dying)
  assert.equal(at(20, 'b').perms.filter(p => p.token).length, 1)
  assert.equal(at(20, 'a').perms.find(p => p.fid === 10).damage, 1)
  assert.equal(st[21].fx.life.d, -2)
  const rav = at(22, 'b').perms.find(p => p.name === 'Arcbound Ravager')
  assert.deepEqual(powTough(gm, rav), { p: 3, t: 3, boosted: true, hurt: false })
  assert.equal(at(23, 'a').perms.find(p => p.fid === 79).flipped, true)
  // o comandante exilado volta à zona de comando; no turno seguinte limpa-se o dano e desvira
  assert.equal(at(24, 'a').command[0].out, false)
  assert.equal(at(24, 'a').exile.length, 0)
  const end = at(25, 'a').perms.find(p => p.fid === 10)
  assert.ok(!end.tapped && !end.damage && !end.blocking)
  console.log('selfcheck tabuleiro ok')
}
// Jogo exato (lançador GrimorioSim): eventos que o sim.py tira das linhas reais do seu selfcheck
{
  const G = [
    { n: 'Forest', t: 'Basic Land — Forest', o: '', pt: '', kw: [] },
    { n: 'Llanowar Elves', t: 'Creature — Elf Druid', o: '{T}: Add {G}.', pt: '1/1', kw: [] },
    { n: 'Walking Ballista', t: 'Artifact Creature — Construct', o: 'Walking Ballista enters with X +1/+1 counters on it.', pt: '0/0', kw: [] },
  ]
  const gm = { byName: new Map(G.map(c => [c.n, c])), byLower: new Map(G.map(c => [c.n.toLowerCase(), c])) }
  const E = [
    {"t": 0, "k": "mulligan", "p": "b", "n": 7, "card": "kept", "hd": {"a": ["Goblin Guide"], "b": ["Llanowar Elves"]}},
    {"t": 0, "k": "mulligan", "p": "a", "n": 7, "card": "kept"},
    {"t": 1, "k": "turn", "p": "b", "hd": {"a": ["Goblin Guide", "Mountain", "Rift Bolt"], "b": ["Llanowar Elves", "Forest", "Elvish Mystic"]}, "lib": {"a": 53, "b": 53}},
    {"t": 1, "k": "land", "p": "b", "card": "Forest", "id": 108, "zn": [{"id": 108, "card": "Forest", "from": "hand", "to": "battlefield", "fp": "b", "tp": "b"}], "hd": {"b": ["Llanowar Elves", "Elvish Mystic"]}, "lib": {"b": 53}},
    {"t": 1, "k": "tap", "p": "b", "card": "Forest", "id": 108, "hd": {"b": ["Elvish Mystic"]}, "lib": {"b": 53}},
    {"t": 1, "k": "cast", "p": "b", "card": "Llanowar Elves", "zn": [{"id": 86, "card": "Llanowar Elves", "from": "hand", "to": "stack", "fp": "b", "tp": null}]},
    {"t": 1, "k": "resolve", "p": "b", "card": "Llanowar Elves", "pt": "1/1", "zn": [{"id": 86, "card": "Llanowar Elves", "from": "stack", "to": "battlefield", "fp": null, "tp": "b"}]},
    {"t": 2, "k": "turn", "p": "a", "hd": {"a": ["Goblin Guide", "Mountain", "Rift Bolt"], "b": ["Elvish Mystic"]}, "lib": {"a": 53, "b": 53}, "ut": [108]},
    {"t": 2, "k": "draw", "p": "a", "card": "Mountain", "id": 26, "x": 1, "zn": [{"id": 26, "card": "Mountain", "from": "library", "to": "hand", "fp": "a", "tp": "a"}], "n": 1, "hd": {"a": ["Goblin Guide", "Mountain", "Rift Bolt", "Mountain"]}, "lib": {"a": 52}},
    {"t": 2, "k": "tap", "card": "Mountain", "id": 23, "hd": {"a": ["Goblin Guide", "Mountain", "Mountain"]}, "lib": {"a": 52}, "p": "a"},
    {"t": 2, "k": "cast", "p": "a", "card": "Rift Bolt", "target": "Llanowar Elves", "tid": 86, "zn": [{"id": 46, "card": "Rift Bolt", "from": "hand", "to": "stack", "fp": "a", "tp": null}]},
    {"t": 2, "k": "damage", "p": "a", "card": "Rift Bolt", "id": 46, "n": 3, "target": "Llanowar Elves", "tid": 86},
    {"t": 2, "k": "resolve", "p": "a", "card": "Rift Bolt", "id": 46, "zn": [{"id": 46, "card": "Rift Bolt", "from": "stack", "to": "graveyard", "fp": null, "tp": "a"}]},
    {"t": 2, "k": "destroy", "p": "b", "card": "Llanowar Elves", "id": 86, "x": 1, "zn": [{"id": 86, "card": "Llanowar Elves", "from": "battlefield", "to": "graveyard", "fp": "b", "tp": "b"}], "target": "battlefield>graveyard"},
    {"t": 2, "k": "cast", "p": "a", "card": "Walking Ballista", "zn": [{"id": 53, "card": "Walking Ballista", "from": "hand", "to": "stack", "fp": "a", "tp": null}], "hd": {"a": ["Goblin Guide", "Mountain", "Mountain"]}, "lib": {"a": 52}},
    {"t": 2, "k": "other"},
    {"t": 2, "k": "resolve", "p": "a", "card": "Walking Ballista", "pt": "0/0", "zn": [{"id": 53, "card": "Walking Ballista", "from": "stack", "to": "battlefield", "fp": null, "tp": "a", "ctr": {"+1/+1": 1}}]},
    {"t": 2, "k": "token", "p": "a", "card": "Soldier Token", "id": 199, "x": 1, "zn": [{"id": 199, "card": "Soldier Token", "from": null, "to": "battlefield", "fp": null, "tp": "a", "tok": 1, "pt": "1/1", "kw": ["Flying"]}], "n": 1, "pt": "1/1", "kw": ["Flying"]},
    {"t": 2, "k": "counters", "p": "a", "card": "Walking Ballista", "id": 53, "ct": "+1/+1", "n": -1, "abs": 0, "x": 1},
    {"t": 2, "k": "destroy", "p": "a", "card": "Walking Ballista", "id": 53, "x": 1, "zn": [{"id": 53, "card": "Walking Ballista", "from": "battlefield", "to": "graveyard", "fp": "a", "tp": "a"}], "target": "battlefield>graveyard"},
  ]
  const st = replayStates(E, gm, 20, { a: { commanders: [], size: 60 }, b: { commanders: [], size: 60 } }, true)
  const at = (n, side) => st[n][side]
  // mão exata desde o mulligan, sem cartas de costas; biblioteca exata no turno
  assert.deepEqual(at(1, 'a').known, ['Goblin Guide']); assert.equal(at(1, 'a').hand, 1)
  assert.equal(at(3, 'b').library, 53); assert.equal(at(3, 'b').hand, 3)
  // terreno pelo zn (com o id do Forge), mão sem ele; o feitiço sai da mão ao pagar
  assert.deepEqual(at(4, 'b').perms.map(p => [p.name, p.fid]), [['Forest', 108]])
  assert.deepEqual(at(5, 'b').known, ['Elvish Mystic'])
  assert.ok(at(7, 'b').perms.some(p => p.fid === 86 && p.sick))
  // desvira só o que o Forge desvirou (o Forest é do outro jogador: fica como está)
  assert.equal(at(8, 'b').perms.find(p => p.fid === 108).tapped, true)
  // compra com o nome da carta
  assert.deepEqual(at(9, 'a').known, ['Goblin Guide', 'Mountain', 'Rift Bolt', 'Mountain']); assert.equal(at(9, 'a').library, 52)
  // instantâneo para o cemitério; a criatura morre pela mudança de zona (sem inferir pelo dano)
  assert.ok(!at(12, 'b').perms.find(p => p.fid === 86).dying)
  assert.deepEqual(at(13, 'a').graveyard, ['Rift Bolt'])
  assert.ok(at(14, 'b').perms.find(p => p.fid === 86).dying); assert.deepEqual(at(14, 'b').graveyard, ['Llanowar Elves'])
  // marcadores com que entra vêm do Forge (não do texto da carta); ficha com o id e voar
  assert.deepEqual(at(17, 'a').perms.find(p => p.fid === 53).counters, { '+1/+1': 1 })
  const tok = at(18, 'a').perms.find(p => p.fid === 199)
  assert.ok(tok.token && tok.pt === '1/1' && tok.kw[0] === 'Flying')
  assert.deepEqual(at(19, 'a').perms.find(p => p.fid === 53).counters, {})
  assert.deepEqual(at(20, 'a').graveyard, ['Rift Bolt', 'Walking Ballista'])
  console.log('selfcheck tabuleiro exato ok')
}

// Ninjutsu (eventos reais do Forge): a atacante devolvida sai do combate para a mão; o ninja entra virado e a atacar
{
  const G = [
    { n: 'Changeling Outcast', t: 'Creature — Shapeshifter', o: '', pt: '1/1', kw: [] },
    { n: 'Ingenious Infiltrator', t: 'Creature — Vedalken Ninja', o: 'Ninjutsu {U}{B}', pt: '2/3', kw: [] },
  ]
  const gm = { byName: new Map(G.map(c => [c.n, c])), byLower: new Map(G.map(c => [c.n.toLowerCase(), c])) }
  const zn = (id, card, from, to) => [{ id, card, from, to, fp: 'b', tp: 'b' }]
  const E = [
    { t: 1, k: 'turn', p: 'b', hd: { b: ['Changeling Outcast', 'Ingenious Infiltrator'] }, ut: [] },
    { t: 1, k: 'resolve', p: 'b', card: 'Changeling Outcast', pt: '1/1', zn: [{ id: 101, card: 'Changeling Outcast', from: 'stack', to: 'battlefield', fp: null, tp: 'b' }] },
    { t: 3, k: 'turn', p: 'b', ut: [] },
    { t: 3, k: 'phase', p: 'b', ph: 'combat' },
    { t: 3, p: 'b', k: 'attack', card: 'Changeling Outcast', id: 101, target: 'a' },
    { t: 3, k: 'bounce', p: 'b', card: 'Changeling Outcast', id: 101, x: 1, zn: zn(101, 'Changeling Outcast', 'battlefield', 'hand'), target: 'battlefield>hand', hd: { b: ['Ingenious Infiltrator', 'Changeling Outcast'] } },
    { t: 3, k: 'activate', p: 'b', card: 'Ingenious Infiltrator' },
    { t: 3, k: 'zone', p: 'b', card: 'Ingenious Infiltrator', id: 120, x: 1, zn: zn(120, 'Ingenious Infiltrator', 'hand', 'battlefield'), hd: { b: ['Changeling Outcast'] } },
    { t: 3, k: 'resolve', p: 'b', card: 'Ingenious Infiltrator', id: 120, txt: 'Ingenious Infiltrator (120) - Ai(2)-B puts Ingenious Infiltrator (120) from their hand onto the battlefield tapped and attacking.' },
  ]
  const st = replayStates(E, gm, 20, { a: { size: 60 }, b: { size: 60 } }, true)
  const last = st.at(-1).b
  assert.deepEqual(last.perms.map(p => p.name), ['Ingenious Infiltrator'])
  const nin = last.perms[0]
  assert.ok(nin.tapped && nin.attacking === 'a' && !nin.sick, JSON.stringify(nin))
  assert.deepEqual(last.known, ['Changeling Outcast'])
  // o que entra noutra resolução (sem «attacking») continua normal
  assert.ok(st[2].b.perms[0].sick && !st[2].b.perms[0].attacking)
  console.log('selfcheck ninjutsu ok')
}

// Testes do Laboratório → provas, fator «testes» e sideboard (jogo exato sintético).
import { testEvidence, testsBoost, stuckIn } from './src/tests.js'
import { planSideboard } from './src/sideboard.js'
{
  const K = (n, mt, t, o, extra = {}) => ({ n, mt, t, o, tg: [], kw: [], cmc: 2, ...extra })
  const cs = [K('Brick', 'Creature', 'Creature — Wall', '', { cmc: 3 }), K('Bolt', 'Instant', 'Instant', 'Bolt deals 3 damage to any target.', { tg: ['removal'] }),
    K('Mountain', 'Land', 'Basic Land — Mountain', ''), K('Drake', 'Creature', 'Creature — Drake', 'Flying', { kw: ['Flying'] }), K('Shock', 'Instant', 'Instant', 'Shock deals 2 damage.'),
    K('Plummet', 'Instant', 'Instant', 'Destroy target creature with flying.')]
  const D = { byName: new Map(cs.map(c => [c.n, c])) }
  const ev = [{ t: 0, k: 'mulligan', p: 'b', hd: { a: ['Brick', 'Bolt', 'Mountain'], b: ['Drake'] } }, { t: 1, k: 'turn', p: 'a' }, { t: 2, k: 'turn', p: 'b' },
    { t: 3, k: 'turn', p: 'a' }, { t: 3, k: 'cast', p: 'a', card: 'Bolt', hd: { a: ['Brick', 'Mountain'] } }, { t: 5, k: 'turn', p: 'a' }]
  const g = { winner: 'b', exact: true, events: ev, summary: { a: { used: ['Bolt', 'Mountain'], cast: [[3, 'Bolt']], damage_by_card: { Bolt: 3 } }, b: { cast: [[2, 'Drake'], [4, 'Drake'], [4, 'Shock']], damage_by_card: { Drake: 6 } } } }
  assert.deepEqual(stuckIn(g), ['Brick']) // 3 turnos na mão sem uso; o terreno foi usado
  const T = testEvidence(D, [g, g, { ...g, exact: false, winner: 'a' }])
  assert.deepEqual(T.dead.Brick, { seen: 2, dead: 2 }) // só os jogos exatos contam para a mão
  assert.equal(T.impact.Bolt.dmg, 9)
  assert.deepEqual([T.cats.flyers.games, T.cats.flyers.lost], [3, 2])
  const tb = testsBoost(D.byName.get('Plummet'), T)
  assert.ok(tb.v > 0 && tb.v <= 0.1)
  assert.equal(tb.txt, 'Testes: perdeste 2 de 3 jogos contra criaturas voadoras (Drake); isto responde')
  assert.equal(testsBoost(D.byName.get('Shock'), T), null)
  assert.equal(testsBoost(D.byName.get('Plummet'), { ...T, games: 0 }), null)
  const sw = planSideboard(D, { main: { Brick: 2, Bolt: 4, Mountain: 20 }, side: { Plummet: 2 } }, { main: { Drake: 4, Shock: 4 } }, [g], [])
  assert.deepEqual(sw.map(s => [s.in, s.out, s.q]), [['Plummet', 'Brick', 2]])
  assert.match(sw[0].why, /trava voadores \(lançou 2 criaturas voadoras; tiraram-te 6 de vida\)/)
  assert.equal(sw[0].outWhy, 'ficou presa na mão')
  // nunca comprada (nem lançada) nos jogos exatos: sem razão para sair, fica (é o plano do deck)
  const sw3 = planSideboard(D, { main: { Drake: 2, Mountain: 20 }, side: { Plummet: 2 } }, { main: { Drake: 4, Shock: 4 } }, [g], [])
  assert.deepEqual(sw3, [])
  // a IA do Forge nunca lança a carta (AI:RemoveDeck:All): não entra
  assert.deepEqual(planSideboard(D, { main: { Brick: 2, Bolt: 4, Mountain: 20 }, side: { Plummet: 2 } }, { main: { Drake: 4, Shock: 4 } }, [g], [], 5, ['Plummet']), [])
  console.log('selfcheck testes/sideboard ok')
}

// 3 jogadores (todos contra todos, jogo exato): ataque a um jogador concreto, dano a C, eliminação a meio do jogo
{
  const G = [{ n: 'Goblin Guide', t: 'Creature — Goblin Scout', o: 'Haste', pt: '2/2', kw: ['Haste'] }]
  const gm = { byName: new Map(G.map(c => [c.n, c])), byLower: new Map(G.map(c => [c.n.toLowerCase(), c])) }
  const setup = { a: { commanders: [], size: 60 }, b: { commanders: [], size: 60 }, c: { commanders: [], size: 60 } }
  const E = [
    { t: 1, k: 'turn', p: 'a', hd: { a: ['Goblin Guide'], b: [], c: [] }, lib: { a: 53, b: 53, c: 53 } },
    { t: 1, k: 'resolve', p: 'a', card: 'Goblin Guide', zn: [{ id: 10, card: 'Goblin Guide', from: 'stack', to: 'battlefield', fp: null, tp: 'a' }], hd: { a: [] } },
    { t: 1, k: 'attack', p: 'a', card: 'Goblin Guide', id: 10, target: 'c' },
    { t: 1, k: 'damage', p: 'a', card: 'Goblin Guide', id: 10, n: 2, target: 'c', combat: 1 },
    { t: 1, k: 'life', p: 'c', n: 0 },
    { t: 1, k: 'outcome', p: 'c', txt: 'Ai(3)-C has lost because life total reached 0' },
    { t: 2, k: 'turn', p: 'b' },
  ]
  const st = replayStates(E, gm, 20, setup, true)
  assert.deepEqual(st[0].sides, ['a', 'b', 'c'])
  assert.equal(st[3].a.perms[0].attacking, 'c')  // ataca o jogador C, não «o outro»
  assert.deepEqual(st[4].fx.player, { p: 'c', n: 2, psn: false })
  assert.equal(st[5].c.life, 0); assert.equal(st[5].b.life, 20)
  assert.equal(st[6].c.out, 1); assert.equal(st[6].b.out, undefined)  // C eliminado no turno 1; B continua
  assert.ok(!st[7].a.perms[0].attacking)
  // a dois, nada muda: sem lado C e a derrota não marca «eliminado»
  const two = replayStates([{ t: 1, k: 'outcome', p: 'b', txt: 'Ai(2)-B has lost' }], gm, 20, { a: {}, b: {} }, true)
  assert.deepEqual(two[0].sides, ['a', 'b']); assert.equal(two[1].b.out, undefined); assert.equal(two[1].over.loser, 'b')
  console.log('selfcheck multijogador ok')
}
// Sinergias gerais (synergy.js) com textos reais da Scryfall
import { rolesOf } from './src/data.js'
import { deckSynergy } from './src/synergy.js'
{
  const S = [
    ['Bonesplitter', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {1}', '', ['Equip']],
    ['Golem-Skin Gauntlets', 'Artifact — Equipment', 'Equipped creature gets +1/+0 for each Equipment attached to it.\nEquip {2}', '', ['Equip']],
    ['Auriok Glaivemaster', 'Creature — Human Soldier', 'As long as this creature is equipped, it gets +1/+1 and has first strike.', 'W', []],
    ['Puresteel Paladin', 'Creature — Human Knight', 'Whenever an Equipment you control enters, you may draw a card.\nMetalcraft — Equipment you control have equip {0} as long as you control three or more artifacts.', 'W', ['Metalcraft']],
    ['Benevolent Blessing', 'Enchantment — Aura', "Enchant creature\nEnchanted creature has protection from the chosen color. This effect doesn't remove Auras and Equipment you control that are already attached to it.", 'W', ['Enchant']],
    ['Axebane Guardian', 'Creature — Human Druid', 'Defender\n{T}: Add X mana in any combination of colors, where X is the number of creatures you control with defender.', 'G', ['Defender']],
    ['Wall of Glare', 'Creature — Wall', 'Defender (This creature can\'t attack.)\nThis creature can block any number of creatures.', 'W', ['Defender']],
    ['Smash to Dust', 'Sorcery', 'Choose one —\n• Destroy target artifact.\n• Destroy target creature with defender.', 'R', []],
    ['Carrion Feeder', 'Creature — Zombie', 'This creature can\'t block.\nSacrifice a creature: Put a +1/+1 counter on this creature.', 'B', []],
    ['Carrier Thrall', 'Creature — Vampire', 'When this creature dies, create a 1/1 colorless Eldrazi Scion creature token.', 'B', []],
    ['Mortician Beetle', 'Creature — Insect', 'Whenever a player sacrifices a creature, you may put a +1/+1 counter on this creature.', 'B', []],
    ['Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.', 'R', []],
  ].map(([n, t, o, ci, kw], i) => ({ n, t, o, ci, co: ci, kw, i, cmc: 2, pt: '', lg: 1, er: 100 + i, tg: [] }))
  for (const c of S) c.ro = rolesOf(c)
  const sd = { cards: S, byName: new Map(S.map(c => [c.n, c])), meta: { formats: [] } }
  const ctx = { bit: -1, allowUn: true, identity: null }
  const syn = main => deckSynergy(sd, { main, commanders: [] }, ctx)
  const eq = syn({ Bonesplitter: 4, 'Golem-Skin Gauntlets': 2, 'Auriok Glaivemaster': 4 })
  const e = eq.cats.find(x => x.s.k === 'equip')
  assert.equal(eq.cats[0].s.k, 'equip')
  assert.deepEqual(e.en.map(x => x.c.n).sort(), ['Bonesplitter', 'Golem-Skin Gauntlets'])
  assert.ok(e.pay.some(x => x.c.n === 'Auriok Glaivemaster') && !e.pay.some(x => x.c.n === 'Bonesplitter'))
  assert.deepEqual(e.sug.map(x => x.c.n), ['Puresteel Paladin']) // nas cores (W), fora do deck; Benevolent Blessing é só lembrete
  assert.ok(eq.pairs.some(p => p.a[0].n === 'Golem-Skin Gauntlets' && /Equipment/.test(p.why)))
  const wall = syn({ 'Axebane Guardian': 4, 'Wall of Glare': 4 }).cats.find(x => x.s.k === 'defender')
  assert.ok(wall.pay.some(x => x.c.n === 'Axebane Guardian') && wall.en.length === 2)
  assert.ok(!syn({ 'Axebane Guardian': 4, 'Wall of Glare': 4, 'Smash to Dust': 1 }).cats.find(x => x.s.k === 'defender').pay.some(x => x.c.n === 'Smash to Dust'))
  const sac = syn({ 'Carrion Feeder': 4, 'Carrier Thrall': 4, 'Mortician Beetle': 4 }).cats[0]
  assert.equal(sac.s.k, 'sac'); assert.ok(sac.pay.some(x => x.c.n === 'Mortician Beetle') && sac.en.some(x => x.c.n === 'Carrier Thrall'))
  assert.equal(syn({ 'Lightning Bolt': 4 }).cats.length, 0)
  console.log('selfcheck sinergias ok')
}

// Línguas: cada texto literal em tx() tem tradução em lang/en.js, com os mesmos {marcadores}; o pt é a própria chave;
// es, de e zh têm exatamente as chaves do en (o chinês pode dispensar o plural: não flexiona).
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { tx, LANGS } from './src/i18n.js'
{
  assert.equal(tx('{n} jogo|{n} jogos', { n: 1 }), '1 jogo')
  assert.equal(tx('{n} jogo|{n} jogos', { n: 3 }), '3 jogos')
  const marks = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()
  const bad = [], dir = new URL('./src/', import.meta.url)
  const D = {}
  for (const [l] of LANGS.filter(x => x[0] !== 'pt')) {
    const f = new URL(`lang/${l}.js`, dir)
    if (existsSync(f)) D[l] = (await import(f)).default
    else bad.push(`falta lang/${l}.js`)
  }
  const EN = D.en || {}
  for (const f of readdirSync(dir).filter(f => /\.jsx?$/.test(f) && f !== 'i18n.js')) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/\btx\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const k = m[2].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c)
      if (m[1] === '`' && k.includes('${')) bad.push(`${f}: tx() com \${} (usa {marcador}): ${k}`)
      else if (!(k in EN)) bad.push(`${f}: sem tradução: ${JSON.stringify(k)}`)
    }
  }
  for (const [l, T] of Object.entries(D)) {
    for (const k of Object.keys(EN)) {
      if (!(k in T)) { bad.push(`${l}: falta ${JSON.stringify(k)}`); continue }
      if (marks(k) !== marks(T[k])) bad.push(`${l}: marcadores diferentes: ${JSON.stringify(k)} → ${JSON.stringify(T[k])}`)
      if (k.includes('|') && !T[k].includes('|') && l !== 'zh' || !k.includes('|') && T[k].includes('|')) bad.push(`${l}: plural: ${JSON.stringify(k)}`)
    }
    for (const k of Object.keys(T)) if (!(k in EN)) bad.push(`${l}: chave a mais ${JSON.stringify(k)}`)
  }
  assert.deepEqual(bad, [])
  console.log('selfcheck línguas ok')
}

// Universo: laço e desempenho das cartas (src/universe.js)
import { selfcheck as universeCheck } from './src/universe.js'
universeCheck()
console.log('selfcheck universo ok')

// swapSide: o deck de quem vê passa para o lugar 'a' (repetições de torneio)
{ const { swapSide } = await import('./src/game.js'); const r = swapSide({ winner: 'b', events: [{ p: 'b', card: 'a', txt: 'b' }] }, 'b'); assert.equal(r.winner, 'a'); assert.equal(r.events[0].p, 'a'); assert.equal(r.events[0].card, 'a'); assert.equal(r.events[0].txt, 'b'); console.log('selfcheck lados ok') }

{ const { nextGame } = await import('./src/game.js')
  // mesas A e B a jogar em paralelo: jogos 1(A) 2(B) 3(B) 4(A) 5(B)
  const A = { id: 'A' }, B = { id: 'B' }, fl = [[1, A], [2, B], [3, B], [4, A], [5, B]].map(([id, m]) => ({ id, m }))
  const open = () => false, id = r => r && r.x.id
  assert.equal(id(nextGame(fl, 0, 'ultimo', {}, open)), 5)                      // o mais recente
  assert.equal(nextGame(fl, 4, 'ultimo', {}, open), null)                       // já é o último: espera
  assert.equal(id(nextGame(fl, 0, 'ordem', {}, open)), 2)                       // o seguinte a acabar
  assert.equal(id(nextGame(fl, 0, 'mesa', { mid: 'A', gid: 1 }, open)), 4)      // a mesma mesa
  const away = nextGame(fl.slice(0, 3), 0, 'mesa', { mid: 'A', gid: 1 }, open)   // A ainda sem jogo novo: espreita B e volta
  assert.equal(id(away), 2); assert.equal(away.away, true)
  assert.equal(id(nextGame(fl, 2, 'mesa', { mid: 'A', gid: 1 }, open)), 4)      // depois de espreitar, volta à mesa A
  assert.equal(nextGame(fl.slice(0, 3), 0, 'mesa', { mid: 'A', gid: 1 }, () => true).away, false)  // A acabou: muda de mesa
  console.log('selfcheck próximo jogo ok') }
{ const { selfcheck } = await import('./src/artmatch.js'); selfcheck(); console.log('selfcheck imagens da pasta ok') }
{ const { artPick } = await import('./src/data.js'); const v = [{ id: 'A', q: 4 }, { id: 'B', q: 4 }], n = { A: 0, B: 0 }
  for (let i = 0; i < 400; i++) n[artPick(v, `a${i}`)]++
  assert.ok(n.A > 120 && n.B > 120, 'artPick divide as cópias'); assert.equal(artPick(v, 'a7'), artPick(v, 'a7')); assert.equal(artPick('x', 'a1'), 'x'); assert.equal(artPick(null), null)
  console.log('selfcheck artes por cópia ok') }
{ const d = { ...emptyDeck('modern'), main: { Island: 10, 'Sol Ring': 1 }, prints: { Island: { set: 'TRK', cn: '320' } }, split: { Island: [{ id: 'x', q: 3, set: 'FRA', cn: '386' }, { id: 'arts/y.webp', q: 2 }] } }
  const L = exportList(d).split('\n')
  assert.deepEqual(L.filter(l => l.includes('Island')), ['3 Island (FRA) 386', '2 Island', '5 Island (TRK) 320'])
  console.log('selfcheck exportação por arte ok') }
{ const { mixTake } = await import('./src/game.js')
  const mk = (s, n, com = false) => Array.from({ length: n }, (_, i) => [s, { id: `${s}${com ? 'c' : ''}${i}`, community: com }])
  const pool = [...mk('meus', 10), ...mk('meus', 10, true), ...mk('meta', 10)], kinds = r => r.reduce((o, [s, d]) => { const k = s === 'meta' ? 'meta' : d.community ? 'com' : 'meu'; o[k] = (o[k] || 0) + 1; return o }, {})
  assert.deepEqual(kinds(mixTake(pool, 10, { meu: 50, com: 20, meta: 30 })), { meu: 5, com: 2, meta: 3 })
  assert.deepEqual(kinds(mixTake(pool, 10, { meu: 100, meta: 5 }, 0.2)), { meu: 8, meta: 2 })            // pelo menos 20% do meta
  assert.deepEqual(kinds(mixTake([...mk('meus', 2), ...mk('meta', 10)], 8, { meu: 75, meta: 25 })), { meu: 2, meta: 6 })  // faltam meus: o meta completa
  assert.equal(mixTake(pool, 7, { meu: 1, com: 1, meta: 1 }).length, 7)
  console.log('selfcheck mistura ok') }
{ const { genShape } = await import('./src/game.js')  // gerador: todos os tipos permitidos saem com a mesma probabilidade
  const types = ['elim', 'dupla', 'suico', 'liga', 'mesas', 'gauntlet', 'rei', 'grupos', 'equipas'], N = 9000, cnt = {}
  let r = 1; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < N; i++) { const s = genShape({ types, formats: ['modern', 'pauper', 'commander'], multi: f => f === 'commander', ownIn: f => f !== 'pauper' }, rnd); cnt[s.type] = (cnt[s.type] || 0) + 1; assert.ok(s.type === 'mesas' ? s.format === 'commander' : s.format !== 'commander'); assert.ok(s.type !== 'gauntlet' || s.format === 'modern') }
  for (const k of types) assert.ok(Math.abs(cnt[k] / N - 1 / 9) < 0.02, `${k} ${cnt[k]}`)
  assert.deepEqual(genShape({ types: ['mesas'], formats: ['modern'], multi: () => false, ownIn: () => true }), { type: 'mesas', format: 'modern' })  // sem Commander, mesas a 3–4 do formato
  assert.equal(genShape({ types: ['gauntlet'], formats: ['modern'], multi: () => false, ownIn: () => false }).type, 'elim')  // gauntlet sem decks meus: não dá
  console.log('selfcheck gerador ok') }
{ const { needsMark } = await import('./src/game.js')
  assert.ok(needsMark(6, 20) && needsMark(9, 20) && needsMark(6, 8) && !needsMark(16, 20) && !needsMark(10, 20) && !needsMark(8, 20) && !needsMark(11, 20))
  assert.ok(needsMark(66, 100) && needsMark(68, 100) && needsMark(86, 100) && !needsMark(88, 100) && needsMark(61, 100) && !needsMark(1, 100) && !needsMark(50, 100))
  console.log('selfcheck traço do 6 e do 9 ok') }
{ const { trophyValue, playersW, lengthW } = await import('./src/trophyvalue.js')
  assert.equal(trophyValue({ tier: 1, kind: 'elim', n: 8 }), 100)                       // ouro numa eliminação de 8: o padrão
  assert.ok(playersW(16) > 1 && playersW(4) < 1 && playersW(100) === 1.6)                 // mais decks, mais pontos (com teto)
  assert.ok(lengthW('rei', 4, 3) < 1 && lengthW('rei', 4, 24) === 1.5 && lengthW('elim', 8, 7) === 1)
  assert.equal(trophyValue({ tier: 1, kind: 'elim', n: 8, casual: true }), 50)            // azul vale metade
  assert.ok(trophyValue({ tier: 'plat', kind: 'gauntlet', n: 8 }) > trophyValue({ tier: 1, kind: 'grupos', n: 16 }))
  console.log('selfcheck valor dos troféus ok') }
{ const { trophyStars, starPoints, deckPoints, pointStars, perfStars, perfQ, trophyValue } = await import('./src/trophyvalue.js')
  // os pontos sozinhos chegam às 4★; o desempenho (q: 1 = média do campo, 3 = 3× a média) dá as outras 2
  assert.ok(trophyStars(0) === 0 && trophyStars(100) > 1.2 && trophyStars(100) < 1.6 && trophyStars(3000) === 4 && trophyStars(99999) === 4)
  for (let k = 1; k <= 4; k++) assert.ok(Math.abs(pointStars(starPoints(k)) - k) < 0.11, `estrela ${k}`)
  assert.ok(perfStars(1) === 0 && perfStars(0.4) === 0 && perfStars(undefined) === 0 && perfStars(3) === 2 && perfStars(50) === 2 && perfStars(perfQ(1)) === 1)
  assert.ok(trophyStars(99999, 3) === 6 && trophyStars(3000, 1) === 4 && trophyStars(0, 3) === 0)  // 6★: coleção enorme E sempre no topo
  assert.ok(trophyStars(500, 2.2) > trophyStars(1500, 1))  // ganhar mais do que os outros pesa mais do que acumular
  assert.equal(trophyValue({ tier: 1, kind: 'rei', n: 4, m: 3 }), 33)  // o mesmo que tournament.py trophy_w (auto-teste de lá)
  assert.equal(deckPoints([{ place: 1, type: 'elim', n: 8, valid: true }, { place: 1, type: 'elim', n: 8, valid: false }]), 100)
  console.log('selfcheck estrelas brancas ok') }
{ const { solid, simulate } = await import('./src/dicephys.js')  // dados 3D: faces planas, rótulos certos, assentam e o d6 é justo
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  for (const [k, n] of [['d4', 4], ['d6', 6], ['d8', 8], ['d10', 10], ['d12', 12], ['d20', 20]]) {
    const S = solid(k)
    S.faces.forEach((f, i) => f.forEach(v => assert.ok(Math.abs(dot(S.verts[v].map((x, j) => x - S.info[i].c[j]), S.info[i].n)) < 1e-9, `${k} face ${i} plana`)))
    assert.equal(new Set(S.labels).size, n, `${k} rótulos`)
  }
  let seed = 11; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const cnt = Array(7).fill(0)
  for (let i = 0; i < 240; i++) { const r = simulate(['d6'], { rng }); assert.ok(r.t < 9, 'd6 assenta'); cnt[r.values[0]]++ }
  assert.ok(cnt.slice(1).every(c => c > 20 && c < 60), `d6 justo ${cnt}`)
  const m = simulate(['d20', 'd20', 'd10t', 'd10', 'coin'], { rng }); assert.ok(m.t < 9 && m.values.every(v => v != null))
  { const lcg = s0 => () => (s0 = (s0 * 16807) % 2147483647) / 2147483647, k = ['d6', 'd20', 'coin']  // mesa livre: a mesma semente dá o mesmo lançamento (Dice3D assenta no valor do servidor)
    for (const s0 of [3, 77, 901]) assert.deepEqual(simulate(k, { X: 9, Z: 5, rng: lcg(s0) }).values, simulate(k, { X: 9, Z: 5, rng: lcg(s0) }).values, 'física determinista') }
  const { qrot } = await import('./src/dicephys.js')
  for (let i = 0; i < 40; i++) for (const b of simulate(['d12', 'd20', 'd8', 'coin'], { rng }).bodies) {  // assentes numa face, de vez
    const d = Math.max(...b.S.info.filter((_, k) => b.kind !== 'coin' || k < 2).map(f => -qrot(b.q, f.n)[1]))
    assert.ok(d > 0.99999 && b.asleep, `${b.kind} torto`)
  }
  console.log('selfcheck dados 3D ok') }
{ const { buildIndex, matchName, setInfo } = await import('./src/cardmatch.js')  // foto -> carta: nome com erros de OCR, cartas duplas, edição/número
  const cards = ['Lightning Bolt', 'Nimble Pilferer', 'Ragavan, Nimble Pilferer', 'Start // Fire', 'Fire // Ice', 'Counterspell', 'Sol Ring'].map(n => ({ n }))
  const idx = buildIndex(cards), top = l => cards[matchName(idx, l)[0].i].n
  assert.equal(top(['Lightning Bo1t {R}', 'Instant']), 'Lightning Bolt')
  assert.equal(top(['Ragavan, Nimble Pi1ferer R']), 'Ragavan, Nimble Pilferer')
  assert.equal(top(['Fire', 'Ice']), 'Fire // Ice')
  assert.deepEqual(setInfo('0123 R\nMH3 • EN'), { set: 'mh3', cn: '123' })
  console.log('selfcheck foto de carta ok') }
{ const { sizePlan } = await import('./src/universe.js')  // «Ajustar quantidades» fecha a diferença para o tamanho do formato
  const mk = (n, t, tg = []) => ({ n, t, mt: t.includes('Land') ? 'Land' : 'Creature', tg, o: '' })
  const cards = [mk('Plains', 'Basic Land — Plains'), mk('Island', 'Basic Land — Island'), mk('Bear', 'Creature'), mk('Bolt', 'Instant', ['removal'])]
  const data = { byName: new Map(cards.map(c => [c.n, c])) }
  const deck = { main: { Plains: 10, Bear: 30, Bolt: 14 }, commanders: [] }  // 54 de 60
  const r = sizePlan(data, deck, null, { min: 60, max: 60, maxOf: c => (c.mt === 'Land' ? 99 : 40), need: { lands: 10, target: 13, cols: { W: { have: 10, full: 14 } } }, needs: { removal: [14, 16] } })
  assert.equal(r.gap, 6); assert.equal(r.items.reduce((a, x) => a + x.k, 0), 6)
  assert.equal(r.items.find(x => x.c.n === 'Plains').k, 3)  // 3 terrenos até ao alvo, o resto em cartas
  assert.ok(r.items.find(x => x.c.n === 'Bolt'))  // remoção em falta
  const r2 = sizePlan(data, { main: { Plains: 20, Bear: 30, Bolt: 14 }, commanders: [] }, null, { min: 60, max: 60, need: { lands: 20, target: 17, cols: {} } })
  assert.equal(r2.items.reduce((a, x) => a + x.k, 0), -4)
  console.log('selfcheck tamanho do deck ok') }

// Sugestões com cartas inventadas: blink não é remoção, referências mortas, combos impossíveis, EDHREC fora do
// Commander, terrenos fora das cores, ninjutsu e cartas de ódio estreitas.
{ const { prepData, recommend, deckCuts, deadRefs, metaIndex } = await import('./src/data.js')
  const { prepareSwaps } = await import('./src/swap.js')
  const { recommendLands } = await import('./src/mana.js')
  const all = (1 << F.length) - 1
  const K = (n, t, o, mc, ci, tg = [], extra = {}) => ({ n, t, o, mc, cmc: (+(mc.match(/\{(\d+)\}/)?.[1] || 0)) + (mc.match(/\{[WUBRGC]\}/g) || []).length, ci, co: ci, lg: all, rs: 0, r: 'c', kw: [], pt: '', er: 5000, tg, ...extra })
  const vanilla = (n, sub, ci) => K(n, `Creature — ${sub}`, '', `{1}{${ci}}`, ci, ['creature'], { pt: '2/2' })
  const nine = [1, 2, 3, 4, 5, 6, 7, 8]
  const cards = [
    K('Essence Flux', 'Instant', "Exile target creature you control, then return that card to the battlefield under its owner's control. If it's a Spirit, put a +1/+1 counter on it.", '{U}', 'U', ['removal', 'counters']),
    ...'ABCDE'.split('').map(x => vanilla(`Human ${x}`, 'Human Soldier', 'U')),
    vanilla('Some Spirit', 'Spirit', 'U'), vanilla('Other Spirit', 'Spirit', 'U'), vanilla('Third Spirit', 'Spirit', 'U'),
    vanilla('Some Villain', 'Human Villain', 'B'), vanilla('Other Villain', 'Villain', 'B'), vanilla('Third Villain', 'Villain', 'B'),
    vanilla('Some Dragon', 'Dragon', 'R'), vanilla('Other Dragon', 'Dragon', 'R'), vanilla('Third Dragon', 'Dragon', 'R'),
    K('Combo Rogue', 'Creature — Human Rogue', 'Whenever a creature dies, draw a card.', '{1}{B}', 'B', ['creature'], { pt: '2/2' }),
    K('Combo Blue', 'Sorcery', 'Untap all creatures you control.', '{2}{U}', 'U'),
    K('Combo Red', 'Instant', 'Creatures you control gain haste.', '{R}', 'R'),
    K('Arid Mesa', 'Land', '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.', '', '', ['tutor', 'land']),
    K('Villainous Hideout', 'Land', '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a Villain spell or to activate an ability of a Villain source.\n{3}, {T}: Target Villain you control connives.', '', '', ['draw', 'land']),
    K('Island', 'Basic Land — Island', '({T}: Add {U}.)', '', 'U', ['land']), K('Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)', '', 'B', ['land']),
    K('Old Murder', 'Instant', 'Destroy target creature.', '{2}{B}', 'B', ['removal'], { er: 40000 }),
    K('Fresh Murder', 'Instant', 'Destroy target creature.', '{1}{B}', 'B', ['removal'], { er: 200 }),
    K('Ornithopter', 'Artifact Creature — Thopter', 'Flying', '{0}', '', ['evasion', 'creature'], { kw: ['Flying'], pt: '0/2' }),
    ...nine.map(k => K(`Ninja ${k}`, 'Creature — Human Ninja', 'Ninjutsu {1}{U}\nWhenever this creature deals combat damage to a player, draw a card.', '{2}{U}', 'U', ['draw', 'creature'], { kw: ['Ninjutsu'], pt: '2/2' })),
    K('Dragon Hunter', 'Creature — Human Warrior', 'Protection from Dragons\nThis creature can block Dragons as though it had reach.', '{W}', 'W', ['creature'], { pt: '2/1' }),
    ...nine.map(k => vanilla(`Knight ${k}`, 'Human Knight', 'W')),
  ]
  const D = 8, emb = new Int8Array(cards.length * D)
  let sd = 7
  for (let k = 0; k < emb.length; k++) emb[k] = ((sd = (sd * 16807) % 2147483647) % 200) - 100
  const iOf = n => cards.findIndex(c => c.n === n)
  const combos = [['c1', [iOf('Combo Rogue'), iOf('Combo Blue'), iOf('Combo Red')], ['Infinite damage'], [], 0, 50]]
  const sdata = prepData({ formats: F, dim: D }, cards, combos, emb.buffer, new Float32Array(cards.length * 2).buffer)
  const by = n => sdata.byName.get(n)
  // blink não é remoção; «If it's a Spirit» num deck de Humans é referência morta
  assert.ok(!by('Essence Flux').tg.includes('removal'))
  const humans = 'ABCDE'.split('').map(x => by(`Human ${x}`))
  assert.deepEqual(deadRefs(by('Essence Flux'), humans), ['Spirit'])
  assert.deepEqual(deadRefs(by('Essence Flux'), [...humans, by('Some Spirit'), by('Other Spirit')]), [])
  const ctxUB = { bit: -1, allowUn: true, identity: 'UB' }
  const deckUB = { ...emptyDeck('modern'), main: { 'Human A': 4, 'Human B': 4, 'Human C': 4, 'Human D': 4, 'Combo Rogue': 4, 'Old Murder': 4, Island: 10, Swamp: 10 } }
  const haveUB = Object.keys(deckUB.main).map(n => by(n).i)
  const recs = recommend(sdata, { seeds: haveUB.filter(i => sdata.cards[i].mt !== 'Land'), have: haveUB, ctx: ctxUB, filters: null, limit: 80, deckSize: 60, turn: 6 })
  // quase-combo cuja outra peça é vermelha: impossível num deck UB
  assert.ok(recs.some(r => r.c.n === 'Combo Blue') && !recs.some(r => r.why.some(w => w.k === 'combo2')), 'quase-combo fora das cores')
  // Arid Mesa (R/W) e Villainous Hideout sem Villains não aparecem num deck UB
  assert.ok(!recs.some(r => r.c.n === 'Arid Mesa' || r.c.n === 'Villainous Hideout'))
  const lands = recommendLands(sdata, { deck: deckUB, fmt: FORMAT.modern, ctx: ctxUB, limit: 12 }).map(r => r.c.n)
  assert.ok(!lands.includes('Arid Mesa') && !lands.includes('Villainous Hideout'), lands.join())
  // Modern: o rank do EDHREC não é motivo para trocar
  const sw = prepareSwaps(sdata, deckUB, FORMAT.modern, ctxUB)(by('Fresh Murder'), { limit: 3 })
  assert.ok(!sw.some(x => x.why.some(w => /EDHREC/.test(w))), JSON.stringify(sw))
  // Ornithopter num deck de ninjas abre caminho ao ninjutsu: não é «Não interage»
  const ninja = { ...emptyDeck('modern'), main: { Ornithopter: 4, ...Object.fromEntries(nine.map(k => [`Ninja ${k}`, 4])), Island: 20 } }
  assert.ok(!deckCuts(sdata, ninja, { ctx: ctxUB }).some(x => x.c.n === 'Ornithopter' && x.why.some(w => /Não interage/.test(w))))
  // Dragon Hunter num Pioneer sem dragões no meta: carta de sideboard
  const meta = metaIndex(sdata, { decks: 300, cards: [['Human A', 0.4, 4, 0, 0, [0]]], archetypes: [{ name: 'Humans', share: 0.2, decks: 60, core: [['Human A', 0.9, 4]] }], pairs: {} }, 'Pioneer')
  const kn = { ...emptyDeck('pioneer'), main: { 'Dragon Hunter': 3, ...Object.fromEntries(nine.map(k => [`Knight ${k}`, 4])) } }
  const dh = deckCuts(sdata, kn, { ctx: { bit: -1, allowUn: true, identity: 'W' }, meta }).find(x => x.c.n === 'Dragon Hunter')
  assert.ok(dh && /Carta de sideboard/.test(dh.why[0]), JSON.stringify(dh?.why))
  console.log('selfcheck sugestões ok') }
{ const { fillPlan } = await import('./src/universe.js')  // «Preencher o deck»: fecha a diferença com cartas novas, por estratégia
  const mk = (n, t, tg = [], cmc = 2) => ({ n, t, mt: t.includes('Land') ? 'Land' : 'Creature', tg, cmc, o: '' })
  const L = [mk('Plains', 'Basic Land — Plains'), mk('Island', 'Basic Land — Island'), mk('Tundra', 'Land')]
  const S = [mk('Big', 'Creature', [], 6), mk('Bolt', 'Instant', ['removal'], 1), mk('Cheap', 'Creature', [], 1), mk('Mid', 'Creature', [], 3), mk('Counter', 'Instant', ['counter'], 2)]
  const data = { byName: new Map([...L, ...S].map(c => [c.n, c])) }
  const deck = { main: { Plains: 10, Bear: 40 }, commanders: [] }  // 50 de 54 (alvo pequeno de propósito)
  const recs = S.map(c => ({ c, why: [{ txt: 'boa' }] })), need = { lands: 10, target: 11, cols: { U: { have: 0, full: 8 } } }
  const eq = fillPlan(data, deck, { min: 55, recs, lands: [{ c: L[2], why: [] }], need, needs: { removal: [0, 2] } })
  assert.equal(eq.items.reduce((a, x) => a + x.k, 0), 5); assert.equal(eq.items[0].c.n, 'Tundra'); assert.equal(eq.items[1].c.n, 'Bolt')
  const cv = fillPlan(data, deck, { min: 55, recs, lands: [], need: { ...need, target: 10 }, strategy: 'curva' })
  assert.deepEqual(cv.items.map(x => x.c.cmc).slice(0, 2), [1, 1])
  const it = fillPlan(data, deck, { min: 55, recs, lands: [], need: { ...need, target: 10 }, strategy: 'interacao' })
  assert.deepEqual(it.items.slice(0, 2).map(x => x.c.n).sort(), ['Bolt', 'Counter'])
  console.log('selfcheck preencher o deck ok') }
{ const { landInfo } = await import('./src/mana.js')  // terrenos: cores só do que vem a seguir a «Add»; «qualquer cor» com limites vale menos
  const L = (o, t = 'Land') => landInfo({ n: 'x', t, o, mt: 'Land' })
  assert.ok(!L('{T}: Add {C}.\n{3}{G}{W}, {T}: Create a token.').colors.has('G'))
  assert.ok(L('{T}: Add {G} or {W}.').colors.has('G') && L('', 'Land — Forest Plains').colors.has('W'))
  assert.equal(L('{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast an artifact spell.').anyQ, 0.25)
  assert.equal(L('{T}: Add one mana of any color.').anyQ, 1)
  assert.ok(L('{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.').basicOnly)
  console.log('selfcheck terrenos ok') }
{ const { parseQuery: P } = await import('./src/nlsearch.js')  // pesquisa por frases (pt/en) e sintaxe do Scryfall
  const a = P('enchantment que forneça flying mas que custe no maximo 2')
  assert.deepEqual(a.f, { type: 'Enchantment', oracle: ['flying'], cmcMax: 2 }); assert.equal(a.rest, '')
  assert.deepEqual(P('encantamento que dê voar até 2').f, { type: 'Enchantment', oracle: ['flying'], cmcMax: 2 })
  assert.deepEqual(P('criaturas vermelhas com ímpeto custo 1').f, { type: 'Creature', oracle: ['haste'], cmcMin: 1, cmcMax: 1, colors: ['R'] })
  assert.equal(P('instantâneo azul menos de 3').f.cmcMax, 2)
  assert.deepEqual(P('t:enchantment o:"gain control" mv>=3').f, { type: 'Enchantment', oracle: ['gain control'], cmcMin: 3 })
  assert.equal(P('Lightning Bolt'), null)
  for (const q of ['Lands que permitam fazer draw', 'Lands draw', 'terreno comprar cartas', 'tierras que roban cartas', '抽牌的地']) assert.deepEqual(P(q).f, { tags: ['draw'], type: 'Land' }, q)
  assert.deepEqual(P('费用最多2的飞行结界').f, { cmcMax: 2, oracle: ['flying'], type: 'Enchantment' })
  assert.deepEqual(P('Kreaturen mit Flugfähigkeit höchstens 3').f, { cmcMax: 3, oracle: ['flying'], type: 'Creature' })
  assert.deepEqual(P('robar el control').f, { tags: ['steal'] })
  assert.deepEqual(P('criaturas lendárias verdes').f, { type: 'Creature', legendary: true, colors: ['G'] })
  assert.deepEqual(P('传奇生物').f, { type: 'Creature', legendary: true })
  const types = new Set(['Human', 'Elf'])
  assert.deepEqual(P('criaturas lendárias humano com 1+/1+', { types }).f, { tags: ['counters'], type: 'Creature', legendary: true, sub: 'Human' })
  for (const q of ['criaturas lendárias humano que beneficiem de encantamentos', 'legendary human creatures that benefit from enchantments', 'legendäre menschliche Kreaturen die von Verzauberungen profitieren', '受益于结界的传奇人类生物'])
    assert.deepEqual({ ...P(q, { types }).f, cares: undefined }, { cares: undefined, type: 'Creature', legendary: true, sub: 'Human', anyText: [['enchantment', 'aura', 'enchanted']] }, q)
  assert.ok(P('criaturas que beneficiem de marcadores').f.anyText[0].includes('counter on'))
  assert.deepEqual(P('criaturas lendárias humano encantamento', { types: new Set(['Human']) }).f, { type: 'Creature', legendary: true, sub: 'Human', types2: ['Enchantment'] })
  assert.deepEqual(P('enchantment creature').f, { type: 'Enchantment', types2: ['Creature'] })
  { const { passes } = await import('./src/data.js'), C = t => ({ t, o: '', mt: t.includes('Creature') ? 'Creature' : 'Enchantment', co: 'W', ci: 'W', tg: [], lg: 1, un: 0 }), f = { type: 'Creature', types2: ['Enchantment'] }, ctx = { bit: 0, identity: null }
    assert.ok(passes(C('Legendary Enchantment Creature — God'), f, ctx) && !passes(C('Legendary Creature — Human // Legendary Enchantment Creature'.replace('Enchantment Creature', 'Enchantment — Saga')), f, ctx)) }
  console.log('selfcheck pesquisa por frases ok') }
{ const src = readFileSync(new URL('./src/App.jsx', import.meta.url), 'utf8')  // básicos novos com arte favorita ao acaso; tirar encolhe a divisão
  const i0 = src.indexOf('function withBasicArt'), body = src.slice(i0, src.indexOf('\n}\n', i0) + 2)
  const { setBasicDefaults } = await import('./src/data.js')
  setBasicDefaults({ Plains: [{ id: 'a' }, { id: 'b' }] })
  const BASICS = ['Plains'], basicList = n => (n === 'Plains' ? [{ id: 'a' }, { id: 'b' }] : [])
  const w = new Function('BASICS', 'basicList', body + '; return withBasicArt')(BASICS, basicList)
  let d = { main: { Plains: 3 }, side: {} }
  d = w(d, 'Plains', 3); assert.equal(d.split.Plains.reduce((a, x) => a + x.q, 0), 3); assert.ok(d.split.Plains.every(x => ['a', 'b'].includes(x.id)))
  d = w({ ...d, main: { Plains: 1 } }, 'Plains', -2); assert.equal(d.split.Plains.reduce((a, x) => a + x.q, 0), 1)
  assert.equal(w({ main: { Plains: 1 }, side: {}, prints: { Plains: { id: 'z' } } }, 'Plains', 1).split, undefined)
  setBasicDefaults({})
  console.log('selfcheck básicos favoritos ok') }
{ const { landOdds } = await import('./src/deck.js')  // probabilidades de terrenos: 60 cartas com 24 terrenos
  const o = landOdds(60, 24)
  assert.ok(Math.abs(o.hist.reduce((a, b) => a + b, 0) - 1) < 1e-9)
  assert.ok(Math.abs(o.hist[3] - 0.3087) < 0.001, String(o.hist[3]))  // C(24,3)·C(36,4)/C(60,7)
  assert.ok(o.keep > 0.75 && o.keep < 0.8 && o.t3 > o.t4)
  assert.equal(landOdds(5, 2).keep, 0)
  console.log('selfcheck probabilidades de terrenos ok') }
{ const { layout, guides, pageOps, pdf, PRINT0 } = await import('./src/printpdf.js')  // proxies em PDF: grelha, bleed, guias, verso
  const o = { ...PRINT0, paper: 'A4', card: [63, 88], gap: [2.8, 2.8], bleed: 10, customMargins: true, margins: [10, 10, 10, 10] }
  const L = layout(o)
  assert.equal(L.cols, 2); assert.equal(L.rows, 3)  // 2×63+2,8 cabe em 190; 3×88+2×2,8 = 269,6 cabe em 277
  const k = L.cells[0], k1 = L.cells[1]
  assert.ok(Math.abs(k1.x - k.x - 65.8) < 1e-9 && Math.abs(k.clip[2] - (k.x + 63 + 1.4)) < 1e-9)  // entre cartas: metade do espaço
  assert.ok(Math.abs(k.x - k.clip[0] - 10) < 1e-9)  // por fora: o bleed inteiro (cabe na margem)
  assert.equal(guides(L, 'lines', true).length, 4 + 6); assert.equal(guides(L, 'lines', false).length, 3 + 4)
  assert.ok(guides(L, 'corners').length > 0 && guides(L, 'none').length === 0)
  assert.equal(layout({ ...PRINT0, card: [300, 400] }).per, 0)
  const ops = pageOps(L, { ...o, duplex: true }, Array(7).fill('x'), () => 0)
  assert.equal(ops.length, 4)  // 7 cartas, 6 por página → 2 folhas, frente e verso
  const bytes = pdf(L.W, L.H, ops, [{ w: 1, h: 1, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }]), txt = new TextDecoder('latin1').decode(bytes)
  assert.ok(txt.startsWith('%PDF-1.4') && txt.includes('/Count 4') && txt.trim().endsWith('%%EOF'))
  const xref = +txt.match(/startxref\n(\d+)/)[1]; assert.equal(txt.slice(xref, xref + 4), 'xref')
  const off = [...txt.matchAll(/(\d{10}) 00000 n/g)].map(m => +m[1]); assert.ok(off.every((v, i) => txt.slice(v).startsWith(`${i + 1} 0 obj`)))
  console.log('selfcheck proxies PDF ok') }
{ const { winLose } = await import('./src/winlose.js')  // como ganha e como perde: regras simples, à escala de 60 cartas
  const C = (n, t, o, extra = {}) => ({ n, t, o, mt: t.split(' ')[0], tg: [], kw: [], ci: '', cmc: 2, pt: '', i: 0, ...extra })
  const cards = [C('Bear', 'Creature — Bear', '', { pt: '2/2' }), C('Plains', 'Land', '')]
  const data = { byName: new Map(cards.map(c => [c.n, c])), cards, combosByCard: [[], []], combos: [] }
  const r = winLose(data, { main: { Bear: 20, Plains: 40 }, side: {}, commanders: [] }, { side: 15 }, {})
  assert.ok(r.wins.some(w => w.why.includes('20')) && r.risks.some(x => x.key === 'wipe') && r.risks.some(x => x.key === 'creatures'))
  assert.equal(r.side.verdict, 'vazio')
  console.log('selfcheck como ganha e perde ok') }
{ const { replayStates } = await import('./src/game.js')  // pilha: o que não resolve sai depois de uma fase inteira e na mudança de turno
  const ev = [{ t: 1, k: 'turn', p: 'a' }, { t: 1, k: 'trigger', p: 'a', card: 'Solitude' }, { t: 1, k: 'phase', p: 'a', ph: 'main1' }]
  let S = replayStates(ev, { byName: new Map(), byLower: new Map() })
  assert.equal(S[S.length - 1].stack.length, 1)  // um passo de folga (o registo às vezes chega atrasado)
  S = replayStates([...ev, { t: 1, k: 'phase', p: 'a', ph: 'combat' }], { byName: new Map(), byLower: new Map() })
  assert.equal(S[S.length - 1].stack.length, 0)
  S = replayStates([...ev, { t: 2, k: 'turn', p: 'b' }], { byName: new Map(), byLower: new Map() })
  assert.equal(S[S.length - 1].stack.length, 0)
  console.log('selfcheck pilha sem cartas presas ok') }
{ const { passes } = await import('./src/data.js')  // terrenos: a cor do filtro é a mana que dão
  const L = (n, o, t = 'Land') => ({ n, o, t, mt: 'Land', co: '', ci: '', tg: [], lg: 1, un: 0 })
  const ctx = { bit: 0, identity: null }, f = cs => ({ colors: cs, colorMode: 'incl' })
  const fountain = L('Hallowed Fountain', '({T}: Add {W} or {U}.)', 'Land — Plains Island'), tower = L('Reliquary Tower', '{T}: Add {C}.')
  assert.ok(passes(fountain, f(['U']), ctx) && !passes(fountain, f(['G']), ctx))
  assert.ok(passes(fountain, { colors: ['W', 'U'], colorMode: 'exact' }, ctx) && passes(tower, { colorless: true }, ctx) && !passes(fountain, { colorless: true }, ctx))
  console.log('selfcheck cor dos terrenos ok') }
{ const { markDormant, isCreature } = await import('./src/game.js')  // deuses de Theros: só são criaturas com devoção suficiente
  const cards = [{ n: 'Thassa, God of the Sea', mc: '{2}{U}', t: 'Legendary Enchantment Creature — God', o: "Indestructible\nAs long as your devotion to blue is less than five, Thassa isn't a creature." },
    { n: 'Tide', mc: '{U}{U}', t: 'Creature — Merfolk', o: '' }, { n: 'Hybrid', mc: '{U/B}{U/B}', t: 'Creature — Rogue', o: '' }]
  const data = { byName: new Map(cards.map(c => [c.n, c])), byLower: new Map(cards.map(c => [c.n.toLowerCase(), c])) }
  const P = n => ({ key: n, name: n })
  const low = markDormant(data, [P('Thassa, God of the Sea'), P('Tide')])
  assert.ok(!isCreature(data, low[0]) && low[0].dormant.d === 3 && low[0].dormant.need === 5)
  const ok = markDormant(data, [P('Thassa, God of the Sea'), P('Tide'), P('Hybrid')])
  assert.ok(isCreature(data, ok[0]) && !ok[0].dormant)  // 1 + 2 + 2 (híbridos contam) = 5
  console.log('selfcheck deuses e devoção ok') }

// pesquisa sem acentos: «lorien» encontra «Lórien Revealed»
import { search as searchCards } from './src/data.js'
{
  const mk = n => ({ n, l: n.toLowerCase(), f: n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), o: '', t: 'Sorcery', tg: [], cmc: 5 })
  const d = { cards: [mk('Lórien Revealed'), mk('Lightning Bolt')] }
  assert.deepEqual(searchCards(d, 'Lorien rev', {}, { bit: -1 }).cards.map(c => c.n), ['Lórien Revealed'])
  assert.deepEqual(searchCards(d, 'lórien', {}, { bit: -1 }).cards.map(c => c.n), ['Lórien Revealed'])
  console.log('selfcheck pesquisa sem acentos ok')
}

// Path to Exile num jogo antigo (sem zonas do Forge): fica um terreno estimado do lado de quem perdeu a criatura
{
  const { replayStates: rs } = await import('./src/game.js')
  const d = { byName: new Map(), byLower: new Map() }
  const txt = 'Path to Exile (107) - Exile Fallaji Archaeologist (14). Ai(1)-A may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.'
  const old = rs([{ t: 3, k: 'resolve', p: 'b', card: 'Path to Exile', txt }], d)
  const land = old.at(-1).a.perms.find(x => x.land)
  assert.ok(land && land.est && land.hidden && land.tapped, 'terreno estimado do Path')
  const exact = rs([{ t: 3, k: 'resolve', p: 'b', card: 'Path to Exile', txt }], d, 20, null, true)
  assert.equal(exact.at(-1).a.perms.length, 0, 'jogo exato: o terreno vem pelas zonas, não se inventa')
  console.log('selfcheck Path to Exile em jogos antigos ok')
}

// terras que entram viradas: sempre (texto), fast land com mais de 2 terras, shock land paga (perdeu 2 de vida) desvirada
{
  const { replayStates: rs } = await import('./src/game.js')
  const L = (n, o) => ({ n, l: n.toLowerCase(), t: 'Land', o, tg: [] })
  const cs = [L('Tap Land', 'This land enters tapped.\n{T}: Add {W}.'), L('Fast Land', 'This land enters tapped unless you control two or fewer other lands.'),
    L('Shock Land', "As this land enters, you may pay 2 life. If you don't, it enters tapped."), L('Plains', '')]
  const d = { byName: new Map(cs.map(c => [c.n, c])), byLower: new Map(cs.map(c => [c.l, c])) }
  const z = (id, card) => ({ t: 1, k: 'land', p: 'a', card, id, zn: [{ id, card, from: 'hand', to: 'battlefield', fp: 'a', tp: 'a' }] })
  const ev = [z(1, 'Tap Land'), z(2, 'Plains'), z(3, 'Plains'), z(4, 'Fast Land'), { t: 1, k: 'life', p: 'a', n: 18 }, z(5, 'Shock Land'), z(6, 'Shock Land')]
  const st = rs(ev, d, 20, null, true).at(-1).a.perms, tp = id => st.find(p => p.fid === id)?.tapped
  assert.deepEqual([tp(1), tp(2), tp(4), tp(5), tp(6)], [true, false, true, false, true], 'terras que entram viradas')
  console.log('selfcheck terras que entram viradas ok')
}
// feitiço sem alvo («fizzles»: o alvo foi sacrificado em resposta): sai da pilha logo e vai para o cemitério
{
  const { replayStates: rs } = await import('./src/game.js')
  const d = { byName: new Map([['Path to Exile', { n: 'Path to Exile', t: 'Instant', o: '' }]]), byLower: new Map() }
  const ev = [{ t: 1, k: 'cast', p: 'a', card: 'Path to Exile', zn: [{ id: 9, card: 'Path to Exile', from: 'hand', to: 'stack', fp: 'a', tp: null }] },
    { t: 1, k: 'other', card: 'Path to Exile', txt: 'Path to Exile ability fizzles.' },
    { t: 1, k: 'zone', p: 'a', card: 'Path to Exile', id: 9, x: 1, zn: [{ id: 9, card: 'Path to Exile', from: 'stack', to: 'graveyard', fp: null, tp: 'a' }] }]
  const st = rs(ev, d, 20, null, true)
  assert.equal(st[2].stack.length, 0, 'sem alvo: sai da pilha')
  assert.deepEqual(st.at(-1).a.graveyard, ['Path to Exile'])
  console.log('selfcheck feitiço sem alvo ok')
}
// Análise › Cartas nos jogos: «jogada» = lançada ou posta em campo; ficar só na mão não conta
{
  const { gameEvidence } = await import('./src/swap.js')
  const cs = [{ n: 'Bolt', mt: 'Instant', t: 'Instant', o: '', cmc: 1, l: 'bolt', f: 'bolt' }, { n: 'Big', mt: 'Creature', t: 'Creature', o: '', cmc: 6, l: 'big', f: 'big' },
    { n: 'Plains', mt: 'Land', t: 'Basic Land — Plains', o: '', cmc: 0, l: 'plains', f: 'plains' }]
  const d = { byName: new Map(cs.map(c => [c.n, c])), byLower: new Map(cs.map(c => [c.l, c])) }
  const g = { winner: 'a', exact: true, events: [{ t: 1, k: 'turn', p: 'a', hd: { a: ['Bolt', 'Big', 'Plains'] } },
    { t: 1, k: 'land', p: 'a', card: 'Plains', zn: [{ id: 1, card: 'Plains', from: 'hand', to: 'battlefield', fp: 'a', tp: 'a' }] },
    { t: 1, k: 'cast', p: 'a', card: 'Bolt' }] }
  const ev = gameEvidence(d, [g])
  assert.deepEqual(['Bolt', 'Big', 'Plains'].map(n => [ev.cards[n].seen, ev.cards[n].played, ev.cards[n].playedW]), [[1, 1, 1], [1, 0, 0], [1, 1, 1]])
  console.log('selfcheck cartas jogadas ok')
}

// alcunhas dos ciclos de terrenos e básicos como cor dentro de uma frase
{
  const { parseQuery: pq } = await import('./src/nlsearch.js')
  const T = new Set()
  assert.deepEqual(pq('fetch land', { types: T }).f, { type: 'Land', oracle: ['pay 1 life, sacrifice', 'search your library'] })
  assert.deepEqual(pq('terrenos de choque', { types: T }).f.oracle, ['you may pay 2 life', 'enters tapped'])
  assert.deepEqual(pq('removal forest', { types: T }).f, { tags: ['removal'], colors: ['G'] })
  console.log('selfcheck ciclos de terrenos ok')
}
{ // Forge Play: «pagar sozinho» só quando há uma maneira óbvia de pagar
  const { obviousPay } = await import('./src/mana.js')
  const D = { Plains: { o: '({T}: Add {W}.)', t: 'Basic Land — Plains' }, Forest: { o: '({T}: Add {G}.)', t: 'Basic Land — Forest' }, 'Sol Ring': { o: '{T}: Add {C}{C}.', t: 'Artifact' }, 'Grizzly Bears': { o: '', t: 'Creature — Bear' } }
  const card = n => D[n], me = (...ns) => ({ mana: {}, battlefield: ns.map(n => ({ name: n, tapped: n.startsWith('~') ? true : undefined })).map(c => ({ ...c, name: c.name.replace('~', '') })) })
  assert.equal(obviousPay('Pay Mana Cost: {1}', me('Plains', 'Forest'), card), false, '{1} com Plains ou Forest: escolhes tu')
  assert.equal(obviousPay('Pay Mana Cost: {1}', me('Plains', 'Plains', 'Grizzly Bears'), card), true, 'só Plains: óbvio')
  assert.equal(obviousPay('Pay Mana Cost: {1}{W}', me('Plains', 'Forest'), card), true, 'usam-se as duas')
  assert.equal(obviousPay('Pay Mana Cost: {1}', me('Plains', '~Forest'), card), true, 'a Forest está virada')
  assert.equal(obviousPay('Pay Mana Cost: {2}', me('Sol Ring', 'Plains', 'Forest'), card), false, 'Sol Ring ou terrenos')
  assert.equal(obviousPay('Pay Mana Cost: {1}', { mana: { W: 1 }, battlefield: [{ name: 'Plains' }] }, card), false, 'mana na reserva: escolhes tu')
  assert.equal(obviousPay('Pay Mana Cost: {W}', me('Plains', 'Forest'), card), true, '{W}: só a Plains serve')
  assert.equal(obviousPay('Pay Mana Cost: {W}', me('Plains', 'Savannah'), n => n === 'Savannah' ? { o: '({T}: Add {G} or {W}.)', t: 'Land — Forest Plains' } : D[n]), false, '{W}: Plains ou um terreno duplo')
  console.log('selfcheck pagar sozinho ok')
}
{ // Two-Headed Giant: turnos da equipa (os parceiros seguidos contam como um) e veneno partilhado
  const { giantTurns, replayStates: rs } = await import('./src/game.js')
  const teams = { a: 1, b: 1, c: 2, d: 2 }
  const E = [{ t: 1, k: 'turn', p: 'b' }, { t: 1, k: 'draw', p: 'b', id: 5, x: 1 }, { t: 1, k: 'phase', p: 'b', ph: 'main1' }, { t: 1, k: 'zone', p: 'b', id: 5, x: 1, target: 'hand>library' }, { t: 2, k: 'turn', p: 'c' }, { t: 2, k: 'life', p: 'a', n: 28 }, { t: 2, k: 'life', p: 'b', n: 28 },
    { t: 3, k: 'turn', p: 'd' }, { t: 3, k: 'poison', p: 'd', target: 'a', n: 3 }, { t: 4, k: 'turn', p: 'a' }, { t: 5, k: 'turn', p: 'b' }]
  const g = giantTurns({ mode: '2hg', teams, turns: 5, events: E })
  assert.deepEqual(g.events.filter(e => e.k === 'turn').map(e => e.t), [1, 2, 2, 3, 3], 'b | c d | a b')
  assert.equal(g.turns, 3)
  assert.deepEqual(g.events.map(e => e.tm || 0), [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0], 'a vida repetida no parceiro e a compra desfeita não vão para o registo')
  assert.equal(g.events[3].k, 'nodraw', 'a equipa que começa não compra')
  assert.equal(giantTurns({ mode: 'equipas', teams, events: E }).events, E, 'só no 2HG')
  const sides = { a: { size: 60 }, b: { size: 60 }, c: { size: 60 }, d: { size: 60 } }
  const st = rs(g.events, { byName: new Map(), byLower: new Map() }, 30, sides, true, teams).at(-1)
  assert.deepEqual(['a', 'b', 'c', 'd'].map(k => st[k].poison), [3, 3, 0, 0], 'o veneno é da equipa')
  assert.deepEqual(['a', 'b', 'c', 'd'].map(k => st[k].life), [28, 28, 30, 30])
  console.log('selfcheck two-headed giant ok')
}
