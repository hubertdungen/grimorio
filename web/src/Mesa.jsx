// Mesa: contador de vida (1 a 6 jogadores, vida e veneno/infect, registo) e lançador de dados (d4–d100 e moeda, com
// física, registo). Cada um guarda o seu estado no browser; abrir os dados por cima do contador não mexe nas vidas.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Logo } from './ui.jsx'
import { ask } from './confirm.jsx'
import { tx, LOCALE } from './i18n.js'
import { play } from './sfx.js'
import { needsMark } from './game.js'

const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') } } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem armazenamento */ } }
function useStored(k, d) {
  const [v, setV] = useState(() => load(k, d))
  useEffect(() => { save(k, v) }, [k, v])
  return [v, setV]
}
const rnd = n => (crypto.getRandomValues(new Uint32Array(1))[0] % n) + 1
const hhmm = t => new Date(t).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// ---------------- contador de vida ----------------
const COLORS = ['#7c5cff', '#e0475b', '#2fa36b', '#e8a33d', '#2f8fd8', '#c74fb0']
const NAMES = n => Array.from({ length: n }, (_, i) => tx('Jogador {n}', { n: i + 1 }))
const LIFE0 = { n: 2, start: 20, face: true, players: NAMES(6).map((name, i) => ({ name, color: COLORS[i], life: 20, poison: 0 })), log: [] }
const POISON_MAX = 10, CMD_MAX = 21  // veneno 10 e 21 de dano do mesmo comandante: perde-se o jogo
// campos de um jogador: 'life', 'poison', 'tax'/'taxb' (vezes que lançou o comandante / o partner) ou 'cmd:<j>' e
// 'cmd:<j>b' (dano de comandante recebido do comandante / do partner do jogador j)
const getF = (p, f) => (f.startsWith('cmd:') ? p.cmd?.[f.slice(4)] || 0 : p[f] || 0)
const putF = (p, f, v) => (f.startsWith('cmd:') ? { ...p, cmd: { ...(p.cmd || {}), [f.slice(4)]: v } } : { ...p, [f]: v })

function useHold(fn) {  // carregar e manter: 1 já, depois repete cada vez mais depressa
  const t = useRef(null)
  const stop = () => { clearTimeout(t.current); t.current = null }
  const start = e => {
    e.preventDefault(); stop(); fn()
    let gap = 380
    const go = () => { fn(); gap = Math.max(55, gap * 0.8); t.current = setTimeout(go, gap) }
    t.current = setTimeout(go, gap)
  }
  useEffect(() => stop, [])
  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onContextMenu: e => e.preventDefault() }
}

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

