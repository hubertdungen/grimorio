// Análise: o painel de números e gráficos — cartões de topo, curva de mana (criaturas vs. resto), queijinhos de cores
// (pedido nos custos vs. produzido pelos terrenos), probabilidades da mão inicial e as cartas mais caras.
// Cores do Magic fixas por cor (nunca pela posição); ordem W R U G B C para o vermelho não encostar ao verde.
import { useEffect, useMemo, useState } from 'react'
import { COLORS, TYPE_LABEL, img, pidOf, deckPlan, sf } from './data.js'
import { landInfo } from './mana.js'
import { wrDelta } from './tests.js'
import { WIN_LABEL } from './swap.js'
import { winLose } from './winlose.js'
import { tx, num, LOCALE } from './i18n.js'
import { WhiteStars } from './ui.jsx'
import { Trophies, tierOf, Cup, PLACE, KIND } from './Library.jsx'
import { trophyStars, trophyValue, trophyTier, itemValue } from './trophyvalue.js'

const ptsOf = x => trophyValue({ tier: x.platinum ? 'plat' : tierOf(x.place, x.champions), kind: x.type, casual: x.casual, n: x.n, m: x.m, podiums: x.podiums })  // como na Biblioteca

const ORDER = ['W', 'R', 'U', 'G', 'B', 'C']
const COL = { W: '#ecd795', R: '#e05a44', U: '#4f8fe0', G: '#45ad62', B: '#9a72c8', C: '#c5cad3' }
const NAME = { ...COLORS, C: tx('Incolor') }
const sym = k => sf(`https://svgs.scryfall.io/card-symbols/${k}.svg`)
const pc = x => Math.round(x * 100)

// ⓘ com a explicação: aparece ao passar o rato e ao tocar (foco), também no tátil
export function Hint({ t }) { return <span className="hint" tabIndex={0} role="note" aria-label={t} data-t={t}>ⓘ</span> }

export function Kpis({ s, total, fmt, advised, odds, issues, onIssues }) {
  const min = fmt.size[0] || 60
  const tiles = [
    { l: tx('Cartas'), v: total, sub: tx('mínimo {n}', { n: min }), bad: total < min, h: tx('Cartas no deck principal (com o comandante). O mínimo é o do formato.') },
    { l: tx('Terrenos'), v: s.lands, sub: tx('recomendado ~{n}', { n: advised }), bad: Math.abs(s.lands - advised) > 2, h: tx('O recomendado vem da fórmula de Frank Karsten: custo médio do deck e ramp/compra baratos.') },
    { l: tx('Custo médio'), v: num(s.avgMv, 2), sub: tx('sem terrenos'), h: tx('Média do valor de mana (MV) das cartas que não são terrenos. Abaixo de 2,5 é um deck rápido.') },
    { l: tx('Mão jogável'), v: `${pc(odds.keep)}%`, sub: tx('2 a 4 terrenos em 7'), bad: odds.keep < 0.7, h: tx('Probabilidade de a mão inicial de 7 cartas ter 2 a 4 terrenos (conta exata, hipergeométrica).') },
    { l: tx('Preço'), v: `${num(s.price, 0)} €`, sub: s.missingPrice ? tx('{n} sem preço', { n: s.missingPrice }) : 'Cardmarket', h: tx('Soma dos preços da Cardmarket (via Scryfall), com as edições que escolheste.') },
    { l: tx('Validação'), v: issues.length ? issues.length : '✓', sub: issues.length ? tx('problema|problemas', { n: issues.length }) : tx('válido em {f}', { f: fmt.name }), bad: issues.length > 0, ok: !issues.length, onClick: issues.length ? onIssues : null, h: tx('Problemas com as regras do formato: cartas ilegais, cópias a mais, tamanho. Clica para ver as melhorias.') },
  ]
  return (
    <div className="an-kpis">
      {tiles.map(t => {
        const T = t.onClick ? 'button' : 'div'
        return <T key={t.l} className={`kpi ${t.bad ? 'bad' : ''} ${t.ok ? 'ok' : ''}`} onClick={t.onClick || undefined}><small>{t.l} <Hint t={t.h} /></small><b>{t.v}</b><span>{t.sub}</span></T>
      })}
    </div>
  )
}

