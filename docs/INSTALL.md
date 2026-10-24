**English** · [Português](INSTALL.pt.md) · [Español](INSTALL.es.md) · [Deutsch](INSTALL.de.md) · [简体中文](INSTALL.zh-CN.md)

# Installing Grimório

Grimório runs on your own computer: a small program starts it and your web browser shows it. You don't need to
install Docker, Java or anything else, and you don't need a server. Everything it needs is in the download.

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
5. A black window opens. The first time it downloads the card data (see [The first start](#the-first-start)), then your
   browser opens Grimório by itself.

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

4. Your browser opens Grimório by itself. Keep the terminal open while you use it.

## The first start

- Grimório downloads the **card data** once: about **11 MB** (every card, combos, tournament decks), usually under a
  minute. You see the progress in the window. After that it starts without downloading anything.
- The browser opens at **http://127.0.0.1:8107** (if that port is busy, the next free one: the window shows the
  address).
- Grimório asks **who's playing?** Type your name to create your profile. Each person who uses this computer can
  create their own profile, with their own decks, tests, tournaments and ratings, and pick it on the next start.
- Choose the language in **Settings › Language**: English, Português, Español, Deutsch or 简体中文.

## Opening it again

Start `Grimorio.exe` (Windows) or `./grimorio` (Linux) again. If Grimório is already running, it simply opens the
browser on it again.

Tips:

- Bookmark **http://127.0.0.1:8107** in your browser.
- In Chrome or Edge you can install it as an app (the *Install* icon in the address bar): it gets its own window and
  an icon. Grimório itself still has to be running (step above).
- To use it from a phone or tablet on the same Wi-Fi, start it with `Grimorio.exe --host 0.0.0.0` (Windows, from a
  command prompt in the folder) or `./grimorio --host 0.0.0.0` (Linux) and open `http://<your computer's IP>:8107`
  on the phone. Anyone on your network can then open it, so do this only at home.

## Stopping it

**Close the black window** (Windows) or press **Ctrl+C** in the terminal (Linux; closing the terminal also stops it).
Games that are being played stop too. Your decks are saved as you go: nothing is lost.

## Where your data lives

| System | Folder |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (paste this in the File Explorer address bar) |
| Linux | `~/.local/share/grimorio` |

Your decks, profiles, tests, tournaments and ratings are in **`grimorio.db`** in that folder, and your own deck covers
are in `covers`. To make a backup, copy those two (with Grimório stopped).

## Updating

1. Download the new version from [Releases](https://github.com/hubertdungen/grimorio/releases) as above.
2. Stop Grimório, delete the old program folder and extract the new one in its place.
3. Start it. Your data stays (it's in the data folder, not in the program folder); on the first start the new version
   downloads its updated card data (about 11 MB).

## Troubleshooting

**"Windows protected your PC" or the antivirus blocks `Grimorio.exe`.**
Grimório is open source and isn't signed with a paid certificate, so SmartScreen and some antivirus programs warn
about it, especially right after a new version is published. Click **More info › Run anyway**. If your antivirus
moved a file to quarantine (often `jre\bin\java.exe`), restore it and add the Grimorio folder as an exception, or
extract the zip again. The source code is public and the packages are built by GitHub from it.

**The window says the ports are busy / Grimório opens on a different address.**
Grimório uses port 8107, or the next free one up to 8126, and prints the address it chose. To pick one yourself:
`Grimorio.exe --port 9000` (Windows command prompt) or `./grimorio --port 9000` (Linux).

**The tests in the Coliseum fail with an error about Java or Forge.**
The `jre` and `forge` folders must be next to the program. Extract the whole zip/tar.gz again (don't copy only the
`.exe`), and check that your antivirus didn't quarantine `java.exe`.

**The computer gets slow, or Forge games fail halfway.**
Each Forge game uses about 1 GB of RAM. Go to **Settings** and set **Forge games at the same time** to **1**, and
close other heavy programs. With 4 GB of RAM, use 1.

**"Play" (taking a seat yourself against Forge) isn't available.**
That mode needs the server install with Docker (see the [README](../README.md#developer-setup)). Everything else in the
Coliseum — tests, tournaments, the automatic Arena — works in the desktop packages.

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
Open the address shown in the window (for example http://127.0.0.1:8107) yourself.

## Uninstalling

1. Stop Grimório.
2. Delete the program folder (the one you extracted).
3. To also delete your decks and profiles, delete the data folder (see [Where your data lives](#where-your-data-lives)).
   This can't be undone: make a backup of `grimorio.db` first if you might want them later.
