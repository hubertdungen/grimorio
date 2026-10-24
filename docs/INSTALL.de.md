[English](INSTALL.md) · [Português](INSTALL.pt.md) · [Español](INSTALL.es.md) · **Deutsch** · [简体中文](INSTALL.zh-CN.md)

# Grimório installieren

Grimório läuft auf deinem eigenen Computer: Ein kleines Programm startet es, und dein Webbrowser zeigt es an. Du musst
weder Docker noch Java noch sonst etwas installieren, und du brauchst keinen Server. Alles, was Grimório braucht,
steckt im Download.

## Was du brauchst

- **Windows 10 oder 11** (64 Bit) oder **Linux** (64 Bit, x86-64: Ubuntu, Mint, Fedora, Debian, Arch …).
- Mindestens **4 GB RAM** (8 GB sind angenehmer, wenn die Bots viele Partien spielen).
- Etwa **600 MB** freien Speicherplatz.
- Eine **Internetverbindung** beim ersten Mal (um die Kartendaten herunterzuladen) sowie für Kartenbilder und Importe.
- Nur unter Linux: **Python 3.10 oder neuer**. Fast jedes Linux bringt es schon mit; prüfe es mit `python3 --version`.

## Windows

1. Geh auf die [Releases-Seite](https://github.com/hubertdungen/grimorio/releases) und lade bei der neuesten Version
   unter **Assets** die Datei **`Grimorio-<version>-windows-x64.zip`** herunter (etwa 110 MB).
2. Such die Datei in deinem Ordner *Downloads*, **klick sie mit der rechten Maustaste an › Alle extrahieren…** und wähle
   einen Ort, den du dir merken kannst, zum Beispiel `Documents\Grimorio`. Starte das Programm nicht direkt aus der
   ZIP-Datei: Es braucht alle seine Dateien daneben.
3. Öffne den entpackten Ordner **Grimorio** und doppelklicke auf **`Grimorio.exe`**.
4. Wenn Windows *„Der Computer wurde durch Windows geschützt“* anzeigt: Klick auf **Weitere Informationen › Trotzdem
   ausführen**. Grimório ist kostenlos und nicht mit einem kostenpflichtigen Zertifikat signiert, deshalb kennt Windows
   es noch nicht (siehe [Fehlerbehebung](#fehlerbehebung)).
5. Ein schwarzes Fenster öffnet sich. Beim ersten Mal lädt es die Kartendaten herunter (siehe
   [Der erste Start](#der-erste-start)), danach öffnet dein Browser Grimório von selbst.

## Linux

1. Geh auf die [Releases-Seite](https://github.com/hubertdungen/grimorio/releases) und lade bei der neuesten Version
   unter **Assets** die Datei **`grimorio-<version>-linux-x64.tar.gz`** herunter (etwa 100 MB).
2. Entpacke sie. Im Terminal:

   ```bash
   cd ~/Downloads
   tar xzf grimorio-*-linux-x64.tar.gz
   ```

   (oder klick die Datei in deinem Dateimanager mit der rechten Maustaste an › *Hier entpacken*). Du bekommst einen
   Ordner `grimorio`; den kannst du verschieben, wohin du willst, zum Beispiel in deinen persönlichen Ordner.
3. Starte es im Terminal:

   ```bash
   cd grimorio
   ./grimorio
   ```

4. Dein Browser öffnet Grimório von selbst. Lass das Terminal offen, solange du es benutzt.

## Der erste Start

- Grimório lädt die **Kartendaten** einmalig herunter: etwa **11 MB** (alle Karten, Combos, Turnierdecks), meist in
  weniger als einer Minute. Den Fortschritt siehst du im Fenster. Danach startet es, ohne etwas herunterzuladen.
- Der Browser öffnet sich unter **http://127.0.0.1:8107** (ist dieser Port belegt, nimmt Grimório den nächsten freien:
  Das Fenster zeigt dir die Adresse an).
- Grimório fragt **Wer spielt?** Gib deinen Namen ein, um dein Profil anzulegen. Jede Person, die diesen Computer
  benutzt, kann ihr eigenes Profil anlegen, mit eigenen Decks, Tests, Turnieren und Ratings, und es beim nächsten Start
  auswählen.
- Die Sprache wählst du unter **Einstellungen › Sprache**: English, Português, Español, Deutsch oder 简体中文.

## Erneut öffnen

Starte `Grimorio.exe` (Windows) oder `./grimorio` (Linux) einfach noch einmal. Läuft Grimório schon, öffnet sich nur
wieder der Browser damit.

Tipps:

- Setz dir in deinem Browser ein Lesezeichen für **http://127.0.0.1:8107**.
- In Chrome oder Edge kannst du es als App installieren (das Symbol *Installieren* in der Adressleiste): Es bekommt ein
  eigenes Fenster und ein Symbol. Grimório selbst muss trotzdem laufen (siehe oben).
- Um es auf einem Handy oder Tablet im selben WLAN zu benutzen, starte es mit `Grimorio.exe --host 0.0.0.0` (Windows,
  aus einer Eingabeaufforderung im Ordner) oder `./grimorio --host 0.0.0.0` (Linux) und öffne auf dem Handy
  `http://<IP deines Computers>:8107`. Dann kann es jeder in deinem Netzwerk öffnen, also mach das nur zu Hause.

## Beenden

**Schließ das schwarze Fenster** (Windows) oder drück **Strg+C** im Terminal (Linux; auch das Schließen des Terminals
beendet es). Laufende Partien werden ebenfalls beendet. Deine Decks werden laufend gespeichert: Es geht nichts verloren.

## Wo deine Daten liegen

| System | Ordner |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (füg das in die Adressleiste des Datei-Explorers ein) |
| Linux | `~/.local/share/grimorio` |

Deine Decks, Profile, Tests, Turniere und Ratings liegen in **`grimorio.db`** in diesem Ordner, deine eigenen Deck-Cover
in `covers`. Für ein Backup kopierst du diese beiden (während Grimório beendet ist).

**Sicherungen und Cloud:** unter **Einstellungen › Daten & Sicherungen** exportierst du alles in eine `.grimorio`-Datei
oder verbindest einen Ordner von Google Drive, OneDrive, Dropbox oder Syncthing, um zwei Computer gleich zu halten
(funktioniert offline und synchronisiert später). Kostenlose Optionen und Anleitungen in 3 Schritten:
[Sicherungen und Cloud-Sync](../README.de.md#sicherungen-und-cloud-sync).

## Aktualisieren

1. Lade die neue Version wie oben unter [Releases](https://github.com/hubertdungen/grimorio/releases) herunter.
2. Beende Grimório, lösch den alten Programmordner und entpacke den neuen an seiner Stelle.
3. Starte es. Deine Daten bleiben erhalten (sie liegen im Datenordner, nicht im Programmordner); beim ersten Start lädt
   die neue Version ihre aktualisierten Kartendaten herunter (etwa 11 MB).

## Fehlerbehebung

**„Der Computer wurde durch Windows geschützt“ oder der Virenscanner blockiert `Grimorio.exe`.**
Grimório ist Open Source und nicht mit einem kostenpflichtigen Zertifikat signiert, deshalb warnen SmartScreen und
manche Virenscanner davor, vor allem direkt nach der Veröffentlichung einer neuen Version. Klick auf **Weitere
Informationen › Trotzdem ausführen**. Hat dein Virenscanner eine Datei in die Quarantäne verschoben (oft
`jre\bin\java.exe`), stell sie wieder her und füge den Ordner Grimorio als Ausnahme hinzu, oder entpacke die ZIP-Datei
noch einmal. Der Quellcode ist öffentlich, und die Pakete werden von GitHub daraus gebaut.

**Das Fenster meldet, dass die Ports belegt sind / Grimório öffnet sich unter einer anderen Adresse.**
Grimório nutzt Port 8107 oder den nächsten freien bis 8126 und zeigt die gewählte Adresse an. Um selbst einen
festzulegen: `Grimorio.exe --port 9000` (Windows-Eingabeaufforderung) oder `./grimorio --port 9000` (Linux).

**Die Tests im Kolosseum schlagen mit einem Fehler zu Java oder Forge fehl.**
Die Ordner `jre` und `forge` müssen neben dem Programm liegen. Entpacke die ganze zip/tar.gz-Datei noch einmal (kopier
nicht nur die `.exe`) und prüfe, ob dein Virenscanner `java.exe` in die Quarantäne verschoben hat.

**Der Computer wird langsam, oder Forge-Partien brechen mittendrin ab.**
Jede Forge-Partie braucht etwa 1 GB RAM. Geh in die **Einstellungen**, stell **Gleichzeitige Forge-Spiele** auf **1**
und schließ andere speicherhungrige Programme. Mit 4 GB RAM nimm 1.

**„Spielen“ (selbst gegen Forge antreten) ist nicht verfügbar.**
Dieser Modus braucht die Server-Installation mit Docker (siehe die [README](../README.de.md#entwickler-setup)). Alles
andere im Kolosseum – Tests, Turniere, die automatische Arena – funktioniert auch in den Desktop-Paketen.

**Der Download der Kartendaten ist fehlgeschlagen.**
Prüf deine Internetverbindung (und einen eventuellen Proxy oder eine Firewall) und starte Grimório noch einmal: Es
versucht es erneut. Du kannst `grimorio-data.zip` auch selbst aus demselben Release herunterladen und Grimório darauf
verweisen: unter Windows mit `set GRIMORIO_DATA_URL=C:\path\to\grimorio-data.zip` und danach `Grimorio.exe` in derselben
Eingabeaufforderung; unter Linux mit `GRIMORIO_DATA_URL=~/Downloads/grimorio-data.zip ./grimorio`.

**Linux: „Grimório needs Python 3.10 or newer“.**
Installiere Python: `sudo apt install python3` (Ubuntu, Debian, Mint), `sudo dnf install python3` (Fedora),
`sudo pacman -S python` (Arch).

**Linux: „Permission denied“ beim Starten von `./grimorio`.**
Führ im Ordner `chmod +x grimorio` aus (manche Programme verlieren beim Entpacken die Berechtigung) und versuch es noch
einmal.

**Der Browser hat sich nicht geöffnet.**
Öffne die im Fenster angezeigte Adresse (zum Beispiel http://127.0.0.1:8107) selbst.

## Deinstallieren

1. Beende Grimório.
2. Lösch den Programmordner (den, den du entpackt hast).
3. Wenn du auch deine Decks und Profile löschen willst, lösch den Datenordner (siehe
   [Wo deine Daten liegen](#wo-deine-daten-liegen)). Das lässt sich nicht rückgängig machen: Mach vorher ein Backup von
   `grimorio.db`, falls du sie später noch brauchen könntest.
