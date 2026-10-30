// Tabuleiro (repetição e ao vivo), ao estilo de uma mesa digital: aplica os eventos do Forge ao modelo de estado
// (game.js) e anima só o que mudou em cada passo (a carta que entrou/virou/atacou/morreu, a vida que mudou).
// Controlos: pausa, velocidade, passo, salto de turno, linha do tempo com marcas por tipo de evento.
import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { img, artPick, artMapOf, basicSplit, sf } from './data.js'
import { tx, num, LANG } from './i18n.js'
import { tokenCard } from './tokens.js'
import { useColors, sideColors, Syms } from './ui.jsx'
import { playEvent, play } from './sfx.js'
import { PHASES, replayStates, lookup, isCreature, isLand, powTough, typeOf, markDormant, CT, CT_ICON } from './game.js'

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
    case 'life': return tx('{P}: vida {n}', { P, n: ev.n })
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
    case 'outcome': return / has won/.test(ev.txt || '') ? tx('{P} ganha o jogo', { P }) : tx('{P} perde o jogo', { P })
    default: {
      if (ev.x && ev.target) {  // mudança de zona exata sem frase própria (zone/other)
        const [fr, to] = ev.target.split('>')
        const hidden = ev.p !== 'a' && [fr, to].every(z => z === 'hand' || z === 'library')  // a mão dos adversários não se mostra
        return `${hidden ? tx('Uma carta') : c}: ${ZN[fr] || fr} → ${ZN[to] || to}`
      }
      // linhas informativas do Forge (em inglês): traduz as mais comuns
      const t = ev.txt || ''
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
const Arts = createContext({ arts: null, k: null })
const artOf = (arts, k, c, inst) => c && artPick((arts && (k ? arts[k]?.[c.n] : Object.values(arts).map(x => x?.[c.n]).find(Boolean))) || basicSplit(c.n), inst)  // sem arte do deck: as várias artes por omissão dos básicos
const useImg = () => { const { arts, k } = useContext(Arts); return (c, size, back, side = k, inst) => img(c, size, back, artOf(arts, side, c, inst)) }
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
    : kind === 'activate' ? lines.find(l => /^[^"]{1,60}:/.test(l) && !/Add \{/.test(l)) || lines.find(l => l.includes(':')) : null
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
function hiText(t) {  // texto → pedaços com <b class> nas frases-chave (a primeira que apanha ganha)
  const hits = []
  for (const [k, re] of KEYS) for (const m of t.matchAll(re)) if (!hits.some(h => m.index < h.e && m.index + m[0].length > h.s)) hits.push({ s: m.index, e: m.index + m[0].length, k })
  hits.sort((a, b) => a.s - b.s)
  const out = []
  let i = 0
  hits.forEach((h, j) => { if (h.s > i) out.push(t.slice(i, h.s)); out.push(<b key={j} className={`fx-${h.k}`}>{t.slice(h.s, h.e)}</b>); i = h.e })
  if (i < t.length) out.push(t.slice(i))
  return out
}
export function StackFx({ s, rev, ri, data, arts, quiet, who, speed }) {
  const [ghost, setGhost] = useState(null), [nudge, setNudge] = useState(false), n = s.stack.length, prevN = useRef(n), gT = useRef(null)
  // resolver: a carta brilha e a legenda mostra o efeito real o tempo de o ler (pelo tamanho do texto e pela velocidade
  // escolhida); o temporizador é só dele, por isso o evento seguinte já não o cancela (a legenda ficava lá para sempre)
  useEffect(() => {
    if (quiet || rev?.k !== 'resolve' || !rev.card) return
    const named = String(rev.txt || '').replace(/^.*? - /, '').replace(/Ai\(\d+\)-([A-D])\b/g, (m, k) => short(who[k.toLowerCase()]) || m)  // «Ai(2)-B» → nome do deck
    const txt = clean(named), ms = Math.round(Math.min(7000, 1400 + txt.length * 28) / Math.max(0.5, speed || 1))
    setGhost({ key: ri, card: rev.card, p: rev.p, txt, ms })
    clearTimeout(gT.current)
    gT.current = setTimeout(() => setGhost(null), ms)
  }, [ri]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (quiet) { clearTimeout(gT.current); setGhost(null) } }, [quiet])
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
          <In key={x.uid} quiet={quiet} className={`stk ${x.p || ''} ${x.kind} ${j === n - 1 ? 'top' : ''}`} style={{ '--j': j, '--r': `${tilt(x.uid)}deg` }} data-z={x.card ? `n:${x.card}` : undefined}>
            {pic(x.card, x.p, x.kind)}
          </In>
        ))}
        {ghost && <div key={`g${ghost.key}`} className={`stk resolving ${ghost.p || ''}`} style={{ '--j': n, '--d': `${ghost.ms}ms` }}>{pic(ghost.card, ghost.p)}</div>}
      {(top || ghost) && (
        <div key={top ? `t${top.uid}` : `g${ghost.key}`} className={`stk-cap ${(top || ghost).p || ''} ${top ? '' : 'res'}`}>
          {top ? <>
            <small>{KIND_L[top.kind] || top.kind}{n > 1 ? ` · ${tx('{n} na pilha', { n })}` : ''}</small>
            <b>{short(top.card) || tx('habilidade')}{tgt ? <span className="muted"> → {tgt}</span> : null}</b>
            {tc && <p>{hiText(effectOf(tc, top.kind))}</p>}
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
export const Perm = memo(function Perm({ p, data, hl, pop, att, n, quiet, tgt }) {  // tgt: [lado, nome] do jogador atacado (3+ jogadores)
  const [enter] = useState(() => !quiet && !(Date.now() - (seenAt.get(p.key) || 0) < 600000))
  const c = lookup(data, p.name)
  const creature = isCreature(data, p)
  const pt = creature ? powTough(data, p) : null
  const kws = kwsOf(c, p)
  const back = backUp(c, p), upside = back && !c?.df && !p.hidden  // carta flip (Kamigawa): a mesma imagem, rodada 180°
  const ctr = Object.entries(p.counters || {}).filter(([k]) => k !== 'loyalty' && k !== 'defense')
  const cls = ['pc', p.tapped && 'tapped', p.attacking && 'atk', p.blocking && 'blk', p.dying && 'dying', p.token && 'tok', hl && `hl${hl}`, p.sick && 'sick', creature && 'cre', p.dormant && 'dormant', p.phased && 'phased', p.faceDown && 'down', enter && 'in'].filter(Boolean).join(' ')
  const title = [short(p.face || p.name), p.faceDown && tx('virada para baixo'), p.phased && tx('fora de fase (phasing): não conta como estando em jogo'), p.copy && tx('cópia'), p.merged?.length > 1 && tx('mutada: {x}', { x: p.merged.map(short).join(' + ') }), p.dormant && tx('não é criatura: devoção {d} de {n}', { d: p.dormant.d, n: p.dormant.need }), p.sick && tx('enjoo de invocação'), p.tapped && tx('virada')].filter(Boolean).join(' · ')
  tgt = tgt || (p.atkName ? ['x', short(p.atkName)] : null)  // ataca um planeswalker ou uma batalha
  return (
    <div className={cls} data-z={`k:${p.key}`} title={title}>
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
        {pt && <b className={`pc-pt ${pt.boosted ? 'up' : ''} ${pt.hurt ? 'down' : ''}`}>{pt.p}/{pt.t}</b>}
        {p.counters?.loyalty != null && <b key={`l${p.counters.loyalty}`} className={`pc-loy ${pop?.ct === 'loyalty' && !quiet ? (pop.n > 0 ? 'up' : 'down') : ''}`} title={tx('Lealdade')}>{p.counters.loyalty}</b>}
        {p.counters?.defense != null && <b key={`d${p.counters.defense}`} className={`pc-loy def ${pop?.ct === 'defense' && !quiet ? 'down' : ''}`} title={tx('Defesa (batalha)')}>⛨{p.counters.defense}</b>}
        {ctr.length > 0 && <span className="pc-ctr">{ctr.map(([k, v]) => <b key={`${k}${v}`} className={`c-${k === '+1/+1' ? 'p1' : k === '-1/-1' ? 'm1' : k}`} title={tx('{n} marcador {ct}|{n} marcadores {ct}', { n: v, ct: CT[k] || k })}>{k === '+1/+1' ? `+${v}` : k === '-1/-1' ? `−${v}` : CT_ICON[k] ? `${CT_ICON[k]}${v}` : `${CT_SHORT[k] || (CT[k] || k).slice(0, 5)} ${v}`}</b>)}</span>}
        {(p.copy || p.merged?.length > 1 || (p.faceDown && !p.hidden)) && <span className="pc-tags">{p.faceDown && !p.hidden && <i title={tx('Virada para baixo: só tu sabes qual é')}>👁</i>}{p.copy && <i title={tx('Cópia')}>⎘</i>}{p.merged?.length > 1 && <i title={tx('mutada: {x}', { x: p.merged.map(short).join(' + ') })}>⧉{p.merged.length}</i>}</span>}
        {kws.length > 0 && <span className="pc-kw">{kws.map(k => <i key={k} title={KW[k][1]}>{KW[k][0]}</i>)}</span>}
        {p.sick && <i className="pc-zz" title={tx('Enjoo de invocação: entrou neste turno')}>z<sup>z</sup></i>}
        {p.goaded && <i className="pc-goad" title={tx('Incitada')}>⚑</i>}
        {n > 1 && <b className="pc-n">×{n}</b>}
        {tgt && <i className={`pc-tgt t-${tgt[0]}`} title={tx('Ataca {x}', { x: tgt[1] })}>⚔ {tgt[1]}</i>}
        {(p.est || p.hidden) && <i className="pc-est" title={p.hidden ? tx('Estimativa: terreno procurado na biblioteca; o registo deste jogo (antigo) não diz qual.') : EST}>≈</i>}
      </div>
      {pop && !quiet && <i key={pop.i} className={`pc-pop ${pop.kind} ${pop.ct === 'loyalty' ? 'loyalty' : ''}`}>{pop.kind === 'flip' ? '⟲' : pop.kind === 'enter' ? pop.txt : pop.kind === 'pump' ? pop.pt : `${pop.n > 0 ? '+' : '−'}${Math.abs(pop.n)}${pop.ct && pop.ct !== '+1/+1' && pop.ct !== 'loyalty' ? ` ${CT_ICON[pop.ct] || CT[pop.ct] || pop.ct}` : ''}`}</i>}
    </div>
  )
})

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
function Orb({ life, d, step, hit, fast, start, poison = 0, psnHit }) {  // poison: o veneno ao lado da vida (10 = derrota)
  const ref = useRef(null), prev = useRef(life)
  useEffect(() => {
    const el = ref.current, from = prev.current
    prev.current = life
    if (!el) return
    if (fast || from === life || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.textContent = life; return }
    let raf, t0
    const tick = t => {
      t0 ??= t
      const k = Math.min(1, (t - t0) / 450)
      el.textContent = Math.round(from + (life - from) * k)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); el.textContent = life }
  }, [life, fast])
  const low = life <= Math.max(5, Math.round(start / 4))
  return (
    <div className={`orb ${low ? 'low' : ''}`} title={tx('{n} de vida', { n: life })}>
      <b ref={ref}>{life}</b><small>{tx('vida')}</small>
      {d && !fast ? <i key={step} className={`orb-flash ${d < 0 ? 'loss' : 'gain'}`} /> : null}
      {d && !fast ? <i key={`f${step}`} className={`float ${d < 0 ? 'loss' : 'gain'}`}>{d > 0 ? '+' : '−'}{Math.abs(d)}</i> : null}
      {hit && !fast ? <i key={`h${step}`} className="orb-hit" /> : null}
      {poison > 0 && <i key={psnHit && !fast ? `p${step}` : 'p'} className={`orb-psn ${poison >= 7 ? 'crit' : ''} ${psnHit && !fast ? 'up' : ''}`} title={tx('{n} marcadores de veneno (10 = derrota)', { n: poison })}>☠ {poison}</i>}
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

// de onde vem o deck de cada lugar: meta, meu, de um amigo ou da comunidade (ao lado da etiqueta do bot)
const OWN = { meta: ['📊', tx('Meta'), tx('Deck do meta (torneios reais)')], meu: ['🧙', tx('Meu'), tx('Um deck teu')], ami: ['🤝', tx('Amigo'), tx('Deck de um amigo')], com: ['🌐', tx('Comunidade'), tx('Deck da comunidade (de outra pessoa)')] }
export function Hud({ k, z, name, fmt, s, data, fx, fast, start, openZone, top, hand, bet, bot, own, openLib }) {  // openLib: clicar na biblioteca (mesa livre: comprar)  // bet: as minhas apostas neste deck (torneios)  // hand: a mão fica nesta linha, ao centro (em baixo a nossa, em cima a do adversário)
  const cmdDmg = Object.entries(z.cmdDmg || {}), im = useImg()
  return (
    <div className={`bhud ${hand ? 'withhand' : ''}`}>
      <Orb life={z.life} d={fx.life?.p === k ? fx.life.d : 0} hit={fx.player?.p === k} step={s.i} fast={fast} start={start} poison={z.poison} psnHit={fx.player?.p === k && fx.player?.psn} />
      <div className="bname">
        <b title={name}>{name}</b>
        <span className="chips">
          {fmt && <span className="fmt-tag">{fmt}</span>}
          {bot && <span className="fmt-tag bot" title={bot.title}>🤖 {bot.label}</span>}
          {OWN[own] && <span className={`fmt-tag own own-${own}`} title={OWN[own][2]}>{OWN[own][0]} {OWN[own][1]}</span>}
          {bet && <span className={`chip bet ${bet.st}`} title={bet.title}>🪙 {bet.txt}</span>}
          {s.active === k && !z.out && <span className="turnpill">{tx('a jogar')}</span>}
          {z.poison > 0 && <span className="chip psn" title={tx('Marcadores de veneno (10 = derrota)')}>☠ {z.poison}</span>}
          {z.energy > 0 && <span className="chip" title={tx('Energia')}>ϟ {z.energy}</span>}
          {z.monarch && <span className="chip gold" title={tx('Monarca: compra uma carta extra no fim do turno')}>♛ {tx('monarca')}</span>}
          {z.initiative && <span className="chip gold" title={tx('Iniciativa (Masmorra Subterrânea)')}>⚑ {tx('iniciativa')}</span>}
          {z.blessing && <span className="chip gold" title={tx('Bênção da cidade (ascender): fica para o resto do jogo')}>🏙 {tx('bênção')}</span>}
          {z.speed > 0 && <span className="chip" title={tx('Velocidade (Start your engines!): sobe uma vez por turno, até 4')}>🏁 {z.speed}</span>}
          {Object.entries(z.pctr || {}).map(([k, v]) => <span key={k} className="chip" title={tx('{n} marcador {ct}|{n} marcadores {ct}', { n: v, ct: CT[k] || k })}>{k === 'rad' ? '☢' : k === 'experience' ? '✦' : '◆'} {v}</span>)}
          {z.emblems?.length > 0 && <span className="chip" title={z.emblems.map(short).join(', ')}>✦ {tx('{n} emblema|{n} emblemas', { n: z.emblems.length })}</span>}
          {cmdDmg.map(([n, v]) => <span key={n} className={`chip ${v >= 15 ? 'psn' : ''}`} title={tx('Dano de comandante de {c} (21 = derrota)', { c: short(n) })}>⚔ {v}/21</span>)}
          {z.out ? <span className="chip psn">{tx('eliminado no turno {n}', { n: z.out })}</span> : s.over?.loser === k ? <span className="chip psn">{tx('derrota')}</span> : null}
        </span>
      </div>
      {hand}
      <div className="zones">
        {z.command.map(c => {
          const cc = lookup(data, c.name)
          return (
            <div key={c.name} className={`cmdz ${c.out ? 'out' : ''}`} title={`${tx('Zona de comando: {c}', { c: short(c.name) })}${c.room ? ` · ${tx('sala: {r}', { r: c.room })}` : ''}${c.casts ? ` · ${tx('lançado {n}× · imposto +{x}', { n: c.casts, x: 2 * c.casts })}` : ''}${c.out ? ` ${tx('(está em jogo ou na pilha)')}` : ''}`} data-z={`n:${c.name}`}>
              {cc ? <img src={im(cc, 'art_crop')} alt={c.name} /> : <span>{short(c.name)}</span>}
              <small>{c.casts ? `+${2 * c.casts}` : c.room ? '⚑' : 'cmd'}</small>
            </div>
          )
        })}
        <Pile label={tx('Biblioteca')} icon="▤" count={z.library} back est={!s.exact} data={data} zone="library" onOpen={openLib && (() => openLib(k))} />
        {(k !== 'a' || top) && !s.exact && <div className="bhand" title={`${tx('{n} carta na mão|{n} cartas na mão', { n: z.hand })}${s.exact ? '' : ` ${tx('(estimativa)')}`}`}>{Array.from({ length: Math.min(8, z.hand) }).map((_, j) => <span key={j} className="back" />)}<small>✋ {s.exact ? '' : '≈'}{z.hand}</small></div>}
        <Pile label={tx('Cemitério')} icon="⚰" cards={z.graveyard} data={data} quiet={fast} onOpen={() => openZone(k, 'graveyard')} zone="graveyard" />
        <Pile label={tx('Exílio')} icon="⌀" cards={z.exile} data={data} quiet={fast} onOpen={() => openZone(k, 'exile')} zone="exile" />
      </div>
    </div>
  )
}

export function Side({ k, name, s, data, fx, att, top, fast, start, openZone, hand, compact, who, hit, formats, bets, bots, place, order, owns, free }) {  // free: cartas pousadas à mão fora das filas (Forge Play: {key: {x, y}}, o centro em fração do lado)  // hand: a mão vai ao centro da faixa dos terrenos; place/order: arrumação à mão (Forge Play: {key: 'front'|'lands'|'others'} e {key: posição})
  const z = s[k]  // compact: um de 3–4 jogadores (cartas mais pequenas); hit: está a ser atacado
  const all = s.sides.flatMap(x => s[x].perms)
  const live = markDormant(data, z.perms).filter(p => !p.attachedTo || !all.some(x => x.key === p.attachedTo))  // deuses abaixo da devoção: não são criaturas
  const creatures = [], lands = [], others = [], loose = []
  for (const p of live) { if (free?.[p.key]) { loose.push(p); continue } const r = place?.[p.key] || (isCreature(data, p) ? 'front' : isLand(data, p) ? 'lands' : 'others'); (r === 'front' ? creatures : r === 'lands' ? lands : others).push(p) }
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
    <Arts.Provider value={art}><div className={`bside ${top ? 'top' : 'bottom'} ${s.active === k ? 'act' : ''} ${compact ? 'compact' : ''} ${z.out ? 'out' : ''} ${hit ? 'hit' : ''} p-${k}`}>
      {top ? <>{hud}{back}{front}</> : <>{front}{back}{hud}</>}
      {loose.length > 0 && <div className="bfree">{loose.map(p => (
        <div key={p.key} className={`bfree-c ${isCreature(data, p) ? 'front' : isLand(data, p) ? 'lands' : 'others'}`} style={{ left: `${free[p.key].x * 100}%`, top: `${free[p.key].y * 100}%` }}>
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
        const c = lookup(data, p.name)
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

export default function Replay({ data, game, onBack, backLabel = tx('← Relatório'), deckName, pov = 'a', track = false, bets, bots, live = false, next, speed0, onSpeed, hands: hands0, onHands, onPlayFrom, score, arts: arts0, formats, owns }) {  // arts: {a: {nome: link}, b: …} arte própria de cada deck (torneio: game.arts; Laboratório: game.decks); formats: {a: 'Pauper', b: …} (modo casual)
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
    const size = () => narrow() ? tbl().getBoundingClientRect().height : el.offsetHeight  // com zoom, a altura que se vê
    const avail = () => {
      // dentro de uma janela (ver ao vivo, repetições do torneio) mede-se na janela; em ecrã inteiro no elemento; senão na página
      const md = el.closest('.modal'), fe = document.fullscreenElement || document.webkitFullscreenElement
      const sc = md || (fe?.contains(el) ? fe : null), vh = window.visualViewport?.height || innerHeight  // altura visível real (tablet)
      if (narrow()) return (md ? Math.min(vh, innerHeight - 24) : vh) - (tbl().getBoundingClientRect().top - el.getBoundingClientRect().top) - 8
      const top = el.getBoundingClientRect().top + (sc ? sc.scrollTop - sc.getBoundingClientRect().top : scrollY)
      return (md ? Math.min(vh, innerHeight - 24) : vh) - top - 8
    }
    const fit = (force = false) => {
      // telemóvel: tamanho normal (ou o zoom escolhido em −/+); o ajuste ao ecrã só com ⤢ (encolhia tudo até ficar ilegível)
      if (narrow() && !force) return el.style.setProperty('--fit', adjM())
      // a altura é fixa (barras, etiquetas) + proporcional ao --fit: com a secante acerta em 2–3 medições
      // (o f × livre/altura parava a 6–10px do alvo e o resultado dependia do caminho: janela, ecrã inteiro, zoom do sistema)
      const a = avail(), h = f => { el.style.setProperty('--fit', f); return size() }
      let f0 = 1, h0 = h(1), f = Math.max(0.4, Math.min(1.6, a / h0))
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
    const later = () => { fit(); tm.forEach(clearTimeout); tm = [150, 450, 1000].map(t => setTimeout(fit, t)) }
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
  const evs = useMemo(() => game.events || [], [game])
  const [pos, setPos] = useState({ i: 0, jump: true })
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeedS] = useState(speed0 ?? (live ? 3 : 2))
  const setSpeed = v => { setSpeedS(v); onSpeed?.(v) }  // o ritmo escolhido passa para o jogo seguinte
  const [zoom, setZoom] = useState(null)
  const [zone, setZone] = useState(null)
  const [more, setMore] = useState(false)  // telemóvel: velocidade, mãos e turno atrás do ⚙
  const logRef = useRef(null)
  const start = game.startLife || 20
  const states = useMemo(() => replayStates(evs, data, start, game.setup || null, !!game.exact), [evs, data, start, game.setup, game.exact])
  const i = Math.min(pos.i, evs.length)
  const go = (n, jump = true) => setPos({ i: Math.max(0, Math.min(evs.length, n)), jump })
  useEffect(() => {
    if (!playing || i >= evs.length) return
    const k = evs[i]?.k
    const t = setTimeout(() => setPos(p => ({ i: Math.min(evs.length, p.i + 1), jump: false })), Math.max(30, (900 / speed) * (PACE[k] ?? 0.7)))
    return () => clearTimeout(t)
  }, [playing, i, speed, evs])
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [i])
  const s = states[i]
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
  const actor = s.sides.includes(rev?.p) ? rev.p : null
  // 3–4 jogadores: adversários em colunas em cima; o parceiro de equipa (game.teams) ao lado do teu deck, em baixo
  const S = s.sides, multi = S.length > 2
  const mates = multi && game.teams ? S.filter(k => k !== 'a' && game.teams[k] === game.teams.a) : []
  const tops = S.filter(k => k !== 'a' && !mates.includes(k))
  const hit = new Set(multi ? S.flatMap(k => s[k].perms.map(p => p.attacking)).filter(x => S.includes(x)) : [])
  const fm = k => (formats?.[k] ? <span className="fmt-tag">{formats[k]}</span> : null)
  const ownOf = d => (!d ? null : d.friend ? 'ami' : d.community ? 'com' : d.source === 'MTGTop8' || d.source === 'EDHREC' || 'archetype' in d ? 'meta' : 'meu')
  const own = owns || (game.decks && Object.fromEntries(Object.entries(game.decks).map(([k, d]) => [k, ownOf(d)])))  // Laboratório: dos decks do jogo
  const sp = { formats, s, data, fx, att, fast: fast || pos.jump, start, openZone, bets, bots, owns: own }
  const oppHand = k => game.exact && <Hand z={s[k]} data={data} quiet={fast || pos.jump} exact opp hidden={hands !== 'ambas'} label={mates.includes(k) ? tx('Mão do parceiro') : null} />
  return (
    <Arts.Provider value={art}><div ref={boardRef} className={`view board ${live ? 'live' : ''} ${fast ? 'fast' : ''} ${pos.jump ? 'instant' : ''} ${fast || pos.jump ? 'quiet' : ''}`} style={sideVars}
      onPointerOver={onOver} onPointerLeave={() => zoom && !zoom.pin && setZoom(null)}
      onPointerDown={onPress} onPointerUp={unPress} onPointerCancel={unPress} onPointerMove={unPress} onClick={onTap} onContextMenu={e => { if (e.target.closest('[data-z]')) e.preventDefault() }}>
      <div className="rp-bar">
        {onBack && <button onClick={onBack}>{backLabel}</button>}
        {score?.wins ? <ScoreN sc={score} ended={ended} game={game} who={who} fm={fm} /> : score ? <Score sc={score} ended={ended} winner={game.winner} a={mates.length ? [deckName, ...mates.map(k => who[k])].join(' + ') : deckName} b={mates.length ? tops.map(k => who[k]).join(' + ') : game.opp} fa={!mates.length && fm('a')} fb={!mates.length && fm('b')} />
          : formats ? <b>{S.map((k, j) => <span key={k}>{j ? (multi ? ' · ' : ' vs ') : ''}{who[k]} {fm(k)}</span>)}</b> : <b>{multi ? S.map(k => who[k]).join(' · ') : `${deckName} vs ${game.opp}`}</b>}
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
        <select className="rp-x" value={hands} onChange={e => setHands(e.target.value)} aria-label={tx('Mãos à vista')}>{HANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="rp-x" value={s.turn || ''} onChange={e => go(evs.findIndex(x => x.t === +e.target.value))} aria-label={tx('Ir para o turno')}>{turns.map(t => <option key={t} value={t}>{tx('Turno {t}', { t })}</option>)}</select>
        <div className="rp-time">
          <Timeline evs={evs} i={i} onSeek={n => { setPlaying(false); go(n) }} />
          <input type="range" className="rp-scrub" min="0" max={evs.length} value={i} onChange={e => { setPlaying(false); go(+e.target.value) }} aria-label={tx('Posição no jogo')} />
        </div>
        <span className="muted small">{i}/{evs.length}</span>
      </div>
      <div className="bwrap">
        <div className={`table ${multi ? 'multi' : ''} ${track && pov ? `track-${pov}` : ''}`}>
          {multi
            ? <div className="opps" style={{ '--np': tops.length }}>{tops.map(k => <Side key={k} k={k} name={who[k]} {...sp} top compact who={who} hit={hit.has(k)} hand={oppHand(k)} />)}</div>
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
            return mates.length ? <div className="mine withmate">{me}{mates.map(k => <Side key={k} k={k} name={who[k]} {...sp} compact who={who} hit={hit.has(k)} hand={oppHand(k)} />)}</div> : me
          })()}
          {ended && (
            <div className={`endbanner ${game.stopped ? 'draw stopped' : !game.winner || game.winner === 'draw' ? 'draw' : pov === 'a' ? (game.winner === 'a' ? 'win' : 'loss') : !pov ? 'neutral' : game.winner === pov ? 'win' : 'loss'}`} role="status">
              <b>{game.stopped ? tx('⏹ Interrompido no turno {t} (não conta)', { t: game.turns || s.turn || 0 }) : pov !== 'a' ? (!game.winner || game.winner === 'draw' ? tx('Empate') : tx('«{d}» venceu no turno {t}', { d: who[game.winner], t: game.turns })) : game.winner === 'a' ? (mates.length ? tx('Vitória da equipa no turno {t}', { t: game.turns }) : tx('Vitória no turno {t}', { t: game.turns })) : !lost(game.winner) ? tx('Empate') : mates.length ? tx('Derrota da equipa no turno {t}', { t: game.turns }) : multi ? `${game.places ? tx('{p} lugar', { p: ord(game.places.indexOf('a') + 1) }) : tx('Derrota')}${s.a.out ? ` — ${tx('eliminado no turno {n}', { n: s.a.out })}` : ''}` : tx('Derrota no turno {t}', { t: game.turns })}</b>
              {multi && game.places && !mates.length && <span>{game.places.map((k, j) => `${ord(j + 1)} ${short(who[k])}`).join(' · ')}</span>}
              <span>{tx('Vida final: {x}', { x: S.map(k => `${who[k]} ${s[k].life}`).join(' · ') })}</span>
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
