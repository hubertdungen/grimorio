// Tokens (Para jogar à mesa): as fichas verdadeiras no telemóvel ou no tablet ao lado das cartas a sério. As que o deck cria
// (índice de fichas da Scryfall, build/tokens.py), a pesquisa de qualquer ficha, emblema ou masmorra, e «na mesa»: quantas,
// viradas, marcadores; tocar mostra-a em grande (ecrã ligado) para o outro lado da mesa. Fica guardado neste aparelho.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Face } from './Board.jsx'
import { deckTokens, searchTokens, tokenById, tokTable, onTokens, tokensVer } from './tokens.js'
import { CT, CT_ICON } from './game.js'
import { useBackClose } from './backnav.js'
import { holdScreen } from './wakelock.js'
import { tx } from './i18n.js'

const K = 'grimorio.fichas', S0 = { deck: '', q: 1, table: [] }
const load = () => { try { return { ...S0, ...JSON.parse(localStorage.getItem(K) || '{}') } } catch { return S0 } }
const MORE = ['-1/-1', 'loyalty', 'charge', 'shield', 'stun', 'oil', 'time', 'lore', 'level']
const pOf = (c, k) => ({ key: k || c.id, name: c.n, token: true, pt: c.pt, col: c.co })
const short = n => String(n || '').split(' // ')[0]
const ctrTxt = (k, v) => (k === '+1/+1' ? `+${v}/+${v}` : k === '-1/-1' ? `−${v}/−${v}` : `${CT_ICON[k] || '◆'} ${v}`)
// o P/R com os marcadores +1/+1 e −1/−1 (o resto fica nos chips)
const ptOf = (c, ctr) => {
  const m = /^(\d+)\/(\d+)$/.exec(c?.pt || ''), d = (ctr?.['+1/+1'] || 0) - (ctr?.['-1/-1'] || 0)
  return m && d ? `${+m[1] + d}/${+m[2] + d}` : null
}

function Pick({ c, from, onAdd }) {  // uma ficha para juntar à mesa (do deck ou da pesquisa)
  return (
    <button type="button" className="tk-pick" onClick={() => onAdd(c)} title={from?.length ? tx('de {c}', { c: from.map(short).join(', ') }) : c.t}>
      <span className="tk-img"><Face p={pOf(c)} c={c} /></span>
      <b>{short(c.n)}</b><small>{[c.pt, c.t.replace(/^Token /, '').split(' — ')[0]].filter(Boolean).join(' · ')}</small>
      <i aria-hidden="true">＋</i>
    </button>
  )
}

function Big({ x, c, onClose }) {  // em grande, para mostrar do outro lado da mesa: o ecrã não apaga
  useBackClose(true, onClose)
  useEffect(() => holdScreen(), [])
  const pt = ptOf(c, x.ctr)
  return (
    <div className="tk-big" onClick={onClose} role="dialog" aria-label={short(c.n)}>
      <div className="tk-big-c"><Face p={pOf(c, x.k)} c={c} size="large" /></div>
      <div className="tk-big-i">
        {x.q > 1 && <b>×{x.q}</b>}
        {x.tp > 0 && <b>↻ {x.q > 1 ? tx('{n} virada|{n} viradas', { n: x.tp }) : tx('virada')}</b>}
        {pt && <b className="pt">{pt}</b>}
        {Object.entries(x.ctr || {}).filter(([k]) => k !== '+1/+1' && k !== '-1/-1').map(([k, v]) => <b key={k}>{ctrTxt(k, v)} {CT[k] || k}</b>)}
      </div>
      <small className="muted">{tx('toca para fechar')}</small>
    </div>
  )
}

function OnTable({ x, c, act, onBig }) {
  const [more, setMore] = useState(false), all = x.tp >= x.q, pt = ptOf(c, x.ctr)
  return (
    <div className={`tk-t ${all ? 'tapped' : ''}`}>
      <button type="button" className="tk-img" onClick={onBig} aria-label={tx('Ver {c} em grande', { c: short(c.n) })}><Face p={pOf(c, x.k)} c={c} size="normal" />
        {x.q > 1 && <b className="tk-q">×{x.q}</b>}
        {(pt || Object.keys(x.ctr || {}).length > 0) && <span className="tk-ctr">{pt && <b className="pt">{pt}</b>}{Object.entries(x.ctr).filter(([k]) => k !== '+1/+1' && k !== '-1/-1').map(([k, v]) => <b key={k}>{ctrTxt(k, v)}</b>)}</span>}
      </button>
      <div className="tk-row">
        <button type="button" className={`tk-tap ${x.tp ? 'on' : ''}`} onClick={() => act({ k: x.k, tap: 1 })} title={all ? tx('Desvirar') : tx('Virar mais uma')}>{all ? '↺' : '↻'}{x.q > 1 && <small>{x.tp}/{x.q}</small>}</button>
        <span className="tk-n"><button type="button" onClick={() => act({ k: x.k, dq: -1 })} aria-label={tx('Menos uma')}>−</button><b>{x.q}</b><button type="button" onClick={() => act({ k: x.k, dq: 1 })} aria-label={tx('Mais uma')}>＋</button></span>
        <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more} title={tx('Marcadores')}>◆</button>
      </div>
      <button type="button" className="tk-del" onClick={() => act({ k: x.k, del: 1 })} aria-label={tx('Tirar da mesa')} title={tx('Tirar da mesa')}>✕</button>
      {more && <div className="tk-more">{['+1/+1', ...MORE].map(k => (
        <span key={k} className={`tk-n ${CT_ICON[k] ? '' : 'wide'}`}><button type="button" onClick={() => act({ k: x.k, ctr: k, d: -1 })} aria-label={tx('Tirar um marcador {ct}', { ct: CT[k] || k })}>−</button>
          <small title={CT[k] || k}>{CT_ICON[k] || CT[k] || k} <b>{x.ctr?.[k] || 0}</b></small>
          <button type="button" onClick={() => act({ k: x.k, ctr: k, d: 1 })} aria-label={tx('Pôr um marcador {ct}', { ct: CT[k] || k })}>＋</button></span>))}</div>}
    </div>
  )
}

