// Mesa livre no separador Online: criar a sala (ou jogar a solo), quem está sentado e se está pronto, e com que deck te
// sentas — os teus, um que quem aloja empresta, um do meta ou uma lista colada/um link (fica guardado como deck teu).
import { useEffect, useRef, useState } from 'react'
import { FORMAT } from './formats.js'
import { img, coverOf, colorsOf } from './data.js'
import { parseList } from './deck.js'
import { Mana } from './ui.jsx'
import ProfileImport from './ProfileImport.jsx'
import { tx } from './i18n.js'

async function j(url, opts) {
  const r = await fetch(url, opts)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`)
  return d
}
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const META_FMT = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern']  // como o META_PATH do servidor

// a capa de um deck (imagem própria ou a carta da capa), como nos mosaicos do Jogar contra o Forge
function DeckArt({ d, data }) {
  const c = d && !d.coverImg && coverOf(d, data), src = d?.coverImg || (c ? img(c, 'art_crop') : null)
  return <span className="pv-art">{src ? <img src={src} alt="" loading="lazy" /> : <i>✦</i>}</span>
}

// mosaicos de decks com a capa, o formato e as cores, e pesquisa; kinds = separadores [[k, rótulo, (d) => pertence]]
export function DeckTiles({ decks, value, onPick, data, kinds = null, empty }) {
  const [q, setQ] = useState(''), [src, setSrc] = useState(kinds?.[0]?.[0])
  const n = q.trim().toLowerCase(), inTab = d => !kinds || kinds.find(k => k[0] === src)?.[2](d)
  if (!decks) return <p className="muted small">{tx('a carregar…')}</p>
  const shown = decks.filter(d => inTab(d) && (!n || d.name.toLowerCase().includes(n) || (FORMAT[d.format]?.name || '').toLowerCase().includes(n)))
  return (
    <div className="ml-decks">
      {(kinds?.length > 1 || decks.length > 6) && <div className="pv-bar">
        {kinds?.length > 1 && <span className="seg">{kinds.map(([k, l, f]) => <button key={k} type="button" className={src === k ? 'on' : ''} onClick={() => setSrc(k)}>{l} <b>{decks.filter(f).length}</b></button>)}</span>}
        {decks.length > 6 && <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar deck…')} aria-label={tx('Procurar deck')} />}
      </div>}
      <div className="pv-grid ml-grid">{shown.map(d => { const cols = d.main ? colorsOf(d, data) : []; return (
        <button key={d.id} type="button" className={`pv-tile ${value === d.id ? 'on' : ''}`} onClick={() => onPick(d.id)} title={d.name} aria-pressed={value === d.id}>
          <DeckArt d={d} data={data} />
          <span className="pv-t"><b>{d.name}</b><span className="small muted">{d.tag ? `${d.tag} · ` : ''}{FORMAT[d.format]?.name || d.format || tx('qualquer formato')} {cols.length > 0 && <Mana cost={cols.map(x => `{${x}}`).join('')} />}</span></span>
        </button>) })}
        {!shown.length && <p className="muted small">{n ? tx('Nenhum deck com «{q}».', { q }) : empty || tx('Nenhum deck aqui.')}</p>}
      </div>
    </div>
  )
}
const MINE = [['meu', tx('🧙 Meus'), d => !d.community], ['com', tx('🌐 Comunidade'), d => !!d.community]]

// ---------- criar: mesa a solo e sala da mesa livre ----------
export function NewSolo({ data, deckId, openTable }) {
  const [decks, setDecks] = useState(null), [deck, setDeck] = useState(deckId || ''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { j('/api/decks').then(ds => { const ok = ds.filter(d => !d.friend); setDecks(ok); setDeck(v => (ok.some(d => d.id === v) ? v : ok[0]?.id || '')) }).catch(e => setErr(e.message)) }, [])
  const go = async () => { setBusy(true); setErr(''); try { openTable((await post('/api/freetables', { deck })).id) } catch (e) { setErr(e.message); setBusy(false) } }
  return (
    <section className="card nr-free">
      <h3>🃏 {tx('Mesa livre a solo')} <span className="muted small">{tx('testa um deck teu na mesa livre: compras, jogas, viras e contas o dano a um adversário imaginário, sem ninguém à espera')}</span></h3>
      <DeckTiles decks={decks} value={deck} onPick={setDeck} data={data} kinds={MINE} />
      {err && <p className="small bad-t">{err}</p>}
      <div className="row-btns"><button className="primary" onClick={go} disabled={!deck || busy}>{busy ? tx('A abrir a mesa…') : `▶ ${tx('Abrir a mesa a solo')}`}</button></div>
    </section>
  )
}

export function NewFreeRoom({ data, deckId, onRoom }) {
  const [decks, setDecks] = useState(null), [name, setName] = useState(tx('Mesa livre')), [max, setMax] = useState(2), [deck, setDeck] = useState(deckId || ''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { j('/api/decks').then(ds => { const mine = ds.filter(d => !d.friend); setDecks(mine); setDeck(v => (mine.some(d => d.id === v) ? v : mine[0]?.id || '')) }).catch(e => setErr(e.message)) }, [])
  const go = async () => { setBusy(true); setErr(''); try { await post('/api/rooms', { type: 'livre', name, max, players: [{ src: 'meus', ref: deck }] }); onRoom() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <section className="card nr-free">
      <h3>🃏 {tx('Nova mesa livre')} <span className="muted small">{tx('abre a sala e partilha o link: cada amigo entra com um deck seu e, quando começares, jogam todos na mesma mesa, ao vivo')}</span></h3>
      <div className="nr-free-f">
        <label>{tx('Nome')}<input value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
        <label>{tx('Jogadores')}<span className="seg">{[2, 3, 4].map(k => <button key={k} className={max === k ? 'on' : ''} onClick={() => setMax(k)}>{k}</button>)}</span></label>
      </div>
      <h4 className="ml-h4">{tx('O teu deck')}</h4>
      <DeckTiles decks={decks} value={deck} onPick={setDeck} data={data} kinds={MINE} />
      <p className="small muted">{tx('Sem bots e sem regras automáticas: o servidor só guarda a mesa e esconde as mãos e as bibliotecas. Num deck de Commander, o comandante fica na zona de comando e a vida começa em 40. Na sala podes emprestar decks a quem não tiver.')}</p>
      {err && <p className="small bad-t">{err}</p>}
      <div className="row-btns"><button className="primary" onClick={go} disabled={!deck || busy}>{busy ? tx('A abrir…') : `🚪 ${tx('Abrir a sala')}`}</button></div>
    </section>
  )
}

// ---------- quem está sentado (e pronto) ----------
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const SRC_L = { lend: tx('emprestado'), meta: tx('do meta') }
export function Seats({ r, guest, act }) {
  return (
    <div className="ml-seats">{r.players.map((p, k) => { const nm = p.by || tx('Anfitrião'); return (
      <span key={`${p.by}|${p.ref}|${k}`} className={`ml-seat ${p.mine ? 'mine' : ''} ${p.ready ? 'ready' : ''}`}><i style={{ '--h': hue(nm) }}>{nm[0]?.toUpperCase()}</i>
        <span><b>{nm}{p.mine ? ` (${tx('tu')})` : ''}</b><small>{p.name}{SRC_L[p.src] ? ` · ${SRC_L[p.src]}` : ''}</small></span>
        <em className="ml-rd" title={p.ready ? tx('Pronto') : tx('Ainda não está pronto')}>{p.ready ? '✓' : '…'}</em>
        {(!guest || p.mine) && r.status === 'open' && <button className="link small" onClick={() => act(r.id, 'leave', { ref: p.ref })} title={tx('Sair deste lugar')} aria-label={tx('Sair deste lugar')}>✕</button>}</span>) })}
      {r.status === 'open' && Array.from({ length: Math.max(0, r.max - r.players.length) }).map((_, k) => <span key={`v${k}`} className="ml-seat empty"><i>?</i><span><b>{tx('lugar livre')}</b><small>{k < r.min - r.players.length ? tx('falta para começar') : tx('opcional')}</small></span></span>)}
    </div>
  )
}

// ---------- quem aloja: emprestar decks a quem não tem ----------
export function LendPanel({ r, data, act }) {
  const [open, setOpen] = useState(false), [decks, setDecks] = useState(null)
  useEffect(() => { if (open && !decks) j('/api/decks').then(ds => setDecks(ds.filter(d => !d.friend))).catch(() => setDecks([])) }, [open, decks])
  const lent = new Set((r.lend || []).map(d => d.id))
  return (
    <div className="ml-lend">
      <span className="small">🤝 {tx('Decks emprestados a quem se sentar:')} {(r.lend || []).length ? (r.lend || []).map(d => <span key={d.id} className="chip">{d.name} <button className="link small" onClick={() => act(r.id, 'lend', { deck: d.id, on: false })} aria-label={tx('Deixar de emprestar')}>✕</button></span>) : <span className="muted">{tx('nenhum')}</span>}</span>
      <button className="link small" onClick={() => setOpen(v => !v)}>{open ? tx('fechar') : `＋ ${tx('Emprestar um deck')}`}</button>
      {open && <DeckTiles decks={decks} value={null} onPick={id => act(r.id, 'lend', { deck: id, on: !lent.has(id) })} data={data} kinds={MINE} />}
    </div>
  )
}

// ---------- com que deck te sentas ----------
// separadores: os teus (se tiveres), os emprestados nesta mesa, um deck do meta (qualquer formato) e colar uma lista ou um
// link (fica guardado como deck teu). Um convidado novo, sem decks, começa nos emprestados ou no meta.
export function JoinPanel({ r, data, decks, guest, busy, onJoin, reload }) {
  const lend = (r.lend || []).map(d => ({ ...d, tag: tx('emprestado') }))
  const tabs = [decks.length && 'meus', lend.length && 'lend', 'meta', 'colar', 'varios'].filter(Boolean)
  const [tab, setTab] = useState(tabs[0]), [pick, setPick] = useState(null), [fmt, setFmt] = useState('modern'), [meta, setMeta] = useState(null)
  const [text, setText] = useState(''), [url, setUrl] = useState(''), [name, setName] = useState(''), [err, setErr] = useState(''), [work, setWork] = useState(false)
  useEffect(() => { if (tab === 'meta') { setMeta(null); j(`/api/sim/opponents?format=${fmt}`).then(l => setMeta(l.map(o => ({ id: o.id, name: o.name, format: fmt, tag: o.share ? `${Math.round(o.share * 100)}%` : tx('meta') })))).catch(() => setMeta([])) } }, [tab, fmt])
  const L = { meus: tx('🧙 Os meus'), lend: tx('🤝 Emprestados ({n})', { n: lend.length }), meta: tx('📊 Do meta'), colar: tx('📋 Colar lista ou link'), varios: tx('📚 Trazer vários decks') }
  const save = async () => {  // lista colada (ou lida de um link) -> deck teu, e senta-te com ele
    setWork(true); setErr('')
    try {
      let t = text, info = null
      if (url.trim()) { info = await j(`/api/import?url=${encodeURIComponent(url.trim())}`); t = info.text }
      const p = parseList(t || '', data), n = Object.values(p.main).reduce((a, b) => a + b, 0)
      if (n < 20) throw new Error(tx('A lista tem só {n} cartas reconhecidas. Cola uma lista com «4 Lightning Bolt» por linha (ou um link do Moxfield, Archidekt…).', { n }))
      const d = await post('/api/decks', { name: name.trim() || info?.name || tx('Deck colado'), format: info?.format || 'casual', main: p.main, side: p.side, commanders: p.commanders, ...(info && { source: url.trim() }) })
      await reload?.()
      onJoin({ deck: d.id })
    } catch (e) { setErr(e.message) } finally { setWork(false) }
  }
  const src = tab === 'lend' ? 'lend' : tab === 'meta' ? 'meta' : 'meus', full = r.players.length >= r.max
  return (
    <div className="ml-join">
      <h4 className="ml-h4">{tx('Escolhe o deck com que te sentas')}</h4>
      {guest && !decks.length && <p className="ml-nodeck">🃏 {tx('Ainda não tens decks neste Grimório. Senta-te com um deck que te emprestem, com um deck do meta, ou cola a tua lista (ou um link) e fica guardado para a próxima.')}</p>}
      <span className="seg ml-tabs">{tabs.map(k => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setPick(null) }}>{L[k]}</button>)}</span>
      {tab === 'meus' && <DeckTiles decks={decks} value={pick} onPick={setPick} data={data} kinds={guest ? null : MINE} />}
      {tab === 'lend' && <DeckTiles decks={lend} value={pick} onPick={setPick} data={data} />}
      {tab === 'meta' && <>
        <span className="seg small">{META_FMT.map(f => <button key={f} type="button" className={fmt === f ? 'on' : ''} onClick={() => { setFmt(f); setPick(null) }}>{FORMAT[f]?.name || f}</button>)}</span>
        <DeckTiles decks={meta} value={pick} onPick={setPick} data={data} empty={tx('Sem decks do meta neste formato.')} />
      </>}
      {tab === 'varios' && <div className="ml-paste"><p className="small muted">{tx('Traz a tua biblioteca: o link do teu perfil (Archidekt, Moxfield…) ou vários links de decks. Ficam guardados como decks teus e depois escolhes com qual te sentas.')}</p>
        <ProfileImport data={data} say={() => {}} onDone={() => reload?.()} /></div>}
      {tab === 'varios' ? null : tab === 'colar' ? <div className="ml-paste">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder={tx('Link do deck (Moxfield, Archidekt, MTGGoldfish…)')} aria-label={tx('Link do deck')} />
        <textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={tx('…ou cola a lista: «4 Lightning Bolt» por linha')} aria-label={tx('Lista do deck')} disabled={!!url.trim()} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder={tx('Nome do deck (opcional)')} maxLength={80} aria-label={tx('Nome do deck')} />
        {err && <p className="small bad-t">{err}</p>}
        <div className="row-btns"><button className="primary" onClick={save} disabled={work || busy || full || !(text.trim() || url.trim())}>{work ? tx('A ler o deck…') : `🪑 ${tx('Guardar e sentar-me')}`}</button></div>
      </div> : <div className="row-btns">
        <button className="primary" onClick={() => onJoin({ deck: pick, src })} disabled={!pick || busy || full}>{busy ? tx('A sentar…') : full ? tx('A mesa está cheia') : tx('🪑 Sentar-me com este deck')}</button></div>}
    </div>
  )
}

// ---------- na tua app: entrar na sala de outro Grimório como o teu perfil, com os teus decks ----------
export function RemoteJoin({ data }) {
  const [url, setUrl] = useState(''), [all, setAll] = useState(true), [decks, setDecks] = useState(null), [pick, setPick] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (!all && !decks) j('/api/decks').then(ds => setDecks(ds.filter(d => !d.friend))).catch(() => setDecks([])) }, [all, decks])
  const go = async () => {
    setBusy(true); setErr('')
    try { const r = await post('/api/rooms/remote', { url, ...(all ? {} : { decks: [pick] }) }); window.location.href = r.go } catch (e) { setErr(e.message); setBusy(false) }
  }
  const ok = /\/sala\/[\w-]{8,}/.test(url) && (all || pick)
  return (
    <details className="card ml-remote"><summary><b>🔗 {tx('Entrar numa sala de outro Grimório')}</b> <span className="muted small">{tx('um amigo mandou-te o link da sala dele: entras como o teu perfil, com os teus decks')}</span></summary>
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder={tx('Cola aqui o link da sala (…/sala/…)')} aria-label={tx('Link da sala')} />
      <span className="seg small"><button className={all ? 'on' : ''} onClick={() => setAll(true)}>{tx('Levar todos os meus decks')}</button><button className={all ? '' : 'on'} onClick={() => setAll(false)}>{tx('Só um deck')}</button></span>
      {!all && <DeckTiles decks={decks} value={pick} onPick={setPick} data={data} kinds={MINE} />}
      <p className="small muted">{tx('Vão o nome do teu perfil e as listas dos decks (nada mais). Da próxima vez és reconhecido e os decks atualizam-se.')}</p>
      {err && <p className="small bad-t">{err}</p>}
      <div className="row-btns"><button className="primary" onClick={go} disabled={!ok || busy}>{busy ? tx('A entrar…') : `🚪 ${tx('Entrar na sala')}`}</button></div>
    </details>
  )
}

// ---------- torneio de mesa livre / misto: as partidas que esperam por pessoas ----------
// mesa livre (🃏): os dois donos carregam em «Pronto» e a mesa abre; Forge Play (🎮, só no misto): a pessoa joga contra o
// bot do outro deck (na fila do servidor se não houver lugar). Quem aloja marca resultados e, no misto, dá partidas ao bot.
export function FreeMatches({ t, openTable, nameOf, onChange, playMine }) {
  const [busy, setBusy] = useState(''), [err, setErr] = useState(''), seen = useRef({})
  const host = t.you === 'host', P = t.players || []
  const owner = i => P[i]?.by || 'host', who = i => (owner(i) === 'host' ? tx('Anfitrião') : P[i]?.fr || tx('Amigo'))
  const human = i => (t.free || P[i]?.ctl ? owner(i) : null)  // quem joga o deck i (null = o bot)
  const ms = (t.matches || []).filter(m => m.st === 'ready' && m.p.length >= 2 && (m.how ? m.how !== 'forge' : true))
  useEffect(() => {  // a mesa da minha partida abriu e eu estava pronto: vai lá
    for (const m of ms) {
      if (m.table && !seen.current[m.table] && m.p.some(i => owner(i) === t.you) && (m.rdy || []).includes(t.you) && seen.current[m.id] !== undefined) openTable(m.table)
      seen.current[m.id] = m.table || null
      if (m.table) seen.current[m.table] = true
    }
  })
  const act = async (m, a, body = {}) => {
    setBusy(`${m.id}:${a}`); setErr('')
    try { const r = await post(`/api/tournaments/${t.id}/${a}`, { mid: m.id, ...body }); onChange?.(); if ((a === 'open' || a === 'ready') && r.match?.table) openTable(r.match.table) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const go = async m => { setBusy(`${m.id}:play`); try { await playMine(m.id) } finally { setBusy('') } }
  if (t.status !== 'running') return null
  const turn = ms.find(m => m.how === 'play' && m.p.some(i => human(i) === t.you) && !m.want)  // «É a tua vez» (Forge Play)
  return (
    <section className="card ml-fm">
      <h3>{t.misto ? `🎮 ${tx('Partidas com pessoas')}` : `🃏 ${tx('Partidas à mesa livre')}`} <span className="muted small">{t.misto ? tx('Pessoa contra bot joga-se no Forge Play (com as regras do Forge); pessoas entre si numa mesa livre: quando os dois carregam em «Pronto», a mesa abre. Bot contra bot joga-se sozinho no Forge.') : tx('Cada partida joga-se numa mesa livre entre os donos dos decks. Quando os dois carregam em «Pronto», a mesa abre. Desistir = perder; o resultado também se pode combinar na mesa ou ser marcado por quem aloja.')}</span></h3>
      {turn && <p className="tl-now me-play">🎮 {turn.play ? tx('O teu jogo contra {o} está a decorrer', { o: nameOf(turn.p.find(i => !human(i))) }) : tx('É a tua vez: jogo {g} contra {o}', { g: turn.g.length + 1, o: nameOf(turn.p.find(i => !human(i))) })} <button className="primary" disabled={!!busy} onClick={() => go(turn)}>{turn.play ? tx('▶ Voltar à mesa') : tx('▶ Jogar no Forge Play')}</button></p>}
      {err && <p className="small bad-t">{err}</p>}
      {!ms.length && <p className="muted small">{tx('Nenhuma partida à espera agora.')}</p>}
      {ms.map(m => {
        const fp = m.how === 'play', mine = m.p.some(i => (fp ? human(i) : owner(i)) === t.you), owners = [...new Set(m.p.map(fp ? human : owner).filter(Boolean))], ready = m.rdy || [], meReady = ready.includes(t.you)
        const nm = o => (o === 'host' ? tx('Anfitrião') : P.find(p => p.by === o)?.fr || tx('Amigo'))
        return (
          <div key={m.id} className={`ml-fm-m ${mine ? 'mine' : ''}`}>
            <div className="ml-fm-p">{t.misto && <span className={`how-chip how-${m.how}`} title={fp ? tx('Pessoa contra bot: joga-se no Forge Play, com as regras do Forge') : tx('Pessoas entre si: joga-se numa mesa livre')}>{fp ? '🎮 Forge Play' : `🃏 ${tx('mesa livre')}`}</span>}
              {m.p.map((i, k) => <span key={i}>{k > 0 && <b className="muted"> vs </b>}<b>{nameOf(i)}</b> <small className="muted">({fp && !human(i) ? `🤖 ${tx('bot')}` : who(i)})</small></span>)}
              <small className="muted"> · {t.bo > 1 ? tx('jogo {g} · melhor de {bo} ({a}–{b})', { g: m.g.length + 1, bo: t.bo, a: m.w?.[0] ?? 0, b: m.w?.[1] ?? 0 }) : tx('jogo único')}</small></div>
            {fp ? <p className="small ml-fm-st">{m.play ? `▶ ${tx('A jogar no Forge Play: {p}', { p: nm(m.by) })}` : m.want ? `⏳ ${tx('Na fila do Forge: abre quando houver lugar no servidor (cada jogo do Forge Play ocupa ~1 GB).')}` : `… ${tx('À espera de {p}', { p: nm(owners[0]) })}`}</p>
              : <div className="ml-seats">{owners.map(o => <span key={o} className={`ml-seat ${ready.includes(o) ? 'ready' : ''}`}><span><b>{nm(o)}</b></span><em className="ml-rd">{ready.includes(o) || m.table ? '✓' : '…'}</em></span>)}</div>}
            <div className="row-btns">
              {fp ? mine && <button className="primary" disabled={!!busy || (!!m.want && !m.play)} onClick={() => go(m)}>{m.play ? tx('▶ Voltar à mesa') : m.want ? `⏳ ${tx('Na fila do Forge…')}` : tx('▶ Jogar no Forge Play')}</button>
                : m.table ? (mine || host) && <button className="primary" onClick={() => openTable(m.table)}>🃏 {tx('Ir para a mesa')}</button>
                  : mine && <button className={meReady ? 'on ml-ready' : 'primary ml-ready'} disabled={!!busy} onClick={() => act(m, 'ready', { on: !meReady })}>{meReady ? tx('✓ Pronto (à espera do outro)') : tx('✋ Estou pronto')}</button>}
              {host && !fp && !m.table && <button className="small" disabled={!!busy} onClick={() => act(m, 'open')}>{tx('Abrir a mesa já')}</button>}
              {host && t.misto && <button className="small" disabled={!!busy} onClick={() => act(m, 'bot')} title={tx('Os jogos que faltam desta partida jogam-nos os bots do Forge (ex.: alguém teve de sair).')}>🤖 {tx('Dar ao bot')}</button>}
              {host && <span className="ml-fm-res"><small className="muted">{tx('Marcar o jogo:')}</small>{m.p.map(i => <button key={i} className="small" disabled={!!busy} onClick={() => act(m, 'result', { w: i })}>🏆 {nameOf(i)}</button>)}<button className="small" disabled={!!busy} onClick={() => act(m, 'result', { w: null })}>{tx('empate')}</button></span>}
            </div>
            {!fp && mine && owners.length === 1 && !m.table && <p className="small muted">{tx('Os dois decks são teus: abre a mesa e joga os dois lados (troca de lugar na mesa), ou marca o resultado.')}</p>}
          </div>
        )
      })}
    </section>
  )
}
