// Tabuleiro (repetição e ao vivo), ao estilo de uma mesa digital: aplica os eventos do Forge ao modelo de estado
// (game.js) e anima só o que mudou em cada passo (a carta que entrou/virou/atacou/morreu, a vida que mudou).
// Controlos: pausa, velocidade, passo, salto de turno, linha do tempo com marcas por tipo de evento.
import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { img, artPick, artMapOf, basicSplit, sf } from './data.js'
import { tx, num, LANG } from './i18n.js'
import { tokenCard } from './tokens.js'
import { useColors, sideColors, Syms, keepOnScreen } from './ui.jsx'
import { playEvent, play } from './sfx.js'
import { attackStyle, attackFx } from './orbfx.js'
import { leaveGhost } from './tablekit.js'
import { fpPrefs, setFpPrefs, CARD_PX, MATS, ORB_T, ORB_A } from './fpprefs.js'
import { PHASES, replayStates, giantTurns, lookup, permCard, isCreature, isLand, powTough, ptExplain, typeOf, markDormant, markMoon, replayDmg, CT, CT_ICON } from './game.js'

const PH_LABEL = { untap: tx('Desvirar'), upkeep: tx('Manutenção'), draw: tx('fase§Compra'), main1: tx('Principal 1'), combat: tx('Combate'), main2: tx('Principal 2'), end: tx('fase§Final') }
const PH_SHORT = { untap: tx('Desvirar'), upkeep: tx('Manut.'), draw: tx('fase§Compra'), main1: tx('Princ. 1'), combat: tx('Combate'), main2: tx('Princ. 2'), end: tx('fase§Final') }
const KW = {
  Flying: ['➶', tx('Voar')], 'First strike': ['¹', tx('Iniciativa (first strike)')], 'Double strike': ['²', tx('Golpe duplo')],
  Deathtouch: ['☠', tx('Toque mortífero')], Lifelink: ['♥', tx('Vínculo com a vida')], Trample: ['⇶', tx('Atropelar')],
  Vigilance: ['◉', tx('Vigilância')], Haste: ['ϟ', tx('Ímpeto')], Hexproof: ['◈', tx('Resistência a magia')],
  Indestructible: ['✚', tx('Indestrutível')], Menace: ['‼', tx('Ameaçar')], Reach: ['↥', tx('Alcance')], Infect: ['☣', tx('Infetar')],
}
const CT_SHORT = { lore: tx('cap.'), charge: tx('carga'), stun: tx('atord.'), shield: tx('escudo'), time: tx('tempo'), defense: tx('defesa'), oil: tx('óleo') }
const PACE = { turn: 2, phase: 0.45, tap: 0.3, untap: 0.3, land: 0.9, cast: 1.2, resolve: 0.8, counter: 1, countered: 0.8, trigger: 0.7, activate: 0.8, attack: 0.9, block: 0.9, damage: 0.8, poison: 0.8, life: 0.6, token: 1, counters: 0.8, pump: 0.7, attach: 0.9, transform: 1.3, destroy: 1, exile: 1, bounce: 1, discard: 0.8, mulligan: 0.8, draw: 0.5, mill: 0.6, search: 0.6, player: 1, goad: 0.8, outcome: 2, other: 0.3 }
// cor da marca na linha do tempo
const MARK = { cast: 'm-cast', land: 'm-land', attack: 'm-atk', block: 'm-atk', damage: 'm-dmg', poison: 'm-dmg', destroy: 'm-die', exile: 'm-die', token: 'm-new', counters: 'm-new', transform: 'm-new', outcome: 'm-end' }
const QUIET = new Set(['other', 'phase'])
const FIZZLE = /^(.+?) (?:ability )?fizzles/  // o alvo saiu antes de resolver (ex.: sacrificado em resposta)
const quiet = e => QUIET.has(e.k) && !FIZZLE.test(e.txt || '')
const ZN = { hand: tx('mão'), library: tx('biblioteca'), graveyard: tx('cemitério'), exile: tx('exílio'), battlefield: tx('campo'), stack: tx('pilha'), command: tx('zona de comando'), none: tx('fora do jogo') }
const EST = tx('Estimativa: este jogo foi gravado antes de o Forge dar as zonas exatas, por isso a posição desta carta foi deduzida do registo.')
const short = n => String(n || '').split(' // ')[0]
// texto já traduzido com pedaços JSX: jsx(texto, { g: <b>2</b> }) põe os elementos no sítio dos {marcadores}
const jsx = (s, v) => s.split(/\{(\w+)\}/).map((p, j) => (j % 2 ? <Fragment key={j}>{v[p]}</Fragment> : p))
// lugar: «2nd» em inglês (a média, com casas decimais, fica só o número); nas outras línguas o padrão do dicionário («2.º»)
const ord = x => (LANG !== 'en' ? tx('{n}.º', { n: x }) : Number.isInteger(x) ? `${x}${['th', 'st', 'nd', 'rd'][x] || 'th'}` : String(x))
// scry/surveil: quantas cartas para cada sítio (top / graveyard / bottom…)
const toWhere = (n, w) => (w === 'top' ? tx('{n} para o topo', { n }) : w === 'graveyard' ? tx('{n} para o cemitério', { n }) : tx('{n} para o fundo', { n }))

