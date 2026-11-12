"""Partilhar pela internet: um túnel rápido da Cloudflare (cloudflared, grátis, sem conta, sem abrir portas no router)
dá um endereço https://….trycloudflare.com para este Grimório. guests.py trata esse endereço como de convidados:
sem convite só se vê a app, sem dados. O cloudflared usa-se do PATH ou descarrega-se do GitHub oficial da Cloudflare.
"""
import json, os, platform, re, shutil, signal, stat, subprocess, threading, time, urllib.request

STATE = {"proc": None, "pid": None, "url": None, "err": None, "dd": None}
# endereço público próprio (Definições › Amigos): um URL fixo — túnel com nome da Cloudflare (com o token dele), Tailscale
# Funnel, um proxy… — que passa a ser o dos convites; sem ele, o túnel rápido (endereço ao acaso a cada arranque)
CFG = {"url": None, "token": None}
OWN_RE = re.compile(r"https://[A-Za-z0-9.-]{1,200}(:\d{1,5})?")
TOKEN_RE = re.compile(r"[A-Za-z0-9=._+/-]{20,600}")
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
    if os.environ.get("GRIMORIO_ANDROID"):  # o Android não deixa uma app correr programas descarregados
        raise RuntimeError("A partilha pela internet não está disponível na app Android: aloja a sala num computador ou servidor com o Grimório.")
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


def _cfg_path(dd):
    return os.path.join(dd, "share-settings.json")


def custom_url():
    return CFG["url"]


def custom_host():
    u = CFG["url"]
    return u.split("://", 1)[1].split(":")[0].lower() if u else None


def settings(data_dir, url=None, token=None):
    """Guarda o endereço próprio (url "" apaga; token None mantém, "" apaga). Erros de validação -> ValueError."""
    if url is not None:
        url = str(url).strip().rstrip("/")
        if url and not OWN_RE.fullmatch(url):
            raise ValueError("O endereço tem de ser https://… (só o domínio, sem caminho).")
        host = url.split("://", 1)[1].split(":")[0].lower() if url else ""
        if host in ("localhost",) or host.startswith("127.") or host.endswith(".trycloudflare.com"):
            raise ValueError("Esse endereço não serve: tem de ser um endereço público fixo.")
        CFG["url"] = url or None
    if token is not None:
        token = str(token).strip()
        if token and not TOKEN_RE.fullmatch(token):
            raise ValueError("O token do túnel não parece válido (copia-o do painel da Cloudflare: cloudflared … run --token <token>).")
        CFG["token"] = token or None
    if not CFG["url"]:
        CFG["token"] = None  # sem endereço não há túnel com nome
    p = _cfg_path(data_dir)
    with open(p, "w") as f:
        json.dump(CFG, f)
    try:
        os.chmod(p, 0o600)  # o token dá acesso ao túnel: só o dono lê
    except OSError:
        pass
    return {"url": CFG["url"], "token": bool(CFG["token"])}


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
        with open(_cfg_path(data_dir)) as f:
            c = json.load(f)
        CFG.update(url=c.get("url") if OWN_RE.fullmatch(str(c.get("url") or "")) else None, token=c.get("token") or None)
    except (OSError, ValueError):
        pass
    try:
        with open(_saved(data_dir)) as f:
            sv = json.load(f)
    except (OSError, ValueError):
        return status()
    if _alive(sv.get("pid")) and URL_RE.fullmatch(sv.get("url") or ""):
        STATE.update(pid=sv["pid"], url=sv["url"])
    return status()


def status():
    if CFG["url"] and not CFG["token"]:  # endereço próprio sem túnel daqui (Tailscale Funnel, proxy): está sempre lá
        return {"running": True, "url": CFG["url"], "err": None, "fixed": True}
    p = STATE["proc"]
    running = bool(p and p.poll() is None) or _alive(STATE["pid"])
    return {"running": running, "url": STATE["url"] if running else None, "err": STATE["err"], **({"fixed": True} if CFG["url"] else {})}


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
    named = bool(CFG["url"] and CFG["token"])  # túnel com nome: o endereço é o dele; o token vai pelo ambiente (não aparece no ps)
    args = [exe, "tunnel", "--no-autoupdate", "run"] if named else [exe, "tunnel", "--url", f"http://{target}:{port}", "--no-autoupdate"]
    env = {**os.environ, "TUNNEL_TOKEN": CFG["token"]} if named else None
    with open(log, "w") as lf:
        p = subprocess.Popen(args, stdin=subprocess.DEVNULL, env=env,
                             stdout=subprocess.DEVNULL, stderr=lf, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                             start_new_session=os.name == "posix")  # sobrevive a reiniciar o servidor (Linux); no Windows fecha com a app
    STATE.update(proc=p, pid=None, dd=data_dir)
    if named:
        STATE["url"] = CFG["url"]
        try:
            with open(_saved(data_dir), "w") as f:
                json.dump({"pid": p.pid, "url": CFG["url"]}, f)
        except OSError:
            pass
        return status()

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


def route(method, path, data_dir, port, host="127.0.0.1", data=None):
    """GET /api/share -> estado; POST /api/share/start | /api/share/stop."""
    if method == "GET" and path == "/api/share":
        return 200, status()
    if method == "POST" and path == "/api/share/start":
        return 200, start(data_dir, port, host)
    if method == "POST" and path == "/api/share/stop":
        return 200, stop()
    if path == "/api/share/settings":  # o endereço público próprio (só o dono: /api/share não é de convidados)
        if method == "GET":
            return 200, {"url": CFG["url"], "token": bool(CFG["token"])}
        if method == "POST":
            d = data or {}
            was = (CFG["url"], CFG["token"])
            try:
                out = settings(data_dir, d.get("url"), d.get("token"))
            except ValueError as e:
                return 400, {"erro": str(e)}
            if was != (CFG["url"], CFG["token"]) and (STATE["proc"] or STATE["pid"]):
                stop()  # o túnel que estava aberto era do modo antigo: abre-se outra vez à mão
            return 200, out
    return 404, {"erro": "rota desconhecida"}


if __name__ == "__main__":  # verificação sem rede
    assert URL_RE.search("INF |  https://abc-def-12.trycloudflare.com  |").group(0) == "https://abc-def-12.trycloudflare.com"
    assert status() == {"running": False, "url": None, "err": None}
    import tempfile as _t
    with _t.TemporaryDirectory() as d:  # endereço próprio: validação, ficheiro só do dono, estado «fixo»
        for bad in ("http://x.pt", "https://x.pt/caminho", "https://localhost", "https://abc.trycloudflare.com"):
            try:
                settings(d, bad)
                raise AssertionError(bad)
            except ValueError:
                pass
        assert settings(d, "https://jogos.exemplo.pt/") == {"url": "https://jogos.exemplo.pt", "token": False} and custom_host() == "jogos.exemplo.pt"
        assert status() == {"running": True, "url": "https://jogos.exemplo.pt", "err": None, "fixed": True}
        assert oct(os.stat(_cfg_path(d)).st_mode & 0o777) == "0o600"
        settings(d, "")
        assert custom_url() is None and status()["running"] is False
    import tempfile
    with tempfile.TemporaryDirectory() as d:  # adotar: só um cloudflared vivo com um endereço válido
        with open(_saved(d), "w") as f:
            json.dump({"pid": os.getpid(), "url": "https://a-b.trycloudflare.com"}, f)
        assert adopt(d)["running"] is False  # o pid é deste python, não de um cloudflared
    print("selfcheck ok")
