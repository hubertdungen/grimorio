// Análise › Como ganha e como perde: as vias de vitória do deck (testes, combate, combos, dano direto/dreno/mill/
// veneno, eixos do plano), as formas de perder (o que o venceu nos testes e fraquezas da construção) e se o
// sideboard ajuda (o que cobre e o que falta contra o que o venceu).
import { deckCombos, SIDE_CATS } from './data.js'
import { HATE, CAT_LABEL } from './tests.js'
import { WIN_LABEL } from './swap.js'
import { tx } from './i18n.js'

const top = (l, n = 4) => l.sort((a, b) => b.q - a.q || (a.c.er ?? 1e9) - (b.c.er ?? 1e9)).slice(0, n).map(x => x.c.n)

export function winLose(data, deck, fmt, { ev, plan = [], ctx } = {}) {
  const main = Object.entries(deck.main).map(([n, q]) => ({ c: data.byName.get(n), q })).filter(x => x.c)
  const nonland = main.filter(x => x.c.mt !== 'Land')
  const total = main.reduce((a, x) => a + x.q, 0) || 1, k = 60 / total  // contas à escala de 60 cartas
  const tag = t => nonland.filter(x => x.c.tg.includes(t))
  const cnt = l => l.reduce((a, x) => a + x.q, 0)
  const o = x => x.c.o.toLowerCase()
  const wins = [], risks = []

  // --- como ganha
  if (ev?.wincon?.games) wins.push({ label: tx('Nos testes: {v}', { v: WIN_LABEL[ev.wincon.kind] || ev.wincon.kind }), why: tx('Foi assim em {n} vitórias.', { n: ev.wincon.games }) })
  const crea = nonland.filter(x => x.c.mt === 'Creature'), evas = crea.filter(x => x.c.tg.includes('evasion'))
  if (cnt(crea) >= 8) wins.push({ label: tx('Combate'), why: tx('{n} criaturas, {e} com evasão (voar, atropelar, imbloqueáveis…).', { n: cnt(crea), e: cnt(evas) }), cards: top([...evas, ...crea.filter(x => !evas.includes(x))].filter((x, j, a) => a.indexOf(x) === j).map(x => ({ ...x, q: (parseInt(x.c.pt) || 0) + (x.c.tg.includes('evasion') ? 3 : 0) }))) })
  const have = [...deck.commanders, ...Object.keys(deck.main)].map(n => data.byName.get(n)?.i).filter(i => i != null)
  const full = deckCombos(data, have, ctx || { bit: -1, identity: null }).full
  if (full.length) wins.push({ label: tx('Combo'), why: full.slice(0, 2).map(x => `${x.cb[1].map(i => data.cards[i].n).join(' + ')} → ${x.cb[2][0]}`).join(' · '), cards: full[0].cb[1].map(i => data.cards[i].n) })
  const routes = [['burn', tx('Dano direto')], ['drain', tx('Drenar vida')], ['mill', tx('Moer (mill)')]]
  for (const [t, l] of routes) { const xs = tag(t); if (cnt(xs) * k >= 5) wins.push({ label: l, why: tx('{n} cartas que o fazem.', { n: cnt(xs) }), cards: top(xs) }) }
  const psn = nonland.filter(x => /\binfect\b|\btoxic\b|poison counter/.test(o(x)))
  if (cnt(psn) * k >= 4) wins.push({ label: tx('Veneno'), why: tx('{n} cartas com infetar/tóxico.', { n: cnt(psn) }), cards: top(psn) })
  for (const p of plan.slice(0, 2)) wins.push({ label: tx('Eixo: {p}', { p: p.label }), why: p.roles.length ? tx('{a} geram · {b} aproveitam', { a: p.enablers, b: p.payoffs }) : tx('{n} criatura|{n} criaturas', { n: p.n }) })

  // --- como perde: o que o venceu nos testes
  for (const [c, x] of Object.entries(ev?.cats || {})) {
    if (x.lost >= 2 && x.lost / x.games >= 0.5) risks.push({ key: c, label: tx('Contra {c}', { c: CAT_LABEL[c] || c }), why: tx('Perdeu {l} de {g} jogos em que o adversário jogou isto.', { l: x.lost, g: x.games }), cards: Object.entries(x.cards).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n), test: true })
  }
  // --- fraquezas da construção (à escala de 60 cartas)
  const rem = cnt(tag('removal')) + cnt(tag('wipe')) + cnt(tag('counter'))
  if (rem * k < 5) risks.push({ key: 'creatures', label: tx('Pouca interação'), why: tx('{n} remoções/contra-feitiços: as ameaças grandes do adversário ficam em campo.', { n: rem }) })
  if ((cnt(tag('draw')) + cnt(tag('selection'))) * k < 3) risks.push({ key: 'long', label: tx('Pouca compra'), why: tx('Nos jogos longos fica sem cartas antes do adversário.') })
  const gy = cnt(tag('graveyard')) + cnt(tag('reanimate')) + cnt(tag('recursion'))
  if (gy * k >= 7) risks.push({ key: 'graveyard', label: tx('Depende do cemitério'), why: tx('{n} cartas usam o cemitério: hate de cemitério (Rest in Peace, Leyline of the Void…) corta o plano.', { n: gy }) })
  const small = crea.filter(x => (parseInt(x.c.pt) || 0) <= 2)
  if (cnt(small) * k >= 14) risks.push({ key: 'wipe', label: tx('Vulnerável a wipes'), why: tx('{n} criaturas pequenas: um wipe ou dano a todas desfaz a mesa.', { n: cnt(small) }) })
  const arts = nonland.filter(x => /Artifact/.test(x.c.t)), auras = nonland.filter(x => /\bAura\b/.test(x.c.t))
  if (cnt(arts) * k >= 12) risks.push({ key: 'artifacts', label: tx('Muitos artefactos'), why: tx('{n} artefactos: hate de artefactos (Kolaghan\'s Command, Hurkyl\'s Recall…) faz muito estrago.', { n: cnt(arts) }) })
  if (cnt(auras) * k >= 6) risks.push({ key: 'enchantments', label: tx('Auras'), why: tx('{n} auras: remover a criatura encantada é um 2-por-1 contra ti.', { n: cnt(auras) }) })

  // --- sideboard: o que cobre e o que falta contra o que o venceu
  let side = null
  if (fmt.side > 0) {
    const sb = Object.entries(deck.side || {}).map(([n, q]) => ({ c: data.byName.get(n), q })).filter(x => x.c)
    const covers = SIDE_CATS.map(([label, re]) => ({ label, cards: sb.filter(x => re.test(o(x))) })).filter(x => x.cards.length)
      .map(x => ({ label: x.label, n: cnt(x.cards), cards: x.cards.map(y => y.c.n) }))
    const gaps = risks.filter(r => r.test).map(r => { const h = HATE.find(([c]) => c === r.key); return { risk: r.label, has: h ? sb.filter(x => h[1].test(x.c.o)).map(x => x.c.n) : [] } })
    const n = cnt(sb), verdict = !n ? 'vazio' : covers.length >= 3 && gaps.every(g => g.has.length) ? 'forte' : covers.length >= 1 ? 'razoavel' : 'fraco'
    side = { n, covers, gaps, verdict }
  }
  return { wins, risks, side }
}
