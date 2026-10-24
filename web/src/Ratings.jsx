// Ratings: decks por escalões (6★…0★) com ranking dentro de cada um, histórico de cada deck e a Arena automática,
// que põe o Forge a jogar rondas ao calhas (os meus decks e os do meta) para encher os registos. Normal (por formato,
// ou «Todos») e Casual (um só grupo: jogos em modo casual e decks casuais).
import { useEffect, useRef, useState } from 'react'
import { FORMAT } from './formats.js'
import { Empty, Stars, PROV_TIP } from './ui.jsx'
import { img, HUE, coverOf, colorsOf } from './data.js'
import Replay from './Board.jsx'
import { DIFF_INFO } from './difficulty.js'
import { tx, LOCALE } from './i18n.js'

const j = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const x = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(x.erro || `HTTP ${r.status}`))
  return x
}
const META_FMTS = ['pauper', 'modern', 'pioneer', 'standard', 'legacy', 'vintage', 'premodern', 'commander', 'duel']
const STEPS = Array.from({ length: 13 }, (_, i) => i / 2)
const fmtName = f => FORMAT[f]?.name || f
const pct = x => (x == null ? '—' : `${Math.round(x)}%`)
const num = x => x.toLocaleString(LOCALE)
const dLabel = d => DIFF_INFO[d.id]?.label || d.label  // o nosso rótulo (traduzido) quando o conhecemos
const when = ts => new Date(ts * 1000).toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const SRC = { lab: tx('Laboratório'), torneio: tx('Torneio'), arena: 'Arena' }