function Player({ p, i, flip, onLife, onPoison, onCmd, onName, spot, pend, opps, cmdr, onTax, onPartner, mon, ini, onMon, onIni }) {  // opps: adversários (modo Commander)
  const minus = useHold(() => onLife(i, -1)), plus = useHold(() => onLife(i, 1))
  const dead = p.life <= 0 || p.poison >= POISON_MAX || Object.values(p.cmd || {}).some(x => x >= CMD_MAX)
  const [bump, setBump] = useState(0)
  const prev = useRef(p.life)
  useEffect(() => { if (prev.current !== p.life) { setBump(p.life < prev.current ? -1 : 1); prev.current = p.life; const k = setTimeout(() => setBump(0), 260); return () => clearTimeout(k) } }, [p.life])
  // no tátil os contadores pequenos ficam num botão de resumo; tocar (ou puxar para cima) abre-os em grande por cima do jogador
  const [open, setOpen] = useState(false), sy = useRef(0)
  const controls = (<>
        <span className={`lc-poison ${p.poison ? 'on' : ''}`} title={tx('Veneno (infect): com {m} perde-se o jogo', { m: POISON_MAX })}>
          <button onClick={() => onPoison(i, -1)} aria-label={tx('Tirar veneno')}>−</button>
          <span>☠ {p.poison}</span><small className="lc-lbl">{tx('veneno')}</small>
          <button onClick={() => onPoison(i, 1)} aria-label={tx('Dar veneno')}>+</button>
        </span>
        {opps && <span className="lc-cmds">{opps.flatMap(o => (o.partner ? ['', 'b'] : ['']).map(b => { const v = p.cmd?.[`${o.i}${b}`] || 0, n = b ? tx('{n} (partner)', { n: o.name }) : o.name; return (
          <span key={o.i + b} className={`lc-cmd ${v ? 'on' : ''} ${v >= CMD_MAX ? 'kill' : ''}`} style={{ '--oc': o.color }} title={tx('Dano do comandante de {n} ({m} = perde)', { n, m: CMD_MAX })}>
            <button onClick={() => onCmd(i, `${o.i}${b}`, -1)} aria-label={tx('Tirar dano de comandante de {n}', { n })}>−</button>
            <b>⚔{b && '²'} {v}</b><small className="lc-lbl">{n}</small>
            <button onClick={() => onCmd(i, `${o.i}${b}`, 1)} aria-label={tx('Dar dano de comandante de {n}', { n })}>+</button>
          </span>) }))}</span>}
        {cmdr && <span className="lc-extra">
          {(p.partner ? ['tax', 'taxb'] : ['tax']).map(f => (
            <span key={f} className={`lc-tax ${p[f] ? 'on' : ''}`} title={tx('Imposto de comandante: +2 de mana por cada vez que já foi lançado da zona de comando ({k}×)', { k: p[f] || 0 })}>
              <button onClick={() => onTax(i, f, -1)} aria-label={tx('Tirar um lançamento')}>−</button>
              <span><i className="lc-tx">{f === 'taxb' ? '²' : ''}{tx('imposto')} </i><b>+{2 * (p[f] || 0)}</b></span><small className="lc-lbl">{tx('imposto')}{f === 'taxb' ? ' ²' : ''}</small>
              <button onClick={() => onTax(i, f, 1)} aria-label={tx('Lançou o comandante')}>+</button>
            </span>))}
          <button className={`lc-tag ${p.partner ? 'on' : ''}`} onClick={() => onPartner(i)} aria-pressed={!!p.partner} title={tx('Dois comandantes (partner, «Friends forever», background…): o dano e o imposto contam-se em separado')}>⚭ {tx('partner')}</button>
          <button className={`lc-tag ${mon ? 'on gold' : ''}`} onClick={() => onMon(i)} aria-pressed={mon} title={tx('Monarca: compra uma carta no fim de cada turno seu; quem lhe fizer dano de combate fica monarca')}>👑 {tx('monarca')}</button>
          <button className={`lc-tag ${ini ? 'on gold' : ''}`} onClick={() => onIni(i)} aria-pressed={ini} title={tx('Iniciativa: avança na Undercity ao ficar com ela e no início de cada turno seu; quem lhe fizer dano de combate fica com ela')}>🏰 {tx('iniciativa')}</button>
        </span>}
  </>)
  return (
    <div className={`lc-p ${flip ? 'flip' : ''} ${dead ? 'dead' : ''} ${spot ? 'spot' : ''}`} style={{ '--pc': p.color }}>
      <button className="lc-zone minus" {...minus} aria-label={tx('Tirar 1 de vida a {n}', { n: p.name })}><span>−</span></button>
      <button className="lc-zone plus" {...plus} aria-label={tx('Dar 1 de vida a {n}', { n: p.name })}><span>+</span></button>
      <div className="lc-mid">
        <input className="lc-name" value={p.name} onChange={e => onName(i, e.target.value)} aria-label={tx('Nome')} />
        <b className={`lc-life ${bump < 0 ? 'down' : bump > 0 ? 'up' : ''}`}>{p.life}</b>
        {pend ? <i className={`lc-delta ${pend.d < 0 ? 'neg' : ''}`} key={pend.k}>{pend.d > 0 ? `+${pend.d}` : pend.d}</i> : null}
        {coarse ? <button className="lc-more" onClick={() => setOpen(true)} onPointerDown={e => { sy.current = e.clientY }} onPointerUp={e => { if (sy.current - e.clientY > 20) setOpen(true) }}
          aria-label={tx('Veneno, comandante e mais')}>☠ {p.poison}{opps && ` · ⚔ ${Math.max(0, ...Object.values(p.cmd || {}))}`}{mon ? ' 👑' : ''}{ini ? ' 🏰' : ''} <i>⌃</i></button> : controls}
      </div>
      {open && createPortal(  // por cima de tudo, rodado para quem está do outro lado da mesa
        <div className={`lc-panel-bg ${flip ? 'flip' : ''}`} onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="lc-panel" role="dialog" aria-label={tx('Contadores de {n}', { n: p.name })} style={{ '--pc': p.color }}>
            <header><b>{p.name}</b> <span className="muted">{tx('vida')} {p.life}</span><button className="close" onClick={() => setOpen(false)} aria-label={tx('Fechar')}>×</button></header>
            <div className="lc-panel-in">{controls}</div>
          </div>
        </div>, document.body)}
      {dead && <span className="lc-skull" aria-hidden="true">☠</span>}
    </div>
  )
}

