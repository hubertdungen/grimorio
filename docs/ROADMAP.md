# Roadmap notes

## Android app — feasibility

**Today.** The web app is already an installable PWA: on Android, open a Grimório that runs on a PC or server (for
example `Grimorio.exe --host 0.0.0.0` on the home Wi-Fi, or a server behind HTTPS) and use *Install app*. It needs that
computer to be on, because the decks, the card data and the Forge games live there.

**An APK** can wrap the same front end:

| Option | What it is | Fits when |
|---|---|---|
| TWA (Trusted Web Activity, e.g. Bubblewrap) | a Chrome window on a fixed HTTPS origin, verified with Digital Asset Links | Grimório is published on one public HTTPS address; not for a LAN `http://` PC |
| Capacitor | `web/dist` packed inside the APK, native plugins (files, HTTP without CORS) | the app should work offline and talk to any Grimório server the user chooses |

Capacitor is the one that matches the goal (offline deck building).

**Offline deck building needs a client-only mode** in the front end:

- card data stored on the phone: `cards.json`, `emb.bin`, `pos.bin`, `combos.json`, `tokens.json` (≈ 9 MB compressed,
  ≈ 38 MB unpacked), downloaded once from the release like the desktop packages do, kept in the app's files or
  IndexedDB; the suggestion maths already runs in the browser;
- decks, profiles and settings in IndexedDB instead of `/api/decks`, with optional sync to a server later;
- what the server does today needs a replacement or stays online-only: site imports (`deck_import.py`, CORS-blocked in
  a browser — Capacitor's native HTTP can do them), the EDHREC / 17lands / MTGTop8 proxies and caches, the optional AI
  assistant.

**Coliseum on Android: through a computer.** Forge's game engine here is the desktop Java build (Java 17, `sim` mode
plus the GrimorioSim launcher, ~1 GB of RAM per game); it can't run inside an Android app. The APK would connect to a
PC or server running Grimório (enter its address or scan a QR code shown on the PC), send the decks to its `/api/sim/*`
and show the live board and reports as the web app does now. Tournaments, ratings and the Arena stay on that computer.

**Effort (one developer, part-time):**

| Step | Estimate |
|---|---|
| Capacitor shell, icons, build/signing in CI, server address setting | 1–2 weeks |
| Client-only data + deck storage (IndexedDB), offline suggestions, sync design | 4–6 weeks |
| Imports through native HTTP; online-only fallbacks for the rest | 1–2 weeks |
| Coliseum against a remote Grimório (pairing, CORS/cookies or token auth, live view) | 1–2 weeks |
| **Total** | **about 2–3 months** |

## Backups and sync on Android

The desktop and server editions already export/import `.grimorio` files and sync through a cloud folder
(`backup.py`: each device writes only `grimorio-<device>.grimorio` there and merges the others'). The APK reuses the same
files, so phones join the same folder as the computers:

- **Folder sync apps:** Syncthing-Fork (no account, direct device-to-device), or Dropbox / OneDrive / Nextcloud apps (or
  a folder-sync app such as FolderSync) pointed at the shared `Grimorio` folder. The APK reads and writes there through
  the Android Storage Access Framework (the user picks the folder once).
- **Same merge rules** as `backup.merge`: decks newest-wins with «(conflito)» copies, union of tests, tournaments, bets
  and rating games, ratings rebuilt from the games. Ported to JS (IndexedDB) or run on the phone's SQLite via a
  Capacitor plugin.
- **Manual backup** stays the fallback: share/receive a `.grimorio` file.

Estimate: 1–2 weeks on top of the «client-only data» step above.

## Desktop packages

- Play against Forge yourself (Coliseum › Play) without Docker: the desktop packages would need Forge's GUI running
  locally and a way to show it (its own window instead of noVNC).
- Code signing for `Grimorio.exe` (removes the SmartScreen warning) when there is a certificate.
- macOS package (same launcher; needs a macOS JRE and testing).
