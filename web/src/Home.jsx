// Página inicial: aparece ao abrir a app e ao tocar no logótipo. Os seis caminhos principais (Construir em destaque) e,
// por baixo, as ferramentas para a mesa (vida, ler carta, dados, regras).
import { Logo } from './ui.jsx'
import { Icon } from './icons.jsx'
import { tx } from './i18n.js'

const GO = [
  ['construir', null, 'construir', tx('Construir'), tx('Monta decks com sugestões explicadas, combos, base de mana e o universo 3D.')],
  ['biblioteca', null, 'biblioteca', tx('Biblioteca'), tx('Os teus decks com capas e estrelas; comparar, importar e procurar decks públicos.')],
  ['coliseu', 'bots', 'coliseu', tx('Coliseu'), tx('Os teus decks contra outros com o motor Forge: jogos ao vivo, relatório e melhorias.')],
  ['coliseu', 'torneio', 'torneio', tx('Torneios'), tx('Eliminação, suíço, liga e mesas de Commander, com árvore ao vivo e pódio.')],
  ['coliseu', 'ratings', 'ratings', tx('Ratings'), tx('Estrelas de 0 a 6 por deck e a Arena automática a criar registos.')],
  ['coliseu', 'draft', 'draft', tx('Draft'), tx('Booster draft e selado com os sets a sério, contra bots ou amigos, e o deck vai para a Biblioteca.')],
  ['coliseu', 'online', 'online', tx('Online'), tx('Mesas com amigos pela internet: lobby com caixas e cartas, moeda ao ar e chat.')],
  ['coliseu', 'jogar', 'forge', tx('Jogar'), tx('Senta-te tu à mesa contra o Forge com o teu deck.')],
]

export default function Home({ deck, decks, onGo, onNew, onTool, onScan }) {
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
          <button key={t} className={`home-card ${sec === 'construir' ? 'main' : ''}`} onClick={() => onGo(sec, mode)}>
            <i><Icon n={ic} /></i><b>{t}</b><span>{d}</span>
            {sec === 'biblioteca' && decks.length > 0 && <small>{tx('{n} deck|{n} decks', { n: decks.length })}</small>}
          </button>
        ))}
      </div>
      <div className="home-mesa">
        <span className="muted small">{tx('Para jogar à mesa')}</span>
        <button className="home-card home-tool life" onClick={() => onTool('vida')}><i><Icon n="vida" /></i><b>{tx('Contador de vida')}</b><span>{tx('Até 6 jogadores, vida e veneno, com registo.')}</span></button>
        <button className="home-card home-tool scan" onClick={onScan}><i><Icon n="scan" /></i><b>{tx('Ler carta')}</b><span>{tx('Aponta a câmara a uma carta e ela entra no deck aberto.')}</span></button>
        <button className="home-card home-tool dice" onClick={() => onTool('dados')}><i><Icon n="dados" /></i><b>{tx('Dados')}</b><span>{tx('d4 a d100 e moeda em 3D: lança-se, agarra-se e atira-se com o dedo, com registo.')}</span></button>
        <button className="home-card home-tool rules" onClick={() => onGo('regras')}><i><Icon n="regras" /></i><b>{tx('Regras')}</b><span>{tx('Dúvidas de regras e cartas em qualquer língua, com os rulings oficiais e a câmara.')}</span></button>
      </div>
      <p className="home-foot muted small"><a href="#definicoes" className="home-set"><Icon n="gear" /> {tx('Definições')}</a> · {tx('Cartas e imagens: Scryfall · combos: Commander Spellbook · meta: EDHREC e MTGTop8 · jogos: Forge')}</p>
    </div>
  )
}
