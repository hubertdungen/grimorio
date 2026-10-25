// IA (Definições): uma chave por fornecedor, todas guardadas no servidor (ia.py; nunca voltam ao browser), o fornecedor
// ativo e o modelo de cada um. «Detetar» pede a lista ao fornecedor e põe o modelo mais recente primeiro.
import { useEffect, useState } from 'react'
import { tx } from './i18n.js'

async function j(url, opts) {
  const r = await fetch(url, opts), d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const save = body => j('/api/ia/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export default function AIKeys() {
  const [cfg, setCfg] = useState(null), [keys, setKeys] = useState({}), [models, setModels] = useState({}), [busy, setBusy] = useState(''), [err, setErr] = useState({})
  useEffect(() => { j('/api/ia/config').then(setCfg).catch(e => setErr({ all: e.message })) }, [])
  if (!cfg) return err.all ? <p className="small bad-t">{err.all}</p> : null
  const run = async (id, f) => { setBusy(id); setErr(e => ({ ...e, [id]: '' })); try { await f() } catch (e) { setErr(x => ({ ...x, [id]: e.message })) } finally { setBusy('') } }
  const detect = id => run(id, async () => {
    const l = await j(`/api/ia/models?provider=${id}`)
    setModels(m => ({ ...m, [id]: l }))
    const p = cfg.providers.find(x => x.id === id)
    if (l[0] && !p.chosen) setCfg(await save({ provider: cfg.provider, models: { [id]: l[0].id } }))  // sem escolha: fica o mais recente
  })
  return (
    <div className="aik">
      <p className="small muted">{tx('Regista as chaves de quantos fornecedores quiseres; ficam guardadas só no servidor. O ativo é o que o Assistente IA usa. «Detetar» vai buscar os modelos que a tua chave vê, com o mais recente primeiro.')}</p>
      <label className="chk"><input type="radio" name="ia-ativo" checked={cfg.provider === 'off'} onChange={() => run('off', async () => setCfg(await save({ provider: 'off' })))} /> {tx('IA desligada')}</label>
      <ul className="aik-list">{cfg.providers.map(p => { const ml = models[p.id], ready = p.nokey || p.hasKey; return (
        <li key={p.id} className={cfg.provider === p.id ? 'on' : ''}>
          <div className="aik-h">
            <label className="chk"><input type="radio" name="ia-ativo" checked={cfg.provider === p.id} disabled={!ready} onChange={() => run(p.id, async () => setCfg(await save({ provider: p.id })))} /> <b>{p.label}</b></label>
            {p.keyUrl && <a className="small" href={p.keyUrl} target="_blank" rel="noreferrer">{tx('obter chave ↗')}</a>}
            {ready && <span className="small ok-t">{p.nokey ? tx('sem chave') : tx('chave guardada ✓')}</span>}
          </div>
          {!p.nokey && <div className="row-btns">
            <input type="password" autoComplete="off" value={keys[p.id] || ''} onChange={e => setKeys(k => ({ ...k, [p.id]: e.target.value }))} placeholder={p.hasKey ? tx('•••• (escreve para trocar)') : tx('cola aqui a chave')} />
            <button disabled={!keys[p.id] || busy === p.id} onClick={() => run(p.id, async () => { setCfg(await save({ provider: cfg.provider, keys: { [p.id]: keys[p.id] } })); setKeys(k => ({ ...k, [p.id]: '' })) })}>{tx('Guardar')}</button>
            {p.hasKey && <button className="link small" onClick={() => run(p.id, async () => setCfg(await save({ provider: cfg.provider === p.id ? 'off' : cfg.provider, keys: { [p.id]: '' } })))}>{tx('apagar')}</button>}
          </div>}
          {ready && <div className="row-btns">
            <span className="small muted">{tx('Modelo')}</span>
            {ml?.length ? <select value={p.chosen || p.model} onChange={e => run(p.id, async () => setCfg(await save({ provider: cfg.provider, models: { [p.id]: e.target.value } })))}>
              {!ml.some(m => m.id === (p.chosen || p.model)) && <option value={p.chosen || p.model}>{p.chosen || p.model}</option>}
              {ml.map((m, k) => <option key={m.id} value={m.id}>{m.name}{k === 0 ? ` — ${tx('mais recente')}` : ''}</option>)}</select>
              : <code className="small">{p.chosen || p.model}</code>}
            <button className="small" onClick={() => detect(p.id)} disabled={busy === p.id}>{busy === p.id ? tx('a procurar…') : tx('🔄 Detetar modelos')}</button>
          </div>}
          {err[p.id] && <p className="small bad-t">{err[p.id]}</p>}
        </li>) })}</ul>
    </div>
  )
}
