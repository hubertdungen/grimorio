**English** · [Português](README.pt.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Build, test and battle your Magic: The Gathering decks — with explained suggestions and real AI-vs-AI games.**

Grimório is a free deck builder for every format (Commander, Modern, Pauper, Standard, Legacy, …) that runs on your
own computer. It crosses card text, real tournament decks, EDHREC data and Commander Spellbook combos to suggest cards
*and explain why*, and it plays your deck against other decks with the open-source [Forge](https://github.com/Card-Forge/forge)
rules engine so you can watch the games, read a report and improve the list.

The interface is available in **English** (default), **Português**, **Español**, **Deutsch** and **简体中文**
(Settings › Language).

## Screenshots

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Home"></a><br><sub>Home</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Build: deck list, search and explained suggestions"></a><br><sub>Build: deck list, search and explained suggestions</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Suggestions by role, combos and real decks"></a><br><sub>Suggestions by role, combos and real decks</sub></td><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universe: the 3D map of every card"></a><br><sub>Universe: the 3D map of every card</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseum: watch Forge play your deck"></a><br><sub>Coliseum: watch Forge play your deck</sub></td><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Tournaments with standings and a live bracket"></a><br><sub>Tournaments with standings and a live bracket</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: stars per deck and the automatic Arena"></a><br><sub>Ratings: stars per deck and the automatic Arena</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Library with covers, stars and comparison"></a><br><sub>Library with covers, stars and comparison</sub></td></tr>
</table>

## Install

**Windows and Linux, no Docker, no server setup:** download the package from
[Releases](https://github.com/hubertdungen/grimorio/releases), unzip it and start `Grimorio.exe` (Windows) or
`./grimorio` (Linux). Your browser opens Grimório. Step-by-step guide for everyone: **[docs/INSTALL.md](docs/INSTALL.md)**.

On the first start Grimório asks *who's playing*: each person creates a profile with their name, and their decks,
tests, tournaments and ratings stay separate. Several people can share one install.

Running it on a home server for every device in the house: [Your own Linux server](#your-own-linux-server-docker). Developing it: [Developer setup](#developer-setup).

## Your own Linux server (Docker)

Run Grimório on a home server (a mini PC, an old laptop, a NAS with Linux) and open it from every phone, tablet and
computer in the house. The Coliseum runs Forge in **Docker**, and *Play against Forge* works in the browser. Made on
Ubuntu 24.04 (other recent Debian/Ubuntu should work); needs ~4 GB of free RAM for games and ~3 GB of disk.

```bash
# 1. Git, Python, Node.js 22 and Docker
sudo apt update && sudo apt install -y git python3 bzip2 curl unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # then log out and back in

# 2. Grimório
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio
D=~/.local/share/grimorio && mkdir -p $D/forge

# 3. Forge 2.0.15 (the rules engine)
curl -L https://github.com/Card-Forge/forge/releases/download/forge-2.0.15/forge-installer-2.0.15.tar.bz2 | tar -xj -C $D/forge

# 4. Card data, ready-made from the latest release (or build it yourself with build/build.sh, ~45 min)
curl -L -o /tmp/grimorio-data.zip https://github.com/hubertdungen/grimorio/releases/latest/download/grimorio-data.zip
unzip -o /tmp/grimorio-data.zip -d $D

# 5. Build the web app and install it in ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 6. Start it, then open http://SERVER-IP:8107 on any device in the house
python3 $D/app/server.py --host 0.0.0.0 --port 8107
```

**Start it with the server** (systemd user service):

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
sudo loginctl enable-linger $USER   # keeps it running after you log out
```

- **Who plays:** by default every person picks or creates a profile («Who's playing?»). For one single user, add
  `--owner yourname`.
- **Outside the house:** never open port 8107 to the internet as it is. Put it behind a login (a reverse proxy such as
  Caddy + Authelia, Cloudflare Tunnel with Access, or Tailscale); the login user arrives in the `Remote-User` header and
  each person gets their own decks.
- **Updating:** `cd grimorio && git pull && ./deploy.sh`, then `systemctl --user restart grimorio`.
- **Backups:** see the next section.

## Backups and cloud sync

Everything you create lives in your own install (`grimorio.db` in the data folder). Two optional ways to keep it safe,
both free and both in **Settings › Data & backups**:

- **Export everything** downloads one `.grimorio` file (decks, profiles, tests, tournaments, bets, ratings and your deck
  covers). **Import** puts it back: it *merges* by default (nothing is lost, the newest version of each deck wins) or
  *replaces* everything; your current data is always saved next to it first (`grimorio.db.before-import-…`).
- **Sync with a cloud folder** keeps several computers in step through any free app that syncs a folder. Grimório always
  works on its local copy, so it works offline (on a plane, say): the app uploads and downloads the changes when you're
  back online. Each computer writes only its own file in that folder and merges the others' files.

| Free app | Free space | Account | Windows / macOS / Linux / Android |
|---|---|---|---|
| Google Drive for desktop | 15 GB (shared with Gmail) | Google | ✓ / ✓ / — (use Syncthing or Nextcloud) / app |
| OneDrive | 5 GB | Microsoft | ✓ (built in) / ✓ / unofficial client / app |
| Dropbox | 2 GB | Dropbox | ✓ / ✓ / ✓ / app |
| Syncthing | unlimited (no cloud: your devices sync directly) | none | ✓ / ✓ / ✓ / Syncthing-Fork |
| Nextcloud | depends on the provider, or your own server | Nextcloud | ✓ / ✓ / ✓ / app |
| iCloud Drive | 5 GB | Apple | iCloud for Windows / ✓ / — / — |

**Google Drive in 3 steps.** 1) Install *Google Drive for desktop* and sign in (Windows shows a `G:` drive with
*My Drive*). 2) In Grimório: Settings › Data & backups › tick *Sync with a cloud folder*, pick the *Google Drive*
suggestion (`G:\My Drive\Grimorio`) and press *Use this folder*. 3) On your other computer, same Google account, same
folder. Done.

**Syncthing in 3 steps** (no account, nothing in anyone's cloud). 1) Install Syncthing on both devices
([syncthing.net](https://syncthing.net); Android: *Syncthing-Fork*). 2) Add each device to the other and share one
folder, e.g. `~/Sync/Grimorio`. 3) Choose that folder in Grimório on both. The devices sync whenever both are on.

When the same deck was changed on two computers between syncs, the newest wins and the other one is kept as
*«name (conflito)»* — you never lose a version. A tournament that's still running arrives paused on the other computer
(only one plays it at a time). On a server with a login, each person exports and imports only their own data; folder
sync is for computers and single-owner servers.

## Features

- **Deck building for every format** — legality, format-specific targets, mana base advice, curve, budget, brackets.
- **Smart, explained suggestions** — text embeddings + EDHREC + real decks + combos + your own taste; live while you build.
- **Start your way** — pick 3–10 cards (or a commander) and let it complete the deck, build by hand, import, or describe an idea.
- **Import** from TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 and Scryfall — whole profiles,
  custom card art and covers, sideboard and maybeboard. Search public Archidekt decks with filters.
- **3D card universe** — role regions that show what your deck is missing, each card's performance in real games with
  suggested swaps, meta archetype constellations and a lasso to find the best cards of any area.
- **Combos and synergy packages**, deck comparison and duplicate detection.
- **Coliseum (Forge AI)** — AI vs AI with real rules (Bo1/Bo3, smart sideboarding, learning), 3–4 player free-for-all
  and Commander pods, an animated board you can watch live, reports and suggested improvements, and play against
  Forge yourself in the browser (server install with Docker).
- **Tournaments** — single/double elimination, Swiss, league and pods, live bracket, podium and history; bets with
  play coins (nothing to buy, no real money) and trophies on the decks that win.
- **Ratings** — 0–6 stars per deck (Elo per format, plus a separate casual rating) fed by tests, tournaments and an
  optional automatic Arena.
- **Profiles** — one install, several players, each with their own decks.
- **Installable** as a PWA on phones and tablets; touch-friendly.

### How Grimório learns

The suggestions get better the more you let the bots play your decks in the Coliseum (tests, tournaments and the
automatic Arena). Every game records which cards were drawn, cast or stayed stuck in hand, what each card contributed
to the deck's actual win condition (damage, mill, poison, combo, control…), what beat the deck, and how the deck ranks
(stars). With that, Grimório:

- suggests cards that answer what beats you;
- proposes smart swaps — *«swap X for Y»* with the reason, based on win contribution, usage, mana efficiency,
  combo/synergy role and price;
- adjusts the sideboard plan between games;
- updates each deck's rating.

> **Tip:** run a few Bo3 series against meta decks (or leave the Arena on overnight) before trusting the suggestions —
> 10+ games per deck is a good start.

## Developer setup

Linux (tested on Ubuntu 24.04), **Python 3.10+**, **Node.js 20+**, ~4 GB free RAM for games, ~2 GB disk. Forge runs
in **Docker** when it is installed (the default on a Linux server) or on a local **Java 17** (`GRIMORIO_RUNTIME=local`,
`GRIMORIO_JAVA=/path/to/java`). The data build runs in Docker.

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

Options: `--host`, `--port`, `--data-dir` (or `GRIMORIO_DATA_DIR`), `--owner` (or `GRIMORIO_OWNER`: a fixed single
user). Without `--owner` the server runs in profiles mode; behind a login proxy the user comes from the `Remote-User`
header.

Forge runtime: `GRIMORIO_RUNTIME=docker|local` (default: docker when the `docker` command exists, except on Windows),
`GRIMORIO_JAVA` (java executable), `GRIMORIO_FORGE_DIR` (default `<data>/forge`). The local runtime expects Grimório's
AI profiles and card scripts (`forge-ext/ai`, `forge-ext/cardsfolder`) copied into the Forge folder; the packages do
this. Desktop packages: `packaging/build.py` and `.github/workflows/release.yml`.

## Project layout

| Path | What |
|---|---|
| `server.py` | stdlib HTTP server: API, decks (SQLite), profiles, imports, proxies |
| `backup.py` | export/import `.grimorio` backups and the optional cloud-folder sync (merge rules, ratings rebuild) |
| `sim.py`, `build/forge/` | Forge runner (Docker or local Java) and the `GrimorioSim` launcher (exact game events, AI tweaks, card AI hints) |
| `tournament.py`, `ratings.py` | tournaments and ratings / Arena |
| `deck_import.py`, `ia.py`, `play.py` | site importers, optional AI providers, play against Forge (noVNC, Docker only) |
| `build/` | data pipeline (Scryfall, embeddings, UMAP, combos, tokens, meta) |
| `web/` | React + Vite front end |
| `packaging/` | Windows/Linux desktop packages: launcher, package and data builder |

## Roadmap

- Android app — see [docs/ROADMAP.md](docs/ROADMAP.md).
- Play against Forge yourself without Docker (desktop packages).

## Credits and legal

Card data and images: [Scryfall](https://scryfall.com) · combos: [Commander Spellbook](https://commanderspellbook.com)
· meta: [EDHREC](https://edhrec.com) and [MTGTop8](https://www.mtgtop8.com) · rules engine: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0).

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

## License

[GPL-3.0](LICENSE) — free to use, study, change and share; changes you distribute must stay open under the same license.
