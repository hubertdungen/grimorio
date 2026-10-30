"""Amigos e convidados: o anfitrião (quem tem o Grimório com o Forge, num NAS ou num PC) convida amigos por link.

Cada amigo tem um token. Abrir /convite/<token> põe o cookie `grimorio_guest` e, a partir daí, esse browser é um
convidado: vê e edita só os seus decks (guardados no anfitrião com `friend` = o id do amigo), vê os torneios em que
entra ou que estão abertos a amigos, aposta com a sua carteira (`guest:<id>`) e lê os dados públicos (cartas, meta).
Tudo o resto responde 403: um convidado nunca chega às rotas do dono.

Endereços de convidados (GRIMORIO_GUEST_HOSTS, ex. o domínio público sem 2FA): sem convite válido só servem a app e
as cartas — as APIs pedem convite.
"""
import hashlib, html, json, os, re, secrets, socket, sqlite3, time, uuid

COOKIE = "grimorio_guest"
DECK = re.compile(r"^/api/decks/([a-z0-9-]{8,40})$")
TOUR = re.compile(r"^/api/tournaments/([a-z0-9]{12})(/.*)?$")
# GET que um convidado pode ler como está (dados públicos, sem nada do dono)
PASS_GET = ("/data/", "/arts/", "/covers/", "/assets/", "/ocr/", "/api/health", "/api/import", "/api/search/decks",
            "/api/sim/difficulties", "/api/sim/opponents", "/api/meta/", "/api/l17/", "/api/edhrec/", "/api/ratings", "/api/rules")


def init(con):
    con.execute("CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, owner TEXT, name TEXT, token TEXT UNIQUE,"
                " created REAL, revoked REAL)")
    try:  # ext: hash da chave de um perfil ligado (deste Grimório, de outro, de uma cópia) — o mesmo perfil não se duplica
        con.execute("ALTER TABLE friends ADD COLUMN ext TEXT")
    except sqlite3.OperationalError:
        pass


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
        con.execute("INSERT INTO friends (id, owner, name, token, created, revoked) VALUES (?,?,?,?,?,NULL)", (fid, owner, name, secrets.token_urlsafe(18), time.time()))
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


def _room(con, token):
    try:
        return con.execute("SELECT owner, status, json_extract(spec, '$.name'), json_extract(spec, '$.type') FROM rooms WHERE json_extract(spec, '$.link')=?", (token,)).fetchone()
    except sqlite3.OperationalError:
        return None


def _page(h, body, code=200):
    return h.send(code, ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                         "<title>Grimório</title><body style='font:16px system-ui;padding:2em;max-width:34em;margin:auto;background:#0b0a14;color:#eee;line-height:1.45'>"
                         "<style>button,input{font:inherit;padding:.55em 1em;border-radius:10px;border:1px solid #555;background:#1d1a2e;color:#eee}"
                         "button.go{background:#f2b84b;color:#111;border:0;font-weight:700}.box{padding:.7em .9em;border-radius:12px;background:#1d1a2e;margin:1em 0}"
                         "small{color:#aaa}</style>" + body).encode(), "text/html; charset=utf-8")


