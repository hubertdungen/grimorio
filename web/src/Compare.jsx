// 🔍 Comparar com outros decks (Sugestões): os parecidos primeiro (os teus e os da biblioteca, o deck médio do EDHREC do teu
// comandante, decks públicos do Archidekt com ele, as listas de torneio do formato) ou qualquer link (Archidekt, Moxfield,
// TappedOut, MTGGoldfish, MTGTop8…). Escolhido um, dicas por função/mecânica e trocas, juntas e cortes para aplicar.
import { useEffect, useMemo, useState } from 'react'
import { img, pidOf, TAG_LABEL } from './data.js'
import { parseList } from './deck.js'
import { manaNeeds } from './mana.js'
import { cutQueue } from './reinforce.js'
import { roleQuality } from './autobuild.js'
import { cardSet, likeness, likeLabel, profile, compareTips, comparePlan, edhSlug } from './compare.js'
import { Mana } from './ui.jsx'
import { hlProps, pin } from './hl.js'
import { tx } from './i18n.js'

const LISTS = new Map()  // listas já trazidas nesta sessão (link/id → {name, source, url, main, commanders})
const j = u => fetch(u).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
async function once(key, get) {
  if (!LISTS.has(key)) LISTS.set(key, get().catch(() => null))
  return LISTS.get(key)
}
const fromImport = (data, url, source) => once(url, async () => {
  const r = await j(`/api/import?url=${encodeURIComponent(url)}`)
  const p = parseList(r.text || '', data)
  return { name: r.name, source: source || r.source, url, main: p.main, commanders: p.commanders }
})
const SRC = { mine: tx('Biblioteca'), edhrec: 'EDHREC', archidekt: 'Archidekt', meta: tx('Torneios'), link: tx('Link') }
const LIKE = { muito: tx('muito parecido'), parecido: tx('parecido'), pouco: tx('pouco parecido') }

