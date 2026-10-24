// Comparar 2–3 decks: resumo lado a lado e cartas em comum / só num deles, com as quantidades de cada um.
import { useEffect, useMemo, useState } from 'react'
import { stats } from './deck.js'
import { FORMAT } from './formats.js'
import { img } from './data.js'
import { Mana } from './ui.jsx'

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
      <div className="modal cmp" role="dialog" aria-label="Comparar decks">
        <div className="row-btns cmp-top"><b>Comparar {decks.length} decks</b><span className="muted small">{common} cartas em comum (sem terrenos: {rows.filter(r => r.all && r.c?.mt !== 'Land').length})</span><button onClick={onClose}>Fechar</button></div>
        <table className="cmp-sum"><tbody>
          <tr><th />{decks.map((d, k) => <td key={d.id}><span className={`cmp-l l${k}`}>{L[k]}</span> <b>{d.name}</b></td>)}</tr>
          {line('Formato', d => FORMAT[d.format]?.name || d.format)}
          {line('Cores', d => { const c = colorsOf(data, d); return c.length ? <Mana cost={c.map(x => `{${x}}`).join('')} /> : '—' })}
          {line('Cartas', d => d.count)}
          {line('Terrenos', (d, s) => s.lands)}
          {line('Criaturas', (d, s) => s.types.Creature || 0)}
          {line('Custo médio', (d, s) => s.avgMv.toFixed(2).replace('.', ','))}
          {line('Curva', (d, s) => <span className="cmp-curve">{s.curve.map((v, i) => <i key={i} style={{ height: `${Math.min(100, v * 6)}%` }} title={`${i}${i === 7 ? '+' : ''}: ${v}`} />)}</span>)}
          {line('Preço', (d, s) => (s.price ? `${s.price.toFixed(0)} €` : '—'))}
          {line('Semelhança', (d, s, k) => <span className="cmp-sim">{decks.map((o, j) => j === k ? null : (
            <span key={o.id} title={`Sem terrenos: ${pct(similarity(data, d, o, false))}`}>com <span className={`cmp-l l${j}`}>{L[j]}</span> <b>{pct(similarity(data, d, o))}</b> <small>({pct(similarity(data, d, o, false))} sem terrenos)</small></span>))}</span>)}
          {line('', d => <span className="row-btns"><button onClick={() => onOpen(d.id)}>Abrir</button><button className={d.fav ? 'on' : ''} onClick={() => onFav(d)} title="Favorito">{d.fav ? '★' : '☆'}</button><button onClick={() => onDelete(d)} title="Apagar">🗑</button></span>)}
        </tbody></table>
        <div className="row-btns small cmp-filt">
          {[['dif', 'Diferenças'], ['comum', 'Em comum'], ['todas', 'Todas']].map(([k, l]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}
          <label className="chk"><input type="checkbox" checked={lands} onChange={e => setLands(e.target.checked)} /> incluir terrenos</label>
          <span className="muted">{vis.length} cartas</span>
        </div>
        <table className="cmp-cards"><thead><tr><th>Carta</th>{decks.map((d, k) => <th key={d.id}><span className={`cmp-l l${k}`}>{L[k]}</span></th>)}</tr></thead><tbody>
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

// Confirmação antes de apagar (o deck vai para o lixo da Biblioteca durante 30 dias)
export function ConfirmDelete({ deck, onYes, onNo }) {
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onNo() }}>
      <div className="modal confirm" role="alertdialog" aria-label="Confirmar apagar">
        <h3>Apagar «{deck.name}»?</h3>
        <p className="muted">Vai para o lixo da Biblioteca e fica lá 30 dias; podes restaurá-lo até lá.</p>
        <div className="row-btns"><button onClick={onNo} autoFocus>Cancelar</button><button className="danger" onClick={onYes}>🗑 Apagar</button></div>
      </div>
    </div>
  )
}
