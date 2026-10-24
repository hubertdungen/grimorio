// Trocas inteligentes em decks reais (só leitura do servidor local): `node web/swap.check.mjs`
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'

const DATA = `${os.homedir()}/.local/share/grimorio/data`
const SERVER = 'http://127.0.0.1:8107'
globalThis.fetch = (orig => async (url, opts) => {
  const u = String(url)
  if (u.startsWith('data/')) return new Response(fs.readFileSync(`${DATA}/${u.slice(5)}`), { status: 200 })
  return orig(u.startsWith('/') ? SERVER + u : url, opts)
})(globalThis.fetch)

const { loadData, fmtBit, recommend, deckPlan, deckCombos, comboTurn, fetchEdh } = await import('./src/data.js')
const { FORMAT, targetsFor } = await import('./src/formats.js')
const { stats, deckIndices, emptyDeck } = await import('./src/deck.js')
const { prepareSwaps, applySwap, gameEvidence, WIN_LABEL } = await import('./src/swap.js')

const data = await loadData()
const J = async u => (await fetch(u)).json()
const list = await J('/api/decks')
const WANT = [/MechDrainers/, /Counter'n'Resurrect 2\.0/, /Counter'n'Resurrect \(Anti-Spell\)/, /LV-426/, /SPQR — IMPERIUM/, /Necropolis Greed — Archive/, /Trump Wall/]
const decks = []
for (const re of WANT) {
  const m = list.find(d => re.test(d.name))
  if (!m) continue
  const deck = { ...emptyDeck(), ...(await J(`/api/decks/${m.id}`)) }
  // jogos guardados do Laboratório (as últimas 8 sessões, como loadTests)
  const runs = await J(`/api/sim/runs?deck_id=${m.id}`)
  const bodies = await Promise.all(runs.slice(0, 8).map(r => J(`/api/sim/runs/${r.id}`)))
  decks.push({ deck, games: bodies.flatMap(b => (b.runs || []).flatMap(r => r.games || [])) })
}
assert.ok(decks.length >= 4, 'faltam decks no servidor')

// EDHREC do comandante, como useEdhrec (Views.jsx), pelo proxy do servidor
async function coFor(deck) {
  const m = new Map()
  for (const n of deck.commanders) {
    const d = await fetchEdh('commanders', n)
    for (const [x, num, pot, lift, syn] of d.cards || []) {
      const c = data.byName.get(x) || data.byLower.get(x.toLowerCase())
      if (c && pot) (m.get(c.i) || m.set(c.i, []).get(c.i)).push({ kind: 'commanders', from: n, incl: num / pot, pot, lift, syn })
    }
  }
  return m.size ? m : null
}
function setup(deck, evidence = null, co = null) {
  const fmt = FORMAT[deck.format] || FORMAT.casual
  const cmd = deck.commanders.map(n => data.byName.get(n)).filter(Boolean)
  const ctx0 = { bit: fmtBit(data, fmt), identity: fmt.cmd && cmd.length ? cmd.map(c => c.ci).join('') : null, allowUn: false, tests: evidence }
  const spells = Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land')
  const ctx = fmt.cmd ? ctx0 : { ...ctx0, identity: [...new Set(spells.flatMap(c => [...c.ci]))].join('') }
  const have = deckIndices(deck, data), cmdIdx = cmd.map(c => c.i)
  const seeds = [...cmdIdx, ...spells.map(c => c.i).reverse()]
  const deckStats = stats(deck, data)
  const needs = Object.fromEntries(Object.entries(targetsFor(fmt, deckPlan(data, have), deck.prefs)).map(([t, n]) => [t, [deckStats.tags[t] || 0, n]]))
  const recs = recommend(data, { seeds, have, ctx, filters: { noLands: true }, limit: 20, commanders: cmdIdx, needs, co, deckStats, deckSize: fmt.size[0] >= 99 ? 99 : 60, turn: comboTurn(fmt) })
  const protectedNames = new Set([...deck.commanders, ...(deck.seeds || []), ...deckCombos(data, have, ctx).full.flatMap(x => x.cb[1].map(i => data.cards[i].n))])
  return { fmt, ctx, recs, protectedNames }
}