// Frase legível para cada evento, na língua ativa (o texto original do Forge fica no título)
function describe(ev, who) {
  if (!ev) return ''
  const P = who[ev.p] || tx('Alguém'), c = short(ev.card), T = who[ev.target] || short(ev.target)
  switch (ev.k) {
    case 'turn': return tx('Turno {t} — {P}', { t: ev.t, P })
    case 'nodraw': return tx('{P} não compra no 1.º turno (Two-Headed Giant: a equipa que começa)', { P })
    case 'phase': return tx('Fase: {ph}', { ph: PH_LABEL[ev.ph] || ev.ph })
    case 'mulligan': return ev.card === 'kept' ? tx('{P} fica com {n} carta|{P} fica com {n} cartas', { P, n: ev.n }) : tx('{P} faz mulligan para {n}', { P, n: ev.n })
    case 'land': return `${tx('{P} joga o terreno {c}', { P, c })}${ev.tapped ? ` ${tx('(entra virado)')}` : ''}`
    case 'tap': return ev.txt?.includes('Add') ? tx('{c} vira para dar mana', { c }) : tx('{c} vira', { c })
    case 'untap': return tx('{c} desvira', { c })
    case 'cast': {  // custo alternativo (Force of Negation, Solitude…): a carta exilada/descartada da mão vem no zn
      const paid = (ev.zn || []).filter(z => z.from === 'hand' && z.card !== ev.card && (z.to === 'exile' || z.to === 'graveyard')).map(z => short(z.card))
      const x = paid.join(', ')
      const how = paid.length ? ` (${ev.zn.find(z => z.from === 'hand' && z.card !== ev.card).to === 'exile' ? tx('paga exilando {x}', { x }) : tx('paga descartando {x}', { x })})` : ''
      return `${tx('{P} lança {c}', { P, c })}${T ? ` → ${T.length > 40 ? tx('um feitiço na pilha') : T}` : ''}${how}`
    }  // jogos antigos: alvo descrito pelo texto
    case 'trigger': return c ? tx('Habilidade desencadeada: {c}', { c }) : tx('Habilidade desencadeada')
    case 'activate': return `${tx('{P} ativa {c}', { P, c })}${T ? ` → ${T}` : ''}`
    case 'resolve': return c ? `${tx('{c} resolve', { c })}${ev.pt ? ` (${ev.pt})` : ''}` : tx('A habilidade resolve')
    case 'counter': return tx('{c} anula um feitiço', { c })
    case 'countered': return ev.to === 'exile' ? tx('Feitiço anulado (vai para o exílio)') : tx('Feitiço anulado (vai para o cemitério)')
    case 'attack': return tx('{c} ataca {T}', { c, T: T || '' })
    case 'block': return tx('{c} bloqueia {T}', { c, T })
    case 'damage': return `${tx('{c}: {n} de dano a {T}', { c: c || tx('Dano'), n: ev.n, T })}${ev.psn ? ` ${tx('(veneno)')}` : ''}${ev.dt ? ` ${tx('(toque mortífero)')}` : ''}`
    case 'poison': return tx('{T} recebe {n} marcador de veneno|{T} recebe {n} marcadores de veneno', { T, n: ev.n })
    case 'life': return ev.n >= 1e6 ? tx('{P}: vida infinita (ciclo repetido de uma vez)', { P }) : tx('{P}: vida {n}', { P, n: ev.n })
    case 'destroy': return ev.target === 'battlefield>graveyard' ? tx('{c} vai para o cemitério', { c }) : tx('{c} sai do campo', { c })
    case 'exile': return ev.target === 'library>exile' ? tx('{c}: da biblioteca para o exílio', { c }) : tx('{c} é exilada', { c })  // moer com Dauthi Voidwalker, Tasha's Hideous Laughter…
    case 'bounce': return tx('{c} volta para a mão', { c })
    case 'discard': return tx('{P} descarta {c}', { P, c })
    case 'token': {
      const name = `${short(ev.card).replace(/ Token$/, '')}${ev.pt ? ` ${ev.pt}` : ''}`
      return ev.n == null ? tx('{P} cria fichas {name}', { P, name }) : tx('{P} cria uma ficha {name}|{P} cria {n} fichas {name}', { P, n: ev.n, name })
    }
    case 'counters': return tx('{c}: {s}{n} marcador {ct}|{c}: {s}{n} marcadores {ct}', { c, s: ev.n > 0 ? '+' : '−', n: Math.abs(ev.n), ct: CT[ev.ct] || ev.ct })
    case 'pump': return ev.all ? tx('As criaturas de {P} recebem {pt} até ao fim do turno', { P, pt: ev.pt }) : tx('{c} recebe {pt} até ao fim do turno', { c, pt: ev.pt })
    case 'attach': return tx('{c} fica anexada a {T}', { c, T })
    case 'transform': return tx('{c} transforma-se em {to}', { c, to: ev.to })
    case 'goad': return tx('{c} fica incitada', { c })
    case 'draw': return ev.card && ev.p === 'a' ? tx('{P} compra {c}', { P, c }) : tx('{P} compra {n} carta|{P} compra {n} cartas', { P, n: ev.n || 1 })
    case 'mill': return ev.card ? tx('{P}: {c} da biblioteca para o cemitério', { P, c }) : tx('{P}: {n} carta da biblioteca para o cemitério|{P}: {n} cartas da biblioteca para o cemitério', { P, n: ev.n || 1 })
    case 'search': return ev.to === 'battlefield' ? tx('{P} procura na biblioteca (para o campo)', { P }) : ev.to === 'hand' ? tx('{P} procura na biblioteca (para a mão)', { P }) : tx('{P} procura na biblioteca (para o cemitério)', { P })
    case 'player': return ev.to === 'monarch' ? tx('{P} torna-se o monarca', { P }) : ev.to === 'initiative' ? tx('{P} toma a iniciativa', { P }) : ev.to === 'emblem' ? tx('{P} recebe um emblema', { P }) : tx('{P} recebe {n} de energia', { P, n: ev.n || 1 })
    case 'outcome': return / has won/.test(ev.txt || '') ? tx('{P} ganha o jogo', { P }) : / has conceded/.test(ev.txt || '') ? tx('{P} desiste', { P }) : tx('{P} perde o jogo', { P })
    default: {
      if (ev.x && ev.target) {  // mudança de zona exata sem frase própria (zone/other)
        const [fr, to] = ev.target.split('>')
        const hidden = ev.p !== 'a' && [fr, to].every(z => z === 'hand' || z === 'library')  // a mão dos adversários não se mostra
        return `${hidden ? tx('Uma carta') : c}: ${ZN[fr] || fr} → ${ZN[to] || to}`
      }
      // linhas informativas do Forge (em inglês): traduz as mais comuns
      const t = ev.txt || ''
      const loop = t.match(/^(.+?) repeats the (.+) loop: infinite life/)
      if (loop) return tx('{P} repete o ciclo de {c} de uma vez: vida infinita', { P, c: loop[2] })
      if (FIZZLE.test(t)) return tx('{c} fica sem efeito: o alvo já não está lá', { c: c || t.match(FIZZLE)[1] })
      let m = t.match(/^.+? (scried|surveiled) (\d+) card\(s\) to the (top|bottom) of the library(?: and (\d+) card\(s\) to the (bottom of the library|graveyard))?/)
      if (m) return `${P}: ${m[1] === 'scried' ? tx('vidência') : tx('vigiar')} — ${toWhere(m[2], m[3])}${m[4] ? `, ${toWhere(m[4], m[5])}` : ''}`
      m = t.match(/^.+? (scried|surveiled) (\d+) card\(s\) to the (bottom of the library|graveyard)/)
      if (m) return `${P}: ${m[1] === 'scried' ? tx('vidência') : tx('vigiar')} — ${toWhere(m[2], m[3])}`
      m = t.match(/^(.+?) enters tapped\.$/)
      if (m) return tx('{c} entra virado', { c: short(m[1]) })
      m = t.match(/^As (.+?) enters, you may pay (\d+) life\. If you don't, it enters tapped\.$/)
      if (m) return tx('{c}: pagar {n} de vida ou entrar virado', { c: short(m[1]), n: m[2] })
      return tx(t)  // as notas do servidor (Forte desligado…) vêm em pt e traduzem-se; o resto é do Forge, em inglês
    }
  }
}

// animação de entrada decidida no momento em que o elemento aparece (não volta a correr quando a velocidade muda)
function In({ as, quiet, className = '', ...p }) {
  const [a] = useState(() => !quiet)
  const Tag = as || 'div'
  return <Tag className={`${className}${a ? ' in' : ''}`} {...p} />
}

// arte própria dos decks (ex.: alteradas no TappedOut): arts = {a: {nome: link}, b: …}; k = lado (o Side diz qual);
// sem lado, a de qualquer deck que a tenha. Sem arte própria, a da Scryfall.
export const Arts = createContext({ arts: null, k: null })
export const artOf = (arts, k, c, inst) => c && artPick((arts && (k ? arts[k]?.[c.n] : Object.values(arts).map(x => x?.[c.n]).find(Boolean))) || basicSplit(c.n), inst)  // sem arte do deck: as várias artes por omissão dos básicos
export const useImg = () => { const { arts, k } = useContext(Arts); return (c, size, back, side = k, inst) => img(c, size, back, artOf(arts, side, c, inst)) }
// srcset: a pequena (146 px) só quando a carta é mesmo pequena no ecrã, a normal (488 px) quando é grande, em monitores
// 2K ou com mais densidade (Windows a 125–150%). A pequena declara-se com 100w (e não 146w) para a troca acontecer cedo:
// a JPEG pequena da Scryfall já vem muito comprimida e nota-se mesmo reduzida. Cada imagem vem uma vez (cache).
const useImgSet = () => { const { arts, k } = useContext(Arts); return (c, back, side = k, inst) => { const pid = artOf(arts, side, c, inst), s = img(c, 'small', back, pid), n = img(c, 'normal', back, pid); return s === n ? undefined : `${s} 100w, ${n} 488w` } }

// ---------- a pilha (stack): flutua por cima do centro da mesa, fora da barra dos turnos ----------
// cada carta cai com o seu ângulo (do uid, sempre o mesmo), as de baixo abanam quando chega outra; a do topo diz o que
// vai fazer (texto da carta: o gatilho «When/Whenever/At…», a habilidade com custo ou o feitiço) e, ao resolver, brilha
// e sai na direção do alvo com o efeito que o Forge aplicou
const tilt = uid => ((uid * 37) % 13) - 6
const clean = t => String(t || '').replace(/\s*\(\d+\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
function effectOf(c, kind) {
  if (!c) return ''
  const lines = c.o.split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(Boolean)
  const pick = kind === 'trigger' ? lines.find(l => /^(When|Whenever|At)\b/.test(l) || /\b(When|Whenever)\b/.test(l))
    : kind === 'activate' ? lines.find(l => /^[^"]{1,60}:/.test(l) && !/\bAdd (?:\{|one|two|three|X|\w+ mana)/.test(l)) || lines.find(l => l.includes(':')) : null
  const t = pick || lines.join(' ')
  return t.length > 220 ? `${t.slice(0, 217)}…` : t
}
const KIND_L = { cast: tx('Feitiço'), trigger: tx('Gatilho'), activate: tx('Habilidade') }
// frases-chave do efeito a negrito e com cor (dano, vida, comprar/procurar, remover, fichas, cemitério/mão)
const KEYS = [
  ['dmg', /deals? (?:\d+|X|that much|twice that much|damage equal to [^.,;]+?)(?: damage)?|\d+ damage|loses? (?:\d+|X|that much|half (?:their|your) life) life|lose (?:\d+|X) life/gi],
  ['life', /gains? (?:\d+|X|that much) life|\+1\/\+1 counters?|\+\d+\/\+\d+|\+X\/\+X/gi],
  ['draw', /draws? (?:a|an|one|two|three|four|X|\d+|that many) cards?|search(?:es)? (?:your|their|his or her|target player's) library|scry \d+|surveil \d+|look at the top (?:\w+ )?cards?/gi],
  ['kill', /destroy(?:s)? (?:target|all|each|it|that|up to)[^.,;]*?(?:creature|permanent|artifact|enchantment|planeswalker|land)s?|exiles? (?:target|all|each|it|that|up to)[^.,;]*?(?:creature|permanent|card|artifact|enchantment|spell|planeswalker)s?|counter target (?:\w+ )?spell|sacrifices? (?:a|an|another|target|all|each|\w+)[^.,;]*?(?:creature|permanent|artifact|land)s?|return(?:s)? (?:target|all|each|it|that)[^.,;]*? to (?:its|their) owners?'?s? hands?/gi],
  ['token', /creates? (?:a|an|one|two|three|four|X|\d+|that many)[^.,;]*?tokens?/gi],
  // palavras-chave do Magic (habilidades e ações), por último: as frases acima ganham quando se sobrepõem
  ['kw', /\b(?:flying|trample|deathtouch|lifelink|haste|vigilance|first strike|double strike|reach|hexproof|shroud|indestructible|flash|menace|defender|ward(?: \{[^}]+\}| \d+)?|protection from [a-z]+|cycling|landcycling|flashback|kicker|multikicker|prowess|convoke|cascade|delve|crew \d+|equip(?: \{[^}]+\})?|enchant [a-z]+|persist|undying|storm|affinity for [a-z]+|dredge \d+|madness|morph|megamorph|evoke|infect|toxic \d+|wither|proliferate|transform(?:s|ed)?|explore(?:s)?|adapt \d+|ninjutsu|landfall|treasure|food|clue|monarch|initiative|mutate|foretell|disturb|training|connive(?:s)?|blitz|casualty \d+|bargain|craft|discover \d+|offspring|gift|fight(?:s)?|investigate|amass \w+ \d+|venture into the dungeon|ascend|surveil|scry|bushido \d+|exalted|annihilator \d+|rampage \d+|flanking|horsemanship|shadow|fear|intimidate|skulk|outlast|bolster \d+|support \d+|renown \d+|exploit|embalm|eternalize|escape|mentor|riot|spectacle|afterlife \d+|jump-start|surge|emerge|devour \d+|evolve|extort|unearth|encore|boast|ward|backup \d+|prototype|reconfigure|channel|ninjutsu|split second|suspend \d+|vanishing \d+|fading \d+|echo|cumulative upkeep|buyback|retrace|rebound|miracle|overload|bestow|dash|fabricate \d+|partner|companion|cleave|daybound|nightbound|decayed|plot|saddle \d+|spree|valiant|collect evidence \d+|disguise|cloak|manifest(?: dread)?)\b/gi],
  ['grave', /discards? (?:a|an|one|two|X|\d+|that|their hand)[^.,;]*?(?:card|hand)s?|mills? (?:a|an|one|two|three|four|five|X|\d+) cards?|return[^.,;]*? from (?:your|their|a) graveyard[^.,;]*/gi],
]
// o texto da pilha que vem do motor: «Birds of Paradise (123) - Birds of Paradise deals 1 damage…» → só o efeito
function stkText(t, name) {
  let x = String(t || '').trim()
  if (name && x.startsWith(name)) x = x.slice(name.length).replace(/^\s*(\(\d+\))?\s*-?\s*/, '')
  // sem o texto de lembrete «(When this creature attacks…)» nem as notas do Forge «[Attacker: Voice of Victory {115}]»
  x = x.replace(/\s*\[[^\]]*\]/g, '')
  const rem = x.match(/\((?!\s*[TQWUBRGCX0-9]\))([^()]{12,})\)/)?.[1]  // o lembrete: fica quando sobra só a palavra-chave («Mobilize 2»)
  x = x.replace(/\s*\((?!\s*[TQWUBRGCX0-9]\))[^()]*\)/g, '').replace(/\s{2,}/g, ' ').trim()
  if (rem && x.length < 30) x = `${x} — ${rem.trim()}`
  return x.length > 220 ? `${x.slice(0, 217)}…` : x
}
function hiText(t) {  // texto → pedaços com <b class> nas frases-chave (a primeira que apanha ganha)
  const hits = []
  for (const [k, re] of KEYS) for (const m of t.matchAll(re)) if (!hits.some(h => m.index < h.e && m.index + m[0].length > h.s)) hits.push({ s: m.index, e: m.index + m[0].length, k })
  hits.sort((a, b) => a.s - b.s)
  const out = []
  let i = 0
  const sy = (x, k) => <Syms key={`s${k}`} text={x.replace(/\((T|Q|[WUBRGC]|\d+|X)\)/g, '{$1}')} />  // o Forge às vezes escreve (T)
  hits.forEach((h, j) => { if (h.s > i) out.push(sy(t.slice(i, h.s), j)); out.push(<b key={j} className={`fx-${h.k}`}>{sy(t.slice(h.s, h.e), `b${j}`)}</b>); i = h.e })
  if (i < t.length) out.push(sy(t.slice(i), 'z'))
  return out
}
export function StackFx({ s, rev, ri, data, arts, quiet, who, speed }) {
  const [ghost, setGhost] = useState(null), [more, setMore] = useState([]), [nudge, setNudge] = useState(false), n = s.stack.length, prevN = useRef(n), gT = useRef(null)
  // resolver: a carta brilha e a legenda mostra o efeito real o tempo de o ler (pelo tamanho do texto e pela velocidade
  // escolhida); o temporizador é só dele, por isso o evento seguinte já não o cancela (a legenda ficava lá para sempre)
  useEffect(() => {
    if (quiet || rev?.k !== 'resolve' || !rev.card) return
    const named = String(rev.txt || '').replace(/^.*? - /, '').replace(/Ai\(\d+\)-([A-D])\b/g, (m, k) => short(who[k.toLowerCase()]) || m)  // «Ai(2)-B» → nome do deck
    const txt = clean(named), ms = Math.round(Math.min(7000, 1400 + txt.length * 28) / Math.max(0.5, speed || 1))
    setGhost({ key: ri, card: rev.card, p: rev.p, txt, ms })
    setMore((rev.more || []).map((x, k) => ({ ...x, key: `${ri}-${k}`, ms: Math.min(ms, 1800) })))  // as outras que saíram ao mesmo tempo
    clearTimeout(gT.current)
    gT.current = setTimeout(() => { setGhost(null); setMore([]) }, ms)
    const cd = lookup(data, rev.card)
    if (cd && !/\b(Instant|Sorcery)\b/.test(cd.t)) setTimeout(() => stackToField(rev.card), 380)
  }, [ri]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (quiet) { clearTimeout(gT.current); setGhost(null); setMore([]) } }, [quiet])
  useEffect(() => () => clearTimeout(gT.current), [])
  useEffect(() => {  // chega uma carta nova: as de baixo abanam
    if (n > prevN.current && n > 1 && !quiet) { setNudge(true); const t = setTimeout(() => setNudge(false), 380); prevN.current = n; return () => clearTimeout(t) }
    prevN.current = n
  }, [n, quiet])
  const top = s.stack[n - 1], tc = top && lookup(data, top.card)
  if (!n && !ghost) return null
  const pic = (card, p, kind) => { const c = lookup(data, card); return c ? <img src={img(c, kind === 'cast' || !kind ? 'normal' : 'art_crop', false, artOf(arts, p, c))} alt={card} draggable="false" /> : <span>{short(card) || tx('habilidade')}</span> }
  const tgt = top?.target && (who[top.target] || short(top.target))
  return (
    <div className={`stackfx ${nudge ? 'nudge' : ''}`} aria-live="polite">
      {/* a carta a resolver também conta para a largura (senão ficava por cima da legenda); com muitas, o leque aperta */}
      <div className="stk-pile" style={{ '--n': n + (ghost ? 1 : 0), '--sg': `${n + (ghost ? 1 : 0) > 4 ? Math.max(10, Math.round(104 / (n + (ghost ? 1 : 0) - 1))) : 26}px` }}>
        {s.stack.map((x, j) => (
          <In key={x.uid} quiet={quiet} className={`stk ${x.p || ''} ${x.kind} ${j === n - 1 ? 'top' : ''}`} style={{ '--j': j, '--r': `${tilt(x.uid)}deg` }} data-z={x.card ? `n:${x.card}` : undefined} data-si={j}>
            {pic(x.card, x.p, x.kind)}
          </In>
        ))}
        {more.map((x, k) => <div key={`m${x.key}`} className={`stk resolving ${x.p || ''}`} style={{ '--j': n + k, '--d': `${x.ms}ms` }}>{pic(x.card, x.p)}</div>)}
        {ghost && <div key={`g${ghost.key}`} className={`stk resolving ${ghost.p || ''}`} style={{ '--j': n + more.length, '--d': `${ghost.ms}ms` }}>{pic(ghost.card, ghost.p)}</div>}
      {(top || ghost) && (
        <div key={top ? `t${top.uid}` : `g${ghost.key}`} className={`stk-cap ${(top || ghost).p || ''} ${top ? '' : 'res'}`} style={{ '--spell': spellCol(lookup(data, (top || ghost).card)) }}>
          {top ? <>
            <small>{KIND_L[top.kind] || top.kind}{n > 1 ? ` · ${tx('{n} na pilha', { n })}` : ''}</small>
            <b>{short(top.card) || tx('habilidade')}{tgt ? <span className="muted"> → {tgt}</span> : null}</b>
            {(top.text || tc) && <p>{hiText(top.text ? stkText(top.text, top.card) : effectOf(tc, top.kind))}</p>}
          </> : <>
            <small>{tx('A resolver')}</small>
            <b>{short(ghost.card)}</b>
            {ghost.txt && <p>{hiText(ghost.txt)}</p>}
          </>}
        </div>
      )}
      </div>
    </div>
  )
}

// ---------- uma carta no campo ----------
const kwsOf = (c, p) => [...new Set([...(c?.kw || []), ...(p.kw || [])])].filter(k => KW[k])

function Face({ p, c, back, size = 'small' }) {
  const im = useImg(), set = useImgSet()
  if (p.hidden) return <div className="pc-back" />
  if (!c && p.token) c = tokenCard(p.name, p.pt, p.src)
  if (c) return <img src={im(c, size, back && !!c.df, undefined, p.key)} srcSet={size === 'small' ? set(c, back && !!c.df, undefined, p.key) : undefined} sizes="(max-width: 900px) 60px, 7.4vw" alt={short(p.face || p.name)} loading="lazy" draggable="false" />
  return (
    <div className="pc-token">
      <small>{p.token ? tx('FICHA') : ''}</small>
      <b>{short(p.name).replace(/ Token$/, '')}</b>
      {p.pt && <i>{p.pt}</i>}
    </div>
  )
}

// cartas já mostradas na mesa (Side marca-as depois de desenhar): uma carta que volta a montar só porque mudou de monte
// (×N) ou de fila não «entra» outra vez (sem isto piscava a cada estado novo); as que chegam mesmo à mesa animam a entrada
const seenAt = new Map()
// a outra face à vista: virada (transformar, carta flip) ou uma MDFC jogada pela face de trás (o nome é o da 2.ª face)
const backUp = (c, p) => !!(p.flipped || (c?.df && p.name && c.n.split(' // ')[1]?.toLowerCase() === String(p.name).toLowerCase()))
// a conta do P/R (rato por cima ou toque no número): impresso + marcadores + outros efeitos = total
function PtExplain({ p, data, at }) {  // at: onde está o número (no ecrã): a conta fica por cima de tudo (até da carta em grande)
  const x = ptExplain(data, p)
  if (!x) return null
  const f = ([a, b]) => `${a >= 0 ? '+' : ''}${a}/${b >= 0 ? '+' : ''}${b}`
  return createPortal(
    <span ref={keepOnScreen} className="pt-ex" role="tooltip" style={{ left: at.left + at.width / 2, top: at.top }}>
      {x.printed && <span>{tx('Impresso')} <b>{x.printed.join('/')}</b></span>}
      {x.plus > 0 && <span className="up">{tx('Marcadores +1/+1 ×{n}', { n: x.plus })} <b>{f([x.plus, x.plus])}</b></span>}
      {x.minus > 0 && <span className="down">{tx('Marcadores −1/−1 ×{n}', { n: x.minus })} <b>{f([-x.minus, -x.minus])}</b></span>}
      {x.other && (x.other[0] || x.other[1]) ? <span className={x.other[0] + x.other[1] >= 0 ? 'up' : 'down'}>{tx('Outros efeitos (auras, anthems, até ao fim do turno)')} <b>{f(x.other)}</b></span> : null}
      <span className="tot">{tx('Total')} <b>{x.total.join('/')}</b></span>
    </span>, document.fullscreenElement || document.body)
}

export const Perm = memo(function Perm({ p, data, hl, pop, att, n, quiet, tgt }) {  // tgt: [lado, nome] do jogador atacado (3+ jogadores)
  const [ex, setEx] = useState(null)  // a conta do P/R aberta: o retângulo do número
  const [enter] = useState(() => !quiet && !(Date.now() - (seenAt.get(p.key) || 0) < 600000))
  const c = permCard(data, p)
  const creature = isCreature(data, p)
  const pt = creature ? powTough(data, p) : null
  const kws = kwsOf(c, p)
  const back = backUp(c, p), upside = back && !c?.df && !p.hidden  // carta flip (Kamigawa): a mesma imagem, rodada 180°
  const ctr = Object.entries(p.counters || {}).filter(([k]) => k !== 'loyalty' && k !== 'defense')
  // palavras-chave em ação: pressa a atacar (rasto de velocidade), alcance a bloquear (ramos), indestrutível ferida
  // (escudo dourado), toque mortal no combate (aura negra-esverdeada), exaltar quando uma criatura ataca sozinha (.bside.lone-atk)
  const akw = new Set([...(c?.kw || []), ...(p.kw || [])])
  const kfx = creature && [akw.has('Haste') && p.attacking && 'kw-haste', akw.has('Reach') && p.blocking && 'kw-reach', akw.has('Indestructible') && p.dmgIn > 0 && 'kw-indes',
    akw.has('Deathtouch') && (p.attacking || p.blocking) && 'kw-dt', akw.has('Exalted') && 'kw-exalted'].filter(Boolean).join(' ')
  const cls = ['pc', kfx, p.dmgIn > 0 && 'hurt', p.tapped && 'tapped', p.attacking && 'atk', p.blocking && 'blk', p.dying && 'dying', typeof p.dying === 'string' && `to-${p.dying}`, p.token && 'tok', hl && `hl${hl}`, p.sick && 'sick', creature && 'cre', p.dormant && 'dormant', p.phased && 'phased', p.faceDown && 'down', enter && 'in'].filter(Boolean).join(' ')
  const title = [short(p.face || p.name), p.faceDown && tx('virada para baixo'), p.phased && tx('fora de fase (phasing): não conta como estando em jogo'), p.copy && tx('cópia'), p.merged?.length > 1 && tx('mutada: {x}', { x: p.merged.map(short).join(' + ') }), p.dormant && tx('não é criatura: devoção {d} de {n}', { d: p.dormant.d, n: p.dormant.need }), p.moon && tx('Blood Moon: é uma Montanha e só dá mana vermelha'), p.sick && tx('enjoo de invocação'), p.tapped && tx('virada')].filter(Boolean).join(' · ')
  tgt = tgt || (p.atkName ? ['x', short(p.atkName)] : null)  // ataca um planeswalker ou uma batalha
  return (
    <div className={cls} data-z={`k:${p.key}`} title={title} style={p.pair ? { '--pair': PAIR[(p.pair - 1) % PAIR.length] } : undefined}>
      {kfx && <i className="pc-kfx" aria-hidden="true" />}
      {p.dmgOut > 0 && <span className="pc-dmgout" title={tx('Dano que fez neste combate: {n}', { n: p.dmgOut })}>⚔ {p.dmgOut}{p.trample > 0 && <em title={tx('Passou {n} com atropelar', { n: p.trample })}> ↠{p.trample}</em>}</span>}
      {p.dmgIn > 0 && <span className="pc-dmgin" title={tx('Dano que levou neste combate: {n}', { n: p.dmgIn })}>✕ {p.dmgIn}</span>}
      {p.pair && <span className="pc-pair" title={p.attacking ? tx('Atacante {n}: bloqueado pelos que têm 🛡 {n}', { n: p.pair }) : tx('Bloqueia o atacante ⚔ {n}', { n: p.pair })}>{p.attacking ? '⚔' : '🛡'} {p.pair}</span>}
      {p.moon && <span className="pc-dev" aria-hidden="true">⛰<img src={sf('https://svgs.scryfall.io/card-symbols/R.svg')} alt="" /></span>}
      {p.dormant && <span className="pc-dev" aria-hidden="true">{p.dormant.cols.map(k => <img key={k} src={sf(`https://svgs.scryfall.io/card-symbols/${k}.svg`)} alt="" />)}{p.dormant.d}/{p.dormant.need}</span>}
      {att?.length > 0 && <div className="pc-att">{att.map(a => <div key={a.key} className="pc-attc" data-z={`k:${a.key}`}><Face p={a} c={lookup(data, a.name)} /></div>)}</div>}
      <div className="pc-rot">
        <div className={`pc-flip ${back && c?.df ? 'on' : ''} ${upside ? 'up' : ''}`}>
          <div className="pc-f">{p.faceDown && !p.hidden ? <div className="pc-back pc-known" /> : <Face p={p} c={c} />}</div>
          {c?.df ? <div className="pc-b"><Face p={p} c={c} back /></div> : null}
        </div>
      </div>
      <div className="pc-ov">
        {p.damage > 0 && <b className="pc-dmg" title={tx('Dano marcado até ao fim do turno')}>{p.damage}</b>}
        {pt && <b className={`pc-pt ${pt.boosted ? 'up' : ''} ${pt.hurt ? 'down' : ''}`} onMouseEnter={e => setEx(e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setEx(null)}
          onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setEx(x => (x ? null : r)) }}>{pt.p}/{pt.t}</b>}
        {ex && pt && <PtExplain p={p} data={data} at={ex} />}
        {p.counters?.loyalty != null && <b key={`l${p.counters.loyalty}`} className={`pc-loy ${pop?.ct === 'loyalty' && !quiet ? (pop.n > 0 ? 'up' : 'down') : ''}`} title={tx('Lealdade')}>{p.counters.loyalty}</b>}
        {p.counters?.defense != null && <b key={`d${p.counters.defense}`} className={`pc-loy def ${pop?.ct === 'defense' && !quiet ? 'down' : ''}`} title={tx('Defesa (batalha)')}>⛨{p.counters.defense}</b>}
        {ctr.length > 0 && <span className="pc-ctr">{ctr.map(([k, v]) => <b key={`${k}${v}`} className={`c-${k === '+1/+1' ? 'p1' : k === '-1/-1' ? 'm1' : k}`} title={tx('{n} marcador {ct}|{n} marcadores {ct}', { n: v, ct: CT[k] || k })}>{k === '+1/+1' ? `+${v}` : k === '-1/-1' ? `−${v}` : CT_ICON[k] ? `${CT_ICON[k]}${v}` : `${CT_SHORT[k] || (CT[k] || k).slice(0, 5)} ${v}`}</b>)}</span>}
        {(p.copy || p.merged?.length > 1 || (p.faceDown && !p.hidden)) && <span className="pc-tags">{p.faceDown && !p.hidden && <i title={tx('Virada para baixo: só tu sabes qual é')}>👁</i>}{p.copy && <i title={tx('Cópia')}>⎘</i>}{p.merged?.length > 1 && <i title={tx('mutada: {x}', { x: p.merged.map(short).join(' + ') })}>⧉{p.merged.length}</i>}</span>}
        {kws.length > 0 && <span className="pc-kw">{kws.map(k => <i key={k} data-kw={k} aria-label={KW[k][1]}>{KW[k][0]}</i>)}</span>}
        {p.sick && <i className="pc-zz" title={tx('Enjoo de invocação: entrou neste turno')}>z<sup>z</sup></i>}
        {p.goaded && <i className="pc-goad" title={tx('Incitada')}>⚑</i>}
        {n > 1 && <b className="pc-n">×{n}</b>}
        {tgt && <i className={`pc-tgt t-${tgt[0]}`} title={tx('Ataca {x}', { x: tgt[1] })}>⚔ {tgt[1]}</i>}
        {p.prot && <i className="pc-prot" title={tx('Batalha protegida por {x}', { x: p.prot })}>🛡 {short(p.prot)}</i>}
        {(p.est || p.hidden) && <i className="pc-est" title={p.hidden ? tx('Estimativa: terreno procurado na biblioteca; o registo deste jogo (antigo) não diz qual.') : EST}>≈</i>}
      </div>
      {pop && !quiet && <i key={pop.i} className={`pc-pop ${pop.kind} ${pop.ct === 'loyalty' ? 'loyalty' : ''} ${pop.n < 0 ? 'neg' : ''} ${pop.ct === '-1/-1' || pop.ct === 'poison' ? 'ct-m1' : ''}`}>{pop.kind === 'flip' ? '⟲' : pop.kind === 'enter' || pop.kind === 'attach' ? pop.txt : pop.kind === 'pump' ? pop.pt : `${pop.n > 0 ? '+' : '−'}${Math.abs(pop.n)}${pop.ct && pop.ct !== '+1/+1' && pop.ct !== 'loyalty' ? ` ${CT_ICON[pop.ct] || CT[pop.ct] || pop.ct}` : ''}`}</i>}
    </div>
  )
})

// o padrão do tapete (o meu, guardado nas preferências da mesa) e se vejo os dos outros; onMat avisa a mesa (online: os outros veem-no)
const MAT_NAME = { pontos: tx('Pontos'), riscas: tx('Riscas'), xadrez: tx('Xadrez'), grelha: tx('Grelha'), linho: tx('Linho'), escamas: tx('Escamas'), arcano: tx('Arcano'), oceano: tx('Oceano'), brasas: tx('Brasas'), floresta: tx('Floresta') }
export function MatPick({ onMat, others = true }) {
  const [p, setP] = useState(() => fpPrefs())
  const save = v => { setFpPrefs(v); setP(fpPrefs()); onMat?.(fpPrefs()) }
  return (
    <div className="matpick">
      <div className="matpick-row" role="radiogroup" aria-label={tx('Padrão da mesa')}>
        {[null, ...MATS].map(m => <button key={m || '-'} type="button" role="radio" aria-checked={p.mat === m} className={`matsw ${p.mat === m ? 'on' : ''}`} data-mat={m || undefined}
          title={m ? MAT_NAME[m] : tx('Sem padrão')} onClick={() => save({ mat: m })}>{m ? '' : '∅'}</button>)}
      </div>
      {others && <label className="chk small"><input type="checkbox" checked={p.mats} onChange={e => save({ mats: e.target.checked })} /> {tx('Ver o padrão de cada jogador (desligado: vês o teu em todos os lados)')}</label>}
      <b className="small">{tx('Esfera da vida')}</b>
      <OrbPick onChange={onMat} />
    </div>
  )
}

// tamanho das cartas na mesa em píxeis (0 = automático), guardado nas preferências da mesa (fpprefs: o mesmo nas
// réplicas, no Forge Play e na mesa livre)
// réplicas (Coliseu): o tamanho escolhido é o MÍNIMO — o tabuleiro continua a encher a altura do ecrã (--fit, −/⤢/+), mas
// nenhuma carta fica mais pequena do que isto (se não cabe, a página desliza). As fórmulas são as do Coliseu em index.css
const minCardVars = px => { const m = k => `calc(${Math.round(px * k)}px * var(--pxf, 1))`  // --pxf: o encaixe no ecrã (Replay.fit)
  return { '--px': `${px}px`, '--cw': `max(${m(1)}, calc(min(220px, 7.4vw) * var(--fit, .8)))`,
  '--ow': `max(${m(1)}, calc(min(170px, 5.8vw) * var(--fit, .8)))`, '--lw': `max(${m(1)}, calc(min(170px, 5.8vw) * var(--fit, .8)))`,
  '--hw': `max(${m(1)}, calc(min(180px, 6.2vw) * var(--fit, .8)))`, '--ohw': `max(${m(0.8)}, calc(min(120px, 4.4vw) * var(--fit, .8)))` } }  // as mãos também (as dos outros a 80%)
export function CardPx({ onChange, className = '', min = false }) {  // min: nas réplicas o tamanho é um mínimo
  const [v, setV] = useState(() => fpPrefs().cardPx)
  return (
    <select className={`cardpx ${className}`} value={v} title={tx('Tamanho das cartas na mesa')} aria-label={tx('Tamanho das cartas na mesa')}
      onChange={e => { const n = +e.target.value; setV(n); setFpPrefs({ cardPx: n }); onChange?.(n) }}>
      {CARD_PX.map(n => <option key={n} value={n}>{n ? (min ? tx('Cartas: mín. {n} px', { n }) : tx('Cartas: {n} px', { n })) : tx('Cartas: automático')}</option>)}
    </select>
  )
}

// fichas e terrenos iguais ficam empilhados (×N); o resto um a um. Com a fila cheia (mais de CROWD cartas) empilham-se
// todas as cartas iguais no mesmo estado (virada, marcadores, dano); só as que atacam ou bloqueiam ficam sempre à parte.
// Uma pilha mostra no máximo 4 cartas sobrepostas; o «×N» diz quantas são.
const CROWD = 8
function groups(perms, groupable) {
  const out = [], by = new Map(), crowd = perms.length > CROWD
  for (const p of perms) {
    const simple = groupable(p) && !p.attacking && !p.blocking && !p.damage && !p.pump && !Object.keys(p.counters || {}).length && !p.hidden
    const packed = crowd && !p.attacking && !p.blocking && !p.hidden
    const k = simple ? `${p.name}|${p.flipped ? 1 : 0}`
      : packed ? `${p.name}|${p.flipped ? 1 : 0}|${p.tapped ? 1 : 0}|${p.damage || 0}|${p.pump || ''}|${JSON.stringify(p.counters || {})}` : p.key
    if (by.has(k)) by.get(k).items.push(p)
    else { const g = { key: p.key, items: [p] }; by.set(k, g); out.push(g) }
  }
  return out
}

function Row({ perms, data, fx, att, cls, groupable, empty, quiet, who }) {  // who: nomes por lado, só com 3+ jogadores
  const gs = groups(perms, groupable)
  return (
    <div className={`brow ${cls}`}>
      {gs.map(g => (
        <div key={g.key} className={`grp ${g.items.length > 1 ? 'many' : ''}`}>
          {g.items.slice(-4).map((p, j, vis) => <Perm key={p.key} p={p} data={data} hl={fx.hl.has(p.key) ? fx.par : 0} pop={fx.pops.get(p.key) || null} att={att.get(p.key)} n={j === vis.length - 1 ? g.items.length : 0} quiet={quiet} tgt={who?.[p.attacking] ? [p.attacking, short(who[p.attacking])] : null} />)}
        </div>
      ))}
      {!gs.length && empty && <span className="brow-empty">{empty}</span>}
    </div>
  )
}

// ---------- vida (o número conta até ao valor novo; o anel pisca vermelho/verde) ----------
// 1 000 000 = vida infinita: o ciclo (Heliod + Spike Feeder…) repetido de uma vez pelo atalho do Forge
export const lifeTxt = n => (n >= 1e6 ? '∞' : n)
// física da esfera: agarra-se com o rato ou o dedo e atira-se; desliza com inércia, bate nas bordas da mesa (com som de
// vidro), abana as cartas por onde passa e empurra os dados (evento «grim-orb»), deixa rasto e, uns segundos depois, volta
// ao sítio com uma mola. Enquanto voa sai do plano da mesa (que no lado do adversário está inclinado em perspetiva): uma
// cópia viva (el._proxy) vai numa camada por cima de tudo e anda no ecrã a sério — antes, a do adversário deformava-se e
// andava «dentro» da mesa inclinada. Um clique sem arrastar continua a ser um clique (escolher o jogador como alvo).
// el._kick(vx, vy): um golpe empurra-a; el._remoteTo(x, y): mesa online, outro jogador está a mexer-lhe.
function useOrbPhysics(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const S = { x: 0, y: 0, vx: 0, vy: 0, drag: null, raf: 0, t0: 0, last: 0, base: null, px: null }, bumped = new WeakMap()
    el._phys = S  // a esfera 3D lê a velocidade: o líquido chapinha com a inércia
    let trailN = 0, bounceAt = 0
    const host = () => document.fullscreenElement || document.webkitFullscreenElement || document.body
    const cur = () => S.px || el
    const center = () => { const r = cur().getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2] }
    const lift = () => {  // descola da mesa: a cópia fica por cima de tudo, no mesmo sítio e tamanho do ecrã
      if (S.px) return
      const r = el.getBoundingClientRect(), k = r.width / (el.offsetWidth || r.width) || 1, px = el.cloneNode(true)
      px.classList.add('orb-proxy'); px.removeAttribute('title')
      Object.assign(px.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px`, margin: '0', transformOrigin: '0 0', transform: `scale(${k})`, visibility: 'visible' })
      px.addEventListener('pointerdown', down)
      host().append(px); el.style.visibility = 'hidden'; el._proxy = px; S.px = px
    }
    const land = () => { S.px?.remove(); S.px = null; el._proxy = null; el.style.visibility = '' }
    const sync = () => {  // a cópia mostra o que a esfera verdadeira mostra (vida, estado, reação, estilo)
      const px = S.px
      if (!px) return
      px.className = `${el.className} orb-proxy flying`
      for (const a of ['mood', 'react', 't', 'a', 'rich', 'cols']) { if (el.dataset[a]) px.dataset[a] = el.dataset[a]; else delete px.dataset[a] }
      const b = el.querySelector(':scope > b'), pb = px.querySelector(':scope > b')
      if (b && pb && pb.textContent !== b.textContent) pb.textContent = b.textContent
      px.style.translate = `${S.x.toFixed(1)}px ${S.y.toFixed(1)}px`
      const sv = v => Math.max(-9, Math.min(9, -v / 120)).toFixed(1)  // o fumo lá dentro fica para trás (inércia do líquido)
      px.style.setProperty('--slx', `${sv(S.vx)}px`); px.style.setProperty('--sly', `${sv(S.vy)}px`)
      px.style.setProperty('--lift', Math.min(1, Math.hypot(S.x, S.y) / 120 + (S.drag?.on ? 0.6 : 0)).toFixed(2))
    }
    const low = () => el.classList.contains('low')  // pouca vida: pesada de arrastar, a tremer e a pingar sangue
    // atrito (quanto da velocidade fica ao fim de 1 s) pela vida: até ~6 quase nenhum (um golpe atira-a longe), aos 20
    // normal (algum peso) e cada vez mais pesada acima disso
    const grip = () => {
      const v = +el.dataset.life || 20
      return v <= 6 ? 0.85 : v <= 20 ? 0.85 - (0.7 * (v - 6)) / 14 : Math.max(0.02, 0.15 * (20 / v) ** 1.3)
    }
    const trail = () => {
      if (++trailN % (low() ? 3 : 2)) return
      const [x, y, r] = center(), d = document.createElement('i')
      if (low() && el.dataset.pf === '1' && el.dataset.o3 && el._bleed) { el._bleed(); return }  // com partículas o sangue é o próprio fluido
      d.className = low() ? 'orb-trail drip' : 'orb-trail'
      if (low() && trailN % 9 === 0) play('orbDrip')
      const sz = low() ? r * 0.45 : r * 1.5
      Object.assign(d.style, { left: `${x + (low() ? (Math.random() - 0.5) * r : 0)}px`, top: `${y + (low() ? r * 0.6 : 0)}px`, width: `${sz}px`, height: `${sz}px` })
      d.style.setProperty('--tc', getComputedStyle(el).getPropertyValue('--glow') || '#22c55e88')
      host().append(d); setTimeout(() => d.remove(), 460)
    }
    const clink = sp => { const now = performance.now(); if (sp > 160 && now - bounceAt > 120) { bounceAt = now; play('orbBounce', { amount: Math.min(1, sp / 1800) }) } }
    const collide = () => {
      const [x, y, r] = center(), box = el.closest('.fp-table, .board, .ml, .view')?.getBoundingClientRect()
      if (box) {  // as bordas da mesa: ressalta (perde um pouco) e o vidro tilinta
        if ((x - r < box.left && S.vx < 0) || (x + r > box.right && S.vx > 0)) { clink(Math.abs(S.vx)); S.vx = -S.vx * 0.72 }
        if ((y - r < box.top && S.vy < 0) || (y + r > box.bottom && S.vy > 0)) { clink(Math.abs(S.vy)); S.vy = -S.vy * 0.72 }
      }
      const pc = document.elementsFromPoint(x, y).slice(0, 8).map(e => e.closest?.('.pc')).find(Boolean)
      if (pc && performance.now() - (bumped.get(pc) || 0) > 600) {  // passou por cima de uma carta: ela abana e a esfera abranda
        bumped.set(pc, performance.now()); pc.classList.remove('orb-bump'); void pc.offsetWidth; pc.classList.add('orb-bump')
        setTimeout(() => pc.classList.remove('orb-bump'), 650); clink(Math.hypot(S.vx, S.vy) * 0.6); S.vx *= 0.82; S.vy *= 0.82
      }
    }
    const step = now => {
      const dt = S.last ? Math.min(0.033, (now - S.last) / 1000) : 0.016
      S.last = now
      if (S.remote && now - S.remote.t > 700) { S.remote = null; S.t0 = now }  // o outro jogador largou-a
      if (S.remote) {  // mesa online: outro jogador está a mexer-lhe — segue a posição que ele manda, suavizada
        const k = Math.min(1, dt * 14), ox = S.x, oy = S.y
        S.x += (S.remote.x - S.x) * k; S.y += (S.remote.y - S.y) * k; S.vx = (S.x - ox) / dt; S.vy = (S.y - oy) / dt
      } else if (!S.drag?.on) {
        const home = now - S.t0 > 1900  // uns segundos depois volta ao sítio (mola amortecida)
        if (home) { S.vx += (-S.x * 55 - S.vx * 11) * dt; S.vy += (-S.y * 55 - S.vy * 11) * dt } else { const f = Math.pow(grip(), dt); S.vx *= f; S.vy *= f }
        S.x += S.vx * dt; S.y += S.vy * dt
        collide()
        if (home && Math.hypot(S.x, S.y) < 0.6 && Math.hypot(S.vx, S.vy) < 10) {
          S.x = S.y = S.vx = S.vy = 0; S.raf = 0; S.last = 0; land()
          dispatchEvent(new CustomEvent('grim-orb', { detail: { x: center()[0], y: center()[1], vx: 0, vy: 0, el } }))
          return
        }
      }
      if (Math.hypot(S.vx, S.vy) > (low() ? 40 : 140)) trail()
      sync()
      const [x, y, r] = center()
      // local: fui eu que a agarrei/atirei (a mesa online só manda isso; a volta ao sítio e os golpes acontecem em todos os ecrãs)
      dispatchEvent(new CustomEvent('grim-orb', { detail: { x, y, r, vx: S.vx, vy: S.vy, el, remote: !!S.remote, held: !!S.drag?.on, local: !!S.drag?.on || (S.thrown > 0 && now - S.thrown < 1900) } }))
      S.raf = requestAnimationFrame(step)
    }
    const run = () => { lift(); if (!S.raf) { S.last = 0; S.raf = requestAnimationFrame(step) } }
    el._kick = (vx, vy) => { if (S.drag?.on) return; S.vx += vx; S.vy += vy; S.t0 = performance.now(); run() }
    el._remoteTo = (sx, sy) => {
      if (S.drag?.on) return
      lift()
      const [cx, cy] = center()
      S.remote = { x: sx - (cx - S.x), y: sy - (cy - S.y), t: performance.now() }; S.thrown = 0; run()
    }
    function down(e) {
      if (e.button > 0) return
      e.preventDefault()  // não seleciona o texto da página ao agarrar
      if (el.classList.contains('dead') && el._poke) {  // partida em 3D: arrastar empurra os cacos, não a esfera
        let last = [e.clientX, e.clientY, performance.now()]
        const mv = ev => { const now = performance.now(), dt = Math.max(0.008, (now - last[2]) / 1000); el._poke(ev.clientX, ev.clientY, (ev.clientX - last[0]) / dt, (ev.clientY - last[1]) / dt); last = [ev.clientX, ev.clientY, now] }
        const upp = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', upp) }
        addEventListener('pointermove', mv); addEventListener('pointerup', upp)
        return
      }
      S.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: S.x, oy: S.y, h: [[performance.now(), e.clientX, e.clientY]], on: false }
    }
    const move = e => {
      const d = S.drag
      if (!d || e.pointerId !== d.id) return
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy, now = performance.now()
      if (!d.on) {
        if (Math.hypot(dx, dy) < 7) return
        d.on = true; document.body.classList.add('orb-grab'); play('orbGrab'); run()
      }
      e.preventDefault(); e.stopPropagation()
      const p = d.h[d.h.length - 1], k = Math.max(0.008, (now - p[0]) / 1000)
      S.vx = (e.clientX - p[1]) / k; S.vy = (e.clientY - p[2]) / k
      if (low()) { S.x += (d.ox + dx - S.x) * 0.3; S.y += (d.oy + dy - S.y) * 0.3 } else { S.x = d.ox + dx; S.y = d.oy + dy }  // pouca vida: arrasta-se a custo
      d.h.push([now, e.clientX, e.clientY]); d.h = d.h.filter(q => now - q[0] < 110).slice(-6)
    }
    const up = e => {
      const d = S.drag
      if (!d || e.pointerId !== d.id) return
      S.drag = null; document.body.classList.remove('orb-grab')
      if (!d.on) { if (S.px) S.px.dispatchEvent(new MouseEvent('click', { bubbles: true })); return }  // clicar na cópia a voar = clicar na esfera
      const a = d.h[0], b = d.h[d.h.length - 1], k = Math.max(0.016, (b[0] - a[0]) / 1000), m = low() ? 1100 : 3200, cap = v => Math.max(-m, Math.min(m, v))
      S.vx = d.h.length > 1 ? cap((b[1] - a[1]) / k) : 0; S.vy = d.h.length > 1 ? cap((b[2] - a[2]) / k) : 0
      S.t0 = performance.now(); el._dragged = S.t0; S.thrown = S.t0; run()
      const sp = Math.hypot(S.vx, S.vy); if (sp > 400) play('orbThrow', { amount: Math.min(1, sp / 2600) })
    }
    const click = e => { if (el._dragged && performance.now() - el._dragged < 450) { e.stopPropagation(); e.preventDefault() } }  // largar não é clicar
    // esfera contra esfera: a que vem a voar empurra a outra (e o vidro tilinta)
    let hitAt = 0
    const other = e => {  // outra esfera a voar ou um dado a rolar («grim-die», sem el)
      const d = e.detail
      if (!d || d.el === el || S.drag?.on || !d.r) return
      const [x, y, r] = center(), dx = x - d.x, dy = y - d.y, L = Math.hypot(dx, dy) || 1, sp = Math.hypot(d.vx, d.vy)
      if (L > r + d.r || sp < 60 || performance.now() - hitAt < 250) return
      hitAt = performance.now(); clink(sp)
      el._kick((dx / L) * sp * 0.8, (dy / L) * sp * 0.8)
    }
    addEventListener('grim-orb', other); addEventListener('grim-die', other)
    el.addEventListener('pointerdown', down); el.addEventListener('click', click, true)
    addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', up)
    return () => {
      cancelAnimationFrame(S.raf); land(); document.body.classList.remove('orb-grab'); removeEventListener('grim-orb', other); removeEventListener('grim-die', other)
      el.removeEventListener('pointerdown', down); el.removeEventListener('click', click, true)
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up)
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
}

// a vida é uma esfera de vidro com fumo lá dentro, sempre a rodar devagar; reage ao que acontece (data-mood): dano = fumo de
// sangue, vida ganha = luz dourada/verde, veneno = fumo roxo, vida baixa = vermelho a pulsar. O DamageFx junta a reação de
// quem bateu (data-react: voar, atropelar, toque mortal, vínculo vital, infetar, golpe duplo, feitiço = fogo…).
// dmg: o dano levado no combate em curso — fica por cima da esfera (antes ocupava lugar na barra e empurrava a vida e os montes)
// ⛶ ecrã inteiro direto na mesa (Forge Play, mesa livre): o Coliseu inteiro (ou a página) entra/sai do ecrã inteiro
export function FsBtn({ className = '' }) {
  const [on, setOn] = useState(() => !!(document.fullscreenElement || document.webkitFullscreenElement))
  useEffect(() => {
    const f = () => setOn(!!(document.fullscreenElement || document.webkitFullscreenElement))
    document.addEventListener('fullscreenchange', f); document.addEventListener('webkitfullscreenchange', f)
    return () => { document.removeEventListener('fullscreenchange', f); document.removeEventListener('webkitfullscreenchange', f) }
  }, [])
  const go = e => {
    const d = document, el = e.currentTarget.closest('.coliseu') || d.documentElement
    if (d.fullscreenElement || d.webkitFullscreenElement) return (d.exitFullscreen || d.webkitExitFullscreen).call(d)
    Promise.resolve((el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)).catch(() => {})
  }
  return <button type="button" className={`fs-mini ${className}`} onClick={go} title={`${on ? tx('Sair do ecrã inteiro') : tx('Ecrã inteiro')} (Shift+F)`} aria-label={on ? tx('Sair do ecrã inteiro') : tx('Ecrã inteiro')}>{on ? '🗗' : '⛶'}</button>
}

// a esfera rebenta quando o jogador perde, à maneira da causa (dano = sangue, veneno = nuvem tóxica, moer = pó e folhas,
// comandante = ouro, vitória alternativa do outro = engolida pela luz, «perdes o jogo» = implode, desistir = apaga-se,
// empate = pedra). Antes disto a esfera «carrega» (rachas a crescer, a tremer, a brilhar: .orb.bursting); aqui é a
// explosão: clarão, onda de choque, cacos de vidro irregulares a rodar em 3D, a nuvem do que tinha dentro e o número a cair.
const BURST_COL = { dmg: ['#ff2a3a', '#7a0010'], psn: ['#a855f7', '#65a30d'], mill: ['#d6d3d1', '#78716c'], cmd: ['#f2b84b', '#8a5a00'], alt: ['#ffffff', '#fde68a'], lose: ['#1e1b4b', '#000000'] }
function orbBurst(el, cause) {
  const r = el.getBoundingClientRect(), host = document.fullscreenElement || document.webkitFullscreenElement || document.body
  if (!r.width) return
  const box = document.createElement('div'), bg = getComputedStyle(el).backgroundImage, R = r.width / 2, add = (cls, css = {}) => { const e = document.createElement('i'); e.className = cls; Object.assign(e.style, css); box.append(e); return e }
  box.className = `oburst ${cause}`
  Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  host.append(box)
  setTimeout(() => box.remove(), 2600)
  if (cause === 'draw' || cause === 'concede') {  // empate: fica de pedra; desistir: apaga-se devagar com a bandeira branca
    add(`oflash ${cause}`)
    if (cause === 'concede') add('oflag').textContent = '🏳'
    return
  }
  const [c1, c2] = BURST_COL[cause] || BURST_COL.dmg
  box.style.setProperty('--c1', c1); box.style.setProperty('--c2', c2)
  add(`oflash ${cause}`)
  add('oring'); add('oring o2')  // onda de choque (duas)
  if (cause === 'lose' || cause === 'alt') { add(`oflash ${cause} big`); return }  // implode / engolida pela luz: sem cacos
  if (cause === 'mill') for (let i = 0; i < 14; i++) {  // moer: a biblioteca vazia — páginas (costas de carta) a sair e a cair a esvoaçar
    const pg = add('opage', { left: `${R}px`, top: `${R}px` }), a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, up = 60 + Math.random() * 70, sx = Math.cos(a) * (40 + Math.random() * 60)
    pg.animate([{ transform: 'translate(-50%, -50%) scale(.3) rotate(0deg)', opacity: 1 }, { transform: `translate(calc(-50% + ${sx * 0.6}px), calc(-50% - ${up}px)) scale(1) rotate(${(Math.random() - 0.5) * 200}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${R * 2.5}px)) scale(.9) rotate(${(Math.random() - 0.5) * 720}deg) rotateY(${360 + Math.random() * 360}deg)`, opacity: 0 }],
      { duration: 1800 + Math.random() * 700, delay: 250 + i * 50, easing: 'cubic-bezier(.25, .6, .5, 1)', fill: 'both' })
  }
  if (cause === 'cmd') add('oslash')  // dano de comandante: um corte dourado que a parte ao meio
  // a nuvem do que estava lá dentro
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 2 * Math.PI + Math.random(), d = R * (0.6 + Math.random() * 0.8)
    const p = add('ocloud', { left: `${R}px`, top: `${R}px` })
    p.animate([{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0.9 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - (cause === 'psn' ? 30 : 0)}px)) scale(${2.2 + Math.random()})`, opacity: 0 }],
      { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.1, .7, .3, 1)', fill: 'both' })
  }
  // cacos de vidro: o círculo cortado em fatias irregulares (ângulos ao acaso e um ponto de dentro deslocado)
  const N = el.classList.contains('has3d') ? 0 : 16, cuts = Array.from({ length: N }, (_, i) => (i + 0.2 + Math.random() * 0.6) / N * 2 * Math.PI)
  for (let i = 0; i < N; i++) {
    const a0 = cuts[i], a1 = cuts[(i + 1) % N] + (i === N - 1 ? 2 * Math.PI : 0), am = (a0 + a1) / 2, rim = 50 + 4
    const ins = 6 + Math.random() * 22, ix = 50 + Math.cos(am) * ins, iy = 50 + Math.sin(am) * ins
    const pt = (a, k = rim) => `${(50 + k * Math.cos(a)).toFixed(1)}% ${(50 + k * Math.sin(a)).toFixed(1)}%`
    const sh = add('oshard', { backgroundImage: `linear-gradient(${Math.round(am * 57)}deg, #ffffff88, transparent 45%), ${bg}`, clipPath: `polygon(${ix.toFixed(1)}% ${iy.toFixed(1)}%, ${pt(a0)}, ${pt(am, rim + 3)}, ${pt(a1)})` })
    const sp = cause === 'mill' ? 30 + Math.random() * 30 : 90 + Math.random() * 110, g = cause === 'mill' ? 140 : 230 + Math.random() * 120
    const vx = Math.cos(am) * sp, vy = Math.sin(am) * sp - 40, rx = (Math.random() - 0.5) * 720, ry = (Math.random() - 0.5) * 720, rz = (Math.random() - 0.5) * 360
    const at = k => `translate3d(${(vx * k).toFixed(1)}px, ${(vy * k + g * k * k).toFixed(1)}px, ${(40 * k).toFixed(1)}px) rotateX(${(rx * k).toFixed(0)}deg) rotateY(${(ry * k).toFixed(0)}deg) rotateZ(${(rz * k).toFixed(0)}deg)`
    sh.animate([{ transform: 'none', opacity: 1 }, { transform: at(0.3), opacity: 1, offset: 0.25 }, { transform: at(0.65), opacity: 0.9, offset: 0.6 }, { transform: at(1), opacity: 0 }],
      { duration: 1300 + Math.random() * 500, easing: 'linear', fill: 'both' })
  }
  // o número da vida cai (e roda)
  const n = el.querySelector(':scope > b')?.textContent
  if (n != null) {
    const b = document.createElement('b'); b.className = 'onum'; b.textContent = n; box.append(b)
    b.animate([{ transform: 'translate(-50%, -50%)', opacity: 1 }, { transform: `translate(-50%, ${R * 3}px) rotate(${(Math.random() - 0.5) * 120}deg)`, opacity: 0 }], { duration: 1400, easing: 'cubic-bezier(.5, 0, .9, .5)', fill: 'both' })
  }
  const P = { dmg: 22, psn: 16, mill: 18, cmd: 18 }[cause] ?? 10
  for (let i = 0; i < P; i++) {  // sangue, fumo tóxico, folhas/pó, ouro
    const a = Math.random() * 2 * Math.PI, sp = 50 + Math.random() * 120, d = add(`opart ${cause}`, { left: `${R}px`, top: `${R}px` })
    const fall = cause === 'dmg' ? 160 : cause === 'mill' ? 110 : cause === 'cmd' ? 80 : -50
    d.animate([{ transform: 'translate(-50%, -50%) scale(.5)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * sp}px), calc(-50% + ${Math.sin(a) * sp + fall}px)) scale(${cause === 'psn' ? 3 : 1}) rotate(${cause === 'mill' ? (Math.random() - 0.5) * 540 : 0}deg)`, opacity: 0 }],
      { duration: 1000 + Math.random() * 800, delay: Math.random() * 120, easing: 'cubic-bezier(.2, .6, .4, 1)', fill: 'both' })
  }
}

// como acabou um jogo entre bots (o «reason» do Forge) → a causa da derrota de cada lado (orbBurst):
// dmg vida a 0, psn veneno, mill sem cartas para comprar, cmd dano de comandante, alt vitória alternativa do outro,
// lose «perdes o jogo» de uma carta, concede desistiu, draw empate
export function endOut(game, sides = []) {
  const r = String(game?.reason || '')
  if (!game?.winner || /interromp|falh|Forge Play/i.test(r)) return null
  if (game.winner === 'draw') return Object.fromEntries(sides.map(k => [k, 'draw']))
  const cause = /life total/i.test(r) ? 'dmg' : /poison/i.test(r) ? 'psn' : /empty library|draw cards/i.test(r) ? 'mill' : /commander/i.test(r) ? 'cmd'
    : /conced/i.test(r) ? 'concede' : /won by spell|opponent has won/i.test(r) ? 'alt' : 'lose'
  const m = r.match(/Ai\(\d+\)-([A-D])/), losers = m ? [m[1].toLowerCase()] : sides.filter(k => k !== game.winner)
  return Object.fromEntries(losers.map(k => [k, cause]))
}
// Forge Play: a causa que o Forge dá (PlayerOutcome.lossState) → a da esfera
export const ORB_DEATH = { LifeReachedZero: 'dmg', Poisoned: 'psn', Milled: 'mill', CommanderDamage: 'cmd', SpellEffect: 'lose', OpponentWon: 'alt', Conceded: 'concede', IntentionalDraw: 'draw', draw: 'draw' }

// ---------- o aspeto da esfera de cada lado ----------
// OrbCtx: mine = o lado que é meu (as minhas preferências), seed = o torneio/jogo (a escolha ao acaso dos bots fica fixa
// por deck dentro dele), looks = {lado: {t, a}} escolhidos por outros jogadores (online: o do amigo)
export const OrbCtx = createContext({ mine: null, seed: '', looks: null })
const COL_T = { W: 'ouro', U: 'oceano', B: 'vazio', R: 'brasa', G: 'verde' }
const hashS = t => [...String(t)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0
const deckLook = (z, data) => {  // pelas cartas que já se viram desse lado: a cor que mais aparece e o estilo do deck
  const cs = [...(z.perms || []).map(p => p.name), ...(z.graveyard || []), ...(z.exile || [])].map(n => lookup(data, n)).filter(c => c && c.mt !== 'Land')
  const cnt = {}
  for (const c of cs) for (const k of new Set(String(c.co ?? '').replace(/[^WUBRG]/g, ''))) cnt[k] = (cnt[k] || 0) + 1
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]), many = top.filter(([, n]) => n >= Math.max(2, (top[0]?.[1] || 0) * 0.5)).length
  const t = !top.length ? 'gelo' : many >= 3 ? 'prisma' : COL_T[top[0][0]]
  const n = cs.length || 1, cre = cs.filter(c => c.mt === 'Creature').length / n, spl = cs.filter(c => c.mt === 'Instant' || c.mt === 'Sorcery').length / n
  return { t, a: cre > 0.55 ? 'turbilhao' : spl > 0.45 ? 'faiscas' : cs.length > 3 ? 'calmo' : 'pulsar', n: cs.length, cols: top.filter(([, n]) => n >= Math.max(1, (top[0]?.[1] || 0) * 0.34)).slice(0, 3).map(([k]) => k).join('') }
}
// a mistura dos fluidos (W U B R G C + quanto do branco vem de feitiços), viva: muda com o que está em campo. Terrenos
// pelas cores que dão, permanentes inteiras, cemitério/exílio um pouco; incolores (artefactos, eldrazi) = C
const fieldMix = (z, data) => {
  const w = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  let wsp = 0
  const add = (n, k) => { const c = lookup(data, n); if (!c) return
    const land = /Land/.test(c.t), cs = String((land ? c.ci : c.co) ?? '').replace(/[^WUBRG]/g, '')
    const f = k * (land ? 0.6 : 1)
    if (!cs) { w.C += f * (land ? 0.6 : 1); return }
    for (const x of cs) { w[x] += f / cs.length; if (x === 'W' && /Instant|Sorcery/.test(c.t)) wsp += f / cs.length } }
  for (const p of z.perms || []) if (!p.hidden && !p.faceDown) add(p.name, 1)
  for (const n of [...(z.graveyard || []), ...(z.exile || [])]) add(n, 0.3)
  const tot = Object.values(w).reduce((a, b) => a + b, 0)
  if (tot < 0.5) return undefined
  const v = ['W', 'U', 'B', 'R', 'G', 'C'].map(k => (w[k] / tot >= 0.08 ? w[k] / tot : 0))
  return [...v.map(x => x.toFixed(2)), (w.W ? Math.min(1, wsp / w.W) : 0).toFixed(2)].join(',')
}
// o que pesa na esfera além das cores (data-env, orb3d.js): dano levado, feitiços na mesa a favor/contra, cemitério,
// exílio, biblioteca a acabar (a esfera pinga), calor e frio (brilho por fora; com calor ou pouca vida, transpira)
export const orbEnv = (k, s, data) => {
  const z = s[k]; if (!z) return undefined
  const base = z.command?.length ? 40 : 20, cl = x => Math.max(0, Math.min(1, x))
  const mine = new Set((z.perms || []).map(p => p.key))
  const others = (s.sides || []).filter(x => x !== k).flatMap(x => s[x]?.perms || [])
  let good = 0, heat = 0, cold = 0
  for (const p of z.perms || []) { const c = permCard(data, p); if (!c) continue
    if (/Aura|Equipment/.test(c.t) && mine.has(p.attachedTo)) good += 0.25; else if (/Enchantment/.test(c.t) && !/Aura/.test(c.t)) good += 0.12
    if (/\bSnow\b/.test(c.t)) cold += 0.2 }
  const bad = others.filter(p => p.attachedTo && mine.has(p.attachedTo)).length * 0.4
  for (const n of z.graveyard || []) { const c = lookup(data, n); if (c && /Instant|Sorcery/.test(c.t)) { if (/R/.test(c.co || '')) heat += 0.12; if (/U/.test(c.co || '')) cold += 0.08 } }
  const w = (fieldMix(z, data) || '').split(',').map(Number)
  heat += (w[3] || 0) * 0.9; cold += (w[1] || 0) * 0.5
  const lib = Number.isFinite(z.library) ? z.library : 40
  // presença na mesa: a força das criaturas e os terrenos (o halo e o brilho crescem com ela)
  let pres = 0
  for (const p of z.perms || []) { if (isLand(data, p)) pres += 0.5; else if (isCreature(data, p)) pres += Math.max(1, powTough(data, p)?.p || 1) }
  let lands = 0, force = 0  // 9: terrenos (o cinto de mana do halo), 10: força das criaturas (o enxame fica bravo)
  for (const p of z.perms || []) { if (isLand(data, p)) lands++; else if (isCreature(data, p)) force += Math.max(1, powTough(data, p)?.p || 1) }
  return [cl((base - z.life) / base), cl(good), cl(bad), cl((z.graveyard?.length || 0) / 30), cl((z.exile?.length || 0) / 15), lib <= 10 ? cl(1 - lib / 10) : 0, cl(heat), cl(cold), cl(pres / 30), cl((lands - 3) / 9), cl(force / 20)].map(x => x.toFixed(2)).join(',')
}
const locked = new Map()  // o aspeto «pelo deck» fixa-se quando já se viram 5 cartas (não muda a meio do jogo)
export function orbLook(k, z, data, ctx, name) {
  const P = fpPrefs(), mine = ctx.mine === k, other = ctx.looks?.[k]  // other: a que outro jogador escolheu (online)
  let { t, a } = other || (mine ? P.orb : { t: 'auto', a: 'auto' })
  if (!mine && !other && P.botOrb === 'random') { const h = hashS(`${ctx.seed}|${name || k}`); t = ORB_T[h % ORB_T.length]; a = ORB_A[(h >>> 5) % ORB_A.length] }
  const key = `${ctx.seed}|${name || k}`, d = locked.get(key) || deckLook(z, data)
  if (d.n >= 5 && !locked.has(key)) { locked.set(key, d); if (locked.size > 200) locked.delete(locked.keys().next().value) }
  const auto = t === 'auto'
  if (t === 'auto') t = d.t
  if (a === 'auto') a = d.a
  return { t, a, cols: d.cols, w: auto && P.orbFluid ? fieldMix(z, data) : undefined }  // w: os fluidos por cor (só no estilo automático)  // cols: as cores do deck (o halo da esfera 3D)
}
export const ORB_T_NAME = { verde: tx('Floresta'), oceano: tx('Oceano'), brasa: tx('Brasa'), vazio: tx('Vazio'), ouro: tx('Ouro'), gelo: tx('Gelo'), prisma: tx('Prisma'), tempestade: tx('Tempestade'), sangue: tx('Sangue') }
export const ORB_A_NAME = { calmo: tx('Calmo'), turbilhao: tx('Turbilhão'), pulsar: tx('Pulsar'), faiscas: tx('Faíscas') }
// o tamanho das esferas (Definições › padrão da mesa): uma variável no documento, as esferas usam-na (zoom no CSS)
const orbScale = v => { try { document.documentElement.style.setProperty('--orbk', String(v)) } catch { /* sem documento */ } }
orbScale(fpPrefs().orbScale)
// escolher a minha esfera (estilo e animação) e a dos bots; onChange avisa a mesa (online: os outros veem a minha)
export function OrbPick({ onChange }) {
  const [p, setP] = useState(() => fpPrefs())
  const save = v => { setFpPrefs(v); setP(fpPrefs()); onChange?.(fpPrefs()) }
  return (
    <div className="orbpick">
      <div className="matpick-row" role="radiogroup" aria-label={tx('Esfera da vida')}>
        {['auto', ...ORB_T].map(t => <button key={t} type="button" role="radio" aria-checked={p.orb.t === t} className={`orbsw ${p.orb.t === t ? 'on' : ''}`} title={t === 'auto' ? tx('Pelas cores do deck') : ORB_T_NAME[t]}
          onClick={() => save({ orb: { ...p.orb, t } })}><span className="orb" data-t={t === 'auto' ? undefined : t} data-a={p.orb.a === 'auto' ? undefined : p.orb.a}><span className="orb-in"><i className="orb-smoke" /><i className="orb-smoke s2" /></span>{t === 'auto' ? <b>A</b> : null}</span></button>)}
      </div>
      <label className="chk small"><input type="checkbox" checked={p.orb3d} onChange={e => save({ orb3d: e.target.checked })} /> {tx('Esfera da vida em 3D (desligado: esfera plana, mais leve)')}</label>
      {p.orb3d && <label className="chk small" title={p.orb.t !== 'auto' ? tx('Só no estilo automático (pelas cores do deck)') : undefined}><input type="checkbox" checked={p.orbFluid} disabled={p.orb.t !== 'auto'} onChange={e => save({ orbFluid: e.target.checked })} /> {tx('Fluido com as cores das cartas em campo (só no estilo automático)')}</label>}
      {p.orb3d && <label className="chk small"><input type="checkbox" checked={p.orbParticles} onChange={e => save({ orbParticles: e.target.checked })} /> {tx('Fluido de partículas com física (desligado: líquido animado, mais leve)')}</label>}
      {p.orb3d && p.orbParticles && <label className="small">{tx('Aspeto das partículas')} <select value={p.orbGrain} onChange={e => save({ orbGrain: e.target.value })}>
        <option value="real">{tx('Realista: grãos com luz própria')}</option><option value="fx">{tx('Estilizado: estrelas, penas e brilhos desenhados')}</option></select></label>}
      {p.orb3d && p.orbParticles && p.orbGrain !== 'fx' && <label className="small" title={tx('Tudo é desenhado neste aparelho (PC, telemóvel ou browser), também online: o servidor só envia o estado do jogo e cada aparelho simula as esferas a partir dele.')}>{tx('Qualidade da esfera')} <select value={p.orbQuality} onChange={e => save({ orbQuality: e.target.value })}>
        <option value="auto">{tx('Automática (a placa gráfica, se der)')}</option><option value="gpu">{tx('Placa gráfica: dezenas de milhares de grãos')}</option><option value="cpu">{tx('Processador: 5 mil grãos')}</option><option value="leve">{tx('Leve: para aparelhos fracos')}</option></select></label>}
      {p.orb3d && p.orbParticles && p.orbGrain !== 'fx' && <p className="muted small">{tx('Tudo é desenhado neste aparelho (PC, telemóvel ou browser), também online: o servidor só envia o estado do jogo e cada aparelho simula as esferas a partir dele.')}</p>}
      <label className="small orbsize">{tx('Tamanho das esferas')} <b>{Math.round(p.orbScale * 100)}%</b>
        <input type="range" min={80} max={160} step={5} value={Math.round(p.orbScale * 100)} onChange={e => { const v = +e.target.value / 100; orbScale(v); save({ orbScale: v }) }} /></label>
      <label className="small">{tx('Animação')} <select value={p.orb.a} onChange={e => save({ orb: { ...p.orb, a: e.target.value } })}>
        <option value="auto">{tx('Pelo estilo do deck')}</option>{ORB_A.map(a => <option key={a} value={a}>{ORB_A_NAME[a]}</option>)}</select></label>
      <label className="small">{tx('Esfera dos bots')} <select value={p.botOrb} onChange={e => save({ botOrb: e.target.value })}>
        <option value="deck">{tx('Pelas cores e pelo estilo do deck')}</option><option value="random">{tx('Ao acaso (fixa em cada torneio)')}</option></select></label>
    </div>
  )
}

