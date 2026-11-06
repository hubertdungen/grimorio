// Imagens reais das fichas (Scryfall): data/tokens.json vem de build/tokens.py.
// tokenCard(nome, p/t, carta que a criou, cores) devolve uma «carta» como as do cards.json (n, id, t, pt, co, o, kw, df)
// para a ficha que melhor bate: as da carta que a criou primeiro, depois pelo nome (sem «Token», maiúsculas à parte),
// desempatando por P/R e cores; sem índice ou sem nenhuma com esse nome, null (fica a ficha desenhada).
let T = null
export const tokensReady = fetch('data/tokens.json').then(r => (r.ok ? r.json() : null)).then(j => { T = j }).catch(() => {})
export const setTokens = j => { T = j; made.clear() }  // selfcheck

const made = new Map()  // id -> carta: o mesmo objeto de cada vez (memo do React)
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
    const x = T.tokens[id], f = face(x)
    if (!x || (x[0].toLowerCase() !== n && f === x)) return null  // a da carta que a criou, mas outra ficha (cria várias)
    let s = own.includes(id) ? 8 : 0
    if (pt && f[1] && !f[1].includes('*')) s += f[1] === pt ? 4 : -4  // */* da Scryfall: o Forge manda o número
    if (col != null) s += colKey(f[2]) === colKey(col) ? 2 : -2
    return s - (x[6] ? 1 : 0)  // as de uma face mostram mesmo esta ficha (a de duas faces pode mostrar a outra)
  }
  let best = null, bs = -Infinity
  for (const id of [...own, ...(T.byName[n] || [])]) { const s = score(id); if (s != null && s > bs) { best = id; bs = s } }
  return best ? asCard(best) : null
}
