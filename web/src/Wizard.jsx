// Assistente de deck novo: formato → comandante (Commander e afins: pode ser só ele) e/ou 3 a 10 cartas → personalização → completar.
// As escolhas ficam guardadas neste browser até o deck ser criado (fechar sem querer não as perde); «Limpar» recomeça.
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { search, img, fmtBit, passes, STYLES, LEVELS, CREATURE_TYPES, COLORS, TAG_LABEL, TYPE_LABEL, termMatch } from './data.js'
import { likeTheme, likeCards, likeCommanders, chipUniverse, parseQuery } from './nlsearch.js'
import { FORMATS, FORMAT, canBeCommander } from './formats.js'
import { emptyDeck } from './deck.js'
import { PrefsPanel, IASettings } from './Views.jsx'
import { Mana } from './ui.jsx'
import { tx } from './i18n.js'
import { useBackClose } from './backnav.js'

const subset = (a, b) => [...a].every(k => b.includes(k))
const KEY = 'grimorio.wizard'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }
const save = v => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY) } catch { /* sem armazenamento */ } }
// dois comandantes: Partner, Partner with X, Friends forever, Choose a Background, Doctor's companion
const pairable = c => /\bPartner\b|Friends forever|Doctor's companion|Choose a Background/.test(c.o) || /Time Lord Doctor/.test(c.t)
function pairOk(a, b) {
  const pw = c => c.o.match(/Partner with ([^\n(]+)/)?.[1]?.trim()
  if (pw(a) || pw(b)) return pw(a) === b.n || pw(b) === a.n
  const one = (re, ok) => (re.test(a.o) && ok(b)) || (re.test(b.o) && ok(a))
  return one(/Choose a Background/, c => /Background/.test(c.t)) || one(/Doctor's companion/, c => /Time Lord Doctor/.test(c.t)) ||
    [/\bPartner\b/, /Friends forever/].some(re => re.test(a.o) && re.test(b.o))
}

const START = [['gosto', tx('Gosto de…'), '♥'], ['cartas', tx('Escolher 3–10 cartas'), '▦'], ['manual', tx('Construir à mão'), '✎'], ['importar', tx('Importar e melhorar'), '⇩'], ['ia', tx('Descrever a ideia (IA)'), '✦']]

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
  const [prefs, setPrefs] = useState(S0.prefs || {})
  const [q, setQ] = useState(S0.q || '')
  const [cq, setCq] = useState('')
  const dq = useDeferredValue(q), dcq = useDeferredValue(cq)
  const [restored, setRestored] = useState(() => !!(S0.like || S0.likePick?.length || S0.picks?.length || S0.cmds?.length || S0.idea || S0.name))
  useEffect(() => { save({ start, idea, like, likeOff, likeStar, likePick, format, name, picks: picks.map(c => c.n), cmds: cmds.map(c => c.n), prefs, q }) }, [start, idea, like, likeOff, likeStar, likePick, format, name, picks, cmds, prefs, q])
  const clear = () => { save(null); setStart('cartas'); setIdea(''); setLike(''); setLikeOff([]); setLikeStar([]); setLikePick([]); setName(''); setPicks([]); setCmds([]); setPrefs({}); setQ(''); setCq(''); setAiSum(null); setRestored(false) }
  const dirty = like || picks.length || cmds.length || idea || name || q
  const cmd = cmds[0] || null
  const setCmd = c => {
    setCmds(c ? [c] : [])
    if (c) setLikePick(x => x.filter(k => !k.startsWith('c:') || (k === 'c:C' ? !c.ci : c.ci.includes(k.slice(2)))))
  }
  const fmt = FORMAT[format]
  const ctx = useMemo(() => ({ bit: fmtBit(data, fmt), identity: fmt.cmd && cmds.length ? cmds.map(c => c.ci).join('') : null, allowUn: fmt.key === 'casual' }), [data, fmt, cmds])
  const res = useMemo(() => search(data, dq, { sort: 'pop', inText: false }, ctx, 48).cards, [data, dq, ctx])
  // comandantes legais no formato (pela popularidade); com um escolhido que aceite par, os parceiros possíveis
  const partnerOf = cmds.length === 1 && pairable(cmds[0]) ? cmds[0] : null
  const cmdRes = useMemo(() => {
    if (!fmt.cmd || cmds.length >= (partnerOf ? 2 : 1)) return []
    const legal = c => ctx.bit < 0 || c.lg & (1 << ctx.bit)
    const ok = partnerOf ? c => c.i !== partnerOf.i && (canBeCommander(c, fmt) || /Background/.test(c.t)) && pairOk(partnerOf, c) : c => canBeCommander(c, fmt)
    return search(data, dcq, { sort: 'pop', inText: false }, { bit: ctx.bit, identity: null, allowUn: ctx.allowUn }, 40000).cards.filter(c => legal(c) && ok(c)).slice(0, partnerOf ? 12 : 18)
  }, [data, dcq, fmt, cmds.length, partnerOf, ctx.bit, ctx.allowUn])
  const has = c => picks.some(p => p.i === c.i) || cmds.some(x => x.i === c.i)
  const maxPicks = start === 'ia' ? 30 : 10
  const toggle = c => setPicks(p => (p.some(x => x.i === c.i) ? p.filter(x => x.i !== c.i) : p.length >= maxPicks ? p : [...p, c]))

  // «Gosto de…»: o texto vira temas, cores e funções (chips que se desligam); a pré-visualização segue os chips ligados
  const dlike = useDeferredValue(like)
  const theme = useMemo(() => likeTheme(data, dlike, { types: CREATURE_TYPES }), [data, dlike])
  const key = { t: t => `t:${t.k}:${t.v}`, c: x => `c:${x.k}`, g: x => `g:${x.k}` }
  const on = k => !likeOff.includes(k)
  const flip = (list, set, k) => set(list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  // Detetados no texto + escolhidos na paleta completa, sem repetir. Com comandante, as cores ficam na identidade dele.
  const sel = useMemo(() => {
    const terms = [], seen = new Set(), colors = [], tags = []
    const addT = t => { const k = key.t(t); if (!seen.has(k)) { seen.add(k); terms.push(t) } }
    for (const t of theme.terms) if (on(key.t(t))) addT(t)
    for (const x of theme.colors) if (on(key.c(x))) colors.push(x.k)
    for (const x of theme.tags) if (on(key.g(x))) tags.push(x.k)
    // o que o texto já detetou manda: o mesmo chip escolhido à mão não conta duas vezes nem ignora o desligar
    const auto = new Set([...theme.terms.map(key.t), ...theme.colors.map(key.c), ...theme.tags.map(key.g)])
    for (const k of likePick) {
      if (auto.has(k)) continue
      const m = /^t:(kw|sub|type|rar|mv):(.+)$/.exec(k)
      if (m) addT({ k: m[1], v: m[2], u: 1 })
      else if (k.startsWith('c:')) colors.push(k.slice(2))
      else if (k.startsWith('g:')) tags.push(k.slice(2))
    }
    const ci = cmds.map(c => c.ci).join(''), cols = [...new Set(colors)]
    return {
      terms,
      star: terms.filter(t => likeStar.includes(key.t(t))),
      colors: ci ? cols.filter(k => (k === 'C' ? !ci : ci.includes(k))) : cols,
      tags: [...new Set(tags)],
    }
  }, [theme, likeOff, likeStar, likePick, cmds]) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (start === 'gosto' ? likeCards(data, sel, ctx, 12) : []), [data, sel, ctx, start])
  const likeAny = theme.terms.length + theme.colors.length + theme.tags.length + likePick.length > 0
  const chipTap = (k, star) => (star ? (!on(k) ? flip(likeOff, setLikeOff, k) : likeStar.includes(k) ? (flip(likeStar, setLikeStar, k), flip(likeOff, setLikeOff, k)) : flip(likeStar, setLikeStar, k)) : flip(likeOff, setLikeOff, k))
  // Paleta com todos os chips de MTG (cores, tipos, subtipos, habilidades e funções), em cache nos dados reais.
  const universe = useMemo(() => chipUniverse(data), [data])
  const chipGroups = useMemo(() => [
    { id: 'colors', label: tx('Cores'), items: universe.colors.map(x => ({ key: `c:${x.v}`, label: x.v === 'C' ? tx('Incolor') : COLORS[x.v], v: x.v, n: x.n })) },
    { id: 'types', label: tx('Tipos'), items: universe.types.map(x => ({ key: `t:type:${x.v}`, label: TYPE_LABEL[x.v] || x.v, v: x.v, n: x.n })) },
    { id: 'themes', label: tx('Temas'), items: universe.themes.map(x => ({ key: `t:sub:${x.v}`, label: x.v, v: x.v, n: x.n })) },
    { id: 'keywords', label: tx('Habilidades'), items: universe.keywords.map(x => ({ key: `t:kw:${x.v}`, label: x.v, v: x.v, n: x.n })) },
    { id: 'rar', label: tx('Raridade'), items: universe.rarities.map(x => ({ key: `t:rar:${x.v}`, label: { c: tx('Comum'), u: tx('Incomum'), r: tx('Rara'), m: tx('Mítica') }[x.v], v: x.v, n: x.n })) },
    { id: 'mv', label: 'MV', items: universe.mvs.map(x => ({ key: `t:mv:${x.v}`, label: `MV ${x.v}`, v: x.v, n: x.n })) },
    { id: 'tags', label: tx('Funções'), items: universe.tags.map(x => ({ key: `g:${x.v}`, label: TAG_LABEL[x.v], v: x.v, n: x.n })) },
  ], [universe])
  const chipByKey = useMemo(() => new Map(chipGroups.flatMap(g => g.items.map(x => [x.key, x]))), [chipGroups])
  const chipTotal = chipGroups.reduce((a, g) => a + g.items.length, 0)
  const detected = useMemo(() => new Set([...theme.terms.map(key.t), ...theme.colors.map(key.c), ...theme.tags.map(key.g)]), [theme]) // eslint-disable-line react-hooks/exhaustive-deps
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
      for (const g of p.f.tags || []) s.add(`g:${g}`)
      for (const c of p.f.colors || []) s.add(`c:${c}`)
    }
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
  const cmdLike = useMemo(() => (fmt.cmd && !cmds.length && likeAny ? likeCommanders(data, sel, { fmt, bit: ctx.bit, n: 8 }) : []), [data, fmt, cmds.length, likeAny, sel, ctx.bit])
  // Com a pesquisa vazia, o seletor de cima também segue o gosto (em vez dos mais populares em geral).
  const cmdShown = useMemo(() => (start === 'gosto' && !dcq && !partnerOf && fmt.cmd && !cmds.length && likeAny ? likeCommanders(data, sel, { fmt, bit: ctx.bit, n: 18 }) : cmdRes), [start, dcq, partnerOf, fmt, cmds.length, likeAny, data, sel, ctx.bit, cmdRes])

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
      if (!canBeCommander(c, fmt) || !(pin ? subset(c.ci, ci) : subset(ci, c.ci)) || (ctx.bit >= 0 && !(c.lg & (1 << ctx.bit)))) continue
      let d = 0
      for (let k = 0; k < D; k++) d += cen[k] * E[c.i * D + k]
      // «Gosto de…»: o que o comandante é e faz pesa tanto como a semelhança com as cartas; incolor/cores a mais custam
      let b = 0
      if (gosto) { for (const t of sel.terms) if (termMatch(c, t)) b += t.u ? 0.2 : 0.1; for (const g of sel.tags) if (c.tg.includes(g)) b += 0.1 }
      out.push({ c, s: b + d / 127 / eff.length + (c.er ? 0.15 * Math.max(0, 1 - Math.log(c.er) / Math.log(40000)) : 0) - (pin ? 0.05 * (ci.length - c.ci.length) : 0.02 * (c.ci.length - ci.length)) })
    }
    return out.sort((a, b) => b.s - a.s).slice(0, gosto ? 8 : 6).map(x => x.c)
  }, [data, fmt, cmds.length, eff, ctx.bit, start, sel])

  // Commander e afins: basta o comandante (o resto vem do EDHREC e da sinergia); construído: 3 cartas no mínimo.
  // No «Gosto de…» a primeira sugestão de comandante já serve de escolha, para o deck não ficar sem ele.
  const cmdBets = cmdSugs.length ? cmdSugs : cmdLike
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
    if (start === 'gosto') d.seedTerms = sel.terms.filter(t => t.u || likeStar.includes(key.t(t))).sort((a, b) => likeStar.includes(key.t(b)) - likeStar.includes(key.t(a))).map(t => ({ k: t.k, v: t.v }))
    d.prefs = prefs
    onCreate(d, auto)
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
              <input className="big" value={like} onChange={e => setLike(e.target.value)} placeholder={tx('ninjas, dragões, roubar cartas, azul e preto…')} autoFocus />
            </label>
            {like.trim() && !likeAny && <p className="small muted">{tx('Não percebi nenhum tema: tenta um tipo de criatura (ninjas), uma habilidade (voar), uma função (ramp) ou cores.')}</p>}
            {[[tx('Temas'), theme.terms, key.t, t => `${t.k === 'kw' ? '✦' : '🏷'} ${t.v}`, true], [tx('Cores'), theme.colors, key.c, x => COLORS[x.k], false], [tx('Funções'), theme.tags, key.g, x => TAG_LABEL[x.k], false]]
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
              <div className="wz-res">{preview.map(c => <button key={c.i} className={has(c) ? 'on' : ''} onClick={() => toggle(c)} title={c.n}><img src={img(c, 'normal')} alt={c.n} loading="lazy" />{has(c) && <span>✓</span>}</button>)}</div>
            </>}
            <PrefsPanel deck={{ prefs, id: null }} fmt={fmt} act={fakeAct} compact />
            <button onClick={() => { save(null); const useCmd = cmds.length ? cmds : autoCmd ? [autoCmd] : []; const d = emptyDeck(format); d.name = name.trim() || tx('{name} — novo', { name: useCmd.length ? useCmd.map(c => c.n.split(',')[0]).join(' & ') : fmt.name }); d.commanders = useCmd.map(c => c.n); d.prefs = prefs; d.seedTerms = sel.terms.map(t => ({ k: t.k, v: t.v })); onCreate(d, false, 'pesquisa') }} disabled={!sel.terms.length}>✎ {tx('Só os temas, construo eu')}</button>
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
            {cmds.map(c => <div key={c.i} className="wz-pick cmd"><img src={img(c, 'normal')} alt={c.n} /><span className="wz-badge">♛ {cmds.length > 1 ? tx('par') : tx('comandante')}</span><button onClick={() => setCmds(x => x.filter(y => y.i !== c.i))} aria-label={tx('Retirar')}>×</button></div>)}
            {cmds.length < (partnerOf ? 2 : 1) && <div className="wz-cmdq">
              <input className="big" value={cq} onChange={e => setCq(e.target.value)} placeholder={partnerOf ? tx('Procurar o par de {name}…', { name: partnerOf.n.split(',')[0] }) : tx(fmt.cmd === 'oathbreaker' ? 'Procurar planeswalker legal em {fmt}…' : 'Procurar comandante legal em {fmt}…', { fmt: fmt.name })} />
              <div className="wz-res cmds">{cmdShown.map(c => <button key={c.i} onClick={() => { setCmds(x => [...x, c]); setPicks(p => p.filter(y => y.i !== c.i)); setCq('') }} title={c.n}><img src={img(c, 'normal')} alt={c.n} loading="lazy" /></button>)}
                {!cmdShown.length && <span className="muted small">{dcq ? tx('Nenhum com esse nome.') : partnerOf ? tx('Sem pares legais neste formato.') : ''}</span>}</div>
            </div>}
          </div>
        </>}
        <h4>{start === 'ia' ? tx('Base gerada') : tx('Cartas de partida')} <span className="muted">{picks.length}/{maxPicks} · {start === 'cartas' ? (fmt.cmd ? tx('opcional: 0 a 10 de que gostes (só o comandante também dá)') : tx('escolhe 3 a 10 de que gostas')) : tx('ajusta à vontade')}</span></h4>
        <div className="wz-picks">
          {picks.map(c => (
            <div key={c.i} className="wz-pick">
              <img src={img(c, 'normal')} alt={c.n} />
              {fmt.cmd && (!cmds.length || (partnerOf && pairOk(partnerOf, c))) && canBeCommander(c, fmt) && <button className="wz-mk" onClick={() => { setCmds(x => [...x, c]); setPicks(p => p.filter(x => x.i !== c.i)) }}>♛ {tx('comandante')}</button>}
              <button onClick={() => toggle(c)} aria-label={tx('Retirar')}>×</button>
            </div>
          ))}
          {start === 'cartas' && !fmt.cmd && Array.from({ length: Math.max(0, 3 - picks.length) }).map((_, k) => <div key={`v${k}`} className="wz-pick empty">{tx('escolhe uma carta')}</div>)}
          {start === 'cartas' && fmt.cmd && !picks.length && <div className="wz-pick empty">{tx('opcional')}</div>}
        </div>

        {cmdBets.length > 0 && (
          <>
            <h4>{start === 'gosto' && cmdBets.length ? tx('Comandantes para este gosto') : tx('Comandantes que encaixam')} <span className="muted">{start === 'gosto' && cmdBets.length ? tx('toca para escolher; as cores ficam presas à identidade dele') : tx('cobrem as cores das tuas cartas')}</span></h4>
            <div className="wz-res cmds">{cmdBets.map(c => <button key={c.i} onClick={() => setCmd(c)} title={c.n}><img src={img(c, 'normal')} alt={c.n} loading="lazy" /></button>)}</div>
          </>
        )}

        {start !== 'gosto' && <><input className="big" value={q} onChange={e => setQ(e.target.value)} placeholder={tx(ctx.bit >= 0 ? 'Procurar cartas legais em {fmt}' : 'Procurar cartas', { fmt: fmt.name }) + (ctx.identity != null ? tx(' na identidade {id}', { id: ctx.identity || tx('incolor') }) : '') + '…'} />
        <div className="wz-res">{res.map(c => (
          <button key={c.i} className={has(c) ? 'on' : ''} onClick={() => toggle(c)} title={c.n} disabled={!has(c) && picks.length >= maxPicks}>
            <img src={img(c, 'normal')} alt={c.n} loading="lazy" />{has(c) && <span>✓</span>}
          </button>
        ))}</div></>}

        {start !== 'gosto' && <PrefsPanel deck={{ prefs, id: null }} fmt={fmt} act={fakeAct} compact />}
        </>}

        {(start === 'cartas' || start === 'ia' || start === 'gosto') && <div className="row-btns wz-foot">
          <button className="primary" onClick={() => create(true)} disabled={!ready}>{fmt.cmd && !picks.length && cmd ? tx('✦ Construir o deck à volta do comandante') : start === 'gosto' ? (autoCmd && !cmd ? tx('✦ Criar deck com {name}', { name: autoCmd.n.split(',')[0] }) : tx('✦ Criar deck inicial')) : tx('✦ Criar e completar o deck')}</button>
          <button onClick={() => create(false)} disabled={!eff.length && !autoCmd}>{tx('Criar só com estas')}</button>
          <span className="muted small">{!ready ? (fmt.cmd ? tx('Escolhe o comandante (pesquisa acima, ♛ numa carta ou uma sugestão).') : tx('Falta {n} carta.|Faltam {n} cartas.', { n: 3 - eff.length })) : autoCmd ? <>{cmds.length > 1 ? tx('Comandantes') : tx('Comandante')}: <b>{(cmds.length ? cmds : [autoCmd]).map(c => c.n).join(' + ')}</b> <Mana cost={(cmds.length ? cmds : [autoCmd]).map(c => c.mc).join('')} /></> : fmt.side > 0 ? tx('No fim também é proposto um sideboard de 15.') : ''}</span>
        </div>}
      </div>
    </div>
  )
}