function Orb({ life, d, step, hit, fast, start, poison = 0, psnHit, pmax = 10, dmg = 0, look, dead = null, side, env }) {  // dead: a causa da derrota (endOut/ORB_DEATH: dmg, psn, mill, cmd, alt, lose, concede, draw)  // poison: o veneno ao lado da vida (pmax = derrota: 10, ou 15 da equipa no Two-Headed Giant)
  const ref = useRef(null), prev = useRef(life), [mood, setMood] = useState(''), orbRef = useRef(null), [broken, setBroken] = useState(!!dead), [charging, setCharging] = useState(false)
  useOrbPhysics(orbRef)
  // esfera 3D (Definições › padrão da mesa): o mesmo elemento, desenhado pelo orb3d.js; sem WebGL fica a clássica
  const [three, setThree] = useState(false), cvRef = useRef(null), o3 = useRef(null)
  const want3d = fpPrefs().orb3d
  useEffect(() => {  // também quando se liga/desliga a meio do jogo (🎨 tapete)
    if (!want3d) { setThree(false); return }
    let live = true
    import('./orb3d.js').then(m => { if (live && m.webgl3d()) { o3.current = m; setThree(true) } }).catch(() => {})
    return () => { live = false }
  }, [want3d])
  useEffect(() => (three && cvRef.current && o3.current ? o3.current.attachOrb3d(orbRef.current, cvRef.current) : undefined), [three])  // só depois de o canvas existir
  useEffect(() => {  // perdeu: uns instantes depois a esfera rebenta (à maneira da causa) e fica a casca
    if (!dead) { setBroken(false); return }
    if (fast || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setBroken(true); return }
    play(dead === 'draw' ? 'orbStone' : 'orbBurst')
    const calm = dead === 'draw' || dead === 'concede'
    setCharging(!calm)  // antes de rebentar: rachas a crescer, a tremer e a brilhar
    const t = setTimeout(() => { setCharging(false); try { orbBurst(orbRef.current?._proxy || orbRef.current, dead) } catch (e) { console.warn('orbBurst', e) } setBroken(true) }, calm ? 200 : 750)
    return () => { clearTimeout(t); setCharging(false) }
  }, [dead])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fast) return
    const m = psnHit ? 'psn' : d < 0 || hit ? 'loss' : d > 0 ? 'gain' : ''
    if (!m) return
    setMood(m)
    const t = setTimeout(() => setMood(''), 1600)
    return () => clearTimeout(t)
  }, [step, d, hit, psnHit, fast])
  useEffect(() => {
    const el = ref.current, from = prev.current
    prev.current = life
    if (!el) return
    if (fast || from === life || life >= 1e6 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.textContent = lifeTxt(life); return }
    let raf, t0
    const tick = t => {
      t0 ??= t
      const k = Math.min(1, (t - t0) / 450)
      el.textContent = Math.round(from + (life - from) * k)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); el.textContent = lifeTxt(life) }
  }, [life, fast])
  const low = life <= Math.max(5, Math.round(start / 4))
  // muita vida (dos 40 aos 100, aos poucos): a esfera ganha um ou dois «excessos» escolhidos ao acaso — auréola a crescer,
  // a engordar (gelatina), a transpirar gotas de luz, raios de luz divina à volta; a partir de 70 junta o segundo
  const ab = life >= 1e6 ? 1 : life > 40 ? Math.min(1, (life - 40) / 60) : 0
  const [richPick] = useState(() => { const all = ['halo', 'fat', 'sweat', 'god'], a = all[Math.floor(Math.random() * 4)], b = all[(all.indexOf(a) + 1 + Math.floor(Math.random() * 3)) % 4]; return [a, b] })
  const rich = ab > 0 && !dead ? (ab >= 0.5 ? richPick : richPick.slice(0, 1)) : []
  const beatTop = Math.max(8, Math.round(start / 5)), beating = !dead && !fast && life > 0 && life < 1e6 && life <= beatTop
  useEffect(() => {  // o coração da esfera: começa devagar e fraco nos 8 de vida; mais depressa e mais forte quanto mais perto do fim
    if (!beating) return
    const k = Math.min(1, Math.max(0, (beatTop - life) / Math.max(1, beatTop - 1))), P = Math.round(1700 - 950 * k), el = orbRef.current
    // o som e o pulsar (CSS e 3D) pelo mesmo relógio: o «lub» no início de cada período e o «dub» 0,17 s depois
    const beat = () => { if (document.visibilityState === 'visible') play('orbHeart', { side, amount: 0.2 + 0.8 * k }) }
    if (el) { el._beat = { t0: performance.now(), P, amp: 0.3 + 0.7 * k }; el.style.setProperty('--bamp', (0.3 + 0.7 * k).toFixed(2)); el.style.setProperty('--beat', `${P}ms`); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '' }
    beat()
    const iv = setInterval(beat, P)
    return () => { clearInterval(iv); if (el) el._beat = null }
  }, [beating, life, side])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={orbRef} data-seed={`${side}|${start}`} data-life={life} className={`orb ${low ? 'low' : ''} ${poison > 0 ? 'psnd' : ''} ${broken ? `dead dead-${dead}` : ''} ${beating && !low ? 'beating' : ''} ${charging ? 'bursting' : ''} ${rich.length ? 'rich' : ''} ${three ? 'has3d' : ''}`} data-cols={look?.cols || undefined} data-w={look?.w} data-pf={fpPrefs().orbParticles ? '1' : undefined} data-pg={fpPrefs().orbGrain === 'fx' ? 'fx' : undefined} data-pq={fpPrefs().orbQuality} data-env={env} data-psn={poison > 0 ? Math.min(1, poison / pmax).toFixed(2) : undefined} data-rich={rich.join(' ') || undefined} style={rich.length ? { '--ab': ab.toFixed(2) } : undefined} data-mood={mood || undefined} data-t={look?.t} data-a={look?.a} title={tx('{n} de vida', { n: lifeTxt(life) })}>
      {three && <canvas ref={cvRef} className="orb3d" aria-hidden="true" />}
      {rich.includes('god') && <i className="orb-rays" aria-hidden="true" />}
      <span className="orb-in" aria-hidden="true"><i className="orb-smoke" /><i className="orb-smoke s2" /><i className="orb-fx" /></span>
      {rich.includes('halo') && <i className="orb-halo" aria-hidden="true" />}
      {rich.includes('sweat') && <i className="orb-sweat" aria-hidden="true"><b /><b /><b /><b /><b /></i>}
      <b ref={ref}>{lifeTxt(life)}</b><small>{tx('vida')}</small>
      {dmg > 0 && <i className="orb-dmg" title={tx('Dano que levou neste combate: {n}', { n: dmg })}>−{dmg}</i>}
      {d && !fast ? <i key={step} className={`orb-flash ${d < 0 ? 'loss' : 'gain'}`} /> : null}
      {d && !fast ? <i key={`f${step}`} className={`float ${d < 0 ? 'loss' : 'gain'}`}>{d > 0 ? '+' : '−'}{lifeTxt(Math.abs(d))}</i> : null}
      {hit && !fast ? <i key={`h${step}`} className="orb-hit" /> : null}
      {poison > 0 && <i key={psnHit && !fast ? `p${step}` : 'p'} className={`orb-psn ${poison >= pmax - 3 ? 'crit' : ''} ${psnHit && !fast ? 'up' : ''}`} title={tx('{n} marcadores de veneno ({m} = derrota)', { n: poison, m: pmax })}>☠ {poison}</i>}
    </div>
  )
}

