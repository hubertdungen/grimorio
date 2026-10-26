#!/usr/bin/env python3
"""Grimório — builds the no-Docker desktop packages and the prebuilt card data (stdlib only; used by CI and by hand).

    python3 packaging/build.py forge   WORK                 Forge 2.0.15 (official release, checksum-verified), trimmed to
                                                            what headless games need -> WORK/forge
    build/forge/build.sh  (GRIMORIO_DATA_DIR=WORK)          GrimorioSim classes + AI profiles + card hints -> WORK/forge-ext
    python3 packaging/build.py package linux|windows WORK VERSION OUT
                                                            app + web/dist + Forge (forge-ext applied) + Temurin JRE 17
                                                            (+ Grimorio.exe via PyInstaller on Windows) -> OUT/<archive>
    python3 packaging/build.py data DATA_DIR OUT            card data release asset: OUT/grimorio-data.zip (+ .sha256)

`web/dist` must be built first (cd web && npm ci && npx vite build).
"""
import ast, glob, hashlib, os, shutil, stat, subprocess, sys, tarfile, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORGE_URL = "https://github.com/Card-Forge/forge/releases/download/forge-2.0.15/forge-installer-2.0.15.tar.bz2"
FORGE_SHA256 = "4468f182b60f6ca62d89697baa208981085af744f116781af751c611826db600"
# 17.0.20.1+1: the newest Temurin 17 with both the Linux and the Windows JRE published
JRE = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_{}_hotspot_17.0.20.1_1.{}"
# what Forge's headless `sim` mode reads from res/ (measured: the rest — adventure, quest, music, skins, puzzles,
# card-name translations — is for the GUI). 471 MB -> ~80 MB.
FORGE_RES = ("ai", "blockdata", "cardsfolder", "deckgendecks", "defaults", "editions", "effects", "formats", "lists",
             "setlookup", "tokenscripts")
DATA_FILES = ("cards.json", "combos.json", "emb.bin", "pos.bin", "meta.json", "tokens.json")


