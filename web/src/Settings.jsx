// Definições: perfil (edições sem login), língua, jogos do Forge em simultâneo (com sugestão pela RAM livre agora), som e
// dados (exportar/importar uma cópia e, opcional, sincronizar com uma pasta na nuvem: backup.py).
import { IL, Icon } from './icons.jsx'
import { MatPick } from './Board.jsx'
import { ApkUpdate } from './apkupdate.jsx'
import { fpPrefs, setFpPrefs, CARD_PX } from './fpprefs.js'
import { wakeOn, setWake, wakeSupported, fsOrientPref, setFsOrientPref } from './wakelock.js'
import { sfMode, setSfMode } from './data.js'
import { useEffect, useRef, useState } from 'react'
import { ask, ConfirmSettings } from './confirm.jsx'
import { tx, num, LOCALE } from './i18n.js'
import { LangPick, ProfileManage } from './Profiles.jsx'
import { getStarLayers, setStarLayers, useColors, setColors, COLORS0 } from './ui.jsx'
import { getSettings, setEnabled, setVolume, play, setGroupVolume, SOUND_GROUPS } from './sfx.js'
import { NextMode, HighlightMine } from './Tournament.jsx'
import Friends from './Friends.jsx'
import AIKeys from './AIKeys.jsx'
import { BasicSettings } from './Basics.jsx'
import { getBasicDefaults, setBasicDefaults } from './data.js'
import { DIFF_INFO, getBots, setBots } from './difficulty.js'
import { isTouch, gestures } from './touch.js'

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

function ImgSource() {
  const [m] = useState(sfMode)
  return (
    <>
      <label className="fmt"><span>{tx('De onde vêm as imagens')}</span>
        <select value={m} onChange={e => setSfMode(e.target.value)}>
          <option value="auto">{tx('Automático: da Scryfall; pelo Grimório se a rede a bloquear')}</option>
          <option value="on">{tx('Sempre pelo Grimório')}</option>
          <option value="off">{tx('Sempre diretas da Scryfall')}</option>
        </select>
      </label>
      <p className="muted small">{tx('Algumas redes (trabalho, escolas) bloqueiam scryfall.io e as cartas aparecem sem imagem. Pelo Grimório as imagens passam pelo teu servidor e ficam guardadas lá; é um pouco mais lento da primeira vez.')}</p>
    </>
  )
}

const Gestures = ({ rows }) => <dl className="tch-list">{rows.map(([g, d]) => <div key={g}><dt>{g}</dt><dd>{d}</dd></div>)}</dl>

