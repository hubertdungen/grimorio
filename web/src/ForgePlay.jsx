// Forge Play nativo: jogas contra a IA do Forge com a mesa do Grimório. O motor corre no servidor (playnet.py +
// build/forge/GrimorioNet.java) e manda o estado do jogo, o pedido atual (o que o motor espera de ti) e as escolhas
// pendentes; aqui desenha-se a mesa e cada clique volta como comando (carta, jogador, OK/cancelar, mana, responder).
import { useEffect, useRef, useState } from 'react'
import { img } from './data.js'
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
const BTN = { OK: tx('OK'), Cancel: tx('Cancelar'), 'End Turn': tx('Acabar o turno'), Keep: tx('Ficar com a mão'), Mulligan: 'Mulligan', Play: tx('Jogar primeiro'), Draw: tx('Comprar (ir em segundo)'), Auto: tx('Pagar sozinho'), Yes: tx('Sim'), No: tx('Não') }
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
  if (/Declare attackers/i.test(m)) return tx('Atacar: clica nas criaturas que atacam e depois OK.')
  if (/Declare blockers/i.test(m)) return tx('Bloquear: clica no atacante e depois na tua criatura que bloqueia; OK no fim.')
  if (/Pay Mana Cost|Pay mana cost/i.test(m)) return `${tx('Paga: toca nos terrenos ou na mana da reserva.')} ${m.split('\n').find(l => /\{/.test(l)) || ''}`
  return m
}

// uma carta da mesa: imagem da Scryfall, virada se está tapada, com força/resistência, marcadores e dano por cima
function FCard({ c, data, onClick, onZoom, cls = '', big }) {
  const press = useRef(null)
  if (!c || c.hidden) return <div className={`fp-card back ${cls}`} />
  const card = data.byName.get(c.name) || data.byLower?.get(String(c.name).toLowerCase())
  const src = card ? img(card, big ? 'normal' : 'small') : null
  const touchStart = () => { press.current = setTimeout(() => { press.current = 'z'; onZoom?.(c) }, 450) }  // tocar e manter = ver em grande
  const touchEnd = e => { if (press.current === 'z') e.preventDefault(); clearTimeout(press.current); press.current = null }
  return (
    <button type="button" className={`fp-card ${c.tapped ? 'tapped' : ''} ${c.sel ? 'sel' : ''} ${c.sick ? 'sick' : ''} ${cls}`} title={c.name}
      onClick={() => onClick?.(c)} onMouseEnter={() => onZoom?.(c)} onTouchStart={touchStart} onTouchEnd={touchEnd} onContextMenu={e => e.preventDefault()}>
      {src ? <img src={src} alt={c.name} loading="lazy" draggable="false" /> : <span className="fp-name">{c.name}</span>}
      {c.pt && <i className={`fp-pt ${c.dmg ? 'hurt' : ''}`}>{c.pt[0]}/{c.pt[1] - (c.dmg || 0)}</i>}
      {c.loyalty != null && <i className="fp-loy">{c.loyalty}</i>}
      {c.counters && <i className="fp-ctr">{Object.entries(c.counters).map(([k, n]) => `${n}× ${k}`).join(' · ')}</i>}
      {c.token && <i className="fp-tok">{tx('ficha')}</i>}
    </button>
  )
}

// o campo de um jogador: terrenos numa fila, o resto noutra; o que está anexado (auras, equipamentos) fica por baixo do dono
function Field({ p, data, act, zoom, combat, flip }) {  // flip: o do adversário, terrenos para fora e criaturas para o meio
  const bf = p.battlefield || [], att = new Set(bf.filter(c => c.attachedTo).map(c => c.id))
  const under = id => bf.filter(c => c.attachedTo === id)
  const role = c => (combat?.some(x => x.att === c.id) ? 'atk' : combat?.some(x => x.blockers?.includes(c.id)) ? 'blk' : '')
  const pile = c => <div key={c.id} className="fp-pile">{under(c.id).map(a => <FCard key={a.id} c={a} data={data} onClick={act} onZoom={zoom} cls="att" />)}<FCard c={c} data={data} onClick={act} onZoom={zoom} cls={role(c)} /></div>
  const lands = bf.filter(c => c.land && !att.has(c.id) && !c.creature), rest = bf.filter(c => !(c.land && !c.creature) && !att.has(c.id))
  const rows = [<div key="r" className="fp-row">{rest.map(pile)}</div>, <div key="l" className="fp-row lands">{lands.map(pile)}</div>]
  return <div className={`fp-field ${flip ? 'opp' : ''}`}>{flip ? rows.reverse() : rows}</div>
}