def _go(h, tok):
    return h.send(303, b"", "text/plain", {"Location": "/#online", "Set-Cookie": f"{COOKIE}={tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})


DECK_KEYS = ("name", "format", "main", "side", "commanders", "cover", "casual")


def clean_deck(d):
    """Um deck que chega de fora (outro Grimório, uma cópia .grimorio): só nome, formato e listas, com limites."""
    if not isinstance(d, dict):
        return None
    lst = lambda x, n: {str(k)[:150]: int(v) for k, v in list((x or {}).items())[:n] if isinstance(v, (int, float)) and 0 < v <= 250} if isinstance(x, dict) else {}  # noqa: E731
    main = lst(d.get("main"), 300)
    if not main:
        return None
    return {"name": str(d.get("name") or "Deck")[:120], "format": str(d.get("format") or "casual")[:30], "main": main, "side": lst(d.get("side"), 100),
            "commanders": [str(c)[:150] for c in (d.get("commanders") or [])[:2] if isinstance(c, str)], "cover": str(d.get("cover") or "")[:150] or None,
            "casual": bool(d.get("casual")), "src_id": str(d.get("id") or d.get("name") or "")[:80]}


def link_friend(con, owner, ext, name, decks):
    """Amigo ligado a um perfil (deste Grimório, de outro, ou de uma cópia): reconhece-o pela chave `ext` (guarda-se o
    hash), põe-lhe o nome e os decks em dia (os mesmos decks de origem atualizam-se, não se duplicam) -> token do convite."""
    init(con)
    key = hashlib.sha256(ext.encode()).hexdigest()
    r = con.execute("SELECT id, token, revoked FROM friends WHERE owner=? AND ext=?", (owner, key)).fetchone()
    if r and r[2]:
        raise PermissionError("Este convite foi revogado por quem aloja.")
    name = re.sub(r"[<>&\"']", "", str(name or "")).strip()[:30] or "Amigo"
    if r:
        fid, tok = r[0], r[1]
        con.execute("UPDATE friends SET name=? WHERE id=?", (name, fid))
    else:
        fid, tok = secrets.token_hex(6), secrets.token_urlsafe(18)
        con.execute("INSERT INTO friends (id, owner, name, token, created, revoked, ext) VALUES (?,?,?,?,?,NULL,?)", (fid, owner, name, tok, time.time(), key))
    now = time.time()
    for d in [x for x in map(clean_deck, decks or []) if x][:80]:
        did = "x" + hashlib.sha1(f"{key}:{d.pop('src_id')}".encode()).hexdigest()[:30]
        body = {**d, "id": did, "friend": fid, "friendName": name, "count": sum(d["main"].values()), "created": now}
        con.execute("INSERT OR REPLACE INTO decks (id, name, format, body, updated, owner, deleted) VALUES (?,?,?,?,?,?,NULL)",
                    (did, body["name"], body["format"], json.dumps(body, ensure_ascii=False), now, owner))
    return tok


def room_link(h, con, token, name, me=None):
    """GET /sala/<token>[?nome=…]: o link de uma sala aberta (jogo avulso, torneio ou mesa livre). Quem já é deste Grimório
    entra logo: quem aloja vai para as salas; um perfil deste Grimório entra como ele, com os decks dele. Os outros
    escolhem: um nome (convidado novo), a cópia do seu Grimório (.grimorio) ou, numa app do Grimório, «Entrar numa sala»
    (leva o perfil e os decks dessa app). me = {owner, profile} de quem abre o link (None num endereço de convidados)."""
    r = _room(con, token)
    if not r or r[1] != "open":
        return _page(h, "<p>Esta sala já não está aberta. Pede outro link a quem te convidou.</p>", 404)
    owner = r[0]
    g = by_token(con, cookie_token(h.headers))
    if g and g["owner"] == owner:  # já é convidado deste Grimório
        return h.send(302, b"", "text/plain", {"Location": "/#online"})
    if me and me.get("owner") == owner:  # quem aloja (ou o mesmo perfil)
        return h.send(302, b"", "text/plain", {"Location": "/#online"})
    name = re.sub(r"[<>&\"']", "", str(name or "")).strip()[:30]
    if not name:
        how = ("<div class=box>🃏 <b>Mesa livre · sem regras</b><br>Só amigos, sem bots: cada um mexe nas suas cartas, como numa mesa a sério"
               " (compras, viras, atacas, contas a vida). Ninguém valida as jogadas.</div>" if r[3] == "livre" else
               "<div class=box>🤖 <b>Com os bots do Forge</b><br>Juntas um deck teu e os bots do Forge jogam-no por ti, com as regras todas;"
               " tu vês ao vivo e podes apostar.</div>")
        prof = me and me.get("profile")
        mine = (f"<form method=post action='/sala/{html.escape(token)}/perfil'><button class=go>👤 Entrar como {html.escape(prof['name'])}</button>"
                " <small>com os teus decks deste Grimório</small></form><p><small>ou, com outro nome:</small></p>") if prof else ""
        return _page(h, f"<h2>{'🃏' if r[3] == 'livre' else '🎲'} {html.escape(r[2] or 'Sala')}</h2>{how}{mine}"
                     "<form><p>Entra com um nome para jogares nesta sala. Não precisas de ter decks: na sala podes usar um emprestado,"
                     " um do meta ou colar a tua lista.</p><input name=nome maxlength=30 required placeholder='O teu nome' style='width:100%;box-sizing:border-box'>"
                     "<p><button class=go>Entrar</button></p></form>"
                     "<div class=box><b>Tens o Grimório no teu PC ou telemóvel?</b><br><small>Na tua app: Coliseu › 🌍 Online › 🚪 Salas ›"
                     " «Entrar numa sala de outro Grimório» e cola este link: entras como o teu perfil, com os teus decks.</small>"
                     "<p><small>Ou traz uma cópia do teu Grimório (ficheiro <b>.grimorio</b>, em Definições › Cópias):</small><br>"
                     "<input type=file id=f accept='.grimorio'> <span id=st></span></p></div>"
                     "<script>f.onchange=async()=>{const x=f.files[0];if(!x)return;st.textContent='A ler…';"
                     "const go=async q=>{const r=await fetch(location.pathname.replace(/\\/$/,'')+'/importar'+q,{method:'POST',body:x});const j=await r.json().catch(()=>({}));"
                     "if(!r.ok){st.textContent=j.erro||'Não deu.';return}if(j.go){location.href=j.go;return}"
                     "st.innerHTML='Que perfil és tu? '+j.profiles.map(p=>`<button data-p=\"${p.id}\">${p.name} (${p.decks})</button>`).join(' ');"
                     "st.querySelectorAll('button').forEach(b=>b.onclick=()=>go('?perfil='+encodeURIComponent(b.dataset.p)))};go('')}</script>")
    init(con)
    fid, tok = secrets.token_hex(6), secrets.token_urlsafe(18)
    con.execute("INSERT INTO friends (id, owner, name, token, created, revoked) VALUES (?,?,?,?,?,NULL)", (fid, owner, f"{name} (sala)", tok, time.time()))
    return h.send(302, b"", "text/plain", {"Location": "/#online", "Set-Cookie": f"{COOKIE}={tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly"})


def room_post(h, con, token, act, me, data_dir):
    """POST /sala/<token>/perfil | /trazer | /importar — entrar ligado a um perfil (este Grimório, outro, uma cópia)."""
    r = _room(con, token)
    if not r or r[1] != "open":
        return h.json({"erro": "Esta sala já não está aberta."}, 404)
    owner = r[0]
    try:
        if act == "perfil":  # um perfil deste Grimório (mesmo browser): entra como ele, com os decks dele
            prof = me and me.get("profile")
            if not prof:
                return h.json({"erro": "Não há perfil escolhido neste browser."}, 400)
            decks = [json.loads(b) | {"id": i} for i, b in con.execute("SELECT id, body FROM decks WHERE owner=? AND deleted IS NULL ORDER BY updated DESC LIMIT 80", (prof["id"],))]
            return _go(h, link_friend(con, owner, f"local:{prof['id']}", prof["name"], [d for d in decks if not d.get("friend")]))
        if act == "trazer":  # outro Grimório (a app de um amigo): {name, key, decks}; a chave é dele e só ele a sabe
            d = h.body()
            key = str(d.get("key") or "")
            if not re.fullmatch(r"[A-Za-z0-9_-]{24,100}", key) or not isinstance(d.get("decks"), list):
                return h.json({"erro": "Pedido inválido."}, 400)
            return h.json({"go": f"/convite/{link_friend(con, owner, 'app:' + key, d.get('name'), d['decks'])}"})
        if act == "importar":  # cópia .grimorio: escolhe-se um perfil lá dentro e entram o nome e os decks dele
            return _import(h, con, owner, data_dir)
    except PermissionError as e:
        return h.json({"erro": str(e)}, 403)
    except ValueError as e:
        return h.json({"erro": str(e)}, 400)
    return h.json({"erro": "rota desconhecida"}, 404)


def _import(h, con, owner, data_dir):
    import backup, tempfile, urllib.parse
    n = int(h.headers.get("Content-Length") or 0)
    if not 0 < n <= 60_000_000:
        return h.json({"erro": "Escolhe uma cópia .grimorio (até 60 MB)."}, 400)
    fd, tmp = tempfile.mkstemp(prefix="sala-", suffix=".grimorio", dir=data_dir)
    try:
        with os.fdopen(fd, "wb") as f:
            left = n
            while left > 0:
                b = h.rfile.read(min(1 << 20, left))
                if not b:
                    break
                f.write(b); left -= len(b)
        man, tmpdb, z = backup.open_zip(tmp, data_dir)  # valida (zip do Grimório, base sã); só se leem decks e nomes
        z.close()
        try:
            c = sqlite3.connect(tmpdb)
            rows = c.execute("SELECT id, owner, body FROM decks WHERE deleted IS NULL").fetchall()
            try:
                names = dict(c.execute("SELECT id, name FROM profiles").fetchall())
            except sqlite3.DatabaseError:
                names = {}
            c.close()
        finally:
            os.remove(tmpdb)
        by = {}
        for i, o, b in rows:
            d = json.loads(b)
            if not d.get("friend") and not d.get("community"):
                by.setdefault(o or "local", []).append(d | {"id": i})
        if not by:
            return h.json({"erro": "Esta cópia não tem decks."}, 400)
        want = urllib.parse.parse_qs(urllib.parse.urlsplit(h.path).query).get("perfil", [""])[0]
        if not want and len(by) > 1:
            return h.json({"profiles": [{"id": o, "name": names.get(o) or o, "decks": len(ds)} for o, ds in by.items()]})
        o = want if want in by else next(iter(by))
        dev = str(man.get("device") or "")[:60]
        return h.json({"go": f"/convite/{link_friend(con, owner, f'copia:{dev}:{o}', names.get(o) or o, by[o])}"})
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


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
        if not ok or not (method == "GET" or (method == "POST" and sub in ("bets", "ready"))):  # ready: torneio de mesa livre (a rota vê se joga a partida)
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