function TableKeys() {
  const [p, setP] = useState(fpPrefs)
  const save = v => { setP(x => ({ ...x, ...v })); setFpPrefs(v) }
  const okKey = k => /^[a-z0-9]$/.test(k) && k !== 'p'  // P é a caneta na mesa livre
  const T = isTouch(), G = T && gestures()  // no toque: os gestos em vez das teclas (estas ficam guardadas para o teclado)
  return (
    <>
      {T ? <>
        <h4 className="tch-h">{tx('Controlos de toque')}</h4><Gestures rows={G.play} />
        <h4 className="tch-h">{tx('Na mesa livre (Online)')}</h4><Gestures rows={G.free} />
      </> : <>
      <label className="chk"><input type="checkbox" checked={p.space} onChange={e => save({ space: e.target.checked })} /> {tx('Espaço faz o mesmo que Enter (OK / passar)')}</label>
      <label className="chk"><input type="checkbox" checked={p.shiftSpace} onChange={e => save({ shiftSpace: e.target.checked })} /> {tx('Shift+Espaço acaba o turno (como Shift+Enter)')}</label>
      </>}
      <label className="chk"><input type="checkbox" checked={p.clock} onChange={e => save({ clock: e.target.checked })} /> {tx('Relógio de torneio: a responder ao adversário, passa sozinho ao fim de uns segundos')}</label>
      {p.clock && <div className="set-clock">
        <label className="fmt"><span>{tx('Segundos para responder')}</span><input type="number" min={3} max={30} value={p.clockSec} style={{ width: 70 }} onChange={e => save({ clockSec: Math.max(3, Math.min(30, +e.target.value || 8)) })} /></label>
        <label className="fmt"><span>{tx('Stop: segundos a mais para pensar')}</span><input type="number" min={5} max={90} value={p.clockExtra} style={{ width: 70 }} onChange={e => save({ clockExtra: Math.max(5, Math.min(90, +e.target.value || 20)) })} /></label>
        {!T && <label className="fmt"><span>{tx('Tecla de Stop')}</span><input value={p.clockKey.toUpperCase()} maxLength={1} style={{ width: 60, textAlign: 'center' }} onChange={e => { const k = e.target.value.slice(-1).toLowerCase(); if (okKey(k) && k !== p.tap && k !== p.flip) save({ clockKey: k }) }} /></label>}
      </div>}
      {!T && <>
      <label className="fmt"><span>{tx('Tecla para virar a carta debaixo do rato (a outra face, ou de pernas para o ar; só no teu ecrã)')}</span>
        <input value={p.flip.toUpperCase()} maxLength={1} style={{ width: 60, textAlign: 'center' }} onChange={e => { const k = e.target.value.slice(-1).toLowerCase(); if (okKey(k) && k !== p.tap) save({ flip: k }) }} /></label>
      <label className="fmt"><span>{tx('Tecla para virar (tap) a carta tua na mesa debaixo do rato — o mesmo que clicar nela')}</span>
        <input value={p.tap.toUpperCase()} maxLength={1} style={{ width: 60, textAlign: 'center' }} onChange={e => { const k = e.target.value.slice(-1).toLowerCase(); if (okKey(k) && k !== p.flip) save({ tap: k }) }} /></label>
      <p className="muted small">{tx('Na mesa livre (Online) as mesmas teclas valem, mas Espaço compra uma carta e a tecla de virar transforma a carta ou vira-a para baixo para todos. P é a caneta.')}</p>
      <p className="muted small">{tx('Na mão: um clique levanta a carta e mostra-a; para a jogar, arrasta-a para a mesa (ou duplo clique). Se a largares de volta na mão, fica no sítio onde a largaste.')}</p>
      </>}
      <label className="chk"><input type="checkbox" checked={p.autopay} onChange={e => save({ autopay: e.target.checked })} /> {tx('Pagar a mana sozinho quando lanças uma carta, só quando há uma maneira óbvia de pagar (com escolha de cores, escolhes tu)')}</label>
      <label className="chk"><input type="checkbox" checked={p.autoresolve} onChange={e => save({ autoresolve: e.target.checked })} /> {tx('Deixar resolver sozinho o que é teu no topo da pilha (sem carregar em OK)')}</label>
      <label className="fmt"><span>{tx('Arrumação do teu lado da mesa')}</span>
        <select value={p.place} onChange={e => save({ place: e.target.value })}>
          <option value="grid">{tx('Grelha: a carta encaixa na casa mais perto')}</option>
          <option value="free">{tx('Livre: fica onde a largares')}</option>
          <option value="rows">{tx('Filas automáticas (criaturas, terrenos, outras)')}</option>
        </select></label>
      <label className="fmt"><span>{tx('Filas dos terrenos e das criaturas')}</span>
        <select value={p.rowAlign} onChange={e => save({ rowAlign: e.target.value })}>
          <option value="left">{tx('À esquerda')}</option>
          <option value="center">{tx('Ao centro')}</option>
          <option value="right">{tx('À direita, até às outras permanentes')}</option>
        </select></label>
      <label className="fmt"><span>{tx('Filas de cada lado da mesa')}</span>
        <select value={p.rowsMax} onChange={e => save({ rowsMax: +e.target.value })}>
          <option value={4}>{tx('Automático: até 4')}</option>
          <option value={2}>{tx('Sempre 2')}</option>
        </select>
        <small className="muted">{p.rowsMax === 2 ? tx('Sempre 2, como antes (as cartas encostam-se)') : tx('Automático: até 4 (criaturas e terrenos em duas linhas quando não cabem)')}</small></label>
      <label className="fmt"><span>{tx('A mesa no ecrã')}</span>
        <select value={p.layout} onChange={e => save({ layout: e.target.value })}>
          <option value="auto">{tx('Automática')}</option>
          <option value="compact">{tx('Sempre no ecrã todo')}</option>
          <option value="classic">{tx('Clássica')}</option>
        </select>
        <small className="muted">{{ auto: tx('Automática: no telemóvel e no tablet, a mesa com o ecrã todo (barras e painel a pedido: ☰ e ⋯)'), compact: tx('Sempre a mesa com o ecrã todo (também no computador)'), classic: tx('Clássica: barras da app e painel lateral sempre à vista') }[p.layout]}</small></label>
      <label className="fmt"><span>{tx('Mesas com 3–4 jogadores')}</span>
        <select value={p.multi} onChange={e => save({ multi: e.target.value })}>
          <option value="auto">{tx('Automático')}</option>
          <option value="drawers">{tx('Gavetas')}</option>
          <option value="all">{tx('Tudo à vista')}</option>
        </select>
        <small className="muted">{{ auto: tx('Gavetas no telemóvel e no tablet ao alto (e no telemóvel deitado); todos à vista no tablet deitado e no computador.'), drawers: tx('Gavetas: jogas como num 1 contra 1; a gaveta de cima troca de adversário e a de baixo mostra o parceiro.'), all: tx('Todos os jogadores à vista ao mesmo tempo, como antes.') }[p.multi]}</small></label>
      <label className="chk"><input type="checkbox" checked={p.teamOrb} onChange={e => save({ teamOrb: e.target.checked })} /> {tx('Two-Headed Giant nas gavetas: uma esfera da equipa, maior, a meio da mesa (desligado: uma esfera em cada lado, como antes)')}</label>
      <label className="fmt"><span>{tx('Tamanho das cartas na mesa')}</span>
        <select value={p.cardPx} onChange={e => save({ cardPx: +e.target.value })}>
          {CARD_PX.map(n => <option key={n} value={n}>{n ? tx('{n} px (terrenos também)', { n }) : tx('Automático (cabe no ecrã)')}</option>)}
        </select></label>
      <p className="muted small">{tx('Também nas réplicas e torneios. Quando as cartas não cabem no lado do jogador, encostam-se e empilham-se (terrenos iguais num monte ×N) em vez de saírem dele.')}</p>
      <div className="fmt"><span>{tx('Padrão da mesa e esfera da vida')}</span><MatPick /></div>
      <label className="fmt"><span>{tx('Cartas dos adversários na mesa')}</span>
        <select value={p.oppFace} onChange={e => save({ oppFace: e.target.value })}>
          <option value="me">{tx('Viradas para mim (legíveis)')}</option>
          <option value="far">{tx('Viradas para o adversário (como numa mesa a sério)')}</option>
        </select></label>
      <label className="chk"><input type="checkbox" checked={p.persp} onChange={e => save({ persp: e.target.checked })} /> {tx('Lado do adversário em perspetiva (mais espaço para o teu)')}</label>
      {p.persp && <label className="fmt"><span>{tx('Inclinação: {n}°', { n: p.tilt })}</span>
        <input type="range" min="8" max="45" step="1" value={p.tilt} onChange={e => save({ tilt: +e.target.value })} /></label>}
    </>
  )
}

