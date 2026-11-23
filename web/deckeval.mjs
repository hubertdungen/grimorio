// Avaliação da intenção explícita no deck novo: `node web/deckeval.mjs [--check] [--fast] [--list nome]`
// Corre o mesmo caminho da interface (Wizard: «Gosto de…»/cartas → newdeck.js → «Completar deck»: autobuild.js) contra os
// dados reais, só a ler (~/.local/share/grimorio: data/, edhrec/ e meta/ em cache; o que não está em cache fica sem esse sinal).
// --check: falha (código 1) se algum cenário ficar abaixo dos limites; --fast: só os dois casos do Hubert (selfcheck);
// --only id,id: só esses cenários; --list id|all: a lista das cartas acrescentadas e porquê.
import fs from 'node:fs'
import os from 'node:os'

const G = process.env.GRIMORIO_DATA_DIR || `${os.homedir()}/.local/share/grimorio`
const args = process.argv.slice(2), CHECK = args.includes('--check'), FAST = args.includes('--fast'), LIST = args[args.indexOf('--list') + 1]
if (!fs.existsSync(`${G}/data/cards.json`)) { console.log('deckeval: sem dados locais, saltado'); process.exit(0) }
const readJ = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : null)
// fetchEdh/fetchMeta pedem /api/…: respondem as caches em disco (nunca o servidor nem a rede)
globalThis.fetch = async url => {
  const u = String(url)
  let m = /^\/api\/edhrec\/(commanders|cards)\/([a-z0-9-]+)$/.exec(u)
  if (m) return new Response(JSON.stringify(readJ(`${G}/edhrec/${m[1]}-${m[2]}.json`) || { cards: [] }))
  m = /^\/api\/meta\/(\w+)$/.exec(u)
  if (m) { const j = readJ(`${G}/meta/${m[1]}.json`); return new Response(JSON.stringify(j), { status: j ? 200 : 404 }) }
  return new Response('null', { status: 404 })
}

const { prepData, fmtBit, CREATURE_TYPES, fetchEdh, edhIndex, fetchMeta, metaIndex, deckPlan, subsOf } = await import('./src/data.js')
const { setVocab } = await import('./src/vocab.js')
const { likeTheme, likeCards } = await import('./src/nlsearch.js')
const { likeSel, likeSeedTerms, cmdSuggest, seedDeck } = await import('./src/newdeck.js')
const { FORMAT, validate, targetsFor, landAdvice } = await import('./src/formats.js')
const { autoBuild } = await import('./src/autobuild.js')
const { stats } = await import('./src/deck.js')

const b = f => { const x = fs.readFileSync(`${G}/data/${f}`); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length) }
const data = prepData(readJ(`${G}/data/meta.json`), readJ(`${G}/data/cards.json`), readJ(`${G}/data/combos.json`), b('emb.bin'), b('pos.bin'))
setVocab(readJ(`${G}/data/vocab.json`), data.cards)
const C = n => { const c = data.byName.get(n) || data.byLower.get(n.toLowerCase()); if (!c) throw new Error(`carta desconhecida: ${n}`); return c }

// O assistente: o que create() do Wizard.jsx faz, pelas mesmas funções (newdeck.js); depois o AutoBuildDialog.
async function build(s) {
  const fmt = FORMAT[s.format], bit = fmtBit(data, fmt)
  let cmds = (s.cmd ? [s.cmd] : []).map(C)
  const start = s.like != null ? 'gosto' : 'cartas'
  const theme = start === 'gosto' ? likeTheme(data, s.like, { types: CREATURE_TYPES }) : null
  const sel = theme ? likeSel(theme, { pick: s.pick || [], star: s.star || [], cmds }) : null
  const picks = (s.seeds || []).map(C)
  const ctx = { bit, identity: fmt.cmd && cmds.length ? cmds.map(c => c.ci).join('') : null, allowUn: fmt.key === 'casual' }
  const eff = start === 'gosto' && !picks.length ? likeCards(data, sel, ctx, 12).slice(0, 8) : picks
  if (fmt.cmd && !cmds.length) {
    const need = [...new Set(picks.flatMap(c => [...c.ci]))].join('')
    const sug = cmdSuggest(data, fmt, eff, { bit, gosto: start === 'gosto', sel, need })
    if (sug[0]) cmds = [sug[0]]
  }
  if (process.env.DEBUG) console.log(JSON.stringify(likeSeedTerms(sel || { terms: [], arch: [], tags: [] }, s.star || [])))
  const d = seedDeck(s.format, fmt, cmds, eff, { seedTerms: start === 'gosto' ? likeSeedTerms(sel, s.star || []) : null, prefs: s.prefs || {} })
  const actx = { bit, identity: fmt.cmd && cmds.length ? cmds.map(c => c.ci).join('') : null, allowUn: fmt.key === 'casual' }
  const cmdIdx = cmds.map(c => c.i)
  const co = cmdIdx.length ? edhIndex(data, await Promise.all(cmdIdx.map(async i => ({ kind: 'commanders', i, d: await fetchEdh('commanders', data.cards[i].n) })))) : null
  const meta = metaIndex(data, await fetchMeta(fmt.key), fmt.name)
  const t0 = Date.now()
  const res = autoBuild(data, d, fmt, { ctx: actx, co, meta, prefs: d.prefs, tastes: [], bracket: fmt.cmd === 'commander' ? d.bracket || (d.prefs?.on && d.prefs.nivel <= 3 ? d.prefs.nivel : null) : null })
  const final = { ...d, main: { ...d.main } }
  for (const a of res.adds || []) final.main[a.c.n] = (final.main[a.c.n] || 0) + a.q
  return { d, final, res, fmt, cmds, ms: Date.now() - t0, theme, sel }
}

