// Forge Play nativo: jogas contra a IA do Forge com a mesa do Grimório. O motor corre no servidor (playnet.py +
// build/forge/GrimorioNet.java) e manda o estado do jogo, o pedido atual (o que o motor espera de ti) e as escolhas
// pendentes; aqui desenha-se a mesa e cada clique volta como comando (carta, jogador, OK/cancelar, mana, responder).
import { fpPrefs, setFpPrefs, cardVars } from './fpprefs.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { img } from './data.js'
import { Side, Hand, StackFx, CardPx, MatPick, CombatLinks } from './Board.jsx'
import { tx } from './i18n.js'
import { playDiff } from './sfx.js'
import { Syms } from './ui.jsx'
import { obviousPay } from './mana.js'
import { useBackClose } from './backnav.js'
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
  if (/won the coin toss/.test(m)) return tx('Ganhaste a moeda ao ar: jogas primeiro ou vais em segundo?')
  if (/keep your hand/.test(m)) return /going first/.test(m) ? tx('Começas tu. Ficas com esta mão?') : tx('Começa o adversário. Ficas com esta mão?')
  // descartar (mão cheia, Faithless Looting…): quantas já escolheste — as escolhidas sobem com moldura dourada
  const disc = m.match(/(?:Select|Choose) (\d+) cards?(?:\(s\))? to discard|Discard (\d+) cards?/i)
  const got = (me?.hand || []).filter(c => c.picked).length
  if (disc) return `${/^Select \d+ card\(s\) to discard/i.test(m) && st?.phase === 'CLEANUP' ? tx('Mão cheia: clica em {n} carta(s) da mão para descartar.', { n: disc[1] || disc[2] }) : tx('Descartar: clica em {n} carta(s) da mão.', { n: disc[1] || disc[2] })} ${tx('Escolhidas: {k} de {n}.', { k: got, n: disc[1] || disc[2] })}`
  // «Spider Umbra (4) - Spider Umbra\n\nSelect target creature»: o pedido nem sempre vem na 1.ª linha
  const ask = m.split('\n').find(l => /^(Select|Choose)/i.test(l.trim()))
  if (ask && st?.players?.some(p => [...(p.hand || []), ...(p.battlefield || [])].some(c => c.sel))) return `${tx('Clica numa das cartas assinaladas.')} (${ask.trim()})`
  if (/Declare attackers|Select creatures to attack/i.test(m)) return tx('Atacar: clica nas criaturas que atacam e depois OK.')
  if (/Declare blockers|Select creatures to block/i.test(m)) return tx('Bloquear: clica no atacante e depois na tua criatura que bloqueia; OK no fim.')
  if (/Pay Mana Cost|Pay mana cost/i.test(m)) return `${tx('Paga: toca nos terrenos ou na mana da reserva.')} ${m.split('\n').find(l => /\{/.test(l)) || ''}`
  return m
}

// uma carta solta (mão, escolhas, cemitério): imagem da Scryfall com força/resistência por cima. h = id da carta na mão:
// a mesa trata do clique e do arrastar pelo data-h. picked = já escolhida numa escolha do Forge (descartar 2…)
export function FCard({ c, data, onClick, h, cls = '', big, flip }) {
  if (!c || c.hidden) return <div className={`fp-card back ${cls}`} />
  const card = data.byName.get(c.name) || data.byLower?.get(String(c.name).toLowerCase())
  const src = card ? img(card, big ? 'normal' : 'small', !!(flip && card.df)) : null  // virada: a outra face (cartas de duas faces)
  return (
    <button type="button" className={`fp-card ${c.sel ? 'sel' : ''} ${c.picked ? 'picked' : ''} ${flip && !card?.df ? 'upside' : ''} ${cls}`} title={c.name} data-h={h} data-zid={c.id}
      onClick={onClick && (() => onClick(c))} onContextMenu={e => e.preventDefault()}>
      <span className="fp-cin">{/* na mão só o interior sobe com o rato: o botão (a zona do clique) fica parado */}
        {src ? <img src={src} alt={c.name} loading="lazy" draggable="false" /> : <span className="fp-name">{c.name}</span>}
        {c.pt && <i className="fp-pt">{c.pt[0]}/{c.pt[1]}</i>}
      </span>
    </button>
  )
}

