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
import argparse, hashlib, json, os, runpy, shutil, signal, socket, sys, threading, time, urllib.error, urllib.request, webbrowser, zipfile

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


def download(url, dest):
    """url (https or a local path) -> dest, with progress."""
    if os.path.exists(url):
        shutil.copyfile(url, dest)
        return
    req = urllib.request.Request(url, headers={"User-Agent": "Grimorio-launcher"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest + ".part", "wb") as f:
        total, done, last = int(r.headers.get("Content-Length") or 0), 0, 0.0
        while chunk := r.read(1 << 16):
            f.write(chunk)
            done += len(chunk)
            if time.time() - last > 0.5:
                last = time.time()
                print(f"\r  {done >> 20} MB" + (f" of {total >> 20} MB ({100 * done // total}%)" if total else ""),
                      end="", flush=True)
    print()
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


def main():
    ap = argparse.ArgumentParser(description="Start Grimório on this computer and open it in the browser.")
    ap.add_argument("--port", type=int, help="port (default: 8107, or the next free one)")
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to open it to phones/tablets on your network")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
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
    if not args.port and last and running(last):  # already open: just show it again
        say(f"Grimório is already running: http://127.0.0.1:{last}")
        args.no_browser or webbrowser.open(f"http://127.0.0.1:{last}")
        return
    port = args.port or next((p for p in ([last] if last else []) + list(PORTS) if free(args.host, p)), None)
    if not port:
        raise SystemExit(f"Ports {PORTS.start}–{PORTS.stop - 1} are all busy. Start it with --port <number>.")
    with open(state, "w", encoding="utf-8") as f:
        json.dump({"port": port}, f)
    install_data(d, ver)

    # Forge without Docker: bundled Java and Forge (sim.py reads these)
    java = os.path.join(BASE, "jre", "bin", "java.exe" if os.name == "nt" else "java")
    os.environ.setdefault("GRIMORIO_RUNTIME", "local")
    if os.path.isfile(java):
        os.environ.setdefault("GRIMORIO_JAVA", java)
    if os.path.isdir(os.path.join(BASE, "forge")):
        os.environ.setdefault("GRIMORIO_FORGE_DIR", os.path.join(BASE, "forge"))

    url = f"http://127.0.0.1:{port}"
    say("", "=" * 64, f"  Grimório {ver} is running at  {url}",
        "  Keep this window open while you use it.",
        "  To stop Grimório, close this window (or press Ctrl+C).", "=" * 64, "", sep="\n")

    def open_when_ready():
        for _ in range(120):
            if running(port):
                return args.no_browser or webbrowser.open(url)
            time.sleep(0.5)
    threading.Thread(target=open_when_ready, daemon=True).start()
    sys.path.insert(0, APP)
    sys.argv = [os.path.join(APP, "server.py"), "--host", args.host, "--port", str(port), "--data-dir", d]
    for sig in ("SIGTERM", "SIGHUP"):  # kill / closed terminal: stop cleanly, with the Forge games
        if hasattr(signal, sig):
            signal.signal(getattr(signal, sig), lambda *_: sys.exit(0))
    try:
        runpy.run_path(sys.argv[0], run_name="__main__")
    except KeyboardInterrupt:
        pass
    finally:
        for p in list(getattr(sys.modules.get("sim"), "PROCS", {}).values()):
            p.kill()
        say("Grimório stopped.")


if __name__ == "__main__":
    main()
