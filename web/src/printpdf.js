// Folhas de proxies em PDF, ao estilo das gráficas: papel, margens, tamanho da carta, espaço entre cartas, bleed,
// guias de corte (linhas a toda a folha, só nas margens ou cantos), frente e verso. Tudo em mm; o PDF usa pontos.
// layout() é a matemática da folha; pdf() escreve o ficheiro (imagens JPEG, recortes e linhas) sem bibliotecas.

export const PAPERS = { A4: [210, 297], A3: [297, 420], SRA3: [320, 450], Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8] }
export const UNITS = { mm: 1, cm: 10, in: 25.4 }
export const PRINT0 = {
  unit: 'cm', paper: 'A4', custom: [210, 297], landscape: false, margins: [5, 5, 5, 5], customMargins: false, center: true,
  card: [63, 88], gap: [0, 0], bleed: 0, guides: 'lines', individual: true, guideColor: '#808080', guideWidth: 0.2,
  bleedFill: 'replicate', bleedColor: '#000000', fillCorners: true, watermark: false, watermarkText: 'PROXY', duplex: false, flip: 'side',
  newSheet: false, deckNames: true, deckTags: false, share: false,  // vários decks: folha nova por deck, nomes, partilhar cartas
}

export function pageSize(o) {
  const [w, h] = o.paper === 'custom' ? o.custom : PAPERS[o.paper] || PAPERS.A4
  return o.landscape ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)]
}

// posições das cartas (canto de cima à esquerda do corte, em mm a partir do canto de cima à esquerda da folha) e
// quanto bleed cabe à volta de cada uma: entre cartas é metade do espaço (para não tapar a vizinha), fora é até à borda
export function layout(o) {
  const [W, H] = pageSize(o), [cw, ch] = o.card, [gx, gy] = o.gap
  const [mt, mr, mb, ml] = o.customMargins ? o.margins : [5, 5, 5, 5]
  const aw = W - ml - mr, ah = H - mt - mb
  const cols = Math.max(0, Math.floor((aw + gx + 1e-6) / (cw + gx))), rows = Math.max(0, Math.floor((ah + gy + 1e-6) / (ch + gy)))
  const gw = cols * cw + Math.max(0, cols - 1) * gx, gh = rows * ch + Math.max(0, rows - 1) * gy
  const x0 = o.center ? ml + (aw - gw) / 2 : ml, y0 = o.center ? mt + (ah - gh) / 2 : mt
  const b = Math.max(0, o.bleed), bx = Math.min(b, gx / 2), by = Math.min(b, gy / 2)
  const cells = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = x0 + c * (cw + gx), y = y0 + r * (ch + gy)
    cells.push({ r, c, x, y, clip: [x - (c ? bx : Math.min(b, x)), y - (r ? by : Math.min(b, y)), x + cw + (c < cols - 1 ? bx : Math.min(b, W - x - cw)), y + ch + (r < rows - 1 ? by : Math.min(b, H - y - ch))] })
  }
  const warn = []
  if (!cols || !rows) warn.push('nocabe')
  if (b > 0 && ((cols > 1 && bx < b) || (rows > 1 && by < b))) warn.push('bleed')
  return { W, H, cols, rows, per: cols * rows, cells, x0, y0, gw, gh, cw, ch, b, gx, gy, warn }
}