const isWall = c => subsOf(c).includes('Wall') || (c.kw || []).includes('Defender')
const wallPay = c => /defender|toughness rather than|equal to (its|their|that creature's) toughness|\bwalls?\b|sum of (the )?toughness|(greatest|highest|total) toughness/i.test(c.o)
const chg = c => (c.kw || []).includes('Changeling') || subsOf(c).includes('Shapeshifter') || /changeling|every creature type|creature type of your choice|chosen (creature )?type|choose a creature type|share a creature type|creatures? of the chosen type/i.test(c.o)
const tribeOf = T => c => subsOf(c).includes(T) || (c.kw || []).includes('Changeling') || new RegExp(`\\b${T.toLowerCase()}s?\\b`).test(c.o.toLowerCase())
const sac = c => c.tg.includes('sacrifice') || /sacrifice (a|an|another) creature|whenever (a|another|one or more)[^.]*creatures?[^.]*(you control )?dies?|when[^.]* dies/i.test(c.o)
const spell = c => /Instant|Sorcery/.test(c.t) || /instant or sorcery|whenever you cast (a|an) (noncreature|instant)|copy target (instant|sorcery)/i.test(c.o)
const burn = c => (/deals? \d+ damage to (any target|target player|each opponent|target opponent)|damage to any target/i.test(c.o) && c.cmc <= 3) || /Monk|Prowess/.test(c.t + (c.kw || []).join()) || c.n === 'Goblin Guide' || c.n === 'Eidolon of the Great Revel'

const SC = [
  { id: 'iw-walls', label: 'Invisible Woman + «walls» + 10 muralhas', format: 'commander', cmd: 'Invisible Woman', like: 'walls', pick: ['t:kw:Defender'],
    seeds: ['Wall of Omens', 'Wall of Blossoms', 'Wall of Roots', 'Overgrown Battlement', 'Axebane Guardian', 'Drift of Phantasms', 'Sylvan Caryatid', 'Wall of Denial', 'Tree of Redemption', 'Arcades, the Strategist'],
    on: c => isWall(c) || wallPay(c), bad: c => /Human/.test(c.t) && /Hero/.test(c.t), badLabel: 'Human Hero',
    // Doran (BGW) fica fora da identidade GRUW da Invisible Woman; Axebane, Overgrown Battlement e Wall of Roots não contam: são sementes
    keys: ['Assault Formation', 'Rolling Stones', 'High Alert', 'Belligerent Brontodon', 'Tower Defense', 'Huatli, Poet of Unity', 'Duskana, the Rage Mother', 'Rammas Echor, Ancient Shield', 'Wingmantle Chaplain', "Huatli, the Sun's Heart", 'Treefolk Umbra', 'Baldin, Century Herdmaster', 'Rampart Architect'],
    min: { on: 0.5, keys: 4 }, fast: 1 },
  { id: 'iw-walls-semtipo', label: 'idem, sem o tipo nem os decks reais (EDHREC) do comandante', format: 'commander', cmd: 'Invisible Woman', like: 'walls', pick: ['t:kw:Defender'],
    seeds: ['Wall of Omens', 'Wall of Blossoms', 'Wall of Roots', 'Overgrown Battlement', 'Axebane Guardian', 'Drift of Phantasms', 'Sylvan Caryatid', 'Wall of Denial', 'Tree of Redemption', 'Arcades, the Strategist'],
    prefs: { cmdTipo: false, cmdEdh: false }, on: c => isWall(c) || wallPay(c), bad: c => /Human/.test(c.t) && /Hero/.test(c.t), badLabel: 'Human Hero',
    keys: ['Assault Formation', 'Rolling Stones', 'High Alert', 'Belligerent Brontodon', 'Tower Defense', 'Rammas Echor, Ancient Shield', 'Wingmantle Chaplain', "Huatli, the Sun's Heart", 'Treefolk Umbra', 'Baldin, Century Herdmaster', 'Rampart Architect'],
    min: { on: 0.5, keys: 4, bad: 2 } },
  { id: 'morophon', label: 'Morophon + «shapeshifting» + changelings', format: 'commander', cmd: 'Morophon, the Boundless', like: 'shapeshifting', pick: ['t:kw:Changeling'],
    seeds: ['Changeling Outcast', 'Realmwalker', 'Mirror Entity', 'Universal Automaton', 'Taurean Mauler', 'Chameleon Colossus', 'Birthing Boughs', 'Mistform Ultimus'],
    on: chg, keys: ['Maskwood Nexus', 'Kindred Discovery', 'Coat of Arms', "Herald's Horn", "Vanquisher's Banner", 'Path of Ancestry', 'Unclaimed Territory', 'Cavern of Souls', 'Mirror Entity'],
    min: { on: 0.45, keys: 6 }, fast: 1 },
  { id: 'goblins', label: '«Escolher cartas»: 4 goblins, sem comandante', format: 'commander', seeds: ['Goblin Chieftain', 'Goblin Matron', 'Skirk Prospector', 'Goblin Warchief'],
    on: tribeOf('Goblin'), keys: ['Krenko, Mob Boss', 'Muxus, Goblin Grandee', 'Krenko, Tin Street Kingpin', 'Krenko, Baron of Tin Street', 'Goblin Ringleader', 'Goblin Recruiter', 'Conspicuous Snoop', 'Goblin Lackey'], cmdOk: c => /Goblin/.test(c.t + c.o),
    min: { on: 0.5, keys: 2 } },
  { id: 'edgar', label: 'Edgar Markov + vampiros', format: 'commander', cmd: 'Edgar Markov', seeds: ['Bloodline Keeper', 'Captivating Vampire', 'Vampire Nocturnus', 'Stromkirk Captain'],
    on: tribeOf('Vampire'), keys: ['Cordial Vampire', 'Sorin, Imperious Bloodlord', 'Legion Lieutenant', 'Vampire of the Dire Moon', 'Champion of Dusk', 'Bloodghast', 'Kindred Dominance'], min: { on: 0.45, keys: 3 } },
  { id: 'teysa', label: 'Teysa Karlov + «aristocrats»', format: 'commander', cmd: 'Teysa Karlov', like: 'aristocrats',
    on: sac, keys: ['Blood Artist', 'Zulaport Cutthroat', 'Viscera Seer', 'Carrion Feeder', 'Cruel Celebrant', 'Ashnod\'s Altar', 'Pitiless Plunderer'], min: { on: 0.4, keys: 3 } },
  { id: 'talrand', label: 'Talrand + «spellslinger»', format: 'commander', cmd: 'Talrand, Sky Summoner', like: 'spellslinger',
    on: spell, keys: ['Counterspell', 'Opt', 'Brainstorm', 'Ponder', 'Preordain', 'Mystic Sanctuary', 'Archmage Emeritus'], min: { on: 0.55, keys: 3 } },
  { id: 'burn', label: 'Modern burn (60) de 4 feitiços', format: 'modern', seeds: ['Lightning Bolt', 'Lava Spike', 'Rift Bolt', 'Skullcrack'],
    // as sementes são mono-vermelhas: Boros Charm e Lightning Helix só com uma terceira cor que elas não pedem
    on: burn, keys: ['Monastery Swiftspear', 'Goblin Guide', 'Bonecrusher Giant', 'Slickshot Show-Off', 'Searing Blaze', 'Play with Fire', 'Lightning Strike', 'Searing Spear', 'Skewer the Critics'], min: { on: 0.6, keys: 2 } },
]

function measure(s, r) {
  const { final, res, fmt, cmds } = r
  const cards = Object.entries(final.main).map(([n, q]) => [data.byName.get(n), q]).filter(([c]) => c)
  const nl = cards.filter(([c]) => !/Land/.test(c.t.split(' // ')[0]))
  const nlN = nl.reduce((a, [, q]) => a + q, 0)
  const onN = nl.reduce((a, [c, q]) => a + (s.on(c) ? q : 0), 0)
  const added = (res.adds || []).filter(a => !/Land/.test(a.c.t.split(' // ')[0]))
  const addOn = added.filter(a => s.on(a.c)).reduce((x, a) => x + a.q, 0), addN = added.reduce((x, a) => x + a.q, 0)
  const st = stats(final, data)
  const plan = deckPlan(data, [...cmds.map(c => c.i), ...cards.map(([c]) => c.i)])
  const tg = targetsFor(fmt, plan, final.prefs)
  const roles = Object.entries(tg).filter(([t]) => !['creature', 'wincon'].includes(t)).map(([t, n]) => [t, st.tags[t] || 0, n])
  const errs = validate(final, fmt, data).filter(i => i.nivel === 'erro')
  const total = Object.values(final.main).reduce((a, q) => a + q, 0) + final.commanders.length
  const inDeck = n => { const c = C(n).n; return final.main[c] || final.commanders.includes(c) }
  const keys = s.keys.filter(inDeck)
  const bad = s.bad ? nl.filter(([c]) => s.bad(c) && !(final.seeds || []).includes(c.n)).map(([c]) => c.n) : []
  return { avgMv: st.avgMv, cheap: st.cheapRampDraw, on: onN / (nlN || 1), addOn: addOn / (addN || 1), keys, bad, roles, lands: st.lands, total, legal: errs.length === 0, errs, combos: res.combos?.length || 0, cmd: cmds.map(c => c.n).join(' & ') }
}

const pct = x => `${Math.round(x * 100)}%`
let fail = 0
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
for (const s of SC.filter(s => (!FAST || s.fast) && (!ONLY || ONLY.includes(s.id)))) {
  const r = await build(s)
  if (r.res.msg) { console.log(`✗ ${s.id}: ${r.res.msg}`); fail++; continue }
  const m = measure(s, r)
  // terrenos: o conselho da própria app (formats.js landAdvice, pelo MV médio) ±1, e 33–40 no Commander
  const adv = landAdvice(r.fmt, m.avgMv, m.cheap)
  const landOk = Math.abs(m.lands - adv) <= 1 && (!r.fmt.cmd || (m.lands >= 33 && m.lands <= 40))
  const roleOk = m.roles.filter(([, h, n]) => h >= n * 0.7).length
  const errs = []
  if (m.on < s.min.on) errs.push(`no tema ${pct(m.on)} < ${pct(s.min.on)}`)
  if (m.keys.length < s.min.keys) errs.push(`peças-chave ${m.keys.length} < ${s.min.keys}`)
  if (s.min.bad != null && m.bad.length > s.min.bad) errs.push(`${s.badLabel} ${m.bad.length} > ${s.min.bad}`)
  if (!m.legal) errs.push(`ilegal: ${m.errs.map(e => e.msg).join('; ').slice(0, 160)}`)
  if (!landOk) errs.push(`terrenos ${m.lands}`)
  if (m.total !== (r.fmt.size[0] || 60)) errs.push(`total ${m.total}`)
  if (s.cmdOk && !r.cmds.every(s.cmdOk)) errs.push(`comandante ${m.cmd}`)
  if (roleOk < m.roles.length - 1) errs.push(`funções ${roleOk}/${m.roles.length}`)
  if (errs.length) fail++
  console.log(`${errs.length ? '✗' : '✓'} ${s.label}${m.cmd && !s.cmd ? ` → ${m.cmd}` : ''}`)
  console.log(`   no tema ${pct(m.on)} (acrescentadas ${pct(m.addOn)}) · peças-chave ${m.keys.length}/${s.keys.length}${s.bad ? ` · ${s.badLabel} ${m.bad.length}` : ''} · combos ${m.combos} · terrenos ${m.lands} (conselho ${adv}) · funções ${roleOk}/${m.roles.length} (${m.roles.map(([t, h, n]) => `${t} ${h}/${n}`).join(', ')}) · ${(r.ms / 1000).toFixed(1)} s`)
  if (errs.length) console.log(`   ${errs.join(' · ')}`)
  if (LIST === s.id || LIST === 'all') {
    for (const a of r.res.adds.filter(a => !/Land/.test(a.c.t))) console.log(`     ${s.on(a.c) ? '●' : '·'} ${a.q} ${a.c.n} — ${a.why}`)
    if (m.bad.length) console.log(`   ${s.badLabel}: ${m.bad.join(', ')}`)
    console.log(`   peças-chave: ${m.keys.join(', ')}`)
  }
}
if (CHECK && fail) { console.log(`deckeval: ${fail} cenário(s) abaixo dos limites`); process.exit(1) }
console.log(fail ? `deckeval: ${fail} cenário(s) abaixo dos limites` : 'deckeval ok')
