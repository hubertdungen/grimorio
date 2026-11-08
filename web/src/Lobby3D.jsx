// O lobby 3D da mesa livre (antes de começar): as caixas dos decks numa mesa (lobby3d.js), igual para todos (canal ao
// vivo da sala, /api/rooms/<id>/live: quem mexe manda, todos lêem 4×/s), a conversa e a moeda de quem começa.
// A tua caixa: clicar deixa (ou não) os outros ver e mexer no teu deck; a de outro abre-se (para todos) se o dono deixar.
// As cartas ficam na mesa viradas para baixo (um toque vira-a, para todos); para ver uma a sério, larga-a na faixa de
// baixo — fica na tua mão: passar o rato (ou manter premido) mostra-a em grande, um clique devolve-a à mesa.
import { useEffect, useMemo, useRef, useState } from 'react'
import { tx } from './i18n.js'
import { held } from './touch.js'
import { img } from './data.js'
import { lookup } from './game.js'
import { fpPrefs, setFpPrefs } from './fpprefs.js'
import { Hands, throttlePtr, useTick, ptrCol } from './ptrs.jsx'

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json()).catch(() => null)

// live: o canal ao vivo (a mesa da Taverna usa o dela); free: todas as caixas se abrem (a prateleira é para ver), sem
// «deixar ver» nem a conversa da sala; meName: o nome do meu cursor quando não tenho caixa na mesa
export default function Lobby3D({ r, data, act, live = `/api/rooms/${r.id}/live`, free = false, meName = '' }) {
  const box = useRef(null), api = useRef(null), [open, setOpen] = useState(null), [msg, setMsg] = useState(''), [text, setText] = useState(''), [ok3d, setOk3d] = useState(true)
  const [grow, setGrow] = useState(false)  // telemóvel: a mesa fica baixa (os lugares, o «Pronto» e a conversa à mão); ⤢ estica-a
  const [ptrs, setPtrs] = useState({}), ptrAt = useRef({}), [pv, setPv] = useState(0)  // pv: as opções dos cursores mudaram  // os cursores dos outros: {quem: {x, z (no plano da mesa), n, age}}
  const [hand, setHand] = useState([]), [big, setBig] = useState(null), [others, setOthers] = useState({}), tossed = useRef(null), chatEnd = useRef(null), me = useRef('host'), hold = useRef(0)
  const seats = useMemo(() => r.players.map(p => {
    const list = p.list || null, cols = new Set()
    if (list) for (const n of Object.keys(list)) for (const k of String(lookup(data, n)?.ci || '').replace(/[^WUBRG]/g, '')) cols.add(k)
    const cc = p.cover && lookup(data, p.cover)
    return { key: `${p.by || 'host'}|${p.ref}`, name: p.by || tx('Anfitrião'), deck: p.name, n: p.n || 60, cols: [...cols].slice(0, 3), cover: cc ? img(cc, 'art_crop') : null, show: !!p.show, mine: !!p.mine, list }
  }), [r.players, data])
  const seatsRef = useRef(seats); seatsRef.current = seats
  const cardsOf = s => Object.entries(s.list || {}).map(([name, n]) => { const c = lookup(data, name); return { name, n, url: c ? img(c, 'small') : null } })
  useEffect(() => {
    let gone = false
    import('./lobby3d.js').then(m => {
      if (gone || !box.current) return
      try {
        api.current = m.createLobby(box.current, {
          onClick: key => clickRef.current?.(key),
          onMove: objs => post(live, { objs }),  // o que eu mexo: os outros vêem-no a deslizar até lá
          onHand: (id, name, url) => setHand(h => [...h.filter(x => x.id !== id), { id, name, url }]),
        })
        api.current.setSeats(seatsRef.current)
      } catch { setOk3d(false) }
      box.current._click = key => clickRef.current?.(key)  // o mesmo clique numa caixa, para os testes
    }).catch(() => setOk3d(false))
    return () => { gone = true; api.current?.dispose(); api.current = null }
  }, [r.id, live])
  useEffect(() => { api.current?.setSeats(seats) }, [seats])
  // o canal ao vivo: o que os outros mexem, o deck aberto e quantas cartas cada um tem na mão
  useEffect(() => {
    let t = 0, busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const L = await fetch(live).then(x => (x.ok ? x.json() : null)).catch(() => null)
        if (!L || !api.current) return
        me.current = L.me
        const want = L.open?.key || null
        if (want !== api.current.openKey()) {
          if (want) { const s = seatsRef.current.find(x => x.key === want); api.current.openDeck(want, L.open.list.map(([name, n]) => { const c = lookup(data, name); return { name, n, url: c ? img(c, 'small') : null } })); setOpen(want); if (s && L.open.by !== L.me) setMsg(tx('O deck de {n} está aberto na mesa.', { n: s.name })) }
          else { api.current.closeDeck(); setOpen(null); setHand([]) }
        }
        api.current.setRemote(L.objs, L.me)
        setPtrs(L.ptr || {})
        const cnt = {}
        for (const o of Object.values(L.objs || {})) if (o.hand && o.hand !== L.me) cnt[o.hand] = (cnt[o.hand] || 0) + 1
        setOthers(cnt)
      } finally { busy = false }
    }
    tick(); t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [r.id, data, live])
  // a moeda: quando a contagem começa, o servidor já tirou quem começa (r.first) — todos a veem cair do lado dessa pessoa
  useEffect(() => {
    if (r.go == null) { tossed.current = null; return }
    const k = `${r.id}|${r.first}`
    if (tossed.current === k || !seats[r.first]) return
    tossed.current = k
    const fc = x => ({ n: String(x.name || '?').slice(0, 12), c: (x.cols || []).join('') }), other = seats.length === 2 ? seats.find((x, i) => i !== r.first) : null
    api.current?.toss(seats[r.first].key, fc(seats[r.first]), other && fc(other))
    setMsg(tx('🪙 A moeda decidiu: começa {n}', { n: seats[r.first].name }))
  }, [r.go, r.first, r.id, seats])
  // o meu cursor no plano da mesa (~8/s, só quando mexe): cada um vê-o na sua câmara
  const myName = useRef(''); myName.current = seats.find(s => s.mine)?.name || meName
  const ptrSend = useMemo(() => throttlePtr(v => post(live, { ptr: v })), [live])
  useEffect(() => {
    const el = box.current
    if (!el || !fpPrefs().ptrShow) return
    const mv = e => { const p = api.current?.toPlane(e.clientX, e.clientY); if (p) ptrSend({ ...p, n: myName.current }, e.clientX, e.clientY) }
    const out = () => ptrSend({ off: true }, 0, 0)
    el.addEventListener('pointermove', mv); el.addEventListener('pointerleave', out)
    return () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerleave', out); out() }
  }, [r.id, ok3d, ptrSend, pv])
  const seePtr = fpPrefs().ptrSee
  useTick(seePtr && Object.keys(ptrs).length > 0)
  const clickRef = useRef(null)
  clickRef.current = key => {
    const s = seatsRef.current.find(x => x.key === key)
    if (!s) return
    if (s.mine && !free) { act(r.id, 'show', { on: !s.show }); setMsg(s.show ? tx('O teu deck voltou a estar fechado.') : tx('Os outros já podem abrir e ver o teu deck.')); return }
    if (!s.show || !s.list) { setMsg(tx('{n} ainda não deixa ver o deck.', { n: s.name })); return }
    if (open === key) { closeAll(); return }
    const list = cardsOf(s)
    api.current?.openDeck(key, list)
    post(live, { open: { key, list: list.map(c => [c.name, c.n]) } })
    setOpen(key); setHand([]); setMsg(tx('O deck de {n} está aberto na mesa: agarra e atira as cartas, toca numa para a virar; larga-a em baixo para a ver na tua mão.', { n: s.name }))
  }
  const closeAll = () => { api.current?.closeDeck(); setOpen(null); setHand([]); post(live, { open: null }) }
  const back = c => { setHand(h => h.filter(x => x.id !== c.id)); setBig(null); api.current?.returnCard(c.id, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.2) }
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [r.chat?.length])
  const send = e => { e.preventDefault(); const m = text.trim(); if (!m) return; setText(''); act(r.id, 'chat', { m }) }
  const mine = seats.find(s => s.mine), nameOf = by => seats.find(s => s.key.startsWith(`${by}|`))?.name || by
  return (
    <div className={`lobby3d ${grow ? 'grow' : ''}`}>
      <div className="lobby3d-main">
        {ok3d && <div className="lobby3d-view" ref={box} aria-label={tx('Mesa do lobby com as caixas dos decks')}>
          {seePtr && api.current && <div className="ptr-box"><Hands list={Object.entries(ptrs).map(([k, g]) => {
            const sig = `${g.x},${g.z}`, a = ptrAt.current
            if (a[k]?.sig !== sig) a[k] = { sig, t: Date.now() - (g.age || 0) * 1000 }
            const q = api.current.toScreen(g.x, g.z)
            return q && { key: k, x: q.x, y: q.y, col: ptrCol(k), name: (g.n || tx('Alguém')).slice(0, 16), zone: '', age: (Date.now() - a[k].t) / 1000 }
          }).filter(Boolean)} /></div>}
          <button type="button" className="small lobby3d-grow" onClick={() => setGrow(g => !g)} aria-pressed={grow}>{grow ? `⤡ ${tx('Mesa mais baixa')}` : `⤢ ${tx('Mesa maior')}`}</button>
          {open && <button type="button" className="small lobby3d-close" onClick={closeAll}>📦 {tx('Guardar as cartas na caixa')}</button>}
          {open && <span className="lobby3d-handzone">✋ {tx('Larga aqui uma carta para a veres na tua mão')}</span>}
        </div>}
        {(hand.length > 0 || Object.keys(others).length > 0) && <div className="lobby3d-hand" aria-label={tx('A tua mão no lobby')}>
          {hand.map(c => <button key={c.id} type="button" className="lobby3d-hc" title={tx('Clica para devolver à mesa')}
            onMouseEnter={() => setBig(c)} onMouseLeave={() => setBig(null)} onClick={() => back(c)}
            onPointerDown={e => { if (e.pointerType !== 'mouse') { clearTimeout(hold.current); hold.current = setTimeout(() => { held(); setBig(c) }, 450) } }}
            onPointerUp={() => clearTimeout(hold.current)}>
            {c.url ? <img src={c.url} alt={c.name} /> : <span>{c.name}</span>}</button>)}
          {Object.entries(others).map(([by, n]) => <small key={by} className="muted">{tx('{p} tem {n} na mão', { p: nameOf(by), n })}</small>)}
        </div>}
        {big && <div className="lobby3d-big" onPointerDown={() => setBig(null)}>{big.url ? <img src={big.url.replace('/small/', '/normal/')} alt={big.name} /> : <b>{big.name}</b>}</div>}
      </div>
      <div className="lobby3d-side">
        <p className="small muted">{msg || (free ? tx('Arrasta e atira as caixas dos decks da prateleira. Clica numa para a abrir e espalhar as cartas na mesa, para todos.') : tx('Arrasta e atira as caixas. Clica na tua para deixares (ou não) os outros verem o teu deck; clica na de outro para o abrir, se ele deixar.'))}</p>
        {mine && !free && <button type="button" className={`small ${mine.show ? 'on' : ''}`} onClick={() => clickRef.current(mine.key)}>{mine.show ? `👁 ${tx('O teu deck está à vista')}` : `🔒 ${tx('Deixar ver o meu deck')}`}</button>}
        <details className="lobby3d-opts"><summary className="small muted">🖱 {tx('Cursores')}</summary>
          <label className="chk small"><input type="checkbox" checked={fpPrefs().ptrSee} onChange={e => { setFpPrefs({ ptrSee: e.target.checked }); setPv(v => v + 1) }} /> {tx('Ver os cursores dos outros jogadores (mesa livre e lobby online)')}</label>
          <label className="chk small"><input type="checkbox" checked={fpPrefs().ptrShow} onChange={e => { setFpPrefs({ ptrShow: e.target.checked }); setPv(v => v + 1) }} /> {tx('Mostrar o meu cursor aos outros')}</label>
        </details>
        {!free && <><div className="lobby3d-chat" role="log" aria-label={tx('Conversa da sala')}>
          {(r.chat || []).map((c, k) => <p key={k}><b>{c.w}</b> {c.m}</p>)}
          {!(r.chat || []).length && <p className="muted small">{tx('Ainda ninguém falou. Diz olá!')}</p>}
          <span ref={chatEnd} />
        </div>
        <form className="lobby3d-say" onSubmit={send}>
          <input value={text} onChange={e => setText(e.target.value)} maxLength={240} placeholder={tx('Escreve à sala…')} aria-label={tx('Mensagem para a sala')} />
          <button type="submit" className="small" disabled={!text.trim()}>➤</button>
        </form></>}
      </div>
    </div>
  )
}
