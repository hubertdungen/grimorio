// Verificação do «Gosto de…» com os dados reais (node web/likeTheme.check.mjs); salta se não houver dados locais.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { prepData, CREATURE_TYPES } from './src/data.js'
import { likeTheme, likeCards, likeCommanders, chipUniverse } from './src/nlsearch.js'
import { FORMAT } from './src/formats.js'
const dir = `${process.env.GRIMORIO_DATA_DIR || `${os.homedir()}/.local/share/grimorio`}/data`
if (!fs.existsSync(`${dir}/cards.json`)) { console.log('likeTheme: sem dados locais, saltado'); process.exit(0) }
const j = f => JSON.parse(fs.readFileSync(`${dir}/${f}`))
const b = f => { const x = fs.readFileSync(`${dir}/${f}`); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length) }
const data = prepData(j('meta.json'), j('cards.json'), j('combos.json'), b('emb.bin'), b('pos.bin'))
const types = CREATURE_TYPES
const has = (r, k, v) => r.terms.some(t => t.k === k && t.v === v)
const n = likeTheme(data, 'Ninjas', { types })
assert.ok(has(n, 'sub', 'Ninja') && has(n, 'kw', 'Ninjutsu'), JSON.stringify(n.terms))
assert.ok(['U', 'B'].every(k => n.colors.some(x => x.k === k)), JSON.stringify(n.colors))
assert.ok(has(likeTheme(data, 'dragões', { types }), 'sub', 'Dragon'))
assert.ok(has(likeTheme(data, 'dragons', { types }), 'sub', 'Dragon'))
assert.ok(has(likeTheme(data, 'elves e azul', { types }), 'sub', 'Elf'))
assert.ok(has(likeTheme(data, '忍者', { types }), 'sub', 'Ninja'))
const nd = likeTheme(data, 'ninjas drachen', { types }); assert.ok(has(nd, 'sub', 'Ninja') && has(nd, 'sub', 'Dragon'), JSON.stringify(nd.terms))
assert.ok(likeTheme(data, 'stealing cards', { types }).arch.some(x => x.k === 'steal'))  // a função Roubar vale a estratégia
assert.ok(likeTheme(data, 'Karten stehlen', { types }).arch.some(x => x.k === 'steal'))  // a função Roubar vale a estratégia
assert.ok(likeTheme(data, '偷牌', { types }).arch.some(x => x.k === 'steal'))  // a função Roubar vale a estratégia
const t0 = performance.now(); for (const q of ['humanos', 'soldados', 'wizards']) assert.ok(likeTheme(data, q, { types }).terms.length); assert.ok(performance.now() - t0 < 1500, 'lento: ' + (performance.now() - t0))
assert.deepEqual(likeTheme(data, 'xyzzy', { types }), { terms: [], colors: [], tags: [], arch: [], cards: [] })
const cs = likeCards(data, { ...n, terms: n.terms.slice(0, 1), star: n.terms.slice(0, 1), colors: n.colors.map(x => x.k) }, { bit: -1, identity: null, allowUn: false })
assert.equal(cs.length, 12); assert.ok(cs.every(c => /Ninja/.test(c.t)))
// Paleta completa: todos os chips dos dados reais (cores, tipos, subtipos, habilidades e funções).
const u = chipUniverse(data)
assert.equal(u.colors.length, 6, JSON.stringify(u.colors))
assert.ok(u.types.some(x => x.v === 'Creature'))
assert.ok(u.themes.length > 300 && u.themes.some(x => x.v === 'Ninja'), 'temas: ' + u.themes.length)
assert.ok(u.keywords.length > 300 && u.keywords.some(x => x.v === 'Flying') && u.keywords.some(x => x.v === 'Ninjutsu'), 'habilidades: ' + u.keywords.length)
assert.ok(u.tags.some(x => x.v === 'ramp') && u.tags.some(x => x.v === 'steal'))
// Comandantes do gosto: legais, lendários, dentro das cores e com Ninja (Yuriko e afins).
const cbit = data.meta.formats.indexOf('commander')
const csel = { ...n, colors: n.colors.map(x => x.k) }
const cmds = likeCommanders(data, csel, { fmt: FORMAT.commander, bit: cbit, n: 8 })
assert.ok(cmds.length > 0 && cmds.every(c => /Legendary/.test(c.t) && /Creature/.test(c.t)), cmds.map(c => c.n).join(','))
assert.ok(cmds.some(c => /Ninja/.test(c.t)), cmds.map(c => c.n).join(','))
const red = likeCommanders(data, { terms: [], colors: ['R'], tags: [] }, { fmt: FORMAT.commander, bit: cbit, n: 8 })
assert.ok(red.length > 0 && red.every(c => [...c.ci].every(k => k === 'R')), red.map(c => c.n + ':' + c.ci).join(','))
assert.deepEqual(likeCommanders(data, { terms: [], colors: [], tags: [] }, { fmt: FORMAT.commander, bit: cbit }), [])
console.log('chips', u.colors.length, u.types.length, u.themes.length, u.keywords.length, u.tags.length, '| comandantes', cmds.map(c => c.n.split(',')[0]).join(', '))
console.log('likeTheme ok', n.terms.map(t => t.v).join(','), n.colors.map(x => x.k).join(''), n.tags.map(x => x.k).join(','))
// Com cores pedidas, nem incolores nem fora da identidade.
assert.ok(likeCommanders(data, { terms: [], colors: ['W', 'B'], tags: [] }, { fmt: FORMAT.commander, bit: cbit, n: 18 }).every(c => c.ci && [...c.ci].every(k => 'WB'.includes(k))))
// Raridade e MV na paleta; não contam para escolher comandantes.
{
  const u = chipUniverse(data)
  assert.ok(u.rarities.length === 4 && u.mvs.length >= 7, JSON.stringify([u.rarities, u.mvs.length]))
  const cmd = likeCommanders(data, { terms: [{ k: 'rar', v: 'm' }], colors: ['B'], tags: [] }, { fmt: FORMAT.commander, bit: -1, n: 5 })
  assert.ok(cmd.length === 5 && cmd.every(c => !c.ci.includes('R')), 'rar não filtra comandantes')
}
// Estratégias com os dados reais: o chip certo e as cartas de sempre lá em cima
{
  const ctx = { bit: cbit, identity: null, allowUn: false }
  for (const [q, k, card] of [['control', 'control', 'Counterspell'], ['controlo', 'control', 'Counterspell'], ['Kontrolle', 'control', 'Counterspell'], ['burn', 'burn', 'Lightning Bolt'], ['queimar', 'burn', 'Lightning Bolt'],
    ['wipe', 'wipe', 'Wrath of God'], ['limpar a mesa', 'wipe', 'Wrath of God'], ['stax', 'stax', 'Thalia, Guardian of Thraben'], ['aristocrats', 'aristocrats', 'Blood Artist'], ['voltron', 'voltron', 'Lightning Greaves']]) {
    const th = likeTheme(data, q, { types })
    assert.deepEqual(th.arch.map(x => x.k), [k], q)
    const cs = likeCards(data, { arch: [k] }, ctx, 12).map(c => c.n)
    assert.ok(cs.includes(card), `${q}: ${cs.join(', ')}`)
  }
  console.log('estratégias ok')
}
