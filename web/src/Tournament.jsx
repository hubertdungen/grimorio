// Torneio no Coliseu: vários decks jogam entre si no Forge. O servidor (tournament.py) agenda as partidas e guarda tudo;
// aqui cria-se o torneio, vê-se a chave/classificação a mexer ao vivo, revêem-se os jogos e consulta-se o registo.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FORMATS, FORMAT, CASUAL_INFO, CASUAL_META, baseLife } from './formats.js'
import { img, coverOf, colorsOf, HUE } from './data.js'
import { Mana, Stars, TrophyStars, SrcFilter } from './ui.jsx'
import Replay from './Board.jsx'
import ForgeTable from './ForgePlay.jsx'
import FreeTable from './FreeTable.jsx'
import { NewSolo, NewFreeRoom, Seats, JoinPanel, LendPanel, RemoteJoin, FreeMatches } from './FreeRooms.jsx'
import { Cup, PLACE, TIERS, KIND, tierOf } from './Library.jsx'
import { trophyValue, TIER_PTS, KIND_W, BLUE_W, PTS_STARS, PERF_STARS, starPoints, perfQ, perfOf } from './trophyvalue.js'
import { swapSide, nextGame, mixTake, genShape } from './game.js'
import { DIFF_INFO, getBots } from './difficulty.js'
import { ask } from './confirm.jsx'
import { DeckView } from './DeckPeek.jsx'
import { usePeek } from './peek.jsx'
import { tx, LOCALE } from './i18n.js'
import { play } from './sfx.js'

