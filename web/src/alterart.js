// Alter art (🎨 Arte › ✨ Criar alter art): o pedido ao modelo de imagem (em inglês, que os modelos entendem melhor) a partir
// do texto da carta, a caixa da ilustração de cada moldura e a composição final (a arte nova entra só na caixa da moldura
// original: o título, o custo, o tipo e o texto ficam intactos, mesmo que o modelo os tenha estragado).
// As funções de canvas (prepareEdit, composite) só correm no browser; o resto é verificado no selfcheck.mjs.

export const CARD_W = 745, CARD_H = 1040  // o png da Scryfall (63×88 mm a 300 dpi)
// caixa da ilustração [x, y, w, h] em frações da carta, medida nos png da Scryfall de cada moldura
export const ART_BOX = { 2015: [0.080, 0.112, 0.840, 0.443], 2003: [0.085, 0.113, 0.830, 0.443], 1997: [0.095, 0.095, 0.810, 0.435], 1993: [0.115, 0.100, 0.770, 0.408] }
const LAYOUTS = new Set(['normal', 'transform', 'modal_dfc', 'adventure', 'meld', 'leveler', 'prototype'])

// pr = a impressão da Scryfall (frame, border_color, full_art, frame_effects, layout) ou null (sem rede: moldura moderna).
// null = sem caixa conhecida (sem margem, arte completa, showcase, planeswalker, saga…): só o modo «arte completa».
export function artBox(c, pr) {
  if (/\b(Planeswalker|Saga|Battle|Class|Case|Plane|Phenomenon|Scheme)\b/.test(c.t || '')) return null
  if (!pr) return (c.t || '').includes(' // ') && !c.df ? null : ART_BOX[2015]
  if (pr.border_color === 'borderless' || pr.full_art || pr.textless || !LAYOUTS.has(pr.layout || 'normal')) return null
  if ((pr.frame_effects || []).some(f => /extendedart|showcase|etched|fullart|textless/.test(f))) return null
  return ART_BOX[pr.frame] || null
}

const COLORS = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }
const one = s => String(s || '').replace(/\s*\n+\s*/g, ' ').trim()

// O pedido base, editável no diálogo: tudo o que a carta diz, sem o nome do artista (nada de «no estilo de» automático).
export function basePrompt(c, pr) {
  const faces = pr?.card_faces?.[0]
  const flavor = one(pr?.flavor_text || faces?.flavor_text)
  const cols = [...(c.co || '')].map(k => COLORS[k]).filter(Boolean)
  const bits = [
    c.mc && `Mana cost: ${c.mc}.`, c.t && `Type: ${one(c.t)}.`, c.pt && `${/Creature|Vehicle/.test(c.t) ? 'Power/toughness' : 'Loyalty/defense'}: ${c.pt}.`,
    c.o && `Rules text: ${one(c.o)}`, flavor && `Flavor text: "${flavor}"`, pr?.set_name && `Set: ${pr.set_name}.`,
  ].filter(Boolean)
  return [`Original illustration for a fantasy trading card named "${c.n}".`, bits.join(' '),
    `Show what the card is about (its name, type and text) as a detailed, dramatic painted fantasy scene with a strong focal point and clear lighting${cols.length ? `, with a palette that leans ${cols.join(' and ')}` : ''}.`].join('\n')
}

// Pedido «neutro» para quando o fornecedor recusa por segurança: os filtros de imagem barram personagens e marcas com
// direitos (Marneus Calgar, Warhammer 40k, Astartes…). Sai o nome da carta (fica «the hero»), a linha da edição e as
// palavras de todos os universos (build/franchises.json); o resto do pedido (o que a carta faz, cores, modo) fica.
export function neutralPrompt(text, c, words = []) {
  let t = String(text || '')
  const names = [...new Set([c?.n, c?.n?.split(' // ')[0], c?.n?.split(',')[0]].filter(x => x && x.length >= 3))].sort((a, b) => b.length - a.length)
  for (const n of names) t = t.split(n).join('the hero')
  t = t.replace(/\bSet: [^.\n]*\.?/g, '').replace(/\b40,?000\b|\b40k\b/gi, '')
  for (const w of [...new Set(words)].filter(w => w.length >= 4).sort((a, b) => b.length - a.length))
    t = t.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '')
  return t.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:])/g, '$1').trim()
}

