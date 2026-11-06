// Mesa livre: 2–4 amigos jogam eles mesmos, sem bots e sem motor de regras (como o untap.in ou o Tabletop Simulator).
// O servidor (freetable.py) guarda a mesa e manda a cada um só o que pode ver; aqui desenha-se a mesa do Forge Play
// (tablekit.js + as peças do Board.jsx) e cada gesto vira um comando pequeno (mover, virar, marcadores, vida, dados…).
// As cartas no campo têm x/y no lado de quem as controla: todos veem a mesma arrumação (o lado dos outros ao contrário).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { img } from './data.js'
import { Perm, Hud, MatPick, Arts, artOf, OrbCtx, FsBtn, CombatLinks } from './Board.jsx'
import { FCard, DayNight, BigCard } from './ForgePlay.jsx'
import { useDrag, STAGE, useOverlap, useStage, useFlip, spotOn, usePeek, useTableDice, useZoneFlights, onTop, flipFrom } from './tablekit.js'
import { fpPrefs, setFpPrefs, cardVars, CARD_PX } from './fpprefs.js'
import { lookup, isCreature, isLand, flipKind, CT, CT_ICON } from './game.js'
import { FORMAT } from './formats.js'
import { ask } from './confirm.jsx'
import { tx } from './i18n.js'
import { play, playFreeLog } from './sfx.js'
import TableChat from './TableChat.jsx'
import { usePen, PEN_COLS } from './tablepen.js'
import { useBackClose } from './backnav.js'
import HandLook from './HandLook.jsx'
import SideboardStep from './SideboardStep.jsx'

