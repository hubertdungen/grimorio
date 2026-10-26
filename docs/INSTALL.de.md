[English](INSTALL.md) · [Português](INSTALL.pt.md) · [Español](INSTALL.es.md) · **Deutsch** · [简体中文](INSTALL.zh-CN.md)

# Grimório installieren

Grimório läuft auf deinem eigenen Computer. Unter Windows öffnet es sich in einem eigenen App-Fenster, unter Linux zeigt
es dein Webbrowser an. Alles, was es braucht, samt Java und der Forge-Engine, steckt im Download, und es hält sich selbst
auf dem neuesten Stand.

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
5. Grimório öffnet sich in einem eigenen Fenster. Beim ersten Mal lädt es die Kartendaten herunter, bevor das Fenster
   erscheint, meist in weniger als einer Minute (siehe [Der erste Start](#der-erste-start)).

Das Fenster nutzt Microsoft Edge WebView2, das bei Windows 10 und 11 dabei ist. Fehlt es auf einem Computer, öffnet sich
Grimório stattdessen in deinem Browser und zeigt ein kleines Fenster *„Grimório is running in your browser“*: Lass es offen,
solange du spielst, und drück **OK**, wenn du Grimório beenden willst. Willst du bewusst den Browser nutzen, starte es
mit `Grimorio.exe --browser` (aus einer Eingabeaufforderung im Ordner).

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

4. Dein Browser öffnet Grimório von selbst. Das Terminal hält es am Laufen, solange du es benutzt. Ist das
   Python-Paket `pywebview` installiert (`pip install pywebview`), öffnet sich Grimório stattdessen in einem eigenen
   Fenster.

## Der erste Start

- Grimório lädt die **Kartendaten** einmalig herunter: etwa **11 MB** (alle Karten, Combos, Turnierdecks), meist in
  weniger als einer Minute. Unter Linux siehst du den Fortschritt im Terminal, unter Windows erscheint das Fenster, wenn
  der Download fertig ist. Danach startet es, ohne etwas herunterzuladen.
- Grimório läuft unter **http://127.0.0.1:8107** (ist dieser Port belegt, unter dem nächsten freien: Unter Linux zeigt
  das Terminal die Adresse an, unter Windows das Log).
- Grimório fragt **Wer spielt?** Gib deinen Namen ein, um dein Profil anzulegen. Jede Person, die diesen Computer
  benutzt, kann ihr eigenes Profil anlegen, mit eigenen Decks, Tests, Turnieren und Ratings, und es beim nächsten Start
  auswählen.
- Die Sprache wählst du unter **Einstellungen › Sprache**: English, Português, Español, Deutsch oder 简体中文.

## Erneut öffnen

Starte `Grimorio.exe` (Windows) oder `./grimorio` (Linux) einfach noch einmal. Läuft Grimório schon, zeigt es sich nur
wieder an. Unter Windows kannst du mit der rechten Maustaste auf `Grimorio.exe` › *Weitere Optionen anzeigen › Senden an
› Desktop (Verknüpfung erstellen)* klicken, um es vom Desktop aus zu starten.

Tipps:

- Linux: Setz dir in deinem Browser ein Lesezeichen für **http://127.0.0.1:8107**. In Chrome oder Edge kannst du es
  auch als App installieren (das Symbol *Installieren* in der Adressleiste): Es bekommt ein eigenes Fenster und ein
  Symbol. Grimório selbst muss trotzdem laufen.
- Um es auf einem Handy oder Tablet im selben WLAN zu benutzen, starte es mit `Grimorio.exe --host 0.0.0.0` (Windows,
  aus einer Eingabeaufforderung im Ordner) oder `./grimorio --host 0.0.0.0` (Linux) und öffne auf dem Handy
  `http://<IP deines Computers>:8107`. Dann kann es jeder in deinem Netzwerk öffnen, also mach das nur zu Hause.

## Beenden

**Schließ das Grimório-Fenster** (Windows; hat es sich im Browser geöffnet, drück **OK** im kleinen Fenster) oder drück
**Strg+C** im Terminal (Linux; auch das Schließen des Terminals beendet es). Laufende Forge-Partien werden ebenfalls
beendet. Deine Decks werden laufend gespeichert: Es geht nichts verloren.

## Wo deine Daten liegen

| System | Ordner |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio` (füg das in die Adressleiste des Datei-Explorers ein) |
| Linux | `~/.local/share/grimorio` |

Deine Decks, Profile, Tests, Turniere und Ratings liegen in **`grimorio.db`** in diesem Ordner, deine eigenen Deck-Cover
in `covers`. Dieser Ordner ist vom Programmordner getrennt, deshalb findet jede neue Version deine Daten so vor, wie du
sie verlassen hast. Für ein Backup nimm **Einstellungen › Daten & Sicherungen › Alles exportieren** (eine
`.grimorio`-Datei, die du aufbewahren kannst, wo du willst); um zwei Computer gleich zu halten oder eine Kopie in Google
Drive, OneDrive, Dropbox oder Syncthing zu haben, kreuz dort *Mit einem Cloud-Ordner synchronisieren* an. Kostenlose
Optionen und Anleitungen in 3 Schritten: [Sicherungen und Cloud-Sync](../README.de.md#sicherungen-und-cloud-sync).

## Updates

Grimório aktualisiert sich selbst. Bei jedem Start prüft es das neueste Release auf GitHub. Gibt es eine neuere Version,
lädt es sie im Hintergrund in den Datenordner herunter (`versions\<version>`), prüft ihre sha256-Prüfsumme und startet
sie, wenn du Grimório das nächste Mal öffnest. Deine Verknüpfung und die ursprüngliche `Grimorio.exe` funktionieren
weiter: Sie übergeben an die neueste Version, die du hast. Beim ersten Start lädt eine neue Version außerdem ihre
aktualisierten Kartendaten herunter (etwa 11 MB).

**Einstellungen › Updates** zeigt die installierte und die neueste Version. Nimm dort den Haken bei **Automatisch
aktualisieren** heraus, um die automatischen Updates abzuschalten.

Von Hand aktualisieren: Lade die neue Version wie oben unter [Releases](https://github.com/hubertdungen/grimorio/releases)
herunter, beende Grimório, lösch den alten Programmordner und entpacke den neuen an seiner Stelle.

### Auf eine neue Version wechseln

Deine Daten bleiben im Datenordner (siehe [Wo deine Daten liegen](#wo-deine-daten-liegen)), deshalb nutzt jede Version
dieselben Decks, Partien, Turniere und Ratings. Eine neue Version ergänzt die Datenbank nur (neue Tabellen oder Spalten)
und behält alles, was schon darin ist. Bevor eine neue Version die Datenbank zum ersten Mal öffnet, speichert sie eine
Kopie im Ordner `backups` im Datenordner; die letzten 3 Kopien werden behalten.

## Fehlerbehebung

**„Der Computer wurde durch Windows geschützt“ oder der Virenscanner blockiert `Grimorio.exe`.**
Grimório ist Open Source und nicht mit einem kostenpflichtigen Zertifikat signiert, deshalb warnen SmartScreen und
manche Virenscanner davor, vor allem direkt nach der Veröffentlichung einer neuen Version. Klick auf **Weitere
Informationen › Trotzdem ausführen**. Hat dein Virenscanner eine Datei in die Quarantäne verschoben (oft
`jre\bin\java.exe`), stell sie wieder her und füge den Ordner Grimorio als Ausnahme hinzu, oder entpacke die ZIP-Datei
noch einmal. Der Quellcode ist öffentlich, und die Pakete werden von GitHub daraus gebaut.

**Grimório meldet, dass die Ports belegt sind / Grimório öffnet sich unter einer anderen Adresse.**
Grimório nutzt Port 8107 oder den nächsten freien bis 8126 und gibt die gewählte Adresse aus. Um selbst einen
festzulegen: `Grimorio.exe --port 9000` (Windows-Eingabeaufforderung) oder `./grimorio --port 9000` (Linux).

**Die Tests im Kolosseum schlagen mit einem Fehler zu Java oder Forge fehl.**
Die Ordner `jre` und `forge` müssen neben dem Programm liegen. Entpacke die ganze zip/tar.gz-Datei noch einmal (kopier
nicht nur die `.exe`) und prüfe, ob dein Virenscanner `java.exe` in die Quarantäne verschoben hat.

**Der Computer wird langsam, oder Forge-Partien brechen mittendrin ab.**
Jede Forge-Partie braucht etwa 1 GB RAM. Geh in die **Einstellungen**, stell **Gleichzeitige Forge-Spiele** auf **1**
und schließ andere speicherhungrige Programme. Mit 4 GB RAM nimm 1.

**„Gegen Forge spielen“ mit einem Commander-Deck ist nicht verfügbar.**
Selbst gegen Forge am Grimório-Tisch zu spielen funktioniert in den Desktop-Paketen. Commander nutzt das klassische
Forge-Fenster, und das braucht die Server-Installation mit Docker (siehe die [README](../README.de.md#auf-deinem-eigenen-linux-server-docker)).

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
Öffne die im Terminal angezeigte Adresse (zum Beispiel http://127.0.0.1:8107) selbst.

**Windows: Grimório öffnet sich nicht, oder etwas geht schief.**
Die Windows-App schreibt alles, was sie meldet, in **`%LOCALAPPDATA%\Grimorio\logs\grimorio.log`** (füg den Ordnerteil
in die Adressleiste des Datei-Explorers ein); der Lauf davor bleibt als `grimorio.log.1` erhalten. Die ersten Zeilen
zeigen die Adresse und die Version. Häng diese Datei an, wenn du um Hilfe bittest oder ein Problem meldest.

## Deinstallieren

1. Beende Grimório.
2. Lösch den Programmordner (den, den du entpackt hast).
3. Wenn du auch deine Decks und Profile löschen willst, lösch den Datenordner (siehe
   [Wo deine Daten liegen](#wo-deine-daten-liegen)). Das lässt sich nicht rückgängig machen: Mach vorher ein Backup von
   `grimorio.db`, falls du sie später noch brauchen könntest.
