import Home from './Home.jsx'
import DeckPicker from './DeckPicker.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadData, fmtBit, TYPES, TYPE_LABEL, img, pidOf, importExtras } from './data.js'
import { FORMATS, FORMAT, validate, maxCopies, canBeCommander, fixFormat } from './formats.js'
import { emptyDeck, count, parseList, exportList, sourceOf } from './deck.js'
import { Logo, Mana } from './ui.jsx'
import { SearchView, SuggestView, MapView, CombosView, AnalysisView, CardModal, AutoBuildDialog, AIDialog, DeckGrid, ArtPicker } from './Views.jsx'
import DraftView from './Draft.jsx'
import NewDeckWizard from './Wizard.jsx'
import LabView from './Lab.jsx'
import PlayView from './Play.jsx'
import TournamentView from './Tournament.jsx'
import RatingsView from './Ratings.jsx'
import { loadTests } from './tests.js'
import Library from './Library.jsx'
import './index.css'

const TABS = [['pesquisa', 'Pesquisa'], ['sugestoes', 'Sugestões'], ['universo', 'Universo'], ['combos', 'Combos'], ['analise', 'Análise'], ['teste', 'Teste'], ['draft', 'Draft']]
const SECTIONS = [['construir', '✎', 'Construir'], ['biblioteca', '▤', 'Biblioteca'], ['coliseu', '⚔', 'Coliseu']]
const ZONE_L = { main: 'deck', side: 'sideboard', maybe: 'maybeboard' }
const store = { get: k => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem storage */ } } }

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `HTTP ${r.status}`)
  return r.json()
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
  const [home, setHome] = useState(() => !window.location.hash.startsWith('#importar='))  // página inicial ao abrir
  const [showRefresh, setShowRefresh] = useState(false)
  const [section, setSectionRaw] = useState(() => store.get('grimorio.section') || 'construir')
  const setSection = x => { setSectionRaw(x); store.set('grimorio.section', x) }
  const coliseuRef = useRef(null)
  const [colMode, setColMode] = useState('bots')  // bots a testar | jogar contra o Forge
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
  // favorito do TappedOut: abre o Grimório com #importar=<links>
  const [importLinks] = useState(() => {
    const h = window.location.hash
    if (!h.startsWith('#importar=')) return ''
    history.replaceState(null, '', window.location.pathname)
    return decodeURIComponent(h.slice(10))
  })
  useEffect(() => { if (importLinks) setSection('biblioteca') }, [importLinks]) // eslint-disable-line react-hooks/exhaustive-deps
  const [deckView, setDeckViewRaw] = useState(() => store.get('grimorio.deckView') || 'grelha')
  const setDeckView = v => { setDeckViewRaw(v); store.set('grimorio.deckView', v) }
  const dirty = useRef(false)

  const say = useCallback(msg => { setToast(msg); clearTimeout(say.t); say.t = setTimeout(() => setToast(null), 2600) }, [])
  const setDeck = useCallback(fn => { dirty.current = true; setDeckRaw(fn) }, [])

  useEffect(() => { loadData().then(setData).catch(e => setErr(e.message)) }, [])
  useEffect(() => {
    api('/api/decks').then(list => {
      setDecks(list)
      const last = store.get('grimorio.deck')
      if (last && list.some(d => d.id === last)) api(`/api/decks/${last}`).then(d => setDeckRaw({ ...emptyDeck(), ...d }))
    }).catch(() => {})
  }, [])
  useEffect(() => { store.set('grimorio.tab', tab) }, [tab])

  // Gravação automática (cria o deck no servidor à primeira alteração).
  useEffect(() => {
    if (!dirty.current) return
    setSaveState('a guardar…')
    const t = setTimeout(async () => {
      try {
        const body = JSON.stringify({ ...deck, count: count(deck.main) + deck.commanders.length })
        const saved = deck.id ? await api(`/api/decks/${deck.id}`, { method: 'PUT', body }) : await api('/api/decks', { method: 'POST', body })
        dirty.current = false
        if (!deck.id) setDeckRaw(d => ({ ...d, id: saved.id }))
        store.set('grimorio.deck', saved.id)
        setSaveState('guardado')
        api('/api/decks').then(setDecks).catch(() => {})
      } catch (e) { setSaveState(`erro ao guardar: ${e.message}`) }
    }, 700)
    return () => clearTimeout(t)
  }, [deck])

  // Testes guardados do deck (Laboratório): entram nas sugestões e nos cortes; o Lab pede para recarregar ao guardar.
  const [tests, setTests] = useState(null)
  const [testsN, setTestsN] = useState(0)
  useEffect(() => {
    let off = false
    if (data && deck.id) loadTests(data, deck.id).then(t => { if (!off) setTests({ id: deck.id, t }) }).catch(() => {})
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
      if (q > 0 && zone !== 'maybe' && have + q > lim) { say(`${c.n}: limite de ${lim} em ${fmt.name}.`); return d }
      const z = { ...(d[zone] || {}) }
      z[c.n] = (z[c.n] || 0) + q
      if (z[c.n] <= 0) delete z[c.n]
      return { ...d, [zone]: z }
    })
    if (q > 0) say(`${c.n} → ${ZONE_L[zone]}`)
  }, [data, fmt, setDeck, say])
  // mover todas as cópias entre deck, sideboard e maybeboard (a legalidade só olha para o deck e o sideboard)
  const move = useCallback((c, from, to) => setDeck(d => {
    const a = { ...(d[from] || {}) }, b = { ...(d[to] || {}) }, q = a[c.n] || 0
    if (!q) return d
    delete a[c.n]; b[c.n] = (b[c.n] || 0) + q
    return { ...d, [from]: a, [to]: b }
  }), [setDeck])

  const setCommander = useCallback(c => {
    if (!canBeCommander(c, fmt)) say(`Atenção: ${c.n} não costuma poder ser comandante em ${fmt.name}.`)
    setDeck(d => {
      if (d.commanders.includes(c.n)) return { ...d, commanders: d.commanders.filter(n => n !== c.n) }
      const main = { ...d.main }; delete main[c.n]
      return { ...d, main, commanders: [...d.commanders, c.n].slice(-2) }
    })
  }, [fmt, setDeck, say])

  const toggleSeed = useCallback(c => setDeck(d => ({ ...d, seeds: d.seeds.includes(c.n) ? d.seeds.filter(n => n !== c.n) : [...d.seeds, c.n] })), [setDeck])
  const setPrefs = useCallback(p => setDeck(d => ({ ...d, prefs: { ...(d.prefs || {}), ...p } })), [setDeck])
  const setSignature = useCallback(c => setDeck(d => ({ ...d, signature: d.signature === c.n ? null : c.n })), [setDeck])
  // Estilo alternativo: print = {id, set, cn, ...} ou null para voltar à predefinida.
  const setPrint = useCallback((c, print) => setDeck(d => {
    const prints = { ...(d.prints || {}) }, art = { ...(d.art || {}) }
    if (print) prints[c.n] = print; else delete prints[c.n]
    delete art[c.n]  // escolher outra arte larga a do site
    return { ...d, prints, art }
  }), [setDeck])

  const act = useMemo(() => ({ add, move, setCommander, toggleSeed, setSignature, setPrint, setPrefs, open: setOpen, say, pickArt: setArtCard,
    showOnMap: c => { setFocus(c.i); setTab('universo'); setOpen(null) },
    suggestFor: t => { setSugTag(t); setTab('sugestoes') }, refreshTests: () => setTestsN(n => n + 1) }), [add, move, setCommander, toggleSeed, setSignature, setPrint, setPrefs, say])

  const newDeck = () => { dirty.current = false; setDeckRaw(emptyDeck(deck.format)); store.set('grimorio.deck', ''); setSaveState('') }
  const openDeck = async id => {
    if (!id) return setShowWizard(true)
    const d = await api(`/api/decks/${id}`)
    dirty.current = false
    setDeckRaw({ ...emptyDeck(), ...d }); store.set('grimorio.deck', id); setSaveState('')
  }
  const delDeck = async () => {
    if (!deck.id || !confirm(`Eliminar «${deck.name}»? Fica 30 dias no lixo da Biblioteca.`)) return
    await api(`/api/decks/${deck.id}`, { method: 'DELETE' })
    setDecks(ds => ds.filter(x => x.id !== deck.id))
    newDeck()
  }

  if (err) return <div className="boot"><Logo size={64} /><p>Não consegui carregar os dados: {err}</p><p className="muted">Os dados são gerados por <code>build/build.sh</code>.</p></div>
  if (!data) return <div className="boot"><Logo size={64} /><div className="spinner" /><p>A abrir o grimório… <span className="muted">(34 mil cartas, ~10 MB)</span></p></div>

  // deck casual: as regras do formato não o impedem de nada; os erros passam a informação
  const issues = validate(deck, fmt, data).map(i => (deck.casual && i.nivel === 'erro' ? { ...i, nivel: 'info', msg: `${i.msg} (deck casual: permitido)` } : i))
  const errors = issues.filter(i => i.nivel === 'erro').length
  const total = count(deck.main) + deck.commanders.length + (deck.signature ? 1 : 0)

  if (home) return <Home deck={deck} decks={decks} onNew={() => { setHome(false); setSection('construir'); setShowWizard(true) }}
    onGo={(sec, mode) => { setHome(false); setSection(sec); if (mode) setColMode(mode) }} />
  return (
    <div className={`app tab-${tab} sec-${section}`}>
      <header className="top">
        <button className="brand" onClick={() => setHome(true)} title="Página inicial"><Logo /><div><b>Grimório</b><small>construtor de decks de Magic</small></div></button>
        <nav className="sections" aria-label="Áreas">{SECTIONS.map(([k, ic, l]) => (
          <button key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}><i>{ic}</i><span>{l}</span></button>
        ))}</nav>
        {section !== 'biblioteca' && <div className="deck-pick">
          <DeckPicker decks={decks} deck={deck} data={data} onOpen={openDeck} />
          <button className="new-btn" onClick={() => setShowWizard(true)}>✦ Novo deck</button>
          <span className="save">{saveState}</span>
        </div>}
        {section === 'construir' && <nav className="tabs">
          <button className={`tab-deck ${tab === 'deck' ? 'on' : ''}`} onClick={() => setTab('deck')}>Deck <b>{total}</b></button>
          {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </nav>}
      </header>

      {section === 'biblioteca' && <div className="area"><Library data={data} openDeck={id => openDeck(id).then(() => goTab('deck'))} goTab={goTab} say={say} importLinks={importLinks} /></div>}
      {section === 'coliseu' && (
        <div className="area coliseu" ref={coliseuRef}>
          <p className="rodar-hint">↻ Roda o tablet para paisagem para veres melhor o tabuleiro.</p>
          <div className="col-bar">
            <b>⚔ Coliseu</b><span className="muted small">{deck.name} · {fmt.name}</span>
            <span className="seg">{[['bots', '🤖 Bots a testar'], ['jogar', '🎮 Jogar contra o Forge'], ['torneio', '🏆 Torneio'], ['ratings', '📊 Ratings']].map(([k, l]) => <button key={k} className={colMode === k ? 'on' : ''} onClick={() => setColMode(k)}>{l}</button>)}</span>
            <button className="fs-btn" onClick={fullscreen} title="Ecrã inteiro (sair: este botão ou Esc)">⛶<span> Ecrã inteiro</span></button>
            <button className="link small" onClick={() => goTab('deck')}>voltar ao deck</button>
          </div>
          <div hidden={colMode !== 'bots'}><LabView {...{ data, deck, fmt, act, ctx, playFrom }} /></div>
          {colMode === 'jogar' && <div className="view"><PlayView data={data} deck={deck} fmt={fmt} fromState={fromState} /></div>}
          {colMode === 'torneio' && <TournamentView data={data} fmt={fmt} />}
          {colMode === 'ratings' && <RatingsView data={data} fmt={fmt} />}
        </div>
      )}

      {section === 'construir' && <div className="body">
        <aside className="deck-panel">
          <DeckPanel {...{ data, deck, setDeck, fmt, act, issues, errors, total, delDeck, setShowImport, setShowAuto, setShowAI, setShowRefresh }} />
        </aside>
        <main className="work">
          {tab === 'pesquisa' && <SearchView {...{ data, deck, fmt, ctx, act }} />}
          {tab === 'sugestoes' && <SuggestView {...{ data, deck, fmt, ctx, act, setDeck, sugTag, setSugTag }} />}
          {tab === 'universo' && <MapView {...{ data, deck, fmt, ctx, act, focus, setFocus }} />}
          {tab === 'combos' && <CombosView {...{ data, deck, ctx, act }} />}
          {tab === 'teste' && <><div className="to-coliseu"><span className="muted small">Para ver os jogos em grande:</span> <button onClick={() => setSection('coliseu')}>⛶ Abrir no Coliseu</button></div><LabView {...{ data, deck, fmt, act, ctx, playFrom }} /></>}
          {tab === 'draft' && <DraftView {...{ data, setDeck, act }} />}
          {tab === 'analise' && <AnalysisView {...{ data, deck, fmt, ctx, act, issues }} />}
          {tab === 'deck' && (
            <div className="view deck-tab">
              <div className="seg viewby"><button className={deckView === 'grelha' ? 'on' : ''} onClick={() => setDeckView('grelha')}><i>▦</i><span>Grelha</span></button><button className={deckView === 'lista' ? 'on' : ''} onClick={() => setDeckView('lista')}><i>☰</i><span>Lista</span></button></div>
              {deckView === 'grelha' ? <DeckGrid {...{ data, deck, fmt, act }} /> : <div className="deck-mobile"><DeckPanel {...{ data, deck, setDeck, fmt, act, issues, errors, total, delDeck, setShowImport, setShowAuto, setShowAI, setShowRefresh }} /></div>}
            </div>
          )}
        </main>
      </div>}

      <footer className="foot">
        Dados: <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a> e <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">Commander Spellbook</a> · atualizados {data.meta.built.slice(0, 10)} · {data.meta.cards.toLocaleString('pt-PT')} cartas, {data.meta.combos.toLocaleString('pt-PT')} combos.
        Conteúdo de fã não oficial, permitido pela Fan Content Policy. Não aprovado nem apoiado pela Wizards. Partes dos materiais usados são propriedade da Wizards of the Coast. ©Wizards of the Coast LLC.
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
      {showAI && <AIDialog {...{ data, deck, fmt, ctx, act, setDeck, issues, onClose: () => setShowAI(false) }} />}
      {showAuto && <AutoBuildDialog {...{ data, deck, fmt, ctx, setDeck, say, act, onClose: () => setShowAuto(false) }} />}
      {showRefresh && <RefreshDialog {...{ data, deck, setDeck, say, onClose: () => setShowRefresh(false) }} />}
      {showImport && <ImportDialog {...{ data, deck, setDeck, say, onClose: () => setShowImport(false), onImported: () => setTab('analise') }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function DeckPanel({ data, deck, setDeck, fmt, act, issues, errors, total, delDeck, setShowImport, setShowAuto, setShowAI, setShowRefresh }) {
  const [viewBy, setViewBy] = useState(deck.groups?.length ? 'grupos' : 'tipo')
  const bySec = viewBy === 'grupos' && deck.groups?.length
  const secOf = new Map()
  if (bySec) for (const g of deck.groups) for (const n of g.cartas) if (!secOf.has(n)) secOf.set(n, g.nome)
  const groups = {}
  for (const [n, q] of Object.entries(deck.main)) {
    const c = data.byName.get(n)
    const t = bySec ? secOf.get(n) || 'Outras' : c ? c.mt : 'Desconhecidas'
    ;(groups[t] ||= []).push([n, q, c])
  }
  const order = bySec ? [...deck.groups.map(g => g.nome), 'Outras'].filter((t, k, a) => groups[t] && a.indexOf(t) === k) : [...TYPES, 'Desconhecidas'].filter(t => groups[t])
  const [min, max] = fmt.size
  const copy = async () => {
    try { await navigator.clipboard.writeText(exportList(deck)); act.say('Lista copiada.') }
    catch { act.say('O browser não deixou copiar; usa «Descarregar».') }
  }
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([exportList(deck)], { type: 'text/plain' }))
    a.download = `${deck.name.replace(/[^\w\- ]+/g, '')}.txt`
    a.click()
  }
  const zones = ['main', ...(fmt.side ? ['side'] : []), 'maybe']
  const Row = ({ n, q, c, zone }) => (
    <li className="row">
      <span className="qty">
        <button onClick={() => c && act.add(c, zone, -1)} aria-label="Menos">−</button>
        <b>{q}</b>
        <button onClick={() => c && act.add(c, zone, 1)} aria-label="Mais">+</button>
      </span>
      <button className="row-name" onClick={() => c && act.open(c)} onMouseEnter={e => c && showPeek(e, c, pidOf(deck, n))} onMouseLeave={hidePeek}>{n}</button>
      {c && <Mana cost={c.mc} />}
      {c && <select className="mv" value="" onChange={e => act.move(c, zone, e.target.value)} aria-label={`Mover ${n}`} title="Mover para…">
        <option value="">⇄</option>{zones.filter(z => z !== zone).map(z => <option key={z} value={z}>→ {ZONE_L[z]}</option>)}</select>}
    </li>
  )
  return (
    <div className="deck">
      <input className="deck-name" value={deck.name} onChange={e => setDeck(d => ({ ...d, name: e.target.value }))} aria-label="Nome do deck" />
      <label className="fmt">
        <span>Formato</span>
        <select value={deck.format} onChange={e => setDeck(d => ({ ...d, format: e.target.value }))}>
          {['Multijogador', 'Construído', 'Arena', 'Outros'].map(g => (
            <optgroup key={g} label={g}>{FORMATS.filter(f => f.group === g).map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</optgroup>
          ))}
        </select>
      </label>
      <label className="chk" title="Pode ter cartas proibidas, banidas ou de fora do formato. Só joga em modo casual (Laboratório, torneios e Arena casuais) e só tem rating casual."><input type="checkbox" checked={!!deck.casual} onChange={e => setDeck(d => ({ ...d, casual: e.target.checked || undefined }))} /> Deck casual (pode violar as regras do formato)</label>
      {fmt.cmd === 'commander' && (
        <label className="fmt">
          <span>Bracket alvo</span>
          <select value={deck.bracket || ''} onChange={e => setDeck(d => ({ ...d, bracket: e.target.value ? +e.target.value : null }))}>
            <option value="">— sem alvo —</option>
            <option value="1">1 · Exibição</option><option value="2">2 · Base (pré-construídos)</option>
            <option value="3">3 · Melhorado (até 3 Game Changers)</option><option value="4">4 · Otimizado</option><option value="5">5 · cEDH</option>
          </select>
        </label>
      )}
      <div className={`count ${errors ? 'bad' : 'ok'}`}>
        <b>{total}</b><span>/ {max ? max : `${min}+`}</span>
        <span className="pill">{errors ? `${errors} problema${errors > 1 ? 's' : ''}` : 'válido'}</span>
      </div>
      {(!fmt.size[1] || total < fmt.size[1]) && (
        <button className="auto-btn" onClick={() => setShowAuto(true)}>✦ Completar deck automaticamente</button>
      )}
      <button className="ai-btn" onClick={() => setShowAI(true)}>✦ Assistente IA <span className="muted small">(extra)</span></button>
      {deck.groups?.length > 0 && (
        <div className="seg viewby"><button className={viewBy === 'tipo' ? 'on' : ''} onClick={() => setViewBy('tipo')}><span>Por tipo</span></button><button className={viewBy === 'grupos' ? 'on' : ''} onClick={() => setViewBy('grupos')}><span>Por secções (IA)</span></button></div>
      )}
      {issues.length > 0 && (
        <ul className="issues">{issues.slice(0, 6).map((i, k) => <li key={k} className={i.nivel}>{i.msg}</li>)}{issues.length > 6 && <li className="muted">+{issues.length - 6} — ver Análise</li>}</ul>
      )}

      {fmt.cmd && (
        <section>
          <h4>{fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : 'Comandante'}</h4>
          {deck.commanders.length ? deck.commanders.map(n => {
            const c = data.byName.get(n)
            return c && (
              <div key={n} className="cmd" onClick={() => act.open(c)}>
                <img src={img(c, 'art_crop', false, pidOf(deck, n))} alt="" /><div><b>{n}</b><Mana cost={c.mc} /></div>
                <button onClick={e => { e.stopPropagation(); act.setCommander(c) }} aria-label="Retirar">×</button>
              </div>
            )
          }) : <p className="muted small">Na pesquisa, usa ♛ numa carta lendária.</p>}
          {fmt.cmd === 'oathbreaker' && (
            <p className="small">Assinatura: {deck.signature ? <button className="link" onClick={() => act.open(data.byName.get(deck.signature))}>{deck.signature}</button> : <span className="muted">usa ✦ num instantâneo ou feitiço</span>}</p>
          )}
        </section>
      )}

      {order.map(t => (
        <section key={t}>
          <h4>{TYPE_LABEL[t] || t} <span className="muted">{groups[t].reduce((s, [, q]) => s + q, 0)}</span></h4>
          <ul>{groups[t].sort((a, b) => (a[2]?.cmc ?? 0) - (b[2]?.cmc ?? 0) || a[0].localeCompare(b[0])).map(([n, q, c]) => <Row key={n} {...{ n, q, c, zone: 'main' }} />)}</ul>
        </section>
      ))}
      {!order.length && <p className="muted small hint">Deck vazio. Usa o <b>✦ Novo deck</b> (escolhe 3 a 10 cartas e o Grimório completa o resto), procura cartas, ou escolhe sementes em <b>Sugestões</b>.</p>}

      {count(deck.side) > 0 && (
        <section>
          <h4>Sideboard <span className="muted">{count(deck.side)}</span></h4>
          <ul>{Object.entries(deck.side).map(([n, q]) => <Row key={n} n={n} q={q} c={data.byName.get(n)} zone="side" />)}</ul>
        </section>
      )}
      {count(deck.maybe || {}) > 0 && (
        <section className="maybe">
          <h4>Maybeboard <span className="muted">{count(deck.maybe)} · fora do deck</span></h4>
          <ul>{Object.entries(deck.maybe).map(([n, q]) => <Row key={n} n={n} q={q} c={data.byName.get(n)} zone="maybe" />)}</ul>
        </section>
      )}

      <div className="deck-actions">
        <button onClick={() => setShowImport(true)}>Importar</button>
        {deck.id && <button onClick={() => setShowRefresh(true)} title={sourceOf(deck) ? `Voltar a ler ${sourceOf(deck)}` : 'Ler artes, capa e lista do site de onde veio o deck'}>⟳ Atualizar do site</button>}
        <button onClick={copy}>Copiar lista</button>
        <button onClick={download}>Descarregar</button>
        {deck.id && <button className="danger" onClick={delDeck}>Eliminar</button>}
      </div>
      <textarea className="notes" placeholder="Notas do deck…" value={deck.notes} onChange={e => setDeck(d => ({ ...d, notes: e.target.value }))} />
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
    say(`Atualizado do site: ${Object.keys(art).length} artes próprias, ${Object.keys(prints).length} edições${j.cover ? ', capa' : ''}${list ? ' e a lista' : ''}.`)
    onClose()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal import refresh" onClick={e => e.stopPropagation()}>
        <h3>⟳ Atualizar do site</h3>
        <div className="url-row">
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && url.trim() && read()} placeholder="Link do deck no TappedOut, Moxfield, Archidekt…" />
          <button onClick={read} disabled={!url.trim() || busy}>{busy ? 'A ler…' : 'Ler'}</button>
        </div>
        {!sourceOf(deck) && <p className="muted small">Este deck não guardou de onde veio: cola o link uma vez e fica guardado.</p>}
        {err && <p className="small bad-t">{err}</p>}
        {got && <>
          <ul className="small rf-sum">
            <li><b>{Object.keys(got.art).length}</b> artes próprias do site{Object.keys(got.art).length ? ' (as imagens que o dono escolheu, incluindo alteradas)' : ''}</li>
            <li><b>{Object.keys(got.prints).length}</b> edições indicadas na lista</li>
            <li>Capa: {got.j.cover ? 'sim, a do site' : 'o site não tem; fica a atual'}</li>
          </ul>
          {Object.keys(got.art).length > 0 && <div className="rf-arts">{Object.entries(got.art).slice(0, 12).map(([n, u]) => <img key={n} src={u} alt={n} title={n} loading="lazy" />)}</div>}
          <label className="chk"><input type="checkbox" checked={list} onChange={e => setList(e.target.checked)} /> Substituir também a lista pela do site {diff && <span className="muted">({diff.plus || diff.minus ? `+${diff.plus} −${diff.minus} no deck` : 'deck igual'}{diff.side ? `, sideboard ${diff.side > 0 ? '+' : ''}${diff.side}` : ''}{diff.maybe ? `, ${diff.maybe} no maybeboard` : ''})</span>}</label>
          <div className="row-btns"><button className="primary" onClick={apply}>Atualizar</button><button onClick={onClose}>Cancelar</button></div>
        </>}
      </div>
    </div>
  )
}

// Pré-visualização da carta ao passar o rato na lista (só em ecrãs com rato).
let peekEl
function showPeek(e, c, pid) {
  if (!matchMedia('(hover: hover)').matches) return
  peekEl ||= Object.assign(document.body.appendChild(document.createElement('img')), { className: 'peek' })
  const r = e.currentTarget.getBoundingClientRect()
  peekEl.src = img(c, 'normal', false, pid)
  peekEl.style.top = `${Math.min(window.innerHeight - 350, Math.max(8, r.top - 120))}px`
  peekEl.style.left = `${r.right + 12}px`
  peekEl.style.display = 'block'
}
function hidePeek() { if (peekEl) peekEl.style.display = 'none' }

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
      if (mode === 'replace') return { ...d, ...(info ? { name: info.name || d.name } : {}), ...(info?.cover ? { coverImg: info.cover } : {}), ...(fx ? { format: fx.format } : {}), commanders: p.commanders.length ? p.commanders : d.commanders, main: p.main, side: p.side, maybe: p.maybe, prints, art, ...src, groups: [] }
      const z = k => { const o = { ...(d[k] || {}) }; for (const [n, q] of Object.entries(p[k])) o[n] = (o[n] || 0) + q; return o }
      return { ...d, main: z('main'), side: z('side'), maybe: z('maybe'), prints: { ...(d.prints || {}), ...prints }, art: { ...(d.art || {}), ...art }, commanders: [...new Set([...d.commanders, ...p.commanders])] }
    })
    say(`Importadas ${count(p.main) + count(p.side) + p.commanders.length} cartas${count(p.maybe) ? ` (+${count(p.maybe)} no maybeboard)` : ''}${Object.keys(art).length ? ` · ${Object.keys(art).length} artes do site` : ''}${fx ? ` · formato ${fx.detected ? 'detetado' : 'do site'}: ${FORMAT[fx.format].name}` : ''}${p.unknown.length ? `; ${p.unknown.length} desconhecidas: ${p.unknown.slice(0, 4).join(', ')}` : ''}.`)
    onClose()
    onImported?.()
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal import" onClick={e => e.stopPropagation()}>
        <h3>Importar deck</h3>
        <div className="url-row">
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && url.trim() && fromUrl()} placeholder="Link do deck: Moxfield, Archidekt, TappedOut, MTGGoldfish, Deckstats, MTGTop8, Scryfall…" />
          <button onClick={fromUrl} disabled={!url.trim() || fetching}>{fetching ? 'A buscar…' : 'Ir buscar'}</button>
        </div>
        {urlErr && <p className="small bad-t">{urlErr}</p>}
        {info && <p className="small ok-t">«{info.name}» de {info.source}{info.format ? ` · ${FORMAT[info.format]?.name || info.format}` : ''}: revê a lista e importa. Depois disso abre-se o diagnóstico com as melhorias.</p>}
        <p className="muted small">Cola uma lista do Arena, Moxfield, Archidekt ou MTGO («4 Lightning Bolt», «1x Sol Ring (CMR) 263 *F*», secções Commander/Deck/Sideboard). A edição indicada fica como estilo da carta.</p>
        <textarea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n...'} />
        <div className="row-btns">
          <select value={mode} onChange={e => setMode(e.target.value)}><option value="replace">Substituir o deck {deck.name}</option><option value="merge">Juntar ao deck</option></select>
          <button className="primary" onClick={go} disabled={!text.trim() || busy}>{busy ? 'A obter edições…' : 'Importar'}</button>
          <button onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
