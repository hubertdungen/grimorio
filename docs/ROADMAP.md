# Roadmap notes

## Android app

**Local first.** The APK is the whole Grimório on the phone. It embeds CPython with [Chaquopy](https://chaquo.com/chaquopy/)
(MIT) and runs the same `server.py` as the desktop packages on `http://127.0.0.1:<port>` inside the app; the WebView
shows it. Nothing else is needed: no server, no account, no cloud.

- **Why this and not a client-only rewrite** (the old plan: Capacitor + IndexedDB, 2–3 months): the server is stdlib-only
  Python, so it runs on Android unchanged — decks, profiles, imports (no CORS problem: the requests leave from the
  phone's Python), EDHREC/17lands/MTGTop8, rules, AI keys, friends, the free table, rooms, the Taverna, backups. One
  code base, the same database file (`grimorio.db`) as the desktop, so `.grimorio` backups and cloud-folder sync are the
  same files.
- **What is inside the APK:** `assets/grimorio-app.zip` (the `*.py` files and `web/dist`, built by the Gradle task
  `grimorioAppZip`), the Chaquopy runtime (Python 3.11 — the last one Chaquopy builds for 32-bit ARM too — for
  `arm64-v8a`, `armeabi-v7a`, `x86_64`) and the bootstrap `android/app/src/main/python/grimorio_android.py`.
- **First start:** the app unpacks `grimorio-app.zip` to its private `files/app` (again after each update), downloads the
  card data like the desktop launcher (`grimorio-data.zip` of the matching release, checked against its `.sha256`,
  resumable with HTTP Range; it starts by itself on Wi-Fi and asks first on mobile data) into `files/grimorio`, then
  starts the server (`LocalServer.java`). Port: 8107 or the next free one, remembered, because the WebView's storage
  (language, open deck…) belongs to `http://127.0.0.1:<port>`. Leaving the app (back out) stops the server and the process.
- **Only the app talks to it:** other apps on the phone can reach `127.0.0.1` too, so the server (with
  `GRIMORIO_APP_TOKEN`) answers only requests carrying the `grimorio_app` cookie that the app puts in its WebView.
- **Forge does not run on Android** (desktop Java, ~1 GB per game). The bootstrap sets `GRIMORIO_NO_FORGE`: everything
  that starts a Forge game (`sim.submit`, `playnet.start`/`start_pvp`, `limited.start`) refuses with a clear message
  (`sim.NoForge`, a `ValueError`, so routes and tournaments show it), `/api/health` answers `{"forge": false}`, and the
  web app (`web/src/forge.jsx`) replaces *Play against Forge* and *Draft* with «Needs a computer or server running
  Grimório» and puts a strip above the Lab and Ratings (their reports may come from another device). Free table,
  deck building, library, rules, friends, online rooms and the Taverna (as host for yourself or as a guest of a
  friend's Grimório) work on the phone. «Share over the internet» (cloudflared) is not available on Android.
- **Remote mode (optional):** the app can open a Grimório server instead (your PC with `--host 0.0.0.0`, a server
  behind HTTPS): then everything, Forge included, runs there. Apps updated from the old WebView-only APK that had a
  server address saved start in remote mode; new installs start local.

**Native ↔ web contract (`window.GrimorioApp`, `MainActivity.Bridge`):**

| Call | Does |
|---|---|
| `getMode()` | `"local"` (Grimório on this device) or `"remote"` (a server) |
| `getServer()` | the saved server address (`""` if none); kept when switching to local |
| `setMode("local")` | switch to this device (starts the local server, downloads the card data if missing) |
| `setMode("remote", url)` | switch to the server at `url` (saved; `""` opens the address dialog, prefilled with the saved one) |
| `changeServer()` | the address dialog (it also has «Use only on this device») |
| `version()`, `saveFile(name, mime, b64)`, `keepScreenOn(on)`, `orientation(o)` | as before |

The mode switches only when the call comes from the page of the current Grimório (local or the saved server), not
from a site opened through a link. Apps older than this one have no `getMode`: treat them as remote-only. A first-run
wizard or a `GET /api/storage` (`{mode: "local"|"remote", remote_url, sync}`) on the web side should, inside the app
(`window.GrimorioApp?.setMode`), switch with `setMode` rather than storing a remote URL itself: the app owns which
Grimório the WebView shows. «Only on this device» is a complete choice; nothing asks to connect anything unless a
Forge feature is opened.

**Build:** `cd web && npm ci && npx vite build`, then `gradle -p android assembleRelease` (Gradle 8.9, JDK 17, Android
SDK 34). No Python is needed on the build machine (no pip, `.pyc` compiled on the phone). CI: `.github/workflows/release.yml`
job `android` builds the web app first and checks that the APK carries `grimorio-app.zip` with `server.py` and
`web/dist`, the bootstrap and `libpython3.11.so`.

**Version code:** `major·1 000 000 + minor·1 000 + patch` (`1.13.86` → 1013086): it grows with every release, also
past patch 99, and is above the old scheme (`1.13.85` was 11385), so updates install over older APKs.

**Possible next steps:** an Android cloud folder through the Storage Access Framework (the server sees only app-private
storage today: sync works through a folder another app keeps in step inside `Android/media`, or by export/import);
splitting the APK per ABI to make it smaller; Google Play (an `.aab` from `bundleRelease`, `targetSdk` 35+ with
edge-to-edge insets and `OnBackInvokedCallback`); a QR code on the desktop to connect the app to it.

## Backups and sync on Android

The app runs `backup.py` itself (same database, same `.grimorio` files), so on the phone: **Settings › Data & backups ›
Export everything** saves a `.grimorio` file to *Downloads*, and importing one works through the file picker. Android's
own backup keeps `grimorio.db` (decks, profiles, games) but not the card data, which is downloaded again.

Still to do: a cloud folder on Android. The server only sees the app's private storage, so syncing with the computers'
`Grimorio` folder (Syncthing-Fork, Dropbox / OneDrive / Nextcloud apps, FolderSync) needs the Storage Access Framework
(the user picks the folder once) and a small native bridge that copies `grimorio-<device>.grimorio` in and out; the
merge rules stay those of `backup.merge`.

## Desktop packages

- Play against Forge yourself (Coliseum › Play) without Docker: the desktop packages would need Forge's GUI running
  locally and a way to show it (its own window instead of noVNC).
- Code signing for `Grimorio.exe` (removes the SmartScreen warning) when there is a certificate.
- macOS package (same launcher; needs a macOS JRE and testing).
