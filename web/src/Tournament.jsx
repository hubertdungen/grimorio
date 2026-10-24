// Torneio no Coliseu: vários decks jogam entre si no Forge. O servidor (tournament.py) agenda as partidas e guarda tudo;
// aqui cria-se o torneio, vê-se a chave/classificação a mexer ao vivo, revêem-se os jogos e consulta-se o registo.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FORMATS, FORMAT, CASUAL_INFO, CASUAL_META, baseLife } from './formats.js'
import { img, coverOf, colorsOf, HUE } from './data.js'
import { Mana, Stars } from './ui.jsx'
import Replay from './Board.jsx'
import { DIFF_INFO } from './difficulty.js'
import { tx, LOCALE } from './i18n.js'
import { play } from './sfx.js'

const TYPES = {
  elim: [tx('Eliminação simples'), 4, 16, tx('Quem perde sai. Se o número de decks não for 4, 8 ou 16, os melhores seeds passam a 1.ª ronda sem jogar (isentos). Pode haver jogo de 3.º lugar entre os vencidos das meias-finais.')],
  dupla: [tx('Dupla eliminação'), 4, 16, tx('Só sai quem perde duas vezes: a 1.ª derrota manda para a chave dos vencidos. O vencedor dessa chave defronta o invicto na grande final; se a ganhar, joga-se a 2.ª final.')],
  suico: [tx('Suíço'), 4, 32, tx('Todos jogam todas as rondas, sempre contra quem tem os mesmos pontos e sem repetir adversários (vitória 3, empate 1; quem fica isento conta como vitória). Desempate: % de vitórias dos adversários (OMW%) e % de jogos ganhos (GW%).')],
  liga: [tx('Liga (todos contra todos)'), 4, 16, tx('Cada deck joga uma vez contra cada um dos outros; vitória 3, empate 1. O mais justo e o mais longo.')],
  mesas: [tx('Mesas (multijogador)'), 4, 16, tx('Para Commander e jogos a 3–4: mesas de todos contra todos, um jogo por mesa; pontos pelo lugar (1.º 3, 2.º 2, 3.º 1, 4.º 0). Em cada ronda as mesas refazem-se pelos pontos.')],
}
const STATUS = { running: tx('a decorrer'), paused: tx('em pausa'), done: tx('terminado'), cancelled: tx('cancelado'), error: tx('parado (erro)') }
const MIN_PER_GAME = 1  // medido: ~45 s por jogo de Pauper no Forge, com o arranque da JVM
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch { return null } }
async function j(url, opts) {
  const r = await fetch(url, opts)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const when = t => new Date(t * 1000).toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const edge = cs => { const e = cs.length ? [...cs].map(x => HUE[x]) : ['#8a8a99']; return e.length > 1 ? `linear-gradient(135deg, ${e.join(', ')})` : e[0] }
const pct = x => `${Math.round(x * 100)}%`
// ratings (ratings.py): estrelas 0–6 por deck, chave deck:<id> (os meus) ou meta:<id>; sem o módulo fica tudo sem estrelas
const rkey = (src, id) => `${src === 'meus' ? 'deck' : 'meta'}:${id}`
const STEPS = Array.from({ length: 13 }, (_, k) => k / 2)
const dLabel = d => DIFF_INFO[d.id]?.label || d.label  // o nosso rótulo (traduzido) quando o conhecemos

export default function TournamentView({ data, fmt }) {
  const [view, setView] = useState('criar')
  const [tid, setTid] = useState(null)
  const [list, setList] = useState([])
  const loadList = () => j('/api/tournaments').then(l => { setList(l); return l }).catch(() => [])
  useEffect(() => {  // ao entrar: volta ao torneio que estava aberto, ou ao que está a decorrer
    loadList().then(l => {
      const last = ls('grimorio.torneio'), on = l.find(x => x.id === last) || l.find(x => x.status === 'running')
      if (on) { setTid(on.id); setView('ver') }
    })
  }, [])
  const open = id => { setTid(id); ls('grimorio.torneio', id); setView('ver') }
  return (
    <div className="view tour">
      <div className="seg tour-nav">
        <button className={view === 'criar' ? 'on' : ''} onClick={() => setView('criar')}>{tx('✦ Criar')}</button>
        <button className={view === 'ver' ? 'on' : ''} onClick={() => setView('ver')} disabled={!tid}>{tx('🏆 Ao vivo')}</button>
        <button className={view === 'registo' ? 'on' : ''} onClick={() => { loadList(); setView('registo') }}>{tx('📜 Registo')} <b>{list.length}</b></button>
      </div>
      {view === 'criar' && <Create data={data} fmt0={fmt} onCreated={id => { loadList(); open(id) }} />}
      {view === 'ver' && tid && <Live key={tid} data={data} tid={tid} onGone={() => { loadList(); setView('registo') }} />}
      {view === 'registo' && <Registry data={data} list={list} open={open} reload={loadList} />}
    </div>
  )
}

// ---------- criar ----------

function Create({ data, fmt0, onCreated }) {
  const [format, setFormat] = useState(fmt0.key === 'casual' ? 'modern' : fmt0.key)
  const F = FORMAT[format]
  const [type, setType] = useState(F.cmd === 'commander' && format !== 'duel' ? 'mesas' : 'elim')
  const [bo, setBo] = useState(1)
  const [third, setThird] = useState(true)
  const [rounds, setRounds] = useState('')
  const [seeding, setSeeding] = useState('aleatorio')
  const [name, setName] = useState('')
  const [players, setPlayers] = useState([])
  const [casual, setCasual] = useState(false)  // formatos misturados; `format` passa a ser o das regras base
  const [metaFmt, setMetaFmt] = useState('')
  const mf = casual ? metaFmt || format : format
  const [allMine, setAllMine] = useState([])
  const mine = casual ? allMine : allMine.filter(d => d.format === format && !d.casual)  // os decks casuais só entram nos casuais
  const [meta, setMeta] = useState([])
  const [diffs, setDiffs] = useState([])
  const [fillN, setFillN] = useState(8)
  const [fillSrc, setFillSrc] = useState('ambos')
  const [allDiff, setAllDiff] = useState('default')
  const [smin, setSmin] = useState(0)
  const [smax, setSmax] = useState(6)
  const [unrated, setUnrated] = useState(true)
  const [stars, setStars] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { j('/api/sim/difficulties').then(setDiffs).catch(() => {}); j('/api/decks').then(setAllMine).catch(() => {}) }, [])
  useEffect(() => { if (!casual) setPlayers([]) }, [format, casual])
  useEffect(() => { setMeta([]); j(`/api/sim/opponents?format=${mf}`).then(setMeta).catch(() => setMeta([])) }, [mf])
  useEffect(() => {
    j(`/api/ratings?format=${format}`).then(r => setStars(Object.fromEntries((Array.isArray(r) ? r : r.rows || []).filter(x => x?.key).map(x => [x.key, { ...x, prov: x.provisional, deck: undefined }]))))
      .catch(() => setStars({}))
  }, [format])
  const [, , max, info] = TYPES[type]
  const n = players.length
  const suggested = `${TYPES[type][0]} · ${F.name} · ${new Date().toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' })}`
  const roundsDef = type === 'suico' ? Math.ceil(Math.log2(Math.max(n, 2))) : 3
  const R = +rounds || roundsDef
  const matches = { elim: n - 1 + (third && n >= 4 ? 1 : 0), dupla: 2 * n - 1, suico: R * Math.ceil(n / 2), liga: (n * (n - 1)) / 2, mesas: R * Math.ceil(n / 4) }[type]
  const games = Math.round(matches * (bo === 3 && type !== 'mesas' ? 2.5 : 1))

  const deckOf = async (src, o) => (src === 'meus' ? o : j(`/api/sim/opponents/${encodeURIComponent(o.id)}`))
  const entry = async (src, o, difficulty) => {
    const d = await deckOf(src, o), c = coverOf(d, data)
    return { key: `${src}:${o.id}:${Math.random()}`, src, ref: o.id, name: o.name, difficulty, fmt: src === 'meus' ? o.format : mf, cover: c?.n || '', colors: colorsOf(d, data).join('') }
  }
  const add = async (src, o) => {
    if (n >= max) return setErr(tx('Este tipo leva no máximo {m} participantes.', { m: max }))
    setErr(''); const e = await entry(src, o, allDiff).catch(() => null)
    if (e) setPlayers(p => [...p, e])
  }
  const inStars = (s, id) => { const x = stars[rkey(s, id)]?.stars; return x == null ? unrated : x >= smin && x <= smax }
  const fill = async () => {
    const used = new Set(players.map(p => `${p.src}:${p.ref}`))
    const want = Math.min(fillN, max) - n
    if (want <= 0) return
    // o sorteio com filtro de estrelas é do ratings.py; sem ele (ou se falhar) sorteia-se aqui com as estrelas que houver
    const byKey = Object.fromEntries([...mine.map(o => [rkey('meus', o.id), ['meus', o]]), ...meta.map(o => [rkey('meta', o.id), ['meta', o]])])
    // pede todos os candidatos já baralhados (os sem rating vêm como 3,0★ com games 0) e filtra aqui: «sem rating» entra
    // pela caixa, independentemente do intervalo de estrelas
    const picked = casual ? null : await j(`/api/ratings/pick?format=${format}&n=999&min=0&max=6&sources=${{ ambos: 'meu,meta', meus: 'meu', meta: 'meta' }[fillSrc]}`)
      .then(r => (Array.isArray(r) ? r.filter(x => (x.games ? x.stars >= smin && x.stars <= smax : unrated)).map(x => byKey[x.key] || (x.src === 'meta' && ['meta', { id: x.ref, name: x.name }])).filter(Boolean) : null)).catch(() => null)
    const pool = (picked || [...(fillSrc !== 'meta' ? mine.map(o => ['meus', o]) : []), ...(fillSrc !== 'meus' ? meta.map(o => ['meta', o]) : [])]
      .filter(([s, o]) => inStars(s, o.id)).sort(() => Math.random() - 0.5))
      .filter(([s, o]) => !used.has(`${s}:${o.id}`))
    if (pool.length < want) setErr(tx('Só há {k} decks diferentes com esta fonte e estas estrelas: preenchi o que deu.', { k: pool.length })); else setErr('')
    const add = await Promise.all(pool.slice(0, want).map(([s, o]) => entry(s, o, allDiff).catch(() => null)))
    setPlayers(p => [...p, ...add.filter(Boolean)])
  }
  const setP = (k, v) => setPlayers(p => p.map((x, i) => (i === k ? { ...x, ...v } : x)))
  const move = (k, d) => setPlayers(p => { const q = [...p], t = q[k]; q[k] = q[k + d]; q[k + d] = t; return q })
  const randomDiffs = () => { const ids = diffs.map(d => d.id).filter(x => x !== 'random'); setPlayers(p => p.map(x => ({ ...x, difficulty: ids[Math.floor(Math.random() * ids.length)] }))) }
  const start = async () => {
    setBusy(true); setErr('')
    try {
      const { id } = await post('/api/tournaments', { name: name.trim() || suggested, type, format, casual, bo: type === 'mesas' ? 1 : bo, third, rounds: R, seeding,
        players: players.map(({ src, ref, difficulty, cover, colors, me }) => ({ src, ref, difficulty, cover, colors, me })) })
      onCreated(id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const has = (s, id) => players.some(p => p.src === s && p.ref === id)
  return (
    <section className="card tour-create">
      <h3>{tx('Novo torneio')} <span className="muted small">{tx('os bots do Forge jogam tudo sozinhos no servidor — podes fechar o browser e voltar mais tarde')}</span></h3>
      <div className="tc-grid">
        <div className="lab-step">
          <h4 className="step-h"><i>1</i> {tx('Regras')}</h4>
          <label className="fmt"><span>{tx('Nome')}</span><input value={name} onChange={e => setName(e.target.value)} placeholder={suggested} /></label>
          <label className="chk"><input type="checkbox" checked={casual} onChange={e => setCasual(e.target.checked)} /> {tx('Modo casual (formatos misturados)')}</label>
          {casual && <p className="small muted tc-info">{CASUAL_INFO} {tx('Os torneios casuais não contam para os ratings.')}</p>}
          <label className="fmt"><span>{casual ? tx('Regras base (vida e tipo de jogo de todos)') : tx('Formato (todos os decks jogam este)')}</span>
            <select value={format} onChange={e => { const f = e.target.value; setFormat(f); setType(FORMAT[f].cmd === 'commander' && f !== 'duel' ? 'mesas' : 'elim') }}>{FORMATS.filter(f => f.key !== 'casual' && f.key !== 'limited').map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</select></label>
          <div className="tc-types">{Object.entries(TYPES).map(([k, [l, lo, hi]]) => (
            <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}><b>{l}</b><small>{lo}–{hi} decks</small></button>
          ))}</div>
          <p className="small muted tc-info">{info}</p>
          <div className="tc-row">
            <label className="fmt"><span>{tx('Partidas')}</span><select value={type === 'mesas' ? 1 : bo} onChange={e => setBo(+e.target.value)} disabled={type === 'mesas'}><option value={1}>{tx('Um jogo (Bo1)')}</option><option value={3}>{tx('Melhor de 3 (Bo3)')}</option></select></label>
            {(type === 'suico' || type === 'mesas') && <label className="fmt"><span>{tx('Rondas')}</span><input type="number" min="1" max={roundsDef + 3} value={rounds} placeholder={String(roundsDef)} onChange={e => setRounds(e.target.value)} /></label>}
            <label className="fmt"><span>Seeds</span><select value={seeding} onChange={e => setSeeding(e.target.value)}><option value="aleatorio">{tx('Sorteados ao começar')}</option><option value="ordem">{tx('Pela ordem da lista')}</option></select></label>
          </div>
          {type === 'elim' && <label className="chk small"><input type="checkbox" checked={third} onChange={e => setThird(e.target.checked)} /> {tx('Jogo de 3.º lugar')}</label>}
          <p className="small muted">{bo === 3 && type !== 'mesas' ? `${tx('Bo3 com sideboard inteligente entre jogos, como no Laboratório (decks com sideboard, em formatos que o têm), e aprende com as trocas que já perderam.')} ` : ''}{tx('Empates na eliminação repetem o jogo (até 2 vezes); depois passa o melhor seed. Jogos em que o Forge falha repetem-se.')}</p>
        </div>
        <div className="lab-step">
          <h4 className="step-h"><i>2</i> Decks <span className="chip">{n}/{max}</span></h4>
          <p className="small muted tc-info">{tx('Marca um dos teus com')} <b>{tx('☆ eu')}</b> {tx('para jogar «como se fosses tu»: fica destacado e vês até onde chegas.')}</p>
          <div className="tc-fill">
            <span>{tx('🎲 Preencher até')}</span><input type="number" min="2" max={max} value={fillN} onChange={e => setFillN(+e.target.value)} />
            <select value={fillSrc} onChange={e => setFillSrc(e.target.value)}><option value="ambos">{tx('com os meus e os do meta')}</option><option value="meus">{tx('só com os meus decks')}</option><option value="meta">{tx('só com decks do meta')}</option></select>
            {!casual && <><span className="tc-stars">{tx('estrelas')} <select value={smin} onChange={e => setSmin(+e.target.value)} aria-label={tx('Mínimo de estrelas')}>{STEPS.map(x => <option key={x} value={x}>{x.toLocaleString(LOCALE)}</option>)}</select>
              {tx('a')} <select value={smax} onChange={e => setSmax(+e.target.value)} aria-label={tx('Máximo de estrelas')}>{STEPS.map(x => <option key={x} value={x}>{x.toLocaleString(LOCALE)}</option>)}</select></span>
            <label className="chk small"><input type="checkbox" checked={unrated} onChange={e => setUnrated(e.target.checked)} /> {tx('incluir decks sem rating')}</label></>}
            <button onClick={fill} disabled={n >= Math.min(fillN, max)}>{tx('Preencher')}</button>
            {n > 0 && <button className="link small" onClick={() => setPlayers([])}>{tx('limpar')}</button>}
          </div>
          <h4>{casual ? tx('Os meus decks') : tx('Os meus decks de {f}', { f: F.name })} <span className="muted">({mine.length})</span></h4>
          <div className="opp-list">{mine.map(o => <button key={o.id} className={`opp ${has('meus', o.id) ? 'on' : ''}`} onClick={() => add('meus', o)}>+ {o.name}{casual && <span className="muted"> · {FORMAT[o.format]?.name || o.format}</span>} {!casual && <Stars r={stars[rkey('meus', o.id)]} />}</button>)}{!mine.length && <span className="muted small">{tx('Nenhum deck teu neste formato.')}</span>}</div>
          <h4>{tx('Do meta')} {casual ? <select className="tc-mf" value={mf} onChange={e => setMetaFmt(e.target.value)} aria-label={tx('Decks do meta de')}>{CASUAL_META.map(k => <option key={k} value={k}>{tx('de {f}', { f: FORMAT[k]?.name || k })}</option>)}</select> : null} <span className="muted">({meta.length})</span></h4>
          <div className="opp-list">{meta.map(o => <button key={o.id} className={`opp ${has('meta', o.id) ? 'on' : ''}`} onClick={() => add('meta', o)}>+ {o.name} {o.share ? <span className="muted">{Math.round(o.share * 100)}%</span> : null} <Stars r={stars[rkey('meta', o.id)]} /></button>)}{!meta.length && <span className="muted small">{tx('Sem decks do meta para este formato.')}</span>}</div>
          <div className="tc-diff">
            <span className="small">{tx('Dificuldade:')}</span>
            <select value={allDiff} onChange={e => { setAllDiff(e.target.value); setPlayers(p => p.map(x => ({ ...x, difficulty: e.target.value }))) }} aria-label={tx('Dificuldade de todos')}>{diffs.filter(d => d.id !== 'random').map(d => <option key={d.id} value={d.id}>{tx('todos: {d}', { d: dLabel(d) })}</option>)}</select>
            <button onClick={randomDiffs} disabled={!n}>{tx('🎲 uma ao acaso a cada um')}</button>
          </div>
        </div>
      </div>
      {n > 0 && <div className="tc-players">{players.map((p, k) => (
        <div key={p.key} className={`tp-card ${p.me ? 'me' : ''}`} style={{ '--edge': edge(p.colors) }}>
          <div className="tp-art">{data.byName.get(p.cover) ? <img src={img(data.byName.get(p.cover), 'art_crop')} alt="" loading="lazy" /> : <span>✦</span>}<i className="tp-seed" title="seed">{seeding === 'ordem' ? k + 1 : '?'}</i><span className="tp-src">{p.src === 'meus' ? tx('meu') : 'meta'}{casual && p.fmt ? ` · ${FORMAT[p.fmt]?.name || p.fmt}` : ''}</span></div>
          <div className="tp-body">
            <b title={p.name}>{p.name}</b>
            <span className="dbox-meta">{p.colors ? <Mana cost={[...p.colors].map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}{stars[rkey(p.src, p.ref)] ? <Stars r={stars[rkey(p.src, p.ref)]} /> : !casual && <span className="muted small">{tx('sem rating')}</span>}</span>
            <select value={p.difficulty} onChange={e => setP(k, { difficulty: e.target.value })} aria-label={tx('Dificuldade de {d}', { d: p.name })} title={DIFF_INFO[p.difficulty]?.resumo}>{diffs.filter(d => d.id !== 'random').map(d => <option key={d.id} value={d.id}>{dLabel(d)}</option>)}</select>
            <span className="row-btns">{p.src === 'meus' && <button className={`me-btn ${p.me ? 'on' : ''}`} onClick={() => setPlayers(ps => ps.map((x, i) => ({ ...x, me: i === k ? !x.me : false })))} aria-pressed={!!p.me} title={tx('É o teu deck: segues o percurso dele no torneio')}>{p.me ? tx('★ eu') : tx('☆ eu')}</button>}{seeding === 'ordem' && <><button onClick={() => move(k, -1)} disabled={!k} aria-label={tx('Subir')}>▲</button><button onClick={() => move(k, 1)} disabled={k === n - 1} aria-label={tx('Descer')}>▼</button></>}<button className="link small" onClick={() => setPlayers(x => x.filter((_, i) => i !== k))}>{tx('tirar')}</button></span>
          </div>
        </div>
      ))}</div>}
      <div className="row-btns tc-go">
        <button className="primary" onClick={start} disabled={busy || n < TYPES[type][1] || n > max}>{tx('🏆 Começar o torneio')}</button>
        <span className="small muted">{n < TYPES[type][1] ? tx('Faltam {k} decks (mínimo {m}).', { k: TYPES[type][1] - n, m: TYPES[type][1] }) : tx('{p} partidas · ≈ {g} jogos · ≈ {t} min (um jogo de cada vez no Forge)', { p: matches, g: games, t: Math.max(1, Math.round((games * MIN_PER_GAME * (type === 'mesas' ? 2 : 1)) / 5) * 5) })}</span>
        {err && <span className="small bad-t">{err}</span>}
      </div>
    </section>
  )
}

// ---------- ao vivo ----------

// onde está uma partida, para a frase do «meu deck»: «Estás nas meias-finais», «Foste eliminado nos quartos»
const where = (m, k) => (!m ? '' : m.b === 'W' ? (m.r === k ? tx('na final') : m.r === k - 1 ? tx('nas meias-finais') : m.r === k - 2 ? tx('nos quartos de final') : tx('na {r}.ª ronda', { r: m.r }))
  : m.b === 'L' ? tx('na chave dos vencidos (ronda {r})', { r: m.r }) : m.b === '3' ? tx('no jogo do 3.º lugar') : m.r === 1 ? tx('na grande final') : tx('na 2.ª final'))
const place = p => (p[0] === p[1] ? tx('{p}.º', { p: p[0] }) : tx('{a}.º–{b}.º', { a: p[0], b: p[1] }))
const MEDAL = ['🥇', '🥈', '🥉']
const Fmt = ({ f }) => (f ? <span className="fmt-tag">{FORMAT[f]?.name || f}</span> : null)  // formato de cada deck (modo casual)
const roundName = (m, k) => (m.b === 'W' ? (m.r === k ? tx('Final') : m.r === k - 1 ? tx('Meias-finais') : m.r === k - 2 ? tx('Quartos de final') : tx('Ronda {r}', { r: m.r }))
  : m.b === 'L' ? tx('Vencidos · ronda {r}', { r: m.r }) : m.b === '3' ? tx('3.º lugar') : m.r === 1 ? tx('Grande final') : tx('2.ª final'))

function Live({ data, tid, onGone }) {
  const [t, setT] = useState(null)
  const [err, setErr] = useState('')
  const [watch, setWatch] = useState(null)  // {gid, game, deckName, score}
  const [follow, setFollowS] = useState(() => ls('grimorio.torneio.seguir') !== '0')
  const setFollow = v => { setFollowS(v); ls('grimorio.torneio.seguir', v ? '1' : '0') }
  const [pause, setPause] = useState(() => { try { return JSON.parse(localStorage.getItem('grimorio.pausa')) || { secs: 5, auto: true } } catch { return { secs: 5, auto: true } } })
  const setPausePref = v => { setPause(v); try { localStorage.setItem('grimorio.pausa', JSON.stringify(v)) } catch { /* sem armazenamento */ } }
  const [onlyMine, setOnlyMineS] = useState(() => ls('grimorio.torneio.meus') === '1')
  const setOnlyMine = v => { setOnlyMineS(v); ls('grimorio.torneio.meus', v ? '1' : '0') }
  const lastSeen = useRef(null)
  // sons: partida acabada e campeão (só quando muda, não ao abrir um torneio já acabado)
  const heard = useRef(null)
  const ding = x => {
    const done = (x.matches || []).filter(m => m.st === 'done').length
    if (heard.current?.tid === tid) {
      if (x.status === 'done' && heard.current.status !== 'done' && x.champion != null) play('champion')
      else if (done > heard.current.done) play('match')
    }
    heard.current = { tid, done, status: x.status }
  }
  const going = t && (t.status === 'running' || t.status === 'paused')
  useEffect(() => {
    let off = false, timer
    const tick = () => j(`/api/tournaments/${tid}`).then(x => { if (!off) { setT(x); setErr(''); ding(x); if (x.status === 'running' || x.status === 'paused') timer = setTimeout(tick, 3000) } })
      .catch(e => { if (!off) { setErr(e.message); timer = setTimeout(tick, 6000) } })
    tick()
    return () => { off = true; clearTimeout(timer) }
  }, [tid])
  const P = t?.players || []
  const games = useMemo(() => (t ? t.matches.flatMap(m => m.g.map((x, k) => ({ ...x, m, k }))).sort((a, b) => a.id - b.id) : []), [t])
  const fmt = FORMAT[t?.format] || FORMAT.modern
  const fl = useMemo(() => (onlyMine && t?.me != null ? games.filter(x => x.m.p.includes(t.me)) : games), [games, onlyMine, t?.me])  // o que se segue
  const openGame = async x => {
    try {
      const g = await j(`/api/tournaments/${tid}/games/${x.id}`)
      const names = g.seats.map(i => P[i]?.name || '?'), m = x.m
      const prev = m.g.slice(0, x.k).filter(y => !y.x)
      const score = names.length === 2 ? { a: prev.filter(y => y.w === g.seats[0]).length, b: prev.filter(y => y.w === g.seats[1]).length, g: prev.length + 1, bo: t.bo, serie: 1, series: 1, sw: 0, sl: 0, k: 1, total: 1 } : null
      const mk = t.me == null ? -1 : g.seats.indexOf(t.me)
      setWatch({ gid: x.id, deckName: names[0], pov: mk >= 0 ? 'abcd'[mk] : null, score, formats: t.casual ? Object.fromEntries(g.seats.map((i, k) => ['abcd'[k], FORMAT[P[i]?.format]?.name || P[i]?.format])) : null, game: { ...g, g: x.k + 1, opp: names[1], ...(names.length > 2 && { opps: Object.fromEntries(names.slice(1).map((nm, k) => ['bcd'[k], nm])) }), startLife: t.casual ? baseLife(t.format, names.length) : fmt.cmd ? 40 : 20 } })
    } catch (e) { setErr(e.message) }
  }
  // seguir ao vivo: abre cada jogo novo assim que acaba (se não estiveres já a ver um)
  useEffect(() => {
    const top = fl.length ? fl[fl.length - 1].id : 0
    if (lastSeen.current !== null && top > lastSeen.current && follow && !watch) openGame(fl[fl.length - 1])
    lastSeen.current = top
  }, [fl]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <section className="card">{err ? <p className="bad-t">{err}</p> : <p><span className="spin-dot" /> {tx('A abrir o torneio…')}</p>}</section>
  const act = async a => { try { await post(`/api/tournaments/${tid}/${a}`); setT(await j(`/api/tournaments/${tid}`)) } catch (e) { setErr(e.message) } }
  const del = async () => { if (!confirm(tx('Apagar o torneio «{t}» e todos os jogos dele?', { t: t.name }))) return; await j(`/api/tournaments/${tid}`, { method: 'DELETE' }); onGone() }
  if (watch) {
    const i = fl.findIndex(x => x.id === watch.gid)
    return <Replay key={watch.gid} data={data} game={watch.game} deckName={watch.deckName} pov={watch.pov} track score={watch.score} formats={watch.formats} onBack={() => setWatch(null)} backLabel={tx('← Voltar ao torneio')}
      live={going && follow && i >= 0 && i === fl.length - 1} speed0={pause.speed} onSpeed={v => setPausePref({ ...pause, speed: v })} hands={pause.hands || 'ambas'} onHands={h => setPausePref({ ...pause, hands: h })}
      next={follow && i >= 0 ? { has: i < fl.length - 1, go: () => openGame(fl[i + 1]), secs: pause.secs, auto: pause.auto } : null} />
  }
  const lm = t.live && t.matches.find(m => m.id === t.live.match)
  const nameOf = i => (i == null ? '—' : P[i]?.name)
  const k = Math.max(...t.matches.filter(m => m.b === 'W').map(m => m.r), 1)
  const num = Object.fromEntries(t.matches.map((m, i) => [m.id, i + 1]))
  const tools = { data, P, live: t.live, num, onGame: openGame, me: t.me, casual: t.casual }
  const bracket = t.type === 'elim' || t.type === 'dupla'
  // «o meu deck»: onde está, se caiu e o lugar final (tournament.py me_state)
  const ms = t.me_state, mm = ms?.match && t.matches.find(m => m.id === ms.match)
  const opp = mm ? mm.p.filter(x => x !== t.me).map(x => (x === -1 ? tx('adversário por decidir') : nameOf(x))).join(', ') : ''
  const mySc = mm && mm.p.length === 2 && mm.g.length ? ` · ${mm.w[mm.p.indexOf(t.me)]}–${mm.w[1 - mm.p.indexOf(t.me)]}` : ''
  const myPos = t.standings.findIndex(s => s.i === t.me) + 1
  const meLine = !ms ? null : ms.phase === 'done' ? (ms.place[0] === 1 ? tx('Ganhaste o torneio!') : tx('Ficaste em {p} lugar', { p: place(ms.place) }))
    : ms.phase === 'out' ? tx('Foste eliminado {w} por {o}', { w: where(mm, k), o: nameOf(ms.by) })
      : `${bracket ? tx('Estás {w}', { w: where(mm, k) }) : tx('Vais em {p}.º com {s} pts', { p: myPos, s: t.standings[myPos - 1]?.pts })}${mm ? ` · ${mm.b === 'P' ? tx('mesa com {o}', { o: opp }) : tx('contra {o}', { o: opp })}${mySc}${t.live?.match === mm.id ? ` — ${tx('a jogar agora')}` : ''}` : ''}`
  return (
    <div className="tour-live">
      <section className="card tl-head">
        <div className="row-btns">
          <h3>🏆 {t.name}</h3>
          <span className={`tl-status ${t.status}`}>{STATUS[t.status] || t.status}</span>
          <span className="muted small">{TYPES[t.type]?.[0]} · {t.casual ? tx('casual, regras de {f}', { f: FORMAT[t.format]?.name || t.format }) : FORMAT[t.format]?.name || t.format} · {t.type === 'mesas' ? tx('um jogo por mesa') : `Bo${t.bo}`} · {P.length} decks{t.rounds ? ` · ${tx('{n} ronda|{n} rondas', { n: t.rounds })}` : ''} · {when(t.ts)}</span>
          <span className="tl-act">
            {t.status === 'running' && <button onClick={() => act('pause')} title={tx('O jogo em curso acaba e fica registado')}>{tx('❚❚ Pausar')}</button>}
            {(t.status === 'paused' || t.status === 'error') && <button className="primary" onClick={() => act('resume')}>{tx('▶ Retomar')}</button>}
            {going && <button onClick={() => confirm(tx('Cancelar o torneio? O jogo em curso pára já.')) && act('cancel')}>{tx('■ Cancelar')}</button>}
            <button className="link small" onClick={del}>{tx('apagar')}</button>
          </span>
        </div>
        <div className="row-btns tl-opts">
          <label className="chk small"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> {tx('Seguir ao vivo (abre cada jogo quando acaba)')}</label>
          <label className="small">{tx('Pausa entre jogos')} <select value={pause.secs} onChange={e => setPausePref({ ...pause, secs: +e.target.value })} disabled={!pause.auto}>{[2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} s</option>)}</select></label>
          <label className="chk small"><input type="checkbox" checked={!pause.auto} onChange={e => setPausePref({ ...pause, auto: !e.target.checked })} /> {tx('não avançar sozinho')}</label>
          {t.me != null && <label className="chk small"><input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> {tx('seguir só os meus jogos')}</label>}
          {fl.length > 0 && <button className="small" onClick={() => openGame(fl[fl.length - 1])}>{onlyMine && t.me != null ? tx('▶ último jogo meu') : tx('▶ último jogo')}</button>}
        </div>
        {meLine && <p className={`me-line ${ms.phase}`}><Thumb data={data} p={P[t.me]} /><span><small>{tx('O meu deck · {d}', { d: P[t.me]?.name })}</small><b>{ms.phase === 'done' ? `${MEDAL[ms.place[0] - 1] || '🎖'} ` : ''}{meLine}</b></span></p>}
        {lm && <p className="tl-now"><span className="spin-dot" /> {t.live.status === 'queued' ? tx('Na fila do Forge (posição {p})', { p: t.live.position }) : tx('A jogar')}: <b>#{num[lm.id]}</b> {(t.live.seats || lm.p).map(nameOf).join(' vs ')} · {tx('jogo {g}', { g: lm.g.length + 1 })}{lm.p.length === 2 && t.bo > 1 ? ` · ${lm.w[0]}–${lm.w[1]}` : ''}{Object.keys(lm.sb || {}).length > 0 && <span className="muted" title={Object.entries(lm.sb).map(([i, sw]) => `${nameOf(+i)}: ${sw.map(s => `+${s.q} ${s.in} −${s.q} ${s.out}`).join(', ')}`).join('\n')}> · {tx('⇄ com sideboard:')} {Object.keys(lm.sb).map(i => nameOf(+i)).join(', ')}</span>}</p>}
        {!lm && t.status === 'running' && <p className="tl-now muted"><span className="spin-dot" /> {tx('À espera da vez no Forge…')}</p>}
        {t.error && <p className="small bad-t">{tx(t.error)}</p>}
        {err && <p className="small bad-t">{err}</p>}
      </section>
      {ms?.phase === 'out' && going && <section className="me-out" role="status"><b>{tx('💀 Foste eliminado {w}', { w: where(mm, k) })}</b><span>{mm?.g.length ? tx('{o} ganhou-te a partida por {s}.', { o: nameOf(ms.by), s: `${mm.w[mm.p.indexOf(ms.by)]}–${mm.w[mm.p.indexOf(t.me)]}` }) : tx('{o} ganhou-te a partida.', { o: nameOf(ms.by) })} {tx('O torneio continua sem ti — vê quem fica com o título.')}</span></section>}
      {t.podium?.length > 0 && <Podium data={data} t={t} />}
      {bracket ? <Bracket t={t} k={k} {...tools} /> : <div className="tl-grid"><Standings t={t} {...tools} /><Rounds t={t} {...tools} /></div>}
    </div>
  )
}

function Thumb({ data, p }) {
  const c = p && data.byName.get(p.cover)
  return <span className="tp-thumb" style={{ '--edge': edge(p?.colors || '') }}>{c ? <img src={img(c, 'art_crop')} alt="" loading="lazy" /> : null}</span>
}

function GameChips({ m, onGame, P }) {
  return m.g.map((x, k) => <button key={x.id} className={`gchip ${x.x ? 'x' : x.w == null ? '' : 'w'}`} onClick={() => onGame({ ...x, m, k })} title={`${x.x ? tx('O Forge falhou neste jogo (repetido)') : x.w == null ? tx('Empate') : tx('Ganhou {d}', { d: P[x.w]?.name })}${x.sb ? ` · ${tx('com sideboard')}` : ''}`}>{tx('J{g}', { g: k + 1 })}{x.t ? ` · T${x.t}` : ''}{x.sb ? ' ⇄' : ''} ▶</button>)
}

// trocas de sideboard de cada jogo (tournament.py: g[k].sb = {participante: [{in, out, q, why, outWhy}]})
function SideWhy({ m, P }) {
  const sbs = m.g.flatMap((x, k) => Object.entries(x.sb || {}).flatMap(([i, sw]) => sw.map((s, n) => ({ ...s, k, i: +i, n }))))
  return sbs.length > 0 && (
    <details className="tm-sb"><summary>⇄ {tx('Porque mudou o sideboard')}</summary>
      <ul className="why">{sbs.map(s => <li key={`${s.k}-${s.i}-${s.n}`}><b>{tx('J{g}', { g: s.k + 1 })} · {P[s.i]?.name}</b>: {tx('entra {q}× {i}', { q: s.q, i: s.in })} <span className="muted">({s.why})</span>; {tx('sai {x}', { x: s.out })} <span className="muted">({s.outWhy})</span></li>)}</ul>
    </details>
  )
}

function Match({ m, data, P, live, num, onGame, label, me, casual }) {
  const now = live?.match === m.id
  const slot = k => {
    const i = m.p[k], s = m.src?.[k]
    if (i === -1) return <div className="ts pend" key={`${k}-p`}><span className="tp-thumb" /><span className="muted">{s ? (s[1] === 'w' ? tx('vencedor de #{m}', { m: num[s[0]] }) : tx('vencido de #{m}', { m: num[s[0]] })) : '—'}</span></div>
    if (i === null) return <div className="ts bye" key={`${k}-b`}><span className="tp-thumb" /><span className="muted">{tx('— isento —')}</span></div>
    const res = m.st === 'done' && !m.bye ? (m.win === i ? 'win' : m.win == null ? 'draw' : 'lose') : m.bye ? 'win' : ''
    return (
      <div className={`ts ${res} ${i === me ? 'me' : ''}`} key={`${k}-${i}`} title={P[i]?.name}>
        <Thumb data={data} p={P[i]} /><i className="ts-seed">{i + 1}</i><span className="ts-n">{P[i]?.name}</span>{i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[i]?.format} />}
        {!m.bye && m.st !== 'wait' && <b className="ts-sc">{m.w[k]}</b>}
      </div>
    )
  }
  return (
    <div className={`tm ${m.st} ${now ? 'now' : ''} ${m.bye ? 'isbye' : ''} ${me != null && m.p.includes(me) ? 'mine' : ''}`} data-mid={m.id}>
      <div className="tm-h"><span>#{num[m.id]}{label ? ` · ${label}` : ''}</span>{now && <span className="livepill">{tx('● a jogar')}</span>}{m.tb ? <span className="muted" title={tx('Empatados depois dos jogos extra: passa o melhor seed')}>{tx('desempate pelo seed')}</span> : null}{m.note && <span className="muted" title={tx(m.note)}>⚠</span>}</div>
      {[0, 1].map(slot)}
      {m.g.length > 0 && <div className="tm-g"><GameChips m={m} onGame={onGame} P={P} /></div>}
      <SideWhy m={m} P={P} />
    </div>
  )
}

function Bracket({ t, k, ...tools }) {
  const ref = useRef(null)
  const [paths, setPaths] = useState([])
  const secs = t.type === 'dupla' ? [['W', tx('Chave dos vencedores')], ['L', tx('Chave dos vencidos')], ['F', tx('Final')]] : [['W', null]]
  // linhas entre partidas (vencedor -> partida seguinte), medidas no DOM depois de desenhar
  useLayoutEffect(() => {
    const draw = () => {
      const box = ref.current
      if (!box) return
      const r0 = box.getBoundingClientRect(), out = []
      for (const m of t.matches) for (const [sid, wl] of m.src || []) {
        const a = box.querySelector(`[data-mid="${sid}"]`), b = box.querySelector(`[data-mid="${m.id}"]`)
        if (!a || !b || wl !== 'w' || a.closest('.tb-sec') !== b.closest('.tb-sec')) continue
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
        const x1 = ra.right - r0.left, y1 = ra.top + ra.height / 2 - r0.top, x2 = rb.left - r0.left, y2 = rb.top + rb.height / 2 - r0.top, xm = (x1 + x2) / 2
        const src = t.matches.find(x => x.id === sid)
        out.push({ d: `M${x1},${y1} H${xm} V${y2} H${x2}`, on: src.st === 'done' && !src.bye, key: `${sid}>${m.id}` })
      }
      setPaths(out)
    }
    draw()
    addEventListener('resize', draw)
    return () => removeEventListener('resize', draw)
  }, [t])
  return (
    <section className="card tb" ref={ref}>
      <svg className="tb-lines" aria-hidden="true">{paths.map(p => <path key={p.key} d={p.d} className={p.on ? 'on' : ''} />)}</svg>
      {secs.map(([b, title]) => {
        const ms = t.matches.filter(m => m.b === b || (b === 'W' && m.b === '3'))
        const cols = [...new Set(ms.filter(m => m.b !== '3').map(m => m.r))].sort((x, y) => x - y)
        return (
          <div key={b} className="tb-sec">
            {title && <h4>{title}</h4>}
            <div className="tb-cols">{cols.map(r => {
              const col = ms.filter(m => m.r === r && m.b !== '3'), third = b === 'W' && r === k ? ms.find(m => m.b === '3') : null
              return (
                <div key={r} className="tb-col">
                  <h5>{roundName(col[0], k)}</h5>
                  <div className="tb-ms">{col.map(m => <Match key={m.id} m={m} {...tools} />)}</div>
                  {third && <div className="tb-third"><Match m={third} {...tools} label={tx('3.º lugar')} /></div>}
                </div>
              )
            })}</div>
          </div>
        )
      })}
    </section>
  )
}

function Standings({ t, data, P, me, casual }) {
  const pods = t.type === 'mesas'
  return (
    <section className="card">
      <h4>{tx('Classificação')}</h4>
      <table className="lab-table ts-table"><thead><tr><th>#</th><th>Deck</th><th>{tx('Pts')}</th>{pods ? <><th>{tx('1.ºs lugares')}</th><th>{tx('Mesas')}</th></> : <><th>{tx('V-D-E')}</th><th title={tx('% de vitórias dos adversários')}>OMW%</th><th title={tx('% de jogos ganhos')}>GW%</th></>}<th>{tx('Dificuldade')}</th></tr></thead>
        <tbody>{t.standings.map((s, k) => (
          <tr key={s.i} className={`${t.champion === s.i ? 'champ-row' : ''} ${s.i === me ? 'me-row' : ''}`}><td>{k + 1}</td><td><span className="ts-name"><Thumb data={data} p={P[s.i]} /> {P[s.i]?.name}{s.i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[s.i]?.format} />}</span></td><td><b>{s.pts}</b></td>
            {pods ? <><td>{s.v}</td><td>{s.v + s.d + s.e}</td></> : <><td>{s.v}-{s.d}-{s.e}{s.bye ? <small className="muted"> {tx('({b} isento)', { b: s.bye })}</small> : null}</td><td>{s.opp.length ? pct(s.omw) : '—'}</td><td>{s.gw + s.gl ? pct(s.gwp) : '—'}</td></>}
            <td className="small muted">{DIFF_INFO[P[s.i]?.difficulty]?.label || P[s.i]?.difficulty}</td></tr>
        ))}</tbody></table>
    </section>
  )
}

function Rounds({ t, data, P, live, num, onGame, me, casual }) {
  const rs = [...new Set(t.matches.map(m => m.r))].sort((a, b) => b - a)  // a ronda mais recente primeiro
  return (
    <section className="card">
      <h4>{tx('Rondas')} {t.rounds ? <span className="muted small">{tx('{a} de {b}', { a: rs.length, b: t.rounds })}</span> : null}</h4>
      {rs.map(r => (
        <div key={r} className="tr-round"><h5>{tx('Ronda {r}', { r })}</h5>
          <div className="tr-ms">{t.matches.filter(m => m.r === r).map(m => m.b === 'P' ? (
            <div key={m.id} className={`tm pod ${m.st} ${live?.match === m.id ? 'now' : ''} ${m.p.includes(me) ? 'mine' : ''}`} data-mid={m.id}>
              <div className="tm-h"><span>{tx('Mesa {m}', { m: m.id.split('-')[1] })}</span>{live?.match === m.id && <span className="livepill">{tx('● a jogar')}</span>}</div>
              {(m.pl || m.p).map((i, k) => <div key={i} className={`ts ${m.pl ? (k === 0 ? 'win' : '') : ''} ${i === me ? 'me' : ''}`}><Thumb data={data} p={P[i]} /><i className="ts-seed">{m.pl ? tx('{p}.º', { p: k + 1 }) : i + 1}</i><span className="ts-n">{P[i]?.name}</span>{i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[i]?.format} />}{m.st === 'done' && <b className="ts-sc">{m.pl ? `+${k === 0 ? 3 : m.pl.length - 1 - k}` : '+1'}</b>}</div>)}
              {m.g.length > 0 && <div className="tm-g"><GameChips m={m} onGame={onGame} P={P} /></div>}
            </div>
          ) : <Match key={m.id} m={m} data={data} P={P} live={live} num={num} onGame={onGame} me={me} casual={casual} />)}</div>
        </div>
      ))}
    </section>
  )
}

// pódio: 2.º · 1.º · 3.º (sem jogo de 3.º lugar os dois das meias-finais partilham o bronze)
function Podium({ data, t }) {
  const s1 = t.standings.find(x => x.i === t.champion)
  const step = n => (
    <div className={`pd-step pd-${n}`}>
      <div className="pd-decks">{t.podium.filter(x => x.place === n).map(x => {
        const c = data.byName.get(x.cover)
        return (
          <div key={x.i} className={`pd-deck ${x.i === t.me ? 'me' : ''}`} style={{ '--edge': edge(x.colors || '') }} title={x.name}>
            {c ? <img src={img(c, 'art_crop')} alt="" /> : <span className="pd-noart">✦</span>}
            <b>{n === 1 ? '👑 ' : ''}{x.name}</b>
            <span className="pd-sub">{x.i === t.me && <i className="me-tag">{tx('eu')}</i>}{t.casual && <Fmt f={x.format} />}{n === 1 && s1 ? <small className="muted">{tx('{v}V {d}D', { v: s1.v, d: s1.d })}{s1.e ? ` ${tx('{e}E', { e: s1.e })}` : ''}</small> : null}</span>
          </div>
        )
      })}</div>
      <div className="pd-block"><span>{MEDAL[n - 1]}</span><b>{tx('{p}.º', { p: n })}</b></div>
    </div>
  )
  return (
    <section className="card podium">
      <div className="champ-sparks" aria-hidden="true">{Array.from({ length: 14 }, (_, k) => <i key={k} style={{ '--k': k }} />)}</div>
      <h3>{tx('Pódio')} <span className="muted small">{t.name}</span></h3>
      <div className="pd-row">{step(2)}{step(1)}{step(3)}</div>
    </section>
  )
}

// ---------- registo ----------

function Registry({ data, list, open, reload }) {
  const del = async x => { if (!confirm(tx('Apagar o torneio «{t}» e todos os jogos dele?', { t: x.name }))) return; await j(`/api/tournaments/${x.id}`, { method: 'DELETE' }); reload() }
  return (
    <div className="reg-grid">
      <section className="card">
        <h3>{tx('Registo de torneios')} <span className="muted small">{list.length}</span></h3>
        {!list.length && <p className="muted">{tx('Ainda não há torneios. Cria um em «✦ Criar».')}</p>}
        <ul className="lib-list tour-reg">{list.map(x => (
          <li key={x.id}>
            <span className={`tl-status ${x.status}`}>{STATUS[x.status] || x.status}</span>
            <span><b>{x.name}</b><br /><small className="muted">{TYPES[x.type]?.[0]} · {x.casual ? tx('casual, regras de {f}', { f: FORMAT[x.format]?.name || x.format }) : FORMAT[x.format]?.name || x.format} · {x.n} decks · {when(x.ts)}</small></span>
            {x.podium?.length ? <span className="mini-pod">{x.podium.map(p => (
              <span key={p.i} className={`mp mp-${p.place} ${p.me ? 'me' : ''}`} title={`${tx('{p}.º', { p: p.place })} ${p.name}${p.me ? ` (${tx('o meu deck')})` : ''}`}><Thumb data={data} p={p} /><i>{MEDAL[p.place - 1]}</i><span>{p.name}</span></span>
            ))}</span> : <span className="muted small">{tx('sem pódio')}</span>}
            <span className="row-btns"><button onClick={() => open(x.id)}>{tx('Abrir')}</button><button className="link small" onClick={() => del(x)}>{tx('apagar')}</button></span>
          </li>
        ))}</ul>
      </section>
      <Fame data={data} list={list} />
    </div>
  )
}

// hall da fama: títulos e pódios por deck (os meus e os do meta), por formato do torneio ou só os casuais
function Fame({ data, list }) {
  const [f, setF] = useState('')
  const [who, setWho] = useState('todos')
  const fmts = [...new Set(list.filter(x => x.podium && !x.casual).map(x => x.format))]
  const rows = {}
  for (const x of list) if (x.podium && (!f || (f === 'casual' ? x.casual : !x.casual && x.format === f))) for (const p of x.podium) {
    const r = (rows[`${p.src}:${p.ref}`] ||= { ...p, m: [0, 0, 0] })
    r.m[p.place - 1]++
  }
  const top = Object.values(rows).filter(r => who === 'todos' || (who === 'meus') === (r.src === 'meus'))
    .sort((a, b) => b.m[0] - a.m[0] || b.m[1] - a.m[1] || b.m[2] - a.m[2] || a.name.localeCompare(b.name))
  return (
    <section className="card fame">
      <h3>{tx('🏛 Hall da fama')}</h3>
      <div className="row-btns">
        <select value={f} onChange={e => setF(e.target.value)} aria-label={tx('Formato')}><option value="">{tx('Todos os formatos')}</option>{fmts.map(k => <option key={k} value={k}>{FORMAT[k]?.name || k}</option>)}{list.some(x => x.casual && x.podium) && <option value="casual">{tx('Casuais')}</option>}</select>
        <span className="seg">{[['todos', tx('Todos')], ['meus', tx('Os meus')], ['meta', tx('Do meta')]].map(([k, l]) => <button key={k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{l}</button>)}</span>
      </div>
      {!top.length ? <p className="muted small">{f ? tx('Ainda ninguém subiu ao pódio neste formato.') : tx('Ainda ninguém subiu ao pódio.')}</p> : (
        <table className="lab-table ts-table"><thead><tr><th>Deck</th><th title={tx('Torneios ganhos')}>🥇</th><th>🥈</th><th>🥉</th><th>{tx('Pódios')}</th></tr></thead>
          <tbody>{top.map(r => (
            <tr key={`${r.src}:${r.ref}`} className={r.src === 'meus' ? 'me-row' : ''}><td><span className="ts-name"><Thumb data={data} p={r} /> {r.name}{r.src === 'meus' && <i className="me-tag">{tx('meu')}</i>}</span></td>
              <td><b>{r.m[0] || '—'}</b></td><td>{r.m[1] || '—'}</td><td>{r.m[2] || '—'}</td><td>{r.m[0] + r.m[1] + r.m[2]}</td></tr>
          ))}</tbody></table>
      )}
    </section>
  )
}
