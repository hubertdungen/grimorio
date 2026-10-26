// Modo Draft/Selado: ratings públicos do 17lands (gratuitos, só o set em curso tem números)
// e heurística quando não há dados. Ordena o pack com o porquê e monta o deck de 40.
import { useEffect, useMemo, useState } from 'react'
import { img } from './data.js'
import { parseList } from './deck.js'
import { Mana, Empty } from './ui.jsx'
import { tx, num } from './i18n.js'

const ratingsCache = new Map()
export async function loadSet(code) {
  if (!ratingsCache.has(code)) {
    ratingsCache.set(code, fetch(`/api/l17/ratings/${code}`).then(r => r.json()).catch(() => []))
  }
  return ratingsCache.get(code)
}

const RAR = { m: 0.9, r: 0.7, u: 0.35, c: 0.15 }
const COLS = 'WUBRG'
const BASIC = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }

// Valor de uma carta no limitado: taxa de vitória (z-score no set) ou heurística.
function score(c, r, stats) {
  if (r?.gih != null && stats.sd) return { z: (r.gih - stats.mean) / stats.sd, real: true }
  let h = RAR[c.r] ?? 0.2
  if (c.tg.includes('removal')) h += 0.5
  if (c.tg.includes('evasion')) h += 0.2
  if (c.tg.includes('draw')) h += 0.1
  if (c.mt === 'Creature' && c.cmc >= 2 && c.cmc <= 4) h += 0.1
  if (c.mt === 'Land') h -= 0.4
  return { z: (h - 0.45) * 2, real: false }
}