// curva empilhada: criaturas em baixo, o resto em cima; o total por cima de cada barra
export function CurveChart({ data, deck, s }) {
  const rows = useMemo(() => {
    const r = Array.from({ length: 8 }, () => [0, 0])
    for (const [n, q] of Object.entries(deck.main)) {
      const c = data.byName.get(n)
      if (!c || c.mt === 'Land') continue
      r[Math.min(7, Math.floor(c.cmc))][c.t.includes('Creature') ? 0 : 1] += q
    }
    return r
  }, [data, deck.main])
  const max = Math.max(1, ...rows.map(([a, b]) => a + b))
  const types = Object.entries(s.types).sort((a, b) => b[1] - a[1]), tmax = Math.max(1, ...types.map(t => t[1]))
  return (
    <section className="card an-curve">
      <h3>{tx('Curva de mana')} <span className="muted small">{tx('média {m}', { m: num(s.avgMv, 2) })}</span> <Hint t={tx('Quantas cartas há de cada custo de mana, criaturas em baixo e o resto em cima. Passa o rato numa barra para ver os números.')} /></h3>
      <div className="an-legend"><span><i style={{ background: 'var(--c-crit)' }} />{tx('Criaturas')}</span><span><i style={{ background: 'var(--c-other)' }} />{tx('Outras cartas')}</span></div>
      <div className="scurve" role="img" aria-label={tx('Curva de mana')}>
        {rows.map(([a, b], k) => (
          <div key={k} className="scol" title={`${tx('Custo')} ${k === 7 ? '7+' : k}: ${tx('{n} criatura|{n} criaturas', { n: a })}, ${tx('{n} outra|{n} outras', { n: b })}`}>
            <div className="sbar" style={{ height: `${((a + b) / max) * 100}%` }}>
              {a + b > 0 && <b>{a + b}</b>}
              {b > 0 && <i className="seg-o" style={{ flex: b }} />}
              {a > 0 && <i className="seg-c" style={{ flex: a }} />}
            </div>
            <span>{k === 7 ? '7+' : k}</span>
          </div>
        ))}
      </div>
      <h4>{tx('Tipos')}</h4>
      <ul className="hbars">{types.map(([t, v]) => <li key={t}><span>{TYPE_LABEL[t] || t}</span><i style={{ '--p': `${(v / tmax) * 100}%` }} /><b>{v}</b></li>)}</ul>
    </section>
  )
}

function Donut({ parts, unit, title }) {
  const [hov, setHov] = useState(null)
  const tot = parts.reduce((a, p) => a + p.v, 0)
  if (!tot) return <div className="donut"><h4>{title}</h4><p className="muted small">{tx('Sem dados.')}</p></div>
  const gap = parts.length > 1 ? 1.2 : 0
  let acc = 0
  const h = hov != null ? parts[hov] : null
  return (
    <div className="donut">
      <h4>{title}</h4>
      <svg viewBox="0 0 120 120" role="img" aria-label={`${title}: ${parts.map(p => `${p.name} ${pc(p.v / tot)}%`).join(', ')}`}>
        <g transform="rotate(-90 60 60)">
          {parts.map((p, i) => {
            const len = (p.v / tot) * 100, dash = Math.max(0.01, len - gap)
            const el = (
              <circle key={p.k} cx="60" cy="60" r="44" pathLength="100" fill="none" stroke={p.color} strokeWidth={hov === i ? 20 : 16}
                strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={-acc} className={hov != null && hov !== i ? 'dim' : ''}
                onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}><title>{`${p.name}: ${pc(p.v / tot)}% (${num(p.v, p.v % 1 ? 1 : 0)} ${unit})`}</title></circle>
            )
            acc += len
            return el
          })}
        </g>
        <text x="60" y="58" className="d-big">{h ? `${pc(h.v / tot)}%` : num(tot, tot % 1 ? 1 : 0)}</text>
        <text x="60" y="74" className="d-small">{h ? h.name : unit}</text>
      </svg>
      <ul className="d-legend">{parts.map((p, i) => (
        <li key={p.k} className={hov === i ? 'on' : ''} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
          <i style={{ background: p.color }} /><img src={sym(p.k)} alt="" /><span>{p.name}</span><b>{pc(p.v / tot)}%</b>
        </li>))}</ul>
    </div>
  )
}

