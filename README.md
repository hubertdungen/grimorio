**English** · [Português](README.pt.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Build, test and battle your Magic: The Gathering decks — with explained suggestions, real AI-vs-AI games and games you play yourself against Forge.**

Grimório is a free deck builder for every format (Commander, Modern, Pauper, Standard, Legacy, …) that runs on your
own computer. It crosses card text, real tournament decks, EDHREC data and Commander Spellbook combos to suggest cards
*and explain why*, and it plays your deck against other decks with the open-source [Forge](https://github.com/Card-Forge/forge)
rules engine so you can watch the games, read a report and improve the list.

You can also sit at the table yourself: play against Forge on Grimório's own table, run tournaments, leagues and
championships with a ranking, and open online rooms for your friends.

The interface is available in **English** (default), **Português**, **Español**, **Deutsch** and **简体中文**
(Settings › Language).

## Screenshots

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Home"></a><br><sub>Home</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Build: plain-word search in any language, deck list and suggestions"></a><br><sub>Build: plain-word search in any language, deck list and suggestions</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Suggestions by role, combos and real decks"></a><br><sub>Suggestions by role, combos and real decks</sub></td><td width="50%"><a href="docs/img/analysis.jpg"><img src="docs/img/analysis.jpg" alt="Analysis: curve, colours, opening-hand odds and how the deck wins"></a><br><sub>Analysis: curve, colours, opening-hand odds and how the deck wins</sub></td></tr>
<tr><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universe: the 3D map of every card"></a><br><sub>Universe: the 3D map of every card</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Library with covers, stars, trophies and comparison"></a><br><sub>Library with covers, stars, trophies and comparison</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseum: watch Forge play your deck, with the live stack"></a><br><sub>Coliseum: watch Forge play your deck, with the live stack</sub></td><td width="50%"><a href="docs/img/forgeplay.jpg"><img src="docs/img/forgeplay.jpg" alt="Play against Forge yourself on Grimório's table"></a><br><sub>Play against Forge yourself on Grimório's table</sub></td></tr>
<tr><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Tournaments: live podium, standings and deck origin tags"></a><br><sub>Tournaments: live podium, standings and deck origin tags</sub></td><td width="50%"><a href="docs/img/online.jpg"><img src="docs/img/online.jpg" alt="Online rooms: single games or tournaments by a public link"></a><br><sub>Online rooms: single games or tournaments by a public link</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: stars per deck and the automatic Arena"></a><br><sub>Ratings: stars per deck and the automatic Arena</sub></td><td width="50%"><a href="docs/img/table.jpg"><img src="docs/img/table.jpg" alt="At the table: life counter, 3D dice and card scanner"></a><br><sub>At the table: life counter, 3D dice and card scanner</sub></td></tr>
<tr><td width="50%"><a href="docs/img/draft.jpg"><img src="docs/img/draft.jpg" alt="Draft and Sealed: real packs, Forge bots and a tournament afterwards"></a><br><sub>Draft and Sealed: real packs, Forge bots and a tournament afterwards</sub></td><td width="50%"><a href="docs/img/sideboard.jpg"><img src="docs/img/sideboard.jpg" alt="Sideboard: answers to what you lose to in your tests"></a><br><sub>Sideboard: answers to what you lose to in your tests</sub></td></tr>
<tr><td width="50%"><a href="docs/img/freetable.jpg"><img src="docs/img/freetable.jpg" alt="Free table online: perspective, dice, chat with card mentions"></a><br><sub>Free table online: perspective, dice, chat with card mentions</sub></td><td width="50%"><a href="docs/img/teams.jpg"><img src="docs/img/teams.jpg" alt="Team tournaments: same table and Two-Headed Giant"></a><br><sub>Team tournaments: same table and Two-Headed Giant</sub></td></tr>
</table>

## Install

**Windows and Linux:** download the package from [Releases](https://github.com/hubertdungen/grimorio/releases),
unzip it and start `Grimorio.exe` (Windows) or `./grimorio` (Linux). On Windows Grimório opens in its own app window; on
Linux it opens in your browser. Step-by-step guide for everyone: **[docs/INSTALL.md](docs/INSTALL.md)**.

**Updates:** the packages update themselves. A new version downloads in the background (checked against its sha256)
and starts the next time you open Grimório; Settings › Updates turns this off. Your decks, games, tournaments and
ratings live outside the app folder and carry over to every new version, and before a new version opens the database a
copy goes to `backups/`.

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
- **Import** from TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 and Scryfall — whole profiles (as
  your decks, the community's or a friend's), custom card art and covers, sideboard and maybeboard. Search public
  Archidekt decks with filters.
- **Search in plain words, in any language** — «legendary human creatures with +1/+1 counters», «lands that draw
  cards», «terrenos que compram cartas», «抽牌的地» or Scryfall syntax (`t:`, `o:`, `mv<=`); accents optional; 35+ card
  roles (removal, draw, mill, burn, blink, stax…) to filter by.
- **Analysis dashboard** — headline numbers, mana curve by creatures vs. the rest, colour pies (what the costs ask for
  vs. what the lands make), opening-hand odds, how the deck wins and how it loses, whether the sideboard covers what
  beat it, the cards that win or get stuck in hand in real games, and a ⓘ explanation on every number.
- **3D card universe** — role regions that show what your deck is missing, each card's performance in real games with
  suggested swaps, meta archetype constellations and a lasso to find the best cards of any area.
- **Combos and synergy packages**, deck comparison (with why a similar deck rates higher: interaction, curve, lands,
  staples, goal) and duplicate detection.
- **A steady, lively Forge Play table** — fixed size scaled to the screen (landscape on PC and tablet, portrait on
  phones): zones never jump when cards arrive or the browser bar moves, and crowded rows overlap their cards. Cards glide
  between plays, dropping an aura, removal or equipment on a creature targets it, scry and surveil as two piles, library
  searches as a filterable grid, and poison ticking up on the ☠.
- **Free table online, solo and in tournaments** — games between friends only, no bots and no automatic rules: everyone
  handles their own cards like at a real table (drag, tap, counters, tokens, life, poison, energy, commander damage,
  monarch, day/night), with perspective, 3D dice you grab and throw (your friend sees the same throw from their side),
  a glowing pen that fades, and chat with @cards and #rules. Hands and libraries hidden on the server. Everyone presses
  «Ready» before starting; friends without decks sit with a lent, meta or pasted deck; join as a profile of this
  Grimório or of another one (a friend's app). Solo table to playtest decks, and free-table tournaments.
- **Mechanics in view on every table** — poison and energy, planeswalker loyalty going up and down, battles, sagas,
  double-faced and MDFC cards, flip cards, face-down cards, copies, emblems, attached auras and equipment, monarch,
  initiative, day/night, phasing, mutate and cards returning from the graveyard, all animated.
- **Real team tournaments** — 2 vs 2 at one table or Two-Headed Giant (shared life), teams balanced by format and rating,
  a fairer generator; Registry with a status panel, filters, sorting and pages, and the Hall of fame and trophy gallery
  paged too. Games against Forge count towards ratings.
- **AI assistant with memory** — each deck keeps what you asked, what the AI said and what you applied, and the AI gets
  that history; it cuts exactly the excess above 60 (or 100 in Commander).
- **Mixed tournaments** — Forge bots and people in one bracket: each deck is «played by its owner» or «by the bot»;
  bot vs bot goes to the simulator, person vs bot to Forge Play (guests too), person vs person to the free table.
- **Two-Headed Giant closer to the rules** — shared life (30), team poison losing at 15, the starting team skips its
  first draw, and replays count turns per team («Turn 9 — C», «Turn 9 — D»).
- **Cards at the size you want** — in Settings › Table, in replays and in Forge Play: automatic or 48–128 px, with lands
  at the same size; nothing leaves a player's area — when it doesn't fit, it stacks (identical lands in one ×N pile).
- **Sharper Forge Play** — targets under the stack (respond to a counter), «Activate?» before using an ability, auto-pay
  only when it's obvious, Cancel everywhere, proper blocking, touch, and the phone's back button stays in the app.
- **Infinite loops at once** — Heliod + Spike Feeder and the like use the rules' shortcut (∞ life) and an opponent with
  no other way to win concedes; Blood Moon shows nonbasic lands as Mountains; exiling mills say where the card came from.
- **White stars by performance and a trophy gallery** — up to 4★ from points and 2★ from podium performance; cups in 3
  lines and a deck view with every trophy. In Build, collapsible categories and «+ Maybeboard».
- **A livelier table** — sounds in Forge Play and on the free table (the same as in replays); in combat the table turns
  red and each blocked attacker and its blockers share a number and colour (⚔ 1 / 🛡 1) with a line between them; playmat
  patterns for your side (10, picked mid-game) that other players see online.
- **Clearer Forge Play** — every choice says what it's for («For: card and ability»); play from the top of your library
  (Courser of Kruphix, Future Sight, Oracle of Mul Daya…); Cancel on a creature's mana colour; «next game of the match»
  in Bo3/Bo5 tournaments; if Forge fails mid-game, the game ends without counting and the match waits again.
- **Tournaments and app** — rounds and matches are paged; the Android app tells you when a newer .apk is out; server
  updates wait for Forge Play games and no longer break open pages.
- **AI assistant (optional)** — keys for several providers, newest models detected automatically; it changes your deck
  directly (swaps, quantities, substitutes for any card) with one click.
- **Coliseum (Forge AI)** — AI vs AI with real rules (Bo1/Bo3, smart sideboarding, learning), 3–4 player free-for-all
  and Commander pods, an animated board with the live stack, reports and suggested improvements.
- **Play against Forge yourself** — Grimório's own table: one click lifts a card and dragging it onto the table plays it
  (or double-click; only what you can pay for lights up), the rest of your hand makes room as you hover over it, T taps
  the card under the mouse and F flips it over; Bo3/Bo5 series with sideboarding between games, and tournaments where
  you play your own deck's games; drag creatures to attack and block, arrange your side freely, the stack, choices, scry
  and library searches right in the page, Enter to pass and Shift+Enter to end the turn. Works on a server and in the
  desktop packages (no Docker); Commander uses the classic Forge window (server with Docker).
- **Tournaments, leagues and championships** — single and double elimination, Swiss, league, pods, gauntlet, king of
  the hill, groups + knockout and teams; casual with or without mixed formats; a tournament generator, live bracket,
  podium and history, champions' and podium leagues, gold/silver/bronze and platinum trophies on the winning decks,
  ranked or casual; bets with play coins (nothing to buy, no real money).
- **Ratings and ranking** — 0–6 stars per deck (Elo per format, plus a separate casual rating), white stars and trophy
  count, mine / friends / community / meta filters, hall of fame and trophy gallery, fed by tests, tournaments and an
  optional automatic Arena.
- **Online and friends** — an Online tab for single games or tournaments with a public link (a free Cloudflare tunnel
  in one click, or your own domain): whoever opens it joins with a deck of their own, no account. Friend invites,
  friends' decks as a source in tournaments and the Arena, and tags for where each deck comes from (meta, mine, friend,
  community).
- **📖 Rules library** — keywords, rules or card names in any language (camera too): Comprehensive Rules, official
  rulings and an optional AI explanation. On any screen, a mechanic in bold shows its rule on hover and opens the Rules
  in a window; mana symbols show up as symbols, not as {T}.
- **Proxies** — a list with printings for proxy sites, a ZIP of the images, or a print-ready PDF like the print shops
  ask for: paper, margins, card size, gaps, bleed (black, a colour, or the card border extended), cut guides per card,
  watermark and double-sided. The tokens your deck makes (detected, with how many of each) and Grimório's suggestions to try out can go in too.
- **At the table** — life counter (up to 6 players), 3D dice, and a card scanner (camera) with an aiming frame (on
  phones and tablets the camera opens fullscreen).
- **Default bots** — pick the Forge AI profile for your deck and for opponents in the Lab, tournaments and the Arena; a
  live bar shows what is running and jumps to the live viewer.
- **Draft and Sealed** — open real packs of any of 160 sets (Forge's own boosters): draft at a table of 8 with Forge
  bots, or watch 8 bots draft, or open 6 packs for sealed. The bots build their 40-card decks, your pool becomes a
  Limited deck in Build, and a Swiss tournament follows — Forge plays your games, or you play them yourself in Forge Play.
- **What you lose to** — the sideboard suggestions read your test games: the kinds of cards you keep losing to
  (creatures, graveyard, artifacts…) and answers in your colours that the AI can cast, the ones in real meta sideboards
  first. Cards the Forge AI never casts are flagged.
- **Deck ratings in the Analysis** — normal, all-games, objective and casual stars with Elo and games, plus trophy stars
  and every trophy won (opens the tournament).
- **Smarter Forge AI** — Grimório patches Forge where it misplayed real decks: land drops by the colours your hand needs
  (fetchlands included), Urza's Saga, the Heliod + Spike Feeder combo, Food at the right time, Maze's End wins, storm
  decks (Wish, Manamorphose), Wrath of the Skies, Path to Exile targets and aura stacking. The automatic sideboarding
  never adds cards the AI can't cast and never takes out a 4-of.
- **Live tournament viewer** — jump to the next game of the same match (or wait for it), the deck you bet on sits on
  your side of the table, and the other tournaments in progress show up next to the bets, one click away.
- **Profiles** — one install, several players, each with their own decks.
- **Installable** as a PWA on phones and tablets; touch-friendly. On a phone the live board zooms (− / + / fit),
  the screen stays on while Grimório is open (Settings › Screen) and fullscreen stays upright. If a network blocks scryfall.io (work, school), card images come through your own server instead (automatic, or Settings › Card images); so do imported decks' own images (TappedOut, Archidekt).

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
| `guests.py`, `rooms.py`, `share.py` | friends and online: invite links and guest mode, online rooms (games and tournaments), the one-click public tunnel |
| `playnet.py`, `build/forge/GrimorioNet.java` | Forge Play: the Forge bridge for your own games on Grimório's table (state, prompts and choices as JSON) |
| `rules.py`, `artfolder.py` | Comprehensive Rules search; custom card art from a folder (Drive, GitHub) |
| `deck_import.py`, `ia.py`, `play.py` | site importers, optional AI providers, play against Forge (noVNC, Docker only) |
| `build/` | data pipeline (Scryfall, embeddings, UMAP, combos, tokens, meta) |
| `web/` | React + Vite front end |
| `packaging/` | Windows/Linux desktop packages: launcher (app window, automatic updates, database backups), package and data builder |

## Roadmap

- Android app (APK) — see [docs/ROADMAP.md](docs/ROADMAP.md).
- Two editions: **Grimório Full** (with Forge Play and online play) and **Grimório Lite** (everything else, a lighter download).
- Online games between people on Grimório's table, with tournaments for you and your friends (with or against bots).
- Crossplay between the server, the desktop app and phones, an «open to the home network» switch in the desktop app
  and «join a friend's Grimório».

## Credits and legal

Card data and images: [Scryfall](https://scryfall.com) · combos: [Commander Spellbook](https://commanderspellbook.com)
· meta: [EDHREC](https://edhrec.com) and [MTGTop8](https://www.mtgtop8.com) · rules engine: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0).

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

## License

[GPL-3.0](LICENSE) — free to use, study, change and share; changes you distribute must stay open under the same license.
