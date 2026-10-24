import { img, TAG_LABEL } from './data.js'

const sym = s => `https://svgs.scryfall.io/card-symbols/${s.replace(/\//g, '')}.svg`

export function Mana({ cost }) {
  if (!cost) return null
  return (
    <span className="mana">
      {cost.split(/(\{[^}]+\}|\s\/\/\s)/).filter(Boolean).map((p, k) =>
        p.startsWith('{') ? <img key={k} src={sym(p.slice(1, -1))} alt={p} loading="lazy" /> : <span key={k}>{p}</span>)}
    </span>
  )
}

export function Oracle({ text }) {
  return (
    <div className="oracle">
      {text.split('\n').map((line, k) => (
        <p key={k}>{line.split(/(\{[^}]+\})/).map((p, j) =>
          p.startsWith('{') ? <img key={j} src={sym(p.slice(1, -1))} alt={p} /> : p)}</p>
      ))}
    </div>
  )
}

export const price = c => (c.eur != null ? `${c.eur.toFixed(2)} €` : c.usd != null ? `$${c.usd.toFixed(2)}` : '—')

export function Tags({ c, onTag }) {
  return (
    <span className="tags">
      {c.tg.filter(t => t !== 'land' && t !== 'creature').map(t => (
        <button key={t} className="tag" onClick={onTag ? e => { e.stopPropagation(); onTag(t) } : undefined}>{TAG_LABEL[t]}</button>
      ))}
    </span>
  )
}

/** Carta em grelha: imagem + ações rápidas. */
export function CardTile({ c, pid, onOpen, actions, note, children }) {
  return (
    <div className="tile">
      <button className="tile-img" onClick={() => onOpen(c)} title={c.n}>
        <img src={img(c, 'normal', false, pid)} alt={c.n} loading="lazy" />
      </button>
      <div className="tile-bar">
        {actions}
        <span className="tile-price">{price(c)}</span>
      </div>
      {note}
      {children}
    </div>
  )
}

export function Logo({ size = 34 }) {
  return <img src="logo.svg" width={size} height={size} alt="" className="logo" />
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

// rating em estrelas (0,0–6,0): só as que tem, a última cheia na proporção (2,3 → 2 e ⅓ de outra) e o número;
// sem rating, uma estrela cinzenta; provisório, mais claras. r = {stars, prov, elo, games} ou v solto; bare = sem número
export const PROV_TIP = 'Provisório: menos de 10 jogos com rating. O Elo ainda mexe o dobro por jogo e as estrelas podem mudar muito; fica estável aos 10 jogos.'
export function Stars({ r, v = r?.stars, prov = r?.prov, bare = false, label = '' }) {
  if (v == null) return <span className="stars none" title="sem rating ainda" role="img" aria-label="sem rating ainda">★</span>
  const n = Math.floor(v + 1e-9), f = v - n, txt = v.toFixed(1).replace('.', ',')
  const t = `${label}${txt} de 6 estrelas${r?.games ? ` · ${r.games} jogos · Elo ${r.elo}` : ''}${prov ? `\n${PROV_TIP}` : ''}`
  return (
    <span className={`stars${prov ? ' prov' : ''}`} title={t} role="img" aria-label={t}>
      {'★'.repeat(n)}{f > 0.04 && <i style={{ '--f': `${Math.round(f * 100)}%` }}>★</i>}{v < 0.05 && <i className="zero">☆</i>}{!bare && <b>{txt}</b>}
    </span>
  )
}