const TYPES = {
  elim: [tx('Eliminação simples'), 4, 16, tx('Quem perde sai. Se o número de decks não for 4, 8 ou 16, os melhores seeds passam a 1.ª ronda sem jogar (isentos). Pode haver jogo de 3.º lugar entre os vencidos das meias-finais.')],
  dupla: [tx('Dupla eliminação'), 4, 16, tx('Só sai quem perde duas vezes: a 1.ª derrota manda para a chave dos vencidos. O vencedor dessa chave defronta o invicto na grande final; se a ganhar, joga-se a 2.ª final.')],
  suico: [tx('Suíço'), 4, 32, tx('Todos jogam todas as rondas, sempre contra quem tem os mesmos pontos e sem repetir adversários (vitória 3, empate 1; quem fica isento conta como vitória). Desempate: % de vitórias dos adversários (OMW%) e % de jogos ganhos (GW%).')],
  liga: [tx('Liga (todos contra todos)'), 4, 16, tx('Cada deck joga uma vez contra cada um dos outros; vitória 3, empate 1. O mais justo e o mais longo.')],
  mesas: [tx('Mesas (multijogador)'), 4, 16, tx('Para Commander e jogos a 3–4: mesas de todos contra todos, um jogo por mesa; pontos pelo lugar (1.º 3, 2.º 2, 3.º 1, 4.º 0). Em cada ronda as mesas refazem-se pelos pontos.')],
  gauntlet: [tx('Gauntlet (o meu deck contra todos)'), 3, 32, tx('O desafiante (o deck marcado com ☆ eu ou, sem ele, o 1.º da lista) joga uma partida contra cada um dos outros, pela ordem da lista. Só é campeão se ganhar pelo menos 75% das partidas; sem isso não há pódio.')],
  rei: [tx('Rei da colina'), 4, 32, tx('Dois decks jogam; quem ganha fica na colina e quem perde vai para o fim da fila, e o seguinte da fila desafia o rei. Num empate o rei fica. Ganha a série de vitórias mais longa (desempate: vitórias, depois menos derrotas).')],
  grupos: [tx('Grupos + eliminação'), 6, 16, tx('Grupos de 4 (ou de 3) em que todos jogam contra todos (vitória 3, empate 1). Os 2 primeiros de cada grupo passam a uma eliminação simples com jogo de 3.º lugar, em que os 1.ºs de grupo defrontam os 2.ºs de outros grupos.')],
  jogo: [tx('Jogo avulso (fora de torneio)'), 2, 4, tx('Um só jogo entre 2 decks (melhor de 1, 3 ou 5) ou uma mesa de 3–4 todos contra todos. Vê-se ao vivo e pode-se apostar, mas não dá troféus nem conta para pódios.')],
  equipas: [tx('Equipas (2 ou 3 por equipa)'), 6, 24, tx('Os decks formam equipas pela ordem da lista (1.º e 2.º = equipa 1…). As equipas jogam todas contra todas: o tabuleiro 1 de uma contra o tabuleiro 1 da outra, e assim por diante; ganha a equipa com mais tabuleiros ganhos (vitória 3, empate 1). Todos os decks da equipa sobem ao pódio.')],
}
// ícones dos tipos de torneio (traço na cor do texto)
const TYPE_ICO = {
  livre: <><rect x="3" y="6" width="9" height="13" rx="1.6" transform="rotate(-12 7.5 12.5)" /><rect x="11" y="4" width="9" height="13" rx="1.6" transform="rotate(10 15.5 10.5)" /></>,
  jogo: <><path d="M4 6l6 6-6 6M20 6l-6 6 6 6" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  elim: <path d="M3 4h5v6H3M8 7h5M3 14h5v6H3M8 17h5M13 7v10M13 12h8" />,
  dupla: <><path d="M3 3h5v5H3M8 5.5h4M3 11h5v5H3M8 13.5h4M12 5.5v8M12 9.5h5" /><path d="M17.5 21.2l-3-2.9a1.8 1.8 0 0 1 3-2 1.8 1.8 0 0 1 3 2z" fill="currentColor" stroke="none" /></>,
  suico: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 7.5v9M7.5 12h9" strokeWidth="3" /></>,
  liga: <><path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z" /><path d="M12 3l5.3 16.2M12 3L6.7 19.2M3.5 9.2h17M3.5 9.2l13.8 10M20.5 9.2L6.7 19.2" opacity=".55" /></>,
  mesas: <><circle cx="12" cy="12" r="5" /><circle cx="12" cy="3.5" r="1.6" fill="currentColor" /><circle cx="12" cy="20.5" r="1.6" fill="currentColor" /><circle cx="3.5" cy="12" r="1.6" fill="currentColor" /><circle cx="20.5" cy="12" r="1.6" fill="currentColor" /></>,
  gauntlet: <><path d="M2.5 7.5l4-1.5 4 1.5v4c0 3-2 5-4 6-2-1-4-3-4-6z" /><path d="M12.5 12l4.5-6M12.5 12h4.5M12.5 12l4.5 6" opacity=".55" /><circle cx="19.5" cy="5" r="1.6" fill="currentColor" /><circle cx="19.5" cy="12" r="1.6" fill="currentColor" /><circle cx="19.5" cy="19" r="1.6" fill="currentColor" /></>,
  rei: <><path d="M4.5 17L3 7.5l5 3.5L12 5l4 6 5-3.5L19.5 17z" /><path d="M4.5 20.5h15" /></>,
  grupos: <><rect x="2.5" y="4.5" width="3.5" height="3.5" rx=".8" /><rect x="7" y="4.5" width="3.5" height="3.5" rx=".8" /><rect x="2.5" y="16" width="3.5" height="3.5" rx=".8" /><rect x="7" y="16" width="3.5" height="3.5" rx=".8" /><path d="M10.5 6.25h3v11.5h-3M13.5 12h7.5" /></>,
  equipas: <><circle cx="4" cy="10.5" r="1.6" /><circle cx="8" cy="10.5" r="1.6" /><circle cx="16" cy="10.5" r="1.6" /><circle cx="20" cy="10.5" r="1.6" /><path d="M1.6 17a2.4 2.4 0 0 1 4.8 0M5.6 17a2.4 2.4 0 0 1 4.8 0M13.6 17a2.4 2.4 0 0 1 4.8 0M17.6 17a2.4 2.4 0 0 1 4.8 0" /></>,
}
const TypeIco = ({ k }) => <svg className="tc-ico" viewBox="0 0 24 24" aria-hidden="true">{TYPE_ICO[k]}</svg>
const STATUS = { running: tx('a decorrer'), paused: tx('em pausa'), done: tx('terminado'), cancelled: tx('cancelado'), error: tx('parado (erro)') }
// equipas à mesma mesa (tournament.py `table`): «equipas» = 2 contra 2, cada um com a sua vida; «2hg» = Two-Headed Giant
const tableL = v => (v === 'equipas' ? tx('2 contra 2 à mesma mesa') : v ? tx('Two-Headed Giant (vida partilhada)') : '')
const BO2 = ['suico', 'liga', 'grupos', 'rei', 'equipas', 'gauntlet']  // como tournament.BO2_OK
const MIN_PER_GAME = 1  // medido: ~45 s por jogo de Pauper no Forge, com o arranque da JVM
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v) } catch { return null } }
async function j(url, opts) {
  const r = await fetch(url, opts)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const when = t => new Date(t * 1000).toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const edge = cs => { const e = cs.length ? [...cs].map(x => HUE[x]) : ['#8a8a99']; return e.length > 1 ? `linear-gradient(135deg, ${e.join(', ')})` : e[0] }
const pct = x => `${Math.round(x * 100)}%`
// ratings (ratings.py): estrelas 0–6 por deck, chave deck:<id> (os meus) ou meta:<id>; sem o módulo fica tudo sem estrelas
const rkey = (src, id) => `${src === 'meus' ? 'deck' : 'meta'}:${id}`
// formatos que englobam outros (como tournament.CROSS): com a opção ligada entram decks legais desses formatos
const CROSS = { legacy: ['modern', 'pioneer', 'standard', 'premodern', 'pauper'], vintage: ['legacy', 'modern', 'pioneer', 'standard', 'premodern', 'pauper'], modern: ['pioneer', 'standard'], pioneer: ['standard'] }
const legalDeck = (d, fmt, data) => {  // todas as cartas (main + side) legais em fmt
  const b = data.meta.formats.indexOf(FORMAT[fmt]?.lg || fmt)
  return b >= 0 && ['main', 'side'].every(k => Object.keys(d?.[k] || {}).every(n => ((data.byName.get(n) || data.byLower.get(n.toLowerCase()))?.lg || 0) & (1 << b)))
}
const STEPS = Array.from({ length: 13 }, (_, k) => k / 2)
const dLabel = d => DIFF_INFO[d.id]?.label || d.label  // o nosso rótulo (traduzido) quando o conhecemos

// Depois de um jogo acabar (a ver um torneio ao vivo): o mais recente, por ordem, ou a mesma mesa. Guardado no browser.
const NEXT_K = 'grimorio.torneio.proximo'
export const nextModeOf = () => { try { return localStorage.getItem(NEXT_K) || 'ultimo' } catch { return 'ultimo' } }
export function NextMode({ value, onChange }) {
  const [v, setV] = useState(value || nextModeOf)
  const set = x => { setV(x); try { localStorage.setItem(NEXT_K, x) } catch { /* sem armazenamento */ } onChange?.(x) }
  return (
    <label className="fmt next-mode" title={tx('A mesma mesa: segue a próxima partida desta mesa; se ainda não houver, mostra o jogo seguinte de outra mesa e volta à tua quando ela tiver jogo novo')}>
      <span>{tx('Depois de um jogo')}</span>
      <select value={v} onChange={e => set(e.target.value)}>
        <option value="ultimo">{tx('o mais recente')}</option>
        <option value="ordem">{tx('por ordem (o seguinte a acabar)')}</option>
        <option value="mesa">{tx('a mesma mesa')}</option>
      </select>
    </label>
  )
}

// Definições: destacar os meus decks (a azul) em todos os torneios — desligado por omissão
const HL_K = 'grimorio.torneio.destacar'
const hlOn = () => ls(HL_K) === '1'
export function HighlightMine() {
  const [v, setV] = useState(hlOn)
  return <label className="chk" title={tx('Os meus decks (não os da comunidade) ficam com contorno azul nas chaves, classificações, jogos e pódios.')}><input type="checkbox" checked={v} onChange={e => { setV(e.target.checked); ls(HL_K, e.target.checked ? '1' : '0') }} /> {tx('Destacar os meus decks em todos os torneios')}</label>
}

export default function TournamentView({ data, fmt, deckId, guest, online }) {
  // dois modos: offline (os bots jogam os teus torneios) e online (salas onde entram amigos por link); cada um guarda o seu separador
  const VK = online ? 'grimorio.online.vista' : 'grimorio.torneio.vista', TABS = online ? ['criar', 'salas', 'ver', 'apostas'] : ['criar', 'gerar', 'ver', 'registo', 'apostas']
  const [view, setViewS] = useState(() => { const v = TABS.includes(ls(VK)) ? ls(VK) : online ? 'salas' : 'criar'; return guest && (v === 'criar' || v === 'gerar') ? (online ? 'salas' : 'registo') : v })
  const setView = v => { setViewS(v); ls(VK, v) }
  const [tid, setTid] = useState(null)
  const [slot, setSlot] = useState(null)  // ao lado das abas: o «← Voltar ao torneio» de um jogo aberto vai para aqui
  const [list, setList] = useState([])
  const loadList = () => j('/api/tournaments').then(l => { setList(l); return l }).catch(() => [])
  useEffect(() => {  // ao entrar: volta ao torneio que estava aberto, ou ao que está a decorrer
    loadList().then(l => {
      const last = ls('grimorio.torneio'), on = l.find(x => x.id === last) || l.find(x => x.status === 'running')
      if (on) { setTid(on.id); if (ls(VK) === 'ver' || !ls(VK)) setView('ver') }
      else if (view === 'ver') setView(online ? 'salas' : 'criar')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const open = id => { setTid(id); ls('grimorio.torneio', id); setView('ver') }
  const [table, setTableS] = useState(() => { try { return online ? sessionStorage.getItem('grimorio.mesalivre') : null } catch { return null } })  // mesa livre aberta (volta a ela com F5)
  const setTable = t => { setTableS(t); try { if (t) sessionStorage.setItem('grimorio.mesalivre', t); else sessionStorage.removeItem('grimorio.mesalivre') } catch { /* sem armazenamento */ } }
  useEffect(() => {  // no Ao vivo: os outros torneios a decorrer ao lado das apostas
    if (view !== 'ver') return
    const t = setInterval(loadList, 15000)
    return () => clearInterval(t)
  }, [view])
  const [own, setOwn] = useState({})
  useEffect(() => { j('/api/decks').then(ds => setOwn(Object.fromEntries(ds.map(d => [d.id, d.friend ? 'ami' : d.community ? 'com' : 'meu'])))).catch(() => {}) }, [])
  if (table) return <div className="view play fp-view"><FreeTable key={table} id={table} data={data} onClose={() => setTable(null)} /></div>
  return (
    <OwnCtx.Provider value={own}><div className={`view tour ${hlOn() ? 'hl-mine' : ''}`}>
      {online && !guest && <NetBar />}
      <div className="tour-top"><div className="seg tour-nav">
        {!guest && <button className={view === 'criar' ? 'on' : ''} onClick={() => setView('criar')}>{online ? tx('✦ Nova sala') : tx('✦ Criar')}</button>}
        {!guest && !online && <button className={view === 'gerar' ? 'on' : ''} onClick={() => setView('gerar')}>{tx('🎲 Gerador')}</button>}
        {online && <button className={view === 'salas' ? 'on' : ''} onClick={() => setView('salas')}>{tx('🚪 Salas')}</button>}
        <button className={view === 'ver' ? 'on' : ''} onClick={() => setView('ver')} disabled={!tid}>{tx('🏆 Ao vivo')}</button>
        {!online && <button className={view === 'registo' ? 'on' : ''} onClick={() => { loadList(); setView('registo') }}>{tx('📜 Registo')} <b>{list.length}</b></button>}
        <button className={view === 'apostas' ? 'on' : ''} onClick={() => setView('apostas')}>{tx('🪙 Apostas')}</button>
      </div><span className="tour-slot" ref={setSlot} /></div>
      {view === 'criar' && !guest && (online ? <NewRoom data={data} fmt={fmt} deckId={deckId} onRoom={() => setView('salas')} openTable={setTable} />
        : <Create data={data} fmt0={fmt} deckId={deckId} onCreated={id => { loadList(); open(id) }} />)}
      {view === 'gerar' && !guest && <Generator data={data} onCreated={() => { loadList(); setView('registo') }} />}
      {view === 'ver' && tid && <Live key={tid} data={data} tid={tid} slot={slot} running={list.filter(x => x.status === 'running')} open={open} openTable={setTable} onGone={() => { loadList(); setView(online ? 'salas' : 'registo') }} />}
      {view === 'apostas' && <BetsTab open={open} />}
      {view === 'salas' && <Rooms data={data} guest={guest} open={id => { loadList(); open(id) }} openTable={setTable} />}
      {view === 'registo' && <Registry data={data} list={list} open={open} reload={loadList} />}
    </div></OwnCtx.Provider>
  )
}

// ---------- online: o endereço público e a escolha do tipo de sala ----------

// O endereço público: domínio próprio (GRIMORIO_PUBLIC_URL) ou o túnel gratuito da Cloudflare (share.py), que se abre daqui.
function useNet(on = true) {
  const [net, setNet] = useState(null)
  const load = () => Promise.all([j('/api/friends'), j('/api/share')]).then(([f, s]) => setNet({ public: f.public, lan: f.lan, share: s })).catch(() => {})
  useEffect(() => { if (!on) return; load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [on]) // eslint-disable-line react-hooks/exhaustive-deps
  return [net, load]
}

function NetBar() {
  const [net, load] = useNet()
  const [busy, setBusy] = useState(false)
  const sh = async a => { setBusy(true); try { await post(`/api/share/${a}`) } catch { /* o estado mostra o erro */ } finally { setBusy(false); load() } }
  if (!net) return null
  const tunnel = net.share?.running, own = net.public && net.public !== net.share?.url
  return (
    <div className={`net-bar ${net.public ? 'up' : ''}`}>
      {net.public ? <span>🌍 {tx('Online em')} <code>{net.public}</code></span>
        : tunnel ? <span>🌍 {tx('a abrir o túnel…')}</span>
          : <span>📴 {tx('Este Grimório ainda não está na internet: os links das salas só funcionam depois de o abrires.')}</span>}
      {!own && (tunnel ? <button className="link small" onClick={() => sh('stop')} disabled={busy}>{tx('fechar à internet')}</button>
        : <button className="primary small" onClick={() => sh('start')} disabled={busy}>🌍 {tx('Abrir à internet')}</button>)}
      {!own && <span className="small muted">{tx('Túnel gratuito da Cloudflare: dá um endereço público sem abrir portas no router. Sem convite ninguém vê nada.')}</span>}
      {net.share?.err && <span className="small bad-t">{net.share.err}</span>}
    </div>
  )
}

// os modos online, lado a lado: quem joga e que regras há em cada um (com bots do Forge ou mesa livre entre amigos)
const MODES = {
  jogo: [tx('Jogo com bots'), tx('Quem joga: os bots do Forge, com os vossos decks. Os amigos veem ao vivo e apostam.'), tx('Regras: todas, aplicadas pelo Forge.')],
  torneio: [tx('Torneio com bots'), tx('Quem joga: os bots do Forge (eliminação, suíço, liga, grupos…). Os amigos veem e apostam.'), tx('Regras: todas, aplicadas pelo Forge.')],
  livre: [tx('Mesa livre'), tx('Quem joga: só vocês, 2 a 4 amigos, sem bots. Cada um mexe nas suas cartas, como numa mesa a sério.'), tx('Regras: nenhuma automática. Qualquer formato, Commander incluído.')],
  livretorneio: [tx('Torneio de mesa livre'), tx('Quem joga: vocês, sem bots, cada um com um ou vários decks seus. Cada partida abre uma mesa livre entre os dois.'), tx('Regras: nenhuma automática; desistir = perder, o resultado combina-se na mesa ou marca-o quem aloja. Conta como torneio de amigos.')],
  solo: [tx('Mesa livre a solo'), tx('Quem joga: só tu, para testar um deck (goldfish). Sem sala nem link.'), tx('Regras: nenhuma automática. Novo turno, recomeçar e a vida de um adversário imaginário.')],
}
function NewRoom({ data, fmt, deckId, onRoom, openTable }) {
  const [kind, setKindS] = useState(() => (['torneio', 'livre', 'solo', 'livretorneio'].includes(ls('grimorio.online.tipo')) ? ls('grimorio.online.tipo') : 'jogo'))
  const setKind = k => { setKindS(k); ls('grimorio.online.tipo', k) }
  return <div className="new-room">
    <div className="nr-kind nr-modes" role="group" aria-label={tx('Tipo de sala')}>
      {Object.entries(MODES).map(([k, [t, w, r]]) => (
        <button key={k} className={`${kind === k ? 'on' : ''} m-${k}`} onClick={() => setKind(k)} aria-pressed={kind === k}>
          <TypeIco k={k === 'torneio' || k === 'livretorneio' ? 'elim' : k === 'solo' ? 'livre' : k} /> <b>{['livre', 'solo', 'livretorneio'].includes(k) ? '🃏 ' : '🤖 '}{t}</b><small>{w}</small><small className="nr-rules">{r}</small></button>))}
    </div>
    {kind === 'livre' ? <NewFreeRoom data={data} deckId={deckId} onRoom={onRoom} /> : kind === 'solo' ? <NewSolo data={data} deckId={deckId} openTable={openTable} /> : <Create key={kind} data={data} fmt0={fmt} deckId={deckId} room={kind === 'livretorneio' ? 'torneio' : kind} free={kind === 'livretorneio'} onRoom={onRoom} />}
  </div>
}

// mesa livre: nome, quantos lugares e o teu deck (qualquer formato; Commander com zona de comando e 40 de vida)
// ---------- criar ----------

function Create({ data, fmt0, onCreated, deckId, room, onRoom, free }) {  // free: torneio de mesa livre (sem bots; jogam os donos dos decks)  // room = 'jogo' | 'torneio': abre uma sala online em vez de começar já
  const [format, setFormat] = useState(fmt0.key === 'casual' || (room && fmt0.cmd) ? 'modern' : fmt0.key)  // online sem Commander (rooms.py)
  const F = FORMAT[format]
  const defType = f => (room === 'jogo' ? 'jogo' : FORMAT[f].cmd === 'commander' && f !== 'duel' ? 'mesas' : 'elim')
  const [type, setType] = useState(defType(format))
  const [bo, setBo] = useState(1)
  const [third, setThird] = useState(true)
  const [rounds, setRounds] = useState('')
  const [seeding, setSeeding] = useState('aleatorio')
  const [name, setName] = useState('')
  const [players, setPlayers] = useState([])
  const [casual, setCasual] = useState(false)  // não conta para os ratings; com `mixF`, `format` passa a ser o das regras base
  const [mixOn, setMixOn] = useState(true)
  const mixF = casual && mixOn  // formatos misturados (só em casual)
  const [hold, setHold] = useState(() => ls('grimorio.torneio.hold') === '1')
  const [playMe, setPlayMe] = useState(() => ls('grimorio.torneio.playme') === '1')  // os jogos do meu deck jogo-os eu (Forge Play)  // só começa com o OK (escolha guardada, também nas Definições)
  const [metaFmt, setMetaFmt] = useState('')
  const mf = mixF ? metaFmt || format : format
  const [allMine, setAllMine] = useState([])
  const [crossOn, setCrossOn] = useState(() => ls('grimorio.torneio.cross') === '1')
  const cross = !mixF && crossOn && !!CROSS[format]
  // os decks casuais só entram nos casuais; com «outros formatos», também os teus de formatos englobados que sejam legais aqui
  const mine = mixF ? allMine : allMine.filter(d => !d.casual && (d.format === format || (cross && CROSS[format].includes(d.format) && legalDeck(d, format, data))))
  const [meta, setMeta] = useState([])
  const [diffs, setDiffs] = useState([])
  const [fillN, setFillN] = useState(8)
  const [srcs, setSrcs] = useState(['meu', 'meta'])  // de onde vem o «Preencher»: meus, comunidade (decks de outros guardados) e meta
  // fontes sem decks neste formato ficam a cinzento e não contam (a escolha fica guardada para quando houver)
  const avail = { meu: mine.some(o => kindOf(o) === 'meu'), ami: mine.some(o => kindOf(o) === 'ami'), com: mine.some(o => kindOf(o) === 'com'), meta: meta.length > 0 }
  const srcsOn = srcs.filter(k => avail[k])
  const okMine = o => srcsOn.includes(kindOf(o))
  const [favOnly, setFavOnlyS] = useState(() => ls('grimorio.torneio.favoritos') === '1')  // «Preencher» só com os meus favoritos
  const setFavOnly = v => { setFavOnlyS(v); ls('grimorio.torneio.favoritos', v ? '1' : '0') }
  // mistura das fontes no «Preencher» (pesos 0–100; nos não casuais o meta fica ligado e com pelo menos 20%)
  const META_MIN = casual ? 0 : 0.2
  const [mix, setMixS] = useState(() => { try { return { meu: 50, ami: 20, com: 20, meta: 30, ...JSON.parse(ls('grimorio.torneio.mistura') || '{}') } } catch { return { meu: 50, ami: 20, com: 20, meta: 30 } } })
  const setMix = (k, v) => setMixS(m => { const n = { ...m, [k]: v }; ls('grimorio.torneio.mistura', JSON.stringify(n)); return n })
  const weights = Object.fromEntries(srcsOn.map(k => [k, Math.max(k === 'meta' ? META_MIN * 100 : 0, mix[k] ?? 0)]))
  const share = (() => {  // a parte de cada fonte, como o mixTake a vai usar
    const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1, out = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / sum]))
    if (META_MIN && out.meta < META_MIN) { const rest = 1 - out.meta; for (const k of Object.keys(out)) out[k] = k === 'meta' ? META_MIN : rest ? (out[k] * (1 - META_MIN)) / rest : 0 }
    return out
  })()
  const [allDiff, setAllDiff] = useState(() => getBots().torneio.b || 'default')  // bots predefinidos (Definições)
  const myDiff = getBots().torneio.a  // o teu deck; '' = o mesmo dos outros
  const [smin, setSmin] = useState(0)
  const [smax, setSmax] = useState(6)
  const [unrated, setUnrated] = useState(true)
  const [stars, setStars] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { j('/api/sim/difficulties').then(setDiffs).catch(() => {}); j('/api/decks').then(setAllMine).catch(() => {}) }, [])
  useEffect(() => { if (!mixF) setPlayers([]) }, [format, mixF])
  useEffect(() => {
    setMeta([])
    const fs = [mf, ...(cross ? CROSS[format].filter(f => CASUAL_META.includes(f)) : [])]
    Promise.all(fs.map(f => j(`/api/sim/opponents?format=${f}`).then(l => l.map(o => ({ ...o, of: f }))).catch(() => []))).then(ls => setMeta(ls.flat()))
  }, [mf, cross, format])
  useEffect(() => {
    j(`/api/ratings?format=${format}`).then(r => setStars(Object.fromEntries((Array.isArray(r) ? r : r.rows || []).filter(x => x?.key).map(x => [x.key, { ...x, prov: x.provisional, deck: undefined }]))))
      .catch(() => setStars({}))
  }, [format])
  const [team, setTeam] = useState(2)  // equipas: decks por equipa
  // opções das equipas (guardadas): como jogam (tabuleiro a tabuleiro, ou 2 contra 2 à mesma mesa com vidas separadas ou
  // em Two-Headed Giant), sorteio equilibrado por formato e por rating, e tabuleiros com decks do mesmo formato frente a
  // frente (estas duas só com formatos misturados)
  const TOPS0 = { table: '', balFmt: false, balElo: false, sameFmt: false }
  const [tops, setTopsS] = useState(() => { try { const o = { ...TOPS0, ...JSON.parse(ls('grimorio.torneio.equipas') || '{}') }; return { ...o, table: o.table === true ? '2hg' : o.table || '' } } catch { return TOPS0 } })
  const setTop = (k, v) => setTopsS(o => { const x = { ...o, [k]: v }; ls('grimorio.torneio.equipas', JSON.stringify(x)); return x })
  const [, lo0, max0, info] = TYPES[type]
  const table = type === 'equipas' && team === 2 && !(F.cmd && tops.table === '2hg') ? tops.table : ''  // como tournament.create
  const lo = type === 'equipas' ? 3 * team : lo0, max = type === 'equipas' ? 8 * team : max0  // equipas: 3 a 8 equipas
  const n = players.length
  const teamBad = type === 'equipas' && n >= lo && n % team !== 0
  const [champs, setChamps] = useState(false)  // torneio dos campeões: o vencedor leva o troféu de platina
  const [pods, setPods] = useState(false)  // liga dos pódios: entram os 2.ºs e 3.ºs (troféus normais, valem menos)
  const [champFrom, setChampFrom] = useState('')  // de onde vêm os campeões: '' todos, um tipo (ex.: 'suico') ou 'campeoes' (campeões dos campeões)
  // «o meu deck»: o escolhido da última vez (guardado) ou o deck aberto, se estiver entre os decks do torneio
  const setMe = ref => { setPlayers(ps => ps.map(x => ({ ...x, me: !!ref && x.src === 'meus' && x.ref === ref }))); ls('grimorio.torneio.eu', ref || '-') }  // «-» = escolheste nenhum
  useEffect(() => {
    if (players.some(x => x.me) || ls('grimorio.torneio.eu') === '-') return
    const want = [ls('grimorio.torneio.eu'), deckId].filter(Boolean).find(r => players.some(x => x.src === 'meus' && x.ref === r))
    if (want) setPlayers(ps => ps.map(x => ({ ...x, me: x.src === 'meus' && x.ref === want })))
  }, [players, deckId])
  const suggested = `${pods ? `🥈 ${tx('Liga dos pódios')}` : champs ? `🏆 ${champFrom === 'campeoes' ? tx('Campeões dos campeões') : champFrom ? tx('Campeões · {t}', { t: TYPES[champFrom]?.[0] }) : tx('Campeões')}` : TYPES[type][0]} · ${casual ? tx('casual') : F.name} · ${new Date().toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' })}`
  // os vencedores dos torneios acabados: deste formato (sem os casuais) ou, em modo casual, de todos os torneios
  const loadChampions = async (places = [1]) => {
    const l = await j('/api/tournaments').catch(() => []), seen = new Set(), out = []
    for (const t of l) {
      if (t.status !== 'done' || t.old || (!mixF && (t.format !== format || (t.casual && !casual)))) continue  // old: antes de repor os troféus
      if (champFrom === 'campeoes' ? !t.champions : champFrom && t.type !== champFrom) continue
      for (const w of (t.podium || []).filter(x => places.includes(x.place))) {
        if (seen.has(`${w.src}:${w.ref}`) || (w.src === 'meus' && !allMine.some(d => d.id === w.ref))) continue
        seen.add(`${w.src}:${w.ref}`); out.push(w)
      }
    }
    if (out.length < lo) { setErr(places.includes(1) ? tx('Só há {k} campeões de torneios anteriores para isto (mínimo {m}).', { k: out.length, m: lo }) : tx('Só há {k} 2.ºs e 3.ºs lugares de torneios anteriores para isto (mínimo {m}).', { k: out.length, m: lo })); return }
    setErr('')
    setPlayers(out.slice(0, max).map(w => ({ key: `${w.src}:${w.ref}:${Math.random()}`, src: w.src, ref: w.ref, name: w.name, difficulty: (w.src === 'meus' && myDiff) || allDiff, fmt: w.format, cover: w.cover || '', colors: w.colors || '' })))
    if (places.includes(1)) { setChamps(true); setPods(false) } else { setPods(true); setChamps(false) }
  }
  const roundsDef = type === 'suico' ? Math.ceil(Math.log2(Math.max(n, 2))) : type === 'rei' ? 3 * Math.max(n - 1, 1) : 3  // rei: nº de partidas (por omissão 3 × (decks − 1); até 200)
  const R = +rounds || roundsDef
  const G = Math.ceil(n / 4), T = Math.floor(n / team)  // grupos: grupos de 4 ou 3 (+ chave dos 2·G apurados, com 3.º lugar)
  const matches = { elim: n - 1 + (third && n >= 4 ? 1 : 0), dupla: 2 * n - 1, suico: R * Math.ceil(n / 2), liga: (n * (n - 1)) / 2, mesas: R * Math.ceil(n / 4),
    gauntlet: Math.max(n - 1, 0), rei: R, equipas: ((T * (T - 1)) / 2) * (table ? 1 : team),
    grupos: Array.from({ length: G }, (_, i) => { const s = Math.floor(n / G) + (i < n % G ? 1 : 0); return (s * (s - 1)) / 2 }).reduce((a, b) => a + b, 0) + 2 * G }[type]
  const chK = Math.max(0, players.findIndex(x => x.me))  // gauntlet: o desafiante
  const boOf = type === 'mesas' ? 1 : bo === 2 && !BO2.includes(type) ? 3 : bo  // Bo2 só onde o empate faz parte do formato
  // ranked (como tournament.ranked): não casual e pelo menos 20% de decks do meta → estrelas amarelas e troféus normais
  const nMeta = players.filter(p => p.src === 'meta').length, metaNeed = Math.max(1, Math.ceil(0.2 * n - 1e-9)), isRanked = !casual && nMeta >= metaNeed
  const games = Math.round(matches * ({ 1: 1, 2: 2, 3: 2.5, 5: 4 }[boOf] || 1))

  const deckOf = async (src, o) => (src === 'meus' ? o : j(`/api/sim/opponents/${encodeURIComponent(o.id)}`))
  const entry = async (src, o, difficulty) => {
    const d = await deckOf(src, o), c = coverOf(d, data)
    if (src === 'meta' && o.of && o.of !== format && !mixF && !legalDeck(d, format, data)) return null  // deck do meta de outro formato com cartas ilegais aqui
    return { key: `${src}:${o.id}:${Math.random()}`, src, ref: o.id, name: o.name, fr: o.friendName || '', difficulty: (src === 'meus' && myDiff) || difficulty, fmt: src === 'meus' ? o.format : mf, cover: c?.n || '', colors: colorsOf(d, data).join('') }
  }
  const add = async (src, o) => {
    if (n >= max) return setErr(tx('Este tipo leva no máximo {m} participantes.', { m: max }))
    setErr(''); const e = await entry(src, o, allDiff).catch(() => null)
    if (e) setPlayers(p => [...p, e]); else setErr(tx('«{d}» tem cartas que não são legais em {f}.', { d: o.name, f: F.name }))
  }
  const inStars = (s, id) => { const x = stars[rkey(s, id)]?.stars; return x == null ? unrated : x >= smin && x <= smax }
  const fill = async () => {
    const used = new Set(players.map(p => `${p.src}:${p.ref}`))
    const want = Math.min(fillN, max) - n
    if (want <= 0) return
    // o sorteio com filtro de estrelas é do ratings.py; sem ele (ou se falhar) sorteia-se aqui com as estrelas que houver
    const byKey = Object.fromEntries([...mine.map(o => [rkey('meus', o.id), ['meus', o]]), ...meta.map(o => [rkey('meta', o.id), ['meta', o]])])
    // pede todos os candidatos já baralhados (os sem rating vêm como 3,0★ com games 0) e filtra aqui: «sem rating» entra
    // pela caixa, independentemente do intervalo de estrelas
    const picked = casual ? null : await j(`/api/ratings/pick?format=${format}&n=999&min=0&max=6&sources=${srcsOn.join(',') || 'meta'}`)
      .then(r => (Array.isArray(r) ? r.filter(x => (x.games ? x.stars >= smin && x.stars <= smax : unrated)).map(x => byKey[x.key] || (x.src === 'meta' && ['meta', { id: x.ref, name: x.name }])).filter(Boolean) : null)).catch(() => null)
    const pool = (picked || [...mine.filter(okMine).map(o => ['meus', o]), ...(srcsOn.includes('meta') ? meta.map(o => ['meta', o]) : [])]
      .filter(([s, o]) => inStars(s, o.id)).sort(() => Math.random() - 0.5))
      .filter(([s, o]) => !used.has(`${s}:${o.id}`) && (!favOnly || s === 'meta' || o.fav))  // favoritos: só nos meus/comunidade
    if (pool.length < want) setErr(tx('Só há {k} decks diferentes com esta fonte e estas estrelas: preenchi o que deu.', { k: pool.length })); else setErr('')
    const add = await Promise.all(mixTake(pool, want, weights, META_MIN).map(([s, o]) => entry(s, o, allDiff).catch(() => null)))
    setPlayers(p => [...p, ...add.filter(Boolean)])
  }
  const setP = (k, v) => setPlayers(p => p.map((x, i) => (i === k ? { ...x, ...v } : x)))
  const move = (k, d) => setPlayers(p => { const q = [...p], t = q[k]; q[k] = q[k + d]; q[k + d] = t; return q })
  // arrastar pela imagem (rato ou dedo) muda a ordem; ordenar à mão passa a semente para «pela ordem»
  const drag = useRef(null), [dragK, setDragK] = useState(null)
  const dragStart = (e, k) => {
    if (e.button > 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = k; setDragK(k)
    if (seeding !== 'ordem') setSeeding('ordem')
  }
  const dragMove = e => {
    if (drag.current == null) return
    const to = +(document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-k]')?.dataset.k ?? NaN)
    if (Number.isNaN(to) || to === drag.current) return
    const from = drag.current
    setPlayers(p => { const q = [...p], [x] = q.splice(from, 1); q.splice(to, 0, x); return q })
    drag.current = to; setDragK(to)
  }
  const dragEnd = () => { drag.current = null; setDragK(null) }
  const randomDiffs = () => { const ids = diffs.map(d => d.id).filter(x => x !== 'random'); setPlayers(p => p.map(x => ({ ...x, difficulty: ids[Math.floor(Math.random() * ids.length)] }))) }
  const asRoom = !!room  // sala online: os convidados entram com os seus decks antes de começar
  const openRoom = async () => {
    setBusy(true); setErr('')
    try {
      await post('/api/rooms', { name: name.trim() || suggested, type, format, casual, hold, cross, bo: boOf, third, rounds: R, seeding, team, ...(free && { free: true }),
        players: players.map(({ src, ref, difficulty, cover, colors, me, name: nm }) => ({ src, ref, difficulty, cover, colors, me, name: nm })) })
      onRoom()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const start = async () => {
    setBusy(true); setErr('')
    try {
      const { id } = await post('/api/tournaments', { name: name.trim() || suggested, type, format, casual, hold, cross, play_me: canPlayMe && playMe, champions: champs, podiums: pods, bo: boOf, third, rounds: R, seeding, team,
        ...(type === 'equipas' && { table, bal_fmt: mixF && tops.balFmt, bal_elo: tops.balElo, same_fmt: mixF && !table && tops.sameFmt }),
        players: players.map(({ src, ref, difficulty, cover, colors, me }) => ({ src, ref, difficulty, cover, colors, me })) })
      onCreated(id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const has = (s, id) => players.some(p => p.src === s && p.ref === id)
  const canPlayMe = !room && players.some(p => p.me) && !F.cmd && type !== 'mesas' && type !== 'equipas'  // como tournament.py
  return (
    <section className="card tour-create">
      <h3>{free ? tx('Novo torneio de mesa livre') : room === 'jogo' ? tx('Novo jogo online') : room ? tx('Novo torneio online') : tx('Novo torneio')} <span className="muted small">{free ? tx('sem bots: junta os teus decks aqui (podes pôr vários) e partilha o link; cada amigo entra com um ou vários decks seus. Cada partida joga-se numa mesa livre entre os donos dos decks.') : room ? tx('abre a sala e partilha o link: quem entra junta um deck seu, e os lugares que juntares aqui jogam com os bots do Forge') : tx('os bots do Forge jogam tudo sozinhos no servidor — podes fechar o browser e voltar mais tarde')}</span></h3>
      <div className="tc-grid">
        <div className="lab-step">
          <h4 className="step-h"><i>1</i> {tx('Regras')}</h4>
          <label className="fmt"><span>{tx('Nome')}</span><input value={name} onChange={e => setName(e.target.value)} placeholder={suggested} /></label>
          <label className="chk"><input type="checkbox" checked={casual} onChange={e => setCasual(e.target.checked)} /> {tx('Modo casual (não conta para os ratings)')}</label>
          {casual && <label className="chk" title={tx('Desligado: todos os decks são do formato escolhido, só que o torneio não conta para os ratings.')}><input type="checkbox" checked={mixOn} onChange={e => setMixOn(e.target.checked)} /> {tx('Misturar formatos')}</label>}
          {casual && <p className="small muted tc-info">{mixF ? CASUAL_INFO : tx('Casual sem misturar: decks só deste formato.')} {tx('Os torneios casuais não contam para os ratings.')}</p>}
          <label className="fmt"><span>{mixF ? tx('Regras base (vida e tipo de jogo de todos)') : tx('Formato (todos os decks jogam este)')}</span>
            <select value={format} onChange={e => { const f = e.target.value; setFormat(f); setType(defType(f)) }}>{FORMATS.filter(f => f.key !== 'casual' && f.key !== 'limited' && !(room && f.cmd && !free)).map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</select></label>
          {!mixF && CROSS[format] && <label className="chk small" title={tx('Os decks têm de ser legais carta a carta neste formato (o servidor confirma).')}><input type="checkbox" checked={crossOn} onChange={e => { setCrossOn(e.target.checked); ls('grimorio.torneio.cross', e.target.checked ? '1' : '0') }} /> {tx('Aceitar decks legais de outros formatos ({l})', { l: CROSS[format].map(f => FORMAT[f]?.name || f).join(', ') })}</label>}
          {room !== 'jogo' && <div className="tc-types">{Object.entries(TYPES).filter(([k]) => k !== 'jogo').map(([k, [l, lo, hi]]) => (
            <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}><TypeIco k={k} /><b>{l}</b><small>{lo}–{hi} decks</small></button>
          ))}</div>}
          <p className="small muted tc-info">{info}</p>
          <div className="tc-row">
            <label className="fmt"><span>{tx('Partidas')}</span><select value={boOf} onChange={e => setBo(+e.target.value)} disabled={type === 'mesas'}><option value={1}>{tx('Um jogo (Bo1)')}</option>{BO2.includes(type) && <option value={2} title={tx('Dois jogos: 2-0 ganha, 1-1 é empate')}>{tx('Dois jogos (Bo2, pode empatar)')}</option>}<option value={3}>{tx('Melhor de 3 (Bo3)')}</option><option value={5}>{tx('Melhor de 5 (Bo5)')}</option></select></label>
            {(type === 'suico' || type === 'mesas' || type === 'rei') && <label className="fmt"><span>{type === 'rei' ? tx('N.º de partidas') : tx('Rondas')}</span><input type="number" min={type === 'rei' ? Math.max(n - 1, 1) : 1} max={type === 'rei' ? 200 : roundsDef + 3} title={type === 'rei' ? tx('Pelo menos {m} (para todos os decks jogarem) e até 200', { m: Math.max(n - 1, 1) }) : undefined} value={rounds} placeholder={String(roundsDef)} onChange={e => setRounds(e.target.value)} /></label>}
            {type === 'equipas' && <label className="fmt"><span>{tx('Decks por equipa')}</span><select value={team} onChange={e => setTeam(+e.target.value)}><option value={2}>2</option><option value={3}>3</option></select></label>}
            {type === 'equipas' && <label className="fmt" title={team !== 2 ? tx('À mesma mesa só com equipas de 2 (o Forge joga até 4 lugares).') : tx('Tabuleiro a tabuleiro: cada deck joga um contra um com o do outro lado. À mesma mesa: os dois decks de cada equipa jogam juntos contra os dois da outra, num só jogo a quatro — com a vida de cada um, ou em Two-Headed Giant (vida partilhada, 30 por equipa, e a equipa perde junta).')}><span>{tx('As equipas jogam')}</span>
              <select value={table} disabled={team !== 2} onChange={e => setTop('table', e.target.value)}><option value="">{tx('Tabuleiro a tabuleiro')}</option><option value="equipas">{tx('2 contra 2 à mesma mesa')}</option><option value="2hg" disabled={!!F.cmd}>{tx('Two-Headed Giant (vida partilhada)')}</option></select></label>}
            <label className="fmt"><span>Seeds</span><select value={seeding} onChange={e => setSeeding(e.target.value)}><option value="aleatorio">{tx('Sorteados ao começar')}</option><option value="ordem">{tx('Pela ordem da lista')}</option></select></label>
          </div>
          {type === 'elim' && <label className="chk small"><input type="checkbox" checked={third} onChange={e => setThird(e.target.checked)} /> {tx('Jogo de 3.º lugar')}</label>}
          {type === 'equipas' && <div className="tc-team-opts">
            <label className="chk small" title={seeding === 'ordem' ? tx('Só com as equipas sorteadas ao começar.') : tx('No sorteio, a equipa mais fraca (pelo Elo) recebe o deck mais forte que falta: equipas com força parecida.')}>
              <input type="checkbox" checked={tops.balElo} disabled={seeding === 'ordem'} onChange={e => setTop('balElo', e.target.checked)} /> {tx('Equipas equilibradas pelo rating')}</label>
            {mixF && <label className="chk small" title={seeding === 'ordem' ? tx('Só com as equipas sorteadas ao começar.') : tx('No sorteio, cada formato espalha-se pelas equipas (ex.: 6 de Pauper e 6 de Modern em equipas de 2 = um de cada em todas); o que não der para espalhar decide-se pelo rating.')}>
              <input type="checkbox" checked={tops.balFmt} disabled={seeding === 'ordem'} onChange={e => setTop('balFmt', e.target.checked)} /> {tx('Espalhar os formatos pelas equipas')}</label>}
            {mixF && !table && <label className="chk small" title={tx('Em cada partida de equipas, os tabuleiros juntam decks do mesmo formato sempre que as duas equipas os tenham.')}>
              <input type="checkbox" checked={tops.sameFmt} onChange={e => setTop('sameFmt', e.target.checked)} /> {tx('Decks do mesmo formato frente a frente, quando dá')}</label>}
          </div>}
          <p className="small muted">{bo === 3 && type !== 'mesas' ? `${tx('Bo3 com sideboard inteligente entre jogos, como no Laboratório (decks com sideboard, em formatos que o têm), e aprende com as trocas que já perderam.')} ` : ''}{tx('Empates na eliminação repetem o jogo (até 2 vezes); depois passa o melhor seed. Jogos em que o Forge falha repetem-se.')}</p>
        </div>
        <div className="lab-step">
          <h4 className="step-h"><i>2</i> Decks <span className="chip">{n}/{max}</span></h4>
          <p className="small muted tc-info">{tx('Marca um dos teus com')} <b>{tx('☆ eu')}</b> {tx('para jogar «como se fosses tu»: fica destacado e vês até onde chegas.')}</p>
          <div className="tc-fill">
            <span>{tx('🎲 Preencher até')}</span><input type="number" min="2" max={max} value={fillN} onChange={e => setFillN(+e.target.value)} />
            <span className="seg small tc-srcs" role="group" aria-label={tx('De onde')}>{Object.entries(SRC_L).map(([k, l]) => (
              <button key={k} className={srcsOn.includes(k) ? 'on' : ''} aria-pressed={srcsOn.includes(k)} disabled={!avail[k]}
                title={!avail[k] ? ({ meu: tx('Não tens decks teus neste formato.'), ami: tx('Não há decks de amigos neste formato.'), com: tx('Não tens decks da comunidade neste formato.'), meta: tx('Sem decks do meta para este formato.') }[k]) : k === 'meta' && !casual ? tx('Com o meta ligado entra pelo menos 20% (torneio ranked). Desligado dá um torneio interno, não ranked.') : undefined}
                onClick={() => setSrcs(v => (v.includes(k) ? (v.length > 1 ? v.filter(x => x !== k) : v) : [...v, k]))}>{l}</button>))}</span>
            {srcsOn.length > 1 && <span className="tc-mix" role="group" aria-label={tx('Mistura')}>{srcsOn.map(k => (
              <label key={k} className={`tc-mix-${k}`}><span>{SRC_L[k]}</span>
                <input type="range" min={k === 'meta' ? META_MIN * 100 : 0} max="100" step="5" value={weights[k]} onChange={e => setMix(k, +e.target.value)} />
                <b>{Math.round((share[k] || 0) * 100)}%</b></label>
            ))}</span>}
            {!casual && <><span className="tc-stars">{tx('estrelas')} <select value={smin} onChange={e => setSmin(+e.target.value)} aria-label={tx('Mínimo de estrelas')}>{STEPS.map(x => <option key={x} value={x}>{x.toLocaleString(LOCALE)}</option>)}</select>
              {tx('a')} <select value={smax} onChange={e => setSmax(+e.target.value)} aria-label={tx('Máximo de estrelas')}>{STEPS.map(x => <option key={x} value={x}>{x.toLocaleString(LOCALE)}</option>)}</select></span>
            <label className="chk small"><input type="checkbox" checked={unrated} onChange={e => setUnrated(e.target.checked)} /> {tx('incluir decks sem rating')}</label></>}
            <label className="chk small" title={tx('Só os decks que marcaste com ★ na Biblioteca')}><input type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} /> ★ {tx('só favoritos')}</label>
            <button onClick={fill} disabled={n >= Math.min(fillN, max)}>{tx('Preencher')}</button>
            <select className="tc-champ-from" value={champFrom} onChange={e => { setChampFrom(e.target.value); setChamps(false); setPods(false) }} aria-label={tx('Campeões de')} title={tx('De que torneios vêm os campeões')}>
              <option value="">{tx('Campeões de todos os tipos')}</option>
              <option value="campeoes">{tx('🏆 Campeões dos campeões (platinas)')}</option>
              {Object.entries(TYPES).map(([k, [l]]) => <option key={k} value={k}>{tx('Campeões: {t}', { t: l })}</option>)}
            </select>
            <button className={pods ? 'on' : ''} onClick={pods ? () => setPods(false) : () => loadChampions([2, 3])} title={tx('Junta os 2.ºs e 3.ºs lugares dos torneios anteriores (com o mesmo filtro dos campeões). Troféus normais, mas valem menos pontos.')}>🥈 {pods ? tx('Liga dos pódios ✓') : tx('Pódios')}</button>
            <button className={champs ? 'on' : ''} onClick={champs ? () => setChamps(false) : () => loadChampions([1])} title={tx('Junta os vencedores dos torneios anteriores (deste formato; em modo casual, de todos). O vencedor leva o troféu de platina.')}>🏆 {champs ? tx('Torneio dos campeões ✓') : tx('Campeões')}</button>
            {n > 0 && <button className="link small" onClick={() => setPlayers([])}>{tx('limpar')}</button>}
          </div>
          <h4>{mixF ? tx('Os meus decks') : tx('Os meus decks de {f}', { f: F.name })} <span className="muted">({mine.filter(o => kindOf(o) === 'meu').length})</span></h4>
          <div className="opp-list">{mine.filter(o => kindOf(o) === 'meu').map(o => <button key={o.id} className={`opp ${has('meus', o.id) ? 'on' : ''}`} onClick={() => add('meus', o)}>+ {o.name}{mixF && <span className="muted"> · {FORMAT[o.format]?.name || o.format}</span>} {!casual && <Stars r={stars[rkey('meus', o.id)]} />}</button>)}{!mine.length && <span className="muted small">{tx('Nenhum deck teu neste formato.')}</span>}</div>
          {mine.some(o => kindOf(o) === 'ami') && <><h4>{tx('🤝 Dos amigos')} <span className="muted">({mine.filter(o => kindOf(o) === 'ami').length})</span></h4>
          <div className="opp-list">{mine.filter(o => kindOf(o) === 'ami').map(o => <button key={o.id} className={`opp ${has('meus', o.id) ? 'on' : ''}`} onClick={() => add('meus', o)}>+ {o.name} <span className="muted">· 🤝 {o.friendName}</span> {!casual && <Stars r={stars[rkey('meus', o.id)]} />}</button>)}</div></>}
          {mine.some(o => o.community) && <><h4>{tx('🌐 Da comunidade')} <span className="muted">({mine.filter(o => o.community).length})</span></h4>
          <div className="opp-list">{mine.filter(o => o.community).map(o => <button key={o.id} className={`opp ${has('meus', o.id) ? 'on' : ''}`} onClick={() => add('meus', o)}>+ {o.name}{mixF && <span className="muted"> · {FORMAT[o.format]?.name || o.format}</span>} {!casual && <Stars r={stars[rkey('meus', o.id)]} />}</button>)}{!mine.length && <span className="muted small">{tx('Nenhum deck teu neste formato.')}</span>}</div></>}
          <h4>{tx('Do meta')} {mixF ? <select className="tc-mf" value={mf} onChange={e => setMetaFmt(e.target.value)} aria-label={tx('Decks do meta de')}>{CASUAL_META.map(k => <option key={k} value={k}>{tx('de {f}', { f: FORMAT[k]?.name || k })}</option>)}</select> : null} <span className="muted">({meta.length})</span></h4>
          <div className="opp-list">{meta.map(o => <button key={o.id} className={`opp ${has('meta', o.id) ? 'on' : ''}`} onClick={() => add('meta', o)}>+ {o.name}{o.of && o.of !== mf && <span className="muted"> · {FORMAT[o.of]?.name}</span>} {o.share ? <span className="muted">{Math.round(o.share * 100)}%</span> : null} <Stars r={stars[rkey('meta', o.id)]} /></button>)}{!meta.length && <span className="muted small">{tx('Sem decks do meta para este formato.')}</span>}</div>
          <div className="tc-diff">
            <span className="small">{tx('Dificuldade:')}</span>
            <select value={allDiff} onChange={e => { setAllDiff(e.target.value); setPlayers(p => p.map(x => ({ ...x, difficulty: e.target.value }))) }} aria-label={tx('Dificuldade de todos')}>{diffs.filter(d => d.id !== 'random').map(d => <option key={d.id} value={d.id}>{tx('todos: {d}', { d: dLabel(d) })}</option>)}</select>
            <button onClick={randomDiffs} disabled={!n}>{tx('🎲 uma ao acaso a cada um')}</button>
          </div>
        </div>
      </div>
      {players.some(x => x.src === 'meus') && <label className="fmt tc-me"><span>{tx('🧙 O meu deck neste torneio')}</span>
        <select value={players.find(x => x.me)?.ref || ''} onChange={e => setMe(e.target.value)}>
          <option value="">{tx('— nenhum (só ver) —')}</option>
          {[...new Map(players.filter(x => x.src === 'meus').map(x => [x.ref, x])).values()].map(x => <option key={x.ref} value={x.ref}>{x.name}</option>)}
        </select>
        <small className="muted">{tx('Fica marcado a ciano na árvore, aparece em baixo (no teu lugar) nos jogos e tem o percurso seguido. A escolha fica guardada.')}</small>
      </label>}
      {n > 0 && <div className="tc-players">{players.map((p, k) => (
        <div key={p.key} data-k={k} className={`tp-card ${p.me ? 'me' : ''} ${dragK === k ? 'dragging' : ''}`} style={{ '--edge': edge(p.colors) }}>
          <div className="tp-art" onPointerDown={e => dragStart(e, k)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} title={tx('Arrasta para mudar a ordem')}>{data.byName.get(p.cover) ? <img src={img(data.byName.get(p.cover), 'art_crop')} alt="" loading="lazy" /> : <span>✦</span>}<i className="tp-seed" title="seed">{seeding === 'ordem' ? k + 1 : '?'}</i><span className="tp-src">{p.src === 'meta' ? 'meta' : p.fr ? `🤝 ${p.fr}` : tx('meu')}{casual && p.fmt ? ` · ${FORMAT[p.fmt]?.name || p.fmt}` : ''}</span></div>
          <div className="tp-body">
            <b title={p.name}>{p.name}</b>
            {type === 'equipas' && seeding === 'ordem' && <small className="muted">{table ? tx('Equipa {e}', { e: Math.floor(k / team) + 1 }) : tx('Equipa {e} · tabuleiro {b}', { e: Math.floor(k / team) + 1, b: (k % team) + 1 })}</small>}
            {type === 'gauntlet' && k === chK && <small style={{ color: 'var(--gold2)' }}>{tx('⚔ desafiante')}</small>}
            <span className="tp-l1">{p.colors ? <Mana cost={[...p.colors].map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}</span>
            <span className="tp-l2">{stars[rkey(p.src, p.ref)] ? <Stars r={stars[rkey(p.src, p.ref)]} /> : !casual && <span className="muted small">{tx('sem rating')}</span>}</span>
            <select value={p.difficulty} onChange={e => setP(k, { difficulty: e.target.value })} aria-label={tx('Dificuldade de {d}', { d: p.name })} title={DIFF_INFO[p.difficulty]?.resumo}>{diffs.filter(d => d.id !== 'random').map(d => <option key={d.id} value={d.id}>{dLabel(d)}</option>)}</select>
            <span className="row-btns">{p.src === 'meus' && <button className={`me-btn ${p.me ? 'on' : ''}`} onClick={() => setPlayers(ps => ps.map((x, i) => ({ ...x, me: i === k ? !x.me : false })))} aria-pressed={!!p.me} title={tx('É o teu deck: segues o percurso dele no torneio')}>{p.me ? tx('★ eu') : tx('☆ eu')}</button>}{seeding === 'ordem' && <><button onClick={() => move(k, -1)} disabled={!k} aria-label={tx('Subir')}>▲</button><button onClick={() => move(k, 1)} disabled={k === n - 1} aria-label={tx('Descer')}>▼</button></>}<button className="link small" onClick={() => setPlayers(x => x.filter((_, i) => i !== k))}>{tx('tirar')}</button></span>
          </div>
        </div>
      ))}</div>}
      <div className="row-btns tc-go">
        {asRoom ? <button className="primary" onClick={openRoom} disabled={busy || n > max}>{tx('🚪 Abrir a sala')}</button>
          : <button className="primary" onClick={start} disabled={busy || n < lo || n > max || teamBad}>{tx('🏆 Começar o torneio')}</button>}
        <label className="chk small" title={tx('Sem isto, o torneio espera 10 s antes do 1.º jogo para dar tempo de apostar')}><input type="checkbox" checked={hold} onChange={e => { setHold(e.target.checked); ls('grimorio.torneio.hold', e.target.checked ? '1' : '0') }} /> {tx('Só começar quando eu der OK')}</label>
        {!asRoom && <label className="chk small" title={canPlayMe ? tx('As partidas do teu deck esperam por ti e jogas tu, na mesa do Grimório; as outras jogam-nas os bots.') : tx('Escolhe «o meu deck» na lista (fora do Commander, das mesas e das equipas).')}><input type="checkbox" checked={canPlayMe && playMe} disabled={!canPlayMe} onChange={e => { setPlayMe(e.target.checked); ls('grimorio.torneio.playme', e.target.checked ? '1' : '0') }} /> 🎮 {tx('Jogo eu os jogos do meu deck (Forge Play)')}</label>}
        {n > 0 && (casual ? <span className="rk rk-cas" title={tx('Nos torneios casuais os troféus saem azuis e as estrelas amarelas não mexem.')}>{tx('Casual')}</span>
          : isRanked ? <span className="rk rk-ok" title={tx('Conta para as estrelas amarelas e dá troféus normais (ouro, prata e bronze).')}>🏅 {tx('Ranked')}</span>
            : <span className="rk rk-warn">⚠ {tx('Não ranked: {m} de {n} decks do meta (precisa de {k}). Conta só para as estrelas azuis e vermelhas e os troféus saem azuis.', { m: nMeta, n, k: metaNeed })}</span>)}
        <span className="small muted">{n < lo ? tx('Faltam {k} decks (mínimo {m}).', { k: lo - n, m: lo }) : teamBad ? tx('Com equipas de {s} o número de decks tem de ser múltiplo de {s}.', { s: team }) : tx('{p} partidas · ≈ {g} jogos · ≈ {t} min (um jogo de cada vez no Forge)', { p: matches, g: games, t: Math.max(1, Math.round((games * MIN_PER_GAME * (type === 'mesas' || table ? 2 : 1)) / 5) * 5) })}</span>
        {err && <span className="small bad-t">{err}</span>}
      </div>
    </section>
  )
}

// ---------- gerador: vários torneios de uma vez, cada característica fixa ou 🎲 ----------

const RND = '🎲'  // valor «ao acaso» nos seletores
const pick = a => a[Math.floor(Math.random() * a.length)]
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const STAR_SETS = { todas: [0, 6, tx('todas')], fracos: [0, 2.5, tx('fracos (0–2,5★)')], medios: [2, 4, tx('médios (2–4★)')], fortes: [3.5, 6, tx('fortes (3,5–6★)')] }
const GEN_FMTS = FORMATS.filter(f => f.key !== 'casual' && f.key !== 'limited')
const multi = f => FORMAT[f]?.cmd === 'commander' && f !== 'duel'  // Commander a 4: mesas
// cada característica é uma lista de opções marcadas: nenhuma = ao acaso entre todas, uma = fixa, várias = ao acaso entre essas
const GEN0 = { v: 2, count: 3, ms: { casual: ['nao'], mix: ['sim'], format: [], type: [], n: [], bo: [], stars: ['todas'], diff: ['default'], table: [], balFmt: ['sim'], balElo: ['sim'], sameFmt: ['sim'] }, fmtMine: true,
  srcs: ['meu', 'ami', 'com', 'meta'], w: { meu: 50, ami: 20, com: 10, meta: 30 }, wRnd: false, fav: false, cross: false }
const SRC_L = { meu: tx('🧙 Meus'), ami: tx('🤝 Amigos'), com: tx('🌐 Comunidade'), meta: tx('📊 Meta') }
const kindOf = o => (o.friend ? 'ami' : o.community ? 'com' : 'meu')  // um deck guardado: meu, de um amigo ou da comunidade
const fitsN = (k, v) => (k === 'equipas' ? [2, 3].some(t => v % t === 0 && v >= 3 * t && v <= 8 * t) : v >= TYPES[k][1] && v <= TYPES[k][2])
function Multi({ label, opts, value, onChange, any }) {  // caixa com opções marcáveis
  const on = value || [], same = (a, b) => String(a) === String(b), ref = useRef(null)
  useEffect(() => {  // fecha ao tocar fora
    const f = e => { if (ref.current?.open && !ref.current.contains(e.target)) ref.current.open = false }
    document.addEventListener('pointerdown', f); return () => document.removeEventListener('pointerdown', f)
  }, [])
  const txt = !on.length ? any || tx('🎲 todos') : on.length === 1 ? opts.find(([v]) => same(v, on[0]))?.[1] : tx('🎲 entre {n}', { n: on.length })
  return (
    <details className="gen-multi" ref={ref}><summary><small>{label}</small><b>{txt}</b></summary>
      <div className="gen-opts">
        {opts.map(([v, l]) => <label key={v} className="chk small"><input type="checkbox" checked={on.some(x => same(x, v))} onChange={e => onChange(e.target.checked ? [...on, v] : on.filter(x => !same(x, v)))} /> {l}</label>)}
        <button className="link small" onClick={() => onChange([])}>{tx('nenhum = ao acaso entre todos')}</button>
      </div>
    </details>)
}

function Generator({ data, onCreated }) {
  const [g, setG] = useState(() => { try { const o = JSON.parse(ls('grimorio.torneio.gerador') || '{}'); return o.v === 2 ? { ...GEN0, ...o, ms: { ...GEN0.ms, ...o.ms } } : GEN0 } catch { return GEN0 } })
  const set = (k, v) => setG(o => { const n = { ...o, [k]: v }; ls('grimorio.torneio.gerador', JSON.stringify(n)); return n })
  const setMs = (k, v) => set('ms', { ...g.ms, [k]: v })
  const among = (k, all) => (g.ms[k]?.length ? g.ms[k] : all)
  const [diffs, setDiffs] = useState([])
  const [allMine, setAllMine] = useState(null)
  const [list, setList] = useState([])  // os torneios gerados (pré-visualização)
  const [peek, setPeek] = useState(null)  // deck em destaque (rato por cima ou toque): {p, r (rect)}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cache = useRef({})  // por formato: meta e estrelas; por deck do meta: o deck (para a capa e as cores)
  useEffect(() => { j('/api/sim/difficulties').then(setDiffs).catch(() => {}); j('/api/decks').then(setAllMine).catch(() => setAllMine([])) }, [])
  const once = (k, f) => (cache.current[k] ??= f().catch(e => { delete cache.current[k]; throw e }))
  const metaOf = f => once(`m:${f}`, () => j(`/api/sim/opponents?format=${f}`))
  const starsOf = f => once(`s:${f}`, () => j(`/api/ratings?format=${f}`).then(r => Object.fromEntries((Array.isArray(r) ? r : r.rows || []).filter(x => x?.key).map(x => [x.key, x.stars]))).catch(() => ({})))
  const deckOf = (src, o) => (src === 'meus' ? Promise.resolve(o) : once(`d:${o.id}`, () => j(`/api/sim/opponents/${encodeURIComponent(o.id)}`)))
  const ids = diffs.map(d => d.id).filter(x => x !== 'random')

  // um torneio: sorteia o que está em 🎲 e escolhe os decks pelas regras do «Preencher» (fora do casual, ≥ 20% do meta)
  const make = async () => {
    const casual = pick(among('casual', ['nao', 'sim'])) === 'sim'
    const mix = casual && pick(among('mix', ['sim', 'nao'])) === 'sim'  // casual: misturar formatos ou só um
    // formato: os marcados; sem nenhum, por omissão só onde tens decks teus (senão saíam quase todos só com meta)
    const withMine = CASUAL_META.filter(f => (allMine || []).some(d => d.format === f && !d.casual && kindOf(d) === 'meu'))
    // tipo primeiro, igual para todos os permitidos (o jogo avulso não é torneio); o formato a seguir, conforme o tipo (game.js)
    const { type, format } = genShape({ types: among('type', Object.keys(TYPES).filter(k => k !== 'jogo')), formats: g.ms.format.length ? g.ms.format : g.fmtMine && withMine.length ? withMine : CASUAL_META,
      multi, ownIn: f => (allMine || []).some(d => kindOf(d) === 'meu' && !(g.fav && !d.fav) && (mix || (!d.casual && d.format === f))) })
    const mf = mix ? pick(CASUAL_META) : format
    const crossF = g.cross && !mix && CROSS[format]  // decks legais de formatos englobados (ex.: Modern num Legacy)
    const mine = (allMine || []).filter(d => mix || (!d.casual && (d.format === format || (crossF && crossF.includes(d.format) && legalDeck(d, format, data))))).filter(d => !g.fav || d.fav)
    const own = mine.filter(o => kindOf(o) === 'meu')
    // nº de decks: um dos marcados que caiba no tipo; se nenhum couber, o mais perto (o tipo não se troca por causa disto)
    const nSet = g.ms.n.map(Number)
    const nOk = nSet.filter(v => fitsN(type, v))
    const team = type === 'equipas' ? pick([2, 3].filter(t => !nOk.length || nOk.some(v => v % t === 0))) || 2 : 2
    const metaFs = [mf, ...(crossF ? crossF.filter(f => CASUAL_META.includes(f)) : [])]
    const meta = (await Promise.all(metaFs.map(f => metaOf(f).then(l => l.map(o => ({ ...o, of: f }))).catch(() => [])))).flat(), stars = casual ? {} : await starsOf(format)
    const avail = { meu: own.length > 0, ami: mine.some(o => kindOf(o) === 'ami'), com: mine.some(o => kindOf(o) === 'com'), meta: meta.length > 0 }
    const srcs = Object.keys(avail).filter(k => avail[k] && (g.srcs || GEN0.srcs).includes(k))
    const w = Object.fromEntries(srcs.map(k => [k, g.wRnd ? rint(0, 10) * 10 : (g.w || GEN0.w)[k] ?? 0]))
    if (!casual && 'meta' in w) w.meta = Math.max(20, w.meta)
    const [smin, smax] = STAR_SETS[pick(among('stars', Object.keys(STAR_SETS)))]
    const inStars = (s, id) => { const x = stars[rkey(s, id)]; return casual || x == null || (x >= smin && x <= smax) }
    const okSrc = (s, o) => srcs.includes(s === 'meta' ? 'meta' : kindOf(o))
    const pool = [...mine.map(o => ['meus', o]), ...meta.map(o => ['meta', o])].filter(([s, o]) => okSrc(s, o) && inStars(s, o.id)).sort(() => Math.random() - 0.5)
    let [, lo, hi] = TYPES[type]
    if (type === 'equipas') { lo = 3 * team; hi = 8 * team }
    const top = Math.min(hi, pool.length, 16)
    // o nº pedido: um dos marcados que caiba; se nenhum couber ou faltarem decks, o maior possível (sem bloquear)
    const want = nOk.length ? pick(nOk) : nSet.length ? nSet.reduce((a, v) => (Math.abs(v - Math.min(hi, Math.max(lo, v))) < Math.abs(a - Math.min(hi, Math.max(lo, a))) ? v : a)) : 0
    let n = want ? Math.max(lo, Math.min(hi, want, pool.length)) : rint(lo, Math.max(lo, top))
    if (type === 'equipas') n -= n % team
    const bos = among('bo', [1, 1, 3, 3, 2, 5]).map(Number).filter(b => b !== 2 || BO2.includes(type))
    const bo = type === 'mesas' ? 1 : bos.length ? pick(bos) : 3
    const dsel = pick(among('diff', ids.length ? ids : ['default'])), diff = dsel === 'cada' ? null : dsel
    const yes = k => pick(among(k, ['sim', 'nao'])) === 'sim'  // opções de equipas: sim, não ou ao acaso
    const tbl = team === 2 ? pick(among('table', ['nao', 'equipas', '2hg']).filter(v => v !== '2hg' || !FORMAT[format]?.cmd)) : ''
    const tops = type !== 'equipas' ? {} : { table: tbl === 'nao' ? '' : tbl || '', bal_fmt: mix && yes('balFmt'), bal_elo: yes('balElo'), same_fmt: mix && yes('sameFmt') }
    const base = { key: Math.random(), casual, mix, format, type, team, bo, smin, smax, n, w, mf, cross: !!crossF, tops }
    if (want && n < want) base.note = tx('Pediste {w} decks; entraram {n} (o máximo para {t} com os decks que há).', { w: want, n, t: TYPES[type][0] })
    if (pool.length < lo || n < lo) return { ...base, players: [], bad: tx('Só há {k} decks para {t} em {f} (mínimo {m}).', { k: pool.length, t: TYPES[type][0], f: mix ? tx('casual') : FORMAT[format]?.name, m: lo }) }
    let chosen = mixTake(pool, n, w, casual || !srcs.includes('meta') ? 0 : 0.2)
    if (type === 'gauntlet') {  // o desafiante (1.º, ☆ eu) é um deck meu
      const ch = chosen.find(([s, o]) => s === 'meus' && kindOf(o) === 'meu') || (own.length && ['meus', pick(own)])
      if (ch) chosen = [ch, ...chosen.filter(x => x !== ch && !(x[0] === 'meus' && x[1].id === ch[1].id))].slice(0, n)
    }
    const resolve = async ([src, o]) => {
      const d = await deckOf(src, o).catch(() => null), c = d && coverOf(d, data)
      if (d && src === 'meta' && o.of !== format && !mix && !legalDeck(d, format, data)) return null  // meta de outro formato com cartas ilegais aqui
      return d && { src, ref: o.id, name: o.name, com: !!o.community, fr: o.friendName || (o.friend ? '?' : ''), difficulty: diff || pick(ids.length ? ids : ['default']), cover: c?.n || '', colors: colorsOf(d, data).join('') }
    }
    let players = (await Promise.all(chosen.map(resolve))).filter(Boolean)
    for (let left = pool.filter(x => !chosen.includes(x)); players.length < n && left.length;) {  // os que caíram (ilegais) são trocados por outros
      const more = mixTake(left, n - players.length, w, 0); left = left.filter(x => !more.includes(x))
      players = [...players, ...(await Promise.all(more.map(resolve))).filter(Boolean)]
    }
    const nMeta = players.filter(p => p.src === 'meta').length
    const name = `${RND} ${TYPES[type][0]} · ${mix ? tx('casual') : casual ? `${FORMAT[format]?.name} · ${tx('casual')}` : FORMAT[format]?.name} · ${new Date().toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' })}`
    const eu = ls('grimorio.torneio.eu'), mi = players.findIndex(p => p.src === 'meus' && !p.com && !p.fr && (type === 'gauntlet' || p.ref === eu))
    return { ...base, players, name, me: mi, ranked: !casual && nMeta >= Math.max(1, Math.ceil(0.2 * players.length - 1e-9)), bad: players.length < lo ? tx('Faltaram decks.') : '' }
  }
  const generate = async () => {
    setBusy(true); setErr('')
    try { setList(await Promise.all(Array.from({ length: Math.max(1, Math.min(10, +g.count || 1)) }, make))) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const redo = async k => { const t = await make().catch(() => null); if (t) setList(l => l.map((x, i) => (i === k ? t : x))) }
  const good = list.filter(t => !t.bad)
  const createAll = async () => {
    setBusy(true); setErr('')
    let ok = 0
    for (const t of good) {
      try {
        await post('/api/tournaments', { name: t.name, type: t.type, format: t.format, casual: t.casual, hold: ls('grimorio.torneio.hold') === '1', bo: t.bo, third: true, seeding: 'aleatorio', team: t.team,
          cross: t.cross, ...t.tops, players: t.players.map(({ src, ref, difficulty, cover, colors }, i) => ({ src, ref, difficulty, cover, colors, me: i === t.me })) })
        ok++
      } catch (e) { setErr(`${t.name}: ${e.message}`) }
    }
    setBusy(false)
    if (ok) { setList([]); onCreated() }
  }
  const w = g.w || GEN0.w, on = g.srcs || GEN0.srcs, wsum = on.reduce((a, k) => a + (w[k] ?? 0), 0) || 1
  return (
    <section className="card tour-gen">
      <h3>{tx('Gerador de torneios')} <span className="muted small">{tx('cria vários torneios de uma vez; em cada característica marca uma opção (fixa) ou várias (sai uma ao acaso em cada torneio)')}</span></h3>
      <div className="gen-grid">
        <label className="fmt"><span>{tx('Quantos')}</span><input type="number" min="1" max="10" value={g.count} onChange={e => set('count', e.target.value)} /></label>
        <Multi label={tx('Modo')} value={g.ms.casual} onChange={v => setMs('casual', v)} opts={[['nao', tx('Normal (ranked)')], ['sim', tx('Casual (não conta para os ratings)')]]} />
        {(!g.ms.casual.length || g.ms.casual.includes('sim')) && <Multi label={tx('Misturar formatos (casual)')} value={g.ms.mix} onChange={v => setMs('mix', v)} opts={[['sim', tx('Sim')], ['nao', tx('Não, só um formato')]]} />}
        <Multi label={tx('Formato')} value={g.ms.format} onChange={v => setMs('format', v)} opts={GEN_FMTS.map(f => [f.key, f.name])} any={g.fmtMine ? tx('🎲 onde tenho decks') : tx('🎲 todos')} />
        <Multi label={tx('Tipo')} value={g.ms.type} onChange={v => setMs('type', v)} opts={Object.entries(TYPES).map(([k, [l]]) => [k, l])} />
        <Multi label={tx('Decks')} value={g.ms.n} onChange={v => setMs('n', v)} opts={[4, 6, 8, 10, 12, 16, 20, 24, 32].map(x => [x, String(x)])} />
        <Multi label={tx('Partidas')} value={g.ms.bo} onChange={v => setMs('bo', v)} opts={[[1, 'Bo1'], [2, tx('Bo2 (onde pode empatar)')], [3, 'Bo3'], [5, 'Bo5']]} />
        <Multi label={tx('Estrelas')} value={g.ms.stars} onChange={v => setMs('stars', v)} opts={Object.entries(STAR_SETS).map(([k, [, , l]]) => [k, l])} />
        <Multi label={tx('Dificuldade')} value={g.ms.diff} onChange={v => setMs('diff', v)} opts={[['cada', tx('🎲 uma a cada deck')], ...diffs.filter(d => d.id !== 'random').map(d => [d.id, dLabel(d)])]} />
        {(!g.ms.type.length || g.ms.type.includes('equipas')) && <>
          <Multi label={tx('Equipas: como jogam')} value={g.ms.table} onChange={v => setMs('table', v)} opts={[['nao', tx('Tabuleiro a tabuleiro')], ['equipas', tx('2 contra 2 à mesma mesa')], ['2hg', tx('Two-Headed Giant (vida partilhada)')]]} />
          <Multi label={tx('Equipas: equilibrar pelo rating')} value={g.ms.balElo} onChange={v => setMs('balElo', v)} opts={[['sim', tx('Sim')], ['nao', tx('Não')]]} />
          {(!g.ms.casual.length || g.ms.casual.includes('sim')) && <>
            <Multi label={tx('Equipas: espalhar formatos')} value={g.ms.balFmt} onChange={v => setMs('balFmt', v)} opts={[['sim', tx('Sim')], ['nao', tx('Não')]]} />
            <Multi label={tx('Equipas: mesmo formato frente a frente')} value={g.ms.sameFmt} onChange={v => setMs('sameFmt', v)} opts={[['sim', tx('Sim')], ['nao', tx('Não')]]} />
          </>}
        </>}
        <span className="gen-chks">
          {!g.ms.format.length && <label className="chk small"><input type="checkbox" checked={g.fmtMine} onChange={e => set('fmtMine', e.target.checked)} /> {tx('formato ao acaso só onde tenho decks')}</label>}
          <label className="chk small"><input type="checkbox" checked={g.fav} onChange={e => set('fav', e.target.checked)} /> ★ {tx('dos meus, só favoritos')}</label>
          <label className="chk small" title={tx('Só em Legacy, Vintage, Modern e Pioneer; cada deck tem de ser legal carta a carta.')}><input type="checkbox" checked={!!g.cross} onChange={e => set('cross', e.target.checked)} /> {tx('aceitar decks legais de outros formatos')}</label>
        </span>
      </div>
      <div className="tc-fill gen-mix">
        <b className="small">{tx('Que decks entram')}</b>
        <span className="seg small tc-srcs" role="group" aria-label={tx('De onde')}>{Object.keys(SRC_L).map(k => (
          <button key={k} className={on.includes(k) ? 'on' : ''} aria-pressed={on.includes(k)} onClick={() => set('srcs', on.includes(k) ? (on.length > 1 ? on.filter(x => x !== k) : on) : [...on, k])}>{SRC_L[k]}</button>))}</span>
        {on.length > 1 && !g.wRnd && <span className="tc-mix">{on.map(k => (
          <label key={k} className={`tc-mix-${k}`}><span>{SRC_L[k]}</span>
            <input type="range" min="0" max="100" step="5" value={w[k] ?? 0} onChange={e => set('w', { ...w, [k]: +e.target.value })} /><b>{Math.round((100 * (w[k] ?? 0)) / wsum)}%</b></label>))}</span>}
        {on.length > 1 && <label className="chk small"><input type="checkbox" checked={!!g.wRnd} onChange={e => set('wRnd', e.target.checked)} /> 🎲 {tx('percentagens ao acaso em cada torneio')}</label>}
        <span className="small muted">{on.includes('meta') ? tx('Nos torneios normais o meta fica com pelo menos 20% (ranked).') : tx('Sem meta: torneios internos, não ranked.')}</span>
      </div>
      <p className="small muted tc-info">{tx('O formato ao acaso escolhe entre os que têm decks do meta. Commander a 4 joga em mesas. A seguir é só vê-los no Registo e no Ao vivo: o simulador reparte os jogos como está nas Definições.')}</p>
      <div className="row-btns">
        <button onClick={generate} disabled={busy || allMine == null}>{tx('🎲 Gerar')}</button>
        {good.length > 0 && <button className="primary" onClick={createAll} disabled={busy}>{tx('🏆 Criar os {k} torneios', { k: good.length })}</button>}
        {busy && <span className="small muted">{tx('a escolher os decks…')}</span>}
        {err && <span className="small bad-t">{err}</span>}
      </div>
      {peek && createPortal(<GenPeek data={data} p={peek.p} r={peek.r} diffs={diffs} onClose={() => setPeek(null)} />, document.body)}
      {list.length > 0 && <div className="gen-list">{list.map((t, k) => (
        <div key={t.key} className={`gen-row ${t.bad ? 'bad' : ''}`}>
          <TypeIco k={t.type} />
          <div className="gen-info">
            <b>{TYPES[t.type][0]}</b>
            <span className="small">{t.mix ? `${tx('casual')} · ${tx('meta de {f}', { f: FORMAT[t.mf]?.name || t.mf })}` : t.casual ? `${FORMAT[t.format]?.name} · ${tx('casual')}` : FORMAT[t.format]?.name} · {tx('{n} decks', { n: t.players.length || t.n })} · Bo{t.bo}{t.type === 'equipas' ? ` · ${tx('equipas de {s}', { s: t.team })}${t.tops?.table ? ` · ${tableL(t.tops.table)}` : ''}` : ''}</span>
            <span className="small muted">{[['meu', tx('🧙 meus')], ['ami', tx('🤝 amigos')], ['com', tx('🌐 comunidade')], ['meta', tx('📊 meta')]].map(([s, l]) => [l, t.players.filter(p => (p.src === 'meta' ? 'meta' : p.fr ? 'ami' : p.com ? 'com' : 'meu') === s).length]).filter(([, c]) => c).map(([l, c]) => `${c} ${l}`).join(' · ')}{!t.casual && ` · ${t.smin.toLocaleString(LOCALE)}–${t.smax.toLocaleString(LOCALE)}★`}</span>
            {t.note && !t.bad && <span className="small muted">ℹ {t.note}</span>}
            {t.bad ? <span className="small bad-t">{t.bad}</span> : t.casual ? <span className="rk rk-cas">{tx('Casual')}</span> : t.ranked ? <span className="rk rk-ok">🏅 {tx('Ranked')}</span> : <span className="rk rk-warn">⚠ {tx('Não ranked')}</span>}
          </div>
          <div className="gen-decks">{t.players.map((p, i) => { const mine = p.src === 'meus' && !p.com && !p.fr; return (
            <span key={i} className={`gen-deck ${mine ? 'mine' : ''} ${t.me === i ? 'me' : ''}`} style={{ '--edge': edge(p.colors) }} role={mine ? 'button' : undefined} tabIndex={mine ? 0 : undefined}
              onPointerEnter={e => e.pointerType === 'mouse' && setPeek({ p, r: e.currentTarget.getBoundingClientRect() })} onPointerLeave={e => e.pointerType === 'mouse' && setPeek(null)}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); if (e.nativeEvent.pointerType !== 'mouse') setPeek(pk => (pk?.p === p ? null : { p, r })); if (mine) setList(l => l.map((x, j) => (j === k ? { ...x, me: x.me === i ? -1 : i } : x))) }}
              title={`${p.name} · ${p.src === 'meta' ? 'meta' : p.fr ? `🤝 ${p.fr}` : p.com ? tx('comunidade') : tx('meu')}${mine ? ` — ${t.me === i ? tx('jogas com este (clica para tirar)') : tx('clica para jogares com este')}` : ''}`}>{data.byName.get(p.cover) ? <img src={img(data.byName.get(p.cover), 'art_crop')} alt="" loading="lazy" /> : <i>✦</i>}{t.me === i && <b className="gen-eu">{tx('eu')}</b>}</span>) })}</div>
          <span className="row-btns gen-btns"><button onClick={() => redo(k)} disabled={busy} title={tx('Sortear este outra vez')}>🎲</button><button className="link small" onClick={() => setList(l => l.filter((_, i) => i !== k))}>{tx('tirar')}</button></span>
        </div>))}</div>}
    </section>
  )
}

// destaque de um deck no gerador: arte grande, de quem é, cores e dificuldade (rato por cima ou toque)
function GenPeek({ data, p, r, diffs, onClose }) {
  const c = data.byName.get(p.cover), W = 260, left = Math.max(8, Math.min(window.innerWidth - W - 8, r.left + r.width / 2 - W / 2))
  const below = r.bottom + 230 < window.innerHeight, d = diffs.find(x => x.id === p.difficulty)
  return (
    <div className="gen-peek" style={{ left, width: W, ...(below ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 }), '--edge': edge(p.colors) }} onClick={onClose}>
      <div className="gp-art">{c ? <img src={img(c, 'art_crop')} alt="" /> : <span>✦</span>}</div>
      <b>{p.name}</b>
      <span className="small">{p.src === 'meta' ? tx('📊 Meta') : p.fr ? `🤝 ${p.fr}` : p.com ? tx('🌐 Comunidade') : tx('🧙 Meu')}{c ? ` · ${tx('capa: {c}', { c: c.n })}` : ''}</span>
      <span className="gp-row">{p.colors ? <Mana cost={[...p.colors].map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}{d && <span className="small muted">🤖 {dLabel(d)}</span>}</span>
    </div>
  )
}

// ---------- salas: torneios com amigos (rooms.py) ----------
const OLD_H = 12
function Rooms({ data, guest, open, openTable }) {
  const [list, setList] = useState(null), [decks, setDecks] = useState([]), [pick, setPick] = useState({}), [err, setErr] = useState(''), [showOld, setShowOld] = useState(false)
  const [net] = useNet(!guest), [copied, setCopied] = useState('')  // o link da sala é o endereço público (túnel ou domínio próprio)
  const copyLink = async (url, k) => { try { await navigator.clipboard.writeText(url); setCopied(k); setTimeout(() => setCopied(''), 1500) } catch { window.prompt(tx('Copia o link:'), url) } }
  const seen = useRef({}), seats = useRef({}), [toast, setToast] = useState(null), [busy, setBusy] = useState('')  // mesa livre onde estou: quando o anfitrião começa, abre-se sozinha
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
  const act = async (id, a, body) => { setErr(''); setBusy(`${id}:${a}`); try { const r = await post(`/api/rooms/${id}/${a}`, body); if (a === 'start' && r.table) return openTable(r.table); if (a === 'start' && r.tid) open(r.tid); load() } catch (e) { setErr(e.message) } finally { setBusy('') } }
  const solo = async r => { const p = r.players.find(x => x.mine); if (!p) return; setBusy(`${r.id}:solo`); try { openTable((await post('/api/freetables', { deck: p.ref })).id) } catch (e) { setErr(e.message); setBusy('') } }
  if (!list) return <p className="muted">{err || tx('a carregar…')}</p>
  const myDecks = r => decks.filter(d => (guest ? true : !d.friend && !d.community) && (r.casual || (d.format === r.format && !d.casual)))
  // abertas primeiro; as começadas há mais de OLD_H horas dobram-se em «mostrar antigas» (as canceladas não aparecem)
  const live = list.filter(r => r.status !== 'cancelled'), isOld = r => r.status !== 'open' && Date.now() / 1000 - r.ts > OLD_H * 3600
  const old = live.filter(isOld), shown = [...live.filter(r => r.status === 'open'), ...live.filter(r => r.status !== 'open' && !isOld(r)), ...(showOld ? old : [])]
  return (
    <section className="card rooms">
      <h3>🚪 {tx('Salas')} <span className="muted small">{guest ? tx('Entra numa sala com um deck teu; quem aloja começa quando estiverem todos.') : tx('Abre uma sala em «✦ Nova sala» e partilha o link: quem o abre entra com um deck seu e tu começas quando estiverem todos.')}</span></h3>
      {!guest && <RemoteJoin data={data} />}
      {err && <p className="small bad-t">{err}</p>}
      {toast && <p className="ml-room-toast" role="status">{toast}</p>}
      {!shown.length && <p className="muted small">{tx('Não há salas abertas.')}</p>}
      {shown.map(r => { const mine = r.players.filter(p => p.mine), opts = myDecks(r), sel = pick[r.id] || opts[0]?.id || ''; return (
        <div key={r.id} className={`room ${r.status}`}>
          <div className="room-h"><TypeIco k={r.type} /><b>{r.name}</b>
            <span className="small muted">{r.type === 'livre' ? tx('Mesa livre') : TYPES[r.type]?.[0]} · {r.casual ? (r.type === 'livre' ? tx('qualquer formato') : tx('casual')) : FORMAT[r.format]?.name || r.format} · {r.players.length}/{r.max} {tx('(mínimo {m})', { m: r.min })}</span>
            <span className={`room-mode ${r.type === 'livre' || r.free ? 'livre' : 'bots'}`} title={(r.free ? MODES.livretorneio : MODES[r.type] || MODES.torneio).slice(1).join(' ')}>{r.free ? `🃏 ${tx('torneio sem bots')}` : r.type === 'livre' ? `🃏 ${tx('sem bots, sem regras')}` : `🤖 ${tx('os bots do Forge jogam')}`}</span>
            {r.status === 'started' ? (r.type === 'livre' ? (r.players.some(p => p.mine) || !guest ? <button className="primary small" onClick={() => openTable(r.tid)}>{tx('🃏 Ir para a mesa')}</button> : <span className="small muted">{tx('a jogar')}</span>)
              : <button className="primary small" onClick={() => open(r.tid)}>{r.type === 'jogo' ? tx('🎲 Ver o jogo') : tx('🏆 Ver o torneio')}</button>)
              : !guest && <span className="row-btns"><button className="primary small" disabled={r.players.length < r.min || !!busy} onClick={() => act(r.id, 'start')} title={r.players.length < r.min ? tx('Precisa de pelo menos {m} jogadores (há {n})', { m: r.min, n: r.players.length }) : undefined}>{busy === `${r.id}:start` ? tx('A abrir a mesa…') : tx('▶ Começar')}</button><button className="link small" onClick={() => act(r.id, 'cancel')}>{tx('cancelar')}</button></span>}
          </div>
          {!guest && r.status === 'open' && r.link && <div className="small room-link">
            {net?.public ? <p>🔗 {tx('Link da sala (entra quem o abrir, mesmo sem estar nos amigos):')} <code>{net.public}{r.link}</code> <button className="small" onClick={() => copyLink(net.public + r.link, r.id)}>{copied === r.id ? tx('copiado ✓') : tx('copiar')}</button></p>
              : <p className="muted">🔗 {tx('O link da sala aparece quando abrires este Grimório à internet (em cima).')}</p>}
            {net?.lan && <p className="muted">🏠 {tx('Sem internet, na mesma rede:')} <code>{net.lan}{r.link}</code> <button className="link small" onClick={() => copyLink(net.lan + r.link, r.id + 'l')}>{copied === r.id + 'l' ? tx('copiado ✓') : tx('copiar')}</button></p>}
          </div>}
          {r.type === 'livre' ? <>
            {r.status === 'open' && (() => {
              const n = r.players.length, me = mine[0], all = n >= r.min && r.players.every(p => p.ready)
              return <p className={`ml-wait ${n >= r.min ? 'ready' : ''} ${r.go != null ? 'go' : ''}`} role="status"><i className="ml-pulse" />
                {r.go != null ? <b>{tx('Todos prontos! A mesa abre em {s} s…', { s: Math.ceil(r.go) })}</b>
                  : n < r.min ? tx('À espera de jogadores: {n} de {m} para começar (cabem {x})', { n, m: r.min, x: r.max })
                    : all ? tx('Todos prontos.') : tx('{k} de {n} prontos. A mesa abre quando todos carregarem em «Pronto»{h}.', { k: r.players.filter(p => p.ready).length, n, h: guest ? '' : tx(' (ou começa já)') })}
                {me && !me.ready && n >= r.min && r.go == null && <> · <b>{tx('carrega em «Pronto»')}</b></>}
                {guest && me && n < r.min && <> · {tx('estás sentado; a mesa abre-se sozinha quando houver gente que chegue e estiverem todos prontos')}</>}</p>
            })()}
            <Seats r={r} guest={guest} act={act} />
            {r.status === 'open' && mine.length > 0 && <div className="row-btns ml-readyrow">
              <button className={mine[0].ready ? 'on ml-ready' : 'primary ml-ready'} onClick={() => act(r.id, 'ready', { on: !mine[0].ready })} aria-pressed={mine[0].ready} disabled={busy === `${r.id}:ready`}>{mine[0].ready ? tx('✓ Pronto (carrega para esperar)') : tx('✋ Estou pronto')}</button></div>}
            {!guest && r.status === 'open' && r.players.length < r.min && <p className="small muted">{tx('Precisa de pelo menos {m} jogadores: partilha o link (em cima). Enquanto esperas, podes testar o teu deck sozinho:', { m: r.min })} <button className="small" onClick={() => solo(r)} disabled={!!busy}>{busy === `${r.id}:solo` ? tx('A abrir a mesa…') : `🃏 ${tx('Jogar a solo')}`}</button></p>}
            {!guest && r.status === 'open' && <LendPanel r={r} data={data} act={act} />}
            {r.status === 'open' && <p className="small muted room-why">{MODES.livre[1]} {MODES.livre[2]}</p>}
            {r.status === 'open' && !mine.length && <JoinPanel key={`${r.id}${decks.length}`} r={r} data={data} decks={myDecks(r)} guest={guest} busy={busy === `${r.id}:join`}
              onJoin={b => act(r.id, 'join', b)} reload={() => j('/api/decks').then(setDecks)} />}
          </> : <ul className="room-pl">{r.players.map((p, k) => (
            <li key={k} className={p.by ? 'fr' : ''}>{p.by ? `🤝 ${p.by}` : '🏠'} · {p.name}{(!guest || p.mine) && r.status === 'open' && <button className="link small" onClick={() => act(r.id, 'leave', { ref: p.ref })}>{tx('tirar')}</button>}</li>))}</ul>}
          {r.free && r.status === 'open' && <><p className="small muted room-why">{MODES.livretorneio[1]} {MODES.livretorneio[2]}</p>
            {!guest && <LendPanel r={r} data={data} act={act} />}
            <JoinPanel key={`${r.id}${decks.length}${mine.length}`} r={r} data={data} decks={myDecks(r)} guest={guest} busy={busy === `${r.id}:join`} onJoin={b => act(r.id, 'join', b)} reload={() => j('/api/decks').then(setDecks)} />
            {mine.length > 0 && <p className="small muted">{tx('Tens {n} deck(s) neste torneio. Podes juntar mais.', { n: mine.length })}</p>}</>}
          {r.type !== 'livre' && !r.free && r.status === 'open' && (!guest || !mine.length) && (opts.length ? (
            <div className="row-btns"><select value={sel} onChange={e => setPick(x => ({ ...x, [r.id]: e.target.value }))} aria-label={tx('Deck para entrar')}>{opts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              <button onClick={() => act(r.id, 'join', { deck: sel })} disabled={!sel || r.players.length >= r.max}>{tx('＋ Entrar com este deck')}</button></div>)
            : <p className="small muted">{guest ? tx('Não tens decks de {f}. Cria um no Construir.', { f: r.casual ? tx('qualquer formato') : FORMAT[r.format]?.name || r.format }) : null}</p>)}
        </div>) })}
      {old.length > 0 && <button className="link small" onClick={() => setShowOld(v => !v)} aria-expanded={showOld}>{showOld ? tx('▴ esconder as antigas') : tx('▾ mostrar antigas ({n}, começadas há mais de {h} h)', { n: old.length, h: OLD_H })}</button>}
    </section>
  )
}

// ---------- separador Apostas: carteira, números e histórico de todas as apostas ----------

const KIND_LBL = { champ: tx('campeão'), match: tx('partida') }
const net = x => (x.status === 'won' || x.status === 'lost' ? x.payout - x.stake : 0)  // devolvidas e em jogo não contam

function BetsTab({ open }) {
  const [d, setD] = useState(null)
  const [fs, setFs] = useState('todas'), [fk, setFk] = useState('todas')
  useEffect(() => { j('/api/tournaments/bets').then(setD).catch(() => setD({ coins: 0, bets: [], start: 1000 })) }, [])
  if (!d) return <p className="muted">{tx('a carregar…')}</p>
  const B = d.bets, done = B.filter(x => x.status === 'won' || x.status === 'lost'), won = done.filter(x => x.status === 'won')
  const staked = done.reduce((a, x) => a + x.stake, 0), profit = done.reduce((a, x) => a + net(x), 0)
  const best = won.reduce((a, x) => (!a || net(x) > net(a) ? x : a), null)
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—')
  const sign = v => (v > 0 ? `+${v}` : String(v))
  const groups = (key, lbl) => Object.entries(done.reduce((o, x) => { (o[x[key]] ??= []).push(x); return o }, {}))
    .map(([k, xs]) => ({ k, l: lbl(k), n: xs.length, w: xs.filter(x => x.status === 'won').length, p: xs.reduce((a, x) => a + net(x), 0), s: xs.reduce((a, x) => a + x.stake, 0) }))
    .sort((a, b) => b.n - a.n)
  const RES = { open: ['⏳', tx('em jogo')], won: ['✓', tx('ganha')], lost: ['✗', tx('perdida')], refund: ['↺', tx('devolvida')] }
  const rows = B.filter(x => (fs === 'todas' || x.status === fs) && (fk === 'todas' || x.kind === fk))
  const broke = d.coins < 50, R = d.resets || []
  const restart = async () => {
    if (!(await ask('carteira', { title: tx('Recomeçar a carteira com {n} moedas?', { n: d.start }), body: tx('Tens {c} moedas. O histórico e as estatísticas das apostas ficam; só a carteira volta ao começo (e conta como um recomeço).', { c: d.coins }), ok: tx('Recomeçar'), danger: !broke }))) return
    setD(await post('/api/tournaments/wallet-reset', { confirm: true }))
  }
  return (
    <section className="card bets-tab">
      <h3>🪙 {tx('Apostas')} <span className="muted small">{tx('Moedas a fingir: não se compram nem valem dinheiro. As odds vêm do Elo de cada deck.')} {tx('Abaixo de 50 moedas recebes um subsídio de 100 por dia; e podes sempre recomeçar a carteira.')}</span></h3>
      <div className="bt-tiles">
        <div className={broke ? 'bt-broke' : ''}><small>{tx('Carteira')}</small><b className="gold-t">{d.coins}</b>
          <span className="muted small">{R.length ? tx('recomeçada {k}× · última {t}', { k: R.length, t: when(R[R.length - 1]) }) : tx('começaste com {n}', { n: d.start })}</span>
          <button className={`small ${broke ? 'primary' : 'link'}`} onClick={restart} title={tx('A carteira volta às {n} moedas do começo', { n: d.start })}>↺ {broke ? tx('Sem moedas? Recomeçar com {n}', { n: d.start }) : tx('recomeçar a carteira')}</button></div>
        <div><small>{tx('Lucro')}</small><b className={profit > 0 ? 'res-w' : profit < 0 ? 'res-l' : ''}>{sign(profit)}</b><span className="muted small">{tx('retorno {r} do apostado', { r: pct(profit, staked) })}</span></div>
        <div><small>{tx('Acerto')}</small><b>{pct(won.length, done.length)}</b><span className="muted small">{tx('{w} de {n} decididas', { w: won.length, n: done.length })}</span></div>
        <div><small>{tx('Apostas')}</small><b>{B.length}</b><span className="muted small">{tx('{k} em jogo', { k: B.filter(x => x.status === 'open').length })}</span></div>
        <div><small>{tx('Maior prémio')}</small><b>{best ? sign(net(best)) : '—'}</b><span className="muted small" title={best ? `${best.who} · ${best.tname}` : ''}>{best ? tx('odd {o} · {w}', { o: best.odds.toFixed(2), w: best.who }) : tx('ainda nenhum')}</span></div>
      </div>
      {done.length > 1 && <ProfitLine bets={[...done].sort((a, b) => a.ts - b.ts)} />}
      {done.length > 0 && <div className="bt-groups">{[[tx('Por tipo de aposta'), groups('kind', k => KIND_LBL[k] || k)], [tx('Por tipo de torneio'), groups('type', k => TYPES[k]?.[0] || k)]].map(([h, gs]) => (
        <table key={h} className="bt-table"><caption>{h}</caption><thead><tr><th /><th>{tx('Apostas')}</th><th>{tx('Acerto')}</th><th>{tx('Lucro')}</th></tr></thead>
          <tbody>{gs.map(g => <tr key={g.k}><td>{g.l}</td><td>{g.n}</td><td>{pct(g.w, g.n)}</td><td className={g.p > 0 ? 'res-w' : g.p < 0 ? 'res-l' : ''}>{sign(g.p)}</td></tr>)}</tbody></table>))}</div>}
      <div className="bt-filters">
        <span className="seg small">{['todas', 'open', 'won', 'lost', 'refund'].map(k => <button key={k} className={fs === k ? 'on' : ''} onClick={() => setFs(k)}>{k === 'todas' ? tx('todas') : `${RES[k][0]} ${RES[k][1]}`}</button>)}</span>
        <span className="seg small">{['todas', 'champ', 'match'].map(k => <button key={k} className={fk === k ? 'on' : ''} onClick={() => setFk(k)}>{k === 'todas' ? tx('todas') : KIND_LBL[k]}</button>)}</span>
      </div>
      {B.length === 0 ? <p className="muted">{tx('Ainda não apostaste. Abre um torneio a decorrer e aposta no campeão (antes da 2.ª ronda) ou numa partida por começar (🪙 em cada partida).')}</p>
        : <div className="bt-scroll"><table className="bt-table bt-hist"><thead><tr><th>{tx('Quando')}</th><th>{tx('Torneio')}</th><th>{tx('Aposta')}</th><th>{tx('Odd')}</th><th>{tx('Moedas')}</th><th>{tx('Resultado')}</th></tr></thead>
          <tbody>{rows.map(x => (
            <tr key={x.id} className={`bet-${x.status}`}>
              <td className="muted">{when(x.ts)}</td>
              <td><button className="link" onClick={() => open(x.tid)} title={tx('Abrir o torneio')}><TypeIco k={x.type} /> {x.tname}</button></td>
              <td><b>{x.who}</b> <span className="muted">{x.kind === 'champ' ? tx('campeão') : x.vs.length ? tx('contra {v}', { v: x.vs.join(', ') }) : ''}</span></td>
              <td>{x.odds.toFixed(2)}</td><td>{x.stake}</td>
              <td className={x.status === 'won' ? 'res-w' : x.status === 'lost' ? 'res-l' : 'res-d'}>{RES[x.status][0]} {x.status === 'won' ? `+${x.payout - x.stake}` : x.status === 'lost' ? `−${x.stake}` : RES[x.status][1]}</td>
            </tr>))}</tbody></table>{!rows.length && <p className="muted small">{tx('Nenhuma aposta com estes filtros.')}</p>}</div>}
    </section>
  )
}

// lucro acumulado, aposta a aposta (só as decididas); passar por cima mostra cada uma
function ProfitLine({ bets }) {
  const [hv, setHv] = useState(null)
  const W = 640, H = 150, pad = 8
  let acc = 0
  const ys = [0, ...bets.map(x => (acc += net(x)))]
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = hi - lo || 1
  const X = k => pad + (k * (W - 2 * pad)) / (ys.length - 1), Y = v => pad + ((hi - v) * (H - 2 * pad)) / span
  const pts = ys.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const move = e => { const r = e.currentTarget.getBoundingClientRect(), k = Math.round((((e.clientX - r.left) / r.width) * W - pad) / ((W - 2 * pad) / (ys.length - 1))); setHv(Math.max(1, Math.min(ys.length - 1, k))) }
  const b = hv && bets[hv - 1]
  return (
    <figure className="bt-chart">
      <figcaption className="small muted">{tx('Lucro acumulado (aposta a aposta)')}</figcaption>
      <div className="bt-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setHv(null)} role="img" aria-label={tx('Lucro acumulado: {v} moedas', { v: ys[ys.length - 1] })}>
          <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} className="bt-zero" />
          <polyline points={pts} className="bt-line" />
          {hv != null && <><line x1={X(hv)} x2={X(hv)} y1={pad} y2={H - pad} className="bt-cross" /></>}
        </svg>
        <span className="bt-lab hi">{hi > 0 ? `+${hi}` : hi}</span><span className="bt-lab lo">{lo}</span>
        {b && <i className="bt-dot" style={{ left: `calc(44px + (100% - 44px) * ${X(hv) / W})`, top: `${(Y(ys[hv]) / H) * 100}%` }} />}
        {b && <div className="bt-tip" style={{ left: `calc(44px + (100% - 44px) * ${X(hv) / W})` }}><b>{b.who}</b> <span className={net(b) > 0 ? 'res-w' : 'res-l'}>{net(b) > 0 ? `+${net(b)}` : net(b)}</span><br /><span className="muted">{tx('total {v}', { v: ys[hv] })} · {when(b.ts)}</span></div>}
      </div>
    </figure>
  )
}

// ---------- ao vivo ----------

// onde está uma partida, para a frase do «meu deck»: «Estás nas meias-finais», «Foste eliminado nos quartos»
const where = (m, k) => (!m ? '' : m.b === 'W' ? (m.r === k ? tx('na final') : m.r === k - 1 ? tx('nas meias-finais') : m.r === k - 2 ? tx('nos quartos de final') : tx('na {r}.ª ronda', { r: m.r }))
  : m.b === 'L' ? tx('na chave dos vencidos (ronda {r})', { r: m.r }) : m.b === '3' ? tx('no jogo do 3.º lugar') : m.r === 1 ? tx('na grande final') : tx('na 2.ª final'))
const place = p => (p[0] === p[1] ? tx('{p}.º', { p: p[0] }) : tx('{a}.º–{b}.º', { a: p[0], b: p[1] }))
const MEDAL = ['🥇', '🥈', '🥉']
const Fmt = ({ f }) => (f ? <span className="fmt-tag">{FORMAT[f]?.name || f}</span> : null)  // formato de cada deck (modo casual)
const roundName = (m, k) => (m.b === 'W' ? (m.r === k ? tx('Final') : m.r === k - 1 ? tx('Meias-finais') : m.r === k - 2 ? tx('Quartos de final') : tx('Ronda {r}', { r: m.r }))
  : m.b === 'L' ? tx('Vencidos · ronda {r}', { r: m.r }) : m.b === '3' ? tx('3.º lugar') : m.r === 1 ? tx('Grande final') : tx('2.ª final'))

function Live({ data, tid, onGone, slot, running = [], open, openTable }) {
  const [t, setT] = useState(null)
  const deckOwn = useContext(OwnCtx)  // id do deck -> meu / ami / com (a etiqueta de cada lugar no tabuleiro)
  const [err, setErr] = useState('')
  const [watch, setWatch] = useState(null)  // {gid, game, deckName, score}
  const [playing, setPlaying] = useState(null)  // sessão do Forge Play do meu jogo (torneio em que jogo eu)
  const [stick, setStick] = useState(null)  // {mid, gid}: à espera do jogo seguinte desta partida
  const [follow, setFollowS] = useState(() => ls('grimorio.torneio.seguir') !== '0')
  const setFollow = v => { setFollowS(v); ls('grimorio.torneio.seguir', v ? '1' : '0') }
  const [pause, setPause] = useState(() => { try { return JSON.parse(localStorage.getItem('grimorio.pausa')) || { secs: 5, auto: true } } catch { return { secs: 5, auto: true } } })
  const setPausePref = v => { setPause(v); try { localStorage.setItem('grimorio.pausa', JSON.stringify(v)) } catch { /* sem armazenamento */ } }
  const [onlyMine, setOnlyMineS] = useState(() => ls('grimorio.torneio.meus') === '1')
  const setOnlyMine = v => { setOnlyMineS(v); ls('grimorio.torneio.meus', v ? '1' : '0') }
  const lastSeen = useRef(null)
  const [nextMode, setNextMode] = useState(nextModeOf)
  // o teu deck aparece nos jogos como «Hubert - Deck X» (o nome da conta à frente)
  const [who, setWho] = useState('')
  useEffect(() => { fetch('/api/me').then(r => r.json()).then(x => setWho(x.user ? x.user[0].toUpperCase() + x.user.slice(1) : '')).catch(() => {}) }, [])
  const home = useRef({ mid: null, gid: 0 })  // «a mesma mesa»: a mesa seguida e o último jogo dela já visto
  // sons: partida acabada e campeão (só quando muda, não ao abrir um torneio já acabado)
  const heard = useRef(null)
  const ding = x => {
    const done = (x.matches || []).filter(m => m.st === 'done').length
    if (heard.current?.tid === tid) {
      if (x.status === 'done' && heard.current.status !== 'done' && x.champion != null) play('champion')
      else if (done > heard.current.done) play('match')
    }
    heard.current = { tid, done, status: x.status }
  }
  const going = t && (t.status === 'running' || t.status === 'paused')
  useEffect(() => {
    let off = false, timer
    const tick = () => j(`/api/tournaments/${tid}`).then(x => { if (!off) { setT(x); setErr(''); ding(x); if (x.status === 'running' || x.status === 'paused') timer = setTimeout(tick, 3000) } })
      .catch(e => { if (!off) { setErr(e.message); timer = setTimeout(tick, 6000) } })
    tick()
    return () => { off = true; clearTimeout(timer) }
  }, [tid])
  const P = t?.players || []
  const games = useMemo(() => (t ? t.matches.flatMap(m => m.g.map((x, k) => ({ ...x, m, k }))).sort((a, b) => a.id - b.id) : []), [t])
  const fmt = FORMAT[t?.format] || FORMAT.modern
  const fl = useMemo(() => (onlyMine && t?.me != null ? games.filter(x => x.m.p.includes(t.me)) : games), [games, onlyMine, t?.me])  // o que se segue
  const openGame = async (x, away = false) => {  // away: salto para outra mesa à espera da seguida (mantém-na)
    if (!away) home.current = { mid: x.m.id, gid: x.id }
    else if (x.m.id === home.current.mid) home.current.gid = x.id
    try {
      let g = await j(`/api/tournaments/${tid}/games/${x.id}`)
      // em baixo («o nosso lado»): o meu deck; se não joga, o deck em que apostei (nesta partida, senão o campeão)
      const bet = k => (bets.b?.bets || []).filter(b => b.status !== 'refund' && (k === 'champ' ? b.kind === 'champ' : b.mid === x.m.id)).map(b => b.pick)
      const side0 = t.me != null && g.seats.includes(t.me) ? t.me : g.seats.find(i => bet('match').includes(i)) ?? g.seats.find(i => bet('champ').includes(i))
      const me0 = side0 == null ? -1 : g.seats.indexOf(side0)
      if (me0 > 0) { const sv = [...g.seats]; [sv[0], sv[me0]] = [sv[me0], sv[0]]; g = { ...swapSide(g, 'abcd'[me0]), seats: sv } }  // o meu deck fica em baixo, no lugar do jogador
      const names = g.seats.map(i => (i === t.me && who ? `${who} - ${P[i]?.name || '?'}` : P[i]?.name || '?')), m = x.m
      const prev = m.g.slice(0, x.k).filter(y => !y.x)
      const score = names.length === 2 ? { a: prev.filter(y => y.w === g.seats[0]).length, b: prev.filter(y => y.w === g.seats[1]).length, g: prev.length + 1, bo: t.bo, serie: 1, series: 1, sw: 0, sl: 0, k: 1, total: 1 } : null
      const mk = side0 == null ? -1 : g.seats.indexOf(side0)  // o fim do jogo conta como vitória/derrota do meu lado
      setWatch({ gid: x.id, mid: m.id, seats: g.seats, deckName: names[0], pov: mk >= 0 ? 'abcd'[mk] : null, score, formats: t.casual ? Object.fromEntries(g.seats.map((i, k) => ['abcd'[k], FORMAT[P[i]?.format]?.name || P[i]?.format])) : null, game: { ...g, g: x.k + 1, opp: names[1], ...(names.length > 2 && { opps: Object.fromEntries(names.slice(1).map((nm, k) => ['bcd'[k], nm])) }), startLife: t.table && t.table !== 'equipas' ? 30 : t.casual ? baseLife(t.format, names.length) : fmt.cmd ? 40 : 20 } })
    } catch (e) { setErr(e.message) }
  }
  // F5: volta a abrir o jogo que estava a ser visto (guardado na sessão do browser)
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !t) return
    restored.current = true
    let v = null
    try { v = sessionStorage.getItem('grimorio.torneio.jogo') } catch { /* sem armazenamento */ }
    const [a, b] = (v || '').split(':'), x = a === tid && games.find(g => g.id === +b)
    if (x) openGame(x)
  }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!restored.current) return
    try { if (watch) sessionStorage.setItem('grimorio.torneio.jogo', `${tid}:${watch.gid}`); else sessionStorage.removeItem('grimorio.torneio.jogo') } catch { /* sem armazenamento */ }
  }, [watch, tid])
  // seguir ao vivo: abre cada jogo novo assim que acaba (se não estiveres já a ver um)
  useEffect(() => {
    if (!t) return  // só depois de o torneio carregar (senão a lista vazia → cheia parecia um jogo novo e abria o último)
    const top = fl.length ? fl[fl.length - 1].id : 0
    if (lastSeen.current !== null && top > lastSeen.current && follow && !watch) openGame(fl[fl.length - 1])
    lastSeen.current = top
    // «esperar o seguinte desta partida»: abre-o assim que acaba
    if (stick) { const nx = fl.find(x => x.m.id === stick.mid && x.id > stick.gid); if (nx) { setStick(null); openGame(nx) } }
  }, [fl]) // eslint-disable-line react-hooks/exhaustive-deps
  const bets = useBets(tid, t)
  if (!t) return <section className="card">{err ? <p className="bad-t">{err}</p> : <p><span className="spin-dot" /> {tx('A abrir o torneio…')}</p>}</section>
  const act = async a => { try { await post(`/api/tournaments/${tid}/${a}`); setT(await j(`/api/tournaments/${tid}`)) } catch (e) { setErr(e.message) } }
  const playMine = async mid => { setErr(''); try { setPlaying((await post(`/api/tournaments/${tid}/play`, { mid, name: tx('Tu') })).sid) } catch (e) { setErr(e.message) } }
  if (playing) return <>{slot && createPortal(<button onClick={() => setPlaying(null)}>{tx('← Voltar ao torneio')}</button>, slot)}
    <div className="view play fp-view">
      <div className="row-btns fp-bar"><b>🏆 {t?.name}</b> <span className="muted small">{tx('o teu jogo do torneio')}</span>
        <button className="link small" onClick={async () => { if (!(await ask('abandonar', { title: tx('Abandonar este jogo?'), body: tx('O jogo não conta: a partida volta a ficar à tua espera. Para perder o jogo, usa «desistir» na mesa.'), ok: tx('Abandonar') }))) return; await post(`/api/playnet/${playing}/stop`).catch(() => {}); setPlaying(null) }}>■ {tx('Abandonar')}</button></div>
      <ForgeTable key={playing} sid={playing} data={data} onClose={() => setPlaying(null)} /></div></>
  const del = async () => { if (!(await ask('torneio', { title: tx('Apagar o torneio «{t}» e todos os jogos dele?', { t: t.name }), ok: tx('Apagar') }))) return; await j(`/api/tournaments/${tid}`, { method: 'DELETE' }); onGone() }
  const nextOf = i => nextGame(fl, i, nextMode, home.current, mid => t.matches.find(m => m.id === mid)?.st === 'done')  // «Depois de um jogo»
  if (watch) {
    const i = fl.findIndex(x => x.id === watch.gid), nx = nextOf(i)
    // as minhas apostas em cada lugar deste jogo: a da partida e a do campeão (lugar a, b… -> «50 × 2,10»)
    const myBets = {}, od = v => Number(v).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    for (const [k, i] of (watch.seats || []).entries()) {
      const xs = (bets.b?.bets || []).filter(x => x.pick === i && x.status !== 'refund' && (x.kind === 'champ' || x.mid === watch.mid))
      if (xs.length) myBets['abcd'[k]] = {
        txt: xs.map(x => `${x.kind === 'champ' ? '🏆 ' : ''}${x.stake} × ${od(x.odds)}`).join(' · '),
        st: xs.some(x => x.status === 'won') ? 'won' : xs.every(x => x.status === 'lost') ? 'lost' : 'open',
        title: xs.map(x => (x.kind === 'champ' ? tx('Aposta no campeão: {s} moedas a {o}', { s: x.stake, o: od(x.odds) }) : tx('Aposta nesta partida: {s} moedas a {o}', { s: x.stake, o: od(x.odds) }))).join('\n'),
      }
    }
    // o jogo seguinte desta partida (mesma mesa): abre já se acabou; se a partida ainda decorre, espera por ele
    const sameNext = fl.find(x => x.m.id === watch.mid && x.id > watch.gid)
    const matchOn = t.matches.find(m => m.id === watch.mid)?.st !== 'done' && t.status === 'running'
    const waiting = stick?.mid === watch.mid
    const nextBtn = sameNext ? <button onClick={() => { setStick(null); openGame(sameNext) }}>⏭ {tx('Jogo seguinte desta partida')}</button>
      : matchOn ? <button className={waiting ? 'on' : ''} onClick={() => setStick(waiting ? null : { mid: watch.mid, gid: watch.gid })} title={tx('Abre sozinho o próximo jogo desta partida quando acabar')}>{waiting ? `⏳ ${tx('À espera do jogo seguinte…')}` : `⏭ ${tx('Ver o jogo seguinte desta partida')}`}</button> : null
    return <>{slot ? createPortal(<><button onClick={() => setWatch(null)}>{tx('← Voltar ao torneio')}</button>{nextBtn}</>, slot) : nextBtn && <div className="row-btns">{nextBtn}</div>}<Replay key={watch.gid} data={data} game={watch.game} deckName={watch.deckName} pov={watch.pov} track bets={myBets} owns={Object.fromEntries((watch.seats || []).map((i, k) => ['abcd'[k], ownOf(P[i], deckOwn)]))} bots={Object.fromEntries((watch.seats || []).map((i, k) => { const d = DIFF_INFO[P[i]?.difficulty]; return ['abcd'[k], d && { label: d.label, title: tx('Bot do Forge: {d} — {r}', { d: d.label, r: d.resumo }) }] }).filter(x => x[1]))} score={watch.score} formats={watch.formats} onBack={slot ? null : () => setWatch(null)} backLabel={tx('← Voltar ao torneio')}
      live={going && follow && i >= 0 && i === fl.length - 1} speed0={pause.speed} onSpeed={v => setPausePref({ ...pause, speed: v })} hands={pause.hands || 'ambas'} onHands={h => setPausePref({ ...pause, hands: h })}
      next={follow && i >= 0 ? { has: !!nx, go: () => nx && openGame(nx.x, nx.away), secs: pause.secs, auto: pause.auto } : null} /></>
  }
  const lives = (t.lives || (t.live ? [t.live] : [])).map(L => ({ L, lm: t.matches.find(m => m.id === L.match) })).filter(x => x.lm), lm = lives[0]?.lm
  const nameOf = i => (i == null ? '—' : P[i]?.name)
  // torneio em que jogo eu: a minha partida pronta (ou já na mesa do Forge Play)
  const myGame = t.play_me && t.status === 'running' && t.me != null ? t.matches.find(m => m.st === 'ready' && m.p.includes(t.me)) : null
  const k = Math.max(...t.matches.filter(m => m.b === 'W').map(m => m.r), 1)
  const num = Object.fromEntries(t.matches.map((m, i) => [m.id, i + 1]))
  const tools = { data, P, live: t.live && { ...t.live, ids: new Set(lives.map(x => x.L.match)) }, num, onGame: openGame, me: t.me, casual: t.casual, odds: bets.b?.match, bet: bets.b && { coins: bets.b.coins, place: bets.place, mine: new Set(bets.b.bets.filter(x => x.status === 'open').map(x => x.mid)) } }
  const bracket = t.type === 'elim' || t.type === 'dupla'
  // «o meu deck»: onde está, se caiu e o lugar final (tournament.py me_state)
  const ms = t.me_state, mm = ms?.match && t.matches.find(m => m.id === ms.match)
  const mate = mm?.b === 'T' ? mm.p[mm.p.indexOf(t.me) ^ 1] : null  // 2HG: o parceiro não é adversário
  const opp = mm ? mm.p.filter(x => x !== t.me && x !== mate).map(x => (x === -1 ? tx('adversário por decidir') : nameOf(x))).join(', ') : ''
  const mySc = mm && mm.p.length === 2 && mm.g.length ? ` · ${mm.w[mm.p.indexOf(t.me)]}–${mm.w[1 - mm.p.indexOf(t.me)]}` : ''
  const myPos = t.standings.findIndex(s => s.i === t.me) + 1, my = t.standings[myPos - 1]
  const winPct = s => pct(s ? s.v / Math.max(1, s.v + s.d + s.e) : 0)  // gauntlet: % de partidas ganhas
  const myGrp = (t.group_tabs || []).findIndex(g => g.some(s => s.i === t.me)), myTeam = (t.teams || []).findIndex(r => r.p.includes(t.me))
  const standLine = () => (t.type === 'gauntlet' ? tx('{v}V {d}D {e}E · {w} de vitórias (o título pede 75%)', { v: my?.v, d: my?.d, e: my?.e, w: winPct(my) })
    : t.type === 'rei' ? (t.hill?.king === t.me ? tx('És o rei da colina: série de {s}', { s: t.hill.streak }) : tx('Vais em {p}.º · melhor série {b}', { p: myPos, b: my?.best || 0 }))
      : t.type === 'equipas' ? tx('A tua equipa vai em {p}.º com {s} pts', { p: myTeam + 1, s: t.teams[myTeam]?.pts })
        : t.type === 'grupos' && myGrp >= 0 ? (() => { const g = t.group_tabs[myGrp], p = g.findIndex(s => s.i === t.me); return tx('Vais em {p}.º no grupo {g} com {s} pts', { p: p + 1, g: 'ABCD'[myGrp], s: g[p].pts }) })()
          : tx('Vais em {p}.º com {s} pts', { p: myPos, s: my?.pts }))
  const meLine = !ms ? null : ms.phase === 'done' ? (ms.place[0] === 1 ? tx('Ganhaste o torneio!') : t.type === 'gauntlet' ? tx('Ficaste abaixo dos 75%: {w} de vitórias ({v}V {d}D {e}E)', { w: winPct(my), v: my?.v, d: my?.d, e: my?.e }) : tx('Ficaste em {p} lugar', { p: place(ms.place) }))
    : ms.phase === 'out' ? (ms.groups ? tx('Ficaste pela fase de grupos') : tx('Foste eliminado {w} por {o}', { w: where(mm, k), o: nameOf(ms.by) }))
      : `${bracket || (mm && t.type === 'grupos' && mm.b !== 'R') ? tx('Estás {w}', { w: where(mm, k) }) : standLine()}${mm ? ` · ${mm.b === 'P' ? tx('mesa com {o}', { o: opp }) : tx('contra {o}', { o: opp })}${mySc}${t.live?.match === mm.id ? ` — ${tx('a jogar agora')}` : ''}` : ''}`
  return (
    <div className="tour-live">
      <section className="card tl-head">
        <div className="row-btns">
          <h3>🏆 {t.name}</h3>
          <span className={`tl-status ${t.status}`}>{STATUS[t.status] || t.status}</span>
          <span className="muted small">{!t.casual && (t.ranked !== false ? <span className="rk rk-ok sm" title={tx('Conta para as estrelas amarelas e dá troféus normais (ouro, prata e bronze).')}>🏅 {tx('Ranked')}</span> : <span className="rk rk-warn sm" title={tx('Menos de 20% de decks do meta: conta só para as estrelas azuis e vermelhas e os troféus saem azuis.')}>{tx('não ranked')}</span>)} <TypeIco k={t.type} /> {TYPES[t.type]?.[0]} · {t.casual ? tx('casual, regras de {f}', { f: FORMAT[t.format]?.name || t.format }) : FORMAT[t.format]?.name || t.format} · {t.type === 'mesas' ? tx('um jogo por mesa') : `Bo${t.bo}`} · {P.length} decks{t.team ? ` · ${tx('equipas de {s}', { s: t.team })}` : ''}{t.table ? ` · ${tableL(t.table)}` : ''}{t.rounds ? ` · ${t.type === 'rei' ? tx('{n} partida|{n} partidas', { n: t.rounds }) : tx('{n} ronda|{n} rondas', { n: t.rounds })}` : ''} · {when(t.ts)}</span>
          <span className="tl-act">
            {t.status === 'running' && <button onClick={() => act('pause')} title={tx('O jogo em curso acaba e fica registado')}>{tx('❚❚ Pausar')}</button>}
            {(t.status === 'paused' || t.status === 'error') && <button className="primary" onClick={() => act('resume')}>{tx('▶ Retomar')}</button>}
            {going && <button onClick={async () => (await ask('torneio', { title: tx('Cancelar o torneio? O jogo em curso pára já.'), ok: tx('Cancelar o torneio') })) && act('cancel')}>{tx('■ Cancelar')}</button>}
            <button className="link small" onClick={del}>{tx('apagar')}</button>
          </span>
        </div>
        <div className="row-btns tl-opts">
          <label className="chk small"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> {tx('Seguir ao vivo (abre cada jogo quando acaba)')}</label>
          {follow && <NextMode value={nextMode} onChange={setNextMode} />}
          <label className="small">{tx('Pausa entre jogos')} <select value={pause.secs} onChange={e => setPausePref({ ...pause, secs: +e.target.value })} disabled={!pause.auto}>{[2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} s</option>)}</select></label>
          <label className="chk small"><input type="checkbox" checked={!pause.auto} onChange={e => setPausePref({ ...pause, auto: !e.target.checked })} /> {tx('não avançar sozinho')}</label>
          {t.me != null && <label className="chk small"><input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> {tx('seguir só os meus jogos')}</label>}
          {fl.length > 0 && <button className="small" onClick={() => openGame(fl[fl.length - 1])}>{onlyMine && t.me != null ? tx('▶ último jogo meu') : tx('▶ último jogo')}</button>}
        </div>
        <StartGate t={t} onStart={() => act('start')} />
        {t.free && <FreeMatches t={t} openTable={openTable} nameOf={nameOf} onChange={() => j(`/api/tournaments/${tid}`).then(setT).catch(() => {})} />}
        {myGame && <p className="tl-now me-play">🎮 {myGame.play ? tx('O teu jogo contra {o} está a decorrer', { o: nameOf(myGame.p.find(i => i !== t.me)) }) : tx('É a tua vez: jogo {g} contra {o}', { g: myGame.g.length + 1, o: nameOf(myGame.p.find(i => i !== t.me)) })} <button className="primary" onClick={() => playMine(myGame.id)}>{myGame.play ? tx('▶ Voltar à mesa') : tx('▶ Jogar no Forge Play')}</button></p>}
        {meLine && <p className={`me-line ${ms.phase}`}><Thumb data={data} p={P[t.me]} /><span><small>{tx('O meu deck · {d}', { d: P[t.me]?.name })}</small><b>{ms.phase === 'done' ? `${(t.type !== 'gauntlet' || ms.place[0] === 1) && MEDAL[ms.place[0] - 1] || '🎖'} ` : ''}{meLine}</b></span></p>}
        {lives.map(({ L, lm }) => <p key={lm.id} className="tl-now"><span className="spin-dot" /> {L.status === 'queued' ? tx('Na fila do Forge (posição {p})', { p: L.position }) : tx('A jogar')}: <b>#{num[lm.id]}</b> {(L.seats || lm.p).map(nameOf).join(' vs ')} · {tx('jogo {g}', { g: lm.g.length + 1 })}{lm.p.length === 2 && t.bo > 1 ? ` · ${lm.w[0]}–${lm.w[1]}` : ''}{Object.keys(lm.sb || {}).length > 0 && <span className="muted" title={Object.entries(lm.sb).map(([i, sw]) => `${nameOf(+i)}: ${sw.map(s => `+${s.q} ${s.in} −${s.q} ${s.out}`).join(', ')}`).join('\n')}> · {tx('⇄ com sideboard:')} {Object.keys(lm.sb).map(i => nameOf(+i)).join(', ')}</span>}</p>)}
        {!lm && !myGame && !t.free && t.status === 'running' && <p className="tl-now muted"><span className="spin-dot" /> {tx('À espera da vez no Forge…')}</p>}
        {t.error && <p className="small bad-t">{tx(t.error)}</p>}
        {err && <p className="small bad-t">{err}</p>}
      </section>
      {ms?.phase === 'out' && going && <section className="me-out" role="status"><b>{ms.groups ? tx('💀 Ficaste pela fase de grupos') : tx('💀 Foste eliminado {w}', { w: where(mm, k) })}</b><span>{ms.groups ? '' : mm?.g.length ? tx('{o} ganhou-te a partida por {s}.', { o: nameOf(ms.by), s: `${mm.w[mm.p.indexOf(ms.by)]}–${mm.w[mm.p.indexOf(t.me)]}` }) : tx('{o} ganhou-te a partida.', { o: nameOf(ms.by) })} {tx('O torneio continua sem ti — vê quem fica com o título.')}</span></section>}
      <div className={`live-duo ${running.some(x => x.id !== tid) ? 'two' : ''}`}>
        <BetsPanel {...bets} P={P} data={data} num={num} going={going} type={t.type} />
        {running.some(x => x.id !== tid) && <RunningTours list={running} cur={tid} open={open} />}
      </div>
      {t.podium?.length > 0 && <Podium data={data} t={t} />}
      {bracket ? <Bracket t={t} k={k} {...tools} />
        : t.type === 'gauntlet' ? <Gauntlet t={t} {...tools} />
          : t.type === 'rei' ? <><div className="tl-grid"><Hill t={t} {...tools} /><Standings t={t} {...tools} /></div><HillThread t={t} {...tools} /></>
            : t.type === 'grupos' ? <>{t.final && <Bracket t={t} k={k} {...tools} />}<div className="tl-grid"><div style={{ display: 'grid', gap: 12 }}>{t.group_tabs.map((g, i) => <Standings key={i} t={t} rows={g} title={tx('Grupo {g}', { g: 'ABCD'[i] })} cut={2} {...tools} />)}</div><Rounds t={t} {...tools} ms={t.matches.filter(m => m.b === 'R')} /></div></>
              : t.type === 'equipas' ? <Teams t={t} {...tools} />
                : <div className="tl-grid"><Standings t={t} {...tools} /><Rounds t={t} {...tools} /></div>}
    </div>
  )
}

// torneios a decorrer ao mesmo tempo: um clique salta para o Ao vivo de cada um
function RunningTours({ list, cur, open }) {
  return (
    <section className="card run-tours">
      <h4>🏆 {tx('A decorrer')} <span className="muted small">{list.length}</span></h4>
      <ul>{list.map(x => (
        <li key={x.id}><button className={x.id === cur ? 'on' : ''} aria-current={x.id === cur || undefined} onClick={() => x.id !== cur && open(x.id)} title={x.id === cur ? tx('Estás a ver este') : tx('Ver o torneio')}>
          <b><TypeIco k={x.type} /> {x.name}</b>
          <small className="muted">{x.casual ? tx('casual') : FORMAT[x.format]?.name || x.format} · {x.n} decks{x.me != null ? ` · ${tx('o meu deck')}` : ''}</small>
        </button></li>
      ))}</ul>
    </section>
  )
}

// ---------- apostas (tournament.py): moedas virtuais, odds pelo Elo, liquidação automática ----------
function useBets(tid, t) {
  const [b, setB] = useState(null), [won, setWon] = useState(null), prev = useRef(null)
  const sig = t ? `${t.status}|${t.matches.map(m => `${m.st}${m.job ? 'j' : ''}${m.g.length}`).join()}` : ''
  const take = x => {
    const was = prev.current && new Map(prev.current.map(y => [y.id, y.status]))
    const nw = was && x.bets.find(y => y.status === 'won' && was.get(y.id) === 'open')
    if (nw) { setWon(nw); play(nw.kind === 'champ' ? 'champion' : 'match') }
    prev.current = x.bets
    setB(x)
  }
  useEffect(() => { if (sig) j(`/api/tournaments/${tid}/bets`).then(take).catch(() => {}) }, [tid, sig])
  const place = body => post(`/api/tournaments/${tid}/bets`, body).then(take)
  return { b, won, place }
}

const betWhat = (x, P, num) => (x.kind === 'champ' ? tx('campeão: {d}', { d: P[x.pick]?.name }) : tx('#{m}: {d}', { m: num[x.mid], d: P[x.pick]?.name }))

function Stake({ coins, odds, onBet }) {
  const [s, setS] = useState(Math.max(1, Math.min(50, coins))), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const go = async () => { setBusy(true); setErr(''); try { await onBet(s) } catch (e) { setErr(e.message) } setBusy(false) }
  return (
    <div className="bet-stake">
      <input type="number" inputMode="numeric" min="1" max={coins} value={s} aria-label={tx('Moedas a apostar')} onChange={e => setS(Math.max(1, Math.min(coins, Math.round(+e.target.value || 1))))} />
      {[10, 50, 100].filter(x => x < coins).map(x => <button key={x} className="small" onClick={() => setS(x)}>{x}</button>)}
      <button className="small" onClick={() => setS(coins)}>{tx('tudo')}</button>
      <button className="primary" disabled={busy || coins < 1} onClick={go}>{tx('Apostar {s} → recebes {w}', { s, w: Math.round(s * odds) })}</button>
      <span className="small muted" title={tx('Pelo Elo dos decks (a odd já desconta 5% para a casa)')}>{tx('≈ {p}% de hipótese', { p: Math.round(Math.min(99, 95 / odds)) })}</span>
      {err && <span className="bad-t small">{err}</span>}
    </div>
  )
}

// odds de uma partida/mesa ainda por começar: abre por baixo (toque ou clique), escolhe-se o deck e a quantia
function BetPop({ m, odds, P, bet }) {
  const [pick, setPick] = useState(null), ref = useRef(null), tt = m.b === 'T'  // 2HG: aposta-se na equipa (o 1.º deck dela)
  return (
    <details className="bet-d" ref={ref}>
      <summary className="bet-chip" title={tx('Apostar nesta partida')}>🪙 {tt ? `${odds[0].toFixed(2)} / ${odds[2].toFixed(2)}` : odds.length > 2 ? tx('apostar') : odds.map(x => x.toFixed(2)).join(' / ')}{bet.mine.has(m.id) ? ' · ✓' : ''}</summary>
      <div className="bet-pop">
        {m.p.map((i, k) => (tt && k % 2 ? null : <button key={i} className={`bet-opt ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}><span>{tt ? `${P[i]?.name} + ${P[m.p[k + 1]]?.name}` : P[i]?.name}</span><b>{odds[k].toFixed(2)}</b></button>))}
        {pick != null && <Stake coins={bet.coins} odds={odds[m.p.indexOf(pick)]} onBet={async s => { await bet.place({ kind: 'match', mid: m.id, pick, stake: s }); setPick(null); ref.current?.removeAttribute('open') }} />}
      </div>
    </details>
  )
}

function BetsPanel({ b, won, place, P, data, num, going, type }) {
  const [pick, setPick] = useState(null)
  if (!b || (!going && !b.bets.length)) return null
  const order = b.champ ? P.map((_, i) => i).filter(i => b.champ[i] != null).sort((x, y) => b.champ[x] - b.champ[y]) : []  // sem odd = já não pode ganhar
  const RES = { open: tx('em jogo'), lost: tx('perdida'), refund: tx('devolvida') }
  return (
    <section className="card bets">
      <div className="bets-h">
        <h4>🪙 {tx('Apostas')}</h4>
        <b className="bets-coins">{tx('{n} moedas', { n: b.coins })}</b>
        {b.subsidy && <span className="muted small">{tx('subsídio de hoje recebido')}</span>}
        <span className="muted small">{tx('Moedas a fingir: não se compram nem valem dinheiro. As odds vêm do Elo de cada deck.')}</span>
      </div>
      {won && <p className="bets-toast" role="status">🎉 {tx('Ganhaste {n} moedas com {w}!', { n: won.payout, w: betWhat(won, P, num) })}</p>}
      {b.champ ? (
        <>
          <p className="small muted">{type === 'equipas' ? tx('Que equipa ganha o torneio? Aposta num dos decks dela (fecha quando começar a 2.ª ronda).') : tx('Quem ganha o torneio? (fecha quando começar a 2.ª ronda)')}</p>
          <div className="bets-champ">{order.map(i => <button key={i} className={`bet-opt ${pick === i ? 'on' : ''}`} onClick={() => setPick(pick === i ? null : i)}><Thumb data={data} p={P[i]} /><span>{P[i].name}</span><b>{b.champ[i].toFixed(2)}</b></button>)}</div>
          {pick != null && <Stake key={pick} coins={b.coins} odds={b.champ[pick]} onBet={async s => { await place({ kind: 'champ', pick, stake: s }); setPick(null) }} />}
        </>
      ) : going && <p className="small muted">{type === 'gauntlet' ? tx('No gauntlet não há apostas no campeão: aposta nas partidas por começar (🪙 em cada partida).') : tx('As apostas no campeão já fecharam; ainda dá para apostar nas partidas por começar (🪙 em cada partida).')}</p>}
      {b.bets.length > 0 && (
        <ul className="bets-mine">{b.bets.map(x => (
          <li key={x.id} className={`bet-${x.status}`}><span>{betWhat(x, P, num)}</span><span className="muted">{x.stake} × {x.odds.toFixed(2)}</span><b>{x.status === 'won' ? `+${x.payout}` : RES[x.status]}</b></li>
        ))}</ul>
      )}
    </section>
  )
}

// de onde vem cada deck: meta, meu, de um amigo ou da comunidade (id do deck -> meu/ami/com, carregado no TournamentView)
const OwnCtx = createContext({})
const OWN_I = { meta: ['📊', tx('Meta')], meu: ['🧙', tx('Meu')], ami: ['🤝', tx('Amigo')], com: ['🌐', tx('Comunidade')] }
const ownOf = (p, own) => (!p ? null : p.src === 'meta' ? 'meta' : p.fr ? 'ami' : p.com ? 'com' : own[p.ref] || 'meu')
function OwnTag({ p }) {  // a etiqueta por extenso, onde há espaço (classificação, pódio)
  const k = ownOf(p, useContext(OwnCtx))
  return k ? <span className={`fmt-tag own own-${k}`}>{OWN_I[k][0]} {OWN_I[k][1]}</span> : null
}
function Thumb({ data, p }) {
  const c = p && data.byName.get(p.cover), k = ownOf(p, useContext(OwnCtx))
  return <span className={`tp-thumb ${p?.src === 'meus' && !p.com ? 'mine' : ''}`} style={{ '--edge': edge(p?.colors || '') }}>{c ? <img src={img(c, 'art_crop')} alt="" loading="lazy" /> : null}
    {k && <i className={`tp-own own-${k}`} title={OWN_I[k][1]} aria-label={OWN_I[k][1]}>{OWN_I[k][0]}</i>}</span>
}

function GameChips({ m, onGame, P }) {
  return m.g.map((x, k) => <button key={x.id} className={`gchip ${x.x ? 'x' : x.w == null ? '' : 'w'}`} onClick={() => onGame({ ...x, m, k })} title={`${x.x ? tx('O Forge falhou neste jogo (repetido)') : x.w == null ? tx('Empate') : tx('Ganhou {d}', { d: P[x.w]?.name })}${x.sb ? ` · ${tx('com sideboard')}` : ''}`}>{tx('J{g}', { g: k + 1 })}{x.t ? ` · T${x.t}` : ''}{x.sb ? ' ⇄' : ''} ▶</button>)
}

// trocas de sideboard de cada jogo (tournament.py: g[k].sb = {participante: [{in, out, q, why, outWhy}]})
function SideWhy({ m, P }) {
  const sbs = m.g.flatMap((x, k) => Object.entries(x.sb || {}).flatMap(([i, sw]) => sw.map((s, n) => ({ ...s, k, i: +i, n }))))
  return sbs.length > 0 && (
    <details className="tm-sb"><summary>⇄ {tx('Porque mudou o sideboard')}</summary>
      <ul className="why">{sbs.map(s => <li key={`${s.k}-${s.i}-${s.n}`}><b>{tx('J{g}', { g: s.k + 1 })} · {P[s.i]?.name}</b>: {tx('entra {q}× {i}', { q: s.q, i: s.in })} <span className="muted">({s.why})</span>; {tx('sai {x}', { x: s.out })} <span className="muted">({s.outWhy})</span></li>)}</ul>
    </details>
  )
}

function Match({ m, data, P, live, num, onGame, label, me, casual, odds, bet }) {
  const now = live?.ids?.has(m.id), tt = m.b === 'T'  // tt: 2 contra 2 à mesma mesa (p = equipa a, equipa a, equipa b, equipa b)
  const slot = k => {
    const i = m.p[k], s = m.src?.[k]
    if (i === -1) return <div className="ts pend" key={`${k}-p`}><span className="tp-thumb" /><span className="muted">{s ? (s[1] === 'w' ? tx('vencedor de #{m}', { m: num[s[0]] }) : tx('vencido de #{m}', { m: num[s[0]] })) : '—'}</span></div>
    if (i === null) return <div className="ts bye" key={`${k}-b`}><span className="tp-thumb" /><span className="muted">{tx('— isento —')}</span></div>
    const won = tt ? (m.win === m.p[0]) === (k < 2) : m.win === i  // 2HG: ganha a equipa
    const res = m.st === 'done' && !m.bye ? (m.win == null ? 'draw' : won ? 'win' : 'lose') : m.bye ? 'win' : ''
    return (
      <div className={`ts ${res} ${i === me ? 'me' : ''} ${tt && k === 2 ? 'tt-b' : ''}`} key={`${k}-${i}`} title={P[i]?.name}>
        <Thumb data={data} p={P[i]} /><i className="ts-seed">{i + 1}</i><span className="ts-n">{P[i]?.name}</span>{i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[i]?.format} />}
        {!m.bye && m.st !== 'wait' && (!tt || k % 2 === 0) && <b className="ts-sc">{m.w[tt ? k >> 1 : k]}</b>}
      </div>
    )
  }
  return (
    <div className={`tm ${m.st} ${now ? 'now' : ''} ${m.bye ? 'isbye' : ''} ${me != null && m.p.includes(me) ? 'mine' : ''}`} data-mid={m.id}>
      <div className="tm-h"><span>#{num[m.id]}{label ? ` · ${label}` : ''}</span>{now && <span className="livepill">{tx('● a jogar')}</span>}{m.tb ? <span className="muted" title={tx('Empatados depois dos jogos extra: passa o melhor seed')}>{tx('desempate pelo seed')}</span> : null}{m.note && <span className="muted" title={tx(m.note)}>⚠</span>}</div>
      {(tt ? [0, 1, 2, 3] : [0, 1]).map(slot)}
      {odds?.[m.id] && bet && <BetPop m={m} odds={odds[m.id]} P={P} bet={bet} />}
      {m.g.length > 0 && <div className="tm-g"><GameChips m={m} onGame={onGame} P={P} /></div>}
      <SideWhy m={m} P={P} />
    </div>
  )
}

function Bracket({ t, k, ...tools }) {
  const ref = useRef(null)
  const [paths, setPaths] = useState([])
  const secs = t.type === 'dupla' ? [['W', tx('Chave dos vencedores')], ['L', tx('Chave dos vencidos')], ['F', tx('Final')]] : [['W', null]]
  // linhas entre partidas (vencedor -> partida seguinte), medidas no DOM depois de desenhar
  useLayoutEffect(() => {
    const draw = () => {
      const box = ref.current
      if (!box) return
      const r0 = box.getBoundingClientRect(), out = []
      for (const m of t.matches) for (const [sid, wl] of m.src || []) {
        const a = box.querySelector(`[data-mid="${sid}"]`), b = box.querySelector(`[data-mid="${m.id}"]`)
        if (!a || !b || wl !== 'w' || a.closest('.tb-sec') !== b.closest('.tb-sec')) continue
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
        const x1 = ra.right - r0.left, y1 = ra.top + ra.height / 2 - r0.top, x2 = rb.left - r0.left, y2 = rb.top + rb.height / 2 - r0.top, xm = (x1 + x2) / 2
        const src = t.matches.find(x => x.id === sid)
        out.push({ d: `M${x1},${y1} H${xm} V${y2} H${x2}`, on: src.st === 'done' && !src.bye, key: `${sid}>${m.id}` })
      }
      setPaths(out)
    }
    draw()
    addEventListener('resize', draw)
    return () => removeEventListener('resize', draw)
  }, [t])
  return (
    <section className="card tb" ref={ref}>
      <svg className="tb-lines" aria-hidden="true">{paths.map(p => <path key={p.key} d={p.d} className={p.on ? 'on' : ''} />)}</svg>
      {secs.map(([b, title]) => {
        const ms = t.matches.filter(m => m.b === b || (b === 'W' && m.b === '3'))
        const cols = [...new Set(ms.filter(m => m.b !== '3').map(m => m.r))].sort((x, y) => x - y)
        return (
          <div key={b} className="tb-sec">
            {title && <h4>{title}</h4>}
            <div className="tb-cols">{cols.map(r => {
              const col = ms.filter(m => m.r === r && m.b !== '3'), third = b === 'W' && r === k ? ms.find(m => m.b === '3') : null
              return (
                <div key={r} className="tb-col">
                  <h5>{roundName(col[0], k)}</h5>
                  <div className="tb-ms">{col.map(m => <Match key={m.id} m={m} {...tools} />)}</div>
                  {third && <div className="tb-third"><Match m={third} {...tools} label={tx('3.º lugar')} /></div>}
                </div>
              )
            })}</div>
          </div>
        )
      })}
    </section>
  )
}

// rows/title: as tabelas de cada grupo (grupos + eliminação); cut = quantos passam (ficam marcados); no rei a série manda
function Standings({ t, data, P, me, casual, rows = t.standings, title = tx('Classificação'), cut = 0 }) {
  const pods = t.type === 'mesas', rei = t.type === 'rei'
  return (
    <section className="card ts-stand">
      <h4>{title}</h4>
      <table className="lab-table ts-table"><thead><tr><th>#</th><th>Deck</th>{rei ? <th title={tx('A série de vitórias mais longa como rei')}>{tx('Série')}</th> : <th>{tx('Pts')}</th>}{pods ? <><th>{tx('1.ºs lugares')}</th><th>{tx('Mesas')}</th></> : <><th>{tx('V-D-E')}</th><th title={tx('% de vitórias dos adversários')}>OMW%</th><th title={tx('% de jogos ganhos')}>GW%</th></>}<th>{tx('Dificuldade')}</th></tr></thead>
        <tbody>{rows.map((s, k) => (
          <tr key={s.i} className={`${t.champion === s.i || k < cut ? 'champ-row' : ''} ${s.i === me ? 'me-row' : ''}`}><td>{k + 1}</td><td><span className="ts-name"><Thumb data={data} p={P[s.i]} /> {P[s.i]?.name}<OwnTag p={P[s.i]} />{s.i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[s.i]?.format} />}{rei && t.hill?.king === s.i && <span title={tx('Rei da colina')}> 👑</span>}</span></td><td><b>{rei ? s.best : s.pts}</b></td>
            {pods ? <><td>{s.v}</td><td>{s.v + s.d + s.e}</td></> : <><td>{s.v}-{s.d}-{s.e}{s.bye ? <small className="muted"> {tx('({b} isento)', { b: s.bye })}</small> : null}</td><td>{s.opp.length ? pct(s.omw) : '—'}</td><td>{s.gw + s.gl ? pct(s.gwp) : '—'}</td></>}
            <td className="small muted">{DIFF_INFO[P[s.i]?.difficulty]?.label || P[s.i]?.difficulty}</td></tr>
        ))}</tbody></table>
    </section>
  )
}

// ms: só estas partidas (a fase de grupos); no rei da colina cada «ronda» é uma partida
function Rounds({ t, data, P, live, num, onGame, me, casual, odds, bet, ms = t.matches }) {
  const rs = [...new Set(ms.map(m => m.r))].sort((a, b) => b - a)  // a ronda mais recente primeiro
  const rei = t.type === 'rei'
  return (
    <section className="card">
      <h4>{rei ? tx('Partidas') : tx('Rondas')} {t.rounds ? <span className="muted small">{tx('{a} de {b}', { a: rs.length, b: t.rounds })}</span> : null}</h4>
      {rs.map(r => (
        <div key={r} className="tr-round"><h5>{rei ? tx('Partida {r}', { r }) : tx('Ronda {r}', { r })}</h5>
          <div className="tr-ms">{ms.filter(m => m.r === r).map(m => m.b === 'P' ? (
            <div key={m.id} className={`tm pod ${m.st} ${live?.ids?.has(m.id) ? 'now' : ''} ${m.p.includes(me) ? 'mine' : ''}`} data-mid={m.id}>
              <div className="tm-h"><span>{tx('Mesa {m}', { m: m.id.split('-')[1] })}</span>{live?.ids?.has(m.id) && <span className="livepill">{tx('● a jogar')}</span>}</div>
              {(m.pl || m.p).map((i, k) => <div key={i} className={`ts ${m.pl ? (k === 0 ? 'win' : '') : ''} ${i === me ? 'me' : ''}`}><Thumb data={data} p={P[i]} /><i className="ts-seed">{m.pl ? tx('{p}.º', { p: k + 1 }) : i + 1}</i><span className="ts-n">{P[i]?.name}</span>{i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[i]?.format} />}{m.st === 'done' && <b className="ts-sc">{m.pl ? `+${k === 0 ? 3 : m.pl.length - 1 - k}` : '+1'}</b>}</div>)}
              {odds?.[m.id] && bet && <BetPop m={m} odds={odds[m.id]} P={P} bet={bet} />}
              {m.g.length > 0 && <div className="tm-g"><GameChips m={m} onGame={onGame} P={P} /></div>}
            </div>
          ) : <Match key={m.id} m={m} data={data} P={P} live={live} num={num} onGame={onGame} me={me} casual={casual} odds={odds} bet={bet} />)}</div>
        </div>
      ))}
    </section>
  )
}

// gauntlet: as partidas do desafiante pela ordem, com o registo e a % de vitórias a correr (o título pede 75%)
function Gauntlet({ t, ...tools }) {
  const s = t.standings.find(x => x.i === t.ch) || { v: 0, d: 0, e: 0 }, N = t.matches.length, left = N - s.v - s.d - s.e, need = Math.ceil(0.75 * N)
  return (
    <section className="card">
      <h4><span className="ts-name"><Thumb data={tools.data} p={tools.P[t.ch]} /> {tx('{d} contra todos', { d: tools.P[t.ch]?.name })}</span></h4>
      <p className="small">{tx('{v}V {d}D {e}E · {w} de vitórias', { v: s.v, d: s.d, e: s.e, w: pct(s.v / Math.max(1, N - left)) })} · <span className="muted">{s.v >= need ? tx('título garantido') : s.v + left < need ? tx('já não chega aos 75%') : tx('faltam {k} vitórias para o título', { k: need - s.v })}</span></p>
      <div className="tr-ms">{t.matches.map((m, k) => <Match key={m.id} m={m} {...tools} label={tx('{k}.º adversário', { k: k + 1 })} />)}</div>
    </section>
  )
}

// rei da colina: o rei, a série dele, quem o está a desafiar e a fila
function Hill({ t, data, P }) {
  const h = t.hill, cur = t.matches.find(m => m.st !== 'done')
  if (!h) return null
  return (
    <section className="card">
      <h4>👑 {tx('Rei da colina')}</h4>
      <p><span className="ts-name"><Thumb data={data} p={P[h.king]} /> <b>{P[h.king]?.name}</b></span> <span className="muted small">{tx('série de {s}', { s: h.streak })}</span></p>
      {cur && <p className="small">{tx('A desafiar: {d}', { d: P[cur.p[1]]?.name })}</p>}
      <div className="hill-q"><span className="muted small">{tx('Fila:')}</span>{h.queue.length ? h.queue.map((i, k) => <span key={i} className={`hq ${k === 0 ? 'next' : ''}`} title={`${k + 1}.º · ${P[i]?.name}`}><Thumb data={data} p={P[i]} /><small>{k + 1}</small></span>) : <span className="muted">—</span>}</div>
    </section>
  )
}

// o fio das partidas do rei da colina: mosaico compacto (a mais recente primeiro), com quem ganhou e a série do rei
// depois de cada uma; a partida em curso fica com o cartão completo (apostas, «a jogar»)
function HillThread({ t, data, P, live, num, onGame, me, casual, odds, bet }) {
  const ms = [...t.matches].sort((a, b) => a.r - b.r), streak = {}
  let s = 0
  for (const m of ms) {  // a série do rei depois de cada partida (empate: o rei fica e a série volta a 0)
    if (m.st !== 'done') break
    s = m.win === m.p[0] ? s + 1 : m.win === m.p[1] ? 1 : 0
    streak[m.id] = s
  }
  const now = ms.filter(m => m.st !== 'done' && (live?.ids?.has(m.id) || m.st === 'ready')).slice(0, 1)
  const done = ms.filter(m => m.st === 'done').reverse()
  return (
    <section className="card hill-thread">
      <h4>{tx('Partidas')} <span className="muted small">{tx('{a} de {b}', { a: done.length, b: t.rounds || t.matches.length })}</span></h4>
      {now.map(m => <Match key={m.id} m={m} data={data} P={P} live={live} num={num} onGame={onGame} me={me} casual={casual} odds={odds} bet={bet} label={tx('Partida {r}', { r: m.r })} />)}
      <div className="ht-grid">{done.map(m => {
        const [k, c] = m.p, w = m.win
        const side = i => <span className={`ht-d ${w === i ? 'win' : ''} ${i === me ? 'me' : ''}`} title={P[i]?.name}><Thumb data={data} p={P[i]} /><span>{P[i]?.name}</span>{w === i && <i>👑</i>}</span>
        return (
          <div key={m.id} className={`ht-m ${m.p.includes(me) ? 'mine' : ''}`}>
            <span className="ht-n">#{m.r}</span>
            {side(k)}<span className="ht-vs">⚔</span>{side(c)}
            <span className="ht-s" title={tx('série do rei depois desta partida')}>{w == null ? tx('empate') : `×${streak[m.id]}`}</span>
            {m.g.length > 0 && <span className="ht-g"><GameChips m={m} onGame={onGame} P={P} /></span>}
          </div>
        )
      })}</div>
      {!done.length && !now.length && <p className="muted small">{tx('Ainda sem partidas.')}</p>}
    </section>
  )
}

// equipas: classificação por equipa e cada partida de equipas com os tabuleiros (o k de uma contra o k da outra)
function Teams({ t, ...tools }) {
  const { data, P, me } = tools, s = t.team, team = e => tx('Equipa {e}', { e: e + 1 })
  const tms = Object.values(t.matches.reduce((o, m) => ((o[m.tm] ||= []).push(m), o), {})).sort((a, b) => b[0].r - a[0].r)  // a ronda mais recente primeiro
  const won = (bs, e) => bs.filter(m => m.st === 'done' && m.win != null && Math.floor(m.win / s) === e).length
  return (
    <div className="tl-grid">
      <section className="card ts-stand">
        <h4>{tx('Classificação das equipas')}{t.table && <span className="muted small"> · {tableL(t.table)}</span>}</h4>
        <table className="lab-table ts-table"><thead><tr><th>#</th><th>{tx('Equipa')}</th><th>{tx('Pts')}</th><th>{tx('V-D-E')}</th><th title={t.table ? tx('Partidas ganhas–perdidas') : tx('Tabuleiros ganhos–perdidos')}>{t.table ? tx('Partidas') : tx('Tabuleiros')}</th></tr></thead>
          <tbody>{(t.teams || []).map((r, k) => (
            <tr key={r.t} className={`${t.champion != null && r.p.includes(t.champion) ? 'champ-row' : ''} ${r.p.includes(me) ? 'me-row' : ''}`}><td>{k + 1}</td>
              <td><b>{team(r.t)}</b><div style={{ display: 'grid', gap: 3, marginTop: 3 }}>{r.p.map(i => <span key={i} className="ts-name small"><Thumb data={data} p={P[i]} /> {P[i]?.name}{i === me && <i className="me-tag">{tx('eu')}</i>}</span>)}</div></td>
              <td><b>{r.pts}</b></td><td>{r.v}-{r.d}-{r.e}</td><td>{r.bw}–{r.bl}</td></tr>
          ))}</tbody></table>
      </section>
      <section className="card">
        <h4>{tx('Rondas')}</h4>
        {tms.map(bs => {
          const a = Math.floor(bs[0].p[0] / s), b = Math.floor(bs[0].p.at(-1) / s)
          return (
            <div key={bs[0].tm} className="tr-round"><h5>{tx('Ronda {r}', { r: bs[0].r })} · {team(a)} <b>{won(bs, a)}–{won(bs, b)}</b> {team(b)}</h5>
              <div className="tr-ms">{bs.map((m, k) => <Match key={m.id} m={m} {...tools} label={m.b === 'T' ? tableL(t.table) : tx('Tabuleiro {b}', { b: k + 1 })} />)}</div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

// pódio: 2.º · 1.º · 3.º (sem jogo de 3.º lugar os dois das meias-finais partilham o bronze)
// decks meus no pódio, no registo e no hall da fama abrem-se na Biblioteca (App.jsx ouve «grimorio:deck»)
const showDeck = id => window.dispatchEvent(new CustomEvent('grimorio:deck', { detail: id }))

// antes do 1.º jogo: contagem de 10 s (tempo para apostar) ou, com «só começar com o meu OK», o botão Começar
function StartGate({ t, onStart }) {
  const [left, setLeft] = useState(t.starts_in)
  useEffect(() => { setLeft(t.starts_in) }, [t.starts_in])
  const ticking = left > 0
  useEffect(() => { if (!ticking) return; const i = setInterval(() => setLeft(x => Math.max(0, x - 1)), 1000); return () => clearInterval(i) }, [ticking])
  if (t.status !== 'running' || t.matches.some(m => m.g.length || m.job)) return null
  if (t.hold) return <p className="t-gate">⏸ {tx('À espera do teu OK para começar: aproveita para apostar.')} <button className="primary" onClick={onStart}>▶ {tx('Começar')}</button></p>
  if (ticking) return <p className="t-gate">⏳ {tx('Começa em {s} s: tempo para apostar.', { s: Math.ceil(left) })} <button onClick={onStart}>▶ {tx('Começar já')}</button></p>
  return null
}

function Podium({ data, t }) {
  const rec = i => t.standings.find(x => x.i === i)  // equipas: vários decks no 1.º, cada um com o seu registo
  const step = n => (  // gauntlet: só o 1.º (os degraus vazios ficam invisíveis para o 1.º continuar ao centro)
    <div className={`pd-step pd-${n}`} style={t.podium.some(x => x.place === n) ? undefined : { visibility: 'hidden' }}>
      <div className="pd-decks">{t.podium.filter(x => x.place === n).map(x => {
        const c = data.byName.get(x.cover), s1 = n === 1 && rec(x.i)
        return (
          <div key={x.i} className={`pd-deck ${x.i === t.me ? 'me' : ''}`} style={{ '--edge': edge(x.colors || '') }} title={x.name}>
            {x.src === 'meus' ? <button className="pd-open" onClick={() => showDeck(x.ref)} title={tx('Abrir na Biblioteca')}>{c ? <img src={img(c, 'art_crop')} alt="" /> : <span className="pd-noart">✦</span>}</button>
              : c ? <img src={img(c, 'art_crop')} alt="" /> : <span className="pd-noart">✦</span>}
            <b>{n === 1 ? '👑 ' : ''}{x.name}</b>
            <span className="pd-sub"><OwnTag p={x} />{x.i === t.me && <i className="me-tag">{tx('eu')}</i>}{t.casual && <Fmt f={x.format} />}{s1 ? <small className="muted">{tx('{v}V {d}D', { v: s1.v, d: s1.d })}{s1.e ? ` ${tx('{e}E', { e: s1.e })}` : ''}</small> : null}</span>
          </div>
        )
      })}</div>
      <div className="pd-block"><span>{MEDAL[n - 1]}</span><b>{tx('{p}.º', { p: n })}</b></div>
    </div>
  )
  return (
    <section className={`card podium ${t.podium.some((x, k) => t.podium.findIndex(y => y.place === x.place) !== k) ? 'team' : ''}`}>
      <div className="champ-sparks" aria-hidden="true">{Array.from({ length: 14 }, (_, k) => <i key={k} style={{ '--k': k }} />)}</div>
      <h3>{tx('Pódio')} <span className="muted small">{t.name}</span></h3>
      <div className="pd-row">{step(2)}{step(1)}{step(3)}</div>
    </section>
  )
}

// ---------- registo ----------

// páginas: ‹ Anteriores · Página p de t · Seguintes › (só aparece com mais de uma página)
function Pages({ pg, pages, set }) {
  if (pages < 2) return null
  return (
    <div className="row-btns reg-pages"><button onClick={() => set(pg - 1)} disabled={!pg}>{tx('‹ Anteriores')}</button>
      <span className="muted small">{tx('Página {p} de {t}', { p: pg + 1, t: pages })}</span><button onClick={() => set(pg + 1)} disabled={pg >= pages - 1}>{tx('Seguintes ›')}</button></div>
  )
}
const page = (xs, pg, per) => { const pages = Math.max(1, Math.ceil(xs.length / per)), p = Math.min(pg, pages - 1); return [xs.slice(p * per, (p + 1) * per), p, pages] }

const REG_K = 'grimorio.torneio.registo', REG0 = { st: '', type: '', fmt: '', cas: '', mine: false, sort: 'novo' }, PER_PAGE = 20
const whenY = t => new Date(t * 1000).toLocaleString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const REG_SORT = { novo: [tx('Mais recentes'), (a, b) => b.ts - a.ts], velho: [tx('Mais antigos'), (a, b) => a.ts - b.ts], nome: [tx('Nome'), (a, b) => a.name.localeCompare(b.name)],
  decks: [tx('Mais decks'), (a, b) => b.n - a.n || b.ts - a.ts], jogos: [tx('Mais jogos'), (a, b) => (b.g || 0) - (a.g || 0) || b.ts - a.ts] }

function Registry({ data, list, open, reload }) {
  const del = async x => { if (!(await ask('torneio', { title: tx('Apagar o torneio «{t}» e todos os jogos dele?', { t: x.name }), ok: tx('Apagar') }))) return; await j(`/api/tournaments/${x.id}`, { method: 'DELETE' }); reload() }
  // filtros e ordem (guardados neste browser) e a página
  const [f, setFS] = useState(() => { try { return { ...REG0, ...JSON.parse(ls(REG_K) || '{}') } } catch { return REG0 } })
  const [page, setPage] = useState(0)
  const setF = (k, v) => { setFS(o => { const x = { ...o, [k]: v }; ls(REG_K, JSON.stringify(x)); return x }); setPage(0) }
  const stOf = x => (x.status === 'paused' || x.status === 'error' ? 'paused' : x.status)  // em pausa e parados por erro juntos
  const rows = list.filter(x => (!f.st || stOf(x) === f.st) && (!f.type || x.type === f.type) && (!f.fmt || x.format === f.fmt)
    && (!f.cas || (f.cas === 'sim') === !!x.casual) && (!f.mine || x.mine)).sort((REG_SORT[f.sort] || REG_SORT.novo)[1])
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE)), pg = Math.min(page, pages - 1)
  const opts = k => [...new Set(list.map(x => x[k]))].filter(Boolean)
  // painel: estado dos torneios, jogos jogados e troféus dos meus decks (lugares no pódio)
  const cnt = k => list.filter(x => stOf(x) === k).length
  const med = [1, 2, 3].map(pl => list.reduce((a, x) => a + (x.old ? 0 : (x.podium || []).filter(p => p.place === pl && p.src === 'meus' && !p.fr && !p.com).length), 0))
  const kpi = (k, l, v, sub) => <button className={`kpi ${f.st === k ? 'on' : ''}`} onClick={() => setF('st', f.st === k ? '' : k)} title={tx('Filtrar por este estado')}><small>{l}</small><b>{v}</b>{sub && <span>{sub}</span>}</button>
  return (
    <div className="reg-grid">
      <section className="card">
        <h3>{tx('Registo de torneios')} <span className="muted small">{rows.length === list.length ? list.length : tx('{n} de {t}', { n: rows.length, t: list.length })}</span></h3>
        {!list.length && <p className="muted">{tx('Ainda não há torneios. Cria um em «✦ Criar».')}</p>}
        {list.length > 0 && <>
          <div className="an-kpis reg-kpis">
            {kpi('running', tx('A decorrer'), cnt('running'))}
            {kpi('paused', tx('Em pausa'), cnt('paused'), cnt('paused') ? tx('ou parados por erro') : '')}
            {kpi('done', tx('Terminados'), cnt('done'))}
            {kpi('cancelled', tx('Cancelados'), cnt('cancelled'))}
            <div className="kpi"><small>{tx('Jogos jogados')}</small><b>{list.reduce((a, x) => a + (x.g || 0), 0).toLocaleString(LOCALE)}</b></div>
            <div className="kpi" title={tx('Lugares no pódio dos meus decks (sem os de amigos e da comunidade)')}><small>{tx('Troféus meus')}</small><b>{med[0] + med[1] + med[2]}</b><span>🥇 {med[0]} · 🥈 {med[1]} · 🥉 {med[2]}</span></div>
          </div>
          <div className="row-btns reg-filt">
            <select value={f.st} onChange={e => setF('st', e.target.value)} aria-label={tx('Estado')}><option value="">{tx('Todos os estados')}</option>
              {['running', 'paused', 'done', 'cancelled'].map(k => <option key={k} value={k}>{k === 'paused' ? tx('em pausa ou parado') : STATUS[k]}</option>)}</select>
            <select value={f.type} onChange={e => setF('type', e.target.value)} aria-label={tx('Tipo de torneio')}><option value="">{tx('Todos os tipos de torneio')}</option>
              {opts('type').map(k => <option key={k} value={k}>{TYPES[k]?.[0] || k}</option>)}</select>
            <select value={f.fmt} onChange={e => setF('fmt', e.target.value)} aria-label={tx('Formato')}><option value="">{tx('Todos os formatos')}</option>
              {opts('format').map(k => <option key={k} value={k}>{FORMAT[k]?.name || k}</option>)}</select>
            <select value={f.cas} onChange={e => setF('cas', e.target.value)} aria-label={tx('Casual')}><option value="">{tx('Casuais e não casuais')}</option><option value="sim">{tx('Só casuais')}</option><option value="nao">{tx('Sem os casuais')}</option></select>
            <select value={f.sort} onChange={e => setF('sort', e.target.value)} aria-label={tx('Ordenar')}>{Object.entries(REG_SORT).map(([k, [l]]) => <option key={k} value={k}>{tx('Ordenar: {o}', { o: l })}</option>)}</select>
            <label className="chk small"><input type="checkbox" checked={f.mine} onChange={e => setF('mine', e.target.checked)} /> {tx('só com decks meus')}</label>
            {(f.st || f.type || f.fmt || f.cas || f.mine) && <button className="link small" onClick={() => { setFS(o => { const x = { ...REG0, sort: o.sort }; ls(REG_K, JSON.stringify(x)); return x }); setPage(0) }}>{tx('limpar filtros')}</button>}
          </div>
          {!rows.length && <p className="muted small">{tx('Nenhum torneio com estes filtros.')}</p>}
        </>}
        <ul className="lib-list tour-reg">{rows.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE).map(x => (
          <li key={x.id}>
            <span className={`tl-status ${x.status}`}>{STATUS[x.status] || x.status}</span>
            <span><b>{x.name}</b><br /><small className="muted"><TypeIco k={x.type} /> {TYPES[x.type]?.[0]} · {x.casual ? tx('casual, regras de {f}', { f: FORMAT[x.format]?.name || x.format }) : FORMAT[x.format]?.name || x.format}{x.table ? ` · ${tableL(x.table)}` : ''} · {x.n} decks{x.g ? ` · ${tx('{n} jogo|{n} jogos', { n: x.g })}` : ''} · <time dateTime={new Date(x.ts * 1000).toISOString()}>{whenY(x.ts)}</time></small></span>
            {x.podium?.length ? <span className="mini-pod">{x.podium.map(p => (
              <span key={p.i} className={`mp mp-${p.place} ${p.me ? 'me' : ''} ${p.src === 'meus' ? 'go' : ''}`} title={`${tx('{p}.º', { p: p.place })} ${p.name}${p.me ? ` (${tx('o meu deck')})` : ''}${p.src === 'meus' ? ` · ${tx('Abrir na Biblioteca')}` : ''}`}
                {...(p.src === 'meus' ? { role: 'button', tabIndex: 0, onClick: () => showDeck(p.ref), onKeyDown: e => { if (e.key === 'Enter') showDeck(p.ref) } } : {})}><Thumb data={data} p={p} /><i>{MEDAL[p.place - 1]}</i><span>{p.name}</span></span>
            ))}</span> : <span className="muted small">{tx('sem pódio')}</span>}
            <span className="row-btns"><button onClick={() => open(x.id)}>{tx('Abrir')}</button><button className="link small" onClick={() => del(x)}>{tx('apagar')}</button></span>
          </li>
        ))}</ul>
        <Pages pg={pg} pages={pages} set={setPage} />
      </section>
      <Fame data={data} list={list} open={open} />
    </div>
  )
}

// copos de um cartão da galeria: no máximo 3 linhas; mede onde começa a 4.ª e troca o último que cabe por «+N» (N =
// troféus que ficam de fora; estão todos na vista do deck). Mede outra vez quando os copos ou a largura mudam.
const cupKey = c => `${c.tier}${c.kind}${c.casual}${c.off}`
function FgCups({ cups }) {
  const ref = useRef(null), sig = cups.map(c => cupKey(c) + c.n).join(), [m, setM] = useState(null)  // m = {sig, w, cut}
  const ok = m?.sig === sig
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || ok) return
    const tops = [...el.children].map(c => Math.round(c.offsetTop + c.offsetHeight / 2)), lines = [...new Set(tops)]  // o centro: alinhados ao meio
    setM({ sig, w: el.clientWidth, cut: lines.length > 3 ? tops.indexOf(lines[3]) - 1 : -1 })
  }, [ok, sig])
  useEffect(() => { const el = ref.current, ro = new ResizeObserver(() => setM(o => (o && o.w !== el.clientWidth ? null : o))); ro.observe(el); return () => ro.disconnect() }, [])
  const cut = ok ? m.cut : -1, rest = cut > 0 ? cups.slice(cut) : []
  return (
    <span className="fg-cups" ref={ref}>{(cut > 0 ? cups.slice(0, cut) : cups).map(c => <span key={cupKey(c)} className="fg-cup" title={`${PLACE[c.tier]} · ${KIND[c.kind] || ''}${c.friends ? ` · ${tx('🤝 só eu e amigos')}` : c.casual ? ` · ${tx('troféu azul: casual ou não ranked')}` : ''}${c.off ? ` · ${tx('não conta: a lista mudou mais de 10%')}` : ''} · ${tx('+{p} pontos', { p: c.pts })}\n${c.names.slice(0, 6).map(nm => `• ${nm}`).join('\n')}${c.names.length > 6 ? `\n+${c.names.length - 6}` : ''}`}><Cup place={c.tier} friends={c.friends} casual={c.casual} off={c.off} kind={c.kind} />{c.n > 1 && <small>×{c.n}</small>}</span>)}
      {rest.length > 0 && <span className="fg-cup fg-more" title={tx('Mais {n} troféus: clica para ver a lista inteira', { n: rest.reduce((a, c) => a + c.n, 0) })}>+{rest.reduce((a, c) => a + c.n, 0)}</span>}</span>
  )
}

// os troféus de um deck na vista do deck (todos os formatos, sem os de antes de repor): torneio, tipo, formato, lugar,
// data, registo, pontos e se ainda conta; cada um abre o torneio
function DeckTrophies({ r, list, tro, medOf, offOf, open }) {
  const perf = perfOf(tro, `${r.src}:${r.ref}`), mine = r.src === 'meus' ? tro[r.ref] || [] : []
  const items = list.filter(x => x.podium && !x.old).flatMap(x => x.podium.filter(p => p.src === r.src && p.ref === r.ref).map(p => {
    const m = medOf(x, p), off = offOf(r, m), t = mine.find(y => y.tid === x.id && y.place === p.place)
    return { ...m, x, off, same: t?.same, rec: t?.rec || perf?.rec?.[x.id], pts: off ? 0 : trophyValue(m) }
  })).sort((a, b) => a.off - b.off || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.x.ts - a.x.ts)
  if (!items.length) return null
  const pts = items.reduce((a, t) => a + t.pts, 0)
  return (
    <section className="dv-tro">
      <div className="dv-tro-h"><h4>🏆 {tx('Troféus')}</h4><span className="muted small">{tx('{n} troféus · {p} pontos', { n: items.length, p: pts })}</span><TrophyStars p={pts} perf={perf} /></div>
      <ul className="drt-shelf">{items.map(t => (
        <li key={`${t.tid}-${t.place}`} className={t.off ? 'off' : ''}><button className="plain" onClick={() => open(t.tid)} title={[t.off ? tx('Não conta: a lista mudou {p} desde este torneio (máx. 10%)', { p: `${Math.round((1 - (t.same ?? 0)) * 100)}%` }) : tx('Abrir o torneio'), t.friends ? tx('🤝 só eu e amigos') : t.casual ? tx('troféu azul: casual ou não ranked') : ''].filter(Boolean).join(' · ')}>
          <Cup place={t.tier} kind={t.kind} casual={t.casual} friends={t.friends} off={t.off} />
          <span><b>{t.name}</b>
            <small className="muted">{PLACE[t.tier].split(':')[0]} · {KIND[t.kind] || t.kind} · {t.x.casual ? tx('casual') : FORMAT[t.x.format]?.name || t.x.format} · {tx('{n} decks', { n: t.n })}</small>
            <small className="muted">{whenY(t.x.ts)}{t.rec ? ` · ${tx('{v}V {d}D', { v: t.rec[0], d: t.rec[1] })}${t.rec[2] ? ` ${t.rec[2]}E` : ''}` : ''}</small></span>
          <b className="dv-p">{t.off ? tx('não conta') : `+${t.pts}`}</b></button></li>))}</ul>
    </section>
  )
}

// hall da fama: títulos e pódios por deck (os meus e os do meta), por formato do torneio ou só os casuais
function Fame({ data, list, open }) {
  const [f, setF] = useState('')
  const [who, setWho] = useState(['meu', 'ami', 'com', 'meta'])
  const kindOf = p => (p.src !== 'meus' ? 'meta' : p.fr ? 'ami' : p.com ? 'com' : 'meu')
  const peek = usePeek(data), [view, setView] = useState(null)  // deck em destaque (rato) e aberto (clique, só para ler)
  const fmts = [...new Set(list.filter(x => x.podium && !x.old && !x.casual).map(x => x.format))]  // old: de antes de repor os troféus
  const rows = {}
  // ranked chega da lista como 0/1 (SQLite), nunca false: com «=== false» os não ranked contavam como normais (o dobro)
  const medOf = (x, p) => ({ tier: tierOf(p.place, x.champions), casual: !!x.casual || !x.ranked, tid: x.id, place: p.place, kind: x.type, name: x.name, n: x.n, m: x.m, podiums: !!x.podiums, friends: !!x.friends })
  for (const x of list) if (x.podium && !x.old && (!f || (f === 'casual' ? x.casual : !x.casual && x.format === f))) for (const p of x.podium) {
    const r = (rows[`${p.src}:${p.ref}`] ||= { ...p, m: [0, 0, 0], med: [] })
    r.m[p.place - 1]++
    r.med.push(medOf(x, p))
  }
  // troféus dos meus decks que já não contam (a lista mudou mais de 10% desde o torneio): ficam a cinzento na galeria
  const [tro, setTro] = useState({})
  useEffect(() => { fetch('/api/tournaments/trophies').then(r => (r.ok ? r.json() : {})).then(setTro).catch(() => {}) }, [])
  const has = new Set(Object.values(rows).map(kindOf))
  const top = Object.values(rows).filter(r => who.includes(kindOf(r)))
    .sort((a, b) => b.m[0] - a.m[0] || b.m[1] - a.m[1] || b.m[2] - a.m[2] || a.name.localeCompare(b.name))
  // galeria: filtros (lugar/cor e tipo de torneio) e ordem (valor, quantidade, nome) próprios
  const [gTier, setGTier] = useState(''), [gKind, setGKind] = useState(''), [gSort, setGSort] = useState('valor'), [gInfo, setGInfo] = useState(false)
  const offOf = (r, m) => r.src === 'meus' && (tro[r.ref] || []).some(t => t.tid === m.tid && t.place === m.place && !t.valid)
  const keepM = m => (!gKind || m.kind === gKind) && (!gTier || (gTier === 'azul' ? m.casual : gTier === 'normal' ? !m.casual : String(m.tier) === gTier))
  // páginas (hall: 20 decks; galeria: 24); mudar um filtro volta à 1.ª
  const [pT, setPT] = useState(0), [pG, setPG] = useState(0)
  const whoK = who.join()
  useEffect(() => setPT(0), [f, whoK]); useEffect(() => setPG(0), [f, whoK, gTier, gKind, gSort])
  const [topPg, pt, ptN] = page(top, pT, 20)
  const gal = top.map(r => { const med = r.med.filter(keepM), ok = med.filter(m => !offOf(r, m)); return { r, med, val: ok.reduce((a, m) => a + trophyValue(m), 0), n: ok.length, all: r.med.filter(m => !offOf(r, m)).reduce((a, m) => a + trophyValue(m), 0), blue: r.med.filter(m => !offOf(r, m) && m.casual).reduce((a, m) => a + trophyValue(m), 0) } })
    .filter(x => x.med.length)
    .sort((a, b) => (gSort === 'nome' ? a.r.name.localeCompare(b.r.name) : gSort === 'quantidade' ? b.n - a.n || b.val - a.val : b.val - a.val || b.n - a.n))
  const [galPg, pg2, pgN] = page(gal, pG, 24)
  const kinds = [...new Set(top.flatMap(r => r.med.map(m => m.kind)))].filter(Boolean)
  return (
    <>
    {peek.card}
    {view && <DeckView p={view} data={data} onClose={() => setView(null)} onOpen={showDeck} extra={<DeckTrophies r={view} list={list} tro={tro} medOf={medOf} offOf={offOf} open={id => { setView(null); open(id) }} />} />}
    <section className="card fame">
      <h3>{tx('🏛 Hall da fama')}</h3>
      <div className="row-btns">
        <select value={f} onChange={e => setF(e.target.value)} aria-label={tx('Formato')}><option value="">{tx('Todos os formatos')}</option>{fmts.map(k => <option key={k} value={k}>{FORMAT[k]?.name || k}</option>)}{list.some(x => x.casual && x.podium) && <option value="casual">{tx('Casuais')}</option>}</select>
        <SrcFilter on={who} set={setWho} has={has} />
      </div>
      {!top.length ? <p className="muted small">{f ? tx('Ainda ninguém subiu ao pódio neste formato.') : tx('Ainda ninguém subiu ao pódio.')}</p> : (<>
        <table className="lab-table ts-table"><thead><tr><th>Deck</th><th title={tx('Torneios ganhos')}>🥇</th><th>🥈</th><th>🥉</th><th>{tx('Pódios')}</th></tr></thead>
          <tbody>{topPg.map(r => (
            <tr key={`${r.src}:${r.ref}`} className={kindOf(r) === 'meu' ? 'me-row' : ''}><td><button className="ts-name plain fame-deck" onClick={() => setView(r)} onMouseEnter={e => peek.on(r, e)} onMouseLeave={peek.off} title={tx('Ver o deck')}><Thumb data={data} p={r} /> {r.name} <OwnTag p={r} /></button></td>
              <td><b>{r.m[0] || '—'}</b></td><td>{r.m[1] || '—'}</td><td>{r.m[2] || '—'}</td><td>{r.m[0] + r.m[1] + r.m[2]}</td></tr>
          ))}</tbody></table>
        <Pages pg={pt} pages={ptN} set={setPT} /></>
      )}
    </section>
      {top.length > 0 && <section className="card fg-sec">
        <h3>{tx('Galeria de troféus')} <span className="muted small">{tx('segue os filtros do hall da fama')}</span> <button className="link small" onClick={() => setGInfo(v => !v)}>ⓘ {tx('Valor dos troféus')}</button></h3>
        {gInfo && <div className="fg-info small">
          <p className="muted">{tx('Valor = pontos do lugar × peso do tipo × jogadores (√(decks ÷ 8), ×0,6 a ×1,6) × duração no rei da colina, suíço e mesas (partidas jogadas ÷ típicas, ×0,5 a ×1,5); os azuis (casual ou não ranked) valem metade ({w}).', { w: `×${BLUE_W}` })}</p>
          <div className="fg-tab"><span>{TIERS.map(t => <i key={t}><Cup place={t} /> {PLACE[t].split(':')[0]} <b>{TIER_PTS[t]}</b></i>)}</span>
            <span>{Object.entries(KIND_W).sort((a, b) => b[1] - a[1]).map(([k, w]) => <i key={k}><Cup place={1} kind={k} /> {KIND[k]} <b>×{w}</b></i>)}</span></div>
          <h4>{tx('Estrelas brancas (0–6) = pontos (até {a}★) + desempenho (até {b}★)', { a: PTS_STARS, b: PERF_STARS })}</h4>
          <p className="muted">{tx('Pontos: a soma dos troféus que contam, em escala logarítmica — os primeiros troféus sobem depressa e as {a}★ ficam para coleções enormes. Sozinhos já não chegam às 6★.', { a: PTS_STARS })}</p>
          <div className="fg-tab"><span>{tx('Pontos:')} {Array.from({ length: PTS_STARS }, (_, k) => k + 1).map(k => <i key={k}>{k}★ <b>{starPoints(k)}</b></i>)}</span></div>
          <p className="muted">{tx('Desempenho: em todos os torneios que o deck jogou, os pontos de troféus que ganhou ÷ os que um deck médio ganharia (cada torneio reparte os pontos do pódio pelos decks que entram; maiores e mais difíceis pesam mais). ×1 é a média do campo — todos os decks que jogaram, meus, de amigos e do meta. Com poucos torneios o quociente é puxado para a média (como se tivesse mais 10 torneios na média), por isso um ouro de sorte não chega ao topo. Os meus decks só contam os torneios em que a lista ainda vale.')}</p>
          <div className="fg-tab"><span>{tx('Desempenho:')} {[0, 0.5, 1, 1.5, 2].map(k => <i key={k}>+{k.toLocaleString(LOCALE)}★ <b>×{perfQ(k).toLocaleString(LOCALE, { maximumFractionDigits: 2 })}</b></i>)}</span></div>
          <p className="muted">{tx('6★ é o deck perfeito: coleção enorme e sempre acima dos outros. Sem troféus que contem, sem estrelas.')}</p>
        </div>}
        <p className="fg-note small"><Cup place={1} friends /> {tx('Contorno verde: torneio só entre os teus decks e os de amigos (vale como os azuis).')} <Cup place={1} casual /> {tx('Os troféus azuis vêm de torneios casuais ou não ranked (menos de 20% de decks do meta) e valem metade dos pontos. Os pontos de cada deck somam todos os troféus que contam; as estrelas brancas juntam esses pontos ao desempenho nos torneios (ⓘ Valor dos troféus). Clica num deck para ver as cartas e todos os troféus.')}</p>
        <div className="row-btns fg-filt">
          <select value={gTier} onChange={e => setGTier(e.target.value)} aria-label={tx('Troféus')}>
            <option value="">{tx('Todos os troféus')}</option>
            {TIERS.map(t => <option key={t} value={t}>{PLACE[t].split(':')[0]}</option>)}
            <option value="normal">{tx('Só normais (ranked)')}</option><option value="azul">{tx('Só azuis (casual ou não ranked)')}</option>
          </select>
          <select value={gKind} onChange={e => setGKind(e.target.value)} aria-label={tx('Tipo de torneio')}>
            <option value="">{tx('Todos os tipos de torneio')}</option>{kinds.map(k => <option key={k} value={k}>{KIND[k] || k}</option>)}
          </select>
          <select value={gSort} onChange={e => setGSort(e.target.value)} aria-label={tx('Ordenar')}>
            <option value="valor">{tx('Ordenar: valor dos troféus')}</option><option value="quantidade">{tx('Ordenar: número de troféus')}</option><option value="nome">{tx('Ordenar: nome')}</option>
          </select>
          <span className="muted small">{tx('{n} deck|{n} decks', { n: gal.length })}</span>
        </div>
        {!gal.length && <p className="muted small">{tx('Nenhum troféu com estes filtros.')}</p>}
        <div className="fame-gal">{galPg.map(({ r, med, val, all, blue }) => {
          const off = m => offOf(r, m)
          const g = {}
          for (const m of med) { const k = `${m.tier}|${m.kind}|${m.casual}|${m.friends}|${off(m)}`; const e = (g[k] ||= { ...m, off: off(m), n: 0, names: [], pts: 0 }); e.n++; e.names.push(m.name); e.pts += off(m) ? 0 : trophyValue(m) }
          const cups = Object.values(g).sort((a, b) => a.off - b.off || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.casual - b.casual)
          const body = <><Thumb data={data} p={r} /><b title={r.name}>{r.name}</b><small className="fg-val" title={tx('Valor dos troféus')}>{val} {tx('pts')}</small>
            <TrophyStars p={all} perf={perfOf(tro, `${r.src}:${r.ref}`)} note={blue ? tx('{a} normais (ranked) + {b} de troféus azuis (casual ou não ranked, valem metade)', { a: all - blue, b: blue }) : ''} />
            <FgCups cups={cups} />{/* no máximo 3 linhas; o resto num «+N» (a lista inteira está na vista do deck) */}</>
          return <button key={`${r.src}:${r.ref}`} className={`fg-card ${kindOf(r) === 'meu' ? 'me' : ''}`} onClick={() => setView(r)} onMouseEnter={e => peek.on(r, e)} onMouseLeave={peek.off}>{body}</button>
        })}</div>
        <Pages pg={pg2} pages={pgN} set={setPG} />
      </section>}
    </>
  )
}
