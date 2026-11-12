// Onde ficam os dados (devsync.py + backup.py): só neste aparelho (a base), uma pasta na nuvem ou o meu servidor Grimório.
// O assistente da primeira vez (StorageWizard) e Definições › Dados (DataPlace) usam a mesma escolha de três (StoragePicker).
// Também: ligar outro aparelho a este Grimório (código + link + QR), conflitos «(conflito)» e apagados que se podem repor.
import { useCallback, useEffect, useState } from 'react'
import { tx, LOCALE } from './i18n.js'
import { QR } from './Friends.jsx'
import { ask } from './confirm.jsx'
import './storage.css'

const getJ = url => fetch(url).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.erro || r.status), { code: j.code }); return j })
const postJ = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.erro || r.status), { code: j.code, data: j }); return j })

// as mensagens do servidor (devsync.py) pelo código, na língua de quem lê
const ERRS = () => ({
  code: tx('Este código não é válido ou já foi usado (dura 15 minutos e serve uma vez): gera outro no servidor.'),
  offline: tx('Não consegui chegar ao servidor: o endereço está certo e o servidor está ligado?'),
  proxy: tx('O servidor respondeu com uma página de login: o proxy tem de deixar passar /api/device/ e /ligar/ sem login (o token do aparelho já protege).'),
  bad: tx('Isto não parece um servidor Grimório (resposta estranha).'),
  link: tx('Cola o link que o servidor mostra (…/ligar/ABCD-EFGH) ou escreve o endereço e o código.'),
  slow: tx('Demasiadas tentativas: espera um minuto.'),
  profile: tx('Escolhe um perfil primeiro.'),
  unpaired: tx('Liga-te primeiro ao servidor com o link (ou o endereço e o código).'),
})
const errOf = (code, msg) => ERRS()[code] || msg
const RTF = (() => { try { return new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }) } catch { return null } })()
/** «há 2 minutos» / «daqui a 30 segundos» na língua ativa. */
export function rel(ts) {
  if (!ts) return '—'
  const s = ts - Date.now() / 1000, a = Math.abs(s)
  const [n, u] = a < 45 ? [s, 'second'] : a < 2700 ? [s / 60, 'minute'] : a < 86400 ? [s / 3600, 'hour'] : [s / 86400, 'day']
  return RTF ? RTF.format(Math.round(n), u) : new Date(ts * 1000).toLocaleString(LOCALE)
}
const when = ts => (ts ? new Date(ts * 1000).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' }) : '—')

/** /api/storage com atualização periódica (mais depressa enquanto sincroniza). */
export function useStorage(on = true) {
  const [st, setSt] = useState(null)
  const load = useCallback(() => getJ('/api/storage').then(setSt).catch(() => {}), [])
  useEffect(() => {
    if (!on) return
    load()
    const iv = setInterval(load, st?.server?.state === 'syncing' ? 2000 : 15000)
    return () => clearInterval(iv)
  }, [on, load, st?.server?.state])
  return [st, setSt, load]
}

/** A janela dos pacotes para computador (pywebview): {mode: 'local'|'remote', local, remote} — null num browser. */
export function useDesktop() {
  const [d, setD] = useState(null)
  useEffect(() => {
    let off = false
    const get = () => window.pywebview?.api?.storage?.().then(x => { if (!off) setD(x) }).catch(() => {})
    if (window.pywebview?.api?.storage) get()
    else window.addEventListener('pywebviewready', get, { once: true })
    return () => { off = true; window.removeEventListener('pywebviewready', get) }
  }, [])
  return d
}

/** A frase do estado: «Servidor hubert · sincronizado há 2 minutos», «sem ligação», «atualiza este aparelho…». */
export function SyncLine({ st }) {
  if (!st) return null
  const s = st.server
  if (st.mode === 'local') return <p className="sto-line"><span className="sto-dot off" /><span className="sto-t">{tx('Só neste aparelho: nada está ligado.')}</span></p>
  if (st.mode === 'folder') {
    const f = st.folder || {}
    if (f.newer) return <p className="sto-line bad"><span className="sto-dot bad" /><span className="sto-t">{tx('Outro aparelho tem uma versão mais nova: atualiza este para a versão {v} ou mais recente.', { v: f.newer })}</span></p>
    return <p className={`sto-line ${f.error ? 'bad' : ''}`}><span className={`sto-dot ${f.error ? 'bad' : 'ok'}`} /><span className="sto-t">{f.error ? tx('Pasta na nuvem: {e}', { e: tx(f.error) }) : tx('Pasta na nuvem · sincronizado {t}', { t: rel(st.sync?.last_ok) })}</span></p>
  }
  const name = s?.name || s?.url
  const line = {
    ok: [tx('Servidor «{n}» · sincronizado {t}', { n: name, t: rel(s?.last_ok) }), 'ok'],
    syncing: [tx('Servidor «{n}» · a sincronizar…', { n: name }), 'busy'],
    offline: [tx('Servidor «{n}» · sem ligação (os dados daqui continuam a funcionar; tenta outra vez {t})', { n: name, t: rel(s?.next) }), 'warn'],
    error: [tx('Servidor «{n}» · erro: {e}', { n: name, e: errOf(s?.err_code, s?.err || '') }), 'bad'],
    revoked: [tx('O servidor já não aceita este aparelho (a ligação foi revogada). Liga-o outra vez com um código novo.'), 'bad'],
    incompatible: [s?.side === 'server' ? tx('O servidor tem uma versão antiga: atualiza-o para a versão {v} ou mais recente. Até lá nada se junta.', { v: s?.need })
      : tx('O servidor tem uma versão mais nova: atualiza este aparelho para a versão {v} ou mais recente. Até lá nada se junta.', { v: s?.need }), 'bad'],
  }[s?.state] || [tx('Servidor «{n}»', { n: name }), 'busy']
  return <p className={`sto-line ${line[1]}`} role="status"><span className={`sto-dot ${line[1]}`} /><span className="sto-t">{line[0]}</span>{st.mode === 'remote' && <span className="sto-chip">{tx('a abrir o servidor diretamente')}</span>}</p>
}

const OPTS = () => [
  ['local', '💻', tx('Só neste aparelho'), tx('Tudo fica guardado aqui e funciona sem internet. Nada se liga a lado nenhum.'), tx('Recomendado')],
  ['folder', '☁', tx('Sincronizar com uma pasta na nuvem'), tx('Uma app grátis de nuvem (Google Drive, OneDrive, Dropbox, Syncthing, Nextcloud) leva os teus dados para os outros computadores.')],
  ['server', '🖧', tx('Ligar ao meu servidor Grimório'), tx('Se tens o Grimório num NAS ou num PC sempre ligado, este aparelho junta-se a ele por um link.')],
]

/** Os três cartões (escolhe-se UM). value: 'local' | 'folder' | 'server'. */
export function ChoiceCards({ value, onChange, current, can }) {
  return (
    <div className="sto-cards" role="radiogroup" aria-label={tx('Onde ficam os teus dados?')}>
      {OPTS().map(([k, ic, t, d, tag]) => {
        const dis = k !== 'local' && can && !can[k]
        return (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={dis} className={`sto-card ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>
            <span className="sto-radio" aria-hidden="true" />
            <span className="sto-ic" aria-hidden="true">{ic}</span>
            <span className="sto-txt"><b>{t}</b>{tag && <span className="sto-tag">{tag}</span>}{current === k && <span className="sto-tag cur">{tx('agora')}</span>}<small>{d}</small></span>
          </button>
        )
      })}
    </div>
  )
}

function FolderPanel({ st, folder, setFolder }) {
  const cands = st?.folder?.candidates || []
  return (
    <div className="sto-panel">
      <p className="small">{tx('Escolhe uma pasta que uma app de nuvem mantém igual em todos os teus computadores. Cada aparelho escreve lá só o seu ficheiro e junta os dos outros; sem rede continuas a usar tudo.')}</p>
      <label className="sto-field"><span>{tx('Pasta')}</span><input value={folder} onChange={e => setFolder(e.target.value)} placeholder={tx('Pasta, p.ex. G:\\My Drive\\Grimorio ou ~/Dropbox/Grimorio')} /></label>
      {cands.length > 0 && <p className="small">{tx('Encontrei neste computador:')} {cands.map(c => <button key={c.folder} type="button" className="sto-pill" onClick={() => setFolder(c.folder)} title={c.folder}>{c.app}</button>)}</p>}
      <p className="muted small">{tx('Funciona com Google Drive para computador, OneDrive, Dropbox, Syncthing, Nextcloud ou iCloud Drive (instala a app deles primeiro).')}</p>
    </div>
  )
}

function ServerPanel({ st, link, setLink, manual, setManual, url, setUrl, code, setCode, open, setOpen, desktop }) {
  const paired = st?.server
  return (
    <div className="sto-panel">
      <details className="sto-what" open={!paired}>
        <summary>{tx('O que é um servidor Grimório?')}</summary>
        <p className="small">{tx('É o Grimório instalado num computador que fica sempre ligado (um NAS, um mini-PC, o PC de casa). Os teus aparelhos juntam lá os dados e cada um continua a funcionar sozinho, mesmo sem rede. É opcional: sem servidor tudo funciona igual.')}</p>
      </details>
      {paired && <p className="small">{tx('Ligado a «{n}» em {u}.', { n: paired.name || '?', u: paired.url })}</p>}
      <p className="small"><b>1.</b> {tx('No servidor, abre Definições › Dados › «Ligar um aparelho» e gera um código.')} <b>2.</b> {tx('Cola aqui o link (ou lê o QR com o telemóvel).')}</p>
      {!manual ? <label className="sto-field"><span>{tx('Link do servidor')}</span><input value={link} onChange={e => setLink(e.target.value)} placeholder="http://192.168.1.10:8107/ligar/ABCD-EFGH" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" /></label>
        : <div className="sto-two">
          <label className="sto-field"><span>{tx('Endereço do servidor')}</span><input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.10:8107" autoCapitalize="off" spellCheck={false} inputMode="url" /></label>
          <label className="sto-field sto-code"><span>{tx('Código')}</span><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" maxLength={9} autoCapitalize="characters" spellCheck={false} /></label>
        </div>}
      <button type="button" className="link small" onClick={() => setManual(!manual)}>{manual ? tx('Tenho o link') : tx('Tenho o endereço e o código')}</button>
      <div className="sto-sub" role="radiogroup" aria-label={tx('Como usar o servidor')}>
        <label className={!open ? 'on' : ''}><input type="radio" checked={!open} onChange={() => setOpen(false)} /> <span><b>{tx('Sincronizar com este aparelho')}</b> <span className="sto-tag">{tx('Recomendado')}</span><small>{tx('Os dados ficam aqui e no servidor. Sem rede continuas a jogar; junta-se tudo quando a ligação voltar.')}</small></span></label>
        <label className={open ? 'on' : ''}><input type="radio" checked={open} onChange={() => setOpen(true)} /> <span><b>{tx('Usar o servidor diretamente')}</b><small>{desktop || window.GrimorioApp ? tx('Esta janela abre o servidor. Os dados deste aparelho ficam guardados (e sincronizados), e voltas a eles em Definições › Dados.') : tx('Abre o servidor em vez do Grimório deste aparelho (na app para computador, a janela abre-o sempre). Os dados daqui ficam guardados.')}</small></span></label>
      </div>
    </div>
  )
}

/** A escolha de três com o painel da opção escolhida e o botão que a aplica. onDone(status) depois de aplicar. */
export function StoragePicker({ st, onDone, initialLink = '', first = false, onLater }) {
  const desktop = useDesktop()
  const cur = st?.mode === 'remote' ? 'server' : st?.mode || 'local'
  const [sel, setSel] = useState(initialLink ? 'server' : first ? 'local' : cur)
  const [folder, setFolder] = useState(st?.folder?.folder || '')
  const [link, setLink] = useState(initialLink), [manual, setManual] = useState(false), [url, setUrl] = useState(''), [code, setCode] = useState('')
  const [open, setOpen] = useState(st?.mode === 'remote')
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [http, setHttp] = useState(false), [relink, setRelink] = useState(false)
  useEffect(() => { if (!folder && st?.folder?.folder) setFolder(st.folder.folder) }, [st?.folder?.folder]) // eslint-disable-line react-hooks/exhaustive-deps
  const paired = !!st?.server && !relink
  const run = async f => { setBusy(true); setErr(''); try { await f() } catch (e) { setErr(e.code === 'http' ? '' : errOf(e.code, e.message)); if (e.code === 'http') setHttp(true) } finally { setBusy(false) } }
  const goRemote = s => {
    if (!s?.remote_url) return
    if (window.pywebview?.api?.use_remote) window.pywebview.api.use_remote()
    else if (window.GrimorioApp?.useRemote) window.GrimorioApp.useRemote(s.remote_url)
    else window.location.href = s.remote_url
  }
  const apply = (okHttp = false) => run(async () => {
    let s
    if (sel === 'local') {
      if (cur !== 'local' && !first && !(await ask('sto-local', { title: tx('Deixar de sincronizar?'), body: tx('Os dados deste aparelho ficam todos aqui. O que está na nuvem ou no servidor também fica lá.'), ok: tx('Só neste aparelho') }))) return
      s = await postJ('/api/storage', { mode: 'local' })
    } else if (sel === 'folder') {
      if (!folder.trim()) throw new Error(tx('Escolhe a pasta.'))
      s = await postJ('/api/storage', { mode: 'folder', folder })
    } else if (paired) {
      s = await postJ('/api/storage', { mode: open ? 'remote' : 'server' })
    } else {
      if (!(manual ? url.trim() && code.trim() : link.trim())) throw new Error(tx('Cola o link que o servidor mostra (…/ligar/ABCD-EFGH) ou escreve o endereço e o código.'))
      s = await postJ('/api/storage/pair', manual ? { url, code, open, insecure_ok: okHttp } : { link, open, insecure_ok: okHttp })
      setHttp(false); setRelink(false)
    }
    onDone?.(s)
    if (s.mode === 'remote' && (cur !== 'server' || st?.mode !== 'remote')) setTimeout(() => goRemote(s), 600)
  })
  const label = sel === 'local' ? (first ? tx('Começar') : tx('Usar só este aparelho')) : sel === 'folder' ? tx('Usar esta pasta') : paired ? tx('Guardar') : tx('Ligar ao servidor')
  return (
    <div className="sto-picker">
      <ChoiceCards value={sel} onChange={k => { setSel(k); setErr('') }} current={first ? null : cur} can={st?.can} />
      {sel === 'folder' && <FolderPanel st={st} folder={folder} setFolder={setFolder} />}
      {sel === 'server' && (paired ? <div className="sto-panel">
        <p className="small">{tx('Ligado a «{n}» em {u}.', { n: st.server.name || '?', u: st.server.url })} <button type="button" className="link small" onClick={() => setRelink(true)}>{tx('Ligar a outro servidor')}</button></p>
        <div className="sto-sub" role="radiogroup" aria-label={tx('Como usar o servidor')}>
          <label className={!open ? 'on' : ''}><input type="radio" checked={!open} onChange={() => setOpen(false)} /> <span><b>{tx('Sincronizar com este aparelho')}</b><small>{tx('Os dados ficam aqui e no servidor. Sem rede continuas a jogar; junta-se tudo quando a ligação voltar.')}</small></span></label>
          <label className={open ? 'on' : ''}><input type="radio" checked={open} onChange={() => setOpen(true)} /> <span><b>{tx('Usar o servidor diretamente')}</b><small>{tx('Esta janela abre o servidor. Os dados deste aparelho ficam guardados (e sincronizados), e voltas a eles em Definições › Dados.')}</small></span></label>
        </div>
      </div> : <ServerPanel {...{ st, link, setLink, manual, setManual, url, setUrl, code, setCode, open, setOpen, desktop }} />)}
      {http && <div className="sto-warn" role="alert"><b>⚠ {tx('Ligação sem cifra pela internet')}</b><p className="small">{tx('Este endereço é http:// pela internet: o código e os teus dados passam sem cifra. Usa https:// (ou a rede de casa / meshnet).')}</p>
        <div className="row-btns"><button type="button" onClick={() => setHttp(false)}>{tx('Corrigir o endereço')}</button><button type="button" className="danger" disabled={busy} onClick={() => apply(true)}>{tx('Ligar mesmo assim')}</button></div></div>}
      {err && <p className="small bad-t" role="alert">{err}</p>}
      <div className="sto-foot">
        {onLater && <button type="button" className="link plain" onClick={onLater}>{tx('Decidir depois')}</button>}
        <button type="button" className="primary" disabled={busy || (sel === cur && sel !== 'server' && !first && !(sel === 'folder' && folder !== st?.folder?.folder))} onClick={() => apply(false)}>{busy ? tx('A ligar…') : label}</button>
      </div>
    </div>
  )
}

/** Assistente da primeira vez (instalação nova) — também se abre em Definições › Dados. */
export function StorageWizard({ st, onClose, initialLink = '' }) {
  const [done, setDone] = useState(null), [s2, , reload] = useStorage(!!done)
  const later = () => postJ('/api/storage', { chosen: true }).catch(() => {}).finally(onClose)
  const cur = s2 || done
  return (
    <div className="sto-wiz" role="dialog" aria-modal="true" aria-labelledby="sto-wiz-t">
      <div className="sto-wiz-box">
        <h2 id="sto-wiz-t">{tx('Onde ficam os teus dados?')}</h2>
        {!done ? <>
          <p className="muted">{tx('Os teus decks, torneios e ratings ficam sempre guardados neste aparelho. Se quiseres, também os levas para outros aparelhos. Podes mudar isto quando quiseres em Definições › Dados.')}</p>
          <StoragePicker st={st} first initialLink={initialLink} onLater={later} onDone={s => { if (s.mode === 'local') onClose(); else { setDone(s); reload() } }} />
        </> : <div className="sto-done">
          <p className="sto-big">✓ {cur?.mode === 'folder' ? tx('Pasta ligada.') : tx('Ligado ao servidor.')}</p>
          <SyncLine st={cur} />
          {cur?.server?.state === 'syncing' && <p className="muted small">{tx('A primeira vez pode demorar um pouco (traz tudo o que está no servidor). Podes ir usando a app.')}</p>}
          <div className="sto-foot"><button type="button" className="primary" onClick={onClose}>{tx('Feito')}</button></div>
        </div>}
      </div>
    </div>
  )
}

/** Ligar outro aparelho a ESTE Grimório (o lado do servidor): código, link, QR e a lista dos aparelhos ligados. */
function LinkDevice() {
  const [list, setList] = useState(null), [code, setCode] = useState(null), [err, setErr] = useState(''), [copied, setCopied] = useState(false)
  const load = () => getJ('/api/devices').then(j => setList(j.devices)).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  const local = /^(127\.|localhost|\[::1\])/.test(window.location.hostname)
  const link = code && `${window.location.origin}/ligar/${code.code}`
  const gen = () => postJ('/api/devices/code').then(c => { setCode(c); setCopied(false); setErr('') }).catch(e => setErr(e.message))
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setCopied(false) } }
  const revoke = async d => { if (await ask('sto-revoke', { title: tx('Desligar «{n}»?', { n: d.name }), body: tx('Esse aparelho deixa de sincronizar com este Grimório. Os dados dele ficam lá.'), ok: tx('Desligar') })) postJ(`/api/devices/${d.id}/revoke`).then(load).catch(e => setErr(e.message)) }
  const live = (list || []).filter(d => !d.revoked)
  return (
    <div className="sto-link">
      <p className="small">{tx('Usa este Grimório como servidor: gera um código e, no outro aparelho, escolhe «Ligar ao meu servidor Grimório». Só esse aparelho fica com acesso, e só aos teus dados.')}</p>
      {local && <p className="small warn-t">{tx('Este endereço só funciona neste computador. Para outro aparelho usar o link, abre o Grimório pelo endereço da rede (ou o público) e gera o código lá.')}</p>}
      <button type="button" onClick={gen}>🔗 {code ? tx('Gerar outro código') : tx('Ligar um aparelho')}</button>
      {code && <div className="sto-code-box">
        <div><span className="muted small">{tx('Código (15 minutos, uma vez)')}</span><div className="sto-codetxt">{code.code}</div>
          <span className="muted small">{tx('Endereço')}</span><div><code>{window.location.origin}</code></div>
          <div className="row-btns"><input readOnly value={link} onFocus={e => e.target.select()} aria-label={tx('Link do servidor')} /><button type="button" onClick={copy}>{copied ? tx('Copiado ✓') : tx('Copiar link')}</button></div>
          {window.location.protocol === 'http:' && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.|localhost)/.test(window.location.hostname) && window.location.hostname.includes('.') && <p className="small warn-t">{tx('Este endereço é http:// pela internet: o código e os teus dados passam sem cifra. Usa https:// (ou a rede de casa / meshnet).')}</p>}
        </div>
        <QR text={link} />
      </div>}
      {live.length > 0 && <ul className="sto-devs">{live.map(d => <li key={d.id}><span>📱 <b>{d.name}</b> <span className="muted small">{tx('ligado {t} · última vez {s}', { t: when(d.created), s: rel(d.last_seen) })}</span></span><button type="button" className="small danger" onClick={() => revoke(d)}>{tx('Desligar')}</button></li>)}</ul>}
      {err && <p className="small bad-t">{err}</p>}
    </div>
  )
}

/** Cópias «(conflito)» por resolver: ficar com a atual, com a outra ou com as duas. */
function Conflicts({ onChange }) {
  const [list, setList] = useState(null), [err, setErr] = useState('')
  const load = () => getJ('/api/storage/conflicts').then(j => setList(j.conflicts)).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const keep = (c, k) => postJ(`/api/storage/conflicts/${c.id}`, { keep: k }).then(() => { load(); onChange?.() }).catch(e => setErr(e.message))
  if (!list?.length) return null
  return (
    <div className="sto-conf">
      <h4>⚠ {tx('Conflitos')} <span className="sto-n">{list.length}</span></h4>
      <p className="muted small">{tx('O mesmo deck mudou em dois aparelhos antes de se juntarem. Ficaram as duas versões: escolhe com qual ficas.')}</p>
      {list.map(c => (
        <div key={c.id} className="sto-conf-row">
          <div className="sto-vs">
            <div><span className="muted small">{tx('Atual')}</span><b>{c.mine?.name || tx('(apagado)')}</b><small>{when(c.mine?.updated)} · {tx('{n} cartas', { n: c.mine?.cards ?? 0 })}</small></div>
            <div><span className="muted small">{tx('A do conflito')}</span><b>{c.other.name}</b><small>{when(c.other.updated)} · {tx('{n} cartas', { n: c.other.cards })}</small></div>
          </div>
          {c.diff?.length > 0 && <p className="sto-diff small">{tx('A do conflito tem:')} {c.diff.map(([n, d]) => <span key={n} className={d > 0 ? 'good-t' : 'bad-t'}>{d > 0 ? '+' : '−'}{Math.abs(d)} {n}</span>)}</p>}
          <div className="row-btns">
            <button type="button" onClick={() => keep(c, 'mine')}>{tx('Ficar com a atual')}</button>
            <button type="button" onClick={() => keep(c, 'other')}>{tx('Ficar com a do conflito')}</button>
            <button type="button" onClick={() => keep(c, 'both')}>{tx('Ficar com as duas')}</button>
          </div>
        </div>
      ))}
      {err && <p className="small bad-t">{err}</p>}
    </div>
  )
}

const KIND = () => ({ tournament: tx('Torneio'), sim_run: tx('Sessão de testes'), profile: tx('Perfil') })

/** Apagados de vez nos últimos 30 dias (torneios, sessões de testes, perfis): repor. Os decks têm o lixo da Biblioteca. */
function Deleted() {
  const [list, setList] = useState(null), [err, setErr] = useState('')
  const load = () => getJ('/api/storage/deleted').then(j => setList(j.deleted)).catch(() => setList([]))
  useEffect(() => { load() }, [])
  if (!list?.length) return null
  return (
    <details className="sto-del">
      <summary>{tx('Apagados recentemente')} <span className="sto-n">{list.length}</span></summary>
      <p className="muted small">{tx('Durante 30 dias podes repor o que apagaste (também volta nos outros aparelhos). Os decks estão no lixo da Biblioteca.')}</p>
      <ul>{list.map(d => <li key={d.kind + d.id}><span><span className="muted small">{KIND()[d.kind] || d.kind}</span> <b>{d.name}</b> <span className="muted small">{tx('apagado {t}', { t: rel(d.at) })}</span></span>
        <button type="button" className="small" onClick={() => postJ(`/api/storage/deleted/${d.kind}/${d.id}`).then(load).catch(e => setErr(e.message))}>↶ {tx('Repor')}</button></li>)}</ul>
      {err && <p className="small bad-t">{err}</p>}
    </details>
  )
}

/** Definições › Dados: onde ficam os dados (a mesma escolha do assistente), estado, conflitos, apagados e ligar aparelhos. */
export function DataPlace({ prof }) {
  const login = prof?.mode === 'login'
  const [st, setSt, load] = useStorage(true)
  const desktop = useDesktop()
  const [edit, setEdit] = useState(false), [wiz, setWiz] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const onRemote = desktop?.mode === 'remote' && desktop.local && !window.location.href.startsWith(desktop.local)
  const now = () => { setBusy(true); setErr(''); postJ('/api/storage/now').then(setSt).catch(e => setErr(e.message)).finally(() => setBusy(false)) }
  return (
    <div className="sto-place">
      {onRemote && <div className="sto-remote" role="note"><p className="small">🖧 {tx('Estás a usar o servidor diretamente. Os dados deste computador estão guardados à parte.')}</p>
        <button type="button" className="primary" onClick={() => window.pywebview.api.use_local()}>{tx('Voltar aos dados deste computador')}</button></div>}
      {!login && st && <>
        <SyncLine st={st} />
        {st.server?.insecure && <p className="small warn-t">{tx('Este endereço é http:// pela internet: o código e os teus dados passam sem cifra. Usa https:// (ou a rede de casa / meshnet).')}</p>}
        <div className="row-btns">
          {st.mode !== 'local' && <button type="button" disabled={busy} onClick={now}>⟳ {busy ? tx('A sincronizar…') : tx('Sincronizar agora')}</button>}
          {st.mode === 'remote' && !onRemote && <button type="button" onClick={() => (window.pywebview?.api?.use_remote ? window.pywebview.api.use_remote() : window.open(st.remote_url, '_blank', 'noopener'))}>🖧 {tx('Abrir o servidor')}</button>}
          <button type="button" aria-expanded={edit} onClick={() => setEdit(!edit)}>{edit ? tx('Fechar') : tx('Mudar onde ficam os dados…')}</button>
          <button type="button" className="link small" onClick={() => setWiz(true)}>{tx('Abrir o assistente')}</button>
        </div>
        {edit && <StoragePicker key={st.mode} st={st} onDone={s => { setSt(s); setEdit(false); setTimeout(load, 1500) }} />}
        {st.mode === 'server' || st.mode === 'remote' ? st.server?.pulled && <p className="muted small">{tx('Última vez: {n} decks novos e {u} atualizados daqui para lá; {a} novos e {b} atualizados de lá para cá.', { n: st.server.pushed?.decks_new ?? 0, u: st.server.pushed?.decks_updated ?? 0, a: st.server.pulled.decks_new ?? 0, b: st.server.pulled.decks_updated ?? 0 })}</p> : null}
        {err && <p className="small bad-t">{err}</p>}
      </>}
      {login && <p className="muted small">{tx('Com login, os dados vivem neste servidor: não há pasta nem servidor para ligar.')}</p>}
      <Conflicts onChange={load} />
      <Deleted />
      <h4>🔗 {tx('Ligar um aparelho')}</h4>
      <LinkDevice />
      {wiz && st && <StorageWizard st={st} onClose={() => { setWiz(false); load() }} />}
    </div>
  )
}
