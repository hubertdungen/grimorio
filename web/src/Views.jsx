import { matchArts, shrink } from './artmatch.js'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { unaccent, fetchSets, fetchSetCards, findSet, search, recommend, termsOf, termMatch, narrowHate, similar, deckCombos, deckPlan, deckCuts, deckLinks, sideSuggest, fetchMeta, metaIndex, detectArchetype, STYLES, LEVELS, comboTurn, pctP, passes, fetchPrints, fetchEdh, TAG_LABEL, TAG_GROUPS, TYPES, TYPE_LABEL, COLORS, img, pidOf, basicList, CREATURE_TYPES } from './data.js'
import { canBeCommander, landAdvice, targetsFor, maxCopies } from './formats.js'
import { deckIndices, stats, sampleHand, exportList, landOdds } from './deck.js'
import { CardTile, Mana, Oracle, Tags, price, Empty, Stars, WhiteStars } from './ui.jsx'
import { deckPoints, deckSplit, trophyStars } from './trophyvalue.js'
import Map3D from './Map3D.jsx'
import { autoBuild } from './autobuild.js'
import { deckSynergy } from './synergy.js'
import { manaNeeds, recommendLands, reanimTargets } from './mana.js'
import { tx, num, LOCALE } from './i18n.js'
import { prepareSwaps, cutPlan, landPlan } from './swap.js'
import AddOrSwap from './AddSwap.jsx'
import { regionsOf, perfOf, archetypesOf, rankZone, adjustPlan, sizePlan, fillPlan } from './universe.js'
import { hlProps, pin } from './hl.js'
import { parseQuery } from './nlsearch.js'
import { Kpis, CurveChart, ColorDonuts, HandOdds, PriceCard, CardsInGames, WinLoseCard, Hint } from './AnalysisDash.jsx'

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
// ⛰ Terrenos: quantos, que cores e que terrenos (swap.js landPlan); não precisa de jogos
const LAND_KIND = { menos: tx('menos 1 terreno, mais 1 carta'), mais: tx('mais 1 terreno, menos 1 carta'), cor: tx('cor em falta'), melhor: tx('terreno melhor') }
function LandPanel({ data, deck, fmt, ctx, act, swaps, recs }) {
  const [open, setOpenS] = useState(() => { try { return localStorage.getItem('grimorio.terrenos') === '1' } catch { return false } })
  const setOpen = v => { setOpenS(v); try { localStorage.setItem('grimorio.terrenos', v ? '1' : '0') } catch { /* sem armazenamento */ } }
  const plan = useMemo(() => (open ? landPlan(data, deck, fmt, ctx, { fn: swaps, recs }) : null), [open, data, deck, fmt, ctx, swaps, recs])
  const card = (n, c) => c || data.byName.get(n)
  return (
    <div className={`prefs cutp ${open ? 'on' : ''}`}>
      <button className="prefs-head" onClick={() => setOpen(!open)}>
        <span>⛰ {tx('Terrenos')}</span><small className="muted">{plan ? `${plan.N.s.avgMv < 2.4 && plan.N.lands < plan.N.target ? tx('{l} terrenos (deck rápido: menos do que a regra é normal)', { l: plan.N.lands }) : tx('{l} de {t} ideais', { l: plan.N.lands, t: plan.N.target })} · ${tx('{n} sugestão|{n} sugestões', { n: plan.acts.length })}` : tx('quantidade, cores e terrenos melhores')}</small><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && plan && (
        <div className="cutp-body">
          <p className="muted small">{Object.entries(plan.N.cols).map(([k, v]) => <span key={k} className={v.have < v.need ? 'bad-t' : ''}><Mana cost={`{${k}}`} /> {v.have}/{v.need} </span>)}</p>
          {!plan.acts.length ? <p className="muted small">{tx('Os terrenos estão equilibrados: quantidade, cores e qualidade sem nada claro a mudar.')}</p>
            : <ul className="cutp-list">{plan.acts.map(x => { const o = card(x.out), i = x.in; return (
              <li key={x.kind + x.out + i.n} {...hlProps([{ n: x.out, tone: 'out' }, { n: i.n, tone: 'in' }])}>
                <small className="muted">{LAND_KIND[x.kind]}</small>
                <div className="cutp-pair">
                  <button className="cutp-card" onClick={() => { pin([{ n: x.out, tone: 'out' }]); o && act.open(o) }}>{o && <img src={img(o, 'art_crop', false, pidOf(deck, o.n))} alt="" loading="lazy" />}<span><b>− {x.q > 1 ? `${x.q}× ` : ''}{x.out}</b></span></button>
                  <span className="cutp-arrow">→</span>
                  <button className="cutp-card in" onClick={() => act.open(i)}><img src={img(i, 'art_crop')} alt="" loading="lazy" /><span><b>+ {x.q > 1 ? `${x.q}× ` : ''}{i.n}</b><Mana cost={i.mc} /></span></button>
                </div>
                <ul className="why">{x.why.map((w, k) => <li key={k} className="falta">{w}</li>)}</ul>
                <div className="row-btns"><button className="primary small" onClick={() => act.swap(i, x)}>⇄ {tx('Trocar {n}×', { n: x.q })}</button></div>
              </li>
            ) })}</ul>}
        </div>
      )}
    </div>
  )
}

// 🧩 Preencher o deck: só aparece com cartas a menos (Commander incluído); várias estratégias, cada carta com o porquê
const FILL_ST = [['equilibrada', '⚖', tx('Equilibrada')], ['plano', '🎯', tx('Reforçar o plano')], ['interacao', '🛡', tx('Mais interação')], ['curva', '⚡', tx('Curva baixa')], ['copias', '📈', tx('Mais cópias')]]
function FillPanel({ data, deck, fmt, ctx, act, recs, needs }) {
  const total = Object.values(deck.main).reduce((a, q) => a + q, 0) + deck.commanders.length, min = fmt.size[0]
  const [st, setSt] = useState(() => { try { return localStorage.getItem('grimorio.preencher') || 'equilibrada' } catch { return 'equilibrada' } })
  const pick = v => { setSt(v); try { localStorage.setItem('grimorio.preencher', v) } catch { /* sem armazenamento */ } }
  const need = useMemo(() => (total < min ? manaNeeds(data, deck, fmt) : null), [total, min, data, deck, fmt])
  const lands = useMemo(() => (need ? recommendLands(data, { deck, fmt, ctx, need, limit: 12 }).filter(l => !deck.main[l.c.n]) : []), [need, data, deck, fmt, ctx])
  const sts = FILL_ST.filter(([k]) => k !== 'copias' || fmt.copies !== 1)
  const s = sts.some(([k]) => k === st) ? st : 'equilibrada'
  const plan = useMemo(() => {
    if (!need) return null
    if (s === 'copias') { const r = sizePlan(data, deck, ctx.tests, { min, max: fmt.size[1] || Infinity, maxOf: c => maxCopies(c, fmt, ctx.bit), need, needs }); return { ...r, items: r.items.map(x => ({ ...x, why: [x.why] })) } }
    return fillPlan(data, deck, { min, recs, lands, need, needs, strategy: s })
  }, [need, s, data, deck, ctx, min, fmt, needs, recs, lands])
  if (!plan || !plan.gap) return null
  const n = plan.items.reduce((a, x) => a + x.k, 0)
  return (
    <div className="prefs cutp on fillp">
      <div className="prefs-head"><span>🧩 {tx('Preencher o deck')}</span><small className="bad-t">{tx('faltam {n} cartas ({t} de {f})', { n: plan.gap, t: plan.total, f: min })}</small></div>
      <div className="cutp-body">
        <div className="seg small fill-st" role="group" aria-label={tx('Estratégia')}>{sts.map(([k, ic, l]) => <button key={k} className={s === k ? 'on' : ''} onClick={() => pick(k)}>{ic} {l}</button>)}</div>
        <p className="small muted">{plan.lands != null ? tx('{n} cartas: {l} terrenos · custo médio do resto {m}', { n, l: plan.lands, m: (plan.mv || 0).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) }) : tx('{n} cópias a mais de cartas que já tens', { n })}</p>
        <ul className="fill-list">{plan.items.map(x => (
          <li key={x.c.n} {...hlProps([{ n: x.c.n, tone: 'in' }])}>
            <button className="cutp-card in" onClick={() => act.open(x.c)}><img src={img(x.c, 'art_crop')} alt="" loading="lazy" /><span><b>+{x.k} {x.c.n}</b><Mana cost={x.c.mc} /></span></button>
            <ul className="why">{x.why.filter(Boolean).map((w, k) => <li key={k} className={k ? 'tema' : 'falta'}>{w}</li>)}</ul>
            <QtyPick c={x.c} deck={deck} fmt={fmt} act={act}><button className="small" onClick={() => act.add(x.c, 'main', x.k)}>＋ {x.k > 1 ? `${x.k} ` : ''}{tx('juntar')}</button></QtyPick>
          </li>))}</ul>
        {plan.items.length > 0 && <button className="primary" onClick={() => plan.items.forEach(x => act.add(x.c, 'main', x.k))}>✓ {tx('Juntar todas ({n})', { n })}</button>}
        {n < plan.gap && <p className="small muted">{tx('Ainda ficam {n} por escolher: mais sugestões abaixo.', { n: plan.gap - n })}</p>}
      </div>
    </div>
  )
}

// ± Ajustar quantidades: mais cópias do que ganha jogos, menos do que pesa (aos pares; universe.js adjustPlan)
function AdjustPanel({ data, deck, fmt, ctx, act, needs }) {
  const [open, setOpenS] = useState(() => { try { return localStorage.getItem('grimorio.ajustar') === '1' } catch { return false } })
  const setOpen = v => { setOpenS(v); try { localStorage.setItem('grimorio.ajustar', v ? '1' : '0') } catch { /* sem armazenamento */ } }
  const ev = ctx.tests, games = ev?.exact || 0
  const plan = useMemo(() => (open && games >= 3 && fmt.copies !== 1 ? adjustPlan(data, deck, ev, { needs, maxOf: c => maxCopies(c, fmt, ctx.bit), skip: reanimTargets(data, deck) }) : []), [open, games, data, deck, ev, needs, fmt, ctx.bit])
  // tamanho do formato (60, 40, 100…): o que juntar ou tirar para fechar a diferença, com o porquê (não precisa de jogos)
  // 60 «ou mais»: acima do ideal também sugere onde reduzir
  const sz = useMemo(() => sizePlan(data, deck, ev, { min: fmt.size[0], max: fmt.size[1] || fmt.size[0], maxOf: c => maxCopies(c, fmt, ctx.bit), need: manaNeeds(data, deck, fmt), needs }), [data, deck, ev, fmt, ctx.bit, needs])
  const szDone = sz.items.reduce((a, x) => a + x.k, 0)
  if (fmt.copies === 1 && !sz.gap) return null  // singleton (Commander, Gladiator…) com o tamanho certo: não há cópias a ajustar
  const Row = ({ r, sign, k }) => (
    <button className={`cutp-card ${sign > 0 ? 'in' : ''}`} onClick={() => act.open(r.c)}><img src={img(r.c, 'art_crop', false, pidOf(deck, r.c.n))} alt="" loading="lazy" />
      <span><b>{sign > 0 ? '+' : '−'}{k}× {r.c.n}</b><small className="muted">{tx('tens {q}', { q: r.q })} · {r.why}</small></span></button>
  )
  return (
    <div className={`prefs cutp ${open ? 'on' : ''}`}>
      <button className="prefs-head" onClick={() => setOpen(!open)}>
        <span>± {tx('Ajustar quantidades')}</span><small className="muted">{sz.gap ? <b className="bad-t">{sz.gap > 0 ? tx('faltam {n} cartas ({t} de {f})', { n: sz.gap, t: sz.total, f: fmt.size[0] }) : tx('sobram {n} cartas ({t} para {f})', { n: -sz.gap, t: sz.total, f: fmt.size[1] || fmt.size[0] })}</b> : open ? (games < 3 ? tx('precisa de jogos') : tx('{n} ajuste|{n} ajustes', { n: plan.length })) : tx('mais cópias do que ganha, menos do que pesa')}</small><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="cutp-body">
          {sz.gap !== 0 && <div className="sz-plan">
            <p className="small"><b>{sz.gap > 0 ? tx('O deck tem {t} cartas de {f}: faltam {n}.', { t: sz.total, f: fmt.size[0], n: sz.gap }) : (fmt.size[1] ? tx('O deck tem {t} cartas para um máximo de {f}: sobram {n}.', { t: sz.total, f: fmt.size[1], n: -sz.gap }) : tx('O deck tem {t} cartas; o ideal são {f} (mais cartas = menos vezes as melhores): sobram {n}.', { t: sz.total, f: fmt.size[0], n: -sz.gap }))}</b> {sz.items.length > 0 && tx('Proposta para fechar a diferença:')}</p>
            <ul className="sz-list">{sz.items.map(x => (
              <li key={x.c.n} {...hlProps([{ n: x.c.n, tone: x.k > 0 ? 'in' : 'out' }])}><b className={x.k > 0 ? 'pos' : 'neg'}>{x.k > 0 ? `+${x.k}` : `−${-x.k}`}</b> <button className="link plain" onClick={() => act.open(x.c)}>{x.c.n}</button> <span className="muted small">{tx('tens {q}', { q: deck.main[x.c.n] || 0 })} · {x.why}</span>
                <button className="small" onClick={() => act.add(x.c, 'main', x.k)}>{x.k > 0 ? tx('juntar') : tx('tirar')}</button></li>))}</ul>
            {sz.items.length > 0 && <button className="primary small" onClick={() => sz.items.forEach(x => act.add(x.c, 'main', x.k))}>✓ {tx('Aplicar tudo ({n})', { n: szDone > 0 ? `+${szDone}` : szDone })}</button>}
            {Math.abs(szDone) < Math.abs(sz.gap) && <p className="small muted">{tx('Ainda ficam {n} por resolver: escolhe cartas novas nas sugestões abaixo.', { n: Math.abs(sz.gap) - Math.abs(szDone) })}</p>}
          </div>}
          {fmt.copies === 1 ? null : games < 3 ? <p className="muted small">{tx('Ainda não há jogos suficientes deste deck ({n} de 3). Só se julgam cartas que já apareceram em jogo: põe-no a jogar no Coliseu (bots, torneios ou Arena).', { n: games })}</p>
            : !plan.length ? <p className="muted small">{tx('As quantidades estão equilibradas: nenhuma carta ganha claramente mais do que outra que pese.')}</p>
              : <ul className="cutp-list">{plan.map(x => (
                <li key={x.add.c.n + x.cut.c.n} {...hlProps([{ n: x.add.c.n, tone: 'in' }, { n: x.cut.c.n, tone: 'out' }])}>
                  <div className="cutp-pair"><Row r={x.add} sign={1} k={x.k} /><span className="cutp-arrow">⇄</span><Row r={x.cut} sign={-1} k={x.k} /></div>
                  <div className="row-btns"><button className="primary small" onClick={() => act.swap(x.add.c, { out: x.cut.c.n, q: x.k })}>✓ {tx('Aplicar: +{k} {a}, −{k} {b}', { k: x.k, a: x.add.c.n, b: x.cut.c.n })}</button></div>
                </li>
              ))}</ul>}
        </div>
      )}
    </div>
  )
}

// 🛡 Sideboard: o que as listas do meta levam no sideboard nas tuas cores; sem meta, respostas por tipo de ameaça
function SidePanel({ data, deck, fmt, ctx, act, meta, have }) {
  const [open, setOpenS] = useState(() => { try { return localStorage.getItem('grimorio.sideboard') === '1' } catch { return false } })
  const setOpen = v => { setOpenS(v); try { localStorage.setItem('grimorio.sideboard', v ? '1' : '0') } catch { /* sem armazenamento */ } }
  const side = useMemo(() => {
    if (!open || !meta || !fmt.side) return []
    const cols = new Set(have.flatMap(i => [...data.cards[i].ci]))
    return [...meta.byCard.entries()].filter(([i, m]) => m.side >= 0.08 && !deck.main[data.cards[i].n] && !deck.side[data.cards[i].n] && passes(data.cards[i], null, ctx) && [...data.cards[i].ci].every(k => cols.has(k)))
      .sort((a, b) => b[1].side - a[1].side).slice(0, 10).map(([i, m]) => ({ c: data.cards[i], m }))
  }, [open, meta, fmt, have, data, deck, ctx])
  const heur = useMemo(() => (open && fmt.side > 0 && !side.length ? sideSuggest(data, deck, ctx) : []), [open, fmt, side.length, data, deck, ctx])
  // do deck para o sideboard: cartas que só servem contra um tipo/cor do adversário ou respostas de sideboard no main
  const toSide = useMemo(() => (fmt.side > 0 ? Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && (narrowHate(c).length || c.tg.includes('hate'))) : []), [fmt.side, deck.main, data])
  if (!fmt.side) return null
  const sideCount = Object.values(deck.side).reduce((a, b) => a + b, 0)
  const fillSide = () => {
    const pool = side.length ? side.map(x => ({ c: x.c, q: Math.max(1, Math.round(x.m.sideCopies)) })) : heur.flatMap(g => g.cards.map(c => ({ c, q: 2 })))
    let left = fmt.side - sideCount
    for (const { c, q } of pool) { if (left <= 0) break; const k = Math.min(q, left); act.add(c, 'side', k); left -= k }
  }
  const row = (c, why, q) => (
    <li key={c.i}>
      <button className="live-img" onClick={() => act.open(c)}><img src={img(c, 'art_crop')} alt="" loading="lazy" /></button>
      <div className="live-txt"><div className="live-name"><button className="link plain" onClick={() => act.open(c)}>{c.n}</button><Mana cost={c.mc} /></div>{why}</div>
      <button className="act" onClick={() => act.add(c, 'side', q)} title={tx('Juntar ao sideboard')}>+SB</button>
    </li>
  )
  return (
    <div className={`prefs cutp ${open ? 'on' : ''}`}>
      <button className="prefs-head" onClick={() => setOpen(!open)}>
        <span>🛡 {tx('Sideboard')}</span><small className="muted">{toSide.length > 0 && <b className="bad-t">{tx('{n} do deck para o sideboard', { n: toSide.length })} · </b>}{sideCount}/{fmt.side} · {side.length ? tx('{n} listas de {f}', { n: meta.decks, f: fmt.name }) : tx('respostas por tipo de ameaça, nas tuas cores')}</small><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="cutp-body">
          {toSide.length > 0 && <div className="to-side">
            <h4>{tx('Do deck para o sideboard')}</h4>
            <ul className="land-list">{toSide.map(c => { const h = narrowHate(c); return (
              <li key={c.i} {...hlProps([{ n: c.n, tone: 'out' }])}>
                <button className="live-img" onClick={() => act.open(c)}><img src={img(c, 'art_crop')} alt="" loading="lazy" /></button>
                <div className="live-txt"><div className="live-name"><button className="link plain" onClick={() => act.open(c)}>{deck.main[c.n] > 1 ? `${deck.main[c.n]}× ` : ''}{c.n}</button><Mana cost={c.mc} /></div>
                  <ul className="why"><li className="falta">{h.length ? tx('Só serve contra {x}: guarda-a para os jogos 2 e 3 contra quem a precisa', { x: h.join('/') }) : tx('Resposta de sideboard: no main ocupa o lugar de uma carta do plano')}</li></ul></div>
                <button className="act" onClick={() => act.move(c, 'main', 'side')} title={tx('Passar para o sideboard')}>→SB</button>
              </li>) })}</ul>
          </div>}
          {side.length > 0 && <ul className="land-list">{side.map(({ c, m }) => row(c, <ul className="why"><li className="edh">{tx('Em {p}% dos sideboards (≈{c} cópias)', { p: Math.round(m.side * 100), c: num(m.sideCopies) })}</li>{c.tg.filter(t => ['removal', 'counter', 'wipe', 'discard', 'lifegain', 'graveyard'].includes(t)).slice(0, 2).map(t => <li key={t} className="tema">{TAG_LABEL[t]}</li>)}</ul>, Math.max(1, Math.round(m.sideCopies))))}</ul>}
          {heur.map(g => <div key={g.label}><h4>{g.label}</h4><ul className="land-list">{g.cards.map(c => row(c, null, 2))}</ul></div>)}
          {sideCount < fmt.side && (side.length > 0 || heur.length > 0) && <button className="primary" onClick={fillSide}>{tx('Completar o sideboard até {n}', { n: fmt.side })}</button>}
        </div>
      )}
    </div>
  )
}

