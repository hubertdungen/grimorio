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
// Combos: 2 peças num deck de 99 até ao turno 8 (14 cartas vistas, a jogar primeiro) ≈ 2%; com 5 tutores sobe bastante; comandante já é peça.
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
import { replayStates, powTough, staticPump, spellFx } from './src/game.js'
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
// 💪 Reforçar o deck (reinforce.js): por função, cartas novas da função e na identidade; a que sai nunca é o comandante nem
// tira uma função que está no alvo ou abaixo; com jogos gravados, quem ganha menos quando aparece sai primeiro.
{ const { prepData } = await import('./src/data.js')
  const { cutQueue, reinforcePlan, roleState } = await import('./src/reinforce.js')
  const all = (1 << F.length) - 1
  const K = (n, t, o, mc, ci, extra = {}) => ({ n, t, o, mc, cmc: (+(mc.match(/\{(\d+)\}/)?.[1] || 0)) + (mc.match(/\{[WUBRGC]\}/g) || []).length, ci, co: ci, lg: all, rs: 0, r: 'c', kw: [], pt: '', er: 5000, tg: [], ...extra })
  const cre = (n, ci, o = '') => K(n, 'Creature — Rat', o, `{2}{${ci}}`, ci, { pt: '2/2' })
  const cards = [
    K('Cap Dimir', 'Legendary Creature — Human Rogue', 'Whenever you cast a spell, draw a card.', '{1}{U}{B}', 'UB', { pt: '2/3' }),
    K('Old Murder', 'Instant', 'Destroy target creature.', '{2}{B}', 'B', { tg: ['removal'] }),
    K('Fresh Murder', 'Instant', 'Destroy target creature.', '{1}{B}', 'B', { er: 200, tg: ['removal'] }),
    K('Blue Exile', 'Instant', 'Exile target creature.', '{1}{U}', 'U', { er: 300, tg: ['removal'] }),
    K('Red Burn', 'Instant', 'Destroy target creature.', '{R}', 'R', { er: 10, tg: ['removal'] }),
    K('Big Draw', 'Sorcery', 'Draw three cards.', '{2}{U}', 'U', { tg: ['draw'] }), K('Small Draw', 'Sorcery', 'Draw two cards.', '{1}{U}', 'U', { tg: ['draw'] }),
    ...'ABCDEFGH'.split('').map(x => cre(`Filler ${x}`, x < 'E' ? 'U' : 'B')),
    K('Island', 'Basic Land — Island', '({T}: Add {U}.)', '', 'U', { tg: ['land'] }), K('Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)', '', 'B', { tg: ['land'] }),
  ]
  const D = 8, emb = new Int8Array(cards.length * D)
  let sd = 11
  for (let k = 0; k < emb.length; k++) emb[k] = ((sd = (sd * 16807) % 2147483647) % 200) - 100
  const sdata = prepData({ formats: F, dim: D }, cards, [], emb.buffer, new Float32Array(cards.length * 2).buffer)
  const by = n => sdata.byName.get(n)
  assert.ok(by('Fresh Murder').tg.includes('removal') && by('Big Draw').tg.includes('draw'), JSON.stringify([by('Fresh Murder').tg, by('Big Draw').tg]))
  const deck = { ...emptyDeck('commander'), commanders: ['Cap Dimir'], main: { 'Old Murder': 1, 'Big Draw': 1, 'Small Draw': 1, ...Object.fromEntries('ABCDEFGH'.split('').map(x => [`Filler ${x}`, 1])), Island: 20, Swamp: 20 } }
  const fmt = FORMAT.commander, cmdIdx = [by('Cap Dimir').i]
  const have = [...deck.commanders, ...Object.keys(deck.main)].map(n => by(n).i)
  const needs = { removal: [1, 8], draw: [2, 2] }  // compra no alvo: as cartas de compra não saem
  const tags = { removal: 1, draw: 2, creature: 9 }, N = { lands: 40, target: 37, cols: { U: { have: 20, need: 15, full: 19 }, B: { have: 20, need: 15, full: 19 } } }
  const ev = { exact: 8, winsExact: 4, dead: {}, impact: {}, cats: {}, cards: { 'Filler A': { seen: 6, seenW: 0 }, 'Filler H': { seen: 6, seenW: 6 } } }
  const mk = tests => ({ bit: -1, allowUn: true, identity: 'UB', tests })
  const rq = c => ({ seeds: have.filter(i => sdata.cards[i].mt !== 'Land'), seedTerms: [], have, ctx: c, commanders: cmdIdx, needs, deckSize: 99, turn: 8 })
  const plan = reinforcePlan(sdata, deck, fmt, { roles: ['removal'], rq: rq(mk(ev)), N, needs, tags, ctx: mk(ev), commanders: cmdIdx })
  const rows = plan[0].rows
  assert.ok(rows.length >= 2, JSON.stringify(rows.map(r => r.add.c.n)))
  for (const r of rows) {
    assert.ok(r.add.c.tg.includes('removal') && [...r.add.c.ci].every(k => 'UB'.includes(k)) && !deck.main[r.add.c.n], `fora da função/identidade: ${r.add.c.n}`)
    assert.ok(r.cut && r.cut.c.n !== 'Cap Dimir' && !r.cut.c.tg.includes('draw') && !r.cut.c.tg.includes('removal'), `corte proibido: ${r.cut?.c.n}`)
  }
  assert.ok(!rows.some(r => r.add.c.n === 'Red Burn'), 'Red Burn é vermelha: fora da identidade UB')
  // sem outras cartas para sair, as de compra no alvo continuam protegidas: a linha só aparece se o deck tiver lugar
  const tiny = { ...deck, main: { 'Big Draw': 1, 'Small Draw': 1, Island: 97 } }
  assert.ok(reinforcePlan(sdata, tiny, fmt, { roles: ['removal'], rq: rq(mk(null)), N, needs, tags, ctx: mk(null), commanders: cmdIdx }).every(g => g.rows.every(r => !r.cut || r.cut.c.n !== 'Cap Dimir')))
  // histórico: a Filler A (0 de 6 jogos ganhos quando apareceu) sai antes da Filler H (6 de 6), e mais cedo do que sem jogos
  const Q0 = cutQueue(sdata, deck, { ctx: mk(null), commanders: cmdIdx, needs }), q0 = Q0.map(x => x.c.n), q1 = cutQueue(sdata, deck, { ctx: mk(ev), commanders: cmdIdx, needs })
  const n1 = q1.map(x => x.c.n), sc = (q, n) => q.find(x => x.c.n === n).score
  assert.ok(n1.indexOf('Filler A') < n1.indexOf('Filler H'), n1.join())
  assert.ok(n1.indexOf('Filler A') <= q0.indexOf('Filler A') && n1.indexOf('Filler H') >= q0.indexOf('Filler H'), `${q0} → ${n1}`)
  assert.ok(sc(q1, 'Filler A') < sc(Q0, 'Filler A') - 0.2 && sc(q1, 'Filler H') > sc(Q0, 'Filler H') + 0.2, 'o histórico pesa no corte')
  assert.ok(n1[0] === 'Filler A', `a que perde sempre sai primeiro: ${n1}`)
  assert.match(q1.find(x => x.c.n === 'Filler A').why[0], /ganhou \d+% menos quando apareceu \(0 de 6 jogos\)/)
  assert.ok(!n1.includes('Cap Dimir'))
  // tem/alvo: terrenos pelo manaNeeds; abaixo do alvo fica marcado
  const rs = roleState(tags, needs, N, fmt)
  assert.deepEqual(['removal', 'draw', 'land'].map(t => { const x = rs.find(y => y.t === t); return [x.have, x.target, x.low] }), [[1, 8, true], [2, 2, false], [40, 37, false]])
  // 60 cartas: cópias até ao que falta para o alvo e nunca mais do que as da carta que sai
  const d60 = { ...emptyDeck('modern'), main: { 'Old Murder': 2, 'Big Draw': 4, ...Object.fromEntries('ABCDEFGH'.split('').map(x => [`Filler ${x}`, 4])), Island: 11, Swamp: 11 } }
  const h60 = Object.keys(d60.main).map(n => by(n).i), n60 = { removal: [2, 6], draw: [4, 4] }
  const p60 = reinforcePlan(sdata, d60, FORMAT.modern, { roles: ['removal'], rq: { ...rq(mk(null)), have: h60, seeds: h60.filter(i => sdata.cards[i].mt !== 'Land'), commanders: [], needs: n60 }, N, needs: n60, tags: { removal: 2, draw: 4 }, ctx: mk(null) })
  assert.ok(p60[0].rows.length && p60[0].rows.every(r => r.q >= 1 && r.q <= 4 && r.q <= d60.main[r.cut.c.n] && r.cut.c.n !== 'Big Draw'), JSON.stringify(p60[0].rows.map(r => [r.add.c.n, r.q, r.cut?.c.n])))
  assert.equal(p60[0].rows[0].q, 4, 'faltam 4 remoções: entram 4 cópias da primeira')
  console.log('selfcheck reforçar o deck (função e identidade, cortes protegidos, histórico dos testes, cópias) ok')
}
// Subcomandantes e comandantes «em ideia»: trocar de comandante (o que sai fica no deck marcado, ou no maybeboard se não
// couber na nova identidade), trocar um de um par Partner/Background, e o peso leve nas sugestões sem mexer na legalidade.
{ const { prepData, recommend, passes } = await import('./src/data.js')
  const { swapCommander, ideaSeeds, subsOf, pairOk } = await import('./src/formats.js')
  const all = (1 << F.length) - 1
  const K = (n, t, o, ci, extra = {}) => ({ n, t, o, mc: `{${ci[0] || 1}}`, cmc: 1, ci, co: ci, lg: all, rs: 0, r: 'r', kw: [], pt: '', er: 5000, tg: [], ...extra })
  const cards = [
    K('Gold Lord', 'Legendary Creature — Human', '', 'WU'), K('Blue Lord', 'Legendary Creature — Merfolk', '', 'U'),
    K('Red Lord', 'Legendary Creature — Goblin', '', 'R'), K('Pal A', 'Legendary Creature — Elf', 'Partner', 'G'),
    K('Pal B', 'Legendary Creature — Elf', 'Partner', 'B'), K('Pal C', 'Legendary Creature — Elf', 'Partner', 'G'),
    K('Bg Lover', 'Legendary Creature — Human', 'Choose a Background', 'W'), K('Bg One', 'Legendary Enchantment — Background', 'Commander creatures you own have flying.', 'W'),
    K('Bg Two', 'Legendary Enchantment — Background', 'Commander creatures you own have vigilance.', 'B'),
    K('White Spell', 'Instant', 'Draw a card.', 'W'), K('Blue Spell', 'Instant', 'Draw a card.', 'U'), K('Red Spell', 'Instant', 'Draw a card.', 'R'),
    K('Plains', 'Basic Land — Plains', '', 'W', { tg: ['land'] }),
  ]
  const D = 8, emb = new Int8Array(cards.length * D)
  for (let i = 0; i < cards.length; i++) for (let k = 0; k < D; k++) emb[i * D + k] = 20 + ((i * 7 + k * 13) % 40)
  const RS = cards.findIndex(c => c.n === 'Red Spell'), RL = cards.findIndex(c => c.n === 'Red Lord')
  for (let k = 0; k < D; k++) { emb[RS * D + k] = k % 2 ? 100 : -100; emb[RL * D + k] = k % 2 ? 100 : -100 }  // Red Spell só combina com Red Lord
  const sd = prepData({ formats: F, dim: D }, cards, [], emb.buffer, new Float32Array(cards.length * 2).buffer)
  const base = { ...emptyDeck('commander'), commanders: ['Gold Lord'], main: { 'Blue Lord': 1, 'White Spell': 1, 'Blue Spell': 1, Plains: 30 }, maybe: { 'Red Lord': 1 }, subs: ['Blue Lord'] }
  // Blue Lord (U) passa a comandante; Gold Lord (WU) não cabe em U: vai para o maybeboard; White Spell fica fora da identidade
  let r = swapCommander(base, sd, 'Blue Lord')
  assert.deepEqual(r.deck.commanders, ['Blue Lord'])
  assert.ok(!r.deck.main['Blue Lord'] && !r.deck.main['Gold Lord'] && r.deck.maybe['Gold Lord'] === 1 && r.deck.maybe['Red Lord'] === 1)
  assert.deepEqual([r.toMaybe, r.off, r.deck.subs], [['Gold Lord'], ['White Spell', 'Plains'], []])
  // e de volta: Gold Lord (do maybeboard) a comandante, Blue Lord cabe em WU e fica como subcomandante; o total do deck mantém-se
  r = swapCommander(r.deck, sd, 'Gold Lord')
  assert.deepEqual([r.deck.commanders, r.deck.subs, r.deck.main['Blue Lord'], r.deck.maybe['Gold Lord'], r.off], [['Gold Lord'], ['Blue Lord'], 1, undefined, []])
  assert.equal(Object.values(r.deck.main).reduce((a, b) => a + b, 0) + r.deck.commanders.length, Object.values(base.main).reduce((a, b) => a + b, 0) + 1)
  assert.ok(!validate(r.deck, FORMAT.commander, sd).some(i => /identidade|cópias/.test(i.msg)))
  assert.deepEqual(swapCommander(r.deck, sd, 'Gold Lord').deck, r.deck)  // já é o comandante: nada muda
  // par Partner: Pal C troca com um dos dois (o escolhido, ou sem escolha o segundo) e o outro fica
  const pals = { ...emptyDeck('commander'), commanders: ['Pal A', 'Pal B'], main: { 'Pal C': 1 }, subs: ['Pal C'] }
  assert.ok(pairOk(sd.byName.get('Pal A'), sd.byName.get('Pal C')))
  r = swapCommander(pals, sd, 'Pal C', 'Pal A')
  assert.deepEqual([r.deck.commanders, r.deck.subs, r.toMaybe], [['Pal B', 'Pal C'], ['Pal A'], []])
  r = swapCommander(pals, sd, 'Pal C')
  assert.deepEqual([r.deck.commanders, r.toMaybe], [['Pal A', 'Pal C'], ['Pal B']])  // Pal B (preto) não cabe em GG: maybeboard
  // Background: troca-se o Background e o comandante que o escolhe fica
  r = swapCommander({ ...emptyDeck('commander'), commanders: ['Bg Lover', 'Bg One'], main: { 'Bg Two': 1 } }, sd, 'Bg Two')
  assert.deepEqual([r.deck.commanders, r.deck.maybe['Bg One'] ?? r.deck.main['Bg One']], [['Bg Lover', 'Bg Two'], 1])
  // sem par possível com o que fica (Red Lord num par Partner): saem os dois
  r = swapCommander(pals, sd, 'Red Lord')
  assert.deepEqual([r.deck.commanders, r.toMaybe.sort()], [['Red Lord'], ['Pal A', 'Pal B']])
  // a marca só vale enquanto a carta está no deck
  assert.deepEqual(subsOf({ main: { X: 1 }, subs: ['X', 'Y'] }), ['X'])
  // sugestões: o maybe-comandante vermelho (fora da identidade WU) não traz cartas vermelhas; dentro dela, empurra pouco
  const deck = { ...base, subs: [] }, ctx = { bit: -1, allowUn: true, identity: 'WU' }
  const ideas = ideaSeeds(deck, sd, FORMAT.commander)
  assert.deepEqual(ideas.map(x => [sd.cards[x.i].n, x.w]), [['Red Lord', 0.15]])  // Blue Lord está no deck sem marca: não é ideia
  assert.deepEqual(ideaSeeds(base, sd, FORMAT.commander).map(x => x.w), [0.25, 0.15])  // marcado: pesa mais do que o maybeboard
  assert.deepEqual(ideaSeeds(base, sd, FORMAT.modern), [])
  const have = [...base.commanders, ...Object.keys(base.main)].map(n => sd.byName.get(n).i)
  const go = ideas => recommend(sd, { seeds: have.filter(i => sd.cards[i].mt !== 'Land'), have, ctx, filters: null, limit: 40, commanders: [sd.byName.get('Gold Lord').i], ideas })
  const plain = go([]), withIdeas = go(ideaSeeds(base, sd, FORMAT.commander))
  assert.ok(withIdeas.every(x => passes(x.c, null, ctx)) && !withIdeas.some(x => x.c.n === 'Red Spell'), withIdeas.map(x => x.c.n).join())
  assert.deepEqual(withIdeas.map(x => x.c.n).sort(), plain.map(x => x.c.n).sort())  // as mesmas cartas legais: só a ordem/pontos mudam
  assert.ok(withIdeas.some(x => x.parts.ideia > 0))
  for (const x of withIdeas) assert.ok((x.parts.ideia || 0) <= 0.25 * 0.25 + 1e-9 && (x.parts.ideia || 0) <= (x.parts.comandante || 0) + 0.25 * 0.25)
  console.log('selfcheck subcomandantes ok') }