const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
const show = (label, opts) => {
  console.log(`  + ${label}  ${opts.length ? '' : '→ ' + opts.none}`)
  for (const o of opts) console.log(`      ⇄ ${o.q}× ${pad(o.out, 28)} [${o.kind} ${o.score}${o.eur != null ? ` ${o.eur >= 0 ? '+' : ''}${o.eur}€` : ''}] ${o.why.join(' · ')}`)
  for (const k of opts.kept || []) console.log(`      ✋ ${k.n}: ${k.why}`)
}

for (const { deck, games } of decks) {
  let t = performance.now()
  const evidence = games.length ? gameEvidence(data, games) : null
  const tEv = performance.now() - t
  const co = deck.commanders.length ? await coFor(deck) : null
  const { fmt, ctx, recs, protectedNames } = setup(deck, evidence, co)
  t = performance.now()
  const sw = prepareSwaps(data, deck, fmt, ctx, { co })
  const tPrep = performance.now() - t
  assert.equal(prepareSwaps(data, deck, fmt, ctx, { co }), sw, 'memo por deck')
  t = performance.now()
  const all = recs.map(r => [r, sw(r.c)])
  const tEach = (performance.now() - t) / recs.length
  const wc = evidence?.wincon ? `ganha por ${WIN_LABEL[evidence.wincon.kind]} (${evidence.wins}/${evidence.games} jogos ganhos)` : `${games.length} jogos guardados`
  console.log(`\n■ ${deck.name} (${fmt.key}) — ${wc}; provas ${tEv.toFixed(1)} ms, preparar ${tPrep.toFixed(1)} ms, ${tEach.toFixed(3)} ms por sugestão`)
  for (const [r, opts] of all.slice(0, 5)) show(`${pad(r.c.n, 30)} MV${r.c.cmc}`, opts)
  assert.ok(tEach < 5, `lento: ${tEach} ms`)
  // nunca: comandantes, sementes, peças de combo; nunca terreno por feitiço ou vice-versa; nunca falar de dano se não ganha por dano
  for (const [r, opts] of all) for (const o of opts) {
    assert.ok(!protectedNames.has(o.out), `${o.out} está protegida`)
    const out = data.byName.get(o.out)
    assert.equal(out.mt === 'Land', r.c.mt === 'Land', `${r.c.n} ⇄ ${o.out}: terreno por feitiço`)
    assert.ok(o.q >= 1 && o.q <= (deck[o.zone][o.out] || 0), 'cópias')
    assert.ok(o.why.length >= 1)
    // «mesmo papel» só entre cartas do mesmo tipo (criatura por criatura, feitiço por feitiço)
    if (/^Mesmo papel/.test(o.why[0])) assert.equal(out.mt === 'Creature', r.c.mt === 'Creature', `${r.c.n} ⇄ ${o.out}: papel trocado entre criatura e feitiço`)
    if (evidence?.wincon && !/damage/.test(evidence.wincon.kind)) assert.ok(!o.why.some(w => /dano/.test(w)), 'falou de dano')
  }
  // remoção barata → sai uma remoção igual ou mais cara
  const inDeck = new Set(Object.keys(deck.main))
  const removal = data.cards.filter(c => /Instant|Sorcery/.test(c.t) && c.tg.includes('removal') && /destroy target|exile target (creature|nonland|permanent)|deals? \d+ damage to (target|any)/.test(c.o) && c.cmc <= 1 && c.er && !inDeck.has(c.n) && !c.tg.includes('hate') && c.lg & (1 << ctx.bit) && [...c.ci].every(k => ctx.identity.includes(k)))
    .sort((a, b) => a.er - b.er)[0]
  if (removal) {
    const rs = sw(removal)
    show(`remoção ${removal.n} (MV${removal.cmc})`, rs)
    if (rs.length && rs[0].kind !== 'linha fraca') { const o = data.byName.get(rs[0].out); assert.ok(o.tg.includes('removal') && o.cmc >= removal.cmc, `${removal.n}: devia sair uma remoção igual ou mais cara, saiu ${o.n}`) }
    // remoção pontual nunca tira um wipe
    for (const o of rs) assert.ok(!/(destroy|exile) all|all (other )?creatures get -|damage to each creature/i.test(data.byName.get(o.out).o), `${removal.n} ⇄ ${o.out}: wipe por remoção pontual`)
  }
  // terreno → sai um terreno
  const land = data.cards.find(c => c.mt === 'Land' && !/Basic/.test(c.t) && !inDeck.has(c.n) && c.lg & (1 << ctx.bit) && c.ci.length >= 1 && [...c.ci].every(k => ctx.identity.includes(k)) && c.er && c.er < 400)
  if (land) { const ls = sw(land); show(`terreno ${land.n}`, ls); for (const o of ls) assert.equal(data.byName.get(o.out).mt, 'Land') }
}

