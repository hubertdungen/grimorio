// Confirmações antes de ações difíceis de desfazer. ask(chave, {...}) devolve uma Promise<boolean>; se essa confirmação
// estiver desligada (Definições › Confirmações, ou «não voltar a perguntar»), resolve logo a true.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { tx } from './i18n.js'

export const CONFIRMS = [
  ['apagar', tx('Apagar um deck')],
  ['duplicar', tx('Duplicar um deck')],
  ['ultima', tx('Tirar a última cópia de uma carta do deck')],
  ['ultimaSingleton', tx('… também em formatos de uma cópia (Commander/EDH)')],
  ['formato', tx('Mudar o formato de um deck com cartas')],
  ['casual', tx('Pôr ou tirar um deck do modo casual')],
  ['torneio', tx('Apagar ou cancelar um torneio')],
  ['teste', tx('Apagar um teste guardado')],
  ['registo', tx('Limpar os registos da mesa (vida e dados)')],
  ['copia', tx('Substituir tudo por uma cópia de segurança')],
  ['basicos', tx('Repor a arte dos terrenos básicos em todos os decks')],
  ['carteira', tx('Recomeçar a carteira das apostas')],
  ['amigo', tx('Revogar ou tirar um amigo')],
]
const OFF0 = { ultimaSingleton: false }  // em Commander cada «−» tira a última cópia: perguntar sempre seria chato
const K = 'grimorio.confirmar', subs = new Set()
let cfg = (() => { try { return { ...OFF0, ...JSON.parse(localStorage.getItem(K) || '{}') } } catch { return { ...OFF0 } } })()
export const confirmOn = k => cfg[k] !== false
export function setConfirm(k, v) {
  cfg = { ...cfg, [k]: v }
  try { localStorage.setItem(K, JSON.stringify(cfg)) } catch { /* sem armazenamento */ }
  subs.forEach(f => f())
}
export const useConfirmCfg = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => cfg)

let show = null
// force: pergunta sempre (sem «não voltar a perguntar»); typed: só confirma depois de escrever essa palavra
export function ask(key, { title, body = '', ok = tx('Sim'), danger = true, force = false, typed = '' } = {}) {
  if (!force && !confirmOn(key)) return Promise.resolve(true)
  return new Promise(res => (show ? show({ key, title, body, ok, danger, force, typed, res }) : res(window.confirm(title))))
}

export function ConfirmHost() {
  const [q, setQ] = useState(null), [never, setNever] = useState(false), [word, setWord] = useState(''), okRef = useRef(null)
  useEffect(() => { show = x => { setNever(false); setWord(''); setQ(x) }; return () => { show = null } }, [])
  const done = v => { if (v && never) setConfirm(q.key, false); q.res(v); setQ(null) }
  useEffect(() => {
    if (!q) return
    if (!q.typed) okRef.current?.focus()
    const k = e => { if (e.key === 'Escape') { e.preventDefault(); done(false) } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })
  if (!q) return null
  return (
    <div className="modal-bg ask-bg" onClick={e => { if (e.target === e.currentTarget) done(false) }}>
      <div className="modal ask" role="alertdialog" aria-modal="true" aria-label={q.title}>
        <h3>{q.title}</h3>
        {q.body && <p className="muted">{q.body}</p>}
        {q.typed && <label className="ask-typed"><span>{tx('Para confirmar, escreve {w}:', { w: q.typed })}</span><input autoFocus value={word} onChange={e => setWord(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && word.trim().toUpperCase() === q.typed) done(true) }} /></label>}
        {!q.force && <label className="chk small"><input type="checkbox" checked={never} onChange={e => setNever(e.target.checked)} /> {tx('Não voltar a perguntar (muda-se nas Definições)')}</label>}
        <div className="row-btns">
          <button ref={okRef} className={q.danger ? 'danger' : 'primary'} disabled={!!q.typed && word.trim().toUpperCase() !== q.typed} onClick={() => done(true)}>{q.ok}</button>
          <button onClick={() => done(false)}>{tx('Cancelar')}</button>
        </div>
      </div>
    </div>
  )
}

// textos das confirmações do modo casual (Biblioteca em massa e construtor)
export const casualAsk = (on, n = 1) => ask('casual', on
  ? { title: n > 1 ? tx('Passar {n} decks a casual?', { n }) : tx('Passar o deck a casual?'), ok: tx('Passar a casual'), danger: false,
    body: tx('Um deck casual pode ter cartas proibidas, banidas ou de fora do formato. Passa a jogar só em modo casual (Laboratório, torneios e Arena casuais) e só conta para o rating casual; deixa de entrar nos torneios e na Arena do formato.') }
  : { title: n > 1 ? tx('Tirar {n} decks do modo casual?', { n }) : tx('Tirar o deck do modo casual?'), ok: tx('Tirar do casual'), danger: false,
    body: tx('Volta a seguir as regras do formato: entra nos torneios e na Arena do formato e conta para os ratings normais. Se tiver cartas que o formato não deixa, aparece como inválido até as trocares.') })

// Definições › Confirmações
export function ConfirmSettings() {
  const c = useConfirmCfg()
  return (
    <div className="ask-set">
      {CONFIRMS.map(([k, l]) => (
        <label key={k} className={`chk ${k === 'ultimaSingleton' ? 'sub' : ''}`}>
          <input type="checkbox" checked={c[k] !== false} disabled={k === 'ultimaSingleton' && c.ultima === false} onChange={e => setConfirm(k, e.target.checked)} /> {l}
        </label>
      ))}
    </div>
  )
}
