// Escolher a arte dos terrenos básicos (Plains…Wastes): uma edição para cada um, com filtro de estilo e «a mesma edição
// nos outros». Serve as Definições (arte por omissão) e a Biblioteca (vários decks de uma vez).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BASICS, fetchPrints, img } from './data.js'
import { tx } from './i18n.js'

const MANA = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' }
const keep = p => p && { id: p.id, set: p.set, cn: p.cn, eur: p.eur, eurFoil: p.eurFoil, style: p.style, foil: false }

export function BasicArtPicker({ title, value = {}, only = BASICS, applyLabel, onApply, onClose }) {
  const [sel, setSel] = useState(() => ({ ...value }))
  const [tab, setTab] = useState(only.includes('Island') ? 'Island' : only[0])
  const [prints, setPrints] = useState({}), [style, setStyle] = useState(''), [busy, setBusy] = useState(false)
  const load = n => (prints[n] ? Promise.resolve(prints[n]) : fetchPrints(n).then(l => { setPrints(o => ({ ...o, [n]: l })); return l }))
  useEffect(() => { load(tab).catch(() => setPrints(o => ({ ...o, [tab]: [] }))) }, [tab])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  const list = prints[tab], styles = list ? [...new Set(list.flatMap(p => p.style))].filter(x => x.length > 2) : []
  const shown = list && style ? list.filter(p => p.style.includes(style)) : list
  const same = async () => {  // a edição escolhida aqui nos outros básicos (o número de coleção mais perto; o mesmo estilo se houver)
    const ref = sel[tab]; if (!ref) return
    setBusy(true)
    const out = { ...sel }
    for (const n of only.filter(x => x !== tab)) {
      const l = await load(n).catch(() => [])
      const cand = l.filter(p => p.set === ref.set)
      const best = cand.sort((a, b) => (b.style.join() === ref.style.join()) - (a.style.join() === ref.style.join()) || Math.abs(parseInt(a.cn) - parseInt(ref.cn)) - Math.abs(parseInt(b.cn) - parseInt(ref.cn)))[0]
      if (best) out[n] = keep(best)
    }
    setSel(out); setBusy(false)
  }
  return createPortal(
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal basics-pick" role="dialog" aria-label={title}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>{title}</h3>
        <div className="bp-tabs">{only.map(n => (
          <button key={n} className={tab === n ? 'on' : ''} onClick={() => { setTab(n); setStyle('') }}>
            <span className="bp-cur">{sel[n] ? <img src={img({ id: sel[n].id }, 'art_crop', false, sel[n].id)} alt="" /> : <i>{tx('padrão')}</i>}</span>
            <b><img className="bp-mana" src={`https://svgs.scryfall.io/card-symbols/${MANA[n]}.svg`} alt="" /> {n}</b>
          </button>
        ))}</div>
        <div className="row-btns">
          <select value={style} onChange={e => setStyle(e.target.value)} aria-label={tx('Estilo')}>
            <option value="">{list ? tx('Todas ({n})', { n: list.length }) : '…'}</option>
            {styles.map(x => <option key={x} value={x}>{x} ({list.filter(p => p.style.includes(x)).length})</option>)}
          </select>
          {only.length > 1 && <button disabled={!sel[tab] || busy} onClick={same} title={tx('Procura a mesma edição para os outros básicos')}>{busy ? tx('A procurar…') : tx('A mesma edição nos outros')}</button>}
          {sel[tab] && <button className="link small" onClick={() => setSel(o => { const n = { ...o }; delete n[tab]; return n })}>{tx('voltar à predefinida')}</button>}
        </div>
        <div className="bp-grid">
          {!list ? <p className="muted small">{tx('A procurar edições e estilos…')}</p> : !shown.length ? <p className="muted small">{tx('Não consegui falar com a Scryfall para ver as edições.')}</p>
            : shown.map(p => (
              <button key={p.id} className={sel[tab]?.id === p.id ? 'on' : ''} onClick={() => setSel(o => ({ ...o, [tab]: keep(p) }))} title={`${p.setName} #${p.cn} · ${p.artist || ''}`}>
                <img src={img({ id: p.id }, 'small', false, p.id)} alt={p.setName} loading="lazy" /><small><b>{p.set}</b> {p.y}</small>
              </button>
            ))}
        </div>
        <div className="row-btns bp-go">
          <button className="primary" onClick={() => onApply(sel)}>{applyLabel}</button>
          <button onClick={onClose}>{tx('Cancelar')}</button>
          <span className="muted small">{tx('{n} de {t} escolhidos', { n: only.filter(n => sel[n]).length, t: only.length })}</span>
        </div>
      </div>
    </div>, document.body)
}

