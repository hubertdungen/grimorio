// O lobby 3D da mesa livre (antes de começar): as caixas dos decks numa mesa (lobby3d.js), a conversa da sala e a moeda
// de quem começa. A tua caixa: clicar deixa (ou não) os outros ver e mexer no teu deck; a de outro: abre-se se o dono
// deixar e as cartas espalham-se na mesa (agarram-se, atiram-se, viram-se com um toque).
import { useEffect, useMemo, useRef, useState } from 'react'
import { tx } from './i18n.js'
import { img } from './data.js'
import { lookup } from './game.js'

export default function Lobby3D({ r, data, act }) {
  const box = useRef(null), api = useRef(null), [open, setOpen] = useState(null), [msg, setMsg] = useState(''), [text, setText] = useState(''), [ok3d, setOk3d] = useState(true)
  const tossed = useRef(null), chatEnd = useRef(null)
  const seats = useMemo(() => r.players.map(p => {
    const list = p.list || null, cols = new Set()
    if (list) for (const n of Object.keys(list)) for (const k of String(lookup(data, n)?.ci || '').replace(/[^WUBRG]/g, '')) cols.add(k)
    const cc = p.cover && lookup(data, p.cover)
    return { key: `${p.by || 'host'}|${p.ref}`, name: p.by || tx('Anfitrião'), deck: p.name, n: p.n || 60, cols: [...cols].slice(0, 3), cover: cc ? img(cc, 'art_crop') : null, show: !!p.show, mine: !!p.mine, list }
  }), [r.players, data])
  useEffect(() => {
    let gone = false
    import('./lobby3d.js').then(m => {
      if (gone || !box.current) return
      try { api.current = m.createLobby(box.current, { onClick: key => clickRef.current?.(key) }); api.current.setSeats(seatsRef.current) } catch { setOk3d(false) }
      box.current._click = key => clickRef.current?.(key)  // o mesmo clique numa caixa, para os testes
    }).catch(() => setOk3d(false))
    return () => { gone = true; api.current?.dispose(); api.current = null }
  }, [])
  const seatsRef = useRef(seats); seatsRef.current = seats
  useEffect(() => { api.current?.setSeats(seats) }, [seats])
  // a moeda: quando a contagem começa, o servidor já tirou quem começa (r.first) — todos a veem cair do lado dessa pessoa
  useEffect(() => {
    if (r.go == null) { tossed.current = null; return }
    const k = `${r.id}|${r.first}`
    if (tossed.current === k || !seats[r.first]) return
    tossed.current = k
    api.current?.toss(seats[r.first].key)
    setMsg(tx('🪙 A moeda decidiu: começa {n}', { n: seats[r.first].name }))
  }, [r.go, r.first, r.id, seats])
  const clickRef = useRef(null)
  clickRef.current = key => {
    const s = seatsRef.current.find(x => x.key === key)
    if (!s) return
    if (s.mine) { act(r.id, 'show', { on: !s.show }); setMsg(s.show ? tx('O teu deck voltou a estar fechado.') : tx('Os outros já podem abrir e ver o teu deck.')); return }
    if (!s.show || !s.list) { setMsg(tx('{n} ainda não deixa ver o deck.', { n: s.name })); return }
    if (open === key) { api.current?.closeDeck(); setOpen(null); return }
    api.current?.openDeck(key, Object.entries(s.list).map(([name, n]) => { const c = lookup(data, name); return { name, n, url: c ? img(c, 'small') : null } }))
    setOpen(key); setMsg(tx('O deck de {n} está aberto na mesa: agarra e atira as cartas, toca numa para a virar.', { n: s.name }))
  }
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [r.chat?.length])
  const send = e => { e.preventDefault(); const m = text.trim(); if (!m) return; setText(''); act(r.id, 'chat', { m }) }
  const me = seats.find(s => s.mine)
  return (
    <div className="lobby3d">
      {ok3d && <div className="lobby3d-view" ref={box} aria-label={tx('Mesa do lobby com as caixas dos decks')}>
        {open && <button type="button" className="small lobby3d-close" onClick={() => { api.current?.closeDeck(); setOpen(null) }}>📦 {tx('Guardar as cartas na caixa')}</button>}
      </div>}
      <div className="lobby3d-side">
        <p className="small muted">{msg || tx('Arrasta e atira as caixas. Clica na tua para deixares (ou não) os outros verem o teu deck; clica na de outro para o abrir, se ele deixar.')}</p>
        {me && <button type="button" className={`small ${me.show ? 'on' : ''}`} onClick={() => clickRef.current(me.key)}>{me.show ? `👁 ${tx('O teu deck está à vista')}` : `🔒 ${tx('Deixar ver o meu deck')}`}</button>}
        <div className="lobby3d-chat" role="log" aria-label={tx('Conversa da sala')}>
          {(r.chat || []).map((c, k) => <p key={k}><b>{c.w}</b> {c.m}</p>)}
          {!(r.chat || []).length && <p className="muted small">{tx('Ainda ninguém falou. Diz olá!')}</p>}
          <span ref={chatEnd} />
        </div>
        <form className="lobby3d-say" onSubmit={send}>
          <input value={text} onChange={e => setText(e.target.value)} maxLength={240} placeholder={tx('Escreve à sala…')} aria-label={tx('Mensagem para a sala')} />
          <button type="submit" className="small" disabled={!text.trim()}>➤</button>
        </form>
      </div>
    </div>
  )
}
