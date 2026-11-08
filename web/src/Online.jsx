// Coliseu › Online: salas onde entram amigos por link. Duas ações à cabeça («Criar sala» e «Entrar com um link»), as salas
// (cada uma com o convite, os lugares, quem está pronto, o lobby 3D e a conversa), a partilha pela internet num painel
// próprio (túnel gratuito, endereço próprio, rede de casa) e, ao lado, o «Ao vivo» e as apostas dos torneios das salas.
// Os torneios com bots criam-se com o formulário do Torneio (Create); a mesa livre e a mesa a solo vêm de FreeRooms.jsx.
import './online.css'
import { useEffect, useRef, useState } from 'react'
import { FORMAT } from './formats.js'
import { IL } from './icons.jsx'
import ForgeTable from './ForgePlay.jsx'
import FreeTable from './FreeTable.jsx'
import Friends, { QR } from './Friends.jsx'
import Lobby3D from './Lobby3D.jsx'  // o three.js só carrega com uma sala aberta (import dinâmico lá dentro)
import { NewSolo, NewFreeRoom, Seats, JoinPanel, LendPanel } from './FreeRooms.jsx'
import { Create, Live, BetsTab, OwnCtx, TypeIco, TYPES, PlaysToggle } from './Tournament.jsx'
import { DIFF_INFO } from './difficulty.js'
import { ask } from './confirm.jsx'
import { useBackClose } from './backnav.js'
import { tx } from './i18n.js'
import { play } from './sfx.js'

