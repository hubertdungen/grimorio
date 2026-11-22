// Assistente de deck novo: formato → comandante (Commander e afins: pode ser só ele) e/ou 3 a 10 cartas → personalização → completar.
// As escolhas ficam guardadas neste browser até o deck ser criado (fechar sem querer não as perde); «Limpar» recomeça.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { search, recommend, img, fmtBit, passes, STYLES, LEVELS, CREATURE_TYPES, COLORS, TAG_LABEL, TYPE_LABEL, termMatch } from './data.js'
import { likeTheme, likeCards, likeCommanders, chipUniverse, parseQuery, subOf } from './nlsearch.js'
import { ARCH, ARCH_OF_TAG } from './archetypes.js'
import { FORMATS, FORMAT, canBeCommander, pairOk } from './formats.js'
import { emptyDeck } from './deck.js'
import { PrefsPanel, IASettings } from './Views.jsx'
import { Mana } from './ui.jsx'
import { tx } from './i18n.js'
import { findSets, setLabel, flavorOf, norm } from './vocab.js'
import { useBackClose } from './backnav.js'
import { held } from './touch.js'
import { delayedPeek } from './deckview.js'
import { BigCard } from './ForgePlay.jsx'

const subset = (a, b) => [...a].every(k => b.includes(k))
const KEY = 'grimorio.wizard'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }
const save = v => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY) } catch { /* sem armazenamento */ } }
// dois comandantes: Partner, Partner with X, Friends forever, Choose a Background, Doctor's companion
const pairable = c => /\bPartner\b|Friends forever|Doctor's companion|Choose a Background/.test(c.o) || /Time Lord Doctor/.test(c.t)

const START = [['gosto', tx('Gosto de…'), '♥'], ['cartas', tx('Escolher 3–10 cartas'), '▦'], ['manual', tx('Construir à mão'), '✎'], ['importar', tx('Importar e melhorar'), '⇩'], ['ia', tx('Descrever a ideia (IA)'), '✦']]

// subtipos de uma carta (as duas faces)
const subsIn = c => (c.t || '').split(' // ').flatMap(f => (f.split(' — ')[1] || '').split(' ')).filter(Boolean)
// as palavras da pesquisa de comandantes que são tipos de criatura: o nome inteiro em qualquer língua/plural (subOf),
// ou o começo de um tipo enquanto se escreve («pirat» → Pirate); só tipos que existem em criaturas lendárias
let CT = null
const cmdTypes = (data, q) => {
  if (!CT || CT.d !== data) CT = { d: data, s: new Set(data.cards.filter(c => /Legendary/.test(c.t)).flatMap(subsIn)) }
  const out = new Set()
  for (const w of norm(q).split(/[\s,]+/).filter(x => x.length >= 3)) {
    const t = subOf(w, CT.s)
    if (t) { out.add(t); continue }
    if (w.length >= 4) for (const x of CT.s) if (x.toLowerCase().startsWith(w)) out.add(x)
  }
  return out
}

// carta para escolher (cartas do gosto, pesquisa): tocar junta/tira; 🔍, botão direito ou tocar e manter mostra-a em grande
function PickCard({ c, on, disabled, onPick, onBig, fl }) {  // fl: a impressão com outro nome («Megatron», SLD) que a trouxe
  const zoom = e => { e.preventDefault(); e.stopPropagation(); held(); onBig(c) }
  return (
    <div className="wz-pc">
      <button className={on ? 'on' : ''} onClick={onPick} onContextMenu={zoom} disabled={disabled} {...delayedPeek(c)}><img src={img(c, 'normal', false, fl?.id)} alt={fl ? `${fl.n} (${c.n})` : c.n} loading="lazy" draggable={false} />{on && <span>✓</span>}</button>
      {fl && <small className="wz-fl" title={tx('Também conhecida como {n}', { n: `${fl.n} (${fl.set.toUpperCase()})` })}>{fl.n}</small>}
      <button className="wz-zoom" onClick={zoom} aria-label={`${tx('Ver em grande')}: ${c.n}`} title={tx('Ver em grande')}>🔍</button>
    </div>
  )
}

// o que se pode fazer com um comandante possível: ser O comandante, entrar como carta de partida, como subcomandante (no
// deck, marcado ♛, para trocar depressa) ou ficar no maybeboard (não entra no deck, mas pesa um pouco nas sugestões)
const ROLE_L = { pick: tx('no deck'), sub: tx('subcomandante'), maybe: tx('talvez') }
function CmdActs({ c, role, onCmd, onRole, done }) {
  const go = f => e => { e.stopPropagation(); f(); done?.() }
  return <>
    <button className={`wz-ca cmd${role === 'cmd' ? ' on' : ''}`} onClick={go(onCmd)}>{role === 'cmd' ? '✓' : '♛'} {tx('Comandante')}</button>
    <button className={`wz-ca${role === 'pick' ? ' on' : ''}`} onClick={go(() => onRole(c, 'pick'))}>{role === 'pick' ? '✓' : '＋'} {tx('Juntar ao deck')}</button>
    <button className={`wz-ca${role === 'sub' ? ' on' : ''}`} onClick={go(() => onRole(c, 'sub'))}>♕ {tx('Subcomandante')}</button>
    <button className={`wz-ca${role === 'maybe' ? ' on' : ''}`} onClick={go(() => onRole(c, 'maybe'))}>{role === 'maybe' ? '✓' : '＋'} {tx('Talvez')}</button>
  </>
}
// o menu do ⋯: janela pequena por cima da página, presa ao botão (dentro do quadrado da carta não cabia e não fechava);
// fecha com ✕, um clique fora, Esc ou scroll
function ActMenu({ at, c, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const out = e => { if (!ref.current?.contains(e.target) && !at.contains(e.target)) onClose() }
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const t0 = Date.now(), scr = e => { if (Date.now() - t0 > 400 && !ref.current?.contains(e.target)) onClose() }  // o scroll que ainda está a acabar quando se toca não o fecha
    addEventListener('pointerdown', out, true); addEventListener('keydown', key, true); addEventListener('scroll', scr, true)
    return () => { removeEventListener('pointerdown', out, true); removeEventListener('keydown', key, true); removeEventListener('scroll', scr, true) }
  }, [at, onClose])
  const r = at.getBoundingClientRect(), W = 190, H = 190
  const left = Math.max(8, Math.min(r.left, innerWidth - W - 8)), top = r.bottom + 4 + H > innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4
  return createPortal(
    <div ref={ref} className="wz-actm" role="menu" aria-label={c.n} style={{ left, top, width: W }} onClick={e => e.stopPropagation()}>
      <div className="wz-actm-h"><b>{c.n.split(',')[0]}</b><button onClick={onClose} aria-label={tx('Fechar')}>✕</button></div>
      {children}
    </div>, document.body)
}

