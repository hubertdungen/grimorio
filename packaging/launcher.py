"""Grimório — desktop launcher (Windows Grimorio.exe and the Linux `grimorio` script).

Starts the normal Grimório server (server.py) on this computer only (127.0.0.1), without Docker:
Forge runs on the bundled Java 17 (jre/) and the bundled Forge (forge/), and the card data is downloaded
once from the GitHub release that matches this version. Then it opens the browser. Closing the window
(or Ctrl+C) stops everything. Data lives in %LOCALAPPDATA%\\Grimorio or ~/.local/share/grimorio.

Package layout (built by packaging/build.py):
    Grimorio.exe | grimorio      the launcher
    app/                         server.py & co, web/dist, this file
    forge/  forge-ext/  jre/     Forge 2.0.15 (with Grimório's AI profiles applied), GrimorioSim classes, Temurin JRE
    VERSION
"""
import argparse, hashlib, json, os, runpy, shutil, signal, socket, sqlite3, subprocess, sys, tarfile, threading, time, urllib.error, urllib.request, webbrowser, zipfile

REPO = "hubertdungen/grimorio"
FROZEN = getattr(sys, "frozen", False)
APP = os.path.join(os.path.dirname(sys.executable), "app") if FROZEN else os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(APP)
PORTS = range(8107, 8127)  # a stable port keeps the browser's saved settings (they belong to http://127.0.0.1:<port>)


def say(*a, **k):
    print(*a, flush=True, **k)


def utf8_files():
    """The app reads its files as UTF-8; Windows' default is the ANSI code page. The .exe is built with
    `-X utf8`; this is the fallback when that flag did not take."""
    if sys.flags.utf8_mode:
        return
    import builtins
    _open = builtins.open

    def open_utf8(file, mode="r", buffering=-1, encoding=None, *a, **k):
        return _open(file, mode, buffering, encoding or (None if "b" in mode else "utf-8"), *a, **k)
    builtins.open = open_utf8


def ca_bundle():
    """Linux: point Python's ssl at the distro's CA bundle if the default path has none (Fedora, Arch, …)."""
    if os.name == "nt" or os.environ.get("SSL_CERT_FILE"):
        return
    import ssl
    if os.path.exists(ssl.get_default_verify_paths().cafile or ""):
        return
    for f in ("/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem",
              "/etc/ssl/ca-bundle.pem"):
        if os.path.exists(f):
            os.environ["SSL_CERT_FILE"] = f
            return


def data_dir():
    if os.environ.get("GRIMORIO_DATA_DIR"):
        return os.environ["GRIMORIO_DATA_DIR"]
    if os.name == "nt":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Grimorio")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "grimorio")


