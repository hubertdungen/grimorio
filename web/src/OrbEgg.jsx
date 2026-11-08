// Segredo da esfera da vida: o rato parado em cima dela (3,5 s; no ecrã tátil, tocar e manter 3 s) abre ao lado a ficha
// dessa esfera, ao vivo — a mistura do fluido (data-w), o ambiente (data-env), vida, veneno, estilo, animação, partículas
// e as cores do deck (o halo). Enquanto o rato fica, a esfera aproxima-se (CSS .orb[data-egg], até 1,6×). Nada corre
// por fotograma: lê os atributos da esfera ao abrir e a cada 500 ms. Fecha ao sair com o rato, ao tocar fora ou com Esc.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx, LOCALE } from './i18n.js'
import { isTouch } from './touch.js'

const HOLD = { mouse: 3500, touch: 3000 }
const MIX = [['W', '#f5ecc8', tx('Branco')], ['U', '#3b82f6', tx('Azul')], ['B', '#8b6bb0', tx('Preto')], ['R', '#ef4444', tx('Vermelho')], ['G', '#22c55e', tx('Verde')], ['C', '#9ca3af', tx('Incolor')]]
// os índices do orbEnv (Board.jsx)
const ENV = [[tx('Dano levado'), '#ef4444'], [tx('Auras a favor'), '#fde047'], [tx('Auras contra'), '#a855f7'], [tx('Cemitério'), '#a8a29e'], [tx('Exílio'), '#93c5fd'],
  [tx('Biblioteca a acabar'), '#38bdf8'], [tx('Calor'), '#fb923c'], [tx('Frio'), '#7dd3fc'], [tx('Presença na mesa'), '#f2b84b'], [tx('Cinto de terrenos'), '#84cc16'], [tx('Força das criaturas'), '#f43f5e']]
// o que cada fator do ambiente quer dizer e o que faz à esfera (aparece ao passar o rato pelo gráfico ou pela barra)
const ENV_HINT = [tx('quanto da vida inicial já perdeste: a esfera racha e escurece'), tx('auras e equipamentos teus nas tuas criaturas e encantamentos teus: brilho dourado'),
  tx('auras de adversários presas às tuas cartas: fumo roxo por dentro'), tx('cartas no teu cemitério (cheio aos 30): sedimento escuro no fundo'),
  tx('cartas exiladas (cheio aos 15): fragmentos azuis a flutuar'), tx('com 10 ou menos cartas na biblioteca a esfera começa a pingar'),
  tx('feitiços vermelhos no cemitério e vermelho em campo: brilho quente e, com pouca vida, suor'), tx('feitiços azuis, cartas snow e azul em campo: geada à volta'),
  tx('terrenos e força das criaturas em campo: o halo e o brilho crescem'), tx('terrenos além de 3 (cheio aos 12): o anel de mana à volta da esfera'),
  tx('o poder total das tuas criaturas (cheio aos 20): o enxame de partículas fica bravo')]
const DEATH = { dmg: tx('partiu-se com o dano'), psn: tx('derreteu com o veneno'), mill: tx('secou: biblioteca vazia'), cmd: tx('cortada pelo dano de comandante'), alt: tx('o adversário ganhou por efeito'), lose: tx('perdeu por efeito de carta'), concede: tx('caiu: desistiu'), draw: tx('pedra: empate') }
const RICH = { halo: tx('auréola'), fat: tx('gelatina'), sweat: tx('suor de luz'), god: tx('raios divinos') }
const MOOD = { loss: tx('a levar dano'), gain: tx('a ganhar vida'), psn: tx('a ser envenenada') }
const pct = x => `${Math.round(x * 100)}%`
const nums = s => (s ? String(s).split(',').map(Number) : null)