function Pile({ label, icon, cards, count, onOpen, data, est, back, quiet, zone }) {  // zone: data-zone (a mesa livre larga cartas nos montes)  // est: jogo antigo, contagem deduzida
  const top = cards?.length ? cards[cards.length - 1] : null
  const c = top && lookup(data, top), im = useImg()
  const n = count ?? cards?.length ?? 0
  return (
    <button className={`pile ${n ? '' : 'empty'}`} data-zone={zone} onClick={onOpen} title={`${label}: ${n}${est ? ` ${tx('(estimativa: o Forge não regista as compras)')}` : ''}`} disabled={!onOpen}>
      <span className="pile-c">{back || !c ? <span className={n ? 'pc-back' : 'pile-0'} /> : <In as="img" key={`${n}`} quiet={quiet} src={im(c, 'small')} alt={top} />}</span>
      <small>{icon} {n == null ? '?' : `${est ? '≈' : ''}${n}`}</small>
    </button>
  )
}

// ---------- bloqueios à vista: o par (atacante ⚔ n, bloqueadores 🛡 n) com a mesma cor e uma linha entre eles ----------
const PAIR = ['#f2b84b', '#4cc9f0', '#ff5c8a', '#80ed99', '#c77dff', '#ff9f43']
// blocking = a chave do atacante (réplicas e Forge Play); true = bloqueia sem se saber quem (jogos antigos): sem par
export function combatPairs(perms) {
  const att = new Map()
  for (const p of perms) if (typeof p.blocking === 'string' && !att.has(p.blocking)) att.set(p.blocking, att.size + 1)
  const out = new Map(att)
  for (const p of perms) if (typeof p.blocking === 'string') out.set(p.key, att.get(p.blocking))
  return out
}
// as linhas por cima da mesa (sem apanhar cliques): medidas no ecrã e passadas para a mesa (que pode estar escalada e com
// scroll); refeitas enquanto as cartas deslizam e de 300 em 300 ms enquanto há bloqueios (as filas mexem-se)
// a cor de um feitiço pela cor da carta (o efeito brilha nessa cor na legenda e a linha até ao alvo também)
const SPELL_COL = { W: '#f5e6a8', U: '#4cc9f0', B: '#b07cff', R: '#ff5c3a', G: '#4ade80' }
export function spellCol(c) {
  const k = [...new Set(String(c?.co ?? c?.ci ?? '').toUpperCase().replace(/[^WUBRG]/g, ''))]
  return k.length > 1 ? '#f2b84b' : SPELL_COL[k[0]] || '#cbd5e1'
}
// ---------- a pilha aponta para os alvos: uma linha tracejada a correr, na cor do feitiço, de cada carta da pilha até cada
// alvo (permanente, jogador ou outro feitiço na pilha), com um anel a pulsar no alvo ----------
// s.stack[j] = {card, tc: [chave da carta], tp: ['a'|'b'], target: nome} — sem chaves (réplicas), procura-se pelo nome
export function StackLinks({ s, data }) {
  const ref = useRef(null), [ls, setLs] = useState([])
  const items = s.stack || [], sig = items.map((x, j) => `${j}:${x.card}>${(x.tc || []).join('.')}|${(x.tp || []).join('.')}|${x.tc || x.tp ? '' : x.target || ''}`).join(',')
  useLayoutEffect(() => {
    const root = ref.current?.parentElement
    if (!root || !items.some(x => x.tc?.length || x.tp?.length || x.target)) { setLs([]); return }
    const measure = () => {
      try {
        const r = root.getBoundingClientRect(), sc = r.width / (root.offsetWidth || r.width) || 1
        const pt = q => q?.width ? [(q.left + q.width / 2 - r.left) / sc + root.scrollLeft, (q.top + q.height / 2 - r.top) / sc + root.scrollTop] : null
        const byName = nm => [...root.querySelectorAll('.pc[data-z^="k:"] img')].find(i => i.alt === nm)?.closest('.pc')
        const out = []
        items.forEach((x, j) => {
          const from = pt(root.querySelector(`.stk[data-si="${j}"]`)?.getBoundingClientRect())
          if (!from) return
          const col = spellCol(lookup(data, x.card))
          const tos = [...(x.tc || []).map(k => root.querySelector(`.pc[data-z="k:${k}"]`) || root.querySelector(`.stk[data-si]:not([data-si="${j}"])`)),
            ...(x.tp || []).map(k => root.querySelector(`.bside.p-${k} .orb`)),
            ...(!x.tc?.length && !x.tp?.length && x.target ? [/^[a-d]$/.test(x.target) ? root.querySelector(`.bside.p-${x.target} .orb`) : byName(x.target)] : [])]
          tos.forEach((e, i) => { const to = pt((e?._proxy || e)?.getBoundingClientRect()); if (to) out.push({ k: `${j}-${i}`, col, xy: [...from, ...to], top: j === items.length - 1 }) })
        })
        setLs(out)
      } catch (e) { console.warn('StackLinks', e) }
    }
    let raf, t0 = performance.now(), orbRaf = 0
    const anim = () => { measure(); if (performance.now() - t0 < 900) raf = requestAnimationFrame(anim) }
    anim()
    const iv = setInterval(measure, 300)
    const onOrb = () => { if (!orbRaf) orbRaf = requestAnimationFrame(() => { orbRaf = 0; measure() }) }  // a esfera mexeu-se: a linha segue-a
    addEventListener('grim-orb', onOrb)
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(orbRaf); clearInterval(iv); removeEventListener('grim-orb', onOrb) }
  }, [sig])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg ref={ref} className="slinks" aria-hidden="true">
      {ls.map(({ k, col, top, xy: [x1, y1, x2, y2] }) => <g key={k} className={top ? 'top' : ''} style={{ '--spell': col }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} /><circle className="sl-from" cx={x1} cy={y1} r="4" /><circle className="sl-to" cx={x2} cy={y2} r="16" /></g>)}
    </svg>
  )
}

export function CombatLinks({ s }) {
  const ref = useRef(null), [ls, setLs] = useState([])
  // bloqueador → atacante, e atacante → o planeswalker/batalha que ataca (linha a tracejado, «atk»)
  const all = s.sides.flatMap(k => s[k].perms)
  const pairs = [...all.filter(p => typeof p.blocking === 'string').map(p => [p.key, p.blocking]), ...all.filter(p => p.attacking && p.atkKey && !p.dying).map(p => [p.key, String(p.atkKey), 'atk'])]
  const sig = pairs.map(x => x.join('>')).join(','), num = combatPairs(s.sides.flatMap(k => s[k].perms))
  useLayoutEffect(() => {
    const root = ref.current?.parentElement
    if (!root || !sig) { setLs([]); return }
    const at = k => root.querySelector(`.pc[data-z="k:${k}"]`)?.getBoundingClientRect()
    const measure = () => { try { measure0() } catch (e) { console.warn('CombatLinks', e) } }
    const measure0 = () => {
      const r = root.getBoundingClientRect(), sc = r.width / (root.offsetWidth || r.width) || 1
      const pt = q => [(q.left + q.width / 2 - r.left) / sc + root.scrollLeft, (q.top + q.height / 2 - r.top) / sc + root.scrollTop]
      setLs(pairs.map(([b, a, atk]) => { const qb = at(b), qa = at(a); return qb?.width && qa?.width ? { b, atk, n: num.get(b), xy: [...pt(qb), ...pt(qa)] } : null }).filter(Boolean))
    }
    let raf, t0 = performance.now()
    const anim = () => { measure(); if (performance.now() - t0 < 900) raf = requestAnimationFrame(anim) }
    anim()
    const iv = setInterval(measure, 300)
    return () => { cancelAnimationFrame(raf); clearInterval(iv) }
  }, [sig])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg ref={ref} className="clinks" aria-hidden="true">
      {ls.map(({ b, n, atk, xy: [x1, y1, x2, y2] }) => atk
        ? <g key={`a${b}`} className="atk"><line x1={x1} y1={y1} x2={x2} y2={y2} /><circle cx={x2} cy={y2} r="9" /><text x={x2} y={y2 + 4}>⚔</text></g>
        : <g key={b} style={{ '--pair': PAIR[(n - 1) % PAIR.length] }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} /><circle cx={x1} cy={y1} r="5" /><circle cx={x2} cy={y2} r="5" /></g>)}
    </svg>
  )
}

// ---------- dano/vida/anular à vista: um projétil da carta de origem até quem o recebe e o «−N»/«+N» lá ----------
// hits = [{key (único), from: chave da carta, fromName (feitiço na pilha), to: {card} | {side} | {stack}, n, kind}]
// kind: 'cmb' combate (laranja), 'spl' feitiço/habilidade (vermelho), 'psn' veneno (roxo), 'gain' vida (verde),
// 'counter' feitiço anulado (azul/roxo: uma onda na pilha). Num jogador o número não salta aqui: o orbe já mostra a
// mudança (antes saíam dois «−2»). Sem a carta de origem em jogo (feitiço já no cemitério): sai da pilha ou do centro.
// a reação da esfera da vida a quem lhe bateu: a 1.ª palavra-chave que se vê (ordem = a que mais conta), feitiço = fogo
const ORB_KW = [['deathtouch', /\bDeathtouch\b/i], ['infect', /\bInfect\b/i], ['lifelink', /\bLifelink\b/i], ['trample', /\bTrample\b/i],
  ['double', /\bDouble strike\b/i], ['flying', /\bFlying\b/i], ['first', /\bFirst strike\b/i], ['menace', /\bMenace\b/i]]
