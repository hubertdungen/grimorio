// Forge Play nativo: jogas contra a IA do Forge com a mesa do Grimório. O motor corre no servidor (playnet.py +
// build/forge/GrimorioNet.java) e manda o estado do jogo, o pedido atual (o que o motor espera de ti) e as escolhas
// pendentes; aqui desenha-se a mesa e cada clique volta como comando (carta, jogador, OK/cancelar, mana, responder).
import { useEffect, useRef, useState } from 'react'
import { img } from './data.js'
import { Side, Hand } from './Board.jsx'
import { tx } from './i18n.js'

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
const BTN = { OK: tx('OK'), Cancel: tx('Cancelar'), 'End Turn': tx('Acabar o turno'), Keep: tx('Ficar com a mão'), Mulligan: 'Mulligan', Play: tx('Jogar primeiro'), Draw: tx('Comprar (ir em segundo)'), Auto: tx('Pagar sozinho'), Yes: tx('Sim'), No: tx('Não'), 'Alpha Strike': tx('Atacar com tudo') }
const MANA = { W: '#f3ecd0', U: '#4a90d9', B: '#6d5b70', R: '#e0553b', G: '#3fa560', C: '#b7b2a8' }

// o texto do Forge (inglês) passa a uma frase curta do Grimório; o que não se reconhece fica como vem
function promptText(msg, st, me) {
  const m = String(msg || '')
  if (!m) return ''
  if (/^Priority:/.test(m)) {
    if (st?.stack?.length) return tx('Há {n} na pilha: responde com um instantâneo ou OK para deixar resolver.', { n: st.stack.length })
    const mine = st?.active === me?.id, main = st?.phase === 'MAIN1' || st?.phase === 'MAIN2'
    return mine && main ? tx('O teu turno: joga um terreno ou uma carta (clica nela), ou OK para avançar.') : tx('Tens prioridade: OK para passar.')
  }
  if (/^Waiting for/.test(m)) return tx('O adversário está a pensar…')
  if (/won the coin toss/.test(m)) return tx('Ganhaste a moeda ao ar: jogas primeiro ou vais em segundo?')
  if (/keep your hand/.test(m)) return /going first/.test(m) ? tx('Começas tu. Ficas com esta mão?') : tx('Começa o adversário. Ficas com esta mão?')
  const disc = m.match(/Select (\d+) card\(s\) to discard/i)
  if (disc) return tx('Mão cheia: clica em {n} carta(s) da mão para descartar.', { n: disc[1] })
  if (/^Select|^Choose/i.test(m) && st?.players?.some(p => [...(p.hand || []), ...(p.battlefield || [])].some(c => c.sel))) return `${tx('Clica numa das cartas assinaladas.')} (${m.split('\n')[0]})`
  if (/Declare attackers|Select creatures to attack/i.test(m)) return tx('Atacar: clica nas criaturas que atacam e depois OK.')
  if (/Declare blockers|Select creatures to block/i.test(m)) return tx('Bloquear: clica no atacante e depois na tua criatura que bloqueia; OK no fim.')
  if (/Pay Mana Cost|Pay mana cost/i.test(m)) return `${tx('Paga: toca nos terrenos ou na mana da reserva.')} ${m.split('\n').find(l => /\{/.test(l)) || ''}`
  return m
}

// uma carta solta (mão, escolhas, cemitério): imagem da Scryfall com força/resistência por cima. h = id da carta na mão:
// a mesa trata do clique e do arrastar pelo data-h
function FCard({ c, data, onClick, h, cls = '', big }) {
  if (!c || c.hidden) return <div className={`fp-card back ${cls}`} />
  const card = data.byName.get(c.name) || data.byLower?.get(String(c.name).toLowerCase())
  const src = card ? img(card, big ? 'normal' : 'small') : null
  return (
    <button type="button" className={`fp-card ${c.sel ? 'sel' : ''} ${cls}`} title={c.name} data-h={h} data-zid={c.id}
      onClick={onClick && (() => onClick(c))} onContextMenu={e => e.preventDefault()}>
      {src ? <img src={src} alt={c.name} loading="lazy" draggable="false" /> : <span className="fp-name">{c.name}</span>}
      {c.pt && <i className="fp-pt">{c.pt[0]}/{c.pt[1]}</i>}
    </button>
  )
}