// O pedido final: base + toque pessoal + instruções do modo e das imagens anexadas (pela ordem em que vão).
// mode: 'frame' (arte nova na moldura) | 'art' (só a ilustração); masked: o fornecedor recebe máscara (OpenAI, local);
// aspect: 'card' | 'box' (modo arte); refs: quantas referências de estilo; orig: a arte original vai como referência.
export function finalPrompt({ base, custom, mode, masked, aspect = 'card', refs = 0, orig = false, frame = '', font = '', altName = '', autoAlt = false, name = '' }) {
  const out = mode === 'fullart' ? [] : [String(base || '').trim()]
  if (custom?.trim()) out.push(`Personal direction from the user: ${custom.trim()}`)
  const att = []
  if (mode === 'fullart') {  // ⚡ full-art: a ilustração que já lá está, estendida à carta toda (o texto vai por cima depois)
    att.push(masked ? 'the card illustration to extend' : 'the original card (its illustration is what to extend)')
    out.unshift([masked
      ? 'Outpaint: keep the existing illustration in the unmasked area exactly as it is and continue the same scene seamlessly into the masked (transparent) area, so the artwork fills the whole portrait 2:3 image edge to edge.'
      : 'Extend the illustration of the attached card into a FULL-ART version: the same scene, subject, style, palette and lighting, continued seamlessly beyond the original art box so it fills the whole portrait 2:3 image edge to edge.',
    'Only the illustration: no card frame, no borders, no title, no text box, no letters, no symbols, no logos, no watermark.'].join(' '))
  } else if (mode === 'card') {  // carta inteira: ilustração, moldura e letra novas; o texto da carta tem de ficar certo
    att.push('the original card (reference for its exact wording and layout only)')
    out.push(['Redesign the WHOLE trading card: a new original illustration, a new frame and new lettering, portrait 2:3 card proportions.',
      ...(altName.trim() || autoAlt
        ? [`Give the card an alternate name like the Universes Beyond / Godzilla Series cards: the title line shows ${altName.trim() ? `"${altName.trim()}"` : 'a new, evocative alternate name you invent that fits the new art (2-4 words)'} in the usual title lettering, and directly below the title, in smaller letters, the original name "${name}".`,
          'Keep every other word exactly as on the original card and spell it correctly: the mana cost, the type line, the rules text and the power/toughness, in the usual card positions.']
        : ['Keep every word exactly as on the original card and spell it correctly: the title, the mana cost, the type line, the rules text and the power/toughness, in the usual card positions.']),
      `Frame style: ${frame.trim() || 'a fresh, ornate fantasy frame that fits the art'}.`, `Lettering style: ${font.trim() || 'clear, readable fantasy lettering'}.`].join(' '))
  } else if (mode === 'frame') {
    att.push('the card to edit')
    out.push(masked
      ? 'Paint brand-new original artwork only inside the masked (transparent) area, which is the illustration box of the card. Keep the frame, title, mana symbols, type line, text box and borders exactly as they are.'
      : 'Replace only the illustration inside the art box of the attached card with brand-new original artwork. Keep the frame, title, mana symbols, type line, rules text, borders, layout and aspect ratio exactly the same, and return the whole card.')
  } else {
    if (orig) att.push('the original card art (a reference for the subject only: make a new, original composition, do not copy it)')
    out.push(`Create only the illustration, ${aspect === 'box' ? 'landscape, about 4:3' : 'portrait 2:3, filling the whole image'}: no card frame, no border, no text, no letters, no logos, no watermark, no signature.`)
  }
  for (let k = 0; k < refs; k++) att.push('a style reference (use it only for style, palette and mood; do not copy its subject, composition or any text)')
  if (att.length > 1 || (att.length === 1 && mode !== 'frame' && !(mode === 'fullart' && masked))) out.push(`Attached images, in order: ${att.map((a, k) => `${k + 1}) ${a}`).join('; ')}.`)
  if (mode !== 'fullart') out.push('It must be an original work.')
  return out.join('\n\n')
}

// preço indicativo: cost = {low, medium, high} em USD por imagem (GET /api/ia/image)
export const costOf = (cost, quality, n) => (cost ? (cost[quality] ?? Object.values(cost)[0] ?? 0) * n : 0)
// 63 mm de largura: pixels → pontos por polegada na impressão (300 dpi = 744 px)
export const dpiOf = w => Math.round(w / (63 / 25.4))

