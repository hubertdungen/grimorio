import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { img, TAG_LABEL } from './data.js'
import { tx, num } from './i18n.js'

const sym = s => `https://svgs.scryfall.io/card-symbols/${s.replace(/\//g, '')}.svg`

export function Mana({ cost }) {
  if (!cost) return null
  return (
    <span className="mana">
      {cost.split(/(\{[^}]+\}|\s\/\/\s)/).filter(Boolean).map((p, k) =>
        p.startsWith('{') ? <img key={k} src={sym(p.slice(1, -1))} alt={p} loading="lazy" /> : <span key={k}>{p}</span>)}
    </span>
  )
}

export function Oracle({ text }) {
  return (
    <div className="oracle" lang="en">
      {text.split('\n').map((line, k) => (
        <p key={k}>{line.split(/(\{[^}]+\})/).map((p, j) =>
          p.startsWith('{') ? <img key={j} src={sym(p.slice(1, -1))} alt={p} /> : p)}</p>
      ))}
    </div>
  )
}

export const price = c => (c.eur != null ? `${num(c.eur, 2)} €` : c.usd != null ? `$${num(c.usd, 2)}` : '—')

export function Tags({ c, onTag }) {
  return (
    <span className="tags">
      {c.tg.filter(t => t !== 'land' && t !== 'creature').map(t => (
        <button key={t} className="tag" onClick={onTag ? e => { e.stopPropagation(); onTag(t) } : undefined}>{TAG_LABEL[t]}</button>
      ))}
    </span>
  )
}

/** Carta em grelha: imagem + ações rápidas. */
export function CardTile({ c, pid, onOpen, actions, note, children }) {
  return (
    <div className="tile">
      <button className="tile-img" onClick={() => onOpen(c)} title={c.n}>
        <img src={img(c, 'normal', false, pid)} alt={c.n} loading="lazy" />
      </button>
      <div className="tile-bar">
        {actions}
        <span className="tile-price">{price(c)}</span>
      </div>
      {note}
      {children}
    </div>
  )
}

