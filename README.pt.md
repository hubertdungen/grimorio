[English](README.md) · **Português** · [Español](README.es.md) · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Constrói, testa e põe à prova os teus decks de Magic: The Gathering — com sugestões explicadas, jogos reais IA contra IA e jogos em que jogas tu contra o Forge.**

O Grimório é um construtor de decks gratuito para todos os formatos (Commander, Modern, Pauper, Standard, Legacy, …)
que corre no teu próprio computador. Cruza o texto das cartas, decks reais de torneio, dados do EDHREC e combos do
Commander Spellbook para sugerir cartas *e explicar porquê*, e joga o teu deck contra outros decks com o motor de regras
de código aberto [Forge](https://github.com/Card-Forge/forge), para poderes ver os jogos, ler um relatório e melhorar a lista.

E podes sentar-te tu à mesa: jogar contra o Forge na mesa do próprio Grimório, fazer torneios, ligas e campeonatos com
ranking, e abrir salas online para os amigos.

A interface está disponível em **English** (predefinição), **Português**, **Español**, **Deutsch** e **简体中文**
(Definições › Língua).

## Capturas de ecrã

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Página inicial"></a><br><sub>Página inicial</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Construir: pesquisa por palavras em qualquer língua, lista e sugestões"></a><br><sub>Construir: pesquisa por palavras em qualquer língua, lista e sugestões</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Sugestões por função, combos e decks reais"></a><br><sub>Sugestões por função, combos e decks reais</sub></td><td width="50%"><a href="docs/img/analysis.jpg"><img src="docs/img/analysis.jpg" alt="Análise: curva, cores, probabilidades da mão inicial e como o deck ganha"></a><br><sub>Análise: curva, cores, probabilidades da mão inicial e como o deck ganha</sub></td></tr>
<tr><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universo: o mapa 3D de todas as cartas"></a><br><sub>Universo: o mapa 3D de todas as cartas</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Biblioteca com capas, estrelas, troféus e comparação"></a><br><sub>Biblioteca com capas, estrelas, troféus e comparação</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseu: vê o Forge jogar o teu deck, com a pilha ao vivo"></a><br><sub>Coliseu: vê o Forge jogar o teu deck, com a pilha ao vivo</sub></td><td width="50%"><a href="docs/img/forgeplay.jpg"><img src="docs/img/forgeplay.jpg" alt="Joga tu contra o Forge na mesa do Grimório"></a><br><sub>Joga tu contra o Forge na mesa do Grimório</sub></td></tr>
<tr><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Torneios: pódio ao vivo, classificação e a origem de cada deck"></a><br><sub>Torneios: pódio ao vivo, classificação e a origem de cada deck</sub></td><td width="50%"><a href="docs/img/online.jpg"><img src="docs/img/online.jpg" alt="Salas online: jogos avulsos ou torneios por um link público"></a><br><sub>Salas online: jogos avulsos ou torneios por um link público</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: estrelas por deck e a Arena automática"></a><br><sub>Ratings: estrelas por deck e a Arena automática</sub></td><td width="50%"><a href="docs/img/table.jpg"><img src="docs/img/table.jpg" alt="À mesa: contador de vida, dados 3D e leitor de cartas"></a><br><sub>À mesa: contador de vida, dados 3D e leitor de cartas</sub></td></tr>
<tr><td width="50%"><a href="docs/img/draft.jpg"><img src="docs/img/draft.jpg" alt="Draft e Selado: packs reais, bots do Forge e um torneio no fim"></a><br><sub>Draft e Selado: packs reais, bots do Forge e um torneio no fim</sub></td><td width="50%"><a href="docs/img/sideboard.jpg"><img src="docs/img/sideboard.jpg" alt="Sideboard: respostas ao que te vence nos testes"></a><br><sub>Sideboard: respostas ao que te vence nos testes</sub></td></tr>
</table>

## Instalar

**Windows e Linux:** descarrega o pacote em [Releases](https://github.com/hubertdungen/grimorio/releases),
extrai-o e abre o `Grimorio.exe` (Windows) ou o `./grimorio` (Linux). No Windows o Grimório abre na sua própria janela
de aplicação; no Linux abre no navegador. Guia passo a passo para toda a gente: **[docs/INSTALL.pt.md](docs/INSTALL.pt.md)**.

**Atualizações:** os pacotes atualizam-se sozinhos. A versão nova descarrega-se em segundo plano (confirmada pela soma
sha256) e começa da próxima vez que abrires o Grimório; Definições › Atualizações desliga isto. Os teus decks, jogos,
torneios e ratings ficam fora da pasta da aplicação e passam para todas as versões novas, e antes de uma versão nova
abrir a base de dados fica uma cópia em `backups/`.

No primeiro arranque, o Grimório pergunta *quem vai jogar*: cada pessoa cria um perfil com o seu nome, e os seus decks,
testes, torneios e ratings ficam separados. Várias pessoas podem partilhar a mesma instalação.

Para o pôr a correr num servidor em casa para vários dispositivos, ou para o desenvolver: vê
[Configuração para programadores](#configuração-para-programadores).

## No teu servidor Linux (Docker)

Põe o Grimório num servidor em casa (um mini PC, um portátil antigo, um NAS com Linux) e abre-o em todos os
telemóveis, tablets e computadores da casa. O Coliseu corre o Forge em **Docker** e o *Jogar contra o Forge* funciona no
browser. Feito em Ubuntu 24.04 (outros Debian/Ubuntu recentes devem
servir); precisa de ~4 GB de RAM livre para os jogos e ~3 GB de disco.

```bash
# 1. Git, Python, Node.js 22 and Docker
sudo apt update && sudo apt install -y git python3 bzip2 curl unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # depois sai da sessão e volta a entrar

# 2. Grimório
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio
D=~/.local/share/grimorio && mkdir -p $D/forge

# 3. Forge 2.0.15 (o motor de regras)
curl -L https://github.com/Card-Forge/forge/releases/download/forge-2.0.15/forge-installer-2.0.15.tar.bz2 | tar -xj -C $D/forge

# 4. Dados das cartas, já feitos, da última versão (ou constrói-os com build/build.sh, ~45 min)
curl -L -o /tmp/grimorio-data.zip https://github.com/hubertdungen/grimorio/releases/latest/download/grimorio-data.zip
unzip -o /tmp/grimorio-data.zip -d $D

# 5. Compila a app web e instala-a em ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 6. Arranca e abre http://IP-DO-SERVIDOR:8107 em qualquer aparelho da casa
python3 $D/app/server.py --host 0.0.0.0 --port 8107
```

**Arrancar com o servidor** (serviço systemd do utilizador):

```ini
# ~/.config/systemd/user/grimorio.service
[Unit]
Description=Grimório
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 %h/.local/share/grimorio/app/server.py --host 0.0.0.0 --port 8107
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now grimorio
sudo loginctl enable-linger $USER   # continua a correr depois de saíres da sessão
```

- **Quem joga:** por omissão cada pessoa escolhe ou cria um perfil («Quem está a jogar?»). Para um só utilizador,
  acrescenta `--owner oteunome`.
- **Fora de casa:** nunca abras a porta 8107 à internet assim. Põe-na atrás de um login (um proxy como Caddy +
  Authelia, Cloudflare Tunnel com Access, ou Tailscale); o utilizador do login chega no cabeçalho `Remote-User` e cada
  pessoa tem os seus decks.
- **Atualizar:** `cd grimorio && git pull && ./deploy.sh` e depois `systemctl --user restart grimorio`.
- **Cópias:** vê a secção seguinte.

## Cópias e sincronização na nuvem

Tudo o que crias fica na tua própria instalação (`grimorio.db` na pasta de dados). Há duas formas opcionais de o
guardar, ambas grátis e ambas em **Definições › Dados e cópias**:

- **Exportar tudo** descarrega um ficheiro `.grimorio` (decks, perfis, testes, torneios, apostas, ratings e as capas
  dos decks). **Importar** repõe-no: por omissão *junta* (não se perde nada, ganha a versão mais recente de cada deck)
  ou *substitui* tudo; antes disso guarda sempre os dados atuais ao lado (`grimorio.db.before-import-…`).
- **Sincronizar com uma pasta na nuvem** mantém vários computadores iguais através de qualquer app grátis que sincronize
  uma pasta. O Grimório trabalha sempre na cópia local, por isso funciona sem rede (num avião, p.ex.): a app leva e traz
  as alterações quando a rede voltar. Cada computador escreve só o seu ficheiro nessa pasta e junta os dos outros.

| App grátis | Espaço grátis | Conta | Windows / macOS / Linux / Android |
|---|---|---|---|
| Google Drive para computador | 15 GB (partilhados com o Gmail) | Google | ✓ / ✓ / — (usa Syncthing ou Nextcloud) / app |
| OneDrive | 5 GB | Microsoft | ✓ (já vem no Windows) / ✓ / cliente não oficial / app |
| Dropbox | 2 GB | Dropbox | ✓ / ✓ / ✓ / app |
| Syncthing | sem limite (sem nuvem: os teus aparelhos sincronizam diretamente) | nenhuma | ✓ / ✓ / ✓ / Syncthing-Fork |
| Nextcloud | depende do fornecedor, ou o teu próprio servidor | Nextcloud | ✓ / ✓ / ✓ / app |
| iCloud Drive | 5 GB | Apple | iCloud para Windows / ✓ / — / — |

**Google Drive em 3 passos.** 1) Instala o *Google Drive para computador* e entra na conta (no Windows aparece o disco
`G:` com *O meu disco*). 2) No Grimório: Definições › Dados e cópias › marca *Sincronizar com uma pasta na nuvem*,
escolhe a sugestão *Google Drive* (`G:\O meu disco\Grimorio`) e carrega em *Usar esta pasta*. 3) No outro computador, a
mesma conta Google e a mesma pasta. Pronto.

