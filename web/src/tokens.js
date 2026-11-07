// Imagens reais das fichas (Scryfall): data/tokens.json vem de build/tokens.py.
// tokenCard(nome, p/t, carta que a criou, cores) devolve uma «carta» como as do cards.json (n, id, t, pt, co, o, kw, df)
// para a ficha que melhor bate: as da carta que a criou primeiro, depois pelo nome (sem «Token», maiúsculas à parte),
// desempatando por P/R e cores; sem índice ou sem nenhuma com esse nome, null (fica a ficha desenhada).
let T = null
export const tokensReady = fetch('data/tokens.json').then(r => (r.ok ? r.json() : null)).then(j => { T = j; SUF = null }).catch(() => {})
export const setTokens = j => { T = j; SUF = null; made.clear() }  // selfcheck

const made = new Map()  // id -> carta: o mesmo objeto de cada vez (memo do React)
// pelo fim do nome: «Scion» -> Eldrazi Scion, «Spawn» 0/1 -> Eldrazi Spawn, «Servo»… (a mesa livre escreve-se à mão, e há
// fichas com o tipo mais curto do que o nome); só quando nenhuma tem o nome inteiro
let SUF = null
const bySuffix = n => {
  if (!SUF) {
    SUF = new Map()
    for (const [k, ids] of Object.entries(T.byName)) { const w = k.split(' '); for (let i = 1; i < w.length; i++) { const s = w.slice(i).join(' '); SUF.set(s, [...(SUF.get(s) || []), ...ids]) } }
  }
  return SUF.get(n) || []
}
const colKey = s => [...new Set(String(s || '').toUpperCase().replace(/[^WUBRG]/g, ''))].sort().join('')
export const bareToken = n => String(n || '').trim().replace(/\s+tokens?$/i, '').toLowerCase()

function asCard(id) {
  if (made.has(id)) return made.get(id)
  const [n, pt, co, t, o = '', kw = [], faces = 0] = T.tokens[id]
  const mt = /Creature/.test(t) ? 'Creature' : /\bLand\b/.test(t) ? 'Land' : (t.split(' — ')[0].replace(/^Token\s+/, '').split(' ').pop() || 'Token')
  const c = { n, id, t, pt, co, ci: co, o, kw, df: faces ? 1 : 0, mc: '', cmc: 0, tg: [], mt, tok: 1 }
  made.set(id, c)
  return c
}

export function tokenCard(name, pt, src, col) {
  if (!T || !name) return null
  const n = bareToken(name)
  const own = (src && T.byCard[src]) || []
  const face = x => (x[6] || []).find(f => f[0].toLowerCase() === n) || x  // ficha de duas faces: a face com este nome
  const score = id => {
    const x = T.tokens[id], f = x && face(x)
    if (!x || (x[0].toLowerCase() !== n && f === x && !(loose && x[0].toLowerCase().endsWith(` ${n}`)))) return null  // a da carta que a criou, mas outra ficha (cria várias)
    let s = own.includes(id) ? 8 : 0
    if (pt && f[1] && !f[1].includes('*')) s += f[1] === pt ? 4 : -4  // */* da Scryfall: o Forge manda o número
    if (col != null) s += colKey(f[2]) === colKey(col) ? 2 : -2
    return s - (x[6] ? 1 : 0)  // as de uma face mostram mesmo esta ficha (a de duas faces pode mostrar a outra)
  }
  let best = null, bs = -Infinity, loose = false
  const pick = ids => { for (const id of ids) { const s = score(id); if (s != null && s > bs) { best = id; bs = s } } }
  pick([...own, ...(T.byName[n] || [])])
  if (!best) { loose = true; pick([...own, ...bySuffix(n)]) }
  return best ? asCard(best) : null
}
