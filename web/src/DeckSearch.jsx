// Procurar decks públicos de jogadores (Archidekt, com filtros) e importá-los com um clique, já com a capa.
// O TappedOut, o Moxfield e afins bloqueiam o servidor (Cloudflare): para esses fica a dica do favorito.
import { useState } from 'react'
import { parseList } from './deck.js'
import { FORMAT, fixFormat } from './formats.js'
import { Mana } from './ui.jsx'
import { importExtras } from './data.js'
const HUE = { W: '#efe3b8', U: '#3f86d6', B: '#7a6585', R: '#d6503a', G: '#3d9a58' }

const FMTS = ['commander', 'modern', 'pauper', 'standard', 'pioneer', 'legacy', 'vintage', 'premodern', 'duel', 'paupercommander', 'predh', 'oathbreaker', 'brawl', 'standardbrawl', 'historic', 'explorer', 'timeless']
const ORDERS = [['vistos', 'Mais vistos'], ['novos', 'Mais recentes'], ['atualizados', 'Atualizados há pouco']]

export default function DeckSearch({ data, say, onDone }) {
  const [f, setF] = useState({ q: '', format: 'pauper', colors: '', card: '', order: 'vistos' })
  const [res, setRes] = useState(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(''), [err, setErr] = useState('')
  const [done, setDone] = useState({})
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const go = async (pg = 1) => {
    setBusy('search'); setErr('')
    try {
      const r = await fetch(`/api/search/decks?${new URLSearchParams({ ...f, page: pg })}`); const j = await r.json()
      if (!r.ok) throw new Error(j.erro)
      setRes(x => (pg > 1 && x ? { ...j, decks: [...x.decks, ...j.decks] } : j)); setPage(pg)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }
  const take = async d => {
    setBusy(d.url)
    try {
      const r = await fetch(`/api/import?url=${encodeURIComponent(d.url)}`); const j = await r.json()
      if (!r.ok) throw new Error(j.erro)
      const p = parseList(j.text, data)
      await fetch('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        name: j.name || d.name, format: fixFormat(data, p, j.format || d.format).format, commanders: p.commanders, main: p.main, side: p.side, maybe: p.maybe,
        seeds: [], ...await importExtras(data, p, j), source: d.url, groups: [], notes: `Importado de ${j.source}: ${d.url}${d.owner ? ` (de ${d.owner})` : ''}`,
        coverImg: j.cover || d.cover || null, count: Object.values(p.main).reduce((a, b) => a + b, 0) + p.commanders.length }) })
      setDone(x => ({ ...x, [d.url]: true })); say?.(`Importado: ${j.name || d.name}`); onDone?.()
    } catch (e) { say?.(`Não consegui importar: ${e.message}`) }
    setBusy('')
  }
  return (
    <div className="dsearch">
      <form className="ds-form" onSubmit={e => { e.preventDefault(); go(1) }}>
        <input value={f.q} onChange={e => set('q', e.target.value)} placeholder="Nome do deck (ex.: sliver, elves, burn)" />
        <select value={f.format} onChange={e => set('format', e.target.value)}><option value="">Todos os formatos</option>{FMTS.map(k => <option key={k} value={k}>{FORMAT[k]?.name || k}</option>)}</select>
        <input value={f.card} onChange={e => set('card', e.target.value)} placeholder="Tem a carta… (nome exato)" />
        <span className="ds-colors" title="Cores que o deck tem de ter">{'WUBRG'.split('').map(c => (
          <button type="button" key={c} className={`pip ${f.colors.includes(c) ? 'on' : ''}`} onClick={() => set('colors', f.colors.includes(c) ? f.colors.replace(c, '') : f.colors + c)}><Mana cost={`{${c}}`} /></button>
        ))}</span>
        <select value={f.order} onChange={e => set('order', e.target.value)}>{ORDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="primary" disabled={busy === 'search'}>{busy === 'search' ? 'A procurar…' : 'Procurar'}</button>
      </form>
      {err && <p className="small bad-t">{err}</p>}
      {res && <p className="muted small">{res.count >= 1000 ? 'Mais de 1000' : res.count} decks no Archidekt{res.decks.length ? `; a mostrar ${res.decks.length}` : ''}.</p>}
      {res && <div className="dgrid">{res.decks.map(d => {
        const edge = d.colors ? d.colors.split('').map(x => HUE[x]) : ['#8a8a99']
        return (
          <div key={d.url} className="dbox" style={{ '--edge': edge.length > 1 ? `linear-gradient(135deg, ${edge.join(', ')})` : edge[0] }}>
            <a className="dbox-art" href={d.url} target="_blank" rel="noreferrer" title="Abrir no Archidekt">
              {d.cover ? <img src={d.cover} alt="" loading="lazy" /> : <span className="dbox-noart">✦</span>}
              {d.format && <span className="dbox-fmt">{FORMAT[d.format]?.name || d.format}</span>}
            </a>
            <div className="dbox-body">
              <b title={d.name}>{d.name}</b>
              <span className="dbox-meta">{d.colors ? <Mana cost={d.colors.split('').map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}
                <span className="muted small">{d.size} cartas · 👁 {d.views ?? 0}{d.bracket ? ` · bracket ${d.bracket}` : ''}</span></span>
              <span className="muted small">de {d.owner || '?'}</span>
              <span className="row-btns"><button className={done[d.url] ? '' : 'primary'} disabled={!!busy || done[d.url]} onClick={() => take(d)}>{done[d.url] ? '✓ Importado' : busy === d.url ? 'A importar…' : 'Importar'}</button></span>
            </div>
          </div>
        )
      })}</div>}
      {res?.next && <button onClick={() => go(page + 1)} disabled={!!busy}>Mostrar mais</button>}
      <details className="small pi-tips"><summary>💡 E o TappedOut, Moxfield e o meta?</summary>
        <ul>
          <li><b>TappedOut</b>: pesquisa no próprio site (tappedout.net/mtg-decks/search/) e, na página de resultados, carrega no favorito «Grimório: levar decks» (em «Importar decks de um perfil»): traz todos os decks da página com as imagens, para escolheres.</li>
          <li><b>Moxfield</b>: o site bloqueia pesquisas do servidor; cola os links dos decks em «Importar decks de um perfil».</li>
          <li><b>Meta de torneios</b>: «Decks do meta», mais abaixo (MTGTop8 e EDHREC), com «Guardar nos meus decks».</li>
        </ul>
      </details>
    </div>
  )
}
