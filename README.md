**English** · [Português](README.pt.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**Build, test and battle your Magic: The Gathering decks — with explained suggestions, real AI-vs-AI games and games you play yourself against Forge.**

Grimório is a free deck builder for every format (Commander, Modern, Pauper, Standard, Legacy, …) that runs on your
own computer. It crosses card text, real tournament decks, EDHREC data and Commander Spellbook combos to suggest cards
*and explain why*, and it plays your deck against other decks with the open-source [Forge](https://github.com/Card-Forge/forge)
rules engine so you can watch the games, read a report and improve the list.

You can also sit at the table yourself: play against Forge on Grimório's own table or against your friends with every
rule enforced, run tournaments, leagues and championships with a ranking, and open online rooms and a Tavern for your
friends — on a PC, a tablet or a phone.

The interface is available in **English** (default), **Português**, **Español**, **Deutsch** and **简体中文**
(Settings › Language).

## Screenshots

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="Home"></a><br><sub>Home</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="Build: plain-word search in any language, deck list and suggestions"></a><br><sub>Build: plain-word search in any language, deck list and suggestions</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="Suggestions by role, combos and real decks"></a><br><sub>Suggestions by role, combos and real decks</sub></td><td width="50%"><a href="docs/img/analysis.jpg"><img src="docs/img/analysis.jpg" alt="Analysis: curve, colours, opening-hand odds and how the deck wins"></a><br><sub>Analysis: curve, colours, opening-hand odds and how the deck wins</sub></td></tr>
<tr><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="Universe: the 3D map of every card"></a><br><sub>Universe: the 3D map of every card</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="Library with covers, stars, trophies and comparison"></a><br><sub>Library with covers, stars, trophies and comparison</sub></td></tr>
<tr><td width="50%"><a href="docs/img/sideboard.jpg"><img src="docs/img/sideboard.jpg" alt="Sideboard: answers to what you lose to in your tests"></a><br><sub>Sideboard: answers to what you lose to in your tests</sub></td><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="Ratings: stars per deck and the automatic Arena"></a><br><sub>Ratings: stars per deck and the automatic Arena</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="Coliseum: watch Forge play your deck, with the live stack"></a><br><sub>Coliseum: watch Forge play your deck, with the live stack</sub></td><td width="50%"><a href="docs/img/forgeplay.jpg"><img src="docs/img/forgeplay.jpg" alt="Play against Forge yourself: combat with numbered blocks"></a><br><sub>Play against Forge yourself: combat with numbered blocks</sub></td></tr>
<tr><td width="50%"><a href="docs/img/stack.jpg"><img src="docs/img/stack.jpg" alt="Clear requests: Oblivion Ring's target, «yours» / «theirs» tags and the numbered stack"></a><br><sub>Clear requests: Oblivion Ring's target, «yours» / «theirs» tags and the numbered stack</sub></td><td width="50%"><a href="docs/img/multiplayer.jpg"><img src="docs/img/multiplayer.jpg" alt="Two-Headed Giant against Forge: player drawers and the team orb"></a><br><sub>Two-Headed Giant against Forge: player drawers and the team orb</sub></td></tr>
<tr><td width="50%"><a href="docs/img/draft.jpg"><img src="docs/img/draft.jpg" alt="Draft and Sealed: real packs, Forge bots and a tournament afterwards"></a><br><sub>Draft and Sealed: real packs, Forge bots and a tournament afterwards</sub></td><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="Tournaments: podium, bracket and deck origin tags"></a><br><sub>Tournaments: podium, bracket and deck origin tags</sub></td></tr>
<tr><td width="50%"><a href="docs/img/live.jpg"><img src="docs/img/live.jpg" alt="Live tournament: progress, games being played and the latest results"></a><br><sub>Live tournament: progress, games being played and the latest results</sub></td><td width="50%"><a href="docs/img/history.jpg"><img src="docs/img/history.jpg" alt="Tournament history as a gallery (grid or list) and the Hall of fame"></a><br><sub>Tournament history as a gallery (grid or list) and the Hall of fame</sub></td></tr>
<tr><td width="50%"><a href="docs/img/teams.jpg"><img src="docs/img/teams.jpg" alt="Team tournaments: team podium and standings"></a><br><sub>Team tournaments: team podium and standings</sub></td><td width="50%"><a href="docs/img/online.jpg"><img src="docs/img/online.jpg" alt="Online: create a room — free or strict table, 2–4 players, your deck"></a><br><sub>Online: create a room — free or strict table, 2–4 players, your deck</sub></td></tr>
<tr><td width="50%"><a href="docs/img/freetable.jpg"><img src="docs/img/freetable.jpg" alt="Free table online: perspective, dice, chat with card mentions"></a><br><sub>Free table online: perspective, dice, chat with card mentions</sub></td><td width="50%"><a href="docs/img/taverna.jpg"><img src="docs/img/taverna.jpg" alt="The Tavern: friends online, chat with @mentions and shared decks"></a><br><sub>The Tavern: friends online, chat with @mentions and shared decks</sub></td></tr>
<tr><td width="50%"><a href="docs/img/halloffame.jpg"><img src="docs/img/halloffame.jpg" alt="Tavern Hall of Fame: podium, highlights and standings between friends"></a><br><sub>Tavern Hall of Fame: podium, highlights and standings between friends</sub></td><td width="50%"><a href="docs/img/table.jpg"><img src="docs/img/table.jpg" alt="At the table: life counter, 3D dice and card scanner"></a><br><sub>At the table: life counter, 3D dice and card scanner</sub></td></tr>
<tr><td colspan="2"><a href="docs/img/mobile.jpg"><img src="docs/img/mobile.jpg" alt="On a phone: the compact Forge Play table, the Tavern and a live tournament"></a><br><sub>On a phone: the compact Forge Play table, the Tavern and a live tournament</sub></td></tr>
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
  They follow your deck's plan (tribes, enchantments, artifacts, counters, tokens…) and each one says which of your
  cards it feeds, which gap it fills or which combo it completes.
- **Start your way** — pick 3–10 cards (or a commander) and let it complete the deck, build by hand, import, or describe an idea.
- **Import** from TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8 and Scryfall — whole profiles (as
  your decks, the community's or a friend's), custom card art and covers, sideboard and maybeboard. Search public
  Archidekt decks with filters. *Export / Import decks* in the Library takes out all your decks or a selection (a
  Grimório file with covers, art, sideboard and notes, or .txt lists) and brings in several files at once (.txt, .dek,
  .csv, .zip or pasted lists), with a preview before anything is saved.
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
  phones): zones never jump when cards arrive or the browser bar moves, and crowded rows split into extra lines (up to 4
  per side) at the card size you chose. Cards glide
  between plays, dropping an aura, removal or equipment on a creature targets it, scry and surveil as two piles, library
  searches as a filterable grid, and poison ticking up on the ☠.
- **Free table online, solo and in tournaments** — games between friends where everyone handles their own cards like at
  a real table (drag, tap, counters, tokens and token copies of any card, notes on cards, life, poison, energy,
  commander damage, monarch, day/night). Turn phases with an automatic untap and draw, spells with targets on a shared
  stack (drag a Counterspell onto the spell), blocks dragged onto attackers, attacks on planeswalkers and battles, real
  power/toughness from equipment, auras and anthems, library search and a secret look at another player's hand.
  Perspective, 3D dice you grab and throw (your friend sees the same throw from their side), a glowing pen whose tail
  fades, each player's cursor as a small hand in their colour, and chat with @cards and #rules. Hands and libraries
  hidden on the server. Before the game, a 3D lobby with everyone's deck boxes and a coin toss; sideboarding between
  games of a series; Two-Headed Giant for four. Friends without decks sit with a lent, meta or pasted deck. Solo table
  to playtest decks, and free-table tournaments.
- **Strict table between people** — open a room as *Strict* and Forge enforces every rule (mana, the stack, combat,
  targets) while each player sees the table on their own screen, like in Play against Forge: 1 vs 1, 3–4 player
  free-for-all or Two-Headed Giant, in rooms, in the Tavern and in tournaments (marked ⚖). The winner of the coin toss
  chooses to play or draw, and whoever leaves a decision pending for 5 minutes loses the game, so tables keep moving.
- **Mechanics in view on every table** — poison and energy, planeswalker loyalty going up and down, battles, sagas,
  double-faced and MDFC cards, flip cards, face-down cards, copies, emblems, attached auras and equipment, monarch,
  initiative, day/night, phasing, mutate and cards returning from the graveyard, all animated.
- **Real team tournaments** — 2 vs 2 at one table or Two-Headed Giant (shared life), teams balanced by format and rating,
  a fairer generator. Games against Forge count towards ratings.
- **AI assistant with memory** — each deck keeps what you asked, what the AI said and what you applied, and the AI gets
  that history; it cuts exactly the excess above 60 (or 100 in Commander).
- **Mixed tournaments** — Forge bots and people in one bracket: each deck is «played by its owner» or «by the bot»;
  bot vs bot goes to the simulator, person vs bot to Forge Play (guests too), person vs person to the free table or the
  strict table.
- **Two-Headed Giant closer to the rules** — shared life (30), team poison losing at 15, the starting team skips its
  first draw, and replays count turns per team («Turn 9 — C», «Turn 9 — D»).
- **Cards at the size you want** — in Settings › Table, in replays and in Forge Play: automatic or 48–128 px, with lands
  at the same size; nothing leaves a player's area — when it doesn't fit, it stacks (identical lands in one ×N pile).
- **Clear, sharp Forge Play** — every request says in plain words what to do («Choose the creature Rancor will
  enchant») and shows the card asking, framed red when the effect harms the chosen card and green when it helps; a
  numbered stack (1 resolves next) shows each item's target and controller; picking your own card for a harmful effect
  asks «This card is yours — exile it anyway?». Targets under the stack, «Activate?» before an ability, auto-pay only
  when it's obvious, Cancel everywhere, proper blocking; drop a card on a creature or on a player's orb to target it, and
  an attacker on a planeswalker or battle to attack it. Play from the top of your library (Courser of Kruphix, Future
  Sight…), name cards with a search box, see revealed cards as images, and sideboard between games on a screen with
  card images. A 3D coin with each player's face decides who starts, and from game 2 of a series the loser of the
  previous game chooses; an optional tournament clock gives you a few seconds to respond (S for extra time). If Forge
  fails mid-game, the game ends without counting and the match waits again; the phone's back button stays in the app.
- **Infinite loops at once** — Heliod + Spike Feeder and the like use the rules' shortcut (∞ life) and an opponent with
  no other way to win concedes; Blood Moon shows nonbasic lands as Mountains; exiling mills say where the card came from.
- **White stars by performance and a trophy gallery** — up to 4★ from points and 2★ from podium performance; cups in 3
  lines and a deck view with every trophy. In Build, collapsible categories and «+ Maybeboard».
- **A livelier table** — damage you can read (⚔ dealt, ✕ taken, ↠ trample), hits that fly from the source to the target
  in the attacker's style (claws, fire, lightning…) and shake the table, cards that crack and shatter, dissolve into
  exile or get drawn into the permanent that keeps them, mana flying from the land to the spell, entrances for special
  lands (fetch, shock, legendary, any-colour…) and keywords in action (haste, reach, deathtouch, summoning sickness).
  Sounds with a volume for each kind; in combat the table turns red and each blocked attacker and its blockers share a
  number and colour (⚔ 1 / 🛡 1) with a line between them; playmat patterns for your side (10, picked mid-game) that
  other players see online.
- **The life orb** — your life is a 3D glass orb with a particle fluid inside: its matter follows the mana on your
  battlefield (golden light, water, swamp, lava, green, metal), its level follows your life, hits spill blood and leave
  the attacker's colour, and poison, graveyard, exile, auras and a library running out all show in it. It breaks in a
  way that matches how you lost. Grab it and throw it (orbs collide, and online everyone sees it move); teams and
  Two-Headed Giant share one team orb. Rest the mouse on it to open *Inside the orb*, with charts of what weighs on it.
  Styles, size and quality in Settings, and a classic orb for lighter devices.
- **Updates and app** — the Windows and Linux packages update themselves, with a notice on screen; the Android app tells
  you when a newer .apk is out; server updates wait for Forge Play games and keep open pages working.
- **AI assistant (optional)** — keys for several providers, newest models detected automatically; it changes your deck
  directly (swaps, quantities, substitutes for any card) with one click.
- **Coliseum (Forge AI)** — AI vs AI with real rules (Bo1/Bo3, smart sideboarding, learning), 3–4 player free-for-all
  and Commander pods, an animated board with the live stack, reports and suggested improvements.
- **Play against Forge yourself** — Grimório's own table: one click lifts a card and dragging it onto the table plays it
  (or double-click; only what you can pay for lights up), the rest of your hand makes room as you hover over it, T taps
  the card under the mouse and F flips it over; Bo3/Bo5 series with sideboarding between games, and tournaments where
  you play your own deck's games; drag creatures to attack and block, arrange your side freely, the stack, choices, scry
  and library searches right in the page, Enter to pass and Shift+Enter (or Shift+Space) to end the turn. On touch
  screens a tap on a card opens «Play», and the response clock pauses while you choose. Works on a server and in the
  desktop packages (no Docker); Commander uses the classic Forge window (server with Docker).
- **Replays of every game** — the tournament games people play (in Forge Play, at the strict table or at the free
  table) can be watched again with ▶, and **My games** keeps your last 60 games against Forge plus the free-table games
  of your rooms, with wins and losses from your seat. The opponent's hand stays hidden.
- **Tournaments, leagues and championships** — single and double elimination, Swiss, league, pods, gauntlet, king of
  the hill, groups + knockout and teams; casual with or without mixed formats; a tournament generator, live bracket,
  podium and history, champions' and podium leagues, gold/silver/bronze and platinum trophies on the winning decks,
  ranked or casual; bets with play coins (nothing to buy, no real money). Creating one takes three steps (format and
  system, decks, summary); the live view shows the progress, what's playing now, when it's your turn, the latest results
  with replays and your deck's path through the bracket; the history is a gallery with search, filters and a grid or
  list view.
- **Ratings and ranking** — 0–6 stars per deck (Elo per format, plus a separate casual rating), white stars and trophy
  count, mine / friends / community / meta filters, hall of fame and trophy gallery, fed by tests, tournaments and an
  optional automatic Arena.
- **Online and friends** — the Online tab has **＋ Create room** (with friends, with Forge bots or solo; free or strict
  table, 2–4 players, Two-Headed Giant) and **🔗 Join with a link**. Each room has an invite block with the link, Copy,
  Share and a QR code, and the Share panel opens Grimório to the internet with a free Cloudflare tunnel in one click (or
  your own address). Whoever opens the link joins with a deck of their own, no account, in the browser or in their own
  Grimório app (Windows, Linux, Android) with their own decks and settings; invite pages open in the visitor's
  language. Any install can host, the desktop packages included. Friend invites with a link and QR, friends' decks as a
  source in tournaments and the Arena, and tags for where each deck comes from (meta, mine, friend, community).
- **The Tavern** — a place for your friends in Coliseum › Tavern, hosted on your own Grimório: members join with an
  invite link or QR and see who's online or playing, in a chat with @mentions, #deck cards you can open and copy,
  reactions, replies, pinned messages and «Propose a game». Members open free or strict tables right there and the host
  runs tournaments among them; the Shelf holds decks to view, copy or play against, laid out on a 3D table; the Hall of
  Fame keeps the podium, standings and recent results, counting the games played in the Tavern's rooms by itself (paper
  games can be added by hand). The host can close it (read-only) or delete it.
