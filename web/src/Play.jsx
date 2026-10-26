// Coliseu › Jogar contra o Forge. Escolhes o adversário (meta, teus, de amigos ou da comunidade; em casual, de todos
// os formatos) e a dificuldade, e jogas na mesa do Grimório (ForgePlay.jsx, Forge Play nativo) ou no Forge clássico
// (play.py: o Forge desktop num contentor, mostrado por noVNC em play.html). O clássico também retoma uma posição de
// uma repetição: `fromState` = toForgeState(...) (forgeState.js).
import { useEffect, useMemo, useRef, useState } from 'react'
import { tx } from './i18n.js'
import { DIFF_INFO } from './difficulty.js'
import { FORMAT, CASUAL_META } from './formats.js'
import { img, coverOf, colorsOf } from './data.js'
import { Mana, Stars } from './ui.jsx'
import ForgeTable from './ForgePlay.jsx'

async function j(url, body) {
  const r = await fetch(url, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`)
  return d
}
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch { /* sem armazenamento */ } return null }

const TIPS = [
  ['Prompt', tx('a caixa em baixo, à esquerda, diz o que o jogo espera de ti. OK passa a prioridade ou confirma; o outro botão recusa ou acaba o turno.')],
  [tx('Jogar'), tx('clica na carta na mão; paga clicando nos terrenos (ou no botão Auto). Habilidades: clica na permanente.')],
  [tx('Alvos'), tx('depois de lançar, clica no alvo: uma carta ou o retrato do jogador.')],
  [tx('Combate'), tx('no teu turno clica nas criaturas que atacam e depois OK. Para bloquear, clica no atacante e depois na tua criatura.')],
  [tx('Teclas'), tx('Espaço = OK · Ctrl+E acaba o turno · Ctrl+A ataca com tudo · Ctrl+Z desfaz · Z amplia a carta debaixo do rato · H mostra todos os atalhos.')],
  [tx('Imagens'), tx('chegam à medida que as cartas aparecem. Na primeira vez o Forge pergunta se descarrega o índice de imagens: aceita, fica guardado.')],
  [tx('Fim'), tx('pára sozinho ao fim de 20 min sem mexeres no jogo. No fim de cada partida o Forge volta ao menu, com os dois decks nas listas do Constructed.')],
]
const SRC = [['meta', '📊', tx('Meta')], ['meu', '🧙', tx('Meus')], ['ami', '🤝', tx('Amigos')], ['com', '🌐', tx('Comunidade')]]
const kindOf = d => (d.friend ? 'ami' : d.community ? 'com' : 'meu')
const metaDecks = new Map()  // id -> deck do meta (para a capa e as cores), uma vez por sessão

// a capa de um deck: imagem própria, a carta escolhida ou a carta mais forte da lista
function Cover({ d, data }) {
  const c = d && !d.coverImg && coverOf(d, data)
  const src = d?.coverImg || (c ? img(c, 'art_crop') : null)
  return <span className="pv-art">{src ? <img src={src} alt="" loading="lazy" /> : <i>✦</i>}</span>
}

export default function PlayView({ data, deck, fmt, fromState = null }) {
  const [diffs, setDiffs] = useState([])
  const [diff, setDiffS] = useState(() => ls('grimorio.jogar.dif') || 'default')
  const setDiff = v => { setDiffS(v); ls('grimorio.jogar.dif', v) }
  const [casual, setCasualS] = useState(() => ls('grimorio.jogar.casual') === '1')
  const setCasual = v => { setCasualS(v); ls('grimorio.jogar.casual', v ? '1' : '0'); setOpp(null) }
  const [src, setSrc] = useState('meta'), [q, setQ] = useState('')
  const [meta, setMeta] = useState([]), [mine, setMine] = useState([]), [stars, setStars] = useState({})
  const [opp, setOpp] = useState(null)  // {kind: meta|meu|espelho, id, name, d}
  const [, bump] = useState(0)
  const [fit, setFit] = useState(() => ls('grimorio.jogar.ajustar') === '1')
  const [st, setSt] = useState(null), [sess, setSess] = useState(null), [busy, setBusy] = useState(''), [err, setErr] = useState('')
  const frame = useRef(null)
  // «grimorio» = a mesa do Grimório (Forge Play nativo, playnet.py); «classico» = o Forge desktop por noVNC. Commander só no clássico.
  const native = !fmt.cmd
  const [modo, setModoS] = useState(() => ls('grimorio.jogar.modo') || 'grimorio')
  const setModo = v => { setModoS(v); ls('grimorio.jogar.modo', v) }
  const useNative = native && modo === 'grimorio'
  const [net, setNet] = useState(null), [netOn, setNetOn] = useState(null)  // id do jogo na mesa do Grimório; jogo meu ainda aberto
  useEffect(() => { j('/api/playnet').then(l => setNetOn(l.find(x => !x.ended)?.id || null)).catch(() => {}) }, [net])
  useEffect(() => { j('/api/sim/difficulties').then(setDiffs).catch(() => setDiffs([])); j('/api/decks').then(setMine).catch(() => setMine([])) }, [])

  // o meta (do formato, ou de todos em casual; o Commander fica de fora na mesa do Grimório) e as estrelas
  const metaFmts = useMemo(() => (casual ? CASUAL_META.filter(f => !useNative || !FORMAT[f]?.cmd) : [fmt.key]), [casual, useNative, fmt.key])
  useEffect(() => {
    let off = false
    Promise.all(metaFmts.map(f => j(`/api/sim/opponents?format=${f}`).then(l => l.map(o => ({ ...o, of: f }))).catch(() => []))).then(ls => { if (!off) setMeta(ls.flat()) })
    j(`/api/ratings?format=${casual ? 'casual' : fmt.key}`).then(r => { if (!off) setStars(Object.fromEntries((r.rows || []).map(x => [x.key, { ...x, prov: x.provisional }]))) }).catch(() => {})
    return () => { off = true }
  }, [metaFmts, casual, fmt.key])
  // capas do meta: cada deck vem uma vez (4 de cada vez), para a arte e as cores dos mosaicos
  useEffect(() => {
    let off = false
    const q0 = meta.filter(o => !metaDecks.has(o.id))
    const one = async () => { for (let o; !off && (o = q0.shift());) { metaDecks.set(o.id, await j(`/api/sim/opponents/${encodeURIComponent(o.id)}`).catch(() => null)); bump(x => x + 1) } }
    Promise.all([one(), one(), one(), one()])
    return () => { off = true }
  }, [meta])

  useEffect(() => {
    let live = true
    const tick = () => j('/api/play/status').then(s => { if (!live) return; setSt(s); if (!s.running) setSess(null) }).catch(() => {})
    tick()
    const t = setInterval(tick, 5000)
    return () => { live = false; clearInterval(t) }
  }, [])

  const fits = d => d.id !== deck.id && (casual || (!d.casual && d.format === deck.format))
  const lists = {
    meta: meta.map(o => ({ kind: 'meta', id: o.id, name: o.name, of: o.of, share: o.share, d: metaDecks.get(o.id), key: `meta:${o.id}` })),
    ...Object.fromEntries(['meu', 'ami', 'com'].map(k => [k, mine.filter(d => fits(d) && kindOf(d) === k)
      .map(d => ({ kind: 'meu', id: d.id, name: d.name, of: d.format, d, who: d.friendName, key: `deck:${d.id}` }))])),
  }
  const n = q.trim().toLowerCase()
  const shown = (lists[src] || []).filter(o => !n || o.name.toLowerCase().includes(n))
    .sort((a, b) => (stars[b.key]?.stars ?? -1) - (stars[a.key]?.stars ?? -1) || (b.share || 0) - (a.share || 0))
  const pool = Object.values(lists).flat()
  const random = () => { if (pool.length) { const o = pool[Math.floor(Math.random() * pool.length)]; setOpp(o); setSrc(SRC.find(([k]) => lists[k].includes(o))?.[0] || src) } }
  const mirror = () => setOpp({ kind: 'espelho', id: 'espelho', name: tx('{d} (espelho)', { d: deck.name }), d: deck, key: 'espelho' })

  const setFitPref = v => { setFit(v); ls('grimorio.jogar.ajustar', v ? '1' : '0') }
  const go = async (label, url, body) => {
    setErr(''); setBusy(label)
    try { setSess(await j(url, body)); setSt(s => ({ ...s, running: true })) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const mineDeck = { name: deck.name, commanders: deck.commanders || [], main: deck.main, side: deck.side || {} }
  const start = () => {
    if (!opp) return
    const opponent = opp.kind === 'meta' ? { id: opp.id } : opp.kind === 'meu' ? { deck_id: opp.id } : { deck: { ...mineDeck, name: opp.name } }
    if (!useNative) return go(tx('A arrancar o Forge…'), '/api/play/start', { format: fmt.key, difficulty: diff, deck: mineDeck, opponent })
    setErr(''); setBusy(tx('A arrancar o Forge…'))
    j('/api/playnet', { difficulty: diff, deck: mineDeck, opponent, casual, name: tx('Tu') }).then(r => setNet(r.id)).catch(e => setErr(e.message)).finally(() => setBusy(''))
  }
  const stopNet = async () => { if (net) await j(`/api/playnet/${net}/stop`, {}).catch(() => {}); setNet(null) }
  const resume = () => go(tx('A preparar a posição…'), '/api/play/from-state', { ...fromState, difficulty: diff, format: fromState.format || fmt.key })
  const stop = async () => { setBusy(tx('A parar…')); await j('/api/play/stop', {}).catch(() => {}); setSess(null); setSt({ running: false }); setBusy('') }
  const full = () => frame.current?.requestFullscreen?.()

  const count = Object.values(deck.main || {}).reduce((a, b) => a + b, 0)
  const running = st?.running
  if (net) return (
    <div className="view play fp-view">
      <div className="row-btns fp-bar"><b>⚔ {deck.name}</b> <span className="muted small">{tx('contra a IA do Forge · {f}', { f: fmt.name })}</span>
        <button className="link small" onClick={stopNet}>■ {tx('Parar o jogo')}</button></div>
      <ForgeTable key={net} sid={net} data={data} onClose={stopNet} onAgain={() => { setNet(null); start() }} />
    </div>
  )
  const dl = (diffs.length ? diffs : [{ id: 'default', label: 'Normal' }]).filter(d => d.id !== 'random')
  const myCols = colorsOf(deck, data), oppCols = opp?.d ? colorsOf(opp.d, data) : []
  return (
    <div className="view play pv">
      {(netOn && useNative) || running ? <div className="pv-resume">
        <span>⏯ {running && !useNative ? tx('A correr: {x}', { x: st.title }) : tx('Tens um jogo a meio na mesa do Grimório.')}</span>
        {useNative && netOn && <button className="primary small" onClick={() => setNet(netOn)}>{tx('Voltar ao jogo em curso')}</button>}
        {running && !sess && <button className="small" onClick={() => setSess({ session: st.id, title: st.title, warnings: st.warnings || [] })}>{tx('Voltar ao jogo em curso')}</button>}
        {running && <button className="small" onClick={stop} disabled={busy === tx('A parar…')}>■ {tx('Parar')}</button>}
        {running && st.idle != null && <span className="muted small">{tx('sem mexer há {a} (pára aos {b})', { a: mmss(st.idle), b: mmss(st.idle_limit) })}</span>}
      </div> : null}

      <section className="card pv-vs">
        <div className="pv-side me">
          <Cover d={deck} data={data} />
          <span><small className="muted">{tx('O teu deck')}</small><b>{deck.name || tx('O teu deck')}</b>
            <span className="small muted">{fmt.name} · {tx('{n} carta|{n} cartas', { n: count })} {myCols.length > 0 && <Mana cost={myCols.map(x => `{${x}}`).join('')} />}</span></span>
        </div>
        <b className="pv-x">VS</b>
        <div className={`pv-side opp ${opp ? '' : 'empty'}`}>
          {opp ? <><Cover d={opp.d} data={data} /><span><small className="muted">{tx('Adversário')}</small><b>{opp.name}</b>
            <span className="small muted">{FORMAT[opp.of]?.name || ''} {oppCols.length > 0 && <Mana cost={oppCols.map(x => `{${x}}`).join('')} />} {stars[opp.key] && <Stars r={stars[opp.key]} />}</span></span></>
            : <span className="muted">{tx('Escolhe um adversário em baixo (ou 🎲 ao acaso).')}</span>}
        </div>
      </section>

      <section className="card">
        <h3>{tx('Como jogar')}</h3>
        <div className="pv-modes">
          <button className={useNative ? 'on' : ''} disabled={!native} onClick={() => setModo('grimorio')} title={native ? undefined : tx('O Commander joga-se só no Forge clássico.')}>
            <b>✦ {tx('Mesa do Grimório')}</b><small>{tx('A mesa do Grimório: as cartas, a pilha e as escolhas aqui mesmo, no PC ou no tablet. O Forge decide as regras e joga pela IA.')}</small></button>
          <button className={useNative ? '' : 'on'} onClick={() => setModo('classico')}>
            <b>🖥 {tx('Forge clássico')}</b><small>{tx('O Forge desktop dentro do browser (noVNC), com todos os menus do Forge. Serve para Commander e para retomar posições de repetições.')}</small></button>
        </div>
      </section>

      <section className="card">
        <h3>{tx('Adversário')}</h3>
        <div className="pv-bar">
          <span className="seg">{SRC.map(([k, i, l]) => <button key={k} className={src === k ? 'on' : ''} disabled={!lists[k].length} onClick={() => setSrc(k)}>{i} {l} <b>{lists[k].length}</b></button>)}</span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar deck…')} aria-label={tx('Procurar deck')} />
          <label className="chk" title={tx('Decks de todos os formatos, 1 contra 1 com as regras base do teu deck; o comandante entra como carta do deck.')}><input type="checkbox" checked={casual} onChange={e => setCasual(e.target.checked)} /> 🎲 {tx('Casual (todos os decks)')}</label>
          <button onClick={random} disabled={!pool.length}>🎲 {tx('ao acaso')}</button>
          <button onClick={mirror} className={opp?.kind === 'espelho' ? 'on' : ''}>⇄ {tx('espelho')}</button>
        </div>
        <div className="pv-grid">{shown.map(o => (
          <button key={o.key} className={`pv-tile ${opp?.key === o.key ? 'on' : ''}`} onClick={() => setOpp(o)} title={o.name}>
            <Cover d={o.d} data={data} />
            <span className="pv-t"><b>{o.name}</b>
              <span className="small muted">{[casual && FORMAT[o.of]?.name, o.share && `${Math.round(o.share * 100)}%`, o.who && `🤝 ${o.who}`].filter(Boolean).join(' · ') || ' '}</span>
              {stars[o.key] ? <Stars r={stars[o.key]} /> : <span className="small muted">{tx('sem rating')}</span>}</span>
          </button>))}
          {!shown.length && <p className="muted small">{n ? tx('Nenhum deck com «{q}».', { q }) : tx('Não há decks aqui para este formato. Liga o modo casual para veres todos.')}</p>}
        </div>
      </section>

      <section className="card">
        <h3>{tx('Dificuldade da IA')}</h3>
        <div className="pv-diffs">{dl.map(d => (
          <button key={d.id} className={diff === d.id ? 'on' : ''} onClick={() => setDiff(d.id)}><b>{DIFF_INFO[d.id]?.label || d.label}</b><small>{DIFF_INFO[d.id]?.resumo || d.desc || ''}</small></button>))}
        </div>
      </section>

      <div className="pv-go">
        <span className="pv-sum"><b>{deck.name}</b> <span className="muted">vs</span> <b>{opp?.name || '—'}</b> <span className="muted small">· {DIFF_INFO[diff]?.label || diff}{casual ? ` · ${tx('casual')}` : ''} · {useNative ? tx('Mesa do Grimório') : tx('Forge clássico')}</span></span>
        {!useNative && <label className="chk small"><input type="checkbox" checked={fit} onChange={e => setFitPref(e.target.checked)} /> {tx('resolução ajustada à janela (sem escalar)')}</label>}
        {fromState && <button onClick={resume} disabled={!!busy}>▶ {tx('Retomar esta posição (controlas o lado {s})', { s: fromState.control === 'a' ? 'A' : 'B' })}</button>}
        <button className="primary" onClick={start} disabled={!opp || !count || !!busy}>▶ {tx('Jogar contra o Forge')}</button>
        {busy && <span className="muted small">{busy}</span>}
        {err && <span className="small bad-t">{err}</span>}
      </div>

      {sess && (
        <section className="card">
          <div className="row-btns" style={{ flexWrap: 'wrap' }}>
            <b>{sess.title}</b>
            <button onClick={full}>⛶ {tx('Ecrã inteiro')}</button>
            <button onClick={stop}>■ {tx('Parar')}</button>
            <span className="muted small">{tx('o Forge leva cerca de meio minuto a abrir')}</span>
          </div>
          {sess.warnings?.length > 0 && <p className="muted small">⚠ {sess.warnings.join(' · ')}</p>}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', maxHeight: '82vh', marginTop: 8, background: '#101014', borderRadius: 8, overflow: 'hidden' }}>
            <iframe ref={frame} title="Forge" src={`play.html?resize=${fit ? 'remote' : 'scale'}&s=${sess.session}`} allow="fullscreen"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
          </div>
        </section>
      )}

      {!useNative && <details className="card">
        <summary><b>{tx('Como se joga no Forge')}</b></summary>
        <ul className="small">{TIPS.map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ul>
      </details>}
    </div>
  )
}
