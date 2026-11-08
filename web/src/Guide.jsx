// 📖 Regras › Guia do Grimório: uma secção por área com a barra a imitar a verdadeira (passar o rato ou tocar num botão
// diz o que faz), passos com Seguinte/Anterior, a lista dos comandos e «Ir para lá». A pesquisa filtra o guia todo.
// O conteúdo está em guidetext (GUIDE.areas/walks) mais abaixo; as teclas da mesa vêm das Definições › Mesa (fpPrefs).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IL } from './icons.jsx'
import { tx } from './i18n.js'
import { fpPrefs } from './fpprefs.js'
import { isTouch, gestures } from './touch.js'
import './guide.css'

const ICONS = new Set(['casa', 'construir', 'biblioteca', 'coliseu', 'regras', 'bots', 'forge', 'torneio', 'draft', 'online', 'ratings', 'gear', 'vida', 'scan', 'dados', 'criar', 'porta', 'registo', 'moeda', 'mago', 'amigos', 'meta'])
const Glyph = ({ g }) => (ICONS.has(g) ? <Icon n={g} /> : <span className="g-emo" aria-hidden="true">{g}</span>)
// rótulo com o seu ícone: o emoji que a frase já traz não se repete ao lado do ícone (IL tira-o)
const Label = ({ g, l }) => (ICONS.has(g) ? <IL n={g} t={l} /> : String(l).startsWith(g) ? l : <><Glyph g={g} />{l}</>)
const store = { get: k => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento */ } } }
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// «Ir para lá»: os modos do Coliseu pelo evento que já existe (grimorio:col); o resto pelo grimorio:go (App.jsx);
// as Definições abrem-se pelo #definicoes, como o ⚙ do cabeçalho
function goTo(to) {
  if (to.settings) window.location.hash = 'definicoes'
  else if (to.col) window.dispatchEvent(new CustomEvent('grimorio:col', { detail: to.col }))
  else window.dispatchEvent(new CustomEvent('grimorio:go', { detail: to }))
  window.scrollTo(0, 0)
}

// realça o que se procurou (sem acentos nem maiúsculas: a posição no texto dobrado é a mesma do original)
function Hit({ text, q }) {
  const s = String(text)
  if (!q) return s
  const i = fold(s).indexOf(q)
  if (i < 0) return s
  return <>{s.slice(0, i)}<mark className="g-hit">{s.slice(i, i + q.length)}</mark><Hit text={s.slice(i + q.length)} q={q} /></>
}

// a barra de mentira: passar o rato, focar ou tocar num botão mostra o que ele faz na barra a sério
function Mock({ bar }) {
  const [cur, setCur] = useState(0), b = bar[cur] || bar[0]
  return (
    <div>
      <div className="g-mock" role="toolbar" aria-label={tx('Os botões desta área')}>
        {bar.map(([g, l], k) => (
          <button key={k} type="button" className={k === cur ? 'on' : ''} aria-pressed={k === cur}
            onMouseEnter={() => setCur(k)} onFocus={() => setCur(k)} onClick={() => setCur(k)}><Label g={g} l={l} /></button>
        ))}
      </div>
      <p className="g-tip" aria-live="polite"><b>{b[1]}</b> — {b[2]}</p>
    </div>
  )
}

function Walk({ w, start = 0 }) {  // start: na pesquisa, abre no passo onde está o que se procurou
  const [k, setK] = useState(start), n = w.steps.length
  return (
    <div className="g-walk">
      <h3><Glyph g={w.g} />{w.t}<small>{tx('passo {a} de {b}', { a: k + 1, b: n })}</small></h3>
      <div className="g-dots">{w.steps.map((_, j) => <button key={j} type="button" className={j === k ? 'on' : j < k ? 'done' : ''} onClick={() => setK(j)} aria-label={tx('Passo {n}', { n: j + 1 })}>{j + 1}</button>)}</div>
      <p className="g-step" key={k}>{w.steps[k]}</p>
      <div className="g-nav">
        <button type="button" onClick={() => setK(k - 1)} disabled={!k}>← {tx('Anterior')}</button>
        {k < n - 1 ? <button type="button" className="primary" onClick={() => setK(k + 1)}>{tx('Seguinte')} →</button>
          : <button type="button" onClick={() => setK(0)}>↺ {tx('Recomeçar')}</button>}
        {w.go && <button type="button" className="link g-go" onClick={() => goTo(w.go)}>{tx('Ir para lá')} →</button>}
      </div>
    </div>
  )
}

const Rows = ({ rows, q }) => <ul className="g-list">{rows.map(([l, d], k) => <li key={k}><b><Hit text={l} q={q} /></b><span><Hit text={d} q={q} /></span></li>)}</ul>

export default function Guide() {
  const G = useMemo(() => guide(fpPrefs()), [])
  const [cur, setCurS] = useState(() => (G.areas.some(a => a.id === store.get('grimorio.guia')) ? store.get('grimorio.guia') : G.areas[0].id))
  const setCur = id => { setCurS(id); store.set('grimorio.guia', id) }
  const [q, setQ] = useState(''), fq = fold(q.trim())
  const area = G.areas.find(a => a.id === cur)
  const nav = useRef(null)
  useEffect(() => {  // no telemóvel o índice é uma fila que desliza: a área escolhida fica à vista
    const n = nav.current, b = n?.querySelector('button.on')
    if (b && n.scrollWidth > n.clientWidth) n.scrollLeft = b.offsetLeft - (n.clientWidth - b.offsetWidth) / 2
  }, [cur])
  // pesquisa: em cada área, as linhas (barra, comandos, partes) e os passos onde aparece o que se procurou
  const found = useMemo(() => {
    if (fq.length < 2) return null
    const has = (...s) => s.some(x => fold(x).includes(fq))
    return G.areas.map(a => {
      const all = [...a.bar.map(([, l, d]) => [l, d]), ...a.rows, ...(a.subs || []).flatMap(s => s.rows.map(([l, d]) => [`${s.t} › ${l}`, d]))]
      const rows = has(a.t, a.intro) ? all : all.filter(([l, d]) => has(l, d))
      const walks = G.walks.filter(w => w.area === a.id && has(w.t, ...w.steps)).map(w => ({ w, at: Math.max(0, w.steps.findIndex(x => has(x))) }))
      return { a, rows, walks }
    }).filter(x => x.rows.length || x.walks.length)
  }, [fq, G])
  return (
    <div className="guide">
      <aside className="g-side">
        <input className="g-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Procurar no guia (ex.: atacar, torneio, dados)')} aria-label={tx('Procurar no guia')} />
        <nav aria-label={tx('Áreas do guia')}>
          <ul className="g-index" ref={nav}>{G.areas.map(a => <li key={a.id}><button type="button" className={!found && a.id === cur ? 'on' : ''} aria-current={!found && a.id === cur ? 'true' : undefined} onClick={() => { setQ(''); setCur(a.id) }}><Glyph g={a.g} />{a.t}</button></li>)}</ul>
        </nav>
      </aside>
      <div className="g-main">
        {found ? (
          <section className="card g-results">
            {!found.length && <p className="muted">{tx('Nada no guia com «{q}». Experimenta outra palavra, ou procura nas regras do Magic.', { q })}</p>}
            {found.map(({ a, rows, walks }) => (
              <section key={a.id}>
                <h3 className="g-res-area"><Glyph g={a.g} />{a.t} <button type="button" className="link small" onClick={() => { setQ(''); setCur(a.id) }}>{tx('abrir esta parte')}</button></h3>
                {rows.length > 0 && <Rows rows={rows} q={fq} />}
                {walks.length > 0 && <div className="g-walks" style={{ marginTop: 8 }}>{walks.map(({ w, at }) => <Walk key={`${w.id}:${fq}`} w={w} start={at} />)}</div>}
              </section>
            ))}
          </section>
        ) : (
          <section className="card g-area" key={area.id}>
            <h2><Glyph g={area.g} />{area.t}{area.go && <button type="button" className="primary g-go" onClick={() => goTo(area.go)}>{tx('Ir para lá')} →</button>}</h2>
            <p className="g-intro">{area.intro}</p>
            {area.bar.length > 0 && <><h4>{tx('Os botões (passa o rato ou toca)')}</h4><Mock bar={area.bar} /></>}
            {G.walks.some(w => w.area === area.id) && <><h4>{tx('Passo a passo')}</h4><div className="g-walks">{G.walks.filter(w => w.area === area.id).map(w => <Walk key={w.id} w={w} />)}</div></>}
            {area.rows.length > 0 && <><h4>{tx('Tudo o que há aqui')}</h4><Rows rows={area.rows} /></>}
            {(area.subs || []).map(s => <div key={s.t}><h3 className="g-sub"><Glyph g={s.g} /> {s.t}{s.go && <> <button type="button" className="link small" onClick={() => goTo(s.go)}>{tx('Ir para lá')} →</button></>}</h3>{s.intro && <p className="g-intro">{s.intro}</p>}<Rows rows={s.rows} /></div>)}
            {isTouch() && area.touch ? <><h4>{tx('Gestos (telemóvel e tablet)')}</h4><ul className="g-keys g-touch">{area.touch.map(([k, d]) => <li key={k}><b>{k}</b> {d}</li>)}</ul></>
              : area.keys && <><h4>{tx('Teclas (mudam-se em Definições › Mesa)')}</h4><ul className="g-keys">{area.keys.map(([k, d]) => <li key={k}><kbd className="g-k">{k}</kbd> {d}</li>)}</ul></>}
          </section>
        )}
      </div>
    </div>
  )
}