// queijinhos: símbolos de mana nos custos vs. o que os terrenos produzem (cada terreno vale 1, dividido pelas suas cores)
export function ColorDonuts({ data, deck, s }) {
  const prod = useMemo(() => {
    const deckCols = new Set(), out = Object.fromEntries(ORDER.map(k => [k, 0]))
    for (const n of [...Object.keys(deck.main), ...deck.commanders]) for (const k of data.byName.get(n)?.ci || '') deckCols.add(k)
    for (const [n, q] of Object.entries(deck.main)) {
      const c = data.byName.get(n)
      if (!c || c.mt !== 'Land') continue
      const L = landInfo(c, deck.commanders.length > 0)
      let cols = L.any ? [...deckCols] : [...L.colors].flatMap(k => (k === '*' ? [...deckCols] : [k]))
      cols = [...new Set(cols)].filter(k => ORDER.includes(k))
      if (/search your library/i.test(c.o)) cols = cols.filter(k => deckCols.has(k))  // fetch: só traz o que o deck tem (Scalding Tarn num deck sem vermelho dá azul)
      if (!cols.length) continue
      for (const k of cols) out[k] += q / cols.length
    }
    return out
  }, [data, deck.main, deck.commanders])
  const parts = o => ORDER.filter(k => o[k] > 0).map(k => ({ k, v: o[k], color: COL[k], name: NAME[k] }))
  return (
    <section className="card an-colors">
      <h3>{tx('Cores')} <span className="muted small">{tx('o que os custos pedem vs. o que os terrenos dão')}</span> <Hint t={tx('À esquerda, as cores dos símbolos de mana nos custos; à direita, as cores que os terrenos produzem. Devem ser parecidas: uma cor que pede muito mais do que recebe falha nos primeiros turnos.')} /></h3>
      <div className="donuts">
        <Donut title={tx('Símbolos nos custos')} unit={tx('símbolos')} parts={parts(s.pips)} />
        <Donut title={tx('Mana dos terrenos')} unit={tx('terrenos')} parts={parts(prod)} />
      </div>
      <p className="muted small">{tx('Um terreno de duas cores conta meio para cada uma. Se uma cor pede muito mais do que recebe, faltam fontes dessa cor.')}</p>
    </section>
  )
}

export function HandOdds({ odds, onDraw, hand, data, deck, act, canDraw }) {
  const max = Math.max(...odds.hist)
  return (
    <section className="card an-hand">
      <h3>{tx('Mão inicial')} <Hint t={tx('Contas exatas com os terrenos do deck: a mão de 7 cartas e os terrenos que vês até ao 3.º e 4.º turno, a jogar primeiro.')} /></h3>
      <div className="odds">
        <span><b>{pc(odds.keep)}%</b><small>{tx('2 a 4 terrenos em 7 cartas')}</small></span>
        <span><b>{pc(odds.t3)}%</b><small>{tx('3.º terreno a tempo (a jogar primeiro)')}</small></span>
        <span><b>{pc(odds.t4)}%</b><small>{tx('4.º terreno a tempo')}</small></span>
      </div>
      <div className="hist" role="img" aria-label={tx('Probabilidade de cada número de terrenos na mão inicial')}>
        {odds.hist.map((p, k) => (
          <div key={k} title={tx('{k} terrenos: {p}%', { k, p: num(p * 100, 1) })} className={k >= 2 && k <= 4 ? 'keep' : ''}>
            <i style={{ height: `${(p / max) * 100}%` }}>{p >= 0.05 && <b>{pc(p)}</b>}</i><span>{k}</span>
          </div>
        ))}
      </div>
      <p className="muted small">{tx('Terrenos na mão de 7 (a dourado, as mãos que se costumam manter).')}</p>
      <div className="row-btns"><button className="primary" onClick={() => onDraw(7)} disabled={!canDraw}>{tx('Tirar 7')}</button>{hand && <button onClick={() => onDraw(Math.max(1, hand.length - 1))}>Mulligan ({Math.max(1, hand.length - 1)})</button>}</div>
      {hand && <div className="hand">{hand.map((n, k) => { const c = data.byName.get(n); return c && <img key={k} src={img(c, 'normal', false, pidOf(deck, n))} alt={n} onClick={() => act.open(c)} /> })}</div>}
      {hand && <p className="muted small">{tx('{n} terreno nesta mão.|{n} terrenos nesta mão.', { n: hand.filter(n => data.byName.get(n)?.mt === 'Land').length })}</p>}
    </section>
  )
}