function Life({ s, set, openDice }) {
  const [pend, setPend] = useState({})  // mudanças por juntar no registo: {jogador: {d, from, k}}
  const timers = useRef({})
  const [undo, setUndo] = useState(null)
  const [spot, setSpot] = useState(null)
  const players = s.players.slice(0, s.n)
  const change = (i, field, d) => {
    set(x => {
      const ps = x.players.map((p, k) => (k === i ? putF(p, field, Math.max(field === 'life' ? -999 : 0, getF(p, field) + d)) : p))  // nada abaixo de 0 a não ser a vida
      return { ...x, players: ps }
    })
    play('tick', { amount: d })
    const key = `${i}:${field}`
    setPend(o => ({ ...o, [key]: { d: (o[key]?.d || 0) + d, from: o[key]?.from ?? getF(s.players[i], field), k: (o[key]?.k || 0) + 1, i, field } }))
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      setPend(o => {
        const e = o[key]
        if (e && e.d) set(x => ({ ...x, log: [{ t: Date.now(), p: x.players[e.i].name, c: x.players[e.i].color, field: e.field, d: e.d, to: getF(x.players[e.i], e.field), ...(e.field.startsWith('cmd:') && { by: x.players[parseInt(e.field.slice(4))]?.name + (e.field.endsWith('b') ? ' ²' : '') }) }, ...x.log].slice(0, 300) }))
        const n = { ...o }; delete n[key]; return n
      })
    }, 1400)
  }
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])
  const reset = () => {
    setUndo(s)
    set(x => ({ ...x, mon: null, ini: null, players: x.players.map(p => ({ ...p, life: x.start, poison: 0, cmd: {}, tax: 0, taxb: 0 })), log: [{ t: Date.now(), reset: true }, ...x.log].slice(0, 300) }))
    play('shuffle')
  }
  const who = () => {  // quem começa: passa por todos e para num ao acaso
    const end = rnd(s.n) - 1, steps = s.n * 2 + end
    let k = 0
    const go = () => { setSpot(k % s.n); play('tick'); if (k++ < steps) setTimeout(go, 60 + k * 9); else { play('crown'); set(x => ({ ...x, log: [{ t: Date.now(), first: x.players[end].name, c: x.players[end].color }, ...x.log] })); setTimeout(() => setSpot(null), 2200) } }
    go()
  }
  const hold = (k, i) => set(x => ({ ...x, [k]: x[k] === i ? null : i, log: x[k] === i ? x.log : [{ t: Date.now(), [k]: x.players[i].name, c: x.players[i].color }, ...x.log].slice(0, 300) }))
  useEffect(() => { if (!undo) return; const k = setTimeout(() => setUndo(null), 7000); return () => clearTimeout(k) }, [undo])
  const top = s.n > 1 ? Math.floor(s.n / 2) : 0
  const rows = [players.slice(0, top), players.slice(top)].filter(r => r.length)
  return (
    <div className="lc">
      <div className="mesa-bar">
        <span className="seg">{[1, 2, 3, 4, 5, 6].map(n => <button key={n} className={s.n === n ? 'on' : ''} onClick={() => set(x => ({ ...x, n }))} aria-label={tx('{n} jogadores', { n })}>{n}</button>)}</span>
        <label className="small">{tx('Vida inicial')} <select value={s.start} onChange={e => set(x => ({ ...x, start: +e.target.value }))}>{[20, 25, 30, 40, 50, 60].map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="chk small"><input type="checkbox" checked={s.face} onChange={e => set(x => ({ ...x, face: e.target.checked }))} /> {tx('Frente a frente')}</label>
        <label className="chk small" title={tx('Dano de comandante por adversário: 21 do mesmo comandante e perde-se o jogo')}><input type="checkbox" checked={!!s.cmdr} onChange={e => { const on = e.target.checked; set(x => ({ ...x, cmdr: on, ...(on && x.start < 40 && { start: 40, players: x.players.map(p => ({ ...p, life: p.life === x.start ? 40 : p.life })) }) })) }} /> ⚔ {tx('Commander')}</label>
        {s.cmdr && <label className="chk small" title={tx('Ao somar dano de comandante, tira também essa vida ao jogador')}><input type="checkbox" checked={s.cmdLife !== false} onChange={e => set(x => ({ ...x, cmdLife: e.target.checked }))} /> {tx('tira também vida')}</label>}
        <button onClick={who}>👑 {tx('Quem começa')}</button>
        <button onClick={openDice}>🎲 {tx('Dados')}</button>
        <button className="primary" onClick={reset}>↺ {tx('Novo jogo')}</button>
        {undo && <button className="link" onClick={() => { set(undo); setUndo(null) }}>{tx('desfazer')}</button>}
      </div>
      <div className={`lc-table n${s.n}`}>
        {rows.map((r, ri) => (
          <div key={ri} className="lc-row">{r.map(p => { const i = s.players.indexOf(p); return (
            <Player key={i} p={p} i={i} flip={s.face && rows.length > 1 && ri === 0} spot={spot === i} pend={pend[`${i}:life`] && { d: pend[`${i}:life`].d, k: pend[`${i}:life`].k }}
              onLife={(k, d) => change(k, 'life', d)} onPoison={(k, d) => { change(k, 'poison', d); if (d > 0) play('poison') }}
              opps={s.cmdr ? players.filter(q => q !== p).map(q => ({ i: s.players.indexOf(q), name: q.name, color: q.color, partner: !!q.partner })) : null}
              cmdr={!!s.cmdr} mon={s.mon === i} ini={s.ini === i} onMon={k => hold('mon', k)} onIni={k => hold('ini', k)}
              onTax={(k, f, d) => { if (d > 0 || getF(s.players[k], f)) change(k, f, d) }} onPartner={k => set(x => ({ ...x, players: x.players.map((q, j) => (j === k ? { ...q, partner: !q.partner } : q)) }))}
              onCmd={(k, j, d) => { if (d < 0 && !getF(s.players[k], `cmd:${j}`)) return; change(k, `cmd:${j}`, d); if (s.cmdLife !== false) change(k, 'life', -d) }} onName={(k, name) => set(x => ({ ...x, players: x.players.map((q, j) => (j === k ? { ...q, name } : q)) }))} />
          ) })}</div>
        ))}
      </div>
      <Log title={tx('Registo da vida')} empty={tx('As mudanças de vida, veneno e dano de comandante aparecem aqui.')} onClear={async () => (await ask('registo', { title: tx('Limpar o registo da vida?'), ok: tx('Limpar') })) && set(x => ({ ...x, log: [] }))} items={s.log.map((e, k) => (
        <li key={k}><time>{hhmm(e.t)}</time> {e.reset ? <b>↺ {tx('Novo jogo')}</b> : e.first ? <span><i className="dot" style={{ background: e.c }} /> 👑 {tx('{n} começa', { n: e.first })}</span>
          : e.mon ? <span><i className="dot" style={{ background: e.c }} /> 👑 {tx('{n} é o monarca', { n: e.mon })}</span>
          : e.ini ? <span><i className="dot" style={{ background: e.c }} /> 🏰 {tx('{n} tem a iniciativa', { n: e.ini })}</span>
          : e.field?.startsWith('tax') ? <span><i className="dot" style={{ background: e.c }} /> {e.p} {tx('imposto')}{e.field === 'taxb' ? ' ²' : ''} → <b>+{2 * e.to}</b></span>
          : <span><i className="dot" style={{ background: e.c }} /> {e.p} <b className={e.d < 0 ? 'neg' : 'pos'}>{e.d > 0 ? `+${e.d}` : e.d}</b> {e.field === 'poison' ? `☠ → ${e.to}` : e.by ? `⚔ ${tx('de {n}', { n: e.by })} → ${e.to}` : `→ ${e.to}`}</span>}</li>
      ))} />
    </div>
  )
}

