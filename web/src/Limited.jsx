// Coliseu › Draft: booster draft e selado com o motor do Forge (limited.py + GrimorioDraft.java). Tu (ou só bots) fazes o
// draft numa mesa de 8 com packs reais do set; os bots escolhem e montam os decks com a IA do Forge; o teu pool vira um
// deck Limitado no Construir e no fim joga-se um torneio com os 8 decks.
import { useEffect, useMemo, useRef, useState } from 'react'
import { img } from './data.js'
import { lookup } from './game.js'
import { loadSet } from './Draft.jsx'
import { DIFF_INFO } from './difficulty.js'
import { tx, num } from './i18n.js'

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
  return j
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })
const KIND = { draft: tx('Booster draft'), sealed: tx('Selado') }
const STATUS = { drafting: tx('a decorrer'), built: tx('pronto para o torneio'), tournament: tx('torneio criado'), error: tx('parou') }
const COLS = 'WUBRG'
const pref = (k, d) => { try { return JSON.parse(localStorage.getItem(`grimorio.ld.${k}`)) ?? d } catch { return d } }
const keep = (k, v) => { try { localStorage.setItem(`grimorio.ld.${k}`, JSON.stringify(v)) } catch { /* sem armazenamento */ } }

// imagem de uma carta do pack: a do Grimório pelo nome; cartas que ainda não estão nos dados vêm da Scryfall pela edição
const picOf = (data, x) => { const c = lookup(data, x.n); return c ? img(c, 'normal') : `https://api.scryfall.com/cards/${String(x.s).toLowerCase()}/${encodeURIComponent(x.cn)}?format=image&version=normal` }

export default function LimitedView({ data, openDeck, goTournament }) {
  const [evs, setEvs] = useState(null)
  const [cur, setCur] = useState(null)  // id do evento aberto
  const refresh = () => api('/api/limited').then(setEvs).catch(() => setEvs([]))
  useEffect(() => { refresh() }, [])
  if (cur) return <Event key={cur} id={cur} data={data} openDeck={openDeck} goTournament={goTournament} onBack={() => { setCur(null); refresh() }} />
  return (
    <div className="view limited">
      <Setup onStart={id => setCur(id)} />
      {evs?.length > 0 && (
        <section className="card">
          <h3>{tx('Os teus drafts e selados')}</h3>
          <ul className="ld-list">{evs.map(e => (
            <li key={e.id}>
              <b>{KIND[e.kind]} {[...new Set(e.sets)].join('/')}</b>
              <span className="muted small">{new Date(e.ts * 1000).toLocaleString()} · {e.human ? tx('tu + bots') : tx('só bots')} · {STATUS[e.status] || e.status}</span>
              {e.status !== 'error' && <button className="small" onClick={() => setCur(e.id)}>{tx('Abrir')}</button>}
            </li>
          ))}</ul>
        </section>
      )}
    </div>
  )
}