// ✂ Trocar no deck: cartas (do deck e do sideboard) que já apareceram em jogos e merecem sair, cada uma com a substituta
// ideal (mesmo efeito, ou que cumpra uma sinergia/combo do deck) — o motor das trocas ao contrário (swap.js cutPlan)
function CutPanel({ data, deck, fmt, ctx, act, swaps, recs, co, cmdIdx, needs, meta, archetype }) {
  const [open, setOpenS] = useState(() => { try { return localStorage.getItem('grimorio.trocar') === '1' } catch { return false } })
  const setOpen = v => { setOpenS(v); try { localStorage.setItem('grimorio.trocar', v ? '1' : '0') } catch { /* sem armazenamento */ } }
  const plan = useMemo(() => {
    if (!open) return null
    const side = fmt.side > 0 ? sideSuggest(data, deck, ctx).flatMap(x => x.cards).filter(c => c.tg.includes('hate')) : []
    return cutPlan(swaps, [...recs.slice(0, 40).map(r => r.c), ...side], ctx.tests)
  }, [open, data, deck, fmt, ctx, swaps, recs])
  const enough = plan && plan.games >= 3
  const byText = useMemo(() => {
    if (!open) return []
    const seen = new Set(enough ? plan.cuts.map(x => x.out) : [])
    const rean = reanimTargets(data, deck)  // alvos de reanimação: ficar na mão é normal
    return deckCuts(data, deck, { ctx, co, commanders: cmdIdx, needs, recs, meta, archetype }).filter(x => !seen.has(x.c.n) && !rean.has(x.c.n))
  }, [open, enough, plan, data, deck, ctx, co, cmdIdx, needs, recs, meta, archetype])
  const swapText = (from, to) => { act.add(from, 'main', -(deck.main[from.n] || 1)); act.add(to) }
  return (
    <div className={`prefs cutp ${open ? 'on' : ''}`}>
      <button className="prefs-head" onClick={() => setOpen(!open)}>
        <span>✂ {tx('Trocar no deck')}</span><small className="muted">{plan ? `${enough ? `${tx('{n} troca|{n} trocas', { n: plan.cuts.length })} · ${tx('{n} carta|{n} cartas', { n: plan.cuts.reduce((a, x) => a + x.q, 0) })}` : tx('sem jogos suficientes')} · ${tx('{n} pelo texto', { n: byText.length })}` : tx('cartas que merecem sair e a troca ideal')}</small><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && plan && (
        <div className="cutp-body">
          {!enough ? <p className="muted small">{tx('Ainda não há jogos suficientes deste deck ({n} de 3). Só se julgam cartas que já apareceram em jogo: põe-no a jogar no Coliseu (bots, torneios ou Arena).', { n: plan.games })}</p>
            : !plan.cuts.length ? <p className="muted small">{tx('Nenhuma carta merece claramente sair: as que apareceram nos jogos estão a cumprir o seu papel.')}</p>
              : <ul className="cutp-list">{plan.cuts.map(x => { const o = data.byName.get(x.out); return (
                <li key={x.out} {...hlProps([{ n: x.out, tone: 'out' }])}>
                  <div className="cutp-pair">
                    <button className="cutp-card" onClick={() => o && act.open(o)}>{o && <img src={img(o, 'art_crop', false, pidOf(deck, o.n))} alt="" loading="lazy" />}<span><b>{x.q > 1 ? `${x.q}× ` : ''}{x.out}</b><small className="muted">{x.zone === 'side' ? `${tx('sideboard')} · ` : ''}{tx('vista em {n} jogos', { n: x.seen })}</small></span></button>
                    <span className="cutp-arrow">→</span>
                    <button className="cutp-card in" onClick={() => act.open(x.inc)}><img src={img(x.inc, 'art_crop')} alt="" loading="lazy" /><span><b>{x.q > 1 ? `${x.q}× ` : ''}{x.inc.n}</b><Mana cost={x.inc.mc} /></span></button>
                  </div>
                  <ul className="why">{x.why.map((w, k) => <li key={k} className="falta">{w}</li>)}</ul>
                  <div className="row-btns"><button className="primary small" onClick={() => act.swap(x.inc, x)}>⇄ {tx('Trocar {n}×', { n: x.q })}</button>{fmt.side > 0 && x.zone !== 'side' && o && <button className="small" onClick={() => act.move(o, 'main', 'side')} title={tx('Não corta: passa para o sideboard (fica para jogos 2 e 3)')}>→ SB</button>}{x.alts.length > 0 && <span className="muted small">{tx('ou:')} {x.alts.map((c, k) => <span key={c.n}>{k ? ', ' : ''}<button className="link plain" onClick={() => act.swap(c, x)} title={tx('Trocar por esta')}>{c.n}</button></span>)}</span>}</div>
                </li>
              ) })}</ul>}
          {byText.length > 0 && <>
            <h4>{tx('Pelo texto e pelas funções (não precisa de jogos)')}</h4>
            <ul className="cuts">{byText.map(x => (
              <li key={x.c.i} {...hlProps([{ n: x.c.n, tone: 'out' }])}>
                <div className="cutp-pair">
                  <button className="cutp-card" onClick={() => { pin([{ n: x.c.n, tone: 'out' }]); act.open(x.c) }} {...hoverPeek(x.c, pidOf(deck, x.c.n))}><img src={img(x.c, 'art_crop', false, pidOf(deck, x.c.n))} alt="" loading="lazy" /><span><b>{x.c.n}</b><Mana cost={x.c.mc} /></span></button>
                  {x.swap && <><span className="cutp-arrow">→</span>
                    <button className="cutp-card in" onClick={() => act.open(x.swap.c)}><img src={img(x.swap.c, 'art_crop')} alt="" loading="lazy" /><span><b>{x.swap.c.n}</b><Mana cost={x.swap.c.mc} />{x.swap.fn.length ? <small className="muted">{tx('mesma função:')} {x.swap.fn.join(', ')}</small> : null}</span></button></>}
                </div>
                <ul className="why">{x.why.map((w, k) => <li key={k} className={w.startsWith(tx('Mas')) ? 'tema' : 'falta'}>{w}</li>)}{x.swap?.why && <li className="edh">{x.swap.why}</li>}</ul>
                <div className="row-btns">
                  {x.swap && <button className="primary small" onClick={() => swapText(x.c, x.swap.c)}>⇄ {tx('Trocar')}</button>}
                  {fmt.side > 0 && <button className={`small ${!x.swap && x.sb ? 'primary' : ''}`} onClick={() => act.move(x.c, 'main', 'side')} title={tx('Não corta: passa para o sideboard (fica para jogos 2 e 3)')}>→ SB</button>}
                  {!x.swap && (x.force || x.sb) && <button className="small" onClick={() => act.add(x.c, 'main', -(deck.main[x.c.n] || 1))}>{tx('Cortar')}</button>}
                </div>
              </li>
            ))}</ul>
          </>}
        </div>
      )}
    </div>
  )
}

export function PrefsPanel({ deck, fmt, act, compact = false }) {
  const pf = deck.prefs || {}
  const [open, setOpen] = useState(!compact && pf.on)
  const [decks, setDecks] = useState([])
  useEffect(() => { if (open) fetch('/api/decks').then(r => r.json()).then(setDecks).catch(() => {}) }, [open])
  const set = p => act.setPrefs(p)
  const nivel = pf.nivel ?? 3, meta = pf.meta ?? 0.5
  const summary = pf.on ? [LEVELS[nivel], meta < 0.3 ? tx('original') : meta > 0.7 ? tx('segue o meta') : '', ...(pf.estilo || []).map(k => STYLES[k]?.label), pf.gosto && pf.gosto !== 'off' ? tx('ao teu gosto') : '', pf.orcamento ? `≤ ${pf.orcamento} €` : ''].filter(Boolean).join(' · ') : tx('desligada: sugestão completa, sem viés')
  return (
    <div className={`prefs ${pf.on ? 'on' : ''}`}>
      <button className="prefs-head" onClick={() => setOpen(!open)}>
        <span>⚙ {tx('Personalizar')}</span><small className="muted">{summary}</small><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="prefs-body">
          <label className="switch"><input type="checkbox" checked={!!pf.on} onChange={e => set({ on: e.target.checked })} /> <span>{pf.on ? tx('Personalização ligada') : tx('Ligar personalização (opcional)')}</span></label>
          {!fmt.cmd && <label className="chk small" title={tx('Por omissão as sugestões ficam nas cores que o deck já joga (e os quase-combos também). Ligado, aparecem cartas e combos de outras cores.')}><input type="checkbox" checked={!!pf.foraCores} onChange={e => set({ foraCores: e.target.checked })} /> {tx('Sugerir cartas fora das cores do deck')}</label>}
          <fieldset disabled={!pf.on}>
            <label className="sl"><span>{tx('Nível de jogo')} <b>{LEVELS[nivel]}</b>{fmt.cmd === 'commander' ? <em> · bracket {nivel}</em> : null}</span>
              <input type="range" min="1" max="5" step="1" value={nivel} onChange={e => set({ nivel: +e.target.value })} />
              <span className="sl-ends"><i>fun/jank</i><i>{tx('competitivo')}</i></span>
            </label>
            <label className="sl"><span>{tx('Seguir o meta')} <b>{meta < 0.3 ? tx('original') : meta > 0.7 ? 'staples' : tx('equilibrado')}</b></span>
              <input type="range" min="0" max="1" step="0.1" value={meta} onChange={e => set({ meta: +e.target.value })} />
              <span className="sl-ends"><i>{tx('pouco jogadas')}</i><i>{tx('o que todos jogam')}</i></span>
            </label>
            <div className="sl"><span>{tx('Estilo e viés')} <em>{tx('(vários)')}</em></span>
              <div className="fchips">{Object.entries(STYLES).map(([k, S]) => {
                const on = (pf.estilo || []).includes(k)
                return <button key={k} className={`fchip ${on ? 'on' : ''}`} onClick={() => set({ estilo: on ? pf.estilo.filter(x => x !== k) : [...(pf.estilo || []), k] })}>{S.label}</button>
              })}</div>
            </div>
            {(pf.estilo || []).length > 0 && (
              <label className="sl"><span>{tx('Força do estilo')} <b>{num(pf.estiloForca ?? 1, 2)}×</b> <em>· {tx('automaticamente menor quanto mais segues o meta')}</em></span>
                <input type="range" min="0.5" max="2" step="0.25" value={pf.estiloForca ?? 1} onChange={e => set({ estiloForca: +e.target.value })} />
                <span className="sl-ends"><i>{tx('só um toque')}</i><i>{tx('manda no deck')}</i></span>
              </label>
            )}
            <label className="sl"><span>{tx('Inspirar-me nos meus decks')}</span>
              <select value={pf.gosto || 'off'} onChange={e => set({ gosto: e.target.value })}>
                <option value="off">{tx('Não')}</option><option value="todos">{tx('Todos os meus decks')}</option><option value="escolher">{tx('Escolher decks…')}</option>
              </select>
            </label>
            {pf.gosto === 'escolher' && (
              <div className="deck-checks">{decks.filter(d => d.id !== deck.id).map(d => {
                const on = (pf.gostoDecks || []).includes(d.id)
                return <label key={d.id} className="chk"><input type="checkbox" checked={on} onChange={() => set({ gostoDecks: on ? pf.gostoDecks.filter(x => x !== d.id) : [...(pf.gostoDecks || []), d.id] })} /> {d.name} <span className="muted">({d.count})</span></label>
              })}{decks.length <= 1 && <p className="muted small">{tx('Ainda não há outros decks guardados.')}</p>}</div>
            )}
            <label className="sl"><span>{tx('Orçamento por carta')} <b>{pf.orcamento ? tx('até {v} €', { v: pf.orcamento }) : tx('sem limite')}</b></span>
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
    if (fmt.cmd || ctx0.identity != null || deck.prefs?.foraCores) return ctx0  // fora das cores (preferência): não fecha às cores do deck
    const spells = Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land')
    if (spells.length < 8) return ctx0 // ainda a explorar: todas as cores
    return { ...ctx0, identity: [...new Set(spells.flatMap(c => [...c.ci]))].join('') }
  }, [ctx0, fmt, deck.main, deck.prefs?.foraCores, data])
  const filters = useMemo(() => (pf?.orcamento ? { ...(filters0 || {}), priceMax: pf.orcamento } : filters0), [filters0, pf?.orcamento])
  const tastes = useTastes(data, deck)
  const seedsIdx = useMemo(() => deck.seeds.map(n => data.byName.get(n)).filter(Boolean).map(c => c.i), [data, deck.seeds])
  const seedTerms = useMemo(() => deck.seedTerms || [], [deck.seedTerms])
  const have = useMemo(() => deckIndices(deck, data), [deck, data])
  const cmdIdx = useMemo(() => deck.commanders.map(n => data.byName.get(n)?.i).filter(x => x != null), [data, deck.commanders])
  const seeds = useMemo(() => {
    if (seedsIdx.length) return seedsIdx
    const main = Object.keys(deck.main).map(n => data.byName.get(n)).filter(c => c && c.mt !== 'Land').map(c => c.i).reverse()
    if (!cmdIdx.length && !main.length && seedTerms.length)  // só sementes-termo (Flying, Rat…): partem das cartas mais jogadas que as têm
      return data.cards.filter(c => seedTerms.some(t => termMatch(c, t)) && passes(c, null, ctx)).sort((a, b) => (a.er || 1e9) - (b.er || 1e9)).slice(0, 8).map(c => c.i)
    return [...cmdIdx, ...main]
  }, [seedsIdx, cmdIdx, deck.main, data, seedTerms, ctx])
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
  const recs = useMemo(() => recommend(data, { seeds, seedTerms, have: [...new Set([...have, ...seedsIdx])], ctx, filters, limit, commanders: cmdIdx, needs, co, deckStats, bracket, gcCount, meta, archetype, prefs: deck.prefs, tastes, deckSize: fmt.size[0] >= 99 ? 99 : Math.max(40, fmt.size[0] || 60), turn: comboTurn(fmt) }),
    [data, seeds, seedTerms, have, seedsIdx, ctx, filters, limit, cmdIdx, needs, co, deckStats, bracket, gcCount, meta, archetype, deck.prefs, tastes, fmt])
  const plan = useMemo(() => deckPlan(data, have), [data, have])
  // trocas: preparadas só quando um «+» as pede (o rato em cima ou o menu aberto); swap.js guarda-as por deck
  const swaps = useMemo(() => (c, o) => prepareSwaps(data, deck, fmt, ctx, { co, archetype, meta, evidence: ctx.tests })(c, o), [data, deck, fmt, ctx, co, archetype, meta])
  return { recs, seeds, seedsIdx, have, usingDeck: !seedsIdx.length, plan, co, cmdIdx, needs, bracket, meta, archetype, tastes, swaps }
}

const Why = ({ why }) => <ul className="why">{why.map((w, k) => <li key={k} className={w.k}>{w.combo ? <a href={`https://commanderspellbook.com/combo/${w.combo}/`} target="_blank" rel="noreferrer">{w.txt}</a> : w.txt}</li>)}</ul>

const PART_LABEL = { estilo: tx('Estilo escolhido'), gosto: tx('O teu gosto'), original: tx('Originalidade'), torneios: tx('Torneios (MTGTop8)'), texto: tx('Texto parecido'), comandante: tx('Comandante'), decksReais: tx('Decks reais (EDHREC)'), combos: 'Combos', interacoes: tx('Interações'), falta: tx('O que falta ao deck'), tribo: tx('Tribo e palavras-chave'), popular: tx('Popularidade'), testes: tx('Testes do Laboratório') }
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
      {d.mArch && <p>{tx('Nas listas de {a} (MTGTop8), {p} usam-na, com {c} cópias em média.', { a: d.mArch.name, p: pct(d.mArch.incl), c: num(d.mArch.copies) })}</p>}
      {d.mRow && <p>{tx('Em {p} das {n} listas recentes de {f}', { p: pct(d.mRow.incl), n: d.metaDecks, f: d.metaName })}{d.mRow.copies ? ` (${tx('≈{c} cópias', { c: num(d.mRow.copies) })})` : ''}{d.mRow.side ? `; ${tx('em {p} dos sideboards', { p: pct(d.mRow.side) })}` : ''}.</p>}
      {d.mPart?.length > 0 && <p>{tx('Em torneios aparece com:')} {d.mPart.map(p => `${p.from} (${tx('{p} das listas dela', { p: pct(p.cond) })})`).join('; ')}.</p>}
      {d.edhCmd && <p>{tx('No EDHREC, {p} dos {n} decks de {c} usam-na; sinergia {s} face a decks das mesmas cores.', { p: pct(d.edhCmd.incl), n: d.edhCmd.pot.toLocaleString(LOCALE), c: d.edhCmd.from, s: (d.edhCmd.syn > 0 ? '+' : '') + pct(d.edhCmd.syn) })}</p>}
      {d.edhCards.length > 0 && <p>{tx('Aparece com:')} {d.edhCards.map(e => `${e.from} (${num(e.lift)}×, ${tx('{p} dos decks dela', { p: pct(e.incl) })})`).join('; ')}.</p>}
      {d.combos.map(cb => (
        <p key={cb.id}><a href={`https://commanderspellbook.com/combo/${cb.id}/`} target="_blank" rel="noreferrer">Combo</a> {tx('com {c}', { c: cb.with.join(' + ') })}{cb.missing.length ? <> ({tx('falta {x}', { x: cb.missing.join(', ') })})</> : null}: {cb.produces.join(', ')}{cb.requires.length ? `; ${tx('precisa também de {x}', { x: cb.requires.join(', ') })}` : ''}{cb.decks ? ` · ${cb.decks.toLocaleString(LOCALE)} decks` : ''}.</p>
      ))}
      {d.inter.map((x, k) => <p key={k}>{x.side === 'usa' ? tx('Aproveita {n} carta que {l}|Aproveita {n} cartas que {l}', { n: x.who.length, l: x.label }) : tx('Alimenta {n} carta que {l}|Alimenta {n} cartas que {l}', { n: x.who.length, l: x.label })}: {x.who.slice(0, 6).join(', ')}{x.who.length > 6 ? '…' : ''}.</p>)}
      {d.roles.length > 0 && <p className="muted">{tx('Papéis desta carta:')} {d.roles.join(', ')}.</p>}
      <p className="muted">{tx('Pelo texto, está mais perto do deck do que {p} das cartas', { p: pct(d.simPct) })}{d.near ? ` (${tx('a mais próxima é {c}', { c: d.near })})` : ''}{d.cmdPct != null ? `, ${tx('e mais perto do comandante do que {p}', { p: pct(d.cmdPct) })}` : ''}.</p>
    </div>
  )
}

// Filtro das sugestões: razão (porque é sugerida) e função (o que faz), com contadores.
const REASONS = [['', tx('Tudo'), '✦'], ['combo', 'Combos', '∞'], ['edh', tx('Decks reais'), '◉'], ['meta', tx('Torneios'), '♜'], ['inter', tx('Interações'), '⇄'], ['falta', tx('O que falta'), '◔'], ['estilo', tx('Estilo'), '◆'], ['gosto', tx('O teu gosto'), '♥'], ['testes', tx('Testes'), '⚗']]
const FUNC_TAGS = ['creature', 'wincon', 'reanimate', 'ramp', 'draw', 'removal', 'wipe', 'counter', 'tutor', 'protection', 'recursion', 'tokens', 'sacrifice', 'counters', 'lifegain', 'graveyard', 'etb', 'spellslinger', 'artifacts', 'enchantments', 'discard', 'evasion',
  'mill', 'burn', 'pump', 'blink', 'bounce', 'copy', 'steal', 'drain', 'selection', 'cost', 'untap', 'extraturn', 'landfall', 'stax']
