"""Amigos e convidados: o anfitrião (quem tem o Grimório com o Forge, num NAS ou num PC) convida amigos por link.

Cada amigo tem um token. Abrir /convite/<token> põe o cookie `grimorio_guest` e, a partir daí, esse browser é um
convidado: vê e edita só os seus decks (guardados no anfitrião com `friend` = o id do amigo), vê os torneios em que
entra ou que estão abertos a amigos, aposta com a sua carteira (`guest:<id>`) e lê os dados públicos (cartas, meta).
Tudo o resto responde 403: um convidado nunca chega às rotas do dono.

Endereços de convidados (GRIMORIO_GUEST_HOSTS, ex. o domínio público sem 2FA): sem convite válido só servem a app e
as cartas — as APIs pedem convite.
"""
import html, json, os, re, secrets, socket, sqlite3, time, uuid

COOKIE = "grimorio_guest"
DECK = re.compile(r"^/api/decks/([a-z0-9-]{8,40})$")
TOUR = re.compile(r"^/api/tournaments/([a-z0-9]{12})(/.*)?$")
# GET que um convidado pode ler como está (dados públicos, sem nada do dono)
PASS_GET = ("/data/", "/arts/", "/covers/", "/assets/", "/ocr/", "/api/health", "/api/import", "/api/search/decks",
            "/api/sim/difficulties", "/api/sim/opponents", "/api/meta/", "/api/l17/", "/api/edhrec/", "/api/ratings", "/api/rules")


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, owner TEXT, name TEXT, token TEXT UNIQUE,"
                " created REAL, revoked REAL)")


def by_token(con, token):
    init(con)
    r = con.execute("SELECT id, owner, name FROM friends WHERE token=? AND revoked IS NULL", (str(token)[:80],)).fetchone() if token else None
    return r and {"id": r[0], "owner": r[1], "name": r[2]}


