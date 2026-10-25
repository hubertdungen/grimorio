// Torneio no Coliseu: vários decks jogam entre si no Forge. O servidor (tournament.py) agenda as partidas e guarda tudo;
// aqui cria-se o torneio, vê-se a chave/classificação a mexer ao vivo, revêem-se os jogos e consulta-se o registo.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FORMATS, FORMAT, CASUAL_INFO, CASUAL_META, baseLife } from './formats.js'
import { img, coverOf, colorsOf, HUE } from './data.js'
import { Mana, Stars, WhiteStars } from './ui.jsx'
import Replay from './Board.jsx'
import { Cup, PLACE, TIERS, KIND, tierOf } from './Library.jsx'
import { trophyValue, TIER_PTS, KIND_W, BLUE_W, trophyStars, starPoints } from './trophyvalue.js'
import { swapSide, nextGame, mixTake } from './game.js'
import { DIFF_INFO } from './difficulty.js'
import { ask } from './confirm.jsx'
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
  equipas: [tx('Equipas (2 ou 3 por equipa)'), 6, 24, tx('Os decks formam equipas pela ordem da lista (1.º e 2.º = equipa 1…). As equipas jogam todas contra todas: o tabuleiro 1 de uma contra o tabuleiro 1 da outra, e assim por diante; ganha a equipa com mais tabuleiros ganhos (vitória 3, empate 1). Todos os decks da equipa sobem ao pódio.')],
}
// ícones dos tipos de torneio (traço na cor do texto)
const TYPE_ICO = {
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

export default function TournamentView({ data, fmt, deckId }) {
  // o separador fica guardado (F5 volta ao mesmo sítio)
  const [view, setViewS] = useState(() => ls('grimorio.torneio.vista') || 'criar')
  const setView = v => { setViewS(v); ls('grimorio.torneio.vista', v) }
  const [tid, setTid] = useState(null)
  const [slot, setSlot] = useState(null)  // ao lado das abas: o «← Voltar ao torneio» de um jogo aberto vai para aqui
  const [list, setList] = useState([])
  const loadList = () => j('/api/tournaments').then(l => { setList(l); return l }).catch(() => [])
  useEffect(() => {  // ao entrar: volta ao torneio que estava aberto, ou ao que está a decorrer
    loadList().then(l => {
      const last = ls('grimorio.torneio'), on = l.find(x => x.id === last) || l.find(x => x.status === 'running')
      if (on) { setTid(on.id); if (!['criar', 'registo', 'gerar', 'apostas'].includes(ls('grimorio.torneio.vista'))) setView('ver') }
      else if (view === 'ver') setView('criar')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const open = id => { setTid(id); ls('grimorio.torneio', id); setView('ver') }
  return (
    <div className="view tour">
      <div className="tour-top"><div className="seg tour-nav">
        <button className={view === 'criar' ? 'on' : ''} onClick={() => setView('criar')}>{tx('✦ Criar')}</button>
        <button className={view === 'gerar' ? 'on' : ''} onClick={() => setView('gerar')}>{tx('🎲 Gerador')}</button>
        <button className={view === 'ver' ? 'on' : ''} onClick={() => setView('ver')} disabled={!tid}>{tx('🏆 Ao vivo')}</button>
        <button className={view === 'registo' ? 'on' : ''} onClick={() => { loadList(); setView('registo') }}>{tx('📜 Registo')} <b>{list.length}</b></button>
        <button className={view === 'apostas' ? 'on' : ''} onClick={() => setView('apostas')}>{tx('🪙 Apostas')}</button>
      </div><span className="tour-slot" ref={setSlot} /></div>
      {view === 'criar' && <Create data={data} fmt0={fmt} deckId={deckId} onCreated={id => { loadList(); open(id) }} />}
      {view === 'gerar' && <Generator data={data} onCreated={() => { loadList(); setView('registo') }} />}
      {view === 'ver' && tid && <Live key={tid} data={data} tid={tid} slot={slot} onGone={() => { loadList(); setView('registo') }} />}
      {view === 'apostas' && <BetsTab open={open} />}
      {view === 'registo' && <Registry data={data} list={list} open={open} reload={loadList} />}
    </div>
  )
}

// ---------- criar ----------

function Create({ data, fmt0, onCreated, deckId }) {
  const [format, setFormat] = useState(fmt0.key === 'casual' ? 'modern' : fmt0.key)
  const F = FORMAT[format]
  const [type, setType] = useState(F.cmd === 'commander' && format !== 'duel' ? 'mesas' : 'elim')
  const [bo, setBo] = useState(1)
  const [third, setThird] = useState(true)
  const [rounds, setRounds] = useState('')
  const [seeding, setSeeding] = useState('aleatorio')
  const [name, setName] = useState('')
  const [players, setPlayers] = useState([])
  const [casual, setCasual] = useState(false)  // formatos misturados; `format` passa a ser o das regras base
  const [hold, setHold] = useState(() => ls('grimorio.torneio.hold') === '1')  // só começa com o OK (escolha guardada, também nas Definições)
  const [metaFmt, setMetaFmt] = useState('')
  const mf = casual ? metaFmt || format : format
  const [allMine, setAllMine] = useState([])
  const mine = casual ? allMine : allMine.filter(d => d.format === format && !d.casual)  // os decks casuais só entram nos casuais
  const [meta, setMeta] = useState([])
  const [diffs, setDiffs] = useState([])
  const [fillN, setFillN] = useState(8)
  const [srcs, setSrcs] = useState(['meu', 'meta'])  // de onde vem o «Preencher»: meus, comunidade (decks de outros guardados) e meta
  // fontes sem decks neste formato ficam a cinzento e não contam (a escolha fica guardada para quando houver)
  const avail = { meu: mine.some(o => !o.community), com: mine.some(o => o.community), meta: meta.length > 0 }
  const srcsOn = srcs.filter(k => avail[k])
  const okMine = o => srcsOn.includes(o.community ? 'com' : 'meu')
  const [favOnly, setFavOnlyS] = useState(() => ls('grimorio.torneio.favoritos') === '1')  // «Preencher» só com os meus favoritos
  const setFavOnly = v => { setFavOnlyS(v); ls('grimorio.torneio.favoritos', v ? '1' : '0') }
  // mistura das fontes no «Preencher» (pesos 0–100; nos não casuais o meta fica ligado e com pelo menos 20%)
  const META_MIN = casual ? 0 : 0.2
  const [mix, setMixS] = useState(() => { try { return { meu: 50, com: 20, meta: 30, ...JSON.parse(ls('grimorio.torneio.mistura') || '{}') } } catch { return { meu: 50, com: 20, meta: 30 } } })
  const setMix = (k, v) => setMixS(m => { const n = { ...m, [k]: v }; ls('grimorio.torneio.mistura', JSON.stringify(n)); return n })
  useEffect(() => { if (!casual && !srcs.includes('meta')) setSrcs(v => [...v, 'meta']) }, [casual, srcs])
  const weights = Object.fromEntries(srcsOn.map(k => [k, Math.max(k === 'meta' ? META_MIN * 100 : 0, mix[k] ?? 0)]))
  const share = (() => {  // a parte de cada fonte, como o mixTake a vai usar
    const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1, out = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / sum]))
    if (META_MIN && out.meta < META_MIN) { const rest = 1 - out.meta; for (const k of Object.keys(out)) out[k] = k === 'meta' ? META_MIN : rest ? (out[k] * (1 - META_MIN)) / rest : 0 }
    return out
  })()
  const [allDiff, setAllDiff] = useState('default')
  const [smin, setSmin] = useState(0)
  const [smax, setSmax] = useState(6)
  const [unrated, setUnrated] = useState(true)
  const [stars, setStars] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { j('/api/sim/difficulties').then(setDiffs).catch(() => {}); j('/api/decks').then(setAllMine).catch(() => {}) }, [])
  useEffect(() => { if (!casual) setPlayers([]) }, [format, casual])
  useEffect(() => { setMeta([]); j(`/api/sim/opponents?format=${mf}`).then(setMeta).catch(() => setMeta([])) }, [mf])
  useEffect(() => {
    j(`/api/ratings?format=${format}`).then(r => setStars(Object.fromEntries((Array.isArray(r) ? r : r.rows || []).filter(x => x?.key).map(x => [x.key, { ...x, prov: x.provisional, deck: undefined }]))))
      .catch(() => setStars({}))
  }, [format])
  const [team, setTeam] = useState(2)  // equipas: decks por equipa
  const [, lo0, max0, info] = TYPES[type]
  const lo = type === 'equipas' ? 3 * team : lo0, max = type === 'equipas' ? 8 * team : max0  // equipas: 3 a 8 equipas
  const n = players.length
  const teamBad = type === 'equipas' && n >= lo && n % team !== 0
  const [champs, setChamps] = useState(false)  // torneio dos campeões: o vencedor leva o troféu de platina
  const [champFrom, setChampFrom] = useState('')  // de onde vêm os campeões: '' todos, um tipo (ex.: 'suico') ou 'campeoes' (campeões dos campeões)
  // «o meu deck»: o escolhido da última vez (guardado) ou o deck aberto, se estiver entre os decks do torneio
  const setMe = ref => { setPlayers(ps => ps.map(x => ({ ...x, me: !!ref && x.src === 'meus' && x.ref === ref }))); ls('grimorio.torneio.eu', ref || '-') }  // «-» = escolheste nenhum
  useEffect(() => {
    if (players.some(x => x.me) || ls('grimorio.torneio.eu') === '-') return
    const want = [ls('grimorio.torneio.eu'), deckId].filter(Boolean).find(r => players.some(x => x.src === 'meus' && x.ref === r))
    if (want) setPlayers(ps => ps.map(x => ({ ...x, me: x.src === 'meus' && x.ref === want })))
  }, [players, deckId])
  const suggested = `${champs ? `🏆 ${champFrom === 'campeoes' ? tx('Campeões dos campeões') : champFrom ? tx('Campeões · {t}', { t: TYPES[champFrom]?.[0] }) : tx('Campeões')}` : TYPES[type][0]} · ${casual ? tx('casual') : F.name} · ${new Date().toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' })}`
  // os vencedores dos torneios acabados: deste formato (sem os casuais) ou, em modo casual, de todos os torneios
  const loadChampions = async () => {
    const l = await j('/api/tournaments').catch(() => []), seen = new Set(), out = []
    for (const t of l) {
      if (t.status !== 'done' || t.old || (!casual && (t.casual || t.format !== format))) continue  // old: antes de repor os troféus
      if (champFrom === 'campeoes' ? !t.champions : champFrom && t.type !== champFrom) continue
      const w = (t.podium || []).find(x => x.place === 1)
      if (!w || seen.has(`${w.src}:${w.ref}`) || (w.src === 'meus' && !allMine.some(d => d.id === w.ref))) continue
      seen.add(`${w.src}:${w.ref}`); out.push(w)
    }
    if (out.length < lo) { setErr(tx('Só há {k} campeões de torneios anteriores para isto (mínimo {m}).', { k: out.length, m: lo })); return }
    setErr('')
    setPlayers(out.slice(0, max).map(w => ({ key: `${w.src}:${w.ref}:${Math.random()}`, src: w.src, ref: w.ref, name: w.name, difficulty: allDiff, fmt: w.format, cover: w.cover || '', colors: w.colors || '' })))
    setChamps(true)
  }
  const roundsDef = type === 'suico' ? Math.ceil(Math.log2(Math.max(n, 2))) : type === 'rei' ? 3 * Math.max(n - 1, 1) : 3  // rei: nº de partidas (por omissão 3 × (decks − 1); até 200)
  const R = +rounds || roundsDef
  const G = Math.ceil(n / 4), T = Math.floor(n / team)  // grupos: grupos de 4 ou 3 (+ chave dos 2·G apurados, com 3.º lugar)
  const matches = { elim: n - 1 + (third && n >= 4 ? 1 : 0), dupla: 2 * n - 1, suico: R * Math.ceil(n / 2), liga: (n * (n - 1)) / 2, mesas: R * Math.ceil(n / 4),
    gauntlet: Math.max(n - 1, 0), rei: R, equipas: ((T * (T - 1)) / 2) * team,
    grupos: Array.from({ length: G }, (_, i) => { const s = Math.floor(n / G) + (i < n % G ? 1 : 0); return (s * (s - 1)) / 2 }).reduce((a, b) => a + b, 0) + 2 * G }[type]
  const chK = Math.max(0, players.findIndex(x => x.me))  // gauntlet: o desafiante
  const boOf = type === 'mesas' ? 1 : bo === 2 && !BO2.includes(type) ? 3 : bo  // Bo2 só onde o empate faz parte do formato
  // ranked (como tournament.ranked): não casual e pelo menos 20% de decks do meta → estrelas amarelas e troféus normais
  const nMeta = players.filter(p => p.src === 'meta').length, metaNeed = Math.max(1, Math.ceil(0.2 * n - 1e-9)), isRanked = !casual && nMeta >= metaNeed
  const games = Math.round(matches * ({ 1: 1, 2: 2, 3: 2.5, 5: 4 }[boOf] || 1))

  const deckOf = async (src, o) => (src === 'meus' ? o : j(`/api/sim/opponents/${encodeURIComponent(o.id)}`))
  const entry = async (src, o, difficulty) => {
    const d = await deckOf(src, o), c = coverOf(d, data)
    return { key: `${src}:${o.id}:${Math.random()}`, src, ref: o.id, name: o.name, difficulty, fmt: src === 'meus' ? o.format : mf, cover: c?.n || '', colors: colorsOf(d, data).join('') }
  }
  const add = async (src, o) => {
    if (n >= max) return setErr(tx('Este tipo leva no máximo {m} participantes.', { m: max }))
    setErr(''); const e = await entry(src, o, allDiff).catch(() => null)
    if (e) setPlayers(p => [...p, e])
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
  const start = async () => {
    setBusy(true); setErr('')
    try {
      const { id } = await post('/api/tournaments', { name: name.trim() || suggested, type, format, casual, hold, champions: champs, bo: boOf, third, rounds: R, seeding, team,
        players: players.map(({ src, ref, difficulty, cover, colors, me }) => ({ src, ref, difficulty, cover, colors, me })) })
      onCreated(id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const has = (s, id) => players.some(p => p.src === s && p.ref === id)
  return (
    <section className="card tour-create">
      <h3>{tx('Novo torneio')} <span className="muted small">{tx('os bots do Forge jogam tudo sozinhos no servidor — podes fechar o browser e voltar mais tarde')}</span></h3>
      <div className="tc-grid">
        <div className="lab-step">
          <h4 className="step-h"><i>1</i> {tx('Regras')}</h4>
          <label className="fmt"><span>{tx('Nome')}</span><input value={name} onChange={e => setName(e.target.value)} placeholder={suggested} /></label>
          <label className="chk"><input type="checkbox" checked={casual} onChange={e => setCasual(e.target.checked)} /> {tx('Modo casual (formatos misturados)')}</label>
          {casual && <p className="small muted tc-info">{CASUAL_INFO} {tx('Os torneios casuais não contam para os ratings.')}</p>}
          <label className="fmt"><span>{casual ? tx('Regras base (vida e tipo de jogo de todos)') : tx('Formato (todos os decks jogam este)')}</span>
            <select value={format} onChange={e => { const f = e.target.value; setFormat(f); setType(FORMAT[f].cmd === 'commander' && f !== 'duel' ? 'mesas' : 'elim') }}>{FORMATS.filter(f => f.key !== 'casual' && f.key !== 'limited').map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</select></label>
          <div className="tc-types">{Object.entries(TYPES).map(([k, [l, lo, hi]]) => (
            <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}><TypeIco k={k} /><b>{l}</b><small>{lo}–{hi} decks</small></button>
          ))}</div>
          <p className="small muted tc-info">{info}</p>
          <div className="tc-row">
            <label className="fmt"><span>{tx('Partidas')}</span><select value={boOf} onChange={e => setBo(+e.target.value)} disabled={type === 'mesas'}><option value={1}>{tx('Um jogo (Bo1)')}</option>{BO2.includes(type) && <option value={2} title={tx('Dois jogos: 2-0 ganha, 1-1 é empate')}>{tx('Dois jogos (Bo2, pode empatar)')}</option>}<option value={3}>{tx('Melhor de 3 (Bo3)')}</option><option value={5}>{tx('Melhor de 5 (Bo5)')}</option></select></label>
            {(type === 'suico' || type === 'mesas' || type === 'rei') && <label className="fmt"><span>{type === 'rei' ? tx('N.º de partidas') : tx('Rondas')}</span><input type="number" min={type === 'rei' ? Math.max(n - 1, 1) : 1} max={type === 'rei' ? 200 : roundsDef + 3} title={type === 'rei' ? tx('Pelo menos {m} (para todos os decks jogarem) e até 200', { m: Math.max(n - 1, 1) }) : undefined} value={rounds} placeholder={String(roundsDef)} onChange={e => setRounds(e.target.value)} /></label>}
            {type === 'equipas' && <label className="fmt"><span>{tx('Decks por equipa')}</span><select value={team} onChange={e => setTeam(+e.target.value)}><option value={2}>2</option><option value={3}>3</option></select></label>}
            <label className="fmt"><span>Seeds</span><select value={seeding} onChange={e => setSeeding(e.target.value)}><option value="aleatorio">{tx('Sorteados ao começar')}</option><option value="ordem">{tx('Pela ordem da lista')}</option></select></label>
          </div>
          {type === 'elim' && <label className="chk small"><input type="checkbox" checked={third} onChange={e => setThird(e.target.checked)} /> {tx('Jogo de 3.º lugar')}</label>}
          <p className="small muted">{bo === 3 && type !== 'mesas' ? `${tx('Bo3 com sideboard inteligente entre jogos, como no Laboratório (decks com sideboard, em formatos que o têm), e aprende com as trocas que já perderam.')} ` : ''}{tx('Empates na eliminação repetem o jogo (até 2 vezes); depois passa o melhor seed. Jogos em que o Forge falha repetem-se.')}</p>
        </div>
        <div className="lab-step">
          <h4 className="step-h"><i>2</i> Decks <span className="chip">{n}/{max}</span></h4>
          <p className="small muted tc-info">{tx('Marca um dos teus com')} <b>{tx('☆ eu')}</b> {tx('para jogar «como se fosses tu»: fica destacado e vês até onde chegas.')}</p>
          <div className="tc-fill">
            <span>{tx('🎲 Preencher até')}</span><input type="number" min="2" max={max} value={fillN} onChange={e => setFillN(+e.target.value)} />
            <span className="seg small tc-srcs" role="group" aria-label={tx('De onde')}>{[['meu', tx('🧙 Meus')], ['com', tx('🌐 Comunidade')], ['meta', tx('📊 Meta')]].map(([k, l]) => (
              <button key={k} className={srcsOn.includes(k) ? 'on' : ''} aria-pressed={srcsOn.includes(k)} disabled={!avail[k] || (k === 'meta' && !casual)}
                title={!avail[k] ? ({ meu: tx('Não tens decks teus neste formato.'), com: tx('Não tens decks da comunidade neste formato.'), meta: tx('Sem decks do meta para este formato.') }[k]) : k === 'meta' && !casual ? tx('Nos torneios não casuais entra sempre o meta (pelo menos 20%), para os ratings terem decks de referência.') : undefined}
                onClick={() => setSrcs(v => (v.includes(k) ? (v.length > 1 ? v.filter(x => x !== k) : v) : [...v, k]))}>{l}</button>))}</span>
            {srcsOn.length > 1 && <span className="tc-mix" role="group" aria-label={tx('Mistura')}>{srcsOn.map(k => (
              <label key={k} className={`tc-mix-${k}`}><span>{{ meu: tx('🧙 Meus'), com: tx('🌐 Comunidade'), meta: tx('📊 Meta') }[k]}</span>
                <input type="range" min={k === 'meta' ? META_MIN * 100 : 0} max="100" step="5" value={weights[k]} onChange={e => setMix(k, +e.target.value)} />
                <b>{Math.round((share[k] || 0) * 100)}%</b></label>
            ))}</span>}
            {!casual && <><span className="tc-stars">{tx('estrelas')} <select value={smin} onChange={e => setSmin(+e.target.value)} aria-label={tx('Mínimo de estrelas')}>{STEPS.map(x => <option key={x} value={x}>{x.toLocaleString(LOCALE)}</option>)}</select>
              {tx('a')} <select value={smax} onChange={e => setSmax(+e.target.value)} aria-label={tx('Máximo de estrelas')}>{STEPS.map(x => <option key={x} value={x}>{x.toLocaleString(LOCALE)}</option>)}</select></span>
            <label className="chk small"><input type="checkbox" checked={unrated} onChange={e => setUnrated(e.target.checked)} /> {tx('incluir decks sem rating')}</label></>}
            <label className="chk small" title={tx('Só os decks que marcaste com ★ na Biblioteca')}><input type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} /> ★ {tx('só favoritos')}</label>
            <button onClick={fill} disabled={n >= Math.min(fillN, max)}>{tx('Preencher')}</button>
            <select className="tc-champ-from" value={champFrom} onChange={e => { setChampFrom(e.target.value); setChamps(false) }} aria-label={tx('Campeões de')} title={tx('De que torneios vêm os campeões')}>
              <option value="">{tx('Campeões de todos os tipos')}</option>
              <option value="campeoes">{tx('🏆 Campeões dos campeões (platinas)')}</option>
              {Object.entries(TYPES).map(([k, [l]]) => <option key={k} value={k}>{tx('Campeões: {t}', { t: l })}</option>)}
            </select>
            <button className={champs ? 'on' : ''} onClick={champs ? () => setChamps(false) : loadChampions} title={tx('Junta os vencedores dos torneios anteriores (deste formato; em modo casual, de todos). O vencedor leva o troféu de platina.')}>🏆 {champs ? tx('Torneio dos campeões ✓') : tx('Campeões')}</button>
            {n > 0 && <button className="link small" onClick={() => setPlayers([])}>{tx('limpar')}</button>}
          </div>
          <h4>{casual ? tx('Os meus decks') : tx('Os meus decks de {f}', { f: F.name })} <span className="muted">({mine.filter(o => !o.community).length})</span></h4>
          <div className="opp-list">{mine.filter(o => !o.community).map(o => <button key={o.id} className={`opp ${has('meus', o.id) ? 'on' : ''}`} onClick={() => add('meus', o)}>+ {o.name}{casual && <span className="muted"> · {FORMAT[o.format]?.name || o.format}</span>} {!casual && <Stars r={stars[rkey('meus', o.id)]} />}</button>)}{!mine.length && <span className="muted small">{tx('Nenhum deck teu neste formato.')}</span>}</div>
          {mine.some(o => o.community) && <><h4>{tx('🌐 Da comunidade')} <span className="muted">({mine.filter(o => o.community).length})</span></h4>
          <div className="opp-list">{mine.filter(o => o.community).map(o => <button key={o.id} className={`opp ${has('meus', o.id) ? 'on' : ''}`} onClick={() => add('meus', o)}>+ {o.name}{casual && <span className="muted"> · {FORMAT[o.format]?.name || o.format}</span>} {!casual && <Stars r={stars[rkey('meus', o.id)]} />}</button>)}{!mine.length && <span className="muted small">{tx('Nenhum deck teu neste formato.')}</span>}</div></>}
          <h4>{tx('Do meta')} {casual ? <select className="tc-mf" value={mf} onChange={e => setMetaFmt(e.target.value)} aria-label={tx('Decks do meta de')}>{CASUAL_META.map(k => <option key={k} value={k}>{tx('de {f}', { f: FORMAT[k]?.name || k })}</option>)}</select> : null} <span className="muted">({meta.length})</span></h4>
          <div className="opp-list">{meta.map(o => <button key={o.id} className={`opp ${has('meta', o.id) ? 'on' : ''}`} onClick={() => add('meta', o)}>+ {o.name} {o.share ? <span className="muted">{Math.round(o.share * 100)}%</span> : null} <Stars r={stars[rkey('meta', o.id)]} /></button>)}{!meta.length && <span className="muted small">{tx('Sem decks do meta para este formato.')}</span>}</div>
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
          <div className="tp-art" onPointerDown={e => dragStart(e, k)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} title={tx('Arrasta para mudar a ordem')}>{data.byName.get(p.cover) ? <img src={img(data.byName.get(p.cover), 'art_crop')} alt="" loading="lazy" /> : <span>✦</span>}<i className="tp-seed" title="seed">{seeding === 'ordem' ? k + 1 : '?'}</i><span className="tp-src">{p.src === 'meus' ? tx('meu') : 'meta'}{casual && p.fmt ? ` · ${FORMAT[p.fmt]?.name || p.fmt}` : ''}</span></div>
          <div className="tp-body">
            <b title={p.name}>{p.name}</b>
            {type === 'equipas' && seeding === 'ordem' && <small className="muted">{tx('Equipa {e} · tabuleiro {b}', { e: Math.floor(k / team) + 1, b: (k % team) + 1 })}</small>}
            {type === 'gauntlet' && k === chK && <small style={{ color: 'var(--gold2)' }}>{tx('⚔ desafiante')}</small>}
            <span className="tp-l1">{p.colors ? <Mana cost={[...p.colors].map(x => `{${x}}`).join('')} /> : <Mana cost="{C}" />}</span>
            <span className="tp-l2">{stars[rkey(p.src, p.ref)] ? <Stars r={stars[rkey(p.src, p.ref)]} /> : !casual && <span className="muted small">{tx('sem rating')}</span>}</span>
            <select value={p.difficulty} onChange={e => setP(k, { difficulty: e.target.value })} aria-label={tx('Dificuldade de {d}', { d: p.name })} title={DIFF_INFO[p.difficulty]?.resumo}>{diffs.filter(d => d.id !== 'random').map(d => <option key={d.id} value={d.id}>{dLabel(d)}</option>)}</select>
            <span className="row-btns">{p.src === 'meus' && <button className={`me-btn ${p.me ? 'on' : ''}`} onClick={() => setPlayers(ps => ps.map((x, i) => ({ ...x, me: i === k ? !x.me : false })))} aria-pressed={!!p.me} title={tx('É o teu deck: segues o percurso dele no torneio')}>{p.me ? tx('★ eu') : tx('☆ eu')}</button>}{seeding === 'ordem' && <><button onClick={() => move(k, -1)} disabled={!k} aria-label={tx('Subir')}>▲</button><button onClick={() => move(k, 1)} disabled={k === n - 1} aria-label={tx('Descer')}>▼</button></>}<button className="link small" onClick={() => setPlayers(x => x.filter((_, i) => i !== k))}>{tx('tirar')}</button></span>
          </div>
        </div>
      ))}</div>}
      <div className="row-btns tc-go">
        <button className="primary" onClick={start} disabled={busy || n < lo || n > max || teamBad}>{tx('🏆 Começar o torneio')}</button>
        <label className="chk small" title={tx('Sem isto, o torneio espera 10 s antes do 1.º jogo para dar tempo de apostar')}><input type="checkbox" checked={hold} onChange={e => { setHold(e.target.checked); ls('grimorio.torneio.hold', e.target.checked ? '1' : '0') }} /> {tx('Só começar quando eu der OK')}</label>
        {n > 0 && (casual ? <span className="rk rk-cas" title={tx('Nos torneios casuais os troféus saem azuis e as estrelas amarelas não mexem.')}>{tx('Casual')}</span>
          : isRanked ? <span className="rk rk-ok" title={tx('Conta para as estrelas amarelas e dá troféus normais (ouro, prata e bronze).')}>🏅 {tx('Ranked')}</span>
            : <span className="rk rk-warn">⚠ {tx('Não ranked: {m} de {n} decks do meta (precisa de {k}). Conta só para as estrelas azuis e vermelhas e os troféus saem azuis.', { m: nMeta, n, k: metaNeed })}</span>)}
        <span className="small muted">{n < lo ? tx('Faltam {k} decks (mínimo {m}).', { k: lo - n, m: lo }) : teamBad ? tx('Com equipas de {s} o número de decks tem de ser múltiplo de {s}.', { s: team }) : tx('{p} partidas · ≈ {g} jogos · ≈ {t} min (um jogo de cada vez no Forge)', { p: matches, g: games, t: Math.max(1, Math.round((games * MIN_PER_GAME * (type === 'mesas' ? 2 : 1)) / 5) * 5) })}</span>
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
const savedMix = () => { try { return { meu: 50, com: 20, meta: 30, ...JSON.parse(ls('grimorio.torneio.mistura') || '{}') } } catch { return { meu: 50, com: 20, meta: 30 } } }
const GEN0 = { count: 3, casual: 'nao', format: RND, type: RND, n: RND, bo: RND, mix: RND, stars: 'todas', diff: 'default', fav: false }

function Generator({ data, onCreated }) {
  const [g, setG] = useState(() => { try { return { ...GEN0, ...JSON.parse(ls('grimorio.torneio.gerador') || '{}') } } catch { return GEN0 } })
  const set = (k, v) => setG(o => { const n = { ...o, [k]: v }; ls('grimorio.torneio.gerador', JSON.stringify(n)); return n })
  const [diffs, setDiffs] = useState([])
  const [allMine, setAllMine] = useState(null)
  const [list, setList] = useState([])  // os torneios gerados (pré-visualização)
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
    const casual = g.casual === RND ? Math.random() < 0.25 : g.casual === 'sim'
    const format = g.format !== RND ? g.format : pick(CASUAL_META)
    const mf = casual ? pick(CASUAL_META) : format
    const mine = (allMine || []).filter(d => casual || (d.format === format && !d.casual)).filter(d => !g.fav || d.fav)
    const own = mine.filter(o => !o.community)
    // gauntlet ao acaso só com um deck meu para desafiante
    const type = g.type !== RND ? g.type : multi(format) ? 'mesas' : pick(Object.keys(TYPES).filter(k => k !== 'mesas' && (k !== 'gauntlet' || own.length)))
    const team = type === 'equipas' ? pick([2, 3]) : 2
    const meta = await metaOf(mf).catch(() => []), stars = casual ? {} : await starsOf(format)
    const avail = { meu: mine.some(o => !o.community), com: mine.some(o => o.community), meta: meta.length > 0 }
    const srcs = Object.keys(avail).filter(k => avail[k])
    const w = Object.fromEntries(srcs.map(k => [k, g.mix === RND ? rint(0, 10) * 10 : savedMix()[k]]))
    if (!casual && 'meta' in w) w.meta = Math.max(20, w.meta)
    const [smin, smax] = STAR_SETS[g.stars === RND ? pick(Object.keys(STAR_SETS)) : g.stars]
    const inStars = (s, id) => { const x = stars[rkey(s, id)]; return casual || x == null || (x >= smin && x <= smax) }
    const pool = [...mine.map(o => ['meus', o]), ...meta.map(o => ['meta', o])].filter(([s, o]) => inStars(s, o.id)).sort(() => Math.random() - 0.5)
    let [, lo, hi] = TYPES[type]
    if (type === 'equipas') { lo = 3 * team; hi = 8 * team }
    const top = Math.min(hi, pool.length, 16)
    let n = g.n === RND ? rint(lo, Math.max(lo, top)) : Math.min(hi, Math.max(lo, +g.n))
    if (type === 'equipas') n -= n % team
    const bo = type === 'mesas' ? 1 : g.bo !== RND ? (+g.bo === 2 && !BO2.includes(type) ? 3 : +g.bo) : pick([1, 1, 3, 3, ...(BO2.includes(type) ? [2] : []), 5])
    const diff = g.diff === RND ? pick(ids) : g.diff
    const base = { key: Math.random(), casual, format, type, team, bo, smin, smax, n, w, mf }
    if (pool.length < lo || n < lo) return { ...base, players: [], bad: tx('Só há {k} decks para {t} em {f} (mínimo {m}).', { k: pool.length, t: TYPES[type][0], f: casual ? tx('casual') : FORMAT[format]?.name, m: lo }) }
    let chosen = mixTake(pool, n, w, casual ? 0 : 0.2)
    if (type === 'gauntlet') {  // o desafiante (1.º, ☆ eu) é um deck meu
      const ch = chosen.find(([s, o]) => s === 'meus' && !o.community) || (own.length && ['meus', pick(own)])
      if (ch) chosen = [ch, ...chosen.filter(x => x !== ch && !(x[0] === 'meus' && x[1].id === ch[1].id))].slice(0, n)
    }
    const players = (await Promise.all(chosen.map(async ([src, o]) => {
      const d = await deckOf(src, o).catch(() => null), c = d && coverOf(d, data)
      return d && { src, ref: o.id, name: o.name, com: !!o.community, difficulty: g.diff === 'cada' ? pick(ids) : diff, cover: c?.n || '', colors: colorsOf(d, data).join('') }
    }))).filter(Boolean)
    const nMeta = players.filter(p => p.src === 'meta').length
    const name = `${RND} ${TYPES[type][0]} · ${casual ? tx('casual') : FORMAT[format]?.name} · ${new Date().toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' })}`
    return { ...base, players, name, ranked: !casual && nMeta >= Math.max(1, Math.ceil(0.2 * players.length - 1e-9)), bad: players.length < lo ? tx('Faltaram decks.') : '' }
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
          players: t.players.map(({ src, ref, difficulty, cover, colors }, i) => ({ src, ref, difficulty, cover, colors, me: t.type === 'gauntlet' && !i && src === 'meus' })) })
        ok++
      } catch (e) { setErr(`${t.name}: ${e.message}`) }
    }
    setBusy(false)
    if (ok) { setList([]); onCreated() }
  }
  const sel = (k, label, opts, rnd = true) => (
    <label className="fmt"><span>{label}</span><select value={g[k]} onChange={e => set(k, e.target.value)}>
      {rnd && <option value={RND}>{tx('🎲 ao acaso')}</option>}{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)
  return (
    <section className="card tour-gen">
      <h3>{tx('Gerador de torneios')} <span className="muted small">{tx('cria vários torneios de uma vez; o que estiver em 🎲 sai diferente em cada um')}</span></h3>
      <div className="gen-grid">
        <label className="fmt"><span>{tx('Quantos')}</span><input type="number" min="1" max="10" value={g.count} onChange={e => set('count', e.target.value)} /></label>
        {sel('casual', tx('Modo'), [['nao', tx('Normal (ranked)')], ['sim', tx('Casual (formatos misturados)')]])}
        {sel('format', tx('Formato'), GEN_FMTS.map(f => [f.key, f.name]))}
        {sel('type', tx('Tipo'), Object.entries(TYPES).map(([k, [l]]) => [k, l]))}
        {sel('n', tx('Decks'), [4, 6, 8, 12, 16, 24, 32].map(x => [x, String(x)]))}
        {sel('bo', tx('Partidas'), [[1, 'Bo1'], [2, tx('Bo2 (onde pode empatar)')], [3, 'Bo3'], [5, 'Bo5']])}
        {sel('mix', tx('Mistura de fontes'), [['preencher', tx('a do «Preencher»')]])}
        {sel('stars', tx('Estrelas'), Object.entries(STAR_SETS).map(([k, [, , l]]) => [k, l]))}
        {sel('diff', tx('Dificuldade'), [['cada', tx('🎲 uma a cada deck')], ...diffs.filter(d => d.id !== 'random').map(d => [d.id, dLabel(d)])])}
        <label className="chk small"><input type="checkbox" checked={g.fav} onChange={e => set('fav', e.target.checked)} /> ★ {tx('dos meus, só favoritos')}</label>
      </div>
      <p className="small muted tc-info">{tx('O formato ao acaso escolhe entre os que têm decks do meta. Commander a 4 joga em mesas. Fora do casual entra sempre pelo menos 20% do meta, para os torneios serem ranked. A seguir é só vê-los no Registo e no Ao vivo: o simulador reparte os jogos como está nas Definições.')}</p>
      <div className="row-btns">
        <button onClick={generate} disabled={busy || allMine == null}>{tx('🎲 Gerar')}</button>
        {good.length > 0 && <button className="primary" onClick={createAll} disabled={busy}>{tx('🏆 Criar os {k} torneios', { k: good.length })}</button>}
        {busy && <span className="small muted">{tx('a escolher os decks…')}</span>}
        {err && <span className="small bad-t">{err}</span>}
      </div>
      {list.length > 0 && <div className="gen-list">{list.map((t, k) => (
        <div key={t.key} className={`gen-row ${t.bad ? 'bad' : ''}`}>
          <TypeIco k={t.type} />
          <div className="gen-info">
            <b>{TYPES[t.type][0]}</b>
            <span className="small">{t.casual ? `${tx('casual')} · ${tx('meta de {f}', { f: FORMAT[t.mf]?.name || t.mf })}` : FORMAT[t.format]?.name} · {tx('{n} decks', { n: t.players.length || t.n })} · Bo{t.bo}{t.type === 'equipas' ? ` · ${tx('equipas de {s}', { s: t.team })}` : ''}</span>
            <span className="small muted">{[['meu', tx('🧙 meus')], ['com', tx('🌐 comunidade')], ['meta', tx('📊 meta')]].map(([s, l]) => [l, t.players.filter(p => (p.src === 'meta' ? 'meta' : p.com ? 'com' : 'meu') === s).length]).filter(([, c]) => c).map(([l, c]) => `${c} ${l}`).join(' · ')}{!t.casual && ` · ${t.smin.toLocaleString(LOCALE)}–${t.smax.toLocaleString(LOCALE)}★`}</span>
            {t.bad ? <span className="small bad-t">{t.bad}</span> : t.casual ? <span className="rk rk-cas">{tx('Casual')}</span> : t.ranked ? <span className="rk rk-ok">🏅 {tx('Ranked')}</span> : <span className="rk rk-warn">⚠ {tx('Não ranked')}</span>}
          </div>
          <div className="gen-decks">{t.players.map((p, i) => (
            <span key={i} className="gen-deck" style={{ '--edge': edge(p.colors) }} title={`${p.name} · ${p.src === 'meus' ? tx('meu') : 'meta'}`}>{data.byName.get(p.cover) ? <img src={img(data.byName.get(p.cover), 'art_crop')} alt="" loading="lazy" /> : <i>✦</i>}</span>))}</div>
          <span className="row-btns gen-btns"><button onClick={() => redo(k)} disabled={busy} title={tx('Sortear este outra vez')}>🎲</button><button className="link small" onClick={() => setList(l => l.filter((_, i) => i !== k))}>{tx('tirar')}</button></span>
        </div>))}</div>}
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

function Live({ data, tid, onGone, slot }) {
  const [t, setT] = useState(null)
  const [err, setErr] = useState('')
  const [watch, setWatch] = useState(null)  // {gid, game, deckName, score}
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
      const me0 = t.me == null ? -1 : g.seats.indexOf(t.me)
      if (me0 > 0) { const sv = [...g.seats]; [sv[0], sv[me0]] = [sv[me0], sv[0]]; g = { ...swapSide(g, 'abcd'[me0]), seats: sv } }  // o meu deck fica em baixo, no lugar do jogador
      const names = g.seats.map(i => (i === t.me && who ? `${who} - ${P[i]?.name || '?'}` : P[i]?.name || '?')), m = x.m
      const prev = m.g.slice(0, x.k).filter(y => !y.x)
      const score = names.length === 2 ? { a: prev.filter(y => y.w === g.seats[0]).length, b: prev.filter(y => y.w === g.seats[1]).length, g: prev.length + 1, bo: t.bo, serie: 1, series: 1, sw: 0, sl: 0, k: 1, total: 1 } : null
      const mk = t.me == null ? -1 : g.seats.indexOf(t.me)
      setWatch({ gid: x.id, mid: m.id, seats: g.seats, deckName: names[0], pov: mk >= 0 ? 'abcd'[mk] : null, score, formats: t.casual ? Object.fromEntries(g.seats.map((i, k) => ['abcd'[k], FORMAT[P[i]?.format]?.name || P[i]?.format])) : null, game: { ...g, g: x.k + 1, opp: names[1], ...(names.length > 2 && { opps: Object.fromEntries(names.slice(1).map((nm, k) => ['bcd'[k], nm])) }), startLife: t.casual ? baseLife(t.format, names.length) : fmt.cmd ? 40 : 20 } })
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
  }, [fl]) // eslint-disable-line react-hooks/exhaustive-deps
  const bets = useBets(tid, t)
  if (!t) return <section className="card">{err ? <p className="bad-t">{err}</p> : <p><span className="spin-dot" /> {tx('A abrir o torneio…')}</p>}</section>
  const act = async a => { try { await post(`/api/tournaments/${tid}/${a}`); setT(await j(`/api/tournaments/${tid}`)) } catch (e) { setErr(e.message) } }
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
    return <>{slot && createPortal(<button onClick={() => setWatch(null)}>{tx('← Voltar ao torneio')}</button>, slot)}<Replay key={watch.gid} data={data} game={watch.game} deckName={watch.deckName} pov={watch.pov} track bets={myBets} bots={Object.fromEntries((watch.seats || []).map((i, k) => { const d = DIFF_INFO[P[i]?.difficulty]; return ['abcd'[k], d && { label: d.label, title: tx('Bot do Forge: {d} — {r}', { d: d.label, r: d.resumo }) }] }).filter(x => x[1]))} score={watch.score} formats={watch.formats} onBack={slot ? null : () => setWatch(null)} backLabel={tx('← Voltar ao torneio')}
      live={going && follow && i >= 0 && i === fl.length - 1} speed0={pause.speed} onSpeed={v => setPausePref({ ...pause, speed: v })} hands={pause.hands || 'ambas'} onHands={h => setPausePref({ ...pause, hands: h })}
      next={follow && i >= 0 ? { has: !!nx, go: () => nx && openGame(nx.x, nx.away), secs: pause.secs, auto: pause.auto } : null} /></>
  }
  const lives = (t.lives || (t.live ? [t.live] : [])).map(L => ({ L, lm: t.matches.find(m => m.id === L.match) })).filter(x => x.lm), lm = lives[0]?.lm
  const nameOf = i => (i == null ? '—' : P[i]?.name)
  const k = Math.max(...t.matches.filter(m => m.b === 'W').map(m => m.r), 1)
  const num = Object.fromEntries(t.matches.map((m, i) => [m.id, i + 1]))
  const tools = { data, P, live: t.live && { ...t.live, ids: new Set(lives.map(x => x.L.match)) }, num, onGame: openGame, me: t.me, casual: t.casual, odds: bets.b?.match, bet: bets.b && { coins: bets.b.coins, place: bets.place, mine: new Set(bets.b.bets.filter(x => x.status === 'open').map(x => x.mid)) } }
  const bracket = t.type === 'elim' || t.type === 'dupla'
  // «o meu deck»: onde está, se caiu e o lugar final (tournament.py me_state)
  const ms = t.me_state, mm = ms?.match && t.matches.find(m => m.id === ms.match)
  const opp = mm ? mm.p.filter(x => x !== t.me).map(x => (x === -1 ? tx('adversário por decidir') : nameOf(x))).join(', ') : ''
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
          <span className="muted small">{!t.casual && (t.ranked !== false ? <span className="rk rk-ok sm" title={tx('Conta para as estrelas amarelas e dá troféus normais (ouro, prata e bronze).')}>🏅 {tx('Ranked')}</span> : <span className="rk rk-warn sm" title={tx('Menos de 20% de decks do meta: conta só para as estrelas azuis e vermelhas e os troféus saem azuis.')}>{tx('não ranked')}</span>)} <TypeIco k={t.type} /> {TYPES[t.type]?.[0]} · {t.casual ? tx('casual, regras de {f}', { f: FORMAT[t.format]?.name || t.format }) : FORMAT[t.format]?.name || t.format} · {t.type === 'mesas' ? tx('um jogo por mesa') : `Bo${t.bo}`} · {P.length} decks{t.team ? ` · ${tx('equipas de {s}', { s: t.team })}` : ''}{t.rounds ? ` · ${t.type === 'rei' ? tx('{n} partida|{n} partidas', { n: t.rounds }) : tx('{n} ronda|{n} rondas', { n: t.rounds })}` : ''} · {when(t.ts)}</span>
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
        {meLine && <p className={`me-line ${ms.phase}`}><Thumb data={data} p={P[t.me]} /><span><small>{tx('O meu deck · {d}', { d: P[t.me]?.name })}</small><b>{ms.phase === 'done' ? `${(t.type !== 'gauntlet' || ms.place[0] === 1) && MEDAL[ms.place[0] - 1] || '🎖'} ` : ''}{meLine}</b></span></p>}
        {lives.map(({ L, lm }) => <p key={lm.id} className="tl-now"><span className="spin-dot" /> {L.status === 'queued' ? tx('Na fila do Forge (posição {p})', { p: L.position }) : tx('A jogar')}: <b>#{num[lm.id]}</b> {(L.seats || lm.p).map(nameOf).join(' vs ')} · {tx('jogo {g}', { g: lm.g.length + 1 })}{lm.p.length === 2 && t.bo > 1 ? ` · ${lm.w[0]}–${lm.w[1]}` : ''}{Object.keys(lm.sb || {}).length > 0 && <span className="muted" title={Object.entries(lm.sb).map(([i, sw]) => `${nameOf(+i)}: ${sw.map(s => `+${s.q} ${s.in} −${s.q} ${s.out}`).join(', ')}`).join('\n')}> · {tx('⇄ com sideboard:')} {Object.keys(lm.sb).map(i => nameOf(+i)).join(', ')}</span>}</p>)}
        {!lm && t.status === 'running' && <p className="tl-now muted"><span className="spin-dot" /> {tx('À espera da vez no Forge…')}</p>}
        {t.error && <p className="small bad-t">{tx(t.error)}</p>}
        {err && <p className="small bad-t">{err}</p>}
      </section>
      {ms?.phase === 'out' && going && <section className="me-out" role="status"><b>{ms.groups ? tx('💀 Ficaste pela fase de grupos') : tx('💀 Foste eliminado {w}', { w: where(mm, k) })}</b><span>{ms.groups ? '' : mm?.g.length ? tx('{o} ganhou-te a partida por {s}.', { o: nameOf(ms.by), s: `${mm.w[mm.p.indexOf(ms.by)]}–${mm.w[mm.p.indexOf(t.me)]}` }) : tx('{o} ganhou-te a partida.', { o: nameOf(ms.by) })} {tx('O torneio continua sem ti — vê quem fica com o título.')}</span></section>}
      <BetsPanel {...bets} P={P} data={data} num={num} going={going} type={t.type} />
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
  const [pick, setPick] = useState(null), ref = useRef(null)
  return (
    <details className="bet-d" ref={ref}>
      <summary className="bet-chip" title={tx('Apostar nesta partida')}>🪙 {odds.length > 2 ? tx('apostar') : odds.map(x => x.toFixed(2)).join(' / ')}{bet.mine.has(m.id) ? ' · ✓' : ''}</summary>
      <div className="bet-pop">
        {m.p.map((i, k) => <button key={i} className={`bet-opt ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}><span>{P[i]?.name}</span><b>{odds[k].toFixed(2)}</b></button>)}
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

function Thumb({ data, p }) {
  const c = p && data.byName.get(p.cover)
  return <span className="tp-thumb" style={{ '--edge': edge(p?.colors || '') }}>{c ? <img src={img(c, 'art_crop')} alt="" loading="lazy" /> : null}</span>
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
  const now = live?.ids?.has(m.id)
  const slot = k => {
    const i = m.p[k], s = m.src?.[k]
    if (i === -1) return <div className="ts pend" key={`${k}-p`}><span className="tp-thumb" /><span className="muted">{s ? (s[1] === 'w' ? tx('vencedor de #{m}', { m: num[s[0]] }) : tx('vencido de #{m}', { m: num[s[0]] })) : '—'}</span></div>
    if (i === null) return <div className="ts bye" key={`${k}-b`}><span className="tp-thumb" /><span className="muted">{tx('— isento —')}</span></div>
    const res = m.st === 'done' && !m.bye ? (m.win === i ? 'win' : m.win == null ? 'draw' : 'lose') : m.bye ? 'win' : ''
    return (
      <div className={`ts ${res} ${i === me ? 'me' : ''}`} key={`${k}-${i}`} title={P[i]?.name}>
        <Thumb data={data} p={P[i]} /><i className="ts-seed">{i + 1}</i><span className="ts-n">{P[i]?.name}</span>{i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[i]?.format} />}
        {!m.bye && m.st !== 'wait' && <b className="ts-sc">{m.w[k]}</b>}
      </div>
    )
  }
  return (
    <div className={`tm ${m.st} ${now ? 'now' : ''} ${m.bye ? 'isbye' : ''} ${me != null && m.p.includes(me) ? 'mine' : ''}`} data-mid={m.id}>
      <div className="tm-h"><span>#{num[m.id]}{label ? ` · ${label}` : ''}</span>{now && <span className="livepill">{tx('● a jogar')}</span>}{m.tb ? <span className="muted" title={tx('Empatados depois dos jogos extra: passa o melhor seed')}>{tx('desempate pelo seed')}</span> : null}{m.note && <span className="muted" title={tx(m.note)}>⚠</span>}</div>
      {[0, 1].map(slot)}
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
          <tr key={s.i} className={`${t.champion === s.i || k < cut ? 'champ-row' : ''} ${s.i === me ? 'me-row' : ''}`}><td>{k + 1}</td><td><span className="ts-name"><Thumb data={data} p={P[s.i]} /> {P[s.i]?.name}{s.i === me && <i className="me-tag">{tx('eu')}</i>}{casual && <Fmt f={P[s.i]?.format} />}{rei && t.hill?.king === s.i && <span title={tx('Rei da colina')}> 👑</span>}</span></td><td><b>{rei ? s.best : s.pts}</b></td>
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
        <h4>{tx('Classificação das equipas')}</h4>
        <table className="lab-table ts-table"><thead><tr><th>#</th><th>{tx('Equipa')}</th><th>{tx('Pts')}</th><th>{tx('V-D-E')}</th><th title={tx('Tabuleiros ganhos–perdidos')}>{tx('Tabuleiros')}</th></tr></thead>
          <tbody>{(t.teams || []).map((r, k) => (
            <tr key={r.t} className={`${t.champion != null && r.p.includes(t.champion) ? 'champ-row' : ''} ${r.p.includes(me) ? 'me-row' : ''}`}><td>{k + 1}</td>
              <td><b>{team(r.t)}</b><div style={{ display: 'grid', gap: 3, marginTop: 3 }}>{r.p.map(i => <span key={i} className="ts-name small"><Thumb data={data} p={P[i]} /> {P[i]?.name}{i === me && <i className="me-tag">{tx('eu')}</i>}</span>)}</div></td>
              <td><b>{r.pts}</b></td><td>{r.v}-{r.d}-{r.e}</td><td>{r.bw}–{r.bl}</td></tr>
          ))}</tbody></table>
      </section>
      <section className="card">
        <h4>{tx('Rondas')}</h4>
        {tms.map(bs => {
          const [a, b] = bs[0].p.map(i => Math.floor(i / s))
          return (
            <div key={bs[0].tm} className="tr-round"><h5>{tx('Ronda {r}', { r: bs[0].r })} · {team(a)} <b>{won(bs, a)}–{won(bs, b)}</b> {team(b)}</h5>
              <div className="tr-ms">{bs.map((m, k) => <Match key={m.id} m={m} {...tools} label={tx('Tabuleiro {b}', { b: k + 1 })} />)}</div>
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
            <span className="pd-sub">{x.i === t.me && <i className="me-tag">{tx('eu')}</i>}{t.casual && <Fmt f={x.format} />}{s1 ? <small className="muted">{tx('{v}V {d}D', { v: s1.v, d: s1.d })}{s1.e ? ` ${tx('{e}E', { e: s1.e })}` : ''}</small> : null}</span>
          </div>
        )
      })}</div>
      <div className="pd-block"><span>{MEDAL[n - 1]}</span><b>{tx('{p}.º', { p: n })}</b></div>
    </div>
  )
  return (
    <section className="card podium">
      <div className="champ-sparks" aria-hidden="true">{Array.from({ length: 14 }, (_, k) => <i key={k} style={{ '--k': k }} />)}</div>
      <h3>{tx('Pódio')} <span className="muted small">{t.name}</span></h3>
      <div className="pd-row">{step(2)}{step(1)}{step(3)}</div>
    </section>
  )
}

// ---------- registo ----------

function Registry({ data, list, open, reload }) {
  const del = async x => { if (!(await ask('torneio', { title: tx('Apagar o torneio «{t}» e todos os jogos dele?', { t: x.name }), ok: tx('Apagar') }))) return; await j(`/api/tournaments/${x.id}`, { method: 'DELETE' }); reload() }
  return (
    <div className="reg-grid">
      <section className="card">
        <h3>{tx('Registo de torneios')} <span className="muted small">{list.length}</span></h3>
        {!list.length && <p className="muted">{tx('Ainda não há torneios. Cria um em «✦ Criar».')}</p>}
        <ul className="lib-list tour-reg">{list.map(x => (
          <li key={x.id}>
            <span className={`tl-status ${x.status}`}>{STATUS[x.status] || x.status}</span>
            <span><b>{x.name}</b><br /><small className="muted"><TypeIco k={x.type} /> {TYPES[x.type]?.[0]} · {x.casual ? tx('casual, regras de {f}', { f: FORMAT[x.format]?.name || x.format }) : FORMAT[x.format]?.name || x.format} · {x.n} decks · {when(x.ts)}</small></span>
            {x.podium?.length ? <span className="mini-pod">{x.podium.map(p => (
              <span key={p.i} className={`mp mp-${p.place} ${p.me ? 'me' : ''} ${p.src === 'meus' ? 'go' : ''}`} title={`${tx('{p}.º', { p: p.place })} ${p.name}${p.me ? ` (${tx('o meu deck')})` : ''}${p.src === 'meus' ? ` · ${tx('Abrir na Biblioteca')}` : ''}`}
                {...(p.src === 'meus' ? { role: 'button', tabIndex: 0, onClick: () => showDeck(p.ref), onKeyDown: e => { if (e.key === 'Enter') showDeck(p.ref) } } : {})}><Thumb data={data} p={p} /><i>{MEDAL[p.place - 1]}</i><span>{p.name}</span></span>
            ))}</span> : <span className="muted small">{tx('sem pódio')}</span>}
            <span className="row-btns"><button onClick={() => open(x.id)}>{tx('Abrir')}</button><button className="link small" onClick={() => del(x)}>{tx('apagar')}</button></span>
          </li>
        ))}</ul>
      </section>
      <Fame data={data} list={list} />
    </div>
  )
}

// hall da fama: títulos e pódios por deck (os meus e os do meta), por formato do torneio ou só os casuais
function Fame({ data, list }) {
  const [f, setF] = useState('')
  const [who, setWho] = useState('todos')
  const fmts = [...new Set(list.filter(x => x.podium && !x.old && !x.casual).map(x => x.format))]  // old: de antes de repor os troféus
  const rows = {}
  for (const x of list) if (x.podium && !x.old && (!f || (f === 'casual' ? x.casual : !x.casual && x.format === f))) for (const p of x.podium) {
    const r = (rows[`${p.src}:${p.ref}`] ||= { ...p, m: [0, 0, 0], med: [] })
    r.m[p.place - 1]++
    r.med.push({ tier: tierOf(p.place, x.champions), casual: !!x.casual || x.ranked === false, tid: x.id, place: p.place, kind: x.type, name: x.name, n: x.n, m: x.m })
  }
  // troféus dos meus decks que já não contam (a lista mudou mais de 10% desde o torneio): ficam a cinzento na galeria
  const [tro, setTro] = useState({})
  useEffect(() => { fetch('/api/tournaments/trophies').then(r => (r.ok ? r.json() : {})).then(setTro).catch(() => {}) }, [])
  const top = Object.values(rows).filter(r => who === 'todos' || (who === 'meus') === (r.src === 'meus'))
    .sort((a, b) => b.m[0] - a.m[0] || b.m[1] - a.m[1] || b.m[2] - a.m[2] || a.name.localeCompare(b.name))
  // galeria: filtros (lugar/cor e tipo de torneio) e ordem (valor, quantidade, nome) próprios
  const [gTier, setGTier] = useState(''), [gKind, setGKind] = useState(''), [gSort, setGSort] = useState('valor'), [gInfo, setGInfo] = useState(false)
  const offOf = (r, m) => r.src === 'meus' && (tro[r.ref] || []).some(t => t.tid === m.tid && t.place === m.place && !t.valid)
  const keepM = m => (!gKind || m.kind === gKind) && (!gTier || (gTier === 'azul' ? m.casual : gTier === 'normal' ? !m.casual : String(m.tier) === gTier))
  const gal = top.map(r => { const med = r.med.filter(keepM), ok = med.filter(m => !offOf(r, m)); return { r, med, val: ok.reduce((a, m) => a + trophyValue(m), 0), n: ok.length, all: r.med.filter(m => !offOf(r, m)).reduce((a, m) => a + trophyValue(m), 0), blue: r.med.filter(m => !offOf(r, m) && m.casual).reduce((a, m) => a + trophyValue(m), 0) } })
    .filter(x => x.med.length)
    .sort((a, b) => (gSort === 'nome' ? a.r.name.localeCompare(b.r.name) : gSort === 'quantidade' ? b.n - a.n || b.val - a.val : b.val - a.val || b.n - a.n))
  const kinds = [...new Set(top.flatMap(r => r.med.map(m => m.kind)))].filter(Boolean)
  return (
    <>
    <section className="card fame">
      <h3>{tx('🏛 Hall da fama')}</h3>
      <div className="row-btns">
        <select value={f} onChange={e => setF(e.target.value)} aria-label={tx('Formato')}><option value="">{tx('Todos os formatos')}</option>{fmts.map(k => <option key={k} value={k}>{FORMAT[k]?.name || k}</option>)}{list.some(x => x.casual && x.podium) && <option value="casual">{tx('Casuais')}</option>}</select>
        <span className="seg">{[['todos', tx('Todos')], ['meus', tx('Os meus')], ['meta', tx('Do meta')]].map(([k, l]) => <button key={k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{l}</button>)}</span>
      </div>
      {!top.length ? <p className="muted small">{f ? tx('Ainda ninguém subiu ao pódio neste formato.') : tx('Ainda ninguém subiu ao pódio.')}</p> : (
        <table className="lab-table ts-table"><thead><tr><th>Deck</th><th title={tx('Torneios ganhos')}>🥇</th><th>🥈</th><th>🥉</th><th>{tx('Pódios')}</th></tr></thead>
          <tbody>{top.map(r => (
            <tr key={`${r.src}:${r.ref}`} className={r.src === 'meus' ? 'me-row' : ''}><td><span className="ts-name">{r.src === 'meus' ? <button className="pd-open sm" onClick={() => showDeck(r.ref)} title={tx('Abrir na Biblioteca')}><Thumb data={data} p={r} /></button> : <Thumb data={data} p={r} />} {r.name}{r.src === 'meus' && <i className="me-tag">{tx('meu')}</i>}</span></td>
              <td><b>{r.m[0] || '—'}</b></td><td>{r.m[1] || '—'}</td><td>{r.m[2] || '—'}</td><td>{r.m[0] + r.m[1] + r.m[2]}</td></tr>
          ))}</tbody></table>
      )}
    </section>
      {top.length > 0 && <section className="card fg-sec">
        <h3>{tx('Galeria de troféus')} <span className="muted small">{tx('segue os filtros do hall da fama')}</span> <button className="link small" onClick={() => setGInfo(v => !v)}>ⓘ {tx('Valor dos troféus')}</button></h3>
        {gInfo && <div className="fg-info small">
          <p className="muted">{tx('Valor = pontos do lugar × peso do tipo × jogadores (√(decks ÷ 8), ×0,6 a ×1,6) × duração no rei da colina, suíço e mesas (partidas jogadas ÷ típicas, ×0,5 a ×1,5); os azuis (casual ou não ranked) valem metade ({w}).', { w: `×${BLUE_W}` })}</p>
          <div className="fg-tab"><span>{TIERS.map(t => <i key={t}><Cup place={t} /> {PLACE[t].split(':')[0]} <b>{TIER_PTS[t]}</b></i>)}</span>
            <span>{Object.entries(KIND_W).sort((a, b) => b[1] - a[1]).map(([k, w]) => <i key={k}><Cup place={1} kind={k} /> {KIND[k]} <b>×{w}</b></i>)}</span>
            <span>{tx('Estrelas brancas (dos pontos de cada deck):')} {[1, 2, 3, 4, 5, 6].map(k => <i key={k}>{k}★ <b>{starPoints(k)}</b></i>)}</span></div>
        </div>}
        <p className="fg-note small"><Cup place={1} casual /> {tx('Os troféus azuis vêm de torneios casuais ou não ranked (menos de 20% de decks do meta) e valem metade dos pontos. Os pontos de cada deck somam todos os troféus que contam, e as estrelas brancas vêm desse total.')}</p>
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
        <div className="fame-gal">{gal.slice(0, 40).map(({ r, med, val, all, blue }) => {
          const off = m => offOf(r, m)
          const g = {}
          for (const m of med) { const k = `${m.tier}|${m.kind}|${m.casual}|${off(m)}`; const e = (g[k] ||= { ...m, off: off(m), n: 0, names: [], pts: 0 }); e.n++; e.names.push(m.name); e.pts += off(m) ? 0 : trophyValue(m) }
          const cups = Object.values(g).sort((a, b) => a.off - b.off || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.casual - b.casual)
          const body = <><Thumb data={data} p={r} /><b title={r.name}>{r.name}</b><small className="fg-val" title={tx('Valor dos troféus')}>{val} {tx('pts')}</small>
            <WhiteStars v={trophyStars(all)} title={`${tx('Estrelas brancas: {s} — vêm dos {p} pontos de todos os troféus que contam ({k} pontos = 6★; ⓘ Valor dos troféus)', { s: trophyStars(all).toLocaleString(LOCALE), p: all, k: starPoints(6) })}${blue ? `\n${tx('{a} normais (ranked) + {b} de troféus azuis (casual ou não ranked, valem metade)', { a: all - blue, b: blue })}` : ''}`} />
            <span className="fg-cups">{cups.map(c => <span key={`${c.tier}${c.kind}${c.casual}${c.off}`} className="fg-cup" title={`${PLACE[c.tier]} · ${KIND[c.kind] || ''}${c.casual ? ` · ${tx('troféu azul: casual ou não ranked')}` : ''}${c.off ? ` · ${tx('não conta: a lista mudou mais de 10%')}` : ''} · ${tx('+{p} pontos', { p: c.pts })}\n${c.names.slice(0, 6).map(nm => `• ${nm}`).join('\n')}${c.names.length > 6 ? `\n+${c.names.length - 6}` : ''}`}><Cup place={c.tier} casual={c.casual} off={c.off} kind={c.kind} />{c.n > 1 && <small>×{c.n}</small>}</span>)}</span></>
          return r.src === 'meus' ? <button key={`${r.src}:${r.ref}`} className="fg-card me" onClick={() => showDeck(r.ref)} title={tx('Abrir na Biblioteca')}>{body}</button>
            : <div key={`${r.src}:${r.ref}`} className="fg-card">{body}</div>
        })}</div>
      </section>}
    </>
  )
}
