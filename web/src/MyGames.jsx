// «Os meus jogos»: os jogos avulsos contra o Forge (Jogar contra o Forge, mesa do Grimório) guardados com fotografias do
// estado — a lista dos últimos e a réplica de cada um, a mesma dos torneios (Board.jsx Replay com game.snaps)
import { useEffect, useState } from 'react'
import Replay from './Board.jsx'
import { tx, LOCALE } from './i18n.js'

const j = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))

export default function MyGames({ data }) {
  const [list, setList] = useState(null), [game, setGame] = useState(null), [err, setErr] = useState('')
  useEffect(() => { j('/api/mygames').then(setList).catch(() => setList([])) }, [])
  const open = id => j(`/api/mygames/${id}`).then(setGame).catch(e => setErr(e.message))
  if (game) return (
    <section className="card mygames-replay">
      <Replay data={data} game={{ ...game, winner: game.winner || 'draw', opp: game.names?.b || 'Forge', g: 1 }} deckName={game.names?.a || tx('O teu deck')} onBack={() => setGame(null)} backLabel={tx('← Os meus jogos')} />
    </section>
  )
  if (!list?.length) return null
  return (
    <section className="card mygames">
      <h3>{tx('Os meus jogos')} <span className="muted small">{tx('os últimos jogos contra o Forge: carrega num para o rever')}</span></h3>
      {err && <p className="small bad-t">{err}</p>}
      <ul className="mg-list">{list.map(g => (
        <li key={g.id}><button type="button" className="mg-row" onClick={() => open(g.id)}>
          <span className="mg-play">▶</span>
          <span className="mg-names"><b>{g.names?.a || tx('O teu deck')}</b> <span className="muted">{tx('contra')}</span> {g.names?.b || 'Forge'}</span>
          <span className={`mg-res ${g.winner === 'a' ? 'win' : g.winner === 'b' ? 'loss' : ''}`}>{g.winner === 'a' ? tx('ganhaste') : g.winner === 'b' ? tx('perdeste') : tx('sem vencedor')}</span>
          <span className="muted small">{g.turns ? tx('{n} turnos', { n: g.turns }) : ''} · {new Date(g.ts * 1000).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })}</span>
        </button></li>))}</ul>
    </section>
  )
}
