[English](README.md) · **Português** · [Español](README.es.md) · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Constrói, testa e põe à prova os teus decks de Magic: The Gathering — com sugestões explicadas e jogos reais IA contra IA.**

O Grimório é um construtor de decks gratuito para todos os formatos (Commander, Modern, Pauper, Standard, Legacy, …)
que corre no teu próprio computador. Cruza o texto das cartas, decks reais de torneio, dados do EDHREC e combos do
Commander Spellbook para sugerir cartas *e explicar porquê*, e joga o teu deck contra outros decks com o motor de regras
de código aberto [Forge](https://github.com/Card-Forge/forge), para poderes ver os jogos, ler um relatório e melhorar a lista.

A interface está disponível em **English** (predefinição), **Português**, **Español**, **Deutsch** e **简体中文**
(Definições › Língua).

## Capturas de ecrã

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Página inicial"></a><br><sub>Página inicial</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Construir: lista, pesquisa e sugestões explicadas"></a><br><sub>Construir: lista, pesquisa e sugestões explicadas</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Sugestões por função, combos e decks reais"></a><br><sub>Sugestões por função, combos e decks reais</sub></td><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universo: o mapa 3D de todas as cartas"></a><br><sub>Universo: o mapa 3D de todas as cartas</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseu: vê o Forge jogar o teu deck"></a><br><sub>Coliseu: vê o Forge jogar o teu deck</sub></td><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Torneios com classificação e árvore ao vivo"></a><br><sub>Torneios com classificação e árvore ao vivo</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: estrelas por deck e a Arena automática"></a><br><sub>Ratings: estrelas por deck e a Arena automática</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Biblioteca com capas, estrelas e comparação"></a><br><sub>Biblioteca com capas, estrelas e comparação</sub></td></tr>
</table>

## Instalar

**Windows e Linux, sem Docker e sem configurar servidores:** descarrega o pacote em
[Releases](https://github.com/hubertdungen/grimorio/releases), extrai-o e abre o `Grimorio.exe` (Windows) ou o
`./grimorio` (Linux). O Grimório abre no teu navegador. Guia passo a passo para toda a gente: **[docs/INSTALL.pt.md](docs/INSTALL.pt.md)**.

No primeiro arranque, o Grimório pergunta *quem vai jogar*: cada pessoa cria um perfil com o seu nome, e os seus decks,
testes, torneios e ratings ficam separados. Várias pessoas podem partilhar a mesma instalação.

Para o pôr a correr num servidor em casa para vários dispositivos, ou para o desenvolver: vê
[Configuração para programadores](#configuração-para-programadores).

## Funcionalidades

- **Construção de decks para todos os formatos** — legalidade, objetivos próprios de cada formato, conselhos para a base de mana, curva, orçamento, brackets.
- **Sugestões inteligentes e explicadas** — embeddings de texto + EDHREC + decks reais + combos + o teu próprio gosto; em tempo real enquanto constróis.
- **Começa à tua maneira** — escolhe 3–10 cartas (ou um comandante) e deixa-o completar o deck, constrói à mão, importa, ou descreve uma ideia.
- **Importar** do TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 e Scryfall — perfis inteiros,
  ilustrações de carta e capas personalizadas, sideboard e maybeboard. Pesquisa decks públicos do Archidekt com filtros.
- **Universo 3D de cartas**, combos e pacotes de sinergia, comparação de decks e deteção de duplicados.
- **Coliseu (IA do Forge)** — IA contra IA com regras reais (Bo1/Bo3, sideboard inteligente, aprendizagem), todos contra
  todos a 3–4 jogadores e mesas de Commander, um tabuleiro animado que podes ver ao vivo, relatórios e melhorias
  sugeridas, e joga tu próprio contra o Forge no navegador (instalação de servidor com Docker).
- **Torneios** — eliminação simples/dupla, suíço, liga e mesas, árvore ao vivo, pódio e histórico.
- **Ratings** — 0–6 estrelas por deck (Elo por formato, mais um rating casual à parte) alimentadas por testes, torneios
  e uma Arena automática opcional.
- **Perfis** — uma instalação, vários jogadores, cada um com os seus decks.
- **Instalável** como PWA em telemóveis e tablets; pensado para ecrãs táteis.

### Como o Grimório aprende

As sugestões melhoram quanto mais deixares os bots jogar os teus decks no Coliseu (testes, torneios e a Arena
automática). Cada jogo regista que cartas foram compradas, lançadas ou ficaram presas na mão, quanto cada carta
contribuiu para a verdadeira condição de vitória do deck (dano, moer, veneno, combo, controlo…), o que venceu o deck,
e a classificação do deck (estrelas). Com isso, o Grimório:

- sugere cartas que respondem ao que te vence;
- propõe trocas inteligentes — *«troca X por Y»* com o motivo, com base na contribuição para a vitória, na utilização,
  na eficiência de mana, no papel em combos/sinergias e no preço;
- ajusta o plano de sideboard entre jogos;
- atualiza o rating de cada deck.

> **Dica:** antes de confiares nas sugestões, faz algumas séries Bo3 contra decks do meta (ou deixa a Arena ligada
> durante a noite) — 10 ou mais jogos por deck é um bom começo.

## Configuração para programadores

Linux (testado em Ubuntu 24.04), **Python 3.10+**, **Node.js 20+**, ~4 GB de RAM livre para os jogos, ~2 GB de disco.
O Forge corre em **Docker** quando está instalado (a predefinição num servidor Linux) ou num **Java 17** local
(`GRIMORIO_RUNTIME=local`, `GRIMORIO_JAVA=/path/to/java`). A construção dos dados corre em Docker.

```bash
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio

# 1. Forge 2.0.15 (rules engine): download "forge-installer-2.0.15.tar.bz2" from
#    https://github.com/Card-Forge/forge/releases/tag/forge-2.0.15 and extract it to ~/.local/share/grimorio/forge
mkdir -p ~/.local/share/grimorio/forge && tar -xjf forge-installer-2.0.15.tar.bz2 -C ~/.local/share/grimorio/forge

# 2. Card data (Scryfall + Commander Spellbook, embeddings, 3D map). Takes ~45 min the first time.
build/build.sh
python3 build/meta_mtgtop8.py --max-decks 400      # optional: recent tournament decks for the meta

# 3. Build the web app, compile the Forge launcher and install to ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 4. Run it and open http://localhost:8107
python3 ~/.local/share/grimorio/app/server.py --port 8107
```

Em resumo: 1. descarrega o Forge 2.0.15 (o motor de regras) e extrai-o para `~/.local/share/grimorio/forge`;
2. constrói os dados das cartas (cerca de 45 min da primeira vez; o meta do MTGTop8 é opcional); 3. constrói a app web,
compila o lançador do Forge e instala tudo em `~/.local/share/grimorio/app`; 4. arranca o servidor e abre
http://localhost:8107.

Opções: `--host`, `--port`, `--data-dir` (ou `GRIMORIO_DATA_DIR`), `--owner` (ou `GRIMORIO_OWNER`: um único
utilizador fixo). Sem `--owner`, o servidor funciona em modo de perfis; atrás de um proxy com login, o utilizador vem do
cabeçalho `Remote-User`.

Ambiente de execução do Forge: `GRIMORIO_RUNTIME=docker|local` (predefinição: docker quando o comando `docker` existe,
exceto no Windows), `GRIMORIO_JAVA` (executável do java), `GRIMORIO_FORGE_DIR` (predefinição `<data>/forge`). O modo
local precisa dos perfis de IA e dos scripts de cartas do Grimório (`forge-ext/ai`, `forge-ext/cardsfolder`) copiados
para a pasta do Forge; os pacotes fazem isto por ti. Pacotes para computador: `packaging/build.py` e
`.github/workflows/release.yml`.

## Estrutura do projeto

| Caminho | O quê |
|---|---|
| `server.py` | servidor HTTP só com a biblioteca padrão: API, decks (SQLite), perfis, importações, proxies |
| `sim.py`, `build/forge/` | executor do Forge (Docker ou Java local) e o lançador `GrimorioSim` (eventos exatos do jogo, ajustes à IA, dicas de IA por carta) |
| `tournament.py`, `ratings.py` | torneios e ratings / Arena |
| `deck_import.py`, `ia.py`, `play.py` | importadores de sites, fornecedores de IA opcionais, jogar contra o Forge (noVNC, só com Docker) |
| `build/` | pipeline de dados (Scryfall, embeddings, UMAP, combos, fichas, meta) |
| `web/` | front end em React + Vite |
| `packaging/` | pacotes para computador Windows/Linux: lançador, pacote e construtor de dados |

## Próximos passos

- App para Android — vê [docs/ROADMAP.md](docs/ROADMAP.md) (em inglês).
- Jogar tu próprio contra o Forge sem Docker (pacotes para computador).

## Créditos e aspetos legais

Dados e imagens das cartas: [Scryfall](https://scryfall.com) · combos: [Commander Spellbook](https://commanderspellbook.com)
· meta: [EDHREC](https://edhrec.com) e [MTGTop8](https://www.mtgtop8.com) · motor de regras: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0).

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

*O Grimório é Conteúdo de Fãs não oficial, permitido ao abrigo da Política de Conteúdo de Fãs da Wizards of the Coast.
Não é aprovado/apoiado pela Wizards. Partes dos materiais utilizados são propriedade da Wizards of the Coast.
© Wizards of the Coast LLC.*

## Licença

[GPL-3.0](LICENSE) — podes usá-lo, estudá-lo, alterá-lo e partilhá-lo livremente; as alterações que distribuíres têm de
continuar abertas, sob a mesma licença.