// relâmpagos: o easter egg do Lightning Bolt (e das cartas iguais) — um raio em zigue-zague, clarão e um tremor forte
const ZAP = /\b(lightning|bolt|thunder|electr|shock|storm(?! crow)|zap|voltaic|galvanic|thunderbolt)/i
function quake(root, k) {  // translate: não mexe no transform (escala da mesa)
  root.animate([{ translate: '0 0' }, { translate: `${-k}px ${k / 2}px` }, { translate: `${k}px ${-k / 2}px` },
    { translate: `${-k / 2}px ${k / 3}px` }, { translate: `${k / 3}px 0` }, { translate: '0 0' }], { duration: 120 + 25 * k, easing: 'ease-out' })
}
function lightning(box, a, b, delay) {
  setTimeout(() => {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), n = 9, pts = []
    for (let i = 0; i <= n; i++) {
      const t = i / n, j = i && i < n ? (Math.random() - 0.5) * 46 : 0, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1
      pts.push(`${a[0] + dx * t - (dy / L) * j},${a[1] + dy * t + (dx / L) * j}`)
    }
    svg.setAttribute('class', 'dmgfx-zap')
    for (const c of ['glow', 'core']) { const pl = document.createElementNS(ns, 'polyline'); pl.setAttribute('points', pts.join(' ')); pl.setAttribute('class', c); svg.append(pl) }
    const flash = document.createElement('i'); flash.className = 'dmgfx-flash'
    box.append(svg, flash)
    setTimeout(() => { svg.remove(); flash.remove() }, 650)
  }, delay)
}
const KW_SFX = { zap: 'orbZap', flying: 'orbWind', fire: 'orbFire', trample: 'orbStomp', deathtouch: 'orbDark', infect: 'orbPoison', lifelink: 'orbGain', gain: 'orbGain' }
export function orbReact(orb, kind) {  // data-react na esfera durante 1,4 s (o CSS faz o resto)
  if (!orb || !kind) return
  orb.dataset.react = kind
  clearTimeout(orb._rt); orb._rt = setTimeout(() => { delete orb.dataset.react }, 1400)
}
export function DamageFx({ hits, data }) {
  const ref = useRef(null), done = useRef(new Set())
  useLayoutEffect(() => {
    const root = ref.current?.parentElement
    if (!root || !hits?.length || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    try { fire(root) } catch (e) { console.warn('DamageFx', e) }  // um efeito visual nunca deita a mesa abaixo
  }, [hits])  // eslint-disable-line react-hooks/exhaustive-deps
  function fire(root) {
    const r = root.getBoundingClientRect(), sc = r.width / (root.offsetWidth || r.width) || 1
    const at = el => { const q = (el?._proxy || el)?.getBoundingClientRect(); return q?.width ? [(q.left + q.width / 2 - r.left) / sc + root.scrollLeft, (q.top + q.height / 2 - r.top) / sc + root.scrollTop] : null }
    const mid = [root.clientWidth / 2 + root.scrollLeft, root.clientHeight / 2 + root.scrollTop]
    const stk = name => root.querySelector(name ? `.stk[data-z="n:${CSS.escape(name)}"]` : '.stackfx') || root.querySelector('.stackfx')
    const elOf = t => (t?.card != null ? root.querySelector(`.pc[data-z="k:${t.card}"]`) : t?.side ? root.querySelector(`.bside.p-${t.side} .orb`) : t?.stack ? stk(t.name) : null)
    let lag = 0
    hits.forEach(h => {
      if (done.current.has(h.key)) return
      done.current.add(h.key)
      const box = ref.current, kind = h.kind || 'spl'
      if (kind === 'counter') {  // anular: carimbo «ANULADO» por cima de tudo, ondas azul/roxas e faíscas onde está o feitiço
        const te = elOf(h.to), q = (te?._proxy || te)?.getBoundingClientRect(), rr = root.getBoundingClientRect()
        const sx = q?.width ? q.left + q.width / 2 : rr.left + rr.width / 2, sy = q?.width ? q.top + q.height / 2 : rr.top + rr.height / 2
        setTimeout(() => {
          const host = document.fullscreenElement || document.webkitFullscreenElement || document.body, fx = document.createElement('div')
          fx.className = 'counterfx'; Object.assign(fx.style, { left: `${sx}px`, top: `${sy}px` })
          fx.innerHTML = `<i class="cw"></i><i class="cw w2"></i><b>${tx('Anulado')}</b>${'<i class="cs"></i>'.repeat(12)}`
          fx.querySelectorAll('.cs').forEach((e, k) => { e.style.setProperty('--a', `${k * 30}deg`); e.style.setProperty('--d', `${40 + (k % 3) * 18}px`) })
          host.append(fx); setTimeout(() => fx.remove(), 1700)
          play('countered')
        }, lag); lag += 150
        return
      }
      const b = at(elOf(h.to))
      if (!b) return
      const a = at(h.from != null && root.querySelector(`.pc[data-z="k:${h.from}"]`)) || at(stk(h.fromName)) || mid
      const bolt = document.createElement('i'), pop = document.createElement('b')
      // feitiços vermelhos de dano: o projétil é fogo; os relâmpagos (Lightning Bolt e companhia) têm o raio a sério
      const src = kind === 'spl' && data && h.fromName ? lookup(data, h.fromName) : null
      const zap = src && ZAP.test(h.fromName), fire = src && !zap && /R/.test(String(src.co ?? src.ci ?? ''))
      pop.className = `dmgfx-pop ${kind}`; pop.textContent = `${kind === 'gain' ? '+' : kind === 'psn' ? '☠' : '−'}${h.n}`
      Object.assign(pop.style, { left: `${b[0]}px`, top: `${b[1]}px` })
      const arrive = big => {  // chegou: o número na carta, ou a esfera da vida reage; e a mesa treme
        if (!h.to.side) {
          box.append(pop); setTimeout(() => pop.remove(), 1100)
          if (kind === 'cmb' || kind === 'spl') {  // numa criatura (ou planeswalker): o mesmo estilo de golpe de quem bateu, mais pequeno, na carta
            const se = h.from != null && root.querySelector(`.pc[data-z="k:${h.from}"]`), nm = h.fromName || se?.querySelector('img')?.alt
            const o = (data && nm && lookup(data, nm)?.o) || '', kw = zap ? 'zap' : ORB_KW.find(([, re]) => re.test(o))?.[0] || (kind === 'spl' ? 'fire' : 'hit')
            const seed = `${h.key}|${nm}|${h.n}|c`, st = attackStyle(nm && lookup(data, nm), kind, kw, seed), ce = elOf(h.to)
            if (st && ce) attackFx(ce, st, b[0] - a[0], b[1] - a[1], seed, true)
            if (/\bDeathtouch\b/.test(o)) { const m = document.createElement('i'); m.className = 'dtmark'; m.textContent = '☠'; Object.assign(m.style, { left: `${b[0]}px`, top: `${b[1]}px` }); box.append(m); setTimeout(() => m.remove(), 1500) }
          }
        }
        else {  // a esfera reage a quem bateu (palavra-chave; feitiço = fogo; relâmpago = raio; vida = luz; veneno = fumo roxo)
          const se = h.from != null && root.querySelector(`.pc[data-z="k:${h.from}"]`), nm = h.fromName || se?.querySelector('img')?.alt
          const o = (data && nm && lookup(data, nm)?.o) || ''
          const kw = kind === 'gain' ? 'gain' : kind === 'psn' ? 'infect' : zap ? 'zap' : ORB_KW.find(([, re]) => re.test(o))?.[0] || (kind === 'spl' ? 'fire' : 'hit')
          const orb = elOf(h.to), at2 = at(orb) || b, L = Math.hypot(at2[0] - a[0], at2[1] - a[1]) || 1
          orbReact(orb, kw)
          // a cor de quem bateu (ou curou) entra no líquido e dilui-se devagar; nos dois sentidos, em todas as esferas
          if (data && nm) orb?._inject?.(lookup(data, nm)?.co || lookup(data, nm)?.ci || '', h.n, [at2[0] - a[0], at2[1] - a[1]])
          // às vezes (ao acaso) o golpe vem à maneira de quem bateu: garras, espadas, flechas, dentadas, raio com trovão, fogo,
          // gelo, folhas, metal, gosma… com som e efeito na esfera (rachar, partir, verter, apodrecer, espinhos) — orbfx.js
          const seed = `${h.key}|${nm}|${h.n}`  // o mesmo golpe → o mesmo estilo e as mesmas peças em todos os ecrãs
          const st = kind !== 'gain' && attackStyle(nm && lookup(data, nm), kind, kw, seed)
          if (st) attackFx(orb, st, at2[0] - a[0], at2[1] - a[1], seed)
          else play(KW_SFX[kw] || (kind === 'gain' ? 'orbGain' : kind === 'psn' ? 'orbPoison' : 'orbHit'), { amount: h.n })  // o vidro soa à maneira de quem bateu
          // o golpe empurra a esfera na direção em que veio (a vida ganha faz só um saltinho para cima)
          const f = kind === 'gain' ? 0 : Math.min(900, 220 + 60 * h.n)
          orb?._kick?.(((at2[0] - a[0]) / L) * f, kind === 'gain' ? -260 : ((at2[1] - a[1]) / L) * f)
        }
        if (kind !== 'gain') quake(root, big || Math.min(8, 2 + h.n))
      }
      if (zap) { lightning(box, a, b, lag); setTimeout(() => arrive(13), lag + 230); lag += 160; return }
      bolt.className = `dmgfx-bolt ${kind} ${fire ? 'fire' : ''}`
      Object.assign(bolt.style, { left: `${a[0]}px`, top: `${a[1]}px`, opacity: 0 })
      box.append(bolt)
      // voa até onde o alvo ESTÁ a cada frame (a esfera pode estar a ser arrastada ou a voltar ao sítio)
      const t0 = performance.now() + lag, dur = 460, tgt = elOf(h.to)
      const fly = now => {
        const k = (now - t0) / dur
        if (k >= 0) {
          const bb = at(tgt) || b, e = Math.min(1, k) ** 2  // acelera até bater
          Object.assign(bolt.style, { left: `${a[0] + (bb[0] - a[0]) * e}px`, top: `${a[1] + (bb[1] - a[1]) * e}px`, opacity: Math.min(1, k * 6), transform: `translate(-50%, -50%) scale(${0.6 + 0.55 * e})` })
          if (k >= 1) { bolt.remove(); Object.assign(pop.style, { left: `${bb[0]}px`, top: `${bb[1]}px` }); arrive(); return }
        }
        requestAnimationFrame(fly)
      }
      requestAnimationFrame(fly)
      lag += 120
    })
    if (done.current.size > 400) done.current = new Set([...done.current].slice(-200))
  }
  return <div ref={ref} className="dmgfx" aria-hidden="true" />
}

// ---------- cartas entre zonas e morte à vista ----------
// ZoneFx compara as zonas de cada lado de um estado para o seguinte e faz voar as cartas pelo caminho certo: moer
// (biblioteca → cemitério: viram-se e caem com pó), exilar do topo ou do cemitério (luz branca), descartar (vermelho),
// comprar (um verso rápido para a mão), recuperar do cemitério (verde). As permanentes que morrem ou são destruídas
// (dying → cemitério) estilhaçam-se em pedaços que caem com gravidade; uma criatura solta a alma, que sobe.
// Tudo em camadas fixas por cima da página (ou do ecrã inteiro): funciona com a mesa escalada.
const ZROUTES = [['library', 'graveyard', 'mill'], ['library', 'exile', 'exile'], ['library', 'hand', 'draw'], ['hand', 'graveyard', 'discard'],
  ['graveyard', 'exile', 'exile'], ['graveyard', 'hand', 'regrow'], ['graveyard', 'library', 'tuck'], ['hand', 'library', 'tuck'], ['hand', 'exile', 'exile'], ['exile', 'hand', 'regrow']]
const fxHost = () => document.fullscreenElement || document.webkitFullscreenElement || document.body
function zoneEl(k, zone) {
  const side = document.querySelector(`.bside.p-${k}`)
  if (!side) return null
  if (zone === 'hand') return side.querySelector('.fp-hand, .myhand') || side.querySelector('.orb')
  return side.querySelector(`[data-zone="${zone}"]`)
}
function zoneFly(k, from, to, n, kind, names, data) {
  const A = zoneEl(k, from), B = zoneEl(k, to)
  if (!A || !B) return
  const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect()
  if (!ra.width || !rb.width) return
  // para a mão (comprar, mulligan): a carta voa DENTRO da mesa, à frente do baralho e atrás da mão (a mão está por cima);
  // as outras voam numa camada por cima de tudo
  const inner = to === 'hand' && B.closest('.table, .fp-table')
  const host = inner || fxHost(), hr = inner ? inner.getBoundingClientRect() : null, zs = inner ? (hr.width / (inner.offsetWidth || hr.width) || 1) : 1
  const L = (x, y) => (inner ? [(x - hr.left) / zs, (y - hr.top) / zs] : [x, y])
  const N = Math.min(n, 8), w = Math.max(30, Math.min(64, (to === 'hand' ? ra.width : rb.width) || 40)) / zs, h = w * 1.4
  const [ax, ay] = L(ra.left + ra.width / 2, ra.top + ra.height / 2), [bx, by] = L(rb.left + rb.width / 2, rb.top + rb.height / 2), dx = bx - ax, dy = by - ay
  const dur = kind === 'draw' ? 480 : 820, lift = -50 - Math.min(90, Math.abs(dx) * 0.2)
  for (let i = 0; i < N; i++) {
    setTimeout(() => {
      const d = document.createElement('div'), nm = names?.[names.length - N + i], c = nm && lookup(data, nm)
      d.className = `zfly ${kind} ${inner ? 'inner' : ''}`
      d.innerHTML = '<i class="zf-back"></i>'
      if (c && (to === 'graveyard' || to === 'exile')) { const im = document.createElement('img'); im.src = img(c, 'small'); im.alt = ''; d.append(im) }
      d.style.setProperty('--d', `${dur}ms`)
      Object.assign(d.style, { left: `${ax - w / 2}px`, top: `${ay - h / 2}px`, width: `${w}px`, height: `${h}px` })
      host.append(d)
      const spin = kind === 'mill' ? 360 : kind === 'draw' ? 0 : 20
      d.animate([{ transform: 'translate(0, 0) rotate(0deg) scale(.85)', opacity: 0 }, { opacity: 1, offset: 0.1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 + lift}px) rotate(${spin / 2}deg) scale(1.08)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(.82)`, opacity: 1, offset: 0.9 },
        { transform: `translate(${dx}px, ${dy + 6}px) rotate(${spin}deg) scale(.7)`, opacity: 0 }], { duration: dur, easing: 'cubic-bezier(.45, .05, .55, .95)' }).onfinish = () => d.remove()
    }, i * (kind === 'draw' ? 90 : 130))
  }
  const end = (N - 1) * (kind === 'draw' ? 90 : 130) + dur * 0.9
  setTimeout(() => {
    B.classList.remove('zf-hit'); void B.offsetWidth; B.classList.add('zf-hit'); setTimeout(() => B.classList.remove('zf-hit'), 650)
    if (kind !== 'mill' && kind !== 'exile') return
    const p = document.createElement('b'), q = B.getBoundingClientRect()
    p.className = `zf-pop ${kind}`; p.textContent = kind === 'mill' ? `${tx('Moer')} ${n}` : `⌀ ${n}`
    Object.assign(p.style, { left: `${q.left + q.width / 2}px`, top: `${q.top}px` })
    fxHost().append(p); setTimeout(() => p.remove(), 1300)
  }, end)
}
// estilhaçar: rachas por um instante e depois ~24 pedaços triangulares da carta a saltar e a cair; criatura → a alma sobe
function shatter(el, creature) {
  const rot = el.querySelector('.pc-rot') || el, r = rot.getBoundingClientRect()
  if (!r.width) return
  const src = el.querySelector('.pc-f img')?.src, tapped = el.classList.contains('tapped'), host = fxHost()
  const W = tapped ? r.height : r.width, H = tapped ? r.width : r.height
  const box = document.createElement('div')
  box.className = 'zshatter'
  Object.assign(box.style, { left: `${r.left + r.width / 2 - W / 2}px`, top: `${r.top + r.height / 2 - H / 2}px`, width: `${W}px`, height: `${H}px`, transform: tapped ? 'rotate(90deg)' : '' })
  const crack = document.createElement('i'); crack.className = 'zcrack'; box.append(crack)
  const C = 3, R = 4, j = () => (Math.random() - 0.5) * 14
  const P = Array.from({ length: C + 1 }, (_, x) => Array.from({ length: R + 1 }, (_, y) => [x * 100 / C + (x && x < C ? j() : 0), y * 100 / R + (y && y < R ? j() : 0)]))
  const tris = []
  for (let x = 0; x < C; x++) for (let y = 0; y < R; y++) {
    const a = P[x][y], b = P[x + 1][y], c = P[x + 1][y + 1], d = P[x][y + 1]
    tris.push([a, b, c], [a, c, d])
  }
  for (const t of tris) {
    const pc = document.createElement('i'), cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3
    pc.className = 'zpiece'
    pc.style.clipPath = `polygon(${t.map(p => `${p[0].toFixed(1)}% ${p[1].toFixed(1)}%`).join(',')})`
    if (src) pc.style.backgroundImage = `url("${src}")`
    box.append(pc)
    const vx = (cx - 50) * (1.6 + Math.random()) + (Math.random() - 0.5) * 30, vy = (cy - 40) * 1.2 - 60 - Math.random() * 40, g = 260 + Math.random() * 80, spin = (Math.random() - 0.5) * 420
    const rx = (Math.random() - 0.5) * 540, ry = (Math.random() - 0.5) * 540
    const at = k => `translate3d(${(vx * k).toFixed(1)}px, ${(vy * k + g * k * k).toFixed(1)}px, ${(30 * k).toFixed(0)}px) rotateX(${(rx * k).toFixed(0)}deg) rotateY(${(ry * k).toFixed(0)}deg) rotateZ(${(spin * k).toFixed(0)}deg)`
    pc.animate([{ transform: 'none', opacity: 1 }, { transform: at(0.35), opacity: 1, offset: 0.3 }, { transform: at(0.7), opacity: 0.85, offset: 0.65 }, { transform: at(1), opacity: 0 }],
      { duration: 1250 + Math.random() * 450, delay: 300, easing: 'linear', fill: 'both' })
  }
  if (creature) {  // a alma sobe
    const s = document.createElement('i'); s.className = 'zsoul'; box.append(s)
  }
  for (let i = 0; i < 10; i++) {  // pó
    const d = document.createElement('i'); d.className = 'zdust'
    Object.assign(d.style, { left: `${20 + Math.random() * 60}%`, top: `${30 + Math.random() * 50}%` })
    box.append(d)
    d.animate([{ transform: 'translate(0, 0) scale(.6)', opacity: 0.9 }, { transform: `translate(${(Math.random() - 0.5) * 70}px, ${-20 - Math.random() * 40}px) scale(1.6)`, opacity: 0 }],
      { duration: 800 + Math.random() * 500, delay: 120 + Math.random() * 150, easing: 'ease-out', fill: 'both' })
  }
  box.style.visibility = 'hidden'; host.append(box)
  el.classList.add('pre-shatter')  // um instante a tremer e a avermelhar, depois desfaz-se
  setTimeout(() => { el.style.visibility = 'hidden'; box.style.visibility = '' }, 170)
  setTimeout(() => box.remove(), 2000)
}
// uma permanente que resolveu: a carta da pilha voa até onde ela entrou (antes ficava na pilha a desvanecer enquanto a
// permanente já tinha aparecido do outro lado: pareciam duas)
function stackToField(name) {
  const from = [...document.querySelectorAll('.stackfx .stk.resolving')].pop(), sn = short(name)
  const to = [...document.querySelectorAll('.bside .pc.in')].reverse().find(e => e.querySelector('.pc-f img')?.alt === sn || e.title?.split('\n')[0] === sn)
  if (!from || !to) return
  const a = from.getBoundingClientRect(), rot = to.querySelector('.pc-rot') || to, b = rot.getBoundingClientRect()
  if (!a.width || !b.width) return
  const g = document.createElement('div'), src = from.querySelector('img')?.src || to.querySelector('.pc-f img')?.src
  g.className = 'zghost fly'
  Object.assign(g.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` })
  if (src) g.style.backgroundImage = `url("${src}")`
  fxHost().append(g)
  // a carta da pilha manda: se o FLIP (do sítio onde a largaste) estiver a correr, pára
  clearTimeout(to._flipT); to.classList.remove('flipping'); to.style.transition = 'none'; to.style.transform = ''; to.style.zIndex = ''
  from.classList.add('flown'); to.style.visibility = 'hidden'
  const an = g.animate([{ transform: 'none' }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${b.height / a.height})` }],
    { duration: 420, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'forwards' })
  g.style.transformOrigin = '0 0'
  const done = () => { to.style.visibility = ''; g.remove() }
  an.onfinish = done; setTimeout(done, 900)
}
// exilada por uma permanente que a guarda (Journey to Nowhere, Oblivion Ring, Banishing Light, Sheltered by Ghosts,
// Fiend Hunter…): em vez de se desfazer em luz, a carta sobe, brilha e é sugada para dentro de quem a exilou, com um feixe
const HOLDS = /When [^.]*enters[^.]*?,? (?:you may )?exile (?:another |up to one )?target/i
function ghostInto(el, holder) {
  const rot = el.querySelector('.pc-rot') || el, r = rot.getBoundingClientRect()
  if (!r.width) return false
  const src = el.querySelector('.pc-f img')?.src, g = document.createElement('div'), host = fxHost()
  g.className = 'zghost into'
  Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, transformOrigin: '50% 50%' })
  if (src) g.style.backgroundImage = `url("${src}")`
  host.append(g); el.style.visibility = 'hidden'
  const go = n => {  // espera que quem a guarda já esteja no sítio (pode vir a voar da pilha: fica escondida até chegar)
    if (n < 16 && (holder.style.visibility === 'hidden' || document.querySelector('.zghost.fly'))) return setTimeout(() => go(n + 1), 90)
    const h = (holder.querySelector('.pc-rot') || holder).getBoundingClientRect()
    const dx = h.left + h.width / 2 - (r.left + r.width / 2), dy = h.top + h.height / 2 - (r.top + r.height / 2)
    const beam = document.createElement('i'), L = Math.hypot(dx, dy)
    beam.className = 'zbeam'
    Object.assign(beam.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px`, width: `${L}px`, rotate: `${Math.atan2(dy, dx)}rad` })
    host.append(beam); setTimeout(() => beam.remove(), 900)
    g.animate([{ transform: 'translateY(-14px) scale(1.06)', opacity: 1, filter: 'brightness(1.8)' },
      { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(200deg)`, opacity: 0.2, filter: 'brightness(2.6) blur(1px)' }],
      { duration: 650, easing: 'cubic-bezier(.6, 0, .9, .5)', fill: 'forwards' }).onfinish = () => g.remove()
    setTimeout(() => g.remove(), 1200)
    holder.classList.remove('holds'); void holder.offsetWidth; holder.classList.add('holds'); setTimeout(() => holder.classList.remove('holds'), 1400)
  }
  setTimeout(() => go(0), 900)
  return true
}
// terrenos com animação própria: fetch (sacrifica-se e procura), shock (paga 2 de vida para entrar desvirado) e fast
// (desvirado com poucos terrenos) — nas cores do terreno (as fetch pelas cores das terras que procuram)
const LCOL = { W: '#f5c451', U: '#4cc9f0', B: '#a78bfa', R: '#ff5c3a', G: '#4ade80', C: '#cbd5e1' }
const BASIC = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }
const FETCH = /Sacrifice (?:this land|~|[^:]{0,40}): Search your library for (an? [^.]*?) card/i
const SHOCK = /you may pay 2 life\. If you don't, it enters tapped/i, FAST = /enters tapped unless you control two or fewer other lands/i
const landCols = c => {
  const f = FETCH.exec(c?.o || '')
  if (f) { const cs = Object.entries(BASIC).filter(([n]) => f[1].includes(n)).map(([, k]) => k); return cs.length ? cs : ['W', 'U', 'B', 'R', 'G'] }
  const cs = String(c?.ci || '').replace(/[^WUBRG]/g, '').split('').filter(Boolean)
  return cs.length ? cs : ['C']
}
// fitas de luz nas cores, de um retângulo a outro, em arco
function ribbon(a, b, cols, delay = 0, N = 16) {
  if (!a?.width || !b?.width) return
  const host = fxHost(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, bx = b.left + b.width / 2, by = b.top + b.height / 2, my = Math.min(ay, by) - 70
  for (let i = 0; i < N; i++) {
    const d = document.createElement('i'), col = LCOL[cols[i % cols.length]]
    d.className = 'zrib'; Object.assign(d.style, { left: `${ax}px`, top: `${ay}px`, background: col, boxShadow: `0 0 10px ${col}` })
    host.append(d)
    d.animate([{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 }, { transform: `translate(calc(-50% + ${(bx - ax) / 2}px), calc(-50% + ${my - ay}px)) scale(1.1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(calc(-50% + ${bx - ax}px), calc(-50% + ${by - ay}px)) scale(.5)`, opacity: 0 }],
      { duration: 760, delay: delay + i * 32, easing: 'ease-in-out', fill: 'both' }).onfinish = () => d.remove()
  }
}
// a camada por cima da carta do terreno: relâmpagos (shock) ou rasto de velocidade (fast)
// shock land a entrar desvirada: a vida paga (uma faísca vermelha) sai da esfera até ao terreno; depois relâmpagos vivos
// (refazem-se a cada instante) a correr pela borda e para dentro, nas duas cores, um clarão e o terreno estremece
function shockFx(el, cols, orbEl) {
  const rot = el.querySelector('.pc-rot') || el, r = rot.getBoundingClientRect()
  if (!r.width) return
  const host = fxHost(), c1 = LCOL[cols[0]], c2 = LCOL[cols[1] || cols[0]], cx = r.left + r.width / 2, cy = r.top + r.height / 2
  const o = orbEl?.getBoundingClientRect(), lag = o?.width ? 380 : 0
  if (o?.width) {  // a vida que se paga
    const w = document.createElement('i'); w.className = 'zwisp'; Object.assign(w.style, { left: `${o.left + o.width / 2}px`, top: `${o.top + o.height / 2}px` }); host.append(w)
    w.animate([{ transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 }, { transform: `translate(calc(-50% + ${(cx - o.left - o.width / 2) * 0.5}px), calc(-50% + ${(cy - o.top - o.height / 2) * 0.5 - 50}px)) scale(1.2)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${cx - o.left - o.width / 2}px), calc(-50% + ${cy - o.top - o.height / 2}px)) scale(.4)`, opacity: 0.9 }], { duration: lag, easing: 'ease-in', fill: 'forwards' }).onfinish = () => w.remove()
  }
  setTimeout(() => {
    const W = r.width, H = r.height, g = document.createElement('div'), NS = 'http://www.w3.org/2000/svg'
    g.className = 'zland shock2'; Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${W}px`, height: `${H}px` })
    g.style.setProperty('--c1', c1); g.style.setProperty('--c2', c2)
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H)
    const rim = (cls, off) => { const p = document.createElementNS(NS, 'rect'); Object.entries({ x: 1.5, y: 1.5, width: W - 3, height: H - 3, rx: W * 0.05, class: cls, 'stroke-dashoffset': off }).forEach(([k, v]) => p.setAttribute(k, v)); svg.append(p) }
    rim('rim a', 0); rim('rim b', (W + H))
    const bolts = Array.from({ length: 5 }, (_, k) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', k % 2 ? 'bolt b' : 'bolt'); svg.append(p); return p })
    const edge = () => { const t = Math.random() * 2 * (W + H); return t < W ? [t, 0] : t < W + H ? [W, t - W] : t < 2 * W + H ? [2 * W + H - t, H] : [0, 2 * (W + H) - t] }
    const zig = () => { const [x0, y0] = edge(), x1 = W * (0.25 + Math.random() * 0.5), y1 = H * (0.25 + Math.random() * 0.5); let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`
      for (let i = 1; i <= 6; i++) { const t = i / 6, j = (1 - t) * 9; d += ` L${(x0 + (x1 - x0) * t + (Math.random() - 0.5) * j * 2).toFixed(1)} ${(y0 + (y1 - y0) * t + (Math.random() - 0.5) * j * 2).toFixed(1)}` } return d }
    g.append(svg); host.append(g)
    let n = 0
    const iv = setInterval(() => { bolts.forEach(b => b.setAttribute('d', Math.random() < 0.75 ? zig() : '')); if (++n > 11) clearInterval(iv) }, 65)
    rot.animate([{ translate: '0 0', filter: 'none' }, { translate: '-2px 1px', filter: `brightness(1.8) drop-shadow(0 0 8px ${c1})` }, { translate: '2px -1px' }, { translate: '-1px 0', filter: `brightness(1.4) drop-shadow(0 0 6px ${c2})` }, { translate: '0 0', filter: 'none' }], { duration: 520, easing: 'linear' })
    setTimeout(() => { clearInterval(iv); g.remove() }, 1150)
  }, lag)
}
// fetch land sacrificada: abre-se um vórtice nas cores que procura, a carta é sugada para ele em espiral e um feixe vai até
// à biblioteca, que brilha (à procura)
function fetchFx(el, cols, lib) {
  const rot = el.querySelector('.pc-rot') || el, r = rot.getBoundingClientRect()
  if (!r.width) return
  const host = fxHost(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, src = el.querySelector('.pc-f img')?.src, tapped = el.classList.contains('tapped')
  const v = document.createElement('div'), D = Math.max(r.width, r.height) * 1.25
  v.className = 'zvortex'; Object.assign(v.style, { left: `${cx - D / 2}px`, top: `${cy - D / 2}px`, width: `${D}px`, height: `${D}px` })
  v.style.setProperty('--vc', cols.map(c => LCOL[c]).concat(LCOL[cols[0]]).join(', '))
  host.append(v); setTimeout(() => v.remove(), 1300)
  const W = tapped ? r.height : r.width, H = W * 680 / 488, g = document.createElement('div')
  g.className = 'zghost'; Object.assign(g.style, { left: `${cx - W / 2}px`, top: `${cy - H / 2}px`, width: `${W}px`, height: `${H}px`, rotate: tapped ? '90deg' : '0deg' })
  if (src) g.style.backgroundImage = `url("${src}")`
  host.append(g); el.style.visibility = 'hidden'
  g.animate([{ transform: 'none', opacity: 1, filter: 'none' }, { transform: 'rotate(160deg) scale(.7)', opacity: 1, filter: 'brightness(1.6)', offset: 0.4 },
    { transform: 'rotate(560deg) scale(.04)', opacity: 0, filter: 'brightness(3)' }], { duration: 760, easing: 'cubic-bezier(.5, 0, .9, .6)', fill: 'forwards' }).onfinish = () => g.remove()
  setTimeout(() => {
    const L = lib?.getBoundingClientRect()
    if (!L?.width) return
    ribbon({ left: cx - 4, top: cy - 4, width: 8, height: 8 }, L, cols, 0, 26)
    lib.classList.remove('zlibglow'); void lib.offsetWidth; lib.classList.add('zlibglow'); setTimeout(() => lib.classList.remove('zlibglow'), 1500)
  }, 520)
}
// o terreno que a fetch foi buscar: a carta voa da biblioteca até ao sítio dela com rasto e aterra com uma onda
function fetchedFly(el, lib, cols) {
  const rot = el.querySelector('.pc-rot') || el, b = rot.getBoundingClientRect(), a = lib?.getBoundingClientRect()
  if (!b.width || !a?.width) return
  const g = document.createElement('div'), src = el.querySelector('.pc-f img')?.src, host = fxHost()
  g.className = 'zghost fly fetchfly'; Object.assign(g.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${b.width}px`, height: `${b.height}px` })
  g.style.setProperty('--c1', LCOL[cols[0]]); g.style.setProperty('--c2', LCOL[cols[1] || cols[0]])
  if (src) g.style.backgroundImage = `url("${src}")`
  host.append(g); el.style.visibility = 'hidden'
  const mx = (b.left - a.left) / 2, my = Math.min(0, b.top - a.top) - 80
  g.animate([{ transform: 'scale(.6) rotateY(180deg)' }, { transform: `translate(${mx}px, ${my}px) scale(1.15) rotateY(90deg)`, offset: 0.5 }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(1) rotateY(0deg)` }],
    { duration: 620, easing: 'cubic-bezier(.4, 0, .3, 1)', fill: 'forwards' }).onfinish = () => {
    g.remove(); el.style.visibility = ''
    const w = document.createElement('i'); w.className = 'zring'; Object.assign(w.style, { left: `${b.left + b.width / 2}px`, top: `${b.top + b.height / 2}px` }); w.style.setProperty('--c1', LCOL[cols[0]])
    host.append(w); setTimeout(() => w.remove(), 800)
  }
  setTimeout(() => { if (g.isConnected) { g.remove(); el.style.visibility = '' } }, 1400)
}
// mana: um terreno (ou outra fonte) que vira para dar mana solta uma mini-esfera da cor dela, que voa para o feitiço na pilha
function manaFly(el, cols, k, delay) {
  const r = (el.querySelector('.pc-rot') || el).getBoundingClientRect()
  if (!r.width) return
  const t = document.querySelector('.stackfx .stk.top') || document.querySelector(`.bside.p-${k} .orb:not(.orb-proxy)`), q = t?.getBoundingClientRect()
  if (!q?.width) return
  const host = fxHost(), x0 = r.left + r.width / 2, y0 = r.top + r.height / 2
  const orb = t.classList.contains('orb') ? t : null
  cols.slice(0, 2).forEach((c, i) => {
    const m = document.createElement('i'); m.className = 'zmana'; m.style.setProperty('--c', LCOL[c]); Object.assign(m.style, { left: `${x0}px`, top: `${y0}px`, opacity: 0 })
    host.append(m)
    // salta do terreno para cima e é puxada para o destino por uma mola com amortecimento (passa um pouco e volta)
    let x = x0, y = y0, vx = (Math.random() - 0.5) * 240 + (i ? 70 : -70), vy = -360 - Math.random() * 160, t0 = null, last = 0
    const step = now => {
      if (!m.isConnected) return
      if (t0 == null) { t0 = last = now }
      const dt = Math.min(0.033, (now - last) / 1000), age = (now - t0) / 1000; last = now
      const qq = t.isConnected ? t.getBoundingClientRect() : q, tx = qq.left + qq.width / 2, ty = qq.top + qq.height / 2, dx = tx - x, dy = ty - y
      const pull = Math.min(1, age / 0.35) * 46, damp = 2.5 + 7 * Math.min(1, age / 0.6)
      vx += (dx * pull - vx * damp) * dt; vy += (dy * pull - vy * damp + 900 * Math.max(0, 1 - age / 0.3)) * dt
      x += vx * dt; y += vy * dt
      const sp = Math.hypot(vx, vy), sc = 0.5 + Math.min(0.7, age * 3) - Math.max(0, age - 0.6) * 0.4
      m.style.opacity = Math.min(1, age * 6); m.style.transform = `translate(${x - x0}px, ${y - y0}px) translate(-50%, -50%) rotate(${Math.atan2(vy, vx)}rad) scale(${Math.max(0.3, sc) * (1 + Math.min(0.6, sp / 2000))}, ${Math.max(0.3, sc)})`
      if (Math.hypot(dx, dy) < Math.max(10, qq.width * 0.22) || age > 2.4) { m.remove(); if (orb?._mana) orb._mana(c, [x0 - tx, y0 - ty]); return }
      requestAnimationFrame(step)
    }
    setTimeout(() => requestAnimationFrame(step), delay + i * 90)
  })
}
function landFx(el, kind, cols) {
  const r = (el.querySelector('.pc-rot') || el).getBoundingClientRect()
  if (!r.width) return
  const g = document.createElement('div')
  g.className = `zland ${kind}`
  Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  g.style.setProperty('--c1', LCOL[cols[0]]); g.style.setProperty('--c2', LCOL[cols[1] || cols[0]])
  if (kind === 'shock') g.innerHTML = '<svg viewBox="0 0 100 140" preserveAspectRatio="none"><path d="M-4 30 L18 44 L8 58 L34 70 L22 86 L52 96" /><path class="b" d="M104 104 L80 92 L92 78 L66 66 L80 50 L50 40" /></svg>'
  fxHost().append(g); setTimeout(() => g.remove(), 1100)
}
// exilada: a carta desintegra-se em pedacinhos de luz que se soltam de cima para baixo e sobem a desvanecer
// (antes era a carta inteira a crescer e a desfocar, e a cópia esticava a imagem)
function exileDissolve(el) {
  const rot = el.querySelector('.pc-rot') || el, r = rot.getBoundingClientRect()
  if (!r.width) return
  const tapped = el.classList.contains('tapped'), src = el.querySelector('.pc-f img')?.src, host = fxHost()
  const W = tapped ? r.height : r.width, H = W * 680 / 488  // as proporções da carta, sempre
  const box = document.createElement('div')
  box.className = 'zdust-card'
  Object.assign(box.style, { left: `${r.left + r.width / 2 - W / 2}px`, top: `${r.top + r.height / 2 - H / 2}px`, width: `${W}px`, height: `${H}px`, rotate: tapped ? '90deg' : '0deg' })
  const C = 6, Rr = 8, tw = W / C, th = H / Rr
  for (let y = 0; y < Rr; y++) for (let x = 0; x < C; x++) {
    const t = document.createElement('i')
    Object.assign(t.style, { left: `${x * tw}px`, top: `${y * th}px`, width: `${tw + 0.5}px`, height: `${th + 0.5}px`, backgroundSize: `${W}px ${H}px`, backgroundPosition: `${-x * tw}px ${-y * th}px` })
    if (src) t.style.backgroundImage = `url("${src}")`
    box.append(t)
    const dx = (Math.random() - 0.5) * 50 + (x - C / 2) * 6, dy = -(50 + Math.random() * 70), rz = (Math.random() - 0.5) * 160
    t.animate([{ transform: 'none', opacity: 1, filter: 'none' }, { transform: 'none', opacity: 1, filter: 'brightness(2.2) saturate(.3)', offset: 0.25 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${rz}deg) scale(.25)`, opacity: 0, filter: 'brightness(3) saturate(0) blur(1px)' }],
      { duration: 900 + Math.random() * 500, delay: y * 55 + Math.random() * 120, easing: 'cubic-bezier(.3, 0, .6, 1)', fill: 'both' })
  }
  host.append(box); el.style.visibility = 'hidden'
  setTimeout(() => box.remove(), 2100)
}
// um dado a rolar por cima de uma carta da mesa: o toque (como a esfera da vida faz)
const dieBumped = new WeakMap()
if (typeof window !== 'undefined') addEventListener('grim-die', e => {
  const d = e.detail, pc = d && document.elementsFromPoint(d.x, d.y).find(x => x.matches?.('.pc[data-z^="k:"]'))?.closest('.pc')
  if (!pc || performance.now() - (dieBumped.get(pc) || 0) < 600) return
  dieBumped.set(pc, performance.now()); pc.classList.remove('orb-bump'); void pc.offsetWidth; pc.classList.add('orb-bump'); setTimeout(() => pc.classList.remove('orb-bump'), 650)
})
function ghostOut(el, to) {  // ver leaveGhost
  leaveGhost((el.querySelector('.pc-rot') || el).getBoundingClientRect(), el.querySelector('.pc-f img')?.src, el.classList.contains('tapped'), to)
  el.style.visibility = 'hidden'
}
// exilada: faíscas brancas a subir enquanto ela se desfaz em luz (o CSS faz o resto)
function sparkle(el) {
  const r = el.getBoundingClientRect(), host = fxHost()
  if (!r.width) return
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('i'); d.className = 'zspark'
    Object.assign(d.style, { left: `${r.left + Math.random() * r.width}px`, top: `${r.top + r.height * (0.3 + Math.random() * 0.7)}px` })
    host.append(d)
    d.animate([{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: `translate(-50%, ${-60 - Math.random() * 60}px) scale(.2)`, opacity: 0 }],
      { duration: 700 + Math.random() * 500, delay: Math.random() * 300, easing: 'ease-out', fill: 'both' }).onfinish = () => d.remove()
  }
}
export function ZoneFx({ s, data, quiet }) {
  const prev = useRef(null), seen = useRef(new Set()), keys = useRef(null), fetching = useRef({}), taps = useRef(new Map())  // fetching: lado -> {cols, t} (uma fetch à procura)
  useLayoutEffect(() => {
    if (!s?.sides) return
    const snap = {}
    for (const k of s.sides) {
      const z = s[k]
      if (z) snap[k] = { lib: Number.isFinite(z.library) ? z.library : null, hand: Number.isFinite(z.hand) ? z.hand : null, gy: [...(z.graveyard || [])], ex: [...(z.exile || [])], cmd: Object.fromEntries((z.command || []).map(c => [c.name, !!c.out])) }
    }
    const p = prev.current
    prev.current = snap
    const calm = quiet || !p || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // quando entrou cada permanente: quem exilou pode ter aparecido um desenho antes da carta exilada sair (Forge Play)
    const first = keys.current || new Map(), tnow = Date.now(), boot = !keys.current, live = s.sides.flatMap(k => (s[k]?.perms || []).filter(p => !p.dying))
    for (const p of live) if (!first.has(p.key)) first.set(p.key, boot ? 0 : tnow)
    for (const k of first.keys()) if (!live.some(p => p.key === k)) first.delete(k)
    keys.current = first
    const holder = live.find(p => tnow - first.get(p.key) < 2000 && HOLDS.test(lookup(data, p.name)?.o || ''))
    const tapsPrev = taps.current
    taps.current = new Map(live.map(p => [p.key, !!p.tapped]))
    const entered = boot ? [] : s.sides.flatMap(k => (s[k]?.perms || []).filter(p => !p.dying && first.get(p.key) === tnow).map(p => [k, p]))
    try {
      const deadTo = {}
      for (const k of s.sides) for (const perm of s[k]?.perms || []) {
        if (!perm.dying || seen.current.has(perm.key)) continue
        seen.current.add(perm.key)
        const to = typeof perm.dying === 'string' ? perm.dying : 'graveyard'
        if (!perm.token) deadTo[`${k}|${to}`] = (deadTo[`${k}|${to}`] || 0) + 1
        if (calm) continue
        const el = document.querySelector(`.bside.p-${k} .pc[data-z="k:${CSS.escape(String(perm.key))}"]`)
        const lc = lookup(data, perm.name)
        if (el && to === 'graveyard' && FETCH.test(lc?.o || '')) {  // fetch: o vórtice nas cores que procura e o feixe para a biblioteca
          const cols = landCols(lc)
          fetchFx(el, cols, zoneEl(k, 'library'))
          fetching.current[k] = { cols, t: Date.now() }
        }
        else if (el && to === 'graveyard') shatter(el, isCreature(data, perm))
        else if (el && to === 'exile' && holder && document.querySelector(`[data-z="k:${CSS.escape(String(holder.key))}"]`)) ghostInto(el, document.querySelector(`[data-z="k:${CSS.escape(String(holder.key))}"]`))  // também uma aura presa (.pc-attc)
        else if (el && to === 'exile') { sparkle(el); exileDissolve(el) }
        else if (el && (to === 'hand' || to === 'library')) ghostOut(el, to)
      }
      if (seen.current.size > 600) seen.current = new Set([...seen.current].slice(-300))
      if (calm) return
      let mn = 0
      for (const k of s.sides) for (const p of s[k]?.perms || []) {  // virou para dar mana: a mini-esfera voa para o feitiço
        const was = tapsPrev.get(p.key)  // o estado do desenho anterior
        if (was === false && p.tapped && !p.dying && !p.attacking) {
          const c = lookup(data, p.name)
          if (c && (/Land/.test(c.t) || /\{T\}[^:]*: Add /.test(c.o || ''))) {
            const el = document.querySelector(`.bside.p-${k} .pc[data-z="k:${CSS.escape(String(p.key))}"]`)
            const cs = (c.o || '').match(/Add \{([WUBRGC])\}/g)?.map(x => x[5]) || landCols(c)
            if (el && mn < 8) manaFly(el, [...new Set(cs)], k, 60 * mn++)
          }
        }
      }
      for (const [k, p] of entered) {  // terrenos que acabaram de entrar
        const c = lookup(data, p.name), el = document.querySelector(`.bside.p-${k} .pc[data-z="k:${CSS.escape(String(p.key))}"]`)
        if (!el || !c || !/Land/.test(c.t)) continue
        const fq = fetching.current[k]
        if (fq && Date.now() - fq.t < 12000) {  // o terreno que a fetch foi buscar: as fitas saem da biblioteca até ele
          delete fetching.current[k]
          fetchedFly(el, zoneEl(k, 'library'), fq.cols)
        }
        if (!p.tapped && SHOCK.test(c.o || '')) { shockFx(el, landCols(c), document.querySelector(`.bside.p-${k} .orb:not(.orb-proxy)`)); setTimeout(() => play('atk_thunder'), 380) }
        else if (!p.tapped && FAST.test(c.o || '')) landFx(el, 'fast', landCols(c))
      }
      for (const k of s.sides) {
        const a = p[k], b = snap[k]
        if (!a || !b) continue
        // comandante: sai da zona de comando (lançado) = clarão dourado que sobe do quadrado; volta = um anel que fecha nele
        for (const [n, out] of Object.entries(b.cmd || {})) if (a.cmd && n in a.cmd && a.cmd[n] !== out) {
          const t = document.querySelector(`.bside.p-${k} .cmdz[data-cmd="${CSS.escape(n)}"]`)
          if (t) { t.classList.remove('cast', 'back'); void t.offsetWidth; t.classList.add(out ? 'cast' : 'back'); setTimeout(() => t.classList.remove('cast', 'back'), 1300) }
        }
        const dl = (x, y) => (x != null && y != null ? y - x : 0)
        const src = { library: Math.max(0, -dl(a.lib, b.lib)), hand: Math.max(0, -dl(a.hand, b.hand)), graveyard: Math.max(0, a.gy.length - b.gy.length), exile: Math.max(0, a.ex.length - b.ex.length) }
        const sink = { graveyard: b.gy.length - a.gy.length - (deadTo[`${k}|graveyard`] || 0), exile: b.ex.length - a.ex.length - (deadTo[`${k}|exile`] || 0),
          hand: dl(a.hand, b.hand) - (deadTo[`${k}|hand`] || 0), library: dl(a.lib, b.lib) - (deadTo[`${k}|library`] || 0) }
        for (const [f, t, kind] of ZROUTES) {
          const n = Math.min(src[f], Math.max(0, sink[t]))
          if (n <= 0) continue
          src[f] -= n; sink[t] -= n
          zoneFly(k, f, t, n, kind, t === 'graveyard' ? b.gy : t === 'exile' ? b.ex : null, data)
        }
      }
    } catch (e) { console.warn('ZoneFx', e) }  // um efeito nunca deita a mesa abaixo
  })
  return null
}

