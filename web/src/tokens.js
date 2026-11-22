// Imagens reais das fichas (Scryfall): data/tokens.json vem de build/tokens.py.
// tokenCard(nome, p/t, carta que a criou, cores) devolve uma «carta» como as do cards.json (n, id, t, pt, co, o, kw, df)
// para a ficha que melhor bate: as da carta que a criou primeiro, depois pelo nome (sem «Token», maiúsculas à parte),
// desempatando por P/R e cores; sem índice ou sem nenhuma com esse nome, null (fica a ficha desenhada).
let T = null, ver = 0
const subs = new Set()
// o índice chega depois do primeiro desenho: quem mostra fichas volta a desenhar (useSyncExternalStore(onTokens, tokensVer))
export const onTokens = f => { subs.add(f); return () => subs.delete(f) }
export const tokensVer = () => ver
export const setTokens = j => { T = j; SUF = null; made.clear(); ver++; for (const f of subs) f() }  // também o selfcheck
export const tokensReady = typeof fetch === 'function' ? fetch('data/tokens.json').then(r => (r.ok ? r.json() : null)).then(j => { if (j) setTokens(j) }).catch(() => {}) : Promise.resolve()

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
// os nomes do Forge e da mesa livre -> os da Scryfall: «Emblem - Gideon of the Trials» = «Gideon of the Trials Emblem»
const aliases = n => {
  const m = /^emblem\s*[-—:]\s*(.+)$/.exec(n)
  return [m ? `${m[1]} emblem` : n, ...(/ role$/.test(n) ? [n.replace(/ role$/, '')] : [])]
}

// up: a face pedida é a de baixo de um papel (Role, layout flip): a mesma imagem, rodada 180°
function asCard(id, up = false) {
  const key = up ? `${id}^` : id
  if (made.has(key)) return made.get(key)
  const [n, pt, co, t, o = '', kw = [], faces = 0, , lay = ''] = T.tokens[id]
  const mt = /Creature/.test(t) ? 'Creature' : /\bLand\b/.test(t) ? 'Land' : /^Emblem/.test(t) ? 'Emblem' : (t.split(' — ')[0].replace(/^Token\s+/, '').split(' ').pop() || 'Token')
  const c = { n, id, t, pt, co, ci: co, o, kw, df: faces && lay !== 'flip' ? 1 : 0, mc: '', cmc: 0, tg: [], mt, tok: 1, ...(up && { up: 1 }) }
  made.set(key, c)
  return c
}

// set: a edição da carta que a criou (o Forge diz «M13»): entre impressões iguais, a da edição de fichas «tm13»
export function tokenCard(name, pt, src, col, set) {
  if (!T || !name) return null
  for (const n of aliases(bareToken(name))) { const c = pick1(n, pt, src, col, set); if (c) return c }
  return null
}
function pick1(n, pt, src, col, set) {
  const own = (src && T.byCard[src]) || [], ed = set && String(set).toLowerCase()
  const face = x => (x[6] || []).find(f => f[0].toLowerCase() === n) || x  // ficha de duas faces: a face com este nome
  const score = id => {
    const x = T.tokens[id], f = x && face(x)
    if (!x || (x[0].toLowerCase() !== n && f === x && !(loose && x[0].toLowerCase().endsWith(` ${n}`)))) return null  // a da carta que a criou, mas outra ficha (cria várias)
    let s = own.includes(id) ? 8 : 0
    if (pt && f[1] && !f[1].includes('*')) s += f[1] === pt ? 4 : -4  // */* da Scryfall: o Forge manda o número
    if (col != null) s += colKey(f[2]) === colKey(col) ? 2 : -2
    if (ed && (x[7] === `t${ed}` || x[7] === ed)) s += 1
    return s - (x[6] ? 1 : 0)  // as de uma face mostram mesmo esta ficha (a de duas faces pode mostrar a outra)
  }
  let best = null, bs = -Infinity, loose = false
  const pick = ids => { for (const id of ids) { const s = score(id); if (s != null && s > bs) { best = id; bs = s } } }
  pick([...own, ...(T.byName[n] || [])])
  if (!best) { loose = true; pick([...own, ...bySuffix(n)]) }
  if (!best) return null
  const x = T.tokens[best]
  return asCard(best, x[8] === 'flip' && x[6]?.[1]?.[0].toLowerCase() === n)
}
