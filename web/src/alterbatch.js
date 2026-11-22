// ✨ Alter arts em lote (deck › Selecionar ou «Alter arts do deck»): que cartas entram, o custo antes de começar, a fila
// (estado puro: reduce + nextStarts, verificados no selfcheck.mjs) e a gravação no IndexedDB, para um recarregar da página
// não perder resultados já pagos.
import { matchArts } from './artmatch.js'

// cartas do deck (comandantes, deck, sideboard), sem repetidas; f = filtros {creatures, nonlands, nobasics, noown}
export function batchCards(deck, data, f = {}) {
  const names = [...new Set([...(deck.commanders || []), ...Object.keys(deck.main || {}), ...Object.keys(deck.side || {})])]
  return names.map(n => data.byName.get(n)).filter(c => c && (!f.creatures || /\bCreature\b/.test(c.t)) && (!f.nonlands || !/\bLand\b/.test(c.t.split('//')[0]))
    && (!f.nobasics || !/\bBasic\b/.test(c.t)) && (!f.noown || !deck.art?.[c.n]))
}

// custo indicativo do lote: preço por imagem × cartas × variações
export const batchCost = (per, cards, variations) => Math.round(per * cards * variations * 1000) / 1000

// --- a fila ---
// item: {n, status: wait|run|ok|err|skip|used, err, custom, results: [{blob, w, h}], tries, after, used}
// job: {items, settings, running, paused, spent, styleRef}
export const newJob = (names, settings) => ({ items: names.map(n => ({ n, status: 'wait', err: '', custom: '', results: [], tries: 0, after: 0 })), settings, running: false, paused: false, spent: 0, styleRef: null })
// erros que passam com tempo (limite de pedidos, rede, servidor ocupado): volta à fila com espera crescente (15 s, 30 s)
export const retryable = m => /limite de pedidos|daqui a pouco|HTTP (429|5\d\d)|failed to fetch|networkerror|load failed/i.test(m || '')
export const MAX_TRIES = 3

export function reduce(job, a) {
  const set = (k, p) => ({ ...job, items: job.items.map((x, j) => (j === k ? { ...x, ...(typeof p === 'function' ? p(x) : p) } : x)) })
  switch (a.t) {
    case 'start': return { ...job, running: true, paused: false }  // começar ou retomar
    case 'pause': return { ...job, paused: true }
    case 'cancel': return { ...job, running: false, paused: false, items: job.items.map(x => (x.status === 'wait' ? { ...x, status: 'skip' } : x)) }
    case 'run': return set(a.k, x => ({ status: 'run', tries: x.tries + 1, err: '' }))
    case 'ok': {  // a.results: as imagens novas (à frente das que já havia); a.cost: o que o servidor diz que custou
      const j = set(a.k, x => ({ status: 'ok', err: '', after: 0, results: [...a.results, ...x.results] }))
      return { ...j, spent: Math.round((job.spent + (a.cost || 0)) * 1000) / 1000, styleRef: job.styleRef || (job.settings?.styleFirst && a.results[0]?.blob) || null }
    }
    case 'fail': return set(a.k, x => (retryable(a.err) && x.tries < MAX_TRIES
      ? { status: 'wait', err: a.err, after: a.now + 15000 * 2 ** (x.tries - 1) }
      : { status: x.results.length ? 'ok' : 'err', err: a.err, after: 0 }))
    case 'again': return { ...set(a.k, { status: 'wait', err: '', tries: 0, after: 0 }), running: true }  // «Outra vez» (fica com as que já tem)
    case 'retryErr': return { ...job, running: true, items: job.items.map(x => (x.status === 'err' ? { ...x, status: 'wait', err: '', tries: 0, after: 0 } : x)) }
    case 'skip': return set(a.k, { status: 'skip', after: 0 })
    case 'use': return set(a.k, { status: 'used', used: a.url })
    case 'custom': return set(a.k, { custom: a.v })
    case 'note': return set(a.k, { err: a.err || '' })  // erro ao guardar/ampliar: fica à vista, o estado não muda
    case 'settings': return { ...job, settings: { ...job.settings, ...a.v } }
    default: return job
  }
}