export default function DraftView({ data, setDeck, act }) {
  const [sets, setSets] = useState([])
  const [code, setCode] = useState(() => { try { return localStorage.getItem('grimorio.draftSet') || '' } catch { return '' } })
  const [rows, setRows] = useState(null)
  const [pack, setPack] = useState([])
  const [picks, setPicks] = useState([])
  const [q, setQ] = useState('')
  const [pool, setPool] = useState('')

  useEffect(() => { fetch('/api/l17/expansions').then(r => r.json()).then(s => { const real = s.filter(x => /^[A-Z0-9]{3,4}$/.test(x)); setSets(real); if (!code) setCode(real[0]) }).catch(() => setSets([])) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!code) return
    try { localStorage.setItem('grimorio.draftSet', code) } catch { /* sem storage */ }
    setRows(null)
    loadSet(code).then(d => setRows(d.map(x => ({ c: data.byName.get(x.name) || data.byLower.get(x.name.toLowerCase()) || data.byLower.get(x.name.split(' // ')[0].toLowerCase()), gih: x.ever_drawn_win_rate, alsa: x.avg_seen, ata: x.avg_pick, games: x.game_count })).filter(x => x.c)))
  }, [code, data])

  const stats = useMemo(() => {
    const v = (rows || []).filter(r => r.gih != null && r.games > 200).map(r => r.gih)
    if (!v.length) return { mean: 0, sd: 0, n: 0 }
    const mean = v.reduce((a, b) => a + b, 0) / v.length
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)
    return { mean, sd, n: v.length, sorted: [...v].sort((a, b) => b - a) }
  }, [rows])
  const byName = useMemo(() => new Map((rows || []).map(r => [r.c.n, r])), [rows])
  const val = c => score(c, byName.get(c.n), stats)

  // cores do pool: soma do valor positivo das melhores cartas de cada cor
  const colorScore = useMemo(() => {
    const s = Object.fromEntries([...COLS].map(k => [k, 0]))
    for (const c of picks) for (const k of c.co || '') s[k] += Math.max(0, val(c).z + 1)
    return s
  }, [picks, byName, stats]) // eslint-disable-line react-hooks/exhaustive-deps
  const main = Object.entries(colorScore).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0).slice(0, 2).map(([k]) => k)
  const commit = Math.min(1, picks.length / 15)
  const curve = useMemo(() => { const cv = [0, 0, 0, 0, 0, 0]; for (const c of picks) if (c.mt !== 'Land') cv[Math.min(5, Math.max(0, Math.floor(c.cmc) - 1))]++; return cv }, [picks])
  const removalN = picks.filter(c => c.tg.includes('removal')).length

  const rank = useMemo(() => pack.map(c => {
    const r = byName.get(c.n), v = val(c)
    const why = []
    let s = v.z
    if (v.real) {
      const pos = stats.sorted.findIndex(x => x <= r.gih)
      why.push({ k: 'edh', txt: tx('{p}% de vitórias quando jogada (top {top}% do set)', { p: num(r.gih * 100, 1), top: Math.max(1, Math.round(((pos + 1) / stats.n) * 100)) }) })
      if (r.alsa) why.push({ k: 'meta', txt: tx('Costuma ser vista até à escolha {x}', { x: num(r.alsa, 1) }) })
    } else why.push({ k: 'perto', txt: tx('Sem dados do 17lands: avaliação heurística (raridade, remoção, evasão, curva)') })
    const cols = (c.co || '').split('').filter(Boolean)
    if (main.length && cols.length) {
      const fit = cols.every(k => main.includes(k))
      s += fit ? 0.4 * commit : -0.6 * commit
      why.push({ k: fit ? 'inter' : 'falta', txt: tx(fit ? 'Nas tuas cores ({c})' : 'Fora das tuas cores ({c})', { c: main.join('/') }) })
    } else if (!cols.length) { s += 0.1; why.push({ k: 'tema', txt: tx('Incolor: entra em qualquer deck') }) }
    if (c.tg.includes('removal') && removalN < 4) { s += 0.25; why.push({ k: 'falta', txt: tx('Remoção: tens {n}', { n: removalN }) }) }
    if (c.mt !== 'Land' && c.cmc <= 2 && curve[0] + curve[1] < picks.length * 0.3 && picks.length >= 8) { s += 0.15; why.push({ k: 'falta', txt: tx('Curva: faltam cartas baratas') }) }
    return { c, s, why }
  }).sort((a, b) => b.s - a.s), [pack, byName, stats, main, commit, removalN, curve, picks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const setCards = useMemo(() => (rows || []).filter(r => !q || r.c.l.includes(q.toLowerCase())).sort((a, b) => (b.gih ?? 0) - (a.gih ?? 0)).slice(0, 60), [rows, q])
  const pick = c => { setPicks(p => [...p, c]); setPack([]) }

  // Deck de 40: melhor par de cores pelas 23 melhores cartas jogáveis, 17 terrenos pelos símbolos.
  const build = () => {
    let best = null
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
      const pair = COLS[a] + COLS[b]
      const ok = picks.filter(c => c.mt !== 'Land' && [...(c.co || '')].every(k => pair.includes(k)))
        .map(c => ({ c, z: val(c).z })).sort((x, y) => y.z - x.z).slice(0, 23)
      const tot = ok.reduce((s, x) => s + x.z, 0) + ok.length * 0.5
      if (!best || tot > best.tot) best = { pair, ok, tot }
    }
    if (!best) return
    const main = {}
    for (const { c } of best.ok) main[c.n] = (main[c.n] || 0) + 1
    const pips = { [best.pair[0]]: 0, [best.pair[1]]: 0 }
    for (const { c } of best.ok) for (const m of (c.mc || '').matchAll(/\{([^}]+)\}/g)) for (const ch of m[1]) if (ch in pips) pips[ch]++
    const tot = pips[best.pair[0]] + pips[best.pair[1]] || 2
    const lands = Math.max(17, 40 - best.ok.length) // poucos jogáveis nas cores: completa com terrenos até 40
    const nA = Math.round(lands * pips[best.pair[0]] / tot) || Math.floor(lands / 2)
    main[BASIC[best.pair[0]]] = nA
    main[BASIC[best.pair[1]]] = lands - nA
    setDeck(d => ({ ...d, format: 'limited', name: ['Deck sem nome', tx('Deck sem nome')].includes(d.name) ? `Draft ${code} ${best.pair}` : d.name, commanders: [], main, side: {} }))
    act.say(tx('Deck de 40 em {pair}: {k} feitiços + {lands} terrenos', { pair: best.pair, k: best.ok.length, lands }) + (best.ok.length < 23 ? tx(' (só {k} jogáveis nestas cores)', { k: best.ok.length }) : '') + '.')
  }
  const loadPool = () => {
    const p = parseList(pool, data)
    setPicks(Object.entries(p.main).flatMap(([n, q]) => Array(q).fill(data.byName.get(n))).filter(Boolean))
    setPool('')
  }

  return (
    <div className="view draft">
      <div className="draft-top">
        <label className="fmt"><span>Set (17lands)</span>
          <select value={code} onChange={e => { setCode(e.target.value); setPack([]) }}>{sets.map(s => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <p className="small muted">{rows == null ? tx('A carregar o set…') : stats.n ? tx('{n} cartas com taxa de vitória (média {p}%), dados públicos do 17lands.', { n: stats.n, p: num(stats.mean * 100, 1) }) : tx('Este set não tem números públicos no 17lands: uso uma avaliação heurística.')}</p>
      </div>

      <div className="draft-grid">
        <section className="card">
          <h3>{tx('Pack atual')} <span className="muted small">{tx('{n} carta|{n} cartas', { n: pack.length })}</span></h3>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar no set para juntar ao pack…')} />
          <div className="draft-set">{setCards.map(r => (
            <button key={r.c.i} onClick={() => setPack(p => [...p, r.c])} title={r.c.n}><img src={img(r.c, 'small')} alt={r.c.n} loading="lazy" /></button>
          ))}</div>
          {rank.length ? <ol className="draft-rank">{rank.map(({ c, why }, k) => (
            <li key={`${c.i}-${k}`}>
              <img src={img(c, 'art_crop')} alt="" />
              <div><b>{c.n}</b> <Mana cost={c.mc} /><ul className="why">{why.map((w, j) => <li key={j} className={w.k}>{w.txt}</li>)}</ul></div>
              <button className={k === 0 ? 'primary' : ''} onClick={() => pick(c)}>{tx('Escolher')}</button>
            </li>
          ))}</ol> : <Empty>{tx('Clica nas cartas do set que estão no teu pack; o Grimório ordena-as e diz porquê.')}</Empty>}
          {pack.length > 0 && <button className="link small" onClick={() => setPack([])}>{tx('limpar pack')}</button>}
        </section>

        <section className="card">
          <h3>{tx('Os teus picks')} <span className="muted small">{picks.length}</span></h3>
          {main.length > 0 && <p className="small">{tx('Cores principais:')} <b>{main.join(' / ')}</b> <span className="muted">({Object.entries(colorScore).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${num(v, 1)}`).join(', ')})</span></p>}
          <p className="small muted">{tx('Curva (MV 1–6+): {c} · remoção: {n}', { c: curve.join(' · '), n: removalN })}</p>
          <div className="draft-picks">{picks.map((c, k) => <img key={k} src={img(c, 'small')} alt={c.n} title={c.n} onClick={() => act.open(c)} />)}</div>
          <div className="row-btns">
            <button className="primary" onClick={build} disabled={picks.length < 20}>{tx('Montar deck de 40')}</button>
            {picks.length > 0 && <button onClick={() => setPicks([])}>{tx('Recomeçar')}</button>}
          </div>
          <h4>{tx('Selado: colar o pool')}</h4>
          <textarea value={pool} onChange={e => setPool(e.target.value)} placeholder={'1 Card Name\n1 Other Card\n…'} />
          <button onClick={loadPool} disabled={!pool.trim()}>{tx('Usar como pool')}</button>
        </section>
      </div>
    </div>
  )
}