// estado do Forge -> o formato do tabuleiro das repetições (Board.jsx), para a mesa ser igual à da arena: criaturas à
// frente, terrenos (agrupados) e artefactos/encantamentos atrás, a vida no orbe, cemitério e exílio nas pilhas
const CTR = { P1P1: '+1/+1', M1M1: '-1/-1', LOYALTY: 'loyalty', POISON: 'poison', ENERGY: 'energy' }
const ctrs = o => Object.fromEntries(Object.entries(o || {}).map(([k, n]) => [CTR[k] || CTR[String(k).toUpperCase()] || k, n]))
function toPerm(c, combat) {
  const counters = ctrs(c.counters)
  if (c.loyalty != null) counters.loyalty = c.loyalty
  const plus = (counters['+1/+1'] || 0) - (counters['-1/-1'] || 0)  // o Forge já soma os marcadores ao P/R; o tabuleiro volta a somá-los
  return {
    key: String(c.id), name: c.name || '', hidden: !!c.hidden, tapped: !!c.tapped, sick: !!c.sick, token: !!c.token, flipped: !!c.flipped,
    land: !!c.land, crewed: !!c.creature, attachedTo: c.attachedTo != null ? String(c.attachedTo) : undefined, damage: c.dmg || 0, counters,
    pt: c.pt ? `${c.pt[0] - plus}/${c.pt[1] - plus}` : undefined,
    attacking: combat?.some(x => x.att === c.id) ? 'x' : undefined, blocking: combat?.some(x => x.blockers?.includes(c.id)) || undefined,
  }
}
function zoneOf(p, combat) {
  const pc = ctrs(p.counters)
  return {
    life: p.life, library: p.library, hand: p.hand?.length || 0, known: [], graveyard: (p.graveyard || []).map(c => c.name), exile: (p.exile || []).map(c => c.name),
    command: [], cmdDmg: {}, poison: pc.poison || 0, energy: pc.energy || 0, emblems: [], out: false, perms: (p.battlefield || []).map(c => toPerm(c, combat)),
  }
}

