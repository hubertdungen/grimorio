// Forge Play nativo: jogas contra a IA do Forge com a mesa do Grimório. O motor corre no servidor (playnet.py +
// build/forge/GrimorioNet.java) e manda o estado do jogo, o pedido atual (o que o motor espera de ti) e as escolhas
// pendentes; aqui desenha-se a mesa e cada clique volta como comando (carta, jogador, OK/cancelar, mana, responder).
import './fpreveal.css'
import './fpchoice.css'
import { fpPrefs, setFpPrefs, cardVars } from './fpprefs.js'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { img } from './data.js'
import { Side, Hand, StackFx, CardPx, MatPick, CombatLinks, StackLinks, DamageFx, ZoneFx, Arts, useImg, artOf, OrbCtx, FsBtn, ORB_DEATH } from './Board.jsx'
import { ctrs, toPerm, zoneOf } from './fpboard.js'
import { tx } from './i18n.js'
import { playDiff, play } from './sfx.js'
import { ask as confirmAsk } from './confirm.jsx'
import { addDmg, lookup } from './game.js'
import { Syms } from './ui.jsx'
import RulesQuick from './rulesquick.jsx'
import { obviousPay } from './mana.js'
import { useBackClose } from './backnav.js'
import { showCardPeek, hideCardPeek, pressPeek } from './deckview.js'
import { useDrag, STAGE, useOverlap, useStage, useFlip, spotOn, usePeek, useTableDice, useZoneFlights } from './tablekit.js'

async function j(url, body) {
  const r = await fetch(url, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`)
  return d
}

const PHASES = [  // as fases do Forge agrupadas como na mesa: a pastilha acende na fase em curso
  ['ini', tx('Início'), ['UNTAP', 'UPKEEP', 'DRAW']],
  ['m1', tx('Principal 1'), ['MAIN1']],
  ['cmb', tx('Combate'), ['COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END']],
  ['m2', tx('Principal 2'), ['MAIN2']],
  ['fim', tx('Fim'), ['END_OF_TURN', 'CLEANUP']],
]
const BTN = { OK: tx('OK'), Cancel: tx('Cancelar'), 'End Turn': tx('Acabar o turno'), Keep: tx('Ficar com a mão'), Mulligan: 'Mulligan', Play: tx('Jogar primeiro'), Draw: tx('Comprar (ir em segundo)'), Auto: tx('Pagar sozinho'), Yes: tx('Sim'), No: tx('Não'), 'Alpha Strike': tx('Atacar com tudo'), 'Call Back': tx('Retirar atacantes'), Library: tx('Biblioteca (topo)'), Graveyard: tx('Cemitério'), Top: tx('Topo da biblioteca'), Bottom: tx('Fundo da biblioteca') }
const MANA = { W: '#f3ecd0', U: '#4a90d9', B: '#6d5b70', R: '#e0553b', G: '#3fa560', C: '#b7b2a8' }

// o texto do Forge (inglês) passa a uma frase curta do Grimório; o que não se reconhece fica como vem
// como acabou, em texto (a janela do fim): «Bot: 10 marcadores de veneno», «Vitória alternativa: Thassa's Oracle»
const LOSS_TXT = { LifeReachedZero: tx('vida a 0'), Poisoned: tx('10 marcadores de veneno'), Milled: tx('sem cartas para comprar'), CommanderDamage: tx('21 de dano do mesmo comandante'),
  SpellEffect: tx('uma carta disse que perdia o jogo'), OpponentWon: tx('o adversário ganhou por outra via'), Conceded: tx('desistiu'), IntentionalDraw: tx('empate combinado') }
function endWhy(out) {
  const lost = (out || []).filter(x => LOSS_TXT[x.r]), alt = (out || []).find(x => x.r === 'altwin')
  return [...lost.map(x => `${x.name}: ${LOSS_TXT[x.r]}${x.card ? ` (${x.card})` : ''}`), ...(alt?.card ? [tx('Vitória alternativa: {c}', { c: alt.card })] : [])].join(' · ')
}
// o Forge pede atacantes/bloqueadores? Um pedido de prioridade traz «Phase: Declare Attackers Step» e não é isso: antes
// passava por pedido de atacantes (no turno da IA ficava «o adversário está a pensar» com o OK escondido) e, no passo dos
// bloqueadores, os cliques viravam bloqueios
const ATK_ASK = m => !!m && !/^(Priority:|Waiting for)/.test(m) && /Declare attackers|Select creatures to attack/i.test(m)
const BLK_ASK = m => !!m && !/^(Priority:|Waiting for)/.test(m) && /Declare blockers|Select creatures to block/i.test(m)
function promptText(msg, st, me) {
  const m = String(msg || '')
  if (!m) return ''
  if (/^Priority:/.test(m)) {
    if (st?.stack?.length) return tx('Há {n} na pilha: responde com um instantâneo ou OK para deixar resolver.', { n: st.stack.length })
    const mine = st?.active === me?.id, main = st?.phase === 'MAIN1' || st?.phase === 'MAIN2'
    return mine && main ? tx('O teu turno: arrasta um terreno ou uma carta para a mesa (ou duplo clique), ou OK para avançar.') : tx('Tens prioridade: OK para passar.')
  }
  if (/^Waiting for/.test(m)) return tx('O adversário está a pensar…')
  const sv = m.match(/Put (.+?) on the top of library or graveyard/i), sc = m.match(/Put (.+?) on (?:the )?top or bottom of (?:your )?library/i)
  if (sv) return tx('Vigiar: {c} fica no topo da biblioteca ou vai para o cemitério?', { c: sv[1] })
  if (sc) return tx('Vidência: {c} fica no topo ou vai para o fundo da biblioteca?', { c: sc[1] })
  if (/you have won the coin toss/i.test(m)) return tx('Ganhaste a moeda ao ar: jogas primeiro ou vais em segundo?')
  if (/you lost the last game/i.test(m)) return tx('Perdeste o jogo anterior: escolhes tu — jogas primeiro ou vais em segundo?')
  if (/lost the last game/i.test(m)) return tx('{p} perdeu o jogo anterior: escolhe quem começa.', { p: m.split(/ lost the last/i)[0].trim() || tx('o adversário') })
  if (/has won the coin toss/i.test(m)) return tx('{p} ganhou a moeda ao ar.', { p: m.split(/ has won/i)[0].trim() || tx('o adversário') })
  // «you are going first!» = começas tu; «IA is going first.\nTu, you are going 2nd.» = começa outro (antes dava sempre «Começas tu»)
  if (/keep your hand/.test(m)) {
    if (/you are going first/i.test(m)) return tx('Começas tu. Ficas com esta mão?')
    const who = m.match(/^(.+?) is going first/m)?.[1]
    return who ? tx('Começa {n}. Ficas com esta mão?', { n: who }) : tx('Começa o adversário. Ficas com esta mão?')
  }
  // descartar (mão cheia, Faithless Looting…): quantas já escolheste — as escolhidas sobem com moldura dourada
  const disc = m.match(/(?:Select|Choose) (\d+) cards?(?:\(s\))? to discard|Discard (\d+) cards?/i)
  const got = (me?.hand || []).filter(c => c.picked).length
  if (disc) return `${/^Select \d+ card\(s\) to discard/i.test(m) && st?.phase === 'CLEANUP' ? tx('Mão cheia: clica em {n} carta(s) da mão para descartar.', { n: disc[1] || disc[2] }) : tx('Descartar: clica em {n} carta(s) da mão.', { n: disc[1] || disc[2] })} ${tx('Escolhidas: {k} de {n}.', { k: got, n: disc[1] || disc[2] })}`
  // «Spider Umbra (4) - Spider Umbra\n\nSelect target creature»: o pedido nem sempre vem na 1.ª linha
  const hl = m.match(/^Click one of the highlighted cards\.?\s*(?:\((.+)\))?/i)
  if (hl) return hl[1] ? `${tx('Clica numa das cartas assinaladas.')} (${hl[1]})` : tx('Clica numa das cartas assinaladas.')
  const ask = m.split('\n').find(l => /^(Select|Choose)/i.test(l.trim()))
  if (ask && st?.players?.some(p => [...(p.hand || []), ...(p.battlefield || [])].some(c => c.sel))) return `${tx('Clica numa das cartas assinaladas.')} (${ask.trim()})`
  if (/Declare attackers|Select creatures to attack/i.test(m)) {
    // «Select creatures to attack Jace, the Mind Sculptor (123) or select player/card you wish to attack.»
    const d = (m.match(/Select creatures to attack (.+?) or select/i)?.[1] || '').replace(/\s*\(\d+\)$/, '')
    const opp = st?.players?.find(p => p !== me && !p.me), pws = (opp?.battlefield || []).some(c => c.loyalty != null || c.counters?.DEFENSE != null)
    const who = d && d !== opp?.name ? tx('Atacar {d}: clica nas criaturas que atacam e depois OK.', { d }) : tx('Atacar: clica nas criaturas que atacam e depois OK.')
    return pws ? `${who} ${tx('Para atacar um planeswalker ou uma batalha, toca nele primeiro (ou larga a criatura em cima dele); toca na esfera dele para voltar a atacar o jogador.')}` : who
  }
  if (/Declare blockers|Select creatures to block/i.test(m)) return tx('Bloquear: clica no atacante e depois na tua criatura que bloqueia; OK no fim.')
  if (/Pay Mana Cost|Pay mana cost/i.test(m)) return `${tx('Paga: toca nos terrenos ou na mana da reserva.')} ${m.split('\n').find(l => /\{/.test(l)) || ''}`
  return m
}

// uma carta solta (mão, escolhas, cemitério): imagem da Scryfall com força/resistência por cima. h = id da carta na mão:
// a mesa trata do clique e do arrastar pelo data-h. picked = já escolhida numa escolha do Forge (descartar 2…)
export function FCard({ c, data, onClick, h, cls = '', big, flip, from, tag }) {  // from: de onde se arrasta (topo da biblioteca); tag: etiqueta por cima
  const im = useImg()  // a arte escolhida no deck (edição, imagem própria, básicos), não a da Scryfall por omissão
  if (!c || c.hidden) return <div className={`fp-card back ${cls}`} />
  const card = lookup(data, c.name)
  const src = card ? im(card, big ? 'normal' : 'small', !!(flip && card.df)) : null  // virada: a outra face (cartas de duas faces)
  // fora da mão (escolhas, mão revelada, cemitério…): a carta em grande por cima de tudo, com o rato ou com o dedo a manter —
  // o painel da carta fica por baixo do fundo escuro do diálogo (cinzento) e no telemóvel nem se vê
  const pk = big && h == null && card ? { ...pressPeek(card), onMouseEnter: e => showCardPeek(e, card), onMouseLeave: hideCardPeek } : null
  return (
    <button type="button" className={`fp-card ${c.sel ? 'sel' : ''} ${c.picked ? 'picked' : ''} ${flip && !card?.df ? 'upside' : ''} ${cls}`} title={c.name} data-h={h} data-from={from} data-zid={c.id}
      {...pk} onClick={onClick && (() => onClick(c))} onContextMenu={e => e.preventDefault()}>
      <span className="fp-cin">{/* na mão só o interior sobe com o rato: o botão (a zona do clique) fica parado */}
        {src ? <img src={src} alt={c.name} loading="lazy" draggable="false" /> : <span className="fp-name">{c.name}</span>}
        {c.pt && <i className="fp-pt">{c.pt[0]}/{c.pt[1]}</i>}
        {tag && <i className="fp-tag">{tag}</i>}
      </span>
    </button>
  )
}

// estado do Forge -> o formato do tabuleiro das repetições (Board.jsx), para a mesa ser igual à da arena: criaturas à
// frente, terrenos (agrupados) e artefactos/encantamentos atrás, a vida no orbe, cemitério e exílio nas pilhas
// marcadores do Forge pelo nome («+1/+1», «Loyalty», «Lore», «Poison»…) -> as chaves do tabuleiro (minúsculas)
// notCre: o Forge diz se é criatura agora (Enduring Vitality de volta do cemitério, deus sem devoção, Imprisoned in the Moon…)
// a mana da reserva: uma mini-esfera 3D com o fluido da cor (o mesmo motor das esferas da vida: luz dourada, água,
// pântano, lava, verde pastoso, metal), que chapinha quando a mana entra ou aumenta; sem WebGL, o botão redondo de cor
const MANA_W = { W: '1,0,0,0,0,0,0', U: '0,1,0,0,0,0,0', B: '0,0,1,0,0,0,0', R: '0,0,0,1,0,0,0', G: '0,0,0,0,1,0,0', C: '0,0,0,0,0,1,0' }
function ManaOrb({ k, n, onClick, title }) {
  const ref = useRef(null), cv = useRef(null), phys = useRef({ vx: 0, vy: 0 })
  useEffect(() => {
    if (!fpPrefs().orb3d) return
    let off, gone = false
    import('./orb3d.js').then(m => { if (!gone && m.webgl3d() && ref.current && cv.current) { ref.current._phys = phys.current; off = m.attachOrb3d(ref.current, cv.current) } }).catch(() => {})
    return () => { gone = true; off?.() }
  }, [])
  useEffect(() => {  // entrou mais mana: um empurrão (a aceleração faz o líquido chapinhar)
    const p = phys.current; p.vx = 900; p.vy = -600
    const t = setTimeout(() => { p.vx = 0; p.vy = 0 }, 60)
    return () => clearTimeout(t)
  }, [n])
  return (
    <button ref={ref} type="button" className="mana3d" data-w={MANA_W[k]} data-cols={k === 'C' ? undefined : k} data-a="calmo" style={{ '--m': MANA[k] }} onClick={onClick} title={title}>
      <canvas ref={cv} className="orb3d" aria-hidden="true" /><b>{n}</b>
    </button>
  )
}
// dia/noite (daybound/nightbound): a pastilha troca com um meio giro quando muda
export const DayNight = ({ v, onClick }) => <button type="button" key={v} className={`fp-day ${v}`} onClick={onClick} disabled={!onClick} title={v === 'day' ? tx('É dia (cartas daybound à vista)') : tx('É noite (cartas nightbound à vista)')}>{v === 'day' ? `☀ ${tx('dia')}` : `☾ ${tx('noite')}`}</button>

// o registo do Forge (as últimas 40 entradas): «Ruin Crab (55)» passa a nome com o rato a mostrar a carta
const NAME_END = /([A-Z][\w'’,-]*(?: (?:[A-Z][\w'’,-]*|of|the|to|and|in|from|for|with|a|an|on|at))*)$/
function Hist({ log, nameOf }) {
  const box = useRef(null)
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [log?.length, log?.[log.length - 1]?.m])
  if (!log?.length) return null
  const line = m => {  // «Affinity played Razortide Bridge (12)» -> só «Razortide Bridge» fica ligado à carta 12
    const out = []; let last = 0
    for (const x of m.matchAll(/ \((\d+)\)/g)) {
      const nm = nameOf(+x[1]), pre = m.slice(last, x.index)
      const name = nm && pre.endsWith(nm) ? nm : NAME_END.exec(pre)?.[1]
      if (!name) continue
      out.push(pre.slice(0, pre.length - name.length), <b key={x.index} className="lg-card" data-zid={x[1]} data-zn={name}>{name}</b>)
      last = x.index + x[0].length
    }
    return [...out, m.slice(last)].map((x, i) => (typeof x === 'string' ? <Syms key={`s${i}`} text={x} /> : x))
  }
  return <ol className="fp-hist" ref={box} aria-label={tx('Histórico do jogo')}>{log.map((e, k) => <li key={k} className={`y-${e.y}`}>{line(e.m)}</li>)}</ol>
}






// FLIP dentro de uma caixa: depois de cada mudança de `dep`, as cartas (data-k) deslizam do sítio antigo para o novo
function useBoxFlip(box, dep) {
  const last = useRef(new Map())
  useLayoutEffect(() => {
    const now = new Map()
    for (const el of box.current?.querySelectorAll('[data-k]') || []) {
      const k = el.dataset.k, r = el.getBoundingClientRect(), o = last.current.get(k)
      now.set(k, r)
      if (!o || (Math.abs(o.left - r.left) < 2 && Math.abs(o.top - r.top) < 2)) continue
      el.style.transition = 'none'; el.style.transform = `translate(${o.left - r.left}px, ${o.top - r.top}px)`
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'transform .42s cubic-bezier(.2, 1.3, .35, 1)'; el.style.transform = '' }))
    }
    last.current = now
  }, [dep])  // eslint-disable-line react-hooks/exhaustive-deps
}

// scry / vigiar: as cartas do topo abertas na mesa, em dois montes; um toque (ou arrastar) muda a carta de monte
function PileAsk({ a, data, answer, zoom, dest }) {
  const [out, setOut] = useState([]), box = useRef(null), drag = useRef(null)
  useBoxFlip(box, out.join())
  const move = (k, to) => setOut(o => (to === 'out' ? (o.includes(k) ? o : [...o, k]) : o.filter(x => x !== k)))
  const down = (e, k) => {  // arrastar com o dedo/rato: larga-se no outro monte
    const el = e.currentTarget, x0 = e.clientX, y0 = e.clientY
    drag.current = { k, moved: false }
    const mv = ev => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.hypot(dx, dy) > 6) drag.current.moved = true; el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 30}deg) scale(1.06)`; el.style.zIndex = 9 }
    const up = ev => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up)
      el.style.transform = ''; el.style.zIndex = ''
      const pile = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-pile]')?.dataset.pile
      if (drag.current.moved && pile) move(k, pile)
      else if (!drag.current.moved) move(k, out.includes(k) ? 'top' : 'out')
    }
    addEventListener('pointermove', mv); addEventListener('pointerup', up)
  }
  const pile = (key, title, list) => (
    <div className={`fp-pile ${key}`} data-pile={key}><small>{title} <b>{list.length}</b></small>
      <div className="fp-pile-c">{list.map(k => { const o = a.options[k]; return (
        <div key={k} data-k={k} className="fp-opt" onPointerDown={e => down(e, k)} onMouseEnter={() => zoom?.({ name: o.label })}>
          <FCard c={{ id: o.card ?? -k, name: o.label }} data={data} big /></div>) })}</div></div>)
  const all = a.options.map((_, k) => k)
  return (
    <div className="fp-ask fp-piles" ref={box}><p>{dest === 'gy' ? tx('Vigiar: arrasta (ou toca) as cartas que vão para o cemitério') : tx('Scry: arrasta (ou toca) as cartas que vão para o fundo da biblioteca')}</p>
      <div className="fp-pile-row">{pile('top', tx('Ficam no topo'), all.filter(k => !out.includes(k)))}{pile('out', dest === 'gy' ? tx('Cemitério') : tx('Fundo da biblioteca'), out)}</div>
      <div className="row-btns"><button className="primary" onClick={() => answer(a, out)}>{tx('Confirmar')}</button></div>
    </div>)
}