// que itens arrancam agora: até `conc` ao mesmo tempo; com «a 1.ª como referência de estilo», só um até haver essa 1.ª
export function nextStarts(job, now) {
  if (!job.running || job.paused) return []
  const run = job.items.filter(x => x.status === 'run').length
  const slots = job.settings.styleFirst && !job.styleRef ? 1 - run : (job.settings.conc || 1) - run
  const out = []
  job.items.forEach((x, k) => { if (out.length < slots && x.status === 'wait' && (x.after || 0) <= now) out.push(k) })
  return out
}
// quando voltar a olhar para a fila (o próximo que está à espera de tempo), ou null
export const nextWake = (job, now) => job.items.reduce((m, x) => (x.status === 'wait' && x.after > now && (m == null || x.after < m) ? x.after : m), null)
export const finished = job => job.items.every(x => !['wait', 'run'].includes(x.status))
// ao recarregar a página: o que estava a gerar volta à fila, e a fila fica em pausa (nada gasta sem o utilizador pedir)
export const revive = job => ({ ...job, paused: job.running && !finished(job), items: job.items.map(x => (x.status === 'run' ? { ...x, status: 'wait', after: 0 } : x)) })

// imagens trazidas do ChatGPT → carta, pelo nome do ficheiro (o da carta, como no ZIP). {hits: [{n, file}], rest: [file]}
export function matchFiles(names, files) {
  const hits = matchArts(names, files).map(x => ({ n: x.card, file: x.file }))
  const used = new Set(hits.map(x => x.file))
  return { hits, rest: files.filter(f => !used.has(f)) }
}
// nome de pasta/ficheiro seguro (o ZIP para o ChatGPT): «07 Llanowar Elves»
export const fileName = (n, k) => `${String(k + 1).padStart(2, '0')} ${n.replace(/\s*\/\/\s*/g, ' - ').replace(/[\\/:*?"<>|]+/g, '')}`

// --- IndexedDB (os blobs das imagens não cabem no localStorage); sem IndexedDB, simplesmente não guarda ---
const db = () => new Promise((ok, no) => {
  const r = indexedDB.open('grimorio-alter', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('jobs')
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error)
})
async function store(mode, f) {
  try {
    const d = await db()
    return await new Promise((ok, no) => { const q = f(d.transaction('jobs', mode).objectStore('jobs')); q.onsuccess = () => ok(q.result ?? null); q.onerror = () => no(q.error) })
  } catch { return null }
}
export const jobGet = k => store('readonly', s => s.get(k))
export const jobPut = (k, v) => store('readwrite', s => s.put(v, k))
export const jobDel = k => store('readwrite', s => s.delete(k))