function Setup({ onStart }) {
  const [sets, setSets] = useState(null), [err, setErr] = useState('')
  const [kind, setKind] = useState(() => pref('kind', 'draft'))
  const [code, setCode] = useState(() => pref('set', ''))
  const [human, setHuman] = useState(() => pref('human', true))
  const [n, setN] = useState(() => pref('n', 8))
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('/api/limited/sets').then(s => { setSets(s); if (!s.some(x => x.code === code)) setCode(s[0]?.code || '') }).catch(e => setErr(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (sets || []).filter(s => !q || `${s.code} ${s.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60), [sets, q])
  const start = async () => {
    setBusy(true); setErr('')
    keep('kind', kind); keep('set', code); keep('human', human); keep('n', n)
    try { onStart((await post('/api/limited', { kind, sets: [code], human, players: n })).id) } catch (e) { setErr(e.message); setBusy(false) }
  }
  const cur = sets?.find(s => s.code === code)
  return (
    <section className="card ld-setup">
      <h3>🎴 {tx('Draft e selado')}</h3>
      <p className="muted small">{tx('Packs reais do set, abertos pelo Forge. Os bots escolhem as cartas e montam os decks de 40 com a IA do Forge; no fim joga-se um torneio com todos.')}</p>
      <div className="seg">{Object.entries(KIND).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
      <p className="muted small">{kind === 'draft' ? tx('Mesa de 8: 3 packs, cada um passa de mão em mão; ficas com uma carta de cada vez.') : tx('Cada jogador abre 6 packs e monta o melhor deck de 40 que conseguir.')}</p>
      <label className="ld-set"><span>{tx('Set')}</span>
        {!sets ? <span className="muted small">{err ? '' : tx('A perguntar ao Forge que sets têm boosters… (até 40 s da primeira vez)')}</span> : <>
          <input type="search" placeholder={tx('Procurar set (nome ou código)')} value={q} onChange={e => setQ(e.target.value)} />
          <select value={code} onChange={e => setCode(e.target.value)} size={Math.min(8, shown.length || 1)}>
            {shown.map(s => <option key={s.code} value={s.code}>{s.name} ({s.code}) · {s.date.slice(0, 4)}</option>)}
          </select>
          {cur && <small className="muted">{tx('Escolhido: {s}', { s: `${cur.name} (${cur.code})` })}</small>}
        </>}
      </label>
      <div className="seg">
        <button className={human ? 'on' : ''} onClick={() => setHuman(true)}>🧙 {tx('Eu + bots')}</button>
        <button className={!human ? 'on' : ''} onClick={() => setHuman(false)}>🤖 {tx('Só bots (vejo)')}</button>
      </div>
      {kind === 'sealed' && <label className="ld-n">{tx('Jogadores')} <input type="number" min="2" max="16" value={n} onChange={e => setN(Math.max(2, Math.min(16, +e.target.value || 8)))} /></label>}
      {err && <p className="err small">{err}</p>}
      <button className="primary" disabled={!code || busy} onClick={start}>{busy ? tx('A abrir os boosters…') : kind === 'draft' ? tx('▶ Começar o draft') : tx('▶ Abrir os packs')}</button>
    </section>
  )
}

function Event({ id, data, openDeck, goTournament, onBack }) {
  const [st, setSt] = useState(null), [ev, setEv] = useState(null), [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const alive = useRef(true)
  // espera longa pelo pack seguinte (ou pelo fim)
  useEffect(() => {
    alive.current = true
    let since = 0
    const loop = async () => {
      while (alive.current) {
        try {
          const r = await api(`/api/limited/${id}?since=${since}`)
          if (!alive.current) return
          since = r.seq; setSt(r); setSel(null)
          if (r.ended) { if (r.status !== 'error') setEv(await api(`/api/limited/${id}/event`)); return }
        } catch (e) { if (alive.current) setErr(e.message); return }
      }
    }
    loop()
    return () => { alive.current = false }
  }, [id])
  const pick = async i => { setSt(s => ({ ...s, pack: null })); setSel(null); try { await post(`/api/limited/${id}/pick`, { i }) } catch (e) { setErr(e.message) } }
  const stop = async () => { try { await post(`/api/limited/${id}/stop`) } catch { /* já tinha acabado */ } onBack() }
  if (err) return <div className="view limited"><button onClick={onBack}>{tx('← Voltar')}</button><p className="err">{err}</p></div>
  if (ev) return <Built ev={ev} data={data} openDeck={openDeck} goTournament={goTournament} onBack={onBack} />
  const pack = st?.pack
  return (
    <div className="view limited">
      <div className="ld-bar">
        <button onClick={onBack}>{tx('← Voltar')}</button>
        {pack ? <b>{tx('Pack {r} de {n} · escolha {p}', { r: pack.round, n: pack.rounds, p: pack.pick })}</b> : <span className="muted">{st?.status === 'error' ? st.error : tx('O Forge está a abrir os boosters e os bots a escolher…')}</span>}
        <button className="link small danger" onClick={stop}>{tx('desistir')}</button>
      </div>
      {pack ? <Pack pack={pack} data={data} sel={sel} setSel={setSel} pick={pick} /> : <p className="ld-wait"><span className="spin-dot" /> {tx('Um momento…')}</p>}
    </div>
  )
}

function Pack({ pack, data, sel, setSel, pick }) {
  const code = pack.cards[0]?.s
  const [rt, setRt] = useState(null)
  useEffect(() => { if (code) loadSet(code).then(rows => setRt(new Map((rows || []).map(x => [x.name.split(' // ')[0], x])))) }, [code])
  const gih = x => rt?.get(x.n.split(' // ')[0])?.ever_drawn_win_rate
  const best = useMemo(() => { let b = -1, v = -1; pack.cards.forEach((x, k) => { const g = gih(x); if (g != null && g > v) { v = g; b = k } }); return b }, [pack, rt]) // eslint-disable-line react-hooks/exhaustive-deps
  const pool = useMemo(() => {
    const by = {}
    for (const x of pack.pool) { const c = lookup(data, x.n), k = !c ? '?' : c.mt === 'Land' ? 'L' : (c.co || '').length > 1 ? 'M' : (c.co || 'C'); (by[k] ||= []).push(x.n) }
    return by
  }, [pack, data])
  return (
    <div className="ld-draft">
      <div className="ld-pack">
        {pack.cards.map((x, k) => (
          <button key={k} className={`ld-card ${sel === k ? 'on' : ''}`} onClick={() => (sel === k ? pick(k) : setSel(k))} title={x.n}>
            <img src={picOf(data, x)} alt={x.n} />
            {gih(x) != null && <span className={`ld-gih ${k === best ? 'best' : ''}`} title={tx('Taxa de vitória pública (17lands) quando está na mão')}>{k === best ? '★ ' : ''}{num(gih(x) * 100, 1)}%</span>}
            {sel === k && <span className="ld-take">{tx('Tocar outra vez para escolher')}</span>}
          </button>
        ))}
      </div>
      <aside className="ld-pool">
        <h4>{tx('O teu pool')} <span className="muted">{pack.pool.length}</span></h4>
        {sel != null && <button className="primary" onClick={() => pick(sel)}>{tx('Escolher «{c}»', { c: pack.cards[sel].n })}</button>}
        {[...COLS, 'M', 'C', 'L', '?'].filter(k => pool[k]).map(k => (
          <div key={k} className="ld-grp"><b>{{ M: tx('Multicor'), C: tx('Incolor'), L: tx('Terrenos'), '?': '?' }[k] || k} {pool[k].length}</b><span className="small">{pool[k].join(' · ')}</span></div>
        ))}
      </aside>
    </div>
  )
}

function Built({ ev, data, openDeck, goTournament, onBack }) {
  const [deckId, setDeckId] = useState(ev.deck_id || null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [bo, setBo] = useState(() => pref('bo', 1)), [diff, setDiff] = useState(() => pref('diff', 'default'))
  const name = ev.kind === 'draft' ? tx('Draft') : tx('Selado')
  const makeDeck = async () => { const r = await post(`/api/limited/${ev.id}/deck`); setDeckId(r.deck_id); return r.deck_id }
  const build = async () => { try { openDeck(deckId || await makeDeck()) } catch (e) { setErr(e.message) } }
  const start = async () => {
    setBusy(true); setErr(''); keep('bo', bo); keep('diff', diff)
    try {
      if (ev.human) {
        const id = deckId || await makeDeck()
        const d = await api(`/api/decks/${id}`), n = Object.values(d.main || {}).reduce((a, b) => a + b, 0)
        if (n < 40) throw new Error(tx('O teu deck tem {n} cartas: no limitado são 40 ou mais. Monta-o primeiro.', { n }))
      }
      await post(`/api/limited/${ev.id}/tournament`, { type: 'suico', bo, difficulty: diff })
      goTournament()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  const cols = k => { const m = ev.players[k].deck.main || {}; return COLS.split('').filter(c => ({ W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' })[c] in m).join('') || 'C' }
  return (
    <div className="view limited">
      <div className="ld-bar"><button onClick={onBack}>{tx('← Voltar')}</button><b>{name} {[...new Set(ev.sets)].join('/')}</b></div>
      <section className="card">
        {ev.human ? <>
          <h3>{tx('O teu pool: {n} cartas', { n: ev.players[0].pool.length })}</h3>
          <p className="small">{tx('O Forge sugere um deck de 40 ({c}); o resto do pool fica no sideboard. Muda o que quiseres no Construir antes do torneio.', { c: cols(0) })}</p>
          <button onClick={build}>✎ {deckId ? tx('Abrir o meu deck no Construir') : tx('Montar o meu deck no Construir')}</button>
        </> : <h3>{tx('Os 8 decks estão prontos')}</h3>}
        <h4>{tx('Os bots')}</h4>
        <ul className="ld-bots">{ev.players.slice(ev.human ? 1 : 0).map(p => <li key={p.seat}>{tx('Bot {n}', { n: p.seat })} · <b>{cols(p.seat)}</b> <span className="muted small">{Object.entries(p.deck.main || {}).filter(([n]) => { const c = lookup(data, n); return c && c.mt !== 'Land' }).sort((a, b) => (lookup(data, b[0])?.r === 'm' || lookup(data, b[0])?.r === 'r') - (lookup(data, a[0])?.r === 'm' || lookup(data, a[0])?.r === 'r')).slice(0, 3).map(([n]) => n).join(' · ')}</span></li>)}</ul>
      </section>
      {ev.status === 'tournament' ? <section className="card"><p>{tx('O torneio já foi criado.')}</p><button className="primary" onClick={goTournament}>🏆 {tx('Ver o torneio')}</button></section> : (
        <section className="card ld-tour">
          <h3>🏆 {tx('Torneio')}</h3>
          <p className="muted small">{tx('Suíço com os {n} decks; o Forge joga todos os jogos e vês em direto.', { n: ev.players.length })}</p>
          <div className="seg">{[1, 3].map(b => <button key={b} className={bo === b ? 'on' : ''} onClick={() => setBo(b)}>{b === 1 ? tx('Jogo único') : tx('Melhor de 3')}</button>)}</div>
          <label>{tx('Bots')} <select value={diff} onChange={e => setDiff(e.target.value)}>{Object.entries(DIFF_INFO).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></label>
          {err && <p className="err small">{err}</p>}
          <button className="primary" disabled={busy} onClick={start}>{busy ? tx('A criar…') : tx('▶ Começar o torneio')}</button>
        </section>
      )}
    </div>
  )
}
