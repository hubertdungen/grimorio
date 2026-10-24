// Avaliação em lote do «Completar deck» (sem browser): `node web/evalbuild.mjs [n]`
// Usa os dados instalados (~/.local/share/grimorio/data) e o servidor local para EDHREC/meta.
import fs from 'node:fs'
import zlib from 'node:zlib'
import os from 'node:os'

const DATA = `${os.homedir()}/.local/share/grimorio/data`
const SERVER = 'http://127.0.0.1:8107'
globalThis.fetch = (orig => async (url, opts) => {
  const u = String(url)
  if (u.startsWith('data/')) {
    const f = `${DATA}/${u.slice(5)}`
    const buf = fs.readFileSync(f)
    return new Response(buf, { status: 200 })
  }
  if (u.startsWith('/')) return orig(SERVER + u, opts)
  return orig(url, opts)
})(globalThis.fetch)
void zlib

const { loadData, fmtBit, deckCombos, fetchEdh, fetchMeta, metaIndex, deckPlan } = await import('./src/data.js')
const { FORMAT, validate, canBeCommander } = await import('./src/formats.js')
const { autoBuild } = await import('./src/autobuild.js')
const { emptyDeck, stats } = await import('./src/deck.js')

const data = await loadData()
let seed = 12345
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = arr => arr[Math.floor(rnd() * arr.length)]

function pool(fmt, identity = null) {
  const bit = fmtBit(data, fmt)
  return data.cards.filter(c => c.mt !== 'Land' && c.er && c.er < 6000 && (bit < 0 || c.lg & (1 << bit)) && (identity == null || [...c.ci].every(k => identity.includes(k))) && !c.tg.includes('hate'))
}

const { STYLES } = await import('./src/data.js')
const { manaNeeds } = await import('./src/mana.js')
const { landAdvice, targetsFor } = await import('./src/formats.js')
const STY = Object.keys(STYLES)

function randPrefs() {
  if (rnd() < 0.35) return { on: false }
  const estilo = []
  const ns = Math.floor(rnd() * 3)
  while (estilo.length < ns) { const k = pick(STY); if (!estilo.includes(k)) estilo.push(k) }
  return { on: true, nivel: 1 + Math.floor(rnd() * 5), meta: Math.round(rnd() * 10) / 10, estilo, orcamento: rnd() < 0.3 ? pick([2, 5, 10]) : null }
}

async function scenario(fmtKey, nCards, prefs) {
  const fmt = FORMAT[fmtKey]
  const deck = emptyDeck(fmtKey)
  deck.prefs = prefs
  let identity = null
  if (fmt.cmd) {
    const cmds = data.cards.filter(c => canBeCommander(c, fmt) && c.er && c.er < 3000 && (c.lg & (1 << fmtBit(data, fmt))))
    const cmd = pick(cmds)
    deck.commanders = [cmd.n]
    identity = cmd.ci
  }
  const P = pool(fmt, identity)
  const seeds = new Set()
  while (seeds.size < nCards) seeds.add(pick(P).n)
  for (const n of seeds) deck.main[n] = fmt.copies === 1 ? 1 : nCards <= 5 ? 4 : nCards <= 8 ? 3 : 2
  deck.seeds = [...seeds]
  const ctx = { bit: fmtBit(data, fmt), identity, allowUn: fmtKey === 'casual' }
  let co = null
  if (fmt.cmd) {
    const d = await fetchEdh('commanders', deck.commanders[0])
    co = new Map()
    for (const [n, num, pot, lift, syn] of d.cards || []) {
      const c = data.byName.get(n); if (!c || !pot) continue
      if (!co.has(c.i)) co.set(c.i, [])
      co.get(c.i).push({ kind: 'commanders', from: deck.commanders[0], incl: num / pot, pot, lift, syn })
    }
  }
  const meta = metaIndex(data, await fetchMeta(fmtKey), fmt.name)
  const bracket = fmt.cmd === 'commander' && prefs.on && prefs.nivel <= 3 ? prefs.nivel : null
  const t0 = Date.now()
  const res = autoBuild(data, deck, fmt, { ctx, co, meta, prefs, bracket })
  const ms = Date.now() - t0
  const final = { ...deck, main: { ...deck.main } }
  for (const a of res.adds) final.main[a.c.n] = (final.main[a.c.n] || 0) + a.q
  const s = stats(final, data)
  const errs = validate(final, fmt, data).filter(i => i.nivel === 'erro')
  const idx = [...final.commanders, ...Object.keys(final.main)].map(n => data.byName.get(n)?.i).filter(x => x != null)
  const addedNL = res.adds.filter(a => a.c.mt !== 'Land')
  const nAdd = addedNL.reduce((x, a) => x + a.q, 0)
  const strong = addedNL.filter(a => /decks de|listas|Combo|Aproveita|Alimenta|Tribo|em falta|Peça de|Jogada com|Alvo de reanimação|Estilo|gosto/.test(a.why || '')).reduce((x, a) => x + a.q, 0)
  const plan = deckPlan(data, idx)
  const tg = targetsFor(fmt, plan, prefs)
  const mana = manaNeeds(data, final, fmt)
  const adv = landAdvice(fmt, s.avgMv || 3, s.cheapRampDraw)
  const mainCols = new Set(addedNL.flatMap(a => [...a.c.ci]))
  // concordância com decks reais
  let real = null
  if (co) real = addedNL.length ? addedNL.reduce((x, a) => x + ((co.get(a.c.i) || []).find(e => e.kind === 'commanders')?.incl || 0), 0) / addedNL.length : 0
  else if (meta) real = addedNL.length ? addedNL.filter(a => meta.byCard.get(a.c.i)).length / addedNL.length : 0
  const checks = {
    legal: errs.length === 0,
    criaturas: !tg.creature || (s.tags.creature || 0) >= tg.creature * 0.8,
    vitoria: !tg.wincon || (s.tags.wincon || 0) >= tg.wincon,
    remocao: !tg.removal || (s.tags.removal || 0) >= tg.removal * 0.8,
    terrenos: Math.abs(s.lands - adv) <= 3,
    curva: fmt.cmd ? s.avgMv >= 2.2 && s.avgMv <= 3.9 : s.avgMv >= 1.5 && s.avgMv <= 3.4,
    cores: fmt.cmd || mainCols.size <= 3,
    fontes: Object.entries(mana.cols).filter(([k]) => fmt.cmd || !res.colors || res.colors.includes(k)).every(([, x]) => x.have >= x.full * 0.6),
    coerencia: nAdd === 0 || strong / nAdd >= 0.7,
    plano: plan.length > 0 || fmt.key === 'limited',
  }
  if (prefs.on) {
    if (prefs.orcamento) checks.orcamento = addedNL.every(a => (a.c.eur ?? a.c.usd ?? 0) <= prefs.orcamento)
    if (prefs.estilo.length) checks.estilo = addedNL.filter(a => /Estilo/.test(a.why || '') || prefs.estilo.some(k => k !== 'tribal' && STYLES[k].test?.(a.c, data))).length >= addedNL.length * 0.3
    if (prefs.nivel <= 2 && fmt.cmd) checks.nivelBaixo = !addedNL.some(a => a.c.gc)
  }
  return { fmt: fmtKey, n: nCards, prefs, cmd: deck.commanders[0] || '', seeds: [...seeds].slice(0, 3).join(' / '), checks, real, ms,
    detail: `criat ${s.tags.creature || 0}/${tg.creature || '-'} vit ${s.tags.wincon || 0}/${tg.wincon || '-'} terr ${s.lands}/${adv} MV ${s.avgMv.toFixed(2)} cores+ ${mainCols.size} forte ${nAdd ? Math.round(strong / nAdd * 100) : 100}%` }
}

