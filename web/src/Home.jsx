// Página inicial: aparece ao abrir a app e ao tocar no logótipo. Só os caminhos principais, cada um com uma linha.
import { Logo } from './ui.jsx'
import { tx } from './i18n.js'

const GO = [
  ['construir', null, '✎', tx('Construir'), tx('Monta decks com sugestões explicadas, combos, base de mana e o universo 3D.')],
  ['biblioteca', null, '▤', tx('Biblioteca'), tx('Os teus decks com capas e estrelas; comparar, importar e procurar decks públicos.')],
  ['coliseu', 'bots', '⚔', tx('Coliseu'), tx('Os teus decks contra outros com o motor Forge: jogos ao vivo, relatório e melhorias.')],
  ['coliseu', 'torneio', '🏆', tx('Torneios'), tx('Eliminação, suíço, liga e mesas de Commander, com árvore ao vivo e pódio.')],
  ['coliseu', 'ratings', '📊', tx('Ratings'), tx('Estrelas de 0 a 6 por deck e a Arena automática a criar registos.')],
  ['coliseu', 'jogar', '🎮', tx('Jogar'), tx('Senta-te tu à mesa contra o Forge com o teu deck.')],
  [null, null, '⚙', tx('Definições'), tx('Língua, jogos do Forge ao mesmo tempo (pela RAM livre), som e perfil.')],
]

export default function Home({ deck, decks, onGo, onNew }) {
  const last = deck?.id && decks.find(d => d.id === deck.id)
  return (
    <div className="home">
      <div className="home-hero">
        <Logo size={96} />
        <h1>Grimório</h1>
        <p>{tx('Constrói, testa e põe à prova os teus decks de Magic.')}</p>
      </div>
      <div className="home-start">
        {last && <button className="primary" onClick={() => onGo('construir')}>{tx('Continuar «{name}»', { name: last.name })}</button>}
        <button onClick={onNew}>✦ {tx('Novo deck')}</button>
      </div>
      <div className="home-grid">
        {GO.map(([sec, mode, ic, t, d]) => (
          <button key={t} className="home-card" onClick={() => (sec ? onGo(sec, mode) : (window.location.hash = '#definicoes'))}>
            <i>{ic}</i><b>{t}</b><span>{d}</span>
            {sec === 'biblioteca' && decks.length > 0 && <small>{tx('{n} deck|{n} decks', { n: decks.length })}</small>}
          </button>
        ))}
      </div>
      <p className="home-foot muted small">{tx('Cartas e imagens: Scryfall · combos: Commander Spellbook · meta: EDHREC e MTGTop8 · jogos: Forge')}</p>
    </div>
  )
}