// ⋯ numa carta já escolhida (comandante ou carta de partida): mudar o papel — comandante, só no deck, subcomandante, talvez
function RoleMenu({ c, role, onCmd, onRole }) {
  const [at, setAt] = useState(null)
  return <>
    <button className={`wz-more1${at ? ' on' : ''}`} onClick={e => { e.stopPropagation(); const b = e.currentTarget; setAt(m => (m ? null : b)) }} aria-expanded={!!at} aria-label={`${tx('Mais ações')}: ${c.n}`} title={tx('Comandante, juntar ao deck, subcomandante ou talvez')}>⋯</button>
    {at && <ActMenu at={at} c={c} onClose={() => setAt(null)}><CmdActs c={c} role={role} onCmd={onCmd} onRole={onRole} done={() => setAt(null)} /></ActMenu>}
  </>
}

// carta de comandante: tocar escolhe; tocar e manter (ou botão direito, ou 🔍) mostra-a em grande; ⋯ abre as outras ações
function CmdCard({ c, onPick, onBig, role, onRole }) {
  const [menu, setMenu] = useState(null)  // o botão ⋯ (âncora do menu)
  const zoom = e => { e.preventDefault(); e.stopPropagation(); held(); onBig(c) }
  return (
    <div className={`wz-cc${role ? ` r-${role}` : ''}`}>
      <button onClick={onPick} onContextMenu={zoom} {...delayedPeek(c)}><img src={img(c, 'normal')} alt={c.n} loading="lazy" draggable={false} /></button>
      <span className="wz-ccn"><b>{c.n.split(',')[0]}</b><span className="wz-pips">{[...(c.ci || '')].map(k => <i key={k} className={`wz-dot d-${k}`} />)}{!c.ci && <i className="wz-dot d-C" />}</span></span>
      <button className="wz-zoom" onClick={zoom} aria-label={`${tx('Ver em grande')}: ${c.n}`} title={tx('Ver em grande')}>🔍</button>
      {onRole && <button className={`wz-more1${menu ? ' on' : ''}`} onClick={e => { e.stopPropagation(); const b = e.currentTarget; setMenu(m => (m ? null : b)) }} aria-expanded={!!menu} aria-label={`${tx('Mais ações')}: ${c.n}`} title={tx('Comandante, juntar ao deck, subcomandante ou talvez')}>⋯</button>}
      {role && !menu && <span className="wz-role">{role === 'sub' ? '♕ ' : ''}{ROLE_L[role]}</span>}
      {menu && <ActMenu at={menu} c={c} onClose={() => setMenu(null)}><CmdActs c={c} role={role} onCmd={onPick} onRole={onRole} done={() => setMenu(null)} /></ActMenu>}
    </div>
  )
}

const WUBRG = [['W', 'Branco'], ['U', 'Azul'], ['B', 'Preto'], ['R', 'Vermelho'], ['G', 'Verde'], ['C', 'Incolor']]
function CmdFilters({ cf, setCf, total, shown, on }) {
  const set = p => setCf(f => ({ ...f, ...p, n: 18 }))
  const tog = k => set({ col: cf.col.includes(k) ? cf.col.filter(x => x !== k) : [...cf.col, k] })
  return (
    <div className="wz-cf">
      <div className="wz-cfrow">
        {WUBRG.map(([k, l]) => <button key={k} type="button" className={`wz-cfc d-${k}${cf.col.includes(k) ? ' on' : ''}`} onClick={() => tog(k)} title={tx(l)} aria-pressed={cf.col.includes(k)}>{k}</button>)}
        <label className="wz-cfx"><input type="checkbox" checked={cf.exact} onChange={e => set({ exact: e.target.checked })} /> {tx('só estas cores')}</label>
      </div>
      <div className="wz-cfrow">
        <select value={cf.kind} onChange={e => set({ kind: e.target.value })} aria-label={tx('Tipo')}>
          <option value="">{tx('Todos os tipos')}</option><option value="cr">{tx('Criaturas')}</option><option value="pw">{tx('Planeswalkers')}</option><option value="bg">{tx('Backgrounds')}</option>
        </select>
        <select value={cf.sort} onChange={e => set({ sort: e.target.value })} aria-label={tx('Ordenar')}>
          <option value="rel">{tx('Mais relevantes')}</option><option value="pop">{tx('Mais populares')}</option><option value="mv">{tx('Custo (menor)')}</option><option value="nome">{tx('Nome (A–Z)')}</option>
        </select>
        <label className="wz-cfx"><input type="checkbox" checked={cf.partner} onChange={e => set({ partner: e.target.checked })} /> {tx('com par (Partner…)')}</label>
        <span className="muted small wz-cfn">{shown}{on ? ` / ${total}` : ''}</span>
        {on && <button type="button" className="wz-cfclr" onClick={() => set({ col: [], exact: false, sort: 'rel', kind: '', partner: false })}>{tx('Limpar filtros')}</button>}
      </div>
    </div>
  )
}

