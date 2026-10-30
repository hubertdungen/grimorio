// Conversa da mesa livre: o registo das jogadas e as mensagens numa só linha do tempo (quem, o quê, a que horas), com
// @[carta] (sugestões pelo nome; passar o rato mostra a carta), #[regra] (abre a regra e as Regras), e reações.
// O registo vem do servidor já sem nomes de cartas escondidas; o que se escreve é de quem escreve.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { KW, normKw, define } from './keywords.js'
import { Syms } from './ui.jsx'
import { tx, LOCALE } from './i18n.js'

const Rules = lazy(() => import('./Rules.jsx'))
const REACT = ['👍', '😂', '😮', '🔥', '😭', '🤝']  // como freetable.REACT
const ICON = { draw: '🂠', shuffle: '🔀', mulligan: '♻', move: '↪', flip: '⟲', face: '🂠', attack: '⚔', untapall: '↺', token: '✦', life: '♥', poison: '☠', dice: '🎲', reveal: '👁', revealhand: '👁', peek: '👁', pass: '▶', concede: '🏳', close: '■', start: '🃏' }
const EN_KW = KW.source.slice(3, -3).split('|')
const MENTION = /([@#])\[([^\]]{1,60})\]/g
const hhmm = ts => new Date(ts * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
let ptTerms = null  // termos das regras em português (para as sugestões de #)
const loadPt = () => (ptTerms ??= fetch('/api/rules?terms=1').then(r => (r.ok ? r.json() : {})).then(d => d.pt || []).catch(() => []))

// texto com @[carta] e #[regra] -> pedaços clicáveis
function Rich({ text, onRule }) {
  const out = [], s = String(text || '')
  let last = 0
  for (const m of s.matchAll(MENTION)) {
    if (m.index > last) out.push(s.slice(last, m.index))
    out.push(m[1] === '@'
      ? <b key={m.index} className="ml-card" data-zn={m[2]} tabIndex={0}>{m[2]}</b>
      : <b key={m.index} className="ml-rule" tabIndex={0} onClick={e => onRule(m[2], e.currentTarget)} onMouseEnter={e => onRule(m[2], e.currentTarget, true)}>📖 {m[2]}</b>)
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

// os nomes das cartas que uma jogada traz (sempre públicas) ficam ligados à carta
function Named({ text, names }) {
  const ns = names.filter(n => n && text.includes(n.split(' // ')[0])).map(n => n.split(' // ')[0])
  if (!ns.length) return text
  const re = new RegExp(`(${ns.sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  return text.split(re).map((p, k) => (ns.includes(p) ? <b key={k} className="ml-card" data-zn={p}>{p}</b> : p))
}

export default function TableChat({ log, who, keyOf, me, data, send, fmt, names, onSeen, open = true }) {
  const box = useRef(null), inp = useRef(null), stick = useRef(true)
  const [txt, setTxt] = useState(''), [sug, setSug] = useState(null), [pick, setPick] = useState(0), [onlyChat, setOnlyChat] = useState(false), [rule, setRule] = useState(null), [full, setFull] = useState(null), [reacting, setReacting] = useState(null)
  const last = log[log.length - 1]?.id
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [log.length, last, onlyChat, open])
  useEffect(() => { if (open) onSeen?.(last) }, [open, last]) // eslint-disable-line react-hooks/exhaustive-deps
  const allNames = useMemo(() => [...data.byName.keys()], [data])
  // sugestões: @ = cartas (as da mesa primeiro, depois todas pelo começo do nome), # = regras (inglês e português)
  const suggest = async (value, caret) => {
    const m = /([@#])([^@#[\]\n]{0,30})$/.exec(value.slice(0, caret))
    if (!m) return setSug(null)
    const q = normKw(m[2]), at = m.index
    let list
    if (m[1] === '@') {
      const near = [...new Set(names)].filter(n => !q || normKw(n).includes(q))
      const far = q.length >= 2 ? allNames.filter(n => normKw(n).startsWith(q) && !near.includes(n)).slice(0, 8) : []
      list = [...near, ...far].slice(0, 8)
    } else {
      const pt = await loadPt()
      list = [...new Set([...EN_KW, ...pt])].filter(t => !q || normKw(t).includes(q)).sort((a, b) => normKw(a).indexOf(q) - normKw(b).indexOf(q)).slice(0, 8)
    }
    setSug(list.length ? { kind: m[1], at, end: caret, list } : null); setPick(0)
  }
  const choose = v => {
    const s = sug, before = txt.slice(0, s.at), after = txt.slice(s.end), ins = `${s.kind}[${v}] `
    setTxt(before + ins + after); setSug(null)
    requestAnimationFrame(() => { const el = inp.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = before.length + ins.length } })
  }
  const submit = e => { e?.preventDefault(); const t = txt.trim(); if (!t) return; send({ c: 'chat', text: t }); setTxt(''); setSug(null); stick.current = true }
  const key = e => {
    if (sug) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPick(p => (p + (e.key === 'ArrowDown' ? 1 : -1) + sug.list.length) % sug.list.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(sug.list[pick]); return }
      if (e.key === 'Escape') { setSug(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) submit(e)
  }
  const onRule = (term, el, hover) => {
    if (hover && rule?.pinned) return
    const r = el.getBoundingClientRect()
    setRule({ term, x: Math.max(8, Math.min(innerWidth - 330, r.left)), y: Math.min(innerHeight - 180, r.bottom + 6), info: null, pinned: !hover })
    define(term).then(info => setRule(p => (p?.term === term ? { ...p, info: info || { text: '' } } : p)))
  }
  const shown = onlyChat ? log.filter(e => e.k === 'chat') : log
  return (
    <div className={`ml-chat ${open ? '' : 'closed'}`}>
      <div className="ml-chat-h"><b>💬 {tx('Conversa e jogadas')}</b>
        <button className={`link small ${onlyChat ? 'on' : ''}`} onClick={() => setOnlyChat(v => !v)} aria-pressed={onlyChat} title={tx('Esconder as jogadas e ver só as mensagens')}>{onlyChat ? tx('só mensagens') : tx('tudo')}</button></div>
      <ol className="ml-feed" ref={box} aria-live="polite" aria-label={tx('Conversa e jogadas')} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }} onMouseLeave={() => !rule?.pinned && setRule(null)}>
        {shown.map((e, k) => {
          const mine = e.s === me, chat = e.k === 'chat', re = Object.entries(e.re || {})
          return (
            <li key={e.id ?? `k${k}`} className={`${chat ? 'msg' : 'ev'} ${mine ? 'mine' : ''} p-${e.s == null ? 'x' : keyOf(e.s)} k-${e.k}`}>
              {chat ? <>
                <span className="ml-who">{who(e.s)} <time>{hhmm(e.ts)}</time></span>
                <span className="ml-bubble"><Rich text={e.text} onRule={onRule} /></span>
              </> : <>
                <i className="ml-ico" aria-hidden="true">{ICON[e.k] || '•'}</i>
                <span className="ml-evt"><Named text={fmt(e)} names={[e.name, ...(e.names || [])]} /></span>
                <time>{hhmm(e.ts)}</time>
              </>}
              {(re.length > 0 || e.id != null) && <span className="ml-re">
                {re.map(([em, ss]) => <button key={em} className={ss.includes(me) ? 'on' : ''} onClick={() => send({ c: 'react', i: e.id, e: em })} title={ss.map(who).join(', ')}>{em} {ss.length}</button>)}
                {e.id != null && <button className="ml-re-add" onClick={() => setReacting(r => (r === e.id ? null : e.id))} aria-label={tx('Reagir')} title={tx('Reagir')}>☺＋</button>}
                {reacting === e.id && <span className="ml-re-pick">{REACT.map(em => <button key={em} onClick={() => { send({ c: 'react', i: e.id, e: em }); setReacting(null) }}>{em}</button>)}</span>}
              </span>}
            </li>
          )
        })}
      </ol>
      <form className="ml-compose" onSubmit={submit}>
        {sug && <ul className="ml-sug" role="listbox">{sug.list.map((v, k) => (
          <li key={v} role="option" aria-selected={k === pick} className={k === pick ? 'on' : ''} onMouseDown={e => { e.preventDefault(); choose(v) }} {...(sug.kind === '@' && { 'data-zn': v })}>{sug.kind === '@' ? '🂠' : '📖'} {v}</li>))}</ul>}
        <textarea ref={inp} rows={1} value={txt} maxLength={300} placeholder={tx('Escreve à mesa… @ para uma carta, # para uma regra')} aria-label={tx('Mensagem')}
          onChange={e => { setTxt(e.target.value); suggest(e.target.value, e.target.selectionStart) }} onKeyDown={key} onBlur={() => setTimeout(() => setSug(null), 150)} />
        <button className="primary" disabled={!txt.trim()} title={tx('Enviar')}>➤</button>
      </form>
      {rule && createPortal(
        <div className="kw-peek ml-rule-peek" style={{ left: rule.x, top: rule.y }} role="tooltip" onMouseLeave={() => !rule.pinned && setRule(null)}>
          <b>{rule.info?.name || rule.term}</b>{rule.info?.num && <code> {rule.info.num}</code>}
          <p>{rule.info ? <Syms text={rule.info.text || tx('Sem definição nas regras.')} /> : tx('A carregar…')}</p>
          <span className="row-btns"><button className="link small" onClick={() => { setFull(rule.info?.name || rule.term); setRule(null) }}>📖 {tx('Abrir nas Regras')}</button>
            <button className="link small" onClick={() => setRule(null)}>{tx('fechar')}</button></span>
        </div>, document.body)}
      {full && createPortal(
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setFull(null) }}>
          <div className="modal kw-rules"><button className="kw-x" onClick={() => setFull(null)} aria-label={tx('Fechar')}>×</button>
            <Suspense fallback={<p className="muted">{tx('A carregar…')}</p>}><Rules data={data} initial={full} /></Suspense></div>
        </div>, document.body)}
    </div>
  )
}