- **📖 Rules library** — keywords, rules or card names in any language (camera too): Comprehensive Rules, official
  rulings and an optional AI explanation. On any screen, a mechanic in bold shows its rule on hover and opens the Rules
  in a window; mana symbols show up as symbols, not as {T}. Rules also holds the interactive **Grimório guide**: every
  area and its real toolbar explained, the table gestures with your own keys, what the life orb shows, and six
  step-by-step walkthroughs. In Forge Play, «📖 Quick rules» answers as you type.
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
- **A table for phones and tablets** — in a game the table fills the screen in both orientations, with bigger cards:
  the header and the side column go into drawers, and one bar holds the prompt, mana, OK / End turn and the clock. In
  touch mode press-and-hold does what right-click or hover does on a computer, and Settings and the guide list the
  touch gestures. Tables of 3–4 players use drawers: you and one opponent at full size, a chip per opponent with life,
  hand and ⚔ when they attack you, a view that switches by itself when you're attacked or must target someone, and ⊞
  to see everyone (on PC too, if you like).
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
- An «open to the home network» switch in the desktop app.

## Credits and legal

Card data and images: [Scryfall](https://scryfall.com) · combos: [Commander Spellbook](https://commanderspellbook.com)
· meta: [EDHREC](https://edhrec.com) and [MTGTop8](https://www.mtgtop8.com) · rules engine: [Forge](https://github.com/Card-Forge/forge) (GPL-3.0).

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

## License

[GPL-3.0](LICENSE) — free to use, study, change and share; changes you distribute must stay open under the same license.