// a biblioteca com o topo à vista (Courser of Kruphix, Future Sight, Vizier of the Menagerie…, Forge Play): a carta de cima
// virada para cima; a minha, se dá para a jogar, brilha e agarra-se/duplo clique como as da mão (data-h, data-from)
function LibTop({ k, z, data }) {
  const t = z.libTop, c = lookup(data, t.name), im = useImg(), mine = k === 'a'
  return (
    <span className={`pile libtop ${mine && t.play ? 'play' : ''}`} data-zone="library" data-zid={t.id} {...(mine ? { 'data-h': t.id, 'data-from': 'library' } : {})}
      title={`${tx('Biblioteca')}: ${z.library} · ${tx('topo à vista: {c}', { c: short(t.name) })}${mine && t.play ? ` · ${tx('podes jogá-la daqui (arrasta ou duplo clique)')}` : ''}`}>
      <span className="pile-c">{c ? <img src={im(c, 'small')} alt={t.name} /> : <span className="pc-back" />}</span>
      <small>▤ {z.library}</small>
    </span>
  )
}

// de onde vem o deck de cada lugar: meta, meu, de um amigo ou da comunidade (ao lado da etiqueta do bot)
const OWN = { meta: ['📊', tx('Meta'), tx('Deck do meta (torneios reais)')], meu: ['🧙', tx('Meu'), tx('Um deck teu')], ami: ['🤝', tx('Amigo'), tx('Deck de um amigo')], com: ['🌐', tx('Comunidade'), tx('Deck da comunidade (de outra pessoa)')] }
export function Hud({ k, z, name, fmt, s, data, fx, fast, start, openZone, top, hand, bet, bot, own, openLib }) {  // openLib: clicar na biblioteca (mesa livre: comprar)  // bet: as minhas apostas neste deck (torneios)  // hand: a mão fica nesta linha, ao centro (em baixo a nossa, em cima a do adversário)
  const cmdDmg = Object.entries(z.cmdDmg || {}), im = useImg(), oc = useContext(OrbCtx)
  return (
    <div className={`bhud ${hand ? 'withhand' : ''}`}>
      <Orb env={orbEnv(k, s, data)} life={z.life} d={fx.life?.p === k ? fx.life.d : 0} hit={fx.player?.p === k} step={s.i} fast={fast} start={start} poison={z.poison} psnHit={fx.player?.p === k && fx.player?.psn} pmax={s.giant ? 15 : 10} dmg={s.dmg?.pl?.[k] || 0} look={orbLook(k, z, data, oc, name)} side={k}
        dead={s.out?.[k] || (z.life <= 0 ? 'dmg' : (z.poison || 0) >= (s.giant ? 15 : 10) ? 'psn' : Object.values(z.cmdDmg || {}).some(n => n >= 21) ? 'cmd' : z.out || s.lost === k ? (z.library === 0 ? 'mill' : 'lose') : null)} />
      <div className="bname">
        <b title={name}>{name}</b>
        <span className="chips">
          {fmt && <span className="fmt-tag">{fmt}</span>}
          {bot && <span className="fmt-tag bot" title={bot.title}>🤖 {bot.label}</span>}
          {OWN[own] && <span className={`fmt-tag own own-${own}`} title={OWN[own][2]}>{OWN[own][0]} {OWN[own][1]}</span>}
          {bet && <span className={`chip bet ${bet.st}`} title={bet.title}>🪙 {bet.txt}</span>}
          {s.active === k && !z.out && <span className="turnpill">{tx('a jogar')}</span>}
          {z.poison > 0 && <span className="chip psn" title={s.giant ? tx('Veneno da equipa ({m} = derrota)', { m: 15 }) : tx('Marcadores de veneno ({m} = derrota)', { m: 10 })}>☠ {z.poison}</span>}
          {z.energy > 0 && <span className="chip" title={tx('Energia')}>ϟ {z.energy}</span>}
          {z.monarch && <span className="chip gold" title={tx('Monarca: compra uma carta extra no fim do turno')}>♛ {tx('monarca')}</span>}
          {z.initiative && <span className="chip gold" title={tx('Iniciativa (Masmorra Subterrânea)')}>⚑ {tx('iniciativa')}</span>}
          {z.blessing && <span className="chip gold" title={tx('Bênção da cidade (ascender): fica para o resto do jogo')}>🏙 {tx('bênção')}</span>}
          {z.speed > 0 && <span className="chip" title={tx('Velocidade (Start your engines!): sobe uma vez por turno, até 4')}>🏁 {z.speed}</span>}
          {Object.entries(z.pctr || {}).map(([k, v]) => <span key={k} className="chip" title={tx('{n} marcador {ct}|{n} marcadores {ct}', { n: v, ct: CT[k] || k })}>{k === 'rad' ? '☢' : k === 'experience' ? '✦' : '◆'} {v}</span>)}
          {z.emblems?.length > 0 && <span className="chip" title={z.emblems.map(short).join(', ')}>✦ {tx('{n} emblema|{n} emblemas', { n: z.emblems.length })}</span>}
          {cmdDmg.map(([n, v]) => { const cc = lookup(data, n)  // com a cara do comandante: dois parceiros já não são dois «⚔ 6/21» iguais
            return <span key={n} className={`chip cmdd ${v >= 15 ? 'psn' : ''}`} title={tx('Dano de comandante de {c} (21 = derrota)', { c: short(n) })}>{cc ? <img src={im(cc, 'art_crop')} alt="" /> : '⚔'} {v}/21</span> })}
          {z.out ? <span className="chip psn">{tx('eliminado no turno {n}', { n: z.out })}</span> : s.over?.loser === k ? <span className="chip psn">{tx('derrota')}</span> : null}
        </span>
      </div>
      {hand}
      <div className="zones">
        {z.command.map(c => {
          const cc = lookup(data, c.name) || tokenCard(c.name)  // masmorras (venture/iniciativa) vêm do índice de fichas
          return (
            <div key={c.name} data-cmd={c.name} className={`cmdz ${c.out ? 'out' : ''}`} title={`${tx('Zona de comando: {c}', { c: short(c.name) })}${c.room ? ` · ${tx('sala: {r}', { r: c.room })}` : ''}${c.casts ? ` · ${tx('lançado {n}× · imposto +{x}', { n: c.casts, x: 2 * c.casts })}` : ''}${c.out ? ` ${tx('(está em jogo ou na pilha)')}` : ''}`} data-z={`n:${c.name}`}>
              {cc ? <img src={im(cc, 'art_crop')} alt={c.name} /> : <span>{short(c.name)}</span>}
              <small>{c.casts ? `+${2 * c.casts}` : c.room ? '⚑' : 'cmd'}</small>
            </div>
          )
        })}
        {z.libTop ? <LibTop k={k} z={z} data={data} /> : <Pile label={tx('Biblioteca')} icon="▤" count={z.library} back est={!s.exact} data={data} zone="library" onOpen={openLib && (() => openLib(k))} />}
        {(k !== 'a' || top) && !s.exact && <div className="bhand" title={`${tx('{n} carta na mão|{n} cartas na mão', { n: z.hand })}${s.exact ? '' : ` ${tx('(estimativa)')}`}`}>{Array.from({ length: Math.min(8, z.hand) }).map((_, j) => <span key={j} className="back" />)}<small>✋ {s.exact ? '' : '≈'}{z.hand}</small></div>}
        <Pile label={tx('Cemitério')} icon="⚰" cards={z.graveyard} data={data} quiet={fast} onOpen={() => openZone(k, 'graveyard')} zone="graveyard" />
        <Pile label={tx('Exílio')} icon="⌀" cards={z.exile} data={data} quiet={fast} onOpen={() => openZone(k, 'exile')} zone="exile" />
      </div>
    </div>
  )
}