export function PriceCard({ data, deck, s, act }) {
  const top = useMemo(() => Object.entries(deck.main).map(([n, q]) => {
    const c = data.byName.get(n), pr = deck.prints?.[n], p = (pr && (pr.foil ? pr.eurFoil ?? pr.eur : pr.eur ?? pr.eurFoil)) ?? c?.eur ?? c?.usd
    return c && p != null ? { c, q, p, t: p * q } : null
  }).filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 6), [data, deck.main, deck.prints])
  return (
    <section className="card">
      <h3>{tx('Preço')}</h3>
      <p className="big-num">{num(s.price, 2)} €</p>
      {top.length > 0 && <ul className="hbars price">{top.map(x => (
        <li key={x.c.n}><button className="link plain" onClick={() => act.open(x.c)}>{x.q}× {x.c.n}</button><i style={{ '--p': `${(x.t / top[0].t) * 100}%` }} /><b>{num(x.t, 2)} €</b></li>
      ))}</ul>}
      <p className="muted small">{tx('Preços da Cardmarket via Scryfall (versão mais barata não garantida).')}{s.missingPrice ? ` ${tx('{n} carta sem preço.|{n} cartas sem preço.', { n: s.missingPrice })}` : ''}</p>
    </section>
  )
}


// o que os jogos dizem de cada carta (gameEvidence dos jogos do Laboratório, torneios e Arena com registo completo):
// com que cartas na mão se ganha mais ou menos, e as que ficam paradas na mão
export function CardsInGames({ data, deck, ev, act, peek, unpeek }) {
  const rows = useMemo(() => {
    if (!ev?.exact) return null
    const all = Object.entries(ev.cards || {}).filter(([n]) => data.byName.get(n))
    // ganhar/perder: os jogos em que a carta foi JOGADA (lançada ou posta em campo), não só os em que passou pela mão
    const list = all.filter(([, x]) => x.played >= 3).map(([n, x]) => ({ n, x, d: wrDelta(ev, x, 'played') }))
    const held = all.filter(([, x]) => x.seen >= 3).map(([n, x]) => ({ n, x }))
    return {
      up: list.filter(r => r.d > 0.05).sort((a, b) => b.d - a.d).slice(0, 6),
      down: list.filter(r => r.d < -0.05).sort((a, b) => a.d - b.d).slice(0, 6),
      stuck: held.filter(r => r.x.dead >= 2 && r.x.dead / r.x.seen >= 0.4).sort((a, b) => b.x.dead / b.x.seen - a.x.dead / a.x.seen).slice(0, 6),
    }
  }, [ev, data])
  const name = n => { const c = data.byName.get(n); return <button className="link plain" onMouseEnter={e => peek(e, c, pidOf(deck, n))} onMouseLeave={unpeek} onClick={() => { unpeek(); act.open(c) }}>{n}</button> }
  const subP = x => tx('jogada em {n} jogos, ganhou {w}', { n: x.played, w: x.playedW })
  const subS = x => tx('vista em {n} jogos, ganhou {w}', { n: x.seen, w: x.seenW })
  const list = (l, val, why, sub = subP) => (l.length ? <ul className="rec-list">{l.map(r => <li key={r.n}><span>{name(r.n)}</span><b title={why}>{val(r)}</b><small className="muted">{sub(r.x)}</small></li>)}</ul> : <small className="muted">{tx('Nada claro ainda.')}</small>)
  const why = tx('Diferença na percentagem de vitórias entre os jogos em que a carta foi jogada (lançada ou posta em campo) e os outros (puxada para a média enquanto há poucos jogos).')
  return (
    <section className="card">
      <h3>{tx('Cartas nos jogos')} <Hint t={why} /> {ev?.exact ? <span className="muted small">{tx('{n} jogos com registo completo', { n: ev.exact })}</span> : null}</h3>
      {!rows ? <p className="muted small">{tx('Joga o deck no Laboratório (ou num torneio) para saber com que cartas ganha e quais ficam paradas na mão.')}</p> : <>
        {ev.wincon && <p className="small" title={tx('A via mais comum nas vitórias dos testes')}>{tx('Nos testes ganha sobretudo por {v} ({n} vitórias).', { v: WIN_LABEL[ev.wincon.kind] || ev.wincon.kind, n: ev.wincon.games })}</p>}
        <h4 title={why}>{tx('Ganha mais quando a joga')}</h4>
        {list(rows.up, r => `+${Math.round(r.d * 100)}%`, why)}
        <h4 title={why}>{tx('Perde mais quando a joga')}</h4>
        {list(rows.down, r => `${Math.round(r.d * 100)}%`, why)}
        <h4 title={tx('Esteve na mão 3 ou mais turnos sem ser usada')}>{tx('Fica parada na mão')}</h4>
        {list(rows.stuck, r => `${r.x.dead}/${r.x.seen}`, tx('jogos em que ficou presa / jogos em que esteve na mão'), subS)}
      </>}
    </section>
  )
}