async function j(url, body) {
  const r = await fetch(url, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`)
  return d
}

const KEYS = 'abcd'
const FROM = { library: tx('da biblioteca'), hand: tx('da mão'), graveyard: tx('do cemitério'), exile: tx('do exílio'), command: tx('da zona de comando'), battlefield: tx('do campo') }
const TO = { library: tx('para o topo da biblioteca'), bottom: tx('para o fundo da biblioteca'), hand: tx('para a mão'), graveyard: tx('para o cemitério'), exile: tx('para o exílio'), command: tx('para a zona de comando'), battlefield: tx('para o campo') }
const HELP_K = 'grimorio.mesalivre.ajuda'
const short = n => String(n || '').split(' // ')[0]
const DESIG = { monarch: ['♛', tx('Monarca')], initiative: ['⚑', tx('Iniciativa')], blessing: ['🏙', tx('Bênção da cidade')] }
const MORE_CT = ['-1/-1', 'shield', 'stun', 'lore', 'time', 'defense', 'oil', 'charge', 'level']  // marcadores do submenu
const lsGet = k => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }

// uma linha do registo (o servidor manda-a estruturada, sem nomes escondidos)
function line(e, who) {
  const P = who(e.s), c = short(e.name), T = who(e.p)
  switch (e.k) {
    case 'start': return tx('A mesa abriu: cada um tem 7 cartas na mão.')
    case 'draw': return tx('{P} compra {n} carta|{P} compra {n} cartas', { P, n: e.n })
    case 'shuffle': return tx('{P} baralha a biblioteca', { P })
    case 'mulligan': return tx('{P} faz mulligan (nova mão de {n})', { P, n: e.n })
    case 'move': {
      const fr = e.fr === 'hand' && e.w != null && e.w !== e.s ? tx('da mão de {T}', { T: who(e.w) }) : FROM[e.fr]  // tirada da mão de outro (olhar para a mão)
      return e.tok ? tx('{P}: a ficha {c} sai do campo', { P, c }) : `${P}: ${c || tx('uma carta')} ${fr} ${TO[e.to === 'library' && e.bottom ? 'bottom' : e.to]}`
    }
    case 'flip': return tx('{P} transforma {c}', { P, c: c || tx('uma carta') })
    case 'face': return e.down ? tx('{P} vira uma carta para baixo', { P }) : tx('{P} vira {c} para cima', { P, c })
    case 'attack': return tx('{P} ataca {T} com {c}', { P, T: e.to ? short(e.to) : T, c: c || tx('uma carta virada para baixo') })
    case 'untapall': return tx('{P} desvira tudo', { P })
    case 'token': return tx('{P} cria a ficha {c}', { P, c })
    case 'life': return tx('{T}: vida {v} ({d})', { T, v: e.v, d: e.d > 0 ? `+${e.d}` : e.d })
    case 'poison': return tx('{T}: veneno {v} ({d})', { T, v: e.v, d: e.d > 0 ? `+${e.d}` : e.d })
    case 'dice': return tx('{P} lança {x}', { P, x: e.types.map((t, i) => `${t === 'moeda' ? tx('moeda') : t}: ${t === 'moeda' ? (e.v[i] === 1 ? tx('Cara') : tx('Coroa')) : e.v[i]}`).join(', ') })
    case 'reveal': return tx('{P} revela {c}', { P, c })
    case 'revealhand': return tx('{P} revela a mão: {x}', { P, x: (e.names || []).map(short).join(', ') })
    case 'peek': return tx('{P} olha para as {n} cartas do topo da biblioteca', { P, n: e.n })
    case 'lookhand': return tx('{P} olha para a mão de {T} ({n} carta)|{P} olha para a mão de {T} ({n} cartas)', { P, T, n: e.n })
    case 'mill': return tx('{P} moi {n} carta (do topo para o cemitério)|{P} moi {n} cartas (do topo para o cemitério)', { P, n: e.n })
    case 'exiletop': return tx('{P} exila {n} carta do topo da biblioteca|{P} exila {n} cartas do topo da biblioteca', { P, n: e.n })
    case 'pass': return tx('Turno {n}: é a vez de {T}', { n: e.turn, T })
    case 'concede': return tx('{P} desiste', { P })
    case 'chat': return `${P}: ${e.text}`
    case 'close': return tx('{P} terminou a mesa', { P })
    case 'propose': return e.p == null ? tx('{P} propõe: empate', { P }) : tx('{P} propõe: ganhou {T}', { P, T })
    case 'dispute': return tx('{P} não concorda com o resultado', { P })
    case 'result': return e.p == null ? tx('Resultado: empate') : tx('Resultado: ganhou {T} 🏆', { T })
    case 'newturn': return tx('{P} começa o turno: desvira tudo e compra {n}', { P, n: e.n })
    case 'newgame': return tx('{P} recomeça o jogo com o mesmo deck', { P })
    case 'energy': return tx('{T}: energia {v} ({d})', { T, v: e.v, d: e.d > 0 ? `+${e.d}` : e.d })
    case 'cmdmg': return tx('{T}: dano de comandante de {c} {v}/21 ({d})', { T, c, v: e.v, d: e.d > 0 ? `+${e.d}` : e.d })
    case 'mark': return e.on ? tx('{T} fica com: {x}', { T, x: DESIG[e.mk]?.[1] || e.mk }) : tx('{T} deixa de ter: {x}', { T, x: DESIG[e.mk]?.[1] || e.mk })
    case 'day': return e.v === 'day' ? tx('{P}: passa a ser dia', { P }) : e.v === 'night' ? tx('{P}: passa a ser noite', { P }) : tx('{P}: nem dia nem noite', { P })
    case 'phase': return e.out ? tx('{P}: {c} sai de fase', { P, c: c || tx('uma carta') }) : tx('{P}: {c} volta à fase', { P, c: c || tx('uma carta') })
    case 'attach': return tx('{P} prende {c} a {T}', { P, c: c || tx('uma carta'), T: short(e.to) || tx('uma carta virada para baixo') })
    case 'sidestart': return tx('Jogo seguinte da série: cada um escolhe o sideboard (até {n} s).', { n: e.n })
    case 'side': return tx('{P} já escolheu o sideboard', { P })
    case 'sidetime': return tx('Acabou o tempo do sideboard: cada um joga com a lista que tinha.')
    case 'gf': return tx('Adversário imaginário: vida {v} ({d})', { v: e.v, d: e.d > 0 ? `+${e.d}` : e.d })
    default: return e.k
  }
}

function MatModal({ onClose, onMat }) {
  useBackClose(true, onClose)
  return (
    <div className="fp-modal" onClick={onClose}><div className="fp-ask" onClick={e => e.stopPropagation()}>
      <h3>🎨 {tx('Padrão da mesa')}</h3>
      <p className="muted small">{tx('O teu lado da mesa fica com este padrão e os outros jogadores veem-no. Fica guardado neste aparelho.')}</p>
      <MatPick onMat={onMat} />
      <div className="row-btns"><button className="primary" onClick={onClose}>{tx('Feito')}</button></div>
    </div></div>
  )
}

function Help({ onClose }) {
  useBackClose(true, onClose)  // «voltar» do telemóvel fecha esta janela
  const P = fpPrefs(), K = { t: P.tap.toUpperCase(), f: P.flip.toUpperCase() }  // as teclas escolhidas em Definições › Mesa
  return (
    <div className="fp-modal" onClick={onClose}><div className="fp-ask ml-help" onClick={e => e.stopPropagation()}>
      <h3>🃏 {tx('Mesa livre · sem regras')}</h3>
      <p>{tx('Aqui não há bots nem regras automáticas: cada um mexe nas suas cartas, como numa mesa a sério. O que vale é o que combinarem entre vocês.')}</p>
      <ul>
        <li><b>{tx('Comprar')}</b> — {tx('toca duas vezes na tua biblioteca (ou D). Um toque abre o menu dela: comprar 2, ver o topo, baralhar, moer, exilar o topo.')}</li>
        <li><b>{tx('Jogar')}</b> — {tx('arrasta uma carta da mão para o teu lado da mesa (ou duplo clique).')}</li>
        <li><b>{tx('Virar (tap)')}</b> — {tx('clica numa carta tua na mesa (ou {k} com o rato por cima).', { k: K.t })}</li>
        <li><b>{tx('Atacar')}</b> — {tx('arrasta a tua criatura para o lado do adversário: fica virada e a atacar.')}</li>
        <li><b>{tx('Cemitério, exílio, mão, biblioteca')}</b> — {tx('arrasta a carta para o monte, ou usa o menu da carta (clique direito; no telemóvel, tocar e manter).')}</li>
        <li><b>{tx('Marcadores, virar para baixo, transformar, revelar')}</b> — {tx('no menu da carta.')}</li>
        <li><b>{tx('Auras e equipamentos')}</b> — {tx('larga-os em cima da carta (ou «Prender a…» no menu): ficam presos a ela e saem soltos se ela sair.')}</li>
        <li><b>{tx('Olhar para a mão de outro')}</b> — {tx('Thoughtseize, Duress, Peek…: toca no círculo da vida dele e escolhe «Olhar para a mão». Só tu vês as cartas (os outros sabem que olhaste) e mandas a escolhida para o cemitério, o exílio ou a biblioteca.')}</li>
        <li><b>{tx('Vida, veneno, energia, dano de comandante')}</b> — {tx('toca no círculo da vida de qualquer jogador; aí também o monarca, a iniciativa e a bênção da cidade.')}</li>
        <li><b>{tx('Dados e moeda')}</b> — {tx('no painel, ou agarra um dado na mesa e atira-o: todos veem o mesmo lançamento e o mesmo resultado.')}</li>
        <li><b>{tx('Caneta')}</b> — {tx('✏️ ou P: desenha na mesa para mostrar algo; os outros veem o risco ao vivo e ele apaga-se sozinho.')}</li>
        <li><b>{tx('Teclas')}</b> — {tx('com o rato por cima de uma carta tua na mesa, {t} vira-a e {f} transforma-a ou vira-a para baixo. D compra{sp}, V vê o topo, S baralha, M moe, X exila o topo, P caneta, Esc fecha.', { t: K.t, f: K.f, sp: P.space ? tx(' (Espaço também)') : '' })}</li>
        <li><b>{tx('Conversa')}</b> — {tx('as jogadas e as mensagens juntas; escreve @ para mostrar uma carta e # para uma regra.')}</li>
      </ul>
      <p className="muted small">{tx('Ninguém vê a tua mão nem a tua biblioteca (o servidor nem lhes manda os nomes). As cartas viradas para baixo só as vês tu.')}</p>
      <div className="row-btns"><button className="primary" onClick={onClose}>{tx('Percebi')}</button></div>
    </div></div>
  )
}

// a mesa e as seguintes da mesma série: a mesa acabada aponta para a do jogo seguinte (next) e passa-se para ela; quando
// o sideboard fecha, a mesa monta-se de novo (as medidas do tabuleiro e os dados contam com ele desde o início)
export default function FreeTable(props) {
  const [id, setId] = useState(props.id), [k, setK] = useState(0)
  return <Table key={`${id}.${k}`} {...props} id={id} onNext={setId} onBegin={() => setK(x => x + 1)} />
}

// o sideboard antes do jogo 2+ de uma série: o servidor só manda a lista dos meus lugares; dos outros, só se estão prontos
function SidePhase({ s, data, send, onClose }) {
  const sd = s.side, mine = Object.keys(sd.mine), [edit, setEdit] = useState(null), [left, setLeft] = useState(sd.to)
  useEffect(() => { const t0 = Date.now(), iv = setInterval(() => setLeft(Math.max(0, Math.round(sd.to - (Date.now() - t0) / 1000))), 1000); return () => clearInterval(iv) }, [s.seq])  // eslint-disable-line react-hooks/exhaustive-deps
  const cur = edit ?? mine.find(i => !sd.ok[i])
  const go = d => { setEdit(null); send({ c: 'side', seat: +cur, deck: { main: d.main, side: d.side } }) }
  const head = <>
    <h3>{tx('Sideboard para o jogo {g}', { g: sd.g || 2 })} <span className="muted small">{s.name}{cur != null && mine.length > 1 && ` · ${s.seats[cur]?.deck}`}</span></h3>
    <p className="row-btns small">{s.seats.map((v, i) => <span key={i} className={`ml-seat ${sd.ok[i] ? 'ready' : ''}`}><b>{v.name}</b> {sd.ok[i] == null ? <span className="muted">{tx('sem sideboard')}</span> : sd.ok[i] ? <span className="ok-t">✓ {tx('pronto')}</span> : <span className="muted">{tx('a escolher o sideboard…')}</span>}</span>)}</p>
    <p className="small muted">{tx('O jogo começa quando estiverem todos prontos, ou daqui a {n} s com a lista que cada um tiver.', { n: left })}</p>
  </>
  const who = i => (i == null ? tx('A mesa') : s.seats[i]?.name || '?'), n = s.seats.length
  return <div className="sbs-phase"><section className="card">
    {cur != null && sd.mine[cur]
      ? <SideboardStep key={cur} data={data} deck={sd.mine[cur].deck} base={sd.mine[cur].base} fmt={FORMAT[s.seats[cur]?.format]} onReady={go} onKeep={go}
        extra={onClose && <button onClick={onClose}>← {tx('sair da mesa')}</button>}>{head}</SideboardStep>
      : <>{head}<p><span className="spin-dot" /> {tx('À espera dos outros jogadores…')}</p>
        <div className="row-btns">{mine.map(i => <button key={i} onClick={() => setEdit(i)}>{tx('Mudar o sideboard')}{mine.length > 1 ? ` · ${s.seats[i]?.deck}` : ''}</button>)}
          {onClose && <button onClick={onClose}>← {tx('sair da mesa')}</button>}</div></>}
  </section>
  {/* a conversa da mesa continua enquanto se escolhe (só as mensagens e o «pronto» de cada um: ainda não há cartas) */}
  <aside className="sbs-chat"><TableChat log={s.log} who={who} keyOf={i => KEYS[(i - s.me + n) % n]} me={s.me} data={data} send={send} fmt={e => line(e, who)} names={[]} /></aside></div>
}

function Table({ id, data, onClose, onNext, onBegin }) {
  const [s, setS] = useState(null), [err, setErr] = useState(''), [zoom, setZoom] = useState(null), [zone, setZone] = useState(null), [menu, setMenu] = useState(null)
  const [help, setHelp] = useState(() => lsGet(HELP_K) !== '1'), [lift, setLift] = useState(null), [ver, setVer] = useState(0)
  const [seatSel, setSeatSel] = useState(null), seatQ = c => (seatSel != null ? `${c}seat=${seatSel}` : '')  // quem tem os dois decks de uma partida escolhe o lugar
  const [off, setOff] = useState(false)  // a ligação à mesa caiu (a espera longa falhou): volta a tentar sozinha
  const [chatOpen, setChatOpen] = useState(false), [seen, setSeen] = useState(0), [cardPop, setCardPop] = useState(null), [tokOpen, setTokOpen] = useState(false)
  const [phone, setPhone] = useState(() => matchMedia('(max-width: 900px)').matches)
  useEffect(() => { const q = matchMedia('(max-width: 900px)'), f = () => setPhone(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f) }, [])
  const [nDraw, setNDraw] = useState(1), [nPeek, setNPeek] = useState(3), [tok, setTok] = useState('')
  const [libMenu, setLibMenu] = useState(null), libClick = useRef(0), libT = useRef(0)  // a biblioteca: um clique = menu, dois = comprar
  const [pickAt, setPickAt] = useState(null)  // «prender a…»: a carta que espera o clique na carta de destino
  useEffect(() => {  // espera longa: o servidor responde quando alguém mexe (ou ao fim de 25 s)
    let live = true, since = 0
    ;(async () => {
      while (live) {
        try {
          const r = await j(`/api/freetables/${id}?since=${since}${seatQ('&')}`)
          if (!live) return
          since = r.seq; setS(x => (!x || r.seq >= x.seq ? r : x)); setErr(''); setOff(false)
        } catch (e) { if (!live) return; setErr(e.message); setOff(true); if (/não existe/.test(e.message)) return; await new Promise(ok => setTimeout(ok, 2000)) }
      }
    })()
    return () => { live = false }
  }, [id, seatSel]) // eslint-disable-line react-hooks/exhaustive-deps
  // ---------- ao vivo: o que eu agarro (a esfera de quem for, um dado, uma carta) os outros veem a mexer, e vice-versa ----------
  // ~10 vezes por segundo pelo canal «live» (só em memória no servidor); posição em frações da mesa, na vista de quem mexe
  const liveAt = useRef({}), liveOn = useRef(false)
  const live = v => {
    const now = Date.now()
    if (v.k !== 'end' && now - (liveAt.current[v.k] || 0) < 90) return
    if (v.k === 'end' && !liveOn.current) return
    liveAt.current[v.k] = now; liveOn.current = v.k !== 'end'
    j(`/api/freetables/${id}${seatQ('?')}`, { c: 'live', v }).catch(() => {})
  }
  const frac = (x, y) => { const r = fitTable.current?.getBoundingClientRect(); return r?.width ? { x: (x - r.left) / r.width, y: (y - r.top) / r.height } : null }
  const toScreen = g => {  // na minha vista: quem mexe e está do outro lado da mesa vê-a rodada 180°
    const fd = g.fx != null && fitTable.current?.querySelector(`.ml-field[data-seat="${g.seat}"]`)
    if (fd) {  // por cima do lado dele: o mesmo ponto do campo dele, que aqui pode estar em perspetiva — um marcador dentro do
      // campo dá o sítio no ecrã já com a inclinação (pela mesa inteira, a carta andava ~150 px abaixo de onde aterra)
      let q = fd.querySelector(':scope > .ml-probe')
      if (!q) { q = Object.assign(document.createElement('i'), { className: 'ml-probe' }); Object.assign(q.style, { position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }); fd.appendChild(q) }
      const m = fd.classList.contains('mirror')
      Object.assign(q.style, { left: `${(m ? 1 - g.fx : g.fx) * 100}%`, top: `${(m ? 1 - g.fy : g.fy) * 100}%` })
      const b = q.getBoundingClientRect()
      return { x: b.left, y: b.top }
    }
    const r = fitTable.current?.getBoundingClientRect(), top = fitTable.current?.querySelector(`.bside[data-seat="${g.seat}"]`)?.classList.contains('top')
    return r?.width ? { x: r.left + (top ? 1 - g.x : g.x) * r.width, y: r.top + (top ? 1 - g.y : g.y) * r.height } : null
  }
  useEffect(() => {  // a esfera que eu atiro/arrasto (a minha ou a dele)
    let idle = 0
    const f = e => {
      const d = e.detail
      if (!d?.el || d.remote || !d.local || !fitTable.current?.contains(d.el)) return
      const p = frac(d.x, d.y)
      if (p) live({ k: 'orb', id: +d.el.closest('.bside')?.dataset.seat || 0, ...p })
      clearTimeout(idle); idle = setTimeout(() => live({ k: 'end' }), 400)
    }
    addEventListener('grim-orb', f)
    return () => { removeEventListener('grim-orb', f); clearTimeout(idle) }
  }, [id])  // eslint-disable-line react-hooks/exhaustive-deps
  const ghosts = Object.entries(s?.live || {}).map(([seat, v]) => ({ seat: +seat, ...v }))
  const ghostKey = JSON.stringify(s?.live || {})
  const dropAt = useRef({})  // lugar -> a carta que ele arrasta: {id, x, y (no meu ecrã), key (onde estava), end (quando a largou)}
  const handed = g => { const d = dropAt.current[g.seat]; return !!d && d.id === g.id && (d.gone || cardKey(g.id) !== d.key) }  // a carta dele já aterrou (o «largou» pode chegar depois)
  const cardKey = cid => { const e = byId.get(cid); return e ? `${e.seat}|${e.z}|${e.c.x}|${e.c.y}|${e.c.at}|${e.c.atk}` : '' }
  useEffect(() => {
    const now = Date.now()
    for (const [seat, d] of Object.entries(dropAt.current)) if (!ghosts.some(g => g.seat === +seat && g.k === 'card')) { if (d.gone) delete dropAt.current[seat]; else d.end ??= now }
    for (const g of ghosts) if (g.k === 'card' && !handed(g)) { const p = toScreen(g); if (p) dropAt.current[g.seat] = { id: g.id, ...p, key: cardKey(g.id) } }
    if (Object.values(dropAt.current).some(d => d.end)) { const t = setTimeout(() => redraw(x => x + 1), 950); return () => clearTimeout(t) }  // o fantasma que ficou à espera sai
  }, [ghostKey])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // a esfera que o outro está a mexer: segue o que ele manda
    for (const g of ghosts) if (g.k === 'orb') { const p = toScreen(g); p && fitTable.current?.querySelector(`.bside[data-seat="${g.id}"] .orb`)?._remoteTo?.(p.x, p.y) }
  }, [ghostKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const send = c => j(`/api/freetables/${id}${seatQ('?')}`, c).then(r => { setS(x => (!x || r.seq >= x.seq ? r : x)); return r }).catch(e => { setErr(e.message); setTimeout(() => setErr(''), 4000) })
  const me = s?.me ?? 0, seats = s?.seats || [], n = seats.length
  const allArts = Object.fromEntries(seats.map((v, i) => [i, v.arts]))  // a arte escolhida em cada deck (a carta em grande)
  const keyOf = i => KEYS[(i - me + n) % n]
  // sons: cada entrada nova do registo (de quem for) soa como na réplica; ao abrir a mesa o histórico não soa
  const heard = useRef(null)
  useEffect(() => {
    const log = s?.log || [], top = log.reduce((m, e) => Math.max(m, e.id || 0), 0)
    if (heard.current == null) { heard.current = top; return }
    for (const e of log) if ((e.id || 0) > heard.current) playFreeLog(e, keyOf(['life', 'poison', 'energy', 'cmdmg'].includes(e.k) ? e.p ?? e.s : e.s), name => isLand(data, { name }))  // p: o lugar afetado (vida…); no ataque é o atacado
    heard.current = Math.max(heard.current, top)
  }, [s?.log])  // eslint-disable-line react-hooks/exhaustive-deps
  const who = i => (i == null ? tx('A mesa') : seats[i]?.name || '?')
  // todas as cartas que vejo, pelo id: onde estão e de quem
  const byId = useMemo(() => {
    const m = new Map()
    seats.forEach((v, i) => ['hand', 'battlefield', 'graveyard', 'exile', 'command', 'top'].forEach(z => (v[z] || []).forEach(c => m.set(c.id, { c, seat: i, z }))))
    return m
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  // a vida mudou: o orbe pisca com o +N/−N
  const lives = seats.map(v => v.life).join('|'), prevLives = useRef(null), [lifeFx, setLifeFx] = useState(null)
  useEffect(() => {
    const now = lives.split('|').map(Number), pv = prevLives.current
    prevLives.current = now
    if (!pv || pv.length !== now.length) return
    const i = now.findIndex((x, k) => x !== pv[k])
    if (i < 0) return
    setLifeFx({ p: keyOf(i), d: now[i] - pv[i] })
    const t = setTimeout(() => setLifeFx(null), 1200); return () => clearTimeout(t)
  }, [lives]) // eslint-disable-line react-hooks/exhaustive-deps
  // o que mudou nas cartas do campo (marcadores, transformar/virar) e no veneno: os mesmos números a saltar da arena
  const prevC = useRef(null), [pops, setPops] = useState(() => new Map()), [psnFx, setPsnFx] = useState(null)
  useEffect(() => {
    if (!s) return
    const now = new Map(), out = new Map()
    s.seats.forEach(v => v.battlefield.forEach(c => now.set(c.id, c)))
    const pv = prevC.current
    prevC.current = { cards: now, psn: s.seats.map(v => v.poison) }
    if (!pv) return
    for (const [id, c] of now) {
      const o = pv.cards.get(id)
      if (!o) continue
      for (const k of new Set([...Object.keys(c.k || {}), ...Object.keys(o.k || {})])) {
        const d = (c.k?.[k] || 0) - (o.k?.[k] || 0)
        if (d) out.set(String(id), { i: s.seq, kind: d < 0 && (k === 'loyalty' || k === 'defense') ? 'dmg' : 'ctr', n: d, ct: k })
      }
      if (!!c.f !== !!o.f || !!c.d !== !!o.d) out.set(String(id), { i: s.seq, kind: 'flip' })
    }
    const pi = s.seats.findIndex((v, i) => v.poison > (pv.psn[i] ?? v.poison))
    if (pi >= 0) { setPsnFx({ p: keyOf(pi) }); setTimeout(() => setPsnFx(null), 1200) }
    if (out.size) { setPops(out); const t = setTimeout(() => setPops(new Map()), 1200); return () => clearTimeout(t) }
  }, [s?.seq]) // eslint-disable-line react-hooks/exhaustive-deps
  // dados: o servidor sorteia; cada ecrã lança os dados 3D que assentam nesses valores
  // agarrar um dado e largá-lo pede ao servidor um lançamento com esse gesto; todos veem o mesmo, cada um do seu lado
  const throwDice = (types, thr) => j(`/api/freetables/${id}${seatQ('?')}`, { c: 'dice', types, thr }).then(r => setS(x => (!x || r.seq >= x.seq ? r : x)))
  const diceBox = useRef(null), dice = useTableDice(diceBox, { box: [11, 10], rot: (s?.me || 0) ? Math.PI : 0, keep: 30000, onThrow: throwDice,
    onDrag: (x, y) => { const p = x != null && frac(x, y); if (p) live({ k: 'die', ...p }); else live({ k: 'end' }) } }), rollSeen = useRef(null)
  useEffect(() => {
    const r = s?.roll
    if (!s) return
    if (rollSeen.current === null) { rollSeen.current = r?.n || 0; return }  // ao abrir a mesa não se relança o último
    if (r && r.n !== rollSeen.current) { rollSeen.current = r.n; dice.roll(r.types, r.v, { seed: r.seed, thr: r.thr }) }
  }, [s?.roll?.n, !!s]) // eslint-disable-line react-hooks/exhaustive-deps
  const fitBox = useRef(null), fitTable = useRef(null), stageWrap = useRef(null), peek = usePeek(), hoverId = useRef(null), downAt = useRef({ x: 0, y: 0 })
  const stage = useStage(fitBox, stageWrap, !!s, phone ? 62 : true)  // telemóvel: a barra das ações fica fixa em baixo
  const penLayer = useRef(null), pen = usePen({ table: fitTable, layer: penLayer, me, flip: me !== 0, send, chunks: s?.pen })
  useOverlap(fitTable)
  // cartas que vêm do cemitério/exílio (reanimar, devolver) ou da mão de outro jogador: voam do monte para o campo
  useZoneFlights(fitTable, `${s?.seq}|${ver}`, () => {
    const m = new Map()
    seats.forEach((v, i) => ['hand', 'graveyard', 'exile', 'battlefield'].forEach(z => (v[z] || []).forEach(c => m.set(c.id, {
      z, fly: z === 'battlefield' || (z === 'hand' && i === me), src: z === 'hand' ? (i === me ? null : `.bside[data-seat="${i}"] .fp-hand`) : z === 'battlefield' ? null : `.bside[data-seat="${i}"] [data-zone="${z}"]`,
      ...(z === 'hand' && i === me && { from: `.bside[data-seat="${i}"] [data-zone="library"]` }) }))))  // comprada (ou do topo espreitado): voa da biblioteca
    return m
  })
  // a carta que o outro arrastou e largou: o fantasma dele fica onde a largou até a jogada chegar (antes sumia e, um
  // instante depois, a carta voava da mão dele, longe dali) e a carta parte desse sítio (corre entre os voos e o useFlip)
  useLayoutEffect(() => {
    for (const [seat, d] of Object.entries(dropAt.current)) {
      if (d.gone) continue
      if (cardKey(d.id) === d.key) { if (d.end && Date.now() - d.end > 900) delete dropAt.current[seat]; continue }  // a jogada ainda não chegou
      // a jogada chegou (às vezes antes do «largou»: são dois pedidos): a carta parte do fantasma e ele sai já
      if (byId.get(d.id)?.z === 'battlefield') flipFrom.set(String(d.id), { left: d.x - 27, top: d.y - 38, width: 54, height: 75 })
      d.gone = true
    }
  }, [s?.seq])  // eslint-disable-line react-hooks/exhaustive-deps
  useFlip(fitTable, `${s?.seq}|${ver}`)
  const [, redraw] = useState(0)
  const P = fpPrefs()
  const myField = () => fitTable.current?.querySelector(`.ml-field[data-seat="${me}"]`)
  const kindOf = c => (!c?.n ? 'front' : isLand(data, { name: c.n }) ? 'lands' : isCreature(data, { name: c.n, token: c.tok }) || c.tok || /\b(Planeswalker|Battle)\b/.test(lookup(data, c.n)?.t || '') ? 'front' : 'others')
  const spot = (c, x, y) => { const f = myField(); if (!f) return { x: 0.5, y: 0.5 }; const r = f.getBoundingClientRect(); return spotOn(f, x ?? r.left + r.width / 2, y ?? r.top + r.height * 0.45, kindOf(c), P.place !== 'free', c?.id) }
  const mv = (cid, to, extra) => send({ c: 'move', id: cid, to, ...extra })
  // a biblioteca: um clique abre o menu (com os atalhos); dois cliques compram (sem abrir o menu)
  const onLib = () => {
    const now = Date.now(), pile = document.querySelector(`.bside[data-seat="${me}"] [data-zone="library"]`)?.getBoundingClientRect()
    if (now - (libClick.current || 0) < 300 && libT.current?.id === 'lib') { clearTimeout(libT.current.t); libClick.current = 0; setLibMenu(null); return send({ c: 'draw', n: 1 }) }
    libClick.current = now; clearTimeout(libT.current?.t)
    libT.current = { id: 'lib', t: setTimeout(() => pile && setLibMenu({ x: Math.max(8, Math.min(innerWidth - 250, pile.left - 90)), y: Math.max(8, pile.top - 250) }), 280) }
  }
  const toField = (cid, extra) => {
    const e = byId.get(cid), w = spot(e?.c), cd = e?.c?.n && !extra?.down && lookup(data, e.c.n), fromField = e?.z === 'battlefield'
    const k = cd && /^\d+$/.test(cd.pt || '') && (/Planeswalker/.test(cd.t) ? 'loyalty' : /\bBattle\b/.test(cd.t) ? 'defense' : null)
    return mv(cid, 'battlefield', { x: w.x, y: w.y, seat: me, ...extra }).then(r => (k && !fromField && r ? send({ c: 'counter', id: cid, k, d: +cd.pt }) : r))
  }
  const tap = cid => { play('tick', { amount: 1 }); send({ c: 'tap', id: cid }) }
  const turnOver = cid => { const e = byId.get(cid), cd = e && lookup(data, e.c.n); return send(flipKind(cd) ? { c: 'flip', id: cid } : { c: 'face', id: cid }) }  // F: transformar (duas faces / carta flip) ou virar para baixo
  const attach = (cid, to) => { play('tick', { amount: 1 }); return send({ c: 'attach', id: cid, to }) }

  // ---------- arrastar ----------
  const preview = m => {  // enquanto arrastas por cima do teu lado: a casa onde a carta vai ficar
    const f = myField(), old = f?.querySelector('.fp-slot')
    const on = m && f && m.target?.closest('.ml-field') === f
    if (!on) { old?.remove(); f?.classList.remove('fp-placing'); return }
    const sp = spot(byId.get(m.id)?.c, m.x, m.y), el = old || Object.assign(document.createElement('div'), { className: 'fp-slot' })
    if (!old) f.appendChild(el)
    if (P.place !== 'free') { f.classList.add('fp-placing'); f.style.setProperty('--sx', `${sp.sx}px`); f.style.setProperty('--sy', `${sp.sy}px`) }
    Object.assign(el.style, { left: `${sp.px - sp.w / 2}px`, top: `${sp.py - sp.h / 2}px`, width: `${sp.w}px`, height: `${sp.h}px` })
  }
  const drop = ({ id: cid, from, target, x, y }) => {
    if (!target?.closest('.fp-table')) return false
    const e = byId.get(cid)
    const pile = target.closest('.bside')?.dataset.seat === String(me) && target.closest('[data-zone]')?.dataset.zone
    if (pile) { mv(cid, pile); return 'leave' }  // sai de onde estava: o fantasma espera pela resposta (não volta ao sítio)
    if (target.closest('.fp-hand.mine')) {
      if (from === 'hand') {  // dentro da mão: mudar a ordem (só no teu ecrã)
        const h = target.closest('[data-h]')?.dataset.h, ids = (seats[me]?.hand || []).map(c => String(c.id)).filter(k => k !== String(cid))
        const i = h ? ids.indexOf(h) : -1
        ids.splice(i < 0 ? ids.length : i, 0, String(cid)); setHandOrder(ids); return 'local'
      }
      mv(cid, 'hand'); return 'leave'
    }
    const field = target.closest('.ml-field'), seat = field && +field.dataset.seat
    // aura, equipamento, fortificação (não é criatura) largada em cima de uma carta do campo: fica presa a ela
    const host = target.closest('.ml-field .pc[data-z^="k:"]'), hid = host && +host.dataset.z.slice(2)
    if (host && hid !== cid && e?.c.n && !isCreature(data, { name: e.c.n }) && !isLand(data, { name: e.c.n })) {
      if (from === 'field') { attach(cid, hid); return true }
      const w = spot(e.c); play('tick', { amount: 1 }); mv(cid, 'battlefield', { x: w.x, y: w.y, seat: me, at: hid }); return true  // num só comando: antes ia para uma casa livre e só depois saltava para a carta
    }
    if (field && seat === me) {
      const w = spot(e?.c, x, y)
      if (from === 'field') {  // no teu lado: muda de sítio já no ecrã (o servidor confirma a seguir)
        setS(v => ({ ...v, seats: v.seats.map((st, i) => (i !== me ? st : { ...st, battlefield: [...st.battlefield.filter(c => c.id !== cid), { ...st.battlefield.find(c => c.id === cid), x: w.x, y: w.y }] })) }))
        setVer(v => v + 1)
        mv(cid, 'battlefield', { x: w.x, y: w.y, seat: me }); return 'local'
      }
      mv(cid, 'battlefield', { x: w.x, y: w.y, seat: me }); return true
    }
    if (field && from === 'field') { play('tick', { amount: 1 }); send({ c: 'attack', id: cid, seat }); return false }  // no lado de outro: atacar (a carta volta e fica virada)
    return false
  }
  const [big, setBig] = useState(null)  // tocar e manter numa carta que não é tua: em grande (as tuas abrem o menu)
  const previewLive = m => {  // a carta que arrasto: os outros veem-na a andar (de face se a podem ver, senão o verso)
    preview(m)
    const p = m && frac(m.x, m.y)
    // por cima do meu lado (que aqui está direito): também em frações do meu campo, para os outros o verem na perspetiva deles
    const f = p && myField()?.getBoundingClientRect(), sd = p && fitTable.current?.querySelector(`.bside[data-seat="${me}"]`)?.getBoundingClientRect()
    const own = f?.width && sd && m.x >= sd.left && m.x <= sd.right && m.y >= sd.top && m.y <= sd.bottom
    if (p) live({ k: 'card', id: m.id, ...p, ...(own && { fx: (m.x - f.left) / f.width, fy: (m.y - f.top) / f.height }) }); else if (!m) live({ k: 'end' })
  }
  const { down, dragged } = useDrag(drop, cid => openMenu(cid, downAt.current.x, downAt.current.y), previewLive, '[data-h], .bside.bottom .pc[data-z^="k:"]', el => { const z = el?.dataset.z, id = z?.startsWith('k:') ? +z.slice(2) : +el?.dataset.zid, n = byId.get(id)?.c?.n; if (n) setBig(n) })
  const [handOrder, setHandOrder] = useState(null)
  const openMenu = (cid, x, y) => { const e = byId.get(cid); if (!e || (e.z === 'hand' && e.c.o !== me)) return; setMenu({ id: cid, x, y }); setZoom(byId.get(cid)?.c.n || null); peek.hide() }

  // ---------- teclas: T virar, F virar a carta/transformar, Espaço comprar, Esc fecha ----------
  useEffect(() => {
    const k = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') { setMenu(null); setZone(null); pen.setOn(false); return }
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); pen.setOn(v => !v); return }
      const P2 = fpPrefs(), hv = hoverId.current, onField = hv != null && byId.get(hv)?.z === 'battlefield'
      const lk = { d: () => send({ c: 'draw', n: 1 }), v: () => send({ c: 'peek', n: 3 }), s: () => send({ c: 'shuffle' }), m: () => send({ c: 'mill', n: 1 }), x: () => send({ c: 'exiletop', n: 1 }) }[e.key.toLowerCase()]
      if (lk && !e.shiftKey && s?.status === 'playing' && e.key.toLowerCase() !== P2.tap && e.key.toLowerCase() !== P2.flip) { e.preventDefault(); setLibMenu(null); lk(); return }  // biblioteca: D comprar, V ver o topo, S baralhar, M moer, X exilar o topo
      if (e.key.toLowerCase() === P2.tap && onField) { e.preventDefault(); tap(hv) } else if (e.key.toLowerCase() === P2.flip && onField) { e.preventDefault(); turnOver(hv) } else if (e.key === ' ' && P2.space && s?.status === 'playing') { e.preventDefault(); send({ c: 'draw', n: 1 }) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })

  // o meu tapete (guardado neste aparelho) vai para o meu lugar: os outros veem-no
  const myMat = s?.seats?.[s.me]?.mat ?? null, hasSeat = !!s?.seats?.[s?.me]
  useEffect(() => { if (hasSeat && myMat !== fpPrefs().mat) send({ c: 'mat', v: fpPrefs().mat }) }, [hasSeat, myMat])  // eslint-disable-line react-hooks/exhaustive-deps
  // a minha esfera da vida também (o amigo vê a que escolhi)
  const myOrb = JSON.stringify(s?.seats?.[s.me]?.orb || { t: 'auto', a: 'auto' })
  useEffect(() => { if (hasSeat && myOrb !== JSON.stringify(fpPrefs().orb)) send({ c: 'orb', v: fpPrefs().orb }) }, [hasSeat, myOrb])  // eslint-disable-line react-hooks/exhaustive-deps
  const [matOpen, setMatOpen] = useState(false)
  // série: o jogo seguinte já tem mesa (quem aloja marcou o resultado ou o jogo acabou): passa-se para ela sozinho
  useEffect(() => { if (s?.next) { const t = setTimeout(() => onNext(s.next), 6000); return () => clearTimeout(t) } }, [s?.next])  // eslint-disable-line react-hooks/exhaustive-deps
  const sidePh = s?.status === 'side', wasSide = useRef(false)
  useEffect(() => { if (sidePh) wasSide.current = true; else if (wasSide.current) onBegin() }, [sidePh])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <div className="fp-wait">{err ? <p className="bad-t">{err}</p> : <p className="muted"><span className="spin-dot" /> {tx('A abrir a mesa…')}</p>}</div>
  if (sidePh) return <SidePhase s={s} data={data} send={send} onClose={onClose} />
  const mine = seats[me], ended = s.status !== 'playing'
  const others = Array.from({ length: n - 1 }, (_, k) => (me + 1 + k) % n)
  const fx = { hl: new Set(), par: 0, pops: new Map(), life: lifeFx, player: null }
  const hs = { active: keyOf(s.active), exact: true, i: s.seq, sides: [] }
  const zOf = v => ({ life: v.life, library: v.library, hand: v.hand.length, known: [], graveyard: v.graveyard.map(c => c.n), exile: v.exile.map(c => c.n), command: [], cmdDmg: v.cd || {}, poison: v.poison, energy: v.energy || 0, emblems: [], out: false, perms: [],
    monarch: v.mk?.includes('monarch'), initiative: v.mk?.includes('initiative'), blessing: v.mk?.includes('blessing') })
  const handOf = v => (handOrder ? [...v.hand].sort((a, b) => { const i = handOrder.indexOf(String(a.id)), k = handOrder.indexOf(String(b.id)); return (i < 0 ? 1e9 : i) - (k < 0 ? 1e9 : k) }) : v.hand)
  const permOf = c => ({ key: String(c.id), name: c.n || '', hidden: !c.n, tapped: !!c.t, flipped: !!c.f, token: !!c.tok, counters: c.k || {}, attacking: c.atk != null ? keyOf(c.atk) : undefined, atkKey: c.atc != null ? String(c.atc) : undefined, atkName: c.atc != null ? byId.get(c.atc)?.c?.n : undefined, faceDown: !!c.d && !!c.n, phased: !!c.ph })
  const onField = new Set(seats.flatMap(v => v.battlefield.map(c => c.id)))
  const attOf = new Map()  // carta -> as que estão presas a ela
  for (const v of seats) for (const c of v.battlefield) if (c.at != null && onField.has(c.at)) attOf.set(c.at, [...(attOf.get(c.at) || []), permOf(c)])
  const side = (i, top, compact) => {
    const v = seats[i], k = keyOf(i), isMe = i === me
    const cmd = v.command.length > 0 && <div className="ml-cmd" title={tx('Zona de comando')}>{v.command.map(c => (
      <span key={c.id} className="ml-cz" {...(isMe ? { 'data-h': c.id, 'data-from': 'command' } : { 'data-zid': c.id })}><FCard c={{ id: c.id, name: c.n }} data={data} />{c.cc > 0 && <b className="ml-tax" title={tx('Imposto de comandante: lançado {n}× da zona de comando, custa mais {x}', { n: c.cc, x: 2 * c.cc })}>+{2 * c.cc}</b>}</span>))}</div>
    const hand = isMe
      ? <div className="fp-hand mine">{handOf(v).map(c => <FCard key={c.id} c={{ id: c.id, name: c.n }} h={c.id} data={data} big cls={`${c.r ? 'ml-rev' : ''} ${lift === c.id ? 'lift' : ''}`} />)}</div>
      : <div className="fp-hand opp" title={tx('{n} carta na mão|{n} cartas na mão', { n: v.hand.length })}>{v.hand.map(c => <FCard key={c.id} c={{ id: c.id, name: c.n, hidden: !c.n }} data={data} cls={c.n ? 'ml-rev' : ''} />)}</div>
    const hud = <Hud k={k} z={zOf(v)} name={`${v.name}${v.out ? ' 🏳' : ''}`} fmt={FORMAT[v.format]?.name || null} s={hs} data={data} fx={{ ...fx, player: psnFx?.p === k ? { p: k, psn: true } : null }} fast={false} start={v.life > 20 ? 40 : 20}
      openZone={() => {}} top={top} hand={<>{cmd}{hand}</>} openLib={isMe ? onLib : null} />
    const field = (
      <div className={`ml-field ${top ? 'mirror' : ''}`} data-seat={i}>
        {v.battlefield.filter(c => !(c.at != null && onField.has(c.at))).map(c => {
          const left = top ? 1 - (c.x ?? 0.5) : c.x ?? 0.5, tp = top ? 1 - (c.y ?? 0.5) : c.y ?? 0.5
          return (
            <div key={c.id} className={`bfree-c ${kindOf(c)} ${pickAt != null && pickAt !== c.id ? 'ml-pick' : ''}`} style={{ left: `clamp(calc(var(--w) * .5), ${left * 100}%, calc(100% - var(--w) * .5))`, top: `clamp(calc(var(--w) * .7), ${tp * 100}%, calc(100% - var(--w) * .7))` }}>
              <Perm p={permOf(c)} data={data} hl={0} pop={pops.get(String(c.id)) || null} att={attOf.get(c.id)} n={0} quiet={false} tgt={c.atk != null ? [keyOf(c.atk), short(c.atc != null ? byId.get(c.atc)?.c?.n || who(c.atk) : who(c.atk))] : null} />
            </div>)
        })}
        {!v.battlefield.length && isMe && <span className="ml-empty">{tx('o teu lado da mesa: arrasta para aqui as cartas da mão')}</span>}
      </div>
    )
    return (<Arts.Provider key={i} value={{ arts: { [k]: v.arts }, k }}><OrbCtx.Provider value={{ mine: isMe ? k : null, seed: s?.id || '', looks: !isMe && v.orb ? { [k]: v.orb } : null }}>
      <div className={`bside ml-side ${top ? 'top' : 'bottom'} ${s.active === i ? 'act' : ''} ${compact ? 'compact' : ''} ${v.out ? 'out' : ''} p-${k}`} data-seat={i} data-mat={(isMe || !P.mats ? P.mat : v.mat) || undefined}
        onClickCapture={e => { const z = e.target.closest('[data-zone]')?.dataset.zone; if (z === 'graveyard' || z === 'exile') { e.stopPropagation(); setZone({ seat: i, which: z }) } }}>
        {top ? <>{hud}{field}</> : <>{field}{hud}</>}
      </div></OrbCtx.Provider></Arts.Provider>
    )
  }

  // ---------- cliques ----------
  const onClick = e => {
    if (dragged.current) return
    const h = e.target.closest('[data-h]')
    if (h) { const cid = +h.dataset.h; setLift(l => (l === cid ? null : cid)); setZoom(byId.get(cid)?.c.n || null); return }
    const pc = e.target.closest('.pc[data-z^="k:"]')
    if (pickAt != null) { const to = pc && +pc.dataset.z.slice(2); if (to != null && to !== pickAt) attach(pickAt, to); setPickAt(null); return }
    if (pc) { const cid = +pc.dataset.z.slice(2); if (pc.closest('.bside')?.dataset.seat === String(me)) tap(cid); else setZoom(byId.get(cid)?.c.n || null); return }
    const orb = e.target.closest('.orb')
    if (orb) { const r = orb.getBoundingClientRect(); setMenu({ life: +orb.closest('.bside').dataset.seat, x: r.right, y: r.top }) }
  }
  const onDouble = e => {  // duplo clique numa carta da mão (ou da zona de comando) = jogá-la no teu lado
    const h = e.target.closest('[data-h]')
    if (!h || dragged.current) return
    setLift(null); play('tick', { amount: 1 }); toField(+h.dataset.h)
  }
  const onCtx = e => {
    const el = e.target.closest('[data-h], .pc-attc[data-z], .pc[data-z^="k:"], [data-zid]')
    if (!el) return
    e.preventDefault()
    openMenu(+(el.dataset.h || el.dataset.zid || el.dataset.z.slice(2)), e.clientX, e.clientY)
  }
  const onOver = e => {
    peek.over(e.target.closest('.fp-table .pc-attc[data-z], .fp-table .pc[data-z^="k:"]'))
    const el = e.target.closest('[data-h], [data-zid], .pc-attc[data-z], .pc[data-z^="k:"]')
    const cid = el ? +(el.dataset.h || el.dataset.zid || el.dataset.z.slice(2)) : null
    hoverId.current = cid
    const c = cid != null && byId.get(cid)?.c
    if (c?.n) setZoom(c.n)
  }
  const tilt = e => {
    const el = e.target.closest('.pc, .fp-card')
    if (!el) return
    const q = el.getBoundingClientRect()
    el.style.setProperty('--tx', ((e.clientX - q.left) / q.width - 0.5).toFixed(3)); el.style.setProperty('--ty', ((e.clientY - q.top) / q.height - 0.5).toFixed(3))
  }

  // ---------- menu da carta (o que é menos comum) ----------
  const menuItems = () => {
    if (menu.more) return [
      [P.persp ? tx('▭ Mesa sem perspetiva') : tx('⏢ Lado dos outros em perspetiva'), () => { setFpPrefs({ persp: !fpPrefs().persp }); redraw(x => x + 1) }],
      ['🂠 ' + tx('Tamanho das cartas: {x} (muda para o seguinte)', { x: P.cardPx ? `${P.cardPx} px` : tx('automático') }), () => { const i = CARD_PX.indexOf(fpPrefs().cardPx); setFpPrefs({ cardPx: CARD_PX[(i + 1) % CARD_PX.length] }); redraw(x => x + 1) }],
      ['🎨 ' + tx('Padrão da mesa'), () => setMatOpen(true)],
      ['❓ ' + tx('Como se joga aqui'), () => setHelp(true)],
      [s.day === 'day' ? '☾ ' + tx('Passar a noite') : '☀ ' + tx('Passar a dia'), () => send({ c: 'day' })],
      ...(s.day ? [['◌ ' + tx('Tirar o dia/noite'), () => send({ c: 'day', v: null })]] : []),
      ...(s.solo && !ended ? [['⟲ ' + tx('Novo jogo com o mesmo deck'), async () => { if (await ask('mesalivre-novo', { title: tx('Recomeçar com o mesmo deck?'), body: tx('Todas as cartas voltam à biblioteca, baralhas e compras 7; a vida e o turno recomeçam.'), ok: tx('Recomeçar'), danger: false })) send({ c: 'newgame' }) }]] : []),
      ...(!s.solo && !ended ? [['🏆 ' + tx('Ganhei este jogo'), () => send({ c: 'result', w: me })], ...others.map(i => ['🏆 ' + tx('Ganhou {p}', { p: who(i) }), () => send({ c: 'result', w: i })]), ['🤝 ' + tx('Empate'), () => send({ c: 'result', w: null })]] : []),
      ...(!s.solo && !mine?.out && !ended ? [['🏳 ' + tx('Desistir'), async () => { if (await ask('mesalivre-desistir', { title: tx('Desistir deste jogo?'), ok: tx('Desistir') })) send({ c: 'concede' }) }]] : []),
      ...(s.host && !ended ? [['■ ' + tx('Terminar a mesa'), async () => { if (await ask('mesalivre-terminar', { title: s.solo ? tx('Terminar esta mesa?') : tx('Terminar a mesa para todos?'), body: tx('A mesa fica só para ver; ninguém pode jogar mais nela.'), ok: tx('Terminar') })) send({ c: 'close' }) }]] : []),
      ...(onClose ? [['← ' + tx('Sair da mesa'), onClose]] : []),
    ]
    if (menu.life != null) {
      const i = menu.life, v = seats[i], L = (c, d, x) => () => send({ c, seat: i, d, ...x }), pm = (c, x) => [['−1', L(c, -1, x)], ['+1', L(c, 1, x)]]
      // comandantes dos outros (zona de comando ou campo): o dano de cada um conta à parte
      const cmdrs = [...new Set(seats.flatMap((w, j) => (j === i ? [] : [...w.command, ...w.battlefield].filter(c => c.cm && c.n).map(c => c.n))))]
      return [[tx('Vida de {p}: {v}', { p: who(i), v: v.life }), null, [['−5', L('life', -5)], ['−1', L('life', -1)], ['+1', L('life', 1)], ['+5', L('life', 5)]]],
        [`☠ ${tx('veneno')} ${v.poison}`, null, pm('poison')], [`ϟ ${tx('energia')} ${v.energy || 0}`, null, pm('energy')],
        ...cmdrs.map(n => [`⚔ ${short(n)} ${v.cd?.[n] || 0}/21`, null, pm('cmdmg', { name: n })]),
        ...Object.entries(DESIG).map(([k, [ic, l]]) => [`${ic} ${l}${v.mk?.includes(k) ? ' ✓' : ''}`, () => send({ c: 'mark', seat: i, k })]),
        ...(i !== me && !ended ? [['👁 ' + tx('Olhar para a mão (só tu vês)'), () => send({ c: 'lookhand', seat: i })]] : [])]
    }
    if (menu.ctr != null) {  // submenu dos marcadores: −/+ por tipo
      const cid = menu.ctr, c = byId.get(cid)?.c
      return [[tx('Marcadores'), null], ...MORE_CT.map(k => [`${CT_ICON[k] || ''} ${CT[k] || k} ${c?.k?.[k] || 0}`, null, [['−', () => send({ c: 'counter', id: cid, k, d: -1 })], ['＋', () => send({ c: 'counter', id: cid, k, d: 1 })]]])]
    }
    const e = byId.get(menu.id)
    if (!e) return []
    const { c, z } = e, cid = c.id, cd = lookup(data, c.n), owner = c.o === me
    const ctr = (k, d) => () => send({ c: 'counter', id: cid, k, d })
    const to = [['✋ ' + tx('Para a mão'), () => mv(cid, 'hand')], ['⚰ ' + tx('Para o cemitério'), () => mv(cid, 'graveyard')], ['⌀ ' + tx('Para o exílio'), () => mv(cid, 'exile')],
      ['▤ ' + tx('Topo da biblioteca'), () => mv(cid, 'library')], ['▥ ' + tx('Fundo da biblioteca'), () => mv(cid, 'library', { bottom: true })]].filter((_, k) => !(z === 'hand' && k === 0) && !(z === 'graveyard' && k === 1) && !(z === 'exile' && k === 2))
    const head = [[short(c.n) || tx('Carta virada para baixo'), null]]
    if (z === 'battlefield') {
      const opp = others.filter(i => !seats[i].out)
      return [...head, [c.t ? tx('↺ Desvirar') : tx('↻ Virar (tap)'), () => tap(cid)],
        ...opp.flatMap(i => [['⚔ ' + tx('Atacar {p}', { p: who(i) }), () => send({ c: 'attack', id: cid, seat: i })],
          ...seats[i].battlefield.filter(x => x.n && /\b(Planeswalker|Battle)\b/.test(lookup(data, x.n)?.t || '')).map(x => ['⚔ ' + tx('Atacar {p}', { p: short(x.n) }), () => send({ c: 'attack', id: cid, seat: i, card: x.id })])]), ...(c.atk != null ? [[tx('Deixar de atacar'), () => send({ c: 'attack', id: cid, seat: null })]] : []),
        [`+1/+1 ${c.k?.['+1/+1'] || 0}`, null, [['−', ctr('+1/+1', -1)], ['＋', ctr('+1/+1', 1)]]], [`${tx('Lealdade')} ${c.k?.loyalty || 0}`, null, [['−', ctr('loyalty', -1)], ['＋', ctr('loyalty', 1)]]],
        ['◆ ' + tx('Outros marcadores…'), () => setTimeout(() => setMenu({ ctr: cid, x: menu.x, y: menu.y }))],
        ...(flipKind(cd) === 'df' ? [['⟲ ' + tx('Transformar (outra face)'), () => send({ c: 'flip', id: cid })]] : flipKind(cd) === 'flip' ? [['⟲ ' + tx('Virar a carta flip (180°)'), () => send({ c: 'flip', id: cid })]] : []),
        c.at != null ? ['📎 ' + tx('Soltar (deixa de estar presa)'), () => attach(cid, null)] : ['📎 ' + tx('Prender a… (toca na carta)'), () => setPickAt(cid)],
        [c.ph ? '◐ ' + tx('Voltar à fase') : '◐ ' + tx('Sair de fase (phasing)'), () => send({ c: 'phase', id: cid })],
        ...(owner || c.d ? [[c.d ? tx('🂠 Virar para cima') : tx('🂠 Virar para baixo'), () => send({ c: 'face', id: cid })]] : []),
        ...to, ...(owner && !c.tok ? [['♛ ' + tx('Zona de comando'), () => mv(cid, 'command')]] : [])]
    }
    if (z === 'hand') return [...head, ['▶ ' + tx('Jogar (para o campo)'), () => toField(cid)], ['🂠 ' + tx('Jogar virada para baixo'), () => toField(cid, { down: true })],
      [c.r ? tx('🙈 Esconder outra vez') : tx('👁 Revelar a todos'), () => send({ c: 'reveal', id: cid })], ...to]
    return [...head, ['▶ ' + tx('Para o campo'), () => toField(cid)], ...to, ...(z !== 'command' && owner ? [['♛ ' + tx('Zona de comando'), () => mv(cid, 'command')]] : []),
      ...(z === 'command' && c.cm ? [[`${tx('Imposto de comandante')} +${2 * (c.cc || 0)}`, null, [['−', () => send({ c: 'tax', id: cid, d: -1 })], ['＋', () => send({ c: 'tax', id: cid, d: 1 })]]]] : [])]
  }
  const rollDice = async types => { const thr = await dice.throwFrom(); send({ c: 'dice', types, ...(thr && { thr }) }) }
  const names = [...new Set([...byId.values()].map(e => e.c.n).filter(Boolean))]
  const unread = s.log.filter(e => e.k === 'chat' && e.s !== me && (e.id || 0) > seen).length
  const T = (ic, label, f, o = {}) => <button type="button" className={`ml-t ${o.cls || ''}`} onClick={f} disabled={o.dis ?? ended} title={o.title || label} aria-pressed={o.on}><i aria-hidden="true">{ic}</i><span>{label}</span>{o.badge ? <b className="ml-badge-n">{o.badge}</b> : null}</button>
  const tools = (
    <div className="ml-tools" role="toolbar" aria-label={tx('Ações da mesa')}>
      <div className="ml-mode-l"><b>🃏 {s.solo ? tx('Mesa livre a solo') : tx('Mesa livre · sem regras')}</b><button className="link small" onClick={() => setHelp(true)} title={tx('Como se joga aqui')}>❓</button></div>
      <div className="ml-tg main">
        {!s.solo && T('▶', s.active === me ? tx('Passar a vez') : tx('Passar a vez de {p}', { p: who(s.active) }), () => send({ c: 'pass' }), { cls: s.active === me ? 'primary' : '' })}
        {T('☀', tx('Novo turno'), () => send({ c: 'newturn' }), { title: tx('Desvira tudo e compra uma carta') })}
        {T('↺', tx('Desvirar'), () => send({ c: 'untapall' }), { title: tx('Desvira todas as tuas cartas') })}
        <span className="ml-pair">{T('🂠', tx('Comprar'), () => send({ c: 'draw', n: nDraw }))}<select className="ml-n" value={nDraw} onChange={e => setNDraw(+e.target.value)} aria-label={tx('Quantas cartas')}>{[1, 2, 3, 4, 5, 7].map(x => <option key={x} value={x}>{x}</option>)}</select></span>
        <span className="ml-pair">{T('👁', tx('Ver o topo'), () => send({ c: 'peek', n: nPeek }), { title: tx('Só tu vês: depois escolhe o que fica no topo, vai para o fundo, para a mão ou para o cemitério') })}<select className="ml-n" value={nPeek} onChange={e => setNPeek(+e.target.value)} aria-label={tx('Quantas cartas do topo')}>{[1, 2, 3, 4, 5, 7, 10].map(x => <option key={x} value={x}>{x}</option>)}</select></span>
      </div>
      <div className="ml-tg">
        {T('🔀', tx('Baralhar'), () => send({ c: 'shuffle' }))}
        {T('♻', tx('Mulligan'), async () => { if (await ask('mesalivre-mulligan', { title: tx('Fazer mulligan?'), body: tx('A tua mão volta para a biblioteca, baralhas e compras 7. Se jogam com o mulligan de Londres, põe depois as cartas a mais no fundo (menu da carta).'), ok: tx('Mulligan'), danger: false })) send({ c: 'mulligan' }) })}
        {!s.solo && T('🖐', mine?.hand.length && mine.hand.every(c => c.r) ? tx('Esconder a mão') : tx('Revelar a mão'), () => send({ c: 'revealhand' }))}
        {T('✦', tx('Ficha'), () => setTokOpen(v => !v), { on: tokOpen })}
      </div>
      {tokOpen && <form className="ml-tok" onSubmit={e => { e.preventDefault(); if (!tok.trim()) return; const w = spot({ n: tok, tok: true }); send({ c: 'token', name: tok.trim(), x: w.x, y: w.y }); setTok(''); setTokOpen(false) }}>
        <input autoFocus value={tok} onChange={e => setTok(e.target.value)} placeholder={tx('Ficha: nome (ex.: Goblin, Treasure)')} maxLength={60} aria-label={tx('Nome da ficha')} />
        <button className="primary" disabled={!tok.trim()}>＋</button></form>}
      <div className="ml-tg dice">
        <span className="ml-dice" title={tx('Lançar na mesa (todos veem o mesmo). Também podes agarrar um dado na mesa e atirá-lo.')}><i aria-hidden="true">🎲</i>
          {[['d6', ['d6']], ['2d6', ['d6', 'd6']], ['d20', ['d20']], [tx('moeda'), ['moeda']]].map(([l, t]) => <button key={l} type="button" className="ml-t" disabled={ended} onClick={() => rollDice(t)}>{l}</button>)}</span>
        {dice.res?.items && s.roll && <button type="button" className="fp-dres" onClick={dice.off} title={tx('Tirar os dados da mesa')}>{who(s.roll.s)}: {dice.res.items.map(x => (x.type === 'moeda' ? (x.v === 1 ? tx('Cara') : tx('Coroa')) : x.v)).join(' + ')}{dice.res.items.length > 1 && dice.res.items.every(x => x.type !== 'moeda') ? ` = ${dice.res.items.reduce((a, x) => a + x.v, 0)}` : ''} ✕</button>}
      </div>
      <div className="ml-tg">
        {T('✏️', tx('Caneta'), () => pen.setOn(v => !v), { on: pen.on, cls: pen.on ? 'on' : '', dis: false, title: tx('Desenhar na mesa (P): os outros veem o risco, que se apaga sozinho') })}
        {pen.on && <span className="ml-cols" role="radiogroup" aria-label={tx('Cor da caneta')}>{PEN_COLS.map(c => <button key={c} role="radio" aria-checked={pen.col === c} className={pen.col === c ? 'on' : ''} style={{ '--c': c }} onClick={() => pen.setCol(c)} aria-label={c} />)}</span>}
        {s.mine?.length > 1 && T('⇄', tx('Trocar de lugar'), () => setSeatSel(s.mine[(s.mine.indexOf(s.me) + 1) % s.mine.length]), { title: tx('Os dois decks são teus: joga agora o outro lado') })}
        {phone && T('💬', tx('Conversa'), () => setChatOpen(v => !v), { on: chatOpen, cls: chatOpen ? 'on' : '', dis: false, badge: !chatOpen && unread })}
        {T('⋯', tx('Mais'), e => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ more: true, x: r.left, y: r.top - 8 }) }, { dis: false })}
      </div>
    </div>
  )
  const menuStyle = m => ({ left: Math.max(8, Math.min(innerWidth - 230, m.x)), top: Math.max(8, Math.min(innerHeight - 380, m.y)) })
  // o menu de uma carta do campo tem ~520 px: aberto na metade de baixo passava do fundo do ecrã e os últimos (exílio,
  // biblioteca, zona de comando) não se alcançavam — sobe o que for preciso, pela altura a sério
  const fitMenu = el => { if (el && el.getBoundingClientRect().top + el.offsetHeight > innerHeight - 8) el.style.top = `${Math.max(8, innerHeight - 8 - el.offsetHeight)}px` }
  const zc = zoom && lookup(data, zoom)
  const zoneCards = zone ? seats[zone.seat]?.[zone.which] || [] : []
  const top = mine?.top
  const lg = [...ghosts.filter(g => g.k !== 'orb' && !(g.k === 'card' && handed(g))),  // e as largadas há pouco cuja jogada ainda não chegou
    ...Object.entries(dropAt.current).filter(([seat, d]) => d.end && !d.gone && Date.now() - d.end < 900 && cardKey(d.id) === d.key && !s.live?.[seat]).map(([seat, d]) => ({ seat: +seat, k: 'card', id: d.id, p: d }))]
  return (
    <div className={`fp ml ${dice.res ? 'dice-on' : ''} ${s.solo ? 'solo' : ''} ${pen.on ? 'ml-penon' : ''} ${phone && chatOpen ? 'chat-open' : ''}`} ref={fitBox} onMouseLeave={() => peek.hide()} onMouseOver={onOver}
      onPointerDown={e => { downAt.current = { x: e.clientX, y: e.clientY }; peek.hide() }}
      onPointerDownCapture={e => { if (e.target.closest('.fp-stagebox') && (pen.down(e) || dice.grab(e))) e.stopPropagation() }}
      onClick={e => { const c = e.target.closest('.ml-card'); if (c) setCardPop(c.dataset.zn) }}>
      <div className="fp-stagebox" ref={stageWrap} style={{ height: stage.h }}>
      <FsBtn className="on-table" />
      {lg.length > 0 && createPortal(<div className="live-ghosts" aria-hidden="true">{lg.map(g => {  // o que os outros estão a agarrar agora
        const p = g.p || toScreen(g), n = g.k === 'card' && byId.get(g.id)?.c?.n, c = n && lookup(data, n)
        return p && <div key={`${g.seat}${g.k}`} className={`live-ghost ${g.k}`} style={{ left: p.x, top: p.y }}>
          {g.k === 'die' ? <span className="lg-die">🎲</span> : c ? <img src={img(c, 'small')} alt="" /> : <span className="lg-back" />}<small>{who(g.seat)}</small></div>
      })}</div>, onTop())}
        <div className={`fp-stage ${stage.shape} ${P.persp ? 'persp' : ''} ${P.oppFace === 'far' ? 'opp-far' : ''}`} data-sc={stage.sc} style={{ width: stage.W || STAGE[stage.shape][0], height: stage.H || STAGE[stage.shape][1], transform: `translateX(${stage.left}px) scale(${stage.sc})`, '--tilt': `${P.tilt}deg`, '--tf': P.tilt / 45 }}>
          <div className={`fp-table board table ${P.cardPx ? 'px' : ''} ${seats.some(v => v.battlefield.some(c => c.atk != null)) ? 'combat-on' : ''}`} style={cardVars(P.cardPx) || undefined} ref={fitTable} onClick={onClick} onDoubleClick={onDouble} onContextMenu={onCtx} onMouseMove={tilt} onPointerDown={down}>
            {/* a linha do atacante até ao planeswalker/batalha que ataca */}
            <CombatLinks s={{ sides: seats.map((_, i) => keyOf(i)), ...Object.fromEntries(seats.map((v, i) => [keyOf(i), { perms: v.battlefield.map(permOf) }])) }} />
            <div className="ml-opps" style={{ '--np': others.length }}>{others.map(i => side(i, true, others.length > 1))}</div>
            <div className="fp-mid">
              <span className="ml-badge" title={tx('Sem bots e sem regras automáticas: cada um mexe nas suas cartas.')}>🃏 {tx('Mesa livre · sem regras')}</span>
              <span className="fp-turn">{tx('Turno {n}', { n: s.turn })} · {s.active === me ? tx('a tua vez') : tx('vez de {p}', { p: who(s.active) })}</span>
              {s.day && <DayNight v={s.day} onClick={ended ? null : () => send({ c: 'day' })} />}
              {pickAt != null && <span className="ml-pickmsg">📎 {tx('Toca na carta a que a queres prender')} <button className="ml-mini" onClick={() => setPickAt(null)}>✕</button></span>}
              {s.solo && <span className="ml-gf" title={tx('A vida de um adversário imaginário, para contares o dano que farias')}>🐟 {tx('Adversário')}
                <button className="ml-mini" onClick={() => send({ c: 'gf', d: -5 })}>−5</button><button className="ml-mini" onClick={() => send({ c: 'gf', d: -1 })}>−1</button>
                <b>{s.gf}</b><button className="ml-mini" onClick={() => send({ c: 'gf', d: 1 })}>+1</button></span>}
              {s.log.length > 0 && <span className="ml-last muted small">{line(s.log[s.log.length - 1], who)}</span>}
            </div>
            {mine && side(me, false, false)}
          </div>
        </div>
        <canvas className="ml-pen" ref={penLayer} aria-hidden="true" />
        <div className="fp-dice" ref={diceBox} />
      </div>
      <aside className="fp-side ml-aside">
        <div className="fp-zoom">{zc ? <img key={zc.n} className="fp-zin" src={img(zc, 'normal', false, artOf(allArts, null, zc))} alt={zc.n} /> : <p className="muted small">{tx('Passa o rato por uma carta (no tablet: toca e mantém) para a veres em grande.')}</p>}</div>
        {tools}
        {err && <p className="small bad-t ml-err">{err}</p>}
        {(!phone || chatOpen) && <TableChat log={s.log} who={who} keyOf={keyOf} me={me} data={data} send={send} fmt={e => line(e, who)} names={names} onSeen={setSeen} />}
      </aside>
      {big && <BigCard name={big} data={data} onClose={() => setBig(null)} />}
      {menu && <div className="ml-menu-back" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }}>
        <div className={`ml-menu ${menu.life != null || menu.ctr != null ? 'rows' : ''}`} style={menuStyle(menu)} ref={fitMenu} onClick={e => e.stopPropagation()} role="menu">
          {menuItems().map(([l, f, bs], k) => (bs ? <div key={k} className="ml-mrow"><span>{l}</span>{bs.map(([bl, bf], j) => <button key={j} onClick={bf} disabled={ended} aria-label={`${l} ${bl}`}>{bl}</button>)}</div>
            : f ? <button key={k} role="menuitem" onClick={() => { setMenu(null); f() }} disabled={ended && !menu.more}>{l}</button> : <b key={k}>{l}</b>))}
        </div></div>}
      {zone && <div className="fp-modal zone" onClick={() => setZone(null)}><div className="fp-ask" onClick={e => e.stopPropagation()}>
        <p><b>{zone.which === 'graveyard' ? tx('Cemitério de {n}', { n: who(zone.seat) }) : tx('Exílio de {n}', { n: who(zone.seat) })}</b> · {zoneCards.length} <button className="link small" onClick={() => setZone(null)}>{tx('fechar')}</button></p>
        <p className="small muted">{tx('Toca numa carta para a mudares de sítio; duplo clique põe-na na mão (com Shift: no campo).')}</p>
        <div className="fp-opts">{zoneCards.map(c => <FCard key={c.id} c={{ id: c.id, name: c.n }} data={data} big onClick={e => {
          const now = Date.now(), x = downAt.current.x, y = downAt.current.y
          if (now - (libClick.current || 0) < 300 && libT.current?.id === c.id) { clearTimeout(libT.current.t); libClick.current = 0; return e?.shiftKey ? toField(c.id) : mv(c.id, 'hand') }
          libClick.current = now; clearTimeout(libT.current?.t); libT.current = { id: c.id, t: setTimeout(() => openMenu(c.id, x, y), 280) }
        }} />)}</div></div></div>}
      {libMenu && <div className="ml-libmenu-bg" onPointerDown={() => setLibMenu(null)} />}
      {libMenu && <div className="ml-libmenu" role="menu" style={{ left: libMenu.x, top: libMenu.y }}>
        <b>▤ {tx('Biblioteca')} · {seats[me]?.library ?? ''}</b>
        {[['🂠', tx('Comprar 1'), 'D', () => send({ c: 'draw', n: 1 })], ['🂠', tx('Comprar 2'), '', () => send({ c: 'draw', n: 2 })], ['👁', tx('Ver o topo (3)'), 'V', () => send({ c: 'peek', n: 3 })],
          ['🔀', tx('Baralhar'), 'S', () => send({ c: 'shuffle' })], ['⚰', tx('Moer 1 (topo para o cemitério)'), 'M', () => send({ c: 'mill', n: 1 })], ['⌀', tx('Exilar o topo'), 'X', () => send({ c: 'exiletop', n: 1 })]]
          .map(([i, l, k, f]) => <button key={l} type="button" role="menuitem" onClick={() => { setLibMenu(null); f() }}><span>{i} {l}</span>{k && <kbd>{k}</kbd>}</button>)}
        <small className="muted">{tx('Duplo clique na biblioteca compra uma.')}</small>
      </div>}
      {top && <div className="fp-modal"><div className="fp-ask">
        <p><b>👁 {tx('O topo da tua biblioteca')}</b> <span className="muted small">{tx('só tu vês estas cartas (a primeira é a de cima)')}</span></p>
        <div className="fp-opts ml-top">{top.map((c, k) => (
          <div key={c.id} className="ml-topc"><FCard c={{ id: c.id, name: c.n }} data={data} big /><small className="muted">{k + 1}.º</small>
            <span className="row-btns"><button className="small" onClick={() => mv(c.id, 'hand')} title={tx('Para a mão')}>✋</button><button className="small" onClick={() => mv(c.id, 'library', { bottom: true })} title={tx('Para o fundo')}>▥</button>
              <button className="small" onClick={() => mv(c.id, 'graveyard')} title={tx('Para o cemitério')}>⚰</button><button className="small" onClick={() => mv(c.id, 'exile')} title={tx('Para o exílio')}>⌀</button><button className="small" onClick={() => toField(c.id)} title={tx('Para o campo')}>▶</button></span></div>))}</div>
        <div className="row-btns"><button className="primary" onClick={() => send({ c: 'peek', n: 0 })}>{tx('Feito (as que sobram ficam no topo)')}</button></div></div></div>}
      {mine?.look != null && seats[mine.look] && <HandLook name={who(mine.look)} cards={seats[mine.look].hand.filter(c => c.n)} data={data} mv={mv} onDone={() => send({ c: 'lookhand', seat: null })} onZoom={setZoom} />}
      {help && <Help onClose={() => { setHelp(false); lsSet(HELP_K, '1') }} />}
      {matOpen && <MatModal onClose={() => setMatOpen(false)} onMat={p => { send({ c: 'mat', v: p.mat }); send({ c: 'orb', v: p.orb }); redraw(x => x + 1) }} />}
      {cardPop && lookup(data, cardPop) && <div className="fp-modal" onClick={() => setCardPop(null)}><img className="ml-pop" src={img(lookup(data, cardPop), 'normal', false, artOf(allArts, null, lookup(data, cardPop)))} alt={cardPop} /></div>}
      {s.result ? <p className="ml-ended win">{s.result.w == null ? tx('🤝 Empate') : tx('🏆 Ganhou {p}', { p: who(s.result.w) })}{onClose && <button className="small" onClick={onClose}>{tx('sair da mesa')}</button>}</p>
        : ended && <p className="ml-ended">{tx('Esta mesa terminou.')}</p>}
      {s.next && <p className="ml-ended res" role="status">{tx('O jogo seguinte da série já tem mesa: vais para lá daqui a pouco.')}<button className="small primary" onClick={() => onNext(s.next)}>▶ {tx('Jogo seguinte (sideboard)')}</button></p>}
      {s.res && !ended && <p className="ml-ended res" role="status">{s.res.w == null ? tx('Proposta: empate') : tx('Proposta: ganhou {p}', { p: who(s.res.w) })}
        <button className="small primary" onClick={() => send({ c: 'agree' })}>{tx('Confirmar')}</button><button className="small" onClick={() => send({ c: 'dispute' })}>{tx('Não concordo')}</button></p>}
      {off && !ended && <p className="ml-ended off" role="status">⟳ {tx('A voltar a ligar à mesa…')}</p>}
    </div>
  )
}