// Sugestões pelo plano do deck (synergy.js deckThemes): num deck de encantamentos (constelação/enchantress) um encantamento
// sobe e um artefacto sem sinergia desce com «Fora do plano»; num deck de artefactos é ao contrário; uma lacuna de remoção e
// a peça que fecha um combo passam mesmo fora do tipo do deck. Embeddings iguais: o texto parecido não decide nada.
{ const { prepData, recommend } = await import('./src/data.js')
  const all = (1 << F.length) - 1
  const K = (n, t, o, mc, ci, extra = {}) => ({ n, t, o, mc, cmc: (+(mc.match(/\{(\d+)\}/)?.[1] || 0)) + (mc.match(/\{[WUBRGC]\}/g) || []).length, ci, co: ci, lg: all, rs: 0, r: 'c', kw: [], pt: '', er: 5000, tg: [], ...extra })
  const ec = (n, o = '') => K(n, 'Enchantment Creature — Spirit', o, '{1}{G}', 'G', { pt: '2/2' })
  const ac = (n, o = '') => K(n, 'Artifact Creature — Golem', o, '{2}', '', { pt: '2/2' })
  const cards = [
    ...[1, 2, 3, 4, 5, 6].map(k => ec(`Nymph ${k}`)),
    K('Enchantress A', 'Enchantment Creature — Human', 'Whenever you cast an enchantment spell, draw a card.', '{G}', 'G', { pt: '0/1' }),
    K('Enchantress B', 'Enchantment Creature — Nymph', 'Constellation — Whenever an enchantment you control enters, you gain 1 life.', '{1}{G}', 'G', { pt: '1/3' }),
    K('Aura One', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control.', '{G}', 'G'),
    ...[1, 2, 3, 4, 5, 6].map(k => ac(`Golem ${k}`)),
    K('Foundry', 'Artifact Creature — Construct', 'This creature gets +1/+1 for each artifact you control.', '{2}', '', { pt: '0/0' }),
    K('Workshop', 'Artifact', 'Whenever an artifact you control enters, scry 1.', '{1}', ''),
    K('Candidate Ench', 'Enchantment Creature — Spirit', 'Vigilance', '{1}{G}', 'G', { pt: '2/2' }),
    K('Candidate Art', 'Artifact Creature — Golem', 'Vigilance', '{2}', '', { pt: '2/2' }),
    K('Candidate Kill', 'Instant', 'Destroy target creature.', '{G}', 'G', { tg: ['removal'] }),
    K('Combo Piece', 'Artifact', 'Untap target creature.', '{1}', ''),
    K('Forest', 'Basic Land — Forest', '({T}: Add {G}.)', '', 'G', { tg: ['land'] }),
  ]
  const D = 8, emb = new Int8Array(cards.length * D).fill(50)
  const iOf = n => cards.findIndex(c => c.n === n)
  const combos = [['cx', [iOf('Nymph 1'), iOf('Combo Piece')], ['Infinite mana'], [], 0, 900]]
  const sd = prepData({ formats: F, dim: D }, cards, combos, emb.buffer, new Float32Array(cards.length * 2).buffer)
  const ctx = { bit: -1, allowUn: true, identity: null }
  const run = (main, needs = {}) => {
    const have = Object.keys(main).map(n => sd.byName.get(n).i)
    const recs = recommend(sd, { seeds: have.filter(i => sd.cards[i].mt !== 'Land'), have, ctx, filters: null, limit: 40, deckSize: 60, turn: 6, needs })
    return { recs, rank: n => recs.findIndex(r => r.c.n === n), r: n => recs.find(r => r.c.n === n) }
  }
  const ench = run({ ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(k => [`Nymph ${k}`, 4])), 'Enchantress A': 4, 'Enchantress B': 4, 'Aura One': 4, Forest: 20 }, { removal: [0, 6] })
  assert.ok(ench.rank('Candidate Ench') >= 0 && ench.rank('Candidate Ench') < ench.rank('Candidate Art'), ench.recs.map(r => r.c.n).join())
  assert.ok(ench.r('Candidate Ench').why.some(w => /^Dispara \d+ cartas tuas/.test(w.txt)), JSON.stringify(ench.r('Candidate Ench').why))
  assert.ok(ench.r('Candidate Art').why.some(w => /Fora do plano/.test(w.txt)))
  assert.ok(ench.rank('Workshop') > ench.rank('Candidate Ench'))  // payoff de artefactos num deck sem artefactos
  assert.ok(ench.r('Candidate Kill').why.some(w => /Lacuna — remoção: o deck tem 0 de 6; esta é instantânea e barata/.test(w.txt)), JSON.stringify(ench.r('Candidate Kill').why))
  assert.ok(ench.rank('Candidate Kill') < ench.rank('Candidate Art'))
  const cp = ench.r('Combo Piece')  // artefacto, mas fecha um combo com Nymph 1: passa, com o combo como motivo
  assert.ok(cp.why[0].k === 'combo' && !cp.why.some(w => /Fora do plano/.test(w.txt)) && ench.rank('Combo Piece') < ench.rank('Candidate Art'))
  const art = run({ ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(k => [`Golem ${k}`, 4])), Foundry: 4, Workshop: 4, Forest: 20 })
  assert.ok(art.rank('Candidate Art') >= 0 && art.rank('Candidate Art') < art.rank('Candidate Ench'), art.recs.map(r => r.c.n).join())
  console.log('selfcheck sugestões pelo plano ok') }
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
{ // pesquisa «contra X» (src/hate.js): as frases nas 5 línguas dão a ameaça certa, e as cartas certas respondem-lhe
  const { parseQuery: P } = await import('./src/nlsearch.js'), { hateMatch: H, hateScore } = await import('./src/hate.js')
  const vs = q => P(q)?.f.vs
  const PH = {
    enchantment: ['anti encantamentos', 'resposta a encantamentos', 'remoção de encantamentos', 'anti-enchantments', 'enchantment removal', 'counters for enchantments', 'contra encantamientos', 'respuestas a encantamientos', 'gegen Verzauberungen', 'Verzauberungsentfernung', '反附魔', '对抗结界'],
    artifact: ['bom contra artefactos', 'artifact hate', 'answers to artifacts', 'contra artefactos', 'gegen Artefakte', '反神器'],
    planeswalker: ['contra planeswalkers', 'good against planeswalkers', 'bueno contra planeswalkers', 'gut gegen Planeswalker', '对抗旅法师', '针对鹏洛客'],
    graveyard: ['ódio a cemitério', 'hate de cemitério', 'contra reanimator', 'graveyard hate', 'odio al cementerio', 'Friedhofsschutz', 'gegen den Friedhof', '坟场仇恨', '反坟墓场'],
    mill: ['sideboard para mill', 'sideboard contra mill', 'contra o mill', 'mill sideboard', 'sideboard vs mill', 'antimill', 'sideboard gegen Mill', '对抗磨牌的备牌'],
    tokens: ['contra tokens', 'contra fichas', 'vs tokens', 'gegen Spielsteine', '反衍生物'],
    flyers: ['contra criaturas voadoras', 'answers to flyers', 'contra voladores', 'gegen Flieger', '对抗飞行生物'],
    combo: ['contra combo', 'anti-combo', 'contra storm', 'gegen Kombo', '反组合技'],
    control: ['contra controlo', 'contra contramágicas', 'anti-control', 'contra control', 'gegen Kontrolle', '反控制'],
    aggro: ['contra aggro', 'anti-aggro', 'contra agresivos', 'gegen Aggro', '对抗快攻'],
    burn: ['contra burn', 'contra dano direto', 'anti burn', '反直伤'], discard: ['contra descarte', 'vs discard', '反弃牌'],
    lifegain: ['contra ganho de vida', 'anti lifegain', '反获得生命'], ramp: ['contra ramp', 'vs nonbasic lands'], hexproof: ['contra hexproof', 'anti voltron', '反辟邪'],
  }
  for (const [t, qs] of Object.entries(PH)) for (const q of qs) assert.deepEqual(vs(q), [t], q)
  assert.deepEqual(vs('contra artefactos e encantamentos'), ['artifact', 'enchantment'])
  assert.deepEqual(P('anti enchantments white instant mv<=2').f, { vs: ['enchantment'], cmcMax: 2, colors: ['W'], type: 'Instant' })
  assert.deepEqual(P('sideboard contra mill em modern').f, { fmt: 'modern', vs: ['mill'] })
  assert.deepEqual(P('counterspell for enchantments').f, { vs: ['enchantment'], vsCtr: true, tags: ['counter'] })
  assert.equal(P('Lightning Bolt'), null); assert.equal(vs('criaturas voadoras'), undefined); assert.equal(vs('removal forest'), undefined)
  assert.ok(P('criaturas voadoras').f.oracle.includes('flying'))
  const C = (n, o, t = 'Instant', x = {}) => ({ n, o, t, cmc: 2, kw: [], tg: [], pt: '', ...x })
  const cards = {
    Disenchant: C('Disenchant', 'Destroy target artifact or enchantment.'), Naturalize: C('Naturalize', 'Destroy target artifact or enchantment.'),
    'Return to Nature': C('Return to Nature', 'Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Exile target card from a graveyard.'),
    'Rest in Peace': C('Rest in Peace', 'When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.', 'Enchantment'),
    'Relic of Progenitus': C('Relic of Progenitus', '{T}: Target player exiles a card from their graveyard.\n{1}, Exile this artifact: Exile all graveyards. Draw a card.', 'Artifact', { cmc: 1 }),
    'Leyline of the Void': C('Leyline of the Void', "If this card is in your opening hand, you may begin the game with it on the battlefield.\nIf a card would be put into an opponent's graveyard from anywhere, exile it instead.", 'Enchantment', { cmc: 4 }),
    'Elixir of Immortality': C('Elixir of Immortality', "{2}, {T}: You gain 5 life. Shuffle this artifact and your graveyard into their owner's library.", 'Artifact', { cmc: 1 }),
    "Gaea's Blessing": C("Gaea's Blessing", 'Target player shuffles up to three target cards from their graveyard into their library.\nDraw a card.\nWhen this card is put into your graveyard from your library, shuffle your graveyard into your library.', 'Sorcery'),
    "Hero's Downfall": C("Hero's Downfall", 'Destroy target creature or planeswalker.', 'Instant', { cmc: 3 }), 'Lightning Bolt': C('Lightning Bolt', 'Lightning Bolt deals 3 damage to any target.', 'Instant', { cmc: 1 }),
    Pyroclasm: C('Pyroclasm', 'Pyroclasm deals 2 damage to each creature.', 'Sorcery'), 'Wrath of God': C('Wrath of God', "Destroy all creatures. They can't be regenerated.", 'Sorcery', { cmc: 4 }),
    'Thalia, Guardian of Thraben': C('Thalia, Guardian of Thraben', 'First strike\nNoncreature spells cost {1} more to cast.', 'Legendary Creature — Human Soldier', { pt: '2/1', kw: ['First strike'] }),
    'Rule of Law': C('Rule of Law', "Each player can't cast more than one spell each turn.", 'Enchantment', { cmc: 3 }),
    'Mindbreak Trap': C('Mindbreak Trap', "If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell's mana cost.\nExile any number of target spells.", 'Instant — Trap', { cmc: 4 }),
    'Vexing Shusher': C('Vexing Shusher', "This spell can't be countered.\n{R/G}: Target spell can't be countered.", 'Creature — Goblin Shaman', { pt: '2/2' }),
    Plummet: C('Plummet', 'Destroy target creature with flying.'), Negate: C('Negate', 'Counter target noncreature spell.'), Counterspell: C('Counterspell', 'Counter target spell.'),
    'Sulfuric Vortex': C('Sulfuric Vortex', "At the beginning of each player's upkeep, this enchantment deals 2 damage to that player.\nIf a player would gain life, that player gains no life instead.", 'Enchantment', { cmc: 3 }),
    'Blood Moon': C('Blood Moon', 'Nonbasic lands are Mountains.', 'Enchantment', { cmc: 3 }), 'Diabolic Edict': C('Diabolic Edict', 'Target player sacrifices a creature of their choice.'),
    'Leyline of Sanctity': C('Leyline of Sanctity', 'If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can\'t be the target of spells or abilities your opponents control.)', 'Enchantment', { cmc: 4 }),
    'Grizzly Bears': C('Grizzly Bears', '', 'Creature — Bear', { pt: '2/2' }), 'Flicker of Fate': C('Flicker of Fate', "Exile target creature or enchantment, then return it to the battlefield under its owner's control."),
    'Crypt Incursion': C('Crypt Incursion', "Exile all creature cards from target player's graveyard. You gain 3 life for each card exiled this way.", 'Instant', { cmc: 3 }),
  }
  const yes = { enchantment: ['Disenchant', 'Naturalize', 'Return to Nature'], artifact: ['Disenchant', 'Return to Nature'], graveyard: ['Rest in Peace', 'Relic of Progenitus', 'Leyline of the Void', 'Crypt Incursion'],
    mill: ['Elixir of Immortality', "Gaea's Blessing"], planeswalker: ["Hero's Downfall", 'Lightning Bolt'], tokens: ['Pyroclasm', 'Wrath of God'], aggro: ['Pyroclasm', 'Wrath of God'],
    combo: ['Thalia, Guardian of Thraben', 'Rule of Law', 'Mindbreak Trap', 'Counterspell'], control: ['Vexing Shusher'], flyers: ['Plummet'], lifegain: ['Sulfuric Vortex'], ramp: ['Blood Moon'],
    hexproof: ['Diabolic Edict', 'Wrath of God'], burn: ['Leyline of Sanctity'] }
  const no = { enchantment: ['Grizzly Bears', 'Flicker of Fate', 'Lightning Bolt'], mill: ['Rest in Peace', 'Relic of Progenitus'], graveyard: ['Elixir of Immortality'], tokens: ['Grizzly Bears', 'Crypt Incursion'], control: ['Counterspell'], flyers: ['Lightning Bolt'] }
  for (const [t, ns] of Object.entries(yes)) for (const n of ns) assert.ok(H(cards[n], t), `${n} contra ${t}`)
  for (const [t, ns] of Object.entries(no)) for (const n of ns) assert.equal(H(cards[n], t), null, `${n} não é contra ${t}`)
  // as respostas diretas primeiro: Disenchant > Counterspell contra encantamentos; Hero's Downfall > Lightning Bolt contra planeswalkers
  assert.ok(hateScore(cards.Disenchant, ['enchantment']) > hateScore(cards.Counterspell, ['enchantment']))
  assert.ok(hateScore(cards["Hero's Downfall"], ['planeswalker']) > hateScore(cards['Lightning Bolt'], ['planeswalker']))
  assert.equal(H(cards.Disenchant, 'enchantment').why, 'destrói ou exila encantamentos'); assert.equal(H(cards['Rest in Peace'], 'graveyard').why, 'exila cemitérios')
  // «counterspell for enchantments»: só a maneira de anular (Negate sim, Disenchant não)
  assert.ok(H(cards.Negate, 'enchantment', true) && !H(cards.Disenchant, 'enchantment', true))
  { const { prepData, search } = await import('./src/data.js')  // na pesquisa: filtra e ordena (Disenchant antes do Counterspell)
    const d = prepData({ formats: [] }, Object.values(cards).map(c => ({ ...c, _hm: undefined, ci: '', co: '', lg: 0, un: 0, r: 'c', er: c.n === 'Counterspell' ? 1 : 100 })), [], new ArrayBuffer(0), new ArrayBuffer(0))
    const r = search(d, '', P('anti encantamentos').f, { bit: -1, identity: null })
    assert.equal(r.cards[0].n, 'Disenchant'); assert.ok(r.cards.some(c => c.n === 'Counterspell') && !r.cards.some(c => c.n === 'Grizzly Bears')) }
  console.log('selfcheck pesquisa «contra X» ok') }
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
{ const { packDecks, sheetLabels, tagRoom, pdfStr, layout, pageOps, PRINT0 } = await import('./src/printpdf.js')  // proxies de vários decks
  const A = { groups: [{ key: 'Bolt|', q: 4 }, { key: 'Sol|x', q: 1 }, { key: 'Bolt|', q: 1 }] }, B = { groups: [{ key: 'Bolt|', q: 3 }, { key: 'Rat|', q: 5 }] }
  let p = packDecks([A, B], 9)  // soma: 6 + 8 = 14 cartas seguidas em 2 folhas, sem casas vazias
  assert.equal(p.slots.length, 14); assert.ok(p.slots.every(Boolean)); assert.deepEqual(p.sheets, [[0, 1], [1]])
  p = packDecks([A, B], 9, { newSheet: true })  // B começa na 2.ª folha: 6 de A + 3 vazias
  assert.equal(p.slots.length, 17); assert.equal(p.slots.filter(x => !x).length, 3); assert.deepEqual(p.sheets, [[0], [1]])
  p = packDecks([A, B], 9, { share: true })  // Bolt: A usa 5 (4+1), B 3 → 5 no total, todos com A; Rat 5 com B
  const n = k => p.items.filter(it => it.g.key === k).reduce((a, it) => a + it.q, 0)
  assert.equal(n('Bolt|'), 5); assert.equal(n('Rat|'), 5); assert.equal(p.slots.length, 11)
  assert.ok(p.items.filter(it => it.g.key === 'Bolt|').every(it => it.deck === 0 && it.decks.join() === '0,1'))
  p = packDecks([B, A], 9, { share: true })  // ao contrário: B traz 3 Bolt e A só as 2 que faltam
  assert.deepEqual(p.items.filter(it => it.g.key === 'Bolt|').map(it => [it.deck, it.q]), [[0, 3], [1, 1], [1, 1]])
  assert.deepEqual(packDecks([{ groups: [{ key: 'a', q: 3 }] }], 0).sheets, [])  // a carta não cabe: sem folhas
  const L0 = layout(PRINT0), Lg = layout({ ...PRINT0, gap: [2.8, 2.8], bleed: 10, customMargins: true, margins: [10, 10, 10, 10] })
  assert.ok(tagRoom(L0) < 1.4 && tagRoom(Lg) >= 1.4)  // sem espaço entre cartas não há etiquetas
  assert.equal(sheetLabels(L0, 'Deck A', ['A']).length, 1)  // só o nome no cimo
  const lb = sheetLabels(Lg, 'Deck A · Deck B', Lg.cells.map(() => 'Deck A'))
  assert.equal(lb.length, 1 + Lg.per)
  assert.ok(lb[0].y < Lg.y0 - 1 && lb.slice(1).every((t, i) => t.y > Lg.cells[i].y + Lg.ch && t.y - Lg.cells[i].y - Lg.ch <= tagRoom(Lg)))  // fora da carta
  assert.ok(sheetLabels(L0, 'x'.repeat(400), null)[0].t.length < 120)  // nome comprido encolhe com «…»
  assert.equal(pdfStr('Ação (1)\\'), 'A\\347\\343o \\0501\\051\\134'); assert.equal(pdfStr('龍…'), '?\\205')
  const ops = pageOps(L0, PRINT0, [null, 'x'], () => 0, () => [{ x: 5, y: 5, s: 3, t: 'Olá' }])
  assert.equal((ops[0].match(/Do Q/g) || []).length, 1); assert.ok(ops[0].includes('(Ol\\341) Tj'))  // casa vazia salta; texto em Helvetica
  console.log('selfcheck proxies de vários decks ok') }
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

