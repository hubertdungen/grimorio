[English](INSTALL.md) · [Português](INSTALL.pt.md) · **Español** · [Deutsch](INSTALL.de.md) · [简体中文](INSTALL.zh-CN.md)

# Instalar Grimório

Grimório funciona en tu propio ordenador. En Windows se abre en su propia ventana de aplicación; en Linux, un pequeño
programa lo arranca y tu navegador web lo muestra. Todo lo que necesita (Java y Forge incluidos) viene en la descarga, y
después se actualiza solo.

## Qué necesitas

- **Windows 10 u 11** (64 bits), o **Linux** (64 bits, x86-64: Ubuntu, Mint, Fedora, Debian, Arch…).
- Al menos **4 GB de RAM** (con 8 GB vas más holgado cuando los bots juegan muchas partidas).
- Unos **600 MB** de espacio libre en disco.
- **Conexión a internet** la primera vez (para descargar los datos de las cartas) y para las imágenes de las cartas y
  las importaciones.
- Solo en Linux: **Python 3.10 o posterior**. Casi todas las distribuciones Linux ya lo traen; compruébalo con
  `python3 --version`.

## Windows

1. Entra en la [página de Releases](https://github.com/hubertdungen/grimorio/releases) y, en **Assets** de la versión
   más reciente, descarga **`Grimorio-<version>-windows-x64.zip`** (unos 110 MB).
2. Busca el archivo en tu carpeta *Descargas*, **haz clic derecho sobre él › Extraer todo…** y elige un sitio que
   vayas a recordar, por ejemplo `Documents\Grimorio`. No lo ejecutes desde dentro del zip: necesita todos sus archivos
   a su lado.
3. Abre la carpeta **Grimorio** que se ha extraído y haz doble clic en **`Grimorio.exe`**.
4. Si Windows muestra *«Windows protegió su PC»*: haz clic en **Más información › Ejecutar de todas formas**.
   Grimório es gratuito y no está firmado con un certificado de pago, así que Windows todavía no lo conoce (consulta
   [Solución de problemas](#solución-de-problemas)).
5. Grimório se abre en su propia ventana. La primera vez tarda hasta un minuto en aparecer, porque descarga los datos
   de las cartas (consulta [El primer arranque](#el-primer-arranque)).

La ventana usa **Microsoft Edge WebView2**, que ya viene con Windows 10 y 11. Si falta en tu ordenador, Grimório se
abre en tu navegador y muestra un pequeño cuadro *«Press OK to close Grimório»*: deja ese cuadro abierto mientras lo
uses y pulsa **OK** cuando quieras cerrarlo.

## Linux

1. Entra en la [página de Releases](https://github.com/hubertdungen/grimorio/releases) y, en **Assets** de la versión
   más reciente, descarga **`grimorio-<version>-linux-x64.tar.gz`** (unos 100 MB).
2. Extráelo. En una terminal:

   ```bash
   cd ~/Downloads
   tar xzf grimorio-*-linux-x64.tar.gz
   ```

   (o haz clic derecho sobre el archivo en tu gestor de archivos › *Extraer aquí*). Obtendrás una carpeta `grimorio`;
   puedes moverla donde quieras, por ejemplo a tu carpeta personal.
3. Arráncalo desde una terminal:

   ```bash
   cd grimorio
   ./grimorio
   ```

4. Tu navegador abre Grimório solo. La terminal sigue en marcha mientras lo uses.

## El primer arranque

- Grimório descarga los **datos de las cartas** una sola vez: unos **11 MB** (todas las cartas, combos, mazos de
  torneo), normalmente en menos de un minuto. En Linux verás el progreso en la terminal; en Windows, la
  ventana aparece cuando termina. A partir de ahí arranca sin descargar nada.
- En Linux, el navegador se abre en **http://127.0.0.1:8107** (si ese puerto está ocupado, en el siguiente libre: la
  terminal muestra la dirección).
- Grimório pregunta **¿Quién va a jugar?** Escribe tu nombre para crear tu perfil. Cada persona que use este ordenador
  puede crear su propio perfil, con sus propios mazos, pruebas, torneos y ratings, y elegirlo en el siguiente arranque.
- Elige el idioma en **Ajustes › Idioma**: English, Português, Español, Deutsch o 简体中文.

## Volver a abrirlo

Vuelve a abrir `Grimorio.exe` (Windows) o `./grimorio` (Linux). Si Grimório ya está en marcha, se abre otra ventana
(Windows) o otra pestaña del navegador (Linux) sobre el mismo Grimório.

Consejos:

- En Windows, haz clic derecho sobre `Grimorio.exe` › *Anclar a Inicio* (o *Enviar a › Escritorio*) para tenerlo a mano.
- En Linux, guarda **http://127.0.0.1:8107** en los marcadores del navegador. En Chrome o Edge también puedes
  instalarlo como una app (el icono *Instalar* de la barra de direcciones): tendrá su propia ventana y su propio icono.
  Aun así, Grimório tiene que estar en marcha (paso anterior).
- ¿Prefieres el navegador también en Windows? Arráncalo con `Grimorio.exe --browser`.
- Para usarlo desde un móvil o una tableta conectados a la misma Wi-Fi, arráncalo con `Grimorio.exe --host 0.0.0.0`
  (Windows, desde un símbolo del sistema abierto en la carpeta) o `./grimorio --host 0.0.0.0` (Linux) y abre
  `http://<la IP de tu ordenador>:8107` en el móvil. Así cualquiera de tu red podrá abrirlo, por lo que es mejor
  hacerlo solo en casa.

## Detenerlo

**Cierra la ventana de Grimório** (Windows) o pulsa **Ctrl+C** en la terminal (Linux; cerrar la terminal también lo
detiene). Las partidas de Forge que se estén jugando también se detienen. Tus mazos se guardan sobre la marcha: no se
pierde nada.

## Dónde se guardan tus datos

| Sistema | Carpeta |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (pégalo en la barra de direcciones del Explorador de archivos) |
| Linux | `~/.local/share/grimorio` |

Tus mazos, perfiles, pruebas, torneos y ratings están en **`grimorio.db`**, dentro de esa carpeta, y las portadas de
mazo que hayas puesto tú están en `covers`. Para hacer una copia de seguridad, copia esos dos (con Grimório detenido).
En esa carpeta también están `backups` (las copias automáticas de la base de datos, consulta [Actualizar](#actualizar))
y, en Windows, `logs`.

**Copias y nube:** en **Ajustes › Datos y copias** exportas todo a un archivo `.grimorio` o conectas una carpeta de
Google Drive, OneDrive, Dropbox o Syncthing para mantener dos ordenadores iguales (funciona sin conexión y sincroniza
después). Opciones gratuitas y guías en 3 pasos: [Copias y sincronización en la nube](../README.es.md#copias-y-sincronización-en-la-nube).

## Actualizar

Los paquetes se actualizan solos. Cuando sale una versión nueva, Grimório la descarga en segundo plano, la comprueba
con su suma sha256 y la arranca la próxima vez que lo abras (en el primer arranque, la nueva versión descarga también
sus datos de cartas actualizados, unos 11 MB). Sigues abriendo el mismo `Grimorio.exe` o `./grimorio` de siempre. En
**Ajustes › Actualizaciones** ves la versión instalada y la más reciente, y puedes desactivar *Actualizar solo*.

Tus mazos, partidas, torneos y ratings están en la carpeta de datos (consulta
[Dónde se guardan tus datos](#dónde-se-guardan-tus-datos)), fuera de la carpeta del programa, así que pasan tal cual a
cada versión nueva. Antes de que una versión nueva abra la base de datos, Grimório guarda una copia en la carpeta
`backups` de esa misma carpeta de datos (se conservan las 3 últimas).

Para actualizar a mano (por ejemplo, con *Actualizar solo* desactivado):

1. Descarga la nueva versión desde [Releases](https://github.com/hubertdungen/grimorio/releases), como antes.
2. Detén Grimório, borra la carpeta antigua del programa y extrae la nueva en su lugar.
3. Arráncalo. Tus datos se mantienen.

## Solución de problemas

**«Windows protegió su PC» o el antivirus bloquea `Grimorio.exe`.**
Grimório es de código abierto y no está firmado con un certificado de pago, así que SmartScreen y algunos antivirus
avisan, sobre todo justo después de publicarse una versión nueva. Haz clic en **Más información › Ejecutar de todas
formas**. Si tu antivirus ha puesto un archivo en cuarentena (a menudo `jre\bin\java.exe`), restáuralo y añade la
carpeta de Grimorio como excepción, o vuelve a extraer el zip. El código fuente es público y GitHub genera los paquetes
a partir de él.

**Grimório no se abre, o se cierra solo (Windows).**
Lo que Grimório va diciendo se guarda en `%LOCALAPPDATA%\Grimorio\logs\grimorio.log` (la ejecución anterior queda en
`grimorio.log.1`). Ábrelo con el Bloc de notas: las últimas líneas suelen decir qué ha fallado. Si pides ayuda, adjunta
ese archivo.

**Los puertos están ocupados / Grimório se abre en otra dirección.**
Grimório usa el puerto 8107, o el siguiente libre hasta el 8126, y escribe la dirección que ha elegido en la terminal
(Linux) o en `grimorio.log` (Windows). Para elegir uno
tú: `Grimorio.exe --port 9000` (símbolo del sistema de Windows) o `./grimorio --port 9000` (Linux).

**Las pruebas del Coliseo fallan con un error sobre Java o Forge.**
Las carpetas `jre` y `forge` tienen que estar junto al programa. Vuelve a extraer el zip/tar.gz entero (no copies solo
el `.exe`) y comprueba que tu antivirus no haya puesto `java.exe` en cuarentena.

**El ordenador va lento, o las partidas de Forge fallan a medias.**
Cada partida de Forge usa aproximadamente 1 GB de RAM. Ve a **Ajustes**, pon **Partidas de Forge simultáneas** en **1**
y cierra otros programas pesados. Con 4 GB de RAM, usa 1.

**«Jugar contra Forge» en Commander no está disponible.**
Jugar tú contra Forge en la mesa de Grimório funciona en los paquetes de escritorio. Commander usa la ventana clásica
de Forge, que necesita la instalación de servidor con Docker (consulta el
[README](../README.es.md#en-tu-propio-servidor-linux-docker)).

**Ha fallado la descarga de los datos de las cartas.**
Comprueba tu conexión a internet (y cualquier proxy o cortafuegos) y vuelve a arrancar Grimório: lo reintenta. También
puedes descargar a mano `grimorio-data.zip` desde la misma release e indicarle a Grimório dónde está: en Windows,
`set GRIMORIO_DATA_URL=C:\path\to\grimorio-data.zip` y después `Grimorio.exe` en el mismo símbolo del sistema; en
Linux, `GRIMORIO_DATA_URL=~/Downloads/grimorio-data.zip ./grimorio`.

**Linux: «Grimório needs Python 3.10 or newer».**
Instala Python: `sudo apt install python3` (Ubuntu, Debian, Mint), `sudo dnf install python3` (Fedora),
`sudo pacman -S python` (Arch).

**Linux: «Permission denied» al arrancar `./grimorio`.**
Ejecuta `chmod +x grimorio` en la carpeta (algunas herramientas pierden el permiso al extraer) y vuelve a intentarlo.

**El navegador no se ha abierto (Linux).**
Abre tú mismo la dirección que aparece en la terminal (por ejemplo http://127.0.0.1:8107).

## Desinstalar

1. Detén Grimório.
2. Borra la carpeta del programa (la que extrajiste).
3. Si también quieres borrar tus mazos y perfiles, borra la carpeta de datos (consulta
   [Dónde se guardan tus datos](#dónde-se-guardan-tus-datos)). No se puede deshacer: haz antes una copia de seguridad
   de `grimorio.db` si crees que podrías quererlos más adelante.