const VERDICT = { forte: tx('sólido'), razoavel: tx('razoável'), fraco: tx('fraco'), vazio: tx('vazio') }
export function WinLoseCard({ data, deck, fmt, ctx, act, peek, unpeek, toSide }) {
  const r = useMemo(() => winLose(data, deck, fmt, { ev: ctx.tests, ctx, plan: deckPlan(data, Object.keys(deck.main).map(n => data.byName.get(n)?.i).filter(i => i != null)) }), [data, deck, fmt, ctx])
  const name = n => { const c = data.byName.get(n); return c ? <button key={n} className="link plain wl-card" onMouseEnter={e => peek(e, c, pidOf(deck, n))} onMouseLeave={unpeek} onClick={() => { unpeek(); act.open(c) }}>{n}</button> : <span key={n}>{n}</span> }
  const item = (x, k) => <li key={k}><b>{x.label}</b><span className="muted small">{x.why}</span>{x.cards?.length > 0 && <span className="wl-cards">{x.cards.map(name)}</span>}</li>
  return (
    <section className="card wl">
      <h3>{tx('Como ganha e como perde')} <Hint t={tx('Vias de vitória e riscos tirados da construção do deck e dos jogos de teste; o sideboard é avaliado contra o que te venceu.')} /></h3>
      <div className="wl-grid">
        <div><h4 className="ok-t">✓ {tx('Formas de ganhar')}</h4>{r.wins.length ? <ul className="wl-list">{r.wins.map(item)}</ul> : <p className="muted small">{tx('Sem uma via clara: falta uma condição de vitória.')}</p>}</div>
        <div><h4 className="bad-t">⚠ {tx('Formas de perder')}</h4>{r.risks.length ? <ul className="wl-list">{r.risks.map(item)}</ul> : <p className="muted small">{tx('Nada de evidente na construção nem nos testes.')}</p>}</div>
      </div>
      {r.side && <div className={`wl-side ${r.side.verdict}`}>
        <h4>🛡 {tx('Sideboard')}: {VERDICT[r.side.verdict]} <span className="muted small">{tx('{n} cartas', { n: r.side.n })}</span></h4>
        {r.side.covers.length > 0 && <p className="small">{tx('Cobre:')} {r.side.covers.map(c => `${c.label} (${c.n})`).join(' · ')}</p>}
        {r.side.gaps.map((g, k) => <p key={k} className="small">{g.risk}: {g.has.length ? <>{tx('tem')} {g.has.map((n, j) => <span key={n}>{j ? ', ' : ''}{name(n)}</span>)}</> : <span className="bad-t">{tx('nada no sideboard para isto')}</span>}</p>)}
        {!r.side.n && <p className="small muted">{tx('Sem sideboard: nos jogos à melhor de 3 entras sem respostas para o que te bate.')}</p>}
        <button className="link small" onClick={toSide}>🛡 {tx('Sugestões de sideboard →')}</button>
      </div>}
    </section>
  )
}

// ⭐ Ratings do deck: as estrelas que aparecem na Biblioteca, explicadas — normal (amarelo: Elo do formato), todos os jogos
// (azul: inclui casuais e cruzados), objetivo (vermelho: ganha pela via do deck), casual e troféus (estrelas brancas)
const ROUTE = { dmg: tx('dano'), psn: tx('veneno'), cmd: tx('dano de comandante'), mill: tx('moer'), alt: tx('vitória alternativa') }
// estrelas de uma cor só (0–6), com o número; a fila cinzenta por baixo e a cor por cima, cortada (como as WhiteStars)
function ColorStars({ v, color, prov }) {
  return (
    <span className={`wstars${prov ? ' prov' : ''}`} aria-label={num(v, 1)}>
      <span className="ws-row" aria-hidden="true"><span className="ws-bg">★★★★★★</span>
        <span className="ws-fg" style={{ width: `${(Math.max(0, Math.min(6, v)) / 6) * 100}%`, color }}>★★★★★★</span></span>
      <b style={{ color }}>{num(v, 1)}</b>
    </span>
  )
}

