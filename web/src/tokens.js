// Imagens reais das fichas (Scryfall): data/tokens.json vem de build/tokens.py.
// Escolhe a ficha pela carta que a criou (src) e depois por nome + P/T; sem índice, fica a ficha desenhada.
let T = null
export const tokensReady = fetch('data/tokens.json').then(r => (r.ok ? r.json() : null)).then(j => { T = j }).catch(() => {})

export function tokenCard(name, pt, src) {
  if (!T || !name) return null
  const n = String(name).replace(/ Token$/, '').toLowerCase()
  const ok = (id, strict) => { const x = T.tokens[id]; return x && x[0].toLowerCase() === n && (!strict || !pt || !x[1] || x[1] === pt) }
  const own = (src && T.byCard[src]) || []
  const all = T.byName[n] || []
  const id = own.find(i => ok(i, true)) || own.find(i => ok(i)) || all.find(i => ok(i, true)) || all[0]
  return id ? { id, n: T.tokens[id][0], t: T.tokens[id][3] } : null
}