export function selfcheck(assert) {
  // cartas e filtros
  const cards = { 'Llanowar Elves': { n: 'Llanowar Elves', t: 'Creature — Elf Druid' }, Forest: { n: 'Forest', t: 'Basic Land — Forest' }, 'Dryad Arbor': { n: 'Dryad Arbor', t: 'Land Creature — Forest Dryad' },
    'Giant Growth': { n: 'Giant Growth', t: 'Instant' }, 'Ezuri, Renegade Leader': { n: 'Ezuri, Renegade Leader', t: 'Legendary Creature — Elf Warrior' } }
  const data = { byName: new Map(Object.entries(cards)) }
  const deck = { commanders: ['Ezuri, Renegade Leader'], main: { 'Llanowar Elves': 1, Forest: 30, 'Dryad Arbor': 1, 'Giant Growth': 1, 'Nada Disto': 1 }, side: { 'Giant Growth': 1 }, art: { 'Llanowar Elves': 'arts/x.webp' } }
  const ns = f => batchCards(deck, data, f).map(c => c.n)
  assert.deepEqual(ns(), ['Ezuri, Renegade Leader', 'Llanowar Elves', 'Forest', 'Dryad Arbor', 'Giant Growth'], 'sem repetidas nem desconhecidas')
  assert.deepEqual(ns({ creatures: true }), ['Ezuri, Renegade Leader', 'Llanowar Elves', 'Dryad Arbor'])
  assert.deepEqual(ns({ nonlands: true }), ['Ezuri, Renegade Leader', 'Llanowar Elves', 'Giant Growth'])
  assert.deepEqual(ns({ nobasics: true, noown: true }), ['Ezuri, Renegade Leader', 'Dryad Arbor', 'Giant Growth'])
  // custo antes de começar
  assert.equal(batchCost(0.063, 12, 2), 1.512)
  assert.equal(batchCost(0, 40, 2), 0)
  // a fila: concorrência, pausa, falha com e sem nova tentativa, «outra vez», cancelar
  let j = newJob(['A', 'B', 'C'], { conc: 2 })
  assert.deepEqual(nextStarts(j, 0), [], 'parada até carregar em começar')
  j = reduce(j, { t: 'start' })
  assert.deepEqual(nextStarts(j, 0), [0, 1])
  j = reduce(reduce(j, { t: 'run', k: 0 }), { t: 'run', k: 1 })
  assert.deepEqual(nextStarts(j, 0), [], 'duas a gerar: a terceira espera')
  j = reduce(j, { t: 'ok', k: 0, results: [{ blob: 'a1' }], cost: 0.063 })
  assert.deepEqual(nextStarts(j, 0), [2])
  j = reduce(j, { t: 'pause' })
  assert.deepEqual(nextStarts(j, 0), [], 'em pausa não arranca nada')
  j = reduce(j, { t: 'start' })
  j = reduce(j, { t: 'fail', k: 1, err: 'Limite de pedidos da OpenAI atingido; tenta daqui a pouco.', now: 1000 })
  assert.equal(j.items[1].status, 'wait'); assert.equal(j.items[1].after, 16000)
  assert.deepEqual(nextStarts(j, 1000), [2], 'a que espera pelo limite não passa à frente do tempo')
  assert.equal(nextWake(j, 1000), 16000)
  j = reduce(j, { t: 'run', k: 2 })
  j = reduce(j, { t: 'fail', k: 2, err: 'O fornecedor recusou a imagem por segurança (conteúdo).', now: 1000 })
  assert.equal(j.items[2].status, 'err', 'recusa por segurança não se repete sozinha'); assert.ok(!finished(j))
  for (let t = 2; t <= MAX_TRIES; t++) { j = reduce(j, { t: 'run', k: 1 }); j = reduce(j, { t: 'fail', k: 1, err: 'HTTP 503', now: 0 }) }
  assert.equal(j.items[1].status, 'err', `${MAX_TRIES} tentativas e desiste`); assert.equal(j.items[1].tries, MAX_TRIES)
  assert.ok(finished(j)); assert.equal(j.spent, 0.063)
  j = reduce(j, { t: 'retryErr' })
  assert.deepEqual(j.items.map(x => x.status), ['ok', 'wait', 'wait']); assert.equal(j.items[1].tries, 0)
  j = reduce(reduce(j, { t: 'skip', k: 1 }), { t: 'again', k: 0 })
  assert.deepEqual(nextStarts(j, 0), [0, 2])
  j = reduce(reduce(j, { t: 'run', k: 0 }), { t: 'ok', k: 0, results: [{ blob: 'a2' }], cost: 0.063 })
  assert.deepEqual(j.items[0].results.map(r => r.blob), ['a2', 'a1'], 'a nova à frente, a antiga fica'); assert.equal(j.spent, 0.126)
  j = reduce(j, { t: 'use', k: 0, url: 'arts/a.webp' })
  j = reduce(j, { t: 'cancel' })
  assert.deepEqual(j.items.map(x => x.status), ['used', 'skip', 'skip']); assert.ok(finished(j))
  // referência de estilo: uma de cada vez até haver a 1.ª
  let s = reduce(newJob(['A', 'B', 'C'], { conc: 2, styleFirst: true }), { t: 'start' })
  assert.deepEqual(nextStarts(s, 0), [0])
  s = reduce(s, { t: 'run', k: 0 }); assert.deepEqual(nextStarts(s, 0), [])
  s = reduce(s, { t: 'ok', k: 0, results: [{ blob: 'ref' }] })
  assert.equal(s.styleRef, 'ref'); assert.deepEqual(nextStarts(s, 0), [1, 2])
  // recarregar: a que estava a gerar volta à fila e fica tudo em pausa
  const r = revive(reduce(s, { t: 'run', k: 1 }))
  assert.equal(r.items[1].status, 'wait'); assert.ok(r.paused); assert.deepEqual(nextStarts(r, 0), [])
  // nome do ficheiro → carta
  const names = ['Llanowar Elves', 'Ezuri, Renegade Leader', 'Fire // Ice', 'Forest']
  const fs = ['02 Ezuri, Renegade Leader.png', 'llanowar-elves (1).webp', fileName('Fire // Ice', 2) + '.png', 'ChatGPT Image 3 de nov.png'].map(name => ({ name }))
  const m = matchFiles(names, fs)
  assert.deepEqual(Object.fromEntries(m.hits.map(x => [x.n, x.file.name])), { 'Ezuri, Renegade Leader': '02 Ezuri, Renegade Leader.png', 'Fire // Ice': '03 Fire - Ice.png', 'Llanowar Elves': 'llanowar-elves (1).webp' })
  assert.deepEqual(m.rest.map(f => f.name), ['ChatGPT Image 3 de nov.png'], 'o que não bate fica para escolher à mão')
  assert.equal(fileName('Ezuri, Renegade Leader', 0), '01 Ezuri, Renegade Leader')
}
