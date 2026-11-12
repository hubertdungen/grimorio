"""Ligar este Grimório ao TEU servidor Grimório (opcional): sincronizar por link, ou abrir o servidor diretamente.

A base é sempre local: tudo o que se faz fica na SQLite deste aparelho e funciona sem rede. Ligar a um servidor (o Grimório
de um NAS, de um PC sempre ligado…) é um extra que se escolhe na primeira vez que se abre a app ou em Definições › Dados.

No servidor (Definições › Dados › «Ligar um aparelho»): o dono gera um código curto (8 letras, 15 minutos, uma só vez)
e um link <servidor>/ligar/<código> (+ QR). Os aparelhos ligados ficam numa lista própria (tabela `devices`, só o hash do
token) e podem ser revogados a qualquer momento — à parte dos convites dos amigos (guests.py), com outro âmbito: um
aparelho só fala com /api/device/*, só vê e junta os dados do dono que o ligou.

No aparelho: cola-se o link (ou endereço + código) -> POST <servidor>/api/device/pair -> fica com um token em
<dados>/storage.json (só para este utilizador do sistema). Daí em diante, de CHECK em CHECK segundos (e com «Sincronizar
agora»):
  1. GET /api/device/hello -> versões, a impressão digital (fingerprint) dos dados do dono e o progresso dos torneios lá;
     se nada mudou dos dois lados desde a última vez, acaba aqui (um pedido pequeno);
  2. POST /api/device/sync com a cópia deste aparelho (backup.snapshot: só os dados do perfil ligado, sem o que é desta
     instalação, sem os torneios que o servidor já tem iguais ou mais avançados — o delta do que pesa); o servidor junta-a
     (as mesmas regras da pasta na nuvem: backup.merge, com o dono dele), guarda-a no lugar deste aparelho
     (<dados>/devices/<id>.grimorio) e responde com a cópia dele (sem os torneios que o aparelho já tem);
  3. o aparelho junta a resposta. Os donos trocam-se nas duas pontas (backup.reown): o perfil «local» deste aparelho é
     o «hubert» do servidor.
Sem rede: continua tudo a funcionar aqui; volta a tentar com espera crescente (BACKOFF) e o estado diz «sem ligação».
Versões diferentes: cada lado diz o que sabe juntar (backup.LEVEL/NEEDS); se um não souber, nada se junta e a mensagem
diz qual atualizar e para que versão.

«Abrir o meu servidor» (pacotes para computador): com `open` a janela do launcher abre o servidor em vez do Grimório
local; os dados deste aparelho ficam intactos (e continuam a sincronizar, para quando não houver rede).

Para a app Android e o launcher: GET /api/storage -> {mode: local|folder|server|remote, remote_url, sync: {...}} (ver
storage_status).
"""
import hashlib, html, ipaddress, json, os, re, secrets, socket, sqlite3, sys, tempfile, threading, time, urllib.error, urllib.parse, urllib.request, zipfile

import backup
import guests

API = 1  # forma das rotas /api/device/*: sobe se mudarem de forma incompatível
CODE_TTL = 15 * 60
ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sem 0/O, 1/I/L: lê-se e escreve-se sem enganos
MAX_BODY = 400_000_000
CHECK = 30  # segundos entre verificações (hello) quando tudo está bem
BACKOFF = (15, 30, 60, 120, 300, 600, 900)
LINK = re.compile(r"^\s*(https?://[^\s?#]+?)/ligar/([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})/?(?:[?#]\S*)?\s*$")
CODE = re.compile(r"^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$")
DEV_PATH = re.compile(r"^/api/devices(?:/([a-f0-9]{12})(/revoke)?|/(code))?$")
CLOCK = threading.RLock()   # storage.json (ler-mudar-gravar)
TLOCK = threading.Lock()    # uma sincronização de cada vez
DATA = None


def _h(x):
    return hashlib.sha256(str(x).encode()).hexdigest()


def norm_code(c):
    return re.sub(r"[^A-Z0-9]", "", str(c or "").upper())[:8]


# ---------- servidor: aparelhos ligados ----------

def init_db(con):
    con.execute("CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, owner TEXT, name TEXT, token TEXT UNIQUE, created REAL,"
                " revoked REAL, last_seen REAL, last_merge REAL, app TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS device_codes (code TEXT PRIMARY KEY, owner TEXT, created REAL, expires REAL, used REAL)")


def owner_name(con, owner):
    try:
        r = con.execute("SELECT name FROM profiles WHERE id=?", (owner,)).fetchone()
    except sqlite3.Error:
        r = None
    return (r and r[0]) or owner


