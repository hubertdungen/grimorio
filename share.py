"""Partilhar pela internet: um túnel rápido da Cloudflare (cloudflared, grátis, sem conta, sem abrir portas no router)
dá um endereço https://….trycloudflare.com para este Grimório. guests.py trata esse endereço como de convidados:
sem convite só se vê a app, sem dados. O cloudflared usa-se do PATH ou descarrega-se do GitHub oficial da Cloudflare.
"""
import os, platform, re, shutil, stat, subprocess, threading, urllib.request

STATE = {"proc": None, "url": None, "err": None}
REL = "https://github.com/cloudflare/cloudflared/releases/latest/download/"
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def _asset():
    m = platform.machine().lower()
    arch = "arm64" if m in ("aarch64", "arm64") else "arm" if m.startswith("arm") else "amd64"
    if os.name == "nt":
        return "cloudflared-windows-amd64.exe"
    if platform.system() == "Linux":
        return f"cloudflared-linux-{arch}"
    return None  # macOS: vem em .tgz — instala-se com o brew


def binary(data_dir):
    found = shutil.which("cloudflared")
    if found:
        return found
    path = os.path.join(data_dir, "bin", "cloudflared.exe" if os.name == "nt" else "cloudflared")
    if os.path.isfile(path):
        return path
    asset = _asset()
    if not asset:
        raise RuntimeError("Instala o cloudflared (ex.: brew install cloudflared) e tenta outra vez.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with urllib.request.urlopen(REL + asset, timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    os.chmod(tmp, os.stat(tmp).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    os.replace(tmp, path)
    return path


def status():
    p = STATE["proc"]
    running = bool(p and p.poll() is None)
    return {"running": running, "url": STATE["url"] if running else None, "err": STATE["err"]}


def start(data_dir, port):
    if status()["running"]:
        return status()
    STATE.update(url=None, err=None)
    try:
        exe = binary(data_dir)
    except Exception as e:  # sem rede para descarregar, sistema sem binário
        STATE["err"] = str(e) if isinstance(e, RuntimeError) else "Não consegui descarregar o cloudflared."
        return status()
    p = subprocess.Popen([exe, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="replace")
    STATE["proc"] = p

    def watch():  # o endereço aparece no registo do cloudflared ao fim de uns segundos
        for line in p.stderr:
            m = URL_RE.search(line)
            if m and not STATE["url"]:
                STATE["url"] = m.group(0)
        if not STATE["url"]:
            STATE["err"] = "O túnel não arrancou (sem internet?)."
    threading.Thread(target=watch, daemon=True).start()
    return status()


def stop():
    p = STATE["proc"]
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
    STATE.update(proc=None, url=None)
    return status()


def route(method, path, data_dir, port):
    """GET /api/share -> estado; POST /api/share/start | /api/share/stop."""
    if method == "GET" and path == "/api/share":
        return 200, status()
    if method == "POST" and path == "/api/share/start":
        return 200, start(data_dir, port)
    if method == "POST" and path == "/api/share/stop":
        return 200, stop()
    return 404, {"erro": "rota desconhecida"}


if __name__ == "__main__":  # verificação sem rede
    assert URL_RE.search("INF |  https://abc-def-12.trycloudflare.com  |").group(0) == "https://abc-def-12.trycloudflare.com"
    assert status() == {"running": False, "url": None, "err": None}
    print("selfcheck ok")
