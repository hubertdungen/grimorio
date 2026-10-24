[English](README.md) · [Português](README.pt.md) · [Español](README.es.md) · **Deutsch** · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Baue, teste und lass deine Magic: The Gathering-Decks gegeneinander antreten – mit erklärten Vorschlägen und echten Partien KI gegen KI.**

Grimório ist ein kostenloser Deckbuilder für alle Formate (Commander, Modern, Pauper, Standard, Legacy, …), der auf
deinem eigenen Computer läuft. Er verknüpft Kartentexte, echte Turnierdecks, EDHREC-Daten und Combos aus Commander
Spellbook, um dir Karten vorzuschlagen *und zu erklären, warum*. Außerdem spielt er dein Deck mit der Open-Source-Regelengine
[Forge](https://github.com/Card-Forge/forge) gegen andere Decks: Du kannst die Partien anschauen, einen Bericht lesen
und deine Liste verbessern.

Die Oberfläche gibt es auf **English** (Standard), **Português**, **Español**, **Deutsch** und **简体中文**
(Einstellungen › Sprache).

## Screenshots

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Startseite"></a><br><sub>Startseite</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Bauen: Deckliste, Suche und erklärte Vorschläge"></a><br><sub>Bauen: Deckliste, Suche und erklärte Vorschläge</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Vorschläge nach Rolle, Combos und echte Decks"></a><br><sub>Vorschläge nach Rolle, Combos und echte Decks</sub></td><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universum: die 3D-Karte aller Karten"></a><br><sub>Universum: die 3D-Karte aller Karten</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Kolosseum: sieh Forge dein Deck spielen"></a><br><sub>Kolosseum: sieh Forge dein Deck spielen</sub></td><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Turniere mit Tabelle und Live-Turnierbaum"></a><br><sub>Turniere mit Tabelle und Live-Turnierbaum</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: Sterne pro Deck und die automatische Arena"></a><br><sub>Ratings: Sterne pro Deck und die automatische Arena</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Bibliothek mit Covern, Sternen und Vergleich"></a><br><sub>Bibliothek mit Covern, Sternen und Vergleich</sub></td></tr>
</table>

## Installation

**Windows und Linux, ohne Docker, ohne Server-Einrichtung:** Lade das Paket unter
[Releases](https://github.com/hubertdungen/grimorio/releases) herunter, entpacke es und starte `Grimorio.exe` (Windows)
oder `./grimorio` (Linux). Dein Browser öffnet Grimório. Schritt-für-Schritt-Anleitung für alle:
**[docs/INSTALL.de.md](docs/INSTALL.de.md)**.

Beim ersten Start fragt Grimório *Wer spielt?*: Jede Person legt ein Profil mit ihrem Namen an, und ihre Decks, Tests,
Turniere und Ratings bleiben getrennt. Mehrere Leute können sich eine Installation teilen.

Du willst Grimório auf einem Heimserver für mehrere Geräte betreiben oder daran mitentwickeln? Dann lies
[Entwickler-Setup](#entwickler-setup).

## Funktionen

- **Deckbau für alle Formate** – Legalität, formatspezifische Zielwerte, Tipps zur Manabasis, Kurve, Budget, Brackets.
- **Clevere, erklärte Vorschläge** – Text-Embeddings + EDHREC + echte Decks + Combos + dein eigener Geschmack; live,
  während du baust.
- **Fang an, wie du willst** – wähle 3–10 Karten (oder einen Kommandeur) und lass das Deck vervollständigen, baue von
  Hand, importiere oder beschreibe eine Idee.
- **Import** von TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 und Scryfall – ganze Profile, eigene
  Kartenbilder und Cover, Sideboard und Maybeboard. Durchsuche öffentliche Archidekt-Decks mit Filtern.
- **3D-Kartenuniversum**, Combos und Synergiepakete, Deckvergleich und Erkennung doppelter Decks.
- **Kolosseum (Forge-KI)** – KI gegen KI mit echten Regeln (Bo1/Bo3, cleveres Sideboarding, lernend), Jeder gegen jeden
  mit 3–4 Spielern und Commander-Tische, ein animiertes Spielfeld, das du live verfolgen kannst, Berichte und
  Verbesserungsvorschläge – und du kannst selbst im Browser gegen Forge spielen (Server-Installation mit Docker).
- **Turniere** – K.-o.-System, Doppel-K.-o., Schweizer System, Liga und Tische, Live-Turnierbaum, Podium und Verlauf.
- **Ratings** – 0–6 Sterne pro Deck (Elo pro Format, dazu ein eigenes Casual-Rating), gespeist aus Tests, Turnieren und
  einer optionalen automatischen Arena.
- **Profile** – eine Installation, mehrere Spieler, jeder mit seinen eigenen Decks.
- **Installierbar** als PWA auf Handys und Tablets; touch-freundlich.

### Wie Grimório lernt

Die Vorschläge werden umso besser, je öfter du die Bots deine Decks im Kolosseum spielen lässt (Tests, Turniere und die
automatische Arena). Jede Partie hält fest, welche Karten gezogen, gewirkt oder auf der Hand stecken geblieben sind, was
jede Karte zur tatsächlichen Siegbedingung des Decks beigetragen hat (Schaden, Mill, Gift, Combo, Control …), wogegen das
Deck verloren hat und wo es in der Wertung steht (Sterne). Damit kann Grimório:

- Karten vorschlagen, die eine Antwort auf das sind, was dich schlägt;
- clevere Tausche vorschlagen – *«X gegen Y tauschen»* samt Begründung, basierend auf Siegbeitrag, Nutzung,
  Mana-Effizienz, Rolle in Combos/Synergien und Preis;
- den Sideboard-Plan zwischen den Spielen anpassen;
- das Rating jedes Decks aktualisieren.

> **Tipp:** Spiel ein paar Bo3-Serien gegen Meta-Decks (oder lass die Arena über Nacht laufen), bevor du dich auf die
> Vorschläge verlässt – 10+ Partien pro Deck sind ein guter Anfang.

## Entwickler-Setup

Linux (getestet unter Ubuntu 24.04), **Python 3.10+**, **Node.js 20+**, ~4 GB freier RAM für die Partien, ~2 GB
Speicherplatz. Forge läuft in **Docker**, wenn es installiert ist (Standard auf einem Linux-Server), oder auf einem lokalen
**Java 17** (`GRIMORIO_RUNTIME=local`, `GRIMORIO_JAVA=/path/to/java`). Der Daten-Build läuft in Docker.

```bash
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio

# 1. Forge 2.0.15 (rules engine): download "forge-installer-2.0.15.tar.bz2" from
#    https://github.com/Card-Forge/forge/releases/tag/forge-2.0.15 and extract it to ~/.local/share/grimorio/forge
mkdir -p ~/.local/share/grimorio/forge && tar -xjf forge-installer-2.0.15.tar.bz2 -C ~/.local/share/grimorio/forge

# 2. Card data (Scryfall + Commander Spellbook, embeddings, 3D map). Takes ~45 min the first time.
build/build.sh
python3 build/meta_mtgtop8.py --max-decks 400      # optional: recent tournament decks for the meta

# 3. Build the web app, compile the Forge launcher and install to ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 4. Run it and open http://localhost:8107
python3 ~/.local/share/grimorio/app/server.py --port 8107
```

Optionen: `--host`, `--port`, `--data-dir` (oder `GRIMORIO_DATA_DIR`), `--owner` (oder `GRIMORIO_OWNER`: ein fester,
einziger Benutzer). Ohne `--owner` läuft der Server im Profilmodus; hinter einem Login-Proxy kommt der Benutzer aus dem
Header `Remote-User`.

Forge-Laufzeit: `GRIMORIO_RUNTIME=docker|local` (Standard: docker, wenn der Befehl `docker` existiert, außer unter
Windows), `GRIMORIO_JAVA` (Java-Programmdatei), `GRIMORIO_FORGE_DIR` (Standard `<data>/forge`). Die lokale Laufzeit
erwartet, dass Grimórios KI-Profile und Kartenskripte (`forge-ext/ai`, `forge-ext/cardsfolder`) in den Forge-Ordner
kopiert wurden; die Pakete erledigen das. Desktop-Pakete: `packaging/build.py` und `.github/workflows/release.yml`.

## Projektstruktur

| Pfad | Was |
|---|---|
| `server.py` | HTTP-Server nur mit der Standardbibliothek: API, Decks (SQLite), Profile, Importe, Proxys |
| `sim.py`, `build/forge/` | Forge-Runner (Docker oder lokales Java) und der Launcher `GrimorioSim` (exakte Spielereignisse, KI-Anpassungen, KI-Hinweise pro Karte) |
| `tournament.py`, `ratings.py` | Turniere und Ratings / Arena |
| `deck_import.py`, `ia.py`, `play.py` | Importer für Websites, optionale KI-Anbieter, gegen Forge spielen (noVNC, nur Docker) |
| `build/` | Daten-Pipeline (Scryfall, Embeddings, UMAP, Combos, Spielsteine, Meta) |
| `web/` | Frontend mit React + Vite |
| `packaging/` | Desktop-Pakete für Windows/Linux: Launcher, Paket- und Daten-Builder |

## Roadmap

- Android-App – siehe [docs/ROADMAP.md](docs/ROADMAP.md) (auf Englisch).
- Selbst gegen Forge spielen ohne Docker (Desktop-Pakete).

## Credits und Rechtliches

Kartendaten und -bilder: [Scryfall](https://scryfall.com) · Combos: [Commander Spellbook](https://commanderspellbook.com)
· Meta: [EDHREC](https://edhrec.com) und [MTGTop8](https://www.mtgtop8.com) · Regelengine: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0).

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

*Grimório ist inoffizieller Fan-Content, der gemäß der Fan Content Policy von Wizards of the Coast erlaubt ist. Nicht von
Wizards genehmigt oder unterstützt. Teile der verwendeten Materialien sind Eigentum von Wizards of the Coast. © Wizards of
the Coast LLC.*

## Lizenz

[GPL-3.0](LICENSE) – frei nutzbar, untersuchbar, veränderbar und weitergebbar; Änderungen, die du weitergibst, müssen
unter derselben Lizenz offen bleiben.