export function ComparePanel({ data, deck, fmt, ctx, act, rq, recs, needs, co, cmdIdx, meta, archetype }) {
  const [open, setOpenS] = useState(() => { try { return localStorage.getItem('grimorio.comparar') === '1' } catch { return false } })
  const setOpen = v => { setOpenS(v); try { localStorage.setItem('grimorio.comparar', v ? '1' : '0') } catch { /* sem armazenamento */ } }
  const [cands, setCands] = useState([])  // {key, name, source, url, main, commanders}
  const [loading, setLoading] = useState(0)
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const [weak, setWeak] = useState(false)
  const [done, setDone] = useState(() => new Set())
  const ck = deck.commanders.join('|')
  const cmds = useMemo(() => (ck ? ck.split('|') : []), [ck])
  const mine = useMemo(() => cardSet(data, deck.main, cmds), [data, deck.main, cmds])

  // as candidatas: carregam ao abrir, cada fonte à sua velocidade
  useEffect(() => {
    if (!open) return
    let off = false
    const add = x => { if (!off && x && Object.keys(x.main || {}).length) setCands(l => (l.some(y => y.key === x.key) ? l : [...l, x])) }
    const job = async f => { setLoading(n => n + 1); try { await f() } catch { /* fonte indisponível */ } finally { if (!off) setLoading(n => n - 1) } }
    job(async () => {  // a biblioteca (os teus, dos amigos e da comunidade) já traz as listas
      for (const d of await j('/api/decks')) if (d.id !== deck.id && d.format === deck.format && !d.deleted) add({ key: 'lib:' + d.id, id: d.id, name: d.name, source: 'mine', main: d.main, commanders: d.commanders || [] })
    })
    if (fmt.cmd && cmds.length) {
      job(async () => {  // o deck médio do EDHREC do teu comandante (com parceiro: tenta as duas ordens)
        const slugs = cmds.length > 1 ? [cmds.map(edhSlug).join('-'), [...cmds].reverse().map(edhSlug).join('-')] : [edhSlug(cmds[0])]
        for (const s of slugs) {
          const r = await once('edhrec:' + s, () => j(`/api/sim/opponents/edhrec-${s}`))
          if (r) { add({ key: 'edhrec:' + s, name: r.name, source: 'edhrec', url: r.url, main: r.main, commanders: r.commanders || [] }); break }
        }
      })
      job(async () => {  // decks públicos do Archidekt com o mesmo comandante (os mais vistos)
        const r = await once('arch:' + cmds[0], () => j(`/api/search/decks?card=${encodeURIComponent(cmds[0])}&format=${encodeURIComponent(deck.format)}`))
        for (const d of (r?.decks || []).slice(0, 6)) { if (off) break; add({ key: d.url, ...(await fromImport(data, d.url, 'archidekt')), source: 'archidekt', owner: d.owner }) }
      })
    }
    job(async () => {  // as listas de torneio do formato (MTGTop8) ou os decks médios dos comandantes mais jogados
      const l = await once('meta:' + deck.format, () => j(`/api/sim/opponents?format=${encodeURIComponent(deck.format)}`))
      for (const o of l || []) {
        if (off) break
        const r = await once('opp:' + o.id, () => j(`/api/sim/opponents/${encodeURIComponent(o.id)}`))
        if (r) add({ key: 'opp:' + o.id, name: r.name, source: o.source === 'EDHREC' ? 'edhrec' : 'meta', url: r.url, main: r.main, commanders: r.commanders || [], share: o.share })
      }
    })
    return () => { off = true }
  }, [open, data, deck.id, deck.format, fmt.cmd, cmds])

  const ranked = useMemo(() => cands.map(x => { const s = cardSet(data, x.main, x.commanders); const l = likeness(mine, s, cmds, x.commanders); return { ...x, set: s, l, lv: likeLabel(l) } })
    .sort((a, b) => (b.l.sameCmd - a.l.sameCmd) || (b.l.pct - a.l.pct)), [cands, data, mine, cmds])
  const good = ranked.filter(x => x.lv !== 'pouco'), far = ranked.filter(x => x.lv === 'pouco')
  const cur = sel && ranked.find(x => x.key === sel)

  const fromUrl = async () => {
    setErr('')
    const u = url.trim()
    if (!/^https?:\/\//.test(u)) return setErr(tx('Cola o link de um deck (Archidekt, Moxfield, TappedOut, MTGGoldfish, MTGTop8…).'))
    setLoading(n => n + 1)
    LISTS.delete(u)
    const r = await fromImport(data, u, null)
    setLoading(n => n - 1)
    if (!r || !Object.keys(r.main).length) return setErr(tx('Não consegui ler esse deck. Se for privado ou o site bloquear, copia a lista no site e usa «Importar».'))
    setCands(l => [...l.filter(y => y.key !== u), { key: u, ...r, source: 'link' }]); setSel(u); setUrl('')
  }

  return (
    <div className={`prefs cutp cmpx ${open ? 'on' : ''}`}>
      <button className="prefs-head" onClick={() => setOpen(!open)}>
        <span>🔍 {tx('Comparar com outros decks')}</span><small className="muted">{tx('decks parecidos, meta ou qualquer link: o que têm a mais e a menos, e trocas')}</small>
      </button>
      {open && (
        <div className="cutp-body">
          <div className="cmpx-url">
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && fromUrl()} placeholder={tx('Link de um deck (Archidekt, Moxfield, TappedOut, MTGGoldfish, MTGTop8…)')} />
            <button className="primary small" onClick={fromUrl} disabled={!url.trim()}>{tx('Comparar')}</button>
          </div>
          {err && <p className="bad-t small">{err}</p>}
          {!cur && <>
            <p className="muted small">{tx('Os mais parecidos primeiro (cartas em comum contigo). Comparar com um deck nada parecido diz pouco.')}{loading > 0 && ` · ${tx('a procurar…')}`}</p>
            <ul className="cmpx-list">{[...good, ...(weak ? far : [])].map(x => (
              <li key={x.key}><button className="cmpx-row" onClick={() => { setSel(x.key); setDone(new Set()) }}>
                <span className={`cmpx-like ${x.lv}`}>{Math.round(x.l.pct * 100)}%</span>
                <span className="cmpx-name"><b>{x.name}</b><small className="muted">{SRC[x.source]}{x.owner ? ` · ${x.owner}` : ''}{x.l.sameCmd ? ` · ${tx('mesmo comandante')}` : ''} · {LIKE[x.lv]} · {tx('{n} cartas em comum', { n: x.l.shared })}</small></span>
                <span className="cmpx-go">{tx('Comparar')} ›</span>
              </button></li>
            ))}</ul>
            {!good.length && !loading && <p className="muted small">{tx('Nenhum deck parecido encontrado. Cola o link de um que conheças.')}</p>}
            {far.length > 0 && <button className="link small" onClick={() => setWeak(w => !w)}>{weak ? tx('esconder os pouco parecidos') : tx('mostrar {n} pouco parecidos', { n: far.length })}</button>}
          </>}
          {cur && <CompareOne {...{ data, deck, fmt, ctx, act, rq, recs, needs, co, cmdIdx, meta, archetype, x: cur, done, setDone, back: () => setSel(null) }} />}
        </div>
      )}
    </div>
  )
}

