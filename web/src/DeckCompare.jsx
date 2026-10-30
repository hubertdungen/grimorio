// Comparar 2–4 decks: resumo lado a lado (lista, curva, ratings, jogos, objetivo, troféus) e cartas em comum / só num
// deles, com as quantidades de cada um.
import { useEffect, useMemo, useState } from 'react'
import { stats } from './deck.js'
import { FORMAT } from './formats.js'
import { img } from './data.js'
import { Mana, Stars } from './ui.jsx'
import { tx, num } from './i18n.js'
import { useBackClose } from './backnav.js'

const L = ['A', 'B', 'C', 'D']
const ROUTE = { dmg: tx('dano'), psn: tx('veneno'), cmd: tx('comandante'), mill: tx('biblioteca'), alt: tx('vitória alternativa') }
// Semelhança entre duas listas (0–1): soma dos mínimos / soma dos máximos das quantidades de cada carta
// (Jaccard com pesos). Ignora nome e capa; sem terrenos mede o «miolo» do deck.
export function similarity(data, a, b, lands = true) {
  const q = d => { const m = { ...(d.main || {}) }; for (const n of d.commanders || []) m[n] = (m[n] || 0) + 1; return m }
  const A = q(a), B = q(b)
  let lo = 0, hi = 0
  for (const n of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!lands && data.byName.get(n)?.mt === 'Land') continue
    lo += Math.min(A[n] || 0, B[n] || 0); hi += Math.max(A[n] || 0, B[n] || 0)
  }
  return hi ? lo / hi : 0
}
const pct = x => `${Math.round(x * 100)}%`
const qty = (d, n) => (d.main?.[n] || 0) + ((d.commanders || []).includes(n) ? 1 : 0)
const colorsOf = (data, d) => 'WUBRG'.split('').filter(x => [...(d.commanders || []), ...Object.keys(d.main || {})].some(n => { const c = data.byName.get(n); return c && c.mt !== 'Land' && (c.ci || '').includes(x) }))

// semelhança de «mecânicas»: as funções das cartas (remoção, compra, fichas, cemitério…) como vetor, cosseno 0–1
const TAGW = s => s.tags || {}
function mechSim(sa, sb) {
  const A = TAGW(sa), B = TAGW(sb), ks = new Set([...Object.keys(A), ...Object.keys(B)])
  let ab = 0, aa = 0, bb = 0
  for (const k of ks) { ab += (A[k] || 0) * (B[k] || 0); aa += (A[k] || 0) ** 2; bb += (B[k] || 0) ** 2 }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0
}
const INTER = ['removal', 'counter', 'wipe'], ENGINE = ['draw', 'tutor']
const cnt = (s, ks) => ks.reduce((a, k) => a + (s.tags?.[k] || 0), 0)