// Onde fica a carta dentro da imagem que o modelo devolve. geo = {W, H, rect} da imagem enviada (null: veio à parte,
// p. ex. do ChatGPT). Mesma proporção: escala direta; proporção diferente: corta ao centro na proporção da carta.
export function mapRect(ow, oh, geo, aspect = CARD_W / CARD_H) {
  if (geo && Math.abs(ow / oh - geo.W / geo.H) < 0.03) {
    const s = ow / geo.W
    return { x: geo.rect.x * s, y: geo.rect.y * s, w: geo.rect.w * s, h: geo.rect.h * s }
  }
  return ow / oh > aspect ? { x: (ow - oh * aspect) / 2, y: 0, w: oh * aspect, h: oh } : { x: 0, y: (oh - ow / aspect) / 2, w: ow, h: ow / aspect }
}

// --- browser ---
const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = Math.round(w); cv.height = Math.round(h); return cv }
export const toDataURL = cv => cv.toDataURL('image/png')
export async function bitmap(src) {
  const b = src instanceof Blob ? src : await (await fetch(src)).blob()
  return createImageBitmap(b)
}
// imagem de referência: no máximo 1024 px, em png
export async function refURL(src) {
  const bm = await bitmap(src), s = Math.min(1, 1024 / Math.max(bm.width, bm.height))
  const cv = canvas(bm.width * s, bm.height * s)
  cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height)
  return toDataURL(cv)
}

// A carta num quadro 1024×1536 (o tamanho de retrato dos modelos) e a máscara da caixa da arte no formato de cada um:
// 'openai' = opaca com a caixa transparente; 'a1111' = preta com a caixa branca; 'comfy' = a própria carta com a caixa
// transparente (o LoadImage tira a máscara do alfa).
export function prepareEdit(card, box, kind) {
  const W = 1024, H = 1536, w = W, h = Math.round((W * card.height) / card.width), rect = { x: 0, y: Math.round((H - h) / 2), w, h }
  const [bx, by, bw, bh] = box, hole = [rect.x + bx * w, rect.y + by * h, bw * w, bh * h]
  const img = canvas(W, H), g = img.getContext('2d')
  g.fillStyle = '#202020'; g.fillRect(0, 0, W, H)
  g.drawImage(card, rect.x, rect.y, w, h)
  if (kind === 'comfy') { g.clearRect(...hole); return { image: toDataURL(img), mask: null, geo: { W, H, rect } } }
  const m = canvas(W, H), mg = m.getContext('2d')
  mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H)
  if (kind === 'a1111') { mg.fillStyle = '#fff'; mg.fillRect(...hole) } else mg.clearRect(...hole)
  return { image: toDataURL(img), mask: toDataURL(m), geo: { W, H, rect } }
}

// ⚡ Full-art: no quadro 1024×1536 só a arte da carta (na caixa dela); a máscara deixa pintar tudo o resto
export function prepareOutpaint(card, box, kind) {
  const W = 1024, H = 1536, w = W, h = Math.round((W * card.height) / card.width), rect = { x: 0, y: Math.round((H - h) / 2), w, h }
  const [bx, by, bw, bh] = box, keep = [rect.x + bx * w, rect.y + by * h, bw * w, bh * h]
  const img = canvas(W, H), g = img.getContext('2d')
  if (kind !== 'comfy') { g.fillStyle = '#7f7f7f'; g.fillRect(0, 0, W, H) }
  g.drawImage(card, bx * card.width, by * card.height, bw * card.width, bh * card.height, ...keep)
  if (kind === 'comfy') return { image: toDataURL(img), mask: null, geo: { W, H, rect } }
  const m = canvas(W, H), mg = m.getContext('2d')
  if (kind === 'a1111') { mg.fillStyle = '#fff'; mg.fillRect(0, 0, W, H); mg.fillStyle = '#000'; mg.fillRect(...keep) } else { mg.fillStyle = '#000'; mg.fillRect(...keep) }
  return { image: toDataURL(img), mask: toDataURL(m), geo: { W, H, rect } }
}