function CompareOne({ data, deck, fmt, ctx, act, rq, recs, needs, co, cmdIdx, meta, archetype, x, done, setDone, back }) {
  const A = useMemo(() => profile(data, deck.main, deck.commanders), [data, deck])
  const B = useMemo(() => profile(data, x.main, x.commanders), [data, x])
  const N = useMemo(() => manaNeeds(data, deck, fmt), [data, deck, fmt])
  const scale = B.total && Math.abs(B.total - A.total) > 0.1 * A.total ? A.total / B.total : 1  // tamanhos diferentes: à escala do teu
  const tips = useMemo(() => compareTips(A, B, { needs, targets: fmt.targets || {}, N, scale }), [A, B, needs, fmt, N, scale])
  const queue = useMemo(() => cutQueue(data, deck, { ctx, co, commanders: cmdIdx, needs, recs, meta, archetype }), [data, deck, ctx, co, cmdIdx, needs, recs, meta, archetype])
  const st = rq?.prefs?.staples !== false
  const more = useMemo(() => Object.fromEntries(Object.keys(B.tags).map(t => [t, Math.round(B.tags[t] * scale) - (A.tags[t] || 0)])), [A, B, scale])
  const plan = useMemo(() => comparePlan(data, deck, x.set, { ctx, needs, queue, more, roleQ: c => roleQuality({ c, score: 0, parts: {} }, st, !!fmt.cmd) }), [data, deck, x.set, ctx, needs, queue, more, st, fmt.cmd])
  const total = Object.values(deck.main).reduce((a, q) => a + q, 0) + deck.commanders.length, under = total < fmt.size[0]
  const mark = k => setDone(s => new Set(s).add(k))
  const Card = ({ c, sign }) => (
    <button className={`cutp-card ${sign > 0 ? 'in' : ''}`} onClick={() => { if (sign < 0) pin([{ n: c.n, tone: 'out' }]); act.open(c) }}>
      <img src={img(c, 'art_crop', false, sign < 0 ? pidOf(deck, c.n) : undefined)} alt="" loading="lazy" /><span><b>{sign > 0 ? '+' : '−'} {c.n}</b><Mana cost={c.mc} /></span></button>
  )
  const askAI = () => act.ai?.({
    mode: 'sugerir',
    q: tx('Compara o meu deck com «{n}» ({p}% das minhas cartas em comum): que funções, mecânicas e sinergias dele me fazem falta ou estão a mais, e propõe trocas a partir das cartas dele.', { n: x.name, p: Math.round(x.l.pct * 100) }),
    compare: `${x.name}${x.url ? ` (${x.url})` : ''}\n${x.commanders.map(n => `Comandante: ${n}`).join('\n')}\n${Object.entries(x.main).map(([n, q]) => `${q} ${n}`).join('\n')}`,
  })
  return (
    <div className="cmpx-one">
      <div className="cmpx-head">
        <button className="link small" onClick={back}>‹ {tx('outros decks')}</button>
        <h4>{x.name} <span className={`cmpx-like ${x.lv}`}>{Math.round(x.l.pct * 100)}%</span></h4>
        <small className="muted">{SRC[x.source]}{x.url && <> · <a href={x.url} target="_blank" rel="noreferrer">{tx('abrir')} ↗</a></>} · {tx('{n} cartas em comum', { n: x.l.shared })}{scale !== 1 ? ` · ${tx('números à escala do teu deck')}` : ''}</small>
        {x.lv === 'pouco' && <p className="small bad-t">{tx('Este deck é pouco parecido com o teu: as diferenças dizem mais sobre o estilo dele do que sobre o que te falta.')}</p>}
      </div>
      <table className="cmpx-tab"><thead><tr><th></th><th>{tx('O teu')}</th><th>{tx('Ele')}</th></tr></thead><tbody>
        {[[tx('Terrenos'), A.lands, Math.round(B.lands * scale)], [tx('MV médio'), A.avgMv.toFixed(2), B.avgMv.toFixed(2)], [tx('Instantâneos'), A.inst, Math.round(B.inst * scale)], [tx('Respostas instantâneas'), A.instRemoval, Math.round(B.instRemoval * scale)]]
          .map(([l, a, b]) => <tr key={l}><td>{l}</td><td>{a}</td><td className={+b > +a ? 'pos' : +b < +a ? 'neg' : ''}>{b}</td></tr>)}
      </tbody></table>
      {tips.length ? <ul className="cmpx-tips">{tips.map(t => <li key={t.k} className={t.syn ? 'syn' : t.good === true ? 'good' : t.good === false ? 'warn' : ''}>{t.syn ? '🔗 ' : t.good === true ? '✓ ' : t.good === false ? '! ' : '• '}{t.txt}</li>)}</ul>
        : <p className="muted small">{tx('Nas funções e mecânicas os dois decks estão equilibrados.')}</p>}
      <div className="row-btns"><button className="small" onClick={askAI}>✦ {tx('Pedir à IA uma comparação')}</button></div>
      {plan.swaps.length > 0 && <>
        <h4>{tx('Cartas dele que te podem servir')}</h4>
        <ul className="cutp-list">{plan.swaps.map(({ add: a, cut }) => { const k = 's:' + a.c.n; return (
          <li key={a.c.n} {...hlProps([{ n: a.c.n, tone: 'in' }, ...(cut ? [{ n: cut.c.n, tone: 'out' }] : [])])}>
            <div className="cutp-pair"><Card c={a.c} sign={1} /><span className="cutp-arrow">⇄</span>{cut ? <Card c={cut.c} sign={-1} /> : <span className="muted small">{tx('nada sai: o deck tem lugar')}</span>}</div>
            {(a.fills.length > 0 || cut) && <div className="rfz-why"><ul className="why">
              {a.fills.length > 0 && <li className="tema">{tx('Dá o que te falta: {t}', { t: a.fills.map(t => (TAG_LABEL[t] || t).toLowerCase()).join(', ') })}</li>}
              {cut?.why.map((w, i) => <li key={i} className="falta">{w}</li>)}</ul></div>}
            <div className="row-btns">{done.has(k) ? <span className="good-t small">✓ {tx('feito')}</span> : <>
              {cut && <button className="primary small" onClick={() => { act.swap(a.c, { out: cut.c.n, q: 1 }); mark(k) }}>⇄ {tx('Trocar')}</button>}
              {(under || !cut) && <button className={`small ${cut ? '' : 'primary'}`} onClick={() => { act.add(a.c, 'main', 1); mark(k) }}>＋ {cut ? tx('Só juntar') : tx('Juntar')}</button>}
              <button className="small" onClick={() => { act.add(a.c, 'maybe', 1); mark(k) }}>{tx('Talvez')}</button></>}
            </div>
          </li>) })}</ul>
        {plan.more > 0 && <p className="muted small">{tx('Mais {n} cartas dele que podias jogar: abre o deck para as ver todas.', { n: plan.more })}</p>}
      </>}
      {plan.cuts.length > 0 && <>
        <h4>{tx('As tuas que ele não joga (das mais fracas)')}</h4>
        <ul className="sz-list">{plan.cuts.map(y => { const k = 'c:' + y.c.n; return (
          <li key={y.c.n} {...hlProps([{ n: y.c.n, tone: 'out' }])}><button className="link plain" onClick={() => act.open(y.c)}>{y.c.n}</button> <span className="muted small">{y.why[0]}</span>
            {done.has(k) ? <span className="good-t small">✓</span> : <button className="small" onClick={() => { act.add(y.c, 'main', -(deck.main[y.c.n] || 1)); mark(k) }}>{tx('tirar')}</button>}</li>) })}</ul>
      </>}
    </div>
  )
}