// --- Jogos sintéticos: a via de vitória de cada deck decide o que fica e como se explica ---
// e: eventos mínimos no formato do Forge (turn/hd/cast/trigger/mill/damage/life/block/outcome)
function game({ won, reason, hand = [], turns = 6, cast = [], extra = [] }) {
  const ev = [{ t: 0, k: 'mulligan', p: 'a', hd: { a: hand } }]
  for (let k = 1; k <= turns; k++) {
    ev.push({ t: 2 * k - 1, k: 'turn', p: 'a', hd: { a: hand.filter(n => !cast.some(c => c[1] === n && c[0] <= k)) } }, { t: 2 * k - 1, k: 'phase', ph: 'main1' })
    for (const [tt, n] of cast) if (tt === k) ev.push({ t: 2 * k - 1, k: 'cast', p: 'a', card: n })
    for (const x of extra.filter(x => x.turn === k)) ev.push(...x.ev)
  }
  ev.push({ t: 99, k: 'outcome', p: won ? 'b' : 'a', txt: `X has lost because ${reason}` })
  return { winner: won ? 'a' : 'b', reason: `X has lost because ${reason}`, exact: true, events: ev, startLife: 20, summary: { a: { used: cast.map(c => c[1]), cast: cast.map(([t, n]) => [2 * t - 1, n]) } } }
}
const mill = (src, n) => [{ k: 'trigger', p: 'a', card: src }, ...Array.from({ length: n }, () => ({ k: 'mill', p: 'b', card: 'x', x: 1 }))]
{
  // Necropolis Greed: ganha a moer; Hedron Crab mói 42 → fica; Jace, the Perfected Mind preso na mão em derrotas → sai
  const nec = decks.find(x => /Necropolis/.test(x.deck.name))?.deck
  const won = (k) => game({ won: true, reason: 'attempted to draw a card from a library with no cards in it', hand: ['Hedron Crab', 'Jace, the Perfected Mind', 'Fractured Sanity'], cast: [[1, 'Hedron Crab'], [3, 'Fractured Sanity']], extra: [{ turn: 2, ev: mill('Hedron Crab', 14 + k) }, { turn: 3, ev: mill('Fractured Sanity', 12) }] })
  const lost = () => game({ won: false, reason: 'life total reached 0', hand: ['Jace, the Perfected Mind', 'Fatal Push', 'Ruin Crab'], cast: [[1, 'Ruin Crab'], [2, 'Fatal Push']] })
  const ev = gameEvidence(data, [won(0), won(1), won(-1), lost(), lost(), lost()])
  assert.equal(ev.wincon.kind, 'mill')
  assert.equal(ev.cards['Hedron Crab'].units, 42)
  const { fmt, ctx } = setup(nec, ev)
  const sw = prepareSwaps(data, nec, fmt, ctx)
  console.log(`\n■ ${nec.name} (sintético: ganha por ${WIN_LABEL[ev.wincon.kind]}, 3/6)`)
  const crab = sw(data.byLower.get('merfolk secretkeeper'))
  show('Merfolk Secretkeeper MV1', crab)
  assert.ok(!crab.some(o => o.out === 'Hedron Crab') && crab.kept.some(k => k.n === 'Hedron Crab' && /moeu 42 cartas/.test(k.why)), 'Hedron Crab fica')
  const jace = sw(data.byName.get('Glimpse the Unthinkable'))
  show('Glimpse the Unthinkable MV2', jace)
  assert.ok(jace.some(o => o.out === 'Jace, the Perfected Mind' && o.why.some(w => /3 derrotas sem ser lançada/.test(w))), 'Jace sai')
  for (const o of [...crab, ...jace]) assert.ok(!o.why.some(w => /dano/.test(w)))
}
{
  // Trump Wall: ganha por dreno (Bloodrite Invoker) e segura com bloqueios; Wall of Glare bloqueia 6 vezes nas vitórias → fica
  const tw = decks.find(x => /Trump Wall/.test(x.deck.name))?.deck
  const blocks = n => Array.from({ length: n }, () => ({ k: 'block', p: 'a', card: 'Wall of Glare' }))
  const drain = [{ k: 'activate', p: 'a', card: 'Bloodrite Invoker' }, { k: 'life', p: 'b', n: 12 }, { k: 'activate', p: 'a', card: 'Bloodrite Invoker' }, { k: 'life', p: 'b', n: 4 }, { k: 'activate', p: 'a', card: 'Bloodrite Invoker' }, { k: 'life', p: 'b', n: -4 }]
  const won = () => game({ won: true, reason: 'life total reached 0', hand: ['Wall of Glare', 'Bloodrite Invoker', 'Angelic Wall'], cast: [[1, 'Wall of Glare'], [3, 'Bloodrite Invoker']], extra: [{ turn: 2, ev: blocks(2) }, { turn: 6, ev: drain }] })
  const ev = gameEvidence(data, [won(), won(), won(), game({ won: false, reason: 'life total reached 0', hand: ['Angelic Wall', 'Wall of Hope'], cast: [[2, 'Wall of Hope']] })])
  assert.equal(ev.wincon.kind, 'drain')
  const { fmt, ctx } = setup(tw, ev)
  const sw = prepareSwaps(data, tw, fmt, ctx)
  console.log(`\n■ ${tw.name} (sintético: ganha por ${WIN_LABEL[ev.wincon.kind]}, 3/4)`)
  const r = sw(data.byName.get('Wall of Roots'))
  show('Wall of Roots MV2', r)
  assert.ok(!r.some(o => ['Wall of Glare', 'Bloodrite Invoker'].includes(o.out)))
  assert.ok(r.kept.some(k => k.n === 'Wall of Glare'), 'Wall of Glare fica')
  assert.ok(ev.cards['Wall of Glare'].blockW === 6 && ev.cards['Bloodrite Invoker'].units === 72)
  assert.ok(r.some(o => o.out === 'Angelic Wall' && o.why.some(w => /3 jogos ganhos nunca a lançaste/.test(w))), 'Angelic Wall sai')
}

