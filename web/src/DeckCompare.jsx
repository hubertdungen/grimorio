// Comparar 2–3 decks: resumo lado a lado e cartas em comum / só num deles, com as quantidades de cada um.
import { useEffect, useMemo, useState } from 'react'
import { stats } from './deck.js'
import { FORMAT } from './formats.js'
import { img } from './data.js'
import { Mana } from './ui.jsx'
import { tx, num } from './i18n.js'

const L = ['A', 'B', 'C']
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

export default function DeckCompare({ data, decks, onClose, onOpen, onFav, onDelete }) {
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
          {line(tx('Semelhança'), (d, s, k) => <span className="cmp-sim">{decks.map((o, j) => j === k ? null : (
            <span key={o.id} title={tx('Sem terrenos: {p}', { p: pct(similarity(data, d, o, false)) })}>{tx('com')} <span className={`cmp-l l${j}`}>{L[j]}</span> <b>{pct(similarity(data, d, o))}</b> <small>{tx('({p} sem terrenos)', { p: pct(similarity(data, d, o, false)) })}</small></span>))}</span>)}
          {line('', d => <span className="row-btns"><button onClick={() => onOpen(d.id)}>{tx('Abrir')}</button><button className={d.fav ? 'on' : ''} onClick={() => onFav(d)} title={tx('Favorito')}>{d.fav ? '★' : '☆'}</button><button onClick={() => onDelete(d)} title={tx('Apagar')}>🗑</button></span>)}
        </tbody></table>
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


