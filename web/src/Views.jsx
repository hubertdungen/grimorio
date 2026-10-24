import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { search, recommend, similar, deckCombos, deckPlan, deckCuts, deckLinks, sideSuggest, fetchMeta, metaIndex, detectArchetype, STYLES, LEVELS, comboTurn, pctP, passes, fetchPrints, fetchEdh, TAG_LABEL, TYPES, TYPE_LABEL, COLORS, img, pidOf } from './data.js'
import { canBeCommander, landAdvice, targetsFor, maxCopies } from './formats.js'
import { deckIndices, stats, sampleHand, exportList } from './deck.js'
import { CardTile, Mana, Oracle, Tags, price, Empty } from './ui.jsx'
import Map3D from './Map3D.jsx'
import { autoBuild } from './autobuild.js'
import { deckSynergy } from './synergy.js'
import { manaNeeds, recommendLands } from './mana.js'

// Co-ocorrência em decks reais: comandantes + as 8 sementes mais recentes. Map(carta -> [{kind, from, incl, pot, lift, syn}])
function useEdhrec(data, cmdIdx, seeds) {
  const [co, setCo] = useState(null)
  const key = [...cmdIdx.map(i => 'c' + i), ...seeds.filter(i => !cmdIdx.includes(i)).slice(0, 8)].join(',')
  useEffect(() => {
    if (!key) { setCo(null); return }
    let live = true
    const srcs = key.split(',').map(k => (k[0] === 'c' ? { kind: 'commanders', i: +k.slice(1) } : { kind: 'cards', i: +k }))
    Promise.all(srcs.map(s => fetchEdh(s.kind, data.cards[s.i].n).then(d => ({ ...s, d })))).then(all => {
      if (!live) return
      const m = new Map()
      for (const { kind, i, d } of all) {
        const from = data.cards[i].n
        for (const [n, num, pot, lift, syn] of d.cards || []) {
          const c = data.byName.get(n) || data.byLower.get(n.toLowerCase())
          if (!c || !pot || (kind === 'cards' && !lift)) continue
          if (!m.has(c.i)) m.set(c.i, [])
          m.get(c.i).push({ kind, from, incl: num / pot, pot, lift, syn })
        }
      }
      setCo(m)
    })
    return () => { live = false }
  }, [key, data])
  return co
}

// Meta de torneios do formato (só construído), já indexada para as cartas da base.
function useMeta(data, fmt) {
  const [meta, setMeta] = useState(null)
  useEffect(() => {
    let live = true
    setMeta(null)
    fetchMeta(fmt.key).then(raw => { if (live) setMeta(metaIndex(data, raw, fmt.name)) })
    return () => { live = false }
  }, [data, fmt])
  return meta
}

// Gosto: centro (embeddings) das cartas dos decks escolhidos. Devolve [{name, vec, idx}].
const deckCache = new Map()
const getDeck = id => { if (!deckCache.has(id)) deckCache.set(id, fetch(`/api/decks/${id}`).then(r => r.json()).catch(() => null)); return deckCache.get(id) }
function useTastes(data, deck) {
  const pf = deck.prefs
  const [t, setT] = useState([])
  const key = pf?.on && pf.gosto && pf.gosto !== 'off' ? `${pf.gosto}|${(pf.gostoDecks || []).join(',')}|${deck.id}` : ''
  useEffect(() => {
    if (!key) { setT([]); return }
    let live = true
    fetch('/api/decks').then(r => r.json()).then(list => {
      const ids = pf.gosto === 'todos' ? list.filter(d => d.id !== deck.id).map(d => d.id) : (pf.gostoDecks || [])
      return Promise.all(ids.slice(0, 12).map(getDeck))
    }).then(ds => {
      if (!live) return
      const out = []
      for (const d of ds.filter(Boolean)) {
        const idx = [...(d.commanders || []), ...Object.keys(d.main || {})].map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land').map(c => c.i)
        if (idx.length < 5) continue
        const vec = new Float32Array(data.D)
        for (const i of idx) for (let k = 0; k < data.D; k++) vec[k] += data.emb[i * data.D + k]
        const nrm = Math.hypot(...vec) || 1
        for (let k = 0; k < data.D; k++) vec[k] /= nrm
        out.push({ name: d.name, vec, idx })
      }
      setT(out)
    }).catch(() => setT([]))
    return () => { live = false }
  }, [key, data]) // eslint-disable-line react-hooks/exhaustive-deps
  return t
}

// Personalização opcional das sugestões (fica guardada no deck).
export function PrefsPanel({ deck, fmt, act, compact = false }) {
  const pf = deck.prefs || {}
  const [open, setOpen] = useState(!compact && pf.on)
  const [decks, setDecks] = useState([])
  useEffect(() => { if (open) fetch('/api/decks').then(r => r.json()).then(setDecks).catch(() => {}) }, [open])
  const set = p => act.setPrefs(p)
  const nivel = pf.nivel ?? 3, meta = pf.meta ?? 0.5
  const summary = pf.on ? [LEVELS[nivel], meta < 0.3 ? 'original' : meta > 0.7 ? 'segue o meta' : '', ...(pf.estilo || []).map(k => STYLES[k]?.label), pf.gosto && pf.gosto !== 'off' ? 'ao teu gosto' : '', pf.orcamento ? `≤ ${pf.orcamento} €` : ''].filter(Boolean).join(' · ') : 'desligada: sugestão completa, sem viés'
  return (
    <div className={`prefs ${pf.on ? 'on' : ''}`}>
      <button className="prefs-head" onClick={() => setOpen(!open)}>
        <span>⚙ Personalizar</span><small className="muted">{summary}</small><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="prefs-body">
          <label className="switch"><input type="checkbox" checked={!!pf.on} onChange={e => set({ on: e.target.checked })} /> <span>{pf.on ? 'Personalização ligada' : 'Ligar personalização (opcional)'}</span></label>
          <fieldset disabled={!pf.on}>
            <label className="sl"><span>Nível de jogo <b>{LEVELS[nivel]}</b>{fmt.cmd === 'commander' ? <em> · bracket {nivel}</em> : null}</span>
              <input type="range" min="1" max="5" step="1" value={nivel} onChange={e => set({ nivel: +e.target.value })} />
              <span className="sl-ends"><i>fun/jank</i><i>competitivo</i></span>
            </label>
            <label className="sl"><span>Seguir o meta <b>{meta < 0.3 ? 'original' : meta > 0.7 ? 'staples' : 'equilibrado'}</b></span>
              <input type="range" min="0" max="1" step="0.1" value={meta} onChange={e => set({ meta: +e.target.value })} />
              <span className="sl-ends"><i>pouco jogadas</i><i>o que todos jogam</i></span>
            </label>
            <div className="sl"><span>Estilo e viés <em>(vários)</em></span>
              <div className="fchips">{Object.entries(STYLES).map(([k, S]) => {
                const on = (pf.estilo || []).includes(k)
                return <button key={k} className={`fchip ${on ? 'on' : ''}`} onClick={() => set({ estilo: on ? pf.estilo.filter(x => x !== k) : [...(pf.estilo || []), k] })}>{S.label}</button>
              })}</div>
            </div>
            {(pf.estilo || []).length > 0 && (
              <label className="sl"><span>Força do estilo <b>{(pf.estiloForca ?? 1).toFixed(2).replace('.', ',')}×</b> <em>· automaticamente menor quanto mais segues o meta</em></span>
                <input type="range" min="0.5" max="2" step="0.25" value={pf.estiloForca ?? 1} onChange={e => set({ estiloForca: +e.target.value })} />
                <span className="sl-ends"><i>só um toque</i><i>manda no deck</i></span>
              </label>
            )}
            <label className="sl"><span>Inspirar-me nos meus decks</span>
              <select value={pf.gosto || 'off'} onChange={e => set({ gosto: e.target.value })}>
                <option value="off">Não</option><option value="todos">Todos os meus decks</option><option value="escolher">Escolher decks…</option>
              </select>
            </label>
            {pf.gosto === 'escolher' && (
              <div className="deck-checks">{decks.filter(d => d.id !== deck.id).map(d => {
                const on = (pf.gostoDecks || []).includes(d.id)
                return <label key={d.id} className="chk"><input type="checkbox" checked={on} onChange={() => set({ gostoDecks: on ? pf.gostoDecks.filter(x => x !== d.id) : [...(pf.gostoDecks || []), d.id] })} /> {d.name} <span className="muted">({d.count})</span></label>
              })}{decks.length <= 1 && <p className="muted small">Ainda não há outros decks guardados.</p>}</div>
            )}
            <label className="sl"><span>Orçamento por carta <b>{pf.orcamento ? `até ${pf.orcamento} €` : 'sem limite'}</b></span>
              <input type="range" min="0" max="50" step="1" value={pf.orcamento || 0} onChange={e => set({ orcamento: +e.target.value || null })} />
            </label>
          </fieldset>
        </div>
      )}
    </div>
  )
}

// Sugestões do deck: sementes explícitas, ou o deck (comandantes e últimas cartas juntadas primeiro).
function useDeckRecs(data, deck, fmt, ctx0, filters0, limit) {
  const pf = deck.prefs?.on ? deck.prefs : null
  const ctx = useMemo(() => {
    if (fmt.cmd || ctx0.identity != null) return ctx0
    const spells = Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land')
    if (spells.length < 8) return ctx0 // ainda a explorar: todas as cores
    return { ...ctx0, identity: [...new Set(spells.flatMap(c => [...c.ci]))].join('') }
  }, [ctx0, fmt, deck.main, data])
  const filters = useMemo(() => (pf?.orcamento ? { ...(filters0 || {}), priceMax: pf.orcamento } : filters0), [filters0, pf?.orcamento])
  const tastes = useTastes(data, deck)
  const seedsIdx = useMemo(() => deck.seeds.map(n => data.byName.get(n)).filter(Boolean).map(c => c.i), [data, deck.seeds])
  const have = useMemo(() => deckIndices(deck, data), [deck, data])
  const cmdIdx = useMemo(() => deck.commanders.map(n => data.byName.get(n)?.i).filter(x => x != null), [data, deck.commanders])
  const seeds = useMemo(() => {
    if (seedsIdx.length) return seedsIdx
    const main = Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land').map(c => c.i).reverse()
    return [...cmdIdx, ...main]
  }, [seedsIdx, cmdIdx, deck.main, data])
  const deckStats = useMemo(() => stats(deck, data), [deck, data])
  const needs = useMemo(() => {
    if (deckStats.spells + deckStats.lands < 10) return {}
    return Object.fromEntries(Object.entries(targetsFor(fmt, deckPlan(data, deckIndices(deck, data)), deck.prefs)).map(([t, n]) => [t, [deckStats.tags[t] || 0, n]]))
  }, [deckStats, fmt, data, deck])
  const co = useEdhrec(data, cmdIdx, seeds)
  const meta = useMeta(data, fmt)
  const archetype = useMemo(() => detectArchetype(meta, have), [meta, have])
  const bracket = fmt.cmd === 'commander' ? (deck.bracket ? +deck.bracket : pf?.nivel && pf.nivel <= 3 ? pf.nivel : null) : null
  const gcCount = useMemo(() => have.filter(i => data.cards[i].gc).length, [have, data])
  const recs = useMemo(() => recommend(data, { seeds, have: [...new Set([...have, ...seedsIdx])], ctx, filters, limit, commanders: cmdIdx, needs, co, deckStats, bracket, gcCount, meta, archetype, prefs: deck.prefs, tastes, deckSize: fmt.size[0] >= 99 ? 99 : Math.max(40, fmt.size[0] || 60), turn: comboTurn(fmt) }),
    [data, seeds, have, seedsIdx, ctx, filters, limit, cmdIdx, needs, co, deckStats, bracket, gcCount, meta, archetype, deck.prefs, tastes, fmt])
  const plan = useMemo(() => deckPlan(data, have), [data, have])
  return { recs, seeds, seedsIdx, have, usingDeck: !seedsIdx.length, plan, co, cmdIdx, needs, bracket, meta, archetype, tastes }
}

const Why = ({ why }) => <ul className="why">{why.map((w, k) => <li key={k} className={w.k}>{w.combo ? <a href={`https://commanderspellbook.com/combo/${w.combo}/`} target="_blank" rel="noreferrer">{w.txt}</a> : w.txt}</li>)}</ul>

