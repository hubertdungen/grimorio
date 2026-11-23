// ✨ Alter arts em lote: as definições uma vez (quem gera, modo, toque pessoal, referências de estilo), o custo antes de
// começar, a fila com pausa/retoma/cancelar e nova tentativa, e os resultados por carta (Usar / Outra vez / Saltar).
// No ChatGPT (sem API): um ZIP com uma pasta por carta (prompt.txt + imagens) e «colar resultados», ou carta a carta.
// A fila e os resultados ficam no IndexedDB deste aparelho: recarregar a página não perde imagens já pagas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx, num } from './i18n.js'
import { img } from './data.js'
import { useBackClose } from './backnav.js'
import { ask } from './confirm.jsx'
import { artBox, basePrompt, finalPrompt, costOf, bitmap, rememberAlter, pickRecipe } from './alterart.js'
import { batchCards, batchCost, newJob, reduce, nextStarts, nextWake, finished, revive, matchFiles, fileName, jobGet, jobPut, jobDel } from './alterbatch.js'
import { genCard, finishOut, masks, post, fetchable, copyText, useEnlarge, PROV, Dpi } from './AlterArt.jsx'
import { makeZip } from './zip.js'

const lsGet = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } }
const ST = () => ({ wait: tx('na fila'), run: tx('a gerar…'), ok: tx('pronta'), err: tx('erro'), skip: tx('saltada'), used: tx('✓ usada') })

// impressões da Scryfall (moldura e texto de ambiente) de várias cartas num pedido; sem rede: {} (moldura moderna)
async function fetchPrints(cards, deck) {
  const out = {}
  for (let i = 0; i < cards.length; i += 75) {
    const part = cards.slice(i, i + 75)
    try {
      const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identifiers: part.map(c => ({ id: deck.prints?.[c.n]?.id || c.id })) }) })
      const j = r.ok ? await r.json() : {}
      for (const p of j.data || []) { const c = part.find(x => x.id === p.id || deck.prints?.[x.n]?.id === p.id || x.n === p.name); if (c) out[c.n] = p }
    } catch { /* sem rede: só os dados locais */ }
  }
  return out
}