function Log({ title, empty, items, onClear }) {
  const [open, setOpen] = useState(true)
  return (
    <section className={`mesa-log ${open ? 'on' : ''}`}>
      <header><button className="link plain" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {title} <span className="muted small">{items.length}</span></button>
        {items.length > 0 && <button className="link small" onClick={onClear}>🗑 {tx('limpar registo')}</button>}</header>
      {open && (items.length ? <ol>{items}</ol> : <p className="muted small">{empty}</p>)}
    </section>
  )
}

// ---------------- dados ----------------
const DICE = {
  d4: { n: 4, c: ['#ff8a7a', '#b3261e'], shape: <polygon points="50,6 95,88 5,88" />, ty: 68 },
  d6: { n: 6, c: ['#fff6e6', '#cdb894'], shape: <rect x="8" y="8" width="84" height="84" rx="16" />, ty: 60, ink: '#3a2a10' },
  d8: { n: 8, c: ['#8ff0b0', '#1d7d48'], shape: <><polygon points="50,3 96,50 50,97 4,50" /><path d="M4 50H96" className="edge" /></>, ty: 60 },
  d10: { n: 10, c: ['#d0a6ff', '#5d2bb0'], shape: <><polygon points="50,3 94,42 50,97 6,42" /><path d="M6 42L50 58L94 42M50 58V97" className="edge" /></>, ty: 50 },
  d12: { n: 12, c: ['#ffc98a', '#c0601a'], shape: <><polygon points="50,4 95,37 78,93 22,93 5,37" /><polygon points="50,24 74,42 65,72 35,72 26,42" className="edge" /></>, ty: 58 },
  d20: { n: 20, c: ['#8cc8ff', '#1f4fb8'], shape: <><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" /><polygon points="50,20 80,70 20,70" className="edge" /></>, ty: 60 },
  d100: { n: 100, c: ['#86f0e4', '#127a70'], shape: <><polygon points="50,3 94,42 50,97 6,42" /><path d="M6 42L50 58L94 42M50 58V97" className="edge" /></>, ty: 50, small: true },
  moeda: { n: 2, c: ['#ffe9a3', '#b8860b'], shape: <circle cx="50" cy="50" r="45" />, ty: 58, coin: true },
}
const PIPS = { 1: [[50, 50]], 2: [[30, 30], [70, 70]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[30, 30], [70, 30], [30, 70], [70, 70]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]] }
const face = (type, v) => (type === 'moeda' ? (v === 1 ? tx('Cara') : tx('Coroa')) : String(v))
const DICE0 = { pool: { d20: 1 }, log: [] }

