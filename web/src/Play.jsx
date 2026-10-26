// Coliseu: jogar contra a IA do Forge no browser. O servidor (play.py) corre o Forge desktop num contentor com
// ecrã virtual e este componente mostra-o num iframe (play.html, cliente noVNC). Também retoma uma posição de uma
// repetição: passa `fromState` = toForgeState(...) (forgeState.js) e aparece «Retomar esta posição».
import { useEffect, useRef, useState } from 'react'
import { tx } from './i18n.js'
import { DIFF_INFO } from './difficulty.js'
import ForgeTable from './ForgePlay.jsx'

async function j(url, body) {
  const r = await fetch(url, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`)
  return d
}
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const TIPS = [
  ['Prompt', tx('a caixa em baixo, à esquerda, diz o que o jogo espera de ti. OK passa a prioridade ou confirma; o outro botão recusa ou acaba o turno.')],
  [tx('Jogar'), tx('clica na carta na mão; paga clicando nos terrenos (ou no botão Auto). Habilidades: clica na permanente.')],
  [tx('Alvos'), tx('depois de lançar, clica no alvo: uma carta ou o retrato do jogador.')],
  [tx('Combate'), tx('no teu turno clica nas criaturas que atacam e depois OK. Para bloquear, clica no atacante e depois na tua criatura.')],
  [tx('Teclas'), tx('Espaço = OK · Ctrl+E acaba o turno · Ctrl+A ataca com tudo · Ctrl+Z desfaz · Z amplia a carta debaixo do rato · H mostra todos os atalhos.')],
  [tx('Imagens'), tx('chegam à medida que as cartas aparecem. Na primeira vez o Forge pergunta se descarrega o índice de imagens: aceita, fica guardado.')],
  [tx('Fim'), tx('pára sozinho ao fim de 20 min sem mexeres no jogo. No fim de cada partida o Forge volta ao menu, com os dois decks nas listas do Constructed.')],
]

export default function PlayView({ data, deck, fmt, fromState = null }) {
  const [opps, setOpps] = useState([])
  const [mine, setMine] = useState([])
  const [diffs, setDiffs] = useState([])
  const [opp, setOpp] = useState('')
  const [diff, setDiff] = useState('default')
  const [fit, setFit] = useState(() => { try { return localStorage.getItem('grimorio.jogar.ajustar') === '1' } catch { return false } })
  const [st, setSt] = useState(null)
  const [sess, setSess] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const frame = useRef(null)
  // «grimorio» = a mesa do Grimório (Forge Play nativo, playnet.py); «classico» = o Forge desktop por noVNC. Commander só no clássico.
  const native = !fmt.cmd
  const [modo, setModoS] = useState(() => { try { return localStorage.getItem('grimorio.jogar.modo') || 'grimorio' } catch { return 'grimorio' } })
  const setModo = v => { setModoS(v); try { localStorage.setItem('grimorio.jogar.modo', v) } catch { /* sem armazenamento */ } }
  const useNative = native && modo === 'grimorio'
  const [net, setNet] = useState(null), [netOn, setNetOn] = useState(null)  // id do jogo na mesa do Grimório; jogo meu ainda aberto
  useEffect(() => { j('/api/playnet').then(l => setNetOn(l.find(x => !x.ended)?.id || null)).catch(() => {}) }, [net])

  useEffect(() => {
    j(`/api/sim/opponents?format=${fmt.key}`).then(setOpps).catch(() => setOpps([]))
    j('/api/sim/difficulties').then(setDiffs).catch(() => setDiffs([]))
    j('/api/decks').then(ds => setMine(ds.filter(d => d.id !== deck.id && d.format === deck.format))).catch(() => setMine([]))
  }, [fmt.key, deck.id, deck.format])

  useEffect(() => {
    let live = true
    const tick = () => j('/api/play/status').then(s => { if (!live) return; setSt(s); if (!s.running) setSess(null) }).catch(() => {})
    tick()
    const t = setInterval(tick, 5000)
    return () => { live = false; clearInterval(t) }
  }, [])

  const setFitPref = v => { setFit(v); try { localStorage.setItem('grimorio.jogar.ajustar', v ? '1' : '0') } catch { /* sem armazenamento */ } }
  const go = async (label, url, body) => {
    setErr(''); setBusy(label)
    try { setSess(await j(url, body)); setSt(s => ({ ...s, running: true })) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const mineDeck = { name: deck.name, commanders: deck.commanders || [], main: deck.main, side: deck.side || {} }
  const start = () => {
    const [kind, id] = [opp.slice(0, opp.indexOf(':')), opp.slice(opp.indexOf(':') + 1)]
    const opponent = kind === 'meta' ? { id } : kind === 'meu' ? { deck_id: id } : { deck: { ...mineDeck, name: `${deck.name} (${tx('espelho')})` } }
    if (!useNative) return go(tx('A arrancar o Forge…'), '/api/play/start', { format: fmt.key, difficulty: diff, deck: mineDeck, opponent })
    setErr(''); setBusy(tx('A arrancar o Forge…'))
    j('/api/playnet', { difficulty: diff, deck: mineDeck, opponent }).then(r => setNet(r.id)).catch(e => setErr(e.message)).finally(() => setBusy(''))
  }
  const stopNet = async () => { if (net) await j(`/api/playnet/${net}/stop`, {}).catch(() => {}); setNet(null) }
  const resume = () => go(tx('A preparar a posição…'), '/api/play/from-state', { ...fromState, difficulty: diff, format: fromState.format || fmt.key })
  const stop = async () => { setBusy(tx('A parar…')); await j('/api/play/stop', {}).catch(() => {}); setSess(null); setSt({ running: false }); setBusy('') }
  const full = () => frame.current?.requestFullscreen?.()

  const count = Object.values(deck.main || {}).reduce((a, b) => a + b, 0)
  const running = st?.running
  if (net) return (
    <div className="view play">
      <div className="row-btns fp-bar"><b>⚔ {deck.name}</b> <span className="muted small">{tx('contra a IA do Forge · {f}', { f: fmt.name })}</span>
        <button className="link small" onClick={stopNet}>■ {tx('Parar o jogo')}</button></div>
      <ForgeTable key={net} sid={net} data={data} onClose={stopNet} onAgain={() => { setNet(null); start() }} />
    </div>
  )
  return (
    <div className="view play">
      <section className="card">
        <h3>{tx('Jogar contra o Forge')} <span className="muted small">{tx('tu contra a IA do Forge, com as regras do {f}', { f: fmt.name })}</span></h3>
        <p className="small">
          <b>{deck.name || tx('O teu deck')}</b> <span className="muted">· {tx('{n} carta|{n} cartas', { n: count })}{deck.commanders?.length ? ` · ${tx('comandante: {c}', { c: deck.commanders.join(' + ') })}` : ''}</span>
        </p>
        <div className="seg play-modo" role="group" aria-label={tx('Como jogar')}>
          <button className={useNative ? 'on' : ''} disabled={!native} onClick={() => setModo('grimorio')} title={native ? undefined : tx('O Commander joga-se só no Forge clássico.')}>✦ {tx('Mesa do Grimório')}</button>
          <button className={useNative ? '' : 'on'} onClick={() => setModo('classico')}>🖥 {tx('Forge clássico')}</button>
        </div>
        <p className="small muted">{useNative ? tx('A mesa do Grimório: as cartas, a pilha e as escolhas aqui mesmo, no PC ou no tablet. O Forge decide as regras e joga pela IA.') : tx('O Forge desktop dentro do browser (noVNC), com todos os menus do Forge. Serve para Commander e para retomar posições de repetições.')}</p>
        <div className="row-btns" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="fmt"><span>{tx('Adversário')}</span>
            <select value={opp} onChange={e => setOpp(e.target.value)}>
              <option value="">{tx('— escolhe —')}</option>
              {opps.length > 0 && <optgroup label="Meta">{opps.map(o => <option key={o.id} value={`meta:${o.id}`}>{o.name}{o.share ? ` (${Math.round(o.share * 100)}%)` : ''}</option>)}</optgroup>}
              {mine.length > 0 && <optgroup label={tx('Os meus decks')}>{mine.map(d => <option key={d.id} value={`meu:${d.id}`}>{d.name}</option>)}</optgroup>}
              <option value="espelho:">{tx('O teu próprio deck (espelho)')}</option>
            </select>
          </label>
          <button onClick={() => { const pool = [...opps.map(o => `meta:${o.id}`), ...mine.map(d => `meu:${d.id}`)]; if (pool.length) setOpp(pool[Math.floor(Math.random() * pool.length)]) }} title={tx('Escolhe um adversário ao acaso (do meta ou dos teus decks)')}>🎲 {tx('ao acaso')}</button>
          <label className="fmt"><span>{tx('Dificuldade da IA')}</span>
            <select value={diff} onChange={e => setDiff(e.target.value)}>
              {(diffs.length ? diffs : [{ id: 'default', label: 'Normal' }]).map(d => <option key={d.id} value={d.id}>{DIFF_INFO[d.id]?.label || d.label}</option>)}
            </select>
          </label>
          {!useNative && <label className="chk small"><input type="checkbox" checked={fit} onChange={e => setFitPref(e.target.checked)} /> {tx('resolução ajustada à janela (sem escalar)')}</label>}
        </div>
        <div className="row-btns" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button className="primary" onClick={start} disabled={!opp || !count || !!busy}>▶ {tx('Jogar contra o Forge')}</button>
          {useNative && netOn && <button onClick={() => setNet(netOn)}>{tx('Voltar ao jogo em curso')}</button>}
          {fromState && <button onClick={resume} disabled={!!busy}>▶ {tx('Retomar esta posição (controlas o lado {s})', { s: fromState.control === 'a' ? 'A' : 'B' })}</button>}
          {running && !sess && <button onClick={() => setSess({ session: st.id, title: st.title, warnings: st.warnings || [] })}>{tx('Voltar ao jogo em curso')}</button>}
          {running && <button onClick={stop} disabled={busy === tx('A parar…')}>■ {tx('Parar')}</button>}
          {busy && <span className="muted small">{busy}</span>}
        </div>
        {err && <p className="small bad-t">{err}</p>}
        {running && <p className="muted small">
          {tx('A correr: {x}', { x: st.title })}{st.mem ? ` · ${tx('memória {x}', { x: st.mem.split(' / ')[0] })}` : ''}{st.idle != null ? ` · ${tx('sem mexer há {a} (pára aos {b})', { a: mmss(st.idle), b: mmss(st.idle_limit) })}` : ''}
        </p>}
      </section>

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

      {!useNative && <section className="card">
        <h4>{tx('Como se joga no Forge')}</h4>
        <ul className="small">{TIPS.map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ul>
      </section>}
    </div>
  )
}
