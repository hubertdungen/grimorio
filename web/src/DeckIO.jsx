// Biblioteca › Exportar / Importar decks: todos ou alguns num ficheiro do Grimório (com capas, artes, sideboard, maybeboard,
// notas…) ou num .zip de listas .txt para outras apps; importar arrastando ficheiros (o do Grimório, .zip, .txt, .dek,
// .csv) ou colando, com pré-visualização, escolha e o que fazer a um deck que já existe. Nunca apaga decks.
import { useEffect, useMemo, useState } from 'react'
import { FORMAT } from './formats.js'
import { fromText, readFiles, listsZip, download } from './deckio.js'
import { tx } from './i18n.js'

async function j(url, opts) {
  const r = await fetch(url, opts), d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const send = (url, method, body) => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const fmtName = f => FORMAT[f]?.name || f || '—'
const stamp = () => new Date().toISOString().slice(0, 10)

export default function DeckIO({ data, say, onDone }) {
  const [tab, setTab] = useState('exp')
  return (
    <div className="dio">
      <div className="seg dio-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'exp'} className={tab === 'exp' ? 'on' : ''} onClick={() => setTab('exp')}>⇪ {tx('Exportar')}</button>
        <button role="tab" aria-selected={tab === 'imp'} className={tab === 'imp' ? 'on' : ''} onClick={() => setTab('imp')}>⇩ {tx('Importar')}</button>
      </div>
      {tab === 'exp' ? <Export say={say} /> : <Import data={data} say={say} onDone={onDone} />}
    </div>
  )
}

function Export({ say }) {
  const [all, setAll] = useState(null), [fmt, setFmt] = useState(''), [q, setQ] = useState(''), [off, setOff] = useState(new Set()), [err, setErr] = useState('')
  useEffect(() => { j('/api/decks/export').then(setAll).catch(e => setErr(e.message)) }, [])
  const shown = useMemo(() => (all?.decks || []).filter(d => (!fmt || d.format === fmt) && (!q || d.name?.toLowerCase().includes(q.toLowerCase()))), [all, fmt, q])
  const pick = shown.filter(d => !off.has(d.id))
  const fmts = [...new Set((all?.decks || []).map(d => d.format).filter(Boolean))]
  const flip = id => setOff(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const name = `grimorio-decks${all?.name ? `-${all.name.replace(/[^\w-]+/g, '')}` : ''}-${stamp()}`
  const bundle = () => { download(JSON.stringify({ ...all, decks: pick }), `${name}.json`, 'application/json'); say?.(tx('{n} decks exportados.', { n: pick.length })) }
  const zip = () => { download(listsZip(pick), `${name}.zip`, 'application/zip'); say?.(tx('{n} decks exportados.', { n: pick.length })) }
  if (err) return <p className="small bad-t">{err}</p>
  if (!all) return <p className="small muted">{tx('A carregar…')}</p>
  return (
    <div className="dio-exp">
      <div className="row-btns">
        <select value={fmt} onChange={e => setFmt(e.target.value)} aria-label={tx('Formato')}><option value="">{tx('Todos os formatos')}</option>{fmts.map(f => <option key={f} value={f}>{fmtName(f)}</option>)}</select>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar deck…')} aria-label={tx('Procurar deck')} />
        <button className="link small" onClick={() => setOff(new Set())}>{tx('todos')}</button><button className="link small" onClick={() => setOff(new Set(shown.map(d => d.id)))}>{tx('nenhum')}</button>
      </div>
      <ul className="dio-list">{shown.map(d => (
        <li key={d.id}><label className="chk"><input type="checkbox" checked={!off.has(d.id)} onChange={() => flip(d.id)} /> <b>{d.name}</b> <span className="small muted">{fmtName(d.format)} · {Object.values(d.main || {}).reduce((a, b) => a + b, 0) + (d.commanders?.length || 0)}</span></label></li>))}</ul>
      <div className="row-btns">
        <button className="primary" disabled={!pick.length} onClick={bundle} title={tx('Tudo de cada deck: capas, artes escolhidas, sideboard, maybeboard e notas. Volta a entrar aqui ou no Grimório de um amigo.')}>📦 {tx('Ficheiro do Grimório ({n})', { n: pick.length })}</button>
        <button disabled={!pick.length} onClick={zip} title={tx('Uma lista .txt por deck (formato Arena/Moxfield), para usar noutras apps')}>🗜 {tx('Listas .txt num .zip ({n})', { n: pick.length })}</button>
      </div>
      <p className="small muted">{tx('No Grimório de um amigo, em «📥 Trazer os meus decks», escolhes o ficheiro do Grimório e entram todos de uma vez.')} <a className="link small" href="#levar">🚪 {tx('Entrar na sala de um amigo')}</a></p>
    </div>
  )
}

function Import({ data, say, onDone }) {
  const [items, setItems] = useState([]), [mine, setMine] = useState([]), [text, setText] = useState(''), [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [all, setAll] = useState('copy')
  const loadMine = () => j('/api/decks').then(ds => setMine(ds.filter(d => !d.friend))).catch(() => {})
  useEffect(() => { loadMine() }, [])
  const dupOf = d => mine.find(m => d.id && m.id === d.id) || mine.find(m => m.name?.trim().toLowerCase() === d.name?.trim().toLowerCase())
  const add = list => {
    if (!list.length) return setErr(tx('Não encontrei decks aí. Usa o ficheiro do Grimório, um .zip, listas .txt/.dek/.csv, ou cola listas («4 Lightning Bolt» por linha).'))
    setErr(''); setItems(v => [...v, ...list.map((x, k) => ({ ...x, key: `${Date.now()}-${v.length + k}`, on: true, how: null }))])
  }
  const files = async fl => { if (!fl.length) return; setBusy(true); try { add(await readFiles(data, [...fl])) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const set = (key, o) => setItems(v => v.map(x => (x.key === key ? { ...x, ...o } : x)))
  const chosen = items.filter(x => x.on)
  const go = async () => {
    setBusy(true); setErr('')
    let n = 0
    const names = new Set(mine.map(m => m.name?.trim().toLowerCase()))
    try {
      for (const x of chosen) {
        const body = { ...x.deck }, dup = dupOf(x.deck), how = x.how || all
        delete body.id  // o id é o deste Grimório: o importado entra com um novo (ou atualiza o que já existe)
        if (dup && how === 'update') { await send(`/api/decks/${dup.id}`, 'PUT', { ...body, name: body.name || dup.name }); n++; continue }
        let nm = body.name || tx('Deck importado'), k = 2
        while (names.has(nm.trim().toLowerCase())) nm = `${(body.name || '').replace(/ \(\d+\)$/, '')} (${k++})`
        names.add(nm.trim().toLowerCase())
        await send('/api/decks', 'POST', { ...body, name: nm }); n++
      }
      say?.(tx('{n} decks importados.', { n })); setItems([]); loadMine(); onDone?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="dio-imp">
      <label className={`dio-drop ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); files(e.dataTransfer.files) }}>
        <b>📥 {tx('Larga aqui os ficheiros, ou toca para escolher')}</b>
        <span className="small muted">{tx('o ficheiro do Grimório (.json), um .zip, listas .txt (Arena/Moxfield), .dek (MTGO) ou .csv (Moxfield/Archidekt) — vários de uma vez')}</span>
        <input type="file" multiple accept=".json,.zip,.txt,.dek,.csv,.grimorio,text/plain,application/json,application/zip,text/csv" disabled={busy} onChange={e => { files(e.target.files); e.target.value = '' }} />
      </label>
      <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={tx('…ou cola uma ou várias listas. Para separar decks: uma linha «Nome: o nome do deck» antes de cada um (ou «---»).')} aria-label={tx('Listas a importar')} />
      <div className="row-btns"><button disabled={!text.trim() || busy} onClick={() => { add(fromText(data, text, `${tx('Deck colado')} ${new Date().toLocaleDateString()}`)); setText('') }}>{tx('Ler o texto')}</button>
        {err && <span className="small bad-t">{err}</span>}</div>
      {items.length > 0 && <>
        <h4 className="ml-h4">{tx('Pré-visualização')} <span className="small muted">{tx('{n} de {t} escolhidos', { n: chosen.length, t: items.length })}</span></h4>
        <p className="small">{tx('Quando já tens um deck com o mesmo nome (ou o mesmo deck):')} <span className="seg">
          <button className={all === 'copy' ? 'on' : ''} onClick={() => setAll('copy')}>{tx('criar cópia')}</button>
          <button className={all === 'update' ? 'on' : ''} onClick={() => setAll('update')}>{tx('atualizar o existente')}</button></span></p>
        <ul className="dio-list dio-prev">{items.map(x => {
          const dup = dupOf(x.deck)
          return (
            <li key={x.key} className={x.on ? '' : 'off'}>
              <label className="chk"><input type="checkbox" checked={x.on} onChange={e => set(x.key, { on: e.target.checked })} /></label>
              <input className="dio-name" value={x.deck.name || ''} onChange={e => set(x.key, { deck: { ...x.deck, name: e.target.value } })} aria-label={tx('Nome do deck')} maxLength={80} />
              <span className="small muted">{fmtName(x.deck.format)} · {tx('{n} cartas', { n: x.count })}{x.src ? ` · ${x.src}` : ''}</span>
              {x.unknown.length > 0 && <span className="small bad-t" title={x.unknown.join(', ')}>⚠ {tx('{n} carta não reconhecida|{n} cartas não reconhecidas', { n: x.unknown.length })}</span>}
              {dup && <select className="small" value={x.how || all} onChange={e => set(x.key, { how: e.target.value })} title={tx('Já tens «{n}»', { n: dup.name })}>
                <option value="copy">{tx('já existe: criar cópia')}</option><option value="update">{tx('já existe: atualizar')}</option></select>}
            </li>)
        })}</ul>
        <div className="row-btns"><button className="primary" disabled={!chosen.length || busy} onClick={go}>{busy ? tx('A importar…') : tx('Importar {n} decks', { n: chosen.length })}</button>
          <button className="link small" onClick={() => setItems([])}>{tx('limpar')}</button></div>
        <p className="small muted">{tx('Importar nunca apaga decks: «atualizar» troca a lista do deck que já tens, «criar cópia» junta um novo.')}</p>
      </>}
    </div>
  )
}