const CHIPS = 10  // funções à vista; as outras num «+N»
const hasKind = (r, k) => !k || r.why.some(w => w.k === k || (k === 'combo' && w.k === 'combo2'))
// ordem da lista de sugestões: pontuação (a do motor), custo, cor (WUBRG, multicor, incolor), tipo, nome, preço
const COLOR_ORD = c => (c.ci.length > 1 ? 5 : c.ci.length ? 'WUBRG'.indexOf(c.ci) : 6)
const SORTS = {
  score: null,
  mv: (a, b) => a.c.cmc - b.c.cmc || a.c.n.localeCompare(b.c.n),
  mvDesc: (a, b) => b.c.cmc - a.c.cmc || a.c.n.localeCompare(b.c.n),
  cor: (a, b) => COLOR_ORD(a.c) - COLOR_ORD(b.c) || a.c.cmc - b.c.cmc,
  tipo: (a, b) => (a.c.mt || '').localeCompare(b.c.mt || '') || a.c.cmc - b.c.cmc,
  nome: (a, b) => a.c.n.localeCompare(b.c.n),
  preco: (a, b) => (a.c.eur ?? a.c.usd ?? 1e9) - (b.c.eur ?? b.c.usd ?? 1e9),
}
const sortRecs = (recs, k) => (SORTS[k] ? [...recs].sort(SORTS[k]) : recs)
const applyFilter = (recs, kind, tag) => recs.filter(r => hasKind(r, kind) && (!tag || r.c.tg.includes(tag)))

// as funções de base aparecem sempre (mesmo sem nenhuma nas sugestões de agora): escolher uma faz as sugestões
// procurarem essa função (useDeckRecs filtra pelo f.tag)
const CORE_TAGS = ['removal', 'draw', 'ramp', 'wipe', 'counter']
function ReasonFilter({ recs, kind, setKind, tag, setTag, needs = {}, extra = null }) {
  const [all, setAll] = useState(false)
  const base = applyFilter(recs, '', tag)
  const tags = FUNC_TAGS.map(t => ({ t, n: applyFilter(recs, kind, t).length, gap: needs[t] ? Math.max(0, needs[t][1] - needs[t][0]) : 0 }))
    .filter(x => x.n || x.gap || CORE_TAGS.includes(x.t)).sort((a, b) => (b.gap > 0) - (a.gap > 0) || b.gap - a.gap || b.n - a.n)
  return (
    <div className="rfilter">
      <div className="seg" role="tablist" aria-label={tx('Razão')}>
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
        <div className="fchips" aria-label={tx('Função')}>
          {tag && <button className="fchip clear" onClick={() => setTag('')}>× {tx('todas as funções')}</button>}
          {(all ? tags : tags.filter((x, k) => k < CHIPS || x.t === tag || CORE_TAGS.includes(x.t))).map(x => (
            <button key={x.t} className={`fchip ${tag === x.t ? 'on' : ''} ${x.gap ? 'gap' : ''}`} onClick={() => setTag(tag === x.t ? '' : x.t)}
              title={x.gap ? tx('O deck tem {a} de {b} recomendadas', { a: needs[x.t][0], b: needs[x.t][1] }) : ''}>
              {TAG_LABEL[x.t]}<b>{x.n}</b>{x.gap > 0 && <em>{tx('faltam {n}', { n: x.gap })}</em>}
            </button>
          ))}
          {tags.length > CHIPS && <button className="fchip more" onClick={() => setAll(a => !a)}>{all ? tx('menos') : `+${tags.length - CHIPS}`}</button>}
        </div>
      )}
    </div>
  )
}
const NOLANDS = { noLands: true }
const LANDS_ONLY = { type: 'Land', colors: [] }

// Base de mana: equilíbrio de terrenos, fontes por cor e terrenos sugeridos (com mecânica).
function ManaBlock({ data, deck, fmt, ctx, act, co, swaps, limit = 4, full = false }) {
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const lands = useMemo(() => (full || limit ? recommendLands(data, { deck, fmt, ctx, co, need, limit: full ? 12 : limit }) : []), [data, deck, fmt, ctx, co, need, limit, full])
  const short = Object.entries(need.cols).filter(([, x]) => x.have < x.need)
  const nLand = need.lands
  return (
    <div className="mana-block">
      <p className="small">
        <b>{nLand}</b> {tx('terrenos')} {need.deficit > 1 ? <span className="bad-t">({tx('{n} a menos para esta fase do deck', { n: need.deficit })})</span> : need.deficit < -2 ? <span className="bad-t">({tx('{n} a mais', { n: -need.deficit })})</span> : <span className="ok-t">({tx('equilibrado')})</span>}
        <span className="muted"> · {tx('alvo ~{a} em {b}', { a: need.target, b: need.total })}{need.tapped ? ` · ${tx('{n} entram virados', { n: need.tapped })}` : ''}</span>
      </p>
      <div className="srcs">
        {Object.entries(need.cols).map(([k, x]) => (
          <span key={k} className={`src ${x.have < x.need ? 'low' : ''}`} title={tx('{p} símbolos de {k}; o custo mais exigente tem {m}. Recomendado ~{f} fontes com a base de mana completa.', { p: x.pips, k, m: x.maxPips, f: x.full })}>
            <img src={`https://svgs.scryfall.io/card-symbols/${k}.svg`} alt={k} /> {x.have}/{x.need}
          </span>
        ))}
      </div>
      {short.length > 0 && <p className="small bad-t">{lands.length ? tx('Faltam fontes de {c}: os terrenos abaixo dão prioridade a essas cores.', { c: short.map(([k]) => k).join(', ') }) : tx('Faltam fontes de {c}.', { c: short.map(([k]) => k).join(', ') })}</p>}
      {lands.length > 0 && <ul className="land-list">
        {lands.map(r => (
          <li key={r.c.i} {...hoverPeek(r.c)}>
            <button className="live-img" onClick={() => act.open(r.c)}><img src={img(r.c, 'art_crop')} alt="" loading="lazy" /></button>
            <div className="live-txt">
              <div className="live-name"><button className="link plain" onClick={() => act.open(r.c)}>{r.c.n}</button></div>
              <Why why={r.why} />
            </div>
            <AddOrSwap c={r.c} act={act} swaps={swaps}><button className="act add" onClick={() => act.add(r.c)} title={tx('Juntar ao deck')}>+</button></AddOrSwap>
          </li>
        ))}
      </ul>}
    </div>
  )
}

// Painel ao lado da pesquisa: muda a cada carta que entra no deck.
function LivePanel({ data, deck, fmt, ctx, act, onSwaps }) {
  const [open, setOpen] = useState(() => !matchMedia('(max-width: 900px)').matches) // no telemóvel começa fechado
  const [kind, setKind] = useState('')
  const [tag, setTag] = useState('')
  const [exp, setExp] = useState(null)
  const { recs: all, seeds, plan, bracket, co, archetype, meta, needs, swaps } = useDeckRecs(data, deck, fmt, ctx, NOLANDS, 60)
  useEffect(() => { onSwaps?.(() => swaps) }, [onSwaps, swaps]) // a grelha da pesquisa usa as mesmas trocas
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const landsFirst = need.deficit > 2 || Object.values(need.cols).some(x => x.have < x.need * 0.7)
  const recs = applyFilter(all, kind === 'terrenos' ? '' : kind, tag).slice(0, 15)
  return (
    <aside className={`live ${open ? 'open' : ''}`}>
      <button className="live-head" onClick={() => setOpen(!open)}>
        <b>{tx('Sugestões para este deck')}</b><span className="muted small">{seeds.length ? tx('a partir de {n} carta|a partir de {n} cartas', { n: seeds.length }) : ''}</span><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="live-prefs"><PrefsPanel {...{ deck, fmt, act }} compact /></div>}
      {open && seeds.length > 0 && (
        <div className="live-meta">
          {plan.length > 0 && <p className="small"><span className="muted">{tx('Plano detetado:')}</span> {plan.map(x => <span key={x.label} className="plan-chip">{x.label} <b>{x.n}</b></span>)}</p>}
          {archetype && <p className="small"><span className="muted">{tx('Arquétipo provável:')}</span> <span className="plan-chip arch">{archetype.name}</span> <span className="muted">{tx('{a}% do núcleo · {b}% do meta', { a: Math.round(archetype.fit * 100), b: Math.round(archetype.share * 100) })}</span></p>}
          {meta && !archetype && seeds.length >= 4 && <p className="small muted">{tx('Ainda não parece nenhum arquétipo do meta de {f}.', { f: fmt.name })}</p>}
          {bracket && <p className="small muted">Bracket {bracket}: {bracket <= 2 ? tx('sem Game Changers nem combos') : bracket === 3 ? tx('até 3 Game Changers') : tx('sem limites')}.</p>}
          <ReasonFilter recs={all} kind={kind === 'terrenos' ? '__' : kind} setKind={setKind} tag={tag} setTag={setTag} needs={needs}
            extra={<button role="tab" aria-selected={kind === 'terrenos'} className={kind === 'terrenos' ? 'on' : ''} onClick={() => setKind(kind === 'terrenos' ? '' : 'terrenos')} title={tx('Terrenos')}><i>▤</i><span>{tx('Terrenos')}</span></button>} />
        </div>
      )}
      {open && seeds.length > 0 && kind !== 'terrenos' && landsFirst && (
        <div className="mana-sec"><h4>{tx('Base de mana · prioridade')}</h4><ManaBlock {...{ data, deck, fmt, ctx, act, co, swaps }} /></div>
      )}
      {open && seeds.length > 0 && kind === 'terrenos' && <div className="mana-sec"><ManaBlock {...{ data, deck, fmt, ctx, act, co, swaps }} limit={12} /></div>}
      {open && kind !== 'terrenos' && (seeds.length ? (
        <ul className="live-list">
          {recs.map(r => (
            <li key={r.c.i} {...hoverPeek(r.c, pidOf(deck, r.c.n))}>
              <button className="live-img" onClick={() => act.open(r.c)}><img src={img(r.c, 'art_crop', false, pidOf(deck, r.c.n))} alt="" loading="lazy" /></button>
              <div className="live-txt">
                <div className="live-name"><button className="link plain" onClick={() => act.open(r.c)}>{r.c.n}</button><Mana cost={r.c.mc} /></div>
                <Why why={r.why} />
                <button className="link small whyb" onClick={() => setExp(exp === r.c.i ? null : r.c.i)}>{exp === r.c.i ? tx('esconder') : tx('porquê? ▾')}</button>
                {exp === r.c.i && <WhyDetail r={r} />}
              </div>
              <span className="live-acts"><AddOrSwap c={r.c} act={act} swaps={swaps}><button className="act add" onClick={() => act.add(r.c)} title={tx('Juntar ao deck')}>+</button></AddOrSwap><button className="act art" onClick={() => act.pickArt(r.c)} title={tx('Escolher arte')}>🎨</button></span>
            </li>
          ))}
          {!recs.length && <li className="muted small">{tx('Nenhuma sugestão com este tipo de razão.')}</li>}
          {!landsFirst && !kind && !tag && <li className="mana-sec-li"><h4>{tx('Base de mana')}</h4><ManaBlock {...{ data, deck, fmt, ctx, act, co, swaps }} limit={3} /></li>}
        </ul>
      ) : <p className="muted small live-empty">{tx('Junta o comandante ou umas cartas e as sugestões aparecem aqui, com o porquê de cada uma.')}</p>)}
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
      if (left > 0 && passes(c, null, ctx) && [...c.ci].every(k => cols.has(k))) put(c, Math.max(1, Math.round(m.sideCopies)), tx('em {p}% dos sideboards de {f}', { p: Math.round(m.side * 100), f: fmt.name }))
    }
    const cats = sideSuggest(data, sim, ctx, 4)
    for (let k = 0; k < 4 && left > 0; k++) for (const g of cats) if (g.cards[k]) put(g.cards[k], 2, `${g.label.toLowerCase()} · ${tx('MV {v}, muito jogada', { v: g.cards[k].cmc })}`)
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
    say(sn ? tx('Juntei {n} cartas ao deck e {s} ao sideboard.', { n, s: sn }) : tx('Juntei {n} carta ao deck.|Juntei {n} cartas ao deck.', { n }), true)
    onClose()
  }
  const rank = g => (g.startsWith(tx('Função')) ? 0 : g === tx('Sinergia') ? 1 : 2)  // nomes dos grupos vêm do autobuild.js, já traduzidos
  const order = Object.keys(groups).sort((a, b) => rank(a) - rank(b))
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal auto" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>{tx('Completar deck')} · {fmt.name}</h3>
        {act && <PrefsPanel {...{ deck, fmt, act }} compact />}
        {!res ? <div className="auto-wait"><div className="spinner" /><p className="muted">{tx('A montar: funções em falta, sinergia com o plano e base de mana…')}</p></div>
          : res.msg ? <p>{res.msg}</p> : (
            <>
              <p className="muted small">{tx('Proposta de {n} cartas. Desmarca o que não quiseres; nada muda no deck até carregares em Aplicar.', { n: res.adds.reduce((s, a) => s + a.q, 0) })}</p>
              {res.offColor?.length > 0 && <p className="small bad-t">{tx('Cores principais: {c}. Fora delas (pedem splash ou saem): {o}.', { c: res.colors, o: res.offColor.join(', ') })}</p>}
              {res.combos?.length > 0 && (
                <div className="auto-combos">
                  <b>{tx('Combos no deck final')}</b> <span className="muted small">{tx('probabilidade de os ter montado até ao turno {t} ({n} tutor; aproximação)|probabilidade de os ter montado até ao turno {t} ({n} tutores; aproximação)', { t: res.turn, n: res.tutors })}</span>
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
                    <h4>{tx('Sideboard sugerido')} <span className="muted">{sn}/{fmt.side} · {tx('desmarca o que não quiseres; depois ajusta no deck')}</span></h4>
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
              <div className="row-btns"><button className="primary" onClick={apply} disabled={!n && !sn}>{tx('Aplicar {n} carta|Aplicar {n} cartas', { n })}{sn ? ` + ${tx('{n} no sideboard', { n: sn })}` : ''}</button><button onClick={onClose}>{tx('Cancelar')}</button></div>
            </>
          )}
      </div>
    </div>
  )
}

let peek
const hoverPeek = (c, pid) => ({ onMouseEnter: e => showCardPeek(e, c, pid), onMouseLeave: hideCardPeek })
// ao lado da linha; num scroll (do rato ou do browser a reajustar a página) acompanha a linha enquanto o rato lá estiver
const placePeek = (el, a) => {
  const r = a.getBoundingClientRect()
  el.style.top = `${Math.min(window.innerHeight - 350, Math.max(8, r.top - 120))}px`
  el.style.left = `${Math.min(window.innerWidth - 250, r.right + 12)}px`
}
// cartas de duas faces: a imagem vira em 3D para a outra face passado 1 s (e com F ou o ⟲ da linha)
let peekFlipT
export const peekOpen = () => peek?.style.display === 'block'
export function flipCardPeek() { clearTimeout(peekFlipT); if (peek?.dataset.df && peek.style.display === 'block') peek.classList.toggle('flipped') }  // virar à mão cancela o automático
export function showCardPeek(e, c, pid) {
  if (!matchMedia('(hover: hover)').matches) return
  if (!peek) {
    peek = document.body.appendChild(document.createElement('div')); peek.className = 'peek'
    peek.innerHTML = '<div class="peek-in"><img class="pf" alt=""><img class="pb" alt=""></div>'
  }
  peek.querySelector('.pf').src = img(c, 'normal', false, pid)
  peek.dataset.df = c.df ? '1' : ''
  peek.querySelector('.pb').src = c.df ? img(c, 'normal', true, pid) : ''
  peek.classList.remove('flipped')
  clearTimeout(peekFlipT)
  if (c.df) peekFlipT = setTimeout(flipCardPeek, 1000)
  placePeek(peek, e.currentTarget)
  peek.style.display = 'block'
  watchPeek(peek, e.currentTarget)
}
// fecha-se se a linha por baixo desaparecer (ex.: «−» tirou a última cópia), se o rato sair dela ou a qualquer clique/tecla
let peekAnchor, peekTimer
const anchored = () => peekAnchor?.isConnected && (peekAnchor.matches(':hover') || !!peekAnchor.parentElement?.matches('.row:hover'))  // a linha inteira (o ⟲ incluído)
function watchPeek(el, a) {
  peekAnchor = a
  if (!window.__peekGuard) {
    window.__peekGuard = true
    addEventListener('pointerdown', e => { if (!e.target.closest?.('.peek-flip')) hideCardPeek() }, true)
    addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { if (peek?.dataset.df && peek.style.display === 'block') { e.preventDefault(); clearTimeout(peekFlipT); flipCardPeek() } } else hideCardPeek() }, true)
    addEventListener('scroll', () => { if (peek?.style.display === 'block') { if (anchored()) placePeek(peek, peekAnchor); else hideCardPeek() } }, true)
  }
  clearInterval(peekTimer)
  peekTimer = setInterval(() => { if (!anchored()) { el.style.display = 'none'; clearInterval(peekTimer) } }, 250)
}

export function hideCardPeek() { clearTimeout(peekFlipT); if (peek) peek.style.display = 'none' }

const inDeck = (deck, n) => (deck.main[n] || 0) + (deck.side[n] || 0) + (deck.commanders.includes(n) ? 1 : 0) + (deck.signature === n ? 1 : 0)

// o botão de juntar (children) com as outras quantidades: ao passar o rato (ou ▾ no tátil) abre 1–4 por cima — o número
// é o total no deck, até ao máximo do formato; nos formatos de uma cópia fica só o botão
export function QtyPick({ c, deck, fmt, act, zone = 'main', children }) {
  const [open, setOpen] = useState(false)
  const q = (deck[zone] || {})[c.n] || 0, lim = Math.min(4, maxCopies(c, fmt))
  if (fmt.copies === 1 || lim < 2) return children
  return (
    <span className={`qadd ${open ? 'open' : ''}`} onMouseLeave={() => setOpen(false)}>
      {children}
      <button className="qmore" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={tx('Cópias de {c}', { c: c.n })}>▾</button>
      <span className="qpick" role="group" aria-label={tx('Cópias de {c}', { c: c.n })}>{Array.from({ length: lim }, (_, k) => k + 1).map(n => (
        <button key={n} className={q === n ? 'on' : ''} onClick={() => { if (n !== q) act.add(c, zone, n - q); setOpen(false) }} title={tx('Ficar com {n} no deck', { n })}>{n}</button>))}</span>
    </span>
  )
}

