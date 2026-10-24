// Definições: perfil (edições sem login), língua, jogos do Forge em simultâneo (com sugestão pela RAM livre agora) e som.
import { useEffect, useState } from 'react'
import { tx, num } from './i18n.js'
import { LangPick, ProfileManage } from './Profiles.jsx'
import { getSettings, setEnabled, setVolume, play } from './sfx.js'

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

export default function Settings({ prof, onClose, onSwitch, onNew }) {
  return (
    <div className="view settings">
      <div className="set-head"><h2>⚙ {tx('Definições')}</h2><button onClick={onClose}>{tx('Fechar')}</button></div>
      {prof?.mode === 'profiles' && prof.current && <section className="card"><h3>{tx('Perfil')}</h3><ProfileManage prof={prof} onSwitch={onSwitch} onNew={onNew} /></section>}
      <section className="card"><h3>{tx('Língua')}</h3><LangPick />
        <p className="muted small">{tx('Os nomes e os textos das cartas ficam em inglês (dados do Scryfall).')} {tx('A escolha fica guardada neste browser.')}</p></section>
      <section className="card"><h3>{tx('Jogos do Forge ao mesmo tempo')}</h3><ForgeGames /></section>
      <section className="card"><h3>{tx('Som')}</h3><Sound /></section>
    </div>
  )
}
