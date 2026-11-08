// O que um pedido do Forge quer, em português: de onde vem (a carta e só a habilidade em causa), o que ela vai fazer ao
// que escolheres e o que tens de escolher agora. O Forge escreve em inglês, por exemplo
//   «Banishing Light (12) - When Banishing Light enters, exile target nonland permanent an opponent controls … [Zone
//    Changer: Banishing Light (12)]\n\nSelect target nonland permanent an opponent controls»
//   «Spirit Mantle (47) - Spirit Mantle\n\nSelect target creature» (uma aura a ser lançada: o alvo é o que vai encantar)
//   «Oblivion Ring (9) - When Oblivion Ring enters, exile another target nonland permanent. …\n\nChoose another target …»
//   «Use triggered ability of Verduran Enchantress (44)?\nTriggered by: Pacifism (59)»
//   ask order «Select order for simultaneous abilities» (first: «Resolve first»), as opções só com o texto do gatilho
// Puro (sem React nem DOM): oracle(nome) devolve o texto da carta (ou '').
import { tx } from './i18n.js'

// sem as notas do Forge («[Zone Changer: …]», «(Targeting: [[X (6)]])») nem os n.º das cartas
export const fClean = t => String(t || '').replace(/\s*\(Targeting: .*?\]\]\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/ \(\d+\)/g, '').replace(/\s{2,}/g, ' ').trim()
// gatilho: «When/Whenever/At…», também depois de uma palavra de habilidade («Constellation — Whenever…»)
export const isTrigger = t => /^(?:[A-Z][\w' -]{2,30} — )?(?:When|Whenever|At)\b/.test(fClean(t))

// o que a habilidade faz ao que escolheres: h = 1 prejudica, -1 ajuda; v = o que acontece (sujeito: «o alvo»), inf = o verbo
const EFX = [
  [/\bexiles?\b/i, 1, () => tx('será exilado'), () => tx('exilar')],
  [/\bdestroys?\b/i, 1, () => tx('será destruído'), () => tx('destruir')],
  [/\bcounter target\b/i, 1, () => tx('é anulado'), () => tx('anular')],
  [/\bgain control\b|\byou control enchanted\b/i, 1, () => tx('muda de dono: passa a ser controlado por quem o lança'), () => tx('roubar')],
  [/\breturns?\b[^.]*?\bto (?:its|their) owners?['’]?s? hands?/i, 1, () => tx('volta à mão do dono'), () => tx('devolver à mão')],
  [/\bdeals? (\d+|X) damage/i, 1, m => tx('leva {d} de dano', { d: m[1] }), () => tx('causar-lhe dano')],
  [/\bgets? ([−-](?:\d+|X))\/([−-](?:\d+|X))/i, 1, m => tx('fica com {p}/{t}', { p: m[1], t: m[2] }), () => tx('enfraquecer')],
  [/-1\/-1 counters?/i, 1, () => tx('recebe marcadores −1/−1'), () => tx('enfraquecer')],
  [/can['’]t attack or block|can['’]t block|can['’]t attack/i, 1, () => tx('deixa de poder atacar e bloquear'), () => tx('prender')],
  [/doesn['’]t untap/i, 1, () => tx('deixa de desvirar'), () => tx('prender')],
  [/\bsacrifices?\b/i, 1, () => tx('é sacrificado'), () => tx('sacrificar')],
  [/\btap (?:target|enchanted|it|that)\b/i, 1, () => tx('fica virado'), () => tx('virar')],
  [/\bgets? \+(\d+|X)\/\+(\d+|X)/i, -1, m => tx('recebe +{p}/+{t}', { p: m[1], t: m[2] }), () => tx('reforçar')],
  [/\+1\/\+1 counters?/i, -1, () => tx('recebe marcadores +1/+1'), () => tx('reforçar')],
  [/\buntap target\b/i, -1, () => tx('é desvirado'), () => tx('desvirar')],
  [/\b(?:has|have|gains?) (hexproof|indestructible|protection|flying|trample|lifelink|vigilance|first strike|double strike|haste|deathtouch|menace|reach)\b/i, -1, m => tx('ganha {k}', { k: m[1].toLowerCase() }), () => tx('reforçar')],
]
export function effectOf(text) {
  const t = String(text || '')
  for (const [re, h, v, inf] of EFX) { const m = t.match(re); if (m) return { h, v: v(m), inf: inf() } }
  return null
}

// o substantivo do alvo («nonland permanent an opponent controls») em português; o que não se reconhece fica em inglês
const BASE = { creature: [tx('criatura'), 'f'], permanent: [tx('permanente'), 'm'], artifact: [tx('artefacto'), 'm'], enchantment: [tx('encantamento'), 'm'],
  land: [tx('terreno'), 'm'], planeswalker: ['planeswalker', 'm'], player: [tx('jogador'), 'm'], opponent: [tx('adversário'), 'm'], card: [tx('carta'), 'f'],
  spell: [tx('feitiço'), 'm'], battle: [tx('batalha'), 'f'], 'creature or planeswalker': [tx('criatura ou planeswalker'), 'f'], 'artifact or enchantment': [tx('artefacto ou encantamento'), 'm'],
  'creature or player': [tx('criatura ou jogador'), 'f'], 'player or planeswalker': [tx('jogador ou planeswalker'), 'm'] }
const MOD = { nonland: tx('que não seja terreno'), noncreature: tx('que não seja criatura'), nonartifact: tx('que não seja artefacto'), nonenchantment: tx('que não seja encantamento'),
  tapped: '', untapped: tx('por virar'), attacking: tx('atacante'), blocking: tx('bloqueador'), 'attacking or blocking': tx('atacante ou bloqueador') }
export function nounPt(en) {
  let s = String(en || '').trim().replace(/\.$/, '').replace(/\s*\(.*$/, '').toLowerCase()
  if (/^any (?:other )?target$/.test(s)) return { n: tx('qualquer alvo (criatura, jogador ou planeswalker)'), g: 'm' }
  const other = /^another /.test(s); s = s.replace(/^another /, '')
  let own = ''
  const o = s.match(/ (you control|you don['’]t control|an opponent controls|your opponents control|you own)$/)
  if (o) { own = /^you (?:control|own)$/.test(o[1]) ? 'mine' : 'theirs'; s = s.slice(0, o.index) }
  const mods = []
  for (;;) { const k = Object.keys(MOD).sort((a, b) => b.length - a.length).find(k => s.startsWith(`${k} `)); if (!k) break; mods.push(k); s = s.slice(k.length + 1) }
  const b = BASE[s.replace(/s$/, '')] || BASE[s]
  if (!b) return null
  const [n, g] = b, f = g === 'f'
  const mod = mods.map(k => (k === 'tapped' ? (f ? tx('virada') : tx('virado')) : MOD[k])).join(' ')
  const ow = own === 'mine' ? (f ? tx('tua') : tx('teu')) : own === 'theirs' ? tx('de um adversário') : ''
  return { n: [other ? (f ? tx('outra') : tx('outro')) : '', n, mod, ow].filter(Boolean).join(' '), g }
}

// a 1.ª linha do pedido: «Nome (id) - texto da habilidade»; «Use triggered ability of Nome (id)?»
export function srcLine(msg) {
  const ls = String(msg || '').split('\n'), l0 = ls[0].trim()
  let m = /^Use triggered ability of (.+?) \((\d+)\)\?$/.exec(l0)
  if (m) { const by = /^Triggered by: (.+?)(?: \((\d+)\))?$/.exec((ls[1] || '').trim()); return { id: +m[2], name: m[1], text: '', opt: true, by: by?.[1] || '' } }
  m = /^(.+?) \((\d+)\)(?: -\s+(.+))?$/.exec(l0)
  return m ? { id: +m[2], name: m[1], text: m[3] || '' } : null
}
// a habilidade em causa, só essa: a da 1.ª linha, a do gatilho lembrado (stk: texto da pilha por carta), ou do texto da
// carta — numa aura que se lança, as linhas «Enchant …» / «Enchanted …»
const auraLines = o => String(o || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(l => /^(?:Enchant\b|Enchanted\b|You control enchanted\b)/.test(l))
export function abilityText(src, oracle, stk) {
  if (!src) return ''
  const t = fClean(src.text)
  const at = /^Attach to (.+)$/.exec(t)
  if (at) return tx('Prende-se a {c}', { c: at[1] })
  if (t && t !== src.name && !/^[^-]+ - (?:Creature|Artifact|Enchantment|Planeswalker|Land)\b/.test(t)) return t
  const st = stk?.get?.(src.id)
  if (st) return fClean(st)
  const o = oracle(src.name), al = auraLines(o)
  return al.length ? al.join(' · ') : ''
}

// o texto de um gatilho (as opções de «ordenar gatilhos» só trazem isso) → a carta de onde vem: a do campo cujo texto tem
// essa frase (o nome da carta no texto do Forge pode estar como «this creature» no texto atual da Scryfall)
const norm = (t, name) => fClean(t).toLowerCase().replace(/^[\w' -]{2,30} — /, '').split(String(name || '\u0000').toLowerCase()).join('~').replace(/\bthis (?:creature|enchantment|artifact|permanent|card|land)\b/g, '~').replace(/[^a-z0-9~+/ ]/g, ' ').replace(/\s+/g, ' ').trim()
export function cardOfText(label, cards, oracle) {
  let best = null
  for (const c of cards || []) {
    if (!c?.name || c.hidden) continue
    const a = norm(label, c.name)
    for (const l of String(oracle(c.name) || '').split('\n')) {
      const b = norm(l.replace(/\([^)]*\)/g, ''), c.name)
      if (b.length < 8) continue
      const wa = new Set(a.split(' ')), wb = b.split(' '), hit = wb.filter(w => wa.has(w)).length / Math.max(wb.length, wa.size)
      if (!best || hit > best.hit) best = { hit, c }
    }
  }
  return best && best.hit >= 0.6 ? best.c : null
}

// «ordenar gatilhos»: a carta de cada opção. O Forge manda a carta de origem (src, o id); sem ele vai-se pelo texto, e com
// mais de uma cópia dessa carta à vista não se sabe qual: fica a imagem sem id ({name, copy: n.º de cópias})
export function trigCards(options, cards, oracle) {
  const vis = (cards || []).filter(c => c?.name && !c.hidden)
  return (options || []).map(o => {
    if (o.src != null) { const c = vis.find(x => x.id === o.src); if (c) return c }
    const c = cardOfText(o.label, vis, oracle)
    if (!c) return null
    const n = vis.filter(x => x.name === c.name).length
    return n > 1 ? { name: c.name, copy: n } : c
  })
}

// o pedido todo: { src, text (a habilidade), kind ('aura'|'target'|'opt'|'pick'), line (a instrução), harm (1/-1/0), v, inf }
// pr = o pedido do Forge ({msg, card, cardName}); stk = Map(id da carta → texto da pilha) com o que esteve na pilha há pouco
export function reqOf(pr, oracle, stk) {
  const msg = String(pr?.msg || '')
  if (!msg || /^(Priority:|Waiting for)/.test(msg)) return null
  let src = srcLine(msg)
  if (!src && pr.card != null && pr.cardName) src = { id: pr.card, name: pr.cardName, text: '' }
  if (!src) return null
  const text = abilityText(src, oracle, stk)
  const o = oracle(src.name) || '', aura = /^Enchant\b/m.test(o) && (fClean(src.text) === src.name || !src.text)
  const lines = msg.split('\n').map(l => l.trim()).filter(Boolean).slice(1)
  const ask = lines.find(l => /^(Select|Choose)\b/i.test(l)) || ''
  const done = lines.find(l => /^Targeted: /.test(l))?.slice(10).replace(/ \(\d+\)/g, '') || ''
  const more = +(msg.match(/\((\d+) more can be targeted\)/)?.[1] || 0)
  const tail = [done && tx('Já escolhido: {x}.', { x: done }), more && tx('Podes escolher mais {k}.', { k: more })].filter(Boolean).join(' ')
  const out = { src, text, kind: 'info', line: '', harm: 0 }
  if (src.opt) return { ...out, kind: 'opt', line: src.by ? tx('Usar o gatilho de {c}? (disparado por {b})', { c: src.name, b: src.by }) : tx('Usar o gatilho de {c}?', { c: src.name }) }
  const tg = /^(?:Select|Choose) (?:up to (\w+) )?((?:another )?(?:any )?targets? ?.*?)\.?$/i.exec(ask)
  if (tg) {
    const nounEn = tg[2].replace(/^(another )?targets? /i, '$1').replace(/^(another )?any target$/i, 'any target')
    const n = nounPt(/^any /i.test(tg[2]) ? 'any target' : nounEn)
    const upTo = tg[1] ? ` ${tx('(até {k})', { k: tg[1] })}` : ''
    if (aura) {
      const enc = nounPt((o.match(/^Enchant ([^\n(]+)/m)?.[1] || '').trim()) || n
      const e = effectOf(auraLines(o).slice(1).join(' '))
      const hint = e?.h > 0 ? tx('normalmente numa carta do adversário') : e?.h < 0 ? tx('normalmente numa carta tua') : ''
      const head = enc ? (enc.g === 'f' ? tx('Escolhe a {n} que {c} vai encantar', { n: enc.n, c: src.name }) : tx('Escolhe o {n} que {c} vai encantar', { n: enc.n, c: src.name })) : tx('Escolhe o que {c} vai encantar', { c: src.name })
      return { ...out, kind: 'aura', harm: e?.h || 0, v: e?.v, inf: tx('encantá-la com {c}', { c: src.name }),
        line: `${head}${e ? `: ${e.v}` : ''}${hint ? ` — ${hint}` : ''}.${tail ? ` ${tail}` : ''}` }
    }
    // o efeito: a frase com «target» da habilidade (ou o texto todo)
    const sent = text.split(/(?<=\.)\s+/).find(s => /\btarget\b/i.test(s)) || text
    const e = effectOf(sent)
    const what = n ? n.n : nounEn
    return { ...out, kind: 'target', harm: e?.h || 0, v: e?.v, inf: e?.inf,
      line: `${e ? tx('Escolhe o alvo de {c} ({n}): {v}.', { c: src.name, n: what, v: e.v }) : tx('Escolhe o alvo de {c}: {n}.', { c: src.name, n: what })}${upTo}${tail ? ` ${tail}` : ''}` }
  }
  // «Select 2 creature(s) to sacrifice.», «Choose a creature to sacrifice», «Select a card to discard»
  const pk = /^(?:Select|Choose) (?:up to )?(a|an|one|\d+) (.+?)(?:\(s\))? to (sacrifice|discard|exile|destroy|tap|untap|return|reveal|keep)\b/i.exec(ask)
  if (pk) {
    const VERB = { sacrifice: tx('sacrificar'), discard: tx('descartar'), exile: tx('exilar'), destroy: tx('destruir'), tap: tx('virar'), untap: tx('desvirar'), return: tx('devolver'), reveal: tx('revelar'), keep: tx('ficar') }
    const k = /^\d+$/.test(pk[1]) ? +pk[1] : 1, n = nounPt(pk[2])
    return { ...out, kind: 'pick', line: tx('{c}: escolhe {k} ({n}) para {v}.', { c: src.name, k, n: n?.n || pk[2], v: VERB[pk[3].toLowerCase()] }) }
  }
  return out
}

// as escolhas genéricas do Forge («Choose a color», «Choose a creature type», «Choose a number»…): a instrução em português;
// null = não é uma destas (fica o texto do Forge ou o que o pedido diz)
const TYPE = { creature: tx('Escolhe um tipo de criatura.'), card: tx('Escolhe um tipo de carta.'), land: tx('Escolhe um tipo de terreno.'), 'basic land': tx('Escolhe um tipo de terreno básico.'),
  artifact: tx('Escolhe um tipo de artefacto.'), enchantment: tx('Escolhe um tipo de encantamento.'), planeswalker: tx('Escolhe um tipo de planeswalker.'), spell: tx('Escolhe um tipo de feitiço.') }
const ASK = [
  [/^Choose a colou?r$/i, () => tx('Escolhe uma cor.')],
  [/^Choose a colou?r for (.+)$/i, m => tx('Escolhe uma cor para {c}.', { c: m[1] })],
  [/^Choose a single colou?r from (.+)$/i, m => tx('Escolhe uma cor de {c}.', { c: m[1] })],
  [/^Choose (\d+) colou?rs\b/i, m => tx('Escolhe {k} cores.', { k: m[1] })],
  [/^Choose (\d+) or more colou?rs?$/i, m => tx('Escolhe {k} ou mais cores.', { k: m[1] })],
  [/^Choose (\d+) to (\d+) colou?rs?$/i, m => tx('Escolhe de {a} a {b} cores.', { a: m[1], b: m[2] })],
  [/^Choose a new colou?r word$/i, () => tx('Escolhe a nova palavra de cor.')],
  [/^Choose a colou?r word to replace$/i, () => tx('Escolhe a palavra de cor a substituir.')],
  [/^Choose an? (creature|card|land|basic land|artifact|enchantment|planeswalker|spell) type$/i, m => TYPE[m[1].toLowerCase()]],
  [/^(?:Choose|Select) a number$/i, () => tx('Escolhe um número.')],
  [/^How many\?$/i, () => tx('Quantos?')],
  [/^Choose a value for X$/i, () => tx('Escolhe o valor de X.')],
  [/^Choose ([A-Z]) for (.+)$/, m => tx('Escolhe o valor de {x} para {c}.', { x: m[1], c: m[2] })],
  [/^Choose a player$/i, () => tx('Escolhe um jogador.')],
  [/^Choose an? opponent$/i, () => tx('Escolhe um adversário.')],
  [/^Choose a card name\.?$/i, () => tx('Diz o nome de uma carta')],
  [/^Choose an? (.+?) card name\.?$/i, m => { const n = nounPt(`${m[1]} card`), t = !n && nounPt(m[1]); return n ? tx('Diz o nome de uma {n}.', { n: n.n }) : t ? tx('Diz o nome de uma carta de {n}.', { n: t.n }) : tx('Diz o nome de uma carta ({t}).', { t: m[1] }) }],
  [/^.+ activated (.+) - Choose a mode$/i, m => tx('Escolhe um modo de {c}.', { c: fClean(m[1]) })],
  [/^Choose (?:a )?mode\b.*$/i, () => tx('Escolhe um modo.')],
  [/^Choose one\b.*$/i, () => tx('Escolhe uma opção.')],
  [/^Choose a direction$/i, () => tx('Escolhe uma direção.')],
  [/^Choose a pile$/i, () => tx('Escolhe um monte.')],
  [/^Choose a source$/i, () => tx('Escolhe uma fonte.')],
  [/^Choose a result$/i, () => tx('Escolhe um resultado.')],
  [/^Choose a protection$/i, () => tx('Escolhe uma proteção.')],
  [/^Choose a creature$/i, () => tx('Escolhe uma criatura.')],
  [/^Choose a card$/i, () => tx('Escolhe uma carta.')],
  [/^Select Mana to Produce$/i, () => tx('Escolhe a mana a produzir.')],
  [/^Choose ability to play$/i, () => tx('Escolhe a habilidade a usar.')],
  [/^Choose optional costs$/i, () => tx('Escolhe os custos opcionais.')],
  [/^Choose keyword to grant$/i, () => tx('Escolhe a habilidade a dar.')],
  [/^Select counter type\b.*$/i, () => tx('Escolhe o tipo de marcador.')],
  [/^Select type (?:of )?counters? to (?:add or )?remove$/i, () => tx('Escolhe o tipo de marcador a tirar.')],
  [/^Choose odd or even$|^Odd or even\??$/i, () => tx('Escolhe ímpar ou par.')],
]
export function askPt(msg) {
  const m0 = String(msg || '').trim()
  if (!m0 || m0.includes('\n')) return null
  for (const [re, f] of ASK) { const m = re.exec(m0); if (m) return f(m) }
  return null
}
// o rótulo das opções de vocabulário fixo (cores, tipos de carta, terrenos básicos, sim/não, jogar/comprar…) em português; o
// que o Forge recebe de volta é o mesmo (o índice da opção, ou o texto original nas escolhas por texto)
const OPT = { white: tx('Branco'), blue: tx('Azul'), black: tx('Preto'), red: tx('Vermelho'), green: tx('Verde'), colorless: tx('Incolor'), multicolor: tx('Multicor'),
  artifact: tx('Artefacto'), creature: tx('Criatura'), enchantment: tx('Encantamento'), instant: tx('Instantâneo'), sorcery: tx('tipo de carta§Feitiço'), land: tx('Terreno'),
  planeswalker: 'Planeswalker', battle: tx('Batalha'), kindred: tx('Tribal'), tribal: tx('Tribal'),
  plains: tx('Planície'), island: tx('Ilha'), swamp: tx('Pântano'), mountain: tx('Montanha'), forest: tx('Floresta'),
  yes: tx('Sim'), no: tx('Não'), ok: tx('OK'), play: tx('Jogar primeiro'), draw: tx('Comprar (ir em segundo)'),
  heads: tx('Cara'), tails: tx('Coroa'), odd: tx('Ímpar'), odds: tx('Ímpar'), even: tx('número§Par'), evens: tx('número§Par'),
  left: tx('Esquerda'), right: tx('Direita'), 'left (clockwise)': tx('Esquerda (sentido horário)'), 'right (anticlockwise)': tx('Direita (sentido anti-horário)'),
  tap: tx('Virar'), untap: tx('Desvirar'), 'leave tapped': tx('Deixar virado'), increase: tx('Aumentar'), decrease: tx('Diminuir'),
  'add counter': tx('Pôr um marcador'), 'remove counter': tx('Tirar um marcador'), 'win the flip': tx('Ganhar a moeda ao ar'), 'lose the flip': tx('Perder a moeda ao ar'),
  top: tx('Topo da biblioteca'), bottom: tx('Fundo da biblioteca') }
export const optPt = label => OPT[String(label ?? '').trim().toLowerCase()] ?? label
// a cor de uma opção («White» → W), para o símbolo de mana ao lado do nome
export const optSym = label => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' })[String(label ?? '').trim().toLowerCase()] || ''

export function selfcheck(assert) {
  const O = { 'Spirit Mantle': 'Enchant creature\nEnchanted creature gets +1/+1 and has protection from creatures.', Pacifism: "Enchant creature\nEnchanted creature can't attack or block.",
    'Banishing Light': 'When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.',
    'Setessan Champion': 'Constellation — Whenever an enchantment you control enters, put a +1/+1 counter on this creature and draw a card.', 'Verduran Enchantress': 'Whenever you cast an enchantment spell, you may draw a card.' }
  const oracle = n => O[n] || ''
  let r = reqOf({ msg: 'Spirit Mantle (47) - Spirit Mantle\n\nSelect target creature' }, oracle)
  assert.equal(r.kind, 'aura'); assert.equal(r.harm, -1); assert.match(r.line, /^Escolhe a criatura que Spirit Mantle vai encantar: recebe \+1\/\+1 — normalmente numa carta tua\.$/)
  assert.match(r.text, /^Enchant creature · Enchanted creature gets/)
  r = reqOf({ msg: 'Pacifism (58) - Pacifism\n\nSelect target creature' }, oracle); assert.equal(r.harm, 1); assert.match(r.line, /deixa de poder atacar e bloquear — normalmente numa carta do adversário/)
  r = reqOf({ msg: 'Banishing Light (12) - When Banishing Light enters, exile target nonland permanent an opponent controls until Banishing Light leaves the battlefield. [Zone Changer: Banishing Light (12)]\n\nSelect target nonland permanent an opponent controls' }, oracle)
  assert.equal(r.kind, 'target'); assert.equal(r.harm, 1); assert.equal(r.inf, 'exilar')
  assert.equal(r.line, 'Escolhe o alvo de Banishing Light (permanente que não seja terreno de um adversário): será exilado.')
  assert.equal(r.text, 'When Banishing Light enters, exile target nonland permanent an opponent controls until Banishing Light leaves the battlefield.')
  r = reqOf({ msg: 'Oblivion Ring (9) - When Oblivion Ring enters, exile another target nonland permanent. [Zone Changer: Oblivion Ring (9)]\n\nChoose another target nonland permanent' }, oracle)
  assert.equal(r.line, 'Escolhe o alvo de Oblivion Ring (outro permanente que não seja terreno): será exilado.')
  r = reqOf({ msg: 'Use triggered ability of Verduran Enchantress (44)?\nTriggered by: Pacifism (59)' }, oracle, new Map([[44, 'Whenever you cast an enchantment spell, you may draw a card. [Card: Pacifism (59), Activator: Tu]']]))
  assert.equal(r.kind, 'opt'); assert.equal(r.src.id, 44); assert.equal(r.text, 'Whenever you cast an enchantment spell, you may draw a card.'); assert.match(r.line, /disparado por Pacifism/)
  r = reqOf({ msg: 'Prodigal Pyromancer (114) - Prodigal Pyromancer deals 1 damage to any target.\n\nSelect any target' }, oracle); assert.match(r.line, /qualquer alvo .*: leva 1 de dano/)
  r = reqOf({ msg: 'Pacifism (59) -  Attach to Grizzly Bears (62)\n\nPay Mana Cost: {1}{W}' }, oracle); assert.equal(r.text, 'Prende-se a Grizzly Bears'); assert.equal(r.line, '')
  assert.equal(reqOf({ msg: 'Priority: Tu' }, oracle), null)
  assert.ok(isTrigger('Constellation — Whenever an enchantment you control enters, draw a card.')); assert.ok(!isTrigger('Spirit Mantle (47) - Attach to X (3)'))
  const cs = [{ name: 'Setessan Champion' }, { name: 'Verduran Enchantress' }]
  assert.equal(cardOfText('Constellation — Whenever an enchantment you control enters, put a +1/+1 counter on Setessan Champion and draw a card. [Zone Changer: Oblivion Ring (9)]', cs, oracle)?.name, 'Setessan Champion')
  assert.equal(cardOfText('Whenever you cast an enchantment spell, you may draw a card. [Card: Oblivion Ring (9), Activator: Tu]', cs, oracle)?.name, 'Verduran Enchantress')
  assert.equal(nounPt('creature you control').n, 'criatura tua'); assert.equal(nounPt('tapped creature').n, 'criatura virada')
  // escolhas genéricas: a instrução e as opções de vocabulário fixo em português
  assert.equal(askPt('Choose a color'), 'Escolhe uma cor.'); assert.equal(askPt('Choose a color for Birds of Paradise'), 'Escolhe uma cor para Birds of Paradise.')
  assert.equal(askPt('Choose a creature type'), 'Escolhe um tipo de criatura.'); assert.equal(askPt('Choose a basic land type'), 'Escolhe um tipo de terreno básico.')
  assert.equal(askPt('Choose a card type'), 'Escolhe um tipo de carta.'); assert.equal(askPt('Choose a number'), 'Escolhe um número.'); assert.equal(askPt('Select a number'), 'Escolhe um número.')
  assert.equal(askPt('Choose a player'), 'Escolhe um jogador.'); assert.equal(askPt('Choose a opponent'), 'Escolhe um adversário.')
  assert.equal(askPt('Choose a value for X'), 'Escolhe o valor de X.'); assert.equal(askPt('Choose X for Walking Ballista'), 'Escolhe o valor de X para Walking Ballista.')
  assert.equal(askPt('Choose a card name'), 'Diz o nome de uma carta'); assert.equal(askPt('Choose a nonland card name.'), 'Diz o nome de uma carta que não seja terreno.')
  assert.equal(askPt('Choose a creature card name.'), 'Diz o nome de uma carta de criatura.')
  assert.equal(askPt('Tu activated Cryptic Command (12) - Choose a mode'), 'Escolhe um modo de Cryptic Command.'); assert.equal(askPt('Choose one'), 'Escolhe uma opção.')
  assert.equal(askPt('Choose 2 colors (click, then CTRL/CMD + click)'), 'Escolhe 2 cores.')
  assert.equal(askPt('Select target creature'), null); assert.equal(askPt('Choose a color\nmais'), null)
  assert.deepEqual(['White', 'Blue', 'black', 'Red', 'Green', 'Colorless'].map(optPt), ['Branco', 'Azul', 'Preto', 'Vermelho', 'Verde', 'Incolor'])
  assert.deepEqual(['Artifact', 'Creature', 'Sorcery', 'Instant', 'Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(optPt), ['Artefacto', 'Criatura', 'Feitiço', 'Instantâneo', 'Planície', 'Ilha', 'Pântano', 'Montanha', 'Floresta'])
  assert.deepEqual(['Yes', 'No', 'Play', 'Draw', 'Odds', 'Evens', 'heads'].map(optPt), ['Sim', 'Não', 'Jogar primeiro', 'Comprar (ir em segundo)', 'Ímpar', 'Par', 'Cara'])
  assert.equal(optPt('Goblin'), 'Goblin'); assert.equal(optPt('Grizzly Bears'), 'Grizzly Bears'); assert.equal(optSym('White'), 'W'); assert.equal(optSym('Elf'), '')
  // gatilhos de duas cópias da mesma carta: cada opção fica com a sua cópia (src do Forge; sem ele, pela ordem)
  const two = [{ id: 7, name: 'Setessan Champion' }, { id: 9, name: 'Setessan Champion' }, { id: 3, name: 'Verduran Enchantress' }]
  const lbl = 'Constellation — Whenever an enchantment you control enters, put a +1/+1 counter on Setessan Champion and draw a card.'
  assert.deepEqual(trigCards([{ label: lbl, src: 9 }, { label: lbl, src: 7 }], two, oracle).map(c => c?.id), [9, 7])
  assert.deepEqual(trigCards([{ label: lbl }, { label: lbl }], two, oracle).map(c => [c?.id, c?.copy]), [[undefined, 2], [undefined, 2]])
  assert.deepEqual(trigCards([{ label: lbl }, { label: 'Whenever you cast an enchantment spell, you may draw a card.' }], two, oracle).map(c => c?.id), [undefined, 3])
}