**Syncthing em 3 passos** (sem conta, nada na nuvem de ninguém). 1) Instala o Syncthing nos dois aparelhos
([syncthing.net](https://syncthing.net); no Android: *Syncthing-Fork*). 2) Junta cada aparelho ao outro e partilha uma
pasta, p.ex. `~/Sync/Grimorio`. 3) Escolhe essa pasta no Grimório nos dois. Os aparelhos sincronizam quando estão ambos
ligados.

Se o mesmo deck mudou em dois computadores entre duas sincronizações, ganha o mais recente e o outro fica como
*«nome (conflito)»*: nunca se perde uma versão. Um torneio ainda a decorrer chega em pausa ao outro computador (só um o
joga de cada vez). Num servidor com login, cada pessoa exporta e importa só os seus dados; a pasta na nuvem é para
computadores e servidores de um só dono.

## Funcionalidades

- **Construção de decks para todos os formatos** — legalidade, objetivos próprios de cada formato, conselhos para a base de mana, curva, orçamento, brackets.
- **Sugestões inteligentes e explicadas** — embeddings de texto + EDHREC + decks reais + combos + o teu próprio gosto; em tempo real enquanto constróis.
- **Começa à tua maneira** — escolhe 3–10 cartas (ou um comandante) e deixa-o completar o deck, constrói à mão, importa, ou descreve uma ideia.
- **Importar** do TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 e Scryfall — perfis inteiros (como
  decks teus, da comunidade ou de um amigo), ilustrações de carta e capas personalizadas, sideboard e maybeboard.
  Pesquisa decks públicos do Archidekt com filtros.
- **Pesquisa por palavras, em qualquer língua** — «criaturas lendárias humano com marcadores +1/+1», «terrenos que
  compram cartas», «lands draw», «抽牌的地» ou a sintaxe do Scryfall (`t:`, `o:`, `mv<=`); com ou sem acentos; mais de
  35 funções das cartas (remoção, compra, mill, dano direto, blink, stax…) para filtrar.
- **Painel de análise** — números principais, curva de mana por criaturas e o resto, queijinhos de cores (o que os
  custos pedem vs. o que os terrenos dão), probabilidades da mão inicial, como o deck ganha e como perde, se o
  sideboard cobre o que o venceu, as cartas que ganham ou ficam presas na mão nos jogos, e um ⓘ a explicar cada número.
- **Universo 3D de cartas** — regiões por função que mostram o que falta ao teu deck, o desempenho de cada carta nos
  jogos com trocas sugeridas, constelações dos arquétipos do meta e um laço para achar as melhores cartas de qualquer zona.
- **Combos e pacotes de sinergia**, comparação de decks e deteção de duplicados.
- **Assistente de IA (opcional)** — chaves de vários fornecedores, modelos mais recentes detetados sozinhos; muda o
  deck diretamente (trocas, quantidades, substitutos para qualquer carta) com um clique.
- **Coliseu (IA do Forge)** — IA contra IA com regras reais (Bo1/Bo3, sideboard inteligente, aprendizagem), todos contra
  todos a 3–4 jogadores e mesas de Commander, um tabuleiro animado com a pilha ao vivo, relatórios e melhorias sugeridas.
- **Joga tu contra o Forge** — a mesa do próprio Grimório: arrastas uma carta para a jogar (só acende o que podes
  pagar), arrastas criaturas para atacar e bloquear, arrumas o teu lado à vontade, a pilha, as escolhas, scry e procurar
  na biblioteca na própria página, Enter para passar e Shift+Enter para acabar o turno. Funciona num servidor e nos
  pacotes para computador (sem Docker); o Commander usa a janela clássica do Forge (servidor com Docker).
- **Torneios, ligas e campeonatos** — eliminação simples e dupla, suíço, liga, mesas, gauntlet, rei da colina, grupos +
  eliminação e equipas; gerador de torneios, árvore ao vivo, pódio e histórico, liga dos campeões e dos pódios, troféus
  de ouro, prata, bronze e platina nos decks que ganham, ranked ou casual; apostas com moedas a fingir (nada se compra,
  sem dinheiro a sério).
- **Ratings e ranking** — 0–6 estrelas por deck (Elo por formato, mais um rating casual à parte), hall da fama e
  galeria de troféus, alimentados por testes, torneios e uma Arena automática opcional.
- **Online e amigos** — um separador Online para jogos avulsos ou torneios com um link público (um túnel gratuito da
  Cloudflare num clique, ou o teu domínio): quem o abre entra com um deck seu, sem conta. Convites de amigos, os decks
  dos amigos como fonte nos torneios e na Arena, e etiquetas com a origem de cada deck (meta, meu, amigo, comunidade).
- **📖 Biblioteca de regras** — keywords, regras ou nomes de cartas em qualquer língua (também pela câmara):
  Comprehensive Rules, rulings oficiais e uma explicação opcional da IA.
- **Proxies** — lista com as edições para sites de proxies, ZIP com as imagens, ou um PDF pronto como as gráficas
  pedem: papel, margens, tamanho da carta, espaço entre cartas, bleed (preto, uma cor ou a margem da carta esticada),
  guias de corte por carta, marca de água e frente e verso.
- **À mesa** — contador de vida (até 6 jogadores), dados em 3D e leitor de cartas pela câmara com moldura de mira.
- **Bots predefinidos** — o perfil da IA do Forge para o teu deck e para os adversários no Laboratório, nos torneios e
  na Arena; uma barra mostra o que está a decorrer e leva ao visualizador em direto.
- **Draft e Selado** — abre packs reais de qualquer um de 160 sets (os boosters do próprio Forge): faz o draft numa
  mesa de 8 com bots do Forge, vê 8 bots a fazê-lo, ou abre 6 packs para selado. Os bots montam os decks de 40, o teu
  pool vira um deck Limitado no Construir e segue-se um torneio suíço — o Forge joga os teus jogos ou jogas tu no Forge Play.
- **Contra o que perdes** — as sugestões de sideboard leem os teus testes: os tipos de cartas que te vencem
  (criaturas, cemitério, artefactos…) e respostas nas tuas cores que a IA sabe lançar, primeiro as que os sideboards
  do meta levam. As cartas que a IA do Forge nunca lança ficam assinaladas.
- **Ratings do deck na Análise** — estrelas normal, todos os jogos, objetivo e casual, com Elo e jogos, e as estrelas
  dos troféus.
- **IA do Forge mais esperta** — o Grimório corrige o Forge onde jogava mal decks reais: terrenos pela cor que a mão
  precisa (fetchlands incluídos), Urza's Saga, o combo Heliod + Spike Feeder, Food na altura certa, vitória pelo Maze's
  End, decks de storm (Wish, Manamorphose), Wrath of the Skies, alvos do Path to Exile e auras empilhadas. O sideboard
  automático nunca mete cartas que a IA não lança nem tira um 4-of.
- **Torneio ao vivo** — salta para o jogo seguinte da mesma partida (ou espera por ele), e o deck em que apostaste fica
  do teu lado da mesa.
- **Perfis** — uma instalação, vários jogadores, cada um com os seus decks.
- **Instalável** como PWA em telemóveis e tablets; pensado para ecrãs táteis. No telemóvel a mesa ao vivo tem zoom
  (− / + / ajustar), o ecrã não se apaga com o Grimório aberto (Definições › Ecrã) e o ecrã inteiro fica ao alto.

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
| `backup.py` | exportar/importar cópias `.grimorio` e a sincronização opcional por pasta na nuvem (regras da junção, ratings refeitos) |
| `sim.py`, `build/forge/` | executor do Forge (Docker ou Java local) e o lançador `GrimorioSim` (eventos exatos do jogo, ajustes à IA, dicas de IA por carta) |
| `tournament.py`, `ratings.py` | torneios e ratings / Arena |
| `guests.py`, `rooms.py`, `share.py` | amigos e online: links de convite e modo convidado, salas online (jogos e torneios), o túnel público num clique |
| `playnet.py`, `build/forge/GrimorioNet.java` | Forge Play: a ponte com o Forge para os teus jogos na mesa do Grimório (estado, pedidos e escolhas em JSON) |
| `rules.py`, `artfolder.py` | pesquisa nas Comprehensive Rules; artes próprias de uma pasta (Drive, GitHub) |
| `deck_import.py`, `ia.py`, `play.py` | importadores de sites, fornecedores de IA opcionais, jogar contra o Forge (noVNC, só com Docker) |
| `build/` | pipeline de dados (Scryfall, embeddings, UMAP, combos, fichas, meta) |
| `web/` | front end em React + Vite |
| `packaging/` | pacotes para computador Windows/Linux: lançador (janela da aplicação, atualizações automáticas, cópias da base de dados), pacote e construtor de dados |

## Próximos passos

- App para Android (APK) — vê [docs/ROADMAP.md](docs/ROADMAP.md) (em inglês).
- Duas edições: **Grimório Full** (com o Forge Play e o jogo online) e **Grimório Lite** (o resto, um download mais leve).
- Jogos online entre pessoas na mesa do Grimório, com torneios para ti e para os teus amigos (com ou contra bots).
- Crossplay entre o servidor, a aplicação para computador e os telemóveis, um interruptor «abrir à rede de casa» na
  aplicação para computador e «entrar no Grimório de um amigo».

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