def owner_route(con, method, path, owner, body):
    """GET /api/devices -> {devices}; POST /api/devices/code -> {code, expires}; POST /<id>/revoke; DELETE /<id>."""
    init_db(con)
    m = DEV_PATH.match(path)
    if not m or not owner:
        return 404, {"erro": "rota desconhecida"}
    did = m.group(1)
    if method == "GET" and not did and not m.group(3):
        rows = con.execute("SELECT id, name, created, revoked, last_seen, last_merge, app FROM devices WHERE owner=? ORDER BY created DESC", (owner,)).fetchall()
        return 200, {"devices": [dict(zip(("id", "name", "created", "revoked", "last_seen", "last_merge", "app"), r)) for r in rows]}
    if method == "POST" and m.group(3):
        con.execute("DELETE FROM device_codes WHERE expires < ?", (time.time() - 86400,))
        if con.execute("SELECT COUNT(*) FROM device_codes WHERE owner=? AND used IS NULL AND expires > ?", (owner, time.time())).fetchone()[0] >= 5:
            return 429, {"erro": "Já tens 5 códigos por usar: espera que acabem (15 minutos) ou usa um deles."}
        code = "".join(secrets.choice(ALPHA) for _ in range(8))
        con.execute("INSERT INTO device_codes VALUES (?,?,?,?,NULL)", (_h(code), owner, time.time(), time.time() + CODE_TTL))
        return 201, {"code": f"{code[:4]}-{code[4:]}", "expires": time.time() + CODE_TTL}
    if method == "POST" and did and m.group(2):
        n = con.execute("UPDATE devices SET revoked=? WHERE id=? AND owner=? AND revoked IS NULL", (time.time(), did, owner)).rowcount
        return (200, {"ok": True}) if n else (404, {"erro": "não existe"})
    if method == "DELETE" and did:
        n = con.execute("DELETE FROM devices WHERE id=? AND owner=?", (did, owner)).rowcount
        return (200, {"ok": True}) if n else (404, {"erro": "não existe"})
    return 404, {"erro": "rota desconhecida"}


def device_of(con, headers):
    tok = guests.bearer(headers)
    if not tok.startswith("gd_"):
        return None
    init_db(con)
    r = con.execute("SELECT id, owner, name, last_merge FROM devices WHERE token=? AND revoked IS NULL", (_h(tok),)).fetchone()
    return r and {"id": r[0], "owner": r[1], "name": r[2], "last_merge": r[3] or 0}


