// Biblioteca: os meus decks (abrir, duplicar, testar), o lixo (restaurar) e decks do meta para guardar como meus.
import { useEffect, useMemo, useState } from 'react'
import { FORMATS, FORMAT } from './formats.js'
import { Empty, Mana, Stars } from './ui.jsx'
import { img, HUE, coverOf, colorsOf } from './data.js'
import ProfileImport from './ProfileImport.jsx'
import DeckSearch from './DeckSearch.jsx'
import DeckCompare, { ConfirmDelete, similarity } from './DeckCompare.jsx'

const META_FMTS = ['commander', 'duel', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern']
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch { return null } }

// rating: o normal em destaque e o casual pequeno («casual ★3,4»); um deck casual só tem o casual
function DeckRating({ d, rt, rtc }) {
  if (d.casual) return <span className="dbox-rt"><i className="badge cas" title="Deck casual: pode violar as regras do formato e só joga em modo casual (Laboratório, torneios e Arena casuais)">casual</i><Stars r={rtc} label="Rating casual: " /></span>
  return <span className="dbox-rt"><Stars r={rt} />{rtc && <small className="cas-st" title={`Rating casual (jogos em modo casual, com decks de todos os formatos): ${rtc.stars.toFixed(1).replace('.', ',')} de 6 estrelas · ${rtc.games} jogos${rtc.prov ? ' · provisório' : ''}`}>casual ★{rtc.stars.toFixed(1).replace('.', ',')}</small>}</span>
}

function DeckBox({ d, data, openDeck, goTab, duplicate, setCover, setImg, rt, rtc, selected, onSelect, onFav, onDelete }) {
  const [link, setLink] = useState('')
  const [pick, setPick] = useState(false)
  const c = coverOf(d, data), cols = colorsOf(d, data)
  const edge = cols.length ? cols.map(x => HUE[x]) : ['#8a8a99']
  const bg = edge.length > 1 ? `linear-gradient(135deg, ${edge.join(', ')})` : edge[0]
  const open = t => openDeck(d.id).then(() => goTab(t))
  const opts = Object.keys(d.main || {}).map(n => data.byName.get(n)).filter(x => x && x.mt !== 'Land')
  // artes próprias do deck (TappedOut): só no deck completo, lidas ao abrir a escolha da capa
  const [art, setArt] = useState(null)
  useEffect(() => { if (pick && !art) fetch(`/api/decks/${d.id}`).then(r => r.json()).then(x => setArt(x.art || {})).catch(() => setArt({})) }, [pick, art, d.id])
  return (
    <div className={`dbox ${selected ? 'sel' : ''}`} style={{ '--edge': bg }}>
      <label className="dbox-check" title="Selecionar para comparar"><input type="checkbox" checked={!!selected} onChange={() => onSelect(d.id)} /></label>
      <button className={`dbox-fav ${d.fav ? 'on' : ''}`} onClick={() => onFav(d)} title={d.fav ? 'Tirar dos favoritos' : 'Pôr nos favoritos'}>{d.fav ? '★' : '☆'}</button>
      <button className="dbox-art" onClick={() => open('deck')} title={d.coverImg ? 'Capa: imagem própria' : c ? `Capa: ${c.n}` : d.name}>
        {d.coverImg ? <img src={d.coverImg} alt="" loading="lazy" /> : c ? <img src={img(c, 'art_crop')} alt={c.n} loading="lazy" /> : <span className="dbox-noart">✦</span>}
        <span className="dbox-fmt">{FORMAT[d.format]?.name || d.format}</span>
      </button>
      <div className="dbox-body">
        <b title={d.name}>{d.name}</b>
        <span className="dbox-meta">{cols.length ? <Mana cost={cols.map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}<span className="muted small">{d.count} cartas · {when(d.updated)}</span><DeckRating d={d} rt={rt} rtc={rtc} /></span>
        <span className="row-btns">
          <button onClick={() => open('deck')}>Abrir</button>
          <button onClick={() => open('teste')} title="Testar no Forge">⚔</button>
          <button onClick={() => duplicate(d.id)} title="Duplicar">⧉</button>
          <button className={pick ? 'on' : ''} onClick={() => setPick(x => !x)} title="Escolher a capa: carta do deck, link ou imagem tua">🖼</button>
          <button onClick={() => onDelete(d)} title="Apagar (vai para o lixo)">🗑</button>
        </span>
        {pick && <div className="dbox-own">
          <form onSubmit={e => { e.preventDefault(); if (link.trim()) { setImg(d.id, { url: link.trim() }); setLink(''); setPick(false) } }}>
            <input value={link} onChange={e => setLink(e.target.value)} placeholder="Link de uma imagem (https://…)" inputMode="url" /><button disabled={!link.trim()}>Usar</button>
          </form>
          <label className="dbox-up">⬆ Carregar imagem<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { const f = e.target.files?.[0]; if (f) { setImg(d.id, { file: f }); setPick(false) } }} /></label>
          {d.coverImg && <button className="link small" onClick={() => { setImg(d.id, { url: null }); setPick(false) }}>tirar a imagem (volta à carta)</button>}
          <small className="muted">ou escolhe uma carta do deck:</small>
        </div>}
        {pick && <div className="dbox-pick">{opts.map(o => (
          <button key={o.n} className={(art?.[o.n] ? d.coverImg === art[o.n] : !d.coverImg && o.n === c?.n) ? 'on' : ''} onClick={() => { if (art?.[o.n]) setImg(d.id, { url: art[o.n] }); else setCover(d.id, o.n); setPick(false) }} title={art?.[o.n] ? `${o.n} (arte própria)` : o.n}><img src={img(o, 'small', false, art?.[o.n])} alt={o.n} loading="lazy" /></button>
        ))}</div>}
      </div>
    </div>
  )
}