// Porquê? Em decks parecidos (cartas ou mecânicas), o que o melhor tem que o outro não: interação, motor, curva,
// terrenos, staples, via de vitória e se a diferença é fiável (jogos suficientes). Heurísticas, não certezas.
function Why({ data, decks, st, rt }) {
  const r = d => rt[`deck:${d.id}`]
  const rated = decks.map((d, k) => ({ d, k, s: st[k], r: r(d) })).filter(x => x.r?.stars != null)
  if (rated.length < 2) return null
  const best = rated.reduce((a, b) => (b.r.stars > a.r.stars ? b : a))
  const out = rated.filter(x => x !== best).map(o => {
    const simC = similarity(data, best.d, o.d, false), simM = mechSim(best.s, o.s)
    if (simC < 0.2 && simM < 0.85) return { o, simC, simM, far: true }
    const why = [], B = best.s, O = o.s, gap = best.r.stars - o.r.stars
    const iB = cnt(B, INTER), iO = cnt(O, INTER), eB = cnt(B, ENGINE), eO = cnt(O, ENGINE)
    if (iB - iO >= 2) why.push(tx('mais interação: {a} remoções/contra-feitiços contra {b}', { a: iB, b: iO }))
    else if (iO - iB >= 2) why.push(tx('tem menos interação ({a} contra {b}) e mesmo assim ganha mais: a força vem de outro lado', { a: iB, b: iO }))
    if (eB - eO >= 2) why.push(tx('mais motor de cartas (compra e tutores): {a} contra {b}', { a: eB, b: eO }))
    if (O.avgMv - B.avgMv >= 0.25) why.push(tx('é mais baixo (custo médio {a} contra {b}): joga mais cedo e tropeça menos', { a: num(B.avgMv, 2), b: num(O.avgMv, 2) }))
    else if (B.avgMv - O.avgMv >= 0.25) why.push(tx('é mais alto (custo médio {a} contra {b}): as cartas mais caras pesam mais quando chegam', { a: num(B.avgMv, 2), b: num(O.avgMv, 2) }))
    const per = s => (s.lands ? s.lands / Math.max(1, s.lands + s.spells) : 0), want = s => 0.33 + 0.05 * Math.max(0, s.avgMv - 2)  // terrenos «certos» sobem com o custo médio
    const off = s => Math.abs(per(s) - want(s))
    if (off(O) - off(B) > 0.03) why.push(tx('terrenos mais acertados à curva ({a} contra {b})', { a: B.lands, b: O.lands }))
    // staples: cartas (sem terrenos) que o melhor tem a mais, as mais jogadas no EDHREC primeiro
    const more = Object.entries(best.d.main || {}).filter(([n, q]) => q > (o.d.main?.[n] || 0) && data.byName.get(n)?.mt !== 'Land')
      .map(([n]) => data.byName.get(n)).filter(c => c?.er).sort((a, b) => a.er - b.er).slice(0, 4).map(c => c.n)
    if (more.length) why.push(tx('cartas que só ele tem (ou tem mais): {l}', { l: more.join(', ') }))
    if (best.r.goal != null && o.r.goal != null && best.r.goal - o.r.goal >= 0.08) why.push(tx('chega mais vezes ao objetivo do deck ({a} contra {b})', { a: pct(Math.min(1, best.r.goal)), b: pct(Math.min(1, o.r.goal)) }))
    const few = [best, o].filter(x => (x.r.games || 0) < 10)
    const note = few.length ? tx('Atenção: {l} com menos de 10 jogos — a diferença pode ser sorte.', { l: few.map(x => L[x.k]).join(' e ') })
      : gap < 0.3 ? tx('A diferença é pequena ({g}★): pode ser só variância.', { g: num(gap, 1) }) : ''
    return { o, simC, simM, why, note, gap }
  })
  return (
    <section className="cmp-why">
      <h4>🔍 {tx('Porquê?')} <span className="muted small">{tx('o que o deck mais bem cotado ({l}) tem a mais, nos decks parecidos', { l: L[best.k] })}</span></h4>
      {out.map(x => (
        <div key={x.o.d.id} className="cmp-why-p">
          <b><span className={`cmp-l l${best.k}`}>{L[best.k]}</span> {num(best.r.stars, 1)}★ {tx('contra')} <span className={`cmp-l l${x.o.k}`}>{L[x.o.k]}</span> {num(x.o.r.stars, 1)}★</b>
          <small className="muted"> · {tx('cartas {c} · mecânicas {m}', { c: pct(x.simC), m: pct(x.simM) })}</small>
          {x.far ? <p className="small muted">{tx('Pouco parecidos (cartas e mecânicas diferentes): a comparação diz pouco.')}</p>
            : <>{x.why.length ? <ul className="small">{x.why.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="small muted">{tx('Nada salta à vista nas listas: a diferença deve estar nas interações entre cartas ou nos adversários que calharam.')}</p>}
              {x.note && <p className="small muted">⚠ {x.note}</p>}</>}
        </div>
      ))}
    </section>
  )
}

export default function DeckCompare({ data, decks, onClose, onOpen, onFav, onDelete, rt = {}, trophies = null }) {  // rt: estrelas por chave; trophies(d): os troféus do deck
  useBackClose(true, onClose)  // «voltar» do telemóvel fecha esta janela
  const [show, setShow] = useState('dif')  // dif | comum | todas
  const [lands, setLands] = useState(false)
  // artes próprias dos decks (vêm só no deck completo, não no resumo da Biblioteca)
  const [art, setArt] = useState({})
  const ids = decks.map(d => d.id).join()
  useEffect(() => {
    Promise.all(ids.split(',').map(id => fetch(`/api/decks/${id}`).then(r => r.json()).then(x => x.art || {}).catch(() => ({}))))
      .then(xs => setArt(Object.assign({}, ...xs.reverse())))
  }, [ids])
  const st = useMemo(() => decks.map(d => stats({ main: d.main || {}, commanders: d.commanders || [] }, data)), [decks, data])
  const rows = useMemo(() => {
    const names = [...new Set(decks.flatMap(d => [...(d.commanders || []), ...Object.keys(d.main || {})]))]
    return names.map(n => ({ n, c: data.byName.get(n), q: decks.map(d => qty(d, n)) }))
      .filter(r => lands || r.c?.mt !== 'Land')
      .map(r => ({ ...r, all: r.q.every(x => x > 0), same: r.q.every(x => x === r.q[0]) }))
      .sort((a, b) => (a.all - b.all) || (a.c?.cmc ?? 99) - (b.c?.cmc ?? 99) || a.n.localeCompare(b.n))
  }, [decks, data, lands])
  const vis = rows.filter(r => (show === 'todas' ? true : show === 'comum' ? r.all : !r.all || !r.same))
  const common = rows.filter(r => r.all).length
  const line = (label, f) => <tr><th>{label}</th>{decks.map((d, k) => <td key={d.id}>{f(d, st[k], k)}</td>)}</tr>
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal cmp" role="dialog" aria-label={tx('Comparar decks')}>
        <div className="row-btns cmp-top"><b>{tx('Comparar {n} decks', { n: decks.length })}</b><span className="muted small">{tx('{n} cartas em comum (sem terrenos: {k})', { n: common, k: rows.filter(r => r.all && r.c?.mt !== 'Land').length })}</span><button onClick={onClose}>{tx('Fechar')}</button></div>
        <table className="cmp-sum"><tbody>
          <tr><th />{decks.map((d, k) => <td key={d.id}><span className={`cmp-l l${k}`}>{L[k]}</span> <b>{d.name}</b></td>)}</tr>
          {line(tx('Formato'), d => FORMAT[d.format]?.name || d.format)}
          {line(tx('Cores'), d => { const c = colorsOf(data, d); return c.length ? <Mana cost={c.map(x => `{${x}}`).join('')} /> : '—' })}
          {line(tx('Cartas'), d => d.count)}
          {line(tx('Terrenos'), (d, s) => s.lands)}
          {line(tx('Criaturas'), (d, s) => s.types.Creature || 0)}
          {line(tx('Custo médio'), (d, s) => num(s.avgMv, 2))}
          {line(tx('Curva'), (d, s) => <span className="cmp-curve">{s.curve.map((v, i) => <i key={i} style={{ height: `${Math.min(100, v * 6)}%` }} title={`${i}${i === 7 ? '+' : ''}: ${v}`} />)}</span>)}
          {line(tx('Preço'), (d, s) => (s.price ? `${s.price.toFixed(0)} €` : '—'))}
          {line(tx('Rating'), d => (rt[`deck:${d.id}`] ? <Stars r={rt[`deck:${d.id}`]} /> : <span className="muted">{tx('sem rating')}</span>))}
          {line(tx('Jogos'), d => { const r = rt[`deck:${d.id}`]; return r ? <span title={tx('com rating (amarelo) · todos os jogos (azul)')}>{r.games || 0} · {r.blue_games || 0}</span> : '—' })}
          {line(tx('Objetivo'), d => { const r = rt[`deck:${d.id}`]; return r?.goal != null ? <span title={tx('quanto chega, em média, ao objetivo de ganhar')}>{Math.round(r.goal * 100)}% · {num(r.red, 1)}★</span> : '—' })}
          {line(tx('Ganha por'), d => { const by = Object.entries(rt[`deck:${d.id}`]?.by || {}).sort((a, b) => b[1] - a[1]), w = by.reduce((a, [, n]) => a + n, 0); return w ? by.map(([k, n]) => `${ROUTE[k] || k} ${Math.round((100 * n) / w)}%`).join(' · ') : '—' })}
          {line(tx('Casual'), d => { const r = rt[`deck:${d.id}|casual`]; return r ? <span>★{num(r.stars, 1)} <span className="muted small">({r.games} {tx('jogos')})</span></span> : '—' })}
          {trophies && line(tx('Troféus'), d => trophies(d) || '—')}
          {line(tx('Semelhança'), (d, s, k) => <span className="cmp-sim">{decks.map((o, j) => j === k ? null : (
            <span key={o.id} title={tx('Sem terrenos: {p}', { p: pct(similarity(data, d, o, false)) })}>{tx('com')} <span className={`cmp-l l${j}`}>{L[j]}</span> <b>{pct(similarity(data, d, o))}</b> <small>{tx('({p} sem terrenos)', { p: pct(similarity(data, d, o, false)) })}</small></span>))}</span>)}
          {line('', d => <span className="row-btns"><button onClick={() => onOpen(d.id)}>{tx('Abrir')}</button><button className={d.fav ? 'on' : ''} onClick={() => onFav(d)} title={tx('Favorito')}>{d.fav ? '★' : '☆'}</button><button onClick={() => onDelete(d)} title={tx('Apagar')}>🗑</button></span>)}
        </tbody></table>
        <Why data={data} decks={decks} st={st} rt={rt} />
        <div className="row-btns small cmp-filt">
          {[['dif', tx('Diferenças')], ['comum', tx('Em comum')], ['todas', tx('Todas')]].map(([k, l]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}
          <label className="chk"><input type="checkbox" checked={lands} onChange={e => setLands(e.target.checked)} /> {tx('incluir terrenos')}</label>
          <span className="muted">{tx('{n} carta|{n} cartas', { n: vis.length })}</span>
        </div>
        <table className="cmp-cards"><thead><tr><th>{tx('Carta')}</th>{decks.map((d, k) => <th key={d.id}><span className={`cmp-l l${k}`}>{L[k]}</span></th>)}</tr></thead><tbody>
          {vis.map(r => (
            <tr key={r.n} className={r.all ? (r.same ? 'c-same' : 'c-qty') : 'c-only'}>
              <td><span className="cmp-card">{r.c && <img src={img(r.c, 'small', false, art[r.n])} alt="" loading="lazy" />}<span>{r.n}</span>{r.c?.mc && <Mana cost={r.c.mc} />}</span></td>
              {r.q.map((x, k) => <td key={k} className={x ? 'has' : 'no'}>{x || '—'}</td>)}
            </tr>
          ))}
        </tbody></table>
      </div>
    </div>
  )
}