// Blood Moon: os terrenos não básicos (de qualquer lado) passam a Montanha; os básicos e o resto ficam iguais
import { markMoon } from './src/game.js'
{
  const C = [{ n: 'Blood Moon', t: 'Enchantment', o: 'Nonbasic lands are Mountains.' }, { n: 'Temple Garden', t: 'Land — Forest Plains', o: '' },
    { n: 'Forest', t: 'Basic Land — Forest', o: '' }, { n: 'Grizzly Bears', t: 'Creature — Bear', o: '' }]
  const gm = { byName: new Map(C.map(c => [c.n, c])), byLower: new Map(C.map(c => [c.n.toLowerCase(), c])) }
  const mine = ['Temple Garden', 'Forest', 'Grizzly Bears'].map((name, i) => ({ key: i, name }))
  assert.deepEqual(markMoon(gm, mine, mine).map(p => !!p.moon), [false, false, false])
  assert.deepEqual(markMoon(gm, mine, [...mine, { key: 9, name: 'Blood Moon' }]).map(p => !!p.moon), [true, false, false])
  console.log('selfcheck blood moon ok')
}

// sons do Forge Play pela diferença de estados: terreno jogado, compra, dano, feitiço na pilha; o fim do jogo cala o resto
import { diffSounds } from './src/sfx.js'
{
  const side = (o = {}) => ({ life: 20, poison: 0, hand: 7, library: 53, gy: 0, ex: 0, perms: new Map(), ...o })
  const st = (o = {}) => ({ turn: 3, active: 'a', combat: false, att: 0, blk: 0, stack: 0, over: false, sides: { a: side(o.a), b: side(o.b) }, ...o.top })
  const k = (a, b) => diffSounds(a, b).map(x => x[0])
  assert.deepEqual(k(st(), st({ a: { perms: new Map([[1, { land: true }]]), hand: 6 } })), ['land'])
  assert.deepEqual(k(st(), st({ a: { hand: 8, library: 52 } })), ['draw'])
  assert.deepEqual(k(st(), st({ b: { life: 17 }, top: { stack: 1, stackBy: 'a' } })), ['cast', 'damage'])
  assert.deepEqual(k(st(), st({ top: { over: true, won: true }, b: { life: 0 } })), ['win'])
  assert.deepEqual(k(st(), st({ top: { turn: 4, active: 'b' } })), ['turn'])
  console.log('selfcheck sons do forge play ok')
}

