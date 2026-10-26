[English](INSTALL.md) · **Português** · [Español](INSTALL.es.md) · [Deutsch](INSTALL.de.md) · [简体中文](INSTALL.zh-CN.md)

# Instalar o Grimório

O Grimório corre no teu próprio computador. No Windows abre-se na sua própria janela de aplicação; no Linux é o teu
navegador que o mostra. Tudo o que é preciso, incluindo o Java e o motor Forge, vem no ficheiro que descarregas, e o
Grimório mantém-se atualizado sozinho.

## Do que precisas

- **Windows 10 ou 11** (64 bits), ou **Linux** (64 bits, x86-64: Ubuntu, Mint, Fedora, Debian, Arch…).
- Pelo menos **4 GB de RAM** (8 GB é mais confortável quando os bots jogam muitos jogos).
- Cerca de **600 MB** de espaço livre em disco.
- **Ligação à internet** da primeira vez (para descarregar os dados das cartas) e para as imagens das cartas e as importações.
- Só no Linux: **Python 3.10 ou mais recente**. Quase todas as distribuições Linux já o têm; confirma com `python3 --version`.

## Windows

1. Vai à [página de Releases](https://github.com/hubertdungen/grimorio/releases) e, em **Assets** da versão mais
   recente, descarrega **`Grimorio-<version>-windows-x64.zip`** (cerca de 110 MB).
2. Procura o ficheiro na pasta *Transferências*, **clica nele com o botão direito › Extrair Tudo…** e escolhe um sítio
   de que te lembres, por exemplo `Documentos\Grimorio`. Não o abras de dentro do zip: precisa de todos os seus
   ficheiros ao lado.
3. Abre a pasta **Grimorio** que foi extraída e faz duplo clique em **`Grimorio.exe`**.
4. Se o Windows mostrar *«O Windows protegeu o seu PC»*: clica em **Mais informações › Executar mesmo assim**. O
   Grimório é gratuito e não está assinado com um certificado pago, por isso o Windows ainda não o conhece (vê
   [Resolução de problemas](#resolução-de-problemas)).
5. O Grimório abre-se na sua própria janela. Da primeira vez, descarrega os dados das cartas antes de a janela
   aparecer, normalmente em menos de um minuto, por isso dá-lhe um momento (vê
   [O primeiro arranque](#o-primeiro-arranque)).

A janela usa o Microsoft Edge WebView2, que vem com o Windows 10 e 11. Se um computador não o tiver, o Grimório abre-se
no navegador e mostra uma pequena caixa *«Grimório is running in your browser»*: deixa-a ficar enquanto jogas e carrega
em **OK** quando quiseres fechar o Grimório. Para usares o navegador de propósito, arranca-o com
`Grimorio.exe --browser` (numa Linha de Comandos aberta na pasta).

## Linux

1. Vai à [página de Releases](https://github.com/hubertdungen/grimorio/releases) e, em **Assets** da versão mais
   recente, descarrega **`grimorio-<version>-linux-x64.tar.gz`** (cerca de 100 MB).
2. Extrai-o. Num terminal:

   ```bash
   cd ~/Downloads
   tar xzf grimorio-*-linux-x64.tar.gz
   ```

   (num sistema em português, a pasta pode chamar-se `~/Transferências`; ou clica no ficheiro com o botão direito no
   gestor de ficheiros › *Extrair aqui*). Ficas com uma pasta `grimorio`; podes mudá-la para onde quiseres, por exemplo
   para a tua pasta pessoal.
3. Arranca-o a partir de um terminal:

   ```bash
   cd grimorio
   ./grimorio
   ```

4. O navegador abre o Grimório sozinho. O terminal mantém-no a funcionar enquanto o usas. Se tiveres o pacote de
   Python `pywebview` instalado (`pip install pywebview`), o Grimório abre-se na sua própria janela em vez do navegador.

## O primeiro arranque

- O Grimório descarrega os **dados das cartas** uma única vez: cerca de **11 MB** (todas as cartas, combos, decks de
  torneio), normalmente em menos de um minuto. No Linux vês o progresso no terminal; no Windows a janela aparece
  quando acaba. Depois disso, arranca sem descarregar nada.
- O Grimório funciona em **http://127.0.0.1:8107** (se essa porta estiver ocupada, usa a seguinte que estiver livre: o
  terminal, no Linux, e o registo, no Windows, mostram o endereço).
- O Grimório pergunta **Quem vai jogar?** Escreve o teu nome para criares o teu perfil. Cada pessoa que usa este
  computador pode criar o seu próprio perfil, com os seus decks, testes, torneios e ratings, e escolhê-lo no arranque
  seguinte.
- Escolhe a língua em **Definições › Língua**: English, Português, Español, Deutsch ou 简体中文.

## Voltar a abrir

Abre outra vez o `Grimorio.exe` (Windows) ou o `./grimorio` (Linux). Se o Grimório já estiver a correr, simplesmente
volta a mostrá-lo. No Windows, um atalho no ambiente de trabalho facilita: clica com o botão direito no `Grimorio.exe` ›
*Enviar para › Ambiente de trabalho (criar atalho)* (no Windows 11 está em *Mostrar mais opções*).

Dicas:

- Linux: guarda **http://127.0.0.1:8107** nos marcadores do navegador. No Chrome ou no Edge também o podes instalar
  como aplicação (o ícone *Instalar* na barra de endereço), para ter a sua própria janela e um ícone; o Grimório em si
  continua a ter de estar a correr.
- Para o usares num telemóvel ou tablet na mesma rede Wi-Fi, arranca-o com `Grimorio.exe --host 0.0.0.0` (Windows, numa
  Linha de Comandos aberta na pasta) ou `./grimorio --host 0.0.0.0` (Linux) e abre `http://<IP do teu computador>:8107`
  no telemóvel. Assim, qualquer pessoa na tua rede o consegue abrir, por isso faz isto só em casa.

## Parar

**Fecha a janela do Grimório** (Windows; se abriu no navegador, carrega em **OK** na pequena caixa) ou carrega em
**Ctrl+C** no terminal (Linux; fechar o terminal também o para). Os jogos do Forge que estiverem a decorrer também
param. Os teus decks são guardados à medida que trabalhas: não se perde nada.

## Onde ficam os teus dados

| Sistema | Pasta |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (cola isto na barra de endereço do Explorador de Ficheiros) |
| Linux | `~/.local/share/grimorio` |

Os teus decks, perfis, testes, torneios e ratings estão em **`grimorio.db`**, nessa pasta, e as capas que escolheste
para os decks estão em `covers`. Esta pasta é separada da pasta do programa, por isso cada nova versão encontra os
teus dados tal como os deixaste. Para fazeres uma cópia de segurança, copia esses dois (com o Grimório parado).

**Cópias e nuvem:** em **Definições › Dados e cópias** exportas tudo para um ficheiro `.grimorio` ou ligas uma pasta
do Google Drive, OneDrive, Dropbox ou Syncthing para manter dois computadores iguais (funciona sem rede e sincroniza
depois). Opções grátis e guias em 3 passos: [Cópias e sincronização na nuvem](../README.pt.md#cópias-e-sincronização-na-nuvem).

## Atualizações

O Grimório atualiza-se sozinho. Sempre que arranca, vê qual é a release mais recente no GitHub. Quando há uma versão
mais nova, descarrega-a em segundo plano para a pasta `versions`, dentro da pasta de dados, confirma a soma sha256 e
arranca com ela da próxima vez que abrires o Grimório. O teu atalho e o `Grimorio.exe` (ou `./grimorio`) que
extraíste continuam a funcionar: passam a vez à versão mais recente que tiveres. No primeiro arranque, a nova versão
descarrega também os dados das cartas atualizados (cerca de 11 MB).

Em **Definições › Atualizações** vês a versão instalada e a mais recente. Para parares as atualizações automáticas,
desliga lá **Atualizar sozinho**.

Para atualizares à mão: descarrega a nova versão em [Releases](https://github.com/hubertdungen/grimorio/releases), como
acima, fecha o Grimório, apaga a pasta antiga do programa e extrai a nova no lugar dela.

### Passar para uma nova versão

Os teus dados ficam na pasta de dados (vê [Onde ficam os teus dados](#onde-ficam-os-teus-dados)), por isso todas as
versões usam os mesmos decks, jogos, torneios e ratings. Uma nova versão só acrescenta coisas à base de dados (tabelas
ou colunas novas) e mantém tudo o que já lá está. Antes de uma nova versão abrir a base de dados pela primeira vez,
guarda uma cópia na pasta `backups`, dentro da pasta de dados; ficam as 3 cópias mais recentes.

## Resolução de problemas

**«O Windows protegeu o seu PC» ou o antivírus bloqueia o `Grimorio.exe`.**
O Grimório é de código aberto e não está assinado com um certificado pago, por isso o SmartScreen e alguns antivírus
avisam, sobretudo logo a seguir à publicação de uma nova versão. Clica em **Mais informações › Executar mesmo assim**.
Se o antivírus mandou algum ficheiro para a quarentena (muitas vezes o `jre\bin\java.exe`), restaura-o e acrescenta a
pasta Grimorio como exceção, ou volta a extrair o zip. O código-fonte é público e os pacotes são construídos a partir
dele pelo GitHub.

**O Grimório diz que as portas estão ocupadas / abre noutro endereço.**
O Grimório usa a porta 8107, ou a seguinte que estiver livre até à 8126, e escreve o endereço que escolheu no terminal
(Linux) ou no registo (Windows, vê abaixo). Para
escolheres tu uma porta: `Grimorio.exe --port 9000` (Linha de Comandos do Windows) ou `./grimorio --port 9000` (Linux).

**Os testes no Coliseu falham com um erro sobre Java ou Forge.**
As pastas `jre` e `forge` têm de estar ao lado do programa. Volta a extrair o zip/tar.gz inteiro (não copies só o
`.exe`) e confirma que o antivírus não pôs o `java.exe` em quarentena.

**O computador fica lento, ou os jogos do Forge falham a meio.**
Cada jogo do Forge usa cerca de 1 GB de RAM. Vai às **Definições**, põe **Jogos do Forge ao mesmo tempo** em **1** e
fecha outros programas pesados. Com 4 GB de RAM, usa 1.

**«Jogar contra o Forge» com um deck de Commander não está disponível.**
Jogar tu contra o Forge na mesa do Grimório funciona nos pacotes para computador. O Commander usa a janela clássica do
Forge, que precisa da instalação de servidor com Docker (vê o [README](../README.pt.md#no-teu-servidor-linux-docker)).

**O download dos dados das cartas falhou.**
Confirma a ligação à internet (e algum proxy ou firewall) e volta a arrancar o Grimório: ele tenta outra vez. Também
podes descarregar à mão o `grimorio-data.zip` da mesma release e indicar ao Grimório onde está: no Windows,
`set GRIMORIO_DATA_URL=C:\path\to\grimorio-data.zip` e depois `Grimorio.exe` na mesma Linha de Comandos; no Linux,
`GRIMORIO_DATA_URL=~/Downloads/grimorio-data.zip ./grimorio`.

**Linux: «Grimório needs Python 3.10 or newer».**
Instala o Python: `sudo apt install python3` (Ubuntu, Debian, Mint), `sudo dnf install python3` (Fedora),
`sudo pacman -S python` (Arch).

**Linux: «Permission denied» ao arrancar o `./grimorio`.**
Corre `chmod +x grimorio` na pasta (algumas ferramentas perdem a permissão ao extrair) e tenta outra vez.

**O navegador não abriu.**
Abre tu mesmo o endereço que aparece no terminal ou na pequena caixa do Grimório (por exemplo http://127.0.0.1:8107).

**Windows: o Grimório não abre, ou alguma coisa corre mal.**
A aplicação do Windows escreve tudo o que tem a dizer em **`%LOCALAPPDATA%\Grimorio\logs\grimorio.log`** (cola a
parte da pasta na barra de endereço do Explorador de Ficheiros); a execução anterior fica guardada como
`grimorio.log.1`. Lá vês a versão e o endereço que o Grimório está a usar. Junta este ficheiro quando pedires ajuda ou
comunicares um problema.

## Desinstalar

1. Para o Grimório.
2. Apaga a pasta do programa (a que extraíste).
3. Para apagares também os teus decks e perfis, apaga a pasta de dados (vê [Onde ficam os teus dados](#onde-ficam-os-teus-dados)).
   Isto não se pode desfazer: faz primeiro uma cópia de segurança do `grimorio.db` se os puderes querer mais tarde.
