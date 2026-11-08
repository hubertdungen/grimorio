// Coliseu › Taverna: o sítio dos amigos, no Grimório de quem a abre (taverna.py). Quem está ligado (e a jogar), a conversa
// (menções @nome e #deck, reações, respostas, fixadas e propostas de jogo), os jogos (as salas daqui: Online.jsx), a
// Prateleira (decks partilhados: ver, copiar para os meus, atirar as caixas na mesa 3D — Lobby3D.jsx) e o Hall da Fama
// (resultados das mesas e torneios entre membros e os jogos registados à mão).
// Três maneiras de lá estar: quem aloja (aqui), um amigo no browser (convidado, guests.py) e um amigo com o Grimório
// dele (RemoteTaverna: os pedidos /api/taverna, /api/rooms… vão para lá com o convite, remote.js; os decks são os dele).
import './taverna.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tx, LOCALE } from './i18n.js'
import { FORMAT } from './formats.js'
import { colorsOf } from './data.js'
import { exportList } from './deck.js'
import { download } from './deckio.js'
import { Mana } from './ui.jsx'
import { Icon } from './icons.jsx'
import { DeckView } from './DeckPeek.jsx'
import { DeckTiles, DeckArt, NewFreeRoom } from './FreeRooms.jsx'
import { Rooms, Invite, useNet } from './Online.jsx'
import Lobby3D from './Lobby3D.jsx'
import FreeTable from './FreeTable.jsx'
import ForgeTable from './ForgePlay.jsx'
import { ask } from './confirm.jsx'
import { useBackClose } from './backnav.js'
import { setRemote, remoteOn, API, hostPage } from './remote.js'
import { setBadge, pieces, tavernas, saveTaverna, dropTaverna, playing } from './taverna.js'

async function j(url, opts) {
  const r = await fetch(url, opts), d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch { return null } }
const REACT = ['👍', '😂', '🔥', '😮', '🎉', '✋']
const hostOf = b => { try { return new URL(b).host } catch { return b } }
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const KIND = { livre: ['🃏', tx('Mesa livre')], estrita: ['⚖', tx('Mesa estrita')], torneio: ['🏆', tx('Torneio entre vocês')] }
const RES_ICO = { mesa: '🃏', estrita: '⚖', torneio: '🏆', manual: '✍' }
const FORM = { V: [tx('vitória (uma letra)§V'), tx('vitória')], D: [tx('derrota (uma letra)§D'), tx('derrota')], E: [tx('empate (uma letra)§E'), tx('empate')] }

// ---------- tempo ----------
const rtf = (() => { try { return new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }) } catch { return null } })()
function ago(ts) {
  if (!ts) return tx('nunca entrou')
  const s = Date.now() / 1000 - ts
  if (s < 60) return tx('agora mesmo')
  const [v, u] = s < 3600 ? [-Math.round(s / 60), 'minute'] : s < 86400 ? [-Math.round(s / 3600), 'hour'] : s < 86400 * 30 ? [-Math.round(s / 86400), 'day'] : [null]
  return v != null && rtf ? rtf.format(v, u) : new Date(ts * 1000).toLocaleDateString(LOCALE)
}
// rolar a conversa (e só ela) até uma mensagem
const toMsg = id => { const el = document.getElementById(`tvm-${id}`), log = el?.closest('.tv-log'); if (log) log.scrollTo({ top: el.offsetTop - log.clientHeight / 2, behavior: 'smooth' }) }
const hhmm = ts => new Date(ts * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
const dayOf = ts => new Date(ts * 1000).toDateString()
function dayLabel(ts) {
  const d = new Date(ts * 1000), t = new Date()
  if (d.toDateString() === t.toDateString()) return tx('Hoje')
  if (d.toDateString() === new Date(t - 864e5).toDateString()) return tx('Ontem')
  return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })
}

// ---------- pessoas ----------
export function Ava({ who, name, st, big }) {
  const ini = ([...String(name || '?').trim()][0] || '?').toUpperCase()
  return <span className={`tv-ava ${big ? 'big' : ''}`} style={{ '--h': hue(who) }} data-st={st || undefined} aria-hidden="true">{ini}</span>
}
const stOf = m => (m?.playing ? 'jogo' : m?.online ? 'on' : 'off')
const stLabel = m => (m.playing ? tx('a jogar') : m.online ? tx('ligado') : tx('visto {t}', { t: ago(m.seen) }))

function Members({ s, onMention, onKick }) {
  const list = [...s.members].sort((a, b) => (b.playing - a.playing) || (b.online - a.online) || (b.host - a.host) || a.name.localeCompare(b.name))
  const on = list.filter(m => m.online).length
  return (
    <section className="tv-members card" aria-label={tx('Membros')}>
      <header className="tv-sec-h"><h3>{tx('Membros')}</h3><span className="tv-online"><i />{tx('{n} ligados', { n: on })}</span></header>
      <ul>{list.map(m => (
        <li key={m.who} className={`tv-mem ${stOf(m)}`}>
          <button type="button" className="tv-mem-b" onClick={() => onMention(m)} title={m.who === s.me.who ? tx('Tu') : tx('Mencionar {n}', { n: m.name })} disabled={m.who === s.me.who}>
            <Ava who={m.who} name={m.name} st={stOf(m)} />
            <span className="tv-mem-t"><b>{m.name}{m.who === s.me.who && <small> · {tx('tu')}</small>}</b>
              <small>{m.host && <em className="tv-host">{tx('anfitrião')}</em>}{stLabel(m)}</small></span>
          </button>
          {s.me.host && !m.host && <button type="button" className="link small tv-kick" onClick={() => onKick(m)} aria-label={tx('Tirar {n} da Taverna', { n: m.name })} title={tx('Tirar da Taverna')}>✕</button>}
        </li>))}</ul>
    </section>
  )
}

// ---------- decks da prateleira ----------
function DeckCard({ d, data, onOpen, mini, children }) {
  const cols = d.main ? colorsOf(d, data) : []
  return (
    <div className={`tv-deck ${mini ? 'tv-mini' : ''}`}>
      <button type="button" className="tv-deck-b" onClick={() => onOpen(d)} title={tx('Ver o deck')}>
        <DeckArt d={d} data={data} />
        <span className="tv-deck-t"><b>{d.name}</b>
          <small>{FORMAT[d.format]?.name || d.format || tx('qualquer formato')} · {tx('{n} cartas', { n: d.n })} {cols.length > 0 && <Mana cost={cols.map(x => `{${x}}`).join('')} />}</small>
          <small className="tv-deck-by"><Ava who={d.who} name={d.by} /> {d.by}{d.took > 0 && <> · 📥 {d.took}</>}</small></span>
      </button>
      {children}
    </div>
  )
}

