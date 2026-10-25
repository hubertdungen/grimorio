import Home from './Home.jsx'
import Mesa from './Mesa.jsx'
import ProxyDialog from './Proxies.jsx'
import CardScan from './CardScan.jsx'
import Rules from './Rules.jsx'
import { ask, confirmOn, casualAsk } from './confirm.jsx'
import DeckPicker from './DeckPicker.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadData, fmtBit, TYPES, TYPE_LABEL, img, pidOf, importExtras, BASICS, basicList } from './data.js'
import { FORMATS, FORMAT, validate, maxCopies, canBeCommander, fixFormat } from './formats.js'
import { emptyDeck, count, parseList, exportList, sourceOf } from './deck.js'
import { Logo, Mana } from './ui.jsx'
import { SearchView, SuggestView, MapView, CombosView, AnalysisView, CardModal, AutoBuildDialog, AIDialog, DeckGrid, ArtPicker, showCardPeek, hideCardPeek, flipCardPeek, peekOpen, BasicBar } from './Views.jsx'
import DraftView from './Draft.jsx'
import NewDeckWizard from './Wizard.jsx'
import LabView from './Lab.jsx'
import { useRun } from './labrun.js'
import PlayView from './Play.jsx'
import TournamentView from './Tournament.jsx'
import RatingsView from './Ratings.jsx'
import { loadGames } from './tests.js'
import { gameEvidence, applySwap } from './swap.js'
import Library from './Library.jsx'
import { similarity } from './DeckCompare.jsx'
import './index.css'
import { tx, LOCALE } from './i18n.js'
import Settings from './Settings.jsx'
import { WhoPlays, ProfileChip } from './Profiles.jsx'

const TABS = [['pesquisa', tx('Pesquisa')], ['sugestoes', tx('Sugestões')], ['universo', tx('Universo')], ['combos', tx('Combos')], ['analise', tx('Análise')], ['teste', tx('Teste')], ['draft', tx('Draft')]]
const SECTIONS = [['construir', '✎', tx('Construir')], ['biblioteca', '▤', tx('Biblioteca')], ['coliseu', '⚔', tx('Coliseu')], ['regras', '📖', tx('Regras')]]
const ZONE_L = { main: tx('deck'), side: tx('sideboard'), maybe: tx('maybeboard') }
// Desfazer: só o conteúdo do deck (nome, notas, formato, preferências e sementes ficam de fora)
const CONTENT = ['main', 'side', 'maybe', 'commanders', 'signature', 'prints', 'cover', 'coverImg']
const snapOf = d => Object.fromEntries(CONTENT.map(k => [k, d[k]]))
const norm = v => JSON.stringify(v && typeof v === 'object' && !Object.keys(v).length ? null : v ?? null)
// o que mudou: as cartas com outra quantidade («main:Bolt») e os outros campos; '' = nada
function changed(a, b) {
  const out = []
  for (const k of CONTENT) {
    if (a[k] === b[k]) continue
    if (k === 'main' || k === 'side' || k === 'maybe') {
      const x = a[k] || {}, y = b[k] || {}
      for (const n of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[n] !== y[n]) out.push(`${k}:${n}`)
    } else if (norm(a[k]) !== norm(b[k])) out.push(k)
  }
  return out.join('|')
}
const UndoBtns = ({ act, hist }) => (
  <span className="undo-btns">
    <button onClick={act.undo} disabled={!hist[0]} title={tx('Desfazer (Ctrl+Z)')}>↶ {tx('Desfazer')}</button>
    <button onClick={act.redo} disabled={!hist[1]} title={tx('Refazer (Ctrl+Shift+Z)')}>↷ {tx('Refazer')}</button>
  </span>
)
const GROUP_L = { Outras: tx('Outras'), Desconhecidas: tx('Desconhecidas') }
const store = { get: k => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem storage */ } } }

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `HTTP ${r.status}`)
  return r.json()
}

// «⇄ mover para»: menu próprio (o select nativo ficava ilegível); fecha ao escolher ou ao tocar fora
function MoveMenu({ label, to, onMove }) {
  const ref = useRef(null)
  useEffect(() => {
    const f = e => { if (ref.current?.open && !ref.current.contains(e.target)) ref.current.open = false }
    document.addEventListener('pointerdown', f); return () => document.removeEventListener('pointerdown', f)
  }, [])
  return (
    <details className="mvmenu" ref={ref}>
      <summary className="mv" aria-label={label} title={tx('Mover para…')}>⇄</summary>
      <div className="mvmenu-list" role="menu">{to.map(z => <button key={z} role="menuitem" onClick={() => { ref.current.open = false; onMove(z) }}>→ {ZONE_L[z]}</button>)}</div>
    </details>
  )
}

// básicos: cada cópia nova fica com uma das artes favoritas (Definições › Terrenos básicos) ao acaso, se o deck não
// escolheu a sua; ao tirar, a divisão por artes encolhe para o total
function withBasicArt(d, n, q) {
  if (!q || !BASICS.includes(n) || d.prints?.[n] || d.art?.[n]) return d
  const favs = basicList(n), l = (d.split?.[n] || []).map(x => ({ ...x }))
  if (favs.length < 2 && !l.length) return d
  for (let k = 0; k < q && favs.length > 1; k++) {
    const id = favs[Math.floor(Math.random() * favs.length)].id, e = l.find(x => x.id === id)
    if (e) e.q++; else l.push({ id, q: 1 })
  }
  let over = l.reduce((a, x) => a + x.q, 0) - ((d.main[n] || 0) + (d.side[n] || 0))
  for (let k = l.length - 1; k >= 0 && over > 0; k--) { const t = Math.min(l[k].q, over); l[k].q -= t; over -= t }
  const split = { ...(d.split || {}) }, left = l.filter(x => x.q > 0)
  if (left.length) split[n] = left; else delete split[n]
  return { ...d, split }
}

