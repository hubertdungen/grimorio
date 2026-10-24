// Laboratório: o teu deck joga contra adversários (Forge no servidor), com sideboard entre jogos,
// aprendizagem pelo histórico, repetição animada e relatório.
import { useEffect, useMemo, useRef, useState } from 'react'
import { img, recommend, sideSuggest } from './data.js'
import { parseList, stats } from './deck.js'
import { landAdvice, FORMAT, CASUAL_INFO, CASUAL_META, baseLife } from './formats.js'
import { Empty, Stars } from './ui.jsx'
import Replay, { HANDS } from './Board.jsx'
import { toForgeState } from './forgeState.js'
import { DIFF_INFO } from './difficulty.js'
import { planSideboard, applySwaps } from './sideboard.js'
import { aiCaveats } from './tests.js'

// Até onde confiar nos testes: o que a IA do Forge joga mal neste deck
function Caveats({ c }) {
  if (!c.flagged.length && !c.style.length && !c.unused.length) return null
  return (
    <div className="caveats small">
      <b>⚠ Até onde confiar nos testes</b>
      {c.flagged.length > 0 && <p>O próprio Forge avisa que a IA joga mal: <i>{c.flagged.join(', ')}</i>.</p>}
      {c.style.length > 0 && <p>Deck de {c.style.join(' e ')}: a IA do Forge não planeia vários turnos à frente, por isso os resultados tendem a sair abaixo do que o deck vale nas mãos de uma pessoa.</p>}
      {c.unused.length > 0 && <p>Ficaram na mão sem a IA as usar (jogos em que estiveram na mão): <i>{c.unused.join(', ')}</i>.</p>}
    </div>
  )
}

