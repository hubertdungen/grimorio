// Imagens próprias a partir de uma pasta: que ficheiro vai para que carta, e a compressão antes de guardar.
// matchArts(cartas, ficheiros) → [{ card, file, shared, exact }]: cada ficheiro e cada carta no máximo uma vez, pelo
// nome do ficheiro — primeiro os que trazem o nome inteiro da carta, depois os que partilham mais palavras (pelo menos 1).
const STOP = new Set(['the', 'of', 'and', 'for', 'with', 'from', 'into', 'art', 'card', 'cards', 'mtg', 'alt', 'alter', 'altered', 'full', 'copy', 'final', 'image', 'img', 'scan', 'proxy', 'version', 'de', 'da', 'do', 'das', 'dos', 'com', 'carta'])
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’,]/g, '')
export const wordsOf = s => norm(s).replace(/\.(jpe?g|png|webp|gif)$/, '').split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
const slug = s => norm(s).replace(/\.(jpe?g|png|webp|gif)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function matchArts(cards, files) {
  const pairs = []
  for (const card of cards) {
    const face = card.split(' // ')[0], cw = new Set(wordsOf(face)), cs = slug(face)
    files.forEach((f, k) => {
      const fw = wordsOf(f.name), shared = fw.filter((w, i) => cw.has(w) && fw.indexOf(w) === i).length
      const exact = cs.length > 2 && slug(f.name).includes(cs)
      if (shared || exact) pairs.push({ card, k, shared, exact, ratio: shared / (cw.size || 1), extra: fw.length - shared })
    })
  }
  pairs.sort((a, b) => b.exact - a.exact || b.shared - a.shared || b.ratio - a.ratio || a.extra - b.extra)
  const usedC = new Set(), usedF = new Set(), out = []
  for (const p of pairs) {
    if (usedC.has(p.card) || usedF.has(p.k)) continue
    usedC.add(p.card); usedF.add(p.k)
    out.push({ card: p.card, file: files[p.k], shared: p.shared, exact: p.exact })
  }
  return out.sort((a, b) => a.card.localeCompare(b.card))
}

// comprime para guardar (≤ 680 px de largura, WebP): uma carta grande do Scryfall tem 672 px. GIF fica como está.
export async function shrink(blob) {
  if (blob.type === 'image/gif' || typeof createImageBitmap !== 'function') return blob
  const bmp = await createImageBitmap(blob)
  const W = Math.min(680, bmp.width), H = Math.round((bmp.height * W) / bmp.width)
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  cv.getContext('2d').drawImage(bmp, 0, 0, W, H)
  const out = await new Promise(res => cv.toBlob(res, 'image/webp', 0.85))
  return out && out.type === 'image/webp' && out.size < blob.size ? out : blob
}

export function selfcheck() {
  const cards = ['Island', 'Carrion Feeder', 'Archon of Cruelty', 'Bone Picker', 'Xenomorph Queen // Hive Mother']
  const files = ['carrion-feeder-alien.png', 'island_2.jpg', 'Archon.jpg', 'queen xenomorph.webp', 'bone-picker.png', 'Picker of Bones notes.jpg', 'random.png'].map(name => ({ name }))
  const m = Object.fromEntries(matchArts(cards, files).map(x => [x.card, x.file.name]))
  const ok = (c, msg) => { if (!c) throw new Error(`artmatch selfcheck: ${msg} ${JSON.stringify(m)}`) }
  ok(m['Carrion Feeder'] === 'carrion-feeder-alien.png', 'nome inteiro')
  ok(m.Island === 'island_2.jpg', 'número no nome')
  ok(m['Archon of Cruelty'] === 'Archon.jpg', 'uma palavra chega')
  ok(m['Xenomorph Queen // Hive Mother'] === 'queen xenomorph.webp', 'ordem trocada, carta de duas faces')
  ok(m['Bone Picker'] === 'bone-picker.png', 'o nome inteiro ganha a quem partilha as mesmas palavras')
  ok(!Object.values(m).includes('random.png'), 'sem palavras em comum não entra')
  return true
}