// o que está a decorrer agora (testes do Laboratório, torneios, Arena): uma barra fina por baixo do cabeçalho, só
// quando há alguma coisa, e cada ficha leva ao visualizador em direto
function LiveBar({ guest, go }) {
  const [lab] = useRun('busy'), [labDeck] = useRun('deckName')
  const [tour, setTour] = useState([]), [arena, setArena] = useState(null)
  useEffect(() => {
    let off = false
    const tick = () => {
      fetch('/api/tournaments').then(r => (r.ok ? r.json() : [])).then(l => { if (!off) setTour((Array.isArray(l) ? l : []).filter(t => t.status === 'running')) }).catch(() => {})
      if (!guest) fetch('/api/arena').then(r => (r.ok ? r.json() : null)).then(a => { if (!off) setArena(a?.on && a.cur?.a ? a.cur : null) }).catch(() => {})
    }
    tick(); const t = setInterval(tick, 30000)
    return () => { off = true; clearInterval(t) }
  }, [guest])
  const [full, setFull] = useState(false)  // em ecrã inteiro (Coliseu, jogo) a barra sai do caminho
  useEffect(() => {
    const f = () => setFull(!!(document.fullscreenElement || document.webkitFullscreenElement))
    document.addEventListener('fullscreenchange', f); document.addEventListener('webkitfullscreenchange', f)
    return () => { document.removeEventListener('fullscreenchange', f); document.removeEventListener('webkitfullscreenchange', f) }
  }, [])
  if (full || (!lab && !tour.length && !arena)) return null
  return (<>
    <div className="live-bar-pad" aria-hidden="true" />
    <div className="live-bar" role="status">
      <span className="live-dot" aria-hidden="true" />
      {lab && <button onClick={() => go('bots')} title={tx('Ver os testes ao vivo')}>🧪 {tx('Laboratório')} · {labDeck ? `${labDeck} · ` : ''}{lab}</button>}
      {tour.map(t => <button key={t.id} onClick={() => { try { localStorage.setItem('grimorio.torneio', t.id) } catch { /* sem armazenamento */ } go('torneio') }} title={tx('Ver o torneio')}>🏆 {t.name}</button>)}
      {arena && <button onClick={() => go('ratings')} title={tx('Ver a Arena ao vivo')}>⚔ {tx('Arena')} · {arena.a} {tx('contra')} {arena.b} · {arena.wa}–{arena.wb}</button>}
    </div>
  </>)
}

