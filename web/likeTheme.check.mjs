// Verificação do «Gosto de…» com os dados reais (node web/likeTheme.check.mjs); salta se não houver dados locais.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { prepData, CREATURE_TYPES } from './src/data.js'
import { likeTheme, likeCards } from './src/nlsearch.js'
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
assert.deepEqual(likeTheme(data, 'xyzzy', { types }), { terms: [], colors: [], tags: [] })
const cs = likeCards(data, { ...n, terms: n.terms.slice(0, 1), star: n.terms.slice(0, 1), colors: n.colors.map(x => x.k) }, { bit: -1, identity: null, allowUn: false })
assert.equal(cs.length, 12); assert.ok(cs.every(c => /Ninja/.test(c.t)))
console.log('likeTheme ok', n.terms.map(t => t.v).join(','), n.colors.map(x => x.k).join(''), n.tags.map(x => x.k).join(','))