def cookie_token(headers):
    for part in (headers.get("Cookie") or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v
    return ""


def lan_ip():
    """O IP desta máquina na rede de casa (para o link e o QR no telemóvel)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.0.1", 9))  # não envia nada: só escolhe a interface de saída
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def guest_hosts():
    return {h.strip().lower() for h in os.environ.get("GRIMORIO_GUEST_HOSTS", "").split(",") if h.strip()}


def is_guest_host(headers):
    host = (headers.get("X-Forwarded-Host") or headers.get("Host") or "").split(":")[0].lower()
    return host in guest_hosts() or host.endswith(".trycloudflare.com")


def public_ok(method, path):
    """Num endereço de convidados, sem convite: só a app (página e ficheiros) e as cartas."""
    return method in ("GET", "HEAD") and not path.startswith(("/api/", "/play"))


# ---------- dono: gerir os amigos ----------

def owner_route(con, method, path, owner, body, port, tunnel=None, host="0.0.0.0"):
    """GET /api/friends -> {friends, lan, public}; POST {name}; POST /<id>/revoke; DELETE /<id> (os decks dele ficam)."""
    init(con)
    m = re.match(r"^/api/friends(?:/([a-f0-9]{12})(/revoke)?)?$", path)
    if not m:
        return 404, {"erro": "rota desconhecida"}
    fid = m.group(1)
    if method == "GET" and not fid:
        rows = con.execute("SELECT id, name, token, created, revoked FROM friends WHERE owner=? ORDER BY created", (owner,)).fetchall()
        decks = {}
        for (f,) in con.execute("SELECT json_extract(body, '$.friend') FROM decks WHERE owner=? AND deleted IS NULL AND json_extract(body, '$.friend') IS NOT NULL", (owner,)):
            decks[f] = decks.get(f, 0) + 1
        pub = os.environ.get("GRIMORIO_PUBLIC_URL", "").rstrip("/") or tunnel  # domínio próprio ou o túnel da partilha
        return 200, {"friends": [{"id": i, "name": n, "token": t, "created": c, "revoked": r, "decks": decks.get(i, 0)} for i, n, t, c, r in rows],
                     # só este computador (127.0.0.1, os pacotes por omissão): o link de casa não chegava a ninguém
                     "lan": None if host in ("127.0.0.1", "localhost", "::1") else f"http://{lan_ip()}:{port}", "public": pub or None}
    if method == "POST" and not fid:
        name = str((body or {}).get("name") or "").strip()[:40]
        if not name:
            return 400, {"erro": "Falta o nome do amigo."}
        fid = secrets.token_hex(6)
        con.execute("INSERT INTO friends VALUES (?,?,?,?,?,NULL)", (fid, owner, name, secrets.token_urlsafe(18), time.time()))
        return 201, {"id": fid}
    if method == "POST" and m.group(2):  # revogar: o link deixa de entrar (pode criar-se outro)
        n = con.execute("UPDATE friends SET revoked=? WHERE id=? AND owner=?", (time.time(), fid, owner)).rowcount
        return (200, {"ok": True}) if n else (404, {"erro": "não existe"})
    if method == "DELETE" and fid:
        n = con.execute("DELETE FROM friends WHERE id=? AND owner=?", (fid, owner)).rowcount
        return (200, {"ok": True}) if n else (404, {"erro": "não existe"})
    return 404, {"erro": "rota desconhecida"}


# ---------- convidado ----------

def accept(h, con, token):
    """GET /convite/<token>: cookie de convidado e vai para a app; convite inválido -> página a explicar."""
    g = by_token(con, token)
    if not g:
        return h.send(404, "<!doctype html><meta charset=utf-8><title>Grimório</title><p style='font:16px system-ui;padding:2em'>"
                      "Este convite já não é válido. Pede outro a quem te convidou.</p>".encode(), "text/html; charset=utf-8")
    return h.send(302, b"", "text/plain", {"Location": "/", "Set-Cookie": f"{COOKIE}={token}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})


def room_link(h, con, token, name):
    """GET /sala/<token>[?nome=…]: o link de uma sala aberta (jogo avulso ou torneio) serve a quem não está nos amigos:
    pede um nome, fica convidado do anfitrião («Nome (sala)») e entra na app, onde vê as salas abertas e junta um deck."""
    page = lambda body, code=200: h.send(code, ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"  # noqa: E731
                                              "<title>Grimório</title><body style='font:16px system-ui;padding:2em;max-width:30em;margin:auto;background:#0b0a14;color:#eee'>"
                                              + body).encode(), "text/html; charset=utf-8")
    try:
        r = con.execute("SELECT owner, status, json_extract(spec, '$.name'), json_extract(spec, '$.type') FROM rooms WHERE json_extract(spec, '$.link')=?", (token,)).fetchone()
    except sqlite3.OperationalError:
        r = None
    if not r or r[1] != "open":
        return page("<p>Esta sala já não está aberta. Pede outro link a quem te convidou.</p>", 404)
    owner = r[0]
    g = by_token(con, cookie_token(h.headers))
    if g and g["owner"] == owner:  # já é convidado deste Grimório
        return h.send(302, b"", "text/plain", {"Location": "/#online"})
    name = re.sub(r"[<>&\"']", "", str(name or "")).strip()[:30]
    if not name:
        how = ("<p style='padding:.6em .8em;border-radius:8px;background:#1d1a2e'>🃏 <b>Mesa livre · sem regras</b><br>Só amigos, sem bots: cada um mexe nas"
               " suas cartas, como numa mesa a sério (compras, viras, atacas, contas a vida). Ninguém valida as jogadas.</p>" if r[3] == "livre" else
               "<p style='padding:.6em .8em;border-radius:8px;background:#1d1a2e'>🤖 <b>Com os bots do Forge</b><br>Juntas um deck teu e os bots do Forge"
               " jogam-no por ti, com as regras todas; tu vês ao vivo e podes apostar.</p>")
        return page(f"<h2>{'🃏' if r[3] == 'livre' else '🎲'} {html.escape(r[2] or 'Sala')}</h2>{how}<p>Entra com um nome para jogares nesta sala com um deck teu.</p>"
                    "<form><input name=nome maxlength=30 autofocus required placeholder='O teu nome' style='font:inherit;padding:.5em;width:100%;box-sizing:border-box'>"
                    "<button style='font:inherit;margin-top:1em;padding:.5em 1.2em'>Entrar</button></form>")
    init(con)
    fid, tok = secrets.token_hex(6), secrets.token_urlsafe(18)
    con.execute("INSERT INTO friends VALUES (?,?,?,?,?,NULL)", (fid, owner, f"{name} (sala)", tok, time.time()))
    return h.send(302, b"", "text/plain", {"Location": "/#online", "Set-Cookie": f"{COOKIE}={tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})


def visible(con, g, tid):
    """Um convidado vê os torneios do anfitrião onde entra um deck seu ou que estão abertos a amigos."""
    r = con.execute("SELECT state FROM tournaments WHERE id=? AND owner=?", (tid, g["owner"])).fetchone()
    if not r:
        return False
    st = json.loads(r[0])
    if st.get("friends_open"):
        return True
    mine = {d for (d,) in con.execute("SELECT id FROM decks WHERE owner=? AND json_extract(body, '$.friend')=?", (g["owner"], g["id"]))}
    return any(p.get("src") == "meus" and p.get("ref") in mine for p in st.get("players") or [])


def own(con, g, did):
    r = con.execute("SELECT body FROM decks WHERE id=? AND owner=?", (did, g["owner"])).fetchone()
    return r and json.loads(r[0]).get("friend") == g["id"]


def handle(h, method, g, db, tournament):
    """Pedido de um convidado: só a lista fechada; tudo o resto 403."""
    p = h.path.split("?")[0]
    deny = lambda: h.json({"erro": "Os convidados não podem fazer isto."}, 403)  # noqa: E731
    if p == "/api/guest/leave" and method == "POST":
        return h.send(200, b'{"ok": true}', "application/json", {"Set-Cookie": f"{COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly"})
    if p in ("/api/guest/me", "/api/me") and method == "GET":
        return h.json({"user": g["name"], "guest": {"id": g["id"], "name": g["name"]}})
    if p == "/api/profiles" and method == "GET":
        return h.json({"mode": "guest", "current": {"id": None, "name": g["name"], "color": None}, "list": []})
    if p == "/api/decks" and method == "GET":
        return h._get()  # a lista filtra pelo convidado (H._as_guest)
    if p == "/api/decks" and method == "POST":
        return save(h, g, db, None)
    md = DECK.match(p)
    if md:
        did = md.group(1)
        with db() as con:
            mine = own(con, g, did)
        if method == "GET":
            return h._get() if mine else h.json({"erro": "deck não existe"}, 404)
        if method == "PUT":
            with db() as con:
                exists = con.execute("SELECT 1 FROM decks WHERE id=?", (did,)).fetchone()
            return save(h, g, db, did) if mine or not exists else deny()
        if method == "DELETE":
            if not mine:
                return deny()
            with db() as con:
                con.execute("UPDATE decks SET deleted=? WHERE id=? AND owner=?", (time.time(), did, g["owner"]))
            return h.json({"ok": True})
        return deny()
    if p.startswith("/api/rooms") and method in ("GET", "POST"):  # salas: ver as abertas, entrar/sair com um deck seu
        import rooms
        with db() as con:
            return h.json(*reversed(rooms.route(con, method, p, g["owner"], h.body() if method == "POST" else None, guest=g)))
    if p.startswith("/api/freetables/") and method in ("GET", "POST"):  # mesa livre: só as mesas onde está sentado (freetable.route)
        return h.freetable_route(method, p, g["owner"], f"guest:{g['id']}")
    bettor = f"guest:{g['id']}"
    if p in ("/api/tournaments/bets", "/api/tournaments/wallet-reset") and method in ("GET", "POST"):
        return h.json(*reversed(tournament.route(method, h.path, g["owner"], h.body() if method == "POST" else None, bettor=bettor)))
    if p == "/api/tournaments" and method == "GET":
        code, rows = tournament.route("GET", h.path, g["owner"])
        with db() as con:
            rows = [r for r in rows if visible(con, g, r["id"])] if code == 200 else rows
        return h.json(rows, code)
    mt = TOUR.match(p)
    if mt:
        with db() as con:
            ok = visible(con, g, mt.group(1))
        sub = (mt.group(2) or "").strip("/")
        if not ok or not (method == "GET" or (method == "POST" and sub == "bets")):
            return deny()
        return h.json(*reversed(tournament.route(method, h.path, g["owner"], h.body() if method == "POST" else None, bettor=bettor)))
    if method in ("GET", "HEAD") and (p.startswith(PASS_GET) or not p.startswith(("/api/", "/play", "/convite"))):
        return h._get()
    return deny()


def save(h, g, db, did):
    """Deck do convidado: guardado no anfitrião, sempre marcado como dele."""
    try:
        d = h.body()
    except ValueError as e:
        return h.json({"erro": str(e)}, 400)
    if not isinstance(d, dict):
        return h.json({"erro": "deck inválido"}, 400)
    d.update(id=did or str(uuid.uuid4()), friend=g["id"], friendName=g["name"])
    d.pop("community", None)
    return h.save(d, 200 if did else 201)
