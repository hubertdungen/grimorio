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

// ferramenta Tokens (jogar com cartas a sério): as fichas que um deck cria e a pesquisa no índice inteiro (fichas, emblemas,
// masmorras, papéis). As impressões repetidas da mesma ficha (nome, P/R, cores, tipo e texto iguais) contam uma vez.
const same = c => `${c.n}|${c.pt}|${c.co}|${c.t}|${c.o}`
// names: as cartas do deck -> [{ c, from: [cartas que a criam] }], pelo nome
export function deckTokens(names) {
  if (!T) return []
  const by = new Map()
  for (const n of names) for (const id of T.byCard[n] || []) {
    if (!T.tokens[id]) continue
    const c = asCard(id), k = same(c), e = by.get(k) || { c, from: [] }
    if (!e.from.includes(n)) e.from.push(n)
    by.set(k, e)
  }
  return [...by.values()].sort((a, b) => a.c.n.localeCompare(b.c.n))
}
// q: palavras do nome, tipo, P/R («2/2») ou texto; todas têm de estar. O nome exato primeiro, depois o que começa por ele
export function searchTokens(q, limit = 60) {
  const w = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!T || !w.length) return []
  const seen = new Set(), out = []
  for (const id of Object.keys(T.tokens)) {
    const [n, pt, , t, o = ''] = T.tokens[id]
    if (!w.every(x => `${n} ${t} ${pt} ${o}`.toLowerCase().includes(x))) continue
    const c = asCard(id), k = same(c)
    if (!seen.has(k)) { seen.add(k); out.push(c) }
  }
  const q0 = w.join(' '), rank = c => { const n = c.n.toLowerCase(); return n === q0 ? 0 : n.startsWith(q0) ? 1 : n.includes(q0) ? 2 : 3 }
  return out.sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n)).slice(0, limit)
}
// a mesa da ferramenta: [{ k, id, q (quantas), tp (quantas viradas), ctr: { '+1/+1': n, … } }]. op: { add: id, q } junta
// às iguais ainda sem nada (desviradas e sem marcadores) · { k, dq } · { k, tap } vira mais uma (todas viradas -> desvira) ·
// { untap } · { k, ctr, d } · { k, del } · { clear }
export function tokTable(list, op) {
  const up = (k, f) => list.map(x => (x.k === k ? f(x) : x))
  if (op.clear) return []
  if (op.untap) return list.map(x => ({ ...x, tp: 0 }))
  if (op.add) {
    const q = Math.max(1, op.q || 1), j = list.findIndex(x => x.id === op.add && !x.tp && !Object.keys(x.ctr || {}).length)
    return j >= 0 ? list.map((x, i) => (i === j ? { ...x, q: x.q + q } : x)) : [...list, { k: `${op.add}:${Date.now().toString(36)}${list.length}`, id: op.add, q, tp: 0, ctr: {} }]
  }
  if (op.del) return list.filter(x => x.k !== op.k)
  if (op.dq) return list.flatMap(x => (x.k !== op.k ? [x] : x.q + op.dq < 1 ? [] : [{ ...x, q: x.q + op.dq, tp: Math.min(x.tp, x.q + op.dq) }]))
  if (op.tap) return up(op.k, x => ({ ...x, tp: x.tp >= x.q ? 0 : x.tp + 1 }))
  if (op.ctr) return up(op.k, x => { const c = { ...x.ctr, [op.ctr]: (x.ctr?.[op.ctr] || 0) + op.d }; if (c[op.ctr] <= 0) delete c[op.ctr]; return { ...x, ctr: c } })
  return list
}
// uma ficha da mesa pelo id do índice (o que fica guardado no aparelho); null se o índice ainda não chegou
export const tokenById = id => (T && T.tokens[id] ? asCard(id) : null)
