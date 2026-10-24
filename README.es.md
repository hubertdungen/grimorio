[English](README.md) · [Português](README.pt.md) · **Español** · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Construye, prueba y pon a combatir tus mazos de Magic: The Gathering, con sugerencias explicadas y partidas reales de IA contra IA.**

Grimório es un constructor de mazos gratuito para todos los formatos (Commander, Modern, Pauper, Standard, Legacy, …)
que funciona en tu propio ordenador. Cruza el texto de las cartas, mazos reales de torneo, datos de EDHREC y combos de
Commander Spellbook para sugerirte cartas *y explicarte por qué*, y enfrenta tu mazo a otros mazos con el motor de
reglas de código abierto [Forge](https://github.com/Card-Forge/forge), para que puedas ver las partidas, leer un
informe y mejorar la lista.

La interfaz está disponible en **English** (predeterminado), **Português**, **Español**, **Deutsch** y **简体中文**
(Ajustes › Idioma).

## Capturas de pantalla

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Inicio"></a><br><sub>Inicio</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Construir: lista, búsqueda y sugerencias explicadas"></a><br><sub>Construir: lista, búsqueda y sugerencias explicadas</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Sugerencias por función, combos y mazos reales"></a><br><sub>Sugerencias por función, combos y mazos reales</sub></td><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universo: el mapa 3D de todas las cartas"></a><br><sub>Universo: el mapa 3D de todas las cartas</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseo: mira a Forge jugar tu mazo"></a><br><sub>Coliseo: mira a Forge jugar tu mazo</sub></td><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Torneos con clasificación y cuadro en directo"></a><br><sub>Torneos con clasificación y cuadro en directo</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: estrellas por mazo y la Arena automática"></a><br><sub>Ratings: estrellas por mazo y la Arena automática</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Biblioteca con portadas, estrellas y comparación"></a><br><sub>Biblioteca con portadas, estrellas y comparación</sub></td></tr>
</table>

## Instalación

**Windows y Linux, sin Docker y sin configurar ningún servidor:** descarga el paquete desde
[Releases](https://github.com/hubertdungen/grimorio/releases), descomprímelo y abre `Grimorio.exe` (Windows) o
`./grimorio` (Linux). Grimório se abre en tu navegador. Guía paso a paso para todo el mundo:
**[docs/INSTALL.es.md](docs/INSTALL.es.md)**.

En el primer arranque, Grimório pregunta *¿Quién va a jugar?*: cada persona crea un perfil con su nombre, y sus mazos,
pruebas, torneos y ratings se guardan por separado. Varias personas pueden compartir la misma instalación.

Si quieres instalarlo en un servidor doméstico para varios dispositivos, o desarrollarlo, consulta
[Configuración para desarrolladores](#configuración-para-desarrolladores).

## Funciones

- **Construcción de mazos para todos los formatos**: legalidad, objetivos propios de cada formato, consejos de base
  de maná, curva, presupuesto, brackets.
- **Sugerencias inteligentes y explicadas**: embeddings de texto + EDHREC + mazos reales + combos + tus propios gustos;
  en directo mientras construyes.
- **Empieza a tu manera**: elige de 3 a 10 cartas (o un comandante) y deja que complete el mazo, constrúyelo a mano,
  impórtalo o describe una idea.
- **Importa** desde TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 y Scryfall: perfiles enteros,
  ilustraciones y portadas personalizadas, sideboard y maybeboard. Busca mazos públicos de Archidekt con filtros.
- **Universo 3D de cartas**: regiones por función que muestran lo que le falta a tu mazo, el rendimiento de cada carta
  en partidas reales con cambios sugeridos, constelaciones de los arquetipos del meta y un lazo para encontrar las mejores
  cartas de cualquier zona.
- **Combos y paquetes de sinergia**, comparación de mazos y detección de duplicados.
- **Coliseo (IA de Forge)**: IA contra IA con reglas reales (Bo1/Bo3, sideboard inteligente, aprendizaje), todos
  contra todos de 3–4 jugadores y mesas de Commander, un tablero animado que puedes seguir en directo, informes y
  mejoras sugeridas, y la opción de jugar tú contra Forge en el navegador (instalación de servidor con Docker).
- **Torneos**: eliminación directa y doble eliminación, suizo, liga y mesas, cuadro en directo, podio e historial;
  apuestas con monedas de juego (no se compra nada, sin dinero real) y trofeos en los mazos que ganan.
- **Ratings**: de 0 a 6 estrellas por mazo (Elo por formato, más un rating casual aparte), alimentados por las
  pruebas, los torneos y una Arena automática opcional.
- **Perfiles**: una instalación, varios jugadores, cada uno con sus propios mazos.
- **Instalable** como PWA en móviles y tabletas; pensado para pantallas táctiles.

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
| `sim.py`, `build/forge/` | ejecutor de Forge (Docker o Java local) y el lanzador `GrimorioSim` (eventos exactos de la partida, ajustes de la IA, pistas de IA por carta) |
| `tournament.py`, `ratings.py` | torneos y ratings / Arena |
| `deck_import.py`, `ia.py`, `play.py` | importadores de webs, proveedores de IA opcionales, jugar contra Forge (noVNC, solo con Docker) |
| `build/` | pipeline de datos (Scryfall, embeddings, UMAP, combos, fichas, meta) |
| `web/` | front end en React + Vite |
| `packaging/` | paquetes de escritorio para Windows/Linux: lanzador, paquete y generador de datos |

## Hoja de ruta

- App para Android: consulta [docs/ROADMAP.md](docs/ROADMAP.md) (en inglés).
- Jugar tú contra Forge sin Docker (paquetes de escritorio).

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