// ⚡ Full-art: a ilustração estendida a cobrir a carta toda e, por cima, o título e a parte de baixo (tipo, texto,
// poder/resistência) da carta original, sem a borda de fora — como as full-art impressas
export function compositeFullArt(card, out, { box, geo }) {
  const r = mapRect(out.width, out.height, geo), FW = Math.min(2 * CARD_W, Math.max(CARD_W, r.w)), FH = (FW * card.height) / card.width
  const cv = canvas(FW, FH), g = cv.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.drawImage(out, r.x, r.y, r.w, r.h, 0, 0, FW, FH)
  const [, by, , bh] = box, ix = 0.05, top = 0.042, bot = 0.939  // só a barra do título e o bloco tipo/texto/P-T, sem a moldura preta
  const part = (y0, y1, a) => { g.globalAlpha = a; g.drawImage(card, ix * card.width, y0 * card.height, (1 - 2 * ix) * card.width, (y1 - y0) * card.height, ix * FW, y0 * FH, (1 - 2 * ix) * FW, (y1 - y0) * FH) }
  part(top, by - 0.004, 0.96)
  part(by + bh, bot, 0.9)
  g.globalAlpha = 1
  return cv
}

// Imagem final a guardar. mode 'frame' ou 'art' + aspect 'box': a arte do resultado entra na caixa da carta original;
// 'art' + 'card': o resultado cortado à proporção da carta. Devolve um canvas (≥ 745 px de largura, no máximo 2×).
export function composite(card, out, { mode, aspect, box, geo }) {
  if (mode === 'art' && aspect === 'card') {
    const r = mapRect(out.width, out.height, null), s = Math.max(1, CARD_W / r.w)
    const cv = canvas(r.w * s, r.h * s)
    cv.getContext('2d').drawImage(out, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height)
    return cv
  }
  const [bx, by, bw, bh] = box
  let src  // a caixa da arte dentro do resultado
  if (mode === 'frame') { const r = mapRect(out.width, out.height, geo); src = [r.x + bx * r.w, r.y + by * r.h, bw * r.w, bh * r.h] } else {
    const a = (bw * CARD_W) / (bh * CARD_H), r = mapRect(out.width, out.height, null, a); src = [r.x, r.y, r.w, r.h]
  }
  const FW = Math.min(2 * CARD_W, Math.max(CARD_W, src[2] / bw)), FH = (FW * card.height) / card.width
  const cv = canvas(FW, FH), g = cv.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.drawImage(card, 0, 0, cv.width, cv.height)
  g.drawImage(out, ...src, bx * cv.width, by * cv.height, bw * cv.width, bh * cv.height)
  return cv
}

// WebP abaixo dos 6 MB que o servidor aceita (POST /api/arts); sem WebP (Safari antigo), JPEG
export async function toBlob(cv) {
  const enc = (t, q) => new Promise(res => cv.toBlob(res, t, q))
  for (const q of [0.92, 0.85, 0.75, 0.6]) {
    const b = await enc('image/webp', q)
    if (b?.type !== 'image/webp') break
    if (b.size < 5.8e6) return b
  }
  return enc('image/jpeg', 0.82)
}

// alter arts já guardadas, por carta (neste aparelho): aparecem na escolha da arte e como referência de estilo
const HK = 'grimorio.alters'
export function alterHistory(name) {
  try { const h = JSON.parse(localStorage.getItem(HK) || '{}'); return name ? h[name] || [] : Object.values(h).flat() } catch { return [] }
}
export function rememberAlter(name, url, recipe) {
  try {
    const h = JSON.parse(localStorage.getItem(HK) || '{}')
    h[name] = [url, ...(h[name] || []).filter(u => u !== url)].slice(0, 12)
    localStorage.setItem(HK, JSON.stringify(h))
    if (recipe) { const r = JSON.parse(localStorage.getItem(RK) || '{}'); r[url] = recipe; localStorage.setItem(RK, JSON.stringify(r)) }
  } catch { /* sem armazenamento */ }
}
// a «receita» de uma alter art (o texto de personalizar, a moldura, a letra e o modo com que foi feita), para colar o
// mesmo estilo noutra carta: deste aparelho ou guardada no deck (deck.artRecipe, viaja com o deck)
const RK = 'grimorio.alter.recipes'
export const pickRecipe = ({ custom, frame, font, mode, altName }) => ({ ...(custom?.trim() ? { custom: custom.trim() } : {}), ...(frame?.trim() ? { frame: frame.trim() } : {}), ...(font?.trim() ? { font: font.trim() } : {}), ...(mode ? { mode } : {}), ...(altName?.trim() ? { altName: altName.trim() } : {}) })
export function recipeOf(url, decks = []) {
  for (const d of decks) if (d?.artRecipe?.[url]) return d.artRecipe[url]
  try { return JSON.parse(localStorage.getItem(RK) || '{}')[url] || null } catch { return null }
}