const N = +process.argv[2] || 100
const FMTS = ['commander', 'commander', 'commander', 'modern', 'legacy', 'pioneer', 'pauper', 'standard', 'casual', 'duel']
const rows = []
for (let k = 0; k < N; k++) {
  const f = pick(FMTS), n = 3 + Math.floor(rnd() * 8), pr = randPrefs()
  try { rows.push(await scenario(f, n, pr)) } catch (e) { rows.push({ fmt: f, n, error: e.message }) }
}
const ok = rows.filter(r => !r.error)
const names = [...new Set(ok.flatMap(r => Object.keys(r.checks)))]
console.log(`${ok.length} decks (${rows.length - ok.length} erros) · ${(ok.reduce((a, r) => a + r.ms, 0) / ok.length / 1000).toFixed(2)} s por deck`)
for (const k of names) {
  const has = ok.filter(r => k in r.checks), pass = has.filter(r => r.checks[k]).length
  console.log(`  ${k.padEnd(11)} ${pass}/${has.length}  (${Math.round(pass / has.length * 100)}%)`)
}
const cmdReal = ok.filter(r => r.cmd && r.real != null), conReal = ok.filter(r => !r.cmd && r.real != null)
if (cmdReal.length) console.log(`  Commander: inclusão média EDHREC das cartas acrescentadas ${Math.round(cmdReal.reduce((a, r) => a + r.real, 0) / cmdReal.length * 100)}%`)
if (conReal.length) console.log(`  Construído: cartas acrescentadas presentes no meta ${Math.round(conReal.reduce((a, r) => a + r.real, 0) / conReal.length * 100)}%`)
const metaLo = conReal.filter(r => r.prefs.on && r.prefs.meta <= 0.3), metaHi = conReal.filter(r => r.prefs.on && r.prefs.meta >= 0.7)
if (metaLo.length && metaHi.length) console.log(`  «Seguir o meta» baixo vs alto: ${Math.round(metaLo.reduce((a, r) => a + r.real, 0) / metaLo.length * 100)}% vs ${Math.round(metaHi.reduce((a, r) => a + r.real, 0) / metaHi.length * 100)}% no meta`)
console.log('\nFalhas:')
for (const r of ok.filter(r => Object.values(r.checks).some(v => !v)).slice(0, 25)) {
  const p = r.prefs.on ? `nível ${r.prefs.nivel} meta ${r.prefs.meta}${r.prefs.estilo.length ? ' ' + r.prefs.estilo.join('+') : ''}${r.prefs.orcamento ? ` ≤${r.prefs.orcamento}€` : ''}` : 'sem tweaks'
  console.log(`  ${r.fmt} n=${r.n} [${p}] ✗ ${Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(',')} · ${r.detail} · ${r.cmd ? `[${r.cmd}] ` : ''}${r.seeds}`)
}
for (const r of rows.filter(r => r.error)) console.log('  ERRO', r.fmt, r.n, r.error)
