import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { img, TAG_LABEL, sf } from './data.js'
import { tx, num } from './i18n.js'

const sym = s => sf(`https://svgs.scryfall.io/card-symbols/${s.replace(/\//g, '')}.svg`)

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
// vista: amarelo maior ou igual = diagonal azul/amarelo até ao azul e amarelo no resto; azul maior = amarelo até ao seu
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
      <p><i className="st-dot" style={{ background: COL.r }} /><b>{tx('Objetivo')} {r.red != null && num(r.red, 1)}</b> {tx('— quanto chega, em média, ao objetivo de ganhar (100% = 3★, 200% = 6★: acima de 3★ só quem passa do objetivo)')}
        {r.goal != null && <> · <b>{pc(r.goal)}</b>{rt.length ? `: ${rt.map(([k, x]) => `${ROUTE[k]} ${pc(x)}`).join(' · ')}` : ''}{by ? ` · ${tx('ganha sobretudo por {v}', { v: ROUTE[by[0]] })}` : ''}</>}</p>
      {r.prov && <p className="muted small">{PROV_TIP}</p>}
    </div>, document.body)
}

// Camadas visíveis (Definições › Estrelas): 'ybr' = amarelo, azul e vermelho (por omissão); qualquer subconjunto
const SL_KEY = 'grimorio.stars', slSubs = new Set()
let starLayers = (() => { try { return localStorage.getItem(SL_KEY) || 'ybr' } catch { return 'ybr' } })()
export const getStarLayers = () => starLayers
export function setStarLayers(v) {
  starLayers = [...'ybr'].filter(k => v.includes(k)).join('') || 'ybr'
  try { localStorage.setItem(SL_KEY, starLayers) } catch { /* sem armazenamento */ }
  slSubs.forEach(f => f())
}
const useStarLayers = () => useSyncExternalStore(f => { slSubs.add(f); return () => slSubs.delete(f) }, getStarLayers)