// app Android: versão nova só quando é mesmo maior (1.10.0 > 1.9.9; igual não conta)
import { newer } from './src/apkver.js'
{
  assert.ok(newer('1.13.0', '1.12.0') && newer('v1.10.0', '1.9.9') && newer('2.0.0', '1.99.99'))
  assert.ok(!newer('1.12.0', '1.12.0') && !newer('1.11.5', '1.12.0') && !newer('', '1.0.0'))
  console.log('selfcheck atualização da app android ok')
}

// dano do combate nas cartas: o atacante bloqueado que bate no bloqueador e passa com atropelar; fora do combate nada
import { replayDmg } from './src/game.js'
{
  const perms = { a: [{ key: 'k1', fid: 1, name: 'Ghalta', attacking: 'b' }], b: [{ key: 'k2', fid: 2, name: 'Bears', blocking: 'k1' }] }
  const st = { sides: ['a', 'b'], a: { perms: perms.a }, b: { perms: perms.b } }
  const evs = [{ k: 'turn', p: 'a' }, { k: 'phase', ph: 'combat' }, { k: 'damage', combat: true, id: 1, card: 'Ghalta', tid: 2, target: 'Bears', n: 2 },
    { k: 'damage', combat: true, id: 1, card: 'Ghalta', target: 'b', n: 10 }, { k: 'phase', ph: 'main2' }]
  const states = evs.map(() => st).concat([st])
  const D = replayDmg(evs, 4, states)
  assert.deepEqual([D.out.k1, D.in.k2, D.tr.k1, D.pl.b], [12, 2, 10, 10])
  assert.deepEqual(replayDmg(evs, 5, states).out, {})  // já no main2: os selos saíram
  console.log('selfcheck dano do combate ok')
}