// escolher entre muitas cartas (procurar na biblioteca, tutores…): grelha com filtro, as cartas entram uma a uma
function GridAsk({ a, data, answer, zoom }) {
  const [q, setQ] = useState(''), [pick, setPick] = useState([])
  const min = a.min ?? 1, max = a.max ?? 1, one = max === 1
  const card = o => lookup(data, o.label)
  const n = q.trim().toLowerCase()
  // cartas iguais (7 Islands) num só monte com «×7»: um toque escolhe a próxima desse nome
  const groups = [...a.options.reduce((m, o, k) => m.set(o.label, [...(m.get(o.label) || []), k]), new Map())]
  const shown = groups.map(([label, ks]) => [{ ...a.options[ks[0]], label }, ks]).filter(([o]) => !n || o.label.toLowerCase().includes(n) || (card(o)?.t || '').toLowerCase().includes(n))
  const tap = ks => {
    if (one) return answer(a, [ks[0]])
    setPick(p => { const free = ks.find(k => !p.includes(k)); return free != null && p.length < max ? [...p, free] : p.filter(k => !ks.includes(k)) })
  }
  return (
    <div className="fp-ask fp-grid-ask"><p>{a.msg} {!one && <span className="muted small">{tx('escolhe {a} a {b}', { a: min, b: max })}</span>}</p>
      <input type="search" autoFocus placeholder={tx('Filtrar por nome ou tipo…')} value={q} onChange={e => setQ(e.target.value)} />
      <div className="fp-grid">{shown.map(([o, ks], i) => { const got = ks.filter(k => pick.includes(k)).length; return (
        <div key={ks[0]} className={`fp-opt deal ${got ? 'on' : ''}`} style={{ '--i': Math.min(i, 30) }} onMouseEnter={() => zoom?.({ name: o.label })}>
          <FCard c={{ id: o.card ?? -ks[0], name: o.label }} data={data} big onClick={() => tap(ks)} />
          {ks.length > 1 && <b className="fp-many">{got ? `${got}/` : '×'}{ks.length}</b>}</div>) })}</div>
      <div className="row-btns">{!one && <button className="primary" disabled={pick.length < min} onClick={() => answer(a, pick)}>{tx('Confirmar ({n})', { n: pick.length })}</button>}
        {min === 0 && <button onClick={() => answer(a, [])}>{one ? tx('Nenhuma') : tx('Nenhum')}</button>}</div>
    </div>)
}

// cartas reveladas (Gitaxian Probe, Peek, Thoughtseize, Vendilion Clique, o topo da biblioteca…): o título do Forge em
// português quando se reconhece. «Bot's Hand», «Looking at cards in Bot's Library», «Revealed»
const ZONE_T = { hand: p => tx('Mão de {p}', { p }), library: p => tx('Biblioteca de {p}', { p }), graveyard: p => tx('Cemitério de {p}', { p }), exile: p => tx('Exílio de {p}', { p }) }
function revealTitle(t) {
  const s = String(t || '').trim(), m = s.match(/^(?:Looking at cards in )?(.+?)(?:'s|’s|') (hand|library|graveyard|exile)$/i)
  if (m) return ZONE_T[m[2].toLowerCase()](m[1])
  return !s || /^Revealed?( cards)?$/i.test(s) ? tx('Cartas reveladas') : s
}
const rvCardsOf = rv => rv.cards || (rv.list || []).map((name, k) => ({ name, id: -1 - k }))  // sem ids (GrimorioNet antigo): pelo nome
const rvSame = (c, o) => o.card != null && (c.id >= 0 ? o.card === c.id : o.label === c.name)
// as reveladas que vão com este pedido: as do próprio pedido (Vendilion Clique: a mão toda) ou as do aviso de há pouco,
// se a escolha é entre elas (Thoughtseize: a mão revelada e a escolha das que se podem descartar)
function rvFor(a, rvLog) {
  if (a.reveal?.length) return { title: a.revealTitle, cards: a.reveal }
  if (!rvLog || a.kind !== 'choose') return null
  const cards = rvCardsOf(rvLog)
  return (a.options || []).some(o => cards.some(c => rvSame(c, o))) ? { title: rvLog.title, cards } : null
}
// as cartas reveladas, com imagem; on(c) = a opção que essa carta escolhe (as outras ficam esbatidas quando há escolha)
function RevealCards({ rv, data, zoom, on, pick = [], peek }) {  // peek(nome): um clique numa carta que não se escolhe abre-a em grande
  const cs = rvCardsOf(rv)
  const any = !!on && cs.some(c => on(c) >= 0)
  return (
    <div className="fp-rv"><b className="fp-rv-t">{revealTitle(rv.title)} <small>{cs.length}</small></b>
      <div className="fp-rv-c">{cs.map((c, k) => { const o = on ? on(c) : -1
        return <div key={k} className={`fp-opt ${any && o < 0 ? 'dim' : ''} ${o >= 0 && pick.includes(o) ? 'on' : ''}`} onMouseEnter={() => zoom?.({ name: c.name })}>
          <FCard c={c} data={data} big onClick={o >= 0 && rv.choose ? () => rv.choose(o) : peek && (() => peek(c.name))} /></div> })}</div></div>)
}

// dizer o nome de uma carta (Cabal Therapy, Pithing Needle, Lost Legacy…): o Forge manda ~25 mil nomes — procura-se
// por escrito e só se desenham os 40 melhores (o nome inteiro, o início, o início de cada palavra, no meio)
const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/æ/g, 'ae').replace(/œ/g, 'oe')  // «Æther Vial» = aether
const NAME_ASK = a => a.kind === 'choose' && (a.options || []).every(o => o.card == null && o.player == null) && (a.options.length > 200 || /\bname a card|card name\b/i.test(a.msg || ''))
function nameHits(idx, q, n = 40) {  // idx: [[nome normalizado, palavras, índice]]; devolve os índices, melhores primeiro
  const s = fold(q).trim(), ws = s.split(/[^a-z0-9]+/).filter(Boolean)
  if (!s) return []
  const out = []
  for (const [l, w, k] of idx) {
    const r = l === s ? 0 : l.startsWith(s) ? 1 : ws.every(x => w.some(y => y.startsWith(x))) ? 2 : l.includes(s) ? 3 : ws.every(x => l.includes(x)) ? 4 : -1
    if (r >= 0) out.push([r, l.length, l, k])
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1)).slice(0, n).map(x => x[3])
}
function NameAsk({ a, st, data, answer, zoom }) {
  const im = useImg()
  const [q, setQ] = useState(''), [i, setI] = useState(0), list = useRef(null)
  const [idx] = useState(() => a.options.map((o, k) => { const l = fold(o.label); return [l, l.split(/[^a-z0-9]+/).filter(Boolean), k] }))
  const hits = useMemo(() => nameHits(idx, q), [idx, q])
  const go = k => k != null && answer(a, [k])
  const key = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); setI(n); list.current?.children[n]?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[i]) }
  }
  return (
    <div className="fp-ask fp-name-ask"><p>{/^Choose a card name\.?$/i.test(a.msg || '') ? tx('Diz o nome de uma carta') : a.msg}</p>
      <ForWhat src={sourceOf(a.msg, a.card, a.cardName, st)} data={data} />
      <input type="search" autoFocus value={q} placeholder={tx('Escreve o nome de uma carta…')} onChange={e => { setQ(e.target.value); setI(0) }} onKeyDown={key} aria-activedescendant={hits.length ? `fp-nm-${i}` : undefined} />
      <div className="fp-nm" ref={list} role="listbox">{hits.map((k, j) => { const o = a.options[k], c = lookup(data, o.label); return (
        <button key={k} id={`fp-nm-${j}`} role="option" aria-selected={j === i} className={j === i ? 'on' : ''} onMouseEnter={() => { setI(j); zoom?.({ name: o.label }) }} onClick={() => go(k)}>
          {c ? <img src={im(c, 'small')} alt="" loading="lazy" draggable="false" /> : <i />}<span>{o.label}</span></button>) })}</div>
      {q.trim() && !hits.length && <p className="muted small">{tx('Nenhuma carta com esse nome.')}</p>}
      <div className="row-btns">{hits.length > 0 && <button className="primary" onClick={() => go(hits[i])}>{tx('Escolher {c}', { c: a.options[hits[i]].label })} <kbd>⏎</kbd></button>}
        {(a.min ?? 1) === 0 && <button onClick={() => answer(a, [])}>{tx('Nenhuma')}</button>}</div>
    </div>)
}