export function RatingsCard({ deck }) {
  const [rt, setRt] = useState(null), [tro, setTro] = useState(null)
  useEffect(() => {
    if (!deck.id) return
    fetch('/api/ratings/stars').then(r => r.json()).then(setRt).catch(() => setRt({}))
    fetch('/api/tournaments/trophies').then(r => (r.ok ? r.json() : {})).then(setTro).catch(() => setTro({}))
  }, [deck.id])
  if (!deck.id || !rt) return null
  const n = rt[`deck:${deck.id}`], c = rt[`deck:${deck.id}|casual`], list = tro?.[deck.id] || []
  const pts = list.filter(x => x.valid).reduce((a, x) => a + ptsOf(x), 0)
  const games = (x, k = 'games') => tx('{n} jogos', { n: x?.[k] || 0 })
  const row = (label, stars, txt, cls) => <li className={cls}><span className="drt-l">{label}</span><span className="drt-s">{stars}</span><small className="muted">{txt}</small></li>
  const routes = n?.routes ? Object.entries(n.routes).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${ROUTE[k] || k} ${Math.round(v * 100)}%`).join(' · ') : ''
  return (
    <section className="card rt-card">
      <h3>⭐ {tx('Ratings do deck')}</h3>
      {!n && !c && !list.length ? <p className="muted small">{tx('Ainda sem rating: joga o deck no Laboratório, em torneios ou na Arena.')}</p> : (
        <ul className="drt-list">
          {n && row(tx('Normal'), <ColorStars v={n.stars} color="#f2b84b" prov={n.prov} />, `Elo ${n.elo} · ${games(n)}${n.prov ? ` · ${tx('provisório')}` : ''}`, 'drt-y')}
          {n?.blue != null && row(tx('Todos os jogos'), <ColorStars v={n.blue} color="#6aa8ff" />, `Elo ${n.blue_elo} · ${games(n, 'blue_games')} (${tx('com casuais e cruzados')})`, 'drt-b')}
          {n?.red != null && row(tx('Objetivo'), <ColorStars v={n.red} color="#ff6b6b" />, `${tx('ganha pela via do deck {p}% das vezes', { p: Math.round((n.goal || 0) * 100) })}${routes ? ` · ${routes}` : ''}`, 'drt-r')}
          {c && row(tx('Casual'), <ColorStars v={c.stars} color="#c9a35a" prov={c.prov} />, `Elo ${c.elo} · ${games(c)}${c.prov ? ` · ${tx('provisório')}` : ''}`, 'drt-c')}
          {row(tx('Troféus'), <WhiteStars v={trophyStars(pts)} title={tx('{p} pontos de troféus', { p: pts })} />, list.length ? <>{tx('{n} troféus · {p} pontos', { n: list.length, p: pts })} <Trophies list={list} /></> : tx('ainda sem pódios em torneios'), 'drt-w')}
        </ul>
      )}
      {list.length > 0 && <ul className="drt-shelf" aria-label={tx('Troféus ganhos')}>{list.map(x => {  // cada troféu: o torneio, o lugar e a data; abre o torneio
        const t = trophyTier(x)
        return <li key={`${x.tid}${x.place}`} className={x.valid ? '' : 'off'}><button className="plain" onClick={() => openTour(x.tid)} title={`${PLACE[t]} · ${KIND[x.type] || ''}${x.valid ? ` · ${tx('+{p} pontos', { p: itemValue(x) })}` : ` · ${tx('não conta: a lista mudou mais de 10%')}`}`}>
          <Cup place={t} kind={x.type} casual={x.casual} friends={x.friends} off={!x.valid} /><span><b>{x.name}</b><small className="muted">{PLACE[t].split(':')[0]} · {x.rec[0]}V {x.rec[1]}D{x.rec[2] ? ` ${x.rec[2]}E` : ''} · {new Date(x.ts * 1000).toLocaleDateString(LOCALE)}</small></span></button></li>
      })}</ul>}
    </section>
  )
}
// abre um torneio no Coliseu (Ao vivo mostra o pódio dos acabados)
const openTour = id => { try { localStorage.setItem('grimorio.torneio', id); localStorage.setItem('grimorio.torneio.vista', 'ver') } catch { /* sem armazenamento */ } window.dispatchEvent(new CustomEvent('grimorio:col', { detail: 'torneio' })) }