const SIDE_FORMATS_NO = new Set(['commander', 'duel', 'oathbreaker', 'brawl', 'standardbrawl', 'paupercommander', 'predh', 'gladiator', 'casual', 'limited'])
const sleep = ms => new Promise(r => setTimeout(r, ms))
// modos de jogo (sim.py, MODES): jogadores; com 3–4 o teu deck é o lugar A e os outros B, C, D
const MODE_N = { '1v1': 2, ffa3: 3, ffa4: 4, equipas: 4 }
const modeLabel = (m, cmd) => ({ '1v1': '1 contra 1', ffa3: 'Todos contra todos (3)', ffa4: cmd ? 'Mesa de Commander (4, todos contra todos)' : 'Todos contra todos (4)', equipas: 'Equipas 2 contra 2 (à Two-Headed Giant)' })[m] || m
const lost = w => !!w && w !== 'a' && w !== 'draw'  // com 3–4 jogadores ganha qualquer um dos outros
const placeOf = g => (g.places ? g.places.indexOf('a') + 1 : 0)
async function j(url, opts) {
  const r = await fetch(url, opts && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`)
  return d
}

// ---------- vista ----------
// placar antes do jogo em curso: série (deste adversário), jogo dentro da série e sessão inteira
const scoreOf = (list, k) => {
  const x = list[k]
  if (!x) return null
  const prev = list.slice(0, k), same = prev.filter(y => y.matchId && y.matchId === x.matchId)
  if (x.opps && !x.teams) return { label: modeLabel(x.mode, x.startLife === 40), wins: Object.fromEntries(['a', ...Object.keys(x.opps)].map(s => [s, same.filter(y => y.winner === s).length])), places: same.map(placeOf).filter(Boolean), k: k + 1, total: list.length }
  const n = w => ys => ys.filter(y => (w === 'b' ? lost(y.winner) : y.winner === w)).length
  return { a: n('a')(same), b: n('b')(same), g: same.length + 1, bo: x.bo || 1, serie: x.serie, series: x.series,
    sw: n('a')(prev), sl: n('b')(prev), k: k + 1, total: list.length }
}

// Quantos jogos do Forge correm ao mesmo tempo (definição do servidor, vale para testes, torneios e Arena)
function ParallelPick() {
  const [st, setSt] = useState(null)
  useEffect(() => { fetch('/api/sim/settings').then(r => r.json()).then(setSt).catch(() => {}) }, [])
  if (!st) return null
  const set = n => fetch('/api/sim/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parallel: n }) }).then(r => r.json()).then(setSt)
  return (
    <label className="fmt"><span>Jogos do Forge ao mesmo tempo</span>
      <select value={st.parallel} onChange={e => set(+e.target.value)}>
        <option value={1}>1 (mais leve)</option><option value={2}>2</option><option value={3}>3 (pesado: só com muita RAM livre)</option>
      </select>
      <small className="muted">Cada jogo usa ~0,7–1 GB de RAM e quase um núcleo. Um jogo extra só arranca com {(st.mem_min / 1000).toFixed(1).replace('.', ',')} GB livres (agora: {(st.mem_free / 1000).toFixed(1).replace('.', ',')} GB); senão espera pela vez.</small>
    </label>
  )
}

export default function LabView({ data, deck, fmt, act, ctx, playFrom }) {
  const [opps, setOpps] = useState([])
  const [mine, setMine] = useState([])
  const [diffs, setDiffs] = useState([])
  const [aiFlags, setAiFlags] = useState([])
  useEffect(() => { fetch('/api/sim/aiflags').then(r => r.json()).then(setAiFlags).catch(() => {}) }, [])
  const [sel, setSel] = useState([])
  const [paste, setPaste] = useState('')
  const [bo, setBo] = useState(SIDE_FORMATS_NO.has(fmt.key) ? 1 : 3)  // Commander e afins: Bo3 é possível, só não há sideboard
  const [matches, setMatches] = useState(1)
  const [diff, setDiff] = useState('')
  const [diffA, setDiffA] = useState('default')
  const [smartSide, setSmartSide] = useState(true)
  const [mode, setMode] = useState('1v1')
  // modo casual: adversários de qualquer formato; as regras base (vida, tipo de jogo) valem para todos (sim.py casual)
  // um deck casual (pode violar as regras do formato) só joga em modo casual
  const [casualSel, setCasual] = useState(false)
  const casual = casualSel || !!deck.casual
  const [base, setBase] = useState(fmt.key)
  const [metaFmt, setMetaFmt] = useState(fmt.key)
  useEffect(() => { setBase(fmt.key); setMetaFmt(fmt.key) }, [fmt.key])
  const rules = casual ? base : fmt.key, life = casual ? baseLife(base, MODE_N[mode]) : fmt.cmd ? 40 : 20, cmdish = fmt.cmd || casual
  const [seats, setSeats] = useState([{ id: 'espelho', diff: '' }, { id: 'espelho', diff: '' }, { id: 'espelho', diff: '' }])  // lugares B, C, D
  const multi = mode !== '1v1', nSeats = MODE_N[mode] - 1
  const setSeat = (j, v) => setSeats(x => x.map((y, k) => (k === j ? { ...y, ...v } : y)))
  const [learn, setLearn] = useState(true)
  const [runs, setRuns] = useState([])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const [watch, setWatch] = useState(null)
  const [played, setPlayed] = useState([])
  const [saved, setSaved] = useState([])
  const [rt, setRt] = useState({})  // estrelas dos adversários (ratings)
  const runsRef = useRef([])
  useEffect(() => { runsRef.current = runs }, [runs])
  const loadSaved = () => { if (deck.id) fetch(`/api/sim/runs?deck_id=${deck.id}`).then(r => r.json()).then(setSaved).catch(() => {}) }
  useEffect(loadSaved, [deck.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const openSaved = async id => {
    const b = await (await fetch(`/api/sim/runs/${id}`)).json()
    const rs = b.runs || [], bo = b.summary?.bo || 1
    setRuns(rs); setCur(0); setShowLive(true)
    setPlayed(rs.flatMap((r, ri) => r.games.map(g => ({ ...g, opp: r.opp, matchId: r.matchId, bo,
      serie: rs.slice(0, ri + 1).filter(x => x.opp === r.opp).length, series: rs.filter(x => x.opp === r.opp).length }))))
  }
  const delSaved = async id => { if (!confirm('Apagar este teste guardado?')) return; await fetch(`/api/sim/runs/${id}`, { method: 'DELETE' }); loadSaved(); act.refreshTests?.() }
  const [cur, setCur] = useState(0)
  const [showLive, setShowLive] = useState(true)
  // pausa entre jogos (preferência deste browser)
  const [pause, setPause] = useState(() => { try { return JSON.parse(localStorage.getItem('grimorio.pausa')) || { secs: 5, auto: true } } catch { return { secs: 5, auto: true } } })
  const setPausePref = v => { setPause(v); try { localStorage.setItem('grimorio.pausa', JSON.stringify(v)) } catch { /* sem armazenamento */ } }
  const stop = useRef(false)

  useEffect(() => {
    j(`/api/sim/opponents?format=${casual ? metaFmt : fmt.key}`).then(setOpps).catch(() => setOpps([]))
    j('/api/sim/difficulties').then(d => { setDiffs(d); if (d[0]) setDiff(x => x || d[0].id) }).catch(() => setDiffs([]))
    j('/api/decks').then(ds => setMine(ds.filter(d => d.id !== deck.id && (casual || (d.format === deck.format && !d.casual))))).catch(() => {})
    j('/api/ratings/stars').then(setRt).catch(() => {})
  }, [fmt.key, deck.id, deck.format, casual, metaFmt])

  const toggle = o => setSel(s => (s.some(x => x.id === o.id) ? s.filter(x => x.id !== o.id) : [...s, o]))
  const deckA = { name: deck.name, commanders: deck.commanders, main: deck.main, side: deck.side, art: deck.art }  // art: para o tabuleiro
  // modo casual: o formato de cada deck vai para o tabuleiro (chips ao lado dos nomes)
  const fmtOf = (id, d) => d.format || (/^edhrec-/.test(id) ? 'commander' : /^[a-z]+-\d+$/.test(id) ? id.split('-')[0] : '')
  const fmtsOf = g => (casual && g?.decks ? Object.fromEntries(Object.entries(g.decks).map(([k, d]) => { const f = k === 'a' ? deck.format : d.format; return [k, FORMAT[f]?.name || f || '?'] })) : undefined)
  const canRun = Object.keys(deck.main).length > 0 && (multi || sel.length || paste.trim())
  // os lugares começam com os decks do meta mais jogados deste formato (se houver), senão com o espelho
  useEffect(() => { setSeats(x => x.map((y, k) => ({ ...y, id: opps[k]?.id || 'espelho' }))) }, [opps])

  // 3–4 jogadores: a mesma mesa joga `matches` jogos (um trabalho do Forge por jogo)
  const runMulti = async () => {
    const load = async id => (id === 'espelho' ? { ...deckA, name: `${deck.name} (espelho)` } : id.startsWith('meus:') ? j(`/api/decks/${id.slice(5)}`) : j(`/api/sim/opponents/${encodeURIComponent(id)}`))
    const ds = []
    for (const x of seats.slice(0, nSeats)) {
      const o = await load(x.id), nm = o.name || x.id
      ds.push({ name: ds.some(d => d.name === nm) ? `${nm} (${ds.length + 1})` : nm, commanders: o.commanders || [], main: o.main, side: o.side || {}, format: fmtOf(x.id, o) })
    }
    const sides = ['b', 'c', 'd'].slice(0, nSeats)
    const opps = Object.fromEntries(sides.map((k, i) => [k, ds[i].name]))
    const label = `${modeLabel(mode, fmt.cmd)}: ${ds.map(d => d.name).join(' · ')}`
    const matchId = `${Date.now()}-0`, games = []
    for (let g = 1; g <= matches; g++) {
      if (stop.current) return
      setBusy(`${modeLabel(mode, fmt.cmd)} · jogo ${g}/${matches}`)
      const { job } = await j('/api/sim/run', { format: rules, casual, mode, games: 1, clock: cmdish ? 1500 : 900,
        seats: [{ deck: deckA, difficulty: diffA }, ...ds.map((d, i) => ({ deck: d, difficulty: seats[i].diff || diff }))] })
      let st
      for (;;) { await sleep(900); st = await j(`/api/sim/jobs/${job}`); if (st.status === 'done' || st.status === 'error') break; setBusy(`${modeLabel(mode, fmt.cmd)} · jogo ${g}/${matches} · ${st.status === 'queued' ? `na fila (${st.position})` : 'a jogar…'}`) }
      if (st.status === 'error') throw new Error(st.error || 'A simulação falhou.')
      const game = { ...st.games[0], g, unknown: st.unknown, startLife: life, opps }
      setPlayed(p => [...p, { ...game, opp: label, decks: { a: deckA, ...Object.fromEntries(sides.map((k, i) => [k, ds[i]])) }, matchId, serie: 1, series: 1, bo: 1 }])
      games.push(game)
      j('/api/sim/record', { deck_id: deck.id, deck_name: deck.name, format: fmt.key, opp_name: label, opp_archetype: mode, game_no: g, match_id: matchId, winner: game.winner, turns: game.turns, a_side_in: '[]', a_side_out: '[]', summary: game.summary }).catch(() => {})
      const wa = games.filter(x => x.winner === 'a').length
      setRuns(r => [...r.filter(x => x.matchId !== matchId), { matchId, opp: label, mode, seats: ds.map(d => d.name), games: [...games], wa, wb: games.filter(x => lost(x.winner)).length }])
    }
  }

  const run = async () => {
    setErr(''); stop.current = false
    const t0 = Date.now()
    const list = [...sel]
    if (paste.trim()) { const p = parseList(paste, data); list.push({ id: 'colada', name: 'Lista colada', source: 'colada', deck: { name: 'Lista colada', commanders: p.commanders, main: p.main, side: p.side } }) }
    try {
      if (multi) await runMulti()
      else for (const o of list) {
        const opp = o.id === 'espelho' ? { ...deckA, name: `${deck.name} (espelho)` } : o.deck || (o.source === 'meus' ? await j(`/api/decks/${o.id}`) : await j(`/api/sim/opponents/${encodeURIComponent(o.id)}`))
        const B = { name: opp.name || o.name, commanders: opp.commanders || [], main: opp.main, side: opp.side || {}, format: fmtOf(String(o.id), { format: opp.format || o.format }) }
        const history = learn ? await j(`/api/sim/history?deck_id=${deck.id || ''}`).then(h => (h.recent || []).filter(g => g.opp_name === B.name)).catch(() => []) : []
        for (let m = 0; m < matches; m++) {
          if (stop.current) return
          const matchId = `${Date.now()}-${m}`
          let cur = deckA
          const games = []
          let wa = 0, wb = 0, swaps = []
          for (let g = 1; g <= bo && wa < Math.ceil(bo / 2) && wb < Math.ceil(bo / 2); g++) {
            if (stop.current) return
            setBusy(`${B.name} · série ${m + 1}/${matches} · jogo ${g}`)
            const { job } = await j('/api/sim/run', { format: rules, casual, a: cur, b: B, games: 1, difficulty: diff, difficulty_a: diffA, clock: cmdish ? 600 : 300 })
            let st
            for (;;) { await sleep(700); st = await j(`/api/sim/jobs/${job}`); if (st.status === 'done' || st.status === 'error') break; setBusy(`${B.name} · série ${m + 1}/${matches} · jogo ${g} · ${st.status === 'queued' ? `na fila (${st.position})` : 'a jogar…'}`) }
            if (st.status === 'error') throw new Error(st.error || 'A simulação falhou.')
            const game = { ...st.games[0], g, swaps, unknown: st.unknown, startLife: life }
            setPlayed(p => [...p, { ...game, opp: B.name, decks: { a: cur, b: B }, matchId, serie: m + 1, series: matches, bo }])
            games.push(game)
            game.winner === 'a' ? wa++ : game.winner === 'b' ? wb++ : null
            j('/api/sim/record', { deck_id: deck.id, deck_name: deck.name, format: fmt.key, opp_name: B.name, opp_archetype: o.archetype || '', game_no: g, match_id: matchId, winner: game.winner, turns: game.turns, a_side_in: JSON.stringify(swaps.map(s => s.in)), a_side_out: JSON.stringify(swaps.map(s => s.out)), summary: game.summary, bo, casual, opp_key: o.source === 'meus' ? `deck:${o.id}` : ['espelho', 'colada'].includes(o.source) ? '' : `meta:${o.id}` }).catch(() => {})
            if (smartSide && bo > 1 && !SIDE_FORMATS_NO.has(fmt.key) && Object.keys(deck.side).length) {
              swaps = planSideboard(data, deckA, B, games, history)
              cur = applySwaps(deckA, swaps)
            }
            setRuns(r => [...r.filter(x => x.matchId !== matchId), { matchId, opp: B.name, archetype: o.archetype, games: [...games], wa, wb }])
          }
        }
      }
    } catch (e) { setErr(e.message) }
    // guarda a sessão no deck (séries com os jogos completos, para rever relatório e tabuleiro mais tarde)
    await sleep(80)
    const session = runsRef.current.filter(r => +String(r.matchId).split('-')[0] >= t0)
    if (session.length && deck.id) {
      const gs = session.flatMap(r => r.games)
      await fetch('/api/sim/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        deck_id: deck.id, label: [...new Set(session.map(r => r.opp))].join(', '),
        summary: { games: gs.length, wins: gs.filter(g => g.winner === 'a').length, matches: session.length, matchWins: session.filter(r => r.wa > r.wb).length, bo: multi ? 1 : bo, diff, diffA, format: fmt.key, ...(multi && { mode }) },
        runs: session,
      }) }).catch(() => {})
      loadSaved(); act.refreshTests?.()
    }
    setBusy(null)
  }

  const games = runs.flatMap(r => r.games.map(g => ({ ...g, opp: r.opp })))
  if (watch) return <Replay data={data} game={watch} formats={fmtsOf(watch)} onBack={() => setWatch(null)} deckName={deck.name} speed0={pause.speed} onSpeed={v => setPausePref({ ...pause, speed: v })} hands={pause.hands || 'ambas'} onHands={h => setPausePref({ ...pause, hands: h })} onPlayFrom={playFrom && !watch.opps && ((st, g) => playFrom(toForgeState(st, g.decks || { a: deck }, { control: 'a', format: fmt.key })))} />
  return (
    <div className="view lab">
      {played.length > 0 && showLive && (
        <section className="card livecard">
          <div className="row-btns">
            <b>Jogo {cur + 1} de {played.length}{busy ? ' · o próximo já está a ser jogado' : ''}</b>
            <button onClick={() => setCur(c => Math.max(0, c - 1))} disabled={cur === 0}>◀ anterior</button>
            <button onClick={() => setCur(c => Math.min(played.length - 1, c + 1))} disabled={cur >= played.length - 1}>seguinte ▶</button>
            <label className="small">Pausa entre jogos <select value={pause.secs} onChange={e => setPausePref({ ...pause, secs: +e.target.value })} disabled={!pause.auto}>{[2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} s</option>)}</select></label>
            <label className="chk small"><input type="checkbox" checked={!pause.auto} onChange={e => setPausePref({ ...pause, auto: !e.target.checked })} /> não avançar sozinho</label>
            <button className="link small" onClick={() => setShowLive(false)}>esconder</button>
          </div>
          <Replay key={cur} data={data} game={played[Math.min(cur, played.length - 1)]} formats={fmtsOf(played[Math.min(cur, played.length - 1)])} score={scoreOf(played, Math.min(cur, played.length - 1))} deckName={deck.name} live={!!busy} speed0={pause.speed} onSpeed={v => setPausePref({ ...pause, speed: v })} hands={pause.hands || 'ambas'} onHands={h => setPausePref({ ...pause, hands: h })} onPlayFrom={playFrom && !played[Math.min(cur, played.length - 1)].opps && ((st, g) => playFrom(toForgeState(st, g.decks || { a: deck }, { control: 'a', format: fmt.key })))}
            next={{ has: cur < played.length - 1, go: () => setCur(c => Math.min(c + 1, played.length - 1)), secs: pause.secs, auto: pause.auto }} />
          <p className="muted small">O Forge joga cada jogo inteiro em segundos e só no fim entrega o registo; o tabuleiro reproduz cada jogo assim que chega, enquanto o seguinte é jogado.</p>
        </section>
      )}
      <section className="card">
        <h3>Laboratório <span className="muted small">o teu deck joga contra outros com as regras do {casual ? `${FORMAT[base]?.name || base}, em modo casual` : fmt.name} (motor Forge)</span></h3>
        {!Object.keys(deck.main).length && <Empty>Abre ou cria um deck primeiro.</Empty>}
        <div className="lab-grid">
          <div className="lab-step">
            <h4 className="step-h"><i>1</i> {multi ? 'Lugares à mesa' : 'Adversários'} {!multi && sel.length > 0 && <span className="chip">{sel.length} escolhido{sel.length > 1 ? 's' : ''}</span>}</h4>
            {multi ? <>
              <p className="muted small">O teu deck é o lugar A{mode === 'equipas' ? ' e joga em equipa com o lugar C, contra B e D' : ''}. Escolhe o deck e a dificuldade de cada lugar; a ordem dos lugares é a ordem dos turnos.</p>
              {seats.slice(0, nSeats).map((x, k) => (
                <div key={k} className={`seat p-${'bcd'[k]}`}>
                  <b>{'BCD'[k]}{mode === 'equipas' ? (k === 1 ? ' · o teu parceiro' : ' · adversário') : ''}</b>
                  <select value={x.id} onChange={e => setSeat(k, { id: e.target.value })} aria-label={`Deck do lugar ${'BCD'[k]}`}>
                    <optgroup label="Os meus decks"><option value="espelho">⇄ Espelho: {deck.name}</option>{mine.map(o => <option key={o.id} value={`meus:${o.id}`}>{o.name}{casual ? ` · ${FORMAT[o.format]?.name || o.format}` : ''}</option>)}</optgroup>
                    {opps.length > 0 && <optgroup label="Do meta">{opps.map(o => <option key={o.id} value={o.id}>{o.name}{o.share ? ` (${Math.round(o.share * 100)}%)` : ''}</option>)}</optgroup>}
                  </select>
                  <select value={x.diff} onChange={e => setSeat(k, { diff: e.target.value })} aria-label={`Dificuldade do lugar ${'BCD'[k]}`}>
                    <option value="">Dificuldade do adversário ({diffs.find(d => d.id === diff)?.label || '—'})</option>{diffs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </div>
              ))}
            </> : <>
            <h4>Do meta {casual && <select className="tc-mf" value={metaFmt} onChange={e => setMetaFmt(e.target.value)} aria-label="Decks do meta de">{CASUAL_META.map(k => <option key={k} value={k}>de {FORMAT[k]?.name || k}</option>)}</select>} {opps.length ? <span className="muted">({opps.length})</span> : null}</h4>
            <div className="opp-list">{opps.map(o => (
              <label key={o.id} className={`opp ${sel.some(x => x.id === o.id) ? 'on' : ''}`}><input type="checkbox" checked={sel.some(x => x.id === o.id)} onChange={() => toggle(o)} /> {o.name} <Stars r={rt[`meta:${o.id}${casual ? '|casual' : ''}`]} /> {o.share ? <span className="muted">{Math.round(o.share * 100)}%</span> : null}</label>
            ))}{!opps.length && <p className="muted small">Sem decks do meta para este formato.</p>}</div>
            <h4>Os meus decks</h4>
            <div className="opp-list">
              <label className={`opp mirror ${sel.some(x => x.id === 'espelho') ? 'on' : ''}`}><input type="checkbox" checked={sel.some(x => x.id === 'espelho')} onChange={() => toggle({ id: 'espelho', name: 'Espelho', source: 'espelho' })} /> ⇄ Espelho: o mesmo deck</label>
              {mine.map(o => (
              <label key={o.id} className={`opp ${sel.some(x => x.id === o.id) ? 'on' : ''}`}><input type="checkbox" checked={sel.some(x => x.id === o.id)} onChange={() => toggle({ ...o, source: 'meus' })} /> {o.name}{casual && <span className="muted"> · {FORMAT[o.format]?.name || o.format}</span>} <Stars r={rt[`deck:${o.id}${casual ? '|casual' : ''}`]} /></label>
            ))}{!mine.length && <p className="muted small">Nenhum outro deck teu neste formato.</p>}</div>
            <h4>Ou cola uma lista</h4>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} placeholder={'4 Lightning Bolt\n…'} />
            </>}
          </div>
          <div className="lab-opts lab-step">
            <h4 className="step-h"><i>2</i> Regras do jogo</h4>
            <label className="chk"><input type="checkbox" checked={casual} disabled={!!deck.casual} onChange={e => { setCasual(e.target.checked); setSel([]) }} /> Modo casual (formatos misturados){deck.casual ? ' — deck casual, só joga assim' : ''}</label>
            {casual && <label className="fmt"><span>Regras base</span>
              <select value={base} onChange={e => setBase(e.target.value)}>{Object.values(FORMAT).filter(f => f.key !== 'casual' && f.key !== 'limited').map(f => <option key={f.key} value={f.key}>{f.name} ({baseLife(f.key, MODE_N[mode])} de vida)</option>)}</select>
              <small className="muted">{CASUAL_INFO} Estes jogos não contam para os ratings.</small>
            </label>}
            <label className="fmt"><span>Modo</span>
              <select value={mode} onChange={e => setMode(e.target.value)}>{Object.keys(MODE_N).map(m => <option key={m} value={m}>{modeLabel(m, fmt.cmd)}</option>)}</select>
              {mode === 'equipas' && <small className="muted">O Forge não tem Two-Headed Giant: aqui cada jogador tem a sua vida e o seu turno, mas as equipas atacam-se só entre si e ganham juntas (2 contra 2 em equipas).</small>}
              {multi && mode !== 'equipas' && <small className="muted">Cada um por si; quem fica sem vida sai e o jogo continua até sobrar um. Ganhar = 1.º lugar.{fmt.cmd ? ' Com 40 de vida e dano de comandante por adversário.' : ''}</small>}
            </label>
            <label className="fmt"><span>Formato do jogo</span>
              <select value={multi ? 1 : bo} onChange={e => setBo(+e.target.value)} disabled={multi}><option value={1}>Um jogo (Bo1)</option><option value={3}>{SIDE_FORMATS_NO.has(fmt.key) ? 'Melhor de 3 (Bo3, sem sideboard neste formato)' : 'Melhor de 3 (Bo3, com sideboard)'}</option></select>
            </label>
            <label className="sl"><span>{multi ? 'Jogos com esta mesa' : 'Séries por adversário'} <b>{matches}</b></span><input type="range" min="1" max="5" value={matches} onChange={e => setMatches(+e.target.value)} /></label>
            <label className="fmt"><span>Dificuldade do bot com o teu deck</span>
              <select value={diffA} onChange={e => setDiffA(e.target.value)}>{diffs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
              {DIFF_INFO[diffA] && <small className="muted">{DIFF_INFO[diffA].resumo}</small>}
            </label>
            <label className="fmt"><span>Dificuldade {multi ? 'dos adversários (por omissão)' : 'do adversário'}</span>
              <select value={diff} onChange={e => setDiff(e.target.value)}>{diffs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
              {(DIFF_INFO[diff]?.resumo || diffs.find(d => d.id === diff)?.description) && <small className="muted">{DIFF_INFO[diff]?.resumo || diffs.find(d => d.id === diff).description}</small>}
            </label>
            <details className="small diff-cmp"><summary>Comparar as dificuldades</summary>
              {Object.entries(DIFF_INFO).map(([id, d]) => (
                <div key={id} className={id === diff || id === diffA ? 'on' : ''}><b>{d.label}</b>{id === diffA && <span className="chip">o teu bot</span>}{id === diff && <span className="chip">adversário</span>}
                  <p className="muted">{d.resumo}</p><ul>{d.pontos.map((t, j) => <li key={j}>{t}</li>)}</ul></div>
              ))}
            </details>
            <label className="chk"><input type="checkbox" checked={smartSide} onChange={e => setSmartSide(e.target.checked)} disabled={bo === 1 || multi} /> Sideboard inteligente entre jogos</label>
            <label className="chk"><input type="checkbox" checked={learn} onChange={e => setLearn(e.target.checked)} /> Aprender com os jogos anteriores</label>
          </div>
          <div className="lab-opts lab-step">
            <h4 className="step-h"><i>3</i> Ver os jogos</h4>
            <label className="chk"><input type="checkbox" checked={showLive} onChange={e => setShowLive(e.target.checked)} /> Ver os jogos ao vivo</label>
              <label className="sl"><span>Velocidade ao ver <b>{pause.speed ?? 3}×</b></span><input type="range" min="0.5" max="8" step="0.5" value={pause.speed ?? 3} onChange={e => setPausePref({ ...pause, speed: +e.target.value })} /></label>
              <label className="small">Pausa entre jogos <select value={pause.secs} onChange={e => setPausePref({ ...pause, secs: +e.target.value })} disabled={!pause.auto}>{[2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} s</option>)}</select></label>
              <label className="chk small"><input type="checkbox" checked={!pause.auto} onChange={e => setPausePref({ ...pause, auto: !e.target.checked })} /> não avançar sozinho para o jogo seguinte</label>
            <ParallelPick />
            <label className="fmt"><span>Cartas na mão</span>
              <select value={pause.hands || 'ambas'} onChange={e => setPausePref({ ...pause, hands: e.target.value })}>{HANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <Caveats c={aiCaveats(data, deck, aiFlags)} />
            <div className="row-btns lab-go">
              <button className="primary" onClick={run} disabled={!canRun || !!busy}>{busy ? 'A jogar…' : '▶ Correr testes'}</button>
              {busy && <button onClick={() => { stop.current = true }}>Parar</button>}
            </div>
            {busy && <p className="small"><span className="spin-dot" /> {busy}</p>}
            {err && <p className="small bad-t">{err}</p>}
          </div>
        </div>
      </section>
      {saved.length > 0 && <section className="card saved-runs">
        <h3>Testes anteriores deste deck <span className="muted small">{saved.length}</span></h3>
                <ul className="lib-list">{saved.map(x => (
                  <li key={x.id}>
                    <span><b>{x.label}</b><br /><small className="muted">{new Date(x.ts * 1000).toLocaleString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {x.summary.wins}/{x.summary.games} jogos ganhos · {x.summary.mode ? modeLabel(x.summary.mode, fmt.cmd) : `${x.summary.matchWins}/${x.summary.matches} séries · Bo${x.summary.bo}`}</small></span>
                    <span className="row-btns"><button onClick={() => openSaved(x.id)}>Abrir</button><button className="link small" onClick={() => delSaved(x.id)}>apagar</button></span>
                  </li>
                ))}</ul>
      </section>}
      {runs.length > 0 && <Report data={data} runs={runs} games={games} deck={deck} fmt={fmt} ctx={ctx} onWatch={setWatch} act={act} aiFlags={aiFlags} />}
    </div>
  )
}

function Report({ data, runs, games, deck, fmt, ctx, onWatch, act, aiFlags }) {
  const total = games.length, wins = games.filter(g => g.winner === 'a').length
  const mwins = runs.filter(r => r.wa > r.wb).length
  const avg = arr => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1).replace('.', ',') : '—')
  const card = useMemo(() => {
    const m = {}
    for (const g of games) {
      for (const e of g.events || []) if (e.p === 'a' && e.k === 'cast' && e.card) { (m[e.card] ||= { casts: 0, dmg: 0, wins: 0, games: new Set() }).casts++; m[e.card].games.add(g); if (g.winner === 'a') m[e.card].wins++ }
      for (const [n, d] of Object.entries(g.summary?.a?.damage_by_card || {})) (m[n] ||= { casts: 0, dmg: 0, wins: 0, games: new Set() }).dmg += d
    }
    return Object.entries(m).map(([n, x]) => ({ n, ...x, c: data.byName.get(n) })).filter(x => x.c)
  }, [games, data])
  const mvp = [...card].sort((a, b) => b.dmg + b.wins * 3 - (a.dmg + a.wins * 3)).slice(0, 6)
  const mull = games.map(g => g.summary?.a?.mulligans ?? 0)
  const notes = []
  if (total) {
    const wt = games.filter(g => g.winner === 'a').map(g => g.turns), lt = games.filter(g => lost(g.winner)).map(g => g.turns)
    const mg = games.filter(g => g.opps)  // jogos a 3–4
    if (mg.length < total) notes.push(`Ganhou ${wins} de ${total} jogos (${Math.round((wins / total) * 100)}%) e ${mwins} de ${runs.length} séries.`)
    else {
      const ffa = mg.filter(g => !g.teams && g.places)
      notes.push(`${mg.some(g => g.teams) ? 'A tua equipa ganhou' : 'Ficou em 1.º lugar em'} ${wins} de ${total} jogos (${Math.round((wins / total) * 100)}%).`)
      if (ffa.length) notes.push(`Lugar médio: ${avg(ffa.map(placeOf))}.º (${ffa.map(g => `${placeOf(g)}.º`).join(', ')}).`)
      const by = {}
      for (const g of mg) { const o = g.out?.a; if (o) { const k = g.opps[o.by] || 'ninguém (perdeu por outra via)'; by[k] = (by[k] || 0) + 1 } }
      const top = Object.entries(by).sort((x, y) => y[1] - x[1])[0]
      const ne = Object.values(by).reduce((x, y) => x + y, 0)
      if (top) notes.push(`Foi eliminado em ${ne} ${ne === 1 ? 'jogo' : 'jogos'}, por volta do turno ${avg(mg.filter(g => g.out?.a).map(g => g.out.a.t))} (contado à mesa, cada jogador soma um turno); quem mais o eliminou: ${top[0]} (${top[1]}×).`)
    }
    if (wt.length) notes.push(`Quando ganha, ganha por volta do turno ${avg(wt)}${lt.length ? `; quando perde, perde no turno ${avg(lt)}` : ''}.`)
    else if (lt.length) notes.push(`Perde por volta do turno ${avg(lt)}.`)
    if (mull.some(x => x > 0)) notes.push(`Fez mulligan em ${mull.filter(x => x > 0).length} de ${total} jogos.`)
    const byOpp = {}
    for (const r of runs) { const o = (byOpp[r.opp] ||= { w: 0, l: 0 }); for (const g of r.games) g.winner === 'a' ? o.w++ : lost(g.winner) ? o.l++ : null }
    const worst = Object.entries(byOpp).sort((a, b) => a[1].w / (a[1].w + a[1].l || 1) - b[1].w / (b[1].w + b[1].l || 1))[0]
    if (worst && Object.keys(byOpp).length > 1) notes.push(`O pior confronto é contra ${worst[0]} (${worst[1].w}-${worst[1].l}).`)
  }
  return (
    <section className="card lab-report">
      <h3>Relatório</h3>
      <ul className="tips">{notes.map((x, k) => <li key={k}>{x}</li>)}</ul>
      <Caveats c={aiCaveats(data, deck, aiFlags, games)} />
      <h4>Séries</h4>
      <table className="lab-table"><tbody>{runs.map(r => (
        <tr key={r.matchId}><td><b>{r.opp}</b></td><td className={r.wa > r.wb ? 'ok-t' : 'bad-t'} title={r.mode ? 'vitórias – derrotas' : undefined}>{r.wa}-{r.wb}</td>
          <td>{r.games.map(g => (
            <button key={g.g} className={`gchip ${g.winner === 'a' ? 'w' : lost(g.winner) ? 'l' : ''}`} onClick={() => onWatch({ ...g, opp: r.opp })} title="Ver a repetição">J{g.g} {g.opps && !g.teams && placeOf(g) ? `${placeOf(g)}.º` : g.winner === 'a' ? 'V' : lost(g.winner) ? 'D' : '='} · T{g.turns} ▶</button>
          ))}</td>
          <td className="small muted">{r.games.filter(g => g.swaps?.length).map(g => `J${g.g}: ${g.swaps.map(s => `+${s.q} ${s.in} −${s.q} ${s.out}`).join(', ')}`).join(' · ')}</td></tr>
      ))}</tbody></table>
      {runs.some(r => r.games.some(g => g.swaps?.length)) && (
        <><h4>Porque mudou o sideboard</h4><ul className="why">{runs.flatMap(r => r.games.flatMap(g => (g.swaps || []).map((s, k) => <li key={`${r.matchId}-${g.g}-${k}`} className="inter">J{g.g} vs {r.opp}: entra {s.in} ({s.why}); sai {s.out} ({s.outWhy})</li>)))}</ul></>
      )}
      <Improve {...{ data, games, deck, fmt, ctx, act }} />
      {mvp.length > 0 && (
        <><h4>Cartas que mais pesaram</h4><div className="lab-mvp">{mvp.map(x => (
          <button key={x.n} onClick={() => act.open(x.c)} title={x.n}><img src={img(x.c, 'small')} alt={x.n} /><small>{x.casts}× lançada · {x.dmg} dano · {x.wins} vitórias</small></button>
        ))}</div></>
      )}
    </section>
  )
}

// Melhorias a partir dos testes: cartas mortas (com troca), mana, velocidade e respostas às ameaças do adversário.
function Improve({ data, games, deck, fmt, ctx, act }) {
  const tips = useMemo(() => {
    if (!games.length) return []
    const out = []
    const n = games.length
    // cartas mortas: no deck mas nunca usadas em nenhum jogo
    const used = new Set(games.flatMap(g => g.summary?.a?.used || []))
    const dead = Object.keys(deck.main).map(x => data.byName.get(x)).filter(c => c && c.mt !== 'Land' && !used.has(c.n))
    if (dead.length && n >= 4) {
      const have = [...deck.commanders, ...Object.keys(deck.main)].map(x => data.byName.get(x)?.i).filter(x => x != null)
      const recs = recommend(data, { seeds: have.filter(i => data.cards[i].mt !== 'Land'), have, ctx, filters: { noLands: true }, limit: 40 })
      const usedRec = new Set()
      for (const c of dead.slice(0, 5)) {
        const fn = c.tg.filter(t => ['removal', 'draw', 'ramp', 'counter', 'creature', 'wincon'].includes(t))
        const r = recs.find(x => !usedRec.has(x.c.i) && (fn.length ? fn.some(t => x.c.tg.includes(t)) : true))
        if (r) usedRec.add(r.c.i)
        out.push({ k: 'corte', txt: `${c.n} não teve impacto em nenhum dos ${n} jogos (nem jogada nem a fazer efeito)${r ? ` → experimenta ${r.c.n} (${r.why[0]?.txt || 'encaixa melhor'})` : ''}.`, go: r ? () => { act.add(c, 'main', -(deck.main[c.n] || 1)); act.add(r.c) } : null, goL: 'trocar' })
      }
    }
    // mana
    const missed = games.map(g => g.summary?.a?.missed_land_drops || 0)
    const screw = missed.filter(x => x >= 2).length
    const s = stats(deck, data), adv = landAdvice(fmt, s.avgMv || 3, s.cheapRampDraw)
    if (screw / n >= 0.3) out.push({ k: 'mana', txt: `Falhou 2+ terrenos nos primeiros turnos em ${screw} de ${n} jogos: sobe para ${Math.max(s.lands + 1, adv)} terrenos ou baixa a curva (custo médio ${s.avgMv.toFixed(2).replace('.', ',')}).` })
    const mull = games.filter(g => (g.summary?.a?.mulligans || 0) > 0).length
    if (mull / n >= 0.35) out.push({ k: 'mana', txt: `Mulligan em ${mull} de ${n} jogos: mãos iniciais fracas — mais terrenos ou mais cartas de custo 1–2.` })
    // velocidade
    const losses = games.filter(g => lost(g.winner))
    if (losses.length) {
      const lt = losses.reduce((a, g) => a + g.turns, 0) / losses.length
      const ourFirst = games.map(g => g.summary?.a?.first_damage_turn).filter(Boolean)
      const avgFirst = ourFirst.length ? ourFirst.reduce((a, b) => a + b, 0) / ourFirst.length : null
      if (lt <= (fmt.cmd ? 10 : 6)) out.push({ k: 'falta', txt: `As derrotas chegam cedo (turno ~${lt.toFixed(1).replace('.', ',')})${avgFirst ? ` e só começas a causar dano no turno ~${avgFirst.toFixed(1).replace('.', ',')}` : ''}: precisas de interação barata (remoção de custo 1–2) ou de bloqueadores cedo.`, go: () => act.suggestFor('removal'), goL: 'ver remoção' })
    }
    // ameaças do adversário
    const hurt = {}
    for (const g of losses) for (const k of ['b', 'c', 'd']) if (!(g.teams && g.teams[k] === g.teams.a)) for (const [x, d] of Object.entries(g.summary?.[k]?.damage_by_card || {})) hurt[x] = (hurt[x] || 0) + d
    const top = Object.entries(hurt).sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (top.length) {
      const flyers = top.some(([x]) => data.byName.get(x)?.kw.includes('Flying'))
      const arts = top.some(([x]) => /Artifact/.test(data.byName.get(x)?.t || ''))
      const side = fmt.side > 0 ? sideSuggest(data, deck, ctx, 2).filter(g => (flyers && /voadores/.test(g.label)) || (arts && /artefactos/.test(g.label)) || /aggro/.test(g.label)) : []
      out.push({ k: 'falta', txt: `Mais dano sofrido de: ${top.map(([x, d]) => `${x} (${d})`).join(', ')}.${side.length ? ` Respostas possíveis: ${side.flatMap(g => g.cards.map(c => c.n)).slice(0, 4).join(', ')}.` : ' Reforça a remoção para estas ameaças.'}`, go: side.length ? () => side.flatMap(g => g.cards).slice(0, 2).forEach(c => act.add(c, fmt.side > 0 ? 'side' : 'main', fmt.side > 0 ? 2 : 1)) : null, goL: fmt.side > 0 ? 'juntar ao sideboard' : 'juntar' })
    }
    return out
  }, [games, deck, data, fmt, ctx, act])
  if (!tips.length) return null
  return (
    <div className="lab-improve">
      <h4>Melhorias sugeridas pelos testes</h4>
      <ol>{tips.map((x, k) => <li key={k} className={x.k}><span>{x.txt}</span>{x.go && <button className="link small" onClick={x.go}>{x.goL}</button>}</li>)}</ol>
      <p className="muted small">Volta a correr os testes depois de aplicar para confirmar se melhorou.</p>
    </div>
  )
}