const PART_LABEL = { estilo: 'Estilo escolhido', gosto: 'O teu gosto', original: 'Originalidade', torneios: 'Torneios (MTGTop8)', texto: 'Texto parecido', comandante: 'Comandante', decksReais: 'Decks reais (EDHREC)', combos: 'Combos', interacoes: 'Interações', falta: 'O que falta ao deck', tribo: 'Tribo e palavras-chave', popular: 'Popularidade', testes: 'Testes do Laboratório' }
const pct = x => `${Math.min(99, Math.round(x * 100))}%`

// O raciocínio inteiro de uma sugestão: peso de cada fator e os dados por trás.
function WhyDetail({ r }) {
  const { parts, detail: d } = r
  const max = Math.max(...Object.values(parts), 0.01)
  return (
    <div className="whyd">
      {Object.entries(parts).filter(([, v]) => Math.abs(v) > 0.004).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
        <div key={k} className="whyd-bar"><span>{PART_LABEL[k]}</span><i style={{ width: `${Math.max(2, (v / max) * 100)}%` }} className={v < 0 ? 'neg' : ''} /><em>{(v * 100).toFixed(0)}</em></div>
      ))}
      {d.mArch && <p>Nas listas de <b>{d.mArch.name}</b> (MTGTop8), {pct(d.mArch.incl)} usam-na, com {d.mArch.copies.toFixed(1).replace('.', ',')} cópias em média.</p>}
      {d.mRow && <p>Em {pct(d.mRow.incl)} das {d.metaDecks} listas recentes de {d.metaName}{d.mRow.copies ? ` (≈${d.mRow.copies.toFixed(1).replace('.', ',')} cópias)` : ''}{d.mRow.side ? `; em ${pct(d.mRow.side)} dos sideboards` : ''}.</p>}
      {d.mPart?.length > 0 && <p>Em torneios aparece com: {d.mPart.map(p => `${p.from} (${pct(p.cond)} das listas dela)`).join('; ')}.</p>}
      {d.edhCmd && <p>No EDHREC, <b>{pct(d.edhCmd.incl)}</b> dos {d.edhCmd.pot.toLocaleString('pt-PT')} decks de {d.edhCmd.from} usam-na; sinergia <b>{d.edhCmd.syn > 0 ? '+' : ''}{pct(d.edhCmd.syn)}</b> face a decks das mesmas cores.</p>}
      {d.edhCards.length > 0 && <p>Aparece com: {d.edhCards.map(e => `${e.from} (${e.lift.toFixed(1).replace('.', ',')}×, ${pct(e.incl)} dos decks dela)`).join('; ')}.</p>}
      {d.combos.map(cb => (
        <p key={cb.id}><a href={`https://commanderspellbook.com/combo/${cb.id}/`} target="_blank" rel="noreferrer">Combo</a> com {cb.with.join(' + ')}{cb.missing.length ? <> (falta {cb.missing.join(', ')})</> : null}: {cb.produces.join(', ')}{cb.requires.length ? `; precisa também de ${cb.requires.join(', ')}` : ''}{cb.decks ? ` · ${cb.decks.toLocaleString('pt-PT')} decks` : ''}.</p>
      ))}
      {d.inter.map((x, k) => <p key={k}>{x.side === 'usa' ? 'Aproveita' : 'Alimenta'} {x.who.length} carta{x.who.length > 1 ? 's' : ''} que {x.label}: {x.who.slice(0, 6).join(', ')}{x.who.length > 6 ? '…' : ''}.</p>)}
      {d.roles.length > 0 && <p className="muted">Papéis desta carta: {d.roles.join(', ')}.</p>}
      <p className="muted">Pelo texto, está mais perto do deck do que {pct(d.simPct)} das cartas{d.near ? ` (a mais próxima é ${d.near})` : ''}{d.cmdPct != null ? `, e mais perto do comandante do que ${pct(d.cmdPct)}` : ''}.</p>
    </div>
  )
}

// Filtro das sugestões: razão (porque é sugerida) e função (o que faz), com contadores.
const REASONS = [['', 'Tudo', '✦'], ['combo', 'Combos', '∞'], ['edh', 'Decks reais', '◉'], ['meta', 'Torneios', '♜'], ['inter', 'Interações', '⇄'], ['falta', 'O que falta', '◔'], ['estilo', 'Estilo', '◆'], ['gosto', 'O teu gosto', '♥'], ['testes', 'Testes', '⚗']]
const FUNC_TAGS = ['creature', 'wincon', 'reanimate', 'ramp', 'draw', 'removal', 'wipe', 'counter', 'tutor', 'protection', 'recursion', 'tokens', 'sacrifice', 'counters', 'lifegain', 'graveyard', 'etb', 'spellslinger', 'artifacts', 'enchantments', 'discard', 'evasion']
const hasKind = (r, k) => !k || r.why.some(w => w.k === k || (k === 'combo' && w.k === 'combo2'))
const applyFilter = (recs, kind, tag) => recs.filter(r => hasKind(r, kind) && (!tag || r.c.tg.includes(tag)))

