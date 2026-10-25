// 📖 Regras: pesquisar keywords, regras ou cartas em qualquer língua (📷 também lê a carta) e ver tudo — as regras
// oficiais (rules.py, Comprehensive Rules), o texto da carta com cada keyword ligada à sua regra, os rulings oficiais
// (Scryfall) e, se quiseres, a explicação da IA em português.
import { useEffect, useMemo, useState } from 'react'
import { img } from './data.js'
import { Mana } from './ui.jsx'
import CardScan from './CardScan.jsx'
import { tx } from './i18n.js'

async function j(url, opts) {
  const r = await fetch(url, opts), d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || d.details || `HTTP ${r.status}`))
  return d
}
// keywords que aparecem no texto de uma carta (as do glossário/regras), para as ligar
const KW = /\b(Flying|Trample|Deathtouch|Lifelink|Haste|Vigilance|First strike|Double strike|Reach|Hexproof|Indestructible|Flash|Menace|Defender|Ward|Protection|Equip|Enchant|Scry|Mill|Cycling|Flashback|Kicker|Prowess|Convoke|Cascade|Delve|Crew|Surveil|Shroud|Persist|Undying|Storm|Affinity|Dredge|Madness|Morph|Evoke|Infect|Proliferate|Transform|Explore|Adapt|Ninjutsu|Toxic|Landfall|Treasure|Food|Clue|Monarch|Initiative|Mutate|Foretell|Disturb|Training|Connive|Blitz|Casualty|Bargain|Craft|Discover|Offspring|Gift)\b/g