// Cores nos jogos (Definições › Cores): a tua (também marca o teu deck nos torneios), a do adversário (ou sem cor) e
// os jogos sem o teu deck (cores aleatórias por deck, sempre as mesmas, ou sem cor)
export const COLORS0 = { me: '#6ee7f9', opp: '#ff6b8a', oppOn: true, others: 'aleatorio' }
const CO_KEY = 'grimorio.cores', coSubs = new Set(), NEUTRAL = '#9a93b5'
let colors = (() => { try { return { ...COLORS0, ...JSON.parse(localStorage.getItem(CO_KEY) || '{}') } } catch { return COLORS0 } })()
const paintMe = () => { try { document.documentElement.style.setProperty('--me', colors.me) } catch { /* sem DOM */ } }
paintMe()
export const getColors = () => colors
export function setColors(v) {
  colors = { ...colors, ...v }
  try { localStorage.setItem(CO_KEY, JSON.stringify(colors)) } catch { /* sem armazenamento */ }
  paintMe(); coSubs.forEach(f => f())
}
export const useColors = () => useSyncExternalStore(f => { coSubs.add(f); return () => coSubs.delete(f) }, getColors)
const hueOf = str => { let h = 0; for (const ch of String(str || '')) h = (h * 31 + ch.codePointAt(0)) % 360; return h }
// variáveis --pa…--pd do tabuleiro: pov = o lado do teu deck (ou null num jogo sem ele); names = {a: nome, b: …}
export function sideColors(c, pov, names) {
  const out = {}, opps = [...'abcd'].filter(k => k !== pov)
  for (const k of 'abcd') {
    const n = opps.indexOf(k)  // 0 = o adversário principal; 1 e 2 = os outros (3-4 jogadores): outras cores derivadas da dele
    out[`--p${k}`] = pov ? (k === pov ? c.me : !c.oppOn ? NEUTRAL : n === 0 ? c.opp : `hsl(${(hueOf(c.opp) + n * 70) % 360} 70% 66%)`)
      : c.others === 'aleatorio' ? `hsl(${hueOf(names?.[k] || k)} 72% 66%)` : NEUTRAL
  }
  return out
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
  // a primeira camada visível (amarelo › azul › vermelho) é a principal: cheia e dá o número; o azul só se sobrepõe ao
  // amarelo e o vermelho fica por baixo das outras (sozinho, enche as estrelas)
  const L = useStarLayers(), raw = { y: v, b: r?.blue, r: r?.red }
  const mk = L.includes('y') ? 'y' : L.includes('b') ? 'b' : 'r', MC = COL[mk], mv = raw[mk]
  const b = mk === 'y' && L.includes('b') ? raw.b : null, rd = mk !== 'r' && L.includes('r') ? raw.r : null
  if (mv == null && b == null && rd == null) return <span className="stars none" title={tx('sem rating ainda')} role="img" aria-label={tx('sem rating ainda')}>★</span>
  const y = mv ?? 0, lo = Math.min(y, b ?? y), hi = Math.max(y, b ?? y), top = Math.max(hi, rd ?? 0)
  const [cLo, cHi] = b != null && b < y ? [COL.b, MC] : [MC, COL.b]
  // o amarelo vê-se sempre: com o amarelo maior ou igual, a parte comum fica em degradê azul→amarelo e o resto amarelo;
  // com o azul maior, primeiro o amarelo e depois o azul
  const blend = b != null && b > 0 && b <= y
  const slots = Math.max(1, Math.min(6, Math.ceil(top - 1e-9)))
  const f = (x, i) => Math.max(0, Math.min(1, x - i)) * 100
  const t = [`${label}${tx('Normal')} ${raw.y == null ? '—' : num(raw.y, 1)}`, raw.b != null && `${tx('Todos os jogos')} ${num(raw.b, 1)}`, raw.r != null && `${tx('Objetivo')} ${num(raw.r, 1)}`].filter(Boolean).join(' · ')
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
                {blend ? <stop offset={`${a}%`} stopColor={COL.y} /> : <><stop offset={`${a}%`} stopColor={cLo} /><stop offset={`${a}%`} stopColor={cHi} /></>}
                <stop offset={`${h}%`} stopColor={cHi} /><stop offset={`${h}%`} stopColor={COL.r} />
                <stop offset={`${red}%`} stopColor={COL.r} /><stop offset={`${red}%`} stopColor={COL.none} />
              </linearGradient>
              {z > 0 && <clipPath id={`${id}c`} clipPathUnits="objectBoundingBox"><rect x="-.2" y="-.2" width={(z >= 100 ? 1.2 : z / 100) + 0.2} height="1.4" /></clipPath>}
              {blend && a > 0 && <>  {/* parte comum: diagonal azul↖ amarelo↘ com a passagem curta (sem o cinzento da mistura) */}
                <linearGradient id={`${id}d`} x1="0" y1="0" x2="1" y2="1"><stop offset=".45" stopColor={COL.b} /><stop offset=".55" stopColor={COL.y} /></linearGradient>
                <clipPath id={`${id}a`} clipPathUnits="objectBoundingBox"><rect x="-.2" y="-.2" width={a / 100 + 0.2} height="1.4" /></clipPath>
              </>}
            </defs>
            {z > 0 && <path d={STAR} className="st-ol" clipPath={`url(#${id}c)`} />}
            <path d={STAR} fill={`url(#${id}g)`} />
            {blend && a > 0 && <path d={STAR} fill={`url(#${id}d)`} clipPath={`url(#${id}a)`} />}
          </svg>
        )
      })}
      {!bare && <b style={mk === 'y' ? undefined : { color: MC }}>{mv == null ? '—' : num(mv, 1)}</b>}
      {at && <Tip at={at} r={{ ...r, prov }} v={v} label={label} />}
    </span>
  )
}

// Estrelas brancas: os pontos de troféus em 0–6 estrelas (trophyvalue.js trophyStars); uma fila cinzenta por baixo e a
// branca por cima, cortada na parte certa
export function WhiteStars({ v, title }) {
  return (
    <span className="wstars" title={title} aria-label={title}>
      <span className="ws-row" aria-hidden="true"><span className="ws-bg">★★★★★★</span>
        <span className="ws-fg" style={{ width: `${(Math.max(0, Math.min(6, v)) / 6) * 100}%` }}>★★★★★★</span></span>
      <b>{num(v, 1)}</b>
    </span>
  )
}

// De quem é um deck (para filtrar Ratings, Hall da fama e Galeria): meu, de um amigo, da comunidade ou do meta
export const SRC_KINDS = [['meu', tx('🧙 Meus')], ['ami', tx('🤝 Amigos')], ['com', tx('🌐 Comunidade')], ['meta', tx('📊 Meta')]]
// botões que se ligam e desligam (fica sempre pelo menos um ligado)
export function SrcFilter({ on, set, has }) {
  return (
    <span className="seg src-filt" role="group" aria-label={tx('De quem')}>{SRC_KINDS.map(([k, l]) => {
      const a = on.includes(k)
      return <button key={k} className={a ? 'on' : ''} aria-pressed={a} disabled={has && !has.has(k)} onClick={() => set(a ? (on.length > 1 ? on.filter(x => x !== k) : on) : [...on, k])}>{l}</button>
    })}</span>
  )
}