function ReasonFilter({ recs, kind, setKind, tag, setTag, needs = {}, extra = null }) {
  const base = applyFilter(recs, '', tag)
  const tags = FUNC_TAGS.map(t => ({ t, n: applyFilter(recs, kind, t).length, gap: needs[t] ? Math.max(0, needs[t][1] - needs[t][0]) : 0 }))
    .filter(x => x.n || x.gap).sort((a, b) => (b.gap > 0) - (a.gap > 0) || b.gap - a.gap || b.n - a.n)
  return (
    <div className="rfilter">
      <div className="seg" role="tablist" aria-label="Razão">
        {REASONS.map(([k, l, ic]) => {
          const n = base.filter(r => hasKind(r, k)).length
          if (k && !n && kind !== k) return null
          return (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} title={l}>
              <i>{ic}</i><span>{l}</span><b>{n}</b>
            </button>
          )
        })}
        {extra}
      </div>
      {tags.length > 0 && (
        <div className="fchips" aria-label="Função">
          {tag && <button className="fchip clear" onClick={() => setTag('')}>× todas as funções</button>}
          {tags.map(x => (
            <button key={x.t} className={`fchip ${tag === x.t ? 'on' : ''} ${x.gap ? 'gap' : ''}`} onClick={() => setTag(tag === x.t ? '' : x.t)}
              title={x.gap ? `O deck tem ${needs[x.t][0]} de ${needs[x.t][1]} recomendadas` : ''}>
              {TAG_LABEL[x.t]}<b>{x.n}</b>{x.gap > 0 && <em>faltam {x.gap}</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
const NOLANDS = { noLands: true }

// Base de mana: equilíbrio de terrenos, fontes por cor e terrenos sugeridos (com mecânica).
function ManaBlock({ data, deck, fmt, ctx, act, co, limit = 4, full = false }) {
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const lands = useMemo(() => recommendLands(data, { deck, fmt, ctx, co, need, limit: full ? 12 : limit }), [data, deck, fmt, ctx, co, need, limit, full])
  const short = Object.entries(need.cols).filter(([, x]) => x.have < x.need)
  const nLand = need.lands
  return (
    <div className="mana-block">
      <p className="small">
        <b>{nLand}</b> terrenos {need.deficit > 1 ? <span className="bad-t">({need.deficit} a menos para esta fase do deck)</span> : need.deficit < -2 ? <span className="bad-t">({-need.deficit} a mais)</span> : <span className="ok-t">(equilibrado)</span>}
        <span className="muted"> · alvo ~{need.target} em {need.total}{need.tapped ? ` · ${need.tapped} entram virados` : ''}</span>
      </p>
      <div className="srcs">
        {Object.entries(need.cols).map(([k, x]) => (
          <span key={k} className={`src ${x.have < x.need ? 'low' : ''}`} title={`${x.pips} símbolos de ${k}; o custo mais exigente tem ${x.maxPips}. Recomendado ~${x.full} fontes com a base de mana completa.`}>
            <img src={`https://svgs.scryfall.io/card-symbols/${k}.svg`} alt={k} /> {x.have}/{x.need}
          </span>
        ))}
      </div>
      {short.length > 0 && <p className="small bad-t">Faltam fontes de {short.map(([k]) => k).join(', ')}: os terrenos abaixo dão prioridade a essas cores.</p>}
      <ul className="land-list">
        {lands.map(r => (
          <li key={r.c.i} {...hoverPeek(r.c)}>
            <button className="live-img" onClick={() => act.open(r.c)}><img src={img(r.c, 'art_crop')} alt="" loading="lazy" /></button>
            <div className="live-txt">
              <div className="live-name"><button className="link plain" onClick={() => act.open(r.c)}>{r.c.n}</button></div>
              <Why why={r.why} />
            </div>
            <button className="act add" onClick={() => act.add(r.c)} title="Juntar ao deck">+</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Painel ao lado da pesquisa: muda a cada carta que entra no deck.
function LivePanel({ data, deck, fmt, ctx, act }) {
  const [open, setOpen] = useState(() => !matchMedia('(max-width: 900px)').matches) // no telemóvel começa fechado
  const [kind, setKind] = useState('')
  const [tag, setTag] = useState('')
  const [exp, setExp] = useState(null)
  const { recs: all, seeds, plan, bracket, co, archetype, meta, needs } = useDeckRecs(data, deck, fmt, ctx, NOLANDS, 60)
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const landsFirst = need.deficit > 2 || Object.values(need.cols).some(x => x.have < x.need * 0.7)
  const recs = applyFilter(all, kind === 'terrenos' ? '' : kind, tag).slice(0, 15)
  return (
    <aside className={`live ${open ? 'open' : ''}`}>
      <button className="live-head" onClick={() => setOpen(!open)}>
        <b>Sugestões para este deck</b><span className="muted small">{seeds.length ? `a partir de ${seeds.length} carta${seeds.length > 1 ? 's' : ''}` : ''}</span><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="live-prefs"><PrefsPanel {...{ deck, fmt, act }} compact /></div>}
      {open && seeds.length > 0 && (
        <div className="live-meta">
          {plan.length > 0 && <p className="small"><span className="muted">Plano detetado:</span> {plan.map(x => <span key={x.label} className="plan-chip">{x.label} <b>{x.n}</b></span>)}</p>}
          {archetype && <p className="small"><span className="muted">Arquétipo provável:</span> <span className="plan-chip arch">{archetype.name}</span> <span className="muted">{Math.round(archetype.fit * 100)}% do núcleo · {Math.round(archetype.share * 100)}% do meta</span></p>}
          {meta && !archetype && seeds.length >= 4 && <p className="small muted">Ainda não parece nenhum arquétipo do meta de {fmt.name}.</p>}
          {bracket && <p className="small muted">Bracket {bracket}: {bracket <= 2 ? 'sem Game Changers nem combos' : bracket === 3 ? 'até 3 Game Changers' : 'sem limites'}.</p>}
          <ReasonFilter recs={all} kind={kind === 'terrenos' ? '__' : kind} setKind={setKind} tag={tag} setTag={setTag} needs={needs}
            extra={<button role="tab" aria-selected={kind === 'terrenos'} className={kind === 'terrenos' ? 'on' : ''} onClick={() => setKind(kind === 'terrenos' ? '' : 'terrenos')} title="Terrenos"><i>▤</i><span>Terrenos</span></button>} />
        </div>
      )}
      {open && seeds.length > 0 && kind !== 'terrenos' && landsFirst && (
        <div className="mana-sec"><h4>Base de mana · prioridade</h4><ManaBlock {...{ data, deck, fmt, ctx, act, co }} /></div>
      )}
      {open && seeds.length > 0 && kind === 'terrenos' && <div className="mana-sec"><ManaBlock {...{ data, deck, fmt, ctx, act, co }} limit={12} /></div>}
      {open && kind !== 'terrenos' && (seeds.length ? (
        <ul className="live-list">
          {recs.map(r => (
            <li key={r.c.i} {...hoverPeek(r.c, pidOf(deck, r.c.n))}>
              <button className="live-img" onClick={() => act.open(r.c)}><img src={img(r.c, 'art_crop', false, pidOf(deck, r.c.n))} alt="" loading="lazy" /></button>
              <div className="live-txt">
                <div className="live-name"><button className="link plain" onClick={() => act.open(r.c)}>{r.c.n}</button><Mana cost={r.c.mc} /></div>
                <Why why={r.why} />
                <button className="link small whyb" onClick={() => setExp(exp === r.c.i ? null : r.c.i)}>{exp === r.c.i ? 'esconder' : 'porquê? ▾'}</button>
                {exp === r.c.i && <WhyDetail r={r} />}
              </div>
              <span className="live-acts"><button className="act add" onClick={() => act.add(r.c)} title="Juntar ao deck">+</button><button className="act art" onClick={() => act.pickArt(r.c)} title="Escolher arte">🎨</button></span>
            </li>
          ))}
          {!recs.length && <li className="muted small">Nenhuma sugestão com este tipo de razão.</li>}
          {!landsFirst && !kind && !tag && <li className="mana-sec-li"><h4>Base de mana</h4><ManaBlock {...{ data, deck, fmt, ctx, act, co }} limit={3} /></li>}
        </ul>
      ) : <p className="muted small live-empty">Junta o comandante ou umas cartas e as sugestões aparecem aqui, com o porquê de cada uma.</p>)}
    </aside>
  )
}

// Completar deck: calcula, mostra agrupado com o porquê, e só aplica o que ficar marcado.
export function AutoBuildDialog({ data, deck, fmt, ctx, setDeck, say, onClose, act }) {
  const cmdIdx = useMemo(() => deck.commanders.map(n => data.byName.get(n)?.i).filter(x => x != null), [data, deck.commanders])
  const co = useEdhrec(data, cmdIdx, cmdIdx)
  const meta = useMeta(data, fmt)
  const tastes = useTastes(data, deck)
  const [res, setRes] = useState(null)
  const [off, setOff] = useState(() => new Set())
  const prefsKey = JSON.stringify(deck.prefs || {}) + tastes.length
  useEffect(() => { setRes(null); setOff(new Set()) }, [prefsKey])
  const [waited, setWaited] = useState(false)
  useEffect(() => { const t = setTimeout(() => setWaited(true), 5000); return () => clearTimeout(t) }, [])
  const ready = (!cmdIdx.length || co != null || waited) && (meta != null || waited || !['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern'].includes(fmt.key))
  useEffect(() => {
    if (!ready || res) return
    const t = setTimeout(() => setRes(autoBuild(data, deck, fmt, { ctx, co, meta, prefs: deck.prefs, tastes, bracket: fmt.cmd === 'commander' ? deck.bracket || (deck.prefs?.on && deck.prefs.nivel <= 3 ? deck.prefs.nivel : null) : null })), 30)
    return () => clearTimeout(t)
  }, [ready, res, data, deck, fmt, ctx, co, meta, tastes])
  const groups = {}
  for (const a of res?.adds || []) (groups[a.group] ||= []).push(a)
  const chosen = (res?.adds || []).filter(a => !off.has(a.c.i))
  const n = chosen.reduce((s, a) => s + a.q, 0)
  // Sideboard proposto (formatos com sideboard, até ao limite): primeiro o que a meta (MTGTop8) leva no sideboard,
  // depois respostas por tipo de ameaça nas cores do deck final, alternando entre tipos.
  const [sideOff, setSideOff] = useState(() => new Set())
  const sideProp = useMemo(() => {
    const room = (fmt.side || 0) - Object.values(deck.side).reduce((a, b) => a + b, 0)
    if (!res?.adds?.length || room <= 0) return []
    const sim = { ...deck, main: { ...deck.main } }
    for (const a of res.adds) sim.main[a.c.n] = (sim.main[a.c.n] || 0) + a.q
    const cols = new Set(Object.keys(sim.main).flatMap(k => [...(data.byName.get(k)?.ci || '')]))
    const out = []
    let left = room
    const put = (c, q, why) => {
      q = Math.min(q, left, maxCopies(c, fmt, ctx.bit) - (sim.main[c.n] || 0))
      if (q > 0 && !sim.main[c.n] && !out.some(x => x.c.i === c.i)) { out.push({ c, q, why }); left -= q }
    }
    if (meta) for (const [i, m] of [...meta.byCard.entries()].filter(([, m]) => m.side >= 0.08).sort((a, b) => b[1].side - a[1].side)) {
      const c = data.cards[i]
      if (left > 0 && passes(c, null, ctx) && [...c.ci].every(k => cols.has(k))) put(c, Math.max(1, Math.round(m.sideCopies)), `em ${Math.round(m.side * 100)}% dos sideboards de ${fmt.name}`)
    }
    const cats = sideSuggest(data, sim, ctx, 4)
    for (let k = 0; k < 4 && left > 0; k++) for (const g of cats) if (g.cards[k]) put(g.cards[k], 2, `${g.label.toLowerCase()} · MV ${g.cards[k].cmc}, muito jogada`)
    return out
  }, [res, fmt, deck, data, ctx, meta])
  const sideChosen = sideProp.filter(x => !sideOff.has(x.c.i)), sn = sideChosen.reduce((s, x) => s + x.q, 0)
  const apply = () => {
    setDeck(d => {
      const main = { ...d.main }, side = { ...d.side }
      for (const a of chosen) main[a.c.n] = (main[a.c.n] || 0) + a.q
      for (const x of sideChosen) side[x.c.n] = (side[x.c.n] || 0) + x.q
      return { ...d, main, side }
    })
    say(`Juntei ${n} cartas ao deck${sn ? ` e ${sn} ao sideboard` : ''}.`)
    onClose()
  }
  const order = Object.keys(groups).sort((a, b) => (a.startsWith('Função') ? 0 : a === 'Sinergia' ? 1 : 2) - (b.startsWith('Função') ? 0 : b === 'Sinergia' ? 1 : 2))
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal auto" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fechar">×</button>
        <h3>Completar deck · {fmt.name}</h3>
        {act && <PrefsPanel {...{ deck, fmt, act }} compact />}
        {!res ? <div className="auto-wait"><div className="spinner" /><p className="muted">A montar: funções em falta, sinergia com o plano e base de mana…</p></div>
          : res.msg ? <p>{res.msg}</p> : (
            <>
              <p className="muted small">Proposta de {res.adds.reduce((s, a) => s + a.q, 0)} cartas. Desmarca o que não quiseres; nada muda no deck até carregares em Aplicar.</p>
              {res.offColor?.length > 0 && <p className="small bad-t">Cores principais: {res.colors}. Fora delas (pedem splash ou saem): {res.offColor.join(', ')}.</p>}
              {res.combos?.length > 0 && (
                <div className="auto-combos">
                  <b>Combos no deck final</b> <span className="muted small">probabilidade de os ter montado até ao turno {res.turn} ({res.tutors} tutor{res.tutors === 1 ? '' : 'es'}; aproximação)</span>
                  <ul>{res.combos.map(x => <li key={x.id}><span className="cp">≈{pctP(x.p)}</span> {x.cards.join(' + ')} <span className="muted">→ {x.result}</span></li>)}</ul>
                </div>
              )}
              <div className="auto-list">
                {order.map(g => (
                  <section key={g}>
                    <h4>{g} <span className="muted">{groups[g].reduce((s, a) => s + a.q, 0)}</span></h4>
                    <ul>{groups[g].map(a => (
                      <li key={a.c.i} className={off.has(a.c.i) ? 'off' : ''}>
                        <input type="checkbox" checked={!off.has(a.c.i)} onChange={() => setOff(o => { const x = new Set(o); x.has(a.c.i) ? x.delete(a.c.i) : x.add(a.c.i); return x })} aria-label={a.c.n} />
                        <b className="q">{a.q}</b>
                        <div><button className="link plain" onMouseEnter={e => showCardPeek(e, a.c)} onMouseLeave={hideCardPeek}>{a.c.n}</button> <Mana cost={a.c.mc} /><small className="muted">{a.why}</small></div>
                      </li>
                    ))}</ul>
                  </section>
                ))}
              </div>
              {sideProp.length > 0 && (
                <div className="auto-list auto-side">
                  <section>
                    <h4>Sideboard sugerido <span className="muted">{sn}/{fmt.side} · desmarca o que não quiseres; depois ajusta no deck</span></h4>
                    <ul>{sideProp.map(x => (
                      <li key={x.c.i} className={sideOff.has(x.c.i) ? 'off' : ''}>
                        <input type="checkbox" checked={!sideOff.has(x.c.i)} onChange={() => setSideOff(o => { const y = new Set(o); y.has(x.c.i) ? y.delete(x.c.i) : y.add(x.c.i); return y })} aria-label={x.c.n} />
                        <b className="q">{x.q}</b>
                        <div><button className="link plain" onMouseEnter={e => showCardPeek(e, x.c)} onMouseLeave={hideCardPeek}>{x.c.n}</button> <Mana cost={x.c.mc} /><small className="muted">{x.why}</small></div>
                      </li>
                    ))}</ul>
                  </section>
                </div>
              )}
              <div className="row-btns"><button className="primary" onClick={apply} disabled={!n && !sn}>Aplicar {n} cartas{sn ? ` + ${sn} no sideboard` : ''}</button><button onClick={onClose}>Cancelar</button></div>
            </>
          )}
      </div>
    </div>
  )
}

let peek
const hoverPeek = (c, pid) => ({ onMouseEnter: e => showCardPeek(e, c, pid), onMouseLeave: hideCardPeek })
function showCardPeek(e, c, pid) {
  if (!matchMedia('(hover: hover)').matches) return
  peek ||= Object.assign(document.body.appendChild(document.createElement('img')), { className: 'peek' })
  const r = e.currentTarget.getBoundingClientRect()
  peek.src = img(c, 'normal', false, pid)
  peek.style.top = `${Math.min(window.innerHeight - 350, Math.max(8, r.top - 120))}px`
  peek.style.left = `${Math.min(window.innerWidth - 250, r.right + 12)}px`
  peek.style.display = 'block'
}
function hideCardPeek() { if (peek) peek.style.display = 'none' }

const inDeck = (deck, n) => (deck.main[n] || 0) + (deck.side[n] || 0) + (deck.commanders.includes(n) ? 1 : 0) + (deck.signature === n ? 1 : 0)

function Actions({ c, deck, fmt, act }) {
  const q = inDeck(deck, c.n)
  return (
    <>
      <button className="act add" onClick={() => act.add(c)} title="Juntar ao deck">+{q ? <sup>{q}</sup> : null}</button>
      {fmt.side > 0 && <button className="act" onClick={() => act.add(c, 'side')} title="Juntar ao sideboard">SB</button>}
      {fmt.cmd && canBeCommander(c, fmt) && <button className={`act ${deck.commanders.includes(c.n) ? 'on' : ''}`} onClick={() => act.setCommander(c)} title={fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : 'Comandante'}>♛</button>}
      {fmt.cmd === 'oathbreaker' && /Instant|Sorcery/.test(c.t) && <button className={`act ${deck.signature === c.n ? 'on' : ''}`} onClick={() => act.setSignature(c)} title="Feitiço de assinatura">✦</button>}
      <button className={`act seed ${deck.seeds.includes(c.n) ? 'on' : ''}`} onClick={() => act.toggleSeed(c)} title="Semente das sugestões">★</button>
      <button className="act art" onClick={() => act.pickArt(c)} title="Escolher arte (edições e estilos)">🎨</button>
    </>
  )
}

function Filters({ f, set, compact, noTag }) {
  const up = (k, v) => set(x => ({ ...x, [k]: v }))
  const togColor = k => up('colors', f.colors.includes(k) ? f.colors.filter(x => x !== k) : [...f.colors, k])
  return (
    <div className="filters">
      <div className="colors">
        {Object.keys(COLORS).map(k => (
          <button key={k} className={`pip ${f.colors.includes(k) ? 'on' : ''}`} onClick={() => togColor(k)} title={COLORS[k]}>
            <img src={`https://svgs.scryfall.io/card-symbols/${k}.svg`} alt={k} />
          </button>
        ))}
        <button className={`pip ${f.colorless ? 'on' : ''}`} onClick={() => up('colorless', !f.colorless)} title="Incolor"><img src="https://svgs.scryfall.io/card-symbols/C.svg" alt="C" /></button>
        {f.colors.length > 0 && (
          <select value={f.colorMode} onChange={e => up('colorMode', e.target.value)} aria-label="Modo de cor">
            <option value="incl">inclui</option><option value="within">no máximo</option><option value="exact">exatamente</option>
          </select>
        )}
      </div>
      <select value={f.type} onChange={e => up('type', e.target.value)} aria-label="Tipo"><option value="">Todos os tipos</option>{TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}<option value="Legendary">Lendárias</option></select>
      {!noTag && <select value={f.tag} onChange={e => up('tag', e.target.value)} aria-label="Função"><option value="">Qualquer função</option>{Object.entries(TAG_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      <input value={f.sub} onChange={e => up('sub', e.target.value)} placeholder="Subtipo (Elf, Dragon…)" className="w-sub" />
      <span className="mv">MV <input type="number" min="0" value={f.cmcMin} onChange={e => up('cmcMin', e.target.value)} aria-label="Custo mínimo" />–<input type="number" min="0" value={f.cmcMax} onChange={e => up('cmcMax', e.target.value)} aria-label="Custo máximo" /></span>
      {!compact && <select value={f.rarity} onChange={e => up('rarity', e.target.value)} aria-label="Raridade"><option value="">Raridade</option><option value="c">Comum</option><option value="u">Incomum</option><option value="r">Rara</option><option value="m">Mítica</option></select>}
      <span className="mv">até <input type="number" min="0" step="0.5" value={f.priceMax} onChange={e => up('priceMax', e.target.value)} placeholder="€" aria-label="Preço máximo" /> €</span>
    </div>
  )
}

const F0 = { colors: [], colorMode: 'incl', colorless: false, type: '', tag: '', sub: '', cmcMin: '', cmcMax: '', rarity: '', priceMax: '', sort: 'pop', inText: false }

export function SearchView({ data, deck, fmt, ctx, act }) {
  const [q, setQ] = useState('')
  const [f, setF] = useState(F0)
  const dq = useDeferredValue(q), df = useDeferredValue(f)
  const res = useMemo(() => search(data, dq, df, ctx), [data, dq, df, ctx])
  const [showF, setShowF] = useState(false)
  const nActive = ['type', 'tag', 'sub', 'cmcMin', 'cmcMax', 'rarity', 'priceMax'].filter(k => f[k]).length + (f.colors.length ? 1 : 0) + (f.colorless ? 1 : 0)
  return (
    <div className="view">
      <div className="searchbar">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Procurar cartas por nome…" className="big" />
        <label className="chk"><input type="checkbox" checked={f.inText} onChange={e => setF(x => ({ ...x, inText: e.target.checked }))} /> também no texto</label>
        <select value={f.sort} onChange={e => setF(x => ({ ...x, sort: e.target.value }))} aria-label="Ordenar">
          <option value="pop">Mais jogadas</option><option value="name">Nome</option><option value="cmc">Custo</option><option value="price">Preço</option><option value="new">Mais recentes</option>
        </select>
      </div>
      <button className="filters-toggle" onClick={() => setShowF(!showF)}>Filtros{nActive ? ` (${nActive})` : ''} {showF ? '▴' : '▾'}</button>
      <div className={`filters-wrap ${showF ? 'open' : ''}`}><Filters f={f} set={setF} /></div>
      <div className="search-layout">
      <div>
      <p className="muted small">{res.total.toLocaleString('pt-PT')} cartas{ctx.bit >= 0 ? ` legais em ${fmt.name}` : ''}{ctx.identity != null ? ` na identidade ${ctx.identity || 'incolor'}` : ''}{res.total > res.cards.length ? ` · a mostrar ${res.cards.length}` : ''}</p>
      <div className="grid">
        {res.cards.map(c => <CardTile key={c.i} c={c} pid={pidOf(deck, c.n)} onOpen={act.open} actions={<Actions {...{ c, deck, fmt, act }} />} />)}
      </div>
      {!res.total && <Empty>Nenhuma carta com estes filtros.</Empty>}
      </div>
      <LivePanel {...{ data, deck, fmt, ctx, act }} />
      </div>
    </div>
  )
}

function SeedPicker({ data, ctx, act }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => (q.length < 2 ? [] : search(data, q, null, { ...ctx, identity: null }, 8).cards), [data, q, ctx])
  return (
    <div className="seedpick">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Junta uma carta de que gostas…" />
      {hits.length > 0 && (
        <ul className="ac">{hits.map(c => <li key={c.i}><button onClick={() => { act.toggleSeed(c); setQ('') }}><img src={img(c, 'small')} alt="" />{c.n}</button></li>)}</ul>
      )}
    </div>
  )
}

export function SuggestView({ data, deck, fmt, ctx, act, setDeck, sugTag, setSugTag }) {
  const [f, setF] = useState(() => ({ ...F0, tag: sugTag }))
  const df = useDeferredValue(f)
  const [kind, setKind] = useState('')
  const { recs: allSug, seeds, usingDeck, needs } = useDeckRecs(data, deck, fmt, ctx, df, 80)
  const recs = applyFilter(allSug, kind, '')
  return (
    <div className="view">
      <div className="seeds">
        <div>
          <h3>Sementes</h3>
          <p className="muted small">{usingDeck ? (seeds.length ? 'Sem sementes: as sugestões partem do deck inteiro.' : 'Escolhe 3 a 5 cartas de que gostas e o Grimório mostra o universo de cartas que combinam com elas.') : 'As sugestões partem destas cartas (e evitam o que já está no deck).'}</p>
        </div>
        <div className="chips">
          {deck.seeds.map(n => { const c = data.byName.get(n); return c && <span key={n} className="chip"><button className="link" onClick={() => act.open(c)}>{n}</button><button onClick={() => act.toggleSeed(c)} aria-label="Retirar">×</button></span> })}
          {deck.seeds.length > 0 && <button className="link small" onClick={() => setDeck(d => ({ ...d, seeds: [] }))}>limpar</button>}
        </div>
        <SeedPicker {...{ data, ctx, act }} />
      </div>
      <PrefsPanel {...{ deck, fmt, act }} />
      <Filters f={f} set={x => { setSugTag(''); setF(x) }} compact noTag />
      <ReasonFilter recs={allSug} kind={kind} setKind={setKind} tag={f.tag} setTag={t => { setSugTag(''); setF(x => ({ ...x, tag: t })) }} needs={needs} />
      {seeds.length > 0 && <p className="muted small">Classificadas por semelhança mecânica (modelo de texto local), combos do Commander Spellbook e popularidade. <button className="link" onClick={() => act.showOnMap(recs[0]?.c || data.cards[seeds[0]])}>Ver no universo →</button></p>}
      <div className="grid">
        {recs.map(r => (
          <CardTile key={r.c.i} c={r.c} onOpen={act.open} actions={<Actions {...{ c: r.c, deck, fmt, act }} />}
            note={<><Why why={r.why} /><details className="whyx"><summary className="small">porquê?</summary><WhyDetail r={r} /></details></>} />
        ))}
      </div>
      {!seeds.length && <Empty>Sem sementes nem cartas no deck. Junta uma carta acima.</Empty>}
    </div>
  )
}

// Universo: construir o deck dentro do mapa. Constelação do deck (combos e quem alimenta quem),
// sugestões a pulsar ligadas à carta com que interagem, explosão quando uma carta entra.
export function MapView({ data, deck, fmt, ctx, act, focus, setFocus }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(focus != null ? data.cards[focus] : null)
  const [onlyLegal, setOnlyLegal] = useState(true)
  const [foco, setFoco] = useState(false)
  const [follow, setFollow] = useState(true)
  const [showLines, setShowLines] = useState(true)
  const [hov, setHov] = useState(null)
  const [kind, setKind] = useState('')
  const [tag, setTag] = useState('')
  const [panel, setPanel] = useState(true)
  const { recs: allRecs, seeds, seedsIdx, have, plan, needs, tastes } = useDeckRecs(data, deck, fmt, ctx, NOLANDS, 60)
  const recs = useMemo(() => applyFilter(allRecs, kind, tag).slice(0, 18), [allRecs, kind, tag])
  const marks = useMemo(() => {
    const m = new Map()
    for (const t of tastes) for (const i of t.idx) m.set(i, 'mine')
    for (const i of have) m.set(i, 'deck')
    for (const r of recs) m.set(r.c.i, 'sugg')
    for (const i of seedsIdx) m.set(i, 'seed')
    if (hov != null) m.set(hov, 'hover')
    if (sel) m.set(sel.i, 'focus')
    return m
  }, [have, recs, seedsIdx, sel, hov, tastes])
  const deckL = useMemo(() => deckLinks(data, have, ctx), [data, have, ctx])
  // Cada sugestão liga-se à carta do deck com que interage (ou à mais parecida).
  const suggL = useMemo(() => recs.map(r => {
    const who = r.detail.inter[0]?.who[0] || r.detail.combos[0]?.with[0]
    let a = who ? data.byName.get(who)?.i : null
    if (a == null) {
      let bs = -1e9
      for (const s of seeds.slice(0, 16)) { let d = 0; for (let k = 0; k < data.D; k++) d += data.emb[s * data.D + k] * data.emb[r.c.i * data.D + k]; if (d > bs) { bs = d; a = s } }
    }
    return a == null ? null : { a, b: r.c.i, kind: 'sugg' }
  }).filter(Boolean), [recs, seeds, data])
  const links = useMemo(() => (showLines ? [...deckL, ...suggL] : []), [showLines, deckL, suggL])
  const tips = useMemo(() => new Map(recs.map(r => [r.c.i, r.why.slice(0, 2).map(w => w.txt).join(' · ')])), [recs])
  const dim = useMemo(() => {
    if (foco) return () => true // só fica aceso o que está marcado (deck, sugestões)
    return onlyLegal ? c => !passes(c, null, ctx) : null
  }, [foco, onlyLegal, ctx])
  const frame = useMemo(() => [...have, ...recs.slice(0, 8).map(r => r.c.i)], [have, recs])
  const hits = useMemo(() => (q.length < 2 ? [] : search(data, q, null, { bit: -1, identity: null, allowUn: true }, 8).cards), [data, q])
  const pick = useCallback(i => { setSel(data.cards[i]); setFocus(i) }, [data, setFocus])
  const addI = useCallback(i => act.add(data.cards[i]), [data, act])
  const selRec = sel && allRecs.find(r => r.c.i === sel.i)
  return (
    <div className="view mapview">
      <Map3D data={data} marks={marks} dim={dim} links={links} focus={focus} onPick={pick} onAdd={addI} frame={frame} follow={follow} tips={tips} />
      <div className="map-ui">
        <div className="seedpick">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Voar até uma carta…" />
          {hits.length > 0 && <ul className="ac">{hits.map(c => <li key={c.i}><button onClick={() => { pick(c.i); setQ('') }}><img src={img(c, 'small')} alt="" />{c.n}</button></li>)}</ul>}
        </div>
        <div className="map-toggles">
          <label className="chk"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> seguir o deck</label>
          <label className="chk"><input type="checkbox" checked={foco} onChange={e => setFoco(e.target.checked)} /> só deck e sugestões</label>
          <label className="chk"><input type="checkbox" checked={showLines} onChange={e => setShowLines(e.target.checked)} /> ligações</label>
          {!foco && <label className="chk"><input type="checkbox" checked={onlyLegal} onChange={e => setOnlyLegal(e.target.checked)} /> apagar as que não servem</label>}
        </div>
        {plan.length > 0 && <p className="small"><span className="muted">Plano:</span> {plan.map(x => <span key={x.label} className="plan-chip">{x.label} <b>{x.n}</b></span>)}</p>}
        <p className="muted small">{have.length ? `${have.length} cartas no deck · ${deckL.filter(l => l.kind === 'combo').length ? 'linhas douradas = combos · ' : ''}tracejado = quem alimenta quem` : 'Clica numa carta para a ver; duplo clique junta-a ao deck.'}</p>
      </div>

      {sel && (
        <div className="map-card">
          <img src={img(sel, 'normal', false, pidOf(deck, sel.n))} alt={sel.n} onClick={() => act.open(sel)} />
          {selRec && <Why why={selRec.why.slice(0, 3)} />}
          <div className="row-btns">
            <button className="primary" onClick={() => act.add(sel)}>+ Deck</button>
            <button onClick={() => act.toggleSeed(sel)}>{deck.seeds.includes(sel.n) ? '★' : '☆'} Semente</button>
            <button onClick={() => act.open(sel)}>Detalhes</button>
            <button onClick={() => setSel(null)} aria-label="Fechar">×</button>
          </div>
        </div>
      )}

      <aside className={`map-recs ${panel ? '' : 'closed'} ${sel ? 'with-card' : ''}`}>
        <button className="live-head" onClick={() => setPanel(!panel)}><b>Sugestões</b><span className="muted small">{seeds.length ? `${recs.length}` : ''}</span><span className="chev">{panel ? '▾' : '▸'}</span></button>
        {panel && <div className="live-prefs"><PrefsPanel {...{ deck, fmt, act }} compact /></div>}
        {panel && tastes.length > 0 && <p className="small muted map-taste">♥ {tastes.length} deck{tastes.length > 1 ? 's' : ''} teu{tastes.length > 1 ? 's' : ''} no mapa (violeta): {tastes.map(t => t.name).join(', ')}</p>}
        {panel && (seeds.length ? (
          <>
            <ReasonFilter recs={allRecs} kind={kind} setKind={setKind} tag={tag} setTag={setTag} needs={needs} />
            <ul className="live-list">
              {recs.map(r => (
                <li key={r.c.i} onMouseEnter={e => { setHov(r.c.i); showCardPeek(e, r.c) }} onMouseLeave={() => { setHov(null); hideCardPeek() }}>
                  <button className="live-img" onClick={() => pick(r.c.i)}><img src={img(r.c, 'art_crop')} alt="" loading="lazy" /></button>
                  <div className="live-txt">
                    <div className="live-name"><button className="link plain" onClick={() => pick(r.c.i)}>{r.c.n}</button><Mana cost={r.c.mc} /></div>
                    <Why why={r.why.slice(0, 2)} />
                  </div>
                  <button className="act add" onClick={() => act.add(r.c)} title="Juntar ao deck">+</button>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="muted small live-empty">Junta o comandante ou umas cartas (duplo clique num ponto) e as sugestões aparecem a pulsar à volta do deck.</p>)}
      </aside>
    </div>
  )
}

function Combo({ data, cb, missing, act, deck }) {
  const [id, idx, produces, requires, , pop, bracket] = cb
  return (
    <li className="combo">
      <div className="combo-cards">
        {idx.map(i => {
          const c = data.cards[i], miss = missing.includes(i)
          return (
            <button key={i} className={`mini ${miss ? 'miss' : ''}`} onClick={() => act.open(c)} title={c.n}>
              <img src={img(c, 'small')} alt={c.n} loading="lazy" />
              {miss && <span>falta</span>}
            </button>
          )
        })}
      </div>
      <div className="combo-txt">
        <b>{produces.join(' · ') || 'Combo'}</b>
        {requires.length > 0 && <small>Precisa também de: {requires.join(', ')}</small>}
        <small className="muted">{idx.map(i => data.cards[i].n).join(' + ')}{pop ? ` · ${pop.toLocaleString('pt-PT')} decks` : ''}{bracket ? ` · bracket ${bracket}` : ''}</small>
        <span className="row-btns">
          {missing.map(i => <button key={i} className="primary" onClick={() => act.add(data.cards[i])} disabled={inDeck(deck, data.cards[i].n) > 0}>+ {data.cards[i].n}</button>)}
          <a href={`https://commanderspellbook.com/combo/${id}/`} target="_blank" rel="noreferrer">passos ↗</a>
        </span>
      </div>
    </li>
  )
}

// Cartas do deck numa categoria de sinergia: nome com cópias, espreitar ao passar, abrir ao tocar.
function SynChips({ list, deck, act, max = 10 }) {
  const [all, setAll] = useState(false)
  if (!list.length) return <span className="muted small">nenhuma ainda</span>
  return (
    <span className="syn-chips">
      {(all ? list : list.slice(0, max)).map(({ c, q }) => <button key={c.i} className="syn-chip" onClick={() => act.open(c)} {...hoverPeek(c, pidOf(deck, c.n))}>{q > 1 && <b>{q}×</b>}{c.n.split(' // ')[0]}</button>)}
      {list.length > max && !all && <button className="syn-chip more" onClick={() => setAll(true)}>+{list.length - max}</button>}
    </span>
  )
}

function SynCat({ x, deck, act }) {
  const { s, en, pay, E, P, strength, reasons, sug } = x
  const pct = Math.round(strength * 100)
  return (
    <li className="syn">
      <div className="syn-h">
        <span className="syn-ic" aria-hidden>{s.ic}</span><b>{s.name}</b>
        <span className="syn-bar" title={`Força ${pct}%`}><i style={{ width: `${pct}%` }} /></span><span className="syn-pct">{pct}%</span>
      </div>
      <p className="syn-why">{s.why}</p>
      {reasons.map(r => <p key={r} className="syn-warn">{r}</p>)}
      <div className="syn-side"><span className="syn-l">Ativam <em>{E}</em></span><SynChips list={en} {...{ deck, act }} /></div>
      <div className="syn-side"><span className="syn-l">Beneficiam <em>{P}</em></span><SynChips list={pay} {...{ deck, act }} /></div>
      {sug.length > 0 && (
        <details className="syn-sug">
          <summary>Pode reforçar <span className="muted">{sug.length}</span></summary>
          <ul>{sug.map(({ c, side }) => (
            <li key={c.i}>
              <button className="link" onClick={() => act.open(c)} {...hoverPeek(c)}>{c.n}</button>
              <span className="muted small">{side === 'pay' ? 'beneficia' : 'ativa'}</span>
              <button className="primary" onClick={() => act.add(c)} disabled={inDeck(deck, c.n) > 0}>+ deck</button>
            </li>
          ))}</ul>
        </details>
      )}
    </li>
  )
}

export function CombosView({ data, deck, ctx, act }) {
  const have = useMemo(() => [...new Set([...deckIndices(deck, data), ...deck.seeds.map(n => data.byName.get(n)?.i).filter(x => x != null)])], [deck, data])
  const { full, near } = useMemo(() => deckCombos(data, have, ctx), [data, have, ctx])
  // ponytail: o índice das categorias (~0,6 s na 1.ª vez, 34k cartas) bloqueia a abertura do separador; passar para um worker se pesar no telemóvel
  const syn = useMemo(() => deckSynergy(data, deck, ctx), [data, deck, ctx])
  const [n, setN] = useState(30)
  if (!have.length) return <div className="view"><Empty>Junta cartas ao deck (ou sementes) para ver as sinergias, os combos que já tens e os que estão a uma carta.</Empty></div>
  return (
    <div className="view">
      <h3>Sinergias do deck <span className="muted">{syn.cats.length}</span></h3>
      <p className="muted small">Cartas que funcionam bem juntas: umas <b>ativam</b> o tema, outras <b>beneficiam</b> dele. A força pesa as duas metades face ao tamanho do deck.</p>
      {syn.cats.length ? <ul className="syns">{syn.cats.map(x => <SynCat key={x.s.k} {...{ x, deck, act }} />)}</ul> : <p className="muted small">Nenhum tema claro ainda.</p>}
      {syn.pairs.length > 0 && (
        <>
          <h3>Pares fortes <span className="muted">{syn.pairs.length}</span></h3>
          <ul className="syn-pairs">{syn.pairs.map((p, k) => (
            <li key={k}>
              <SynChips list={p.a.map(c => ({ c, q: 1 }))} {...{ deck, act }} max={4} />
              <span className="muted small">{p.why} →</span>
              <SynChips list={p.b.map(c => ({ c, q: 1 }))} {...{ deck, act }} max={6} />
            </li>
          ))}</ul>
        </>
      )}
      <h3>Combos fechados (infinitos / vitória) <span className="muted">{full.length}</span></h3>
      {full.length ? <ul className="combos">{full.slice(0, 50).map(x => <Combo key={x.k} {...x} {...{ data, act, deck }} />)}</ul> : <p className="muted small">Nenhum combo completo ainda (Commander Spellbook).</p>}
      <h3>A uma carta de distância <span className="muted">{near.length}</span></h3>
      <ul className="combos">{near.slice(0, n).map(x => <Combo key={x.k} {...x} {...{ data, act, deck }} />)}</ul>
      {near.length > n && <button onClick={() => setN(n + 30)}>Mostrar mais</button>}
    </div>
  )
}

const Bar = ({ v, max, label, target, onClick }) => (
  <div className={`bar ${target != null ? (v >= target ? 'ok' : 'low') : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
    <span className="bar-l">{label}</span>
    <span className="bar-t"><i style={{ width: `${Math.min(100, (v / Math.max(1, max)) * 100)}%` }} />{target != null && <em style={{ left: `${Math.min(100, (target / Math.max(1, max)) * 100)}%` }} />}</span>
    <span className="bar-v">{v}{target != null ? ` / ${target}` : ''}</span>
  </div>
)

function PlanAndCuts({ data, deck, fmt, ctx, act, issues }) {
  const { recs, plan, co, cmdIdx, needs, meta, archetype, have } = useDeckRecs(data, deck, fmt, ctx, null, 150)
  const side = useMemo(() => {
    if (!meta || !fmt.side) return []
    const cols = new Set(have.flatMap(i => [...data.cards[i].ci]))
    return [...meta.byCard.entries()].filter(([i, m]) => m.side >= 0.08 && !deck.main[data.cards[i].n] && !deck.side[data.cards[i].n] && passes(data.cards[i], null, ctx) && [...data.cards[i].ci].every(k => cols.has(k)))
      .sort((a, b) => b[1].side - a[1].side).slice(0, 10).map(([i, m]) => ({ c: data.cards[i], m }))
  }, [meta, fmt, have, data, deck, ctx])
  const heur = useMemo(() => (fmt.side > 0 && !side.length ? sideSuggest(data, deck, ctx) : []), [fmt, side.length, data, deck, ctx])
  const sideCount = Object.values(deck.side).reduce((a, b) => a + b, 0)
  const fillSide = () => {
    const room = fmt.side - sideCount
    const pool = side.length ? side.map(x => ({ c: x.c, q: Math.max(1, Math.round(x.m.sideCopies)) })) : heur.flatMap(g => g.cards.map(c => ({ c, q: 2 })))
    let left = room
    for (const { c, q } of pool) { if (left <= 0) break; const k = Math.min(q, left); act.add(c, 'side', k); left -= k }
  }
  const heurCard = heur.length > 0 && (
    <section className="card">
      <h3>Sideboard sugerido <span className="muted small">{sideCount}/{fmt.side} · respostas por tipo de ameaça, nas tuas cores</span></h3>
      {heur.map(g => (
        <div key={g.label}><h4>{g.label}</h4><ul className="land-list">{g.cards.map(c => (
          <li key={c.i}>
            <button className="live-img" onClick={() => act.open(c)}><img src={img(c, 'art_crop')} alt="" loading="lazy" /></button>
            <div className="live-txt"><div className="live-name"><button className="link plain" onClick={() => act.open(c)}>{c.n}</button><Mana cost={c.mc} /></div></div>
            <button className="act" onClick={() => act.add(c, 'side', 2)} title="Juntar 2 ao sideboard">+SB</button>
          </li>
        ))}</ul></div>
      ))}
      {sideCount < fmt.side && <button className="primary" onClick={fillSide}>Completar o sideboard até {fmt.side}</button>}
    </section>
  )
  const sideCard = side.length > 0 && (
    <section className="card">
      <h3>Sideboard sugerido <span className="muted small">{meta.decks} listas de {fmt.name}</span></h3>
      <ul className="land-list">{side.map(({ c, m }) => (
        <li key={c.i}>
          <button className="live-img" onClick={() => act.open(c)}><img src={img(c, 'art_crop')} alt="" loading="lazy" /></button>
          <div className="live-txt"><div className="live-name"><button className="link plain" onClick={() => act.open(c)}>{c.n}</button><Mana cost={c.mc} /></div>
            <ul className="why"><li className="edh">Em {Math.round(m.side * 100)}% dos sideboards (≈{m.sideCopies.toFixed(1).replace('.', ',')} cópias)</li>{c.tg.filter(t => ['removal', 'counter', 'wipe', 'discard', 'lifegain', 'graveyard'].includes(t)).slice(0, 2).map(t => <li key={t} className="tema">{TAG_LABEL[t]}</li>)}</ul></div>
          <button className="act" onClick={() => act.add(c, 'side', Math.max(1, Math.round(m.sideCopies)))} title="Juntar ao sideboard">+SB</button>
        </li>
      ))}</ul>
      {sideCount < fmt.side && <button className="primary" onClick={fillSide}>Completar o sideboard até {fmt.side}</button>}
    </section>
  )
  const manaCard = (
    <section className="card">
      <h3>Base de mana</h3>
      <p className="muted small">Fontes por cor: tem/precisa nesta fase (aprox. Frank Karsten; um custo com {'{G}{G}'} pede mais fontes verdes do que {'{G}'}). Os terrenos sugeridos cruzam cores em falta, ritmo (entra virado ou não), mecânica com o deck e dados reais.</p>
      <ManaBlock {...{ data, deck, fmt, ctx, act, co }} full />
    </section>
  )
  const cuts = useMemo(() => deckCuts(data, deck, { ctx, co, commanders: cmdIdx, needs, recs, meta, archetype }), [data, deck, ctx, co, cmdIdx, needs, recs, meta, archetype])
  const swap = (from, to) => { act.add(from, 'main', -(deck.main[from.n] || 1)); act.add(to) }
  return (
    <>
      <PriorityCard {...{ data, deck, fmt, ctx, act, issues, cuts, needs }} />
      {manaCard}
      {sideCard}
      {heurCard}
      <section className="card">
        <h3>Plano do deck</h3>
        {archetype && <p className="small">Arquétipo provável: <b>{archetype.name}</b> <span className="muted">({archetype.got} cartas do núcleo, {Math.round(archetype.share * 100)}% do meta de {fmt.name})</span></p>}
        {plan.length ? plan.map(x => (
          <div key={x.label} className="plan-row"><b>{x.label}</b><span className="muted small">{x.roles.length ? `${x.enablers} geram · ${x.payoffs} aproveitam` : `${x.n} criaturas`}</span></div>
        )) : <p className="muted small">Ainda sem eixo claro. Os eixos aparecem quando há cartas que geram algo (fichas, marcadores, cemitério…) e outras que o aproveitam.</p>}
        {plan[0] && <p className="muted small">As sugestões dão mais peso a cartas que alimentam ou aproveitam estes eixos, e dizem com que cartas do deck interagem.</p>}
      </section>
      <section className="card">
        <h3>Cortes e trocas sugeridos</h3>
        {cuts.length ? (
          <ul className="cuts">{cuts.map(x => (
            <li key={x.c.i}>
              <div {...hoverPeek(x.c, pidOf(deck, x.c.n))}><button className="link plain" onClick={() => act.open(x.c)}><b>{x.c.n}</b></button> <Mana cost={x.c.mc} /></div>
              <ul className="why">{x.why.map((w, k) => <li key={k} className={w.startsWith('Mas') ? 'tema' : 'falta'}>{w}</li>)}</ul>
              {x.swap && (
                <div className="swap">
                  <span>→ <button className="link plain" onClick={() => act.open(x.swap.c)}><b>{x.swap.c.n}</b></button>{x.swap.fn.length ? <span className="muted small"> (mesma função: {x.swap.fn.join(', ')})</span> : null}</span>
                  {x.swap.why && <span className="muted small">{x.swap.why}</span>}
                  <button onClick={() => swap(x.c, x.swap.c)}>Trocar</button>
                </div>
              )}
            </li>
          ))}</ul>
        ) : <p className="muted small">Junta pelo menos 8 cartas que não sejam terrenos para ver o que encaixa pior.</p>}
      </section>
    </>
  )
}

// Registo do deck (Laboratório, torneios e Arena, sem contar o mesmo jogo duas vezes): contra quem ganhou e perdeu,
// dano feito e levado por jogo e as cartas que mais dano fazem (GET /api/decks/<id>/record, ratings.deck_record)
const SRC_LABEL = { lab: 'Laboratório', torneio: 'Torneios', arena: 'Arena' }
function DeckRecord({ deck, data, act }) {
  const [r, setR] = useState(null)
  useEffect(() => {
    if (!deck.id) return
    let off = false
    fetch(`/api/decks/${deck.id}/record`).then(x => (x.ok ? x.json() : null)).then(x => { if (!off) setR(x && { ...x, id: deck.id }) }).catch(() => {})
    return () => { off = true }
  }, [deck.id])
  const rec = r?.id === deck.id ? r : null
  const name = n => { const c = data.byName.get(n); return c ? <button className="link plain" onClick={() => act.open(c)}>{n}</button> : n }
  const wdl = o => <span className="rec-wdl"><b className="res-w">{o.w}</b>-<b className="res-l">{o.l}</b>{o.d ? <>-{o.d}</> : null}</span>
  const pct = o => Math.round((100 * (o.w + o.d / 2)) / Math.max(1, o.w + o.l + o.d))
  return (
    <section className="card">
      <h3>Registo de jogos {rec?.games > 0 && <span className="muted small">{rec.games} jogos · {wdl(rec)} · {pct(rec)}% · {Object.entries(rec.by_source).map(([k, n]) => `${SRC_LABEL[k] || k} ${n}`).join(' · ')}</span>}</h3>
      {!rec?.games ? <p className="muted small">{deck.id ? 'Ainda sem jogos: testa-o no Laboratório, põe-no num torneio ou liga a Arena automática nos Ratings.' : 'Guarda o deck para começar a juntar o registo.'}</p> : <>
        <div className="rec-dmg">
          <span><b>{rec.dealt ?? '—'}</b><small>dano feito por jogo</small></span>
          <span><b>{rec.taken ?? '—'}</b><small>dano levado por jogo</small></span>
          <span className="muted small">dano a adversários (veneno incluído) em {rec.with_dmg} jogos com registo; o levado só nos jogos a dois</span>
        </div>
        <div className="rec-grid">
          <div><h4>Adversários</h4><ul className="rec-list">{rec.opponents.slice(0, 20).map(o => (
            <li key={o.name}><span title={o.name}>{o.name}</span>{wdl(o)}<i className="rec-bar" style={{ '--p': `${pct(o)}%` }} title={`${pct(o)}% de vitórias · ${o.src.map(x => SRC_LABEL[x] || x).join(', ')}`} /></li>
          ))}</ul>{rec.opponents.length > 20 && <small className="muted">+{rec.opponents.length - 20} adversários</small>}</div>
          <div><h4>Cartas que mais dano fazem</h4><ul className="rec-list">{rec.cards.map(c => (
            <li key={c.card}><span>{name(c.card)}</span><b>{c.dmg}</b><small className="muted">{c.games} jogos{c.top_wins ? ` · a melhor em ${c.top_wins} ${c.top_wins === 1 ? 'vitória' : 'vitórias'}` : ''}</small></li>
          ))}</ul>{!rec.cards.length && <small className="muted">Sem dano registado.</small>}</div>
          <div><h4>O que mais te magoa</h4><ul className="rec-list">{rec.hurt.map(c => (
            <li key={c.card}><span>{name(c.card)}</span><b>{c.dmg}</b></li>
          ))}</ul>{!rec.hurt.length && <small className="muted">Sem dano registado.</small>}</div>
        </div>
      </>}
    </section>
  )
}

export function AnalysisView({ data, deck, fmt, ctx, act, issues }) {
  const s = useMemo(() => stats(deck, data), [deck, data])
  const [hand, setHand] = useState(null)
  const advised = landAdvice(fmt, s.avgMv || 3, s.cheapRampDraw)
  const maxCurve = Math.max(...s.curve, 1)
  const targets = Object.entries(fmt.targets || {})
  const pipTotal = Object.values(s.pips).reduce((a, b) => a + b, 0)
  return (
    <div className="view analysis">
      <section className="card">
        <h3>Modo de ajuda · {fmt.name}</h3>
        <ul className="tips">{fmt.tips.map((t, k) => <li key={k}>{t}</li>)}</ul>
      </section>

      <PlanAndCuts {...{ data, deck, fmt, ctx, act, issues }} />

      <section className="card">
        <h3>Validação</h3>
        {issues.length ? <ul className="issues">{issues.map((i, k) => <li key={k} className={i.nivel}>{i.msg}</li>)}</ul> : <p className="ok-msg">Deck válido em {fmt.name}.</p>}
      </section>

      <DeckRecord {...{ deck, data, act }} />

      <section className="card">
        <h3>Terrenos</h3>
        <Bar label="Terrenos" v={s.lands} max={Math.max(advised, s.lands) * 1.2} target={advised} />
        <p className="muted small">Recomendado: ~{advised} para custo médio {s.avgMv.toFixed(2)} com {s.cheapRampDraw} ramp/compra baratos (fórmula de Frank Karsten).</p>
        <h4>Cores: símbolos nos custos vs. fontes nos terrenos</h4>
        {Object.entries(s.pips).filter(([k, v]) => v || s.sources[k]).map(([k, v]) => (
          <div key={k} className="pipline"><img src={`https://svgs.scryfall.io/card-symbols/${k}.svg`} alt={k} /><span>{pipTotal ? Math.round((v / pipTotal) * 100) : 0}% dos símbolos</span><span>{s.sources[k]} fontes</span></div>
        ))}
      </section>

      <section className="card">
        <h3>Curva de mana <span className="muted">média {s.avgMv.toFixed(2)}</span></h3>
        <div className="curve">{s.curve.map((v, k) => <div key={k}><i style={{ height: `${(v / maxCurve) * 100}%` }}><b>{v || ''}</b></i><span>{k === 7 ? '7+' : k}</span></div>)}</div>
        <h4>Tipos</h4>
        <div className="types">{Object.entries(s.types).map(([t, v]) => <span key={t}>{TYPE_LABEL[t] || t} <b>{v}</b></span>)}</div>
      </section>

      {targets.length > 0 && (
        <section className="card">
          <h3>Funções do deck</h3>
          <p className="muted small">Contagem pelas etiquetas automáticas; carrega numa linha para ver sugestões dessa função.</p>
          {targets.map(([t, n]) => <Bar key={t} label={TAG_LABEL[t]} v={s.tags[t] || 0} max={n * 1.6} target={n} onClick={() => act.suggestFor(t)} />)}
          <div className="types">{Object.entries(s.tags).filter(([t]) => !(t in fmt.targets) && t !== 'land').sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, v]) => <span key={t}>{TAG_LABEL[t]} <b>{v}</b></span>)}</div>
        </section>
      )}

      <section className="card">
        <h3>Preço</h3>
        <p className="big-num">{s.price.toFixed(2)} €</p>
        <p className="muted small">Preços da Cardmarket via Scryfall (versão mais barata não garantida).{s.missingPrice ? ` ${s.missingPrice} cartas sem preço.` : ''}</p>
      </section>

      <section className="card">
        <h3>Mão inicial de teste</h3>
        <div className="row-btns"><button className="primary" onClick={() => setHand(sampleHand(deck, 7))} disabled={!Object.keys(deck.main).length}>Tirar 7</button>{hand && <button onClick={() => setHand(sampleHand(deck, Math.max(1, hand.length - 1)))}>Mulligan ({Math.max(1, hand.length - 1)})</button>}</div>
        {hand && <div className="hand">{hand.map((n, k) => { const c = data.byName.get(n); return c && <img key={k} src={img(c, 'normal', false, pidOf(deck, n))} alt={n} onClick={() => act.open(c)} /> })}</div>}
        {hand && <p className="muted small">{hand.filter(n => data.byName.get(n)?.mt === 'Land').length} terrenos nesta mão.</p>}
      </section>
    </div>
  )
}

const slug = n => n.split(' // ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const SHOW_FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'oathbreaker', 'brawl', 'historic', 'timeless', 'premodern', 'paupercommander', 'duel']

function Prints({ c, deck, act, onPreview }) {
  const [prints, setPrints] = useState(null)
  const [err, setErr] = useState(false)
  const [style, setStyle] = useState('')
  useEffect(() => { fetchPrints(c.n).then(setPrints).catch(() => setErr(true)) }, [c.n])
  const chosen = deck.prints?.[c.n]
  if (err) return <p className="muted small">Não consegui falar com a Scryfall para ver as edições.</p>
  if (!prints) return <p className="muted small">A procurar edições e estilos…</p>
  const styles = [...new Set(prints.flatMap(p => p.style))].filter(x => x.length > 2)
  const shown = style ? prints.filter(p => p.style.includes(style)) : prints
  const pick = (p, foil = false) => { act.setPrint(c, { id: p.id, set: p.set, cn: p.cn, eur: p.eur, eurFoil: p.eurFoil, style: p.style, foil }); onPreview(p.id) }
  return (
    <>
      <div className="row-btns">
        <select value={style} onChange={e => setStyle(e.target.value)} aria-label="Estilo">
          <option value="">Todas ({prints.length})</option>
          {styles.map(x => <option key={x} value={x}>{x} ({prints.filter(p => p.style.includes(x)).length})</option>)}
        </select>
        {(chosen || deck.art?.[c.n]) && <button onClick={() => { act.setPrint(c, null); onPreview(null) }}>Voltar à predefinida</button>}
      </div>
      {deck.art?.[c.n] && <p className="small">Agora: <b>arte própria do site de origem</b> (ex.: alterada no TappedOut). Escolher uma edição substitui-a; «⟳ Atualizar do site» volta a trazê-la.</p>}
      <div className="prints">
        {shown.map(p => (
          <div key={p.id} className={`print ${chosen?.id === p.id ? 'on' : ''}`}>
            <button onClick={() => pick(p, chosen?.id === p.id ? chosen.foil : false)} onMouseEnter={() => onPreview(p.id, true)} onMouseLeave={() => onPreview(null, true)} title={`${p.setName} #${p.cn} · ${p.artist || ''}`}>
              <img src={img(c, 'small', false, p.id)} alt={`${p.setName}`} loading="lazy" />
            </button>
            <small><b>{p.set}</b> {p.y}{p.style.length ? ` · ${p.style.join(', ')}` : ''}</small>
            <small className="muted">{p.eur != null ? `${p.eur.toFixed(2)} €` : '—'}{p.eurFoil != null ? <> · <button className={`link ${chosen?.id === p.id && chosen.foil ? 'on' : ''}`} onClick={() => pick(p, true)}>foil {p.eurFoil.toFixed(2)} €</button></> : null}</small>
          </div>
        ))}
      </div>
    </>
  )
}

export function CardModal({ c, data, deck, fmt, ctx, act, onClose }) {
  const [back, setBack] = useState(false)
  const [preview, setPreview] = useState(null)
  const [hoverPid, setHoverPid] = useState(null)
  const pid = hoverPid || preview || pidOf(deck, c.n)
  const onPreview = (id, hover) => (hover ? setHoverPid(id) : (setPreview(id), setHoverPid(null)))
  const sims = useMemo(() => similar(data, c.i, ctx, 12), [data, c, ctx])
  const combos = useMemo(() => data.combosByCard[c.i].map(k => data.combos[k]).sort((a, b) => (b[5] || 0) - (a[5] || 0)).slice(0, 8), [data, c])
  const F = data.meta.formats
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal cardmodal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fechar">×</button>
        <div className="cm-img">
          <img src={img(c, 'large', back, pid)} alt={c.n} />
          {deck.art?.[c.n] ? <small className="muted">Arte própria do site de origem</small> : deck.prints?.[c.n] && <small className="muted">Estilo escolhido: {deck.prints[c.n].set} #{deck.prints[c.n].cn}{deck.prints[c.n].foil ? ' (foil)' : ''}</small>}
          {c.df ? <button onClick={() => setBack(!back)}>↻ Virar</button> : null}
        </div>
        <div className="cm-info">
          <h2>{c.n} <Mana cost={c.mc} /></h2>
          <p className="type">{c.t}{c.pt ? ` · ${c.pt}` : ''}</p>
          <Oracle text={c.o} />
          <Tags c={c} onTag={t => { onClose(); act.suggestFor(t) }} />
          <div className="legal">
            {SHOW_FORMATS.map(f => { const b = F.indexOf(f); const ok = c.lg & (1 << b), r = c.rs & (1 << b); return <span key={f} className={ok ? (r ? 'r' : 'y') : 'n'}>{f}</span> })}
          </div>
          <p className="small">{price(c)} · {c.y} {c.gc ? '· Game Changer' : ''} · <a href={`https://scryfall.com/search?q=!"${encodeURIComponent(c.n)}"`} target="_blank" rel="noreferrer">Scryfall ↗</a> · <a href={`https://edhrec.com/cards/${slug(c.n)}`} target="_blank" rel="noreferrer">EDHREC ↗</a> · <a href={`https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(c.n)}`} target="_blank" rel="noreferrer">Cardmarket ↗</a></p>
          <div className="row-btns">
            <button className="primary" onClick={() => act.add(c)}>+ Deck {inDeck(deck, c.n) ? `(${inDeck(deck, c.n)})` : ''}</button>
            {fmt.side > 0 && <button onClick={() => act.add(c, 'side')}>+ Sideboard</button>}
            {fmt.cmd && canBeCommander(c, fmt) && <button onClick={() => act.setCommander(c)}>♛ {deck.commanders.includes(c.n) ? 'Retirar comandante' : 'Comandante'}</button>}
            <button onClick={() => act.toggleSeed(c)}>{deck.seeds.includes(c.n) ? '★ É semente' : '☆ Semente'}</button>
            <button onClick={() => act.showOnMap(c)}>Ver no universo</button>
          </div>
          {combos.length > 0 && (
            <>
              <h4>Combos com esta carta <span className="muted">{data.combosByCard[c.i].length}</span></h4>
              <ul className="cm-combos">{combos.map(cb => (
                <li key={cb[0]}><a href={`https://commanderspellbook.com/combo/${cb[0]}/`} target="_blank" rel="noreferrer">{cb[1].filter(i => i !== c.i).map(i => data.cards[i].n).join(' + ')}</a> <span className="muted">→ {cb[2].slice(0, 2).join(', ')}</span></li>
              ))}</ul>
            </>
          )}
          <h4>Estilos e edições</h4>
          <Prints c={c} deck={deck} act={act} onPreview={onPreview} />
          <h4>Semelhantes</h4>
          <div className="sims">{sims.map(({ c: s }) => <button key={s.i} onClick={() => act.open(s)} title={s.n}><img src={img(s, 'small')} alt={s.n} loading="lazy" /></button>)}</div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assistente de IA (extra opcional). O Grimório prepara o contexto (plano, faltas, base de mana,
// combos, meta e as suas próprias candidatas) e valida cada carta que a IA devolve.
async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
  return j
}

export function IASettings({ cfg, setCfg, onDone }) {
  const [prov, setProv] = useState(cfg.provider === 'off' ? 'gemini' : cfg.provider)
  const [model, setModel] = useState(cfg.model || '')
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const p = cfg.providers.find(x => x.id === prov)
  const save = async off => {
    try { setCfg(await postJSON('/api/ia/config', off ? { provider: 'off' } : { provider: prov, model, key })); setErr(''); onDone() }
    catch (e) { setErr(e.message) }
  }
  return (
    <div className="ia-set">
      <label className="fmt"><span>Fornecedor</span>
        <select value={prov} onChange={e => { setProv(e.target.value); setModel('') }}>
          {cfg.providers.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label className="fmt"><span>Modelo</span><input value={model} onChange={e => setModel(e.target.value)} placeholder={p?.model} /></label>
      {!p?.nokey && (
        <label className="fmt"><span>Chave {cfg.hasKey && cfg.provider === prov ? '(guardada; deixa em branco para manter)' : ''}</span>
          <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="cola aqui a chave da API" />
        </label>
      )}
      {p?.keyUrl && <p className="small muted">Chave em <a href={p.keyUrl} target="_blank" rel="noreferrer">{new URL(p.keyUrl).host}</a>. Fica só no servidor do Grimório, nunca no browser.</p>}
      {err && <p className="small bad-t">{err}</p>}
      <div className="row-btns"><button className="primary" onClick={() => save(false)}>Guardar</button>{cfg.provider !== 'off' && <button onClick={() => save(true)}>Desligar a IA</button>}</div>
    </div>
  )
}

export function AIDialog({ data, deck, fmt, ctx, act, setDeck, issues, onClose }) {
  const [cfg, setCfg] = useState(null)
  const [showSet, setShowSet] = useState(false)
  const [mode, setMode] = useState('sugerir')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const [done, setDone] = useState(() => new Set())
  const { recs, plan, archetype, needs, have } = useDeckRecs(data, deck, fmt, ctx, NOLANDS, 40)
  useEffect(() => { fetch('/api/ia/config').then(r => r.json()).then(c => { setCfg(c); if (c.provider === 'off') setShowSet(true) }).catch(() => setErr('Sem ligação ao servidor.')) }, [])
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const card = n => n && (data.byName.get(n) || data.byLower.get(String(n).toLowerCase()) || data.byLower.get(String(n).split(' // ')[0].toLowerCase()))
  const inDeckN = n => deck.main[n] || 0
  const ask = async () => {
    setBusy(true); setErr(''); setRes(null); setDone(new Set())
    const combos = deckCombos(data, have, ctx)
    const context = {
      formato: `${fmt.name}: ${fmt.size[0]}${fmt.size[1] ? `–${fmt.size[1]}` : '+'} cartas, até ${fmt.copies === Infinity ? 'qualquer número de' : fmt.copies} cópia(s)${fmt.side ? `, sideboard até ${fmt.side}` : ''}. ${fmt.tips.join(' ')}`,
      comandante: deck.commanders.join(' + ') + (ctx.identity != null ? ` (identidade ${ctx.identity || 'incolor'})` : ''),
      bracket: fmt.cmd === 'commander' && deck.bracket ? String(deck.bracket) : '',
      plano: plan.map(x => `${x.label} (${x.n})`).join(', '),
      arquetipo: archetype ? `${archetype.name}, ${Math.round(archetype.share * 100)}% do meta` : '',
      faltas: Object.entries(needs).map(([t, [h, n]]) => `${TAG_LABEL[t]}: ${h}/${n}`).join('; '),
      mana: `${need.lands} terrenos (alvo ~${need.target} em ${need.total}); fontes: ${Object.entries(need.cols).map(([k, x]) => `${k} ${x.have}/${x.full}`).join(', ')}; ${need.tapped} entram virados`,
      combos: [...combos.full.slice(0, 5).map(x => `completo: ${x.cb[1].map(i => data.cards[i].n).join(' + ')} → ${x.cb[2][0]}`), ...combos.near.slice(0, 5).map(x => `falta ${data.cards[x.missing[0]].n}: ${x.cb[1].map(i => data.cards[i].n).join(' + ')} → ${x.cb[2][0]}`)].join('\n'),
      validacao: issues.filter(i => i.nivel !== 'info').map(i => i.msg).join('\n'),
      sugestoes: recs.slice(0, 30).map(r => `${r.c.n} — ${r.why.slice(0, 2).map(w => w.txt).join('; ')}`).join('\n'),
      lista: exportList(deck),
    }
    try { setRes(await postJSON('/api/ia/ask', { mode, question: q, context })) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const mark = k => setDone(s => new Set(s).add(k))
  const vAdd = (res?.adicionar || []).map(x => ({ ...x, c: card(x.carta) })).map(x => ({ ...x, ok: x.c && passes(x.c, null, ctx) && !inDeckN(x.c.n), why2: !x.c ? 'não existe' : !passes(x.c, null, ctx) ? 'ilegal ou fora das cores' : inDeckN(x.c.n) ? 'já está no deck' : '' }))
  const vCut = (res?.tirar || []).map(x => ({ ...x, c: card(x.carta) })).map(x => ({ ...x, ok: x.c && inDeckN(x.c.n), why2: x.c && !inDeckN(x.c.n) ? 'não está no deck' : !x.c ? 'não existe' : '' }))
  const vSwap = (res?.trocas || []).map(x => ({ ...x, a: card(x.sai), b: card(x.entra) })).map(x => ({ ...x, ok: x.a && x.b && inDeckN(x.a.n) && passes(x.b, null, ctx) && !inDeckN(x.b.n) }))
  const applyAll = () => {
    vAdd.forEach((x, k) => { if (x.ok && !done.has(`a${k}`)) { act.add(x.c); mark(`a${k}`) } })
    vCut.forEach((x, k) => { if (x.ok && !done.has(`c${k}`)) { act.add(x.c, 'main', -inDeckN(x.c.n)); mark(`c${k}`) } })
    vSwap.forEach((x, k) => { if (x.ok && !done.has(`s${k}`)) { act.add(x.a, 'main', -inDeckN(x.a.n)); act.add(x.b); mark(`s${k}`) } })
  }
  const saveGroups = () => {
    const groups = res.grupos.map(g => ({ nome: g.nome, cartas: g.cartas.map(card).filter(Boolean).map(c => c.n) })).filter(g => g.cartas.length)
    setDeck(d => ({ ...d, groups }))
    act.say('Secções guardadas. No painel do deck, escolhe «Ver por: secções».')
  }
  const Name = ({ c, raw }) => (c ? <button className="link plain" onClick={() => act.open(c)}><b>{c.n}</b></button> : <s>{raw}</s>)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal auto ia" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fechar">×</button>
        <h3>✦ Assistente IA <span className="muted small">extra opcional{cfg && cfg.provider !== 'off' ? ` · ${cfg.providers.find(p => p.id === cfg.provider)?.label}` : ''}</span> {cfg && <button className="link small" onClick={() => setShowSet(!showSet)}>definições</button>}</h3>
        {cfg && showSet && <IASettings cfg={cfg} setCfg={setCfg} onDone={() => setShowSet(false)} />}
        {cfg && !showSet && cfg.provider !== 'off' && (
          <>
            <div className="seg">{[['sugerir', 'Sugerir melhorias', '✦'], ['reorganizar', 'Reorganizar o deck', '▦'], ['livre', 'Pergunta livre', '?']].map(([k, l, ic]) => (
              <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}><i>{ic}</i><span>{l}</span></button>
            ))}</div>
            <textarea className="ia-q" value={q} onChange={e => setQ(e.target.value)} placeholder={mode === 'livre' ? 'Ex.: como torno isto mais rápido sem gastar mais de 50 €?' : 'Opcional: orientação extra (ex.: «menos combos, mais interação», «orçamento baixo»)'} />
            <div className="row-btns"><button className="primary" onClick={ask} disabled={busy || (mode === 'livre' && !q.trim())}>{busy ? 'A pensar…' : 'Pedir à IA'}</button>
              <span className="muted small">A IA recebe o deck e o que o Grimório já sabe (plano, faltas, mana, combos, meta). Cartas propostas são verificadas antes de aparecerem.</span></div>
          </>
        )}
        {busy && <div className="auto-wait"><div className="spinner" /></div>}
        {err && <p className="bad-t">{err}</p>}
        {res && (
          <div className="auto-list ia-res">
            {res.resumo && <p className="ia-sum">{res.resumo}</p>}
            {vSwap.length > 0 && <section><h4>Trocas</h4><ul>{vSwap.map((x, k) => (
              <li key={k} className={`ia-row ${x.ok ? '' : 'off'}`}><div><Name c={x.a} raw={x.sai} /> → <Name c={x.b} raw={x.entra} /><small className="muted">{x.porque}</small></div>
                {x.ok && <button disabled={done.has(`s${k}`)} onClick={() => { act.add(x.a, 'main', -inDeckN(x.a.n)); act.add(x.b); mark(`s${k}`) }}>{done.has(`s${k}`) ? '✓' : 'Trocar'}</button>}</li>
            ))}</ul></section>}
            {vAdd.length > 0 && <section><h4>Adicionar</h4><ul>{vAdd.map((x, k) => (
              <li key={k} className={`ia-row ${x.ok ? '' : 'off'}`}><div><Name c={x.c} raw={x.carta} /> {x.c && <Mana cost={x.c.mc} />}<small className="muted">{x.porque}{x.why2 ? ` · ignorada: ${x.why2}` : ''}</small></div>
                {x.ok && <button disabled={done.has(`a${k}`)} onClick={() => { act.add(x.c); mark(`a${k}`) }}>{done.has(`a${k}`) ? '✓' : '+ Deck'}</button>}</li>
            ))}</ul></section>}
            {vCut.length > 0 && <section><h4>Tirar</h4><ul>{vCut.map((x, k) => (
              <li key={k} className={`ia-row ${x.ok ? '' : 'off'}`}><div><Name c={x.c} raw={x.carta} /><small className="muted">{x.porque}{x.why2 ? ` · ignorada: ${x.why2}` : ''}</small></div>
                {x.ok && <button disabled={done.has(`c${k}`)} onClick={() => { act.add(x.c, 'main', -inDeckN(x.c.n)); mark(`c${k}`) }}>{done.has(`c${k}`) ? '✓' : 'Tirar'}</button>}</li>
            ))}</ul></section>}
            {res.grupos.length > 0 && <section><h4>Secções propostas</h4>{res.grupos.map(g => <p key={g.nome} className="small"><b>{g.nome}</b> <span className="muted">({g.cartas.length})</span> {g.cartas.join(', ')}</p>)}<button onClick={saveGroups}>Guardar secções no deck</button></section>}
            <div className="row-btns">{(vAdd.some(x => x.ok) || vCut.some(x => x.ok) || vSwap.some(x => x.ok)) && <button className="primary" onClick={applyAll}>Aplicar tudo o que é válido</button>}<span className="muted small">{res.modelo}</span></div>
          </div>
        )}
      </div>
    </div>
  )
}

// Diagnóstico: as melhorias mais importantes primeiro (aparece no topo da Análise e depois de importar).
export function PriorityCard({ data, deck, fmt, ctx, act, issues, cuts, needs }) {
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const have = useMemo(() => deckIndices(deck, data), [deck, data])
  const near = useMemo(() => deckCombos(data, have, ctx).near.filter(x => x.cb[1].length - x.missing.length >= 2 && (x.cb[5] || 0) >= 100).slice(0, 2), [data, have, ctx]) // já com 2+ peças e populares
  const items = []
  for (const i of issues.filter(x => x.nivel === 'erro').slice(0, 3)) items.push({ k: 'erro', txt: i.msg })
  if (need.deficit > 2) items.push({ k: 'mana', txt: `Faltam ~${need.deficit} terrenos para esta fase do deck (alvo ~${need.target} em ${need.total}).`, go: () => act.suggestFor('') })
  if (need.deficit < -3) items.push({ k: 'mana', txt: `Terrenos a mais: ${need.lands} para um alvo de ~${need.expectedNow} nesta fase.` })
  for (const [k, x] of Object.entries(need.cols)) if (x.have < x.need) items.push({ k: 'mana', txt: `Poucas fontes de ${k}: ${x.have} para ~${x.need} (o custo mais exigente tem ${x.maxPips} símbolo${x.maxPips > 1 ? 's' : ''}).` })
  for (const [t, [h, n]] of Object.entries(needs).filter(([, [h, n]]) => h < n).sort((a, b) => (b[1][1] - b[1][0]) - (a[1][1] - a[1][0])).slice(0, 3))
    items.push({ k: 'falta', txt: `${TAG_LABEL[t]}: ${h} de ${n} recomendadas.`, go: () => act.suggestFor(t), goL: 'ver sugestões' })
  for (const x of cuts.slice(0, 3)) items.push({ k: 'corte', txt: `${x.c.n}: ${x.why[0] || 'encaixa pouco'}${x.swap ? ` → trocar por ${x.swap.c.n}` : ''}`, go: x.swap ? () => { act.add(x.c, 'main', -(deck.main[x.c.n] || 1)); act.add(x.swap.c) } : null, goL: 'trocar' })
  if (fmt.side > 0) for (const [n, q] of Object.entries(deck.main)) {
    const c = data.byName.get(n)
    if (c?.tg.includes('hate')) items.push({ k: 'corte', txt: `${n} é sobretudo uma resposta de sideboard (contra estratégias específicas).`, go: () => { act.add(c, 'main', -q); act.add(c, 'side', q) }, goL: 'passar para o sideboard' })
  }
  for (const [t, [h, n]] of Object.entries(needs).filter(([t]) => t === 'wincon' || t === 'creature')) if (h < n && !items.some(x => x.txt.startsWith(TAG_LABEL[t]))) items.push({ k: 'falta', txt: `${TAG_LABEL[t]}: ${h} de ${n}.`, go: () => act.suggestFor(t), goL: 'ver sugestões' })
  for (const x of near) items.push({ k: 'combo', txt: `A uma carta de um combo: junta ${data.cards[x.missing[0]].n} (${x.cb[2][0]}).`, go: () => act.add(data.cards[x.missing[0]]), goL: '+ deck' })
  if (!items.length) return null
  return (
    <section className="card prio">
      <h3>Melhorias prioritárias</h3>
      <ol>{items.slice(0, 10).map((x, k) => <li key={k} className={x.k}><span>{x.txt}</span>{x.go && <button className="link small" onClick={x.go}>{x.goL || 'resolver'}</button>}</li>)}</ol>
    </section>
  )
}

const ZONE_T = { main: 'o deck', side: 'o sideboard', maybe: 'o maybeboard' }, ZONE_S = { main: 'D', side: 'SB', maybe: 'MB' }
// Deck em grelha: imagens com quantidade, + / − / × (retirar tudo), por tipo ou pelas secções da IA.
export function DeckGrid({ data, deck, fmt, act }) {
  const [bySec, setBySec] = useState(false)
  const secOf = new Map()
  if (bySec) for (const g of deck.groups || []) for (const n of g.cartas) if (!secOf.has(n)) secOf.set(n, g.nome)
  const zones = [['main', deck.main], ['side', deck.side]]
  const groups = {}
  for (const [n, q] of Object.entries(deck.main)) {
    const c = data.byName.get(n)
    if (!c) continue
    const g = bySec ? secOf.get(n) || 'Outras' : TYPE_LABEL[c.mt] || c.mt
    ;(groups[g] ||= []).push([c, q])
  }
  const order = bySec ? [...(deck.groups || []).map(g => g.nome), 'Outras'] : [...TYPES.map(t => TYPE_LABEL[t])]
  const Tile = ({ c, q, zone }) => (
    <div className="dg-tile">
      <button className="dg-img" onClick={() => act.open(c)} title={c.n}><img src={img(c, 'normal', false, pidOf(deck, c.n))} alt={c.n} loading="lazy" /></button>
      {q > 1 && <span className="dg-q">×{q}</span>}
      <div className="dg-bar">
        <button onClick={() => act.add(c, zone, -1)} aria-label="Menos uma">−</button>
        <b>{q}</b>
        <button onClick={() => act.add(c, zone, 1)} aria-label="Mais uma">+</button>
        <button className="act art" onClick={() => act.pickArt(c)} title="Escolher arte">🎨</button>
        {['main', ...(fmt.side ? ['side'] : []), 'maybe'].filter(z => z !== zone).map(z => <button key={z} className="dg-mv" onClick={() => act.move(c, zone, z)} title={`Mover para ${ZONE_T[z]}`}>{ZONE_S[z]}</button>)}
        <button className="dg-x" onClick={() => act.add(c, zone, -q)} aria-label="Retirar do deck" title="Retirar do deck">×</button>
      </div>
    </div>
  )
  const cmd = deck.commanders.map(n => data.byName.get(n)).filter(Boolean)
  const sum = z => Object.values(z).reduce((s, q) => s + q, 0)
  if (!sum(deck.main) && !cmd.length && !sum(deck.maybe || {})) return <Empty>O deck está vazio. Procura cartas, usa as sugestões ou o «Completar deck».</Empty>
  return (
    <div className="dgrid">
      {deck.groups?.length > 0 && (
        <div className="seg viewby"><button className={!bySec ? 'on' : ''} onClick={() => setBySec(false)}><span>Por tipo</span></button><button className={bySec ? 'on' : ''} onClick={() => setBySec(true)}><span>Por secções (IA)</span></button></div>
      )}
      {cmd.length > 0 && (
        <section><h4>{fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : 'Comandante'}</h4><div className="dg-row">{cmd.map(c => (
          <div key={c.i} className="dg-tile"><button className="dg-img" onClick={() => act.open(c)}><img src={img(c, 'normal', false, pidOf(deck, c.n))} alt={c.n} /></button>
            <div className="dg-bar"><button className="dg-x" onClick={() => act.setCommander(c)} title="Retirar comandante">×</button></div></div>
        ))}</div></section>
      )}
      {order.filter(g => groups[g]).map(g => (
        <section key={g}>
          <h4>{g} <span className="muted">{groups[g].reduce((s, [, q]) => s + q, 0)}</span></h4>
          <div className="dg-row">{groups[g].sort((a, b) => a[0].cmc - b[0].cmc || a[0].n.localeCompare(b[0].n)).map(([c, q]) => <Tile key={c.i} c={c} q={q} zone="main" />)}</div>
        </section>
      ))}
      {sum(zones[1][1]) > 0 && (
        <section><h4>Sideboard <span className="muted">{sum(deck.side)}</span></h4><div className="dg-row">
          {Object.keys(deck.side).map(n => data.byName.get(n)).filter(Boolean).map(c => <Tile key={c.i} c={c} q={deck.side[c.n]} zone="side" />)}
        </div></section>
      )}
      {sum(deck.maybe || {}) > 0 && (
        <section className="maybe"><h4>Maybeboard <span className="muted">{sum(deck.maybe)} · fora do deck, das estatísticas e dos testes</span></h4><div className="dg-row">
          {Object.keys(deck.maybe).map(n => data.byName.get(n)).filter(Boolean).map(c => <Tile key={c.i} c={c} q={deck.maybe[c.n]} zone="maybe" />)}
        </div></section>
      )}
    </div>
  )
}

// Escolher a arte (edição/estilo) de uma carta: pré-visualização grande + todas as impressões.
export function ArtPicker({ c, deck, act, onClose }) {
  const [preview, setPreview] = useState(null)
  const [hoverPid, setHoverPid] = useState(null)
  const pid = hoverPid || preview || pidOf(deck, c.n)
  const onPreview = (id, hover) => (hover ? setHoverPid(id) : (setPreview(id), setHoverPid(null)))
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal artpick" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fechar">×</button>
        <div className="ap-img"><img src={img(c, 'large', false, pid)} alt={c.n} /></div>
        <div className="ap-list">
          <h3>Arte de {c.n}</h3>
          <p className="muted small">Passa o rato para ver; clica para escolher. A arte escolhida aparece no deck e na exportação («(SET) nº *F*»).</p>
          <Prints c={c} deck={deck} act={act} onPreview={onPreview} />
        </div>
      </div>
    </div>
  )
}