function DieFace({ type, v }) {
  const D = DICE[type], id = `dg-${type}`
  return (
    <svg viewBox="0 0 100 100" className="die-svg" aria-hidden="true">
      <defs><radialGradient id={id} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor={D.c[0]} /><stop offset="1" stopColor={D.c[1]} /></radialGradient></defs>
      <g fill={`url(#${id})`} stroke="#0006" strokeWidth="2">{D.shape}</g>
      {type === 'd6' ? PIPS[v]?.map(([x, y], k) => <circle key={k} cx={x} cy={y} r="8.5" fill={D.ink} />)
        : <text x="50" y={D.ty} textAnchor="middle" dominantBaseline="middle" className={`die-n ${D.small || D.coin ? 'sm' : ''}`} fill={D.ink || '#fff'}>{face(type, v)}</text>}
      {type !== 'd6' && type !== 'moeda' && needsMark(v, D.n) && <rect x={50 - (String(v).length > 1 ? 13 : 8)} y={D.ty + (D.small ? 10 : 15)} width={String(v).length > 1 ? 26 : 16} height="3.4" rx="1.7" fill={D.ink || '#fff'} />}
    </svg>
  )
}

const COLORS3D = Object.fromEntries(Object.entries(DICE).map(([k, d]) => [k, [d.c[0], d.c[1], d.ink || '#ffffff']]))