export function selfcheck(assert) {
  const elf = { n: 'Llanowar Elves', mc: '{G}', t: 'Creature — Elf Druid', o: '{T}: Add {G}.', pt: '1/1', co: 'G' }
  const pr = { frame: '2015', border_color: 'black', layout: 'normal', flavor_text: 'As patient and generous as life.', artist: 'Some Painter', set_name: 'Dominaria' }
  const b = basePrompt(elf, pr)
  for (const s of ['"Llanowar Elves"', 'Mana cost: {G}', 'Creature — Elf Druid', 'Power/toughness: 1/1', 'Rules text: {T}: Add {G}.', 'Flavor text: "As patient', 'Set: Dominaria', 'green']) assert.ok(b.includes(s), s)
  assert.ok(!b.includes('Some Painter') && !/in the style of/i.test(b), 'nunca o nome do artista no pedido')
  assert.ok(basePrompt(elf, null).includes('Rules text'), 'sem rede: só os dados locais')
  const f = finalPrompt({ base: b, custom: 'pôr do sol', mode: 'frame', masked: true, refs: 1 })
  assert.ok(f.includes('masked (transparent) area') && f.includes('Personal direction from the user: pôr do sol') && f.includes('2) a style reference'))
  assert.ok(finalPrompt({ base: b, mode: 'frame', masked: false }).includes('return the whole card'))
  const a = finalPrompt({ base: b, mode: 'art', orig: true, refs: 2, aspect: 'box' })
  assert.ok(a.includes('1) the original card art') && a.includes('3) a style reference') && a.includes('no text') && a.includes('landscape'))
  assert.ok(!finalPrompt({ base: b, mode: 'art' }).includes('Attached images'), 'sem anexos, não fala deles')
  assert.ok(!/in the style of/i.test(a + f))
  // caixas da arte
  assert.deepEqual(artBox(elf, pr), ART_BOX[2015])
  assert.deepEqual(artBox(elf, { ...pr, frame: '1993' }), ART_BOX[1993])
  assert.equal(artBox(elf, { ...pr, border_color: 'borderless' }), null)
  assert.equal(artBox(elf, { ...pr, frame_effects: ['showcase'] }), null)
  assert.equal(artBox(elf, { ...pr, frame_effects: ['legendary'] }), ART_BOX[2015])
  assert.equal(artBox(elf, { ...pr, frame: 'future' }), null)
  assert.equal(artBox({ ...elf, t: 'Legendary Planeswalker — Jace' }, pr), null)
  assert.equal(artBox({ ...elf, t: 'Instant // Instant' }, null), null)
  assert.deepEqual(artBox(elf, null), ART_BOX[2015])
  for (const [x, y, w, h] of Object.values(ART_BOX)) assert.ok(x > 0 && y > 0 && x + w < 1 && y + h < 0.6 && w > 0.7 && h > 0.35)
  // a carta no quadro 1024×1536 e de volta
  const geo = { W: 1024, H: 1536, rect: { x: 0, y: 53, w: 1024, h: 1430 } }
  assert.deepEqual(mapRect(1024, 1536, geo), geo.rect)
  assert.deepEqual(mapRect(512, 768, geo), { x: 0, y: 26.5, w: 512, h: 715 })
  const cut = mapRect(1000, 1000, geo)  // o modelo devolveu um quadrado: corta ao centro na proporção da carta
  assert.ok(Math.abs(cut.w / cut.h - CARD_W / CARD_H) < 1e-9 && cut.h === 1000 && Math.abs(cut.x - (1000 - cut.w) / 2) < 1e-9)
  assert.equal(dpiOf(744), 300)
  assert.equal(costOf({ low: 0.016, medium: 0.063 }, 'medium', 4), 0.252)
  assert.equal(costOf({ medium: 0.039 }, 'high', 2), 0.078)
}