const when = t => new Date(t * 1000).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })

export default function Library({ data, openDeck, goTab, say, importLinks = '' }) {
  const [mine, setMine] = useState([])
  const [trash, setTrash] = useState([])
  const [me, setMe] = useState('')
  const [mf, setMf] = useState('modern')
  const [meta, setMeta] = useState([])
  const [busy, setBusy] = useState('')
  const [rt, setRt] = useState({})  // estrelas dos ratings
  const [view, setView] = useState(() => ls('grimorio.lib.view') || 'grelha')
  const [sel, setSel] = useState([]), [cmp, setCmp] = useState(false), [del, setDel] = useState(null)
  const toggleSel = id => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= 3 ? [...s.slice(1), id] : [...s, id]))
  const toggleFav = async d => {
    const full = await (await fetch(`/api/decks/${d.id}`)).json()
    await fetch(`/api/decks/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...full, fav: !d.fav }) })
    setMine(m => m.map(x => (x.id === d.id ? { ...x, fav: !d.fav } : x)))
  }
  const remove = async d => {
    await fetch(`/api/decks/${d.id}`, { method: 'DELETE' }); setDel(null); setSel(s => s.filter(x => x !== d.id))
    say(`«${d.name}» foi para o lixo (30 dias).`); reload()
  }
  // formatos fechados (▸) e filtro «só este formato»; lembrados neste browser
  const [closed, setClosed] = useState(() => { try { return JSON.parse(ls('grimorio.lib.fechados') || '{}') } catch { return {} } })
  const [only, setOnly] = useState(() => ls('grimorio.lib.so') || '')
  useEffect(() => { ls('grimorio.lib.fechados', JSON.stringify(closed)) }, [closed])
  useEffect(() => { ls('grimorio.lib.so', only) }, [only])
  useEffect(() => { ls('grimorio.lib.view', view) }, [view])
  const reload = () => {
    fetch('/api/decks').then(r => r.json()).then(setMine).catch(() => {})
    fetch('/api/decks/trash').then(r => r.json()).then(setTrash).catch(() => {})
  }
  useEffect(() => { reload(); fetch('/api/ratings/stars').then(r => r.json()).then(setRt).catch(() => {}); fetch('/api/me').then(r => r.json()).then(j => setMe(j.user)).catch(() => {}) }, [])
  useEffect(() => { setMeta([]); fetch(`/api/sim/opponents?format=${mf}`).then(r => r.json()).then(setMeta).catch(() => setMeta([])) }, [mf])

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(r => r.json())
  const duplicate = async id => { const d = await (await fetch(`/api/decks/${id}`)).json(); const n = await post('/api/decks', { ...d, id: undefined, name: `${d.name} (cópia)` }); say(`Duplicado: ${n.name}`); reload() }
  const setCover = async (id, name) => {
    const d = await (await fetch(`/api/decks/${id}`)).json()
    await fetch(`/api/decks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, cover: name, coverImg: null }) }); setMine(m => m.map(x => (x.id === id ? { ...x, cover: name, coverImg: null } : x)))
  }
  // capa própria: {url} (link https ou null para tirar) ou {file} (imagem carregada, até 6 MB)
  const setImg = async (id, { url, file }) => {
    if (file && file.size > 6e6) return say('A imagem tem de ter até 6 MB.')
    const r = await fetch(`/api/decks/${id}/cover`, file ? { method: 'POST', headers: { 'Content-Type': file.type }, body: file }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
    const j = await r.json()
    if (!r.ok) return say(j.erro || 'Não consegui guardar a imagem.')
    setMine(m => m.map(x => (x.id === id ? { ...x, coverImg: j.coverImg } : x))); say(j.coverImg ? 'Capa atualizada.' : 'Capa: volta à carta.')
  }
  const restore = async id => { await post(`/api/decks/${id}/restore`); say('Deck restaurado.'); reload() }
  const saveMeta = async o => {
    setBusy(o.id)
    const d = await (await fetch(`/api/sim/opponents/${encodeURIComponent(o.id)}`)).json()
    const n = await post('/api/decks', { name: `${d.name} (${o.source})`, format: mf === 'duel' ? 'duel' : mf, commanders: d.commanders || [], main: d.main, side: d.side || {}, seeds: [], notes: d.url ? `Origem: ${d.url}` : '', count: Object.values(d.main).reduce((a, b) => a + b, 0) + (d.commanders || []).length })
    setBusy(''); say(`Guardado nos teus decks: ${n.name}`); reload()
  }
  const byFmt = {}
  for (const d of mine) (byFmt[d.format] ||= []).push(d)
  // decks repetidos ou muito parecidos (≥80% da lista igual, mesmo com nomes e capas diferentes): grupos ligados
  const dupes = useMemo(() => {
    const ds = mine.filter(d => Object.keys(d.main || {}).length), up = ds.map((_, i) => i), sim = {}
    const root = i => (up[i] === i ? i : (up[i] = root(up[i])))
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const x = similarity(data, ds[i], ds[j])
      if (x >= 0.8) { up[root(i)] = root(j); sim[`${ds[i].id}|${ds[j].id}`] = x }
    }
    const g = {}
    ds.forEach((d, i) => (g[root(i)] ||= []).push(d))
    return Object.values(g).filter(x => x.length > 1).map(x => ({ decks: x, top: Math.max(...x.flatMap((a, i) => x.slice(i + 1).map(b => sim[`${a.id}|${b.id}`] || sim[`${b.id}|${a.id}`] || 0))) }))
      .sort((a, b) => b.top - a.top)
  }, [mine, data])
  const favs = mine.filter(d => d.fav)
  const fmts = [...(favs.length ? [['★', favs]] : []), ...Object.entries(byFmt).sort((a, b) => b[1].length - a[1].length)]
  const fname = f => (f === '★' ? '★ Favoritos' : FORMAT[f]?.name || f)
  return (
    <div className="view library">
      <section className="card">
        <h3>Os meus decks <span className="muted small">{mine.length}{me ? ` · ${me}` : ''}</span>
          <span className="seg small">{[['grelha', '▦ Grelha'], ['lista', '☰ Lista']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</span></h3>
        {!mine.length && <Empty>Ainda não tens decks guardados. Usa «✦ Novo deck» ou guarda um do meta abaixo.</Empty>}
        {sel.length > 0 && <div className="cmp-bar">
          <b>{sel.length} {sel.length === 1 ? 'deck selecionado' : 'decks selecionados'}</b><span className="muted small">escolhe 2 ou 3 para comparar</span>
          <button className="primary" disabled={sel.length < 2} onClick={() => setCmp(true)}>⇄ Comparar</button><button className="link small" onClick={() => setSel([])}>limpar</button>
        </div>}
        {cmp && <DeckCompare data={data} decks={sel.map(id => mine.find(d => d.id === id)).filter(Boolean)} onClose={() => setCmp(false)}
          onOpen={id => { setCmp(false); openDeck(id).then(() => goTab('deck')) }} onFav={toggleFav} onDelete={setDel} />}
        {del && <ConfirmDelete deck={del} onYes={() => remove(del)} onNo={() => setDel(null)} />}
        {fmts.length > 1 && <div className="fmt-chips">
          <button className={!only ? 'on' : ''} onClick={() => setOnly('')}>Todos <i>{mine.length}</i></button>
          {fmts.map(([f, ds]) => <button key={f} className={only === f ? 'on' : ''} onClick={() => { setOnly(only === f ? '' : f); setClosed(c => { const n = { ...c }; delete n[f]; return n }) }}>{fname(f)} <i>{ds.length}</i></button>)}
          <span className="fmt-all"><button className="link small" onClick={() => setClosed({})}>abrir todos</button><button className="link small" onClick={() => setClosed(Object.fromEntries(fmts.map(([f]) => [f, 1])))}>fechar todos</button></span>
        </div>}
        {fmts.filter(([f]) => !only || f === only).map(([f, ds]) => (
          <div key={f} className={`fmt-sec ${closed[f] ? 'shut' : ''}`}>
            <button className="fmt-head" onClick={() => setClosed(c => { const n = { ...c }; if (n[f]) delete n[f]; else n[f] = 1; return n })} aria-expanded={!closed[f]}>
              <i className="chev">▾</i><b>{fname(f)}</b><span className="muted">{ds.length} {ds.length === 1 ? 'deck' : 'decks'}</span><span className="fmt-line" />
            </button>
            {view === 'grelha' ? <div className="dgrid">{ds.map(d => <DeckBox key={d.id} d={d} data={data} openDeck={openDeck} goTab={goTab} duplicate={duplicate} setCover={setCover} setImg={setImg} rt={rt[`deck:${d.id}`]} rtc={rt[`deck:${d.id}|casual`]} selected={sel.includes(d.id)} onSelect={toggleSel} onFav={toggleFav} onDelete={setDel} />)}</div> : <ul className="lib-list">{ds.map(d => (
              <li key={d.id}>
                <button className="link plain" onClick={() => openDeck(d.id).then(() => goTab('deck'))}><b>{d.name}</b></button>
                <span className="muted small">{d.count} cartas · {when(d.updated)}</span>
                <DeckRating d={d} rt={rt[`deck:${d.id}`]} rtc={rt[`deck:${d.id}|casual`]} />
                <span className="row-btns">
                  <button onClick={() => openDeck(d.id).then(() => goTab('deck'))}>Abrir</button>
                  <button onClick={() => openDeck(d.id).then(() => goTab('teste'))}>Testar no Forge</button>
                  <button onClick={() => duplicate(d.id)}>Duplicar</button>
                </span>
              </li>
            ))}</ul>}
          </div>
        ))}
      </section>

      {dupes.length > 0 && <section className="card dupes">
        <h3>Decks repetidos ou muito parecidos <span className="muted small">{dupes.length} {dupes.length === 1 ? 'grupo' : 'grupos'} · mesmo com nomes e capas diferentes</span></h3>
        {dupes.map((g, k) => (
          <div key={k} className="dupe-g">
            <span className={`chip ${g.top >= 0.999 ? 'bad' : ''}`}>{g.top >= 0.999 ? 'iguais' : `${Math.round(g.top * 100)}% iguais`}</span>
            {g.decks.map(d => <span key={d.id} className="dupe-d"><b>{d.name}</b><small className="muted">{FORMAT[d.format]?.name || d.format} · {when(d.updated)}</small>
              <button onClick={() => setDel(d)} title="Apagar este (vai para o lixo)">🗑</button></span>)}
            <button className="primary" onClick={() => { setSel(g.decks.slice(0, 3).map(d => d.id)); setCmp(true) }}>⇄ Comparar</button>
          </div>
        ))}
      </section>}

      <section className="card">
        <h3>Procurar decks públicos <span className="muted small">decks de jogadores no Archidekt, com filtros</span></h3>
        <DeckSearch data={data} say={say} onDone={reload} />
      </section>

      <section className="card">
        <h3>Importar decks de um perfil <span className="muted small">escolhe quais entram</span></h3>
        <ProfileImport data={data} initial={importLinks} say={say} onDone={reload} />
      </section>

      <section className="card">
        <h3>Decks do meta <span className="muted small">listas reais recentes (MTGTop8; EDHREC para Commander)</span></h3>
        <select value={mf} onChange={e => setMf(e.target.value)}>{META_FMTS.map(f => <option key={f} value={f}>{FORMAT[f]?.name || FORMATS.find(x => x.key === f)?.name || f}</option>)}</select>
        <ul className="lib-list">{meta.map(o => (
          <li key={o.id}>
            <b>{o.name}</b><span className="muted small">{o.share ? `${Math.round(o.share * 100)}% do meta` : ''} · {o.source}</span>
            <span className="row-btns"><button disabled={busy === o.id} onClick={() => saveMeta(o)}>{busy === o.id ? 'A guardar…' : 'Guardar nos meus decks'}</button></span>
          </li>
        ))}</ul>
        {!meta.length && <p className="muted small">Sem decks do meta para este formato.</p>}
      </section>

      {trash.length > 0 && (
        <section className="card">
          <h3>Lixo <span className="muted small">decks apagados ficam aqui 30 dias</span></h3>
          <ul className="lib-list">{trash.map(d => (
            <li key={d.id}><b>{d.name}</b><span className="muted small">{FORMAT[d.format]?.name || d.format} · apagado a {when(d.deleted)}</span>
              <span className="row-btns"><button onClick={() => restore(d.id)}>Restaurar</button></span></li>
          ))}</ul>
        </section>
      )}
    </div>
  )
}