function Actions({ c, deck, fmt, act, swaps }) {
  const q = inDeck(deck, c.n)
  return (
    <>
      <QtyPick c={c} deck={deck} fmt={fmt} act={act}><AddOrSwap c={c} act={act} swaps={swaps} up><button className="act add" onClick={() => act.add(c)} title={tx('Juntar ao deck')}>+{q ? <sup>{q}</sup> : null}</button></AddOrSwap></QtyPick>
      {fmt.side > 0 && <button className="act" onClick={() => act.add(c, 'side')} title={tx('Juntar ao sideboard')}>SB</button>}
      {fmt.cmd && canBeCommander(c, fmt) && <button className={`act ${deck.commanders.includes(c.n) ? 'on' : ''}`} onClick={() => act.setCommander(c)} title={fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : tx('Comandante')}>♛</button>}
      {fmt.cmd === 'oathbreaker' && /Instant|Sorcery/.test(c.t) && <button className={`act ${deck.signature === c.n ? 'on' : ''}`} onClick={() => act.setSignature(c)} title={tx('Feitiço de assinatura')}>✦</button>}
      <button className={`act seed ${deck.seeds.includes(c.n) ? 'on' : ''}`} onClick={() => act.toggleSeed(c)} title={tx('Semente das sugestões')}>★</button>
      <button className="act art" onClick={() => act.pickArt(c)} title={tx('Escolher arte (edições e estilos)')}>🎨</button>
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
        <button className={`pip ${f.colorless ? 'on' : ''}`} onClick={() => up('colorless', !f.colorless)} title={tx('Incolor')}><img src="https://svgs.scryfall.io/card-symbols/C.svg" alt="C" /></button>
        {f.colors.length > 0 && (
          <select value={f.colorMode} onChange={e => up('colorMode', e.target.value)} aria-label={tx('Modo de cor')}>
            <option value="incl">{tx('inclui')}</option><option value="within">{tx('no máximo')}</option><option value="exact">{tx('exatamente')}</option>
          </select>
        )}
      </div>
      <select value={f.type} onChange={e => up('type', e.target.value)} aria-label={tx('Tipo')}><option value="">{tx('Todos os tipos')}</option>{TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
      <button className={`fchip lgd ${f.legendary ? 'on' : ''}`} onClick={() => up('legendary', !f.legendary)} aria-pressed={!!f.legendary} title={tx('Só cartas lendárias (junta-se ao tipo: criaturas lendárias, artefactos lendários…)')}>♛ {tx('Lendárias')}</button>
      {!noTag && <select value={f.tag} onChange={e => up('tag', e.target.value)} aria-label={tx('Função')}><option value="">{tx('Qualquer função')}</option>{TAG_GROUPS.map(([g, ks]) => <optgroup key={g} label={g}>{ks.map(k => <option key={k} value={k}>{TAG_LABEL[k]}</option>)}</optgroup>)}</select>}
      <input value={f.sub} onChange={e => up('sub', e.target.value)} placeholder={tx('Subtipo (Elf, Dragon…)')} className="w-sub" />
      <span className="mv"><abbr title={tx('MV = valor de mana: o custo total de mana da carta (ex.: 2 genéricos + 1 vermelho = 3)')}>MV</abbr> <input type="number" min="0" value={f.cmcMin} onChange={e => up('cmcMin', e.target.value)} aria-label={tx('Custo mínimo')} />–<input type="number" min="0" value={f.cmcMax} onChange={e => up('cmcMax', e.target.value)} aria-label={tx('Custo máximo')} /></span>
      {!compact && <select value={f.rarity} onChange={e => up('rarity', e.target.value)} aria-label={tx('Raridade')}><option value="">{tx('Raridade')}</option><option value="c">{tx('Comum')}</option><option value="u">{tx('Incomum')}</option><option value="r">{tx('Rara')}</option><option value="m">{tx('Mítica')}</option></select>}
      <span className="mv">{tx('até')} <input type="number" min="0" step="0.5" value={f.priceMax} onChange={e => up('priceMax', e.target.value)} placeholder="€" aria-label={tx('Preço máximo')} /> €</span>
    </div>
  )
}

const F0 = { colors: [], colorMode: 'incl', colorless: false, type: '', legendary: false, tag: '', sub: '', cmcMin: '', cmcMax: '', rarity: '', priceMax: '', sort: 'pop', inText: false }

// terrenos básicos à mão: um botão por cor (as do deck primeiro e acesas), − tira um
const BASIC5 = [['Plains', 'W'], ['Island', 'U'], ['Swamp', 'B'], ['Mountain', 'R'], ['Forest', 'G']]
export function BasicBar({ data, deck, ctx, act }) {
  const cols = useMemo(() => {
    const s = new Set()
    for (const n of Object.keys(deck.main)) { const c = data.byName.get(n); if (c && c.mt !== 'Land') for (const k of c.co || '') s.add(k) }
    return s
  }, [data, deck.main])
  const id = ctx?.identity
  const list = id === '' ? [['Wastes', 'C']] : BASIC5.filter(([, k]) => id == null || id.includes(k))
  return (
    <div className="basicbar">
      {list.map(([n, k]) => {
        const c = data.byName.get(n), q = deck.main[n] || 0
        return c && (
          <span key={n} className={`bb ${cols.has(k) || q ? 'on' : ''}`}>
            <button onClick={() => act.add(c)} title={tx('Juntar 1 {c}', { c: n })} aria-label={tx('Juntar 1 {c}', { c: n })}><Mana cost={`{${k}}`} />{q ? <b>{q}</b> : <i>+</i>}</button>
            {q > 0 && <button className="bb-m" onClick={() => act.remove(c, 'main', 1)} title={tx('Tirar 1 {c}', { c: n })} aria-label={tx('Tirar 1 {c}', { c: n })}>−</button>}
          </span>
        )
      })}
    </div>
  )
}

const NL_L = { type: tx('tipo'), sub: tx('subtipo'), tag: tx('função'), cares: tx('beneficia de'), oracle: tx('texto'), mv: tx('custo'), colors: tx('cor') }
export function SearchView({ data, deck, fmt, ctx, act }) {
  const [q, setQ] = useState('')
  const [f, setF] = useState(F0)
  const dq = useDeferredValue(q), df = useDeferredValue(f)
  const [raw, setRaw] = useState('')  // frase que o utilizador quis pelo nome (✕ no «Entendido como»)
  // edição na pesquisa («Assassin's Creed», «MH3», «e:ltr»): a lista de edições e as cartas de cada uma vêm da Scryfall
  // quando são precisas; só conta se nenhuma carta começa pelo que se escreveu (assim «Zendikar's Roil» é a carta)
  const [sets, setSets] = useState(null), [setNames, setSetNames] = useState({})
  useEffect(() => { if (!sets && dq.trim().length >= 3) fetchSets().then(setSets) }, [dq, sets])
  const setHit = useMemo(() => {
    const h = sets && findSet(dq, sets), qf = unaccent(dq.toLowerCase().trim())
    return h && !data.cards.some(c => (c.f || c.l).startsWith(qf)) ? h : null
  }, [dq, sets, data])
  useEffect(() => { const k = setHit?.set.code; if (k && !setNames[k]) fetchSetCards(k).then(n => setSetNames(x => ({ ...x, [k]: n }))) }, [setHit]) // eslint-disable-line react-hooks/exhaustive-deps
  const setList = setHit && setNames[setHit.set.code]
  const qq = setHit ? setHit.rest : dq
  const dff = useMemo(() => (setHit ? { ...df, names: setList || new Set() } : df), [df, setHit, setList])
  const nl = useMemo(() => (raw === qq ? null : parseQuery(qq, { types: CREATURE_TYPES })), [qq, raw])
  const [anyFmt, setAnyFmt] = useState(false)  // mostrar também cartas que o formato do deck esconde (só para esta pesquisa)
  useEffect(() => setAnyFmt(false), [dq])
  const sctx = useMemo(() => (anyFmt ? { ...ctx, bit: -1, identity: null, allowUn: true } : ctx), [anyFmt, ctx])
  const res = useMemo(() => {  // frase: só se a sintaxe é explícita ou se pelo nome não há nada (assim «Black Lotus» continua a ser a carta)
    const byName = search(data, qq, dff, sctx)
    // o nome ganha só se alguma carta começa pelo que se escreveu («Black Lotus», «Lightning»); «removal» com a Seal of
    // Removal a bater no meio do nome é a função Remoção, não essa carta
    const qf = unaccent(qq.toLowerCase().trim()), nameHit = byName.cards.some(c => (c.f || c.l).startsWith(qf))
    if (!nl || (byName.total && nameHit && !/[:<>=]/.test(qq))) return { ...byName, nl: null }
    const r = search(data, nl.rest, { ...dff, ...nl.f }, sctx)  // o que sobrou da frase vai para o nome; sem nada, ignora-se
    return r.total || !nl.rest ? { ...r, nl } : { ...search(data, '', { ...dff, ...nl.f }, sctx), nl: { ...nl, rest: '', skipped: nl.rest } }
  }, [data, qq, dff, sctx, nl])
  // o formato do deck escondeu cartas com este nome? (ex.: Gaea's Cradle num deck de Pauper)
  const hidden = useMemo(() => (!anyFmt && dq.trim().length > 2 && (ctx.bit >= 0 || ctx.identity != null) ? Math.max(0, search(data, dq, F0, { bit: -1, allowUn: true }, 1).total - search(data, dq, F0, ctx, 1).total) : 0), [data, dq, ctx, anyFmt])
  const [showF, setShowF] = useState(false)
  const [swaps, setSwaps] = useState(null)
  const nActive = ['type', 'legendary', 'tag', 'sub', 'cmcMin', 'cmcMax', 'rarity', 'priceMax'].filter(k => f[k]).length + (f.colors.length ? 1 : 0) + (f.colorless ? 1 : 0)
  return (
    <div className="view">
      <div className="searchbar">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Nome, ou uma frase em qualquer língua: «encantamento que dê flying até 2», «terrenos que compram cartas»…')} className="big" />
        <button className="scan-btn" onClick={act.scan} title={tx('Ler uma carta pela câmara ou por uma foto')} aria-label={tx('Ler carta')}>📷</button>
        <label className="chk"><input type="checkbox" checked={f.inText} onChange={e => setF(x => ({ ...x, inText: e.target.checked }))} /> {tx('também no texto')}</label>
        <select value={f.sort} onChange={e => setF(x => ({ ...x, sort: e.target.value }))} aria-label={tx('Ordenar')}>
          <option value="pop">{tx('Mais jogadas')}</option><option value="name">{tx('Nome')}</option><option value="cmc">{tx('Custo')}</option><option value="price">{tx('Preço')}</option><option value="new">{tx('Mais recentes')}</option>
        </select>
      </div>
      <button className="filters-toggle" onClick={() => setShowF(!showF)}>{tx('Filtros')}{nActive ? ` (${nActive})` : ''} {showF ? '▴' : '▾'}</button>
      <div className={`filters-wrap ${showF ? 'open' : ''}`}><Filters f={f} set={setF} /></div>
      <div className="search-layout">
      <div>
      {res.nl && <p className="nl-got small"><span className="muted">{tx('Entendido como:')}</span>{res.nl.got.map((g, k) => (g.k === 'legendary' ? <span key={k} className="chip">♛ <b>{tx('Lendárias')}</b></span> : <span key={k} className="chip">{NL_L[g.k]} <b>{g.k === 'type' ? TYPE_LABEL[g.v] || g.v : g.k === 'tag' ? TAG_LABEL[g.v] || g.v : g.v}</b></span>))}{res.nl.rest && <span className="chip">{tx('nome')} <b>{res.nl.rest}</b></span>}{res.nl.skipped && <span className="muted small" title={tx('Estas palavras não ajudaram a encontrar nada e ficaram de fora')}>{tx('ignorado: «{w}»', { w: res.nl.skipped })}</span>}<button className="link small" onClick={() => setRaw(dq)} title={tx('Procurar a frase só no nome das cartas')}>✕ {tx('procurar pelo nome')}</button></p>}
      <p className="muted small">{tx('{n} cartas', { n: res.total.toLocaleString(LOCALE) })}{ctx.bit >= 0 ? ` ${tx('legais em {f}', { f: fmt.name })}` : ''}{ctx.identity != null ? ` ${tx('na identidade {c}', { c: ctx.identity || tx('incolor') })}` : ''}{res.total > res.cards.length ? ` · ${tx('a mostrar {n}', { n: res.cards.length })}` : ''}</p>
      <div className="grid">
        {res.cards.map(c => <CardTile key={c.i} c={c} pid={pidOf(deck, c.n)} onOpen={act.open} actions={<Actions {...{ c, deck, fmt, act, swaps }} />} />)}
      </div>
      {setHit && <p className="small set-hit">📦 {tx('Edição')}: <b>{setHit.set.name}</b> <span className="muted">({setHit.set.code.toUpperCase()}{setHit.set.y ? ` · ${setHit.set.y}` : ''})</span>{!setList && <span className="muted"> · {tx('a carregar as cartas da edição…')}</span>}</p>}
      {hidden > 0 && <p className="small fmt-hidden">{tx('{n} carta com este nome não é legal em {f}|{n} cartas com este nome não são legais em {f}', { n: hidden, f: ctx.identity != null && ctx.bit < 0 ? tx('na identidade do comandante') : fmt.name })} <button className="link small" onClick={() => setAnyFmt(true)}>{tx('mostrar mesmo assim')}</button></p>}
      {anyFmt && <p className="small fmt-hidden">{tx('A mostrar cartas de todos os formatos.')} <button className="link small" onClick={() => setAnyFmt(false)}>{tx('só as legais')}</button></p>}
      {!res.total && <Empty>{tx('Nenhuma carta com estes filtros.')}</Empty>}
      </div>
      <LivePanel {...{ data, deck, fmt, ctx, act }} onSwaps={setSwaps} />
      </div>
    </div>
  )
}

const TERM_ICO = { kw: '✦', sub: '🏷', type: '▦' }
const TERM_L = { kw: tx('habilidade'), sub: tx('subtipo'), type: tx('tipo') }
function SeedPicker({ data, ctx, act }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => (q.length < 2 ? [] : search(data, q, null, { ...ctx, identity: null }, 8).cards), [data, q, ctx])
  const terms = useMemo(() => {  // keywords, subtipos e tipos que começam pelo que se escreveu («rats» → Rat)
    const n = q.trim().toLowerCase(), base = n.replace(/(es|s)$/, '')
    if (n.length < 2) return []
    return termsOf(data).filter(t => { const v = t.v.toLowerCase(); return v.startsWith(n) || v === base || v.startsWith(base) }).slice(0, 6)
  }, [data, q])
  return (
    <div className="seedpick">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Junta uma carta, uma habilidade (Flying…) ou um tipo (Rat, Human…)')} />
      {(terms.length > 0 || hits.length > 0) && (
        <ul className="ac">
          {terms.map(t => <li key={t.k + t.v}><button className="ac-term" onClick={() => { act.toggleSeedTerm(t); setQ('') }}><i>{TERM_ICO[t.k]}</i><b>{t.v}</b><small className="muted">{TERM_L[t.k]} · {tx('{n} cartas', { n: t.n.toLocaleString(LOCALE) })}</small></button></li>)}
          {hits.map(c => <li key={c.i}><button onClick={() => { act.toggleSeed(c); setQ('') }}><img src={img(c, 'small')} alt="" />{c.n}</button></li>)}
        </ul>
      )}
    </div>
  )
}