export default function App() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [decks, setDecks] = useState([])
  const [deck, setDeckRaw] = useState(emptyDeck())
  const [tab, setTab] = useState(() => store.get('grimorio.tab') || 'pesquisa')
  const [open, setOpen] = useState(null)
  const [focus, setFocus] = useState(null)
  const [toast, setToast] = useState(null)
  const [saveState, setSaveState] = useState('')
  const [sugTag, setSugTag] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showAuto, setShowAuto] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  // página inicial só na 1.ª abertura da sessão do browser: um F5 volta ao sítio onde se estava
  const [home, setHome] = useState(() => { try { return !window.location.hash.startsWith('#importar=') && !sessionStorage.getItem('grimorio.dentro') } catch { return true } })
  useEffect(() => { if (!home) try { sessionStorage.setItem('grimorio.dentro', '1') } catch { /* sem armazenamento */ } }, [home])
  // contador de vida e dados (ecrã próprio, aberto do início); o F5 volta a ele
  const [tool, setToolS] = useState(() => { try { return sessionStorage.getItem('grimorio.mesa') || null } catch { return null } })
  const setTool = t => { setToolS(t); try { if (t) sessionStorage.setItem('grimorio.mesa', t); else sessionStorage.removeItem('grimorio.mesa') } catch { /* sem armazenamento */ } }
  const [showRefresh, setShowRefresh] = useState(false)
  const [section, setSectionRaw] = useState(() => store.get('grimorio.section') || 'construir')
  const setSection = x => { setSectionRaw(x); store.set('grimorio.section', x) }
  const coliseuRef = useRef(null)
  const [colMode, setColModeS] = useState(() => store.get('grimorio.colMode') || 'bots')  // bots a testar | jogar contra o Forge | torneio | ratings
  const setColMode = m => { setColModeS(m); store.set('grimorio.colMode', m) }
  const [fromState, setFromState] = useState(null)
  const playFrom = st => { setFromState(st); setColMode('jogar'); setSection('coliseu') }
  // ecrã inteiro: API normal ou a do Safari (iPad); no Android prende a rotação em paisagem enquanto durar
  const fullscreen = () => {
    const el = coliseuRef.current, d = document
    if (!el) return
    if (d.fullscreenElement || d.webkitFullscreenElement) return (d.exitFullscreen || d.webkitExitFullscreen).call(d)
    Promise.resolve((el.requestFullscreen || el.webkitRequestFullscreen)?.call(el))
      .then(() => { el.scrollTop = 0; return screen.orientation?.lock?.('landscape') }).catch(() => {})
  }
  // da Biblioteca/Teste para outra área
  const goTab = t => { if (t === 'teste' || t === 'coliseu') return setSection('coliseu'); setSection('construir'); setTab(t) }
  const [artCard, setArtCard] = useState(null)
  const [scan, setScan] = useState(false)  // ler carta pela câmara (CardScan)
  // favorito do TappedOut: abre o Grimório com #importar=<links>
  const [importLinks] = useState(() => {
    const h = window.location.hash
    if (!h.startsWith('#importar=')) return ''
    history.replaceState(null, '', window.location.pathname)
    return decodeURIComponent(h.slice(10))
  })
  useEffect(() => { if (importLinks) setSection('biblioteca') }, [importLinks]) // eslint-disable-line react-hooks/exhaustive-deps
  // um deck clicado noutro sítio (pódio dos torneios, hall da fama) abre-se na Biblioteca, com o cartão em destaque
  const [libFocus, setLibFocus] = useState(null)
  useEffect(() => {
    const h = e => { setHome(false); setSection('biblioteca'); setLibFocus({ id: e.detail, n: Date.now() }) }
    window.addEventListener('grimorio:deck', h)
    return () => window.removeEventListener('grimorio:deck', h)
  }, [])
  const [deckView, setDeckViewRaw] = useState(() => store.get('grimorio.deckView') || 'grelha')
  const setDeckView = v => { setDeckViewRaw(v); store.set('grimorio.deckView', v) }
  const dirty = useRef(false)
  // perfis (edições sem login) e Definições (#definicoes: o ⚙ do cabeçalho, a página inicial e o Laboratório abrem-nas)
  const [prof, setProf] = useState(null)
  const [who, setWho] = useState('')  // '' | 'switch' | 'new': «Quem vai jogar?» por cima da app
  const guest = prof?.mode === 'guest'  // entrou por um convite (guests.py): só os decks dele, torneios e ratings
  useEffect(() => {
    fetch('/api/profiles').then(r => r.json()).then(setProf).catch(() => {})
    const lost = () => setProf(p => (p?.mode === 'profiles' ? { ...p, current: null } : p))  // um pedido respondeu 401 «profile»
    window.addEventListener('grimorio:profile', lost)
    return () => window.removeEventListener('grimorio:profile', lost)
  }, [])
  const [settings, setSettings] = useState(() => window.location.hash === '#definicoes')
  useEffect(() => {
    const h = () => setSettings(window.location.hash === '#definicoes')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const closeSettings = () => { history.replaceState(null, '', window.location.pathname); setSettings(false) }

  // undo = o aviso leva «Desfazer» (mudanças ao deck)
  const say = useCallback((msg, undo = false) => { setToast({ msg, undo }); clearTimeout(say.t); say.t = setTimeout(() => setToast(null), undo ? 4500 : 2600) }, [])
  const setDeck = useCallback(fn => { dirty.current = true; setDeckRaw(fn) }, [])

  // Histórico do deck: cada mudança de conteúdo guarda o estado anterior (até 50); cliques seguidos na mesma carta
  // (< 600 ms) contam como um passo; abrir outro deck limpa (um deck novo com cartas, do assistente, desfaz para vazio).
  const hist = useRef({ past: [], future: [], prev: null, key: '', t: 0, nav: false })
  const [histN, setHistN] = useState([0, 0])
  useEffect(() => {
    const h = hist.current, prev = h.prev
    h.prev = deck
    if (h.nav || !prev) { h.nav = false; return }
    const key = changed(prev, deck)
    if (prev.id !== deck.id && (prev.id || key)) {
      h.past = !deck.id && changed(emptyDeck(), deck) ? [snapOf(emptyDeck())] : []
      h.future = []; h.key = ''
    } else {
      if (!key) return
      const now = Date.now()
      if (key !== h.key || now - h.t > 600) h.past = [...h.past, snapOf(prev)].slice(-50)
      h.key = key; h.t = now; h.future = []
    }
    setHistN([h.past.length, h.future.length])
  }, [deck])
  const travel = useCallback(back => {
    const h = hist.current, from = back ? h.past : h.future, to = back ? h.future : h.past
    if (!from.length || !h.prev) return
    const snap = from.pop()
    to.push(snapOf(h.prev))
    h.nav = true; h.key = ''; dirty.current = true
    setDeckRaw(d => ({ ...d, ...snap }))
    setHistN([h.past.length, h.future.length])
    say(back ? tx('Desfeito') : tx('Refeito'))
  }, [say])
  const undo = useCallback(() => travel(true), [travel])
  const redo = useCallback(() => travel(false), [travel])
  useEffect(() => { // Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z na construção, fora das caixas de texto
    if (section !== 'construir') return
    const k = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'z' || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault(); travel(!e.shiftKey)
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [section, travel])

  useEffect(() => { loadData().then(setData).catch(e => setErr(e.message)) }, [])
  useEffect(() => {
    api('/api/decks').then(list => {
      setDecks(list)
      const last = store.get('grimorio.deck')
      if (last && list.some(d => d.id === last)) api(`/api/decks/${last}`).then(d => setDeckRaw({ ...emptyDeck(), ...d }))
    }).catch(() => {})
  }, [])
  useEffect(() => { store.set('grimorio.tab', tab) }, [tab])

  // Ratings presos à lista: deck.rated = a lista com que ganhou os ratings (do servidor). Aos 7% de mudança avisa; aos 10%
  // os ratings recomeçam do zero ao gravar, por isso a gravação espera pela escolha: desfazer ou continuar.
  const chg = useMemo(() => (deck.rated?.list ? 1 - similarity(data, deck.rated.list, deck) : 0), [data, deck])
  const [okReset, setOkReset] = useState(false)
  const block = chg >= 0.1 && !okReset
  const warned = useRef(false)
  useEffect(() => { setOkReset(false); warned.current = false }, [deck.id])
  useEffect(() => {
    if (chg < 0.05) warned.current = false
    else if (chg >= 0.07 && chg < 0.1 && !warned.current) {
      warned.current = true
      say(tx('Atenção: a lista já mudou {p} desde que ganhou os ratings. A 10% os ratings recomeçam do zero.', { p: `${Math.round(chg * 100)}%` }), true)
    }
  }, [chg, say])

  // Gravação automática (cria o deck no servidor à primeira alteração).
  useEffect(() => {
    if (!dirty.current) return
    if (block) return setSaveState(tx('à espera da tua escolha'))
    setSaveState(tx('a guardar…'))
    const t = setTimeout(async () => {
      try {
        const body = JSON.stringify({ ...deck, count: count(deck.main) + deck.commanders.length })
        const saved = deck.id ? await api(`/api/decks/${deck.id}`, { method: 'PUT', body }) : await api('/api/decks', { method: 'POST', body })
        dirty.current = false
        if (!deck.id) setDeckRaw(d => ({ ...d, id: saved.id }))
        if (saved.rated_reset) { setDeckRaw(d => ({ ...d, rated: undefined })); setOkReset(false); say(tx('Os ratings deste deck recomeçaram do zero: a lista mudou mais de 10%.')) }
        store.set('grimorio.deck', saved.id)
        setSaveState(tx('guardado'))
        api('/api/decks').then(setDecks).catch(() => {})
      } catch (e) { setSaveState(tx('erro ao guardar: {e}', { e: e.message })) }
    }, 700)
    return () => clearTimeout(t)
  }, [deck, block]) // eslint-disable-line react-hooks/exhaustive-deps

  // Jogos do deck (Laboratório e torneios): entram nas sugestões e nos cortes; o Lab pede para recarregar ao guardar.
  const [tests, setTests] = useState(null)
  const [testsN, setTestsN] = useState(0)
  useEffect(() => {
    let off = false
    if (data && deck.id) loadGames(deck.id).then(g => { if (!off) setTests({ id: deck.id, t: gameEvidence(data, g) }) }).catch(() => {})
    return () => { off = true }
  }, [data, deck.id, testsN])
  const deckTests = tests?.id === deck.id ? tests.t : null

  const fmt = FORMAT[deck.format] || FORMAT.casual
  const ctx = useMemo(() => {
    if (!data) return null
    const cmd = deck.commanders.map(n => data.byName.get(n)).filter(Boolean)
    if (deck.casual) return { bit: -1, identity: null, allowUn: true, tests: deckTests }  // deck casual: qualquer carta
    return { bit: fmtBit(data, fmt), identity: fmt.cmd && cmd.length ? cmd.map(c => c.ci).join('') : null, allowUn: fmt.key === 'casual', tests: deckTests }
  }, [data, fmt, deck.commanders, deck.casual, deckTests])

  const add = useCallback((c, zone = 'main', q = 1) => {
    const lim = maxCopies(c, fmt, fmtBit(data, fmt))
    setDeck(d => {
      const have = (d.main[c.n] || 0) + (d.side[c.n] || 0) + (d.commanders.includes(c.n) ? 1 : 0)
      if (q > 0 && zone !== 'maybe' && have + q > lim) { say(tx('{card}: limite de {lim} em {fmt}.', { card: c.n, lim, fmt: fmt.name })); return d }
      const z = { ...(d[zone] || {}) }
      z[c.n] = (z[c.n] || 0) + q
      if (z[c.n] <= 0) delete z[c.n]
      return withBasicArt({ ...d, [zone]: z }, c.n, zone === 'maybe' ? 0 : q)
    })
    say(q > 0 ? `${c.n} → ${ZONE_L[zone]}` : `${c.n} −${-q} (${ZONE_L[zone]})`, true)
  }, [data, fmt, setDeck, say])
  // mover todas as cópias entre deck, sideboard e maybeboard (a legalidade só olha para o deck e o sideboard)
  const move = useCallback((c, from, to) => setDeck(d => {
    const a = { ...(d[from] || {}) }, b = { ...(d[to] || {}) }, q = a[c.n] || 0
    if (!q) return d
    delete a[c.n]; b[c.n] = (b[c.n] || 0) + q
    return { ...d, [from]: a, [to]: b }
  }), [setDeck])

  const setCommander = useCallback(c => {
    if (!canBeCommander(c, fmt)) say(tx('Atenção: {card} não costuma poder ser comandante em {fmt}.', { card: c.n, fmt: fmt.name }))
    setDeck(d => {
      if (d.commanders.includes(c.n)) return { ...d, commanders: d.commanders.filter(n => n !== c.n) }
      const main = { ...d.main }; delete main[c.n]
      return { ...d, main, commanders: [...d.commanders, c.n].slice(-2) }
    })
  }, [fmt, setDeck, say])

  const toggleSeed = useCallback(c => setDeck(d => ({ ...d, seeds: d.seeds.includes(c.n) ? d.seeds.filter(n => n !== c.n) : [...d.seeds, c.n] })), [setDeck])
  const toggleSeedTerm = useCallback(t => setDeck(d => { const l = d.seedTerms || [], has = l.some(x => x.k === t.k && x.v === t.v); return { ...d, seedTerms: has ? l.filter(x => !(x.k === t.k && x.v === t.v)) : [...l, { k: t.k, v: t.v }] } }), [setDeck])
  const setPrefs = useCallback(p => setDeck(d => ({ ...d, prefs: { ...(d.prefs || {}), ...p } })), [setDeck])
  const setSignature = useCallback(c => setDeck(d => ({ ...d, signature: d.signature === c.n ? null : c.n })), [setDeck])
  // Estilo alternativo: print = {id, set, cn, ...} ou null para voltar à predefinida.
  const setPrint = useCallback((c, print) => setDeck(d => {
    const prints = { ...(d.prints || {}) }, art = { ...(d.art || {}) }
    if (print) prints[c.n] = print; else delete prints[c.n]
    delete art[c.n]  // escolher outra arte larga a do site
    return { ...d, prints, art }
  }), [setDeck])

  // imagem própria de uma carta (link ou carregada): fica em deck.art e ganha à edição escolhida; url vazio tira-a
  // cópias divididas por várias artes (ex.: 4 Islands de uma edição, 4 de outra): [{id, q}]; lista vazia volta a uma só arte
  const setSplit = useCallback((n, list) => setDeck(d => { const split = { ...(d.split || {}) }; if (list?.length) split[n] = list; else delete split[n]; return { ...d, split } }), [setDeck])
  const setArt = useCallback((n, url) => setDeck(d => { const art = { ...(d.art || {}) }; if (url) art[n] = url; else delete art[n]; return { ...d, art } }), [setDeck])
  // tirar cópias à mão (− e ×): pergunta antes de tirar a última (em formatos de uma cópia só se assim estiver nas Definições)
  const now = useRef({}); now.current = { deck, fmt }
  const remove = useCallback(async (c, zone, q) => {
    const { deck: d, fmt: f } = now.current, left = (d[zone]?.[c.n] || 0) - q
    if (zone !== 'maybe' && left <= 0 && (f.copies !== 1 || confirmOn('ultimaSingleton'))
      && !(await ask('ultima', { title: tx('Tirar «{c}» do deck?', { c: c.n }), body: tx('Era a última cópia. Podes desfazer com ↶.'), ok: tx('Tirar') }))) return
    add(c, zone, -q)
  }, [add])
  const act = useMemo(() => ({ add, remove, move, setCommander, toggleSeed, toggleSeedTerm, setSignature, setPrint, setArt, setSplit, setPrefs, open: setOpen, say, pickArt: setArtCard, scan: () => setScan(true),
    showOnMap: c => { setFocus(c.i); setTab('universo'); setOpen(null) },
    suggestFor: t => { setSugTag(t); setTab('sugestoes') }, refreshTests: () => setTestsN(n => n + 1),
    swap: (c, o) => { setDeck(d => applySwap(d, c.n, o.out, o.q)); say(tx('Trocado {a} por {b}', { a: `${o.q}× ${o.out}`, b: c.n }), true) }, undo, redo }),
  [add, remove, move, setCommander, toggleSeed, toggleSeedTerm, setSignature, setPrint, setArt, setSplit, setPrefs, say, setDeck, undo, redo])

  const newDeck = () => { dirty.current = false; setDeckRaw(emptyDeck(deck.format)); store.set('grimorio.deck', ''); setSaveState('') }
  const openDeck = async id => {
    if (!id) return setShowWizard(true)
    const d = await api(`/api/decks/${id}`)
    dirty.current = false
    setDeckRaw({ ...emptyDeck(), ...d }); store.set('grimorio.deck', id); setSaveState('')
  }
  const delDeck = async () => {
    if (!deck.id || !(await ask('apagar', { title: tx('Eliminar «{name}»?', { name: deck.name }), body: tx('Fica 30 dias no lixo da Biblioteca.'), ok: tx('Eliminar') }))) return
    await api(`/api/decks/${deck.id}`, { method: 'DELETE' })
    setDecks(ds => ds.filter(x => x.id !== deck.id))
    newDeck()
  }

  if (prof?.mode === 'profiles' && (!prof.current || who)) return <WhoPlays list={prof.list} startNew={who === 'new'} onClose={prof.current ? () => setWho('') : null} />
  if (settings && !guest) return <Settings prof={prof} onClose={closeSettings} onSwitch={() => setWho('switch')} onNew={() => setWho('new')} />
  if (err) return <div className="boot"><Logo size={64} /><p>{tx('Não consegui carregar os dados: {err}', { err })}</p><p className="muted">{tx('Os dados são gerados por')} <code>build/build.sh</code>.</p></div>
  if (!data) return <div className="boot"><Logo size={64} /><div className="spinner" /><p>{tx('A abrir o grimório…')} <span className="muted">{tx('(34 mil cartas, ~10 MB)')}</span></p></div>

  // deck casual: as regras do formato não o impedem de nada; os erros passam a informação
  const issues = validate(deck, fmt, data).map(i => (deck.casual && i.nivel === 'erro' ? { ...i, nivel: 'info', msg: tx('{msg} (deck casual: permitido)', { msg: i.msg }) } : i))
  const errors = issues.filter(i => i.nivel === 'erro').length
  const total = count(deck.main) + deck.commanders.length + (deck.signature ? 1 : 0)

  if (tool) return <Mesa tool={tool} setTool={setTool} onHome={() => { setTool(null); setHome(true) }} onApp={() => { setTool(null); setHome(false) }} />
  if (home) return <Home deck={deck} decks={decks} onTool={setTool} onNew={() => { setHome(false); setSection('construir'); setShowWizard(true) }} onScan={() => { setHome(false); setSection('construir'); setScan(true) }}
    onGo={(sec, mode) => { setHome(false); setSection(sec); if (mode) setColMode(mode) }} />
  return (
    <div className={`app tab-${tab} sec-${section}`}>
      <header className="top">
        <button className="brand" onClick={() => setHome(true)} title={tx('Página inicial')}><Logo /><div><b>Grimório</b><small>{tx('construtor de decks de Magic')}</small></div></button>
        <nav className="sections" aria-label={tx('Áreas')}>{SECTIONS.map(([k, ic, l]) => (
          <button key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}><i>{ic}</i><span>{l}</span></button>
        ))}</nav>
        {section !== 'biblioteca' && <div className="deck-pick">
          <DeckPicker decks={decks} deck={deck} data={data} onOpen={openDeck} onClose={newDeck} />
          <button className="new-btn" onClick={() => setShowWizard(true)}>✦ {tx('Novo deck')}</button>
          <span className="save">{saveState}</span>
        </div>}
        <ProfileChip prof={prof} onSwitch={() => setWho('switch')} onNew={() => setWho('new')} />
        {!guest && <a className="gear" href="#definicoes" title={tx('Definições')} aria-label={tx('Definições')}>⚙</a>}
        {section === 'construir' && <nav className="tabs">
          <button className={`tab-deck ${tab === 'deck' ? 'on' : ''}`} onClick={() => setTab('deck')}>{tx('Deck')} <b>{total}</b></button>
          {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </nav>}
      </header>
      {guest && <p className="guest-bar">🤝 {tx('Estás aqui como convidado ({n}): os teus decks ficam guardados neste Grimório e vês os torneios em que entras.', { n: prof.current?.name })} <button className="link small" onClick={() => fetch('/api/guest/leave', { method: 'POST' }).then(() => window.location.reload())}>{tx('sair do convite')}</button></p>}

      {section === 'regras' && <div className="area"><Rules data={data} /></div>}
      {section === 'biblioteca' && <div className="area"><Library data={data} openDeck={id => openDeck(id).then(() => goTab('deck'))} goTab={goTab} say={say} importLinks={importLinks} focus={libFocus} /></div>}
      {section === 'coliseu' && (
        <div className="area coliseu" ref={coliseuRef}>
          <p className="rodar-hint">↻ {tx('Roda o tablet para paisagem para veres melhor o tabuleiro.')}</p>
          <div className="col-bar">
            <b>⚔ {tx('Coliseu')}</b><span className="muted small">{deck.name} · {fmt.name}</span>
            <span className="seg">{[['bots', `🤖 ${tx('Bots a testar')}`], ['jogar', `🎮 ${tx('Jogar contra o Forge')}`], ['torneio', `🏆 ${tx('Torneio')}`], ['ratings', `📊 ${tx('Ratings')}`]].filter(([k]) => !guest || k === 'torneio' || k === 'ratings').map(([k, l]) => <button key={k} className={colMode === k ? 'on' : ''} onClick={() => setColMode(k)}>{l}</button>)}</span>
            <button className="fs-btn" onClick={fullscreen} title={tx('Ecrã inteiro (sair: este botão ou Esc)')}>⛶<span> {tx('Ecrã inteiro')}</span></button>
            <button className="link small" onClick={() => goTab('deck')}>{tx('voltar ao deck')}</button>
          </div>
          <div hidden={guest || colMode !== 'bots'}>{!guest && <LabView {...{ data, deck, fmt, act, ctx, playFrom }} />}</div>
          {colMode === 'jogar' && !guest && <div className="view"><PlayView data={data} deck={deck} fmt={fmt} fromState={fromState} /></div>}
          {(colMode === 'torneio' || (guest && colMode !== 'ratings')) && <TournamentView data={data} fmt={fmt} deckId={deck.id} guest={guest} />}
          {colMode === 'ratings' && <RatingsView data={data} fmt={fmt} />}
        </div>
      )}

      {section === 'construir' && <div className="body">
        <aside className="deck-panel">
          <DeckPanel {...{ data, deck, setDeck, fmt, ctx, act, issues, errors, total, delDeck, setShowImport, setShowAuto, setShowAI, setShowRefresh, hist: histN }} />
        </aside>
        <main className="work">
          {tab === 'pesquisa' && <SearchView {...{ data, deck, fmt, ctx, act }} />}
          {tab === 'sugestoes' && <SuggestView {...{ data, deck, fmt, ctx, act, setDeck, sugTag, setSugTag }} />}
          {tab === 'universo' && <MapView {...{ data, deck, fmt, ctx, act, focus, setFocus }} />}
          {tab === 'combos' && <CombosView {...{ data, deck, ctx, act }} />}
          {tab === 'teste' && <><div className="to-coliseu"><span className="muted small">{tx('Para ver os jogos em grande:')}</span> <button onClick={() => setSection('coliseu')}>⛶ {tx('Abrir no Coliseu')}</button></div><LabView {...{ data, deck, fmt, act, ctx, playFrom }} /></>}
          {tab === 'draft' && <DraftView {...{ data, setDeck, act }} />}
          {tab === 'analise' && <AnalysisView {...{ data, deck, fmt, ctx, act, issues }} />}
          {tab === 'deck' && (
            <div className="view deck-tab">
              <div className="seg viewby"><button className={deckView === 'grelha' ? 'on' : ''} onClick={() => setDeckView('grelha')}><i>▦</i><span>{tx('Grelha')}</span></button><button className={deckView === 'lista' ? 'on' : ''} onClick={() => setDeckView('lista')}><i>☰</i><span>{tx('Lista')}</span></button></div>
              {deckView === 'grelha' && <UndoBtns act={act} hist={histN} />}
              {deckView === 'grelha' ? <DeckGrid {...{ data, deck, fmt, act }} /> : <div className="deck-mobile"><DeckPanel {...{ data, deck, setDeck, fmt, ctx, act, issues, errors, total, delDeck, setShowImport, setShowAuto, setShowAI, setShowRefresh, hist: histN }} /></div>}
            </div>
          )}
        </main>
      </div>}

      <footer className="foot">
        {tx('Dados:')} <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a> {tx('e')} <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">Commander Spellbook</a> · {tx('atualizados {date} · {cards} cartas, {combos} combos.', { date: data.meta.built.slice(0, 10), cards: data.meta.cards.toLocaleString(LOCALE), combos: data.meta.combos.toLocaleString(LOCALE) })}
        {tx('Conteúdo de fã não oficial, permitido pela Fan Content Policy. Não aprovado nem apoiado pela Wizards. Partes dos materiais usados são propriedade da Wizards of the Coast. ©Wizards of the Coast LLC.')}
      </footer>

      {open && <CardModal key={open.i} c={open} {...{ data, deck, fmt, ctx, act }} onClose={() => setOpen(null)} />}
      {showWizard && <NewDeckWizard data={data} fmtInit={deck.format} onCancel={() => setShowWizard(false)}
        onImport={format => { setShowWizard(false); dirty.current = false; setDeckRaw(emptyDeck(format)); setSaveState(''); setShowImport(true) }}
        onCreate={(d, auto, goTab = 'deck') => {
        setShowWizard(false); dirty.current = true; setDeckRaw(d); setSaveState('')
        setDeckView('grelha'); setTab(goTab)
        if (auto) setTimeout(() => setShowAuto(true), 50)
      }} />}
      {artCard && <ArtPicker c={artCard} deck={deck} act={act} onClose={() => setArtCard(null)} />}
      {scan && data && <CardScan data={data} onPick={c => act.add(c)} onClose={() => setScan(false)} />}
      {showAI && <AIDialog {...{ data, deck, fmt, ctx, act, setDeck, issues, onClose: () => setShowAI(false) }} />}
      {showAuto && <AutoBuildDialog {...{ data, deck, fmt, ctx, setDeck, say, act, onClose: () => setShowAuto(false) }} />}
      {showRefresh && <RefreshDialog {...{ data, deck, setDeck, say, onClose: () => setShowRefresh(false) }} />}
      {showImport && <ImportDialog {...{ data, deck, setDeck, say, onClose: () => setShowImport(false), onImported: () => setTab('analise') }} />}
      {block && (
        <div className="modal-bg">
          <div className="modal confirm" role="alertdialog" aria-label={tx('Os ratings deste deck vão recomeçar')}>
            <h3>{tx('Os ratings deste deck vão recomeçar')}</h3>
            <p className="muted">{tx('A lista mudou {p} desde que ganhou os ratings (o máximo é 10%). Se gravares assim, as estrelas amarelas, azuis e vermelhas e o rating casual recomeçam do zero; os jogos antigos ficam na história. Os troféus seguem a regra deles.', { p: `${Math.round(chg * 100)}%` })}</p>
            <div className="row-btns"><button className="primary" onClick={undo} autoFocus>↶ {tx('Desfazer a última alteração')}</button><button className="danger" onClick={() => setOkReset(true)}>{tx('Continuar e recomeçar os ratings')}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast.msg}{toast.undo && histN[0] > 0 && <button className="link toast-undo" onClick={undo}>↶ {tx('Desfazer')}</button>}</div>}
      <LiveBar guest={guest} go={m => { setColMode(m); setSection('coliseu') }} />
    </div>
  )
}

function DeckPanel({ data, deck, setDeck, fmt, ctx, act, issues, errors, total, delDeck, setShowImport, setShowAuto, setShowAI, setShowRefresh, hist }) {
  const [viewBy, setViewBy] = useState(deck.groups?.length ? 'grupos' : 'tipo')
  const [proxies, setProxies] = useState(false)
  const bySec = viewBy === 'grupos' && deck.groups?.length
  const secOf = new Map()
  if (bySec) for (const g of deck.groups) for (const n of g.cartas) if (!secOf.has(n)) secOf.set(n, g.nome)
  const groups = {}
  for (const [n, q] of Object.entries(deck.main)) {
    const c = data.byName.get(n)
    const t = bySec ? secOf.get(n) || 'Outras' : c ? c.mt : 'Desconhecidas'  // chaves internas; o rótulo vem de GROUP_L
    ;(groups[t] ||= []).push([n, q, c])
  }
  const order = bySec ? [...deck.groups.map(g => g.nome), 'Outras'].filter((t, k, a) => groups[t] && a.indexOf(t) === k) : [...TYPES, 'Desconhecidas'].filter(t => groups[t])
  const [min, max] = fmt.size
  const copy = async () => {
    try { await navigator.clipboard.writeText(exportList(deck)); act.say(tx('Lista copiada.')) }
    catch { act.say(tx('O browser não deixou copiar; usa «Descarregar».')) }
  }
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([exportList(deck)], { type: 'text/plain' }))
    a.download = `${deck.name.replace(/[^\w\- ]+/g, '')}.txt`
    a.click()
  }
  const zones = ['main', ...(fmt.side ? ['side'] : []), 'maybe']
  // chamada como função e não como componente: um componente definido aqui dentro seria outro a cada render e o
  // React remontava todas as linhas (perdia-se o scroll da lista ao abrir uma carta)
  const row = ({ n, q, c, zone }) => (
    <li key={`${zone}:${n}`} className="row" data-card={n}>
      <span className="qty">
        <button onClick={() => c && act.remove(c, zone, 1)} aria-label={tx('Menos')}>−</button>
        <b>{q}</b>
        <button onClick={() => c && act.add(c, zone, 1)} aria-label={tx('Mais')}>+</button>
      </span>
      <button className="row-name" onClick={() => c && act.open(c)} onMouseEnter={e => c && showCardPeek(e, c, pidOf(deck, n))} onMouseLeave={e => { if (!e.relatedTarget?.closest?.('.peek-flip')) hideCardPeek() }}>{n}</button>
      {c?.df ? <button className="peek-flip" title={tx('Ver a outra face (ou tecla F com o rato na carta)')} aria-label={tx('Outra face de {c}', { c: n })} onMouseEnter={e => { if (!peekOpen()) showCardPeek(e, c, pidOf(deck, n)) }} onClick={e => { if (!peekOpen()) showCardPeek(e, c, pidOf(deck, n)); flipCardPeek() }} onMouseLeave={e => { if (!e.relatedTarget?.closest?.('.row-name')) hideCardPeek() }}>⟲</button> : null}
      {c && <Mana cost={c.mc} />}
      {c && <MoveMenu label={tx('Mover {card}', { card: n })} to={zones.filter(z => z !== zone)} onMove={z => act.move(c, zone, z)} />}
    </li>
  )
  return (
    <div className="deck">
      <input className="deck-name" value={deck.name} onChange={e => setDeck(d => ({ ...d, name: e.target.value }))} aria-label={tx('Nome do deck')} />
      <label className="fmt">
        <span>{tx('Formato')}</span>
        <select value={deck.format} onChange={async e => { const f = e.target.value; if (Object.keys(deck.main).length && !(await ask('formato', { title: tx('Mudar o formato para {f}?', { f: FORMAT[f]?.name || f }), body: tx('As cartas ficam; a validação, as metas e as sugestões passam a ser as do novo formato.'), ok: tx('Mudar'), danger: false }))) return; setDeck(d => ({ ...d, format: f })) }}>
          {['Multijogador', 'Construído', 'Arena', 'Outros'].map(g => (
            <optgroup key={g} label={tx(g)}>{FORMATS.filter(f => f.group === g).map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</optgroup>
          ))}
        </select>
      </label>
      <label className="chk" title={tx('Pode ter cartas proibidas, banidas ou de fora do formato. Só joga em modo casual (Laboratório, torneios e Arena casuais) e só tem rating casual.')}><input type="checkbox" checked={!!deck.casual} onChange={async e => { const on = e.target.checked; if (await casualAsk(on)) setDeck(d => ({ ...d, casual: on || undefined })) }} /> {tx('Deck casual (pode violar as regras do formato)')}</label>
      {fmt.cmd === 'commander' && (
        <label className="fmt">
          <span>{tx('Bracket alvo')}</span>
          <select value={deck.bracket || ''} onChange={e => setDeck(d => ({ ...d, bracket: e.target.value ? +e.target.value : null }))}>
            <option value="">{tx('— sem alvo —')}</option>
            <option value="1">1 · {tx('Exibição')}</option><option value="2">2 · {tx('Base (pré-construídos)')}</option>
            <option value="3">3 · {tx('Melhorado (até 3 Game Changers)')}</option><option value="4">4 · {tx('Otimizado')}</option><option value="5">5 · cEDH</option>
          </select>
        </label>
      )}
      <div className={`count ${errors ? 'bad' : 'ok'}`}>
        <b>{total}</b><span>/ {max ? max : `${min}+`}</span>
        <span className="pill">{errors ? tx('{n} problema|{n} problemas', { n: errors }) : tx('válido')}</span>
      </div>
      <UndoBtns act={act} hist={hist} />
      {(!fmt.size[1] || total < fmt.size[1]) && (
        <button className="auto-btn" onClick={() => setShowAuto(true)}>✦ {tx('Completar deck automaticamente')}</button>
      )}
      <button className="ai-btn" onClick={() => setShowAI(true)}>✦ {tx('Assistente IA')} <span className="muted small">({tx('extra')})</span></button>
      {deck.groups?.length > 0 && (
        <div className="seg viewby"><button className={viewBy === 'tipo' ? 'on' : ''} onClick={() => setViewBy('tipo')}><span>{tx('Por tipo')}</span></button><button className={viewBy === 'grupos' ? 'on' : ''} onClick={() => setViewBy('grupos')}><span>{tx('Por secções (IA)')}</span></button></div>
      )}
      {issues.length > 0 && (
        <ul className="issues">{issues.slice(0, 6).map((i, k) => <li key={k} className={i.nivel}>{i.msg}</li>)}{issues.length > 6 && <li className="muted">{tx('+{n} — ver Análise', { n: issues.length - 6 })}</li>}</ul>
      )}

      {fmt.cmd && (
        <section>
          <h4>{fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : tx('Comandante')}</h4>
          {deck.commanders.length ? deck.commanders.map(n => {
            const c = data.byName.get(n)
            return c && (
              <div key={n} className="cmd" onClick={() => act.open(c)}>
                <img src={img(c, 'art_crop', false, pidOf(deck, n))} alt="" /><div><b>{n}</b><Mana cost={c.mc} /></div>
                <button onClick={e => { e.stopPropagation(); act.setCommander(c) }} aria-label={tx('Retirar')}>×</button>
              </div>
            )
          }) : <p className="muted small">{tx('Na pesquisa, usa ♛ numa carta lendária.')}</p>}
          {fmt.cmd === 'oathbreaker' && (
            <p className="small">{tx('Assinatura:')} {deck.signature ? <button className="link" onClick={() => act.open(data.byName.get(deck.signature))}>{deck.signature}</button> : <span className="muted">{tx('usa ✦ num instantâneo ou feitiço')}</span>}</p>
          )}
        </section>
      )}

      {order.map(t => (
        <section key={t}>
          <h4>{GROUP_L[t] || TYPE_LABEL[t] || t} <span className="muted">{groups[t].reduce((s, [, q]) => s + q, 0)}</span></h4>
          {t === 'Land' && <BasicBar {...{ data, deck, ctx, act }} />}
          <ul>{groups[t].sort((a, b) => (a[2]?.cmc ?? 0) - (b[2]?.cmc ?? 0) || a[0].localeCompare(b[0])).map(([n, q, c]) => row({ n, q, c, zone: 'main' }))}</ul>
        </section>
      ))}
      {order.length > 0 && !groups.Land && <section><h4>{tx('Terrenos básicos')}</h4><BasicBar {...{ data, deck, ctx, act }} /></section>}
      {!order.length && <p className="muted small hint">{tx('Deck vazio. Usa o')} <b>✦ {tx('Novo deck')}</b> {tx('(escolhe 3 a 10 cartas e o Grimório completa o resto), procura cartas, ou escolhe sementes em')} <b>{tx('Sugestões')}</b>.</p>}

      {count(deck.side) > 0 && (
        <section>
          <h4>Sideboard <span className="muted">{count(deck.side)}</span></h4>
          <ul>{Object.entries(deck.side).map(([n, q]) => row({ n, q, c: data.byName.get(n), zone: 'side' }))}</ul>
        </section>
      )}
      {count(deck.maybe || {}) > 0 && (
        <section className="maybe">
          <h4>Maybeboard <span className="muted">{count(deck.maybe)} · {tx('fora do deck')}</span></h4>
          <ul>{Object.entries(deck.maybe).map(([n, q]) => row({ n, q, c: data.byName.get(n), zone: 'maybe' }))}</ul>
        </section>
      )}

      <div className="deck-actions">
        <button onClick={() => setShowImport(true)}>{tx('Importar')}</button>
        {deck.id && <button onClick={() => setShowRefresh(true)} title={sourceOf(deck) ? tx('Voltar a ler {url}', { url: sourceOf(deck) }) : tx('Ler artes, capa e lista do site de onde veio o deck')}>⟳ {tx('Atualizar do site')}</button>}
        <button onClick={copy}>{tx('Copiar lista')}</button>
        <button onClick={download}>{tx('Descarregar')}</button>
        <button onClick={() => setProxies(true)} title={tx('Lista com edições, ZIP com as imagens ou folha para imprimir')}>🖨 {tx('Proxies')}</button>
        {proxies && <ProxyDialog data={data} deck={deck} onClose={() => setProxies(false)} />}
        {deck.id && <button className="danger" onClick={delDeck}>{tx('Eliminar')}</button>}
      </div>
      <textarea className="notes" placeholder={tx('Notas do deck…')} value={deck.notes} onChange={e => setDeck(d => ({ ...d, notes: e.target.value }))} />
    </div>
  )
}

// ⟳ Atualizar do site: volta a ler o deck pelo link de origem; traz as artes próprias (TappedOut), as edições
// e a capa; a lista (deck, sideboard, maybeboard) só se for pedido.
function RefreshDialog({ data, deck, setDeck, say, onClose }) {
  const [url, setUrl] = useState(sourceOf(deck))
  const [got, setGot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [list, setList] = useState(false)
  const read = async () => {
    setBusy(true); setErr(''); setGot(null)
    try {
      const r = await fetch(`/api/import?url=${encodeURIComponent(url.trim())}`), j = await r.json()
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
      const p = parseList(j.text, data)
      setGot({ j, p, ...(await importExtras(data, p, j)) })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  useEffect(() => { if (url) read() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const diff = got && (() => {  // diferenças da lista: cartas que entram / saem do deck principal
    const a = { ...deck.main }, b = { ...got.p.main }
    for (const n of deck.commanders) a[n] = (a[n] || 0) + 1
    for (const n of got.p.commanders) b[n] = (b[n] || 0) + 1
    let plus = 0, minus = 0
    for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) { const x = (b[n] || 0) - (a[n] || 0); if (x > 0) plus += x; else minus -= x }
    return { plus, minus, side: count(got.p.side) - count(deck.side), maybe: count(got.p.maybe) }
  })()
  const apply = () => {
    const { j, p, art, prints } = got
    setDeck(d => ({ ...d, art, prints: { ...(d.prints || {}), ...prints }, source: url.trim(), ...(j.cover ? { coverImg: j.cover } : {}),
      ...(list ? { commanders: p.commanders.length ? p.commanders : d.commanders, main: p.main, side: p.side, maybe: p.maybe, groups: [] } : {}) }))
    say(tx('Atualizado do site: {arts} artes próprias, {prints} edições', { arts: Object.keys(art).length, prints: Object.keys(prints).length }) + (j.cover ? tx(', capa') : '') + (list ? tx(' e a lista') : '') + '.')
    onClose()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal import refresh" onClick={e => e.stopPropagation()}>
        <h3>⟳ {tx('Atualizar do site')}</h3>
        <div className="url-row">
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && url.trim() && read()} placeholder={tx('Link do deck no TappedOut, Moxfield, Archidekt…')} />
          <button onClick={read} disabled={!url.trim() || busy}>{busy ? tx('A ler…') : tx('Ler')}</button>
        </div>
        {!sourceOf(deck) && <p className="muted small">{tx('Este deck não guardou de onde veio: cola o link uma vez e fica guardado.')}</p>}
        {err && <p className="small bad-t">{err}</p>}
        {got && <>
          <ul className="small rf-sum">
            <li><b>{Object.keys(got.art).length}</b> {tx('artes próprias do site')}{Object.keys(got.art).length ? ` ${tx('(as imagens que o dono escolheu, incluindo alteradas)')}` : ''}</li>
            <li><b>{Object.keys(got.prints).length}</b> {tx('edições indicadas na lista')}</li>
            <li>{tx('Capa:')} {got.j.cover ? tx('sim, a do site') : tx('o site não tem; fica a atual')}</li>
          </ul>
          {Object.keys(got.art).length > 0 && <div className="rf-arts">{Object.entries(got.art).slice(0, 12).map(([n, u]) => <img key={n} src={u} alt={n} title={n} loading="lazy" />)}</div>}
          <label className="chk"><input type="checkbox" checked={list} onChange={e => setList(e.target.checked)} /> {tx('Substituir também a lista pela do site')} {diff && <span className="muted">({diff.plus || diff.minus ? tx('+{plus} −{minus} no deck', diff) : tx('deck igual')}{diff.side ? `, sideboard ${diff.side > 0 ? '+' : ''}${diff.side}` : ''}{diff.maybe ? tx(', {maybe} no maybeboard', diff) : ''})</span>}</label>
          <div className="row-btns"><button className="primary" onClick={apply}>{tx('Atualizar')}</button><button onClick={onClose}>{tx('Cancelar')}</button></div>
        </>}
      </div>
    </div>
  )
}

function ImportDialog({ data, deck, setDeck, say, onClose, onImported }) {
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [urlErr, setUrlErr] = useState('')
  const fromUrl = async () => {
    setFetching(true); setUrlErr('')
    try {
      const r = await fetch(`/api/import?url=${encodeURIComponent(url.trim())}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
      setText(j.text); setInfo(j)
    } catch (e) { setUrlErr(e.message) }
    setFetching(false)
  }
  const [mode, setMode] = useState('replace')
  const [community, setCommunity] = useState(false)  // deck de outra pessoa (comunidade), não meu
  const [busy, setBusy] = useState(false)
  const go = async () => {
    const p = parseList(text, data)
    setBusy(true)
    const { prints, art } = await importExtras(data, p, info)  // edições (Scryfall) e arte própria do site
    setBusy(false)
    const src = info ? { source: url.trim() } : {}
    // formato: o do site se a lista for legal nele; senão detectado pelas cartas (link, ou lista colada num deck vazio)
    const fx = (info || !count(deck.main)) && mode === 'replace' ? fixFormat(data, p, info?.format) : null
    setDeck(d => {
      if (mode === 'replace') return { ...d, community: community || undefined, ...(info ? { name: info.name || d.name } : {}), ...(info?.cover ? { coverImg: info.cover } : {}), ...(fx ? { format: fx.format } : {}), commanders: p.commanders.length ? p.commanders : d.commanders, main: p.main, side: p.side, maybe: p.maybe, prints, art, ...src, groups: [] }
      const z = k => { const o = { ...(d[k] || {}) }; for (const [n, q] of Object.entries(p[k])) o[n] = (o[n] || 0) + q; return o }
      return { ...d, main: z('main'), side: z('side'), maybe: z('maybe'), prints: { ...(d.prints || {}), ...prints }, art: { ...(d.art || {}), ...art }, commanders: [...new Set([...d.commanders, ...p.commanders])] }
    })
    say(tx('Importadas {n} cartas', { n: count(p.main) + count(p.side) + p.commanders.length }) + (count(p.maybe) ? tx(' (+{n} no maybeboard)', { n: count(p.maybe) }) : '') + (Object.keys(art).length ? tx(' · {n} artes do site', { n: Object.keys(art).length }) : '')
      + (fx ? (fx.detected ? tx(' · formato detetado: {fmt}', { fmt: FORMAT[fx.format].name }) : tx(' · formato do site: {fmt}', { fmt: FORMAT[fx.format].name })) : '')
      + (p.unknown.length ? tx('; {n} desconhecidas: {list}', { n: p.unknown.length, list: p.unknown.slice(0, 4).join(', ') }) : '') + '.', true)
    onClose()
    onImported?.()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal import" onClick={e => e.stopPropagation()}>
        <h3>{tx('Importar deck')}</h3>
        <div className="url-row">
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && url.trim() && fromUrl()} placeholder={tx('Link do deck: Moxfield, Archidekt, TappedOut, MTGGoldfish, Deckstats, MTGTop8, Scryfall…')} />
          <button onClick={fromUrl} disabled={!url.trim() || fetching}>{fetching ? tx('A buscar…') : tx('Ir buscar')}</button>
        </div>
        {urlErr && <p className="small bad-t">{urlErr}</p>}
        {info && <p className="small ok-t">{tx('«{name}» de {src}', { name: info.name, src: info.source })}{info.format ? ` · ${FORMAT[info.format]?.name || info.format}` : ''}: {tx('revê a lista e importa. Depois disso abre-se o diagnóstico com as melhorias.')}</p>}
        <p className="muted small">{tx('Cola uma lista do Arena, Moxfield, Archidekt ou MTGO («4 Lightning Bolt», «1x Sol Ring (CMR) 263 *F*», secções Commander/Deck/Sideboard). A edição indicada fica como estilo da carta.')}</p>
        <textarea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n...'} />
        <div className="row-btns">
          {mode === 'replace' && <label className="chk small" title={tx('Decks da comunidade: guardados na tua Biblioteca, mas são de outras pessoas; nos torneios e na Arena escolhes se entram')}><input type="checkbox" checked={community} onChange={e => setCommunity(e.target.checked)} /> {tx('🌐 É um deck da comunidade (não é meu)')}</label>}
          <select value={mode} onChange={e => setMode(e.target.value)}><option value="replace">{tx('Substituir o deck {name}', { name: deck.name })}</option><option value="merge">{tx('Juntar ao deck')}</option></select>
          <button className="primary" onClick={go} disabled={!text.trim() || busy}>{busy ? tx('A obter edições…') : tx('Importar')}</button>
          <button onClick={onClose}>{tx('Cancelar')}</button>
        </div>
      </div>
    </div>
  )
}
