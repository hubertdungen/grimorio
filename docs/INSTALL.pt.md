[English](INSTALL.md) · **Português** · [Español](INSTALL.es.md) · [Deutsch](INSTALL.de.md) · [简体中文](INSTALL.zh-CN.md)

# Instalar o Grimório

O Grimório corre no teu próprio computador: um pequeno programa põe-no a funcionar e o teu navegador mostra-o. Não
precisas de instalar Docker, Java nem mais nada, e não precisas de um servidor. Tudo o que é preciso vem no download.

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
5. Abre-se uma janela preta. Da primeira vez, descarrega os dados das cartas (vê
   [O primeiro arranque](#o-primeiro-arranque)) e depois o navegador abre o Grimório sozinho.

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

4. O navegador abre o Grimório sozinho. Mantém o terminal aberto enquanto o usas.

## O primeiro arranque

- O Grimório descarrega os **dados das cartas** uma única vez: cerca de **11 MB** (todas as cartas, combos, decks de
  torneio), normalmente em menos de um minuto. Vês o progresso na janela. Depois disso, arranca sem descarregar nada.
- O navegador abre em **http://127.0.0.1:8107** (se essa porta estiver ocupada, usa a seguinte que estiver livre: a
  janela mostra o endereço).
- O Grimório pergunta **Quem vai jogar?** Escreve o teu nome para criares o teu perfil. Cada pessoa que usa este
  computador pode criar o seu próprio perfil, com os seus decks, testes, torneios e ratings, e escolhê-lo no arranque
  seguinte.
- Escolhe a língua em **Definições › Língua**: English, Português, Español, Deutsch ou 简体中文.

## Voltar a abrir

Abre outra vez o `Grimorio.exe` (Windows) ou o `./grimorio` (Linux). Se o Grimório já estiver a correr, simplesmente
volta a abri-lo no navegador.

Dicas:

- Guarda **http://127.0.0.1:8107** nos marcadores do navegador.
- No Chrome ou no Edge podes instalá-lo como app (o ícone *Instalar* na barra de endereço): fica com a sua própria
  janela e um ícone. O Grimório em si continua a ter de estar a correr (passo acima).
- Para o usares num telemóvel ou tablet na mesma rede Wi-Fi, arranca-o com `Grimorio.exe --host 0.0.0.0` (Windows, numa
  Linha de Comandos aberta na pasta) ou `./grimorio --host 0.0.0.0` (Linux) e abre `http://<IP do teu computador>:8107`
  no telemóvel. Assim, qualquer pessoa na tua rede o consegue abrir, por isso faz isto só em casa.

## Parar

**Fecha a janela preta** (Windows) ou carrega em **Ctrl+C** no terminal (Linux; fechar o terminal também o para). Os
jogos que estiverem a decorrer também param. Os teus decks são guardados à medida que trabalhas: não se perde nada.

## Onde ficam os teus dados

| Sistema | Pasta |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (cola isto na barra de endereço do Explorador de Ficheiros) |
| Linux | `~/.local/share/grimorio` |

Os teus decks, perfis, testes, torneios e ratings estão em **`grimorio.db`**, nessa pasta, e as capas que escolheste
para os decks estão em `covers`. Para fazeres uma cópia de segurança, copia esses dois (com o Grimório parado).

**Cópias e nuvem:** em **Definições › Dados e cópias** exportas tudo para um ficheiro `.grimorio` ou ligas uma pasta
do Google Drive, OneDrive, Dropbox ou Syncthing para manter dois computadores iguais (funciona sem rede e sincroniza
depois). Opções grátis e guias em 3 passos: [Cópias e sincronização na nuvem](../README.pt.md#cópias-e-sincronização-na-nuvem).

## Atualizar

1. Descarrega a nova versão em [Releases](https://github.com/hubertdungen/grimorio/releases), como acima.
2. Para o Grimório, apaga a pasta antiga do programa e extrai a nova no lugar dela.
3. Arranca-o. Os teus dados mantêm-se (estão na pasta de dados, não na pasta do programa); no primeiro arranque, a nova
   versão descarrega os dados das cartas atualizados (cerca de 11 MB).

## Resolução de problemas

**«O Windows protegeu o seu PC» ou o antivírus bloqueia o `Grimorio.exe`.**
O Grimório é de código aberto e não está assinado com um certificado pago, por isso o SmartScreen e alguns antivírus
avisam, sobretudo logo a seguir à publicação de uma nova versão. Clica em **Mais informações › Executar mesmo assim**.
Se o antivírus mandou algum ficheiro para a quarentena (muitas vezes o `jre\bin\java.exe`), restaura-o e acrescenta a
pasta Grimorio como exceção, ou volta a extrair o zip. O código-fonte é público e os pacotes são construídos a partir
dele pelo GitHub.

**A janela diz que as portas estão ocupadas / o Grimório abre noutro endereço.**
O Grimório usa a porta 8107, ou a seguinte que estiver livre até à 8126, e mostra o endereço que escolheu. Para
escolheres tu uma porta: `Grimorio.exe --port 9000` (Linha de Comandos do Windows) ou `./grimorio --port 9000` (Linux).

**Os testes no Coliseu falham com um erro sobre Java ou Forge.**
As pastas `jre` e `forge` têm de estar ao lado do programa. Volta a extrair o zip/tar.gz inteiro (não copies só o
`.exe`) e confirma que o antivírus não pôs o `java.exe` em quarentena.

**O computador fica lento, ou os jogos do Forge falham a meio.**
Cada jogo do Forge usa cerca de 1 GB de RAM. Vai às **Definições**, põe **Jogos do Forge ao mesmo tempo** em **1** e
fecha outros programas pesados. Com 4 GB de RAM, usa 1.

**«Jogar» (sentares-te tu à mesa contra o Forge) não está disponível.**
Esse modo precisa da instalação de servidor com Docker (vê o
[README](../README.pt.md#configuração-para-programadores)). Tudo o resto no Coliseu — testes, torneios, a Arena
automática — funciona nos pacotes para computador.

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
Abre tu mesmo o endereço que aparece na janela (por exemplo http://127.0.0.1:8107).

## Desinstalar

1. Para o Grimório.
2. Apaga a pasta do programa (a que extraíste).
3. Para apagares também os teus decks e perfis, apaga a pasta de dados (vê [Onde ficam os teus dados](#onde-ficam-os-teus-dados)).
   Isto não se pode desfazer: faz primeiro uma cópia de segurança do `grimorio.db` se os puderes querer mais tarde.