function Seat({ p, i, send, setZone, active, mine }) {
  const mana = Object.entries(p.mana || {})
  return (
    <div className={`fp-seat ${p.priority ? 'prio' : ''} ${active ? 'active' : ''}`}>
      <button type="button" className="fp-life" onClick={() => send({ c: 'player', i })} title={tx('Clica para escolher este jogador como alvo')}>
        <b>{p.life}</b><span>{p.name}</span>
      </button>
      <span className="fp-z" title={tx('Biblioteca')}>📚 {p.library}</span>
      {!mine && <span className="fp-z fp-ohand" title={tx('Mão')}>{(p.hand || []).map((c, k) => <i key={k} className="fp-card back mini" />)} {p.hand?.length || 0}</span>}
      <button type="button" className="fp-z" onClick={() => setZone({ p, k: 'graveyard' })} title={tx('Cemitério')}>🪦 {p.graveyard?.length || 0}</button>
      <button type="button" className="fp-z" onClick={() => setZone({ p, k: 'exile' })} title={tx('Exílio')}>🌀 {p.exile?.length || 0}</button>
      {p.counters && <span className="fp-z">{Object.entries(p.counters).map(([k, n]) => `${n}× ${k}`).join(' · ')}</span>}
      {mana.length > 0 && <span className="fp-pool">{mana.map(([k, n]) => (
        <button type="button" key={k} style={{ '--m': MANA[k] }} disabled={!mine} onClick={() => send({ c: 'mana', color: k })} title={tx('Usar esta mana')}>{n}</button>))}</span>}
    </div>
  )
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
  if (!st) return <div className="fp-wait">{err ? <p className="bad-t">{err}</p> : <p className="muted">{tx('O Forge está a abrir o jogo (uns 20 segundos)…')}</p>}</div>
  const act = c => send({ c: 'card', id: c.id })
  const idx = p => players.indexOf(p)
  const myTurn = st.active === me?.id, atkStep = myTurn && st.phase === 'COMBAT_DECLARE_ATTACKERS'
  const zc = zoom && (data.byName.get(zoom.name) || data.byLower?.get(String(zoom.name).toLowerCase()))
  return (
    <div className="fp" onMouseLeave={() => setZoom(null)}>
      <div className="fp-table">
        {opp && <><Seat p={opp} i={idx(opp)} send={send} setZone={setZone} active={st.active === opp.id} />
          <Field p={opp} data={data} act={act} zoom={setZoom} combat={st.combat} flip /></>}
        <div className="fp-mid">
          <span className="fp-turn">{tx('Turno {n}', { n: st.turn })} · {myTurn ? tx('teu') : opp?.name}</span>
          <span className="fp-phases">{PHASES.map(([k, l, ps]) => <i key={k} className={ps.includes(st.phase) ? 'on' : ''}>{l}</i>)}</span>
          {st.stack?.length > 0 && <div className="fp-stack">{st.stack.map((x, k) => (
            <div key={k} className={`fp-si ${x.by === me?.id ? 'mine' : ''}`} onMouseEnter={() => x.name && setZoom({ name: x.name })}><b>{x.name}</b><small>{x.text}</small></div>))}</div>}
        </div>
        {me && <><Field p={me} data={data} act={act} zoom={setZoom} combat={st.combat} />
          <Seat p={me} i={idx(me)} send={send} setZone={setZone} active={myTurn} mine />
          <div className="fp-hand">{(me.hand || []).map(c => <FCard key={c.id} c={c} data={data} onClick={act} onZoom={setZoom} big />)}</div></>}
      </div>
      <aside className="fp-side">
        <div className="fp-zoom">{zc ? <img src={img(zc, 'normal')} alt={zc.n} /> : <p className="muted small">{tx('Passa o rato por uma carta (no tablet: toca e mantém) para a veres em grande.')}</p>}</div>
        <div className={`fp-prompt ${pr && btns.some(b => b.on) ? 'mine' : ''}`}>
          <p>{promptText(pr?.msg, st, me)}</p>
          <div className="row-btns">{btns.map((b, k) => <button key={k} className={k ? '' : 'primary'} disabled={!b.on} onClick={() => send({ c: b.c })}>{BTN[b.label] || b.label}</button>)}</div>
          <div className="row-btns small">
            {atkStep && <button onClick={() => send({ c: 'alpha' })}>⚔ {tx('Atacar com tudo')}</button>}
            <button className="link small" onClick={() => send({ c: 'undo' })}>↶ {tx('desfazer')}</button>
            <button className="link small" onClick={() => send({ c: 'concede' })}>🏳 {tx('desistir')}</button>
          </div>
          {err && <p className="small bad-t">{err}</p>}
        </div>
      </aside>
      {ask && <div className="fp-modal"><Ask key={ask.id} a={ask} st={st} data={data} answer={answer} zoom={setZoom} /></div>}
      {zone && <div className="fp-modal" onClick={() => setZone(null)}><div className="fp-ask" onClick={e => e.stopPropagation()}>
        <p><b>{zone.k === 'graveyard' ? tx('Cemitério de {n}', { n: zone.p.name }) : tx('Exílio de {n}', { n: zone.p.name })}</b> <button className="link small" onClick={() => setZone(null)}>{tx('fechar')}</button></p>
        <div className="fp-opts">{(players.find(p => p.id === zone.p.id)?.[zone.k] || []).map(c => <FCard key={c.id} c={c} data={data} big onClick={x => { act(x); setZone(null) }} onZoom={setZoom} />)}</div></div></div>}
      {toast && <div className="fp-toast" onClick={() => setToast(null)}>{toast.title && <b>{toast.title}</b>} {toast.msg}{toast.list && <ul>{toast.list.map((l, k) => <li key={k}>{l}</li>)}</ul>}</div>}
      {s.ended && <div className="fp-modal"><div className="fp-ask fp-end">
        <h3>{s.winner ? (s.winner === me?.name ? tx('🏆 Ganhaste!') : tx('Ganhou {n}', { n: s.winner })) : tx('Jogo terminado')}</h3>
        <div className="row-btns"><button className="primary" onClick={onAgain}>▶ {tx('Jogar outra vez')}</button><button onClick={onClose}>{tx('Fechar')}</button></div></div></div>}
    </div>
  )
}