export default function Rules({ data, initial = '' }) {
  const [q, setQ] = useState(initial), [res, setRes] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [card, setCard] = useState(null), [rulings, setRulings] = useState(null), [scan, setScan] = useState(false), [ai, setAi] = useState(null), [aiBusy, setAiBusy] = useState(false)
  const local = useMemo(() => {  // cartas pelo nome (inglês), localmente
    const n = q.trim().toLowerCase()
    if (n.length < 3) return []
    const exact = data.byLower.get(n)
    return exact ? [exact] : data.cards.filter(c => c.l.startsWith(n)).slice(0, 6)
  }, [q, data])
  const go = async (term = q) => {
    const t = term.trim()
    if (!t) return
    setBusy(true); setErr(''); setAi(null); setQ(t)
    try {
      const r = await j(`/api/rules?q=${encodeURIComponent(t)}`)
      let cards = []
      const ex = data.byLower.get(t.toLowerCase())
      if (ex) cards = [ex]
      else if (navigator.onLine) {  // nome noutra língua: o Scryfall procura nos nomes impressos (lang:any)
        const s = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(t)}+lang%3Aany&unique=cards&order=edhrec`).then(x => (x.ok ? x.json() : null)).catch(() => null)
        cards = (s?.data || []).map(x => data.byName.get(x.name) || data.byLower.get(String(x.name).toLowerCase())).filter(Boolean).slice(0, 6)
      }
      setRes({ ...r, cards })
      if (cards.length === 1 && !r.results.length) openCard(cards[0])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const openCard = async c => {
    setCard(c); setRulings(null)
    const s = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(c.n)}`).then(x => (x.ok ? x.json() : null)).catch(() => null)
    const r = s?.rulings_uri ? await fetch(s.rulings_uri).then(x => (x.ok ? x.json() : null)).catch(() => null) : null
    setRulings(r?.data || [])
  }
  const askAI = async () => {
    setAiBusy(true); setErr('')
    try {
      const ctx = { lista: [card && `${card.n}: ${card.t} — ${card.o}`, ...(res?.results || []).slice(0, 6).map(x => x.kind === 'gloss' ? `${x.term}: ${x.text}` : x.kind === 'rule' ? `${x.num} ${x.title}: ${x.rules.map(([n, t]) => `${n} ${t}`).join(' ')}` : `${x.num} ${x.text}`)].filter(Boolean).join('\n') }
      setAi(await j('/api/ia/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'regras', question: q || card?.n, context: ctx }) }))
    } catch (e) { setErr(e.message) } finally { setAiBusy(false) }
  }
  useEffect(() => { if (initial) go(initial) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const linkKw = text => String(text || '').split(KW).map((part, k) => (k % 2 ? <button key={k} className="link plain kw" onClick={() => go(part)}>{part}</button> : part))
  return (
    <div className="view rules-v">
      <section className="card">
        <h3>📖 {tx('Regras e dúvidas')} <span className="muted small">{tx('keywords, regras ou cartas, em qualquer língua')}</span></h3>
        <form className="rules-bar" onSubmit={e => { e.preventDefault(); go() }}>
          <input className="big" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Ex.: atropelar, toque mortífero, 702.19b, pilha, «Lightning Bolt», «Relâmpago»…')} list="rules-cards" />
          <datalist id="rules-cards">{local.map(c => <option key={c.n} value={c.n} />)}</datalist>
          <button className="primary" disabled={busy}>{busy ? tx('a procurar…') : tx('Procurar')}</button>
          <button type="button" onClick={() => setScan(true)} title={tx('Ler uma carta pela câmara ou por uma foto')}>📷</button>
        </form>
        {err && <p className="small bad-t">{err}</p>}
        {res?.translated && <p className="small muted">{tx('«{q}» é «{e}» nas regras (em inglês).', { q, e: res.translated })}</p>}
      </section>
      {card && <section className="card rules-card">
        <img src={img(card, 'normal')} alt={card.n} />
        <div>
          <h3>{card.n} <Mana cost={card.mc} /></h3>
          <p className="muted small">{card.t}{card.pt ? ` · ${card.pt}` : ''}</p>
          <p className="rules-oracle">{linkKw(card.o)}</p>
          <h4>{tx('Rulings oficiais')}</h4>
          {rulings == null ? <p className="small muted">{tx('a carregar…')}</p> : !rulings.length ? <p className="small muted">{tx('Sem rulings para esta carta.')}</p>
            : <ul className="rulings">{rulings.map((r, k) => <li key={k}><small className="muted">{r.published_at}</small> {r.comment}</li>)}</ul>}
        </div>
      </section>}
      {res && <section className="card">
        {res.cards?.length > 0 && <div className="rules-cards">{res.cards.map(c => <button key={c.n} className={`rules-cc ${card === c ? 'on' : ''}`} onClick={() => openCard(c)}><img src={img(c, 'art_crop')} alt="" loading="lazy" /><span>{c.n}</span></button>)}</div>}
        {!res.results.length && !res.cards?.length && <p className="muted">{tx('Não encontrei nada com «{q}». Experimenta outra palavra ou pergunta à IA.', { q })}</p>}
        <ul className="rules-list">{res.results.map((x, k) => (
          <li key={k}>
            {x.kind === 'gloss' ? <><b>{x.term}</b> <span className="muted small">{tx('glossário')}</span><p>{x.text}</p>{x.refs.map(n => <button key={n} className="link small" onClick={() => go(n)}>→ {n}</button>)}</>
              : x.kind === 'rule' ? <><b>{x.num} {x.title}</b><ul className="rules-sub">{x.rules.map(([n, t]) => <li key={n}><code>{n}</code> {t}</li>)}</ul></>
                : <><code>{x.num}</code> {x.text}</>}
          </li>))}</ul>
        <div className="row-btns"><button onClick={askAI} disabled={aiBusy}>{aiBusy ? tx('A pensar…') : `✦ ${tx('Explicar com a IA')}`}</button><span className="small muted">{tx('Usa as regras encontradas e cita os números.')}</span></div>
        {ai?.resumo && <div className="rules-ai">{ai.resumo.split(/\n+/).map((p, k) => <p key={k}>{p}</p>)}<small className="muted">{ai.modelo}</small></div>}
      </section>}
      {scan && <CardScan data={data} onPick={c => { setScan(false); setQ(c.n); go(c.n); openCard(c) }} onClose={() => setScan(false)} />}
    </div>
  )
}