export default function AlterBatch({ names: picked, deck, data, act, onClose }) {
  useBackClose(true, onClose)
  const key = `deck:${deck.id || deck.name}`
  const [cfg, setCfg] = useState(null), [job, setJob] = useState(null), [resumed, setResumed] = useState(false)
  const [filt, setFilt] = useState({ nobasics: true }), [q, setQ] = useState(''), [loose, setLoose] = useState([]), [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(() => new Set()), [tick, setTick] = useState(0)
  const [enlarge, enlView] = useEnlarge()
  const dispatch = a => setJob(j => reduce(j, a))
  // o diálogo pode fechar-se a meio: o que ainda chega (já pago) vai direto para o lote guardado
  // ponytail: se o lote for reaberto antes de a imagem chegar, a nova janela não a vê (fica a carta de novo na fila)
  const alive = useRef(true)
  const apply = a => (alive.current ? dispatch(a) : jobGet(key).then(j => j && jobPut(key, reduce(j, a))))
  const jobRef = useRef(job); jobRef.current = job
  const urls = useRef(new WeakMap()).current
  const urlOf = b => { let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u) } return u }
  const cands = useMemo(() => (picked ? picked.map(n => data.byName.get(n)).filter(Boolean) : batchCards(deck, data, filt)), [picked, deck, data, filt])
  const prs = useRef(null)
  const prints = () => (prs.current ??= fetchPrints(jobRef.current.items.map(x => data.byName.get(x.n)).filter(Boolean), deck))

  useEffect(() => {  // um lote guardado deste deck volta como estava (em pausa); senão, um lote novo por começar
    fetch('/api/ia/image').then(r => r.json()).then(setCfg).catch(() => setCfg({ providers: [], local: {} }))
    jobGet(key).then(j => {
      const keep = j?.items?.length && !(finished(j) && !j.items.some(x => x.status === 'ok' && x.results.length))  // acabado e sem nada por escolher: começa outro
      if (keep) { setResumed(true); setJob(revive(j)) } else setJob(newJob([], { prov: lsGet('grimorio.alter.prov') || 'chatgpt', mode: 'frame', custom: '', refs: [], styleFirst: false, n: 1, conc: 1, quality: 'medium', up2: false, orig: false }))
    })
  }, [key])
  const started = !!job?.started
  useEffect(() => {  // por começar: a lista segue a seleção e os filtros (fica o texto de cada carta)
    if (!job || started) return
    setJob(j => ({ ...j, items: cands.map(c => j.items.find(x => x.n === c.n) || newJob([c.n]).items[0]) }))
  }, [cands, started, !job]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { alive.current = false; if (jobRef.current?.started) jobPut(key, jobRef.current) }, [key])
  useEffect(() => {  // gravar (um pouco depois de cada mudança)
    if (!started) return
    const t = setTimeout(() => jobPut(key, job), 400)
    return () => clearTimeout(t)
  }, [job, started, key])

  const S = job?.settings || {}, P = cfg?.providers?.find(p => p.id === S.prov)
  const gpt = S.prov === 'chatgpt', ready = gpt || !!P?.hasKey
  const setS = v => { dispatch({ t: 'settings', v }); if (v.prov) lsSet('grimorio.alter.prov', v.prov) }
  const model = lsGet(`grimorio.alter.model.${S.prov}`)
  const per = costOf(P?.cost, S.quality, 1), live = job?.items.filter(x => !['skip', 'used'].includes(x.status)) || []
  const total = batchCost(per, (started ? job.items.filter(x => ['wait', 'run'].includes(x.status)) : live).length, S.n || 1)

  // o pedido de uma carta (o mesmo do diálogo de uma carta, com as definições do lote)
  const plan = (c, pr, it, j = jobRef.current) => {
    const s = j.settings, pid = deck.prints?.[c.n]?.id || null, box = artBox(c, pr)
    const mode = s.mode === 'frame' && box ? 'frame' : 'art', orig = mode === 'art' && s.orig
    const refs = [...(s.styleFirst && j.styleRef && !gpt ? [j.styleRef] : []), ...s.refs.map(r => r.src)].slice(0, orig ? 3 : 4)
    const prompt = finalPrompt({ base: basePrompt(c, pr), custom: it.custom.trim() || s.custom, mode, masked: mode === 'frame' && masks(s.prov), aspect: 'card', refs: refs.length, orig })
    let cardP = null
    return { c, pid, box, mode, aspect: 'card', orig, refs, prompt, card: () => (cardP ??= bitmap(img(c, 'png', false, pid))) }
  }
  const runOne = async k => {
    const j = jobRef.current, it = j.items[k], c = data.byName.get(it.n)
    try {
      const pl = plan(c, (await prints())[c.n], it, j)
      const r = await genCard({ ...pl, prov: j.settings.prov, localKind: cfg?.local?.kind, n: j.settings.n, quality: j.settings.quality, model })
      apply({ t: 'ok', k, results: r.images, cost: r.cost })
    } catch (e) { apply({ t: 'fail', k, err: e.message, now: Date.now() }) }
  }
  useEffect(() => {  // a fila anda: arranca o que pode; se só há quem espere pelo limite de pedidos, volta a olhar depois
    if (!job || gpt) return
    const now = Date.now(), ks = nextStarts(job, now)
    for (const k of ks) { dispatch({ t: 'run', k }); runOne(k) }
    const w = !ks.length && nextWake(job, now)
    if (w) { const t = setTimeout(() => setTick(x => x + 1), w - now + 50); return () => clearTimeout(t) }
  }, [job, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const begin = () => setJob(j => reduce({ ...j, started: true }, { t: 'start' }))
  const chain = useRef(Promise.resolve())
  const use = (k, r) => {  // guarda como imagem própria da carta (um de cada vez: as ampliações correm em fila no worker)
    if (saving.has(k)) return
    setSaving(x => new Set(x).add(k))
    chain.current = chain.current.then(async () => {
      const n = jobRef.current.items[k].n
      try {
        const blob = jobRef.current.settings.up2 ? (await enlarge(r.blob, 2)).blob : r.blob
        const url = await post(blob)
        const st = jobRef.current.settings, it = jobRef.current.items[k], rc = pickRecipe({ custom: it.custom?.trim() || st.custom, mode: st.mode })
        act.setArt(n, url, rc); rememberAlter(n, url, rc); dispatch({ t: 'use', k, url })
      } catch (e) { dispatch({ t: 'note', k, err: e.message }) } finally { setSaving(x => { const y = new Set(x); y.delete(k); return y }) }
    })
  }
  const useFirsts = () => job.items.forEach((x, k) => { if (x.status === 'ok' && x.results.length && !saving.has(k)) use(k, x.results[0]) })
  const fresh = async () => {
    if (job.items.some(x => x.status === 'ok' && x.results.length) && !(await ask('alterLote', { title: tx('Começar outro lote?'), body: tx('As imagens deste lote que não usaste perdem-se.'), ok: tx('Começar outro') }))) return
    await jobDel(key); prs.current = null; setResumed(false)
    setJob(j => newJob(cands.map(c => c.n), { ...j.settings }))
  }
  const close = () => { if (job && started && job.items.every(x => ['used', 'skip'].includes(x.status))) jobDel(key); onClose() }

  // --- ChatGPT: copiar o pedido, ZIP com tudo, trazer as imagens de volta ---
  const gptItems = job?.items.map((x, k) => ({ x, k })).filter(({ x }) => !['skip', 'used'].includes(x.status)) || []
  const cur = gptItems.find(({ x }) => !x.results.length)
  const promptOf = async it => { const c = data.byName.get(it.n); return plan(c, (await prints())[c.n], it).prompt }
  const copy = async it => setMsg((await copyText(await promptOf(it))) ? tx('Pedido de {c} copiado.', { c: it.n }) : tx('Não consegui copiar: seleciona o pedido em baixo e copia à mão.'))
  const refFiles = async (it, pr) => {  // as imagens que acompanham o pedido de uma carta: [[nome, blob]]
    const c = data.byName.get(it.n), pl = plan(c, pr, it), list = []
    if (pl.mode === 'frame') list.push(['carta', img(c, 'png', false, pl.pid)])
    if (pl.orig) list.push(['arte-original', img(c, 'art_crop', false, pl.pid)])
    pl.refs.forEach((u, k) => list.push([`estilo-${k + 1}`, fetchable(u)]))
    const out = []
    for (const [name, u] of list) { try { const b = await (await fetch(u)).blob(); out.push([`${name}.${(b.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, b]) } catch { /* fica sem essa imagem */ } }
    return out
  }
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000) }
  const zip = async () => {
    setMsg(tx('A preparar o ZIP…'))
    const pr = await prints(), files = [{ name: 'LEIA-ME.txt', text: tx('Uma pasta por carta: cola o prompt.txt no ChatGPT e junta as imagens dessa pasta. Faz as cartas todas na mesma conversa para o estilo ficar igual. Guarda cada imagem com o nome da pasta (ex.: «01 Llanowar Elves.png») e, no Grimório, usa «Trazer as imagens»: cada uma vai para a sua carta pelo nome.') }]
    for (const { x, k } of gptItems) {
      const dir = fileName(x.n, k)
      files.push({ name: `${dir}/prompt.txt`, text: plan(data.byName.get(x.n), pr[x.n], x).prompt })
      for (const [name, b] of await refFiles(x, pr[x.n])) files.push({ name: `${dir}/${name}`, data: new Uint8Array(await b.arrayBuffer()) })
    }
    save(new Blob([makeZip(files)], { type: 'application/zip' }), `${deck.name.replace(/[^\w\- ]+/g, '') || 'deck'} - alter arts.zip`)
    setMsg(tx('ZIP descarregado: {n} cartas.', { n: gptItems.length }))
  }
  const downloadRefs = async it => { const pr = (await prints())[it.n]; for (const [name, b] of await refFiles(it, pr)) save(b, `${fileName(it.n, job.items.indexOf(it))}-${name}`) }
  const attach = async (k, f) => {  // uma imagem trazida → resultado da carta k (já composta na moldura)
    const it = jobRef.current.items[k], c = data.byName.get(it.n)
    try {
      const pl = plan(c, (await prints())[c.n], it)
      dispatch({ t: 'ok', k, results: [await finishOut(await bitmap(f), null, pl)], cost: 0 })
    } catch (e) { dispatch({ t: 'note', k, err: e.message }) }
  }
  const bring = files => {  // pelo nome do ficheiro; o que não bate vai para a carta atual (se for uma só) ou fica para escolher
    const fs = [...files].filter(f => /^image\//.test(f.type))
    if (!fs.length) return
    const open = jobRef.current.items.map((x, k) => ({ x, k })).filter(({ x }) => !['skip', 'used'].includes(x.status))
    const m = matchFiles(open.map(o => o.x.n), fs)
    for (const h of m.hits) attach(open.find(o => o.x.n === h.n).k, h.file)
    let rest = m.rest
    if (rest.length === 1 && cur && !m.hits.some(h => h.n === cur.x.n)) { attach(cur.k, rest[0]); rest = [] }
    if (rest.length) setLoose(l => [...l, ...rest])
    setMsg(fs.length > rest.length ? tx('{n} imagem ligada à sua carta|{n} imagens ligadas às suas cartas', { n: fs.length - rest.length }) : '')
  }
  useEffect(() => {
    if (!gpt || !started) return
    const onPaste = e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); bring(fs) } }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  if (!job) return null
  const n = job.items.length, cnt = s => job.items.filter(x => x.status === s).length
  const done = n - cnt('wait') - cnt('run'), errs = cnt('err'), pending = job.items.filter(x => x.status === 'ok' && x.results.length).length
  const mine = (S.refs || []).length < 3 && q.trim().length >= 2 ? data.cards.filter(x => x.n.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : []
  const addRef = r => { if (!S.refs.some(x => x.src === r.src)) setS({ refs: [...S.refs, r].slice(0, 3) }); setQ('') }
  return createPortal(
    <div className="modal-bg" onClick={close}>
      <div className="modal alter abatch" role="dialog" aria-label={tx('Alter arts em lote')} onClick={e => e.stopPropagation()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (gpt && started) bring(e.dataTransfer.files) }}>
        <button className="close" onClick={close} aria-label={tx('Fechar')}>×</button>
        <h3>✨ {tx('Alter arts de {n} carta|Alter arts de {n} cartas', { n })}</h3>
        {resumed && <p className="small ok-t">{tx('Lote retomado: os resultados ficaram guardados neste aparelho.')}{job.paused && ` ${tx('Está em pausa: carrega em «Retomar» para continuar.')}`} <button className="link small" onClick={fresh}>{tx('começar outro lote')}</button></p>}
        <details className="ab-set" open={!started}>
          <summary className="small">{tx('Definições (para todas as cartas)')}</summary>
          {!picked && !started && <fieldset className="alter-opts"><legend className="small">{tx('Que cartas')}</legend>
            {[['creatures', tx('só criaturas')], ['nonlands', tx('sem terrenos')], ['nobasics', tx('sem terrenos básicos')], ['noown', tx('só as que ainda não têm imagem própria')]].map(([k, l]) => (
              <label key={k} className="chk"><input type="checkbox" checked={!!filt[k]} onChange={e => setFilt({ ...filt, [k]: e.target.checked })} /> {l}</label>))}
          </fieldset>}
          <fieldset className="alter-opts"><legend className="small">{tx('Quem gera')}</legend>
            {['chatgpt', ...(cfg?.providers || []).map(p => p.id)].map(id => (
              <label key={id} className="chk"><input type="radio" checked={S.prov === id} disabled={started && job.running && !finished(job)} onChange={() => setS({ prov: id })} /> {PROV()[id]}
                {id !== 'chatgpt' && !cfg.providers.find(p => p.id === id).hasKey && <small className="muted"> — {id === 'local' ? tx('falta o endereço em Definições › IA') : tx('falta a chave em Definições › IA')}</small>}</label>))}
          </fieldset>
          <fieldset className="alter-opts"><legend className="small">{tx('Modo')}</legend>
            <label className="chk"><input type="radio" checked={S.mode === 'frame'} onChange={() => setS({ mode: 'frame' })} /> {tx('Nova arte na moldura original')}</label>
            <label className="chk"><input type="radio" checked={S.mode === 'art'} onChange={() => setS({ mode: 'art' })} /> {tx('Arte completa (só a ilustração)')}</label>
            {S.mode === 'art' && <label className="chk"><input type="checkbox" checked={!!S.orig} onChange={e => setS({ orig: e.target.checked })} /> {tx('Enviar a arte original como referência')}</label>}
            {S.mode === 'frame' && <small className="muted">{tx('As cartas sem caixa da arte conhecida (sem margem, showcase, planeswalker…) ficam em arte completa.')}</small>}
          </fieldset>
          <label className="small">{tx('Personalizar (para todas; cada carta pode ter o seu texto)')}
            <input value={S.custom} onChange={e => setS({ custom: e.target.value })} placeholder={tx('ex.: aguarela, noite de lua cheia, tudo em tons de verde…')} /></label>
          <div className="alter-refs">
            <span className="small">{tx('Referências de estilo (até 3)')}</span>
            <div className="alter-thumbs">{S.refs.map(r => <button key={r.src} className="alter-thumb on" onClick={() => setS({ refs: S.refs.filter(x => x !== r) })} title={tx('Tirar')}><img src={fetchable(r.src)} alt="" /><small>{r.label} ×</small></button>)}</div>
            {S.refs.length < 3 && <input value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar outra carta…')} />}
            {mine.length > 0 && <div className="alter-thumbs">{mine.map(x => <button key={x.n} className="alter-thumb" onClick={() => addRef({ src: img(x, 'art_crop'), label: x.n })}><img src={img(x, 'art_crop')} alt="" loading="lazy" /><small>{x.n}</small></button>)}</div>}
            {!gpt && <label className="chk small"><input type="checkbox" checked={!!S.styleFirst} disabled={started && !!job.styleRef} onChange={e => setS({ styleFirst: e.target.checked })} /> {tx('Usar a 1.ª gerada como referência de estilo para as seguintes (mais consistentes)')}</label>}
          </div>
          {!gpt && <div className="row-btns">
            <label className="small">{tx('Variações por carta')} <select value={S.n} onChange={e => setS({ n: +e.target.value })}>{[1, 2].map(k => <option key={k}>{k}</option>)}</select></label>
            {S.prov === 'openai' && <label className="small">{tx('Qualidade')} <select value={S.quality} onChange={e => setS({ quality: e.target.value })}>
              <option value="low">{tx('rascunho')}</option><option value="medium">{tx('normal')}</option><option value="high">{tx('alta')}</option></select></label>}
            <label className="small">{tx('Ao mesmo tempo')} <select value={S.conc} onChange={e => setS({ conc: +e.target.value })}>{[1, 2].map(k => <option key={k}>{k}</option>)}</select></label>
            <label className="small">{tx('Modelo')} <input key={S.prov} className="alter-model" list="alter-models" defaultValue={model} placeholder={P?.model || tx('o primeiro que houver')} onChange={e => lsSet(`grimorio.alter.model.${S.prov}`, e.target.value)} />{P?.models?.length > 0 && <datalist id="alter-models">{P.models.map(m => <option key={m} value={m} />)}</datalist>}</label>
          </div>}
          <label className="chk small"><input type="checkbox" checked={!!S.up2} onChange={e => setS({ up2: e.target.checked })} /> {tx('Ampliar ×2 ao aceitar (Real-ESRGAN no teu browser, uma de cada vez)')}</label>
        </details>

        <div className="ab-go">
          {!(started && finished(job)) && <p className="small"><b>{gpt ? tx('Sem custo extra: usa o teu plano do ChatGPT.') : per ? tx('≈ US$ {t} no total: {c} cartas × {v} × US$ {u} (preço indicativo)', { t: num(total, 2), c: (started ? cnt('wait') + cnt('run') : live.length), v: S.n, u: num(per, 3) }) : tx('Grátis.')}</b>
            {started && job.spent > 0 && <span className="muted"> · {tx('gasto até agora ≈ US$ {s}', { s: num(job.spent, 3) })}</span>}</p>}
          {!started ? <button className="primary" disabled={!n || !ready} onClick={begin}>✨ {gpt ? tx('Preparar {n} pedidos', { n }) : tx('Começar ({n} cartas)', { n })}</button>
            : !gpt && <div className="row-btns">
              {job.running && !finished(job) && (job.paused ? <button className="primary" onClick={() => dispatch({ t: 'start' })}>▶ {tx('Retomar')}</button> : <button onClick={() => dispatch({ t: 'pause' })}>⏸ {tx('Pausar')}</button>)}
              {!job.running && !finished(job) && <button className="primary" onClick={() => dispatch({ t: 'start' })}>▶ {tx('Retomar')}</button>}
              {!finished(job) && <button onClick={() => dispatch({ t: 'cancel' })}>✕ {tx('Cancelar o resto')}</button>}
              {errs > 0 && <button onClick={() => dispatch({ t: 'retryErr' })}>↻ {tx('Repetir as que falharam ({n})', { n: errs })}</button>}
            </div>}
          {started && <><progress max={n} value={done} /><small className="muted">{tx('{d} de {n}', { d: done, n })}{cnt('run') ? ` · ${tx('a gerar {n}', { n: cnt('run') })}` : ''}{job.paused ? ` · ${tx('em pausa')}` : ''}</small></>}
          {started && pending > 0 && <button className="primary small" disabled={pending <= saving.size} onClick={useFirsts}>✓ {tx('Usar todas as primeiras ({n})', { n: pending })}</button>}
          {saving.size > 0 && <small className="muted"><span className="spin-dot" /> {tx('A guardar {n}…', { n: saving.size })}</small>}
          {enlView}
        </div>

        {gpt && started && <div className="alter-gpt ab-gpt">
          <p className="small">{tx('Duas maneiras: tudo de uma vez (ZIP com uma pasta por carta) ou carta a carta.')} <a className="btn" href="https://chatgpt.com/" target="_blank" rel="noreferrer">{tx('Abrir o ChatGPT ↗')}</a></p>
          <div className="row-btns"><button onClick={zip}>⬇ {tx('ZIP com os pedidos e as imagens')}</button>
            <label className="dbox-up">⬆ {tx('Trazer as imagens')}<input type="file" accept="image/*" multiple onChange={e => { bring(e.target.files || []); e.target.value = '' }} /></label></div>
          {cur ? <div className="ab-step">
            <b>{tx('Carta a carta: {c}', { c: cur.x.n })}</b> <small className="muted">({tx('{d} de {n}', { d: gptItems.indexOf(cur) + 1, n: gptItems.length })})</small>
            <div className="row-btns"><button className="primary small" onClick={() => copy(cur.x)}>📋 {tx('Copiar o pedido')}</button><button className="small" onClick={() => downloadRefs(cur.x)}>⬇ {tx('Imagens de referência')}</button>
              <button className="small" onClick={() => dispatch({ t: 'skip', k: cur.k })}>{tx('Saltar →')}</button></div>
            <small className="muted">{tx('Depois cola a imagem do ChatGPT aqui (Ctrl+V), arrasta-a ou usa «Trazer as imagens»: passa à carta seguinte sozinho.')}</small>
          </div> : <p className="small ok-t">{tx('Todas as cartas têm imagem. Escolhe em baixo.')}</p>}
          {loose.length > 0 && <div className="ab-loose"><span className="small">{tx('Estas não batem com nenhum nome: escolhe a carta.')}</span>
            {loose.map((f, i) => <span key={i} className="ab-lf"><img src={urlOf(f)} alt="" /><select value="" onChange={e => { attach(+e.target.value, f); setLoose(l => l.filter(x => x !== f)) }}>
              <option value="">{f.name}</option>{gptItems.map(({ x, k }) => <option key={k} value={k}>{x.n}</option>)}</select></span>)}</div>}
        </div>}
        {msg && <p className="small muted" role="status">{msg}</p>}

        {started && finished(job) && !gpt && <p className="ab-sum">{tx('Fim do lote: {u} usadas, {p} por escolher, {s} saltadas, {e} com erro · custo real estimado ≈ US$ {c}', { u: cnt('used'), p: pending, s: cnt('skip'), e: errs, c: num(job.spent, 3) })}</p>}
        {gpt && started && !cur && pending === 0 && <p className="ab-sum">{tx('Fim do lote: {u} usadas, {s} saltadas.', { u: cnt('used'), s: cnt('skip') })}</p>}

        <ul className="ab-list">{job.items.map((x, k) => {
          const c = data.byName.get(x.n)
          return c && (
            <li key={x.n} className={`ab-it st-${x.status}`}>
              <img className="ab-orig" src={img(c, 'normal', false, deck.prints?.[c.n]?.id || null)} alt={x.n} loading="lazy" />
              <div className="ab-body">
                <div className="ab-head"><b>{x.n}</b> <span className={`ab-st ${x.status}`}>{x.status === 'run' ? <><span className="spin-dot" /> {ST().run}</> : ST()[x.status]}</span>
                  {x.status === 'wait' && x.after > Date.now() && <small className="muted"> {tx('nova tentativa daqui a pouco')}</small>}</div>
                {x.err && <small className="bad-t">{x.err}</small>}
                {!['used', 'skip'].includes(x.status) && <input className="ab-custom" value={x.custom} disabled={x.status === 'run'} onChange={e => dispatch({ t: 'custom', k, v: e.target.value })} placeholder={tx('texto só desta carta (substitui o comum)')} />}
                {x.results.length > 0 && x.status !== 'used' && <div className="ab-res">{x.results.map((r, i) => (
                  <figure key={i}><img src={urlOf(r.blob)} alt="" /><figcaption><Dpi w={r.w} h={r.h} />
                    <button className="primary small" disabled={x.status === 'skip' || saving.has(k)} onClick={() => use(k, r)}>{tx('Usar')}</button></figcaption></figure>))}</div>}
                {x.status === 'used' && x.used && <img className="ab-used" src={x.used} alt="" />}
                {started && <div className="row-btns">
                  {gpt && !['used', 'skip'].includes(x.status) && <><button className="small" onClick={() => copy(x)}>📋 {tx('Pedido')}</button>
                    <label className="dbox-up small">⬆ {tx('Imagem')}<input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) attach(k, f); e.target.value = '' }} /></label></>}
                  {!gpt && ['ok', 'err', 'skip'].includes(x.status) && <button className="small" onClick={() => dispatch({ t: 'again', k })}>↻ {tx('Outra vez')}</button>}
                  {['wait', 'ok', 'err'].includes(x.status) && <button className="link small" onClick={() => dispatch({ t: 'skip', k })}>{tx('Saltar')}</button>}
                  {x.status === 'skip' && gpt && <button className="link small" onClick={() => dispatch({ t: 'again', k })}>{tx('voltar à fila')}</button>}
                </div>}
              </div>
            </li>)
        })}</ul>
      </div>
    </div>, document.body)
}