def _ip(h):
    return (h.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or h.client_address[0]


def _pair(h, con, d):
    """POST /api/device/pair {code, name, app, level} -> {token, id, owner, owner_name, …}: troca o código (uma vez) pelo token."""
    if guests.slow(f"pair:{_ip(h)}", 10, 60):
        return 429, {"erro": "Demasiadas tentativas: espera um minuto.", "code": "slow"}
    code = norm_code((d or {}).get("code"))
    init_db(con)
    r = con.execute("SELECT owner FROM device_codes WHERE code=? AND used IS NULL AND expires > ?", (_h(code), time.time())).fetchone() if len(code) == 8 else None
    if not r:
        return 403, {"erro": "Este código não é válido ou já foi usado (dura 15 minutos e serve uma vez): gera outro no servidor.", "code": "code"}
    did, tok = secrets.token_hex(6), "gd_" + secrets.token_urlsafe(32)
    name = re.sub(r"[\x00-\x1f<>]", "", str(d.get("name") or "aparelho"))[:60] or "aparelho"
    con.execute("UPDATE device_codes SET used=? WHERE code=?", (time.time(), _h(code)))
    con.execute("INSERT INTO devices (id, owner, name, token, created, revoked, last_seen, last_merge, app) VALUES (?,?,?,?,?,NULL,?,0,?)",
                (did, r[0], name, _h(tok), time.time(), time.time(), str(d.get("app") or "")[:20]))
    return 201, {"token": tok, "id": did, "owner": r[0], "owner_name": owner_name(con, r[0]), **_versions(con)}


def _versions(con=None):
    return {"api": API, "level": backup.LEVEL, "needs": backup.NEEDS, "version": backup.app_version(),
            **({"hid": guests.host_id(con)} if con is not None else {})}


def route(h, method, path, data_dir, db):
    """Rotas públicas (autenticadas pelo código ou pelo token do aparelho): /api/device/pair|hello|sync|bye e /ligar/<código>.
    Devolve True se tratou o pedido."""
    if path.startswith("/ligar/") and method == "GET":
        code, _, act = path[len("/ligar/"):].partition("/")
        if act == "info":
            if guests.slow(f"pair:{_ip(h)}", 30, 60):
                h.json({"erro": "Demasiadas tentativas: espera um minuto."}, 429)
                return True
            with db() as con:
                init_db(con)
                ok = bool(con.execute("SELECT 1 FROM device_codes WHERE code=? AND used IS NULL AND expires > ?", (_h(norm_code(code)), time.time())).fetchone())
                h.json({"kind": "aparelho", "valid": ok, **_versions(con)})
            return True
        h.send(200, link_page(h, code).encode(), "text/html; charset=utf-8", {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
        return True
    if not path.startswith("/api/device/"):
        return False
    act = path[len("/api/device/"):]
    if method == "POST" and act == "pair":
        try:
            d = h.body(10_000)
        except ValueError as e:
            h.json({"erro": str(e)}, 400)
            return True
        with db() as con:
            h.json(*reversed(_pair(h, con, d if isinstance(d, dict) else {})))
        return True
    with db() as con:
        dev = device_of(con, h.headers)
        if dev:
            con.execute("UPDATE devices SET last_seen=? WHERE id=?", (time.time(), dev["id"]))
    if not dev:
        h.json({"erro": "Este aparelho já não está ligado a este servidor (foi revogado?): liga-o outra vez.", "code": "revoked"}, 401)
        return True
    if guests.slow(f"devsync:{dev['id']}", 40, 60):
        h.json({"erro": "Demasiados pedidos: espera um minuto.", "code": "slow"}, 429)
        return True
    if method == "GET" and act == "hello":
        with db() as con:
            h.json({**_versions(con), "fp": _h(backup.fingerprint(data_dir, dev["owner"])), "have": backup.progress(con, dev["owner"]),
                    "device": {"id": dev["id"], "name": dev["name"]}, "owner": dev["owner"], "owner_name": owner_name(con, dev["owner"])})
        return True
    if method == "POST" and act == "bye":  # o aparelho deixou de sincronizar: o token deixa de servir
        with db() as con:
            con.execute("UPDATE devices SET revoked=? WHERE id=?", (time.time(), dev["id"]))
        h.json({"ok": True})
        return True
    if method == "POST" and act == "sync":
        serve_sync(h, data_dir, db, dev)
        return True
    h.json({"erro": "rota desconhecida"}, 404)
    return True


def serve_sync(h, data_dir, db, dev):
    """Junta a cópia do aparelho (corpo) e responde com a deste servidor para o mesmo dono."""
    n = int(h.headers.get("Content-Length") or 0)
    if not 0 < n <= MAX_BODY:
        return h.json({"erro": f"Cópia vazia ou grande demais (máximo {MAX_BODY // 1_000_000} MB).", "code": "size"}, 413)
    slots = os.path.join(data_dir, "devices")
    os.makedirs(slots, exist_ok=True)
    fd, up = tempfile.mkstemp(prefix="dev-up-", suffix=".grimorio", dir=slots)
    out = up + ".out"
    try:
        with os.fdopen(fd, "wb") as f:
            left = n
            while left:
                chunk = h.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left:
            return h.json({"erro": "A cópia chegou incompleta.", "code": "size"}, 400)
        try:
            with zipfile.ZipFile(up) as z:
                man = json.loads(z.read("manifest.json"))
            backup.check_manifest(man)
            have = man.get("have") if isinstance(man.get("have"), dict) else {}
            t0 = time.time()
            st = backup.import_file(data_dir, up, "merge", owner=dev["owner"], since=dev["last_merge"], keep=3600, as_owner=dev["owner"])
        except backup.TooNew as e:
            return h.json({"erro": str(e), "code": "newer", "version": e.version, "side": "server"}, 409)
        except (ValueError, zipfile.BadZipFile, KeyError) as e:
            return h.json({"erro": str(e) or "Cópia inválida.", "code": "bad"}, 400)
        os.replace(up, os.path.join(slots, f"{dev['id']}.grimorio"))  # o lugar deste aparelho (a última cópia que mandou)
        with db() as con:
            con.execute("UPDATE devices SET last_merge=? WHERE id=?", (t0, dev["id"]))
        backup.snapshot(data_dir, out, owner=dev["owner"], device="server", scrub=True, skip=have)
        with open(out, "rb") as f:
            body = f.read()
        stats = {k: st.get(k) for k in ("decks_new", "decks_updated", "tournaments", "rating_games", "deleted")} | {"conflicts": len(st.get("conflicts") or [])}
        return h.send(200, body, "application/octet-stream", {"X-Grimorio-Fp": _h(backup.fingerprint(data_dir, dev["owner"])),
                                                              "X-Grimorio-Stats": json.dumps(stats)})
    finally:
        for f in (up, out):
            if os.path.exists(f):
                os.remove(f)


PAGE = {
    "pt": ("Ligar um aparelho", "Abre o Grimório no aparelho que queres ligar e vai a Definições › Dados › «Ligar ao meu servidor Grimório»."
           " Cola lá este link ou escreve o endereço e o código:", "Abrir na app Grimório", "O código dura 15 minutos e só serve uma vez."),
    "en": ("Connect a device", "Open Grimório on the device you want to connect and go to Settings › Data › “Connect to my Grimório server”."
           " Paste this link there, or type the address and the code:", "Open in the Grimório app", "The code lasts 15 minutes and works only once."),
    "es": ("Conectar un dispositivo", "Abre Grimório en el dispositivo que quieres conectar y ve a Ajustes › Datos › «Conectar a mi servidor Grimório»."
           " Pega allí este enlace o escribe la dirección y el código:", "Abrir en la app Grimório", "El código dura 15 minutos y solo sirve una vez."),
    "de": ("Gerät verbinden", "Öffne Grimório auf dem Gerät, das du verbinden willst, und gehe zu Einstellungen › Daten › „Mit meinem Grimório-Server verbinden“."
           " Füge dort diesen Link ein oder gib Adresse und Code ein:", "In der Grimório-App öffnen", "Der Code gilt 15 Minuten und nur einmal."),
    "zh": ("连接设备", "在要连接的设备上打开 Grimório，进入 设置 › 数据 › “连接到我的 Grimório 服务器”。在那里粘贴此链接，或输入地址和代码：",
           "在 Grimório 应用中打开", "代码有效期 15 分钟，只能使用一次。"),
}


def link_page(h, code):
    """/ligar/<código> aberto num browser: diz o que fazer com ele (e abre a app, se estiver instalada)."""
    L = guests.lang(h)
    L = L if L in PAGE else "en"
    title, how, btn, note = PAGE[L]
    host = h.headers.get("X-Forwarded-Host") or h.headers.get("Host") or ""
    proto = "https" if (h.headers.get("X-Forwarded-Proto") or "").lower() == "https" else "http"
    c = norm_code(code)
    link = f"{proto}://{host}/ligar/{c[:4]}-{c[4:]}"
    e = html.escape
    return (f"<!doctype html><html lang={e(L)}><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{e(title)} · Grimório</title><style>body{{font:16px/1.5 system-ui,sans-serif;background:#0b0a14;color:#ece9f6;margin:0;padding:24px 16px}}"
            "main{max-width:520px;margin:auto}code,input{font:600 1.1em ui-monospace,monospace}input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;"
            "border:1px solid #3a3550;background:#16142a;color:inherit}.code{font-size:2em;letter-spacing:.15em;margin:12px 0}"
            "a.b{display:inline-block;margin-top:14px;padding:10px 16px;border-radius:10px;background:#7c5cff;color:#fff;text-decoration:none}"
            ".m{color:#a59fc0;font-size:.9em}</style><main>"
            f"<h1>🔗 {e(title)}</h1><p>{e(how)}</p><input readonly value='{e(link)}' onclick='this.select()'>"
            f"<p class=m>{e(proto)}://{e(host)}</p><div class=code><code>{e(c[:4])}-{e(c[4:])}</code></div>"
            f"<a class=b href='grimorio://ligar?u={e(urllib.parse.quote(link, safe=''))}'>{e(btn)}</a><p class=m>{e(note)}</p></main></html>")


# ---------- aparelho: ligação e sincronização ----------

def cfg_path(data_dir):
    return os.path.join(data_dir, "storage.json")


def load(data_dir):
    try:
        with open(cfg_path(data_dir), encoding="utf-8") as f:
            c = json.load(f)
    except (OSError, ValueError):
        c = {}
    return {"chosen": False, "server": None, **(c if isinstance(c, dict) else {})}


def save(data_dir, c):
    tmp = cfg_path(data_dir) + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)  # tem o token do aparelho: só para quem corre o Grimório
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False, indent=1)
    os.replace(tmp, cfg_path(data_dir))


def insecure(url):
    """http:// para um endereço da internet (o código e os dados passavam às claras). Rede de casa, meshnet/Tailscale
    (100.64.0.0/10), .local/.lan e nomes sem ponto contam como seguros o suficiente."""
    u = urllib.parse.urlsplit(url)
    if u.scheme != "http":
        return False
    host = (u.hostname or "").lower()
    if not host or "." not in host or host == "localhost" or host.endswith((".local", ".lan", ".home", ".internal", ".home.arpa")):
        return False
    try:
        ip = ipaddress.ip_address(host)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip in ipaddress.ip_network("100.64.0.0/10"))
    except ValueError:
        return True


