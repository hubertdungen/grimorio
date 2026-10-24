// Página inicial: aparece ao abrir a app e ao tocar no logótipo. Só os caminhos principais, cada um com uma linha.
import { Logo } from './ui.jsx'

const GO = [
  ['construir', null, '✎', 'Construir', 'Monta decks com sugestões explicadas, combos, base de mana e o universo 3D.'],
  ['biblioteca', null, '▤', 'Biblioteca', 'Os teus decks com capas e estrelas; comparar, importar e procurar decks públicos.'],
  ['coliseu', 'bots', '⚔', 'Coliseu', 'Os teus decks contra outros com o motor Forge: jogos ao vivo, relatório e melhorias.'],
  ['coliseu', 'torneio', '🏆', 'Torneios', 'Eliminação, suíço, liga e mesas de Commander, com árvore ao vivo e pódio.'],
  ['coliseu', 'ratings', '📊', 'Ratings', 'Estrelas de 0 a 6 por deck e a Arena automática a criar registos.'],
  ['coliseu', 'jogar', '🎮', 'Jogar', 'Senta-te tu à mesa contra o Forge com o teu deck.'],
]

export default function Home({ deck, decks, onGo, onNew }) {
  const last = deck?.id && decks.find(d => d.id === deck.id)
  return (
    <div className="home">
      <div className="home-hero">
        <Logo size={96} />
        <h1>Grimório</h1>
        <p>Constrói, testa e põe à prova os teus decks de Magic.</p>
      </div>
      <div className="home-start">
        {last && <button className="primary" onClick={() => onGo('construir')}>Continuar «{last.name}»</button>}
        <button onClick={onNew}>✦ Novo deck</button>
      </div>
      <div className="home-grid">
        {GO.map(([sec, mode, ic, t, d]) => (
          <button key={t} className="home-card" onClick={() => onGo(sec, mode)}>
            <i>{ic}</i><b>{t}</b><span>{d}</span>
            {t === 'Biblioteca' && decks.length > 0 && <small>{decks.length} decks</small>}
          </button>
        ))}
      </div>
      <p className="home-foot muted small">Cartas e imagens: Scryfall · combos: Commander Spellbook · meta: EDHREC e MTGTop8 · jogos: Forge</p>
    </div>
  )
}
