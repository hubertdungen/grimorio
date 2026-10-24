// Ratings: decks por escalões (6★…0★) com ranking dentro de cada um, histórico de cada deck e a Arena automática,
// que põe o Forge a jogar rondas ao calhas (os meus decks e os do meta) para encher os registos. Normal (por formato,
// ou «Todos») e Casual (um só grupo: jogos em modo casual e decks casuais).
import { useEffect, useRef, useState } from 'react'
import { FORMAT } from './formats.js'
import { Empty, Stars, PROV_TIP } from './ui.jsx'
import { img, HUE, coverOf, colorsOf } from './data.js'
import Replay from './Board.jsx'

const j = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const x = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(x.erro || `HTTP ${r.status}`)
  return x
}
const META_FMTS = ['pauper', 'modern', 'pioneer', 'standard', 'legacy', 'vintage', 'premodern', 'commander', 'duel']
const STEPS = Array.from({ length: 13 }, (_, i) => i / 2)
const fmtName = f => FORMAT[f]?.name || f
const pct = x => (x == null ? '—' : `${Math.round(x)}%`)
const num = x => String(x).replace('.', ',')
const when = ts => new Date(ts * 1000).toLocaleString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const SRC = { lab: 'Laboratório', torneio: 'Torneio', arena: 'Arena' }