// estado do Forge -> o formato do tabuleiro das repetições (Board.jsx), para a mesa ser igual à da arena: criaturas à
// frente, terrenos (agrupados) e artefactos/encantamentos atrás, a vida no orbe, cemitério e exílio nas pilhas
// marcadores do Forge pelo nome («+1/+1», «Loyalty», «Lore», «Poison»…) -> as chaves do tabuleiro (minúsculas)
const CTR = { P1P1: '+1/+1', M1M1: '-1/-1' }
const ctrs = o => Object.fromEntries(Object.entries(o || {}).map(([k, n]) => [CTR[k] || (/^[+-]/.test(k) ? k : String(k).toLowerCase()), n]))
function toPerm(c, combat) {
  const counters = ctrs(c.counters)
  if (c.loyalty != null && counters.loyalty == null) counters.loyalty = +c.loyalty || 0  // o marcador «Loyalty» do Forge manda; «loyalty» da carta vem em texto («4»)
  const plus = (counters['+1/+1'] || 0) - (counters['-1/-1'] || 0)  // o Forge já soma os marcadores ao P/R; o tabuleiro volta a somá-los
  const at = combat?.find(x => x.att === c.id)
  return {
    key: String(c.id), name: c.name || '', hidden: !!c.hidden, tapped: !!c.tapped, sick: !!c.sick, token: !!c.token, flipped: !!c.flipped,
    land: !!c.land, crewed: !!c.creature, attachedTo: c.attachedTo != null ? String(c.attachedTo) : undefined, damage: c.dmg || 0, counters,
    pt: c.pt ? `${c.pt[0] - plus}/${c.pt[1] - plus}` : undefined, faceDown: !!c.faceDown, phased: !!c.phased, goaded: !!c.goad, copy: !!c.copy, merged: c.merged,
    attacking: at ? 'x' : undefined, atkName: at?.defc, blocking: (b => (b ? String(b.att) : undefined))(combat?.find(x => x.blockers?.includes(c.id))),  // a chave do atacante: o par (⚔ n / 🛡 n) e a linha
  }
}
function zoneOf(p, combat) {
  const { poison = 0, energy = 0, ...pctr } = ctrs(p.counters), cz = p.command || []
  return {
    life: p.life, library: p.library, libTop: p.top || null, hand: p.hand?.length || 0, known: [], graveyard: (p.graveyard || []).map(c => c.name), exile: (p.exile || []).map(c => c.name),
    command: cz.filter(c => !c.emblem).map(c => ({ name: c.name, room: c.room, casts: 0 })), cmdDmg: {}, poison, energy, pctr, emblems: cz.filter(c => c.emblem).map(c => c.name),
    monarch: !!p.monarch, initiative: !!p.initiative, blessing: !!p.blessing, speed: p.speed || 0, out: false, perms: (p.battlefield || []).map(c => toPerm(c, combat)),
  }
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
  const card = o => data.byName.get(o.label) || data.byLower?.get(String(o.label).toLowerCase())
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

// carta em grande para o toque (tocar e manter numa carta, Forge Play e mesa livre): ecrã escurecido com a carta ao centro;
// dois dedos ampliam (até 3×), duplo toque amplia/volta, arrastar para baixo ou um toque fecha; Esc no teclado
export function BigCard({ name, data, onClose }) {
  const card = name && (data.byName.get(name) || data.byLower?.get(String(name).toLowerCase()))
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
      <img ref={ref} src={img(card, 'large')} alt={card.n} draggable="false" />
      <small>{tx('Dois dedos ampliam · arrasta para baixo para fechar')}</small>
    </div>)
}

