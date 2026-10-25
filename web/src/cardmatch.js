// Do texto lido por OCR numa foto de carta até à carta: o nome (linha mais parecida com um nome real, tolerando os
// erros típicos do OCR) e, se der, a edição e o número de coleção da linha de baixo (ex.: «0123 R · MH3 · EN»).

export const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const grams = s => { const t = ` ${s} `, out = new Set(); for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3)); return out }

function lev(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

// índice de trigramas dos nomes (cada face de uma carta dupla conta como nome)
export function buildIndex(cards) {
  const names = [], tri = new Map(), exact = new Map()
  cards.forEach((c, i) => {
    for (const part of new Set([c.n, ...c.n.split(' // ')])) {
      const k = norm(part)
      if (k.length < 2) continue
      const id = names.push({ k, i, full: part === c.n }) - 1
      if (!exact.has(k)) exact.set(k, []); exact.get(k).push(id)
      for (const g of grams(k)) { let l = tri.get(g); if (!l) tri.set(g, (l = [])); l.push(id) }
    }
  })
  return { names, tri, exact }
}

// as linhas mais parecidas com nomes de cartas -> [{i (índice da carta), score 0–1, line}], da melhor para a pior
export function matchName(index, lines, { top = 5 } = {}) {
  const best = new Map()
  lines.forEach((raw, li) => {
    const q = norm(raw)
    if (q.length < 3) return
    const qg = grams(q), hits = new Map()
    for (const g of qg) for (const id of index.tri.get(g) || []) hits.set(id, (hits.get(id) || 0) + 1)
    const cand = [...(index.exact.get(q) || []).map(id => [id]), ...[...hits].sort((a, b) => b[1] - a[1]).slice(0, 60)]  // o nome exato entra sempre
    for (const [id] of cand) {
      const { k, i, full } = index.names[id]
      // a linha pode ter lixo à volta (custo de mana, bordas): compara também com o pedaço do tamanho do nome,
      // mas um nome curto escondido numa linha comprida vale menos (senão «Nimble Pilferer» ganhava a «Ragavan, Nimble Pilferer»)
      let score = 1 - lev(q, k) / Math.max(q.length, k.length)
      if (q.length > k.length + 2) {
        let d = 1e9
        for (let s = 0; s + k.length <= q.length; s++) d = Math.min(d, lev(q.slice(s, s + k.length), k) + 1)
        score = Math.max(score, (1 - d / k.length) * (0.7 + (0.3 * k.length) / q.length))
      }
      score -= li * 0.004  // as primeiras linhas (o nome está em cima) ganham por pouco
      if (full) score += 0.005  // empate com a face de uma carta dupla: ganha a carta com esse nome inteiro
      const e = best.get(i) || { i, score: -1, line: raw, faces: new Set() }
      if (score > 0.85) e.faces.add(k)
      if (score > e.score) Object.assign(e, { score, line: raw })
      best.set(i, e)
    }
  })
  for (const e of best.values()) e.score += 0.05 * Math.max(0, e.faces.size - 1)  // cartas duplas: as duas faces lidas
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, top)
}

// linha de baixo das cartas modernas: número de coleção e código da edição (+ língua); nas antigas «123/280»
export function setInfo(text) {
  const t = text.toUpperCase().replace(/[|]/g, 'I')
  const set = (t.match(/\b([A-Z0-9]{3,5})\s*[•·*.,•]\s*(EN|PT|ES|FR|DE|IT|JA|JP|KO|RU|ZHS|ZHT)\b/) || [])[1]
  const cn = (t.match(/\b0*(\d{1,4})\s*\/\s*\d{1,4}\b/) || t.match(/(?:^|\s)0*(\d{1,4})\s+[CURMSLTP]\b/m) || [])[1]
  return set || cn ? { set: set?.toLowerCase(), cn } : null
}
