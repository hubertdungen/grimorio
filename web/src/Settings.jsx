// Definições: perfil (edições sem login), língua, jogos do Forge em simultâneo (com sugestão pela RAM livre agora), som e
// dados (exportar/importar uma cópia e, opcional, sincronizar com uma pasta na nuvem: backup.py).
import { useEffect, useRef, useState } from 'react'
import { ask, ConfirmSettings } from './confirm.jsx'
import { tx, num, LOCALE } from './i18n.js'
import { LangPick, ProfileManage } from './Profiles.jsx'
import { getStarLayers, setStarLayers, useColors, setColors, COLORS0 } from './ui.jsx'
import { getSettings, setEnabled, setVolume, play } from './sfx.js'
import { NextMode, HighlightMine } from './Tournament.jsx'
import Friends from './Friends.jsx'
import AIKeys from './AIKeys.jsx'
import { BasicSettings } from './Basics.jsx'
import { getBasicDefaults, setBasicDefaults } from './data.js'
import { DIFF_INFO, getBots, setBots } from './difficulty.js'

const PER_GAME = 900, RESERVE = 1000  // MB: ~0,9 GB por jogo do Forge; 1 GB fica para o sistema e o browser
// quantos jogos cabem na RAM livre agora; os que já correm contam como livres (a memória deles é deles)
const recommend = st => Math.max(1, Math.min(st.max || 6, Math.floor((st.mem_free + st.running * PER_GAME - RESERVE) / PER_GAME)))
const gb = mb => num(mb / 1000, 1)