const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch { return null } }
async function j(url, opts) {
  const r = await fetch(url, opts)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const hlOn = () => ls('grimorio.torneio.destacar') === '1'  // «Destacar os meus decks» (Torneio)

// os modos online: quem joga e que regras há (a explicação comprida aparece por baixo do modo escolhido)
const MODES = {
  livre: [tx('Mesa livre'), tx('Quem joga: só vocês, 2 a 4 amigos, sem bots. Cada um mexe nas suas cartas, como numa mesa a sério.'), tx('Regras: nenhuma automática. Qualquer formato, Commander incluído.')],
  livretorneio: [tx('Torneio de mesa livre'), tx('Quem joga: vocês, sem bots, cada um com um ou vários decks seus. Cada partida abre uma mesa livre entre os dois.'), tx('Regras: nenhuma automática; desistir = perder, o resultado combina-se na mesa ou marca-o quem aloja. Conta como torneio de amigos.')],
  misto: [tx('Torneio misto'), tx('Quem joga: pessoas e bots do Forge no mesmo torneio. Cada deck é jogado pelo dono ou pelo bot, à escolha de cada um.'), tx('Regras: cada partida usa as regras do Forge quando há um bot, e a mesa livre entre pessoas.')],
  jogo: [tx('Jogo com bots'), tx('Quem joga: os bots do Forge, com os vossos decks. Os amigos veem ao vivo e apostam.'), tx('Regras: todas, aplicadas pelo Forge.')],
  torneio: [tx('Torneio com bots'), tx('Quem joga: os bots do Forge (eliminação, suíço, liga, grupos…). Os amigos veem e apostam.'), tx('Regras: todas, aplicadas pelo Forge.')],
  solo: [tx('Mesa livre a solo'), tx('Quem joga: só tu, para testar um deck (goldfish). Sem sala nem link.'), tx('Regras: nenhuma automática. Novo turno, recomeçar e a vida de um adversário imaginário.')],
}
const TAG = {
  livre: tx('2 a 4 amigos à mesma mesa, ao vivo — livre ou com as regras do Forge'),
  livretorneio: tx('Um torneio entre vocês; cada partida abre uma mesa livre'),
  misto: tx('Cada deck joga-o o dono ou um bot do Forge'),
  jogo: tx('Os bots jogam os vossos decks; vocês veem e apostam'),
  torneio: tx('Eliminação, suíço, liga… jogados pelos bots'),
  solo: tx('Testa um deck sozinho, sem sala nem link'),
}
const GROUPS = [[tx('Com amigos'), ['livre', 'livretorneio', 'misto']], [tx('Com os bots do Forge'), ['jogo', 'torneio']], [tx('Sozinho'), ['solo']]]
const ICO = { livre: 'livre', livretorneio: 'elim', misto: 'elim', jogo: 'jogo', torneio: 'elim', solo: 'livre' }
// que modo é uma sala (o ícone, o nome e a explicação)
const modeOf = r => (r.type === 'livre' ? (r.strict ? ['⚖', tx('Mesa estrita'), MODES.livre] : ['🃏', tx('Mesa livre'), MODES.livre])
  : r.free ? ['🃏', MODES.livretorneio[0], MODES.livretorneio] : r.misto ? ['🎮', MODES.misto[0], MODES.misto]
    : r.type === 'jogo' ? ['🤖', MODES.jogo[0], MODES.jogo] : ['🤖', MODES.torneio[0], MODES.torneio])

// ---------- o endereço público: domínio próprio (GRIMORIO_PUBLIC_URL / Definições) ou o túnel gratuito (share.py) ----------
function useNet(on = true) {
  const [net, setNet] = useState(null)
  const load = () => Promise.all([j('/api/friends'), j('/api/share')]).then(([f, s]) => setNet({ public: f.public, lan: f.lan, share: s })).catch(() => {})
  useEffect(() => { if (!on) return; load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [on])
  const share = async a => { try { await post(`/api/share/${a}`) } catch { /* o estado mostra o erro */ } finally { load() } }
  return [net, share]
}
const netState = net => (!net ? null : net.public ? 'up' : net.share?.running ? 'opening' : 'off')

async function copyText(url) {
  try { await navigator.clipboard.writeText(url); return true } catch { window.prompt(tx('Copia o link:'), url); return false }
}

function ShareChip({ net, open, onClick }) {
  const st = netState(net)
  if (!st) return null
  return <button type="button" className={`on-netchip ${st}`} onClick={onClick} aria-expanded={open} title={tx('Partilhar pela internet')}>
    <i aria-hidden="true" />{st === 'up' ? tx('Na internet') : st === 'opening' ? tx('a abrir o túnel…') : net.lan ? tx('Só em casa') : tx('Só neste computador')} <span aria-hidden="true">{open ? '▴' : '▾'}</span></button>
}

function SharePanel({ net, share, onClose }) {
  const [busy, setBusy] = useState(false), [copied, setCopied] = useState(''), [friends, setFriends] = useState(false)
  const st = netState(net), tunnel = net.share?.running, own = net.public && net.public !== net.share?.url
  const sh = async a => { setBusy(true); await share(a); setBusy(false) }
  const cp = async (u, k) => { if (await copyText(u)) { setCopied(k); setTimeout(() => setCopied(''), 1500) } }
  return (
    <section className={`card on-share ${st}`} aria-label={tx('Partilhar pela internet')}>
      <div className="on-share-h"><h3>🌍 {tx('Partilhar pela internet')}</h3><button type="button" className="link small" onClick={onClose}>{tx('fechar')}</button></div>
      <div className="on-share-st">
        {st === 'up' ? <><b className="ok-t">● {tx('Online em')}</b> <code>{net.public}</code> <button type="button" className="small" onClick={() => cp(net.public, 'pub')}>{copied === 'pub' ? tx('copiado ✓') : tx('copiar')}</button></>
          : st === 'opening' ? <b>⏳ {tx('a abrir o túnel…')}</b>
            : <span>📴 {tx('Este Grimório ainda não está na internet: os links das salas só funcionam depois de o abrires.')}</span>}
      </div>
      <div className="row-btns">
        {!own && (tunnel ? <button type="button" onClick={() => sh('stop')} disabled={busy}>{tx('Fechar à internet')}</button>
          : <button type="button" className="primary on-big" onClick={() => sh('start')} disabled={busy}>🌍 {tx('Abrir à internet')}</button>)}
        <button type="button" onClick={() => setFriends(true)}>🤝 {tx('Convites pessoais e endereço próprio')}</button>
      </div>
      {net.share?.err && <p className="small bad-t">{tx(net.share.err)}</p>}
      {!own && <p className="small muted">{tx('Túnel gratuito da Cloudflare: dá um endereço público sem abrir portas no router. Sem convite ninguém vê nada.')}{net.share?.url && !net.share.fixed ? ` ${tx('O túnel gratuito muda de endereço sempre que a partilha volta a abrir: basta reenviar o convite — a app do teu amigo reconhece este Grimório e atualiza a sala guardada.')}` : ''}</p>}
      {net.lan && <p className="small on-share-lan">🏠 {tx('Em casa (mesma rede)')}: <code>{net.lan}</code> <button type="button" className="link small" onClick={() => cp(net.lan, 'lan')}>{copied === 'lan' ? tx('copiado ✓') : tx('copiar')}</button></p>}
      {friends && <FriendsModal onClose={() => setFriends(false)} />}
    </section>
  )
}

function FriendsModal({ onClose }) {
  useBackClose(true, onClose)
  return <div className="modal-bg" onClick={onClose}><div className="modal on-friends" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Amigos')}>
    <div className="on-share-h"><h3>🤝 {tx('Amigos')}</h3><button type="button" className="link small" onClick={onClose}>{tx('fechar')}</button></div><Friends /></div></div>
}

// ---------- a vista ----------
export default function OnlineView({ data, fmt, deckId, guest }) {
  const VK = 'grimorio.online.vista', TABS = ['criar', 'salas', 'ver', 'apostas']
  const [view, setViewS] = useState(() => { const v = TABS.includes(ls(VK)) ? ls(VK) : 'salas'; return guest && v === 'criar' ? 'salas' : v })
  const setView = v => { setViewS(v); ls(VK, v) }
  const [tid, setTid] = useState(null), [slot, setSlot] = useState(null), [list, setList] = useState([])
  const [fresh, setFresh] = useState(null)  // a sala acabada de abrir: fica em destaque
  const loadList = () => j('/api/tournaments').then(l => { setList(l); return l }).catch(() => [])
  useEffect(() => {  // ao entrar: volta ao torneio que estava aberto, ou ao que está a decorrer
    loadList().then(l => {
      const last = ls('grimorio.torneio'), on = l.find(x => x.id === last) || l.find(x => x.status === 'running')
      if (on) { setTid(on.id); if (ls(VK) === 'ver' || !ls(VK)) setView('ver') } else if (view === 'ver') setView('salas')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const open = id => { setTid(id); ls('grimorio.torneio', id); setView('ver') }
  const [table, setTableS] = useState(() => { try { return sessionStorage.getItem('grimorio.mesalivre') } catch { return null } })  // mesa livre aberta (volta a ela com F5)
  const setTable = t => { setTableS(t); try { if (t) sessionStorage.setItem('grimorio.mesalivre', t); else sessionStorage.removeItem('grimorio.mesalivre') } catch { /* sem armazenamento */ } }
  useEffect(() => {  // no Ao vivo: os outros torneios a decorrer ao lado das apostas
    if (view !== 'ver') return
    const t = setInterval(loadList, 15000)
    return () => clearInterval(t)
  }, [view])
  const [own, setOwn] = useState({})  // de quem é cada deck (as etiquetas do Ao vivo); um convidado vê os dele como «meus»
  useEffect(() => { j('/api/decks').then(ds => setOwn({ ...Object.fromEntries(ds.map(d => [d.id, d.friend && !guest ? 'ami' : d.community ? 'com' : 'meu'])), ...(guest && { _guest: true }) })).catch(() => {}) }, [guest])
  const [net, share] = useNet(!guest), [shareOpen, setShareOpen] = useState(false), [nOpen, setNOpen] = useState(null)
  if (table) return <div className="view play fp-view">{String(table).startsWith('fp:') ? <ForgeTable key={table} sid={table.slice(3)} data={data} onClose={() => setTable(null)} />  // mesa estrita: o Forge Play contra a outra pessoa
    : <FreeTable key={table} id={table} data={data} onClose={() => setTable(null)} />}</div>
  return (
    <OwnCtx.Provider value={own}><div className={`view tour on-view ${hlOn() ? 'hl-mine' : ''}`}>
      <header className="on-head">
        <div className="on-title"><h2><IL n="online" t={tx('Online')} /></h2>
          <p className="small muted">{guest ? tx('Entra numa sala com um deck teu; quem aloja começa quando estiverem todos.') : tx('Abre uma sala, manda o link e cada amigo entra com um deck seu.')}</p></div>
        {!guest && <div className="on-cta">
          <button type="button" className={`on-big ${view === 'criar' ? 'on' : 'primary'}`} onClick={() => setView('criar')} aria-pressed={view === 'criar'}>＋ {tx('Criar sala')}</button>
          <a className="on-big on-btn" href="#levar">🔗 {tx('Entrar com um link')}</a>
        </div>}
      </header>
      <div className="on-bar">
        <div className="seg on-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'salas'} className={view === 'salas' ? 'on' : ''} onClick={() => setView('salas')}><IL n="porta" t={tx('🚪 Salas')} />{nOpen > 0 && <b>{nOpen}</b>}</button>
          <button role="tab" aria-selected={view === 'ver'} className={view === 'ver' ? 'on' : ''} onClick={() => setView('ver')} disabled={!tid}><IL n="torneio" t={tx('🏆 Ao vivo')} /></button>
          <button role="tab" aria-selected={view === 'apostas'} className={view === 'apostas' ? 'on' : ''} onClick={() => setView('apostas')}><IL n="moeda" t={tx('🪙 Apostas')} /></button>
        </div>
        <span className="tour-slot" ref={setSlot} />
        {!guest && <ShareChip net={net} open={shareOpen} onClick={() => setShareOpen(v => !v)} />}
      </div>
      {shareOpen && net && <SharePanel net={net} share={share} onClose={() => setShareOpen(false)} />}
      {view === 'criar' && !guest && <NewRoom data={data} fmt={fmt} deckId={deckId} onBack={() => setView('salas')} onRoom={id => { setFresh(id || null); setView('salas') }} openTable={setTable} />}
      {view === 'ver' && tid && <Live key={tid} data={data} tid={tid} slot={slot} running={list.filter(x => x.status === 'running')} open={open} openTable={setTable} onGone={() => { loadList(); setView('salas') }} />}
      {view === 'apostas' && <BetsTab open={open} />}
      {view === 'salas' && <Rooms data={data} guest={guest} open={id => { loadList(); open(id) }} openTable={setTable} net={net} share={share} fresh={fresh} onCount={setNOpen} onCreate={() => setView('criar')} />}
    </div></OwnCtx.Provider>
  )
}

// ---------- criar: que tipo de sala e o formulário dela ----------
function NewRoom({ data, fmt, deckId, onRoom, onBack, openTable }) {
  const [kind, setKindS] = useState(() => (MODES[ls('grimorio.online.tipo')] ? ls('grimorio.online.tipo') : 'livre'))
  const setKind = k => { setKindS(k); ls('grimorio.online.tipo', k) }
  return <div className="on-new">
    <div className="on-new-h"><button type="button" className="link" onClick={onBack}>← {tx('Salas')}</button><h3>{tx('Criar sala')}</h3></div>
    <div className="on-kinds" role="radiogroup" aria-label={tx('Tipo de sala')}>
      {GROUPS.map(([g, ks]) => <div key={g} className="on-kgroup"><h4>{g}</h4>
        {ks.map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className={`on-kind k-${k} ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
          <TypeIco k={ICO[k]} /><b>{MODES[k][0]}</b><small>{TAG[k]}</small></button>)}
      </div>)}
    </div>
    <p className="small muted on-why">{MODES[kind][1]} {MODES[kind][2]}</p>
    {kind === 'livre' ? <NewFreeRoom data={data} deckId={deckId} onRoom={onRoom} /> : kind === 'solo' ? <NewSolo data={data} deckId={deckId} openTable={openTable} />
      : <Create key={kind} data={data} fmt0={fmt} deckId={deckId} room={kind === 'livretorneio' || kind === 'misto' ? 'torneio' : kind} free={kind === 'livretorneio'} misto={kind === 'misto'} onRoom={() => onRoom()} />}
  </div>
}

// ---------- o convite de uma sala (quem aloja): o link à vista, copiar, partilhar e QR ----------
function Invite({ r, net, share }) {
  const [copied, setCopied] = useState(''), [qr, setQr] = useState(false), [busy, setBusy] = useState(false)
  const url = net?.public && net.public + r.link, lan = net?.lan && net.lan + r.link, st = netState(net)
  const cp = async (u, k) => { if (await copyText(u)) { setCopied(k); setTimeout(() => setCopied(''), 1800) } }
  const native = typeof navigator !== 'undefined' && navigator.share
  if (!net) return null
  return (
    <div className={`on-invite ${url ? 'up' : ''}`}>
      <b className="on-invite-h">🔗 {tx('Convidar para esta sala')}</b>
      {url ? <>
        <div className="on-link">
          <input readOnly value={url} onFocus={e => e.target.select()} aria-label={tx('Link da sala')} />
          <button type="button" className="primary" onClick={() => cp(url, 'pub')}>{copied === 'pub' ? tx('copiado ✓') : `📋 ${tx('Copiar')}`}</button>
          {native && <button type="button" onClick={() => navigator.share({ title: r.name, url }).catch(() => {})}>📤 {tx('Partilhar')}</button>}
          <button type="button" onClick={() => setQr(v => !v)} aria-pressed={qr}>QR</button>
        </div>
        <small className="muted">{tx('Entra quem abrir o link, mesmo sem estar nos teus amigos.')}</small>
        {qr && <QR text={url} />}
      </> : <div className="on-invite-off">
        <span className="small">{st === 'opening' ? `⏳ ${tx('a abrir o túnel…')}` : tx('Para os amigos entrarem pela internet, abre este Grimório à internet: o link aparece aqui.')}</span>
        {st === 'off' && <button type="button" className="primary" disabled={busy} onClick={async () => { setBusy(true); await share('start'); setBusy(false) }}>🌍 {tx('Abrir à internet')}</button>}
      </div>}
      {lan && <p className="small muted on-lan">🏠 {tx('Sem internet, na mesma rede:')} <code>{lan}</code> <button type="button" className="link small" onClick={() => cp(lan, 'lan')}>{copied === 'lan' ? tx('copiado ✓') : tx('copiar')}</button></p>}
    </div>
  )
}

// ---------- as salas ----------
const OLD_H = 12
export function Rooms({ data, guest, open, openTable, net, share, fresh, onCount, onCreate }) {
  const [list, setList] = useState(null), [decks, setDecks] = useState([]), [pick, setPick] = useState({}), [err, setErr] = useState(''), [showOld, setShowOld] = useState(false)
  const seen = useRef({}), seats = useRef({}), [toast, setToast] = useState(null), [busy, setBusy] = useState('')  // mesa livre onde estou: quando a mesa começa, abre-se sozinha
  const load = () => j('/api/rooms').then(l => {
    const news = []
    for (const r of l) {
      if (r.type === 'livre' && r.status === 'started' && seen.current[r.id] === 'open' && r.players.some(p => p.mine)) openTable(r.tid)
      seen.current[r.id] = r.status
      // quem se sentou ou saiu desde a última vez (aviso curto e um som)
      const now = r.players.map(p => `${p.by || ''}|${p.ref}`), was = seats.current[r.id]
      if (was && r.status === 'open') {
        for (const p of r.players) if (!was.includes(`${p.by || ''}|${p.ref}`) && !p.mine) news.push(tx('🤝 {p} sentou-se em «{r}» com {d}', { p: p.by || tx('Anfitrião'), r: r.name, d: p.name }))
        for (const k of was) if (!now.includes(k)) news.push(tx('{p} saiu de «{r}»', { p: k.split('|')[0] || tx('Anfitrião'), r: r.name }))
      }
      seats.current[r.id] = now
    }
    if (news.length) { setToast(news.join(' · ')); play('tick', { amount: 1 }); setTimeout(() => setToast(t => (t === news.join(' · ') ? null : t)), 5000) }
    setList(l)
  }).catch(e => setErr(e.message))
  const counting = (list || []).some(r => r.go != null)  // contagem a correr: a lista atualiza-se de segundo a segundo
  useEffect(() => { load(); j('/api/decks').then(setDecks).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(load, counting ? 1000 : 2500); return () => clearInterval(t) }, [counting]) // eslint-disable-line react-hooks/exhaustive-deps
  const nOpen = (list || []).filter(r => r.status === 'open').length
  useEffect(() => { onCount?.(nOpen) }, [nOpen, onCount])
  const act = async (id, a, body) => { setErr(''); setBusy(`${id}:${a}`); try { const r = await post(`/api/rooms/${id}/${a}`, body); if (a === 'start' && r.table) return openTable(r.table); if (a === 'start' && r.tid) open(r.tid); load() } catch (e) { setErr(e.message) } finally { setBusy('') } }
  const cancel = async r => (await ask('torneio', { title: tx('Cancelar a sala «{n}»?', { n: r.name }), body: tx('Quem está sentado sai e o link da sala deixa de funcionar.'), ok: tx('Cancelar a sala') })) && act(r.id, 'cancel')
  const solo = async r => { const p = r.players.find(x => x.mine); if (!p) return; setBusy(`${r.id}:solo`); try { openTable((await post('/api/freetables', { deck: p.ref })).id) } catch (e) { setErr(e.message); setBusy('') } }
  if (!list) return <p className="muted">{err || tx('a carregar…')}</p>
  const myDecks = r => decks.filter(d => (guest ? true : !d.friend && !d.community) && (r.casual || (d.format === r.format && !d.casual)))
  const reload = () => j('/api/decks').then(setDecks)
  // abertas primeiro (a acabada de criar à cabeça); as começadas há mais de OLD_H horas dobram-se no histórico (as canceladas não aparecem)
  const live = list.filter(r => r.status !== 'cancelled'), isOld = r => r.status !== 'open' && Date.now() / 1000 - r.ts > OLD_H * 3600
  const opened = live.filter(r => r.status === 'open').sort((a, b) => (b.id === fresh) - (a.id === fresh)), going = live.filter(r => r.status !== 'open' && !isOld(r)), old = live.filter(isOld)
  const props = { data, guest, net, share, busy, act, cancel, solo, open, openTable, decks, myDecks, pick, setPick, reload }
  return (
    <div className="on-rooms">
      {err && <p className="small bad-t">{err}</p>}
      {toast && <p className="ml-room-toast" role="status">{toast}</p>}
      {!opened.length && <div className="card on-empty">
        <b>🚪 {tx('Não há salas abertas.')}</b>
        <p className="small muted">{guest ? tx('Quando quem te convidou abrir uma sala, ela aparece aqui.') : tx('Cria uma sala e manda o link: quem o abre entra com um deck seu e a mesa começa quando estiverem todos prontos.')}</p>
        {!guest && <div className="row-btns"><button type="button" className="primary on-big" onClick={onCreate}>＋ {tx('Criar sala')}</button><a className="on-big on-btn" href="#levar">🔗 {tx('Entrar com um link')}</a></div>}
      </div>}
      {opened.map(r => <Room key={r.id} r={r} fresh={r.id === fresh} {...props} />)}
      {going.length > 0 && <><h4 className="on-sec">{tx('A decorrer')}</h4>{going.map(r => <Room key={r.id} r={r} {...props} />)}</>}
      {old.length > 0 && <button type="button" className="link small on-old" onClick={() => setShowOld(v => !v)} aria-expanded={showOld}>{showOld ? tx('▴ esconder as antigas') : tx('▾ mostrar antigas ({n}, começadas há mais de {h} h)', { n: old.length, h: OLD_H })}</button>}
      {showOld && old.map(r => <Room key={r.id} r={r} {...props} />)}
    </div>
  )
}

function Room({ r, fresh, data, guest, net, share, busy, act, cancel, solo, open, openTable, decks, myDecks, pick, setPick, reload }) {
  const mine = r.players.filter(p => p.mine), opts = myDecks(r), sel = pick[r.id] || opts[0]?.id || '', isOpen = r.status === 'open', livre = r.type === 'livre'
  const [ico, mname, why] = modeOf(r), n = r.players.length, few = n < r.min
  const fmtL = r.casual ? (livre ? tx('qualquer formato') : tx('casual')) : FORMAT[r.format]?.name || r.format
  const ref = useRef(null)
  useEffect(() => { if (fresh) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [fresh])
  const join = <JoinPanel key={`${r.id}${decks.length}${mine.length}`} r={r} data={data} decks={myDecks(r)} guest={guest} busy={busy === `${r.id}:join`} onJoin={b => act(r.id, 'join', b)} reload={reload} />
  return (
    <article ref={ref} className={`card on-room ${r.status} ${livre ? 'livre' : ''} ${fresh ? 'fresh' : ''}`}>
      <header className="on-room-h">
        <TypeIco k={livre ? 'livre' : r.type} />
        <div className="on-room-t"><h3>{r.name}</h3>
          <div className="on-tags">
            <span className={`on-tag mode ${livre || r.free ? 'livre' : r.misto ? 'misto' : 'bots'}`} title={why.slice(1).join(' ')}>{ico} {mname}</span>
            {!livre && !r.free && !r.misto && r.type !== 'jogo' && TYPES[r.type] && <span className="on-tag">{TYPES[r.type][0]}</span>}
            {r.giant && <span className="on-tag">2 × 2 {tx('Two-Headed Giant')}</span>}
            <span className="on-tag">{fmtL}</span>
            <span className={`on-tag ${isOpen && few ? 'warn' : ''}`}>👥 {n}/{r.max}{isOpen && r.min !== r.max ? ` · ${tx('mín. {m}', { m: r.min })}` : ''}</span>
          </div></div>
        <div className="on-room-act">
          {r.status === 'started' ? (livre ? (mine.length || !guest ? <button className="primary" onClick={() => openTable(r.tid)}>{tx('🃏 Ir para a mesa')}</button> : <span className="small muted">{tx('a jogar')}</span>)
            : <button className="primary" onClick={() => open(r.tid)}>{r.type === 'jogo' ? tx('🎲 Ver o jogo') : tx('🏆 Ver o torneio')}</button>)
            : !guest && isOpen && <>
              <button className="primary" disabled={few || !!busy} onClick={() => act(r.id, 'start')} title={few ? tx('Precisa de pelo menos {m} jogadores (há {n})', { m: r.min, n }) : undefined}>{busy === `${r.id}:start` ? tx('A abrir a mesa…') : tx('▶ Começar')}</button>
              <button className="link small" onClick={() => cancel(r)}>{tx('cancelar')}</button></>}
        </div>
      </header>
      {isOpen && !guest && r.link && <Invite r={r} net={net} share={share} />}
      {isOpen && livre && <FreeLobby {...{ r, data, guest, busy, act, solo, mine, join }} />}
      {!livre && <>
        <ul className="room-pl on-pl">{r.players.map((p, k) => (
          <li key={k} className={p.by ? 'fr' : ''}>{p.by ? `🤝 ${p.by}` : '🏠'} · {p.name}
            {r.misto && <PlaysToggle plays={p.plays} disabled={!isOpen || (guest && !p.mine) || !!busy} onChange={v => act(r.id, 'plays', { ref: p.ref, plays: v })} />}
            {r.misto && p.plays !== 'dono' && <select className="small" value={p.difficulty} disabled={!isOpen || (guest && !p.mine)} onChange={e => act(r.id, 'plays', { ref: p.ref, difficulty: e.target.value })} aria-label={tx('Dificuldade de {d}', { d: p.name })}>{Object.entries(DIFF_INFO).filter(([id]) => id !== 'random').map(([id, d]) => <option key={id} value={id}>{d.label}</option>)}</select>}
            {(!guest || p.mine) && isOpen && <button className="link small" onClick={() => act(r.id, 'leave', { ref: p.ref })}>{tx('tirar')}</button>}</li>))}
          {isOpen && !n && <li className="muted">{tx('Ainda ninguém entrou.')}</li>}</ul>
        {isOpen && (r.free || r.misto) && <>
          {join}
          {mine.length > 0 && <p className="small muted">{r.misto ? tx('Tens {n} deck(s) neste torneio. Em cada um, escolhe se o jogas tu (🧑) ou o bot (🤖).', { n: mine.length }) : tx('Tens {n} deck(s) neste torneio. Podes juntar mais.', { n: mine.length })}</p>}
          {r.misto && r.wait > 0 && <p className="small muted">{tx('Se alguém não aparecer, o bot joga a partida ao fim de {m} min.', { m: r.wait })}</p>}
          {!guest && <details className="on-more"><summary>🤝 {tx('Emprestar decks a quem não tem')}</summary><LendPanel r={r} data={data} act={act} /></details>}
        </>}
        {isOpen && !r.free && !r.misto && (!guest || !mine.length) && (opts.length ? (
          <div className="row-btns on-joinrow"><select value={sel} onChange={e => setPick(x => ({ ...x, [r.id]: e.target.value }))} aria-label={tx('Deck para entrar')}>{opts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <button className="primary" onClick={() => act(r.id, 'join', { deck: sel })} disabled={!sel || n >= r.max}>{tx('＋ Entrar com este deck')}</button></div>)
          : guest && <p className="small muted">{tx('Não tens decks de {f}. Cria um no Construir.', { f: fmtL })}</p>)}
      </>}
      {isOpen && <details className="on-more"><summary>ⓘ {tx('Como funciona esta sala')}</summary><p className="small muted">{why[1]} {why[2]}</p></details>}
    </article>
  )
}

// a mesa livre antes de começar: em que pé está, os lugares e o «Pronto», o deck com que te sentas, o lobby 3D e a conversa
function FreeLobby({ r, data, guest, busy, act, solo, mine, join }) {
  const n = r.players.length, me = mine[0], nReady = r.players.filter(p => p.ready).length, all = n >= r.min && nReady === n
  return <>
    <p className={`ml-wait on-wait ${n >= r.min ? 'ready' : ''} ${r.go != null ? 'go' : ''}`} role="status"><i className="ml-pulse" />
      {r.go != null ? <b>{tx('Todos prontos! A mesa abre em {s} s…', { s: Math.ceil(r.go) })}</b>
        : n < r.min ? tx('À espera de jogadores: {n} de {m} para começar (cabem {x})', { n, m: r.min, x: r.max })
          : all ? tx('Todos prontos.') : tx('{k} de {n} prontos. A mesa abre quando todos carregarem em «Pronto»{h}.', { k: nReady, n, h: guest ? '' : tx(' (ou começa já)') })}
      {guest && me && n < r.min && <> · {tx('estás sentado; a mesa abre-se sozinha quando houver gente que chegue e estiverem todos prontos')}</>}</p>
    <div className="on-seatrow">
      <Seats r={r} guest={guest} act={act} />
      {me && <button className={`on-ready ${me.ready ? 'on' : 'primary'}`} onClick={() => act(r.id, 'ready', { on: !me.ready })} aria-pressed={me.ready} disabled={busy === `${r.id}:ready`}>
        {me.ready ? tx('✓ Pronto (carrega para esperar)') : tx('✋ Estou pronto')}</button>}
    </div>
    {!mine.length && (n < r.max ? join : <p className="small muted">{tx('A mesa está cheia')}</p>)}
    <Lobby3D r={r} data={data} act={act} />
    {!guest && <div className="on-hostx">
      {n < r.min && <span className="small muted">{tx('Enquanto esperas, testa o teu deck sozinho:')} <button className="small" onClick={() => solo(r)} disabled={!!busy || !me}>{busy === `${r.id}:solo` ? tx('A abrir a mesa…') : `🃏 ${tx('Jogar a solo')}`}</button></span>}
      <details className="on-more"><summary>🤝 {tx('Emprestar decks a quem não tem')}{(r.lend || []).length ? ` (${r.lend.length})` : ''}</summary><LendPanel r={r} data={data} act={act} /></details>
    </div>}
  </>
}
