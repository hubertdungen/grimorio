[English](README.md) · [Português](README.pt.md) · **Español** · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Construye, prueba y pon a combatir tus mazos de Magic: The Gathering, con sugerencias explicadas, partidas reales de IA contra IA y partidas que juegas tú contra Forge.**

Grimório es un constructor de mazos gratuito para todos los formatos (Commander, Modern, Pauper, Standard, Legacy, …)
que funciona en tu propio ordenador. Cruza el texto de las cartas, mazos reales de torneo, datos de EDHREC y combos de
Commander Spellbook para sugerirte cartas *y explicarte por qué*, y enfrenta tu mazo a otros mazos con el motor de
reglas de código abierto [Forge](https://github.com/Card-Forge/forge), para que puedas ver las partidas, leer un
informe y mejorar la lista.

También puedes sentarte tú a la mesa: juega contra Forge en la mesa propia de Grimório o contra tus amigos con todas
las reglas, organiza torneos, ligas y campeonatos con clasificación, y abre salas en línea y una Taberna para tus
amigos, en el PC, la tableta o el móvil.

La interfaz está disponible en **English** (predeterminado), **Português**, **Español**, **Deutsch** y **简体中文**
(Ajustes › Idioma).

## Capturas de pantalla

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Inicio"></a><br><sub>Inicio</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Construir: búsqueda con palabras en cualquier idioma, lista y sugerencias"></a><br><sub>Construir: búsqueda con palabras en cualquier idioma, lista y sugerencias</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Sugerencias por función, combos y mazos reales"></a><br><sub>Sugerencias por función, combos y mazos reales</sub></td><td width="50%"><a href="docs/img/analysis.jpg"><img src="docs/img/analysis.jpg" alt="Análisis: curva, colores, probabilidades de la mano inicial y cómo gana el mazo"></a><br><sub>Análisis: curva, colores, probabilidades de la mano inicial y cómo gana el mazo</sub></td></tr>
<tr><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universo: el mapa 3D de todas las cartas"></a><br><sub>Universo: el mapa 3D de todas las cartas</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Biblioteca con portadas, estrellas, trofeos y comparación"></a><br><sub>Biblioteca con portadas, estrellas, trofeos y comparación</sub></td></tr>
<tr><td width="50%"><a href="docs/img/sideboard.jpg"><img src="docs/img/sideboard.jpg" alt="Banquillo: respuestas a lo que te gana en las pruebas"></a><br><sub>Banquillo: respuestas a lo que te gana en las pruebas</sub></td><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: estrellas por mazo y la Arena automática"></a><br><sub>Ratings: estrellas por mazo y la Arena automática</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseo: mira a Forge jugar tu mazo, con la pila en directo"></a><br><sub>Coliseo: mira a Forge jugar tu mazo, con la pila en directo</sub></td><td width="50%"><a href="docs/img/forgeplay.jpg"><img src="docs/img/forgeplay.jpg" alt="Juega tú contra Forge: combate con bloqueos numerados"></a><br><sub>Juega tú contra Forge: combate con bloqueos numerados</sub></td></tr>
<tr><td width="50%"><a href="docs/img/stack.jpg"><img src="docs/img/stack.jpg" alt="Peticiones claras: el objetivo de Oblivion Ring, «tuya» / «suya» y la pila numerada"></a><br><sub>Peticiones claras: el objetivo de Oblivion Ring, «tuya» / «suya» y la pila numerada</sub></td><td width="50%"><a href="docs/img/multiplayer.jpg"><img src="docs/img/multiplayer.jpg" alt="Two-Headed Giant contra Forge: cajones de los jugadores y la esfera del equipo"></a><br><sub>Two-Headed Giant contra Forge: cajones de los jugadores y la esfera del equipo</sub></td></tr>
<tr><td width="50%"><a href="docs/img/draft.jpg"><img src="docs/img/draft.jpg" alt="Draft y Sellado: sobres reales, bots de Forge y un torneo al final"></a><br><sub>Draft y Sellado: sobres reales, bots de Forge y un torneo al final</sub></td><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Torneos: podio, cuadro y etiquetas de origen de los mazos"></a><br><sub>Torneos: podio, cuadro y etiquetas de origen de los mazos</sub></td></tr>
<tr><td width="50%"><a href="docs/img/live.jpg"><img src="docs/img/live.jpg" alt="Torneo en directo: progreso, partidas en curso y los últimos resultados"></a><br><sub>Torneo en directo: progreso, partidas en curso y los últimos resultados</sub></td><td width="50%"><a href="docs/img/history.jpg"><img src="docs/img/history.jpg" alt="Historial de torneos como galería (cuadrícula o lista) y el Salón de la fama"></a><br><sub>Historial de torneos como galería (cuadrícula o lista) y el Salón de la fama</sub></td></tr>
<tr><td width="50%"><a href="docs/img/teams.jpg"><img src="docs/img/teams.jpg" alt="Torneos por equipos: podio y clasificación por equipos"></a><br><sub>Torneos por equipos: podio y clasificación por equipos</sub></td><td width="50%"><a href="docs/img/online.jpg"><img src="docs/img/online.jpg" alt="Online: crear sala — mesa libre o estricta, de 2 a 4 jugadores, tu mazo"></a><br><sub>Online: crear sala — mesa libre o estricta, de 2 a 4 jugadores, tu mazo</sub></td></tr>
<tr><td width="50%"><a href="docs/img/freetable.jpg"><img src="docs/img/freetable.jpg" alt="Mesa libre online: perspectiva, dados, chat con cartas mencionadas"></a><br><sub>Mesa libre online: perspectiva, dados, chat con cartas mencionadas</sub></td><td width="50%"><a href="docs/img/taverna.jpg"><img src="docs/img/taverna.jpg" alt="La Taberna: amigos conectados, chat con @menciones y mazos compartidos"></a><br><sub>La Taberna: amigos conectados, chat con @menciones y mazos compartidos</sub></td></tr>
<tr><td width="50%"><a href="docs/img/halloffame.jpg"><img src="docs/img/halloffame.jpg" alt="Salón de la Fama de la Taberna: podio, destacados y clasificación entre amigos"></a><br><sub>Salón de la Fama de la Taberna: podio, destacados y clasificación entre amigos</sub></td><td width="50%"><a href="docs/img/table.jpg"><img src="docs/img/table.jpg" alt="En la mesa: contador de vidas, dados en 3D y escáner de cartas"></a><br><sub>En la mesa: contador de vidas, dados en 3D y escáner de cartas</sub></td></tr>
<tr><td colspan="2"><a href="docs/img/mobile.jpg"><img src="docs/img/mobile.jpg" alt="En el móvil: la mesa compacta de Forge Play, la Taberna y un torneo en directo"></a><br><sub>En el móvil: la mesa compacta de Forge Play, la Taberna y un torneo en directo</sub></td></tr>
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
  en directo mientras construyes. Siguen el plan de tu mazo (tribus, encantamientos, artefactos, contadores, fichas…) y
  cada una dice a qué cartas tuyas alimenta, qué hueco cubre o qué combo completa.
- **Empieza a tu manera**: elige de 3 a 10 cartas (o un comandante) y deja que complete el mazo, constrúyelo a mano,
  impórtalo o describe una idea.
- **Importa** desde TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 y Scryfall: perfiles enteros (como
  tus mazos, de la comunidad o de un amigo), ilustraciones y portadas personalizadas, sideboard y maybeboard. Busca
  mazos públicos de Archidekt con filtros. *Exportar / Importar mazos*, en la Biblioteca, saca todos tus mazos o una
  selección (un archivo de Grimório con portadas, ilustraciones, banquillo y notas, o listas .txt) y trae varios
  archivos a la vez (.txt, .dek, .csv, .zip o listas pegadas), con una vista previa antes de guardar nada.
- **Búsqueda con palabras, en cualquier idioma**: «criaturas humanas legendarias con contadores +1/+1», «tierras que
  roban cartas», «terrenos que compram cartas», «抽牌的地» o la sintaxis de Scryfall (`t:`, `o:`, `mv<=`); las tildes son
  opcionales; más de 35 funciones de las cartas (eliminación, robo, mill, daño directo, blink, stax…) para filtrar.
- **Búsqueda de respuestas a lo que te gana**: «sideboard contra mill», «anti encantamientos», «bueno contra
  planeswalkers», «odio al cementerio», «contra voladores» en cualquiera de los 5 idiomas: 15 amenazas (encantamientos,
  artefactos, planeswalkers, cementerio, mill, fichas, voladores, combo, control, aggro, daño directo, descarte,
  ganar vida, ramp, hexproof), las mejores respuestas primero, cada carta con el porqué, y se combina con color, tipo,
  coste y formato («… blancos hasta 2 en modern»).
- **Panel de análisis**: cifras principales, curva de maná por criaturas y el resto, gráficos de colores (lo que piden
  los costes frente a lo que dan las tierras), probabilidades de la mano inicial, cómo gana y cómo pierde el mazo, si el
  banquillo cubre lo que le ganó, las cartas que ganan o se quedan en la mano en las partidas, y una ⓘ en cada número.
- **Universo 3D de cartas**: regiones por función que muestran lo que le falta a tu mazo, el rendimiento de cada carta
  en partidas reales con cambios sugeridos, constelaciones de los arquetipos del meta y un lazo para encontrar las mejores
  cartas de cualquier zona.
- **Combos y paquetes de sinergia**, comparación de mazos (con el porqué de que un mazo parecido tenga mejor rating:
  interacción, curva, tierras, staples, objetivo) y detección de duplicados.
- **Mesa de Forge Play estable y viva** — tamaño fijo escalado a la pantalla (apaisada en PC y tablet, vertical en el
  móvil): las zonas no saltan con cartas nuevas ni con la barra del navegador y las filas llenas se dividen en más líneas
  (hasta 4 por lado) con el tamaño de carta que elegiste. Las
  cartas se deslizan entre jugadas, soltar un aura, remoción o equipo sobre una criatura la elige como objetivo, adivinar
  y vigilar en dos montones, buscar en la biblioteca en una cuadrícula con filtro y el veneno subiendo en el ☠.
- **Mesa libre online, en solitario y en torneo**: partidas entre amigos en las que cada uno mueve sus cartas como en
  una mesa de verdad (arrastrar, girar, contadores, fichas y copias en ficha de cualquier carta, notas en las cartas,
  vida, veneno, energía, daño de comandante, monarca, día/noche). Fases del turno con enderezar y robar automáticos,
  hechizos con objetivos en una pila compartida (arrastra un Counterspell sobre el hechizo), bloqueos arrastrados sobre
  los atacantes, ataques a planeswalkers y batallas, fuerza/resistencia reales con equipos, auras y anthems, buscar en
  la biblioteca y mirar en secreto la mano de otro jugador. Perspectiva, dados 3D que se cogen y se lanzan (el amigo ve
  la misma tirada desde su lado), un lápiz que brilla y cuya estela se desvanece, el cursor de cada jugador como una
  manita de su color, y chat con @cartas y #reglas. Manos y bibliotecas ocultas en el servidor. Antes de la partida, un
  lobby 3D con las cajas de los mazos de todos y el lanzamiento de la moneda; banquillo entre las partidas de una serie;
  Two-Headed Giant a cuatro. Los amigos sin mazos se sientan con uno prestado, del meta o pegado. Mesa en solitario para
  probar mazos y torneos de mesa libre.
- **Mesa estricta entre personas**: abre una sala como *Estricta* y Forge hace cumplir todas las reglas (maná, pila,
  combate, objetivos) mientras cada jugador ve la mesa en su propia pantalla, como en Jugar contra Forge: 1 contra 1,
  todos contra todos de 3–4 jugadores o Two-Headed Giant, en las salas, en la Taberna y en los torneos (marcados con ⚖).
  Quien gana la moneda elige empezar jugando o robando, y quien deja una decisión pendiente 5 minutos pierde la partida,
  para que las mesas sigan avanzando.
- **Mecánicas a la vista en todas las mesas**: veneno y energía, lealtad de planeswalkers que sube y baja, batallas,
  sagas, cartas de doble cara y MDFC, cartas flip, boca abajo, copias, emblemas, auras y equipos anexados, monarca,
  iniciativa, día/noche, phasing, mutate y cartas que vuelven del cementerio, todo animado.
- **Torneos por equipos de verdad**: 2 contra 2 en la misma mesa o Two-Headed Giant (vida compartida), equipos
  equilibrados por formato y rating, generador más justo. Las partidas contra Forge cuentan para los ratings.
- **Asistente de IA con memoria**: cada mazo guarda lo que pediste, lo que dijo la IA y lo que aplicaste, y la IA recibe
  ese historial; recorta exactamente el exceso por encima de 60 (o 100 en Commander).
- **Torneo mixto**: bots de Forge y personas en el mismo cuadro; cada mazo «lo juega su dueño» o «lo juega el bot»;
  bot contra bot va al simulador, persona contra bot a Forge Play (también invitados) y persona contra persona a la mesa
  libre o a la mesa estricta.
- **Two-Headed Giant más fiel a las reglas**: vida compartida (30), veneno del equipo que pierde a los 15, el equipo que
  empieza no roba en el 1.er turno y la repetición cuenta los turnos por equipo («Turno 9 — C», «Turno 9 — D»).
- **Cartas del tamaño que quieras**: en Ajustes › Mesa, en la repetición y en Forge Play: automático o 48–128 px, con las
  tierras del mismo tamaño; nada sale del lado del jugador: si no cabe, se apila (tierras iguales en un montón ×N).
- **Forge Play claro y certero**: cada petición dice con palabras sencillas qué hacer («Elige la criatura que encantará
  Rancor») y muestra la carta que la pide, con marco rojo cuando el efecto perjudica a la carta elegida y verde cuando
  la ayuda; una pila numerada (1 se resuelve a continuación) muestra el objetivo de cada elemento y quién lo controla;
  elegir una carta tuya para un efecto perjudicial pregunta «Esta carta es tuya — ¿exiliar de todos modos?». Objetivos
  bajo la pila, «¿Activar?» antes de una habilidad, pagar solo cuando es obvio, Cancelar en todas partes, bloqueos de
  verdad; soltar una carta sobre una criatura o sobre la esfera de un jugador la elige como objetivo, y soltar un
  atacante sobre un planeswalker o una batalla lo ataca. Jugar desde la parte superior de la biblioteca (Courser of
  Kruphix, Future Sight…), nombrar cartas con un buscador, cartas reveladas en imagen y banquillo entre partidas en una
  pantalla con las imágenes de las cartas. Una moneda 3D con la cara de cada jugador decide quién empieza y, desde la
  2.ª partida de una serie, elige quien perdió la anterior; un reloj de torneo opcional te da unos segundos para
  responder (S para más tiempo). Si Forge falla a mitad, la partida termina sin contar; el «atrás» del móvil se queda
  dentro de la app.
- **Bucles infinitos de una vez**: Heliod + Spike Feeder y similares usan el atajo de las reglas (vida ∞) y el rival sin
  otra vía se rinde; Blood Moon muestra que las tierras no básicas son Montañas; moler con exilio dice de dónde viene.
- **Estrellas blancas por rendimiento y galería de trofeos**: hasta 4★ por puntos y 2★ por rendimiento en podios; copas en
  3 líneas y la vista del mazo con todos los trofeos. En Construir, categorías que se abren y cierran y «+ Maybeboard».
- **Una mesa más viva**: daño que se lee (⚔ hecho, ✕ recibido, ↠ arrollar), golpes que vuelan del origen al objetivo
  con el estilo del atacante (garras, fuego, rayos…) y hacen temblar la mesa, cartas que se agrietan y se hacen añicos,
  se deshacen en el exilio o son atraídas hacia el permanente que las guarda, maná que vuela de la tierra al hechizo,
  entradas propias para tierras especiales (fetch, shock, legendarias, de cualquier color…) y habilidades en acción
  (prisa, alcance, toque mortal, mareo de invocación). Sonidos con volumen para cada tipo; en combate la mesa se
  enrojece y cada atacante bloqueado y sus bloqueadores llevan el mismo número y color (⚔ 1 / 🛡 1) con una línea entre
  ellos; patrones de tapete para tu lado (10, elegidos a mitad de partida) que los demás jugadores ven en línea.
- **La esfera de vida**: tu vida es una esfera de cristal en 3D con un fluido de partículas dentro: la materia sigue el
  maná de tu campo de batalla (luz dorada, agua, pantano, lava, verde, metal), el nivel sigue tu vida, los golpes
  derraman sangre y dejan el color del atacante, y el veneno, el cementerio, el exilio, las auras y una biblioteca que se
  agota también se ven en ella. Se rompe de una forma distinta según cómo perdiste. Cógela y lánzala (las esferas chocan
  entre sí y, en línea, todos la ven moverse); los equipos y el Two-Headed Giant comparten una esfera de equipo. Deja el
  ratón encima para abrir *La esfera por dentro*, con gráficos de lo que pesa en ella. Estilos, tamaño y calidad en
  Ajustes, y una esfera clásica para dispositivos más ligeros.
- **Actualizaciones y app**: los paquetes de Windows y Linux se actualizan solos, con un aviso en pantalla; la app
  Android avisa cuando hay un .apk más nuevo; las actualizaciones del servidor esperan a las partidas de Forge Play y
  mantienen las páginas abiertas funcionando.
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
  Shift+Enter (o Shift+Espacio) para terminar el turno. En pantallas táctiles, tocar una carta abre «Jugar» y el reloj
  de respuesta se pausa mientras eliges. Funciona en un servidor y en los paquetes de escritorio (sin Docker); Commander
  usa la ventana clásica de Forge (servidor con Docker).
- **Repeticiones de todas las partidas**: las partidas de torneo que juegan las personas (en Forge Play, en la mesa
  estricta o en la mesa libre) se pueden volver a ver con ▶, y **Mis partidas** guarda tus últimas 60 partidas contra
  Forge y las partidas de mesa libre de tus salas, con victorias y derrotas vistas desde tu asiento. La mano del rival
  queda oculta.
- **Torneos, ligas y campeonatos**: eliminación directa y doble eliminación, suizo, liga, mesas, gauntlet, rey de la
  colina, grupos + eliminatorias y equipos; casual con o sin formatos mezclados; un generador de torneos, cuadro en
  directo, podio e historial, ligas de campeones y de podios, trofeos de oro/plata/bronce y platino en los mazos que
  ganan, con ranking o casual; apuestas con monedas de juego (no se compra nada, sin dinero real). Crear un torneo lleva
  tres pasos (formato y sistema, mazos, resumen); la vista en directo muestra el progreso, lo que se está jugando, cuándo
  te toca, los últimos resultados con repeticiones y el camino de tu mazo en el cuadro; el historial es una galería con
  búsqueda, filtros y vista en cuadrícula o en lista.
- **Ratings y ranking**: de 0 a 6 estrellas por mazo (Elo por formato, más un rating casual aparte), estrellas blancas
  y número de trofeos, filtros míos / amigos / comunidad / meta, salón de la fama y galería de trofeos, alimentados por
  las pruebas, los torneos y una Arena automática opcional.
- **En línea y amigos**: la pestaña En línea tiene **＋ Crear sala** (con amigos, con bots de Forge o en solitario;
  mesa libre o estricta, 2–4 jugadores, Two-Headed Giant) y **🔗 Entrar con un enlace**. Cada sala tiene un bloque de
  invitación con el enlace, Copiar, Compartir y un código QR, y el panel Compartir abre Grimório a internet con un túnel
  gratuito de Cloudflare en un clic (o una dirección propia). Quien abre el enlace entra con un mazo suyo, sin cuenta,
  en el navegador o en su propia app de Grimório (Windows, Linux, Android) con sus mazos y ajustes; las páginas de
  invitación se abren en el idioma de quien las visita. Cualquier instalación puede alojar, también los paquetes de
  escritorio. Invitaciones de amigos con enlace y QR, los mazos de los amigos como fuente en torneos y en la Arena, y
  etiquetas con el origen de cada mazo (meta, míos, de un amigo, de la comunidad).
- **La Taberna**: un lugar para tus amigos en Coliseo › Taberna, alojado en tu propio Grimório: los miembros entran con
  un enlace de invitación o un QR y ven quién está en línea o jugando, en un chat con @menciones, tarjetas de #mazo que
  se abren y se copian, reacciones, respuestas, mensajes fijados y «Proponer una partida». Los miembros abren ahí mesas
  libres o estrictas y quien aloja organiza torneos entre ellos; la Estantería guarda mazos para ver, copiar o jugar en
  contra, colocados en una mesa 3D; el Salón de la Fama guarda el podio, la clasificación y los resultados recientes, y
  cuenta solo las partidas jugadas en las salas de la Taberna (las partidas en papel se añaden a mano). Quien aloja
  puede cerrarla (queda solo para leer) o borrarla.
- **📖 Biblioteca de reglas**: palabras clave, reglas o nombres de cartas en cualquier idioma (también con la cámara):
  Comprehensive Rules, rulings oficiales y una explicación opcional de la IA. En cualquier pantalla, una mecánica en
  negrita muestra la regla al pasar el ratón y abre las Reglas en una ventana; los símbolos de maná aparecen como
  símbolos, no como {T}. Las Reglas también tienen la **Guía del Grimório**, interactiva: cada área y su barra de
  herramientas explicadas, los gestos de la mesa con tus teclas, lo que muestra la esfera de vida y seis guías paso a
  paso. En Forge Play, «📖 Reglas rápidas» responde mientras escribes.
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
- **Una mesa para móviles y tabletas**: en una partida la mesa ocupa toda la pantalla en las dos orientaciones, con
  cartas más grandes: la cabecera y la columna lateral pasan a cajones y una sola barra reúne la petición, el maná, OK /
  Terminar el turno y el reloj. En el modo táctil, mantener pulsado hace lo que el botón derecho o pasar el ratón hacen
  en el ordenador, y los Ajustes y la guía muestran los gestos táctiles. Las mesas de 3–4 jugadores usan cajones: tú y
  un rival a tamaño completo, una pestaña por rival con vida, mano y ⚔ cuando te ataca, una vista que cambia sola cuando
  te atacan o tienes que elegir un objetivo, y ⊞ para ver a todos (también en el PC, si quieres).
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
- Un interruptor «abrir a la red de casa» en la app de escritorio.

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