// curva do Elo (a tracejado: 1500, o ponto de partida)
function Spark({ elo }) {
  if (elo.length < 2) return null
  const lo = Math.min(...elo, 1500) - 10, hi = Math.max(...elo, 1500) + 10, W = 300, H = 70
  const x = i => (i / (elo.length - 1)) * W, y = v => H - 4 - ((v - lo) / (hi - lo)) * (H - 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={tx('Elo de {a} a {b}', { a: Math.round(elo[0]), b: Math.round(elo.at(-1)) })}>
      <line x1="0" x2={W} y1={y(1500)} y2={y(1500)} stroke="#ffffff30" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline points={elo.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--gold)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function History({ k, format }) {
  const [h, setH] = useState(null)
  useEffect(() => { j(`/api/ratings/deck/${encodeURIComponent(k)}?format=${format}`).then(setH).catch(() => setH({ elo: [], rounds: [] })) }, [k, format])
  if (!h) return <div className="rt-hist muted small">{tx('A carregar…')}</div>
  return (
    <div className="rt-hist">
      <div className="muted small">Elo: {Math.round(h.elo[0])} → <b>{Math.round(h.elo.at(-1))}</b> {tx('em {n} jogo|em {n} jogos', { n: h.elo.length - 1 })}</div>
      <Spark elo={h.elo} />
      <ul>{h.rounds.map(r => {
        const res = r.w > r.l ? ['w', tx('V')] : r.l > r.w ? ['l', tx('D')] : ['d', tx('E')]
        return <li key={r.round_id}><span className={`res-${res[0]}`}>{res[1]}</span><span>{r.opp_name}</span><span className="muted">{r.w}–{r.l}{r.d ? `–${r.d}` : ''}</span><span className="muted small">{SRC[r.source] || r.source} · {when(r.ts)}</span></li>
      })}</ul>
    </div>
  )
}

function Row({ r, data, open, onOpen, showFmt }) {
  const c = r.deck?.main ? coverOf(r.deck, data) : null, cols = r.deck?.main ? colorsOf(r.deck, data) : []
  const edge = cols.length ? cols.map(x => HUE[x]) : ['#8a8a99']
  return (
    <li>
      <button className={`rt-row ${open ? 'on' : ''}`} onClick={onOpen} aria-expanded={open}>
        <span className="rt-rank">#{r.rank_in_tier}<small>{tx('{p}.º geral', { p: r.rank })}</small></span>
        <span className="rt-art" style={{ '--edge': edge.length > 1 ? `linear-gradient(135deg, ${edge.join(', ')})` : edge[0] }}>{c ? <img src={img(c, 'art_crop')} alt="" loading="lazy" /> : <span>✦</span>}</span>
        <span className="rt-name"><b title={r.name}>{r.name}</b>
          <span><Stars r={{ ...r, prov: r.provisional, elo: Math.round(r.elo) }} /><i className={`badge ${r.community ? 'com' : r.kind}`}>{r.community ? tx('comunidade') : r.kind === 'meu' ? tx('meu') : 'meta'}</i>{showFmt && <i className="badge">{fmtName(r.format === 'casual' ? r.deck_format : r.format)}</i>}{r.provisional && <i className="badge prov" title={PROV_TIP}>{tx('provisório')}</i>}</span></span>
        <span className="rt-num wide">{Math.round(r.elo)}<small>Elo</small></span>
        <span className="rt-num">{r.wins}-{r.losses}{r.draws ? `-${r.draws}` : ''} <b>{pct(r.win_pct)}</b><small>{tx('jogos')}</small></span>
        <span className="rt-num wide">{r.rounds ? <>{r.round_wins}-{r.round_losses} <b>{pct(r.round_pct)}</b></> : '—'}<small>{tx('rondas')}</small></span>
      </button>
      {open && <History k={r.key} format={r.format} />}
    </li>
  )
}

// Ver ao vivo o jogo da Arena: lê o registo em curso do Forge (job.live) de 2 em 2 s e segue para o jogo seguinte
function LiveArena({ data, a, onClose }) {
  const id = a.cur?.job?.id
  const [game, setGame] = useState(null)
  useEffect(() => {
    if (!id) return
    let off = false
    const base = { opp: a.cur.b, g: a.cur.wa + a.cur.wb + 1, turns: 0 }
    const tick = () => j(`/api/sim/jobs/${id}`).then(x => {
      if (off) return
      if (x.status === 'done' && x.games?.length) setGame({ ...x.games[x.games.length - 1], ...base, key: id })
      else setGame({ events: x.live?.events || [], exact: true, inProgress: true, winner: null, ...base, key: id })
    }).catch(() => {})
    tick()
    const t = setInterval(tick, 2000)
    return () => { off = true; clearInterval(t) }
  }, [id])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-bg live-arena" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal la-box">
        {!id ? <p className="muted">{a.on ? tx('A Arena não tem nenhum jogo a decorrer agora (está entre rondas ou à espera de vez). Esta janela segue o próximo assim que começar.') : tx('A Arena não tem nenhum jogo a decorrer agora (está desligada). Esta janela segue o próximo assim que começar.')}</p>
          : !game ? <p className="muted"><span className="spin-dot" /> {tx('A ligar ao jogo…')}</p>
            : <Replay key={game.key} data={data} game={game} live={!!game.inProgress} deckName={a.cur.a} pov={null} arts={a.cur.arts} onBack={onClose} backLabel={tx('× Fechar')} />}
        {!id && <button onClick={onClose}>{tx('Fechar')}</button>}
      </div>
    </div>
  )
}

function Arena({ data, fmts, onRound }) {
  const [a, setA] = useState(null)
  const [watch, setWatch] = useState(false)
  const [diffs, setDiffs] = useState([])
  const [err, setErr] = useState('')
  const last = useRef(null)
  useEffect(() => {
    let off = false
    const tick = () => j('/api/arena').then(x => { if (!off) setA(x) }).catch(() => {})
    tick(); j('/api/sim/difficulties').then(setDiffs).catch(() => {})
    const t = setInterval(tick, 3000)
    return () => { off = true; clearInterval(t) }
  }, [])
  const stamp = a && `${a.played}-${a.last[0]?.ts}-${a.cur?.wa}-${a.cur?.wb}`
  useEffect(() => { if (stamp && last.current && last.current !== stamp) onRound(); last.current = stamp }, [stamp, onRound])
  if (!a) return null
  const set = v => { setErr(''); setA(x => ({ ...x, ...v })); j('/api/arena', v).then(setA).catch(e => setErr(e.message)) }
  const allF = [...new Set([...META_FMTS, ...fmts, ...a.formats])]
  const job = a.cur?.job
  return (
    <section className="card">
      <h3>{tx('Arena automática')} <span className="muted small">{tx('o Forge joga rondas ao calhas para criar registos e ratings')}</span>
        <button className="la-btn" onClick={() => setWatch(true)} title={tx('Ver o jogo da Arena a decorrer, no tabuleiro')}>{tx('👁 Ver ao vivo')}{job?.status === 'running' ? ' ●' : ''}</button></h3>
      {watch && <LiveArena data={data} a={a} onClose={() => setWatch(false)} />}
      <div className="arena-grid">
        <label>{tx('Modo')}<span className="seg">{[[false, tx('Normais')], [true, tx('Casuais')]].map(([k, l]) => <button key={l} className={!!a.casual === k ? 'on' : ''} onClick={() => set({ casual: k })} title={k ? tx('Decks dos formatos escolhidos misturados (e os teus decks casuais), com as regras base do formato do 1.º deck; contam para o rating casual') : tx('Cada ronda num formato, entre decks desse formato; contam para o rating normal')}>{l}</button>)}</span></label>
        <label>Decks<span className="seg">{[['meu', tx('🧙 Meus')], ['com', tx('🌐 Comunidade')], ['meta', tx('📊 Meta')]].map(([k, l]) => { const on = a.sources.includes(k); return <button key={k} className={on ? 'on' : ''} aria-pressed={on} onClick={() => set({ sources: on ? (a.sources.length > 1 ? a.sources.filter(x => x !== k) : a.sources) : [...a.sources, k] })}>{l}</button> })}</span></label>
        <label>{tx('Estrelas')}<span className="row-btns">{tx('de')} <select value={a.min} onChange={e => set({ min: +e.target.value, max: Math.max(a.max, +e.target.value) })}>{STEPS.map(s => <option key={s} value={s}>{num(s)}★</option>)}</select>
          {tx('a')} <select value={a.max} onChange={e => set({ max: +e.target.value, min: Math.min(a.min, +e.target.value) })}>{STEPS.map(s => <option key={s} value={s}>{num(s)}★</option>)}</select></span></label>
        <label>{tx('Ronda')}<span className="seg">{[1, 3].map(b => <button key={b} className={a.bo === b ? 'on' : ''} onClick={() => set({ bo: b })}>Bo{b}</button>)}</span></label>
        <label>{tx('Dificuldade')}<select value={a.difficulty} onChange={e => set({ difficulty: e.target.value })}>{diffs.map(d => <option key={d.id} value={d.id}>{dLabel(d)}</option>)}</select></label>
        <label>{tx('Pausa entre rondas')}<select value={a.pause} onChange={e => set({ pause: +e.target.value })}>{[0, 5, 10, 30, 60, 120, 300, 600].map(s => <option key={s} value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>)}</select></label>
        <label>{tx('Parar ao fim de')}<select value={a.max_rounds} onChange={e => set({ max_rounds: +e.target.value })}>{[0, 5, 10, 20, 50, 100, 200].map(n => <option key={n} value={n}>{n ? tx('{n} ronda|{n} rondas', { n }) : tx('sem limite')}</option>)}</select></label>
        <label>{tx('No máximo')}<select value={a.per_hour} onChange={e => set({ per_hour: +e.target.value })}>{[2, 5, 10, 20, 30, 60].map(n => <option key={n} value={n}>{tx('{n} rondas por hora', { n })}</option>)}</select></label>
      </div>
      {a.casual && <p className="muted small" style={{ margin: '0 0 6px' }}>{tx('Rondas casuais: os decks de todos os formatos marcados jogam entre si (os teus decks casuais também) e contam só para o rating casual.')}</p>}
      <div className="arena-fmts">{allF.map(f => <label key={f}><input type="checkbox" checked={a.formats.includes(f)} onChange={e => set({ formats: e.target.checked ? [...a.formats, f] : a.formats.filter(x => x !== f) })} /> {fmtName(f)}</label>)}</div>
      <div className="row-btns" style={{ margin: '10px 0' }}>
        <button className={a.on ? '' : 'primary'} onClick={() => set({ on: !a.on })} disabled={!a.on && !a.formats.length}>{a.on ? tx('■ Desligar a Arena') : tx('▶ Ligar a Arena')}</button>
        <span className="muted small">{tx('Só joga com o simulador parado: um teste teu, um torneio ou um jogo contra o Forge passam sempre à frente (o jogo da Arena é cancelado e repetido depois).')}</span>
      </div>
      {err && <p className="small bad-t">{err}</p>}
      <div className="arena-live" aria-live="polite">
        <div><span className={`on-dot ${a.on ? 'on' : ''}`} /><b>{a.on ? tx('Ligada') : tx('Desligada')}</b>{a.state && a.state !== 'Desligada.' && <span className="muted"> · {tx(a.state)}</span>}</div>
        {a.cur?.a && <div><span className="muted">{a.on ? tx('Ronda:') : tx('Ronda por acabar:')}</span> {a.cur.format === 'casual' ? tx('Casual (regras de {f})', { f: fmtName(a.cur.base) }) : fmtName(a.cur.format)} · <b>{a.cur.a}</b> {a.cur.a_stars != null && <Stars v={a.cur.a_stars} />} {tx('contra')} <b>{a.cur.b}</b> {a.cur.b_stars != null && <Stars v={a.cur.b_stars} />} · {a.cur.wa}–{a.cur.wb} (Bo{a.cur.bo}){job && <span className="muted"> · {job.status === 'queued' ? tx('na fila ({p})', { p: job.position }) : tx('a jogar há {s} s', { s: job.secs })}</span>}</div>}
        {a.error && <div className="small bad-t">{tx(a.error)}</div>}
        <div className="muted small">{tx('Hoje: {t} rondas · desde que foi ligada: {p}', { t: a.today, p: a.played })}{a.avg_secs ? ` · ${tx('{s} s por ronda em média', { s: a.avg_secs })}` : ''}</div>
        {a.last.length > 0 && <ul className="arena-last small">{a.last.map((r, i) => (
          <li key={i}><span><b className={r.wa > r.wb ? 'res-w' : ''}>{r.a}</b> {r.wa}–{r.wb}{r.draws ? `–${r.draws}` : ''} <b className={r.wb > r.wa ? 'res-w' : ''}>{r.b}</b>{r.open ? ` · ${tx('a decorrer')}` : ''}</span><span className="muted">{fmtName(r.format)} · {when(r.ts)}</span></li>
        ))}</ul>}
      </div>
    </section>
  )
}

export default function Ratings({ data, fmt }) {
  const [f, setF] = useState(() => (META_FMTS.includes(fmt.key) ? fmt.key : 'pauper'))
  const [cas, setCas] = useState(false)  // rating casual (um só grupo de todos os formatos)
  const [res, setRes] = useState(null)
  const [open, setOpen] = useState(null)
  const [n, setN] = useState(0)
  const [by, setBy] = useState('stars')  // ordenar e agrupar por: amarelo (normal), azul (todos os jogos) ou vermelho (objetivo)
  const first = useRef(true)
  useEffect(() => {
    j(`/api/ratings?format=${cas ? 'casual' : f}`).then(x => {
      if (first.current && !x.rows.length && x.formats.length) setF(x.formats[0])  // abre num formato que já tem jogos
      first.current = false
      setRes(x)
    }).catch(() => setRes({ rows: [], formats: [] }))
  }, [f, n, cas])
  const val = r => r[by] ?? -1
  const rows = by === 'stars' ? res?.rows || [] : [...res?.rows || []].sort((a, b) => val(b) - val(a) || b.elo - a.elo).map((r, i) => ({ ...r, rank: i + 1, tier: Math.floor(val(r)) }))
  const tiers = [6, 5, 4, 3, 2, 1, 0, -1].map(t => [t, rows.filter(r => r.tier === t).map((r, i) => (by === 'stars' ? r : { ...r, rank_in_tier: i + 1 }))]).filter(([, rs]) => rs.length)
  const where = cas ? tx('no rating casual') : f === 'all' ? tx('em nenhum formato') : tx('em {f}', { f: fmtName(f) })
  const fmts = [...new Set([...META_FMTS, ...(res?.formats || []), fmt.key])]
  return (
    <div className="view ratings">
      <section className="card">
        <div className="rt-top">
          <h3 style={{ margin: 0 }}>📊 Ratings</h3>
          <span className="seg">{[[false, tx('Normal')], [true, tx('Casual')]].map(([k, l]) => <button key={l} className={cas === k ? 'on' : ''} onClick={() => { setCas(k); setOpen(null) }}>{l}</button>)}</span>
          {!cas && <select value={f} onChange={e => { setF(e.target.value); setOpen(null) }} aria-label={tx('Formato')}><option value="all">{tx('Todos os formatos')}</option>{fmts.map(x => <option key={x} value={x}>{fmtName(x)}{res?.formats?.includes(x) ? ' ●' : ''}</option>)}</select>}
          <select value={by} onChange={e => setBy(e.target.value)} aria-label={tx('Ordenar por')}>{[['stars', tx('Ordenar: normal')], ['blue', tx('Ordenar: todos os jogos')], ['red', tx('Ordenar: objetivo')]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="muted small">{tx('{k} decks com jogos', { k: rows.length })} · {cas ? tx('Casual: jogos em modo casual (formatos misturados) e decks casuais, todos no mesmo grupo') : f === 'all' ? tx('Todos: cada deck com as estrelas do seu formato') : tx('Normal: só jogos legais do formato')} · {tx('Elo jogo a jogo (1500 ao começar)')} · {cas ? tx('estrelas de 0,0 a 6,0 = a probabilidade de ganhar a um deck médio nos jogos casuais (pelo Elo): 3★ ganha metade, 6★ ganha sempre') : tx('estrelas de 0,0 a 6,0 = a probabilidade de ganhar a um deck médio do formato (pelo Elo): 3★ ganha metade, 6★ ganha sempre')} · <abbr title={PROV_TIP}>{tx('mais claras = provisório')}</abbr>: {tx('menos de {p} jogos, o rating ainda mexe muito', { p: res?.prov || 10 })}</span>
        </div>
        {res && !rows.length && <Empty>{tx('Ainda não há jogos com rating {w}.', { w: where })} {cas ? tx('Liga a Arena automática com rondas casuais, corre testes 1 contra 1 no Laboratório em modo casual ou faz um torneio casual.') : tx('Liga a Arena automática, corre testes 1 contra 1 no Laboratório ou faz um torneio.')}</Empty>}
        {tiers.map(([t, rs]) => (
          <div key={t} className="rt-tier">
            <h4>{t < 0 ? tx('Sem objetivo medido') : <><Stars v={t} bare /> {tx('{n} estrela|{n} estrelas', { n: t })}</>} <span className="muted small">{tx('{n} deck|{n} decks', { n: rs.length })}</span></h4>
            <ul className="rt-list">{rs.map(r => { const k = `${r.key}|${r.format}`; return <Row key={k} r={r} data={data} showFmt={cas || f === 'all'} open={open === k} onOpen={() => setOpen(o => (o === k ? null : k))} /> })}</ul>
          </div>
        ))}
      </section>
      <Arena data={data} fmts={fmts} onRound={() => setN(x => x + 1)} />
    </div>
  )
}