// Aplica a arte escolhida aos básicos que cada deck tem (map = {Island: print, …}); map = null tira as escolhas
// (edição, imagem própria e divisão por cópias) e os básicos voltam à arte por omissão. Devolve quantos decks mudaram.
export async function applyBasics(ids, map) {
  let n = 0
  for (const id of ids) {
    const d = await (await fetch(`/api/decks/${id}`)).json()
    const have = BASICS.filter(b => d.main?.[b] || d.side?.[b])
    const prints = { ...(d.prints || {}) }, art = { ...(d.art || {}) }, split = { ...(d.split || {}) }
    let changed = false
    for (const b of have) {  // só grava o deck se alguma coisa muda mesmo (senão a «última alteração» mudava à toa)
      if (map && !map[b]) continue
      if (map ? prints[b]?.id === map[b].id && !art[b] && !split[b] : !prints[b] && !art[b] && !split[b]) continue
      if (map) prints[b] = map[b]; else delete prints[b]
      delete art[b]; delete split[b]; changed = true
    }
    if (!changed) continue
    const r = await fetch(`/api/decks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, prints, art, split }) })
    if (r.ok) n++
  }
  return n
}

// Definições › Terrenos básicos: arte por omissão (este browser) e repor tudo
export function BasicSettings({ getDefaults, setDefaults, ask }) {
  const [cur, setCur] = useState(getDefaults), [open, setOpen] = useState(false), [busy, setBusy] = useState(''), [msg, setMsg] = useState('')
  const resetAll = async () => {
    if (!(await ask('basicos', { title: tx('Tirar as artes escolhidas dos terrenos básicos em todos os decks?'), body: tx('Os básicos voltam à arte por omissão. As outras cartas ficam como estão.'), ok: tx('Repor todos') }))) return
    setBusy(tx('A repor…'))
    const decks = await (await fetch('/api/decks')).json()
    const n = await applyBasics(decks.map(d => d.id), null)
    setBusy(''); setMsg(tx('{n} deck reposto|{n} decks repostos', { n }))
  }
  return (
    <div className="bs-set">
      <div className="bs-cur">{BASICS.map(n => <span key={n} title={n}>{cur[n] ? <img src={img({ id: cur[n].id }, 'art_crop', false, cur[n].id)} alt={n} /> : <i>{n}</i>}</span>)}</div>
      <p className="muted small">{tx('Vale em todos os decks onde não escolheste outra arte para o básico (neste browser).')}</p>
      <div className="row-btns">
        <button onClick={() => setOpen(true)}>⛰ {tx('Escolher as artes')}</button>
        {Object.keys(cur).length > 0 && <button className="link small" onClick={() => { setDefaults({}); setCur({}) }}>{tx('voltar às da Scryfall')}</button>}
        <button className="link small" disabled={!!busy} onClick={resetAll}>↺ {busy || tx('repor os básicos de todos os decks')}</button>
      </div>
      {msg && <p className="small ok-t">{msg}</p>}
      {open && <BasicArtPicker title={tx('Arte por omissão dos terrenos básicos')} value={cur} applyLabel={tx('Guardar')} onClose={() => setOpen(false)}
        onApply={v => { setDefaults(v); setCur(v); setOpen(false) }} />}
    </div>
  )
}
