[English](INSTALL.md) · [Português](INSTALL.pt.md) · **Español** · [Deutsch](INSTALL.de.md) · [简体中文](INSTALL.zh-CN.md)

# Instalar Grimório

Grimório funciona en tu propio ordenador: un pequeño programa lo arranca y tu navegador web lo muestra. No tienes que
instalar Docker, Java ni nada más, y no necesitas ningún servidor. Todo lo que necesita viene en la descarga.

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
5. Se abre una ventana negra. La primera vez descarga los datos de las cartas (consulta
   [El primer arranque](#el-primer-arranque)) y después tu navegador abre Grimório solo.

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

4. Tu navegador abre Grimório solo. Deja la terminal abierta mientras lo uses.

## El primer arranque

- Grimório descarga los **datos de las cartas** una sola vez: unos **11 MB** (todas las cartas, combos, mazos de
  torneo), normalmente en menos de un minuto. Verás el progreso en la ventana. A partir de ahí arranca sin descargar
  nada.
- El navegador se abre en **http://127.0.0.1:8107** (si ese puerto está ocupado, en el siguiente libre: la ventana
  muestra la dirección).
- Grimório pregunta **¿Quién va a jugar?** Escribe tu nombre para crear tu perfil. Cada persona que use este ordenador
  puede crear su propio perfil, con sus propios mazos, pruebas, torneos y ratings, y elegirlo en el siguiente arranque.
- Elige el idioma en **Ajustes › Idioma**: English, Português, Español, Deutsch o 简体中文.

## Volver a abrirlo

Vuelve a abrir `Grimorio.exe` (Windows) o `./grimorio` (Linux). Si Grimório ya está en marcha, simplemente vuelve a
abrirlo en el navegador.

Consejos:

- Guarda **http://127.0.0.1:8107** en los marcadores del navegador.
- En Chrome o Edge puedes instalarlo como una app (el icono *Instalar* de la barra de direcciones): tendrá su propia
  ventana y su propio icono. Aun así, Grimório tiene que estar en marcha (paso anterior).
- Para usarlo desde un móvil o una tableta conectados a la misma Wi-Fi, arráncalo con `Grimorio.exe --host 0.0.0.0`
  (Windows, desde un símbolo del sistema abierto en la carpeta) o `./grimorio --host 0.0.0.0` (Linux) y abre
  `http://<la IP de tu ordenador>:8107` en el móvil. Así cualquiera de tu red podrá abrirlo, por lo que es mejor
  hacerlo solo en casa.

## Detenerlo

**Cierra la ventana negra** (Windows) o pulsa **Ctrl+C** en la terminal (Linux; cerrar la terminal también lo detiene).
Las partidas que se estén jugando también se detienen. Tus mazos se guardan sobre la marcha: no se pierde nada.

## Dónde se guardan tus datos

| Sistema | Carpeta |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (pégalo en la barra de direcciones del Explorador de archivos) |
| Linux | `~/.local/share/grimorio` |

Tus mazos, perfiles, pruebas, torneos y ratings están en **`grimorio.db`**, dentro de esa carpeta, y las portadas de
mazo que hayas puesto tú están en `covers`. Para hacer una copia de seguridad, copia esos dos (con Grimório detenido).

**Copias y nube:** en **Ajustes › Datos y copias** exportas todo a un archivo `.grimorio` o conectas una carpeta de
Google Drive, OneDrive, Dropbox o Syncthing para mantener dos ordenadores iguales (funciona sin conexión y sincroniza
después). Opciones gratuitas y guías en 3 pasos: [Copias y sincronización en la nube](../README.es.md#copias-y-sincronización-en-la-nube).

## Actualizar

1. Descarga la nueva versión desde [Releases](https://github.com/hubertdungen/grimorio/releases), como antes.
2. Detén Grimório, borra la carpeta antigua del programa y extrae la nueva en su lugar.
3. Arráncalo. Tus datos se mantienen (están en la carpeta de datos, no en la del programa); en el primer arranque, la
   nueva versión descarga sus datos de cartas actualizados (unos 11 MB).

## Solución de problemas

**«Windows protegió su PC» o el antivirus bloquea `Grimorio.exe`.**
Grimório es de código abierto y no está firmado con un certificado de pago, así que SmartScreen y algunos antivirus
avisan, sobre todo justo después de publicarse una versión nueva. Haz clic en **Más información › Ejecutar de todas
formas**. Si tu antivirus ha puesto un archivo en cuarentena (a menudo `jre\bin\java.exe`), restáuralo y añade la
carpeta de Grimorio como excepción, o vuelve a extraer el zip. El código fuente es público y GitHub genera los paquetes
a partir de él.

**La ventana dice que los puertos están ocupados / Grimório se abre en otra dirección.**
Grimório usa el puerto 8107, o el siguiente libre hasta el 8126, y muestra la dirección que ha elegido. Para elegir uno
tú: `Grimorio.exe --port 9000` (símbolo del sistema de Windows) o `./grimorio --port 9000` (Linux).

**Las pruebas del Coliseo fallan con un error sobre Java o Forge.**
Las carpetas `jre` y `forge` tienen que estar junto al programa. Vuelve a extraer el zip/tar.gz entero (no copies solo
el `.exe`) y comprueba que tu antivirus no haya puesto `java.exe` en cuarentena.

**El ordenador va lento, o las partidas de Forge fallan a medias.**
Cada partida de Forge usa aproximadamente 1 GB de RAM. Ve a **Ajustes**, pon **Partidas de Forge simultáneas** en **1**
y cierra otros programas pesados. Con 4 GB de RAM, usa 1.

**«Jugar» (sentarte tú a jugar contra Forge) no está disponible.**
Ese modo necesita la instalación de servidor con Docker (consulta el
[README](../README.es.md#configuración-para-desarrolladores)). Todo lo demás del Coliseo (pruebas, torneos, la Arena
automática) funciona en los paquetes de escritorio.

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

**El navegador no se ha abierto.**
Abre tú mismo la dirección que aparece en la ventana (por ejemplo http://127.0.0.1:8107).

## Desinstalar

1. Detén Grimório.
2. Borra la carpeta del programa (la que extrajiste).
3. Si también quieres borrar tus mazos y perfiles, borra la carpeta de datos (consulta
   [Dónde se guardan tus datos](#dónde-se-guardan-tus-datos)). No se puede deshacer: haz antes una copia de seguridad
   de `grimorio.db` si crees que podrías quererlos más adelante.