export function Side({ k, name, s, data, fx, att, top, fast, start, openZone, hand, compact, who, hit, formats, bets, bots, place, order, owns, free, mat }) {  // free: cartas pousadas à mão fora das filas (Forge Play: {key: {x, y}}, o centro em fração do lado)  // hand: a mão vai ao centro da faixa dos terrenos; place/order: arrumação à mão (Forge Play: {key: 'front'|'lands'|'others'} e {key: posição})
  const z = s[k]  // compact: um de 3–4 jogadores (cartas mais pequenas); hit: está a ser atacado
  const all = s.sides.flatMap(x => s[x].perms)
  const pairs = combatPairs(all)  // bloqueios: cada atacante bloqueado com um número e uma cor, os bloqueadores com os mesmos
  const D = s.dmg, dm = p => (D && (D.out[p.key] || D.in[p.key]) ? { ...p, dmgOut: D.out[p.key], dmgIn: D.in[p.key], trample: D.tr[p.key] } : p)  // dano do combate
  const live = markMoon(data, markDormant(data, z.perms), all).map(p => dm(pairs.has(p.key) ? { ...p, pair: pairs.get(p.key) } : p)).filter(p => !p.attachedTo || !all.some(x => x.key === p.attachedTo))  // deuses abaixo da devoção: não são criaturas
  const creatures = [], lands = [], others = [], loose = []
  // planeswalkers e batalhas na fila da frente, no fim (à direita das criaturas): são o que se ataca, à vista de quem ataca
  const walker = p => !isCreature(data, p) && (p.counters?.loyalty != null || /\b(Planeswalker|Battle)\b/.test(typeOf(data, p)))
  for (const p of live) { if (free?.[p.key]) { loose.push(p); continue } const r = place?.[p.key] || (isCreature(data, p) || walker(p) ? 'front' : isLand(data, p) ? 'lands' : 'others'); (r === 'front' ? creatures : r === 'lands' ? lands : others).push(p) }
  creatures.sort((x, y) => walker(x) - walker(y))  // estável: as criaturas pela ordem delas, os planeswalkers depois
  if (order) for (const xs of [creatures, lands, others]) xs.sort((x, y) => (order[x.key] ?? 1e9) - (order[y.key] ?? 1e9))
  const front = <Row perms={creatures} data={data} fx={fx} att={att} cls="front" groupable={p => p.token} empty={tx('sem criaturas')} quiet={fast} who={who} />
  const back = (
    <div className="brow rear">
      <Row perms={lands} data={data} fx={fx} att={att} cls="lands" groupable={() => true} quiet={fast} />
      {others.length > 0 && <Row perms={others} data={data} fx={fx} att={att} cls="others" groupable={p => p.token} quiet={fast} />}
    </div>
  )
  const hud = <Hud k={k} z={z} name={name} fmt={formats?.[k]} s={s} data={data} fx={fx} fast={fast} start={start} openZone={openZone} top={top} hand={hand} bet={bets?.[k]} bot={bots?.[k]} own={owns?.[k]} />
  const { arts } = useContext(Arts), art = useMemo(() => ({ arts, k }), [arts, k])
  useEffect(() => { const t = Date.now(); for (const p of z.perms) seenAt.set(p.key, t) })
  return (
    <Arts.Provider value={art}><div className={`bside ${top ? 'top' : 'bottom'} ${z.perms.filter(p => p.attacking).length === 1 ? 'lone-atk' : ''} ${s.active === k ? 'act' : ''} ${compact ? 'compact' : ''} ${z.out ? 'out' : ''} ${hit ? 'hit' : ''} p-${k}`} data-mat={mat || undefined}>
      {top ? <>{hud}{back}{front}</> : <>{front}{back}{hud}</>}
      {loose.length > 0 && <div className="bfree">{loose.map(p => (
        <div key={p.key} className={`bfree-c ${isCreature(data, p) ? 'front' : isLand(data, p) ? 'lands' : 'others'}`} style={{ left: `clamp(calc(var(--w) * .5), ${free[p.key].x * 100}%, calc(100% - var(--w) * .5))`, top: `clamp(calc(var(--w) * .7), ${free[p.key].y * 100}%, calc(100% - var(--w) * .7))` }}>
          <Perm p={p} data={data} hl={fx.hl.has(p.key) ? fx.par : 0} pop={fx.pops.get(p.key) || null} att={att.get(p.key)} n={0} quiet={fast} />
        </div>))}</div>}
    </div></Arts.Provider>
  )
}

// a nossa mão, virada para cima: num jogo exato, a mão verdadeira (o Forge diz cada compra); num jogo antigo,
// as cartas que sabemos que lá estavam + o resto de costas
export function Hand({ z, data, quiet, exact, opp, hidden, label }) {  // opp: mão do adversário (jogos exatos; num teste entre bots não há nada a esconder)
  const seen = {}, im = useImg(), set = useImgSet()
  const unknown = Math.max(0, z.hand - z.known.length)
  const n = z.known.length + Math.min(unknown, 10)
  return (
    <div className={`myhand ${exact ? 'exact' : ''} ${opp ? 'opp' : ''}`}>
      <div className="fan">
        {z.known.map((nm, j) => {
          seen[nm] = (seen[nm] || 0) + 1
          const c = lookup(data, nm), rot = (j - (n - 1) / 2) * Math.min(5, 40 / Math.max(1, n))
          if (hidden) return <In key={`${nm}-${seen[nm]}`} quiet={quiet} className="hc unk" style={{ '--r': `${rot}deg`, '--q': rot }}><span className="pc-back" /></In>
          return <In key={`${nm}-${seen[nm]}`} quiet={quiet} className="hc" style={{ '--r': `${rot}deg`, '--q': rot }} data-z={`n:${nm}`}>{c ? <img src={im(c, 'small')} srcSet={set(c)} sizes="(max-width: 900px) 70px, 6.2vw" alt={nm} draggable="false" /> : <span>{short(nm)}</span>}</In>
        })}
        {Array.from({ length: Math.min(unknown, 10) }).map((_, j) => <In key={`u${j}`} quiet={quiet} className="hc unk" style={{ '--r': `${(z.known.length + j - (n - 1) / 2) * Math.min(5, 40 / Math.max(1, n))}deg`, '--q': (z.known.length + j - (n - 1) / 2) * Math.min(5, 40 / Math.max(1, n)) }}><span className="pc-back" /></In>)}
      </div>
      {exact
        ? <small className="muted">{label || (opp ? tx('Mão do adversário') : tx('Mão'))} · {tx('{n} carta|{n} cartas', { n: z.hand })}</small>
        : <small className="muted">{tx('Mão ≈{n}', { n: z.hand })}{z.known.length ? ` · ${tx('{n} conhecida|{n} conhecidas', { n: z.known.length })}` : ''} <i className="est-i" title={tx('Estimativa: este jogo foi gravado antes de o Forge dar as compras; as cartas à vista são as que o jogador joga ou descarta neste turno.')}>≈</i></small>}
    </div>
  )
}

// ---------- ampliação: rato por cima = pré-visualização; toque/clique = cartão grande ----------
function zoomInfo(z, s, data) {
  if (!z) return null
  if (z.startsWith('k:')) {
    const key = z.slice(2)
    const all = s.sides.flatMap(x => s[x].perms)
    for (const k of s.sides) {
      const p = s[k].perms.find(x => x.key === key)
      if (p) {
        const c = permCard(data, p)
        const att = all.filter(x => x.attachedTo === key)
        const host = p.attachedTo && all.find(x => x.key === p.attachedTo)
        const pt = isCreature(data, p) ? powTough(data, p) : null
        const lines = [
          typeOf(data, p),
          pt && `${pt.p}/${pt.t}${p.damage ? ` · ${tx('{n} de dano', { n: p.damage })}` : ''}`,
          ...Object.entries(p.counters || {}).map(([t, v]) => tx('{n} marcador {ct}|{n} marcadores {ct}', { n: v, ct: CT[t] || t })),
          p.pump && tx('{pt} até ao fim do turno', { pt: `${p.pump[0] >= 0 ? '+' : ''}${p.pump[0]}/${p.pump[1] >= 0 ? '+' : ''}${p.pump[1]}` }),
          att.length && tx('Anexadas: {x}', { x: att.map(x => short(x.name)).join(', ') }),
          host && tx('Anexada a {x}', { x: short(host.name) }),
          kwsOf(c, p).map(k => KW[k][1]).join(' · '),
          [p.tapped && tx('virada'), p.faceDown && tx('virada para baixo'), p.phased && tx('fora de fase'), p.copy && tx('cópia'), p.sick && tx('enjoo de invocação'), p.attacking && tx('a atacar'), p.blocking && tx('a bloquear'), p.token && tx('ficha'), p.goaded && tx('incitada')].filter(Boolean).join(' · '),
        ].filter(Boolean)
        return { c: c || (p.token ? tokenCard(p.name, p.pt, p.src) : null), side: k, back: backUp(c, p) && !!c?.df, name: short(p.face || p.name) || tx('Terreno'), lines, p }
      }
    }
    return null
  }
  const name = z.slice(2)
  const c = lookup(data, name)
  return { c, back: false, name: short(name), lines: c ? [c.t] : [] }
}

function ZoomCard({ info, big }) {
  const im = useImg()
  if (!info) return null
  return (
    <div className={`zoomcard ${big ? 'big' : ''}`}>
      {info.c ? <img src={im(info.c, 'normal', info.back, info.side)} alt={info.name} /> : <div className="pc-token zt"><b>{info.name}</b>{info.p?.pt && <i>{info.p.pt}</i>}</div>}
      <div className="zinfo"><b>{info.name}</b>{info.lines.map((l, j) => <span key={j}><Syms text={l} /></span>)}</div>
    </div>
  )
}

// nomes de cartas dentro de um texto do registo: passar o rato (ou tocar e manter) mostra a carta (data-z, como no campo)
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function Named({ text, names }) {
  const t = String(text ?? '')
  const full = new Map()
  for (const n of names) if (typeof n === 'string' && n.length > 2) for (const v of [n, short(n)]) if (v && v.length > 2 && t.includes(v) && !full.has(v)) full.set(v, n)
  if (!full.size) return t
  const re = new RegExp(`(${[...full.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|')})`, 'g')
  return t.split(re).map((p, k) => (full.has(p) ? <b key={k} className="lg-card" data-z={`n:${full.get(p)}`}>{p}</b> : p))
}

// ---------- linha do tempo: uma marca por evento importante, riscos nos turnos ----------
const Timeline = memo(function Timeline({ evs, i, onSeek }) {
  const n = Math.max(1, evs.length)
  const marks = useMemo(() => evs.map((e, j) => (MARK[e.k] ? { j, c: MARK[e.k] } : null)).filter(Boolean), [evs])
  const turns = useMemo(() => evs.map((e, j) => (e.k === 'turn' ? { j, t: e.t, p: e.p } : null)).filter(Boolean), [evs])
  const seek = e => { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.round(((e.clientX - r.left) / r.width) * n)) }
  return (
    <svg className="tline" viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" onClick={seek} role="img" aria-label={tx('Linha do tempo do jogo')}>
      {turns.map(x => <rect key={`t${x.j}`} x={x.j} y="0" width={n / 400 + 0.3} height="20" className={`tt ${x.p}`} />)}
      {marks.map(x => <rect key={x.j} x={x.j} y="6" width={Math.max(0.6, n / 300)} height="10" className={x.c} />)}
      <rect x={Math.min(i, n) - n / 300} y="0" width={n / 150} height="20" className="tnow" />
    </svg>
  )
})