function ScreenAwake() {
  const [on, setOn] = useState(wakeOn), [orient, setOrient] = useState(fsOrientPref)
  return (
    <>
      <label className="chk"><input type="checkbox" checked={on} onChange={e => { setOn(e.target.checked); setWake(e.target.checked) }} /> {tx('Não deixar o ecrã apagar-se com o Grimório aberto')}</label>
      <p className="muted small">{wakeSupported() ? tx('Ligado por omissão no telemóvel e no tablet. Gasta um pouco mais de bateria.') : tx('Este browser (ou o endereço sem HTTPS) não deixa: abre o Grimório pelo endereço https para funcionar.')}</p>
      <label className="fmt"><span>{tx('Orientação em ecrã inteiro (Coliseu)')}</span>
        <select value={orient} onChange={e => { setOrient(e.target.value); setFsOrientPref(e.target.value) }}>
          <option value="auto">{tx('Automática: telemóvel ao alto, tablet deitado')}</option>
          <option value="portrait">{tx('Sempre ao alto')}</option>
          <option value="landscape">{tx('Sempre deitado')}</option>
          <option value="free">{tx('Livre (roda com o aparelho)')}</option>
        </select>
      </label>
      <p className="muted small">{tx('Só no Android: o iPhone e o iPad não deixam fixar a orientação.')}</p>
    </>
  )
}