// a conta do P/R: Grizzly Bears 2/2 com dois +1/+1 e uma aura de +1/+0 (pt do Forge sem os marcadores: 3/2) = 5/4
import { ptExplain } from './src/game.js'
{
  const gm = { byName: new Map([['Grizzly Bears', { n: 'Grizzly Bears', pt: '2/2', t: 'Creature — Bear' }]]), byLower: new Map() }
  const x = ptExplain(gm, { name: 'Grizzly Bears', pt: '3/2', counters: { '+1/+1': 2 } })
  assert.deepEqual([x.printed, x.plus, x.other, x.total], [[2, 2], 2, [1, 0], [5, 4]])
  {  // mesa livre: equipamentos, auras e anthems contam sozinhos
    const C = [['Elf A', '1/1', 'Creature — Elf', ''], ['Bear B', '2/2', 'Creature — Bear', ''], ['Bonesplitter', '', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {1}'],
      ['Anthem', '', 'Enchantment', 'Creatures you control get +1/+1.'], ['Lord', '2/2', 'Creature — Elf Druid', 'Other Elf creatures you control get +1/+1.'],
      ['Pump', '', 'Enchantment', '{1}: Creatures you control get +1/+1 until end of turn.'], ['Curse', '', 'Enchantment', 'Creatures your opponents control get -1/-1.']]
    const g2 = { byName: new Map(C.map(([n, pt, t, o]) => [n, { n, pt, t, o }])), byLower: new Map() }, P = n => ({ key: n, name: n })
    const field = ['Elf A', 'Bear B', 'Anthem', 'Lord', 'Pump'].map(P)
    assert.deepEqual(staticPump(g2, P('Elf A'), [P('Bonesplitter')], field, [P('Curse')]), [3, 1])  // +2/+0 +1/+1 (anthem) +1/+1 (elfo) −1/−1
    assert.deepEqual(staticPump(g2, P('Bear B'), [], field, []), [1, 1])
    assert.deepEqual(staticPump(g2, P('Lord'), [], field, []), [1, 1])  // «other»: o próprio senhor não conta
    assert.equal(staticPump(g2, P('Anthem'), [], field, []), null)  // não é criatura
    assert.equal(powTough(g2, { ...P('Elf A'), pump: [3, 1] }).p, 4)
  }
  {  // mesa livre: o que um feitiço faz ao resolver
    const C = [['Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.'], ['Path to Exile', 'Instant', 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.'],
      ['Counterspell', 'Instant', 'Counter target spell.'], ['Lightning Helix', 'Instant', 'Lightning Helix deals 3 damage to any target and you gain 3 life.'], ['Divination', 'Sorcery', 'Draw two cards.'],
      ['Ox', 'Creature — Ox', '', '2/4'], ['Bear', 'Creature — Bear', '', '2/2'], ['Unsummon', 'Instant', "Return target creature to its owner's hand."]]
    const g3 = { byName: new Map(C.map(([n, t, o, pt]) => [n, { n, t, o, pt: pt || '' }])), byLower: new Map() }
    assert.deepEqual(spellFx(g3, 'Lightning Bolt', { seat: 1, who: 'Rui' }).cmds, [{ c: 'life', seat: 1, d: -3 }])
    assert.deepEqual(spellFx(g3, 'Lightning Bolt', { card: { id: 7, name: 'Bear' } }).cmds, [{ c: 'move', id: 7, to: 'graveyard' }])
    assert.deepEqual(spellFx(g3, 'Lightning Bolt', { card: { id: 8, name: 'Ox' } }).cmds, [])  // 3 de dano não chega
    assert.deepEqual(spellFx(g3, 'Path to Exile', { card: { id: 7, name: 'Bear' } }).cmds, [{ c: 'move', id: 7, to: 'exile' }])
    assert.deepEqual(spellFx(g3, 'Counterspell', { card: { id: 9, name: 'Divination' }, spell: true }).cmds, [{ c: 'move', id: 9, to: 'graveyard' }])
    assert.deepEqual(spellFx(g3, 'Lightning Helix', { seat: 1 }).cmds, [{ c: 'life', seat: 1, d: -3 }, { c: 'life', self: true, d: 3 }])
    assert.deepEqual(spellFx(g3, 'Divination', null).cmds, [{ c: 'draw', n: 2 }])
    assert.deepEqual(spellFx(g3, 'Unsummon', { card: { id: 7, name: 'Bear' } }).cmds, [{ c: 'move', id: 7, to: 'hand' }])
  }
  console.log('selfcheck conta do poder/resistência ok')
}
{  // Exportar / Importar decks: zip ida e volta, .dek, .csv, vários colados, o ficheiro do Grimório
  const { makeZip, readZip } = await import('./src/zip.js')
  const { fromText, listsZip } = await import('./src/deckio.js')
  const z = makeZip([{ name: 'Bolts.txt', text: '4 Lightning Bolt\n20 Forest' }, { name: 'Ç ñ.txt', text: 'çã' }])
  const back = await readZip(z.buffer)
  assert.deepEqual(back.map(f => f.name), ['Bolts.txt', 'Ç ñ.txt']) ; assert.equal(back[1].text, 'çã')
  // um .zip comprimido (deflate), como o das outras apps
  const { deflateRawSync } = await import('node:zlib')
  const raw = deflateRawSync(Buffer.from('2 Lightning Bolt')), nm = Buffer.from('d.txt'), crc = 0
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(16, 22); lh.writeUInt16LE(nm.length, 26)
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(16, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(0, 42)
  const cd = Buffer.concat([ch, nm]), ed = Buffer.alloc(22); ed.writeUInt32LE(0x06054b50, 0); ed.writeUInt16LE(1, 8); ed.writeUInt16LE(1, 10); ed.writeUInt32LE(cd.length, 12); ed.writeUInt32LE(30 + nm.length + raw.length, 16)
  const zz = Buffer.concat([lh, nm, raw, cd, ed])
  assert.equal((await readZip(zz.buffer.slice(zz.byteOffset, zz.byteOffset + zz.length)))[0].text, '2 Lightning Bolt')
  const dek = fromText(data, '<?xml version="1.0"?><Deck><Cards CatID="1" Quantity="4" Sideboard="false" Name="Lightning Bolt" /><Cards CatID="2" Quantity="2" Sideboard="true" Name="Sol Ring" /></Deck>', 'MTGO', 'x.dek')
  assert.deepEqual([dek[0].deck.main, dek[0].deck.side], [{ 'Lightning Bolt': 4 }, { 'Sol Ring': 2 }])
  const csv = fromText(data, '"Count","Name","Board"\n4,"Lightning Bolt","main"\n1,"Sol Ring","sideboard"\n1,"Atraxa, Praetors\' Voice","commander"\n', 'Mox', 'm.csv')
  assert.deepEqual([csv[0].deck.main, csv[0].deck.side, csv[0].deck.commanders], [{ 'Lightning Bolt': 4 }, { 'Sol Ring': 1 }, ['Atraxa, Praetors\' Voice']])
  const many = fromText(data, 'Nome: Burn\n4 Lightning Bolt\n---\nNome: Ramp\n20 Forest\n1 Carta Que Não Existe', 'Colado')
  assert.deepEqual(many.map(x => [x.deck.name, x.count, x.unknown.length]), [['Burn', 4, 0], ['Ramp', 20, 1]])
  assert.equal(fromText(data, 'Deck\n4 Lightning Bolt\n\nSideboard\n2 Sol Ring', 'Um').length, 1)  // o «Deck» do Arena não parte em dois
  const b = fromText(data, JSON.stringify({ grimorio: 'decks', v: 1, decks: [{ id: 'x', name: 'A', format: 'modern', main: { 'Lightning Bolt': 4 }, notes: 'n' }] }))
  assert.equal(b[0].deck.notes, 'n'); assert.equal(b[0].deck.id, 'x')
  const lz = await readZip(listsZip([{ name: 'A/B', main: { 'Lightning Bolt': 4 } }, { name: 'a/b', main: { Forest: 1 } }]).buffer)
  assert.deepEqual(lz.map(f => f.name), ['A_B.txt', 'a_b (2).txt']); assert.match(lz[0].text, /4 Lightning Bolt/)
  console.log('selfcheck exportar/importar decks ok')
}
// fichas (tokens.js + permCard): nome sem «Token» e sem maiúsculas, P/R e cores desempatam, a carta que a criou manda,
// uma ficha «Blood» não é a face de «Flesh // Blood», e o lookup pelo nome também chega às fichas
{
  const { setTokens } = await import('./src/tokens.js'), { permCard, lookup } = await import('./src/game.js')
  setTokens({ tokens: { w: ['Cat', '1/1', 'W', 'Token Creature — Cat', '', [], 0], g: ['Cat', '1/1', 'G', 'Token Creature — Cat', '', [], 0], b2: ['Cat', '2/2', 'B', 'Token Creature — Cat', '', [], 0],
    sc: ['Eldrazi Scion', '1/1', '', 'Token Creature — Eldrazi Scion', '', [], 0], sp: ['Eldrazi Spawn', '0/1', '', 'Token Creature — Eldrazi Spawn', '', [], 0],
    bl: ['Blood', '', '', 'Token Artifact — Blood', '', [], 0], r: ['Wicked // Cursed', '', '', 'Token Enchantment — Aura Role // Token Enchantment — Aura Role', '', [], [['Wicked', '', ''], ['Cursed', '', '']]] },
  byName: { cat: ['w', 'g', 'b2'], 'eldrazi scion': ['sc'], 'eldrazi spawn': ['sp'], blood: ['bl'], wicked: ['r'], cursed: ['r'] }, byCard: { 'Cat Maker': ['g'] } })
  const fb = { n: 'Flesh // Blood', t: 'Sorcery // Instant', o: '', kw: [] }, gm = { byName: new Map([[fb.n, fb]]), byLower: new Map([['blood', fb]]) }
  const id = p => permCard(gm, { token: true, ...p })?.id
  assert.equal(id({ name: 'Cat Token', pt: '1/1', col: 'G' }), 'g')
  assert.equal(id({ name: 'cat token', pt: '2/2' }), 'b2')
  assert.equal(id({ name: 'Cat Token', src: 'Cat Maker' }), 'g')
  assert.equal(id({ name: 'Blood Token' }), 'bl')
  assert.equal(id({ name: 'Cursed' }), 'r')
  assert.equal(id({ name: 'Dog Token' }), undefined)
  assert.equal(id({ name: 'Eldrazi Scion Token', pt: '1/1', col: '' }), 'sc')
  assert.equal(id({ name: 'Scion' }), 'sc')  // escrita à mão na mesa livre: pelo fim do nome
  assert.equal(id({ name: 'Spawn Token', pt: '0/1' }), 'sp')
  assert.equal(lookup(gm, 'Cat Token')?.tok, 1)
  const w = { name: 'Cat Token', pt: '1/1', col: 'W', token: true }
  assert.equal(permCard(gm, w), permCard(gm, { ...w }))  // o mesmo objeto de cada vez (memo do React)
  setTokens(null)
  console.log('selfcheck fichas ok')
}
{ const { selfcheck } = await import('./src/fpask.js'); selfcheck(assert); console.log('selfcheck pedidos do Forge ok') }

// terrenos que passam a criatura: earthbend (Badgermole Cub, grande final de 12/11) e manlands até ao fim do turno — vão
// para a fila das criaturas com o P/R certo; o que volta do exílio volta só terreno
{
  const { replayStates: rs, isCreature: isC, powTough: pt } = await import('./src/game.js')
  const G = [
    { n: 'Badgermole Cub', t: 'Creature — Badger Mole', o: 'When this creature enters, earthbend 1.', pt: '2/2', kw: [] },
    { n: 'Llanowar Wastes', t: 'Land', o: '{T}: Add {C}.', pt: '', kw: [] },
    { n: 'Mutavault', t: 'Land', o: '{1}: Until end of turn, Mutavault becomes a 2/2 creature with all creature types.', pt: '', kw: [] },
    { n: 'Path to Exile', t: 'Instant', o: 'Exile target creature.', pt: '', kw: [] },
  ]
  const gm = { byName: new Map(G.map(c => [c.n, c])), byLower: new Map(G.map(c => [c.n.toLowerCase(), c])) }
  const E = [
    { t: 0, k: 'mulligan', p: 'a', n: 7, card: 'kept' },
    { t: 1, k: 'turn', p: 'a' },
    { t: 1, k: 'land', p: 'a', card: 'Llanowar Wastes', id: 1, zn: [{ id: 1, card: 'Llanowar Wastes', from: 'hand', to: 'battlefield', fp: 'a', tp: 'a' }] },
    { t: 1, k: 'land', p: 'a', card: 'Mutavault', id: 12, zn: [{ id: 12, card: 'Mutavault', from: 'hand', to: 'battlefield', fp: 'a', tp: 'a' }] },
    { t: 1, k: 'cast', p: 'a', card: 'Badgermole Cub', zn: [{ id: 18, card: 'Badgermole Cub', from: 'hand', to: 'stack', fp: 'a', tp: null }] },
    { t: 1, k: 'resolve', p: 'a', card: 'Badgermole Cub', pt: '2/2', zn: [{ id: 18, card: 'Badgermole Cub', from: 'stack', to: 'battlefield', fp: null, tp: 'a' }] },
    { t: 1, k: 'trigger', p: 'a', card: 'Badgermole Cub', target: 'Llanowar Wastes', tid: 1 },
    { t: 1, k: 'counters', p: 'a', card: 'Llanowar Wastes', id: 1, ct: '+1/+1', n: 1, abs: 1, x: 1 },
    { t: 1, k: 'resolve', p: 'a', txt: 'When this creature enters, earthbend 1. (Target land you control becomes a 0/0 creature with haste that\'s still a land. Put a +1/+1 counter on it.) (Targeting: [[Llanowar Wastes (1)]])' },
    { t: 1, k: 'activate', p: 'a', card: 'Mutavault', id: 12 },
    { t: 1, k: 'resolve', p: 'a', card: 'Mutavault', txt: 'Mutavault (12) - Until end of turn, Mutavault becomes a 2/2 creature with all creature types.' },
  ]
  let st = rs(E, gm, 20, null, true), s = st.at(-1)
  const lw = s.a.perms.find(p => p.name === 'Llanowar Wastes'), mv = s.a.perms.find(p => p.name === 'Mutavault')
  assert.ok(isC(gm, lw), 'o earthbend torna o terreno criatura')
  assert.deepEqual([pt(gm, lw).p, pt(gm, lw).t], [1, 1], 'terreno com earthbend 1 = 0/0 + marcador = 1/1')
  assert.ok(isC(gm, mv) && pt(gm, mv).p === 2, 'Mutavault animado é uma 2/2')
  // no turno seguinte o Mutavault volta a ser só terreno; a Llanowar Wastes continua criatura
  st = rs([...E, { t: 2, k: 'turn', p: 'b' }], gm, 20, null, true); s = st.at(-1)
  assert.ok(!isC(gm, s.a.perms.find(p => p.name === 'Mutavault')), '«until end of turn» acaba no fim do turno')
  assert.ok(isC(gm, s.a.perms.find(p => p.name === 'Llanowar Wastes')), 'o earthbend fica')
  // exilada (Path) e devolvida virada: volta só terreno
  st = rs([...E,
    { t: 1, k: 'exile', p: 'a', card: 'Llanowar Wastes', id: 1, x: 1, zn: [{ id: 1, card: 'Llanowar Wastes', from: 'battlefield', to: 'exile', fp: 'a', tp: 'a' }] },
    { t: 1, k: 'zone', p: 'a', card: 'Llanowar Wastes', id: 1, x: 1, zn: [{ id: 1, card: 'Llanowar Wastes', from: 'exile', to: 'battlefield', fp: 'a', tp: 'a' }] },
  ], gm, 20, null, true); s = st.at(-1)
  const back = s.a.perms.find(p => p.name === 'Llanowar Wastes')
  assert.ok(back && !isC(gm, back), 'de volta do exílio é só terreno')
  console.log('selfcheck terrenos animados ok')
}

// mecânicas novas nas réplicas (linhas D/S/P/R/V/E/X do GrimorioSim -> eventos day/speed/pctr/ring/dungeon/emblems/state),
// protótipo pelo P/R da resolução, fichas (emblemas, papéis da metade de baixo, edição), cartas deitadas e comandantes
{
  const { replayStates: rs, protoPt, powTough: pt } = await import('./src/game.js')
  const G = [
    { n: 'Bottomless Pool // Locker Room', t: 'Enchantment — Room // Enchantment — Room', o: 'When you unlock this door, return up to one target creature to its owner\'s hand.\n//\nWhenever one or more creatures you control deal combat damage to a player, draw a card.', pt: '', kw: [] },
    { n: 'Wizard Class', t: 'Enchantment — Class', o: 'You have no maximum hand size.', pt: '', kw: [] },
    { n: 'Arcane Proxy', t: 'Artifact Creature — Wizard', o: 'Prototype {1}{U}{U} — 2/1 (You may cast this spell with different mana cost, color, and size.)', pt: '4/3', kw: [] },
    { n: 'Invasion of Zendikar // Awakened Skyclave', t: 'Battle — Siege // Creature — Elemental', o: '', pt: '3', kw: [], df: 1 },
    { n: 'Fire // Ice', t: 'Instant // Instant', o: 'Fire deals 2 damage divided as you choose among one or two targets.\n//\nTap target permanent.', pt: '', kw: [] },
    { n: 'Commit // Memory', t: 'Instant // Sorcery', o: 'Put target spell or nonland permanent into its owner\'s library second from the top.\n//\nAftermath', pt: '', kw: [] },
    { n: 'Bonecrusher Giant // Stomp', t: 'Creature — Giant // Instant — Adventure', o: '', pt: '4/3', kw: [] },
  ]
  const gm = { byName: new Map(G.map(c => [c.n, c])), byLower: new Map(G.map(c => [c.n.toLowerCase(), c])) }
  const Z = (id, card, tp = 'a') => ({ id, card, from: 'stack', to: 'battlefield', fp: null, tp })
  const E = [
    { t: 0, k: 'mulligan', p: 'a', n: 7, card: 'kept' }, { t: 1, k: 'turn', p: 'a' },
    { t: 1, k: 'resolve', p: 'a', card: 'Bottomless Pool // Locker Room', zn: [Z(5, 'Bottomless Pool // Locker Room')] },
    { t: 1, k: 'resolve', p: 'a', card: 'Wizard Class', zn: [Z(6, 'Wizard Class')] },
    { t: 1, k: 'resolve', p: 'a', card: 'Arcane Proxy', pt: '2/1', zn: [Z(7, 'Arcane Proxy')] },
    { t: 1, k: 'state', p: 'a', card: 'Bottomless Pool // Locker Room', id: 5, st: { doors: ['Bottomless Pool'] }, x: 1 },
    { t: 1, k: 'state', p: 'a', card: 'Wizard Class', id: 6, st: { lvl: 2 }, x: 1 },
    { t: 1, k: 'day', v: 'night', x: 1 }, { t: 1, k: 'speed', p: 'a', n: 2, x: 1 }, { t: 1, k: 'ring', p: 'b', n: 1, x: 1 },
    { t: 1, k: 'pctr', p: 'a', ct: 'energy', abs: 3, x: 1 }, { t: 1, k: 'pctr', p: 'a', ct: 'experience', abs: 2, x: 1 },
    { t: 1, k: 'dungeon', p: 'b', card: 'Tomb of Annihilation', to: 'Veils of Fear', x: 1 },
    { t: 1, k: 'marks', p: 'b', mk: ['monarch', 'initiative'], x: 1 }, { t: 1, k: 'marks', p: 'b', mk: ['initiative'], x: 1 }, { t: 1, k: 'marks', p: 'a', mk: ['monarch'], x: 1 },
    { t: 1, k: 'emblems', p: 'a', list: [{ n: 'Gideon of the Trials Emblem', t: 'As long as you control a Gideon planeswalker, you can\'t lose the game.' }], x: 1 },
  ]
  const s = rs(E, gm, 20, null, true).at(-1), by = n => s.a.perms.find(p => p.name === n)
  assert.deepEqual(by('Bottomless Pool // Locker Room').doors, ['Bottomless Pool'])
  assert.equal(by('Wizard Class').lvl, 2)
  assert.equal(protoPt(G[2]), '2/1')
  const { isCreature } = await import('./src/game.js'), ov = { n: 'Overlord of the Floodpits', t: 'Enchantment Creature — Avatar Horror', o: 'Impending 4—{1}{U}{U}', pt: '5/3', kw: [] }, gi = { byName: new Map([[ov.n, ov]]), byLower: new Map() }
  assert.deepEqual([isCreature(gi, { name: ov.n, counters: { time: 2 } }), isCreature(gi, { name: ov.n, counters: {} })], [false, true], 'impending: não é criatura com marcadores de tempo')
  assert.deepEqual([pt(gm, by('Arcane Proxy')).p, pt(gm, by('Arcane Proxy')).t, by('Arcane Proxy').proto], [2, 1, true], 'protótipo: entra 2/1')
  assert.deepEqual([s.day, s.a.speed, s.b.ring, s.a.energy, s.a.pctr, s.b.dungeon], ['night', 2, 1, 3, { experience: 2 }, { n: 'Tomb of Annihilation', room: 'Veils of Fear' }])
  assert.deepEqual([s.a.monarch, s.b.monarch, s.b.initiative], [true, false, true], 'monarca/iniciativa exatos')
  assert.deepEqual([s.a.emblems, Object.keys(s.a.emText)], [['Gideon of the Trials Emblem'], ['Gideon of the Trials Emblem']])
  const s2 = rs([...E, { t: 1, k: 'state', p: 'a', card: 'Wizard Class', id: 6, st: { fd: 1 }, x: 1 }], gm, 20, null, true).at(-1)
  assert.ok(s2.a.perms.find(p => p.name === 'Wizard Class').faceDown && !s2.a.perms.find(p => p.name === 'Wizard Class').lvl)
  const { sideways } = await import('./src/data.js')
  assert.deepEqual(G.map(sideways), [true, false, false, true, true, false, false], 'deitadas: Salas, batalhas e divididas; aftermath e aventuras não')
  const { canBeCommander, FORMAT } = await import('./src/formats.js')
  const cmd = FORMAT.commander, bg = { n: 'Raised by Giants', t: 'Legendary Enchantment — Background', o: 'Commander creatures you own have base power and toughness 10/10.' }
  const bushi = { n: 'Bushi Tenderfoot // Kenzo the Hardhearted', t: 'Creature — Human Soldier // Legendary Creature — Human Samurai', o: '' }
  const chooser = { n: 'Wilson', t: 'Legendary Creature — Bear Warrior', o: 'Choose a Background' }
  assert.deepEqual([canBeCommander(bg, cmd), canBeCommander(bg, cmd, null), canBeCommander(bg, cmd, chooser), canBeCommander(bushi, cmd), canBeCommander(chooser, cmd)], [true, false, true, false, true])
  // fichas: «Emblem - X» do Forge = «X Emblem» da Scryfall; papel da metade de baixo = a imagem ao contrário; a edição desempata
  const { setTokens, tokenCard } = await import('./src/tokens.js')
  setTokens({ tokens: { e: ['Gideon of the Trials Emblem', '', '', 'Emblem — Gideon', '', [], 0, 'tm19', ''], r: ['Royal // Young Hero', '', '', 'Token Enchantment — Aura Role // Token Enchantment — Aura Role', '', [], [['Royal', '', ''], ['Young Hero', '', '']], 'twoe', 'flip'],
    g1: ['Goblin', '1/1', 'R', 'Token Creature — Goblin', '', [], 0, 'tm13', ''], g2: ['Goblin', '1/1', 'R', 'Token Creature — Goblin', '', [], 0, 'tdom', ''] },
  byName: { 'gideon of the trials emblem': ['e'], royal: ['r'], 'young hero': ['r'], goblin: ['g1', 'g2'] }, byCard: {} })
  assert.equal(tokenCard('Emblem - Gideon of the Trials')?.id, 'e')
  assert.deepEqual([tokenCard('Young Hero')?.up, tokenCard('Royal')?.up, tokenCard('Royal Role')?.df], [1, undefined, 0])
  assert.deepEqual([tokenCard('Goblin Token', '1/1', null, 'R', 'DOM')?.id, tokenCard('Goblin Token', '1/1', null, 'R', 'M13')?.id], ['g2', 'g1'])
  setTokens(null)
  console.log('selfcheck mecânicas novas ok')
}

// meld (as duas metades -> a fundida, nas réplicas sai do exílio com as duas), exhaust/fim do turno, o exílio que ainda se
// lança (Forge Play e réplicas), a mesa livre fundida, e a ferramenta Tokens (fichas do deck, pesquisa, a mesa)
{
  const { meldIndex, replayStates: rs } = await import('./src/game.js'), { toPerm, zoneOf, ftBoard } = await import('./src/fpboard.js')
  const M = [
    { n: 'Gisela, the Broken Blade', t: 'Legendary Creature — Angel Horror', o: 'Flying, first strike, lifelink\nAt the beginning of your end step, if you both own and control Gisela and a creature named Bruna, the Fading Light, exile them, then meld them into Brisela, Voice of Nightmares.', pt: '4/3', kw: [] },
    { n: 'Bruna, the Fading Light', t: 'Legendary Creature — Angel Horror', o: 'Flying, vigilance\n(Melds with Gisela, the Broken Blade.)', pt: '5/7', kw: [] },
    { n: 'Brisela, Voice of Nightmares', t: 'Legendary Creature — Eldrazi Angel', o: 'Flying, first strike, vigilance, lifelink', pt: '9/10', kw: [] },
    { n: 'Hanweir Garrison', t: 'Creature — Human Soldier', o: 'Whenever this creature attacks, create two 1/1 red Human creature tokens that are tapped and attacking.\n(Melds with Hanweir Battlements.)', pt: '2/3', kw: [] },
    { n: 'Hanweir Battlements', t: 'Land', o: '{3}{R}{R}, {T}: If you both own and control this land and a creature named Hanweir Garrison, exile them, then meld them into Hanweir, the Writhing Township.', pt: '', kw: [] },
  ]
  const gm = { byName: new Map(M.map(c => [c.n, c])), byLower: new Map(M.map(c => [c.n.toLowerCase(), c])) }, mi = meldIndex(gm)
  assert.deepEqual(mi.parts.get('Brisela, Voice of Nightmares'), ['Gisela, the Broken Blade', 'Bruna, the Fading Light'])
  assert.deepEqual([mi.of.get('Bruna, the Fading Light'), mi.of.get('Hanweir Battlements')?.into], [{ with: 'Gisela, the Broken Blade', into: 'Brisela, Voice of Nightmares' }, 'Hanweir, the Writhing Township'])
  assert.equal(meldIndex(gm), mi, 'o índice faz-se uma vez por base de cartas')
  const Z = (id, card, from, to, fp = 'a', tp = 'a') => ({ id, card, from, to, fp, tp })
  const E = [{ t: 0, k: 'mulligan', p: 'a', n: 7, card: 'kept' }, { t: 1, k: 'turn', p: 'a' },
    { t: 1, k: 'resolve', p: 'a', card: 'Gisela', zn: [Z(1, 'Gisela, the Broken Blade', 'stack', 'battlefield'), Z(2, 'Bruna, the Fading Light', 'stack', 'battlefield')] },
    { t: 1, k: 'trigger', p: 'a', card: 'Gisela', zn: [Z(1, 'Gisela, the Broken Blade', 'battlefield', 'exile'), Z(2, 'Bruna, the Fading Light', 'battlefield', 'exile'), Z(1, 'Brisela, Voice of Nightmares', 'exile', 'battlefield')] },
    { t: 1, k: 'state', p: 'a', card: 'Brisela, Voice of Nightmares', id: 1, st: { exh: 1, eot: 1 }, x: 1 },
    { t: 1, k: 'exways', p: 'a', list: [{ n: 'Aloe Alchemist', w: 'plot' }], x: 1 }]
  const s = rs(E, gm, 20, null, true).at(-1)
  assert.deepEqual([s.a.perms.filter(p => !p.dying).map(p => p.name), s.a.exile], [['Brisela, Voice of Nightmares'], []], 'fundida: as metades saem do exílio')
  assert.deepEqual([s.a.perms.find(p => p.fid === 1).exh, s.a.perms.find(p => p.fid === 1).eot, s.a.exWay], [1, true, { 'Aloe Alchemist': 'plot' }])
  const fp = toPerm({ id: 3, name: 'Afterburner Expert', exh: 1, eot: true }), z = zoneOf({ exile: [{ id: 4, name: 'Aloe Alchemist', exw: 'plot' }, { id: 5, name: 'Rift Bolt', counters: { TIME: 2 } }, { id: 6, name: 'Shock' }] })
  assert.deepEqual([fp.exh, fp.eot, z.exWay], [1, true, { 'Aloe Alchemist': 'plot', 'Rift Bolt': 'suspend' }])
  const ft = ftBoard({ seats: [{ name: 'A', life: 20, bf: [{ id: 9, n: 'Gisela, the Broken Blade', mr: 'Brisela, Voice of Nightmares', sv: true, xh: true, eo: true }] }] })
  assert.deepEqual((p => [p.name, p.solved, p.exh, p.eot])(ft.a.perms[0]), ['Brisela, Voice of Nightmares', true, 1, true])
  const { setTokens, deckTokens, searchTokens, tokTable, tokenById } = await import('./src/tokens.js')
  setTokens({ tokens: { t1: ['Treasure', '', '', 'Token Artifact — Treasure', '{T}, Sacrifice this token: Add one mana of any color.', [], 0, 'tsnc', ''], t2: ['Treasure', '', '', 'Token Artifact — Treasure', '{T}, Sacrifice this token: Add one mana of any color.', [], 0, 'tlci', ''],
    z: ['Zombie', '2/2', 'B', 'Token Creature — Zombie', '', [], 0, 'tm21', ''], e: ['Gideon of the Trials Emblem', '', '', 'Emblem — Gideon', '', [], 0, 'tm19', ''] },
  byName: { treasure: ['t1', 't2'], zombie: ['z'] }, byCard: { 'Smothering Tithe': ['t1'], 'Dockside Extortionist': ['t2'], 'Gravecrawler': [], 'Grave Titan': ['z'] } })
  assert.deepEqual(deckTokens(['Smothering Tithe', 'Dockside Extortionist', 'Grave Titan', 'Island']).map(x => [x.c.n, x.from.length]), [['Treasure', 2], ['Zombie', 1]], 'a mesma ficha de duas cartas conta uma vez')
  assert.deepEqual([searchTokens('2/2').map(c => c.n), searchTokens('zombie black').length, searchTokens('emblem gideon').map(c => c.id), searchTokens('treasure').length], [['Zombie'], 0, ['e'], 1])
  let tb = tokTable([], { add: 'z', q: 3 })
  tb = tokTable(tb, { add: 'z', q: 2 }); assert.equal(tb.length, 1); assert.equal(tb[0].q, 5)
  const k = tb[0].k
  tb = tokTable(tokTable(tb, { k, tap: 1 }), { k, tap: 1 }); assert.equal(tb[0].tp, 2)
  tb = tokTable(tb, { add: 'z', q: 1 }); assert.equal(tb.length, 2, 'as viradas ficam à parte das novas')
  tb = tokTable(tokTable(tb, { k, ctr: '+1/+1', d: 2 }), { k, dq: -4 }); assert.deepEqual([tb[0].q, tb[0].tp, tb[0].ctr], [1, 1, { '+1/+1': 2 }])
  tb = tokTable(tokTable(tb, { k, tap: 1 }), { k, ctr: '+1/+1', d: -2 }); assert.deepEqual([tb[0].tp, tb[0].ctr], [0, {}], 'todas viradas -> desvira')
  assert.deepEqual([tokTable(tb, { k, dq: -1 }).length, tokTable(tb, { untap: 1 }).every(x => !x.tp), tokTable(tb, { clear: 1 }).length, tokenById('z')?.pt], [1, true, 0, '2/2'])
  setTokens(null)
  console.log('selfcheck meld, exhaust, exílio e Tokens ok')
}

// Vocabulário (build/vocab.py → data/vocab.json): edições, universos (build/franchises.json), nomes alternativos das
// impressões e tipos traduzidos. Cartas e edições inventadas; as palavras dos universos são as do repositório.
{ const { prepData, search, CREATURE_TYPES, termMatch } = await import('./src/data.js')
  const { setVocab, findSets, setOriginals, setMembers, setLabel } = await import('./src/vocab.js')
  const { likeTheme, parseQuery, chipUniverse } = await import('./src/nlsearch.js')
  const mk = (n, t, x = {}) => ({ n, t, o: '', mc: '', cmc: 3, ci: 'B', co: 'B', lg: 1 << 6, rs: 0, r: 'r', tg: [], kw: [], er: 10, un: 0, ...x })
  const cards = [mk('Blightsteel Colossus', 'Artifact Creature — Phyrexian Golem', { ci: '' }), mk('Optimus Prime, Hero', 'Legendary Artifact Creature — Robot', { ci: 'URW' }),
    mk('Samwise Gamgee', 'Legendary Creature — Halfling Peasant', { ci: 'GW' }), mk('Frodo Baggins', 'Legendary Creature — Halfling Scout', { ci: 'GW' }), mk('Bilbo, Retired Burglar', 'Legendary Creature — Halfling Rogue', { ci: 'UR' }),
    mk('Ezio Auditore da Firenze', 'Legendary Creature — Human Assassin'), mk('Twinblade Assassins', 'Creature — Elf Assassin'), mk('Hired Poisoner', 'Creature — Human Assassin'),
    mk('Spider-Man, Brooklyn Visionary', 'Legendary Creature — Spider Human Hero', { ci: 'G' }), mk('Zilortha, Strength Incarnate', 'Legendary Creature — Dinosaur', { ci: 'RG' }),
    mk('Sol Ring', 'Artifact', { ci: '' }), mk('Gravecrawler', 'Creature — Zombie'), mk('Diregraf Ghoul', 'Creature — Zombie'), mk('Carrion Feeder', 'Creature — Zombie')]
  const I = n => cards.findIndex(c => c.n === n), delta = ns => ns.map(I).sort((a, b) => a - b).map((x, k, l) => x - (k ? l[k - 1] : 0))
  const sets = [['spm', "Marvel's Spider-Man", '2025', 'expansion', [], delta(['Spider-Man, Brooklyn Visionary'])], ['acr', "Assassin's Creed", '2024', 'draft_innovation', [], delta(['Ezio Auditore da Firenze', 'Sol Ring'])],
    ['ltr', 'The Lord of the Rings: Tales of Middle-earth', '2023', 'draft_innovation', ['ltc'], delta(['Samwise Gamgee', 'Frodo Baggins'])], ['ltc', 'Tales of Middle-earth Commander', '2023', 'commander', [], delta(['Bilbo, Retired Burglar', 'Sol Ring'])],
    ['bot', 'Transformers', '2022', 'eternal', [], delta(['Optimus Prime, Hero'])], ['iko', 'Ikoria: Lair of Behemoths', '2020', 'expansion', [], delta(['Zilortha, Strength Incarnate'])],
    ['sld', 'Secret Lair Drop', '2019', 'box', [], delta(['Blightsteel Colossus'])], ['lea', 'Limited Edition Alpha', '1993', 'core', [], delta(['Sol Ring', 'Twinblade Assassins', 'Hired Poisoner', 'Gravecrawler', 'Diregraf Ghoul', 'Carrion Feeder'])]]
  const pos = Object.fromEntries(sets.map((s, k) => [s[0], k])), at = {}
  for (const s of sets) { let i = 0; for (const d of s[5]) at[i += d] ||= s[0] }
  const first = cards.map((c, i) => (c.n === 'Sol Ring' ? pos.lea : pos[at[i]] ?? -1))
  const fl = [[I('Blightsteel Colossus'), 'Megatron', 'sld', '1079', 'b1'], [I('Zilortha, Strength Incarnate'), 'Godzilla, King of the Monsters', 'iko', '275', 'z1']]
  const fr = JSON.parse(readFileSync(new URL('../build/franchises.json', import.meta.url), 'utf8')).franchises
    .map(f => [f.id, f.name, f.sets.filter(s => pos[s] != null).flatMap(s => [s, ...sets[pos[s]][4]]).filter((s, k, l) => l.indexOf(s) === k), f.alias,
      f.id === 'bot' ? [I('Blightsteel Colossus')] : f.id === 'godzilla' ? [I('Zilortha, Strength Incarnate')] : []])
  const data = prepData({ formats: F }, cards, [], new ArrayBuffer(0), new ArrayBuffer(0))
  assert.equal(setVocab({ n: cards.length + 1, sets, first, fr, fl, types: {} }, cards), false, 'vocab de outro cards.json: ignorado')
  assert.ok(setVocab({ n: cards.length, sets, first, fr, fl, types: { zumbi: 'Zombie', drache: 'Dragon', 半身人: 'Halfling', vampiro: 'Vampire' } }, cards))
  const T = { types: CREATURE_TYPES }, hits = q => findSets(q).hits.map(h => h.v), th = q => likeTheme(data, q, T).terms.map(t => `${t.k}:${t.v}`)
  for (const q of ['transformers', 'Decepticons', 'autobots', 'optimus', 'set:bot', 'BOT']) assert.deepEqual(hits(q), ['bot'], q)
  for (const q of ['lord of the rings', 'o senhor dos anéis', 'el señor de los anillos', 'Der Herr der Ringe', '指环王', 'LOTR', 'tolkien']) assert.deepEqual(hits(q), ['ltr'], q)
  for (const q of ["assassin's creed", 'assassins creed', 'Assassins']) assert.deepEqual(hits(q), ['acr'], q)
  for (const q of ['spiderman', 'Spider-Man', 'homem-aranha', 'hombre araña', '蜘蛛侠']) assert.deepEqual(hits(q), ['spm'], q)
  assert.deepEqual(hits('Tales of Middle-earth Commander'), ['ltc'])
  assert.equal(findSets("transformers Urza's").rest, "Urza's", 'o resto fica como veio')
  assert.equal(setLabel('bot'), 'Transformers (BOT)')
  // «Gosto de…»: o universo é um chip (as cartas nascidas lá + as impressões com o nome dele); um tipo fica também
  assert.deepEqual(th('transformers').filter(t => t.startsWith('set:')), ['set:bot'])
  assert.ok(th('decepticons').includes('set:bot'))
  assert.ok(th('hobbits').includes('sub:Halfling') && th('hobbits').includes('set:ltr'), 'hobbits = Halfling + LTR')
  assert.ok(th('assassins').includes('sub:Assassin') && th('assassins').includes('set:acr'), 'assassins = Assassin + ACR')
  assert.ok(th('spiderman').includes('set:spm'))
  assert.deepEqual([...setOriginals('ltr')].map(i => cards[i].n).sort(), ['Bilbo, Retired Burglar', 'Frodo Baggins', 'Samwise Gamgee'], 'LTR + LTC sem o Sol Ring reimpresso')
  assert.ok(setMembers('ltr').has(I('Sol Ring')), 'a pesquisa set:ltr traz as reimpressões')
  assert.ok(termMatch(cards[I('Blightsteel Colossus')], { k: 'set', v: 'bot' }), 'o Megatron da Secret Lair é Transformers')
  assert.equal(likeTheme(data, 'transformers', T).colors.length, 0, 'uma edição não fixa as cores')
  assert.deepEqual(likeTheme(data, 'megatron', T).cards.map(x => [x.c.n, x.fl.n]), [['Blightsteel Colossus', 'Megatron']])
  // tipos: plurais e as outras línguas (vocab.types tirado das impressões traduzidas)
  for (const [q, t] of [['zumbis', 'Zombie'], ['Drachen', 'Dragon'], ['半身人', 'Halfling'], ['vampiros', 'Vampire'], ['hobbits', 'Halfling'], ['assassinos', 'Assassin'], ['asesinos', 'Assassin']]) assert.equal(parseQuery(q, T)?.f.sub, t, q)
  // pesquisa geral: o nome alternativo encontra a carta a sério, com a impressão que bateu
  const r = search(data, 'megatron', null, { bit: -1 })
  assert.deepEqual([r.cards.map(c => c.n), r.fl.get(I('Blightsteel Colossus'))?.set], [['Blightsteel Colossus'], 'sld'])
  assert.deepEqual(search(data, 'Godzilla, King of the Monsters', null, { bit: -1 }).cards.map(c => c.n), ['Zilortha, Strength Incarnate'])
  assert.ok(chipUniverse(data).sets.some(x => x.v === 'ltr'), 'a paleta tem os universos')
  setVocab(null, cards)
  console.log('selfcheck edições, universos e nomes alternativos ok')
}

// Estratégias (src/archetypes.js): «control», «burn», «limpar a mesa», «stax», «aristocratas», «voltron» nas várias línguas
// viram o chip certo, as cartas que as servem vêm primeiro e as cores ficam livres. Texto e funções das cartas a sério.
{ const { prepData, search, CREATURE_TYPES } = await import('./src/data.js')
  const { likeTheme, likeCards, likeCommanders, parseQuery, chipUniverse } = await import('./src/nlsearch.js')
  const { FORMAT } = await import('./src/formats.js')
  const mk = (n, t, o, x = {}) => ({ n, t, o, mc: '', cmc: 2, ci: 'W', co: 'W', lg: 1 << 6, rs: 0, r: 'r', tg: [], kw: [], er: 100, un: 0, pt: '', ...x })
  const cards = [mk('Counterspell', 'Instant', 'Counter target spell.', { ci: 'U', tg: ['counter'], er: 5 }),
    mk('Wrath of God', 'Sorcery', "Destroy all creatures. They can't be regenerated.", { cmc: 4, tg: ['wipe'], er: 20 }),
    mk('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.', { cmc: 1, ci: 'R', tg: ['removal'], er: 30 }),
    mk('Grizzly Bears', 'Creature — Bear', '', { ci: 'G', pt: '2/2', er: 1 }),
    mk('Thalia, Guardian of Thraben', 'Legendary Creature — Human Soldier', 'First strike\nNoncreature spells cost {1} more to cast.', { pt: '2/1', kw: ['First strike'], er: 40 }),
    mk('Blood Artist', 'Creature — Vampire', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', { ci: 'B', pt: '0/1', tg: ['lifegain'], er: 50 }),
    mk('Viscera Seer', 'Creature — Vampire Wizard', 'Sacrifice a creature: Scry 1.', { cmc: 1, ci: 'B', pt: '1/1', tg: ['sacrifice'], er: 60 }),
    mk('Sword of Fire and Ice', 'Artifact — Equipment', 'Equipped creature gets +2/+2 and has protection from red and from blue.\nEquip {2}', { cmc: 3, ci: '', tg: ['protection'], er: 70 }),
    mk('Teysa Karlov', 'Legendary Creature — Human Advisor', 'If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nWhenever a creature you control dies, each opponent loses 1 life.', { cmc: 4, ci: 'WB', pt: '2/4', er: 80 })]
  const data = prepData({ formats: F }, cards, [], new ArrayBuffer(0), new ArrayBuffer(0)), T = { types: CREATURE_TYPES }
  const ctx = { bit: -1, identity: null, allowUn: false }
  const top = (k, n = 3) => likeCards(data, { arch: [k] }, ctx, n).map(c => c.n)
  for (const [qs, k, first] of [[['control', 'controlo', 'Kontrolle', 'control other decks', 'controlar', '控制'], 'control', 'Counterspell'],
    [['burn', 'queimar', 'dano direto', 'quemar', '直伤'], 'burn', 'Lightning Bolt'], [['wipe', 'limpar a mesa', 'wipe everything', 'destruction', 'destruir tudo', 'wrath', '清场'], 'wipe', 'Wrath of God'],
    [['stax', 'impedir', 'prison', 'prisão'], 'stax', 'Thalia, Guardian of Thraben'], [['aristocrats', 'aristocratas', 'Aristokraten', 'sacrificar'], 'aristocrats', 'Blood Artist'], [['voltron', 'equipamentos e auras'], 'voltron', 'Sword of Fire and Ice']]) {
    for (const q of qs) { const th = likeTheme(data, q, T); assert.deepEqual(th.arch.map(x => x.k), [k], q); assert.deepEqual(th.colors, [], `${q}: as cores ficam livres`) }
    assert.equal(top(k)[0], first, k)
    assert.ok(!top(k, 9).includes('Grizzly Bears'), `${k}: a Grizzly Bears não serve`)
  }
  assert.ok(top('control').includes('Wrath of God'), 'controlo também limpa a mesa')
  assert.ok(top('aristocrats').includes('Viscera Seer'))
  assert.deepEqual(likeTheme(data, 'stealing cards', T).arch.map(x => x.k), ['steal'], 'a função com o mesmo nome é a estratégia')
  // pesquisa geral: «control» é estratégia; as funções continuam funções («removal forest», «robar el control»)
  assert.deepEqual(parseQuery('control').f, { arch: ['control'] })
  assert.deepEqual(parseQuery('Kontrolle übernehmen').f, { tags: ['steal'] })
  assert.deepEqual(search(data, '', parseQuery('wipe everything').f, ctx).cards.map(c => c.n), ['Wrath of God'])
  assert.equal(search(data, '', { arch: ['control'] }, ctx).cards[0].n, 'Counterspell', 'as que mais servem primeiro')
  // comandantes: o texto serve a estratégia
  assert.deepEqual(likeCommanders(data, { arch: ['aristocrats'] }, { fmt: FORMAT.commander, bit: -1 }).map(c => c.n), ['Teysa Karlov'])
  assert.ok(chipUniverse(data).archs.some(x => x.v === 'control'), 'a paleta tem as estratégias')
  console.log('selfcheck estratégias ok')
}
{ const { selfcheck } = await import('./src/alterart.js'); selfcheck(assert); console.log('selfcheck alter art (pedido e caixas da arte) ok') }
{ const { selfcheck } = await import('./src/upscale.js'); selfcheck(assert); console.log('selfcheck ampliar (ladrilhos) ok') }
{ const { selfcheck } = await import('./src/alterbatch.js'); selfcheck(assert); console.log('selfcheck alter arts em lote (custo, fila, nomes dos ficheiros) ok') }
{ const { selfcheck } = await import('./src/epic.js'); const { prepData } = await import('./src/data.js'); selfcheck(assert, prepData); console.log('selfcheck nomes épicos (Teval, Beckett, Izzet tempo; comandante; línguas) ok') }

{ // proxies: o que entra de cada deck (só o maybeboard, deck + maybeboard, sem o principal)
  const { proxyGroups } = await import('./src/deck.js')
  const d = { commanders: ['Atraxa, Praetors\' Voice'], main: { 'Sol Ring': 1 }, side: { 'Lightning Bolt': 2 }, maybe: { Forest: 3 } }
  const n = o => proxyGroups(d, data, o).map(g => `${g.q} ${g.c.n}`).sort()
  assert.deepEqual(n({ main: false, side: false, maybe: true }), ['3 Forest'])
  assert.deepEqual(n({ side: false, maybe: true }), ['1 Atraxa, Praetors\' Voice', '1 Sol Ring', '3 Forest'])
  assert.deepEqual(n({}), ['1 Atraxa, Praetors\' Voice', '1 Sol Ring', '2 Lightning Bolt'])
  console.log('selfcheck proxies por zona ok')
}

// Intenção explícita (data.js intentTerms/intentHit, newdeck.js): os temas pedidos e o que as cartas de partida partilham;
// um payoff que fala do tema conta como do tema; o comandante desligado deixa de puxar a tribo dele. Cartas inventadas.
{ const { prepData, intentTerms, intentHit, recommend } = await import('./src/data.js')
  const { likeSeedTerms } = await import('./src/newdeck.js')
  const mk = (n, t, o = '', x = {}) => ({ n, t, o, mc: '{1}{G}', cmc: 2, ci: 'G', co: 'G', lg: 1 << 6, rs: 0, r: 'c', tg: [], kw: [], er: 100, un: 0, pt: '0/4', ...x })
  const cards = [mk('Wall A', 'Creature — Wall', 'Defender', { kw: ['Defender'] }), mk('Wall B', 'Creature — Plant Wall', 'Defender', { kw: ['Defender'] }), mk('Wall C', 'Creature — Wall', 'Defender', { kw: ['Defender'] }),
    mk('Formation', 'Enchantment', 'Each creature you control assigns combat damage equal to its toughness rather than its power.'),
    mk('Wall Lord', 'Creature — Elf', 'Walls you control get +1/+1 and can attack as though they didn\'t have defender.'),
    mk('Hero Pal', 'Creature — Human Hero', 'Other Heroes you control get +1/+1.', { pt: '2/2' }), mk('Hero Two', 'Creature — Human Hero', '', { pt: '2/2' }),
    mk('Captain', 'Legendary Creature — Human Hero', 'Create a 0/3 Wall creature token with defender.', { cmc: 3, pt: '2/3' })]
  const data = prepData({ formats: F, dim: 1 }, cards, [], new Int8Array(cards.length).fill(64).buffer, new ArrayBuffer(0))
  const I = n => cards.findIndex(c => c.n === n), T = intentTerms(data, { seeds: ['Wall A', 'Wall B', 'Wall C'] })
  assert.deepEqual(T.filter(t => t.k === 'sub').map(t => t.v), ['Wall'], 'as cartas de partida: Wall (Plant só numa)')
  assert.ok(T.some(t => t.k === 'kw' && t.v === 'Defender'))
  assert.ok(intentHit(cards[I('Wall Lord')], T).rw > 0, 'fala de Walls: serve o tema')
  assert.equal(intentHit(cards[I('Hero Pal')], T).sw + intentHit(cards[I('Hero Pal')], T).rw, 0)
  // ★ vale mais, os relacionados menos; estratégias entram como termos
  const st = likeSeedTerms({ terms: [{ k: 'sub', v: 'Wall', u: 1 }, { k: 'kw', v: 'Defender' }], arch: ['aggro'], tags: [] }, ['t:kw:Defender'])
  assert.deepEqual(st, [{ k: 'kw', v: 'Defender', s: 1 }, { k: 'sub', v: 'Wall' }, { k: 'arch', v: 'aggro' }])
  assert.deepEqual(intentTerms(data, { seedTerms: st, seeds: ['Hero Pal', 'Hero Two', 'Captain'] }).map(t => t.w), [1.5, 1, 1], 'com temas escritos as sementes não inventam tribo')
  const seeds = [I('Captain'), I('Wall A'), I('Wall B'), I('Wall C')], ctx = { bit: -1, identity: 'G', allowUn: false }
  const rec = prefs => recommend(data, { seeds, have: seeds, ctx, filters: { noLands: true }, seedTerms: T, commanders: [I('Captain')], prefs, limit: 9 })
  const top = rec({}).map(r => r.c.n)
  assert.ok(top.indexOf('Wall Lord') < top.indexOf('Hero Pal'), 'o payoff das muralhas antes da tribo do comandante: ' + top)
  assert.ok(rec({ cmdTipo: false }).find(r => r.c.n === 'Hero Pal').parts.tipoCmd < 0, 'sem o tipo do comandante, um Human Hero fora do tema desce')
  assert.equal(rec({ cmdTexto: false }).find(r => r.c.n === 'Hero Pal').parts.comandante, 0, 'sem o texto do comandante, a semelhança com ele não conta')
  console.log('selfcheck intenção explícita (temas, ★, sementes, comandante desligado) ok')
}
// 🎨 Artes do tema (themeart.js): o universo do comandante (Marneus Calgar → 40K) ou do «Gosto de…» (Transformers); só
// as cartas com impressão lá, sem tocar nas artes próprias nem nas escolhidas à mão; pedidos à Scryfall de 75 em 75.
{ const { prepData, fetchThemePrints } = await import('./src/data.js')
  const { setVocab } = await import('./src/vocab.js')
  const { artThemes, themeOptions, themePlan, applyTheme, chunks, bestPrint, findThemes } = await import('./src/themeart.js')
  const mk = (n, t = 'Artifact') => ({ n, t, o: '', mc: '', cmc: 1, ci: '', co: '', lg: 1 << 6, rs: 0, r: 'r', tg: [], kw: [], er: 10, un: 0 })
  const names = ['Marneus Calgar', 'Sol Ring', 'Command Tower', 'Arcane Signet', 'Swords to Plowshares', 'Plains', 'Lightning Bolt', 'Optimus Prime, Hero', 'Blightsteel Colossus', 'Atraxa, Praetors\' Voice']
  const cards = names.map(n => mk(n)), I = n => names.indexOf(n)
  const delta = ns => ns.map(I).sort((a, b) => a - b).map((x, k, l) => x - (k ? l[k - 1] : 0))
  const sets = [['40k', 'Warhammer 40,000 Commander', '2022', 'commander', [], delta(['Marneus Calgar', 'Sol Ring', 'Command Tower', 'Arcane Signet', 'Swords to Plowshares', 'Plains'])],
    ['bot', 'Transformers', '2022', 'eternal', [], delta(['Optimus Prime, Hero'])], ['sld', 'Secret Lair Drop', '2019', 'box', [], delta(['Blightsteel Colossus'])],
    ['c16', 'Commander 2016', '2016', 'commander', [], delta(['Atraxa, Praetors\' Voice', 'Sol Ring'])], ['lea', 'Limited Edition Alpha', '1993', 'core', [], delta(['Sol Ring', 'Swords to Plowshares', 'Plains', 'Lightning Bolt'])]]
  const pos = Object.fromEntries(sets.map((s, k) => [s[0], k]))
  const first = names.map(n => pos[{ 'Marneus Calgar': '40k', 'Optimus Prime, Hero': 'bot', 'Blightsteel Colossus': 'sld', 'Atraxa, Praetors\' Voice': 'c16', 'Command Tower': '40k', 'Arcane Signet': '40k' }[n] || 'lea'])
  const fr = JSON.parse(readFileSync(new URL('../build/franchises.json', import.meta.url), 'utf8')).franchises
    .map(f => [f.id, f.name, f.sets.filter(s => pos[s] != null), f.alias, f.id === 'bot' ? [I('Blightsteel Colossus')] : []])
  const fl = [[I('Blightsteel Colossus'), 'Megatron', 'sld', '1079', 'b1']]
  const data = prepData({ formats: F }, cards, [], new ArrayBuffer(0), new ArrayBuffer(0))
  assert.ok(setVocab({ n: cards.length, sets, first, fr, fl, types: {} }, cards))
  const base = { commanders: [], main: {}, side: {}, maybe: {}, prints: {}, art: {}, split: {}, seedTerms: [] }
  const mar = { ...base, commanders: ['Marneus Calgar'], main: { 'Sol Ring': 1, 'Command Tower': 1, 'Arcane Signet': 1, 'Swords to Plowshares': 1, Plains: 10, 'Lightning Bolt': 1 } }
  const th = artThemes(data, mar)
  assert.deepEqual(th.map(t => [t.v, t.tag, t.from, t.sets]), [['40k', '40K', 'cmd', ['40k']]], 'Marneus Calgar → Warhammer 40,000')
  assert.equal(th[0].name, 'Warhammer 40,000')
  assert.deepEqual(artThemes(data, { ...base, commanders: ['Atraxa, Praetors\' Voice'] }), [], 'comandante de uma edição normal: sem tema automático')
  assert.deepEqual(themeOptions(data, { ...base, commanders: ['Atraxa, Praetors\' Voice'] }).map(t => [t.v, t.from]), [['c16', 'cmdset']], 'mas a edição dele aparece para escolher')
  const tf = { ...base, commanders: ['Atraxa, Praetors\' Voice'], seedTerms: [{ k: 'sub', v: 'Robot' }, { k: 'set', v: 'bot' }], main: { 'Blightsteel Colossus': 1, 'Optimus Prime, Hero': 1, 'Sol Ring': 1 } }
  assert.equal(artThemes(data, tf)[0].v, 'bot', '«Gosto de transformers» → Transformers')
  assert.ok(findThemes('warhammer').some(t => t.v === '40k') && findThemes('40k').some(t => t.v === '40k'), 'pesquisa por nome e por código')
  // Transformers: o Optimus pede-se à Scryfall; o Blightsteel já tem a impressão Megatron (sem rede)
  const pt = themePlan(data, tf, artThemes(data, tf)[0])
  assert.deepEqual(pt.items.map(x => [x.n, x.set || x.print.id]).sort(), [['Blightsteel Colossus', 'b1'], ['Optimus Prime, Hero', 'bot']])
  // 40K: arte própria fica sempre; impressão escolhida à mão e básicos com as favoritas (split) ficam salvo «substituir»
  const d40 = { ...mar, art: { 'Swords to Plowshares': 'https://x/own.png' }, prints: { 'Command Tower': { id: 'ct', set: 'CMR', cn: '350' }, 'Arcane Signet': { id: 'as', set: 'BOT', cn: '9', theme: 'bot' } }, split: { Plains: [{ id: 'p1', q: 5 }, { id: 'p2', q: 5 }] } }
  const p1 = themePlan(data, d40, th[0])
  assert.deepEqual(p1.items.map(x => x.n).sort(), ['Arcane Signet', 'Marneus Calgar', 'Sol Ring'], 'a de outro tema muda; Bolt não tem impressão 40K')
  assert.deepEqual(p1.skip, { own: 1, chosen: 2, have: 0 })
  const p2 = themePlan(data, d40, th[0], { replace: true })
  assert.deepEqual(p2.items.map(x => x.n).sort(), ['Arcane Signet', 'Command Tower', 'Marneus Calgar', 'Plains', 'Sol Ring'], 'substituir: as escolhidas também, a arte própria não')
  const pr = (id, style = []) => ({ id, set: '40K', cn: id, style, eur: 1 })
  const found = new Map([['sol ring', pr('s40')], ['marneus calgar', pr('m40')], ['arcane signet', pr('a40')], ['command tower', pr('c40')], ['plains', pr('pl40')]])
  const r1 = applyTheme(d40, th[0], p1.items, found)
  assert.equal(r1.n, 3)
  assert.deepEqual([r1.deck.prints['Sol Ring'].id, r1.deck.prints['Sol Ring'].theme, r1.deck.prints['Sol Ring'].foil, r1.deck.prints['Command Tower'].id, r1.deck.split.Plains.length], ['s40', '40k', false, 'ct', 2])
  assert.equal(themePlan(data, r1.deck, th[0]).items.length, 0, 'aplicado: nada mais muda (2.ª vez)')
  assert.equal(themePlan(data, r1.deck, th[0]).skip.have, 3)
  // o deck mudou durante o pedido (escolheu-se uma arte à mão): fica a escolhida
  assert.equal(applyTheme({ ...d40, prints: { ...d40.prints, 'Sol Ring': { id: 'mine', set: 'LEA', cn: '1' } } }, th[0], p1.items, found).deck.prints['Sol Ring'].id, 'mine')
  const r2 = applyTheme(d40, th[0], p2.items, found, { replace: true })
  assert.deepEqual([r2.n, r2.deck.prints.Plains.id, r2.deck.split.Plains, r2.deck.prints['Command Tower'].id, r2.deck.prints['Swords to Plowshares']], [5, 'pl40', undefined, 'c40', undefined])
  assert.equal(bestPrint([pr('b', ['Sem margem']), pr('r')]).id, 'r', 'moldura normal antes de sem margem/showcase')
  assert.equal(bestPrint([pr('b', ['Showcase'])]).id, 'b', 'só showcase: serve')
  // pedidos: de 75 em 75 com {name, set}, ~100 ms entre eles; sem rede lança (a app mostra o aviso)
  assert.deepEqual(chunks([...Array(160).keys()]).map(l => l.length), [75, 75, 10])
  const sent = [], f0 = globalThis.fetch
  globalThis.fetch = async (url, o) => { const ids = JSON.parse(o.body).identifiers; sent.push([url, ids.length, Date.now()]); assert.ok(ids.every(x => x.name && x.set && !x.id && !x.name.includes(' // '))); return { ok: true, json: async () => ({ data: ids.map((x, k) => ({ id: `${x.name}-${k}`, name: x.name, set: x.set, collector_number: String(k), prices: {}, digital: false })) }) } }
  const many = [...Array(159).keys()].map(k => ({ n: `Card ${k}`, set: '40k' })).concat({ n: 'Optimus Prime, Hero // Optimus Prime, Autobot Leader', set: 'bot' })
  const got = await fetchThemePrints(many)
  assert.deepEqual(sent.map(s => [s[0], s[1]]), [['https://api.scryfall.com/cards/collection', 75], ['https://api.scryfall.com/cards/collection', 75], ['https://api.scryfall.com/cards/collection', 10]])
  assert.ok(sent[2][2] - sent[0][2] >= 190, 'espera entre pedidos')
  assert.equal(got.get('card 7').set, '40K')
  assert.equal(got.get('optimus prime, hero')?.set, 'BOT', 'dupla face pedida pela face da frente')
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(fetchThemePrints([{ n: 'Sol Ring', set: '40k' }]))
  globalThis.fetch = f0
  setVocab(null, cards)
  assert.deepEqual(artThemes(data, mar), [], 'sem vocabulário: sem tema, nada parte')
  console.log('selfcheck artes do tema (40K pelo comandante, Transformers pelo «Gosto de», escolhidas à mão, lotes de 75) ok')
}
// Os casos reais (deckeval.mjs --fast: Invisible Woman + muralhas, Morophon + changelings), quando há dados locais.
{ const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, [new URL('./deckeval.mjs', import.meta.url).pathname, '--check', '--fast'], { encoding: 'utf8', timeout: 600000 })
  process.stdout.write(r.stdout.split('\n').filter(l => /^[✓✗]|deckeval/.test(l)).map(l => `  ${l}\n`).join(''))
  assert.equal(r.status, 0, 'deckeval --fast: ' + (r.stdout + r.stderr).slice(-600))
}
