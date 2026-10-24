// Perfis das edições sem login (Windows, Linux, APK): «Quem vai jogar?» ao abrir, o chip no cabeçalho e o formulário.
// O servidor guarda o perfil escolhido num cookie; trocar de perfil recarrega a página (decks, testes e torneios mudam todos).
import { useState } from 'react'
import { tx, LANGS, LANG, setLang } from './i18n.js'
import { Logo } from './ui.jsx'

const COLORS = ['#7c5cff', '#f2b84b', '#3dcf7a', '#ff6b5b', '#6ee7f9', '#ff8ad8', '#ff9f43', '#9a93b5']

async function call(path, method = 'POST', body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(j.erro || `HTTP ${r.status}`))
  return j
}
const selectProfile = id => call(`/api/profiles/${id}/select`).then(() => window.location.reload())

export function Avatar({ p, size = 28 }) {
  return <span className="avatar" style={{ '--c': p?.color || '#7c5cff', width: size, height: size, fontSize: size * 0.46 }} aria-hidden="true">{(p?.name || '?').trim().charAt(0).toUpperCase()}</span>
}

/** Nome + cor: cria (sem p) ou muda o nome/cor de p. */
export function ProfileForm({ p, onDone, onCancel }) {
  const [name, setName] = useState(p?.name || '')
  const [color, setColor] = useState(p?.color || COLORS[0])
  const [err, setErr] = useState('')
  const save = async e => {
    e.preventDefault()
    try {
      const j = await call(p ? `/api/profiles/${p.id}` : '/api/profiles', p ? 'PUT' : 'POST', { name: name.trim(), color })
      onDone ? onDone(j) : window.location.reload()
    } catch (x) { setErr(x.message) }
  }
  return (
    <form className="prof-form" onSubmit={save}>
      <div className="prof-form-top"><Avatar p={{ name: name || '?', color }} size={44} />
        <input autoFocus value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder={tx('Nome do perfil')} aria-label={tx('Nome do perfil')} /></div>
      <div className="prof-colors" role="radiogroup" aria-label={tx('Cor')}>
        {COLORS.map(c => <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={c} className={c === color ? 'on' : ''} style={{ '--c': c }} onClick={() => setColor(c)} />)}
        <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label={tx('Outra cor')} title={tx('Outra cor')} />
      </div>
      {err && <p className="bad-t small">{err}</p>}
      <div className="row-btns">{onCancel && <button type="button" onClick={onCancel}>{tx('Cancelar')}</button>}
        <button className="primary" disabled={!name.trim()}>{p ? tx('Guardar') : tx('Criar perfil')}</button></div>
    </form>
  )
}

export function LangPick() {
  return (
    <div className="lang-pick" role="radiogroup" aria-label={tx('Língua')}>
      {LANGS.map(([k, label, loc]) => <button key={k} lang={loc} role="radio" aria-checked={k === LANG} className={k === LANG ? 'on' : ''} onClick={() => k !== LANG && setLang(k)}>{label}</button>)}
    </div>
  )
}

/** Ecrã inteiro «Quem vai jogar?»: os perfis em mosaico, «Novo perfil» e a língua. */
export function WhoPlays({ list, onClose, startNew }) {
  const [adding, setAdding] = useState(startNew || !list.length)
  const [err, setErr] = useState('')
  return (
    <div className="home who">
      <div className="home-hero"><Logo size={72} /><h1>{tx('Quem vai jogar?')}</h1>
        <p>{list.length ? tx('Cada perfil tem os seus decks, testes, torneios e ratings.') : tx('Cria o teu perfil para começar: os decks, testes e torneios ficam guardados nele.')}</p></div>
      {adding ? <div className="card who-new"><h3>{tx('Novo perfil')}</h3><ProfileForm onCancel={list.length ? () => setAdding(false) : null} /></div> : (
        <div className="who-grid">
          {list.map(p => <button key={p.id} className="who-tile" onClick={() => selectProfile(p.id).catch(e => setErr(e.message))}><Avatar p={p} size={84} /><b>{p.name}</b></button>)}
          <button className="who-tile add" onClick={() => setAdding(true)}><span className="avatar plus" style={{ width: 84, height: 84 }}>+</span><b>{tx('Novo perfil')}</b></button>
        </div>)}
      {err && <p className="bad-t">{err}</p>}
      {onClose && <button onClick={onClose}>{tx('Voltar')}</button>}
      <LangPick />
    </div>
  )
}

/** Gerir o perfil atual (Definições e menu do chip): mudar nome/cor, trocar, novo, apagar com confirmação. */
export function ProfileManage({ prof, onSwitch, onNew }) {
  const [edit, setEdit] = useState(false)
  const [del, setDel] = useState(false)
  const [err, setErr] = useState('')
  const p = prof.current
  const remove = () => call(`/api/profiles/${p.id}`, 'DELETE').then(() => window.location.reload()).catch(e => setErr(e.message))
  if (edit) return <ProfileForm p={p} onDone={() => window.location.reload()} onCancel={() => setEdit(false)} />
  return (
    <div className="prof-manage">
      <div className="prof-cur"><Avatar p={p} size={40} /><b>{p.name}</b></div>
      <div className="row-btns">
        <button onClick={onSwitch}>⇄ {tx('Trocar de perfil')}</button>
        <button onClick={onNew}>＋ {tx('Novo perfil')}</button>
        <button onClick={() => setEdit(true)}>✎ {tx('Mudar nome ou cor')}</button>
        <button className="danger" onClick={() => setDel(true)}>🗑 {tx('Apagar perfil')}</button>
      </div>
      {err && <p className="bad-t small">{err}</p>}
      {del && <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setDel(false) }}>
        <div className="modal confirm" role="alertdialog" aria-label={tx('Apagar perfil')}>
          <h3>{tx('Apagar o perfil «{name}»?', { name: p.name })}</h3>
          <p className="muted">{tx('Os decks dele vão para o lixo e ficam lá 30 dias; o perfil desaparece já.')}</p>
          <div className="row-btns"><button onClick={() => setDel(false)} autoFocus>{tx('Cancelar')}</button><button className="danger" onClick={remove}>🗑 {tx('Apagar')}</button></div>
        </div>
      </div>}
    </div>
  )
}

/** Chip do cabeçalho: inicial + nome; abre o menu do perfil. */
export function ProfileChip({ prof, onSwitch, onNew }) {
  const [open, setOpen] = useState(false)
  if (prof?.mode !== 'profiles' || !prof.current) return null  // com login ou dono fixo não há perfis para gerir
  return (
    <div className="prof-chip">
      <button className="prof-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} title={tx('Perfil')}><Avatar p={prof.current} size={26} /><span>{prof.current.name}</span></button>
      {open && <div className="prof-menu card" onMouseLeave={() => setOpen(false)}>
        <ProfileManage prof={prof} onSwitch={() => { setOpen(false); onSwitch() }} onNew={() => { setOpen(false); onNew() }} />
      </div>}
    </div>
  )
}
