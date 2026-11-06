// Mesa livre: olhar para a mão de outro jogador (Thoughtseize, Duress, Peek, Vendilion Clique, Kitesail Freebooter…).
// O servidor (freetable.py, «lookhand») manda os nomes só a quem olha; os outros veem no registo que olhou. Daqui cada
// carta escolhida vai para o cemitério, o exílio ou a biblioteca do dono (o registo diz qual, se ficar à vista).
import { FCard } from './ForgePlay.jsx'
import { useBackClose } from './backnav.js'
import { tx } from './i18n.js'

export default function HandLook({ name, cards, data, mv, onDone, onZoom }) {
  useBackClose(true, onDone)
  return (
    <div className="fp-modal"><div className="fp-ask">
      <p><b>👁 {tx('A mão de {p}', { p: name })}</b> <span className="muted small">{tx('só tu vês estas cartas; os outros sabem que estás a olhar')}</span></p>
      {cards.length ? <div className="fp-opts ml-top">{cards.map(c => (
        <div key={c.id} className="ml-topc" onMouseEnter={() => onZoom?.(c.n)}><FCard c={{ id: c.id, name: c.n }} data={data} big />
          <span className="row-btns"><button className="small" onClick={() => mv(c.id, 'graveyard')} title={tx('Para o cemitério')}>⚰</button>
            <button className="small" onClick={() => mv(c.id, 'exile')} title={tx('Para o exílio')}>⌀</button>
            <button className="small" onClick={() => mv(c.id, 'library', { bottom: true })} title={tx('Para o fundo')}>▥</button>
            <button className="small" onClick={() => mv(c.id, 'library')} title={tx('Topo da biblioteca')}>▤</button></span></div>))}</div>
        : <p className="muted">{tx('A mão está vazia.')}</p>}
      <div className="row-btns"><button className="primary" onClick={onDone}>{tx('Feito')}</button></div>
    </div></div>
  )
}