// a lista de um deck da prateleira, com «Copiar para os meus decks», copiar a lista e o .txt
function ShelfDeck({ d, data, guest, onClose, onTook }) {
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  const body = useMemo(() => ({ name: d.name, format: d.format, main: d.main, side: d.side || {}, commanders: d.commanders || [], cover: d.cover || undefined }), [d])
  const p = useMemo(() => ({ src: 'taverna', ref: d.id, name: d.name, format: d.format, by: d.by, deck: body }), [d, body])
  const take = async () => {
    setBusy(true); setMsg('')
    try { await post('/api/decks', body); post('/api/taverna/took', { id: d.id }).catch(() => {}); setMsg(tx('Copiado ✓ — está nos teus decks.')); onTook?.() } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const list = exportList(body)
  const copy = async () => { try { await navigator.clipboard.writeText(list); setMsg(tx('Lista copiada ✓')) } catch { window.prompt(tx('Copia a lista:'), list) } }
  const play = () => { onClose(); window.dispatchEvent(new CustomEvent('grimorio:col', { detail: 'jogar' })) }
  return <DeckView p={p} data={data} onClose={onClose}
    extra={<div className="row-btns tv-dv-act">
      <button className="primary" onClick={take} disabled={busy}>📥 {tx('Copiar para os meus decks')}</button>
      <button onClick={copy}>📋 {tx('Copiar a lista')}</button>
      <button onClick={() => download(new TextEncoder().encode(list), `${d.name}.txt`, 'text/plain')}>⬇ .txt</button>
      {msg && <span className="small ok-t">{msg}</span>}
      {msg && !guest && !remoteOn() && <button className="link small" onClick={play}>🤖 {tx('Jogar contra ele (Jogar contra o Forge)')}</button>}
    </div>} />
}

// escolher um deck meu para pôr na prateleira (na app de um amigo: os decks da app dele; no browser: os dele aqui)
function PickMine({ data, onPick, onClose }) {
  useBackClose(true, onClose)
  const [decks, setDecks] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { j('/api/decks').then(ds => setDecks(ds.filter(d => !d.community))).catch(e => setErr(e.message)) }, [])
  const pick = async id => {
    setBusy(true); setErr('')
    try { const d = await j(`/api/decks/${id}`); await onPick(d) } catch (e) { setErr(e.message); setBusy(false) }
  }
  return <div className="modal-bg" onClick={onClose}><div className="modal tv-modal wide" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Pôr um deck na prateleira')}>
    <div className="tv-modal-h"><h3>📚 {tx('Pôr um deck na prateleira')}</h3><button type="button" className="link small" onClick={onClose}>{tx('fechar')}</button></div>
    <p className="small muted">{tx('Os outros membros veem a lista, copiam-na para os decks deles e atiram a caixa na mesa 3D. Vai uma cópia: o teu deck continua só teu.')}</p>
    {err && <p className="small bad-t">{err}</p>}
    <div aria-busy={busy}><DeckTiles decks={decks} value={null} onPick={pick} data={data} empty={tx('Ainda não tens decks.')} /></div>
  </div></div>
}