export default function NewDeckWizard({ data, fmtInit, onCancel, onCreate, onImport }) {
  useBackClose(true, onCancel)  // «voltar» do telemóvel fecha esta janela
  const [S0] = useState(load), cards = ns => (ns || []).map(n => data.byName.get(n)).filter(Boolean)
  const [start, setStart] = useState(S0.start || 'cartas')
  const [idea, setIdea] = useState(S0.idea || '')
  const [like, setLike] = useState(S0.like || '')
  const [likeOff, setLikeOff] = useState(S0.likeOff || [])  // chips desligados («k:v», «c:U», «g:tag»)
  const [likeStar, setLikeStar] = useState(S0.likeStar || [])  // temas essenciais ★
  const [likePick, setLikePick] = useState(S0.likePick || [])  // chips escolhidos na paleta completa (t:…, c:…, g:…)
  const [chipsOpen, setChipsOpen] = useState(false)
  const [chipQ, setChipQ] = useState('')
  const [chipTab, setChipTab] = useState('themes')
  const [busy, setBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const [aiSum, setAiSum] = useState(null)
  const [cfg, setCfg] = useState(null)
  useEffect(() => { if (start === 'ia' && !cfg) fetch('/api/ia/config').then(r => r.json()).then(setCfg).catch(() => setAiErr(tx('Sem ligação ao servidor.'))) }, [start, cfg])
  const [format, setFormat] = useState(FORMAT[S0.format] ? S0.format : fmtInit || 'commander')
  const [name, setName] = useState(S0.name || '')
  const [picks, setPicks] = useState(() => cards(S0.picks))
  const [cmds, setCmds] = useState(() => cards(S0.cmds))
  const [subsW, setSubsW] = useState(() => cards(S0.subs))  // subcomandantes: entram no deck marcados ♛
  const [maybes, setMaybes] = useState(() => cards(S0.maybes))  // maybeboard: fora do deck, pesam pouco nas sugestões
  const [prefs, setPrefs] = useState(S0.prefs || {})
  const [q, setQ] = useState(S0.q || '')
  const [cq, setCq] = useState('')
  const [big, setBig] = useState(null)  // carta em grande (tocar e manter / 🔍)
  const [cf, setCf] = useState({ col: [], exact: false, sort: 'rel', kind: '', partner: false, n: 18 })  // filtros da lista de comandantes
  const dq = useDeferredValue(q), dcq = useDeferredValue(cq)
  const [restored, setRestored] = useState(() => !!(S0.like || S0.likePick?.length || S0.picks?.length || S0.cmds?.length || S0.idea || S0.name))
  useEffect(() => { save({ start, idea, like, likeOff, likeStar, likePick, format, name, picks: picks.map(c => c.n), cmds: cmds.map(c => c.n), subs: subsW.map(c => c.n), maybes: maybes.map(c => c.n), prefs, q }) }, [start, idea, like, likeOff, likeStar, likePick, format, name, picks, cmds, subsW, maybes, prefs, q])
  const clear = () => { save(null); setStart('cartas'); setIdea(''); setLike(''); setLikeOff([]); setLikeStar([]); setLikePick([]); setName(''); setPicks([]); setCmds([]); setSubsW([]); setMaybes([]); setPrefs({}); setQ(''); setCq(''); setAiSum(null); setRestored(false) }
  const dirty = like || picks.length || cmds.length || subsW.length || maybes.length || idea || name || q
  const cmd = cmds[0] || null
  const setCmd = c => {
    setCmds(c ? [c] : [])
    if (c) setLikePick(x => x.filter(k => !k.startsWith('c:') || (k === 'c:C' ? !c.ci : c.ci.includes(k.slice(2)))))
  }
  const fmt = FORMAT[format]
  const ctx = useMemo(() => ({ bit: fmtBit(data, fmt), identity: fmt.cmd && cmds.length ? cmds.map(c => c.ci).join('') : null, allowUn: fmt.key === 'casual' }), [data, fmt, cmds])
  // Com comandante e sem pesquisa, as cartas sugeridas são as que sinergizam com ele (legais, na identidade dele), não só as populares.
  const res = useMemo(() => {
    if (!dq.trim() && fmt.cmd && cmds.length) {
      const cmdIdx = cmds.map(c => c.i), seeds = [...cmdIdx, ...picks.map(c => c.i)]
      const ideas = [...subsW.map(c => ({ i: c.i, w: 0.25 })), ...maybes.map(c => ({ i: c.i, w: 0.15 }))]  // como no editor (formats.js ideaSeeds)
      const recs = recommend(data, { seeds, have: [...seeds, ...subsW.map(c => c.i)], ctx, filters: { noLands: true }, limit: 48, commanders: cmdIdx, ideas })
      if (recs.length) return recs.map(r => r.c)
    }
    return search(data, dq, { sort: 'pop', inText: false }, ctx, 48).cards
  }, [data, dq, ctx, fmt, cmds, picks, subsW, maybes])
  // cores que o comandante tem de cobrir: as das cartas de partida (podem ter mais, nunca menos)
  const need = useMemo(() => [...new Set(picks.flatMap(c => [...c.ci]))].join(''), [picks])
  // comandantes legais no formato (pela popularidade); com um escolhido que aceite par, os parceiros possíveis
  const partnerOf = cmds.length === 1 && pairable(cmds[0]) ? cmds[0] : null
  const cmdRes = useMemo(() => {
    if (!fmt.cmd || cmds.length >= (partnerOf ? 2 : 1)) return []
    const legal = c => ctx.bit < 0 || c.lg & (1 << ctx.bit)
    const ok = partnerOf ? c => c.i !== partnerOf.i && (canBeCommander(c, fmt) || /Background/.test(c.t)) && pairOk(partnerOf, c) : c => canBeCommander(c, fmt) && subset(need, c.ci)
    const byName = search(data, dcq, { sort: 'pop', inText: false }, { bit: ctx.bit, identity: null, allowUn: ctx.allowUn }, 40000).cards.filter(c => legal(c) && ok(c))
    // também pelo tipo de criatura: «pirat», «pirata», «piratas», «vampires», «elfos» → os comandantes desse tipo
    const tys = cmdTypes(data, dcq), seen = new Set(byName.map(c => c.i))
    const byType = tys.size ? search(data, '', { sort: 'pop', inText: false }, { bit: ctx.bit, identity: null, allowUn: ctx.allowUn }, 40000).cards
      .filter(c => !seen.has(c.i) && legal(c) && ok(c) && subsIn(c).some(t => tys.has(t)))
      .map((c, k) => [c, k, subsIn(c).filter(t => tys.has(t)).length]).sort((a, b) => b[2] - a[2] || a[1] - b[1]).map(x => x[0]) : []  // os que têm todos os tipos pedidos primeiro
    return [...byName, ...byType].slice(0, partnerOf ? 24 : 90)
  }, [data, dcq, fmt, cmds.length, partnerOf, ctx.bit, ctx.allowUn, need])
  const has = c => picks.some(p => p.i === c.i) || cmds.some(x => x.i === c.i)
  const maxPicks = start === 'ia' ? 30 : 10
  const toggle = c => setPicks(p => (p.some(x => x.i === c.i) ? p.filter(x => x.i !== c.i) : p.length >= maxPicks ? p : [...p, c]))
  // um comandante possível tem um papel de cada vez: carta de partida, subcomandante ou talvez (tocar no mesmo tira-o)
  const roleOf = c => (cmds.some(x => x.i === c.i) ? 'cmd' : picks.some(x => x.i === c.i) ? 'pick' : subsW.some(x => x.i === c.i) ? 'sub' : maybes.some(x => x.i === c.i) ? 'maybe' : null)
  const setRole = (c, r) => {
    const cur = roleOf(c), off = l => l.filter(x => x.i !== c.i)
    setSubsW(off); setMaybes(off)
    if (cur === 'pick') setPicks(off)
    if (r === cur) return
    if (r === 'pick') toggle(c); else if (r === 'sub') setSubsW(l => [...off(l), c]); else setMaybes(l => [...off(l), c])
    if (cmds.some(x => x.i === c.i)) setCmds(off)
  }
  const pickCmd = c => {  // ♛ a partir do menu: junta como par se fizer par, senão passa a ser o comandante
    const off = l => l.filter(x => x.i !== c.i)
    setPicks(off); setSubsW(off); setMaybes(off)
    if (partnerOf && pairOk(partnerOf, c)) setCmds(x => [...off(x), c]); else setCmd(c)
  }
  const cmdOk = c => fmt.cmd && (canBeCommander(c, fmt) || (partnerOf && /Background/.test(c.t) && pairOk(partnerOf, c)))

  // «Gosto de…»: o texto vira temas, cores e funções (chips que se desligam); a pré-visualização segue os chips ligados
  const dlike = useDeferredValue(like)
  const theme = useMemo(() => likeTheme(data, dlike, { types: CREATURE_TYPES }), [data, dlike])
  const key = { t: t => `t:${t.k}:${t.v}`, c: x => `c:${x.k}`, g: x => `g:${x.k}`, a: x => `a:${x.k}` }
  const on = k => !likeOff.includes(k)
  const flip = (list, set, k) => set(list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  // Detetados no texto + escolhidos na paleta completa, sem repetir. Com comandante, as cores ficam na identidade dele.
  const sel = useMemo(() => {
    const terms = [], seen = new Set(), colors = [], tags = [], arch = []
    const addT = t => { const k = key.t(t); if (!seen.has(k)) { seen.add(k); terms.push(t) } }
    for (const t of theme.terms) if (on(key.t(t))) addT(t)
    for (const x of theme.colors) if (on(key.c(x))) colors.push(x.k)
    for (const x of theme.tags) if (on(key.g(x))) tags.push(x.k)
    for (const x of theme.arch) if (on(key.a(x))) arch.push(x.k)
    // o que o texto já detetou manda: o mesmo chip escolhido à mão não conta duas vezes nem ignora o desligar
    const auto = new Set([...theme.terms.map(key.t), ...theme.colors.map(key.c), ...theme.tags.map(key.g), ...theme.arch.map(key.a)])
    for (const k of likePick) {
      if (auto.has(k)) continue
      const m = /^t:(kw|sub|type|rar|mv|set):(.+)$/.exec(k)
      if (m) addT({ k: m[1], v: m[2], u: 1 })
      else if (k.startsWith('c:')) colors.push(k.slice(2))
      else if (k.startsWith('g:')) tags.push(k.slice(2))
      else if (k.startsWith('a:') && ARCH[k.slice(2)]) arch.push(k.slice(2))
    }
    const ci = cmds.map(c => c.ci).join(''), cols = [...new Set(colors)]
    return {
      terms,
      star: terms.filter(t => likeStar.includes(key.t(t))),
      colors: ci ? cols.filter(k => (k === 'C' ? !ci : ci.includes(k))) : cols,
      tags: [...new Set(tags)],
      arch: [...new Set(arch)],
    }
  }, [theme, likeOff, likeStar, likePick, cmds]) // eslint-disable-line react-hooks/exhaustive-deps
  // as cartas com um nome alternativo escrito («megatron», «mothra») primeiro, depois as dos chips
  const preview = useMemo(() => {
    if (start !== 'gosto') return []
    const l = likeCards(data, sel, ctx, 12), fl = theme.cards.map(x => x.c).filter(c => passes(c, null, ctx))
    return [...fl, ...l.filter(c => !fl.includes(c))].slice(0, 12)
  }, [data, sel, ctx, start, theme])
  const sets = sel.terms.filter(t => t.k === 'set')
  const flOf = c => theme.cards.find(x => x.c === c)?.fl || sets.map(t => flavorOf(c, t.v)).find(Boolean)
  const likeAny = theme.terms.length + theme.colors.length + theme.tags.length + theme.arch.length + theme.cards.length + likePick.length > 0
  const chipTap = (k, star) => (star ? (!on(k) ? flip(likeOff, setLikeOff, k) : likeStar.includes(k) ? (flip(likeStar, setLikeStar, k), flip(likeOff, setLikeOff, k)) : flip(likeStar, setLikeStar, k)) : flip(likeOff, setLikeOff, k))
  // Paleta com todos os chips de MTG (cores, tipos, subtipos, habilidades e funções), em cache nos dados reais.
  const universe = useMemo(() => chipUniverse(data), [data])
  const chipGroups = useMemo(() => [
    { id: 'colors', label: tx('Cores'), items: universe.colors.map(x => ({ key: `c:${x.v}`, label: x.v === 'C' ? tx('Incolor') : COLORS[x.v], v: x.v, n: x.n })) },
    { id: 'types', label: tx('Tipos'), items: universe.types.map(x => ({ key: `t:type:${x.v}`, label: TYPE_LABEL[x.v] || x.v, v: x.v, n: x.n })) },
    { id: 'themes', label: tx('Temas'), items: universe.themes.map(x => ({ key: `t:sub:${x.v}`, label: x.v, v: x.v, n: x.n })) },
    { id: 'archs', label: tx('Estratégias'), items: universe.archs.map(x => ({ key: `a:${x.v}`, label: `♟ ${ARCH[x.v].l}`, v: x.v })) },
    { id: 'sets', label: tx('Sets e universos'), items: universe.sets.map(x => ({ key: `t:set:${x.v}`, label: `🎬 ${setLabel(x.v)}`, v: x.v, n: x.n })) },
    { id: 'keywords', label: tx('Habilidades'), items: universe.keywords.map(x => ({ key: `t:kw:${x.v}`, label: x.v, v: x.v, n: x.n })) },
    { id: 'rar', label: tx('Raridade'), items: universe.rarities.map(x => ({ key: `t:rar:${x.v}`, label: { c: tx('Comum'), u: tx('Incomum'), r: tx('Rara'), m: tx('Mítica') }[x.v], v: x.v, n: x.n })) },
    { id: 'mv', label: 'MV', items: universe.mvs.map(x => ({ key: `t:mv:${x.v}`, label: `MV ${x.v}`, v: x.v, n: x.n })) },
    { id: 'tags', label: tx('Funções'), items: universe.tags.map(x => ({ key: `g:${x.v}`, label: TAG_LABEL[x.v], v: x.v, n: x.n })) },
  ], [universe])
  const chipByKey = useMemo(() => new Map(chipGroups.flatMap(g => g.items.map(x => [x.key, x]))), [chipGroups])
  const chipTotal = chipGroups.reduce((a, g) => a + g.items.length, 0)
  const detected = useMemo(() => new Set([...theme.terms.map(key.t), ...theme.colors.map(key.c), ...theme.tags.map(key.g), ...theme.arch.map(key.a)]), [theme]) // eslint-disable-line react-hooks/exhaustive-deps
  const chipOn = k => (detected.has(k) ? on(k) : likePick.includes(k))
  const chipSet = k => {
    if (detected.has(k)) return chipTap(k, k.startsWith('t:'))
    if (likePick.includes(k)) { setLikePick(x => x.filter(y => y !== k)); setLikeStar(x => x.filter(y => y !== k)) }
    else setLikePick(x => [...x, k])
  }
  const chipColorOff = k => k.startsWith('c:') && cmds.length > 0 && (k === 'c:C' ? !!cmds.map(c => c.ci).join('') : !cmds.map(c => c.ci).join('').includes(k.slice(2)))
  // A busca da paleta entende as línguas da app: «voar» encontra Flying, «dragão» encontra Dragon, «roubar» a função.
  const chipAlias = useMemo(() => {
    const q = chipQ.trim()
    if (!q) return null
    const words = q.split(/\s+/).filter(w => w.length >= 3)
    const variants = [q, ...words.flatMap(w => [w, w.replace(/(ões|ães)$/i, 'ão'), w.replace(/s$/i, '')])]
    const s = new Set()
    for (const v of variants) {
      const p = parseQuery(v, { types: CREATURE_TYPES })
      if (!p) continue
      if (p.f.sub) s.add(`t:sub:${p.f.sub}`)
      for (const k of p.f.oracle || []) s.add(`t:kw:${k}`)
      for (const g of p.f.tags || []) { s.add(`g:${g}`); if (ARCH_OF_TAG[g]) s.add(`a:${ARCH_OF_TAG[g]}`) }
      for (const a of p.f.arch || []) s.add(`a:${a}`)
      for (const c of p.f.colors || []) s.add(`c:${c}`)
    }
    for (const h of findSets(q).hits) s.add(`t:set:${h.v}`)  // «senhor dos anéis», «decepticons», «LTR»
    return s.size ? s : null
  }, [chipQ])
  const chipShown = useMemo(() => {
    const qq = chipQ.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    if (!qq) return chipGroups.filter(g => g.id === chipTab)
    const hit = x => x.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(qq) || chipAlias?.has(x.key)
    return chipGroups.map(g => ({ ...g, items: g.items.filter(hit) })).filter(g => g.items.length)
  }, [chipGroups, chipTab, chipQ, chipAlias])
  const eff = start === 'gosto' && !picks.length ? preview.slice(0, 8) : picks
  // Comandantes que servem os chips do «Gosto de…» (temas, funções e cores), antes de haver um escolhido.
  const cmdLike = useMemo(() => (fmt.cmd && !cmds.length && likeAny ? likeCommanders(data, sel, { fmt, bit: ctx.bit, n: 8, need }) : []), [data, fmt, cmds.length, likeAny, sel, ctx.bit, need])

  // IA: gera a base do deck a partir da ideia; cada carta é validada (existe, legal, cores) antes de entrar.
  const generate = async () => {
    setBusy(true); setAiErr(''); setAiSum(null)
    const pf = prefs.on ? [LEVELS[prefs.nivel ?? 3], (prefs.estilo || []).map(k => STYLES[k]?.label).join(', '), prefs.orcamento ? `até ${prefs.orcamento} € por carta` : ''].filter(Boolean).join('; ') : ''
    try {
      const r = await fetch('/api/ia/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'gerar', question: idea, context: { formato: `${fmt.name}: ${fmt.size[0]} cartas. ${fmt.tips.join(' ')}`, bracket: pf ? `Preferências do utilizador: ${pf}` : '' } }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
      const find = n => data.byLower.get(String(n).toLowerCase()) || data.byLower.get(String(n).split(' // ')[0].toLowerCase())
      const bit = fmtBit(data, fmt)
      let commander = null
      const ok = [], bad = []
      for (const x of j.adicionar || []) {
        const c = find(x.carta)
        if (!c) { bad.push(tx('{name} (não existe)', { name: x.carta })); continue }
        if (bit >= 0 && !(c.lg & (1 << bit))) { bad.push(tx('{name} (ilegal)', { name: c.n })); continue }
        if (fmt.cmd && !commander && /^comandante/i.test(x.porque || '') && canBeCommander(c, fmt)) { commander = c; continue }
        ok.push(c)
      }
      const legal = commander ? ok.filter(c => passes(c, null, { bit, identity: commander.ci })) : ok
      for (const c of ok) if (!legal.includes(c)) bad.push(tx('{name} (fora das cores)', { name: c.n }))
      if (commander) setCmds([commander])
      setPicks(legal.slice(0, 30))
      setAiSum({ txt: j.resumo, bad, modelo: j.modelo })
    } catch (e) { setAiErr(e.message) }
    setBusy(false)
  }

  // Comandantes que cobrem as cores das cartas escolhidas, pela semelhança de texto + popularidade.
  const cmdSugs = useMemo(() => {
    if (!fmt.cmd || cmds.length || !eff.length) return []
    const gosto = start === 'gosto'
    const pin = gosto && sel.colors.length, ci = pin ? sel.colors.join('') : [...new Set(eff.flatMap(c => [...c.ci]))].join('')
    const D = data.D, E = data.emb, cen = new Float32Array(D)
    for (const c of eff) for (let k = 0; k < D; k++) cen[k] += E[c.i * D + k]
    const out = []
    for (const c of data.cards) {
      if (!canBeCommander(c, fmt) || !(pin ? subset(need, c.ci) && subset(c.ci, ci + need) : subset(ci, c.ci)) || (ctx.bit >= 0 && !(c.lg & (1 << ctx.bit)))) continue
      let d = 0
      for (let k = 0; k < D; k++) d += cen[k] * E[c.i * D + k]
      // «Gosto de…»: o que o comandante é e faz pesa tanto como a semelhança com as cartas; incolor/cores a mais custam
      let b = 0
      if (gosto) { for (const t of sel.terms) if (termMatch(c, t)) b += t.u ? 0.2 : 0.1; for (const g of sel.tags) if (c.tg.includes(g)) b += 0.1 }
      out.push({ c, s: b + d / 127 / eff.length + (c.er ? 0.15 * Math.max(0, 1 - Math.log(c.er) / Math.log(40000)) : 0) - (pin ? 0.05 * (ci.length - c.ci.length) : 0.02 * (c.ci.length - ci.length)) })
    }
    return out.sort((a, b) => b.s - a.s).slice(0, 90).map(x => x.c)
  }, [data, fmt, cmds.length, eff, ctx.bit, start, sel, need])

  // Commander e afins: basta o comandante (o resto vem do EDHREC e da sinergia); construído: 3 cartas no mínimo.
  // No «Gosto de…» a primeira sugestão de comandante já serve de escolha, para o deck não ficar sem ele.
  // Com a pesquisa vazia, o seletor de cima também segue o gosto (em vez dos mais populares em geral).
  const cmdPool = useMemo(() => (picks.length && !dcq && !partnerOf && fmt.cmd && !cmds.length && cmdSugs.length ? cmdSugs : start === 'gosto' && !dcq && !partnerOf && fmt.cmd && !cmds.length && likeAny ? likeCommanders(data, sel, { fmt, bit: ctx.bit, n: 90, need }) : cmdRes), [start, dcq, partnerOf, fmt, cmds.length, likeAny, data, sel, ctx.bit, cmdRes, need, picks.length, cmdSugs])
  const cmdShown = useMemo(() => {
    let l = cmdPool.filter(c => (!cf.col.length || (cf.exact ? [...c.ci].sort().join('') === [...cf.col].filter(k => k !== 'C').sort().join('') : cf.col.every(k => (k === 'C' ? !c.ci : c.ci.includes(k))))) &&
      (!cf.kind || (cf.kind === 'pw' ? /Planeswalker/.test(c.t) : cf.kind === 'bg' ? /Background/.test(c.t) : /Creature/.test(c.t))) && (!cf.partner || pairable(c)))
    if (cf.sort === 'pop') l = [...l].sort((a, b) => (a.er || 1e9) - (b.er || 1e9))
    else if (cf.sort === 'nome') l = [...l].sort((a, b) => a.n.localeCompare(b.n))
    else if (cf.sort === 'mv') l = [...l].sort((a, b) => a.cmc - b.cmc || a.n.localeCompare(b.n))
    return l
  }, [cmdPool, cf])
  const cfOn = cf.col.length || cf.kind || cf.partner || cf.sort !== 'rel'
  const cmdBets = cmdSugs.length ? cmdSugs.slice(0, start === 'gosto' ? 8 : 6) : cmdLike
  const autoCmd = cmd || (fmt.cmd && start === 'gosto' ? cmdBets[0] || null : null)
  const ready = fmt.cmd ? !!autoCmd : eff.length >= 3
  const create = auto => {
    const useCmd = cmds.length ? cmds : autoCmd ? [autoCmd] : []
    const ci = useCmd.map(c => c.ci).join('')
    const keep = c => !useCmd.some(x => x.i === c.i) && (!useCmd.length || [...c.ci].every(k => ci.includes(k)))
    const seeds = eff.filter(keep)
    const d = emptyDeck(format)
    d.name = name.trim() || tx('{name} — novo', { name: useCmd.length ? useCmd.map(c => c.n.split(',')[0]).join(' & ') : fmt.name })
    d.commanders = useCmd.map(c => c.n)
    save(null)
    for (const c of seeds) {
      const base = seeds.length <= 5 ? 4 : seeds.length <= 8 ? 3 : 2 // muitas cartas iniciais: menos cópias, sobra espaço
      d.main[c.n] = fmt.copies === 1 || /\bBasic\b/.test(c.t) ? 1 : Math.min(base, c.cmc >= 5 ? 2 : 4)
    }
    d.seeds = seeds.map(c => c.n)
    withIdeas(d, useCmd)
    if (start === 'gosto') d.seedTerms = sel.terms.filter(t => t.u || likeStar.includes(key.t(t))).sort((a, b) => likeStar.includes(key.t(b)) - likeStar.includes(key.t(a))).map(t => ({ k: t.k, v: t.v }))
    d.prefs = prefs
    onCreate(d, auto)
  }
  // subcomandantes: no deck marcados ♛ se cabem na identidade (senão vão para o maybeboard); talvez: maybeboard
  function withIdeas(d, useCmd) {
    const ci = useCmd.map(c => c.ci).join(''), fits = c => !useCmd.length || [...c.ci].every(k => ci.includes(k))
    for (const c of subsW) if (!useCmd.some(x => x.i === c.i)) { if (fits(c)) { d.main[c.n] = 1; d.subs = [...(d.subs || []), c.n] } else d.maybe[c.n] = 1 }
    for (const c of maybes) if (!useCmd.some(x => x.i === c.i) && !d.main[c.n]) d.maybe[c.n] = 1
    return d
  }
  const fakeAct = { setPrefs: p => setPrefs(x => ({ ...x, ...p })) }
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal auto wizard" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onCancel} aria-label={tx('Fechar')}>×</button>
        <h3>{tx('Novo deck')}</h3>
        {(restored || dirty) && <p className="wz-restored small">{restored ? <span className="muted">↺ {tx('Retomei as escolhas que tinhas deixado.')}</span> : <span className="muted">{tx('As escolhas ficam guardadas se fechares.')}</span>} <button className="link" onClick={clear}>{tx('Limpar tudo')}</button></p>}
        <div className="wz-row">
          <label className="fmt"><span>{tx('Formato')}</span>
            <select value={format} onChange={e => { setFormat(e.target.value); setCmds([]) }}>
              {['Multijogador', 'Construído', 'Arena', 'Outros'].map(g => <optgroup key={g} label={tx(g)}>{FORMATS.filter(f => f.group === g).map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="fmt"><span>{tx('Nome (opcional)')}</span><input value={name} onChange={e => setName(e.target.value)} placeholder={tx('o Grimório dá um nome se ficar vazio')} /></label>
        </div>

        <h4>{tx('Como queres começar?')}</h4>
        {/* no telemóvel as quatro opções não cabem numa linha: quebram em vez de ficarem cortadas à esquerda */}
        <div className="seg" style={{ flexWrap: 'wrap', float: 'none', marginLeft: 0 }}>{START.map(([k, l, ic]) => <button key={k} className={start === k ? 'on' : ''} onClick={() => setStart(k)}><i>{ic}</i><span>{l}</span></button>)}</div>

        {start === 'gosto' && (
          <div className="wz-like">
            <label className="fmt"><span>{tx('Gosto de:')}</span>
              <input className="big" value={like} onChange={e => setLike(e.target.value)} placeholder={tx('ninjas, dragões, controlo, azul e preto…')} autoFocus />
            </label>
            {like.trim() && !likeAny && <p className="small muted">{tx('Não percebi nenhum tema: tenta um tipo de criatura (ninjas), uma habilidade (voar), uma estratégia (controlo, burn, aristocratas, stax), uma função (comprar cartas), cores ou um universo (Transformers, O Senhor dos Anéis).')}</p>}
            {[[tx('Temas'), theme.terms, key.t, t => (t.k === 'set' ? `🎬 ${setLabel(t.v)}` : `${t.k === 'kw' ? '✦' : '🏷'} ${t.v}`), true], [tx('Estratégias'), theme.arch, key.a, x => `♟ ${ARCH[x.k].l}`, false], [tx('Cores'), theme.colors, key.c, x => COLORS[x.k], false], [tx('Funções'), theme.tags, key.g, x => TAG_LABEL[x.k], false]]
              .filter(r => r[1].length).map(([h, list, kf, lab, star]) => (
                <div key={h} className="wz-likerow"><span className="muted small">{h}</span>
                  <div className="chips">{list.map(x => { const k = kf(x), st = likeStar.includes(k), off = h === tx('Cores') && chipColorOff(k); return <button key={k} className={`chip like${on(k) && !off ? ' on' : ''}`} onClick={() => chipTap(k, star)} disabled={off} title={off ? tx('Fora da identidade de cor do comandante') : star ? tx('Toca outra vez para tornar este tema essencial ★') : undefined}>{st && !off && '★ '}{lab(x)}</button> })}</div>
                  {star && <p className="small muted">{tx('Toca outra vez para tornar este tema essencial ★')}</p>}
                </div>))}
            {likePick.length > 0 && (
              <div className="wz-likerow"><span className="muted small">{tx('Escolhidos')}</span>
                <div className="chips">{likePick.map(k => { const x = chipByKey.get(k); return x && <button key={k} className="chip like on" onClick={() => chipSet(k)} title={tx('Retirar')}>{x.label}</button> })}</div>
              </div>
            )}
            <button className="link wz-likeallbtn" onClick={() => setChipsOpen(v => !v)}>{chipsOpen ? tx('Esconder os chips') : tx('＋ Todos os chips de MTG ({n})', { n: chipTotal })}</button>
            {chipsOpen && <div className="wz-chipbox">
              <label className="fmt"><span>{tx('Procurar nos chips')}</span><input value={chipQ} onChange={e => setChipQ(e.target.value)} placeholder={tx('ninja, voar, ramp, azul…')} /></label>
              <div className="seg wz-chiptabs">{chipGroups.map(g => <button key={g.id} className={chipTab === g.id && !chipQ.trim() ? 'on' : ''} onClick={() => { setChipTab(g.id); setChipQ('') }}>{g.label} <span className="muted">{g.items.length}</span></button>)}</div>
              {chipShown.map(g => (
                <div key={g.id} className="wz-chipgroup">
                  {chipQ.trim() ? <span className="muted small">{g.label}</span> : null}
                  <div className="chips wz-chiplist">{g.items.map(x => <button key={x.key} className={`chip like${chipOn(x.key) ? ' on' : ''}`} onClick={() => chipSet(x.key)} disabled={chipColorOff(x.key)} title={chipColorOff(x.key) ? tx('Fora da identidade de cor do comandante') : x.label}>{x.label}</button>)}</div>
                </div>))}
              {!chipShown.length && <p className="small muted">{tx('Nenhum com esse nome.')}</p>}
              <p className="small muted">{tx('Cada chip liga um tema, uma habilidade, uma cor ou uma função; os escolhidos entram na pré-visualização e no deck inicial.')}</p>
            </div>}
            {preview.length > 0 && <>
              <h4>{tx('Cartas deste gosto')} <span className="muted">{tx('toca para as juntar às cartas de partida')}</span></h4>
              <div className="wz-res">{preview.map(c => <PickCard key={c.i} c={c} on={has(c)} onPick={() => toggle(c)} onBig={setBig} fl={flOf(c)} />)}</div>
            </>}
            <PrefsPanel deck={{ prefs, id: null }} fmt={fmt} act={fakeAct} compact />
            <button onClick={() => { save(null); const useCmd = cmds.length ? cmds : autoCmd ? [autoCmd] : []; const d = emptyDeck(format); d.name = name.trim() || tx('{name} — novo', { name: useCmd.length ? useCmd.map(c => c.n.split(',')[0]).join(' & ') : fmt.name }); d.commanders = useCmd.map(c => c.n); d.prefs = prefs; d.seedTerms = sel.terms.map(t => ({ k: t.k, v: t.v })); onCreate(withIdeas(d, useCmd), false, 'pesquisa') }} disabled={!sel.terms.length}>✎ {tx('Só os temas, construo eu')}</button>
          </div>
        )}

        {start === 'importar' && (
          <div className="wz-imp">
            <p>{tx('Traz um deck que já tens (link do Moxfield, Archidekt, TappedOut, MTGGoldfish, Deckstats, MTGTop8, Scryfall, ou a lista colada). Depois de importar abre-se o diagnóstico «Melhorias prioritárias», com cortes, trocas, base de mana e o assistente IA para o melhorar.')}</p>
            <button className="primary" onClick={() => { save(null); onImport(format) }}>⇩ {tx('Importar deck')}</button>
          </div>
        )}

        {start === 'manual' && (
          <div className="wz-imp">
            <p>{tx('Começas com o deck vazio e vais metendo as cartas tu. Ao lado da pesquisa, o painel «Sugestões para este deck» acompanha-te em tempo real: a cada carta que entra, recalcula o que combina, o que falta ao formato e a base de mana, sempre com o porquê.')}{fmt.cmd ? ` ${tx('Começa pelo comandante (♛ numa carta lendária).')}` : ''}</p>
            <PrefsPanel deck={{ prefs, id: null }} fmt={fmt} act={fakeAct} compact />
            <button className="primary" onClick={() => { save(null); const d = emptyDeck(format); d.name = name.trim() || tx('{name} — novo', { name: fmt.name }); d.prefs = prefs; onCreate(d, false, 'pesquisa') }}>✎ {tx('Começar a construir')}</button>
          </div>
        )}

        {start === 'ia' && (
          <div className="wz-ia">
            {cfg && cfg.provider === 'off' && <><p className="small">{tx('A IA é um extra opcional e está desligada. Escolhe um fornecedor (o Gemini tem plano gratuito):')}</p><IASettings cfg={cfg} setCfg={setCfg} onDone={() => {}} /></>}
            {(!cfg || cfg.provider !== 'off') && (
              <>
                <textarea value={idea} onChange={e => setIdea(e.target.value)} placeholder={fmt.cmd ? tx('Ex.: elfos verde-preto, barato, que ganhe a encher a mesa de fichas e sacrifica-las') : tx('Ex.: aggro vermelho com muitos feitiços baratos e prowess')} />
                <div className="row-btns"><button className="primary" onClick={generate} disabled={busy || idea.trim().length < 8}>{busy ? tx('A IA está a pensar…') : tx('✦ Gerar a base do deck')}</button>
                  <span className="muted small">{fmt.cmd ? tx('A IA propõe o comandante e 15 a 30 cartas-chave; o Grimório verifica cada uma e completa o resto.') : tx('A IA propõe 15 a 30 cartas-chave; o Grimório verifica cada uma e completa o resto.')}</span></div>
              </>
            )}
            {aiErr && <p className="small bad-t">{aiErr}</p>}
            {aiSum && <div className="ia-sum">{aiSum.txt}{aiSum.bad.length > 0 && <p className="small muted">{tx('Ignoradas: {list}.', { list: aiSum.bad.join(', ') })}</p>}<p className="small muted">{aiSum.modelo}</p></div>}
          </div>
        )}

        {(start === 'cartas' || start === 'ia' || start === 'gosto') && <>
        {fmt.cmd && <>
          <h4>{fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : tx('Comandante')} <span className="muted">{cmds.length ? (partnerOf ? tx('aceita um par: escolhe o segundo se quiseres') : '') : tx('escolhe-o aqui, ou ♛ numa das cartas de partida')}</span></h4>
          <div className="wz-cmd">
            {cmds.map(c => <div key={c.i} className="wz-pick cmd" onContextMenu={e => { e.preventDefault(); held(); setBig(c) }} {...delayedPeek(c)}><img src={img(c, 'normal')} alt={c.n} /><span className="wz-badge">♛ {cmds.length > 1 ? tx('par') : tx('comandante')}</span><RoleMenu c={c} role="cmd" onCmd={() => pickCmd(c)} onRole={setRole} /><button onClick={() => setCmds(x => x.filter(y => y.i !== c.i))} aria-label={tx('Retirar')}>×</button></div>)}
            {cmds.length < (partnerOf ? 2 : 1) && <div className="wz-cmdq">
              <input className="big" value={cq} onChange={e => setCq(e.target.value)} placeholder={partnerOf ? tx('Procurar o par de {name}…', { name: partnerOf.n.split(',')[0] }) : tx(fmt.cmd === 'oathbreaker' ? 'Procurar planeswalker legal em {fmt}…' : 'Procurar comandante legal em {fmt}…', { fmt: fmt.name })} />
              <CmdFilters cf={cf} setCf={setCf} total={cmdPool.length} shown={cmdShown.length} on={cfOn} />
              <div className="wz-res cmds">{cmdShown.slice(0, cf.n).map(c => <CmdCard key={c.i} c={c} onPick={() => { pickCmd(c); setCq('') }} onBig={setBig} role={roleOf(c)} onRole={setRole} />)}
                {!cmdShown.length && <span className="muted small">{cfOn ? tx('Nenhum com estes filtros.') : dcq ? tx('Nenhum com esse nome.') : partnerOf ? tx('Sem pares legais neste formato.') : ''}</span>}</div>
              {cmdShown.length > cf.n && <button className="wz-more" onClick={() => setCf(f => ({ ...f, n: f.n + 18 }))}>{tx('Mostrar mais')} ({cmdShown.length - cf.n})</button>}
            </div>}
          </div>
        </>}
        <h4>{start === 'ia' ? tx('Base gerada') : tx('Cartas de partida')} <span className="muted">{picks.length}/{maxPicks} · {start === 'cartas' ? (fmt.cmd ? tx('opcional: 0 a 10 de que gostes (só o comandante também dá)') : tx('escolhe 3 a 10 de que gostas')) : tx('ajusta à vontade')}</span></h4>
        <div className="wz-picks">
          {picks.map(c => (
            <div key={c.i} className="wz-pick" onContextMenu={e => { e.preventDefault(); held(); setBig(c) }} {...delayedPeek(c)}>
              <img src={img(c, 'normal')} alt={c.n} />
              {fmt.cmd && (!cmds.length || (partnerOf && pairOk(partnerOf, c))) && canBeCommander(c, fmt) && <button className="wz-mk" onClick={() => { setCmds(x => [...x, c]); setPicks(p => p.filter(x => x.i !== c.i)) }}>♛ {tx('Fazer comandante')}</button>}
              {fmt.cmd && canBeCommander(c, fmt) && <RoleMenu c={c} role="pick" onCmd={() => pickCmd(c)} onRole={setRole} />}
              <button onClick={() => toggle(c)} aria-label={tx('Retirar')}>×</button>
            </div>
          ))}
          {start === 'cartas' && !fmt.cmd && Array.from({ length: Math.max(0, 3 - picks.length) }).map((_, k) => <div key={`v${k}`} className="wz-pick empty">{tx('escolhe uma carta')}</div>)}
          {start === 'cartas' && fmt.cmd && !picks.length && <div className="wz-pick empty">{tx('opcional')}</div>}
        </div>
        {fmt.cmd && subsW.length + maybes.length > 0 && <div className="wz-likerow wz-ideas"><span className="muted small">{tx('Subcomandantes e talvez')}</span>
          <div className="chips">{[...subsW.map(c => [c, 'sub']), ...maybes.map(c => [c, 'maybe'])].map(([c, r]) => <button key={c.i} className="chip like on" onClick={() => setRole(c, r)} title={tx('Retirar')}>{r === 'sub' ? <span className="sub-badge">♕</span> : '?'} {c.n.split(',')[0]} ×</button>)}</div>
          <p className="small muted">{tx('Os subcomandantes entram no deck como cartas normais, marcados ♕, para trocar depressa com o comandante; os «talvez» ficam no maybeboard. Ambos puxam um pouco as sugestões.')}</p>
        </div>}

        {cmdBets.length > 0 && (
          <>
            <h4>{start === 'gosto' && cmdBets.length ? tx('Comandantes para este gosto') : tx('Comandantes que encaixam')} <span className="muted">{start === 'gosto' && cmdBets.length ? tx('toca para escolher; as cores ficam presas à identidade dele') : tx('cobrem as cores das tuas cartas')}</span></h4>
            <div className="wz-res cmds">{cmdBets.map(c => <CmdCard key={c.i} c={c} onPick={() => pickCmd(c)} onBig={setBig} role={roleOf(c)} onRole={setRole} />)}</div>
          </>
        )}

        {start !== 'gosto' && <><input className="big" value={q} onChange={e => setQ(e.target.value)} placeholder={tx(ctx.bit >= 0 ? 'Procurar cartas legais em {fmt}' : 'Procurar cartas', { fmt: fmt.name }) + (ctx.identity != null ? tx(' na identidade {id}', { id: ctx.identity || tx('incolor') }) : '') + '…'} />
        <div className="wz-res">{res.map(c => <PickCard key={c.i} c={c} on={has(c)} disabled={!has(c) && picks.length >= maxPicks} onPick={() => toggle(c)} onBig={setBig} />)}</div></>}

        {start !== 'gosto' && <PrefsPanel deck={{ prefs, id: null }} fmt={fmt} act={fakeAct} compact />}
        </>}

        {(start === 'cartas' || start === 'ia' || start === 'gosto') && <div className="row-btns wz-foot">
          <button className="primary" onClick={() => create(true)} disabled={!ready}>{fmt.cmd && !picks.length && cmd ? tx('✦ Construir o deck à volta do comandante') : start === 'gosto' ? (autoCmd && !cmd ? tx('✦ Criar deck com {name}', { name: autoCmd.n.split(',')[0] }) : tx('✦ Criar deck inicial')) : tx('✦ Criar e completar o deck')}</button>
          <button onClick={() => create(false)} disabled={!eff.length && !autoCmd}>{tx('Criar só com estas')}</button>
          <span className="muted small">{!ready ? (fmt.cmd ? tx('Escolhe o comandante (pesquisa acima, ♛ numa carta ou uma sugestão).') : tx('Falta {n} carta.|Faltam {n} cartas.', { n: 3 - eff.length })) : autoCmd ? <>{cmds.length > 1 ? tx('Comandantes') : tx('Comandante')}: <b>{(cmds.length ? cmds : [autoCmd]).map(c => c.n).join(' + ')}</b> <Mana cost={(cmds.length ? cmds : [autoCmd]).map(c => c.mc).join('')} /></> : fmt.side > 0 ? tx('No fim também é proposto um sideboard de 15.') : ''}</span>
        </div>}
      </div>
      {big && <BigCard name={big.n} data={data} onClose={() => setBig(null)}>{cmdOk(big) && !cmds.some(x => x.i === big.i) ? <CmdActs c={big} role={roleOf(big)} onCmd={() => pickCmd(big)} onRole={setRole} done={() => setBig(null)} /> : null}</BigCard>}
    </div>
  )
}
