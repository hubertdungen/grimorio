[English](README.md) · [Português](README.pt.md) · **Español** · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Construye, prueba y pon a combatir tus mazos de Magic: The Gathering, con sugerencias explicadas, partidas reales de IA contra IA y partidas que juegas tú contra Forge.**

Grimório es un constructor de mazos gratuito para todos los formatos (Commander, Modern, Pauper, Standard, Legacy, …)
que funciona en tu propio ordenador. Cruza el texto de las cartas, mazos reales de torneo, datos de EDHREC y combos de
Commander Spellbook para sugerirte cartas *y explicarte por qué*, y enfrenta tu mazo a otros mazos con el motor de
reglas de código abierto [Forge](https://github.com/Card-Forge/forge), para que puedas ver las partidas, leer un
informe y mejorar la lista.

También puedes sentarte tú a la mesa: juega contra Forge en la mesa propia de Grimório, organiza torneos, ligas y
campeonatos con clasificación, y abre salas en línea para tus amigos.

La interfaz está disponible en **English** (predeterminado), **Português**, **Español**, **Deutsch** y **简体中文**
(Ajustes › Idioma).

## Capturas de pantalla

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Inicio"></a><br><sub>Inicio</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Construir: búsqueda con palabras en cualquier idioma, lista y sugerencias"></a><br><sub>Construir: búsqueda con palabras en cualquier idioma, lista y sugerencias</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Sugerencias por función, combos y mazos reales"></a><br><sub>Sugerencias por función, combos y mazos reales</sub></td><td width="50%"><a href="docs/img/analysis.jpg"><img src="docs/img/analysis.jpg" alt="Análisis: curva, colores, probabilidades de la mano inicial y cómo gana el mazo"></a><br><sub>Análisis: curva, colores, probabilidades de la mano inicial y cómo gana el mazo</sub></td></tr>
<tr><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universo: el mapa 3D de todas las cartas"></a><br><sub>Universo: el mapa 3D de todas las cartas</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Biblioteca con portadas, estrellas, trofeos y comparación"></a><br><sub>Biblioteca con portadas, estrellas, trofeos y comparación</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseo: mira a Forge jugar tu mazo, con la pila en directo"></a><br><sub>Coliseo: mira a Forge jugar tu mazo, con la pila en directo</sub></td><td width="50%"><a href="docs/img/forgeplay.jpg"><img src="docs/img/forgeplay.jpg" alt="Juega tú contra Forge en la mesa de Grimório"></a><br><sub>Juega tú contra Forge en la mesa de Grimório</sub></td></tr>
<tr><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Torneos: podio en directo, clasificación y etiquetas de origen de los mazos"></a><br><sub>Torneos: podio en directo, clasificación y etiquetas de origen de los mazos</sub></td><td width="50%"><a href="docs/img/online.jpg"><img src="docs/img/online.jpg" alt="Salas en línea: partidas sueltas o torneos con un enlace público"></a><br><sub>Salas en línea: partidas sueltas o torneos con un enlace público</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: estrellas por mazo y la Arena automática"></a><br><sub>Ratings: estrellas por mazo y la Arena automática</sub></td><td width="50%"><a href="docs/img/table.jpg"><img src="docs/img/table.jpg" alt="En la mesa: contador de vidas, dados en 3D y escáner de cartas"></a><br><sub>En la mesa: contador de vidas, dados en 3D y escáner de cartas</sub></td></tr>
<tr><td width="50%"><a href="docs/img/draft.jpg"><img src="docs/img/draft.jpg" alt="Draft y Sellado: sobres reales, bots de Forge y un torneo al final"></a><br><sub>Draft y Sellado: sobres reales, bots de Forge y un torneo al final</sub></td><td width="50%"><a href="docs/img/sideboard.jpg"><img src="docs/img/sideboard.jpg" alt="Banquillo: respuestas a lo que te gana en las pruebas"></a><br><sub>Banquillo: respuestas a lo que te gana en las pruebas</sub></td></tr>
</table>

## Instalación

**Windows y Linux:** descarga el paquete desde [Releases](https://github.com/hubertdungen/grimorio/releases),
descomprímelo y abre `Grimorio.exe` (Windows) o `./grimorio` (Linux). En Windows, Grimório se abre en su propia ventana
de aplicación; en Linux, en tu navegador. Guía paso a paso para todo el mundo:
**[docs/INSTALL.es.md](docs/INSTALL.es.md)**.

**Actualizaciones:** los paquetes se actualizan solos. Una versión nueva se descarga en segundo plano (comprobada con su
sha256) y arranca la próxima vez que abras Grimório; puedes desactivarlo en Ajustes › Actualizaciones. Tus mazos,
partidas, torneos y ratings viven fuera de la carpeta de la app y pasan a cada versión nueva, y antes de que una versión
nueva abra la base de datos se guarda una copia en `backups/`.

En el primer arranque, Grimório pregunta *¿Quién va a jugar?*: cada persona crea un perfil con su nombre, y sus mazos,
pruebas, torneos y ratings se guardan por separado. Varias personas pueden compartir la misma instalación.

Si quieres instalarlo en un servidor doméstico para varios dispositivos, o desarrollarlo, consulta
[Configuración para desarrolladores](#configuración-para-desarrolladores).

## En tu propio servidor Linux (Docker)

Instala Grimório en un servidor en casa (un mini PC, un portátil viejo, un NAS con Linux) y ábrelo desde todos los
móviles, tablets y ordenadores de la casa. El Coliseo ejecuta Forge en **Docker** y *Jugar contra Forge* funciona en el
navegador. Hecho en Ubuntu 24.04 (otros Debian/Ubuntu recientes deberían
servir); necesita ~4 GB de RAM libre para las partidas y ~3 GB de disco.

```bash
# 1. Git, Python, Node.js 22 and Docker
sudo apt update && sudo apt install -y git python3 bzip2 curl unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # después cierra la sesión y vuelve a entrar

# 2. Grimório
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio
D=~/.local/share/grimorio && mkdir -p $D/forge

# 3. Forge 2.0.15 (el motor de reglas)
curl -L https://github.com/Card-Forge/forge/releases/download/forge-2.0.15/forge-installer-2.0.15.tar.bz2 | tar -xj -C $D/forge

# 4. Datos de las cartas, ya hechos, de la última versión (o constrúyelos con build/build.sh, ~45 min)
curl -L -o /tmp/grimorio-data.zip https://github.com/hubertdungen/grimorio/releases/latest/download/grimorio-data.zip
unzip -o /tmp/grimorio-data.zip -d $D

# 5. Compila la app web e instálala en ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 6. Arráncalo y abre http://IP-DEL-SERVIDOR:8107 en cualquier dispositivo de la casa
python3 $D/app/server.py --host 0.0.0.0 --port 8107
```

**Arrancar con el servidor** (servicio systemd de usuario):

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
sudo loginctl enable-linger $USER   # sigue funcionando después de cerrar la sesión
```

- **Quién juega:** por defecto cada persona elige o crea un perfil («¿Quién juega?»). Para un solo usuario, añade
  `--owner tunombre`.
- **Fuera de casa:** nunca abras el puerto 8107 a internet tal cual. Ponlo detrás de un login (un proxy como Caddy +
  Authelia, Cloudflare Tunnel con Access, o Tailscale); el usuario llega en la cabecera `Remote-User` y cada persona tiene
  sus mazos.
- **Actualizar:** `cd grimorio && git pull && ./deploy.sh` y luego `systemctl --user restart grimorio`.
- **Copias:** mira la sección siguiente.

## Copias y sincronización en la nube

Todo lo que creas vive en tu propia instalación (`grimorio.db` en la carpeta de datos). Hay dos formas opcionales de
guardarlo, ambas gratis y ambas en **Ajustes › Datos y copias**:

- **Exportar todo** descarga un archivo `.grimorio` (mazos, perfiles, pruebas, torneos, apuestas, ratings y las
  portadas de tus mazos). **Importar** lo restaura: por defecto *fusiona* (no se pierde nada, gana la versión más reciente
  de cada mazo) o *sustituye* todo; antes guarda siempre tus datos actuales al lado (`grimorio.db.before-import-…`).
- **Sincronizar con una carpeta en la nube** mantiene varios ordenadores al día con cualquier app gratuita que sincronice
  una carpeta. Grimório trabaja siempre sobre su copia local, así que funciona sin conexión (en un avión, p. ej.): la app
  sube y baja los cambios cuando vuelve la conexión. Cada ordenador escribe solo su archivo en esa carpeta y fusiona los
  de los demás.

| App gratuita | Espacio gratis | Cuenta | Windows / macOS / Linux / Android |
|---|---|---|---|
| Google Drive para ordenador | 15 GB (compartidos con Gmail) | Google | ✓ / ✓ / — (usa Syncthing o Nextcloud) / app |
| OneDrive | 5 GB | Microsoft | ✓ (incluido) / ✓ / cliente no oficial / app |
| Dropbox | 2 GB | Dropbox | ✓ / ✓ / ✓ / app |
| Syncthing | ilimitado (sin nube: tus dispositivos se sincronizan directamente) | ninguna | ✓ / ✓ / ✓ / Syncthing-Fork |
| Nextcloud | según el proveedor, o tu propio servidor | Nextcloud | ✓ / ✓ / ✓ / app |
| iCloud Drive | 5 GB | Apple | iCloud para Windows / ✓ / — / — |

**Google Drive en 3 pasos.** 1) Instala *Google Drive para ordenador* e inicia sesión (en Windows aparece la unidad `G:`
con *Mi unidad*). 2) En Grimório: Ajustes › Datos y copias › marca *Sincronizar con una carpeta en la nube*, elige la
sugerencia *Google Drive* (`G:\Mi unidad\Grimorio`) y pulsa *Usar esta carpeta*. 3) En el otro ordenador, la misma
cuenta de Google y la misma carpeta. Listo.

**Syncthing en 3 pasos** (sin cuenta, nada en la nube de nadie). 1) Instala Syncthing en los dos dispositivos
([syncthing.net](https://syncthing.net); en Android: *Syncthing-Fork*). 2) Añade cada dispositivo al otro y comparte una
carpeta, p. ej. `~/Sync/Grimorio`. 3) Elige esa carpeta en Grimório en los dos. Se sincronizan cuando ambos están
encendidos.

Si el mismo mazo cambió en dos ordenadores entre sincronizaciones, gana el más reciente y el otro se guarda como
*«nombre (conflito)»*: nunca se pierde una versión. Un torneo que sigue en curso llega en pausa al otro ordenador (solo
uno lo juega a la vez). En un servidor con inicio de sesión, cada persona exporta e importa solo sus datos; la carpeta
en la nube es para ordenadores y servidores de un solo dueño.

## Funciones

- **Construcción de mazos para todos los formatos**: legalidad, objetivos propios de cada formato, consejos de base
  de maná, curva, presupuesto, brackets.
- **Sugerencias inteligentes y explicadas**: embeddings de texto + EDHREC + mazos reales + combos + tus propios gustos;
  en directo mientras construyes.
- **Empieza a tu manera**: elige de 3 a 10 cartas (o un comandante) y deja que complete el mazo, constrúyelo a mano,
  impórtalo o describe una idea.
- **Importa** desde TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 y Scryfall: perfiles enteros (como
  tus mazos, de la comunidad o de un amigo), ilustraciones y portadas personalizadas, sideboard y maybeboard. Busca
  mazos públicos de Archidekt con filtros.
- **Búsqueda con palabras, en cualquier idioma**: «criaturas humanas legendarias con contadores +1/+1», «tierras que
  roban cartas», «terrenos que compram cartas», «抽牌的地» o la sintaxis de Scryfall (`t:`, `o:`, `mv<=`); las tildes son
  opcionales; más de 35 funciones de las cartas (eliminación, robo, mill, daño directo, blink, stax…) para filtrar.
- **Panel de análisis**: cifras principales, curva de maná por criaturas y el resto, gráficos de colores (lo que piden
  los costes frente a lo que dan las tierras), probabilidades de la mano inicial, cómo gana y cómo pierde el mazo, si el
  banquillo cubre lo que le ganó, las cartas que ganan o se quedan en la mano en las partidas, y una ⓘ en cada número.
- **Universo 3D de cartas**: regiones por función que muestran lo que le falta a tu mazo, el rendimiento de cada carta
  en partidas reales con cambios sugeridos, constelaciones de los arquetipos del meta y un lazo para encontrar las mejores
  cartas de cualquier zona.
- **Combos y paquetes de sinergia**, comparación de mazos (con el porqué de que un mazo parecido tenga mejor rating:
  interacción, curva, tierras, staples, objetivo) y detección de duplicados.
- **Mesa de Forge Play estable y viva** — tamaño fijo escalado a la pantalla (apaisada en PC y tablet, vertical en el
  móvil): las zonas no saltan con cartas nuevas ni con la barra del navegador y las filas llenas solapan las cartas. Las
  cartas se deslizan entre jugadas, soltar un aura, remoción o equipo sobre una criatura la elige como objetivo, adivinar
  y vigilar en dos montones, buscar en la biblioteca en una cuadrícula con filtro y el veneno subiendo en el ☠.
- **Asistente de IA (opcional)**: claves de varios proveedores, modelos más recientes detectados solos; cambia tu mazo
  directamente (cambios, cantidades, sustitutos para cualquier carta) con un clic.
- **Coliseo (IA de Forge)**: IA contra IA con reglas reales (Bo1/Bo3, sideboard inteligente, aprendizaje), todos
  contra todos de 3–4 jugadores y mesas de Commander, un tablero animado con la pila en directo, informes y mejoras
  sugeridas.
- **Juega tú contra Forge**: la mesa propia de Grimório. Un clic levanta la carta y arrastrarla a la mesa la juega (o
  doble clic; solo se ilumina lo que puedes pagar), al pasar por encima de la mano las demás cartas hacen sitio, T gira
  (tap) la carta bajo el ratón y F le da la vuelta; series Bo3/Bo5 con banquillo entre partidas y torneos en los que
  juegas tú las partidas de tu mazo; arrastra criaturas para atacar y bloquear, ordena tu lado como quieras; la pila,
  las elecciones, el adivinar y las búsquedas en la biblioteca aparecen en la misma página; Enter para pasar y
  Shift+Enter para terminar el turno. Funciona en un servidor y en los paquetes de escritorio (sin Docker); Commander
  usa la ventana clásica de Forge (servidor con Docker).
- **Torneos, ligas y campeonatos**: eliminación directa y doble eliminación, suizo, liga, mesas, gauntlet, rey de la
  colina, grupos + eliminatorias y equipos; casual con o sin formatos mezclados; un generador de torneos, cuadro en
  directo, podio e historial, ligas de campeones y de podios, trofeos de oro/plata/bronce y platino en los mazos que
  ganan, con ranking o casual; apuestas con monedas de juego (no se compra nada, sin dinero real).
- **Ratings y ranking**: de 0 a 6 estrellas por mazo (Elo por formato, más un rating casual aparte), estrellas blancas
  y número de trofeos, filtros míos / amigos / comunidad / meta, salón de la fama y galería de trofeos, alimentados por
  las pruebas, los torneos y una Arena automática opcional.
- **En línea y amigos**: una pestaña En línea para partidas sueltas o torneos con un enlace público (un túnel gratuito
  de Cloudflare en un clic, o tu propio dominio): quien lo abre entra con un mazo suyo, sin cuenta. Invitaciones de
  amigos, los mazos de los amigos como fuente en torneos y en la Arena, y etiquetas con el origen de cada mazo (meta,
  míos, de un amigo, de la comunidad).
- **📖 Biblioteca de reglas**: palabras clave, reglas o nombres de cartas en cualquier idioma (también con la cámara):
  Comprehensive Rules, rulings oficiales y una explicación opcional de la IA. En cualquier pantalla, una mecánica en
  negrita muestra la regla al pasar el ratón y abre las Reglas en una ventana; los símbolos de maná aparecen como
  símbolos, no como {T}.
- **Proxies**: lista con las ediciones para webs de proxies, ZIP con las imágenes o un PDF listo como piden las
  imprentas: papel, márgenes, tamaño de carta, espacio entre cartas, sangrado (negro, un color o el borde de la carta
  extendido), guías de corte por carta, marca de agua y doble cara. También entran las fichas que crea el mazo (detectadas, con cuántas de cada una) y las sugerencias de Grimório para probar.
- **En la mesa**: contador de vidas (hasta 6 jugadores), dados en 3D y un escáner de cartas (cámara) con un marco de
  mira (en el móvil y la tableta la cámara se abre a pantalla completa).
- **Bots predeterminados**: el perfil de la IA de Forge para tu mazo y para los rivales en el Laboratorio, los torneos
  y la Arena; una barra muestra lo que está en curso y lleva al visor en directo.
- **Draft y Sellado**: abre sobres reales de cualquiera de 160 ediciones (los sobres del propio Forge): haz el draft
  en una mesa de 8 con bots de Forge, mira a 8 bots hacerlo, o abre 6 sobres para sellado. Los bots montan sus mazos de
  40, tu pool se convierte en un mazo Limitado en Construir y sigue un torneo suizo; Forge juega tus partidas o las
  juegas tú en Forge Play.
- **Contra lo que pierdes**: las sugerencias de banquillo leen tus pruebas: los tipos de cartas que te ganan
  (criaturas, cementerio, artefactos…) y respuestas en tus colores que la IA sabe lanzar, primero las que llevan los
  banquillos del meta. Las cartas que la IA de Forge nunca lanza quedan señaladas.
- **Ratings del mazo en el Análisis**: estrellas normal, todas las partidas, objetivo y casual, con Elo y partidas, las
  estrellas de los trofeos y cada trofeo ganado (abre el torneo).
- **IA de Forge más lista**: Grimório corrige Forge donde jugaba mal mazos reales: tierras según el color que pide la
  mano (fetchlands incluidas), Urza's Saga, el combo Heliod + Spike Feeder, Food en el momento justo, victoria con
  Maze's End, mazos de storm (Wish, Manamorphose), Wrath of the Skies, objetivos de Path to Exile y auras apiladas. El
  banquillo automático nunca mete cartas que la IA no lanza ni saca un 4-of.
- **Torneo en directo**: salta a la siguiente partida del mismo enfrentamiento (o espérala), el mazo por el que
  apostaste queda de tu lado de la mesa y los demás torneos en curso aparecen junto a las apuestas, a un clic.
- **Perfiles**: una instalación, varios jugadores, cada uno con sus propios mazos.
- **Instalable** como PWA en móviles y tabletas; pensado para pantallas táctiles. En el móvil la mesa en directo
  tiene zoom (− / + / ajustar), la pantalla no se apaga con Grimório abierto (Ajustes › Pantalla) y la pantalla completa
  queda en vertical. Si una red bloquea scryfall.io (trabajo, escuela), las imágenes de las cartas pasan por tu servidor (automático, o Ajustes › Imágenes de las cartas); también las imágenes propias de los mazos importados (TappedOut, Archidekt).

### Cómo aprende Grimório

Las sugerencias mejoran cuanto más dejas que los bots jueguen tus mazos en el Coliseo (pruebas, torneos y la Arena
automática). Cada partida registra qué cartas se robaron, se lanzaron o se quedaron atascadas en la mano, cuánto
aportó cada carta a la condición de victoria real del mazo (daño, mill, veneno, combo, control…), qué venció al mazo y
en qué puesto queda el mazo (estrellas). Con todo eso, Grimório:

- sugiere cartas que responden a lo que te gana;
- propone cambios inteligentes, *«cambia X por Y»* con el motivo, según la aportación a la victoria, el uso, la
  eficiencia de maná, el papel en combos o sinergias y el precio;
- ajusta el plan de sideboard entre partidas;
- actualiza el rating de cada mazo.

> **Consejo:** juega unas cuantas series Bo3 contra mazos del meta (o deja la Arena encendida toda la noche) antes de
> fiarte de las sugerencias; 10 partidas o más por mazo es un buen comienzo.

## Configuración para desarrolladores

Linux (probado en Ubuntu 24.04), **Python 3.10+**, **Node.js 20+**, ~4 GB de RAM libre para las partidas, ~2 GB de
disco. Forge se ejecuta en **Docker** cuando está instalado (lo predeterminado en un servidor Linux) o en un **Java 17**
local (`GRIMORIO_RUNTIME=local`, `GRIMORIO_JAVA=/path/to/java`). La generación de los datos se ejecuta en Docker.

```bash
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio

# 1. Forge 2.0.15 (motor de reglas): descarga "forge-installer-2.0.15.tar.bz2" desde
#    https://github.com/Card-Forge/forge/releases/tag/forge-2.0.15 y extráelo en ~/.local/share/grimorio/forge
mkdir -p ~/.local/share/grimorio/forge && tar -xjf forge-installer-2.0.15.tar.bz2 -C ~/.local/share/grimorio/forge

# 2. Datos de las cartas (Scryfall + Commander Spellbook, embeddings, mapa 3D). La primera vez tarda ~45 min.
build/build.sh
python3 build/meta_mtgtop8.py --max-decks 400      # opcional: mazos de torneo recientes para el meta

# 3. Compila la app web y el lanzador de Forge, e instala en ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 4. Arráncalo y abre http://localhost:8107
python3 ~/.local/share/grimorio/app/server.py --port 8107
```

Opciones: `--host`, `--port`, `--data-dir` (o `GRIMORIO_DATA_DIR`), `--owner` (o `GRIMORIO_OWNER`: un único usuario
fijo). Sin `--owner`, el servidor funciona en modo perfiles; detrás de un proxy con inicio de sesión, el usuario se toma
de la cabecera `Remote-User`.

Entorno de ejecución de Forge: `GRIMORIO_RUNTIME=docker|local` (predeterminado: docker cuando existe el comando
`docker`, salvo en Windows), `GRIMORIO_JAVA` (ejecutable de java), `GRIMORIO_FORGE_DIR` (predeterminado
`<data>/forge`). El entorno local espera que los perfiles de IA y los scripts de cartas de Grimório
(`forge-ext/ai`, `forge-ext/cardsfolder`) estén copiados en la carpeta de Forge; los paquetes ya lo hacen. Paquetes de
escritorio: `packaging/build.py` y `.github/workflows/release.yml`.

## Estructura del proyecto

| Ruta | Qué es |
|---|---|
| `server.py` | servidor HTTP con la stdlib: API, mazos (SQLite), perfiles, importaciones, proxies |
| `backup.py` | exportar/importar copias `.grimorio` y la sincronización opcional por carpeta en la nube (reglas de fusión, ratings recalculados) |
| `sim.py`, `build/forge/` | ejecutor de Forge (Docker o Java local) y el lanzador `GrimorioSim` (eventos exactos de la partida, ajustes de la IA, pistas de IA por carta) |
| `tournament.py`, `ratings.py` | torneos y ratings / Arena |
| `guests.py`, `rooms.py`, `share.py` | amigos y juego en línea: enlaces de invitación y modo invitado, salas en línea (partidas y torneos), el túnel público en un clic |
| `playnet.py`, `build/forge/GrimorioNet.java` | Forge Play: el puente con Forge para tus propias partidas en la mesa de Grimório (estado, preguntas y elecciones en JSON) |
| `rules.py`, `artfolder.py` | búsqueda en las Comprehensive Rules; artes propias desde una carpeta (Drive, GitHub) |
| `deck_import.py`, `ia.py`, `play.py` | importadores de webs, proveedores de IA opcionales, jugar contra Forge (noVNC, solo con Docker) |
| `build/` | pipeline de datos (Scryfall, embeddings, UMAP, combos, fichas, meta) |
| `web/` | front end en React + Vite |
| `packaging/` | paquetes de escritorio para Windows/Linux: lanzador (ventana de la app, actualizaciones automáticas, copias de la base de datos), paquete y generador de datos |

## Hoja de ruta

- App para Android (APK): consulta [docs/ROADMAP.md](docs/ROADMAP.md) (en inglés).
- Dos ediciones: **Grimório Full** (con Forge Play y juego en línea) y **Grimório Lite** (todo lo demás, una descarga más ligera).
- Partidas en línea entre personas en la mesa de Grimório, con torneos para ti y tus amigos (con bots o contra ellos).
- Crossplay entre el servidor, la app de escritorio y los móviles, un interruptor «abrir a la red de casa» en la app de
  escritorio y «unirse al Grimório de un amigo».

## Créditos y aviso legal

Datos e imágenes de las cartas: [Scryfall](https://scryfall.com) · combos: [Commander Spellbook](https://commanderspellbook.com)
· meta: [EDHREC](https://edhrec.com) y [MTGTop8](https://www.mtgtop8.com) · motor de reglas: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0).

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

*Grimório es Fan Content no oficial permitido por la Fan Content Policy de Wizards of the Coast. No está aprobado ni
respaldado por Wizards. Parte de los materiales utilizados son propiedad de Wizards of the Coast. © Wizards of the
Coast LLC.*

## Licencia

[GPL-3.0](LICENSE): puedes usarlo, estudiarlo, modificarlo y compartirlo libremente; los cambios que distribuyas deben
seguir siendo abiertos bajo la misma licencia.