// bots predefinidos: que perfil da IA joga o teu deck e os adversários no Laboratório, nos torneios e na Arena
function DefaultBots() {
  const [diffs, setDiffs] = useState([]), [b, setB] = useState(getBots), [arena, setArena] = useState(null), [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/sim/difficulties').then(r => r.json()).then(setDiffs).catch(() => setErr(tx('O servidor não respondeu.')))
    fetch('/api/arena').then(r => (r.ok ? r.json() : null)).then(setArena).catch(() => {})
  }, [])
  const put = (k, side, v) => { const n = { ...b, [k]: { ...b[k], [side]: v } }; setB(n); setBots(n) }
  const putArena = v => fetch('/api/arena', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) }).then(r => r.json()).then(setArena).catch(() => setErr(tx('O servidor não respondeu.')))
  // '' = Normal (o perfil «default» fica nessa opção); na Arena os adversários podem ser «ao acaso»
  const opts = random => <><option value="">{tx('Normal')}</option>{diffs.filter(d => d.id !== 'default' && (random || d.id !== 'random')).map(d => <option key={d.id} value={d.id}>{DIFF_INFO[d.id]?.label || d.label}</option>)}</>
  const row = (label, a, setA, bb, setBb, hint, random = false) => (
    <tr><th title={hint}>{label}</th>
      <td><select value={a} onChange={e => setA(e.target.value)} aria-label={tx('{m}: o teu deck', { m: label })}>{opts(false)}</select></td>
      <td><select value={bb} onChange={e => setBb(e.target.value)} aria-label={tx('{m}: adversários', { m: label })}>{opts(random)}</select></td></tr>
  )
  return (
    <>
      <p className="muted small">{tx('O perfil da IA que joga cada lado quando abres o Laboratório, crias um torneio ou a Arena joga. Podes mudar em cada jogo; isto é só o ponto de partida.')}</p>
      <table className="bots-tbl"><thead><tr><th /><th>{tx('O teu deck')}</th><th>{tx('Adversários')}</th></tr></thead><tbody>
        {row(tx('Laboratório'), b.lab.a, v => put('lab', 'a', v), b.lab.b, v => put('lab', 'b', v), tx('Testes contra bots'))}
        {row(tx('Torneios'), b.torneio.a, v => put('torneio', 'a', v), b.torneio.b, v => put('torneio', 'b', v), tx('Os teus decks e os outros participantes'))}
        {arena?.mine !== false && arena && row('Arena', arena.difficulty_mine || '', v => putArena({ difficulty_mine: v }), arena.difficulty === 'default' ? '' : arena.difficulty || '', v => putArena({ difficulty: v || 'default' }), tx('Guardado no servidor: vale para a Arena automática'), true)}
      </tbody></table>
      {err && <p className="small bad-t">{err}</p>}
    </>
  )
}

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
  const save = o => fetch('/api/sim/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json()).then(setSt)
  const set = n => save({ parallel: n })
  const rec = recommend(st)
  return (
    <>
      <div className="seg-pick" role="radiogroup" aria-label={tx('Jogos do Forge ao mesmo tempo')}>
        {Array.from({ length: st.max || 6 }, (_, k) => k + 1).map(n => <button key={n} role="radio" aria-checked={st.parallel === n} className={st.parallel === n ? 'on' : ''} onClick={() => set(n)}>
          {n}{n === rec && <small>{tx('sugerido')}</small>}</button>)}
      </div>
      <p className="small">{tx('Sugestão agora: {n} jogo|Sugestão agora: {n} jogos', { n: rec })} · <span className="muted">{tx('~0,9 GB por jogo; {free} GB livres agora, 1 GB fica para o sistema.', { free: gb(st.mem_free) })}
        {st.running > 0 && ` ${tx('{n} jogo a correr (já conta).|{n} jogos a correr (já contam).', { n: st.running })}`}</span></p>
      {st.parallel > rec && <p className="small warn-t">⚠ {tx('Escolheste mais do que a RAM livre aguenta agora: os jogos extra esperam até haver {min} GB livres, e o computador pode ficar lento.', { min: gb(st.mem_min) })}</p>}
      <p className="muted small">{tx('Vale para os testes do Laboratório, os torneios e a Arena. Cada jogo usa também quase um núcleo do processador.')}</p>
      <h4 className="fg-dist">{tx('Com vários torneios ao mesmo tempo')}</h4>
      <div className="fg-row">
        <label className="fmt"><span>{tx('Prioridade')}</span><select value={st.dist} onChange={e => save({ dist: e.target.value })}>
          <option value="antigo">{tx('o torneio mais antigo')}</option><option value="recente">{tx('o torneio mais recente')}</option></select></label>
        <label className="fmt"><span>{tx('Jogos por torneio')}</span><select value={st.quota} onChange={e => save({ quota: +e.target.value })}>
          <option value={0}>{tx('todos (acaba um de cada vez)')}</option>
          {Array.from({ length: Math.max(1, st.parallel - 1) }, (_, k) => k + 1).map(n => <option key={n} value={n}>{n === 1 ? tx('1 (repartir por todos)') : tx('até {n}', { n })}</option>)}</select></label>
      </div>
      <label className="chk small"><input type="checkbox" checked={!!st.arena} disabled={st.parallel < 2} onChange={e => save({ arena: e.target.checked })} /> {tx('A Arena joga durante os torneios (fica com um dos lugares)')}</label>
      <p className="muted small">{st.quota ? tx('Cada torneio joga até {q} ao mesmo tempo, começando pelo {o}; os lugares que sobram vão para quem ainda tiver partidas.', { q: st.quota, o: st.dist === 'recente' ? tx('mais recente') : tx('mais antigo') }) : tx('O {o} usa todos os lugares que conseguir; os outros só jogam com o que sobrar.', { o: st.dist === 'recente' ? tx('mais recente') : tx('mais antigo') })}{' '}{st.arena && st.parallel > 1 ? tx('A Arena fica sempre com um lugar.') : tx('A Arena só joga quando não há torneios.')}</p>
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
    if (replace && !(await ask('copia', { title: tx('Substituir TUDO o que está nesta instalação pela cópia? (a base atual fica guardada ao lado, por segurança)'), ok: tx('Substituir') }))) return
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

// índice à esquerda (ou barra no topo, no telemóvel): salta para cada secção; o filtro esconde as que não batem
function SetIndex({ box }) {
  const [secs, setSecs] = useState([]), [q, setQ] = useState('')
  useEffect(() => {
    const all = [...(box.current?.querySelectorAll('section.card') || [])]
    all.forEach((s, k) => { s.id ||= `set-${k}` })
    setSecs(all.map(s => ({ id: s.id, t: s.querySelector('h3')?.textContent || '' })))
  }, [box])
  useEffect(() => {
    const n = q.trim().toLowerCase()
    for (const s of box.current?.querySelectorAll('section.card') || []) s.hidden = !!n && !s.textContent.toLowerCase().includes(n)
  }, [q, box])
  const n = q.trim().toLowerCase()
  return (
    <nav className="set-index" aria-label={tx('Secções')}>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Filtrar definições…')} aria-label={tx('Filtrar definições')} />
      {secs.filter(s => !n || !document.getElementById(s.id)?.hidden).map(s => <button key={s.id} className="link plain" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{s.t}</button>)}
    </nav>
  )
}

export default function Settings({ prof, onClose, onSwitch, onNew }) {
  const box = useRef(null)
  return (
    <div className="view settings set-layout">
      <div className="set-head"><h2>⚙ {tx('Definições')}</h2><button onClick={onClose}>{tx('Fechar')}</button></div>
      <SetIndex box={box} />
      <div className="set-main" ref={box}>
      {prof?.mode === 'profiles' && prof.current && <section className="card"><h3>{tx('Perfil')}</h3><ProfileManage prof={prof} onSwitch={onSwitch} onNew={onNew} /></section>}
      <section className="card"><h3>{tx('Língua')}</h3><LangPick />
        <p className="muted small">{tx('Os nomes e os textos das cartas ficam em inglês (dados do Scryfall).')} {tx('A escolha fica guardada neste browser.')}</p></section>
      <section className="card"><h3>{tx('Jogos do Forge ao mesmo tempo')}</h3><ForgeGames /></section>
      <section className="card"><h3>{tx('🤖 Bots predefinidos')}</h3><DefaultBots /></section>
      <section className="card"><h3>{tx('Som')}</h3><Sound /></section>
      <section className="card"><h3>{tx('Estrelas dos decks')}</h3><StarLayers /></section>
      <section className="card"><h3>{tx('Cores nos jogos')}</h3><GameColors /></section>
      <section className="card"><h3>{tx('Terrenos básicos')}</h3><BasicSettings getDefaults={getBasicDefaults} setDefaults={setBasicDefaults} ask={ask} /></section>
      <section className="card"><h3>{tx('Confirmações')}</h3><p className="muted small">{tx('Perguntar antes de:')}</p><ConfirmSettings /></section>
      <section className="card"><h3>{tx('🤖 IA')}</h3><AIKeys /></section>
      <section className="card"><h3>{tx('🤝 Amigos')}</h3><Friends /></section>
      <section className="card"><h3>{tx('Torneios')}</h3><TourHold /><NextMode /><HighlightMine /><p className="muted small">{tx('Ao ver um torneio ao vivo, que jogo abre quando o que estás a ver acaba.')}</p></section>
      <section className="card danger-zone"><h3>{tx('Recomeçar')}</h3><ResetStats /></section>
      <section className="card"><h3>{tx('Dados e cópias')}</h3><DataSync prof={prof} /></section>
      <section className="card"><h3>{tx('Atualizações')}</h3><Updates /></section>
      </div>
    </div>
  )
}

// pacotes (exe/Linux): o launcher descarrega a versão nova em segundo plano e passa para ela no arranque seguinte
function Updates() {
  const [u, setU] = useState(null)
  useEffect(() => { fetch('/api/update').then(r => r.json()).then(setU).catch(() => setU({})) }, [])
  const setAuto = v => fetch('/api/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: v }) }).then(r => r.json()).then(setU).catch(() => {})
  if (!u) return null
  if (!u.packaged) return <p className="muted small">{tx('Num servidor ou a partir do código, atualiza-se com git pull e ./deploy.sh. A atualização automática é para os pacotes de Windows e Linux.')}</p>
  return (
    <div className="upd">
      <p>{tx('Versão instalada: {v}', { v: u.version })}{u.latest ? ` · ${tx('mais recente: {v}', { v: u.latest })}` : ''}</p>
      {u.ready ? <p className="ok-t">✓ {tx('A versão {v} já está descarregada: começa quando voltares a abrir o Grimório. Os teus decks e jogos passam para ela tal como estão (e fica uma cópia da base de dados em backups).', { v: u.ready })}</p>
        : u.downloading ? <p className="muted">{tx('A descarregar a versão {v}…', { v: u.downloading })}</p>
          : u.latest && u.latest === u.version ? <p className="muted small">{tx('Estás na versão mais recente.')}</p> : null}
      {u.err && <p className="small bad-t">{tx('Não deu para verificar ou descarregar: {e}', { e: u.err })}</p>}
      <label className="chk"><input type="checkbox" checked={u.auto} onChange={e => setAuto(e.target.checked)} /> {tx('Atualizar sozinho (descarrega em segundo plano e verifica a soma sha256)')}</label>
      {u.url && <a className="small" href={u.url} target="_blank" rel="noreferrer">{tx('Notas da versão')}</a>}
    </div>
  )
}

// torneios novos: começam sozinhos 10 s depois de criados (tempo para apostar) ou só com o OK (escolha guardada)
// a tua cor (também marca o teu deck nos torneios), a do adversário ou sem cor, e os jogos sem o teu deck
function GameColors() {
  const c = useColors()
  return (
    <div className="gcol">
      <label><input type="color" value={c.me} onChange={e => setColors({ me: e.target.value })} /> {tx('A tua cor')}</label>
      <label><input type="color" value={c.opp} disabled={!c.oppOn} onChange={e => setColors({ opp: e.target.value })} /> <input type="checkbox" checked={c.oppOn} onChange={e => setColors({ oppOn: e.target.checked })} /> {tx('Adversário com cor')}</label>
      <label className="fmt"><span>{tx('Jogos sem o teu deck')}</span>
        <select value={c.others} onChange={e => setColors({ others: e.target.value })}>
          <option value="aleatorio">{tx('cores aleatórias (cada deck sempre a mesma)')}</option>
          <option value="simples">{tx('sem cor')}</option>
        </select></label>
      <p className="muted small">{tx('A tua cor marca também o teu deck nos torneios (árvore, classificação, pódio).')} <button className="link small" onClick={() => setColors(COLORS0)}>{tx('repor as cores')}</button></p>
    </div>
  )
}

// Recomeçar os ratings dos meus decks ou os troféus — duas confirmações (a 2.ª obriga a escrever REPOR)
function ResetStats() {
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState('')
  const go = async (what, url, title, body, done) => {
    if (!(await ask('recomecar', { title, body, ok: tx('Continuar'), force: true }))) return
    if (!(await ask('recomecar', { title: tx('Tens a certeza? Isto não se desfaz.'), body, ok: tx('Repor'), force: true, typed: 'REPOR' }))) return
    setBusy(what); setMsg('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'REPOR' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.erro)
      setMsg(done(j))
    } catch (e) { setMsg(e.message) } finally { setBusy('') }
  }
  return (
    <div className="reset-set">
      <p className="muted small">{tx('Para começar do zero. Os jogos e os torneios ficam no registo.')}</p>
      <div className="row-btns">
        <button className="danger" disabled={!!busy} onClick={() => go('r', '/api/ratings/reset-all', tx('Repor os ratings de todos os teus decks?'),
          tx('As estrelas (amarelas, azuis, vermelhas e casuais) dos teus decks voltam ao início. Os jogos antigos ficam no histórico e continuam a contar para os adversários.'),
          j => tx('Ratings repostos em {n} decks.', { n: j.decks }))}>↺ {busy === 'r' ? tx('A repor…') : tx('Repor os ratings')}</button>
        <button className="danger" disabled={!!busy} onClick={() => go('t', '/api/tournaments/trophies-reset', tx('Repor os troféus de todos os decks?'),
          tx('Os troféus de agora deixam de contar (Biblioteca, hall da fama e galeria). Os torneios ficam no registo e os próximos voltam a dar troféus.'),
          () => tx('Troféus repostos.'))}>↺ {busy === 't' ? tx('A repor…') : tx('Repor os troféus')}</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
  )
}

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