export function SuggestView({ data, deck, fmt, ctx, act, setDeck, sugTag, setSugTag }) {
  const [f, setF] = useState(() => ({ ...F0, tag: sugTag }))
  const df = useDeferredValue(f)
  const [kind, setKind] = useState('')
  const filtering = ['type', 'sub', 'cmcMin', 'cmcMax', 'rarity', 'priceMax'].some(k => df[k] !== '' && df[k] != null) || df.colors.length > 0 || !!df.legendary
  const { recs: allSug, seeds, usingDeck, needs, swaps, co, cmdIdx, meta, archetype, have } = useDeckRecs(data, deck, fmt, ctx, df, filtering ? 200 : 80)  // com filtros: mais cartas (senão as melhores pontuadas tapam o resto)
  const [sort, setSortS] = useState(() => { try { return localStorage.getItem('grimorio.sug.ordem') || 'score' } catch { return 'score' } })
  const setSort = v => { setSortS(v); try { localStorage.setItem('grimorio.sug.ordem', v) } catch { /* sem armazenamento */ } }
  const recs = useMemo(() => sortRecs(applyFilter(allSug, kind, ''), sort), [allSug, kind, sort])
  return (
    <div className="view">
      <div className="seeds">
        <div>
          <h3>{tx('Sementes')}</h3>
          <p className="muted small">{usingDeck ? (seeds.length ? tx('Sem sementes: as sugestões partem do deck inteiro.') : tx('Escolhe 3 a 5 cartas de que gostas e o Grimório mostra o universo de cartas que combinam com elas.')) : tx('As sugestões partem destas cartas (e evitam o que já está no deck).')}</p>
        </div>
        <div className="chips">
          {deck.seeds.map(n => { const c = data.byName.get(n); return c && <span key={n} className="chip"><button className="link" onClick={() => act.open(c)}>{n}</button><button onClick={() => act.toggleSeed(c)} aria-label={tx('Retirar')}>×</button></span> })}
          {(deck.seedTerms || []).map(t => <span key={t.k + t.v} className="chip chip-term" title={TERM_L[t.k]}>{TERM_ICO[t.k]} {t.v}<button onClick={() => act.toggleSeedTerm(t)} aria-label={tx('Retirar {t}', { t: t.v })}>×</button></span>)}
          {(deck.seeds.length > 0 || deck.seedTerms?.length > 0) && <button className="link small" onClick={() => setDeck(d => ({ ...d, seeds: [], seedTerms: [] }))}>{tx('limpar')}</button>}
        </div>
        <SeedPicker {...{ data, ctx, act }} />
      </div>
      <PrefsPanel {...{ deck, fmt, act }} />
      <FillPanel {...{ data, deck, fmt, ctx, act, recs: allSug, needs }} />
      <CutPanel {...{ data, deck, fmt, ctx, act, swaps, recs: allSug, co, cmdIdx, needs, meta, archetype }} />
      <AdjustPanel {...{ data, deck, fmt, ctx, act, needs }} />
      <LandPanel {...{ data, deck, fmt, ctx, act, swaps, recs: allSug }} />
      <SidePanel {...{ data, deck, fmt, ctx, act, meta, have }} />
      <Filters f={f} set={x => { setSugTag(''); setF(x) }} compact noTag />
      <label className="sug-sort small">{tx('Ordenar')} <select value={sort} onChange={e => setSort(e.target.value)}>
        <option value="score">{tx('Melhores primeiro')}</option><option value="mv">{tx('Custo de mana ↑')}</option><option value="mvDesc">{tx('Custo de mana ↓')}</option>
        <option value="cor">{tx('Cor')}</option><option value="tipo">{tx('Tipo')}</option><option value="nome">{tx('Nome')}</option><option value="preco">{tx('Preço')}</option></select>
        <span className="muted">{tx('{n} cartas', { n: recs.length })}</span></label>
      <ReasonFilter recs={allSug} kind={kind} setKind={setKind} tag={f.tag} setTag={t => { setSugTag(''); setF(x => ({ ...x, tag: t })) }} needs={needs} />
      {seeds.length > 0 && <p className="muted small">{tx('Classificadas por semelhança mecânica (modelo de texto local), combos do Commander Spellbook e popularidade.')} <button className="link" onClick={() => act.showOnMap(recs[0]?.c || data.cards[seeds[0]])}>{tx('Ver no universo →')}</button></p>}
      <div className="grid">
        {recs.map(r => (
          <CardTile key={r.c.i} c={r.c} onOpen={act.open} actions={<Actions {...{ c: r.c, deck, fmt, act, swaps }} />}
            note={<><Why why={r.why} /><details className="whyx"><summary className="small">{tx('porquê?')}</summary><WhyDetail r={r} /></details></>} />
        ))}
      </div>
      {!seeds.length && <Empty>{tx('Sem sementes nem cartas no deck. Junta uma carta acima.')}</Empty>}
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
  // telemóvel e tablet ao alto: o mapa ocupa o ecrã; opções e sugestões começam fechadas (abrem-se por botão/barra)
  const narrow = typeof window !== 'undefined' && window.innerWidth < 900
  const [panel, setPanel] = useState(!narrow), [uiOpen, setUiOpen] = useState(!narrow)
  const [hint, setHint] = useState(() => { try { return localStorage.getItem('grimorio.hint.universo') !== '0' } catch { return true } })
  const showHint = v => { setHint(v); try { localStorage.setItem('grimorio.hint.universo', v ? '1' : '0') } catch { /* sem armazenamento */ } }
  const { recs: allRecs, seeds, seedsIdx, have, plan, needs, tastes, swaps, meta } = useDeckRecs(data, deck, fmt, ctx, NOLANDS, 60)
  // camadas que se ligam e desligam (guardadas): regiões por função, desempenho nos jogos, constelações do meta
  const [uni, setUniRaw] = useState(() => { try { return { reg: true, perf: true, meta: true, ...JSON.parse(localStorage.getItem('grimorio.universo') || '{}') } } catch { return { reg: true, perf: true, meta: true } } })
  const setUni = (k, v) => setUniRaw(u => { const n = { ...u, [k]: v }; try { localStorage.setItem('grimorio.universo', JSON.stringify(n)) } catch { /* sem armazenamento */ } return n })
  const [lasso, setLasso] = useState(false), [zone, setZone] = useState(null), [arch, setArch] = useState(null), [goto, setGoto] = useState(null)
  const recs = useMemo(() => applyFilter(allRecs, kind, tag).slice(0, 18), [allRecs, kind, tag])
  const regions = useMemo(() => (uni.reg ? regionsOf(data) : []), [uni.reg, data])
  const tagN = useMemo(() => { const m = {}; for (const i of have) for (const t of data.cards[i].tg) m[t] = (m[t] || 0) + 1; return m }, [have, data])
  const archs = useMemo(() => {
    if (!uni.meta) return []
    const a = archetypesOf(data, meta, have)
    return (have.length >= 4 ? a.sort((x, y) => y.fit - x.fit) : a.sort((x, y) => (y.share || 0) - (x.share || 0))).slice(0, 6)
  }, [uni.meta, data, meta, have])
  const selArch = archs.find(a => a.key === arch)
  const overlays = useMemo(() => [
    ...regions.map(r => {
      const nd = needs[r.key], n = nd ? nd[0] : tagN[r.key] || 0, gap = nd && nd[0] < nd[1]
      return { key: `r:${r.key}`, pos: r.pos, pri: tag === r.key ? 0 : gap ? 1 : n ? 3 : 4, cls: `reg ${gap ? 'gap' : n ? 'has' : ''} ${tag === r.key ? 'on' : ''}`, text: r.label, sub: nd ? `${nd[0]}/${nd[1]}` : n ? `${n}` : '',
        title: gap ? tx('O teu deck tem {n} de {t} e devia ter {k}: clica para ver as melhores daqui', { n: nd[0], t: r.label, k: nd[1] }) : tx('{t}: clica para ver as melhores daqui', { t: r.label }) }
    }),
    ...archs.map((a, k) => ({ key: `a:${a.key}`, pos: a.pos, pri: arch === a.key ? 0 : k < 2 ? 2 : 3, cls: `arch ${arch === a.key ? 'on' : ''}`, text: a.name, sub: `${Math.round(a.fit * 100)}%`,
      title: tx('Arquétipo do meta: o teu deck tem {p} do núcleo. Clica para ver o que falta', { p: `${Math.round(a.fit * 100)}%` }) })),
  ], [regions, archs, needs, tagN, tag, arch])
  const onOverlay = useCallback(k => {
    if (k.startsWith('r:')) { const t = k.slice(2), r = regions.find(x => x.key === t); setTag(v => (v === t ? '' : t)); setKind(''); setPanel(true); if (r) setGoto({ i: r.i }) }
    else { const a = archs.find(x => x.key === k.slice(2)); setArch(v => (v === a?.key ? null : a?.key)); if (a?.core[0]) setGoto({ i: a.core[0].i }) }
  }, [regions, archs])
  // desempenho nas partidas do Coliseu (ctx.tests = gameEvidence) e, para as fracas, a sugestão que as substitui
  const perfN = useMemo(() => (uni.perf ? perfOf(ctx.tests) : new Map()), [uni.perf, ctx.tests])
  const perf = useMemo(() => { const m = new Map(); for (const [n, v] of perfN) { const i = data.byName.get(n)?.i; if (i != null && have.includes(i)) m.set(i, v.s) } return m }, [perfN, data, have])
  const swapL = useMemo(() => {
    if (!perf.size) return []
    const out = [], used = new Set()
    for (const r of recs.slice(0, 12)) {
      let list = []
      try { list = swaps(r.c, { limit: 2 }) || [] } catch { /* sem trocas para esta */ }
      for (const x of list) {
        const wi = data.byName.get(x.out)?.i
        if (wi != null && !used.has(wi) && (perf.get(wi) ?? 0) <= -0.25) { used.add(wi); out.push({ a: wi, b: r.c.i, kind: 'swap' }); break }
      }
    }
    return out
  }, [perf, recs, swaps, data])
  const onLasso = useCallback(idxs => {
    // só cartas legais e das cores do deck (a identidade do comandante ou, sem ela, as cores das cartas do deck)
    const id = ctx.identity ?? (have.length >= 8 ? [...new Set(have.flatMap(i => [...(data.cards[i].mt === 'Land' ? '' : data.cards[i].ci)]))].join('') : null)
    const ok = c => passes(c, null, ctx) && (id == null || [...c.ci].every(x => id.includes(x)))
    setLasso(false); setPanel(true); setZone({ n: idxs.length, top: rankZone(data, idxs, have, allRecs, ok) })
  }, [data, have, allRecs, ctx])
  const marks = useMemo(() => {
    const m = new Map()
    for (const t of tastes) for (const i of t.idx) m.set(i, 'mine')
    for (const i of have) m.set(i, 'deck')
    for (const r of recs) m.set(r.c.i, 'sugg')
    for (const i of seedsIdx) m.set(i, 'seed')
    for (const x of selArch?.missing.slice(0, 20) || []) if (!m.has(x.i)) m.set(x.i, 'meta')
    for (const i of zone?.top || []) m.set(i, 'zone')
    if (hov != null) m.set(hov, 'hover')
    if (sel) m.set(sel.i, 'focus')
    return m
  }, [have, recs, seedsIdx, sel, hov, tastes, selArch, zone])
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
  const links = useMemo(() => (showLines ? [...deckL, ...suggL, ...swapL] : swapL), [showLines, deckL, suggL, swapL])
  const tips = useMemo(() => {
    const t = new Map(recs.map(r => [r.c.i, r.why.slice(0, 2).map(w => w.txt).join(' · ')]))
    for (const [n, v] of perfN) { const i = data.byName.get(n)?.i; if (i != null && have.includes(i)) t.set(i, v.why) }
    return t
  }, [recs, perfN, data, have])
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
      <Map3D data={data} marks={marks} dim={dim} links={links} focus={focus} onPick={pick} onAdd={addI} frame={frame} follow={follow} tips={tips}
        overlays={overlays} onOverlay={onOverlay} perf={perf} goto={goto} lasso={lasso} onLasso={onLasso} />
      <div className={`map-ui ${uiOpen ? '' : 'closed'}`}>
        {narrow && <button className="small map-ui-tg" onClick={() => setUiOpen(v => !v)} aria-expanded={uiOpen}>{uiOpen ? `× ${tx('Fechar as opções')}` : `⚙ ${tx('Opções')}`}</button>}
        {uiOpen && (hint ? (
          <div className="map-hint" role="note">
            <button className="map-hint-x" onClick={() => showHint(false)} aria-label={tx('Fechar')}>✕</button>
            <b>{tx('O que é o Universo?')}</b>
            <p>{tx('Cada ponto é uma carta. Cartas com texto e funções parecidas ficam perto umas das outras; o teu deck brilha como uma constelação.')}</p>
            <p>{tx('Serve para descobrir cartas à volta das tuas: as sugestões pulsam ligadas à carta com que combinam. Clique para ver, duplo clique para juntar ao deck; arrasta para rodar e usa a roda para aproximar.')}</p>
          </div>
        ) : <button className="link plain small map-hint-open" onClick={() => showHint(true)}>{tx('? O que é o Universo')}</button>)}
        <div className="seedpick">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Voar até uma carta…')} />
          {hits.length > 0 && <ul className="ac">{hits.map(c => <li key={c.i}><button onClick={() => { pick(c.i); setQ('') }}><img src={img(c, 'small')} alt="" />{c.n}</button></li>)}</ul>}
        </div>
        {uiOpen && <>
        <div className="map-toggles">
          <label className="chk"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> {tx('seguir o deck')}</label>
          <label className="chk"><input type="checkbox" checked={foco} onChange={e => setFoco(e.target.checked)} /> {tx('só deck e sugestões')}</label>
          <label className="chk"><input type="checkbox" checked={showLines} onChange={e => setShowLines(e.target.checked)} /> {tx('ligações')}</label>
          {!foco && <label className="chk"><input type="checkbox" checked={onlyLegal} onChange={e => setOnlyLegal(e.target.checked)} /> {tx('apagar as que não servem')}</label>}
          <label className="chk" title={tx('Zonas do mapa por função (remoção, compra, ramp…); a vermelho as que faltam ao teu deck')}><input type="checkbox" checked={uni.reg} onChange={e => setUni('reg', e.target.checked)} /> {tx('regiões')}</label>
          <label className="chk" title={tx('Tamanho e cor das cartas do deck pelo que fizeram nos jogos do Coliseu; seta vermelha = troca sugerida')}><input type="checkbox" checked={uni.perf} onChange={e => setUni('perf', e.target.checked)} /> {tx('desempenho')}</label>
          <label className="chk" title={meta?.archetypes?.length ? tx('Arquétipos dos torneios deste formato e quanto o teu deck se parece com cada um') : tx('Sem arquétipos do meta para este formato')}><input type="checkbox" checked={uni.meta} disabled={!meta?.archetypes?.length} onChange={e => setUni('meta', e.target.checked)} /> {tx('meta')}</label>
          <button className={`small ${lasso ? 'on' : ''}`} onClick={() => setLasso(l => !l)} title={tx('Desenha à volta de uma zona do mapa e vê as melhores cartas de lá para o teu deck')}>◯ {tx('Laço')}</button>
        </div>
        {lasso && <p className="small map-note">{tx('Desenha à volta de uma zona do mapa (arrasta com o rato ou o dedo).')}</p>}
        {uni.perf && have.length > 0 && (perf.size
          ? <p className="small muted">{tx('Desempenho: dourado e maior = ganhou jogos · vermelho e menor = pesou')}{swapL.length ? ` · ${tx('seta vermelha = troca sugerida')}` : ''}</p>
          : <p className="small muted">{tx('Sem jogos deste deck no Coliseu: põe-no a jogar para ver o desempenho de cada carta.')}</p>)}
        {plan.length > 0 && <p className="small"><span className="muted">{tx('Plano:')}</span> {plan.map(x => <span key={x.label} className="plan-chip">{x.label} <b>{x.n}</b></span>)}</p>}
        <p className="muted small">{have.length ? `${tx('{n} cartas no deck', { n: have.length })} · ${deckL.filter(l => l.kind === 'combo').length ? `${tx('linhas douradas = combos')} · ` : ''}${tx('tracejado = quem alimenta quem')}` : tx('Clica numa carta para a ver; duplo clique junta-a ao deck.')}</p>
        </>}
      </div>

      {sel && (
        <div className="map-card">
          <img src={img(sel, 'normal', false, pidOf(deck, sel.n))} alt={sel.n} onClick={() => act.open(sel)} />
          {selRec && <Why why={selRec.why.slice(0, 3)} />}
          <div className="row-btns">
            <button className="primary" onClick={() => act.add(sel)}>+ Deck</button>
            <button onClick={() => act.toggleSeed(sel)}>{deck.seeds.includes(sel.n) ? '★' : '☆'} {tx('Semente')}</button>
            <button onClick={() => act.open(sel)}>{tx('Detalhes')}</button>
            <button onClick={() => setSel(null)} aria-label={tx('Fechar')}>×</button>
          </div>
        </div>
      )}

      <aside className={`map-recs ${panel ? '' : 'closed'} ${sel ? 'with-card' : ''}`}>
        <button className="live-head" onClick={() => setPanel(!panel)}><b>{tx('Sugestões')}</b><span className="muted small">{seeds.length ? `${recs.length}` : ''}</span><span className="chev">{panel ? '▾' : '▸'}</span></button>
        {panel && zone && (
          <div className="map-zone">
            <div className="map-zone-h"><b>◯ {tx('Melhores desta zona')}</b><span className="muted small">{tx('{n} cartas na zona', { n: zone.n })}</span><button className="link plain" onClick={() => setZone(null)} aria-label={tx('Fechar')}>×</button></div>
            {zone.top.length ? <ul className="live-list">{zone.top.map(i => { const c = data.cards[i], r = allRecs.find(x => x.c.i === i); return (
              <li key={i} onMouseEnter={e => { setHov(i); showCardPeek(e, c) }} onMouseLeave={() => { setHov(null); hideCardPeek() }}>
                <button className="live-img" onClick={() => pick(i)}><img src={img(c, 'art_crop')} alt="" loading="lazy" /></button>
                <div className="live-txt"><div className="live-name"><button className="link plain" onClick={() => pick(i)}>{c.n}</button><Mana cost={c.mc} /></div>{r ? <Why why={r.why.slice(0, 2)} /> : <small className="muted">{tx('Texto parecido com o do teu deck')}</small>}</div>
                <AddOrSwap c={c} act={act} swaps={swaps}><button className="act add" onClick={() => act.add(c)} title={tx('Juntar ao deck')}>+</button></AddOrSwap>
              </li>) })}</ul> : <p className="muted small">{tx('Nada nesta zona serve ao teu deck (formato, cores ou já lá está).')}</p>}
          </div>
        )}
        {panel && selArch && (
          <div className="map-zone arch">
            <div className="map-zone-h"><b>{selArch.name}</b><span className="muted small">{tx('tens {p} do núcleo', { p: `${Math.round(selArch.fit * 100)}%` })}</span><button className="link plain" onClick={() => setArch(null)} aria-label={tx('Fechar')}>×</button></div>
            {selArch.missing.length ? <ul className="live-list">{selArch.missing.slice(0, 10).map(x => { const c = data.cards[x.i]; return (
              <li key={x.i} onMouseEnter={e => { setHov(x.i); showCardPeek(e, c) }} onMouseLeave={() => { setHov(null); hideCardPeek() }}>
                <button className="live-img" onClick={() => pick(x.i)}><img src={img(c, 'art_crop')} alt="" loading="lazy" /></button>
                <div className="live-txt"><div className="live-name"><button className="link plain" onClick={() => pick(x.i)}>{c.n}</button><Mana cost={c.mc} /></div><small className="muted">{tx('Em {p} dos decks deste arquétipo', { p: `${Math.round(x.incl * 100)}%` })}</small></div>
                <AddOrSwap c={c} act={act} swaps={swaps}><button className="act add" onClick={() => act.add(c)} title={tx('Juntar ao deck')}>+</button></AddOrSwap>
              </li>) })}</ul> : <p className="muted small">{tx('Já tens o núcleo todo deste arquétipo.')}</p>}
          </div>
        )}
        {panel && <div className="live-prefs"><PrefsPanel {...{ deck, fmt, act }} compact /></div>}
        {panel && tastes.length > 0 && <p className="small muted map-taste">♥ {tx('{n} deck teu no mapa (violeta):|{n} decks teus no mapa (violeta):', { n: tastes.length })} {tastes.map(t => t.name).join(', ')}</p>}
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
                  <AddOrSwap c={r.c} act={act} swaps={swaps}><button className="act add" onClick={() => act.add(r.c)} title={tx('Juntar ao deck')}>+</button></AddOrSwap>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="muted small live-empty">{tx('Junta o comandante ou umas cartas (duplo clique num ponto) e as sugestões aparecem a pulsar à volta do deck.')}</p>)}
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
              {miss && <span>{tx('falta')}</span>}
            </button>
          )
        })}
      </div>
      <div className="combo-txt">
        <b>{produces.join(' · ') || 'Combo'}</b>
        {requires.length > 0 && <small>{tx('Precisa também de:')} {requires.join(', ')}</small>}
        <small className="muted">{idx.map(i => data.cards[i].n).join(' + ')}{pop ? ` · ${pop.toLocaleString(LOCALE)} decks` : ''}{bracket ? ` · bracket ${bracket}` : ''}</small>
        <span className="row-btns">
          {missing.map(i => <button key={i} className="primary" onClick={() => act.add(data.cards[i])} disabled={inDeck(deck, data.cards[i].n) > 0}>+ {data.cards[i].n}</button>)}
          <a href={`https://commanderspellbook.com/combo/${id}/`} target="_blank" rel="noreferrer">{tx('passos ↗')}</a>
        </span>
      </div>
    </li>
  )
}

