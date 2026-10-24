// Definições: perfil (edições sem login), língua, jogos do Forge em simultâneo (com sugestão pela RAM livre agora), som e
// dados (exportar/importar uma cópia e, opcional, sincronizar com uma pasta na nuvem: backup.py).
import { useEffect, useState } from 'react'
import { tx, num, LOCALE } from './i18n.js'
import { LangPick, ProfileManage } from './Profiles.jsx'
import { getStarLayers, setStarLayers } from './ui.jsx'
import { getSettings, setEnabled, setVolume, play } from './sfx.js'
import { NextMode } from './Tournament.jsx'

const PER_GAME = 900, RESERVE = 1000  // MB: ~0,9 GB por jogo do Forge; 1 GB fica para o sistema e o browser
// quantos jogos cabem na RAM livre agora; os que já correm contam como livres (a memória deles é deles)
const recommend = st => Math.max(1, Math.min(3, Math.floor((st.mem_free + st.running * PER_GAME - RESERVE) / PER_GAME)))
const gb = mb => num(mb / 1000, 1)

function ForgeGames() {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const load = () => fetch('/api/sim/settings').then(r => r.json()).then(setSt).catch(() => setErr(tx('O servidor não respondeu.')))
    load()
    const iv = setInterval(load, 4000)  // a RAM livre muda com os outros programas: a sugestão acompanha
    return () => clearInterval(iv)
  }, [])
  if (!st) return <p className="muted small">{err || tx('A ler a memória…')}</p>
  const set = n => fetch('/api/sim/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parallel: n }) }).then(r => r.json()).then(setSt)
  const rec = recommend(st)
  return (
    <>
      <div className="seg-pick" role="radiogroup" aria-label={tx('Jogos do Forge ao mesmo tempo')}>
        {[1, 2, 3].map(n => <button key={n} role="radio" aria-checked={st.parallel === n} className={st.parallel === n ? 'on' : ''} onClick={() => set(n)}>
          {n}{n === rec && <small>{tx('sugerido')}</small>}</button>)}
      </div>
      <p className="small">{tx('Sugestão agora: {n} jogo|Sugestão agora: {n} jogos', { n: rec })} · <span className="muted">{tx('~0,9 GB por jogo; {free} GB livres agora, 1 GB fica para o sistema.', { free: gb(st.mem_free) })}
        {st.running > 0 && ` ${tx('{n} jogo a correr (já conta).|{n} jogos a correr (já contam).', { n: st.running })}`}</span></p>
      {st.parallel > rec && <p className="small warn-t">⚠ {tx('Escolheste mais do que a RAM livre aguenta agora: os jogos extra esperam até haver {min} GB livres, e o computador pode ficar lento.', { min: gb(st.mem_min) })}</p>}
      <p className="muted small">{tx('Vale para os testes do Laboratório, os torneios e a Arena. Cada jogo usa também quase um núcleo do processador.')}</p>
    </>
  )
}

function Sound() {
  const [s, setS] = useState(getSettings)
  return (
    <div className="set-sound">
      <label className="check"><input type="checkbox" checked={s.on} onChange={e => { setEnabled(e.target.checked); setS(getSettings()) }} /> {tx('Efeitos sonoros')}</label>
      <label className="sl"><span>{tx('Volume')} <b>{Math.round(s.vol * 100)}%</b></span>
        <input type="range" min={0} max={100} value={Math.round(s.vol * 100)} disabled={!s.on}
          onChange={e => { setVolume(e.target.value / 100); setS(getSettings()) }} onPointerUp={() => play('click')} onKeyUp={() => play('click')} /></label>
    </div>
  )
}

const DOCS = 'https://github.com/hubertdungen/grimorio#backups-and-cloud-sync'
const when = ts => (ts ? new Date(ts * 1000).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' }) : '—')
const postJ = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || r.status); return j })

