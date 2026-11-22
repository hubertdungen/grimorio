// «✨ Epificar nomes»: sugestões de nomes épicos para um ou vários decks (epic.js, sem rede) e, com a IA configurada,
// nomes + uma descrição curta para as notas (/api/ia/names, ia.py). Mostra antigo → novo antes de aplicar; quem abre
// decide como se grava (Biblioteca: PUT; deck aberto: setDeck, para a gravação automática não o desfazer).
import { useMemo, useState } from 'react'
import { analyse, suggest, summary, nameKey } from './epic.js'
import { tx, LANG } from './i18n.js'
import { useBackClose } from './backnav.js'

async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`)
  return j
}

/** decks: os decks inteiros; taken: os nomes dos outros decks; onApply([{ id, name?, notes? }]) grava. */
export default function EpicDialog({ data, decks, taken = [], onApply, onClose }) {
  useBackClose(true, onClose)
  const profs = useMemo(() => decks.map(d => analyse(data, d)), [data, decks])
  const [keepAll, setKeepAll] = useState(true)
  const [en, setEn] = useState(LANG === 'en')
  const [rows, setRows] = useState(() => decks.map(d => ({ id: d.id, old: d.name || '', name: d.name || '', keep: null, seed: 0, ai: null, busy: false, err: '', saved: false })))
  const [busy, setBusy] = useState(false)
  const set = (i, p) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const lang = en ? 'en' : LANG
  const keepOf = r => r.keep ?? keepAll
  const sugs = rows.map((r, i) => suggest(profs[i], { lang, keep: keepOf(r), seed: r.seed, taken: [...taken, r.old], n: 6 }))
  const askAI = async i => {
    set(i, { busy: true, err: '' })
    try {
      const j = await postJSON('/api/ia/names', { context: summary(profs[i]), lang: LANG, english: en, keep: keepOf(rows[i]), taken: [...taken, rows[i].old] })
      set(i, { busy: false, ai: j })
    } catch (e) { set(i, { busy: false, err: e.message }) }
  }
  const aiAll = async () => { setBusy(true); for (let i = 0; i < rows.length; i++) await askAI(i); setBusy(false) }
  const saveNotes = async i => { await onApply([{ id: rows[i].id, notes: rows[i].ai.description }]); set(i, { saved: true }) }
  const names = rows.map(r => nameKey(r.name)), takenK = new Set(taken.map(nameKey))
  const dup = i => !!names[i] && (names.indexOf(names[i]) !== i || (names[i] !== nameKey(rows[i].old) && takenK.has(names[i])))
  const changes = rows.filter(r => r.name.trim() && r.name.trim() !== r.old)
  const apply = async () => { setBusy(true); try { await onApply(changes.map(r => ({ id: r.id, name: r.name.trim() }))); onClose() } finally { setBusy(false) } }
  const hasLead = profs.some(p => p.lead || p.keyCard)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal epic" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Epificar nomes')}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>✨ {tx('Epificar nomes')} <span className="muted small">{tx('{n} deck|{n} decks', { n: rows.length })}</span></h3>
        <p className="muted small">{tx('Nomes épicos a partir do comandante, da tribo, da estratégia, das cores e do universo do deck. Escolhe uma sugestão ou escreve o teu; nada muda até carregares em «Aplicar».')}</p>
        <div className="ep-opts">
          {hasLead && <label className="chk"><input type="checkbox" checked={keepAll} onChange={e => { setKeepAll(e.target.checked); setRows(rs => rs.map(r => ({ ...r, keep: null }))) }} /> {tx('Manter o nome do comandante')}</label>}
          {LANG !== 'en' && <label className="chk"><input type="checkbox" checked={en} onChange={e => setEn(e.target.checked)} /> {tx('Nomes em inglês')}</label>}
          {rows.length > 1 && <button className="small" onClick={() => setRows(rs => rs.map((r, i) => ({ ...r, name: sugs[i][0] || r.name })))}>{tx('Usar a 1.ª sugestão em todos')}</button>}
          {rows.length > 1 && <button className="small" disabled={busy} onClick={aiAll} title={tx('Usa o fornecedor de IA das definições do Assistente IA')}>✨ {tx('IA para todos')}</button>}
        </div>
        <div className="ep-rows">
          {rows.map((r, i) => {
            const p = profs[i], lead = p.lead || p.keyCard
            return (
              <div key={r.id || i} className="ep-row" data-epic={r.id}>
                <div className="ep-head"><b>{r.old || tx('(sem nome)')}</b>
                  <span className="muted small">{[p.cmds.join(' + ') || p.keyCard, p.guild, p.tribe].filter(Boolean).join(' · ')}</span></div>
                <div className="ep-chips">
                  {sugs[i].map(s => <button key={s} className={`ep-chip ${r.name === s ? 'on' : ''}`} onClick={() => set(i, { name: s })}>{s}</button>)}
                  {(r.ai?.names || []).map(s => <button key={`ai-${s}`} className={`ep-chip ai ${r.name === s ? 'on' : ''}`} title={tx('Sugestão da IA')} onClick={() => set(i, { name: s })}>✨ {s}</button>)}
                </div>
                <div className="ep-edit">
                  <input value={r.name} onChange={e => set(i, { name: e.target.value })} aria-label={tx('Novo nome de «{name}»', { name: r.old })} maxLength={120} />
                  <button onClick={() => set(i, { seed: r.seed + 1 })} title={tx('Outras sugestões')}>🎲 {tx('Outros')}</button>
                  <button disabled={r.busy} onClick={() => askAI(i)} title={`${tx('Nomes e uma descrição do deck pela IA')} · ${tx('Usa o fornecedor de IA das definições do Assistente IA')}`}>{r.busy ? '…' : '✨'} {tx('IA')}</button>
                  {lead && rows.length > 1 && <label className="chk small" title={tx('Só neste deck')}><input type="checkbox" checked={keepOf(r)} onChange={e => set(i, { keep: e.target.checked })} /> {tx('com «{c}»', { c: lead })}</label>}
                  {r.name !== r.old && <button className="link small" onClick={() => set(i, { name: r.old })}>{tx('repor')}</button>}
                </div>
                {dup(i) && <p className="small warn">{tx('Já tens um deck com este nome.')}</p>}
                {r.err && <p className="small warn">{r.err}</p>}
                {r.ai?.description && <div className="ep-desc">
                  <p>{r.ai.description}</p>
                  <div className="row">{r.saved ? <span className="small">✓ {tx('Guardado nas notas')}</span> : <button className="small" onClick={() => saveNotes(i)}>📝 {tx('Guardar nas notas')}</button>}
                    <span className="muted small">{r.ai.modelo}</span></div>
                </div>}
              </div>
            )
          })}
        </div>
        <div className="ep-foot">
          {changes.length > 0 && <ul className="ep-prev">{changes.map(r => <li key={r.id}><s>{r.old}</s> → <b>{r.name.trim()}</b></li>)}</ul>}
          <div className="row"><button className="primary" disabled={!changes.length || busy} onClick={apply}>{tx('Aplicar ({n})', { n: changes.length })}</button><button onClick={onClose}>{tx('Cancelar')}</button></div>
        </div>
      </div>
    </div>
  )
}