def version():
    try:
        with open(os.path.join(BASE, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "dev"


def running(port):
    """True if a Grimório server already answers on this port."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
            return r.headers.get("Server", "").startswith("Grimorio")
    except urllib.error.HTTPError as e:  # 503 = running, card data still missing
        return e.headers.get("Server", "").startswith("Grimorio")
    except OSError:
        return False


def free(host, port):
    with socket.socket() as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def download(url, dest, quiet=False):
    """url (https or a local path) -> dest, with progress (quiet: no progress, for the background update)."""
    if os.path.exists(url):
        shutil.copyfile(url, dest)
        return
    req = urllib.request.Request(url, headers={"User-Agent": "Grimorio-launcher"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest + ".part", "wb") as f:
        total, done, last = int(r.headers.get("Content-Length") or 0), 0, 0.0
        while chunk := r.read(1 << 16):
            f.write(chunk)
            done += len(chunk)
            if not quiet and time.time() - last > 0.5:
                last = time.time()
                print(f"\r  {done >> 20} MB" + (f" of {total >> 20} MB ({100 * done // total}%)" if total else ""),
                      end="", flush=True)
    quiet or print()
    os.replace(dest + ".part", dest)


def install_data(d, ver):
    """First start (or a new version): download the prebuilt card data (data/, meta/) from the GitHub release.
    Data built locally by build/build.sh (no stamp file) is never replaced."""
    stamp = os.path.join(d, "data-release.txt")
    have = os.path.isfile(os.path.join(d, "data", "meta.json"))
    old = open(stamp, encoding="utf-8").read().strip() if os.path.isfile(stamp) else None
    if have and (old is None or old == ver):
        return
    url = os.environ.get("GRIMORIO_DATA_URL") or (
        f"https://github.com/{REPO}/releases/" + ("latest/download" if ver == "dev" else f"download/v{ver}") + "/grimorio-data.zip")
    say("Downloading the card data (about 11 MB, only the first time)…" if not have else "Updating the card data…")
    tmp = os.path.join(d, ".download")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    try:
        z = os.path.join(tmp, "grimorio-data.zip")
        download(url, z)
        try:  # integrity: grimorio-data.zip.sha256 next to the zip (a local test file may have none)
            download(url + ".sha256", z + ".sha256")
            want = open(z + ".sha256", encoding="utf-8").read().split()[0].lower()
        except (OSError, ValueError, IndexError):
            want = None
        h = hashlib.sha256()
        with open(z, "rb") as f:
            while chunk := f.read(1 << 20):
                h.update(chunk)
        if want and h.hexdigest() != want:
            raise RuntimeError("the download is corrupted (checksum mismatch)")
        with zipfile.ZipFile(z) as zf:
            zf.extractall(os.path.join(tmp, "new"))
        for top in ("data", "meta"):  # atomic-ish swap: the server never sees half the files
            src, dst = os.path.join(tmp, "new", top), os.path.join(d, top)
            if os.path.isdir(src):
                shutil.rmtree(dst + ".old", ignore_errors=True)
                if os.path.isdir(dst):
                    os.replace(dst, dst + ".old")
                os.replace(src, dst)
                shutil.rmtree(dst + ".old", ignore_errors=True)
        with open(stamp, "w", encoding="utf-8") as f:
            f.write(ver)
        say("Card data ready.")
    except Exception as e:
        if not have:
            raise SystemExit(f"\nCould not download the card data: {e}\nCheck your internet connection and start Grimório again.")
        say(f"Could not update the card data ({e}); using the data you already have.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------- versions: database backups, automatic updates ----------
# Updates go to <data>/versions/<v>/ (checked against the release's .sha256) and start from the next launch: the
# launcher you open (shortcut, original folder) hands over to the newest complete version there. Your data stays in
# <data> and every version reads it (the database only ever gains tables and columns).
UPD = "update.json"
ASSET = "Grimorio-{v}-windows-x64.zip" if os.name == "nt" else "grimorio-{v}-linux-x64.tar.gz"


def vkey(v):
    """'1.8.0' -> (1, 8, 0); 'dev' or anything odd -> () (a source checkout never updates itself)."""
    try:
        return tuple(int(x) for x in str(v).split("-")[0].split("."))
    except ValueError:
        return ()


def jread(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def jwrite(p, o):
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(o, f)
    os.replace(p + ".tmp", p)


def backup_db(d, ver, keep=3):
    """A new version is about to open the database: keep a copy made by the one that ran before (last `keep`)."""
    st = jread(os.path.join(d, UPD))
    db, last = os.path.join(d, "grimorio.db"), st.get("ran")
    if last and last != ver and os.path.isfile(db):
        bdir = os.path.join(d, "backups")
        os.makedirs(bdir, exist_ok=True)
        dest = os.path.join(bdir, f"grimorio-{last}-{time.strftime('%Y%m%d-%H%M%S')}.db")
        src, out = sqlite3.connect(db), sqlite3.connect(dest)
        with out:
            src.backup(out)  # consistent copy, WAL included
        src.close(); out.close()
        old = sorted((os.path.join(bdir, f) for f in os.listdir(bdir) if f.startswith("grimorio-") and f.endswith(".db")), key=os.path.getmtime)
        for f in old[:-keep]:
            os.remove(f)
        say(f"Database backed up before {ver}: {dest}")
    if last != ver:
        jwrite(os.path.join(d, UPD), {**jread(os.path.join(d, UPD)), "ran": ver})


def newest_installed(d, ver):
    """A downloaded and checked version newer than this one -> (version, its launcher), else None."""
    root, best = os.path.join(d, "versions"), None
    for v in os.listdir(root) if os.path.isdir(root) else []:
        exe = os.path.join(root, v, "Grimorio", "Grimorio.exe") if os.name == "nt" else os.path.join(root, v, "grimorio", "app", "launcher.py")
        if os.path.isfile(os.path.join(root, v, ".complete")) and os.path.isfile(exe) and vkey(v) > vkey(ver) and (not best or vkey(v) > vkey(best[0])):
            best = (v, exe)
    return best


def hand_over(d, ver):
    """Start the newest downloaded version instead of this one (and wait for it, so this window stays its console)."""
    if not vkey(ver) or os.environ.get("GRIMORIO_NO_REDIRECT"):
        return
    n = newest_installed(d, ver)
    if not n:
        return
    say(f"Starting Grimório {n[0]} (updated automatically)…")
    cmd = [n[1]] if os.name == "nt" else [sys.executable, n[1]]
    raise SystemExit(subprocess.call(cmd + sys.argv[1:], env={**os.environ, "GRIMORIO_NO_REDIRECT": "1"}))


def prune_versions(d, ver):
    """Versions older than the one running are no longer needed."""
    root = os.path.join(d, "versions")
    for v in os.listdir(root) if os.path.isdir(root) else []:
        if vkey(v) and vkey(v) < vkey(ver) or v.endswith(".part"):
            shutil.rmtree(os.path.join(root, v), ignore_errors=True)


def safe_extract(archive, dest):
    if archive.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            z.extractall(dest)  # zipfile drops absolute paths and «..»
        return
    with tarfile.open(archive) as t:
        try:
            t.extractall(dest, filter="data")
        except TypeError:  # Python without extraction filters: check the paths by hand
            root = os.path.realpath(dest)
            for m in t.getmembers():
                if not os.path.realpath(os.path.join(dest, m.name)).startswith(root + os.sep) or m.issym() or m.islnk():
                    raise RuntimeError(f"unsafe path in the update: {m.name}")
            t.extractall(dest)


def update_loop(d, ver):
    """Check at start and then every 30 min while Grimório is open (10 min after a failure: a release that was just
    published only gets its packages about an hour later, and the download should start as soon as they are there)."""
    while True:
        check_update(d, ver)
        st = jread(os.path.join(d, UPD))
        if st.get("ready"):
            return  # already downloaded: it starts on the next launch
        time.sleep(600 if st.get("err") else 1800)


def check_update(d, ver):
    """Background: is there a newer release? Download it, check its sha256 and unpack it into versions/ (unless the
    person turned automatic updates off in Settings). The state goes to update.json for the Settings page."""
    p = os.path.join(d, UPD)
    if not vkey(ver) or jread(p).get("auto") is False:
        return
    st = {}
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest",
                                     headers={"User-Agent": "Grimorio-launcher", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            rel = json.load(r)
        latest = str(rel.get("tag_name", "")).lstrip("v")
        st = {"latest": latest, "checked": time.time(), "url": rel.get("html_url"), "err": None}
        jwrite(p, {**jread(p), **st})
        if vkey(latest) <= vkey(ver):
            return
        dest = os.path.join(d, "versions", latest)
        if not os.path.isfile(os.path.join(dest, ".complete")):
            assets = {a["name"]: a["browser_download_url"] for a in rel.get("assets", [])}
            name = ASSET.format(v=latest)
            if name not in assets or name + ".sha256" not in assets:
                raise RuntimeError(f"the release has no {name} with its .sha256")
            tmp = dest + ".part"
            shutil.rmtree(tmp, ignore_errors=True)
            os.makedirs(tmp)
            jwrite(p, {**jread(p), "downloading": latest})
            f = os.path.join(tmp, name)
            download(assets[name], f, quiet=True)
            download(assets[name + ".sha256"], f + ".sha256", quiet=True)
            want = open(f + ".sha256", encoding="utf-8").read().split()[0].lower()
            h = hashlib.sha256()
            with open(f, "rb") as fh:
                while chunk := fh.read(1 << 20):
                    h.update(chunk)
            if h.hexdigest() != want:
                raise RuntimeError("the update download is corrupted (checksum mismatch)")
            safe_extract(f, tmp)
            os.remove(f); os.remove(f + ".sha256")
            open(os.path.join(tmp, ".complete"), "w").close()
            shutil.rmtree(dest, ignore_errors=True)
            os.replace(tmp, dest)
        jwrite(p, {**jread(p), "ready": latest, "downloading": None})
        say(f"Grimório {latest} is downloaded: it starts the next time you open Grimório.")
    except Exception as e:  # no internet, GitHub rate limit, disk full: try again next time
        jwrite(p, {**jread(p), "err": str(e)[:200], "downloading": None})


# ---------- the app window ----------
def log_to_file():
    """Windowed app (no console): stdout/stderr are None; send them to <data>/logs/grimorio.log (last run kept as .1)."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    logs = os.path.join(data_dir(), "logs")
    os.makedirs(logs, exist_ok=True)
    f = os.path.join(logs, "grimorio.log")
    if os.path.isfile(f):
        os.replace(f, f + ".1")
    sys.stdout = sys.stderr = open(f, "a", encoding="utf-8", buffering=1)


def remote_url(d):
    """«Abrir o meu servidor» (Definições › Dados, devsync.py): o endereço do servidor se a janela o deve abrir, senão None."""
    s = (jread(os.path.join(d, "storage.json")) or {}).get("server") or {}
    u = str(s.get("url") or "")
    return u if s.get("on") and s.get("open") and u.lower().startswith(("http://", "https://")) else None


def reachable(url):
    """O servidor responde (qualquer resposta HTTP serve: pode estar atrás de um login)?"""
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/api/health", timeout=4):
            return True
    except urllib.error.HTTPError:
        return True
    except (OSError, ValueError):
        return False


def start_url(local, d, jh="", force_local=False):
    """O que a janela abre: o servidor (modo «abrir o meu servidor», se responder) ou o Grimório local (com
    #sem-servidor se o servidor não respondeu: a app avisa e usa os dados deste computador)."""
    r = None if force_local else remote_url(d)
    if r and not jh:
        if reachable(r):
            return r.rstrip("/") + "/"
        return f"{local}/#sem-servidor"
    return f"{local}/{jh}"


class Bridge:
    """window.pywebview.api na janela (também quando mostra o servidor): a app troca entre o servidor e este computador."""
    def __init__(self, local, d):
        self.local, self.d, self.w = local, d, None

    def storage(self):
        r = remote_url(self.d)
        return {"mode": "remote" if r else "local", "local": self.local, "remote": r}

    def _set(self, mode):
        req = urllib.request.Request(self.local + "/api/storage", json.dumps({"mode": mode}).encode(), {"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())

    def use_local(self):
        """Volta ao Grimório deste computador (os dados daqui estão intactos; a ligação ao servidor continua a sincronizar)."""
        try:
            self._set("server")
        except (OSError, ValueError):
            pass
        if self.w:
            self.w.load_url(self.local + "/")
        return True

    def use_remote(self):
        r = remote_url(self.d)
        if r and self.w:
            self.w.load_url(r.rstrip("/") + "/")
        return bool(r)


def window(url, d, api=None):
    """Grimório in its own window (pywebview: Edge WebView2 on Windows). Blocks until the window is closed; False if
    there is no window toolkit here (then the caller opens the browser). api = Bridge (window.pywebview.api)."""
    try:
        import webview
    except Exception:
        return False
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True  # exports, proxy PDFs, backups
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        w = webview.create_window("Grimório", url, width=1440, height=900, min_size=(960, 640), text_select=True, background_color="#0b0a14",
                                  **({"js_api": api} if api else {}))
        if api:
            api.w = w

        def away(on):  # minimizada: a página sabe (o relógio de torneio do Forge Play pausa fora da mesa)
            try:
                w.evaluate_js("window.__grimAway=%s;window.dispatchEvent(new Event('grimorio:away'))" % ("true" if on else "false"))
            except Exception:
                pass
        try:
            w.events.minimized += lambda *a: away(True)
            for ev in (w.events.restored, w.events.maximized, w.events.shown):
                ev += lambda *a: away(False)
        except Exception:
            pass  # pywebview antigo sem estes eventos: fica só o que o browser souber
        # the browser storage (language, open deck, preferences) stays between runs, next to the data
        webview.start(private_mode=False, storage_path=os.path.join(d, "webview"))
        return True
    except Exception as e:
        say(f"No app window ({e}); opening the browser instead.")
        return False


def stop_box(url):
    """Windows app without a console: a message box keeps Grimório running in the browser until OK."""
    if os.name != "nt" or sys.stdin is not None and sys.stdin.isatty():
        return False
    import ctypes
    ctypes.windll.user32.MessageBoxW(None, f"Grimório is running in your browser:\n{url}\n\nPress OK to close Grimório.", "Grimório", 0x40)
    return True


def join_hash(link):
    """grimorio://join?u=<link do amigo> -> '#levar=<link>' (a app abre «Sala de um amigo» com ele); grimorio://ligar?u=<link
    do servidor> -> '#ligar=<link>' (a app abre «Ligar ao meu servidor» com ele); '' se não for isso."""
    import urllib.parse
    if not link or not str(link).lower().startswith("grimorio://"):
        return ""
    sp = urllib.parse.urlsplit(link)
    u = (urllib.parse.parse_qs(sp.query).get("u") or [""])[0]
    tag = "#ligar=" if (sp.netloc or sp.path.strip("/")).lower() == "ligar" else "#levar="
    return tag + urllib.parse.quote(u, safe="") if u.lower().startswith(("http://", "https://")) and len(u) < 600 else ""


def register_scheme():
    """grimorio://join?u=… (o botão «Abrir na app Grimório» dos convites e das salas) abre esta app. Sem admin: HKCU no
    Windows, ~/.local/share/applications no Linux. Regista-se a cada arranque (as atualizações mudam a pasta da app)."""
    try:
        if os.name == "nt":
            if not FROZEN:
                return
            import winreg
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\grimorio") as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Grimório")
                winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\grimorio\shell\open\command") as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, f'"{sys.executable}" "%1"')
        elif sys.platform.startswith("linux"):
            sh = os.path.join(BASE, "grimorio")
            if not os.path.isfile(sh):  # a correr do código-fonte: sem o script do pacote
                return
            import importlib.util
            apps = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "applications")
            f = os.path.join(apps, "grimorio.desktop")
            # sem janela própria (sem pywebview) abre num terminal, para se poder fechar (Ctrl+C)
            body = ("[Desktop Entry]\nType=Application\nName=Grimório\nComment=Magic: The Gathering decks, Forge and friends\n"
                    f'Exec="{sh}" %u\nIcon={os.path.join(APP, "web", "dist", "icon-192.png")}\n'
                    f'Terminal={"false" if importlib.util.find_spec("webview") else "true"}\nCategories=Game;\nMimeType=x-scheme-handler/grimorio;\n')
            if os.path.isfile(f) and open(f, encoding="utf-8").read() == body:
                return
            os.makedirs(apps, exist_ok=True)
            with open(f, "w", encoding="utf-8") as out:
                out.write(body)
            for cmd in (["xdg-mime", "default", "grimorio.desktop", "x-scheme-handler/grimorio"], ["update-desktop-database", apps]):
                try:
                    subprocess.run(cmd, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except (OSError, subprocess.SubprocessError):
                    pass  # sem xdg-utils: o .desktop já chega na maioria dos ambientes
    except Exception as e:  # nunca impede a app de abrir
        say(f"Could not register grimorio:// links ({e}).")


def main():
    ap = argparse.ArgumentParser(description="Start Grimório on this computer and open it in its own window (or the browser).")
    ap.add_argument("--port", type=int, help="port (default: 8107, or the next free one)")
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to open it to phones/tablets on your network")
    ap.add_argument("--no-browser", action="store_true", help="do not open a window or the browser (server only)")
    ap.add_argument("--browser", action="store_true", help="open in the browser instead of Grimório's own window")
    ap.add_argument("--local", action="store_true", help="open this computer's Grimório even if Settings › Data says to open your server")
    ap.add_argument("link", nargs="?", help=argparse.SUPPRESS)  # grimorio://join?u=… (register_scheme)
    log_to_file()  # the Windows app has no console: what it says goes to <data>/logs/grimorio.log
    args = ap.parse_args()
    utf8_files()
    ca_bundle()
    d, ver = data_dir(), version()
    os.makedirs(d, exist_ok=True)
    state = os.path.join(d, "launcher.json")
    try:
        with open(state, encoding="utf-8") as f:
            last = int(json.load(f)["port"])
    except (OSError, ValueError, KeyError, TypeError):
        last = None
    jh = join_hash(args.link)
    register_scheme()
    if not args.port and last and running(last):  # already open: just show it again (o link de um amigo abre outra janela nele)
        say(f"Grimório is already running: http://127.0.0.1:{last}")
        loc = f"http://127.0.0.1:{last}"
        if not args.no_browser and not (not args.browser and window(start_url(loc, d, jh, args.local), d, Bridge(loc, d))):
            webbrowser.open(start_url(loc, d, jh, args.local))
        return
    port = args.port or next((p for p in ([last] if last else []) + list(PORTS) if free(args.host, p)), None)
    if not port:
        raise SystemExit(f"Ports {PORTS.start}–{PORTS.stop - 1} are all busy. Start it with --port <number>.")
    with open(state, "w", encoding="utf-8") as f:
        json.dump({"port": port}, f)
    hand_over(d, ver)  # a newer version was downloaded: it runs instead of this one
    backup_db(d, ver)
    prune_versions(d, ver)
    install_data(d, ver)
    os.environ["GRIMORIO_VERSION"] = ver
    threading.Thread(target=update_loop, args=(d, ver), daemon=True).start()

    # Forge without Docker: bundled Java and Forge (sim.py reads these)
    java = os.path.join(BASE, "jre", "bin", "java.exe" if os.name == "nt" else "java")
    os.environ.setdefault("GRIMORIO_RUNTIME", "local")
    if os.path.isfile(java):
        os.environ.setdefault("GRIMORIO_JAVA", java)
    if os.path.isdir(os.path.join(BASE, "forge")):
        os.environ.setdefault("GRIMORIO_FORGE_DIR", os.path.join(BASE, "forge"))

    url = f"http://127.0.0.1:{port}"
    say("", "=" * 64, f"  Grimório {ver} is running at  {url}",
        *(["  Close the Grimório window to stop it."] if sys.stdout is not None and not sys.stdout.isatty() and os.name == "nt" else
          ["  Keep this terminal open while you use it.", "  To stop Grimório, press Ctrl+C (or close this terminal)."]), "=" * 64, "", sep="\n")

    sys.path.insert(0, APP)
    sys.argv = [os.path.join(APP, "server.py"), "--host", args.host, "--port", str(port), "--data-dir", d]
    for sig in ("SIGTERM", "SIGHUP"):  # kill / closed terminal: stop cleanly, with the Forge games
        if hasattr(signal, sig):
            signal.signal(getattr(signal, sig), lambda *_: sys.exit(0))
    server = threading.Thread(target=lambda: runpy.run_path(sys.argv[0], run_name="__main__"), daemon=True)
    try:
        server.start()
        ready = any(running(port) or time.sleep(0.5) for _ in range(240))
        if not ready:
            say("The server did not start; see the log above.")
        elif args.no_browser:
            server.join()
        elif args.browser or not window(start_url(url, d, jh, args.local), d, Bridge(url, d)):  # no window (Linux without pywebview, Windows without WebView2): the browser
            webbrowser.open(start_url(url, d, jh, args.local))
            if not stop_box(url):  # Windows app without a console: a small dialog is the way to stop it
                server.join()
    except KeyboardInterrupt:
        pass
    finally:
        try:  # «Partilhar pela internet»: o cloudflared não fica a correr depois de fechar a app
            sys.modules["share"].stop()
        except Exception:
            pass
        for p in list(getattr(sys.modules.get("sim"), "PROCS", {}).values()):
            p.kill()
        for x in list(getattr(sys.modules.get("playnet"), "S", {}).values()):  # Forge Play games still open
            try:
                x["p"].kill()
            except Exception:
                pass
        say("Grimório stopped.")


def selfcheck():
    import tempfile
    assert join_hash("grimorio://join?u=https%3A%2F%2Fa-b.trycloudflare.com%2Fconvite%2Fabc") == "#levar=https%3A%2F%2Fa-b.trycloudflare.com%2Fconvite%2Fabc"
    assert join_hash("grimorio://join?u=javascript:alert(1)") == "" and join_hash(None) == "" and join_hash("--x") == ""
    assert join_hash("grimorio://ligar?u=http%3A%2F%2F192.168.1.5%3A8107%2Fligar%2FABCD-EFGH") == "#ligar=http%3A%2F%2F192.168.1.5%3A8107%2Fligar%2FABCD-EFGH"
    with tempfile.TemporaryDirectory() as d:  # «abrir o meu servidor»: a janela abre o servidor; sem resposta, o local com aviso
        assert remote_url(d) is None and start_url("http://127.0.0.1:1", d) == "http://127.0.0.1:1/"
        jwrite(os.path.join(d, "storage.json"), {"server": {"url": "http://127.0.0.1:9", "on": True, "open": True}})
        assert remote_url(d) == "http://127.0.0.1:9" and start_url("http://127.0.0.1:1", d) == "http://127.0.0.1:1/#sem-servidor"
        assert start_url("http://127.0.0.1:1", d, "#levar=x") == "http://127.0.0.1:1/#levar=x"  # o link de um amigo abre aqui
        jwrite(os.path.join(d, "storage.json"), {"server": {"url": "javascript:alert(1)", "on": True, "open": True}})
        assert remote_url(d) is None
    assert vkey("1.10.0") > vkey("1.9.3") > vkey("1.9") and vkey("dev") == () and vkey("0.0.0-abc1234") == (0, 0, 0)
    with tempfile.TemporaryDirectory() as d:
        ex = ("Grimorio", "Grimorio.exe") if os.name == "nt" else ("grimorio", "app", "launcher.py")
        for v, done in (("1.8.0", True), ("1.9.0", True), ("2.0.0", False)):
            os.makedirs(os.path.join(d, "versions", v, *ex[:-1]))
            open(os.path.join(d, "versions", v, *ex), "w").close()
            done and open(os.path.join(d, "versions", v, ".complete"), "w").close()
        assert newest_installed(d, "1.8.0")[0] == "1.9.0" and newest_installed(d, "1.9.0") is None  # 2.0.0 is half-downloaded
        prune_versions(d, "1.9.0")
        assert sorted(os.listdir(os.path.join(d, "versions"))) == ["1.9.0", "2.0.0"]
        con = sqlite3.connect(os.path.join(d, "grimorio.db")); con.execute("CREATE TABLE t (x)"); con.commit(); con.close()
        backup_db(d, "1.8.0"); backup_db(d, "1.9.0")
        assert len(os.listdir(os.path.join(d, "backups"))) == 1 and jread(os.path.join(d, UPD))["ran"] == "1.9.0"
    print("selfcheck ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selfcheck"]:
        selfcheck()
    else:
        main()
