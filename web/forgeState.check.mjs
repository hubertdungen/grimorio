// Verificação do conversor da repetição para o Forge (node web/forgeState.check.mjs).
import assert from 'node:assert'
import { initialState } from './src/game.js'
import { toForgeState } from './src/forgeState.js'
const s = initialState(20, { a: { commanders: ['Krenko, Mob Boss'], size: 99 }, b: { size: 60 } })
s.turn = 3; s.active = 'b'; s.phase = 'combat'
s.a = { ...s.a, hand: 3, known: ['Lightning Bolt'], library: 10, graveyard: ['Shock', null],
  perms: [{ key: 'a1', name: 'Mountain', tapped: true }, { key: 'a2', name: 'Krenko, Mob Boss', counters: { '+1/+1': 1 } }, { key: 'a3', name: 'Bonesplitter', attachedTo: 'a2' }, { key: 'a4', name: 'Rancor', attachedTo: 'zz' }, { key: 'a5', name: 'Goblin Token', token: true, pt: '1/1' }],
  command: [{ name: 'Krenko, Mob Boss', casts: 1, out: true }] }
const decks = { a: { main: { Mountain: 30, 'Lightning Bolt': 4, Shock: 4, Bonesplitter: 1, Rancor: 1 }, commanders: ['Krenko, Mob Boss'] }, b: { main: { Island: 60 } } }
const r = toForgeState(s, decks, { control: 'a', format: 'commander', rng: () => 0.5 })
const a = r.state.a
assert.equal(a.hand.length, 3); assert.equal(a.hand[0], 'Lightning Bolt')
assert.equal(a.library.length, 10)
assert.deepEqual(a.graveyard, ['Shock'])
assert.deepEqual(a.command, []); assert.deepEqual(a.commanders, [{ name: 'Krenko, Mob Boss', casts: 1 }])
assert.equal(a.battlefield.find(p => p.id === 'a2').commander, true)
assert.equal(a.battlefield.find(p => p.id === 'a3').attachedTo, 'a2')
assert.equal(a.battlefield.find(p => p.id === 'a4').attachedTo, null)
const pool = [...a.hand, ...a.library].filter(n => n === 'Lightning Bolt').length
assert.ok(pool <= 4)
assert.equal(r.state.b.library.length, 53); assert.equal(r.state.b.hand.length, 7)
assert.equal(r.control, 'a'); assert.equal(r.state.active, 'b')
console.log('forgeState: ok')
