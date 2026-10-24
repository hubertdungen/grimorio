# Grimório

**Build, test and battle your Magic: The Gathering decks — with explained suggestions and real AI-vs-AI games.**

Grimório is a free, self-hosted deck builder for every format (Commander, Modern, Pauper, Standard, Legacy, …). It
crosses card text, real tournament decks, EDHREC data and Commander Spellbook combos to suggest cards *and explain
why*, and it plays your deck against other decks with the open-source [Forge](https://github.com/Card-Forge/forge)
rules engine so you can watch the games, read a report and improve the list.

> The interface is in Portuguese (pt-PT) today; English as the default language with a language setting is the next
> milestone (see *Roadmap*).

## Features

- **Deck building for every format** — legality, format-specific targets, mana base advice, curve, budget, brackets.
- **Smart, explained suggestions** — text embeddings + EDHREC + real decks + combos + your own taste; live while you build.
- **Start your way** — pick 3–10 cards (or a commander) and let it complete the deck, build by hand, import, or describe an idea.
- **Import** from TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 and Scryfall — whole profiles,
  custom card art and covers, sideboard and maybeboard. Search public Archidekt decks with filters.
- **3D card universe**, combos and synergy packages, deck comparison and duplicate detection.
- **Coliseum (Forge AI)** — AI vs AI with real rules (Bo1/Bo3, smart sideboarding, learning), 3–4 player free-for-all
  and Commander pods, an animated board you can watch live, reports and suggested improvements, and play against
  Forge yourself in the browser.
- **Tournaments** — single/double elimination, Swiss, league and pods, live bracket, podium and history.
- **Ratings** — 0–6 stars per deck (Elo per format, plus a separate casual rating) fed by tests, tournaments and an
  optional automatic Arena.
- **Installable** as a PWA on phones and tablets; touch-friendly.

## Requirements (current manual setup)

- Linux (tested on Ubuntu 24.04), **Python 3.10+**, **Node.js 20+**, **Docker** (the Forge games and the data build
  run in containers), ~4 GB free RAM for games, ~2 GB disk.

## Quick start (Linux)

```bash
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio

# 1. Forge 2.0.15 (rules engine): download "forge-gui-desktop-2.0.15.tar.bz2" from
#    https://github.com/Card-Forge/forge/releases and extract it to ~/.local/share/grimorio/forge
mkdir -p ~/.local/share/grimorio/forge && tar -xjf forge-gui-desktop-2.0.15.tar.bz2 -C ~/.local/share/grimorio/forge

# 2. Card data (Scryfall + Commander Spellbook, embeddings, 3D map). Takes ~45 min the first time.
build/build.sh
python3 build/meta_mtgtop8.py --max-decks 400      # optional: recent tournament decks for the meta

# 3. Build the web app, compile the Forge launcher and install to ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 4. Run it and open http://localhost:8107
python3 ~/.local/share/grimorio/app/server.py --port 8107
```

Options: `--host`, `--port`, `--data-dir` (or `GRIMORIO_DATA_DIR`), `--owner` (or `GRIMORIO_OWNER`, the default
user when there is no login proxy; behind a proxy the user comes from the `Remote-User` header).

## Project layout

| Path | What |
|---|---|
| `server.py` | stdlib HTTP server: API, decks (SQLite), imports, proxies |
| `sim.py`, `build/forge/` | Forge runner and the `GrimorioSim` launcher (exact game events, AI tweaks, card AI hints) |
| `tournament.py`, `ratings.py` | tournaments and ratings / Arena |
| `deck_import.py`, `ia.py`, `play.py` | site importers, optional AI providers, play against Forge (noVNC) |
| `build/` | data pipeline (Scryfall, embeddings, UMAP, combos, tokens, meta) |
| `web/` | React + Vite front end |

## Roadmap

- English by default, Portuguese (pt-PT) selectable in Settings; a Settings page (parallel Forge games with a
  suggestion based on the RAM available right now, language, …).
- One-click packages for **Windows** and **Linux** (no Docker, no server setup), with beginner-friendly instructions.
- Android app (deck building offline; Coliseum through a computer running Grimório).

## Credits and legal

Card data and images: [Scryfall](https://scryfall.com) · combos: [Commander Spellbook](https://commanderspellbook.com)
· meta: [EDHREC](https://edhrec.com) and [MTGTop8](https://www.mtgtop8.com) · rules engine: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0).

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

## License

[GPL-3.0](LICENSE) — free to use, study, change and share; changes you distribute must stay open under the same license.