// arrastar com física: a carta segue o ponteiro com um pouco de atraso, inclina-se com a velocidade e, se não puder
// ficar onde a largaste, volta ao sítio com mola. onDrop({id, from, target}) diz se a jogada foi aceite.
function useDrag(onDrop, onLong) {
  const dragged = useRef(false)
  const down = e => {
    if (e.button > 0) return
    const el = e.target.closest('[data-h], .bside.bottom .pc[data-z^="k:"]')
    if (!el) return
    const id = +(el.dataset.h || el.dataset.z.slice(2)), from = el.dataset.h ? 'hand' : 'field'
    const r = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY
    let ghost = null, raf = 0, x = r.left + r.width / 2, y = r.top + r.height / 2, tx0 = x0, ty0 = y0, rot = 0, over = null
    const long = e.pointerType !== 'mouse' && setTimeout(() => onLong?.(id), 450)  // tocar e manter = ver em grande
    const mark = t => { if (over) over.classList.remove('fp-over'); over = t; if (t) t.classList.add('fp-over') }
    const targetAt = (px, py) => document.elementFromPoint(px, py)
    const zoneAt = t => t?.closest('.pc[data-z^="k:"]') || t?.closest('.bside') || t?.closest('.fp-mid')
    const tick = () => {
      x += (tx0 - x) * 0.32; y += (ty0 - y) * 0.32
      const want = Math.max(-26, Math.min(26, (tx0 - x) * 0.45))
      rot += (want - rot) * 0.22
      ghost.style.transform = `translate(${x - r.width / 2}px, ${y - r.height / 2}px) rotate(${rot}deg) scale(1.12)`
      raf = requestAnimationFrame(tick)
    }
    const move = ev => {
      tx0 = ev.clientX; ty0 = ev.clientY
      if (!ghost) {
        if (Math.hypot(tx0 - x0, ty0 - y0) < 8) return
        clearTimeout(long)
        ghost = el.cloneNode(true)
        ghost.classList.add('fp-ghost')
        Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px` })
        document.body.appendChild(ghost)
        el.style.visibility = 'hidden'
        raf = requestAnimationFrame(tick)
      }
      mark(zoneAt(targetAt(tx0, ty0)))
    }
    const up = ev => {
      clearTimeout(long)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      if (!ghost) return
      cancelAnimationFrame(raf); mark(null)
      dragged.current = true; setTimeout(() => { dragged.current = false }, 0)  // o clique que vem a seguir ao largar não conta
      const res = ev.type === 'pointerup' && onDrop({ id, from, target: targetAt(ev.clientX, ev.clientY) }), g = ghost
      if (res === 'local') {  // arrumação: a carta voa com mola para o sítio novo e só então aparece lá
        setTimeout(() => {
          const n = document.querySelector(from === 'hand' ? `[data-h="${id}"]` : `.pc[data-z="k:${id}"]`)
          el.style.visibility = ''
          if (!n) { g.remove(); return }
          const q = n.getBoundingClientRect()
          n.style.visibility = 'hidden'
          g.style.transition = 'transform .5s cubic-bezier(.2, 1.5, .4, 1), width .5s, height .5s'
          Object.assign(g.style, { transform: `translate(${q.left}px, ${q.top}px) rotate(0deg) scale(1)`, width: `${q.width}px`, height: `${q.height}px` })
          setTimeout(() => { n.style.visibility = ''; g.remove() }, 520)
        }, 40)
        return
      }
      const ok = !!res
      g.style.transition = ok ? 'transform .25s ease-out, opacity .25s ease-out' : 'transform .55s cubic-bezier(.2, 1.6, .4, 1)'
      requestAnimationFrame(() => {
        g.style.transform = ok ? `translate(${ev.clientX - r.width / 2}px, ${ev.clientY - r.height / 2}px) scale(.9)` : `translate(${r.left}px, ${r.top}px) rotate(0deg) scale(1)`
        if (ok) g.style.opacity = '0'
      })
      setTimeout(() => { g.remove(); el.style.visibility = '' }, ok ? 700 : 560)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  return { down, dragged }
}

// escolhas que bloqueiam o motor: sim/não, uma opção, um número ou texto, ou escolher entre cartas/jogadores
function Ask({ a, st, data, answer, zoom }) {
  const [pick, setPick] = useState([]), [txt, setTxt] = useState(a.initial || '')
  const all = (st?.players || []).flatMap(p => [...(p.battlefield || []), ...(p.hand || []), ...(p.graveyard || []), ...(p.exile || [])])
  const cardOf = o => (o.card != null ? all.find(c => c.id === o.card) || { id: o.card, name: o.label } : null)
  if (a.kind === 'confirm' || a.kind === 'option') return (
    <div className="fp-ask"><p>{a.msg || a.title}</p>
      <div className="row-btns">{(a.options || []).map((o, k) => <button key={k} className={k ? '' : 'primary'} onClick={() => answer(a, [k])}>{BTN[o] || o}</button>)}</div></div>)
  if (a.kind === 'input') return (
    <div className="fp-ask"><p>{a.msg || a.title}</p>
      {a.options ? <div className="row-btns">{a.options.map((o, k) => <button key={k} onClick={() => answer(a, o)}>{o}</button>)}</div>
        : <form className="row-btns" onSubmit={e => { e.preventDefault(); answer(a, txt) }}><input autoFocus type={a.numeric ? 'number' : 'text'} value={txt} onChange={e => setTxt(e.target.value)} /><button className="primary">{tx('OK')}</button></form>}</div>)
  const min = a.min ?? 1, max = a.max ?? 1, one = max === 1
  const toggle = k => (one ? answer(a, [k]) : setPick(p => (p.includes(k) ? p.filter(x => x !== k) : p.length < max ? [...p, k] : p)))
  return (
    <div className="fp-ask"><p>{a.msg} {!one && <span className="muted small">{tx('escolhe {a} a {b}', { a: min, b: max })}</span>}</p>
      <div className="fp-opts">{(a.options || []).map((o, k) => { const c = cardOf(o); return c
        ? <div key={k} className={`fp-opt ${pick.includes(k) ? 'on' : ''}`}><FCard c={c} data={data} big onClick={() => toggle(k)} onZoom={zoom} /></div>
        : <button key={k} className={`fp-optl ${pick.includes(k) ? 'on' : ''}`} onClick={() => toggle(k)}>{o.label}</button> })}</div>
      <div className="row-btns">{!one && <button className="primary" disabled={pick.length < min} onClick={() => answer(a, pick)}>{tx('Confirmar ({n})', { n: pick.length })}</button>}
        {min === 0 && <button onClick={() => answer(a, [])}>{tx('Nenhum')}</button>}</div>
    </div>
  )
}

export default function ForgeTable({ sid, data, onClose, onAgain }) {
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
        } catch (e) { if (!live) return; setErr(e.message); if (/não existe/.test(e.message)) return; await new Promise(ok => setTimeout(ok, 2000)) }
      }
    })()
    return () => { live = false }
  }, [sid])
  useEffect(() => {  // avisos do motor (cartas reveladas, erros): aparecem uns segundos
    const log = s?.log || [], n = log.length
    if (!n || seen.current === n) return
    seen.current = n
    const m = log[n - 1]
    if (m.t === 'flash' || /^AI can't play/.test(m.title || '')) return  // o aviso do Forge sobre cartas que a IA joga mal não interessa a quem joga
    setToast(m); const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t)
  }, [s?.log])
  const send = c => j(`/api/playnet/${sid}/cmd`, c).catch(e => setErr(e.message))
  const answer = (a, v) => { setS(x => ({ ...x, asks: x.asks.filter(y => y.id !== a.id) })); send({ c: 'answer', id: a.id, v }) }
  const st = s?.state, players = st?.players || []
  const me = players.find(p => p.me) || players.find(p => !p.ai), opp = players.find(p => p !== me)
  const pr = s?.prompt, btns = (pr?.buttons || []).filter(b => b.label)
  const ask = s?.asks?.[0]
  useEffect(() => {  // Espaço/Enter = o botão principal, Esc = o outro
    const k = e => {
      if (ask || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      const b = e.key === ' ' || e.key === 'Enter' ? btns[0] : e.key === 'Escape' ? btns[1] : null
      if (b?.on) { e.preventDefault(); send({ c: b.c }) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const byId = new Map(players.flatMap(p => ['battlefield', 'hand', 'graveyard', 'exile'].flatMap(z => (p[z] || []).map(c => [c.id, c]))))
  const lives = `${me?.life}|${opp?.life}`, prevLives = useRef(null), [lifeFx, setLifeFx] = useState(null)
  useEffect(() => {  // a vida mudou: o orbe pisca e mostra o +N/−N, como na arena
    const [a, b] = lives.split('|').map(Number), pv = prevLives.current
    prevLives.current = [a, b]
    if (!pv || Number.isNaN(a)) return
    if (a !== pv[0]) setLifeFx({ p: 'a', d: a - pv[0] }); else if (b !== pv[1]) setLifeFx({ p: 'b', d: b - pv[1] })
  }, [lives])
  const send1 = c => send(c)
  const [lay, setLayS] = useState(() => { try { return JSON.parse(localStorage.getItem(`grimorio.fp.${sid}`)) || {} } catch { return {} } })  // arrumação à mão
  const setLay = f => setLayS(x => { const y = f(x); try { localStorage.setItem(`grimorio.fp.${sid}`, JSON.stringify(y)) } catch { /* sem armazenamento */ } return y })
  const keysIn = (box, sel, attr) => [...box.querySelectorAll(sel)].map(e => e.getAttribute(attr).replace(/^k:/, ''))
  const moveBefore = (keys, k, before) => { const l = keys.filter(x => x !== k), i = before == null ? -1 : l.indexOf(before); l.splice(i < 0 ? l.length : i, 0, k); return l }
  const drop = ({ id, from, target }) => {
    if (!target?.closest('.fp-table')) return false
    const hand = target.closest('.fp-hand')
    if (from === 'hand' && hand) {  // dentro da mão: mudar a ordem
      const h = target.closest('[data-h]'), l = moveBefore(keysIn(hand, '[data-h]', 'data-h'), String(id), h?.dataset.h)
      setLay(x => ({ ...x, hand: l })); return 'local'
    }
    if (from === 'hand') { send1({ c: 'card', id }); return true }  // da mão para a mesa: jogar
    const perm = target.closest('.pc[data-z^="k:"]'), pid = perm && +perm.dataset.z.slice(2), mine = st.active === me?.id
    if (!mine && pid && st.combat?.some(x => x.att === pid)) { send1({ c: 'card', id: pid }).then(() => send1({ c: 'card', id })); return true }  // largar num atacante: bloquear
    if (mine && st.phase === 'COMBAT_DECLARE_ATTACKERS' && target.closest('.bside.top')) { send1({ c: 'card', id }); return true }  // largar no lado dele: atacar
    const row = target.closest('.bside.bottom') && target.closest('.brow')
    if (!row) return false
    // no teu lado: arrumar à vontade (por cima de uma carta = fica no lugar dela; numa fila vazia = vai para o fim dessa fila)
    const r = row.classList.contains('front') ? 'front' : row.classList.contains('lands') ? 'lands' : 'others'
    const box = row.classList.contains('rear') ? row.querySelector('.brow.others') || row : row
    const l = moveBefore(keysIn(box, '.pc[data-z^="k:"]', 'data-z'), String(id), pid != null && pid !== id ? String(pid) : null)
    setLay(x => ({ ...x, place: { ...x.place, [id]: r }, order: { ...x.order, ...Object.fromEntries(l.map((k, i) => [k, i])) } }))
    return 'local'
  }
  const { down, dragged } = useDrag(drop, id => setZoom(byId.get(id)))
  if (!st) return <div className="fp-wait">{err ? <p className="bad-t">{err}</p> : <p className="muted">{tx('O Forge está a abrir o jogo (uns 20 segundos)…')}</p>}</div>
  const myTurn = st.active === me?.id
  const bs = { sides: ['a', 'b'], a: zoneOf(me || {}, st.combat), b: zoneOf(opp || {}, st.combat), active: myTurn ? 'a' : 'b', i: s.seq, exact: true }
  const att = new Map()
  for (const p of [...bs.a.perms, ...bs.b.perms]) if (p.attachedTo) att.set(p.attachedTo, [...(att.get(p.attachedTo) || []), p])
  const sel = new Set([...byId.values()].filter(c => c.sel).map(c => String(c.id)))
  const fx = { hl: sel, par: 'sel', pops: new Map(), life: lifeFx, player: null }
  const openZone = (k, z) => setZone({ p: k === 'a' ? me : opp, k: z })
  const onClick = e => {  // um clique numa carta da mesa ou da mão = o mesmo que no Forge; no orbe = escolher o jogador
    if (dragged.current) return
    const h = e.target.closest('[data-h]')
    if (h) return send({ c: 'card', id: +h.dataset.h })
    const z = e.target.closest('[data-z]')?.dataset.z
    if (z?.startsWith('k:')) return send({ c: 'card', id: +z.slice(2) })
    const orb = e.target.closest('.orb')
    if (orb) send({ c: 'player', i: players.indexOf(orb.closest('.bside')?.classList.contains('top') ? opp : me) })
  }
  const onOver = e => {
    const el = e.target.closest('[data-z], [data-zid]'), z = el?.dataset.z
    const c = z?.startsWith('k:') ? byId.get(+z.slice(2)) : el?.dataset.zid ? byId.get(+el.dataset.zid) : z?.startsWith('n:') ? { name: z.slice(2) } : null
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
    <div className="fp" onMouseLeave={() => setZoom(null)}>
      <div className="fp-table board table" onClick={onClick} onMouseOver={onOver} onMouseMove={tilt} onPointerDown={down}>
        {opp && <Side k="b" top name={opp.name} s={bs} data={data} fx={fx} att={att} start={20} openZone={openZone}
          hand={nOpp > 0 && <Hand z={{ hand: nOpp, known: Array(nOpp).fill('?') }} data={data} exact opp hidden quiet />} />}
        <div className="fp-mid">
          <span className="fp-turn">{tx('Turno {n}', { n: st.turn })} · {myTurn ? tx('teu') : opp?.name}</span>
          <span className="fp-phases">{PHASES.map(([k, l, ps]) => <i key={k} className={ps.includes(st.phase) ? 'on' : ''}>{l}</i>)}</span>
          {st.stack?.length > 0 && <div className="fp-stack">{st.stack.map((x, k) => (
            <div key={k} className={`fp-si ${x.by === me?.id ? 'mine' : ''}`} data-z={x.name ? `n:${x.name}` : undefined}><b>{x.name}</b><small>{x.text}</small></div>))}</div>}
        </div>
        {me && <Side k="a" name={me.name} s={bs} data={data} fx={fx} att={att} start={20} openZone={openZone} place={lay.place} order={lay.order}
          hand={<div className="fp-hand">{handIn(me.hand || []).map(c => <FCard key={c.id} c={c} h={c.id} data={data} big />)}</div>} />}
      </div>
      <aside className="fp-side">
        <div className="fp-zoom">{zc ? <img src={img(zc, 'normal')} alt={zc.n} /> : <p className="muted small">{tx('Passa o rato por uma carta (no tablet: toca e mantém) para a veres em grande.')}</p>}</div>
        <div className={`fp-prompt ${pr && btns.some(b => b.on) ? 'mine' : ''}`}>
          <p>{promptText(pr?.msg, st, me)}</p>
          <div className="row-btns">{btns.map((b, k) => <button key={k} className={k ? '' : 'primary'} disabled={!b.on} onClick={() => send({ c: b.c })}>{BTN[b.label] || b.label}</button>)}</div>
          {mana.length > 0 && <span className="fp-pool" title={tx('Reserva de mana: clica para a usar')}>{mana.map(([k, n]) => (
            <button type="button" key={k} style={{ '--m': MANA[k] }} onClick={() => send({ c: 'mana', color: k })} title={tx('Usar esta mana')}>{n}</button>))}</span>}
          <p className="small muted fp-tip">{tx('Arrasta uma carta da mão para a mesa para a jogar. No combate, arrasta uma criatura tua para o lado do adversário (atacar) ou para cima de um atacante (bloquear). Arruma o teu lado e a mão como quiseres: larga uma carta por cima de outra ou numa fila.')}</p>
          <div className="row-btns small">
            <button className="link small" onClick={() => send({ c: 'undo' })}>↶ {tx('desfazer')}</button>
            <button className="link small" onClick={() => send({ c: 'concede' })}>🏳 {tx('desistir')}</button>
          </div>
          {err && <p className="small bad-t">{err}</p>}
        </div>
      </aside>
      {ask && <div className="fp-modal"><Ask key={ask.id} a={ask} st={st} data={data} answer={answer} zoom={setZoom} /></div>}
      {zone && <div className="fp-modal" onClick={() => setZone(null)}><div className="fp-ask" onClick={e => e.stopPropagation()}>
        <p><b>{zone.k === 'graveyard' ? tx('Cemitério de {n}', { n: zone.p.name }) : tx('Exílio de {n}', { n: zone.p.name })}</b> <button className="link small" onClick={() => setZone(null)}>{tx('fechar')}</button></p>
        <div className="fp-opts">{(players.find(p => p.id === zone.p.id)?.[zone.k] || []).map(c => <FCard key={c.id} c={c} data={data} big onClick={x => { send({ c: 'card', id: x.id }); setZone(null) }} />)}</div></div></div>}
      {toast && <div className="fp-toast" onClick={() => setToast(null)}>{toast.title && <b>{toast.title}</b>} {toast.msg}{toast.list && <ul>{toast.list.map((l, k) => <li key={k}>{l}</li>)}</ul>}</div>}
      {s.ended && <div className="fp-modal"><div className="fp-ask fp-end">
        <h3>{s.winner ? (s.winner === me?.name ? tx('🏆 Ganhaste!') : tx('Ganhou {n}', { n: s.winner })) : tx('Jogo terminado')}</h3>
        <div className="row-btns"><button className="primary" onClick={onAgain}>▶ {tx('Jogar outra vez')}</button><button onClick={onClose}>{tx('Fechar')}</button></div></div></div>}
    </div>
  )
}