// curva do Elo (a tracejado: 1500, o ponto de partida)
function Spark({ elo }) {
  if (elo.length < 2) return null
  const lo = Math.min(...elo, 1500) - 10, hi = Math.max(...elo, 1500) + 10, W = 300, H = 70
  const x = i => (i / (elo.length - 1)) * W, y = v => H - 4 - ((v - lo) / (hi - lo)) * (H - 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`Elo de ${Math.round(elo[0])} a ${Math.round(elo.at(-1))}`}>
      <line x1="0" x2={W} y1={y(1500)} y2={y(1500)} stroke="#ffffff30" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline points={elo.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--gold)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function History({ k, format }) {
  const [h, setH] = useState(null)
  useEffect(() => { j(`/api/ratings/deck/${encodeURIComponent(k)}?format=${format}`).then(setH).catch(() => setH({ elo: [], rounds: [] })) }, [k, format])
  if (!h) return <div className="rt-hist muted small">A carregar…</div>
  return (
    <div className="rt-hist">
      <div className="muted small">Elo: {Math.round(h.elo[0])} → <b>{Math.round(h.elo.at(-1))}</b> em {h.elo.length - 1} jogos</div>
      <Spark elo={h.elo} />
      <ul>{h.rounds.map(r => {
        const res = r.w > r.l ? ['w', 'V'] : r.l > r.w ? ['l', 'D'] : ['d', 'E']
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
        <span className="rt-rank">#{r.rank_in_tier}<small>{r.rank}.º geral</small></span>
        <span className="rt-art" style={{ '--edge': edge.length > 1 ? `linear-gradient(135deg, ${edge.join(', ')})` : edge[0] }}>{c ? <img src={img(c, 'art_crop')} alt="" loading="lazy" /> : <span>✦</span>}</span>
        <span className="rt-name"><b title={r.name}>{r.name}</b>
          <span><Stars r={{ stars: r.stars, prov: r.provisional, games: r.games, elo: Math.round(r.elo) }} /><i className={`badge ${r.kind}`}>{r.kind === 'meu' ? 'meu' : 'meta'}</i>{showFmt && <i className="badge">{fmtName(r.format === 'casual' ? r.deck_format : r.format)}</i>}{r.provisional && <i className="badge prov" title={PROV_TIP}>provisório</i>}</span></span>
        <span className="rt-num wide">{Math.round(r.elo)}<small>Elo</small></span>
        <span className="rt-num">{r.wins}-{r.losses}{r.draws ? `-${r.draws}` : ''} <b>{pct(r.win_pct)}</b><small>jogos</small></span>
        <span className="rt-num wide">{r.rounds ? <>{r.round_wins}-{r.round_losses} <b>{pct(r.round_pct)}</b></> : '—'}<small>rondas</small></span>
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
        {!id ? <p className="muted">A Arena não tem nenhum jogo a decorrer agora{a.on ? ' (está entre rondas ou à espera de vez)' : ' (está desligada)'}. Esta janela segue o próximo assim que começar.</p>
          : !game ? <p className="muted"><span className="spin-dot" /> A ligar ao jogo…</p>
            : <Replay key={game.key} data={data} game={game} live={!!game.inProgress} deckName={a.cur.a} onBack={onClose} backLabel="× Fechar" />}
        {!id && <button onClick={onClose}>Fechar</button>}
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
  const src = a.sources.length === 2 ? 'ambos' : a.sources[0]
  const allF = [...new Set([...META_FMTS, ...fmts, ...a.formats])]
  const job = a.cur?.job
  return (
    <section className="card">
      <h3>Arena automática <span className="muted small">o Forge joga rondas ao calhas para criar registos e ratings</span>
        <button className="la-btn" onClick={() => setWatch(true)} title="Ver o jogo da Arena a decorrer, no tabuleiro">👁 Ver ao vivo{job?.status === 'running' ? ' ●' : ''}</button></h3>
      {watch && <LiveArena data={data} a={a} onClose={() => setWatch(false)} />}
      <div className="arena-grid">
        <label>Modo<span className="seg">{[[false, 'Normais'], [true, 'Casuais']].map(([k, l]) => <button key={l} className={!!a.casual === k ? 'on' : ''} onClick={() => set({ casual: k })} title={k ? 'Decks dos formatos escolhidos misturados (e os teus decks casuais), com as regras base do formato do 1.º deck; contam para o rating casual' : 'Cada ronda num formato, entre decks desse formato; contam para o rating normal'}>{l}</button>)}</span></label>
        <label>Decks<span className="seg">{[['meu', 'Meus'], ['meta', 'Meta'], ['ambos', 'Ambos']].map(([k, l]) => <button key={k} className={src === k ? 'on' : ''} onClick={() => set({ sources: k === 'ambos' ? ['meu', 'meta'] : [k] })}>{l}</button>)}</span></label>
        <label>Estrelas<span className="row-btns">de <select value={a.min} onChange={e => set({ min: +e.target.value, max: Math.max(a.max, +e.target.value) })}>{STEPS.map(s => <option key={s} value={s}>{num(s)}★</option>)}</select>
          a <select value={a.max} onChange={e => set({ max: +e.target.value, min: Math.min(a.min, +e.target.value) })}>{STEPS.map(s => <option key={s} value={s}>{num(s)}★</option>)}</select></span></label>
        <label>Ronda<span className="seg">{[1, 3].map(b => <button key={b} className={a.bo === b ? 'on' : ''} onClick={() => set({ bo: b })}>Bo{b}</button>)}</span></label>
        <label>Dificuldade<select value={a.difficulty} onChange={e => set({ difficulty: e.target.value })}>{diffs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <label>Pausa entre rondas<select value={a.pause} onChange={e => set({ pause: +e.target.value })}>{[0, 5, 10, 30, 60, 120, 300, 600].map(s => <option key={s} value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>)}</select></label>
        <label>Parar ao fim de<select value={a.max_rounds} onChange={e => set({ max_rounds: +e.target.value })}>{[0, 5, 10, 20, 50, 100, 200].map(n => <option key={n} value={n}>{n ? `${n} rondas` : 'sem limite'}</option>)}</select></label>
        <label>No máximo<select value={a.per_hour} onChange={e => set({ per_hour: +e.target.value })}>{[2, 5, 10, 20, 30, 60].map(n => <option key={n} value={n}>{n} rondas por hora</option>)}</select></label>
      </div>
      {a.casual && <p className="muted small" style={{ margin: '0 0 6px' }}>Rondas casuais: os decks de todos os formatos marcados jogam entre si (os teus decks casuais também) e contam só para o rating casual.</p>}
      <div className="arena-fmts">{allF.map(f => <label key={f}><input type="checkbox" checked={a.formats.includes(f)} onChange={e => set({ formats: e.target.checked ? [...a.formats, f] : a.formats.filter(x => x !== f) })} /> {fmtName(f)}</label>)}</div>
      <div className="row-btns" style={{ margin: '10px 0' }}>
        <button className={a.on ? '' : 'primary'} onClick={() => set({ on: !a.on })} disabled={!a.on && !a.formats.length}>{a.on ? '■ Desligar a Arena' : '▶ Ligar a Arena'}</button>
        <span className="muted small">Só joga com o simulador parado: um teste teu, um torneio ou um jogo contra o Forge passam sempre à frente (o jogo da Arena é cancelado e repetido depois).</span>
      </div>
      {err && <p className="small bad-t">{err}</p>}
      <div className="arena-live" aria-live="polite">
        <div><span className={`on-dot ${a.on ? 'on' : ''}`} /><b>{a.on ? 'Ligada' : 'Desligada'}</b>{a.state && a.state !== 'Desligada.' && <span className="muted"> · {a.state}</span>}</div>
        {a.cur?.a && <div><span className="muted">{a.on ? 'Ronda:' : 'Ronda por acabar:'}</span> {a.cur.format === 'casual' ? `Casual (regras de ${fmtName(a.cur.base)})` : fmtName(a.cur.format)} · <b>{a.cur.a}</b> {a.cur.a_stars != null && <Stars v={a.cur.a_stars} />} contra <b>{a.cur.b}</b> {a.cur.b_stars != null && <Stars v={a.cur.b_stars} />} · {a.cur.wa}–{a.cur.wb} (Bo{a.cur.bo}){job && <span className="muted"> · {job.status === 'queued' ? `na fila (${job.position})` : `a jogar há ${job.secs} s`}</span>}</div>}
        {a.error && <div className="small bad-t">{a.error}</div>}
        <div className="muted small">Hoje: {a.today} rondas · desde que foi ligada: {a.played}{a.avg_secs ? ` · ${a.avg_secs} s por ronda em média` : ''}</div>
        {a.last.length > 0 && <ul className="arena-last small">{a.last.map((r, i) => (
          <li key={i}><span><b className={r.wa > r.wb ? 'res-w' : ''}>{r.a}</b> {r.wa}–{r.wb}{r.draws ? `–${r.draws}` : ''} <b className={r.wb > r.wa ? 'res-w' : ''}>{r.b}</b>{r.open ? ' · a decorrer' : ''}</span><span className="muted">{fmtName(r.format)} · {when(r.ts)}</span></li>
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
  const first = useRef(true)
  useEffect(() => {
    j(`/api/ratings?format=${cas ? 'casual' : f}`).then(x => {
      if (first.current && !x.rows.length && x.formats.length) setF(x.formats[0])  // abre num formato que já tem jogos
      first.current = false
      setRes(x)
    }).catch(() => setRes({ rows: [], formats: [] }))
  }, [f, n, cas])
  const rows = res?.rows || []
  const tiers = [6, 5, 4, 3, 2, 1, 0].map(t => [t, rows.filter(r => r.tier === t)]).filter(([, rs]) => rs.length)
  const where = cas ? 'no rating casual' : f === 'all' ? 'em nenhum formato' : `em ${fmtName(f)}`
  const fmts = [...new Set([...META_FMTS, ...(res?.formats || []), fmt.key])]
  return (
    <div className="view ratings">
      <section className="card">
        <div className="rt-top">
          <h3 style={{ margin: 0 }}>📊 Ratings</h3>
          <span className="seg">{[[false, 'Normal'], [true, 'Casual']].map(([k, l]) => <button key={l} className={cas === k ? 'on' : ''} onClick={() => { setCas(k); setOpen(null) }}>{l}</button>)}</span>
          {!cas && <select value={f} onChange={e => { setF(e.target.value); setOpen(null) }} aria-label="Formato"><option value="all">Todos os formatos</option>{fmts.map(x => <option key={x} value={x}>{fmtName(x)}{res?.formats?.includes(x) ? ' ●' : ''}</option>)}</select>}
          <span className="muted small">{rows.length} decks com jogos · {cas ? 'Casual: jogos em modo casual (formatos misturados) e decks casuais, todos no mesmo grupo' : f === 'all' ? 'Todos: cada deck com as estrelas do seu formato' : 'Normal: só jogos legais do formato'} · Elo jogo a jogo (1500 ao começar) · estrelas de 0,0 a 6,0 pelo percentil do Elo entre os decks com {res?.prov || 10}+ jogos {cas ? 'casuais' : 'do formato'} (o pior 0,0, o melhor 6,0; com poucos decks, 1500 = 3,0★ e cada 100 pontos uma estrela) · <abbr title={PROV_TIP}>mais claras = provisório</abbr>: menos de {res?.prov || 10} jogos, o rating ainda mexe muito</span>
        </div>
        {res && !rows.length && <Empty>Ainda não há jogos com rating {where}. Liga a Arena automática{cas ? ' com rondas casuais' : ''}, corre testes 1 contra 1 no Laboratório{cas ? ' em modo casual' : ''} ou faz um torneio{cas ? ' casual' : ''}.</Empty>}
        {tiers.map(([t, rs]) => (
          <div key={t} className="rt-tier">
            <h4><Stars v={t} bare /> {t} {t === 1 ? 'estrela' : 'estrelas'} <span className="muted small">{rs.length} {rs.length === 1 ? 'deck' : 'decks'}</span></h4>
            <ul className="rt-list">{rs.map(r => { const k = `${r.key}|${r.format}`; return <Row key={k} r={r} data={data} showFmt={cas || f === 'all'} open={open === k} onOpen={() => setOpen(o => (o === k ? null : k))} /> })}</ul>
          </div>
        ))}
      </section>
      <Arena data={data} fmts={fmts} onRound={() => setN(x => x + 1)} />
    </div>
  )
}