// Trump Wall: muralhas de mana não trocam por remoção; ramp sai por ramp
{
  const tw = decks.find(x => /Trump Wall/.test(x.deck.name))?.deck
  const { fmt, ctx } = setup(tw)
  const sw = prepareSwaps(data, tw, fmt, ctx)
  for (const n of ['Wall of Roots', 'Tinder Wall']) {
    const r = sw(data.byName.get(n))
    show(`${n} (Trump Wall)`, r)
    for (const o of r) if (data.byName.get(o.out).mt !== 'Creature') assert.ok(!['mesmo papel', 'mais caro'].includes(o.kind) && !/^Mesmo papel/.test(o.why[0]), `${n} ⇄ ${o.out}: «mesmo papel» com uma não-criatura`)
    const ramp = r.find(o => /^Mesmo papel \(ramp\)/.test(o.why[0]))
    if (r.length && r[0].kind !== 'linha fraca') assert.ok(!ramp || data.byName.get(ramp.out).tg.includes('ramp'))
  }
}

// Cópias e applySwap.
{
  const fmt = FORMAT.modern, ctx = { bit: fmtBit(data, fmt), identity: null, tests: null }
  const d = { ...emptyDeck('modern'), main: { 'Lightning Bolt': 4, 'Searing Spear': 4, Mountain: 20 }, side: { Smash: 2 } }
  assert.ok(prepareSwaps(data, d, fmt, ctx)(data.byName.get('Lightning Bolt')).none, 'já tem 4')
  const a = applySwap(d, 'Lava Spike', 'Searing Spear', 3)
  assert.deepEqual(a.main, { 'Lightning Bolt': 4, 'Searing Spear': 1, Mountain: 20, 'Lava Spike': 3 })
  assert.deepEqual(applySwap(d, 'Shatter', 'Smash', 5).side, { Shatter: 2 })
  assert.equal(applySwap(d, 'X', 'Nada', 1), d)
  assert.deepEqual(applySwap({ ...d, commanders: ['A'] }, 'B', 'A').commanders, ['B'])
}
console.log('\nswap check ok')