export default function Tokens({ deck, decks }) {
  useSyncExternalStore(onTokens, tokensVer)  // o índice chega depois do primeiro desenho
  const [st, setSt] = useState(load), [q, setQ] = useState(''), [big, setBig] = useState(null)
  useEffect(() => { try { localStorage.setItem(K, JSON.stringify(st)) } catch { /* sem armazenamento */ } }, [st])
  const act = op => setSt(s => ({ ...s, table: tokTable(s.table, op) }))
  const add = c => act({ add: c.id, q: st.q })
  // o deck: o aberto ou um da Biblioteca (lido do servidor)
  const open = deck && (deck.commanders?.length || Object.keys(deck.main || {}).length) ? deck : null
  const [other, setOther] = useState(null), [err, setErr] = useState('')
  const want = st.deck && st.deck !== open?.id ? st.deck : ''
  useEffect(() => {
    if (!want) return
    let on = true
    setErr('')
    fetch(`/api/decks/${want}`).then(r => (r.ok ? r.json() : Promise.reject(new Error()))).then(d => on && setOther(d)).catch(() => on && setErr(tx('Não consegui ler os teus decks.')))
    return () => { on = false }
  }, [want])
  const cur = want ? (other?.id === want ? other : null) : open
  const names = cur ? [...cur.commanders || [], ...Object.keys(cur.main || {}), ...Object.keys(cur.side || {})] : []
  const fromDeck = useMemo(() => deckTokens(names), [names.join('|'), tokensVer()])  // eslint-disable-line react-hooks/exhaustive-deps
  const found = useMemo(() => searchTokens(q), [q, tokensVer()])  // eslint-disable-line react-hooks/exhaustive-deps
  const rows = st.table.map(x => [x, tokenById(x.id)]).filter(r => r[1])
  const bigRow = rows.find(r => r[0].k === big)
  const loading = !tokensVer()  // o índice de fichas ainda não chegou
  return (
    <div className="tk">
      <section className="tk-mesa">
        <header><h2>{tx('Na mesa')}</h2>
          {rows.length > 0 && <span className="tk-bar"><button type="button" onClick={() => act({ untap: 1 })}>↺ {tx('Desvirar tudo')}</button><button type="button" className="link small" onClick={() => act({ clear: 1 })}>{tx('Limpar a mesa')}</button></span>}</header>
        {rows.length ? <div className="tk-grid">{rows.map(([x, c]) => <OnTable key={x.k} x={x} c={c} act={act} onBig={() => setBig(x.k)} />)}</div>
          : <p className="muted small">{loading ? tx('A carregar…') : tx('Junta fichas do deck ou da pesquisa: aparecem aqui, com quantas são, viradas e marcadores. Toca numa para a mostrar em grande.')}</p>}
      </section>
      <section className="tk-add">
        <div className="tk-q-row"><label className="small">{tx('Juntar')} <select value={st.q} onChange={e => setSt(s => ({ ...s, q: +e.target.value }))} aria-label={tx('Quantas fichas juntar')}>{[1, 2, 3, 4, 5, 6, 8, 10, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}</select> {tx('de cada vez')}</label></div>
        <h3>{tx('As do deck')}</h3>
        <select className="tk-deck" value={want || (open ? '' : st.deck)} onChange={e => setSt(s => ({ ...s, deck: e.target.value }))} aria-label={tx('Deck')}>
          {open ? <option value="">{tx('Deck aberto: {name}', { name: open.name || tx('sem nome') })}</option> : <option value="">{tx('Escolhe um deck…')}</option>}
          {(decks || []).filter(d => d.id && d.id !== open?.id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {err && <p className="small bad-t">{err}</p>}
        {cur ? (fromDeck.length ? <div className="tk-picks">{fromDeck.map(({ c, from }) => <Pick key={c.id} c={c} from={from} onAdd={add} />)}</div>
          : <p className="muted small">{tx('Nenhuma carta do deck cria tokens.')}</p>) : want ? <p className="muted small">{tx('A carregar…')}</p> : null}
        <h3>{tx('Procurar')}</h3>
        <input type="search" className="tk-search" placeholder={tx('Nome, tipo ou P/R: Treasure, Zombie, 2/2, emblema, masmorra…')} value={q} onChange={e => setQ(e.target.value)} aria-label={tx('Procurar fichas')} />
        {q.trim() && (found.length ? <div className="tk-picks">{found.map(c => <Pick key={c.id} c={c} onAdd={add} />)}</div> : <p className="muted small">{tx('Nenhuma ficha com isso.')}</p>)}
      </section>
      {bigRow && <Big x={bigRow[0]} c={bigRow[1]} onClose={() => setBig(null)} />}
    </div>
  )
}