def parse_link(link="", url="", code=""):
    """O link (<servidor>/ligar/ABCD-EFGH) ou o endereço + o código -> (base, código) ou ValueError."""
    m = LINK.match(str(link or ""))
    if m:
        return m.group(1).rstrip("/"), norm_code(m.group(2))
    base = str(url or link or "").strip().rstrip("/")
    if base and not re.match(r"^https?://", base, re.I):
        base = "http://" + base
    if not re.match(r"^https?://[^\s/?#]+(?:/[^\s?#]*)?$", base) or not CODE.match(str(code or "").strip()):
        raise ValueError("Cola o link que o servidor mostra (…/ligar/ABCD-EFGH) ou escreve o endereço e o código.")
    return base, norm_code(code)


class Remote(Exception):
    def __init__(self, status, msg, code=None, extra=None):
        super().__init__(msg)
        self.status, self.code, self.extra = status, code, extra or {}


def _call(base, path, token=None, data=None, ctype="application/json", timeout=20, out=None, length=None):
    """Pedido ao servidor -> (corpo ou None se foi para `out`, cabeçalhos). data pode ser um ficheiro aberto (com length).
    Erros -> Remote (com o código do servidor)."""
    h = {"User-Agent": f"Grimorio/{backup.app_version()} (sync)", "Accept": "application/json, application/octet-stream"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if data is not None:
        h["Content-Type"] = ctype
        if length is not None:
            h["Content-Length"] = str(length)
    req = urllib.request.Request(base + path, data, h, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ct = r.headers.get("Content-Type") or ""
            if "text/html" in ct:  # um proxy com login (Authelia…) respondeu com a página dele
                raise Remote(502, "O servidor respondeu com uma página de login: o proxy tem de deixar passar /api/device/ e /ligar/ sem login (o token do aparelho já protege).", "proxy")
            if out:
                with open(out, "wb") as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
                return None, r.headers
            return r.read(50_000_000), r.headers
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read(100_000) or b"{}")
        except ValueError:
            j = {}
        raise Remote(e.code, j.get("erro") or f"O servidor respondeu {e.code}.", j.get("code"), j)
    except (urllib.error.URLError, OSError, socket.timeout) as e:
        raise Remote(0, f"Sem ligação ao servidor ({getattr(e, 'reason', e)}).", "offline")


def _json(b):
    try:
        j = json.loads(b or b"{}")
    except ValueError:
        j = None
    if not isinstance(j, dict):
        raise Remote(502, "Isto não parece um servidor Grimório (resposta estranha).", "bad")
    return j


def compat(info):
    """O que falta atualizar entre este aparelho e o servidor: None, ('device', versão) ou ('server', versão)."""
    if int(info.get("needs") or 1) > backup.LEVEL:
        return ("device", str(info.get("version") or "?"))
    if backup.NEEDS > int(info.get("level") or 1):
        return ("server", backup.app_version())
    return None


def pair(data_dir, owner, link="", url="", code="", open_=False, name=None, insecure_ok=False):
    """Liga este aparelho ao servidor (troca o código pelo token) e começa a sincronizar. Devolve storage_status-ish."""
    base, c = parse_link(link, url, code)
    if insecure(base) and not insecure_ok:
        raise Remote(409, "Este endereço é http:// pela internet: o código e os teus dados passam sem cifra. Usa https:// (ou a rede de casa / meshnet).", "http")
    info = _json(_call(base, "/api/device/pair", data=json.dumps({"code": c, "name": name or device_name(), "app": backup.app_version(),
                                                                    "level": backup.LEVEL}).encode())[0])
    if not str(info.get("token") or "").startswith("gd_"):
        raise Remote(502, "Isto não parece um servidor Grimório (resposta estranha).", "bad")
    with CLOCK:
        cfg = load(data_dir)
        old = cfg.get("server") or {}
        cfg["chosen"] = True
        cfg["server"] = {"url": base, "token": info["token"], "id": info.get("id"), "owner": owner, "remote_owner": info.get("owner"),
                         "name": info.get("owner_name") or info.get("owner"), "hid": info.get("hid"), "version": info.get("version"),
                         "on": True, "open": bool(open_), "since": 0, "state": "syncing", "paired": time.time(),
                         "insecure": insecure(base)}
        save(data_dir, cfg)
    if old.get("token") and old.get("url"):
        _bye(old)
    _folder_off(data_dir)
    threading.Thread(target=tick, args=(data_dir, True), daemon=True).start()
    return cfg["server"]


def device_name():
    host = re.sub(r"[^A-Za-z0-9 ._-]+", "", socket.gethostname())[:40]
    return host or "aparelho"


def _bye(s):
    try:
        _call(s["url"], "/api/device/bye", s.get("token"), b"{}", timeout=5)
    except Remote:
        pass  # sem rede: o dono revoga-o no servidor, se quiser


def _folder_off(data_dir):
    with backup.LOCK:
        c = backup.load(data_dir)
        if c.get("on"):
            c["on"] = False
            backup.save(data_dir, c)


def unpair(data_dir):
    with CLOCK:
        cfg = load(data_dir)
        s = cfg.get("server") or {}
        cfg["server"] = None
        save(data_dir, cfg)
    if s.get("token"):
        threading.Thread(target=_bye, args=(s,), daemon=True).start()


def _update(data_dir, token, **kv):
    """Grava o estado da sincronização (só se o aparelho ainda for o mesmo: entretanto podem tê-lo desligado)."""
    with CLOCK:
        cfg = load(data_dir)
        s = cfg.get("server")
        if s and s.get("token") == token:
            s.update(kv)
            save(data_dir, cfg)
        return s


def tick(data_dir, force=False):
    """Uma volta da sincronização com o servidor (ver o topo). Nunca levanta: o estado fica em storage.json."""
    if not TLOCK.acquire(blocking=force):
        return None
    try:
        s = (load(data_dir).get("server") or {})
        if not s.get("on") or not s.get("token"):
            return None
        now = time.time()
        if not force and now < (s.get("next") or 0):
            return s
        base, token, own = s["url"], s["token"], s.get("owner")
        try:
            hello = _json(_call(base, "/api/device/hello", token)[0])
            bad = compat(hello)
            if bad:
                return _update(data_dir, token, state="incompatible", side=bad[0], need=bad[1], last_try=now, next=now + 3600,
                               err=None, version=hello.get("version"))
            fp_local = backup.fingerprint(data_dir, own)
            if not force and hello.get("fp") and hello["fp"] == s.get("fp_pull") and fp_local == s.get("fp_push"):
                return _update(data_dir, token, state="ok", last_ok=now, last_try=now, fails=0, next=now + CHECK, err=None,
                               version=hello.get("version"), name=hello.get("owner_name") or s.get("name"))
            _update(data_dir, token, state="syncing", last_try=now)
            fd, push = tempfile.mkstemp(prefix="dev-push-", suffix=".grimorio", dir=data_dir)
            os.close(fd)
            pull = push + ".in"
            try:
                backup.snapshot(data_dir, push, owner=own, device=device_name(), scrub=True,
                                skip=hello.get("have") if isinstance(hello.get("have"), dict) else None)
                with open(push, "rb") as f:
                    _, hd = _call(base, "/api/device/sync", token, f, "application/octet-stream", timeout=600, out=pull, length=os.path.getsize(push))
                st = backup.import_file(data_dir, pull, "merge", owner=own, since=s.get("since") or 0, keep=3600, as_owner=own)
            finally:
                for f in (push, pull):
                    if os.path.exists(f):
                        os.remove(f)
            done = time.time()
            stats = {k: st.get(k) for k in ("decks_new", "decks_updated", "tournaments", "rating_games", "deleted")}
            try:
                there = json.loads(hd.get("X-Grimorio-Stats") or "{}")
            except ValueError:
                there = {}
            return _update(data_dir, token, state="ok", since=done, last_ok=done, last_sync=done, last_try=now, fails=0, next=done + CHECK,
                           err=None, fp_push=backup.fingerprint(data_dir, own), fp_pull=hd.get("X-Grimorio-Fp"), pulled=stats, pushed=there,
                           conflicts=((s.get("conflicts") or []) + [{"at": done, "deck": n} for n in st.get("conflicts") or []])[-20:],
                           version=hello.get("version"), name=hello.get("owner_name") or s.get("name"))
        except backup.TooNew as e:
            return _update(data_dir, token, state="incompatible", side="device", need=e.version, last_try=now, next=now + 3600, err=None)
        except Remote as e:
            if e.code == "revoked" or e.status == 401:
                return _update(data_dir, token, state="revoked", err=str(e), last_try=now, next=now + 3600)
            if e.code == "newer":
                return _update(data_dir, token, state="incompatible", side="server", need=e.extra.get("version") or backup.app_version(),
                               last_try=now, next=now + 3600, err=None)
            fails = (s.get("fails") or 0) + 1
            return _update(data_dir, token, state="offline" if e.code == "offline" else "error", err=str(e), err_code=e.code,
                           fails=fails, last_try=now, next=now + BACKOFF[min(fails, len(BACKOFF)) - 1])
        except Exception as e:  # a sincronização é um extra: nunca derruba o servidor
            print(f"[devsync] {e!r}", file=sys.stderr, flush=True)
            fails = (s.get("fails") or 0) + 1
            return _update(data_dir, token, state="error", err=f"{type(e).__name__}: {e}", fails=fails, last_try=now,
                           next=now + BACKOFF[min(fails, len(BACKOFF)) - 1])
    finally:
        TLOCK.release()


def _loop(data_dir):
    while True:
        time.sleep(5)
        try:
            s = load(data_dir).get("server") or {}
            if s.get("on") and time.time() >= (s.get("next") or 0):
                tick(data_dir)
        except Exception as e:
            print(f"[devsync] {e!r}", file=sys.stderr, flush=True)


def init(data_dir):
    global DATA
    DATA = data_dir
    threading.Thread(target=_loop, args=(data_dir,), daemon=True).start()


# ---------- /api/storage (a app, o launcher e a app Android) ----------

def public(s):
    """O estado do servidor ligado sem o token."""
    if not s:
        return None
    return {k: s.get(k) for k in ("url", "name", "id", "owner", "on", "open", "state", "last_ok", "last_sync", "last_try", "err", "err_code",
                                  "next", "fails", "side", "need", "version", "pulled", "pushed", "conflicts", "insecure", "paired")}


def storage_status(data_dir, con, login=False, owner=None):
    """GET /api/storage. O contrato (também para a app Android e o launcher):
    {mode: 'local'|'folder'|'server'|'remote', chosen, fresh, can: {folder, server}, remote_url (só em 'remote'),
     server: {url, name, state: ok|syncing|offline|error|revoked|incompatible, last_ok, err, need, side, …} | null,
     folder: backup.status() | null, sync: {kind: 'folder'|'server'|null, state, last_ok, error},
     version, level, needs, api}"""
    cfg = load(data_dir)
    s = cfg.get("server") if not login else None
    f = backup.status(data_dir) if not login else None
    mode = "remote" if s and s.get("on") and s.get("open") else "server" if s and s.get("on") else "folder" if f and f.get("on") else "local"
    try:
        fresh = not con.execute("SELECT 1 FROM decks LIMIT 1").fetchone() and not con.execute("SELECT 1 FROM tournaments LIMIT 1").fetchone()
    except sqlite3.OperationalError:
        fresh = True
    if mode in ("server", "remote"):
        sync = {"kind": "server", "state": s.get("state") or "syncing", "last_ok": s.get("last_ok"), "error": s.get("err")}
    elif mode == "folder":
        sync = {"kind": "folder", "state": "error" if f.get("error") else "ok", "last_ok": max(f.get("last_push") or 0, (f.get("last_pull") or {}).get("at") or 0) or None,
                "error": f.get("error")}
    else:
        sync = {"kind": None, "state": "off", "last_ok": None, "error": None}
    return {"mode": mode, "chosen": bool(cfg.get("chosen")), "fresh": fresh, "can": {"folder": not login and not os.environ.get("GRIMORIO_ANDROID"), "server": not login},
            "remote_url": s["url"] if mode == "remote" else None, "server": public(s), "folder": f, "sync": sync,
            "owner": owner, "version": backup.app_version(), "level": backup.LEVEL, "needs": backup.NEEDS, "api": API}


def http(h, method, path, data_dir, db):
    """/api/storage (GET estado; POST {mode, folder?, chosen?}), /api/storage/pair, /api/storage/now,
    /api/storage/conflicts[/<id>], /api/storage/deleted[/<kind>/<id>], /api/devices* (o servidor gere os aparelhos)."""
    login, owner = h.mode() == "login", h.owner()
    p = path.split("?")[0]
    try:
        body = h.body(20_000) if method == "POST" else {}
    except ValueError as e:
        return h.json({"erro": str(e)}, 400)
    body = body if isinstance(body, dict) else {}
    if p.startswith("/api/devices"):
        if not owner:
            return h.json({"erro": "Escolhe um perfil primeiro.", "code": "profile"}, 401)
        with db() as con:
            return h.json(*reversed(owner_route(con, method, p, owner, body)))
    if p == "/api/storage" and method == "GET":
        with db() as con:
            return h.json(storage_status(data_dir, con, login, owner))
    if p.startswith("/api/storage/conflicts") or p.startswith("/api/storage/deleted"):
        if not owner:
            return h.json({"erro": "Escolhe um perfil primeiro.", "code": "profile"}, 401)
        m = re.match(r"^/api/storage/(conflicts|deleted)(?:/([a-z_]{1,12})/)?(?:/?([a-z0-9-]{1,40}))?$", p)
        if not m:
            return h.json({"erro": "rota desconhecida"}, 404)
        try:
            with db() as con:
                if m.group(1) == "conflicts":
                    if method == "GET":
                        return h.json({"conflicts": backup.conflicts(con, owner)})
                    return h.json(backup.resolve(con, owner, m.group(3), body.get("keep")))
                if method == "GET":
                    return h.json({"deleted": backup.deleted(con, owner)})
                return h.json(backup.restore(con, owner, m.group(2), m.group(3)))
        except ValueError as e:
            return h.json({"erro": str(e)}, 400)
    if login:
        return h.json({"erro": "Com login, os dados vivem neste servidor: não há pasta nem servidor para ligar.", "code": "login"}, 403)
    if method != "POST":
        return h.json({"erro": "rota desconhecida"}, 404)
    if p == "/api/storage/pair":
        if not owner:
            return h.json({"erro": "Escolhe um perfil primeiro.", "code": "profile"}, 401)
        try:
            pair(data_dir, owner, body.get("link") or "", body.get("url") or "", body.get("code") or "", bool(body.get("open")),
                 insecure_ok=bool(body.get("insecure_ok")))
        except ValueError as e:
            return h.json({"erro": str(e), "code": "link"}, 400)
        except Remote as e:
            return h.json({"erro": str(e), "code": e.code}, 409 if e.code == "http" else 502 if e.status in (0, 502) or e.status >= 500 else e.status)
        with db() as con:
            return h.json(storage_status(data_dir, con, login, owner))
    if p == "/api/storage/now":
        s = load(data_dir).get("server")
        if s and s.get("on"):
            tick(data_dir, force=True)
        elif backup.load(data_dir).get("on"):
            try:
                backup.tick(data_dir, force=True)
            except (OSError, ValueError) as e:
                return h.json({"erro": str(e)}, 400)
        with db() as con:
            return h.json(storage_status(data_dir, con, login, owner))
    if p == "/api/storage":
        mode = body.get("mode")
        if mode not in (None, "local", "folder", "server", "remote"):
            return h.json({"erro": "modo desconhecido"}, 400)
        with CLOCK:
            cfg = load(data_dir)
            if body.get("chosen") or mode:
                cfg["chosen"] = True
            s = cfg.get("server")
            if mode in ("server", "remote"):
                if not s:
                    return h.json({"erro": "Liga-te primeiro ao servidor com o link (ou o endereço e o código).", "code": "unpaired"}, 400)
                s.update(on=True, open=mode == "remote", next=0)
            save(data_dir, cfg)
        if mode in ("server", "remote"):
            _folder_off(data_dir)
        if mode in ("local", "folder"):
            unpair(data_dir)  # deixa de sincronizar com o servidor (os dados deste aparelho ficam todos)
        if mode == "local":
            _folder_off(data_dir)
        if mode == "folder":
            folder = str(body.get("folder") or "").strip()
            if not folder:
                return h.json({"erro": "Escolhe a pasta.", "code": "folder"}, 400)
            try:
                path_ = os.path.expanduser(os.path.expandvars(folder))
                os.makedirs(path_, exist_ok=True)
                with backup.LOCK:
                    c = backup.load(data_dir)
                    if path_ != backup.folder_of(c):
                        c.update(folder=folder, seen={}, since={}, fp=None)
                    c["on"] = True
                    backup.save(data_dir, c)
                backup.tick(data_dir, force=True)
            except (OSError, ValueError) as e:
                return h.json({"erro": f"Não consegui usar essa pasta: {e}", "code": "folder"}, 400)
        with db() as con:
            return h.json(storage_status(data_dir, con, login, owner))
    return h.json({"erro": "rota desconhecida"}, 404)
