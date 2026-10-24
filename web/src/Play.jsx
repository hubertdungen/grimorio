// Coliseu: jogar contra a IA do Forge no browser. O servidor (play.py) corre o Forge desktop num contentor com
// ecrã virtual e este componente mostra-o num iframe (play.html, cliente noVNC). Também retoma uma posição de uma
// repetição: passa `fromState` = toForgeState(...) (forgeState.js) e aparece «Retomar esta posição».
import { useEffect, useRef, useState } from 'react'

async function j(url, body) {
  const r = await fetch(url, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`)
  return d
}
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const TIPS = [
  ['Prompt', 'a caixa em baixo, à esquerda, diz o que o jogo espera de ti. OK passa a prioridade ou confirma; o outro botão recusa ou acaba o turno.'],
  ['Jogar', 'clica na carta na mão; paga clicando nos terrenos (ou no botão Auto). Habilidades: clica na permanente.'],
  ['Alvos', 'depois de lançar, clica no alvo: uma carta ou o retrato do jogador.'],
  ['Combate', 'no teu turno clica nas criaturas que atacam e depois OK. Para bloquear, clica no atacante e depois na tua criatura.'],
  ['Teclas', 'Espaço = OK · Ctrl+E acaba o turno · Ctrl+A ataca com tudo · Ctrl+Z desfaz · Z amplia a carta debaixo do rato · H mostra todos os atalhos.'],
  ['Imagens', 'chegam à medida que as cartas aparecem. Na primeira vez o Forge pergunta se descarrega o índice de imagens: aceita, fica guardado.'],
  ['Fim', 'pára sozinho ao fim de 20 min sem mexeres no jogo. No fim de cada partida o Forge volta ao menu, com os dois decks nas listas do Constructed.'],
]

export default function PlayView({ deck, fmt, fromState = null }) {
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
    const opponent = kind === 'meta' ? { id } : kind === 'meu' ? { deck_id: id } : { deck: { ...mineDeck, name: `${deck.name} (espelho)` } }
    go('A arrancar o Forge…', '/api/play/start', { format: fmt.key, difficulty: diff, deck: mineDeck, opponent })
  }
  const resume = () => go('A preparar a posição…', '/api/play/from-state', { ...fromState, difficulty: diff, format: fromState.format || fmt.key })
  const stop = async () => { setBusy('A parar…'); await j('/api/play/stop', {}).catch(() => {}); setSess(null); setSt({ running: false }); setBusy('') }
  const full = () => frame.current?.requestFullscreen?.()

  const count = Object.values(deck.main || {}).reduce((a, b) => a + b, 0)
  const running = st?.running
  return (
    <div className="view play">
      <section className="card">
        <h3>Jogar contra o Forge <span className="muted small">tu contra a IA do Forge, com as regras do {fmt.name}</span></h3>
        <p className="small">
          <b>{deck.name || 'O teu deck'}</b> <span className="muted">· {count} cartas{deck.commanders?.length ? ` · comandante: ${deck.commanders.join(' + ')}` : ''}</span>
        </p>
        <div className="row-btns" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="fmt"><span>Adversário</span>
            <select value={opp} onChange={e => setOpp(e.target.value)}>
              <option value="">— escolhe —</option>
              {opps.length > 0 && <optgroup label="Meta">{opps.map(o => <option key={o.id} value={`meta:${o.id}`}>{o.name}{o.share ? ` (${Math.round(o.share * 100)}%)` : ''}</option>)}</optgroup>}
              {mine.length > 0 && <optgroup label="Os meus decks">{mine.map(d => <option key={d.id} value={`meu:${d.id}`}>{d.name}</option>)}</optgroup>}
              <option value="espelho:">O teu próprio deck (espelho)</option>
            </select>
          </label>
          <label className="fmt"><span>Dificuldade da IA</span>
            <select value={diff} onChange={e => setDiff(e.target.value)}>
              {(diffs.length ? diffs : [{ id: 'default', label: 'Normal' }]).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <label className="chk small"><input type="checkbox" checked={fit} onChange={e => setFitPref(e.target.checked)} /> resolução ajustada à janela (sem escalar)</label>
        </div>
        <div className="row-btns" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button className="primary" onClick={start} disabled={!opp || !count || !!busy}>▶ Jogar contra o Forge</button>
          {fromState && <button onClick={resume} disabled={!!busy}>▶ Retomar esta posição (controlas o lado {fromState.control === 'a' ? 'A' : 'B'})</button>}
          {running && !sess && <button onClick={() => setSess({ session: st.id, title: st.title, warnings: st.warnings || [] })}>Voltar ao jogo em curso</button>}
          {running && <button onClick={stop} disabled={busy === 'A parar…'}>■ Parar</button>}
          {busy && <span className="muted small">{busy}</span>}
        </div>
        {err && <p className="small bad-t">{err}</p>}
        {running && <p className="muted small">
          A correr: {st.title}{st.mem ? ` · memória ${st.mem.split(' / ')[0]}` : ''}{st.idle != null ? ` · sem mexer há ${mmss(st.idle)} (pára aos ${mmss(st.idle_limit)})` : ''}
        </p>}
      </section>

      {sess && (
        <section className="card">
          <div className="row-btns" style={{ flexWrap: 'wrap' }}>
            <b>{sess.title}</b>
            <button onClick={full}>⛶ Ecrã inteiro</button>
            <button onClick={stop}>■ Parar</button>
            <span className="muted small">o Forge leva cerca de meio minuto a abrir</span>
          </div>
          {sess.warnings?.length > 0 && <p className="muted small">⚠ {sess.warnings.join(' · ')}</p>}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', maxHeight: '82vh', marginTop: 8, background: '#101014', borderRadius: 8, overflow: 'hidden' }}>
            <iframe ref={frame} title="Forge" src={`play.html?resize=${fit ? 'remote' : 'scale'}&s=${sess.session}`} allow="fullscreen"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
          </div>
        </section>
      )}

      <section className="card">
        <h4>Como se joga no Forge</h4>
        <ul className="small">{TIPS.map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ul>
      </section>
    </div>
  )
}