// contagem decrescente até ao jogo seguinte (montada só enquanto há para onde avançar)
function Countdown({ secs, onDone }) {
  const [left, setLeft] = useState(secs)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })
  useEffect(() => {
    if (left <= 0) { done.current(); return }
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return <span className="muted small">{tx('próximo jogo em {n} s', { n: left })}</span>
}

// next: { has, go, secs, auto } — fila de jogos do Laboratório (sem next: só o resultado)
// Placar: série e sessão; o jogo em curso só conta quando acaba (não estraga o resultado)
const lost = w => !!w && w !== 'a' && w !== 'draw'  // com 3+ jogadores ganha qualquer um dos outros
function Score({ sc, ended, winner, a, b, fa, fb }) {
  const wa = sc.a + (ended && winner === 'a' ? 1 : 0), wb = sc.b + (ended && lost(winner) ? 1 : 0)
  const sw = sc.sw + (ended && winner === 'a' ? 1 : 0), sl = sc.sl + (ended && lost(winner) ? 1 : 0)
  const need = Math.ceil(sc.bo / 2), done = wa >= need || wb >= need
  const lead = wa > wb ? 'a' : wb > wa ? 'b' : ''
  return (
    <div className="score" role="status">
      <span className={`sc-n a ${lead === 'a' ? 'lead' : ''}`} title={a}>{fa}{a}</span>
      <span className={`sc-box ${ended ? 'bump' : ''}`} key={`${wa}-${wb}`}><b className={lead === 'a' ? 'lead' : ''}>{wa}</b><i>–</i><b className={lead === 'b' ? 'lead' : ''}>{wb}</b></span>
      <span className={`sc-n b ${lead === 'b' ? 'lead' : ''}`} title={b}>{fb}{b}</span>
      <span className="sc-meta">
        {sc.bo > 1 ? <>{jsx(tx('Jogo {g} de {bo} · melhor de {bo} (ganha quem chegar a {need})'), { g: <b>{sc.g}</b>, bo: sc.bo, need })}{done && <> · <b className={wa > wb ? 'ok-t' : 'bad-t'}>{wa > wb ? tx('série ganha') : tx('série perdida')}</b></>}</> : tx('Jogo único')}
        {sc.series > 1 && <> · {jsx(tx('Série {s} de {total}'), { s: <b>{sc.serie}</b>, total: sc.series })}</>}
        {sc.total > 1 && <> · {jsx(tx('Sessão: {w} – {l} ({k}/{total} jogos)'), { w: <b className="ok-t">{tx('{n} V', { n: sw })}</b>, l: <b className="bad-t">{tx('{n} D', { n: sl })}</b>, k: sc.k, total: sc.total })}</>}
      </span>
    </div>
  )
}

// Placar de todos contra todos: vitórias (1.º lugar) de cada jogador na sessão e o lugar neste jogo
function ScoreN({ sc, ended, game, who, fm }) {
  const S = Object.keys(sc.wins)
  const w = k => sc.wins[k] + (ended && game.winner === k ? 1 : 0)
  const place = k => (ended && game.places ? game.places.indexOf(k) + 1 : 0)
  const pl = sc.places.concat(ended && game.places ? [game.places.indexOf('a') + 1] : []).filter(Boolean)
  return (
    <div className="score multi" role="status">
      <span className="sc-ps">{S.map(k => <span key={k} className={`sc-p p-${k} ${ended && game.winner === k ? 'lead' : ''}`} title={who[k]}><b>{who[k]}</b>{fm(k)}<i key={w(k)} className={ended && game.winner === k ? 'bump' : ''}>{w(k)}</i>{place(k) ? <small>{ord(place(k))}</small> : null}</span>)}</span>
      <span className="sc-meta">{jsx(tx('{label} · Jogo {k} de {total} · vitórias = 1.º lugar'), { label: sc.label, k: <b>{sc.k}</b>, total: sc.total })}{pl.length > 0 && <> · {jsx(tx('o teu lugar médio: {x}'), { x: <b>{ord(num(pl.reduce((x, y) => x + y, 0) / pl.length, 1))}</b> })}</>}</span>
    </div>
  )
}

export const HANDS = [['ambas', tx('Mãos: ambas visíveis')], ['minha', tx('Mãos: só a minha')], ['nenhuma', tx('Mãos: ambas escondidas')]]

export default function Replay({ data, game: game0, onBack, backLabel = tx('← Relatório'), deckName, pov = 'a', track = false, bets, bots, live = false, next, speed0, onSpeed, hands: hands0, onHands, onPlayFrom, score, arts: arts0, formats, owns }) {  // arts: {a: {nome: link}, b: …} arte própria de cada deck (torneio: game.arts; Laboratório: game.decks); formats: {a: 'Pauper', b: …} (modo casual)
  const game = useMemo(() => giantTurns(game0), [game0])
  const art = useMemo(() => ({ arts: arts0 || game.arts || (game.decks && Object.fromEntries(Object.entries(game.decks).map(([k, d]) => [k, artMapOf(d)]))), k: null }), [arts0, game]), arts = art.arts
  const [hands, setHandsS] = useState(hands0 || 'ambas')
  // No Coliseu o tabuleiro escala as cartas (--fit) para caber na altura do ecrã: ao abrir, ao redimensionar e em ecrã inteiro
  const boardRef = useRef(null), fitRef = useRef(null), zoomRef = useRef(null)  // zoomRef: −/⤢/+ (ajuste manual, guardado)
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el?.closest('.coliseu')) return
    // altura livre = do sítio onde o tabuleiro começa (com a página no topo, ou o ecrã inteiro no topo) até ao fundo do ecrã
    // telemóvel: o placar e os botões ficam no topo do ecrã e a mesa ocupa o resto da altura
    const narrow = () => innerWidth < 901
    const tbl = () => el.querySelector('.bwrap > .table') || el
    // a altura do que está lá dentro, também o que transborda: em ecrã inteiro o tabuleiro tem altura limitada e o
    // offsetHeight não via a mesa a sair por baixo — o ajuste achava que cabia, a barra dos turnos ficava enorme e o teu
    // lado cortado
    const size = () => {  // com zoom, a altura que se vê: do topo do tabuleiro ao fundo da mesa (sem os efeitos que saem dela)
      if (narrow()) return tbl().getBoundingClientRect().height
      const t = tbl()
      return t === el ? Math.max(el.offsetHeight, el.scrollHeight) : t.getBoundingClientRect().bottom - el.getBoundingClientRect().top + (parseFloat(getComputedStyle(el).paddingBottom) || 0)
    }
    // em ecrã inteiro (e numa janela) o tabuleiro vive numa caixa da altura do ecrã: quando a mesa não cabe ele é espremido
    // até à altura que tem de facto (clientHeight < scrollHeight). Essa é a altura máxima a sério (antes contava-se até ao
    // fundo do ecrã e a mesa passava uns 30–40 px por baixo); guarda-se até a janela/ecrã inteiro mudar
    let cap = null
    const capNow = () => { if (!narrow() && el.scrollHeight > el.clientHeight + 2) cap = el.clientHeight }
    const avail = () => {
      // dentro de uma janela (ver ao vivo, repetições do torneio) mede-se na janela; em ecrã inteiro no elemento; senão na página
      const md = el.closest('.modal'), fe = document.fullscreenElement || document.webkitFullscreenElement
      const sc = md || (fe?.contains(el) ? fe : null), vh = window.visualViewport?.height || innerHeight  // altura visível real (tablet)
      if (narrow()) return (md ? Math.min(vh, innerHeight - 24) : vh) - (tbl().getBoundingClientRect().top - el.getBoundingClientRect().top) - 8
      const top = el.getBoundingClientRect().top + (sc ? sc.scrollTop - sc.getBoundingClientRect().top : scrollY)
      const free = (md ? Math.min(vh, innerHeight - 24) : vh) - top - 8
      return cap ? Math.min(free, cap - (parseFloat(getComputedStyle(el).paddingBottom) || 0)) : free
    }
    const fit = (force = false) => {
      // telemóvel: tamanho normal (ou o zoom escolhido em −/+); o ajuste ao ecrã só com ⤢ (encolhia tudo até ficar ilegível)
      if (narrow() && !force) return el.style.setProperty('--fit', adjM())
      // a altura é fixa (barras, etiquetas) + proporcional ao --fit: com a secante acerta em 2–3 medições
      // (o f × livre/altura parava a 6–10px do alvo e o resultado dependia do caminho: janela, ecrã inteiro, zoom do sistema)
      const h = f => { el.style.setProperty('--fit', f); return size() }
      let f0 = 1, h0 = h(1)
      capNow()  // com as cartas no tamanho 1 a mesa transborda: vê-se a altura que o tabuleiro tem de facto
      const a = avail()
      let f = Math.max(0.4, Math.min(1.6, a / h0))
      for (let n = 0; n < 5; n++) {
        const h1 = h(f)
        if (Math.abs(h1 - a) < 2 || h1 === h0) break
        const g = Math.max(0.4, Math.min(1.6, f + (a - h1) * (f - f0) / (h1 - h0)))
        f0 = f; h0 = h1
        if (g === f) break
        f = g
      }
      if (narrow()) { setM(f); return el.style.setProperty('--fit', f) }
      el.style.setProperty('--fit', Math.max(0.35, Math.min(1.9, f * adj())))
      // tamanho mínimo das cartas escolhido (.px): só vale enquanto o tabuleiro cabe no ecrã — se o mínimo o faz passar,
      // encolhe-se o mínimo (--pxf) só o preciso para caber; o −/+ continua a mandar (o alvo é a altura × zoom)
      el.style.setProperty('--pxf', 1)
      if (el.classList.contains('px')) {
        const want = a * adj() + 2
        if (size() > want) {
          let lo = 0.2, hi = 1
          for (let n = 0; n < 7; n++) { const m = (lo + hi) / 2; el.style.setProperty('--pxf', m); if (size() > want) hi = m; else lo = m }
          el.style.setProperty('--pxf', lo)
        }
      }
    }
    const KM = 'grimorio.zoomMob'
    const adjM = () => { try { return Math.max(0.4, Math.min(1.6, +localStorage.getItem(KM) || 1)) } catch { return 1 } }
    const setM = v => { try { localStorage.setItem(KM, Math.max(0.4, Math.min(1.6, v)).toFixed(2)) } catch { /* sem armazenamento */ } }
    const adj = () => { try { return Math.max(0.6, Math.min(1.6, +localStorage.getItem('grimorio.zoom') || 1)) } catch { return 1 } }
    zoomRef.current = d => {  // d = ±0,1 afina à mão; 0 volta a detetar a altura e repõe o ajuste automático
      if (narrow()) {  // telemóvel: −/+ mudam o zoom guardado; ⤢ ajusta a mesa ao ecrã (e só aí faz scroll até ela)
        if (d) { setM(adjM() + d); return fit() }
        el.scrollIntoView({ block: 'start' })
        return requestAnimationFrame(() => fit(true))
      }
      try { localStorage.setItem('grimorio.zoom', d ? Math.max(0.6, Math.min(1.6, adj() + d)).toFixed(2) : '1') } catch { /* sem armazenamento */ }
      // ⤢: a altura conta-se com a página (ou a janela / o ecrã inteiro) no topo — volta lá antes de medir
      if (!d) { const md = el.closest('.modal'), fe = document.fullscreenElement || document.webkitFullscreenElement; (md || (fe?.contains(el) ? fe : null))?.scrollTo?.(0, 0); if (!md && !fe) window.scrollTo(0, 0) }
      fit()
    }
    fit()
    fitRef.current = () => {  // segurança: as filas têm altura fixa, mas se algo ainda fugir mais de 2% volta a medir (nos dois sentidos)
      if (narrow()) return  // no telemóvel o tamanho é o escolhido: nada de medir a cada jogada
      const a = avail() * adj(), h = size()
      if (h - a > a * 0.02 + 3 || a - h > a * 0.05) fit()  // margem: pequenas variações não mexem nas cartas
    }
    // as imagens das cartas chegam depois da 1.ª medição e mudam a altura: o tabuleiro volta a medir quando o próprio tamanho muda
    let raf = 0
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fitRef.current?.()) })
    ro.observe(el)
    // o tamanho final chega atrasado (imagens e mão a desenhar; no tablet: ecrã inteiro, rodar, barra do browser):
    // volta a medir pouco depois, também ao abrir
    let tm = []
    const later = () => { cap = null; fit(); tm.forEach(clearTimeout); tm = [150, 450, 1000].map(t => setTimeout(fit, t)) }
    later()
    const evs = ['fullscreenchange', 'webkitfullscreenchange']
    addEventListener('resize', later); addEventListener('orientationchange', later); window.visualViewport?.addEventListener('resize', later)
    evs.forEach(e => document.addEventListener(e, later))
    return () => {
      ro.disconnect(); cancelAnimationFrame(raf)
      tm.forEach(clearTimeout); removeEventListener('resize', later); removeEventListener('orientationchange', later)
      window.visualViewport?.removeEventListener('resize', later); evs.forEach(e => document.removeEventListener(e, later))
    }
  }, [game])
  useLayoutEffect(() => { fitRef.current?.() })
  const setHands = v => { setHandsS(v); onHands?.(v) }
  const evs = useMemo(() => game.events || [], [game])  // game: Two-Headed Giant com os turnos da equipa (giantTurns)
  const [pos, setPos] = useState({ i: 0, jump: true })
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeedS] = useState(speed0 ?? (live ? 3 : 2))
  const setSpeed = v => { setSpeedS(v); onSpeed?.(v) }  // o ritmo escolhido passa para o jogo seguinte
  const [zoom, setZoom] = useState(null)
  const [zone, setZone] = useState(null)
  const [more, setMore] = useState(false)  // telemóvel: velocidade, mãos e turno atrás do ⚙
  const logRef = useRef(null)
  const start = game.startLife || 20
  const giant = game.mode === '2hg' ? game.teams : null
  const [px, setPx] = useState(() => fpPrefs().cardPx)  // tamanho das cartas escolhido (0 = automático)
  const states = useMemo(() => replayStates(evs, data, start, game.setup || null, !!game.exact, giant), [evs, data, start, game.setup, game.exact, giant])
  const i = Math.min(pos.i, evs.length)
  const go = (n, jump = true) => setPos({ i: Math.max(0, Math.min(evs.length, n)), jump })
  useEffect(() => {
    if (!playing || i >= evs.length) return
    const k = evs[i]?.k
    const t = setTimeout(() => setPos(p => ({ i: Math.min(evs.length, p.i + 1), jump: false })), Math.max(30, (900 / speed) * (PACE[k] ?? 0.7)))
    return () => clearTimeout(t)
  }, [playing, i, speed, evs])
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [i])
  const s = i === states.length - 1 && states[i] ? { ...states[i], out: endOut(game, states[i].sides) } : states[i]  // no fim: a esfera de quem perdeu rebenta à maneira
  // som de cada jogada (não ao saltar na linha do tempo; a alta velocidade o sfx.js corta o miúdo)
  useEffect(() => { if (!pos.jump && i > 0) playEvent(evs[i - 1], states[i], data, { speed }) }, [i])  // eslint-disable-line react-hooks/exhaustive-deps
  const ended = evs.length > 0 && i >= evs.length && !game.inProgress  // ao vivo: só acaba quando o Forge acaba
  const fast = speed >= 4
  const who = { a: deckName, b: game.opp, ...game.opps }  // opps: {b, c, d} com 3+ jogadores
  const cols = useColors(), sideVars = useMemo(() => sideColors(cols, pov, who), [cols, pov, deckName, game.opp, game.opps])  // eslint-disable-line react-hooks/exhaustive-deps
  const fx = useMemo(() => ({ hl: new Set(s.fx?.keys || []), par: (s.i % 2) + 1, pops: new Map((s.fx?.pops || []).map(x => [x.key, { ...x, i: s.i }])), life: s.fx?.life, player: s.fx?.player }), [s])
  const att = useMemo(() => {
    const m = new Map()
    for (const p of s.sides.flatMap(x => s[x].perms)) if (p.attachedTo) m.set(p.attachedTo, [...(m.get(p.attachedTo) || []), p])
    return m
  }, [s])
  const turns = useMemo(() => [...new Set(evs.map(e => e.t).filter(Boolean))], [evs])
  const ph = PHASES.indexOf(s.phase)
  const openZone = (k, which) => setZone({ k, which })
  const zinfo = zoom && zoomInfo(zoom.z, s, data)
  // ampliação por delegação: um só conjunto de handlers para todas as cartas (as cartas memorizadas não mudam)
  const pType = useRef('mouse')
  const onOver = e => {
    if (e.pointerType !== 'mouse') return
    const el = e.target.closest('[data-z]')
    if (!el) { if (zoom && !zoom.pin) setZoom(null); return }
    if (zoom?.z === el.dataset.z && !zoom.pin) return
    if (!zoom?.pin) setZoom({ z: el.dataset.z, r: el.getBoundingClientRect() })
  }
  const onTap = e => {
    if (pType.current !== 'mouse') return  // no toque, o zoom é com toque longo (onPress)
    const el = e.target.closest('[data-z]')
    if (el) { e.preventDefault(); setZoom({ z: el.dataset.z, pin: true }); play('zoom') }
  }
  const press = useRef(null)
  const onPress = e => {  // toque longo (~0,45 s) numa carta -> zoom; mexer o dedo cancela
    pType.current = e.pointerType
    clearTimeout(press.current?.t)
    const el = e.pointerType !== 'mouse' && e.target.closest('[data-z]')
    if (el) press.current = { x: e.clientX, y: e.clientY, t: setTimeout(() => { setZoom({ z: el.dataset.z, pin: true }); play('zoom') }, 450) }
  }
  const unPress = e => { if (press.current && (e.type !== 'pointermove' || Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10)) { clearTimeout(press.current.t); press.current = null } }
  const hoverStyle = zoom && !zoom.pin && zoom.r ? (() => {
    const W = 230, H = 420, r = zoom.r, vw = window.innerWidth, vh = window.innerHeight
    const left = r.right + W + 14 < vw ? r.right + 10 : Math.max(6, r.left - W - 10)
    return { left, top: Math.max(6, Math.min(vh - H - 6, r.top + r.height / 2 - H / 2)), width: W }
  })() : null
  const zoneCards = zone ? s[zone.k][zone.which] : []
  let ri = i
  while (ri > 0 && quiet(evs[ri - 1])) ri--
  const rev = evs[ri - 1]
  // o dano do evento acabado de aplicar: de que carta para que carta/jogador (no estado de antes: a vítima pode já ter morrido)
  const dmgHits = (() => {
    const e = evs[i - 1]
    if (!e || speed >= 6 || pos.jump) return null  // são leves: veem-se até 5,5× (as outras animações param aos 4×; ao vivo acelera-se para apanhar o jogo)
    if (e.k === 'countered') return [{ key: `r${i}`, kind: 'counter', to: { stack: true, name: e.card } }]
    if (e.k !== 'damage') return null
    const s0 = states[i - 1] || s, all = s0.sides.flatMap(k => s0[k].perms)
    const src = (e.id != null && all.find(p => p.fid === e.id)) || all.find(p => p.name === e.card)
    const tp = !s0.sides.includes(e.target) && ((e.tid != null && all.find(p => p.fid === e.tid)) || all.find(p => p.name === e.target))
    const to = s0.sides.includes(e.target) ? { side: e.target } : tp ? { card: tp.key } : null
    return to ? [{ key: `r${i}`, from: src?.key, fromName: e.card, to, n: e.n, kind: e.psn ? 'psn' : e.combat ? 'cmb' : 'spl' }] : null
  })()
  const actor = s.sides.includes(rev?.p) ? rev.p : null
  // 3–4 jogadores: adversários em colunas em cima; o parceiro de equipa (game.teams) ao lado do teu deck, em baixo
  const S = s.sides, multi = S.length > 2
  const mates = multi && game.teams ? S.filter(k => k !== 'a' && game.teams[k] === game.teams.a) : []
  const tops = S.filter(k => k !== 'a' && !mates.includes(k))
  const hit = new Set(multi ? S.flatMap(k => s[k].perms.map(p => p.attacking)).filter(x => S.includes(x)) : [])
  const fm = k => (formats?.[k] ? <span className="fmt-tag">{formats[k]}</span> : null)
  const ownOf = d => (!d ? null : d.friend ? 'ami' : d.community ? 'com' : d.source === 'MTGTop8' || d.source === 'EDHREC' || 'archetype' in d ? 'meta' : 'meu')
  const own = owns || (game.decks && Object.fromEntries(Object.entries(game.decks).map(([k, d]) => [k, ownOf(d)])))  // Laboratório: dos decks do jogo
  const sD = { ...s, dmg: replayDmg(evs, i, states) }  // o dano do combate em curso marcado nas cartas
  const sp = { formats, s: sD, data, fx, att, fast: fast || pos.jump, start, openZone, bets, bots, owns: own }
  const oppHand = k => game.exact && <Hand z={s[k]} data={data} quiet={fast || pos.jump} exact opp hidden={hands !== 'ambas'} label={mates.includes(k) ? tx('Mão do parceiro') : null} />
  return (
    <Arts.Provider value={art}><div ref={boardRef} className={`view board ${live ? 'live' : ''} ${fast ? 'fast' : ''} ${pos.jump ? 'instant' : ''} ${fast || pos.jump ? 'quiet' : ''} ${px ? 'px' : ''}`} style={px ? { ...sideVars, ...minCardVars(px) } : sideVars}
      onPointerOver={onOver} onPointerLeave={() => zoom && !zoom.pin && setZoom(null)}
      onPointerDown={onPress} onPointerUp={unPress} onPointerCancel={unPress} onPointerMove={unPress} onClick={onTap} onContextMenu={e => { if (e.target.closest('[data-z]')) e.preventDefault() }}>
      <div className="rp-bar">
        {onBack && <button onClick={onBack}>{backLabel}</button>}
        {score?.wins ? <ScoreN sc={score} ended={ended} game={game} who={who} fm={fm} /> : score ? <Score sc={score} ended={ended} winner={game.winner} a={mates.length ? [deckName, ...mates.map(k => who[k])].join(' + ') : deckName} b={mates.length ? tops.map(k => who[k]).join(' + ') : game.opp} fa={!mates.length && fm('a')} fb={!mates.length && fm('b')} />
          : formats ? <b>{S.map((k, j) => <span key={k}>{j ? (multi ? ' · ' : ' vs ') : ''}{who[k]} {fm(k)}</span>)}</b> : <b>{multi ? (game.teams ? [...new Set(S.map(k => game.teams[k]))].map(t => S.filter(k => game.teams[k] === t).map(k => who[k]).join(' + ')).join(' vs ') : S.map(k => who[k]).join(' · ')) : `${deckName} vs ${game.opp}`}</b>}
        {live && <span className="livepill">{tx('● a jogar')}</span>}
        {!score && ended && <span className="muted small">{tx('jogo {g} · {r} no turno {t}', { g: game.g, r: pov !== 'a' ? (lost(game.winner) || game.winner === 'a' ? tx('venceu «{d}»', { d: who[game.winner] }) : tx('empate')) : game.winner === 'a' ? tx('vitória') : lost(game.winner) ? tx('derrota') : tx('empate'), t: game.turns })}</span>}
      </div>
      <div className={`rp-ctrl ${more ? 'more' : ''}`}>
        <button onClick={() => go(0)} title={tx('Início')} aria-label={tx('Início')}>⏮</button>
        <button onClick={() => go(i - 1, false)} title={tx('Passo atrás')} aria-label={tx('Passo atrás')}>◀</button>
        <button className="primary" onClick={() => setPlaying(!playing)}>{playing ? tx('❚❚ Pausa') : tx('▶ Continuar')}</button>
        <button onClick={() => go(i + 1, false)} title={tx('Passo à frente')} aria-label={tx('Passo à frente')}>▶</button>
        <button onClick={() => go(evs.length)} title={live ? tx('Ir para o momento atual') : tx('Fim')} aria-label={tx('Fim')}>⏭</button>
        <span className="rp-zoom"><button onClick={() => zoomRef.current?.(-0.1)} title={tx('Mais pequeno')}>−</button><button onClick={() => zoomRef.current?.(0)} title={tx('Ajustar ao ecrã (volta a detetar a altura)')}>⤢</button><button onClick={() => zoomRef.current?.(0.1)} title={tx('Maior')}>+</button></span>
        <button className="rp-more" onClick={() => setMore(!more)} aria-expanded={more} title={tx('Velocidade, mãos e turno')}>⚙</button>
        <label className="sl rp-speed"><span>{jsx(tx('Velocidade {x}'), { x: <b>{speed}×</b> })}</span><input type="range" min="0.5" max="8" step="0.5" value={speed} onChange={e => setSpeed(+e.target.value)} /></label>
        {onPlayFrom && !live && !multi && <button className="rp-x" onClick={() => { setPlaying(false); onPlayFrom(s, game) }} title={tx('Abre esta posição no Forge e jogas tu com o teu deck')}>{tx('🎮 Jogar daqui')}</button>}
        <CardPx className="rp-x" onChange={setPx} min />
        <select className="rp-x" value={hands} onChange={e => setHands(e.target.value)} aria-label={tx('Mãos à vista')}>{HANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="rp-x" value={s.turn || ''} onChange={e => go(evs.findIndex(x => x.t === +e.target.value))} aria-label={tx('Ir para o turno')}>{turns.map(t => <option key={t} value={t}>{tx('Turno {t}', { t })}</option>)}</select>
        <div className="rp-time">
          <Timeline evs={evs} i={i} onSeek={n => { setPlaying(false); go(n) }} />
          <input type="range" className="rp-scrub" min="0" max={evs.length} value={i} onChange={e => { setPlaying(false); go(+e.target.value) }} aria-label={tx('Posição no jogo')} />
        </div>
        <span className="muted small">{i}/{evs.length}</span>
      </div>
      <div className="bwrap">
        <div className={`table ${multi ? 'multi' : ''} ${track && pov ? `track-${pov}` : ''} ${S.some(k => s[k]?.perms?.some(p => p.attacking)) ? 'combat-on' : ''}`}>
          {multi
            ? <div className="opps" style={{ '--np': tops.length }}>{tops.map(k => <Side key={k} k={k} name={who[k]} {...sp} top compact={tops.length > 2} who={who} hit={hit.has(k)} hand={oppHand(k)} />)}</div>
            : <Side k="b" name={game.opp} {...sp} top hand={oppHand('b')} />}
          <div className="bmid">
            <div className="phases" style={{ '--n': PHASES.length, '--x': Math.max(0, ph) }}>
              <span className="turnno">T{s.turn || 0}</span>
              <div className="phtrack">
                {ph >= 0 && <i className={`phmark ${s.active || ''}`} />}
                {PHASES.map((x, j) => <span key={x} className={j === ph ? 'on' : j < ph ? 'past' : ''} title={PH_LABEL[x]}>{PH_SHORT[x]}</span>)}
              </div>
            </div>
            <StackFx {...{ s, rev, ri, data, arts, who, speed }} quiet={fast || pos.jump} />
            <div className={`ribbon ${actor ? `by-${actor}` : ''} k-${rev?.k || ''}`} aria-live="polite">
              <span key={ri}>{actor && <i className="arrow">{actor === 'a' || mates.includes(actor) ? '▼' : '▲'}</i>}{rev ? describe(rev, who) : live ? tx('À espera do Forge…') : tx('O jogo vai começar…')}</span>
            </div>
          </div>
          {(() => {
            const me = <Side k="a" name={deckName} {...sp} who={multi ? who : null} hit={hit.has('a')} hand={<Hand z={s.a} data={data} quiet={fast || pos.jump} exact={!!game.exact} hidden={hands === 'nenhuma'} />} />
            return mates.length ? <div className="mine withmate">{me}{mates.map(k => <Side key={k} k={k} name={who[k]} {...sp} compact={mates.length > 1} who={who} hit={hit.has(k)} hand={oppHand(k)} />)}</div> : me
          })()}
          <CombatLinks s={s} />
          <StackLinks s={s} data={data} />
          <DamageFx hits={dmgHits} data={data} />
          <ZoneFx s={s} data={data} quiet={fast || pos.jump} />
          {ended && (
            <div className={`endbanner ${game.stopped ? 'draw stopped' : !game.winner || game.winner === 'draw' ? 'draw' : pov === 'a' ? (game.winner === 'a' ? 'win' : 'loss') : !pov ? 'neutral' : game.winner === pov ? 'win' : 'loss'}`} role="status">
              <b>{game.stopped ? tx('⏹ Interrompido no turno {t} (não conta)', { t: game.turns || s.turn || 0 }) : pov !== 'a' ? (!game.winner || game.winner === 'draw' ? tx('Empate') : tx('«{d}» venceu no turno {t}', { d: who[game.winner], t: game.turns })) : game.winner === 'a' ? (mates.length ? tx('Vitória da equipa no turno {t}', { t: game.turns }) : tx('Vitória no turno {t}', { t: game.turns })) : !lost(game.winner) ? tx('Empate') : mates.length ? tx('Derrota da equipa no turno {t}', { t: game.turns }) : multi ? `${game.places ? tx('{p} lugar', { p: ord(game.places.indexOf('a') + 1) }) : tx('Derrota')}${s.a.out ? ` — ${tx('eliminado no turno {n}', { n: s.a.out })}` : ''}` : tx('Derrota no turno {t}', { t: game.turns })}</b>
              {multi && game.places && !mates.length && <span>{game.places.map((k, j) => `${ord(j + 1)} ${short(who[k])}`).join(' · ')}</span>}
              <span>{tx('Vida final: {x}', { x: S.map(k => `${who[k]} ${lifeTxt(s[k].life)}`).join(' · ') })}</span>
              <span className="row-btns">
                {next?.has && playing && next.auto && <Countdown key={`${game.g}-${next.secs}`} secs={next.secs} onDone={next.go} />}
                <button onClick={() => go(0)}>{tx('⏮ ver de novo')}</button>
                {next?.has && <button className="primary" onClick={next.go}>{tx('seguinte ▶')}</button>}
                {!next?.has && live && <span className="muted small">{tx('o próximo jogo ainda está a ser jogado…')}</span>}
              </span>
            </div>
          )}
        </div>
        <ol className="blog" ref={logRef}>
          {evs.slice(Math.max(0, i - 60), i).map((e, k) => {
            const j = Math.max(0, i - 60) + k
            if (e.tm) return null  // Two-Headed Giant: a mesma vida no parceiro
            return <li key={j} className={`p-${e.p || ''} k-${e.k} ${j === i - 1 ? 'now' : ''}`} title={e.txt} onClick={() => { setPlaying(false); go(j + 1) }}><Named text={describe(e, who)} names={[e.card, S.includes(e.target) ? null : e.target, e.to, ...(e.zn || []).map(z => z.card)]} /></li>
          })}
        </ol>
      </div>
      {hoverStyle && zinfo && <div className="zoomhover" style={hoverStyle}><ZoomCard info={zinfo} /></div>}
      {zoom?.pin && zinfo && <div className="zoomover" onClick={e => { e.stopPropagation(); setZoom(null) }}><ZoomCard info={zinfo} big /></div>}
      {zone && (
        <div className="zoomover zonelist" onClick={e => { if (e.target === e.currentTarget) setZone(null) }}>
          <div className="zl-box">
            <div className="row-btns"><b>{zone.which === 'graveyard' ? tx('Cemitério de {p}', { p: who[zone.k] }) : tx('Exílio de {p}', { p: who[zone.k] })} · {zoneCards.length}</b><button onClick={() => setZone(null)}>{tx('Fechar')}</button></div>
            <div className="zl-grid">{zoneCards.map((n, j) => { const c = lookup(data, n); return <div key={j} className="zl-c" data-z={n ? `n:${n}` : undefined} title={n || tx('Carta desconhecida (o Forge não diz qual)')}>{c ? <img src={img(c, 'small', false, artOf(arts, zone.k, c))} alt={n} /> : <span className="pc-back" />}</div> })}</div>
            {zoneCards.includes(null) && <p className="muted small">{tx('As cartas de costas foram para lá sem o Forge dizer quais (vigiar, moer, procurar).')}</p>}
          </div>
        </div>
      )}
    </div></Arts.Provider>
  )
}
