"""Partilhar pela internet: um túnel rápido da Cloudflare (cloudflared, grátis, sem conta, sem abrir portas no router)
dá um endereço https://….trycloudflare.com para este Grimório. guests.py trata esse endereço como de convidados:
sem convite só se vê a app, sem dados. O cloudflared usa-se do PATH ou descarrega-se do GitHub oficial da Cloudflare.
"""
import json, os, platform, re, shutil, signal, stat, subprocess, threading, time, urllib.request

STATE = {"proc": None, "pid": None, "url": None, "err": None, "dd": None}
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


def _alive(pid):
    if not pid or os.name != "posix":
        return False
    try:
        os.kill(pid, 0)
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return b"cloudflared" in f.read()
    except OSError:
        return False


def _saved(dd):
    return os.path.join(dd, "share.json")


def adopt(data_dir):
    """No arranque do servidor (Linux): o túnel de antes continua vivo (anda por conta própria) -> fica o mesmo endereço.
    Antes o registo do cloudflared ia por um pipe para o servidor; reiniciado o servidor, o pipe enchia e o túnel parava."""
    STATE["dd"] = data_dir
    try:
        with open(_saved(data_dir)) as f:
            sv = json.load(f)
    except (OSError, ValueError):
        return status()
    if _alive(sv.get("pid")) and URL_RE.fullmatch(sv.get("url") or ""):
        STATE.update(pid=sv["pid"], url=sv["url"])
    return status()


def status():
    p = STATE["proc"]
    running = bool(p and p.poll() is None) or _alive(STATE["pid"])
    return {"running": running, "url": STATE["url"] if running else None, "err": STATE["err"]}


def start(data_dir, port, host="127.0.0.1"):
    if status()["running"]:
        return status()
    STATE.update(url=None, err=None)
    try:
        exe = binary(data_dir)
    except Exception as e:  # sem rede para descarregar, sistema sem binário
        STATE["err"] = str(e) if isinstance(e, RuntimeError) else "Não consegui descarregar o cloudflared."
        return status()
    # o servidor ouve em 127.0.0.1 (pacotes) ou em 0.0.0.0; só se --host for um IP da rede é que o túnel vai lá
    # Windows: sem janela de consola (a app não tem consola) e sem herdar um stdin que não existe
    target = "127.0.0.1" if host in ("0.0.0.0", "", "::", "localhost") else host
    # o registo vai para um ficheiro (num pipe, sem o servidor a ler — depois de reiniciar — enchia e o túnel parava)
    log = os.path.join(data_dir, "cloudflared.log")
    with open(log, "w") as lf:
        p = subprocess.Popen([exe, "tunnel", "--url", f"http://{target}:{port}", "--no-autoupdate"], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=lf, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                             start_new_session=os.name == "posix")  # sobrevive a reiniciar o servidor (Linux); no Windows fecha com a app
    STATE.update(proc=p, pid=None, dd=data_dir)

    def watch():  # o endereço aparece no registo do cloudflared ao fim de uns segundos
        for _ in range(120):
            try:
                with open(log, errors="replace") as f:
                    m = URL_RE.search(f.read())
            except OSError:
                m = None
            if m:
                STATE["url"] = m.group(0)
                try:
                    with open(_saved(data_dir), "w") as f:
                        json.dump({"pid": p.pid, "url": STATE["url"]}, f)
                except OSError:
                    pass
                return
            if p.poll() is not None:
                break
            time.sleep(0.5)
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
    elif _alive(STATE["pid"]):  # o túnel adotado no arranque
        os.kill(STATE["pid"], signal.SIGTERM)
    if STATE["dd"]:
        try:
            os.remove(_saved(STATE["dd"]))
        except OSError:
            pass
    STATE.update(proc=None, pid=None, url=None)
    return status()


def route(method, path, data_dir, port, host="127.0.0.1"):
    """GET /api/share -> estado; POST /api/share/start | /api/share/stop."""
    if method == "GET" and path == "/api/share":
        return 200, status()
    if method == "POST" and path == "/api/share/start":
        return 200, start(data_dir, port, host)
    if method == "POST" and path == "/api/share/stop":
        return 200, stop()
    return 404, {"erro": "rota desconhecida"}


if __name__ == "__main__":  # verificação sem rede
    assert URL_RE.search("INF |  https://abc-def-12.trycloudflare.com  |").group(0) == "https://abc-def-12.trycloudflare.com"
    assert status() == {"running": False, "url": None, "err": None}
    import tempfile
    with tempfile.TemporaryDirectory() as d:  # adotar: só um cloudflared vivo com um endereço válido
        with open(_saved(d), "w") as f:
            json.dump({"pid": os.getpid(), "url": "https://a-b.trycloudflare.com"}, f)
        assert adopt(d)["running"] is False  # o pid é deste python, não de um cloudflared
    print("selfcheck ok")
