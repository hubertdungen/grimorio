// Sugestões pelo plano do deck, nos decks reais (só leitura do servidor local): `node web/plan.check.mjs`
// Como o painel de Sugestões (Views.jsx useDeckRecs): perfil de temas com as cópias do deck (synergy.js deckThemes).
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

const { loadData, fmtBit, recommend, deckPlan, comboTurn, fetchMeta, metaIndex, detectArchetype } = await import('./src/data.js')
const { FORMAT, targetsFor } = await import('./src/formats.js')
const { stats, deckIndices, emptyDeck } = await import('./src/deck.js')
const { deckThemes } = await import('./src/synergy.js')
const t0 = performance.now()

const data = await loadData()
const decks = (await (await fetch('/api/decks')).json()).map(d => ({ ...emptyDeck(), ...d })).filter(d => Object.keys(d.main || {}).length >= 12)
assert.ok(decks.length >= 5, 'faltam decks no servidor')

const isArt = c => /Artifact/.test(c.t.split(' // ')[0]), isEnch = c => /Enchantment/.test(c.t.split(' // ')[0])
const bad = []
let nEnch = 0, nArt = 0, nTri = 0, nEp = 0
const metas = {}
for (const deck of decks) {
  const fmt = FORMAT[deck.format] || FORMAT.casual
  const cmd = deck.commanders.map(n => data.byName.get(n)).filter(Boolean)
  const ctx0 = { bit: fmtBit(data, fmt), identity: fmt.cmd && cmd.length ? cmd.map(c => c.ci).join('') : null, allowUn: false }
  const spells = Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land')
  const ctx = fmt.cmd ? ctx0 : { ...ctx0, identity: [...new Set(spells.flatMap(c => [...c.ci]))].join('') }
  const have = deckIndices(deck, data), cmdIdx = cmd.map(c => c.i)
  const deckStats = stats(deck, data)
  const needs = Object.fromEntries(Object.entries(targetsFor(fmt, deckPlan(data, have), deck.prefs)).map(([t, n]) => [t, [deckStats.tags[t] || 0, n]]))
  const profile = deckThemes(data, deck).cats
  const meta = fmt.key in metas ? metas[fmt.key] : (metas[fmt.key] = metaIndex(data, await fetchMeta(fmt.key), fmt.name))  // torneios, como o painel
  const recs = recommend(data, { seeds: [...cmdIdx, ...spells.map(c => c.i).reverse()], have, ctx, filters: { noLands: true }, limit: 80, commanders: cmdIdx, needs, deckStats, meta, archetype: detectArchetype(meta, have), deckSize: fmt.size[0] >= 99 ? 99 : 60, turn: comboTurn(fmt), profile })
  const top = profile[0]?.s.k, lands = new Set(Object.keys(deck.main).filter(n => data.byName.get(n)?.mt === 'Land'))
  const tag = `${deck.name}:`
  for (const r of recs.slice(0, 20)) for (const w of r.why) {
    // cores como símbolos ({G}), nunca «(G)» nem «de G»
    if (/\([WUBRGC]\)|\bde [WUBRG]\b/.test(w.txt)) bad.push(`${tag} cor em texto: ${w.txt}`)
    // parceiras dos torneios: nunca por um terreno (fetches e duplos estão em todas as listas)
    const m = w.txt.match(/^Jogada com (.+) em torneios/)
    if (m && [...lands].some(n => m[1].includes(n))) bad.push(`${tag} parceira é um terreno: ${w.txt}`)
    // «Tribo X» só quando X é um tema do deck (lords, «Sliver you control»), não por haver Humans por acaso
    const t = w.txt.match(/^Tribo (\S+):/)
    if (t && !profile.some(x => x.s.tribe === t[1])) bad.push(`${tag} tribo por acaso: ${w.txt}`)
  }
  const top15 = recs.slice(0, 15), why = r => r.why.map(w => w.k)
  if (top === 'auras' && profile[0].raw >= 1) {  // deck de encantamentos: artefactos só a fechar um combo ou a tapar uma lacuna
    nEnch++
    for (const r of top15) if (isArt(r.c) && !isEnch(r.c) && !why(r).some(k => k === 'combo' || k === 'falta')) bad.push(`${tag} artefacto fora do plano: ${r.c.n} — ${r.why.map(w => w.txt).join(' | ')}`)
    // enchantresses criatura (o mesmo motor sem ser encantamento) ao nível do Enchantress's Presence: o payoff vale por si
    const ep = recs.find(r => r.c.n === "Enchantress's Presence")
    if (ep) nEp++
    if (ep) for (const n of ['Mesa Enchantress', 'Verduran Enchantress', 'Satyr Enchanter', 'Eidolon of Blossoms', 'Setessan Champion']) {
      const r = recs.find(r => r.c.n === n)
      if (!deck.main[n] && (!r || r.score < ep.score - 0.05)) bad.push(`${tag} ${n} abaixo do Enchantress's Presence (${r ? r.score.toFixed(3) : 'fora das 80'} < ${ep.score.toFixed(3)})`)
    }
    const onPlan = top15.filter(r => why(r).some(k => k === 'inter' || k === 'combo')).length
    if (onPlan < 12) bad.push(`${tag} só ${onPlan}/15 servem o plano`)
    if (deck.main['Heliod, Sun-Crowned'] && !deck.main['Walking Ballista'] && profile[0].raw >= 2) {  // o combo do Heliod sobe
      const k = recs.findIndex(r => r.c.n === 'Walking Ballista'), p = +(recs[k]?.why[0].txt.match(/≈(\d+)%/)?.[1] || 0)
      if (k < 0 || recs[k].why[0].k !== 'combo') bad.push(`${tag} Walking Ballista sem o combo com o Heliod`)
      else if (p >= 30 && k >= 15) bad.push(`${tag} Walking Ballista (combo com o Heliod a ${p}%) só em ${k + 1}.º`)
    }
  }
  // tribal com um segundo plano («Slivers Control»): a tribo não tapa o resto, o outro eixo também chega ao top 15
  const sec = profile[0]?.s.tribe && profile[0].raw >= 1 && profile.find(x => !x.s.tribe && x.raw >= 0.6)
  if (sec) {
    nTri++
    const n = top15.filter(r => r.detail.inter.some(y => y.label === sec.s.name)).length, nt = top15.filter(r => r.detail.inter.some(y => y.label === profile[0].s.name)).length
    if (n < 2 || nt < 3) bad.push(`${tag} ${profile[0].s.name} ${nt}/15 e ${sec.s.name} ${n}/15`)
  }
  if (top === 'art' && profile[0].raw >= 1) {  // deck de artefactos: o grosso das sugestões são artefactos ou payoffs deles
    nArt++  // (Deadly Dispute, Puresteel Paladin: aproveitam 6+ artefactos do deck)
    const n = recs.slice(0, 10).filter(r => isArt(r.c) || r.detail.inter.some(y => y.side === 'usa' && y.label === profile[0].s.name && y.who.length >= 6)).length
    if (n < 7) bad.push(`${tag} só ${n}/10 artefactos`)
  }
}
console.log(`${decks.length} decks em ${Math.round((performance.now() - t0) / 1000)} s · ${nEnch} de encantamentos · ${nArt} de artefactos · ${nTri} tribais com 2.º plano`)
assert.ok(nEnch >= 1 && nArt >= 1 && nTri >= 1 && nEp >= 1, 'faltam decks de encantamentos/artefactos/tribais para testar')
assert.deepEqual(bad, [])
console.log('plan.check ok')