export function Logo({ size = 34 }) {
  return <img src="logo.svg" width={size} height={size} alt="" className="logo" />
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

// rating em estrelas (0,0–6,0) em três camadas, numa fila de ⌈maior valor⌉ estrelas (a última na proporção):
// vermelho (objetivo) por baixo de tudo: contorno em todas as estrelas até ao seu valor e cheio só do maior entre
// amarelo e azul até ao vermelho; amarelo (normal, jogos não casuais) e azul (todos os jogos), com o amarelo sempre à
// vista: amarelo maior ou igual = degradê azul→amarelo até ao azul e amarelo no resto; azul maior = amarelo até ao seu
// valor e azul no resto. O número
// é só o amarelo. Sem rating, uma estrela cinzenta; provisório, mais claras. r = {stars, blue, red, routes, prov, elo,
// games…} (de /api/ratings/stars ou das linhas de /api/ratings) ou v solto; bare = sem número. Rato por cima ou dedo
// pousado ~0,5 s abre a explicação (Tip).
export const PROV_TIP = tx('Provisório: menos de 10 jogos com rating. O Elo ainda mexe o dobro por jogo e as estrelas podem mudar muito; fica estável aos 10 jogos.')
const STAR = 'M12 2.2l2.95 6.3 6.85.8-5.08 4.68 1.36 6.77L12 17.4l-6.08 3.35 1.36-6.77L2.2 9.3l6.85-.8z'
const COL = { y: 'var(--gold)', b: '#4ea8ff', r: '#ff4d5e', none: '#ffffff1f' }
const ROUTE = { dmg: tx('dano'), psn: tx('veneno'), cmd: tx('comandante'), mill: tx('biblioteca'), alt: tx('vitória alternativa') }
const pc = x => `${Math.round(x * 100)}%`

function Tip({ at, r, v, label }) {
  const W = 290, x = Math.max(8, Math.min(at.left, innerWidth - W - 8)), below = at.bottom + 150 < innerHeight
  const rt = r.routes ? Object.entries(r.routes).filter(([, x]) => x >= 0.005).sort((a, b) => b[1] - a[1]) : []
  const by = r.by && Object.entries(r.by).sort((a, b) => b[1] - a[1])[0]
  return createPortal(
    <div className="st-tip" role="tooltip" style={{ left: x, width: W, ...(below ? { top: at.bottom + 6 } : { bottom: innerHeight - at.top + 6 }) }}>
      {label && <div className="muted">{label}</div>}
      <p><i className="st-dot" style={{ background: COL.y }} /><b>{tx('Normal')} {v != null && num(v, 1)}</b> {tx('— jogos não casuais (o número mostrado)')}{r.games ? ` · ${tx('{n} jogo|{n} jogos', { n: r.games })} · Elo ${r.elo}` : ''}</p>
      <p><i className="st-dot" style={{ background: COL.b }} /><b>{tx('Todos os jogos')} {r.blue != null && num(r.blue, 1)}</b> {tx('— inclui os casuais')}{r.blue_games ? ` · ${tx('{n} jogo|{n} jogos', { n: r.blue_games })}` : ''}</p>
      <p><i className="st-dot" style={{ background: COL.r }} /><b>{tx('Objetivo')} {r.red != null && num(r.red, 1)}</b> {tx('— quanto chega, em média, ao objetivo de ganhar (100% = 5★, 120% ou mais = 6★)')}
        {r.goal != null && <> · <b>{pc(r.goal)}</b>{rt.length ? `: ${rt.map(([k, x]) => `${ROUTE[k]} ${pc(x)}`).join(' · ')}` : ''}{by ? ` · ${tx('ganha sobretudo por {v}', { v: ROUTE[by[0]] })}` : ''}</>}</p>
      {r.prov && <p className="muted small">{PROV_TIP}</p>}
    </div>, document.body)
}

export function Stars({ r, v = r?.stars, prov = r?.prov, bare = false, label = '' }) {
  const uid = useId().replace(/[^\w-]/g, ''), [at, setAt] = useState(null), hold = useRef(null), held = useRef(false), me = useRef(null)
  useEffect(() => {
    if (!at) return
    const off = e => { if (!me.current?.contains(e.target)) setAt(null) }
    document.addEventListener('pointerdown', off)
    window.addEventListener('scroll', off, true)
    return () => { document.removeEventListener('pointerdown', off); window.removeEventListener('scroll', off, true) }
  }, [at])
  const b = r?.blue, rd = r?.red
  if (v == null && b == null && rd == null) return <span className="stars none" title={tx('sem rating ainda')} role="img" aria-label={tx('sem rating ainda')}>★</span>
  const y = v ?? 0, lo = Math.min(y, b ?? y), hi = Math.max(y, b ?? y), top = Math.max(hi, rd ?? 0)
  const [cLo, cHi] = b != null && b < y ? [COL.b, COL.y] : [COL.y, COL.b]
  // o amarelo vê-se sempre: com o amarelo maior ou igual, a parte comum fica em degradê azul→amarelo e o resto amarelo;
  // com o azul maior, primeiro o amarelo e depois o azul
  const blend = b != null && b > 0 && b <= y
  const slots = Math.max(1, Math.min(6, Math.ceil(top - 1e-9)))
  const f = (x, i) => Math.max(0, Math.min(1, x - i)) * 100
  const t = [`${label}${tx('Normal')} ${num(y, 1)}`, b != null && `${tx('Todos os jogos')} ${num(b, 1)}`, rd != null && `${tx('Objetivo')} ${num(rd, 1)}`].filter(Boolean).join(' · ')
  const show = () => r && me.current && setAt(me.current.getBoundingClientRect())
  return (
    <span ref={me} className={`stars${prov ? ' prov' : ''}`} role="img" aria-label={t}
      onPointerEnter={e => { if (e.pointerType === 'mouse') show() }} onPointerLeave={e => { if (e.pointerType === 'mouse') setAt(null) }}
      onPointerDown={e => { if (e.pointerType !== 'mouse') { held.current = false; hold.current = setTimeout(() => { held.current = true; show() }, 500) } }}
      onPointerUp={() => { clearTimeout(hold.current); if (held.current) setAt(null) }} onPointerCancel={() => { clearTimeout(hold.current); setAt(null) }}
      onClickCapture={e => { if (held.current) { held.current = false; e.preventDefault(); e.stopPropagation() } }} onContextMenu={e => e.preventDefault()}>
      {Array.from({ length: slots }, (_, i) => {
        const a = f(lo, i), h = f(hi, i), z = rd != null ? f(rd, i) : 0, red = Math.max(h, z), id = `${uid}s${i}`
        return (
          <svg key={i} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={`${id}g`}>
                {blend ? <><stop offset="0%" stopColor={COL.b} /><stop offset={`${a}%`} stopColor={COL.y} /></> : <><stop offset={`${a}%`} stopColor={cLo} /><stop offset={`${a}%`} stopColor={cHi} /></>}
                <stop offset={`${h}%`} stopColor={cHi} /><stop offset={`${h}%`} stopColor={COL.r} />
                <stop offset={`${red}%`} stopColor={COL.r} /><stop offset={`${red}%`} stopColor={COL.none} />
              </linearGradient>
              {z > 0 && <clipPath id={`${id}c`} clipPathUnits="objectBoundingBox"><rect x="-.2" y="-.2" width={(z >= 100 ? 1.2 : z / 100) + 0.2} height="1.4" /></clipPath>}
            </defs>
            {z > 0 && <path d={STAR} className="st-ol" clipPath={`url(#${id}c)`} />}
            <path d={STAR} fill={`url(#${id}g)`} />
          </svg>
        )
      })}
      {!bare && <b>{v == null ? '—' : num(v, 1)}</b>}
      {at && <Tip at={at} r={{ ...r, prov }} v={v} label={label} />}
    </span>
  )
}