// O conteúdo do guia. P = fpPrefs(): as teclas escolhidas pelo utilizador aparecem tal como estão.
// Cada área: g = ícone (nome do icons.jsx ou emoji), bar = a barra de mentira [ícone, rótulo, o que faz], rows = os
// comandos [rótulo, o que faz], subs = partes da área com as suas linhas, go = para onde leva o «Ir para lá».
function guide(P) {
  const T = P.tap.toUpperCase(), F = P.flip.toUpperCase()
  const areas = [
    { id: 'inicio', g: 'casa', t: tx('Página inicial'), go: { home: true },
      intro: tx('Abre sozinha da primeira vez que entras (e sempre que tocas no logótipo do Grimório, no canto de cima). Daqui vais para qualquer área num toque.'),
      bar: [
        ['construir', tx('Construir'), tx('o cartão grande: monta e afina decks, com sugestões explicadas.')],
        ['biblioteca', tx('Biblioteca'), tx('os teus decks guardados, com capas, estrelas e troféus.')],
        ['coliseu', tx('Coliseu'), tx('os teus decks a jogar contra outros no motor Forge: testes, relatório e melhorias.')],
        ['torneio', tx('Torneios'), tx('abre o Coliseu já no separador Torneio.')],
        ['ratings', tx('Ratings'), tx('abre o Coliseu nos Ratings: as estrelas de cada deck e a Arena automática.')],
        ['draft', tx('Draft'), tx('booster draft e selado com os sets a sério.')],
        ['online', tx('Online'), tx('mesas e torneios com amigos pela internet.')],
        ['forge', tx('Jogar'), tx('senta-te tu à mesa contra o Forge com o deck aberto.')],
        ['vida', tx('Contador de vida'), tx('para jogar com cartas a sério: vida, veneno e dano de comandante de até 6 jogadores.')],
        ['scan', tx('Ler carta'), tx('aponta a câmara a uma carta e ela entra no deck aberto.')],
        ['dados', tx('Dados'), tx('d4 a d100 e moeda, em 3D.')],
        ['gear', tx('Definições'), (isTouch() ? tx('língua, som, controlos da mesa, esfera da vida, cópias de segurança…') : tx('língua, som, teclas da mesa, esfera da vida, cópias de segurança…'))],
      ],
      rows: [
        [tx('Continuar «deck»'), tx('aparece quando já tens um deck aberto: volta direto a ele no Construir.')],
        [tx('✦ Novo deck'), tx('abre o assistente de deck novo (ver «Criar o primeiro deck», em Construir).')],
        [tx('Logótipo do Grimório'), tx('em qualquer área, o logótipo no canto de cima volta a esta página.')],
      ] },

    { id: 'construir', g: 'construir', t: tx('Construir'), go: { sec: 'construir', tab: 'deck' },
      intro: tx('Onde se monta o deck. À esquerda fica sempre o painel do deck (no telemóvel está no separador Deck); em cima, os separadores com as ferramentas. Tudo se grava sozinho: o estado aparece ao lado de «✦ Novo deck» (a guardar… / guardado).'),
      bar: [
        ['▦', tx('Deck'), tx('as cartas do deck em grelha ou em lista, com −/+ por carta, mover para sideboard (SB) ou maybeboard (MB) e o número ao lado do nome.')],
        ['⌕', tx('Pesquisa'), tx('procura por nome ou por uma frase em qualquer língua («remoção barata a preto»), com filtros e o painel «Sugestões para este deck» ao lado.')],
        ['★', tx('Sugestões'), tx('sementes (as cartas de que gostas), preencher o deck, trocas, quantidades, terrenos e sideboard, sempre com o porquê.')],
        ['◉', tx('Universo'), tx('um mapa 3D de todas as cartas: as que combinam ficam perto. Duplo clique junta ao deck; o laço escolhe uma zona.')],
        ['∞', tx('Combos'), tx('sinergias do deck, pares fortes, combos fechados e os que estão a uma carta de distância.')],
        ['◔', tx('Análise'), tx('curva, cores, mão inicial, base de mana, funções, registo de jogos e as «Melhorias prioritárias».')],
        ['bots', tx('Teste'), tx('o Laboratório (os bots a jogar o teu deck) sem sair do Construir; «⛶ Abrir no Coliseu» mostra-o em grande.')],
        ['draft', tx('Draft'), tx('ajuda num draft a sério: mete as cartas do pack e o Grimório ordena-as e diz porquê.')],
        ['criar', tx('✦ Novo deck'), tx('o assistente: formato, nome e como queres começar.')],
      ],
      rows: [
        [tx('Escolher deck (cabeçalho)'), tx('o nome do deck aberto abre a lista: procura, ★ Favoritos, Recentes, por formato; Enter abre o primeiro, ✕ fecha o deck (fica na Biblioteca).')],
        [tx('Formato'), tx('muda a validação, as metas e as sugestões; as cartas ficam.')],
        [tx('Deck casual'), tx('deixa ter cartas proibidas ou de outros formatos; só joga em modo casual e só tem rating casual.')],
        [tx('Bracket alvo'), tx('só no Commander: o nível de 1 (Exibição) a 5 (cEDH) que as sugestões tentam respeitar.')],
        [tx('Contador e «válido»'), tx('quantas cartas tens e os problemas do deck (cópias a mais, fora da identidade de cor, ilegais).')],
        [tx('↶ Desfazer / ↷ Refazer'), tx('voltam atrás nas mudanças às cartas (Ctrl+Z e Ctrl+Shift+Z). Os avisos de «carta → deck» também trazem «Desfazer».')],
        [tx('✦ Completar deck automaticamente'), tx('propõe as cartas que faltam por razões (funções em falta, sinergia, base de mana); desmarca o que não queres e aplica.')],
        [tx('✦ Assistente IA'), tx('extra opcional, com a tua chave (Definições › IA): sugerir melhorias, reorganizar o deck em secções ou pergunta livre.')],
        [tx('− + e ⇄ numa linha'), tx('tira ou junta uma cópia; ⇄ move todas as cópias para deck, sideboard ou maybeboard. Tirar a última cópia pergunta antes.')],
        [tx('Passar o rato numa carta'), tx('mostra-a em grande; F vira as de duas faces. No tablet/telemóvel: toca e mantém.')],
        [tx('Botões da carta (+ SB ♛ ★ 🎨)'), tx('+ junta (▾ escolhe quantas), SB vai para o sideboard, ♛ faz dela comandante, ★ semente das sugestões, 🎨 escolhe a arte ou a edição.')],
        [tx('⇄ ao lado do +'), tx('troca a carta pela mais fraca do deck que faz o mesmo trabalho.')],
        [tx('Clicar numa carta'), tx('abre a ficha: legalidade, + Deck/Sideboard/Maybeboard, comandante, semente, 🔁 Sugerir substituto, combos, edições e semelhantes.')],
        [tx('Importar'), tx('cola uma lista (Arena, Moxfield, MTGO…) ou um link de Moxfield, Archidekt, TappedOut, MTGGoldfish…; substitui ou junta ao deck.')],
        [tx('⟳ Atualizar do site'), tx('volta a ler o deck pelo link de onde veio: artes, edições, capa e, se quiseres, a lista.')],
        [tx('Copiar lista / Descarregar'), tx('a lista em texto, com as edições escolhidas.')],
        [tx('🖨 Proxies'), tx('lista para sites de proxies, ZIP com as imagens ou folha PDF para imprimir, com guias de corte.')],
        [tx('Eliminar'), tx('apaga o deck (fica 30 dias no lixo da Biblioteca).')],
        [tx('⚙ Personalizar'), tx('nível de jogo, seguir o meta, estilo, orçamento por carta e inspirar-te nos teus decks: muda as sugestões.')],
      ],
      subs: [
        { g: 'criar', t: tx('Assistente «Novo deck»'), rows: [
          [tx('Formato e Nome'), tx('o nome é opcional: o Grimório dá um se ficar vazio.')],
          [tx('▦ Escolher 3–10 cartas'), tx('escolhe cartas de que gostas (e o comandante, se o formato tiver) e o Grimório completa o resto.')],
          [tx('✎ Construir à mão'), tx('começa vazio, na Pesquisa; as sugestões acompanham cada carta que entra.')],
          [tx('⇩ Importar e melhorar'), tx('traz um deck que já tens; depois abre-se a Análise com as melhorias prioritárias.')],
          [tx('✦ Descrever a ideia (IA)'), tx('escreve a ideia («elfos verde-preto que enchem a mesa de fichas») e a IA propõe a base, verificada pelo Grimório.')],
          [tx('✦ Criar e completar o deck'), tx('cria e completa; «Criar só com estas» cria só com as cartas escolhidas. As escolhas ficam guardadas se fechares.')],
        ] },
        { g: '◉', t: tx('Universo'), go: { sec: 'construir', tab: 'universo' }, rows: [
          [tx('Arrastar / roda do rato'), tx('roda e aproxima o mapa; clicar num ponto escolhe a carta, duplo clique junta-a ao deck.')],
          [tx('Voar até uma carta…'), tx('leva a câmara até à carta escrita.')],
          [tx('Regiões, desempenho, meta'), tx('zonas por função (a vermelho as que faltam), o tamanho pelos jogos do Coliseu e os arquétipos do meta.')],
          [tx('◯ Laço'), tx('desenha à volta de uma zona (rato ou dedo) e vês as melhores cartas dali.')],
        ] },
        { g: 'draft', t: tx('Draft (no Construir)'), go: { sec: 'construir', tab: 'draft' }, rows: [
          [tx('Set (17lands)'), tx('o set que estás a draftar.')],
          [tx('Pack atual'), tx('clica nas cartas do set que estão no teu pack; o Grimório ordena-as e diz porquê. «Escolher» passa-a para os teus picks.')],
          [tx('Montar deck de 40'), tx('com 20 ou mais picks: o melhor par de cores, 23 feitiços e 17 terrenos.')],
          [tx('Selado: colar o pool'), tx('cola as cartas do teu selado e usa-as como pool.')],
        ] },
      ] },

    { id: 'biblioteca', g: 'biblioteca', t: tx('Biblioteca'), go: { sec: 'biblioteca' },
      intro: tx('Todos os teus decks, por formato, com capa, estrelas e troféus. Daqui abres, testas, duplicas, comparas e importas.'),
      bar: [
        ['▦', tx('Grelha / Lista'), tx('caixas com capa ou uma lista compacta.')],
        ['☰', tx('Ordenar'), tx('última alteração, criação, nome, cores, ratings (amarelo, azul, vermelho, casual) ou troféus.')],
        ['☆', tx('☆/★ Favorito'), tx('marca o deck como favorito; a ficha «★ Favoritos» mostra só esses.')],
        ['forge', tx('⚔ Testar no Forge'), tx('leva o deck ao Coliseu para jogar.')],
        ['⧉', tx('⧉ Duplicar'), tx('faz uma cópia do deck para experimentar sem estragar o original.')],
        ['🖼', tx('🖼 Escolher a capa'), tx('uma carta do deck, um link ou uma imagem tua.')],
        ['⇄', tx('⇄ Comparar'), tx('marca 2 a 4 decks e compara-os lado a lado, com «🔍 Porquê?» a explicar a diferença de rating.')],
        ['🗑', tx('🗑 Apagar'), tx('vai para o Lixo (30 dias); lá em baixo, «Restaurar» trá-lo de volta.')],
      ],
      rows: [
        [tx('Fichas dos formatos'), tx('filtram por formato; tocar no título de um formato fecha-o ou abre-o.')],
        [tx('🧙/🌐 numa caixa'), tx('o deck é teu ou da comunidade (de outra pessoa): nos torneios e na Arena escolhes se entram.')],
        [tx('Taças'), tx('os troféus do deck: passa o rato ou toca para ver a lista.')],
        [tx('Seleção (caixa de cada deck)'), tx('com vários marcados: comparar, passar a comunidade ou meus, casual, favoritos, artes dos básicos ou apagar todos.')],
        [tx('Decks repetidos ou muito parecidos'), tx('decks 80% iguais ou mais: comparar, apagar ou ignorar.')],
        [tx('Procurar decks públicos'), tx('procura decks no Archidekt para trazer.')],
        [tx('Importar decks de um perfil'), tx('traz vários decks de uma vez a partir do perfil de um site.')],
        [tx('Decks do meta'), tx('os decks mais jogados de cada formato; «Guardar nos meus decks» copia um.')],
      ] },

    { id: 'coliseu', g: 'coliseu', t: tx('Coliseu'), go: { col: 'bots' },
      intro: tx('Onde os decks jogam. Em cima, os modos; o deck aberto no Construir é o teu deck em todos eles.'),
      bar: [
        ['bots', tx('Bots a testar'), tx('o Laboratório: o motor Forge joga o teu deck contra outros (meta, teus, comunidade ou uma lista colada) e faz um relatório.')],
        ['forge', tx('Jogar contra o Forge'), tx('jogas tu, à mesa, contra a IA do Forge.')],
        ['torneio', tx('Torneio'), tx('eliminação, suíço, liga, mesas de Commander, equipas… com árvore ao vivo, apostas e pódio.')],
        ['draft', tx('Draft'), tx('booster draft ou selado com packs a sério e bots que montam decks de 40.')],
        ['online', tx('Online'), tx('salas com amigos: mesa livre, jogos e torneios com bots ou mistos.')],
        ['ratings', tx('Ratings'), tx('as estrelas de cada deck e a Arena automática.')],
        ['⛶', tx('⛶ Ecrã inteiro'), tx('o Coliseu ocupa o ecrã todo (Shift+F; sai com o mesmo botão, Shift+F ou Esc).')],
        ['↩', tx('voltar ao deck'), tx('regressa ao separador Deck do Construir.')],
      ],
      rows: [],
      subs: [
        { g: 'bots', t: tx('Bots a testar'), go: { col: 'bots' }, rows: [
          [tx('1 · Adversários'), tx('marca decks do meta, teus (⇄ Espelho = o mesmo deck), da comunidade, 🎲 ao acaso, ou cola uma lista. Em 3–4 jogadores escolhes os lugares B, C e D.')],
          [tx('2 · Regras do jogo'), tx('modo casual (formatos misturados, não conta para os ratings), 1 contra 1, todos contra todos (3 ou 4) ou equipas 2 contra 2, Bo1/Bo3/Bo5, séries por adversário e as dificuldades dos dois lados.')],
          [tx('Sideboard inteligente / Aprender'), tx('entre jogos troca cartas do sideboard sozinho; «aprender» usa os jogos anteriores contra o mesmo adversário.')],
          [tx('3 · Ver os jogos'), tx('ao vivo, com velocidade, pausa entre jogos e as mãos visíveis ou escondidas.')],
          [tx('▶ Correr testes / ■ Parar aqui'), tx('começa; parar guarda os jogos acabados.')],
          [tx('Relatório'), tx('vitórias, turnos, mulligans, o pior adversário, cada jogo para rever (J1 V/D ▶), melhorias com botão (trocar, juntar ao sideboard) e as cartas que mais pesaram.')],
          [tx('Testes anteriores deste deck'), tx('as sessões guardadas: Abrir ou apagar.')],
        ] },
        { g: 'forge', t: tx('Jogar contra o Forge'), go: { col: 'jogar' }, rows: [
          [tx('✦ Mesa do Grimório'), tx('a mesa no browser: o Forge aplica as regras e joga a IA; conta para os ratings. (Commander só no clássico.)')],
          [tx('🖥 Forge clássico'), tx('a aplicação do Forge numa janela, para Commander e para retomar posições de réplicas.')],
          [tx('Partida Bo1 / Bo3 / Bo5'), tx('numa série trocas cartas com o sideboard entre jogos.')],
          [tx('Adversário'), tx('📊 Meta, 🧙 Meus, 🤝 Amigos, 🌐 Comunidade, 🎲 ao acaso, ⇄ espelho ou 🎲 Casual (decks de todos os formatos).')],
          [tx('Dificuldade da IA'), tx('Normal, Cautelosa, Imprudente, Experimental ou Forte (verifica jogadas).')],
          [tx('▶ Jogar contra o Forge'), tx('abre a mesa (ver «A mesa de jogo»). «Voltar ao jogo em curso» retoma um jogo por acabar.')],
          [tx('🏆 Jogar um torneio'), tx('vai ao Torneio já com «Jogo eu os jogos do meu deck» marcado.')],
        ] },
        { g: 'torneio', t: tx('Torneio'), go: { col: 'torneio' }, rows: [
          [tx('✦ Criar · Regras'), tx('nome, casual, formato, tipo (eliminação simples ou dupla, suíço, liga, mesas, gauntlet, rei da colina, grupos, equipas), partidas Bo1–Bo5 e rondas.')],
          [tx('✦ Criar · Decks'), tx('🎲 Preencher até N (teus, amigos, comunidade, meta, por estrelas), 🥈 Pódios e 🏆 Campeões de torneios antigos, ou + um a um; ☆ eu marca o teu deck.')],
          [tx('🏆 Começar o torneio'), tx('começa (10 s para apostar, ou espera pelo teu OK). 🏅 Ranked quando não é casual e pelo menos 20% dos decks são do meta.')],
          [tx('🎮 Jogo eu os jogos do meu deck'), tx('os jogos do teu deck jogas tu no Forge Play; os outros joga o Forge.')],
          [tx('🎲 Gerador'), tx('cria até 10 torneios de uma vez, ao acaso dentro do que escolheres.')],
          [tx('🏆 Ao vivo'), tx('árvore ou classificação, cada jogo para rever, ❚❚ Pausar, ▶ Retomar, ■ Cancelar e o pódio no fim.')],
          [tx('🪙 Apostas'), tx('moedas a fingir: aposta no campeão ou em cada partida (🪙 no cartão da partida); carteira, lucro e histórico.')],
          [tx('📜 Registo'), tx('todos os torneios, com filtros, os teus troféus, o hall da fama e a galeria de troféus.')],
        ] },
        { g: 'draft', t: tx('Draft e selado'), go: { col: 'draft' }, rows: [
          [tx('Booster draft / Selado'), tx('mesa de 8 com 3 packs a passar, ou 6 packs para cada um.')],
          [tx('Set'), tx('procura pelo nome ou código; a primeira vez pode demorar até 40 s.')],
          [tx('🧙 Eu + bots / 🤖 Só bots'), tx('draftas tu com os bots, ou só vês.')],
          [tx('Escolher'), tx('toca numa carta para a ver e outra vez (ou «Escolher») para a levar; ★ marca a melhor pela taxa de vitórias do 17lands.')],
          [tx('Montar o meu deck no Construir'), tx('o Forge propõe um deck de 40; o resto fica no sideboard.')],
          [tx('▶ Começar o torneio'), tx('um suíço com os bots, em que joga o Forge por ti ou jogas tu.')],
        ] },
        { g: 'ratings', t: tx('Ratings e Arena'), go: { col: 'ratings' }, rows: [
          [tx('Estrelas de 0 a 6'), tx('a hipótese de ganhar a um deck médio do formato: 3★ ganha metade das vezes, 6★ ganha sempre. Mais claras = provisórias (menos de 10 jogos).')],
          [tx('Amarelas, azuis, vermelhas'), tx('amarelas: jogos normais do formato; azuis: todos, casuais incluídos; vermelhas: quanto chega ao objetivo de vitória.')],
          [tx('Normal / Casual, formato, de quem'), tx('filtram a tabela; tocar num deck mostra a curva e as rondas.')],
          [tx('Arena automática'), tx('o Forge joga rondas ao acaso para encher os ratings, só quando o simulador está livre. ▶ Ligar a Arena / 👁 Ver ao vivo.')],
        ] },
      ] },

    { id: 'mesa', g: 'forge', t: tx('A mesa de jogo'), go: { col: 'jogar' },
      intro: tx('A mesa onde jogas contra o Forge (e nos jogos online contra bots). O Forge aplica as regras: tu arrastas, tocas e carregas em OK. Em cima, o turno e a fase; ao lado, o que o Forge te pede e os botões.'),
      bar: [
        ['OK', tx('OK / passar'), tx('o botão principal do pedido do Forge (Enter). Sem nada para fazer, passa a prioridade.')],
        ['⏭', tx('Acabar o turno'), tx('passa até ao fim do turno (Shift+Enter).')],
        ['✕', tx('Cancelar'), tx('o segundo botão (Esc); a meio de um pagamento, desfaz o pagamento.')],
        ['↶', tx('↶ desfazer'), tx('pede ao Forge para desfazer a última jogada.')],
        ['▦', tx('▦ arrumar'), tx('aparece depois de mexeres nas tuas cartas à mão: volta às filas automáticas.')],
        ['⏢', tx('⏢ perspetiva'), tx('liga ou desliga a inclinação do lado do adversário.')],
        ['🂠', tx('Cartas: automático'), tx('o tamanho das cartas na mesa (48 a 128 px).')],
        ['⟳', tx('⟳ rodar'), tx('só no telemóvel/tablet: muda entre ao alto e deitado.')],
        ['🎨', tx('🎨 tapete'), tx('o padrão da mesa e a esfera da vida: estilo, animação, 3D, partículas e tamanho.')],
        ['📖', tx('📖 Regras rápidas'), tx('procura uma palavra-chave ou regra sem sair do jogo.')],
        ['dados', tx('🎲 Dados'), tx('d6, 2d6, d20 ou moeda, lançados na mesa.')],
        ['🏳', tx('🏳 desistir'), tx('desiste logo do jogo, sem perguntar.')],
        ['⛶', tx('⛶ Ecrã inteiro'), tx('no canto da mesa (Shift+F no Coliseu).')],
      ],
      rows: [
        [tx('Jogar uma carta'), tx('arrasta-a da mão para a mesa, ou duplo clique nela. Um clique só a levanta e mostra. Largada em cima de uma permanente, essa fica como alvo.')],
        [tx('Terrenos e mana'), tx('um terreno vai sempre para a fila dos terrenos; clicar num terreno teu tira a mana. A mana na reserva aparece em bolinhas: toca numa para a usar.')],
        [tx('Atacar'), tx('na fase principal ou ao declarar atacantes, arrasta a criatura para o lado do adversário (ou para um planeswalker/batalha); ou toca nas criaturas e depois OK.')],
        [tx('Bloquear'), tx('arrasta a tua criatura para cima do atacante, ou toca nela e depois no atacante. Feito antes do Forge perguntar, fica «marcado» e entra sozinho; ✕ desfaz.')],
        [tx('Habilidades'), tx('clica numa permanente tua com prioridade: as de mana vão logo; as outras abrem «Ativar?». Duplo clique abre as ações em qualquer fase.')],
        [tx('A pilha'), tx('o que foi lançado aparece em leque no meio, com o alvo e o texto; ao resolver mostra «A resolver». Ao escolher alvos, a pilha fica transparente.')],
        [tx('Pedidos do Forge'), tx('mulligan («Ficar com a mão» / «Mulligan»), moeda ao ar, vidência, procurar na biblioteca, ordenar, escolher: cada um abre a sua janela com Confirmar.')],
        [tx('Esfera da vida (clique)'), tx('quando o Forge pede um alvo, um clique escolhe esse jogador; ao atacar, devolve o ataque ao jogador.')],
        [tx('Cemitério e exílio'), tx('tocar nas pilhas abre-as; fecha-se com «fechar», tocando fora ou a deslizar para baixo.')],
        [tx('Tocar e manter (tablet/telemóvel)'), tx('mostra a carta em grande; dois dedos ampliam, duplo toque aproxima, desliza para baixo para fechar.')],
        ...(isTouch() ? [] : [[tx('Passar o rato'), tx('mostra a carta em grande no painel ao lado; no P/T vês as contas (impresso, marcadores, efeitos).')]]),  // no toque: a linha de cima
        [tx('Histórico do jogo'), tx('as últimas jogadas; os nomes das cartas mostram-nas.')],
        [tx('Fim do jogo'), tx('«▶ Jogar outra vez», «Jogo seguinte (sideboard)» numa série, ou Fechar.')],
      ],
      subs: [
        { g: '🔮', t: tx('A esfera da vida'), rows: [
          [tx('O que ela mostra'), tx('a vida no meio e, à volta, o que se passa no jogo: tem uma parte só sua neste guia, «A esfera da vida».')],
        ] },
      ],
      keys: [
        ['Enter', tx('OK / passar')], ...(P.space ? [[tx('Espaço'), tx('o mesmo que Enter')]] : []), ['Shift+Enter', tx('acabar o turno')], ...(P.shiftSpace ? [[tx('Shift+Espaço'), tx('acabar o turno')]] : []), ['Esc', tx('cancelar / fechar')],
        [T, tx('virar (tap) a tua carta debaixo do rato')], [F, tx('ver a outra face (só no teu ecrã)')], ['Shift+F', tx('ecrã inteiro')],
      ], touch: gestures().play },

    { id: 'esfera', g: '🔮', t: tx('A esfera da vida'), go: { col: 'jogar' },
      intro: tx('Cada jogador tem uma esfera de vidro com um fluido lá dentro. A vida está no meio; tudo o resto conta o que se passa no jogo. É a mesma no Forge Play, na mesa livre e nas réplicas dos jogos.'),
      bar: [],
      rows: [],
      subs: [
        { g: '🎨', t: tx('Cores e fluido'), rows: [
          [tx('O estilo'), tx('no automático vem das cores das cartas que já se viram desse lado (três cores ou mais dão Prisma) e fixa-se ao fim de 5 cartas. No início do jogo valem as cores do deck.')],
          [tx('A matéria do fluido'), tx('cada cor das cartas em campo põe a sua matéria no fluido: permanentes inteiras, terrenos pelas cores que dão, cemitério e exílio um pouco; artefactos e incolores dão cinzento.')],
          [tx('A animação'), tx('o fumo calmo, em turbilhão (deck de criaturas), a pulsar ou com faíscas (muitos instantâneos e feitiços).')],
          [tx('Mana a voar'), tx('a mana tirada dos terrenos voa com física para dentro da esfera e injeta a matéria da sua cor.')],
          [tx('Golpes e feitiços'), tx('a cor da carta que te atingiu entra no fluido, cai ao fundo e fica como mancha durante uns segundos.')],
        ] },
        { g: '🩸', t: tx('Vida, dano e veneno'), rows: [
          [tx('Dano levado'), tx('quanto mais abaixo da vida inicial, mais veias de sangue no fluido; com muito dano, a esfera sangra.')],
          [tx('Ganhar e perder vida'), tx('um clarão: fumo de sangue a perder, luz dourada a ganhar; o número conta até ao valor novo.')],
          [tx('Pouca vida'), tx('o vidro racha e fica vermelho; a esfera fica pesada de arrastar e pinga ao mexer.')],
          [tx('Coração'), tx('aos 8 de vida começa a bater devagar, e mais depressa perto da morte.')],
          [tx('Veneno'), tx('veias verdes e bolhas a subir, mais fortes perto dos 10 marcadores (15 no Two-Headed Giant); o ☠ ao lado conta-os.')],
          [tx('Muita vida (40+)'), tx('ganha um excesso ao acaso (auréola, gelatina, suor de luz ou raios divinos); a partir dos 70, dois.')],
        ] },
        { g: '✨', t: tx('A mesa à volta'), rows: [
          [tx('Auras a favor'), tx('as tuas auras e equipamentos nas tuas criaturas, e os teus encantamentos: faíscas douradas a subir.')],
          [tx('Auras contra'), tx('auras dos adversários nas tuas permanentes: uma sombra escura entra pelas bordas.')],
          [tx('Cemitério e exílio'), tx('o cemitério deposita sedimento no fundo, que sobe à medida que enche; o exílio solta fios de luz pálida.')],
          [tx('Biblioteca a acabar'), tx('com 10 cartas ou menos, a esfera pinga por baixo e esvazia-se, mais depressa quanto menos restam.')],
          [tx('Calor e frio'), tx('feitiços e cartas vermelhas aquecem (o halo puxa para brasa e o vidro transpira); azuis e cartas de neve arrefecem (halo gelado e geada no vidro).')],
          [tx('Presença e halo'), tx('motas de luz nas cores do deck orbitam por fora; o halo cresce e acende com os terrenos e as criaturas em campo.')],
          [tx('Muitos terrenos'), tx('um cinto de mana de pontos de luz à volta do equador.')],
          [tx('Criaturas fortes'), tx('quanto mais poder em campo, mais bravo fica o enxame do halo.')],
        ] },
        { g: '💥', t: tx('Como se parte'), rows: [
          [tx('Morrer'), tx('parte-se conforme a causa: dano parte-a, veneno derrete-a, biblioteca vazia escorre a cinzento, dano de comandante corta-a ao meio, desistir deixa-a cair, empate torna-a pedra.')],
          [tx('Antes de rebentar'), tx('as rachas crescem e a esfera treme e brilha; em 3D os cacos ficam na mesa e podes empurrá-los.')],
        ] },
        { g: '⚙', t: tx('3D, partículas e qualidade'), rows: [
          [tx('3D ou plana'), tx('em 3D (WebGL) tem vidro, luz e fluido de verdade; plana é a esfera clássica, mais leve. Sem WebGL fica plana sozinha.')],
          [tx('Fluido de partículas'), tx('ligado, o fluido são grãos com física, que chapinham quando a atiras; desligado, um líquido animado, mais leve.')],
          [tx('Aspeto das partículas'), tx('Realista: grãos com luz própria. Estilizado: estrelas, penas e brilhos desenhados.')],
          [tx('Qualidade da esfera'), tx('Automática (a placa gráfica, se der), Placa gráfica (dezenas de milhares de grãos), Processador (5 mil) ou Leve (para aparelhos fracos). Tudo é desenhado no teu aparelho, também online.')],
          [tx('Onde se muda'), tx('em 🎨 tapete ou Definições › Mesa: estilo, animação, 3D, fluidos pelas cartas, partículas, aspeto, qualidade e tamanho das esferas.')],
          [tx('Arrastar a esfera'), tx('podes agarrá-la e atirá-la: bate nas bordas, abana as cartas, empurra os dados e volta sozinha.')],
          [tx('Um segredo'), tx('quem fica muito tempo a olhar para uma esfera descobre o que ela tem por dentro.')],
        ] },
      ] },

    { id: 'online', g: 'online', t: tx('Online e mesa livre'), go: { col: 'online' },
      intro: tx('Jogar com amigos. Uma sala tem um link: quem o abre entra, escolhe o deck e senta-se. Na mesa livre jogam pessoas, à mão, sem bots nem regras automáticas — como numa mesa a sério.'),
      bar: [
        ['criar', tx('✦ Nova sala'), tx('escolhe o tipo: jogo ou torneio com bots, mesa livre (2–4 amigos), torneio misto (pessoas e bots), torneio de mesa livre ou mesa livre a solo.')],
        ['porta', tx('🚪 Salas'), tx('as salas abertas: lugares, quem está pronto, o link da sala e o lobby 3D.')],
        ['torneio', tx('🏆 Ao vivo'), tx('o torneio da sala a decorrer, com as partidas à mesa livre ou no Forge Play.')],
        ['moeda', tx('🪙 Apostas'), tx('apostar com moedas a fingir nos jogos dos bots.')],
        ['🌍', tx('🌍 Abrir à internet'), tx('abre um túnel grátis para os links das salas funcionarem fora de casa; «fechar à internet» fecha.')],
      ],
      rows: [
        [tx('🔗 Link da sala / copiar'), tx('quem abrir o link entra, mesmo sem estar nos amigos. Em casa, o link «🏠 na mesma rede» funciona sem internet.')],
        [tx('Escolhe o deck com que te sentas'), tx('🧙 os teus, 🤝 emprestados pelo anfitrião, 📊 do meta ou 📋 colar lista ou link; depois «🪑 Sentar-me com este deck».')],
        [tx('✋ Estou pronto'), tx('quando todos estão prontos há uma contagem, a moeda cai ao lado de quem começa e a mesa abre para todos. O anfitrião pode «▶ Começar» antes.')],
        [tx('＋ Emprestar um deck'), tx('o anfitrião deixa decks seus para quem se sentar sem deck.')],
        [tx('Lobby 3D'), tx('cada um tem a caixa do deck na mesa: arrasta-a e atira-a; 🔒 Deixar ver o meu deck deixa os outros abrir a tua caixa e virar as cartas.')],
        [tx('Conversa'), tx('escreve à sala ou à mesa; @ sugere cartas, # sugere regras; ☺＋ reage a uma mensagem.')],
        [tx('🔗 Entrar numa sala de outro Grimório'), tx('cola o link de uma sala de outra pessoa e leva todos os teus decks ou só um.')],
        [tx('Amigos (Definições)'), tx('um link de convite pessoal: os decks do amigo ficam guardados aqui e ele entra nos teus torneios e salas.')],
      ],
      subs: [
        { g: '🃏', t: tx('Mesa livre'), intro: tx('Ninguém vê a tua mão nem a tua biblioteca; as cartas viradas para baixo só tu as vês.'), rows: [
          [tx('▶ Passar a vez'), tx('passa a vez ao jogador seguinte.')],
          [tx('☀ Novo turno'), tx('desvira tudo e compra 1. «↺ Desvirar» só desvira.')],
          [tx('🂠 Comprar / 👁 Ver o topo'), tx('compra ou vê 1 a 10 cartas; no topo, cada carta vai para a mão, o fundo, o cemitério, o exílio ou o campo.')],
          [tx('🔀 Baralhar / ♻ Mulligan'), tx('baralha; o mulligan devolve a mão, baralha e compra 7.')],
          [tx('✦ Ficha'), tx('escreve o nome (Goblin, Treasure…) e ＋ cria a ficha.')],
          [tx('🎲 d6 · 2d6 · d20 · moeda'), tx('todos veem os mesmos dados 3D; podes agarrá-los e atirá-los.')],
          [tx('✏️ Caneta'), tx('desenha na mesa para todos; o traço apaga-se em segundos.')],
          [tx('Menu da carta'), tx('botão direito (ou tocar e manter): virar, atacar, marcadores +1/+1 e outros, transformar, prender a outra carta, virar para baixo e mover para mão, cemitério, exílio, biblioteca ou zona de comando.')],
          [tx('Esfera da vida'), tx('toca nela para vida −5/−1/+1/+5, veneno, energia, dano de comandante, monarca, iniciativa e bênção da cidade.')],
          [tx('⋯ Mais'), tx('perspetiva, tamanho das cartas, padrão da mesa, dia/noite, «🏆 Ganhei este jogo» (os outros confirmam), desistir e sair da mesa.')],
        ] },
      ],
      keys: [['D', tx('comprar')], ['V', tx('ver o topo')], ['S', tx('baralhar')], ['M', tx('moer 1')], ['X', tx('exilar o topo')], ['P', tx('caneta')], [T, tx('virar (tap)')], [F, tx('transformar ou virar para baixo')], ['Esc', tx('fechar menus e caneta')]], touch: gestures().free },

    { id: 'regras', g: 'regras', t: tx('Regras'), go: null,
      intro: tx('Dúvidas de regras e de cartas, em qualquer língua. O separador «Regras do Magic» aqui em cima é a pesquisa; este guia é o outro separador.'),
      bar: [
        ['⌕', tx('Procurar'), tx('uma keyword, um número de regra (702.19b), uma palavra (pilha) ou o nome de uma carta, em português ou noutra língua.')],
        ['scan', tx('Ler carta'), tx('📷 lê a carta pela câmara ou por uma foto e procura-a.')],
        ['✦', tx('✦ Explicar com a IA'), tx('explica as regras encontradas em português, citando os números (precisa da IA ligada).')],
      ],
      rows: [
        [tx('Carta encontrada'), tx('o texto com cada keyword a ligar à sua regra (toca para a procurar) e os rulings oficiais.')],
        [tx('Glossário e regras'), tx('os termos e as regras oficiais (Comprehensive Rules); «→ número» salta para essa regra.')],
        [tx('#regra na conversa'), tx('na conversa da mesa, # sugere regras e «📖 Abrir nas Regras» traz-te aqui.')],
      ] },

    { id: 'definicoes', g: 'gear', t: tx('Definições'), go: { settings: true },
      intro: tx('O ⚙ no cabeçalho (e na página inicial). Em cima há uma caixa para filtrar as definições pelo nome.'),
      bar: [],
      rows: [
        [tx('Perfil e Língua'), tx('trocar ou criar perfil, mudar o nome ou a cor; a língua da app (os nomes das cartas ficam em inglês).')],
        [tx('Jogos do Forge ao mesmo tempo'), tx('quantos jogos correm em paralelo (o sugerido vem da memória livre) e qual torneio tem prioridade.')],
        [tx('🤖 Bots predefinidos'), tx('a dificuldade com que começam o Laboratório, os torneios e a Arena.')],
        [tx('Som'), tx('volume geral e por grupo (cartas, combate, esfera da vida, dados, fim do jogo), com ▶ Ouvir.')],
        [tx('Ecrã'), tx('não deixar o ecrã apagar-se e a orientação em ecrã inteiro (só Android).')],
        [tx('Mesa (Forge Play)'), isTouch() ? tx('os gestos de toque, pagar a mana sozinho, deixar resolver sozinho, arrumação (grelha, livre, filas), tamanho das cartas, padrão da mesa e esfera da vida, cartas dos adversários e perspetiva.') : tx('Espaço = Enter, as teclas de virar e de ver a outra face, pagar a mana sozinho, deixar resolver sozinho, arrumação (grelha, livre, filas), tamanho das cartas, padrão da mesa e esfera da vida, cartas dos adversários e perspetiva.')],
        [tx('Imagens das cartas'), tx('da Scryfall ou pelo Grimório, para redes que bloqueiam a Scryfall.')],
        [tx('Estrelas dos decks'), tx('quais estrelas mostrar: amarelas, azuis, vermelhas.')],
        [tx('Cores nos jogos'), tx('a tua cor e a do adversário nos jogos e nos torneios.')],
        [tx('Terrenos básicos'), tx('as artes preferidas dos básicos para os decks novos.')],
        [tx('Confirmações'), tx('o que pergunta antes: apagar, tirar a última cópia, mudar o formato, passar o combate sem atacar ou sem bloquear…')],
        [tx('🤖 IA'), tx('a chave de um fornecedor de IA (opcional) e o modelo.')],
        [tx('🤝 Amigos'), tx('convidar amigos com um link e partilhar pela internet.')],
        [tx('Torneios'), tx('esperar pelo teu OK para começar, o jogo que abre a seguir e destacar os teus decks.')],
        [tx('Recomeçar'), tx('repor os ratings ou os troféus de todos os decks.')],
        [tx('Dados e cópias'), tx('exportar e importar tudo, ou sincronizar com uma pasta na nuvem (Google Drive, Dropbox, Syncthing…).')],
        [tx('Atualizações'), tx('nas versões instaladas: atualizar sozinho e as notas da versão.')],
      ] },

    { id: 'ferramentas', g: 'vida', t: tx('Ferramentas da mesa'), go: { tool: 'vida' },
      intro: tx('Para jogar com cartas a sério: abrem-se da página inicial, em ecrã próprio. Em cima, «❤ Vida» e «🎲 Dados» trocam entre as duas; o logótipo volta ao início.'),
      bar: [
        ['vida', tx('Contador de vida'), tx('1 a 6 jogadores, vida inicial 20 a 60, frente a frente, Commander, quem começa e registo.')],
        ['scan', tx('Ler carta'), tx('a câmara lê o nome da carta no próprio aparelho e «＋ Juntar» mete-a no deck aberto.')],
        ['dados', tx('Dados'), tx('d4, d6, d8, d10, d12, d20, d100 e moeda, em 3D ou 2D, com registo.')],
      ],
      rows: [],
      subs: [
        { g: 'vida', t: tx('Contador de vida'), go: { tool: 'vida' }, rows: [
          [tx('Metade esquerda / direita'), tx('− e + um de vida; manter carregado repete cada vez mais depressa.')],
          [tx('Nome'), tx('toca no nome do jogador para o mudar.')],
          [tx('☠ Veneno'), tx('− e +; aos 10 o jogador morre.')],
          [tx('⚔ Commander'), tx('liga o dano de comandante (21 mata), o imposto, partner, monarca e iniciativa; «tira também vida» desconta-o da vida.')],
          [tx('👑 Quem começa'), tx('sorteia quem começa, com animação.')],
          [tx('↺ Novo jogo'), tx('repõe tudo; «desfazer» fica 7 s.')],
          [tx('Registo da vida'), tx('cada mudança fica registada; «🗑 limpar registo».')],
        ] },
        { g: 'dados', t: tx('Dados'), go: { tool: 'dados' }, rows: [
          [tx('Tocar num dado'), tx('junta um à mão (até 12); − tira.')],
          [tx('🎲 Lançar'), tx('lança os que juntaste; d20, 2d6, moeda e ↻ Repetir são atalhos.')],
          [tx('Agarrar e atirar'), tx('em 3D podes agarrar um dado com o dedo e atirá-lo outra vez.')],
          [tx('Resultado'), tx('a soma Σ; um 20 no d20 é crítico, um 1 é falhanço.')],
        ] },
        { g: 'scan', t: tx('Ler carta'), go: { sec: 'construir', scan: true }, rows: [
          [tx('Câmara'), tx('põe a carta dentro da moldura e toca na imagem (ou «📸 Tirar foto e ler»). Precisa de https.')],
          [tx('🖼 Foto ou imagem'), tx('lê de uma foto já tirada.')],
          [tx('＋ Juntar'), tx('junta a carta lida ao deck aberto; a janela fica aberta para a seguinte.')],
        ] },
      ] },
  ]
  const walks = [
    { id: 'deck', area: 'construir', g: 'criar', t: tx('Criar o primeiro deck'), go: { sec: 'construir', tab: 'deck' }, steps: [
      tx('Toca em «✦ Novo deck» (no cabeçalho ou na página inicial).'),
      tx('Escolhe o formato. Para começar, Commander ou Modern; o nome pode ficar vazio.'),
      tx('Em «Como queres começar?», escolhe «▦ Escolher 3–10 cartas».'),
      tx('Procura as cartas de que gostas e toca nelas. No Commander, ♛ numa lendária faz dela comandante (ou escolhe em «Comandantes que encaixam»).'),
      tx('Toca em «✦ Criar e completar o deck» e revê a proposta: desmarca o que não queres e aplica.'),
      tx('Vê a Análise: «válido» a verde e as «Melhorias prioritárias». Afina em Sugestões, com o porquê de cada carta.'),
    ] },
    { id: 'forge', area: 'mesa', g: 'forge', t: tx('Jogar contra o Forge'), go: { col: 'jogar' }, steps: [
      tx('Abre o deck com que queres jogar (no Construir ou na Biblioteca).'),
      tx('Vai a Coliseu › Jogar contra o Forge e escolhe «✦ Mesa do Grimório».'),
      tx('Escolhe o adversário (Meta, Meus, Comunidade…) e a dificuldade da IA.'),
      tx('Carrega em «▶ Jogar contra o Forge». Se ganhares a moeda, escolhes se jogas primeiro; depois «Ficar com a mão» ou «Mulligan».'),
      tx('Arrasta um terreno da mão para a mesa e depois os feitiços; a mana paga-se a clicar nos terrenos (ou sozinha, se ligares nas Definições).'),
      tx('Para atacar, arrasta as criaturas para o lado do adversário e carrega em OK. Para bloquear, arrasta a tua criatura para cima do atacante.'),
      tx('Sem nada para fazer, OK (Enter) passa a prioridade; Shift+Enter acaba o turno. Ganha quem deixar o outro a 0!'),
    ] },
    { id: 'lab', area: 'coliseu', g: 'bots', t: tx('Testar um deck contra bots'), go: { col: 'bots' }, steps: [
      tx('Com o deck aberto, vai a Coliseu › Bots a testar.'),
      tx('Em «Adversários», marca 2 ou 3 decks do meta (ou 🎲 ao acaso).'),
      tx('Em «Regras do jogo», deixa 1 contra 1 e Bo3, com 2 ou 3 séries por adversário.'),
      tx('Carrega em «▶ Correr testes» e vê os jogos ao vivo, ou faz outra coisa: a barra de cima mostra o progresso.'),
      tx('No relatório, vê o pior adversário e aplica as melhorias com um toque (trocar, juntar ao sideboard).'),
    ] },
    { id: 'torneio', area: 'coliseu', g: 'torneio', t: tx('Fazer um torneio'), go: { col: 'torneio' }, steps: [
      tx('Vai a Coliseu › Torneio › ✦ Criar.'),
      tx('Escolhe o formato e o tipo (suíço é um bom começo) e as partidas (Bo3).'),
      tx('Em Decks, «🎲 Preencher até 8» e marca o teu com ☆ eu.'),
      tx('Se quiseres jogar tu os teus jogos, marca «🎮 Jogo eu os jogos do meu deck».'),
      tx('Carrega em «🏆 Começar o torneio». Tens 10 s para apostar no campeão em 🪙 Apostas.'),
      tx('Segue em 🏆 Ao vivo: cada jogo pode ser revisto, e no fim aparece o pódio e os troféus.'),
    ] },
    { id: 'online', area: 'online', g: 'online', t: tx('Jogar online com amigos'), go: { col: 'online' }, steps: [
      tx('Vai a Coliseu › Online. Para amigos fora de casa, carrega em «🌍 Abrir à internet».'),
      tx('Em «✦ Nova sala», escolhe «🃏 Mesa livre», o número de jogadores e o teu deck.'),
      tx('Carrega em «🚪 Abrir a sala» e copia o 🔗 link da sala.'),
      tx('Manda o link aos amigos: abrem-no, escolhem um deck (deles, emprestado, do meta ou colado) e sentam-se.'),
      tx('Todos carregam em «✋ Estou pronto»: a moeda decide quem começa e a mesa abre para todos.'),
      tx('Na mesa, arrasta da mão para jogar, toca numa carta para a virar e usa ▶ Passar a vez. No fim, «🏆 Ganhei este jogo» e os outros confirmam.'),
    ] },
    { id: 'draft', area: 'coliseu', g: 'draft', t: tx('Fazer um draft'), go: { col: 'draft' }, steps: [
      tx('Vai a Coliseu › Draft, escolhe «Booster draft» e o set.'),
      tx('Escolhe «🧙 Eu + bots» e carrega em «▶ Começar o draft».'),
      tx('Em cada pack, toca numa carta para a ver e outra vez para a escolher. A ★ é a mais forte pelo 17lands.'),
      tx('No fim, «✎ Montar o meu deck no Construir» e acerta os 40.'),
      tx('Volta ao Draft e carrega em «▶ Começar o torneio» contra os bots.'),
    ] },
  ]
  return { areas, walks }
}