// segmentos das guias de corte, em mm: [x1, y1, x2, y2]
// individual: cada carta com as suas linhas (duas por espaço); senão uma só a meio do espaço entre cartas
export function guides(L, mode, individual = true) {
  if (mode === 'none' || !L.per) return []
  const cut = (v, i, n, size, gap) => (individual ? [v, v + size] : [i ? v - gap / 2 : v, i < n - 1 ? v + size + gap / 2 : v + size])
  const xs = [...new Set(L.cells.filter(k => !k.r).flatMap(k => cut(k.x, k.c, L.cols, L.cw, L.gx)).map(v => +v.toFixed(3)))]
  const ys = [...new Set(L.cells.filter(k => !k.c).flatMap(k => cut(k.y, k.r, L.rows, L.ch, L.gy)).map(v => +v.toFixed(3)))]
  if (mode === 'lines') return [...xs.map(x => [x, 0, x, L.H]), ...ys.map(y => [0, y, L.W, y])]
  if (mode === 'margins') {  // só fora da grelha (e do bleed de fora), onde a guilhotina se alinha
    const top = L.y0 - L.b - 1, bot = L.y0 + L.gh + L.b + 1, lef = L.x0 - L.b - 1, rig = L.x0 + L.gw + L.b + 1
    return [...xs.flatMap(x => [top > 0 && [x, 0, x, top], bot < L.H && [x, bot, x, L.H]]), ...ys.flatMap(y => [lef > 0 && [0, y, lef, y], rig < L.W && [rig, y, L.W, y]])].filter(Boolean)
  }
  // cantos: marcas de 3 mm para fora de cada canto (por dentro do bleed, que se corta)
  const out = []
  for (const k of L.cells) {
    const [l, t, r, bt] = k.clip, len = (a, lim) => Math.min(3, Math.abs(a - lim))
    for (const [x, y, sx, sy] of [[k.x, k.y, -1, -1], [k.x + L.cw, k.y, 1, -1], [k.x, k.y + L.ch, -1, 1], [k.x + L.cw, k.y + L.ch, 1, 1]]) {
      const lx = len(x, sx < 0 ? l : r), ly = len(y, sy < 0 ? t : bt)
      if (lx > 0.2) out.push([x, y, x + sx * lx, y])
      if (ly > 0.2) out.push([x, y, x, y + sy * ly])
    }
  }
  return out
}

// Vários decks numa impressão. secs = [{ groups: [{ key, q, … }] }], um por deck e pela ordem; key = carta + arte.
// items = grupos a imprimir com o deck a que pertencem; slots = as cópias pela ordem da folha (null = casa vazia, quando
// cada deck começa numa folha nova); sheets = os decks de cada folha. share: cada arte sai só as vezes do deck que mais
// precisa dela (as cópias a mais vão com o deck que as pede) e decks = todos os que a usam.
export function packDecks(secs, per, { share = false, newSheet = false } = {}) {
  const users = new Map(), done = new Map(), items = [], slots = []
  secs.forEach((s, d) => s.groups.forEach(g => users.set(g.key, [...new Set([...(users.get(g.key) || []), d])])))
  secs.forEach((s, d) => {
    if (newSheet && per && slots.length % per) slots.push(...Array(per - (slots.length % per)).fill(null))
    const used = new Map()
    for (const g of s.groups) {
      const u = (used.get(g.key) || 0) + g.q, q = share ? Math.max(0, u - (done.get(g.key) || 0)) : g.q
      used.set(g.key, u); done.set(g.key, Math.max(u, done.get(g.key) || 0))
      if (!q) continue
      const it = { g, q, deck: d, decks: share ? users.get(g.key) : [d] }
      items.push(it)
      for (let k = 0; k < q; k++) slots.push(it)
    }
  })
  const sheets = per ? Array.from({ length: Math.ceil(slots.length / per) }, (_, p) => [...new Set(slots.slice(p * per, (p + 1) * per).flatMap(x => (x ? x.decks : [])))].sort((a, b) => a - b)) : []
  return { items, slots, sheets }
}

// textos da folha (mm, linha de base): o nome dos decks na margem de cima e, se houver espaço, uma etiqueta debaixo de
// cada carta — no espaço entre cartas ou no bleed, que se corta: nunca em cima da carta
const fit = (t, w, s) => { const n = Math.max(1, Math.floor(w / (s * 0.55))); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
export const tagRoom = L => Math.min(L.rows > 1 ? L.gy : Infinity, L.H - L.y0 - L.gh - 1)
export function sheetLabels(L, head, tags) {
  const out = [], top = L.y0 - 1  // pode ficar por cima do bleed de fora, que se corta
  if (head && top >= 4) { const s = Math.min(3.2, top * 0.4); out.push({ x: L.x0, y: top / 2 + s * 0.35, s, t: fit(head, L.gw, s) }) }
  const room = tagRoom(L)
  if (tags && room >= 1.4) {
    const s = Math.min(2.2, room * 0.7)
    L.cells.forEach((k, i) => { if (tags[i]) out.push({ x: k.x + 1, y: k.y + L.ch + s * 0.95, s, t: fit(tags[i], L.cw - 2, s) }) })
  }
  return out
}
// texto em Helvetica (WinAnsi): o que não é latino passa a «?»; tudo escapado em octal para o fluxo ficar ASCII
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 }
export const pdfStr = t => [...t].map(ch => { const c = WIN[ch] ?? ch.charCodeAt(0); return c > 255 || ch.length > 1 ? '?' : c < 32 || c > 126 || '()\\'.includes(ch) ? `\\${c.toString(8).padStart(3, '0')}` : ch }).join('')