def fetch(url, dest, sha256=None):
    """Download once (kept as a cache in dest) and verify the checksum (pinned, or Adoptium's .sha256.txt)."""
    if not os.path.isfile(dest):
        print("download", url, flush=True)
        with urllib.request.urlopen(url, timeout=120) as r, open(dest + ".part", "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
        os.replace(dest + ".part", dest)
    if sha256 is None:
        with urllib.request.urlopen(url + ".sha256.txt", timeout=60) as r:
            sha256 = r.read().decode().split()[0]
    h = hashlib.sha256()
    with open(dest, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    if h.hexdigest() != sha256.lower():
        os.remove(dest)
        raise SystemExit(f"checksum mismatch: {url}")
    return dest


def forge(work):
    """Official Forge release -> WORK/forge with only the desktop jar, licence and the res/ that `sim` needs."""
    os.makedirs(work, exist_ok=True)
    tb = fetch(FORGE_URL, os.path.join(work, os.path.basename(FORGE_URL)), FORGE_SHA256)
    out = os.path.join(work, "forge")
    shutil.rmtree(out, ignore_errors=True)

    def keep(m):
        n = m.name.lstrip("./")
        return (n in ("LICENSE.txt", "build.txt") or
                (n.startswith("forge-gui-desktop-") and n.endswith("-jar-with-dependencies.jar")) or
                n.split("/")[0] == "res" and (n.split("/")[1:2] and n.split("/")[1] in FORGE_RES or
                                              n.startswith("res/languages/") and n.endswith(".properties")))
    with tarfile.open(tb, "r:bz2") as t:
        t.extractall(out, members=[m for m in t if (m.isfile() or m.isdir()) and keep(m)], filter="data")
    print("forge:", out, du(out), flush=True)


def du(path):
    return f"{sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs) / 1e6:.0f} MB"


def hidden_imports():
    """Stdlib modules the app imports (PyInstaller only sees the launcher, which runs server.py with runpy)."""
    mods, local = set(), {os.path.basename(f)[:-3] for f in glob.glob(os.path.join(ROOT, "*.py"))}
    for f in glob.glob(os.path.join(ROOT, "*.py")):
        for n in ast.walk(ast.parse(open(f, encoding="utf-8").read())):
            if isinstance(n, ast.Import):
                mods |= {a.name for a in n.names}
            elif isinstance(n, ast.ImportFrom) and n.module and not n.level:
                mods.add(n.module)
    return sorted(m for m in mods if m.split(".")[0] not in local) + ["ssl", "sqlite3", "ctypes.wintypes"]


def apply_ext(fdir, ext):
    """What the Docker runtime mounts over res/: our AI profiles (forge-ext/ai) and card scripts (forge-ext/cardsfolder,
    loose .txt next to the zip; Forge prefers them to the same card inside the zip)."""
    for f in glob.glob(os.path.join(ext, "ai", "*.ai")):
        shutil.copy(f, os.path.join(fdir, "res", "ai"))
    for f in glob.glob(os.path.join(ext, "cardsfolder", "*", "*.txt")):
        d = os.path.join(fdir, "res", "cardsfolder", os.path.basename(os.path.dirname(f)))
        os.makedirs(d, exist_ok=True)
        shutil.copy(f, d)


def jre(platform, work, dest):
    ext = "zip" if platform == "windows" else "tar.gz"
    a = fetch(JRE.format(platform if platform == "windows" else "linux", ext),
              os.path.join(work, f"jre-{platform}.{ext}"))
    tmp = dest + ".x"
    shutil.rmtree(tmp, ignore_errors=True)
    if ext == "zip":
        with zipfile.ZipFile(a) as z:
            z.extractall(tmp)
    else:
        with tarfile.open(a) as t:
            t.extractall(tmp, filter="data")
    (top,) = os.listdir(tmp)  # jdk-17.0.20.1+1-jre/
    os.replace(os.path.join(tmp, top), dest)
    os.rmdir(tmp)


NOTICES = """Grimório is free software under the GNU GPL v3 (LICENSE). Source: https://github.com/hubertdungen/grimorio

This package also contains, unmodified except where noted:
- Forge 2.0.15 (forge/) — GNU GPL v3, https://github.com/Card-Forge/forge (source: tag forge-2.0.15).
  Trimmed to the files headless games need; res/ai/*.ai and a few res/cardsfolder scripts are replaced by
  Grimório's versions (build/forge/build.sh, build/forge/cards). forge-ext/ holds GrimorioSim, compiled from
  build/forge/GrimorioSim.java.
- Eclipse Temurin 17 JRE (jre/) — GPL v2 with the Classpath Exception, https://adoptium.net
{python}
Card data: Scryfall, Commander Spellbook, EDHREC, MTGTop8. Grimório is unofficial Fan Content permitted under the
Wizards of the Coast Fan Content Policy. Not approved/endorsed by Wizards.
"""


def package(platform, work, version, out):
    if not os.path.isfile(os.path.join(ROOT, "web", "dist", "index.html")):
        raise SystemExit("build the web app first: cd web && npm ci && npx vite build")
    if not os.path.isfile(os.path.join(work, "forge-ext", "GrimorioSim.class")):
        raise SystemExit("compile the Forge launcher first: GRIMORIO_DATA_DIR=WORK build/forge/build.sh")
    win = platform == "windows"
    os.makedirs(out, exist_ok=True)
    root = os.path.join(out, "Grimorio" if win else "grimorio")
    shutil.rmtree(root, ignore_errors=True)
    app = os.path.join(root, "app")
    if win:  # Grimorio.exe + _internal/ (Python 3 runtime): an app with its own window (pywebview + WebView2), no console
        icon = os.path.join(work, "icon.ico")
        subprocess.run([sys.executable, "-c", "from PIL import Image; Image.open(r'%s').save(r'%s', sizes=[(s, s) for s in "
                        "(16, 24, 32, 48, 64, 128, 256)])" % (os.path.join(ROOT, "web", "public", "icon-512.png"), icon)], check=True)
        subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir", "--windowed", "--name", "Grimorio",
                        "--icon", icon, "--python-option", "X utf8", "--distpath", out,
                        "--workpath", os.path.join(work, "pyi"), "--specpath", work,
                        *[x for m in hidden_imports() for x in ("--hidden-import", m)],
                        os.path.join(ROOT, "packaging", "launcher.py")], check=True)
    os.makedirs(app)
    for f in glob.glob(os.path.join(ROOT, "*.py")) + [os.path.join(ROOT, "packaging", "launcher.py")]:
        shutil.copy(f, app)
    shutil.copytree(os.path.join(ROOT, "web", "dist"), os.path.join(app, "web", "dist"),
                    ignore=shutil.ignore_patterns("*.gz"))
    shutil.copytree(os.path.join(work, "forge"), os.path.join(root, "forge"))
    apply_ext(os.path.join(root, "forge"), os.path.join(work, "forge-ext"))
    os.makedirs(os.path.join(root, "forge-ext"))
    for f in glob.glob(os.path.join(work, "forge-ext", "**", "*.class"), recursive=True):  # também as classes do Forge corrigidas (patches/)
        dst = os.path.join(root, "forge-ext", os.path.relpath(f, os.path.join(work, "forge-ext")))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy(f, dst)
    jre(platform, work, os.path.join(root, "jre"))
    shutil.copy(os.path.join(ROOT, "LICENSE"), root)
    with open(os.path.join(root, "THIRD-PARTY-NOTICES.txt"), "w", encoding="utf-8") as f:
        f.write(NOTICES.format(python="- Python 3 runtime (_internal/) — PSF License, https://python.org; packed with "
                               "PyInstaller (GPL v2 with the bootloader exception)\n" if win else ""))
    with open(os.path.join(root, "VERSION"), "w", encoding="utf-8") as f:
        f.write(version)
    if win:
        name = os.path.join(out, f"Grimorio-{version}-windows-x64.zip")
        with zipfile.ZipFile(name, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for d, _, fs in os.walk(root):
                for fn in fs:
                    p = os.path.join(d, fn)
                    z.write(p, os.path.relpath(p, out))
    else:
        sh = os.path.join(root, "grimorio")
        with open(sh, "w", encoding="utf-8", newline="\n") as f:
            f.write('#!/bin/sh\n# Grimório: starts it and opens the browser. Ctrl+C (or closing the terminal) stops it.\n'
                    'HERE="$(dirname "$(readlink -f "$0")")"\n'
                    'command -v python3 >/dev/null 2>&1 || { echo "Grimório needs Python 3.10 or newer: install the '
                    'python3 package (e.g. sudo apt install python3)."; exit 1; }\n'
                    'exec python3 "$HERE/app/launcher.py" "$@"\n')
        os.chmod(sh, os.stat(sh).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        name = os.path.join(out, f"grimorio-{version}-linux-x64.tar.gz")
        with tarfile.open(name, "w:gz", compresslevel=9) as t:
            t.add(root, "grimorio")
    h = hashlib.sha256()  # the launcher's automatic update only installs a package whose checksum matches
    with open(name, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    with open(name + ".sha256", "w", encoding="utf-8") as f:
        f.write(f"{h.hexdigest()}  {os.path.basename(name)}\n")
    print("package:", name, f"{os.path.getsize(name) / 1e6:.0f} MB", "unpacked", du(root), flush=True)


def data(data_dir, out):
    """data/ (cards, embeddings, 3D map, combos, tokens) + meta/ (tournament meta and the decks behind it) -> zip.
    The .gz copies are left out (the server falls back to the plain files; it runs on the same computer)."""
    os.makedirs(out, exist_ok=True)
    z = os.path.join(out, "grimorio-data.zip")
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for n in DATA_FILES:
            zf.write(os.path.join(data_dir, "data", n), f"data/{n}")
        meta = os.path.join(data_dir, "meta")
        for p in sorted(glob.glob(os.path.join(meta, "*.json")) + glob.glob(os.path.join(meta, "raw", "*.txt"))):
            zf.write(p, "meta/" + os.path.relpath(p, meta).replace(os.sep, "/"))
    h = hashlib.sha256(open(z, "rb").read()).hexdigest()
    with open(z + ".sha256", "w") as f:
        f.write(f"{h}  grimorio-data.zip\n")
    print("data:", z, f"{os.path.getsize(z) / 1e6:.1f} MB", h, flush=True)


if __name__ == "__main__":
    cmd, *a = sys.argv[1:] or ["help"]
    {"forge": forge, "package": package, "data": data}.get(cmd, lambda *_: sys.exit(__doc__))(*a)