// ---------- a conversa ----------
function Text({ m, me, shelfBy, openDeck }) {
  const ds = (m.decks || []).map(id => shelfBy[id]).filter(Boolean)
  return pieces(m.m, { atn: m.atn || [], me, decks: ds }).map((p, k) => p.at ? <b key={k} className={`tv-at ${p.me ? 'me' : ''}`}>@{p.at}</b>
    : p.deck ? <button key={k} type="button" className="tv-hash" onClick={() => openDeck(shelfBy[p.deck])}>#{p.name}</button> : <span key={k}>{p.t}</span>)
}

function SysLine({ m, s, shelfBy, data, openDeck, goTab }) {
  const nm = m.name
  const line = {
    open: <>🎉 {tx('A Taverna abriu as portas.')}</>,
    join: <>🍺 {tx('{n} entrou na Taverna.', { n: nm })}</>,
    leave: <>👋 {tx('{n} saiu da Taverna.', { n: nm })}</>,
    kick: <>🚪 {tx('{n} já não está na Taverna.', { n: nm })}</>,
    shelf: <>📚 {tx('{n} pôs «{d}» na prateleira.', { n: nm, d: m.dn || '?' })}</>,
    room: <>{m.rt === 'livre' ? (m.strict ? '⚖' : '🃏') : '🏆'} {tx('{n} abriu a sala «{r}».', { n: nm, r: m.rn || '?' })} <button type="button" className="link small" onClick={() => goTab('jogos')}>{tx('ver')}</button></>,
  }[m.kind]
  if (m.kind === 'res') return <ResLine m={m} />
  return <div className={`tv-sys k-${m.kind}`}><span>{line || nm}</span>
    {m.kind === 'shelf' && shelfBy[m.deck] && <DeckCard d={shelfBy[m.deck]} data={data} onOpen={openDeck} mini />}
    {m.kind === 'shelf' && !shelfBy[m.deck] && s && <small className="muted">{tx('(já saiu da prateleira)')}</small>}</div>
}

function ResLine({ m }) {
  const r = m.sum || {}
  return <div className="tv-sys tv-resline"><span className="tv-trophy" aria-hidden="true">{RES_ICO[r.k] || '🏆'}</span>
    <span>{r.k === 'torneio' && r.pod ? <>{tx('Torneio «{n}» acabou:', { n: r.n || '' })} {r.pod.map(([pl, n]) => <b key={pl + n} className={`tv-place p${pl}`}>{['', '🥇', '🥈', '🥉'][pl]} {n}</b>)}</>
      : r.w?.length ? <>{tx('{w} ganhou', { w: r.w.join(' + ') })} <span className="muted">· {r.p?.join(' vs ')}{r.n ? ` · ${r.n}` : ''}</span></>
        : <>{tx('Empate')} <span className="muted">· {r.p?.join(' vs ')}</span></>}</span></div>
}

function Msg({ m, prev, s, me, shelfBy, data, openDeck, act, setReply, goTab, fresh, onCall, touch }) {
  const [tools, setTools] = useState(false), [pal, setPal] = useState(false)
  if (m.kind !== 'msg' && m.kind !== 'call') return <SysLine m={m} s={s} shelfBy={shelfBy} data={data} openDeck={openDeck} goTab={goTab} />
  const cont = prev && prev.who === m.who && (prev.kind === 'msg' || prev.kind === 'call') && m.ts - prev.ts < 300 && !m.re
  const atMe = (m.at || []).includes(me.who), mem = s.members.find(x => x.who === m.who)
  const can = me.host || m.mine
  const call = m.call && KIND[m.call.kind]
  const inn = m.react?.['✋'] || []
  return (
    <article className={`tv-msg ${cont ? 'cont' : ''} ${atMe ? 'atme' : ''} ${m.mine ? 'mine' : ''} ${fresh ? 'new' : ''} ${m.pin ? 'pinned' : ''}`} id={`tvm-${m.id}`}>
      {!cont ? <Ava who={m.who} name={m.name} st={mem && stOf(mem)} /> : <span className="tv-msg-gut"><time>{hhmm(m.ts)}</time></span>}
      <div className="tv-msg-b">
        {!cont && <header><b style={{ '--h': hue(m.who) }}>{m.name}</b><time dateTime={new Date(m.ts * 1000).toISOString()}>{hhmm(m.ts)}</time>{m.pin && <span className="tv-pin-i" title={tx('Fixada')}>📌</span>}</header>}
        {m.re && <button type="button" className="tv-quote" onClick={() => toMsg(m.re.id)}>↩ <b>{m.re.name}</b> {m.re.m}</button>}
        {call && <div className="tv-call"><b>🎲 {tx('{n} quer jogar', { n: m.name })}: {call[0]} {call[1]}{m.call.fmt ? ` · ${FORMAT[m.call.fmt]?.name || m.call.fmt}` : ''}</b>
          <span className="row-btns"><button type="button" className={inn.includes(me.who) ? 'on' : 'primary'} onClick={() => act('react', { id: m.id, e: '✋' })} aria-pressed={inn.includes(me.who)}>✋ {inn.includes(me.who) ? tx('Alinho ✓') : tx('Eu alinho')}</button>
            {inn.length > 0 && <span className="tv-inn">{inn.map(w => { const x = s.members.find(y => y.who === w); return <Ava key={w} who={w} name={x?.name || '?'} /> })}</span>}
            {me.host && <button type="button" onClick={() => onCall(m.call)}>🚪 {tx('Abrir a sala')}</button>}</span></div>}
        {m.m && <p className="tv-text"><Text m={m} me={me.name} shelfBy={shelfBy} openDeck={openDeck} /></p>}
        {(m.decks || []).length > 0 && <div className="tv-decks">{m.decks.map(id => shelfBy[id] ? <DeckCard key={id} d={shelfBy[id]} data={data} onOpen={openDeck} mini /> : <small key={id} className="muted">📚 {tx('(já saiu da prateleira)')}</small>)}</div>}
        {Object.keys(m.react || {}).filter(e => e !== '✋' || !call).length > 0 && <div className="tv-reacts">{Object.entries(m.react).filter(([e]) => e !== '✋' || !call).map(([e, ws]) => (
          <button key={e} type="button" className={ws.includes(me.who) ? 'on' : ''} onClick={() => act('react', { id: m.id, e })} title={ws.map(w => s.members.find(x => x.who === w)?.name || '?').join(', ')}>{e} <b>{ws.length}</b></button>))}</div>}
      </div>
      <div className={`tv-tools ${tools || pal ? 'open' : ''}`}>
        {touch && <button type="button" className="tv-more" onClick={() => { setTools(v => !v); setPal(false) }} aria-expanded={tools} aria-label={tx('Mais ações')}>⋯</button>}
        {(!touch || tools) && <span className="tv-tools-b">
          <button type="button" onClick={() => setPal(v => !v)} aria-label={tx('Reagir')} title={tx('Reagir')}>☺</button>
          <button type="button" onClick={() => { setReply(m); setTools(false) }} aria-label={tx('Responder')} title={tx('Responder')}>↩</button>
          {can && <button type="button" onClick={() => act('pin', { id: m.id, on: !m.pin })} aria-label={m.pin ? tx('Desafixar') : tx('Fixar')} title={m.pin ? tx('Desafixar') : tx('Fixar')}>📌</button>}
          {can && <button type="button" onClick={async () => (await ask('amigo', { title: tx('Apagar esta mensagem?'), ok: tx('Apagar') })) && act('del', { id: m.id })} aria-label={tx('Apagar')} title={tx('Apagar')}>🗑</button>}
        </span>}
        {pal && <span className="tv-pal" role="menu">{REACT.map(e => <button key={e} type="button" role="menuitem" onClick={() => { act('react', { id: m.id, e }); setPal(false); setTools(false) }}>{e}</button>)}</span>}
      </div>
    </article>
  )
}

function Composer({ s, shelf, reply, setReply, send, mention, onPickMine, onCall }) {
  const [text, setText] = useState(''), [att, setAtt] = useState([]), [pop, setPop] = useState(null), [game, setGame] = useState(false), [busy, setBusy] = useState(false)
  const ta = useRef(null)
  useEffect(() => {  // mencionar alguém da lista de membros (ou um deck da prateleira, pelo botão «Mencionar»)
    if (!mention) return
    const add = mention.deck ? `#${mention.deck.name} ` : `@${mention.name} `
    if (mention.deck) setAtt(a => (a.some(d => d.id === mention.deck.id) ? a : [...a, mention.deck].slice(-3)))
    setText(t => (t && !/\s$/.test(t) ? `${t} ` : t) + add)
    setTimeout(() => ta.current?.focus(), 0)
  }, [mention])
  useEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(140, el.scrollHeight)}px` } }, [text])
  const caret = () => ta.current?.selectionStart ?? text.length
  const onChange = e => {
    const v = e.target.value, at = e.target.selectionStart, before = v.slice(0, at)
    setText(v)
    const ma = before.match(/(^|\s)@([^\s@#]{0,20})$/), mh = before.match(/(^|\s)#([^\s@#]{0,24})$/)
    setPop(ma ? { k: '@', q: ma[2].toLowerCase(), at } : mh ? { k: '#', q: mh[2].toLowerCase(), at } : null)
  }
  const put = (k, name, deck) => {
    const at = pop?.at ?? caret(), before = text.slice(0, at), after = text.slice(at)
    const cut = before.replace(k === '@' ? /@[^\s@#]{0,20}$/ : /#[^\s@#]{0,24}$/, '')
    setText(`${cut}${k}${name} ${after}`); setPop(null)
    if (deck) setAtt(a => (a.some(d => d.id === deck.id) ? a : [...a, deck].slice(-3)))
    setTimeout(() => ta.current?.focus(), 0)
  }
  const people = pop?.k === '@' ? s.members.filter(m => m.who !== s.me.who && m.name.toLowerCase().includes(pop.q)).slice(0, 6) : []
  const decks = pop?.k === '#' ? shelf.filter(d => d.name.toLowerCase().includes(pop.q)).slice(0, 6) : []
  const go = async e => {
    e?.preventDefault()
    const m = text.trim()
    if (!m && !att.length) return
    setBusy(true)
    const ok = await send({ m, decks: att.map(d => d.id), ...(reply && { re: reply.id }) })
    setBusy(false)
    if (ok) { setText(''); setAtt([]); setReply(null); setPop(null) }
  }
  const key = e => {
    if (pop && e.key === 'Escape') { setPop(null); return }
    if (pop && e.key === 'Enter' && !e.shiftKey && (people[0] || decks[0])) { e.preventDefault(); if (people[0]) put('@', people[0].name); else put('#', decks[0].name, decks[0]); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia?.('(pointer: coarse)').matches) go(e)
  }
  return (
    <form className="tv-comp" onSubmit={go}>
      {reply && <div className="tv-replying">↩ {tx('A responder a {n}', { n: reply.name })}: <span>{reply.m || '…'}</span><button type="button" className="link small" onClick={() => setReply(null)} aria-label={tx('Cancelar a resposta')}>✕</button></div>}
      {att.length > 0 && <div className="tv-att">{att.map(d => <span key={d.id} className="tv-chip">📚 {d.name}<button type="button" onClick={() => setAtt(a => a.filter(x => x.id !== d.id))} aria-label={tx('Tirar {n}', { n: d.name })}>✕</button></span>)}</div>}
      {pop && (people.length > 0 || pop.k === '#') && <div className="tv-pop" role="listbox">
        {people.map(m => <button key={m.who} type="button" role="option" onClick={() => put('@', m.name)}><Ava who={m.who} name={m.name} st={stOf(m)} /> {m.name}</button>)}
        {decks.map(d => <button key={d.id} type="button" role="option" onClick={() => put('#', d.name, d)}>📚 <b>{d.name}</b> <small className="muted">{d.by}</small></button>)}
        {pop.k === '#' && <button type="button" className="tv-pop-add" onClick={() => { setPop(null); onPickMine() }}>＋ {tx('Partilhar um deck meu…')}</button>}
      </div>}
      {game && <div className="tv-game">
        <b>🎲 {tx('Propor um jogo')}</b>
        <div className="row-btns">{Object.entries(KIND).map(([k, [i, l]]) => <button key={k} type="button" onClick={async () => { setGame(false); await onCall({ kind: k }, text.trim()); setText('') }}>{i} {l}</button>)}</div>
        <small className="muted">{tx('Fica na conversa: quem quiser carrega em «Eu alinho» e quem aloja abre a sala.')}</small>
      </div>}
      <div className="tv-comp-row">
        <button type="button" className="tv-ib" onClick={() => setPop(p => (p?.k === '#' ? null : { k: '#', q: '', at: caret() }))} aria-label={tx('Mencionar um deck')} title={tx('Mencionar um deck')}>#</button>
        <button type="button" className="tv-ib" onClick={() => setGame(v => !v)} aria-expanded={game} aria-label={tx('Propor um jogo')} title={tx('Propor um jogo')}>🎲</button>
        <textarea ref={ta} rows={1} value={text} onChange={onChange} onKeyDown={key} maxLength={600} placeholder={tx('Escreve à Taverna… (@ menciona alguém, # um deck)')} aria-label={tx('Mensagem para a Taverna')} />
        <button type="submit" className="primary tv-send" disabled={busy || (!text.trim() && !att.length)} aria-label={tx('Enviar')}>➤</button>
      </div>
    </form>
  )
}

function Chat({ s, msgs, more, loadOlder, shelf, shelfBy, data, act, send, openDeck, goTab, mention, onPickMine, onCall, readFrom, freshIds, touch }) {
  const log = useRef(null), [reply, setReply] = useState(null), [below, setBelow] = useState(false), [pins, setPins] = useState(false)
  const nearEnd = () => { const el = log.current; return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120 }
  const last = msgs[msgs.length - 1]?.id
  const first = useRef(true)
  useEffect(() => {
    const el = log.current
    if (!el) return
    if (first.current) {  // ao abrir: a primeira por ler (ou o fim)
      first.current = false
      const nu = el.querySelector('.tv-new-div')
      el.scrollTop = nu ? nu.offsetTop - el.clientHeight / 3 : el.scrollHeight
      return
    }
    if (nearEnd() || msgs[msgs.length - 1]?.mine) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); else setBelow(true)
  }, [last]) // eslint-disable-line react-hooks/exhaustive-deps
  const onCall2 = c => onCall(c)
  let divShown = false
  return (
    <section className="tv-chat card" aria-label={tx('Conversa')}>
      {s.pins.length > 0 && <div className={`tv-pins ${pins ? 'open' : ''}`}>
        <button type="button" className="tv-pins-h" onClick={() => setPins(v => !v)} aria-expanded={pins}>📌 {tx('{n} fixadas', { n: s.pins.length })} <span>{pins ? '▴' : '▾'}</span>
          {!pins && <span className="tv-pins-one">{s.pins[0].name}: {s.pins[0].m || (s.pins[0].call ? '🎲' : '📚')}</span>}</button>
        {pins && <ul>{s.pins.map(p => <li key={p.id}><button type="button" className="link plain" onClick={() => toMsg(p.id)}><b>{p.name}</b> {p.m || '📚'}</button></li>)}</ul>}
      </div>}
      <div className="tv-log" ref={log} role="log" aria-live="polite" onScroll={() => nearEnd() && setBelow(false)}>
        {more && <button type="button" className="link small tv-older" onClick={loadOlder}>↑ {tx('mensagens anteriores')}</button>}
        {!msgs.length && <p className="muted small tv-hello">{tx('Ainda ninguém falou. Diz olá!')}</p>}
        {msgs.map((m, k) => {
          const prev = msgs[k - 1], day = !prev || dayOf(prev.ts) !== dayOf(m.ts)
          const div = !divShown && readFrom != null && m.id > readFrom && m.who !== s.me.who
          if (div) divShown = true
          return <div key={m.id}>
            {day && <p className="tv-day"><span>{dayLabel(m.ts)}</span></p>}
            {div && <p className="tv-new-div"><span>{tx('novas')}</span></p>}
            <Msg m={m} prev={day || div ? null : prev} s={s} me={s.me} shelfBy={shelfBy} data={data} openDeck={openDeck} act={act} setReply={setReply} goTab={goTab} fresh={freshIds.has(m.id)} onCall={onCall2} touch={touch} />
          </div>
        })}
      </div>
      {below && <button type="button" className="tv-below" onClick={() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); setBelow(false) }}>↓ {tx('mensagens novas')}</button>}
      <Composer s={s} shelf={shelf} reply={reply} setReply={setReply} send={send} mention={mention} onPickMine={onPickMine} onCall={(c, m) => send({ m, call: c })} />
    </section>
  )
}

// ---------- o Hall da Fama ----------
function ResultForm({ s, onClose, onDone }) {
  useBackClose(true, onClose)
  const [ps, setPs] = useState(() => new Set([s.me.who])), [win, setWin] = useState(''), [name, setName] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const tog = w => setPs(x => { const n = new Set(x); if (n.has(w)) n.delete(w); else if (n.size < 4) n.add(w); return n })
  const go = async () => {
    setBusy(true); setErr('')
    try { await post('/api/taverna/result', { players: [...ps], win: win || null, name: name.trim() }); onDone() } catch (e) { setErr(e.message); setBusy(false) }
  }
  const sel = s.members.filter(m => ps.has(m.who))
  return <div className="modal-bg" onClick={onClose}><div className="modal tv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Registar um resultado')}>
    <div className="tv-modal-h"><h3>✍ {tx('Registar um resultado')}</h3><button type="button" className="link small" onClick={onClose}>{tx('fechar')}</button></div>
    <p className="small muted">{tx('Para os jogos fora deste Grimório (em papel, noutra app). As mesas e os torneios das salas daqui contam sozinhos.')}</p>
    <h4>{tx('Quem jogou')} <small className="muted">{tx('(2 a 4)')}</small></h4>
    <div className="tv-pick">{s.members.map(m => <button key={m.who} type="button" className={ps.has(m.who) ? 'on' : ''} aria-pressed={ps.has(m.who)} onClick={() => tog(m.who)}><Ava who={m.who} name={m.name} /> {m.name}</button>)}</div>
    <h4>{tx('Quem ganhou')}</h4>
    <div className="tv-pick">{sel.map(m => <button key={m.who} type="button" className={win === m.who ? 'on' : ''} aria-pressed={win === m.who} onClick={() => setWin(m.who)}>🏆 {m.name}</button>)}
      <button type="button" className={win === '' ? 'on' : ''} aria-pressed={win === ''} onClick={() => setWin('')}>🤝 {tx('Empate')}</button></div>
    <label className="on-field"><span>{tx('Nome do jogo (opcional)')}</span><input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder={tx('ex.: sexta à noite, em papel')} /></label>
    {err && <p className="small bad-t">{err}</p>}
    <div className="row-btns"><button className="primary" onClick={go} disabled={busy || ps.size < 2 || (win && !ps.has(win))}>{tx('Registar')}</button><button onClick={onClose}>{tx('Cancelar')}</button></div>
  </div></div>
}

function Fame({ s, frev }) {
  const [f, setF] = useState(null), [form, setForm] = useState(false), [err, setErr] = useState('')
  const load = () => j('/api/taverna/fame').then(setF).catch(e => setErr(e.message))
  useEffect(() => { load() }, [frev])
  if (!f) return <p className="muted">{err || tx('a carregar…')}</p>
  const top = f.table.filter(x => x.member).slice(0, 3), order = [top[1], top[0], top[2]]
  const del = async r => (await ask('amigo', { title: tx('Apagar este resultado?'), body: tx('Sai do Hall da Fama para todos.'), ok: tx('Apagar') })) && post('/api/taverna/unresult', { id: r.id }).then(load).catch(e => setErr(e.message))
  const add = <button type="button" className="primary on-big" onClick={() => setForm(true)}>＋ {tx('Registar um resultado')}</button>
  return (
    <div className="tv-fame">
      {err && <p className="small bad-t">{err}</p>}
      {!f.table.length ? <div className="card tv-empty"><span className="tv-empty-i" aria-hidden="true">🏆</span><b>{tx('O Hall da Fama ainda está vazio.')}</b>
        <p className="small muted">{tx('Joguem uma mesa ou um torneio nas salas daqui (separador Jogos) ou registem um jogo em papel: os pontos e os troféus aparecem aqui, para todos.')}</p>{add}</div> : <>
        <div className="tv-podium" aria-label={tx('Pódio')}>{order.map((x, k) => x ? <div key={x.who} className={`tv-plinth p${[2, 1, 3][k]} ${x.me ? 'me' : ''}`}>
          {[2, 1, 3][k] === 1 && <span className="tv-crown" aria-hidden="true">👑</span>}
          <Ava who={x.who} name={x.name} big />
          <b>{x.name}</b><small>{tx('{n} pts', { n: x.pts })}</small>
          <span className="tv-block"><i>{[2, 1, 3][k]}</i></span></div> : <div key={k} className="tv-plinth empty" />)}</div>
        {Object.keys(f.hl).length > 0 && <div className="tv-hl">
          {f.hl.hot && <div className="card tv-hlc hot"><span>🔥</span><b>{tx('Em forma')}</b><small>{tx('{n}: {k} vitórias seguidas', { n: f.hl.hot.name, k: f.hl.hot.n })}</small></div>}
          {f.hl.deck && <div className="card tv-hlc deck"><span>🃏</span><b>{tx('Deck de ouro')}</b><small>{tx('«{d}» de {n}: {k} vitórias', { d: f.hl.deck.deck, n: f.hl.deck.name, k: f.hl.deck.n })}</small></div>}
          {f.hl.rival && <div className="card tv-hlc rival"><span>⚔</span><b>{tx('A grande rivalidade')}</b><small>{f.hl.rival.an} <b>{f.hl.rival.aw}–{f.hl.rival.bw}</b> {f.hl.rival.bn} · {tx('{n} jogos', { n: f.hl.rival.g })}</small></div>}
        </div>}
        <section className="card tv-table">
          <header className="tv-sec-h"><h3>{tx('Classificação')}</h3>
            <details className="tv-how"><summary className="small muted">ⓘ {tx('como contam os pontos')}</summary>
              <p className="small muted">{tx('Vitória {w} · empate {d} · torneio: 1.º {a}, 2.º {b}, 3.º {c}. Contam as mesas e os torneios das salas deste Grimório jogados entre membros e os jogos registados à mão.', { w: f.pts.w, d: f.pts.d, a: f.pts.t1, b: f.pts.t2, c: f.pts.t3 })}</p></details>
            {add}</header>
          <div className="tv-rows" role="table" aria-label={tx('Classificação')}>
            <div className="tv-row th" role="row"><span>#</span><span>{tx('Jogador')}</span><span>{tx('Pts')}</span><span title={tx('vitórias · derrotas · empates')}>{tx('V-D-E')}</span><span>%</span><span>{tx('Troféus')}</span><span>{tx('Forma')}</span></div>
            {f.table.map((x, k) => <div key={x.who} role="row" className={`tv-row ${x.me ? 'me' : ''} ${x.member ? '' : 'gone'}`} style={{ '--i': k }}>
              <span className="tv-pos">{k + 1}</span>
              <span className="tv-who"><Ava who={x.who} name={x.name} /> <b>{x.name}</b></span>
              <span className="tv-pts">{x.pts}</span>
              <span>{x.w}-{x.l}-{x.d}</span>
              <span className="muted">{x.pct == null ? '—' : `${x.pct}%`}</span>
              <span className="tv-tro">{x.gold > 0 && <i>🥇{x.gold > 1 ? x.gold : ''}</i>}{x.silver > 0 && <i>🥈{x.silver > 1 ? x.silver : ''}</i>}{x.bronze > 0 && <i>🥉{x.bronze > 1 ? x.bronze : ''}</i>}</span>
              <span className="tv-form">{x.form.map((r, i) => <i key={i} className={r} title={FORM[r][1]}>{FORM[r][0]}</i>)}</span>
            </div>)}
          </div>
        </section>
        <section className="card tv-feed">
          <h3>{tx('Últimos resultados')}</h3>
          <ul>{f.feed.map(r => <li key={r.id}>
            <span className="tv-feed-i" aria-hidden="true">{RES_ICO[r.kind] || '🏆'}</span>
            <span className="tv-feed-t">{r.kind === 'torneio' && r.podium ? <><b>{r.name}</b> · {r.podium.map(p => <span key={p.who + p.place} className={`tv-place p${p.place}`}>{['', '🥇', '🥈', '🥉'][p.place]} {p.name}</span>)}</>
              : <><span>{r.win.length ? <b>{tx('{w} ganhou', { w: r.players.filter(p => r.win.includes(p.who)).map(p => p.name).join(' + ') })}</b> : <b>{tx('Empate')}</b>}{r.name && <span className="muted"> · {r.name}</span>}</span>
                <span className="tv-vs">{r.players.map(p => p.name + (p.deck ? ` (${p.deck})` : '')).join(' vs ')}</span></>}
              <small className="muted">{ago(r.ts)}{r.kind === 'manual' ? ` · ${tx('registado à mão')}` : ''}</small></span>
            {(s.me.host || (r.kind === 'manual' && r.by === s.me.who)) && <button type="button" className="link small" onClick={() => del(r)} aria-label={tx('Apagar este resultado')}>✕</button>}
          </li>)}</ul>
        </section>
      </>}
      {form && <ResultForm s={s} onClose={() => setForm(false)} onDone={() => { setForm(false); load() }} />}
    </div>
  )
}

// ---------- a prateleira (e a mesa 3D com as caixas) ----------
function Shelf({ s, shelf, data, openDeck, onPickMine, onMention, reload }) {
  const [view, setViewS] = useState(() => (ls('grimorio.taverna.prateleira') === '3d' ? '3d' : 'lista')), [err, setErr] = useState('')
  const setView = v => { setViewS(v); ls('grimorio.taverna.prateleira', v) }
  const on3d = useMemo(() => shelf.slice(0, 8), [shelf])
  const room = useMemo(() => ({ id: 'taverna', players: on3d.map(d => ({ by: d.by, ref: d.id, name: d.name, n: d.n, cover: d.cover, list: d.main, show: true, mine: d.who === s.me.who })) }), [on3d, s.me.who])
  const drop = async d => (await ask('amigo', { title: tx('Tirar «{n}» da prateleira?', { n: d.name }), ok: tx('Tirar') })) && post('/api/taverna/unshare', { id: d.id }).then(reload).catch(e => setErr(e.message))
  return (
    <div className="tv-shelf">
      <div className="tv-bar">
        <div className="seg" role="tablist" aria-label={tx('Ver a prateleira')}>
          <button role="tab" aria-selected={view === 'lista'} className={view === 'lista' ? 'on' : ''} onClick={() => setView('lista')}>▦ {tx('Decks')} <b>{shelf.length}</b></button>
          <button role="tab" aria-selected={view === '3d'} className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>🎲 {tx('Mesa 3D')}</button>
        </div>
        <button type="button" className="primary on-big" onClick={onPickMine}>＋ {tx('Pôr um deck meu')}</button>
      </div>
      {err && <p className="small bad-t">{err}</p>}
      {!shelf.length ? <div className="card tv-empty"><span className="tv-empty-i" aria-hidden="true">📚</span><b>{tx('A prateleira está vazia.')}</b>
        <p className="small muted">{tx('Põe lá um deck teu: os amigos veem a lista, copiam-no para os decks deles e atiram a caixa na mesa 3D.')}</p></div>
        : view === '3d' ? <div className="tv-3d">
          <p className="small muted">{tx('As caixas dos {n} decks mais recentes da prateleira, iguais para todos os que estão aqui agora: agarra, atira e abre-as.', { n: on3d.length })}</p>
          <Lobby3D r={room} data={data} act={() => {}} live="/api/taverna/live" free meName={s.me.name} /></div>
          : <div className="tv-grid">{shelf.map((d, k) => <DeckCard key={d.id} d={d} data={data} onOpen={openDeck}>
            <span className="tv-deck-act" style={{ '--i': k }}>
              <button type="button" className="small" onClick={() => onMention(d)}>💬 {tx('Mencionar')}</button>
              {(d.who === s.me.who || s.me.host) && <button type="button" className="link small" onClick={() => drop(d)}>{tx('tirar')}</button>}
              <small className="muted">{ago(d.ts)}</small>
            </span></DeckCard>)}</div>}
    </div>
  )
}

// ---------- jogos: abrir uma mesa (quem aloja) ou propor (os outros) e as salas daqui ----------
function Games({ s, data, deckId, guest, openTable, propose, newRoom, setNewRoom }) {
  const [net, share] = useNet(s.me.host && !guest)
  const remote = remoteOn()
  const tour = () => { ls('grimorio.online.vista', 'criar'); ls('grimorio.online.tipo', 'livretorneio'); window.dispatchEvent(new CustomEvent('grimorio:col', { detail: 'online' })) }
  const openTour = id => {
    if (remote) return  // na app de um amigo: os torneios abrem-se na página de lá (o botão da barra de cima)
    ls('grimorio.torneio', id); ls('grimorio.online.vista', 'ver'); window.dispatchEvent(new CustomEvent('grimorio:col', { detail: 'online' }))
  }
  return (
    <div className="tv-games">
      {s.me.host && !guest ? <section className="card tv-arrange">
        <header className="tv-sec-h"><h3>🎲 {tx('Combinar um jogo')}</h3></header>
        <div className="tv-arr-opts">
          <button type="button" className={`tv-arr ${newRoom ? 'on' : ''}`} onClick={() => setNewRoom(v => !v)} aria-expanded={!!newRoom}><span>🃏</span><b>{tx('Abrir uma mesa')}</b><small>{tx('Livre ou com as regras do Forge, 2 a 4 jogadores. Os membros sentam-se aqui em baixo.')}</small></button>
          <button type="button" className="tv-arr" onClick={tour}><span>🏆</span><b>{tx('Torneio entre vocês')}</b><small>{tx('Abre o Online › Criar sala com o torneio de mesa livre escolhido.')}</small></button>
        </div>
        {newRoom && <NewFreeRoom data={data} deckId={deckId} onRoom={() => setNewRoom(false)} />}
      </section> : <section className="card tv-arrange">
        <header className="tv-sec-h"><h3>🎲 {tx('Combinar um jogo')}</h3></header>
        <p className="small muted">{tx('Quem aloja a Taverna abre as salas; tu propões e os outros dizem se alinham.')}</p>
        <div className="row-btns">{Object.entries(KIND).map(([k, [i, l]]) => <button key={k} type="button" onClick={() => propose({ kind: k })}>{i} {tx('Propor: {k}', { k: l })}</button>)}</div>
      </section>}
      <h4 className="on-sec">{tx('Salas abertas neste Grimório')}</h4>
      <div className="on-view tv-rooms"><Rooms data={data} guest={guest || !s.me.host} open={openTour} openTable={openTable} net={net} share={share} noCta /></div>
    </div>
  )
}

// ---------- convidar (quem aloja) ----------
function InviteModal({ s, onClose, reload }) {
  useBackClose(true, onClose)
  const [net, share] = useNet(true), [err, setErr] = useState(''), [busy, setBusy] = useState('')
  const add = async f => { setBusy(f.id); try { await post('/api/taverna/add', { id: f.id }); reload() } catch (e) { setErr(e.message) } finally { setBusy('') } }
  const fresh = async () => (await ask('amigo', { title: tx('Fazer um link novo?'), body: tx('O link de agora deixa de entrar. Quem já é membro fica.'), ok: tx('Fazer um link novo') })) && post('/api/taverna/link').then(reload).catch(e => setErr(e.message))
  return <div className="modal-bg" onClick={onClose}><div className="modal tv-modal wide" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Convidar para a Taverna')}>
    <div className="tv-modal-h"><h3>🍺 {tx('Convidar para a Taverna')}</h3><button type="button" className="link small" onClick={onClose}>{tx('fechar')}</button></div>
    <Invite r={{ link: s.taverna.link, name: s.taverna.name }} net={net} share={share} title={tx('O link da Taverna')} label={tx('Link da Taverna')} note={tx('Quem abrir o link entra com um nome; quem tem a app Grimório cola-o em Coliseu › Taverna › «Entrar com um link» e entra com o perfil e os decks de lá.')} />
    <p className="row-btns small"><button type="button" className="link small" onClick={fresh}>↻ {tx('fazer um link novo')}</button><span className="muted">{tx('(o antigo deixa de entrar)')}</span></p>
    {s.friends?.length > 0 && <><h4>🤝 {tx('Amigos que já tens')}</h4>
      <p className="small muted">{tx('Já têm um convite teu: entram na Taverna com um toque, sem precisarem do link.')}</p>
      <div className="tv-pick">{s.friends.map(f => <button key={f.id} type="button" onClick={() => add(f)} disabled={busy === f.id}><Ava who={`guest:${f.id}`} name={f.name} /> ＋ {f.name}</button>)}</div></>}
    {err && <p className="small bad-t">{err}</p>}
  </div></div>
}

function EditModal({ s, onClose, reload }) {
  useBackClose(true, onClose)
  const [name, setName] = useState(s.taverna.name), [motto, setMotto] = useState(s.taverna.motto || ''), [err, setErr] = useState('')
  const go = async () => { try { await post('/api/taverna/edit', { name, motto }); reload(); onClose() } catch (e) { setErr(e.message) } }
  return <div className="modal-bg" onClick={onClose}><div className="modal tv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Mudar a Taverna')}>
    <div className="tv-modal-h"><h3>✎ {tx('Mudar a Taverna')}</h3><button type="button" className="link small" onClick={onClose}>{tx('fechar')}</button></div>
    <label className="on-field"><span>{tx('Nome')}</span><input value={name} onChange={e => setName(e.target.value)} maxLength={40} /></label>
    <label className="on-field"><span>{tx('Lema (opcional)')}</span><input value={motto} onChange={e => setMotto(e.target.value)} maxLength={120} placeholder={tx('ex.: Sextas à noite, Commander e cerveja')} /></label>
    {err && <p className="small bad-t">{err}</p>}
    <div className="row-btns"><button className="primary" onClick={go} disabled={!name.trim()}>{tx('Guardar')}</button><button onClick={onClose}>{tx('Cancelar')}</button></div>
  </div></div>
}

// ---------- entrar na Taverna de um amigo (outro Grimório) com o link ----------
const TLINK = /^https?:\/\/[^/\s]+\/taverna\/[\w-]{8,40}/
const probe = room => fetch(`${room.base}/api/guest/me`, { headers: { Authorization: `Bearer ${room.token}` }, credentials: 'omit', cache: 'no-store' })
  .then(r => (r.ok ? r.json() : null)).then(m => m?.api === API && m).catch(() => null)
export function JoinTaverna({ link = '', onClose, onRemote }) {
  useBackClose(true, onClose)
  const [url, setUrl] = useState(link), [peek, setPeek] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const u = url.trim(), ok = TLINK.test(u)
  useEffect(() => {
    setPeek(null); setErr('')
    if (!ok) return
    let off = false
    post('/api/rooms/remote', { url: u, dry: true }).then(p => { if (!off) { if (p.erro || !p.info?.kind) setErr(p.erro || tx('Este link já não é válido.')); else setPeek(p) } }).catch(e => !off && setErr(e.message))
    return () => { off = true }
  }, [u, ok])
  const go = async () => {
    setBusy(true); setErr('')
    try {
      const r = await post('/api/rooms/remote', { url: u, decks: [] })
      const token = r.go.match(/\/convite\/([\w-]+)/)?.[1], room = { base: r.base, token, name: peek.info?.name || '', kind: 'taverna', ...(peek.info?.hid && { hid: peek.info.hid }) }
      if (await probe(room)) { saveTaverna(room); return onRemote(room) }
      window.location.href = hostPage(r.base, token)
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return <div className="modal-bg" onClick={onClose}><div className="modal tv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Entrar com um link')}>
    <div className="tv-modal-h"><h3>🔗 {tx('Entrar na Taverna de um amigo')}</h3><button type="button" className="link small" onClick={onClose}>{tx('fechar')}</button></div>
    <p className="small muted">{tx('Cola o link que o teu amigo te mandou (…/taverna/…). A Taverna dele abre-se aqui, com o teu perfil e os teus decks.')}</p>
    <input className="fr-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/taverna/…" aria-label={tx('Link da Taverna')} autoFocus={!link} />
    {u && !ok && <p className="small bad-t">{tx('Isto não parece um link de uma Taverna (…/taverna/…).')}</p>}
    {ok && !peek && !err && <p className="small muted">{tx('A ver a Taverna…')}</p>}
    {peek && <p className="fr-host"><b>🍺 {peek.info.name}</b> <span className="small muted">{tx('no Grimório de')} {hostOf(peek.base)}</span></p>}
    {err && <p className="small bad-t">{err}</p>}
    <div className="row-btns"><button className="primary" onClick={go} disabled={!peek || busy}>{busy ? tx('A entrar…') : `🍺 ${tx('Entrar na Taverna')}`}</button><button onClick={onClose}>{tx('Cancelar')}</button></div>
  </div></div>
}

function FriendTaverns({ onRemote, onJoin }) {
  const [list, setList] = useState(tavernas)
  if (!onRemote) return null
  return <div className="tv-far">
    {list.map(x => <span key={x.base + x.token} className="tv-far-c"><button type="button" onClick={() => onRemote(x)}>🍺 <b>{x.name || hostOf(x.base)}</b> <small className="muted">{hostOf(x.base)}</small></button>
      <button type="button" className="link small" onClick={() => { dropTaverna(x); setList(tavernas()) }} aria-label={tx('Esquecer')} title={tx('Esquecer')}>✕</button></span>)}
    <button type="button" className="on-btn on-big" onClick={onJoin}>🔗 {tx('Entrar com um link')}</button>
  </div>
}

// ---------- a primeira vez: abrir a Taverna (quem aloja) ou entrar na de um amigo ----------
function Welcome({ s, guest, onCreate, onJoin, onRemote }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const go = async () => { setBusy(true); setErr(''); try { await onCreate(name.trim()) } catch (e) { setErr(e.message); setBusy(false) } }
  if (guest || remoteOn()) {
    return <div className="tv-welcome card"><span className="tv-mug" aria-hidden="true"><Icon n="taverna" /></span>
      <h2>{s.exists ? s.name : tx('A Taverna')}</h2>
      <p>{!s.exists ? tx('Quem te convidou ainda não abriu uma Taverna. Quando abrir, aparece aqui.')
        : s.kicked ? tx('Quem aloja tirou-te desta Taverna.') : tx('Esta Taverna é só para membros: pede o link a {n}.', { n: s.hostName })}</p></div>
  }
  return (
    <div className="tv-welcome card">
      <span className="tv-mug" aria-hidden="true"><Icon n="taverna" /></span>
      <h2>{tx('A Taverna')}</h2>
      <p className="tv-lede">{tx('O sítio dos teus amigos no Grimório: quem está ligado, a conversa, os decks partilhados, os jogos combinados e um Hall da Fama só vosso.')}</p>
      <ul className="tv-feats">
        <li><span>💬</span>{tx('Conversa com @menções, #decks e reações')}</li>
        <li><span>📚</span>{tx('Prateleira de decks: ver, copiar e atirar as caixas em 3D')}</li>
        <li><span>🎲</span>{tx('Combinar mesas e torneios entre vocês')}</li>
        <li><span>🏆</span>{tx('Hall da Fama com pontos, troféus e rivalidades')}</li>
      </ul>
      <div className="tv-choose">
        <div className="tv-ch">
          <b>🍺 {tx('Cria a tua Taverna')}</b>
          <small className="muted">{tx('Fica neste Grimório; os amigos entram por um link.')}</small>
          <div className="row-btns"><input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={tx('Nome (ex.: Taverna do Dragão)')} aria-label={tx('Nome da Taverna')} onKeyDown={e => e.key === 'Enter' && go()} />
            <button type="button" className="primary on-big" onClick={go} disabled={busy}>{busy ? tx('A abrir…') : tx('Abrir a Taverna')}</button></div>
          {err && <p className="small bad-t">{err}</p>}
        </div>
        <div className="tv-ch">
          <b>🔗 {tx('Entra com um link')}</b>
          <small className="muted">{tx('Um amigo já tem uma Taverna? Cola aqui o link dele.')}</small>
          <FriendTaverns onRemote={onRemote} onJoin={onJoin} />
        </div>
      </div>
    </div>
  )
}

// ---------- a vista ----------
const TABS = [['conversa', '💬', tx('Conversa')], ['jogos', '🎲', tx('Jogos')], ['prateleira', '📚', tx('Prateleira')], ['fama', '🏆', tx('Hall da Fama')]]
export default function TavernaView({ data, guest, deckId, onRemote }) {
  const [s, setS] = useState(null), [msgs, setMsgs] = useState([]), [err, setErr] = useState('')
  const [tab, setTabS] = useState(() => (TABS.some(t => t[0] === ls('grimorio.taverna.tab')) ? ls('grimorio.taverna.tab') : 'conversa'))
  const setTab = t => {  // no telemóvel o separador vai para o topo: a conversa enche o ecrã com a caixa de escrever à vista
    setTabS(t); ls('grimorio.taverna.tab', t)
    if (window.innerWidth < 640) requestAnimationFrame(() => document.querySelector('.tv-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const [more, setMore] = useState(false), [shelf, setShelf] = useState([]), [deck, setDeck] = useState(null), [pickMine, setPickMine] = useState(false), [mention, setMention] = useState(null)
  const [invite, setInvite] = useState(false), [edit, setEdit] = useState(false), [join, setJoin] = useState(false), [newRoom, setNewRoom] = useState(false), [showMem, setShowMem] = useState(false)
  const [table, setTableS] = useState(() => { try { return sessionStorage.getItem('grimorio.mesalivre') } catch { return null } })
  const setTable = t => { setTableS(t); try { if (t) sessionStorage.setItem('grimorio.mesalivre', t); else sessionStorage.removeItem('grimorio.mesalivre') } catch { /* sem armazenamento */ } }
  const rev = useRef(0), srev = useRef(-1), readFrom = useRef(null), seen = useRef(null), [freshIds, setFresh] = useState(() => new Set())
  const touch = useMemo(() => !!window.matchMedia?.('(hover: none)').matches, [])
  const loadShelf = () => j('/api/taverna/shelf').then(setShelf).catch(() => {})
  const load = async () => {
    try {
      const q = new URLSearchParams(rev.current ? { since: rev.current } : {})
      if (playing()) q.set('p', '1')
      const d = await j(`/api/taverna${q.toString() ? `?${q}` : ''}`)
      if (!rev.current && d.member) setMore(!!d.more)
      if (!d.member) { rev.current = 0; setS(d); return }
      if (readFrom.current == null) readFrom.current = d.read
      const inc = d.msgs || []
      if (seen.current) { const nu = inc.filter(m => !seen.current.has(m.id)).map(m => m.id); if (nu.length) setFresh(f => new Set([...f, ...nu].slice(-40))) }
      seen.current = seen.current || new Set()
      inc.forEach(m => seen.current.add(m.id))
      setMsgs(old => {
        const by = new Map((rev.current ? old : []).map(m => [m.id, m]))
        for (const m of inc) if (m.deleted) by.delete(m.id); else by.set(m.id, m)
        return [...by.values()].sort((a, b) => a.id - b.id)
      })
      rev.current = d.rev
      if (d.srev !== srev.current) { srev.current = d.srev; loadShelf() }
      setS(d); setErr('')
      if (!remoteOn()) setBadge({ unread: d.unread, at: d.at })
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => {
    load()
    let t = 0
    const tick = () => { t = setTimeout(async () => { await load(); tick() }, document.visibilityState === 'visible' ? 2500 : 10000) }
    tick()
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // lidas: com a conversa à vista, até à última
  const lastId = msgs[msgs.length - 1]?.id
  useEffect(() => {
    if (tab !== 'conversa' || !s?.member || !lastId || lastId <= (s.read || 0) || document.visibilityState !== 'visible') return
    const t = setTimeout(() => post('/api/taverna/read', { id: lastId }).then(c => { setS(x => x && { ...x, ...c, read: lastId }); if (!remoteOn()) setBadge(c) }).catch(() => {}), 600)
    return () => clearTimeout(t)
  }, [tab, lastId, s?.read, s?.member])
  const shelfBy = useMemo(() => Object.fromEntries(shelf.map(d => [d.id, d])), [shelf])
  const act = (a, b) => post(`/api/taverna/${a}`, b).then(load).catch(e => setErr(e.message))
  const send = async b => { try { await post('/api/taverna/say', b); await load(); return true } catch (e) { setErr(e.message); return false } }
  const share = async d => {
    const r = await post('/api/taverna/share', { deck: { name: d.name, format: d.format, main: d.main, side: d.side, commanders: d.commanders, cover: d.cover } })
    setPickMine(false); await loadShelf(); await load()
    return r
  }
  const create = async name => { const d = await post('/api/taverna', { name, tpl: tx('Taverna de {n}') }); rev.current = 0; setS(d); load() }
  const kick = async m => (await ask('amigo', { title: tx('Tirar {n} da Taverna?', { n: m.name }), body: tx('Deixa de ver a Taverna e o link já não o deixa voltar (podes voltar a pô-lo em «Convidar»). Os decks e os resultados dele ficam.'), ok: tx('Tirar') })) && act('kick', { who: m.who })
  const leave = async () => (await ask('amigo', { title: tx('Sair da Taverna?'), body: tx('Podes voltar pelo link.'), ok: tx('Sair') })) && act('leave')
  const doMention = x => { setMention({ ...x, n: Date.now() }); setTab('conversa') }
  const fromCall = c => { if (c.kind === 'torneio') { ls('grimorio.online.vista', 'criar'); ls('grimorio.online.tipo', 'livretorneio'); window.dispatchEvent(new CustomEvent('grimorio:col', { detail: 'online' })); return } setNewRoom(true); setTab('jogos') }

  if (table) return <div className="view play fp-view">{String(table).startsWith('fp:') ? <ForgeTable key={table} sid={table.slice(3)} data={data} onClose={() => setTable(null)} /> : <FreeTable key={table} id={table} data={data} onClose={() => setTable(null)} />}</div>
  if (!s) return <div className="view tv"><p className="muted">{err || tx('a carregar…')}</p></div>
  if (!s.member) return <div className="view tv">
    <Welcome s={s} guest={guest} onCreate={create} onJoin={() => setJoin(true)} onRemote={onRemote} />
    {join && <JoinTaverna onClose={() => setJoin(false)} onRemote={r => { setJoin(false); onRemote(r) }} />}
  </div>
  const on = s.members.filter(m => m.online)
  const unread = tab !== 'conversa' ? s.unread : 0
  return (
    <div className="view tv">
      <header className="tv-hero">
        <span className="tv-mug sm" aria-hidden="true"><Icon n="taverna" /></span>
        <div className="tv-hero-t">
          <h2>{s.taverna.name}{s.me.host && <button type="button" className="link small tv-edit" onClick={() => setEdit(true)} aria-label={tx('Mudar o nome e o lema')} title={tx('Mudar o nome e o lema')}>✎</button>}</h2>
          {s.taverna.motto && <p className="tv-motto">{s.taverna.motto}</p>}
          <button type="button" className="tv-stack" onClick={() => setShowMem(v => !v)} aria-expanded={showMem} title={tx('Membros')}>
            <span className="tv-avs">{on.slice(0, 6).map(m => <Ava key={m.who} who={m.who} name={m.name} st={stOf(m)} />)}</span>
            <span className="small"><i className="tv-dot" /> {on.length > 1 ? tx('{n} ligados agora', { n: on.length }) : tx('Só tu, por agora')} <span className="muted">· {tx('{n} membros', { n: s.members.length })}</span> <span className="tv-stack-c" aria-hidden="true">{showMem ? '▴' : '▾'}</span></span>
          </button>
        </div>
        <div className="tv-hero-a">
          {s.me.host && !guest && <button type="button" className="primary on-big" onClick={() => setInvite(true)}>＋ {tx('Convidar')}</button>}
          <button type="button" className="on-big on-btn" onClick={() => setTab('jogos')}>🎲 {tx('Combinar jogo')}</button>
          {!s.me.host && <button type="button" className="link small" onClick={leave}>{tx('sair da Taverna')}</button>}
        </div>
      </header>
      {s.me.host && !guest && onRemote && tavernas().length > 0 && <div className="tv-farbar"><span className="small muted">{tx('Tavernas de amigos:')}</span><FriendTaverns onRemote={onRemote} onJoin={() => setJoin(true)} /></div>}
      <div className="tv-body">
        <main className="tv-main">
          <nav className="seg tv-tabs" role="tablist" aria-label={tx('Taverna')}>{TABS.map(([k, i, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span aria-hidden="true">{i}</span>{l}
              {k === 'conversa' && unread > 0 && <b className={`tv-badge ${s.at ? 'at' : ''}`}>{s.at ? '@' : ''}{unread}</b>}
              {k === 'prateleira' && shelf.length > 0 && <b>{shelf.length}</b>}</button>))}</nav>
          {err && <p className="small bad-t">{err}</p>}
          <div className="tv-pane" key={tab}>
            {tab === 'conversa' && <Chat s={s} msgs={msgs} more={more} loadOlder={async () => { const d = await j(`/api/taverna?before=${msgs[0]?.id || 0}`).catch(() => null); if (d?.msgs) { setMsgs(o => [...d.msgs.filter(m => !o.some(x => x.id === m.id)), ...o]); setMore(!!d.more) } }}
              shelf={shelf} shelfBy={shelfBy} data={data} act={act} send={send} openDeck={d => d && setDeck(d)} goTab={setTab} mention={mention} onPickMine={() => setPickMine(true)} onCall={fromCall} readFrom={readFrom.current} freshIds={freshIds} touch={touch} />}
            {tab === 'jogos' && <Games s={s} data={data} deckId={deckId} guest={guest || remoteOn()} openTable={setTable} propose={async c => { if (await send({ m: '', call: c })) setTab('conversa') }} newRoom={newRoom} setNewRoom={setNewRoom} />}
            {tab === 'prateleira' && <Shelf s={s} shelf={shelf} data={data} openDeck={setDeck} onPickMine={() => setPickMine(true)} onMention={d => doMention({ deck: d })} reload={() => { loadShelf(); load() }} />}
            {tab === 'fama' && <Fame s={s} frev={s.frev} />}
          </div>
        </main>
        <aside className={`tv-side ${showMem ? 'open' : ''}`}><Members s={s} onMention={m => { setShowMem(false); doMention({ name: m.name }) }} onKick={kick} /></aside>
      </div>
      {deck && <ShelfDeck d={deck} data={data} guest={guest} onClose={() => setDeck(null)} onTook={loadShelf} />}
      {pickMine && <PickMine data={data} onClose={() => setPickMine(false)} onPick={async d => { try { const r = await share(d); if (tab === 'conversa' && !r.updated) doMention({ deck: { ...d, id: r.id } }) } catch (e) { setErr(e.message); setPickMine(false) } }} />}
      {invite && <InviteModal s={s} onClose={() => setInvite(false)} reload={load} />}
      {edit && <EditModal s={s} onClose={() => setEdit(false)} reload={load} />}
      {join && <JoinTaverna onClose={() => setJoin(false)} onRemote={r => { setJoin(false); onRemote(r) }} />}
    </div>
  )
}

// ---------- a Taverna de um amigo, aqui (no Grimório de quem aloja, com os teus ecrãs e os teus decks) ----------
export function RemoteTaverna({ data, room, onClose }) {
  const [on, setOn] = useState(false)
  useEffect(() => { setRemote(room); setOn(true); return () => setRemote(null) }, [room])  // antes dos pedidos dos filhos
  return (
    <div className="app fr-remote tv-remote">
      <div className="fr-bar">
        <button className="link" onClick={onClose}>← {tx('O meu Grimório')}</button>
        <span>🍺 {tx('Taverna de um amigo')} · <b>{room.name || hostOf(room.base)}</b> <small className="muted">{hostOf(room.base)}</small></span>
        <button className="link small" onClick={() => { window.location.href = hostPage(room.base, room.token) }} title={tx('Torneios e jogos do Forge abrem-se na página de lá')}>{tx('abrir a página de lá')}</button>
      </div>
      {on && <div className="area"><TavernaView data={data} guest /></div>}
    </div>
  )
}