// carta em grande para o toque (tocar e manter numa carta, Forge Play e mesa livre): ecrã escurecido com a carta ao centro;
// dois dedos ampliam (até 3×), duplo toque amplia/volta, arrastar para baixo ou um toque fecha; Esc no teclado
export function BigCard({ name, data, onClose }) {
  const im = useImg()
  const card = name && (lookup(data, name))
  const ref = useRef(null), g = useRef({ pts: new Map(), s: 1, s0: 1, d0: 0, dy: 0, y0: 0, t0: 0, moved: 0, last: 0 })
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  useBackClose(true, onClose)  // «voltar» do telemóvel fecha a carta
  if (!card) return null
  const draw = () => { const x = g.current; if (ref.current) ref.current.style.transform = `translateY(${x.dy}px) scale(${x.s})` }
  const dist = () => { const [a, b] = [...g.current.pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  const down = e => {
    const x = g.current; x.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (x.pts.size === 2) { x.d0 = dist(); x.s0 = x.s } else { x.y0 = e.clientY; x.t0 = Date.now(); x.moved = 0 }
  }
  const move = e => {
    const x = g.current; if (!x.pts.has(e.pointerId)) return
    x.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (x.pts.size === 2) { x.s = Math.max(1, Math.min(3, x.s0 * dist() / (x.d0 || 1))); x.moved = 99 } else if (x.s === 1) { x.dy = Math.max(0, e.clientY - x.y0); x.moved = Math.max(x.moved, x.dy) }
    draw()
  }
  const up = e => {
    const x = g.current; x.pts.delete(e.pointerId)
    if (x.pts.size) return
    if (x.dy > 90) return onClose()  // arrastar para baixo: fecha
    const tap = x.moved < 8 && Date.now() - x.t0 < 300
    if (tap && Date.now() - x.last < 320) { x.s = x.s > 1 ? 1 : 2; x.last = 0 } else if (tap) { x.last = Date.now(); setTimeout(() => { if (g.current.last && Date.now() - g.current.last >= 300 && g.current.s === 1) onClose() }, 330) }
    x.dy = 0; draw()
  }
  return (
    <div className="fp-big" role="dialog" aria-label={card.n} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <img ref={ref} src={im(card, 'large')} alt={card.n} draggable="false" />
      <small>{tx('Dois dedos ampliam · arrasta para baixo para fechar')}</small>
    </div>)
}

// habilidade a usar (getAbilityToPlay): «Shattered Landscape - Play land» -> «Jogar como terreno»; o resto sem o nome da carta
const abilityLabel = (l, name) => { const s = String(l || ''), p = `${name} - `, t = s.startsWith(p) ? s.slice(p.length) : s; return /^Play land$/i.test(t) ? tx('Jogar como terreno') : t.replace(/^Cycling\b/, tx('Ciclar')) }
// as formas de lançar/usar uma carta (getAbilityToPlay): normal, bestow, aventura, flashback, evoke, overload, dash, blitz,
// disturb, escape, foretell, ninjutsu, ciclar, a outra metade de uma carta dividida, a face de trás (MDFC), jogar como
// terreno… Cada forma é uma linha igual às outras — custo em símbolos, nome curto e o texto (no máximo 3 linhas) — e
// nenhuma ocupa a janela toda. way (GrimorioNet): {alt, land, spell, adventure, flashback, cost, mana, face, type, desc};
// sem ele (GrimorioNet antigo) lê-se a descrição: «Bestow {3}{W} (…)», «Hopeful Eidolon - Creature 1 / 1»
const ALT_PT = { Bestow: ['Bestow', tx('como Aura, presa a uma criatura')], Flashback: ['Flashback', tx('do cemitério; depois vai para o exílio')], Evoke: ['Evoke', tx('mais barata; sacrificada ao entrar')],
  Overload: ['Overload', tx('«alvo» passa a «cada»')], Dash: ['Dash', tx('com pressa; volta à mão no fim do turno')], Blitz: ['Blitz', tx('com pressa; sacrificada no fim do turno')],
  Disturb: ['Disturb', tx('do cemitério, pela face de trás')], Escape: ['Escape', tx('do cemitério, exilando outras cartas')], Foretold: ['Foretell', tx('lançar a carta pressagiada')],
  Emerge: ['Emerge', tx('sacrificando uma criatura')], Spectacle: ['Spectacle', tx('se um adversário perdeu vida neste turno')], Surge: ['Surge', tx('se já lançaste outro feitiço neste turno')],
  Madness: ['Madness', tx('ao descartá-la')], Prowl: ['Prowl', tx('se uma criatura tua do tipo causou dano')], Mutate: ['Mutate', tx('por cima de uma criatura não humana')], Awaken: ['Awaken', tx('e um terreno teu vira criatura')],
  Plotted: ['Plot', tx('lançar a carta tramada')], Impending: ['Impending', tx('entra como encantamento com marcadores')], Freerunning: ['Freerunning', tx('se um Assassino teu causou dano')],
  Harmonize: ['Harmonize', tx('do cemitério')], Warp: ['Warp', tx('exilada no fim do turno; lança-se depois')], Sneak: ['Sneak', tx('trocando por um atacante não bloqueado')], Mayhem: ['Mayhem', tx('depois de a descartares')] }
const KW_RE = /^(Commander ninjutsu|Ninjutsu|Cycling|\w+cycling|Channel|Transmute|Forecast|Reinforce|Bloodrush|Scavenge|Embalm|Eternalize|Unearth|Encore|Craft|Plot|Foretell|Suspend|Morph|Megamorph|Disguise|Retrace|Jump-start|Aftermath|Boast|Exhaust)\b/i
const COST_HEAD = /^\s*[—-]?\s*((?:\{[^}]+\})+)\.?\s*/
function wayOf(o, name, data) {
  const w = o.way || {}, label = String(o.label || ''), desc = String(w.desc || label).replace(/\s+$/, '')
  const sameName = !w.face || w.face === name
  // custo: a mana em símbolos; o resto do custo («Exile five other cards…», «Return an unblocked attacker…») em texto
  // o lembrete entre parênteses, sem o custo repetido à frente («({1}{U}, Return an unblocked attacker…: Put this card…)»)
  const reminder = (desc.match(/\(([^()]{8,})\)\s*$/)?.[1] || '').replace(/^\{[^:]*:\s*/, '')
  // sem way (GrimorioNet antigo): «Escape— {3}{B}, Exile five… (…)», «Bestow {3}{W} (…)» → a palavra-chave e o custo
  const kwl = !o.way && label.match(/^([A-Z][A-Za-z' -]*?)\s*[—-]?\s*((?:\{[^}]+\})+)/)
  const altl = kwl && Object.keys(ALT_PT).find(k => k.toLowerCase() === kwl[1].trim().toLowerCase().replace(/^foretell$/, 'foretold'))
  if (altl) { w.alt = altl; w.cost = label.slice(kwl[0].length - kwl[2].length).split(' (')[0] }
  let mana = w.mana ? (/^\{/.test(w.mana) && w.mana !== '{0}' ? w.mana : null) : kwl && (altl || KW_RE.test(label)) ? kwl[2] : null
  const extra = w.cost && w.cost !== 'no cost' ? w.cost.replace(/^(\{[^}]+\})+,?\s*/, '').trim() : ''
  let title, sub = '', text = ''
  if (w.land || /^Play land\b/i.test(label)) {
    title = tx('Jogar como terreno'); sub = !sameName ? w.face : (label.match(/^Play land \((.+)\)$/i)?.[1] || ''); mana = null
  } else if (w.alt) {
    ;[title, sub] = ALT_PT[w.alt] || [w.alt, '']
    text = w.alt === 'Flashback' ? desc : reminder || desc.replace(/^[\w ]+?(?=\s*[—-]?\s*\{)/, '').replace(COST_HEAD, '')
  } else if (w.adventure) {
    title = tx('Aventura: {f}', { f: w.face }); text = desc
  } else if (KW_RE.test(desc) && !w.spell) {
    const k = desc.match(KW_RE)[1]; title = /^cycling$/i.test(k) ? tx('Ciclar') : k
    text = reminder || desc.replace(KW_RE, '').replace(COST_HEAD, '')
  } else if (!sameName) {  // a outra metade (Fire // Ice) ou a face de trás (MDFC): pelo nome dela
    title = w.face; sub = w.type || ''; text = desc
  } else if (w.spell || label.startsWith(`${name} - `) || !label) {
    title = tx('Lançar normalmente'); const m = desc.match(/^.+? - (.+)$/)
    sub = m ? m[1].replace(/\bCreature\b/, tx('Criatura')).replace(/ \/ /, '/') : ''
    text = m ? '' : desc
    if (!mana) mana = lookup(data, name)?.mc || null
  } else if (!o.way && !/^Play land$/i.test(label) && !/^[^(]*:\s/.test(label)) {  // sem way: o texto do feitiço = lançá-lo normalmente
    title = tx('Lançar normalmente'); text = label; mana = mana || lookup(data, name)?.mc || null
  } else {
    title = abilityLabel(label, name)
  }
  text = text.replace(/CARDNAME/g, name).trim()
  if (text.replace(/\W/g, '').toLowerCase() === String(title).replace(/\W/g, '').toLowerCase()) text = ''
  return { title, sub, text, mana, extra }
}
function WayAsk({ a, data, answer, zoom, head, escRef }) {
  const name = a.cardName || a.msg
  const ways = (a.options || []).map(o => wayOf(o, name, data))
  escRef.current = () => answer(a, [])
  useEffect(() => {  // 1…9 escolhe a forma pelo número
    const k = e => { const n = +e.key; if (n >= 1 && n <= ways.length && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); answer(a, [n - 1]) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  return (
    <div className="fp-ask fp-ways-ask"><p>{tx('Como queres usar {c}?', { c: name })}</p>
      {head && <div className="fp-ways-head" onMouseEnter={() => zoom?.(head)}><FCard c={head} data={data} big /></div>}
      <div className="fp-ways" role="list">{ways.map((w, k) => (
        <button key={k} type="button" role="listitem" className="fp-way" onClick={() => answer(a, [k])} title={a.options[k].label}>
          <span className="fp-way-cost">{w.mana ? <Syms text={w.mana} /> : <i>—</i>}</span>
          <span className="fp-way-body"><b>{w.title}{w.sub && <small> · {w.sub}</small>}</b>
            {w.extra && <em className="fp-way-extra">+ <Syms text={w.extra} /></em>}
            {w.text && <span className="fp-way-txt"><Syms text={w.text} /></span>}</span>
          <kbd className="fp-way-k">{k + 1}</kbd>
        </button>))}</div>
      <div className="row-btns"><button onClick={() => answer(a, [])}>{tx('Cancelar')} <kbd>Esc</kbd></button></div>
    </div>)
}
// escolhas que bloqueiam o motor: sim/não, uma opção, um número ou texto, ou escolher entre cartas/jogadores
// para que é um pedido de escolha: a carta e o texto da habilidade — da 1.ª linha do Forge («Spider Umbra (4) - Enchant
// creature…»), da carta que o pedido traz ou do topo da pilha (o que está a resolver). Sem nada disto: null
function sourceOf(msg, card, cardName, st) {
  const l0 = String(msg || '').split('\n')[0].trim(), m = /^(.+?) \((\d+)\)(?: - (.+))?$/.exec(l0)
  if (m) return { id: +m[2], name: m[1], text: m[3] || '' }
  if (card != null && cardName) return { id: card, name: cardName, text: '' }
  const t = st?.stack?.[0]
  return t?.name ? { id: t.card, name: t.name, text: t.text || '' } : null
}
function ForWhat({ src, data }) {
  if (!src) return null
  // «Spider Umbra (4) - Enchant creature…» → «Enchant creature…» (o nome já está ao lado)
  const txt = !src.text || src.text === src.name ? '' : src.text.startsWith(src.name) ? src.text.slice(src.name.length).replace(/^\s*(\(\d+\))?\s*-?\s*/, '') : src.text
  return (
    <div className="fp-for"><FCard c={{ id: src.id, name: src.name }} data={data} />
      <span><small>{tx('Para')}</small> <b>{src.name}</b>{txt && <em><Syms text={txt} /></em>}</span></div>
  )
}
const MANA_ASK = /\bmana\b/i  // «Select Mana to Produce»
// «Choose X for Walking Ballista»: o Forge dá sempre 0 a 9, seja qual for a mana; com {X}{X} cada 1 de X custa 2. Quanto custa
// cada escolha (custo da carta com X = 0, mais X por cada {X}) e quanta mana há por usar. Numa habilidade (a carta já está em
// campo e não na mão, ou sem X no custo da carta) fica null: o custo é o da habilidade, que o pedido não diz
function xCostOf(a, st, data) {
  const m = a?.kind === 'choose' && /^Choose X for (.+?)\s*$/i.exec(String(a.msg || '').split('\n')[0])
  if (!m || !(a.options || []).some(o => /^\d+$/.test(o.label))) return null
  const d = lookup(data, m[1]), n = ((d?.mc || '').split(' // ')[0].match(/\{X\}/gi) || []).length
  const me = (st?.players || []).find(p => p.me)
  if (!n || !me || ((me.battlefield || []).some(c => c.name === m[1]) && !(me.hand || []).some(c => c.name === m[1]))) return null
  const src = c => { if (c.tapped || c.hidden || (c.creature && c.sick)) return false; if (c.land) return true; const o = lookup(data, c.name)?.o || ''; return /\{T\}[^:\n]*:\s*Add\b/.test(o) }
  const avail = (me.battlefield || []).filter(src).length + Object.values(me.mana || {}).reduce((s, k) => s + (+k || 0), 0)
  return { name: d.n || m[1], n, base: d.cmc || 0, avail }
}
function Ask({ a, st, data, answer, zoom, payCancel, undo, rv: rvLog }) {  // rvLog: cartas reveladas há pouco (Thoughtseize: a mão toda por cima da escolha)  // payCancel: o Forge está a meio de um pagamento (cancelá-lo desfaz tudo); undo: desfazer a última ação
  const [pick, setPick] = useState([]), [txt, setTxt] = useState(a.initial || '')
  const escRef = useRef(null)
  useBackClose(a.kind === 'choose' && ((a.min === 0 && (a.max ?? 1) === 1) || !!payCancel || (!!undo && MANA_ASK.test(a.msg || ''))), () => escRef.current?.())  // «voltar» = Cancelar, quando dá
  useEffect(() => { const k = e => { if (e.key === 'Escape' && escRef.current) { e.preventDefault(); escRef.current() } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [])
  const all = (st?.players || []).flatMap(p => [...(p.battlefield || []), ...(p.hand || []), ...(p.graveyard || []), ...(p.exile || [])])
  const cardOf = o => { if (o.card == null) return null; const c = all.find(x => x.id === o.card); return c && !c.hidden ? c : { id: o.card, name: o.name || o.label } }  // name: feitiço na pilha (o label é o texto dele); escondida no estado (a mão dele numa escolha): vale o nome da opção
  if (a.kind === 'order') {  // ordenar: clica nas cartas pela ordem; as que ficarem por clicar mantêm a ordem do Forge
    const n = (a.options || []).length
    const tap = k => setPick(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))
    return (
      <div className="fp-ask"><p>{a.msg} <span className="muted small">{tx('clica pela ordem ({f} primeiro)', { f: a.first || tx('o 1.º') })}</span></p>
        <div className="fp-opts">{a.options.map((o, k) => { const c = cardOf(o) || { id: -k, name: o.label }; return (
          <div key={k} className={`fp-opt ${pick.includes(k) ? 'on' : ''}`}><FCard c={c} data={data} big onClick={() => tap(k)} />{pick.includes(k) && <b className="fp-ord">{pick.indexOf(k) + 1}</b>}</div>) })}</div>
        <div className="row-btns"><button className="primary" onClick={() => answer(a, pick)}>{pick.length < n ? tx('Confirmar (o resto como está)') : tx('Confirmar')}</button>
          {pick.length > 0 && <button className="link small" onClick={() => setPick([])}>{tx('recomeçar')}</button>}</div>
      </div>)
  }
  if (a.kind === 'confirm' || a.kind === 'option') return (
    <div className="fp-ask"><p>{a.msg || a.title}</p>{a.card != null && <div className="fp-opts fp-reveal-c"><FCard c={all.find(c => c.id === a.card) || { id: a.card, name: a.cardName || '' }} data={data} big /></div>}
      <div className="row-btns">{(a.options || []).map((o, k) => <button key={k} className={k ? '' : 'primary'} onClick={() => answer(a, [k])}>{BTN[o] || o}</button>)}</div></div>)
  if (a.kind === 'input') return (
    <div className="fp-ask"><p>{a.msg || a.title}</p>
      {a.options ? <div className="row-btns">{a.options.map((o, k) => <button key={k} onClick={() => answer(a, o)}>{o}</button>)}</div>
        : <form className="row-btns" onSubmit={e => { e.preventDefault(); answer(a, txt) }}><input autoFocus type={a.numeric ? 'number' : 'text'} value={txt} onChange={e => setTxt(e.target.value)} /><button className="primary">{tx('OK')}</button></form>}</div>)
  if (NAME_ASK(a)) { escRef.current = (a.min ?? 1) === 0 ? () => answer(a, []) : null; return <NameAsk a={a} st={st} data={data} answer={answer} zoom={zoom} /> }
  const rv = rvFor(a, rvLog)
  if (!rv && a.kind === 'choose' && (a.options || []).every(o => o.card != null)) {  // só cartas: scry, vigiar ou uma lista grande
    const m = a.msg || ''
    if (/bottom of (your )?library/i.test(m)) return <PileAsk a={a} data={data} answer={answer} zoom={zoom} dest="bottom" />
    if (/into (your |the )?graveyard|put in the graveyard/i.test(m) && (a.min ?? 0) === 0) return <PileAsk a={a} data={data} answer={answer} zoom={zoom} dest="gy" />
    if (a.options.length >= 7) return <GridAsk a={a} data={data} answer={answer} zoom={zoom} />
  }
  const min = a.min ?? 1, max = a.max ?? 1, one = max === 1
  // «Cancelar» (Esc) sempre que o Forge deixa: escolha opcional de uma, ou uma escolha a meio de um pagamento (que cor de mana
  // produzir…): aí responde-se com a primeira e cancela-se o pagamento — o Forge desfaz o que já estava pago
  // e a cor de mana de uma criatura/terreno ativado fora de um pagamento (Birds of Paradise…): o Forge obriga a escolher, por
  // isso responde-se com a primeira e desfaz-se a habilidade de mana (desvira e a mana sai da reserva)
  const cancel = min === 0 && one ? () => answer(a, []) : a.kind === 'choose' && payCancel ? () => { answer(a, [0]); payCancel() }
    : a.kind === 'choose' && undo && MANA_ASK.test(a.msg || '') ? () => { answer(a, [0]); undo() } : null
  escRef.current = cancel
  const head = a.card != null && (all.find(c => c.id === a.card) || (a.cardName && { id: a.card, name: a.cardName }))  // jogar o terreno ou ciclar: a carta em grande
  // as formas de lançar/usar a carta (getAbilityToPlay): linhas iguais, com custo em símbolos (WayAsk)
  if (a.ability && a.kind === 'choose' && (a.options || []).every(o => o.card == null && o.player == null)) return <WayAsk a={a} data={data} answer={answer} zoom={zoom} head={head} escRef={escRef} />
  const toggle = k => (one ? answer(a, [k]) : setPick(p => (p.includes(k) ? p.filter(x => x !== k) : p.length < max ? [...p, k] : p)))
  // a carta revelada -> a opção dela (pelo id; sem id, pelo nome); se todas as opções estão nas reveladas, escolhe-se lá
  const optOf = c => (a.options || []).findIndex(o => rvSame(c, o))
  const rvCards = rv?.cards
  const inRv = !!rvCards && (a.options || []).length > 0 && (a.options || []).every(o => rvCards.some(c => rvSame(c, o)))
  const xi = xCostOf(a, st, data)
  return (
    <div className="fp-ask"><p>{a.ability ? tx('Como queres usar {c}?', { c: a.msg }) : /^Select target /.test(a.msg || '') ? `${tx('Escolhe o alvo')}: ${a.msg.slice(14)}` : a.msg} {!one && <span className="muted small">{tx('escolhe {a} a {b}', { a: min, b: max })}</span>}</p>
      {head && <div className="fp-opts fp-reveal-c"><FCard c={head} data={data} big /></div>}
      {!head && !a.ability && <ForWhat src={sourceOf(a.msg, a.card, a.cardName, st)} data={data} />}
      {rv && <RevealCards rv={{ ...rv, cards: rvCards, choose: toggle }} data={data} zoom={zoom} on={optOf} pick={pick} />}
      {!inRv && <div className="fp-opts">{(a.options || []).map((o, k) => { const c = cardOf(o); return c
        ? <div key={k} className={`fp-opt ${pick.includes(k) ? 'on' : ''}`}><FCard c={c} data={data} big onClick={() => toggle(k)} onZoom={zoom} />{o.stack && <small className="fp-stk-lbl"><Syms text={o.label} /></small>}</div>
        : xi && /^\d+$/.test(o.label) ? (t => <button key={k} className={`fp-optl ${pick.includes(k) ? 'on' : ''} ${t > xi.avail ? 'short' : ''}`} title={t > xi.avail ? tx('Não chega: tens {m} de mana por usar.', { m: xi.avail }) : ''} onClick={() => toggle(k)}>
          X = {o.label} · <b>{tx('custa {m}', { m: t })}</b></button>)(xi.base + xi.n * +o.label)
        : <button key={k} className={`fp-optl ${pick.includes(k) ? 'on' : ''}`} onClick={() => toggle(k)}><Syms text={a.ability ? abilityLabel(o.label, a.msg) : o.label} /></button> })}</div>}
      {xi && <small className="muted">{xi.n > 1 ? tx('{c} tem {k} X no custo: cada 1 de X custa {k} de mana (X = 1 custa {t} no total).', { c: xi.name, k: xi.n, t: xi.base + xi.n }) + ' ' : ''}{tx('Tens {m} de mana por usar (terrenos por virar, reserva e fontes de mana).', { m: xi.avail })}</small>}
      <div className="row-btns">{!one && <button className="primary" disabled={pick.length < min} onClick={() => answer(a, pick)}>{tx('Confirmar ({n})', { n: pick.length })}</button>}
        {min === 0 && !one && <button onClick={() => answer(a, [])}>{tx('Nenhum')}</button>}
        {cancel && <button onClick={cancel}>{tx('Cancelar')} <kbd>Esc</kbd></button>}</div>
    </div>
  )
}

export default function ForgeTable({ sid, data, onClose, onAgain, againLabel, series, onEnd, cols }) {  // cols: as cores de cada deck ({a, b}), para a esfera antes de haver cartas à vista  // againLabel: o texto do botão de voltar a jogar (torneios: o jogo seguinte da partida)
  const [s, setS] = useState(null), [err, setErr] = useState(''), [zoom, setZoom] = useState(null), [zone, setZone] = useState(null), [toast, setToast] = useState(null)
  const [rvl, setRvl] = useState(null)  // cartas reveladas: um painel com as imagens, até o fechares (ou até à escolha que vem com elas)
  const seen = useRef(0)
  useEffect(() => {  // espera longa: o servidor responde quando há novidades (ou ao fim de 20 s)
    let live = true, since = 0
    ;(async () => {
      while (live) {
        try {
          const r = await j(`/api/playnet/${sid}?since=${since}`)
          if (!live) return
          since = r.seq; setS(r); setErr('')
          if (r.ended) return
        } catch (e) {
          if (!live) return
          // o jogo já não existe no servidor (reiniciado a meio: uma atualização): a janela do fim diz que nada conta
          if (/não existe/.test(e.message)) { setS(x => (x ? { ...x, ended: true, lost: true } : x)); return }
          setErr(e.message); await new Promise(ok => setTimeout(ok, 2000))
        }
      }
    })()
    return () => { live = false }
  }, [sid])
  useEffect(() => {  // avisos do motor (cartas reveladas, erros): aparecem uns segundos
    // cada aviso traz o n.º dele (GrimorioNet); o servidor só manda os últimos 12, por isso contá-los pelo tamanho da lista
    // deixava de ver avisos novos a meio do jogo. Ao abrir a mesa (seen = 0) conta só o último, como antes
    const log = s?.log || [], n = log.length, last = log[n - 1]
    if (!n) return
    // «Bot has won the coin toss.» chega a quem perdeu como aviso (notifyOfValue do Forge), não como pedido: a moeda vai
    // logo ao ar (antes esperava 1,5 s pelo turno 1); o aviso em si não aparece (a moeda já o diz)
    const coin = log.find(m => /won the coin toss/i.test(m.msg || ''))
    if (coin && !sawWin.current) { sawWin.current = true; toss(/\byou have won/i.test(coin.msg)) }
    const key = last.n ?? n
    if (seen.current === key) return
    const fresh = (last.n != null && seen.current ? log.filter(m => m.n > seen.current) : [last]).filter(m => !/^AI can't play/.test(m.title || '') && m !== coin)
    seen.current = key
    const rv = fresh.filter(m => m.list?.length).pop()
    if (rv) setRvl(rv)
    const m = fresh.filter(m => !m.list?.length).pop()
    if (!m) return  // o aviso do Forge sobre cartas que a IA joga mal não interessa a quem joga
    // flash = o Forge recusou o clique (sem alvos válidos, sem mana, fora de tempo): sem isto parecia que nada acontecia
    setToast(m.t === 'flash' ? { title: tx('O Forge recusou essa jogada'), msg: tx('Não há alvos válidos, falta mana ou não é a altura. Uma aura como Hardlight Containment precisa de um artefacto teu em jogo.') } : m)
  }, [s?.log])
  useEffect(() => {  // qualquer aviso some sozinho com fade (mais tempo se trouxer uma lista); um toque fecha logo
    if (!toast) return  // (antes, o mesmo aviso dado outra vez ficava preso no ecrã: o temporizador comparava com o objeto antigo)
    if (toast.out) { const b = setTimeout(() => setToast(t => (t === toast ? null : t)), 450); return () => clearTimeout(b) }
    const a = setTimeout(() => setToast(t => (t === toast ? { ...t, out: true } : t)), toast.list ? 8000 : 4000)
    return () => clearTimeout(a)
  }, [toast])
  const send = c => j(`/api/playnet/${sid}/cmd`, c).catch(e => setErr(e.message))
  const answer = (a, v) => {
    if (rvl && !a.reveal?.length && rvFor(a, rvl)) setRvl(null)  // a escolha que vinha com as reveladas: o painel fecha com ela
    setS(x => ({ ...x, asks: x.asks.filter(y => y.id !== a.id) })); send({ c: 'answer', id: a.id, v })
  }
  const st = s?.state, players = st?.players || []
  const me = players.find(p => p.me) || players.find(p => !p.ai), opp = players.find(p => p !== me)
  // o servidor guarda a última mensagem do Forge, que no turno da IA nem sempre é trocada: um «Declare attackers» do teu
  // turno anterior ficava lá (e depois de recarregar a página a meio do combate aparecia «Declara os atacantes» quando
  // eram os bloqueadores). No turno dele, isso é só «à espera».
  const theirTurn = !!st && st.active !== me?.id
  const pr = theirTurn && ATK_ASK(s?.prompt?.msg) ? { msg: `Waiting for ${opp?.name || ''}`, buttons: [] } : s?.prompt
  const btns = (pr?.buttons || []).filter(b => b.label)
  // impasse do Forge: pede «Click one of the highlighted cards» sem nenhuma carta escolhível e com os dois botões desligados
  // (Calix sem encantamentos não lendários, efeitos «escolhe uma … que controlas» sem nenhuma). O Forge cancela a entrada
  // mesmo com o botão desligado: mostra-se «continuar» e, ao fim de 2,5 s, segue sozinho (o efeito fica sem escolha)
  // selc (GrimorioNet): as escolhíveis de todas as zonas — também as que a mesa não desenha à parte (a aura presa, o Hopeful
  // Eidolon com bestow, cartas da biblioteca/zona de comando). Com alguma, não é impasse: aparecem como botões no pedido
  const anySel = !!st?.selc?.length || players.some(q => q.sel || ['battlefield', 'hand', 'graveyard', 'exile'].some(z => (q[z] || []).some(c => c.sel)))
  const idle = !!pr?.msg && !/^(Priority:|Waiting for)/.test(pr.msg) && !s?.asks?.length && !btns.some(b => b.on) && !anySel && !s?.ended
  const stuck = idle && /highlighted|Choose (a|an|one|up to)/i.test(pr.msg)
  const stuckKey = stuck ? `${pr.msg}|${s?.seq}` : ''
  // rede de segurança para qualquer outro pedido sem botão ligado e sem nada para escolher: ao fim de 1,5 s aparece um
  // «Continuar» (o Forge aceita sempre o «cancel» e acaba a entrada; o efeito segue sem a escolha) — nunca um beco sem saída
  const [idleShown, setIdleShown] = useState('')
  const idleKey = idle && !stuck ? pr.msg : ''
  useEffect(() => {
    if (!idleKey) { setIdleShown(''); return }
    const t = setTimeout(() => setIdleShown(idleKey), 1500)
    return () => clearTimeout(t)
  }, [idleKey])
  const unstick = (stuck || (idleKey && idleShown === idleKey)) && <button type="button" className="primary fp-unstick" onClick={() => send({ c: 'cancel' })}>{stuck ? tx('Sem cartas para escolher — continuar') : tx('Continuar')}</button>
  useEffect(() => {
    if (!stuckKey) return
    const t = setTimeout(() => { send({ c: 'cancel' }); setToast({ title: tx('Sem cartas para escolher'), msg: tx('O Forge pedia uma escolha sem nenhuma opção válida: seguiu sem ela.') }) }, 2500)
    return () => clearTimeout(t)
  }, [stuckKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const blocking = theirTurn && BLK_ASK(pr?.msg)  // o Forge pede os bloqueadores (cliques = bloquear)
  const ask = s?.asks?.[0]
  const hoverId = useRef(null), [flipped, setFlipped] = useState(() => new Set()), [lift, setLift] = useState(null)  // carta debaixo do rato; viradas; levantada na mão
  // «voltar» do telemóvel: fecha primeiro o que está aberto por cima; com o jogo a decorrer nunca sai da mesa (avisa e fica)
  const [guard, setGuard] = useState(true)
  useBackClose(guard && !s?.ended, () => { setGuard(false); setTimeout(() => setGuard(true), 0); setToast({ title: tx('O jogo continua'), msg: tx('Para sair, usa «Parar o jogo» ou desiste no painel.') }) })
  useBackClose(!!s?.ended, () => onClose?.())
  const [act, setAct] = useState(null)  // {id, x, y, lines}: confirmar ativar uma habilidade de uma permanente tua (um clique já não ativa às escondidas)
  useBackClose(!!zone, () => setZone(null)); useBackClose(!!act, () => setAct(null))  // cemitério/exílio e o «Ativar …?»
  useBackClose(!!rvl && !ask, () => setRvl(null))
  useEffect(() => {  // painel das reveladas: Esc, Enter ou Espaço fecham-no (com a carta em grande aberta, o Esc é dela)
    if (!rvl || ask) return
    const k = e => { if (!document.querySelector('.fp-big') && /^(Escape|Enter| )$/.test(e.key) && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); setRvl(null) } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [rvl, ask])
  useEffect(() => { if (!/^Priority:/.test(pr?.msg || '')) setLift(null) }, [pr?.msg])  // o Forge pede uma escolha: a carta levantada desce (as escolhidas sobem com moldura)
  useEffect(() => {  // Enter/Espaço = o botão principal (passar ao passo seguinte), Shift+Enter ou Shift+Espaço = acabar o turno, Esc = o outro botão
    const k = e => {
      if (ask || big || rvl || pressing.current || document.querySelector('.ask-bg') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return  // carta em grande aberta: o Esc é dela
      if (act) { if ((e.key === 'Enter' || e.key === ' ') && !act.pw?.length) { e.preventDefault(); activate() } else if (e.key === 'Escape') { e.preventDefault(); setAct(null) } return }
      const P = fpPrefs()
      if (P.clock && clockRef.current && e.key.toLowerCase() === P.clockKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); stopClock(); return }
      if (e.key.toLowerCase() === P.tap && hoverId.current != null && !e.ctrlKey && !e.metaKey && document.querySelector(`.bside.bottom .pc[data-z="k:${hoverId.current}"]`)) { e.preventDefault(); permClick(hoverId.current, document.querySelector(`.bside.bottom .pc[data-z="k:${hoverId.current}"]`)); return }  // rato por cima de uma carta tua na mesa + T = virá-la (tap) / ativá-la, como o clique
      if (e.key.toLowerCase() === P.flip && hoverId.current != null && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const k = hoverId.current; setFlipped(f => { const n = new Set(f); n.has(k) ? n.delete(k) : n.add(k); return n }); return }
      const end = btns.find(b => b.label === 'End Turn')
      const b = (e.key === 'Enter' || (e.key === ' ' && P.shiftSpace)) && e.shiftKey ? end : (e.key === ' ' && P.space && !e.shiftKey) || e.key === 'Enter' ? btns[0] : e.key === 'Escape' ? btns[1] : null
      if (b?.on) { e.preventDefault(); pressBtn(b) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const ended = !!s?.ended, iWon = !!s?.winner && s.winner === me?.name
  // a janela do fim espera que o último golpe se veja (bolinhas, tremor, a esfera a reagir): antes aparecia no mesmo instante
  // e a animação de quem ganhou passava por baixo dela
  const [endShown, setEndShown] = useState(false)
  useEffect(() => {
    if (!ended) { setEndShown(false); return }
    const t = setTimeout(() => setEndShown(true), s?.crash ? 0 : 2600)
    return () => clearTimeout(t)
  }, [ended])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ended) onEnd?.(s.winner ? iWon : null) }, [ended]) // eslint-disable-line react-hooks/exhaustive-deps
  // sons: o Forge Play não manda eventos — soa a diferença entre o estado anterior e este (sfx.playDiff); o 1.º não soa
  const snapRef = useRef(null)
  // feitiço anulado: sai da pilha um «counter target…» e logo a seguir (até 3 s) sai outro item → esse foi anulado
  const stkPrev = useRef([]), ctrAt = useRef(0)
  useEffect(() => {
    const now = st?.stack || [], gone = stkPrev.current.filter(x => !now.some(y => y.card === x.card && y.text === x.text))
    stkPrev.current = now
    const ctr = gone.find(x => /\bcounter target\b/i.test(x.text || ''))
    if (ctr) ctrAt.current = Date.now()
    const hit = gone.filter(x => x !== ctr)
    if (hit.length && Date.now() - ctrAt.current < 3000) { ctrAt.current = 0; setHits(hit.map((x, k) => ({ key: `c${s?.seq}-${k}`, kind: 'counter', to: { stack: true, name: x.name } }))) }
  }, [s?.seq])  // eslint-disable-line react-hooks/exhaustive-deps
  // dano à vista: as entradas DAMAGE novas do registo do Forge («X (12) deals 3 combat damage to Y (20).»; Y = carta ou jogador)
  const logSeen = useRef(null), [hits, setHits] = useState(null), [dmg, setDmg] = useState(null)  // dmg: o dano do combate em curso
  useEffect(() => { if (!/^COMBAT/.test(st?.phase || '')) setDmg(null) }, [st?.phase, st?.turn])  // acaba o combate: os selos saem
  useEffect(() => {
    const lg = st?.log || [], n = st?.logN || 0
    if (logSeen.current == null || n < logSeen.current) { logSeen.current = n; return }
    const fresh = lg.slice(Math.max(0, lg.length - (n - logSeen.current)))
    logSeen.current = n
    const sideOf = nm => (nm === me?.name ? 'a' : nm === opp?.name ? 'b' : null)
    const out = fresh.map((e, k) => {
      const msg = (e.m || '').replace(/^(Damage|Life):\s*/, '')
      if (e.y === 'LIFE') {  // vida ganha por uma carta (laço de vida, Spike Feeder…): bolinha verde até ao orbe; sem carta de origem, só o orbe
        const l = /^(.+) (-?\d+) > (-?\d+)$/.exec(msg), side = l && sideOf(l[1])
        return l && side && e.c != null && +l[3] > +l[2] && { key: `${n}-${k}`, from: String(e.c), to: { side }, n: +l[3] - +l[2], kind: 'gain' }
      }
      if (e.y !== 'DAMAGE') return null
      const m = /^(.+?) \((\d+)\) deals (\d+) (combat )?damage to (.+?)(?: \((\d+)\))?\.?$/.exec(msg)
      if (!m) return null
      const side = m[6] ? null : sideOf(m[5])
      return (m[6] || side) && { key: `${n}-${k}`, from: String(e.c ?? m[2]), fromName: m[1], to: m[6] ? { card: m[6] } : { side }, n: +m[3], combat: !!m[4],
        kind: /poison|infect/i.test(e.m) ? 'psn' : m[4] ? 'cmb' : 'spl' }
    }).filter(Boolean)
    if (out.length) setHits(out)
    const cmb = out.filter(h => h.kind === 'cmb')
    if (cmb.length) setDmg(d => {
      const D = d ? { out: { ...d.out }, in: { ...d.in }, tr: { ...d.tr }, pl: { ...d.pl } } : { out: {}, in: {}, tr: {}, pl: {} }
      for (const h of cmb) addDmg(D, { ...h, trample: !!(h.to.side && st.combat?.some(x => String(x.att) === h.from && x.blockers?.length)) })
      return D
    })
  }, [st?.logN])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!st) return
    const top = st.stack?.[0], tc = top?.name && (lookup(data, top.name))
    const side = p => p && { life: p.life, poison: ctrs(p.counters).poison || 0, hand: p.hand?.length || 0, library: p.library || 0, gy: p.graveyard?.length || 0, ex: p.exile?.length || 0,
      perms: new Map((p.battlefield || []).map(c => [c.id, { land: !!c.land, token: !!c.token, tapped: !!c.tapped, ctr: Object.values(c.counters || {}).reduce((n, x) => n + (+x || 0), 0) }])) }
    const snap = { turn: st.turn, active: st.active === me?.id ? 'a' : 'b', combat: /^COMBAT/.test(st.phase || ''), att: st.combat?.length || 0,
      blk: (st.combat || []).reduce((n, x) => n + (x.blockers?.length || 0), 0), stack: st.stack?.length || 0, stackBy: top?.by === me?.id ? 'a' : 'b', stackCol: tc?.co ?? tc?.ci,
      over: ended, won: iWon, sides: { a: side(me), b: side(opp) } }
    if (snapRef.current) playDiff(snapRef.current, snap)
    snapRef.current = snap
  }, [s?.seq, ended])  // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(players.flatMap(p => [...['battlefield', 'hand', 'graveyard', 'exile'].flatMap(z => (p[z] || []).map(c => [c.id, c])), ...(p.top ? [[p.top.id, p.top]] : [])]))
  const lives = `${me?.life}|${opp?.life}`, prevLives = useRef(null), [lifeFx, setLifeFx] = useState(null)
  // veneno (infect, toxic, poisonous…): o ☠ ao lado da vida pulsa e sobe quando aumenta, como na arena
  const psns = `${ctrs(me?.counters).poison || 0}|${ctrs(opp?.counters).poison || 0}`, prevPsn = useRef(null), [psnFx, setPsnFx] = useState(null)
  useEffect(() => {
    const [a, b] = psns.split('|').map(Number), pv = prevPsn.current
    prevPsn.current = [a, b]
    if (!pv || (a <= pv[0] && b <= pv[1])) return
    setPsnFx({ p: a > pv[0] ? 'a' : 'b', n: a > pv[0] ? a - pv[0] : b - pv[1] })
    const t = setTimeout(() => setPsnFx(null), 1200); return () => clearTimeout(t)
  }, [psns])
  useEffect(() => {  // a vida mudou: o orbe pisca e mostra o +N/−N, como na arena
    const [a, b] = lives.split('|').map(Number), pv = prevLives.current
    prevLives.current = [a, b]
    if (!pv || Number.isNaN(a)) return
    if (a === pv[0] && b === pv[1]) return
    setLifeFx(a !== pv[0] ? { p: 'a', d: a - pv[0] } : { p: 'b', d: b - pv[1] })
    const t = setTimeout(() => setLifeFx(null), 1200)  // só uma vez: sem isto o «−1» voltava a cada estado novo (tapar um terreno…)
    return () => clearTimeout(t)
  }, [lives])
  const send1 = c => send(c)
  const [lay, setLayS] = useState(() => { try { return JSON.parse(localStorage.getItem(`grimorio.fp.${sid}`)) || {} } catch { return {} } })  // arrumação à mão
  const setLay = f => setLayS(x => { const y = f(x); try { localStorage.setItem(`grimorio.fp.${sid}`, JSON.stringify(y)) } catch { /* sem armazenamento */ } return y })
  const keysIn = (box, sel, attr) => [...box.querySelectorAll(sel)].map(e => e.getAttribute(attr).replace(/^k:/, ''))
  const moveBefore = (keys, k, before) => { const l = keys.filter(x => x !== k), i = before == null ? -1 : l.indexOf(before); l.splice(i < 0 ? l.length : i, 0, k); return l }
  const kindOf = c => {  // pela palavra do Forge e, na mão (onde nem sempre vem), pelo tipo da carta nos dados
    const inHand = c && (me?.hand || []).some(h => h.id === c.id)  // no campo manda o Forge (uma Enduring volta como encantamento)
    const t = inHand && !c.hidden ? (lookup(data, c.name)?.t || '').split(' // ')[0] : ''
    return c?.land || (!c?.creature && /\bLand\b/.test(t) && !/Creature/.test(t)) ? 'lands'
      : c?.creature || c?.loyalty != null || c?.counters?.DEFENSE != null || /\b(Creature|Planeswalker|Battle)\b/.test(t) ? 'front' : 'others'
  }  // pela palavra do Forge: uma Enduring de volta é encantamento
  // onde a carta vai ficar no teu lado: largada à altura das cartas de uma fila (a fila debaixo do dedo ou a dela —
  // criaturas, terrenos, outras) entra nessa fila, no sítio pela posição; largada longe das filas fica solta onde a
  // pousaste (Livre) ou na casa mais perto (Grelha). Com «Filas automáticas» vai sempre para uma fila.
  // null = fora do teu lado ou por cima da tua barra; {row, before} = numa fila, antes dessa carta; {free} = solta
  const whereOn = (id, target, x, y) => {
    const side = target?.closest('.fp-table .bside.bottom')
    if (!side || target.closest('.bhud')) return null
    const kind = kindOf(byId.get(id)), P = fpPrefs(), sc = +side.closest('.fp-stage')?.dataset.sc || 1
    const rowOf = k => side.querySelector(`.brow.${k}`) || (k === 'others' ? side.querySelector('.brow.rear') : null)
    // um terreno vai sempre para a fila dos terrenos, mesmo em Livre ou largado longe dela: só a ordem segue onde o largaste
    if (kind === 'lands' && rowOf('lands')) {
      const row = rowOf('lands'), keys = keysIn(row, '.pc[data-z^="k:"]', 'data-z').filter(k => k !== String(id))
      const before = keys.find(k => { const e = row.querySelector(`.pc[data-z="k:${k}"]`)?.getBoundingClientRect(); return e && e.left + e.width / 2 > x }) ?? null
      return { row: 'lands', before, box: row }
    }
    let under = target.closest('.brow:not(.rear)') || (target.closest('.brow.rear') && rowOf(kind === 'front' ? 'lands' : kind))
    // encantamento/artefacto (não criatura, não terreno) só entra na fila dele: largado no espaço vazio à direita (que é da
    // fila dos terrenos ou das criaturas, esticadas) antes ia parar a essa fila; agora fica solto onde o largaste
    if (kind === 'others' && under && !under.classList.contains('others')) under = null
    if (kind === 'front' && under && !under.classList.contains('front')) under = null  // uma criatura largada nos terrenos não vai para lá
    for (const row of [...new Set([under, rowOf(kind)])].filter(Boolean)) {
      const cs = [...row.querySelectorAll('.pc[data-z^="k:"]')].filter(e => e.dataset.z !== `k:${id}` && !e.closest('.bfree')).map(e => e.getBoundingClientRect())
      const q = cs.length ? { top: Math.min(...cs.map(r => r.top)), bottom: Math.max(...cs.map(r => r.bottom)) } : row.getBoundingClientRect()
      const pad = cs.length ? 22 * sc : 0
      if (P.place !== 'rows' && (y < q.top - pad || y > q.bottom + pad)) continue
      const r = row.classList.contains('front') ? 'front' : row.classList.contains('lands') ? 'lands' : 'others'
      const keys = keysIn(row, '.pc[data-z^="k:"]', 'data-z').filter(k => k !== String(id))
      const before = keys.find(k => { const e = row.querySelector(`.pc[data-z="k:${k}"]`)?.getBoundingClientRect(); return e && e.left + e.width / 2 > x }) ?? null
      return { row: r, before, box: row.classList.contains('rear') ? row.querySelector('.brow.others') || row : row }
    }
    // fora das filas: cada carta vai para a fila dela (criaturas/planeswalkers à frente, encantamentos e artefactos na
    // deles), na posição pelo x; só no modo Livre fica solta onde a largaste
    if (P.place !== 'free') {
      const row = side.querySelector(`.brow.${kind}`), keys = row ? keysIn(row, '.pc[data-z^="k:"]', 'data-z').filter(k => k !== String(id)) : []
      const before = row && keys.find(k => { const e = row.querySelector(`.pc[data-z="k:${k}"]`)?.getBoundingClientRect(); return e && e.left + e.width / 2 > x }) || null
      return { row: kind, before, box: row || null }
    }
    return { free: spotOn(side, x, y, kind, false, id) }
  }
  const putAt = (id, w) => setLay(l => {  // guarda o sítio escolhido (a carta pode ainda estar na mão: conta quando entrar)
    const free = { ...l.free }; delete free[id]
    if (w?.free) return { ...l, free: { ...free, [id]: { x: w.free.x, y: w.free.y } } }
    if (!w?.row) return { ...l, free }
    const keys = w.box ? moveBefore(keysIn(w.box, '.pc[data-z^="k:"]', 'data-z').filter(k => !l.free?.[k]), String(id), w.before) : [String(id)]
    return { ...l, free, place: { ...l.place, [id]: w.row }, order: { ...l.order, ...Object.fromEntries(keys.map((k, i) => [k, i])) } }
  })
  const preview = m => {  // enquanto arrastas: onde a carta vai ficar — a casa (e a grelha, ao de leve) ou o sítio na fila
    const old = document.querySelector('.fp-slot'), side = document.querySelector('.fp-table .bside.bottom')
    const w = m && (m.from === 'field' || byId.get(m.id)?.land || !m.target?.closest('.pc[data-z^="k:"]')) && whereOn(m.id, m.target, m.x, m.y)
    if (!w) { old?.remove(); side?.classList.remove('fp-placing'); return }
    const n = old || Object.assign(document.createElement('div'), { className: 'fp-slot' })
    if (!old) side.appendChild(n)
    const sc = +side.closest('.fp-stage')?.dataset.sc || 1, sr = side.getBoundingClientRect()
    if (w.free) {
      const sp = w.free
      side.classList.add('fp-placing'); side.style.setProperty('--sx', `${sp.sx}px`); side.style.setProperty('--sy', `${sp.sy}px`); n.classList.remove('bar')
      Object.assign(n.style, { left: `${sp.px - sp.w / 2}px`, top: `${sp.py - sp.h / 2}px`, width: `${sp.w}px`, height: `${sp.h}px` })
      return
    }
    // numa fila: uma barra onde ela vai entrar (antes da carta `before`, ou no fim da fila)
    side.classList.remove('fp-placing'); n.classList.add('bar')
    const row = w.box || side, b = w.before != null && row.querySelector(`.pc[data-z="k:${w.before}"]`)
    const ks = [...row.querySelectorAll('.pc[data-z^="k:"]')].filter(e => e.dataset.z !== `k:${m.id}`), last = ks[ks.length - 1]
    const q = (b || last || row).getBoundingClientRect(), xx = b ? q.left - 5 * sc : last ? q.right + 5 * sc : q.left + 8 * sc
    Object.assign(n.style, { left: `${(xx - sr.left) / sc - 3}px`, top: `${(q.top - sr.top) / sc}px`, width: '6px', height: `${Math.max(40, q.height / sc)}px` })
  }
  // porque é que esta carta da mão não dá para jogar agora (o Forge só diz que não está na lista do que se pode jogar):
  // pela fase, de quem é o turno, a pilha, os terrenos por virar e o tipo da carta; o que não se percebe fica dito como talvez
  const whyNot = id => {
    const c = byId.get(id), d = c && (lookup(data, c.name)), t = d?.t || '', o = d?.o || ''
    const title = tx('Agora não dá para jogar {c}', { c: c?.name || tx('esta carta') }), say = msg => ({ title, msg })
    if (s.asks?.length) return say(tx('Primeiro responde à escolha que está aberta.'))
    const myTurn = st.active === me?.id, main = st.phase === 'MAIN1' || st.phase === 'MAIN2', empty = !st.stack?.length
    if (!/^Priority:/.test(pr?.msg || '')) return say(/^Waiting/.test(pr?.msg || '') ? tx('O adversário está a jogar: espera pela tua prioridade.') : tx('O Forge está à espera de outra coisa: vê o pedido ao lado.'))
    if (c?.land || /\bLand\b/.test(t)) {
      if (!myTurn) return say(tx('Os terrenos só se jogam no teu turno.'))
      if (!main || !empty) return say(tx('Os terrenos só se jogam na tua fase principal, com a pilha vazia.'))
      return say(me?.top?.id === id ? tx('Já jogaste um terreno neste turno, ou nenhuma carta tua deixa jogar terrenos do topo da biblioteca.') : tx('Já jogaste um terreno neste turno.'))
    }
    const fast = /\bInstant\b/.test(t) || /^Flash\b/im.test(o)
    if (!fast && (!myTurn || !main || !empty)) return say(tx('Não é instantâneo: só na tua fase principal, com a pilha vazia.'))
    const lands = (me?.battlefield || []).filter(x => x.land && !x.tapped).length, pool = Object.values(me?.mana || {}).reduce((a, n) => a + n, 0)
    if (d?.cmc != null && lands + pool < d.cmc) return say(tx('Falta mana: custa {n} e tens {m} por usar (terrenos por virar e reserva).', { n: d.cmc, m: lands + pool }))
    if (me?.top?.id === id) return say(tx('Do topo da biblioteca só se joga o que uma carta tua deixa (Courser of Kruphix: terrenos; Future Sight, Bolas\'s Citadel: tudo), e só quando o Forge o permite agora.'))
    if (/\btarget\b/i.test(o)) return say(tx('Talvez não haja um alvo válido para ela agora (ou falte a cor certa de mana).'))
    return say(tx('O Forge não a deixa jogar agora: falta a cor certa de mana ou uma condição da carta.'))
  }
  const drop = ({ id, from, target, x, y }) => {
    if (!target?.closest('.fp-table')) return false
    const hand = target.closest('.fp-hand')
    if (from === 'hand' && hand) {  // dentro da mão: mudar a ordem
      const h = target.closest('[data-h]'), l = moveBefore(keysIn(hand, '[data-h]', 'data-h'), String(id), h?.dataset.h)
      setLay(x => ({ ...x, hand: l })); return 'local'
    }
    const perm = target.closest('.pc[data-z^="k:"]'), pid = perm && +perm.dataset.z.slice(2), mine = st.active === me?.id
    if (from === 'hand' || from === 'library') {  // da mão (ou do topo da biblioteca: Courser, Future Sight…) para a mesa: jogar — só se o Forge diz que dá
      if (!byId.get(id)?.play && !st.pfail) { setToast(whyNot(id)); return false }  // pfail: o Forge não conseguiu calcular, decide ele
      // largada em cima de uma permanente (aura, remoção, reforço…): esse é o alvo — a mesa responde ao Forge por ti
      const land = byId.get(id)?.land
      if (pid != null && !land) { aim(pid, perm) }
      else if (!land && target.closest('.orb')) { const ob = target.closest('.orb'); aim(null, ob, null, players.indexOf(ob.closest('.bside')?.classList.contains('top') ? opp : me)) }  // na esfera: esse jogador
      // largada no teu lado (um terreno, mesmo por cima de outra carta): quando entrar em jogo fica nesse sítio/fila
      putAt(id, (pid == null || land) && whereOn(id, target, x, y))
      castNow(id); send1({ c: 'card', id }); return true
    }
    // equipamento teu largado numa criatura tua, no teu turno: equipar essa criatura
    if (pid != null && pid !== id && mine && /Equipment/.test(typeOf(id)) && byId.get(pid)?.creature && target.closest('.bside.bottom')) {
      aim(pid, perm, /^Equip/i); castNow(id); send1({ c: 'card', id }); return true
    }
    // bloquear arrastando: só quando o Forge pede os bloqueadores (antes disso, com prioridade, o clique ativava habilidades)
    if (!mine && blocking && pid && st.combat?.some(x => x.att === pid)) { send1({ c: 'card', id: pid }).then(() => send1({ c: 'card', id })); return true }  // largar num atacante: bloquear
    const atts = st.combat || []  // largar no lado dele com um só atacante: bloqueá-lo (não é preciso acertar na carta)
    if (!mine && !blocking && atts.length && /^COMBAT/.test(st.phase) && target.closest('.bside.top')) {
      const att = pid && atts.some(x => x.att === pid) ? pid : atts.length === 1 ? atts[0].att : null
      if (!att) { setToast({ title: tx('Larga-a em cima do atacante que queres bloquear'), msg: '' }); return false }
      planBlock(id, att); return true
    }
    if (!mine && blocking && atts.length === 1 && target.closest('.bside.top')) { send1({ c: 'card', id: atts[0].att }).then(() => send1({ c: 'card', id })); return true }
    if (mine && st.phase === 'COMBAT_DECLARE_ATTACKERS' && target.closest('.bside.top')) {  // largar no lado dele: atacar (quem: onde a largaste)
      const d = defOf(pid), cur = st.combat?.find(x => x.att === id)
      if (cur && d && String(cur.def) === String(d.c === 'card' ? d.id : opp?.id)) return true  // já ataca esse: um clique tirava-a do ataque
      ;(d ? send1(d) : Promise.resolve()).then(() => send1({ c: 'card', id })); return true
    }
    // ainda na fase principal: o gesto diz «ataca com esta» — passa-se ao combate e declara-se sozinho
    if (mine && st.phase === 'MAIN1' && target.closest('.bside.top') && byId.get(id)?.creature && /^Priority:/.test(pr?.msg || '') && !st.stack?.length) {
      if (byId.get(id)?.sick) { setToast({ title: tx('Esta criatura ainda não pode atacar'), msg: tx('Entrou neste turno (enjoo de invocação).') }); return false }
      const oracle = lookup(data, byId.get(id)?.name)?.o || ''
      if (/^Defender\b/im.test(oracle) || byId.get(id)?.tapped) { setToast({ title: tx('Esta criatura não pode atacar'), msg: byId.get(id)?.tapped ? tx('Está virada.') : tx('Tem a habilidade Defensor.') }); return false }
      attackIntent.current = { ids: [...(attackIntent.current?.ids || []), id], defs: { ...attackIntent.current?.defs, [id]: defOf(pid) }, until: Date.now() + 15000 }
      send1({ c: 'ok' }); return true
    }
    const w = whereOn(id, target, x, y)  // no teu lado: arrumar à vontade (numa fila pela posição, ou solta)
    if (!w) return false
    putAt(id, w); return 'local'
  }
  // tocar e manter: a carta em grande (no telemóvel o painel da carta não se vê); nunca uma carta escondida
  const [big, setBig] = useState(null), swipe = useRef(0)  // swipe: arrastar o cemitério/exílio para baixo fecha-o
  const bigOf = el => { const z = el?.dataset.z, c = z?.startsWith('k:') ? byId.get(+z.slice(2)) : el?.dataset.zid ? byId.get(+el.dataset.zid) : null; return c ? (c.hidden ? null : c.name) : z?.startsWith('n:') ? z.slice(2) : null }
  const { down, dragged } = useDrag(drop, id => { const c = byId.get(id); setZoom(c); if (c && !c.hidden) setBig(c.name) }, preview, undefined, el => setBig(bigOf(el)))
  // jogo mais solto (Definições › Mesa): o que acabaste de lançar paga-se sozinho (o «Pagar sozinho» do Forge) e o que é
  // teu no topo da pilha resolve-se sem teres de carregar em OK; criaturas arrastadas para o ataque na fase principal
  // declaram-se quando o Forge chega aos atacantes
  // os bloqueios marcados antes do pedido do Forge (à vista: a linha na mesa e a lista «A bloquear», com ✕ para desfazer)
  const [planned, setPlanned] = useState([])
  const unplan = blk => { const pairs = (blockIntent.current?.pairs || []).filter(p => p.blk !== blk); blockIntent.current = pairs.length ? { ...blockIntent.current, pairs } : null; setPlanned(pairs) }
  useEffect(() => { if (planned.length && !/^COMBAT/.test(st?.phase || '')) { blockIntent.current = null; setPlanned([]) } }, [st?.phase])  // eslint-disable-line react-hooks/exhaustive-deps
  const lastCast = useRef(null), autoKey = useRef(''), attackIntent = useRef(null), sNow = useRef(null), blockIntent = useRef(null), pendBlk = useRef(null), blkWait = useRef(0)
  // bloquear antes de o Forge pedir os bloqueadores (ainda no passo dos atacantes, com prioridade): o bloqueio fica marcado,
  // passa-se a prioridade (se a pilha está vazia) e, quando o pedido chega, o Forge recebe-o — confirmas com OK
  const planBlock = (blk, att) => {
    const pairs = (blockIntent.current?.pairs || []).filter(p => p.blk !== blk).concat({ att, blk })
    blockIntent.current = { pairs, until: Date.now() + 30000 }; setPlanned(pairs)
    setToast({ title: tx('Bloqueio marcado: {b} bloqueia {a}', { b: byId.get(blk)?.name || '?', a: byId.get(att)?.name || '?' }), msg: tx('Quando o Forge pedir os bloqueadores, este bloqueio entra sozinho; depois confirma com OK.') })
    if (/^Priority:/.test(pr?.msg || '') && !st.stack?.length) send({ c: 'ok' })
  }
  sNow.current = s
  const castNow = id => { lastCast.current = { id, t: Date.now() } }
  const autoAct = x => {  // o que a mesa faz sozinha neste estado: {k (uma vez só), c, ms} ou nada
    const p = x?.prompt, b0 = (p?.buttons || []).filter(b => b.label)[0], P = fpPrefs(), lc = lastCast.current, msg = p?.msg || ''
    if (!p || x.asks?.length || x.ended) return null
    if (P.autopay && /Pay Mana Cost/i.test(msg) && b0?.label === 'Auto' && b0.on && lc && p.card === lc.id && Date.now() - lc.t < 20000 && obviousPay(msg, (x.state?.players || []).find(q => q.me), n => lookup(data, n))) return { k: `pay${lc.t}`, c: { c: 'ok' }, ms: 120 }
    const top = x.state?.stack?.[0], meId = (x.state?.players || []).find(q => q.me)?.id
    if (P.autoresolve && /^Priority:/.test(msg) && top && top.by === meId && b0?.c === 'ok' && b0.on) return { k: `res${x.state.stack.length}|${top.card}|${top.text}`, c: { c: 'ok' }, ms: 650 }
    return null
  }
  useEffect(() => {
    if (!s) return
    const bi = blockIntent.current
    if (bi && Date.now() < bi.until && blocking && !s.asks?.length) {
      blockIntent.current = null; setPlanned([])
      bi.pairs.reduce((q, p) => q.then(() => send({ c: 'card', id: p.att })).then(() => send({ c: 'card', id: p.blk })), Promise.resolve())
      return
    }
    const ai = attackIntent.current
    if (ai && Date.now() < ai.until && ATK_ASK(pr?.msg) && !s.asks?.length) {
      attackIntent.current = null
      const on = new Set((st.combat || []).map(x => x.att))
      ai.ids.filter(x => !on.has(x)).reduce((q, x) => q.then(() => ai.defs?.[x] && send(ai.defs[x])).then(() => send({ c: 'card', id: x })), Promise.resolve())
      return
    }
    const a = autoAct(s)
    if (!a || autoKey.current === a.k) return
    autoKey.current = a.k
    // à hora de mandar volta-se a ver: se entretanto o adversário respondeu (outra coisa no topo), não se passa por ti
    setTimeout(() => { if (autoAct(sNow.current)?.k === a.k) send(a.c); else autoKey.current = '' }, a.ms)
  }, [s?.seq])  // eslint-disable-line react-hooks/exhaustive-deps
  // relógio de torneio (Definições › Mesa): quando te cabe responder a algo do adversário (no topo da pilha, ou no turno
  // dele) tens N s e depois passa sozinho, como num torneio a sério. Stop (tecla, S por omissão, ou o botão) dá mais X s,
  // uma vez por pergunta. No teu turno com a pilha vazia (estás a jogar) e nas escolhas (bloquear, alvos) não conta;
  // começar a responder (lançar, escolher) muda a pergunta e o relógio sai
  const [clock, setClock] = useState(null), clockRef = useRef(null)
  const clockKeyOf = x => {
    const P = fpPrefs(), p = x?.prompt, msg = p?.msg || ''
    if (!P.clock || !p || x.asks?.length || x.ended || !/^Priority:/.test(msg)) return null
    const b0 = (p.buttons || []).filter(b => b.label)[0]
    if (b0?.c !== 'ok' || !b0.on) return null
    const sx = x.state, meId = (sx?.players || []).find(q => q.me)?.id, top = sx?.stack?.[0]
    if (top ? top.by === meId : sx?.active === meId) return null
    return `${msg}|${sx?.stack?.length || 0}|${top?.card ?? ''}|${sx?.turn}|${sx?.phase}`
  }
  useEffect(() => {
    const k = clockKeyOf(s)
    if (!k) { if (clockRef.current) { clockRef.current = null; setClock(null) } return }
    if (clockRef.current?.k === k) return
    const total = fpPrefs().clockSec * 1000
    clockRef.current = { k, until: Date.now() + total, total, stopped: false, now: Date.now() }; setClock({ ...clockRef.current })
  }, [s?.seq])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // o tic-tac; ao fim, OK por ti (se a pergunta ainda for a mesma)
    if (!clock?.k) return
    const iv = setInterval(() => {
      const c = clockRef.current; if (!c) return
      // fora da mesa (outro separador, janela minimizada, outra área da app) o jogo pausa: o relógio também (o que falta fica)
      const now = Date.now(), el = fitBox.current, away = document.hidden || window.__grimAway || !el?.isConnected || !el.offsetParent  // __grimAway: .exe minimizado / APK em segundo plano
      if (away) { c.until += now - (c.now || now); c.now = now; if (!c.paused) { c.paused = true; setClock({ ...c }) } return }
      c.paused = false
      if (now >= c.until) { clockRef.current = null; setClock(null); if (clockKeyOf(sNow.current) === c.k) send({ c: 'ok' }); return }
      setClock({ ...c, now: Date.now() })
    }, 200)
    return () => clearInterval(iv)
  }, [clock?.k])  // eslint-disable-line react-hooks/exhaustive-deps
  const stopClock = () => {
    const c = clockRef.current; if (!c || c.stopped) return
    const extra = fpPrefs().clockExtra * 1000
    Object.assign(c, { until: Date.now() + extra, total: extra, stopped: true, now: Date.now() }); setClock({ ...c }); play('tick', { amount: 1 })
  }
  useEffect(() => {  // ordenar gatilhos iguais (três City of Brass ao mesmo tempo): a ordem não muda nada, responde-se sozinho
    const a = s?.asks?.[0]
    if (a?.kind === 'order' && (a.options || []).length > 1 && a.options.every(o => o.label === a.options[0].label)) answer(a, [])
  }, [s?.asks?.[0]?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  // intenção do gesto (alvo largado em cima): quando o Forge pergunta a habilidade ou o alvo, responde-se sozinho
  const intent = useRef(null)
  const typeOf = id => { const c = byId.get(id); return (c && (lookup(data, c.name))?.t) || '' }
  const aim = (pid, el, ability = null, player = null) => {
    intent.current = { target: pid, ability, player, el, until: Date.now() + 20000 }
    el?.classList.add('fp-hit'); setTimeout(() => el?.classList.remove('fp-hit'), 700)
  }
  // quando o Forge pede o alvo, o que largaste pisca um instante (0,9 s) antes de a mesa responder: tocar noutro alvo
  // nesse instante cancela e a escolha é tua
  const aimT = useRef(0)
  const aimFire = (fn, it) => {
    if (it.pending) return
    it.pending = true; it.el?.classList.add('fp-aim')
    aimT.current = setTimeout(() => { it.el?.classList.remove('fp-aim'); if (intent.current === it) { intent.current = null; fn() } }, 900)
  }
  const aimCancel = () => { if (!intent.current?.pending) return; clearTimeout(aimT.current); intent.current.el?.classList.remove('fp-aim'); intent.current = null }
  useEffect(() => {
    const it = intent.current
    if (!it || !s) return
    if (Date.now() > it.until || s.ended) { intent.current = null; return }
    const a = s.asks?.[0]
    if (a) {
      const opts = a.options || []
      if (it.ability) { const k = opts.findIndex(o => it.ability.test(o.label || '')); if (k >= 0) { it.ability = null; answer(a, [k]); return } }
      const k = a.kind === 'choose' && it.target != null ? opts.findIndex(o => o.card === it.target) : -1
      if (k >= 0) aimFire(() => answer(a, [k]), it)
      return
    }
    const m = s.prompt?.msg || ''
    if (it.player != null) { if (it.player >= 0 && !/^Priority:/.test(m) && /target/i.test(m)) aimFire(() => send({ c: 'player', i: it.player }), it); return }  // o Forge pede o alvo: esse jogador
    if (byId.get(it.target)?.sel) aimFire(() => send({ c: 'card', id: it.target }), it)  // o Forge pede o alvo: é este
  }, [s?.seq, s?.asks?.length])  // eslint-disable-line react-hooks/exhaustive-deps
  // animações como no tabuleiro dos bots: a pilha (StackFx) com «A resolver», números de dano/marcadores nas cartas e as
  // cartas que saem do campo a desaparecer (dying) — tudo a partir da diferença entre um estado do Forge e o seguinte
  const anim = useRef({ perms: new Map(), stack: [] }), [fxs, setFxs] = useState({ pops: new Map(), gone: [], rev: null, ri: 0 })
  const seqKey = s?.seq
  useLayoutEffect(() => {  // antes de pintar: a cópia «A resolver» entra no mesmo frame em que a carta sai da pilha (havia um frame com a pilha vazia)
    if (!st) return
    const a = anim.current, now = new Map(), pops = new Map(), gone = []
    for (const p of st.players || []) for (const c of p.battlefield || []) now.set(c.id, { c, side: p.id === me?.id ? 'a' : 'b' })
    for (const [id, { c }] of now) {
      const o = a.perms.get(id)?.c
      if (!o) continue
      if ((c.dmg || 0) > (o.dmg || 0)) pops.set(String(id), { i: seqKey, kind: 'dmg', n: -((c.dmg || 0) - (o.dmg || 0)) })
      // marcadores que mudaram (o último ganha: lealdade de um planeswalker ativado, +1/+1, capítulo de uma saga, defesa…)
      const cn = toPerm(c).counters, co = toPerm(o).counters
      for (const k of new Set([...Object.keys(cn), ...Object.keys(co)])) {
        const d = (cn[k] || 0) - (co[k] || 0)
        // lealdade a descer com uma habilidade dele na pilha = o custo de um «−N» (dourado), não dano
        const paid = k === 'loyalty' && (st.stack || []).some(x => x.card === id)
        if (d) pops.set(String(id), { i: seqKey, kind: d < 0 && !paid && (k === 'loyalty' || k === 'defense') ? 'dmg' : 'ctr', n: d, ct: k })
      }
      if (!!c.flipped !== !!o.flipped || !!c.faceDown !== !!o.faceDown) pops.set(String(id), { i: seqKey, kind: 'flip' })  // transformar, virar para cima (morph)
      // equipar / encantar: a criatura que recebe brilha com uma corrente (equipamento) ou um selo (aura)
      if (c.attachedTo != null && c.attachedTo !== o.attachedTo) pops.set(String(c.attachedTo), { i: seqKey, kind: 'attach', txt: /Equipment/.test(lookup(data, c.name)?.t || '') ? '⛓' : '✦' })
    }
    // ninjutsu (e afins): entra já a atacar enquanto outro atacante voltou para a mão
    const backHand = [...a.perms.keys()].some(id => !now.has(id) && (st.players || []).some(p => (p.hand || []).some(h => h.id === id)))
    for (const id of now.keys()) if (!a.perms.has(id) && backHand && (st.combat || []).some(x => x.att === id)) pops.set(String(id), { i: seqKey, kind: 'attach', txt: '🥷' })
    // para onde foi o que saiu do campo (o Forge mantém o id): cemitério = racha e desfaz-se, exílio = luz, mão/biblioteca = voa
    const destOf = id => { for (const p of st.players || []) for (const z of ['graveyard', 'exile', 'hand', 'library']) if ((p[z] || []).some?.(x => x.id === id)) return z; return 'graveyard' }
    const idxIn = {}  // o lugar que tinha na fila (para morrer onde estava, não no fim)
    for (const [id, x] of a.perms) { idxIn[x.side] = (idxIn[x.side] ?? -1) + 1; if (!now.has(id) && !x.c.hidden) gone.push({ ...x, idx: idxIn[x.side], to: destOf(id), until: Date.now() + 900 }) }
    // a pilha do Forge vem do topo para baixo; o que saiu dela resolveu (ou foi contrariado): fantasma «A resolver»
    const items = [...(st.stack || [])].reverse(), keyOf = x => `${x.card ?? ''}|${x.text}`
    // várias de uma vez (resolveram seguidas entre dois estados): todas saem a desvanecer, não só a primeira
    const lefts = a.stack.filter(x => !items.some(y => keyOf(y) === keyOf(x))), left = lefts.at(-1), side = x => (x.by === me?.id ? 'a' : 'b')
    a.perms = now; a.stack = items
    setFxs(f => ({ pops, gone: [...f.gone.filter(g => g.until > Date.now()), ...gone], rev: left ? { k: 'resolve', card: left.name, p: side(left), txt: left.text, more: lefts.slice(0, -1).map(x => ({ card: x.name, p: side(x) })) } : f.rev, ri: left ? f.ri + 1 : f.ri }))
  }, [seqKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!fxs.gone.length && !fxs.pops.size) return; const t = setTimeout(() => setFxs(f => ({ ...f, pops: new Map(), gone: f.gone.filter(g => g.until > Date.now()) })), 1200); return () => clearTimeout(t) }, [fxs.gone.length, fxs.pops])
  useEffect(() => {  // cartas que foram para o cemitério ou o exílio esquecem o sítio onde estavam (se voltarem, vão para as filas)
    const out = Object.keys(lay.free || {}).filter(k => players.some(p => [...(p.graveyard || []), ...(p.exile || [])].some(c => String(c.id) === k)))
    if (out.length) setLay(l => { const f = { ...l.free }; for (const k of out) delete f[k]; return { ...l, free: f } })
  }, [seqKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const [, redraw] = useState(0), [matOpen, setMatOpen] = useState(false)
  // ⟳ rodar (telemóvel/tablet): a app Android roda o ecrã ela própria; no browser, ecrã inteiro + bloquear a orientação
  // (o Chrome do Android só deixa em ecrã inteiro). Sem nenhum dos dois: diz para ligar a rotação automática. Ao sair, volta ao normal.
  const touchDev = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  // a declarar atacantes; OK sem nenhum atacante com criaturas que podiam atacar = talvez um OK sem querer: pergunta antes
  const declaring = !theirTurn && ATK_ASK(pr?.msg)
  // um só toque conta: com a pergunta aberta (Enter no botão dela também chegava aqui) ou o mesmo pedido já respondido
  // (toque duplo antes de o Forge mudar de passo) não se carrega outra vez — antes a pergunta aparecia 2x e o 2.º OK passava um passo a mais
  const pressing = useRef(false), pressedAt = useRef(null), saidNo = useRef('')  // saidNo: já disse «não ataco/não bloqueio» neste passo
  const pressBtn = async b => {
    if (pressing.current || pressedAt.current === `${s?.seq}|${b.c}`) return
    pressing.current = true
    try {
      const cre = (me?.battlefield || []).filter(c => (c.creature || c.pt) && !c.tapped), can = cre.filter(c => !c.sick).length
      const step = `${st?.turn}|${st?.phase}`  // o Forge pode repetir o pedido no mesmo passo (bloqueio inválido…): pergunta-se uma vez só
      if (b.c === 'ok' && declaring && !st?.combat?.length && can > 0 && saidNo.current !== `${step}|atk`
        && !(await confirmAsk('semataque', { title: tx('Não atacas com nenhuma criatura?'), body: tx('Tens {n} criatura(s) que podem atacar. OK passa o combate sem atacar.', { n: can }), ok: tx('Não atacar'), danger: false }))) return
      if (b.c === 'ok' && declaring && !st?.combat?.length) saidNo.current = `${step}|atk`
      if (b.c === 'ok' && blocking && !(st?.combat || []).some(x => x.blockers?.length) && cre.length > 0 && saidNo.current !== `${step}|blk`
        && !(await confirmAsk('sembloqueio', { title: tx('Não bloqueias?'), body: tx('Para bloquear, arrasta a tua criatura para o atacante (ou toca no atacante e depois nela). OK deixa passar o ataque todo.'), ok: tx('Não bloquear'), danger: false }))) return
      if (b.c === 'ok' && blocking && !(st?.combat || []).some(x => x.blockers?.length)) saidNo.current = `${step}|blk`
      pressedAt.current = `${s?.seq}|${b.c}`
      send({ c: b.c })
    } finally { pressing.current = false }
  }
  const rotate = async () => {
    const want = innerWidth < innerHeight ? 'landscape' : 'portrait'
    if (window.GrimorioApp?.orientation) return window.GrimorioApp.orientation(want)
    try {
      if (!document.fullscreenElement) await (fitBox.current?.closest('.coliseu') || document.documentElement).requestFullscreen()
      await screen.orientation.lock(want)
    } catch { setToast({ title: tx('Não deu para rodar'), msg: tx('Liga a rotação automática do telemóvel (ou usa a app Android do Grimório).') }) }
  }
  useEffect(() => () => { try { window.GrimorioApp?.orientation?.('auto'); screen.orientation?.unlock?.() } catch { /* nada a desfazer */ } }, [])
  const persp = () => { setFpPrefs({ persp: !fpPrefs().persp }); redraw(x => x + 1) }
  const fitBox = useRef(null), fitTable = useRef(null), stageWrap = useRef(null), peek = usePeek(), diceBox = useRef(null), dice = useTableDice(diceBox)
  // a moeda ao ar: o Forge tira-a antes de tudo e quem ganha escolhe se joga primeiro. Ganhaste → a pergunta «won the coin
  // toss» chega e a moeda vai ao ar nesse momento (cara); sem a pergunta, o jogo arranca e foi o adversário que ganhou
  // (coroa) — o aviso diz o que ele escolheu. Nos jogos seguintes de uma série escolhe quem perdeu o anterior: sem moeda.
  // Uma vez por jogo (sessionStorage), mesmo a recarregar.
  // as faces da moeda são os jogadores: o nome (curto) e as cores do deck de cada um — cai com a face de quem ganhou
  const tossed = useRef(false), sawWin = useRef(false)
  // a moeda é a 1.ª coisa do jogo: o three.js dos dados carrega enquanto o Forge abre o jogo e a camada dos dados
  // cria-se logo que a mesa existe (antes só ao 1.º lançamento: a moeda aparecia uns segundos depois)
  useEffect(() => { import('./Dice3D.js').catch(() => {}) }, [])
  // no início (turno ≤ 1) a moeda cria-a ela própria: aquecer ao mesmo tempo atrasava o lançamento (o 1.º desenho do WebGL
  // ocupa a página) — aí só aquece se a moeda não vier (série, recarregar)
  useEffect(() => { if (!st) return; const t = setTimeout(dice.warm, st.turn > 1 ? 0 : 2500); return () => clearTimeout(t) }, [!!st])  // eslint-disable-line react-hooks/exhaustive-deps
  // no início do jogo a moeda ao ar fica sozinha por cima da mesa escurecida (um toque salta), até cair e se ver quem ganhou
  const [intro, setIntro] = useState(null), coinToast = useRef(null)  // {won}; coinToast: o aviso de quem ganhou, para depois da moeda
  useEffect(() => { if (!intro && coinToast.current) { setToast(coinToast.current); coinToast.current = null } }, [intro])
  useEffect(() => {
    if (!intro) return
    const t = setTimeout(() => setIntro(null), dice.res?.items ? 1600 : 7000)  // depois de cair: 1,6 s para ler; sem cair (sem WebGL…): 7 s no máximo
    return () => clearTimeout(t)
  }, [intro, !!dice.res?.items])  // eslint-disable-line react-hooks/exhaustive-deps
  const coinFace = (p, side) => ({ n: String(p?.name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).join(' ').slice(0, 12) || '?',
    c: (document.querySelector(`.bside.${side} .orb:not(.orb-proxy)`)?.dataset.cols || '').replace(/[^WUBRGC]/g, '') })
  const toss = won => {
    if (tossed.current) return
    tossed.current = true
    try { const k = `grimorio.fp.toss.${sid}`; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1') } catch { /* sem armazenamento: lança na mesma */ }
    if ((st?.turn || 0) <= 1) setIntro({ won })
    setTimeout(() => dice.roll(['moeda'], [won ? 1 : 2], { words: [coinFace(me, 'bottom'), coinFace(opp, 'top')] }), 200)
    if (!won) {  // o aviso de quem ganhou: com a moeda de abertura, só depois de ela cair (antes aparecia com a moeda no ar)
      const t = { title: tx('Moeda: ganhou {p}', { p: opp?.name || tx('o adversário') }), msg: st?.active === me?.id ? tx('Escolheu ir em segundo: começas tu.') : tx('Escolheu jogar primeiro.') }
      if ((st?.turn || 0) <= 1) coinToast.current = t; else setTimeout(() => setToast(t), 2000)
    }
  }
  // a moeda: «you have won the coin toss» (com a escolha Jogar/Comprar) é tua; «X has won the coin toss» é o aviso a quem
  // perdeu — antes as duas contavam como tuas e ganhavas sempre
  useEffect(() => {
    const m = pr?.msg || ''
    if (!/won the coin toss/i.test(m)) return
    const mine = /you have won the coin toss/i.test(m) || (pr?.buttons || []).some(b => /^(Play|Draw)$/.test(b.label))
    sawWin.current = true; toss(mine)
  }, [pr?.msg])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!st?.turn || st.turn > 1 || st.active == null || !me) return
    if (series && (series.w?.[0] || 0) + (series.w?.[1] || 0) > 0) { tossed.current = true; return }  // jogo 2+ da série: escolhe quem perdeu
    // só se a pergunta «ganhaste a moeda» não chegar entretanto (o estado pode chegar antes dela: saía sempre a face do outro)
    // série (também nos torneios): «lost the last game» no pedido ou no registo = escolheu quem perdeu, sem moeda
    const t = setTimeout(() => { if (!sawWin.current && ![pr?.msg, ...(s?.log || []).map(x => x.msg)].some(x => /lost the last game/i.test(x || ''))) toss(false) }, 1500)
    return () => clearTimeout(t)
  }, [st?.turn, st?.active])  // eslint-disable-line react-hooks/exhaustive-deps
  const P = fpPrefs()
  const stage = useStage(fitBox, stageWrap, !!st)
  // a arte escolhida em cada deck ({a: {carta: edição/imagem}, b: …}): estável entre estados para não redesenhar a mesa toda
  const artsKey = JSON.stringify(s?.arts || null), artsCtx = useMemo(() => ({ arts: JSON.parse(artsKey), k: null }), [artsKey])
  const im = (c, size) => img(c, size, false, artOf(artsCtx.arts, null, c))
  const colsKey = `${cols?.a || ''}|${cols?.b || ''}`
  const orbCtx = useMemo(() => ({ mine: 'a', seed: sid, looks: null, cols }), [sid, colsKey])  // eslint-disable-line react-hooks/exhaustive-deps -- a minha esfera = as minhas preferências; a do Forge pelo deck ou ao acaso
  useOverlap(fitTable)
  // cartas que voltam do cemitério ou do exílio (reanimar, flashback de permanentes, exilar e devolver) e as que o adversário
  // joga da mão: voam do monte/mão de onde vieram (a tua mão e o campo já voam sozinhos pelo id)
  useZoneFlights(fitTable, seqKey, () => {
    const m = new Map(), sk = st?.stack || []
    // feitiços na pilha (data-si: de baixo para cima; a do Forge vem do topo): ao resolver para o campo voam de lá
    sk.forEach((x, i) => { if (!x.ability && x.card != null) m.set(x.card, { z: 'stack', src: `.stackfx .stk[data-si="${sk.length - 1 - i}"]` }) })
    for (const p of st?.players || []) {
      const side = `.bside.${p.id === me?.id ? 'bottom' : 'top'}`
      for (const z of ['hand', 'graveyard', 'exile', 'battlefield']) for (const c of p[z] || []) m.set(c.id, { z, fly: z === 'battlefield' || (z === 'hand' && p.id === me?.id), src: z === 'hand' ? (p.id === me?.id ? null : `${side} .myhand`) : z === 'battlefield' ? null : `${side} [data-zone="${z}"]` })
    }
    return m
  })
  useFlip(fitTable, seqKey, lay)
  if (!st) return <div className="fp-wait">{err ? <p className="bad-t">{err}</p> : <p className="muted">{tx('O Forge está a abrir o jogo (uns 20 segundos)…')}</p>}</div>
  const myTurn = st.active === me?.id
  const clockLeft = clock ? Math.max(0, clock.until - (clock.now || Date.now())) : 0
  const clockUi = clock && <div className={`fp-clock ${clock.stopped ? 'stopped' : ''} ${clockLeft < 3000 ? 'hurry' : ''}`} role="timer">
    <i style={{ '--k': (clockLeft / clock.total).toFixed(3) }} />
    <span>{clock.paused ? tx('Relógio em pausa: estás fora da mesa') : clock.stopped ? tx('A pensar: passa sozinho em {n} s', { n: Math.ceil(clockLeft / 1000) }) : tx('Passa sozinho em {n} s', { n: Math.ceil(clockLeft / 1000) })}</span>
    {!clock.stopped && <button type="button" className="fp-stop" onClick={stopClock} title={tx('Parar para pensar: mais {n} s para responder', { n: fpPrefs().clockExtra })}>⏸ {tx('Stop')} <kbd>{fpPrefs().clockKey.toUpperCase()}</kbd></button>}
  </div>
  const bs = { sides: ['a', 'b'], a: zoneOf(me || {}, st.combat), b: zoneOf(opp || {}, st.combat), active: myTurn ? 'a' : 'b', i: s.seq, exact: true, dmg }
  for (const x of planned) { const p = bs.a.perms.find(q => q.key === String(x.blk)); if (p && !p.blocking) Object.assign(p, { blocking: String(x.att), planned: true }) }
  bs.lost = s.ended && s.winner ? (s.winner === me?.name ? 'b' : 'a') : null  // quem perdeu: a esfera dele rebenta (Hud)
  // como perdeu cada um (a causa do Forge) e o empate: a esfera rebenta à maneira (vida, veneno, moer, comandante, carta…)
  bs.out = s.draw ? { a: 'draw', b: 'draw' } : Object.fromEntries((s.out || []).map(x => [x.name === me?.name ? 'a' : 'b', ORB_DEATH[x.r]]).filter(e => e[1]))
  for (const g of fxs.gone) if (!bs[g.side].perms.some(p => p.key === String(g.c.id))) bs[g.side].perms.splice(Math.min(g.idx ?? 1e9, bs[g.side].perms.length), 0, { ...toPerm(g.c), dying: g.to || true })
  const hashN = t => [...String(t)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0
  const sideOfP = pid => (pid === me?.id ? 'a' : 'b')
  bs.stack = [...(st.stack || [])].reverse().map(x => ({ uid: hashN(`${x.card}|${x.text}`), p: x.by === me?.id ? 'a' : 'b', card: x.name, text: x.ability ? x.text : undefined,  // o texto do Forge: o que foi mesmo ativado
    kind: !x.ability ? 'cast' : /^(When|Whenever|At)\b/.test(x.text || '') ? 'trigger' : 'activate',
    // alvos: as linhas da pilha (StackLinks) e o «→ alvo» da legenda
    tc: (x.tc || []).map(String), tp: (x.tp || []).map(sideOfP),
    target: x.tp?.length ? sideOfP(x.tp[0]) : x.tc?.length ? byId.get(x.tc[0])?.name : undefined }))
  const att = new Map()
  for (const p of [...bs.a.perms, ...bs.b.perms]) if (p.attachedTo) att.set(p.attachedTo, [...(att.get(p.attachedTo) || []), p])
  const sel = new Set([...byId.values()].filter(c => c.sel).map(c => String(c.id)))
  const picked = [...byId.values()].filter(c => c.picked).map(c => c.id)
  // escolhíveis que não se veem sozinhas na mesa: presas a outra carta (aura, Hopeful Eidolon com bestow), no cemitério,
  // no exílio, no topo da biblioteca ou noutra zona (selc do GrimorioNet): vão como botões no pedido — um toque escolhe
  const zoneOfId = id => { for (const p of players) for (const z of ['battlefield', 'hand']) if ((p[z] || []).some(c => c.id === id)) return z; return null }
  const selHidden = /^Priority:/.test(pr?.msg || '') ? [] : (st.selc?.length ? st.selc : [...byId.values()].filter(c => c.sel).map(c => ({ id: c.id, name: c.name })))
    .filter(x => { const c = byId.get(x.id); return !c || c.attachedTo != null || !zoneOfId(x.id) }).slice(0, 12)
  const selPick = selHidden.length > 0 && <div className="fp-selpick"><small>{tx('Também se escolhem (não estão à vista na mesa):')}</small><div>{selHidden.map(x => {
    const c = byId.get(x.id), nm = c && !c.hidden ? c.name : x.name, host = c?.attachedTo != null && byId.get(c.attachedTo)
    return <div key={x.id} role="button" tabIndex={0} className="fp-selb" data-zid={x.id} onClick={() => send({ c: 'card', id: x.id })} onKeyDown={e => { if (e.key === 'Enter') send({ c: 'card', id: x.id }) }}>
      <FCard c={{ id: x.id, name: nm || '', hidden: !nm, sel: true }} data={data} /><span><b>{nm || tx('Carta escondida')}</b>{host && <em>{tx('presa a {c}', { c: host.name })}</em>}</span></div> })}</div></div>
  // a escolher alvos (Path to Exile em resposta a um Counterspell…): a pilha em cima da mesa fica transparente e deixa passar os
  // cliques e o arrastar para as cartas por baixo, que ficam assinaladas
  const aiming = sel.size > 0 || /\btarget\b|assinaladas/i.test(pr?.msg || '')
  // o Forge mostra uma carta que não está à vista na mesa (vigiar/vidência de 1, do topo da biblioteca) e pede um de dois
  // botões: a carta vem em grande, ao centro, com as duas escolhas por extenso
  const reveal = !ask && pr?.cardName && pr.card != null && !byId.has(pr.card) && btns.filter(b => b.on).length === 2 && btns.some(b => /^(Library|Graveyard|Top|Bottom)$/.test(b.label)) ? pr : null  // só vigiar/vidência (o pagamento também traz a carta e tem de deixar clicar nos terrenos)  // já escolhidas nesta escolha do Forge (sacrificar 2…): moldura dourada
  const fx = { hl: sel, par: 'sel', pops: fxs.pops, life: lifeFx, player: psnFx && { p: psnFx.p, psn: true } }
  const openZone = (k, z) => setZone({ p: k === 'a' ? me : opp, k: z })
  const onClick = e => {  // um clique numa carta da mesa ou da mão = o mesmo que no Forge; no orbe = escolher o jogador
    if (dragged.current) return
    aimCancel()  // um toque teu enquanto o alvo largado pisca: escolhes tu
    const h = e.target.closest('[data-h]')
    if (h) {  // na mão, um clique só levanta a carta (jogar = arrastá-la para a mesa ou duplo clique); se o Forge pede uma carta da mão, escolhe-a
      const id = +h.dataset.h
      if (byId.get(id)?.sel || !/^Priority:/.test(pr?.msg || '')) return send({ c: 'card', id })  // o Forge pede uma escolha: o clique escolhe
      const c = byId.get(id), hl = handAbilities(c)
      setLift(l => (l === id && !hl.length ? null : id)); setZoom(c)
      // uma carta com uma habilidade que se usa da mão (ciclar, channel, ninjutsu, forecast, bloodrush, suspender…): o toque
      // mostra-a, com «Usar» — antes só se levantava e, se não dava para a lançar, não havia como ciclá-la sem a arrastar
      if (hl.length) { const r = h.getBoundingClientRect(), ok = c.play || st.pfail; setAct({ hand: true, off: !ok, hint: ok ? '' : tx('Agora o Forge não deixa usá-la: falta mana para o custo, ou não é a altura (ninjutsu: com um atacante teu por bloquear).'), id, x: Math.min(innerWidth - 280, Math.max(8, r.left + r.width / 2 - 130)), y: r.top - 8, up: true, lines: hl, name: c.name }) }
      return
    }
    const z = e.target.closest('[data-z]')?.dataset.z
    if (z?.startsWith('k:')) return permClick(+z.slice(2), e.target.closest('[data-z]'))
    const orb = e.target.closest('.orb')
    if (orb) send({ c: 'player', i: players.indexOf(orb.closest('.bside')?.classList.contains('top') ? opp : me) })
  }
  // um clique numa permanente: se o Forge pede uma escolha (alvo, sacrificar…) ou é tua e só dá mana (terreno, Sol Ring),
  // vai direto; se é tua e tem uma habilidade ativada que não é só mana, pergunta primeiro (antes ativava e pagava sozinho)
  const permClick = (id, el) => {
    const c = byId.get(id)
    const prio = /^Priority:/.test(pr?.msg || ''), mine = !!el?.closest('.bside.bottom')
    const lines = abilitiesOf(c)
    const oppCombat = st.active !== me?.id && /^COMBAT/.test(st.phase || ''), cre = !!(c?.creature || c?.pt)
    const atts = st.combat || []
    if (!mine && pendBlk.current && oppCombat && atts.some(x => x.att === id)) { planBlock(pendBlk.current, id); pendBlk.current = null; return }  // 2.º toque: o atacante
    if (prio && mine && oppCombat && cre && !lines.length && atts.length) {  // 1.º toque: a tua criatura (com um só atacante já fica)
      // um duplo clique (abrir as ações da carta) começa por dois cliques: espera um instante antes de marcar o bloqueio
      if (atts.length === 1) { clearTimeout(blkWait.current); blkWait.current = setTimeout(() => planBlock(id, atts[0].att), 280); return }
      pendBlk.current = id; return setToast({ title: tx('Agora toca no atacante que ela bloqueia'), msg: '' })
    }
    if (!prio || c?.sel || !mine || c?.land || !lines.length || (lines.every(l => /:\s*Add\b/.test(l)) && !(oppCombat && cre))) return send({ c: 'card', id })
    const r = el.getBoundingClientRect(), hint = oppCombat && cre ? tx('Ainda não é a altura de bloquear: para bloquear, carrega OK até o Forge pedir os bloqueadores.') : ''
    setAct({ hint, id, x: Math.min(innerWidth - 280, Math.max(8, r.left + r.width / 2 - 130)), y: r.top > 240 ? r.top - 8 : r.bottom + 8, up: r.top > 240, lines, name: c.name, pw: c.pw })
  }
  // atacar: largar (ou ter largado) a criatura num planeswalker/batalha do adversário = atacá-lo; noutro sítio do lado dele,
  // com planeswalkers/batalhas à vista, o jogador (o Forge guarda o último defensor escolhido: assim nunca fica no errado)
  const defOf = pid => {
    const c = pid != null && (opp?.battlefield || []).find(x => x.id === pid)
    if (c && (c.loyalty != null || c.counters?.DEFENSE != null || /\b(Planeswalker|Battle)\b/.test(typeOf(pid)))) return { c: 'card', id: pid }
    return (opp?.battlefield || []).some(x => x.loyalty != null || x.counters?.DEFENSE != null) ? { c: 'player', i: players.indexOf(opp) } : null
  }
  const activateAb = d => { if (!act) return; castNow(act.id); send({ c: 'card', id: act.id, ab: d }); setAct(null) }  // a habilidade de lealdade escolhida
  const activate = () => { if (!act || act.off) return; castNow(act.id); send({ c: 'card', id: act.id }); setAct(null) }  // pedido explícito: o «pagar sozinho» pode pagar
  // as habilidades ativadas de uma carta (custo: efeito, Equip…), pelo texto
  function abilitiesOf(c) {
    const d = c && (lookup(data, c.name))
    return String(d?.o || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(l => /^[^"]{1,90}?:\s/.test(l) || /^Equip\b/i.test(l))
  }
  // as que se usam com a carta na mão (não é lançá-la): ciclar e variantes, channel, bloodrush, forecast, transmutar,
  // ninjutsu, suspender, foretell, plot, reinforce, e «Descarta/Revela/Exila esta carta (da tua mão): …»
  function handAbilities(c) {
    const d = c && !c.hidden && lookup(data, c.name), nm = String(d?.n || c?.name || '').split(' // ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!d) return []
    const self = nm && new RegExp(`\\b(?:Discard|Reveal|Exile) (?:this card|${nm})(?: from your hand)?\\b[^:"]*:`, 'i')
    return String(d.o || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(l => /^[A-Za-z ]*cycling\s*(?:\{|—|-)/i.test(l) || /^(?:Channel|Bloodrush|Forecast)\s*—/i.test(l)
      || /^(?:Transmute|(?:Commander )?ninjutsu|Foretell|Plot)\s+\{/i.test(l) || /^(?:Suspend|Reinforce)\s+(?:\d+|X)\s*—/i.test(l) || (self && /^[^"]*:/.test(l) && self.test(l)))
  }
  // duplo clique numa carta TUA na mesa, em qualquer fase (também a atacar e a bloquear): as ações dessa carta; numa do
  // adversário: a carta em grande
  const permActions = (id, el) => {
    const c = byId.get(id)
    if (!c || c.hidden) return
    if (!el.closest('.bside.bottom')) return setBig(c.name)
    const r = el.getBoundingClientRect()
    setAct({ id, dbl: true, x: Math.min(innerWidth - 280, Math.max(8, r.left + r.width / 2 - 130)), y: r.top > 240 ? r.top - 8 : r.bottom + 8, up: r.top > 240, lines: abilitiesOf(c), name: c.name, pw: c.pw })
  }
  const onDouble = e => {  // duplo clique numa carta da mão = jogá-la (atalho); numa permanente = as ações dela
    const pc = !e.target.closest('[data-h]') && e.target.closest('.fp-table .pc[data-z^="k:"]')
    if (pc && !dragged.current) { clearTimeout(blkWait.current); pendBlk.current = null; return permActions(+pc.dataset.z.slice(2), pc) }
    const h = e.target.closest('[data-h]')
    if (!h || dragged.current) return
    const id = +h.dataset.h
    if (!byId.get(id)?.play && !st.pfail) { setToast(whyNot(id)); return }
    setLift(null); castNow(id); send({ c: 'card', id })
    if (lay.free?.[id]) setLay(l => { const f = { ...l.free }; delete f[id]; return { ...l, free: f } })  // sem sítio escolhido: vai para a fila
  }
  const onOver = e => {
    peek.over(e.target.closest('.fp-table .pc-attc[data-z], .fp-table .pc[data-z^="k:"]'))
    const el = e.target.closest('[data-z], [data-zid]'), z = el?.dataset.z
    hoverId.current = el?.dataset.h ? +el.dataset.h : z?.startsWith('k:') ? +z.slice(2) : null
    const c = z?.startsWith('k:') ? byId.get(+z.slice(2)) : el?.dataset.zid ? byId.get(+el.dataset.zid) || (el.dataset.zn && { name: el.dataset.zn }) : z?.startsWith('n:') ? { name: z.slice(2) } : null
    if (c && !c.hidden) setZoom(c)
  }
  // quem bloqueia quem: os marcados (ainda à espera do pedido do Forge) e os que o Forge já aceitou; ✕ desfaz
  const blockList = st?.active !== me?.id ? [...planned.map(x => ({ ...x, planned: true })), ...(st?.combat || []).flatMap(x => (x.blockers || []).filter(b => !planned.some(p => p.blk === b)).map(b => ({ att: x.att, blk: b })))] : []
  const blockBox = blockList.length > 0 && <span className="fp-blocks" role="list" aria-label={tx('A bloquear')}>
    <b>🛡 {tx('A bloquear')}:</b>{blockList.map(x => <span key={`${x.blk}`} role="listitem" className={`fp-blk ${x.planned ? 'planned' : ''}`}>
      {byId.get(x.blk)?.name || '?'} → {byId.get(x.att)?.name || '?'}{x.planned && <i> ({tx('marcado')})</i>}
      {(x.planned || blocking) && <button type="button" className="link small" title={tx('Desfazer este bloqueio')} onClick={() => (x.planned ? unplan(x.blk) : unblock(x))}>✕</button>}</span>)}
  </span>
  // desfazer um bloqueio aceite: no Forge um clique no bloqueador só o tira se o atacante «atual» for o que ele bloqueia (senão
  // muda o bloqueio para esse) — primeiro escolhe-se o atacante, depois o bloqueador
  const unblock = async x => { await send({ c: 'card', id: x.att }); await send({ c: 'card', id: x.blk }) }
  // a declarar atacantes: a lista «A atacar» com ✕ (no Forge, clicar num atacante tira-o do combate)
  const atkList = !theirTurn && ATK_ASK(pr?.msg) ? (st?.combat || []).map(x => x.att).filter(a => byId.get(a)) : []
  const atkBox = atkList.length > 0 && <span className="fp-blocks" role="list" aria-label={tx('A atacar')}>
    <b>⚔ {tx('A atacar')}:</b>{atkList.map(a => <span key={a} role="listitem" className="fp-blk atk">{byId.get(a)?.name || '?'}
      <button type="button" className="link small" title={tx('Tirar do ataque')} onClick={() => send({ c: 'card', id: a })}>✕</button></span>)}
  </span>
  const zc = zoom && (lookup(data, zoom.name))
  const nOpp = opp?.hand?.length || 0, mana = Object.entries(me?.mana || {})
  const handIn = cs => (lay.hand ? [...cs].sort((x, y) => { const i = lay.hand.indexOf(String(x.id)), k = lay.hand.indexOf(String(y.id)); return (i < 0 ? 1e9 : i) - (k < 0 ? 1e9 : k) }) : cs)
  const tilt = e => {  // inclinação 3D da carta debaixo do rato (e o brilho a segui-lo)
    const el = e.target.closest('.pc, .fp-card')
    if (!el) return
    const q = el.getBoundingClientRect()
    el.style.setProperty('--tx', ((e.clientX - q.left) / q.width - 0.5).toFixed(3)); el.style.setProperty('--ty', ((e.clientY - q.top) / q.height - 0.5).toFixed(3))
  }
  return (<Arts.Provider value={artsCtx}><OrbCtx.Provider value={orbCtx}>
    <div className={`fp ${dice.res ? 'dice-on' : ''}`} ref={fitBox} onMouseLeave={() => { setZoom(null); peek.hide() }} onMouseOver={onOver} onPointerDown={peek.hide}
      onPointerDownCapture={e => { if (e.target.closest('.fp-stagebox') && dice.grab(e)) e.stopPropagation() }}>
      <div className="fp-stagebox" ref={stageWrap} style={{ height: stage.h }}>
      <FsBtn className="on-table" />
      <div className={`fp-stage ${stage.shape} ${P.persp ? 'persp' : ''} ${P.oppFace === 'far' ? 'opp-far' : ''}`} data-sc={stage.sc} style={{ width: stage.W || STAGE[stage.shape][0], height: stage.H || STAGE[stage.shape][1], transform: `translateX(${stage.left}px) scale(${stage.sc})`, '--tilt': `${P.tilt}deg`, '--tf': P.tilt / 45 }}>
      <div className={`fp-table board table ${aiming ? 'fp-aiming' : ''} ${blocking ? 'fp-blocking' : ''} ${P.cardPx ? 'px' : ''} ${st.combat?.length || /COMBAT_DECLARE_BLOCKERS/.test(st.phase || '') ? 'combat-on' : ''} ${declaring ? 'fp-declaring' : ''}`} style={cardVars(P.cardPx) || undefined} ref={fitTable} onClick={onClick} onDoubleClick={onDouble} onMouseMove={tilt} onPointerDown={down}>
        {flipped.size > 0 && <style>{[...flipped].map(k => `.fp-table .pc[data-z="k:${k}"] .pc-f`).join(',')}{'{ transform: rotate(180deg); }'}</style>}
        {picked.length > 0 && <style>{picked.map(k => `.fp-table .pc[data-z="k:${k}"] .pc-f`).join(',')}{'{ box-shadow: 0 0 0 3px var(--gold), 0 0 18px var(--gold) !important; animation: none !important; translate: 0 -8px; }'}</style>}
        {opp && <Side k="b" top name={opp.name} s={bs} data={data} fx={fx} att={att} start={20} openZone={openZone} mat={P.mats ? null : P.mat}
          hand={nOpp > 0 && <Hand z={{ hand: nOpp, known: opp.hand.map(c => (c.hidden ? '?' : c.name)) }} data={data} exact opp hidden quiet />} />}
        <div className="fp-mid">
          <span className="fp-turn">{tx('Turno {n}', { n: st.turn })} · {myTurn ? tx('teu') : opp?.name}</span>
          {st.day && <DayNight v={st.day} />}
          <span className="fp-phases">{PHASES.map(([k, l, ps]) => <i key={k} className={ps.includes(st.phase) ? (/^COMBAT/.test(st.phase || '') ? 'on combat' : 'on') : ''}>{l}</i>)}</span>
          {declaring && <span className="fp-declare" role="status">⚔ {tx('Declara os atacantes: toca nas criaturas que atacam e depois OK')}</span>}
          <StackFx s={bs} rev={fxs.rev} ri={fxs.ri} data={data} arts={artsCtx.arts} who={{ a: me?.name, b: opp?.name }} speed={1} />
        </div>
        {me && <Side k="a" name={me.name} s={bs} data={data} fx={fx} att={att} start={20} openZone={openZone} mat={P.mat} place={lay.place} order={lay.order} free={P.place === 'rows' ? null : lay.free}
          hand={<div className="fp-hand">{me.top?.play && <FCard key={`t${me.top.id}`} c={me.top} h={me.top.id} from="library" data={data} big cls={`play libtop-h ${lift === me.top.id ? 'lift' : ''}`} tag={`▲ ${tx('topo da biblioteca')}`} />}{handIn(me.hand || []).map(c => <FCard key={c.id} c={c} h={c.id} data={data} big flip={flipped.has(c.id)} cls={`${c.play ? 'play' : ''} ${lift === c.id ? 'lift' : ''}`} />)}</div>} />}
        {bs && <CombatLinks s={bs} />}
        {bs && <StackLinks s={bs} data={data} />}
        <DamageFx hits={hits} data={data} />
        {bs && <ZoneFx s={bs} data={data} />}
      </div>
      </div>{intro && <div className="fp-coin-intro" onClick={() => setIntro(null)} role="status">
        <b>{dice.res?.items ? (intro.won ? tx('Ganhaste a moeda ao ar') : tx('Moeda: ganhou {p}', { p: opp?.name || tx('o adversário') })) : tx('Moeda ao ar: quem começa?')}</b>
        <small>{tx('toca para continuar')}</small></div>}
      <div className="fp-dice" ref={diceBox} /></div>
      {touchDev && <div className={`fp-actbar ${pr && btns.some(b => b.on) ? 'mine' : ''}`}>  {/* telemóvel/tablet: o pedido e OK/Cancelar sempre à vista, por baixo da mesa */}
        <p><Syms text={promptText(pr?.msg, st, me)} />{blockBox}{atkBox}</p>
        {unstick}{selPick}
        {mana.length > 0 && <span className="fp-pool">{mana.map(([k, n]) => <ManaOrb key={k} k={k} n={n} onClick={() => send({ c: 'mana', color: k })} />)}</span>}
        <span className="row-btns">{btns.map((b, k) => <button key={k} className={k ? '' : 'primary'} disabled={!b.on} onClick={() => pressBtn(b)}>{BTN[b.label] || b.label}</button>)}</span>
        {clockUi}
        <FsBtn />
      </div>}
      <aside className="fp-side">
        <div className="fp-zoom">{zc ? <img key={zc.n} className="fp-zin" src={im(zc, 'normal')} alt={zc.n} /> : <p className="muted small">{tx('Passa o rato por uma carta (no tablet: toca e mantém) para a veres em grande.')}</p>}</div>
        <div className={`fp-prompt ${pr && btns.some(b => b.on) ? 'mine' : ''}`}>
          {pr?.msg && !/^(Priority:|Waiting for)|keep your hand|coin toss|Declare (attackers|blockers)|Select creatures to (attack|block)/i.test(pr.msg) && <ForWhat src={sourceOf(pr.msg, pr.card, pr.cardName, st)} data={data} />}
          <p><Syms text={promptText(pr?.msg, st, me)} /></p>
          {blockBox}{atkBox}
          {clockUi}
          {unstick}
          {selPick}
          <div className="row-btns">{btns.map((b, k) => <button key={k} className={k ? '' : 'primary'} disabled={!b.on} onClick={() => pressBtn(b)} title={k === 0 ? 'Enter' : b.label === 'End Turn' ? 'Shift+Enter' : 'Esc'}>{BTN[b.label] || b.label} <kbd>{k === 0 ? '⏎' : b.label === 'End Turn' ? '⇧⏎' : 'Esc'}</kbd></button>)}</div>
          {mana.length > 0 && <span className="fp-pool" title={tx('Reserva de mana: clica para a usar')}>{mana.map(([k, n]) => (
            <ManaOrb key={k} k={k} n={n} onClick={() => send({ c: 'mana', color: k })} title={tx('Usar esta mana')} />))}</span>}
          <RulesQuick />
          <p className="small muted fp-tip">{tx('Arrasta uma carta da mão para a mesa para a jogar. No combate, arrasta uma criatura tua para o lado do adversário (atacar) ou para cima de um atacante (bloquear). Arruma o teu lado e a mão como quiseres: larga uma carta por cima de outra ou numa fila.')} {tx('Duplo clique numa carta tua na mesa abre as ações dela, em qualquer fase (também a atacar e a bloquear).')}</p>
          <div className="fp-dicebar"><span className="muted small">🎲</span>
            {[['d6', ['d6']], ['2d6', ['d6', 'd6']], ['d20', ['d20']], [tx('moeda'), ['moeda']]].map(([l, t]) => <button key={l} type="button" className="link small" onClick={() => dice.roll(t)} title={tx('Lançar na mesa')}>{l}</button>)}
            {dice.res?.items && <button type="button" className="fp-dres" onClick={dice.off} title={tx('Tirar os dados da mesa')}>{dice.res.items.map(x => (x.type === 'moeda' ? (dice.res.words?.[x.v - 1]?.n ? tx('Moeda: {n}', { n: dice.res.words[x.v - 1].n }) : x.v === 1 ? tx('Cara') : tx('Coroa')) : x.v)).join(' + ')}{dice.res.items.length > 1 && dice.res.items.every(x => x.type !== 'moeda') ? ` = ${dice.res.items.reduce((a, x) => a + x.v, 0)}` : ''} ✕</button>}</div>
          <Hist log={st.log} nameOf={id => byId.get(id)?.name} />
          <div className="row-btns small">
            <button className="link small" onClick={() => send({ c: 'undo' })}>↶ {tx('desfazer')}</button>
            {(lay.free && Object.keys(lay.free).length > 0) || lay.order ? <button className="link small" onClick={() => setLay(l => ({ hand: l.hand }))} title={tx('As cartas do teu lado voltam às filas automáticas')}>▦ {tx('arrumar')}</button> : null}
            <button className="link small" onClick={persp} title={tx('Lado do adversário em perspetiva (mais espaço para o teu)')}>{P.persp ? '▭' : '⏢'} {tx('perspetiva')}</button>
            <CardPx className="small" onChange={() => redraw(x => x + 1)} />
            {touchDev && <button className="link small" onClick={rotate} title={tx('Rodar a mesa (deitado / ao alto), mesmo com a rotação automática desligada')}>⟳ {tx('rodar')}</button>}
            <button className={`link small ${matOpen ? 'on' : ''}`} onClick={() => setMatOpen(x => !x)} aria-expanded={matOpen} title={tx('Padrão da mesa')}>🎨 {tx('tapete')}</button>
            <button className="link small" onClick={() => send({ c: 'concede' })}>🏳 {tx('desistir')}</button>
          </div>
          {matOpen && <MatPick onMat={() => redraw(x => x + 1)} />}
          {err && <p className="small bad-t">{err}</p>}
        </div>
      </aside>
      {rvl && !ask && <div className="fp-modal" onClick={() => setRvl(null)}><div className="fp-ask fp-rv-ask" role="dialog" aria-label={revealTitle(rvl.title)} onClick={e => e.stopPropagation()}>
        <button type="button" className="fp-rv-x" aria-label={tx('Fechar')} onClick={() => setRvl(null)}>✕</button>
        <RevealCards rv={rvl} data={data} zoom={setZoom} peek={setBig} />
        <div className="row-btns"><button className="primary" onClick={() => setRvl(null)}>{tx('OK')} <kbd>⏎</kbd></button></div></div></div>}
      {ask && <div className="fp-modal"><Ask key={ask.id} a={ask} rv={rvl} st={st} data={data} answer={answer} zoom={setZoom} payCancel={/Pay Mana Cost/i.test(pr?.msg || '') && btns.some(b => b.label === 'Cancel') ? () => send({ c: 'cancel' }) : null} undo={st.stack?.length ? null : () => send({ c: 'undo' })} /></div>}
      {big && <BigCard name={big} data={data} onClose={() => setBig(null)} />}
      {act && <div className="fp-act-bg" onPointerDown={() => setAct(null)} />}
      {act && <div className={`fp-act ${act.up ? '' : 'below'}`} role="dialog" aria-label={tx('Ativar {c}', { c: act.name })} style={{ left: act.x, top: act.y }}>
        <b>{act.dbl ? act.name : act.hand ? tx('Usar {c} da mão', { c: act.name }) : tx('Ativar {c}?', { c: act.name })}</b>
        {act.pw?.length ? <>
          {act.pw.map((a, k) => { const m = a.d.match(/^\[?([+−-]?(?:\d+|X))\]?\s*:\s*/), cost = m?.[1]?.replace('-', '−') || '', txt = m ? a.d.slice(m[0].length) : a.d
            return <button key={k} type="button" className={`pw-ab ${/^\+/.test(cost) ? 'up' : /^[−]/.test(cost) ? 'down' : ''}`} disabled={!a.ok} onClick={() => activateAb(a.d)}
              title={a.ok ? '' : tx('Agora não: a lealdade usa-se uma vez por turno, na tua fase principal e com a pilha vazia (e um «−» precisa de lealdade que chegue).')}>
              {cost && <b className="pw-cost">{cost}</b>}<span><Syms text={txt} /></span></button> })}
          {!act.pw.some(a => a.ok) && <small className="muted">{tx('Agora não: a lealdade usa-se uma vez por turno, na tua fase principal e com a pilha vazia (e um «−» precisa de lealdade que chegue).')}</small>}
        </> : <>
          {act.lines.map((l, k) => <p key={k}><Syms text={l} /></p>)}
          {!act.lines.length && <p className="muted small">{tx('Esta carta não tem habilidades para ativar.')}</p>}
          {act.lines.length > 1 && !act.hand && <small className="muted">{tx('Com mais de uma, escolhes a seguir.')}</small>}
          {act.hand && <small className="muted">{tx('Lançá-la também se escolhe a seguir (ou arrasta-a para a mesa).')}</small>}
        </>}
        {act.hint && <small className="fp-act-hint">{act.hint}</small>}
        <div className="row-btns">{act.lines.length > 0 && !act.pw?.length && <button className="primary" autoFocus disabled={act.off} onClick={activate}>{act.hand ? tx('Usar') : tx('Ativar')} <kbd>⏎</kbd></button>}
          {act.dbl && <button onClick={() => { setBig(act.name); setAct(null) }}>{tx('Ver a carta')}</button>}<button onClick={() => setAct(null)}>{act.lines.length ? tx('Cancelar') : tx('Fechar')} <kbd>Esc</kbd></button></div>
      </div>}
      {reveal && <div className="fp-modal"><div className="fp-ask fp-reveal" key={`${reveal.card}`}>
        <p>{btns.some(b => b.label === 'Graveyard') ? tx('Vigiar: {c} fica no topo da biblioteca ou vai para o cemitério?', { c: reveal.cardName })
          : btns.some(b => b.label === 'Bottom') ? tx('Vidência: {c} fica no topo ou vai para o fundo da biblioteca?', { c: reveal.cardName }) : <Syms text={reveal.msg} />}</p>
        <div className="fp-opts fp-reveal-c"><FCard c={{ id: reveal.card, name: reveal.cardName }} data={data} big /></div>
        <div className="row-btns">{btns.map((b, k) => <button key={k} className={k ? '' : 'primary'} disabled={!b.on} onClick={() => pressBtn(b)}>{BTN[b.label] || b.label} <kbd>{k ? 'Esc' : '⏎'}</kbd></button>)}</div>
      </div></div>}
      {zone && <div className="fp-modal zone" onClick={() => setZone(null)}><div className="fp-ask" onClick={e => e.stopPropagation()} onPointerDown={e => { swipe.current = e.clientY }} onPointerUp={e => { if (e.pointerType !== 'mouse' && e.clientY - swipe.current > 90) setZone(null) }}>
        <p><b>{zone.k === 'graveyard' ? tx('Cemitério de {n}', { n: zone.p.name }) : tx('Exílio de {n}', { n: zone.p.name })}</b> <button className="link small" onClick={() => setZone(null)}>{tx('fechar')}</button></p>
        <div className="fp-opts">{(players.find(p => p.id === zone.p.id)?.[zone.k] || []).map(c => <FCard key={c.id} c={c} data={data} big onClick={x => { send({ c: 'card', id: x.id }); setZone(null) }} />)}</div></div></div>}
      {toast && <div className={`fp-toast ${toast.out ? 'out' : ''}`} onClick={() => setToast(null)}>{toast.title && <b>{toast.title}</b>} <Syms text={toast.msg} />{toast.list && <ul>{toast.list.map((l, k) => <li key={k}><Syms text={l} /></li>)}</ul>}</div>}
      {s.ended && endShown && <div className="fp-modal"><div className="fp-ask fp-end">
        <h3>{s.draw ? tx('🤝 Empate') : s.winner ? (s.winner === me?.name ? tx('🏆 Ganhaste!') : tx('Ganhou {n}', { n: s.winner })) : s.crash ? tx('O Forge falhou a meio deste jogo') : s.lost ? tx('Este jogo perdeu-se: o servidor foi reiniciado') : tx('Jogo terminado')}</h3>
        {endWhy(s.out) && <p className="fp-why">{endWhy(s.out)}</p>}
        {(s.crash || s.lost) && <p className="muted">{tx('Nada conta: não perdeste nem ganhaste. Num torneio, a partida volta a esperar por ti — abre-a outra vez para recomeçar.')}</p>}
        {series && <p className="fp-series">{series.done ? (series.w[0] > series.w[1] ? tx('🏆 Ganhaste a série {a}–{b}', { a: series.w[0], b: series.w[1] }) : tx('Perdeste a série {a}–{b}', { a: series.w[0], b: series.w[1] })) : tx('Série Bo{n}: {a}–{b}', { n: series.bo, a: series.w[0], b: series.w[1] })}</p>}
        <div className="row-btns">{onAgain && <button className="primary" onClick={onAgain}>▶ {againLabel || (series && !series.done ? tx('Jogo seguinte (sideboard)') : series ? tx('Nova série') : tx('Jogar outra vez'))}</button>}<button onClick={onClose}>{tx('Fechar')}</button></div></div></div>}
    </div></OrbCtx.Provider></Arts.Provider>
  )
}