// habilidade a usar (getAbilityToPlay): «Shattered Landscape - Play land» -> «Jogar como terreno»; o resto sem o nome da carta
const abilityLabel = (l, name) => { const s = String(l || ''), p = `${name} - `, t = s.startsWith(p) ? s.slice(p.length) : s; return /^Play land$/i.test(t) ? tx('Jogar como terreno') : t.replace(/^Cycling\b/, tx('Ciclar')) }
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
function Ask({ a, st, data, answer, zoom, payCancel, undo }) {  // payCancel: o Forge está a meio de um pagamento (cancelá-lo desfaz tudo); undo: desfazer a última ação
  const [pick, setPick] = useState([]), [txt, setTxt] = useState(a.initial || '')
  const escRef = useRef(null)
  useBackClose(a.kind === 'choose' && ((a.min === 0 && (a.max ?? 1) === 1) || !!payCancel || (!!undo && MANA_ASK.test(a.msg || ''))), () => escRef.current?.())  // «voltar» = Cancelar, quando dá
  useEffect(() => { const k = e => { if (e.key === 'Escape' && escRef.current) { e.preventDefault(); escRef.current() } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [])
  const all = (st?.players || []).flatMap(p => [...(p.battlefield || []), ...(p.hand || []), ...(p.graveyard || []), ...(p.exile || [])])
  const cardOf = o => (o.card != null ? all.find(c => c.id === o.card) || { id: o.card, name: o.name || o.label } : null)  // name: feitiço na pilha (o label é o texto dele)
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
  if (a.kind === 'choose' && (a.options || []).every(o => o.card != null)) {  // só cartas: scry, vigiar ou uma lista grande
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
  const toggle = k => (one ? answer(a, [k]) : setPick(p => (p.includes(k) ? p.filter(x => x !== k) : p.length < max ? [...p, k] : p)))
  return (
    <div className="fp-ask"><p>{a.ability ? tx('Como queres usar {c}?', { c: a.msg }) : /^Select target /.test(a.msg || '') ? `${tx('Escolhe o alvo')}: ${a.msg.slice(14)}` : a.msg} {!one && <span className="muted small">{tx('escolhe {a} a {b}', { a: min, b: max })}</span>}</p>
      {head && <div className="fp-opts fp-reveal-c"><FCard c={head} data={data} big /></div>}
      {!head && !a.ability && <ForWhat src={sourceOf(a.msg, a.card, a.cardName, st)} data={data} />}
      <div className="fp-opts">{(a.options || []).map((o, k) => { const c = cardOf(o); return c
        ? <div key={k} className={`fp-opt ${pick.includes(k) ? 'on' : ''}`}><FCard c={c} data={data} big onClick={() => toggle(k)} onZoom={zoom} />{o.stack && <small className="fp-stk-lbl"><Syms text={o.label} /></small>}</div>
        : <button key={k} className={`fp-optl ${pick.includes(k) ? 'on' : ''}`} onClick={() => toggle(k)}><Syms text={a.ability ? abilityLabel(o.label, a.msg) : o.label} /></button> })}</div>
      <div className="row-btns">{!one && <button className="primary" disabled={pick.length < min} onClick={() => answer(a, pick)}>{tx('Confirmar ({n})', { n: pick.length })}</button>}
        {min === 0 && !one && <button onClick={() => answer(a, [])}>{tx('Nenhum')}</button>}
        {cancel && <button onClick={cancel}>{tx('Cancelar')} <kbd>Esc</kbd></button>}</div>
    </div>
  )
}

export default function ForgeTable({ sid, data, onClose, onAgain, againLabel, series, onEnd }) {  // againLabel: o texto do botão de voltar a jogar (torneios: o jogo seguinte da partida)
  const [s, setS] = useState(null), [err, setErr] = useState(''), [zoom, setZoom] = useState(null), [zone, setZone] = useState(null), [toast, setToast] = useState(null)
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
    const log = s?.log || [], n = log.length
    if (!n || seen.current === n) return
    seen.current = n
    const m = log[n - 1]
    if (/^AI can't play/.test(m.title || '')) return  // o aviso do Forge sobre cartas que a IA joga mal não interessa a quem joga
    // flash = o Forge recusou o clique (sem alvos válidos, sem mana, fora de tempo): sem isto parecia que nada acontecia
    setToast(m.t === 'flash' ? { title: tx('O Forge recusou essa jogada'), msg: tx('Não há alvos válidos, falta mana ou não é a altura. Uma aura como Hardlight Containment precisa de um artefacto teu em jogo.') } : m)
  }, [s?.log])
  useEffect(() => {  // qualquer aviso some sozinho com fade (mais tempo se trouxer uma lista); um toque fecha logo
    if (!toast) return
    const ms = toast.list ? 8000 : 4000, a = setTimeout(() => setToast(t => (t === toast ? { ...t, out: true } : t)), ms), b = setTimeout(() => setToast(t => (t?.out ? null : t)), ms + 450)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [toast?.title, toast?.msg])  // eslint-disable-line react-hooks/exhaustive-deps
  const send = c => j(`/api/playnet/${sid}/cmd`, c).catch(e => setErr(e.message))
  const answer = (a, v) => { setS(x => ({ ...x, asks: x.asks.filter(y => y.id !== a.id) })); send({ c: 'answer', id: a.id, v }) }
  const st = s?.state, players = st?.players || []
  const me = players.find(p => p.me) || players.find(p => !p.ai), opp = players.find(p => p !== me)
  const pr = s?.prompt, btns = (pr?.buttons || []).filter(b => b.label)
  const blocking = /Declare blockers|Select creatures to block/i.test(pr?.msg || '')  // o Forge pede os bloqueadores (cliques = bloquear)
  const ask = s?.asks?.[0]
  const hoverId = useRef(null), [flipped, setFlipped] = useState(() => new Set()), [lift, setLift] = useState(null)  // carta debaixo do rato; viradas; levantada na mão
  // «voltar» do telemóvel: fecha primeiro o que está aberto por cima; com o jogo a decorrer nunca sai da mesa (avisa e fica)
  const [guard, setGuard] = useState(true)
  useBackClose(guard && !s?.ended, () => { setGuard(false); setTimeout(() => setGuard(true), 0); setToast({ title: tx('O jogo continua'), msg: tx('Para sair, usa «Parar o jogo» ou desiste no painel.') }) })
  useBackClose(!!s?.ended, () => onClose?.())
  const [act, setAct] = useState(null)  // {id, x, y, lines}: confirmar ativar uma habilidade de uma permanente tua (um clique já não ativa às escondidas)
  useBackClose(!!zone, () => setZone(null)); useBackClose(!!act, () => setAct(null))  // cemitério/exílio e o «Ativar …?»
  useEffect(() => { if (!/^Priority:/.test(pr?.msg || '')) setLift(null) }, [pr?.msg])  // o Forge pede uma escolha: a carta levantada desce (as escolhidas sobem com moldura)
  useEffect(() => {  // Enter/Espaço = o botão principal (passar ao passo seguinte), Shift+Enter = acabar o turno, Esc = o outro botão
    const k = e => {
      if (ask || big || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return  // carta em grande aberta: o Esc é dela
      if (act) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() } else if (e.key === 'Escape') { e.preventDefault(); setAct(null) } return }
      const P = fpPrefs()
      if (e.key.toLowerCase() === P.tap && hoverId.current != null && !e.ctrlKey && !e.metaKey && document.querySelector(`.bside.bottom .pc[data-z="k:${hoverId.current}"]`)) { e.preventDefault(); permClick(hoverId.current, document.querySelector(`.bside.bottom .pc[data-z="k:${hoverId.current}"]`)); return }  // rato por cima de uma carta tua na mesa + T = virá-la (tap) / ativá-la, como o clique
      if (e.key.toLowerCase() === P.flip && hoverId.current != null && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const k = hoverId.current; setFlipped(f => { const n = new Set(f); n.has(k) ? n.delete(k) : n.add(k); return n }); return }
      const end = btns.find(b => b.label === 'End Turn')
      const b = e.key === 'Enter' && e.shiftKey ? end : (e.key === ' ' && P.space) || e.key === 'Enter' ? btns[0] : e.key === 'Escape' ? btns[1] : null
      if (b?.on) { e.preventDefault(); send({ c: b.c }) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const ended = !!s?.ended, iWon = !!s?.winner && s.winner === me?.name
  useEffect(() => { if (ended) onEnd?.(s.winner ? iWon : null) }, [ended]) // eslint-disable-line react-hooks/exhaustive-deps
  // sons: o Forge Play não manda eventos — soa a diferença entre o estado anterior e este (sfx.playDiff); o 1.º não soa
  const snapRef = useRef(null)
  useEffect(() => {
    if (!st) return
    const top = st.stack?.[0], tc = top?.name && (data.byName.get(top.name) || data.byLower?.get(top.name.toLowerCase()))
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
  const kindOf = c => (c?.land ? 'lands' : c?.creature || c?.pt ? 'front' : 'others')
  // onde a carta vai ficar no teu lado: largada à altura das cartas de uma fila (a fila debaixo do dedo ou a dela —
  // criaturas, terrenos, outras) entra nessa fila, no sítio pela posição; largada longe das filas fica solta onde a
  // pousaste (Livre) ou na casa mais perto (Grelha). Com «Filas automáticas» vai sempre para uma fila.
  // null = fora do teu lado ou por cima da tua barra; {row, before} = numa fila, antes dessa carta; {free} = solta
  const whereOn = (id, target, x, y) => {
    const side = target?.closest('.fp-table .bside.bottom')
    if (!side || target.closest('.bhud')) return null
    const kind = kindOf(byId.get(id)), P = fpPrefs(), sc = +side.closest('.fp-stage')?.dataset.sc || 1
    const rowOf = k => side.querySelector(`.brow.${k}`) || (k === 'others' ? side.querySelector('.brow.rear') : null)
    const under = target.closest('.brow:not(.rear)') || (target.closest('.brow.rear') && rowOf(kind === 'front' ? 'lands' : kind))
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
    if (P.place === 'rows') return { row: kind, before: null, box: rowOf(kind) }
    return { free: spotOn(side, x, y, kind, P.place === 'grid', id) }
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
    const c = byId.get(id), d = c && (data.byName.get(c.name) || data.byLower?.get(String(c.name).toLowerCase())), t = d?.t || '', o = d?.o || ''
    const title = tx('Agora não dá para jogar {c}', { c: c?.name || tx('esta carta') }), say = msg => ({ title, msg })
    if (s.asks?.length) return say(tx('Primeiro responde à escolha que está aberta.'))
    const myTurn = st.active === me?.id, main = st.phase === 'MAIN1' || st.phase === 'MAIN2', empty = !st.stack?.length
    if (!/^Priority:/.test(pr?.msg || '')) return say(/^Waiting/.test(pr?.msg || '') ? tx('O adversário está a jogar: espera pela tua prioridade.') : tx('O Forge está à espera de outra coisa: vê o pedido ao lado.'))
    if (c?.land || /\bLand\b/.test(t)) {
      if (!myTurn) return say(tx('Os terrenos só se jogam no teu turno.'))
      if (!main || !empty) return say(tx('Os terrenos só se jogam na tua fase principal, com a pilha vazia.'))
      return say(tx('Já jogaste um terreno neste turno.'))
    }
    const fast = /\bInstant\b/.test(t) || /^Flash\b/im.test(o)
    if (!fast && (!myTurn || !main || !empty)) return say(tx('Não é instantâneo: só na tua fase principal, com a pilha vazia.'))
    const lands = (me?.battlefield || []).filter(x => x.land && !x.tapped).length, pool = Object.values(me?.mana || {}).reduce((a, n) => a + n, 0)
    if (d?.cmc != null && lands + pool < d.cmc) return say(tx('Falta mana: custa {n} e tens {m} por usar (terrenos por virar e reserva).', { n: d.cmc, m: lands + pool }))
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
      // largada no teu lado (um terreno, mesmo por cima de outra carta): quando entrar em jogo fica nesse sítio/fila
      putAt(id, (pid == null || land) && whereOn(id, target, x, y))
      castNow(id); send1({ c: 'card', id }); return true
    }
    // equipamento teu largado numa criatura tua, no teu turno: equipar essa criatura
    if (pid != null && pid !== id && mine && /Equipment/.test(typeOf(id)) && /Creature/.test(typeOf(pid)) && target.closest('.bside.bottom')) {
      aim(pid, perm, /^Equip/i); castNow(id); send1({ c: 'card', id }); return true
    }
    // bloquear arrastando: só quando o Forge pede os bloqueadores (antes disso, com prioridade, o clique ativava habilidades)
    if (!mine && blocking && pid && st.combat?.some(x => x.att === pid)) { send1({ c: 'card', id: pid }).then(() => send1({ c: 'card', id })); return true }  // largar num atacante: bloquear
    const atts = st.combat || []  // largar no lado dele com um só atacante: bloqueá-lo (não é preciso acertar na carta)
    if (!mine && !blocking && atts.length && /^COMBAT/.test(st.phase) && target.closest('.bside.top')) { setToast({ title: tx('Ainda não é a altura de bloquear'), msg: tx('Carrega OK até aparecer o pedido de bloqueadores; aí arrasta a tua criatura para o atacante (ou clica no atacante e depois nela).') }); return false }
    if (!mine && blocking && atts.length === 1 && target.closest('.bside.top')) { send1({ c: 'card', id: atts[0].att }).then(() => send1({ c: 'card', id })); return true }
    if (mine && st.phase === 'COMBAT_DECLARE_ATTACKERS' && target.closest('.bside.top')) { send1({ c: 'card', id }); return true }  // largar no lado dele: atacar
    // ainda na fase principal: o gesto diz «ataca com esta» — passa-se ao combate e declara-se sozinho
    if (mine && st.phase === 'MAIN1' && target.closest('.bside.top') && /Creature/.test(typeOf(id)) && /^Priority:/.test(pr?.msg || '') && !st.stack?.length) {
      if (byId.get(id)?.sick) { setToast({ title: tx('Esta criatura ainda não pode atacar'), msg: tx('Entrou neste turno (enjoo de invocação).') }); return false }
      const oracle = (data.byName.get(byId.get(id)?.name) || {}).o || ''
      if (/^Defender\b/im.test(oracle) || byId.get(id)?.tapped) { setToast({ title: tx('Esta criatura não pode atacar'), msg: byId.get(id)?.tapped ? tx('Está virada.') : tx('Tem a habilidade Defensor.') }); return false }
      attackIntent.current = { ids: [...(attackIntent.current?.ids || []), id], until: Date.now() + 15000 }
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
  const lastCast = useRef(null), autoKey = useRef(''), attackIntent = useRef(null), sNow = useRef(null)
  sNow.current = s
  const castNow = id => { lastCast.current = { id, t: Date.now() } }
  const autoAct = x => {  // o que a mesa faz sozinha neste estado: {k (uma vez só), c, ms} ou nada
    const p = x?.prompt, b0 = (p?.buttons || []).filter(b => b.label)[0], P = fpPrefs(), lc = lastCast.current, msg = p?.msg || ''
    if (!p || x.asks?.length || x.ended) return null
    if (P.autopay && /Pay Mana Cost/i.test(msg) && b0?.label === 'Auto' && b0.on && lc && p.card === lc.id && Date.now() - lc.t < 20000 && obviousPay(msg, (x.state?.players || []).find(q => q.me), n => data.byName.get(n) || data.byLower?.get(String(n).toLowerCase()))) return { k: `pay${lc.t}`, c: { c: 'ok' }, ms: 120 }
    const top = x.state?.stack?.[0], meId = (x.state?.players || []).find(q => q.me)?.id
    if (P.autoresolve && /^Priority:/.test(msg) && top && top.by === meId && b0?.c === 'ok' && b0.on) return { k: `res${x.state.stack.length}|${top.card}|${top.text}`, c: { c: 'ok' }, ms: 650 }
    return null
  }
  useEffect(() => {
    if (!s) return
    const ai = attackIntent.current
    if (ai && Date.now() < ai.until && /Declare attackers|Select creatures to attack/i.test(pr?.msg || '') && !s.asks?.length) {
      attackIntent.current = null
      const on = new Set((st.combat || []).map(x => x.att))
      ai.ids.filter(x => !on.has(x)).reduce((q, x) => q.then(() => send({ c: 'card', id: x })), Promise.resolve())
      return
    }
    const a = autoAct(s)
    if (!a || autoKey.current === a.k) return
    autoKey.current = a.k
    // à hora de mandar volta-se a ver: se entretanto o adversário respondeu (outra coisa no topo), não se passa por ti
    setTimeout(() => { if (autoAct(sNow.current)?.k === a.k) send(a.c); else autoKey.current = '' }, a.ms)
  }, [s?.seq])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // ordenar gatilhos iguais (três City of Brass ao mesmo tempo): a ordem não muda nada, responde-se sozinho
    const a = s?.asks?.[0]
    if (a?.kind === 'order' && (a.options || []).length > 1 && a.options.every(o => o.label === a.options[0].label)) answer(a, [])
  }, [s?.asks?.[0]?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  // intenção do gesto (alvo largado em cima): quando o Forge pergunta a habilidade ou o alvo, responde-se sozinho
  const intent = useRef(null)
  const typeOf = id => { const c = byId.get(id); return (c && (data.byName.get(c.name) || data.byLower?.get(String(c.name).toLowerCase()))?.t) || '' }
  const aim = (pid, el, ability = null) => {
    intent.current = { target: pid, ability, until: Date.now() + 20000 }
    el?.classList.add('fp-hit'); setTimeout(() => el?.classList.remove('fp-hit'), 700)
  }
  useEffect(() => {
    const it = intent.current
    if (!it || !s) return
    if (Date.now() > it.until || s.ended) { intent.current = null; return }
    const a = s.asks?.[0]
    if (a) {
      const opts = a.options || []
      if (it.ability) { const k = opts.findIndex(o => it.ability.test(o.label || '')); if (k >= 0) { it.ability = null; answer(a, [k]); return } }
      const k = a.kind === 'choose' ? opts.findIndex(o => o.card === it.target) : -1
      if (k >= 0) { intent.current = null; answer(a, [k]) }
      return
    }
    if (byId.get(it.target)?.sel) { intent.current = null; send({ c: 'card', id: it.target }) }  // o Forge pede o alvo: é este
  }, [s?.seq, s?.asks?.length])  // eslint-disable-line react-hooks/exhaustive-deps
  // animações como no tabuleiro dos bots: a pilha (StackFx) com «A resolver», números de dano/marcadores nas cartas e as
  // cartas que saem do campo a desaparecer (dying) — tudo a partir da diferença entre um estado do Forge e o seguinte
  const anim = useRef({ perms: new Map(), stack: [] }), [fxs, setFxs] = useState({ pops: new Map(), gone: [], rev: null, ri: 0 })
  const seqKey = s?.seq
  useEffect(() => {
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
        if (d) pops.set(String(id), { i: seqKey, kind: d < 0 && (k === 'loyalty' || k === 'defense') ? 'dmg' : 'ctr', n: d, ct: k })
      }
      if (!!c.flipped !== !!o.flipped || !!c.faceDown !== !!o.faceDown) pops.set(String(id), { i: seqKey, kind: 'flip' })  // transformar, virar para cima (morph)
    }
    for (const [id, x] of a.perms) if (!now.has(id) && !x.c.hidden) gone.push({ ...x, until: Date.now() + 700 })
    // a pilha do Forge vem do topo para baixo; o que saiu dela resolveu (ou foi contrariado): fantasma «A resolver»
    const items = [...(st.stack || [])].reverse(), keyOf = x => `${x.card ?? ''}|${x.text}`
    const left = a.stack.find(x => !items.some(y => keyOf(y) === keyOf(x)))
    a.perms = now; a.stack = items
    setFxs(f => ({ pops, gone: [...f.gone.filter(g => g.until > Date.now()), ...gone], rev: left ? { k: 'resolve', card: left.name, p: left.by === me?.id ? 'a' : 'b', txt: left.text } : f.rev, ri: left ? f.ri + 1 : f.ri }))
  }, [seqKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!fxs.gone.length && !fxs.pops.size) return; const t = setTimeout(() => setFxs(f => ({ ...f, pops: new Map(), gone: f.gone.filter(g => g.until > Date.now()) })), 1200); return () => clearTimeout(t) }, [fxs.gone.length, fxs.pops])
  useEffect(() => {  // cartas que foram para o cemitério ou o exílio esquecem o sítio onde estavam (se voltarem, vão para as filas)
    const out = Object.keys(lay.free || {}).filter(k => players.some(p => [...(p.graveyard || []), ...(p.exile || [])].some(c => String(c.id) === k)))
    if (out.length) setLay(l => { const f = { ...l.free }; for (const k of out) delete f[k]; return { ...l, free: f } })
  }, [seqKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const [, redraw] = useState(0), [matOpen, setMatOpen] = useState(false)
  const persp = () => { setFpPrefs({ persp: !fpPrefs().persp }); redraw(x => x + 1) }
  const fitBox = useRef(null), fitTable = useRef(null), stageWrap = useRef(null), peek = usePeek(), diceBox = useRef(null), dice = useTableDice(diceBox)
  const P = fpPrefs()
  const stage = useStage(fitBox, stageWrap, !!st)
  useOverlap(fitTable)
  // cartas que voltam do cemitério ou do exílio (reanimar, flashback de permanentes, exilar e devolver) e as que o adversário
  // joga da mão: voam do monte/mão de onde vieram (a tua mão e o campo já voam sozinhos pelo id)
  useZoneFlights(fitTable, seqKey, () => {
    const m = new Map()
    for (const p of st?.players || []) {
      const side = `.bside.${p.id === me?.id ? 'bottom' : 'top'}`
      for (const z of ['hand', 'graveyard', 'exile', 'battlefield']) for (const c of p[z] || []) m.set(c.id, { z, fly: z === 'battlefield' || (z === 'hand' && p.id === me?.id), src: z === 'hand' ? (p.id === me?.id ? null : `${side} .myhand`) : z === 'battlefield' ? null : `${side} [data-zone="${z}"]` })
    }
    return m
  })
  useFlip(fitTable, seqKey, lay)
  if (!st) return <div className="fp-wait">{err ? <p className="bad-t">{err}</p> : <p className="muted">{tx('O Forge está a abrir o jogo (uns 20 segundos)…')}</p>}</div>
  const myTurn = st.active === me?.id
  const bs = { sides: ['a', 'b'], a: zoneOf(me || {}, st.combat), b: zoneOf(opp || {}, st.combat), active: myTurn ? 'a' : 'b', i: s.seq, exact: true }
  for (const g of fxs.gone) if (!bs[g.side].perms.some(p => p.key === String(g.c.id))) bs[g.side].perms.push({ ...toPerm(g.c), dying: true })
  const hashN = t => [...String(t)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0
  bs.stack = [...(st.stack || [])].reverse().map(x => ({ uid: hashN(`${x.card}|${x.text}`), p: x.by === me?.id ? 'a' : 'b', card: x.name,
    kind: !x.ability ? 'cast' : /^(When|Whenever|At)\b/.test(x.text || '') ? 'trigger' : 'activate' }))
  const att = new Map()
  for (const p of [...bs.a.perms, ...bs.b.perms]) if (p.attachedTo) att.set(p.attachedTo, [...(att.get(p.attachedTo) || []), p])
  const sel = new Set([...byId.values()].filter(c => c.sel).map(c => String(c.id)))
  const picked = [...byId.values()].filter(c => c.picked).map(c => c.id)
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
    const h = e.target.closest('[data-h]')
    if (h) {  // na mão, um clique só levanta a carta (jogar = arrastá-la para a mesa ou duplo clique); se o Forge pede uma carta da mão, escolhe-a
      const id = +h.dataset.h
      if (byId.get(id)?.sel || !/^Priority:/.test(pr?.msg || '')) return send({ c: 'card', id })  // o Forge pede uma escolha: o clique escolhe
      setLift(l => (l === id ? null : id)); setZoom(byId.get(id)); return
    }
    const z = e.target.closest('[data-z]')?.dataset.z
    if (z?.startsWith('k:')) return permClick(+z.slice(2), e.target.closest('[data-z]'))
    const orb = e.target.closest('.orb')
    if (orb) send({ c: 'player', i: players.indexOf(orb.closest('.bside')?.classList.contains('top') ? opp : me) })
  }
  // um clique numa permanente: se o Forge pede uma escolha (alvo, sacrificar…) ou é tua e só dá mana (terreno, Sol Ring),
  // vai direto; se é tua e tem uma habilidade ativada que não é só mana, pergunta primeiro (antes ativava e pagava sozinho)
  const permClick = (id, el) => {
    const c = byId.get(id), d = c && (data.byName.get(c.name) || data.byLower?.get(String(c.name).toLowerCase()))
    const prio = /^Priority:/.test(pr?.msg || ''), mine = !!el?.closest('.bside.bottom')
    const lines = String(d?.o || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(l => /^[^"]{1,90}?:\s/.test(l) || /^Equip\b/i.test(l))
    const oppCombat = st.active !== me?.id && /^COMBAT/.test(st.phase || ''), cre = !!(c?.creature || c?.pt)
    if (prio && mine && oppCombat && cre && !lines.length) return setToast({ title: tx('Ainda não é a altura de bloquear'), msg: tx('Carrega OK até aparecer o pedido de bloqueadores; aí arrasta a tua criatura para o atacante (ou clica no atacante e depois nela).') })
    if (!prio || c?.sel || !mine || c?.land || !lines.length || (lines.every(l => /:\s*Add\b/.test(l)) && !(oppCombat && cre))) return send({ c: 'card', id })
    const r = el.getBoundingClientRect(), hint = oppCombat && cre ? tx('Ainda não é a altura de bloquear: para bloquear, carrega OK até o Forge pedir os bloqueadores.') : ''
    setAct({ hint, id, x: Math.min(innerWidth - 280, Math.max(8, r.left + r.width / 2 - 130)), y: r.top > 240 ? r.top - 8 : r.bottom + 8, up: r.top > 240, lines, name: c.name })
  }
  const activate = () => { if (!act) return; castNow(act.id); send({ c: 'card', id: act.id }); setAct(null) }  // pedido explícito: o «pagar sozinho» pode pagar
  const onDouble = e => {  // duplo clique numa carta da mão = jogá-la (atalho)
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
  const zc = zoom && (data.byName.get(zoom.name) || data.byLower?.get(String(zoom.name).toLowerCase()))
  const nOpp = opp?.hand?.length || 0, mana = Object.entries(me?.mana || {})
  const handIn = cs => (lay.hand ? [...cs].sort((x, y) => { const i = lay.hand.indexOf(String(x.id)), k = lay.hand.indexOf(String(y.id)); return (i < 0 ? 1e9 : i) - (k < 0 ? 1e9 : k) }) : cs)
  const tilt = e => {  // inclinação 3D da carta debaixo do rato (e o brilho a segui-lo)
    const el = e.target.closest('.pc, .fp-card')
    if (!el) return
    const q = el.getBoundingClientRect()
    el.style.setProperty('--tx', ((e.clientX - q.left) / q.width - 0.5).toFixed(3)); el.style.setProperty('--ty', ((e.clientY - q.top) / q.height - 0.5).toFixed(3))
  }
  return (
    <div className={`fp ${dice.res ? 'dice-on' : ''}`} ref={fitBox} onMouseLeave={() => { setZoom(null); peek.hide() }} onMouseOver={onOver} onPointerDown={peek.hide}
      onPointerDownCapture={e => { if (e.target.closest('.fp-stagebox') && dice.grab(e)) e.stopPropagation() }}>
      <div className="fp-stagebox" ref={stageWrap} style={{ height: stage.h }}>
      <div className={`fp-stage ${stage.shape} ${P.persp ? 'persp' : ''} ${P.oppFace === 'far' ? 'opp-far' : ''}`} data-sc={stage.sc} style={{ width: STAGE[stage.shape][0], height: STAGE[stage.shape][1], transform: `translateX(${stage.left}px) scale(${stage.sc})`, '--tilt': `${P.tilt}deg`, '--tf': P.tilt / 45 }}>
      <div className={`fp-table board table ${aiming ? 'fp-aiming' : ''} ${blocking ? 'fp-blocking' : ''} ${P.cardPx ? 'px' : ''} ${st.combat?.length || /COMBAT_DECLARE_BLOCKERS/.test(st.phase || '') ? 'combat-on' : ''}`} style={cardVars(P.cardPx) || undefined} ref={fitTable} onClick={onClick} onDoubleClick={onDouble} onMouseMove={tilt} onPointerDown={down}>
        {flipped.size > 0 && <style>{[...flipped].map(k => `.fp-table .pc[data-z="k:${k}"] .pc-f`).join(',')}{'{ transform: rotate(180deg); }'}</style>}
        {picked.length > 0 && <style>{picked.map(k => `.fp-table .pc[data-z="k:${k}"] .pc-f`).join(',')}{'{ box-shadow: 0 0 0 3px var(--gold), 0 0 18px var(--gold) !important; animation: none !important; translate: 0 -8px; }'}</style>}
        {opp && <Side k="b" top name={opp.name} s={bs} data={data} fx={fx} att={att} start={20} openZone={openZone} mat={P.mats ? null : P.mat}
          hand={nOpp > 0 && <Hand z={{ hand: nOpp, known: Array(nOpp).fill('?') }} data={data} exact opp hidden quiet />} />}
        <div className="fp-mid">
          <span className="fp-turn">{tx('Turno {n}', { n: st.turn })} · {myTurn ? tx('teu') : opp?.name}</span>
          {st.day && <DayNight v={st.day} />}
          <span className="fp-phases">{PHASES.map(([k, l, ps]) => <i key={k} className={ps.includes(st.phase) ? 'on' : ''}>{l}</i>)}</span>
          <StackFx s={bs} rev={fxs.rev} ri={fxs.ri} data={data} arts={null} who={{ a: me?.name, b: opp?.name }} speed={1} />
        </div>
        {me && <Side k="a" name={me.name} s={bs} data={data} fx={fx} att={att} start={20} openZone={openZone} mat={P.mat} place={lay.place} order={lay.order} free={P.place === 'rows' ? null : lay.free}
          hand={<div className="fp-hand">{handIn(me.hand || []).map(c => <FCard key={c.id} c={c} h={c.id} data={data} big flip={flipped.has(c.id)} cls={`${c.play ? 'play' : ''} ${lift === c.id ? 'lift' : ''}`} />)}</div>} />}
        {bs && <CombatLinks s={bs} />}
      </div>
      </div><div className="fp-dice" ref={diceBox} /></div>
      <aside className="fp-side">
        <div className="fp-zoom">{zc ? <img key={zc.n} className="fp-zin" src={img(zc, 'normal')} alt={zc.n} /> : <p className="muted small">{tx('Passa o rato por uma carta (no tablet: toca e mantém) para a veres em grande.')}</p>}</div>
        <div className={`fp-prompt ${pr && btns.some(b => b.on) ? 'mine' : ''}`}>
          {pr?.msg && !/^(Priority:|Waiting for)|keep your hand|coin toss|Declare (attackers|blockers)|Select creatures to (attack|block)/i.test(pr.msg) && <ForWhat src={sourceOf(pr.msg, pr.card, pr.cardName, st)} data={data} />}
          <p><Syms text={promptText(pr?.msg, st, me)} /></p>
          <div className="row-btns">{btns.map((b, k) => <button key={k} className={k ? '' : 'primary'} disabled={!b.on} onClick={() => send({ c: b.c })} title={k === 0 ? 'Enter' : b.label === 'End Turn' ? 'Shift+Enter' : 'Esc'}>{BTN[b.label] || b.label} <kbd>{k === 0 ? '⏎' : b.label === 'End Turn' ? '⇧⏎' : 'Esc'}</kbd></button>)}</div>
          {mana.length > 0 && <span className="fp-pool" title={tx('Reserva de mana: clica para a usar')}>{mana.map(([k, n]) => (
            <button type="button" key={k} style={{ '--m': MANA[k] }} onClick={() => send({ c: 'mana', color: k })} title={tx('Usar esta mana')}>{n}</button>))}</span>}
          <p className="small muted fp-tip">{tx('Arrasta uma carta da mão para a mesa para a jogar. No combate, arrasta uma criatura tua para o lado do adversário (atacar) ou para cima de um atacante (bloquear). Arruma o teu lado e a mão como quiseres: larga uma carta por cima de outra ou numa fila.')}</p>
          <div className="fp-dicebar"><span className="muted small">🎲</span>
            {[['d6', ['d6']], ['2d6', ['d6', 'd6']], ['d20', ['d20']], [tx('moeda'), ['moeda']]].map(([l, t]) => <button key={l} type="button" className="link small" onClick={() => dice.roll(t)} title={tx('Lançar na mesa')}>{l}</button>)}
            {dice.res?.items && <button type="button" className="fp-dres" onClick={dice.off} title={tx('Tirar os dados da mesa')}>{dice.res.items.map(x => (x.type === 'moeda' ? (x.v === 1 ? tx('Cara') : tx('Coroa')) : x.v)).join(' + ')}{dice.res.items.length > 1 && dice.res.items.every(x => x.type !== 'moeda') ? ` = ${dice.res.items.reduce((a, x) => a + x.v, 0)}` : ''} ✕</button>}</div>
          <Hist log={st.log} nameOf={id => byId.get(id)?.name} />
          <div className="row-btns small">
            <button className="link small" onClick={() => send({ c: 'undo' })}>↶ {tx('desfazer')}</button>
            {(lay.free && Object.keys(lay.free).length > 0) || lay.order ? <button className="link small" onClick={() => setLay(l => ({ hand: l.hand }))} title={tx('As cartas do teu lado voltam às filas automáticas')}>▦ {tx('arrumar')}</button> : null}
            <button className="link small" onClick={persp} title={tx('Lado do adversário em perspetiva (mais espaço para o teu)')}>{P.persp ? '▭' : '⏢'} {tx('perspetiva')}</button>
            <CardPx className="small" onChange={() => redraw(x => x + 1)} />
            <button className={`link small ${matOpen ? 'on' : ''}`} onClick={() => setMatOpen(x => !x)} aria-expanded={matOpen} title={tx('Padrão da mesa')}>🎨 {tx('tapete')}</button>
            <button className="link small" onClick={() => send({ c: 'concede' })}>🏳 {tx('desistir')}</button>
          </div>
          {matOpen && <MatPick onMat={() => redraw(x => x + 1)} />}
          {err && <p className="small bad-t">{err}</p>}
        </div>
      </aside>
      {ask && <div className="fp-modal"><Ask key={ask.id} a={ask} st={st} data={data} answer={answer} zoom={setZoom} payCancel={/Pay Mana Cost/i.test(pr?.msg || '') && btns.some(b => b.label === 'Cancel') ? () => send({ c: 'cancel' }) : null} undo={st.stack?.length ? null : () => send({ c: 'undo' })} /></div>}
      {big && <BigCard name={big} data={data} onClose={() => setBig(null)} />}
      {act && <div className="fp-act-bg" onPointerDown={() => setAct(null)} />}
      {act && <div className={`fp-act ${act.up ? '' : 'below'}`} role="dialog" aria-label={tx('Ativar {c}', { c: act.name })} style={{ left: act.x, top: act.y }}>
        <b>{tx('Ativar {c}?', { c: act.name })}</b>
        {act.lines.map((l, k) => <p key={k}><Syms text={l} /></p>)}
        {act.lines.length > 1 && <small className="muted">{tx('Com mais de uma, escolhes a seguir.')}</small>}
        {act.hint && <small className="fp-act-hint">{act.hint}</small>}
        <div className="row-btns"><button className="primary" autoFocus onClick={activate}>{tx('Ativar')} <kbd>⏎</kbd></button><button onClick={() => setAct(null)}>{tx('Cancelar')} <kbd>Esc</kbd></button></div>
      </div>}
      {reveal && <div className="fp-modal"><div className="fp-ask fp-reveal" key={`${reveal.card}`}>
        <p>{btns.some(b => b.label === 'Graveyard') ? tx('Vigiar: {c} fica no topo da biblioteca ou vai para o cemitério?', { c: reveal.cardName })
          : btns.some(b => b.label === 'Bottom') ? tx('Vidência: {c} fica no topo ou vai para o fundo da biblioteca?', { c: reveal.cardName }) : <Syms text={reveal.msg} />}</p>
        <div className="fp-opts fp-reveal-c"><FCard c={{ id: reveal.card, name: reveal.cardName }} data={data} big /></div>
        <div className="row-btns">{btns.map((b, k) => <button key={k} className={k ? '' : 'primary'} disabled={!b.on} onClick={() => send({ c: b.c })}>{BTN[b.label] || b.label} <kbd>{k ? 'Esc' : '⏎'}</kbd></button>)}</div>
      </div></div>}
      {zone && <div className="fp-modal zone" onClick={() => setZone(null)}><div className="fp-ask" onClick={e => e.stopPropagation()} onPointerDown={e => { swipe.current = e.clientY }} onPointerUp={e => { if (e.pointerType !== 'mouse' && e.clientY - swipe.current > 90) setZone(null) }}>
        <p><b>{zone.k === 'graveyard' ? tx('Cemitério de {n}', { n: zone.p.name }) : tx('Exílio de {n}', { n: zone.p.name })}</b> <button className="link small" onClick={() => setZone(null)}>{tx('fechar')}</button></p>
        <div className="fp-opts">{(players.find(p => p.id === zone.p.id)?.[zone.k] || []).map(c => <FCard key={c.id} c={c} data={data} big onClick={x => { send({ c: 'card', id: x.id }); setZone(null) }} />)}</div></div></div>}
      {toast && <div className={`fp-toast ${toast.out ? 'out' : ''}`} onClick={() => setToast(null)}>{toast.title && <b>{toast.title}</b>} <Syms text={toast.msg} />{toast.list && <ul>{toast.list.map((l, k) => <li key={k}><Syms text={l} /></li>)}</ul>}</div>}
      {s.ended && <div className="fp-modal"><div className="fp-ask fp-end">
        <h3>{s.winner ? (s.winner === me?.name ? tx('🏆 Ganhaste!') : tx('Ganhou {n}', { n: s.winner })) : s.crash ? tx('O Forge falhou a meio deste jogo') : s.lost ? tx('Este jogo perdeu-se: o servidor foi reiniciado') : tx('Jogo terminado')}</h3>
        {(s.crash || s.lost) && <p className="muted">{tx('Nada conta: não perdeste nem ganhaste. Num torneio, a partida volta a esperar por ti — abre-a outra vez para recomeçar.')}</p>}
        {series && <p className="fp-series">{series.done ? (series.w[0] > series.w[1] ? tx('🏆 Ganhaste a série {a}–{b}', { a: series.w[0], b: series.w[1] }) : tx('Perdeste a série {a}–{b}', { a: series.w[0], b: series.w[1] })) : tx('Série Bo{n}: {a}–{b}', { n: series.bo, a: series.w[0], b: series.w[1] })}</p>}
        <div className="row-btns">{onAgain && <button className="primary" onClick={onAgain}>▶ {againLabel || (series && !series.done ? tx('Jogo seguinte (sideboard)') : series ? tx('Nova série') : tx('Jogar outra vez'))}</button>}<button onClick={onClose}>{tx('Fechar')}</button></div></div></div>}
    </div>
  )
}