function DataSync({ prof }) {
  const login = prof?.mode === 'login'
  const [st, setSt] = useState(null), [folder, setFolder] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [replace, setReplace] = useState(false)
  const load = () => (login ? Promise.resolve() : fetch('/api/sync').then(r => r.json()).then(j => { setSt(j); setFolder(f => f || j.folder || '') }).catch(() => {}))
  useEffect(() => {
    load()
    if (login) return
    const iv = setInterval(load, 15000)
    return () => clearInterval(iv)
  }, [login]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async f => { setBusy(true); setErr(''); setMsg(''); try { await f() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const sync = body => run(async () => setSt(await postJ('/api/sync', body)))
  const imp = file => run(async () => {
    if (replace && !confirm(tx('Substituir TUDO o que está nesta instalação pela cópia? (a base atual fica guardada ao lado, por segurança)'))) return
    const r = await fetch(`/api/backup/import?mode=${replace ? 'replace' : 'merge'}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || r.status)
    setMsg(j.replaced ? tx('Cópia reposta. Recarrega a página para ver tudo.') : `${tx('Cópia juntada: {n} decks novos, {u} atualizados, {t} torneios.', { n: j.decks_new, u: j.decks_updated, t: j.tournaments })}${j.conflicts?.length ? ` ${tx('Conflitos (ficaram as duas versões): {d}', { d: j.conflicts.join(', ') })}` : ''}`)
  })
  return (
    <div className="set-data">
      <p className="small">{tx('Tudo o que crias fica guardado nesta instalação. Para não perder nada, ou para usar noutro computador, exporta uma cópia ou liga uma pasta na nuvem.')} <a href={DOCS} target="_blank" rel="noreferrer">{tx('Como fazer')}</a></p>
      <div className="row-btns">
        <a className="btn" href="/api/backup/export" download>⬇ {tx('Exportar tudo')}</a>
        <label className={`btn ${busy ? 'off' : ''}`}>⬆ {tx('Importar cópia…')}<input type="file" accept=".grimorio,.zip" hidden disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) imp(f) }} /></label>
        {!login && <label className="check small"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> {tx('substituir tudo (em vez de juntar)')}</label>}
      </div>
      {login && <p className="muted small">{tx('Com login, a cópia leva só os teus decks, torneios e apostas, e ao importar junta-os aos que já tens.')}</p>}
      {!login && st && (
        <div className="set-sync">
          <label className="check"><input type="checkbox" checked={!!st.on} disabled={busy || !folder.trim()} onChange={e => sync({ on: e.target.checked, folder })} /> <b>{tx('Sincronizar com uma pasta na nuvem')}</b> <span className="muted small">{tx('(opcional)')}</span></label>
          <div className="set-folder">
            <input value={folder} onChange={e => setFolder(e.target.value)} placeholder={tx('Pasta, p.ex. G:\\My Drive\\Grimorio ou ~/Dropbox/Grimorio')} aria-label={tx('Pasta')} />
            <button disabled={busy || !folder.trim() || folder === st.folder} onClick={() => sync({ folder, on: true })}>{tx('Usar esta pasta')}</button>
          </div>
          {st.candidates?.length > 0 && <p className="small">{tx('Encontrei neste computador:')} {st.candidates.map(c => <button key={c.folder} className="link small" onClick={() => setFolder(c.folder)} title={c.folder}>{c.app}</button>)}</p>}
          <p className="muted small">{tx('Funciona com qualquer app grátis que mantenha uma pasta igual na nuvem: Google Drive para computador, OneDrive, Dropbox, Syncthing, Nextcloud ou iCloud Drive. Sem rede (num avião, p.ex.) continuas a usar tudo; a app leva as alterações quando a rede voltar.')}</p>
          {st.on && <ul className="set-status small">
            <li>{tx('Este aparelho:')} <b>{st.device}</b>{st.devices?.length > 1 ? ` · ${tx('na pasta: {d}', { d: st.devices.join(', ') })}` : ''}</li>
            <li>{tx('Última cópia enviada:')} {when(st.last_push)} · {tx('última recebida:')} {when(st.last_pull?.at)}{st.last_pull?.device ? ` (${st.last_pull.device})` : ''}</li>
            {st.conflicts?.length > 0 && <li className="warn-t">{tx('Conflitos (ficaram as duas versões):')} {st.conflicts.slice(-5).map(c => c.deck).join(', ')}</li>}
            {st.error && <li className="bad-t">{tx(st.error)}</li>}
          </ul>}
          {st.on && <button className="small" disabled={busy} onClick={() => run(async () => setSt(await postJ('/api/sync/now', {})))}>⟳ {tx('Sincronizar agora')}</button>}
        </div>
      )}
      {msg && <p className="small good-t">{msg}</p>}
      {err && <p className="small bad-t">{err}</p>}
    </div>
  )
}

// Dica única na Biblioteca (instalações sem login e sem pasta ligada): onde guardar os decks na nuvem.
export function SyncHint() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem('grimorio.hint.sync') === '0') return } catch { /* sem armazenamento */ }
    fetch('/api/sync').then(r => (r.ok ? r.json() : null)).then(j => setShow(!!j && !j.on)).catch(() => {})
  }, [])
  if (!show) return null
  const off = () => { setShow(false); try { localStorage.setItem('grimorio.hint.sync', '0') } catch { /* sem armazenamento */ } }
  return (
    <p className="sync-hint small" role="note">☁ {tx('Guarda os teus decks na nuvem: em Definições › Dados e cópias exportas tudo ou ligas uma pasta do Google Drive, Dropbox, Syncthing…')}
      <a href="#definicoes" onClick={off}>{tx('Abrir')}</a><button className="link plain" onClick={off} aria-label={tx('Fechar')}>✕</button></p>
  )
}

export default function Settings({ prof, onClose, onSwitch, onNew }) {
  return (
    <div className="view settings">
      <div className="set-head"><h2>⚙ {tx('Definições')}</h2><button onClick={onClose}>{tx('Fechar')}</button></div>
      {prof?.mode === 'profiles' && prof.current && <section className="card"><h3>{tx('Perfil')}</h3><ProfileManage prof={prof} onSwitch={onSwitch} onNew={onNew} /></section>}
      <section className="card"><h3>{tx('Língua')}</h3><LangPick />
        <p className="muted small">{tx('Os nomes e os textos das cartas ficam em inglês (dados do Scryfall).')} {tx('A escolha fica guardada neste browser.')}</p></section>
      <section className="card"><h3>{tx('Jogos do Forge ao mesmo tempo')}</h3><ForgeGames /></section>
      <section className="card"><h3>{tx('Som')}</h3><Sound /></section>
      <section className="card"><h3>{tx('Estrelas dos decks')}</h3><StarLayers /></section>
      <section className="card"><h3>{tx('Torneios')}</h3><TourHold /><NextMode /><p className="muted small">{tx('Ao ver um torneio ao vivo, que jogo abre quando o que estás a ver acaba.')}</p></section>
      <section className="card"><h3>{tx('Dados e cópias')}</h3><DataSync prof={prof} /></section>
    </div>
  )
}

// torneios novos: começam sozinhos 10 s depois de criados (tempo para apostar) ou só com o OK (escolha guardada)
function TourHold() {
  const K = 'grimorio.torneio.hold'
  const [on, setOn] = useState(() => { try { return localStorage.getItem(K) === '1' } catch { return false } })
  const set = v => { setOn(v); try { localStorage.setItem(K, v ? '1' : '0') } catch { /* sem armazenamento */ } }
  return (
    <>
      <label className="chk"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} /> {tx('Só começar quando eu der OK')}</label>
      <p className="muted small">{tx('Sem isto, o torneio espera 10 s antes do 1.º jogo para dar tempo de apostar')}</p>
    </>
  )
}

// que camadas de estrelas aparecem nos decks (por omissão as três); pelo menos uma fica sempre ligada
function StarLayers() {
  const [on, setOn] = useState(getStarLayers)
  const flip = k => { const n = on.includes(k) ? on.replace(k, '') : on + k; if (!n) return; setStarLayers(n); setOn(getStarLayers()) }
  const L = [['y', '#f2b84b', tx('Amarelas — rating normal (jogos não casuais)')], ['b', '#4ea8ff', tx('Azuis — todos os jogos, casuais incluídos')], ['r', '#ff4d5e', tx('Vermelhas — objetivo (quanto chega a ganhar)')]]
  return (
    <>
      {L.map(([k, c, l]) => <label key={k} className="chk"><input type="checkbox" checked={on.includes(k)} disabled={on === k} onChange={() => flip(k)} /> <i className="st-dot" style={{ background: c }} /> {l}</label>)}
      <p className="muted small">{tx('A primeira cor ligada enche as estrelas e dá o número. Por omissão aparecem as três.')} {on !== 'ybr' && <button className="link small" onClick={() => { setStarLayers('ybr'); setOn('ybr') }}>{tx('Repor as três')}</button>}</p>
    </>
  )
}