const PT = 72 / 25.4
const f = v => (+v.toFixed(3)).toString()
// frente (e verso, com a folha espelhada) de cada página: ops do PDF por página; labelsOf(p) = textos da frente
export function pageOps(L, o, slots, imgOf, labelsOf) {
  const g = guides(L, o.guides, o.individual !== false), [R, G, B] = [1, 3, 5].map(k => parseInt(o.guideColor.slice(k, k + 2), 16) / 255)
  const pages = []
  for (let p = 0; p * L.per < slots.length || (!slots.length && !p); p++) {
    const page = slots.slice(p * L.per, (p + 1) * L.per)
    for (const side of o.duplex ? ['front', 'back'] : ['front']) {
      let s = ''
      page.forEach((slot, i) => {
        const k = L.cells[i], im = slot && imgOf(slot, side)
        if (im == null) return
        let { x, y } = k, [l, t, r, b] = k.clip
        if (side === 'back') {  // a folha vira: espelha a posição (e o recorte) pela margem lateral ou pela de cima
          if (o.flip === 'top') { [t, b] = [L.H - b, L.H - t]; y = L.H - y - L.ch } else { [l, r] = [L.W - r, L.W - l]; x = L.W - x - L.cw }
        }
        const iw = L.cw + 2 * L.b, ih = L.ch + 2 * L.b
        s += `q ${f(l * PT)} ${f((L.H - b) * PT)} ${f((r - l) * PT)} ${f((b - t) * PT)} re W n ${f(iw * PT)} 0 0 ${f(ih * PT)} ${f((x - L.b) * PT)} ${f((L.H - y - L.ch - L.b) * PT)} cm /Im${im} Do Q\n`
      })
      if (side === 'front' && g.length) s += `q ${f(R)} ${f(G)} ${f(B)} RG ${f(o.guideWidth * PT)} w ${g.map(([a, b, c, d]) => `${f(a * PT)} ${f((L.H - b) * PT)} m ${f(c * PT)} ${f((L.H - d) * PT)} l`).join(' ')} S Q\n`
      if (side === 'front' && labelsOf) for (const t of labelsOf(p)) s += `BT /F1 ${f(t.s * PT)} Tf 0.45 g ${f(t.x * PT)} ${f((L.H - t.y) * PT)} Td (${pdfStr(t.t)}) Tj ET\n`
      pages.push(s)
    }
  }
  return pages
}

// PDF mínimo: catálogo, páginas, imagens JPEG (DCTDecode) e um fluxo de conteúdo por página
export function pdf(W, H, pages, images) {
  const enc = new TextEncoder(), parts = [], offs = []
  let len = 0
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length }
  const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); for (const b of [].concat(body)) put(b); put('\nendobj\n') }
  const nImg = images.length, first = 3, pageObj = k => first + nImg + 2 * k
  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, k) => `${pageObj(k)} 0 R`).join(' ')}] >>`)
  const xo = images.map((_, k) => `/Im${k} ${first + k} 0 R`).join(' ')
  images.forEach((im, k) => obj(first + k, [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, '\nendstream']))
  pages.forEach((s, k) => {
    const c = enc.encode(s)
    obj(pageObj(k), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W * PT)} ${f(H * PT)}] /Resources << /XObject << ${xo} >> /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> >> /Contents ${pageObj(k) + 1} 0 R >>`)
    obj(pageObj(k) + 1, [`<< /Length ${c.length} >>\nstream\n`, c, '\nendstream'])
  })
  const n = first + nImg + 2 * pages.length, xref = len
  put(`xref\n0 ${n}\n0000000000 65535 f \n${Array.from({ length: n - 1 }, (_, k) => `${String(offs[k + 1]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(len)
  let p = 0
  for (const b of parts) { out.set(b, p); p += b.length }
  return out
}
