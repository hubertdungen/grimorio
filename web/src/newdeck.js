// Assistente de deck novo sem React: o que o Wizard.jsx faz com as escolhas (chips do «Gosto de…», comandantes sugeridos,
// deck inicial). Puro, para o deckeval.mjs medir exatamente o mesmo caminho que a interface.
import { termMatch } from './data.js'
import { ARCH } from './archetypes.js'
import { canBeCommander } from './formats.js'
import { emptyDeck } from './deck.js'

export const likeKey = { t: t => `t:${t.k}:${t.v}`, c: x => `c:${x.k}`, g: x => `g:${x.k}`, a: x => `a:${x.k}` }
const subset = (a, b) => [...a].every(k => b.includes(k))

// Detetados no texto + escolhidos na paleta completa, sem repetir. Com comandante, as cores ficam na identidade dele.
export function likeSel(theme, { off = [], star = [], pick = [], cmds = [] } = {}) {
  const on = k => !off.includes(k), key = likeKey
  const terms = [], seen = new Set(), colors = [], tags = [], arch = []
  const addT = t => { const k = key.t(t); if (!seen.has(k)) { seen.add(k); terms.push(t) } }
  for (const t of theme.terms) if (on(key.t(t))) addT(t)
  for (const x of theme.colors) if (on(key.c(x))) colors.push(x.k)
  for (const x of theme.tags) if (on(key.g(x))) tags.push(x.k)
  for (const x of theme.arch) if (on(key.a(x))) arch.push(x.k)
  // o que o texto já detetou manda: o mesmo chip escolhido à mão não conta duas vezes nem ignora o desligar
  const auto = new Set([...theme.terms.map(key.t), ...theme.colors.map(key.c), ...theme.tags.map(key.g), ...theme.arch.map(key.a)])
  for (const k of pick) {
    if (auto.has(k)) continue
    const m = /^t:(kw|sub|type|rar|mv|set):(.+)$/.exec(k)
    if (m) addT({ k: m[1], v: m[2], u: 1 })
    else if (k.startsWith('c:')) colors.push(k.slice(2))
    else if (k.startsWith('g:')) tags.push(k.slice(2))
    else if (k.startsWith('a:') && ARCH[k.slice(2)]) arch.push(k.slice(2))
  }
  const ci = cmds.map(c => c.ci).join(''), cols = [...new Set(colors)]
  return {
    terms,
    star: terms.filter(t => star.includes(key.t(t))),
    colors: ci ? cols.filter(k => (k === 'C' ? !ci : ci.includes(k))) : cols,
    tags: [...new Set(tags)],
    arch: [...new Set(arch)],
  }
}

// Os temas que o deck leva como intenção explícita (data.js intentTerms): os escritos/escolhidos e os ★ (s: valem 1,5),
// os relacionados que ficaram ligados (rel: valem metade), as estratégias e as funções ligadas. Os ★ primeiro.
export const likeSeedTerms = (sel, star = []) => [
  ...sel.terms.map(t => ({ k: t.k, v: t.v, ...(star.includes(likeKey.t(t)) ? { s: 1 } : t.u ? {} : { rel: 1 }) })).sort((a, b) => (b.s || 0) - (a.s || 0)),
  ...sel.arch.map(v => ({ k: 'arch', v })), ...sel.tags.map(v => ({ k: 'tag', v, rel: 1 })),
]

// Comandantes que cobrem as cores das cartas escolhidas, pela semelhança de texto + popularidade.
// «Gosto de…»: o que o comandante é e faz pesa tanto como a semelhança com as cartas; incolor/cores a mais custam.
export function cmdSuggest(data, fmt, eff, { bit = -1, gosto = false, sel = null, need = '' } = {}) {
  if (!fmt.cmd || !eff.length) return []
  const pin = gosto && sel?.colors.length, ci = pin ? sel.colors.join('') : [...new Set(eff.flatMap(c => [...c.ci]))].join('')
  const D = data.D, E = data.emb, cen = new Float32Array(D)
  for (const c of eff) for (let k = 0; k < D; k++) cen[k] += E[c.i * D + k]
  // a tribo das cartas escolhidas (4 goblins → Krenko, Muxus): um comandante dela, ou que fale dela, pesa como um tema
  const tc = {}
  for (const c of eff) for (const s of (c.t.split('—')[1] || '').split('//')[0].trim().split(/\s+/)) if (s && /Creature/.test(c.t)) tc[s] = (tc[s] || 0) + 1
  const [tribe, tn] = Object.entries(tc).sort((a, b) => b[1] - a[1])[0] || []
  const tre = tribe && tn >= Math.max(2, eff.length * 0.4) ? new RegExp(`\\b${tribe.toLowerCase()}s?\\b`) : null
  const out = []
  for (const c of data.cards) {
    if (!canBeCommander(c, fmt) || !(pin ? subset(need, c.ci) && subset(c.ci, ci + need) : subset(ci, c.ci)) || (bit >= 0 && !(c.lg & (1 << bit)))) continue
    let d = 0
    for (let k = 0; k < D; k++) d += cen[k] * E[c.i * D + k]
    let b = 0
    if (gosto) { for (const t of sel.terms) if (termMatch(c, t)) b += t.u ? 0.2 : 0.1; for (const g of sel.tags) if (c.tg.includes(g)) b += 0.1 }
    // fala da tribo fora de «create … token» (Krenko: «the number of Goblins you control»; o Ardoz só cria um goblin)
    if (tre && tre.test(c.o.toLowerCase().replace(/create[^.,]*?tokens?/g, ''))) b += 0.25
    out.push({ c, s: b + d / 16129 / eff.length + (c.er ? 0.15 * Math.max(0, 1 - Math.log(c.er) / Math.log(40000)) : 0) - (pin ? 0.05 * (ci.length - c.ci.length) : 0.02 * (c.ci.length - ci.length)) })
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 90).map(x => x.c)
}

// O deck inicial: comandante(s), as cartas de partida (cópias pelo número delas), os temas e as preferências.
export function seedDeck(format, fmt, useCmd, eff, { seedTerms = null, prefs = {} } = {}) {
  const ci = useCmd.map(c => c.ci).join('')
  const keep = c => !useCmd.some(x => x.i === c.i) && (!useCmd.length || [...c.ci].every(k => ci.includes(k)))
  const seeds = eff.filter(keep)
  const d = emptyDeck(format)
  d.commanders = useCmd.map(c => c.n)
  for (const c of seeds) {
    const base = seeds.length <= 5 ? 4 : seeds.length <= 8 ? 3 : 2 // muitas cartas iniciais: menos cópias, sobra espaço
    d.main[c.n] = fmt.copies === 1 || /\bBasic\b/.test(c.t) ? 1 : Math.min(base, c.cmc >= 5 ? 2 : 4)
  }
  d.seeds = seeds.map(c => c.n)
  if (seedTerms) d.seedTerms = seedTerms
  d.prefs = prefs
  return d
}