function Dice({ s, set, compact = false }) {
  const tray = useRef(null), els = useRef({}), bodies = useRef([]), raf = useRef(0)
  const [live, setLive] = useState([])  // dados na mesa: {id, type, v, done}
  const [last, setLast] = useState(null)
  // 3D (three.js + dicephys.js), carregado só quando é preciso; sem WebGL fica o 2D
  const [gl] = useState(() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } })
  const d3 = gl && s.d3 !== false
  const box = useRef(null), t3 = useRef(null), [res3, setRes3] = useState(null), [busy3, setBusy3] = useState(false)
  useEffect(() => {
    if (!d3) return
    let gone = false
    import('./Dice3D.js').then(({ createTray }) => {
      if (gone || !box.current) return
      t3.current = createTray(box.current, {
        colors: COLORS3D, words: [tx('Cara'), tx('Coroa')],
        onHit: a => play('diceHit', { amount: a }),
        onSettle: items => {
          setRes3(items); setBusy3(false); play('tick', { amount: 1 })
          if (items.some(x => x.type === 'moeda')) play('coin')
          set(x => ({ ...x, log: [{ t: Date.now(), items, sum: items.filter(i => i.type !== 'moeda').reduce((a, i) => a + i.v, 0) }, ...x.log].slice(0, 200) }))
        },
      })
    })
    return () => { gone = true; t3.current?.dispose(); t3.current = null }
  }, [d3]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (type, d) => set(x => { const n = Math.max(0, Math.min(12, (x.pool[type] || 0) + d)); const pool = { ...x.pool, [type]: n }; if (!n) delete pool[type]; return { ...x, pool } })
  const count = Object.values(s.pool).reduce((a, b) => a + b, 0)
  const roll = pool => {
    if (d3) {
      const list = Object.entries(pool).flatMap(([type, n]) => Array.from({ length: n }, () => type)).slice(0, 12)
      if (!list.length || !t3.current) return
      setRes3(null); setBusy3(true); setLast(pool); play('dice', { amount: list.length }); t3.current.roll(list)
      return
    }
    const W = tray.current.clientWidth, H = tray.current.clientHeight
    const list = Object.entries(pool).flatMap(([type, n]) => Array.from({ length: n }, () => type)).slice(0, 12)
    if (!list.length) return
    cancelAnimationFrame(raf.current)
    const size = Math.max(46, Math.min(72, W / 7))
    bodies.current = list.map((type, k) => ({
      id: `${Date.now()}-${k}`, type, r: size / 2, x: W / 2 + (Math.random() - 0.5) * W * 0.5, y: H - size, vx: (Math.random() - 0.5) * 900, vy: -(650 + Math.random() * 650),
      a: Math.random() * 360, va: (Math.random() < 0.5 ? -1 : 1) * (500 + Math.random() * 700), v: rnd(DICE[type].n), still: 0, done: false, trav: 0, hit: 0, flip: 0,
    }))
    setLive(bodies.current.map(b => ({ id: b.id, type: b.type, v: rnd(DICE[b.type].n), done: false, size })))  // a face final só aparece quando o dado pára
    setLast(pool)
    play('dice', { amount: list.length })
    let t0 = performance.now()
    const step = now => {
      const dt = Math.min(0.033, (now - t0) / 1000); t0 = now
      const bs = bodies.current
      for (const b of bs) {
        if (b.done) continue
        b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt
        const f = Math.exp(-1.9 * dt); b.vx *= f; b.vy *= f; b.va *= Math.exp(-2.2 * dt)
        b.trav += Math.hypot(b.vx, b.vy) * dt
        for (const [p, lo, hi, vk] of [['x', b.r, W - b.r, 'vx'], ['y', b.r, H - b.r, 'vy']]) {
          if (b[p] < lo || b[p] > hi) {
            b[p] = b[p] < lo ? lo : hi; const sp = Math.abs(b[vk]); b[vk] *= -0.62; b.va += (Math.random() - 0.5) * sp
            if (sp > 140 && now - b.hit > 90) { b.hit = now; play('diceHit', { amount: sp / 900 }) }
          }
        }
      }
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {  // choques entre dados (massas iguais)
        const A = bs[i], B = bs[j], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, min = A.r + B.r - 4
        if (d >= min) continue
        const nx = dx / d, ny = dy / d, push = (min - d) / 2
        A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push
        const rel = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny
        if (rel > 0) { const k = rel * 0.85; A.vx -= k * nx; A.vy -= k * ny; B.vx += k * nx; B.vy += k * ny; A.done = B.done = false; if (rel > 160) play('diceHit', { amount: rel / 900 }) }
      }
      let moving = false
      const faces = {}, settled = new Set()
      for (const b of bs) {
        const el = els.current[b.id]
        if (!b.done) {
          const sp = Math.hypot(b.vx, b.vy)
          if (b.trav > 26) { b.trav = 0; if (sp > 60) faces[b.id] = rnd(DICE[b.type].n) }  // a rolar: a face muda conforme anda
          b.still = sp < 22 && Math.abs(b.va) < 45 ? b.still + dt : 0
          if (b.still > 0.12) { b.done = true; b.vx = b.vy = b.va = 0; settled.add(b.id) } else moving = true
        }
        if (el) el.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px) rotate(${b.a}deg)${DICE[b.type].coin && !b.done ? ` scaleX(${Math.cos(b.a / 18).toFixed(2)})` : ''}`
      }
      if (settled.size || Object.keys(faces).length) {
        setLive(L => L.map(x => (settled.has(x.id) ? { ...x, done: true, v: bs.find(b => b.id === x.id).v } : faces[x.id] ? { ...x, v: faces[x.id] } : x)))
        if (settled.size) play('tick', { amount: 1 })
      }
      if (moving) raf.current = requestAnimationFrame(step)
      else {
        const items = bs.map(b => ({ type: b.type, v: b.v }))
        if (items.some(x => x.type === 'moeda')) play('coin')
        set(x => ({ ...x, log: [{ t: Date.now(), items, sum: items.filter(i => i.type !== 'moeda').reduce((a, i) => a + i.v, 0) }, ...x.log].slice(0, 200) }))
      }
    }
    raf.current = requestAnimationFrame(step)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const rolling = d3 ? busy3 : live.some(d => !d.done)
  const sum = live.filter(d => d.done && d.type !== 'moeda').reduce((a, d) => a + d.v, 0)
  return (
    <div className={`dc ${compact ? 'compact' : ''}`}>
      <div className="dc-pick">
        {Object.keys(DICE).map(type => (
          <span key={type} className={`dc-type ${s.pool[type] ? 'on' : ''}`}>
            <button className="dc-add" onClick={() => add(type, 1)} title={tx('Juntar um {d}', { d: type })}><DieFace type={type} v={type === 'moeda' ? 1 : DICE[type].n} /><b>{type === 'moeda' ? tx('moeda') : type}</b></button>
            {s.pool[type] > 0 && <><i className="dc-n">{s.pool[type]}</i><button className="dc-rm" onClick={() => add(type, -1)} aria-label={tx('Tirar um {d}', { d: type })}>−</button></>}
          </span>
        ))}
      </div>
      <div className="mesa-bar">
        <button className="primary dc-go" disabled={!count || rolling} onClick={() => roll(s.pool)}>🎲 {tx('Lançar')} {count > 0 && <small>{Object.entries(s.pool).map(([t, n]) => `${n}×${t === 'moeda' ? tx('moeda') : t}`).join(' + ')}</small>}</button>
        <button disabled={rolling} onClick={() => roll({ d20: 1 })}>d20</button>
        <button disabled={rolling} onClick={() => roll({ d6: 2 })}>2d6</button>
        <button disabled={rolling} onClick={() => roll({ moeda: 1 })}>{tx('moeda')}</button>
        {last && <button disabled={rolling} onClick={() => roll(last)}>↻ {tx('Repetir')}</button>}
        <button className="link" onClick={() => { cancelAnimationFrame(raf.current); setLive([]); t3.current?.clear(); setRes3(null); setBusy3(false); set(x => ({ ...x, pool: {} })) }}>{tx('limpar a mesa')}</button>
        {gl && <span className="seg small dc-mode" role="group" aria-label={tx('Vista dos dados')}>{[[true, '3D'], [false, '2D']].map(([v, l]) => <button key={l} className={d3 === v ? 'on' : ''} onClick={() => { setLive([]); setRes3(null); setBusy3(false); set(x => ({ ...x, d3: v })) }}>{l}</button>)}</span>}
      </div>
      {d3 ? <div className="dc-tray dc-3d" ref={box}>
        {!res3 && !busy3 && <p className="dc-hint muted">{tx('Escolhe os dados acima e carrega em «Lançar». Depois podes agarrar um dado com o rato ou o dedo e atirá-lo outra vez. O d100 são dois d10: dezenas (00–90) e unidades.')}</p>}
      </div> : <div className="dc-tray" ref={tray}>
        {!live.length && <p className="dc-hint muted">{tx('Escolhe os dados acima e carrega em «Lançar».')}</p>}
        {live.map(d => (
          <div key={d.id} ref={el => { els.current[d.id] = el }} className={`die ${d.done ? 'done' : ''} ${d.done && d.type === 'd20' && d.v === 20 ? 'crit' : ''} ${d.done && d.type === 'd20' && d.v === 1 ? 'fumble' : ''}`} style={{ width: d.size, height: d.size }}>
            <DieFace type={d.type} v={d.v} />
          </div>
        ))}
        {live.length > 0 && !rolling && live.some(d => d.type !== 'moeda') && <div className="dc-sum">{live.filter(d => d.type !== 'moeda').length > 1 ? `Σ ${sum}` : sum}</div>}
      </div>}
      {d3 && <div className="dc-res3" aria-live="polite">{busy3 ? <span className="muted">{tx('a rolar…')}</span> : res3 && <>{res3.map((x, k) => <span key={k} className={`dl ${x.type === 'd20' && x.v === 20 ? 'crit' : x.type === 'd20' && x.v === 1 ? 'fumble' : ''}`} title={x.parts ? tx('d100 = dois d10: dezenas e unidades') : undefined}><small>{x.type === 'moeda' ? '🪙' : x.type}</small> {face(x.type, x.v)}{x.parts && <small> ({String(x.parts[0]).padStart(2, '0')} + {x.parts[1]})</small>}</span>)}
        {res3.filter(x => x.type !== 'moeda').length > 1 && <b className="dc-res3-sum">Σ {res3.filter(x => x.type !== 'moeda').reduce((a, x) => a + x.v, 0)}</b>}</>}</div>}
      <Log title={tx('Registo dos dados')} empty={tx('Cada lançamento fica aqui.')} onClear={async () => (await ask('registo', { title: tx('Limpar o registo dos dados?'), ok: tx('Limpar') })) && set(x => ({ ...x, log: [] }))} items={s.log.map((e, k) => (
        <li key={k}><time>{hhmm(e.t)}</time> {e.items.map((it, j) => <span key={j} className={`dl ${it.type === 'd20' && it.v === 20 ? 'crit' : it.type === 'd20' && it.v === 1 ? 'fumble' : ''}`}><small>{it.type === 'moeda' ? '🪙' : it.type}</small> {face(it.type, it.v)}</span>)}
          {e.items.filter(i => i.type !== 'moeda').length > 1 && <b> = {e.sum}</b>}</li>
      ))} />
    </div>
  )
}

export default function Mesa({ tool, setTool, onHome, onApp }) {
  const [life, setLife] = useStored('grimorio.vida', LIFE0)
  const [dice, setDice] = useStored('grimorio.dados', DICE0)
  const [sheet, setSheet] = useState(false)  // dados por cima do contador
  return (
    <div className={`mesa mesa-${tool}`}>
      <header className="mesa-top">
        <button className="link plain mesa-logo" onClick={onHome} title={tx('Início')}><Logo size={28} /> Grimório</button>
        <span className="seg">
          <button className={tool === 'vida' ? 'on' : ''} onClick={() => setTool('vida')}>❤ {tx('Vida')}</button>
          <button className={tool === 'dados' ? 'on' : ''} onClick={() => setTool('dados')}>🎲 {tx('Dados')}</button>
        </span>
        <button className="link small" onClick={onApp}>{tx('abrir os decks →')}</button>
      </header>
      {tool === 'vida' ? <Life s={life} set={setLife} openDice={() => setSheet(true)} /> : <Dice s={dice} set={setDice} />}
      {sheet && tool === 'vida' && (
        <div className="mesa-sheet" onClick={e => { if (e.target === e.currentTarget) setSheet(false) }}>
          <div className="mesa-sheet-in"><button className="close" onClick={() => setSheet(false)} aria-label={tx('Fechar')}>×</button><Dice s={dice} set={setDice} compact /></div>
        </div>
      )}
    </div>
  )
}
