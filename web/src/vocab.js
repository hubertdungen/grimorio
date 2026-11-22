// Vocabulário da pesquisa (data/vocab.json, de build/vocab.py): todas as edições com as cartas de cada uma, os universos
// (Transformers, O Senhor dos Anéis, Assassin's Creed… com as palavras por que se procuram, build/franchises.json) e os
// nomes dos tipos de criatura em pt/es/de/zh tirados das impressões traduzidas. Sem o ficheiro (dados antigos) fica tudo
// vazio e a pesquisa de edições volta a ser pela Scryfall (data.js fetchSets).
// Um termo de edição é { k: 'set', v } com v = código da edição ou id do universo ('bot', 'ltr', 'marvel').

export const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`´]/g, '')
  .replace(/[^a-z0-9㐀-鿿]+/g, ' ').trim()
const CJK = /[㐀-鿿]/

export const VOC = { on: false, sets: new Map(), fr: new Map(), first: [], types: new Map(), zh: [], phrases: [] }
const memo = new Map()

export function setVocab(j, cards) {
  Object.assign(VOC, { on: false, sets: new Map(), fr: new Map(), first: [], types: new Map(), zh: [], phrases: [] })
  memo.clear()
  if (!j?.sets || j.n !== cards.length) return false  // de outra versão do cards.json: os índices não batem
  for (const [code, name, y, t, kids, d] of j.sets) {
    let i = 0
    const m = new Set()
    for (const x of d) m.add(i += x)
    VOC.sets.set(code, { code, name, y, t, kids, m })
  }
  VOC.first = j.first.map(p => j.sets[p]?.[0] || '')
  for (const [id, name, sets, alias, extra] of j.fr || []) VOC.fr.set(id, { id, name, sets, alias, extra: extra || [] })
  // nomes alternativos (flavor_name) na própria carta: c.fl = [{ n: 'Megatron', f: 'megatron', set: 'sld', cn, id }]
  for (const c of cards) delete c.fl
  for (const [i, n, set, cn, id] of j.fl || []) if (cards[i]) (cards[i].fl ||= []).push({ n, f: norm(n), set, cn, id })
  for (const [w, t] of Object.entries(j.types || {})) VOC.types.set(w, t)
  VOC.zh = [...VOC.types.keys()].filter(w => CJK.test(w)).sort((a, b) => b.length - a.length)
  // frases: as palavras dos universos, o nome de cada edição e as metades à volta dos «:» (se só uma edição as tem)
  const ph = new Map(), part = new Map()
  for (const f of VOC.fr.values()) for (const a of [f.name, ...f.alias]) { const p = norm(a); if (p) ph.set(p, f.id) }
  for (const s of VOC.sets.values()) {
    const p = norm(s.name)
    if (p.length >= 5 && !ph.has(p)) ph.set(p, s.code)
    for (const x of [...s.name.split(':'), s.name.replace(/^the /i, '')].map(norm)) if (x.length >= 5 && x !== p) part.set(x, part.has(x) && part.get(x) !== s.code ? null : s.code)
  }
  for (const [p, v] of part) if (v && !ph.has(p)) ph.set(p, v)
  VOC.phrases = [...ph].sort((a, b) => b[0].length - a[0].length)
  VOC.on = true
  return true
}

const isSet = v => VOC.fr.has(v) || VOC.sets.has(v)
// as edições do termo: as do universo, ou a edição e as filhas (Commander, Eternal…)
export function setGroup(v) {
  if (VOC.fr.has(v)) return VOC.fr.get(v).sets
  const out = [], todo = [v]
  while (todo.length) { const k = todo.shift(); const s = VOC.sets.get(k); if (s && !out.includes(k)) { out.push(k); todo.push(...s.kids) } }
  return out
}
const cached = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k) }
// todas as cartas impressas nessas edições (reimpressões incluídas): a pesquisa «set:ltc» traz o Sol Ring
// (um universo também traz as cartas com um nome dele noutra edição: «Megatron» = Blightsteel Colossus da Secret Lair)
export const setMembers = v => cached('m:' + v, () => { const out = new Set(VOC.fr.get(v)?.extra); for (const k of setGroup(v)) for (const i of VOC.sets.get(k)?.m || []) out.add(i); return out })
// só as que nasceram lá: o sabor do universo («Gosto de Transformers»), sem os staples reimpressos
export const setOriginals = v => cached('o:' + v, () => { const g = new Set(setGroup(v)), out = new Set(VOC.fr.get(v)?.extra); VOC.first.forEach((k, i) => { if (g.has(k)) out.add(i) }); return out })
// a impressão com outro nome que bate com as palavras (todas, sem acentos): Blightsteel Colossus para «megatron»
export const flavorHit = (c, words) => (words.length ? c.fl?.find(x => words.every(w => x.f.includes(w))) : undefined)
// a impressão com o nome de um universo (para mostrar a imagem certa quando a carta entra por ele)
export const flavorOf = (c, v) => {
  const f = VOC.fr.get(v)
  if (!f || !c.fl || !f.extra.includes(c.i)) return undefined
  return c.fl.find(x => f.sets.includes(x.set) || f.alias.some(a => ` ${x.f} `.includes(` ${norm(a)} `))) || c.fl[0]
}
export function setLabel(v) {
  const f = VOC.fr.get(v), s = VOC.sets.get(v)
  if (f) return s ? `${f.name} (${v.toUpperCase()})` : f.name
  return s ? `${s.name} (${v.toUpperCase()})` : v.toUpperCase()
}
export const setYear = v => VOC.sets.get(VOC.fr.get(v)?.sets[0] || v)?.y || ''

// Edições e universos nomeados no texto: «set:bot» / «e:"Assassin's Creed"», o código em maiúsculas («MH3», «LTR»), o nome
// da edição ou uma palavra de universo («decepticons», «homem-aranha», «指环王»). As mais compridas primeiro, sem se sobreporem.
// Devolve [{ v, w }] (w = o bocado do texto que bateu, já normalizado) e o texto sem os bocados (rest).
export function findSets(text) {
  const out = [], seen = new Set()
  if (!VOC.on || !text?.trim()) return { hits: out, rest: text || '' }
  let q = ` ${text} `
  const push = (v, w) => { if (!seen.has(v)) { seen.add(v); out.push({ v, w }) } }
  let m
  while ((m = /(?:^|\s)(?:e|set|s|edition|edicao|edição|edicion|edición):("[^"]+"|\S+)/i.exec(q))) {
    const raw = m[1].replace(/"/g, ''), n = norm(raw), v = isSet(raw.toLowerCase()) ? raw.toLowerCase() : VOC.phrases.find(([p]) => p === n)?.[1]
    q = q.replace(m[0], ' ')
    if (v) push(v, n)
  }
  for (const t of q.split(/\s+/)) if (/^[A-Z0-9]{3,5}$/.test(t) && /[A-Z]/.test(t) && VOC.sets.has(t.toLowerCase())) { push(t.toLowerCase(), t.toLowerCase()); q = q.replace(t, ' ') }
  let s = ` ${norm(q)} `
  const used = new Set()
  for (const [p, v] of VOC.phrases) {
    const cjk = CJK.test(p), at = cjk ? s.indexOf(p) : s.indexOf(` ${p} `)
    if (at < 0) continue
    push(v, p)
    if (cjk) { s = s.replace(p, ' '); q = q.replace(p, ' ') } else { s = s.slice(0, at) + ' '.repeat(p.length + 2) + s.slice(at + p.length + 2); for (const w of p.split(' ')) used.add(w) }
  }
  // o resto com as palavras como vieram (apóstrofos e acentos: «Urza's» continua a servir para o nome)
  const rest = q.split(/\s+/).filter(t => { const n = norm(t); return t && !(n && n.split(' ').every(w => used.has(w))) }).join(' ')
  return { hits: out, rest }
}