// a mistura do fluido em anel, com a vida no meio e o arco dourado da vida que resta (em relação à inicial)
function Donut({ parts, life, k, onHint }) {
  const R = 36, C = 2 * Math.PI * R, A = 2 * Math.PI * 46
  const off = parts.map((_, i) => parts.slice(0, i).reduce((a, p) => a + p[1], 0))
  return (
    <svg viewBox="0 0 100 100" className="egg-chart" aria-hidden="true">
      <circle cx="50" cy="50" r={R} fill="none" stroke="#ffffff12" strokeWidth="13" />
      {parts.map(([c, f, h], i) => <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={c} strokeWidth="13" strokeDasharray={`${Math.max(0, f * C - 1)} ${C}`} strokeDashoffset={-off[i] * C} transform="rotate(-90 50 50)"
        className="egg-hit" onPointerEnter={() => onHint?.(h)} onPointerLeave={() => onHint?.(null)} />)}
      <circle cx="50" cy="50" r="46" fill="none" stroke="#ffffff10" strokeWidth="3" />
      <circle cx="50" cy="50" r="46" fill="none" stroke="#f2b84b" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${Math.min(1, Math.max(0, k)) * A} ${A}`} transform="rotate(-90 50 50)"
        className="egg-hit" onPointerEnter={() => onHint?.(tx('Arco dourado: a vida que te resta em relação à inicial ({p})', { p: pct(Math.max(0, k)) }))} onPointerLeave={() => onHint?.(null)} />
      <text x="50" y="53" textAnchor="middle" className="egg-life">{life}</text>
      <text x="50" y="66" textAnchor="middle" className="egg-lifel">{tx('vida')}</text>
    </svg>
  )
}

// o ambiente em rosa: uma fatia por fator, o raio pelo valor
function Rose({ v, onHint }) {
  const n = ENV.length, a = (2 * Math.PI) / n, r0 = 9, R = 47
  const pt = (t, r) => `${(50 + r * Math.cos(t)).toFixed(2)} ${(50 + r * Math.sin(t)).toFixed(2)}`
  const arc = (i, r) => { const t0 = i * a - Math.PI / 2 + 0.035, t1 = (i + 1) * a - Math.PI / 2 - 0.035
    return `M${pt(t0, r0)}L${pt(t0, r)}A${r} ${r} 0 0 1 ${pt(t1, r)}L${pt(t1, r0)}A${r0} ${r0} 0 0 0 ${pt(t0, r0)}Z` }
  return (
    <svg viewBox="0 0 100 100" className="egg-chart" aria-hidden="true">
      {ENV.map(([l, c], i) => <path key={i} d={arc(i, R)} fill={c} opacity=".1" className="egg-hit" onPointerEnter={() => onHint?.(`${l} · ${pct(v[i] || 0)} — ${ENV_HINT[i]}`)} onPointerLeave={() => onHint?.(null)} />)}
      {ENV.map(([, c], i) => (v[i] > 0.005 ? <path key={`v${i}`} d={arc(i, r0 + (R - r0) * Math.min(1, v[i]))} fill={c} opacity=".9" style={{ pointerEvents: 'none' }} /> : null))}
      <circle cx="50" cy="50" r={r0 - 2} fill="#10131f" stroke="#f2b84b55" />
    </svg>
  )
}

function Card({ el, start, poison, pmax, names, onIn, onOut }) {
  const [n, tick] = useState(0), box = useRef(null), [pos, setPos] = useState(null), [hint, setHint] = useState(null)
  useEffect(() => { const iv = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(iv) }, [])
  // ao lado da esfera: à direita se couber, senão à esquerda; na altura dela, sem sair do ecrã
  useEffect(() => {
    const r = el.getBoundingClientRect(), b = box.current?.getBoundingClientRect(), w = b?.width || 300, h = b?.height || 420, g = 14
    const left = r.right + g + w <= innerWidth - 8 ? r.right + g : r.left - g - w >= 8 ? r.left - g - w : Math.max(8, (innerWidth - w) / 2)
    const top = Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - h / 2))
    setPos(p => (p && Math.abs(p[0] - left) <= 1 && Math.abs(p[1] - top) <= 1 ? p : [left, top]))
  }, [el, n])
  const d = el.dataset, cl = el.classList
  const w = nums(d.w), env = nums(d.env) || ENV.map(() => 0), cols = (d.cols || '').split('').filter(c => 'WUBRG'.includes(c))
  const life = el.querySelector(':scope > b')?.textContent ?? d.life, lv = +d.life
  const parts = w ? MIX.map(([, c, l], i) => [c, w[i] || 0, l]).filter(p => p[1] > 0)
    : cols.length ? cols.map(c => { const m = MIX.find(x => x[0] === c); return [m[1], 1 / cols.length, m[2]] }) : [[getComputedStyle(el).getPropertyValue('--core').trim() || '#5ee08a', 1, tx('a cor do estilo da esfera')]]
  const ps = parts.reduce((a, p) => a + p[1], 0) || 1
  const top = env.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0])[0]
  const dead = [...cl].find(c => c.startsWith('dead-'))?.slice(5)
  const three = cl.contains('has3d'), part = d.pf === '1'
  const grains = !three ? tx('esfera plana (sem 3D)') : !part ? tx('desligadas: líquido animado') : d.pg === 'fx' ? tx('estilizadas: estrelas, penas e brilhos')
    : `${{ gpu: tx('placa gráfica'), cpu: tx('processador'), leve: tx('leve') }[d.pq] || tx('automática')}${d.gn ? ` · ${tx('{n} grãos', { n: (+d.gn).toLocaleString(LOCALE) })}` : ''}`
  const state = [dead && `💥 ${DEATH[dead] || dead}`, !dead && cl.contains('low') && `🩸 ${tx('pouca vida: rachada')}`, !dead && el._beat && `💓 ${tx('coração a bater')}`,
    MOOD[d.mood] && `✦ ${MOOD[d.mood]}`, ...(d.rich ? d.rich.split(' ').map(x => `✨ ${RICH[x] || x}`) : [])].filter(Boolean)
  return createPortal(
    <div ref={box} className="orb-egg" role="dialog" aria-label={tx('A esfera por dentro')} style={pos ? { left: pos[0], top: pos[1] } : { visibility: 'hidden' }}
      onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onPointerEnter={onIn} onPointerLeave={onOut}>
      <header><b>🔮 {tx('A esfera por dentro')}</b><small>{names[0][d.t] || d.t} · {names[1][d.a] || d.a}</small></header>
      <div className="egg-row">
        <figure><Donut parts={parts.map(([c, f, l]) => [c, f / ps, `${l} · ${pct(f / ps)} — ${w ? tx('a parte do fluido que vem das cartas desta cor em campo (os terrenos contam menos; cemitério e exílio um pouco)') : tx('sem cartas em campo, o fluido segue as cores do deck ou o estilo')}`])} life={life} k={start ? lv / start : 1} onHint={setHint} />
          <figcaption>{w ? tx('Fluido pelas cartas em campo') : tx('Fluido do estilo')}</figcaption></figure>
        <figure><Rose v={env} onHint={setHint} /><figcaption>{tx('Ambiente da mesa')}</figcaption></figure>
      </div>
      <p className={`egg-hint ${hint ? 'on' : ''}`} aria-live="polite">{hint || (isTouch() ? tx('Toca nos gráficos e nas barras para saberes o que é cada coisa.') : tx('Passa o rato pelos gráficos e pelas barras para saberes o que é cada coisa.'))}</p>
      {w && <ul className="egg-mix">{MIX.map(([k, c, l], i) => (w[i] > 0 ? <li key={k}><i style={{ background: c }} />{l} <b>{pct(w[i] / ps)}</b></li> : null))}
        {w[0] > 0 && w[6] > 0 && <li className="muted">{tx('do branco, {p} vem de feitiços', { p: pct(w[6]) })}</li>}</ul>}
      <p className="egg-say">{top[0] >= 0.15 ? tx('O que mais pesa agora: {f} ({p}).', { f: ENV[top[1]][0].toLowerCase(), p: pct(top[0]) }) : tx('A mesa está calma: nada pesa na esfera.')}</p>
      <ul className="egg-bars">{ENV.map(([l, c], i) => <li key={l} className={env[i] > 0.005 ? '' : 'off'} onPointerEnter={() => setHint(`${l} · ${pct(env[i])} — ${ENV_HINT[i]}`)} onPointerLeave={() => setHint(null)}><span>{l}</span><i><b style={{ width: pct(Math.min(1, env[i])), background: c }} /></i><em>{pct(env[i])}</em></li>)}</ul>
      <dl className="egg-specs">
        <dt>{tx('Vida')}</dt><dd>{life}{start ? ` / ${start}` : ''}</dd>
        <dt>{tx('Veneno')}</dt><dd>{poison ? `☠ ${poison} / ${pmax}` : '—'}</dd>
        <dt>{tx('Cores do deck (halo)')}</dt><dd>{cols.length ? cols.map(c => <i key={c} className="egg-pip" style={{ background: MIX.find(m => m[0] === c)[1] }} title={MIX.find(m => m[0] === c)[2]} />) : '—'}</dd>
        <dt>{tx('Desenho')}</dt><dd>{three ? (d.o3 ? tx('3D (WebGL)') : tx('3D a preparar…')) : tx('plana')}</dd>
        <dt>{tx('Partículas')}</dt><dd>{grains}</dd>
      </dl>
      {state.length > 0 && <p className="egg-state">{state.map(s => <span key={s}>{s}</span>)}</p>}
    </div>,
    document.fullscreenElement || document.body)
}

// orb = a ref da esfera (.orb); o resto vem do Orb: a vida inicial, o veneno e as tabelas dos nomes [estilos, animações]
export default function OrbEgg({ orb, start, poison, pmax, names }) {
  const [open, setOpen] = useState(false), opened = useRef(false)
  opened.current = open
  useEffect(() => {
    const el = orb.current
    if (!el) return
    let t = 0, press = null, swallow = false, bye = 0
    const zoom = on => {
      if (on) { el.dataset.egg = '1'; return }
      if (el.dataset.egg !== '1') return
      el.dataset.egg = 'out'; setTimeout(() => { if (el.dataset.egg === 'out') delete el.dataset.egg }, 500)
    }
    const stop = () => { clearTimeout(t); clearTimeout(bye); t = 0; press = null; zoom(false); setOpen(false) }
    // com a ficha aberta, sair da esfera dá um instante para entrar na ficha (passar o rato pelos gráficos); sair da ficha fecha
    el._eggIn = () => clearTimeout(bye)
    el._eggOut = () => { clearTimeout(bye); bye = setTimeout(stop, 350) }
    const arm = kind => {
      clearTimeout(t); zoom(true)
      t = setTimeout(() => { if (el._proxy || document.body.classList.contains('orb-grab')) return stop(); swallow = kind === 'touch'; setOpen(true) }, HOLD[kind])
    }
    const enter = e => { if (e.pointerType !== 'mouse' || e.buttons) return; if (opened.current) clearTimeout(bye); else arm('mouse') }
    const leave = e => { if (e.pointerType !== 'mouse') return; if (opened.current) el._eggOut(); else stop() }
    const down = e => {
      if (e.pointerType === 'mouse') { stop(); return }  // agarrar ou clicar: a esfera é tua outra vez
      press = [e.clientX, e.clientY]; swallow = false; arm('touch')
    }
    const move = e => { if (press && Math.hypot(e.clientX - press[0], e.clientY - press[1]) > 7) stop() }  // a arrastar
    const up = () => { if (press && !swallow) stop(); press = null }  // largou antes dos 3 s
    const click = e => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault() } }  // o toque que abriu a ficha não abre o menu da vida
    const menu = e => { if (press) e.preventDefault() }  // tocar e manter: sem o menu do browser
    const outside = e => { if (e.pointerType !== 'mouse' && !press && !el.contains(e.target) && !e.target.closest?.('.orb-egg')) stop() }
    const esc = e => { if (e.key === 'Escape') stop() }
    el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave); el.addEventListener('pointerdown', down)
    el.addEventListener('click', click, true); el.addEventListener('contextmenu', menu)
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', stop)
    addEventListener('pointerdown', outside, true); addEventListener('keydown', esc)
    return () => {
      clearTimeout(t); delete el.dataset.egg
      el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave); el.removeEventListener('pointerdown', down)
      el.removeEventListener('click', click, true); el.removeEventListener('contextmenu', menu)
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', stop)
      removeEventListener('pointerdown', outside, true); removeEventListener('keydown', esc)
    }
  }, [orb])
  return open && orb.current ? <Card el={orb.current} start={start} poison={poison} pmax={pmax} names={names} onIn={() => orb.current?._eggIn?.()} onOut={() => orb.current?._eggOut?.()} /> : null
}
