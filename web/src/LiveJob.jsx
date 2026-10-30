// Ver ao vivo um jogo do Laboratório lançado noutro separador ou dispositivo (ou antes de recarregar a página): lê o
// registo em curso do Forge (job.live) de 2 em 2 s; quando acaba mostra o jogo completo
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Replay from './Board.jsx'
import { tx } from './i18n.js'
import { useBackClose } from './backnav.js'

export default function LiveJob({ data, job, onClose }) {
  useBackClose(true, onClose)  // «voltar» do telemóvel fecha esta janela
  const [game, setGame] = useState(null), [gone, setGone] = useState(false)
  useEffect(() => {
    let off = false
    const base = { opp: job.names?.b || 'B', g: 1, turns: 0, key: job.id }
    const tick = () => fetch(`/api/sim/jobs/${job.id}`).then(r => (r.ok ? r.json() : null)).then(x => {
      if (off) return
      if (!x) return setGone(true)
      if (x.status === 'done' && x.games?.length) setGame({ ...x.games[x.games.length - 1], ...base })
      else setGame({ events: x.live?.events || [], exact: true, inProgress: true, winner: null, ...base })
    }).catch(() => {})
    tick()
    const t = setInterval(tick, 2000)
    return () => { off = true; clearInterval(t) }
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="modal-bg live-arena" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal la-box">
        {gone ? <p className="muted">{tx('Este jogo já não está no servidor (acabou há mais de uma hora ou o servidor reiniciou).')}</p>
          : !game ? <p className="muted"><span className="spin-dot" /> {tx('A ligar ao jogo…')}</p>
            : !game.events.length ? <p className="muted"><span className="spin-dot" /> {tx('O Forge está a arrancar o jogo…')}</p>
              : <Replay key={game.key} data={data} game={game} live={!!game.inProgress} deckName={job.names?.a || 'A'} pov={null} onBack={onClose} backLabel={tx('× Fechar')} />}
        {(gone || !game?.events?.length) && <button onClick={onClose}>{tx('Fechar')}</button>}
      </div>
    </div>, document.body)
}
