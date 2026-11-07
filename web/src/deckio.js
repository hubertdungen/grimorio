// Exportar / Importar decks (Biblioteca): ler decks de qualquer sítio — o ficheiro do Grimório, .zip de listas, .txt
// (Arena/Moxfield), .dek (MTGO), .csv (Moxfield/Archidekt) ou vários colados — e escrever o .zip de listas .txt.
import { parseList, exportList } from './deck.js'
import { fixFormat } from './formats.js'
import { readZip, makeZip } from './zip.js'
import { tx } from './i18n.js'

const count = m => Object.values(m || {}).reduce((a, b) => a + b, 0)
const base = n => String(n || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')

// uma entrada da pré-visualização: { deck (o corpo a gravar), count, unknown (nomes que não reconheço), src (ficheiro) }
function fromParsed(data, p, name, src, extra = {}) {
  const deck = { name: String(name || tx('Deck importado')).slice(0, 80), main: p.main, side: p.side || {}, maybe: p.maybe || {}, commanders: p.commanders || [], ...extra }
  if (!deck.format) deck.format = fixFormat(data, deck)?.format || 'casual'
  return { deck, count: count(deck.main) + deck.commanders.length, unknown: p.unknown || [], src }
}
const known = (data, d) => [...Object.keys(d.main || {}), ...Object.keys(d.side || {}), ...(d.commanders || [])].filter(n => !data.byName.get(n) && !data.byLower?.get(String(n).toLowerCase()))

// MTGO .dek (XML): <Cards Quantity="4" Sideboard="false" Name="Lightning Bolt" />
function dekText(t) {
  const main = [], side = []
  for (const m of t.matchAll(/<Cards\b([^>]*)\/?>/gi)) {
    const a = k => m[1].match(new RegExp(`${k}="([^"]*)"`, 'i'))?.[1]
    const n = a('Name'), q = +a('Quantity') || 1
    if (n) (/true/i.test(a('Sideboard') || '') ? side : main).push(`${q} ${n.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")}`)
  }
  return ['Deck', ...main, '', 'Sideboard', ...side].join('\n')
}

// CSV (Moxfield, Archidekt, Deckbox…): pelas colunas de quantidade, nome e secção (sideboard/maybe/commander)
function csvRows(t) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch }
    else if (ch === '"') q = true
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim()))
}
function csvText(t) {
  const rows = csvRows(t), h = (rows[0] || []).map(c => c.trim().toLowerCase())
  const qi = h.findIndex(c => /^(count|quantity|qty|amount|quantidade)$/.test(c)), ni = h.findIndex(c => /^(name|card name|card|nome)$/.test(c))
  const bi = h.findIndex(c => /^(board|section|categories|category|zone|secção)$/.test(c))
  if (ni < 0) return null
  const z = { cmd: [], main: [], side: [], maybe: [] }
  for (const r of rows.slice(1)) {
    const n = (r[ni] || '').trim()
    if (!n) continue
    const b = (bi >= 0 ? r[bi] : '').toLowerCase()
    z[/commander/.test(b) ? 'cmd' : /side/.test(b) ? 'side' : /maybe|consider/.test(b) ? 'maybe' : 'main'].push(`${+(qi >= 0 ? r[qi] : 1) || 1} ${n}`)
  }
  return [...(z.cmd.length ? ['Commander', ...z.cmd, ''] : []), 'Deck', ...z.main, '', 'Sideboard', ...z.side, '', 'Maybeboard', ...z.maybe].join('\n')
}

// texto colado ou de um ficheiro: vários decks separados por «Nome: …» / «Name: …» ou por uma linha «---»
export function fromText(data, text, name = '', src = '') {
  const t = String(text || '').replace(/^\uFEFF/, '')  // a marca BOM de alguns ficheiros do Windows
  try {
    const b = JSON.parse(t)
    if (b?.grimorio === 'decks' && Array.isArray(b.decks)) return b.decks.filter(d => d && typeof d.main === 'object').map(d => ({ deck: d, count: count(d.main) + (d.commanders?.length || 0), unknown: known(data, d), src }))
    if (b && typeof b.main === 'object') return [{ deck: b, count: count(b.main), unknown: known(data, b), src }]
  } catch { /* não é JSON */ }
  if (/\.dek$/i.test(src) || /<Deck\b|<Cards\b/i.test(t.slice(0, 2000))) return one(data, dekText(t), name, src)
  if (/\.csv$/i.test(src)) { const c = csvText(t); if (c) return one(data, c, name, src) }
  const chunks = [], hdr = /^\s*(?:name|deck name|nome|deck)\s*:\s*(.+)$/i
  let cur = { name, lines: [] }
  for (const ln of t.split(/\r?\n/)) {
    const m = ln.match(hdr)
    if (m || /^\s*(-{3,}|={3,})\s*$/.test(ln)) {
      if (cur.lines.some(x => x.trim())) chunks.push(cur)
      cur = { name: m ? m[1].trim() : '', lines: [] }
    } else cur.lines.push(ln)
  }
  if (cur.lines.some(x => x.trim())) chunks.push(cur)
  return chunks.flatMap((c, k) => one(data, c.lines.join('\n'), c.name || (chunks.length > 1 ? `${name || tx('Deck colado')} ${k + 1}` : name), src))
}
function one(data, text, name, src) {
  const p = parseList(text, data)
  return count(p.main) || p.commanders.length ? [fromParsed(data, p, name || tx('Deck importado'), src)] : []
}

// ficheiros escolhidos/largados -> entradas (os .zip abrem-se e cada lista lá dentro conta)
export async function readFiles(data, files) {
  const out = []
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      for (const e of await readZip(await f.arrayBuffer()).catch(() => [])) out.push(...fromText(data, e.text, base(e.name), e.name))
    } else out.push(...fromText(data, await f.text(), base(f.name), f.name))
  }
  return out
}

// o .zip de listas .txt (Arena/Moxfield) para outras apps
export function listsZip(decks) {
  const used = new Set()
  return makeZip(decks.map(d => {
    let n = (d.name || 'deck').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'deck', k = 2
    while (used.has(n.toLowerCase())) n = `${n.replace(/ \(\d+\)$/, '')} (${k++})`
    used.add(n.toLowerCase())
    return { name: `${n}.txt`, text: exportList({ commanders: [], side: {}, ...d }) }
  }))
}

export function download(bytes, name, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
