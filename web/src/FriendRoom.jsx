// Entrar na sala de um amigo a partir do TEU Grimório (exe, pacote Linux, APK ou browser): cola-se o link (…/sala/… ou
// …/convite/…) ou chega por grimorio://join (#levar=<link>). Com quem aloja na mesma versão da API, a sala abre-se aqui,
// com os teus ecrãs e os teus decks (remote.js); senão abre-se a página de lá na janela inteira, com «← O meu Grimório».
// Do lado de quem aloja, um convidado sem a app traz os decks de uma vez (ficheiro de «Exportar decks» ou listas).
import { useEffect, useState } from 'react'
import { FORMAT, fixFormat } from './formats.js'
import { parseList, count } from './deck.js'
import { DeckArt } from './FreeRooms.jsx'
import FreeTable from './FreeTable.jsx'
import ForgeTable from './ForgePlay.jsx'
import { Rooms } from './Tournament.jsx'
import { useBackClose } from './backnav.js'
import { API, setRemote, remoteOn, rooms, saveRoom, dropRoom, hostPage } from './remote.js'
import { tx } from './i18n.js'

async function j(url, opts) {
  const r = await fetch(url, opts), d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const LINK = /^https?:\/\/[^/\s]+\/(sala|convite)\/[\w-]{8,40}/
const hostOf = b => { try { return new URL(b).host } catch { return b } }

// a sala de lá responde às salas com o convite (CORS) e tem a mesma API?
const probe = room => fetch(`${room.base}/api/guest/me`, { headers: { Authorization: `Bearer ${room.token}` }, credentials: 'omit', cache: 'no-store' })
  .then(r => (r.ok ? r.json() : null)).then(m => m?.api === API && m).catch(() => null)

// «← O meu Grimório» de quem veio de outro Grimório (?volta=<origem>, guests.accept): fica guardado nesta sessão
export const VOLTA = (() => {
  try {
    const v = new URLSearchParams(window.location.search).get('volta')
    if (v && /^https?:\/\/[^/\s?#]+\/?$/.test(v)) { sessionStorage.setItem('grimorio.volta', v); history.replaceState(null, '', window.location.pathname + window.location.hash) }
    return sessionStorage.getItem('grimorio.volta') || ''
  } catch { return '' }
})()

// ---------- «Sala de um amigo»: colar o link, ver que sala é e entrar ----------
export function FriendRoomModal({ data, link = '', onClose, onRemote }) {
  useBackClose(true, onClose)
  const [url, setUrl] = useState(link), [peek, setPeek] = useState(null), [decks, setDecks] = useState(null), [sel, setSel] = useState(new Set())
  const [err, setErr] = useState(''), [busy, setBusy] = useState(''), [saved, setSaved] = useState(rooms)
  const u = url.trim(), ok = LINK.test(u)
  useEffect(() => { j('/api/decks').then(ds => setDecks(ds.filter(d => !d.friend))).catch(() => setDecks([])) }, [])
  useEffect(() => {
    setPeek(null); setErr('')
    if (!ok) return
    let off = false
    post('/api/rooms/remote', { url: u, dry: true }).then(p => !off && setPeek(p)).catch(e => !off && setErr(e.message))
    return () => { off = true }
  }, [u, ok])
  const info = peek?.info, fmt = info?.casual ? null : info?.format, remoteOk = info?.api === API
  useEffect(() => { if (decks && peek) setSel(new Set(decks.filter(d => !fmt || (d.format === fmt && !d.casual)).map(d => d.id))) }, [decks, peek, fmt])
  const open = async room => {  // a sala aqui, ou (outra versão, sem CORS) a página de lá
    setBusy('open')
    if (await probe(room)) { saveRoom(room); return onRemote(room) }
    window.location.href = hostPage(room.base, room.token)
  }
  const go = async () => {
    setBusy('go'); setErr('')
    try {
      // a sala aqui: os decks vão quando te sentares; a página de lá: os escolhidos vão já
      const r = await post('/api/rooms/remote', { url: u, decks: remoteOk ? [] : [...sel] })
      const token = r.go.match(/\/convite\/([\w-]+)/)?.[1], room = { base: r.base, token, name: (peek.kind === 'sala' && info?.name) || '' }
      if (remoteOk && await probe(room)) { saveRoom(room); return onRemote(room) }
      if (remoteOk && sel.size) await post('/api/rooms/remote', { url: `${r.base}/convite/${token}`, decks: [...sel] })
      window.location.href = hostPage(r.base, token)
    } catch (e) { setErr(e.message); setBusy('') }
  }
  const toggle = id => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal fr-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Sala de um amigo')}>
        <h3>🚪 {tx('Sala de um amigo')}</h3>
        <p className="small muted">{tx('Cola o link que o teu amigo te mandou (de uma sala ou um convite). A sala abre-se aqui, no teu Grimório, e sentas-te com os teus decks.')}</p>
        <input className="fr-url" value={url} onChange={e => setUrl(e.target.value)} placeholder={tx('https://…/sala/… ou …/convite/…')} aria-label={tx('Link do teu amigo')} autoFocus={!link} />
        {!u && saved.length > 0 && <div className="fr-saved"><h4 className="ml-h4">{tx('Salas de amigos onde já entraste')}</h4>
          {saved.map(x => <span key={x.base + x.token} className="fr-saved-r"><button className="link" disabled={!!busy} onClick={() => open(x)}>🌍 {x.name || hostOf(x.base)} <small className="muted">{hostOf(x.base)}</small></button>
            <button className="link small" onClick={() => { dropRoom(x); setSaved(rooms()) }} aria-label={tx('Esquecer')} title={tx('Esquecer')}>✕</button></span>)}</div>}
        {u && !ok && <p className="small bad-t">{tx('Isto não parece um link do Grimório (…/sala/… ou …/convite/…).')}</p>}
        {ok && !peek && !err && <p className="small muted">{tx('A ver a sala…')}</p>}
        {peek && <p className="fr-host"><b>{peek.kind === 'sala' ? `🌍 ${info?.name || tx('Sala')}` : `🤝 ${tx('Convite para {n}', { n: info?.name || '' })}`}</b> <span className="small muted">{tx('no Grimório de')} {hostOf(peek.base)}{fmt ? ` · ${FORMAT[fmt]?.name || fmt}` : ''}</span></p>}
        {peek && !remoteOk && !peek.erro && <>
          <p className="small">{tx('Este Grimório abre-se na página de lá (outra versão). Escolhe os decks que levas:')}</p>
          <div className="row-btns small"><button className="link small" onClick={() => setSel(new Set((decks || []).map(d => d.id)))}>{tx('todos')}</button><button className="link small" onClick={() => setSel(new Set())}>{tx('nenhum')}</button>
            {fmt && <button className="link small" onClick={() => setSel(new Set((decks || []).filter(d => d.format === fmt && !d.casual).map(d => d.id)))}>{tx('só {f}', { f: FORMAT[fmt]?.name || fmt })}</button>}</div>
          <div className="pv-grid ml-grid fr-grid">{(decks || []).map(d => <button key={d.id} type="button" className={`pv-tile ${sel.has(d.id) ? 'on' : ''}`} aria-pressed={sel.has(d.id)} onClick={() => toggle(d.id)} title={d.name}>
            <DeckArt d={d} data={data} /><span className="pv-t"><b>{sel.has(d.id) ? '✓ ' : ''}{d.name}</b><span className="small muted">{FORMAT[d.format]?.name || d.format}</span></span></button>)}</div>
        </>}
        {peek?.erro && <p className="small bad-t">{peek.erro} <a href={u}>{tx('Abrir o link aqui')}</a></p>}
        {err && <p className="small bad-t">{err}</p>}
        <div className="row-btns">
          <button className="primary" onClick={go} disabled={!peek || !!peek.erro || !!busy}>{busy ? tx('A entrar…') : remoteOk ? `🚪 ${tx('Entrar na sala')}` : `🚪 ${tx('Levar {n} decks e entrar', { n: sel.size })}`}</button>
          <button onClick={onClose}>{tx('Cancelar')}</button>
        </div>
        {remoteOk && <p className="small muted">{tx('Levas o nome do teu perfil; cada deck vai quando te sentares com ele (e atualiza-se da próxima vez).')}</p>}
      </div>
    </div>
  )
}

// ---------- a sala de um amigo, aqui (as salas e a mesa livre de lá, com os teus ecrãs) ----------
export function RemoteRoom({ data, room, onClose }) {
  const [table, setTable] = useState(null), [on, setOn] = useState(false)
  useEffect(() => { setRemote(room); setOn(true); return () => setRemote(null) }, [room])  // antes dos pedidos dos filhos
  const page = () => { window.location.href = hostPage(room.base, room.token) }  // torneios e Forge Play: a página de lá
  return (
    <div className="app fr-remote">
      <div className="fr-bar">
        <button className="link" onClick={onClose}>← {tx('O meu Grimório')}</button>
        <span>🌍 {tx('Sala de um amigo')} · <b>{room.name || hostOf(room.base)}</b> <small className="muted">{hostOf(room.base)}</small></span>
        <button className="link small" onClick={page} title={tx('Torneios e jogos do Forge abrem-se na página de lá')}>{tx('abrir a página de lá')}</button>
      </div>
      {on && (table ? <div className="view play fp-view">{String(table).startsWith('fp:') ? <ForgeTable key={table} sid={table.slice(3)} data={data} onClose={() => setTable(null)} /> : <FreeTable key={table} id={table} data={data} onClose={() => setTable(null)} />}</div>
        : <div className="area"><Rooms data={data} guest open={page} openTable={setTable} /></div>)}
    </div>
  )
}

// ---------- quem aloja, para um convidado: trazer os decks de uma vez ----------
const fromText = (data, t, name) => {
  try { const b = JSON.parse(t); if (b?.grimorio === 'decks' && Array.isArray(b.decks)) return b.decks } catch { /* não é o ficheiro da app: uma lista */ }
  const p = parseList(t, data)
  return count(p.main) ? [{ id: name, name, format: fixFormat(data, p)?.format || 'casual', main: p.main, side: p.side, commanders: p.commanders }] : []
}
export function BringMine({ data, onDone }) {
  const [me, setMe] = useState(null), [text, setText] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { j('/api/guest/me').then(setMe).catch(() => {}) }, [])
  const send = async decks => {
    setErr(''); setMsg('')
    if (!decks.length) return setErr(tx('Não encontrei decks aí. Usa o ficheiro de «Exportar decks» da tua app, ou listas com «4 Lightning Bolt» por linha.'))
    setBusy(true)
    try { const r = await post('/api/guest/decks', { decks }); setMsg(tx('{n} decks trazidos.', { n: r.n })); setText(''); onDone?.() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const files = async fl => { const all = []; for (const f of fl) all.push(...fromText(data, await f.text(), f.name.replace(/\.[^.]+$/, ''))); send(all) }
  const app = me?.invite && `grimorio://join?u=${encodeURIComponent(window.location.origin + me.invite)}`
  if (remoteOn()) return null  // já estás na tua app: os teus decks estão em «Os meus»
  return (
    <div className="fr-bring">
      {app && <p className="fr-app-row"><a className="fr-app" href={app}>📲 {tx('Abrir na app Grimório')}</a> <span className="small muted">{tx('com a app no PC ou no telemóvel entras com os decks de lá, sem copiar nada')}</span></p>}
      <label className="fr-file"><b>📄 {tx('O ficheiro de «Exportar decks» da tua app')}</b> <span className="small muted">{tx('(ou listas .txt, vários de uma vez)')}</span>
        <input type="file" multiple accept=".json,.txt,.dek,text/plain,application/json" disabled={busy} onChange={e => { files([...e.target.files]); e.target.value = '' }} /></label>
      <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={tx('…ou cola aqui o conteúdo do ficheiro, ou uma lista («4 Lightning Bolt» por linha)')} aria-label={tx('Decks a trazer')} />
      <div className="row-btns"><button className="primary" disabled={!text.trim() || busy} onClick={() => send(fromText(data, text, `${tx('Deck colado')} ${new Date().toLocaleString()}`))}>{busy ? tx('A trazer…') : `📥 ${tx('Trazer')}`}</button>
        {msg && <span className="small ok-t">{msg}</span>}{err && <span className="small bad-t">{err}</span>}</div>
    </div>
  )
}

// Biblioteca › «Exportar decks»: todos os meus decks num ficheiro (para o Grimório de um amigo, sem a app à mão)
export async function exportDecks() {
  const b = await j('/api/decks/export')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(b)], { type: 'application/json' }))
  a.download = `grimorio-decks${b.name ? `-${b.name.replace(/[^\w-]+/g, '')}` : ''}.json`
  a.click()
  return b.decks.length
}
