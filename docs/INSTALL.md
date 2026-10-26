**English** · [Português](INSTALL.pt.md) · [Español](INSTALL.es.md) · [Deutsch](INSTALL.de.md) · [简体中文](INSTALL.zh-CN.md)

# Installing Grimório

Grimório runs on your own computer. On Windows it opens in its own app window; on Linux your web browser shows it.
Everything it needs, Java and the Forge engine included, comes in the download, and it keeps itself up to date.

## What you need

- **Windows 10 or 11** (64-bit), or **Linux** (64-bit, x86-64: Ubuntu, Mint, Fedora, Debian, Arch…).
- **4 GB of RAM** at least (8 GB is more comfortable when the bots play many games).
- About **600 MB** of free disk space.
- An **internet connection** the first time (to download the card data) and for card images and imports.
- Linux only: **Python 3.10 or newer**. Almost every Linux already has it; check with `python3 --version`.

## Windows

1. Go to the [Releases page](https://github.com/hubertdungen/grimorio/releases) and, under **Assets** of the newest
   version, download **`Grimorio-<version>-windows-x64.zip`** (about 110 MB).
2. Find the file in your *Downloads* folder, **right-click it › Extract All…** and pick a place you'll remember, for
   example `Documents\Grimorio`. Don't run it from inside the zip: it needs all its files next to it.
3. Open the extracted **Grimorio** folder and double-click **`Grimorio.exe`**.
4. If Windows shows *"Windows protected your PC"*: click **More info › Run anyway**. Grimório is free and isn't
   signed with a paid certificate, so Windows doesn't know it yet (see [Troubleshooting](#troubleshooting)).
5. Grimório opens in its own window. The first time, it downloads the card data before the window appears, usually in
   under a minute, so give it a moment (see [The first start](#the-first-start)).

The window uses Microsoft Edge WebView2, which comes with Windows 10 and 11. If a computer doesn't have it, Grimório
opens in your browser instead and shows a small box *"Grimório is running in your browser"*: leave it there while you
play, and press **OK** when you want to close Grimório. To use the browser on purpose, start it with
`Grimorio.exe --browser` (from a command prompt in the folder).

## Linux

1. Go to the [Releases page](https://github.com/hubertdungen/grimorio/releases) and, under **Assets** of the newest
   version, download **`grimorio-<version>-linux-x64.tar.gz`** (about 100 MB).
2. Extract it. In a terminal:

   ```bash
   cd ~/Downloads
   tar xzf grimorio-*-linux-x64.tar.gz
   ```

   (or right-click the file in your file manager › *Extract Here*). You get a `grimorio` folder; you can move it
   anywhere, for example to your home folder.
3. Start it from a terminal:

   ```bash
   cd grimorio
   ./grimorio
   ```

4. Your browser opens Grimório by itself. The terminal keeps it running while you use it. If the Python package
   `pywebview` is installed (`pip install pywebview`), Grimório opens in its own window instead of the browser.

## The first start

- Grimório downloads the **card data** once: about **11 MB** (every card, combos, tournament decks), usually under a
  minute. On Linux you see the progress in the terminal; on Windows the window appears when it's done. After that it
  starts without downloading anything.
- Grimório runs at **http://127.0.0.1:8107** (if that port is busy, the next free one: the terminal on Linux and the
  log on Windows show the address).
- Grimório asks **who's playing?** Type your name to create your profile. Each person who uses this computer can
  create their own profile, with their own decks, tests, tournaments and ratings, and pick it on the next start.
- Choose the language in **Settings › Language**: English, Português, Español, Deutsch or 简体中文.

## Opening it again

Start `Grimorio.exe` (Windows) or `./grimorio` (Linux) again. If Grimório is already running, it simply shows it
again. On Windows, a shortcut on the desktop makes this easy: right-click `Grimorio.exe` › *Send to › Desktop (create
shortcut)* (on Windows 11 it's under *Show more options*).

Tips:

- Linux: bookmark **http://127.0.0.1:8107** in your browser. In Chrome or Edge you can also install it as an app (the
  *Install* icon in the address bar) to give it its own window and an icon; Grimório itself still has to be running.
- To use it from a phone or tablet on the same Wi-Fi, start it with `Grimorio.exe --host 0.0.0.0` (Windows, from a
  command prompt in the folder) or `./grimorio --host 0.0.0.0` (Linux) and open `http://<your computer's IP>:8107`
  on the phone. Anyone on your network can then open it, so do this only at home.

## Stopping it

**Close the Grimório window** (Windows; if it opened in the browser, press **OK** in the small box) or press **Ctrl+C**
in the terminal (Linux; closing the terminal also stops it). Forge games that are being played stop too. Your decks
are saved as you go: nothing is lost.

## Where your data lives

| System | Folder |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (paste this in the File Explorer address bar) |
| Linux | `~/.local/share/grimorio` |

Your decks, profiles, tests, tournaments and ratings are in **`grimorio.db`** in that folder, and your own deck covers
are in `covers`. This folder is separate from the program folder, so every new version finds your data as you left
it. To make a backup, use **Settings › Data & backups › Export everything** (one `.grimorio` file you can keep
anywhere); to keep two computers in step, or to keep a copy in Google Drive, OneDrive, Dropbox or Syncthing, tick
*Sync with a cloud folder* there. Free options and 3-step guides: [Backups and cloud sync](../README.md#backups-and-cloud-sync).

## Updates

Grimório updates itself. Each time it starts, it checks the newest release on GitHub. When there's a newer version, it
downloads it in the background into the `versions` folder inside the data folder, checks its sha256 checksum, and
starts it the next time you open Grimório. Your shortcut and the `Grimorio.exe` (or `./grimorio`) you extracted keep
working: they hand over to the newest version you have. On its first start a new version also downloads its updated card data (about 11 MB).

**Settings › Updates** shows the installed and the latest version. Untick **Update automatically** there to stop the
automatic updates.

To update by hand: download the new version from [Releases](https://github.com/hubertdungen/grimorio/releases) as
above, stop Grimório, delete the old program folder and extract the new one in its place.

### Moving to a new version

Your data stays in the data folder (see [Where your data lives](#where-your-data-lives)), so every version uses the
same decks, games, tournaments and ratings. A new version only adds to the database (new tables or columns) and keeps
everything that's already there. Before a new version opens the database for the first time, it saves a copy in the
`backups` folder inside the data folder; the last 3 copies are kept.

## Troubleshooting

**"Windows protected your PC" or the antivirus blocks `Grimorio.exe`.**
Grimório is open source and isn't signed with a paid certificate, so SmartScreen and some antivirus programs warn
about it, especially right after a new version is published. Click **More info › Run anyway**. If your antivirus
moved a file to quarantine (often `jre\bin\java.exe`), restore it and add the Grimorio folder as an exception, or
extract the zip again. The source code is public and the packages are built by GitHub from it.

**Grimório says the ports are busy / it opens on a different address.**
Grimório uses port 8107, or the next free one up to 8126, and writes the address it chose in the terminal (Linux) or
the log (Windows, see below). To pick one yourself:
`Grimorio.exe --port 9000` (Windows command prompt) or `./grimorio --port 9000` (Linux).

**The tests in the Coliseum fail with an error about Java or Forge.**
The `jre` and `forge` folders must be next to the program. Extract the whole zip/tar.gz again (don't copy only the
`.exe`), and check that your antivirus didn't quarantine `java.exe`.

**The computer gets slow, or Forge games fail halfway.**
Each Forge game uses about 1 GB of RAM. Go to **Settings** and set **Forge games at the same time** to **1**, and
close other heavy programs. With 4 GB of RAM, use 1.

**"Play against Forge" with a Commander deck isn't available.**
Playing against Forge yourself on Grimório's table works in the desktop packages. Commander uses the classic Forge
window, which needs the server install with Docker (see the [README](../README.md#your-own-linux-server-docker)).

**The card data download failed.**
Check your internet connection (and any proxy or firewall) and start Grimório again: it retries. You can also download
`grimorio-data.zip` from the same release by hand and point Grimório to it: on Windows,
`set GRIMORIO_DATA_URL=C:\path\to\grimorio-data.zip` and then `Grimorio.exe` in the same command prompt; on Linux,
`GRIMORIO_DATA_URL=~/Downloads/grimorio-data.zip ./grimorio`.

**Linux: "Grimório needs Python 3.10 or newer".**
Install Python: `sudo apt install python3` (Ubuntu, Debian, Mint), `sudo dnf install python3` (Fedora),
`sudo pacman -S python` (Arch).

**Linux: "Permission denied" when starting `./grimorio`.**
Run `chmod +x grimorio` in the folder (some tools lose the permission when extracting) and try again.

**The browser didn't open.**
Open the address shown in the terminal or in the small Grimório box (for example http://127.0.0.1:8107) yourself.

**Windows: Grimório doesn't open, or something goes wrong.**
The Windows app writes everything it reports to **`%LOCALAPPDATA%\Grimorio\logs\grimorio.log`** (paste the folder
part in the File Explorer address bar); the run before that is kept as `grimorio.log.1`. It shows the version and
the address Grimório is using. Attach this file when you ask for help or report a problem.

## Uninstalling

1. Stop Grimório.
2. Delete the program folder (the one you extracted).
3. To also delete your decks and profiles, delete the data folder (see [Where your data lives](#where-your-data-lives)).
   This can't be undone: make a backup of `grimorio.db` first if you might want them later.
