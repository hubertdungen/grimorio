// Assistente de deck novo: formato → comandante (Commander e afins: pode ser só ele) e/ou 3 a 10 cartas → personalização → completar.
// As escolhas ficam guardadas neste browser até o deck ser criado (fechar sem querer não as perde); «Limpar» recomeça.
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { search, img, fmtBit, passes, STYLES, LEVELS } from './data.js'
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

const START = [['cartas', tx('Escolher 3–10 cartas'), '▦'], ['manual', tx('Construir à mão'), '✎'], ['importar', tx('Importar e melhorar'), '⇩'], ['ia', tx('Descrever a ideia (IA)'), '✦']]

export default function NewDeckWizard({ data, fmtInit, onCancel, onCreate, onImport }) {
  useBackClose(true, onCancel)  // «voltar» do telemóvel fecha esta janela
  const [S0] = useState(load), cards = ns => (ns || []).map(n => data.byName.get(n)).filter(Boolean)
  const [start, setStart] = useState(S0.start || 'cartas')
  const [idea, setIdea] = useState(S0.idea || '')
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
  const [restored, setRestored] = useState(() => !!(S0.picks?.length || S0.cmds?.length || S0.idea || S0.name))
  useEffect(() => { save({ start, idea, format, name, picks: picks.map(c => c.n), cmds: cmds.map(c => c.n), prefs, q }) }, [start, idea, format, name, picks, cmds, prefs, q])
  const clear = () => { save(null); setStart('cartas'); setIdea(''); setName(''); setPicks([]); setCmds([]); setPrefs({}); setQ(''); setCq(''); setAiSum(null); setRestored(false) }
  const dirty = picks.length || cmds.length || idea || name || q
  const cmd = cmds[0] || null
  const setCmd = c => setCmds(c ? [c] : [])
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
    if (!fmt.cmd || cmds.length || !picks.length) return []
    const ci = [...new Set(picks.flatMap(c => [...c.ci]))].join('')
    const D = data.D, E = data.emb, cen = new Float32Array(D)
    for (const c of picks) for (let k = 0; k < D; k++) cen[k] += E[c.i * D + k]
    const out = []
    for (const c of data.cards) {
      if (!canBeCommander(c, fmt) || !subset(ci, c.ci) || (ctx.bit >= 0 && !(c.lg & (1 << ctx.bit)))) continue
      let d = 0
      for (let k = 0; k < D; k++) d += cen[k] * E[c.i * D + k]
      out.push({ c, s: d / 127 / picks.length + (c.er ? 0.15 * Math.max(0, 1 - Math.log(c.er) / Math.log(40000)) : 0) - 0.02 * (c.ci.length - ci.length) })
    }
    return out.sort((a, b) => b.s - a.s).slice(0, 6).map(x => x.c)
  }, [data, fmt, cmds.length, picks, ctx.bit])

  // Commander e afins: basta o comandante (o resto vem do EDHREC e da sinergia); construído: 3 cartas no mínimo
  const ready = fmt.cmd ? cmds.length > 0 : picks.length >= 3
  const create = auto => {
    const d = emptyDeck(format)
    d.name = name.trim() || tx('{name} — novo', { name: cmd ? cmds.map(c => c.n.split(',')[0]).join(' & ') : fmt.name })
    d.commanders = cmds.map(c => c.n)
    save(null)
    for (const c of picks) {
      if (cmds.some(x => x.i === c.i)) continue
      const base = picks.length <= 5 ? 4 : picks.length <= 8 ? 3 : 2 // muitas cartas iniciais: menos cópias, sobra espaço
      d.main[c.n] = fmt.copies === 1 || /\bBasic\b/.test(c.t) ? 1 : Math.min(base, c.cmc >= 5 ? 2 : 4)
    }
    d.seeds = picks.map(c => c.n)
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
        <div className="seg">{START.map(([k, l, ic]) => <button key={k} className={start === k ? 'on' : ''} onClick={() => setStart(k)}><i>{ic}</i><span>{l}</span></button>)}</div>

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

        {(start === 'cartas' || start === 'ia') && <>
        {fmt.cmd && <>
          <h4>{fmt.cmd === 'oathbreaker' ? 'Oathbreaker' : tx('Comandante')} <span className="muted">{cmds.length ? (partnerOf ? tx('aceita um par: escolhe o segundo se quiseres') : '') : tx('escolhe-o aqui, ou ♛ numa das cartas de partida')}</span></h4>
          <div className="wz-cmd">
            {cmds.map(c => <div key={c.i} className="wz-pick cmd"><img src={img(c, 'normal')} alt={c.n} /><span className="wz-badge">♛ {cmds.length > 1 ? tx('par') : tx('comandante')}</span><button onClick={() => setCmds(x => x.filter(y => y.i !== c.i))} aria-label={tx('Retirar')}>×</button></div>)}
            {cmds.length < (partnerOf ? 2 : 1) && <div className="wz-cmdq">
              <input className="big" value={cq} onChange={e => setCq(e.target.value)} placeholder={partnerOf ? tx('Procurar o par de {name}…', { name: partnerOf.n.split(',')[0] }) : tx(fmt.cmd === 'oathbreaker' ? 'Procurar planeswalker legal em {fmt}…' : 'Procurar comandante legal em {fmt}…', { fmt: fmt.name })} />
              <div className="wz-res cmds">{cmdRes.map(c => <button key={c.i} onClick={() => { setCmds(x => [...x, c]); setPicks(p => p.filter(y => y.i !== c.i)); setCq('') }} title={c.n}><img src={img(c, 'normal')} alt={c.n} loading="lazy" /></button>)}
                {!cmdRes.length && <span className="muted small">{dcq ? tx('Nenhum com esse nome.') : partnerOf ? tx('Sem pares legais neste formato.') : ''}</span>}</div>
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

        {cmdSugs.length > 0 && (
          <>
            <h4>{tx('Comandantes que encaixam')} <span className="muted">{tx('cobrem as cores das tuas cartas')}</span></h4>
            <div className="wz-res cmds">{cmdSugs.map(c => <button key={c.i} onClick={() => setCmd(c)} title={c.n}><img src={img(c, 'normal')} alt={c.n} loading="lazy" /></button>)}</div>
          </>
        )}

        <input className="big" value={q} onChange={e => setQ(e.target.value)} placeholder={tx(ctx.bit >= 0 ? 'Procurar cartas legais em {fmt}' : 'Procurar cartas', { fmt: fmt.name }) + (ctx.identity != null ? tx(' na identidade {id}', { id: ctx.identity || tx('incolor') }) : '') + '…'} />
        <div className="wz-res">{res.map(c => (
          <button key={c.i} className={has(c) ? 'on' : ''} onClick={() => toggle(c)} title={c.n} disabled={!has(c) && picks.length >= maxPicks}>
            <img src={img(c, 'normal')} alt={c.n} loading="lazy" />{has(c) && <span>✓</span>}
          </button>
        ))}</div>

        <PrefsPanel deck={{ prefs, id: null }} fmt={fmt} act={fakeAct} compact />
        </>}

        {(start === 'cartas' || start === 'ia') && <div className="row-btns wz-foot">
          <button className="primary" onClick={() => create(true)} disabled={!ready}>{fmt.cmd && !picks.length && cmd ? tx('✦ Construir o deck à volta do comandante') : tx('✦ Criar e completar o deck')}</button>
          <button onClick={() => create(false)} disabled={!picks.length && !cmd}>{tx('Criar só com estas')}</button>
          <span className="muted small">{!ready ? (fmt.cmd ? tx('Escolhe o comandante (pesquisa acima, ♛ numa carta ou uma sugestão).') : tx('Falta {n} carta.|Faltam {n} cartas.', { n: 3 - picks.length })) : cmd ? <>{cmds.length > 1 ? tx('Comandantes') : tx('Comandante')}: <b>{cmds.map(c => c.n).join(' + ')}</b> <Mana cost={cmds.map(c => c.mc).join('')} /></> : fmt.side > 0 ? tx('No fim também é proposto um sideboard de 15.') : ''}</span>
        </div>}
      </div>
    </div>
  )
}