const GROUP_NAME = { mesa: tx('Cartas e mesa'), combate: tx('Combate e vida'), esfera: tx('Esfera da vida (golpes, coração…)'), dados: tx('Dados e moeda'), fim: tx('Fim do jogo') }
const GROUP_DEMO = { mesa: 'land', combate: 'attack', esfera: 'orbHeart', dados: 'dice', fim: 'win' }
function Sound() {
  const [s, setS] = useState(getSettings)
  return (
    <div className="set-sound">
      <label className="check"><input type="checkbox" checked={s.on} onChange={e => { setEnabled(e.target.checked); setS(getSettings()) }} /> {tx('Efeitos sonoros')}</label>
      <label className="sl"><span>{tx('Volume')} <b>{Math.round(s.vol * 100)}%</b></span>
        <input type="range" min={0} max={100} value={Math.round(s.vol * 100)} disabled={!s.on}
          onChange={e => { setVolume(e.target.value / 100); setS(getSettings()) }} onPointerUp={() => play('click')} onKeyUp={() => play('click')} /></label>
      {/* cada tipo de som com o seu volume (0 = calado) e um botão para o ouvir */}
      {SOUND_GROUPS.map(g => { const v = s.g?.[g] ?? 1; return (
        <label key={g} className="sl sl-group"><span>{GROUP_NAME[g]} <b>{v > 0 ? `${Math.round(v * 100)}%` : tx('calado')}</b></span>
          <input type="range" min={0} max={100} value={Math.round(v * 100)} disabled={!s.on} onChange={e => { setGroupVolume(g, e.target.value / 100); setS(getSettings()) }} />
          <button type="button" className="link small" disabled={!s.on} onClick={() => { setGroupVolume(g, v > 0 ? 0 : 1); setS(getSettings()) }} title={v > 0 ? tx('Calar') : tx('Ligar')}>{v > 0 ? '🔇' : '🔊'}</button>
          <button type="button" className="link small" disabled={!s.on || v <= 0} onClick={() => play(GROUP_DEMO[g], { amount: 4 })} title={tx('Ouvir')}>▶</button></label>) })}
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
  // a secção onde se está (a que passa pela parte de cima do ecrã) fica marcada no índice enquanto se desce
  const [cur, setCur] = useState(secs[0]?.id)
  useEffect(() => {
    const els = secs.map(s => document.getElementById(s.id)).filter(Boolean)
    if (!els.length || !window.IntersectionObserver) return
    const seen = new Map()
    const io = new IntersectionObserver(es => {
      for (const e of es) seen.set(e.target.id, e.isIntersecting)
      const first = els.find(el => seen.get(el.id) && !el.hidden)
      if (first) setCur(first.id)
    }, { rootMargin: '-12% 0px -60% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [secs])
  return (
    <nav className="set-index" aria-label={tx('Secções')}>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Filtrar definições…')} aria-label={tx('Filtrar definições')} />
      {secs.filter(s => !n || !document.getElementById(s.id)?.hidden).map(s => <button key={s.id} className={`link plain ${cur === s.id ? 'on' : ''}`} aria-current={cur === s.id ? 'true' : undefined} onClick={() => { setCur(s.id); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{s.t}</button>)}
    </nav>
  )
}

export default function Settings({ prof, onClose, onSwitch, onNew }) {
  const box = useRef(null)
  useEffect(() => {  // Esc fecha (fora de caixas de texto e sem uma janela aberta por cima)
    const k = e => { if (e.key === 'Escape' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !document.querySelector('.ask-bg')) onClose() }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="view settings set-layout">
      <div className="set-head"><h2><Icon n="gear" /> {tx('Definições')}</h2><button type="button" className="set-close" onClick={onClose} aria-label={tx('Fechar')} title={isTouch() ? tx('Fechar') : tx('Fechar (Esc)')}><span aria-hidden="true">✕</span> {tx('Fechar')}</button></div>
      <SetIndex box={box} />
      <div className="set-main" ref={box}>
      {prof?.mode === 'profiles' && prof.current && <section className="card"><h3>{tx('Perfil')}</h3><ProfileManage prof={prof} onSwitch={onSwitch} onNew={onNew} /></section>}
      <section className="card"><h3>{tx('Língua')}</h3><LangPick />
        <p className="muted small">{tx('Os nomes e os textos das cartas ficam em inglês (dados do Scryfall).')} {tx('A escolha fica guardada neste browser.')}</p></section>
      <section className="card"><h3>{tx('Jogos do Forge ao mesmo tempo')}</h3><ForgeGames /></section>
      <section className="card"><h3><IL n="bots" t={tx('🤖 Bots predefinidos')} /></h3><DefaultBots /></section>
      <section className="card"><h3>{tx('Som')}</h3><Sound /></section>
      <section className="card"><h3>{tx('Ecrã')}</h3><ScreenAwake /></section>
      <section className="card"><h3>{tx('Mesa (Forge Play)')}</h3><TableKeys /></section>
      <section className="card"><h3>{tx('Imagens das cartas')}</h3><ImgSource /></section>
      <section className="card"><h3>{tx('Estrelas dos decks')}</h3><StarLayers /></section>
      <section className="card"><h3>{tx('Cores nos jogos')}</h3><GameColors /></section>
      <section className="card"><h3>{tx('Terrenos básicos')}</h3><BasicSettings getDefaults={getBasicDefaults} setDefaults={setBasicDefaults} ask={ask} /></section>
      <section className="card"><h3>{tx('Confirmações')}</h3><p className="muted small">{tx('Perguntar antes de:')}</p><ConfirmSettings /></section>
      <section className="card"><h3><IL n="mago" t={tx('🤖 IA')} /></h3><AIKeys /></section>
      <section className="card"><h3><IL n="amigos" t={tx('🤝 Amigos')} /></h3><Friends /></section>
      <section className="card"><h3>{tx('Torneios')}</h3><TourHold /><NextMode /><p className="muted small">{tx('Ao ver um torneio ao vivo, que jogo abre quando o que estás a ver acaba.')}</p><HighlightMine /></section>
      <section className="card danger-zone"><h3>{tx('Recomeçar')}</h3><ResetStats /></section>
      <section className="card"><h3>{tx('Dados e cópias')}</h3><DataSync prof={prof} /></section>
      <section className="card"><h3>{tx('Atualizações')}</h3><Updates /></section>
      {window.GrimorioApp && <section className="card"><h3>{tx('App Android')}</h3><p className="muted small">{tx('Versão {v}. A app abre o teu servidor do Grimório.', { v: window.GrimorioApp.version?.() || '?' })}</p><button onClick={() => window.GrimorioApp.changeServer()}>{tx('Mudar de servidor')}</button><ApkUpdate /></section>}
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
      {L.map(([k, c, l]) => <div key={k}><label className="chk"><input type="checkbox" checked={on.includes(k)} disabled={on === k} onChange={() => flip(k)} /> <i className="st-dot" style={{ background: c }} /> {l}</label></div>)}  {/* uma por linha, mesmo com textos curtos (zh) */}
      <p className="muted small">{tx('A primeira cor ligada enche as estrelas e dá o número. Por omissão aparecem as três.')} {on !== 'ybr' && <button className="link small" onClick={() => { setStarLayers('ybr'); setOn('ybr') }}>{tx('Repor as três')}</button>}</p>
    </>
  )
}