// Cartas do deck numa categoria de sinergia: nome com cópias, espreitar ao passar, abrir ao tocar.
function SynChips({ list, deck, act, max = 10 }) {
  const [all, setAll] = useState(false)
  if (!list.length) return <span className="muted small">{tx('nenhuma ainda')}</span>
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
        <span className="syn-bar" title={tx('Força {p}%', { p: pct })}><i style={{ width: `${pct}%` }} /></span><span className="syn-pct">{pct}%</span>
      </div>
      <p className="syn-why">{s.why}</p>
      {reasons.map(r => <p key={r} className="syn-warn">{r}</p>)}
      <div className="syn-side"><span className="syn-l">{tx('Ativam')} <em>{E}</em></span><SynChips list={en} {...{ deck, act }} /></div>
      <div className="syn-side"><span className="syn-l">{tx('Beneficiam')} <em>{P}</em></span><SynChips list={pay} {...{ deck, act }} /></div>
      {sug.length > 0 && (
        <details className="syn-sug">
          <summary>{tx('Pode reforçar')} <span className="muted">{sug.length}</span></summary>
          <ul>{sug.map(({ c, side }) => (
            <li key={c.i}>
              <button className="link" onClick={() => act.open(c)} {...hoverPeek(c)}>{c.n}</button>
              <span className="muted small">{side === 'pay' ? tx('beneficia') : tx('ativa')}</span>
              <button className="primary" onClick={() => act.add(c)} disabled={inDeck(deck, c.n) > 0}>+ {tx('deck')}</button>
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
  if (!have.length) return <div className="view"><Empty>{tx('Junta cartas ao deck (ou sementes) para ver as sinergias, os combos que já tens e os que estão a uma carta.')}</Empty></div>
  return (
    <div className="view">
      <h3>{tx('Sinergias do deck')} <span className="muted">{syn.cats.length}</span></h3>
      <p className="muted small">{tx('Cartas que funcionam bem juntas: umas ativam o tema, outras beneficiam dele. A força pesa as duas metades face ao tamanho do deck.')}</p>
      {syn.cats.length ? <ul className="syns">{syn.cats.map(x => <SynCat key={x.s.k} {...{ x, deck, act }} />)}</ul> : <p className="muted small">{tx('Nenhum tema claro ainda.')}</p>}
      {syn.pairs.length > 0 && (
        <>
          <h3>{tx('Pares fortes')} <span className="muted">{syn.pairs.length}</span></h3>
          <ul className="syn-pairs">{syn.pairs.map((p, k) => (
            <li key={k}>
              <SynChips list={p.a.map(c => ({ c, q: 1 }))} {...{ deck, act }} max={4} />
              <span className="muted small">{p.why} →</span>
              <SynChips list={p.b.map(c => ({ c, q: 1 }))} {...{ deck, act }} max={6} />
            </li>
          ))}</ul>
        </>
      )}
      <h3>{tx('Combos fechados (infinitos / vitória)')} <span className="muted">{full.length}</span></h3>
      {full.length ? <ul className="combos">{full.slice(0, 50).map(x => <Combo key={x.k} {...x} {...{ data, act, deck }} />)}</ul> : <p className="muted small">{tx('Nenhum combo completo ainda (Commander Spellbook).')}</p>}
      <h3>{tx('A uma carta de distância')} <span className="muted">{near.length}</span></h3>
      <ul className="combos">{near.slice(0, n).map(x => <Combo key={x.k} {...x} {...{ data, act, deck }} />)}</ul>
      {near.length > n && <button onClick={() => setN(n + 30)}>{tx('Mostrar mais')}</button>}
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

// as peças da Análise que vêm do motor de sugestões (uma só chamada): melhorias, base de mana, plano e o atalho às sugestões
function usePlanCuts({ data, deck, fmt, ctx, act, issues }) {
  const { recs, plan, co, cmdIdx, needs, meta, archetype } = useDeckRecs(data, deck, fmt, ctx, null, 150)
  const toSug = key => { try { localStorage.setItem(key, '1') } catch { /* sem armazenamento */ } act.suggestFor('') }
  const manaCard = (
    <Fold>
      <h3>{tx('Base de mana')} <Hint t={tx('Fontes de cada cor que o deck tem e de que precisa nesta fase (Frank Karsten); a vermelho as que faltam.')} /></h3>
      <p className="muted small">{tx('Fontes por cor: tem/precisa nesta fase (aprox. Frank Karsten; um custo com {gg} pede mais fontes verdes do que {g}).', { gg: '{G}{G}', g: '{G}' })}</p>
      <ManaBlock {...{ data, deck, fmt, ctx, act, co }} limit={0} />
      <button className="link small" onClick={() => toSug('grimorio.terrenos')}>⛰ {tx('Terrenos sugeridos (em Sugestões) →')}</button>
    </Fold>
  )
  const cuts = useMemo(() => { const rean = reanimTargets(data, deck); return deckCuts(data, deck, { ctx, co, commanders: cmdIdx, needs, recs, meta, archetype }).filter(x => !rean.has(x.c.n)) }, [data, deck, ctx, co, cmdIdx, needs, recs, meta, archetype])
  return {
    prio: <PriorityCard {...{ data, deck, fmt, ctx, act, issues, cuts, needs }} />,
    mana: manaCard,
    plan: (
      <section className="card">
        <h3>{tx('Plano do deck')} <Hint t={tx('Os eixos do deck: cartas que geram algo (fichas, marcadores, cemitério…) e cartas que o aproveitam.')} /></h3>
        {archetype && <p className="small">{tx('Arquétipo provável:')} <b>{archetype.name}</b> <span className="muted">({tx('{n} cartas do núcleo, {p}% do meta de {f}', { n: archetype.got, p: Math.round(archetype.share * 100), f: fmt.name })})</span></p>}
        {plan.length ? plan.map(x => (
          <div key={x.label} className="plan-row"><b>{x.label}</b><span className="muted small">{x.roles.length ? tx('{a} geram · {b} aproveitam', { a: x.enablers, b: x.payoffs }) : tx('{n} criatura|{n} criaturas', { n: x.n })}</span></div>
        )) : <p className="muted small">{tx('Ainda sem eixo claro. Os eixos aparecem quando há cartas que geram algo (fichas, marcadores, cemitério…) e outras que o aproveitam.')}</p>}
        {plan[0] && <p className="muted small">{tx('As sugestões dão mais peso a cartas que alimentam ou aproveitam estes eixos, e dizem com que cartas do deck interagem.')}</p>}
      </section>),
    sug: (
      <section className="card">
        <h3>{tx('Sugestões para este deck')}</h3>
        <p className="muted small">{tx('Trocas, quantidades, terrenos e sideboard estão em Sugestões.')}</p>
        <div className="row-btns"><button onClick={() => toSug('grimorio.trocar')}>✂ {tx('Trocar no deck')}{cuts.length ? ` (${cuts.length})` : ''}</button>{fmt.side > 0 && <button onClick={() => toSug('grimorio.sideboard')}>🛡 {tx('Sideboard')}</button>}</div>
      </section>),
  }
}

// Registo do deck (Laboratório, torneios e Arena, sem contar o mesmo jogo duas vezes): contra quem ganhou e perdeu,
// dano feito e levado por jogo e as cartas que mais dano fazem (GET /api/decks/<id>/record, ratings.deck_record)
const SRC_LABEL = { lab: tx('Laboratório'), torneio: tx('Torneios'), arena: 'Arena' }
// as três estrelas do deck com os números e as vias do vermelho (média por jogo de cada via, e por qual ganha mais)
const ROUTE_LABEL = { dmg: tx('dano'), psn: tx('veneno'), cmd: tx('comandante'), mill: tx('biblioteca'), alt: tx('vitória alternativa') }
function RatingLayers({ r }) {
  const by = Object.entries(r.by || {}).sort((a, b) => b[1] - a[1]), wins = by.reduce((t, [, n]) => t + n, 0)
  const v = x => (x == null ? '—' : num(x, 1))
  return (
    <div className="rec-rt">
      <Stars r={r} />
      <div className="rec-dmg">
        <span><b className="st-y">{v(r.stars)}</b><small>{tx('normal (jogos não casuais)')}</small></span>
        <span><b className="st-b">{v(r.blue)}</b><small>{tx('todos os jogos')}{r.blue_games ? ` · ${r.blue_games}` : ''}</small></span>
        <span><b className="st-r">{v(r.red)}</b><small>{tx('objetivo')}{r.goal != null ? ` · ${Math.round(r.goal * 100)}% · ${tx('{n} jogo|{n} jogos', { n: r.red_games })}` : ''}</small></span>
      </div>
      {r.routes && <ul className="rec-list rec-routes">{Object.entries(r.routes).filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).map(([k, x]) => (
        <li key={k}><span>{ROUTE_LABEL[k]}</span><b>{Math.round(x * 100)}%</b><i className="rec-bar" style={{ '--p': `${Math.min(100, x * 50)}%` }} /></li>
      ))}</ul>}
      {wins > 0 && <p className="muted small">{tx('Ganha por: {v}', { v: by.map(([k, n]) => `${ROUTE_LABEL[k]} ${Math.round((100 * n) / wins)}%`).join(' · ') })} · {tx('objetivo: média por jogo de quanto chega a ganhar (dano ÷ vida inicial, veneno ÷ 10, comandante ÷ 21, cartas tiradas da biblioteca ÷ biblioteca inicial; a melhor via conta, até 200%); 100% = 3★, 200% = 6★')}</p>}
    </div>
  )
}
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
    <Fold>
      <h3>{tx('Registo de jogos')} <Hint t={tx('Todos os jogos deste deck no Laboratório, torneios e Arena, sem contar o mesmo jogo duas vezes.')} /> {rec?.games > 0 && <span className="muted small">{tx('{n} jogo|{n} jogos', { n: rec.games })} · {wdl(rec)} · {pct(rec)}% · {rec.by_source_wld ? Object.entries(rec.by_source_wld).map(([k, o]) => <span key={k} className="src-wld" title={tx('{s}: vitórias-derrotas-empates', { s: SRC_LABEL[k] || k })}>{SRC_LABEL[k] || k} {wdl(o)}</span>) : Object.entries(rec.by_source).map(([k, n]) => `${SRC_LABEL[k] || k} ${n}`).join(' · ')}</span>}</h3>
      {rec?.rating && <RatingLayers r={rec.rating} />}
      {!rec?.games ? <p className="muted small">{deck.id ? tx('Ainda sem jogos: testa-o no Laboratório, põe-no num torneio ou liga a Arena automática nos Ratings.') : tx('Guarda o deck para começar a juntar o registo.')}</p> : <>
        <div className="rec-dmg">
          <span><b>{rec.dealt ?? '—'}</b><small>{tx('dano feito por jogo')}</small></span>
          <span><b>{rec.taken ?? '—'}</b><small>{tx('dano levado por jogo')}</small></span>
          <span className="muted small">{tx('dano a adversários (veneno incluído) em {n} jogos com registo; o levado só nos jogos a dois', { n: rec.with_dmg })}</span>
        </div>
        <div className="rec-grid">
          <div><h4>{tx('Adversários')}</h4><ul className="rec-list">{rec.opponents.slice(0, 20).map(o => (
            <li key={o.name}><span title={o.name}>{o.name}</span>{wdl(o)}<i className="rec-bar" style={{ '--p': `${pct(o)}%` }} title={`${tx('{p}% de vitórias', { p: pct(o) })} · ${o.src.map(x => SRC_LABEL[x] || x).join(', ')}`} /></li>
          ))}</ul>{rec.opponents.length > 20 && <small className="muted">{tx('+{n} adversários', { n: rec.opponents.length - 20 })}</small>}</div>
          <div><h4>{tx('Cartas que mais dano fazem')}</h4><ul className="rec-list">{rec.cards.map(c => (
            <li key={c.card}><span>{name(c.card)}</span><b>{c.dmg}</b><small className="muted">{tx('{n} jogo|{n} jogos', { n: c.games })}{c.top_wins ? ` · ${tx('a melhor em {n} vitória|a melhor em {n} vitórias', { n: c.top_wins })}` : ''}</small></li>
          ))}</ul>{!rec.cards.length && <small className="muted">{tx('Sem dano registado.')}</small>}</div>
          <div><h4>{tx('O que mais te magoa')}</h4><ul className="rec-list">{rec.hurt.map(c => (
            <li key={c.card}><span>{name(c.card)}</span><b>{c.dmg}</b></li>
          ))}</ul>{!rec.hurt.length && <small className="muted">{tx('Sem dano registado.')}</small>}</div>
        </div>
      </>}
    </Fold>
  )
}

// Cartão da Análise que encolhe quando é muito alto (listas compridas): mostra ~FOLD px e um «mostrar tudo»
const FOLD = 640
function Fold({ children }) {
  const ref = useRef(null), [tall, setTall] = useState(false), [open, setOpen] = useState(false)
  useLayoutEffect(() => { const el = ref.current; if (el) setTall(el.scrollHeight > FOLD + 120) })
  return (
    <section className={`card fold ${tall && !open ? 'shut' : ''}`}>
      <div ref={ref} className="fold-in" style={tall && !open ? { maxHeight: FOLD } : undefined}>{children}</div>
      {tall && <button className="link small fold-btn" onClick={() => setOpen(o => !o)}>{open ? tx('▴ mostrar menos') : tx('▾ mostrar tudo')}</button>}
    </section>
  )
}

// Análise › Troféus: estrelas brancas (dos pontos dos troféus), os pontos e o lugar entre os meus decks
function TrophyCard({ deck }) {
  const [all, setAll] = useState(null)
  useEffect(() => { fetch('/api/tournaments/trophies').then(r => (r.ok ? r.json() : {})).then(setAll).catch(() => setAll({})) }, [deck.id])
  if (!all || !deck.id) return null
  const pts = Object.fromEntries(Object.entries(all).map(([id, l]) => [id, deckPoints(l)]))
  const p = pts[deck.id] || 0, n = (all[deck.id] || []).filter(x => x.valid !== false).length
  const rank = 1 + Object.values(pts).filter(x => x > p).length, of = Object.values(pts).filter(x => x > 0).length
  return (
    <section className="card">
      <h3>{tx('Troféus')}</h3>
      {p > 0 ? <>
        <WhiteStars v={trophyStars(p)} title={tx('Estrelas brancas: dos pontos dos troféus (não do jogo)')} />
        <p className="small">{tx('{p} pontos de troféus · {n} troféu|{p} pontos de troféus · {n} troféus', { p, n })} · {tx('n.º {r} de {o} entre os teus decks', { r: rank, o: of })}</p>
        {(() => { const sp = deckSplit(all[deck.id]); return sp.blue > 0 && <p className="muted small">{tx('{a} normais (ranked) + {b} de troféus azuis (casual ou não ranked, valem metade)', { a: sp.normal, b: sp.blue })}</p> })()}
      </> : <p className="muted small">{tx('Ainda sem troféus que contem. Ganha um pódio num torneio (as estrelas brancas vêm dos pontos dos troféus).')}</p>}
    </section>
  )
}

export function AnalysisView({ data, deck, fmt, ctx, act, issues }) {
  const s = useMemo(() => stats(deck, data), [deck, data])
  const [hand, setHand] = useState(null)
  const advised = landAdvice(fmt, s.avgMv || 3, s.cheapRampDraw)
  const targets = Object.entries(fmt.targets || {})
  const total = s.lands + s.spells
  const odds = useMemo(() => landOdds(total, s.lands), [s.lands, total])
  const pcs = usePlanCuts({ data, deck, fmt, ctx, act, issues })
  const valRef = useRef(null)
  return (
    <div className="view an-dash">
      <div className="an-head">
        <h2>{tx('Análise')} <span className="muted">· {fmt.name}</span></h2>
        {fmt.tips?.length > 0 && <details className="an-help">
          <summary title={tx('Modo de ajuda')}>ⓘ {tx('Regras de {f}', { f: fmt.name })}</summary>
          <ul className="tips">{fmt.tips.map((t, k) => <li key={k}>{t}</li>)}</ul>
        </details>}
      </div>
      <Kpis {...{ s, total, fmt, advised, odds, issues }} onIssues={() => valRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
      <div className="an-charts">
        <CurveChart {...{ data, deck, s }} />
        <ColorDonuts {...{ data, deck, s }} />
      </div>
      <div className="analysis">
        <HandOdds {...{ odds, hand, data, deck, act }} canDraw={Object.keys(deck.main).length > 0} onDraw={n => setHand(sampleHand(deck, n))} />
        {pcs.mana}
        {targets.length > 0 && (
          <section className="card">
            <h3>{tx('Funções do deck')} <Hint t={tx('Quantas cartas fazem cada coisa (remoção, compra, ramp…) contra o recomendado para o formato; a linha marca o alvo.')} /></h3>
            <p className="muted small">{tx('Contagem pelas etiquetas automáticas; carrega numa linha para ver sugestões dessa função.')}</p>
            {targets.map(([t, n]) => <Bar key={t} label={TAG_LABEL[t]} v={s.tags[t] || 0} max={n * 1.6} target={n} onClick={() => act.suggestFor(t)} />)}
            <div className="types">{Object.entries(s.tags).filter(([t]) => !(t in fmt.targets) && t !== 'land').sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, v]) => <span key={t}>{TAG_LABEL[t]} <b>{v}</b></span>)}</div>
          </section>
        )}
        {pcs.plan}
        <DeckRecord {...{ deck, data, act }} />
        <WinLoseCard {...{ data, deck, fmt, ctx, act }} peek={showCardPeek} unpeek={hideCardPeek} toSide={() => { try { localStorage.setItem('grimorio.sideboard', '1') } catch { /* sem armazenamento */ } act.suggestFor('') }} />
        <CardsInGames {...{ data, deck, act }} ev={ctx.tests} peek={showCardPeek} unpeek={hideCardPeek} />
        <TrophyCard deck={deck} />
        <PriceCard {...{ data, deck, s, act }} />
        {pcs.sug}
      </div>
      <div ref={valRef}>{pcs.prio}</div>
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
  if (err) return <p className="muted small">{tx('Não consegui falar com a Scryfall para ver as edições.')}</p>
  if (!prints) return <p className="muted small">{tx('A procurar edições e estilos…')}</p>
  const styles = [...new Set(prints.flatMap(p => p.style))].filter(x => x.length > 2)
  const shown = style ? prints.filter(p => p.style.includes(style)) : prints
  const pick = (p, foil = false) => { act.setPrint(c, { id: p.id, set: p.set, cn: p.cn, eur: p.eur, eurFoil: p.eurFoil, style: p.style, foil }); onPreview(p.id) }
  return (
    <>
      <div className="row-btns">
        <select value={style} onChange={e => setStyle(e.target.value)} aria-label={tx('Estilo')}>
          <option value="">{tx('Todas ({n})', { n: prints.length })}</option>
          {styles.map(x => <option key={x} value={x}>{x} ({prints.filter(p => p.style.includes(x)).length})</option>)}
        </select>
        {(chosen || deck.art?.[c.n]) && <button onClick={() => { act.setPrint(c, null); onPreview(null) }}>{tx('Voltar à predefinida')}</button>}
      </div>
      {deck.art?.[c.n] && <p className="small">{tx('Agora: arte própria do site de origem (ex.: alterada no TappedOut). Escolher uma edição substitui-a; «⟳ Atualizar do site» volta a trazê-la.')}</p>}
      <div className="prints">
        {shown.map(p => (
          <div key={p.id} className={`print ${chosen?.id === p.id ? 'on' : ''}`}>
            <button onClick={() => pick(p, chosen?.id === p.id ? chosen.foil : false)} onMouseEnter={() => onPreview(p.id, true)} onMouseLeave={() => onPreview(null, true)} title={`${p.setName} #${p.cn} · ${p.artist || ''}`}>
              <img src={img(c, 'small', false, p.id)} alt={`${p.setName}`} loading="lazy" />
            </button>
            <small><b>{p.set}</b> {p.y}{p.style.length ? ` · ${p.style.join(', ')}` : ''}</small>
            <small className="muted">{p.eur != null ? `${num(p.eur, 2)} €` : '—'}{p.eurFoil != null ? <> · <button className={`link ${chosen?.id === p.id && chosen.foil ? 'on' : ''}`} onClick={() => pick(p, true)}>foil {num(p.eurFoil, 2)} €</button></> : null}</small>
          </div>
        ))}
      </div>
    </>
  )
}

const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg'  // o verso comum das cartas (Scryfall)
export function CardModal({ c, data, deck, fmt, ctx, act, onClose }) {
  const [back, setBack] = useState(false)  // flip 3D: a outra face (cartas de duas faces) ou o verso
  const [rot, setRot] = useState(0)  // virar ao contrário (180° de cada vez, animado)
  const [subs, setSubs] = useState(false)  // 🔁 substitutos desta carta neste deck (motor + IA)
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
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <div className="cm-img">
          <div className="cm-turn" style={{ '--rot': `${rot}deg` }}>
            <div className="cm-tilt" onClick={() => setBack(b => !b)} title={tx('Clica para virar')}
              onPointerMove={e => { if (e.pointerType !== 'mouse') return; const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
                e.currentTarget.style.setProperty('--tx', `${(x * 18).toFixed(1)}deg`); e.currentTarget.style.setProperty('--ty', `${(-y * 18).toFixed(1)}deg`); e.currentTarget.style.setProperty('--gx', `${(x + 0.5) * 100}%`); e.currentTarget.style.setProperty('--gy', `${(y + 0.5) * 100}%`) }}
              onPointerLeave={e => { e.currentTarget.style.setProperty('--tx', '0deg'); e.currentTarget.style.setProperty('--ty', '0deg') }}>
            <div className={`cm-flip ${back ? 'on' : ''}`}>
              <img className="cm-face" src={img(c, 'large', false, pid)} alt={c.n} />
              <img className="cm-face cm-back" src={c.df ? img(c, 'large', true, pid) : CARD_BACK} alt={c.df ? tx('Outra face de {c}', { c: c.n }) : tx('Verso da carta')} loading="lazy" />
            </div>
            <i className="cm-shine" aria-hidden="true" />
            </div>
          </div>
          {deck.art?.[c.n] ? <small className="muted">{tx('Arte própria do site de origem')}</small> : deck.prints?.[c.n] && <small className="muted">{tx('Estilo escolhido:')} {deck.prints[c.n].set} #{deck.prints[c.n].cn}{deck.prints[c.n].foil ? ' (foil)' : ''}</small>}
          <div className="row-btns cm-turn-btns">
            <button onClick={() => setRot(r => r + 180)} title={tx('Para ler o que está escrito ao contrário')}>↻ {tx('Virar ao contrário')}</button>
            <button onClick={() => setBack(!back)}>⟲ {c.df ? (back ? tx('Face da frente') : tx('Outra face')) : back ? tx('Ver a frente') : tx('Ver o verso')}</button>
          </div>
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
            {fmt.cmd && canBeCommander(c, fmt) && <button onClick={() => act.setCommander(c)}>♛ {deck.commanders.includes(c.n) ? tx('Retirar comandante') : tx('Comandante')}</button>}
            <button onClick={() => act.toggleSeed(c)}>{deck.seeds.includes(c.n) ? `★ ${tx('É semente')}` : `☆ ${tx('Semente')}`}</button>
            <button onClick={() => act.showOnMap(c)}>{tx('Ver no universo')}</button>
            {(deck.main[c.n] || deck.side[c.n]) && <button className={subs ? 'on' : ''} onClick={() => setSubs(!subs)}>🔁 {tx('Substitutos neste deck')}</button>}
          </div>
          {subs && <Subs c={c} data={data} deck={deck} fmt={fmt} ctx={ctx} act={act} />}
          {combos.length > 0 && (
            <>
              <h4>{tx('Combos com esta carta')} <span className="muted">{data.combosByCard[c.i].length}</span></h4>
              <ul className="cm-combos">{combos.map(cb => (
                <li key={cb[0]}><a href={`https://commanderspellbook.com/combo/${cb[0]}/`} target="_blank" rel="noreferrer">{cb[1].filter(i => i !== c.i).map(i => data.cards[i].n).join(' + ')}</a> <span className="muted">→ {cb[2].slice(0, 2).join(', ')}</span></li>
              ))}</ul>
            </>
          )}
          <h4>{tx('Estilos e edições')}</h4>
          <Prints c={c} deck={deck} act={act} onPreview={onPreview} />
          <h4>{tx('Semelhantes')}</h4>
          <div className="sims">{sims.map(({ c: s }) => <button key={s.i} onClick={() => act.open(s)} title={s.n}><img src={img(s, 'small')} alt={s.n} loading="lazy" /></button>)}</div>
        </div>
      </div>
    </div>
  )
}

// 🔁 Substitutos de uma carta do deck: as sugestões que o motor das trocas põe no lugar DELA (o porquê de cada), e a
// mesma pergunta à IA, só sobre esta carta
function Subs({ c, data, deck, fmt, ctx, act }) {
  const land = c.mt === 'Land'
  const { recs, swaps, plan } = useDeckRecs(data, deck, fmt, ctx, land ? LANDS_ONLY : NOLANDS, 60)
  const list = useMemo(() => {
    const cands = [...recs.map(r => r.c), ...similar(data, c.i, ctx, 12).map(x => x.c)].filter((x, k, a) => x.n !== c.n && a.indexOf(x) === k && !deck.main[x.n])
    const out = []
    for (const S of cands) {
      let l = []
      try { l = swaps(S, { limit: 8 }) || [] } catch { continue }
      const x = !l.none && l.find(o => o.out === c.n)
      if (x) out.push({ S, ...x })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6)
  }, [recs, swaps, data, c, ctx, deck.main])
  const [ia, setIa] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const askIA = async () => {
    setBusy(true); setErr('')
    try {
      setIa(await postJSON('/api/ia/ask', { mode: 'carta', question: tx('A carta a analisar é «{c}» ({q} cópia(s) no deck).', { c: c.n, q: deck.main[c.n] || deck.side[c.n] || 0 }),
        context: { formato: `${fmt.name}: ${fmt.size[0]} cartas`, comandante: deck.commanders.join(' + '), plano: plan.map(x => `${x.label} (${x.n})`).join(', '), lista: exportList(deck) } }))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const card = n => n && (data.byName.get(n) || data.byLower.get(String(n).toLowerCase()))
  const iaSubs = (ia?.trocas || []).map(x => ({ ...x, b: card(x.entra) })).filter(x => x.b && x.b.n !== c.n && passes(x.b, null, ctx))
  const q = deck.main[c.n] || 0
  return (
    <div className="subs">
      <h4>🔁 {tx('Substitutos para {c} neste deck', { c: c.n })}</h4>
      {!list.length ? <p className="small muted">{tx('O motor não encontra uma substituta claramente melhor: a carta está a cumprir o seu papel neste deck.')}</p>
        : <ul className="subs-list">{list.map(x => (
          <li key={x.S.n}>
            <button className="cutp-card in" onClick={() => act.open(x.S)}><img src={img(x.S, 'art_crop')} alt="" loading="lazy" /><span><b>{x.S.n}</b><Mana cost={x.S.mc} /></span></button>
            <ul className="why">{x.why.slice(0, 3).map((w, k) => <li key={k} className="falta">{w}</li>)}</ul>
            {q > 0 && <button className="primary small" onClick={() => act.swap(x.S, x)}>⇄ {tx('Trocar {n}×', { n: x.q })}</button>}
          </li>))}</ul>}
      <div className="row-btns"><button onClick={askIA} disabled={busy}>{busy ? tx('A pensar…') : `✦ ${tx('Perguntar à IA')}`}</button>{err && <span className="small bad-t">{err}</span>}</div>
      {ia && <div className="subs-ia">
        {ia.resumo && <p className="small">{ia.resumo}</p>}
        {iaSubs.length > 0 && <ul className="subs-list">{iaSubs.map(x => (
          <li key={x.b.n}><button className="link plain" onClick={() => act.open(x.b)}><b>{x.b.n}</b></button> <Mana cost={x.b.mc} /> <small className="muted">{x.porque}</small>
            {q > 0 && !deck.main[x.b.n] && <button className="small" onClick={() => { const k = Math.min(q, +x.qtd || q); act.add(c, 'main', -k); act.add(x.b, 'main', k) }}>⇄ {tx('Trocar')}</button>}</li>))}</ul>}
      </div>}
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
      <label className="fmt"><span>{tx('Fornecedor')}</span>
        <select value={prov} onChange={e => { setProv(e.target.value); setModel('') }}>
          {cfg.providers.map(x => <option key={x.id} value={x.id}>{tx(x.label)}</option>)}
        </select>
      </label>
      <label className="fmt"><span>{tx('Modelo')}</span><input value={model} onChange={e => setModel(e.target.value)} placeholder={p?.model} /></label>
      {!p?.nokey && (
        <label className="fmt"><span>{tx('Chave')} {cfg.hasKey && cfg.provider === prov ? tx('(guardada; deixa em branco para manter)') : ''}</span>
          <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={tx('cola aqui a chave da API')} />
        </label>
      )}
      {p?.keyUrl && <p className="small muted">{tx('Chave em')} <a href={p.keyUrl} target="_blank" rel="noreferrer">{new URL(p.keyUrl).host}</a>. {tx('Fica só no servidor do Grimório, nunca no browser.')}</p>}
      {err && <p className="small bad-t">{err}</p>}
      <div className="row-btns"><button className="primary" onClick={() => save(false)}>{tx('Guardar')}</button>{cfg.provider !== 'off' && <button onClick={() => save(true)}>{tx('Desligar a IA')}</button>}</div>
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
  useEffect(() => { fetch('/api/ia/config').then(r => r.json()).then(c => { setCfg(c); if (c.provider === 'off') setShowSet(true) }).catch(() => setErr(tx('Sem ligação ao servidor.'))) }, [])
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const card = n => n && (data.byName.get(n) || data.byLower.get(String(n).toLowerCase()) || data.byLower.get(String(n).split(' // ')[0].toLowerCase()))
  const inDeckN = n => deck.main[n] || 0
  const mainN = Object.values(deck.main).reduce((a, q) => a + q, 0) + (deck.commanders?.length || 0)
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
      contagem: `main: ${mainN} de ${fmt.size[0]}${fmt.size[1] && fmt.size[1] !== fmt.size[0] ? `–${fmt.size[1]}` : ''} cartas; ${need.lands} terrenos (alvo ~${need.target})`,
      sugestoes: recs.slice(0, 30).map(r => `${r.c.n} — ${r.why.slice(0, 2).map(w => w.txt).join('; ')}`).join('\n'),
      lista: exportList(deck),
    }
    try { setRes({ ...(await postJSON('/api/ia/ask', { mode, question: q, context })), snap: { ...deck.main } }) } catch (e) { setErr(e.message) }  // snap: as cópias no momento da resposta
    setBusy(false)
  }
  const mark = k => setDone(s => new Set(s).add(k))
  const vAdd = (res?.adicionar || []).map(x => ({ ...x, c: card(x.carta) })).map(x => ({ ...x, ok: x.c && passes(x.c, null, ctx) && !inDeckN(x.c.n), why2: !x.c ? tx('não existe') : !passes(x.c, null, ctx) ? tx('ilegal ou fora das cores') : inDeckN(x.c.n) ? tx('já está no deck') : '' }))
  const vCut = (res?.tirar || []).map(x => ({ ...x, c: card(x.carta) })).map(x => ({ ...x, ok: x.c && inDeckN(x.c.n), why2: x.c && !inDeckN(x.c.n) ? tx('não está no deck') : !x.c ? tx('não existe') : '' }))
  const vSwap = (res?.trocas || []).map(x => ({ ...x, a: card(x.sai), b: card(x.entra) })).map(x => ({ ...x, q: Math.max(1, Math.min(+x.qtd || 0, inDeckN(x.a?.n)) || inDeckN(x.a?.n)), ok: x.a && x.b && inDeckN(x.a.n) && passes(x.b, null, ctx) && !inDeckN(x.b.n) }))
  // ajustes de cópias (de → para): corrigir o tamanho do deck, os terrenos e os básicos por cor
  const vAdj = (res?.ajustes || []).map(x => ({ ...x, c: card(x.carta) })).map(x => {
    // se a IA contou mal as cópias atuais, vale a diferença que ela quis (de 0 → 3 = +3), não o número final
    const now = x.c ? res.snap?.[x.c.n] || 0 : 0, de = Math.round(+x.de || 0), para = Math.max(0, Math.round(+x.para || 0))
    const to = Math.max(0, de === now ? para : now + para - de), lim = x.c ? maxCopies(x.c, fmt, ctx.bit) : 0, off = de !== now
    const why2 = !x.c ? tx('não existe') : to > lim ? tx('passa o limite de {n} cópias', { n: lim }) : to > now && !now && !passes(x.c, null, ctx) ? tx('ilegal ou fora das cores') : to === now ? tx('já tem {n}', { n: now }) : ''
    return { ...x, now, to, off, ok: !why2, why2 }
  })
  const applyAll = () => {
    vAdd.forEach((x, k) => { if (x.ok && !done.has(`a${k}`)) { act.add(x.c); mark(`a${k}`) } })
    vCut.forEach((x, k) => { if (x.ok && !done.has(`c${k}`)) { act.add(x.c, 'main', -inDeckN(x.c.n)); mark(`c${k}`) } })
    vSwap.forEach((x, k) => { if (x.ok && !done.has(`s${k}`)) { act.add(x.a, 'main', -x.q); act.add(x.b, 'main', x.q); mark(`s${k}`) } })
    vAdj.forEach((x, k) => { if (x.ok && !done.has(`j${k}`)) { act.add(x.c, 'main', x.to - x.now); mark(`j${k}`) } })
  }
  const saveGroups = () => {
    const groups = res.grupos.map(g => ({ nome: g.nome, cartas: g.cartas.map(card).filter(Boolean).map(c => c.n) })).filter(g => g.cartas.length)
    setDeck(d => ({ ...d, groups }))
    act.say(tx('Secções guardadas. No painel do deck, escolhe «Ver por: secções».'))
  }
  const Name = ({ c, raw }) => (c ? <button className="link plain" onClick={() => act.open(c)}><b>{c.n}</b></button> : <s>{raw}</s>)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal auto ia" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>✦ {tx('Assistente IA')} <span className="muted small">{tx('extra opcional')}{cfg && cfg.provider !== 'off' ? ` · ${tx(cfg.providers.find(p => p.id === cfg.provider)?.label || '')}` : ''}</span> {cfg && <button className="link small" onClick={() => setShowSet(!showSet)}>{tx('definições')}</button>}</h3>
        {cfg && showSet && <IASettings cfg={cfg} setCfg={setCfg} onDone={() => setShowSet(false)} />}
        {cfg && !showSet && cfg.provider !== 'off' && (
          <>
            <div className="seg">{[['sugerir', tx('Sugerir melhorias'), '✦'], ['reorganizar', tx('Reorganizar o deck'), '▦'], ['livre', tx('Pergunta livre'), '?']].map(([k, l, ic]) => (
              <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}><i>{ic}</i><span>{l}</span></button>
            ))}</div>
            <textarea className="ia-q" value={q} onChange={e => setQ(e.target.value)} placeholder={mode === 'livre' ? tx('Ex.: como torno isto mais rápido sem gastar mais de 50 €?') : tx('Opcional: orientação extra (ex.: «menos combos, mais interação», «orçamento baixo»)')} />
            <div className="row-btns"><button className="primary" onClick={ask} disabled={busy || (mode === 'livre' && !q.trim())}>{busy ? tx('A pensar…') : tx('Pedir à IA')}</button>
              <span className="muted small">{tx('A IA recebe o deck e o que o Grimório já sabe (plano, faltas, mana, combos, meta). Cartas propostas são verificadas antes de aparecerem.')}</span></div>
          </>
        )}
        {busy && <div className="auto-wait"><div className="spinner" /></div>}
        {err && <p className="bad-t">{err}</p>}
        {res && (
          <div className="auto-list ia-res">
            {res.resumo && <p className="ia-sum">{res.resumo}</p>}
            {vSwap.length > 0 && <section><h4>{tx('Trocas')}</h4><ul>{vSwap.map((x, k) => (
              <li key={k} className={`ia-row ${x.ok ? '' : 'off'}`}><div>{x.q > 1 ? `${x.q}× ` : ''}<Name c={x.a} raw={x.sai} /> → {x.q > 1 ? `${x.q}× ` : ''}<Name c={x.b} raw={x.entra} /><small className="muted">{x.porque}</small></div>
                {x.ok && <button disabled={done.has(`s${k}`)} onClick={() => { act.add(x.a, 'main', -x.q); act.add(x.b, 'main', x.q); mark(`s${k}`) }}>{done.has(`s${k}`) ? '✓' : tx('Trocar')}</button>}</li>
            ))}</ul></section>}
            {vAdj.length > 0 && <section><h4>{tx('Ajustar cópias')} <span className="muted small">{tx('deck com {n} de {t}', { n: mainN, t: fmt.size[0] })}</span></h4><ul>{vAdj.map((x, k) => (
              <li key={k} className={`ia-row ${x.ok ? '' : 'off'}`}><div><Name c={x.c} raw={x.carta} /> <b className={x.to > x.now ? 'pos' : 'neg'}>{x.now} → {x.to}</b><small className="muted">{x.porque}{x.off ? ` · ${tx('a IA julgava ter {n}', { n: x.de })}` : ''}{x.why2 ? ` · ${tx('ignorado: {r}', { r: x.why2 })}` : ''}</small></div>
                {x.ok && <button disabled={done.has(`j${k}`)} onClick={() => { act.add(x.c, 'main', x.to - x.now); mark(`j${k}`) }}>{done.has(`j${k}`) ? '✓' : x.to > x.now ? `+${x.to - x.now}` : `−${x.now - x.to}`}</button>}</li>
            ))}</ul></section>}
            {vAdd.length > 0 && <section><h4>{tx('Adicionar')}</h4><ul>{vAdd.map((x, k) => (
              <li key={k} className={`ia-row ${x.ok ? '' : 'off'}`}><div><Name c={x.c} raw={x.carta} /> {x.c && <Mana cost={x.c.mc} />}<small className="muted">{x.porque}{x.why2 ? ` · ${tx('ignorada: {r}', { r: x.why2 })}` : ''}</small></div>
                {x.ok && <button disabled={done.has(`a${k}`)} onClick={() => { act.add(x.c); mark(`a${k}`) }}>{done.has(`a${k}`) ? '✓' : '+ Deck'}</button>}</li>
            ))}</ul></section>}
            {vCut.length > 0 && <section><h4>{tx('Tirar')}</h4><ul>{vCut.map((x, k) => (
              <li key={k} className={`ia-row ${x.ok ? '' : 'off'}`}><div><Name c={x.c} raw={x.carta} /><small className="muted">{x.porque}{x.why2 ? ` · ${tx('ignorada: {r}', { r: x.why2 })}` : ''}</small></div>
                {x.ok && <button disabled={done.has(`c${k}`)} onClick={() => { act.add(x.c, 'main', -inDeckN(x.c.n)); mark(`c${k}`) }}>{done.has(`c${k}`) ? '✓' : tx('Tirar')}</button>}</li>
            ))}</ul></section>}
            {res.grupos.length > 0 && <section><h4>{tx('Secções propostas')}</h4>{res.grupos.map(g => <p key={g.nome} className="small"><b>{g.nome}</b> <span className="muted">({g.cartas.length})</span> {g.cartas.join(', ')}</p>)}<button onClick={saveGroups}>{tx('Guardar secções no deck')}</button></section>}
            <div className="row-btns">{(vAdd.some(x => x.ok) || vCut.some(x => x.ok) || vSwap.some(x => x.ok) || vAdj.some(x => x.ok)) && <button className="primary" onClick={applyAll}>{tx('Aplicar tudo o que é válido')}</button>}<span className="muted small">{res.modelo}</span></div>
          </div>
        )}
      </div>
    </div>
  )
}

// Diagnóstico: as melhorias mais importantes primeiro (aparece no topo da Análise e depois de importar).
// texto com nomes de cartas: cada nome mostra a carta com o rato por cima e abre-a com um toque/clique (tablet)
function Linked({ txt, names, data, deck, act }) {
  const ns = (names || []).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!ns.length) return txt
  const re = new RegExp(`(${ns.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
  return txt.split(re).map((part, k) => { const c = ns.includes(part) && data.byName.get(part); return c
    ? <button key={k} className="link plain cardref" {...hoverPeek(c, pidOf(deck, c.n))} onClick={() => { hideCardPeek(); act.open(c) }}>{part}</button> : part })
}

export function PriorityCard({ data, deck, fmt, ctx, act, issues, cuts, needs }) {
  const need = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const have = useMemo(() => deckIndices(deck, data), [deck, data])
  const near = useMemo(() => deckCombos(data, have, ctx).near.filter(x => x.cb[1].length - x.missing.length >= 2 && (x.cb[5] || 0) >= 100).slice(0, 2), [data, have, ctx]) // já com 2+ peças e populares
  const items = []
  for (const i of issues.filter(x => x.nivel === 'erro').slice(0, 3)) items.push({ k: 'erro', txt: i.msg })
  if (need.deficit > 2) items.push({ k: 'mana', txt: tx('Faltam ~{n} terrenos para esta fase do deck (alvo ~{a} em {b}).', { n: need.deficit, a: need.target, b: need.total }), go: () => act.suggestFor('') })
  if (need.deficit < -3) items.push({ k: 'mana', txt: tx('Terrenos a mais: {n} para um alvo de ~{a} nesta fase.', { n: need.lands, a: need.expectedNow }) })
  for (const [k, x] of Object.entries(need.cols)) if (x.have < x.need) items.push({ k: 'mana', txt: tx('Poucas fontes de {k}: {h} para ~{w} (o custo mais exigente tem {n} símbolo).|Poucas fontes de {k}: {h} para ~{w} (o custo mais exigente tem {n} símbolos).', { k, h: x.have, w: x.need, n: x.maxPips }) })
  for (const [t, [h, n]] of Object.entries(needs).filter(([, [h, n]]) => h < n).sort((a, b) => (b[1][1] - b[1][0]) - (a[1][1] - a[1][0])).slice(0, 3))
    items.push({ k: 'falta', txt: tx('{t}: {h} de {w} recomendadas.', { t: TAG_LABEL[t], h, w: n }), go: () => act.suggestFor(t), goL: tx('ver sugestões') })
  for (const x of cuts.slice(0, 3)) items.push({ k: 'corte', cards: [x.c.n, x.swap?.c.n], txt: `${x.c.n}: ${x.why[0] || tx('encaixa pouco')}${x.swap ? ` → ${tx('trocar por {c}', { c: x.swap.c.n })}` : ''}`, go: x.swap ? () => { act.add(x.c, 'main', -(deck.main[x.c.n] || 1)); act.add(x.swap.c) } : null, goL: tx('trocar') })
  if (fmt.side > 0) for (const [n, q] of Object.entries(deck.main)) {
    const c = data.byName.get(n)
    if (c?.tg.includes('hate')) items.push({ k: 'corte', cards: [n], txt: tx('{c} é sobretudo uma resposta de sideboard (contra estratégias específicas).', { c: n }), go: () => { act.add(c, 'main', -q); act.add(c, 'side', q) }, goL: tx('passar para o sideboard') })
  }
  for (const [t, [h, n]] of Object.entries(needs).filter(([t]) => t === 'wincon' || t === 'creature')) if (h < n && !items.some(x => x.txt.startsWith(TAG_LABEL[t]))) items.push({ k: 'falta', txt: tx('{t}: {h} de {w}.', { t: TAG_LABEL[t], h, w: n }), go: () => act.suggestFor(t), goL: tx('ver sugestões') })
  for (const x of near) items.push({ k: 'combo', cards: [data.cards[x.missing[0]].n], txt: tx('A uma carta de um combo: junta {c} ({r}).', { c: data.cards[x.missing[0]].n, r: x.cb[2][0] }), go: () => act.add(data.cards[x.missing[0]]), goL: `+ ${tx('deck')}` })
  if (!items.length) return null
  return (
    <section className="card prio">
      <h3>{tx('Melhorias prioritárias')} <Hint t={tx('O que mais vale a pena mudar primeiro: legalidade, terrenos e cores, funções em falta e trocas por cartas melhores.')} /></h3>
      <ol>{items.slice(0, 10).map((x, k) => <li key={k} className={x.k}><span><Linked txt={x.txt} names={x.cards} {...{ data, deck, act }} /></span>{x.go && <button className="link small" onClick={x.go}>{x.goL || tx('resolver')}</button>}</li>)}</ol>
    </section>
  )
}

const ZONE_T = { main: tx('Mover para o deck'), side: tx('Mover para o sideboard'), maybe: tx('Mover para o maybeboard') }, ZONE_S = { main: 'D', side: 'SB', maybe: 'MB' }
// Deck em grelha: imagens com quantidade, + / − / × (retirar tudo), por tipo ou pelas secções da IA.
export function DeckGrid({ data, deck, fmt, act, ctx }) {
  const [bySec, setBySec] = useState(false)
  const secOf = new Map()
  if (bySec) for (const g of deck.groups || []) for (const n of g.cartas) if (!secOf.has(n)) secOf.set(n, g.nome)
  const zones = [['main', deck.main], ['side', deck.side]]
  const groups = {}
  for (const [n, q] of Object.entries(deck.main)) {
    const c = data.byName.get(n)
    if (!c) continue
    const g = bySec ? secOf.get(n) || tx('Outras') : TYPE_LABEL[c.mt] || c.mt
    ;(groups[g] ||= []).push([c, q])
  }
  const order = bySec ? [...(deck.groups || []).map(g => g.nome), tx('Outras')] : [...TYPES.map(t => TYPE_LABEL[t])]
  // cópias divididas por várias artes (terrenos básicos): um cartão por arte, com as suas cópias; as que sobram, com a principal
  const tile = ({ c, q, zone }) => {
    const sp = zone === 'main' && deck.split?.[c.n]
    if (!sp) return tile1({ c, q, zone })
    let left = q
    const parts = sp.map(x => { const n = Math.min(x.q, left); left -= n; return { pid: x.id, n } }).filter(x => x.n > 0)
    if (left > 0) parts.push({ pid: pidOf(deck, c.n), n: left })
    return parts.map((x, k) => tile1({ c, q, zone, pid: x.pid, part: x.n, k }))
  }
  const tile1 = ({ c, q, zone, pid, part, k = 0 }) => (  // função e não componente (ver o row do DeckPanel em App.jsx)
    <div key={`${zone}:${c.i}:${k}`} className={`dg-tile ${part != null ? 'split' : ''}`} data-card={c.n}>
      <button className="dg-img" onClick={() => act.open(c)} title={c.n}><img src={img(c, 'normal', false, pid ?? pidOf(deck, c.n))} alt={c.n} loading="lazy" /></button>
      {(part != null || q > 1) && <span className="dg-q" title={part != null ? tx('{a} de {n} cópias com esta arte', { a: part, n: q }) : undefined}>×{part ?? q}</span>}
      <div className="dg-bar">
        <button onClick={() => act.remove(c, zone, 1)} aria-label={tx('Menos uma')}>−</button>
        <b title={part != null ? tx('{a} de {n} cópias com esta arte', { a: part, n: q }) : undefined}>{part ?? q}</b>
        <button onClick={() => act.add(c, zone, 1)} aria-label={tx('Mais uma')}>+</button>
        <button className="act art" onClick={() => act.pickArt(c)} title={tx('Escolher arte')}>🎨</button>
        {['main', ...(fmt.side ? ['side'] : []), 'maybe'].filter(z => z !== zone).map(z => <button key={z} className="dg-mv" onClick={() => act.move(c, zone, z)} title={ZONE_T[z]}>{ZONE_S[z]}</button>)}
        <button className="dg-x" onClick={() => act.remove(c, zone, q)} aria-label={tx('Retirar do deck')} title={tx('Retirar do deck')}>×</button>
      </div>
    </div>
  )
  const cmd = deck.commanders.map(n => data.byName.get(n)).filter(Boolean)
  const sum = z => Object.values(z).reduce((s, q) => s + q, 0)
  if (!sum(deck.main) && !cmd.length && !sum(deck.maybe || {})) return <Empty>{tx('O deck está vazio. Procura cartas, usa as sugestões ou o «Completar deck».')}</Empty>
  return (
    <div className="dgrid">
      {deck.groups?.length > 0 && (
        <div className="seg viewby"><button className={!bySec ? 'on' : ''} onClick={() => setBySec(false)}><span>{tx('Por tipo')}</span></button><button className={bySec ? 'on' : ''} onClick={() => setBySec(true)}><span>{tx('Por secções (IA)')}</span></button></div>
      )}
      {cmd.length > 0 && (
        <section><h4>{fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : tx('Comandante')}</h4><div className="dg-row">{cmd.map(c => (
          <div key={c.i} className="dg-tile"><button className="dg-img" onClick={() => act.open(c)}><img src={img(c, 'normal', false, pidOf(deck, c.n))} alt={c.n} /></button>
            <div className="dg-bar"><button className="dg-x" onClick={() => act.setCommander(c)} title={tx('Retirar comandante')}>×</button></div></div>
        ))}</div></section>
      )}
      {order.filter(g => groups[g]).map(g => (
        <section key={g}>
          <h4>{g} <span className="muted">{groups[g].reduce((s, [, q]) => s + q, 0)}</span></h4>
          <div className="dg-row">{groups[g].sort((a, b) => a[0].cmc - b[0].cmc || a[0].n.localeCompare(b[0].n)).map(([c, q]) => tile({ c, q, zone: 'main' }))}</div>
        </section>
      ))}
      <section className="dg-basics"><h4>{tx('Terrenos básicos')}</h4><BasicBar {...{ data, deck, ctx, act }} /></section>
      {sum(zones[1][1]) > 0 && (
        <section><h4>Sideboard <span className="muted">{sum(deck.side)}</span></h4><div className="dg-row">
          {Object.keys(deck.side).map(n => data.byName.get(n)).filter(Boolean).map(c => tile({ c, q: deck.side[c.n], zone: 'side' }))}
        </div></section>
      )}
      {sum(deck.maybe || {}) > 0 && (
        <section className="maybe"><h4>Maybeboard <span className="muted">{sum(deck.maybe)} · {tx('fora do deck, das estatísticas e dos testes')}</span></h4><div className="dg-row">
          {Object.keys(deck.maybe).map(n => data.byName.get(n)).filter(Boolean).map(c => tile({ c, q: deck.maybe[c.n], zone: 'maybe' }))}
        </div></section>
      )}
    </div>
  )
}

// Escolher a arte (edição/estilo) de uma carta: pré-visualização grande + todas as impressões.
// Imagem própria: link (https) ou ficheiro carregado (POST /api/arts); «vários links» liga cada link à carta do deck
// cujo nome aparece no endereço (como nos links do TappedOut: …/bloodthrone-vampire/…), ou a linhas «Nome | link».
const slugOf = n => n.split(' // ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’,]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
// Imagens próprias de uma pasta (link na net ou pasta do computador): cada imagem vai para a carta com quem partilha
// mais palavras do nome; revês a lista, e as escolhidas são comprimidas e guardadas aqui (arts/, também offline).
function ArtFolder({ deck, act }) {
  const [link, setLink] = useState(''), [list, setList] = useState(null), [busy, setBusy] = useState(''), [err, setErr] = useState('')
  const names = [...new Set([...(deck.commanders || []), ...Object.keys(deck.main || {}), ...Object.keys(deck.side || {})])]
  const found = files => { const m = matchArts(names, files); setList(m.map(x => ({ ...x, on: true }))); if (!m.length) setErr(tx('Nenhuma imagem tem palavras em comum com as cartas do deck.')) }
  const fromLink = async () => {
    setErr(''); setList(null); setBusy(tx('A ler a pasta…'))
    try {
      const r = await fetch('/api/arts/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link.trim() }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.erro)
      found(j.map(x => ({ name: x.name, url: x.url, thumb: `/api/arts/proxy?url=${encodeURIComponent(x.url)}` })))
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const fromDir = fs => { setErr(''); found([...fs].filter(f => /^image\/(jpeg|png|webp|gif)$/.test(f.type)).map(f => ({ name: f.name, file: f, thumb: URL.createObjectURL(f) }))) }
  const apply = async () => {
    const todo = list.filter(x => x.on); let n = 0
    setErr('')
    for (const x of todo) {
      setBusy(tx('A guardar {i} de {n}…', { i: n + 1, n: todo.length }))
      try {
        const blob = x.file.file || await (await fetch(x.file.thumb)).blob()
        const small = await shrink(blob)
        const r = await fetch('/api/arts', { method: 'POST', headers: { 'Content-Type': small.type }, body: small })
        const j = await r.json(); if (!r.ok) throw new Error(j.erro)
        act.setArt(x.card, j.url); n++
      } catch (e) { setErr(`${x.card}: ${e.message}`) }
    }
    setBusy(''); setList(null); act.say(tx('{n} imagem própria ligada às cartas|{n} imagens próprias ligadas às cartas', { n }))
  }
  return (
    <div className="artdir">
      <p className="muted small">{tx('Uma pasta de imagens: cada uma vai para a carta com quem partilha mais palavras do nome (pelo menos uma). Revês antes de aplicar; ficam comprimidas e guardadas aqui, também para jogar offline.')}</p>
      <form className="row-btns" onSubmit={e => { e.preventDefault(); if (link.trim()) fromLink() }}>
        <input value={link} onChange={e => setLink(e.target.value)} placeholder={tx('Link da pasta (Google Drive público, GitHub ou página com as imagens)')} />
        <button type="submit" disabled={!link.trim() || !!busy}>{tx('Ler a pasta')}</button>
        <label className="dbox-up">📁 {tx('Pasta do computador')}<input type="file" webkitdirectory="" directory="" multiple onChange={e => fromDir(e.target.files || [])} /></label>
      </form>
      {busy && <p className="small"><span className="spin-dot" /> {busy}</p>}
      {err && <p className="small bad-t">{err}</p>}
      {list?.length > 0 && <>
        <ul className="artdir-list">{list.map((x, k) => (
          <li key={x.card} className={x.on ? '' : 'off'}>
            <label><input type="checkbox" checked={x.on} onChange={e => setList(l => l.map((y, j) => (j === k ? { ...y, on: e.target.checked } : y)))} />
              <img src={x.file.thumb} alt="" loading="lazy" /><span><b>{x.card}</b><small className="muted">{x.file.name}{x.exact ? '' : ` · ${tx('{n} palavra em comum|{n} palavras em comum', { n: x.shared })}`}</small></span></label>
          </li>
        ))}</ul>
        <div className="row-btns"><button className="primary" disabled={!!busy || !list.some(x => x.on)} onClick={apply}>{tx('Aplicar {n}', { n: list.filter(x => x.on).length })}</button><button className="link" onClick={() => setList(null)}>{tx('cancelar')}</button></div>
      </>}
    </div>
  )
}

function OwnArt({ c, deck, act }) {
  const [link, setLink] = useState(''), [many, setMany] = useState(''), [err, setErr] = useState('')
  const own = deck.art?.[c.n]
  const up = async f => {
    setErr('')
    try { const r = await fetch('/api/arts', { method: 'POST', headers: { 'Content-Type': f.type }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.erro); act.setArt(c.n, j.url) } catch (e) { setErr(e.message) }
  }
  const bulk = () => {
    const names = [...(deck.commanders || []), ...Object.keys(deck.main || {}), ...Object.keys(deck.side || {})]
    let n = 0
    for (const line of many.split(/\n+/).map(x => x.trim()).filter(Boolean)) {
      const [a, b] = line.includes('|') ? line.split('|').map(x => x.trim()) : [null, line]
      if (!/^https:\/\//.test(b)) continue
      const hit = a ? names.find(x => x.toLowerCase() === a.toLowerCase()) : names.filter(x => b.toLowerCase().includes(slugOf(x))).sort((p, q) => slugOf(q).length - slugOf(p).length)[0]
      if (hit) { act.setArt(hit, b); n++ }
    }
    act.say(tx('{n} imagem própria ligada às cartas|{n} imagens próprias ligadas às cartas', { n })); if (n) setMany('')
  }
  return (
    <details className="ownart" open={!!own}>
      <summary><b>{tx('Imagem própria')}</b> {own && <span className="muted small">{tx('(em uso)')}</span>}</summary>
      <form className="row-btns" onSubmit={e => { e.preventDefault(); if (/^https:\/\//.test(link.trim())) { act.setArt(c.n, link.trim()); setLink('') } else setErr(tx('O link da imagem tem de começar por https://')) }}>
        <input value={link} onChange={e => setLink(e.target.value)} placeholder={tx('Cola o link da imagem (https://…)')} />
        <button type="submit">{tx('Usar')}</button>
        <label className="dbox-up">⬆ {tx('Carregar imagem')}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { const f = e.target.files?.[0]; if (f) up(f) }} /></label>
      </form>
      {own && <button className="link small" onClick={() => act.setArt(c.n, null)}>{tx('tirar a imagem própria')}</button>}
      {err && <p className="small bad-t">{err}</p>}
      <details className="ownart-many"><summary className="small">{tx('Uma pasta de imagens (para o deck todo)')}</summary><ArtFolder deck={deck} act={act} /></details>
      <details className="ownart-many"><summary className="small">{tx('Vários links de uma vez (para o deck todo)')}</summary>
        <p className="muted small">{tx('Um link por linha. Cada um vai para a carta cujo nome aparece no endereço (como nos links do TappedOut); ou escreve «Nome da carta | link».')}</p>
        <textarea value={many} onChange={e => setMany(e.target.value)} rows={4} placeholder={'https://static.tappedout.net/…/carrion-feeder/…png\nBone Picker | https://…'} />
        <button onClick={bulk} disabled={!many.trim()}>{tx('Ligar às cartas')}</button>
      </details>
    </details>
  )
}

export function ArtPicker({ c, deck, act, onClose }) {
  const [preview, setPreview] = useState(null)
  const [hoverPid, setHoverPid] = useState(null)
  const pid = hoverPid || preview || pidOf(deck, c.n)
  const onPreview = (id, hover) => (hover ? setHoverPid(id) : (setPreview(id), setHoverPid(null)))
  // terrenos básicos: as cópias podem ser divididas por várias artes (deck.split); clicar numa edição junta-a à divisão
  const total = (deck.main[c.n] || 0) + (deck.side[c.n] || 0), slots = deck.split?.[c.n] || []
  const canSplit = /\bBasic\b/.test(c.t) && total >= 2
  const [splitOn, setSplitOn] = useState(slots.length > 0)
  const sum = slots.reduce((a, x) => a + x.q, 0)
  const putSlots = l => act.setSplit(c.n, l.filter(x => x.q > 0))
  const addSlot = (id, pr) => {  // pr: a edição (set e número vão para a exportação); sem ela é uma imagem própria
    if (sum >= total) return act.say(tx('Já estão as {n} cópias atribuídas: tira uma a outra arte primeiro.', { n: total }))
    const k = slots.findIndex(x => x.id === id)
    putSlots(k >= 0 ? slots.map((x, j) => (j === k ? { ...x, q: x.q + 1 } : x)) : [...slots, { id, q: 1, ...(pr && { set: pr.set, cn: pr.cn }) }])
  }
  // as favoritas das Definições: com várias, as cópias repartem-se por elas (a começar numa ao acaso); com uma, fica essa
  const favs = /\bBasic\b/.test(c.t) ? basicList(c.n) : []
  const useFavs = () => {
    act.setPrint(c, null)
    if (favs.length < 2 || total < 2) { act.setSplit(c.n, null); setSplitOn(false); return }
    const k0 = Math.floor(Math.random() * favs.length), l = []
    for (let j = 0; j < total; j++) { const id = favs[(k0 + j) % favs.length].id, e = l.find(x => x.id === id); if (e) e.q++; else l.push({ id, q: 1 }) }
    setSplitOn(true); act.setSplit(c.n, l)
  }
  const act2 = canSplit && splitOn ? { ...act, setPrint: (cc, p) => p && addSlot(p.id, p), setArt: (n, url) => url && addSlot(url) } : act
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal artpick" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <div className="ap-img"><img src={img(c, 'large', false, pid)} alt={c.n} /></div>
        <div className="ap-list">
          <h3>{tx('Arte de {c}', { c: c.n })}</h3>
          <p className="muted small">{tx('Passa o rato para ver; clica para escolher. A arte escolhida aparece no deck e na exportação («(SET) nº *F*»).')}</p>
          {favs.length > 0 && <div className="row-btns"><button onClick={useFavs} title={tx('Divide as cópias pelas artes favoritas de {c} (Definições › Terrenos básicos)', { c: c.n })}>★ {tx('Assumir as preferidas das definições')}</button></div>}
          {canSplit && <div className="split-box">
            <label className="chk"><input type="checkbox" checked={splitOn} onChange={e => { setSplitOn(e.target.checked); if (!e.target.checked) act.setSplit(c.n, null) }} /> {tx('Dividir as {n} cópias por várias artes', { n: total })}</label>
            {splitOn && <>
              <p className="muted small">{tx('Clica nas edições abaixo (ou carrega uma imagem tua) para juntar artes e acerta quantas cópias tem cada uma. As que sobram ficam com a arte principal.')}</p>
              <div className="split-slots">{slots.map((x, k) => (
                <div key={x.id} className="split-slot" onMouseEnter={() => onPreview(x.id, true)} onMouseLeave={() => onPreview(null, true)}>
                  <img src={img(c, 'small', false, x.id)} alt="" />
                  <span className="qty"><button onClick={() => putSlots(slots.map((y, j) => (j === k ? { ...y, q: y.q - 1 } : y)))} aria-label={tx('Menos uma')}>−</button><b>{x.q}</b>
                    <button disabled={sum >= total} onClick={() => putSlots(slots.map((y, j) => (j === k ? { ...y, q: y.q + 1 } : y)))} aria-label={tx('Mais uma')}>+</button></span>
                </div>
              ))}</div>
              <small className="muted">{tx('{a} de {n} cópias com arte escolhida', { a: sum, n: total })}{sum < total ? ` · ${tx('{n} com a arte principal', { n: total - sum })}` : ''}</small>
            </>}
          </div>}
          <Prints c={c} deck={deck} act={act2} onPreview={onPreview} />
          <OwnArt c={c} deck={deck} act={act2} />
        </div>
      </div>
    </div>
  )
}
